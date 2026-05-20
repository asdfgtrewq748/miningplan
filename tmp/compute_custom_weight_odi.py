"""Compute scheme-level ODI statistics for custom weight combinations S1 and S3.

Uses the 32 aquifer ODI evaluation points (with per-point wd/wo/wf component
values) to recompute ODI for arbitrary weight vectors, then samples the IDW
field within each candidate's layout boundary.
"""

import json
import math
import sys
from pathlib import Path

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union
from shapely.prepared import prep


CASE_PATH = Path("d:/xiangmu/miningplan/软件案例附件/工程文件案例/3-采区规划案例.miningplan.json")

# Target weight scenarios
WEIGHT_SCENARIOS = {
    "S1": {"wd": 0.25, "wo": 0.25, "wf": 0.50},
    "S3": {"wd": 0.15, "wo": 0.25, "wf": 0.60},
}

# Candidate signatures (from coal_sci_weight_sensitivity_candidates_20260418.csv)
TARGETS = [
    ("A", "效率优先方案", "x|wb=50.0000|ws=30.0000|N=5|B=308.0000"),
    ("B", "资源回收优先方案", "y|wb=50.0000|ws=30.0000|N=9|B=335.0000|theta=0.0"),
    ("C", "低扰动优先方案", "x|wb=50.0000|ws=30.0000|N=4|B=350.0000"),
]


def load_case_data():
    with open(CASE_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_component_points(data):
    """Load aquifer ODI points with raw wd/wo/wf component values."""
    pts = data["scenarioParamsById"]["aquifer"]["odiResult"]["points"]
    out = []
    for p in pts:
        try:
            out.append({
                "x": float(p["x"]),
                "y": float(p["y"]),
                "wd_val": float(p["wd"]),
                "wo_val": float(p["wo"]),
                "wf_val": float(p["wf"]),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return out


def loop_to_poly(loop):
    pts = []
    if isinstance(loop, dict) and "loop" in loop:
        loop = loop["loop"]
    for pt in loop or []:
        if isinstance(pt, dict):
            x = pt.get("x")
            y = pt.get("y")
        else:
            x = pt[0] if len(pt) > 0 else None
            y = pt[1] if len(pt) > 1 else None
        if x is not None and y is not None:
            pts.append((float(x), float(y)))
    if len(pts) < 3:
        return None
    poly = Polygon(pts)
    if not poly.is_valid:
        poly = poly.buffer(0)
    return poly if poly and not poly.is_empty and poly.area > 0 else None


def candidate_geom(c):
    r = c.get("render") if isinstance(c.get("render"), dict) else {}
    loops = None
    for k in ["clippedFacesLoops", "plannedWorkfaceLoopsWorld", "facesLoops",
              "plannedUnionLoopsWorld", "unionLoops"]:
        if isinstance(r.get(k), list) and r.get(k):
            loops = r[k]
            break
    if loops is None and isinstance(c.get("plannedWorkfaceLoopsWorld"), list):
        loops = c["plannedWorkfaceLoopsWorld"]
    polys = [loop_to_poly(loop) for loop in (loops or [])]
    polys = [p for p in polys if p is not None]
    if not polys:
        return None
    return unary_union(polys)


def find_candidates(data):
    """Find candidate schemes by signature."""
    pr = data["planningResults"]
    found = {}
    for mode in ["efficiency", "recovery", "disturbance"]:
        for cand in pr[mode]["result"].get("candidates") or []:
            sig = cand.get("signature")
            if sig and sig not in found:
                found[sig] = cand
    return found


def compute_odi_for_points(points, weights):
    """Compute ODI for each point using new weights."""
    wd_w, wo_w, wf_w = weights["wd"], weights["wo"], weights["wf"]
    result = []
    for pt in points:
        odi = wd_w * pt["wd_val"] + wo_w * pt["wo_val"] + wf_w * pt["wf_val"]
        result.append((pt["x"], pt["y"], odi))
    return result


def normalize(values):
    """Min-max normalize to [0, 1]."""
    mn = min(values)
    mx = max(values)
    rng = mx - mn
    if rng < 1e-12:
        return [0.5] * len(values)
    return [(v - mn) / rng for v in values]


def idw(x, y, samples, power=2.0):
    num = 0.0
    den = 0.0
    for sx, sy, v in samples:
        d = math.hypot(x - sx, y - sy)
        if d < 1e-9:
            return v
        w = 1.0 / (d ** power)
        num += w * v
        den += w
    return num / den if den else None


def stats_for_candidate(cand, samples, step=25.0, outer=30.0,
                         threshold=0.70, max_samples=4500):
    """Compute ODI statistics for a candidate scheme."""
    geom = candidate_geom(cand)
    if geom is None:
        return None
    if outer > 0:
        geom = geom.buffer(outer)
    minx, miny, maxx, maxy = geom.bounds
    pg = prep(geom)
    vals = []
    x = minx
    while x <= maxx + 1e-9 and len(vals) < max_samples:
        y = miny
        while y <= maxy + 1e-9 and len(vals) < max_samples:
            if pg.contains(Point(x, y)):
                v = idw(x, y, samples)
                if v is not None and math.isfinite(v):
                    vals.append(float(v))
            y += step
        x += step
    if not vals:
        return None
    vals.sort()
    mean = sum(vals) / len(vals)
    pos = (len(vals) - 1) * 0.90
    lo = int(math.floor(pos))
    hi = min(len(vals) - 1, lo + 1)
    t = pos - lo
    p90 = vals[lo] * (1 - t) + vals[hi] * t
    exc70 = sum(v >= threshold for v in vals) / len(vals) * 100
    risk = 0.5 * mean + 0.35 * p90 + 0.15 * (exc70 / 100.0)
    return {
        "mean": mean,
        "p90": p90,
        "gt_070_pct": exc70,
        "sample_count": len(vals),
        "risk_score": risk,
    }


def get_coverage(cand):
    """Extract coverage ratio from candidate metrics."""
    metrics = cand.get("metrics") if isinstance(cand.get("metrics"), dict) else {}
    cr = cand.get("coverageRatio") or metrics.get("coverageRatio") or 0
    return float(cr) * 100.0


def main():
    print("Loading case data...")
    data = load_case_data()
    pts = load_component_points(data)
    print(f"Loaded {len(pts)} component points")

    candidates = find_candidates(data)
    print(f"Found {len(candidates)} candidates")

    # Find target candidates
    target_cands = []
    for code, name, sig in TARGETS:
        cand = candidates.get(sig)
        if cand:
            coverage = get_coverage(cand)
            target_cands.append((code, name, sig, cand, coverage))
            print(f"  {code} ({name}): coverage={coverage:.2f}%")
        else:
            print(f"  {code}: NOT FOUND (sig={sig[:50]}...)")

    print()

    for scenario_name, weights in WEIGHT_SCENARIOS.items():
        print(f"=== {scenario_name}: wd={weights['wd']}, wo={weights['wo']}, wf={weights['wf']} ===")

        # Compute ODI at each evaluation point
        raw = compute_odi_for_points(pts, weights)
        odi_vals = [v for _, _, v in raw]
        norms = normalize(odi_vals)
        samples = [(x, y, n) for (x, y, _), n in zip(raw, norms)]

        # Compute statistics for each candidate
        best_risk = float("inf")
        best_code = None
        for code, name, sig, cand, coverage in target_cands:
            st = stats_for_candidate(cand, samples)
            if st is None:
                print(f"  {code} ({name}): FAILED")
                continue
            print(f"  {code} ({name}):")
            print(f"    Coverage: {coverage:.2f}%")
            print(f"    ODI mean: {st['mean']:.4f}")
            print(f"    ODI P90:  {st['p90']:.4f}")
            print(f"    ODI>0.70: {st['gt_070_pct']:.2f}%")
            print(f"    Risk score: {st['risk_score']:.4f}")
            print(f"    Samples: {st['sample_count']}")
            if st["risk_score"] < best_risk:
                best_risk = st["risk_score"]
                best_code = code

        print(f"  => Recommended: {best_code} (lowest risk={best_risk:.4f})")
        print()

    # Verification: compute aquifer_special (S3) and compare with known values
    print("=== Verification: aquifer_special (should match pre-computed values) ===")
    weights = {"wd": 0.15, "wo": 0.25, "wf": 0.60}
    raw = compute_odi_for_points(pts, weights)
    odi_vals = [v for _, _, v in raw]
    norms = normalize(odi_vals)
    samples = [(x, y, n) for (x, y, _), n in zip(raw, norms)]

    known = {
        "A": (0.4445, 0.6470, 1.20),
        "B": (0.4526, 0.6496, 1.82),
        "C": (0.4424, 0.6402, 3.02),
    }
    for code, name, sig, cand, coverage in target_cands:
        st = stats_for_candidate(cand, samples)
        if st:
            k = known.get(code, (0, 0, 0))
            print(f"  {code}: computed mean={st['mean']:.4f} (known={k[0]:.4f}), "
                  f"P90={st['p90']:.4f} (known={k[1]:.4f}), "
                  f">0.70={st['gt_070_pct']:.2f}% (known={k[2]:.2f}%)")


if __name__ == "__main__":
    main()
