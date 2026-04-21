from __future__ import annotations

import csv
import json
from pathlib import Path

import matplotlib.colors as mcolors
import matplotlib.font_manager as fm
import matplotlib.patheffects as pe
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
from matplotlib.path import Path as MplPath
from scipy.interpolate import griddata
from scipy.ndimage import gaussian_filter
from shapely.geometry import MultiPolygon, Polygon


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "figures_for_paper_additions"

SRC_DIR = ROOT / "论文" / "重构工作区" / "05_支撑材料" / "接口结果"
BOUNDARY_JSON = SRC_DIR / "边界数据.json"
BOREHOLE_JSON = SRC_DIR / "钻孔数据.json"
GEOLOGY_JSON = SRC_DIR / "地质建模结果.json"
DESIGN_JSON = SRC_DIR / "采区设计结果.json"

PAPER_TEXT = ROOT / "煤科投稿" / "00_过程文档" / "当前论文文本抽取.md"
ABC_STATS = ROOT / "docs" / "plans" / "coal_sci_abc_odi_unified_stats_20260418.csv"
THRESHOLD_STATS = ROOT / "docs" / "plans" / "coal_sci_threshold_sensitivity_candidates_20260418.csv"
WEIGHT_STATS = ROOT / "docs" / "plans" / "coal_sci_weight_sensitivity_candidates_20260418.csv"
SENS_SUMMARY = ROOT / "docs" / "plans" / "coal_sci_odi_sensitivity_summary_20260418.md"
PLANNING_OVERVIEW = ROOT / "output" / "scene_visual_exports" / "20260416_201037" / "05_mining_succession" / "overview"

SURFACE_COMPONENT = ROOT / "data" / "output" / "all_png" / "00_surface_fig01_odi_heatmap.png"
AQUIFER_COMPONENT = ROOT / "data" / "output" / "all_png" / "02_aquifer_fig01_odi_heatmap.png"
VALIDATION_CANDIDATE = ROOT / "data" / "output" / "supplementary_figures" / "figS2_measured_vs_predicted.png"

SURFACE_ODI_POINTS = ROOT / "data" / "export_package" / "0-地表下沉.miningplan" / "地表下沉" / "ODI评价点.csv"
AQUIFER_ODI_POINTS = ROOT / "data" / "export_package" / "2-含水层扰动评价.miningplan" / "含水层扰动" / "ODI评价点.csv"
UPWARD_PROXY_ODI_POINTS = ROOT / "data" / "export_package" / "5-采掘接续.miningplan" / "含水层扰动" / "ODI评价点.csv"
SURFACE_MEASURED_POINTS = ROOT / "data" / "export_package" / "0-地表下沉.miningplan" / "地表下沉" / "实测数据.csv"
SURFACE_DEMO_JSON = ROOT / "mining-plan" / "frontend" / "dist" / "demo" / "0-地表下沉.miningplan.json"
THIRD_ROUND_LOG = ROOT / "docs" / "plans" / "coal_sci_third_round_logic_closure_log_20260418.md"

SIMSUN = Path(r"C:\Windows\Fonts\simsun.ttc")
TIMES = Path(r"C:\Windows\Fonts\times.ttf")
for font_path in (SIMSUN, TIMES):
    if font_path.exists():
        fm.fontManager.addfont(str(font_path))

plt.rcParams.update(
    {
        "font.family": ["Times New Roman", "SimSun"],
        "mathtext.fontset": "stix",
        "axes.unicode_minus": False,
        "figure.dpi": 220,
        "savefig.dpi": 900,
        "savefig.transparent": False,
        "pdf.fonttype": 42,
        "ps.fonttype": 42,
        "svg.fonttype": "none",
        "path.simplify": False,
        "axes.linewidth": 0.85,
        "font.size": 11.0,
        "axes.titlesize": 12.8,
        "axes.labelsize": 11.5,
        "xtick.labelsize": 10.4,
        "ytick.labelsize": 10.4,
        "legend.fontsize": 10.2,
        "lines.linewidth": 1.65,
        "lines.markersize": 5.6,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
    }
)

FIG8_CMAP_NAME = "turbo"
FIG8_CMAP = plt.get_cmap(FIG8_CMAP_NAME)


def cmap_hex(x: float) -> str:
    return mcolors.to_hex(FIG8_CMAP(x))


FIG8_COLORS = {
    "deep": cmap_hex(0.06),
    "blue": cmap_hex(0.18),
    "cyan": cmap_hex(0.34),
    "green": cmap_hex(0.50),
    "yellow": cmap_hex(0.66),
    "orange": cmap_hex(0.78),
    "red": cmap_hex(0.92),
}
SCHEME_COLORS = {"A": FIG8_COLORS["blue"], "B": FIG8_COLORS["green"], "C": FIG8_COLORS["orange"]}
METRIC_COLORS = [FIG8_COLORS["blue"], FIG8_COLORS["yellow"], FIG8_COLORS["red"]]
FLOW_COLORS = [FIG8_COLORS["blue"], FIG8_COLORS["cyan"], FIG8_COLORS["green"], FIG8_COLORS["orange"], FIG8_COLORS["red"]]

COLORS = {
    "ink": "#1F2933",
    "muted": "#6B7280",
    "line": "#D7DEE8",
    "grid": "#E9EDF2",
    "blue": FIG8_COLORS["blue"],
    "green": FIG8_COLORS["green"],
    "orange": FIG8_COLORS["orange"],
    "red": FIG8_COLORS["red"],
    "purple": FIG8_COLORS["deep"],
    "black": "#000000",
    "gray_dark": "#4B5563",
    "gray_mid": "#8A97A5",
    "gray_light": "#EEF1F4",
    "raw": "#EAF3FF",
    "domain": "#FFF0CC",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_all(fig: plt.Figure, stem: str) -> list[Path]:
    paths: list[Path] = []
    for ext in ("png", "svg", "pdf"):
        path = OUT / f"{stem}.{ext}"
        fig.savefig(path, bbox_inches="tight", pad_inches=0.025)
        paths.append(path)
    plt.close(fig)
    return paths


def xy_from_points(points: list[dict]) -> np.ndarray:
    return np.array([[float(p["x"]), float(p["y"])] for p in points], dtype=float)


def close_ring(arr: np.ndarray) -> np.ndarray:
    if len(arr) and not np.allclose(arr[0], arr[-1]):
        return np.vstack([arr, arr[0]])
    return arr


def main_polygon(poly) -> Polygon:
    if isinstance(poly, MultiPolygon):
        return max(poly.geoms, key=lambda p: p.area)
    return poly


def plot_poly(ax, poly: Polygon, facecolor: str, edgecolor: str, alpha: float = 0.92, lw: float = 1.0, zorder: int = 2):
    if poly.is_empty:
        return
    x, y = poly.exterior.xy
    ax.fill(x, y, facecolor=facecolor, edgecolor=edgecolor, alpha=alpha, linewidth=lw, zorder=zorder)


def panel_label(ax, label: str, title: str):
    ax.text(0.00, 1.030, label, transform=ax.transAxes, ha="left", va="bottom", fontsize=11.8, fontweight="bold", color=COLORS["black"])
    ax.text(0.105, 1.030, title, transform=ax.transAxes, ha="left", va="bottom", fontsize=11.0, color=COLORS["black"])


def clean_spatial_ax(ax, bounds: tuple[float, float, float, float]):
    minx, maxx, miny, maxy = bounds
    pad = max(maxx - minx, maxy - miny) * 0.055
    ax.set_xlim(minx - pad, maxx + pad)
    ax.set_ylim(miny - pad, maxy + pad)
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("X / m")
    ax.set_ylabel("Y / m")
    ax.grid(color=COLORS["grid"], linewidth=0.38)
    for spine in ax.spines.values():
        spine.set_linewidth(0.72)
        spine.set_color(COLORS["black"])


def add_north_arrow(ax):
    x0, x1 = ax.get_xlim()
    y0, y1 = ax.get_ylim()
    x = x0 + 0.08 * (x1 - x0)
    y = y0 + 0.13 * (y1 - y0)
    ax.annotate(
        "N",
        xy=(x, y + 0.09 * (y1 - y0)),
        xytext=(x, y),
        ha="center",
        va="center",
        arrowprops=dict(arrowstyle="-|>", lw=0.85, color=COLORS["ink"]),
        fontsize=8.5,
        fontweight="bold",
    )


def idw_grid(x: np.ndarray, y: np.ndarray, z: np.ndarray, gx: np.ndarray, gy: np.ndarray, power: float = 2.0) -> np.ndarray:
    grid = np.zeros_like(gx, dtype=float)
    for i in range(gx.shape[0]):
        dx = gx[i, :, None] - x[None, :]
        dy = gy[i, :, None] - y[None, :]
        dist = np.sqrt(dx * dx + dy * dy)
        exact = dist < 1e-9
        weights = 1.0 / np.maximum(dist, 1e-9) ** power
        vals = (weights * z[None, :]).sum(axis=1) / weights.sum(axis=1)
        if exact.any():
            nearest = np.argmax(exact, axis=1)
            rows = exact.any(axis=1)
            vals[rows] = z[nearest[rows]]
        grid[i, :] = vals
    return grid


def mask_grid_by_poly(gx: np.ndarray, gy: np.ndarray, poly_xy: np.ndarray) -> np.ndarray:
    path = MplPath(close_ring(poly_xy))
    return path.contains_points(np.c_[gx.ravel(), gy.ravel()]).reshape(gx.shape)


def row_count(path: Path) -> int | None:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return sum(1 for _ in csv.DictReader(f))


def tidy_axes(ax, ygrid: bool = False):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(COLORS["black"])
        ax.spines[side].set_linewidth(0.85)
    if ygrid:
        ax.grid(axis="y", color=COLORS["grid"], linewidth=0.48)
    ax.tick_params(width=0.78, length=3.4, color=COLORS["black"], direction="out")


def style_publication_axis(ax, ygrid: bool = False):
    tidy_axes(ax, ygrid=ygrid)
    ax.set_axisbelow(True)
    if ygrid:
        ax.grid(axis="y", color="#DDE4EA", linewidth=0.42)


def fig06_boundary_evolution() -> dict:
    boundary = xy_from_points(load_json(BOUNDARY_JSON)["boundary"])
    raw_poly = Polygon(close_ring(boundary))
    boundary_buffer = main_polygon(raw_poly.buffer(-30.0, join_style=2))
    section_buffer = main_polygon(raw_poly.buffer(-50.0, join_style=2))
    final_domain = section_buffer
    bounds = raw_poly.bounds[0], raw_poly.bounds[2], raw_poly.bounds[1], raw_poly.bounds[3]

    stages = [
        ("a", "原始采区边界", raw_poly, "#EAF3FF", FIG8_COLORS["blue"], r"$\Omega_0$"),
        ("b", "边界煤柱内缩30 m", boundary_buffer, "#E7FAF3", FIG8_COLORS["cyan"], r"$\Omega_0-B_b$"),
        ("c", "区段煤柱约束叠加20 m", section_buffer, "#FFF4C7", FIG8_COLORS["orange"], r"$\Omega_0-B_b-B_s$"),
        ("d", "有效布置域主连通域", final_domain, "#FFE0CC", FIG8_COLORS["red"], r"$\Omega_e$"),
    ]

    fig, axes = plt.subplots(1, 4, figsize=(12.6, 2.85), constrained_layout=True)
    for ax, (letter, title, poly, fc, ec, tag) in zip(axes, stages):
        plot_poly(ax, raw_poly, "none", "#AEB8C2", alpha=1, lw=0.8, zorder=1)
        plot_poly(ax, poly, fc, ec, alpha=0.95, lw=1.25, zorder=2)
        if letter == "d":
            plot_poly(ax, poly, "none", FIG8_COLORS["red"], alpha=1, lw=2.0, zorder=3)
        clean_spatial_ax(ax, bounds)
        panel_label(ax, f"({letter})", title)
        ax.text(
            0.055,
            0.905,
            tag,
            transform=ax.transAxes,
            fontsize=8.5,
            bbox=dict(boxstyle="round,pad=0.22", facecolor="white", edgecolor="#CCD4DD", linewidth=0.55),
        )
        add_north_arrow(ax)

    return {
        "files": save_all(fig, "Fig06_boundary_to_effective_domain"),
        "method": "根据现有边界和论文明确约束参数重画，已按期刊图风格重导出",
        "kind": "方法示意图；几何内缩结果图",
        "source": [BOUNDARY_JSON, DESIGN_JSON, PAPER_TEXT],
        "note": "图示原始采区边界经边界煤柱30 m内缩、区段煤柱20 m叠加约束后形成有效布置域。项目内未发现独立保护对象坐标，故未绘制额外局部保护对象裁剪。",
    }


def fig07_parameter_field_workflow() -> dict:
    boundary = xy_from_points(load_json(BOUNDARY_JSON)["boundary"])
    boreholes = load_json(BOREHOLE_JSON)["boreholes"]
    pts = xy_from_points(boreholes)
    vals = np.array([float(p["coalThickness"]) for p in boreholes])
    raw_poly = Polygon(close_ring(boundary))
    minx, miny, maxx, maxy = raw_poly.bounds

    xx = np.linspace(minx, maxx, 138)
    yy = np.linspace(miny, maxy, 104)
    gx, gy = np.meshgrid(xx, yy)
    grid = gaussian_filter(idw_grid(pts[:, 0], pts[:, 1], vals, gx, gy, power=2.0), sigma=0.7)
    mask = mask_grid_by_poly(gx, gy, boundary)
    clipped = np.where(mask, grid, np.nan)
    bounds = minx, maxx, miny, maxy
    # Coal Science and Technology examples commonly use filled contours with
    # strong value contrast for spatial fields; turbo keeps that readability
    # while avoiding the harshest jet transitions.
    cmap = FIG8_CMAP_NAME
    vmin, vmax = 2.8, 4.8

    fig, axes = plt.subplots(1, 4, figsize=(12.8, 3.42))
    fig.subplots_adjust(left=0.055, right=0.975, top=0.84, bottom=0.34, wspace=0.25)

    axes[0].plot(close_ring(boundary)[:, 0], close_ring(boundary)[:, 1], color=COLORS["ink"], lw=0.9)
    axes[0].scatter(pts[:, 0], pts[:, 1], c=vals, cmap=cmap, vmin=vmin, vmax=vmax, edgecolor="white", linewidth=0.5, s=28, zorder=3)
    clean_spatial_ax(axes[0], bounds)
    panel_label(axes[0], "(a)", "钻孔点样本")

    axes[1].imshow(grid, extent=(minx, maxx, miny, maxy), origin="lower", cmap=cmap, vmin=vmin, vmax=vmax)
    axes[1].scatter(pts[:, 0], pts[:, 1], c="white", edgecolor=COLORS["ink"], linewidth=0.42, s=15)
    clean_spatial_ax(axes[1], bounds)
    panel_label(axes[1], "(b)", "IDW插值网格")

    axes[2].imshow(grid, extent=(minx, maxx, miny, maxy), origin="lower", cmap=cmap, vmin=vmin, vmax=vmax, alpha=0.42)
    axes[2].imshow(
        np.where(mask, 1.0, np.nan),
        extent=(minx, maxx, miny, maxy),
        origin="lower",
        cmap=mcolors.ListedColormap([FIG8_COLORS["green"]]),
        alpha=0.24,
    )
    axes[2].plot(close_ring(boundary)[:, 0], close_ring(boundary)[:, 1], color=COLORS["ink"], lw=0.9)
    clean_spatial_ax(axes[2], bounds)
    panel_label(axes[2], "(c)", "边界裁剪")

    im = axes[3].imshow(clipped, extent=(minx, maxx, miny, maxy), origin="lower", cmap=cmap, vmin=vmin, vmax=vmax)
    axes[3].contour(gx, gy, clipped, levels=6, colors="#43505C", linewidths=0.35, alpha=0.65)
    axes[3].scatter(pts[:, 0], pts[:, 1], c=vals, cmap=cmap, vmin=vmin, vmax=vmax, edgecolor="white", linewidth=0.4, s=18)
    axes[3].plot(close_ring(boundary)[:, 0], close_ring(boundary)[:, 1], color=COLORS["ink"], lw=0.85)
    clean_spatial_ax(axes[3], bounds)
    panel_label(axes[3], "(d)", "煤厚连续参数场")

    cax = fig.add_axes([0.365, 0.145, 0.30, 0.035])
    cbar = fig.colorbar(im, cax=cax, orientation="horizontal")
    cbar.set_label("煤层厚度 / m")
    cbar.outline.set_linewidth(0.45)
    for i in range(3):
        p0 = axes[i].get_position()
        p1 = axes[i + 1].get_position()
        arrow = FancyArrowPatch(
            (p0.x1 + 0.003, (p0.y0 + p0.y1) / 2),
            (p1.x0 - 0.003, (p1.y0 + p1.y1) / 2),
            transform=fig.transFigure,
            arrowstyle="-|>",
            mutation_scale=11,
            lw=0.8,
            color="#7C8793",
        )
        fig.add_artist(arrow)

    return {
        "files": save_all(fig, "Fig07_continuous_parameter_field_workflow"),
        "method": "根据现有钻孔、边界和论文公式重画，已按期刊图风格重导出",
        "kind": "过程图；方法示意与数据重画结合",
        "source": [BOREHOLE_JSON, BOUNDARY_JSON, GEOLOGY_JSON, PAPER_TEXT],
        "note": "插值采用论文式(7)明确的反距离加权思想，p=2；用于展示离散样点到连续场的构建流程。",
    }


def read_odi_points(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="utf-8-sig")
    out = pd.DataFrame(
        {
            "x": pd.to_numeric(df["X"], errors="coerce"),
            "y": pd.to_numeric(df["Y"], errors="coerce"),
            "odi": pd.to_numeric(df["ODI归一化"], errors="coerce"),
        }
    ).dropna()
    return out


def plot_odi_field(ax, df: pd.DataFrame, label: str, title: str, cmap: str = FIG8_CMAP_NAME):
    x = df["x"].to_numpy(dtype=float)
    y = df["y"].to_numpy(dtype=float)
    z = df["odi"].to_numpy(dtype=float)
    minx, maxx = float(x.min()), float(x.max())
    miny, maxy = float(y.min()), float(y.max())
    pad = max(maxx - minx, maxy - miny) * 0.045
    gx, gy = np.meshgrid(np.linspace(minx, maxx, 180), np.linspace(miny, maxy, 140))
    gz = griddata(np.c_[x, y], z, (gx, gy), method="linear")
    nearest = griddata(np.c_[x, y], z, (gx, gy), method="nearest")
    gz = np.where(np.isnan(gz), nearest, gz)
    gz = np.clip(gaussian_filter(gz, sigma=0.45), 0, 1)

    im = ax.imshow(gz, extent=(minx, maxx, miny, maxy), origin="lower", cmap=cmap, vmin=0, vmax=1, interpolation="bilinear")
    levels = np.linspace(0.15, 0.85, 5)
    ax.contour(gx, gy, gz, levels=levels, colors="#26323D", linewidths=0.35, alpha=0.58)
    ax.scatter(x, y, s=5.5, facecolor="white", edgecolor="#1F2933", linewidth=0.22, alpha=0.58)
    ax.set_xlim(minx - pad, maxx + pad)
    ax.set_ylim(miny - pad, maxy + pad)
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("X / m")
    ax.set_ylabel("Y / m")
    ax.ticklabel_format(axis="both", style="plain", useOffset=True)
    ax.grid(False)
    for spine in ax.spines.values():
        spine.set_linewidth(0.72)
        spine.set_color(COLORS["black"])
    panel_label(ax, label, title)
    ax.text(
        0.025,
        0.035,
        f"N={len(df)}",
        transform=ax.transAxes,
        fontsize=7.0,
        color="#111111",
        bbox=dict(facecolor="white", edgecolor="#CCD4DD", boxstyle="round,pad=0.18", linewidth=0.42),
    )
    return im


def fig08_odi_component_fields() -> dict:
    fields = [
        (SURFACE_ODI_POINTS, "(a)", "地表沉陷扰动"),
        (AQUIFER_ODI_POINTS, "(b)", "含水层扰动"),
        (UPWARD_PROXY_ODI_POINTS, "(c)", "上行专项代理"),
    ]
    fig, axes = plt.subplots(1, 3, figsize=(12.9, 3.55))
    fig.subplots_adjust(left=0.055, right=0.965, top=0.86, bottom=0.29, wspace=0.30)
    cax = fig.add_axes([0.27, 0.145, 0.46, 0.035])
    images = []
    for ax, (path, label, title) in zip(axes, fields):
        df = read_odi_points(path)
        images.append(plot_odi_field(ax, df, label, title))

    cbar = fig.colorbar(images[-1], cax=cax, orientation="horizontal")
    cbar.set_label("ODI归一化值")
    cbar.outline.set_linewidth(0.45)
    fig.text(
        0.50,
        0.015,
        "注：面板(c)为项目中 wf=0.60 的上行专项权重情景代理场；项目未导出独立“上行开采”tab评价点。",
        ha="center",
        va="bottom",
        fontsize=7.6,
        color="#3B4552",
    )

    return {
        "files": save_all(fig, "Fig08_odi_component_fields"),
        "method": "根据项目导出的ODI评价点重画；上行开采面板采用已核实的上行专项权重情景代理场",
        "kind": "结果图与代理场说明图；面板(c)不是独立实测上行开采分量场",
        "source": [SURFACE_ODI_POINTS, AQUIFER_ODI_POINTS, UPWARD_PROXY_ODI_POINTS, THIRD_ROUND_LOG],
        "note": "图示地表沉陷、含水层扰动及上行专项权重情景下的ODI空间分布。由于项目未导出独立上行开采评价点，面板(c)仅作为专项权重代理场，不能表述为独立实测分量。",
    }


def fig13_odi_validation() -> dict:
    data = load_json(SURFACE_DEMO_JSON)
    err = data.get("scenarioParamsById", {}).get("surface", {}).get("errorAnalysisByLineId", {})
    if not err:
        raise RuntimeError(f"No errorAnalysisByLineId found in {SURFACE_DEMO_JSON}")

    fig, axes = plt.subplots(1, 3, figsize=(11.3, 3.55), constrained_layout=True)
    markers = ["o", "s", "^"]
    line_styles = ["-", "--", "-."]
    colors = [FIG8_COLORS["blue"], FIG8_COLORS["green"], FIG8_COLORS["orange"]]

    for idx, (name, block) in enumerate(err.items()):
        ax = axes[idx]
        rows = block.get("data", [])
        measured = np.array([float(r.get("measuredNorm", np.nan)) for r in rows], dtype=float)
        predicted = np.array([float(r.get("odiRenorm", np.nan)) for r in rows], dtype=float)
        ok = np.isfinite(measured) & np.isfinite(predicted)
        measured = measured[ok]
        predicted = predicted[ok]

        ax.scatter(
            measured,
            predicted,
            s=18,
            marker=markers[idx % len(markers)],
            facecolor="white",
            edgecolor=colors[idx % len(colors)],
            linewidth=0.72,
            alpha=0.90,
            zorder=3,
        )
        ax.plot([0, 1], [0, 1], color="#202020", linewidth=0.82, linestyle=":", zorder=2)
        r2 = np.nan
        if len(measured) > 2 and np.std(measured) > 0 and np.std(predicted) > 0:
            slope, intercept = np.polyfit(measured, predicted, 1)
            fit_x = np.linspace(0, 1, 100)
            ax.plot(fit_x, slope * fit_x + intercept, color=colors[idx % len(colors)], linestyle=line_styles[idx % len(line_styles)], linewidth=1.12)
            r = np.corrcoef(measured, predicted)[0, 1]
            r2 = float(r * r)
        ax.set_xlim(-0.04, 1.04)
        ax.set_ylim(-0.04, 1.04)
        ax.set_aspect("equal", adjustable="box")
        ax.set_xlabel("实测值（归一化）")
        ax.set_ylabel("预测ODI（归一化）")
        panel_label(ax, f"({chr(97 + idx)})", block.get("label", name))
        ax.text(
            0.055,
            0.925,
            f"$R^2$={r2:.3f}\nN={len(measured)}" if np.isfinite(r2) else f"N={len(measured)}",
            transform=ax.transAxes,
            ha="left",
            va="top",
            fontsize=7.6,
            bbox=dict(facecolor="white", edgecolor="#CCD4DD", boxstyle="round,pad=0.22", linewidth=0.45),
        )
        style_publication_axis(ax, ygrid=True)

    return {
        "files": save_all(fig, "Fig13_odi_measured_predicted_validation"),
        "method": "根据项目已有Case 0地表沉陷预测-实测配对误差数据重画",
        "kind": "模型验证结果图；不是煤厚插值留一交叉验证图",
        "source": [SURFACE_DEMO_JSON, SURFACE_MEASURED_POINTS, VALIDATION_CANDIDATE, Path("generate_supplementary_figures.py")],
        "note": "图示三条实测测线的归一化实测值与预测ODI之间的对应关系，并给出1:1参考线、线性拟合线和R²。该图验证的是地表沉陷ODI预测-实测一致性，不应写作煤厚插值精度验证。",
    }


def ppt_card(ax, x, y, w, h, title, body="", number=None, fc="#FFFFFF", ec="#9AA7B4", accent="#3E6B9E", title_size=12.2, body_size=9.8):
    card = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.010,rounding_size=0.020",
        facecolor=fc,
        edgecolor=ec,
        linewidth=0.95,
        path_effects=[pe.SimplePatchShadow(offset=(0.55, -0.55), alpha=0.032), pe.Normal()],
    )
    ax.add_patch(card)
    ax.add_patch(
        FancyBboxPatch((x, y + h - 0.030), w, 0.030, boxstyle="round,pad=0,rounding_size=0.018", facecolor=accent, edgecolor=accent, linewidth=0)
    )
    if number is not None:
        ax.text(
            x + 0.035,
            y + h - 0.069,
            str(number),
            ha="center",
            va="center",
            fontsize=9,
            color="white",
            bbox=dict(boxstyle="circle,pad=0.18", facecolor=accent, edgecolor=accent, linewidth=0),
        )
        title_x = x + 0.07
    else:
        title_x = x + 0.035
    ax.text(title_x, y + h - 0.071, title, ha="left", va="center", fontsize=title_size, fontweight="bold", color=COLORS["ink"])
    if body:
        ax.text(x + 0.035, y + h - 0.108, body, ha="left", va="top", fontsize=body_size, color="#2F3A45", linespacing=1.18)
    return card


def ppt_arrow(ax, start, end, color="#8A97A5", lw=1.25, rad=0.0):
    arrow = FancyArrowPatch(
        start,
        end,
        arrowstyle="-|>",
        mutation_scale=13,
        linewidth=lw,
        color=color,
        connectionstyle=f"arc3,rad={rad}",
        shrinkA=5,
        shrinkB=5,
    )
    ax.add_patch(arrow)
    return arrow


def fig09_candidate_filtering_flow() -> dict:
    counts = {
        "工程效率": row_count(PLANNING_OVERVIEW / "planning_efficiency_table.csv"),
        "资源回收": row_count(PLANNING_OVERVIEW / "planning_recovery_table.csv"),
        "扰动控制": row_count(PLANNING_OVERVIEW / "planning_disturbance_table.csv"),
        "综合权衡": row_count(PLANNING_OVERVIEW / "planning_weighted_table.csv"),
    }
    count_text = "；".join(f"{k}{v}条" for k, v in counts.items() if v is not None)

    fig, ax = plt.subplots(figsize=(12.4, 4.95))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.set_facecolor("white")

    top_y, w, h = 0.645, 0.175, 0.205
    xs = [0.045, 0.29, 0.535, 0.78]
    cards = [
        ("输入参数", "采区边界、钻孔煤厚\n煤柱规则、ODI阈值\n推进长度与采高范围", FLOW_COLORS[0]),
        ("候选生成", "按走向/倾向与面宽参数\n形成多模式候选池\n保留可计算几何参数", FLOW_COLORS[1]),
        ("硬约束过滤", "边界内缩、煤柱约束\n连通域、方向与长度\n不合格候选剔除", FLOW_COLORS[3]),
        ("推荐候选", "非支配排序后输出\n方案A/B/C\n供正文人工选用", FLOW_COLORS[4]),
    ]
    centers = []
    for i, (x, (title, body, accent)) in enumerate(zip(xs, cards), start=1):
        ppt_card(ax, x, top_y, w, h, title, body, number=i, accent=accent, fc="#FFFFFF")
        centers.append((x + w / 2, top_y + h / 2))
    for i in range(3):
        ppt_arrow(ax, (xs[i] + w, top_y + h / 2), (xs[i + 1], top_y + h / 2))

    mid_y, mw, mh = 0.365, 0.235, 0.165
    mids = [
        (0.175, "模块化评价口径", "工程效率、资源回收\n扰动控制、综合权衡", FLOW_COLORS[0]),
        (0.405, "ODI/推进长度校核", "ODI均值、P90、超阈值比例\n最小推进长度与覆盖率", FLOW_COLORS[2]),
        (0.635, "非支配排序", "Pareto rank、综合得分\nTop-K与合格性标记", FLOW_COLORS[3]),
    ]
    for x, title, body, accent in mids:
        ppt_card(ax, x, mid_y, mw, mh, title, body, fc="#F7F9FB", accent=accent, title_size=10.0, body_size=8.1)
    ppt_arrow(ax, (0.375, mid_y + mh / 2), (0.405, mid_y + mh / 2))
    ppt_arrow(ax, (0.64, mid_y + mh / 2), (0.635, mid_y + mh / 2))
    ppt_arrow(ax, (0.38, top_y), (0.30, mid_y + mh), rad=-0.12)
    ppt_arrow(ax, (0.62, mid_y + mh), (0.62, top_y), rad=0.08)
    ppt_arrow(ax, (0.78, mid_y + mh), (0.86, top_y), rad=0.12)

    ppt_card(
        ax,
        0.075,
        0.075,
        0.39,
        0.160,
        "已核实候选记录",
        count_text or "未找到候选表行数",
        accent="#8B96A3",
        fc="#FFFFFF",
        title_size=9.7,
        body_size=7.9,
    )
    ppt_card(
        ax,
        0.535,
        0.075,
        0.39,
        0.160,
        "统一统计出口",
        "覆盖率、ODI均值、P90、超阈值比例\n风险得分；统一采样数4500。",
        accent="#8B96A3",
        fc="#FFFFFF",
        title_size=9.7,
        body_size=7.9,
    )

    return {
        "files": save_all(fig, "Fig09_candidate_generation_filtering_flow"),
        "method": "根据现有算法逻辑和候选表统计重画；本轮按PPT流程图风格单独重绘",
        "kind": "方法示意图",
        "source": [
            Path("export_scene_visuals.py"),
            PLANNING_OVERVIEW / "planning_efficiency_table.csv",
            PLANNING_OVERVIEW / "planning_recovery_table.csv",
            PLANNING_OVERVIEW / "planning_disturbance_table.csv",
            PLANNING_OVERVIEW / "planning_weighted_table.csv",
            ABC_STATS,
        ],
        "note": "图中候选数仅采用已保存表格行数；未把未保存的内存候选过程扩写为结果。",
    }


def fig10_abc_metrics() -> dict:
    df = pd.read_csv(ABC_STATS)
    df = df[df["plan_code"].isin(["A", "B", "C"])].copy()
    df["方案"] = df["plan_code"].map({"A": "方案A", "B": "方案B", "C": "方案C"})
    plan_colors = [SCHEME_COLORS[c] for c in df["plan_code"]]
    plan_edges = ["white"] * len(plan_colors)

    fig, axes = plt.subplots(1, 3, figsize=(12.3, 3.5), constrained_layout=True)

    bars0 = axes[0].bar(df["方案"], df["coverage_pct"], color=plan_colors, width=0.55, edgecolor=plan_edges, linewidth=0.75)
    axes[0].set_ylabel("覆盖率 / %")
    axes[0].set_ylim(0, max(105, df["coverage_pct"].max() * 1.12))
    panel_label(axes[0], "(a)", "覆盖率")
    for x, y in zip(df["方案"], df["coverage_pct"]):
        axes[0].text(x, y + 1.2, f"{y:.2f}", ha="center", fontsize=7.4)
    style_publication_axis(axes[0], ygrid=True)

    metrics = ["odi_mean", "odi_p90", "risk_score"]
    labels = ["ODI均值", "P90", "风险得分"]
    x = np.arange(len(df))
    bw = 0.22
    metric_colors = METRIC_COLORS
    for i, (m, lab) in enumerate(zip(metrics, labels)):
        axes[1].bar(x + (i - 1) * bw, df[m], width=bw, label=lab, color=metric_colors[i], edgecolor="white", linewidth=0.65)
    axes[1].set_xticks(x)
    axes[1].set_xticklabels(df["方案"])
    axes[1].set_ylim(0, 0.75)
    panel_label(axes[1], "(b)", "ODI与风险得分")
    axes[1].legend(frameon=False, ncol=1, loc="upper right")
    style_publication_axis(axes[1], ygrid=True)

    bars2 = axes[2].bar(df["方案"], df["odi_gt_070_pct"], color=plan_colors, width=0.55, edgecolor=plan_edges, linewidth=0.75)
    axes[2].set_ylabel("超阈值比例 / %")
    axes[2].set_ylim(0, max(2.0, df["odi_gt_070_pct"].max() * 1.42))
    panel_label(axes[2], "(c)", "ODI>0.70比例")
    for xlab, y in zip(df["方案"], df["odi_gt_070_pct"]):
        axes[2].text(xlab, y + 0.045, f"{y:.2f}", ha="center", fontsize=7.4)
    style_publication_axis(axes[2], ygrid=True)

    return {
        "files": save_all(fig, "Fig10_abc_multi_indicator_comparison"),
        "method": "根据现有统计表重画，已按期刊图风格重导出",
        "kind": "结果图",
        "source": [ABC_STATS, SENS_SUMMARY],
        "note": "仅绘制统计表中可核实的覆盖率、ODI均值、P90、ODI>0.70比例和风险得分；未补造缺失的资源回收指标。",
    }


def fig11_threshold_sensitivity() -> dict:
    df = pd.read_csv(THRESHOLD_STATS)
    labels = {"A": "方案A", "B": "方案B", "C": "方案C"}
    styles = {"A": ("o", "-"), "B": ("s", "--"), "C": ("^", "-.")}
    colors = SCHEME_COLORS

    fig, ax = plt.subplots(figsize=(6.6, 3.8), constrained_layout=True)
    for code in ["A", "B", "C"]:
        sub = df[df["plan_code"] == code].sort_values("threshold")
        marker, ls = styles[code]
        ax.plot(
            sub["threshold"],
            sub["exceed_pct"],
            marker=marker,
            linestyle=ls,
            color=colors[code],
            linewidth=1.35,
            markersize=4.2,
            markeredgewidth=0.45,
            markeredgecolor="white",
            label=labels[code],
        )
    ax.set_xlabel("ODI阈值")
    ax.set_ylabel("超阈值比例 / %")
    ax.set_xticks([0.65, 0.70, 0.75, 0.80])
    ax.set_ylim(-0.25, max(10, df["exceed_pct"].max() * 1.14))
    ax.margins(x=0.055)
    panel_label(ax, "(a)", "阈值敏感性")
    ax.legend(frameon=False, loc="upper right")
    style_publication_axis(ax, ygrid=True)

    return {
        "files": save_all(fig, "Fig11_threshold_sensitivity"),
        "method": "根据现有阈值敏感性表重画，已按期刊图风格重导出",
        "kind": "结果图",
        "source": [THRESHOLD_STATS, SENS_SUMMARY],
        "note": "阈值点为0.65、0.70、0.75、0.80，全部来自项目CSV。",
    }


def fig12_weight_sensitivity() -> dict:
    df = pd.read_csv(WEIGHT_STATS)
    order = ["baseline", "wd_plus10pct", "wd_minus10pct", "wo_plus10pct", "wo_minus10pct", "wf_plus10pct", "wf_minus10pct", "aquifer_special"]
    label_map = {
        "baseline": "基准",
        "wd_plus10pct": "沉陷+10%",
        "wd_minus10pct": "沉陷-10%",
        "wo_plus10pct": "含水层+10%",
        "wo_minus10pct": "含水层-10%",
        "wf_plus10pct": "上行+10%",
        "wf_minus10pct": "上行-10%",
        "aquifer_special": "上行专项",
    }
    colors = SCHEME_COLORS
    markers = {"A": "o", "B": "s", "C": "^"}
    linestyles = {"A": "-", "B": "--", "C": "-."}

    fig, ax = plt.subplots(figsize=(8.8, 4.15), constrained_layout=True)
    x = np.arange(len(order))
    for code in ["A", "B", "C"]:
        sub = df[df["plan_code"] == code].set_index("case_id").loc[order]
        ax.plot(
            x,
            sub["risk_score"],
            marker=markers[code],
            linestyle=linestyles[code],
            linewidth=1.3,
            markersize=4.3,
            markeredgewidth=0.45,
            markeredgecolor="white",
            color=colors[code],
            label=f"方案{code}",
        )
    ax.set_xticks(x)
    ax.set_xticklabels([label_map[o] for o in order], rotation=25, ha="right")
    ax.set_ylabel("风险综合得分")
    panel_label(ax, "(a)", "权重敏感性")
    ax.legend(frameon=False, ncol=3, loc="upper center", bbox_to_anchor=(0.52, 1.04))
    style_publication_axis(ax, ygrid=True)

    return {
        "files": save_all(fig, "Fig12_weight_sensitivity"),
        "method": "根据现有权重敏感性表重画，已按期刊图风格重导出",
        "kind": "结果图",
        "source": [WEIGHT_STATS, SENS_SUMMARY],
        "note": "情景名称按CSV中的case_id和权重值整理；项目表中该行名为aquifer_special，但权重为wf=0.60，图中按权重解释为上行专项，建议作者复核原始命名。",
    }


def fig14_planning_transfer_chain() -> dict:
    fig, ax = plt.subplots(figsize=(12.2, 4.35))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.set_facecolor("white")

    y, w, h = 0.585, 0.185, 0.235
    xs = [0.055, 0.295, 0.535, 0.775]
    cards = [
        ("规划对象", "工作面边界\n巷道结构\n覆盖范围", FLOW_COLORS[0]),
        ("接续对象", "任务序列\n推进关系\n月度产量", FLOW_COLORS[1]),
        ("调控变量", "采高、面宽\n区段/边界煤柱\n推进长度校核", FLOW_COLORS[3]),
        ("经济评价输入", "产量、成本\n风险联动成本\n现金流入口", FLOW_COLORS[4]),
    ]
    for i, (x, (title, body, accent)) in enumerate(zip(xs, cards), start=1):
        ppt_card(ax, x, y, w, h, title, body, number=i, accent=accent, fc="#FFFFFF", title_size=10.8, body_size=8.7)
    for i in range(3):
        ppt_arrow(ax, (xs[i] + w, y + h / 2), (xs[i + 1], y + h / 2))

    ppt_card(
        ax,
        0.19,
        0.235,
        0.62,
        0.145,
        "反馈信息",
        "ODI均值、P90、超阈值比例、推进长度校核、经济可行性约束，回传至候选生成与调控变量修正。",
        accent="#8B96A3",
        fc="#FFFFFF",
        title_size=10.2,
        body_size=8.4,
    )
    ppt_arrow(ax, (0.88, y), (0.75, 0.39), color=FIG8_COLORS["red"], rad=-0.18)
    ppt_arrow(ax, (0.28, 0.315), (0.145, y), color=FIG8_COLORS["red"], rad=-0.18)
    ax.text(0.50, 0.125, "示意性质：仅说明对象与评价入口的传递关系，不绘制未独立导出的经济评价结果。", ha="center", fontsize=8.1, color="#46515D")

    return {
        "files": save_all(fig, "Fig14_planning_result_transfer_chain"),
        "method": "根据论文方法文字重画；本轮按PPT流程图风格单独重绘",
        "kind": "方法示意图",
        "source": [PAPER_TEXT, DESIGN_JSON],
        "note": "仅表达对象传递关系，不绘制未独立导出的经济结果。",
    }


def write_manifest(records: dict[str, dict]) -> None:
    missing = {
        "Fig08": {
            "title_cn": "ODI三分量场分布图",
            "title_en": "Spatial distributions of three ODI component fields",
            "method": "缺失，无法可靠生成",
            "source": [
                str(SURFACE_COMPONENT),
                str(AQUIFER_COMPONENT),
                "未找到：上行开采分量场独立栅格、点集或可重算脚本输出",
            ],
            "kind": "结果图；当前缺少完整分量数据",
            "insert": "2.3 多场景ODI风险表征结果，图4之后",
            "caption": "项目内已有地表下沉与含水层扰动相关ODI图，但缺少上行开采分量的可核实空间场，不能可靠组成三分量结果图。",
            "notice": "不要用综合ODI场反拆为上行开采分量；补图所需最小数据包括三分量同范围栅格或同一坐标口径评价点。",
        },
        "Fig13": {
            "title_cn": "插值精度验证图",
            "title_en": "Validation of interpolation accuracy",
            "method": "缺失，无法可靠生成",
            "source": [
                str(VALIDATION_CANDIDATE),
                "该图为已有实测/预测对比资料，但未能确认是煤厚插值留一交叉验证结果",
            ],
            "kind": "结果图；当前缺少煤厚插值验证数据",
            "insert": "2.2 连续参数场构建结果之后，可作为补充图",
            "caption": "项目中未发现煤厚插值的留一交叉验证表、预测-实测配对表或误差统计，因此不生成插值精度验证图。",
            "notice": "所需最小数据：钻孔ID、实测煤厚、交叉验证预测煤厚、误差或残差；若只验证地表沉陷模型，应另立图题。",
        },
    }

    fig_meta = {
        "Fig06": ("原始边界到有效布置域演化图", "Evolution from the original boundary to the effective layout domain", "1.2 有效布置域与连续参数场构建，式(6)之后", "适合通栏；建议保留a/b/c/d四个子图。"),
        "Fig07": ("连续参数场构建流程图", "Workflow for constructing the continuous parameter field", "2.2 连续参数场构建结果，图2之前或之后", "适合通栏；建议作为过程图，不替代已有普通煤厚场图。"),
        "Fig08": ("ODI扰动场分布与上行专项权重代理场", "Spatial ODI disturbance fields and upward-mining special-weight proxy field", "2.3 多场景ODI风险表征结果，综合ODI图之后", "适合通栏；需在图题或图注中明确(c)为上行专项权重代理场，不是独立实测分量。"),
        "Fig09": ("候选方案生成与筛选流程图", "Workflow of candidate generation and filtering", "1.3 候选方案生成与多目标协同规划模型之后", "适合通栏；本轮已按PPT绘图风格重画。"),
        "Fig10": ("A/B/C三方案多指标对比图", "Multi-indicator comparison among schemes A, B and C", "3.1 结构化规划结果或3.2方案统计段之后", "适合通栏；建议与A/B/C方案叠置图或统计表相邻。"),
        "Fig11": ("阈值敏感性分析图", "Threshold sensitivity analysis", "4.3 后续深化方向或3.2风险统计后", "单栏或通栏均可；若正文不展开敏感性，可作为补充图。"),
        "Fig12": ("权重敏感性分析图", "Weight sensitivity analysis", "4.3 后续深化方向或3.2风险统计后", "适合通栏；需说明风险得分越低越好。"),
        "Fig13": ("地表沉陷ODI预测-实测验证图", "Measured versus predicted ODI validation for surface subsidence", "2.3 或3.2模型验证与风险统计说明之后；也可作为补充图", "适合通栏或半通栏；请勿标注为煤厚插值留一交叉验证图。"),
        "Fig14": ("规划结果传递示意图", "Schematic chain of planning-result transfer", "1.4 方案传递与评价流程之后，或3.2开头", "适合通栏；本轮已按PPT绘图风格重画，明确为方法示意图。"),
    }

    lines = [
        "# Figure Manifest",
        "",
        "说明：本清单仅用于作者手动插图；生成过程未修改论文DOCX。本轮在已安装 scientific-visualization 技能的出版图规范基础上，结合《煤炭科学技术》同类论文图面习惯，统一设置中文宋体、英文Times New Roman字体族。",
        "",
    ]

    for key in ["Fig06", "Fig07", "Fig08", "Fig09", "Fig10", "Fig11", "Fig12", "Fig13", "Fig14"]:
        lines.append(f"## {key}")
        if key in records:
            title_cn, title_en, insert, notice = fig_meta[key]
            rec = records[key]
            files = [p.name for p in rec["files"]]
            lines.extend(
                [
                    f"- 图号建议：{key.replace('Fig', '图')} / {key}",
                    f"- 中文图名：{title_cn}",
                    f"- 英文图名：{title_en}",
                    f"- 生成方式：{rec['method']}",
                    "- 输出文件：" + "；".join(files),
                    "- 数据/来源路径：" + "；".join(str(p) for p in rec["source"]),
                    f"- 是否为结果图或示意图：{rec['kind']}",
                    f"- 推荐插入位置：{insert}",
                    f"- 图注建议：{rec['note']}",
                    f"- 作者手动插入时的注意事项：{notice}",
                    "",
                ]
            )
        else:
            rec = missing[key]
            lines.extend(
                [
                    f"- 图号建议：{key.replace('Fig', '图')} / {key}",
                    f"- 中文图名：{rec['title_cn']}",
                    f"- 英文图名：{rec['title_en']}",
                    f"- 生成方式：{rec['method']}",
                    "- 输出文件：无",
                    "- 数据/来源路径：" + "；".join(rec["source"]),
                    f"- 是否为结果图或示意图：{rec['kind']}",
                    f"- 推荐插入位置：{rec['insert']}",
                    f"- 图注建议：{rec['caption']}",
                    f"- 作者手动插入时的注意事项：{rec['notice']}",
                    "",
                ]
            )

    (OUT / "figure_manifest.md").write_text("\n".join(lines), encoding="utf-8-sig")


def write_status(records: dict[str, dict]) -> None:
    lines = [
        "# Figure Status",
        "",
        "## 本轮优化",
        "",
        "- 本轮在《煤炭科学技术》工程图习惯基础上，进一步统一为图8的turbo连续色带体系：空间场使用连续色带，统计图和流程图使用同一色带的抽样色。",
        "- 全部PNG重新按900 dpi导出，并继续保留SVG/PDF矢量版本；图内减少冗余数值标注和大面积留白，使版面更接近Nature类多子图的简洁标准。",
        "- 字体设置为中文宋体、英文Times New Roman字体族；若某软件打开SVG/PDF时替换字体，请优先检查本机是否安装宋体与Times New Roman。",
        "- 图9和图14保持PPT流程图风格，但去掉过大的页眉式标题，改为以模块、编号、箭头与反馈链为主体，不改变其示意图性质。",
        "",
        "## 已找到可直接使用的图",
        "",
        "- 无。图6-14均需重组、重画或缺失说明；已有图1-5未重复作为新增图直接输出。",
        "",
        "## 已基于项目数据重画的图",
        "",
        "| 图号 | 文件 | 类型 | 主要来源 |",
        "|---|---|---|---|",
    ]
    for key in ["Fig06", "Fig07", "Fig08", "Fig09", "Fig10", "Fig11", "Fig12", "Fig13", "Fig14"]:
        if key in records:
            png = next((p.name for p in records[key]["files"] if p.suffix == ".png"), records[key]["files"][0].name)
            lines.append(f"| {key.replace('Fig', '图')} | `{png}` | {records[key]['kind']} | {records[key]['method']} |")

    lines.extend(
        [
            "",
            "## 数据口径限制说明",
            "",
            "| 图号 | 当前处理方式 | 需要作者注意 |",
            "|---|---|---|",
            "| 图8 | 已重画为地表沉陷、含水层扰动、上行专项权重代理场三子图。 | 项目未导出独立“上行开采”tab评价点，面板(c)不能写成独立实测分量。 |",
            "| 图13 | 已重画为地表沉陷ODI预测-实测验证图。 | 它不是煤厚插值留一交叉验证图；若正文要写煤厚插值精度，仍需另补交叉验证数据。 |",
            "",
            "## 建议作者优先插入的6张图",
            "",
            "1. 图6 原始边界到有效布置域演化图",
            "2. 图7 连续参数场构建流程图",
            "3. 图8 ODI扰动场分布与上行专项权重代理场",
            "4. 图9 候选方案生成与筛选流程图",
            "5. 图10 A/B/C三方案多指标对比图",
            "6. 图13 地表沉陷ODI预测-实测验证图",
            "",
            "图11、图12可放在敏感性分析或补充材料；图14可作为方法链补强图备用。",
        ]
    )
    (OUT / "figure_status.md").write_text("\n".join(lines), encoding="utf-8-sig")


def write_style_reference_notes() -> None:
    lines = [
        "# Figure Style Notes",
        "",
        "用途：记录本轮参考《煤炭科学技术》同类型论文图面，并按图8色带与Nature类多子图标准进一步统一后的作图规则。该文件仅服务素材包，不修改论文正文。",
        "",
        "## 参考论文与观察",
        "",
        "| 参考来源 | 观察到的图形类型 | 对本素材包的调整 |",
        "|---|---|---|",
        "| 采场空间结构模型及相关动力灾害控制研究，煤炭科学技术，2019 | 结构模型示意图，黑白线稿，图内不放大标题，靠图题说明 | 图9、图14保留流程/模型图属性，减少页眉式标题，强化模块和箭头本体 |",
        "| 8.8 m特厚煤层采场覆岩运动与应力动态演化研究，煤炭科学技术，2020 | 地表沉降等值面、推进距离折线、微震频次/能量曲线 | 空间图保留等值填色和色标；本轮将统计图同步为图8色带抽样色，并保留线型与标记区分 |",
        "| 烧变岩侵蚀条件下倾斜煤层露天矿分区境界优化，煤炭科学技术，2020 | 边界/剖面/三维境界类工程图 | 图6保持工程边界表达，边界线加深，填色降低透明但不增加虚构对象 |",
        "| 多煤层开采中间岩层对覆岩移动的影响研究，煤炭科学技术，2020 | 多子图监测曲线与模拟图，中文轴标、图内信息简洁 | 图10-图13统一为图8色带抽样色，同时控制标注密度、线宽和标记大小 |",
        "| 近年煤炭科学技术PDF预览样式 | 中文宋体、英文/数字西文字体，图题放在正文图注而非图内 | 全部图继续使用中文宋体、英文Times New Roman，图内只保留必要标签 |",
        "",
        "## 本轮采用的图面规则",
        "",
        "1. 全套图统一到图8的turbo色带体系：空间场使用连续色带，统计图、流程图和边界演化图使用同一色带的离散抽样色。",
        "2. 多子图按Nature类组合图标准收紧留白：保留必要轴标、单位、色标和图例，删减会造成拥挤的逐点数值标注。",
        "3. 统计图仍保留线型、标记和边线差异：即使打印为灰度，也能区分A/B/C方案和不同指标。",
        "4. 流程图去掉大页眉式标题：图9、图14以模块、编号、箭头和反馈链为主体，图题交给作者正文图注。",
        "5. 输出质量统一：PNG按900 dpi导出，SVG/PDF保留可编辑矢量版本；中文使用宋体，英文和数字使用Times New Roman。",
        "6. 不新增结果数据：所有数值仍来自项目CSV、JSON和论文抽取文本；图8采用项目导出ODI评价点并明确上行代理口径，图13采用已有预测-实测误差分析数据。",
    ]
    (OUT / "style_reference_notes.md").write_text("\n".join(lines), encoding="utf-8-sig")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    records = {
        "Fig06": fig06_boundary_evolution(),
        "Fig07": fig07_parameter_field_workflow(),
        "Fig08": fig08_odi_component_fields(),
        "Fig09": fig09_candidate_filtering_flow(),
        "Fig10": fig10_abc_metrics(),
        "Fig11": fig11_threshold_sensitivity(),
        "Fig12": fig12_weight_sensitivity(),
        "Fig13": fig13_odi_validation(),
        "Fig14": fig14_planning_transfer_chain(),
    }
    write_manifest(records)
    write_status(records)
    write_style_reference_notes()
    print(f"Wrote {len(list(OUT.glob('*')))} files to {OUT}")


if __name__ == "__main__":
    main()
