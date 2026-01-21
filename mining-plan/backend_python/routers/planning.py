from __future__ import annotations

import math
import time
from typing import Any, Dict, List, Literal, Optional, Tuple

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

router = APIRouter()


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
    N: Optional[int] = None
    lenCV: Optional[float] = None

    axis: Optional[str] = None
    thetaDeg: Optional[float] = None
    ws: Optional[float] = None

    render: Optional[Dict[str, Any]] = None


class SmartResourceTonnageRequest(BaseModel):
    cacheKey: str = ''
    candidates: List[SmartResourceCandidateIn] = Field(default_factory=list)
    thickness: Optional[ThicknessPayload] = None

    # optional knobs
    topK: Optional[int] = 10
    sampleStepM: Optional[float] = None


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
    return json.loads(out)


def _run_node_smart_resource(payload: Dict[str, Any], timeout_s: float = 120.0) -> Dict[str, Any]:
    root = _repo_root()
    script = root / 'tools' / 'run-smart-resource.mjs'
    if not script.exists():
        raise RuntimeError(f'Node harness not found: {script}')

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
    return json.loads(out)


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
            x = float(p.get('x')) if isinstance(p, dict) else float(getattr(p, 'x'))
            y = float(p.get('y')) if isinstance(p, dict) else float(getattr(p, 'y'))
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


def _extract_omega_polygon(candidates: List[SmartResourceCandidateIn]) -> Optional[Polygon]:
    if not candidates:
        return None
    r = candidates[0].render or {}
    omega_loops = r.get('omegaLoops')
    if isinstance(omega_loops, list):
        # choose first valid loop
        for loop in omega_loops:
            poly = _loop_to_polygon(loop)
            if poly is not None:
                return poly
    return None


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
    # sort key: qualified desc, tonnage desc, coverage desc, N asc, lenCV asc, signature asc
    qa = bool(item.get('qualified') is True)
    t = float(item.get('tonnageTotal') or 0.0)
    cov = float(item.get('coverageRatio') or 0.0)
    n = int(item.get('N') or 10**9)
    lencv = float(item.get('lenCV') or 0.0)
    sig = str(item.get('signature') or '')
    return (0 if qa else 1, -t, -cov, n, lencv, sig)


@router.post('/planning/smart-resource/tonnage', response_model=SmartResourceTonnageResponse)
def smart_resource_tonnage(req: SmartResourceTonnageRequest) -> SmartResourceTonnageResponse:
    t0 = time.time()

    sampler = _ThicknessSampler(req.thickness)
    has_thk = sampler.has_thickness
    fallback_mode = 'TONNAGE' if has_thk else 'AREA'

    omega = _extract_omega_polygon(req.candidates)
    warnings: List[str] = []
    if omega is None:
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

    for c in req.candidates:
        sig = str(c.signature)
        render = c.render or {}
        faces = _extract_faces_polygons(render)

        ton = 0.0
        method = 'no-thickness'
        w_local: List[str] = []
        if omega is not None:
            ton, method, w_local = _compute_tonnage_for_candidate(omega, faces, sampler, float(sample_step))
        else:
            w_local = ['OMEGA_MISSING']

        tonnage_by_sig[sig] = float(ton)
        enriched.append(
            {
                'signature': sig,
                'qualified': bool(c.qualified) if c.qualified is not None else False,
                'coverageRatio': float(c.coverageRatio) if c.coverageRatio is not None else 0.0,
                'N': int(c.N) if c.N is not None else None,
                'lenCV': float(c.lenCV) if c.lenCV is not None else 0.0,
                'tonnageTotal': float(ton),
            }
        )
        warnings.extend(w_local)

    # compute recoveryScore (0-100) in TONNAGE mode; fallback to coverage% in AREA mode
    scores: Dict[str, float] = {}
    ts = [v for v in tonnage_by_sig.values() if np.isfinite(v)]
    tmin = float(min(ts)) if ts else 0.0
    tmax = float(max(ts)) if ts else 0.0

    if fallback_mode == 'TONNAGE' and tmax > tmin + 1e-9:
        for sig, tval in tonnage_by_sig.items():
            scores[sig] = float(np.clip(100.0 * ((tval - tmin) / (tmax - tmin)), 0.0, 100.0))
    elif fallback_mode == 'TONNAGE' and ts:
        for sig in tonnage_by_sig.keys():
            scores[sig] = 100.0
    else:
        # AREA
        for c in req.candidates:
            r = float(c.coverageRatio) if c.coverageRatio is not None else 0.0
            scores[str(c.signature)] = float(np.clip(r * 100.0, 0.0, 100.0))

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
        tMin=tmin,
        tMax=tmax,
        method='grid-sampling' if sampler.kind == 'grid' else ('constant-exact' if sampler.kind == 'constant' else 'no-thickness'),
        warnings=sorted(list({w for w in warnings if w})),
    )
