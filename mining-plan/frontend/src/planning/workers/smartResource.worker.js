import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import SnapIfNeededOverlayOp from 'jsts/org/locationtech/jts/operation/overlay/snap/SnapIfNeededOverlayOp.js';
import AffineTransformation from 'jsts/org/locationtech/jts/geom/util/AffineTransformation.js';

const gf = new GeometryFactory();

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const uniqNums = (arr, eps = 1e-9) => {
  const out = [];
  for (const x of arr) {
    if (!Number.isFinite(x)) continue;
    if (out.every((y) => Math.abs(y - x) > eps)) out.push(x);
  }
  return out;
};

const meanOf = (arr) => {
  const xs = Array.isArray(arr) ? arr.map((v) => Number(v)).filter(Number.isFinite) : [];
  if (!xs.length) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
};

const stdOf = (arr) => {
  const xs = Array.isArray(arr) ? arr.map((v) => Number(v)).filter(Number.isFinite) : [];
  if (!xs.length) return null;
  const m = meanOf(xs);
  if (!(Number.isFinite(m))) return null;
  const v = xs.reduce((s, x) => {
    const d = x - m;
    return s + d * d;
  }, 0) / xs.length;
  const out = Math.sqrt(Math.max(0, v));
  return Number.isFinite(out) ? out : null;
};

const thetaStatsDeg = (thetaDegList) => {
  const ths = Array.isArray(thetaDegList) ? thetaDegList.map((x) => Number(x)).filter(Number.isFinite) : [];
  if (!ths.length) return { thetaStdDeg: null, maxAbsThetaDeg: null, sumAbsDeltaThetaDeg: null };
  const thetaStdDeg = stdOf(ths);
  const maxAbsThetaDeg = ths.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  let sumAbsDeltaThetaDeg = 0;
  for (let i = 1; i < ths.length; i++) sumAbsDeltaThetaDeg += Math.abs(ths[i] - ths[i - 1]);
  return {
    thetaStdDeg: Number.isFinite(thetaStdDeg) ? thetaStdDeg : null,
    maxAbsThetaDeg: Number.isFinite(maxAbsThetaDeg) ? maxAbsThetaDeg : null,
    sumAbsDeltaThetaDeg: Number.isFinite(sumAbsDeltaThetaDeg) ? sumAbsDeltaThetaDeg : null,
  };
};

const sampleRange3 = (minV, maxV) => {
  const a = Math.max(0, Number(minV) || 0);
  const b = Math.max(0, Number(maxV) || 0);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const mid = (lo + hi) / 2;
  return uniqNums([lo, mid, hi]);
};

const dist2 = (a, b) => {
  const dx = Number(a?.x) - Number(b?.x);
  const dy = Number(a?.y) - Number(b?.y);
  return dx * dx + dy * dy;
};

const signedAreaShoelace = (closedPts) => {
  const pts = Array.isArray(closedPts) ? closedPts : [];
  if (pts.length < 4) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    sum += Number(a?.x) * Number(b?.y) - Number(b?.x) * Number(a?.y);
  }
  return sum / 2;
};

// 规范化边界点：去噪/闭合/方向
const normalizeBoundaryPoints = (points, eps = 1e-6) => {
  try {
    const raw = (points ?? [])
      .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

    if (raw.length < 3) {
      return { ok: false, reason: '采区边界点不足/退化', points: [], closed: false, pointCount: raw.length, area: 0 };
    }

    const eps2 = eps * eps;
    const cleaned = [];
    for (const p of raw) {
      if (!cleaned.length) {
        cleaned.push(p);
        continue;
      }
      const prev = cleaned[cleaned.length - 1];
      if (dist2(prev, p) <= eps2) continue;
      cleaned.push(p);
    }

    // 去掉末尾与首点重合的重复点（后面会统一闭合）
    if (cleaned.length >= 2 && dist2(cleaned[0], cleaned[cleaned.length - 1]) <= eps2) {
      cleaned.pop();
    }

    if (cleaned.length < 3) {
      return { ok: false, reason: '采区边界点不足/退化', points: [], closed: false, pointCount: cleaned.length, area: 0 };
    }

    const closed = [...cleaned, cleaned[0]];
    if (closed.length < 4) {
      return { ok: false, reason: '采区边界点不足/未闭合/退化', points: [], closed: false, pointCount: closed.length, area: 0 };
    }

    const area = signedAreaShoelace(closed);
    if (!(Math.abs(area) > 1e-9)) {
      return { ok: false, reason: '采区边界退化（面积≈0）', points: [], closed: true, pointCount: closed.length, area };
    }

    // 约定外环 CCW（area > 0）
    let out = closed;
    if (area < 0) {
      const core = closed.slice(0, -1).reverse();
      out = [...core, core[0]];
    }

    return { ok: true, points: out, closed: true, pointCount: out.length, area };
  } catch (e) {
    return { ok: false, reason: `normalizeBoundaryPoints异常: ${String(e?.message ?? e)}`, points: [], closed: false, pointCount: 0, area: 0 };
  }
};

const computeBbox = (pts) => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const p of pts ?? []) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    count += 1;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!count || !Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }
  return { minX, maxX, minY, maxY };
};

const buildPolygonLocalFromNormalized = (closedPts) => {
  const bbox = computeBbox(closedPts);
  if (!bbox) return { ok: false, reason: '采区边界 bbox 无效' };
  const dx = bbox.minX;
  const dy = bbox.minY;

  try {
    const coords = (closedPts ?? []).map((p) => new Coordinate(Number(p?.x) - dx, Number(p?.y) - dy));
    const ring = gf.createLinearRing(coords);
    const poly = gf.createPolygon(ring);
    if (!poly || poly.isEmpty?.()) return { ok: false, reason: '采区边界多边形构造失败/为空', offset: { dx, dy } };
    return {
      ok: true,
      poly,
      offset: { dx, dy },
      bboxLocal: { xmin: 0, ymin: 0, xmax: bbox.maxX - bbox.minX, ymax: bbox.maxY - bbox.minY },
    };
  } catch (e) {
    return { ok: false, reason: `采区边界多边形构造异常: ${String(e?.message ?? e)}`, offset: { dx, dy } };
  }
};

const isGeomValid = (geom) => {
  try {
    if (!geom) return false;
    if (typeof geom.isValid === 'function') return Boolean(geom.isValid());
  } catch {
    // ignore
  }
  // 若运行环境无法提供 isValid，则不强行失败（但仍会在 buffer/area 阶段暴露问题）
  return true;
};

const validatePolygonLike = (poly) => {
  if (!poly) return { ok: false, reason: '采区边界多边形为空' };

  let base = poly;
  let fixedBy = '';
  let fixError = '';

  // 先做一次 0-buffer 修复（JTS/JSTS 常用 makeValid 近似）
  try {
    const repaired = BufferOp.bufferOp(base, 0);
    const picked = pickLargestPolygon(repaired);
    if (picked && !picked.isEmpty?.() && picked.getArea?.() > 0) {
      base = picked;
      fixedBy = 'buffer(0)';
    }
  } catch (e) {
    fixError = String(e?.message ?? e);
  }

  const isValid = isGeomValid(base);
  if (!isValid) {
    return {
      ok: false,
      reason: '采区边界无效（自交/退化），无法内缩',
      isValid: false,
      fixedBy,
      fixError,
    };
  }

  const area = Number(base?.getArea?.());
  if (!(Number.isFinite(area) && area > 0)) {
    return { ok: false, reason: '采区边界退化（面积<=0）', isValid, fixedBy, fixError };
  }

  return { ok: true, poly: base, isValid, fixedBy, fixError };
};

const translateLoops = (loops, dx, dy) => {
  const out = [];
  for (const loop of loops ?? []) {
    const pts = Array.isArray(loop) ? loop : [];
    if (pts.length < 2) continue;
    out.push(
      pts.map((p) => ({
        x: Number(p?.x) + dx,
        y: Number(p?.y) + dy,
      }))
    );
  }
  return out;
};

// axis=y 对称计算：将 world 坐标 swapXY 变换到 internalAxis='x' 的等价问题。
// 注意：wb/ws/B/L 等数值不随变换改变，只有坐标交换。
const swapXYPoint = (p) => ({ x: Number(p?.y), y: Number(p?.x) });
const swapXYPoints = (pts) => (Array.isArray(pts) ? pts.map(swapXYPoint) : []);
const swapXYLoops = (loops) => (Array.isArray(loops) ? loops.map((loop) => swapXYPoints(loop)) : []);

const rotatePointAround = (p, thetaRad, cx, cy) => {
  const x = Number(p?.x);
  const y = Number(p?.y);
  const c0 = Number(cx);
  const c1 = Number(cy);
  if (![x, y, c0, c1, thetaRad].every(Number.isFinite)) return { x, y };
  const cos = Math.cos(thetaRad);
  const sin = Math.sin(thetaRad);
  const dx = x - c0;
  const dy = y - c1;
  return {
    x: c0 + dx * cos - dy * sin,
    y: c1 + dx * sin + dy * cos,
  };
};

const rotateLoopAround = (loop, thetaRad, cx, cy) => {
  const pts = Array.isArray(loop) ? loop : [];
  return pts.map((p) => rotatePointAround(p, thetaRad, cx, cy));
};

const rotateLoopsAround = (loops, thetaRad, cx, cy) => {
  const out = [];
  for (const loop of loops ?? []) out.push(rotateLoopAround(loop, thetaRad, cx, cy));
  return out;
};

const encodeThetaDeltaKey = (theta0Deg, thetaDegList) => {
  const t0 = Number(theta0Deg);
  const ths = Array.isArray(thetaDegList) ? thetaDegList.map((x) => Number(x)).filter(Number.isFinite) : [];
  if (!(Number.isFinite(t0)) || !ths.length) return '';
  const deltas = ths.map((t) => {
    const d = t - t0;
    return Number.isFinite(d) ? (Math.round(d * 10) / 10) : 0;
  });
  return deltas.map((d) => (Number.isFinite(d) ? String(d) : '0')).join(',');
};

// 受控生成 per-face 角度（用 delta 序列避免爆炸；每层截断 maxSeq）
const genPerFaceDeltaSeqs = ({ N, deltaSet, deltaMax, maxSeq }) => {
  const n = Math.max(0, Math.round(Number(N) || 0));
  if (n <= 0) return [];
  const deltas = Array.isArray(deltaSet) ? deltaSet.map((x) => Number(x)).filter(Number.isFinite) : [0];
  const ds = deltas.length ? uniqNums(deltas, 1e-9) : [0];
  const dMax = Math.abs(Number(deltaMax) || 0);
  const limit = Math.max(1, Math.min(200, Math.round(Number(maxSeq) || 30)));

  // 固定第一段 delta=0（锚定主方向），降低自由度；需要完全自由可把这一行去掉
  let level = [{ seq: [0], cost: 0, varCost: 0 }];
  if (n === 1) return level.map((x) => x.seq);

  // 扩展顺序：先 0，再小幅，再大幅（更利于可解释性）
  const orderedDs = ds.slice().sort((a, b) => {
    const aa = Math.abs(a);
    const bb = Math.abs(b);
    if (aa !== bb) return aa - bb;
    return a - b;
  });

  for (let i = 2; i <= n; i++) {
    const next = [];
    for (const item of level) {
      const prev = item.seq[item.seq.length - 1];
      for (const d of orderedDs) {
        if (Number.isFinite(dMax) && dMax > 0 && Math.abs(d - prev) > dMax + 1e-9) continue;
        const newSeq = item.seq.concat([d]);
        // cost：优先少转弯/少摆动
        const cost = (item.cost ?? 0) + Math.abs(d - prev);
        const varCost = (item.varCost ?? 0) + Math.abs(d);
        next.push({ seq: newSeq, cost, varCost });
      }
    }
    next.sort((a, b) => {
      if ((a.cost ?? 0) !== (b.cost ?? 0)) return (a.cost ?? 0) - (b.cost ?? 0);
      if ((a.varCost ?? 0) !== (b.varCost ?? 0)) return (a.varCost ?? 0) - (b.varCost ?? 0);
      return String(a.seq).localeCompare(String(b.seq));
    });
    level = next.slice(0, limit);
  }
  return level.map((x) => x.seq);
};

// deltaDeg_i 序列（每面一值）：离散集合 + 相邻差限制（用于控规模）
const genPerFaceDeltaDegSeqs = ({ N, deltaSet, adjMaxStep, maxSeq }) => {
  const n = Math.max(0, Math.round(Number(N) || 0));
  if (n <= 0) return [];
  const ds0 = Array.isArray(deltaSet) ? deltaSet.map((x) => Number(x)).filter(Number.isFinite) : [0];
  const ds = ds0.length ? uniqNums(ds0, 1e-9) : [0];
  const limit = Math.max(1, Math.min(300, Math.round(Number(maxSeq) || 30)));
  const stepMax = Math.abs(Number(adjMaxStep) || 0);

  const ordered = ds.slice().sort((a, b) => {
    const aa = Math.abs(a);
    const bb = Math.abs(b);
    if (aa !== bb) return aa - bb;
    return a - b;
  });

  let level = ordered.map((d) => ({ seq: [d], cost: Math.abs(d), smooth: 0 }));
  level = level.slice(0, limit);
  if (n === 1) return level.map((x) => x.seq);

  for (let i = 2; i <= n; i++) {
    const next = [];
    for (const item of level) {
      const prev = item.seq[item.seq.length - 1];
      for (const d of ordered) {
        if (Number.isFinite(stepMax) && stepMax > 0 && Math.abs(d - prev) > stepMax + 1e-9) continue;
        const seq = item.seq.concat([d]);
        const cost = (item.cost ?? 0) + Math.abs(d);
        const smooth = (item.smooth ?? 0) + Math.abs(d - prev);
        next.push({ seq, cost, smooth });
      }
    }
    next.sort((a, b) => {
      if ((a.cost ?? 0) !== (b.cost ?? 0)) return (a.cost ?? 0) - (b.cost ?? 0);
      if ((a.smooth ?? 0) !== (b.smooth ?? 0)) return (a.smooth ?? 0) - (b.smooth ?? 0);
      return String(a.seq).localeCompare(String(b.seq));
    });
    level = next.slice(0, limit);
  }
  return level.map((x) => x.seq);
};

// per-face：边界自适应 delta（贪心）
// 目标：在不引入额外硬规则的情况下，让 delta 自动“顺着Ω形状”调整，以最大化有效覆盖面积。
// 约束：保持链式累积角；并限制相邻 delta 的跳变幅度 <= adjMaxStep（与 v1.0 一致）。
const genPerFaceDeltaGreedy = ({
  N,
  rectLoopsLocal,
  omegaPoly,
  deltaSet,
  adjMaxStep,
  inRatioFloor,
  requireInside = false,
  deltaMin = -10,
  deltaMax = +10,
}) => {
  const n = Math.max(1, Math.round(Number(N) || 0));
  const loops = Array.isArray(rectLoopsLocal) ? rectLoopsLocal : [];
  const omega = omegaPoly;
  const dSet = Array.isArray(deltaSet) ? deltaSet.map((x) => Math.round(Number(x))).filter(Number.isFinite) : [];
  const step = Math.max(0, Math.abs(Number(adjMaxStep) || 0));
  const floor = Number.isFinite(Number(inRatioFloor)) ? Number(inRatioFloor) : 0;
  const insideThr = requireInside ? (1 - 1e-6) : floor;
  if (!(loops.length === n && omega && !omega.isEmpty?.() && dSet.length)) return null;

  // bbox 剪枝：避免明显不相交时的 expensive overlay。
  // 当 insideThr<=0 时仍需保留 ratio=0 的候选，只跳过 intersection。
  let omegaBox = null;
  try {
    omegaBox = envToBox(omega.getEnvelopeInternal?.());
  } catch {
    omegaBox = null;
  }

  let cumAngleDeg = 0;
  let prevDelta = 0;
  const out = [];

  for (let i = 0; i < n; i++) {
    const rectLoop = loops[i];
    if (!rectLoop) return null;
    const nearA = cumAngleDeg;

    const candidates = dSet.filter((d) => (step <= 1e-12 ? true : Math.abs(d - prevDelta) <= step + 1e-9));
    const candList = candidates.length ? candidates : dSet;

    let best = null;
    for (const d of candList) {
      const farA = nearA + d;
      const quad = buildSkewQuadFromRectLoop({ rectLoop, nearAngleDeg: nearA, farAngleDeg: farA });
      if (!quad) continue;

      let bboxDisjoint = false;
      if (omegaBox) {
        const quadBox = bboxOfLoop(quad);
        bboxDisjoint = Boolean(quadBox && !bboxIntersects(quadBox, omegaBox));
        if (bboxDisjoint && insideThr > 1e-12) continue;
      }

      const facePoly0 = buildJstsPolygonFromLoop(quad);
      if (!facePoly0 || facePoly0.isEmpty?.()) continue;
      let facePoly = facePoly0;
      try {
        const valid = (typeof facePoly.isValid === 'function') ? Boolean(facePoly.isValid()) : true;
        if (!valid) facePoly = ensureValid(facePoly, 'perFaceQuadGreedy');
      } catch {
        // ignore
      }
      const faceArea = Number(facePoly?.getArea?.());
      if (!(Number.isFinite(faceArea) && faceArea > 1e-9)) continue;

      let ia = 0;
      if (!bboxDisjoint) {
        let inter = null;
        try {
          inter = robustIntersection(omega, facePoly);
        } catch {
          inter = null;
        }
        const interArea = Number(inter?.getArea?.());
        ia = (Number.isFinite(interArea) && interArea >= 0) ? interArea : 0;
      }
      const ratio = ia > 0 ? (ia / faceArea) : 0;
      if (!(Number.isFinite(ratio) && ratio >= insideThr - 1e-12)) continue;

      // 主目标：有效面积最大；tie：更接近不越界（ratio大）；再 tie：更小 |d|（更稳定）
      const cand = { d, ia, ratio, abs: Math.abs(d) };
      if (!best) {
        best = cand;
        continue;
      }
      if (cand.ia > best.ia + 1e-9) best = cand;
      else if (Math.abs(cand.ia - best.ia) <= 1e-9) {
        if (cand.ratio > best.ratio + 1e-9) best = cand;
        else if (Math.abs(cand.ratio - best.ratio) <= 1e-9 && cand.abs < best.abs - 1e-9) best = cand;
      }
    }

    const chosen = best ? best.d : 0;
    const lo = Math.min(Number(deltaMin), Number(deltaMax));
    const hi = Math.max(Number(deltaMin), Number(deltaMax));
    out.push(Math.max(lo, Math.min(hi, Math.round(Number(chosen)))));
    prevDelta = Number(out[out.length - 1]) || 0;
    cumAngleDeg = nearA + prevDelta;
  }

  return out.length === n ? out : null;
};

// per-face：delta 序列（beam search）
// 目的：避免“只按平滑/小转角”枚举导致角度几乎全为 0；改为用 Ω 约束下的有效面积来引导。
// 约束：链式累积角 + 相邻 delta 跳变限制 <= adjMaxStep（v1.0 口径不变）。
const genPerFaceDeltaBeam = ({
  N,
  rectLoopsLocal,
  omegaPoly,
  deltaSet,
  adjMaxStep,
  inRatioFloor,
  requireInside = false,
  beamWidth = 6,
  outMax = 10,
  deltaMin = -10,
  deltaMax = +10,
}) => {
  const n = Math.max(1, Math.round(Number(N) || 0));
  const loops = Array.isArray(rectLoopsLocal) ? rectLoopsLocal : [];
  const omega = omegaPoly;
  const dSet0 = Array.isArray(deltaSet) ? deltaSet.map((x) => Math.round(Number(x))).filter(Number.isFinite) : [];
  const dSet = dSet0.length ? uniqNums(dSet0, 1e-9) : [0];
  const step = Math.max(0, Math.abs(Number(adjMaxStep) || 0));
  const floor = Number.isFinite(Number(inRatioFloor)) ? Number(inRatioFloor) : 0;
  const insideThr = requireInside ? (1 - 1e-6) : floor;
  const bw = clamp(Math.round(Number(beamWidth) || 6), 1, 30);
  const maxOut = clamp(Math.round(Number(outMax) || 10), 1, 50);
  const lo = Math.min(Number(deltaMin), Number(deltaMax));
  const hi = Math.max(Number(deltaMin), Number(deltaMax));
  if (!(loops.length === n && omega && !omega.isEmpty?.() && dSet.length)) return [];

  // bbox 剪枝 + memo：减少重复 expensive overlay（不改变候选口径/排序）。
  let omegaBox = null;
  try {
    omegaBox = envToBox(omega.getEnvelopeInternal?.());
  } catch {
    omegaBox = null;
  }
  const evalMemo = new Map();

  const evalFace = (faceIndex, rectLoop, nearA, farA) => {
    const k = `${String(faceIndex)}|${String(Math.round(Number(nearA) || 0))}|${String(Math.round(Number(farA) || 0))}`;
    if (evalMemo.has(k)) return evalMemo.get(k);

    const quad = buildSkewQuadFromRectLoop({ rectLoop, nearAngleDeg: nearA, farAngleDeg: farA });
    if (!quad) {
      evalMemo.set(k, null);
      return null;
    }

    let bboxDisjoint = false;
    if (omegaBox) {
      const quadBox = bboxOfLoop(quad);
      bboxDisjoint = Boolean(quadBox && !bboxIntersects(quadBox, omegaBox));
      if (bboxDisjoint && insideThr > 1e-12) {
        evalMemo.set(k, null);
        return null;
      }
    }

    const facePoly0 = buildJstsPolygonFromLoop(quad);
    if (!facePoly0 || facePoly0.isEmpty?.()) {
      evalMemo.set(k, null);
      return null;
    }
    let facePoly = facePoly0;
    try {
      const valid = (typeof facePoly.isValid === 'function') ? Boolean(facePoly.isValid()) : true;
      if (!valid) facePoly = ensureValid(facePoly, 'perFaceQuadBeam');
    } catch {
      // ignore
    }
    const faceArea = Number(facePoly?.getArea?.());
    if (!(Number.isFinite(faceArea) && faceArea > 1e-9)) {
      evalMemo.set(k, null);
      return null;
    }

    let ia = 0;
    if (!bboxDisjoint) {
      let inter = null;
      try {
        inter = robustIntersection(omega, facePoly);
      } catch {
        inter = null;
      }
      const interArea = Number(inter?.getArea?.());
      ia = (Number.isFinite(interArea) && interArea >= 0) ? interArea : 0;
    }
    const ratio = ia > 0 ? (ia / faceArea) : 0;
    if (!(Number.isFinite(ratio) && ratio >= insideThr - 1e-12)) {
      evalMemo.set(k, null);
      return null;
    }

    const out = { ia, ratio, faceArea };
    evalMemo.set(k, out);
    return out;
  };

  // state fields:
  // seq: delta list so far
  // cumAngleDeg: far angle of previous face
  // prevDelta: previous delta
  // sumIa: sum of effective area so far
  // minRatio: minimum inRatio so far
  // sumAbs: sum |delta|
  // smooth: sum |delta-prev|
  let level = [{ seq: [], cumAngleDeg: 0, prevDelta: 0, sumIa: 0, minRatio: 1, sumAbs: 0, smooth: 0 }];

  for (let i = 0; i < n; i++) {
    const rectLoop = loops[i];
    if (!rectLoop) return [];

    const next = [];
    for (const st of level) {
      const nearA = Number(st.cumAngleDeg) || 0;
      const prevD = Number(st.prevDelta) || 0;
      const candDs = dSet.filter((d) => (step <= 1e-12 ? true : Math.abs(d - prevD) <= step + 1e-9));
      const use = candDs.length ? candDs : dSet;
      for (const d0 of use) {
        const d = clamp(Math.round(Number(d0) || 0), lo, hi);
        const farA = nearA + d;
        const ev = evalFace(i, rectLoop, nearA, farA);
        if (!ev) continue;
        const seq = st.seq.concat([d]);
        const sumIa = Number(st.sumIa) + Number(ev.ia);
        const minRatio = Math.min(Number(st.minRatio), Number(ev.ratio));
        const sumAbs = Number(st.sumAbs) + Math.abs(d);
        const smooth = Number(st.smooth) + Math.abs(d - prevD);
        const insideNow = minRatio >= (1 - 1e-6);
        next.push({
          seq,
          cumAngleDeg: farA,
          prevDelta: d,
          sumIa,
          minRatio,
          sumAbs,
          smooth,
          insideNow,
        });
      }
    }

    // 排序：优先不越界 -> 有效面积 -> minRatio -> 更稳定
    next.sort((a, b) => {
      const ai = Boolean(a?.insideNow);
      const bi = Boolean(b?.insideNow);
      if (ai !== bi) return ai ? -1 : 1;
      const aa = Number(a?.sumIa);
      const bb = Number(b?.sumIa);
      if (bb !== aa) return bb - aa;
      const ar = Number(a?.minRatio);
      const br = Number(b?.minRatio);
      if (br !== ar) return br - ar;
      const as = Number(a?.smooth);
      const bs = Number(b?.smooth);
      if (as !== bs) return as - bs;
      const aabs = Number(a?.sumAbs);
      const babs = Number(b?.sumAbs);
      if (aabs !== babs) return aabs - babs;
      return String(a?.seq ?? '').localeCompare(String(b?.seq ?? ''));
    });

    level = next.slice(0, bw);
    if (!level.length) return [];
  }

  // 输出：取若干条（去重）
  const seen = new Set();
  const out = [];
  for (const st of level) {
    const s = Array.isArray(st?.seq) ? st.seq.map((d) => String(Math.round(Number(d) || 0))).join(',') : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(st.seq);
    if (out.length >= maxOut) break;
  }
  return out;
};

const rotateGeomAround = (geom, thetaRad, cx, cy) => {
  if (!geom) return null;
  try {
    const t = AffineTransformation.rotationInstance(thetaRad, cx, cy);
    const out = t.transform(geom);
    return out || null;
  } catch {
    return null;
  }
};

const rotateVec = (vx, vy, thetaRad) => {
  const c = Math.cos(thetaRad);
  const s = Math.sin(thetaRad);
  return { x: vx * c - vy * s, y: vx * s + vy * c };
};

// v1.0 梯形/四边形（链式旋转）：在 internalAxis='x' 的 local 坐标系内构造
// - 面1：nearEdge（靠边界煤柱侧）角度=0（相对 internalAxis），farEdge=0+delta1
// - 面i：nearEdge 角度继承面 i-1 的 farEdge，farEdge=nearEdge+delta_i
// 说明：near/far 两条边分别以 baseRect bottom/top 的中点为锚点，长度保持为 baseRect 的长度。
// 兼容：若只传 deltaDeg，则视为 nearAngleDeg=0, farAngleDeg=deltaDeg（旧口径）。
const buildSkewQuadFromRectLoop = ({ rectLoop, deltaDeg, nearAngleDeg, farAngleDeg }) => {
  const loop = Array.isArray(rectLoop) ? rectLoop : [];
  const bb = bboxOfLoop(loop);
  if (!bb) return null;

  const minX = bb.minX;
  const maxX = bb.maxX;
  const minY = bb.minY;
  const maxY = bb.maxY;
  if (!([minX, maxX, minY, maxY].every(Number.isFinite)) || !(maxX > minX) || !(maxY > minY)) return null;

  const L = maxX - minX;
  const midX = (minX + maxX) / 2;
  const midBottom = { x: midX, y: minY };
  const midTop = { x: midX, y: maxY };

  const aNear0 = Number.isFinite(Number(nearAngleDeg)) ? Number(nearAngleDeg) : 0;
  let aFar0 = Number.isFinite(Number(farAngleDeg)) ? Number(farAngleDeg) : null;
  if (!(Number.isFinite(aFar0))) {
    const d = Number(deltaDeg);
    const dd = Number.isFinite(d) ? d : 0;
    aFar0 = aNear0 + dd;
  }

  const nearDir = rotateVec(1, 0, (aNear0 * Math.PI) / 180);
  const farDir = rotateVec(1, 0, (aFar0 * Math.PI) / 180);
  const halfL = L / 2;
  const p0 = { x: midBottom.x - nearDir.x * halfL, y: midBottom.y - nearDir.y * halfL };
  const p1 = { x: midBottom.x + nearDir.x * halfL, y: midBottom.y + nearDir.y * halfL };
  const q0 = { x: midTop.x - farDir.x * halfL, y: midTop.y - farDir.y * halfL };
  const q1 = { x: midTop.x + farDir.x * halfL, y: midTop.y + farDir.y * halfL };

  // 组装四边形：nearEdge p0->p1，farEdge 反向 q1->q0
  let quad = [p0, p1, q1, q0, p0];
  // 保证 CCW
  const area = signedAreaShoelace(quad);
  if (area < 0) {
    const core = quad.slice(0, -1).reverse();
    quad = [...core, core[0]];
  }
  return quad;
};

const polygonToLoopSafe = (poly) => {
  try {
    if (!poly || poly.isEmpty?.()) return null;
    const t = String(poly.getGeometryType?.() ?? '');
    const p = (t === 'Polygon') ? poly : pickLargestPolygon(poly);
    const ring = p?.getExteriorRing?.();
    const coords = ring?.getCoordinates?.() ?? [];
    if (!coords || coords.length < 4) return null;
    const loop = [];
    for (const c of coords) {
      const x = Number(c?.x);
      const y = Number(c?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      loop.push({ x, y });
    }
    return loop.length >= 4 ? loop : null;
  } catch {
    return null;
  }
};

const deltaStatsDeg = (deltaDegList) => {
  const ds = Array.isArray(deltaDegList) ? deltaDegList.map((x) => Number(x)).filter(Number.isFinite) : [];
  if (!ds.length) return { maxAbsDeltaDeg: null, sumAbsDeltaDeg: null, smoothnessDeg: null, deltaStdDeg: null };
  const maxAbsDeltaDeg = ds.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  const sumAbsDeltaDeg = ds.reduce((s, x) => s + Math.abs(x), 0);
  let smoothnessDeg = 0;
  for (let i = 1; i < ds.length; i++) smoothnessDeg += Math.abs(ds[i] - ds[i - 1]);
  const deltaStdDeg = stdOf(ds);
  return {
    maxAbsDeltaDeg: Number.isFinite(maxAbsDeltaDeg) ? maxAbsDeltaDeg : null,
    sumAbsDeltaDeg: Number.isFinite(sumAbsDeltaDeg) ? sumAbsDeltaDeg : null,
    smoothnessDeg: Number.isFinite(smoothnessDeg) ? smoothnessDeg : null,
    deltaStdDeg: Number.isFinite(deltaStdDeg) ? deltaStdDeg : null,
  };
};

const bboxOfLoop = (loop) => {
  const pts = Array.isArray(loop) ? loop : [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const p of pts) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    count += 1;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!count || !Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
  return { minX, maxX, minY, maxY };
};

const pointInPoly = (pt, loop) => {
  const x = Number(pt?.x);
  const y = Number(pt?.y);
  const poly = Array.isArray(loop) ? loop : [];
  if (!(Number.isFinite(x) && Number.isFinite(y)) || poly.length < 3) return false;

  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = Number(poly[i]?.x);
    const yi = Number(poly[i]?.y);
    const xj = Number(poly[j]?.x);
    const yj = Number(poly[j]?.y);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersect = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// === smart-resource v1.0 协议冻结（2026-01-16）===
// ThicknessGrid（fieldPack.field）冻结：二维数组 field[j][i]
// - i ∈ [0, gridW-1]，j ∈ [0, gridH-1]
// - 行方向：j=0 对应 y≈ymax（上边界），j 增大表示 y 从 ymax→ymin（自上向下）
// - 采样映射：沿用当前实现（双线性插值 + y 翻转），不做 borehole→grid 的插值建模
// axis 语义冻结：axis 仅表示工作面布置方向；厚度坐标系不随 axis/swapXY 变化
const SMART_RESOURCE_VERSION = 'v1.0';

const THICKNESS_REASON = {
  NO_GRID: 'NO_GRID',
  GRID_INVALID_SHAPE: 'GRID_INVALID_SHAPE',
  GRID_BOUNDS_INVALID: 'GRID_BOUNDS_INVALID',
  GRID_NO_VALID_CELL: 'GRID_NO_VALID_CELL',
  ALL_NODATA_IN_DOMAIN: 'ALL_NODATA_IN_DOMAIN',
  CONST_USED: 'CONST_USED',
  FALLBACK_AREA: 'FALLBACK_AREA',
  AXIS_Y_THK_UNCHANGED: 'AXIS_Y_THK_UNCHANGED',
};

const buildThicknessSampler = (thickness) => {
  const constantM = Number(thickness?.constantM);
  const pack = thickness?.fieldPack;
  const rho = Number(thickness?.rho);

  const rhoUse = (Number.isFinite(rho) && rho > 0) ? rho : 1;

  // 1) grid 采样（field[j][i]，j 自上向下；采样时 y 翻转）
  if (pack && Array.isArray(pack.field)) {
    const grid = pack.field;
    const gridH = grid.length;
    const row0 = Array.isArray(grid[0]) ? grid[0] : null;
    const gridW = row0 ? row0.length : 0;
    const shapeOk = gridH >= 2 && gridW >= 2 && grid.every((r) => Array.isArray(r) && r.length === gridW);
    if (!shapeOk) {
      // 若同时提供 constantM，则按常数优先（便于应急）
      if (Number.isFinite(constantM) && constantM > 0) {
        const v = constantM;
        return {
          kind: 'constant',
          rho: rhoUse,
          sampleAt: () => v,
          hasThickness: true,
          reason: THICKNESS_REASON.CONST_USED,
          gridHasValidCell: false,
        };
      }
      return {
        kind: 'none',
        rho: rhoUse,
        sampleAt: () => null,
        hasThickness: false,
        reason: THICKNESS_REASON.GRID_INVALID_SHAPE,
        gridHasValidCell: false,
      };
    }

    const b = pack.bounds;
    const boundsOk = Boolean(b && [b.minX, b.maxX, b.minY, b.maxY].every((v) => Number.isFinite(Number(v))));
    if (!boundsOk) {
      if (Number.isFinite(constantM) && constantM > 0) {
        const v = constantM;
        return {
          kind: 'constant',
          rho: rhoUse,
          sampleAt: () => v,
          hasThickness: true,
          reason: THICKNESS_REASON.CONST_USED,
          gridHasValidCell: false,
        };
      }
      return {
        kind: 'none',
        rho: rhoUse,
        sampleAt: () => null,
        hasThickness: false,
        reason: THICKNESS_REASON.GRID_BOUNDS_INVALID,
        gridHasValidCell: false,
      };
    }

    // v1.0：hasThickness 需要“存在有效值”。这里用 >0 的有限数作为有效值。
    let gridHasValidCell = false;
    for (let j = 0; j < gridH && !gridHasValidCell; j++) {
      const row = grid[j];
      for (let i = 0; i < gridW; i++) {
        const v = Number(row[i]);
        if (Number.isFinite(v) && v > 0) {
          gridHasValidCell = true;
          break;
        }
      }
    }
    if (!gridHasValidCell) {
      if (Number.isFinite(constantM) && constantM > 0) {
        const v = constantM;
        return {
          kind: 'constant',
          rho: rhoUse,
          sampleAt: () => v,
          hasThickness: true,
          reason: THICKNESS_REASON.CONST_USED,
          gridHasValidCell: false,
        };
      }
      return {
        kind: 'none',
        rho: rhoUse,
        sampleAt: () => null,
        hasThickness: false,
        reason: THICKNESS_REASON.GRID_NO_VALID_CELL,
        gridHasValidCell: false,
      };
    }

    const width = Number(pack.width ?? 320);
    const height = Number(pack.height ?? 220);
    const minX = Number(b.minX);
    const maxX = Number(b.maxX);
    const minY = Number(b.minY);
    const maxY = Number(b.maxY);
    const pad = Number(b.pad ?? 14);

    const sampleAt = (worldX, worldY) => {
      const wx = Number(worldX);
      const wy = Number(worldY);
      if (!(Number.isFinite(wx) && Number.isFinite(wy))) return null;

      const sx = pad + ((wx - minX) / ((maxX - minX) || 1)) * (width - pad * 2);
      // y 翻转：worldY=minY 映射到底部像素；worldY=maxY 映射到顶部像素
      const sy = pad + (1 - (wy - minY) / ((maxY - minY) || 1)) * (height - pad * 2);

      const gx = clamp((sx / width) * (gridW - 1), 0, gridW - 1);
      const gy = clamp((sy / height) * (gridH - 1), 0, gridH - 1);
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const x1 = Math.min(gridW - 1, x0 + 1);
      const y1 = Math.min(gridH - 1, y0 + 1);
      const tx = gx - x0;
      const ty = gy - y0;

      const v00 = Number(grid?.[y0]?.[x0]);
      const v10 = Number(grid?.[y0]?.[x1]);
      const v01 = Number(grid?.[y1]?.[x0]);
      const v11 = Number(grid?.[y1]?.[x1]);
      if (![v00, v10, v01, v11].every(Number.isFinite)) return null;

      const v0 = v00 * (1 - tx) + v10 * tx;
      const v1 = v01 * (1 - tx) + v11 * tx;
      const v = v0 * (1 - ty) + v1 * ty;
      return Number.isFinite(v) ? v : null;
    };

    return {
      kind: 'field',
      rho: rhoUse,
      sampleAt,
      hasThickness: true,
      reason: '',
      gridHasValidCell: true,
    };
  }

  // 2) constant thickness（应急路径）
  if (Number.isFinite(constantM) && constantM > 0) {
    const v = constantM;
    return {
      kind: 'constant',
      rho: rhoUse,
      sampleAt: () => v,
      hasThickness: true,
      reason: THICKNESS_REASON.CONST_USED,
      gridHasValidCell: false,
    };
  }

  return {
    kind: 'none',
    rho: rhoUse,
    sampleAt: () => null,
    hasThickness: false,
    reason: THICKNESS_REASON.NO_GRID,
    gridHasValidCell: false,
  };
};

const integrateTonnageForLoop = ({ loop, sampler, gridRes }) => {
  const bb = bboxOfLoop(loop);
  if (!bb) return null;
  const step = Number(gridRes);
  if (!(Number.isFinite(step) && step > 1e-6)) return null;
  const cellArea = step * step;

  const x0 = bb.minX;
  const x1 = bb.maxX;
  const y0 = bb.minY;
  const y1 = bb.maxY;
  if (!([x0, x1, y0, y1].every(Number.isFinite)) || !(x1 > x0) || !(y1 > y0)) return null;

  let total = 0;
  let hit = 0;
  for (let y = y0 + step / 2; y <= y1 - step / 2 + 1e-9; y += step) {
    for (let x = x0 + step / 2; x <= x1 - step / 2 + 1e-9; x += step) {
      if (!pointInPoly({ x, y }, loop)) continue;
      const thk = sampler.sampleAt(x, y);
      const t = Number(thk);
      if (!(Number.isFinite(t) && t > 0)) continue;
      hit += 1;
      total += t * sampler.rho * cellArea;
    }
  }

  if (!hit) return 0;
  return Number.isFinite(total) ? total : null;
};

const buildJstsPolygonFromLoop = (loop) => {
  const pts = (loop ?? [])
    .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closed = (first.x === last.x && first.y === last.y) ? pts : [...pts, first];
  const coords = closed.map((p) => new Coordinate(p.x, p.y));
  const ring = gf.createLinearRing(coords);
  const poly = gf.createPolygon(ring);
  if (!poly || poly.isEmpty?.() || !(poly.getArea?.() > 0)) return null;
  return poly;
};

const pickLargestPolygon = (geom) => {
  if (!geom || geom.isEmpty?.()) return null;
  const type = geom.getGeometryType?.();
  if (type === 'Polygon') return geom;
  if (typeof geom.getNumGeometries === 'function') {
    let best = null;
    let bestArea = -Infinity;
    const n = geom.getNumGeometries();
    for (let i = 0; i < n; i++) {
      const g = geom.getGeometryN(i);
      const p = pickLargestPolygon(g);
      const a = p?.getArea?.();
      if (p && Number.isFinite(a) && a > bestArea) {
        best = p;
        bestArea = a;
      }
    }
    return best;
  }
  return null;
};

const fixPolygonSafe = (poly) => {
  if (!poly) return null;
  try {
    const fixed = BufferOp.bufferOp(poly, 0);
    const picked = pickLargestPolygon(fixed);
    if (picked && !picked.isEmpty?.() && picked.getArea?.() > 0) return picked;
  } catch {
    // ignore
  }
  return poly;
};

const ensureValid = (geom, tag, dbg) => {
  if (!geom) return null;
  const out = { before: {}, after: {} };
  try { out.before.type = geom.getGeometryType?.() || ''; } catch { out.before.type = ''; }
  try { out.before.isValid = typeof geom.isValid === 'function' ? Boolean(geom.isValid()) : null; } catch { out.before.isValid = null; }

  let fixed = geom;
  try {
    // 经典 makeValid：buffer(0)
    fixed = BufferOp.bufferOp(geom, 0);
  } catch {
    fixed = geom;
  }
  try { out.after.type = fixed?.getGeometryType?.() || ''; } catch { out.after.type = ''; }
  try { out.after.isValid = typeof fixed?.isValid === 'function' ? Boolean(fixed.isValid()) : null; } catch { out.after.isValid = null; }

  if (dbg) {
    if (!dbg.valid) dbg.valid = {};
    if (!dbg.valid[tag]) dbg.valid[tag] = out;
  }
  return fixed;
};

const robustIntersection = (a, b) => {
  if (!a || !b) return null;

  // 快速早退：空几何 / 包围盒不相交时，intersection 必为空。
  try {
    if (a.isEmpty?.() || b.isEmpty?.()) return null;
  } catch {
    // ignore
  }
  try {
    const ea = a.getEnvelopeInternal?.();
    const eb = b.getEnvelopeInternal?.();
    if (ea && eb) {
      if (typeof ea.intersects === 'function') {
        if (!ea.intersects(eb)) return null;
      } else {
        const aMinX = Number(ea.getMinX?.());
        const aMaxX = Number(ea.getMaxX?.());
        const aMinY = Number(ea.getMinY?.());
        const aMaxY = Number(ea.getMaxY?.());
        const bMinX = Number(eb.getMinX?.());
        const bMaxX = Number(eb.getMaxX?.());
        const bMinY = Number(eb.getMinY?.());
        const bMaxY = Number(eb.getMaxY?.());
        if ([aMinX, aMaxX, aMinY, aMaxY, bMinX, bMaxX, bMinY, bMaxY].every(Number.isFinite)) {
          if (aMaxX < bMinX || bMaxX < aMinX || aMaxY < bMinY || bMaxY < aMinY) return null;
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    return a.intersection(b);
  } catch {
    // TopologyException 等：走 snap overlay
    try {
      return SnapIfNeededOverlayOp.overlayOp(a, b, OverlayOp.INTERSECTION);
    } catch {
      return null;
    }
  }
};

const robustUnion = (a, b) => {
  if (!a) return b || null;
  if (!b) return a || null;

  // 空几何短路（等价）
  try {
    if (a.isEmpty?.()) return b || null;
    if (b.isEmpty?.()) return a || null;
  } catch {
    // ignore
  }
  try {
    return a.union(b);
  } catch {
    try {
      return SnapIfNeededOverlayOp.overlayOp(a, b, OverlayOp.UNION);
    } catch {
      return null;
    }
  }
};

const robustDifference = (a, b) => {
  if (!a) return null;
  if (!b) return a;

  // 快速早退：a 为空 -> 空；b 为空 -> a；包围盒不相交 -> a（difference 不变）
  try {
    if (a.isEmpty?.()) return null;
    if (b.isEmpty?.()) return a;
  } catch {
    // ignore
  }
  try {
    const ea = a.getEnvelopeInternal?.();
    const eb = b.getEnvelopeInternal?.();
    if (ea && eb) {
      if (typeof ea.intersects === 'function') {
        if (!ea.intersects(eb)) return a;
      } else {
        const aMinX = Number(ea.getMinX?.());
        const aMaxX = Number(ea.getMaxX?.());
        const aMinY = Number(ea.getMinY?.());
        const aMaxY = Number(ea.getMaxY?.());
        const bMinX = Number(eb.getMinX?.());
        const bMaxX = Number(eb.getMaxX?.());
        const bMinY = Number(eb.getMinY?.());
        const bMaxY = Number(eb.getMaxY?.());
        if ([aMinX, aMaxX, aMinY, aMaxY, bMinX, bMaxX, bMinY, bMaxY].every(Number.isFinite)) {
          if (aMaxX < bMinX || bMaxX < aMinX || aMaxY < bMinY || bMaxY < aMinY) return a;
        }
      }
    }
  } catch {
    // ignore
  }
  try {
    return a.difference(b);
  } catch {
    try {
      return SnapIfNeededOverlayOp.overlayOp(a, b, OverlayOp.DIFFERENCE);
    } catch {
      return null;
    }
  }
};

const geomToPolygons = (geom) => {
  const out = [];
  const walk = (g) => {
    if (!g || g.isEmpty?.()) return;
    const t = g.getGeometryType?.();
    if (t === 'Polygon') {
      out.push(g);
      return;
    }
    if (typeof g.getNumGeometries === 'function') {
      const n = g.getNumGeometries();
      for (let i = 0; i < n; i++) walk(g.getGeometryN(i));
    }
  };
  walk(geom);
  return out;
};

const coordsToLoop = (coords) => {
  const pts = [];
  for (const c of coords ?? []) {
    const x = Number(c?.x);
    const y = Number(c?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push({ x, y });
  }
  if (pts.length >= 2) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (f.x === l.x && f.y === l.y) pts.pop();
  }
  return pts.length >= 3 ? pts : null;
};

// 与绘图层一致：输出 loops（可包含 MultiPolygon 的多个外环）。
const polygonToLoops = (geom) => {
  const loops = [];
  for (const poly of geomToPolygons(geom)) {
    try {
      const ring = poly?.getExteriorRing?.();
      const coords = ring?.getCoordinates?.();
      const loop = coordsToLoop(coords);
      if (loop) loops.push(loop);
    } catch {
      // ignore
    }
  }
  return loops;
};

const rectPoly = (x0, y0, x1, y1) => {
  const coords = [
    new Coordinate(x0, y0),
    new Coordinate(x1, y0),
    new Coordinate(x1, y1),
    new Coordinate(x0, y1),
    new Coordinate(x0, y0),
  ];
  return gf.createPolygon(gf.createLinearRing(coords));
};

const envToBox = (env) => {
  if (!env) return null;
  const minX = Number(env.getMinX?.());
  const maxX = Number(env.getMaxX?.());
  const minY = Number(env.getMinY?.());
  const maxY = Number(env.getMaxY?.());
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;
  return { minX, maxX, minY, maxY };
};

const bboxIntersects = (a, b) => {
  if (!a || !b) return false;
  return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
};

const mergeIntervals = (intervals, eps = 1e-9) => {
  const list = (intervals ?? [])
    .map((it) => ({ a: Number(it?.a), b: Number(it?.b) }))
    .filter((it) => Number.isFinite(it.a) && Number.isFinite(it.b))
    .map((it) => ({ a: Math.min(it.a, it.b), b: Math.max(it.a, it.b) }))
    .sort((x, y) => x.a - y.a);
  const out = [];
  for (const it of list) {
    if (!out.length) {
      out.push(it);
      continue;
    }
    const last = out[out.length - 1];
    if (it.a <= last.b + eps) last.b = Math.max(last.b, it.b);
    else out.push(it);
  }
  return out;
};

const intersectIntervals = (aList, bList) => {
  const out = [];
  for (const a of aList ?? []) {
    for (const b of bList ?? []) {
      const lo = Math.max(a.a, b.a);
      const hi = Math.min(a.b, b.b);
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) out.push({ a: lo, b: hi });
    }
  }
  return mergeIntervals(out);
};

const isRectInsideOmega = (omega, rect) => {
  if (!omega || !rect) return false;

  // 快速必要条件：包围盒不相交则不可能包含。
  // 注：仅用于早退，不改变几何口径。
  try {
    const ob = envToBox(omega.getEnvelopeInternal?.());
    const rb = envToBox(rect.getEnvelopeInternal?.());
    if (ob && rb && !bboxIntersects(ob, rb)) return false;
  } catch {
    // ignore
  }
  try {
    if (typeof omega.covers === 'function' && omega.covers(rect)) return true;
    if (typeof omega.contains === 'function' && omega.contains(rect)) return true;
  } catch {
    // fallback below
  }

  // 面积法：如果 intersection(omega, rect) 的面积≈rect 面积，则视为“严格包含”（允许极小数值误差）
  try {
    const rectArea = Number(rect?.getArea?.());
    if (Number.isFinite(rectArea) && rectArea > 0) {
      const inter = robustIntersection(omega, rect);
      const interArea = Number(inter?.getArea?.());
      const absTol = 1e-6;
      const relTol = rectArea * 1e-10;
      const tol = Math.max(absTol, relTol);
      if (Number.isFinite(interArea) && interArea >= rectArea - tol) return true;
    }
  } catch {
    // fallback below
  }

  try {
    const diff = rect.difference(omega);
    const a = Number(diff?.getArea?.());
    const rectArea = Number(rect?.getArea?.());
    // 数值鲁棒：对极小“溢出面积”容忍（避免贴边导致全灭），工程口径仍是 rect ⊆ omega。
    // 绝对容差 + 相对容差（二者取大）
    const absTol = 1e-6;
    const relTol = (Number.isFinite(rectArea) && rectArea > 0) ? rectArea * 1e-10 : 0;
    const tol = Math.max(absTol, relTol);
    return Number.isFinite(a) ? a <= tol : true;
  } catch {
    return false;
  }
};

// recovery 工程口径：裁剪后的工作面若不是矩形（含 MultiPolygon/多边形边数!=4/非轴对齐/有洞），则标记为异常。
// 说明：目前角度锁定 0°，因此“矩形”按轴对齐矩形判定。
const isAxisAlignedRectanglePolygon = (geom) => {
  if (!geom || geom.isEmpty?.()) return false;
  const t = geom.getGeometryType?.();
  if (t !== 'Polygon') return false;
  try {
    const holes = (typeof geom.getNumInteriorRing === 'function') ? geom.getNumInteriorRing() : 0;
    if (Number(holes) > 0) return false;
  } catch {
    // ignore
  }

  let coords = null;
  try {
    const ring = geom.getExteriorRing?.();
    coords = ring?.getCoordinates?.();
  } catch {
    coords = null;
  }
  if (!Array.isArray(coords) || coords.length !== 5) return false;

  const pts = coords
    .map((c) => ({ x: Number(c?.x), y: Number(c?.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length !== 5) return false;

  // 闭合
  const env0 = geom.getEnvelopeInternal?.();
  const box = envToBox(env0);
  const maxDim = box ? Math.max(Math.abs(box.maxX - box.minX), Math.abs(box.maxY - box.minY), 1) : 1;
  const tol = Math.max(1e-6, maxDim * 1e-9);

  const f = pts[0];
  const l = pts[pts.length - 1];
  if (Math.abs(f.x - l.x) > tol || Math.abs(f.y - l.y) > tol) return false;

  // 4 个顶点
  const uniq = [];
  for (let i = 0; i < 4; i++) {
    const p = pts[i];
    const hit = uniq.find((q) => Math.abs(q.x - p.x) <= tol && Math.abs(q.y - p.y) <= tol);
    if (!hit) uniq.push(p);
  }
  if (uniq.length !== 4) return false;

  // 边必须轴对齐
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const axisAligned = ((adx <= tol && ady > tol) || (ady <= tol && adx > tol));
    if (!axisAligned) return false;
  }
  return true;
};

const rectToLoop = (x0, y0, x1, y1) => {
  const a = Number(x0);
  const b = Number(x1);
  const c = Number(y0);
  const d = Number(y1);
  if (![a, b, c, d].every(Number.isFinite)) return null;
  const loX = Math.min(a, b);
  const hiX = Math.max(a, b);
  const loY = Math.min(c, d);
  const hiY = Math.max(c, d);
  if (!(hiX > loX && hiY > loY)) return null;
  return [
    { x: loX, y: loY },
    { x: hiX, y: loY },
    { x: hiX, y: hiY },
    { x: loX, y: hiY },
  ];
};

const chooseBestStart = (startMin, startMax, startGuess, buildForStart, stepsOverride = 10) => {
  const out = { facesLoops: [], faceCount: 0, area: 0 };
  if (!Number.isFinite(startMin) || !Number.isFinite(startMax)) return out;
  const lo = Math.min(startMin, startMax);
  const hi = Math.max(startMin, startMax);
  if (!(hi > lo)) return buildForStart(lo) ?? out;

  const steps = Math.max(2, Math.min(30, Math.round(Number(stepsOverride) || 10)));
  const cand = [];
  cand.push(clamp(startGuess, lo, hi));
  for (let i = 0; i <= steps; i++) cand.push(lo + (i / steps) * (hi - lo));

  let best = null;
  for (const s of cand) {
    const r = buildForStart(s);
    if (!r) continue;
    if (!best) {
      best = r;
      continue;
    }
    if ((r.faceCount ?? 0) > (best.faceCount ?? 0)) best = r;
    else if ((r.faceCount ?? 0) === (best.faceCount ?? 0) && r.area > best.area) best = r;
  }
  return best || out;
};

// startFrom: 'best' | 'min' | 'max'
// - best：全区间取最优（原逻辑）
// - min/max：从边界侧开始尝试，优先返回“靠边界侧”的可行解（若都不可行再退回 best）
const chooseStartPreferSide = (startMin, startMax, buildForStart, steps = 10, startFrom = 'best') => {
  const lo = Math.min(startMin, startMax);
  const hi = Math.max(startMin, startMax);
  const mode = String(startFrom || 'best');
  const m = Math.max(2, Math.min(40, Math.round(Number(steps) || 10)));

  if (!(hi > lo)) return buildForStart(lo) ?? { facesLoops: [], faceCount: 0, area: 0 };
  if (mode !== 'min' && mode !== 'max') {
    const guess = clamp((lo + hi) / 2, lo, hi);
    return chooseBestStart(lo, hi, guess, buildForStart, m);
  }

  let best = null;
  const span = hi - lo;
  for (let i = 0; i <= m; i++) {
    const s = (mode === 'min') ? (lo + (i / m) * span) : (hi - (i / m) * span);
    const r = buildForStart(s);
    if (!r) continue;
    if (!best) {
      best = r;
      continue;
    }
    if ((r.faceCount ?? 0) > (best.faceCount ?? 0)) best = r;
    else if ((r.faceCount ?? 0) === (best.faceCount ?? 0) && (r.area ?? 0) > (best.area ?? 0)) best = r;
  }
  if (best) return best;
  const guess = (mode === 'min') ? lo : hi;
  return chooseBestStart(lo, hi, guess, buildForStart, m);
};

// 伪随机（可复现）：基于字符串 seed
const makeDeterministicRng = (seedStr) => {
  let seed = 2166136261;
  try {
    const s = String(seedStr ?? '');
    for (let i = 0; i < s.length; i++) {
      seed ^= s.charCodeAt(i);
      seed = Math.imul(seed, 16777619) >>> 0;
    }
  } catch {
    // ignore
  }
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
};

// per-face：为“每面独立 B_i”生成少量可控组合（避免 3^N 爆炸）
const genPerFaceBLists = ({
  N,
  Bmin,
  Bmax,
  seedB,
  sumBMax,
  maxCount = 12,
  seedStr = '',
}) => {
  const n = Math.max(0, Math.round(Number(N) || 0));
  if (!(n >= 1)) return [];
  const lo = Math.max(1, Math.ceil(Math.min(Number(Bmin), Number(Bmax))));
  const hi = Math.max(lo, Math.floor(Math.max(Number(Bmin), Number(Bmax))));
  const base = clamp(Math.round(Number(seedB) || lo), lo, hi);
  const sumMax = Number.isFinite(Number(sumBMax)) ? Number(sumBMax) : Infinity;
  const sumTarget = n * base;
  const mid = Math.round((lo + hi) / 2);
  const palette0 = [base, lo, mid, hi, base - 50, base - 25, base + 25, base + 50]
    .map((x) => clamp(Math.round(Number(x)), lo, hi))
    .filter((x) => Number.isFinite(x) && x >= lo && x <= hi);
  const palette = uniqNums(palette0, 1e-9).map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x >= lo && x <= hi);
  if (!palette.length) return [];

  const out = [];
  const seen = new Set();
  const push = (arr) => {
    if (!Array.isArray(arr) || arr.length !== n) return;
    const a = arr.map((x) => clamp(Math.round(Number(x) || 0), lo, hi));
    const sumB = a.reduce((s, x) => s + (Number.isFinite(x) ? Number(x) : 0), 0);
    if (!(Number.isFinite(sumB) && sumB <= sumMax + 1e-6)) return;
    const key = a.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  };

  // 典型结构（确定性）：全等、渐变、交替
  push(Array(n).fill(base));
  push(Array(n).fill(lo));
  push(Array(n).fill(hi));
  push(Array(n).fill(mid));
  if (n >= 2) {
    push(Array.from({ length: n }, (_, i) => Math.round(lo + (i / (n - 1)) * (hi - lo))));
    push(Array.from({ length: n }, (_, i) => Math.round(hi - (i / (n - 1)) * (hi - lo))));
  }
  push(Array.from({ length: n }, (_, i) => (i % 2 === 0 ? hi : lo)));
  push(Array.from({ length: n }, (_, i) => (i % 2 === 0 ? lo : hi)));

  // 保持“总宽度≈seed”的平衡模式：交替 +/-d（不改变 sumTarget）
  for (const d0 of [25, 50]) {
    const d = Math.abs(Number(d0) || 0);
    if (!(d > 0)) continue;
    push(Array.from({ length: n }, (_, i) => clamp(base + (i % 2 === 0 ? d : -d), lo, hi)));
    push(Array.from({ length: n }, (_, i) => clamp(base + (i % 2 === 0 ? -d : d), lo, hi)));
    if (n >= 3) {
      // 让 1/3 面宽变大，其余略变小，尽量守住 sumTarget
      const idxBig = new Set();
      for (let i = 0; i < n; i += 3) idxBig.add(i);
      const a = Array.from({ length: n }, (_, i) => (idxBig.has(i) ? base + d : base - Math.round(d / 2)));
      // 末位纠偏到 sumTarget
      const sum0 = a.reduce((s, x) => s + (Number(x) || 0), 0);
      const fix = sumTarget - sum0;
      a[n - 1] = clamp((Number(a[n - 1]) || base) + fix, lo, hi);
      push(a);
    }
  }

  // 少量“独立组合”采样（可复现）：
  // 关键：尽量保持 sumB 接近 seed（否则大概率因 totalW 过大而不可行，表现成“还是全等宽”）。
  const rnd = makeDeterministicRng(seedStr);
  const target = Math.max(1, Math.round(Number(maxCount) || 12));
  const hardCap = Math.max(target, out.length);
  let guard = 0;
  while (out.length < hardCap && guard < 200) {
    guard++;
    // 构造：前 n-1 个随机，最后一个用于配平 sumTarget
    const a = [];
    let sumPrev = 0;
    for (let i = 0; i < n - 1; i++) {
      const v = palette[Math.floor(rnd() * palette.length)] ?? base;
      const vv = clamp(Math.round(Number(v) || base), lo, hi);
      a.push(vv);
      sumPrev += vv;
    }
    const last = clamp(Math.round(sumTarget - sumPrev), lo, hi);
    a.push(last);
    push(a);
    if (out.length >= target) break;
  }
  return out.slice(0, target);
};

// === 档 A：旋转矩形条带（AREA 口径） ===
// 放宽可行性：允许 faceShape 与 Ω_enum 相交裁剪后计有效面积。
// 约束：每个 face 的有效占比 area(face∩Ω_enum)/area(faceShape) >= inRatioMin。
// 注意：该函数只负责“给定 (N,B,Ws,Lcap) 在当前坐标系下生成一组不重叠矩形”
// 返回 rectLoopsLocal（未裁切矩形）+ faceAreaTotal（相交有效面积之和）。
const buildDesignRectsForNRelaxedClipped = ({
  omegaPoly,
  axis,
  N,
  B,
  Ws,
  Lmax,
  inRatioMin = 0.7,
  fast = false,
  startFrom = 'best',
  bumpFail,
  // 若开启：每条带可独立选择 xStart/L（更贴合不规则Ω，工作面长度也会自然变得不一样）
  perFaceShift = false,
}) => {
  const emptyOut = {
    rectLoopsLocal: [],
    faceCount: 0,
    rectAreaTotal: 0,
    faceAreaTotal: 0,
    coverageRatio: 0,
    minInRatio: 0,
    lengths: [],
  };

  if (!omegaPoly || omegaPoly.isEmpty?.()) return emptyOut;
  if (!(Number.isFinite(N) && N >= 1)) return emptyOut;
  // B 既可为 number（全局等宽），也可为 number[]（每面独立宽度）
  const BList = Array.isArray(B)
    ? B.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
    : [];
  const useVarB = Array.isArray(B) && B.length === N;
  const BPerFace = useVarB
    ? (Array.isArray(B) ? B.map((x) => Number(x)) : [])
    : Array.from({ length: N }, () => Number(B));
  if (!Array.isArray(BPerFace) || BPerFace.length !== N || BPerFace.some((x) => !(Number.isFinite(x) && x > 0))) return emptyOut;
  if (!(Number.isFinite(Ws) && Ws >= 0)) return emptyOut;

  const omegaV = ensureValid(fixPolygonSafe(omegaPoly));
  if (!omegaV || omegaV.isEmpty?.()) return emptyOut;

  const bbox = envToBox(omegaV.getEnvelopeInternal());
  if (!bbox) return emptyOut;
  const spanX = bbox.maxX - bbox.minX;
  const spanY = bbox.maxY - bbox.minY;
  if (!(Number.isFinite(spanX) && spanX > 1e-6 && Number.isFinite(spanY) && spanY > 1e-6)) return emptyOut;

  const Lcap = (Number.isFinite(Number(Lmax)) && Number(Lmax) > 0)
    ? Number(Lmax)
    : (axis === 'x' ? spanX : spanY);
  if (!(Number.isFinite(Lcap) && Lcap > 1e-6)) return emptyOut;

  // 全局兜底：允许每条带使用更短的推进长度（避免“Ω 形状在条带内横向不连续/变窄 → 固定 Lcap 导致 inRatio 失败”）
  const lenTryList = (() => {
    const base = Number(Lcap);
    const ratios = fast ? [1.0, 0.8, 0.6] : [1.0, 0.85, 0.7, 0.55, 0.4, 0.3];
    const xs = ratios
      .map((r) => Math.max(1, base * r))
      .filter((x) => Number.isFinite(x) && x > 1e-6);
    // 过滤掉过短的长度（避免无意义的小碎片矩形）
    const minAbs = Math.max(10, Math.min(50, base * 0.15));
    const ys = xs.filter((x) => x >= minAbs - 1e-9);
    const out = (ys.length ? ys : [base]);
    return uniqNums(out, 1e-6).sort((a, b) => b - a);
  })();
  const minLenTry = lenTryList.length ? Math.min(...lenTryList) : Number(Lcap);

  const totalW = BPerFace.reduce((s, x) => s + (Number.isFinite(x) ? Number(x) : 0), 0) + (N - 1) * Ws;
  const startMin = axis === 'x' ? bbox.minY : bbox.minX;
  const startMax = axis === 'x' ? (bbox.maxY - totalW) : (bbox.maxX - totalW);
  if (!(Number.isFinite(startMin) && Number.isFinite(startMax) && startMax >= startMin)) {
    if (bumpFail) bumpFail('RELAX_START_RANGE_EMPTY');
    return emptyOut;
  }

  const xMin = bbox.minX;
  const xMax = bbox.maxX;
  const yMin = bbox.minY;
  const yMax = bbox.maxY;

  const xStartLo = (axis === 'x') ? xMin : yMin;
  // xStart 上界按“最短尝试长度”放宽（固定 Lcap 会把右侧可行解直接排除）
  const xStartHi = (axis === 'x') ? (xMax - minLenTry) : (yMax - minLenTry);
  if (!(Number.isFinite(xStartLo) && Number.isFinite(xStartHi) && xStartHi >= xStartLo)) {
    if (bumpFail) bumpFail('RELAX_X_RANGE_EMPTY');
    return emptyOut;
  }

  const ySteps = fast ? 5 : 9;
  // perFaceShift 会在每条带内部枚举 xStart；需要更密的采样才容易贴合凹凸边界。
  const xStepsBase = fast ? 5 : 9;
  const xStepsShift = fast ? 7 : 15;

  const buildForStart = (s) => {
    const start = clamp(Number(s), startMin, startMax);

    // xStart 采样集合
    const buildXStarts = (lo, hi, dense = false) => {
      const out = [];
      const a = Number(lo);
      const b = Number(hi);
      if (!(Number.isFinite(a) && Number.isFinite(b) && b >= a)) return out;
      const guess = clamp((a + b) / 2, a, b);
      out.push(guess, a, b);
      const steps = dense ? xStepsShift : xStepsBase;
      for (let i = 0; i <= steps; i++) out.push(a + (i / steps) * (b - a));
      return uniqNums(out, 1e-6);
    };

    // band0/band1 需要按 BPerFace 累计推进
    const bandStartAt = (i0) => {
      let acc = 0;
      for (let k = 0; k < i0; k++) acc += (Number(BPerFace[k]) || 0) + Ws;
      return start + acc;
    };

    // 模式 A：全局同 xStart（旧行为，稳定但容易漏覆盖）
    const buildGlobal = () => {
      const best = { rectLoopsLocal: [], faceCount: 0, rectAreaTotal: 0, faceAreaTotal: 0, minInRatio: 0, lengths: [] };
      let bestHit = false;
      for (const xs0 of buildXStarts(xStartLo, xStartHi, false)) {
        const xStart = clamp(Number(xs0), xStartLo, xStartHi);
        const rectLoops = [];
        let faceAreaTotal = 0;
        let minRatio = Infinity;
        let rectAreaTotal = 0;
        const lengths = [];
        let ok = true;

        for (let i = 0; i < N; i++) {
          const band0 = bandStartAt(i);
          const Bi = Number(BPerFace[i]) || 0;
          const band1 = band0 + Bi;
          let bestBand = null;
          for (const L of lenTryList) {
            let rect = null;
            let rectLoop = null;
            if (axis === 'x') {
              rect = rectPoly(xStart, band0, xStart + L, band1);
              rectLoop = rectToLoop(xStart, band0, xStart + L, band1);
            } else {
              rect = rectPoly(band0, xStart, band1, xStart + L);
              rectLoop = rectToLoop(band0, xStart, band1, xStart + L);
            }
            if (!rect || !rectLoop) continue;
            const rectArea = Number(rect.getArea?.());
            if (!(Number.isFinite(rectArea) && rectArea > 1e-9)) continue;
            const inter = robustIntersection(omegaV, rect);
            const interArea = Number(inter?.getArea?.());
            const ratio = (Number.isFinite(interArea) && interArea >= 0) ? (interArea / rectArea) : 0;
            if (!(Number.isFinite(ratio) && ratio >= inRatioMin - 1e-9)) continue;
            const cand = { rectLoop, rectArea, interArea: Number.isFinite(interArea) ? interArea : 0, ratio, L: Number(L) };
            if (!bestBand || cand.interArea > (bestBand.interArea ?? 0) + 1e-9) bestBand = cand;
          }
          if (!bestBand) { ok = false; break; }
          rectAreaTotal += Number(bestBand.rectArea) || 0;
          faceAreaTotal += Number(bestBand.interArea) || 0;
          minRatio = Math.min(minRatio, Number(bestBand.ratio) || 0);
          lengths.push(Number(bestBand.L) || 0);
          rectLoops.push(bestBand.rectLoop);
        }
        if (!ok || rectLoops.length !== N) continue;
        const cand = { rectLoopsLocal: rectLoops, faceCount: N, rectAreaTotal, faceAreaTotal, minInRatio: Number.isFinite(minRatio) ? minRatio : 0, lengths };
        if (!bestHit || (cand.faceAreaTotal ?? 0) > (best.faceAreaTotal ?? 0) + 1e-9) {
          bestHit = true;
          Object.assign(best, cand);
        }
      }
      return bestHit ? best : null;
    };

    // 模式 B：每条带独立选 xStart/L（更贴合不规则Ω；长度自然不同）
    const buildPerFace = () => {
      const rectLoops = [];
      let faceAreaTotal = 0;
      let minRatio = Infinity;
      let rectAreaTotal = 0;
      const lengths = [];

      for (let i = 0; i < N; i++) {
        const band0 = bandStartAt(i);
        const Bi = Number(BPerFace[i]) || 0;
        const band1 = band0 + Bi;

        let bestBand = null;
        for (const L0 of lenTryList) {
          const L = Number(L0);
          if (!(Number.isFinite(L) && L > 1e-6)) continue;
          // 本长度下可选 xStart 上界更宽
          const hi = (axis === 'x') ? (xMax - L) : (yMax - L);
          const lo = xStartLo;
          if (!(Number.isFinite(hi) && hi >= lo)) continue;

          for (const xs0 of buildXStarts(lo, Math.min(xStartHi, hi), true)) {
            const xStart = clamp(Number(xs0), lo, Math.min(xStartHi, hi));
            let rect = null;
            let rectLoop = null;
            if (axis === 'x') {
              rect = rectPoly(xStart, band0, xStart + L, band1);
              rectLoop = rectToLoop(xStart, band0, xStart + L, band1);
            } else {
              rect = rectPoly(band0, xStart, band1, xStart + L);
              rectLoop = rectToLoop(band0, xStart, band1, xStart + L);
            }
            if (!rect || !rectLoop) continue;
            const rectArea = Number(rect.getArea?.());
            if (!(Number.isFinite(rectArea) && rectArea > 1e-9)) continue;
            const inter = robustIntersection(omegaV, rect);
            const interArea = Number(inter?.getArea?.());
            const ratio = (Number.isFinite(interArea) && interArea >= 0) ? (interArea / rectArea) : 0;
            if (!(Number.isFinite(ratio) && ratio >= inRatioMin - 1e-9)) continue;

            const cand = { rectLoop, rectArea, interArea: Number.isFinite(interArea) ? interArea : 0, ratio, L: Number(L) };
            if (!bestBand || cand.interArea > (bestBand.interArea ?? 0) + 1e-9) bestBand = cand;
          }
        }

        if (!bestBand) return null;
        rectAreaTotal += Number(bestBand.rectArea) || 0;
        faceAreaTotal += Number(bestBand.interArea) || 0;
        minRatio = Math.min(minRatio, Number(bestBand.ratio) || 0);
        lengths.push(Number(bestBand.L) || 0);
        rectLoops.push(bestBand.rectLoop);
      }

      if (rectLoops.length !== N) return null;
      return {
        rectLoopsLocal: rectLoops,
        faceCount: N,
        rectAreaTotal,
        faceAreaTotal,
        minInRatio: Number.isFinite(minRatio) ? minRatio : 0,
        lengths,
      };
    };

    return perFaceShift ? buildPerFace() : buildGlobal();
  };

  const best = chooseStartPreferSide(startMin, startMax, buildForStart, ySteps, startFrom);
  if (!best || !best.rectLoopsLocal?.length || (best.faceCount ?? 0) !== N) {
    if (bumpFail) bumpFail('RELAX_NO_FEASIBLE');
    return emptyOut;
  }
  return best;
};

// 规则矩形方案：仅 designRects 参与评分/排序；裁切多边形仅兜底展示。
// axis=x: 条带沿 y 分带、矩形长边沿 x；axis=y 相反。
const buildDesignRectsForN = ({
  omegaPoly,
  axis,
  N,
  B,
  Ws,
  Lmax,
  includeClipped = false,
  bumpFail,
  debugRef,
  fast = false,
  startFrom = 'best',
  coordSpace = 'local',
}) => {
  const emptyOut = {
    rectLoopsLocal: [],
    clippedLoopsLocal: [],
    faceCount: 0,
    rectAreaTotal: 0,
    clippedAreaTotal: 0,
    lengths: [],
  };
  if (!omegaPoly || omegaPoly.isEmpty?.()) return emptyOut;
  if (!(Number.isFinite(N) && N >= 1)) return emptyOut;
  // B 既可为 number（等宽），也可为 number[]（每面独立宽度）
  const useVarB = Array.isArray(B) && B.length === N;
  const BPerFace = useVarB
    ? B.map((x) => Number(x))
    : Array.from({ length: N }, () => Number(B));
  if (!Array.isArray(BPerFace) || BPerFace.length !== N || BPerFace.some((x) => !(Number.isFinite(x) && x > 0))) return emptyOut;
  if (!(Number.isFinite(Ws) && Ws >= 0)) return emptyOut;

  const omegaV = ensureValid(fixPolygonSafe(omegaPoly), 'omega', debugRef);
  if (!omegaV || omegaV.isEmpty?.()) return emptyOut;

  // 先用 omegaV 获取尺度信息（用于自适应 shrink/eps），再构造 omegaSafe。
  const bboxOmegaV = envToBox(omegaV.getEnvelopeInternal());
  if (!bboxOmegaV) return emptyOut;
  const spanXV = bboxOmegaV.maxX - bboxOmegaV.minX;
  const spanYV = bboxOmegaV.maxY - bboxOmegaV.minY;
  if (!(Number.isFinite(spanXV) && spanXV > 1e-6 && Number.isFinite(spanYV) && spanYV > 1e-6)) return emptyOut;

  // 数值稳定：轻微收缩 omega 作为“严格包含”的安全壳，不改变工程口径。
  let omegaSafe = omegaV;
  try {
    // 旧值固定 -0.01m 在小采区/窄条带上可能过于激进；按尺度自适应。
    const minSpan = Math.max(0, Math.min(spanXV, spanYV));
    const shrink = -Math.min(0.01, 0.001 * minSpan);
    const shrunk = BufferOp.bufferOp(omegaV, shrink);
    const picked = fixPolygonSafe(pickLargestPolygon(shrunk));
    if (picked && !picked.isEmpty?.() && picked.getArea?.() > 0) omegaSafe = picked;
  } catch {
    omegaSafe = omegaV;
  }
  omegaSafe = ensureValid(omegaSafe, 'omegaSafe', debugRef);

  const bboxOmega = envToBox(omegaSafe.getEnvelopeInternal());
  if (!bboxOmega) return emptyOut;

  const spanX = bboxOmega.maxX - bboxOmega.minX;
  const spanY = bboxOmega.maxY - bboxOmega.minY;
  if (!(Number.isFinite(spanX) && spanX > 1e-6 && Number.isFinite(spanY) && spanY > 1e-6)) return emptyOut;

  // 推进长度上限：优先用输入框（Lmax），否则取可采区推进方向几何跨度
  const Lcap = (Number.isFinite(Number(Lmax)) && Number(Lmax) > 0)
    ? Number(Lmax)
    : (axis === 'x' ? spanX : spanY);

  // 为了满足严格包含（且抵抗数值误差/贴边），对可行区间端点做轻微内缩。
  // 不改变“规则矩形/等宽/轴对齐”的工程口径，只是让解更稳定。
  // 原最小 0.05m 在窄条带/临界几何下可能把可行解“挤没”；下调并减小比例。
  const minB = BPerFace.length ? Math.min(...BPerFace) : Number(B);
  const insideEps = Math.max(0.01, Math.min(0.5, 0.001 * Math.min(minB, spanX, spanY)));

  const totalW = BPerFace.reduce((s, x) => s + (Number.isFinite(x) ? Number(x) : 0), 0) + (N - 1) * Ws;
  const rectLoopsLocal = [];
  const clippedLoopsLocal = [];
  const lengths = [];
  let rectAreaTotal = 0;
  let clippedAreaTotal = 0;

  const doAssertRectInsideOmega = Boolean(debugRef?.assertRectInsideOmega);

  const geomToLineStrings = (geom) => {
    const out = [];
    const walk = (g) => {
      if (!g || g.isEmpty?.()) return;
      try {
        const t = String(g.getGeometryType?.() ?? '');
        if (t === 'LineString' || t === 'LinearRing') {
          out.push(g);
          return;
        }
        const n = Number(g.getNumGeometries?.());
        if (Number.isFinite(n) && n > 0) {
          for (let i = 0; i < n; i++) walk(g.getGeometryN(i));
        }
      } catch {
        // ignore
      }
    };
    walk(geom);
    return out;
  };

  // === bandPoly 前置约束范式 ===
  // 每条带先求 bandPoly = omegaSafe ∩ bandRect，再在 bandPoly 内反算可行推进区间。
  // contains 仅作为断言/诊断，不再作为主要筛选。

  // fast path：对“无孔 Polygon”的外环做数值扫描线求交，避免 JSTS overlay(line) 的高开销
  const buildFastRingIndex = (poly) => {
    if (!poly || poly.isEmpty?.()) return null;
    try {
      const holes = Number(poly.getNumInteriorRing?.() ?? 0);
      if (Number.isFinite(holes) && holes > 0) return { hasHoles: true };
      const ring = poly.getExteriorRing?.();
      const coords = ring?.getCoordinates?.() ?? [];
      if (!coords || coords.length < 4) return null;
      const pts = [];
      for (const c of coords) {
        const x = Number(c?.x);
        const y = Number(c?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        pts.push({ x, y });
      }
      if (pts.length < 4) return null;
      return { hasHoles: false, pts };
    } catch {
      return null;
    }
  };

  const fastIntervalsAtFromRing = (fastRing, yOrX) => {
    const pts = fastRing?.pts;
    if (!pts || pts.length < 4) return [];
    const v = Number(yOrX);
    if (!Number.isFinite(v)) return [];

    const xs = [];
    // iterate segments (pts expected closed; if not, still ok)
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const x1 = Number(a?.x);
      const y1 = Number(a?.y);
      const x2 = Number(b?.x);
      const y2 = Number(b?.y);
      if (![x1, y1, x2, y2].every(Number.isFinite)) continue;

      if (axis === 'x') {
        // horizontal scanline at y=v
        if (y1 === y2) continue;
        const lo = Math.min(y1, y2);
        const hi = Math.max(y1, y2);
        // half-open to avoid double-counting vertices
        if (!(v >= lo && v < hi)) continue;
        const t = (v - y1) / (y2 - y1);
        const x = x1 + t * (x2 - x1);
        if (Number.isFinite(x)) xs.push(x);
      } else {
        // vertical scanline at x=v
        if (x1 === x2) continue;
        const lo = Math.min(x1, x2);
        const hi = Math.max(x1, x2);
        if (!(v >= lo && v < hi)) continue;
        const t = (v - x1) / (x2 - x1);
        const y = y1 + t * (y2 - y1);
        if (Number.isFinite(y)) xs.push(y);
      }
    }

    xs.sort((a, b) => a - b);
    const intervals = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = xs[i];
      const b = xs[i + 1];
      if (Number.isFinite(a) && Number.isFinite(b) && b > a + 1e-6) intervals.push({ a, b });
    }
    return mergeIntervals(intervals);
  };

  const collectCriticalAxisVals = (geom, bandLo, bandHi) => {
    const lo = Number(bandLo);
    const hi = Number(bandHi);
    if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)) return [];

    const vals = [];
    const walk = (g) => {
      if (!g || g.isEmpty?.()) return;
      try {
        const t = String(g.getGeometryType?.() ?? '');
        if (t === 'Polygon') {
          const ring = g.getExteriorRing?.();
          const coords = ring?.getCoordinates?.() ?? [];
          for (const c of coords) {
            const v = axis === 'x' ? Number(c?.y) : Number(c?.x);
            if (!Number.isFinite(v)) continue;
            if (v > lo && v < hi) vals.push(v);
          }
          return;
        }
        const n = Number(g.getNumGeometries?.());
        if (Number.isFinite(n) && n > 0) {
          for (let i = 0; i < n; i++) walk(g.getGeometryN(i));
        }
      } catch {
        // ignore
      }
    };
    walk(geom);
    return uniqNums(vals, 1e-6);
  };

  const bandMemo = new Map();

  const buildBandPoly = (bandLo, bandHi) => {
    const lo = Number(bandLo);
    const hi = Number(bandHi);
    if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)) return null;

    const key = `${Math.round(lo * 1000)}|${Math.round(hi * 1000)}`;
    if (bandMemo.has(key)) return bandMemo.get(key);

    try {
      let bandRect = null;
      if (axis === 'x') {
        const y0 = lo;
        const y1 = hi;
        bandRect = rectPoly(bboxOmega.minX - 1, y0, bboxOmega.maxX + 1, y1);
      } else {
        const x0 = lo;
        const x1 = hi;
        bandRect = rectPoly(x0, bboxOmega.minY - 1, x1, bboxOmega.maxY + 1);
      }
      if (!bandRect || bandRect.isEmpty?.()) {
        bandMemo.set(key, null);
        return null;
      }
      const inter = robustIntersection(omegaSafe, bandRect);
      const picked = fixPolygonSafe(pickLargestPolygon(inter));
      const v = ensureValid(picked, 'bandPoly', debugRef);
      if (!v || v.isEmpty?.() || !(Number(v.getArea?.()) > 1e-6)) {
        bandMemo.set(key, null);
        return null;
      }

      const fastRing = buildFastRingIndex(v);
      const out = { poly: v, fastRing };
      bandMemo.set(key, out);
      return out;
    } catch {
      bandMemo.set(key, null);
      return null;
    }
  };

  // 用扫描线与 bandPoly 相交，提取真实的线段区间
  const getIntervalsAt = (bandData, yOrX) => {
    const bandPoly = bandData?.poly ?? bandData;
    if (!bandPoly || bandPoly.isEmpty?.()) return [];

    const fastRing = bandData?.fastRing;
    if (fastRing && fastRing.hasHoles === false && Array.isArray(fastRing.pts) && fastRing.pts.length >= 4) {
      return fastIntervalsAtFromRing(fastRing, yOrX);
    }

    if (axis === 'x') {
      const y = Number(yOrX);
      if (!Number.isFinite(y)) return [];
      const line = gf.createLineString([
        new Coordinate(bboxOmega.minX - 1, y),
        new Coordinate(bboxOmega.maxX + 1, y),
      ]);
      const inter = robustIntersection(bandPoly, line);
      const lines = geomToLineStrings(inter);
      const intervals = [];
      for (const ln of lines) {
        const coords = ln?.getCoordinates?.() ?? [];
        if (!coords || coords.length < 2) continue;
        let minX = Infinity;
        let maxX = -Infinity;
        for (const c of coords) {
          const x = Number(c?.x);
          if (!Number.isFinite(x)) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
        if (Number.isFinite(minX) && Number.isFinite(maxX) && maxX > minX + 1e-6) intervals.push({ a: minX, b: maxX });
      }
      return mergeIntervals(intervals);
    }

    const x = Number(yOrX);
    if (!Number.isFinite(x)) return [];
    const line = gf.createLineString([
      new Coordinate(x, bboxOmega.minY - 1),
      new Coordinate(x, bboxOmega.maxY + 1),
    ]);
    const inter = robustIntersection(bandPoly, line);
    const lines = geomToLineStrings(inter);
    const intervals = [];
    for (const ln of lines) {
      const coords = ln?.getCoordinates?.() ?? [];
      if (!coords || coords.length < 2) continue;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const c of coords) {
        const y = Number(c?.y);
        if (!Number.isFinite(y)) continue;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (Number.isFinite(minY) && Number.isFinite(maxY) && maxY > minY + 1e-6) intervals.push({ a: minY, b: maxY });
    }
    return mergeIntervals(intervals);
  };

  const pickBandMaxInterval = (bandData, bandLo, bandHi, sampleCount = 9) => {
    const bandPoly = bandData?.poly ?? bandData;
    if (!bandPoly || bandPoly.isEmpty?.()) return null;
    const lo = Number(bandLo);
    const hi = Number(bandHi);
    if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)) return null;

    const buildSamplesFromCritical = () => {
      try {
        const uniq = collectCriticalAxisVals(bandPoly, lo, hi).sort((a, b) => a - b);
        const base = [lo, ...uniq, hi].sort((a, b) => a - b);

        const span = hi - lo;
        const eps = Math.max(1e-3, span * 1e-6);

        const samples = [];
        samples.push(lo + eps);
        samples.push(hi - eps);
        for (let i = 0; i < base.length - 1; i++) {
          const a = base[i];
          const b = base[i + 1];
          if (!(Number.isFinite(a) && Number.isFinite(b) && b > a + eps * 2)) continue;
          samples.push((a + b) / 2);
        }
        return uniqNums(samples, 1e-6).filter((v) => v > lo && v < hi);
      } catch {
        return [];
      }
    };

    let samples = buildSamplesFromCritical();
    if (samples.length < 5) {
      const m = Math.max(5, Math.min(51, Math.round(sampleCount)));
      samples = [];
      for (let k = 0; k < m; k++) samples.push(lo + ((k + 0.5) / m) * (hi - lo));
    }

    let common = null;
    for (const s of samples) {
      const ints = getIntervalsAt(bandData, s);
      if (!ints.length) return null;
      common = common ? intersectIntervals(common, ints) : ints;
      if (!common.length) return null;
    }

    let best = null;
    let bestLen = -Infinity;
    for (const it of common) {
      const len = it.b - it.a;
      if (len > bestLen) {
        bestLen = len;
        best = it;
      }
    }
    return best && bestLen > 1e-6 ? best : null;
  };

  if (axis === 'x') {
    const span = spanY;
    const margin = Math.max(0, span - totalW);

    const startMin = bboxOmega.minY;
    const startMax = bboxOmega.maxY - totalW;
    const startGuess = (String(startFrom) === 'min')
      ? startMin
      : (String(startFrom) === 'max' ? startMax : (bboxOmega.minY + margin / 2));

    const buildForStart = (yStart0) => {
      const out = {
        rectLoopsLocal: [],
        clippedLoopsLocal: [],
        faceCount: 0,
        rectAreaTotal: 0,
        clippedAreaTotal: 0,
        lengths: [],
        area: 0,
      };

      const bandStartAt = (i0) => {
        let acc = 0;
        for (let k = 0; k < i0; k++) acc += (Number(BPerFace[k]) || 0) + Ws;
        return yStart0 + acc;
      };

      for (let i = 0; i < N; i++) {
        const Bi = Number(BPerFace[i]) || 0;
        const y0 = bandStartAt(i);
        const y1 = y0 + Bi;
        const band = buildBandPoly(y0, y1);
        if (!band) {
          if (typeof bumpFail === 'function') bumpFail('BAND_POLY_EMPTY');
          continue;
        }

        let it = pickBandMaxInterval(band, y0, y1, fast ? 7 : 9);
        if (!it && !fast) it = pickBandMaxInterval(band, y0, y1, 21);
        if (!it) {
          if (typeof bumpFail === 'function') bumpFail('BAND_NO_FEASIBLE_X');
          continue;
        }

        const rawLen0 = Math.max(0, it.b - it.a);
        const safeLen = rawLen0 - 2 * insideEps;
        const Lgeom = Math.max(0, safeLen);
        const L = Math.min(Lgeom, Lcap);
        if (!(Number.isFinite(L) && L > 1e-6)) {
          if (typeof bumpFail === 'function') bumpFail('BAND_NO_FEASIBLE_X');
          continue;
        }

        const x0 = it.a + insideEps;
        const x1 = x0 + L;
        const loop = rectToLoop(x0, y0, x1, y1);
        if (!loop) {
          if (typeof bumpFail === 'function') bumpFail('RECT_BUILD_FAIL');
          continue;
        }

        // 默认不做每个矩形的几何断言（非常耗时）；需要诊断时可在 debugRef.assertRectInsideOmega=true 打开。
        if (doAssertRectInsideOmega || includeClipped) {
          const rect = rectPoly(x0, y0, x1, y1);
          if (!rect || rect.isEmpty?.()) {
            if (typeof bumpFail === 'function') bumpFail('RECT_BUILD_FAIL');
            continue;
          }
          if (doAssertRectInsideOmega && !isRectInsideOmega(omegaSafe, rect)) {
            if (typeof bumpFail === 'function') bumpFail('ASSERT_RECT_OUTSIDE_OMEGA');
            if (debugRef && !debugRef.rectOutsideSample) debugRef.rectOutsideSample = { axis, B: useVarB ? (BPerFace.slice?.() ?? []) : B, ws: Ws, N, y0, y1, x0, x1, insideEps, bboxOmega, coordSpace };
            continue;
          }
          if (includeClipped) {
            try {
              const inter = robustIntersection(omegaSafe, rect);
              const a = Number(inter?.getArea?.());
              if (Number.isFinite(a) && a > 1e-6) out.clippedAreaTotal += a;
              const loops = polygonToLoops(inter);
              for (const l of loops) out.clippedLoopsLocal.push(l);
            } catch {
              // ignore
            }
          }
        }

        out.rectLoopsLocal.push(loop);
        out.lengths.push(L);
        out.rectAreaTotal += Math.max(0, (x1 - x0) * (y1 - y0));
      }
      out.faceCount = out.rectLoopsLocal.length;
      out.area = out.rectAreaTotal;
      return out;
    };

    const best = (String(startFrom) === 'min' || String(startFrom) === 'max')
      ? chooseStartPreferSide(startMin, startMax, buildForStart, fast ? 6 : 10, startFrom)
      : chooseBestStart(startMin, startMax, startGuess, buildForStart, fast ? 6 : 10);
    return {
      rectLoopsLocal: Array.isArray(best?.rectLoopsLocal) ? best.rectLoopsLocal : [],
      clippedLoopsLocal: Array.isArray(best?.clippedLoopsLocal) ? best.clippedLoopsLocal : [],
      faceCount: Number(best?.faceCount) || 0,
      rectAreaTotal: Number(best?.rectAreaTotal) || 0,
      clippedAreaTotal: Number(best?.clippedAreaTotal) || 0,
      lengths: Array.isArray(best?.lengths) ? best.lengths : [],
    };
  }

  // axis === 'y'
  const span = spanX;
  const margin = Math.max(0, span - totalW);

  const startMin = bboxOmega.minX;
  const startMax = bboxOmega.maxX - totalW;
  const startGuess = (String(startFrom) === 'min')
    ? startMin
    : (String(startFrom) === 'max' ? startMax : (bboxOmega.minX + margin / 2));

  const buildForStart = (xStart0) => {
    const out = {
      rectLoopsLocal: [],
      clippedLoopsLocal: [],
      faceCount: 0,
      rectAreaTotal: 0,
      clippedAreaTotal: 0,
      lengths: [],
      area: 0,
    };

    const bandStartAt = (i0) => {
      let acc = 0;
      for (let k = 0; k < i0; k++) acc += (Number(BPerFace[k]) || 0) + Ws;
      return xStart0 + acc;
    };

    for (let i = 0; i < N; i++) {
      const Bi = Number(BPerFace[i]) || 0;
      const x0 = bandStartAt(i);
      const x1 = x0 + Bi;
      const band = buildBandPoly(x0, x1);
      if (!band) {
        if (typeof bumpFail === 'function') bumpFail('BAND_POLY_EMPTY');
        continue;
      }

      let it = pickBandMaxInterval(band, x0, x1, fast ? 7 : 9);
      if (!it && !fast) it = pickBandMaxInterval(band, x0, x1, 21);
      if (!it) {
        if (typeof bumpFail === 'function') bumpFail('BAND_NO_FEASIBLE_Y');
        continue;
      }

      const rawLen0 = Math.max(0, it.b - it.a);
      const safeLen = rawLen0 - 2 * insideEps;
      const Lgeom = Math.max(0, safeLen);
      const L = Math.min(Lgeom, Lcap);
      if (!(Number.isFinite(L) && L > 1e-6)) {
        if (typeof bumpFail === 'function') bumpFail('BAND_NO_FEASIBLE_Y');
        continue;
      }

      const y0 = it.a + insideEps;
      const y1 = y0 + L;
      const loop = rectToLoop(x0, y0, x1, y1);
      if (!loop) {
        if (typeof bumpFail === 'function') bumpFail('RECT_BUILD_FAIL');
        continue;
      }

      if (doAssertRectInsideOmega || includeClipped) {
        const rect = rectPoly(x0, y0, x1, y1);
        if (!rect || rect.isEmpty?.()) {
          if (typeof bumpFail === 'function') bumpFail('RECT_BUILD_FAIL');
          continue;
        }
        if (doAssertRectInsideOmega && !isRectInsideOmega(omegaSafe, rect)) {
          if (typeof bumpFail === 'function') bumpFail('ASSERT_RECT_OUTSIDE_OMEGA');
          if (debugRef && !debugRef.rectOutsideSample) debugRef.rectOutsideSample = { axis, B: useVarB ? (BPerFace.slice?.() ?? []) : B, ws: Ws, N, x0, x1, y0, y1, insideEps, bboxOmega, coordSpace };
          continue;
        }
        if (includeClipped) {
          try {
            const inter = robustIntersection(omegaSafe, rect);
            const a = Number(inter?.getArea?.());
            if (Number.isFinite(a) && a > 1e-6) out.clippedAreaTotal += a;
            const loops = polygonToLoops(inter);
            for (const l of loops) out.clippedLoopsLocal.push(l);
          } catch {
            // ignore
          }
        }
      }

      out.rectLoopsLocal.push(loop);
      out.lengths.push(L);
      out.rectAreaTotal += Math.max(0, (x1 - x0) * (y1 - y0));
    }
    out.faceCount = out.rectLoopsLocal.length;
    out.area = out.rectAreaTotal;
    return out;
  };

  const best = (String(startFrom) === 'min' || String(startFrom) === 'max')
    ? chooseStartPreferSide(startMin, startMax, buildForStart, fast ? 6 : 10, startFrom)
    : chooseBestStart(startMin, startMax, startGuess, buildForStart, fast ? 6 : 10);
  return {
    rectLoopsLocal: Array.isArray(best?.rectLoopsLocal) ? best.rectLoopsLocal : [],
    clippedLoopsLocal: Array.isArray(best?.clippedLoopsLocal) ? best.clippedLoopsLocal : [],
    faceCount: Number(best?.faceCount) || 0,
    rectAreaTotal: Number(best?.rectAreaTotal) || 0,
    clippedAreaTotal: Number(best?.clippedAreaTotal) || 0,
    lengths: Array.isArray(best?.lengths) ? best.lengths : [],
  };
};

const compute = (payload) => {
  const reqSeq = Number(payload?.reqSeq);
  const cacheKey = String(payload?.cacheKey ?? '');
  const originalAxis = String(payload?.axis ?? 'x') === 'y' ? 'y' : 'x';
  const optMode = 'recovery';
  const internalAxis = 'x';
  const swapXY = originalAxis === 'y';
  const requestedFast = Boolean(payload?.fast);
  // 角度锁定（用户要求）：把所有角度限制为 0°
  // - theta 固定为 0（不做整体旋转）
  // - per-face 的远边调斜 deltaDeg_i 全部固定为 0（不做梯形调斜）
  // 说明：仍允许单面宽度变化（BList）与长度 grow（按边界取极值/尽量铺满）。
  const LOCK_ZERO_ANGLES = Boolean(payload?.lockAnglesZero ?? true);
  // recovery v1.0：只要开启 per-face（或显式要求 topK>1），就强制走 full compute，避免 fast 预览导致“只有 1 个候选”。
  const requestedTopK = Math.max(1, Math.min(30, Math.round(toNum(payload?.topK) ?? 10)));
  const forceFullCompute = Boolean(payload?.perFaceTrapezoid) || requestedTopK > 1;
  const fastMode = requestedFast && !forceFullCompute;

  // 可选：严格时间预算（用于需要更快的 UI 响应）。
  // 默认 false：保持历史口径（含 grace + per-face extra budget）。
  const STRICT_TIME_BUDGET = Boolean(payload?.strictTimeBudget);

  // v1.0：每次 recovery 回包都必须包含 debug.perFace（用于判清 R1/R2/R3）
  const perFaceDebug = {
    enabled: false,
    fastMode,
    fixedSide: 'bottom',
    generated: 0,
    qualified: 0,
    pushedUnique: 0,
    lastReason: '',
    seedCount: 0,
    deltaSetCount: 0,
    usedFallbackRmin: false,
    inRatioMin: null,
    inRatioTry: null,
  };

  const withPerFaceDebug = (debugObj) => ({
    ...(debugObj && typeof debugObj === 'object' ? debugObj : {}),
    perFace: { ...perFaceDebug },
  });

  const nowMs = () => {
    try {
      return (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
    } catch {
      return Date.now();
    }
  };

  const startMs = nowMs();

  // 时间预算：
  // - fast 预览：280ms
  // - full compute（per-face 开启时）：默认 1800ms（避免 UI 长时间“计算中”）
  // - 可通过 payload.maxTimeMs 覆盖（单位 ms）
  const userBudgetMs = toNum(payload?.maxTimeMs);
  const defaultFullBudgetMs = Boolean(payload?.perFaceTrapezoid) ? 1800 : Infinity;
  const TIME_BUDGET_MS = fastMode
    ? 280
    : (Number.isFinite(userBudgetMs)
      ? clamp(Number(userBudgetMs), 200, 20000)
      : defaultFullBudgetMs);
  // 宽限：避免轻微超时导致标记 partial（并触发 response.fast=true），同时给收尾/排序留一点空间。
  // 只对 full compute 生效，fastMode 仍保持严格预算。
  const GRACE_MS = (fastMode || STRICT_TIME_BUDGET)
    ? 0
    : (Number.isFinite(TIME_BUDGET_MS) ? Math.min(500, Math.max(0, TIME_BUDGET_MS * 0.05)) : 0);
  const deadlineMs = Number.isFinite(TIME_BUDGET_MS) ? (startMs + TIME_BUDGET_MS + GRACE_MS) : Infinity;
  let timeBudgetHit = false;
  const timeExceeded = () => {
    if (timeBudgetHit) return true;
    if (nowMs() > deadlineMs) {
      timeBudgetHit = true;
      return true;
    }
    return false;
  };

  // per-face refine 额外预算：避免主流程耗尽预算后 per-face 完全不运行（表现为 perFace.generated=0）
  // 默认 260ms，可通过 payload.perFaceExtraBudgetMs 调整。
  const PER_FACE_EXTRA_BUDGET_MS = STRICT_TIME_BUDGET
    ? 0
    : clamp(Math.round(Number(toNum(payload?.perFaceExtraBudgetMs) ?? 260)), 0, 2000);
  let perFaceExtraBudgetUsed = false;
  const perFaceTimeExceeded = () => {
    // 主预算未超时：沿用主预算
    if (nowMs() <= deadlineMs) return false;
    // 主预算超时：给 per-face 一小段额外预算
    if (PER_FACE_EXTRA_BUDGET_MS <= 0) return true;
    perFaceExtraBudgetUsed = true;
    return nowMs() > (deadlineMs + PER_FACE_EXTRA_BUDGET_MS);
  };

  // 资源回收：不设覆盖率硬阈值（仅几何硬约束）。
  const COVERAGE_MIN = 0;

  // v1.2：工程验收口径
  // - fullCover: 要求“非煤柱区域”达到指定覆盖率
  // - ignoreCoalPillarsInCoverage: 覆盖/残煤计算时扣除中间煤柱区（默认跟随 fullCover）
  const FULL_COVER_ENABLED = Boolean(payload?.fullCover);
  const FULL_COVER_MIN = clamp(Number(toNum(payload?.fullCoverMin) ?? 0.995), 0, 1);
  const IGNORE_COAL_PILLARS_IN_COVERAGE = Boolean(payload?.ignoreCoalPillarsInCoverage ?? FULL_COVER_ENABLED);
  const FULL_COVER_PATCH_ENABLED = Boolean(payload?.fullCoverPatch ?? FULL_COVER_ENABLED);
  const FULL_COVER_PATCH_BUDGET_MS = clamp(Math.round(Number(toNum(payload?.fullCoverPatchMaxTimeMs) ?? 1200)), 100, 8000);

  const responseBase = {
    ok: false,
    fast: fastMode,
    failedReason: '',
    mode: 'smart-resource',
    optMode,
    reqSeq,
    cacheKey,
    axis: originalAxis,
    omegaRender: null,
    omegaArea: null,
    candidates: [],
    // v1.0：回包字段契约（前端会硬校验必须存在 tonnageTotal）
    tonnageTotal: 0,
    attemptSummary: {
      attemptedCombos: 0,
      feasibleCombos: 0,
      failTypes: {},
      timeBudgetMs: Number.isFinite(TIME_BUDGET_MS) ? TIME_BUDGET_MS : null,
      timeBudgetHit: false,
      Bsearch: {
        version: fastMode ? 'v2-fast' : 'v2',
        coarseStep: fastMode ? 50 : 25,
        fineStep: 1,
        fineHalfWin: fastMode ? 6 : 10,
        coarseTopM: fastMode ? 2 : 5,
        coarseEvaluatedBCount: 0,
        fineEvaluatedBCount: 0,
        seedBs: [],
      },
      perFaceExtraBudgetMs: PER_FACE_EXTRA_BUDGET_MS,
      perFaceExtraBudgetUsed: false,
    },
    version: SMART_RESOURCE_VERSION,
  };

  // 进度上报：用于前端“计算中…”后显示当前尝试/可行计数。
  // 必须节流，避免高频 postMessage 拖慢几何计算。
  let lastProgressMs = nowMs();
  let lastAttemptedSent = 0;
  const PROGRESS_THROTTLE_MS = 180;
  const PROGRESS_MIN_DELTA = 80;
  const maybePostProgress = (phase) => {
    try {
      const attempted = Number(responseBase?.attemptSummary?.attemptedCombos ?? 0);
      const feasible = Number(responseBase?.attemptSummary?.feasibleCombos ?? 0);
      const t = nowMs();
      if ((attempted - lastAttemptedSent) < PROGRESS_MIN_DELTA && (t - lastProgressMs) < PROGRESS_THROTTLE_MS) return;
      lastAttemptedSent = attempted;
      lastProgressMs = t;

      const denom = (Number.isFinite(TIME_BUDGET_MS) && TIME_BUDGET_MS < Infinity)
        ? Math.max(1, Number(TIME_BUDGET_MS) + Number(GRACE_MS || 0))
        : null;
      const percent = (denom != null)
        ? Math.max(0, Math.min(99, Math.floor(((t - startMs) / denom) * 100)))
        : null;

      self.postMessage({
        type: 'progress',
        payload: {
          mode: 'smart-resource',
          reqSeq,
          cacheKey,
          axis: originalAxis,
          fast: fastMode,
          progress: {
            phase: String(phase ?? ''),
            percent,
            attemptedCombos: attempted,
            feasibleCombos: feasible,
          },
        },
      });
    } catch {
      // ignore
    }
  };

  const bumpFail = (code) => {
    const k = String(code || 'UNKNOWN');
    const cur = Number(responseBase.attemptSummary.failTypes[k] ?? 0);
    responseBase.attemptSummary.failTypes[k] = cur + 1;
  };

  const boundaryLoopWorldRaw = Array.isArray(payload?.boundaryLoopWorld) ? payload.boundaryLoopWorld : [];
  const boundaryLoopWorld = swapXY ? swapXYPoints(boundaryLoopWorldRaw) : boundaryLoopWorldRaw;
  maybePostProgress('初始化');
  if (boundaryLoopWorldRaw.length < 3) {
    responseBase.failedReason = '采区边界点不足/退化';
    bumpFail('BOUNDARY_TOO_FEW');
    return {
      ...responseBase,
      message: '边界点不足，无法计算。',
      debug: withPerFaceDebug({
        boundaryNormalized: {
          pointCount: boundaryLoopWorldRaw.length,
          closed: null,
          area: null,
          isValid: false,
        },
      }),
    };
  }

  const DEFAULT_BMIN = 100;
  const DEFAULT_BMAX = 350;
  const faceWidthMinRaw = toNum(payload?.faceWidthMin);
  const faceWidthMaxRaw = toNum(payload?.faceWidthMax);
  const Bmin = Number.isFinite(faceWidthMinRaw) ? faceWidthMinRaw : DEFAULT_BMIN;
  const Bmax = Number.isFinite(faceWidthMaxRaw) ? faceWidthMaxRaw : DEFAULT_BMAX;

  // A1 防线：宽度范围必须为正数且 min<=max。前端应已归一化，但这里再硬校验避免进入枚举循环。
  if (!Number.isFinite(Bmin) || !Number.isFinite(Bmax) || Bmin <= 0 || Bmax <= 0 || Bmin > Bmax) {
    responseBase.failedReason = '工作面宽度范围输入非法（应为正数且 min<=max），请检查采区参数编辑器';
    responseBase.attemptSummary.failTypes.INPUT_INVALID_B = 1;
    return {
      ...responseBase,
      message: responseBase.failedReason,
      debug: withPerFaceDebug({
        B: { min: Bmin, max: Bmax },
      }),
    };
  }

  const wbMin = toNum(payload?.boundaryPillarMin) ?? 0;
  const wbMax = toNum(payload?.boundaryPillarMax) ?? wbMin;

  const wsMin = toNum(payload?.coalPillarMin) ?? 0;
  const wsMax = toNum(payload?.coalPillarMax) ?? wsMin;

  const faceAdvanceMax = toNum(payload?.faceAdvanceMax);

  const topK = requestedTopK;

  const boundaryNorm = normalizeBoundaryPoints(boundaryLoopWorld, 1e-6);
  if (!boundaryNorm.ok) {
    responseBase.failedReason = boundaryNorm.reason;
    bumpFail('BOUNDARY_INVALID');
    return {
      ...responseBase,
      message: boundaryNorm.reason,
      debug: withPerFaceDebug({
        boundaryNormalized: {
          pointCount: boundaryNorm.pointCount,
          closed: boundaryNorm.closed,
          area: boundaryNorm.area,
          isValid: false,
        },
      }),
    };
  }

  const baseLocal = buildPolygonLocalFromNormalized(boundaryNorm.points);
  if (!baseLocal.ok) {
    responseBase.failedReason = baseLocal.reason;
    bumpFail('BOUNDARY_BUILD_POLY_FAIL');
    return {
      ...responseBase,
      message: baseLocal.reason,
      debug: withPerFaceDebug({
        boundaryNormalized: {
          pointCount: boundaryNorm.pointCount,
          closed: boundaryNorm.closed,
          area: boundaryNorm.area,
          isValid: false,
        },
      }),
    };
  }

  const baseValidated = validatePolygonLike(baseLocal.poly);
  if (!baseValidated.ok) {
    responseBase.failedReason = baseValidated.reason;
    bumpFail('BOUNDARY_SELF_INTERSECTION');
    return {
      ...responseBase,
      message: baseValidated.reason + (baseValidated.fixError ? `（${baseValidated.fixError}）` : ''),
      debug: withPerFaceDebug({
        boundaryNormalized: {
          pointCount: boundaryNorm.pointCount,
          closed: boundaryNorm.closed,
          area: boundaryNorm.area,
          isValid: Boolean(baseValidated.isValid),
          fixedBy: baseValidated.fixedBy || '',
          fixError: baseValidated.fixError || '',
        },
      }),
    };
  }

  const basePolyLocal = baseValidated.poly;
  const offset = baseLocal.offset;

  const stripDebug = { sampleNoOverlap: null, sanity: null, valid: null, fallbackUsed: false, stripIntersectionEmptySample: null };

  // 先用 wbMin 构造 innerOmega（不通过则直接退出，避免“笼统未找到方案”）
  const wbMinUsed = Math.abs(Number(wbMin) || 0);
  const bufferDistance0 = -Math.abs(wbMinUsed);
  let omegaLocal0 = null;
  let omegaErr0 = '';
  try {
    omegaLocal0 = BufferOp.bufferOp(basePolyLocal, bufferDistance0);
  } catch (e) {
    omegaLocal0 = null;
    omegaErr0 = String(e?.message ?? e);
  }

  const omegaPoly0 = fixPolygonSafe(pickLargestPolygon(omegaLocal0));
  const omegaArea0 = Number(omegaPoly0?.getArea?.());
  const omegaLoopsLocal0 = polygonToLoops(omegaPoly0);
  const omegaLoopsWorld0 = translateLoops(omegaLoopsLocal0, offset.dx, offset.dy);
  const omegaLoopsWorld0Out = swapXY ? swapXYLoops(omegaLoopsWorld0) : omegaLoopsWorld0;

  const omegaDebug0 = {
    wbUsed: wbMinUsed,
    bboxLocal: baseLocal.bboxLocal ?? null,
    omegaArea: Number.isFinite(omegaArea0) ? omegaArea0 : null,
    omegaLoopsCount: omegaLoopsWorld0.length,
    bufferDistance: bufferDistance0,
    bufferError: omegaErr0,
  };

  if (omegaErr0) {
    const reason = `内缩失败：BufferOp异常: ${omegaErr0}`;
    responseBase.failedReason = reason;
    bumpFail('OMEGA_BUFFER_ERROR');
    return {
      ...responseBase,
      message: reason,
      debug: withPerFaceDebug({
        boundaryNormalized: {
          pointCount: boundaryNorm.pointCount,
          closed: boundaryNorm.closed,
          area: boundaryNorm.area,
          isValid: true,
          fixedBy: baseValidated.fixedBy || '',
        },
        omega: omegaDebug0,
      }),
    };
  }

  if (!omegaPoly0 || omegaPoly0.isEmpty?.() || !(Number.isFinite(omegaArea0) && omegaArea0 > 1e-6) || omegaLoopsWorld0.length === 0) {
    const reason = `内缩后可采区为空（wb=${wbMinUsed}m）`;
    responseBase.failedReason = reason;
    bumpFail('OMEGA_EMPTY');
    return {
      ...responseBase,
      message: reason,
      debug: withPerFaceDebug({
        boundaryNormalized: {
          pointCount: boundaryNorm.pointCount,
          closed: boundaryNorm.closed,
          area: boundaryNorm.area,
          isValid: true,
          fixedBy: baseValidated.fixedBy || '',
        },
        omega: omegaDebug0,
      }),
    };
  }

  // omega 成功：无论后续候选是否找到，都必须带回 omegaRender/omegaArea
  responseBase.omegaRender = { loops: omegaLoopsWorld0Out };
  responseBase.omegaArea = omegaArea0;

  // v1.0：coverage 分母冻结为“展示Ω”（wbMin 内缩得到的 omegaArea）
  const omegaAreaForCoverage = Number.isFinite(Number(omegaArea0)) && Number(omegaArea0) > 1e-9 ? Number(omegaArea0) : Number(omegaArea0) || 0;

  // sanityRect：必定穿过 omega 的 10% 中心带，用于一锤定音坐标系/裁切实现问题
  try {
    const omegaV0 = ensureValid(fixPolygonSafe(omegaPoly0), 'omega0', stripDebug);
    const bboxOmega0 = envToBox(omegaV0?.getEnvelopeInternal?.());
    if (bboxOmega0) {
      if (internalAxis === 'x') {
        const yMid = (bboxOmega0.minY + bboxOmega0.maxY) / 2;
        const h = (bboxOmega0.maxY - bboxOmega0.minY) * 0.1;
        const sanityRaw = rectPoly(bboxOmega0.minX - 1, yMid - h / 2, bboxOmega0.maxX + 1, yMid + h / 2);
        const sanity = ensureValid(sanityRaw, 'sanity', stripDebug);
        const bboxSanity = envToBox(sanity.getEnvelopeInternal());
        const inter = robustIntersection(omegaV0, sanity);
        const a = Number(inter?.getArea?.());
        stripDebug.sanity = { bboxOmega: bboxOmega0, bboxSanity, coordSpace: 'local', area: Number.isFinite(a) ? a : null };
        if (!(Number.isFinite(a) && a > 1e-6)) {
          const reason = '裁切实现/坐标系异常：sanityRect 与 omega 不相交（axis=x）';
          responseBase.failedReason = reason;
          return {
            ...responseBase,
            message: reason,
            debug: withPerFaceDebug({
              boundaryNormalized: {
                pointCount: boundaryNorm.pointCount,
                closed: boundaryNorm.closed,
                area: boundaryNorm.area,
                isValid: true,
                fixedBy: baseValidated.fixedBy || '',
              },
              omega: omegaDebug0,
              strip: stripDebug,
              transform: { coordSpace: 'local', tx: offset.dx, ty: offset.dy },
            }),
          };
        }
      } else {
        const xMid = (bboxOmega0.minX + bboxOmega0.maxX) / 2;
        const w = (bboxOmega0.maxX - bboxOmega0.minX) * 0.1;
        const sanityRaw = rectPoly(xMid - w / 2, bboxOmega0.minY - 1, xMid + w / 2, bboxOmega0.maxY + 1);
        const sanity = ensureValid(sanityRaw, 'sanity', stripDebug);
        const bboxSanity = envToBox(sanity.getEnvelopeInternal());
        const inter = robustIntersection(omegaV0, sanity);
        const a = Number(inter?.getArea?.());
        stripDebug.sanity = { bboxOmega: bboxOmega0, bboxSanity, coordSpace: 'local', area: Number.isFinite(a) ? a : null };
        if (!(Number.isFinite(a) && a > 1e-6)) {
          const reason = '裁切实现/坐标系异常：sanityRect 与 omega 不相交（axis=y）';
          responseBase.failedReason = reason;
          return {
            ...responseBase,
            message: reason,
            debug: withPerFaceDebug({
              boundaryNormalized: {
                pointCount: boundaryNorm.pointCount,
                closed: boundaryNorm.closed,
                area: boundaryNorm.area,
                isValid: true,
                fixedBy: baseValidated.fixedBy || '',
              },
              omega: omegaDebug0,
              strip: stripDebug,
              transform: { coordSpace: 'local', tx: offset.dx, ty: offset.dy },
            }),
          };
        }
      }
    }
  } catch {
    // ignore sanity failures here; real strip stats below will show
  }

  // === 全局检索（recovery）：wb 不再固定为均值 ===
  // 说明：若 wb 取均值过大，可能导致 innerOmega 过窄/布局失败，从而出现“Ω 有但无条带组合”的假无解。
  // 策略：在 [wbMin, wbMax] 做 3 点采样（min/mid/max）；fast 预览仅取中值控时。
  const wbFixedRaw = (Number.isFinite(Number(wbMin)) && Number.isFinite(Number(wbMax)))
    ? (Number(wbMin) + Number(wbMax)) / 2
    : (Number.isFinite(Number(wbMin)) ? Number(wbMin) : 0);
  const wbSamplesFull = sampleRange3(wbMin, wbMax);
  const wbSamples = fastMode
    ? (wbSamplesFull.length ? [wbSamplesFull[Math.floor(wbSamplesFull.length / 2)]] : [Math.max(0, wbFixedRaw)])
    : (wbSamplesFull.length ? wbSamplesFull : [Math.max(0, wbFixedRaw)]);
  const wsSamplesFull = sampleRange3(wsMin, wsMax);
  const wsSamples = fastMode
    ? (wsSamplesFull.length ? [wsSamplesFull[Math.floor(wsSamplesFull.length / 2)]] : [Math.max(0, wsMin)])
    : wsSamplesFull;

  // === B 两阶段搜索策略（粗搜 + 局部 1m 精修） ===
  // 说明：按你确认的层级 A：对每个 (ws,N) 单独做粗搜+精修。
  // B 口径：整数米；精修范围 [ceil(Bmin) .. floor(Bmax)]，步长=1。
  const B_COARSE_STEP = fastMode ? 50 : 25;
  const B_FINE_STEP = 1;
  const B_FINE_HALFWIN = fastMode ? 6 : 10;
  const B_COARSE_TOPM = fastMode ? 2 : 5;
  const DO_FINE = !fastMode;

  const seedBSet = new Set();
  const recordSeedB = (b) => {
    const v = Math.round(Number(b));
    if (!Number.isFinite(v)) return;
    const k = String(v);
    if (seedBSet.has(k)) return;
    seedBSet.add(k);
    responseBase.attemptSummary.Bsearch.seedBs.push(v);
  };

  const compareWithinSameN = (a, b) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (b.coverageRatio !== a.coverageRatio) return b.coverageRatio - a.coverageRatio;
    if ((a.lenCV ?? 0) !== (b.lenCV ?? 0)) return (a.lenCV ?? 0) - (b.lenCV ?? 0);
    if (b.B !== a.B) return b.B - a.B;
    return String(a.signature).localeCompare(String(b.signature));
  };

  const genCoarseBs = (lo, hi) => {
    const a = Math.ceil(Number(lo));
    const b = Math.floor(Number(hi));
    if (!(Number.isFinite(a) && Number.isFinite(b) && b >= a)) return [];
    const start = Math.ceil(a / B_COARSE_STEP) * B_COARSE_STEP;
    const list = [];
    list.push(a);
    for (let x = start; x <= b; x += B_COARSE_STEP) list.push(x);
    list.push(b);
    return uniqNums(list, 1e-9).map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x >= a && x <= b);
  };

  const genFineBs = (seedB, lo, hi) => {
    const a = Math.ceil(Number(lo));
    const b = Math.floor(Number(hi));
    const s = Math.round(Number(seedB));
    if (!(Number.isFinite(a) && Number.isFinite(b) && b >= a && Number.isFinite(s))) return [];
    const L = Math.max(a, s - B_FINE_HALFWIN);
    const R = Math.min(b, s + B_FINE_HALFWIN);
    if (R < L) return [];
    const out = [];
    for (let x = L; x <= R; x += B_FINE_STEP) out.push(x);
    return out;
  };

  // relaxed-clipped 的“每面有效占比”阈值：默认跟随 per-face 的阈值，避免前端未传 inRatioMin 时固定 0.7 导致无解。
  const IN_RATIO_MIN = Math.max(0.1, Math.min(0.99, Number(toNum(payload?.inRatioMin ?? payload?.perFaceInRatioMin) ?? 0.7)));

  // 自动降阈值兜底：若当前参数范围下严格/主阈值无解，则逐步降低 inRatioMin（不会低于 floor）。
  // 目的：在边界凹凸/条带贴边情况下仍能给出“可见结果”（按面积口径），避免长时间无解。
  const AUTO_RELAX_INRATIO = Boolean(payload?.autoRelaxInRatio ?? true);
  const AUTO_RELAX_INRATIO_FLOOR = clamp(Number(toNum(payload?.autoRelaxInRatioFloor) ?? 0.5), 0.2, 0.9);

  // 全局兜底检索：当主流程完全无候选时，可进一步下探底线并做小规模随机采样。
  // 默认开启，但下探不会低于 0.35（避免“多数在Ω外”的离谱方案）。可通过 payload.globalFallbackInRatioFloor 调整。
  const GLOBAL_FALLBACK_ENABLE = Boolean(payload?.globalFallback ?? true);
  const GLOBAL_FALLBACK_INRATIO_FLOOR = clamp(Number(toNum(payload?.globalFallbackInRatioFloor) ?? 0.35), 0.2, 0.95);

  // 软目标（1b）：覆盖率为主 + 规整性/贴合罚分；但仍要求每面有效占比不得过低（2 不允许）。
  const SOFT_INRATIO_TARGET = clamp(Number(toNum(payload?.softInRatioTarget ?? payload?.perFaceInRatioMin ?? 0.7) ?? 0.7), 0.2, 0.99);
  const SOFT_INRATIO_FLOOR = clamp(Number(toNum(payload?.softInRatioFloor ?? payload?.autoRelaxInRatioFloor ?? 0.5) ?? 0.5), 0.2, 0.95);
  const SOFT_W_INRATIO = Math.max(0, Number(toNum(payload?.softWInRatio) ?? 200));
  const SOFT_W_LENCV = Math.max(0, Number(toNum(payload?.softWLenCV) ?? 30));
  const SOFT_W_SMOOTH = Math.max(0, Number(toNum(payload?.softWSmoothness) ?? 1.5));
  const SOFT_W_SUMABS = Math.max(0, Number(toNum(payload?.softWSumAbsDelta) ?? 0.3));

  // effective floor：允许在“全局兜底检索”阶段动态下探（会记录到 debug/searchSpace 中）
  let softFloorEffective = SOFT_INRATIO_FLOOR;
  let relaxFloorEffective = AUTO_RELAX_INRATIO_FLOOR;
  let globalFallbackUsed = false;

  const clampScore01 = (x) => {
    const v = Number(x);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  };

  const computeSoftScore = ({ coverageRatio, minInRatio, lenCV, smoothnessDeg, sumAbsDeltaDeg }) => {
    const cov = clampScore01(coverageRatio);
    const base = 100 * cov;

    const r = Number.isFinite(Number(minInRatio)) ? Number(minInRatio) : 1;
    const d = Math.max(0, SOFT_INRATIO_TARGET - r);
    const pIn = SOFT_W_INRATIO * d * d;

    const cv = Number.isFinite(Number(lenCV)) ? Math.max(0, Number(lenCV)) : 0;
    const pCv = SOFT_W_LENCV * cv;

    const sm = Number.isFinite(Number(smoothnessDeg)) ? Math.max(0, Number(smoothnessDeg)) : 0;
    const pSm = SOFT_W_SMOOTH * sm;

    const sa = Number.isFinite(Number(sumAbsDeltaDeg)) ? Math.max(0, Number(sumAbsDeltaDeg)) : 0;
    const pSa = SOFT_W_SUMABS * sa;

    const raw = base - (pIn + pCv + pSm + pSa);
    const softScore = Math.max(0, Math.min(100, raw));
    return {
      softScore,
      penalties: {
        pInRatio: pIn,
        pLenCV: pCv,
        pSmoothness: pSm,
        pSumAbsDelta: pSa,
      },
    };
  };

  // === per-face “远边调斜”受控枚举（v1.0 AREA 跑通）===
  // 说明：不是整块旋转矩形；而是 fixedEdge（靠煤柱侧）保持与 axis 平行，farEdge 按 deltaDeg 调斜。
  const PER_FACE_ENABLE = Boolean(payload?.perFaceTrapezoid);
  const PER_FACE_DELTA_MIN = -10;
  const PER_FACE_DELTA_MAX_ABS = +10;
  const PER_FACE_DELTA_SET = LOCK_ZERO_ANGLES
    ? [0]
    : uniqNums(
      (Array.isArray(payload?.perFaceDeltaSetDeg)
        ? payload.perFaceDeltaSetDeg
        : [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10])
        .map((x) => Number(x))
        .filter(Number.isFinite),
      1e-9
    ).filter((d) => d >= PER_FACE_DELTA_MIN - 1e-9 && d <= PER_FACE_DELTA_MAX_ABS + 1e-9);
  const PER_FACE_ADJ_MAX_STEP = LOCK_ZERO_ANGLES
    ? 0
    : Math.max(0, Math.min(10, Math.abs(Number(toNum(payload?.perFaceAdjMaxStepDeg) ?? 4))));
  const PER_FACE_IN_RATIO_MIN = Math.max(0.1, Math.min(0.99, Number(toNum(payload?.perFaceInRatioMin) ?? 0.7)));
  const PER_FACE_MAX_SEQ = Math.max(1, Math.min(200, Math.round(Number(toNum(payload?.perFaceMaxSeq) ?? 30))));
  const PER_FACE_SEED_M = Math.max(1, Math.min(20, Math.round(Number(toNum(payload?.perFaceSeedM) ?? 8))));
  const PER_FACE_N_SET = Array.isArray(payload?.perFaceNSet)
    ? payload.perFaceNSet.map((x) => Math.max(1, Math.round(Number(x)))).filter((n) => Number.isFinite(n))
    : null;

  // 性能：默认不生成 clippedLoops（UI 实际渲染主要用 rectLoops/facesLoops）。
  // 若需要展示裁切边界，可在 payload.includeClippedLoops=true 打开。
  const INCLUDE_CLIPPED_LOOPS = Boolean(payload?.includeClippedLoops);

  // per-face：骨架布局优先用 relaxed（可裁剪）以提高“Ω 形状不规则/带宽内不连续”时的可行性与方案多样性
  const PER_FACE_PREFER_RELAXED_LAYOUT = Boolean(payload?.perFacePreferRelaxedLayout ?? true);

  // per-face 提速：在时间预算存在时，降低枚举规模（仍尽量保证 topK 可见）。
  const PER_FACE_SEED_M_USE = (() => {
    if (!(Number.isFinite(TIME_BUDGET_MS) && TIME_BUDGET_MS < Infinity)) return PER_FACE_SEED_M;
    const t = Number(TIME_BUDGET_MS);
    // 预算越大允许更充分的 refine；但仍要兜住最坏情况。
    if (t <= 2000) return Math.max(1, Math.min(PER_FACE_SEED_M, 4));
    if (t <= 6000) return Math.max(1, Math.min(PER_FACE_SEED_M, 6));
    return Math.max(1, Math.min(PER_FACE_SEED_M, 8));
  })();
  const PER_FACE_MAX_SEQ_USE = (Number.isFinite(TIME_BUDGET_MS) && TIME_BUDGET_MS < Infinity)
    ? Math.max(6, Math.min(PER_FACE_MAX_SEQ, Math.max(12, requestedTopK * 2)))
    : PER_FACE_MAX_SEQ;
  const PER_FACE_UNIQUE_CAP = Math.max(40, Math.min(200, requestedTopK * 8));

  const PER_FACE_FIXED_SIDE = (() => {
    const s = String(payload?.perFaceFixedSide ?? 'bottom');
    if (s === 'top' || s === 'inward' || s === 'bottom') return s;
    return 'bottom';
  })();

  const PER_FACE_IN_RATIO_TRY = (() => {
    const v = toNum(payload?.perFaceInRatioTry);
    if (!(Number.isFinite(v) && v > 0 && v < 1)) return null;
    // try 必须小于主阈值才有意义
    return (v + 1e-12 < PER_FACE_IN_RATIO_MIN) ? v : null;
  })();

  perFaceDebug.enabled = PER_FACE_ENABLE;
  perFaceDebug.fixedSide = PER_FACE_FIXED_SIDE;
  perFaceDebug.deltaSetCount = PER_FACE_DELTA_SET.length;
  perFaceDebug.inRatioMin = PER_FACE_IN_RATIO_MIN;
  perFaceDebug.inRatioTry = PER_FACE_IN_RATIO_TRY;
  const layoutStartFrom = (() => {
    // 默认用 best：会明显减少“某一侧空余条带”的情况（覆盖率优先）。
    const s = String(payload?.layoutStartFrom ?? 'best');
    if (s === 'min' || s === 'max' || s === 'best') return s;
    return 'best';
  })();

  const buildCandidateForFixedN = ({ innerPoly, innerArea, omegaLoops, wbUsed, wsNonNeg, N, B, thetaDeg = 0, innerPolyTheta, thetaRad = 0, thetaPivot }) => {
    const thetaKey = Number(thetaDeg);
    const thetaStr = Number.isFinite(thetaKey) ? thetaKey.toFixed(1) : '0.0';

    const omegaForLayout = innerPolyTheta || innerPoly;

    // 1) 先走严格包含（更快）；失败再走“裁剪占比”放宽可行性。
    let built = buildDesignRectsForN({
      omegaPoly: omegaForLayout,
      axis: internalAxis,
      N,
      B,
      Ws: wsNonNeg,
      Lmax: faceAdvanceMax,
      includeClipped: false,
      bumpFail,
      debugRef: stripDebug,
      fast: fastMode,
      startFrom: (internalAxis === 'x') ? layoutStartFrom : layoutStartFrom,
      coordSpace: 'local',
    });

    let actualN = Math.max(0, Math.round(Number(built?.faceCount) || 0));
    let rectLoopsLocal = Array.isArray(built?.rectLoopsLocal) ? built.rectLoopsLocal : [];
    let rectAreaTotal = Number(built?.rectAreaTotal);
    let faceAreaTotal = Number(built?.rectAreaTotal);
    let minInRatio = 1;
    let inRatioMinUsed = IN_RATIO_MIN;

    const strictOk = built && actualN === N && rectLoopsLocal.length === N && Number.isFinite(rectAreaTotal) && rectAreaTotal > 1e-6;
    const builtViaStrict = Boolean(strictOk);
    if (!strictOk) {
      const tryList = (() => {
        if (!AUTO_RELAX_INRATIO) return [IN_RATIO_MIN];
        const base = Number(IN_RATIO_MIN);
        const floor = Number(relaxFloorEffective);
        // 注意：floor 可能是 0.35/0.45 等非整十值，必须显式加入尝试列表，否则会出现“floor 已下探但实际从未尝试到 floor”导致继续无解。
        const seq = [
          base,
          Math.min(base, 0.6),
          Math.min(base, 0.5),
          Math.min(base, 0.45),
          Math.min(base, 0.4),
          Math.min(base, 0.35),
          Math.min(base, 0.3),
          floor,
        ];
        return uniqNums(seq, 1e-9)
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x) && x >= floor - 1e-12)
          .sort((a, b) => b - a);
      })();

      let picked = null;
      let pickedThr = null;
      for (const thr of tryList) {
        if (timeExceeded()) break;
        const r = buildDesignRectsForNRelaxedClipped({
          omegaPoly: omegaForLayout,
          axis: internalAxis,
          N,
          B,
          Ws: wsNonNeg,
          Lmax: faceAdvanceMax,
          inRatioMin: thr,
          fast: fastMode,
          startFrom: (internalAxis === 'x') ? layoutStartFrom : layoutStartFrom,
          bumpFail,
          perFaceShift: Boolean(payload?.relaxedAllowPerFaceShift ?? payload?.perFaceTrapezoid ?? true),
        });
        const ok = r && Number(r?.faceCount) === N && Array.isArray(r?.rectLoopsLocal) && r.rectLoopsLocal.length === N && Number(r?.rectAreaTotal) > 1e-6;
        if (!ok) continue;
        picked = r;
        pickedThr = thr;
        break;
      }

      built = picked;
      actualN = Math.max(0, Math.round(Number(built?.faceCount) || 0));
      rectLoopsLocal = Array.isArray(built?.rectLoopsLocal) ? built.rectLoopsLocal : [];
      rectAreaTotal = Number(built?.rectAreaTotal);
      faceAreaTotal = Number(built?.faceAreaTotal);
      minInRatio = Number(built?.minInRatio);

      // 记录“实际使用阈值”（若 auto-relax 触发）
      if (Number.isFinite(pickedThr)) inRatioMinUsed = Number(pickedThr);
    }

    if (!built || actualN < 1) return null;
    if (actualN !== N) {
      bumpFail('FACECOUNT_NEQ_TARGET');
      return null;
    }
    if (!rectLoopsLocal.length) return null;
    if (!(Number.isFinite(rectAreaTotal) && rectAreaTotal > 1e-6)) {
      bumpFail('FACE_UNION_EMPTY');
      return null;
    }
    if (!(Number.isFinite(faceAreaTotal) && faceAreaTotal > 1e-9)) {
      bumpFail('FACE_INTER_EMPTY');
      return null;
    }

    // 生成阶段剪枝：低于 floor 的直接丢弃（避免生成大量明显劣质候选）。
    if (Number.isFinite(Number(minInRatio)) && Number(minInRatio) + 1e-12 < softFloorEffective) {
      bumpFail('SOFT_INRATIO_BELOW_FLOOR');
      return null;
    }

    // coverageRatio：按 Ω_enum（innerArea）计
    const denom = (Number.isFinite(innerArea) && innerArea > 1e-9) ? innerArea : 0;
    const coverageRatio = denom > 1e-12 ? (faceAreaTotal / denom) : 0;
    if (!(Number.isFinite(coverageRatio) && coverageRatio >= 0)) {
      bumpFail('RATIO_INVALID');
      return null;
    }

    const lengths = Array.isArray(built?.lengths) ? built.lengths : [];
    const sumL = lengths.reduce((s, x) => s + (Number.isFinite(Number(x)) ? Number(x) : 0), 0);
    const minL = lengths.length ? Math.min(...lengths) : 0;
    const maxL = lengths.length ? Math.max(...lengths) : 0;
    const meanL = lengths.length ? sumL / lengths.length : 0;
    const stdL = lengths.length
      ? Math.sqrt(lengths.reduce((s, x) => {
        const v = Number(x);
        if (!Number.isFinite(v)) return s;
        const d = v - meanL;
        return s + d * d;
      }, 0) / lengths.length)
      : 0;
    const lenCV = meanL > 1e-9 ? stdL / meanL : 0;

    // === 验收口径（recovery）：硬约束 r_i >= r_min（按 minInRatio 代表）===
    // strict 解 minInRatio 可能为 null，视作 1。
    const minInRatioHard = Number.isFinite(Number(minInRatio)) ? Number(minInRatio) : 1;
    const rminOk = minInRatioHard + 1e-12 >= IN_RATIO_MIN;
    const qualified = rminOk;
    const efficiencyScore = coverageRatio * 100;
    const signature = `${originalAxis}|wb=${wbUsed.toFixed(4)}|ws=${wsNonNeg.toFixed(4)}|N=${actualN}|B=${Number(B).toFixed(4)}|theta=${thetaStr}`;

    const soft = computeSoftScore({ coverageRatio, minInRatio, lenCV, smoothnessDeg: 0, sumAbsDeltaDeg: 0 });

    const candidate = {
      key: signature,
      signature,
      axis: originalAxis,
      thetaDeg: Number.isFinite(thetaKey) ? thetaKey : 0,
      wbFixedRaw,
      wb: wbUsed,
      ws: wsNonNeg,
      N: actualN,
      B,
      inRatioMin: inRatioMinUsed,
      minInRatio: Number.isFinite(minInRatio) ? minInRatio : null,
      rminOk,
      coverageMin: COVERAGE_MIN,
      qualified,
      lowCoverage: !qualified,
      efficiencyScore,
      softScore: soft.softScore,
      penalties: soft.penalties,
      tonnageTotal: 0,
      recoveryScore: null,
      minL,
      maxL,
      meanL,
      sumL,
      lenCV,
      BMin: Number.isFinite(Number(B)) ? Number(B) : null,
      BMax: Number.isFinite(Number(B)) ? Number(B) : null,
      // v1.0：候选的主指标（便于 UI 直接读取）
      omegaArea: innerArea,
      faceAreaTotal,
      genes: { axis: originalAxis, wb: wbUsed, ws: wsNonNeg, N: actualN, B, Nreq: N, thetaDeg: Number.isFinite(thetaKey) ? thetaKey : 0, inRatioMin: inRatioMinUsed },
      metrics: {
        omegaArea: innerArea,
        faceAreaTotal,
        coverageRatio,
        efficiencyScore,
        softScore: soft.softScore,
        penalties: soft.penalties,
        tonnageTotal: 0,
        recoveryScore: null,
        faceCount: actualN,
        faceCountRequested: N,
        minL,
        maxL,
        meanL,
        sumL,
        lenCV,
        thetaDeg: Number.isFinite(thetaKey) ? thetaKey : 0,
        BMin: Number.isFinite(Number(B)) ? Number(B) : null,
        BMax: Number.isFinite(Number(B)) ? Number(B) : null,
        minFaceInRatio: Number.isFinite(minInRatio) ? minInRatio : null,
        rminOk,
      },
      innerArea,
      coveredArea: faceAreaTotal,
      coverageRatio,
      efficiencyScore,
      omegaRender: {
        loops: omegaLoops,
      },
      render: {
        // 性能标记：若该候选由严格包含（rect ⊆ omegaSafe）生成，则对展示Ω做裁剪时无需做昂贵 intersection，裁剪结果等于原矩形。
        // 注意：omegaSafe 是 omega 的轻微收缩子集，因此 rect ⊆ omegaSafe => rect ⊆ omega（展示Ω）。
        strictInsideOmega: builtViaStrict,
        omegaLoops: omegaLoops,
        rectLoops: (() => {
          const pivot = thetaPivot || { x: 0, y: 0 };
          const cx = Number(pivot?.x) || 0;
          const cy = Number(pivot?.y) || 0;
          const unrot = (Number.isFinite(thetaRad) && Math.abs(thetaRad) > 1e-12)
            ? rectLoopsLocal.map((loop) => rotateLoopAround(loop ?? [], +thetaRad, cx, cy))
            : rectLoopsLocal;
          const worldInternal = unrot.map((loop) => (loop ?? []).map((p) => ({ x: Number(p?.x) + offset.dx, y: Number(p?.y) + offset.dy })));
          const world = swapXY ? swapXYLoops(worldInternal) : worldInternal;
          return world;
        })(),
        clippedLoops: swapXY
          ? swapXYLoops((Array.isArray(built?.clippedLoopsLocal) ? built.clippedLoopsLocal : [])
            .map((loop) => (loop ?? []).map((p) => ({ x: Number(p?.x) + offset.dx, y: Number(p?.y) + offset.dy }))))
          : (Array.isArray(built?.clippedLoopsLocal) ? built.clippedLoopsLocal : [])
            .map((loop) => (loop ?? []).map((p) => ({ x: Number(p?.x) + offset.dx, y: Number(p?.y) + offset.dy }))),
      },
    };

    try {
      const facesLoopsWorld = candidate.render.rectLoops.map((loop, idx) => ({ faceIndex: idx + 1, loop }));
      candidate.render.facesLoops = facesLoopsWorld;
      candidate.facesLoops = facesLoopsWorld;
      candidate.render.plannedWorkfaceLoopsWorld = facesLoopsWorld;
    } catch {
      // ignore
    }

    return candidate;
  };

  const buildCandidateForFixedNPerFaceDelta = ({
    innerPoly,
    innerPolyRotated,
    innerArea,
    omegaLoops,
    wbUsed,
    wsNonNeg,
    N,
    B,
    BList,
    deltaDegList,
    inRatioMinOverride,
    thetaDeg = 0,
    thetaRad = 0,
    thetaPivot,
    baseLayout,
  }) => {
    const n = Math.max(0, Math.round(Number(N) || 0));
    const ds = Array.isArray(deltaDegList) ? deltaDegList.map((x) => Number(x)) : [];
    if (!(n >= 1 && ds.length === n && ds.every(Number.isFinite))) return null;

    const bListUse = (Array.isArray(BList) && BList.length === n)
      ? BList.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
      : null;
    const bVarOk = Array.isArray(BList) && BList.length === n && Array.isArray(bListUse) && bListUse.length === n;
    const bMean = bVarOk
      ? (bListUse.reduce((s, x) => s + (Number.isFinite(x) ? Number(x) : 0), 0) / n)
      : Number(B);
    if (!(Number.isFinite(bMean) && bMean > 0)) return null;

    if (ds.some((d) => d < PER_FACE_DELTA_MIN - 1e-9 || d > PER_FACE_DELTA_MAX_ABS + 1e-9)) {
      bumpFail('PERFACE_DELTA_OUT_OF_RANGE');
      perFaceDebug.lastReason = 'DELTA_OUT_OF_RANGE';
      return null;
    }

    const thetaKey = Number(thetaDeg);
    const thetaStr = Number.isFinite(thetaKey) ? thetaKey.toFixed(1) : '0.0';

    const omegaBase = innerPolyRotated || innerPoly;
    const omegaSafe0 = fixPolygonSafe(omegaBase);
    if (!omegaSafe0 || omegaSafe0.isEmpty?.() || !(Number(omegaSafe0.getArea?.()) > 1e-6)) return null;

    const pivot = (() => {
      if (thetaPivot && Number.isFinite(Number(thetaPivot?.x)) && Number.isFinite(Number(thetaPivot?.y))) return { x: Number(thetaPivot.x), y: Number(thetaPivot.y) };
      try {
        const e = omegaSafe0.getEnvelopeInternal();
        return { x: (Number(e.getMinX?.()) + Number(e.getMaxX?.())) / 2, y: (Number(e.getMinY?.()) + Number(e.getMaxY?.())) / 2 };
      } catch {
        return { x: 0, y: 0 };
      }
    })();

    const omegaSafe = (innerPolyRotated)
      ? omegaSafe0
      : ((Number.isFinite(thetaRad) && Math.abs(thetaRad) > 1e-12)
        ? (fixPolygonSafe(rotateGeomAround(omegaSafe0, -thetaRad, pivot.x, pivot.y)) || omegaSafe0)
        : omegaSafe0);

    let omegaEnv = null;
    try {
      omegaEnv = omegaSafe.getEnvelopeInternal();
    } catch {
      omegaEnv = null;
    }

    // 先生成 baseRect 条带骨架（严格/裁剪均可）
    // 性能：允许外部传入 baseLayout 以复用（per-face 枚举时避免每个 delta 重算）
    let built = baseLayout || (() => {
      return buildDesignRectsForN({
        omegaPoly: omegaSafe,
        axis: internalAxis,
        N: n,
        B: bVarOk ? bListUse : B,
        Ws: wsNonNeg,
        Lmax: faceAdvanceMax,
        includeClipped: false,
        bumpFail,
        debugRef: stripDebug,
        fast: false,
        startFrom: (internalAxis === 'x') ? layoutStartFrom : layoutStartFrom,
        coordSpace: 'local',
      });
    })();

    let actualN = Math.max(0, Math.round(Number(built?.faceCount) || 0));
    let rectLoopsLocal = Array.isArray(built?.rectLoopsLocal) ? built.rectLoopsLocal : [];
    let rectAreaTotal = Number(built?.rectAreaTotal);
    const strictOk = built && actualN === n && rectLoopsLocal.length === n && Number.isFinite(rectAreaTotal) && rectAreaTotal > 1e-6;
    if (!strictOk && !baseLayout) {
      built = buildDesignRectsForNRelaxedClipped({
        omegaPoly: omegaSafe,
        axis: internalAxis,
        N: n,
        B: bVarOk ? bListUse : B,
        Ws: wsNonNeg,
        Lmax: faceAdvanceMax,
        inRatioMin: IN_RATIO_MIN,
        fast: false,
        startFrom: (internalAxis === 'x') ? layoutStartFrom : layoutStartFrom,
        bumpFail,
        perFaceShift: true,
      });
      actualN = Math.max(0, Math.round(Number(built?.faceCount) || 0));
      rectLoopsLocal = Array.isArray(built?.rectLoopsLocal) ? built.rectLoopsLocal : [];
      rectAreaTotal = Number(built?.rectAreaTotal);
    }

    if (!built || actualN !== n || rectLoopsLocal.length !== n) {
      bumpFail('PERFACE_BASE_LAYOUT_FAIL');
      perFaceDebug.lastReason = 'BASE_LAYOUT_FAIL';
      return null;
    }

    const faceLoopsLocalFinal = [];
    const faceClippedLoopsLocal = [];
    const faceInRatios = [];
    const faceAreasRaw = [];
    const faceAreasEff = [];
    const faceClippedGeoms = [];
    const lengthsPerFace = [];
    let faceAreaTotal = 0;

    const inRatioMinUse = (Number.isFinite(Number(inRatioMinOverride)) && Number(inRatioMinOverride) > 0 && Number(inRatioMinOverride) < 1)
      ? Number(inRatioMinOverride)
      : PER_FACE_IN_RATIO_MIN;

    const faceNearAnglesDeg = [];
    const faceFarAnglesDeg = [];

    // per-face 长度增长：只在 per-face 模式下启用；目标是“面积最大化且尽量不越界”。
    // 说明：baseRect 是严格矩形可行域的保守解；在Ω边界斜切/凹凸时，梯形允许在不越界前提下更长。
    const GROW_ENABLE = Boolean(payload?.perFaceGrowLength ?? true);
    const GROW_INSIDE_THR = 0.999; // 视为不越界
    const GROW_MAX_FACTOR = clamp(Number(toNum(payload?.perFaceGrowMaxFactor) ?? 1.8), 1.0, 3.0);
    const GROW_TRIES = [1.0, 1.1, 1.25, 1.4, 1.6, GROW_MAX_FACTOR].map((x) => Number(x)).filter(Number.isFinite);
    const evalQuad = (quad) => {
      const facePoly0 = buildJstsPolygonFromLoop(quad);
      if (!facePoly0 || facePoly0.isEmpty?.()) return null;
      let faceSafe = facePoly0;
      try {
        const valid = (typeof faceSafe.isValid === 'function') ? Boolean(faceSafe.isValid()) : true;
        if (!valid) faceSafe = ensureValid(faceSafe, 'perFaceQuadGrow', stripDebug);
      } catch {
        // ignore
      }
      const faceArea = Number(faceSafe?.getArea?.());
      if (!(Number.isFinite(faceArea) && faceArea > 1e-9)) return null;
      let clipped = null;
      try {
        clipped = robustIntersection(omegaSafe, faceSafe);
      } catch {
        clipped = null;
      }
      const clippedArea = Number(clipped?.getArea?.());
      const ca = (Number.isFinite(clippedArea) && clippedArea >= 0) ? clippedArea : 0;
      const ratio = ca > 0 ? (ca / faceArea) : 0;
      return { faceSafe, faceArea, clipped, clippedArea: ca, ratio };
    };
    let cumAngleDeg = 0;
    for (let i = 0; i < n; i++) {
      const rectLoop = rectLoopsLocal[i];
      const nearA = cumAngleDeg;
      const farA = cumAngleDeg + ds[i];
      faceNearAnglesDeg.push(nearA);
      faceFarAnglesDeg.push(farA);
      cumAngleDeg = farA;

      // base quad
      const quad0 = buildSkewQuadFromRectLoop({ rectLoop, nearAngleDeg: nearA, farAngleDeg: farA });
      if (!quad0) {
        bumpFail('PERFACE_QUAD_BUILD_FAIL');
        perFaceDebug.lastReason = 'QUAD_BUILD_FAIL';
        return null;
      }

      // 可选：尝试把长度增长（围绕 baseRect 中线对称扩展）
      let quad = quad0;
      let bestEval = evalQuad(quad0);
      if (!bestEval) {
        bumpFail('PERFACE_FACE_POLY_NULL');
        perFaceDebug.lastReason = 'FACE_POLY_NULL';
        return null;
      }

      // 以 baseRect 的 bbox 推导长度
      const bb0 = bboxOfLoop(Array.isArray(rectLoop) ? rectLoop : []);
      const L0 = bb0 ? (bb0.maxX - bb0.minX) : 0;
      let chosenL = Number.isFinite(L0) ? Math.max(0, L0) : 0;

      if (GROW_ENABLE && bb0 && Number.isFinite(L0) && L0 > 1e-6) {
        // 通过“目标长度 L”构造 quad：复用 buildSkewQuadFromRectLoop 的几何口径，只改 bbox 的宽度。
        // 这里用一个临时 rectLoop 来提供新的 bbox。
        const midX = (bb0.minX + bb0.maxX) / 2;
        const y0 = bb0.minY;
        const y1 = bb0.maxY;
        const maxLByEnv = (() => {
          if (!omegaEnv) return L0 * GROW_MAX_FACTOR;
          const spanX = Number(omegaEnv.getMaxX?.()) - Number(omegaEnv.getMinX?.());
          if (!(Number.isFinite(spanX) && spanX > 1e-6)) return L0 * GROW_MAX_FACTOR;
          return Math.min(spanX * 0.98, L0 * GROW_MAX_FACTOR);
        })();
        const LcapLocal = (Number.isFinite(Number(faceAdvanceMax)) && Number(faceAdvanceMax) > 0)
          ? Math.min(Number(faceAdvanceMax), maxLByEnv)
          : maxLByEnv;

        // 视觉“铺满”口径：在满足每面有效占比下限的前提下，优先最大化 Ω 内有效面积（clippedArea）。
        // 注意：最终硬约束仍由 rminOk(>=PER_FACE_IN_RATIO_MIN) + overlapOk 控制；这里用 inRatioMinUse 作为 grow 的最低门槛。
        const growRatioMin = Math.max(softFloorEffective, inRatioMinUse);
        let best = { L: chosenL, eval: bestEval };
        // 先粗试多个倍率
        for (const f of GROW_TRIES) {
          const Ltry = clamp(L0 * f, 1e-6, LcapLocal);
          if (!(Ltry > best.L + 1e-6)) continue;
          const tmp = rectToLoop(midX - Ltry / 2, y0, midX + Ltry / 2, y1);
          const quadTry = tmp ? buildSkewQuadFromRectLoop({ rectLoop: tmp, nearAngleDeg: nearA, farAngleDeg: farA }) : null;
          if (!quadTry) continue;
          const ev = evalQuad(quadTry);
          if (!ev) continue;
          // 必须满足有效占比下限
          if (ev.ratio + 1e-12 < growRatioMin) continue;
          // 主目标：有效面积最大；tie：ratio 更大；再 tie：更短（更稳定）
          const bestArea = Number(best.eval?.clippedArea ?? 0);
          const evArea = Number(ev.clippedArea ?? 0);
          if (evArea > bestArea + 1e-6) {
            best = { L: Ltry, eval: ev };
          } else if (Math.abs(evArea - bestArea) <= 1e-6) {
            const br = Number(best.eval?.ratio ?? 0);
            if (ev.ratio > br + 1e-9) best = { L: Ltry, eval: ev };
          }
        }

        // 再做一次二分细化：在“最佳长度附近”尝试更长一点
        if (best.L >= chosenL + 1e-6) {
          let lo = best.L;
          let hi = Math.min(LcapLocal, best.L * 1.15);
          for (let it = 0; it < 6; it++) {
            const mid = (lo + hi) / 2;
            const tmp = rectToLoop(midX - mid / 2, y0, midX + mid / 2, y1);
            const quadTry = tmp ? buildSkewQuadFromRectLoop({ rectLoop: tmp, nearAngleDeg: nearA, farAngleDeg: farA }) : null;
            const ev = quadTry ? evalQuad(quadTry) : null;
            if (!ev || ev.ratio + 1e-12 < growRatioMin) {
              hi = mid;
              continue;
            }
            // 在可行域内尽量向更长推进（因为 clippedArea 对 L 基本单调非减），并用 clippedArea 兜底判断
            const bestArea = Number(best.eval?.clippedArea ?? 0);
            const evArea = Number(ev.clippedArea ?? 0);
            if (evArea > bestArea + 1e-6) {
              best = { L: mid, eval: ev };
              lo = mid;
            } else {
              // 没有明显提升就收缩区间，避免无意义的几何运算
              hi = mid;
            }
          }
        }

        chosenL = best.L;
        bestEval = best.eval;
        quad = polygonToLoopSafe(bestEval.faceSafe) || quad0;
      }

      const faceSafe = bestEval.faceSafe;
      const faceArea = Number(bestEval.faceArea);

      // envelope 预判：若 bbox 不相交，直接判 0（避免昂贵 intersection）
      if (omegaEnv) {
        try {
          const fe = faceSafe.getEnvelopeInternal();
          if (fe && typeof omegaEnv.intersects === 'function' && !omegaEnv.intersects(fe)) {
            bumpFail('PERFACE_DISJOINT');
            perFaceDebug.lastReason = 'DISJOINT';
            return null;
          }
        } catch {
          // ignore
        }
      }

      const clipped = bestEval.clipped;
      const clippedArea = Number(bestEval.clippedArea);
      const inRatio = Number(bestEval.ratio);
      if (!(Number.isFinite(inRatio) && inRatio >= 0)) {
        bumpFail('PERFACE_INRATIO_INVALID');
        perFaceDebug.lastReason = 'INRATIO_INVALID';
        return null;
      }
      // 2 不允许：允许低于 inRatioMinUse 但要 >= floor；低于 floor 直接拒绝。
      if (inRatio + 1e-12 < softFloorEffective) {
        bumpFail('PERFACE_INRATIO_BELOW_FLOOR');
        perFaceDebug.lastReason = 'INRATIO_BELOW_FLOOR';
        return null;
      }
      // 性能/质量：仍保留一个“软门槛”提前剪枝（但不作为最终硬约束），避免生成大量明显很差的候选
      if (inRatio + 1e-12 < Math.min(inRatioMinUse, SOFT_INRATIO_TARGET)) {
        // 不直接返回 null（避免无解），但标记为低质量：通过 penalties 强罚分自然下沉。
      }

      faceLoopsLocalFinal.push(quad);
      faceInRatios.push(inRatio);
      faceAreasRaw.push(faceArea);
      faceAreasEff.push(Number.isFinite(clippedArea) ? Math.max(0, clippedArea) : 0);
      faceClippedGeoms.push(clipped || null);
      lengthsPerFace.push(Number.isFinite(chosenL) ? chosenL : 0);
      if (Number.isFinite(clippedArea) && clippedArea > 1e-9) {
        faceAreaTotal += clippedArea;
        if (INCLUDE_CLIPPED_LOOPS) {
          const loops = polygonToLoops(clipped);
          for (const l of loops) faceClippedLoopsLocal.push(l);
        }
      }
    }

    if (!(Number.isFinite(faceAreaTotal) && faceAreaTotal > 1e-9)) {
      bumpFail('PERFACE_FACEAREA_EMPTY');
      perFaceDebug.lastReason = 'FACEAREA_EMPTY';
      return null;
    }

    // === Hard constraint: Ω 内裁剪后不相交 ===
    // 口径 A：只对裁剪后几何 F_i' = (F_i ∩ Ω) 检查相交。
    // 数值容差：允许极小相交面积（贴边/共线误差），超过则判为不合格。
    const overlapTolAbs = 1e-6;
    const overlapTolRel = (Number.isFinite(innerArea) && innerArea > 0) ? innerArea * 1e-12 : 0;
    const overlapTol = Math.max(overlapTolAbs, overlapTolRel);

    let overlapPairs = 0;
    let overlapAreaTotal = 0;
    let maxOverlapArea = 0;
    try {
      for (let i = 0; i < n; i++) {
        const gi = faceClippedGeoms[i];
        if (!gi || gi.isEmpty?.()) continue;
        for (let j = i + 1; j < n; j++) {
          const gj = faceClippedGeoms[j];
          if (!gj || gj.isEmpty?.()) continue;
          const inter = robustIntersection(gi, gj);
          const a = Number(inter?.getArea?.());
          const ia = (Number.isFinite(a) && a >= 0) ? a : 0;
          if (ia > overlapTol) overlapPairs += 1;
          overlapAreaTotal += ia;
          if (ia > maxOverlapArea) maxOverlapArea = ia;
        }
      }
    } catch {
      // 保守：相交检测异常不直接淘汰，避免数值/拓扑异常导致全灭；但会降低候选可信度。
      overlapPairs = overlapPairs;
    }
    const overlapOk = overlapPairs === 0;

    const denom = (Number.isFinite(innerArea) && innerArea > 1e-9) ? innerArea : 0;
    const coverageRatio = denom > 1e-12 ? (faceAreaTotal / denom) : 0;
    if (!(Number.isFinite(coverageRatio) && coverageRatio >= 0)) {
      bumpFail('RATIO_INVALID');
      perFaceDebug.lastReason = 'RATIO_INVALID';
      return null;
    }

    const minInRatio = faceInRatios.length ? Math.min(...faceInRatios) : null;
    const lengths = lengthsPerFace.length === n ? lengthsPerFace : (Array.isArray(built?.lengths) ? built.lengths : []);
    const sumL = lengths.reduce((s, x) => s + (Number.isFinite(Number(x)) ? Number(x) : 0), 0);
    const minL = lengths.length ? Math.min(...lengths) : 0;
    const maxL = lengths.length ? Math.max(...lengths) : 0;
    const meanL = lengths.length ? sumL / lengths.length : 0;
    const stdL = lengths.length
      ? Math.sqrt(lengths.reduce((s, x) => {
        const v = Number(x);
        if (!Number.isFinite(v)) return s;
        const d = v - meanL;
        return s + d * d;
      }, 0) / lengths.length)
      : 0;
    const lenCV = meanL > 1e-9 ? stdL / meanL : 0;

    const dKey = ds.map((d) => String(Math.round(d))).join(',');
    const bKey = bVarOk ? bListUse.map((x) => String(Math.round(x))).join(',') : '';
    const signature = bVarOk
      ? `${originalAxis}|wb=${wbUsed.toFixed(4)}|ws=${wsNonNeg.toFixed(4)}|N=${actualN}|B=${Number(bMean).toFixed(4)}|bL=${bKey}|fs=${PER_FACE_FIXED_SIDE}|theta=${thetaStr}|dlt=${dKey}`
      : `${originalAxis}|wb=${wbUsed.toFixed(4)}|ws=${wsNonNeg.toFixed(4)}|N=${actualN}|B=${Number(B).toFixed(4)}|fs=${PER_FACE_FIXED_SIDE}|theta=${thetaStr}|dlt=${dKey}`;

    const { maxAbsDeltaDeg, sumAbsDeltaDeg, smoothnessDeg, deltaStdDeg } = deltaStatsDeg(ds);

    const firstFaceDeltaDeg = Number.isFinite(Number(ds?.[0])) ? Number(ds[0]) : 0;
    const absFirstFaceDeltaDeg = Math.abs(firstFaceDeltaDeg);
    const firstFaceInRatio = Number.isFinite(Number(faceInRatios?.[0])) ? Number(faceInRatios[0]) : null;

    const soft = computeSoftScore({ coverageRatio, minInRatio, lenCV, smoothnessDeg, sumAbsDeltaDeg });

    // === 验收口径（recovery）：硬约束 r_i >= r_min（按 minInRatio 代表）===
    // r_min 默认取 PER_FACE_IN_RATIO_MIN（0.70），可被 inRatioMinOverride 临时下探用于兜底生成，但不应计入 qualified。
    const rMinHard = PER_FACE_IN_RATIO_MIN;
    const minInRatioHard = Number.isFinite(Number(minInRatio)) ? Number(minInRatio) : 0;
    const rminOk = minInRatioHard + 1e-12 >= rMinHard;
    const bStatsList = (bVarOk && Array.isArray(bListUse) && bListUse.length) ? bListUse : [Number(bMean)];
    const BMin = bStatsList.length ? Math.min(...bStatsList.map((x) => Number(x)).filter((x) => Number.isFinite(x))) : null;
    const BMax = bStatsList.length ? Math.max(...bStatsList.map((x) => Number(x)).filter((x) => Number.isFinite(x))) : null;

    // 异常工作面：裁剪后形状非矩形
    const abnormalFaces = [];
    try {
      for (let i = 0; i < n; i++) {
        const gi = faceClippedGeoms[i];
        const isRect = isAxisAlignedRectanglePolygon(gi);
        if (!isRect) {
          const area = Number(gi?.getArea?.());
          const env = gi?.getEnvelopeInternal?.();
          const box = envToBox(env);
          abnormalFaces.push({
            faceIndex: i + 1,
            reason: 'CLIPPED_NOT_RECT',
            B: bVarOk ? (Number.isFinite(Number(bListUse?.[i])) ? Number(bListUse[i]) : null) : (Number.isFinite(Number(bMean)) ? Number(bMean) : null),
            L: Number.isFinite(Number(lengths?.[i])) ? Number(lengths[i]) : null,
            inRatio: Number.isFinite(Number(faceInRatios?.[i])) ? Number(faceInRatios[i]) : null,
            clippedArea: Number.isFinite(area) ? area : null,
            bbox: box,
          });
        }
      }
    } catch {
      // ignore
    }
    const abnormalFaceCount = abnormalFaces.length;
    const candidate = {
      key: signature,
      signature,
      axis: originalAxis,
      thetaDeg: Number.isFinite(thetaKey) ? thetaKey : 0,
      deltaDegList: ds.slice(),
      nearAngleDegList: faceNearAnglesDeg.slice(),
      farAngleDegList: faceFarAnglesDeg.slice(),
      wbFixedRaw,
      wb: wbUsed,
      ws: wsNonNeg,
      N: actualN,
      B: Number(bMean),
      BList: bVarOk ? bListUse.slice() : null,
      inRatioMin: PER_FACE_IN_RATIO_MIN,
      minInRatio: Number.isFinite(minInRatio) ? minInRatio : null,
      coverageMin: COVERAGE_MIN,
      overlapOk,
      overlapPairs,
      overlapAreaTotal: Number.isFinite(overlapAreaTotal) ? overlapAreaTotal : null,
      maxOverlapArea: Number.isFinite(maxOverlapArea) ? maxOverlapArea : null,
      rminOk,
      qualified: overlapOk && rminOk,
      abnormalFaceCount,
      abnormalFaces,
      lowCoverage: !(coverageRatio >= COVERAGE_MIN),
      efficiencyScore: coverageRatio * 100,
      softScore: soft.softScore,
      penalties: soft.penalties,
      tonnageTotal: 0,
      recoveryScore: null,
      minL,
      maxL,
      meanL,
      sumL,
      lenCV,
      BMin: Number.isFinite(Number(BMin)) ? Number(BMin) : null,
      BMax: Number.isFinite(Number(BMax)) ? Number(BMax) : null,
      omegaArea: innerArea,
      faceAreaTotal,
      maxAbsDeltaDeg,
      sumAbsDeltaDeg,
      smoothnessDeg,
      deltaStdDeg,
      firstFaceDeltaDeg,
      absFirstFaceDeltaDeg,
      firstFaceInRatio,
      genes: {
        axis: originalAxis,
        wb: wbUsed,
        ws: wsNonNeg,
        N: actualN,
        B: Number(bMean),
        BList: bVarOk ? bListUse.slice() : null,
        Nreq: n,
        thetaDeg: Number.isFinite(thetaKey) ? thetaKey : 0,
        deltaDegList: ds.slice(),
      },
      metrics: {
        omegaArea: innerArea,
        faceAreaTotal,
        coverageRatio,
        efficiencyScore: coverageRatio * 100,
        softScore: soft.softScore,
        penalties: soft.penalties,
        tonnageTotal: 0,
        recoveryScore: null,
        faceCount: actualN,
        faceCountRequested: n,
        minL,
        maxL,
        meanL,
        sumL,
        lenCV,
        thetaDeg: Number.isFinite(thetaKey) ? thetaKey : 0,
        B: Number(bMean),
        BList: bVarOk ? bListUse.slice() : null,
        BMin: Number.isFinite(Number(BMin)) ? Number(BMin) : null,
        BMax: Number.isFinite(Number(BMax)) ? Number(BMax) : null,
        abnormalFaceCount,
        abnormalFaces,
        deltaDegList: ds.slice(),
        nearAngleDegList: faceNearAnglesDeg.slice(),
        farAngleDegList: faceFarAnglesDeg.slice(),
        maxAbsDeltaDeg,
        sumAbsDeltaDeg,
        smoothnessDeg,
        deltaStdDeg,
        firstFaceDeltaDeg,
        absFirstFaceDeltaDeg,
        firstFaceInRatio,
        minFaceInRatio: Number.isFinite(minInRatio) ? minInRatio : null,
        overlapOk,
        overlapPairs,
        overlapAreaTotal: Number.isFinite(overlapAreaTotal) ? overlapAreaTotal : null,
        maxOverlapArea: Number.isFinite(maxOverlapArea) ? maxOverlapArea : null,
        rminOk,
      },
      innerArea,
      coveredArea: faceAreaTotal,
      coverageRatio,
      omegaRender: { loops: omegaLoops },
      render: {
        omegaLoops,
        rectLoops: (() => {
          const unrot = (Number.isFinite(thetaRad) && Math.abs(thetaRad) > 1e-12)
            ? faceLoopsLocalFinal.map((loop) => rotateLoopAround(loop ?? [], +thetaRad, pivot.x, pivot.y))
            : faceLoopsLocalFinal;
          const worldInternal = unrot.map((loop) => (loop ?? []).map((p) => ({ x: Number(p?.x) + offset.dx, y: Number(p?.y) + offset.dy })));
          const world = swapXY ? swapXYLoops(worldInternal) : worldInternal;
          return world;
        })(),
        clippedLoops: (() => {
          if (!INCLUDE_CLIPPED_LOOPS) return [];
          const unrot = (Number.isFinite(thetaRad) && Math.abs(thetaRad) > 1e-12)
            ? faceClippedLoopsLocal.map((loop) => rotateLoopAround(loop ?? [], +thetaRad, pivot.x, pivot.y))
            : faceClippedLoopsLocal;
          const worldInternal = unrot.map((loop) => (loop ?? []).map((p) => ({ x: Number(p?.x) + offset.dx, y: Number(p?.y) + offset.dy })));
          const world = swapXY ? swapXYLoops(worldInternal) : worldInternal;
          return world;
        })(),
        clippedFacesLoops: [],
        faceInRatios: faceInRatios.slice(),
        faceAreaRawList: faceAreasRaw.slice(),
        faceAreaEffList: faceAreasEff.slice(),
        faceNearAnglesDeg: faceNearAnglesDeg.slice(),
        faceFarAnglesDeg: faceFarAnglesDeg.slice(),
      },
    };

    if (!overlapOk) {
      bumpFail('PERFACE_OVERLAP');
      perFaceDebug.lastReason = 'OVERLAP';
    }

    try {
      const facesLoopsWorld = candidate.render.rectLoops.map((loop, idx) => ({ faceIndex: idx + 1, loop }));
      candidate.render.facesLoops = facesLoopsWorld;
      candidate.facesLoops = facesLoopsWorld;
      candidate.render.plannedWorkfaceLoopsWorld = facesLoopsWorld;
    } catch {
      // ignore
    }

    return candidate;
  };

  const qualifiedCandidates = [];
  const fallbackCandidates = [];
  const allCandByKey = new Map();

  const innerCtxByWbKey = new Map();

  const pushCandidateUnique = (c) => {
    if (!c) return;
    const k = String(c.signature ?? '');
    if (!k || allCandByKey.has(k)) return;
    allCandByKey.set(k, c);
    if (c.qualified) qualifiedCandidates.push(c);
    else fallbackCandidates.push(c);
  };

  let lastInnerReason = '';
  let lastInnerDebug = null;

  for (const wb of wbSamples) {
    if (timeExceeded()) break;
    const wbUsed = Math.abs(Number(wb) || 0);
    const bufferDistance = -Math.abs(wbUsed);

    let inner = null;
    let innerErr = '';
    try {
      inner = BufferOp.bufferOp(basePolyLocal, bufferDistance);
    } catch (e) {
      inner = null;
      innerErr = String(e?.message ?? e);
    }

    if (innerErr) {
      lastInnerReason = `内缩失败：BufferOp异常: ${innerErr}`;
      lastInnerDebug = { wbUsed, bufferDistance, bufferError: innerErr };
      bumpFail('OMEGA_BUFFER_ERROR');
      continue;
    }

    const innerPoly0 = pickLargestPolygon(inner);
    const innerPoly = fixPolygonSafe(innerPoly0);
    const innerArea = Number(innerPoly?.getArea?.());
    const omegaLoopsLocal = polygonToLoops(innerPoly);
    const omegaLoopsInternal = translateLoops(omegaLoopsLocal, offset.dx, offset.dy);
    const omegaLoops = swapXY ? swapXYLoops(omegaLoopsInternal) : omegaLoopsInternal;

    // 缓存 innerOmega（用于 per-face 二次细化）
    try {
      innerCtxByWbKey.set(String(Number(wbUsed).toFixed(6)), { innerPoly, innerArea, omegaLoops, wbUsed });
    } catch {
      // ignore
    }

    if (!innerPoly || innerPoly.isEmpty?.() || !(Number.isFinite(innerArea) && innerArea > 1e-6) || !omegaLoops.length) {
      lastInnerReason = `内缩后区域为空：wb=${wbUsed} 过大或边界过窄`;
      lastInnerDebug = { wbUsed, bufferDistance, omegaArea: Number.isFinite(innerArea) ? innerArea : null, omegaLoopsCount: omegaLoops.length };
      bumpFail('OMEGA_EMPTY');
      continue;
    }

    const env = innerPoly.getEnvelopeInternal();
    const span = internalAxis === 'x' ? (env.getMaxY() - env.getMinY()) : (env.getMaxX() - env.getMinX());
    if (!(Number.isFinite(span) && span > 1e-6)) continue;

    const wsList = wsSamples.length ? wsSamples : [0];

    // theta 搜索：coarse -> 选 topM -> fine（±2°）
    // 角度锁定时：theta 固定 0，不做搜索（大幅提速）。
    const THETA_MIN = LOCK_ZERO_ANGLES ? 0 : -10;
    const THETA_MAX = LOCK_ZERO_ANGLES ? 0 : +10;
    const THETA_COARSE_STEP = fastMode ? 2 : 2;
    const THETA_FINE_STEP = fastMode ? 0.5 : 0.5;
    const THETA_FINE_HALFWIN = 2;
    const THETA_TOPM = fastMode ? 3 : 5;

    const pivotEnv = innerPoly.getEnvelopeInternal();
    const pivot = {
      x: (Number(pivotEnv.getMinX?.()) + Number(pivotEnv.getMaxX?.())) / 2,
      y: (Number(pivotEnv.getMinY?.()) + Number(pivotEnv.getMaxY?.())) / 2,
    };

    const thetaCoarseList = [];
    for (let t = THETA_MIN; t <= THETA_MAX + 1e-9; t += THETA_COARSE_STEP) thetaCoarseList.push(Math.round(t * 10) / 10);

    // 用几何跨度推导“可放置的最大工作面数”
    const computeNmax = (spanV, B, wsV) => {
      const s = Number(spanV);
      const b = Number(B);
      const w = Math.max(0, Number(wsV) || 0);
      if (!(Number.isFinite(s) && s > 0)) return 0;
      if (!(Number.isFinite(b) && b > 0)) return 0;
      return Math.floor((s + w) / (b + w));
    };

    const BminInt = Math.ceil(Bmin);
    const BmaxInt = Math.floor(Bmax);
    if (!(Number.isFinite(BminInt) && Number.isFinite(BmaxInt) && BmaxInt >= BminInt)) {
      bumpFail('B_RANGE_NO_INT');
      continue;
    }

    // coarse 评估：每个 theta 只求一个 best（用于选 topM theta）
    // 角度锁定：跳过 coarse/fine，直接使用 theta=0。
    const thetaCoarseScores = [];
    if (!LOCK_ZERO_ANGLES) {
      for (const thetaDeg of thetaCoarseList) {
        if (timeExceeded()) break;
        const thetaRad = (Number(thetaDeg) * Math.PI) / 180;
        const innerPolyTheta = rotateGeomAround(innerPoly, -thetaRad, pivot.x, pivot.y) || innerPoly;
        const innerAreaTheta = Number(innerPolyTheta?.getArea?.());
        if (!innerPolyTheta || innerPolyTheta.isEmpty?.() || !(Number.isFinite(innerAreaTheta) && innerAreaTheta > 1e-6)) {
          bumpFail('THETA_OMEGA_EMPTY');
          continue;
        }

        let bestForTheta = null;
        for (const ws of wsList) {
          if (timeExceeded()) break;
          const wsNonNeg = Math.max(0, Number(ws) || 0);
          const NmaxAtBmin = computeNmax(span, BminInt, wsNonNeg);
          if (!(Number.isFinite(NmaxAtBmin) && NmaxAtBmin >= 1)) {
            bumpFail('NMAX_LT_1');
            continue;
          }
          const NcapHard = Boolean(payload?.perFaceTrapezoid) ? 12 : (fastMode ? 10 : 20);
          const Ncap = Math.max(1, Math.min(NcapHard, NmaxAtBmin));

          for (let Nreq = 1; Nreq <= Ncap; Nreq++) {
            if (timeExceeded()) break;
            const bUpperBySpan = (span - (Nreq - 1) * wsNonNeg) / Nreq;
            const Bupper = Math.min(BmaxInt, Math.floor(bUpperBySpan));
            if (!(Number.isFinite(Bupper) && Bupper >= BminInt)) break;

            // coarse theta 只采样少量 B
            const Bmid = Math.round((BminInt + Bupper) / 2);
            const bList = uniqNums([Bupper, Bmid, BminInt], 1e-9).map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x >= BminInt && x <= Bupper);
            for (const B of bList) {
              if (timeExceeded()) break;
              responseBase.attemptSummary.attemptedCombos += 1;
              responseBase.attemptSummary.Bsearch.coarseEvaluatedBCount += 1;
              if ((responseBase.attemptSummary.attemptedCombos % 60) === 0) maybePostProgress('粗搜');
              const c = buildCandidateForFixedN({ innerPoly, innerArea, omegaLoops, wbUsed, wsNonNeg, N: Nreq, B, thetaDeg, innerPolyTheta, thetaRad, thetaPivot: pivot });
              if (!c) continue;
              responseBase.attemptSummary.feasibleCombos += 1;
              if (!bestForTheta || (c.faceAreaTotal ?? 0) > (bestForTheta.faceAreaTotal ?? 0) + 1e-9) bestForTheta = c;
            }
          }
        }

        if (bestForTheta) thetaCoarseScores.push({ thetaDeg, score: Number(bestForTheta.faceAreaTotal ?? 0), best: bestForTheta });
      }
    } else {
      // 提供一个占位，供 fastMode 分支使用
      thetaCoarseScores.push({ thetaDeg: 0, score: 0, best: null });
    }

    thetaCoarseScores.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const topThetaSeeds = LOCK_ZERO_ANGLES ? [0] : thetaCoarseScores.slice(0, Math.max(1, THETA_TOPM)).map((x) => Number(x.thetaDeg));

    // fast 模式：直接返回 top1（预览），不做 fine，也不填 topK 表
    if (fastMode) {
      const bestSeed = thetaCoarseScores[0]?.best;
      if (bestSeed) pushCandidateUnique(bestSeed);
      break;
    }

    // fine：围绕 topM 的 theta 种子做精修
    const thetaFineList = LOCK_ZERO_ANGLES
      ? [0]
      : (() => {
        const thetaFineSet = new Set();
        for (const seed of topThetaSeeds) {
          const lo = Math.max(THETA_MIN, seed - THETA_FINE_HALFWIN);
          const hi = Math.min(THETA_MAX, seed + THETA_FINE_HALFWIN);
          for (let t = lo; t <= hi + 1e-9; t += THETA_FINE_STEP) thetaFineSet.add(String(Math.round(t * 10) / 10));
        }
        return Array.from(thetaFineSet).map((s) => Number(s)).filter(Number.isFinite).sort((a, b) => a - b);
      })();

    for (const thetaDeg of thetaFineList) {
      if (timeExceeded()) break;
      const thetaRad = (Number(thetaDeg) * Math.PI) / 180;
      const innerPolyTheta = rotateGeomAround(innerPoly, -thetaRad, pivot.x, pivot.y) || innerPoly;
      const innerAreaTheta = Number(innerPolyTheta?.getArea?.());
      if (!innerPolyTheta || innerPolyTheta.isEmpty?.() || !(Number.isFinite(innerAreaTheta) && innerAreaTheta > 1e-6)) {
        bumpFail('THETA_OMEGA_EMPTY_FINE');
        continue;
      }

      for (const ws of wsList) {
        if (timeExceeded()) break;
        const wsNonNeg = Math.max(0, Number(ws) || 0);
        const NmaxAtBmin = computeNmax(span, BminInt, wsNonNeg);
        if (!(Number.isFinite(NmaxAtBmin) && NmaxAtBmin >= 1)) {
          bumpFail('NMAX_LT_1');
          continue;
        }
        const NcapHard = Boolean(payload?.perFaceTrapezoid) ? 18 : 40;
        const Ncap = Math.max(1, Math.min(NcapHard, NmaxAtBmin));

        for (let Nreq = 1; Nreq <= Ncap; Nreq++) {
          if (timeExceeded()) break;
          const bUpperBySpan = (span - (Nreq - 1) * wsNonNeg) / Nreq;
          const Bupper = Math.min(BmaxInt, Math.floor(bUpperBySpan));
          if (!(Number.isFinite(Bupper) && Bupper >= BminInt)) {
            bumpFail('BUPPER_LT_BMIN');
            break;
          }

          const coarseBs = genCoarseBs(BminInt, Bupper);
          const coarseCands = [];
          for (const B of coarseBs) {
            if (timeExceeded()) break;
            responseBase.attemptSummary.attemptedCombos += 1;
            responseBase.attemptSummary.Bsearch.coarseEvaluatedBCount += 1;
            if ((responseBase.attemptSummary.attemptedCombos % 40) === 0) maybePostProgress('粗搜');
            const c = buildCandidateForFixedN({ innerPoly, innerArea, omegaLoops, wbUsed, wsNonNeg, N: Nreq, B, thetaDeg, innerPolyTheta, thetaRad, thetaPivot: pivot });
            if (!c) continue;
            responseBase.attemptSummary.feasibleCombos += 1;
            pushCandidateUnique(c);
            coarseCands.push(c);
          }
          if (!coarseCands.length) continue;
          coarseCands.sort(compareWithinSameN);

          const seeds = [];
          const seenB = new Set();
          for (const c of coarseCands) {
            const bKey = String(Math.round(Number(c.B)));
            if (seenB.has(bKey)) continue;
            seenB.add(bKey);
            seeds.push(Math.round(Number(c.B)));
            recordSeedB(c.B);
            if (seeds.length >= B_COARSE_TOPM) break;
          }

          if (DO_FINE) {
            for (const seedB of seeds) {
              if (timeExceeded()) break;
              const fineBs = genFineBs(seedB, BminInt, Bupper);
              for (const B of fineBs) {
                if (timeExceeded()) break;
                if (seenB.has(String(B))) continue;
                responseBase.attemptSummary.attemptedCombos += 1;
                responseBase.attemptSummary.Bsearch.fineEvaluatedBCount += 1;
                if ((responseBase.attemptSummary.attemptedCombos % 40) === 0) maybePostProgress('精修');
                const c = buildCandidateForFixedN({ innerPoly, innerArea, omegaLoops, wbUsed, wsNonNeg, N: Nreq, B, thetaDeg, innerPolyTheta, thetaRad, thetaPivot: pivot });
                if (!c) continue;
                responseBase.attemptSummary.feasibleCombos += 1;
                pushCandidateUnique(c);
              }
            }
          }
        }
      }
    }
  }

  responseBase.attemptSummary.timeBudgetHit = Boolean(timeBudgetHit);

  // === 全局兜底检索：若主流程完全无候选，则下探 floor 并随机采样补齐 ===
  if (GLOBAL_FALLBACK_ENABLE) {
    const curCount = (qualifiedCandidates?.length ?? 0) + (fallbackCandidates?.length ?? 0);
    if (curCount === 0) {
      const failTypes0 = responseBase?.attemptSummary?.failTypes ?? {};
      const likelyBandFail = Boolean((Number(failTypes0.BAND_NO_FEASIBLE_X) || 0) + (Number(failTypes0.BAND_NO_FEASIBLE_Y) || 0) > 0);
      // 仅在“无候选”场景触发；若主要是 band 可行区间失败，则优先启用。
      if (likelyBandFail) {
        globalFallbackUsed = true;
        responseBase.attemptSummary.globalFallbackUsed = true;

        // 即便主时间预算已耗尽，也给兜底一个独立的小预算（否则会出现“兜底检索：未启用”的假象）。
        const fallbackBudgetMs = (() => {
          const base = Number.isFinite(TIME_BUDGET_MS) ? Number(TIME_BUDGET_MS) : 200;
          return clamp(Math.round(Math.max(80, Math.min(260, base * 0.18))), 60, 400);
        })();
        responseBase.attemptSummary.globalFallbackBudgetMs = fallbackBudgetMs;
        const fallbackStartMs = nowMs();
        const fallbackDeadlineMs = fallbackStartMs + fallbackBudgetMs;
        const fallbackTimeExceeded = () => nowMs() > fallbackDeadlineMs;
        const canContinue = () => !fallbackTimeExceeded();
        responseBase.attemptSummary.globalFallbackTried = true;

        const ctxList = Array.from(innerCtxByWbKey.values?.() ?? []).filter((x) => x && x.innerPoly && Number(x.innerArea) > 1e-6);

        // 下探序列：从当前 floor 开始，逐步降到 GLOBAL_FALLBACK_INRATIO_FLOOR（但不超过 target 约束）
        const floorSeq0 = uniqNums([
          softFloorEffective,
          Math.min(softFloorEffective, 0.45),
          Math.min(softFloorEffective, 0.40),
          Math.min(softFloorEffective, 0.35),
          GLOBAL_FALLBACK_INRATIO_FLOOR,
        ], 1e-9)
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x) && x > 0)
          .sort((a, b) => b - a);

        // 伪随机（可复现）：基于 cacheKey
        let seed = 2166136261;
        try {
          const s = String(cacheKey ?? '');
          for (let i = 0; i < s.length; i++) {
            seed ^= s.charCodeAt(i);
            seed = Math.imul(seed, 16777619) >>> 0;
          }
        } catch {
          // ignore
        }
        const rnd = () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed / 4294967296;
        };

        const wsDense = (() => {
          const out = [];
          const a = Math.max(0, Number(wsMin) || 0);
          const b = Math.max(0, Number(wsMax) || 0);
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          if (!(hi > lo + 1e-9)) return [lo];
          const m = 7;
          for (let i = 0; i < m; i++) out.push(lo + (i / (m - 1)) * (hi - lo));
          return uniqNums(out, 1e-9);
        })();

        const BminInt0 = Math.ceil(Bmin);
        const BmaxInt0 = Math.floor(Bmax);
        const thetaChoices = [-10, -6, -3, 0, 3, 6, 10];

        for (const floorV of floorSeq0) {
          if (!canContinue()) break;
          // 下探同时影响 base/per-face 的硬底线与 autoRelax floor
          softFloorEffective = Math.max(GLOBAL_FALLBACK_INRATIO_FLOOR, Math.min(softFloorEffective, floorV));
          relaxFloorEffective = Math.max(GLOBAL_FALLBACK_INRATIO_FLOOR, Math.min(relaxFloorEffective, floorV));

          // 采样预算：每个 floor 最多尝试若干次，找到任意候选就退出
          const maxTries = 80;
          for (let t = 0; t < maxTries; t++) {
            if (!canContinue()) break;
            if ((qualifiedCandidates?.length ?? 0) + (fallbackCandidates?.length ?? 0) >= requestedTopK) break;
            responseBase.attemptSummary.globalFallbackTries = Number(responseBase.attemptSummary.globalFallbackTries || 0) + 1;
            const ctx = ctxList.length ? ctxList[Math.floor(rnd() * ctxList.length)] : null;
            if (!ctx?.innerPoly) continue;

            const wsNonNeg = Math.max(0, Number(wsDense.length ? wsDense[Math.floor(rnd() * wsDense.length)] : wsMin) || 0);
            const Bint = (Number.isFinite(BminInt0) && Number.isFinite(BmaxInt0) && BmaxInt0 >= BminInt0)
              ? Math.round(BminInt0 + rnd() * (BmaxInt0 - BminInt0))
              : Math.max(1, Math.round(Number(Bmin) || 1));
            const B = Math.max(1, Number(Bint));

            // 估计可放 N 上限（与主逻辑一致）
            let span = 0;
            try {
              const env = ctx.innerPoly.getEnvelopeInternal();
              span = internalAxis === 'x' ? (env.getMaxY() - env.getMinY()) : (env.getMaxX() - env.getMinX());
            } catch {
              span = 0;
            }
            const NmaxAtB = (Number.isFinite(span) && span > 0) ? Math.floor((span + wsNonNeg) / (B + wsNonNeg)) : 0;
            if (!(Number.isFinite(NmaxAtB) && NmaxAtB >= 1)) continue;
            const Ncap = Math.max(1, Math.min(Boolean(payload?.perFaceTrapezoid) ? 18 : 40, NmaxAtB));
            const Nreq = Math.max(1, Math.min(Ncap, 1 + Math.floor(rnd() * Math.min(12, Ncap))));

            const thetaDeg = thetaChoices[Math.floor(rnd() * thetaChoices.length)] ?? 0;
            const thetaRad = (Number(thetaDeg) * Math.PI) / 180;
            const pivotEnv = ctx.innerPoly.getEnvelopeInternal();
            const pivot = {
              x: (Number(pivotEnv.getMinX?.()) + Number(pivotEnv.getMaxX?.())) / 2,
              y: (Number(pivotEnv.getMinY?.()) + Number(pivotEnv.getMaxY?.())) / 2,
            };
            const innerPolyTheta = rotateGeomAround(ctx.innerPoly, -thetaRad, pivot.x, pivot.y) || ctx.innerPoly;

            const c = buildCandidateForFixedN({
              innerPoly: ctx.innerPoly,
              innerArea: ctx.innerArea,
              omegaLoops: ctx.omegaLoops,
              wbUsed: Number(ctx.wbUsed) || 0,
              wsNonNeg,
              N: Nreq,
              B,
              thetaDeg,
              innerPolyTheta,
              thetaRad,
              thetaPivot: pivot,
            });
            if (!c) continue;
            responseBase.attemptSummary.feasibleCombos += 1;
            pushCandidateUnique(c);
          }

          if ((qualifiedCandidates?.length ?? 0) + (fallbackCandidates?.length ?? 0) > 0) break;
        }
      }
    }
  }

  const allCandidates0 = qualifiedCandidates.length ? qualifiedCandidates : fallbackCandidates;

  if (!allCandidates0.length) {
    const failTypes = responseBase?.attemptSummary?.failTypes ?? {};
    const topFail = (() => {
      try {
        const entries = Object.entries(failTypes).map(([k, v]) => ({ k, v: Number(v) || 0 })).filter((x) => x.v > 0);
        entries.sort((a, b) => b.v - a.v);
        return entries[0]?.k ? String(entries[0].k) : '';
      } catch {
        return '';
      }
    })();

    const hint = (() => {
      if (topFail === 'SOFT_INRATIO_BELOW_FLOOR' || topFail === 'PERFACE_INRATIO_BELOW_FLOOR') {
        return '（主要原因：条带大部分落在Ω外，被外溢底线拦截；可适当降低“外溢底线/softInRatioFloor”，或放宽面宽/煤柱/区段煤柱范围）';
      }
      if (topFail === 'BAND_NO_FEASIBLE_X' || topFail === 'BAND_NO_FEASIBLE_Y') {
        return `（主要原因：Ω在部分条带带宽内横向不连续/变窄，导致找不到稳定的矩形推进区间；建议优先减小B/增大ws可选范围，或降低 globalFallbackInRatioFloor=${GLOBAL_FALLBACK_INRATIO_FLOOR.toFixed(2)}；兜底检索：${globalFallbackUsed ? '已启用' : '未启用'}）`;
      }
      if (topFail === 'NMAX_LT_1' || topFail === 'B_RANGE_NO_INT' || topFail === 'BUPPER_LT_BMIN') {
        return '（主要原因：几何跨度不足以放置任意条带；建议减小面宽B或区段煤柱ws，或减小边界煤柱wb）';
      }
      if (topFail) return `（主要失败类型：${topFail}）`;
      return '';
    })();

    const reasonBase = lastInnerReason || '可采区已生成，但未找到满足当前参数范围的条带组合（请检查面宽/煤柱/区段煤柱范围）';
    const reason = `${reasonBase}${hint}`;
    responseBase.failedReason = reason;
    return {
      ...responseBase,
      message: reason,
      debug: withPerFaceDebug({
        boundaryNormalized: {
          pointCount: boundaryNorm.pointCount,
          closed: boundaryNorm.closed,
          area: boundaryNorm.area,
          isValid: true,
          fixedBy: baseValidated.fixedBy || '',
        },
        omega: { ...omegaDebug0, ...(lastInnerDebug || {}) },
        strip: stripDebug,
        searchSpace: {
          wbMin,
          wbMax,
          wbSamples,
          wsMin,
          wsMax,
          wsSamples,
          Bmin,
          Bmax,
          thetaDegRange: [-10, 10],
          softInRatioFloor: SOFT_INRATIO_FLOOR,
          softInRatioFloorEffective: softFloorEffective,
          softInRatioTarget: SOFT_INRATIO_TARGET,
          autoRelaxInRatioFloor: AUTO_RELAX_INRATIO_FLOOR,
          autoRelaxInRatioFloorEffective: relaxFloorEffective,
          globalFallbackUsed,
          globalFallbackInRatioFloor: GLOBAL_FALLBACK_INRATIO_FLOOR,
        },
        transform: { coordSpace: 'local', tx: offset.dx, ty: offset.dy },
      }),
    };
  }

  // === 用户确认的口径（2026-01-16）：
  // 1) 默认最优方案：按工程效率评分 efficiencyScore 排序，优先展示评分最高。
  // 2) 候选对比表：同样按 efficiencyScore 排序（qualified 优先），稳定 tie-break：
  //    efficiencyScore desc -> coverage desc -> N asc -> B desc -> signature asc
  const scoreOf = (c) => {
    const v = Number(c?.efficiencyScore);
    if (Number.isFinite(v)) return v;
    const r = Number(c?.coverageRatio);
    return Number.isFinite(r) ? r * 100 : -Infinity;
  };
  const coverageOf = (c) => {
    const r = Number(c?.coverageRatio);
    return Number.isFinite(r) ? r : -Infinity;
  };
  const compareByEfficiencyScore = (a, b) => {
    const qa = Boolean(a?.qualified);
    const qb = Boolean(b?.qualified);
    if (qa !== qb) return qa ? -1 : 1; // qualified 优先

    const sa = scoreOf(a);
    const sb = scoreOf(b);
    if (sb !== sa) return sb - sa;

    const ra = coverageOf(a);
    const rb = coverageOf(b);
    if (rb !== ra) return rb - ra;

    const na = Number(a?.N);
    const nb = Number(b?.N);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;

    const Ba = Number(a?.B);
    const Bb = Number(b?.B);
    if (Number.isFinite(Ba) && Number.isFinite(Bb) && Bb !== Ba) return Bb - Ba;

    return String(a?.signature ?? '').localeCompare(String(b?.signature ?? ''));
  };

  const tonnageOf = (c) => {
    const t = Number(c?.tonnageTotal ?? c?.metrics?.tonnageTotal);
    return Number.isFinite(t) ? t : -Infinity;
  };

  const compareByRecovery = (a, b) => {
    const qa = Boolean(a?.qualified);
    const qb = Boolean(b?.qualified);
    if (qa !== qb) return qa ? -1 : 1;

    const ta = tonnageOf(a);
    const tb = tonnageOf(b);
    const hasT = (ta > -Infinity) && (tb > -Infinity);
    if (hasT && tb !== ta) return tb - ta;

    const ra = coverageOf(a);
    const rb = coverageOf(b);
    if (rb !== ra) return rb - ra;

    const na = Number(a?.N);
    const nb = Number(b?.N);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;

    const la = Number(a?.lenCV ?? a?.metrics?.lenCV ?? 0);
    const lb = Number(b?.lenCV ?? b?.metrics?.lenCV ?? 0);
    if (Number.isFinite(la) && Number.isFinite(lb) && la !== lb) return la - lb;

    return String(a?.signature ?? '').localeCompare(String(b?.signature ?? ''));
  };

  // recovery：v1.0 退化闭环
  // - hasThickness：厚度输入是否“可用”（grid 有有效值 或 constantM>0）
  // - fallbackMode：TONNAGE 或 AREA（必须与排序口径一致）
  // - thicknessReason：用于排障的稳定枚举
  // 档 A：默认 AREA（保持旧行为）
  // 档 B：仅当“厚度场(fieldPack)来自钻孔+分层数据”可用时，启用 TONNAGE 目标影响候选输出。
  const sampler0 = buildThicknessSampler(payload?.thickness);
  const tonnageObjectiveEnabled = Boolean(payload?.tonnageObjectiveEnabled);
  // 需求：只有钻孔+分层数据存在才纳入搜索目标；因此这里不接受 constant thickness 触发 TONNAGE。
  const enableTonnageObjective = Boolean(tonnageObjectiveEnabled && sampler0?.hasThickness && sampler0.kind === 'field');
  const hasThickness = Boolean(enableTonnageObjective);
  const fallbackMode = enableTonnageObjective ? 'TONNAGE' : 'AREA';
  const thicknessReason = enableTonnageObjective
    ? (sampler0?.reason || (swapXY ? THICKNESS_REASON.AXIS_Y_THK_UNCHANGED : ''))
    : THICKNESS_REASON.FALLBACK_AREA;

  const usedFallback = qualifiedCandidates.length === 0;

  const compareByArea = (a, b) => {
    const qa = Boolean(a?.qualified);
    const qb = Boolean(b?.qualified);
    if (qa !== qb) return qa ? -1 : 1;

    // 资源回收最终口径：在满足硬约束（r_min + Ω内不相交）前提下，只按 Ω 内覆盖率最大化。
    const ra = coverageOf(a);
    const rb = coverageOf(b);
    if (rb !== ra) return rb - ra;

    // 工程偏好（在覆盖率相同/极近似时生效）：
    // 1) 异常工作面更少（裁剪后非矩形）
    // 2) minInRatio 更高
    // 3) 推进长度更均匀（lenCV 更小）
    // 4) 变宽更平稳（BRange 更小）
    const aAbn = Number(a?.abnormalFaceCount ?? a?.metrics?.abnormalFaceCount);
    const bAbn = Number(b?.abnormalFaceCount ?? b?.metrics?.abnormalFaceCount);
    const aAbnV = Number.isFinite(aAbn) ? aAbn : 1e9;
    const bAbnV = Number.isFinite(bAbn) ? bAbn : 1e9;
    if (aAbnV !== bAbnV) return aAbnV - bAbnV;

    const aMinR = Number(a?.minInRatio ?? a?.metrics?.minFaceInRatio ?? a?.metrics?.minInRatio ?? 0);
    const bMinR = Number(b?.minInRatio ?? b?.metrics?.minFaceInRatio ?? b?.metrics?.minInRatio ?? 0);
    if (Number.isFinite(aMinR) && Number.isFinite(bMinR) && bMinR !== aMinR) return bMinR - aMinR;

    const aCv = Number(a?.lenCV ?? a?.metrics?.lenCV ?? 0);
    const bCv = Number(b?.lenCV ?? b?.metrics?.lenCV ?? 0);
    if (Number.isFinite(aCv) && Number.isFinite(bCv) && aCv !== bCv) return aCv - bCv;

    const aBr0 = Number(a?.BMax ?? a?.metrics?.BMax);
    const aBr1 = Number(a?.BMin ?? a?.metrics?.BMin);
    const bBr0 = Number(b?.BMax ?? b?.metrics?.BMax);
    const bBr1 = Number(b?.BMin ?? b?.metrics?.BMin);
    const aBr = (Number.isFinite(aBr0) && Number.isFinite(aBr1)) ? Math.max(0, aBr0 - aBr1) : 0;
    const bBr = (Number.isFinite(bBr0) && Number.isFinite(bBr1)) ? Math.max(0, bBr0 - bBr1) : 0;
    if (aBr !== bBr) return aBr - bBr;

    // 稳定兜底：字典序
    return String(a?.signature ?? '').localeCompare(String(b?.signature ?? ''));
  };

  // === per-face 二次细化：对 top seeds 生成少量“远边调斜 deltaDeg_i”方案 ===
  if (PER_FACE_ENABLE) {
    try {
      const seedList0 = [...(qualifiedCandidates ?? []), ...(fallbackCandidates ?? [])]
        .slice()
        .sort(compareByArea)
        .filter((c) => Number(c?.N) >= 1);

      // 可选：按用户指定 N 集合筛选（v1.0 推荐 {3..7}）
      const seedList = (Array.isArray(PER_FACE_N_SET) && PER_FACE_N_SET.length)
        ? seedList0.filter((c) => PER_FACE_N_SET.includes(Number(c?.N)))
        : seedList0;

      const topSeeds = seedList.slice(0, PER_FACE_SEED_M);
      // 注意：全局种子数会根据时间预算自动收紧
      const topSeeds2 = seedList.slice(0, PER_FACE_SEED_M_USE);
      perFaceDebug.seedCount = topSeeds.length;

      const runRefinePass = (inRatioOverride) => {
        const baseCache = new Map();
        for (const seed of topSeeds2) {
          if (perFaceTimeExceeded()) break;
          const wbKey = String(Number(seed?.wb).toFixed(6));
          const ctx = innerCtxByWbKey.get(wbKey);
          if (!ctx?.innerPoly) continue;

          const n = Math.max(1, Math.round(Number(seed?.N) || 0));
          const B = Number(seed?.B);
          const wsNonNeg = Math.max(0, Number(seed?.ws) || 0);
          if (!(Number.isFinite(B) && B > 0)) continue;

          // 估计横向可用跨度，用于限制 sum(B_i)（避免变宽组合整体超限导致全部不可行）
          let span = 0;
          try {
            const env0 = ctx.innerPoly.getEnvelopeInternal();
            span = internalAxis === 'x' ? (env0.getMaxY() - env0.getMinY()) : (env0.getMaxX() - env0.getMinX());
          } catch {
            span = 0;
          }
          const sumBMax = (Number.isFinite(span) && span > 0)
            ? Math.max(0, span - (n - 1) * wsNonNeg)
            : Infinity;

          // 每面独立 B_i：在 per-face refine 中启用（默认开启），生成少量 BList 组合参与排序。
          const PER_FACE_VAR_B = Boolean(payload?.perFaceVarB ?? true);
          const PER_FACE_BLIST_MAX = clamp(Math.round(Number(toNum(payload?.perFaceBListMax) ?? (fastMode ? 5 : 10))), 1, 20);
          const bLists = PER_FACE_VAR_B
            ? genPerFaceBLists({
              N: n,
              Bmin,
              Bmax,
              seedB: B,
              sumBMax,
              maxCount: PER_FACE_BLIST_MAX,
              seedStr: `${cacheKey}|wb=${wbKey}|ws=${wsNonNeg.toFixed(3)}|N=${n}|seedB=${Math.round(B)}|theta=${Number(seed?.thetaDeg ?? 0).toFixed(1)}`,
            })
            : [];
          const bListsUse = (bLists && bLists.length) ? bLists : [null];

          // per-face 在 seed 的 theta 基础上做链式增量（允许累计漂移）
          const thetaDeg = Number(seed?.thetaDeg ?? seed?.metrics?.thetaDeg ?? 0);
          const thetaRad = (Number(thetaDeg) * Math.PI) / 180;
          const pivotEnv = ctx.innerPoly.getEnvelopeInternal();
          const pivot = {
            x: (Number(pivotEnv.getMinX?.()) + Number(pivotEnv.getMaxX?.())) / 2,
            y: (Number(pivotEnv.getMinY?.()) + Number(pivotEnv.getMaxY?.())) / 2,
          };

          // 性能：同一 (wb,ws,N,B/BList,theta) 下 base 布置复用
          const thetaStr = Number.isFinite(thetaDeg) ? Number(thetaDeg).toFixed(1) : '0.0';
          const omegaRot0 = (Number.isFinite(thetaRad) && Math.abs(thetaRad) > 1e-12)
            ? (rotateGeomAround(ctx.innerPoly, -thetaRad, pivot.x, pivot.y) || ctx.innerPoly)
            : ctx.innerPoly;
          const omegaRot = fixPolygonSafe(omegaRot0);
          if (!omegaRot || omegaRot.isEmpty?.() || !(Number(omegaRot.getArea?.()) > 1e-6)) continue;

          for (const bList of bListsUse) {
            if (perFaceTimeExceeded()) break;
            const bListOk = Array.isArray(bList) && bList.length === n && bList.every((x) => Number.isFinite(Number(x)) && Number(x) > 0);
            const bMean = bListOk ? (bList.reduce((s, x) => s + (Number(x) || 0), 0) / n) : Number(B);
            const bKey = bListOk ? bList.map((x) => String(Math.round(Number(x)))).join(',') : '';
            const cacheKey2 = bListOk
              ? `${wbKey}|ws=${wsNonNeg.toFixed(6)}|N=${n}|Bv=${Math.round(bMean)}|bL=${bKey}|theta=${thetaStr}`
              : `${wbKey}|ws=${wsNonNeg.toFixed(6)}|N=${n}|B=${Math.round(B)}|theta=${thetaStr}`;
            let cached = baseCache.get(cacheKey2);
            if (!cached) {
              let built = null;
              // 变宽：优先走 strict（已支持 B 为数组），保证不越界（minInRatio≈1）
              if (bListOk) {
                built = buildDesignRectsForN({
                  omegaPoly: omegaRot,
                  axis: internalAxis,
                  N: n,
                  B: bList,
                  Ws: wsNonNeg,
                  Lmax: faceAdvanceMax,
                  includeClipped: false,
                  bumpFail,
                  debugRef: stripDebug,
                  fast: false,
                  startFrom: (internalAxis === 'x') ? layoutStartFrom : layoutStartFrom,
                  coordSpace: 'local',
                });
                // strict 若失败，再退回 relaxed 兜底（允许裁切）
                const okVar0 = built && Number(built?.faceCount) === n && Array.isArray(built?.rectLoopsLocal) && built.rectLoopsLocal.length === n;
                if (!okVar0) {
                  built = buildDesignRectsForNRelaxedClipped({
                    omegaPoly: omegaRot,
                    axis: internalAxis,
                    N: n,
                    B: bList,
                    Ws: wsNonNeg,
                    Lmax: faceAdvanceMax,
                    inRatioMin: IN_RATIO_MIN,
                    fast: false,
                    startFrom: (internalAxis === 'x') ? layoutStartFrom : layoutStartFrom,
                    bumpFail,
                    perFaceShift: true,
                  });
                }
              } else if (PER_FACE_PREFER_RELAXED_LAYOUT) {
                built = buildDesignRectsForNRelaxedClipped({
                  omegaPoly: omegaRot,
                  axis: internalAxis,
                  N: n,
                  B,
                  Ws: wsNonNeg,
                  Lmax: faceAdvanceMax,
                  inRatioMin: IN_RATIO_MIN,
                  fast: false,
                  startFrom: (internalAxis === 'x') ? layoutStartFrom : layoutStartFrom,
                  bumpFail,
                  perFaceShift: true,
                });
              } else {
                built = buildDesignRectsForN({
                  omegaPoly: omegaRot,
                  axis: internalAxis,
                  N: n,
                  B,
                  Ws: wsNonNeg,
                  Lmax: faceAdvanceMax,
                  includeClipped: false,
                  bumpFail,
                  debugRef: stripDebug,
                  fast: false,
                  startFrom: (internalAxis === 'x') ? layoutStartFrom : layoutStartFrom,
                  coordSpace: 'local',
                });
              }

              const ok0 = built && Number(built?.faceCount) === n && Array.isArray(built?.rectLoopsLocal) && built.rectLoopsLocal.length === n;
              if (!ok0 && !bListOk) {
                // fallback to strict/relaxed 另一条路径（仅对等宽）
                built = PER_FACE_PREFER_RELAXED_LAYOUT
                  ? buildDesignRectsForN({
                    omegaPoly: omegaRot,
                    axis: internalAxis,
                    N: n,
                    B,
                    Ws: wsNonNeg,
                    Lmax: faceAdvanceMax,
                    includeClipped: false,
                    bumpFail,
                    debugRef: stripDebug,
                    fast: false,
                    startFrom: (internalAxis === 'x') ? layoutStartFrom : layoutStartFrom,
                    coordSpace: 'local',
                  })
                  : buildDesignRectsForNRelaxedClipped({
                    omegaPoly: omegaRot,
                    axis: internalAxis,
                    N: n,
                    B,
                    Ws: wsNonNeg,
                    Lmax: faceAdvanceMax,
                    inRatioMin: IN_RATIO_MIN,
                    fast: false,
                    startFrom: (internalAxis === 'x') ? layoutStartFrom : layoutStartFrom,
                    bumpFail,
                    perFaceShift: true,
                  });
              }
              const ok1 = built && Number(built?.faceCount) === n && Array.isArray(built?.rectLoopsLocal) && built.rectLoopsLocal.length === n;
              if (!ok1) {
                perFaceDebug.lastReason = 'BASE_LAYOUT_FAIL';
                continue;
              }
              cached = { omegaRot, built, pivot, thetaDeg, thetaRad, bList: bListOk ? bList.slice() : null };
              baseCache.set(cacheKey2, cached);
            }

          // delta 序列生成：优先用“面积引导”的 beam/greedy，避免只按平滑枚举导致角度几乎全为 0。
          // 仍保留少量 smooth 枚举用于可解释性兜底。
          const beamWidth = fastMode ? 3 : 6;
          const beamOut = fastMode ? 4 : 8;

          const deltaSeqsSmooth0 = genPerFaceDeltaDegSeqs({
            N: n,
            deltaSet: PER_FACE_DELTA_SET,
            adjMaxStep: PER_FACE_ADJ_MAX_STEP,
            maxSeq: Math.min(PER_FACE_MAX_SEQ_USE, fastMode ? 20 : 40),
          });

          // 先尝试“完全不越界”的自适应序列（ratio≈1），保证可进入最终 topK（越界方案会被排序到最后）。
          const greedyInside = genPerFaceDeltaGreedy({
            N: n,
            rectLoopsLocal: Array.isArray(cached?.built?.rectLoopsLocal) ? cached.built.rectLoopsLocal : [],
            omegaPoly: cached.omegaRot,
            deltaSet: PER_FACE_DELTA_SET,
            adjMaxStep: PER_FACE_ADJ_MAX_STEP,
            inRatioFloor: softFloorEffective,
            requireInside: true,
            deltaMin: PER_FACE_DELTA_MIN,
            deltaMax: PER_FACE_DELTA_MAX_ABS,
          });

          // 其次尝试“面积最大化”的自适应序列（只要求 >=floor）
          const greedy = genPerFaceDeltaGreedy({
            N: n,
            rectLoopsLocal: Array.isArray(cached?.built?.rectLoopsLocal) ? cached.built.rectLoopsLocal : [],
            omegaPoly: cached.omegaRot,
            deltaSet: PER_FACE_DELTA_SET,
            adjMaxStep: PER_FACE_ADJ_MAX_STEP,
            inRatioFloor: softFloorEffective,
            deltaMin: PER_FACE_DELTA_MIN,
            deltaMax: PER_FACE_DELTA_MAX_ABS,
          });
          const head = [];
          if (greedyInside && Array.isArray(greedyInside) && greedyInside.length === n) head.push(greedyInside);
          if (greedy && Array.isArray(greedy) && greedy.length === n) head.push(greedy);

          // beam：一组“严格不越界”优先，一组“面积最大化（>=floor）”补充
          const beamInside = genPerFaceDeltaBeam({
            N: n,
            rectLoopsLocal: Array.isArray(cached?.built?.rectLoopsLocal) ? cached.built.rectLoopsLocal : [],
            omegaPoly: cached.omegaRot,
            deltaSet: PER_FACE_DELTA_SET,
            adjMaxStep: PER_FACE_ADJ_MAX_STEP,
            inRatioFloor: softFloorEffective,
            requireInside: true,
            beamWidth,
            outMax: beamOut,
            deltaMin: PER_FACE_DELTA_MIN,
            deltaMax: PER_FACE_DELTA_MAX_ABS,
          });
          const beamArea = genPerFaceDeltaBeam({
            N: n,
            rectLoopsLocal: Array.isArray(cached?.built?.rectLoopsLocal) ? cached.built.rectLoopsLocal : [],
            omegaPoly: cached.omegaRot,
            deltaSet: PER_FACE_DELTA_SET,
            adjMaxStep: PER_FACE_ADJ_MAX_STEP,
            inRatioFloor: softFloorEffective,
            requireInside: false,
            beamWidth,
            outMax: beamOut,
            deltaMin: PER_FACE_DELTA_MIN,
            deltaMax: PER_FACE_DELTA_MAX_ABS,
          });

          const uniqSeq = (seqs) => {
            const out = [];
            const seen = new Set();
            for (const s of (Array.isArray(seqs) ? seqs : [])) {
              if (!Array.isArray(s) || s.length !== n) continue;
              const key = s.map((d) => String(Math.round(Number(d) || 0))).join(',');
              if (!key || seen.has(key)) continue;
              seen.add(key);
              out.push(s);
            }
            return out;
          };

          const deltaSeqs = LOCK_ZERO_ANGLES
            ? [Array(n).fill(0)]
            : uniqSeq([
              ...head,
              ...(Array.isArray(beamInside) ? beamInside : []),
              ...(Array.isArray(beamArea) ? beamArea : []),
              ...(Array.isArray(deltaSeqsSmooth0) ? deltaSeqsSmooth0 : []),
            ]);
          for (const dList of deltaSeqs) {
            if (perFaceTimeExceeded()) break;
            if (!Array.isArray(dList) || dList.length !== n) continue;
            const allZero = dList.every((d) => Math.abs(Number(d) || 0) <= 1e-12);

            perFaceDebug.generated += 1;
            const c = buildCandidateForFixedNPerFaceDelta({
              innerPoly: ctx.innerPoly,
              innerPolyRotated: cached.omegaRot,
              innerArea: ctx.innerArea,
              omegaLoops: ctx.omegaLoops,
              wbUsed: ctx.wbUsed,
              wsNonNeg,
              N: n,
              B: Number(B),
              BList: cached?.bList,
              deltaDegList: dList.map((d) => Math.max(PER_FACE_DELTA_MIN, Math.min(PER_FACE_DELTA_MAX_ABS, Math.round(Number(d))))),
              inRatioMinOverride: inRatioOverride,
              thetaDeg: cached.thetaDeg,
              thetaRad: cached.thetaRad,
              thetaPivot: cached.pivot,
              baseLayout: cached.built,
            });
            if (!c) continue;
            perFaceDebug.qualified += 1;
            const before = allCandByKey.size;
            pushCandidateUnique(c);
            const after = allCandByKey.size;
            if (after > before) perFaceDebug.pushedUnique += 1;

            if (!allZero && perFaceDebug.pushedUnique >= PER_FACE_UNIQUE_CAP) break;
          }
          }
        }
      };

      runRefinePass(null);

      // 调试兜底：若全部被 r_min 筛光，且提供 try 阈值，则降阈值再试一轮
      if (perFaceDebug.generated > 0 && perFaceDebug.qualified === 0 && perFaceDebug.lastReason === 'INRATIO_LT_MIN' && Number.isFinite(Number(PER_FACE_IN_RATIO_TRY))) {
        perFaceDebug.usedFallbackRmin = true;
        runRefinePass(PER_FACE_IN_RATIO_TRY);
      }
    } catch (e) {
      bumpFail('PERFACE_REFINE_EXCEPTION');
      const msg = String(e?.message ?? e ?? '');
      const stk = String(e?.stack ?? '');
      perFaceDebug.lastReason = msg ? `REFINE_EXCEPTION: ${msg}` : 'REFINE_EXCEPTION';
      try {
        responseBase.attemptSummary.perFaceException = msg ? msg.slice(0, 300) : '';
        responseBase.attemptSummary.perFaceExceptionStack = stk ? stk.slice(0, 800) : '';
      } catch {
        // ignore
      }
    }
  }

  responseBase.attemptSummary.perFaceExtraBudgetUsed = Boolean(perFaceExtraBudgetUsed);

  // v1.0：最终候选必须以 allCandByKey 为准（per-face refine/global fallback 都会往这里写）。
  // 之前用 qualified+fallback 数组拼接在极端情况下可能漏掉后续 push 的候选，导致“perFace.generated>0 但 best 仍是 base”。
  const allCandidates = Array.from(allCandByKey.values());

  // v1.0 topK：严格截断（<=topK），不再强行“覆盖全 N”（避免 candidatesCount 波动）
  // fast 预览：只输出 top1（配合 App.jsx 的 fast+refine 链路）
  const wantK = fastMode ? 1 : Math.max(1, Math.round(Number(topK) || 10));

  // === 候选排序主口径 ===
  // - 默认：AREA（coverage 为主）
  // - 启用厚度场：先按 AREA 取一批“可疑似最优”的候选，再用吨位近似计算重排，影响最终 topK。
  const compareMain = enableTonnageObjective ? compareByRecovery : compareByArea;

  const rankedAllArea = (allCandidates ?? []).slice().sort(compareByArea);
  // 仅对一个小批次计算吨位（避免对全量候选做网格采样）。
  const TONNAGE_POOL_MULT = clamp(Math.round(Number(toNum(payload?.tonnagePoolMult) ?? 6)), 2, 12);
  const poolK = enableTonnageObjective ? Math.min(rankedAllArea.length, Math.max(wantK, wantK * TONNAGE_POOL_MULT)) : wantK;

  let candidates = rankedAllArea.slice(0, poolK);

  // 启用吨位目标：对 pool 内候选做吨位近似计算并重排。
  if (enableTonnageObjective) {
    try {
      const omegaLoopsWorld0 = Array.isArray(candidates?.[0]?.render?.omegaLoops) ? candidates[0].render.omegaLoops : [];
      const omegaLoop0 = omegaLoopsWorld0.find((l) => Array.isArray(l) && l.length >= 3) || null;
      const omegaPoly = omegaLoop0 ? buildJstsPolygonFromLoop(omegaLoop0) : null;

      const TONNAGE_STEP_M = clamp(Number(toNum(payload?.tonnageSampleStepM) ?? (fastMode ? 40 : 30)), 10, 120);

      const computeTonnageForCandidate = (cand) => {
        if (!cand || !cand.render || !omegaPoly || omegaPoly.isEmpty?.()) return;

        // face loops：优先 facesLoops（可含非矩形），否则回退 rectLoops。
        const faces0 = Array.isArray(cand?.render?.facesLoops) ? cand.render.facesLoops : null;
        const rectLoops0 = Array.isArray(cand?.render?.rectLoops) ? cand.render.rectLoops : [];
        const faces = (Array.isArray(faces0) && faces0.length)
          ? faces0
            .map((x, idx) => ({ faceIndex: Number(x?.faceIndex ?? (idx + 1)), loop: x?.loop }))
            .filter((x) => Number.isFinite(Number(x?.faceIndex)) && Number(x.faceIndex) >= 1 && Array.isArray(x?.loop) && x.loop.length >= 3)
          : rectLoops0
            .map((loop, idx) => ({ faceIndex: idx + 1, loop }))
            .filter((x) => Array.isArray(x?.loop) && x.loop.length >= 3);
        if (!faces.length) return;

        let sum = 0;
        for (const face of faces) {
          const loop = face?.loop;
          if (!Array.isArray(loop) || loop.length < 3) continue;

          // strictInsideOmega：无需 overlay，直接采样。
          if (cand?.render?.strictInsideOmega) {
            const t0 = integrateTonnageForLoop({ loop, sampler: sampler0, gridRes: TONNAGE_STEP_M });
            if (Number.isFinite(t0) && t0 > 0) sum += t0;
            continue;
          }

          // 通用：面与 Ω 取交后采样（避免把 Ω 外也算进吨位）。
          const facePoly = buildJstsPolygonFromLoop(loop);
          if (!facePoly || facePoly.isEmpty?.()) continue;
          let inter = null;
          try {
            inter = robustIntersection(omegaPoly, facePoly);
          } catch {
            inter = null;
          }
          if (!inter || inter.isEmpty?.()) continue;
          const loops = polygonToLoops(inter);
          const loops0 = Array.isArray(loops) ? loops : [];
          for (const l of loops0) {
            if (!Array.isArray(l) || l.length < 3) continue;
            const t1 = integrateTonnageForLoop({ loop: l, sampler: sampler0, gridRes: TONNAGE_STEP_M });
            if (Number.isFinite(t1) && t1 > 0) sum += t1;
          }
        }

        if (!Number.isFinite(sum) || sum < 0) sum = 0;
        cand.tonnageTotal = sum;
        if (cand.metrics && typeof cand.metrics === 'object') cand.metrics.tonnageTotal = sum;
      };

      for (const c of candidates) computeTonnageForCandidate(c);

      // 用吨位口径重排，并截断回 topK。
      candidates = candidates.slice().sort(compareByRecovery).slice(0, wantK);
    } catch {
      // ignore: tonnage objective failures should not break baseline
      candidates = candidates.slice(0, wantK);
    }
  } else {
    candidates = candidates.slice(0, wantK);
  }

  const best = candidates[0];
  responseBase.attemptSummary.timeBudgetHit = Boolean(timeBudgetHit);
  const elapsedMs = Math.max(0, nowMs() - startMs);
  const partial = Boolean(timeBudgetHit && !fastMode);
  // 若触发 full-time-budget，则按“预览”处理（fast=true），避免前端把它当作可复用的稳定缓存。
  responseBase.fast = Boolean(fastMode || partial);
  perFaceDebug.fastMode = Boolean(responseBase.fast);

  if (!best) {
    const reason = partial ? '计算超时：未能在时间预算内产生候选' : '无可行候选';
    responseBase.failedReason = reason;
    return {
      ...responseBase,
      ok: false,
      message: reason,
      debug: withPerFaceDebug({
        axis: originalAxis,
        internalAxis,
        swapXY,
      }),
    };
  }
  const nStar = best.N;

  // === v1.1：工程化全覆盖（分段变宽 + 残煤清扫 cleanupResidual）===
  const segCfg0 = (payload?.segmentWidth && typeof payload.segmentWidth === 'object') ? payload.segmentWidth : {};
  const cleanCfg0 = (payload?.cleanupResidual && typeof payload.cleanupResidual === 'object') ? payload.cleanupResidual : {};
  const SEG_ENABLED = Boolean(segCfg0?.enabled);
  const CLEAN_ENABLED = Boolean(cleanCfg0?.enabled);
  const SEG_LT_M = clamp(Number(toNum(segCfg0?.LtM) ?? 50), 5, 500);
  const SEG_GMAX = Math.max(0, Number(toNum(segCfg0?.gmax) ?? 0.4)); // m/m
  const DB_MAIN = Math.max(0, Number(toNum(segCfg0?.deltaBMaxMainM) ?? 5));
  const DB_CLEAN = Math.max(DB_MAIN, Number(toNum(segCfg0?.deltaBMaxCleanupM) ?? 10));
  const DB_STEP = clamp(Number(toNum(segCfg0?.deltaBStepM) ?? 1), 0.5, 10);
  const SEG_COUNT_MAIN = clamp(Math.round(Number(toNum(segCfg0?.segmentCountMaxMain) ?? 3)), 2, 3);
  const SEG_COUNT_CLEAN = clamp(Math.round(Number(toNum(segCfg0?.segmentCountMaxCleanup) ?? 3)), 2, 3);
  const BREAK2 = Array.isArray(segCfg0?.breakRatios2) ? segCfg0.breakRatios2.map((x) => Number(x)).filter((v) => Number.isFinite(v) && v > 0.05 && v < 0.95) : [0.4, 0.5, 0.6];
  const BREAK3 = Array.isArray(segCfg0?.breakRatios3)
    ? segCfg0.breakRatios3
      .map((pair) => (Array.isArray(pair) ? pair.slice(0, 2) : []))
      .map((pair) => pair.map((x) => Number(x)))
      .filter((pair) => pair.length === 2 && pair.every((v) => Number.isFinite(v) && v > 0.05 && v < 0.95) && pair[1] > pair[0] + 0.05)
    : [[0.35, 0.65], [0.4, 0.7], [0.45, 0.75]];
  const CLEAN_MAX_FACES = clamp(Math.round(Number(toNum(cleanCfg0?.maxFacesToAdjust) ?? 5)), 1, 10);
  const CLEAN_MAX_REPL = clamp(Math.round(Number(toNum(cleanCfg0?.maxReplacements) ?? 2)), 0, 5);
  const CLEAN_ALLOW_ADD = Boolean(cleanCfg0?.allowAddShortFace);
  const CLEAN_MAX_NEW = clamp(Math.round(Number(toNum(cleanCfg0?.maxNewFaces) ?? 1)), 0, 2);
  const CLEAN_BUDGET_MS = clamp(Math.round(Number(toNum(cleanCfg0?.maxTimeMs) ?? 1500)), 100, 8000);

  // 预先构造展示Ω（world 坐标）
  let sharedOmegaPoly = null;
  try {
    const omegaLoopsWorld0 = Array.isArray(candidates?.[0]?.render?.omegaLoops) ? candidates[0].render.omegaLoops : [];
    const omegaLoop0 = omegaLoopsWorld0.find((l) => Array.isArray(l) && l.length >= 3) || null;
    sharedOmegaPoly = omegaLoop0 ? buildJstsPolygonFromLoop(omegaLoop0) : null;
    if (sharedOmegaPoly && sharedOmegaPoly.isEmpty?.()) sharedOmegaPoly = null;
  } catch {
    sharedOmegaPoly = null;
  }

  // cleanupResidual：只在 full compute 且候选存在时运行，避免拖慢 fast 预览。
  const cleanupSummary = {
    enabled: Boolean(SEG_ENABLED && CLEAN_ENABLED && !fastMode && sharedOmegaPoly),
    ran: false,
    replacements: 0,
    addedFaces: 0,
    residualAreaBefore: null,
    residualAreaAfter: null,
    coverageBefore: null,
    coverageAfter: null,
    elapsedMs: null,
    note: '',
  };

  const buildUnionFromFaceLoops = (facesLoops) => {
    let u = null;
    for (const loop of facesLoops ?? []) {
      const poly = buildJstsPolygonFromLoop(loop);
      if (!poly || poly.isEmpty?.()) continue;
      u = u ? (robustUnion(u, poly) || u.union?.(poly) || u) : poly;
    }
    return u;
  };

  const computeCoverageFromFaceLoops = (omegaPoly, facesLoops) => {
    if (!omegaPoly || omegaPoly.isEmpty?.()) return { coveredArea: 0, coverageRatio: 0, union: null };
    const u0 = buildUnionFromFaceLoops(facesLoops);
    if (!u0 || u0.isEmpty?.()) return { coveredArea: 0, coverageRatio: 0, union: u0 };
    const inter = robustIntersection(omegaPoly, u0);
    const a = Number(inter?.getArea?.());
    const coveredArea = Number.isFinite(a) && a > 0 ? a : 0;
    const denom = (Number.isFinite(omegaAreaForCoverage) && omegaAreaForCoverage > 1e-9) ? omegaAreaForCoverage : 0;
    const coverageRatio = denom > 1e-12 ? (coveredArea / denom) : 0;
    return { coveredArea, coverageRatio, union: u0 };
  };

  const genDeltaList = (maxAbs) => {
    const m = Math.max(0, Number(maxAbs) || 0);
    const step = Math.max(0.5, Number(DB_STEP) || 1);
    const out = [];
    for (let d = 0; d <= m + 1e-9; d += step) out.push(Math.round(d * 1000) / 1000);
    return out.length ? out : [0];
  };

  const buildSegmentedFaceLoop = ({ baseBox, side, breakRatios, widths, wsHard, prevBox, nextBox }) => {
    if (!baseBox) return null;
    const x0 = Number(baseBox.minX);
    const x1 = Number(baseBox.maxX);
    const y0 = Number(baseBox.minY);
    const y1 = Number(baseBox.maxY);
    if (!([x0, x1, y0, y1].every(Number.isFinite)) || !(x1 > x0) || !(y1 > y0)) return null;

    const B0 = y1 - y0;
    const Bs0 = (Array.isArray(widths) ? widths : []).map((b) => clamp(Number(b) || B0, Number(Bmin), Number(Bmax)));
    if (!Bs0.length) return null;

    // 坡度/过渡约束：相邻段宽度变化不能超过 gmax*Lt
    const maxJump = Math.max(0, SEG_GMAX) * Math.max(0, SEG_LT_M);
    for (let i = 1; i < Bs0.length; i++) {
      if (Math.abs(Bs0[i] - Bs0[i - 1]) > maxJump + 1e-9) return null;
    }

    // 邻面煤柱硬约束：不允许把煤柱挤到 wsHard 以下
    const hard = Math.max(0, Number(wsHard) || 0);
    let yMinAllowed = -Infinity;
    let yMaxAllowed = +Infinity;
    if (prevBox && Number.isFinite(prevBox.maxY)) yMinAllowed = Number(prevBox.maxY) + hard;
    if (nextBox && Number.isFinite(nextBox.minY)) yMaxAllowed = Number(nextBox.minY) - hard;

    // 控制点：沿 x 方向的宽度 piecewise（在 break 附近做 Lt 过渡）
    const L = x1 - x0;
    const breaks = (Array.isArray(breakRatios) ? breakRatios : [])
      .map((r) => clamp(Number(r), 0.05, 0.95))
      .map((r) => x0 + r * L)
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    const lt2 = SEG_LT_M / 2;

    const cps = [];
    cps.push({ x: x0, B: Bs0[0] });
    for (let i = 0; i < breaks.length && i + 1 < Bs0.length; i++) {
      const bx = breaks[i];
      const xl = clamp(bx - lt2, x0, x1);
      const xr = clamp(bx + lt2, x0, x1);
      if (xr <= xl + 1e-6) continue;
      cps.push({ x: xl, B: Bs0[i] });
      cps.push({ x: xr, B: Bs0[i + 1] });
    }
    cps.push({ x: x1, B: Bs0[Bs0.length - 1] });

    // 去重（同 x 取最后一个 B）
    const cps2 = [];
    for (const c of cps) {
      const prev = cps2[cps2.length - 1];
      if (prev && Math.abs(prev.x - c.x) <= 1e-6) {
        prev.B = c.B;
      } else {
        cps2.push({ x: c.x, B: c.B });
      }
    }
    if (cps2.length < 2) return null;

    // 根据 side 生成外轮廓（工程口径：只向残煤侧变宽，另一侧保持不动）
    if (String(side) === 'top') {
      const yBot = y0;
      // 约束上边界不能超过 yMaxAllowed
      const tops = cps2.map((c) => ({ x: c.x, y: Math.min(yBot + c.B, yMaxAllowed) }));
      if (tops.some((t) => !(Number.isFinite(t.y) && t.y > yBot + 1e-6))) return null;
      const loop = [{ x: x0, y: yBot }, { x: x1, y: yBot }];
      for (let i = tops.length - 1; i >= 0; i--) loop.push({ x: tops[i].x, y: tops[i].y });
      loop.push({ x: x0, y: yBot });
      return loop;
    }

    if (String(side) === 'bottom') {
      const yTop = y1;
      const bots = cps2.map((c) => ({ x: c.x, y: Math.max(yTop - c.B, yMinAllowed) }));
      if (bots.some((t) => !(Number.isFinite(t.y) && t.y < yTop - 1e-6))) return null;
      const loop = [{ x: x0, y: yTop }, { x: x1, y: yTop }];
      for (let i = bots.length - 1; i >= 0; i--) loop.push({ x: bots[i].x, y: bots[i].y });
      loop.push({ x: x0, y: yTop });
      return loop;
    }

    return null;
  };

  const pickResidualSideForFace = (residualPoly, faceBox) => {
    if (!residualPoly || residualPoly.isEmpty?.() || !faceBox) return null;
    const pad = Math.max(1, Math.min(20, (Number(faceBox.maxY) - Number(faceBox.minY)) * 0.2));
    const win = rectPoly(faceBox.minX - pad, faceBox.minY - pad, faceBox.maxX + pad, faceBox.maxY + pad);
    const near = robustIntersection(residualPoly, win);
    const a = Number(near?.getArea?.());
    if (!(Number.isFinite(a) && a > 1e-6)) return null;
    let cy = null;
    try {
      const c = near.getCentroid?.();
      const cc = c?.getCoordinate?.();
      cy = Number(cc?.y);
    } catch {
      cy = null;
    }
    if (!Number.isFinite(cy)) return null;
    const yMid = (Number(faceBox.minY) + Number(faceBox.maxY)) / 2;
    return cy >= yMid ? 'top' : 'bottom';
  };

  const estimateResidualNearFaceArea = (residualPoly, faceBox) => {
    if (!residualPoly || residualPoly.isEmpty?.() || !faceBox) return 0;
    const padX = Math.max(5, Math.min(60, (Number(faceBox.maxX) - Number(faceBox.minX)) * 0.15));
    const padY = Math.max(5, Math.min(60, (Number(faceBox.maxY) - Number(faceBox.minY)) * 0.3));
    const win = rectPoly(faceBox.minX - padX, faceBox.minY - padY, faceBox.maxX + padX, faceBox.maxY + padY);
    const near = robustIntersection(residualPoly, win);
    const a = Number(near?.getArea?.());
    return (Number.isFinite(a) && a > 0) ? a : 0;
  };

  const tryCleanupResidual = () => {
    if (!cleanupSummary.enabled) return null;
    if (!candidates?.length) return null;
    if (!(CLEAN_MAX_REPL >= 1)) return null;

    const base = candidates[0];
    const baseRectLoops = Array.isArray(base?.render?.rectLoops) ? base.render.rectLoops : [];
    if (!baseRectLoops.length) return null;

    // 安全门：分段变宽默认按 bbox(x/y) 构造，仅对“轴对齐矩形面”可靠。
    // 如果出现旋转矩形/斜面（theta!=0 等），直接跳过 cleanup，避免生成错误几何。
    try {
      for (let i = 0; i < Math.min(3, baseRectLoops.length); i++) {
        const poly = buildJstsPolygonFromLoop(baseRectLoops[i]);
        if (!isAxisAlignedRectanglePolygon(poly)) {
          cleanupSummary.note = 'skip: non-axis-aligned faces';
          return null;
        }
      }
    } catch {
      cleanupSummary.note = 'skip: axis-check failed';
      return null;
    }

    const t0 = nowMs();
    const deadline = t0 + CLEAN_BUDGET_MS;
    const exceeded = () => nowMs() > deadline;

    const wsHard = Math.max(0, Number(wsMin) || 0);
    const boxes = baseRectLoops.map((loop) => bboxOfLoop(loop)).map((bb) => bb || null);
    const baseWidths = boxes.map((bb) => (bb ? (bb.maxY - bb.minY) : null));
    const b0 = Number.isFinite(Number(base?.B)) ? Number(base.B) : (Number.isFinite(Number(baseWidths?.[0])) ? Number(baseWidths[0]) : null);
    if (!Number.isFinite(b0)) return null;

    // 初始 coverage/residual
    const cov0 = computeCoverageFromFaceLoops(sharedOmegaPoly, baseRectLoops);
    cleanupSummary.coverageBefore = cov0.coverageRatio;

    let union0 = cov0.union;
    if (!union0 || union0.isEmpty?.()) return null;
    let residual0 = robustDifference(sharedOmegaPoly, union0);
    residual0 = residual0 ? ensureValid(residual0, 'residual0') : null;
    const rA0 = Number(residual0?.getArea?.());
    cleanupSummary.residualAreaBefore = Number.isFinite(rA0) ? rA0 : null;
    if (!(Number.isFinite(rA0) && rA0 > 1e-6)) {
      cleanupSummary.note = 'residual≈0';
      return null;
    }

    let curLoops = baseRectLoops.slice();
    let curUnion = union0;
    let curResidual = residual0;

    const mkDeltaCandidates = (maxAbs) => {
      const ds = genDeltaList(maxAbs);
      // 为控规模：主面用全步长，cleanup 用稍稀疏（仍覆盖 0..max）
      if (!(maxAbs > 5)) return ds;
      const out = [];
      for (const d of ds) {
        if (d === 0 || Math.abs(d % (DB_STEP * 2)) <= 1e-9 || d >= maxAbs - 1e-9) out.push(d);
      }
      return out.length ? out : ds;
    };

    const buildVariantsForFace = ({ faceIndex, purpose }) => {
      const idx = faceIndex - 1;
      const bb = boxes[idx];
      if (!bb) return [];
      const side = pickResidualSideForFace(curResidual, bb);
      if (!side) return [];

      const prevBox = (idx - 1 >= 0) ? boxes[idx - 1] : null;
      const nextBox = (idx + 1 < boxes.length) ? boxes[idx + 1] : null;
      const baseB = Number.isFinite(Number(baseWidths[idx])) ? Number(baseWidths[idx]) : (bb.maxY - bb.minY);
      const maxAbs = (purpose === 'main') ? DB_MAIN : DB_CLEAN;
      const segMax = (purpose === 'main') ? SEG_COUNT_MAIN : SEG_COUNT_CLEAN;
      const deltas = mkDeltaCandidates(maxAbs);

      const out = [];
      // 2 段：前段保持 baseB，后段向残煤侧变宽
      if (segMax >= 2) {
        for (const r of BREAK2) {
          for (const d of deltas) {
            const widths = [baseB, baseB + d];
            const loop = buildSegmentedFaceLoop({ baseBox: bb, side, breakRatios: [r], widths, wsHard, prevBox, nextBox });
            if (loop) out.push({ loop, side, seg: 2, dList: [0, d], breaks: [r] });
          }
        }
      }

      // 3 段：只做两种典型结构，避免组合爆炸
      if (segMax >= 3) {
        for (const pair of BREAK3) {
          const r1 = pair[0];
          const r2 = pair[1];
          for (const d of deltas) {
            // 结构 A：后两段变宽（贴边扫尾）
            {
              const widths = [baseB, baseB + d, baseB + d];
              const loop = buildSegmentedFaceLoop({ baseBox: bb, side, breakRatios: [r1, r2], widths, wsHard, prevBox, nextBox });
              if (loop) out.push({ loop, side, seg: 3, dList: [0, d, d], breaks: [r1, r2] });
            }
            // 结构 B：只最后一段变宽（端头补偿）
            {
              const widths = [baseB, baseB, baseB + d];
              const loop = buildSegmentedFaceLoop({ baseBox: bb, side, breakRatios: [r1, r2], widths, wsHard, prevBox, nextBox });
              if (loop) out.push({ loop, side, seg: 3, dList: [0, 0, d], breaks: [r1, r2] });
            }
          }
        }
      }

      return out;
    };

    const isNonOverlapping = (idxReplace, loopNew) => {
      const bbNew = bboxOfLoop(loopNew);
      if (!bbNew) return false;
      const polyNew = buildJstsPolygonFromLoop(loopNew);
      if (!polyNew || polyNew.isEmpty?.()) return false;
      for (let j = 0; j < curLoops.length; j++) {
        if (j === idxReplace) continue;
        const loopJ = curLoops[j];
        const bbJ = bboxOfLoop(loopJ);
        if (bbJ && !bboxIntersects(
          { minX: bbNew.minX, maxX: bbNew.maxX, minY: bbNew.minY, maxY: bbNew.maxY },
          { minX: bbJ.minX, maxX: bbJ.maxX, minY: bbJ.minY, maxY: bbJ.maxY }
        )) continue;
        const polyJ = buildJstsPolygonFromLoop(loopJ);
        if (!polyJ || polyJ.isEmpty?.()) continue;
        const inter = robustIntersection(polyNew, polyJ);
        const a = Number(inter?.getArea?.());
        if (Number.isFinite(a) && a > 1e-6) return false;
      }
      return true;
    };

    const applied = [];
    for (let rep = 0; rep < CLEAN_MAX_REPL; rep++) {
      if (exceeded()) break;
      const rA = Number(curResidual?.getArea?.());
      if (!(Number.isFinite(rA) && rA > 1e-6)) break;

      // 选取最需要修补的面（与 residual 近邻面积最大）
      const scores = [];
      for (let i = 0; i < boxes.length; i++) {
        const bb = boxes[i];
        if (!bb) continue;
        const nearA = estimateResidualNearFaceArea(curResidual, bb);
        if (nearA > 1e-6) scores.push({ faceIndex: i + 1, nearA });
      }
      scores.sort((a, b) => (b.nearA - a.nearA));
      const targetFaces = scores.slice(0, CLEAN_MAX_FACES);
      if (!targetFaces.length) break;

      let bestMove = null;
      for (const tf of targetFaces) {
        if (exceeded()) break;
        const idx = tf.faceIndex - 1;
        // 主面微调优先，再做 cleanup 幅度
        const purposes = ['main', 'cleanup'];
        for (const purpose of purposes) {
          if (exceeded()) break;
          const variants = buildVariantsForFace({ faceIndex: tf.faceIndex, purpose });
          for (const v of variants) {
            if (exceeded()) break;
            if (!isNonOverlapping(idx, v.loop)) continue;
            const poly = buildJstsPolygonFromLoop(v.loop);
            if (!poly || poly.isEmpty?.()) continue;
            const gainGeom = robustIntersection(curResidual, poly);
            const gain = Number(gainGeom?.getArea?.());
            const gainA = (Number.isFinite(gain) && gain > 0) ? gain : 0;
            // 惩罚：段数 + 变宽幅度（鼓励小改动）
            const dSum = v.dList.reduce((s, x) => s + Math.abs(Number(x) || 0), 0);
            const penalty = (v.seg - 1) * 0.2 + dSum * 0.01;
            const score = gainA - penalty;
            if (!bestMove || score > bestMove.score + 1e-9) {
              bestMove = { ...v, faceIndex: tf.faceIndex, idx, gainA, score, purpose };
            }
          }
          if (bestMove && bestMove.gainA > 1e-6) break;
        }
      }

      if (!bestMove || !(bestMove.gainA > 1e-6)) break;
      curLoops[bestMove.idx] = bestMove.loop;
      applied.push(bestMove);
      cleanupSummary.replacements = applied.length;

      // 更新 union/residual
      curUnion = buildUnionFromFaceLoops(curLoops);
      if (!curUnion || curUnion.isEmpty?.()) break;
      curResidual = robustDifference(sharedOmegaPoly, curUnion);
      curResidual = curResidual ? ensureValid(curResidual, 'residual1') : null;
    }

    // 新增短面（工程兜底）：仅处理“残煤完全在条带组上方/下方”的简单情况。
    // 更复杂的内凹残煤仍由“替换变宽”去清扫，避免引入重叠/煤柱冲突。
    if (CLEAN_ALLOW_ADD && CLEAN_MAX_NEW > 0 && !exceeded()) {
      try {
        const rA = Number(curResidual?.getArea?.());
        if (Number.isFinite(rA) && rA > 1e-6) {
          const env = curResidual.getEnvelopeInternal?.();
          const rBox = envToBox(env);

          const allMinY = Math.min(...boxes.map((bb) => Number(bb?.minY)).filter((v) => Number.isFinite(v)));
          const allMaxY = Math.max(...boxes.map((bb) => Number(bb?.maxY)).filter((v) => Number.isFinite(v)));
          const allMinX = Math.min(...boxes.map((bb) => Number(bb?.minX)).filter((v) => Number.isFinite(v)));
          const allMaxX = Math.max(...boxes.map((bb) => Number(bb?.maxX)).filter((v) => Number.isFinite(v)));

          const wsHard = Math.max(0, Number(wsMin) || 0);

          // 判断残煤是否整体位于上方/下方
          const isAbove = Number.isFinite(rBox?.minY) && Number.isFinite(allMaxY) && (rBox.minY >= allMaxY + wsHard + 1e-6);
          const isBelow = Number.isFinite(rBox?.maxY) && Number.isFinite(allMinY) && (rBox.maxY <= allMinY - wsHard - 1e-6);

          if ((isAbove || isBelow) && Number.isFinite(allMinX) && Number.isFinite(allMaxX) && Number.isFinite(rBox?.minX) && Number.isFinite(rBox?.maxX)) {
            const x0 = clamp(rBox.minX, allMinX, allMaxX);
            const x1 = clamp(rBox.maxX, allMinX, allMaxX);
            if (x1 > x0 + 1e-3) {
              const rH = Number.isFinite(rBox.maxY - rBox.minY) ? (rBox.maxY - rBox.minY) : Number(Bmin);
              const Bnew = clamp(Math.max(Number(Bmin), rH), Number(Bmin), Number(Bmax));
              let y0, y1;
              if (isAbove) {
                y0 = allMaxY + wsHard;
                y1 = y0 + Bnew;
              } else {
                y1 = allMinY - wsHard;
                y0 = y1 - Bnew;
              }

              // 不要越出 Ω 的包络太多（只作为近似短面，最终会被 Ω 裁剪）
              const newLoop = [
                { x: x0, y: y0 },
                { x: x1, y: y0 },
                { x: x1, y: y1 },
                { x: x0, y: y1 },
                { x: x0, y: y0 },
              ];

              const isNonOverlapAll = (() => {
                const bbNew = bboxOfLoop(newLoop);
                const polyNew = buildJstsPolygonFromLoop(newLoop);
                if (!bbNew || !polyNew || polyNew.isEmpty?.()) return false;
                for (const loopJ of curLoops) {
                  const bbJ = bboxOfLoop(loopJ);
                  if (bbJ && !bboxIntersects(
                    { minX: bbNew.minX, maxX: bbNew.maxX, minY: bbNew.minY, maxY: bbNew.maxY },
                    { minX: bbJ.minX, maxX: bbJ.maxX, minY: bbJ.minY, maxY: bbJ.maxY }
                  )) continue;
                  const polyJ = buildJstsPolygonFromLoop(loopJ);
                  if (!polyJ || polyJ.isEmpty?.()) continue;
                  const inter = robustIntersection(polyNew, polyJ);
                  const a = Number(inter?.getArea?.());
                  if (Number.isFinite(a) && a > 1e-6) return false;
                }
                return true;
              })();

              if (isNonOverlapAll) {
                curLoops = [...curLoops, newLoop];
                cleanupSummary.addedFaces = 1;
                curUnion = buildUnionFromFaceLoops(curLoops);
                curResidual = robustDifference(sharedOmegaPoly, curUnion);
                curResidual = curResidual ? ensureValid(curResidual, 'residualAdd') : null;
              }
            }
          }
        }
      } catch {
        // ignore add-face failures
      }
    }

    const cov1 = computeCoverageFromFaceLoops(sharedOmegaPoly, curLoops);
    cleanupSummary.coverageAfter = cov1.coverageRatio;
    const rA1 = Number(curResidual?.getArea?.());
    cleanupSummary.residualAreaAfter = Number.isFinite(rA1) ? rA1 : null;
    cleanupSummary.elapsedMs = Math.max(0, nowMs() - t0);
    cleanupSummary.ran = true;

    if (!(cleanupSummary.coverageAfter > (cleanupSummary.coverageBefore ?? 0) + 1e-6) && !(cleanupSummary.residualAreaAfter < (cleanupSummary.residualAreaBefore ?? Infinity) - 1e-6)) {
      cleanupSummary.note = 'no improvement';
      return null;
    }

    // 生成“清扫后”候选（不改变原搜索闭环，只作为工程验收候选插入 topK）
    const sigBase = String(base?.signature ?? base?.key ?? '');
    const sig = sigBase ? `${sigBase}|segW=1|clean=1` : `segW=1|clean=1`;
    const faceObjs = curLoops.map((loop, i) => ({ faceIndex: i + 1, loop }));
    const out = {
      ...base,
      key: sig,
      signature: sig,
      N: curLoops.length,
      BList: null,
      abnormalFaceCount: 0,
      abnormalFaces: [],
      coverageRatio: cov1.coverageRatio,
      efficiencyScore: cov1.coverageRatio * 100,
      coveredArea: cov1.coveredArea,
      faceAreaTotal: cov1.coveredArea,
      softScore: base?.softScore,
      metrics: {
        ...(base?.metrics && typeof base.metrics === 'object' ? base.metrics : {}),
        faceAreaTotal: cov1.coveredArea,
        coverageRatio: cov1.coverageRatio,
        efficiencyScore: cov1.coverageRatio * 100,
      },
      render: {
        ...(base?.render && typeof base.render === 'object' ? base.render : {}),
        strictInsideOmega: false,
        allowNonRectFaces: true,
        facesLoops: faceObjs,
        plannedWorkfaceLoopsWorld: faceObjs,
      },
    };
    // 把清扫摘要挂到 debug/metrics 上，便于验收
    try {
      out.cleanupResidual = cleanupSummary;
      if (out.metrics && typeof out.metrics === 'object') out.metrics.cleanupResidual = cleanupSummary;
    } catch {
      // ignore
    }
    return out;
  };

  try {
    const improved = tryCleanupResidual();
    if (improved) {
      // 插到第一名参与展示与后续裁剪；仍保持 topK 截断
      candidates = [improved, ...candidates].slice(0, wantK);
    }
  } catch {
    // ignore cleanup exceptions
  }

  // === 渲染口径（资源回收）：必须裁剪到粉色 Ω 内 ===
  // 性能：只对“返回给前端的 topK 候选”做裁剪几何；全量候选不做。
  // 缓存：同一个 omegaPoly 下，对相同 rect loop 的裁剪结果复用，避免重复 robustIntersection。
  // 注意：缓存仅用于 topK 裁剪阶段，不影响候选生成与排序。
  const clipCacheByOmega = new WeakMap();
  const sanitizeLoopForRender = (loop) => {
    const pts0 = Array.isArray(loop) ? loop : [];
    if (pts0.length < 3) return [];

    const EPS = 1e-4; // 0.1mm（坐标单位为 m 时足够保守）
    const out = [];
    for (const p of pts0) {
      const x = Number(p?.x);
      const y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const prev = out[out.length - 1];
      if (prev && Math.abs(prev.x - x) <= EPS && Math.abs(prev.y - y) <= EPS) continue;
      out.push({ x, y });
    }

    if (out.length >= 3) {
      const a = out[0];
      const b = out[out.length - 1];
      if (Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS) out.pop();
    }

    return out.length >= 3 ? out : [];
  };

  // 轻量消刺/简化：只用于渲染（裁剪后 loop 常出现很多锯齿/毛刺点）
  // 目标：减少 intersection 带来的微小折线，不影响整体形状。
  const simplifyLoopForRender = (loop) => {
    const pts0 = Array.isArray(loop) ? loop : [];
    if (pts0.length < 4) return pts0;

    const bb = bboxOfLoop(pts0);
    const diag = (bb && Number.isFinite(bb.maxX) && Number.isFinite(bb.maxY))
      ? Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY)
      : 0;

    // 自适应容差（坐标单位通常为 m）：2cm ~ 20cm
    const tol = Math.max(0.02, Math.min(0.2, diag * 1e-4));
    const tol2 = tol * tol;

    const dist2 = (a, b) => {
      const dx = (Number(a?.x) - Number(b?.x));
      const dy = (Number(a?.y) - Number(b?.y));
      return dx * dx + dy * dy;
    };

    const removeShortEdges = (pts) => {
      const out = [];
      for (const p of pts) {
        if (!out.length) {
          out.push(p);
          continue;
        }
        if (dist2(out[out.length - 1], p) <= tol2) continue;
        out.push(p);
      }
      // 首尾也做一次短边合并（loop 不闭合表示）
      if (out.length >= 3 && dist2(out[0], out[out.length - 1]) <= tol2) out.pop();
      return out;
    };

    const removeNearCollinear = (pts) => {
      if (pts.length < 4) return pts;
      const out = [];
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n];
        const cur = pts[i];
        const next = pts[(i + 1) % n];
        const ax = Number(cur.x) - Number(prev.x);
        const ay = Number(cur.y) - Number(prev.y);
        const bx = Number(next.x) - Number(cur.x);
        const by = Number(next.y) - Number(cur.y);
        const cross = ax * by - ay * bx;
        const la2 = ax * ax + ay * ay;
        const lb2 = bx * bx + by * by;
        if (!(Number.isFinite(cross) && Number.isFinite(la2) && Number.isFinite(lb2))) {
          out.push(cur);
          continue;
        }
        // 两段都很短：认为是毛刺，删掉中间点
        if (la2 <= tol2 && lb2 <= tol2) continue;
        // 近共线：面积（cross）很小且两边长度足够
        const denom = Math.sqrt(la2) + Math.sqrt(lb2);
        const areaLike = Math.abs(cross) / (denom || 1);
        if (areaLike <= tol * 0.25) continue;
        out.push(cur);
      }
      return out.length >= 3 ? out : pts;
    };

    // Ramer–Douglas–Peucker（对闭合 ring：用“首点固定”的折线近似）
    const perpDist = (p, a, b) => {
      const px = Number(p.x);
      const py = Number(p.y);
      const ax = Number(a.x);
      const ay = Number(a.y);
      const bx = Number(b.x);
      const by = Number(b.y);
      const vx = bx - ax;
      const vy = by - ay;
      const wx = px - ax;
      const wy = py - ay;
      const vv = vx * vx + vy * vy;
      if (!(Number.isFinite(vv) && vv > 0)) return Math.hypot(wx, wy);
      const t = (wx * vx + wy * vy) / vv;
      const tt = Math.max(0, Math.min(1, t));
      const cx = ax + tt * vx;
      const cy = ay + tt * vy;
      return Math.hypot(px - cx, py - cy);
    };

    const rdp = (pts, eps) => {
      if (pts.length <= 2) return pts;
      let maxD = -1;
      let idx = -1;
      const a = pts[0];
      const b = pts[pts.length - 1];
      for (let i = 1; i < pts.length - 1; i++) {
        const d = perpDist(pts[i], a, b);
        if (d > maxD) {
          maxD = d;
          idx = i;
        }
      }
      if (maxD > eps && idx > 0) {
        const left = rdp(pts.slice(0, idx + 1), eps);
        const right = rdp(pts.slice(idx), eps);
        return left.slice(0, left.length - 1).concat(right);
      }
      return [a, b];
    };

    let pts = pts0;
    // 1) 去短边/重复点
    pts = removeShortEdges(pts);
    if (pts.length < 4) return pts;
    // 2) 去近共线（先做一轮能明显消刺）
    pts = removeNearCollinear(pts);
    if (pts.length < 4) return pts;

    // 3) RDP 简化（闭合 ring：拆成折线，首点固定）
    // 选择一个“最稳定”的起点：用 bbox 最左下角附近的点作为起点，减少旋转导致的输出差异
    const pickStart = () => {
      if (!bb) return 0;
      let best = 0;
      let bestScore = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const score = Math.abs(Number(p.x) - bb.minX) + Math.abs(Number(p.y) - bb.minY);
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      return best;
    };
    const s = pickStart();
    if (s > 0) pts = pts.slice(s).concat(pts.slice(0, s));

    const polyline = pts.concat([pts[0]]);
    const simplified = rdp(polyline, tol);
    // 去掉闭合点
    let out = simplified.slice(0, Math.max(0, simplified.length - 1));
    // 再做一轮短边/近共线收尾
    out = removeShortEdges(out);
    out = removeNearCollinear(out);
    return out.length >= 3 ? out : pts0;
  };

  // union 外轮廓专用：只做“极小尺度”的去短边/去近共线，不做 RDP，避免外轮廓与填充看起来不匹配。
  // 坐标单位通常为 m：默认只清理毫米~厘米级小刺。
  const cleanupUnionOutlineLoop = (loop) => {
    const pts0 = Array.isArray(loop) ? loop : [];
    if (pts0.length < 4) return pts0;
    const bb = bboxOfLoop(pts0);
    const diag = (bb && Number.isFinite(bb.maxX) && Number.isFinite(bb.maxY))
      ? Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY)
      : 0;
    // 2mm ~ 2cm
    const tol = Math.max(0.002, Math.min(0.02, diag * 5e-6));
    const tol2 = tol * tol;

    const dist2 = (a, b) => {
      const dx = (Number(a?.x) - Number(b?.x));
      const dy = (Number(a?.y) - Number(b?.y));
      return dx * dx + dy * dy;
    };

    const removeShortEdges = (pts) => {
      const out = [];
      for (const p of pts) {
        if (!out.length) { out.push(p); continue; }
        if (dist2(out[out.length - 1], p) <= tol2) continue;
        out.push(p);
      }
      if (out.length >= 3 && dist2(out[0], out[out.length - 1]) <= tol2) out.pop();
      return out;
    };

    const removeNearCollinear = (pts) => {
      if (pts.length < 4) return pts;
      const out = [];
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n];
        const cur = pts[i];
        const next = pts[(i + 1) % n];
        const ax = Number(cur.x) - Number(prev.x);
        const ay = Number(cur.y) - Number(prev.y);
        const bx = Number(next.x) - Number(cur.x);
        const by = Number(next.y) - Number(cur.y);
        const cross = ax * by - ay * bx;
        const la2 = ax * ax + ay * ay;
        const lb2 = bx * bx + by * by;
        if (!(Number.isFinite(cross) && Number.isFinite(la2) && Number.isFinite(lb2))) { out.push(cur); continue; }
        if (la2 <= tol2 && lb2 <= tol2) continue;
        const denom = Math.sqrt(la2) + Math.sqrt(lb2);
        const areaLike = Math.abs(cross) / (denom || 1);
        if (areaLike <= tol * 0.2) continue;
        out.push(cur);
      }
      return out.length >= 3 ? out : pts;
    };

    let pts = pts0;
    pts = removeShortEdges(pts);
    pts = removeNearCollinear(pts);
    pts = removeShortEdges(pts);
    return pts.length >= 3 ? pts : pts0;
  };

  // 更稳健的 loopKey：避免不同 loop 在裁剪缓存中发生碰撞，导致“切换候选后面重叠/毛刺”。
  const loopKeyForCache = (loop) => {
    const pts = Array.isArray(loop) ? loop : [];
    const n = pts.length;
    if (n < 3) return '';

    const bb = bboxOfLoop(pts);
    const q = (v) => {
      const x = Number(v);
      if (!Number.isFinite(x)) return 0;
      // 量化到 1e-3（≈1mm），兼顾稳定性与区分度
      return Math.round(x * 1000);
    };

    let h = 2166136261;
    const mix = (v) => {
      h ^= (v | 0);
      h = Math.imul(h, 16777619);
    };

    // bbox + 全点哈希（topK 裁剪规模小，允许更强 key 来换正确性）
    if (bb) {
      mix(q(bb.minX));
      mix(q(bb.minY));
      mix(q(bb.maxX));
      mix(q(bb.maxY));
    }
    mix(n);
    for (const p of pts) {
      mix(q(p?.x));
      mix(q(p?.y));
    }

    // 转无符号并输出
    const hu = (h >>> 0).toString(16);
    return `n=${n}|h=${hu}`;
  };

  // union 外轮廓去重用：把 loop 规范化为“起点/方向无关”的稳定序列。
  // 目的：防止相同外轮廓因起点不同/顺逆时针不同被重复绘制，造成边界短线/重线。
  const canonicalizeLoopForOutline = (loop) => {
    const pts0 = Array.isArray(loop) ? loop : [];
    const pts = pts0
      .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length < 3) return pts;

    const q = (v) => {
      const x = Number(v);
      if (!Number.isFinite(x)) return 0;
      return Math.round(x * 1000);
    };
    const lexLess = (a, b) => {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        const ax = q(a[i].x);
        const ay = q(a[i].y);
        const bx = q(b[i].x);
        const by = q(b[i].y);
        if (ax !== bx) return ax < bx;
        if (ay !== by) return ay < by;
      }
      return a.length < b.length;
    };

    const rotateToMin = (arr) => {
      let best = 0;
      let bestX = q(arr[0].x);
      let bestY = q(arr[0].y);
      for (let i = 1; i < arr.length; i++) {
        const xi = q(arr[i].x);
        const yi = q(arr[i].y);
        if (xi < bestX || (xi === bestX && yi < bestY)) {
          best = i;
          bestX = xi;
          bestY = yi;
        }
      }
      return best > 0 ? arr.slice(best).concat(arr.slice(0, best)) : arr;
    };

    const fwd = rotateToMin(pts);
    const rev0 = pts.slice().reverse();
    const rev = rotateToMin(rev0);
    return lexLess(fwd, rev) ? fwd : rev;
  };

  const attachClippedFacesLoopsWorld = (cand, sharedOmegaPoly) => {
    if (!cand || !cand.render) return;

    const computeAndAttachUnionOutline = (facesLoopsWorld) => {
      try {
        const facesLoops = Array.isArray(facesLoopsWorld) ? facesLoopsWorld : [];
        if (!facesLoops.length) {
          cand.render.plannedUnionLoopsWorld = [];
          return;
        }
        const u = buildUnionFromFacesLoopsWorld(facesLoops);
        if (!u || u.isEmpty?.()) {
          cand.render.plannedUnionLoopsWorld = [];
          return;
        }
        const loops0 = polygonToLoops(u);
        const loops = Array.isArray(loops0) ? loops0 : [];
        // 注意：这里不要做 simplify，否则外轮廓会“改形”，与填充的面边界看起来不匹配。
        // 只做基础 sanitize（去重复点/去闭合点），保证渲染稳定。
        const seen = new Set();
        const out = [];
        for (const l0 of loops) {
          const l1 = cleanupUnionOutlineLoop(sanitizeLoopForRender(l0));
          if (!Array.isArray(l1) || l1.length < 3) continue;
          const canon = canonicalizeLoopForOutline(l1);
          if (!Array.isArray(canon) || canon.length < 3) continue;
          const k = loopKeyForCache(canon);
          if (k && seen.has(k)) continue;
          if (k) seen.add(k);
          out.push(canon);
        }
        cand.render.plannedUnionLoopsWorld = out;
      } catch {
        // ignore
      }
    };

    // 已经有裁剪结果则直接复用（避免重复裁剪）
    if (Array.isArray(cand?.render?.clippedFacesLoops) && cand.render.clippedFacesLoops.length) {
      cand.render.plannedWorkfaceLoopsWorld = cand.render.clippedFacesLoops;
      computeAndAttachUnionOutline(cand.render.clippedFacesLoops);
      return;
    }

    // 快速路径：严格包含生成的矩形无需裁剪，直接使用原矩形 loops。
    // 这能显著减少 topK 裁剪阶段的 JSTS intersection 开销，降低超时概率。
    if (cand?.render?.strictInsideOmega) {
      const rectLoops0 = Array.isArray(cand?.render?.rectLoops) ? cand.render.rectLoops : [];
      if (rectLoops0.length) {
        const clippedFacesLoops0 = rectLoops0
          .map((loop, idx) => ({ faceIndex: idx + 1, loop }))
          .filter((x) => Array.isArray(x?.loop) && x.loop.length >= 3);
        if (clippedFacesLoops0.length) {
          cand.render.clippedFacesLoops = clippedFacesLoops0;
          cand.render.plannedWorkfaceLoopsWorld = clippedFacesLoops0;
          computeAndAttachUnionOutline(clippedFacesLoops0);
        }
      }
      return;
    }

    const omegaPoly = sharedOmegaPoly || (() => {
      const omegaLoopsWorld = Array.isArray(cand?.render?.omegaLoops) ? cand.render.omegaLoops : [];
      const omegaLoop = omegaLoopsWorld.find((l) => Array.isArray(l) && l.length >= 3) || null;
      if (!omegaLoop) return null;
      const poly = buildJstsPolygonFromLoop(omegaLoop);
      return (poly && !poly.isEmpty?.()) ? poly : null;
    })();
    if (!omegaPoly) return;

    // bbox 预判：不相交则无需做 overlay
    let omegaBox = null;
    try {
      omegaBox = envToBox(omegaPoly.getEnvelopeInternal());
    } catch {
      omegaBox = null;
    }

    // 统一裁剪输入：优先使用 facesLoops（允许非矩形/分段变宽），否则回退到 rectLoops。
    const faces0 = Array.isArray(cand?.render?.facesLoops) ? cand.render.facesLoops : null;
    const rectLoops = Array.isArray(cand?.render?.rectLoops) ? cand.render.rectLoops : [];
    const faces = (Array.isArray(faces0) && faces0.length)
      ? faces0
        .map((x, idx) => ({ faceIndex: Number(x?.faceIndex ?? (idx + 1)), loop: x?.loop }))
        .filter((x) => Number.isFinite(Number(x?.faceIndex)) && Number(x.faceIndex) >= 1 && Array.isArray(x?.loop) && x.loop.length >= 3)
      : rectLoops
        .map((loop, idx) => ({ faceIndex: idx + 1, loop }))
        .filter((x) => Array.isArray(x?.loop) && x.loop.length >= 3);
    if (!faces.length) return;

    // 获取/创建该 omegaPoly 的子缓存
    let clipCache = null;
    try {
      clipCache = clipCacheByOmega.get(omegaPoly);
      if (!clipCache) {
        clipCache = new Map();
        clipCacheByOmega.set(omegaPoly, clipCache);
      }
    } catch {
      clipCache = null;
    }

    const clippedFacesLoops = [];
    for (const face of faces) {
      const faceIndex = Math.max(1, Math.round(Number(face?.faceIndex) || 1));
      const loop = face?.loop;
      if (!Array.isArray(loop) || loop.length < 3) continue;

      // 先用点集 bbox 过滤掉明显不相交的情况（省掉 build polygon + intersection）
      if (omegaBox) {
        const bb = bboxOfLoop(loop);
        if (bb && !bboxIntersects(
          { minX: bb.minX, maxX: bb.maxX, minY: bb.minY, maxY: bb.maxY },
          { minX: omegaBox.minX, maxX: omegaBox.maxX, minY: omegaBox.minY, maxY: omegaBox.maxY }
        )) {
          continue;
        }
      }

      // intersection 缓存：同一 omegaPoly 下，相同 loop 直接复用裁剪 loops
      const lk = clipCache ? loopKeyForCache(loop) : '';
      if (clipCache && lk && clipCache.has(lk)) {
        const cachedLoops = clipCache.get(lk);
        if (Array.isArray(cachedLoops) && cachedLoops.length) {
          for (const l of cachedLoops) {
            const sl = simplifyLoopForRender(sanitizeLoopForRender(l));
            if (sl.length >= 3) clippedFacesLoops.push({ faceIndex, loop: sl });
          }
        }
        continue;
      }

      const facePoly0 = buildJstsPolygonFromLoop(loop);
      if (!facePoly0 || facePoly0.isEmpty?.()) {
        if (clipCache && lk) clipCache.set(lk, []);
        continue;
      }
      let inter = null;
      try {
        inter = robustIntersection(omegaPoly, facePoly0);
      } catch {
        inter = null;
      }
      if (!inter || inter.isEmpty?.()) {
        if (clipCache && lk) clipCache.set(lk, []);
        continue;
      }
      const loops = polygonToLoops(inter);
      const loops0 = Array.isArray(loops) ? loops : [];
      const sanitized = loops0
        .map((l) => simplifyLoopForRender(sanitizeLoopForRender(l)))
        .filter((l) => Array.isArray(l) && l.length >= 3);
      if (clipCache && lk) clipCache.set(lk, sanitized);
      for (const l of sanitized) {
        if (Array.isArray(l) && l.length >= 3) clippedFacesLoops.push({ faceIndex, loop: l });
      }
    }

    if (clippedFacesLoops.length) {
      // 去重：同一 faceIndex 下可能因数值鲁棒性/缓存导致重复 loop（重复绘制会表现为“重叠面/颜色变深”）
      const seen = new Set();
      const uniq = [];
      for (const item of clippedFacesLoops) {
        const fi = Math.max(1, Math.round(Number(item?.faceIndex) || 1));
        const l = item?.loop;
        const lk = loopKeyForCache(l);
        const k = `${fi}|${lk}`;
        if (!lk || seen.has(k)) continue;
        seen.add(k);
        uniq.push({ faceIndex: fi, loop: l });
      }

      cand.render.clippedFacesLoops = uniq;
      // 统一：前端绘制优先使用 plannedWorkfaceLoopsWorld
      cand.render.plannedWorkfaceLoopsWorld = uniq;
      computeAndAttachUnionOutline(uniq);
    }
  };

  try {
    // 注意：即使触发 timeBudgetHit，也必须保证“选中/最优候选”有裁剪后的 loops，否则会画出 Ω 外蓝色。
    // v1.0（用户验收口径）：候选表展示必须全部为裁剪后形状，因此这里强制裁剪返回的 topK。
    for (const c of (candidates ?? [])) {
      attachClippedFacesLoopsWorld(c, sharedOmegaPoly);
    }
  } catch {
    // ignore
  }

  // === 诊断：union/填充 loops 的短边统计（用于排查煤柱边界“短线”）===
  const computeLoopStatsWorld = (loops, { shortEdgeM = 0.05 } = {}) => {
    const list = Array.isArray(loops) ? loops : [];
    let loopCount = 0;
    let pointCount = 0;
    let segCount = 0;
    let shortSegCount = 0;
    let minSegLen = Infinity;
    let minSegLenLoop = -1;
    let nanPointCount = 0;

    const dist = (a, b) => {
      const dx = Number(a?.x) - Number(b?.x);
      const dy = Number(a?.y) - Number(b?.y);
      return Math.hypot(dx, dy);
    };

    for (let li = 0; li < list.length; li++) {
      const loop = list[li];
      const pts = Array.isArray(loop) ? loop : [];
      const clean = pts
        .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
        .filter((p) => {
          const ok = Number.isFinite(p.x) && Number.isFinite(p.y);
          if (!ok) nanPointCount += 1;
          return ok;
        });
      if (clean.length < 2) continue;
      loopCount += 1;
      pointCount += clean.length;
      for (let i = 0; i < clean.length; i++) {
        const a = clean[i];
        const b = clean[(i + 1) % clean.length];
        const d = dist(a, b);
        if (!Number.isFinite(d)) continue;
        segCount += 1;
        if (d < minSegLen) {
          minSegLen = d;
          minSegLenLoop = li;
        }
        if (d <= shortEdgeM) shortSegCount += 1;
      }
    }

    return {
      loopCount,
      pointCount,
      segCount,
      shortEdgeM,
      shortSegCount,
      minSegLen: Number.isFinite(minSegLen) ? minSegLen : null,
      minSegLenLoop,
      nanPointCount,
    };
  };

  try {
    for (const cand of (candidates ?? [])) {
      if (!cand || !cand.render) continue;
      // union 外轮廓 loops：[[{x,y}...]]
      const unionLoops = Array.isArray(cand?.render?.plannedUnionLoopsWorld) ? cand.render.plannedUnionLoopsWorld : [];
      // fill 面 loops：[{faceIndex, loop:[{x,y}...]}]
      const faces = Array.isArray(cand?.render?.plannedWorkfaceLoopsWorld) ? cand.render.plannedWorkfaceLoopsWorld : [];
      const faceLoops = faces
        .map((f) => f?.loop)
        .filter((l) => Array.isArray(l) && l.length >= 2);

      // shortEdge 阈值用 5cm（对“煤柱边界短线”足够敏感），同时把 minSegLen 暴露给前端。
      cand.render.unionOutlineStats = computeLoopStatsWorld(unionLoops, { shortEdgeM: 0.05 });
      cand.render.fillLoopsStats = computeLoopStatsWorld(faceLoops, { shortEdgeM: 0.05 });
      cand.render.fillFaceCount = Array.isArray(faces) ? faces.length : 0;
      cand.render.unionLoopCount = Array.isArray(unionLoops) ? unionLoops.length : 0;
    }
  } catch {
    // ignore
  }

  function buildUnionFromFacesLoopsWorld(facesLoopsWorld) {
    let u = null;
    for (const face of facesLoopsWorld ?? []) {
      const loop = face?.loop;
      if (!Array.isArray(loop) || loop.length < 3) continue;
      const poly = buildJstsPolygonFromLoop(loop);
      if (!poly || poly.isEmpty?.()) continue;
      u = u ? (robustUnion(u, poly) || u.union?.(poly) || u) : poly;
    }
    return u;
  }

  const buildCoalPillarMaskWorld = ({ omegaPolyWorld, rectLoopsWorld, wsM, axis, thetaDeg }) => {
    const omegaPoly = omegaPolyWorld;
    const rectLoops = Array.isArray(rectLoopsWorld) ? rectLoopsWorld : [];
    const ws = Math.max(0, Number(wsM) || 0);
    if (!omegaPoly || omegaPoly.isEmpty?.() || !rectLoops.length || !(ws > 1e-6)) return { mask: null, area: 0, gapCount: 0, gapWidthSum: 0 };

    // 用 Ω 的包络作为“煤柱走廊”的横向范围，避免因为裁剪/端头形变导致煤柱被截断。
    let omegaBox = null;
    try {
      omegaBox = envToBox(omegaPoly.getEnvelopeInternal());
    } catch {
      omegaBox = null;
    }
    if (!omegaBox) return { mask: null, area: 0, gapCount: 0, gapWidthSum: 0 };

    // 以“相邻面之间的间隙”构造煤柱走廊：
    // 不能用 axis-aligned bbox 直接比 minY/maxY（有 theta 时 bbox 会重叠，导致煤柱漏遮挡）。
    // 改为在 (u=推进方向, v=横向方向) 坐标系里做投影：
    // - 先把每个 face 投影到 v，得到 [minT, maxT]
    // - 相邻 face 的间隙 (next.minT - prev.maxT) > 0 即视为煤柱区
    // - 在该 t 区间上构造贯通 strip（沿 u 方向跨越 Ω 包络），再与 Ω 相交。
    const ax = String(axis || 'x');
    const th = Number(thetaDeg);
    const thetaRad = (Number.isFinite(th) ? (th * Math.PI / 180) : 0);
    const cth = Math.cos(thetaRad);
    const sth = Math.sin(thetaRad);

    // 基础推进方向：axis=x => (1,0), axis=y => (0,1)
    const baseUx = (ax === 'y') ? 0 : 1;
    const baseUy = (ax === 'y') ? 1 : 0;
    // u = rotate(baseU, theta)
    const ux = baseUx * cth - baseUy * sth;
    const uy = baseUx * sth + baseUy * cth;
    // v = u 左法向（横向）
    const vx = -uy;
    const vy = ux;

    const dot = (p, x, y) => (Number(p?.x) * x + Number(p?.y) * y);
    const mulAdd = (s, t) => ({ x: ux * s + vx * t, y: uy * s + vy * t });

    // 用 Ω 的 axis-aligned 包络 corners 估计 u 投影范围（足够大即可）
    const corners = [
      { x: omegaBox.minX, y: omegaBox.minY },
      { x: omegaBox.minX, y: omegaBox.maxY },
      { x: omegaBox.maxX, y: omegaBox.minY },
      { x: omegaBox.maxX, y: omegaBox.maxY },
    ];
    let sMin = Infinity;
    let sMax = -Infinity;
    for (const p of corners) {
      const s = dot(p, ux, uy);
      if (!Number.isFinite(s)) continue;
      sMin = Math.min(sMin, s);
      sMax = Math.max(sMax, s);
    }
    if (!(Number.isFinite(sMin) && Number.isFinite(sMax) && sMax > sMin + 1e-6)) return { mask: null, area: 0, gapCount: 0, gapWidthSum: 0 };

    const faceBands = [];
    for (const loop of rectLoops) {
      if (!Array.isArray(loop) || loop.length < 3) continue;
      let tMin = Infinity;
      let tMax = -Infinity;
      for (const p of loop) {
        const t = dot(p, vx, vy);
        if (!Number.isFinite(t)) continue;
        tMin = Math.min(tMin, t);
        tMax = Math.max(tMax, t);
      }
      if (!(Number.isFinite(tMin) && Number.isFinite(tMax) && tMax > tMin + 1e-6)) continue;
      faceBands.push({ tMin, tMax });
    }
    if (faceBands.length < 2) return { mask: null, area: 0, gapCount: 0, gapWidthSum: 0 };
    faceBands.sort((a, b) => a.tMin - b.tMin);

    const minGap = Math.max(0.5, ws * 0.2);
    let gapCount = 0;
    let gapWidthSum = 0;
    let uMask = null;
    for (let i = 0; i < faceBands.length - 1; i++) {
      const a = faceBands[i];
      const b = faceBands[i + 1];
      const t0 = Number(a.tMax);
      const t1 = Number(b.tMin);
      if (!(Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 + minGap)) continue;
      gapCount += 1;
      gapWidthSum += Math.max(0, t1 - t0);

      const p1 = mulAdd(sMin, t0);
      const p2 = mulAdd(sMax, t0);
      const p3 = mulAdd(sMax, t1);
      const p4 = mulAdd(sMin, t1);
      const stripLoop = [p1, p2, p3, p4];
      const pillarRaw = buildJstsPolygonFromLoop(stripLoop);
      if (!pillarRaw || pillarRaw.isEmpty?.()) continue;
      const pillar = ensureValid(pillarRaw, 'pillarMask');
      const clipped = robustIntersection(omegaPoly, pillar);
      if (!clipped || clipped.isEmpty?.()) continue;
      uMask = uMask ? (robustUnion(uMask, clipped) || uMask.union?.(clipped) || uMask) : clipped;
    }

    if (!uMask || uMask.isEmpty?.()) return { mask: null, area: 0, gapCount, gapWidthSum };
    const a = Number(uMask.getArea?.());
    return { mask: uMask, area: (Number.isFinite(a) && a > 0) ? a : 0, gapCount, gapWidthSum };
  };

  const computeEffectiveCoverage = (cand) => {
    if (!IGNORE_COAL_PILLARS_IN_COVERAGE) return null;
    const omegaPoly = sharedOmegaPoly;
    if (!omegaPoly || omegaPoly.isEmpty?.()) return null;

    const rectLoops = Array.isArray(cand?.render?.rectLoops) ? cand.render.rectLoops : [];
    const facesLoops = Array.isArray(cand?.render?.clippedFacesLoops)
      ? cand.render.clippedFacesLoops
      : (Array.isArray(cand?.render?.plannedWorkfaceLoopsWorld) ? cand.render.plannedWorkfaceLoopsWorld : []);

    const ws = Math.max(0, Number(cand?.ws) || 0);
    const ax = String(cand?.axis ?? cand?.genes?.axis ?? originalAxis ?? 'x');
    const theta0 = Number(cand?.thetaDeg ?? cand?.metrics?.thetaDeg ?? 0);
    const { mask: pillarMask, area: pillarArea, gapCount: pillarGapCount, gapWidthSum: pillarGapWidthSum } = buildCoalPillarMaskWorld({ omegaPolyWorld: omegaPoly, rectLoopsWorld: rectLoops, wsM: ws, axis: ax, thetaDeg: theta0 });
    let omegaEff = omegaPoly;
    if (pillarMask && !pillarMask.isEmpty?.()) {
      const diff = robustDifference(omegaPoly, pillarMask);
      omegaEff = diff ? ensureValid(diff, 'omegaEff') : omegaPoly;
    }

    const omegaAreaEff0 = Number(omegaEff?.getArea?.());
    const omegaAreaEff = (Number.isFinite(omegaAreaEff0) && omegaAreaEff0 > 1e-9) ? omegaAreaEff0 : 0;
    if (!(omegaAreaEff > 1e-9)) {
      return {
        omegaAreaEff: 0,
        pillarArea,
        coveredAreaEff: 0,
        coverageRatioEff: 0,
        residualAreaEff: 0,
        omegaEff,
        residualPoly: null,
      };
    }

    const unionFaces = buildUnionFromFacesLoopsWorld(facesLoops);
    const inter = unionFaces ? robustIntersection(omegaEff, unionFaces) : null;
    const covered0 = Number(inter?.getArea?.());
    const coveredAreaEff = (Number.isFinite(covered0) && covered0 > 0) ? covered0 : 0;
    const coverageRatioEff = coveredAreaEff / omegaAreaEff;

    let residualPoly = null;
    if (unionFaces) {
      const r0 = robustDifference(omegaEff, unionFaces);
      residualPoly = r0 ? ensureValid(r0, 'residualEff') : null;
    } else {
      residualPoly = omegaEff;
    }
    const rA0 = Number(residualPoly?.getArea?.());
    const residualAreaEff = (Number.isFinite(rA0) && rA0 > 0) ? rA0 : 0;

    return {
      omegaAreaEff,
      pillarArea,
      pillarGapCount,
      pillarGapWidthSum,
      coveredAreaEff,
      coverageRatioEff,
      residualAreaEff,
      omegaEff,
      residualPoly,
    };
  };

  // 给返回的 topK 候选补齐“有效Ω/煤柱扣除后的覆盖率”诊断字段
  try {
    for (const c of (candidates ?? [])) {
      if (!c.render || typeof c.render !== 'object') c.render = {};

      // 口径统一（UI候选表）：保留 raw（不扣煤柱）字段用于表格展示/对比。
      // 注意：fullCover/补残煤/残煤轮廓仍使用 coverageRatioEff（扣煤柱有效Ω口径）。
      try {
        const rawCov0 = Number(c?.coverageRatio ?? c?.metrics?.coverageRatio);
        const rawInner0 = Number(c?.innerArea ?? c?.metrics?.innerArea ?? c?.metrics?.omegaArea ?? c?.omegaArea);
        const rawCovered0 = Number(c?.coveredArea ?? c?.metrics?.coveredArea ?? c?.metrics?.faceAreaTotal ?? c?.faceAreaTotal);
        c.coverageRatioRaw = (Number.isFinite(rawCov0) ? rawCov0 : null);
        c.innerAreaRaw = (Number.isFinite(rawInner0) ? rawInner0 : null);
        c.coveredAreaRaw = (Number.isFinite(rawCovered0) ? rawCovered0 : null);
        if (c.metrics && typeof c.metrics === 'object') {
          c.metrics.coverageRatioRaw = c.coverageRatioRaw;
          c.metrics.innerAreaRaw = c.innerAreaRaw;
          c.metrics.coveredAreaRaw = c.coveredAreaRaw;
        }
      } catch {
        // ignore
      }

      const eff = computeEffectiveCoverage(c);
      if (!eff) continue;
      c.coverageRatioEff = eff.coverageRatioEff;
      c.omegaAreaEff = eff.omegaAreaEff;
      c.pillarArea = eff.pillarArea;
      c.pillarGapCount = eff.pillarGapCount;
      c.pillarGapWidthSum = eff.pillarGapWidthSum;
      c.residualAreaEff = eff.residualAreaEff;
      // Scheme C：每个候选都带 residualLoopsWorld（至少 Top3 必须存在）。
      // 说明：这是“有效Ω口径（扣煤柱）”下的残煤区域轮廓。
      try {
        c.render.residualLoopsWorld = residualPolyToLoopsWorld(eff.residualPoly);
      } catch {
        c.render.residualLoopsWorld = [];
      }

      // 统一吨位口径：把“有效Ω（扣煤柱后的Ω）”也输出成 loops，供后端按前端最终展示结果计算。
      // 注意：有效Ω可能是 MultiPolygon，因此这里输出 list-of-loops。
      try {
        c.render.omegaEffLoopsWorld = residualPolyToLoopsWorld(eff.omegaEff);
      } catch {
        c.render.omegaEffLoopsWorld = [];
      }
      c.qualifiedFullCover = FULL_COVER_ENABLED ? Boolean(eff.coverageRatioEff >= FULL_COVER_MIN) : null;
      // 口径调整（2026-01-22）：fullCover 允许不达标，但在评分中扣分。
      // 因此这里不再用 fullCoverMin 覆盖 c.qualified（c.qualified 仍代表“硬约束/基础约束”是否满足）。

      // fullCover 口径下：用“有效Ω覆盖率”驱动排序/评分字段（compareByArea/scoreOf 都依赖 coverageRatio/efficiencyScore）
      if (FULL_COVER_ENABLED) {
        c.coverageRatio = eff.coverageRatioEff;
        c.efficiencyScore = eff.coverageRatioEff * 100;
        c.coveredArea = eff.coveredAreaEff;
        c.faceAreaTotal = eff.coveredAreaEff;
        c.innerArea = eff.omegaAreaEff;
        c.omegaArea = eff.omegaAreaEff;
        if (c.metrics && typeof c.metrics === 'object') {
          c.metrics.coverageRatio = eff.coverageRatioEff;
          c.metrics.efficiencyScore = eff.coverageRatioEff * 100;
          c.metrics.coveredArea = eff.coveredAreaEff;
          c.metrics.faceAreaTotal = eff.coveredAreaEff;
          c.metrics.innerArea = eff.omegaAreaEff;
          c.metrics.omegaArea = eff.omegaAreaEff;
        }
      }

      if (c.metrics && typeof c.metrics === 'object') {
        c.metrics.coverageRatioEff = eff.coverageRatioEff;
        c.metrics.omegaAreaEff = eff.omegaAreaEff;
        c.metrics.pillarArea = eff.pillarArea;
        c.metrics.pillarGapCount = eff.pillarGapCount;
        c.metrics.pillarGapWidthSum = eff.pillarGapWidthSum;
        c.metrics.residualAreaEff = eff.residualAreaEff;
        c.metrics.residualLoopsWorldCount = Array.isArray(c.render?.residualLoopsWorld) ? c.render.residualLoopsWorld.length : 0;
        c.metrics.omegaEffLoopsWorldCount = Array.isArray(c.render?.omegaEffLoopsWorld) ? c.render.omegaEffLoopsWorld.length : 0;
        c.metrics.qualifiedFullCover = c.qualifiedFullCover;
        // 同上：不再由 fullCover 覆盖 qualified。
      }

      // base+patched 双版本字段（默认：未补片）。
      if (!Object.prototype.hasOwnProperty.call(c, 'patchBudgetTier')) c.patchBudgetTier = PATCH_BUDGET_TIERS.NONE;
      if (!Object.prototype.hasOwnProperty.call(c, 'fullCoverAchieved_patched')) c.fullCoverAchieved_patched = null;
      if (!Object.prototype.hasOwnProperty.call(c, 'renderPatched')) c.renderPatched = null;
      if (c.metrics && typeof c.metrics === 'object' && !Object.prototype.hasOwnProperty.call(c.metrics, 'patchStats')) c.metrics.patchStats = null;
    }
  } catch {
    // ignore
  }

  // Scheme C：Top3 轻修补（LIGHT），不改变候选排序，不改 signature。
  // - 输出：renderPatched + patchBudgetTier + fullCoverAchieved_patched + metrics.patchStats
  // - base+patched 双版本：前端可先画 base，再异步替换 patched；patched 失败可回退 base。
  try {
    const MEDIUM_MS = FULL_COVER_PATCH_BUDGET_MS;
    const LIGHT_MS = clamp(Math.round(MEDIUM_MS * 0.25), 80, Math.min(800, MEDIUM_MS));
    const HIGH_MS = clamp(Math.round(MEDIUM_MS * 2.5), 300, 8000);

    const topN = Math.min(3, Math.max(0, candidates?.length ?? 0));
    for (let i = 0; i < topN; i++) {
      const c = candidates[i];
      if (!c || typeof c !== 'object') continue;
      if (!FULL_COVER_ENABLED || !FULL_COVER_PATCH_ENABLED || !IGNORE_COAL_PILLARS_IN_COVERAGE) continue;

      // 默认：LIGHT。前端点选候选时可用 refine 提升到 MEDIUM/HIGH。
      const patch = patchCandidateFullCover({
        cand: c,
        tier: PATCH_BUDGET_TIERS.LIGHT,
        fullCoverMin: FULL_COVER_MIN,
        ignoreCoalPillarsInCoverage: IGNORE_COAL_PILLARS_IN_COVERAGE,
        budgetMs: LIGHT_MS,
      });

      // 失败不应占用“已补”档位，避免后续 refine 被 ALREADY_REFINED 阻断。
      if (patch?.ok && patch?.renderPatched) c.patchBudgetTier = patch?.tier ?? PATCH_BUDGET_TIERS.LIGHT;
      c.fullCoverAchieved_patched = (Object.prototype.hasOwnProperty.call(patch ?? {}, 'fullCoverAchieved_patched'))
        ? patch.fullCoverAchieved_patched
        : null;
      if (patch?.ok && patch?.renderPatched) c.renderPatched = patch.renderPatched;
      if (c.metrics && typeof c.metrics === 'object') {
        c.metrics.patchStats = patch?.patchStats ?? null;
        c.metrics.patchBudgetMs = { light: LIGHT_MS, medium: MEDIUM_MS, high: HIGH_MS };
      }
    }
  } catch {
    // ignore
  }

  // bestSignature/bestKey：始终以排序后的 top1 为准（fullCoverPatch/cleanup 可能改变 top1）
  const bestSig = String(candidates?.[0]?.signature ?? '');

  // nRange 仅基于返回候选集
  const nValuesAll = Array.from(new Set(candidates.map((c) => Number(c?.N)).filter((n) => Number.isFinite(n) && n >= 1))).sort((a, b) => a - b);
  const nRange = nValuesAll.length
    ? { nMin: nValuesAll[0], nMax: nValuesAll[nValuesAll.length - 1], nValues: nValuesAll }
    : null;

  // bestKeyByN/candidatesByN/byN：兼容旧字段，但仅针对返回候选集
  const bestKeyByN = {};
  const candidatesByN = {};
  const byN = {};
  for (const n of nValuesAll) {
    const list = candidates.filter((c) => Number(c?.N) === n);
    list.sort(compareMain);
    const keys = list.map((c) => String(c?.signature ?? '')).filter(Boolean);
    candidatesByN[String(n)] = keys;
    bestKeyByN[String(n)] = String(list?.[0]?.signature ?? '');
    byN[String(n)] = { bestKey: bestKeyByN[String(n)], keys };
  }

  {
    // recoveryScore：在 TONNAGE 模式下做 0-100 归一化；AREA 模式下用 coverage 兜底
    const ts = (fallbackMode === 'TONNAGE')
      ? candidates
        .map((c) => Number(c?.tonnageTotal ?? c?.metrics?.tonnageTotal))
        .filter((v) => Number.isFinite(v))
      : [];
    const tMin = ts.length ? Math.min(...ts) : 0;
    const tMax = ts.length ? Math.max(...ts) : 0;
    for (const c of candidates) {
      const t = Number(c?.tonnageTotal ?? c?.metrics?.tonnageTotal);
      let score = 0;
      if (fallbackMode === 'TONNAGE' && Number.isFinite(t) && Number.isFinite(tMin) && Number.isFinite(tMax) && tMax > tMin + 1e-9) {
        score = 100 * ((t - tMin) / (tMax - tMin));
      } else if (fallbackMode === 'TONNAGE' && Number.isFinite(t) && Number.isFinite(tMin) && Number.isFinite(tMax) && Math.abs(tMax - tMin) <= 1e-9) {
        score = 100;
      } else {
        // AREA：口径改为“有效覆盖率%”（与面积优先排序一致，便于表格验收）
        const r = Number(c?.coverageRatio ?? c?.metrics?.coverageRatio);
        score = Number.isFinite(r) ? Math.max(0, Math.min(100, r * 100)) : 0;
      }
      c.recoveryScore = score;
      if (c.metrics) c.metrics.recoveryScore = score;
      // v1.0：补齐诊断字段（每个候选都带）
      c.hasThickness = hasThickness;
      c.fallbackMode = fallbackMode;
      c.thicknessReason = thicknessReason || (fallbackMode === 'AREA' ? THICKNESS_REASON.FALLBACK_AREA : '');
      if (c.metrics) {
        c.metrics.hasThickness = hasThickness;
        c.metrics.fallbackMode = fallbackMode;
        c.metrics.thicknessReason = c.thicknessReason;
      }
    }
  }

  const rows = candidates.map((c, idx) => ({
    rank: idx + 1,
    key: c.signature,
    signature: c.signature,
    N: c.N,
    B: c.B,
    BMin: (c.BMin ?? c.metrics?.BMin ?? null),
    BMax: (c.BMax ?? c.metrics?.BMax ?? null),
    wb: c.wb,
    wbFixedRaw,
    ws: c.ws,
    // UI候选表显示：raw 覆盖率（不扣煤柱）
    coverageRatioRaw: (Number.isFinite(Number(c.coverageRatioRaw)) ? Number(c.coverageRatioRaw) : null),
    coveragePct: (Number.isFinite(Number(c.coverageRatioRaw)) ? Number(c.coverageRatioRaw) : Number(c.coverageRatio)) * 100,
    // fullCover 判定/诊断：effective 覆盖率（扣煤柱有效Ω）
    coverageRatioEff: (Number.isFinite(Number(c.coverageRatioEff)) ? Number(c.coverageRatioEff) : null),
    coveragePctEff: (Number.isFinite(Number(c.coverageRatioEff)) ? Number(c.coverageRatioEff) * 100 : null),
    qualifiedFullCover: (Object.prototype.hasOwnProperty.call(c ?? {}, 'qualifiedFullCover') ? c.qualifiedFullCover : null),
    efficiencyScore: c.efficiencyScore,
    tonnageTotal: (c.tonnageTotal ?? c.metrics?.tonnageTotal ?? 0),
    recoveryScore: (c.recoveryScore ?? c.metrics?.recoveryScore ?? 0),
    qualified: Boolean(c.qualified),
    minL: (c.minL ?? c.metrics?.minL ?? null),
    maxL: (c.maxL ?? c.metrics?.maxL ?? null),
    meanL: (c.meanL ?? c.metrics?.meanL ?? null),
    abnormalFaceCount: (c.abnormalFaceCount ?? c.metrics?.abnormalFaceCount ?? null),
    abnormalFaceIndices: Array.isArray(c?.abnormalFaces)
      ? c.abnormalFaces.map((x) => Number(x?.faceIndex)).filter((v) => Number.isFinite(v) && v >= 1).join(',')
      : (Array.isArray(c?.metrics?.abnormalFaces)
        ? c.metrics.abnormalFaces.map((x) => Number(x?.faceIndex)).filter((v) => Number.isFinite(v) && v >= 1).join(',')
        : ''),
    innerArea: (Number.isFinite(Number(c.innerAreaRaw)) ? Number(c.innerAreaRaw) : c.innerArea),
    coveredArea: (Number.isFinite(Number(c.coveredAreaRaw)) ? Number(c.coveredAreaRaw) : c.coveredArea),
    fallbackMode,
    thicknessReason: thicknessReason || (fallbackMode === 'AREA' ? THICKNESS_REASON.FALLBACK_AREA : ''),
  }));

  return {
    ...responseBase,
    ok: true,
    mode: 'smart-resource',
    optMode,
    reqSeq,
    cacheKey,
    hasThickness,
    fallbackMode,
    thicknessReason: thicknessReason || (fallbackMode === 'AREA' ? THICKNESS_REASON.FALLBACK_AREA : ''),
    // 默认最优 key：工程效率评分最高
    bestKey: String(bestSig ?? ''),
    selectedCandidateKey: String(bestSig ?? ''),
    // 顶层主字段与 bestKey 对齐（便于 UI 直接读取）
    N: (candidates?.[0]?.N ?? best?.N ?? null),
    B: (candidates?.[0]?.B ?? best?.B ?? null),
    wb: (candidates?.[0]?.wb ?? best?.wb ?? null),
    ws: (candidates?.[0]?.ws ?? best?.ws ?? null),
    coverageRatio: Number.isFinite(Number(candidates?.[0]?.coverageRatio ?? best?.coverageRatio)) ? Number(candidates?.[0]?.coverageRatio ?? best?.coverageRatio) : null,
    efficiencyScore: Number.isFinite(Number(candidates?.[0]?.efficiencyScore ?? best?.efficiencyScore))
      ? Number(candidates?.[0]?.efficiencyScore ?? best?.efficiencyScore)
      : (Number.isFinite(Number(candidates?.[0]?.coverageRatio ?? best?.coverageRatio)) ? Number(candidates?.[0]?.coverageRatio ?? best?.coverageRatio) * 100 : null),
    tonnageTotal: Number.isFinite(Number(candidates?.[0]?.tonnageTotal ?? best?.tonnageTotal)) ? Number(candidates?.[0]?.tonnageTotal ?? best?.tonnageTotal) : 0,
    recoveryScore: Number.isFinite(Number(candidates?.[0]?.recoveryScore ?? best?.recoveryScore)) ? Number(candidates?.[0]?.recoveryScore ?? best?.recoveryScore) : 0,
    nRange,
    bestKeyByN,
    candidatesByN,
    byN,
    omegaRender: best?.omegaRender ?? responseBase.omegaRender,
    omegaArea: responseBase.omegaArea,
    bestSignature: String(bestSig ?? ''),
    warning: '',
    top1: {
      signature: String(bestSig ?? ''),
      key: String(bestSig ?? ''),
      N: (candidates?.[0]?.N ?? best?.N ?? null),
      B: (candidates?.[0]?.B ?? best?.B ?? null),
      wb: (candidates?.[0]?.wb ?? best?.wb ?? null),
      ws: (candidates?.[0]?.ws ?? best?.ws ?? null),
      coverageRatio: Number.isFinite(Number(candidates?.[0]?.coverageRatio ?? best?.coverageRatio)) ? Number(candidates?.[0]?.coverageRatio ?? best?.coverageRatio) : null,
      efficiencyScore: Number.isFinite(Number(candidates?.[0]?.efficiencyScore ?? best?.efficiencyScore))
        ? Number(candidates?.[0]?.efficiencyScore ?? best?.efficiencyScore)
        : (Number.isFinite(Number(candidates?.[0]?.coverageRatio ?? best?.coverageRatio)) ? Number(candidates?.[0]?.coverageRatio ?? best?.coverageRatio) * 100 : null),
      tonnageTotal: Number.isFinite(Number(candidates?.[0]?.tonnageTotal ?? best?.tonnageTotal)) ? Number(candidates?.[0]?.tonnageTotal ?? best?.tonnageTotal) : 0,
      recoveryScore: Number.isFinite(Number(candidates?.[0]?.recoveryScore ?? best?.recoveryScore)) ? Number(candidates?.[0]?.recoveryScore ?? best?.recoveryScore) : 0,
      hasThickness,
      fallbackMode,
      thicknessReason: thicknessReason || (fallbackMode === 'AREA' ? THICKNESS_REASON.FALLBACK_AREA : ''),
      coverageMin: COVERAGE_MIN,
      fullCover: FULL_COVER_ENABLED,
      fullCoverMin: FULL_COVER_MIN,
      ignoreCoalPillarsInCoverage: IGNORE_COAL_PILLARS_IN_COVERAGE,
      coverageRatioEff: Number.isFinite(Number(candidates?.[0]?.coverageRatioEff ?? best?.coverageRatioEff))
        ? Number(candidates?.[0]?.coverageRatioEff ?? best?.coverageRatioEff)
        : null,
      omegaAreaEff: Number.isFinite(Number(candidates?.[0]?.omegaAreaEff ?? best?.omegaAreaEff))
        ? Number(candidates?.[0]?.omegaAreaEff ?? best?.omegaAreaEff)
        : null,
      pillarArea: Number.isFinite(Number(candidates?.[0]?.pillarArea ?? best?.pillarArea))
        ? Number(candidates?.[0]?.pillarArea ?? best?.pillarArea)
        : null,
      residualAreaEff: Number.isFinite(Number(candidates?.[0]?.residualAreaEff ?? best?.residualAreaEff))
        ? Number(candidates?.[0]?.residualAreaEff ?? best?.residualAreaEff)
        : null,
      qualified: FULL_COVER_ENABLED
        ? Boolean((candidates?.[0]?.coverageRatio ?? best?.coverageRatio) >= COVERAGE_MIN)
        : Boolean((candidates?.[0]?.coverageRatio ?? best?.coverageRatio) >= COVERAGE_MIN),
    },
    stats: {
      candidateCount: (allCandidates ?? []).length,
      topK: candidates.length,
      nStar,
      bestCoverageRatio: Number(candidates?.[0]?.coverageRatio ?? best?.coverageRatio),
      bestEfficiencyScore: Number(candidates?.[0]?.efficiencyScore ?? best?.efficiencyScore),
      hasThickness,
      fallbackMode,
      thicknessReason: thicknessReason || (fallbackMode === 'AREA' ? THICKNESS_REASON.FALLBACK_AREA : ''),
      coverageMin: COVERAGE_MIN,
      fullCover: FULL_COVER_ENABLED,
      fullCoverMin: FULL_COVER_MIN,
      ignoreCoalPillarsInCoverage: IGNORE_COAL_PILLARS_IN_COVERAGE,
      qualifiedCount: qualifiedCandidates.length,
      fallbackCount: fallbackCandidates.length,
      usedFallback,
      partial,
      elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null,
    },
    candidates,
    debug: {
      boundaryNormalized: {
        pointCount: boundaryNorm.pointCount,
        closed: boundaryNorm.closed,
        area: boundaryNorm.area,
        isValid: true,
        fixedBy: baseValidated.fixedBy || '',
      },
      omega: omegaDebug0,
      strip: stripDebug,
      transform: { coordSpace: 'local', tx: offset.dx, ty: offset.dy },
      axis: originalAxis,
      internalAxis,
      swapXY,
      perFace: perFaceDebug,
    },
    table: {
      columns: [
        '序号',
        '方案选择',
        '工作面个数 N（个）',
        '工作面宽度 B（m）',
        '边界煤柱 w_b（m）',
        '区段煤柱 w_s（m）',
        '覆盖率（%）',
        '回采面积（㎡）',
        '总储量（t）',
        '资源回收评分（0-100）',
      ],
      rows,
    },
  };
};

// 预览模式：给“不可行 N（不在 bestKeyByN）”提供一个临时布局（不保证最优）。
// 约束：仍然只输出规则矩形（rectLoops），且必须满足 faceCount === targetN（严格N）。
const computePreview = (payload) => {
  const reqSeq = Number(payload?.reqSeq);
  const cacheKey = String(payload?.cacheKey ?? '');
  const originalAxis = String(payload?.axis ?? 'x') === 'y' ? 'y' : 'x';
  const internalAxis = 'x';
  const swapXY = originalAxis === 'y';
  const targetN = Math.max(1, Math.round(toNum(payload?.targetN) ?? toNum(payload?.N) ?? 1));

  const responseBase = {
    ok: false,
    preview: true,
    mode: 'smart-efficiency-preview',
    reqSeq,
    cacheKey,
    axis: originalAxis,
    targetN,
    message: '',
    failedReason: '',
    omegaRender: null,
    omegaArea: null,
    candidate: null,
    attemptSummary: {
      attemptedCombos: 0,
      feasibleCombos: 0,
      failTypes: {},
    },
  };

  const bumpFail = (code) => {
    const k = String(code || 'UNKNOWN');
    const cur = Number(responseBase.attemptSummary.failTypes[k] ?? 0);
    responseBase.attemptSummary.failTypes[k] = cur + 1;
  };

  const boundaryLoopWorldRaw = Array.isArray(payload?.boundaryLoopWorld) ? payload.boundaryLoopWorld : [];
  const boundaryLoopWorld = swapXY ? swapXYPoints(boundaryLoopWorldRaw) : boundaryLoopWorldRaw;
  if (boundaryLoopWorld.length < 3) {
    responseBase.failedReason = '采区边界点不足/退化';
    responseBase.message = responseBase.failedReason;
    bumpFail('BOUNDARY_TOO_FEW');
    return responseBase;
  }

  const DEFAULT_BMIN = 100;
  const DEFAULT_BMAX = 350;
  const faceWidthMinRaw = toNum(payload?.faceWidthMin);
  const faceWidthMaxRaw = toNum(payload?.faceWidthMax);
  const Bmin = Number.isFinite(faceWidthMinRaw) ? faceWidthMinRaw : DEFAULT_BMIN;
  const Bmax = Number.isFinite(faceWidthMaxRaw) ? faceWidthMaxRaw : DEFAULT_BMAX;
  if (!Number.isFinite(Bmin) || !Number.isFinite(Bmax) || Bmin <= 0 || Bmax <= 0 || Bmin > Bmax) {
    responseBase.failedReason = '工作面宽度范围输入非法（应为正数且 min<=max）';
    responseBase.message = responseBase.failedReason;
    bumpFail('INPUT_INVALID_B');
    return responseBase;
  }

  const wbFixed = Math.abs(Number(toNum(payload?.boundaryPillar) ?? payload?.boundaryPillarMin ?? payload?.boundaryPillarMax ?? 0) || 0);
  const wsMin = Math.max(0, Number(toNum(payload?.coalPillarMin) ?? 0) || 0);
  const wsMax = Math.max(0, Number(toNum(payload?.coalPillarMax) ?? wsMin) || 0);
  const faceAdvanceMax = toNum(payload?.faceAdvanceMax);

  const boundaryNorm = normalizeBoundaryPoints(boundaryLoopWorld, 1e-6);
  if (!boundaryNorm.ok) {
    responseBase.failedReason = boundaryNorm.reason;
    responseBase.message = boundaryNorm.reason;
    bumpFail('BOUNDARY_INVALID');
    return responseBase;
  }

  const baseLocal = buildPolygonLocalFromNormalized(boundaryNorm.points);
  if (!baseLocal.ok) {
    responseBase.failedReason = baseLocal.reason;
    responseBase.message = baseLocal.reason;
    bumpFail('BOUNDARY_BUILD_POLY_FAIL');
    return responseBase;
  }

  const baseValidated = validatePolygonLike(baseLocal.poly);
  if (!baseValidated.ok) {
    responseBase.failedReason = baseValidated.reason;
    responseBase.message = baseValidated.reason + (baseValidated.fixError ? `（${baseValidated.fixError}）` : '');
    bumpFail('BOUNDARY_SELF_INTERSECTION');
    return responseBase;
  }

  const basePolyLocal = baseValidated.poly;
  const offset = baseLocal.offset;

  // innerOmega（wb 固定）
  let inner = null;
  let innerErr = '';
  try {
    inner = BufferOp.bufferOp(basePolyLocal, -wbFixed);
  } catch (e) {
    inner = null;
    innerErr = String(e?.message ?? e);
  }
  if (innerErr) {
    responseBase.failedReason = `内缩失败：BufferOp异常: ${innerErr}`;
    responseBase.message = responseBase.failedReason;
    bumpFail('OMEGA_BUFFER_ERROR');
    return responseBase;
  }

  const innerPoly = fixPolygonSafe(pickLargestPolygon(inner));
  const innerArea = Number(innerPoly?.getArea?.());
  const omegaLoopsLocal = polygonToLoops(innerPoly);
  const omegaLoopsWorld = translateLoops(omegaLoopsLocal, offset.dx, offset.dy);
  if (!innerPoly || innerPoly.isEmpty?.() || !(Number.isFinite(innerArea) && innerArea > 1e-6) || !omegaLoopsWorld.length) {
    responseBase.failedReason = `内缩后可采区为空（wb=${wbFixed}m）`;
    responseBase.message = responseBase.failedReason;
    bumpFail('OMEGA_EMPTY');
    return responseBase;
  }
  const omegaLoopsWorldOut = swapXY ? swapXYLoops(omegaLoopsWorld) : omegaLoopsWorld;
  responseBase.omegaRender = { loops: omegaLoopsWorldOut };
  responseBase.omegaArea = innerArea;

  // span 用于估计 Bfit（2A）
  const env = innerPoly.getEnvelopeInternal();
  const span = internalAxis === 'x' ? (env.getMaxY() - env.getMinY()) : (env.getMaxX() - env.getMinX());
  if (!(Number.isFinite(span) && span > 1e-6)) {
    responseBase.failedReason = 'innerOmega 跨度退化';
    responseBase.message = responseBase.failedReason;
    bumpFail('OMEGA_SPAN_INVALID');
    return responseBase;
  }

  const wsSamples = sampleRange3(wsMin, wsMax);
  const deltaB = Math.max(5, Math.min(60, (Bmax - Bmin) / 6));

  let best = null;
  for (const ws of (wsSamples.length ? wsSamples : [wsMin])) {
    const wsNonNeg = Math.max(0, Number(ws) || 0);
    // 2A：按几何可容纳估计 Bfit
    const raw = (span - (targetN - 1) * wsNonNeg) / targetN;
    if (!(Number.isFinite(raw) && raw > 0)) {
      responseBase.attemptSummary.attemptedCombos += 1;
      bumpFail('BFIT_NONPOS');
      continue;
    }
    const Bfit = clamp(raw, Bmin, Bmax);
    const bList = uniqNums([
      Bfit,
      clamp(Bfit - deltaB, Bmin, Bmax),
      clamp(Bfit + deltaB, Bmin, Bmax),
      Bmin,
      clamp((Bmin + Bmax) / 2, Bmin, Bmax),
      Bmax,
    ], 1e-6);

    for (const B of bList) {
      responseBase.attemptSummary.attemptedCombos += 1;

      const built = buildDesignRectsForN({
        omegaPoly: innerPoly,
        axis: internalAxis,
        N: targetN,
        B,
        Ws: wsNonNeg,
        Lmax: faceAdvanceMax,
        includeClipped: false,
        bumpFail,
        debugRef: null,
        coordSpace: 'local',
      });

      const actualN = Math.max(0, Math.round(Number(built?.faceCount) || 0));
      if (actualN !== targetN) {
        bumpFail('PREVIEW_FACECOUNT_NEQ_TARGET');
        continue;
      }

      const rectLoopsLocal = Array.isArray(built?.rectLoopsLocal) ? built.rectLoopsLocal : [];
      if (!rectLoopsLocal.length) {
        bumpFail('RECTS_EMPTY');
        continue;
      }

      const rectAreaTotal = Number(built?.rectAreaTotal);
      if (!(Number.isFinite(rectAreaTotal) && rectAreaTotal > 1e-6)) {
        bumpFail('AREA_INVALID');
        continue;
      }
      const coverageRatio = rectAreaTotal / innerArea;
      if (!(Number.isFinite(coverageRatio) && coverageRatio >= 0)) {
        bumpFail('RATIO_INVALID');
        continue;
      }

      responseBase.attemptSummary.feasibleCombos += 1;

      const lengths = Array.isArray(built?.lengths) ? built.lengths : [];
      const sumL = lengths.reduce((s, x) => s + (Number.isFinite(Number(x)) ? Number(x) : 0), 0);
      const meanL = lengths.length ? sumL / lengths.length : 0;
      const stdL = lengths.length
        ? Math.sqrt(lengths.reduce((s, x) => {
          const v = Number(x);
          if (!Number.isFinite(v)) return s;
          const d = v - meanL;
          return s + d * d;
        }, 0) / lengths.length)
        : 0;
      const lenCV = meanL > 1e-9 ? stdL / meanL : 0;

      const signature = `${originalAxis}|wb=${wbFixed.toFixed(4)}|ws=${wsNonNeg.toFixed(4)}|N=${targetN}|B=${B.toFixed(4)}`;
      const candidate = {
        key: signature,
        signature,
        axis: originalAxis,
        wb: wbFixed,
        ws: wsNonNeg,
        N: targetN,
        B,
        preview: true,
        innerArea,
        coveredArea: rectAreaTotal,
        coverageRatio,
        efficiencyScore: coverageRatio * 100,
        lenCV,
        omegaRender: { loops: omegaLoopsWorldOut },
        render: {
          omegaLoops: omegaLoopsWorldOut,
          rectLoops: swapXY
            ? swapXYLoops(rectLoopsLocal.map((loop) => (loop ?? []).map((p) => ({ x: Number(p?.x) + offset.dx, y: Number(p?.y) + offset.dy }))))
            : rectLoopsLocal.map((loop) => (loop ?? []).map((p) => ({ x: Number(p?.x) + offset.dx, y: Number(p?.y) + offset.dy }))),
          clippedLoops: [],
        },
      };
      try {
        const facesLoopsWorld = candidate.render.rectLoops.map((loop, idx) => ({ faceIndex: idx + 1, loop }));
        candidate.render.facesLoops = facesLoopsWorld;
        candidate.render.plannedWorkfaceLoopsWorld = facesLoopsWorld;
      } catch {
        // ignore
      }

      if (!best) {
        best = candidate;
        continue;
      }
      if (candidate.coverageRatio > best.coverageRatio + 1e-12) best = candidate;
      else if (Math.abs(candidate.coverageRatio - best.coverageRatio) <= 1e-12) {
        if ((candidate.lenCV ?? 0) < (best.lenCV ?? 0) - 1e-12) best = candidate;
        else if (Math.abs((candidate.lenCV ?? 0) - (best.lenCV ?? 0)) <= 1e-12 && candidate.B > best.B + 1e-9) best = candidate;
      }
    }
  }

  if (!best) {
    responseBase.failedReason = `该N无法布置（严格N：faceCount 必须等于 ${targetN}）`;
    responseBase.message = responseBase.failedReason;
    return responseBase;
  }

  return {
    ...responseBase,
    ok: true,
    candidate: best,
    // 便于前端展示
    N: best.N,
    B: best.B,
    wb: best.wb,
    ws: best.ws,
    coverageRatio: best.coverageRatio,
    efficiencyScore: best.efficiencyScore,
  };
};

export { compute };

// ------------------------------
// Scheme C: base + patched (lazy)
// ------------------------------

const PATCH_BUDGET_TIERS = Object.freeze({
  NONE: 'NONE',
  LIGHT: 'LIGHT',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
});

const normalizePatchTier = (tierLike) => {
  const t = String(tierLike ?? '').toUpperCase().trim();
  if (t === PATCH_BUDGET_TIERS.LIGHT) return PATCH_BUDGET_TIERS.LIGHT;
  if (t === PATCH_BUDGET_TIERS.MEDIUM) return PATCH_BUDGET_TIERS.MEDIUM;
  if (t === PATCH_BUDGET_TIERS.HIGH) return PATCH_BUDGET_TIERS.HIGH;
  return PATCH_BUDGET_TIERS.NONE;
};

const tierRank = (tierLike) => {
  const t = normalizePatchTier(tierLike);
  if (t === PATCH_BUDGET_TIERS.LIGHT) return 1;
  if (t === PATCH_BUDGET_TIERS.MEDIUM) return 2;
  if (t === PATCH_BUDGET_TIERS.HIGH) return 3;
  return 0;
};

const nowMsWorker = () => {
  try {
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  } catch {
    return Date.now();
  }
};

const getOmegaPolyFromCandidate = (cand) => {
  try {
    const omegaLoopsWorld = Array.isArray(cand?.render?.omegaLoops) ? cand.render.omegaLoops : [];
    const omegaLoop = omegaLoopsWorld.find((l) => Array.isArray(l) && l.length >= 3) || null;
    if (!omegaLoop) return null;
    const poly = buildJstsPolygonFromLoop(omegaLoop);
    if (!poly || poly.isEmpty?.()) return null;
    return ensureValid(poly, 'omegaPolyWorld');
  } catch {
    return null;
  }
};

// Scheme C 独立渲染清洗工具（不可依赖 compute() 内部闭包函数）
const sanitizeLoopForRender_SC = (loop) => {
  const pts0 = Array.isArray(loop) ? loop : [];
  if (pts0.length < 3) return [];
  const EPS = 1e-4; // 0.1mm
  const out = [];
  for (const p of pts0) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - x) <= EPS && Math.abs(prev.y - y) <= EPS) continue;
    out.push({ x, y });
  }
  if (out.length >= 3) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS) out.pop();
  }
  return out.length >= 3 ? out : [];
};

const simplifyLoopForRender_SC = (loop) => {
  const pts0 = Array.isArray(loop) ? loop : [];
  if (pts0.length < 4) return pts0;
  const bb = bboxOfLoop(pts0);
  const diag = (bb && Number.isFinite(bb.maxX) && Number.isFinite(bb.maxY))
    ? Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY)
    : 0;
  const tol = Math.max(0.02, Math.min(0.2, diag * 1e-4));
  const tol2 = tol * tol;
  const dist2 = (a, b) => {
    const dx = (Number(a?.x) - Number(b?.x));
    const dy = (Number(a?.y) - Number(b?.y));
    return dx * dx + dy * dy;
  };
  const out = [];
  for (const p of pts0) {
    if (!out.length) {
      out.push(p);
      continue;
    }
    if (dist2(out[out.length - 1], p) <= tol2) continue;
    out.push(p);
  }
  if (out.length >= 3 && dist2(out[0], out[out.length - 1]) <= tol2) out.pop();
  return out.length >= 3 ? out : pts0;
};

const loopKeyForCache_SC = (loop) => {
  const pts = Array.isArray(loop) ? loop : [];
  if (pts.length < 3) return '';
  const parts = [];
  for (const p of pts) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    parts.push(`${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000}`);
  }
  return parts.join(';');
};

const cleanupUnionOutlineLoop_SC = (loop) => {
  const cleaned = simplifyLoopForRender_SC(sanitizeLoopForRender_SC(loop));
  return Array.isArray(cleaned) && cleaned.length >= 3 ? cleaned : [];
};

const canonicalizeLoopForOutline_SC = (loop) => {
  const pts0 = cleanupUnionOutlineLoop_SC(loop);
  if (!Array.isArray(pts0) || pts0.length < 3) return [];

  // 统一方向：使用 CCW（signed area > 0）
  const signedArea2 = (pts) => {
    let s = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      s += (Number(a?.x) * Number(b?.y) - Number(b?.x) * Number(a?.y));
    }
    return s;
  };

  let pts = pts0;
  const a2 = signedArea2(pts);
  if (Number.isFinite(a2) && a2 < 0) pts = [...pts].reverse();

  // 旋转到最小点开头，稳定 key
  let minIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const m = pts[minIdx];
    if (p.x < m.x || (p.x === m.x && p.y < m.y)) minIdx = i;
  }
  if (minIdx === 0) return pts;
  return pts.slice(minIdx).concat(pts.slice(0, minIdx));
};

const residualPolyToLoopsWorld = (residualPoly) => {
  try {
    const loops0 = polygonToLoops(residualPoly);
    const loops = Array.isArray(loops0) ? loops0 : [];
    const out = [];
    for (const l0 of loops) {
      if (!Array.isArray(l0) || l0.length < 3) continue;
      const l1 = simplifyLoopForRender_SC(sanitizeLoopForRender_SC(l0));
      if (Array.isArray(l1) && l1.length >= 3) out.push(l1);
    }
    return out;
  } catch {
    return [];
  }
};

const unionPolyFromLoopsWorld = (loopsWorld) => {
  try {
    const loops = Array.isArray(loopsWorld) ? loopsWorld : [];
    let u = null;
    for (const loop0 of loops) {
      const loop = Array.isArray(loop0) ? loop0 : (Array.isArray(loop0?.loop) ? loop0.loop : null);
      if (!Array.isArray(loop) || loop.length < 3) continue;
      const cleaned = simplifyLoopForRender_SC(sanitizeLoopForRender_SC(loop));
      if (!Array.isArray(cleaned) || cleaned.length < 3) continue;
      let poly = null;
      try {
        poly = buildJstsPolygonFromLoop(cleaned);
      } catch {
        poly = null;
      }
      if (!poly || poly.isEmpty?.()) continue;
      let p1 = poly;
      try {
        p1 = ensureValid(poly, 'loopsPoly');
      } catch {
        p1 = poly;
      }
      try {
        u = u ? (robustUnion(u, p1) || u.union?.(p1) || u) : p1;
      } catch {
        // 若 union 抛错，尽量保留已有 u
        u = u || p1;
      }
    }
    return u;
  } catch {
    return null;
  }
};

const computeEffectiveCoverageForCand = ({ cand, omegaPoly, ignoreCoalPillarsInCoverage }) => {
  try {
    if (!ignoreCoalPillarsInCoverage) return null;
    if (!omegaPoly || omegaPoly.isEmpty?.()) return null;

    const rectLoops = Array.isArray(cand?.render?.rectLoops) ? cand.render.rectLoops : [];
    const facesLoops = Array.isArray(cand?.render?.clippedFacesLoops)
      ? cand.render.clippedFacesLoops
      : (Array.isArray(cand?.render?.plannedWorkfaceLoopsWorld) ? cand.render.plannedWorkfaceLoopsWorld : []);
    const plannedUnionLoops = Array.isArray(cand?.render?.plannedUnionLoopsWorld) ? cand.render.plannedUnionLoopsWorld : [];
    const residualLoopsWorld = Array.isArray(cand?.render?.residualLoopsWorld) ? cand.render.residualLoopsWorld : [];

    const ws = Math.max(0, Number(cand?.ws) || 0);
    const ax = String(cand?.axis ?? cand?.genes?.axis ?? 'x');
    const theta0 = Number(cand?.thetaDeg ?? cand?.metrics?.thetaDeg ?? 0);
    let pillarMask = null;
    let pillarArea = 0;
    let pillarGapCount = 0;
    let pillarGapWidthSum = 0;
    try {
      const r = buildCoalPillarMaskWorld({
        omegaPolyWorld: omegaPoly,
        rectLoopsWorld: rectLoops,
        wsM: ws,
        axis: ax,
        thetaDeg: theta0,
      });
      pillarMask = r?.mask ?? null;
      pillarArea = Number(r?.area) || 0;
      pillarGapCount = Number(r?.gapCount) || 0;
      pillarGapWidthSum = Number(r?.gapWidthSum) || 0;
    } catch {
      pillarMask = null;
      pillarArea = 0;
      pillarGapCount = 0;
      pillarGapWidthSum = 0;
    }

    let omegaEff = omegaPoly;
    if (pillarMask && !pillarMask.isEmpty?.()) {
      try {
        const diff = robustDifference(omegaPoly, pillarMask);
        omegaEff = diff ? ensureValid(diff, 'omegaEff') : omegaPoly;
      } catch {
        omegaEff = omegaPoly;
      }
    }

    const omegaAreaEff0 = Number(omegaEff?.getArea?.());
    const omegaAreaEff = (Number.isFinite(omegaAreaEff0) && omegaAreaEff0 > 1e-9) ? omegaAreaEff0 : 0;
    if (!(omegaAreaEff > 1e-9)) {
      return {
        omegaAreaEff: 0,
        pillarArea,
        pillarGapCount,
        pillarGapWidthSum,
        coveredAreaEff: 0,
        coverageRatioEff: 0,
        residualAreaEff: 0,
        omegaEff,
        residualPoly: null,
      };
    }

    let unionFaces = null;
    try {
      unionFaces = buildUnionFromFacesLoopsWorld(facesLoops);
    } catch {
      unionFaces = null;
    }
    if (!unionFaces || unionFaces.isEmpty?.()) {
      // facesLoops 失败时，尝试用 union 外轮廓（渲染用 loops）重建
      const u2 = unionPolyFromLoopsWorld(plannedUnionLoops);
      unionFaces = u2 || unionFaces;
    }

    let inter = null;
    try {
      inter = unionFaces ? robustIntersection(omegaEff, unionFaces) : null;
    } catch {
      inter = null;
    }
    const covered0 = Number(inter?.getArea?.());
    const coveredFallback = Number(cand?.coveredAreaEff ?? cand?.coveredArea ?? cand?.metrics?.coveredAreaEff ?? cand?.metrics?.coveredArea ?? 0);
    const coveredAreaEff = (Number.isFinite(covered0) && covered0 > 0)
      ? covered0
      : ((Number.isFinite(coveredFallback) && coveredFallback > 0) ? coveredFallback : 0);
    const coverageRatioEff = coveredAreaEff / omegaAreaEff;

    let residualPoly = null;
    if (unionFaces) {
      try {
        const r0 = robustDifference(omegaEff, unionFaces);
        residualPoly = r0 ? ensureValid(r0, 'residualEff') : null;
      } catch {
        residualPoly = null;
      }
    }
    if (!residualPoly || residualPoly.isEmpty?.()) {
      // difference 失败时，尝试用 render.residualLoopsWorld 重建 residual
      const r2 = unionPolyFromLoopsWorld(residualLoopsWorld);
      residualPoly = r2 || residualPoly;
    }
    if (!residualPoly || residualPoly.isEmpty?.()) {
      // 最差兜底：用 omegaEff（残煤可能被高估，但避免 eff0 直接 null）
      residualPoly = omegaEff;
    }
    const rA0 = Number(residualPoly?.getArea?.());
    const residualAreaEff = (Number.isFinite(rA0) && rA0 > 0) ? rA0 : 0;

    return {
      omegaAreaEff,
      pillarArea,
      pillarGapCount,
      pillarGapWidthSum,
      coveredAreaEff,
      coverageRatioEff,
      residualAreaEff,
      omegaEff,
      residualPoly,
    };
  } catch {
    // 重要：patchCandidateFullCover 依赖 eff0，不允许这里直接返回 null（否则上层只有 EFF0_NULL）。
    try {
      const omegaAreaEff0 = Number(omegaPoly?.getArea?.());
      const omegaAreaEff = (Number.isFinite(omegaAreaEff0) && omegaAreaEff0 > 1e-9) ? omegaAreaEff0 : 0;
      const coverageFallback = Number(cand?.coverageRatioEff ?? cand?.coverageRatio ?? cand?.metrics?.coverageRatioEff ?? cand?.metrics?.coverageRatio ?? 0);
      const residualAreaFallback = Number(cand?.residualAreaEff ?? cand?.metrics?.residualAreaEff ?? 0);
      return {
        omegaAreaEff,
        pillarArea: 0,
        pillarGapCount: 0,
        pillarGapWidthSum: 0,
        coveredAreaEff: Math.max(0, omegaAreaEff * (Number.isFinite(coverageFallback) ? coverageFallback : 0)),
        coverageRatioEff: Number.isFinite(coverageFallback) ? coverageFallback : 0,
        residualAreaEff: Number.isFinite(residualAreaFallback) ? residualAreaFallback : 0,
        omegaEff: omegaPoly,
        residualPoly: omegaPoly,
      };
    } catch {
      return {
        omegaAreaEff: 0,
        pillarArea: 0,
        pillarGapCount: 0,
        pillarGapWidthSum: 0,
        coveredAreaEff: 0,
        coverageRatioEff: 0,
        residualAreaEff: 0,
        omegaEff: omegaPoly,
        residualPoly: omegaPoly,
      };
    }
  }
};

const patchCandidateFullCover = ({
  cand,
  tier,
  fullCoverMin,
  ignoreCoalPillarsInCoverage,
  budgetMs,
}) => {
  const t0 = nowMsWorker();
  const tierNorm = normalizePatchTier(tier);
  const maxMs = Math.max(0, Math.round(Number(budgetMs) || 0));

  const mkFail = (reason) => ({
    ok: false,
    tier: tierNorm,
    fullCoverAchieved_patched: null,
    renderPatched: null,
    patchStats: {
      ok: false,
      tier: tierNorm,
      budgetMs: maxMs,
      elapsedMs: Math.max(0, nowMsWorker() - t0),
      reason: String(reason || 'PATCH_FAILED'),
      residualAreaBefore: null,
      residualAreaAfter: null,
      coverageBefore: null,
      coverageAfter: null,
      patchLoopCount: 0,
    },
  });

  if (!cand || typeof cand !== 'object') return mkFail('CAND_NULL');
  if (tierNorm === PATCH_BUDGET_TIERS.NONE) return mkFail('TIER_NONE');

  const omegaPoly = getOmegaPolyFromCandidate(cand);
  if (!omegaPoly) return mkFail('OMEGA_POLY_MISSING');

  const eff0 = computeEffectiveCoverageForCand({ cand, omegaPoly, ignoreCoalPillarsInCoverage });
  if (!eff0) return mkFail('EFF0_NULL');
  const coverage0 = Number(eff0.coverageRatioEff);
  const residual0 = Number(eff0.residualAreaEff);
  const omegaAreaEff0 = Number(eff0.omegaAreaEff);
  const omegaAreaEff = (Number.isFinite(omegaAreaEff0) && omegaAreaEff0 > 1e-9) ? omegaAreaEff0 : 0;
  const residualRatio0 = omegaAreaEff > 1e-12 && Number.isFinite(residual0) ? Math.max(0, residual0 / omegaAreaEff) : 0;
  const residualNegligible = (Number.isFinite(residual0) ? residual0 : 0) <= 1e-6 || residualRatio0 <= 1e-6;

  // 注意：fullCoverMin 允许少量残煤（例如 0.995 => 0.5%），但用户会在图上“看见”。
  // 因此：只有在“残煤可忽略”时才提前返回；否则即便 coverage 已达标也继续尝试补片。
  if (Number.isFinite(coverage0) && coverage0 >= fullCoverMin && residualNegligible) {
    return {
      ok: true,
      tier: tierNorm,
      fullCoverAchieved_patched: true,
      renderPatched: {
        ...(cand?.render && typeof cand.render === 'object' ? cand.render : {}),
        residualLoopsWorld: [],
      },
      patchStats: {
        ok: true,
        tier: tierNorm,
        budgetMs: maxMs,
        elapsedMs: Math.max(0, nowMsWorker() - t0),
        reason: 'ALREADY_FULL_COVER',
        residualAreaBefore: residual0,
        residualAreaAfter: residual0,
        coverageBefore: coverage0,
        coverageAfter: coverage0,
        patchLoopCount: 0,
      },
    };
  }
  if (!(Number.isFinite(residual0) && residual0 > 1e-6) || !eff0.residualPoly || eff0.residualPoly.isEmpty?.()) {
    return mkFail('RESIDUAL_EMPTY');
  }

  const deadline = t0 + Math.max(0, maxMs);
  const exceeded = () => nowMsWorker() > deadline;

  const facesLoops0 = Array.isArray(cand?.render?.clippedFacesLoops)
    ? cand.render.clippedFacesLoops
    : (Array.isArray(cand?.render?.plannedWorkfaceLoopsWorld) ? cand.render.plannedWorkfaceLoopsWorld : []);
  if (!facesLoops0.length) return mkFail('FACES_LOOPS_EMPTY');

  const faceGeomByIndex = new Map();
  const faceBoxByIndex = new Map();
  for (const f of facesLoops0) {
    const fi = Math.max(1, Math.round(Number(f?.faceIndex) || 1));
    const loop = f?.loop;
    if (!Array.isArray(loop) || loop.length < 3) continue;
    const poly = buildJstsPolygonFromLoop(loop);
    if (!poly || poly.isEmpty?.()) continue;

    const prevG = faceGeomByIndex.get(fi);
    faceGeomByIndex.set(fi, prevG ? (robustUnion(prevG, poly) || prevG.union?.(poly) || prevG) : poly);

    const bb = bboxOfLoop(loop);
    if (!bb) continue;
    const prevB = faceBoxByIndex.get(fi);
    if (!prevB) {
      faceBoxByIndex.set(fi, { ...bb });
    } else {
      prevB.minX = Math.min(prevB.minX, bb.minX);
      prevB.maxX = Math.max(prevB.maxX, bb.maxX);
      prevB.minY = Math.min(prevB.minY, bb.minY);
      prevB.maxY = Math.max(prevB.maxY, bb.maxY);
    }
  }

  const faceIndices = Array.from(faceBoxByIndex.keys()).sort((a, b) => a - b);
  if (!faceIndices.length) return mkFail('FACE_INDEX_EMPTY');

  // 关键优化：不要依赖 residualPoly -> loops（差分后 ring 可能退化/异常，导致 loops 为空）。
  // 直接遍历 residualPoly 的 Polygon 子几何，按质心分配到最近工作面。
  const residualPolys = geomToPolygons(eff0.residualPoly).filter((g) => g && !g.isEmpty?.());
  if (!residualPolys.length) return mkFail('RESIDUAL_POLYS_EMPTY');

  const patchPolyByFace = new Map();
  const pickNearestFace = (pt) => {
    let bestFi = faceIndices[0];
    let bestD2 = Infinity;
    for (const fi of faceIndices) {
      const bb = faceBoxByIndex.get(fi);
      if (!bb) continue;
      const cx = (Number(bb.minX) + Number(bb.maxX)) / 2;
      const cy = (Number(bb.minY) + Number(bb.maxY)) / 2;
      const dx = Number(pt?.x) - cx;
      const dy = Number(pt?.y) - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestFi = fi;
      }
    }
    return bestFi;
  };

  for (const poly of residualPolys) {
    if (exceeded()) break;
    let pt = null;
    try {
      const c = poly.getCentroid?.();
      const cc = c?.getCoordinate?.();
      if (cc && Number.isFinite(cc.x) && Number.isFinite(cc.y)) pt = { x: Number(cc.x), y: Number(cc.y) };
    } catch {
      pt = null;
    }
    if (!pt) {
      try {
        const env = poly.getEnvelopeInternal?.();
        const bb = envToBox(env);
        if (bb) pt = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
      } catch {
        pt = null;
      }
    }
    if (!pt) continue;

    const fi = pickNearestFace(pt);
    const prev = patchPolyByFace.get(fi);
    patchPolyByFace.set(fi, prev ? (robustUnion(prev, poly) || prev.union?.(poly) || prev) : poly);
  }

  const patchedFacesLoops = [];
  let patchLoopCount = 0;
  for (const fi of faceIndices) {
    const g0 = faceGeomByIndex.get(fi);
    if (!g0 || g0.isEmpty?.()) continue;
    const p = patchPolyByFace.get(fi);
    const g1 = p ? (robustUnion(g0, p) || g0.union?.(p) || g0) : g0;
    const g = ensureValid(g1, 'faceMerge');
    const loops = polygonToLoops(g);
    for (const l of loops ?? []) {
      if (!Array.isArray(l) || l.length < 3) continue;
      const sl = simplifyLoopForRender_SC(sanitizeLoopForRender_SC(l));
      if (Array.isArray(sl) && sl.length >= 3) {
        patchedFacesLoops.push({ faceIndex: fi, loop: sl });
        if (p) patchLoopCount += 1;
      }
    }
  }
  if (!patchedFacesLoops.length) return mkFail('PATCH_FACES_EMPTY');

  let plannedUnionLoopsWorldPatched = [];
  try {
    const u = buildUnionFromFacesLoopsWorld(patchedFacesLoops);
    if (u && !u.isEmpty?.()) {
      const loopsU0 = polygonToLoops(u);
      const loopsU = Array.isArray(loopsU0) ? loopsU0 : [];
      const seen = new Set();
      const out = [];
      for (const l0 of loopsU) {
        const l1 = cleanupUnionOutlineLoop_SC(l0);
        if (!Array.isArray(l1) || l1.length < 3) continue;
        const canon = canonicalizeLoopForOutline_SC(l1);
        if (!Array.isArray(canon) || canon.length < 3) continue;
        const k = loopKeyForCache_SC(canon);
        if (k && seen.has(k)) continue;
        if (k) seen.add(k);
        out.push(canon);
      }
      plannedUnionLoopsWorldPatched = out;
    }
  } catch {
    plannedUnionLoopsWorldPatched = [];
  }

  const tmp = {
    ...cand,
    render: {
      ...(cand?.render && typeof cand.render === 'object' ? cand.render : {}),
      clippedFacesLoops: patchedFacesLoops,
      plannedWorkfaceLoopsWorld: patchedFacesLoops,
      plannedUnionLoopsWorld: plannedUnionLoopsWorldPatched,
    },
  };
  const eff1 = computeEffectiveCoverageForCand({ cand: tmp, omegaPoly, ignoreCoalPillarsInCoverage });
  if (!eff1) return mkFail('EFF1_NULL');

  const coverage1 = Number(eff1.coverageRatioEff);
  const improved = Number.isFinite(coverage0) && Number.isFinite(coverage1)
    ? (coverage1 > coverage0 + 1e-9)
    : false;
  if (!improved) return mkFail('NO_IMPROVEMENT');

  const fullCoverAchieved = Number.isFinite(coverage1) ? Boolean(coverage1 >= fullCoverMin) : false;
  const residualLoopsWorld = residualPolyToLoopsWorld(eff1.residualPoly);

  return {
    ok: true,
    tier: tierNorm,
    fullCoverAchieved_patched: fullCoverAchieved,
    renderPatched: {
      ...(cand?.render && typeof cand.render === 'object' ? cand.render : {}),
      allowNonRectFaces: true,
      strictInsideOmega: false,
      clippedFacesLoops: patchedFacesLoops,
      plannedWorkfaceLoopsWorld: patchedFacesLoops,
      plannedUnionLoopsWorld: plannedUnionLoopsWorldPatched,
      residualLoopsWorld,
    },
    patchStats: {
      ok: true,
      tier: tierNorm,
      budgetMs: maxMs,
      elapsedMs: Math.max(0, nowMsWorker() - t0),
      reason: 'OK',
      residualAreaBefore: Number(eff0.residualAreaEff) || 0,
      residualAreaAfter: Number(eff1.residualAreaEff) || 0,
      coverageBefore: Number(eff0.coverageRatioEff) || 0,
      coverageAfter: Number(eff1.coverageRatioEff) || 0,
      patchLoopCount,
    },
  };
};

// cacheKey -> { result, bySig }
const smartResourceLastByCacheKey = new Map();

if (typeof self !== 'undefined') {
  self.onmessage = (e) => {
    const data = e?.data ?? {};
    const type = String(data?.type ?? '');
    const payload = data?.payload ?? {};

    if (type === 'compute') {
      try {
        const result = compute(payload);
        // cache：用于后续 refine（点选候选自动补残煤/加预算）。
        try {
          if (result?.ok && String(result?.cacheKey ?? '')) {
            const cacheKey = String(result.cacheKey);
            const bySig = new Map();
            for (const c of (result?.candidates ?? [])) {
              const sig = String(c?.signature ?? '');
              if (sig) bySig.set(sig, c);
            }
            smartResourceLastByCacheKey.set(cacheKey, {
              ts: Date.now(),
              result,
              bySig,
            });
          }
        } catch {
          // ignore cache failures
        }

        self.postMessage({ type: 'result', payload: result });
      } catch (err) {
        const msg = String(err?.message ?? err);
        self.postMessage({
          type: 'result',
          payload: {
            ok: false,
            reqSeq: payload?.reqSeq,
            cacheKey: String(payload?.cacheKey ?? ''),
            mode: 'smart-resource',
            message: msg,
            failedReason: msg,
            omegaRender: null,
            omegaArea: null,
            candidates: [],
            tonnageTotal: 0,
            attemptSummary: {
              attemptedCombos: 0,
              feasibleCombos: 0,
              failTypes: { EXCEPTION: 1 },
            },
          },
        });
      }
      return;
    }

    if (type === 'refine') {
      const cacheKey = String(payload?.cacheKey ?? '');
      const signature = String(payload?.signature ?? payload?.sig ?? '');
      const tier = normalizePatchTier(payload?.tier ?? payload?.patchBudgetTier ?? 'LIGHT');

      const entry = cacheKey ? smartResourceLastByCacheKey.get(cacheKey) : null;
      const cand = entry?.bySig?.get(signature) ?? null;

      const fullCoverMin = Number(entry?.result?.top1?.fullCoverMin ?? entry?.result?.stats?.fullCoverMin ?? payload?.fullCoverMin ?? 0.995);
      const ignorePillars = Boolean(entry?.result?.top1?.ignoreCoalPillarsInCoverage ?? entry?.result?.stats?.ignoreCoalPillarsInCoverage ?? payload?.ignoreCoalPillarsInCoverage ?? true);

      const mediumMs0 = Number(
        entry?.result?.candidates?.[0]?.metrics?.patchBudgetMs?.medium
        ?? payload?.fullCoverPatchMaxTimeMs
        ?? 1200
      );
      const mediumMs = clamp(Math.round(mediumMs0), 100, 8000);
      const lightMs = clamp(Math.round(mediumMs * 0.25), 80, Math.min(800, mediumMs));
      const highMs = clamp(Math.round(mediumMs * 2.5), 300, 8000);
      const budgetMs = (tier === PATCH_BUDGET_TIERS.HIGH)
        ? highMs
        : (tier === PATCH_BUDGET_TIERS.MEDIUM)
          ? mediumMs
          : lightMs;

      if (!entry || !entry?.result?.ok) {
        self.postMessage({
          type: 'refine-result',
          payload: {
            ok: false,
            cacheKey,
            signature,
            tier,
            reason: 'CACHE_MISS',
          },
        });
        return;
      }
      if (!cand) {
        self.postMessage({
          type: 'refine-result',
          payload: {
            ok: false,
            cacheKey,
            signature,
            tier,
            reason: 'CAND_NOT_FOUND',
          },
        });
        return;
      }

      try {
        const prevTier = String(cand?.patchBudgetTier ?? 'NONE');
        const prevOk = Boolean(cand?.renderPatched && (Array.isArray(cand?.renderPatched?.clippedFacesLoops) || Array.isArray(cand?.renderPatched?.plannedWorkfaceLoopsWorld)));
        if (prevOk && tierRank(prevTier) >= tierRank(tier)) {
          self.postMessage({
            type: 'refine-result',
            payload: {
              ok: true,
              cacheKey,
              signature,
              tier,
              reason: 'ALREADY_REFINED',
              candidatePatch: {
                signature,
                patchBudgetTier: cand?.patchBudgetTier ?? PATCH_BUDGET_TIERS.NONE,
                fullCoverAchieved_patched: (Object.prototype.hasOwnProperty.call(cand ?? {}, 'fullCoverAchieved_patched')) ? cand.fullCoverAchieved_patched : null,
                renderPatched: cand?.renderPatched ?? null,
                patchStats: cand?.metrics?.patchStats ?? null,
              },
            },
          });
          return;
        }

        const patch = patchCandidateFullCover({
          cand,
          tier,
          fullCoverMin: clamp(Number(fullCoverMin || 0.995), 0, 1),
          ignoreCoalPillarsInCoverage: ignorePillars,
          budgetMs,
        });

        // 只在成功产出 patched 渲染时提高 patchBudgetTier，失败不应阻断后续重试/加预算。
        if (patch?.ok && patch?.renderPatched) cand.patchBudgetTier = patch?.tier ?? tier;
        cand.fullCoverAchieved_patched = (Object.prototype.hasOwnProperty.call(patch ?? {}, 'fullCoverAchieved_patched'))
          ? patch.fullCoverAchieved_patched
          : null;
        if (patch?.ok && patch?.renderPatched) cand.renderPatched = patch.renderPatched;
        if (cand.metrics && typeof cand.metrics === 'object') {
          cand.metrics.patchStats = patch?.patchStats ?? null;
          cand.metrics.patchBudgetMs = { light: lightMs, medium: mediumMs, high: highMs };
        }

        self.postMessage({
          type: 'refine-result',
          payload: {
            ok: Boolean(patch?.ok),
            cacheKey,
            signature,
            tier,
            reason: patch?.patchStats?.reason ?? 'DONE',
            candidatePatch: {
              signature,
              patchBudgetTier: cand.patchBudgetTier,
              fullCoverAchieved_patched: cand.fullCoverAchieved_patched,
              renderPatched: cand.renderPatched,
              patchStats: cand?.metrics?.patchStats ?? null,
              patchBudgetMs: cand?.metrics?.patchBudgetMs ?? null,
            },
          },
        });
      } catch (err) {
        const msg = String(err?.message ?? err);
        self.postMessage({
          type: 'refine-result',
          payload: {
            ok: false,
            cacheKey,
            signature,
            tier,
            reason: msg,
          },
        });
      }
      return;
    }
  };
}
