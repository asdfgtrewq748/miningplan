from __future__ import annotations

import math
import hashlib
import time
from typing import Any, Dict, List, Literal, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor
import threading
import copy

import json
import os
import subprocess
from pathlib import Path

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field, ConfigDict
from shapely.geometry import GeometryCollection, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.prepared import prep

router = APIRouter()


# Reuse a small thread pool to parallelize independent Node harness calls
# within a single request (eff/recovery/disturbance). This reduces wall-clock
# latency without changing deterministic outputs.
_NODE_EXECUTOR = ThreadPoolExecutor(max_workers=3)

# Cache Node harness outputs to avoid re-running identical payloads across requests.
# Keyed by a stable hash of the full payload to guarantee correctness.
_NODE_RESULT_CACHE: Dict[str, Dict[str, Any]] = {}
_NODE_RESULT_CACHE_MAX = 16
_NODE_RESULT_CACHE_LOCK = threading.Lock()


def _stable_payload_hash(payload: Dict[str, Any]) -> str:
    try:
        s = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    except Exception:
        s = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(s.encode('utf-8', errors='ignore')).hexdigest()


def _node_cache_get(key: str) -> Optional[Dict[str, Any]]:
    k = str(key or '')
    if not k:
        return None
    with _NODE_RESULT_CACHE_LOCK:
        it = _NODE_RESULT_CACHE.get(k)
        if not isinstance(it, dict):
            return None
        val = it.get('value')
        if not isinstance(val, dict):
            return None
        # refresh ts (LRU-ish)
        it['_ts'] = time.time()
        # defensive copy: downstream may add fields; keep cache immutable
        return copy.deepcopy(val)


def _node_cache_put(key: str, value: Dict[str, Any]) -> None:
    k = str(key or '')
    if not k or not isinstance(value, dict):
        return
    with _NODE_RESULT_CACHE_LOCK:
        try:
            if len(_NODE_RESULT_CACHE) >= _NODE_RESULT_CACHE_MAX:
                items = list(_NODE_RESULT_CACHE.items())
                items.sort(key=lambda kv: float(kv[1].get('_ts', 0.0)))
                for kk, _ in items[: max(1, len(items) - _NODE_RESULT_CACHE_MAX + 1)]:
                    _NODE_RESULT_CACHE.pop(kk, None)
            _NODE_RESULT_CACHE[k] = {'_ts': time.time(), 'value': copy.deepcopy(value)}
        except Exception:
            return


# -----------------------------
# Weighted backend cache (in-memory)
# -----------------------------


_WEIGHTED_CACHE: Dict[str, Dict[str, Any]] = {}
_WEIGHTED_CACHE_MAX = 32


def _cache_get(cache_key: str) -> Optional[Dict[str, Any]]:
    k = str(cache_key or '')
    if not k:
        return None
    it = _WEIGHTED_CACHE.get(k)
    if not isinstance(it, dict):
        return None
    return it


def _cache_put(cache_key: str, value: Dict[str, Any]) -> None:
    k = str(cache_key or '')
    if not k:
        return
    try:
        if len(_WEIGHTED_CACHE) >= _WEIGHTED_CACHE_MAX:
            # naive eviction: drop oldest by ts
            items = list(_WEIGHTED_CACHE.items())
            items.sort(key=lambda kv: float(kv[1].get('_ts', 0.0)))
            for kk, _ in items[: max(1, len(items) - _WEIGHTED_CACHE_MAX + 1)]:
                _WEIGHTED_CACHE.pop(kk, None)
        value['_ts'] = time.time()
        _WEIGHTED_CACHE[k] = value
    except Exception:
        # ignore cache errors
        return


# -----------------------------
# Models (keep permissive)
# -----------------------------


class ThicknessFieldPack(BaseModel):
    # field[j][i]
    field: Optional[List[List[float]]] = None
    gridW: Optional[int] = None
    gridH: Optional[int] = None
    width: Optional[float] = 320
    height: Optional[float] = 220
    bounds: Optional[Dict[str, Any]] = None
    pad: Optional[float] = None


class ThicknessPayload(BaseModel):
    fieldPack: Optional[ThicknessFieldPack] = None
    constantM: Optional[float] = None
    rho: Optional[float] = None
    gridRes: Optional[float] = None


class SmartResourceCandidateIn(BaseModel):
    signature: str
    qualified: Optional[bool] = None
    coverageRatio: Optional[float] = None
    coverageRatioEff: Optional[float] = None
    N: Optional[int] = None
    lenCV: Optional[float] = None

    # engineering signals (optional)
    abnormalFaceCount: Optional[int] = None
    BMin: Optional[float] = None
    BMax: Optional[float] = None

    axis: Optional[str] = None
    thetaDeg: Optional[float] = None
    ws: Optional[float] = None

    render: Optional[Dict[str, Any]] = None


class SmartResourceTonnageRequest(BaseModel):
    cacheKey: str = ''
    candidates: List[SmartResourceCandidateIn] = Field(default_factory=list)
    thickness: Optional[ThicknessPayload] = None

    # efficiency/disturbance display-only: optionally compute tonnage on a "patched" mining shape
    # (approximate cleanupResidual behavior) to make cross-mode tonnage comparable.
    preferPatched: Optional[bool] = False
    # If provided (non-empty), patch only these candidate signatures.
    preferPatchedSignatures: Optional[List[str]] = None
    cleanupResidual: Optional[Dict[str, Any]] = None

    # optional knobs
    topK: Optional[int] = 10
    sampleStepM: Optional[float] = None

    # scoring knobs (optional)
    wTonnage: Optional[float] = None
    wCoverage: Optional[float] = None
    wEngineering: Optional[float] = None
    fullCoverMin: Optional[float] = None
    fullCoverPenaltyFloor: Optional[float] = None

    # diagnostics (optional)
    debug: Optional[bool] = False
    debugSignatures: Optional[List[str]] = None


class SmartResourceTonnageResponse(BaseModel):
    ok: bool
    cacheKey: str
    hasThickness: bool
    fallbackMode: str
    elapsedMs: float

    rankedSignatures: List[str] = Field(default_factory=list)
    tonnageBySignature: Dict[str, float] = Field(default_factory=dict)
    recoveryScoreBySignature: Dict[str, float] = Field(default_factory=dict)

    # diagnostics
    tMin: float = 0
    tMax: float = 0
    method: str = 'grid-sampling'
    warnings: List[str] = Field(default_factory=list)

    # optional debug payload (ignored by frontend unless used)
    debugInfo: Optional[Dict[str, Any]] = None


class SmartWeightedWeights(BaseModel):
    efficiency: Optional[float] = 0.0
    recovery: Optional[float] = 0.0
    disturbance: Optional[float] = 0.0


class SmartWeightedDisturbanceParams(BaseModel):
    sampleStepM: Optional[float] = 25
    maxSamples: Optional[int] = 4500
    exceedThreshold: Optional[float] = 0.7
    wMean: Optional[float] = 0.50
    wP90: Optional[float] = 0.35
    wExceed: Optional[float] = 0.15
    outerBufferM: Optional[float] = 30


class SmartWeightedComputeRequest(BaseModel):
    model_config = ConfigDict(extra='allow')

    reqSeq: Optional[int] = None
    cacheKey: Optional[str] = None
    mode: Optional[str] = 'smart-weighted'

    # Optional: pass through per-mode cache keys so weighted can:
    # - keep deterministic seeds aligned with existing modes (strict equivalence when a single weight = 1)
    # - still use `cacheKey` as the weighted-output cache key
    effCacheKey: Optional[str] = None
    recCacheKey: Optional[str] = None
    distCacheKey: Optional[str] = None

    boundaryLoopWorld: Any = None
    axis: Optional[str] = None

    # knobs
    fast: Optional[bool] = False
    searchProfile: Optional[str] = None
    boundaryPillarMin: Optional[float] = None
    boundaryPillarMax: Optional[float] = None
    coalPillarMin: Optional[float] = None
    coalPillarMax: Optional[float] = None
    coalPillarTarget: Optional[float] = None
    faceWidthMin: Optional[float] = None
    faceWidthMax: Optional[float] = None
    faceAdvanceMax: Optional[float] = None

    topK: Optional[int] = 60

    weights: Optional[SmartWeightedWeights] = None
    odiFieldPack: Optional[ThicknessFieldPack] = None
    disturbanceParams: Optional[SmartWeightedDisturbanceParams] = None

    # passthrough for worker
    input: Optional[Dict[str, Any]] = None


def _norm_weights_2(a: float, b: float) -> Tuple[float, float]:
    aa = max(0.0, float(a or 0.0))
    bb = max(0.0, float(b or 0.0))
    s = aa + bb
    if s <= 1e-12:
        return 0.5, 0.5
    return aa / s, bb / s


def _norm_weights_3(a: float, b: float, c: float) -> Tuple[float, float, float]:
    aa = max(0.0, float(a or 0.0))
    bb = max(0.0, float(b or 0.0))
    cc = max(0.0, float(c or 0.0))
    s = aa + bb + cc
    if s <= 1e-12:
        return 1 / 3, 1 / 3, 1 / 3
    return aa / s, bb / s, cc / s


def _clamp01(x: float) -> float:
    try:
        v = float(x)
    except Exception:
        return 0.0
    if not math.isfinite(v):
        return 0.0
    return max(0.0, min(1.0, v))


def _minmax(values: List[Optional[float]]) -> Tuple[float, float]:
    a = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    if not a:
        return 0.0, 1.0
    mn = min(a)
    mx = max(a)
    if not (mx > mn):
        return mn, mn + 1.0
    return mn, mx


def _norm_minmax(v: Optional[float], mn: float, mx: float) -> float:
    if v is None:
        return 0.0
    x = float(v)
    if not math.isfinite(x):
        return 0.0
    den = (mx - mn) if (mx - mn) != 0 else 1.0
    return _clamp01((x - mn) / den)


def _quantile(values: List[float], q: float) -> Optional[float]:
    a = [float(v) for v in values if math.isfinite(float(v))]
    if not a:
        return None
    a.sort()
    qq = max(0.0, min(1.0, float(q)))
    pos = (len(a) - 1) * qq
    lo = int(math.floor(pos))
    hi = min(len(a) - 1, lo + 1)
    t = pos - lo
    v = a[lo] * (1 - t) + a[hi] * t
    return float(v) if math.isfinite(float(v)) else None


def _sample_field_at_world_xy(field_pack: ThicknessFieldPack, world_x: float, world_y: float) -> Optional[float]:
    fp = field_pack
    if not fp or not isinstance(fp.field, list) or not fp.gridW or not fp.gridH:
        return None
    b = fp.bounds or {}
    try:
        min_x = float(b.get('minX'))
        max_x = float(b.get('maxX'))
        min_y = float(b.get('minY'))
        max_y = float(b.get('maxY'))
    except Exception:
        return None
    if not (math.isfinite(min_x) and math.isfinite(max_x) and math.isfinite(min_y) and math.isfinite(max_y)):
        return None
    if not (math.isfinite(float(world_x)) and math.isfinite(float(world_y))):
        return None
    width = float(fp.width or 320)
    height = float(fp.height or 220)
    pad = float(b.get('pad') if b.get('pad') is not None else 14)
    # 与前端 sampleFieldAtWorldXY 对齐：先映射到屏幕坐标再做双线性插值
    sx = pad + ((float(world_x) - min_x) / ((max_x - min_x) or 1.0)) * (width - pad * 2.0)
    sy = pad + (1.0 - (float(world_y) - min_y) / ((max_y - min_y) or 1.0)) * (height - pad * 2.0)

    grid = fp.field
    grid_h = len(grid)
    grid_w = len(grid[0]) if grid_h and isinstance(grid[0], list) else 0
    if grid_w < 2 or grid_h < 2:
        return None

    gx = max(0.0, min(grid_w - 1.0, (sx / width) * (grid_w - 1.0)))
    gy = max(0.0, min(grid_h - 1.0, (sy / height) * (grid_h - 1.0)))
    x0 = int(math.floor(gx))
    y0 = int(math.floor(gy))
    x1 = min(grid_w - 1, x0 + 1)
    y1 = min(grid_h - 1, y0 + 1)
    tx = gx - x0
    ty = gy - y0
    try:
        v00 = float(grid[y0][x0])
        v10 = float(grid[y0][x1])
        v01 = float(grid[y1][x0])
        v11 = float(grid[y1][x1])
    except Exception:
        return None
    if not all(math.isfinite(v) for v in [v00, v10, v01, v11]):
        return None
    v0 = v00 * (1 - tx) + v10 * tx
    v1 = v01 * (1 - tx) + v11 * tx
    v = v0 * (1 - ty) + v1 * ty
    return float(v) if math.isfinite(v) else None


def _loops_to_polygon_union(loops: Any) -> Optional[BaseGeometry]:
    arr = loops if isinstance(loops, list) else []
    polys: List[Polygon] = []
    for loop in arr:
        # Some render payloads wrap loops as { faceIndex, loop: [...] }.
        loop_pts = loop
        if isinstance(loop, dict) and 'loop' in loop:
            loop_pts = loop.get('loop')

        # Keep parsing consistent with other geometry helpers.
        poly = _loop_to_polygon(loop_pts)
        if poly is None or poly.is_empty:
            continue
        try:
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly and not poly.is_empty and poly.area > 0:
                polys.append(orient(poly))
        except Exception:
            continue
    if not polys:
        return None
    try:
        out = unary_union(polys)
        return out if out and not out.is_empty else None
    except Exception:
        return polys[0]


def _candidate_loops_any(c: Dict[str, Any]) -> List[Any]:
    r = c.get('render') if isinstance(c, dict) else None
    if isinstance(r, dict):
        for k in ['clippedFacesLoops', 'plannedWorkfaceLoopsWorld', 'facesLoops', 'plannedUnionLoopsWorld', 'unionLoops']:
            v = r.get(k)
            if isinstance(v, list) and v:
                return v
    v2 = c.get('plannedWorkfaceLoopsWorld') if isinstance(c, dict) else None
    if isinstance(v2, list) and v2:
        return v2
    return []


def _compute_disturbance_for_candidates(
    candidates: List[Dict[str, Any]],
    odi_pack: ThicknessFieldPack,
    params: SmartWeightedDisturbanceParams,
) -> Dict[str, Dict[str, Any]]:
    # returns bySignature: { mean, p90, exceedRatio, score, points, sampleCount }
    out: Dict[str, Dict[str, Any]] = {}
    if not odi_pack or not odi_pack.field or not odi_pack.gridW or not odi_pack.gridH:
        return out

    step = max(1.0, float(params.sampleStepM or 25.0))
    max_samples = max(100, int(params.maxSamples or 4500))
    thr = float(params.exceedThreshold or 0.7)
    w_mean = float(params.wMean or 0.50)
    w_p90 = float(params.wP90 or 0.35)
    w_exc = float(params.wExceed or 0.15)

    raw_scores: List[float] = []
    tmp_raw: Dict[str, float] = {}
    tmp_stats: Dict[str, Dict[str, Any]] = {}

    for c in candidates:
        sig = str(c.get('signature') or '')
        if not sig:
            continue
        loops = _candidate_loops_any(c)
        geom = _loops_to_polygon_union(loops)
        if geom is None or geom.is_empty:
            continue
        try:
            minx, miny, maxx, maxy = geom.bounds
        except Exception:
            continue

        # grid sampling inside polygon
        pg = prep(geom)
        xs: List[float] = []
        ys: List[float] = []
        # keep deterministic order
        x = minx
        while x <= maxx + 1e-9:
            y = miny
            while y <= maxy + 1e-9:
                xs.append(x)
                ys.append(y)
                if len(xs) >= max_samples * 3:
                    break
                y += step
            if len(xs) >= max_samples * 3:
                break
            x += step

        vals: List[float] = []
        for x0, y0 in zip(xs, ys):
            try:
                if not pg.contains(Point(x0, y0)):
                    continue
            except Exception:
                continue
            v = _sample_field_at_world_xy(odi_pack, float(x0), float(y0))
            if v is None or not math.isfinite(float(v)):
                continue
            vals.append(float(v))
            if len(vals) >= max_samples:
                break

        if not vals:
            continue
        vals_sorted = sorted(vals)
        mean = float(sum(vals_sorted) / len(vals_sorted))
        p90 = _quantile(vals_sorted, 0.90)
        p90v = float(p90) if p90 is not None else mean
        exc = float(sum(1 for v in vals_sorted if v >= thr) / len(vals_sorted))
        score = w_mean * mean + w_p90 * p90v + w_exc * exc
        if math.isfinite(score):
            raw_scores.append(score)
            tmp_raw[sig] = score
            tmp_stats[sig] = {
                'mean': mean,
                'p90': p90v,
                'exceedRatio': exc,
                'sampleCount': len(vals_sorted),
            }

    if not raw_scores:
        return out

    lo = _quantile(raw_scores, 0.05)
    hi = _quantile(raw_scores, 0.95)
    best = 95.0
    worst = 60.0
    span = (float(hi) - float(lo)) if (lo is not None and hi is not None) else 0.0

    for sig, score in tmp_raw.items():
        if span > 1e-12 and lo is not None and hi is not None:
            t = _clamp01((score - float(lo)) / span)
            points = best - t * (best - worst)
        else:
            points = best
        st = tmp_stats.get(sig) or {}
        out[sig] = {
            'mean': st.get('mean'),
            'p90': st.get('p90'),
            'exceedRatio': st.get('exceedRatio'),
            'sampleCount': st.get('sampleCount'),
            'score': score,
            'points': max(0.0, min(100.0, float(points))),
            'calib': {'lo': lo, 'hi': hi, 'best': best, 'worst': worst},
        }
    return out


def _dominates(a: List[float], b: List[float]) -> bool:
    # maximize all objectives
    better_or_equal = True
    strictly_better = False
    for x, y in zip(a, b):
        if x < y:
            better_or_equal = False
            break
        if x > y:
            strictly_better = True
    return better_or_equal and strictly_better


def _fast_non_dominated_sort(objs: List[List[float]]) -> List[List[int]]:
    n = len(objs)
    S: List[List[int]] = [[] for _ in range(n)]
    n_dom = [0 for _ in range(n)]
    fronts: List[List[int]] = [[]]
    for p in range(n):
        for q in range(n):
            if p == q:
                continue
            if _dominates(objs[p], objs[q]):
                S[p].append(q)
            elif _dominates(objs[q], objs[p]):
                n_dom[p] += 1
        if n_dom[p] == 0:
            fronts[0].append(p)

    i = 0
    while i < len(fronts) and fronts[i]:
        next_front: List[int] = []
        for p in fronts[i]:
            for q in S[p]:
                n_dom[q] -= 1
                if n_dom[q] == 0:
                    next_front.append(q)
        i += 1
        if next_front:
            fronts.append(next_front)
    return fronts


def _crowding_distance(front: List[int], objs: List[List[float]]) -> Dict[int, float]:
    if not front:
        return {}
    m = len(objs[0]) if objs else 0
    dist = {i: 0.0 for i in front}
    for k in range(m):
        front_sorted = sorted(front, key=lambda idx: float(objs[idx][k]))
        dist[front_sorted[0]] = float('inf')
        dist[front_sorted[-1]] = float('inf')
        vals = [float(objs[idx][k]) for idx in front_sorted]
        mn = min(vals)
        mx = max(vals)
        span = (mx - mn) if (mx - mn) > 1e-12 else 1.0
        for j in range(1, len(front_sorted) - 1):
            prev_v = float(objs[front_sorted[j - 1]][k])
            next_v = float(objs[front_sorted[j + 1]][k])
            dist[front_sorted[j]] += (next_v - prev_v) / span
    return dist


def _select_topk_nsga(objs: List[List[float]], k: int) -> Tuple[List[int], List[int], Dict[int, float]]:
    fronts = _fast_non_dominated_sort(objs)
    selected: List[int] = []
    rank = [-1 for _ in range(len(objs))]
    crowd: Dict[int, float] = {}
    for r, front in enumerate(fronts):
        for idx in front:
            rank[idx] = r + 1
        cd = _crowding_distance(front, objs)
        crowd.update(cd)
        if len(selected) + len(front) <= k:
            selected.extend(front)
        else:
            # fill the remaining by crowding distance desc
            remain = k - len(selected)
            front2 = sorted(front, key=lambda idx: float(cd.get(idx, 0.0)), reverse=True)
            selected.extend(front2[: max(0, remain)])
            break
    return selected, rank, crowd


class SmartEfficiencyComputeRequest(BaseModel):
    model_config = ConfigDict(extra='allow')
    # Keep permissive: match frontend worker payload.
    reqSeq: Optional[int] = None
    cacheKey: Optional[str] = None
    mode: Optional[str] = 'smart-efficiency'

    boundaryLoopWorld: Any = None
    axis: Optional[str] = None

    # knobs
    fast: Optional[bool] = False
    searchProfile: Optional[str] = None
    boundaryPillarMin: Optional[float] = None
    boundaryPillarMax: Optional[float] = None
    coalPillarMin: Optional[float] = None
    coalPillarMax: Optional[float] = None
    coalPillarTarget: Optional[float] = None
    faceWidthMin: Optional[float] = None
    faceWidthMax: Optional[float] = None
    faceAdvanceMax: Optional[float] = None
    topK: Optional[int] = None

    # optional passthrough
    input: Optional[Dict[str, Any]] = None


class SmartResourceComputeRequest(BaseModel):
    model_config = ConfigDict(extra='allow')
    # Keep permissive: match frontend worker payload.
    reqSeq: Optional[int] = None
    cacheKey: Optional[str] = None
    mode: Optional[str] = 'smart-resource'

    boundaryLoopWorld: Any = None
    axis: Optional[str] = None

    # knobs (keep permissive)
    fast: Optional[bool] = False
    searchProfile: Optional[str] = None
    boundaryPillarMin: Optional[float] = None
    boundaryPillarMax: Optional[float] = None
    coalPillarMin: Optional[float] = None
    coalPillarMax: Optional[float] = None
    coalPillarTarget: Optional[float] = None
    faceWidthMin: Optional[float] = None
    faceWidthMax: Optional[float] = None
    faceAdvanceMax: Optional[float] = None
    topK: Optional[int] = None

    # optional passthrough
    input: Optional[Dict[str, Any]] = None


def _repo_root() -> Path:
    # .../backend_python/routers/planning.py -> .../mining-plan
    return Path(__file__).resolve().parents[2]


def _run_node_smart_efficiency(payload: Dict[str, Any], timeout_s: float = 120.0) -> Dict[str, Any]:
    root = _repo_root()
    script = root / 'tools' / 'run-smart-efficiency.mjs'
    if not script.exists():
        raise RuntimeError(f'Node harness not found: {script}')

    cache_id = f"eff|{_stable_payload_hash(payload)}"
    cached = _node_cache_get(cache_id)
    if cached is not None:
        cached['_nodeCacheHit'] = True
        return cached

    # Ensure Node can resolve frontend deps (jsts etc). Prefer frontend/node_modules.
    frontend_node_modules = root / 'frontend' / 'node_modules'
    env = os.environ.copy()
    if frontend_node_modules.exists():
        prev = env.get('NODE_PATH', '')
        env['NODE_PATH'] = str(frontend_node_modules) + ((';' + prev) if prev else '')

    proc = subprocess.run(
        ['node', str(script)],
        input=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        timeout=timeout_s,
        check=False,
        cwd=str(root),
    )
    if proc.returncode != 0:
        stderr = proc.stderr.decode('utf-8', errors='replace')
        raise RuntimeError(f'node failed (code={proc.returncode}): {stderr[:2000]}')

    out = proc.stdout.decode('utf-8', errors='replace').strip()
    if not out:
        raise RuntimeError('node returned empty output')
    res = json.loads(out)
    if isinstance(res, dict):
        _node_cache_put(cache_id, res)
        res['_nodeCacheHit'] = False
    return res


def _run_node_smart_resource(payload: Dict[str, Any], timeout_s: float = 120.0) -> Dict[str, Any]:
    root = _repo_root()
    script = root / 'tools' / 'run-smart-resource.mjs'
    if not script.exists():
        raise RuntimeError(f'Node harness not found: {script}')

    cache_id = f"rec|{_stable_payload_hash(payload)}"
    cached = _node_cache_get(cache_id)
    if cached is not None:
        cached['_nodeCacheHit'] = True
        return cached

    frontend_node_modules = root / 'frontend' / 'node_modules'
    env = os.environ.copy()
    if frontend_node_modules.exists():
        prev = env.get('NODE_PATH', '')
        env['NODE_PATH'] = str(frontend_node_modules) + ((';' + prev) if prev else '')

    proc = subprocess.run(
        ['node', str(script)],
        input=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        timeout=timeout_s,
        check=False,
        cwd=str(root),
    )
    if proc.returncode != 0:
        stderr = proc.stderr.decode('utf-8', errors='replace')
        raise RuntimeError(f'node failed (code={proc.returncode}): {stderr[:2000]}')

    out = proc.stdout.decode('utf-8', errors='replace').strip()
    if not out:
        raise RuntimeError('node returned empty output')
    res = json.loads(out)
    if isinstance(res, dict):
        _node_cache_put(cache_id, res)
        res['_nodeCacheHit'] = False
    return res


# -----------------------------
# L2 visual-compat comparator
# -----------------------------


class L2Thresholds(BaseModel):
    # normalization
    snapMm: float = 1.0
    simplifyCm: float = 5.0

    # metrics (pass)
    symDiffRatio: float = 0.005
    symDiffAbsM2Small: float = 10.0
    smallAreaM2: float = 2000.0
    outRatio: float = 0.001
    outAbsM2: float = 10.0
    bboxMaxDeltaM: float = 0.5
    centroidMaxDeltaM: float = 0.2
    centroidSmallMaxDeltaM: float = 0.5
    topoPartAbsM2: float = 10.0

    # metrics (warn)
    warnSymDiffRatio: float = 0.01


L2ExtractMode = Literal[
    'loops',
    'rectLoops',
    'omegaLoops',
    'unionLoops',
    'residualLoopsWorld',
    'plannedWorkfaceLoopsWorld',
    'clippedFacesLoops',
    'facesLoops',
]


class L2CompareRequest(BaseModel):
    baseline: Any
    candidate: Any
    extract: Optional[L2ExtractMode] = 'loops'
    thresholds: Optional[L2Thresholds] = None


class L2CompareObject(BaseModel):
    name: str
    baseline: Any
    candidate: Any
    extract: Optional[L2ExtractMode] = 'loops'


class L2CompareBatchRequest(BaseModel):
    items: List[L2CompareObject] = Field(default_factory=list)
    thresholds: Optional[L2Thresholds] = None


class L2CompareResult(BaseModel):
    ok: bool
    status: Literal['pass', 'warn', 'fail']
    reasons: List[str] = Field(default_factory=list)
    thresholds: L2Thresholds

    # areas
    areaA: float = 0
    areaB: float = 0
    symDiffArea: float = 0
    symDiffRatio: float = 0
    outArea: float = 0
    outRatio: float = 0

    # bbox / centroid
    bboxA: Optional[Tuple[float, float, float, float]] = None
    bboxB: Optional[Tuple[float, float, float, float]] = None
    bboxMaxAbsDelta: Optional[float] = None
    centroidDist: Optional[float] = None

    # topology diagnostics
    partsAddedMaxArea: float = 0
    partsRemovedMaxArea: float = 0
    partsAddedCount: int = 0
    partsRemovedCount: int = 0

    warnings: List[str] = Field(default_factory=list)


def _safe_float(v: Any) -> Optional[float]:
    try:
        x = float(v)
        return x if np.isfinite(x) else None
    except Exception:
        return None


def _snap_point(x: float, snap_m: float) -> float:
    if snap_m <= 0:
        return x
    return round(x / snap_m) * snap_m


def _normalize_loop_points(loop: Any, *, snap_m: float) -> List[Tuple[float, float]]:
    pts = loop if isinstance(loop, list) else []
    out: List[Tuple[float, float]] = []
    for p in pts:
        if isinstance(p, dict):
            x0 = _safe_float(p.get('x'))
            y0 = _safe_float(p.get('y'))
        else:
            x0 = _safe_float(getattr(p, 'x', None))
            y0 = _safe_float(getattr(p, 'y', None))
        if x0 is None or y0 is None:
            continue
        x = _snap_point(x0, snap_m)
        y = _snap_point(y0, snap_m)
        if out and abs(out[-1][0] - x) <= 1e-12 and abs(out[-1][1] - y) <= 1e-12:
            continue
        out.append((x, y))

    # close
    if len(out) >= 3 and (out[0][0] != out[-1][0] or out[0][1] != out[-1][1]):
        out.append(out[0])

    # drop degenerate
    if len(out) < 4:
        return []
    return out


def _loops_to_geometry(loops: Any, *, snap_m: float, simplify_m: float) -> BaseGeometry:
    if loops is None:
        return GeometryCollection()
    loop_list = loops if isinstance(loops, list) else []
    polys: List[Polygon] = []
    for loop in loop_list:
        coords = _normalize_loop_points(loop, snap_m=snap_m)
        if not coords:
            continue
        try:
            poly = Polygon(coords)
            if poly.is_empty:
                continue
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty:
                continue
            poly = orient(poly, sign=1.0)
            if simplify_m and simplify_m > 0:
                poly = poly.simplify(simplify_m, preserve_topology=True)
                if poly.is_empty:
                    continue
                if not poly.is_valid:
                    poly = poly.buffer(0)
                if poly.is_empty:
                    continue
                poly = orient(poly, sign=1.0)
            polys.append(poly)
        except Exception:
            continue

    if not polys:
        return GeometryCollection()

    try:
        g = unary_union(polys)
        if g.is_empty:
            return GeometryCollection()
        if not g.is_valid:
            g = g.buffer(0)
        return g if not g.is_empty else GeometryCollection()
    except Exception:
        return GeometryCollection()


def _extract_loops_any(obj: Any, extract: L2ExtractMode) -> Any:
    """Best-effort extraction for common frontend payload shapes.

    Preferred input is directly loops: List[List[{x,y}]].
    This helper also supports passing a worker candidate or render payload.
    """

    if obj is None:
        return []

    # direct: list-of-loops
    if isinstance(obj, list):
        return obj

    if not isinstance(obj, dict):
        return []

    # canonical
    if extract == 'loops' and isinstance(obj.get('loops'), list):
        return obj.get('loops')

    # allow passing worker candidate with render
    render = obj.get('render') if isinstance(obj.get('render'), dict) else obj
    if not isinstance(render, dict):
        return []

    key = str(extract)

    # these are typically list-of-loops
    if key in ('rectLoops', 'omegaLoops', 'unionLoops', 'residualLoopsWorld'):
        v = render.get(key)
        return v if isinstance(v, list) else []

    # these are typically list-of-{faceIndex, loop}
    if key in ('plannedWorkfaceLoopsWorld', 'clippedFacesLoops', 'facesLoops'):
        faces = render.get(key)
        if isinstance(faces, list) and faces and isinstance(faces[0], dict) and 'loop' in faces[0]:
            return [f.get('loop') for f in faces if isinstance(f, dict) and isinstance(f.get('loop'), list)]
        # fallback: sometimes facesLoops is already list-of-loops
        if isinstance(faces, list) and faces and isinstance(faces[0], list):
            return faces
        return []

    return []


def _geom_bounds(g: BaseGeometry) -> Optional[Tuple[float, float, float, float]]:
    try:
        if g is None or g.is_empty:
            return None
        b = g.bounds
        if len(b) != 4:
            return None
        return (float(b[0]), float(b[1]), float(b[2]), float(b[3]))
    except Exception:
        return None


def _bbox_max_abs_delta(a: Optional[Tuple[float, float, float, float]], b: Optional[Tuple[float, float, float, float]]) -> Optional[float]:
    if not a or not b:
        return None
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]), abs(a[3] - b[3]))


def _centroid_dist(a: BaseGeometry, b: BaseGeometry) -> Optional[float]:
    try:
        if a.is_empty or b.is_empty:
            return None
        ca = a.centroid
        cb = b.centroid
        dx = float(ca.x) - float(cb.x)
        dy = float(ca.y) - float(cb.y)
        return float(math.hypot(dx, dy))
    except Exception:
        return None


def _max_part_area(g: BaseGeometry) -> Tuple[float, int]:
    if g is None or g.is_empty:
        return 0.0, 0
    try:
        # iter over components
        if hasattr(g, 'geoms'):
            areas = [float(x.area) for x in list(getattr(g, 'geoms', [])) if x is not None and not x.is_empty]
        else:
            areas = [float(g.area)]
        areas = [a for a in areas if np.isfinite(a) and a > 0]
        return (max(areas) if areas else 0.0), len(areas)
    except Exception:
        return 0.0, 0


def _compare_geoms(a: BaseGeometry, b: BaseGeometry, th: L2Thresholds) -> L2CompareResult:
    areaA = float(a.area) if a is not None and not a.is_empty else 0.0
    areaB = float(b.area) if b is not None and not b.is_empty else 0.0
    eps = 1e-9
    denom = max(areaA, eps)

    sym = a.symmetric_difference(b) if (a is not None and b is not None) else GeometryCollection()
    out = b.difference(a) if (a is not None and b is not None) else GeometryCollection()
    removed = a.difference(b) if (a is not None and b is not None) else GeometryCollection()

    symArea = float(sym.area) if not sym.is_empty else 0.0
    outArea = float(out.area) if not out.is_empty else 0.0
    symRatio = symArea / denom
    outRatio = outArea / denom

    bboxA = _geom_bounds(a)
    bboxB = _geom_bounds(b)
    bboxDelta = _bbox_max_abs_delta(bboxA, bboxB)
    cdist = _centroid_dist(a, b)

    addedMax, addedCnt = _max_part_area(out)
    removedMax, removedCnt = _max_part_area(removed)

    reasons: List[str] = []
    warnings: List[str] = []

    small = areaA < float(th.smallAreaM2)
    symOk = (symRatio <= float(th.symDiffRatio)) or (small and symArea <= float(th.symDiffAbsM2Small))
    outOk = (outRatio <= float(th.outRatio)) or (outArea <= float(th.outAbsM2))

    centroidLimit = float(th.centroidSmallMaxDeltaM if small else th.centroidMaxDeltaM)
    centroidOk = (cdist is None) or (cdist <= centroidLimit)
    bboxOk = (bboxDelta is None) or (bboxDelta <= float(th.bboxMaxDeltaM))
    topoOk = (addedMax <= float(th.topoPartAbsM2)) and (removedMax <= float(th.topoPartAbsM2))

    status: Literal['pass', 'warn', 'fail'] = 'pass'
    ok = True

    if not symOk:
        ok = False
        status = 'fail'
        reasons.append('symDiff 超阈值')
    if not outOk:
        ok = False
        status = 'fail'
        reasons.append('越界面积超阈值')
    if not bboxOk:
        ok = False
        status = 'fail'
        reasons.append('bbox 偏差超阈值')
    if not centroidOk:
        ok = False
        status = 'fail'
        reasons.append('质心偏移超阈值')
    if not topoOk:
        ok = False
        status = 'fail'
        reasons.append('拓扑差异（新增/丢失大碎片）')

    # warn band
    if status == 'pass' and symRatio > float(th.symDiffRatio) and symRatio <= float(th.warnSymDiffRatio):
        status = 'warn'
        warnings.append('symDiff 接近阈值（warn）')

    return L2CompareResult(
        ok=ok,
        status=status,
        reasons=reasons,
        thresholds=th,
        areaA=areaA,
        areaB=areaB,
        symDiffArea=symArea,
        symDiffRatio=symRatio,
        outArea=outArea,
        outRatio=outRatio,
        bboxA=bboxA,
        bboxB=bboxB,
        bboxMaxAbsDelta=bboxDelta,
        centroidDist=cdist,
        partsAddedMaxArea=addedMax,
        partsRemovedMaxArea=removedMax,
        partsAddedCount=addedCnt,
        partsRemovedCount=removedCnt,
        warnings=warnings,
    )


@router.post('/planning/l2/compare', response_model=L2CompareResult)
def l2_compare(req: L2CompareRequest) -> L2CompareResult:
    th = req.thresholds or L2Thresholds()
    snap_m = max(0.0, float(th.snapMm) / 1000.0)
    simplify_m = max(0.0, float(th.simplifyCm) / 100.0)

    loopsA = _extract_loops_any(req.baseline, req.extract or 'loops')
    loopsB = _extract_loops_any(req.candidate, req.extract or 'loops')

    gA = _loops_to_geometry(loopsA, snap_m=snap_m, simplify_m=simplify_m)
    gB = _loops_to_geometry(loopsB, snap_m=snap_m, simplify_m=simplify_m)
    return _compare_geoms(gA, gB, th)


@router.post('/planning/l2/compare-batch')
def l2_compare_batch(req: L2CompareBatchRequest) -> Dict[str, Any]:
    th = req.thresholds or L2Thresholds()
    snap_m = max(0.0, float(th.snapMm) / 1000.0)
    simplify_m = max(0.0, float(th.simplifyCm) / 100.0)

    results: List[Dict[str, Any]] = []
    status_rank = {'pass': 0, 'warn': 1, 'fail': 2}
    worst: Literal['pass', 'warn', 'fail'] = 'pass'

    for it in req.items:
        loopsA = _extract_loops_any(it.baseline, it.extract or 'loops')
        loopsB = _extract_loops_any(it.candidate, it.extract or 'loops')
        gA = _loops_to_geometry(loopsA, snap_m=snap_m, simplify_m=simplify_m)
        gB = _loops_to_geometry(loopsB, snap_m=snap_m, simplify_m=simplify_m)
        r = _compare_geoms(gA, gB, th)
        results.append({'name': it.name, 'result': r.model_dump()})
        if status_rank[r.status] > status_rank[worst]:
            worst = r.status

    return {
        'ok': all(x['result'].get('ok') for x in results),
        'status': worst,
        'thresholds': th.model_dump(),
        'results': results,
    }


@router.post('/planning/smart-efficiency/compute')
def smart_efficiency_compute(req: SmartEfficiencyComputeRequest) -> Dict[str, Any]:
    """Backend execution of smart-efficiency.

    Implementation strategy (L2-first): reuse the frontend worker code via Node.js harness
    to guarantee output compatibility while we progressively migrate compute to Python.
    """

    payload = req.model_dump(exclude_none=True)
    payload.setdefault('mode', 'smart-efficiency')
    if not isinstance(payload.get('input'), dict):
        payload['input'] = {'mode': 'efficiency'}
    elif 'mode' not in payload['input']:
        payload['input']['mode'] = 'efficiency'

    start = time.time()
    try:
        result = _run_node_smart_efficiency(payload)
        # best-effort enrich
        if isinstance(result, dict):
            stats = result.get('stats')
            if isinstance(stats, dict):
                stats.setdefault('backend', 'node-harness')
                stats.setdefault('backendElapsedMs', (time.time() - start) * 1000)
            else:
                result['stats'] = {'backend': 'node-harness', 'backendElapsedMs': (time.time() - start) * 1000}
        return result
    except subprocess.TimeoutExpired:
        return {
            'ok': False,
            'reqSeq': payload.get('reqSeq'),
            'cacheKey': str(payload.get('cacheKey') or ''),
            'mode': 'smart-efficiency',
            'message': '后端 smart-efficiency 计算超时（node harness）',
            'failedReason': 'BACKEND_TIMEOUT',
            'omegaRender': None,
            'omegaArea': None,
            'candidates': [],
            'attemptSummary': {'attemptedCombos': 0, 'feasibleCombos': 0, 'failTypes': {'BACKEND_TIMEOUT': 1}},
        }
    except Exception as e:
        msg = str(e)
        return {
            'ok': False,
            'reqSeq': payload.get('reqSeq'),
            'cacheKey': str(payload.get('cacheKey') or ''),
            'mode': 'smart-efficiency',
            'message': msg,
            'failedReason': msg,
            'omegaRender': None,
            'omegaArea': None,
            'candidates': [],
            'attemptSummary': {'attemptedCombos': 0, 'feasibleCombos': 0, 'failTypes': {'BACKEND_EXCEPTION': 1}},
        }


@router.post('/planning/smart-resource/compute')
def smart_resource_compute(req: SmartResourceComputeRequest) -> Dict[str, Any]:
    """Backend execution of smart-resource.

    Implementation strategy (L2-first): reuse the frontend worker code via Node.js harness
    to guarantee output compatibility while we progressively migrate compute to Python.
    """

    payload = req.model_dump(exclude_none=True)
    payload.setdefault('mode', 'smart-resource')
    if not isinstance(payload.get('input'), dict):
        payload['input'] = {'mode': 'recovery'}
    elif 'mode' not in payload['input']:
        payload['input']['mode'] = 'recovery'

    start = time.time()
    try:
        result = _run_node_smart_resource(payload)
        if isinstance(result, dict):
            stats = result.get('stats')
            if isinstance(stats, dict):
                stats.setdefault('backend', 'node-harness')
                stats.setdefault('backendElapsedMs', (time.time() - start) * 1000)
            else:
                result['stats'] = {'backend': 'node-harness', 'backendElapsedMs': (time.time() - start) * 1000}
        return result
    except subprocess.TimeoutExpired:
        return {
            'ok': False,
            'reqSeq': payload.get('reqSeq'),
            'cacheKey': str(payload.get('cacheKey') or ''),
            'mode': 'smart-resource',
            'message': '后端 smart-resource 计算超时（node harness）',
            'failedReason': 'BACKEND_TIMEOUT',
            'omegaRender': None,
            'omegaArea': None,
            'tonnageTotal': 0,
            'candidates': [],
            'attemptSummary': {'attemptedCombos': 0, 'feasibleCombos': 0, 'failTypes': {'BACKEND_TIMEOUT': 1}},
        }
    except Exception as e:
        msg = str(e)
        return {
            'ok': False,
            'reqSeq': payload.get('reqSeq'),
            'cacheKey': str(payload.get('cacheKey') or ''),
            'mode': 'smart-resource',
            'message': msg,
            'failedReason': msg,
            'omegaRender': None,
            'omegaArea': None,
            'tonnageTotal': 0,
            'candidates': [],
            'attemptSummary': {'attemptedCombos': 0, 'feasibleCombos': 0, 'failTypes': {'BACKEND_EXCEPTION': 1}},
        }


@router.post('/planning/smart-weighted/compute')
def smart_weighted_compute(req: SmartWeightedComputeRequest) -> Dict[str, Any]:
    """Backend execution of weighted (multi-objective) candidate generation.

    Strategy:
    - Reuse existing node harness for smart-efficiency / smart-resource to generate diverse feasible candidates.
    - Evaluate recoveryScore for all candidates via backend tonnage/scoring helper.
    - If ODI field provided: compute disturbance distPoints (0..100, higher is better).
    - Select TopK via non-dominated sorting + crowding distance (NSGA-II selection).
    - Return a frontend-compatible weighted pack.

    Note: Does NOT change the behavior of existing three modes; weighted is an additional endpoint.
    """

    t0 = time.time()
    payload = req.model_dump(exclude_none=True)
    cache_key = str(payload.get('cacheKey') or '')
    if cache_key:
        cached = _cache_get(cache_key)
        if cached is not None:
            out = dict(cached)
            out.setdefault('stats', {})
            if isinstance(out['stats'], dict):
                out['stats'].setdefault('cacheHit', True)
            return out

    axis = payload.get('axis')
    boundary = payload.get('boundaryLoopWorld')

    w_in = payload.get('weights') or {}
    w_eff_in = float(w_in.get('efficiency') or 0.0)
    w_rec_in = float(w_in.get('recovery') or 0.0)
    w_dis_in = float(w_in.get('disturbance') or 0.0)

    odi_pack_raw = payload.get('odiFieldPack')
    odi_pack = None
    # Fast path: avoid expensive deep validation for the potentially huge `field`.
    # Frontend already constructs a well-formed pack; keeping validation would
    # mainly add overhead without improving determinism.
    try:
        if isinstance(odi_pack_raw, dict):
            odi_pack = ThicknessFieldPack.model_construct(**odi_pack_raw)
        else:
            odi_pack = ThicknessFieldPack.model_validate(odi_pack_raw) if odi_pack_raw is not None else None
    except Exception:
        odi_pack = None
    has_odi = bool(odi_pack and odi_pack.field and odi_pack.gridW and odi_pack.gridH)

    # Per-mode cache keys (for deterministic seeding aligned with existing modes)
    eff_base_key = str(payload.get('effCacheKey') or '')
    rec_base_key = str(payload.get('recCacheKey') or '')
    dist_base_key = str(payload.get('distCacheKey') or '')

    # Fallback: if not provided, use weighted cacheKey (still deterministic, but won't be "strictly equal" to mode cacheKey)
    if not eff_base_key:
        eff_base_key = str(cache_key or '')
    if not rec_base_key:
        rec_base_key = str(cache_key or '')
    if not dist_base_key:
        dist_base_key = str(cache_key or '')

    # weights used: if no ODI, force wDist=0 and renormalize 2 objectives
    if has_odi:
        w_eff, w_rec, w_dis = _norm_weights_3(w_eff_in, w_rec_in, w_dis_in)
    else:
        w_eff, w_rec = _norm_weights_2(w_eff_in, w_rec_in)
        w_dis = 0.0

    # Strict single-objective equivalence (when user explicitly sets one weight to 1 and others to 0)
    tol = 1e-12
    single_mode: Optional[str] = None
    try:
        if (w_eff_in > 1 - 1e-9) and (abs(w_rec_in) <= tol) and (abs(w_dis_in) <= tol):
            single_mode = 'efficiency'
        elif (w_rec_in > 1 - 1e-9) and (abs(w_eff_in) <= tol) and (abs(w_dis_in) <= tol):
            single_mode = 'recovery'
        elif (w_dis_in > 1 - 1e-9) and (abs(w_eff_in) <= tol) and (abs(w_rec_in) <= tol):
            single_mode = 'disturbance'
    except Exception:
        single_mode = None

    # run efficiency + recovery via node harness (same as existing backend compute)
    base_knobs = {
        'boundaryLoopWorld': boundary,
        'axis': axis,
        'fast': bool(payload.get('fast') or False),
        'searchProfile': payload.get('searchProfile'),
        'boundaryPillarMin': payload.get('boundaryPillarMin'),
        'boundaryPillarMax': payload.get('boundaryPillarMax'),
        'coalPillarMin': payload.get('coalPillarMin'),
        'coalPillarMax': payload.get('coalPillarMax'),
        'coalPillarTarget': payload.get('coalPillarTarget'),
        'faceWidthMin': payload.get('faceWidthMin'),
        'faceWidthMax': payload.get('faceWidthMax'),
        'faceAdvanceMax': payload.get('faceAdvanceMax'),
    }

    # include weights in cacheKey salt for diversity (worker rng depends on cacheKey)
    salt = f"|wEff={w_eff:.6f}|wRec={w_rec:.6f}|wDis={w_dis:.6f}|hasOdi={1 if has_odi else 0}"
    cache_eff = eff_base_key + '|weighted|effgen' + salt
    cache_rec = rec_base_key + '|weighted|recgen' + salt
    cache_dist = dist_base_key + '|weighted|distgen' + salt

    # For strict single-objective: do NOT salt/merge. Use original per-mode cache key.
    if single_mode == 'efficiency':
        cache_eff = eff_base_key
    elif single_mode == 'recovery':
        cache_rec = rec_base_key
    elif single_mode == 'disturbance':
        cache_dist = dist_base_key

    eff_payload = {
        'mode': 'smart-efficiency',
        'reqSeq': payload.get('reqSeq'),
        'cacheKey': cache_eff,
        **base_knobs,
        'input': {'mode': 'efficiency'},
    }
    rec_payload = {
        'mode': 'smart-resource',
        'reqSeq': payload.get('reqSeq'),
        'cacheKey': cache_rec,
        **base_knobs,
        'input': {'mode': 'recovery'},
    }

    eff_res: Optional[Dict[str, Any]] = None
    rec_res: Optional[Dict[str, Any]] = None
    dist_res: Optional[Dict[str, Any]] = None

    node_ms: Dict[str, float] = {}
    node_cache_hit: Dict[str, bool] = {}

    if single_mode == 'efficiency':
        t_node = time.time()
        eff_res = _run_node_smart_efficiency(eff_payload)
        node_ms['efficiency'] = (time.time() - t_node) * 1000
        node_cache_hit['efficiency'] = bool(isinstance(eff_res, dict) and eff_res.get('_nodeCacheHit') is True)
    elif single_mode == 'recovery':
        t_node = time.time()
        rec_res = _run_node_smart_resource(rec_payload)
        node_ms['recovery'] = (time.time() - t_node) * 1000
        node_cache_hit['recovery'] = bool(isinstance(rec_res, dict) and rec_res.get('_nodeCacheHit') is True)
    elif single_mode == 'disturbance':
        if not has_odi:
            out = {
                'ok': False,
                'mode': 'smart-weighted',
                'cacheKey': cache_key,
                'message': '未检测到 ODI 场：无法执行 disturbance-only（wDist=1）',
                'failedReason': 'NO_ODI_FIELD',
                'best': {'signature': '', 'source': ''},
                'table': {'rows': []},
                'weightsInput': {'efficiency': w_eff_in, 'recovery': w_rec_in, 'disturbance': w_dis_in},
                'weightsUsed': {'wEff': 0.0, 'wRec': 0.0, 'wDist': 1.0},
                'hasOdiField': False,
                'stats': {'backendElapsedMs': (time.time() - t0) * 1000, 'cacheHit': False},
            }
            if cache_key:
                _cache_put(cache_key, out)
            return out
        dist_payload = {
            'mode': 'smart-efficiency',
            'reqSeq': payload.get('reqSeq'),
            'cacheKey': cache_dist,
            **base_knobs,
            'input': {'mode': 'disturbance'},
        }
        t_node = time.time()
        dist_res = _run_node_smart_efficiency(dist_payload)
        node_ms['disturbance'] = (time.time() - t_node) * 1000
        node_cache_hit['disturbance'] = bool(isinstance(dist_res, dict) and dist_res.get('_nodeCacheHit') is True)
    else:
        futures: Dict[str, Any] = {}
        starts: Dict[str, float] = {}
        starts['efficiency'] = time.time()
        futures['efficiency'] = _NODE_EXECUTOR.submit(_run_node_smart_efficiency, eff_payload)
        starts['recovery'] = time.time()
        futures['recovery'] = _NODE_EXECUTOR.submit(_run_node_smart_resource, rec_payload)
        # optional: add a diversity run using disturbance search (only if ODI present and wDist>0)
        if has_odi and w_dis > 1e-9:
            dist_payload = {
                'mode': 'smart-efficiency',
                'reqSeq': payload.get('reqSeq'),
                'cacheKey': cache_dist,
                **base_knobs,
                'input': {'mode': 'disturbance'},
            }
            starts['disturbance'] = time.time()
            futures['disturbance'] = _NODE_EXECUTOR.submit(_run_node_smart_efficiency, dist_payload)

        for name, fut in futures.items():
            try:
                res = fut.result()
            except Exception:
                res = None
            t0n = float(starts.get(name, time.time()))
            node_ms[name] = (time.time() - t0n) * 1000
            node_cache_hit[name] = bool(isinstance(res, dict) and res.get('_nodeCacheHit') is True)
            if name == 'efficiency':
                eff_res = res
            elif name == 'recovery':
                rec_res = res
            elif name == 'disturbance':
                dist_res = res

    eff_cands = eff_res.get('candidates') if isinstance(eff_res, dict) else []
    rec_cands = rec_res.get('candidates') if isinstance(rec_res, dict) else []
    dist_cands = dist_res.get('candidates') if isinstance(dist_res, dict) else []
    eff_cands = eff_cands if isinstance(eff_cands, list) else []
    rec_cands = rec_cands if isinstance(rec_cands, list) else []
    dist_cands = dist_cands if isinstance(dist_cands, list) else []

    # build combined pool
    # - Prefer qualified candidates.
    # - If none are qualified (common when constraints are tight), fall back to unqualified
    #   candidates so the UI still has something to inspect (with qualified=false).
    pool_all: List[Dict[str, Any]] = []
    def _push(source: str, c: Any) -> None:
        if not isinstance(c, dict):
            return
        sig = str(c.get('signature') or '').strip()
        if not sig:
            return
        item = dict(c)
        item['_source'] = source
        pool_all.append(item)

    for c in eff_cands:
        _push('efficiency', c)
    for c in rec_cands:
        _push('recovery', c)
    for c in dist_cands:
        _push('disturbance', c)

    pool_qualified = [c for c in pool_all if c.get('qualified') is True]
    fallback_unqualified = False
    pool: List[Dict[str, Any]]
    if pool_qualified:
        pool = pool_qualified
    else:
        pool = pool_all
        fallback_unqualified = bool(pool_all)

    if not pool:
        def _brief(res: Optional[Dict[str, Any]]) -> Dict[str, Any]:
            if not isinstance(res, dict):
                return {'ok': False, 'message': '无回包（node harness 异常或返回空）', 'failedReason': 'NO_RESPONSE', 'candidatesCount': 0}
            cands = res.get('candidates')
            n = len(cands) if isinstance(cands, list) else 0
            return {
                'ok': bool(res.get('ok')),
                'message': str(res.get('message') or ''),
                'failedReason': str(res.get('failedReason') or ''),
                'axis': str(res.get('axis') or ''),
                'cacheKey': str(res.get('cacheKey') or ''),
                'candidatesCount': n,
            }

        diag = {
            'efficiency': _brief(eff_res),
            'recovery': _brief(rec_res),
            'disturbance': _brief(dist_res) if dist_res is not None else None,
        }
        out = {
            'ok': False,
            'mode': 'smart-weighted',
            'cacheKey': cache_key,
            'message': '暂无候选：效率/回收候选均为空或全部不合格。（请查看 debug.subResults 获取原因）',
            'failedReason': 'NO_CANDIDATES',
            'best': {'signature': '', 'source': ''},
            'table': {'rows': []},
            'weightsUsed': {'wEff': w_eff, 'wRec': w_rec, 'wDist': w_dis},
            'debug': {
                'salt': salt,
                'cacheEff': cache_eff,
                'cacheRec': cache_rec,
                'cacheDist': cache_dist,
                'subResults': diag,
            },
            'stats': {'backendElapsedMs': (time.time() - t0) * 1000, 'cacheHit': False},
        }
        if cache_key:
            _cache_put(cache_key, out)
        return out

    # Speed: build a representative list for per-signature computations (tonnage / disturbance).
    # We keep the original `pool` (may contain duplicates) for selection, but expensive scoring
    # only needs one geometry per unique signature.
    rep_by_sig: Dict[str, Dict[str, Any]] = {}
    rep_list: List[Dict[str, Any]] = []
    for c in pool:
        sig0 = str(c.get('signature') or '').strip()
        if not sig0:
            continue
        if sig0 in rep_by_sig:
            continue
        rep_by_sig[sig0] = c
        rep_list.append(c)

    # Recovery score for all candidates (prefer recoveryScore): use existing tonnage endpoint logic.
    # Build minimal candidate inputs.
    ton_req = {
        'cacheKey': (cache_key or 'wgt|') + '|tonnage' + salt,
        'candidates': [],
        'thickness': payload.get('thickness') or None,
        'topK': int(payload.get('topK') or 60),
        'debug': False,
    }
    for c in rep_list:
        sig = str(c.get('signature') or '')
        rr = c.get('render') if isinstance(c.get('render'), dict) else None
        ton_req['candidates'].append({
            'signature': sig,
            'qualified': bool(c.get('qualified') is True),
            'coverageRatio': c.get('coverageRatio') or (c.get('metrics') or {}).get('coverageRatio'),
            'coverageRatioEff': c.get('coverageRatioEff') or (c.get('metrics') or {}).get('coverageRatioEff'),
            'N': c.get('N') or (c.get('metrics') or {}).get('faceCount'),
            'lenCV': c.get('lenCV') or (c.get('metrics') or {}).get('lenCV'),
            'axis': c.get('axis') or (c.get('metrics') or {}).get('axis'),
            'thetaDeg': c.get('thetaDeg') or (c.get('metrics') or {}).get('thetaDeg'),
            'ws': c.get('ws') or (c.get('genes') or {}).get('ws') or (c.get('metrics') or {}).get('ws'),
            'render': rr,
        })

    t_ton = time.time()
    ton_resp = smart_resource_tonnage(SmartResourceTonnageRequest.model_validate(ton_req))
    ton_ms = (time.time() - t_ton) * 1000
    rec_by_sig = ton_resp.recoveryScoreBySignature if isinstance(ton_resp, SmartResourceTonnageResponse) else {}
    ton_by_sig = ton_resp.tonnageBySignature if isinstance(ton_resp, SmartResourceTonnageResponse) else {}

    # disturbance distPoints
    dist_params_raw = payload.get('disturbanceParams') or {}
    try:
        dist_params = SmartWeightedDisturbanceParams.model_validate(dist_params_raw)
    except Exception:
        dist_params = SmartWeightedDisturbanceParams()
    dist_by_sig: Dict[str, Dict[str, Any]] = {}
    dist_ms = 0.0
    if has_odi:
        t_dist = time.time()
        dist_by_sig = _compute_disturbance_for_candidates(rep_list, odi_pack, dist_params)
        dist_ms = (time.time() - t_dist) * 1000

    # build objective vectors
    items: List[Dict[str, Any]] = []
    for c in pool:
        sig = str(c.get('signature') or '')
        src = str(c.get('_source') or 'efficiency')
        metrics = c.get('metrics') if isinstance(c.get('metrics'), dict) else {}
        eff_score = c.get('efficiencyScore')
        if eff_score is None:
            eff_score = metrics.get('efficiencyScore')
        try:
            eff_score_f = float(eff_score) if eff_score is not None else 0.0
        except Exception:
            eff_score_f = 0.0

        rec_score = rec_by_sig.get(sig)
        if rec_score is None:
            # fallback to worker-provided recoveryScore if present
            rs2 = c.get('recoveryScore')
            if rs2 is None and isinstance(metrics, dict):
                rs2 = metrics.get('recoveryScore')
            try:
                rec_score = float(rs2) if rs2 is not None else None
            except Exception:
                rec_score = None
        try:
            rec_score_f = float(rec_score) if rec_score is not None else 0.0
        except Exception:
            rec_score_f = 0.0

        ton_total = ton_by_sig.get(sig)
        if ton_total is None:
            tt2 = c.get('tonnageTotal')
            if tt2 is None and isinstance(metrics, dict):
                tt2 = metrics.get('tonnageTotal')
            try:
                ton_total = float(tt2) if tt2 is not None else None
            except Exception:
                ton_total = None

        dd = dist_by_sig.get(sig) or {}
        dist_points = dd.get('points') if has_odi else None
        dist_score = dd.get('score') if has_odi else None

        items.append({
            'signature': sig,
            'source': src,
            'qualified': bool(c.get('qualified') is True),
            'effScore': eff_score_f,
            'recScore': rec_score_f,
            'tonnageTotal': ton_total,
            'distPoints': dist_points,
            'distScore': dist_score,
            'distMean': dd.get('mean') if has_odi else None,
            'distP90': dd.get('p90') if has_odi else None,
            'distExceedPct': (float(dd.get('exceedRatio')) * 100.0) if (has_odi and dd.get('exceedRatio') is not None) else None,
            # for debug
            '_distCalib': dd.get('calib') if has_odi else None,
            # geometry/display metrics
            'N': c.get('N') or metrics.get('faceCount'),
            'B': c.get('B') or metrics.get('B'),
            'wb': c.get('wb') or (c.get('genes') or {}).get('wb') or metrics.get('wb'),
            'ws': c.get('ws') or (c.get('genes') or {}).get('ws') or metrics.get('ws'),
            'coveragePct': (float(c.get('coverageRatio') or metrics.get('coverageRatio') or 0.0) * 100.0) if (c.get('coverageRatio') is not None or (isinstance(metrics, dict) and metrics.get('coverageRatio') is not None)) else None,
        })

    # Non-dominated selection (TopK)
    k = max(10, int(payload.get('topK') or 60))
    obj_vecs: List[List[float]] = []
    for it in items:
        if has_odi:
            dp = it.get('distPoints')
            obj_vecs.append([float(it.get('effScore') or 0.0), float(it.get('recScore') or 0.0), float(dp or 0.0)])
        else:
            obj_vecs.append([float(it.get('effScore') or 0.0), float(it.get('recScore') or 0.0)])

    t_sel = time.time()
    selected_idx, pareto_rank, crowd = _select_topk_nsga(obj_vecs, k)
    sel_ms = (time.time() - t_sel) * 1000
    selected_items = [items[i] for i in selected_idx]

    # Normalize for combined score (min-max on selected set for stability)
    eff_mn, eff_mx = _minmax([it.get('effScore') for it in selected_items])
    rec_mn, rec_mx = _minmax([it.get('recScore') for it in selected_items])
    # distPoints already 0..100
    for i, it in enumerate(selected_items):
        it['paretoRank'] = pareto_rank[selected_idx[i]] if selected_idx[i] < len(pareto_rank) else None
        it['crowding'] = crowd.get(selected_idx[i], 0.0)
        it['effNorm'] = _norm_minmax(it.get('effScore'), eff_mn, eff_mx)
        it['recNorm'] = _norm_minmax(it.get('recScore'), rec_mn, rec_mx)
        it['distNorm'] = _clamp01((float(it.get('distPoints') or 0.0)) / 100.0) if has_odi else 0.0
        it['totalScore'] = w_eff * it['effNorm'] + w_rec * it['recNorm'] + w_dis * it['distNorm']
        it['combinedScore'] = it['totalScore']

    # Final ordering: combined score desc, then pareto rank asc, then crowding desc, then signature asc
    selected_items.sort(
        key=lambda it: (
            -float(it.get('totalScore') or 0.0),
            int(it.get('paretoRank') or 10**9),
            -float(it.get('crowding') or 0.0),
            str(it.get('signature') or ''),
        )
    )
    rows = []
    for rnk, it in enumerate(selected_items, start=1):
        rows.append({
            'rank': rnk,
            'signature': it.get('signature'),
            'source': it.get('source'),
            'qualified': bool(it.get('qualified') is True),
            'N': it.get('N'),
            'B': it.get('B'),
            'wb': it.get('wb'),
            'ws': it.get('ws'),
            'coveragePct': it.get('coveragePct'),
            'tonnageTotal': it.get('tonnageTotal'),
            'effScore': it.get('effScore'),
            'recScore': it.get('recScore'),
            'effNorm': it.get('effNorm'),
            'recNorm': it.get('recNorm'),
            'distNorm': it.get('distNorm'),
            'distPoints': it.get('distPoints'),
            'distScore': it.get('distScore'),
            'distMean': it.get('distMean'),
            'distP90': it.get('distP90'),
            'distExceedPct': it.get('distExceedPct'),
            'totalScore': it.get('totalScore'),
            'combinedScore': it.get('combinedScore'),
            # debug compat (frontend debug copy uses r._distScore)
            '_distScore': it.get('distScore'),
            '_distCalib': it.get('_distCalib'),
            # debug
            'paretoRank': it.get('paretoRank'),
            'crowding': it.get('crowding'),
        })

    best = rows[0] if rows else None
    out = {
        'ok': True,
        'mode': 'smart-weighted',
        'cacheKey': cache_key,
        'best': {'signature': str(best.get('signature') or ''), 'source': str(best.get('source') or '')} if best else {'signature': '', 'source': ''},
        'table': {'rows': rows},
        'message': '未找到合格候选，已回退展示未达标候选（qualified=false）。' if fallback_unqualified else '',
        'failedReason': 'FALLBACK_UNQUALIFIED' if fallback_unqualified else '',
        'weightsInput': {'efficiency': w_eff_in, 'recovery': w_rec_in, 'disturbance': w_dis_in},
        'weightsUsed': {'wEff': w_eff, 'wRec': w_rec, 'wDist': w_dis},
        'hasOdiField': has_odi,
        'derived': {
            'hasDist': has_odi,
            'fallbackUnqualified': fallback_unqualified,
            'ranges': {
                'eff': {'min': eff_mn, 'max': eff_mx},
                'rec': {'min': rec_mn, 'max': rec_mx},
            },
            'distParams': dist_params.model_dump(exclude_none=True),
            'selection': {
                'method': 'nsga2-select',
                'topK': k,
            },
        },
        'sources': {
            'efficiencyCandidatesCount': len(eff_cands),
            'recoveryCandidatesCount': len(rec_cands),
            'disturbanceCandidatesCount': len(dist_cands) if dist_res is not None else 0,
        },
        'debug': {
            'salt': salt,
            'cacheEff': cache_eff,
            'cacheRec': cache_rec,
            'cacheDist': cache_dist,
            'tonnage': {
                'hasThickness': bool(getattr(ton_resp, 'hasThickness', False)),
                'fallbackMode': str(getattr(ton_resp, 'fallbackMode', '')),
                'elapsedMs': float(getattr(ton_resp, 'elapsedMs', 0.0)),
            },
        },
        # embed raw results so frontend weighted 模式可联动显示（不影响前三个模式）
        'effResult': eff_res,
        'recResult': rec_res,
        'distResult': dist_res,
        'stats': {
            'backendElapsedMs': (time.time() - t0) * 1000,
            'cacheHit': False,
            'nodeElapsedMs': node_ms,
            'nodeCacheHit': node_cache_hit,
            'tonnageElapsedMs': ton_ms,
            'disturbanceElapsedMs': dist_ms,
            'selectionElapsedMs': sel_ms,
        },
    }

    if cache_key:
        _cache_put(cache_key, out)
    return out


# -----------------------------
# Geometry helpers
# -----------------------------


def _loop_to_polygon(loop: Any) -> Optional[Polygon]:
    pts = loop if isinstance(loop, list) else []
    if len(pts) < 3:
        return None
    coords: List[Tuple[float, float]] = []
    for p in pts:
        try:
            # Support point shapes:
            # - {x, y}
            # - [x, y] / (x, y)
            # - objects with .x/.y
            if isinstance(p, (list, tuple)) and len(p) >= 2:
                x = float(p[0])
                y = float(p[1])
            elif isinstance(p, dict):
                # some payloads may use 0/1 index keys
                if 'x' in p and 'y' in p:
                    x = float(p.get('x'))
                    y = float(p.get('y'))
                else:
                    x = float(p.get(0))
                    y = float(p.get(1))
            else:
                x = float(getattr(p, 'x'))
                y = float(getattr(p, 'y'))
        except Exception:
            continue
        if not np.isfinite(x) or not np.isfinite(y):
            continue
        coords.append((x, y))
    if len(coords) < 3:
        return None

    try:
        poly = Polygon(coords)
        if poly.is_empty:
            return None
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty:
            return None
        return poly
    except Exception:
        return None


def _extract_faces_polygons(render: Optional[Dict[str, Any]]) -> List[Polygon]:
    r = render or {}

    # Preferred: plannedWorkfaceLoopsWorld / clippedFacesLoops: [{faceIndex, loop}]
    faces = r.get('clippedFacesLoops') or r.get('plannedWorkfaceLoopsWorld') or r.get('facesLoops')
    polys: List[Polygon] = []
    if isinstance(faces, list) and faces and isinstance(faces[0], dict) and 'loop' in faces[0]:
        for f in faces:
            poly = _loop_to_polygon(f.get('loop'))
            if poly is not None:
                polys.append(poly)
        return polys

    # Fallback: rectLoops: [loop, loop, ...]
    rect_loops = r.get('rectLoops')
    if isinstance(rect_loops, list):
        for loop in rect_loops:
            poly = _loop_to_polygon(loop)
            if poly is not None:
                polys.append(poly)
    return polys


def _extract_rect_faces_polygons(render: Optional[Dict[str, Any]]) -> List[Polygon]:
    """Extract axis-aligned rectLoops when available.

    This is used by cleanupResidual-like patching (which assumes rect faces).
    """

    r = render or {}
    rect_loops = r.get('rectLoops')
    polys: List[Polygon] = []
    if isinstance(rect_loops, list):
        for loop in rect_loops:
            poly = _loop_to_polygon(loop)
            if poly is not None:
                polys.append(poly)
    return polys


def _is_axis_aligned_rect(poly: Polygon, *, rel_tol: float = 1e-3) -> bool:
    try:
        if poly is None or poly.is_empty:
            return False
        minx, miny, maxx, maxy = poly.bounds
        if not all(np.isfinite(v) for v in [minx, miny, maxx, maxy]):
            return False
        if not (maxx > minx and maxy > miny):
            return False
        bbox_area = (maxx - minx) * (maxy - miny)
        if not np.isfinite(bbox_area) or bbox_area <= 0:
            return False
        a = float(poly.area)
        if not np.isfinite(a) or a <= 0:
            return False
        if abs(a - bbox_area) / bbox_area > rel_tol:
            return False
        # typical rectangle ring has 5 points (closed); allow a tiny bit more after buffer(0)
        try:
            n = len(list(poly.exterior.coords))
            if n > 8:
                return False
        except Exception:
            pass
        return True
    except Exception:
        return False


def _rect_from_bounds(minx: float, miny: float, maxx: float, maxy: float) -> Optional[Polygon]:
    try:
        if not all(np.isfinite(v) for v in [minx, miny, maxx, maxy]):
            return None
        if not (maxx > minx and maxy > miny):
            return None
        p = Polygon([(minx, miny), (maxx, miny), (maxx, maxy), (minx, maxy)])
        if p.is_empty:
            return None
        if not p.is_valid:
            p = p.buffer(0)
        return p if (p is not None and not getattr(p, 'is_empty', True)) else None
    except Exception:
        return None


def _cleanup_residual_patch_faces(
    *,
    omega: Polygon,
    base_faces: List[Polygon],
    axis: str,
    ws_hard: float,
    cfg: Dict[str, Any],
) -> List[Polygon]:
    """A lightweight, deterministic approximation of smartResource.worker.js cleanupResidual.

    Assumptions:
    - faces are axis-aligned rectangles
    - we only do whole-rectangle widening on the residual side (no segmented widths)

    The patch is intended for *tonnage display only*.
    """

    if omega is None or omega.is_empty:
        return base_faces
    if not base_faces:
        return base_faces

    enabled = bool(cfg.get('enabled', True))
    if not enabled:
        return base_faces

    try:
        max_faces = int(cfg.get('maxFacesToAdjust', 5) or 5)
    except Exception:
        max_faces = 5
    max_faces = int(np.clip(max_faces, 1, 12))

    try:
        max_repl = int(cfg.get('maxReplacements', 2) or 2)
    except Exception:
        max_repl = 2
    max_repl = int(np.clip(max_repl, 0, 6))

    try:
        delta_max = float(cfg.get('deltaBMaxM', cfg.get('deltaBMaxCleanupM', 10)) or 10)
    except Exception:
        delta_max = 10.0
    delta_max = max(0.0, float(delta_max))

    try:
        delta_step = float(cfg.get('deltaBStepM', 1) or 1)
    except Exception:
        delta_step = 1.0
    delta_step = float(np.clip(delta_step, 0.5, 10.0))

    ws = float(ws_hard) if np.isfinite(ws_hard) and ws_hard > 0 else 0.0

    a = 'y' if str(axis) == 'y' else 'x'
    w_axis = 'x' if a == 'y' else 'y'  # width direction

    # Normalize faces to rectangles and sort by width-axis position.
    rects: List[Tuple[float, float, float, float]] = []
    for p in base_faces:
        if not isinstance(p, Polygon) or p.is_empty:
            continue
        if not _is_axis_aligned_rect(p):
            return base_faces
        minx, miny, maxx, maxy = p.bounds
        rects.append((float(minx), float(miny), float(maxx), float(maxy)))
    if not rects:
        return base_faces

    def w_min(r: Tuple[float, float, float, float]) -> float:
        return r[0] if w_axis == 'x' else r[1]

    rects.sort(key=w_min)

    def rect_poly(r: Tuple[float, float, float, float]) -> Optional[Polygon]:
        return _rect_from_bounds(r[0], r[1], r[2], r[3])

    def rect_box_expand(r: Tuple[float, float, float, float], pad_a: float, pad_w: float) -> Optional[Polygon]:
        minx, miny, maxx, maxy = r
        if a == 'x':
            minx2, maxx2 = minx - pad_a, maxx + pad_a
            miny2, maxy2 = miny - pad_w, maxy + pad_w
        else:
            minx2, maxx2 = minx - pad_w, maxx + pad_w
            miny2, maxy2 = miny - pad_a, maxy + pad_a
        return _rect_from_bounds(minx2, miny2, maxx2, maxy2)

    def intersects_any(idx: int, cand: Tuple[float, float, float, float]) -> bool:
        pc = rect_poly(cand)
        if pc is None or pc.is_empty:
            return True
        for j, rj in enumerate(rects):
            if j == idx:
                continue
            pj = rect_poly(rj)
            if pj is None or pj.is_empty:
                continue
            try:
                inter = pc.intersection(pj)
                if inter is not None and not inter.is_empty and float(inter.area) > 1e-6:
                    return True
            except Exception:
                continue
        return False

    # iterative improvements
    for _rep in range(max_repl):
        try:
            union0 = unary_union([rect_poly(r) for r in rects if rect_poly(r) is not None])
        except Exception:
            break
        if union0 is None or getattr(union0, 'is_empty', True):
            break
        try:
            residual = omega.difference(union0)
        except Exception:
            residual = None
        if residual is None or getattr(residual, 'is_empty', True):
            break
        r_area = float(getattr(residual, 'area', 0.0) or 0.0)
        if not (np.isfinite(r_area) and r_area > 1e-6):
            break

        # score faces by nearby residual area
        scores: List[Tuple[float, int]] = []
        for i, r in enumerate(rects):
            minx, miny, maxx, maxy = r
            len_a = (maxx - minx) if a == 'x' else (maxy - miny)
            len_w = (maxy - miny) if w_axis == 'y' else (maxx - minx)
            pad_a = max(5.0, min(60.0, float(len_a) * 0.15))
            pad_w = max(5.0, min(60.0, float(len_w) * 0.30))
            win = rect_box_expand(r, pad_a, pad_w)
            if win is None:
                continue
            try:
                near = residual.intersection(win)
                a0 = float(getattr(near, 'area', 0.0) or 0.0)
            except Exception:
                a0 = 0.0
            if np.isfinite(a0) and a0 > 1e-6:
                scores.append((a0, i))
        scores.sort(reverse=True)
        target = [i for _a0, i in scores[:max_faces]]
        if not target:
            break

        best_move = None
        for idx in target:
            r = rects[idx]
            minx, miny, maxx, maxy = r
            # determine residual side using centroid of nearby residual
            len_a = (maxx - minx) if a == 'x' else (maxy - miny)
            len_w = (maxy - miny) if w_axis == 'y' else (maxx - minx)
            pad_a = max(1.0, min(20.0, float(len_w) * 0.2))
            win = rect_box_expand(r, pad_a, pad_a)
            if win is None:
                continue
            try:
                near = residual.intersection(win)
                if near is None or near.is_empty:
                    continue
                cy = float(near.centroid.x if w_axis == 'x' else near.centroid.y)
            except Exception:
                continue
            mid = ((minx + maxx) / 2.0) if w_axis == 'x' else ((miny + maxy) / 2.0)
            side = 'top' if cy >= mid else 'bottom'

            # neighbor constraints along width axis
            min_allowed = -1e30
            max_allowed = 1e30
            if idx - 1 >= 0:
                prev = rects[idx - 1]
                prev_max_w = prev[2] if w_axis == 'x' else prev[3]
                min_allowed = float(prev_max_w + ws)
            if idx + 1 < len(rects):
                nxt = rects[idx + 1]
                next_min_w = nxt[0] if w_axis == 'x' else nxt[1]
                max_allowed = float(next_min_w - ws)

            # base width
            baseB = len_w
            if not (np.isfinite(baseB) and baseB > 0):
                continue

            d = 0.0
            while d <= delta_max + 1e-9:
                # build widened rect
                if w_axis == 'y':
                    if side == 'top':
                        y0 = miny
                        y1 = min(max_allowed, y0 + baseB + d)
                    else:
                        y1 = maxy
                        y0 = max(min_allowed, y1 - (baseB + d))
                    cand = (minx, y0, maxx, y1)
                else:
                    if side == 'top':
                        x0 = minx
                        x1 = min(max_allowed, x0 + baseB + d)
                    else:
                        x1 = maxx
                        x0 = max(min_allowed, x1 - (baseB + d))
                    cand = (x0, miny, x1, maxy)

                pc = rect_poly(cand)
                if pc is None or pc.is_empty:
                    d += delta_step
                    continue
                if intersects_any(idx, cand):
                    d += delta_step
                    continue
                try:
                    gain = residual.intersection(pc)
                    gainA = float(getattr(gain, 'area', 0.0) or 0.0)
                except Exception:
                    gainA = 0.0
                if not (np.isfinite(gainA) and gainA > 1e-6):
                    d += delta_step
                    continue
                score = float(gainA - (abs(d) * 0.01))
                if best_move is None or score > best_move['score'] + 1e-9:
                    best_move = {'idx': idx, 'cand': cand, 'score': score}
                d += delta_step

        if best_move is None:
            break
        rects[best_move['idx']] = best_move['cand']

    # build polygons
    out: List[Polygon] = []
    for r in rects:
        p = rect_poly(r)
        if p is not None and not p.is_empty:
            out.append(p)
    return out if out else base_faces


def _extract_omega_polygon(candidates: List[SmartResourceCandidateIn]) -> Optional[Polygon]:
    if not candidates:
        return None
    r = candidates[0].render or {}
    omega_loops = r.get('omegaLoops')
    if isinstance(omega_loops, list):
        polys: List[Polygon] = []
        for loop in omega_loops:
            poly = _loop_to_polygon(loop)
            if poly is not None:
                polys.append(poly)
        if not polys:
            return None
        try:
            u = unary_union(polys)
            if u is None or getattr(u, 'is_empty', True):
                return None
            # ensure polygon-like
            if isinstance(u, Polygon):
                return u
            # MultiPolygon / GeometryCollection: take as-is bounds/area OK; downstream expects Polygon
            # For simplicity: buffer(0) often converts to Polygon/MultiPolygon cleanly.
            try:
                u2 = u.buffer(0)
                if isinstance(u2, Polygon) and not u2.is_empty:
                    return u2
            except Exception:
                pass
            # fallback: pick largest polygon part
            if hasattr(u, 'geoms'):
                parts = [g for g in list(getattr(u, 'geoms', [])) if isinstance(g, Polygon) and not g.is_empty]
                if parts:
                    parts.sort(key=lambda p: float(getattr(p, 'area', 0.0) or 0.0), reverse=True)
                    return parts[0]
            return None
        except Exception:
            return polys[0]
    return None


def _extract_omega_polygon_from_render(render: Optional[Dict[str, Any]]) -> Optional[Polygon]:
    r = render or {}
    omega_loops = r.get('omegaLoops')
    if not isinstance(omega_loops, list) or not omega_loops:
        return None
    polys: List[Polygon] = []
    for loop in omega_loops:
        poly = _loop_to_polygon(loop)
        if poly is not None:
            polys.append(poly)
    if not polys:
        return None
    try:
        u = unary_union(polys)
        if u is None or getattr(u, 'is_empty', True):
            return None
        if isinstance(u, Polygon):
            return u
        try:
            u2 = u.buffer(0)
            if isinstance(u2, Polygon) and not u2.is_empty:
                return u2
        except Exception:
            pass
        if hasattr(u, 'geoms'):
            parts = [g for g in list(getattr(u, 'geoms', [])) if isinstance(g, Polygon) and not g.is_empty]
            if parts:
                parts.sort(key=lambda p: float(getattr(p, 'area', 0.0) or 0.0), reverse=True)
                return parts[0]
        return None
    except Exception:
        return polys[0]


# -----------------------------
# Thickness sampler
# -----------------------------


def _has_valid_grid_cell(field: List[List[float]]) -> bool:
    try:
        for row in field:
            for v in row:
                vv = float(v)
                if np.isfinite(vv) and vv > 0:
                    return True
    except Exception:
        return False
    return False


class _ThicknessSampler:
    def __init__(self, thickness: Optional[ThicknessPayload]):
        self.rho = 1.0
        self.kind = 'none'
        self._constant = None

        self._field = None
        self._gridH = 0
        self._gridW = 0
        self._width = 320.0
        self._height = 220.0
        self._pad = 14.0
        self._minX = 0.0
        self._maxX = 1.0
        self._minY = 0.0
        self._maxY = 1.0

        if thickness is None:
            return

        rho = thickness.rho
        if rho is not None and np.isfinite(rho) and rho > 0:
            self.rho = float(rho)

        c = thickness.constantM
        if c is not None and np.isfinite(c) and c > 0:
            self.kind = 'constant'
            self._constant = float(c)
            return

        pack = thickness.fieldPack
        if pack is None or pack.field is None:
            return

        field = pack.field
        if not isinstance(field, list) or not field or not isinstance(field[0], list):
            return

        gridH = len(field)
        gridW = len(field[0]) if gridH else 0
        if gridH < 2 or gridW < 2:
            return

        # ensure rectangular
        if any((not isinstance(r, list) or len(r) != gridW) for r in field):
            return

        if not _has_valid_grid_cell(field):
            return

        bounds = pack.bounds or {}
        try:
            minX = float(bounds.get('minX'))
            maxX = float(bounds.get('maxX'))
            minY = float(bounds.get('minY'))
            maxY = float(bounds.get('maxY'))
        except Exception:
            return

        if not all(np.isfinite(v) for v in [minX, maxX, minY, maxY]):
            return

        self._field = np.asarray(field, dtype=float)
        self._gridH = int(gridH)
        self._gridW = int(gridW)
        self._width = float(pack.width or 320)
        self._height = float(pack.height or 220)

        pad = pack.pad
        if pad is None:
            # some payloads put pad inside bounds
            pad = bounds.get('pad', 14)
        self._pad = float(pad or 14)

        self._minX = minX
        self._maxX = maxX
        self._minY = minY
        self._maxY = maxY

        self.kind = 'grid'

    @property
    def has_thickness(self) -> bool:
        return self.kind in ('constant', 'grid')

    def sample_many(self, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        if self.kind == 'constant':
            return np.full_like(xs, fill_value=float(self._constant), dtype=float)
        if self.kind != 'grid' or self._field is None:
            return np.full_like(xs, fill_value=np.nan, dtype=float)

        # mirror frontend mapping (see smartResource.worker.js buildThicknessSampler)
        minX, maxX, minY, maxY = self._minX, self._maxX, self._minY, self._maxY
        width, height, pad = self._width, self._height, self._pad
        gridW, gridH = self._gridW, self._gridH

        # sx, sy in pixel space
        sx = pad + ((xs - minX) / ((maxX - minX) or 1.0)) * (width - pad * 2)
        sy = pad + (1.0 - (ys - minY) / ((maxY - minY) or 1.0)) * (height - pad * 2)

        gx = np.clip((sx / width) * (gridW - 1), 0, gridW - 1)
        gy = np.clip((sy / height) * (gridH - 1), 0, gridH - 1)

        i0 = np.floor(gx).astype(int)
        j0 = np.floor(gy).astype(int)
        i1 = np.clip(i0 + 1, 0, gridW - 1)
        j1 = np.clip(j0 + 1, 0, gridH - 1)

        tx = gx - i0
        ty = gy - j0

        f = self._field
        v00 = f[j0, i0]
        v10 = f[j0, i1]
        v01 = f[j1, i0]
        v11 = f[j1, i1]

        # treat <=0 or non-finite as nodata (match frontend "v>0")
        def valid(v: np.ndarray) -> np.ndarray:
            return np.isfinite(v) & (v > 0)

        m00 = valid(v00)
        m10 = valid(v10)
        m01 = valid(v01)
        m11 = valid(v11)

        # bilinear with masked neighbors; fallback to nearest valid
        w00 = (1 - tx) * (1 - ty)
        w10 = tx * (1 - ty)
        w01 = (1 - tx) * ty
        w11 = tx * ty

        w = np.zeros_like(xs, dtype=float)
        acc = np.zeros_like(xs, dtype=float)

        for vv, mm, ww in [(v00, m00, w00), (v10, m10, w10), (v01, m01, w01), (v11, m11, w11)]:
            ww2 = np.where(mm, ww, 0.0)
            acc += ww2 * vv
            w += ww2

        out = np.where(w > 1e-12, acc / w, np.nan)
        return out


# -----------------------------
# Core tonnage computation
# -----------------------------


def _compute_tonnage_for_candidate(
    omega: Polygon,
    faces: List[Polygon],
    sampler: _ThicknessSampler,
    sample_step_m: float,
) -> Tuple[float, str, List[str]]:
    warnings: List[str] = []
    if omega is None or omega.is_empty:
        return 0.0, 'empty-omega', ['OMEGA_EMPTY']
    if not faces:
        return 0.0, 'empty-faces', ['FACES_EMPTY']

    try:
        face_union = unary_union(faces)
    except Exception:
        face_union = None

    if face_union is None or getattr(face_union, 'is_empty', True):
        return 0.0, 'empty-union', ['UNION_EMPTY']

    try:
        mined = omega.intersection(face_union)
    except Exception:
        mined = face_union

    if mined is None or getattr(mined, 'is_empty', True):
        return 0.0, 'empty-mined', ['MINED_EMPTY']

    # constant thickness => exact
    if sampler.kind == 'constant':
        t = float(getattr(mined, 'area', 0.0) or 0.0) * float(sampler._constant) * float(sampler.rho)
        return max(0.0, t), 'constant-exact', warnings

    if sampler.kind != 'grid':
        return 0.0, 'no-thickness', ['THICKNESS_MISSING']

    # sampling integration
    minx, miny, maxx, maxy = mined.bounds
    step = float(sample_step_m)
    if not np.isfinite(step) or step <= 0:
        step = 20.0

    # keep step in reasonable range
    step = float(np.clip(step, 5.0, 60.0))

    xs = np.arange(minx + step / 2.0, maxx, step, dtype=float)
    ys = np.arange(miny + step / 2.0, maxy, step, dtype=float)
    if xs.size == 0 or ys.size == 0:
        return 0.0, 'sampling-empty-grid', ['SAMPLE_GRID_EMPTY']

    # vectorized contains if available
    X, Y = np.meshgrid(xs, ys)
    Xf = X.ravel()
    Yf = Y.ravel()

    try:
        from shapely import vectorized  # type: ignore

        mask = vectorized.contains(mined, Xf, Yf)
    except Exception:
        # fallback: slower loop
        mask = np.zeros_like(Xf, dtype=bool)
        for i in range(Xf.size):
            try:
                mask[i] = bool(mined.contains(Point(float(Xf[i]), float(Yf[i]))))
            except Exception:
                mask[i] = False

    if not mask.any():
        return 0.0, 'sampling-no-points-inside', ['NO_SAMPLE_POINT_INSIDE']

    thk = sampler.sample_many(Xf[mask], Yf[mask])
    thk = np.where(np.isfinite(thk) & (thk > 0), thk, 0.0)

    cell_area = step * step
    tonnage = float(thk.sum() * cell_area * float(sampler.rho))
    if tonnage <= 0:
        warnings.append('TONNAGE_ZERO_OR_NEG')
    return max(0.0, tonnage), 'grid-sampling', warnings


def _compare_by_recovery(item: Dict[str, Any]) -> Tuple:
    # sort key: qualified desc, recoveryScore desc, tonnage desc, coverage desc, N asc, lenCV asc, signature asc
    qa = bool(item.get('qualified') is True)
    s = float(item.get('recoveryScore') or 0.0)
    t = float(item.get('tonnageTotal') or 0.0)
    cov = float(item.get('coverageRatio') or 0.0)
    n = int(item.get('N') or 10**9)
    lencv = float(item.get('lenCV') or 0.0)
    sig = str(item.get('signature') or '')
    return (0 if qa else 1, -s, -t, -cov, n, lencv, sig)


@router.post('/planning/smart-resource/tonnage', response_model=SmartResourceTonnageResponse)
def smart_resource_tonnage(req: SmartResourceTonnageRequest) -> SmartResourceTonnageResponse:
    t0 = time.time()

    sampler = _ThicknessSampler(req.thickness)
    has_thk = sampler.has_thickness
    fallback_mode = 'TONNAGE' if has_thk else 'AREA'

    # -----------------------------
    # Optional diagnostics
    # -----------------------------
    debug_sig_set: Optional[set] = None
    if bool(req.debug):
        try:
            if isinstance(req.debugSignatures, list):
                cleaned = [str(s).strip() for s in req.debugSignatures if str(s).strip()]
                if cleaned:
                    debug_sig_set = set(cleaned)
        except Exception:
            debug_sig_set = None

    debug_info: Optional[Dict[str, Any]] = None
    if bool(req.debug):
        debug_info = {'perCandidate': {}}
        try:
            if sampler.kind == 'grid' and sampler._field is not None:
                f = sampler._field
                m = np.isfinite(f) & (f > 0)
                valid = f[m]
                if valid.size:
                    debug_info['thicknessFieldStats'] = {
                        'kind': 'grid',
                        'rho': float(sampler.rho),
                        'gridW': int(sampler._gridW),
                        'gridH': int(sampler._gridH),
                        'validCount': int(valid.size),
                        'min': float(np.min(valid)),
                        'max': float(np.max(valid)),
                        'mean': float(np.mean(valid)),
                    }
                else:
                    debug_info['thicknessFieldStats'] = {
                        'kind': 'grid',
                        'rho': float(sampler.rho),
                        'gridW': int(sampler._gridW),
                        'gridH': int(sampler._gridH),
                        'validCount': 0,
                    }
            elif sampler.kind == 'constant':
                debug_info['thicknessFieldStats'] = {
                    'kind': 'constant',
                    'rho': float(sampler.rho),
                    'constantM': float(sampler._constant) if sampler._constant is not None else None,
                }
            else:
                debug_info['thicknessFieldStats'] = {
                    'kind': 'none',
                    'rho': float(sampler.rho),
                }
        except Exception:
            pass

    omega_shared = _extract_omega_polygon(req.candidates)
    warnings: List[str] = []
    if omega_shared is None:
        warnings.append('OMEGA_MISSING')

    sample_step = req.sampleStepM
    if sample_step is None:
        # prefer request thickness.gridRes when present (frontend sends 20)
        try:
            sample_step = float(req.thickness.gridRes) if req.thickness and req.thickness.gridRes else 20.0
        except Exception:
            sample_step = 20.0

    enriched: List[Dict[str, Any]] = []
    tonnage_by_sig: Dict[str, float] = {}
    coverage_by_sig: Dict[str, float] = {}
    eng_by_sig: Dict[str, float] = {}

    patch_sig_set: Optional[set] = None
    try:
        if isinstance(req.preferPatchedSignatures, list):
            cleaned = [str(s).strip() for s in req.preferPatchedSignatures if str(s).strip()]
            if cleaned:
                patch_sig_set = set(cleaned)
    except Exception:
        patch_sig_set = None

    for c in req.candidates:
        sig = str(c.signature)
        render = c.render or {}
        faces = _extract_faces_polygons(render)

        # 口径统一：允许每个候选携带自己的 omegaLoops（例如前端已做扣煤柱/有效Ω裁剪）。
        omega = _extract_omega_polygon_from_render(render) or omega_shared

        ton = 0.0
        method = 'no-thickness'
        w_local: List[str] = []
        if omega is not None:
            # Optional: for efficiency/disturbance cross-mode display, compute tonnage on a patched
            # mining shape (approximate cleanupResidual) based on rectLoops.
            do_patch = bool(req.preferPatched) and (patch_sig_set is None or sig in patch_sig_set)
            if do_patch:
                try:
                    rect_faces = _extract_rect_faces_polygons(render)
                    base_for_patch = rect_faces if rect_faces else faces
                    axis = str(c.axis or render.get('axis') or 'x')
                    ws_hard = float(c.ws) if c.ws is not None and np.isfinite(float(c.ws)) else 0.0
                    cfg = req.cleanupResidual if isinstance(req.cleanupResidual, dict) else {'enabled': True}
                    patched = _cleanup_residual_patch_faces(
                        omega=omega,
                        base_faces=base_for_patch,
                        axis=axis,
                        ws_hard=ws_hard,
                        cfg=cfg,
                    )
                    faces_use = patched if patched else faces
                except Exception:
                    faces_use = faces
            else:
                faces_use = faces
            ton, method, w_local = _compute_tonnage_for_candidate(omega, faces_use, sampler, float(sample_step))

            if debug_info is not None and (debug_sig_set is None or sig in debug_sig_set):
                try:
                    face_union = unary_union(faces_use) if faces_use else None
                    mined = omega.intersection(face_union) if (face_union is not None and not getattr(face_union, 'is_empty', True)) else None
                    mined_area = float(getattr(mined, 'area', 0.0) or 0.0) if mined is not None else 0.0
                    mean_thk = None
                    if mined_area > 1e-9 and float(sampler.rho) > 0:
                        mean_thk = float(ton / (mined_area * float(sampler.rho)))
                    debug_info['perCandidate'][sig] = {
                        'minedArea': mined_area,
                        'meanThicknessM': mean_thk,
                        'rho': float(sampler.rho),
                        'samplerKind': str(sampler.kind),
                        'patchedUsed': bool(do_patch),
                        'sampleStepM': float(sample_step),
                    }
                except Exception:
                    pass
        else:
            w_local = ['OMEGA_MISSING']

        tonnage_by_sig[sig] = float(ton)

        # coverage: prefer effective coverage when provided
        cov = c.coverageRatioEff if c.coverageRatioEff is not None else c.coverageRatio
        cov = float(cov) if cov is not None else 0.0
        cov = float(np.clip(cov, 0.0, 1.0))
        coverage_by_sig[sig] = cov

        # engineering: build a stable 0-1 score from available signals
        n_val = int(c.N) if c.N is not None else None
        len_cv = float(c.lenCV) if c.lenCV is not None else None
        abn = int(c.abnormalFaceCount) if c.abnormalFaceCount is not None else 0
        bmin = float(c.BMin) if c.BMin is not None else None
        bmax = float(c.BMax) if c.BMax is not None else None
        b_range = max(0.0, (bmax - bmin)) if (bmin is not None and bmax is not None and np.isfinite(bmin) and np.isfinite(bmax)) else 0.0

        # sub-scores (all in [0,1])
        if len_cv is None or not np.isfinite(len_cv) or len_cv < 0:
            s_len = 0.5
        else:
            s_len = float(math.exp(-((len_cv / 0.25) ** 2)))

        if abn < 0:
            abn = 0
        s_abn = float(math.exp(-(abn / 2.0)))

        s_b = float(math.exp(-((b_range / 6.0) ** 2)))

        if n_val is None or n_val < 1:
            s_n = 0.5
        elif 4 <= n_val <= 7:
            s_n = 1.0
        elif n_val < 4:
            s_n = float(math.exp(-((4 - n_val) / 2.0)))
        else:
            s_n = float(math.exp(-((n_val - 7) / 3.0)))

        s_eng = 0.35 * s_len + 0.25 * s_abn + 0.20 * s_b + 0.20 * s_n
        eng_by_sig[sig] = float(np.clip(s_eng, 0.0, 1.0))
        enriched.append(
            {
                'signature': sig,
                'qualified': bool(c.qualified) if c.qualified is not None else False,
                'coverageRatio': cov,
                'N': int(c.N) if c.N is not None else None,
                'lenCV': float(c.lenCV) if c.lenCV is not None else 0.0,
                'tonnageTotal': float(ton),
            }
        )
        warnings.extend(w_local)

    # compute composite recoveryScore (0-100)
    w_t = float(req.wTonnage) if req.wTonnage is not None else 0.55
    w_c = float(req.wCoverage) if req.wCoverage is not None else 0.30
    w_e = float(req.wEngineering) if req.wEngineering is not None else 0.15
    w_t = max(0.0, w_t)
    w_c = max(0.0, w_c)
    w_e = max(0.0, w_e)

    # tonnage normalization: log1p to reduce outlier domination
    ts = [v for v in tonnage_by_sig.values() if np.isfinite(v) and v >= 0]
    log_ts = [math.log1p(float(v)) for v in ts] if ts else []
    ltmin = float(min(log_ts)) if log_ts else 0.0
    ltmax = float(max(log_ts)) if log_ts else 0.0

    full_min = float(req.fullCoverMin) if req.fullCoverMin is not None else None
    floor = float(req.fullCoverPenaltyFloor) if req.fullCoverPenaltyFloor is not None else None
    if full_min is not None and not (np.isfinite(full_min) and 0.0 < full_min <= 1.0):
        full_min = None
    if floor is not None and not (np.isfinite(floor) and 0.0 <= floor < 1.0):
        floor = None
    if full_min is not None and floor is None:
        floor = max(0.0, full_min - 0.05)

    def _norm01(x: float, a: float, b: float) -> float:
        if not (np.isfinite(x) and np.isfinite(a) and np.isfinite(b)):
            return 0.0
        if b <= a + 1e-12:
            return 1.0
        return float(np.clip((x - a) / (b - a), 0.0, 1.0))

    scores: Dict[str, float] = {}
    for c in req.candidates:
        sig = str(c.signature)
        cov = float(coverage_by_sig.get(sig, 0.0))
        s_cov = float(np.clip(cov, 0.0, 1.0))
        s_eng = float(np.clip(eng_by_sig.get(sig, 0.5), 0.0, 1.0))

        # tonnage score only meaningful when thickness exists
        tval = float(tonnage_by_sig.get(sig, 0.0))
        s_ton = 0.0
        if fallback_mode == 'TONNAGE' and np.isfinite(tval) and tval >= 0 and ltmax > ltmin + 1e-12:
            s_ton = _norm01(math.log1p(tval), ltmin, ltmax)
        elif fallback_mode == 'TONNAGE' and np.isfinite(tval) and tval >= 0 and log_ts:
            s_ton = 1.0

        # if no tonnage signal, renormalize weights across coverage+engineering
        if fallback_mode != 'TONNAGE':
            denom = (w_c + w_e) if (w_c + w_e) > 1e-12 else 1.0
            wt = 0.0
            wc = w_c / denom
            we = w_e / denom
        else:
            denom = (w_t + w_c + w_e) if (w_t + w_c + w_e) > 1e-12 else 1.0
            wt = w_t / denom
            wc = w_c / denom
            we = w_e / denom

        # allow but penalize when below fullCoverMin (if provided)
        # 口径优化（2026-01-22）：不再把整分乘小（会让 Top1 看起来偏低），
        # 改为仅对 coverage 子项做“温和惩罚”（smoothstep + 最低系数）。
        s_cov_eff = s_cov
        if full_min is not None and cov < full_min - 1e-12:
            f0 = float(floor) if floor is not None else max(0.0, full_min - 0.05)
            t = _norm01(cov, f0, full_min)
            # smoothstep: 3t^2 - 2t^3
            smooth = float(t * t * (3.0 - 2.0 * t))
            min_factor = 0.85
            factor = float(min_factor + (1.0 - min_factor) * smooth)
            s_cov_eff = float(np.clip(s_cov * factor, 0.0, 1.0))

        base = wt * s_ton + wc * s_cov_eff + we * s_eng

        # display calibration (no normalization across candidates):
        # keep relative differences from weights, but make Top1 look "naturally" in the 90s.
        # base∈[0,1] -> calibrated∈[0.45,1.0]
        calibrated = 0.45 + 0.55 * float(np.clip(base, 0.0, 1.0))
        scores[sig] = float(np.clip(100.0 * calibrated, 0.0, 98.0))

    # attach recoveryScore to enriched for sorting
    for e in enriched:
        e['recoveryScore'] = float(scores.get(str(e.get('signature') or ''), 0.0))

    # NOTE: no per-batch normalization here by design.

    # rank
    enriched_sorted = sorted(enriched, key=_compare_by_recovery)
    ranked_sigs = [e['signature'] for e in enriched_sorted]

    elapsed_ms = (time.time() - t0) * 1000.0

    return SmartResourceTonnageResponse(
        ok=True,
        cacheKey=req.cacheKey,
        hasThickness=has_thk,
        fallbackMode=fallback_mode,
        elapsedMs=float(elapsed_ms),
        rankedSignatures=ranked_sigs[: int(req.topK or 10)],
        tonnageBySignature=tonnage_by_sig,
        recoveryScoreBySignature=scores,
        tMin=float(min(ts)) if ts else 0.0,
        tMax=float(max(ts)) if ts else 0.0,
        method='grid-sampling' if sampler.kind == 'grid' else ('constant-exact' if sampler.kind == 'constant' else 'no-thickness'),
        warnings=sorted(list({w for w in warnings if w})),
        debugInfo=debug_info,
    )
