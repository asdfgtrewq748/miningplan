"""
Supplementary SCI Figures for Mining Disturbance Assessment Paper.

Generates 4 additional figure types:
  1. Correlation Heatmap (Pearson matrix: Ti/Hi/Di/Mi vs ODI)
  2. Measured vs Predicted 1:1 Scatter Plot with R² (Demo 0)
  3. Cross-case ODI Comparison Bar Chart
  4. Parameter Sensitivity Analysis Chart

Output: data/output/supplementary_figures/ (PNG + PDF dual)
"""

import json
import os
import numpy as np
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from scipy import stats

DEMO_DIR = Path(r"D:\xiangmu\miningplan\mining-plan\frontend\public\demo")
OUT_DIR = Path(r"D:\xiangmu\miningplan\data\output\supplementary_figures")
DEMO_FILES = sorted(DEMO_DIR.glob("*.miningplan.json"))
DPI = 300

DEMO_SHORT = {
    "0-地表下沉.miningplan": "Case 0\nSurface",
    "1-含水层扰动预评价.miningplan": "Case 1\nPre-eval",
    "2-含水层扰动评价.miningplan": "Case 2\nAquifer",
    "3-采区规划案例.miningplan": "Case 3\nPlanning",
    "4-协同调控-突水点.miningplan": "Case 4\nCo-control",
    "5-采掘接续.miningplan": "Case 5\nSuccession",
    "6-全覆岩扰动.miningplan": "Case 6\nFull",
}

DEMO_LABEL = {
    "0-地表下沉.miningplan": "Case 0: Surface Subsidence",
    "1-含水层扰动预评价.miningplan": "Case 1: Aquifer Pre-Eval",
    "2-含水层扰动评价.miningplan": "Case 2: Aquifer Eval",
    "3-采区规划案例.miningplan": "Case 3: Mining Planning",
    "4-协同调控-突水点.miningplan": "Case 4: Coordinated Control",
    "5-采掘接续.miningplan": "Case 5: Mining Succession",
    "6-全覆岩扰动.miningplan": "Case 6: Full Overburden",
}

PARAM_KEYS = ["Ti", "Hi", "Di", "Mi"]
PARAM_LABELS = {
    "Ti": "Thickness $T_i$ (m)",
    "Hi": "Distance $H_i$ (m)",
    "Di": "Depth $D_i$ (m)",
    "Mi": "Mining height $M_i$ (m)",
}

plt.rcParams.update({
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
    "lines.linewidth": 0.8,
})


def load_demo(fp):
    with open(fp, "r", encoding="utf-8") as f:
        return json.load(f)


def get_odi_points(data, tab_id):
    sp = data.get("scenarioParamsById", {})
    tab = sp.get(tab_id, {})
    odi_result = tab.get("odiResult")
    if odi_result and odi_result.get("points"):
        return odi_result["points"], odi_result
    if tab_id == "aquifer":
        cc = data.get("cocontrol", {})
        union = cc.get("results", {}).get("odiUnionResult")
        if union and union.get("points"):
            return union["points"], union
    return [], {}


def get_param_points(data, tab_id):
    sp = data.get("scenarioParamsById", {})
    tab = sp.get(tab_id, {})
    pr = tab.get("paramExtractionResult")
    return pr.get("points", []) if pr else []


def get_active_tab(data):
    sp = data.get("scenarioParamsById", {})
    for tab_id in ["surface", "aquifer", "upward", "full"]:
        td = sp.get(tab_id, {})
        if not isinstance(td, dict):
            continue
        odi_pts, _ = get_odi_points(data, tab_id)
        if odi_pts:
            return tab_id
    return None


def save_dual(fig, stem):
    for ext in ("png", "pdf"):
        fig.savefig(OUT_DIR / f"{stem}.{ext}", format=ext, dpi=DPI,
                     bbox_inches="tight", facecolor="white", edgecolor="none")
    plt.close(fig)


# ═══════════════════════════════════════════════════════════
#  FIGURE S1: CORRELATION HEATMAP
# ═══════════════════════════════════════════════════════════
def plot_correlation_heatmap():
    """Pearson correlation matrix between geological parameters and ODI."""
    all_data = {}
    for fp in DEMO_FILES:
        data = load_demo(fp)
        tab = get_active_tab(data)
        if not tab:
            continue
        odi_pts, _ = get_odi_points(data, tab)
        param_pts = get_param_points(data, tab)
        if not odi_pts or not param_pts:
            continue

        odi_map = {p.get("id", i): p.get("odiNorm", p.get("odi", 0))
                   for i, p in enumerate(odi_pts)}
        for p in param_pts:
            pid = p.get("id", "")
            odi_val = odi_map.get(pid, None)
            if odi_val is None:
                continue
            for key in PARAM_KEYS:
                if key not in all_data:
                    all_data[key] = []
                all_data[key].append(p.get(key, 0))
            if "ODI" not in all_data:
                all_data["ODI"] = []
            all_data["ODI"].append(odi_val)

    if not all_data or len(all_data.get("ODI", [])) < 10:
        print("  [SKIP] Not enough data for correlation heatmap")
        return

    keys = PARAM_KEYS + ["ODI"]
    labels = ["$T_i$ (m)", "$H_i$ (m)", "$D_i$ (m)", "$M_i$ (m)", "ODI"]
    n = len(keys)

    # Build data matrix
    data_matrix = np.array([all_data[k] for k in keys])
    corr = np.corrcoef(data_matrix)

    fig, ax = plt.subplots(figsize=(5, 4.5))
    cmap = LinearSegmentedColormap.from_list(
        "corr", ["#3b82f6", "#f8fafc", "#ef4444"], N=256
    )
    im = ax.imshow(corr, cmap=cmap, vmin=-1, vmax=1, aspect="auto")

    # Annotate
    for i in range(n):
        for j in range(n):
            val = corr[i, j]
            color = "white" if abs(val) > 0.6 else "black"
            ax.text(j, i, f"{val:.2f}", ha="center", va="center",
                    fontsize=7, color=color, fontweight="bold" if abs(val) > 0.5 else "normal")

    ax.set_xticks(range(n))
    ax.set_yticks(range(n))
    ax.set_xticklabels(labels, fontsize=7, rotation=30, ha="right")
    ax.set_yticklabels(labels, fontsize=7)

    cb = fig.colorbar(im, ax=ax, shrink=0.8, pad=0.02)
    cb.set_label("Pearson $r$", fontsize=8)
    cb.set_ticks([-1, -0.5, 0, 0.5, 1])

    ax.set_title("(a) Pearson Correlation: Parameters vs ODI", fontsize=9, fontweight="bold")
    fig.tight_layout()
    save_dual(fig, "figS1_correlation_heatmap")
    print("  [OK] figS1_correlation_heatmap")


# ═══════════════════════════════════════════════════════════
#  FIGURE S2: MEASURED VS PREDICTED SCATTER
# ═══════════════════════════════════════════════════════════
def plot_measured_vs_predicted():
    """1:1 scatter plot of measured vs ODI-renormalized values (Case 0)."""
    fp = DEMO_FILES[0]
    data = load_demo(fp)
    sp = data.get("scenarioParamsById", {})
    td = sp.get("surface", {})
    err = td.get("errorAnalysisByLineId", {})

    if not err:
        print("  [SKIP] No error analysis data")
        return

    colors = ["#3b82f6", "#f59e0b", "#10b981"]
    markers = ["o", "s", "^"]

    fig, axes = plt.subplots(1, 3, figsize=(7, 2.8))

    for idx, (lk, ld) in enumerate(err.items()):
        ax = axes[idx]
        err_pts = ld.get("data", [])
        if not err_pts:
            continue

        measured = np.array([d.get("measured", 0) for d in err_pts])
        odi_re = np.array([d.get("odiRenorm", 0) for d in err_pts])

        # Normalize to same scale for 1:1 comparison
        m_min, m_max = measured.min(), measured.max()
        if m_max > m_min:
            measured_norm = (measured - m_min) / (m_max - m_min)
        else:
            measured_norm = measured

        o_min, o_max = odi_re.min(), odi_re.max()
        if o_max > o_min:
            odi_norm = (odi_re - o_min) / (o_max - o_min)
        else:
            odi_norm = odi_re

        # Scatter
        ax.scatter(measured_norm, odi_norm, c=colors[idx], marker=markers[idx],
                   s=12, alpha=0.7, edgecolors="none", zorder=3)

        # 1:1 line
        ax.plot([0, 1], [0, 1], "k--", lw=0.6, alpha=0.5, zorder=2)

        # Linear fit
        if len(measured_norm) > 2:
            slope, intercept, r_value, p_value, std_err = stats.linregress(measured_norm, odi_norm)
            x_fit = np.linspace(0, 1, 100)
            y_fit = slope * x_fit + intercept
            ax.plot(x_fit, y_fit, "-", color=colors[idx], lw=0.8, alpha=0.8, zorder=4)
            r2 = r_value ** 2
            ax.text(0.05, 0.92, f"$R^2$ = {r2:.3f}\n$N$ = {len(measured)}",
                    transform=ax.transAxes, fontsize=6.5, va="top",
                    bbox=dict(boxstyle="round,pad=0.2", facecolor="white", alpha=0.8))

        ax.set_xlim(-0.05, 1.05)
        ax.set_ylim(-0.05, 1.05)
        ax.set_xlabel("Measured (normalized)", fontsize=7)
        ax.set_ylabel("ODI (normalized)", fontsize=7)
        ax.set_title(f"({chr(97 + idx)}) Survey Line {idx + 1}", fontsize=8, fontweight="bold")
        ax.set_aspect("equal")
        ax.tick_params(labelsize=6)

    fig.suptitle("Measured vs. Predicted ODI (Case 0: Surface Subsidence)",
                 fontsize=9, fontweight="bold")
    fig.tight_layout(rect=[0, 0, 1, 0.93])
    save_dual(fig, "figS2_measured_vs_predicted")
    print("  [OK] figS2_measured_vs_predicted")


# ═══════════════════════════════════════════════════════════
#  FIGURE S3: CROSS-CASE COMPARISON BAR CHART
# ═══════════════════════════════════════════════════════════
def plot_cross_case_comparison():
    """Grouped bar chart comparing ODI statistics across all cases."""
    cases = []
    means = []
    stds = []
    p90s = []
    maxs = []
    counts = []

    for fp in DEMO_FILES:
        data = load_demo(fp)
        tab = get_active_tab(data)
        if not tab:
            continue
        odi_pts, _ = get_odi_points(data, tab)
        if not odi_pts:
            continue

        vals = [p.get("odiNorm", p.get("odi", 0)) for p in odi_pts]
        vals = [v for v in vals if v is not None and np.isfinite(v)]
        if not vals:
            continue

        cases.append(DEMO_SHORT.get(fp.stem, fp.stem))
        means.append(np.mean(vals))
        stds.append(np.std(vals))
        p90s.append(np.percentile(vals, 90))
        maxs.append(max(vals))
        counts.append(len(vals))

    if not cases:
        print("  [SKIP] No data for cross-case comparison")
        return

    x = np.arange(len(cases))
    w = 0.18

    fig, ax1 = plt.subplots(figsize=(7, 3.5))

    b1 = ax1.bar(x - 1.5 * w, means, w, label="Mean", color="#60a5fa", edgecolor="white", lw=0.3)
    b2 = ax1.bar(x - 0.5 * w, p90s, w, label="P90", color="#f59e0b", edgecolor="white", lw=0.3)
    b3 = ax1.bar(x + 0.5 * w, maxs, w, label="Max", color="#ef4444", edgecolor="white", lw=0.3)

    # Error bars for std on mean bars
    for i, (bar, s) in enumerate(zip(b1, stds)):
        ax1.errorbar(bar.get_x() + bar.get_width() / 2, bar.get_height(),
                     yerr=s, fmt="none", ecolor="black", elinewidth=0.5, capsize=2, capthick=0.4)

    ax1.set_ylabel("ODI (normalized)", fontsize=8)
    ax1.set_xticks(x)
    ax1.set_xticklabels(cases, fontsize=6.5)
    ax1.set_ylim(0, 1.15)
    ax1.legend(loc="upper left", fontsize=7, framealpha=0.9)

    # Secondary axis: sample count
    ax2 = ax1.twinx()
    ax2.bar(x + 1.5 * w, counts, w, label="$N$ (points)", color="#8b5cf6",
            edgecolor="white", lw=0.3, alpha=0.7)
    ax2.set_ylabel("Number of points", fontsize=8, color="#8b5cf6")
    ax2.tick_params(axis="y", colors="#8b5cf6", labelsize=7)
    ax2.legend(loc="upper right", fontsize=7, framealpha=0.9)

    ax1.set_title("Cross-case ODI Statistical Comparison", fontsize=9, fontweight="bold")
    fig.tight_layout()
    save_dual(fig, "figS3_cross_case_comparison")
    print("  [OK] figS3_cross_case_comparison")


# ═══════════════════════════════════════════════════════════
#  FIGURE S4: PARAMETER SENSITIVITY ANALYSIS
# ═══════════════════════════════════════════════════════════
def plot_sensitivity_analysis():
    """
    Sensitivity analysis: partial correlation between each parameter and ODI,
    grouped by case (showing parameter importance ranking).
    """
    case_names = []
    param_corrs = {k: [] for k in PARAM_KEYS}

    for fp in DEMO_FILES:
        data = load_demo(fp)
        tab = get_active_tab(data)
        if not tab:
            continue
        odi_pts, _ = get_odi_points(data, tab)
        param_pts = get_param_points(data, tab)
        if not odi_pts or not param_pts:
            continue

        odi_map = {p.get("id", i): p.get("odiNorm", p.get("odi", 0))
                   for i, p in enumerate(odi_pts)}

        # Collect matched data
        matched = {}
        for p in param_pts:
            pid = p.get("id", "")
            if pid in odi_map:
                matched[pid] = {k: p.get(k, 0) for k in PARAM_KEYS}
                matched[pid]["ODI"] = odi_map[pid]

        if len(matched) < 10:
            continue

        arr = np.array([[matched[pid][k] for k in PARAM_KEYS + ["ODI"]] for pid in matched])
        if arr.shape[0] < 10:
            continue

        case_names.append(DEMO_SHORT.get(fp.stem, fp.stem).replace("\n", " "))

        # Compute partial correlations (simple: Pearson r for each param vs ODI)
        for i, key in enumerate(PARAM_KEYS):
            vals_param = arr[:, i]
            vals_odi = arr[:, -1]
            if np.std(vals_param) < 1e-10:
                param_corrs[key].append(0.0)
            else:
                r, _ = stats.pearsonr(vals_param, vals_odi)
                param_corrs[key].append(r)

    if not case_names:
        print("  [SKIP] Not enough data for sensitivity analysis")
        return

    n_cases = len(case_names)
    x = np.arange(n_cases)
    w = 0.18

    colors = {"Ti": "#3b82f6", "Hi": "#10b981", "Di": "#f59e0b", "Mi": "#ef4444"}

    fig, ax = plt.subplots(figsize=(7, 3.5))

    for i, key in enumerate(PARAM_KEYS):
        vals = param_corrs[key][:n_cases]
        if len(vals) < n_cases:
            vals += [0.0] * (n_cases - len(vals))
        offset = (i - 1.5) * w
        bars = ax.bar(x + offset, vals, w, label=f"${key}$ ({PARAM_LABELS[key].split('(')[0].strip()})",
                       color=colors[key], edgecolor="white", lw=0.3)

    ax.axhline(0, color="black", lw=0.4, alpha=0.5)
    ax.set_xticks(x)
    ax.set_xticklabels(case_names, fontsize=6.5)
    ax.set_ylabel("Pearson $r$ (parameter vs ODI)", fontsize=8)
    ax.legend(loc="best", fontsize=6, framealpha=0.9, ncol=2)
    ax.set_title("Parameter Sensitivity: Correlation with ODI", fontsize=9, fontweight="bold")
    fig.tight_layout()
    save_dual(fig, "figS4_sensitivity_analysis")
    print("  [OK] figS4_sensitivity_analysis")


# ═══════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════
def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Generating supplementary figures...\n")

    plot_correlation_heatmap()
    plot_measured_vs_predicted()
    plot_cross_case_comparison()
    plot_sensitivity_analysis()

    pngs = list(OUT_DIR.glob("*.png"))
    pdfs = list(OUT_DIR.glob("*.pdf"))
    print(f"\nDone! {len(pngs)} PNG + {len(pdfs)} PDF in {OUT_DIR}")


if __name__ == "__main__":
    main()
