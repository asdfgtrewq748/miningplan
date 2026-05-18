from __future__ import annotations

from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.font_manager import FontProperties
from matplotlib.patches import FancyArrowPatch, Polygon, Rectangle
from matplotlib.path import Path as MplPath
from scipy.interpolate import griddata


ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent

FONT_SONG = FontProperties(fname=r"C:\Windows\Fonts\simsun.ttc")
FONT_HEI = FontProperties(fname=r"C:\Windows\Fonts\simhei.ttf")
FONT_TIMES = FontProperties(fname=r"C:\Windows\Fonts\times.ttf")

mpl.rcParams["pdf.fonttype"] = 42
mpl.rcParams["ps.fonttype"] = 42
mpl.rcParams["svg.fonttype"] = "none"
mpl.rcParams["axes.unicode_minus"] = False

INK = "#222831"
BLUE = "#1F4E79"
BLUE2 = "#456B8A"
GRAY = "#6B747C"
LIGHT = "#F7F9FB"
VERY_LIGHT = "#FBFCFD"
LINE = "#C9D3DC"
GREEN = "#496B57"
ORANGE = "#9B5A1B"
RED = "#8E3C3C"


def cn(ax, x, y, s, size=7, bold=False, color=INK, ha="center", va="center", **kwargs):
    ax.text(
        x,
        y,
        s,
        fontsize=size,
        fontproperties=FONT_HEI if bold else FONT_SONG,
        color=color,
        ha=ha,
        va=va,
        **kwargs,
    )


def en(ax, x, y, s, size=5.5, bold=False, color=INK, ha="center", va="center", **kwargs):
    ax.text(
        x,
        y,
        s,
        fontsize=size,
        fontproperties=FONT_TIMES,
        fontweight="bold" if bold else "normal",
        color=color,
        ha=ha,
        va=va,
        **kwargs,
    )


def rect(ax, x, y, w, h, ec=BLUE, fc="white", lw=0.65, ls="solid", z=1):
    ax.add_patch(Rectangle((x, y), w, h, facecolor=fc, edgecolor=ec, linewidth=lw, linestyle=ls, zorder=z))


def box(ax, x, y, w, h, label, ec=BLUE, fc="white", fs=6.4, bold=False, lw=0.65):
    rect(ax, x, y, w, h, ec=ec, fc=fc, lw=lw)
    cn(ax, x + w / 2, y + h / 2, label, size=fs, bold=bold)


def arrow(ax, p0, p1, color=GRAY, lw=0.72, ms=7.5):
    ax.add_patch(
        FancyArrowPatch(
            p0,
            p1,
            arrowstyle="-|>",
            mutation_scale=ms,
            linewidth=lw,
            color=color,
            shrinkA=0,
            shrinkB=0,
            zorder=20,
        )
    )


def layer(ax, x, y, w, h, title, letter):
    rect(ax, x, y, w, h, ec=LINE, fc=VERY_LIGHT, lw=0.62)
    rect(ax, x + 0.010, y + h - 0.046, 0.145, 0.032, ec=BLUE, fc="#EEF4F9", lw=0.42)
    en(ax, x + 0.030, y + h - 0.030, letter, size=5.3, bold=True, color=BLUE)
    cn(ax, x + 0.083, y + h - 0.030, title, size=5.8, bold=True, color=BLUE, ha="left")


def clean(ax):
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_facecolor("white")


def label(ax, s):
    ax.text(
        0.025,
        0.925,
        s,
        transform=ax.transAxes,
        fontsize=4.6,
        fontproperties=FONT_SONG,
        ha="left",
        va="top",
        color=INK,
        bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.78, "pad": 0.2},
        zorder=30,
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
        (df[xcol].to_numpy(float) - boundary["x"].min()) / 1000.0,
        (df[ycol].to_numpy(float) - boundary["y"].min()) / 1000.0,
    )


def bounds(ax, boundary, extras=()):
    bx, by = rel(boundary, boundary, "x", "y")
    xs, ys = [bx], [by]
    for x, y in extras:
        xs.append(x)
        ys.append(y)
    x = np.concatenate(xs)
    y = np.concatenate(ys)
    dx = max(x.max() - x.min(), 1e-6)
    dy = max(y.max() - y.min(), 1e-6)
    ax.set_xlim(x.min() - 0.035 * dx, x.max() + 0.035 * dx)
    ax.set_ylim(y.min() - 0.070 * dy, y.max() + 0.070 * dy)
    ax.set_aspect("equal", adjustable="box")


def mask_polygon(xx, yy, bx, by):
    path = MplPath(np.column_stack([bx, by]))
    return path.contains_points(np.column_stack([xx.ravel(), yy.ravel()])).reshape(xx.shape)


def map_base(ax, bx, by):
    xmin, xmax = bx.min(), bx.max()
    ymin, ymax = by.min(), by.max()
    ax.fill(np.r_[bx, bx[0]], np.r_[by, by[0]], color="#F1F5F8", zorder=0)
    for gx in np.linspace(xmin, xmax, 5)[1:-1]:
        ax.plot([gx, gx], [ymin, ymax], color="#DDE6ED", lw=0.16, zorder=1)
    for gy in np.linspace(ymin, ymax, 4)[1:-1]:
        ax.plot([xmin, xmax], [gy, gy], color="#DDE6ED", lw=0.16, zorder=1)


def map_plot(ax, boundary, holes, title, values=None, value_df=None, cmap="YlOrRd"):
    clean(ax)
    bx, by = rel(boundary, boundary, "x", "y")
    hx, hy = rel(holes, boundary, "x", "y")
    map_base(ax, bx, by)
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color=INK, lw=0.50, zorder=5)
    ax.scatter(hx, hy, s=7.5, facecolor="white", edgecolor=BLUE2, linewidth=0.45, zorder=6)
    extras = [(hx, hy)]
    if values is not None and value_df is not None:
        xcol, ycol = ("X", "Y") if "X" in value_df.columns else ("x", "y")
        vx, vy = rel(value_df, boundary, xcol, ycol)
        ax.scatter(vx, vy, s=18, c=values, cmap=cmap, edgecolor="white", linewidth=0.22, zorder=8)
        extras.append((vx, vy))
    bounds(ax, boundary, extras)
    label(ax, title)


def field_plot(ax, df, boundary, col, title, cmap):
    clean(ax)
    bx, by = rel(boundary, boundary, "x", "y")
    xcol, ycol = ("X", "Y") if "X" in df.columns else ("x", "y")
    x, y = rel(df, boundary, xcol, ycol)
    z = df[col].to_numpy(float)
    xx, yy = np.meshgrid(np.linspace(bx.min(), bx.max(), 92), np.linspace(by.min(), by.max(), 92))
    linear = griddata((x, y), z, (xx, yy), method="linear")
    nearest = griddata((x, y), z, (xx, yy), method="nearest")
    zz = np.where(np.isfinite(linear), linear, nearest)
    zz = np.ma.array(zz, mask=~mask_polygon(xx, yy, bx, by))
    map_base(ax, bx, by)
    ax.contourf(xx, yy, zz, levels=9, cmap=cmap, alpha=0.94, zorder=2)
    ax.contour(xx, yy, zz, levels=4, colors="white", linewidths=0.15, alpha=0.70, zorder=3)
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color=INK, lw=0.50, zorder=5)
    ax.scatter(x, y, s=8, facecolor="white", edgecolor="#333333", linewidth=0.25, zorder=6)
    bounds(ax, boundary, [(x, y)])
    label(ax, title)


def lithology_plot(ax):
    clean(ax)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    rect(ax, 0.060, 0.120, 0.880, 0.760, ec="#DEE5EA", fc="#F6F8FA", lw=0.24)
    colors = {"煤": "#2B2B2B", "砂岩": "#D6BD7C", "泥岩": "#9E9E9E", "砾岩": "#B8855B", "土": "#7FA06A"}
    for i, hid in enumerate(["50-14", "52-18", "54-17"]):
        df = pd.read_csv(ROOT / "data" / "钻孔分层数据" / f"{hid}.csv", encoding="utf-8-sig").head(20)
        total = df["thickness"].sum()
        y0 = 0.150
        for _, row in df.iterrows():
            color = "#D6D6D6"
            for key, val in colors.items():
                if key in str(row["name"]):
                    color = val
                    break
            h = max(0.010, 0.670 * float(row["thickness"]) / total)
            ax.add_patch(Rectangle((0.185 + i * 0.285, y0), 0.100, h, facecolor=color, edgecolor="white", lw=0.08))
            y0 += h
        rect(ax, 0.185 + i * 0.285, 0.150, 0.100, 0.670, ec="#63707A", fc="none", lw=0.20)
        cn(ax, 0.235 + i * 0.285, 0.065, hid, size=4.0)
    label(ax, "钻孔分层")


def candidate_plot(ax, boundary):
    clean(ax)
    bx, by = rel(boundary, boundary, "x", "y")
    map_base(ax, bx, by)
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color=INK, lw=0.50, zorder=5)
    xmin, xmax = bx.min(), bx.max()
    ymin, ymax = by.min(), by.max()
    colors = ["#DDE9F6", "#E2EBD8", "#FFF1D2", "#F2DDDD"]
    edges = [BLUE, GREEN, ORANGE, RED]
    for i, (color, edge) in enumerate(zip(colors, edges)):
        yy = ymin + (i + 1.02) * (ymax - ymin) / 6.25
        poly = np.array([[xmin + 0.48, yy], [xmax - 0.18, yy + 0.10], [xmax - 0.10, yy + 0.22], [xmin + 0.56, yy + 0.13]])
        ax.add_patch(Polygon(poly, closed=True, facecolor=color, edgecolor=edge, lw=0.32, zorder=4))
        cx, cy = poly.mean(axis=0)
        en(ax, cx, cy, chr(65 + i), size=4.0, bold=True, color=edge)
    bounds(ax, boundary)
    label(ax, "候选方案")


def stats_plot(ax, stats):
    clean(ax)
    labels = stats["plan_code"].astype(str).to_numpy()
    x = np.arange(len(labels))
    coverage = stats["coverage_pct"].to_numpy(float) / 100.0
    risk = stats["risk_score"].to_numpy(float)
    width = 0.30
    ax.bar(x - width / 2, coverage, width, color="#AFC9BD", edgecolor=GREEN, linewidth=0.38)
    ax.bar(x + width / 2, risk, width, color="#D9A566", edgecolor=ORANGE, linewidth=0.38)
    ax.set_ylim(0, 1.05)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontproperties=FONT_TIMES, fontsize=4.4)
    ax.set_yticks([0, 0.5, 1.0])
    ax.set_yticklabels(["0", "0.5", "1.0"], fontproperties=FONT_TIMES, fontsize=4.0)
    ax.grid(axis="y", color="#E3E7EA", lw=0.24)
    for spine in ax.spines.values():
        spine.set_visible(True)
        spine.set_color("#CDD5DB")
        spine.set_linewidth(0.28)
    cn(ax, 0.030, 0.900, "方案指标", size=4.5, ha="left", transform=ax.transAxes)
    ax.scatter([], [], marker="s", s=16, color="#AFC9BD", edgecolor=GREEN, label="覆盖率")
    ax.scatter([], [], marker="s", s=16, color="#D9A566", edgecolor=ORANGE, label="风险")
    ax.legend(prop=FontProperties(fname=r"C:\Windows\Fonts\simsun.ttc", size=3.7), frameon=False, loc="upper right", ncol=2, handletextpad=0.35, columnspacing=0.50)


def add_img(fig, pos, drawer):
    ax = fig.add_axes(pos)
    drawer(ax)
    return ax


def draw():
    boundary, holes, odi, params, stats, coal = load_data()

    fig = plt.figure(figsize=(7.48, 4.55), dpi=300)
    fig.patch.set_facecolor("white")
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    left, width = 0.035, 0.930
    rows = [
        (0.765, 0.195, "数据来源与分类", "A"),
        (0.510, 0.210, "空间处理与指标构建", "B"),
        (0.295, 0.165, "图层输出与模型输入", "C"),
        (0.070, 0.175, "规划应用与决策输出", "D"),
    ]
    for y, h, title, letter in rows:
        layer(ax, left, y, width, h, title, letter)
    for y0, y1 in [(0.765, 0.720), (0.510, 0.460), (0.295, 0.245)]:
        arrow(ax, (0.50, y0), (0.50, y1), ms=8.0)

    # A. Data source and classification.
    source_x = [0.075, 0.205, 0.335, 0.465, 0.595]
    source_labels = ["矿井地质资料", "钻孔资料", "采区设计图件", "扰动评价结果", "工作面规划参数"]
    for x, s in zip(source_x, source_labels):
        box(ax, x, 0.870, 0.108, 0.033, s, ec=BLUE, fc="white", fs=5.1, bold=False)
    add_img(fig, [0.080, 0.795, 0.100, 0.056], lambda aa: map_plot(aa, boundary, holes, "边界/钻孔"))
    add_img(fig, [0.212, 0.795, 0.100, 0.056], lithology_plot)
    add_img(fig, [0.345, 0.795, 0.100, 0.056], lambda aa: field_plot(aa, params, boundary, "Hi", "参数场", "YlGnBu"))
    add_img(fig, [0.475, 0.795, 0.100, 0.056], lambda aa: field_plot(aa, odi, boundary, "ODI_norm", "ODI场", "YlOrRd"))
    add_img(fig, [0.603, 0.795, 0.100, 0.056], lambda aa: candidate_plot(aa, boundary))
    arrow(ax, (0.715, 0.827), (0.755, 0.827), color=BLUE2, ms=7.0)
    cn(ax, 0.850, 0.887, "数据分类", size=5.4, bold=True, color=BLUE)
    cat = ["基础地质数据", "工程约束数据", "覆岩扰动数据", "规划参数数据"]
    for i, s in enumerate(cat):
        x = 0.765 + (i % 2) * 0.105
        y = 0.843 - (i // 2) * 0.043
        box(ax, x, y, 0.090, 0.029, s, ec=BLUE2, fc="white", fs=4.4)

    # B. Spatial processing.
    modules = [
        (0.090, "坐标统一", lambda aa: map_plot(aa, boundary, holes, "坐标/边界", odi["ODI_norm"], odi), ("坐标统一", "边界裁剪")),
        (0.390, "参数场插值", lambda aa: field_plot(aa, params, boundary, "Hi", "Hi插值场", "YlGnBu"), ("插值计算", "网格构建")),
        (0.690, "ODI归一化", lambda aa: field_plot(aa, odi, boundary, "ODI_norm", "ODI场", "YlOrRd"), ("归一化", "图层叠加")),
    ]
    for x, title, drawer, tags in modules:
        rect(ax, x - 0.012, 0.535, 0.215, 0.130, ec=LINE, fc="white", lw=0.48)
        cn(ax, x + 0.095, 0.648, title, size=5.9, bold=True)
        add_img(fig, [x + 0.022, 0.578, 0.145, 0.052], drawer)
        box(ax, x + 0.013, 0.546, 0.074, 0.024, tags[0], ec=BLUE2, fc="white", fs=4.1, lw=0.45)
        box(ax, x + 0.105, 0.546, 0.074, 0.024, tags[1], ec=BLUE2, fc="white", fs=4.1, lw=0.45)
    arrow(ax, (0.302, 0.600), (0.365, 0.600), color=BLUE2, ms=7.0)
    arrow(ax, (0.602, 0.600), (0.665, 0.600), color=BLUE2, ms=7.0)

    # C. Layer output and model input.
    outputs = [
        (0.075, lambda aa: map_plot(aa, boundary, holes, "有效域"), "有效布置域图层"),
        (0.270, lambda aa: field_plot(aa, coal, boundary, "coal_thickness", "煤厚资源", "YlOrBr"), "煤厚资源图层"),
        (0.465, lambda aa: field_plot(aa, odi, boundary, "ODI_norm", "ODI扰动", "YlOrRd"), "ODI扰动图层"),
        (0.660, lambda aa: candidate_plot(aa, boundary), "候选方案图层"),
    ]
    for x, drawer, s in outputs:
        add_img(fig, [x, 0.350, 0.118, 0.055], drawer)
        box(ax, x - 0.005, 0.315, 0.128, 0.030, s, ec=BLUE2, fc="white", fs=5.2, bold=s.startswith("ODI"))
    arrow(ax, (0.790, 0.365), (0.840, 0.365), color=BLUE2, ms=7.5)
    box(ax, 0.850, 0.330, 0.085, 0.065, "规划模型输入", ec=BLUE, fc="white", fs=5.4, bold=True)

    # D. Planning and output.
    for i, s in enumerate(["方案生成", "约束筛选", "指标统计", "方案比选"]):
        x = 0.085 + i * 0.135
        box(ax, x, 0.145, 0.086, 0.035, s, ec=BLUE2, fc="white", fs=5.8, bold=True)
        if i < 3:
            arrow(ax, (x + 0.090, 0.162), (x + 0.125, 0.162), color=BLUE2, ms=6.8)
    add_img(fig, [0.590, 0.118, 0.175, 0.073], lambda aa: stats_plot(aa, stats))
    arrow(ax, (0.770, 0.155), (0.810, 0.155), color=BLUE2, ms=7.5)
    schemes = [
        ("效率优先方案", "#EFF5FB"),
        ("资源回收优先方案", "#F3F7EF"),
        ("低扰动优先方案", "#FFF7E8"),
        ("不推荐方案", "#FAEEEE"),
    ]
    for i, (s, fill) in enumerate(schemes):
        box(ax, 0.810, 0.205 - i * 0.035, 0.130, 0.026, s, ec=BLUE2, fc=fill, fs=4.1, bold=i == 1, lw=0.42)

    stem = OUT / "figure2_journal"
    fig.savefig(stem.with_suffix(".png"), dpi=600, bbox_inches="tight", pad_inches=0.025)
    fig.savefig(stem.with_suffix(".svg"), bbox_inches="tight", pad_inches=0.025)
    fig.savefig(stem.with_suffix(".pdf"), bbox_inches="tight", pad_inches=0.025)
    plt.close(fig)


if __name__ == "__main__":
    draw()
