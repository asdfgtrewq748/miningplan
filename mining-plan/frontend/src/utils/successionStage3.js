// 阶段3：推荐与对比（轻量启发式，不依赖后端）

const clamp01 = (x) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
};

const toFinite = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function computeTargetTonsPerMonth(mineCapacityWanPerYear) {
  const capWan = Number(mineCapacityWanPerYear);
  if (!Number.isFinite(capWan) || capWan <= 0) return null;
  return (capWan * 10000) / 12;
}

export function computeProductionKpis(monthlyRows, targetTonsPerMonth) {
  const rows = Array.isArray(monthlyRows) ? monthlyRows : [];
  if (!rows.length) {
    return {
      months: 0,
      minTonnage: null,
      meanTonnage: null,
      maxDeficit: null,
      hitRate: null,
    };
  }

  const target = Number.isFinite(Number(targetTonsPerMonth)) ? Number(targetTonsPerMonth) : null;

  let minT = Infinity;
  let sum = 0;
  let maxDef = 0;
  let hits = 0;

  for (const r of rows) {
    const t = Math.max(0, toFinite(r?.tonnage, 0));
    if (t < minT) minT = t;
    sum += t;
    if (target != null) {
      const def = Math.max(0, target - t);
      if (def > maxDef) maxDef = def;
      if (t >= target) hits++;
    }
  }

  return {
    months: rows.length,
    minTonnage: Number.isFinite(minT) ? minT : null,
    meanTonnage: sum / rows.length,
    maxDeficit: (target != null) ? maxDef : null,
    hitRate: (target != null) ? (hits / rows.length) : null,
  };
}

const parsePlannedFaceIndexFromPanelId = (panelId) => {
  const s = String(panelId ?? '').trim();
  const m = /^No\.(\d+)$/i.exec(s);
  if (!m) return null;
  const fi = Number(m[1]);
  return Number.isFinite(fi) && fi >= 1 ? fi : null;
};

const pickNearestCurvePoint = (curve, pct) => {
  const rows = Array.isArray(curve) ? curve : [];
  if (!rows.length) return null;
  const p = clamp01(Number(pct) / 100) * 100;
  let best = rows[0];
  let bestD = Math.abs(Number(best?.pct) - p);
  for (let i = 1; i < rows.length; i++) {
    const d = Math.abs(Number(rows[i]?.pct) - p);
    if (d < bestD) {
      best = rows[i];
      bestD = d;
    }
  }
  return best;
};

export function estimateMonthlyRiskFromCocontrolCurves({ plan, coOdiAnalysisResult, metric }) {
  const pr = plan ?? null;
  if (!pr?.ok) return null;
  if (!coOdiAnalysisResult?.ok) return null;

  const faces = Array.isArray(coOdiAnalysisResult?.faces) ? coOdiAnalysisResult.faces : [];
  if (!faces.length) return null;
  const faceByKey = new Map(faces.map((f) => [String(f?.key ?? ''), f]));

  const tasks = Array.isArray(pr?.tasks) ? pr.tasks : [];
  const miningTasks = tasks.filter((t) => t?.type === 'mining' && Number.isFinite(t?.startDay) && Number.isFinite(t?.endDay));
  if (!miningTasks.length) return null;

  const daysPerMonth = Math.max(1, Math.round(Number(pr?.daysPerMonth) || 25));
  const totalMonths = Math.max(1, Math.round(Number(pr?.totalMonths) || 1));

  const metricKey = (() => {
    const m = String(metric ?? 'p90');
    if (m === 'p95') return 'p95';
    if (m === 'mean') return 'mean';
    // 阶段2的 exceed(>=阈值) 无法用 curve 精确重算；这里对齐协同调控的 exceedT2 口径
    if (m === 'exceed') return 'exceedT2';
    return 'p90';
  })();

  const rows = [];
  for (let month = 1; month <= totalMonths; month++) {
    const mStart = (month - 1) * daysPerMonth;
    const mEnd = month * daysPerMonth;

    const active = miningTasks.filter((t) => (t.startDay < mEnd) && (t.endDay > mStart));
    if (!active.length) {
      rows.push({ month, value: null, activeFaces: 0 });
      continue;
    }

    let best = null;
    for (const t of active) {
      const fi = parsePlannedFaceIndexFromPanelId(t.workface);
      if (!fi) continue;
      const face = faceByKey.get(`planned:${fi}`);
      if (!face) continue;

      const dur = Math.max(1e-6, Number(t.endDay) - Number(t.startDay));
      const fracEnd = clamp01((mEnd - Number(t.startDay)) / dur);
      const pct = fracEnd * 100;
      const hit = pickNearestCurvePoint(face?.curve, pct);
      if (!hit) continue;

      const v = Number(hit?.[metricKey]);
      if (!Number.isFinite(v)) continue;
      if (best == null || v > best) best = v;
    }

    rows.push({ month, value: best, activeFaces: active.length });
  }

  return {
    ok: true,
    source: 'cocontrol-curve',
    metric: String(metric ?? 'p90'),
    metricKey,
    rows,
  };
}

export function scoreScenario({ prodKpis, riskRows, weights }) {
  const w = weights && typeof weights === 'object' ? weights : {};
  const wProd = toFinite(w.wProd, 1.0);
  const wRisk = toFinite(w.wRisk, 1.0);
  const wMonths = toFinite(w.wMonths, 0.15);

  const hitRate = Number.isFinite(prodKpis?.hitRate) ? prodKpis.hitRate : 0;
  const maxDef = Number.isFinite(prodKpis?.maxDeficit) ? prodKpis.maxDeficit : 0;
  const months = Math.max(0, toFinite(prodKpis?.months, 0));

  const riskVals = (riskRows ?? []).map((r) => Number(r?.value)).filter((v) => Number.isFinite(v));
  const riskMax = riskVals.length ? Math.max(...riskVals) : null;

  // 目标：hitRate 越高越好；maxDef 越低越好；riskMax 越低越好；工期越短越好。
  // 这里用简单加权：score 越大越好。
  const sProd = hitRate * 100 - (maxDef / 1000); // 以 1000t 缺口作为 1 分惩罚
  const sRisk = (riskMax == null) ? 0 : (1 - clamp01(riskMax)) * 50;
  const sMonths = -months;

  const score = wProd * sProd + wRisk * sRisk + wMonths * sMonths;
  return { score, riskMax };
}

export function buildStage3Candidates({ baseParams, allowOrderModes, currentOrderMode }) {
  const p0 = baseParams && typeof baseParams === 'object' ? baseParams : {};

  const orderModeLabel = (mode) => {
    const m = String(mode ?? '');
    if (m === 'faceIndex') return '按工作面储量排序（由大到小）';
    if (m === 'yardConfirmed') return '按距工业广场远近排序（由近及远）';
    if (m === 'odiLowFirst') return '按ODI风险低优先（先低后高）';
    return m || '-';
  };

  const clampInt = (x, lo, hi) => {
    const n = Math.round(Number(x));
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
  };

  const base = {
    key: 'base',
    label: '当前参数',
    patch: {},
    orderMode: String(currentOrderMode || 'faceIndex'),
  };

  const crews = clampInt(p0.driveCrews, 1, 4);
  const installDays = Math.max(0, toFinite(p0.installDays, 15));
  const relocationDays = Math.max(0, toFinite(p0.relocationDays, 10));
  const shear = Math.max(0, toFinite(p0.shearAdvanceRate, 6));

  const out = [base];

  out.push({
    key: 'crew+1',
    label: '加1条掘进队',
    patch: { driveCrews: Math.min(4, crews + 1) },
    orderMode: base.orderMode,
  });
  out.push({
    key: 'install-20%',
    label: '安装工期减少20%',
    patch: { installDays: Math.max(0, Math.round(installDays * 0.8)) },
    orderMode: base.orderMode,
  });
  out.push({
    key: 'reloc-20%',
    label: '搬家工期减少20%',
    patch: { relocationDays: Math.max(0, Math.round(relocationDays * 0.8)) },
    orderMode: base.orderMode,
  });
  out.push({
    key: 'reloc-efficiency-pack',
    label: '搬家提效组合包：安装/搬家各减少20%',
    patch: {
      installDays: Math.max(0, Math.round(installDays * 0.8)),
      relocationDays: Math.max(0, Math.round(relocationDays * 0.8)),
    },
    orderMode: base.orderMode,
  });
  out.push({
    key: 'shear+10%',
    label: '回采推进速度提高10%',
    patch: { shearAdvanceRate: Number((shear * 1.10).toFixed(2)) },
    orderMode: base.orderMode,
  });

  out.push({
    key: 'crew+1+install-20%',
    label: '掘进队增加1条，安装工期减少20%',
    patch: { driveCrews: Math.min(4, crews + 1), installDays: Math.max(0, Math.round(installDays * 0.8)) },
    orderMode: base.orderMode,
  });

  // 注：不再生成“调整回采顺序：...”候选，避免与面序下拉选择重复。

  // 去重
  const seen = new Set();
  return out.filter((c) => {
    const k = `${c.key}|${JSON.stringify(c.patch)}|${c.orderMode}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
