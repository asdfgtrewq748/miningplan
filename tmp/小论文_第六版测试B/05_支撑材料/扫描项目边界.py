from __future__ import annotations

import argparse
from pathlib import Path


IGNORE_DIRS = {".git", ".idea", ".vscode", "__pycache__", "node_modules", ".venv", "venv", "dist", "build"}
MARKER_FILES = [
    "package.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "requirements.txt",
    "pyproject.toml",
    "Dockerfile",
    "vite.config.ts",
    "vite.config.js",
]

DIR_HINTS = {
    "frontend": "前端候选",
    "web": "前端候选",
    "client": "前端候选",
    "backend": "后端候选",
    "server": "后端候选",
    "api": "接口候选",
    "service": "服务候选",
    "legacy": "历史遗留",
    "old": "历史遗留",
    "demo": "演示或样例",
    "docs": "文档",
    "scripts": "脚本",
    "snapshot": "快照",
}


def classify_dir(path: Path) -> str:
    name = path.name.lower()
    for key, label in DIR_HINTS.items():
        if key in name:
            return label
    return "未分类"


def find_markers(path: Path) -> list[str]:
    return [name for name in MARKER_FILES if (path / name).exists()]


def scan_project(project_root: Path) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for child in sorted(project_root.iterdir()):
        if not child.is_dir() or child.name in IGNORE_DIRS:
            continue
        rows.append((child.name, classify_dir(child), ", ".join(find_markers(child)) or "-"))
    return rows


def generate_note(project_root: Path, output_path: Path) -> None:
    rows = scan_project(project_root)
    current_candidates: list[str] = []
    legacy_candidates: list[str] = []

    for name, _, _ in rows:
        lowered = name.lower()
        if any(tag in lowered for tag in ["legacy", "old"]):
            legacy_candidates.append(name)
        elif any(tag in lowered for tag in ["frontend", "backend", "server", "api"]):
            current_candidates.append(name)

    lines = [
        "# 新旧系统区分说明",
        "",
        "## 目录扫描概览",
        "",
        "| 目录 | 判定 | 标记文件 |",
        "|---|---|---|",
    ]
    for name, label, markers in rows:
        lines.append(f"| {name} | {label} | {markers} |")

    lines.extend(
        [
            "",
            "## 自动初判",
            "",
            f"- 当前系统候选：`{', '.join(current_candidates) if current_candidates else '[待人工确认]'}`",
            f"- 历史系统候选：`{', '.join(legacy_candidates) if legacy_candidates else '[待人工确认]'}`",
            "- 该结果只基于目录结构和标记文件，仍需结合运行入口、线上页面、接口与路由再做复核。",
            "",
            "## 后续动作",
            "",
            "- 运行 `05_支撑材料/巡检论文对象.py` 继续扫描页面标题、路由和部署线索",
            "- 根据运行结果完善 `00_过程文档/系统对象巡检记录.md`",
            "- 最终将结论回写到本文档和主稿",
        ]
    )
    output_path.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="扫描项目目录结构并生成边界初稿。")
    parser.add_argument("--project-root", required=True, help="项目根目录")
    parser.add_argument("--output", required=True, help="输出 Markdown 文件")
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    generate_note(project_root, output_path)
    print(f"已生成：{output_path}")
