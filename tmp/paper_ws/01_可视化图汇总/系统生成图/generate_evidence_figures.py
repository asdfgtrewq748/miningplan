from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.font_manager import FontProperties
from matplotlib.lines import Line2D
from matplotlib.patches import Patch, Polygon
from mpl_toolkits.axes_grid1.inset_locator import inset_axes


ROOT = Path(r"D:\xiangmu\miningplan\论文\重构工作区")
DATA_DIR = ROOT / "05_支撑材料" / "接口结果"
OUT_DIR = ROOT / "01_可视化图汇总" / "系统生成图"
FONT = FontProperties(fname=r"C:\Windows\Fonts\msyh.ttc")

COLORS = {
    "ink": "#233848",
    "grid": "#dce5ea",
    "boundary": "#2f627d",
    "fill": "#d7e8f1",
    "drill": "#d9544d",
    "heat_contour": "#f3f6f8",
    "main": "#2f8aa3",
    "vent": "#d85b52",
    "transport": "#4f8d4d",
    "return": "#7e6ad6",
    "cut": "#d9a441",
}


def load_json(name: str):
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def setup_axes(figsize=(8.8, 6.0)):
    fig, ax = plt.subplots(figsize=figsize, dpi=260)
    ax.set_facecolor("#f8fbfc")
    fig.patch.set_facecolor("white")
    ax.grid(True, color=COLORS["grid"], linewidth=0.6, alpha=0.7)
    for spine in ax.spines.values():
        spine.set_color("#526774")
        spine.set_linewidth(0.9)
    ax.tick_params(colors=COLORS["ink"], labelsize=9)
    return fig, ax


def set_title(ax, title: str, subtitle: str | None = None):
    ax.set_title(title, fontproperties=FONT, fontsize=15, color=COLORS["ink"], pad=10, weight="bold")
    if subtitle:
        ax.text(
            0.0,
            1.02,
            subtitle,
            transform=ax.transAxes,
            fontproperties=FONT,
            fontsize=9.2,
            color="#688090",
            ha="left",
            va="bottom",
        )


def add_scale_bar(ax, length: float, label: str, location=(0.05, 0.05)):
    x0, y0 = location
    xmin, xmax = ax.get_xlim()
    ymin, ymax = ax.get_ylim()
    start_x = xmin + (xmax - xmin) * x0
    start_y = ymin + (ymax - ymin) * y0
    ax.plot([start_x, start_x + length], [start_y, start_y], color="#34495e", lw=2.6, solid_capstyle="butt")
    ax.plot([start_x, start_x], [start_y - 2, start_y + 2], color="#34495e", lw=2.0)
    ax.plot([start_x + length, start_x + length], [start_y - 2, start_y + 2], color="#34495e", lw=2.0)
    ax.text(
        start_x + length / 2,
        start_y + 7,
        label,
        ha="center",
        va="bottom",
        fontproperties=FONT,
        fontsize=9.5,
        color="#34495e",
        weight="bold",
    )


def draw_boundary_boreholes():
    boundary = np.asarray([(p["x"], p["y"]) for p in load_json("边界数据.json")["boundary"]], dtype=float)
    boreholes = load_json("钻孔数据.json")["boreholes"]

    fig, ax = setup_axes()
    poly = Polygon(boundary, closed=True, facecolor=COLORS["fill"], edgecolor=COLORS["boundary"], linewidth=1.8, alpha=0.85)
    ax.add_patch(poly)
    xs = [b["x"] for b in boreholes]
    ys = [b["y"] for b in boreholes]
    ax.scatter(xs, ys, s=34, color=COLORS["drill"], edgecolors="white", linewidths=0.8, zorder=3)

    offsets = [(6, 7), (6, 6), (6, 6), (6, 6), (6, 6), (6, 6), (6, 6), (6, 6), (6, 6), (6, 6), (6, 6), (6, 6), (6, 6), (6, 6), (6, 6)]
    for bh, (dx, dy) in zip(boreholes, offsets):
        ax.text(
            bh["x"] + dx,
            bh["y"] + dy,
            bh["id"],
            fontproperties=FONT,
            fontsize=7.8,
            color="#4a5f6f",
            zorder=4,
        )

    ax.set_xlim(boundary[:, 0].min() - 30, boundary[:, 0].max() + 30)
    ax.set_ylim(boundary[:, 1].min() - 40, boundary[:, 1].max() + 25)
    ax.set_xlabel("X / m", fontproperties=FONT, fontsize=10, color=COLORS["ink"])
    ax.set_ylabel("Y / m", fontproperties=FONT, fontsize=10, color=COLORS["ink"])
    set_title(ax, "图1 采区边界与钻孔分布图", "样例验证输入：1 个采区边界对象，15 个钻孔样点")
    add_scale_bar(ax, 100, "100 m", location=(0.07, 0.06))
    legend_handles = [
        Patch(facecolor=COLORS["fill"], edgecolor=COLORS["boundary"], label="采区边界"),
        Line2D([0], [0], marker="o", linestyle="", markerfacecolor=COLORS["drill"], markeredgecolor="white", markersize=7, label="钻孔样点"),
    ]
    ax.legend(handles=legend_handles, prop=FONT, fontsize=8.8, loc="upper right", frameon=True, facecolor="white", edgecolor="#d4dee4")
    fig.tight_layout()
    fig.savefig(OUT_DIR / "图1_采区边界与钻孔分布图.png", bbox_inches="tight")
    plt.close(fig)


def _grid_extent(model: dict):
    return [model["minX"], model["maxX"], model["minY"], model["maxY"]]


def draw_thickness_heatmap():
    boundary = np.asarray([(p["x"], p["y"]) for p in load_json("边界数据.json")["boundary"]], dtype=float)
    boreholes = load_json("钻孔数据.json")["boreholes"]
    model = load_json("地质建模结果.json")["model"]
    field = np.asarray(model["data"], dtype=float)
    masked = np.ma.masked_where(field <= 1e-12, field)

    cmap = LinearSegmentedColormap.from_list("paper_heat", ["#fff8da", "#ffd37a", "#f86d4b", "#a61d4c"])
    fig, ax = setup_axes()
    im = ax.imshow(
        masked,
        origin="lower",
        extent=_grid_extent(model),
        cmap=cmap,
        aspect="auto",
        alpha=0.96,
        interpolation="bilinear",
    )
    levels = np.linspace(float(masked.min()), float(masked.max()), 6)
    ax.contour(
        field,
        levels=levels,
        origin="lower",
        extent=_grid_extent(model),
        colors=COLORS["heat_contour"],
        linewidths=0.8,
        alpha=0.75,
    )
    ax.plot(boundary[:, 0], boundary[:, 1], color=COLORS["ink"], lw=1.5, label="采区边界")
    ax.scatter(
        [b["x"] for b in boreholes],
        [b["y"] for b in boreholes],
        s=18,
        facecolors="white",
        edgecolors="#4d5660",
        linewidths=0.7,
        zorder=3,
        label="钻孔样点",
    )
    ax.set_xlim(boundary[:, 0].min() - 30, boundary[:, 0].max() + 30)
    ax.set_ylim(boundary[:, 1].min() - 35, boundary[:, 1].max() + 25)
    ax.set_xlabel("X / m", fontproperties=FONT, fontsize=10, color=COLORS["ink"])
    ax.set_ylabel("Y / m", fontproperties=FONT, fontsize=10, color=COLORS["ink"])
    set_title(ax, "图2 煤层厚度插值热力图", "连续参数场由 15 个钻孔样点插值得到")
    cax = inset_axes(ax, width="4.2%", height="82%", loc="center right",
                     bbox_to_anchor=(0.09, 0.0, 1, 1), bbox_transform=ax.transAxes, borderpad=0)
    cb = fig.colorbar(im, cax=cax)
    cb.set_label("煤层厚度 / m", fontproperties=FONT, fontsize=9.5, color=COLORS["ink"])
    cb.ax.tick_params(labelsize=8.5, colors=COLORS["ink"])
    ax.legend(prop=FONT, fontsize=8.6, loc="upper right", frameon=True, facecolor="white", edgecolor="#d4dee4")
    ax.text(
        0.02,
        0.03,
        f"最小值 {float(masked.min()):.1f} m   最大值 {float(masked.max()):.1f} m",
        transform=ax.transAxes,
        fontproperties=FONT,
        fontsize=8.8,
        color="#5c7180",
        bbox=dict(boxstyle="round,pad=0.25", facecolor="white", edgecolor="#d9e3e8", alpha=0.95),
    )
    fig.tight_layout()
    fig.savefig(OUT_DIR / "图2_煤层厚度插值热力图.png", bbox_inches="tight")
    plt.close(fig)


def draw_layout_result():
    result = load_json("采区设计结果.json")
    boundary = np.asarray([(p["x"], p["y"]) for p in result["boundary"]], dtype=float)
    boreholes = result["boreholes"]
    panels = result["panels"]
    roadways = result["roadways"]
    fig, ax = setup_axes(figsize=(9.4, 6.4))

    ax.plot(boundary[:, 0], boundary[:, 1], color="#464c54", lw=1.4, zorder=1)
    panel_colors = ["#9bc4df", "#84b8d4", "#add4bc"]
    for idx, panel in enumerate(panels):
        pts = np.asarray([(p["x"], p["y"]) for p in panel["points"]], dtype=float)
        patch = Polygon(pts, closed=True, facecolor=panel_colors[idx % len(panel_colors)], edgecolor="#4d80a5", alpha=0.72, linewidth=1.2, zorder=2)
        ax.add_patch(patch)
        ax.text(panel["center_x"], panel["center_y"], panel["id"], ha="center", va="center", fontproperties=FONT, fontsize=9.2, color="#27485c", weight="bold")

    type_style = {
        "main": (COLORS["main"], "-", 1.6, "主运输/主回风"),
        "ventilation": (COLORS["vent"], "-", 1.5, "通风巷"),
        "transport": (COLORS["transport"], "-", 1.5, "运输顺槽"),
        "return": (COLORS["return"], "-", 1.5, "回风顺槽"),
        "cut": (COLORS["cut"], (0, (7, 4)), 1.5, "切眼"),
    }
    seen = set()
    legend_lines = []
    for roadway in roadways:
        path = np.asarray([(p["x"], p["y"]) for p in roadway["path"]], dtype=float)
        rtype = roadway["type"]
        color, linestyle, lw, label = type_style.get(rtype, ("#657786", "-", 1.4, rtype))
        ax.plot(path[:, 0], path[:, 1], color=color, linestyle=linestyle, lw=lw, zorder=3)
        if label not in seen:
            legend_lines.append(Line2D([0], [0], color=color, linestyle=linestyle, lw=lw, label=label))
            seen.add(label)

    ax.scatter([b["x"] for b in boreholes], [b["y"] for b in boreholes], s=12, color="#333333", alpha=0.7, zorder=4)
    ax.set_xlim(boundary[:, 0].min() - 35, boundary[:, 0].max() + 45)
    ax.set_ylim(boundary[:, 1].min() - 35, boundary[:, 1].max() + 35)
    ax.set_xlabel("X / m", fontproperties=FONT, fontsize=10, color=COLORS["ink"])
    ax.set_ylabel("Y / m", fontproperties=FONT, fontsize=10, color=COLORS["ink"])
    set_title(ax, "图3 采区工作面与巷道布局图", "样例输出：3 个工作面，11 条巷道，平均推进长度 534.3 m")
    handles = [Patch(facecolor="#9bc4df", edgecolor="#4d80a5", label="工作面")] + legend_lines + [
        Line2D([0], [0], marker="o", linestyle="", color="#333333", markersize=4.2, label="钻孔样点")
    ]
    ax.legend(handles=handles, prop=FONT, fontsize=8.2, loc="upper right", frameon=True, facecolor="white", edgecolor="#d4dee4", ncol=2)
    ax.text(
        0.02,
        0.03,
        "注：该图适合作为补充证据，用于展示规划结果对象已可结构化输出。",
        transform=ax.transAxes,
        fontproperties=FONT,
        fontsize=8.5,
        color="#5c7180",
        bbox=dict(boxstyle="round,pad=0.25", facecolor="white", edgecolor="#d9e3e8", alpha=0.95),
    )
    fig.tight_layout()
    fig.savefig(OUT_DIR / "图3_采区工作面与巷道布局图.png", bbox_inches="tight")
    plt.close(fig)


def draw_gnn_grid():
    boreholes = load_json("钻孔数据.json")["boreholes"]
    gnn = load_json("GNN网格结果.json")
    model = gnn["model"]
    field = np.asarray(model["thickness"], dtype=float)
    bounds = model["bounds"]
    metrics = load_json("GNN训练结果.json")

    cmap = LinearSegmentedColormap.from_list("gnn_grid", ["#2e3d8f", "#3ea1b0", "#66c56b", "#f2ea3a"])
    fig, ax = setup_axes()
    im = ax.imshow(
        field,
        origin="lower",
        extent=[bounds["x_min"], bounds["x_max"], bounds["y_min"], bounds["y_max"]],
        cmap=cmap,
        aspect="auto",
        interpolation="bilinear",
        alpha=0.96,
    )
    ax.scatter(
        [b["x"] for b in boreholes],
        [b["y"] for b in boreholes],
        s=15,
        facecolors="#ffd35a",
        edgecolors="#5a4a00",
        linewidths=0.55,
        zorder=3,
    )
    ax.set_xlim(bounds["x_min"] - 35, bounds["x_max"] + 35)
    ax.set_ylim(bounds["y_min"] - 35, bounds["y_max"] + 35)
    ax.set_xlabel("X / m", fontproperties=FONT, fontsize=10, color=COLORS["ink"])
    ax.set_ylabel("Y / m", fontproperties=FONT, fontsize=10, color=COLORS["ink"])
    set_title(ax, "图4 GNN 煤层厚度预测网格图", "扩展建模接口输出示例，不纳入核心贡献论证")
    cax = inset_axes(ax, width="4.2%", height="82%", loc="center right",
                     bbox_to_anchor=(0.09, 0.0, 1, 1), bbox_transform=ax.transAxes, borderpad=0)
    cb = fig.colorbar(im, cax=cax)
    cb.set_label("GNN 预测厚度 / m", fontproperties=FONT, fontsize=9.5, color=COLORS["ink"])
    cb.ax.tick_params(labelsize=8.5, colors=COLORS["ink"])

    metric_block = metrics.get("metrics", metrics)
    mae = metric_block.get("thickness_mae") or metric_block.get("mae") or metric_block.get("MAE")
    rmse = metric_block.get("thickness_rmse") or metric_block.get("rmse") or metric_block.get("RMSE")
    r2 = metric_block.get("thickness_r2") or metric_block.get("r2") or metric_block.get("R2")
    metric_text = f"MAE = {mae:.4f}\nRMSE = {rmse:.4f}\nR² = {r2:.4f}" if all(v is not None for v in (mae, rmse, r2)) else "训练指标见支撑材料"
    ax.text(
        0.03,
        0.05,
        metric_text,
        transform=ax.transAxes,
        fontproperties=FONT,
        fontsize=8.6,
        color="white",
        bbox=dict(boxstyle="round,pad=0.35", facecolor="#5c6670", edgecolor="none", alpha=0.9),
    )
    fig.tight_layout()
    fig.savefig(OUT_DIR / "图4_GNN煤层厚度预测网格图.png", bbox_inches="tight")
    plt.close(fig)


def main():
    draw_boundary_boreholes()
    draw_thickness_heatmap()
    draw_layout_result()
    draw_gnn_grid()
    print("evidence figures regenerated:", OUT_DIR)


if __name__ == "__main__":
    main()
