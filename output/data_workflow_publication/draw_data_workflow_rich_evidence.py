from __future__ import annotations

from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.font_manager import FontProperties
from matplotlib.patches import FancyArrowPatch, Polygon, Rectangle
from scipy.interpolate import griddata


ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
FONT = FontProperties(fname=r"C:\Windows\Fonts\simsun.ttc")
FONT_BOLD = FontProperties(fname=r"C:\Windows\Fonts\simhei.ttf")

mpl.rcParams["pdf.fonttype"] = 42
mpl.rcParams["ps.fonttype"] = 42
mpl.rcParams["svg.fonttype"] = "none"
mpl.rcParams["axes.unicode_minus"] = False

INK = "#222222"
MUTED = "#666666"
GRID = "#B9C7D8"
BLUE = "#2F5F8F"
GREEN = "#4F7F52"
TEAL = "#4F8E8A"
ORANGE = "#B96B21"
RED = "#A74B4B"
ODI = "#A84600"
FILL = "#FBFCFD"


def cn(ax, x, y, text, size=7, bold=False, color=INK, ha="center", va="center", **kwargs):
    ax.text(
        x,
        y,
        text,
        fontsize=size,
        fontproperties=FONT_BOLD if bold else FONT,
        color=color,
        ha=ha,
        va=va,
        **kwargs,
    )


def clean_axis(ax):
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)


def dashed_panel(ax, x, y, w, h, title, accent):
    ax.add_patch(
        Rectangle(
            (x, y),
            w,
            h,
            facecolor=FILL,
            edgecolor=accent,
            linewidth=0.75,
            linestyle=(0, (3, 2)),
        )
    )
    cn(ax, x + w / 2, y + h - 0.018, title, size=6.4, bold=False)


def small_box(ax, x, y, w, h, label, edge=BLUE, fs=6.1, bold=False, fill="#FFFFFF"):
    ax.add_patch(Rectangle((x, y), w, h, facecolor=fill, edgecolor=edge, linewidth=0.75))
    cn(ax, x + w / 2, y + h / 2, label, size=fs, bold=bold)


def arrow(ax, start, end, color="#83919A", lw=0.75, scale=8.0):
    ax.add_patch(
        FancyArrowPatch(
            start,
            end,
            arrowstyle="-|>",
            mutation_scale=scale,
            linewidth=lw,
            color=color,
            shrinkA=0,
            shrinkB=0,
        )
    )


def norm_xy(df, xcol="x", ycol="y"):
    x = df[xcol].to_numpy(dtype=float)
    y = df[ycol].to_numpy(dtype=float)
    return (x - x.min()) / 1000.0, (y - y.min()) / 1000.0


def load_data():
    boundary = pd.read_csv(ROOT / "data" / "采区边界_敏东.csv", encoding="utf-8-sig")
    holes = pd.read_csv(ROOT / "data" / "钻孔坐标_敏东.csv", encoding="utf-8-sig")
    odi = pd.read_csv(
        ROOT / "output" / "scene_visual_exports" / "20260416_201037" / "06_full_overburden" / "full" / "data_odi_points.csv",
        encoding="utf-8-sig",
    )
    params = pd.read_csv(
        ROOT / "output" / "scene_visual_exports" / "20260416_201037" / "06_full_overburden" / "full" / "data_parameters.csv",
        encoding="utf-8-sig",
    )
    stats = pd.read_csv(ROOT / "output" / "fig6_scheme_comparison" / "fig6_scheme_comparison_stats.csv", encoding="utf-8-sig")

    coal_rows = []
    for p in (ROOT / "data" / "钻孔分层数据").glob("*.csv"):
        df = pd.read_csv(p, encoding="utf-8-sig")
        coal_thick = df[df["name"].astype(str).str.contains("煤", na=False)]["thickness"].sum()
        coal_rows.append({"id": p.stem, "coal_thickness": coal_thick})
    coal = pd.DataFrame(coal_rows).merge(holes, on="id", how="inner")
    return boundary, holes, odi, params, stats, coal


def inset_title(ax, title):
    ax.text(
        0.03,
        0.95,
        title,
        transform=ax.transAxes,
        ha="left",
        va="top",
        fontsize=4.6,
        fontproperties=FONT,
        color=INK,
        bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.78, "pad": 0.6},
        zorder=8,
    )


def plot_map(ax, boundary, holes, odi_points=None, values=None, title=""):
    clean_axis(ax)
    bx, by = norm_xy(boundary)
    hx, hy = norm_xy(holes)
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color="#1F2933", lw=0.8)
    ax.scatter(hx, hy, s=8, facecolor="#FFFFFF", edgecolor=BLUE, lw=0.6, zorder=3)
    if odi_points is not None and values is not None:
        ox = (odi_points["X"].to_numpy() - boundary["x"].min()) / 1000.0
        oy = (odi_points["Y"].to_numpy() - boundary["y"].min()) / 1000.0
        sc = ax.scatter(ox, oy, c=values, s=13, cmap="YlOrRd", edgecolor="#333333", lw=0.25, zorder=4)
    ax.set_aspect("equal", adjustable="box")
    inset_title(ax, title)


def plot_field(ax, df, value_col, boundary, title, cmap="viridis"):
    clean_axis(ax)
    bx = (boundary["x"].to_numpy() - boundary["x"].min()) / 1000.0
    by = (boundary["y"].to_numpy() - boundary["y"].min()) / 1000.0
    xcol, ycol = ("X", "Y") if "X" in df.columns else ("x", "y")
    x = (df[xcol].to_numpy(dtype=float) - boundary["x"].min()) / 1000.0
    y = (df[ycol].to_numpy(dtype=float) - boundary["y"].min()) / 1000.0
    z = df[value_col].to_numpy(dtype=float)
    xi = np.linspace(bx.min(), bx.max(), 80)
    yi = np.linspace(by.min(), by.max(), 80)
    xx, yy = np.meshgrid(xi, yi)
    zz = griddata((x, y), z, (xx, yy), method="linear")
    nearest = griddata((x, y), z, (xx, yy), method="nearest")
    zz = np.where(np.isfinite(zz), zz, nearest)
    im = ax.contourf(xx, yy, zz, levels=10, cmap=cmap, alpha=0.92)
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color="#333333", lw=0.55)
    ax.scatter(x, y, s=5, c="white", edgecolor="#333333", lw=0.2)
    ax.set_aspect("equal", adjustable="box")
    inset_title(ax, title)
    return im


def plot_lith_columns(ax):
    clean_axis(ax)
    picks = ["50-14", "52-18", "54-17"]
    color_map = {
        "煤": "#2E2E2E",
        "砂": "#D9C28F",
        "泥": "#A7A7A7",
        "砾": "#B8875B",
        "土": "#7FA66A",
    }
    for i, hid in enumerate(picks):
        df = pd.read_csv(ROOT / "data" / "钻孔分层数据" / f"{hid}.csv", encoding="utf-8-sig").head(18)
        total = df["thickness"].sum()
        y0 = 0.08
        for _, row in df.iterrows():
            name = str(row["name"])
            c = "#D6D6D6"
            for key, value in color_map.items():
                if key in name:
                    c = value
                    break
            hh = max(0.012, 0.82 * float(row["thickness"]) / total)
            ax.add_patch(Rectangle((0.18 + i * 0.28, y0), 0.13, hh, facecolor=c, edgecolor="white", lw=0.18))
            y0 += hh
        cn(ax, 0.245 + i * 0.28, 0.03, hid, size=4.6)
    inset_title(ax, "钻孔柱状")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)


def plot_stats(ax, stats):
    clean_axis(ax)
    labels = stats["plan_code"].astype(str).to_list()
    x = np.arange(len(labels))
    coverage = stats["coverage_pct"].to_numpy(dtype=float) / 100
    risk = stats["risk_score"].to_numpy(dtype=float)
    width = 0.34
    ax.bar(x - width / 2, coverage, width, color="#8FB9A8", edgecolor="#4F7F52", lw=0.45, label="覆盖率")
    ax.bar(x + width / 2, risk, width, color="#E0A06B", edgecolor="#B96B21", lw=0.45, label="风险")
    ax.set_ylim(0, 1.05)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontproperties=FONT, fontsize=5.2)
    ax.set_yticks([0, 0.5, 1.0])
    ax.set_yticklabels(["0", "0.5", "1.0"], fontproperties=FONT, fontsize=4.8)
    ax.grid(axis="y", color="#E5E7EA", lw=0.35)
    legend_font = FontProperties(fname=r"C:\Windows\Fonts\simsun.ttc", size=4.5)
    ax.legend(prop=legend_font, loc="upper left", frameon=False, ncol=2, handlelength=0.8, columnspacing=0.6)
    for spine in ax.spines.values():
        spine.set_color("#D0D6DA")
        spine.set_linewidth(0.45)
    inset_title(ax, "方案指标")


def plot_candidate(ax, boundary):
    clean_axis(ax)
    bx, by = norm_xy(boundary)
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color="#333333", lw=0.65)
    xmin, xmax = bx.min(), bx.max()
    ymin, ymax = by.min(), by.max()
    for i, c in enumerate(["#DCEBFA", "#E7F2DD", "#FFF0D8", "#F5DDDD"]):
        y = ymin + (i + 1) * (ymax - ymin) / 6
        poly = np.array(
            [
                [xmin + 0.45, y],
                [xmax - 0.35, y + 0.16],
                [xmax - 0.25, y + 0.32],
                [xmin + 0.55, y + 0.16],
            ]
        )
        ax.add_patch(Polygon(poly, closed=True, facecolor=c, edgecolor="#666666", lw=0.45))
    ax.set_aspect("equal", adjustable="box")
    inset_title(ax, "候选方案")


def draw():
    boundary, holes, odi_points, params, stats, coal = load_data()

    fig = plt.figure(figsize=(7.45, 6.08), dpi=300)
    fig.patch.set_facecolor("white")
    canvas = fig.add_axes([0, 0, 1, 1])
    canvas.set_xlim(0, 1)
    canvas.set_ylim(0, 1)
    canvas.axis("off")

    panels = [
        (0.035, 0.805, 0.930, 0.165, "L1 数据来源与 L2 数据分类", BLUE),
        (0.035, 0.570, 0.930, 0.195, "L3 空间处理与指标构建", TEAL),
        (0.035, 0.335, 0.930, 0.195, "L4 图层输出", ORANGE),
        (0.035, 0.110, 0.930, 0.185, "L5 规划应用", RED),
    ]
    for p in panels:
        dashed_panel(canvas, *p)
    for y1, y2 in [(0.805, 0.765), (0.570, 0.530), (0.335, 0.295)]:
        arrow(canvas, (0.50, y1), (0.50, y2), scale=9)

    # L1-L2 section.
    ax_map = fig.add_axes([0.055, 0.835, 0.140, 0.100])
    plot_map(ax_map, boundary, holes, title="采区边界/钻孔")
    ax_col = fig.add_axes([0.215, 0.835, 0.105, 0.100])
    plot_lith_columns(ax_col)
    small_box(canvas, 0.345, 0.895, 0.135, 0.034, "矿井地质资料", BLUE, fs=5.9)
    small_box(canvas, 0.345, 0.850, 0.135, 0.034, "采区设计图件", BLUE, fs=5.9)
    small_box(canvas, 0.500, 0.895, 0.135, 0.034, "钻孔资料", BLUE, fs=5.9)
    small_box(canvas, 0.500, 0.850, 0.135, 0.034, "覆岩扰动评价", BLUE, fs=5.9)
    small_box(canvas, 0.655, 0.895, 0.135, 0.034, "工作面规划参数", BLUE, fs=5.9)
    arrow(canvas, (0.795, 0.872), (0.835, 0.872), scale=7)
    small_box(canvas, 0.835, 0.895, 0.095, 0.034, f"钻孔 {len(holes)} 个", GREEN, fs=5.6)
    small_box(canvas, 0.835, 0.850, 0.095, 0.034, f"ODI点 {len(odi_points)} 个", GREEN, fs=5.6)
    small_box(canvas, 0.835, 0.815, 0.095, 0.026, "参数字段 4 类", GREEN, fs=5.1)

    # L3 section.
    ax_proc_map = fig.add_axes([0.065, 0.610, 0.155, 0.105])
    plot_map(ax_proc_map, boundary, holes, odi_points, odi_points["ODI_norm"], "坐标统一/裁剪")
    ax_field = fig.add_axes([0.250, 0.610, 0.155, 0.105])
    plot_field(ax_field, params, "Hi", boundary, "插值计算: Hi", cmap="YlGnBu")
    ax_odi = fig.add_axes([0.435, 0.610, 0.155, 0.105])
    plot_field(ax_odi, odi_points, "ODI_norm", boundary, "指标归一化: ODI", cmap="YlOrRd")
    steps = ["格式转换", "边界裁剪", "插值计算", "归一化", "图层叠加"]
    x = 0.635
    for i, step in enumerate(steps):
        small_box(canvas, x, 0.665 - i * 0.031, 0.090, 0.022, step, TEAL, fs=4.9)
        if i < len(steps) - 1:
            arrow(canvas, (x + 0.045, 0.665 - i * 0.031), (x + 0.045, 0.656 - i * 0.031), color=TEAL, scale=5)
    cn(canvas, 0.780, 0.660, "输出统一空间网格\n支撑多图层叠加", size=6.0)
    arrow(canvas, (0.725, 0.650), (0.755, 0.650), color=TEAL, scale=7)

    # L4 section.
    ax_domain = fig.add_axes([0.060, 0.382, 0.130, 0.095])
    plot_map(ax_domain, boundary, holes, title="有效布置域")
    ax_coal = fig.add_axes([0.235, 0.382, 0.130, 0.095])
    plot_field(ax_coal, coal, "coal_thickness", boundary, "煤厚资源", cmap="YlOrBr")
    ax_odi2 = fig.add_axes([0.410, 0.382, 0.130, 0.095])
    plot_field(ax_odi2, odi_points, "ODI_norm", boundary, "ODI扰动", cmap="YlOrRd")
    ax_candidate = fig.add_axes([0.585, 0.382, 0.130, 0.095])
    plot_candidate(ax_candidate, boundary)
    for i, label in enumerate(["有效布置域图层", "煤厚资源图层", "ODI扰动图层", "候选方案图层"]):
        small_box(canvas, 0.055 + i * 0.175, 0.350, 0.135, 0.027, label, ODI if label.startswith("ODI") else ORANGE, fs=5.3, bold=label.startswith("ODI"))
    cn(canvas, 0.825, 0.425, "图层既是结果，\n也是下游规划模型的输入", size=6.0)
    arrow(canvas, (0.720, 0.425), (0.775, 0.425), color=ORANGE, scale=7)

    # L5 section.
    flow = ["方案生成", "约束筛选", "指标统计", "方案比选"]
    x0 = 0.060
    for i, label in enumerate(flow):
        small_box(canvas, x0 + i * 0.115, 0.210, 0.090, 0.034, label, RED, fs=5.9, bold=i in (0, 3))
        if i < len(flow) - 1:
            arrow(canvas, (x0 + i * 0.115 + 0.092, 0.227), (x0 + (i + 1) * 0.115 - 0.006, 0.227), color=RED, scale=6)
    ax_stats = fig.add_axes([0.550, 0.160, 0.245, 0.090])
    plot_stats(ax_stats, stats)
    small_box(canvas, 0.825, 0.195, 0.085, 0.038, "推荐方案\n与约束说明", RED, fs=5.4, bold=True, fill="#FFFDFD")
    arrow(canvas, (0.800, 0.215), (0.825, 0.215), color=RED, scale=7)

    cn(canvas, 0.500, 0.052, "注：缩略图均由本项目钻孔坐标、采区边界、钻孔分层、ODI评价点和方案统计数据生成。", size=5.4, color=MUTED)

    OUT.mkdir(parents=True, exist_ok=True)
    stem = OUT / "data_workflow_rich_evidence"
    fig.savefig(stem.with_suffix(".svg"), bbox_inches="tight", pad_inches=0.035)
    fig.savefig(stem.with_suffix(".pdf"), bbox_inches="tight", pad_inches=0.035)
    fig.savefig(stem.with_suffix(".png"), dpi=900, bbox_inches="tight", pad_inches=0.035)
    plt.close(fig)


if __name__ == "__main__":
    draw()
