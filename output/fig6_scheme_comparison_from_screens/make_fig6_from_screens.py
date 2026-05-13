from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
import numpy as np
from PIL import Image, ImageFilter


WORKSPACE = Path(__file__).resolve().parents[2]
OUT_DIR = Path(__file__).resolve().parent

SCREEN_DIR = WORKSPACE / "煤科投稿" / "论文图片包"

PANELS = [
    ("6.20.png", "（a）工程效率优先方案"),
    ("6.21.png", "（b）资源回收优先方案"),
    ("6.22.png", "（c）低扰动优先方案"),
    ("6.23.png", "（d）综合权重调节方案"),
]

# Crop the central map viewport only. Coordinates are in the original screenshot
# pixels and intentionally exclude sidebars, parameter panels, candidate tables,
# and bottom toolbar controls.
MAP_CROP = (190, 88, 680, 370)


def setup_fonts() -> None:
    for font_path in [
        Path(r"C:\Windows\Fonts\simsun.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path(r"C:\Windows\Fonts\times.ttf"),
    ]:
        if font_path.exists():
            try:
                matplotlib.font_manager.fontManager.addfont(str(font_path))
            except Exception:
                pass
    plt.rcParams.update(
        {
            "font.family": ["SimSun", "Times New Roman", "DejaVu Sans"],
            "axes.unicode_minus": False,
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
            "svg.fonttype": "none",
            "savefig.dpi": 600,
        }
    )


def load_map_crop(filename: str) -> Image.Image:
    image = Image.open(SCREEN_DIR / filename).convert("RGB")
    return clean_annotation_marks(image.crop(MAP_CROP))


def clean_annotation_marks(crop: Image.Image) -> Image.Image:
    """Remove red callout arrows and left-side black explanatory callouts."""
    arr = np.asarray(crop).copy()
    h, w, _ = arr.shape
    saturated_red = (arr[:, :, 0] > 150) & (arr[:, :, 1] < 105) & (arr[:, :, 2] < 105)

    yy, xx = np.mgrid[0:h, 0:w]
    red_callout_region = ((xx > w - 95) & (yy > h - 90)) | ((xx < 250) & (yy < 45))
    red_mask = saturated_red & red_callout_region

    left_callout_region = (xx < 135) & (yy > 45) & (yy < 200)
    dark_mask = (arr[:, :, 0] < 85) & (arr[:, :, 1] < 85) & (arr[:, :, 2] < 85) & left_callout_region

    mask = Image.fromarray(((red_mask | dark_mask) * 255).astype("uint8"))
    mask = mask.filter(ImageFilter.MaxFilter(5))
    smooth = crop.filter(ImageFilter.MedianFilter(13))
    cleaned = crop.copy()
    cleaned.paste(smooth, mask=mask)
    return cleaned


def main() -> None:
    setup_fonts()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    crops = [load_map_crop(name) for name, _ in PANELS]
    width = min(crop.width for crop in crops)
    height = min(crop.height for crop in crops)
    crops = [crop.resize((width, height), Image.Resampling.LANCZOS) for crop in crops]

    fig, axes = plt.subplots(2, 2, figsize=(7.2, 5.85))
    for ax, crop, (_, title) in zip(axes.ravel(), crops, PANELS):
        ax.imshow(crop)
        ax.set_axis_off()
        ax.text(
            0.018,
            0.965,
            title,
            transform=ax.transAxes,
            ha="left",
            va="top",
            fontsize=7.6,
            fontweight="bold",
            bbox={"boxstyle": "round,pad=0.18", "fc": "white", "ec": "none", "alpha": 0.82},
        )

    legend_handles = [
        Line2D([0], [0], color="#3578ff", lw=1.4, label="工作面 / 区段煤柱"),
        Line2D([0], [0], color="#3578ff", lw=1.4, linestyle=(0, (3, 2)), label="有效布置域"),
        Line2D([0], [0], marker="o", color="none", markerfacecolor="black", markersize=4.5, label="钻孔位置"),
    ]
    fig.legend(
        handles=legend_handles,
        loc="lower center",
        ncol=3,
        frameon=False,
        bbox_to_anchor=(0.5, 0.018),
        handlelength=2.8,
        columnspacing=1.8,
        fontsize=7.8,
    )
    fig.suptitle(
        "图6 不同目标偏好下的采区规划方案对比\n"
        "Fig.6 Comparison of mining district planning schemes under different objective preferences",
        y=0.982,
        fontsize=8.8,
        fontweight="bold",
    )
    fig.subplots_adjust(left=0.035, right=0.985, bottom=0.095, top=0.90, wspace=0.055, hspace=0.12)

    base = OUT_DIR / "fig6_scheme_comparison_from_screens"
    fig.savefig(base.with_suffix(".png"), dpi=600, facecolor="white")
    fig.savefig(base.with_suffix(".pdf"), facecolor="white")
    fig.savefig(base.with_suffix(".svg"), facecolor="white")
    plt.close(fig)

    note = {
        "source_images": [(SCREEN_DIR / name).as_posix() for name, _ in PANELS],
        "crop_pixels": MAP_CROP,
        "source_project_candidates_checked": [
            (WORKSPACE / "mining-plan/frontend/public/demo/3-采区规划案例.miningplan.json").as_posix(),
            (WORKSPACE / "mining-plan/frontend/public/demo/5-采掘接续.miningplan.json").as_posix(),
        ],
        "note": (
            "This figure is composed from the four user-provided system screenshots because "
            "some selected rows shown in the screenshots do not exactly match the saved "
            "candidate tables in the current project JSON files."
        ),
    }
    import json

    (OUT_DIR / "fig6_scheme_comparison_from_screens_metadata.json").write_text(
        json.dumps(note, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(base)


if __name__ == "__main__":
    main()
