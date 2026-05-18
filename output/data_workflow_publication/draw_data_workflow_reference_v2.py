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


def t(ax, x, y, s, size=5.4, bold=False, color=INK, ha="center", va="center", **kw):
    ax.text(x, y, s, fontsize=size, fontproperties=FONT_BOLD if bold else FONT, color=color, ha=ha, va=va, **kw)


def r(ax, x, y, w, h, ec=BLUE, fc="white", lw=0.58, ls="solid"):
    ax.add_patch(Rectangle((x, y), w, h, facecolor=fc, edgecolor=ec, linewidth=lw, linestyle=ls, zorder=1))


def b(ax, x, y, w, h, label, ec=BLUE, fs=4.5, bold=False, fc="white"):
    r(ax, x, y, w, h, ec=ec, fc=fc, lw=0.58)
    t(ax, x + w / 2, y + h / 2, label, size=fs, bold=bold)


def arr(ax, p0, p1, color=GRAY, lw=0.56, ms=6.4):
    ax.add_patch(FancyArrowPatch(p0, p1, arrowstyle="-|>", mutation_scale=ms, linewidth=lw, color=color, shrinkA=0, shrinkB=0, zorder=8))


def outer(ax, x, y, w, h, title, ec=BLUE):
    r(ax, x, y, w, h, ec=ec, fc=LIGHT, lw=0.68, ls=(0, (3, 2)))
    t(ax, x + w / 2, y + h - 0.018, title, size=5.8)


def clean(ax):
    ax.set_xticks([])
    ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_facecolor("white")


def ilabel(ax, label):
    ax.text(
        0.03,
        0.95,
        label,
        transform=ax.transAxes,
        ha="left",
        va="top",
        fontsize=3.7,
        fontproperties=FONT,
        color=INK,
        bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.78, "pad": 0.25},
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


def limits(ax, boundary, extras=()):
    bx, by = rel(boundary, boundary, "x", "y")
    xs, ys = [bx], [by]
    for x, y in extras:
        xs.append(x)
        ys.append(y)
    x = np.concatenate(xs)
    y = np.concatenate(ys)
    ax.set_xlim(x.min() - 0.06 * (x.max() - x.min()), x.max() + 0.06 * (x.max() - x.min()))
    ax.set_ylim(y.min() - 0.09 * (y.max() - y.min()), y.max() + 0.09 * (y.max() - y.min()))
    ax.set_aspect("equal", adjustable="box")


def map_ax(ax, boundary, holes, label, values=None, vdf=None):
    clean(ax)
    bx, by = rel(boundary, boundary, "x", "y")
    hx, hy = rel(holes, boundary, "x", "y")
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color=INK, lw=0.42)
    ax.scatter(hx, hy, s=4.8, facecolor="white", edgecolor=BLUE, linewidth=0.36)
    ex = [(hx, hy)]
    if values is not None and vdf is not None:
        xcol, ycol = ("X", "Y") if "X" in vdf.columns else ("x", "y")
        vx, vy = rel(vdf, boundary, xcol, ycol)
        ax.scatter(vx, vy, c=values, cmap="YlOrRd", s=7.2, edgecolor="#333", linewidth=0.12)
        ex.append((vx, vy))
    limits(ax, boundary, ex)
    ilabel(ax, label)


def field_ax(ax, data, boundary, col, label, cmap):
    clean(ax)
    bx, by = rel(boundary, boundary, "x", "y")
    xcol, ycol = ("X", "Y") if "X" in data.columns else ("x", "y")
    x, y = rel(data, boundary, xcol, ycol)
    z = data[col].to_numpy(float)
    xx, yy = np.meshgrid(np.linspace(bx.min(), bx.max(), 65), np.linspace(by.min(), by.max(), 65))
    lin = griddata((x, y), z, (xx, yy), method="linear")
    near = griddata((x, y), z, (xx, yy), method="nearest")
    zz = np.where(np.isfinite(lin), lin, near)
    ax.contourf(xx, yy, zz, levels=8, cmap=cmap, alpha=0.96)
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color=INK, lw=0.38)
    ax.scatter(x, y, s=3.5, facecolor="white", edgecolor="#333", linewidth=0.14)
    limits(ax, boundary, [(x, y)])
    ilabel(ax, label)


def lith_ax(ax):
    clean(ax)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    colors = {"煤": "#303030", "砂": "#D7C08A", "泥": "#9E9E9E", "砾": "#B78355", "土": "#7EA064"}
    for i, hid in enumerate(["50-14", "52-18", "54-17"]):
        df = pd.read_csv(ROOT / "data" / "钻孔分层数据" / f"{hid}.csv", encoding="utf-8-sig").head(20)
        total = df["thickness"].sum()
        y = 0.13
        for _, row in df.iterrows():
            c = "#D8D8D8"
            for key, val in colors.items():
                if key in str(row["name"]):
                    c = val
                    break
            h = max(0.009, 0.72 * float(row["thickness"]) / total)
            ax.add_patch(Rectangle((0.17 + i * 0.28, y), 0.115, h, facecolor=c, edgecolor="white", lw=0.08))
            y += h
        t(ax, 0.228 + i * 0.28, 0.052, hid, size=3.3)
    ilabel(ax, "钻孔分层")


def candidate_ax(ax, boundary):
    clean(ax)
    bx, by = rel(boundary, boundary, "x", "y")
    ax.plot(np.r_[bx, bx[0]], np.r_[by, by[0]], color=INK, lw=0.38)
    xmin, xmax = bx.min(), bx.max()
    ymin, ymax = by.min(), by.max()
    for i, color in enumerate(["#DDEBFA", "#E5F0D9", "#FFF0D5", "#F2DCDC"]):
        yy = ymin + (i + 1.15) * (ymax - ymin) / 6.2
        poly = np.array([[xmin + 0.50, yy], [xmax - 0.22, yy + 0.12], [xmax - 0.13, yy + 0.24], [xmin + 0.58, yy + 0.13]])
        ax.add_patch(Polygon(poly, closed=True, facecolor=color, edgecolor="#555", lw=0.28))
    limits(ax, boundary)
    ilabel(ax, "候选方案")


def stats_ax(ax, stats):
    clean(ax)
    labels = stats["plan_code"].astype(str).to_list()
    x = np.arange(len(labels))
    coverage = stats["coverage_pct"].to_numpy(float) / 100
    risk = stats["risk_score"].to_numpy(float)
    width = 0.31
    ax.bar(x - width / 2, coverage, width, color="#95BDAA", edgecolor=GREEN, lw=0.33, label="覆盖率")
    ax.bar(x + width / 2, risk, width, color="#DDA064", edgecolor=ORANGE, lw=0.33, label="风险")
    ax.set_ylim(0, 1.05)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontproperties=FONT, fontsize=3.9)
    ax.set_yticks([0, 0.5, 1.0])
    ax.set_yticklabels(["0", "0.5", "1.0"], fontproperties=FONT, fontsize=3.6)
    ax.grid(axis="y", color="#E5E8EB", lw=0.22)
    for sp in ax.spines.values():
        sp.set_visible(True)
        sp.set_color("#D3DAE0")
        sp.set_linewidth(0.25)
    ax.legend(prop=FontProperties(fname=r"C:\Windows\Fonts\simsun.ttc", size=3.5), frameon=False, loc="upper right", ncol=2, handlelength=0.70, columnspacing=0.45)
    ilabel(ax, "方案指标")


def draw():
    boundary, holes, odi, params, stats, coal = load_data()

    fig = plt.figure(figsize=(7.0, 5.10), dpi=300)
    fig.patch.set_facecolor("white")
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    outer(ax, 0.030, 0.805, 0.940, 0.165, "数据来源与分类", BLUE)
    outer(ax, 0.030, 0.540, 0.940, 0.230, "空间处理与指标构建", TEAL)
    outer(ax, 0.030, 0.315, 0.940, 0.190, "图层输出", ORANGE)
    outer(ax, 0.030, 0.085, 0.940, 0.190, "规划应用", RED)
    for y0, y1 in [(0.805, 0.770), (0.540, 0.505), (0.315, 0.275)]:
        arr(ax, (0.50, y0), (0.50, y1), ms=7.4)

    # Data source layer.
    map_ax(fig.add_axes([0.055, 0.835, 0.130, 0.078]), boundary, holes, "边界/钻孔")
    lith_ax(fig.add_axes([0.205, 0.835, 0.090, 0.078]))
    arr(ax, (0.307, 0.875), (0.338, 0.875), BLUE, ms=5.5)
    for i, label in enumerate(["地质资料", "设计图件", "钻孔资料", "扰动评价", "规划参数"]):
        b(ax, 0.345 + i * 0.080, 0.902, 0.064, 0.026, label, BLUE, fs=3.9)
    for i, label in enumerate(["基础地质", "工程约束", "覆岩扰动", "规划参数"]):
        b(ax, 0.365 + i * 0.105, 0.833, 0.080, 0.027, label, GREEN, fs=3.8)
    arr(ax, (0.510, 0.895), (0.510, 0.862), GRAY, ms=5.0)
    arr(ax, (0.755, 0.868), (0.800, 0.868), GRAY, ms=5.7)
    b(ax, 0.810, 0.895, 0.105, 0.028, f"钻孔 {len(holes)} 个", GREEN, fs=4.0)
    b(ax, 0.810, 0.853, 0.105, 0.028, f"ODI点 {len(odi)} 个", GREEN, fs=4.0)
    b(ax, 0.810, 0.812, 0.105, 0.028, "参数 4 类", GREEN, fs=4.0)

    # Spatial processing layer, reference-like 3 submodules.
    sub = [
        (0.055, "坐标统一与裁剪", lambda aa: map_ax(aa, boundary, holes, "坐标/边界", odi["ODI_norm"], odi), "格式转换"),
        (0.285, "参数场插值", lambda aa: field_ax(aa, params, boundary, "Hi", "Hi 插值场", "YlGnBu"), "插值计算"),
        (0.515, "ODI归一化", lambda aa: field_ax(aa, odi, boundary, "ODI_norm", "ODI 场", "YlOrRd"), "指标归一化"),
    ]
    for x, title, plot, bottom in sub:
        r(ax, x, 0.585, 0.185, 0.142, ec=TEAL, fc="white", lw=0.45, ls=(0, (1.4, 1.4)))
        t(ax, x + 0.0925, 0.713, title, size=4.5)
        plot(fig.add_axes([x + 0.028, 0.624, 0.130, 0.060]))
        b(ax, x + 0.045, 0.594, 0.095, 0.020, bottom, TEAL, fs=3.7)
    arr(ax, (0.245, 0.654), (0.278, 0.654), TEAL, ms=5.0)
    arr(ax, (0.475, 0.654), (0.508, 0.654), TEAL, ms=5.0)
    for i, step in enumerate(["格式转换", "边界裁剪", "插值计算", "归一化", "图层叠加"]):
        b(ax, 0.755, 0.710 - i * 0.033, 0.085, 0.022, step, TEAL, fs=3.7)
        if i < 4:
            arr(ax, (0.797, 0.710 - i * 0.033), (0.797, 0.700 - i * 0.033), TEAL, ms=4.4)
    arr(ax, (0.842, 0.645), (0.880, 0.645), TEAL, ms=5.0)
    t(ax, 0.888, 0.645, "统一空间网格\n多图层叠加", size=4.4, ha="left")

    # Layer output layer.
    out = [
        (0.060, lambda aa: map_ax(aa, boundary, holes, "有效域"), "有效布置域图层", ORANGE),
        (0.245, lambda aa: field_ax(aa, coal, boundary, "coal_thickness", "煤厚资源", "YlOrBr"), "煤厚资源图层", ORANGE),
        (0.430, lambda aa: field_ax(aa, odi, boundary, "ODI_norm", "ODI扰动", "YlOrRd"), "ODI扰动图层", "#9A3E00"),
        (0.615, lambda aa: candidate_ax(aa, boundary), "候选方案图层", ORANGE),
    ]
    for x, plot, label, ec in out:
        plot(fig.add_axes([x, 0.365, 0.110, 0.065]))
        b(ax, x - 0.006, 0.338, 0.122, 0.023, label, ec, fs=3.9, bold="ODI" in label)
    arr(ax, (0.755, 0.395), (0.810, 0.395), ORANGE, ms=5.5)
    t(ax, 0.820, 0.395, "图层输出作为\n规划模型输入", size=4.4, ha="left")

    # Planning layer.
    for i, step in enumerate(["方案生成", "约束筛选", "指标统计", "方案比选"]):
        b(ax, 0.065 + i * 0.112, 0.164, 0.082, 0.030, step, RED, fs=4.2, bold=i in (0, 3))
        if i < 3:
            arr(ax, (0.149 + i * 0.112, 0.179), (0.176 + i * 0.112, 0.179), RED, ms=5.0)
    stats_ax(fig.add_axes([0.555, 0.126, 0.230, 0.080]), stats)
    arr(ax, (0.795, 0.170), (0.835, 0.170), RED, ms=5.5)
    b(ax, 0.840, 0.148, 0.095, 0.044, "推荐方案\n与约束说明", RED, fs=4.0, bold=True)

    t(ax, 0.50, 0.035, "注：缩略图由本项目钻孔坐标、采区边界、钻孔分层、ODI评价点和方案统计数据生成。", size=4.0, color="#66727C")

    OUT.mkdir(parents=True, exist_ok=True)
    stem = OUT / "data_workflow_reference_v2"
    fig.savefig(stem.with_suffix(".svg"), bbox_inches="tight", pad_inches=0.020)
    fig.savefig(stem.with_suffix(".pdf"), bbox_inches="tight", pad_inches=0.020)
    fig.savefig(stem.with_suffix(".png"), dpi=900, bbox_inches="tight", pad_inches=0.020)
    plt.close(fig)


if __name__ == "__main__":
    draw()
