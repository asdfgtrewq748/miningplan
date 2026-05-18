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

FONT_CN = FontProperties(fname=r"C:\Windows\Fonts\simsun.ttc")
FONT_CN_BOLD = FontProperties(fname=r"C:\Windows\Fonts\simhei.ttf")

mpl.rcParams["pdf.fonttype"] = 42
mpl.rcParams["ps.fonttype"] = 42
mpl.rcParams["svg.fonttype"] = "none"
mpl.rcParams["axes.unicode_minus"] = False

INK = "#1F2933"
MUTED = "#66727C"
GRID = "#CDD6DD"
BLUE = "#315F8C"
GREEN = "#4F7D55"
TEAL = "#4E8E88"
ORANGE = "#B46A1D"
RED = "#A84A4A"
BROWN = "#9A3E00"
PANEL_FILL = "#FBFCFD"


def txt(ax, x, y, s, size=6.0, bold=False, color=INK, ha="center", va="center", **kwargs):
    ax.text(
        x,
        y,
        s,
        fontsize=size,
        fontproperties=FONT_CN_BOLD if bold else FONT_CN,
        color=color,
        ha=ha,
        va=va,
        **kwargs,
    )


def arrow(ax, start, end, color="#7D8D98", lw=0.65, ms=7.5):
    ax.add_patch(
        FancyArrowPatch(
            start,
            end,
            arrowstyle="-|>",
            mutation_scale=ms,
            linewidth=lw,
            color=color,
            shrinkA=0,
            shrinkB=0,
            zorder=12,
        )
    )


def rect(ax, x, y, w, h, edge, fill="#FFFFFF", lw=0.65, ls="solid"):
    patch = Rectangle((x, y), w, h, facecolor=fill, edgecolor=edge, linewidth=lw, linestyle=ls, zorder=1)
    ax.add_patch(patch)
    return patch


def box(ax, x, y, w, h, label, edge, fs=5.2, bold=False, fill="#FFFFFF"):
    rect(ax, x, y, w, h, edge=edge, fill=fill, lw=0.62)
    txt(ax, x + w / 2, y + h / 2, label, size=fs, bold=bold)


def panel(ax, x, y, w, h, title, color):
    rect(ax, x, y, w, h, edge=color, fill=PANEL_FILL, lw=0.76, ls=(0, (3, 2)))
    rect(ax, x, y + h - 0.0012, w, 0.0012, edge=color, fill=color, lw=0)
    txt(ax, x + 0.014, y + h - 0.024, title, size=6.2, bold=True, ha="left", va="top")


def clean(ax):
    ax.set_xticks([])
    ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(True)
        s.set_color("#D3DAE0")
        s.set_linewidth(0.35)
    ax.set_facecolor("white")


def inset_label(ax, s):
    ax.text(
        0.025,
        0.965,
        s,
        transform=ax.transAxes,
        ha="left",
        va="top",
        fontsize=4.25,
        fontproperties=FONT_CN,
        color=INK,
        bbox=dict(facecolor="white", edgecolor="none", alpha=0.82, pad=0.45),
        zorder=20,
    )


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
    for path in (ROOT / "data" / "钻孔分层数据").glob("*.csv"):
        df = pd.read_csv(path, encoding="utf-8-sig")
        coal_rows.append(
            {
                "id": path.stem,
                "coal_thickness": df[df["name"].astype(str).str.contains("煤", na=False)]["thickness"].sum(),
            }
        )
    coal = pd.DataFrame(coal_rows).merge(holes, on="id", how="inner")
    return boundary, holes, odi, params, stats, coal


def relative_xy(df, boundary, xcol, ycol):
    return (
        (df[xcol].to_numpy(dtype=float) - boundary["x"].min()) / 1000.0,
        (df[ycol].to_numpy(dtype=float) - boundary["y"].min()) / 1000.0,
    )


def set_map_limits(ax, boundary, extra: list[tuple[np.ndarray, np.ndarray]] | None = None):
    bx, by = relative_xy(boundary, boundary, "x", "y")
    xs = [bx]
    ys = [by]
    for ex, ey in extra or []:
        xs.append(ex)
        ys.append(ey)
    all_x = np.concatenate(xs)
    all_y = np.concatenate(ys)
    mx = (all_x.max() - all_x.min()) * 0.07
    my = (all_y.max() - all_y.min()) * 0.10
    ax.set_xlim(all_x.min() - mx, all_x.max() + mx)
    ax.set_ylim(all_y.min() - my, all_y.max() + my)
    ax.set_aspect("equal", adjustable="box")


def draw_base_map(ax, boundary, holes, title, values=None, value_points=None, cmap="YlOrRd"):
    clean(ax)
    bx, by = relative_xy(boundary, boundary, "x", "y")
    hx, hy = relative_xy(holes, boundary, "x", "y")
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color=INK, lw=0.55, zorder=3)
    ax.scatter(hx, hy, s=6.0, facecolor="white", edgecolor=BLUE, linewidth=0.45, zorder=4)
    if value_points is not None and values is not None:
        xcol, ycol = ("X", "Y") if "X" in value_points.columns else ("x", "y")
        vx, vy = relative_xy(value_points, boundary, xcol, ycol)
        ax.scatter(vx, vy, c=values, s=9.0, cmap=cmap, edgecolor="#333333", linewidth=0.18, zorder=5)
        set_map_limits(ax, boundary, [(hx, hy), (vx, vy)])
    else:
        set_map_limits(ax, boundary, [(hx, hy)])
    inset_label(ax, title)


def draw_field(ax, data, boundary, value_col, title, cmap):
    clean(ax)
    bx, by = relative_xy(boundary, boundary, "x", "y")
    xcol, ycol = ("X", "Y") if "X" in data.columns else ("x", "y")
    x, y = relative_xy(data, boundary, xcol, ycol)
    z = data[value_col].to_numpy(dtype=float)
    xi = np.linspace(bx.min(), bx.max(), 90)
    yi = np.linspace(by.min(), by.max(), 90)
    xx, yy = np.meshgrid(xi, yi)
    linear = griddata((x, y), z, (xx, yy), method="linear")
    nearest = griddata((x, y), z, (xx, yy), method="nearest")
    zz = np.where(np.isfinite(linear), linear, nearest)
    im = ax.contourf(xx, yy, zz, levels=12, cmap=cmap, alpha=0.95)
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color="#30363A", lw=0.45, zorder=5)
    ax.scatter(x, y, s=4.5, facecolor="white", edgecolor="#333333", linewidth=0.20, zorder=6)
    set_map_limits(ax, boundary, [(x, y)])
    inset_label(ax, title)
    return im


def draw_lithology(ax):
    clean(ax)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    colors = {"煤": "#303030", "砂": "#D7C08A", "泥": "#9E9E9E", "砾": "#B78355", "土": "#7EA064"}
    ids = ["50-14", "52-18", "54-17"]
    for i, hid in enumerate(ids):
        df = pd.read_csv(ROOT / "data" / "钻孔分层数据" / f"{hid}.csv", encoding="utf-8-sig").head(20)
        total = df["thickness"].sum()
        y0 = 0.12
        for _, row in df.iterrows():
            lith = str(row["name"])
            color = "#D8D8D8"
            for key, value in colors.items():
                if key in lith:
                    color = value
                    break
            h = max(0.010, 0.76 * float(row["thickness"]) / total)
            ax.add_patch(Rectangle((0.18 + i * 0.27, y0), 0.12, h, facecolor=color, edgecolor="white", lw=0.12))
            y0 += h
        txt(ax, 0.24 + i * 0.27, 0.055, hid, size=3.9)
    inset_label(ax, "钻孔分层")


def draw_scheme(ax, boundary):
    clean(ax)
    bx, by = relative_xy(boundary, boundary, "x", "y")
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color="#30363A", lw=0.48)
    xmin, xmax = bx.min(), bx.max()
    ymin, ymax = by.min(), by.max()
    colors = ["#DDEBFA", "#E5F0D9", "#FFF0D5", "#F2DCDC"]
    for i, color in enumerate(colors):
        y = ymin + (i + 1.10) * (ymax - ymin) / 6.2
        poly = np.array(
            [
                [xmin + 0.50, y],
                [xmax - 0.28, y + 0.15],
                [xmax - 0.18, y + 0.30],
                [xmin + 0.60, y + 0.16],
            ]
        )
        ax.add_patch(Polygon(poly, closed=True, facecolor=color, edgecolor="#555555", lw=0.35))
    set_map_limits(ax, boundary)
    inset_label(ax, "候选方案")


def draw_stats(ax, stats):
    clean(ax)
    labels = stats["plan_code"].astype(str).to_list()
    x = np.arange(len(labels))
    coverage = stats["coverage_pct"].to_numpy(dtype=float) / 100.0
    risk = stats["risk_score"].to_numpy(dtype=float)
    width = 0.34
    ax.bar(x - width / 2, coverage, width, color="#95BDAA", edgecolor=GREEN, lw=0.45, label="覆盖率")
    ax.bar(x + width / 2, risk, width, color="#DDA064", edgecolor=ORANGE, lw=0.45, label="风险")
    ax.set_ylim(0, 1.05)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontproperties=FONT_CN, fontsize=4.5)
    ax.set_yticks([0, 0.5, 1.0])
    ax.set_yticklabels(["0", "0.5", "1.0"], fontproperties=FONT_CN, fontsize=4.2)
    ax.grid(axis="y", color="#E2E6EA", lw=0.30)
    leg_font = FontProperties(fname=r"C:\Windows\Fonts\simsun.ttc", size=4.2)
    ax.legend(prop=leg_font, loc="upper right", frameon=False, ncol=2, handlelength=0.85, columnspacing=0.7)
    inset_label(ax, "方案指标")


def add_cbar(fig, im, x, y, h, label):
    cax = fig.add_axes([x, y, 0.006, h])
    cb = fig.colorbar(im, cax=cax)
    cb.outline.set_linewidth(0.25)
    cb.ax.tick_params(labelsize=3.6, length=1.2, width=0.25, pad=1)
    cb.ax.set_ylabel(label, fontsize=3.9, fontproperties=FONT_CN, rotation=90, labelpad=2)


def draw():
    boundary, holes, odi, params, stats, coal = load_data()

    fig = plt.figure(figsize=(7.20, 5.65), dpi=300)
    fig.patch.set_facecolor("white")
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    panels = {
        "p1": (0.035, 0.795, 0.930, 0.165, "L1-L2  数据来源与分类", BLUE),
        "p2": (0.035, 0.545, 0.930, 0.215, "L3  空间处理与指标构建", TEAL),
        "p3": (0.035, 0.295, 0.930, 0.215, "L4  图层输出", ORANGE),
        "p4": (0.035, 0.075, 0.930, 0.185, "L5  规划应用", RED),
    }
    for args in panels.values():
        panel(ax, *args)
    for y0, y1 in [(0.795, 0.760), (0.545, 0.510), (0.295, 0.260)]:
        arrow(ax, (0.50, y0), (0.50, y1), ms=8.5)

    # L1-L2
    a1 = fig.add_axes([0.058, 0.830, 0.145, 0.090])
    draw_base_map(a1, boundary, holes, "边界/钻孔")
    a2 = fig.add_axes([0.222, 0.830, 0.105, 0.090])
    draw_lithology(a2)
    for i, label in enumerate(["矿井地质资料", "采区设计图件", "钻孔资料", "覆岩扰动评价", "规划参数"]):
        x = 0.365 + (i % 3) * 0.135
        y = 0.885 - (i // 3) * 0.048
        box(ax, x, y, 0.108, 0.030, label, BLUE, fs=4.9)
    arrow(ax, (0.760, 0.865), (0.800, 0.865), ms=7.0)
    for i, (label, color) in enumerate([(f"钻孔 {len(holes)} 个", GREEN), (f"ODI点 {len(odi)} 个", GREEN), ("参数 4 类", GREEN)]):
        box(ax, 0.805, 0.895 - i * 0.042, 0.110, 0.027, label, color, fs=4.7)

    # L3
    a3 = fig.add_axes([0.060, 0.590, 0.145, 0.095])
    draw_base_map(a3, boundary, holes, "统一坐标/边界裁剪", values=odi["ODI_norm"], value_points=odi)
    a4 = fig.add_axes([0.245, 0.590, 0.145, 0.095])
    im1 = draw_field(a4, params, boundary, "Hi", "插值场: Hi", "YlGnBu")
    add_cbar(fig, im1, 0.393, 0.596, 0.079, "Hi")
    a5 = fig.add_axes([0.430, 0.590, 0.145, 0.095])
    im2 = draw_field(a5, odi, boundary, "ODI_norm", "归一化: ODI", "YlOrRd")
    add_cbar(fig, im2, 0.578, 0.596, 0.079, "ODI")
    steps = ["格式转换", "边界裁剪", "插值计算", "指标归一化", "图层叠加"]
    for i, step in enumerate(steps):
        box(ax, 0.670, 0.700 - i * 0.033, 0.090, 0.023, step, TEAL, fs=4.6)
        if i < len(steps) - 1:
            arrow(ax, (0.715, 0.700 - i * 0.033), (0.715, 0.690 - i * 0.033), color=TEAL, ms=5.0, lw=0.55)
    txt(ax, 0.810, 0.637, "形成统一空间网格\n并支持多图层叠加", size=5.4, ha="left")
    arrow(ax, (0.762, 0.640), (0.800, 0.640), color=TEAL, ms=6.0)

    # L4
    axes = [
        fig.add_axes([0.060, 0.340, 0.130, 0.090]),
        fig.add_axes([0.235, 0.340, 0.130, 0.090]),
        fig.add_axes([0.410, 0.340, 0.130, 0.090]),
        fig.add_axes([0.585, 0.340, 0.130, 0.090]),
    ]
    draw_base_map(axes[0], boundary, holes, "有效布置域")
    im3 = draw_field(axes[1], coal, boundary, "coal_thickness", "煤厚资源", "YlOrBr")
    im4 = draw_field(axes[2], odi, boundary, "ODI扰动", "YlOrRd") if False else None
    draw_field(axes[2], odi, boundary, "ODI_norm", "ODI扰动", "YlOrRd")
    draw_scheme(axes[3], boundary)
    labels = [("有效布置域图层", ORANGE), ("煤厚资源图层", ORANGE), ("ODI扰动图层", BROWN), ("候选方案图层", ORANGE)]
    for i, (label, edge) in enumerate(labels):
        box(ax, 0.058 + i * 0.175, 0.315, 0.130, 0.026, label, edge, fs=4.7, bold=edge == BROWN)
    txt(ax, 0.805, 0.382, "图层既是阶段输出，\n也是规划模型输入", size=5.4, ha="left")
    arrow(ax, (0.720, 0.380), (0.795, 0.380), color=ORANGE, ms=6.5)

    # L5
    flow = ["方案生成", "约束筛选", "指标统计", "方案比选"]
    for i, label in enumerate(flow):
        box(ax, 0.070 + i * 0.120, 0.160, 0.090, 0.033, label, RED, fs=5.0, bold=i in (0, 3))
        if i < len(flow) - 1:
            arrow(ax, (0.162 + i * 0.120, 0.176), (0.188 + i * 0.120, 0.176), color=RED, ms=5.8)
    a6 = fig.add_axes([0.575, 0.125, 0.230, 0.085])
    draw_stats(a6, stats)
    arrow(ax, (0.815, 0.172), (0.850, 0.172), color=RED, ms=6.2)
    box(ax, 0.852, 0.149, 0.090, 0.045, "推荐方案\n与约束说明", RED, fs=4.6, bold=True)

    txt(
        ax,
        0.50,
        0.030,
        "注：图中缩略图由本项目钻孔坐标、采区边界、钻孔分层、ODI评价点和方案统计数据生成。",
        size=4.7,
        color=MUTED,
    )

    OUT.mkdir(parents=True, exist_ok=True)
    stem = OUT / "data_workflow_sci_polished"
    fig.savefig(stem.with_suffix(".svg"), bbox_inches="tight", pad_inches=0.030)
    fig.savefig(stem.with_suffix(".pdf"), bbox_inches="tight", pad_inches=0.030)
    fig.savefig(stem.with_suffix(".png"), dpi=900, bbox_inches="tight", pad_inches=0.030)
    plt.close(fig)


if __name__ == "__main__":
    draw()
