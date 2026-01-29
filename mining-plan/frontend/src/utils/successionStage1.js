// 阶段1：前端确定性接续排程（不依赖后端）

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

export function computeWorkfaceDimsFromLoop(loop) {
  const pts = (Array.isArray(loop) ? loop : [])
    .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) {
    return {
      center: { x: 0, y: 0 },
      widthM: 0,
      advanceLengthM: 0,
      advanceAxis: { x: 1, y: 0 },
      widthAxis: { x: 0, y: 1 },
      advanceMin: 0,
      advanceMax: 0,
      widthMin: 0,
      widthMax: 0,
    };
  }

  const center = pts.reduce((acc, p) => ({ x: acc.x + p.x / pts.length, y: acc.y + p.y / pts.length }), { x: 0, y: 0 });

  // PCA 主方向估计
  let covXX = 0;
  let covXY = 0;
  let covYY = 0;
  for (const p of pts) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    covXX += dx * dx;
    covXY += dx * dy;
    covYY += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  let u = { x: Math.cos(angle), y: Math.sin(angle) };
  const uLen = Math.hypot(u.x, u.y);
  if (!(Number.isFinite(uLen) && uLen > 1e-9)) u = { x: 1, y: 0 };
  else u = { x: u.x / uLen, y: u.y / uLen };
  const v = { x: -u.y, y: u.x };

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of pts) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const su = dx * u.x + dy * u.y;
    const sv = dx * v.x + dy * v.y;
    if (su < minU) minU = su;
    if (su > maxU) maxU = su;
    if (sv < minV) minV = sv;
    if (sv > maxV) maxV = sv;
  }

  const L0 = maxU - minU;
  const L1 = maxV - minV;

  // 选择“推进主轴”为更长的方向；再基于该轴重算投影范围，避免符号翻转带来的 min/max 混乱
  let advanceAxis = (L0 >= L1) ? u : v;
  const advanceLen = Math.hypot(advanceAxis.x, advanceAxis.y);
  if (!(Number.isFinite(advanceLen) && advanceLen > 1e-9)) advanceAxis = { x: 1, y: 0 };
  else advanceAxis = { x: advanceAxis.x / advanceLen, y: advanceAxis.y / advanceLen };
  const widthAxis = { x: -advanceAxis.y, y: advanceAxis.x };

  let advanceMin = Infinity;
  let advanceMax = -Infinity;
  let widthMin = Infinity;
  let widthMax = -Infinity;
  for (const p of pts) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const sa = dx * advanceAxis.x + dy * advanceAxis.y;
    const sw = dx * widthAxis.x + dy * widthAxis.y;
    if (sa < advanceMin) advanceMin = sa;
    if (sa > advanceMax) advanceMax = sa;
    if (sw < widthMin) widthMin = sw;
    if (sw > widthMax) widthMax = sw;
  }

  const advanceLengthM = Math.max(0, advanceMax - advanceMin);
  const widthM = Math.max(0, widthMax - widthMin);

  return {
    center,
    widthM,
    advanceLengthM,
    advanceAxis,
    widthAxis,
    advanceMin: Number.isFinite(advanceMin) ? advanceMin : 0,
    advanceMax: Number.isFinite(advanceMax) ? advanceMax : 0,
    widthMin: Number.isFinite(widthMin) ? widthMin : 0,
    widthMax: Number.isFinite(widthMax) ? widthMax : 0,
  };
}

function buildTasksForPanels(panels, params) {
  const daysPerMonth = Math.max(1, Math.round(toFinite(params.daysPerMonth, 25)));
  const utilization = clamp01(params.utilization ?? 0.85);

  const shearAdvanceRate = Math.max(0, toFinite(params.shearAdvanceRate, 6)); // m/d
  const driveRate = Math.max(0, toFinite(params.driveRate, 15)); // m/d

  const installDays = Math.max(0, toFinite(params.installDays, 15));
  const relocationDays = Math.max(0, toFinite(params.relocationDays, 10));

  const singleFaceMining = Boolean(params.singleFaceMining ?? true);
  const driveParallelWithMining = Boolean(params.driveParallelWithMining ?? true);
  const driveCrews = Math.max(1, Math.round(toFinite(params.driveCrews, 1)));

  const tasks = [];

  let lastMiningEndDay = 0;
  let lastRelocationEndDay = 0;
  const driveCrewEndDay = new Array(driveCrews).fill(0);

  const takeEarliestCrew = () => {
    let idx = 0;
    let best = driveCrewEndDay[0] ?? 0;
    for (let i = 1; i < driveCrewEndDay.length; i++) {
      const t = driveCrewEndDay[i] ?? 0;
      if (t < best) {
        best = t;
        idx = i;
      }
    }
    return { idx, day: best };
  };

  panels.forEach((p, i) => {
    const id = String(p.id ?? `WF-${i + 1}`);
    const lengthM = Math.max(0, toFinite(p.advanceLengthM ?? p.lengthM ?? p.length ?? 0, 0));

    // Drive
    const driveDays = driveRate > 1e-9 ? (lengthM / driveRate) / Math.max(1e-6, utilization) : 0;
    const crew = takeEarliestCrew();
    let driveStart = crew.day;
    if (!driveParallelWithMining && i > 0) driveStart = Math.max(driveStart, lastMiningEndDay);
    const driveEnd = driveStart + driveDays;
    driveCrewEndDay[crew.idx] = driveEnd;

    tasks.push({ type: 'drive', workface: id, startDay: driveStart, endDay: driveEnd });

    // Install
    const installStart = Math.max(driveEnd, lastRelocationEndDay);
    const installEnd = installStart + installDays;
    tasks.push({ type: 'install', workface: id, startDay: installStart, endDay: installEnd });

    // Mining
    let miningStart = installEnd;
    if (singleFaceMining && i > 0) miningStart = Math.max(miningStart, lastMiningEndDay);

    const miningDays = shearAdvanceRate > 1e-9 ? (lengthM / shearAdvanceRate) / Math.max(1e-6, utilization) : 0;
    const miningEnd = miningStart + miningDays;
    tasks.push({ type: 'mining', workface: id, startDay: miningStart, endDay: miningEnd, lengthM });

    // Relocation (between panels)
    if (i < panels.length - 1) {
      const relStart = miningEnd;
      const relEnd = relStart + relocationDays;
      tasks.push({ type: 'relocation', workface: id, startDay: relStart, endDay: relEnd });
      lastRelocationEndDay = relEnd;
    }

    lastMiningEndDay = miningEnd;
  });

  return { tasks, daysPerMonth };
}

function buildMonthlyProduction({ panelsById, tasks, params, daysPerMonth }) {
  const coalDensity = Math.max(0, toFinite(params.coalDensity, 1.35));
  const miningHeightM = Math.max(0, toFinite(params.miningHeightM, 4.5));

  // recoveryRate：阶段1 用均值（保留你现有 min/max 输入框）
  const rrMin = clamp01(params.recoveryRateMin ?? 0.85);
  const rrMax = clamp01(params.recoveryRateMax ?? 0.95);
  const recoveryRate = clamp01((rrMin + rrMax) / 2);

  const utilization = clamp01(params.utilization ?? 0.85);
  const shearAdvanceRate = Math.max(0, toFinite(params.shearAdvanceRate, 6)); // m/d

  const miningTasks = tasks.filter((t) => t.type === 'mining');
  if (miningTasks.length === 0) return [];

  const totalEndDay = Math.max(...miningTasks.map((t) => t.endDay));
  const totalMonths = Math.max(1, Math.ceil(totalEndDay / daysPerMonth));

  const out = [];
  for (let m = 1; m <= totalMonths; m++) {
    const mStart = (m - 1) * daysPerMonth;
    const mEnd = m * daysPerMonth;

    let tonnage = 0;
    let minedLen = 0;

    for (const t of miningTasks) {
      const overlap = Math.max(0, Math.min(t.endDay, mEnd) - Math.max(t.startDay, mStart));
      if (!(overlap > 1e-9)) continue;

      const wf = panelsById.get(String(t.workface));
      const widthM = Math.max(0, toFinite(wf?.widthM ?? wf?.width ?? 0, 0));

      // overlapDays * (m/d) 得到推进长度（m）
      const len = overlap * shearAdvanceRate * utilization;
      minedLen += len;

      // 体积=推进len*宽*采高；吨位=体积*密度*回收率
      const volume = len * widthM * miningHeightM;
      tonnage += volume * coalDensity * recoveryRate;
    }

    out.push({ month: m, tonnage, minedLen });
  }

  return out;
}

export function buildSuccessionStage1Plan(panels, params) {
  const ps = Array.isArray(panels) ? panels : [];
  const p0 = params && typeof params === 'object' ? params : {};

  const { tasks, daysPerMonth } = buildTasksForPanels(ps, p0);

  const panelsById = new Map(ps.map((p) => [String(p.id), p]));
  const monthly = buildMonthlyProduction({ panelsById, tasks, params: p0, daysPerMonth });

  const totalEndDay = tasks.length ? Math.max(...tasks.map((t) => t.endDay)) : 0;
  const totalMonths = Math.max(0, Math.ceil(totalEndDay / daysPerMonth));

  return {
    ok: true,
    computedAt: Date.now(),
    tasks,
    daysPerMonth,
    totalMonths,
    monthly,
  };
}
