from __future__ import annotations

import re
from pathlib import Path


SKIP_FILES = {"投稿格式对照表.md", "作者与基金信息.md", "参考文献候选池.md", "引文映射表.md", "格式模版.md"}


def expand_group(group: str) -> list[int]:
    nums: list[int] = []
    for part in re.split(r"\s*[,，]\s*", group):
        if not part:
            continue
        if re.fullmatch(r"\d+\s*[-–]\s*\d+", part):
            start, end = [int(x) for x in re.split(r"\s*[-–]\s*", part)]
            lo, hi = sorted((start, end))
            nums.extend(range(lo, hi + 1))
        elif part.isdigit():
            nums.append(int(part))
    return nums


def collect_citations(text: str) -> list[int]:
    nums: list[int] = []
    for item in re.findall(r"\[(\d+(?:\s*[-,，]\s*\d+)*)\]", text):
        nums.extend(expand_group(item))
    return nums


def collect_reference_ids(text: str) -> list[int]:
    return [int(x) for x in re.findall(r"^\[(\d+)\]\s", text, flags=re.M)]


if __name__ == "__main__":
    base = Path(__file__).resolve().parents[1]
    manuscript_dir = base / "04_论文稿件"
    md_files = sorted(path for path in manuscript_dir.glob("*.md") if path.name not in SKIP_FILES)
    if not md_files:
        raise SystemExit("未找到主论文 Markdown 文件")

    target = md_files[0]
    text = target.read_text(encoding="utf-8")
    cited = sorted(set(collect_citations(text)))
    refs = collect_reference_ids(text)
    ref_set = set(refs)

    missing_refs = [n for n in cited if n not in ref_set]
    uncited_refs = [n for n in refs if n not in cited]

    print(f"主稿：{target.name}")
    print(f"正文引用编号：{cited}")
    print(f"文后文献编号：{refs}")
    print(f"缺失文后条目：{missing_refs}")
    print(f"未被正文引用：{uncited_refs}")
