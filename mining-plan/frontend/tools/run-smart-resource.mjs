import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { compute } from '../src/planning/workers/smartResource.worker.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq >= 0) {
      const k = token.slice(2, eq);
      const v = token.slice(eq + 1);
      args[k] = v;
    } else {
      const k = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[k] = next;
        i += 1;
      } else {
        args[k] = true;
      }
    }
  }
  return args;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pointKey(p) {
  return `${Number(p.x).toFixed(6)},${Number(p.y).toFixed(6)}`;
}

function dedupePoints(points) {
  const seen = new Set();
  const out = [];
  for (const p of points) {
    const k = pointKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points) {
  const pts = [...points].sort((p1, p2) => (p1.x === p2.x ? p1.y - p2.y : p1.x - p2.x));
  if (pts.length <= 3) return pts;

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }

  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function orient(a, b, c) {
  return Math.sign(cross(a, b, c));
}

function onSegment(a, b, c) {
  // c on segment ab
  return (
    Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y) &&
    Math.abs(cross(a, b, c)) < 1e-9
  );
}

function segmentsIntersect(a1, a2, b1, b2) {
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, a2, b1)) return true;
  if (o2 === 0 && onSegment(a1, a2, b2)) return true;
  if (o3 === 0 && onSegment(b1, b2, a1)) return true;
  if (o4 === 0 && onSegment(b1, b2, a2)) return true;
  return false;
}

function isSimplePolygon(loop) {
  const n = loop.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i += 1) {
    const a1 = loop[i];
    const a2 = loop[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      // skip adjacent edges and same edge
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === n - 1) continue;

      const b1 = loop[j];
      const b2 = loop[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

async function readBoundaryCsv(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length === 0) throw new Error('CSV 为空');

  // 支持两种格式：
  // 1) x,y
  // 2) ID,X,Y
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const hasId = header.includes('id') && header.includes('x') && header.includes('y');
  const hasXY = header.length >= 2 && header[0] === 'x' && header[1] === 'y';

  const start = (hasId || hasXY) ? 1 : 0;
  const pts = [];
  for (let i = start; i < lines.length; i += 1) {
    const cols = lines[i].split(',').map((s) => s.trim());
    if (cols.length < 2) continue;

    if (hasId) {
      if (cols.length < 3) continue;
      const x = Number(cols[1]);
      const y = Number(cols[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push({ x, y });
    } else {
      const x = Number(cols[0]);
      const y = Number(cols[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push({ x, y });
    }
  }

  return dedupePoints(pts);
}

function buildPayload({ boundaryLoopWorld, axis, topK, fullCover, maxTimeMs, faceWidthMin, faceWidthMax, wbMin, wbMax, wsMin, wsMax }) {
  const reqSeq = String(Date.now());
  return {
    reqSeq,
    cacheKey: `offline-${reqSeq}-${axis}`,
    optMode: 'resource',
    axis,

    boundaryLoopWorld,

    // 常用默认（与前端参数编辑器一致）
    boundaryPillarMin: wbMin,
    boundaryPillarMax: wbMax,
    coalPillarMin: wsMin,
    coalPillarMax: wsMax,
    faceWidthMin,
    faceWidthMax,

    strictFaceCount: false,
    faceCountMin: 2,
    faceCountMax: 12,

    faceAdvanceMax: null,

    topK,
    maxTimeMs,

    // 可选：严格时间预算（关闭 grace + per-face extra budget）
    strictTimeBudget: false,

    // 全覆盖（工程验收口径）
    fullCover,
    fullCoverMin: 0.995,
    fullCoverPatch: fullCover,
    fullCoverPatchMaxTimeMs: 1200,
    ignoreCoalPillarsInCoverage: fullCover,

    // per-face
    perFaceTrapezoid: false,
    perFaceExtraBudgetMs: 260,

    // segment width / cleanupResidual（保持与当前 worker 逻辑兼容）
    segmentWidth: {
      enabled: true,
      minGain: 0.001,
      maxIter: 10,
      widenStepM: 2,
      maxWidenM: 20,
    },
    cleanupResidual: {
      enabled: true,
      minResidualRatio: 0.005,
      maxPatches: 50,
      maxTimeMs: 400,
      patchMinArea: 50,
      patchBuffer: 0,
    },
  };
}

function summarizeTopK(result, k = 5) {
  const out = [];
  const cand = Array.isArray(result?.candidates) ? result.candidates : [];
  for (let i = 0; i < Math.min(k, cand.length); i += 1) {
    const c = cand[i];
    out.push({
      rank: i + 1,
      N: c.N,
      B: c.B,
      wb: c.wb,
      ws: c.ws,
      coverage: Number((c.coverageRatio ?? 0) * 100).toFixed(3) + '%',
      coverageEff: c.coverageRatioEff == null ? null : Number(c.coverageRatioEff * 100).toFixed(3) + '%',
      qualified: c.qualified ?? null,
      signature: c.signature,
    });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const input = args._[0] || path.resolve(process.cwd(), '../examples/采区边界.csv');

  const jsonMode = String(args.json ?? 'false').toLowerCase() === 'true';
  const repeat = Math.max(1, Math.min(50, Math.round(toNum(args.repeat) ?? 1)));

  const axisArg = String(args.axis ?? 'both').toLowerCase();
  const axisList = axisArg === 'both' ? ['x', 'y'] : [axisArg];

  const topK = Math.max(1, Math.min(20, Math.round(toNum(args.topK) ?? 5)));
  const fullCover = String(args.fullCover ?? 'true').toLowerCase() !== 'false';
  const maxTimeMs = Math.round(toNum(args.maxTimeMs) ?? 6000);
  const strictTimeBudget = String(args.strictTimeBudget ?? 'false').toLowerCase() === 'true';

  const faceWidthMin = toNum(args.faceWidthMin) ?? 100;
  const faceWidthMax = toNum(args.faceWidthMax) ?? 350;
  const wbMin = toNum(args.wbMin) ?? 65;
  const wbMax = toNum(args.wbMax) ?? 65;
  const wsMin = toNum(args.wsMin) ?? 60;
  const wsMax = toNum(args.wsMax) ?? 100;

  const points = await readBoundaryCsv(input);
  if (points.length < 3) throw new Error(`边界点不足：${points.length}`);

  const loopFromInput = points;
  const loopHull = convexHull(points);

  const loopChosen = isSimplePolygon(loopFromInput) ? loopFromInput : loopHull;
  const chose = loopChosen === loopFromInput ? 'input-order' : 'convex-hull';

  console.log(`Boundary points: ${points.length}, loop=${loopChosen.length}, method=${chose}`);

  for (const axis of axisList) {
    const payload = buildPayload({
      boundaryLoopWorld: loopChosen,
      axis,
      topK,
      fullCover,
      maxTimeMs,
      faceWidthMin,
      faceWidthMax,
      wbMin,
      wbMax,
      wsMin,
      wsMax,
    });

    payload.strictTimeBudget = strictTimeBudget;

    for (let r = 0; r < repeat; r += 1) {
      const t0 = performance.now();
      const result = compute(payload);
      const elapsedMs = performance.now() - t0;

      if (jsonMode) {
        const cand = Array.isArray(result?.candidates) ? result.candidates : [];
        const out = {
          axis,
          run: r + 1,
          ok: Boolean(result?.ok),
          elapsedMs: Number(elapsedMs.toFixed(3)),
          top1: result?.top1 ? {
            N: result.top1.N,
            B: result.top1.B,
            wb: result.top1.wb,
            ws: result.top1.ws,
            qualified: result.top1.qualified ?? null,
            signature: result.top1.signature ?? null,
            coverageRatio: result.top1.coverageRatio ?? null,
            coverageRatioEff: result.top1.coverageRatioEff ?? null,
          } : null,
          candidates: cand.slice(0, topK).map((c) => ({
            N: c?.N,
            B: c?.B,
            wb: c?.wb,
            ws: c?.ws,
            qualified: c?.qualified ?? null,
            signature: c?.signature ?? null,
            coverageRatio: c?.coverageRatio ?? null,
            coverageRatioEff: c?.coverageRatioEff ?? null,
          })),
          failedReason: result?.failedReason || result?.message || null,
          timeBudgetHit: result?.attemptSummary?.timeBudgetHit ?? null,
        };
        console.log(JSON.stringify(out));
        continue;
      }

      console.log(`\n=== axis: ${axis} run=${r + 1}/${repeat} ok=${result?.ok} elapsedMs=${elapsedMs.toFixed(1)} ===`);
      if (!result?.ok) {
        console.log('failedReason:', result?.failedReason || result?.message || '');
        console.log('debug.boundaryNormalized:', result?.debug?.boundaryNormalized || null);
        continue;
      }

      console.log('top1:', {
        N: result?.top1?.N,
        B: result?.top1?.B,
        wb: result?.top1?.wb,
        ws: result?.top1?.ws,
        signature: result?.top1?.signature ?? null,
        coveragePct: result?.top1?.coverageRatio == null ? null : Number(result.top1.coverageRatio * 100).toFixed(3) + '%',
        coverageEffPct: result?.top1?.coverageRatioEff == null ? null : Number(result.top1.coverageRatioEff * 100).toFixed(3) + '%',
        qualified: result?.top1?.qualified,
        omegaAreaEff: result?.top1?.omegaAreaEff,
        pillarArea: result?.top1?.pillarArea,
        residualAreaEff: result?.top1?.residualAreaEff,
      });

      console.table(summarizeTopK(result, topK));

      if (result?.attemptSummary?.timeBudgetHit) {
        console.log('NOTE: timeBudgetHit=true; consider increasing --maxTimeMs');
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
