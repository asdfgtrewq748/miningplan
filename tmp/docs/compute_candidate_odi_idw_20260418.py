import json
import math
import os
from pathlib import Path

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union
from shapely.prepared import prep


case_dir = Path(os.environ["CASE_DIR"])
out_csv = Path(os.environ.get("OUT_CSV", "docs/plans/coal_sci_abc_candidate_odi_idw_20260418.csv"))
case_file = [p for p in case_dir.iterdir() if p.name.startswith("3-") and p.suffix == ".json"][0]
data = json.loads(case_file.read_text(encoding="utf-8"))

points = data["scenarioParamsById"]["aquifer"]["odiResult"]["points"]
samples = [(float(p["x"]), float(p["y"]), float(p["odiNorm"])) for p in points if p.get("x") is not None and p.get("y") is not None and p.get("odiNorm") is not None]


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
    for k in ["clippedFacesLoops", "plannedWorkfaceLoopsWorld", "facesLoops", "plannedUnionLoopsWorld", "unionLoops"]:
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


def idw(x, y, power=2.0):
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


def stats_for(c, step=25.0, outer=30.0, threshold=0.70, max_samples=4500):
    geom = candidate_geom(c)
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
                v = idw(x, y)
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
    exc80 = sum(v >= 0.80 for v in vals) / len(vals) * 100
    return mean, p90, exc70, exc80, len(vals)


pr = data["planningResults"]
targets = [
    ("A", "efficiency", "x|wb=50.0000|ws=30.0000|N=5|B=308.0000"),
    ("B", "recovery", "y|wb=50.0000|ws=30.0000|N=9|B=335.0000|theta=0.0"),
    ("C", "disturbance", "x|wb=80.0000|ws=30-30|N=13|B=100-100|h=f2a5a1b8"),
]

rows = ["plan_code,source_mode,signature,odi_mean_idw,odi_p90_idw,odi_gt_070_pct_idw,odi_gt_080_pct_idw,sample_count,method_note"]
for code, mode, sig in targets:
    cands = pr[mode]["result"].get("candidates") or []
    cand = next((c for c in cands if c.get("signature") == sig), None)
    st = stats_for(cand) if cand else None
    if st:
        rows.append(f"{code},{mode},{sig},{st[0]:.6f},{st[1]:.6f},{st[2]:.4f},{st[3]:.4f},{st[4]},IDW over 32 aquifer ODI points; step=25m; outerBuffer=30m")
    else:
        rows.append(f"{code},{mode},{sig},,,,,,IDW failed")

out_csv.parent.mkdir(parents=True, exist_ok=True)
out_csv.write_text("\n".join(rows) + "\n", encoding="utf-8")
print(out_csv.resolve())
