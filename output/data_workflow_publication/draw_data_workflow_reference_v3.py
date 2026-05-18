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

FONT = FontProperties(fname=r"C:\Windows\Fonts\simsun.ttc")
FONT_BOLD = FontProperties(fname=r"C:\Windows\Fonts\simhei.ttf")

mpl.rcParams["pdf.fonttype"] = 42
mpl.rcParams["ps.fonttype"] = 42
mpl.rcParams["svg.fonttype"] = "none"
mpl.rcParams["axes.unicode_minus"] = False

INK = "#1F2933"
BLUE = "#315F8C"
TEAL = "#4D8E88"
ORANGE = "#B56B1D"
RED = "#A84A4A"
GREEN = "#4F7D55"
GRAY = "#7F8A93"
PANEL_BG = "#FCFDFE"


def text(ax, x, y, s, size=6.0, bold=False, color=INK, ha="center", va="center", **kwargs):
    ax.text(
        x,
        y,
        s,
        ha=ha,
        va=va,
        fontsize=size,
        fontproperties=FONT_BOLD if bold else FONT,
        color=color,
        **kwargs,
    )


def rect(ax, x, y, w, h, ec=BLUE, fc="white", lw=0.75, ls="solid", z=1):
    ax.add_patch(Rectangle((x, y), w, h, facecolor=fc, edgecolor=ec, linewidth=lw, linestyle=ls, zorder=z))


def box(ax, x, y, w, h, label, ec=BLUE, fs=5.0, bold=False, fc="white"):
    rect(ax, x, y, w, h, ec=ec, fc=fc, lw=0.75)
    text(ax, x + w / 2, y + h / 2, label, size=fs, bold=bold)


def arrow(ax, p0, p1, color=GRAY, lw=0.70, ms=7.5):
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
            zorder=12,
        )
    )


def outer(ax, x, y, w, h, title, ec):
    rect(ax, x, y, w, h, ec=ec, fc=PANEL_BG, lw=0.85, ls=(0, (3, 2)), z=0)
    text(ax, x + w / 2, y + h - 0.020, title, size=6.6)


def clean(ax):
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_facecolor("white")


def inset_label(ax, label):
    ax.text(
        0.035,
        0.935,
        label,
        transform=ax.transAxes,
        ha="left",
        va="top",
        fontsize=4.4,
        fontproperties=FONT,
        color=INK,
        bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.78, "pad": 0.25},
        zorder=20,
    )


def draw_map_base(ax, bx, by):
    xmin, xmax = bx.min(), bx.max()
    ymin, ymax = by.min(), by.max()
    ax.fill(np.r_[bx, bx[0]], np.r_[by, by[0]], color="#F4F7FA", zorder=0)
    for gx in np.linspace(xmin, xmax, 5)[1:-1]:
        ax.plot([gx, gx], [ymin, ymax], color="#DDE5EC", lw=0.18, zorder=1)
    for gy in np.linspace(ymin, ymax, 4)[1:-1]:
        ax.plot([xmin, xmax], [gy, gy], color="#DDE5EC", lw=0.18, zorder=1)


def boundary_mask(xx, yy, bx, by):
    path = MplPath(np.column_stack([bx, by]))
    points = np.column_stack([xx.ravel(), yy.ravel()])
    return path.contains_points(points).reshape(xx.shape)


def mini_colorbar(ax, cmap, x=0.690, y=0.060, w=0.250, h=0.030):
    cmap_obj = plt.get_cmap(cmap)
    n = 16
    for i in range(n):
        ax.add_patch(
            Rectangle(
                (x + i * w / n, y),
                w / n,
                h,
                transform=ax.transAxes,
                facecolor=cmap_obj(i / (n - 1)),
                edgecolor="none",
                zorder=30,
            )
        )
    ax.add_patch(
        Rectangle((x, y), w, h, transform=ax.transAxes, facecolor="none", edgecolor="#5F6B73", linewidth=0.20, zorder=31)
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
        coal = df[df["name"].astype(str).str.contains("煤", na=False)]["thickness"].sum()
        coal_rows.append({"id": p.stem, "coal_thickness": coal})
    coal = pd.DataFrame(coal_rows).merge(holes, on="id", how="inner")
    return boundary, holes, odi, params, stats, coal


def rel(df, boundary, xcol, ycol):
    return (
        (df[xcol].to_numpy(float) - boundary["x"].min()) / 1000.0,
        (df[ycol].to_numpy(float) - boundary["y"].min()) / 1000.0,
    )


def set_limits(ax, boundary, extras=()):
    bx, by = rel(boundary, boundary, "x", "y")
    xs, ys = [bx], [by]
    for x, y in extras:
        xs.append(x)
        ys.append(y)
    x = np.concatenate(xs)
    y = np.concatenate(ys)
    dx = max(x.max() - x.min(), 1e-6)
    dy = max(y.max() - y.min(), 1e-6)
    ax.set_xlim(x.min() - 0.045 * dx, x.max() + 0.045 * dx)
    ax.set_ylim(y.min() - 0.075 * dy, y.max() + 0.075 * dy)
    ax.set_aspect("equal", adjustable="box")


def map_ax(ax, boundary, holes, label, values=None, value_df=None, cmap="YlOrRd"):
    clean(ax)
    bx, by = rel(boundary, boundary, "x", "y")
    hx, hy = rel(holes, boundary, "x", "y")
    draw_map_base(ax, bx, by)
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color=INK, lw=0.56, zorder=4)
    ax.scatter(hx, hy, s=11, facecolor="white", edgecolor=BLUE, linewidth=0.55, zorder=5)
    extras = [(hx, hy)]
    if values is not None and value_df is not None:
        xcol, ycol = ("X", "Y") if "X" in value_df.columns else ("x", "y")
        vx, vy = rel(value_df, boundary, xcol, ycol)
        ax.scatter(vx, vy, s=32, facecolor="white", edgecolor="#2B2F33", linewidth=0.28, zorder=6)
        ax.scatter(vx, vy, c=values, cmap=cmap, s=20, edgecolor="white", linewidth=0.18, zorder=7)
        mini_colorbar(ax, cmap)
        extras.append((vx, vy))
    set_limits(ax, boundary, extras)
    inset_label(ax, label)


def field_ax(ax, df, boundary, col, label, cmap):
    clean(ax)
    bx, by = rel(boundary, boundary, "x", "y")
    xcol, ycol = ("X", "Y") if "X" in df.columns else ("x", "y")
    x, y = rel(df, boundary, xcol, ycol)
    z = df[col].to_numpy(float)
    xx, yy = np.meshgrid(np.linspace(bx.min(), bx.max(), 96), np.linspace(by.min(), by.max(), 96))
    linear = griddata((x, y), z, (xx, yy), method="linear")
    nearest = griddata((x, y), z, (xx, yy), method="nearest")
    zz = np.where(np.isfinite(linear), linear, nearest)
    zz = np.ma.array(zz, mask=~boundary_mask(xx, yy, bx, by))
    draw_map_base(ax, bx, by)
    ax.contourf(xx, yy, zz, levels=10, cmap=cmap, alpha=0.97, zorder=2)
    ax.contour(xx, yy, zz, levels=5, colors="white", linewidths=0.16, alpha=0.65, zorder=3)
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color=INK, lw=0.54, zorder=4)
    ax.scatter(x, y, s=13, facecolor="white", edgecolor="#333333", linewidth=0.30, zorder=5)
    mini_colorbar(ax, cmap)
    set_limits(ax, boundary, [(x, y)])
    inset_label(ax, label)


def lith_ax(ax):
    clean(ax)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.add_patch(Rectangle((0.04, 0.10), 0.92, 0.78, facecolor="#F7F8FA", edgecolor="#E0E5EA", lw=0.20))
    colors = {
        "煤": "#292929",
        "砂岩": "#D9C183",
        "泥岩": "#9E9E9E",
        "砾岩": "#B78355",
        "土": "#7EA064",
    }
    for i, hid in enumerate(["50-14", "52-18", "54-17"]):
        df = pd.read_csv(ROOT / "data" / "钻孔分层数据" / f"{hid}.csv", encoding="utf-8-sig").head(20)
        total = df["thickness"].sum()
        y0 = 0.13
        for _, row in df.iterrows():
            color = "#D8D8D8"
            for key, val in colors.items():
                if key in str(row["name"]):
                    color = val
                    break
            h = max(0.010, 0.73 * float(row["thickness"]) / total)
            ax.add_patch(Rectangle((0.16 + i * 0.29, y0), 0.12, h, facecolor=color, edgecolor="white", lw=0.10))
            y0 += h
        ax.add_patch(Rectangle((0.16 + i * 0.29, 0.13), 0.12, 0.73, facecolor="none", edgecolor="#5F6B73", lw=0.25))
        text(ax, 0.22 + i * 0.29, 0.055, hid, size=4.0)
    inset_label(ax, "钻孔分层")


def candidate_ax(ax, boundary):
    clean(ax)
    bx, by = rel(boundary, boundary, "x", "y")
    draw_map_base(ax, bx, by)
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color=INK, lw=0.54, zorder=5)
    xmin, xmax = bx.min(), bx.max()
    ymin, ymax = by.min(), by.max()
    colors = ["#CFE3F8", "#DCECCF", "#FFE5B6", "#EBCBCB"]
    edges = ["#315F8C", "#4F7D55", "#B56B1D", "#A84A4A"]
    for i, (color, edge) in enumerate(zip(colors, edges)):
        yy = ymin + (i + 1.05) * (ymax - ymin) / 6.1
        poly = np.array(
            [
                [xmin + 0.50, yy],
                [xmax - 0.20, yy + 0.12],
                [xmax - 0.12, yy + 0.25],
                [xmin + 0.58, yy + 0.13],
            ]
        )
        ax.add_patch(Polygon(poly + np.array([0.020, -0.018]), closed=True, facecolor="#8A949C", edgecolor="none", alpha=0.20, zorder=2))
        ax.add_patch(Polygon(poly, closed=True, facecolor=color, edgecolor=edge, lw=0.36, zorder=3))
        cx, cy = poly.mean(axis=0)
        ax.text(cx, cy, chr(65 + i), ha="center", va="center", fontsize=3.6, fontproperties=FONT_BOLD, color=edge, zorder=4)
    set_limits(ax, boundary)
    inset_label(ax, "候选方案")


def stats_ax(ax, stats):
    clean(ax)
    labels = stats["plan_code"].astype(str).to_list()
    x = np.arange(len(labels))
    coverage = stats["coverage_pct"].to_numpy(float) / 100.0
    risk = stats["risk_score"].to_numpy(float)
    width = 0.30
    ax.bar(x - width / 2, coverage, width, color="#92BCA6", edgecolor=GREEN, lw=0.40, label="覆盖率")
    ax.bar(x + width / 2, risk, width, color="#DEA15F", edgecolor=ORANGE, lw=0.40, label="风险")
    ax.set_ylim(0, 1.05)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontproperties=FONT, fontsize=4.5)
    ax.set_yticks([0, 0.5, 1.0])
    ax.set_yticklabels(["0", "0.5", "1.0"], fontproperties=FONT, fontsize=4.2)
    ax.grid(axis="y", color="#E2E6EA", lw=0.28)
    for spine in ax.spines.values():
        spine.set_visible(True)
        spine.set_color("#CED6DE")
        spine.set_linewidth(0.35)
    ax.legend(
        prop=FontProperties(fname=r"C:\Windows\Fonts\simsun.ttc", size=4.1),
        frameon=False,
        loc="upper left",
        ncol=2,
        handlelength=0.85,
        columnspacing=0.55,
    )
    inset_label(ax, "方案指标")


def draw():
    boundary, holes, odi, params, stats, coal = load_data()

    fig = plt.figure(figsize=(7.2, 7.5), dpi=300)
    fig.patch.set_facecolor("white")
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    panels = [
        (0.035, 0.810, 0.930, 0.155, "数据来源与分类", BLUE),
        (0.035, 0.535, 0.930, 0.235, "空间处理与指标构建", TEAL),
        (0.035, 0.315, 0.930, 0.180, "图层输出与模型输入", ORANGE),
        (0.035, 0.075, 0.930, 0.200, "规划应用与决策输出", RED),
    ]
    for p in panels:
        outer(ax, *p)
    for y0, y1 in [(0.810, 0.770), (0.535, 0.495), (0.315, 0.275)]:
        arrow(ax, (0.500, y0), (0.500, y1), ms=8.5)

    # 1. Data sources and classification.
    box(ax, 0.060, 0.895, 0.155, 0.027, "矿井地质资料", BLUE, fs=4.8)
    box(ax, 0.245, 0.895, 0.155, 0.027, "钻孔资料", BLUE, fs=4.8)
    box(ax, 0.430, 0.895, 0.155, 0.027, "采区设计图件", BLUE, fs=4.8)
    box(ax, 0.615, 0.895, 0.155, 0.027, "扰动评价结果", BLUE, fs=4.8)
    map_ax(fig.add_axes([0.075, 0.827, 0.140, 0.060]), boundary, holes, "边界/钻孔")
    lith_ax(fig.add_axes([0.250, 0.827, 0.135, 0.060]))
    field_ax(fig.add_axes([0.445, 0.827, 0.125, 0.060]), params, boundary, "Hi", "参数场", "YlGnBu")
    field_ax(fig.add_axes([0.625, 0.827, 0.125, 0.060]), odi, boundary, "ODI_norm", "ODI场", "YlOrRd")
    arrow(ax, (0.765, 0.858), (0.797, 0.858), BLUE, ms=7.5)
    for (x, y, label) in [
        (0.805, 0.870, "基础地质"),
        (0.890, 0.870, "工程约束"),
        (0.805, 0.833, "覆岩扰动"),
        (0.890, 0.833, "规划参数"),
    ]:
        box(ax, x, y, 0.070, 0.025, label, GREEN, fs=4.3)
    text(ax, 0.882, 0.817, f"钻孔 {len(holes)} 个  |  ODI点 {len(odi)} 个  |  参数 4 类", size=3.8, ha="center")

    # 2. Spatial processing and index construction.
    sub_x = [0.065, 0.370, 0.675]
    titles = ["坐标统一与裁剪", "参数场插值", "ODI归一化"]
    plots = [
        lambda aa: map_ax(aa, boundary, holes, "坐标/边界", odi["ODI_norm"], odi),
        lambda aa: field_ax(aa, params, boundary, "Hi", "Hi插值场", "YlGnBu"),
        lambda aa: field_ax(aa, odi, boundary, "ODI_norm", "ODI场", "YlOrRd"),
    ]
    bottoms = [
        ("格式转换", "边界裁剪"),
        ("插值计算", "网格构建"),
        ("指标归一化", "图层叠加"),
    ]
    for x, title, plot, ops in zip(sub_x, titles, plots, bottoms):
        rect(ax, x, 0.565, 0.250, 0.160, ec=TEAL, fc="white", lw=0.60, ls=(0, (1.5, 1.5)))
        text(ax, x + 0.125, 0.708, title, size=5.5)
        plot(fig.add_axes([x + 0.040, 0.610, 0.170, 0.070]))
        box(ax, x + 0.043, 0.582, 0.074, 0.022, ops[0], TEAL, fs=4.2)
        box(ax, x + 0.133, 0.582, 0.074, 0.022, ops[1], TEAL, fs=4.2)
    arrow(ax, (0.323, 0.642), (0.360, 0.642), TEAL, ms=7.5)
    arrow(ax, (0.628, 0.642), (0.665, 0.642), TEAL, ms=7.5)

    # 3. Layer output and model input.
    out_x = [0.075, 0.275, 0.475, 0.675]
    out_plots = [
        lambda aa: map_ax(aa, boundary, holes, "有效域"),
        lambda aa: field_ax(aa, coal, boundary, "coal_thickness", "煤厚资源", "YlOrBr"),
        lambda aa: field_ax(aa, odi, boundary, "ODI_norm", "ODI扰动", "YlOrRd"),
        lambda aa: candidate_ax(aa, boundary),
    ]
    out_labels = ["有效布置域图层", "煤厚资源图层", "ODI扰动图层", "候选方案图层"]
    for x, plot, label in zip(out_x, out_plots, out_labels):
        plot(fig.add_axes([x, 0.370, 0.125, 0.063]))
        box(ax, x - 0.010, 0.340, 0.145, 0.024, label, ORANGE, fs=4.6, bold=label.startswith("ODI"))
    arrow(ax, (0.825, 0.387), (0.855, 0.387), ORANGE, ms=7.5)
    box(ax, 0.860, 0.355, 0.075, 0.065, "模型\n输入", ORANGE, fs=5.0, bold=True)

    # 4. Planning application.
    for i, step in enumerate(["方案生成", "约束筛选", "指标统计", "方案比选"]):
        box(ax, 0.070 + i * 0.130, 0.167, 0.095, 0.035, step, RED, fs=5.0, bold=i in (0, 3))
        if i < 3:
            arrow(ax, (0.167 + i * 0.130, 0.184), (0.196 + i * 0.130, 0.184), RED, ms=7.0)
    stats_ax(fig.add_axes([0.585, 0.125, 0.210, 0.092]), stats)
    arrow(ax, (0.800, 0.170), (0.835, 0.170), RED, ms=7.5)
    labels = [("A", "效率优先", "#DDEBFA"), ("B", "资源优先", "#E5F0D9"), ("C", "低扰动", "#FFF0D5"), ("D", "不推荐", "#F2DCDC")]
    for i, (code, name, color) in enumerate(labels):
        y = 0.215 - i * 0.035
        rect(ax, 0.845, y, 0.085, 0.024, ec=RED, fc=color, lw=0.55, ls=(0, (1, 1)))
        text(ax, 0.887, y + 0.012, f"{code}  {name}", size=4.3, bold=(code == "B"))

    text(
        ax,
        0.500,
        0.035,
        "注：缩略图由采区边界、钻孔坐标、钻孔分层、ODI评价点与方案统计数据生成；比例尺仅用于流程说明。",
        size=4.7,
        color="#66727C",
    )

    OUT.mkdir(parents=True, exist_ok=True)
    stem = OUT / "data_workflow_reference_v3"
    fig.savefig(stem.with_suffix(".svg"), bbox_inches="tight", pad_inches=0.020)
    fig.savefig(stem.with_suffix(".pdf"), bbox_inches="tight", pad_inches=0.020)
    fig.savefig(stem.with_suffix(".png"), dpi=900, bbox_inches="tight", pad_inches=0.020)
    plt.close(fig)


if __name__ == "__main__":
    draw()
