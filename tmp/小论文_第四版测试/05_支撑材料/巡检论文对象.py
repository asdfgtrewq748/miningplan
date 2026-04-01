from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


IGNORE_DIRS = {
    ".git",
    ".idea",
    ".vscode",
    "__pycache__",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    ".next",
    ".nuxt",
}

TEXT_SUFFIXES = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".vue",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".md",
    ".html",
    ".css",
    ".scss",
    ".env",
    ".txt",
}

TITLE_PATTERNS = [
    re.compile(r"<title>(.*?)</title>", re.I | re.S),
    re.compile(r"title\s*:\s*['\"]([^'\"]+)['\"]"),
    re.compile(r'"title"\s*:\s*"([^"]+)"'),
]

ROUTE_PATTERNS = [
    re.compile(r"path\s*:\s*['\"]([^'\"]+)['\"]"),
    re.compile(r"@(?:app|router)\.(?:get|post|put|delete|patch)\(['\"]([^'\"]+)['\"]"),
    re.compile(r"(?:app|router)\.(?:get|post|put|delete|patch|use)\(['\"]([^'\"]+)['\"]"),
    re.compile(r"add_api_route\(['\"]([^'\"]+)['\"]"),
]

URL_PATTERN = re.compile(r"https?://[^\s'\"<>()]+")


def relative_depth(root: Path, path: Path) -> int:
    return max(0, len(path.relative_to(root).parts) - 1)


def should_skip(path: Path) -> bool:
    return any(part in IGNORE_DIRS for part in path.parts)


def iter_text_files(root: Path, max_depth: int, max_files: int) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if len(files) >= max_files:
            break
        if not path.is_file():
            continue
        if should_skip(path):
            continue
        if relative_depth(root, path) > max_depth:
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            if path.stat().st_size > 512 * 1024:
                continue
        except OSError:
            continue
        files.append(path)
    return files


def safe_read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            return path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError:
            return path.read_text(encoding="gb18030", errors="ignore")


def classify_top_dirs(root: Path) -> tuple[list[str], list[str]]:
    current: list[str] = []
    legacy: list[str] = []
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name in IGNORE_DIRS:
            continue
        lowered = child.name.lower()
        if any(tag in lowered for tag in ["legacy", "old", "archive", "snapshot"]):
            legacy.append(child.name)
        elif any(tag in lowered for tag in ["frontend", "backend", "server", "api", "web", "client"]):
            current.append(child.name)
    return current, legacy


def collect_titles(files: list[Path], root: Path) -> list[tuple[str, str]]:
    results: list[tuple[str, str]] = []
    for path in files:
        text = safe_read(path)
        title = None
        for pattern in TITLE_PATTERNS:
            match = pattern.search(text)
            if match:
                title = re.sub(r"\s+", " ", match.group(1)).strip()
                break
        if not title and path.name.lower() == "readme.md":
            first_heading = re.search(r"^#\s+(.+)$", text, flags=re.M)
            if first_heading:
                title = first_heading.group(1).strip()
        if title:
            rel = str(path.relative_to(root)).replace("\\", "/")
            results.append((rel, title))
    unique: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in results:
        if item not in seen:
            unique.append(item)
            seen.add(item)
    return unique[:20]


def collect_urls(files: list[Path], root: Path) -> list[tuple[str, str]]:
    results: list[tuple[str, str]] = []
    for path in files:
        text = safe_read(path)
        for url in URL_PATTERN.findall(text):
            rel = str(path.relative_to(root)).replace("\\", "/")
            results.append((rel, url.rstrip(".,);")))
    unique: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in results:
        if item not in seen:
            unique.append(item)
            seen.add(item)
    return unique[:30]


def collect_routes(files: list[Path], root: Path) -> list[tuple[str, str]]:
    results: list[tuple[str, str]] = []
    for path in files:
        text = safe_read(path)
        for pattern in ROUTE_PATTERNS:
            for match in pattern.findall(text):
                route = match.strip()
                if route:
                    rel = str(path.relative_to(root)).replace("\\", "/")
                    results.append((rel, route))
    unique: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in results:
        if item not in seen:
            unique.append(item)
            seen.add(item)
    return unique[:30]


def detect_entry_files(files: list[Path], root: Path) -> list[str]:
    names = {"main.py", "app.py", "server.py", "index.html", "index.tsx", "main.ts", "main.tsx", "App.vue"}
    results: list[str] = []
    for path in files:
        if path.name in names:
            results.append(str(path.relative_to(root)).replace("\\", "/"))
    return results[:20]


def write_markdown(
    output: Path,
    current: list[str],
    legacy: list[str],
    entry_files: list[str],
    titles: list[tuple[str, str]],
    urls: list[tuple[str, str]],
    routes: list[tuple[str, str]],
) -> None:
    lines = [
        "# 系统对象巡检记录",
        "",
        "## 自动判定概览",
        "",
        f"- 当前系统候选：`{', '.join(current) if current else '[待人工确认]'}`",
        f"- 旧系统候选：`{', '.join(legacy) if legacy else '[待人工确认]'}`",
        f"- 入口文件线索：`{', '.join(entry_files) if entry_files else '[未识别]'}`",
        "",
        "## 页面或产品标题线索",
        "",
        "| 文件 | 识别内容 |",
        "|---|---|",
    ]

    if titles:
        for rel, title in titles:
            lines.append(f"| {rel} | {title} |")
    else:
        lines.append("| - | 未识别到明确标题线索 |")

    lines.extend(
        [
            "",
            "## 部署与线上线索",
            "",
            "| 文件 | URL |",
            "|---|---|",
        ]
    )
    if urls:
        for rel, url in urls:
            lines.append(f"| {rel} | {url} |")
    else:
        lines.append("| - | 未识别到明确部署地址 |")

    lines.extend(
        [
            "",
            "## 路由与接口线索",
            "",
            "| 文件 | 路由 / 接口 |",
            "|---|---|",
        ]
    )
    if routes:
        for rel, route in routes:
            lines.append(f"| {rel} | {route} |")
    else:
        lines.append("| - | 未识别到显式路由 |")

    lines.extend(
        [
            "",
            "## 人工复核建议",
            "",
            "- 结合 `新旧系统区分说明.md` 明确论文主叙事对象。",
            "- 若存在线上地址，继续核对线上页面标题、功能模块与本地入口文件是否一致。",
            "- 若多个系统并存，以当前可运行、可验证、证据最完整者作为论文对象。",
        ]
    )
    output.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="巡检项目中的论文对象线索。")
    parser.add_argument("--project-root", required=True, help="项目根目录")
    parser.add_argument("--output", required=True, help="输出 Markdown 文件")
    parser.add_argument("--max-depth", type=int, default=4, help="扫描的最大相对深度")
    parser.add_argument("--max-files", type=int, default=600, help="最多扫描的文本文件数")
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    files = iter_text_files(root, max_depth=args.max_depth, max_files=args.max_files)
    current, legacy = classify_top_dirs(root)
    entry_files = detect_entry_files(files, root)
    titles = collect_titles(files, root)
    urls = collect_urls(files, root)
    routes = collect_routes(files, root)
    write_markdown(output, current, legacy, entry_files, titles, urls, routes)
    print(f"已生成：{output}")
