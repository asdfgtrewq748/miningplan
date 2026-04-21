from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "煤科投稿" / "最终图片" / "14_4.20正文图_按源文件改字体字号PNG"


# All paths below are the located generation outputs behind the figures now used
# in the manuscript. The source scripts are patched separately:
# - export_scene_visuals.py + paper_figure_workflow.py: manuscript main maps.
# - figures_for_paper_additions/generate_figures.py: boundary/workflow/statistics figures.
# - tmp/docs/draw_abc_layout_comparison_20260419.py: A/B/C layout overlay.
FIGURES: list[tuple[str, Path, bool]] = [
    ("fig01_ODI风险约束逻辑示意图.png", ROOT / "煤科投稿" / "最终图片" / "图1_覆岩扰动约束机理示意图.png", True),
    ("fig02_原始边界到有效布置域的约束处理过程.png", ROOT / "figures_for_paper_additions" / "Fig06_boundary_to_effective_domain.png", False),
    ("fig03_研究区钻孔空间分布图.png", ROOT / "output" / "paper420_font_source_regen" / "paper_main_figures" / "02-研究区钻孔空间分布图.png", False),
    ("fig04_钻孔样本到煤层厚度连续参数场的构建流程.png", ROOT / "figures_for_paper_additions" / "Fig07_continuous_parameter_field_workflow.png", False),
    ("fig05_研究区主要地质参数场分布图.png", ROOT / "output" / "paper420_font_source_regen" / "paper_main_figures" / "03-研究区主要地质参数场分布图.png", False),
    ("fig06_多场景ODI三类风险分量分布图.png", ROOT / "figures_for_paper_additions" / "Fig08_odi_component_fields.png", False),
    ("fig07_多场景ODI分布结果对比图.png", ROOT / "output" / "paper420_font_source_regen" / "paper_main_figures" / "04-多场景ODI分布结果对比图.png", False),
    ("fig08_A_B_C候选方案多指标对比图.png", ROOT / "figures_for_paper_additions" / "Fig10_abc_multi_indicator_comparison.png", False),
    ("fig09_A_B_C候选方案工作面布局与ODI高值区叠置对比图.png", ROOT / "煤科投稿" / "最终图片" / "10_论文图件精修版" / "图5_ABC三方案布局对比图_精修.png", False),
    ("fig10_不同ODI阈值下A_B_C方案超阈值比例敏感性分析.png", ROOT / "figures_for_paper_additions" / "Fig11_threshold_sensitivity.png", False),
    ("fig11_不同权重情景下A_B_C方案风险综合得分敏感性分析.png", ROOT / "figures_for_paper_additions" / "Fig12_weight_sensitivity.png", False),
]


def copy_png(src: Path, dst: Path, raster_only: bool) -> None:
    if raster_only:
        with Image.open(src) as im:
            im = im.convert("RGB")
            im = im.filter(ImageFilter.UnsharpMask(radius=0.9, percent=85, threshold=3))
            im.save(dst, format="PNG", dpi=(600, 600), optimize=True)
    else:
        shutil.copy2(src, dst)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*"):
        if old.is_file():
            old.unlink()
    for name, src, raster_only in FIGURES:
        if not src.exists():
            raise FileNotFoundError(src)
        dst = OUT_DIR / name
        copy_png(src, dst, raster_only)
        with Image.open(dst) as im:
            print(f"{name}\t{im.width}x{im.height}\t源文件={src}")
    print(f"OUT_DIR={OUT_DIR}")


if __name__ == "__main__":
    main()
