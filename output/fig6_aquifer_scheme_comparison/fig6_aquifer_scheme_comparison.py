from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.lines import Line2D
from matplotlib.patches import PathPatch, Polygon
from matplotlib.path import Path as MplPath
from matplotlib.ticker import MaxNLocator, ScalarFormatter


WORKSPACE = Path(__file__).resolve().parents[2]
OUT_DIR = Path(__file__).resolve().parent

AQUIFER_SCENE_PREFIX = "2-"
PLANNING_SCENE_PREFIX = "3-"

PLAN_SPECS = [
    {
        "code": "A",
        "panel": "（a）工程效率优先方案",
        "mode": "efficiency",
        "signature": "x|wb=50.0000|ws=30.0000|N=5|B=308.0000",
        "show_interpolation": False,
    },
    {
        "code": "B",
        "panel": "（b）资源回收优先方案",
        "mode": "recovery",
        "signature": "y|wb=50.0000|ws=30.0000|N=9|B=335.0000|theta=0.0",
        "show_interpolation": False,
    },
    {
        "code": "C",
        "panel": "（c）低扰动优先方案",
        "mode": "disturbance",
        "signature": "x|wb=80.0000|ws=30-30|N=13|B=100-100|h=f2a5a1b8",
        "show_interpolation": True,
    },
    {
        "code": "D",
        "panel": "（d）综合权重调节方案",
        "mode": "weighted_dist",
        "signature": "y|wb=80.0000|ws=30-30|N=5|B=350-350|h=1db0251b",
        "show_interpolation": True,
    },
]


def setup_fonts() -> None:
    for font_path in [
        Path(r"C:\Windows\Fonts\simsun.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path(r"C:\Windows\Fonts\times.ttf"),
    ]:
        if font_path.exists():
            try:
                matplotlib.font_manager.fontManager.addfont(str(font_path))
            except Exception:
                pass
    plt.rcParams.update(
        {
            "font.family": ["SimSun", "SimHei", "Times New Roman", "DejaVu Sans"],
            "axes.unicode_minus": False,
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
            "svg.fonttype": "none",
            "figure.dpi": 180,
            "savefig.dpi": 600,
            "axes.labelsize": 8.0,
            "xtick.labelsize": 7.0,
            "ytick.labelsize": 7.0,
            "legend.fontsize": 7.8,
        }
    )


def locate_demo_json(prefix: str) -> Path:
    demo_dir = WORKSPACE / "mining-plan" / "frontend" / "public" / "demo"
    matches = sorted(demo_dir.glob(f"{prefix}*.miningplan.json"))
    if not matches:
        raise FileNotFoundError(f"Cannot locate demo project with prefix {prefix!r}.")
    return matches[0]


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def candidate_loops(candidate: dict[str, Any]) -> list[Any]:
    render = candidate.get("render") or {}
    return (
        render.get("plannedWorkfaceLoopsWorld")
        or render.get("facesLoops")
        or candidate.get("facesLoops")
        or []
    )


def candidate_omega_loops(candidate: dict[str, Any]) -> list[Any]:
    render = candidate.get("render") or {}
    return render.get("omegaLoops") or []


def find_candidate(project: dict[str, Any], mode: str, signature: str) -> dict[str, Any]:
    if mode in {"efficiency", "recovery", "disturbance"}:
        candidates = (
            project.get("planningResults", {})
            .get(mode, {})
            .get("result", {})
            .get("candidates", [])
        )
    elif mode == "weighted_dist":
        candidates = (
            project.get("planningResults", {})
            .get("weighted", {})
            .get("result", {})
            .get("distResult", {})
            .get("candidates", [])
        )
    else:
        candidates = []

    for candidate in candidates:
        if candidate.get("signature") == signature or candidate.get("key") == signature:
            return candidate
    raise KeyError(f"Candidate not found: {signature}")


def points_to_xy(points: list[dict[str, Any]], origin_x: float, origin_y: float) -> np.ndarray:
    return np.asarray(
        [[float(point["x"]) - origin_x, float(point["y"]) - origin_y] for point in points],
        dtype=float,
    )


def loop_points(loop: Any) -> list[dict[str, Any]]:
    if isinstance(loop, dict):
        return loop.get("loop") or loop.get("points") or []
    return loop or []


def loop_to_xy(loop: Any, origin_x: float, origin_y: float) -> np.ndarray:
    return points_to_xy(loop_points(loop), origin_x, origin_y)


def make_closed_path(points_xy: np.ndarray) -> MplPath:
    vertices = np.vstack([points_xy, points_xy[0]])
    codes = [MplPath.MOVETO] + [MplPath.LINETO] * (len(points_xy) - 1) + [MplPath.CLOSEPOLY]
    return MplPath(vertices, codes)


def make_clip_patch(points_xy: np.ndarray) -> PathPatch:
    return PathPatch(make_closed_path(points_xy), facecolor="none", edgecolor="none")


def odi_colormap() -> LinearSegmentedColormap:
    stops = [
        (0.00, "#dff3ff"),
        (0.40, "#c9c8ff"),
        (0.65, "#f2b4d4"),
        (0.85, "#ef7f8c"),
        (0.90, "#d94b59"),
        (1.00, "#8f1d2c"),
    ]
    return LinearSegmentedColormap.from_list("odi_blue_pink_red", stops, N=256)


def add_scale_and_north(ax: plt.Axes) -> None:
    x0, x1 = ax.get_xlim()
    y0, y1 = ax.get_ylim()
    width = x1 - x0
    height = y1 - y0

    sx = x0 + 0.07 * width
    sy = y0 + 0.055 * height
    scale_len = 500.0
    ax.plot([sx, sx + scale_len], [sy, sy], color="black", lw=1.1, zorder=10)
    ax.plot([sx, sx], [sy - 12, sy + 12], color="black", lw=0.8, zorder=10)
    ax.plot([sx + scale_len, sx + scale_len], [sy - 12, sy + 12], color="black", lw=0.8, zorder=10)
    ax.text(sx + scale_len / 2, sy + 18, "500 m", ha="center", va="bottom", fontsize=6.8, zorder=10)

    nx = x1 - 0.075 * width
    ny0 = y1 - 0.19 * height
    ax.annotate(
        "N",
        xy=(nx, ny0 + 130),
        xytext=(nx, ny0 - 34),
        ha="center",
        va="bottom",
        fontsize=7.5,
        arrowprops={"arrowstyle": "-|>", "lw": 1.0, "color": "black"},
        zorder=10,
    )


def draw_boundary_fill(ax: plt.Axes, boundary_xy: np.ndarray) -> None:
    ax.add_patch(
        Polygon(
            boundary_xy,
            closed=True,
            facecolor="#f7fbff",
            edgecolor="#c8d6e6",
            lw=0.7,
            zorder=1,
        )
    )


def draw_interpolation(
    ax: plt.Axes,
    odi_xy: np.ndarray,
    odi_values: np.ndarray,
    boundary_xy: np.ndarray,
    cmap: LinearSegmentedColormap,
) -> Any:
    boundary_path = make_closed_path(boundary_xy)
    min_x, max_x = boundary_xy[:, 0].min(), boundary_xy[:, 0].max()
    min_y, max_y = boundary_xy[:, 1].min(), boundary_xy[:, 1].max()
    nx, ny = 280, 170
    gx = np.linspace(min_x, max_x, nx)
    gy = np.linspace(min_y, max_y, ny)
    grid_x, grid_y = np.meshgrid(gx, gy)
    grid_points = np.column_stack([grid_x.ravel(), grid_y.ravel()])

    dx = grid_points[:, None, 0] - odi_xy[None, :, 0]
    dy = grid_points[:, None, 1] - odi_xy[None, :, 1]
    dist2 = dx * dx + dy * dy
    weights = 1.0 / np.maximum(dist2, 1.0)
    grid_values = (weights @ odi_values) / weights.sum(axis=1)
    inside = boundary_path.contains_points(grid_points)
    grid = grid_values.reshape(ny, nx)
    grid[~inside.reshape(ny, nx)] = np.nan

    image = ax.imshow(
        grid,
        extent=[min_x, max_x, min_y, max_y],
        origin="lower",
        cmap=cmap,
        vmin=0,
        vmax=1,
        interpolation="bilinear",
        alpha=0.93,
        zorder=1,
    )
    image.set_clip_path(make_clip_patch(boundary_xy))
    return image


def draw_common_layers(
    ax: plt.Axes,
    boundary_xy: np.ndarray,
    omega_loops_xy: list[np.ndarray],
    drill_xy: np.ndarray,
) -> None:
    ax.plot(
        np.r_[boundary_xy[:, 0], boundary_xy[0, 0]],
        np.r_[boundary_xy[:, 1], boundary_xy[0, 1]],
        color="#9aa7b3",
        lw=0.65,
        zorder=3,
    )
    for omega_xy in omega_loops_xy:
        if len(omega_xy) < 3:
            continue
        ax.plot(
            np.r_[omega_xy[:, 0], omega_xy[0, 0]],
            np.r_[omega_xy[:, 1], omega_xy[0, 1]],
            color="#0067b1",
            linestyle=(0, (4.0, 2.2)),
            lw=1.15,
            zorder=5,
        )
    ax.scatter(
        drill_xy[:, 0],
        drill_xy[:, 1],
        s=10,
        c="black",
        edgecolors="white",
        linewidths=0.25,
        zorder=8,
    )


def draw_workfaces(ax: plt.Axes, candidate: dict[str, Any], origin_x: float, origin_y: float) -> None:
    for face in candidate_loops(candidate):
        pts = loop_to_xy(face, origin_x, origin_y)
        if len(pts) < 3:
            continue
        ax.fill(pts[:, 0], pts[:, 1], facecolor="#d8ebff", alpha=0.34, edgecolor="none", zorder=6)
        ax.plot(
            np.r_[pts[:, 0], pts[0, 0]],
            np.r_[pts[:, 1], pts[0, 1]],
            color="#005baa",
            lw=1.05,
            zorder=7,
        )


def collect_metric_rows(planning_project: dict[str, Any], candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    disturbance_by_sig = (
        planning_project.get("planningResults", {})
        .get("disturbance", {})
        .get("result", {})
        .get("disturbance", {})
        .get("bySignature", {})
    )
    rows = []
    for spec, candidate in zip(PLAN_SPECS, candidates):
        metrics = candidate.get("metrics") or {}
        disturbance = disturbance_by_sig.get(spec["signature"], {})
        rows.append(
            {
                "code": spec["code"],
                "scheme_name": spec["panel"],
                "signature": spec["signature"],
                "face_count": metrics.get("faceCount") or candidate.get("N"),
                "coverage_pct": (metrics.get("coverageRatio") or 0.0) * 100.0,
                "odi_mean": disturbance.get("mean"),
                "odi_p90": disturbance.get("p90"),
                "odi_gt_070_pct": (
                    disturbance.get("exceedRatio") * 100.0
                    if disturbance.get("exceedRatio") is not None
                    else None
                ),
                "risk_score": disturbance.get("score"),
            }
        )
    return rows


def write_stats_csv(rows: list[dict[str, Any]]) -> None:
    path = OUT_DIR / "fig6_aquifer_scheme_comparison_stats.csv"
    fieldnames = [
        "code",
        "scheme_name",
        "signature",
        "face_count",
        "coverage_pct",
        "odi_mean",
        "odi_p90",
        "odi_gt_070_pct",
        "risk_score",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    setup_fonts()

    aquifer_project_path = locate_demo_json(AQUIFER_SCENE_PREFIX)
    planning_project_path = locate_demo_json(PLANNING_SCENE_PREFIX)
    aquifer_project = read_json(aquifer_project_path)
    planning_project = read_json(planning_project_path)

    aquifer = aquifer_project["scenarioParamsById"]["aquifer"]
    boundary_points = aquifer["boundaryData"]
    drill_points = aquifer["drillholeData"]
    odi_points = aquifer["odiResult"]["points"]
    candidates = [find_candidate(planning_project, spec["mode"], spec["signature"]) for spec in PLAN_SPECS]

    all_x: list[float] = []
    all_y: list[float] = []
    for collection in [boundary_points, drill_points, odi_points]:
        for point in collection:
            all_x.append(float(point["x"]))
            all_y.append(float(point["y"]))
    for candidate in candidates:
        for face in candidate_loops(candidate):
            for point in loop_points(face):
                all_x.append(float(point["x"]))
                all_y.append(float(point["y"]))
    for loop in candidate_omega_loops(candidates[0]):
        for point in loop_points(loop):
            all_x.append(float(point["x"]))
            all_y.append(float(point["y"]))

    origin_x = min(all_x)
    origin_y = min(all_y)
    boundary_xy = points_to_xy(boundary_points, origin_x, origin_y)
    drill_xy = points_to_xy(drill_points, origin_x, origin_y)
    odi_xy = points_to_xy(odi_points, origin_x, origin_y)
    odi_values = np.asarray([float(point.get("odiNorm", point.get("odi", 0.0))) for point in odi_points])
    if odi_values.max() > 1.0:
        min_v = float(np.nanmin(odi_values))
        max_v = float(np.nanmax(odi_values))
        odi_values = (odi_values - min_v) / (max_v - min_v)
    odi_values = np.clip(odi_values, 0, 1)

    omega_loops_xy = [loop_to_xy(loop, origin_x, origin_y) for loop in candidate_omega_loops(candidates[0])]
    cmap = odi_colormap()

    pad_x = (max(all_x) - min(all_x)) * 0.035
    pad_y = (max(all_y) - min(all_y)) * 0.055
    xlim = (min(all_x) - origin_x - pad_x, max(all_x) - origin_x + pad_x)
    ylim = (min(all_y) - origin_y - pad_y, max(all_y) - origin_y + pad_y)

    fig, axes = plt.subplots(2, 2, figsize=(7.1, 5.9), sharex=True, sharey=True)
    axes_flat = axes.ravel()
    color_mappable = None

    for ax, spec, candidate in zip(axes_flat, PLAN_SPECS, candidates):
        if spec["show_interpolation"]:
            color_mappable = draw_interpolation(ax, odi_xy, odi_values, boundary_xy, cmap)
        else:
            draw_boundary_fill(ax, boundary_xy)

        draw_common_layers(ax, boundary_xy, omega_loops_xy, drill_xy)
        draw_workfaces(ax, candidate, origin_x, origin_y)

        ax.text(
            0.025,
            0.975,
            spec["panel"],
            transform=ax.transAxes,
            ha="left",
            va="top",
            fontsize=8.5,
            fontweight="bold",
            bbox={"boxstyle": "round,pad=0.16", "fc": "white", "ec": "none", "alpha": 0.82},
            zorder=12,
        )
        ax.set_xlim(*xlim)
        ax.set_ylim(*ylim)
        ax.set_aspect("equal", adjustable="box")
        ax.grid(color="#d8e2ec", lw=0.45, alpha=0.65, zorder=0)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=4))
        ax.yaxis.set_major_locator(MaxNLocator(nbins=4))
        formatter = ScalarFormatter(useOffset=False)
        formatter.set_scientific(False)
        ax.xaxis.set_major_formatter(formatter)
        ax.yaxis.set_major_formatter(formatter)
        add_scale_and_north(ax)

    axes[0, 0].set_ylabel("Y 相对坐标 / m")
    axes[1, 0].set_ylabel("Y 相对坐标 / m")
    axes[1, 0].set_xlabel("X 相对坐标 / m")
    axes[1, 1].set_xlabel("X 相对坐标 / m")

    if color_mappable is not None:
        cbar = fig.colorbar(color_mappable, ax=axes_flat, fraction=0.035, pad=0.025)
        cbar.ax.set_ylabel("含水层 ODI", rotation=90, labelpad=8, va="center")
        cbar.set_ticks([0, 0.4, 0.65, 0.85, 0.9, 1.0])
        cbar.ax.set_yticklabels(["0", "0.40", "0.65", "0.85", "0.90", "1.0"])

    legend_handles = [
        Line2D([0], [0], color="#005baa", lw=1.2, label="工作面边界"),
        Line2D([0], [0], color="#0067b1", lw=1.2, linestyle=(0, (4.0, 2.2)), label="有效布置域"),
        Line2D([0], [0], color="#9aa7b3", lw=0.8, label="采区边界"),
        Line2D(
            [0],
            [0],
            marker="o",
            color="none",
            markerfacecolor="black",
            markeredgecolor="white",
            markeredgewidth=0.3,
            markersize=4.2,
            label="钻孔位置",
        ),
    ]
    fig.legend(
        handles=legend_handles,
        loc="lower center",
        ncol=4,
        frameon=False,
        bbox_to_anchor=(0.48, 0.007),
        handlelength=2.4,
        columnspacing=1.4,
    )

    fig.suptitle(
        "图6 不同目标偏好下的采区规划方案对比\n"
        "Fig.6 Comparison of mining district planning schemes under different objective preferences",
        y=0.988,
        fontsize=9.2,
        fontweight="bold",
    )
    fig.subplots_adjust(left=0.07, right=0.88, bottom=0.08, top=0.90, wspace=0.08, hspace=0.13)

    base = OUT_DIR / "fig6_aquifer_scheme_comparison"
    fig.savefig(base.with_suffix(".png"), dpi=600, facecolor="white")
    fig.savefig(base.with_suffix(".svg"), facecolor="white")
    fig.savefig(base.with_suffix(".pdf"), facecolor="white")
    plt.close(fig)

    rows = collect_metric_rows(planning_project, candidates)
    write_stats_csv(rows)

    metadata = {
        "source_aquifer_project": str(aquifer_project_path),
        "source_planning_project": str(planning_project_path),
        "origin_xy": [origin_x, origin_y],
        "panel_specs": PLAN_SPECS,
        "interpolation_rule": "Panels A and B do not draw interpolation; panels C and D use aquifer odiResult.points triangulated interpolation.",
        "odi_point_count": len(odi_points),
        "drillhole_count": len(drill_points),
        "boundary_point_count": len(boundary_points),
    }
    (OUT_DIR / "fig6_aquifer_scheme_comparison_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(base)


if __name__ == "__main__":
    main()
