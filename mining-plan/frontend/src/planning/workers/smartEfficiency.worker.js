import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import SnapIfNeededOverlayOp from 'jsts/org/locationtech/jts/operation/overlay/snap/SnapIfNeededOverlayOp.js';

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

const buildThicknessSampler = (thickness) => {
  const constantM = Number(thickness?.constantM);
  const pack = thickness?.fieldPack;
  const rho = Number(thickness?.rho);

  const rhoUse = (Number.isFinite(rho) && rho > 0) ? rho : 1;

  if (pack && Array.isArray(pack.field) && pack.field.length >= 2 && Array.isArray(pack.field[0]) && pack.field[0].length >= 2) {
    const grid = pack.field;
    const gridH = grid.length;
    const gridW = grid[0].length;
    const width = Number(pack.width ?? 320);
    const height = Number(pack.height ?? 220);
    const b = pack.bounds;

    if (b && [b.minX, b.maxX, b.minY, b.maxY].every((v) => Number.isFinite(Number(v)))) {
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

      return { kind: 'field', rho: rhoUse, sampleAt };
    }
  }

  if (Number.isFinite(constantM) && constantM > 0) {
    const v = constantM;
    return { kind: 'constant', rho: rhoUse, sampleAt: () => v };
  }

  return { kind: 'none', rho: rhoUse, sampleAt: () => null };
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
  if (!(Number.isFinite(B) && B > 0)) return emptyOut;
  if (!(Number.isFinite(Ws) && Ws >= 0)) return emptyOut;

  const omegaV = ensureValid(fixPolygonSafe(omegaPoly), 'omega', debugRef);
  if (!omegaV || omegaV.isEmpty?.()) return emptyOut;

  // 数值稳定：轻微收缩 omega 作为“严格包含”的安全壳，不改变工程口径。
  let omegaSafe = omegaV;
  try {
    const shrunk = BufferOp.bufferOp(omegaV, -0.01);
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
  const insideEps = Math.max(0.05, Math.min(1.0, 0.002 * Math.min(B, spanX, spanY)));

  const totalW = N * B + (N - 1) * Ws;
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
    const startGuess = bboxOmega.minY + margin / 2;

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
      for (let i = 0; i < N; i++) {
        const y0 = yStart0 + i * (B + Ws);
        const y1 = y0 + B;
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
            if (debugRef && !debugRef.rectOutsideSample) debugRef.rectOutsideSample = { axis, B, ws: Ws, N, y0, y1, x0, x1, insideEps, bboxOmega, coordSpace };
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

    const best = chooseBestStart(startMin, startMax, startGuess, buildForStart, fast ? 6 : 10);
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
  const startGuess = bboxOmega.minX + margin / 2;

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
    for (let i = 0; i < N; i++) {
      const x0 = xStart0 + i * (B + Ws);
      const x1 = x0 + B;
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
          if (debugRef && !debugRef.rectOutsideSample) debugRef.rectOutsideSample = { axis, B, ws: Ws, N, x0, x1, y0, y1, insideEps, bboxOmega, coordSpace };
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

  const best = chooseBestStart(startMin, startMax, startGuess, buildForStart, fast ? 6 : 10);
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
  const optMode = 'efficiency';
  const internalAxis = 'x';
  const swapXY = originalAxis === 'y';
  const fastMode = Boolean(payload?.fast);

  const nowMs = () => {
    try {
      return (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
    } catch {
      return Date.now();
    }
  };

  // fast 模式时间预算：保证切换轴向/煤柱范围时能快速返回
  const TIME_BUDGET_MS = fastMode ? 280 : Infinity;
  const deadlineMs = fastMode ? (nowMs() + TIME_BUDGET_MS) : Infinity;
  let timeBudgetHit = false;
  const timeExceeded = () => {
    if (!fastMode) return false;
    if (timeBudgetHit) return true;
    if (nowMs() > deadlineMs) {
      timeBudgetHit = true;
      return true;
    }
    return false;
  };

  // 覆盖率阈值：工程效率模式保留历史默认
  const COVERAGE_MIN = 0.70;

  const responseBase = {
    ok: false,
    fast: fastMode,
    failedReason: '',
    mode: 'smart-efficiency',
    optMode,
    reqSeq,
    cacheKey,
    axis: originalAxis,
    omegaRender: null,
    omegaArea: null,
    candidates: [],
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
    },
  };

  const bumpFail = (code) => {
    const k = String(code || 'UNKNOWN');
    const cur = Number(responseBase.attemptSummary.failTypes[k] ?? 0);
    responseBase.attemptSummary.failTypes[k] = cur + 1;
  };

  const boundaryLoopWorldRaw = Array.isArray(payload?.boundaryLoopWorld) ? payload.boundaryLoopWorld : [];
  const boundaryLoopWorld = swapXY ? swapXYPoints(boundaryLoopWorldRaw) : boundaryLoopWorldRaw;
  if (boundaryLoopWorldRaw.length < 3) {
    responseBase.failedReason = '采区边界点不足/退化';
    bumpFail('BOUNDARY_TOO_FEW');
    return { ...responseBase, message: '边界点不足，无法计算。' };
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
    };
  }

  const wbMin = toNum(payload?.boundaryPillarMin) ?? 0;
  const wbMax = toNum(payload?.boundaryPillarMax) ?? wbMin;

  const wsMin = toNum(payload?.coalPillarMin) ?? 0;
  const wsMax = toNum(payload?.coalPillarMax) ?? wsMin;

  const faceAdvanceMax = toNum(payload?.faceAdvanceMax);

  const topK = Math.max(1, Math.min(30, Math.round(toNum(payload?.topK) ?? 10)));

  const boundaryNorm = normalizeBoundaryPoints(boundaryLoopWorld, 1e-6);
  if (!boundaryNorm.ok) {
    responseBase.failedReason = boundaryNorm.reason;
    bumpFail('BOUNDARY_INVALID');
    return {
      ...responseBase,
      message: boundaryNorm.reason,
      debug: {
        boundaryNormalized: {
          pointCount: boundaryNorm.pointCount,
          closed: boundaryNorm.closed,
          area: boundaryNorm.area,
          isValid: false,
        },
      },
    };
  }

  const baseLocal = buildPolygonLocalFromNormalized(boundaryNorm.points);
  if (!baseLocal.ok) {
    responseBase.failedReason = baseLocal.reason;
    bumpFail('BOUNDARY_BUILD_POLY_FAIL');
    return {
      ...responseBase,
      message: baseLocal.reason,
      debug: {
        boundaryNormalized: {
          pointCount: boundaryNorm.pointCount,
          closed: boundaryNorm.closed,
          area: boundaryNorm.area,
          isValid: false,
        },
      },
    };
  }

  const baseValidated = validatePolygonLike(baseLocal.poly);
  if (!baseValidated.ok) {
    responseBase.failedReason = baseValidated.reason;
    bumpFail('BOUNDARY_SELF_INTERSECTION');
    return {
      ...responseBase,
      message: baseValidated.reason + (baseValidated.fixError ? `（${baseValidated.fixError}）` : ''),
      debug: {
        boundaryNormalized: {
          pointCount: boundaryNorm.pointCount,
          closed: boundaryNorm.closed,
          area: boundaryNorm.area,
          isValid: Boolean(baseValidated.isValid),
          fixedBy: baseValidated.fixedBy || '',
          fixError: baseValidated.fixError || '',
        },
      },
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
      debug: {
        boundaryNormalized: {
          pointCount: boundaryNorm.pointCount,
          closed: boundaryNorm.closed,
          area: boundaryNorm.area,
          isValid: true,
          fixedBy: baseValidated.fixedBy || '',
        },
        omega: omegaDebug0,
      },
    };
  }

  if (!omegaPoly0 || omegaPoly0.isEmpty?.() || !(Number.isFinite(omegaArea0) && omegaArea0 > 1e-6) || omegaLoopsWorld0.length === 0) {
    const reason = `内缩后可采区为空（wb=${wbMinUsed}m）`;
    responseBase.failedReason = reason;
    bumpFail('OMEGA_EMPTY');
    return {
      ...responseBase,
      message: reason,
      debug: {
        boundaryNormalized: {
          pointCount: boundaryNorm.pointCount,
          closed: boundaryNorm.closed,
          area: boundaryNorm.area,
          isValid: true,
          fixedBy: baseValidated.fixedBy || '',
        },
        omega: omegaDebug0,
      },
    };
  }

  // omega 成功：无论后续候选是否找到，都必须带回 omegaRender/omegaArea
  responseBase.omegaRender = { loops: omegaLoopsWorld0Out };
  responseBase.omegaArea = omegaArea0;

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
            },
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
            },
          };
        }
      }
    }
  } catch {
    // ignore sanity failures here; real strip stats below will show
  }

  // === 决策层规则：工程效率最优模式下 wb 固定，不做搜索/枚举 ===
  // 代表值：默认取输入范围均值（若前端已固定传入，则 min==max）。
  const wbFixedRaw = (Number.isFinite(Number(wbMin)) && Number.isFinite(Number(wbMax))) ? (Number(wbMin) + Number(wbMax)) / 2 : (Number.isFinite(Number(wbMin)) ? Number(wbMin) : 0);
  const wbSamples = [wbFixedRaw];
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

  const buildCandidateForFixedN = ({ innerPoly, innerArea, omegaLoops, wbUsed, wsNonNeg, N, B }) => {
    const built = buildDesignRectsForN({
      omegaPoly: innerPoly,
      axis: internalAxis,
      N,
      B,
      Ws: wsNonNeg,
      Lmax: faceAdvanceMax,
      includeClipped: false,
      bumpFail,
      debugRef: stripDebug,
      fast: fastMode,
      coordSpace: 'local',
    });

    const actualN = Math.max(0, Math.round(Number(built?.faceCount) || 0));
    if (!built || actualN < 1) return null;
    if (actualN !== N) {
      bumpFail('FACECOUNT_NEQ_TARGET');
      return null;
    }

    const rectLoopsLocal = Array.isArray(built?.rectLoopsLocal) ? built.rectLoopsLocal : [];
    if (!rectLoopsLocal.length) return null;

    const rectAreaTotal = Number(built?.rectAreaTotal);
    if (!(Number.isFinite(rectAreaTotal) && rectAreaTotal > 1e-6)) {
      bumpFail('FACE_UNION_EMPTY');
      return null;
    }

    const coverageRatio = rectAreaTotal / innerArea;
    if (!(Number.isFinite(coverageRatio) && coverageRatio >= 0)) {
      bumpFail('RATIO_INVALID');
      return null;
    }

    const lengths = Array.isArray(built?.lengths) ? built.lengths : [];
    const sumL = lengths.reduce((s, x) => s + (Number.isFinite(Number(x)) ? Number(x) : 0), 0);
    const minL = lengths.length ? Math.min(...lengths) : 0;
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

    const qualified = coverageRatio >= COVERAGE_MIN;
    const efficiencyScore = coverageRatio * 100;
    const signature = `${originalAxis}|wb=${wbUsed.toFixed(4)}|ws=${wsNonNeg.toFixed(4)}|N=${actualN}|B=${Number(B).toFixed(4)}`;

    const candidate = {
      key: signature,
      signature,
      axis: originalAxis,
      wb: wbUsed,
      ws: wsNonNeg,
      N: actualN,
      B,
      coverageMin: COVERAGE_MIN,
      qualified,
      lowCoverage: !qualified,
      efficiencyScore,
      minL,
      sumL,
      lenCV,
      genes: { axis: originalAxis, wb: wbUsed, ws: wsNonNeg, N: actualN, B, Nreq: N },
      metrics: {
        omegaArea: innerArea,
        faceAreaTotal: rectAreaTotal,
        coverageRatio,
        efficiencyScore,
        faceCount: actualN,
        faceCountRequested: N,
        minL,
        sumL,
        lenCV,
      },
      innerArea,
      coveredArea: rectAreaTotal,
      coverageRatio,
      efficiencyScore,
      omegaRender: {
        loops: omegaLoops,
      },
      render: {
        omegaLoops: omegaLoops,
        rectLoops: swapXY
          ? swapXYLoops(rectLoopsLocal.map((loop) => (loop ?? []).map((p) => ({ x: Number(p?.x) + offset.dx, y: Number(p?.y) + offset.dy }))))
          : rectLoopsLocal.map((loop) => (loop ?? []).map((p) => ({ x: Number(p?.x) + offset.dx, y: Number(p?.y) + offset.dy }))),
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
      candidate.render.plannedWorkfaceLoopsWorld = facesLoopsWorld;
    } catch {
      // ignore
    }

    return candidate;
  };

  const qualifiedCandidates = [];
  const fallbackCandidates = [];
  const allCandByKey = new Map();

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

    for (const ws of wsList) {
      if (timeExceeded()) break;
      const wsNonNeg = Math.max(0, Number(ws) || 0);

      // 用几何跨度推导“可放置的最大工作面数”，避免对固定 N 的硬匹配导致候选为 0。
      const computeNmax = (spanV, B, wsV) => {
        const s = Number(spanV);
        const b = Number(B);
        const w = Math.max(0, Number(wsV) || 0);
        if (!(Number.isFinite(s) && s > 0)) return 0;
        if (!(Number.isFinite(b) && b > 0)) return 0;
        // N*B + (N-1)*ws <= span  => N <= (span + ws) / (B + ws)
        return Math.floor((s + w) / (b + w));
      };

      // === 新策略：对每个 (ws,N) 做 B 的“两阶段搜索” ===
      // N 上限由 (Bmin, ws) 给出；对更大的 N，其可行 B 上限只会更小，可提前终止。
      const BminInt = Math.ceil(Bmin);
      const BmaxInt = Math.floor(Bmax);
      if (!(Number.isFinite(BminInt) && Number.isFinite(BmaxInt) && BmaxInt >= BminInt)) {
        bumpFail('B_RANGE_NO_INT');
        continue;
      }

      const NmaxAtBmin = computeNmax(span, BminInt, wsNonNeg);
      if (!(Number.isFinite(NmaxAtBmin) && NmaxAtBmin >= 1)) {
        bumpFail('NMAX_LT_1');
        continue;
      }
      const Ncap = Math.max(1, Math.min(fastMode ? 12 : 60, NmaxAtBmin));

      for (let Nreq = 1; Nreq <= Ncap; Nreq++) {
        if (timeExceeded()) break;
        const bUpperBySpan = (span - (Nreq - 1) * wsNonNeg) / Nreq;
        const Bupper = Math.min(BmaxInt, Math.floor(bUpperBySpan));
        if (!(Number.isFinite(Bupper) && Bupper >= BminInt)) {
          bumpFail('BUPPER_LT_BMIN');
          break;
        }

        // --- 粗搜 ---
        const coarseBs = genCoarseBs(BminInt, Bupper);
        const coarseCands = [];
        for (const B of coarseBs) {
          if (timeExceeded()) break;
          responseBase.attemptSummary.attemptedCombos += 1;
          responseBase.attemptSummary.Bsearch.coarseEvaluatedBCount += 1;
          const c = buildCandidateForFixedN({ innerPoly, innerArea, omegaLoops, wbUsed, wsNonNeg, N: Nreq, B });
          if (!c) continue;
          responseBase.attemptSummary.feasibleCombos += 1;
          pushCandidateUnique(c);
          coarseCands.push(c);
        }
        if (!coarseCands.length) continue;
        coarseCands.sort(compareWithinSameN);

        // 选 TopM 个“不同 B”的种子
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

        // --- 精修 ---
        if (DO_FINE) {
          for (const seedB of seeds) {
            if (timeExceeded()) break;
            const fineBs = genFineBs(seedB, BminInt, Bupper);
            for (const B of fineBs) {
              if (timeExceeded()) break;
              // 避免对 coarse 已算过的 B 重算
              if (seenB.has(String(B))) continue;
              responseBase.attemptSummary.attemptedCombos += 1;
              responseBase.attemptSummary.Bsearch.fineEvaluatedBCount += 1;
              const c = buildCandidateForFixedN({ innerPoly, innerArea, omegaLoops, wbUsed, wsNonNeg, N: Nreq, B });
              if (!c) continue;
              responseBase.attemptSummary.feasibleCombos += 1;
              pushCandidateUnique(c);
            }
          }
        }
      }
    }
  }

  responseBase.attemptSummary.timeBudgetHit = Boolean(timeBudgetHit);

  const allCandidates = qualifiedCandidates.length ? qualifiedCandidates : fallbackCandidates;

  if (!allCandidates.length) {
    const reason = lastInnerReason || '可采区已生成，但未找到满足当前参数范围的条带组合（请检查面宽/煤柱/区段煤柱范围）';
    responseBase.failedReason = reason;
    return {
      ...responseBase,
      message: reason,
      debug: {
        boundaryNormalized: {
          pointCount: boundaryNorm.pointCount,
          closed: boundaryNorm.closed,
          area: boundaryNorm.area,
          isValid: true,
          fixedBy: baseValidated.fixedBy || '',
        },
        omega: { ...omegaDebug0, ...(lastInnerDebug || {}) },
        strip: stripDebug,
        transform: { coordSpace: 'local', tx: offset.dx, ty: offset.dy },
      },
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

  const usedFallback = qualifiedCandidates.length === 0;
  const compareMain = compareByEfficiencyScore;
  const rankedAll = (allCandidates ?? []).slice().sort(compareMain);
  const best = rankedAll[0];
  const nStar = best.N;

  // === 方案C：一次计算覆盖全 N（尽量连续） ===
  // 为了让“工作面个数滑块”可切换而不重算：
  // - 必须返回 bestKeyByN（每个可行 N 的最优候选 key）
  // - candidates 至少包含每个 N 的 best 候选（否则前端无法按 key 切换）
  const bestByN = new Map();
  for (const c of rankedAll) {
    const n = Number(c?.N);
    if (!(Number.isFinite(n) && n >= 1)) continue;
    const cur = bestByN.get(n);
    if (!cur) {
      bestByN.set(n, c);
      continue;
    }
    // 每个 N：按当前模式的主排序口径选最优（稳定 tie-break）
    if (compareMain(c, cur) < 0) bestByN.set(n, c);
  }

  const nValuesAll = Array.from(bestByN.keys()).sort((a, b) => a - b);
  const nRange = nValuesAll.length
    ? { nMin: nValuesAll[0], nMax: nValuesAll[nValuesAll.length - 1], nValues: nValuesAll }
    : null;

  const bestKeyByN = {};
  for (const n of nValuesAll) {
    bestKeyByN[String(n)] = String(bestByN.get(n)?.signature ?? '');
  }

  // candidatesByN：给前端做可行刻度/吸附/展示（key 列表）
  // 默认按覆盖率 desc、lenCV asc、B desc
  const candidatesByN = {};
  for (const n of nValuesAll) {
    const list = rankedAll.filter((c) => Number(c?.N) === n);
    list.sort(compareMain);
    // 只回传 key 列表，避免 payload 过大
    candidatesByN[String(n)] = list.map((c) => String(c?.signature ?? '')).filter(Boolean);
  }

  // UI candidates：至少包含每个 N 的 best 候选
  // 额外 topK 仅作为“表格行数上限”的参考：若 topK < 可行 N 数，则仍需覆盖全 N。
  const candidates = [];
  const seen = new Set();
  const pushUnique = (c) => {
    if (!c) return;
    const k = String(c.signature ?? '');
    if (!k || seen.has(k)) return;
    seen.add(k);
    candidates.push(c);
  };
  // 保证全局最优一定出现在 UI candidates
  pushUnique(best);
  for (const n of nValuesAll) pushUnique(bestByN.get(n));

  // 如果仍想给表格一些“备选方案”，再补充少量高分项（不影响 bestKeyByN）
  const extraSlots = Math.max(0, Number(topK || 0) - candidates.length);
  if (extraSlots > 0) {
    const targetTotal = candidates.length + extraSlots;
    for (const c of rankedAll) {
      if (candidates.length >= targetTotal) break;
      pushUnique(c);
    }
  }

  // UI candidates 按当前模式排序（与表格一致）
  candidates.sort(compareMain);

  const rows = candidates.map((c, idx) => ({
    rank: idx + 1,
    key: c.signature,
    signature: c.signature,
    N: c.N,
    B: c.B,
    wb: c.wb,
    ws: c.ws,
    coveragePct: c.coverageRatio * 100,
    efficiencyScore: c.efficiencyScore,
    qualified: Boolean(c.qualified),
    innerArea: c.innerArea,
    coveredArea: c.coveredArea,
  }));

  // byN：兼容旧字段（结构与之前一致）
  const byN = {};
  for (const n of nValuesAll) {
    const keys = Array.isArray(candidatesByN[String(n)]) ? candidatesByN[String(n)] : [];
    byN[String(n)] = {
      bestKey: String(bestKeyByN[String(n)] ?? ''),
      keys,
    };
  }

  return {
    ...responseBase,
    ok: true,
    mode: 'smart-efficiency',
    optMode,
    reqSeq,
    cacheKey,
    // 默认最优 key：工程效率评分最高
    bestKey: String(best?.signature ?? ''),
    selectedCandidateKey: String(best?.signature ?? ''),
    // 顶层主字段与 bestKey 对齐（便于 UI 直接读取）
    N: best?.N ?? null,
    B: best?.B ?? null,
    wb: best?.wb ?? null,
    ws: best?.ws ?? null,
    coverageRatio: Number.isFinite(Number(best?.coverageRatio)) ? Number(best.coverageRatio) : null,
    efficiencyScore: Number.isFinite(Number(best?.efficiencyScore)) ? Number(best.efficiencyScore) : (Number.isFinite(Number(best?.coverageRatio)) ? Number(best.coverageRatio) * 100 : null),
    nRange,
    bestKeyByN,
    candidatesByN,
    byN,
    omegaRender: best?.omegaRender ?? responseBase.omegaRender,
    omegaArea: Number.isFinite(Number(best?.innerArea)) ? Number(best?.innerArea) : responseBase.omegaArea,
    bestSignature: best.signature,
    warning: (optMode === 'efficiency' && usedFallback) ? '未达到覆盖率阈值，已返回当前范围内覆盖率最高的方案' : '',
    top1: {
      signature: String(best?.signature ?? ''),
      key: String(best?.signature ?? ''),
      N: best?.N ?? null,
      B: best?.B ?? null,
      wb: best?.wb ?? null,
      ws: best?.ws ?? null,
      coverageRatio: Number.isFinite(Number(best?.coverageRatio)) ? Number(best.coverageRatio) : null,
      efficiencyScore: Number.isFinite(Number(best?.efficiencyScore)) ? Number(best.efficiencyScore) : (Number.isFinite(Number(best?.coverageRatio)) ? Number(best.coverageRatio) * 100 : null),
      coverageMin: COVERAGE_MIN,
      qualified: Boolean(best?.coverageRatio >= COVERAGE_MIN),
    },
    stats: {
      candidateCount: rankedAll.length,
      topK: candidates.length,
      nStar,
      bestCoverageRatio: best.coverageRatio,
      bestEfficiencyScore: best.efficiencyScore,
      coverageMin: COVERAGE_MIN,
      qualifiedCount: qualifiedCandidates.length,
      fallbackCount: fallbackCandidates.length,
      usedFallback,
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
        '可采区面积（㎡）',
        '回采面积（㎡）',
        '工程效率综合评分',
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

self.onmessage = (e) => {
  const data = e?.data ?? {};
  if (data?.type !== 'compute' && data?.type !== 'preview') return;
  const payload = data?.payload ?? {};
  try {
    if (data?.type === 'preview') {
      const result = computePreview(payload);
      self.postMessage({ type: 'preview', payload: result });
      return;
    }
    const result = compute(payload);
    self.postMessage({ type: 'result', payload: result });
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (data?.type === 'preview') {
      self.postMessage({
        type: 'preview',
        payload: {
          ok: false,
          preview: true,
          reqSeq: payload?.reqSeq,
          cacheKey: String(payload?.cacheKey ?? ''),
          mode: 'smart-efficiency-preview',
          message: msg,
          failedReason: msg,
          omegaRender: null,
          omegaArea: null,
          candidate: null,
          attemptSummary: {
            attemptedCombos: 0,
            feasibleCombos: 0,
            failTypes: { EXCEPTION: 1 },
          },
        },
      });
      return;
    }
    self.postMessage({
      type: 'result',
      payload: {
        ok: false,
        reqSeq: payload?.reqSeq,
        cacheKey: String(payload?.cacheKey ?? ''),
        mode: 'smart-efficiency',
        message: msg,
        failedReason: msg,
        omegaRender: null,
        omegaArea: null,
        candidates: [],
        attemptSummary: {
          attemptedCombos: 0,
          feasibleCombos: 0,
          failTypes: { EXCEPTION: 1 },
        },
      },
    });
  }
};
