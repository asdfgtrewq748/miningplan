from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path

import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import requests


matplotlib.rcParams["font.sans-serif"] = [
    "SimHei",
    "Microsoft YaHei",
    "Noto Sans CJK SC",
    "Arial Unicode MS",
    "DejaVu Sans",
]
matplotlib.rcParams["axes.unicode_minus"] = False


BASE_URL = "http://127.0.0.1:3001/api"
SCRIPT_PATH = Path(__file__).resolve()
PROJECT_ROOT = SCRIPT_PATH.parents[2]
PAPER_ROOT = SCRIPT_PATH.parents[1]
VIS_ROOT = PAPER_ROOT / "01_可视化图汇总"
AUTO_DIR = VIS_ROOT / "系统生成图"
EXISTING_DIR = VIS_ROOT / "仓库已有图"
SUPPORT_DIR = PAPER_ROOT / "05_支撑材料"
RAW_DIR = SUPPORT_DIR / "接口结果"
INDEX_PATH = VIS_ROOT / "图件索引.md"


def ensure_dirs() -> None:
    for path in [VIS_ROOT, AUTO_DIR, EXISTING_DIR, RAW_DIR]:
        path.mkdir(parents=True, exist_ok=True)


def request_json(method: str, endpoint: str, **kwargs):
    resp = requests.request(method, BASE_URL + endpoint, timeout=60, **kwargs)
    resp.raise_for_status()
    return resp.json()


def find_example_files() -> tuple[Path, Path, Path]:
    examples = PROJECT_ROOT / "examples"
    mapping = {}
    for path in examples.iterdir():
        if path.is_file():
            header = path.read_text(encoding="utf-8").splitlines()[0].strip()
            mapping[header] = path
    boundary_file = mapping["x,y"]
    coords_file = mapping["id,x,y"]
    data_file = next(path for header, path in mapping.items() if header not in {"x,y", "id,x,y"})
    return boundary_file, coords_file, data_file


def load_boundary(boundary_file: Path) -> list[dict]:
    with boundary_file.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    boundary = [{"x": float(row["x"]), "y": float(row["y"])} for row in rows]
    if boundary[0] != boundary[-1]:
        boundary.append(boundary[0])
    return boundary


def load_boreholes(coords_file: Path, data_file: Path) -> list[dict]:
    with coords_file.open(encoding="utf-8") as f:
        coord_rows = list(csv.DictReader(f))
    coord_map = {
        row["id"]: {
            "x": float(row["x"]),
            "y": float(row["y"]),
        }
        for row in coord_rows
    }

    with data_file.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        cols = reader.fieldnames
        rows = []
        for row in reader:
            coords = coord_map[row[cols[0]]]
            rows.append(
                {
                    "id": row[cols[0]],
                    "x": coords["x"],
                    "y": coords["y"],
                    "rockHardness": float(row[cols[1]]),
                    "gasContent": float(row[cols[2]]),
                    "coalThickness": float(row[cols[3]]),
                    "groundWater": float(row[cols[4]]),
                }
            )
    return rows


def run_pipeline():
    request_json("GET", "/health")
    request_json("POST", "/project/clear")

    boundary_file, coords_file, data_file = find_example_files()
    boundary = load_boundary(boundary_file)
    boreholes = load_boreholes(coords_file, data_file)

    with boundary_file.open("rb") as f:
        request_json("POST", "/upload/boundary", files={"file": ("采区边界.csv", f, "text/csv")})
    request_json("POST", "/boreholes/", json={"boreholes": boreholes})

    geology = request_json("POST", "/geology/", params={"resolution": 80})
    design = request_json(
        "POST",
        "/design/",
        json={
            "faceWidth": 120,
            "pillarWidth": 20,
            "boundaryMargin": 30,
            "dipAngle": 8,
            "dipDirection": 90,
            "miningRules": {
                "faceLength": {"min": 120, "max": 260},
                "layoutDirection": "strike",
            },
        },
    )
    gnn_train = request_json("POST", "/gnn/train", json={"epochs": 100, "k_neighbors": 6})
    gnn_grid = request_json("POST", "/gnn/grid", params={"resolution": 80})

    raw_payloads = {
        "边界数据.json": {"boundary": boundary},
        "钻孔数据.json": {"boreholes": boreholes},
        "地质建模结果.json": geology,
        "采区设计结果.json": design,
        "GNN训练结果.json": gnn_train,
        "GNN网格结果.json": gnn_grid,
    }
    for filename, payload in raw_payloads.items():
        (RAW_DIR / filename).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    return boundary, boreholes, geology.get("model", {}), design, gnn_train, gnn_grid.get("model", {})


def _poly_xy(points: list[dict]) -> tuple[list[float], list[float]]:
    xs = [p["x"] for p in points]
    ys = [p["y"] for p in points]
    return xs, ys


def plot_boundary_and_boreholes(boundary: list[dict], boreholes: list[dict]) -> Path:
    fig, ax = plt.subplots(figsize=(10, 8))
    bx, by = _poly_xy(boundary)
    ax.fill(bx, by, facecolor="#d9edf7", edgecolor="#0b5d7a", linewidth=2.2, alpha=0.65, label="采区边界")
    xs = [b["x"] for b in boreholes]
    ys = [b["y"] for b in boreholes]
    ax.scatter(xs, ys, s=55, c="#d94841", edgecolors="white", linewidth=0.8, label="钻孔位置", zorder=3)
    for item in boreholes:
        ax.text(item["x"] + 6, item["y"] + 6, item["id"], fontsize=8, color="#333333")
    ax.set_title("图1 采区边界与钻孔分布图", fontsize=15, pad=12)
    ax.set_xlabel("X / m")
    ax.set_ylabel("Y / m")
    ax.legend(frameon=False)
    ax.set_aspect("equal", adjustable="box")
    ax.grid(alpha=0.18)
    out = AUTO_DIR / "图1_采区边界与钻孔分布图.png"
    fig.tight_layout()
    fig.savefig(out, dpi=240)
    plt.close(fig)
    return out


def plot_geology(boundary: list[dict], boreholes: list[dict], geology_model: dict) -> Path:
    data = np.array(geology_model["data"])
    fig, ax = plt.subplots(figsize=(10, 8))
    extent = [
        geology_model["minX"],
        geology_model["maxX"],
        geology_model["minY"],
        geology_model["maxY"],
    ]
    im = ax.imshow(
        data.T,
        origin="lower",
        extent=extent,
        cmap="YlOrRd",
        alpha=0.88,
        aspect="auto",
    )
    bx, by = _poly_xy(boundary)
    ax.plot(bx, by, color="black", linewidth=1.6, label="采区边界")
    ax.scatter([b["x"] for b in boreholes], [b["y"] for b in boreholes], s=22, c="white", edgecolors="black", linewidth=0.6)
    cbar = fig.colorbar(im, ax=ax, shrink=0.88)
    cbar.set_label("煤层厚度插值值")
    ax.set_title("图2 煤层厚度插值热力图", fontsize=15, pad=12)
    ax.set_xlabel("X / m")
    ax.set_ylabel("Y / m")
    ax.set_aspect("equal", adjustable="box")
    ax.legend(frameon=False, loc="upper right")
    out = AUTO_DIR / "图2_煤层厚度插值热力图.png"
    fig.tight_layout()
    fig.savefig(out, dpi=240)
    plt.close(fig)
    return out


def plot_design_layout(boundary: list[dict], boreholes: list[dict], design: dict) -> Path:
    fig, ax = plt.subplots(figsize=(12, 8.5))
    bx, by = _poly_xy(boundary)
    ax.fill(bx, by, facecolor="#f7f7f7", edgecolor="#202020", linewidth=1.8, alpha=0.8)

    colors = {
        "main": "#0b7285",
        "ventilation": "#c92a2a",
        "transport": "#2b8a3e",
        "return": "#6741d9",
        "cut": "#e67700",
        "gate": "#495057",
    }
    labels_seen = set()
    for roadway in design.get("roadways", []):
        path = roadway.get("path", [])
        if len(path) < 2:
            continue
        xs = [p["x"] for p in path]
        ys = [p["y"] for p in path]
        rtype = roadway.get("type", "gate")
        label = f"巷道-{rtype}" if rtype not in labels_seen else None
        ax.plot(xs, ys, color=colors.get(rtype, "#495057"), linewidth=2.2, alpha=0.9, label=label)
        labels_seen.add(rtype)

    for idx, panel in enumerate(design.get("panels", []), start=1):
        pts = panel.get("points", [])
        if not pts:
            continue
        px = [p["x"] for p in pts] + [pts[0]["x"]]
        py = [p["y"] for p in pts] + [pts[0]["y"]]
        ax.fill(px, py, facecolor="#74c0fc", edgecolor="#1c7ed6", linewidth=1.6, alpha=0.45, label="工作面" if idx == 1 else None)
        cx = np.mean([p["x"] for p in pts])
        cy = np.mean([p["y"] for p in pts])
        ax.text(cx, cy, panel.get("id", f"工作面{idx}"), ha="center", va="center", fontsize=10, color="#0b3d91")

    ax.scatter([b["x"] for b in boreholes], [b["y"] for b in boreholes], s=20, c="#111111", alpha=0.7, label="钻孔")
    ax.set_title("图3 采区工作面与巷道布局图", fontsize=15, pad=12)
    ax.set_xlabel("X / m")
    ax.set_ylabel("Y / m")
    ax.set_aspect("equal", adjustable="box")
    ax.grid(alpha=0.16)
    ax.legend(frameon=False, loc="upper right", ncol=2)
    out = AUTO_DIR / "图3_采区工作面与巷道布局图.png"
    fig.tight_layout()
    fig.savefig(out, dpi=240)
    plt.close(fig)
    return out


def plot_gnn_field(boundary: list[dict], boreholes: list[dict], gnn_grid: dict, gnn_train: dict) -> Path:
    data = np.array(gnn_grid["thickness"])
    bounds = gnn_grid["bounds"]
    fig, ax = plt.subplots(figsize=(10, 8))
    im = ax.imshow(
        data,
        origin="lower",
        extent=[bounds["x_min"], bounds["x_max"], bounds["y_min"], bounds["y_max"]],
        cmap="viridis",
        alpha=0.9,
        aspect="auto",
    )
    bx, by = _poly_xy(boundary)
    ax.plot(bx, by, color="white", linewidth=1.8)
    ax.scatter([b["x"] for b in boreholes], [b["y"] for b in boreholes], s=18, c="#ffd43b", edgecolors="black", linewidth=0.4)
    metrics = gnn_train.get("metrics", {})
    note = f"厚度 MAE={metrics.get('thickness_mae', '-')}, RMSE={metrics.get('thickness_rmse', '-')}, R2={metrics.get('thickness_r2', '-')}"
    ax.text(
        0.02,
        0.02,
        note,
        transform=ax.transAxes,
        fontsize=9,
        color="white",
        bbox={"facecolor": "black", "alpha": 0.42, "pad": 6},
    )
    fig.colorbar(im, ax=ax, shrink=0.88).set_label("GNN 厚度预测值")
    ax.set_title("图4 GNN 煤层厚度预测网格图", fontsize=15, pad=12)
    ax.set_xlabel("X / m")
    ax.set_ylabel("Y / m")
    ax.set_aspect("equal", adjustable="box")
    out = AUTO_DIR / "图4_GNN煤层厚度预测网格图.png"
    fig.tight_layout()
    fig.savefig(out, dpi=240)
    plt.close(fig)
    return out


def copy_existing_images() -> list[Path]:
    sources = [
        (PROJECT_ROOT / "backend_python" / "gnn_modeling" / "test_plot.png", "仓库图_01_GNN测试图一.png"),
        (PROJECT_ROOT / "backend_python" / "gnn_modeling" / "test_plot_v2.png", "仓库图_02_GNN测试图二.png"),
        (PROJECT_ROOT / "image.png", "仓库图_03_系统原始界面图.png"),
        (PROJECT_ROOT / "image copy.png", "仓库图_04_系统界面图副本.png"),
    ]
    copied = []
    for src, name in sources:
        if src.exists():
            dst = EXISTING_DIR / name
            shutil.copy2(src, dst)
            copied.append(dst)
    return copied


def write_index(generated: list[Path], copied: list[Path], design: dict, gnn_train: dict) -> None:
    lines = [
        "# 图件索引",
        "",
        "## 一、系统生成图",
        "",
        f"- `{generated[0].name}`：基于示例数据绘制的采区边界与钻孔空间分布图，用于说明系统具备基础空间数据载入与展示能力。",
        f"- `{generated[1].name}`：调用地质建模接口后生成的煤层厚度插值热力图，用于说明系统可完成从钻孔数据到空间场的建模。",
        f"- `{generated[2].name}`：调用采区设计接口后绘制的工作面与巷道布局图，用于说明系统具备自动化布局设计能力。",
        f"- `{generated[3].name}`：调用 GNN 建模接口后生成的厚度预测网格图，用于说明系统具备基于图建模的空间预测能力。",
        "",
        "## 二、仓库已有图件",
        "",
    ]
    if copied:
        lines.extend([f"- `{path.name}`：从仓库原始文件复制保留，作为已有项目图件或测试图件的归档。" for path in copied])
    else:
        lines.append("- 当前未发现可直接复用的仓库原始 PNG 图件。")

    lines.extend(
        [
            "",
            "## 三、运行摘要",
            "",
            f"- 样例运行得到工作面数量：`{len(design.get('panels', []))}`。",
            f"- 样例运行得到巷道数量：`{len(design.get('roadways', []))}`。",
            f"- GNN 训练厚度指标：`MAE={gnn_train.get('metrics', {}).get('thickness_mae')}`，`RMSE={gnn_train.get('metrics', {}).get('thickness_rmse')}`，`R²={gnn_train.get('metrics', {}).get('thickness_r2')}`。",
            "",
            "## 四、原始结果保存位置",
            "",
            "- 接口结果 JSON 已保存到 `05_支撑材料/接口结果`。",
            "- 本索引仅说明图件用途，后续可在论文中据此选图与改图。",
        ]
    )
    INDEX_PATH.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    ensure_dirs()
    boundary, boreholes, geology_model, design, gnn_train, gnn_grid = run_pipeline()
    generated = [
        plot_boundary_and_boreholes(boundary, boreholes),
        plot_geology(boundary, boreholes, geology_model),
        plot_design_layout(boundary, boreholes, design),
        plot_gnn_field(boundary, boreholes, gnn_grid, gnn_train),
    ]
    copied = copy_existing_images()
    write_index(generated, copied, design, gnn_train)
    print("图件生成完成：")
    for path in generated + copied:
        print(path)


if __name__ == "__main__":
    main()
