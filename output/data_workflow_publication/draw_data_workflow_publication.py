from __future__ import annotations

from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Rectangle


OUT = Path(__file__).resolve().parent
FONT = FontProperties(fname=r"C:\Windows\Fonts\msyh.ttc")
FONT_BOLD = FontProperties(fname=r"C:\Windows\Fonts\msyhbd.ttc")

mpl.rcParams["font.family"] = "sans-serif"
mpl.rcParams["pdf.fonttype"] = 42
mpl.rcParams["ps.fonttype"] = 42
mpl.rcParams["svg.fonttype"] = "none"
mpl.rcParams["axes.unicode_minus"] = False

COLORS = {
    "ink": "#1B2A34",
    "text": "#344955",
    "muted": "#6F7F88",
    "line": "#8AA1AE",
    "panel": "#F7FAFB",
    "edge": "#D6E1E7",
    "white": "#FFFFFF",
    "source": "#4E79A7",
    "class": "#59A14F",
    "process": "#76B7B2",
    "output": "#F28E2B",
    "apply": "#E15759",
    "odi": "#D55E00",
}


def rounded(ax, x, y, w, h, fc, ec, lw=1.0, r=0.12, z=2):
    patch = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle=f"round,pad=0.018,rounding_size={r}",
        facecolor=fc,
        edgecolor=ec,
        linewidth=lw,
        zorder=z,
    )
    ax.add_patch(patch)
    return patch


def arrow(ax, start, end, color=None, lw=1.15, scale=10, z=5):
    ax.add_patch(
        FancyArrowPatch(
            start,
            end,
            arrowstyle="-|>",
            mutation_scale=scale,
            linewidth=lw,
            color=color or COLORS["line"],
            shrinkA=0,
            shrinkB=0,
            zorder=z,
        )
    )


def node(ax, x, y, w, h, label, accent, *, fs=8.1, bold=False, edge=None, fill=None):
    rounded(ax, x, y, w, h, fill or COLORS["white"], edge or accent, lw=1.05, r=0.10)
    ax.add_patch(Rectangle((x, y), 0.045, h, facecolor=accent, edgecolor="none", zorder=3))
    ax.text(
        x + w / 2 + 0.02,
        y + h / 2,
        label,
        ha="center",
        va="center",
        fontproperties=FONT_BOLD if bold else FONT,
        fontsize=fs,
        color=COLORS["ink"],
        zorder=4,
    )


def layer_label(ax, y, h, title, subtitle, accent, idx):
    rounded(ax, 0.30, y, 1.25, h, accent, accent, lw=0, r=0.06, z=2)
    ax.text(
        0.925,
        y + h * 0.60,
        title,
        ha="center",
        va="center",
        fontproperties=FONT_BOLD,
        fontsize=8.5,
        color="white",
        zorder=4,
    )
    ax.text(
        0.925,
        y + h * 0.30,
        subtitle,
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=5.4,
        color="#EAF2F5",
        zorder=4,
    )
    ax.text(
        0.42,
        y + h - 0.11,
        idx,
        ha="left",
        va="top",
        fontproperties=FONT_BOLD,
        fontsize=6.2,
        color="white",
        zorder=4,
    )


def row_panel(ax, y, h):
    rounded(ax, 1.85, y, 9.65, h, COLORS["panel"], COLORS["edge"], lw=0.8, r=0.10, z=1)


def draw(include_title: bool = True, suffix: str = ""):
    fig, ax = plt.subplots(figsize=(7.25, 5.20), dpi=300)
    fig.patch.set_facecolor("white")
    ax.set_xlim(0, 11.8)
    ax.set_ylim(0, 8.4)
    ax.axis("off")

    rows = [
        (6.82, 1.08, "数据来源层", "Source", COLORS["source"], "L1"),
        (5.44, 1.08, "数据分类层", "Classification", COLORS["class"], "L2"),
        (3.78, 1.36, "空间处理层", "Geoprocessing", COLORS["process"], "L3"),
        (2.28, 1.08, "图层输出层", "Layer output", COLORS["output"], "L4"),
        (0.88, 1.08, "规划应用层", "Planning", COLORS["apply"], "L5"),
    ]
    for y, h, title, subtitle, accent, idx in rows:
        row_panel(ax, y, h)
        layer_label(ax, y, h, title, subtitle, accent, idx)

    # L1: source data
    x0, gap, w, h = 2.10, 0.16, 1.72, 0.55
    l1 = ["矿井地质资料", "采区设计图件", "钻孔资料", "覆岩扰动评价结果", "工作面规划参数"]
    for i, label in enumerate(l1):
        node(ax, x0 + i * (w + gap), 7.085, w, h, label, COLORS["source"], fs=7.0)

    # L2: categorized data
    x0, gap, w, h = 2.25, 0.25, 2.05, 0.58
    l2 = ["基础地质数据", "工程约束数据", "覆岩扰动数据", "规划参数数据"]
    for i, label in enumerate(l2):
        node(ax, x0 + i * (w + gap), 5.70, w, h, label, COLORS["class"], fs=7.8)

    # L3: spatial processing chain
    x0, gap, w, h = 2.12, 0.10, 1.42, 0.53
    l3 = ["坐标统一", "格式转换", "边界裁剪", "插值计算", "指标归一化", "图层叠加"]
    for i, label in enumerate(l3):
        node(ax, x0 + i * (w + gap), 4.315, w, h, label, COLORS["process"], fs=7.3)
        if i < len(l3) - 1:
            x_end = x0 + i * (w + gap) + w + 0.015
            arrow(ax, (x_end, 4.58), (x_end + gap - 0.03, 4.58), COLORS["process"], lw=0.95, scale=7)

    ax.text(
        2.14,
        3.98,
        "统一空间参考、数据尺度和指标量纲后进行叠加分析",
        ha="left",
        va="center",
        fontproperties=FONT,
        fontsize=6.45,
        color=COLORS["muted"],
    )

    # L4: output layers
    x0, gap, w, h = 2.25, 0.25, 2.05, 0.58
    l4 = [
        ("有效布置域图层", COLORS["output"]),
        ("煤厚资源图层", COLORS["output"]),
        ("ODI扰动图层", COLORS["odi"]),
        ("候选方案图层", COLORS["output"]),
    ]
    for i, (label, accent) in enumerate(l4):
        node(ax, x0 + i * (w + gap), 2.54, w, h, label, accent, fs=7.7, bold=(label.startswith("ODI")))

    # L5: planning applications
    x0, gap, w, h = 2.25, 0.25, 2.05, 0.58
    l5 = ["方案生成", "约束筛选", "指标统计", "方案比选"]
    for i, label in enumerate(l5):
        node(ax, x0 + i * (w + gap), 1.14, w, h, label, COLORS["apply"], fs=7.9, bold=True)

    # Downstream arrows between layers.
    centers = [7.085, 5.70, 4.315, 2.54, 1.14]
    row_x = 6.65
    arrows = [
        ((row_x, 6.82), (row_x, 6.35)),
        ((row_x, 5.44), (row_x, 5.10)),
        ((row_x, 3.78), (row_x, 3.37)),
        ((row_x, 2.28), (row_x, 1.90)),
    ]
    for start, end in arrows:
        arrow(ax, start, end, COLORS["line"], lw=1.15, scale=11)

    # Subtle many-to-one guide lines from categorized datasets to geoprocessing.
    for x in [3.275, 5.575, 7.875, 10.175]:
        ax.plot([x, x, 6.65], [5.44, 5.21, 5.10], color="#C6D3DA", lw=0.65, zorder=1)
    ax.plot([2.5, 10.3], [6.80, 6.80], color="#DDE7EC", lw=0.65, zorder=1)

    if include_title:
        ax.text(
            1.86,
            8.12,
            "多源矿山数据驱动的工作面布置规划数据处理流程",
            ha="left",
            va="center",
            fontproperties=FONT_BOLD,
            fontsize=9.8,
            color=COLORS["ink"],
        )
    ax.text(
        11.47,
        0.28,
        "ODI, overburden disturbance index",
        ha="right",
        va="center",
        fontproperties=FONT,
        fontsize=5.7,
        color=COLORS["muted"],
    )

    OUT.mkdir(parents=True, exist_ok=True)
    stem = OUT / f"data_workflow_publication{suffix}"
    fig.savefig(stem.with_suffix(".svg"), bbox_inches="tight", pad_inches=0.04)
    fig.savefig(stem.with_suffix(".pdf"), bbox_inches="tight", pad_inches=0.04)
    fig.savefig(stem.with_suffix(".png"), dpi=900, bbox_inches="tight", pad_inches=0.04)
    plt.close(fig)


if __name__ == "__main__":
    draw(include_title=True, suffix="")
    draw(include_title=False, suffix="_notitle")
