from __future__ import annotations

import csv
import json
import os
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D
from matplotlib.patches import Polygon


def read_csv_points(path: Path) -> list[dict[str, float | str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def load_stats(path: Path) -> dict[str, dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return {row["plan_code"]: row for row in csv.DictReader(f)}


def offset_loop(loop: list[dict[str, float]], min_x: float, min_y: float) -> np.ndarray:
    return np.array([[p["x"] - min_x, p["y"] - min_y] for p in loop], dtype=float)


def find_candidate(project: dict, mode: str, signature: str) -> dict:
    cands = project["planningResults"][mode]["result"]["candidates"]
    for cand in cands:
        if cand.get("signature") == signature or cand.get("key") == signature:
            return cand
    raise KeyError(f"Candidate not found: {mode} {signature}")


def setup_font() -> None:
    plt.rcParams["font.family"] = ["Times New Roman", "SimSun"]
    plt.rcParams["font.sans-serif"] = ["SimSun", "Times New Roman", "Microsoft YaHei", "SimHei"]
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["pdf.fonttype"] = 42
    plt.rcParams["ps.fonttype"] = 42
    plt.rcParams["svg.fonttype"] = "none"


def main() -> None:
    workspace = Path(os.environ.get("WORKSPACE", ".")).resolve()
    project_path = Path(os.environ["PROJECT_JSON"])
    field_path = Path(os.environ["ODI_FIELD_JSON"])
    boundary_path = Path(os.environ["BOUNDARY_CSV"])
    drill_path = Path(os.environ["DRILL_CSV"])
    stats_path = workspace / "docs" / "plans" / "coal_sci_abc_odi_unified_stats_20260418.csv"

    out_dir = workspace / "煤科投稿" / "最终图片" / "10_论文图件精修版"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_base = out_dir / "图5_ABC三方案布局对比图_精修"

    setup_font()

    project = json.loads(project_path.read_text(encoding="utf-8"))
    field = json.loads(field_path.read_text(encoding="utf-8"))
    stats = load_stats(stats_path)
    boundary_rows = read_csv_points(boundary_path)
    drill_rows = read_csv_points(drill_path)

    min_x = field["bounds"]["minX"]
    max_x = field["bounds"]["maxX"]
    min_y = field["bounds"]["minY"]
    max_y = field["bounds"]["maxY"]

    boundary = np.array([[float(r["x"]) - min_x, float(r["y"]) - min_y] for r in boundary_rows], dtype=float)
    drill_xy = np.array([[float(r["x"]) - min_x, float(r["y"]) - min_y] for r in drill_rows], dtype=float)

    plans = [
        {
            "code": "A",
            "title": "方案A：工程效率优先",
            "mode": "efficiency",
            "signature": "x|wb=50.0000|ws=30.0000|N=5|B=308.0000",
            "color": "#0072B2",
        },
        {
            "code": "B",
            "title": "方案B：资源回收优先",
            "mode": "recovery",
            "signature": "y|wb=50.0000|ws=30.0000|N=9|B=335.0000|theta=0.0",
            "color": "#E69F00",
        },
        {
            "code": "C",
            "title": "方案C：联合判据低扰动",
            "mode": "efficiency",
            "signature": "x|wb=50.0000|ws=30.0000|N=4|B=350.0000",
            "color": "#009E73",
        },
    ]

    z = np.asarray(field["field"], dtype=float)
    extent = [0, max_x - min_x, 0, max_y - min_y]
    xx = np.linspace(extent[0], extent[1], z.shape[1])
    yy = np.linspace(extent[2], extent[3], z.shape[0])

    fig, axes = plt.subplots(1, 3, figsize=(8.2, 3.10), sharex=True, sharey=True)
    for ax, plan in zip(axes, plans):
        cand = find_candidate(project, plan["mode"], plan["signature"])
        faces = cand["render"]["plannedWorkfaceLoopsWorld"]
        st = stats[plan["code"]]

        ax.contourf(xx, yy, z, levels=[0.70, 0.80, 1.01], colors=["#F4A582", "#D6604D"], alpha=0.28, antialiased=True)
        ax.contour(xx, yy, z, levels=[0.70], colors=["#B2182B"], linewidths=0.8)

        ax.plot(
            np.r_[boundary[:, 0], boundary[0, 0]],
            np.r_[boundary[:, 1], boundary[0, 1]],
            color="#202020",
            lw=1.1,
            label="研究区边界",
        )
        ax.scatter(drill_xy[:, 0], drill_xy[:, 1], s=5, color="#4D4D4D", alpha=0.55, linewidths=0, zorder=3)

        for face in faces:
            pts = offset_loop(face["loop"], min_x, min_y)
            poly = Polygon(pts, closed=True, facecolor=plan["color"], edgecolor=plan["color"], linewidth=1.0, alpha=0.38, zorder=4)
            ax.add_patch(poly)
            cx, cy = pts[:, 0].mean(), pts[:, 1].mean()
            ax.text(cx, cy, str(face["faceIndex"]), ha="center", va="center", fontsize=7.1, color="#111111", zorder=5)

        text = (
            f"N={st['face_count']}  覆盖率={float(st['coverage_pct']):.2f}%\n"
            f"ODI均值={float(st['odi_mean']):.4f}  P90={float(st['odi_p90']):.4f}\n"
            f"E0.70={float(st['odi_gt_070_pct']):.2f}%"
        )
        ax.text(
            0.02,
            0.98,
            text,
            transform=ax.transAxes,
            ha="left",
            va="top",
            fontsize=7.2,
            bbox=dict(boxstyle="round,pad=0.20", fc="white", ec="#BDBDBD", lw=0.45, alpha=0.90),
            zorder=6,
        )

        ax.set_title(f"({plan['code'].lower()}) {plan['title']}", fontsize=8.9, pad=3)
        ax.set_aspect("equal", adjustable="box")
        ax.grid(color="#E0E0E0", linewidth=0.45, alpha=0.7)
        ax.tick_params(labelsize=7.2, length=2.2)
        ax.set_xlim(-90, max_x - min_x + 90)
        ax.set_ylim(-80, max_y - min_y + 80)

    axes[0].set_ylabel("Y方向相对坐标 / m", fontsize=8.4)
    fig.supxlabel("X方向相对坐标 / m", fontsize=8.4, y=0.065)

    legend_items = [
        Line2D([0], [0], color="#202020", lw=1.1, label="研究区边界"),
        Line2D([0], [0], marker="o", color="none", markerfacecolor="#4D4D4D", markersize=4, label="钻孔"),
        Line2D([0], [0], color="#B2182B", lw=0.9, label="ODI=0.70轮廓"),
        Line2D([0], [0], color="#0072B2", lw=4, alpha=0.55, label="工作面"),
    ]
    fig.legend(handles=legend_items, loc="lower center", ncol=4, frameon=False, bbox_to_anchor=(0.5, -0.01), fontsize=7.8)

    fig.tight_layout(rect=[0.01, 0.12, 0.995, 1.0], w_pad=0.8)
    for ext in ["png", "pdf", "svg", "tif"]:
        kwargs = {"bbox_inches": "tight"}
        if ext in {"png", "tif"}:
            kwargs.update({"dpi": 600})
        fig.savefig(out_base.with_suffix(f".{ext}"), **kwargs)
    plt.close(fig)

    meta = {
        "source_project": str(project_path),
        "source_odi_field": str(field_path),
        "source_stats": str(stats_path),
        "source_boundary": str(boundary_path),
        "source_drillholes": str(drill_path),
        "output_base": str(out_base),
        "plan_signatures": {p["code"]: p["signature"] for p in plans},
        "figure_caption_cn": "图5 A/B/C候选方案工作面布局与ODI高值区叠置对比图",
        "figure_caption_en": "Fig.5 Comparison of A/B/C candidate layouts overlaid with high-ODI zones",
    }
    out_base.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(out_base)


if __name__ == "__main__":
    main()
