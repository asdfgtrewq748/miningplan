"""Compute ODI statistics for custom weight scenario S1 (0.25/0.25/0.50).

Reuses the same pipeline as compute_unified_odi_sensitivity_20260418.py.
"""

import csv
import importlib.util
import json
import math
import os
import sys
from pathlib import Path


ROOT = Path("d:/xiangmu/miningplan")
CASE_DIR = ROOT / "软件案例附件" / "工程文件案例"
GEN_SCRIPT = ROOT / "论文" / "重构工作区" / "05_支撑材料" / "生成论文导图.py"
OUT_DIR = ROOT / "tmp" / "sensitivity_s1_s3"
OUT_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str((ROOT / "mining-plan" / "backend_python").resolve()))
from routers.planning import (
    SmartWeightedDisturbanceParams,
    ThicknessFieldPack,
    _compute_disturbance_for_candidates,
)

spec = importlib.util.spec_from_file_location("paper_fig", str(GEN_SCRIPT))
paper_fig = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules["paper_fig"] = paper_fig
spec.loader.exec_module(paper_fig)


def field_stats(pack):
    vals = [float(v) for row in pack["field"] for v in row if math.isfinite(float(v))]
    vals.sort()

    def q(prob):
        pos = (len(vals) - 1) * prob
        lo = int(math.floor(pos))
        hi = min(len(vals) - 1, lo + 1)
        t = pos - lo
        return vals[lo] * (1 - t) + vals[hi] * t

    return {
        "n": len(vals),
        "mean": sum(vals) / len(vals),
        "median": q(0.5),
        "p90": q(0.9),
        "gt_065": sum(v > 0.65 for v in vals) / len(vals) * 100,
        "gt_070": sum(v > 0.70 for v in vals) / len(vals) * 100,
        "gt_075": sum(v > 0.75 for v in vals) / len(vals) * 100,
        "gt_080": sum(v > 0.80 for v in vals) / len(vals) * 100,
    }


def build_pack(weights):
    old = dict(paper_fig.SCENARIO_WEIGHTS)
    try:
        paper_fig.SCENARIO_WEIGHTS = dict(weights)
        boundary_world = paper_fig.load_boundary()
        coords_by_id = paper_fig.load_borehole_coordinates()
        layers_by_id = paper_fig.load_borehole_layers()
        samples = paper_fig.build_borehole_param_samples(
            coords_by_id, layers_by_id, paper_fig.TARGET_SEAM, paper_fig.ODI_SCENARIO
        )
        contour_data = {
            "Ti": paper_fig.compute_field(samples["Ti"]),
            "Ei": paper_fig.compute_field(samples["Ei"]),
            "Hi": paper_fig.compute_field(samples["Hi"]),
            "Di": paper_fig.compute_field(samples["Di"]),
            "Mi": paper_fig.compute_field(samples["Mi"]),
        }
        coal_thickness_field = paper_fig.compute_field(samples["CoalThk"])
        drillhole_points = [
            {"id": bh_id, "x": coord[0], "y": coord[1]}
            for bh_id, coord in sorted(coords_by_id.items())
        ]
        geology_extract = paper_fig.extract_geology_interpolated_params(
            drillhole_points, boundary_world, contour_data, coal_thickness_field
        )
        pack, odi_result = paper_fig.build_layout_odi_pack(
            boundary_world, drillhole_points, geology_extract["points"]
        )
        pack["stats"] = {
            "weights": weights,
            "kept_factor_keys": odi_result.get("keptFactorKeys"),
            "odi_min": odi_result.get("minOdi"),
            "odi_max": odi_result.get("maxOdi"),
        }
        return pack
    finally:
        paper_fig.SCENARIO_WEIGHTS = old


def risk_score(st):
    return float(st["mean"]) * 0.5 + float(st["p90"]) * 0.35 + float(st["exceedRatio"]) * 0.15


def candidate_summary(c):
    metrics = c.get("metrics") if isinstance(c.get("metrics"), dict) else {}
    return {
        "signature": c.get("signature"),
        "source_mode": c.get("_mode"),
        "qualified": c.get("qualified"),
        "face_count": c.get("N") or metrics.get("faceCount"),
        "coverage_pct": (float(c.get("coverageRatio") or metrics.get("coverageRatio") or 0) * 100.0),
        "efficiency_score": c.get("efficiencyScore") or metrics.get("efficiencyScore"),
        "recovery_score": c.get("recoveryScore") or metrics.get("recoveryScore"),
    }


# Load case data and candidate pool (same as original script)
case_file = [p for p in CASE_DIR.iterdir() if p.name.startswith("3-") and p.suffix == ".json"][0]
print(f"Case file: {case_file}")
case_data = json.loads(case_file.read_text(encoding="utf-8"))
pr = case_data["planningResults"]

candidate_pool = []
seen = set()
for mode in ["efficiency", "recovery", "disturbance"]:
    for cand in pr[mode]["result"].get("candidates") or []:
        sig = cand.get("signature")
        if not sig or sig in seen:
            continue
        seen.add(sig)
        c = dict(cand)
        c["_mode"] = mode
        candidate_pool.append(c)

target_a = "x|wb=50.0000|ws=30.0000|N=5|B=308.0000"
target_b = "y|wb=50.0000|ws=30.0000|N=9|B=335.0000|theta=0.0"

params_base = SmartWeightedDisturbanceParams(
    sampleStepM=25, maxSamples=4500, exceedThreshold=0.7,
    wMean=0.5, wP90=0.35, wExceed=0.15, outerBufferM=30
)

# First run baseline to find C
baseline_weights = {"wd": 0.45, "wo": 0.30, "wf": 0.25}
baseline_pack = build_pack(baseline_weights)
baseline_result = _compute_disturbance_for_candidates(
    candidate_pool, ThicknessFieldPack.model_validate(baseline_pack), params_base
)
qualified = [c for c in candidate_pool if c.get("qualified") is True and c.get("signature") in baseline_result]
best_risk = min(qualified, key=lambda c: risk_score(baseline_result[c["signature"]]))
target_c = best_risk["signature"]
targets = [
    ("A", "效率优先方案", next(c for c in candidate_pool if c.get("signature") == target_a)),
    ("B", "资源回收优先方案", next(c for c in candidate_pool if c.get("signature") == target_b)),
    ("C", "低扰动优先方案", best_risk),
]

# Compute for custom weight scenarios
weight_cases = [
    ("S1", "上行开采优先 0.25/0.25/0.50", {"wd": 0.25, "wo": 0.25, "wf": 0.50}),
    ("S3", "含水层专项/上行开采 0.15/0.25/0.60", {"wd": 0.15, "wo": 0.25, "wf": 0.60}),
]

print()
for case_id, desc, weights in weight_cases:
    print(f"=== {case_id}: {desc} ===")
    pack = build_pack(weights)
    fs = field_stats(pack)
    print(f"  Field: n={fs['n']}, mean={fs['mean']:.4f}, P90={fs['p90']:.4f}, >0.70={fs['gt_070']:.2f}%")

    result = _compute_disturbance_for_candidates(
        [cand for _, _, cand in targets], ThicknessFieldPack.model_validate(pack), params_base
    )

    best_code = None
    best_risk_val = float("inf")
    for code, label, cand in targets:
        st = result[cand["signature"]]
        cs = candidate_summary(cand)
        rs = risk_score(st)
        print(f"  {code} ({label}):")
        print(f"    Coverage: {cs['coverage_pct']:.2f}%")
        print(f"    ODI mean: {st['mean']:.4f}")
        print(f"    ODI P90:  {st['p90']:.4f}")
        print(f"    ODI>0.70: {st['exceedRatio']*100:.2f}%")
        print(f"    Risk score: {rs:.4f}")
        if rs < best_risk_val:
            best_risk_val = rs
            best_code = code
    print(f"  => Best: {best_code} (risk={best_risk_val:.4f})")
    print()

# Save results
results = []
for case_id, desc, weights in weight_cases:
    pack = build_pack(weights)
    result = _compute_disturbance_for_candidates(
        [cand for _, _, cand in targets], ThicknessFieldPack.model_validate(pack), params_base
    )
    for code, label, cand in targets:
        st = result[cand["signature"]]
        cs = candidate_summary(cand)
        results.append({
            "case_id": case_id,
            "plan_code": code,
            "plan_name": label,
            "wd": weights["wd"],
            "wo": weights["wo"],
            "wf": weights["wf"],
            "coverage_pct": cs["coverage_pct"],
            "odi_mean": st["mean"],
            "odi_p90": st["p90"],
            "odi_gt_070_pct": st["exceedRatio"] * 100,
            "sample_count": st["sampleCount"],
            "risk_score": risk_score(st),
        })

out_csv = OUT_DIR / "custom_weight_odi_results.csv"
with out_csv.open("w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=list(results[0].keys()))
    writer.writeheader()
    writer.writerows(results)
print(f"Results saved to: {out_csv}")
