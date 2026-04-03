from __future__ import annotations

import argparse
from pathlib import Path


SKIP_FILES = {"投稿格式对照表.md", "作者与基金信息.md", "参考文献候选池.md", "引文映射表.md", "格式模版.md"}

DEFAULT_CLAIMS = {
    "引言": ["研究背景与行业现状", "问题定义与研究必要性", "相关方法或系统研究现状"],
    "架构": ["系统对象边界", "总体架构设计依据", "模块划分合理性"],
    "方法": ["关键算法或模型基础", "参数或公式来源", "方法流程的可比研究"],
    "验证": ["评价指标定义", "实验设置依据", "结果对比或可行性验证"],
    "讨论": ["适用范围与局限性", "工程约束或现实条件", "后续优化方向"],
    "结论": ["一般不单独补文献，除非结论引入新的对比论断"],
}


def find_main_markdown(manuscript_dir: Path) -> Path:
    for path in sorted(manuscript_dir.glob("*.md")):
        if path.name not in SKIP_FILES:
            return path
    raise FileNotFoundError("未找到主论文 Markdown 文件")


def collect_sections(md_path: Path) -> list[str]:
    sections: list[str] = []
    for line in md_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            title = stripped[3:].strip()
            if title != "参考文献":
                sections.append(title)
    return sections


def infer_claims(section_title: str) -> list[str]:
    if "引言" in section_title:
        return DEFAULT_CLAIMS["引言"]
    if "架构" in section_title or "边界" in section_title or "系统" in section_title:
        return DEFAULT_CLAIMS["架构"]
    if "方法" in section_title:
        return DEFAULT_CLAIMS["方法"]
    if "结果" in section_title or "验证" in section_title:
        return DEFAULT_CLAIMS["验证"]
    if "讨论" in section_title:
        return DEFAULT_CLAIMS["讨论"]
    if "结论" in section_title:
        return DEFAULT_CLAIMS["结论"]
    return ["该章节中的关键论断需要人工拆分补充"]


def build_ref_pool(sections: list[str]) -> str:
    lines = [
        "# 参考文献候选池",
        "",
        "| 编号 | 所属章节 | 支撑论点 | 检索词 | 候选文献 | 来源链接 / DOI | 核验状态 | 备注 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    idx = 1
    for section in sections:
        for claim in infer_claims(section):
            lines.append(f"| R{idx:02d} | {section} | {claim} | [待填写] | [待填写] | [待填写] | 待核验 | [待填写] |")
            idx += 1
    return "\n".join(lines) + "\n"


def build_citation_map(sections: list[str]) -> str:
    lines = [
        "# 引文映射表",
        "",
        "| 正文位置 | 论断 | 计划引文编号 | 备注 |",
        "|---|---|---|---|",
    ]
    for section in sections:
        claims = infer_claims(section)
        for offset, claim in enumerate(claims, start=1):
            lines.append(f"| {section} 第{offset}个论点 | {claim} | [待填写] | 由候选池核验后回填 |")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="根据主稿章节初始化参考文献候选池和引文映射表。")
    parser.add_argument("--workspace-root", default=str(Path(__file__).resolve().parents[1]), help="论文工作区根目录")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的候选池和引文映射表")
    args = parser.parse_args()

    root = Path(args.workspace_root).resolve()
    manuscript_dir = root / "04_论文稿件"
    md_path = find_main_markdown(manuscript_dir)
    sections = collect_sections(md_path)

    ref_pool_path = manuscript_dir / "参考文献候选池.md"
    citation_map_path = manuscript_dir / "引文映射表.md"

    if args.force or not ref_pool_path.exists():
        ref_pool_path.write_text(build_ref_pool(sections), encoding="utf-8")
    if args.force or not citation_map_path.exists():
        citation_map_path.write_text(build_citation_map(sections), encoding="utf-8")

    print(f"主稿：{md_path.name}")
    print(f"已更新：{ref_pool_path}")
    print(f"已更新：{citation_map_path}")
