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
                "编号": parts[0],
                "所属章节": parts[1],
                "支撑论点": parts[2],
                "检索词": parts[3],
                "候选文献": parts[4],
                "来源链接 / DOI": parts[5],
                "核验状态": parts[6],
                "备注": parts[7] if len(parts) > 7 else "[待填写]",
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
            if not line.startswith("| ") or line.startswith("| 来源 |") or line.startswith("|---|"):
                continue
            parts = parse_table_row(line)
            if len(parts) < 7:
                continue
            items.append(
                {
                    "来源": parts[0],
                    "题名": parts[1],
                    "作者": parts[2],
                    "年份": parts[3],
                    "期刊": parts[4],
                    "DOI": parts[5],
                    "链接": parts[6],
                }
            )
        result_map[rid] = items
    return result_map


def format_reference(item: dict[str, str]) -> str:
    authors = item["作者"] or "[未识别作者]"
    title = item["题名"] or "[未识别题名]"
    journal = item["期刊"] or "[未识别期刊]"
    year = item["年份"] or "[年份缺失]"
    doi = item["DOI"] or item["链接"] or "[链接缺失]"
    return f"{authors}. {title}[J]. {journal}, {year}. DOI/Link: {doi}"


def rewrite_pool(path: Path, rows: list[dict[str, str]]) -> None:
    lines = [
        "# 参考文献候选池",
        "",
        "| 编号 | 所属章节 | 支撑论点 | 检索词 | 候选文献 | 来源链接 / DOI | 核验状态 | 备注 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        lines.append(
            f"| {row['编号']} | {row['所属章节']} | {row['支撑论点']} | {row['检索词']} | {row['候选文献']} | {row['来源链接 / DOI']} | {row['核验状态']} | {row['备注']} |"
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
        num = selected_ids.get(row["编号"])
        cite = f"[{num}]" if num is not None else "[待填写]"
        note = "自动回填编号，正文需人工复核"
        lines.append(f"| {row['所属章节']} / {row['支撑论点']} | {row['支撑论点']} | {cite} | {note} |")
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
        if row["编号"] not in selected_ids:
            continue
        marker = "{{" + row["编号"] + "}}"
        cite = f"[{selected_ids[row['编号']]}]"
        count = text.count(marker)
        if count:
            text = text.replace(marker, cite)
            replaced += count

    references = []
    for row in rows:
        num = selected_ids.get(row["编号"])
        if num is None or row["候选文献"] in {"", "[待填写]"}:
            continue
        references.append(f"[{num}] {row['候选文献']}")
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
        num = selected_ids.get(row["编号"])
        cite = f"[{num}]" if num is not None else "-"
        lines.append(f"| {row['编号']} | {cite} | {row['候选文献']} | {row['核验状态']} | {row['备注']} |")
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
        results = search_map.get(row["编号"], [])
        if results and (args.force or row["候选文献"] in {"", "[待填写]"}):
            best = results[0]
            row["候选文献"] = format_reference(best)
            row["来源链接 / DOI"] = best["DOI"] or best["链接"] or "[待填写]"
            row["核验状态"] = "待人工复核"
            note = row["备注"] if row["备注"] not in {"", "[待填写]"} else ""
            auto_note = f"自动回填自{best['来源']}"
            row["备注"] = "；".join(part for part in [note, auto_note] if part) or auto_note
        if row["候选文献"] not in {"", "[待填写]"}:
            selected_ids[row["编号"]] = number
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
