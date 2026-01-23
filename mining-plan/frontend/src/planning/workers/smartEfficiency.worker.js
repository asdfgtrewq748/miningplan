import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import SnapIfNeededOverlayOp from 'jsts/org/locationtech/jts/operation/overlay/snap/SnapIfNeededOverlayOp.js';

const gf = new GeometryFactory();

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 覆盖率比较 epsilon：用于抑制几何运算带来的微小抖动，保证排序稳定。
// 约定：|a-b| <= eps 视为“同一档覆盖率”，再用次级指标 tie-break。
const COVERAGE_EPS = 1e-5;

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

const hash32FNV1a = (str) => {
  const s = String(str ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // eslint-disable-next-line no-bitwise
    h = (h * 0x01000193) >>> 0;
  }
  // eslint-disable-next-line no-bitwise
  return (h >>> 0).toString(16).padStart(8, '0');
};

const makeRng = (seedStr) => {
  let state = 0;
  try {
    const h = hash32FNV1a(seedStr);
    state = parseInt(h, 16) >>> 0;
  } catch {
    state = 123456789;
  }
  const nextU32 = () => {
    // xorshift32
    // eslint-disable-next-line no-bitwise
    state ^= state << 13;
    // eslint-disable-next-line no-bitwise
    state ^= state >>> 17;
    // eslint-disable-next-line no-bitwise
    state ^= state << 5;
    // eslint-disable-next-line no-bitwise
    return state >>> 0;
  };
  return {
    u01: () => nextU32() / 0xffffffff,
    int: (lo, hi) => {
      const a = Math.ceil(Number(lo));
      const b = Math.floor(Number(hi));
      if (!(Number.isFinite(a) && Number.isFinite(b) && b >= a)) return a;
      const r = nextU32();
      return a + (r % (b - a + 1));
    },
    pick: (arr) => {
      const a = Array.isArray(arr) ? arr : [];
      if (!a.length) return null;
      const idx = Math.floor((nextU32() / 0xffffffff) * a.length);
      return a[Math.max(0, Math.min(a.length - 1, idx))];
    },
  };
};

const clampInt = (v, lo, hi) => {
  const x = Math.round(Number(v));
  const a = Math.round(Number(lo));
  const b = Math.round(Number(hi));
  if (!Number.isFinite(x) || !Number.isFinite(a) || !Number.isFinite(b) || b < a) return a;
  return Math.max(a, Math.min(b, x));
};

const enumRangeByStepInt = (minV, maxV, step = 10) => {
  const a0 = Number(minV);
  const b0 = Number(maxV);
  const lo = Math.max(0, Math.min(a0, b0));
  const hi = Math.max(0, Math.max(a0, b0));
  const s = Math.max(1, Math.round(Number(step) || 10));
  const loI = Math.ceil(lo);
  const hiI = Math.floor(hi);
  if (!(Number.isFinite(loI) && Number.isFinite(hiI) && hiI >= loI)) return [lo];
  const out = [];
  out.push(loI);
  const start = Math.ceil(loI / s) * s;
  for (let x = start; x <= hiI; x += s) out.push(x);
  out.push(hiI);
  return uniqNums(out, 1e-9).map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x >= loI && x <= hiI);
};

const pickEvenly = (list0, maxCount = 5) => {
  const list = Array.isArray(list0) ? list0.slice() : [];
  if (list.length <= maxCount) return list;
  const m = Math.max(2, Math.round(Number(maxCount) || 5));
  const out = [];
  for (let i = 0; i < m; i++) {
    const t = m === 1 ? 0 : (i / (m - 1));
    const idx = Math.round(t * (list.length - 1));
    out.push(list[Math.max(0, Math.min(list.length - 1, idx))]);
  }
  return uniqNums(out, 1e-9);
};

// 区段煤柱 ws：按 1m 步长在范围内枚举。
// 若范围内不存在整数米（例如 [3.2, 3.8]），则退化为取 lo（仍保证在范围内）。
const enumRangeBy1m = (minV, maxV) => {
  const a0 = Number(minV);
  const b0 = Number(maxV);
  const loRaw = Number.isFinite(a0) && Number.isFinite(b0) ? Math.min(a0, b0) : (Number.isFinite(a0) ? a0 : (Number.isFinite(b0) ? b0 : 0));
  const hiRaw = Number.isFinite(a0) && Number.isFinite(b0) ? Math.max(a0, b0) : (Number.isFinite(a0) ? a0 : (Number.isFinite(b0) ? b0 : 0));
  const lo = Math.max(0, loRaw);
  const hi = Math.max(0, hiRaw);

  const a = Math.ceil(lo);
  const b = Math.floor(hi);
  if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
    const out = [];
    for (let x = a; x <= b; x += 1) out.push(x);
    return out;
  }
  return [lo];
};

// ws 的“均衡档”采样：用少量代表点替代 1m 全枚举。
// 目标：显著减少重几何评估次数，同时保持结果在大多数场景下接近精算。
// 规则：
// - 始终包含两端点
// - 若提供 target，则强制包含 target（落到整数米并夹到范围内）
// - 其余点按等分插值生成（落到整数米），最终去重并升序
const sampleWsCoarse = (minV, maxV, targetV, count = 9) => {
  const a0 = Number(minV);
  const b0 = Number(maxV);
  const loRaw = Number.isFinite(a0) && Number.isFinite(b0) ? Math.min(a0, b0) : (Number.isFinite(a0) ? a0 : (Number.isFinite(b0) ? b0 : 0));
  const hiRaw = Number.isFinite(a0) && Number.isFinite(b0) ? Math.max(a0, b0) : (Number.isFinite(a0) ? a0 : (Number.isFinite(b0) ? b0 : 0));
  const lo = Math.max(0, loRaw);
  const hi = Math.max(0, hiRaw);

  const loI = Math.ceil(lo);
  const hiI = Math.floor(hi);
  if (!(Number.isFinite(loI) && Number.isFinite(hiI) && hiI >= loI)) {
    return [lo];
  }

  const span = hiI - loI;
  const k = Math.max(2, Math.round(Number(count) || 9));
  // 范围很小：直接全列举即可
  if (span + 1 <= k) return enumRangeBy1m(loI, hiI);

  const out = [];
  out.push(loI);
  out.push(hiI);

  const t0 = Number(targetV);
  if (Number.isFinite(t0)) {
    const tI = clamp(Math.round(t0), loI, hiI);
    out.push(tI);
  }

  for (let i = 1; i <= k - 2; i++) {
    const x = loI + (span * i) / (k - 1);
    out.push(Math.round(x));
  }

  return Array.from(new Set(out.map((x) => clamp(Math.round(Number(x)), loI, hiI))))
    .filter((x) => Number.isFinite(x))
    .sort((x, y) => x - y);
};

// 工程效率综合评分（v2）：覆盖率为主，同时考虑组织复杂度与推进均衡性。
// 说明：保持分值大致在 0~100（可略超/略负），便于 UI 直观比较。
const EFF_SCORE_WEIGHTS_V2 = {
  wN: 0.20,      // 工作面数惩罚系数（每增加 1 个面，扣分）
  wCV: 10.0,     // 推进长度离散（lenCV）惩罚系数
  wShort: 5.0,   // 短面惩罚系数
  minLRef: 100,  // 参考最短推进长度（m）：低于该值开始扣分
};

const EFF_SCORE_VERSION = 'v2';

// 只计算分数（用于全量枚举热路径），避免为每个候选构造 detail 对象。
const computeEfficiencyScoreV2Parts = ({ coverageRatio, N, lenCV, minL }) => {
  const cov = Number(coverageRatio);
  const n = Math.max(1, Math.round(Number(N) || 1));
  const cv = Math.max(0, Number(lenCV) || 0);
  const lmin = Math.max(0, Number(minL) || 0);

  const base = (Number.isFinite(cov) ? cov : 0) * 100;
  const penaltyN = EFF_SCORE_WEIGHTS_V2.wN * Math.max(0, n - 1);
  const penaltyCV = EFF_SCORE_WEIGHTS_V2.wCV * clamp(cv, 0, 2);
  const shortRatio = clamp((EFF_SCORE_WEIGHTS_V2.minLRef - lmin) / (EFF_SCORE_WEIGHTS_V2.minLRef || 1), 0, 1);
  const penaltyShort = EFF_SCORE_WEIGHTS_V2.wShort * shortRatio;
  const penaltyTotal = penaltyN + penaltyCV + penaltyShort;

  const score = base - penaltyTotal;
  return {
    score: Number.isFinite(score) ? score : -Infinity,
    base,
    penaltyN,
    penaltyCV,
    shortRatio,
    penaltyShort,
    penaltyTotal,
    cov: Number.isFinite(cov) ? cov : 0,
    n,
    cv: Number.isFinite(cv) ? cv : 0,
    lmin: Number.isFinite(lmin) ? lmin : 0,
  };
};

const computeEfficiencyScoreV2Detail = ({ coverageRatio, N, lenCV, minL }) => {
  const parts = computeEfficiencyScoreV2Parts({ coverageRatio, N, lenCV, minL });
  return {
    version: EFF_SCORE_VERSION,
    weights: { ...EFF_SCORE_WEIGHTS_V2 },
    inputs: {
      coverageRatio: parts.cov,
      N: parts.n,
      lenCV: parts.cv,
      minL: parts.lmin,
    },
    base: parts.base,
    penalty: {
      N: parts.penaltyN,
      CV: parts.penaltyCV,
      short: parts.penaltyShort,
      total: parts.penaltyTotal,
    },
    score: parts.score,
  };
};

const computeEfficiencyScoreV2 = ({ coverageRatio, N, lenCV, minL }) => computeEfficiencyScoreV2Parts({ coverageRatio, N, lenCV, minL }).score;

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

// 将本地 loops（local coord）转换为 world loops，必要时做 swapXY。
const materializeLoopsWorld = ({ loopsLocal, dx, dy, swapXY }) => {
  const inLoops = Array.isArray(loopsLocal) ? loopsLocal : [];
  const out = [];
  for (let i = 0; i < inLoops.length; i++) {
    const loop = Array.isArray(inLoops[i]) ? inLoops[i] : [];
    if (loop.length < 2) continue;
    const pts = new Array(loop.length);
    for (let j = 0; j < loop.length; j++) {
      const p = loop[j] ?? {};
      const xw = Number(p.x) + dx;
      const yw = Number(p.y) + dy;
      pts[j] = swapXY ? { x: yw, y: xw } : { x: xw, y: yw };
    }
    out.push(pts);
  }
  return out;
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
const prepareOmegaForRects = ({ omegaPoly, debugRef }) => {
  if (!omegaPoly || omegaPoly.isEmpty?.()) return null;
  try {
    const omegaV = ensureValid(fixPolygonSafe(omegaPoly), 'omega', debugRef);
    if (!omegaV || omegaV.isEmpty?.()) return null;

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
    if (!omegaSafe || omegaSafe.isEmpty?.()) return null;

    const bboxOmega = envToBox(omegaSafe.getEnvelopeInternal());
    if (!bboxOmega) return null;
    const spanX = bboxOmega.maxX - bboxOmega.minX;
    const spanY = bboxOmega.maxY - bboxOmega.minY;
    if (!(Number.isFinite(spanX) && spanX > 1e-6 && Number.isFinite(spanY) && spanY > 1e-6)) return null;

    return { omegaSafe, bboxOmega, spanX, spanY };
  } catch {
    return null;
  }
};

const buildDesignRectsForN = ({
  omegaPoly,
  omegaPrepared = null,
  axis,
  N,
  B,
  Ws,
  Lmax,
  includeClipped = false,
  collectLoops = true,
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

  const prep = (omegaPrepared && omegaPrepared.omegaSafe && omegaPrepared.bboxOmega)
    ? omegaPrepared
    : prepareOmegaForRects({ omegaPoly, debugRef });
  if (!prep) return emptyOut;
  const omegaSafe = prep.omegaSafe;
  const bboxOmega = prep.bboxOmega;
  const spanX = prep.spanX;
  const spanY = prep.spanY;

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
        // 只要数值有效，则矩形可构造；loop 仅在 collectLoops=true 时生成。
        if (![x0, y0, x1, y1].every(Number.isFinite) || !(x1 > x0) || !(y1 > y0)) {
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

        if (collectLoops) {
          const loop = rectToLoop(x0, y0, x1, y1);
          if (!loop) {
            if (typeof bumpFail === 'function') bumpFail('RECT_BUILD_FAIL');
            continue;
          }
          out.rectLoopsLocal.push(loop);
        }
        out.faceCount += 1;
        out.lengths.push(L);
        out.rectAreaTotal += Math.max(0, (x1 - x0) * (y1 - y0));
      }
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
      if (![x0, y0, x1, y1].every(Number.isFinite) || !(x1 > x0) || !(y1 > y0)) {
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

      if (collectLoops) {
        const loop = rectToLoop(x0, y0, x1, y1);
        if (!loop) {
          if (typeof bumpFail === 'function') bumpFail('RECT_BUILD_FAIL');
          continue;
        }
        out.rectLoopsLocal.push(loop);
      }
      out.faceCount += 1;
      out.lengths.push(L);
      out.rectAreaTotal += Math.max(0, (x1 - x0) * (y1 - y0));
    }
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

// 序列型规则矩形：允许每个工作面宽度 B_i 不同，且每个区段煤柱 ws_i 不同。
// - BSeq: length=N
// - WsSeq: length=N-1
const buildDesignRectsForSeq = ({
  omegaPoly,
  omegaPrepared = null,
  axis,
  N,
  BSeq,
  WsSeq,
  Lmax,
  includeClipped = false,
  collectLoops = true,
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
  const n0 = Math.max(1, Math.round(Number(N) || 0));
  if (!(Number.isFinite(n0) && n0 >= 1)) return emptyOut;
  const bArr0 = Array.isArray(BSeq) ? BSeq.slice(0, n0) : [];
  if (bArr0.length !== n0) return emptyOut;
  const wsArr0 = Array.isArray(WsSeq) ? WsSeq.slice(0, Math.max(0, n0 - 1)) : [];
  if ((n0 - 1) !== wsArr0.length) return emptyOut;
  for (const b of bArr0) {
    if (!(Number.isFinite(Number(b)) && Number(b) > 0)) return emptyOut;
  }
  for (const w of wsArr0) {
    if (!(Number.isFinite(Number(w)) && Number(w) >= 0)) return emptyOut;
  }

  const prep = (omegaPrepared && omegaPrepared.omegaSafe && omegaPrepared.bboxOmega)
    ? omegaPrepared
    : prepareOmegaForRects({ omegaPoly, debugRef });
  if (!prep) return emptyOut;
  const omegaSafe = prep.omegaSafe;
  const bboxOmega = prep.bboxOmega;
  const spanX = prep.spanX;
  const spanY = prep.spanY;

  const Lcap = (Number.isFinite(Number(Lmax)) && Number(Lmax) > 0)
    ? Number(Lmax)
    : (axis === 'x' ? spanX : spanY);

  const minB = Math.max(1e-6, Math.min(...bArr0.map((x) => Number(x))));
  const insideEps = Math.max(0.05, Math.min(1.0, 0.002 * Math.min(minB, spanX, spanY)));

  const totalW = bArr0.reduce((s, x) => s + Math.max(0, Number(x) || 0), 0)
    + wsArr0.reduce((s, x) => s + Math.max(0, Number(x) || 0), 0);

  const doAssertRectInsideOmega = Boolean(debugRef?.assertRectInsideOmega);

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
        bandRect = rectPoly(bboxOmega.minX - 1, lo, bboxOmega.maxX + 1, hi);
      } else {
        bandRect = rectPoly(lo, bboxOmega.minY - 1, hi, bboxOmega.maxY + 1);
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
      // 重用 buildDesignRectsForN 的 fastRing 能力：直接复刻其内部实现会太大；这里走通用 getIntervalsAt（JSTS line overlay）。
      bandMemo.set(key, { poly: v, fastRing: null });
      return { poly: v, fastRing: null };
    } catch {
      bandMemo.set(key, null);
      return null;
    }
  };

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

  const getIntervalsAt = (bandData, yOrX) => {
    const bandPoly = bandData?.poly ?? bandData;
    if (!bandPoly || bandPoly.isEmpty?.()) return [];
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
    const m = Math.max(5, Math.min(51, Math.round(sampleCount)));
    const samples = [];
    for (let k = 0; k < m; k++) samples.push(lo + ((k + 0.5) / m) * (hi - lo));
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

  const buildForStart = (start0) => {
    const out = {
      rectLoopsLocal: [],
      clippedLoopsLocal: [],
      faceCount: 0,
      rectAreaTotal: 0,
      clippedAreaTotal: 0,
      lengths: [],
      area: 0,
    };
    let cur = Number(start0);
    for (let i = 0; i < n0; i++) {
      const Bi = Number(bArr0[i]);
      const Wsi = (i < n0 - 1) ? Math.max(0, Number(wsArr0[i]) || 0) : 0;
      const bandLo = cur;
      const bandHi = cur + Bi;
      cur = bandHi + Wsi;

      const band = buildBandPoly(bandLo, bandHi);
      if (!band) {
        if (typeof bumpFail === 'function') bumpFail('BAND_POLY_EMPTY');
        continue;
      }

      let it = pickBandMaxInterval(band, bandLo, bandHi, fast ? 7 : 9);
      if (!it && !fast) it = pickBandMaxInterval(band, bandLo, bandHi, 21);
      if (!it) {
        if (typeof bumpFail === 'function') bumpFail(axis === 'x' ? 'BAND_NO_FEASIBLE_X' : 'BAND_NO_FEASIBLE_Y');
        continue;
      }

      const rawLen0 = Math.max(0, it.b - it.a);
      const safeLen = rawLen0 - 2 * insideEps;
      const Lgeom = Math.max(0, safeLen);
      const L = Math.min(Lgeom, Lcap);
      if (!(Number.isFinite(L) && L > 1e-6)) {
        if (typeof bumpFail === 'function') bumpFail(axis === 'x' ? 'BAND_NO_FEASIBLE_X' : 'BAND_NO_FEASIBLE_Y');
        continue;
      }

      if (axis === 'x') {
        const x0 = it.a + insideEps;
        const x1 = x0 + L;
        const y0 = bandLo;
        const y1 = bandHi;
        if (![x0, y0, x1, y1].every(Number.isFinite) || !(x1 > x0) || !(y1 > y0)) {
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

        if (collectLoops) {
          const loop = rectToLoop(x0, y0, x1, y1);
          if (!loop) {
            if (typeof bumpFail === 'function') bumpFail('RECT_BUILD_FAIL');
            continue;
          }
          out.rectLoopsLocal.push(loop);
        }

        out.faceCount += 1;
        out.lengths.push(L);
        out.rectAreaTotal += Math.max(0, (x1 - x0) * (y1 - y0));
      } else {
        const y0 = it.a + insideEps;
        const y1 = y0 + L;
        const x0 = bandLo;
        const x1 = bandHi;
        if (![x0, y0, x1, y1].every(Number.isFinite) || !(x1 > x0) || !(y1 > y0)) {
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

        if (collectLoops) {
          const loop = rectToLoop(x0, y0, x1, y1);
          if (!loop) {
            if (typeof bumpFail === 'function') bumpFail('RECT_BUILD_FAIL');
            continue;
          }
          out.rectLoopsLocal.push(loop);
        }

        out.faceCount += 1;
        out.lengths.push(L);
        out.rectAreaTotal += Math.max(0, (x1 - x0) * (y1 - y0));
      }
    }
    out.area = out.rectAreaTotal;
    return out;
  };

  if (axis === 'x') {
    const span = spanY;
    const margin = Math.max(0, span - totalW);
    const startMin = bboxOmega.minY;
    const startMax = bboxOmega.maxY - totalW;
    const startGuess = bboxOmega.minY + margin / 2;
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
  const optMode0 = String(payload?.input?.mode ?? payload?.optMode ?? 'efficiency');
  const optMode = (optMode0 === 'disturbance') ? 'disturbance' : 'efficiency';
  const internalAxis = 'x';
  const swapXY = originalAxis === 'y';
  const fastMode = Boolean(payload?.fast);
  const searchProfile = String(payload?.searchProfile ?? 'balanced') === 'exact' ? 'exact' : 'balanced';

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

  // === 工程效率进度设计（按算法结构） ===
  // 工程效率 full compute 没有硬 time budget（Infinity），因此“时间占比”会长期停在 0%。
  // 这里改为：按“B 评估次数 / 估算总评估次数”的进度。
  // 估算总数使用上界：粗搜所有 coarseBs + 精修 upperBound(B_COARSE_TOPM * (2*win+1))。
  let progressTotalEvalUpper = 0;
  let progressPrePct = 1; // 预处理阶段的起步百分比（1~10）
  let progressWsIndex = 0;
  let progressWsTotal = 0;
  let progressNIndex = 0;
  let progressNTotal = 0;
  let lastPercentSent = 0;

  // 时间预算：
  // - fast：保证快速返回
  // - disturbance：按 UI 默认 180s（可通过 payload.maxTimeMs 覆盖）
  const TIME_BUDGET_MS = fastMode
    ? 280
    : (optMode === 'disturbance'
      ? Math.max(5000, Math.round(toNum(payload?.maxTimeMs) ?? 180000))
      : Infinity);
  const deadlineMs = Number.isFinite(TIME_BUDGET_MS) ? (nowMs() + TIME_BUDGET_MS) : Infinity;
  let timeBudgetHit = false;
  const timeExceeded = () => {
    if (!Number.isFinite(TIME_BUDGET_MS)) return false;
    if (timeBudgetHit) return true;
    if (nowMs() > deadlineMs) {
      timeBudgetHit = true;
      return true;
    }
    return false;
  };

  // 覆盖率阈值：保留历史默认（disturbance 也沿用作为 qualified 标记）
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
      searchProfile: fastMode ? 'fast' : searchProfile,
      timeBudgetMs: Number.isFinite(TIME_BUDGET_MS) ? TIME_BUDGET_MS : null,
      timeBudgetHit: false,
      Bsearch: {
        version: fastMode ? 'v4-fast' : (searchProfile === 'exact' ? 'v4-exact' : 'v4-balanced'),
        // 默认（更新：2026-01-20 之后）：均衡档使用粗到细，减少重几何评估次数
        // - fast：粗搜 5m（时间预算兜底）
        // - exact：粗搜 1m（等价全范围精算；精修自动关闭）
        // - balanced：粗搜 10m + 局部 1m 精修
        coarseStep: fastMode ? 5 : (searchProfile === 'exact' ? 1 : 10),
        fineStep: 1,
        fineHalfWin: fastMode ? 6 : (searchProfile === 'exact' ? 10 : 12),
        coarseTopM: fastMode ? 2 : (searchProfile === 'exact' ? 5 : 3),
        coarseEvaluatedBCount: 0,
        fineEvaluatedBCount: 0,
        seedBs: [],
      },
    },
  };

  // 进度上报：用于前端“计算中…”后显示当前尝试/可行计数。
  // 约束：必须节流，避免高频 postMessage 反而拖慢计算。
  let lastProgressMs = nowMs();
  let lastAttemptedSent = 0;
  let lastPhaseSent = '';
  const PROGRESS_THROTTLE_MS = 180;
  const PROGRESS_MIN_DELTA = 80;
  const maybePostProgress = (phase, opts = {}) => {
    try {
      const attempted = Number(responseBase?.attemptSummary?.attemptedCombos ?? 0);
      const feasible = Number(responseBase?.attemptSummary?.feasibleCombos ?? 0);
      const t = nowMs();
      const phaseStr = String(phase ?? '');
      const force = Boolean(opts?.force) || (phaseStr && phaseStr !== lastPhaseSent);
      if (!force && (attempted - lastAttemptedSent) < PROGRESS_MIN_DELTA && (t - lastProgressMs) < PROGRESS_THROTTLE_MS) return;
      lastAttemptedSent = attempted;
      lastProgressMs = t;
      if (phaseStr) lastPhaseSent = phaseStr;

      const doneEval = (optMode === 'disturbance')
        ? attempted
        : (Number(responseBase?.attemptSummary?.Bsearch?.coarseEvaluatedBCount ?? 0)
          + Number(responseBase?.attemptSummary?.Bsearch?.fineEvaluatedBCount ?? 0));
      const denomEval = Math.max(1, Number(progressTotalEvalUpper) || 0);
      const evalFrac = Math.max(0, Math.min(1, doneEval / denomEval));

      // 预处理占 10%，枚举/精修占 90%
      const base = Math.max(0, Math.min(10, Math.round(Number(progressPrePct) || 0)));
      const percentRaw = (denomEval > 1)
        ? Math.max(base, Math.min(99, base + Math.floor(evalFrac * (99 - base))))
        : base;
      const percent = Math.max(lastPercentSent, percentRaw);
      lastPercentSent = percent;

      self.postMessage({
        type: 'progress',
        payload: {
          mode: 'smart-efficiency',
          reqSeq,
          cacheKey,
          axis: originalAxis,
          fast: fastMode,
          progress: {
            phase: phaseStr,
            percent,
            attemptedCombos: attempted,
            feasibleCombos: feasible,
            wsIndex: progressWsIndex,
            wsTotal: progressWsTotal,
            nIndex: progressNIndex,
            nTotal: progressNTotal,
            evalDone: doneEval,
            evalTotalUpper: denomEval,
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
  maybePostProgress('初始化', { force: true });
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

  // disturbance：左右边界煤柱（允许不对称）
  const wbLeftMin = toNum(payload?.boundaryPillarLeftMin ?? wbMin) ?? wbMin;
  const wbLeftMax = toNum(payload?.boundaryPillarLeftMax ?? wbMax) ?? wbMax;
  const wbRightMin = toNum(payload?.boundaryPillarRightMin ?? wbMin) ?? wbMin;
  const wbRightMax = toNum(payload?.boundaryPillarRightMax ?? wbMax) ?? wbMax;

  const BAdjMax = Math.max(0, Math.round(toNum(payload?.faceWidthAdjacentMaxDelta) ?? 30));
  const wsAdjMax = Math.max(0, Math.round(toNum(payload?.coalPillarAdjacentMaxDelta) ?? 20));
  const maxCandidates = Math.max(30, Math.min(800, Math.round(toNum(payload?.maxCandidates) ?? 220)));

  const wsMin = toNum(payload?.coalPillarMin) ?? 0;
  const wsMax = toNum(payload?.coalPillarMax) ?? wsMin;
  const wsTarget = toNum(payload?.coalPillarTarget);

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

  // 候选容器（efficiency/disturbance 共用）
  const qualifiedCandidates = [];
  const fallbackCandidates = [];
  const allCandByKey = new Map();
  let omegaCtxForRender = null;
  const pushCandidateUnique = (c) => {
    if (!c) return;
    const k = String(c.signature ?? '');
    if (!k || allCandByKey.has(k)) return;
    allCandByKey.set(k, c);
    if (c.qualified) qualifiedCandidates.push(c);
    else fallbackCandidates.push(c);
  };

  const trimPolyByAxisPillars = (poly, axis, wbL, wbR) => {
    if (!poly || poly.isEmpty?.()) return null;
    const wbl = Math.max(0, Number(wbL) || 0);
    const wbr = Math.max(0, Number(wbR) || 0);
    try {
      const env = poly.getEnvelopeInternal();
      const minX = Number(env.getMinX());
      const maxX = Number(env.getMaxX());
      const minY = Number(env.getMinY());
      const maxY = Number(env.getMaxY());
      if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;
      let clip = null;
      if (axis === 'x') {
        const y0 = minY + wbl;
        const y1 = maxY - wbr;
        if (!(Number.isFinite(y0) && Number.isFinite(y1) && y1 > y0 + 1e-6)) return null;
        clip = rectPoly(minX - 1, y0, maxX + 1, y1);
      } else {
        const x0 = minX + wbl;
        const x1 = maxX - wbr;
        if (!(Number.isFinite(x0) && Number.isFinite(x1) && x1 > x0 + 1e-6)) return null;
        clip = rectPoly(x0, minY - 1, x1, maxY + 1);
      }
      const inter = robustIntersection(poly, clip);
      const picked = fixPolygonSafe(pickLargestPolygon(inter));
      const v = ensureValid(picked, 'omegaTrim', stripDebug);
      if (!v || v.isEmpty?.() || !(Number(v.getArea?.()) > 1e-6)) return null;
      return v;
    } catch {
      return null;
    }
  };

  // 先构造 omega（用于粉色可采区展示与快速失败诊断）：
  // - efficiency：全边界内缩 wbMin（历史口径）
  // - disturbance：全边界内缩 wbMax（口径：边界煤柱读取输入框最大值；粉色Ω=整体内缩）
  const wbMinUsed = Math.abs(Number(wbMin) || 0);
  const wbMaxUsed = Math.abs(Number(wbMax) || 0);
  const wbOmegaUsed = (optMode === 'disturbance') ? Math.max(wbMinUsed, wbMaxUsed) : wbMinUsed;
  const bufferDistance0 = -Math.abs(wbOmegaUsed);
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
    wbUsed: wbOmegaUsed,
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
    const reason = `内缩后可采区为空（wb=${omegaDebug0?.wbUsed ?? wbMinUsed}m）`;
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

  // === 决策层规则（更新：2026-01-20）：
  // - 边界煤柱 wb：不做搜索/枚举。
  //   - efficiency：取最小值（历史口径）
  //   - disturbance：取最大值（用户确认口径）
  // - 区段煤柱 ws：
  //   - disturbance：全范围 1m 枚举（保证多方案密度；且不施加相邻差约束）
  //   - efficiency：默认使用“均衡档”采样（更快）；如需精算可传 searchProfile='exact'
  const wbFixedRaw = (() => {
    const a = Number(wbMin);
    const b = Number(wbMax);
    const hasA = Number.isFinite(a);
    const hasB = Number.isFinite(b);
    if (hasA && hasB) return (optMode === 'disturbance') ? Math.max(a, b) : Math.min(a, b);
    if (hasA) return a;
    if (hasB) return b;
    return 0;
  })();
  const wbSamples = [wbFixedRaw];
  const wsSamples = (optMode === 'disturbance' || fastMode || searchProfile === 'exact')
    ? enumRangeBy1m(wsMin, wsMax)
    : sampleWsCoarse(wsMin, wsMax, wsTarget, 9);

  // === B 两阶段搜索策略（粗搜 + 局部 1m 精修） ===
  // 说明：按你确认的层级 A：对每个 (ws,N) 单独做粗搜+精修。
  // B 口径：整数米；精修范围 [ceil(Bmin) .. floor(Bmax)]，步长=1。
  // B 的枚举步长：
  // - fast：粗搜 5m 一档（保证速度）
  // - exact：粗搜 1m 一档（相当于全范围精细枚举）
  // - balanced：粗搜 10m 一档（再做局部 1m 精修）
  const B_COARSE_STEP = fastMode ? 5 : (searchProfile === 'exact' ? 1 : 10);
  const B_FINE_STEP = 1;
  const B_FINE_HALFWIN = fastMode ? 6 : (searchProfile === 'exact' ? 10 : 12);
  const B_COARSE_TOPM = fastMode ? 2 : (searchProfile === 'exact' ? 5 : 3);
  // 当 coarseStep 已经是 1m 时，精修会完全重复粗搜，直接关闭。
  const DO_FINE = !fastMode && B_COARSE_STEP > B_FINE_STEP;

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
    if (Math.abs((b.coverageRatio ?? 0) - (a.coverageRatio ?? 0)) > COVERAGE_EPS) return (b.coverageRatio ?? 0) - (a.coverageRatio ?? 0);
    if ((a.lenCV ?? 0) !== (b.lenCV ?? 0)) return (a.lenCV ?? 0) - (b.lenCV ?? 0);
    if (b.B !== a.B) return b.B - a.B;
    return String(a.signature).localeCompare(String(b.signature));
  };

  // 维护 TopM（按 compareWithinSameN 排序，最优在前），避免对大量候选做全量 sort。
  // 仅用于 debug seedBs；不会影响最终 candidates（候选仍全部 pushCandidateUnique）。
  const pushTopM = (arr, item, maxM) => {
    if (!item || maxM <= 0) return;
    if (!Array.isArray(arr)) return;
    if (arr.length === 0) {
      arr.push(item);
      return;
    }
    // 若未满，直接插入到合适位置；若已满，仅当 item 优于最差项才插入。
    const worst = arr[arr.length - 1];
    if (arr.length >= maxM && compareWithinSameN(item, worst) >= 0) return;

    let pos = arr.length;
    for (let i = 0; i < arr.length; i++) {
      if (compareWithinSameN(item, arr[i]) < 0) {
        pos = i;
        break;
      }
    }
    arr.splice(pos, 0, item);
    if (arr.length > maxM) arr.length = maxM;
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
      omegaPrepared: omegaCtxForRender?.omegaPrepared ?? null,
      axis: internalAxis,
      N,
      B,
      Ws: wsNonNeg,
      Lmax: faceAdvanceMax,
      includeClipped: false,
      collectLoops: false,
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
    const efficiencyScore = computeEfficiencyScoreV2({ coverageRatio, N: actualN, lenCV, minL });
    const signature = `${originalAxis}|wb=${wbUsed.toFixed(4)}|ws=${wsNonNeg.toFixed(4)}|N=${actualN}|B=${Number(B).toFixed(4)}`;

    const candidate = {
      key: signature,
      signature,
      axis: originalAxis,
      wb: wbUsed,
      wbUsed,
      ws: wsNonNeg,
      wsMin: wsNonNeg,
      wsMax: wsNonNeg,
      N: actualN,
      B,
      Bmin: B,
      Bmax: B,
      coverageMin: COVERAGE_MIN,
      qualified,
      lowCoverage: !qualified,
      efficiencyScore,
      efficiencyScoreDetail: null,
      // 为了避免全枚举阶段构造大对象，detail 延迟到回包 candidates 阶段再填充。
      __effInputs: { coverageRatio, N: actualN, lenCV, minL },
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
        efficiencyScoreDetail: null,
      },
      innerArea,
      coveredArea: rectAreaTotal,
      coverageRatio,
      efficiencyScore,
      omegaRender: {
        loops: omegaLoops,
      },
      // render 的大数组延迟构造：仅对最终回包 candidates 生成 world loops。
      render: {
        omegaLoops: omegaLoops,
        rectLoops: [],
        clippedLoops: [],
      },
      __dx: offset.dx,
      __dy: offset.dy,
      __swapXY: swapXY,
    };

    return candidate;
  };

  const buildCandidateForSeq = ({ innerPoly, innerArea, omegaLoops, wbUsed, N, BSeq, WsSeq }) => {
    const built = buildDesignRectsForSeq({
      omegaPoly: innerPoly,
      omegaPrepared: omegaCtxForRender?.omegaPrepared ?? null,
      axis: internalAxis,
      N,
      BSeq,
      WsSeq,
      Lmax: faceAdvanceMax,
      includeClipped: false,
      collectLoops: false,
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

    const bArr = (Array.isArray(BSeq) ? BSeq : []).map((x) => Math.round(Number(x))).filter(Number.isFinite);
    const wsArr = (Array.isArray(WsSeq) ? WsSeq : []).map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x >= 0);
    if (bArr.length !== actualN) return null;
    if (wsArr.length !== Math.max(0, actualN - 1)) return null;

    const bMin = bArr.length ? Math.min(...bArr) : null;
    const bMax = bArr.length ? Math.max(...bArr) : null;
    const wsMin0 = wsArr.length ? Math.min(...wsArr) : 0;
    const wsMax0 = wsArr.length ? Math.max(...wsArr) : 0;
    const bMean = bArr.length ? (bArr.reduce((s, x) => s + x, 0) / bArr.length) : 0;
    const wsMean = wsArr.length ? (wsArr.reduce((s, x) => s + x, 0) / wsArr.length) : 0;

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
    const efficiencyScore = computeEfficiencyScoreV2({ coverageRatio, N: actualN, lenCV, minL });
    const seqHash = hash32FNV1a(`${bArr.join(',')}|${wsArr.join(',')}`);
    const signature = `${originalAxis}|wb=${wbUsed.toFixed(4)}|ws=${Math.round(wsMin0)}-${Math.round(wsMax0)}|N=${actualN}|B=${Math.round(bMin)}-${Math.round(bMax)}|h=${seqHash}`;

    return {
      key: signature,
      signature,
      axis: originalAxis,
      wb: wbUsed,
      wbUsed,
      ws: wsMean,
      wsMin: wsMin0,
      wsMax: wsMax0,
      N: actualN,
      B: bMean,
      Bmin: bMin,
      Bmax: bMax,
      coverageMin: COVERAGE_MIN,
      qualified,
      lowCoverage: !qualified,
      efficiencyScore,
      efficiencyScoreDetail: null,
      __effInputs: { coverageRatio, N: actualN, lenCV, minL },
      minL,
      sumL,
      lenCV,
      genes: {
        axis: originalAxis,
        wb: wbUsed,
        ws: wsMean,
        wsMin: wsMin0,
        wsMax: wsMax0,
        N: actualN,
        B: bMean,
        Bmin: bMin,
        Bmax: bMax,
        BSeq: bArr,
        WsSeq: wsArr,
        Nreq: N,
      },
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
        efficiencyScoreDetail: null,
      },
      innerArea,
      coveredArea: rectAreaTotal,
      coverageRatio,
      omegaRender: { loops: omegaLoops },
      render: {
        omegaLoops,
        rectLoops: [],
        clippedLoops: [],
      },
      __dx: offset.dx,
      __dy: offset.dy,
      __swapXY: swapXY,
    };
  };

    // wb 固定时，innerPoly 对所有候选相同：用于回包阶段重建 loops（避免全枚举阶段存大数组）

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

    omegaCtxForRender = { innerPoly };

    // 预处理可能较耗时：先上报一次阶段，避免 UI 长时间停在 0%。
    progressPrePct = 6;
    maybePostProgress('预处理', { force: true });

    // 预处理外提：对同一个 innerPoly 只做一次 ensureValid/buffer/bbox/span
    try {
      omegaCtxForRender.omegaPrepared = prepareOmegaForRects({ omegaPoly: innerPoly, debugRef: stripDebug });
    } catch {
      omegaCtxForRender.omegaPrepared = null;
    }

    progressPrePct = 10;
    maybePostProgress('开始枚举', { force: true });

    const env = innerPoly.getEnvelopeInternal();
    const span = internalAxis === 'x' ? (env.getMaxY() - env.getMinY()) : (env.getMaxX() - env.getMinX());
    if (!(Number.isFinite(span) && span > 1e-6)) continue;

    // === disturbance：序列枚举（BSeq/WsSeq），仅作用于 disturbance 分支，efficiency 不受影响 ===
    if (optMode === 'disturbance') {
      const BminInt = Math.ceil(Bmin);
      const BmaxInt = Math.floor(Bmax);
      const wsMinInt = Math.max(0, Math.ceil(Number(wsMin) || 0));
      const wsMaxInt = Math.max(wsMinInt, Math.floor(Number(wsMax) || 0));
      if (!(Number.isFinite(BminInt) && Number.isFinite(BmaxInt) && BmaxInt >= BminInt && BminInt > 0)) {
        bumpFail('B_RANGE_NO_INT');
        continue;
      }

      // N 上限：用最紧凑组合（Bmin + wsMin）推上界，然后全枚举到 Ncap。
      const computeNmaxSeq = (spanV, bMinV, wsMinV) => {
        const s = Number(spanV);
        const b = Number(bMinV);
        const w = Math.max(0, Number(wsMinV) || 0);
        if (!(Number.isFinite(s) && s > 0 && Number.isFinite(b) && b > 0)) return 0;
        return Math.floor((s + w) / (b + w));
      };
      const NmaxAtBest = computeNmaxSeq(span, BminInt, wsMinInt);
      const NcapLimit = fastMode ? 12 : 20;
      const Ncap = Math.max(1, Math.min(NcapLimit, NmaxAtBest));
      progressWsTotal = 1;
      progressWsIndex = 1;
      progressNTotal = Ncap;

      const rng = makeRng(`${cacheKey}|disturbance|seq|wb=${wbUsed}|axis=${originalAxis}`);

      const mkWsSeqVariants = (N) => {
        const m = Math.max(0, Math.round(Number(N) || 0) - 1);
        if (m <= 0) return [[]];
        const mid = Math.round((wsMinInt + wsMaxInt) / 2);
        const out = [];
        const push = (arr) => {
          const a = Array.isArray(arr) ? arr.map((x) => Math.max(0, Math.round(Number(x) || 0))) : [];
          if (a.length !== m) return;
          out.push(a);
        };
        push(Array(m).fill(wsMinInt));
        push(Array(m).fill(wsMaxInt));
        push(Array(m).fill(mid));
        push(Array(m).fill(Number.isFinite(Number(wsTarget)) ? Math.round(Number(wsTarget)) : mid));
        // 少量随机序列：提升多样性（ws 无相邻差约束）
        const randK = fastMode ? 1 : 3;
        for (let k = 0; k < randK; k++) {
          const a = [];
          for (let i = 0; i < m; i++) a.push(rng.int(wsMinInt, wsMaxInt));
          push(a);
        }
        // 去重
        const seen = new Set();
        return out.filter((a) => {
          const key = a.join(',');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };

      const mkBSeqVariants = (N, wsSeq) => {
        const n = Math.max(1, Math.round(Number(N) || 0));
        const sumWs = (Array.isArray(wsSeq) ? wsSeq : []).reduce((s, x) => s + Math.max(0, Math.round(Number(x) || 0)), 0);
        const maxSumB = Math.floor(span - sumWs);
        if (!(Number.isFinite(maxSumB) && maxSumB >= n * BminInt)) return [];
        const mid = Math.round((BminInt + BmaxInt) / 2);

        const out = [];
        const push = (arr) => {
          const a = Array.isArray(arr) ? arr.map((x) => Math.round(Number(x))) : [];
          if (a.length !== n) return;
          for (const v of a) {
            if (!(Number.isFinite(v) && v >= BminInt && v <= BmaxInt)) return;
          }
          for (let i = 1; i < a.length; i++) {
            if (Math.abs(a[i] - a[i - 1]) > BAdjMax) return;
          }
          const sumB = a.reduce((s, x) => s + x, 0);
          if (sumB + sumWs > span + 1e-6) return;
          out.push(a);
        };

        // 基础常数序列
        push(Array(n).fill(BminInt));
        push(Array(n).fill(mid));
        push(Array(n).fill(BmaxInt));

        // ramp（受相邻差约束）
        if (BAdjMax > 0 && n >= 2) {
          const step = Math.max(1, Math.min(BAdjMax, Math.max(1, Math.round((BmaxInt - BminInt) / Math.max(1, n - 1)))));
          const up = [];
          let cur = BminInt;
          for (let i = 0; i < n; i++) { up.push(cur); cur = Math.min(BmaxInt, cur + step); }
          push(up);
          const down = [];
          cur = BmaxInt;
          for (let i = 0; i < n; i++) { down.push(cur); cur = Math.max(BminInt, cur - step); }
          push(down);
        }

        // random-walk：提升多样性
        const randK = fastMode ? 2 : 6;
        for (let k = 0; k < randK; k++) {
          const a = [];
          let cur = rng.int(BminInt, BmaxInt);
          a.push(cur);
          for (let i = 1; i < n; i++) {
            const d = (BAdjMax > 0) ? rng.int(-BAdjMax, BAdjMax) : 0;
            cur = clampInt(cur + d, BminInt, BmaxInt);
            a.push(cur);
          }
          push(a);
        }

        // 去重
        const seen = new Set();
        return out.filter((a) => {
          const key = a.join(',');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };

      let capHit = false;
      for (let Nreq = 1; Nreq <= Ncap; Nreq++) {
        if (timeExceeded() || capHit) break;
        progressNIndex = Nreq;
        maybePostProgress('枚举', { force: Nreq === 1 });

        const wsSeqVariants = mkWsSeqVariants(Nreq);
        for (const wsSeq of wsSeqVariants) {
          if (timeExceeded() || capHit) break;
          const bSeqVariants = mkBSeqVariants(Nreq, wsSeq);
          for (const bSeq of bSeqVariants) {
            if (timeExceeded()) break;
            responseBase.attemptSummary.attemptedCombos += 1;
            if (responseBase.attemptSummary.attemptedCombos === 1) maybePostProgress('枚举', { force: true });
            maybePostProgress('枚举');

            const c = buildCandidateForSeq({ innerPoly, innerArea, omegaLoops, wbUsed, N: Nreq, BSeq: bSeq, WsSeq: wsSeq });
            if (!c) continue;
            responseBase.attemptSummary.feasibleCombos += 1;
            pushCandidateUnique(c);

            if (allCandByKey.size >= maxCandidates) {
              capHit = true;
              break;
            }
          }
        }
      }

      continue;
    }

    const wsList = wsSamples.length ? wsSamples : [0];
    progressWsTotal = wsList.length;
    progressWsIndex = 0;

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

    // 先做一次“总工作量上界”估算（非常轻量，只做算术+genCoarseBs），用于稳定百分比。
    try {
      const BminInt0 = Math.ceil(Bmin);
      const BmaxInt0 = Math.floor(Bmax);
      if (Number.isFinite(BminInt0) && Number.isFinite(BmaxInt0) && BmaxInt0 >= BminInt0) {
        let totalUpper = 0;
        for (const ws0 of wsList) {
          const wsNonNeg0 = Math.max(0, Number(ws0) || 0);
          const NmaxAtBmin0 = computeNmax(span, BminInt0, wsNonNeg0);
          if (!(Number.isFinite(NmaxAtBmin0) && NmaxAtBmin0 >= 1)) continue;
          const NcapLimit0 = fastMode ? 12 : 20;
          const Ncap0 = Math.max(1, Math.min(NcapLimit0, NmaxAtBmin0));
          for (let Nreq0 = 1; Nreq0 <= Ncap0; Nreq0++) {
            const bUpperBySpan0 = (span - (Nreq0 - 1) * wsNonNeg0) / Nreq0;
            const Bupper0 = Math.min(BmaxInt0, Math.floor(bUpperBySpan0));
            if (!(Number.isFinite(Bupper0) && Bupper0 >= BminInt0)) break;
            const rangeLen = Math.max(0, Bupper0 - BminInt0 + 1);
            const coarseUpper = (B_COARSE_STEP === 1)
              ? rangeLen
              : genCoarseBs(BminInt0, Bupper0).length;
            const fineUpper = DO_FINE
              ? (B_COARSE_TOPM * Math.min(rangeLen, (2 * B_FINE_HALFWIN + 1)))
              : 0;
            totalUpper += Math.max(0, coarseUpper) + Math.max(0, fineUpper);
          }
        }
        progressTotalEvalUpper = Math.max(0, Math.round(totalUpper));
      }
    } catch {
      progressTotalEvalUpper = 0;
    }

    for (const ws of wsList) {
      if (timeExceeded()) break;
      progressWsIndex += 1;
      const wsNonNeg = Math.max(0, Number(ws) || 0);

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
      // 工作面个数上限：全局限制为 20（fast 仍保持更小上限以保证快速返回）
      const NcapLimit = fastMode ? 12 : 20;
      const Ncap = Math.max(1, Math.min(NcapLimit, NmaxAtBmin));

      progressNTotal = Ncap;

      for (let Nreq = 1; Nreq <= Ncap; Nreq++) {
        if (timeExceeded()) break;
        progressNIndex = Nreq;
        if (Nreq === 1) maybePostProgress('枚举', { force: true });
        const bUpperBySpan = (span - (Nreq - 1) * wsNonNeg) / Nreq;
        const Bupper = Math.min(BmaxInt, Math.floor(bUpperBySpan));
        if (!(Number.isFinite(Bupper) && Bupper >= BminInt)) {
          bumpFail('BUPPER_LT_BMIN');
          break;
        }

        // --- 粗搜 ---
        const seedsTopCands = [];
        if (B_COARSE_STEP === 1) {
          for (let B = BminInt; B <= Bupper; B += 1) {
            if (timeExceeded()) break;
            responseBase.attemptSummary.attemptedCombos += 1;
            responseBase.attemptSummary.Bsearch.coarseEvaluatedBCount += 1;
            if (responseBase.attemptSummary.attemptedCombos === 1) maybePostProgress('枚举', { force: true });
            // 每次迭代都调用（内部节流），避免尝试次数较少时进度不刷新。
            maybePostProgress('枚举');
            const c = buildCandidateForFixedN({ innerPoly, innerArea, omegaLoops, wbUsed, wsNonNeg, N: Nreq, B });
            if (!c) continue;
            responseBase.attemptSummary.feasibleCombos += 1;
            pushCandidateUnique(c);
            pushTopM(seedsTopCands, c, B_COARSE_TOPM);
          }
        } else {
          const coarseBs = genCoarseBs(BminInt, Bupper);
          for (const B of coarseBs) {
            if (timeExceeded()) break;
            responseBase.attemptSummary.attemptedCombos += 1;
            responseBase.attemptSummary.Bsearch.coarseEvaluatedBCount += 1;
            if (responseBase.attemptSummary.attemptedCombos === 1) maybePostProgress('粗搜', { force: true });
            maybePostProgress('粗搜');
            const c = buildCandidateForFixedN({ innerPoly, innerArea, omegaLoops, wbUsed, wsNonNeg, N: Nreq, B });
            if (!c) continue;
            responseBase.attemptSummary.feasibleCombos += 1;
            pushCandidateUnique(c);
            pushTopM(seedsTopCands, c, B_COARSE_TOPM);
          }
        }
        if (!seedsTopCands.length) continue;

        // 选 TopM 个种子（按 compareWithinSameN 最优优先）；用于 debug seedBs 与（若开启）精修。
        const seeds = [];
        const seenB = new Set();
        for (const c of seedsTopCands) {
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
              if (responseBase.attemptSummary.attemptedCombos === 1) maybePostProgress('精修', { force: true });
              maybePostProgress('精修');
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

  const allCandidates = (optMode === 'disturbance')
    ? [...qualifiedCandidates, ...fallbackCandidates]
    : (qualifiedCandidates.length ? qualifiedCandidates : fallbackCandidates);

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

  // === 用户确认的口径（更新：2026-01-20）：
  // 1) 覆盖率绝对优先（分层，epsilon 内认为同一档）：先按 coverageRatio 排序。
  // 2) 覆盖率相同时：优先工作面个数 N 最小（组织更简单）。
  // 3) 其余再用工程效率综合评分（v2）与稳定 tie-break。
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
  const cvOf = (c) => {
    const v = Number(c?.lenCV);
    return Number.isFinite(v) ? v : Infinity;
  };
  const minLOf = (c) => {
    const v = Number(c?.minL);
    return Number.isFinite(v) ? v : -Infinity;
  };
  const compareCoverageFirst = (a, b) => {
    const preferQualified = (optMode !== 'disturbance');
    if (preferQualified) {
      const qa = Boolean(a?.qualified);
      const qb = Boolean(b?.qualified);
      if (qa !== qb) return qa ? -1 : 1; // qualified 优先
    }

    const ra = coverageOf(a);
    const rb = coverageOf(b);
    if (Math.abs(rb - ra) > COVERAGE_EPS) return rb - ra;

    const na = Number(a?.N);
    const nb = Number(b?.N);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;

    const sa = scoreOf(a);
    const sb = scoreOf(b);
    if (sb !== sa) return sb - sa;

    const cva = cvOf(a);
    const cvb = cvOf(b);
    if (cva !== cvb) return cva - cvb;

    const la = minLOf(a);
    const lb = minLOf(b);
    if (lb !== la) return lb - la;

    const Ba = Number(a?.B);
    const Bb = Number(b?.B);
    if (Number.isFinite(Ba) && Number.isFinite(Bb) && Bb !== Ba) return Bb - Ba;

    return String(a?.signature ?? '').localeCompare(String(b?.signature ?? ''));
  };

  const usedFallback = qualifiedCandidates.length === 0;
  const compareMain = compareCoverageFirst;
  const rankedAll = (allCandidates ?? []).slice().sort(compareMain);
  const best = rankedAll[0];
  const nStar = best.N;

  // === 方案C：一次计算覆盖全 N（尽量连续） ===
  // 为了让“工作面个数滑块”可切换而不重算：
  // - 必须返回 bestKeyByN（每个可行 N 的最优候选 key）
  // - candidates 至少包含每个 N 的 best 候选（否则前端无法按 key 切换）
  // 性能优化：rankedAll 已按 compareMain 全局排序；同一 N 的最优项就是该 N 首次出现的候选。
  // 因此可一次遍历同时构建 bestByN 和 candidatesByN，避免对每个 N 反复 filter+sort（O(n^2)）。
  const bestByN = new Map();
  const candidatesByN = {};
  for (const c of rankedAll) {
    const n = Number(c?.N);
    if (!(Number.isFinite(n) && n >= 1)) continue;
    const sig = String(c?.signature ?? '');
    const nk = String(n);
    if (!candidatesByN[nk]) candidatesByN[nk] = [];
    if (sig) candidatesByN[nk].push(sig);
    if (!bestByN.has(n)) bestByN.set(n, c);
  }

  const nValuesAll = Array.from(bestByN.keys()).sort((a, b) => a - b);
  const nRange = nValuesAll.length
    ? { nMin: nValuesAll[0], nMax: nValuesAll[nValuesAll.length - 1], nValues: nValuesAll }
    : null;

  const bestKeyByN = {};
  for (const n of nValuesAll) {
    bestKeyByN[String(n)] = String(bestByN.get(n)?.signature ?? '');
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

  const materializeCandidateForResponse = (c) => {
    if (!c) return;

    // 1) efficiencyScoreDetail：只为回包 candidates 构造
    try {
      if (!c.efficiencyScoreDetail) {
        const inp = c.__effInputs ?? { coverageRatio: c.coverageRatio, N: c.N, lenCV: c.lenCV, minL: c.minL };
        const d = computeEfficiencyScoreV2Detail(inp);
        c.efficiencyScoreDetail = d;
        if (c.metrics) c.metrics.efficiencyScoreDetail = d;
      }
    } catch {
      // ignore
    }

    // 2) render loops：只为回包 candidates 生成（world 坐标）
    try {
      const dx = Number(c.__dx);
      const dy = Number(c.__dy);
      const swapXY = Boolean(c.__swapXY);

      // 候选搜索阶段已关闭 loops 收集；此处基于 wb 固定下的 innerPoly 重建 loops。
      if (c.render && Array.isArray(c.render.rectLoops) && c.render.rectLoops.length === 0) {
        const omegaPoly = omegaCtxForRender?.innerPoly;
        if (omegaPoly) {
          const bSeq = Array.isArray(c?.genes?.BSeq) ? c.genes.BSeq : null;
          const wsSeq = Array.isArray(c?.genes?.WsSeq) ? c.genes.WsSeq : null;

          const rebuilt = (bSeq && wsSeq)
            ? buildDesignRectsForSeq({
              omegaPoly,
              omegaPrepared: omegaCtxForRender?.omegaPrepared ?? null,
              axis: internalAxis,
              N: Math.max(1, Math.round(Number(c.N) || 0)),
              BSeq: bSeq,
              WsSeq: wsSeq,
              Lmax: faceAdvanceMax,
              includeClipped: false,
              collectLoops: true,
              bumpFail: null,
              debugRef: null,
              fast: fastMode,
              coordSpace: 'local',
            })
            : buildDesignRectsForN({
              omegaPoly,
              omegaPrepared: omegaCtxForRender?.omegaPrepared ?? null,
              axis: internalAxis,
              N: Math.max(1, Math.round(Number(c.N) || 0)),
              B: Number(c.B),
              Ws: Math.max(0, Number(c.ws) || 0),
              Lmax: faceAdvanceMax,
              includeClipped: false,
              collectLoops: true,
              bumpFail: null,
              debugRef: null,
              fast: fastMode,
              coordSpace: 'local',
            });

          const rectLoopsLocal = Array.isArray(rebuilt?.rectLoopsLocal) ? rebuilt.rectLoopsLocal : [];
          const clippedLoopsLocal = Array.isArray(rebuilt?.clippedLoopsLocal) ? rebuilt.clippedLoopsLocal : [];

          c.render.rectLoops = materializeLoopsWorld({ loopsLocal: rectLoopsLocal, dx, dy, swapXY });
          c.render.clippedLoops = clippedLoopsLocal.length
            ? materializeLoopsWorld({ loopsLocal: clippedLoopsLocal, dx, dy, swapXY })
            : [];
        }
      }

      // facesLoops/plannedWorkfaceLoopsWorld：依赖 rectLoops
      if (c.render && Array.isArray(c.render.rectLoops) && !Array.isArray(c.render.facesLoops)) {
        const facesLoopsWorld = c.render.rectLoops.map((loop, idx) => ({ faceIndex: idx + 1, loop }));
        c.render.facesLoops = facesLoopsWorld;
        c.render.plannedWorkfaceLoopsWorld = facesLoopsWorld;
      }
    } catch {
      // ignore
    }

    // 3) 清理内部字段，减小回包体积
    try {
      delete c.__rectLoopsLocal;
      delete c.__clippedLoopsLocal;
      delete c.__dx;
      delete c.__dy;
      delete c.__swapXY;
      delete c.__effInputs;
    } catch {
      // ignore
    }
  };

  for (const c of candidates) materializeCandidateForResponse(c);

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
    lenCV: c.lenCV,
    minL: c.minL,
    sumL: c.sumL,
    efficiencyScoreDetail: c.efficiencyScoreDetail ?? c.metrics?.efficiencyScoreDetail ?? null,
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
      efficiencyScoreV2: {
        version: EFF_SCORE_VERSION,
        coverageEps: COVERAGE_EPS,
        weights: { ...EFF_SCORE_WEIGHTS_V2 },
      },
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
        '推进离散 CV',
        '最短推进长度 minL（m）',
        '总推进长度 sumL（m）',
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
  const searchProfile = String(payload?.searchProfile ?? 'balanced') === 'exact' ? 'exact' : 'balanced';
  const targetN = Math.max(1, Math.min(20, Math.round(toNum(payload?.targetN) ?? toNum(payload?.N) ?? 1)));

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

  const wbMinRaw = toNum(payload?.boundaryPillarMin);
  const wbMaxRaw = toNum(payload?.boundaryPillarMax);
  const wbFixed = Math.abs(Number(
    toNum(payload?.boundaryPillar)
    ?? (Number.isFinite(wbMinRaw) && Number.isFinite(wbMaxRaw) ? Math.min(wbMinRaw, wbMaxRaw) : (Number.isFinite(wbMinRaw) ? wbMinRaw : (Number.isFinite(wbMaxRaw) ? wbMaxRaw : 0)))
  ) || 0);
  const wsMin = Math.max(0, Number(toNum(payload?.coalPillarMin) ?? 0) || 0);
  const wsMax = Math.max(0, Number(toNum(payload?.coalPillarMax) ?? wsMin) || 0);
  const wsTarget = toNum(payload?.coalPillarTarget);
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

  const wsSamples = (searchProfile === 'exact')
    ? enumRangeBy1m(wsMin, wsMax)
    : sampleWsCoarse(wsMin, wsMax, wsTarget, 9);
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
        omegaPrepared: prepareOmegaForRects({ omegaPoly: innerPoly, debugRef: null }),
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
