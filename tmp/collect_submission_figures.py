from __future__ import annotations

import csv
import re
import shutil
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(r"D:\xiangmu\miningplan")
TARGET = ROOT / "煤科投稿" / "最终图片"
MANIFEST = ROOT / "煤科投稿" / "00_过程文档" / "全部导出图片分类清单.csv"
README = ROOT / "煤科投稿" / "最终图片" / "图片目录说明.md"

FIG_EXTS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".svg", ".webp", ".pdf"}

CURRENT_DOCX = ROOT / "煤科投稿" / "最新版论文4.16_插图版_煤科格式项目图修正版.docx"

SCENE_NAMES = {
    "00_surface_subsidence": "00_地表下沉",
    "01_aquifer_pre_eval": "01_含水层扰动预评价",
    "02_aquifer_eval": "02_含水层扰动评价",
    "03_mining_planning": "03_采区规划案例",
    "04_cocontrol_water_inrush": "04_协同调控_突水点",
    "05_mining_succession": "05_采掘接续",
    "06_full_overburden": "06_全覆岩扰动",
}

SUBDIR_NAMES = {
    "aquifer": "含水层扰动图",
    "economics": "工程经济图",
    "overview": "规划概览图",
    "succession": "采掘接续图",
    "full": "全覆岩综合图",
    "surface": "地表下沉图",
    "paper_main_figures": "论文主图",
}

DATA_PREFIX = {
    "00_surface": "00_地表下沉",
    "01_aquifer": "01_含水层扰动预评价",
    "02_aquifer": "02_含水层扰动评价",
    "03_aquifer": "03_采区规划案例",
    "04_aquifer": "04_协同调控_突水点",
    "05_aquifer": "05_采掘接续",
    "06_full": "06_全覆岩扰动",
}

FIG_TYPES = {
    "odi_heatmap": "ODI热力图",
    "geology_cloud": "地质参数云图",
    "spatial_map": "空间分布图",
    "odi_histogram": "ODI直方图",
    "odi_level_pie": "ODI分级饼图",
    "param_scatter": "参数散点矩阵",
    "weight_radar": "权重雷达图",
    "error_trend_line1": "误差趋势线图1",
    "error_trend_line2": "误差趋势线图2",
    "error_trend_line3": "误差趋势线图3",
}

SUPP_NAMES = {
    "figS1_correlation_heatmap": "补充图S1_相关性热力图",
    "figS2_measured_vs_predicted": "补充图S2_实测与预测对比图",
    "figS3_cross_case_comparison": "补充图S3_跨案例对比图",
    "figS4_sensitivity_analysis": "补充图S4_敏感性分析图",
}

FIG_REVIEW_NAMES = {
    "fig1_journal_v2": "图1_期刊版重绘_v2",
    "fig1_sci_redesign": "图1_SCI重构版",
}

SCENE_FIG_NAMES = {
    "fig01_odi_distribution": "图01_ODI分布图",
    "fig02_geology_clouds": "图02_地质参数云图",
    "fig03_spatial_map": "图03_空间分布图",
    "fig04_odi_histogram": "图04_ODI频率分布图",
    "fig05_odi_levels": "图05_ODI分级占比图",
    "fig06_weight_radar": "图06_权重雷达图",
    "fig07_error_trend_1": "图07_误差趋势图1",
    "fig08_error_trend_2": "图08_误差趋势图2",
    "fig09_error_trend_3": "图09_误差趋势图3",
    "fig01_workface_plan_layout": "图01_工作面规划布局图",
    "fig02_planning_mode_scores": "图02_规划模式评分图",
    "fig03_weighted_top_candidates": "图03_加权优选候选方案图",
    "fig01_cashflow": "图01_现金流分析图",
    "fig02_revenue_cost": "图02_收入成本结构图",
    "fig03_cost_structure": "图03_成本构成图",
    "fig01_monthly_production": "图01_月产量曲线图",
    "fig02_schedule_gantt": "图02_采掘接续甘特图",
    "fig03_stage3_candidate_scores": "图03_接续候选方案评分图",
}

GENERATED_TOPS = [
    "00_论文当前使用图",
    "01_场景可视化导出",
    "02_批量PNG图",
    "03_TIF高分辨率图",
    "04_补充图",
    "05_导出包场景图",
    "06_论文工作区配图",
    "07_图件重绘与审稿图",
    "08_历史论文插图包",
]

CURRENT_FIG_NAMES = [
    "图1_覆岩扰动约束机理示意图",
    "图2_研究区钻孔空间分布图",
    "图3_研究区主要地质参数场分布图",
    "图4_多场景ODI分布结果对比图",
]


def sanitize(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*]+', "_", name)
    name = re.sub(r"\s+", "_", name).strip(" ._")
    return name[:150] if len(name) > 150 else name


def generic_chinese_stem(stem: str) -> str:
    if re.search(r"[\u4e00-\u9fff]", stem):
        return stem
    translated = stem
    replacements = [
        ("odi_distribution", "ODI分布图"),
        ("geology_clouds", "地质参数云图"),
        ("geology_cloud", "地质参数云图"),
        ("spatial_map", "空间分布图"),
        ("odi_histogram", "ODI频率分布图"),
        ("odi_levels", "ODI分级占比图"),
        ("odi_level_pie", "ODI分级饼图"),
        ("weight_radar", "权重雷达图"),
        ("error_trend", "误差趋势图"),
        ("workface_plan_layout", "工作面规划布局图"),
        ("planning_mode_scores", "规划模式评分图"),
        ("weighted_top_candidates", "加权优选候选方案图"),
        ("cashflow", "现金流分析图"),
        ("revenue_cost", "收入成本结构图"),
        ("cost_structure", "成本构成图"),
        ("monthly_production", "月产量曲线图"),
        ("schedule_gantt", "采掘接续甘特图"),
        ("stage3_candidate_scores", "接续候选方案评分图"),
        ("correlation_heatmap", "相关性热力图"),
        ("measured_vs_predicted", "实测与预测对比图"),
        ("cross_case_comparison", "跨案例对比图"),
        ("sensitivity_analysis", "敏感性分析图"),
        ("journal", "期刊版"),
        ("redesign", "重构版"),
        ("sci", "SCI"),
        ("fig", "图"),
        ("figure", "图"),
    ]
    for old, new in replacements:
        translated = translated.replace(old, new)
    translated = translated.replace("-", "_")
    return sanitize(translated)


def reset_generated_dirs() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    target_resolved = TARGET.resolve()
    for name in GENERATED_TOPS:
        path = TARGET / name
        if not path.exists():
            continue
        resolved = path.resolve()
        if resolved.parent != target_resolved:
            raise RuntimeError(f"refusing to remove unexpected path: {resolved}")
        shutil.rmtree(resolved)


def ensure_unique(path: Path) -> Path:
    if not path.exists():
        return path
    stem, suffix = path.stem, path.suffix
    i = 2
    while True:
        candidate = path.with_name(f"{stem}_{i}{suffix}")
        if not candidate.exists():
            return candidate
        i += 1


def copy_file(src: Path, rel_dir: str, chinese_stem: str, rows: list[dict[str, str]]) -> None:
    dest_dir = TARGET / Path(rel_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = ensure_unique(dest_dir / f"{sanitize(chinese_stem)}{src.suffix.lower()}")
    shutil.copy2(src, dest)
    rows.append(
        {
            "分类": rel_dir,
            "中文文件名": dest.name,
            "格式": dest.suffix.lower().lstrip("."),
            "大小字节": str(dest.stat().st_size),
            "来源路径": str(src),
            "目标路径": str(dest),
        }
    )


def stem_for_data_output(src: Path) -> str:
    stem = src.stem
    if stem in SUPP_NAMES:
        return SUPP_NAMES[stem]
    for prefix, cn_prefix in DATA_PREFIX.items():
        if stem.startswith(prefix):
            rest = stem[len(prefix) + 1 :]
            m = re.match(r"fig(\d+[a-z]?)[_-](.+)", rest)
            if m:
                fig_no, fig_type = m.groups()
                return f"{cn_prefix}_图{fig_no}_{FIG_TYPES.get(fig_type, fig_type)}"
            return f"{cn_prefix}_{rest}"
    return sanitize(stem)


def collect_current_docx(rows: list[dict[str, str]]) -> None:
    if not CURRENT_DOCX.exists():
        return
    ns = {
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    }
    with zipfile.ZipFile(CURRENT_DOCX) as zf:
        doc = ET.fromstring(zf.read("word/document.xml"))
        rels = ET.fromstring(zf.read("word/_rels/document.xml.rels"))
        relmap = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
        ids: list[str] = []
        for element in doc.findall(".//a:blip", ns):
            rid = element.attrib.get(f"{{{ns['r']}}}embed")
            if rid and rid not in ids:
                ids.append(rid)
        out = TARGET / "00_论文当前使用图"
        out.mkdir(parents=True, exist_ok=True)
        for idx, rid in enumerate(ids):
            target = relmap[rid]
            media_path = f"word/{target}" if not target.startswith("word/") else target
            suffix = Path(media_path).suffix or ".png"
            name = CURRENT_FIG_NAMES[idx] if idx < len(CURRENT_FIG_NAMES) else f"图{idx + 1}_论文当前使用图"
            dest = ensure_unique(out / f"{name}{suffix.lower()}")
            dest.write_bytes(zf.read(media_path))
            rows.append(
                {
                    "分类": "00_论文当前使用图",
                    "中文文件名": dest.name,
                    "格式": dest.suffix.lower().lstrip("."),
                    "大小字节": str(dest.stat().st_size),
                    "来源路径": f"{CURRENT_DOCX}!/{media_path}",
                    "目标路径": str(dest),
                }
            )


def collect_scene_exports(rows: list[dict[str, str]]) -> None:
    root = ROOT / "output" / "scene_visual_exports"
    if not root.exists():
        return
    for timestamp_dir in sorted([p for p in root.iterdir() if p.is_dir()]):
        for src in sorted(timestamp_dir.rglob("*")):
            if not src.is_file() or src.suffix.lower() not in FIG_EXTS:
                continue
            rel = src.relative_to(timestamp_dir)
            parts = list(rel.parts)
            scene = SCENE_NAMES.get(parts[0], parts[0]) if parts else "未分类场景"
            sub = SUBDIR_NAMES.get(parts[1], parts[1]) if len(parts) > 2 else "场景根目录图"
            rel_dir = str(Path("01_场景可视化导出") / timestamp_dir.name / scene / sub)
            copy_file(src, rel_dir, SCENE_FIG_NAMES.get(src.stem, generic_chinese_stem(src.stem)), rows)


def collect_data_output(rows: list[dict[str, str]]) -> None:
    all_png = ROOT / "data" / "output" / "all_png"
    if all_png.exists():
        for src in sorted(all_png.iterdir()):
            if src.is_file() and src.suffix.lower() in FIG_EXTS:
                copy_file(src, "02_批量PNG图", stem_for_data_output(src), rows)

    tif_dir = ROOT / "data" / "output" / "tif_figures"
    if tif_dir.exists():
        for src in sorted(tif_dir.iterdir()):
            if src.is_file() and src.suffix.lower() in FIG_EXTS:
                copy_file(src, "03_TIF高分辨率图", stem_for_data_output(src), rows)

    supp = ROOT / "data" / "output" / "supplementary_figures"
    if supp.exists():
        for src in sorted(supp.iterdir()):
            if src.is_file() and src.suffix.lower() in FIG_EXTS:
                copy_file(src, "04_补充图", SUPP_NAMES.get(src.stem, src.stem), rows)


def collect_export_package(rows: list[dict[str, str]]) -> None:
    root = ROOT / "data" / "export_package"
    if not root.exists():
        return
    for src in sorted(root.rglob("*")):
        if not src.is_file() or src.suffix.lower() not in FIG_EXTS:
            continue
        rel = src.relative_to(root)
        package = rel.parts[0].replace(".miningplan", "")
        package = sanitize(package.replace("-", "_"))
        rel_dir = str(Path("05_导出包场景图") / package / Path(*rel.parts[1:-1]))
        copy_file(src, rel_dir, src.stem, rows)


def collect_paper_workspace(rows: list[dict[str, str]]) -> None:
    root = ROOT / "论文" / "重构工作区" / "01_可视化图汇总"
    if not root.exists():
        return
    for src in sorted(root.rglob("*")):
        if not src.is_file() or src.suffix.lower() not in FIG_EXTS:
            continue
        rel = src.relative_to(root)
        rel_dir = str(Path("06_论文工作区配图") / Path(*rel.parts[:-1]))
        copy_file(src, rel_dir, src.stem, rows)


def collect_fig_review(rows: list[dict[str, str]]) -> None:
    root = ROOT / "output" / "fig_review"
    if not root.exists():
        return
    for src in sorted(root.iterdir()):
        if src.is_file() and src.suffix.lower() in FIG_EXTS:
            copy_file(src, "07_图件重绘与审稿图", FIG_REVIEW_NAMES.get(src.stem, src.stem), rows)


def collect_paper_insert_packages(rows: list[dict[str, str]]) -> None:
    root = ROOT / "output" / "paper_insert_package"
    if not root.exists():
        return
    for src in sorted(root.rglob("*")):
        if not src.is_file() or src.suffix.lower() not in FIG_EXTS:
            continue
        rel = src.relative_to(root)
        parts = list(rel.parts)
        timestamp = parts[0] if parts else "未命名批次"
        subparts = [SUBDIR_NAMES.get(p, p) for p in parts[1:-1]]
        rel_dir = str(Path("08_历史论文插图包") / timestamp / Path(*subparts))
        copy_file(src, rel_dir, src.stem, rows)


def write_manifest(rows: list[dict[str, str]]) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["分类", "中文文件名", "格式", "大小字节", "来源路径", "目标路径"])
        writer.writeheader()
        writer.writerows(rows)

    counts: dict[str, int] = {}
    for row in rows:
        top = row["分类"].split("\\")[0].split("/")[0]
        counts[top] = counts.get(top, 0) + 1

    lines = [
        "# 图片目录说明",
        "",
        "本目录汇总项目中明确属于论文或项目导出的图件，已排除前端依赖、缓存和临时运行文件。",
        "",
        "## 分类统计",
        "",
    ]
    for key in sorted(counts):
        lines.append(f"- {key}：{counts[key]} 个文件")
    lines.extend(
        [
            "",
            "## 说明",
            "",
            "- 图件格式包含 PNG、SVG、PDF、TIF 等已导出的投稿或制图格式。",
            "- `00_论文当前使用图` 为当前 DOCX 正文实际引用的图。",
            "- `08_历史论文插图包` 保留不同时间批次的历史插图包，后续正文选图时需要再筛选。",
            "- 完整来源与目标路径见 `00_过程文档/全部导出图片分类清单.csv`。",
            "",
        ]
    )
    README.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    reset_generated_dirs()
    rows: list[dict[str, str]] = []
    collect_current_docx(rows)
    collect_scene_exports(rows)
    collect_data_output(rows)
    collect_export_package(rows)
    collect_paper_workspace(rows)
    collect_fig_review(rows)
    collect_paper_insert_packages(rows)
    write_manifest(rows)
    print(f"copied={len(rows)}")
    print(f"target={TARGET}")
    print(f"manifest={MANIFEST}")


if __name__ == "__main__":
    main()
