from __future__ import annotations

import argparse
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path


POOL_NAME = "参考文献候选池.md"
RESULT_NAME = "参考文献检索结果.md"


def parse_candidate_pool(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    lines = path.read_text(encoding="utf-8").splitlines()
    for line in lines:
        if not line.startswith("| R"):
            continue
        parts = [part.strip() for part in line.strip("|").split("|")]
        if len(parts) < 8:
            continue
        rows.append(
            {
                "编号": parts[0],
                "所属章节": parts[1],
                "支撑论点": parts[2],
                "检索词": parts[3],
                "候选文献": parts[4],
                "来源链接/DOI": parts[5],
                "核验状态": parts[6],
                "备注": parts[7],
            }
        )
    return rows


def build_query(row: dict[str, str]) -> str:
    query = row["检索词"]
    if query and query != "[待填写]":
        return query
    section = row["所属章节"] if row["所属章节"] != "[待填写]" else ""
    claim = row["支撑论点"] if row["支撑论点"] != "[待填写]" else ""
    return " ".join(part for part in [section, claim] if part).strip()


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "project-to-paper/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def search_openalex(query: str, top_n: int) -> list[dict[str, str]]:
    url = "https://api.openalex.org/works?" + urllib.parse.urlencode({"search": query, "per-page": top_n})
    data = fetch_json(url)
    results: list[dict[str, str]] = []
    for item in data.get("results", []):
        authors = ", ".join(author["author"]["display_name"] for author in item.get("authorships", [])[:3])
        venue = item.get("primary_location", {}).get("source", {}) or {}
        results.append(
            {
                "来源": "OpenAlex",
                "题名": item.get("display_name", ""),
                "作者": authors or "[未识别]",
                "年份": str(item.get("publication_year", "")),
                "期刊": venue.get("display_name", ""),
                "DOI": item.get("doi", "") or "",
                "链接": item.get("id", ""),
            }
        )
    return results


def search_crossref(query: str, top_n: int) -> list[dict[str, str]]:
    url = "https://api.crossref.org/works?" + urllib.parse.urlencode({"query.title": query, "rows": top_n})
    data = fetch_json(url)
    results: list[dict[str, str]] = []
    for item in data.get("message", {}).get("items", []):
        title = item.get("title", [""])
        authors = []
        for author in item.get("author", [])[:3]:
            given = author.get("given", "").strip()
            family = author.get("family", "").strip()
            authors.append(" ".join(part for part in [given, family] if part))
        results.append(
            {
                "来源": "Crossref",
                "题名": title[0] if title else "",
                "作者": ", ".join(authors) or "[未识别]",
                "年份": str((item.get("issued", {}).get("date-parts") or [[""]])[0][0]),
                "期刊": (item.get("container-title") or [""])[0],
                "DOI": item.get("DOI", ""),
                "链接": item.get("URL", ""),
            }
        )
    return results


def render_results(rows: list[dict[str, str]], top_n: int) -> str:
    lines = [
        "# 参考文献检索结果",
        "",
        f"- 检索条目数：`{len(rows)}`",
        f"- 每个条目返回上限：`{top_n}`",
        "- 结果仅作为候选池，不直接等于可入稿文献，仍需人工核验。",
        "",
    ]
    for row in rows:
        query = build_query(row)
        lines.extend(
            [
                f"## {row['编号']} {row['所属章节']} / {row['支撑论点']}",
                "",
                f"- 检索词：`{query or '[为空]'}`",
                "",
                "| 来源 | 题名 | 作者 | 年份 | 期刊 | DOI | 链接 |",
                "|---|---|---|---|---|---|---|",
            ]
        )
        if not query:
            lines.append("| - | 检索词为空，需人工补充 | - | - | - | - | - |")
            lines.append("")
            continue

        merged: list[dict[str, str]] = []
        errors: list[str] = []
        try:
            merged.extend(search_openalex(query, top_n))
        except Exception as exc:
            errors.append(f"OpenAlex: {exc}")
        try:
            merged.extend(search_crossref(query, top_n))
        except Exception as exc:
            errors.append(f"Crossref: {exc}")

        if merged:
            seen: set[tuple[str, str]] = set()
            count = 0
            for item in merged:
                key = (item["题名"], item["DOI"])
                if key in seen:
                    continue
                seen.add(key)
                lines.append(
                    f"| {item['来源']} | {item['题名'] or '[空]'} | {item['作者']} | {item['年份']} | {item['期刊']} | {item['DOI']} | {item['链接']} |"
                )
                count += 1
                if count >= top_n * 2:
                    break
        else:
            lines.append("| - | 未检索到结果 | - | - | - | - | - |")

        if errors:
            lines.extend(["", "- 检索异常："] + [f"  - {msg}" for msg in errors])
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="根据参考文献候选池半自动检索候选文献。")
    parser.add_argument("--workspace-root", default=str(Path(__file__).resolve().parents[1]), help="论文工作区根目录")
    parser.add_argument("--top-n", type=int, default=3, help="每个来源返回前几条结果")
    args = parser.parse_args()

    root = Path(args.workspace_root).resolve()
    manuscript_dir = root / "04_论文稿件"
    support_dir = root / "05_支撑材料"
    pool_path = manuscript_dir / POOL_NAME
    output_path = support_dir / RESULT_NAME

    if not pool_path.exists():
        raise SystemExit(f"未找到：{pool_path}")

    rows = parse_candidate_pool(pool_path)
    output_path.write_text(render_results(rows, args.top_n), encoding="utf-8")
    print(f"已生成：{output_path}")
