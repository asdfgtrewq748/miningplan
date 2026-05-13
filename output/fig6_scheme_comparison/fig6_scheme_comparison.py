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
from matplotlib.patches import PathPatch
from matplotlib.path import Path as MplPath
from matplotlib.ticker import MaxNLocator


WORKSPACE = Path(__file__).resolve().parents[2]
OUT_DIR = Path(__file__).resolve().parent

ABC_STATS_CSV = WORKSPACE / "docs" / "plans" / "coal_sci_abc_odi_unified_stats_20260418.csv"
WEIGHTED_TABLE_CSV = (
    WORKSPACE
    / "output"
    / "scene_visual_exports"
    / "20260416_201037"
    / "03_mining_planning"
    / "overview"
    / "planning_weighted_table.csv"
)

PLAN_SPECS = [
    {
        "code": "A",
        "panel": "（a）工程效率优先方案",
        "mode": "efficiency",
        "signature": "x|wb=50.0000|ws=30.0000|N=5|B=308.0000",
        "stats_source": "abc",
    },
    {
        "code": "B",
        "panel": "（b）资源回收优先方案",
        "mode": "recovery",
        "signature": "y|wb=50.0000|ws=30.0000|N=9|B=335.0000|theta=0.0",
        "stats_source": "abc",
    },
    {
        "code": "C",
        "panel": "（c）低扰动优先方案",
        "mode": "efficiency",
        "signature": "x|wb=50.0000|ws=30.0000|N=4|B=350.0000",
        "stats_source": "abc",
    },
    {
        "code": "D",
        "panel": "（d）综合权重调节方案",
        "mode": "weighted_dist",
        "signature": "y|wb=80.0000|ws=30-30|N=5|B=350-350|h=1db0251b",
        "stats_source": "weighted",
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
            "font.family": ["SimSun", "Times New Roman", "DejaVu Sans"],
            "axes.unicode_minus": False,
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
            "svg.fonttype": "none",
            "figure.dpi": 180,
            "savefig.dpi": 600,
            "axes.labelsize": 8.5,
            "xtick.labelsize": 7.5,
            "ytick.labelsize": 7.5,
            "legend.fontsize": 8.0,
        }
    )


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def locate_project_json() -> Path:
    demo_dir = WORKSPACE / "mining-plan" / "frontend" / "public" / "demo"
    matches = [p for p in demo_dir.glob("*.miningplan.json") if p.name.startswith("3-")]
    if not matches:
        raise FileNotFoundError("Cannot locate the mining planning project JSON.")
    return matches[0]


def locate_odi_field() -> Path:
    matches = list(WORKSPACE.rglob("000_mindong_layout_odi_field.json"))
    if not matches:
        raise FileNotFoundError("Cannot locate 000_mindong_layout_odi_field.json.")
    preferred = [p for p in matches if "tmp" not in {part.lower() for part in p.parts}]
    return sorted(preferred or matches, key=lambda p: (len(p.parts), str(p)))[0]


def locate_named_csv(name: str) -> Path:
    matches = list((WORKSPACE / "data").glob(name))
    if matches:
        return matches[0]
    matches = list(WORKSPACE.rglob(name))
    if not matches:
        raise FileNotFoundError(f"Cannot locate {name}.")
    return sorted(matches, key=lambda p: (len(p.parts), str(p)))[0]


def load_project() -> tuple[Path, dict[str, Any]]:
    project_path = locate_project_json()
    return project_path, json.loads(project_path.read_text(encoding="utf-8"))


def candidate_loops(candidate: dict[str, Any]) -> list[dict[str, Any]]:
    render = candidate.get("render") or {}
    return (
        render.get("plannedWorkfaceLoopsWorld")
        or render.get("facesLoops")
        or candidate.get("facesLoops")
        or []
    )


def candidate_omega_loops(candidate: dict[str, Any]) -> list[list[dict[str, float]]]:
    render = candidate.get("render") or {}
    loops = render.get("omegaLoops") or []
    normalized: list[list[dict[str, float]]] = []
    for loop in loops:
        if isinstance(loop, dict):
            loop = loop.get("loop") or loop.get("points") or []
        if loop:
            normalized.append(loop)
    return normalized


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


def loop_to_xy(loop: Any, origin_x: float, origin_y: float) -> np.ndarray:
    if isinstance(loop, dict):
        loop = loop.get("loop") or loop.get("points") or []
    pts = []
    for point in loop or []:
        pts.append([float(point["x"]) - origin_x, float(point["y"]) - origin_y])
    return np.asarray(pts, dtype=float)


def csv_points_to_xy(rows: list[dict[str, str]], origin_x: float, origin_y: float) -> np.ndarray:
    pts = []
    for row in rows:
        x = row.get("x") or row.get("X") or row.get("坐标x")
        y = row.get("y") or row.get("Y") or row.get("坐标y")
        if x is None or y is None:
            continue
        pts.append([float(x) - origin_x, float(y) - origin_y])
    return np.asarray(pts, dtype=float)


def make_clip_patch(boundary_xy: np.ndarray) -> PathPatch:
    vertices = np.vstack([boundary_xy, boundary_xy[0]])
    codes = [MplPath.MOVETO] + [MplPath.LINETO] * (len(boundary_xy) - 1) + [MplPath.CLOSEPOLY]
    return PathPatch(MplPath(vertices, codes), facecolor="none", edgecolor="none")


def odi_colormap() -> LinearSegmentedColormap:
    stops = [
        (0.00, "#dff3ff"),
        (0.40, "#c8c7ff"),
        (0.65, "#f3b3d1"),
        (0.85, "#ef7f8a"),
        (0.90, "#d94c59"),
        (1.00, "#8f1d2c"),
    ]
    return LinearSegmentedColormap.from_list("odi_blue_pink_red", stops, N=256)


def field_extent(field_pack: dict[str, Any], origin_x: float, origin_y: float) -> list[float]:
    bounds = field_pack["bounds"]
    pad = float(bounds.get("pad", 0.0))
    width = float(field_pack["width"])
    height = float(field_pack["height"])
    min_x = float(bounds["minX"])
    max_x = float(bounds["maxX"])
    min_y = float(bounds["minY"])
    max_y = float(bounds["maxY"])
    usable_w = width - 2.0 * pad
    usable_h = height - 2.0 * pad
    x_pad = (max_x - min_x) * pad / usable_w if usable_w else 0.0
    y_pad = (max_y - min_y) * pad / usable_h if usable_h else 0.0
    return [
        min_x - x_pad - origin_x,
        max_x + x_pad - origin_x,
        min_y - y_pad - origin_y,
        max_y + y_pad - origin_y,
    ]


def add_scale_and_north(ax: plt.Axes) -> None:
    x0, x1 = ax.get_xlim()
    y0, y1 = ax.get_ylim()
    width = x1 - x0
    height = y1 - y0
    sx = x0 + 0.08 * width
    sy = y0 + 0.045 * height
    length = 500.0
    ax.plot([sx, sx + length], [sy, sy], color="black", lw=1.2, solid_capstyle="butt", zorder=7)
    ax.plot([sx, sx], [sy - 14, sy + 14], color="black", lw=0.8, zorder=7)
    ax.plot([sx + length, sx + length], [sy - 14, sy + 14], color="black", lw=0.8, zorder=7)
    ax.text(sx + length / 2, sy + 22, "500 m", ha="center", va="bottom", fontsize=7.0, zorder=7)

    nx = x1 - 0.08 * width
    ny = y1 - 0.18 * height
    ax.annotate(
        "N",
        xy=(nx, ny + 130),
        xytext=(nx, ny - 40),
        ha="center",
        va="bottom",
        fontsize=8.0,
        arrowprops={"arrowstyle": "-|>", "lw": 1.0, "color": "black"},
        zorder=7,
    )


def load_plan_stats() -> dict[str, dict[str, Any]]:
    stats: dict[str, dict[str, Any]] = {}
    abc_rows = {row["plan_code"]: row for row in read_csv_rows(ABC_STATS_CSV)}
    for code in ["A", "B", "C"]:
        row = abc_rows[code]
        stats[code] = {
            "plan_code": code,
            "coverage_pct": float(row["coverage_pct"]),
            "odi_mean": float(row["odi_mean"]),
            "odi_p90": float(row["odi_p90"]),
            "odi_gt_070_pct": float(row["odi_gt_070_pct"]),
            "risk_score": float(row["risk_score"]),
            "qualified": row["qualified"],
            "source_signature": row["signature"],
        }

    weighted_rows = read_csv_rows(WEIGHTED_TABLE_CSV)
    d_signature = PLAN_SPECS[3]["signature"]
    d_row = next(row for row in weighted_rows if row["signature"] == d_signature)
    stats["D"] = {
        "plan_code": "D",
        "coverage_pct": float(d_row["coveragePct"]),
        "odi_mean": float(d_row["distMean"]),
        "odi_p90": float(d_row["distP90"]),
        "odi_gt_070_pct": float(d_row["distExceedPct"]),
        "risk_score": float(d_row["totalScore"]),
        "qualified": d_row["qualified"],
        "source_signature": d_row["signature"],
    }
    return stats


def write_stats_csv(stats: dict[str, dict[str, Any]]) -> None:
    out_path = OUT_DIR / "fig6_scheme_comparison_stats.csv"
    with out_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "plan_code",
                "scheme_name",
                "coverage_pct",
                "odi_mean",
                "odi_p90",
                "odi_gt_070_pct",
                "risk_score",
                "qualified",
                "source_signature",
            ],
        )
        writer.writeheader()
        for spec in PLAN_SPECS:
            code = spec["code"]
            writer.writerow(
                {
                    **stats[code],
                    "scheme_name": spec["panel"],
                }
            )


def main() -> None:
    setup_fonts()

    project_path, project = load_project()
    odi_field_path = locate_odi_field()
    field_pack = json.loads(odi_field_path.read_text(encoding="utf-8"))
    boundary_path = locate_named_csv("采区边界_敏东.csv")
    drill_path = locate_named_csv("钻孔坐标_敏东.csv")
    boundary_rows = read_csv_rows(boundary_path)
    drill_rows = read_csv_rows(drill_path)
    stats = load_plan_stats()

    all_x = [float(field_pack["bounds"]["minX"]), float(field_pack["bounds"]["maxX"])]
    all_y = [float(field_pack["bounds"]["minY"]), float(field_pack["bounds"]["maxY"])]
    for row in boundary_rows + drill_rows:
        x = row.get("x") or row.get("X") or row.get("坐标x")
        y = row.get("y") or row.get("Y") or row.get("坐标y")
        if x and y:
            all_x.append(float(x))
            all_y.append(float(y))
    candidates = [find_candidate(project, spec["mode"], spec["signature"]) for spec in PLAN_SPECS]
    for candidate in candidates:
        for face in candidate_loops(candidate):
            for point in face.get("loop", face if isinstance(face, list) else []):
                all_x.append(float(point["x"]))
                all_y.append(float(point["y"]))

    origin_x = min(all_x)
    origin_y = min(all_y)
    boundary_xy = csv_points_to_xy(boundary_rows, origin_x, origin_y)
    drill_xy = csv_points_to_xy(drill_rows, origin_x, origin_y)

    common_omega = candidate_omega_loops(candidates[0])
    common_omega_xy = [loop_to_xy(loop, origin_x, origin_y) for loop in common_omega]

    field = np.asarray(field_pack["field"], dtype=float)
    field = np.flipud(field)
    extent = field_extent(field_pack, origin_x, origin_y)
    cmap = odi_colormap()

    xlim = (min(boundary_xy[:, 0].min(), extent[0]) - 45, max(boundary_xy[:, 0].max(), extent[1]) + 45)
    ylim = (min(boundary_xy[:, 1].min(), extent[2]) - 45, max(boundary_xy[:, 1].max(), extent[3]) + 45)

    fig, axes = plt.subplots(2, 2, figsize=(7.1, 6.15), sharex=True, sharey=True)
    axes_flat = axes.ravel()
    image = None

    for ax, spec, candidate in zip(axes_flat, PLAN_SPECS, candidates):
        image = ax.imshow(
            field,
            extent=extent,
            origin="lower",
            cmap=cmap,
            vmin=0,
            vmax=1,
            interpolation="bilinear",
            alpha=0.92,
            zorder=1,
        )
        clip = make_clip_patch(boundary_xy)
        ax.add_patch(clip)
        image.set_clip_path(clip)

        for omega_xy in common_omega_xy:
            ax.plot(
                np.r_[omega_xy[:, 0], omega_xy[0, 0]],
                np.r_[omega_xy[:, 1], omega_xy[0, 1]],
                color="#0067b1",
                linestyle=(0, (4, 2.2)),
                lw=1.15,
                zorder=4,
            )

        for face in candidate_loops(candidate):
            pts = loop_to_xy(face.get("loop", face), origin_x, origin_y)
            if len(pts) < 3:
                continue
            ax.fill(pts[:, 0], pts[:, 1], facecolor="#d7ecff", alpha=0.28, edgecolor="none", zorder=5)
            ax.plot(
                np.r_[pts[:, 0], pts[0, 0]],
                np.r_[pts[:, 1], pts[0, 1]],
                color="#005baa",
                lw=1.05,
                zorder=6,
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
        ax.text(
            0.025,
            0.975,
            spec["panel"],
            transform=ax.transAxes,
            ha="left",
            va="top",
            fontsize=9.0,
            fontweight="bold",
            bbox={"boxstyle": "round,pad=0.18", "fc": "white", "ec": "none", "alpha": 0.82},
            zorder=10,
        )
        ax.set_xlim(*xlim)
        ax.set_ylim(*ylim)
        ax.set_aspect("equal", adjustable="box")
        ax.grid(color="#ffffff", lw=0.45, alpha=0.55)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=4))
        ax.yaxis.set_major_locator(MaxNLocator(nbins=4))
        add_scale_and_north(ax)

    axes[0, 0].set_ylabel("Y 相对坐标 / m")
    axes[1, 0].set_ylabel("Y 相对坐标 / m")
    axes[1, 0].set_xlabel("X 相对坐标 / m")
    axes[1, 1].set_xlabel("X 相对坐标 / m")

    cbar = fig.colorbar(image, ax=axes_flat, fraction=0.035, pad=0.025)
    cbar.ax.set_ylabel("ODI", rotation=90, labelpad=9, va="center")
    cbar.set_ticks([0, 0.4, 0.65, 0.85, 0.9, 1.0])
    cbar.ax.set_yticklabels(["0", "0.40", "0.65", "0.85", "0.90", "1.0"])

    legend_handles = [
        Line2D([0], [0], color="#005baa", lw=1.2, label="工作面"),
        Line2D([0], [0], color="#0067b1", lw=1.2, linestyle=(0, (4, 2.2)), label="有效布置域"),
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
        ncol=3,
        frameon=False,
        bbox_to_anchor=(0.48, 0.006),
        handlelength=2.5,
    )

    fig.suptitle(
        "图6 不同目标偏好下的采区规划方案对比\n"
        "Fig.6 Comparison of mining district planning schemes under different objective preferences",
        y=0.988,
        fontsize=10.2,
        fontweight="bold",
    )
    fig.subplots_adjust(left=0.07, right=0.88, bottom=0.075, top=0.91, wspace=0.08, hspace=0.14)

    base = OUT_DIR / "fig6_scheme_comparison"
    fig.savefig(base.with_suffix(".png"), dpi=600, facecolor="white")
    fig.savefig(base.with_suffix(".svg"), facecolor="white")
    fig.savefig(base.with_suffix(".pdf"), facecolor="white")
    plt.close(fig)
    write_stats_csv(stats)

    metadata = {
        "source_project": project_path.as_posix(),
        "source_odi_field": odi_field_path.as_posix(),
        "source_boundary": boundary_path.as_posix(),
        "source_drillholes": drill_path.as_posix(),
        "source_abc_stats": ABC_STATS_CSV.as_posix(),
        "source_weighted_stats": WEIGHTED_TABLE_CSV.as_posix(),
        "origin_xy": [origin_x, origin_y],
        "plan_signatures": {spec["code"]: spec["signature"] for spec in PLAN_SPECS},
        "note": "Panel D uses the system weighted top output; source table marks qualified=false.",
    }
    (OUT_DIR / "fig6_scheme_comparison_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(base)


if __name__ == "__main__":
    main()
