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

INK = "#1F2933"
BLUE = "#315F8C"
TEAL = "#4E8E88"
ORANGE = "#B46A1D"
RED = "#A84A4A"
GREEN = "#4F7D55"
GRAY = "#7C8A94"
LIGHT = "#FBFCFD"


def text(ax, x, y, s, size=6.0, bold=False, color=INK, ha="center", va="center", **kw):
    ax.text(
        x,
        y,
        s,
        fontsize=size,
        fontproperties=FONT_BOLD if bold else FONT,
        color=color,
        ha=ha,
        va=va,
        **kw,
    )


def rect(ax, x, y, w, h, ec=BLUE, fc="white", lw=0.62, ls="solid"):
    ax.add_patch(Rectangle((x, y), w, h, facecolor=fc, edgecolor=ec, linewidth=lw, linestyle=ls, zorder=2))


def box(ax, x, y, w, h, label, ec=BLUE, fs=5.2, bold=False, fc="white"):
    rect(ax, x, y, w, h, ec=ec, fc=fc, lw=0.62)
    text(ax, x + w / 2, y + h / 2, label, size=fs, bold=bold)


def arrow(ax, start, end, color=GRAY, lw=0.62, ms=7.0):
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
            zorder=5,
        )
    )


def panel(ax, x, y, w, h, title, ec=BLUE):
    rect(ax, x, y, w, h, ec=ec, fc=LIGHT, lw=0.70, ls=(0, (3, 2)))
    text(ax, x + w / 2, y + h - 0.018, title, size=6.3, bold=False)


def clean(ax):
    ax.set_xticks([])
    ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_facecolor("white")


def inset_label(ax, label):
    ax.text(
        0.035,
        0.955,
        label,
        transform=ax.transAxes,
        ha="left",
        va="top",
        fontsize=4.0,
        fontproperties=FONT,
        color=INK,
        bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.80, "pad": 0.35},
        zorder=10,
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
    for p in (ROOT / "data" / "钻孔分层数据").glob("*.csv"):
        df = pd.read_csv(p, encoding="utf-8-sig")
        coal_rows.append({"id": p.stem, "coal_thickness": df[df["name"].astype(str).str.contains("煤", na=False)]["thickness"].sum()})
    coal = pd.DataFrame(coal_rows).merge(holes, on="id", how="inner")
    return boundary, holes, odi, params, stats, coal


def rel(df, boundary, xcol, ycol):
    return (
        (df[xcol].to_numpy(dtype=float) - boundary["x"].min()) / 1000.0,
        (df[ycol].to_numpy(dtype=float) - boundary["y"].min()) / 1000.0,
    )


def map_limits(ax, boundary, extras=()):
    bx, by = rel(boundary, boundary, "x", "y")
    xs = [bx]
    ys = [by]
    for x, y in extras:
        xs.append(x)
        ys.append(y)
    x = np.concatenate(xs)
    y = np.concatenate(ys)
    ax.set_xlim(x.min() - 0.08 * (x.max() - x.min()), x.max() + 0.08 * (x.max() - x.min()))
    ax.set_ylim(y.min() - 0.10 * (y.max() - y.min()), y.max() + 0.10 * (y.max() - y.min()))
    ax.set_aspect("equal", adjustable="box")


def draw_map(ax, boundary, holes, title, values=None, value_df=None):
    clean(ax)
    bx, by = rel(boundary, boundary, "x", "y")
    hx, hy = rel(holes, boundary, "x", "y")
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color=INK, lw=0.48)
    ax.scatter(hx, hy, s=5.4, facecolor="white", edgecolor=BLUE, linewidth=0.42)
    extras = [(hx, hy)]
    if values is not None and value_df is not None:
        xcol, ycol = ("X", "Y") if "X" in value_df.columns else ("x", "y")
        vx, vy = rel(value_df, boundary, xcol, ycol)
        ax.scatter(vx, vy, c=values, cmap="YlOrRd", s=8.0, edgecolor="#333", linewidth=0.15)
        extras.append((vx, vy))
    map_limits(ax, boundary, extras)
    inset_label(ax, title)


def draw_field(ax, data, boundary, value_col, title, cmap):
    clean(ax)
    bx, by = rel(boundary, boundary, "x", "y")
    xcol, ycol = ("X", "Y") if "X" in data.columns else ("x", "y")
    x, y = rel(data, boundary, xcol, ycol)
    z = data[value_col].to_numpy(float)
    xi = np.linspace(bx.min(), bx.max(), 70)
    yi = np.linspace(by.min(), by.max(), 70)
    xx, yy = np.meshgrid(xi, yi)
    linear = griddata((x, y), z, (xx, yy), method="linear")
    nearest = griddata((x, y), z, (xx, yy), method="nearest")
    zz = np.where(np.isfinite(linear), linear, nearest)
    ax.contourf(xx, yy, zz, levels=9, cmap=cmap, alpha=0.96)
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color=INK, lw=0.42)
    ax.scatter(x, y, s=3.8, facecolor="white", edgecolor="#333", linewidth=0.16)
    map_limits(ax, boundary, [(x, y)])
    inset_label(ax, title)


def draw_lith(ax):
    clean(ax)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    colors = {"煤": "#303030", "砂": "#D7C08A", "泥": "#9E9E9E", "砾": "#B78355", "土": "#7EA064"}
    for i, hid in enumerate(["50-14", "52-18", "54-17"]):
        df = pd.read_csv(ROOT / "data" / "钻孔分层数据" / f"{hid}.csv", encoding="utf-8-sig").head(20)
        total = df["thickness"].sum()
        y = 0.12
        for _, r in df.iterrows():
            c = "#D8D8D8"
            for k, v in colors.items():
                if k in str(r["name"]):
                    c = v
                    break
            h = max(0.010, 0.74 * float(r["thickness"]) / total)
            ax.add_patch(Rectangle((0.18 + i * 0.27, y), 0.115, h, facecolor=c, edgecolor="white", lw=0.10))
            y += h
        text(ax, 0.237 + i * 0.27, 0.050, hid, size=3.6)
    inset_label(ax, "钻孔分层")


def draw_candidate(ax, boundary):
    clean(ax)
    bx, by = rel(boundary, boundary, "x", "y")
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color=INK, lw=0.42)
    xmin, xmax = bx.min(), bx.max()
    ymin, ymax = by.min(), by.max()
    for i, c in enumerate(["#DDEBFA", "#E5F0D9", "#FFF0D5", "#F2DCDC"]):
        y = ymin + (i + 1.15) * (ymax - ymin) / 6.2
        poly = np.array([[xmin + 0.5, y], [xmax - 0.22, y + 0.13], [xmax - 0.12, y + 0.26], [xmin + 0.58, y + 0.14]])
        ax.add_patch(Polygon(poly, closed=True, facecolor=c, edgecolor="#555", lw=0.30))
    map_limits(ax, boundary)
    inset_label(ax, "候选方案")


def draw_stats(ax, stats):
    clean(ax)
    labels = stats["plan_code"].astype(str).to_list()
    x = np.arange(len(labels))
    coverage = stats["coverage_pct"].to_numpy(float) / 100
    risk = stats["risk_score"].to_numpy(float)
    width = 0.32
    ax.bar(x - width / 2, coverage, width, color="#95BDAA", edgecolor=GREEN, lw=0.35, label="覆盖率")
    ax.bar(x + width / 2, risk, width, color="#DDA064", edgecolor=ORANGE, lw=0.35, label="风险")
    ax.set_ylim(0, 1.05)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontproperties=FONT, fontsize=4.1)
    ax.set_yticks([0, 0.5, 1.0])
    ax.set_yticklabels(["0", "0.5", "1.0"], fontproperties=FONT, fontsize=3.8)
    ax.grid(axis="y", color="#E3E7EA", lw=0.25)
    for s in ax.spines.values():
        s.set_visible(True)
        s.set_color("#D3DAE0")
        s.set_linewidth(0.30)
    leg_font = FontProperties(fname=r"C:\Windows\Fonts\simsun.ttc", size=3.8)
    ax.legend(prop=leg_font, frameon=False, loc="upper right", ncol=2, handlelength=0.75, columnspacing=0.5)
    inset_label(ax, "方案指标")


def draw():
    boundary, holes, odi, params, stats, coal = load_data()

    fig = plt.figure(figsize=(7.15, 5.20), dpi=300)
    fig.patch.set_facecolor("white")
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    panel(ax, 0.035, 0.790, 0.930, 0.180, "数据来源与分类", BLUE)
    panel(ax, 0.035, 0.540, 0.930, 0.220, "空间处理与指标构建", TEAL)
    panel(ax, 0.035, 0.305, 0.930, 0.205, "图层输出", ORANGE)
    panel(ax, 0.035, 0.070, 0.930, 0.205, "规划应用", RED)
    for y0, y1 in [(0.790, 0.760), (0.540, 0.510), (0.305, 0.275)]:
        arrow(ax, (0.50, y0), (0.50, y1), ms=8.0)

    # Panel 1: data source and classification.
    draw_map(fig.add_axes([0.055, 0.835, 0.145, 0.090]), boundary, holes, "边界/钻孔")
    draw_lith(fig.add_axes([0.215, 0.835, 0.100, 0.090]))
    arrow(ax, (0.325, 0.880), (0.360, 0.880), BLUE, ms=6.0)
    for i, label in enumerate(["地质资料", "设计图件", "钻孔资料", "扰动评价", "规划参数"]):
        box(ax, 0.365 + i * 0.087, 0.900, 0.070, 0.030, label, BLUE, fs=4.3)
    for i, label in enumerate(["基础地质数据", "工程约束数据", "覆岩扰动数据", "规划参数数据"]):
        box(ax, 0.385 + i * 0.118, 0.825, 0.092, 0.032, label, GREEN, fs=4.1)
    arrow(ax, (0.545, 0.895), (0.545, 0.860), GRAY, ms=5.2)
    box(ax, 0.820, 0.900, 0.100, 0.030, f"钻孔 {len(holes)} 个", GREEN, fs=4.4)
    box(ax, 0.820, 0.855, 0.100, 0.030, f"ODI点 {len(odi)} 个", GREEN, fs=4.4)
    box(ax, 0.820, 0.810, 0.100, 0.030, "参数 4 类", GREEN, fs=4.4)
    arrow(ax, (0.755, 0.870), (0.810, 0.870), GRAY, ms=6.0)

    # Panel 2: processing, three compact sub-panels plus operation chain.
    sub_x = [0.055, 0.250, 0.445]
    sub_titles = ["坐标统一与裁剪", "参数场插值", "ODI归一化"]
    plotters = [
        lambda a: draw_map(a, boundary, holes, "坐标/边界", odi["ODI_norm"], odi),
        lambda a: draw_field(a, params, boundary, "Hi", "Hi 插值场", "YlGnBu"),
        lambda a: draw_field(a, odi, boundary, "ODI_norm", "ODI 场", "YlOrRd"),
    ]
    for x, title, plotter in zip(sub_x, sub_titles, plotters):
        rect(ax, x, 0.575, 0.165, 0.145, ec=TEAL, fc="#FFFFFF", lw=0.45, ls=(0, (1.4, 1.4)))
        text(ax, x + 0.0825, 0.708, title, size=4.6)
        plotter(fig.add_axes([x + 0.020, 0.607, 0.125, 0.065]))
        box(ax, x + 0.030, 0.585, 0.105, 0.020, ["格式转换", "插值计算", "指标归一化"][sub_x.index(x)], TEAL, fs=3.8)
    for x in [0.225, 0.420]:
        arrow(ax, (x, 0.645), (x + 0.022, 0.645), TEAL, ms=5.2)
    for i, step in enumerate(["格式转换", "边界裁剪", "插值计算", "指标归一化", "图层叠加"]):
        box(ax, 0.705, 0.704 - i * 0.034, 0.085, 0.023, step, TEAL, fs=4.0)
        if i < 4:
            arrow(ax, (0.747, 0.704 - i * 0.034), (0.747, 0.694 - i * 0.034), TEAL, ms=4.6)
    arrow(ax, (0.792, 0.637), (0.830, 0.637), TEAL, ms=5.2)
    text(ax, 0.835, 0.637, "统一空间网格\n多图层叠加", size=4.9, ha="left")

    # Panel 3: layer outputs.
    out_x = [0.065, 0.250, 0.435, 0.620]
    plotters = [
        lambda a: draw_map(a, boundary, holes, "有效域"),
        lambda a: draw_field(a, coal, boundary, "coal_thickness", "煤厚资源", "YlOrBr"),
        lambda a: draw_field(a, odi, boundary, "ODI扰动", "YlOrRd") if False else draw_field(a, odi, boundary, "ODI_norm", "ODI扰动", "YlOrRd"),
        lambda a: draw_candidate(a, boundary),
    ]
    labels = ["有效布置域图层", "煤厚资源图层", "ODI扰动图层", "候选方案图层"]
    for x, pfun, lab in zip(out_x, plotters, labels):
        pfun(fig.add_axes([x, 0.365, 0.120, 0.075]))
        box(ax, x - 0.006, 0.333, 0.132, 0.026, lab, ORANGE if "ODI" not in lab else "#9A3E00", fs=4.2, bold="ODI" in lab)
    arrow(ax, (0.750, 0.395), (0.805, 0.395), ORANGE, ms=5.8)
    text(ax, 0.815, 0.395, "图层输出作为\n规划模型输入", size=5.0, ha="left")

    # Panel 4: planning.
    for i, step in enumerate(["方案生成", "约束筛选", "指标统计", "方案比选"]):
        box(ax, 0.070 + i * 0.112, 0.165, 0.082, 0.033, step, RED, fs=4.7, bold=i in (0, 3))
        if i < 3:
            arrow(ax, (0.154 + i * 0.112, 0.181), (0.180 + i * 0.112, 0.181), RED, ms=5.2)
    draw_stats(fig.add_axes([0.560, 0.125, 0.235, 0.082]), stats)
    arrow(ax, (0.805, 0.168), (0.840, 0.168), RED, ms=5.6)
    box(ax, 0.845, 0.145, 0.092, 0.046, "推荐方案\n与约束说明", RED, fs=4.2, bold=True)

    text(ax, 0.50, 0.030, "注：缩略图由本项目钻孔坐标、采区边界、钻孔分层、ODI评价点和方案统计数据生成。", size=4.3, color="#66727C")

    OUT.mkdir(parents=True, exist_ok=True)
    stem = OUT / "data_workflow_compact_reference"
    fig.savefig(stem.with_suffix(".svg"), bbox_inches="tight", pad_inches=0.025)
    fig.savefig(stem.with_suffix(".pdf"), bbox_inches="tight", pad_inches=0.025)
    fig.savefig(stem.with_suffix(".png"), dpi=900, bbox_inches="tight", pad_inches=0.025)
    plt.close(fig)


if __name__ == "__main__":
    draw()
