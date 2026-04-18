import csv
import importlib.util
import json
import math
import os
import sys
from pathlib import Path


ROOT = Path.cwd()
CASE_DIR = Path(os.environ["CASE_DIR"])
GEN_SCRIPT = Path(os.environ["GEN_SCRIPT"])
OUT_DIR = Path(os.environ.get("OUT_DIR", "docs/plans"))
OUT_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str((ROOT / "mining-plan" / "backend_python").resolve()))
from routers.planning import (  # noqa: E402
    SmartWeightedDisturbanceParams,
    ThicknessFieldPack,
    _compute_disturbance_for_candidates,
)


spec = importlib.util.spec_from_file_location("paper_fig", GEN_SCRIPT)
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
        samples = paper_fig.build_borehole_param_samples(coords_by_id, layers_by_id, paper_fig.TARGET_SEAM, paper_fig.ODI_SCENARIO)
        contour_data = {
            "Ti": paper_fig.compute_field(samples["Ti"]),
            "Ei": paper_fig.compute_field(samples["Ei"]),
            "Hi": paper_fig.compute_field(samples["Hi"]),
            "Di": paper_fig.compute_field(samples["Di"]),
            "Mi": paper_fig.compute_field(samples["Mi"]),
        }
        coal_thickness_field = paper_fig.compute_field(samples["CoalThk"])
        drillhole_points = [{"id": bh_id, "x": coord[0], "y": coord[1]} for bh_id, coord in sorted(coords_by_id.items())]
        geology_extract = paper_fig.extract_geology_interpolated_params(drillhole_points, boundary_world, contour_data, coal_thickness_field)
        pack, odi_result = paper_fig.build_layout_odi_pack(boundary_world, drillhole_points, geology_extract["points"])
        pack["stats"] = {
            "weights": weights,
            "kept_factor_keys": odi_result.get("keptFactorKeys"),
            "odi_min": odi_result.get("minOdi"),
            "odi_max": odi_result.get("maxOdi"),
        }
        return pack
    finally:
        paper_fig.SCENARIO_WEIGHTS = old


def normalize(weights):
    s = sum(float(v) for v in weights.values())
    return {k: float(v) / s for k, v in weights.items()}


def perturb(base, key, factor):
    w = dict(base)
    w[key] *= factor
    return normalize(w)


case_file = [p for p in CASE_DIR.iterdir() if p.name.startswith("3-") and p.suffix == ".json"][0]
case_data = json.loads(case_file.read_text(encoding="utf-8"))
pr = case_data["planningResults"]

base_weights = {"wd": 0.45, "wo": 0.30, "wf": 0.25}
weight_cases = [
    ("baseline", "0.45/0.30/0.25", base_weights),
    ("wd_plus10pct", "surface +10% relative, renormalized", perturb(base_weights, "wd", 1.10)),
    ("wd_minus10pct", "surface -10% relative, renormalized", perturb(base_weights, "wd", 0.90)),
    ("wo_plus10pct", "aquifer +10% relative, renormalized", perturb(base_weights, "wo", 1.10)),
    ("wo_minus10pct", "aquifer -10% relative, renormalized", perturb(base_weights, "wo", 0.90)),
    ("wf_plus10pct", "upward +10% relative, renormalized", perturb(base_weights, "wf", 1.10)),
    ("wf_minus10pct", "upward -10% relative, renormalized", perturb(base_weights, "wf", 0.90)),
    ("aquifer_special", "0.15/0.25/0.60", {"wd": 0.15, "wo": 0.25, "wf": 0.60}),
]

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


params_base = SmartWeightedDisturbanceParams(sampleStepM=25, maxSamples=4500, exceedThreshold=0.7, wMean=0.5, wP90=0.35, wExceed=0.15, outerBufferM=30)
baseline_pack = build_pack(base_weights)
baseline_result = _compute_disturbance_for_candidates(candidate_pool, ThicknessFieldPack.model_validate(baseline_pack), params_base)

def risk_score(st):
    return float(st["mean"]) * 0.5 + float(st["p90"]) * 0.35 + float(st["exceedRatio"]) * 0.15

qualified = [c for c in candidate_pool if c.get("qualified") is True and c.get("signature") in baseline_result]
best_risk = min(qualified, key=lambda c: risk_score(baseline_result[c["signature"]]))
target_c = best_risk["signature"]
target_old_c = "x|wb=80.0000|ws=30-30|N=13|B=100-100|h=f2a5a1b8"
targets = [
    ("A", "efficiency top1", next(c for c in candidate_pool if c.get("signature") == target_a)),
    ("B", "recovery top1", next(c for c in candidate_pool if c.get("signature") == target_b)),
    ("C", "unified ODI minimum qualified candidate", best_risk),
    ("C_old", "previous disturbance saved best", next(c for c in candidate_pool if c.get("signature") == target_old_c)),
]

thresholds = [0.65, 0.70, 0.75, 0.80]

# Unified baseline candidate stats
baseline_rows = []
for code, label, cand in targets:
    st = baseline_result.get(cand["signature"])
    cs = candidate_summary(cand)
    baseline_rows.append({
        "plan_code": code,
        "plan_name": label,
        **cs,
        "odi_mean": st["mean"],
        "odi_p90": st["p90"],
        "odi_gt_070_pct": st["exceedRatio"] * 100,
        "sample_count": st["sampleCount"],
        "risk_score": risk_score(st),
    })

with (OUT_DIR / "coal_sci_abc_odi_unified_stats_20260418.csv").open("w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=list(baseline_rows[0].keys()))
    writer.writeheader()
    writer.writerows(baseline_rows)

# Field and candidate weight sensitivity
field_rows = []
candidate_weight_rows = []
for case_id, desc, weights in weight_cases:
    pack = build_pack(weights)
    fs = field_stats(pack)
    field_rows.append({
        "case_id": case_id,
        "description": desc,
        "wd": weights["wd"],
        "wo": weights["wo"],
        "wf": weights["wf"],
        **fs,
    })
    result = _compute_disturbance_for_candidates([cand for _, _, cand in targets[:3]], ThicknessFieldPack.model_validate(pack), params_base)
    for code, label, cand in targets[:3]:
        st = result[cand["signature"]]
        candidate_weight_rows.append({
            "case_id": case_id,
            "plan_code": code,
            "plan_name": label,
            "signature": cand["signature"],
            "wd": weights["wd"],
            "wo": weights["wo"],
            "wf": weights["wf"],
            "odi_mean": st["mean"],
            "odi_p90": st["p90"],
            "odi_gt_070_pct": st["exceedRatio"] * 100,
            "sample_count": st["sampleCount"],
            "risk_score": risk_score(st),
        })

with (OUT_DIR / "coal_sci_weight_sensitivity_field_20260418.csv").open("w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=list(field_rows[0].keys()))
    writer.writeheader()
    writer.writerows(field_rows)

with (OUT_DIR / "coal_sci_weight_sensitivity_candidates_20260418.csv").open("w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=list(candidate_weight_rows[0].keys()))
    writer.writeheader()
    writer.writerows(candidate_weight_rows)

# Threshold sensitivity on baseline field
threshold_rows = []
for thr in thresholds:
    params = SmartWeightedDisturbanceParams(sampleStepM=25, maxSamples=4500, exceedThreshold=thr, wMean=0.5, wP90=0.35, wExceed=0.15, outerBufferM=30)
    result = _compute_disturbance_for_candidates([cand for _, _, cand in targets[:3]], ThicknessFieldPack.model_validate(baseline_pack), params)
    for code, label, cand in targets[:3]:
        st = result[cand["signature"]]
        threshold_rows.append({
            "threshold": thr,
            "plan_code": code,
            "plan_name": label,
            "signature": cand["signature"],
            "odi_mean": st["mean"],
            "odi_p90": st["p90"],
            "exceed_pct": st["exceedRatio"] * 100,
            "sample_count": st["sampleCount"],
            "risk_score": risk_score(st),
        })

with (OUT_DIR / "coal_sci_threshold_sensitivity_candidates_20260418.csv").open("w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=list(threshold_rows[0].keys()))
    writer.writeheader()
    writer.writerows(threshold_rows)

# Markdown summary
def fmt(x, n=4):
    return f"{float(x):.{n}f}"

summary = []
summary.append("# ODI统一口径对比与敏感性分析结果\n")
summary.append("日期：2026-04-18\n")
summary.append("## 1. 全域ODI场复核\n")
fs = field_stats(baseline_pack)
summary.append(f"- ODI field pack：`论文/重构工作区/05_支撑材料/接口结果/000_mindong_layout_odi_field.json`\n")
summary.append(f"- 栅格：80×56，共 {fs['n']} 个栅格。\n")
summary.append(f"- 均值 {fmt(fs['mean'])}，中位数 {fmt(fs['median'])}，P90 {fmt(fs['p90'])}，ODI>0.70 为 {fmt(fs['gt_070'],2)}%，ODI>0.80 为 {fmt(fs['gt_080'],2)}%。\n")
summary.append("\n## 2. A/B/C统一ODI统计\n\n")
summary.append("| 方案 | 含义 | 合格性 | 覆盖率/% | 工程效率 | 资源回收 | ODI均值 | P90 | ODI>0.70/% | 采样数 |\n")
summary.append("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|\n")
for row in baseline_rows[:3]:
    summary.append(
        f"| {row['plan_code']} | {row['plan_name']} | {row['qualified']} | {fmt(row['coverage_pct'],2)} | "
        f"{'' if row['efficiency_score'] is None else fmt(row['efficiency_score'],2)} | "
        f"{'' if row['recovery_score'] is None else fmt(row['recovery_score'],2)} | "
        f"{fmt(row['odi_mean'])} | {fmt(row['odi_p90'])} | {fmt(row['odi_gt_070_pct'],2)} | {row['sample_count']} |\n"
    )
summary.append("\n说明：C为在已保存候选池中按统一ODI场重新筛选得到的合格最低风险候选，不再沿用旧disturbance保存结果中的C_old。\n")
summary.append("\n## 3. 阈值敏感性\n\n")
summary.append("| 阈值 | A超限/% | B超限/% | C超限/% |\n|---:|---:|---:|---:|\n")
for thr in thresholds:
    sub = [r for r in threshold_rows if abs(r["threshold"] - thr) < 1e-9]
    vals = {r["plan_code"]: r["exceed_pct"] for r in sub}
    summary.append(f"| {thr:.2f} | {fmt(vals['A'],2)} | {fmt(vals['B'],2)} | {fmt(vals['C'],2)} |\n")
summary.append("\n## 4. 权重敏感性\n\n")
summary.append("| 权重情景 | wd | wo | wf | A风险得分 | B风险得分 | C风险得分 | 排序 |\n|---|---:|---:|---:|---:|---:|---:|---|\n")
for case_id, desc, weights in weight_cases:
    sub = [r for r in candidate_weight_rows if r["case_id"] == case_id]
    scores = {r["plan_code"]: r["risk_score"] for r in sub}
    order = ">".join([x[0] for x in sorted(scores.items(), key=lambda kv: kv[1])])
    summary.append(f"| {case_id} | {weights['wd']:.4f} | {weights['wo']:.4f} | {weights['wf']:.4f} | {fmt(scores['A'])} | {fmt(scores['B'])} | {fmt(scores['C'])} | {order} |\n")
summary.append("\n风险得分按 `0.50×均值 + 0.35×P90 + 0.15×超限比例` 计算，数值越小表示风险暴露越低。\n")

(OUT_DIR / "coal_sci_odi_sensitivity_summary_20260418.md").write_text("".join(summary), encoding="utf-8")

print("WROTE")
for p in [
    OUT_DIR / "coal_sci_abc_odi_unified_stats_20260418.csv",
    OUT_DIR / "coal_sci_weight_sensitivity_field_20260418.csv",
    OUT_DIR / "coal_sci_weight_sensitivity_candidates_20260418.csv",
    OUT_DIR / "coal_sci_threshold_sensitivity_candidates_20260418.csv",
    OUT_DIR / "coal_sci_odi_sensitivity_summary_20260418.md",
]:
    print(p.resolve())
print("C_selected", target_c)
