from __future__ import annotations

import argparse
import re
from pathlib import Path


POOL_NAME = "参考文献候选池.md"
SEARCH_NAME = "参考文献检索结果.md"
MAP_NAME = "引文映射表.md"
REPORT_NAME = "参考文献回填报告.md"
SKIP_FILES = {"投稿格式对照表.md", "作者与基金信息.md", "参考文献候选池.md", "引文映射表.md", "格式模版.md"}


def parse_table_row(line: str) -> list[str]:
    return [part.strip() for part in line.strip().strip("|").split("|")]


def is_placeholder(value: str) -> bool:
    value = value.strip()
    if not value:
        return True
    if "待" in value or "???" in value or "［待填写］" in value:
        return True
    if re.fullmatch(r"\[[^\]]{0,12}\]", value):
        return True
    return False


def parse_candidate_pool(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| R"):
            continue
        parts = parse_table_row(line)
        if len(parts) < 7:
            continue
        if len(parts) == 7:
            parts = parts[:3] + ["[待填写]"] + parts[3:]
        rows.append(
            {
                "id": parts[0],
                "section": parts[1],
                "claim": parts[2],
                "query": parts[3],
                "candidate": parts[4],
                "link": parts[5],
                "status": parts[6],
                "note": parts[7] if len(parts) > 7 else "[待填写]",
            }
        )
    return rows


def parse_search_results(path: Path) -> dict[str, list[dict[str, str]]]:
    text = path.read_text(encoding="utf-8")
    sections = re.split(r"^##\s+", text, flags=re.M)
    result_map: dict[str, list[dict[str, str]]] = {}
    for section in sections[1:]:
        lines = section.splitlines()
        header = lines[0].strip()
        match = re.match(r"(R\d+)\s+", header)
        if not match:
            continue
        rid = match.group(1)
        items: list[dict[str, str]] = []
        for line in lines:
            if not line.startswith("| "):
                continue
            if "来源 | 题名 | 作者" in line or line.startswith("|---|"):
                continue
            parts = parse_table_row(line)
            if len(parts) < 7:
                continue
            items.append(
                {
                    "source": parts[0],
                    "title": parts[1],
                    "authors": parts[2],
                    "year": parts[3],
                    "journal": parts[4],
                    "doi": parts[5],
                    "url": parts[6],
                }
            )
        result_map[rid] = items
    return result_map


def format_reference(item: dict[str, str]) -> str:
    authors = item["authors"] or "[未识别作者]"
    title = item["title"] or "[未识别题名]"
    journal = item["journal"] or "[未识别期刊]"
    year = item["year"] or "[年份缺失]"
    locator = item["doi"] or item["url"] or "[链接缺失]"
    return f"{authors}. {title}[J]. {journal}, {year}. DOI/Link: {locator}"


def rewrite_pool(path: Path, rows: list[dict[str, str]]) -> None:
    lines = [
        "# 参考文献候选池",
        "",
        "| 编号 | 所属章节 | 支撑论点 | 检索词 | 候选文献 | 来源链接 / DOI | 核验状态 | 备注 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        lines.append(
            f"| {row['id']} | {row['section']} | {row['claim']} | {row['query']} | {row['candidate']} | {row['link']} | {row['status']} | {row['note']} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def rewrite_citation_map(path: Path, rows: list[dict[str, str]], selected_ids: dict[str, int]) -> None:
    lines = [
        "# 引文映射表",
        "",
        "| 正文位置 | 论断 | 计划引文编号 | 备注 |",
        "|---|---|---|---|",
    ]
    for row in rows:
        num = selected_ids.get(row["id"])
        cite = f"[{num}]" if num is not None else "[待填写]"
        lines.append(f"| {row['section']} / {row['claim']} | {row['claim']} | {cite} | 自动回填编号，正文需人工复核 |")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def find_main_markdown(manuscript_dir: Path) -> Path:
    for path in sorted(manuscript_dir.glob("*.md")):
        if path.name not in SKIP_FILES:
            return path
    raise FileNotFoundError("未找到主论文 Markdown 文件")


def update_manuscript(manuscript_path: Path, rows: list[dict[str, str]], selected_ids: dict[str, int]) -> tuple[int, int]:
    text = manuscript_path.read_text(encoding="utf-8")
    replaced = 0
    for row in rows:
        num = selected_ids.get(row["id"])
        if num is None:
            continue
        marker = "{{" + row["id"] + "}}"
        count = text.count(marker)
        if count:
            text = text.replace(marker, f"[{num}]")
            replaced += count

    references = []
    for row in rows:
        num = selected_ids.get(row["id"])
        if num is None or is_placeholder(row["candidate"]):
            continue
        references.append(f"[{num}] {row['candidate']}")

    if references:
        if "## 参考文献" in text:
            text = re.sub(r"## 参考文献\s*.*$", "## 参考文献\n" + "\n".join(references), text, flags=re.S)
        else:
            text = text.rstrip() + "\n\n## 参考文献\n" + "\n".join(references) + "\n"

    manuscript_path.write_text(text, encoding="utf-8")
    return replaced, len(references)


def write_report(path: Path, rows: list[dict[str, str]], selected_ids: dict[str, int], replaced: int, ref_count: int) -> None:
    lines = [
        "# 参考文献回填报告",
        "",
        f"- 回填条目数：`{len(selected_ids)}`",
        f"- 正文标记替换数：`{replaced}`",
        f"- 主稿参考文献条目数：`{ref_count}`",
        "- 正文只会替换形如 `{{R01}}` 的显式标记。",
        "",
        "| 候选编号 | 引文编号 | 候选文献 | 状态 | 备注 |",
        "|---|---|---|---|---|",
    ]
    for row in rows:
        num = selected_ids.get(row["id"])
        cite = f"[{num}]" if num is not None else "-"
        lines.append(f"| {row['id']} | {cite} | {row['candidate']} | {row['status']} | {row['note']} |")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="把参考文献检索结果回填到候选池、引文映射和主稿参考文献区。")
    parser.add_argument("--workspace-root", default=str(Path(__file__).resolve().parents[1]), help="论文工作区根目录")
    parser.add_argument("--force", action="store_true", help="即使候选文献已存在也覆盖为检索首条结果")
    args = parser.parse_args()

    root = Path(args.workspace_root).resolve()
    manuscript_dir = root / "04_论文稿件"
    support_dir = root / "05_支撑材料"

    pool_path = manuscript_dir / POOL_NAME
    search_path = support_dir / SEARCH_NAME
    map_path = manuscript_dir / MAP_NAME
    report_path = support_dir / REPORT_NAME

    rows = parse_candidate_pool(pool_path)
    search_map = parse_search_results(search_path)
    selected_ids: dict[str, int] = {}

    number = 1
    for row in rows:
        results = search_map.get(row["id"], [])
        if results and (args.force or is_placeholder(row["candidate"])):
            best = results[0]
            row["candidate"] = format_reference(best)
            row["link"] = best["doi"] or best["url"] or "[待填写]"
            row["status"] = "待人工复核"
            prefix = "" if is_placeholder(row["note"]) else row["note"]
            auto_note = f"自动回填自{best['source']}"
            row["note"] = "；".join(part for part in [prefix, auto_note] if part)
        if not is_placeholder(row["candidate"]):
            selected_ids[row["id"]] = number
            number += 1

    rewrite_pool(pool_path, rows)
    rewrite_citation_map(map_path, rows, selected_ids)
    manuscript_path = find_main_markdown(manuscript_dir)
    replaced, ref_count = update_manuscript(manuscript_path, rows, selected_ids)
    write_report(report_path, rows, selected_ids, replaced, ref_count)

    print(f"已更新：{pool_path}")
    print(f"已更新：{map_path}")
    print(f"已更新：{manuscript_path}")
    print(f"已生成：{report_path}")
    print(f"正文替换标记数：{replaced}")
