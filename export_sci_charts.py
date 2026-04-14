"""
SCI Paper-Quality Chart Export for Mining Disturbance Assessment System.

Generates all figures matching the website's visualization logic at
publication quality (300 DPI, Times New Roman, PNG + PDF dual output).

Usage:  python export_sci_charts.py
"""

import csv
import io
import json
import os
import zipfile
from datetime import datetime
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import numpy as np
from matplotlib.colors import LinearSegmentedColormap, BoundaryNorm
from scipy.interpolate import griddata

# ═══════════════════════════════════════════════════════════
#  PATHS
# ═══════════════════════════════════════════════════════════
DEMO_DIR = Path(r"D:\xiangmu\miningplan\mining-plan\frontend\public\demo")
OUT_DIR = Path(r"D:\xiangmu\miningplan\data\export_package\sci_figures")
DEMO_FILES = sorted(DEMO_DIR.glob("*.miningplan.json"))

# ═══════════════════════════════════════════════════════════
#  SCI FIGURE STANDARDS
# ═══════════════════════════════════════════════════════════
DPI = 300
FIG_SINGLE_W = 3.5  # single-column width (inches)
FIG_SINGLE_H = 2.8
FIG_DOUBLE_W = 7.0  # double-column width
FIG_DOUBLE_H = 5.0
FIG_MAP_W = 6.0
FIG_MAP_H = 5.0
FIG_2x2_W = 7.0
FIG_2x2_H = 6.5

# ═══════════════════════════════════════════════════════════
#  COLOR PALETTES (exact match from App.jsx)
# ═══════════════════════════════════════════════════════════
# Line 15202: blueRed diverging (ODI heatmap default)
BLUE_RED_STOPS = ["#1d4ed8", "#60a5fa", "#f8fafc", "#fca5a5", "#dc2626"]
# Line 15200: viridis (geology cloud maps)
VIRIDIS_STOPS = ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"]
# Lines 28391-95: ODI level I-V
LEVEL_COLORS = ["#10b981", "#84cc16", "#eab308", "#f97316", "#ef4444"]
LEVEL_LABELS = ["I Stable", "II Slight", "III Moderate", "IV Strong", "V Severe"]
# Line 6724: binned bar
BIN_COLORS = ["#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9"]
# Error trend: lines 26922-24
ERR_ODI_COLOR = "#3b82f6"
ERR_MEASURED_COLOR = "#ef4444"
ERR_RATIO_COLOR = "#cbd5e1"
# Stats comparison: lines 6771-74
STAT_MEAN = "#60a5fa"
STAT_P90 = "#f59e0b"
STAT_MAX = "#ef4444"
STAT_TOTAL = "#8b5cf6"
# Point category colors
CAT_COLORS = {
    "geo": "#6b7280",
    "gray": "#9ca3af",
    "blue": "#3b82f6",
    "pink": "#ec4899",
    "green": "#22c55e",
    "red": "#ef4444",
}

# ═══════════════════════════════════════════════════════════
#  MATPLOTLIB RC PARAMS (SCI standard)
# ═══════════════════════════════════════════════════════════
plt.rcParams.update(
    {
        "font.family": "serif",
        "font.serif": ["Times New Roman", "DejaVu Serif"],
        "mathtext.fontset": "stix",
        "font.size": 8,
        "axes.titlesize": 9,
        "axes.labelsize": 8,
        "xtick.labelsize": 7,
        "ytick.labelsize": 7,
        "legend.fontsize": 7,
        "figure.dpi": DPI,
        "savefig.dpi": DPI,
        "savefig.bbox": "tight",
        "savefig.pad_inches": 0.05,
        "axes.linewidth": 0.6,
        "xtick.major.width": 0.5,
        "ytick.major.width": 0.5,
        "lines.linewidth": 0.8,
        "axes.unicode_minus": False,
    }
)


def blue_red_cmap(steps: int = 5) -> LinearSegmentedColormap:
    """ODI heatmap: blueRed diverging palette, discretized."""
    cmap = LinearSegmentedColormap.from_list("blueRed", BLUE_RED_STOPS, N=256)
    return cmap


def viridis_cmap() -> LinearSegmentedColormap:
    return LinearSegmentedColormap.from_list("viridis", VIRIDIS_STOPS, N=256)


def discretize_cmap(cmap: LinearSegmentedColormap, steps: int) -> tuple:
    """Return (cmap_discrete, norm, boundaries) for step-based coloring."""
    bounds = np.linspace(0, 1, steps + 1)
    norm = BoundaryNorm(bounds, ncolors=steps)
    colors = [cmap(b + 0.5 / steps) for b in bounds[:-1]]
    disc_cmap = LinearSegmentedColormap.from_list("disc", colors, N=steps)
    return disc_cmap, norm, bounds


# ═══════════════════════════════════════════════════════════
#  DATA UTILITIES
# ═══════════════════════════════════════════════════════════
def load_demo(filepath: Path) -> dict:
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


DEMO_ENGLISH = {
    "0-地表下沉.miningplan": "demo_00_surface_subsidence",
    "1-含水层扰动预评价.miningplan": "demo_01_aquifer_pre_eval",
    "2-含水层扰动评价.miningplan": "demo_02_aquifer_eval",
    "3-采区规划案例.miningplan": "demo_03_mining_planning",
    "4-协同调控-突水点.miningplan": "demo_04_cocontrol",
    "5-采掘接续.miningplan": "demo_05_succession",
    "6-全覆岩扰动.miningplan": "demo_06_full_overburden",
}

DEMO_TITLE_EN = {
    "0-地表下沉.miningplan": "Surface Subsidence",
    "1-含水层扰动预评价.miningplan": "Aquifer Pre-Evaluation",
    "2-含水层扰动评价.miningplan": "Aquifer Disturbance Eval",
    "3-采区规划案例.miningplan": "Mining Area Planning",
    "4-协同调控-突水点.miningplan": "Coordinated Control",
    "5-采掘接续.miningplan": "Mining Succession",
    "6-全覆岩扰动.miningplan": "Full Overburden Disturbance",
}

TAB_TITLE_EN = {
    "surface": "Surface",
    "aquifer": "Aquifer",
    "upward": "Upward Mining",
    "full": "Composite",
}

TAB_EN = {"surface": "surface", "aquifer": "aquifer", "upward": "upward", "full": "full"}

PARAM_KEYS = ["Ti", "Hi", "Di", "Mi"]
PARAM_UNITS = {"Ti": "m", "Hi": "m", "Di": "m", "Mi": "m"}
PARAM_LABELS = {"Ti": "Thickness $T_i$", "Hi": "Distance $H_i$", "Di": "Depth $D_i$", "Mi": "Mining height $M_i$"}


def get_odi_points(data: dict, tab_id: str) -> list:
    """Get ODI points from tab or cocontrol union result."""
    sp = data.get("scenarioParamsById", {})
    tab = sp.get(tab_id, {})
    odi_result = tab.get("odiResult")
    if odi_result and odi_result.get("points"):
        return odi_result["points"]
    # Fallback: cocontrol union (demo 4)
    cc = data.get("cocontrol", {})
    union = cc.get("results", {}).get("odiUnionResult")
    if union and union.get("points"):
        return union["points"]
    return []


def get_param_points(data: dict, tab_id: str) -> list:
    sp = data.get("scenarioParamsById", {})
    tab = sp.get(tab_id, {})
    pr = tab.get("paramExtractionResult")
    return pr.get("points", []) if pr else []


def get_level_ranges(tab_data: dict) -> list:
    """Get ODI level ranges from measuredZoningResult or defaults."""
    mzr = tab_data.get("measuredZoningResult")
    if mzr and mzr.get("bins") and len(mzr["bins"]) == 5:
        return [
            {"lo": float(b["odiLo"]), "hi": float(b["odiHi"]), "includeHi": i == 4}
            for i, b in enumerate(mzr["bins"])
        ]
    return [
        {"lo": 0.0, "hi": 0.2, "includeHi": False},
        {"lo": 0.2, "hi": 0.4, "includeHi": False},
        {"lo": 0.4, "hi": 0.6, "includeHi": False},
        {"lo": 0.6, "hi": 0.8, "includeHi": False},
        {"lo": 0.8, "hi": 1.0, "includeHi": True},
    ]


def coord_base(xs: list, ys: list) -> tuple:
    """Return (base_x, base_y) for offset coordinate display."""
    return min(xs), min(ys)


def fmt_tick(x, pos, base):
    return f"{x - base:.0f}"


# ═══════════════════════════════════════════════════════════
#  FIGURE 1: ODI HEATMAP
# ═══════════════════════════════════════════════════════════
def plot_odi_heatmap(
    odi_points: list,
    drillholes: list,
    boundary: list,
    workfaces: list,
    title: str,
    steps: int = 5,
) -> plt.Figure | None:
    if not odi_points or len(odi_points) < 4:
        return None

    xs = np.array([p["x"] for p in odi_points])
    ys = np.array([p["y"] for p in odi_points])
    vals = np.array([p.get("odiNorm", p.get("odi", 0)) for p in odi_points])

    bx, by = coord_base(xs, ys)
    res = min(300, max(80, len(odi_points) // 3))

    xi = np.linspace(xs.min(), xs.max(), res)
    yi = np.linspace(ys.min(), ys.max(), res)
    xi_g, yi_g = np.meshgrid(xi, yi)

    try:
        zi = griddata((xs, ys), vals, (xi_g, yi_g), method="cubic")
    except Exception:
        zi = griddata((xs, ys), vals, (xi_g, yi_g), method="linear")

    cmap = blue_red_cmap()
    disc_cmap, norm, bounds = discretize_cmap(cmap, steps)

    fig, ax = plt.subplots(figsize=(FIG_MAP_W, FIG_MAP_H))

    im = ax.pcolormesh(
        xi_g - bx, yi_g - by, zi, cmap=disc_cmap, norm=norm, shading="auto", rasterized=True
    )
    cb = fig.colorbar(im, ax=ax, shrink=0.75, pad=0.02)
    cb.set_label("ODI (normalized)")
    cb.set_ticks(bounds)

    if drillholes:
        dx = [d["x"] - bx for d in drillholes]
        dy = [d["y"] - by for d in drillholes]
        ax.scatter(dx, dy, c="white", marker="^", s=18, edgecolors="k", linewidths=0.4, zorder=5)
        for d in drillholes:
            ax.annotate(
                d.get("id", ""), (d["x"] - bx, d["y"] - by), fontsize=4.5,
                ha="center", va="bottom", color="white", fontweight="bold", zorder=6,
            )

    if boundary:
        bpx = [b["x"] - bx for b in boundary] + [boundary[0]["x"] - bx]
        bpy = [b["y"] - by for b in boundary] + [boundary[0]["y"] - by]
        ax.plot(bpx, bpy, "w-", lw=0.8, alpha=0.9)

    if workfaces:
        wf_map: dict = {}
        for w in workfaces:
            wid = w.get("id", "WF")
            wf_map.setdefault(wid, []).append((w["x"] - bx, w["y"] - by))
        for wid, pts in wf_map.items():
            closed = pts + [pts[0]]
            ax.plot([p[0] for p in closed], [p[1] for p in closed], "--", color="#f472b6", lw=0.7, alpha=0.8)

    ax.set_title(title, fontsize=9, fontweight="bold")
    ax.set_xlabel("X (m)")
    ax.set_ylabel("Y (m)")
    ax.set_aspect("equal")
    fig.tight_layout()
    return fig


# ═══════════════════════════════════════════════════════════
#  FIGURE 2: GEOLOGY CLOUD MAPS (2x2)
# ═══════════════════════════════════════════════════════════
def plot_geology_cloud_2x2(
    param_points: list, drillholes: list, title: str
) -> plt.Figure | None:
    if not param_points or len(param_points) < 4:
        return None

    cmap = viridis_cmap()
    fig, axes = plt.subplots(2, 2, figsize=(FIG_2x2_W, FIG_2x2_H))

    xs = np.array([p["x"] for p in param_points])
    ys = np.array([p["y"] for p in param_points])
    bx, by = coord_base(xs, ys)
    res = min(200, max(60, len(param_points) // 3))

    xi = np.linspace(xs.min(), xs.max(), res)
    yi = np.linspace(ys.min(), ys.max(), res)
    xi_g, yi_g = np.meshgrid(xi, yi)

    for idx, key in enumerate(PARAM_KEYS):
        ax = axes[idx // 2][idx % 2]
        vals = np.array([p.get(key, 0) for p in param_points])
        if np.all(vals == 0) or np.std(vals) < 1e-10:
            ax.text(0.5, 0.5, f"{key}: no variation", transform=ax.transAxes, ha="center", fontsize=7)
            ax.set_title(f"({chr(97 + idx)}) {PARAM_LABELS[key]} ({PARAM_UNITS[key]})", fontsize=8)
            continue

        try:
            zi = griddata((xs, ys), vals, (xi_g, yi_g), method="cubic")
        except Exception:
            zi = griddata((xs, ys), vals, (xi_g, yi_g), method="linear")

        im = ax.pcolormesh(xi_g - bx, yi_g - by, zi, cmap=cmap, shading="auto", rasterized=True)
        fig.colorbar(im, ax=ax, shrink=0.8, pad=0.02)

        if drillholes:
            ax.scatter(
                [d["x"] - bx for d in drillholes],
                [d["y"] - by for d in drillholes],
                c="white", marker="^", s=10, edgecolors="k", linewidths=0.3, zorder=5,
            )

        ax.set_title(f"({chr(97 + idx)}) {PARAM_LABELS[key]} ({PARAM_UNITS[key]})", fontsize=8)
        ax.set_xlabel("X (m)", fontsize=6)
        ax.set_ylabel("Y (m)", fontsize=6)
        ax.tick_params(labelsize=5)
        ax.set_aspect("equal")

    fig.suptitle(title, fontsize=9, fontweight="bold")
    fig.tight_layout(rect=[0, 0, 1, 0.96])
    return fig


# ═══════════════════════════════════════════════════════════
#  FIGURE 3: SPATIAL MAP (boundary + workfaces + drillholes + eval points)
# ═══════════════════════════════════════════════════════════
def plot_spatial_map(
    odi_points: list,
    drillholes: list,
    boundary: list,
    workfaces: list,
    title: str,
) -> plt.Figure | None:
    all_pts = [(d["x"], d["y"]) for d in drillholes]
    for p in odi_points:
        all_pts.append((p["x"], p["y"]))
    for b in boundary:
        all_pts.append((b["x"], b["y"]))
    for w in workfaces:
        all_pts.append((w["x"], w["y"]))
    if not all_pts:
        return None

    xs_all = [p[0] for p in all_pts]
    ys_all = [p[1] for p in all_pts]
    bx, by = min(xs_all), min(ys_all)

    fig, ax = plt.subplots(figsize=(FIG_MAP_W, FIG_MAP_H))

    if boundary:
        bpx = [b["x"] - bx for b in boundary] + [boundary[0]["x"] - bx]
        bpy = [b["y"] - by for b in boundary] + [boundary[0]["y"] - by]
        ax.plot(bpx, bpy, "k-", lw=0.8, label="Boundary")
        ax.fill(bpx, bpy, alpha=0.05, color="#3b82f6")

    if workfaces:
        wf_map: dict = {}
        for w in workfaces:
            wid = w.get("id", "WF")
            wf_map.setdefault(wid, []).append((w["x"] - bx, w["y"] - by))
        colors = plt.cm.Set2(np.linspace(0, 1, max(len(wf_map), 1)))
        for i, (wid, pts) in enumerate(wf_map.items()):
            closed = pts + [pts[0]]
            ax.plot([p[0] for p in closed], [p[1] for p in closed], "--",
                    color=colors[i % len(colors)], lw=0.8, label=f"Face {wid}")

    if odi_points:
        for cat, color in CAT_COLORS.items():
            cat_pts = [p for p in odi_points if p.get("cat") == cat]
            if cat_pts:
                ax.scatter(
                    [p["x"] - bx for p in cat_pts],
                    [p["y"] - by for p in cat_pts],
                    c=color, s=6, alpha=0.6, edgecolors="none",
                    label=f"{cat} ({len(cat_pts)})", zorder=3,
                )

    if drillholes:
        ax.scatter(
            [d["x"] - bx for d in drillholes],
            [d["y"] - by for d in drillholes],
            c="white", marker="^", s=25, edgecolors="k", linewidths=0.5,
            zorder=5, label=f"Boreholes ({len(drillholes)})",
        )

    ax.set_title(title, fontsize=9, fontweight="bold")
    ax.set_xlabel("X (m)")
    ax.set_ylabel("Y (m)")
    ax.set_aspect("equal")
    ax.legend(loc="upper right", fontsize=5.5, framealpha=0.9, markerscale=0.8)
    fig.tight_layout()
    return fig


# ═══════════════════════════════════════════════════════════
#  FIGURE 4: ODI HISTOGRAM
# ═══════════════════════════════════════════════════════════
def plot_odi_histogram(odi_points: list, title: str, bins: int = 30) -> plt.Figure | None:
    if not odi_points:
        return None
    vals = [p.get("odiNorm", p.get("odi", 0)) for p in odi_points]
    fig, ax = plt.subplots(figsize=(FIG_SINGLE_W, FIG_SINGLE_H))
    ax.hist(vals, bins=bins, color="#31688e", edgecolor="white", linewidth=0.3, alpha=0.9)
    mean_v = np.mean(vals)
    ax.axvline(mean_v, color="#dc2626", ls="--", lw=0.8, label=f"Mean = {mean_v:.4f}")
    ax.set_title(title, fontsize=9, fontweight="bold")
    ax.set_xlabel("ODI (normalized)")
    ax.set_ylabel("Count")
    ax.legend(fontsize=6)
    fig.tight_layout()
    return fig


# ═══════════════════════════════════════════════════════════
#  FIGURE 5: ODI LEVEL PIE
# ═══════════════════════════════════════════════════════════
def plot_odi_level_pie(
    odi_points: list, level_ranges: list, title: str
) -> plt.Figure | None:
    if not odi_points:
        return None

    counts = []
    labels_out = []
    for i, r in enumerate(level_ranges):
        lo, hi = r["lo"], r["hi"]
        inc = r.get("includeHi", i == 4)
        cnt = 0
        for p in odi_points:
            v = p.get("odiNorm", 0)
            if not np.isfinite(v):
                continue
            if inc:
                cnt += (lo <= v <= hi)
            else:
                cnt += (lo <= v < hi)
        counts.append(cnt)
        labels_out.append(f"{LEVEL_LABELS[i]}\n[{lo:.2f}-{hi:.2f}]")

    total = sum(counts)
    if total == 0:
        return None

    fig, ax = plt.subplots(figsize=(FIG_SINGLE_W, FIG_SINGLE_H))
    wedges, texts, autotexts = ax.pie(
        counts, labels=None, colors=LEVEL_COLORS, autopct="%1.1f%%",
        startangle=90, pctdistance=0.78, wedgeprops={"linewidth": 0.5, "edgecolor": "white"},
    )
    for at in autotexts:
        at.set_fontsize(6)
    ax.legend(
        wedges,
        [f"{labels_out[i]} ({counts[i]})" for i in range(5)],
        loc="center left", bbox_to_anchor=(1, 0.5), fontsize=5.5, frameon=False,
    )
    ax.set_title(title, fontsize=9, fontweight="bold")
    fig.tight_layout()
    return fig


# ═══════════════════════════════════════════════════════════
#  FIGURE 6: PARAMETER SCATTER MATRIX
# ═══════════════════════════════════════════════════════════
def plot_param_scatter_matrix(points: list, title: str) -> plt.Figure | None:
    if not points or len(points) < 5:
        return None

    params = ["Ti", "Hi", "Di"]
    units = {"Ti": "(m)", "Hi": "(m)", "Di": "(m)"}
    n = len(params)

    fig, axes = plt.subplots(n, n, figsize=(FIG_2x2_W, FIG_2x2_H * 0.8))

    for i in range(n):
        for j in range(n):
            ax = axes[i][j]
            if i == j:
                vals = [p.get(params[i], 0) for p in points]
                ax.hist(vals, bins=25, color="#26828e", alpha=0.8, edgecolor="white", linewidth=0.2)
                if i == n - 1:
                    ax.set_xlabel(f"${params[i]}$ {units[params[i]]}", fontsize=6)
                if j == 0:
                    ax.set_ylabel("Count", fontsize=6)
            else:
                xv = [p.get(params[j], 0) for p in points]
                yv = [p.get(params[i], 0) for p in points]
                ax.scatter(xv, yv, s=3, alpha=0.4, c="#31688e", edgecolors="none")
                if i == n - 1:
                    ax.set_xlabel(f"${params[j]}$ {units[params[j]]}", fontsize=6)
                if j == 0:
                    ax.set_ylabel(f"${params[i]}$ {units[params[i]]}", fontsize=6)
            ax.tick_params(labelsize=5)

    fig.suptitle(title, fontsize=9, fontweight="bold")
    fig.tight_layout(rect=[0, 0, 1, 0.96])
    return fig


# ═══════════════════════════════════════════════════════════
#  FIGURE 7: ERROR TREND CHART
# ═══════════════════════════════════════════════════════════
def plot_error_trend(error_data: list, line_label: str, title: str) -> plt.Figure | None:
    if not error_data:
        return None

    ids = [d.get("id", str(i)) for i, d in enumerate(error_data)]
    odi_re = [d.get("odiRenorm", 0) for d in error_data]
    measured = [d.get("measured", 0) for d in error_data]
    err_ratio = [abs(d.get("errorRatioChart", d.get("errorRatio", 0))) for d in error_data]

    fig, ax1 = plt.subplots(figsize=(FIG_DOUBLE_W, FIG_SINGLE_H))

    x = np.arange(len(ids))
    ax1.bar(x, err_ratio, color=ERR_RATIO_COLOR, width=0.6, alpha=0.7, label="Error ratio", zorder=2)

    ax1.plot(x, odi_re, color=ERR_ODI_COLOR, lw=0.8, marker="o", ms=2.5, label="ODI (renorm)", zorder=3)
    ax1.set_ylabel("ODI / Error", fontsize=7)
    ax1.set_ylim(0, max(max(odi_re, default=0), max(err_ratio, default=0)) * 1.15)

    ax2 = ax1.twinx()
    ax2.plot(x, measured, color=ERR_MEASURED_COLOR, ls="--", lw=0.8, marker="s", ms=2,
             label="Measured", zorder=4)
    ax2.set_ylabel("Measured value (m)", fontsize=7, color=ERR_MEASURED_COLOR)
    ax2.tick_params(axis="y", colors=ERR_MEASURED_COLOR, labelsize=6)

    ax1.set_xticks(x[::max(1, len(x) // 12)])
    ax1.set_xticklabels([ids[i] for i in range(0, len(ids), max(1, len(ids) // 12))], fontsize=5, rotation=45)

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper right", fontsize=5.5, framealpha=0.9)

    ax1.set_title(title, fontsize=9, fontweight="bold")
    ax1.set_xlabel("Measurement point")
    fig.tight_layout()
    return fig


# ═══════════════════════════════════════════════════════════
#  FIGURE 8: WEIGHT RADAR
# ═══════════════════════════════════════════════════════════
def plot_weight_radar(weights: dict, title: str) -> plt.Figure | None:
    if not weights:
        return None

    wd = weights.get("wd")
    wo = weights.get("wo")
    wf = weights.get("wf")

    # Scalar format: wd=0.45, wo=0.3, wf=0.25
    if isinstance(wd, (int, float)) and isinstance(wo, (int, float)) and isinstance(wf, (int, float)):
        labels = ["$w_d$\n(Geology)", "$w_o$\n(Mining)", "$w_f$\n(Composite)"]
        values = [wd, wo, wf]
        n = 3
        angles = np.linspace(0, 2 * np.pi, n, endpoint=False).tolist()
        angles += angles[:1]
        values += values[:1]

        fig, ax = plt.subplots(figsize=(FIG_SINGLE_W, FIG_SINGLE_H), subplot_kw=dict(polar=True))
        ax.plot(angles, values, "o-", lw=0.8, color="#31688e", ms=4)
        ax.fill(angles, values, alpha=0.15, color="#31688e")
        ax.set_xticks(angles[:-1])
        ax.set_xticklabels(labels, fontsize=7)
        ax.set_ylim(0, max(values) * 1.2)
        ax.set_title(title, fontsize=9, fontweight="bold", pad=15)
        fig.tight_layout()
        return fig

    # Dict format (older): wd={Ti:0.1, Hi:0.2,...}, wo={...}, wf={...}
    if isinstance(wd, dict) and isinstance(wo, dict) and isinstance(wf, dict):
        all_keys = list(set(list(wd.keys()) + list(wo.keys()) + list(wf.keys())))
        if not all_keys:
            return None
        n = len(all_keys)
        angles = np.linspace(0, 2 * np.pi, n, endpoint=False).tolist()
        angles += angles[:1]

        fig, ax = plt.subplots(figsize=(FIG_SINGLE_W + 0.5, FIG_SINGLE_H), subplot_kw=dict(polar=True))
        for w_data, name, color in [
            (wd, "$w_d$ (Geology)", "#31688e"),
            (wo, "$w_o$ (Mining)", "#1f9e89"),
            (wf, "$w_f$ (Composite)", "#f66b19"),
        ]:
            vals = [w_data.get(k, 0) for k in all_keys]
            vals += vals[:1]
            ax.plot(angles, vals, "o-", lw=0.8, label=name, color=color, ms=3)
            ax.fill(angles, vals, alpha=0.1, color=color)

        key_labels = {"Ti": "$T_i$", "Ei": "$E_i$", "Hi": "$H_i$", "Di": "$D_i$",
                      "Mi": "$M_i$", "delta": "$\\delta$", "lpi": "$l_{pi}$", "lci": "$l_{ci}$"}
        ax.set_xticks(angles[:-1])
        ax.set_xticklabels([key_labels.get(k, k) for k in all_keys], fontsize=6)
        ax.legend(loc="upper right", bbox_to_anchor=(1.35, 1.1), fontsize=6)
        ax.set_title(title, fontsize=9, fontweight="bold", pad=15)
        fig.tight_layout()
        return fig

    return None


# ═══════════════════════════════════════════════════════════
#  CSV EXPORT HELPERS
# ═══════════════════════════════════════════════════════════
def _csv_bom(content: str) -> str:
    return "\uFEFF" + content


def odi_csv(points: list) -> str:
    if not points:
        return ""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ID", "Cat", "X(m)", "Y(m)", "ODI", "ODI_norm",
                "Ti(m)", "Ei(GPa)", "Hi(m)", "Di(m)", "Mi(m)",
                "delta(deg)", "lpi(m)", "lci(m)", "inWorkface"])
    for p in points:
        w.writerow([
            p.get("id", ""), p.get("cat", ""),
            f"{p.get('x',0):.2f}", f"{p.get('y',0):.2f}",
            f"{p.get('odi',0):.4f}", f"{p.get('odiNorm',0):.6f}",
            f"{p.get('Ti',0):.2f}", f"{p.get('Ei',0):.1f}",
            f"{p.get('Hi',0):.2f}", f"{p.get('Di',0):.4f}",
            f"{p.get('Mi',0):.2f}", f"{p.get('delta',0):.1f}",
            f"{p.get('lpi',0):.1f}", f"{p.get('lci',0):.1f}",
            p.get("inWorkface", False),
        ])
    return buf.getvalue()


def param_csv(points: list) -> str:
    if not points:
        return ""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ID", "X(m)", "Y(m)", "Ti(m)", "Ei(GPa)", "Hi(m)", "Di(m)", "Mi(m)"])
    for p in points:
        w.writerow([
            p.get("id", ""), f"{p.get('x',0):.2f}", f"{p.get('y',0):.2f}",
            f"{p.get('Ti',0):.2f}", f"{p.get('Ei',0):.1f}",
            f"{p.get('Hi',0):.2f}", f"{p.get('Di',0):.4f}", f"{p.get('Mi',0):.2f}",
        ])
    return buf.getvalue()


def measured_csv(data: list) -> str:
    if not data:
        return ""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ID", "X(m)", "Y(m)", "Measured"])
    for d in data:
        w.writerow([d.get("id",""), f"{d.get('x',0):.4f}", f"{d.get('y',0):.4f}", f"{d.get('measured',0):.4f}"])
    return buf.getvalue()


def drillhole_csv(data: list) -> str:
    if not data:
        return ""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ID", "X(m)", "Y(m)"])
    for d in data:
        w.writerow([d.get("id",""), f"{d.get('x',0):.2f}", f"{d.get('y',0):.2f}"])
    return buf.getvalue()


def workface_csv(data: list) -> str:
    if not data:
        return ""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ID", "X(m)", "Y(m)"])
    for d in data:
        w.writerow([d.get("id",""), f"{d.get('x',0):.4f}", f"{d.get('y',0):.4f}"])
    return buf.getvalue()


# ═══════════════════════════════════════════════════════════
#  SAVE DUAL (PNG + PDF)
# ═══════════════════════════════════════════════════════════
def save_dual(fig: plt.Figure, zf: zipfile.ZipFile, stem: str) -> bool:
    if fig is None:
        return False
    for ext in ("png", "pdf"):
        buf = io.BytesIO()
        fig.savefig(buf, format=ext, dpi=DPI, bbox_inches="tight", facecolor="white", edgecolor="none")
        buf.seek(0)
        zf.writestr(f"{stem}.{ext}", buf.read())
    plt.close(fig)
    return True


# ═══════════════════════════════════════════════════════════
#  PROCESS EACH DEMO
# ═══════════════════════════════════════════════════════════
def process_demo(filepath: Path, zf: zipfile.ZipFile) -> list:
    """Process one demo, return list of generated figure descriptions."""
    demo_name = filepath.stem
    folder = DEMO_ENGLISH.get(demo_name, demo_name)
    print(f"  folder={folder}")
    figures = []

    data = load_demo(filepath)
    sp = data.get("scenarioParamsById", {})
    demo_title = DEMO_TITLE_EN.get(demo_name, demo_name)

    print(f"\n=== {demo_name} ===")

    # Determine which tabs have data
    tabs_with_data = []
    for tab_id, tab_data in sp.items():
        if not isinstance(tab_data, dict):
            continue
        odi_pts = get_odi_points(data, tab_id)
        param_pts = get_param_points(data, tab_id)
        dh = tab_data.get("drillholeData", [])
        if odi_pts or param_pts or dh:
            tabs_with_data.append(tab_id)

    for tab_id in tabs_with_data:
        tab_data = sp[tab_id]
        tab_prefix = f"{folder}/{tab_id}"
        tab_title = TAB_TITLE_EN.get(tab_id, tab_id)

        odi_pts = get_odi_points(data, tab_id)
        param_pts = get_param_points(data, tab_id)
        drillholes = tab_data.get("drillholeData", [])
        boundary = tab_data.get("boundaryData", [])
        workfaces = tab_data.get("workingFaceData", [])
        measured = tab_data.get("measuredConstraintData", [])
        error_by_line = tab_data.get("errorAnalysisByLineId", {})
        odi_result = tab_data.get("odiResult") or {}
        mzr = tab_data.get("measuredZoningResult")

        if not odi_result and tab_id == "aquifer":
            cc = data.get("cocontrol", {})
            odi_result = cc.get("results", {}).get("odiUnionResult") or {}

        weights = odi_result.get("weights", {})
        level_ranges = get_level_ranges(tab_data)

        fig_num = 1

        # fig01: ODI heatmap
        if odi_pts and len(odi_pts) >= 4:
            fig = plot_odi_heatmap(
                odi_pts, drillholes, boundary, workfaces,
                f"ODI Distribution - {demo_title} ({tab_title})",
            )
            stem = f"{tab_prefix}/fig{fig_num:02d}_odi_heatmap"
            if save_dual(fig, zf, stem):
                figures.append((stem, "ODI heatmap (blueRed, 5-step)"))
                print(f"  [OK] fig{fig_num:02d}_odi_heatmap")
            fig_num += 1

        # fig02: Geology cloud 2x2
        if param_pts and len(param_pts) >= 4:
            fig = plot_geology_cloud_2x2(
                param_pts, drillholes,
                f"Geological Parameters - {demo_title} ({tab_title})",
            )
            stem = f"{tab_prefix}/fig{fig_num:02d}_geology_cloud"
            if save_dual(fig, zf, stem):
                figures.append((stem, "Geology cloud (Ti, Hi, Di, Mi)"))
                print(f"  [OK] fig{fig_num:02d}_geology_cloud")
            fig_num += 1

        # fig03: Spatial map
        all_spatial = odi_pts or drillholes or boundary or workfaces
        if all_spatial:
            fig = plot_spatial_map(
                odi_pts, drillholes, boundary, workfaces,
                f"Spatial Distribution - {demo_title} ({tab_title})",
            )
            stem = f"{tab_prefix}/fig{fig_num:02d}_spatial_map"
            if save_dual(fig, zf, stem):
                figures.append((stem, "Spatial map"))
                print(f"  [OK] fig{fig_num:02d}_spatial_map")
            fig_num += 1

        # fig04: ODI histogram
        if odi_pts:
            fig = plot_odi_histogram(odi_pts, f"ODI Frequency - {demo_title} ({tab_title})")
            stem = f"{tab_prefix}/fig{fig_num:02d}_odi_histogram"
            if save_dual(fig, zf, stem):
                figures.append((stem, "ODI histogram"))
                print(f"  [OK] fig{fig_num:02d}_odi_histogram")
            fig_num += 1

        # fig05: ODI level pie
        if odi_pts:
            fig = plot_odi_level_pie(odi_pts, level_ranges, f"ODI Levels - {demo_title} ({tab_title})")
            stem = f"{tab_prefix}/fig{fig_num:02d}_odi_level_pie"
            if save_dual(fig, zf, stem):
                figures.append((stem, "ODI level pie (I-V)"))
                print(f"  [OK] fig{fig_num:02d}_odi_level_pie")
            fig_num += 1

        # fig06: Parameter scatter matrix
        if param_pts and len(param_pts) >= 5:
            fig = plot_param_scatter_matrix(param_pts, f"Parameters - {demo_title} ({tab_title})")
            stem = f"{tab_prefix}/fig{fig_num:02d}_param_scatter"
            if save_dual(fig, zf, stem):
                figures.append((stem, "Parameter scatter matrix"))
                print(f"  [OK] fig{fig_num:02d}_param_scatter")
            fig_num += 1

        # fig07: Error trend (only if error analysis exists)
        if error_by_line:
            line_idx = ord("a")
            for li, (line_key, line_data) in enumerate(error_by_line.items()):
                err_pts = line_data.get("data", [])
                label = line_data.get("label", line_key)
                en_label = f"Survey Line {li + 1}"
                fig = plot_error_trend(err_pts, en_label, f"Error Analysis - {en_label}")
                safe_key = f"line{li + 1}"
                stem = f"{tab_prefix}/fig{fig_num:02d}{chr(line_idx)}_error_trend_{safe_key}"
                if save_dual(fig, zf, stem):
                    figures.append((stem, f"Error trend: {label}"))
                    print(f"  [OK] fig{fig_num:02d}{chr(line_idx)}_error_trend_{safe_key}")
                line_idx += 1
            fig_num += 1

        # fig08: Weight radar
        if weights:
            fig = plot_weight_radar(weights, f"ODI Weights - {demo_title} ({tab_title})")
            stem = f"{tab_prefix}/fig{fig_num:02d}_weight_radar"
            if save_dual(fig, zf, stem):
                figures.append((stem, "Weight radar"))
                print(f"  [OK] fig{fig_num:02d}_weight_radar")
            fig_num += 1

        # CSV data
        csv_map = {
            f"{tab_prefix}/data_odi_points.csv": lambda: odi_csv(odi_pts),
            f"{tab_prefix}/data_parameters.csv": lambda: param_csv(param_pts),
            f"{tab_prefix}/data_drillholes.csv": lambda: drillhole_csv(drillholes),
            f"{tab_prefix}/data_workfaces.csv": lambda: workface_csv(workfaces),
            f"{tab_prefix}/data_measured.csv": lambda: measured_csv(measured),
        }
        for csv_path, csv_fn in csv_map.items():
            content = csv_fn()
            if content:
                zf.writestr(csv_path, _csv_bom(content))

        # ODI summary JSON
        if odi_result:
            summary = {
                "pointCount": len(odi_pts),
                "minOdi": odi_result.get("minOdi"),
                "maxOdi": odi_result.get("maxOdi"),
                "weights": weights,
                "keptFactorKeys": odi_result.get("keptFactorKeys"),
            }
            zf.writestr(
                f"{tab_prefix}/odi_summary.json",
                json.dumps(summary, ensure_ascii=False, indent=2),
            )

    return figures


# ═══════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════
def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_path = OUT_DIR / f"sci_figures_{ts}.zip"

    print(f"Output: {zip_path}")
    print(f"Demos:  {len(DEMO_FILES)}")

    all_figures = []

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for demo_file in DEMO_FILES:
            figs = process_demo(demo_file, zf)
            all_figures.extend(figs)

        # FIGURE_INDEX.md
        index = "# SCI Figure Index\n\n"
        index += f"Generated: {ts}\n"
        index += f"Total figures: {len(all_figures)} (PNG + PDF each)\n\n"
        index += "| # | File | Description |\n|---|------|-------------|\n"
        for i, (stem, desc) in enumerate(all_figures, 1):
            index += f"| {i} | `{stem}.png/pdf` | {desc} |\n"
        zf.writestr("FIGURE_INDEX.md", index)

    size_mb = zip_path.stat().st_size / (1024 * 1024)
    with zipfile.ZipFile(zip_path, "r") as zf:
        names = zf.namelist()
        png_count = sum(1 for n in names if n.endswith(".png"))
        pdf_count = sum(1 for n in names if n.endswith(".pdf"))
        csv_count = sum(1 for n in names if n.endswith(".csv"))
        json_count = sum(1 for n in names if n.endswith(".json"))

    print(f"\n{'='*50}")
    print(f"Done!")
    print(f"  File:   {zip_path}")
    print(f"  Size:   {size_mb:.1f} MB")
    print(f"  PNG:    {png_count}")
    print(f"  PDF:    {pdf_count}")
    print(f"  CSV:    {csv_count}")
    print(f"  JSON:   {json_count}")
    print(f"  Total:  {len(names)} files")


if __name__ == "__main__":
    main()
