from __future__ import annotations

import csv
import json
import math
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.lines import Line2D
from matplotlib.patches import Patch, Polygon as MplPolygon
from matplotlib.path import Path as MplPath
from mpl_toolkits.axes_grid1.inset_locator import inset_axes


plt.rcParams["font.sans-serif"] = [
    "Microsoft YaHei",
    "SimHei",
    "Noto Sans CJK SC",
    "DejaVu Sans",
]
plt.rcParams["axes.unicode_minus"] = False


SCRIPT_PATH = Path(__file__).resolve()
PROJECT_ROOT = SCRIPT_PATH.parents[3]
PAPER_ROOT = SCRIPT_PATH.parents[1]
APP_ROOT = PROJECT_ROOT / "mining-plan"
INPUT_ROOT = APP_ROOT / "input"
SUPPORT_ROOT = PAPER_ROOT / "05_支撑材料"
RESULT_ROOT = SUPPORT_ROOT / "接口结果"
FIGURE_ROOT = PAPER_ROOT / "01_可视化图汇总" / "主文图"

BOUNDARY_PATH = INPUT_ROOT / "敏东采区坐标.csv"
BOREHOLE_COORD_PATH = INPUT_ROOT / "敏东钻孔对应坐标.csv"
BOREHOLE_LAYER_DIR = INPUT_ROOT / "各个钻孔-补充"
DESIGN_RESULT_PATH = RESULT_ROOT / "采区设计结果.json"
ODI_PACK_PATH = RESULT_ROOT / "000_mindong_layout_odi_field.json"

FIGURE_STEM = "候选图_采区综合空间信息与规划结果可视化界面"
OUTPUT_PNG = FIGURE_ROOT / f"{FIGURE_STEM}.png"
OUTPUT_SVG = FIGURE_ROOT / f"{FIGURE_STEM}.svg"
OUTPUT_META = FIGURE_ROOT / f"{FIGURE_STEM}.json"
ASCII_PREVIEW_DIR = PROJECT_ROOT / "tmp"
ASCII_PREVIEW_PNG = ASCII_PREVIEW_DIR / "paper_figure_candidate_latest.png"
ASCII_PREVIEW_SVG = ASCII_PREVIEW_DIR / "paper_figure_candidate_latest.svg"

TARGET_SEAM = "16-3煤"
ODI_SCENARIO = "surface"
SCENARIO_WEIGHTS = {"wd": 0.45, "wo": 0.30, "wf": 0.25}
SMOOTH_PASSES = 2
GRID_W = 320
GRID_H = 240


@dataclass
class LayerRecord:
    seq: int | None
    name: str
    thickness: float | None
    elastic_modulus: float | None


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    encodings = ("utf-8-sig", "gb18030", "gbk", "utf-8")
    last_error: Exception | None = None
    for encoding in encodings:
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                return list(csv.DictReader(handle))
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"无法读取 CSV 文件: {path}") from last_error


def parse_float(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return number


def normalize_layer_name(name: object) -> str:
    text = str(name or "").strip()
    for old, new in {
        " ": "",
        "　": "",
        "－": "-",
        "—": "-",
        "–": "-",
        "_": "-",
    }.items():
        text = text.replace(old, new)
    return text


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def load_boundary() -> np.ndarray:
    rows = read_csv_rows(BOUNDARY_PATH)
    points: list[tuple[float, float]] = []
    for row in rows:
        x = parse_float(row.get("x"))
        y = parse_float(row.get("y"))
        if x is None or y is None:
            continue
        points.append((x, y))
    if len(points) < 3:
        raise RuntimeError("采区边界点数量不足，无法生成论文图。")
    return np.asarray(points, dtype=float)


def load_borehole_coordinates() -> dict[str, tuple[float, float]]:
    rows = read_csv_rows(BOREHOLE_COORD_PATH)
    coords: dict[str, tuple[float, float]] = {}
    for row in rows:
        name = str(row.get("钻孔名") or "").strip()
        x = parse_float(row.get("坐标x"))
        y = parse_float(row.get("坐标y"))
        if not name or x is None or y is None:
            continue
        coords[name] = (x, y)
    if not coords:
        raise RuntimeError("未读取到有效钻孔坐标。")
    return coords


def infer_elastic_modulus(name: str) -> float:
    if "砂岩" in name:
        return 25.0
    if "泥岩" in name:
        return 12.0
    if "粉砂岩" in name:
        return 20.0
    if "页岩" in name:
        return 15.0
    if "灰岩" in name:
        return 40.0
    if "煤" in name:
        return 6.0
    return 18.0


def load_borehole_layers() -> dict[str, list[LayerRecord]]:
    layers_by_id: dict[str, list[LayerRecord]] = {}
    for file_path in sorted(BOREHOLE_LAYER_DIR.glob("*.csv")):
        rows = read_csv_rows(file_path)
        layers: list[LayerRecord] = []
        for row in rows:
            name = str(row.get("名称") or "").strip()
            if not name:
                continue
            seq_value = parse_float(row.get("序号"))
            layers.append(
                LayerRecord(
                    seq=int(seq_value) if seq_value is not None else None,
                    name=name,
                    thickness=parse_float(row.get("厚度/m") or row.get("厚度") or row.get("厚度m")),
                    elastic_modulus=parse_float(row.get("弹性模量/Gpa") or row.get("弹性模量") or row.get("弹性模量/GPa")),
                )
            )
        layers_by_id[file_path.stem] = layers
    if not layers_by_id:
        raise RuntimeError("未读取到钻孔分层数据。")
    return layers_by_id


def pick_surface_target_idx(layers: list[LayerRecord]) -> int | None:
    for idx, layer in enumerate(layers):
        name = str(layer.name).strip()
        if name and "土" not in name:
            return idx
    return None


def pick_target_indices(layers: list[LayerRecord], scenario: str) -> list[int]:
    if scenario != "surface":
        raise RuntimeError(f"当前脚本仅实现 surface 口径，收到: {scenario}")
    idx = pick_surface_target_idx(layers)
    return [idx] if idx is not None else []


def pick_selected_coal_idx(layers: list[LayerRecord], seam_name: str) -> int | None:
    target = normalize_layer_name(seam_name)
    for idx, layer in enumerate(layers):
        if normalize_layer_name(layer.name) == target:
            return idx
    return None


def build_borehole_param_samples(
    coords_by_id: dict[str, tuple[float, float]],
    layers_by_id: dict[str, list[LayerRecord]],
    selected_coal: str,
    scenario: str,
) -> dict[str, list[dict[str, float | str]]]:
    ti: list[dict[str, float | str]] = []
    ei: list[dict[str, float | str]] = []
    hi: list[dict[str, float | str]] = []
    di: list[dict[str, float | str]] = []
    mi: list[dict[str, float | str]] = []
    coal_thk: list[dict[str, float | str]] = []

    for bh_id, layers in layers_by_id.items():
        coord = coords_by_id.get(bh_id)
        if coord is None:
            continue
        target_idxs = pick_target_indices(layers, scenario)
        has_target = len(target_idxs) > 0

        if has_target:
            ti_agg = None
            di_agg = None
            ei_agg = None
            for target_idx in target_idxs:
                if target_idx is None or target_idx < 0 or target_idx >= len(layers):
                    continue
                target_layer = layers[target_idx]
                target_thickness = parse_float(target_layer.thickness)
                if target_thickness is None:
                    continue
                elastic = (
                    target_layer.elastic_modulus
                    if parse_float(target_layer.elastic_modulus) is not None
                    else infer_elastic_modulus(target_layer.name)
                )
                depth_top = 0.0
                for prev_layer in layers[:target_idx]:
                    value = parse_float(prev_layer.thickness)
                    if value is not None:
                        depth_top += value
                ti_agg = target_thickness if ti_agg is None else max(ti_agg, target_thickness)
                di_agg = depth_top if di_agg is None else min(di_agg, depth_top)
                ei_agg = elastic if ei_agg is None else min(ei_agg, elastic)

            if ti_agg is not None:
                ti.append({"id": bh_id, "x": coord[0], "y": coord[1], "value": ti_agg})
            if di_agg is not None:
                di.append({"id": bh_id, "x": coord[0], "y": coord[1], "value": di_agg})
            if ei_agg is not None:
                ei.append({"id": bh_id, "x": coord[0], "y": coord[1], "value": ei_agg})

        coal_idx = pick_selected_coal_idx(layers, selected_coal)
        if coal_idx is None:
            continue
        coal_value = parse_float(layers[coal_idx].thickness)
        if coal_value is None:
            continue
        coal_thk.append({"id": bh_id, "x": coord[0], "y": coord[1], "value": coal_value})
        mi.append({"id": bh_id, "x": coord[0], "y": coord[1], "value": coal_value})

        if has_target:
            best_hi = None
            for target_idx in target_idxs:
                if target_idx is None or coal_idx == target_idx:
                    continue
                a = min(coal_idx, target_idx)
                b = max(coal_idx, target_idx)
                gap = 0.0
                for layer in layers[a + 1 : b]:
                    value = parse_float(layer.thickness)
                    if value is not None:
                        gap += value
                best_hi = gap if best_hi is None else min(best_hi, gap)
            if best_hi is not None:
                hi.append({"id": bh_id, "x": coord[0], "y": coord[1], "value": best_hi})

    return {
        "Ti": ti,
        "Ei": ei,
        "Hi": hi,
        "Di": di,
        "Mi": mi,
        "CoalThk": coal_thk,
    }


def compute_field(samples: list[dict[str, float | str]], width: float = 320.0, height: float = 220.0) -> dict[str, object]:
    valid = [
        sample
        for sample in samples
        if parse_float(sample.get("x")) is not None
        and parse_float(sample.get("y")) is not None
        and parse_float(sample.get("value")) is not None
    ]
    if len(valid) < 3:
        return {"field": None, "min": None, "max": None, "gridW": 0, "gridH": 0, "width": width, "height": height, "points": [], "bounds": None}

    xs = [float(sample["x"]) for sample in valid]
    ys = [float(sample["y"]) for sample in valid]
    vs = [float(sample["value"]) for sample in valid]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_v, max_v = min(vs), max(vs)
    pad = 14.0
    grid_w = 60
    grid_h = 42

    if abs(max_v - min_v) <= 1e-12:
        field = [[min_v for _ in range(grid_w)] for _ in range(grid_h)]
        return {
            "field": field,
            "min": min_v,
            "max": max_v,
            "gridW": grid_w,
            "gridH": grid_h,
            "width": width,
            "height": height,
            "points": [],
            "bounds": {"minX": min_x, "maxX": max_x, "minY": min_y, "maxY": max_y, "pad": pad},
        }

    def sx(world_x: float) -> float:
        return pad + ((world_x - min_x) / ((max_x - min_x) or 1.0)) * (width - pad * 2.0)

    def sy(world_y: float) -> float:
        return pad + (1.0 - (world_y - min_y) / ((max_y - min_y) or 1.0)) * (height - pad * 2.0)

    pts = [{"x": sx(float(sample["x"])), "y": sy(float(sample["y"])), "v": float(sample["value"])} for sample in valid]
    field = [[0.0 for _ in range(grid_w)] for _ in range(grid_h)]
    power = 2.0
    eps = 1e-6

    for gy in range(grid_h):
        for gx in range(grid_w):
            x = (gx / (grid_w - 1)) * width
            y = (gy / (grid_h - 1)) * height
            numerator = 0.0
            denominator = 0.0
            snapped = None
            for pt in pts:
                dx = x - pt["x"]
                dy = y - pt["y"]
                d2 = dx * dx + dy * dy
                if d2 < eps:
                    snapped = pt["v"]
                    break
                weight = 1.0 / math.pow(d2, power / 2.0)
                numerator += weight * pt["v"]
                denominator += weight
            field[gy][gx] = snapped if snapped is not None else numerator / (denominator or 1.0)

    return {
        "field": field,
        "min": min_v,
        "max": max_v,
        "gridW": grid_w,
        "gridH": grid_h,
        "width": width,
        "height": height,
        "points": pts,
        "bounds": {"minX": min_x, "maxX": max_x, "minY": min_y, "maxY": max_y, "pad": pad},
    }


def sample_field_pack_at_world_xy(pack: dict[str, object], world_x: float, world_y: float) -> float | None:
    field = pack.get("field")
    bounds = pack.get("bounds")
    grid_w = int(pack.get("gridW") or 0)
    grid_h = int(pack.get("gridH") or 0)
    if not isinstance(field, list) or not isinstance(bounds, dict) or grid_w < 2 or grid_h < 2:
        return None
    min_x = parse_float(bounds.get("minX"))
    max_x = parse_float(bounds.get("maxX"))
    min_y = parse_float(bounds.get("minY"))
    max_y = parse_float(bounds.get("maxY"))
    pad = parse_float(bounds.get("pad"))
    width = parse_float(pack.get("width"))
    height = parse_float(pack.get("height"))
    if None in (min_x, max_x, min_y, max_y, pad, width, height):
        return None
    sx = pad + ((world_x - min_x) / ((max_x - min_x) or 1.0)) * (width - pad * 2.0)
    sy = pad + (1.0 - (world_y - min_y) / ((max_y - min_y) or 1.0)) * (height - pad * 2.0)
    gx = clamp((sx / width) * (grid_w - 1), 0.0, grid_w - 1.0)
    gy = clamp((sy / height) * (grid_h - 1), 0.0, grid_h - 1.0)
    x0 = int(math.floor(gx))
    x1 = min(grid_w - 1, x0 + 1)
    y0 = int(math.floor(gy))
    y1 = min(grid_h - 1, y0 + 1)
    tx = gx - x0
    ty = gy - y0
    try:
        v00 = float(field[y0][x0])
        v10 = float(field[y0][x1])
        v01 = float(field[y1][x0])
        v11 = float(field[y1][x1])
    except Exception:
        return None
    v0 = v00 * (1.0 - tx) + v10 * tx
    v1 = v01 * (1.0 - tx) + v11 * tx
    value = v0 * (1.0 - ty) + v1 * ty
    return value if math.isfinite(value) else None


def compute_eval_boundary_rect_from_drillholes(points: Iterable[dict[str, object]]) -> list[dict[str, float | str]]:
    valid = [(float(item["x"]), float(item["y"])) for item in points if parse_float(item.get("x")) is not None and parse_float(item.get("y")) is not None]
    if not valid:
        return []
    xs = [item[0] for item in valid]
    ys = [item[1] for item in valid]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    return [
        {"id": "BND-1", "x": min_x, "y": min_y},
        {"id": "BND-2", "x": max_x, "y": min_y},
        {"id": "BND-3", "x": max_x, "y": max_y},
        {"id": "BND-4", "x": min_x, "y": max_y},
    ]


def extract_geology_interpolated_params(
    drillhole_points: list[dict[str, object]],
    boundary_world: np.ndarray,
    contour_data: dict[str, dict[str, object]],
    coal_thickness_field: dict[str, object],
) -> dict[str, object]:
    boundary_ctrl = compute_eval_boundary_rect_from_drillholes(drillhole_points)
    area_pts = [
        {"id": f"AREA-{idx + 1}", "x": float(point[0]), "y": float(point[1]), "__cat": "blue"}
        for idx, point in enumerate(boundary_world.tolist())
    ]
    geology_pts = [
        {"id": str(point["id"]), "x": float(point["x"]), "y": float(point["y"]), "__cat": "geo"}
        for point in drillhole_points
    ]
    boundary_pts = [{"id": item["id"], "x": float(item["x"]), "y": float(item["y"]), "__cat": "gray"} for item in boundary_ctrl]

    uniq: dict[str, dict[str, object]] = {}
    for point in [*geology_pts, *boundary_pts, *area_pts]:
        key = f"{point['id']}@@{point['x']:.6f}@@{point['y']:.6f}"
        uniq.setdefault(key, point)
    pts = list(uniq.values())

    extracted: list[dict[str, object]] = []
    for point in pts:
        x = float(point["x"])
        y = float(point["y"])
        ti = sample_field_pack_at_world_xy(contour_data["Ti"], x, y)
        ei = sample_field_pack_at_world_xy(contour_data["Ei"], x, y)
        hi = sample_field_pack_at_world_xy(contour_data["Hi"], x, y)
        di = sample_field_pack_at_world_xy(contour_data["Di"], x, y)
        mi = sample_field_pack_at_world_xy(coal_thickness_field, x, y)
        extracted.append(
            {
                "id": str(point["id"]),
                "cat": point["__cat"],
                "faceIndex": None,
                "x": x,
                "y": y,
                "Ti": ti,
                "Ei": ei if ei is not None and math.isfinite(ei) else None,
                "Hi": hi,
                "Di": di,
                "Mi": mi if mi is not None and math.isfinite(mi) else None,
                "delta": 0.0,
                "lpi": 0.0,
                "lci": 0.0,
                "trueCoalThk": mi if mi is not None and math.isfinite(mi) else None,
                "inWorkface": False,
                "onWorkfaceEdge": False,
            }
        )

    return {
        "points": extracted,
        "summary": {
            "geologyEvalCount": sum(1 for item in extracted if item["cat"] == "geo"),
            "generatedEvalCount": sum(1 for item in extracted if item["cat"] != "geo"),
            "evalPointCount": len(extracted),
        },
    }


ODI_ROW_KEYS = ["Di", "Ei", "Hi", "lci", "lpi", "Mi", "Ti", "delta"]
ODI_MATRIX = [
    [0.057389, 0, 0.024286, 0.058885, 0.196652, 0.026673, 0.044067, 0.015795, 0.045139],
    [0.314349, 0.105842, 0, 0, 0, 0, 0, 0, 0],
    [0.061192, 0.049348, 0.047564, 0.044506, 0.175154, 0.611954, 0.115051, 0.319025, 0.062264],
    [0, 0.290717, 0.309626, 0.11777, 0.034283, 0, 0, 0.214748, 0.147835],
    [0.124117, 0.366249, 0.088621, 0.382754, 0.064932, 0, 0, 0.044108, 0.106237],
    [0.101988, 0, 0.102697, 0.121286, 0.243085, 0.143936, 0.589151, 0.128533, 0.335152],
    [0.190565, 0.086577, 0.154086, 0.039257, 0.212361, 0.217437, 0.251731, 0.131501, 0.154793],
    [0.150401, 0.101268, 0.27312, 0.235541, 0.073533, 0, 0, 0.14629, 0.148581],
]


def is_row_degenerate(values: Iterable[float]) -> bool:
    finite = [float(value) for value in values if math.isfinite(float(value))]
    if not finite:
        return True
    if all(abs(value) <= 1e-12 for value in finite):
        return True
    first = finite[0]
    return all(abs(value - first) <= 1e-12 for value in finite)


def renormalize_columns(matrix: list[list[float]]) -> list[list[float]]:
    out = [row[:] for row in matrix]
    if not out:
        return out
    column_count = len(out[0])
    for col_idx in range(column_count):
        column_sum = sum(float(row[col_idx]) for row in out)
        if column_sum <= 1e-12:
            continue
        for row_idx in range(len(out)):
            out[row_idx][col_idx] = float(out[row_idx][col_idx]) / column_sum
    return out


def mul_xw(x_matrix: list[list[float]], w_matrix: list[list[float]]) -> list[list[float]]:
    row_count = len(x_matrix)
    factor_count = len(w_matrix)
    col_count = len(w_matrix[0]) if factor_count else 0
    result = [[0.0 for _ in range(col_count)] for _ in range(row_count)]
    for row_idx in range(row_count):
        for col_idx in range(col_count):
            value = 0.0
            for factor_idx in range(factor_count):
                value += float(x_matrix[row_idx][factor_idx]) * float(w_matrix[factor_idx][col_idx])
            result[row_idx][col_idx] = value
    return result


def compute_odi(points: list[dict[str, object]], weights: dict[str, float]) -> dict[str, object]:
    pts = [point for point in points if parse_float(point.get("x")) is not None and parse_float(point.get("y")) is not None]
    if not pts:
        raise RuntimeError("ODI 计算失败：有效点不足。")
    sum_w = float(weights["wd"]) + float(weights["wo"]) + float(weights["wf"])
    if abs(sum_w - 1.0) > 1e-6:
        raise RuntimeError("ODI 权重约束不满足：wd + wo + wf 必须等于 1。")

    row_values = {key: [] for key in ODI_ROW_KEYS}
    for point in pts:
        row_values["Di"].append(parse_float(point.get("Di")) or 0.0)
        row_values["Ei"].append(parse_float(point.get("Ei")) or 0.0)
        row_values["Hi"].append(parse_float(point.get("Hi")) or 0.0)
        row_values["lci"].append(parse_float(point.get("lci")) or 0.0)
        row_values["lpi"].append(parse_float(point.get("lpi")) or 0.0)
        row_values["Mi"].append(parse_float(point.get("Mi")) or 0.0)
        row_values["Ti"].append(parse_float(point.get("Ti")) or 0.0)
        row_values["delta"].append(parse_float(point.get("delta")) or 0.0)

    keep_indices: list[int] = []
    kept_keys: list[str] = []
    for idx, key in enumerate(ODI_ROW_KEYS):
        if not is_row_degenerate(row_values[key]):
            keep_indices.append(idx)
            kept_keys.append(key)

    if not keep_indices:
        raise RuntimeError("ODI 计算失败：参与计算的因子全部退化。")

    w_kept = [ODI_MATRIX[idx] for idx in keep_indices]
    w_norm = renormalize_columns(w_kept)
    x_matrix: list[list[float]] = []
    for point in pts:
        full_row = [
            parse_float(point.get("Di")) or 0.0,
            parse_float(point.get("Ei")) or 0.0,
            parse_float(point.get("Hi")) or 0.0,
            parse_float(point.get("lci")) or 0.0,
            parse_float(point.get("lpi")) or 0.0,
            parse_float(point.get("Mi")) or 0.0,
            parse_float(point.get("Ti")) or 0.0,
            parse_float(point.get("delta")) or 0.0,
        ]
        x_matrix.append([full_row[idx] for idx in keep_indices])

    reduced = mul_xw(x_matrix, w_norm)
    points_out: list[dict[str, object]] = []
    min_odi = math.inf
    max_odi = -math.inf
    for idx, point in enumerate(pts):
        row = reduced[idx]
        smax, dsmax, ksi, dsi, asi, hf, kw, bf, af = row
        wd_val = smax + dsmax
        wo_val = ksi + dsi + asi
        wf_val = hf + kw + bf + af
        odi = float(weights["wd"]) * wd_val + float(weights["wo"]) * wo_val + float(weights["wf"]) * wf_val
        min_odi = min(min_odi, odi)
        max_odi = max(max_odi, odi)
        points_out.append(
            {
                **point,
                "indicators": {
                    "Smax": smax,
                    "DSmax": dsmax,
                    "Ksi": ksi,
                    "Dsi": dsi,
                    "Asi": asi,
                    "Hf": hf,
                    "Kw": kw,
                    "Bf": bf,
                    "Af": af,
                },
                "wd": wd_val,
                "wo": wo_val,
                "wf": wf_val,
                "odi": odi,
            }
        )

    denominator = (max_odi - min_odi) or 1.0
    points_norm = []
    for point in points_out:
        odi_norm = clamp((float(point["odi"]) - min_odi) / denominator, 0.0, 1.0)
        points_norm.append({**point, "odiNorm": odi_norm})

    return {
        "keptFactorKeys": kept_keys,
        "weights": weights,
        "minOdi": min_odi,
        "maxOdi": max_odi,
        "points": points_norm,
    }


def compute_world_bounds(boundary_world: np.ndarray, drillhole_points: list[dict[str, object]]) -> dict[str, float]:
    xs = list(boundary_world[:, 0]) + [float(item["x"]) for item in drillhole_points]
    ys = list(boundary_world[:, 1]) + [float(item["y"]) for item in drillhole_points]
    return {"minX": min(xs), "maxX": max(xs), "minY": min(ys), "maxY": max(ys)}


def compute_field_idw_world(
    samples: list[dict[str, object]],
    width: float = 500.0,
    height: float = 400.0,
    world_bounds: dict[str, float] | None = None,
    k_nearest: int = 24,
    smooth_passes: int = 0,
) -> dict[str, object]:
    valid = [
        sample
        for sample in samples
        if parse_float(sample.get("x")) is not None
        and parse_float(sample.get("y")) is not None
        and parse_float(sample.get("value")) is not None
    ]
    if len(valid) < 3:
        return {"field": None, "min": None, "max": None, "gridW": 0, "gridH": 0, "width": width, "height": height, "points": [], "bounds": None}

    xs = [float(sample["x"]) for sample in valid]
    ys = [float(sample["y"]) for sample in valid]
    vs = [float(sample["value"]) for sample in valid]
    min_x = min(xs)
    max_x = max(xs)
    min_y = min(ys)
    max_y = max(ys)
    if world_bounds is not None:
        min_x = float(world_bounds["minX"])
        max_x = float(world_bounds["maxX"])
        min_y = float(world_bounds["minY"])
        max_y = float(world_bounds["maxY"])

    min_v = min(vs)
    max_v = max(vs)
    pad = 18.0
    grid_w = 80
    grid_h = 56
    eps = 1e-6
    power = 2.0

    def sx(world_x: float) -> float:
        return pad + ((world_x - min_x) / ((max_x - min_x) or 1.0)) * (width - pad * 2.0)

    def sy(world_y: float) -> float:
        return pad + (1.0 - (world_y - min_y) / ((max_y - min_y) or 1.0)) * (height - pad * 2.0)

    pts = [{"x": sx(float(sample["x"])), "y": sy(float(sample["y"])), "v": clamp(float(sample["value"]), 0.0, 1.0)} for sample in valid]

    def select_k_nearest(x: float, y: float) -> list[dict[str, float]]:
        ranked = []
        for pt in pts:
            dx = x - pt["x"]
            dy = y - pt["y"]
            d2 = dx * dx + dy * dy
            ranked.append({"x": pt["x"], "y": pt["y"], "v": pt["v"], "d2": d2})
        ranked.sort(key=lambda item: item["d2"])
        return ranked[: min(k_nearest, len(ranked))]

    def idw_at(x: float, y: float, neighbors: list[dict[str, float]]) -> float:
        numerator = 0.0
        denominator = 0.0
        for pt in neighbors:
            if pt["d2"] < eps:
                return pt["v"]
            weight = 1.0 / math.pow(pt["d2"], power / 2.0)
            numerator += weight * pt["v"]
            denominator += weight
        return numerator / (denominator or 1.0)

    field = [[0.0 for _ in range(grid_w)] for _ in range(grid_h)]
    for gy in range(grid_h):
        y = (gy / (grid_h - 1)) * height
        for gx in range(grid_w):
            x = (gx / (grid_w - 1)) * width
            neighbors = select_k_nearest(x, y)
            field[gy][gx] = clamp(idw_at(x, y, neighbors), 0.0, 1.0)

    def smooth_once(src: list[list[float]]) -> list[list[float]]:
        dst = [[0.0 for _ in range(grid_w)] for _ in range(grid_h)]
        weights = ((1, 2, 1), (2, 4, 2), (1, 2, 1))
        for y in range(grid_h):
            y0 = max(0, y - 1)
            y1 = y
            y2 = min(grid_h - 1, y + 1)
            for x in range(grid_w):
                x0 = max(0, x - 1)
                x1 = x
                x2 = min(grid_w - 1, x + 1)
                values = (
                    (src[y0][x0], src[y0][x1], src[y0][x2]),
                    (src[y1][x0], src[y1][x1], src[y1][x2]),
                    (src[y2][x0], src[y2][x1], src[y2][x2]),
                )
                total = 0.0
                for row_idx in range(3):
                    for col_idx in range(3):
                        total += weights[row_idx][col_idx] * values[row_idx][col_idx]
                dst[y][x] = clamp(total / 16.0, 0.0, 1.0)
        return dst

    smoothed = field
    for _ in range(max(0, smooth_passes)):
        smoothed = smooth_once(smoothed)

    return {
        "field": smoothed,
        "min": min_v,
        "max": max_v,
        "gridW": grid_w,
        "gridH": grid_h,
        "width": width,
        "height": height,
        "points": pts,
        "bounds": {"minX": min_x, "maxX": max_x, "minY": min_y, "maxY": max_y, "pad": pad},
    }


def renorm_field01(pack: dict[str, object]) -> dict[str, object]:
    field = pack.get("field")
    if not isinstance(field, list):
        return pack
    finite = [float(value) for row in field for value in row if math.isfinite(float(value))]
    if not finite:
        return {**pack, "min": 0.0, "max": 1.0}
    f_min = min(finite)
    f_max = max(finite)
    denom = (f_max - f_min) or 1.0
    renorm = []
    for row in field:
        renorm.append([clamp((float(value) - f_min) / denom, 0.0, 1.0) for value in row])
    return {**pack, "field": renorm, "min": 0.0, "max": 1.0}


def build_layout_odi_pack(
    boundary_world: np.ndarray,
    drillhole_points: list[dict[str, object]],
    extracted_points: list[dict[str, object]],
) -> tuple[dict[str, object], dict[str, object]]:
    odi_result = compute_odi(extracted_points, SCENARIO_WEIGHTS)
    samples = [
        {"id": point["id"], "x": point["x"], "y": point["y"], "value": point["odiNorm"]}
        for point in odi_result["points"]
        if parse_float(point.get("odiNorm")) is not None
    ]
    world_bounds = compute_world_bounds(boundary_world, drillhole_points)
    pack = compute_field_idw_world(samples, width=500.0, height=400.0, world_bounds=world_bounds, k_nearest=24, smooth_passes=SMOOTH_PASSES)
    pack = renorm_field01(pack)
    pack["source"] = "mindong-layout-odi"
    pack["scenario"] = ODI_SCENARIO
    pack["selectedCoal"] = TARGET_SEAM
    pack["weights"] = SCENARIO_WEIGHTS
    return pack, odi_result


def write_odi_pack(pack: dict[str, object], stats: dict[str, object]) -> None:
    payload = {**pack, "stats": stats}
    ODI_PACK_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_design_result() -> dict[str, object]:
    return json.loads(DESIGN_RESULT_PATH.read_text(encoding="utf-8"))


def localize_points(points: np.ndarray, origin: tuple[float, float]) -> np.ndarray:
    return points - np.asarray([[origin[0], origin[1]]], dtype=float)


def idw_interpolate(sample_xy: np.ndarray, sample_values: np.ndarray, grid_x: np.ndarray, grid_y: np.ndarray, power: float = 2.0) -> np.ndarray:
    dx = grid_x[..., None] - sample_xy[:, 0]
    dy = grid_y[..., None] - sample_xy[:, 1]
    dist = np.hypot(dx, dy)
    exact = dist < 1e-9
    safe_dist = np.where(exact, 1.0, dist)
    weights = 1.0 / np.power(safe_dist, power)
    weighted = np.sum(weights * sample_values[None, None, :], axis=2) / np.sum(weights, axis=2)
    if np.any(exact):
        exact_idx = np.argmax(exact, axis=2)
        exact_any = np.any(exact, axis=2)
        weighted = np.where(exact_any, sample_values[exact_idx], weighted)
    return weighted


def build_local_grid(boundary_world: np.ndarray, sample_points_world: np.ndarray) -> dict[str, np.ndarray]:
    min_x, min_y = np.min(boundary_world[:, 0]), np.min(boundary_world[:, 1])
    max_x, max_y = np.max(boundary_world[:, 0]), np.max(boundary_world[:, 1])
    xs = np.linspace(min_x, max_x, GRID_W)
    ys = np.linspace(min_y, max_y, GRID_H)
    grid_x_world, grid_y_world = np.meshgrid(xs, ys)
    boundary_path = MplPath(boundary_world)
    flat = np.column_stack([grid_x_world.ravel(), grid_y_world.ravel()])
    mask = boundary_path.contains_points(flat).reshape(grid_x_world.shape)
    field = idw_interpolate(sample_points_world[:, :2], sample_points_world[:, 2], grid_x_world, grid_y_world)
    field = np.where(mask, field, np.nan)
    dx = float(xs[1] - xs[0])
    dy = float(ys[1] - ys[0])
    field_filled = np.where(np.isfinite(field), field, np.nanmean(sample_points_world[:, 2]))
    grad_y, grad_x = np.gradient(field_filled, dy, dx)
    grad_mag = np.where(mask, np.hypot(grad_x, grad_y), np.nan)
    origin = (min_x, min_y)
    return {
        "origin": np.asarray(origin, dtype=float),
        "boundary_local": localize_points(boundary_world, origin),
        "points_local": localize_points(sample_points_world[:, :2], origin),
        "grid_x_local": grid_x_world - origin[0],
        "grid_y_local": grid_y_world - origin[1],
        "mask": mask,
        "thickness_field": field,
        "gradient_field": grad_mag,
        "thickness_min": np.nanmin(field),
        "thickness_max": np.nanmax(field),
    }


def compute_layout_extents(design: dict[str, object]) -> tuple[float, float, float, float]:
    xs: list[float] = []
    ys: list[float] = []
    for panel in design.get("panels", []):
        for point in panel.get("points", []):
            x = parse_float(point.get("x"))
            y = parse_float(point.get("y"))
            if x is not None and y is not None:
                xs.append(x)
                ys.append(y)
    for road in design.get("roadways", []):
        for point in road.get("path", []):
            x = parse_float(point.get("x"))
            y = parse_float(point.get("y"))
            if x is not None and y is not None:
                xs.append(x)
                ys.append(y)
    if not xs or not ys:
        raise RuntimeError("规划结果缺少有效几何数据。")
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    pad_x = max((max_x - min_x) * 0.045, 18.0)
    pad_y = max((max_y - min_y) * 0.055, 16.0)
    return min_x - pad_x, max_x + pad_x, min_y - pad_y, max_y + pad_y


def add_scale_bar(ax: plt.Axes, x: float, y: float, length: float, label: str, color: str = "#334155") -> None:
    ax.plot([x, x + length], [y, y], color=color, lw=2.6, solid_capstyle="butt", zorder=20)
    ax.plot([x, x], [y - 4, y + 4], color=color, lw=1.8, zorder=20)
    ax.plot([x + length, x + length], [y - 4, y + 4], color=color, lw=1.8, zorder=20)
    ax.text(x + length / 2, y + 8, label, ha="center", va="bottom", fontsize=9.5, color=color)


def draw_spatial_panel(
    ax: plt.Axes,
    grid_bundle: dict[str, np.ndarray],
    sample_points_world: np.ndarray,
    odi_pack: dict[str, object],
) -> dict[str, object]:
    cmap = LinearSegmentedColormap.from_list("paper_teal", ["#e6f7f5", "#bbe6dd", "#7ccbc0", "#3ea7a2", "#236f7d"])
    boundary_local = grid_bundle["boundary_local"]
    points_local = grid_bundle["points_local"]
    mesh = ax.contourf(
        grid_bundle["grid_x_local"],
        grid_bundle["grid_y_local"],
        grid_bundle["thickness_field"],
        levels=18,
        cmap=cmap,
        antialiased=True,
    )

    sampled_risk = np.full_like(grid_bundle["thickness_field"], np.nan, dtype=float)
    world_x = grid_bundle["grid_x_local"] + float(grid_bundle["origin"][0])
    world_y = grid_bundle["grid_y_local"] + float(grid_bundle["origin"][1])
    rows, cols = sampled_risk.shape
    for row_idx in range(rows):
        for col_idx in range(cols):
            if not grid_bundle["mask"][row_idx, col_idx]:
                continue
            sampled_risk[row_idx, col_idx] = sample_field_pack_at_world_xy(odi_pack, float(world_x[row_idx, col_idx]), float(world_y[row_idx, col_idx])) or np.nan

    finite_risk = sampled_risk[np.isfinite(sampled_risk)]
    if finite_risk.size:
        levels = np.quantile(finite_risk, [0.45, 0.65, 0.82])
        levels = np.unique(np.round(levels, 4))
        if levels.size >= 2:
            ax.contour(
                grid_bundle["grid_x_local"],
                grid_bundle["grid_y_local"],
                sampled_risk,
                levels=levels,
                colors=["#d9eef6", "#a9d6e5", "#77b7cf"][: len(levels)],
                linewidths=[0.9, 1.15, 1.45][: len(levels)],
                alpha=0.98,
            )

    ax.plot(boundary_local[:, 0], boundary_local[:, 1], color="#162235", lw=1.7, zorder=10)
    ax.scatter(points_local[:, 0], points_local[:, 1], s=28, c="#111827", edgecolors="white", linewidths=0.8, zorder=12)

    cax = inset_axes(
        ax,
        width="24%",
        height="3.8%",
        loc="lower right",
        bbox_to_anchor=(0.0, 0.055, 1, 1),
        bbox_transform=ax.transAxes,
        borderpad=0,
    )
    cbar = plt.colorbar(mesh, cax=cax, orientation="horizontal")
    cbar.set_label("厚度 / m", fontsize=8.4, labelpad=2)
    cbar.ax.tick_params(labelsize=7.4, pad=1)
    cbar.outline.set_linewidth(0.8)

    legend_items = [
        Line2D([0], [0], color="#162235", lw=1.7, label="采区边界"),
        Line2D([0], [0], marker="o", color="none", markerfacecolor="#111827", markeredgecolor="white", markersize=6.5, label="钻孔点"),
        Line2D([0], [0], color="#8ec7db", lw=1.4, label="ODI 等值线"),
    ]
    ax.legend(
        handles=legend_items,
        loc="upper right",
        frameon=True,
        fontsize=8.2,
        facecolor="white",
        framealpha=0.94,
        edgecolor="#d7dee8",
        borderpad=0.42,
        handlelength=1.7,
    )
    ax.set_title("(a) 综合空间决策底图", loc="left", fontsize=11.9, fontweight="bold", pad=9)
    ax.set_xlabel("局部坐标 X / m", fontsize=10)
    ax.set_ylabel("局部坐标 Y / m", fontsize=10)
    ax.set_aspect("equal")
    ax.set_facecolor("#fbfcfd")
    ax.grid(color="#d7e2e7", linewidth=0.48, alpha=0.25)
    ax.text(
        0.02,
        0.02,
        f"局部原点 = ({grid_bundle['origin'][0]:.2f}, {grid_bundle['origin'][1]:.2f}) m",
        transform=ax.transAxes,
        fontsize=8.0,
        color="#475569",
        ha="left",
        va="bottom",
    )

    x0, x1 = ax.get_xlim()
    y0, y1 = ax.get_ylim()
    add_scale_bar(ax, x0 + (x1 - x0) * 0.06, y0 + (y1 - y0) * 0.08, 500.0, "500 m")
    return {
        "risk_source": str(odi_pack.get("source") or "odi"),
        "thickness_min": float(grid_bundle["thickness_min"]),
        "thickness_max": float(grid_bundle["thickness_max"]),
    }


def draw_layout_panel(ax: plt.Axes, design: dict[str, object]) -> dict[str, object]:
    panel_palette = ["#92cac5", "#78b7cf", "#abd9bd"]
    roadway_style = {
        "main": {"color": "#3797b3", "lw": 3.0, "alpha": 0.78, "ls": "-"},
        "transport": {"color": "#7dbdad", "lw": 2.15, "alpha": 0.84, "ls": "-"},
        "ventilation": {"color": "#d7a35a", "lw": 1.75, "alpha": 0.78, "ls": (0, (6, 3))},
        "return": {"color": "#d7a35a", "lw": 1.75, "alpha": 0.78, "ls": (0, (6, 3))},
        "cut": {"color": "#7f9fc8", "lw": 1.75, "alpha": 0.78, "ls": "-"},
    }
    min_x, max_x, min_y, max_y = compute_layout_extents(design)
    ax.set_xlim(min_x, max_x)
    ax.set_ylim(min_y, max_y)

    for road in design.get("roadways", []):
        points = [(parse_float(item.get("x")), parse_float(item.get("y"))) for item in road.get("path", [])]
        valid = [(x, y) for x, y in points if x is not None and y is not None]
        if len(valid) < 2:
            continue
        xs = [item[0] for item in valid]
        ys = [item[1] for item in valid]
        road_type = str(road.get("type") or "").strip().lower()
        style = roadway_style.get(road_type, {"color": "#94a3b8", "lw": 1.8, "alpha": 0.65, "ls": "-"})
        ax.plot(xs, ys, color=style["color"], lw=style["lw"], alpha=style["alpha"], linestyle=style["ls"], solid_capstyle="round", zorder=2)

    label_rows: list[dict[str, object]] = []
    for idx, panel in enumerate(design.get("panels", [])):
        vertices = [(parse_float(item.get("x")), parse_float(item.get("y"))) for item in panel.get("points", [])]
        valid = [(x, y) for x, y in vertices if x is not None and y is not None]
        if len(valid) < 3:
            continue
        patch = MplPolygon(valid, closed=True, facecolor=panel_palette[idx % len(panel_palette)], edgecolor="#1b2a3a", linewidth=1.28, alpha=0.90, zorder=5)
        ax.add_patch(patch)
        center_x = parse_float(panel.get("center_x"))
        center_y = parse_float(panel.get("center_y"))
        if center_x is None or center_y is None:
            array = np.asarray(valid, dtype=float)
            center_x = float(array[:, 0].mean())
            center_y = float(array[:, 1].mean())
        label = f"工作面{idx + 1}"
        ax.text(
            center_x,
            center_y,
            label,
            ha="center",
            va="center",
            fontsize=10.1,
            fontweight="bold",
            color="#0f172a",
            bbox={"boxstyle": "round,pad=0.20", "facecolor": "white", "edgecolor": "none", "alpha": 0.84},
            zorder=8,
        )
        label_rows.append(
            {
                "label": label,
                "advance_length_m": parse_float(panel.get("advanceLength")),
                "face_length_m": parse_float(panel.get("faceLength")),
                "avg_score": parse_float(panel.get("avgScore")),
            }
        )

    legend_items = [
        Patch(facecolor=panel_palette[0], edgecolor="#0f172a", label="工作面组"),
        Line2D([0], [0], color=roadway_style["main"]["color"], lw=3.0, label="大巷"),
        Line2D([0], [0], color=roadway_style["transport"]["color"], lw=2.2, label="运输顺槽"),
        Line2D([0], [0], color=roadway_style["return"]["color"], lw=2.0, linestyle=roadway_style["return"]["ls"], label="回风顺槽"),
        Line2D([0], [0], color=roadway_style["cut"]["color"], lw=2.0, label="切眼"),
    ]
    ax.legend(
        handles=legend_items,
        loc="upper right",
        frameon=True,
        fontsize=8.1,
        facecolor="white",
        framealpha=0.94,
        edgecolor="#d7dee8",
        borderpad=0.42,
        handlelength=1.7,
    )
    ax.set_title("(b) 规划结果布局界面", loc="left", fontsize=11.9, fontweight="bold", pad=9)
    ax.set_facecolor("#fbfcfd")
    ax.set_aspect("equal")
    ax.grid(color="#d7e2e7", linewidth=0.45, alpha=0.20)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.text(0.02, 0.022, "以工作面为主、巷道为辅的科研表达", transform=ax.transAxes, fontsize=8.2, color="#475569", ha="left", va="bottom")
    add_scale_bar(ax, min_x + (max_x - min_x) * 0.05, min_y + (max_y - min_y) * 0.08, 100.0, "100 m")
    return {"labels": label_rows, "panel_count": len(label_rows), "roadway_count": len(design.get("roadways", []))}


def build_figure(
    boundary_world: np.ndarray,
    thickness_points_world: np.ndarray,
    design: dict[str, object],
    odi_pack: dict[str, object],
    odi_stats: dict[str, object],
) -> dict[str, object]:
    grid_bundle = build_local_grid(boundary_world, thickness_points_world)
    fig = plt.figure(figsize=(12.9, 5.38), facecolor="white")
    gs = fig.add_gridspec(
        1,
        2,
        width_ratios=[1.14, 0.86],
        left=0.043,
        right=0.985,
        bottom=0.09,
        top=0.93,
        wspace=0.068,
    )
    ax_left = fig.add_subplot(gs[0, 0])
    ax_right = fig.add_subplot(gs[0, 1])

    left_meta = draw_spatial_panel(ax_left, grid_bundle, thickness_points_world, odi_pack)
    right_meta = draw_layout_panel(ax_right, design)

    fig.savefig(OUTPUT_PNG, dpi=360, bbox_inches="tight", facecolor="white")
    fig.savefig(OUTPUT_SVG, bbox_inches="tight", facecolor="white")
    plt.close(fig)

    ensure_dir(ASCII_PREVIEW_DIR)
    shutil.copyfile(OUTPUT_PNG, ASCII_PREVIEW_PNG)
    shutil.copyfile(OUTPUT_SVG, ASCII_PREVIEW_SVG)

    return {
        "target_seam": TARGET_SEAM,
        "odi_scenario": ODI_SCENARIO,
        "risk_source": left_meta["risk_source"],
        "thickness_range_m": [round(left_meta["thickness_min"], 3), round(left_meta["thickness_max"], 3)],
        "panel_count": right_meta["panel_count"],
        "roadway_count": right_meta["roadway_count"],
        "workface_labels": right_meta["labels"],
        "odi_stats": odi_stats,
        "outputs": {
            "png": str(OUTPUT_PNG),
            "svg": str(OUTPUT_SVG),
            "odi_pack": str(ODI_PACK_PATH),
            "ascii_preview_png": str(ASCII_PREVIEW_PNG),
            "ascii_preview_svg": str(ASCII_PREVIEW_SVG),
        },
    }


def main() -> None:
    ensure_dir(FIGURE_ROOT)
    ensure_dir(RESULT_ROOT)

    boundary_world = load_boundary()
    coords_by_id = load_borehole_coordinates()
    layers_by_id = load_borehole_layers()
    borehole_param_samples = build_borehole_param_samples(coords_by_id, layers_by_id, TARGET_SEAM, ODI_SCENARIO)

    if len(borehole_param_samples["CoalThk"]) < 3:
        raise RuntimeError(f"{TARGET_SEAM} 的有效煤厚钻孔不足 3 个，当前仅有 {len(borehole_param_samples['CoalThk'])} 个。")

    contour_data = {
        "Ti": compute_field(borehole_param_samples["Ti"]),
        "Ei": compute_field(borehole_param_samples["Ei"]),
        "Hi": compute_field(borehole_param_samples["Hi"]),
        "Di": compute_field(borehole_param_samples["Di"]),
        "Mi": compute_field(borehole_param_samples["Mi"]),
    }
    coal_thickness_field = compute_field(borehole_param_samples["CoalThk"])

    drillhole_points = [{"id": bh_id, "x": coord[0], "y": coord[1]} for bh_id, coord in sorted(coords_by_id.items())]
    geology_extract = extract_geology_interpolated_params(drillhole_points, boundary_world, contour_data, coal_thickness_field)
    odi_pack, odi_result = build_layout_odi_pack(boundary_world, drillhole_points, geology_extract["points"])

    odi_stats = {
        "scenario": ODI_SCENARIO,
        "selected_coal": TARGET_SEAM,
        "weights": SCENARIO_WEIGHTS,
        "smooth_passes": SMOOTH_PASSES,
        "drillholes_total": len(drillhole_points),
        "coal_thickness_samples": len(borehole_param_samples["CoalThk"]),
        "ti_samples": len(borehole_param_samples["Ti"]),
        "ei_samples": len(borehole_param_samples["Ei"]),
        "hi_samples": len(borehole_param_samples["Hi"]),
        "di_samples": len(borehole_param_samples["Di"]),
        "eval_point_count": geology_extract["summary"]["evalPointCount"],
        "kept_factor_keys": odi_result["keptFactorKeys"],
        "odi_min": odi_result["minOdi"],
        "odi_max": odi_result["maxOdi"],
    }
    write_odi_pack(odi_pack, odi_stats)

    thickness_points_world = np.asarray(
        [[float(item["x"]), float(item["y"]), float(item["value"])] for item in borehole_param_samples["CoalThk"]],
        dtype=float,
    )
    design = load_design_result()
    metadata = build_figure(boundary_world, thickness_points_world, design, odi_pack, odi_stats)
    OUTPUT_META.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
