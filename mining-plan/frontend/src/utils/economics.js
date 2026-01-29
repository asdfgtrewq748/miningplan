const clamp01 = (x) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
};

const toFinite = (v, fallback) => {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const yuanToWan = (yuan) => (Number(yuan) || 0) / 10000;

export function computeEconomicsFromPlan({ plan, risk, params }) {
  const p = params && typeof params === 'object' ? params : {};

  if (!plan?.ok) {
    return { ok: false, reason: '缺少接续阶段1排程结果（请先在“采掘接续”生成排程）。' };
  }

  const monthly = Array.isArray(plan?.monthly) ? plan.monthly : [];
  if (!monthly.length) {
    return { ok: false, reason: '接续排程缺少月度产量数据。' };
  }

  const priceYuanPerTon = Math.max(0, toFinite(p.coalPriceYuanPerTon, 800));
  const salesRatio = clamp01(p.salesRatio ?? 1);
  const opexVarYuanPerTon = Math.max(0, toFinite(p.opexVarYuanPerTon, 320));
  const opexFixedWanPerMonth = Math.max(0, toFinite(p.opexFixedWanPerMonth, 300));

  const capexInitialWan = Math.max(0, toFinite(p.capexInitialWan, 30000));
  const capexSustainWanPerYear = Math.max(0, toFinite(p.capexSustainWanPerYear, 0));

  // 贴现率：与其它输入一致，空字符串时回退默认值。
  // 注意：UI 用 number input，编辑过程中可能短暂出现 ''。
  const discountRate = clamp01(toFinite(p.discountRate, 0.10));
  const monthlyDiscountRate = Math.pow(1 + discountRate, 1 / 12) - 1;

  // 风险联动（可选）：超过阈值则按比例减产
  const riskLinkEnabled = Boolean(p.riskLinkEnabled ?? true);
  const riskMetricKey = String(p.riskMetricKey ?? (risk?.metric ?? 'p90'));
  const riskImpactThreshold = clamp01(p.riskImpactThreshold ?? 0.85);
  const riskDowntimeRatio = clamp01(p.riskDowntimeRatio ?? 0.10);
  const riskExtraCostWanPerHighRiskMonth = Math.max(0, toFinite(p.riskExtraCostWanPerHighRiskMonth, 0));

  const riskRowByMonth = (() => {
    const rows = Array.isArray(risk?.rows) ? risk.rows : [];
    const map = new Map();
    for (const r of rows) {
      const m = Math.round(Number(r?.month));
      if (Number.isFinite(m) && m >= 1) map.set(m, r);
    }
    return map;
  })();

  const rows = [];
  let cumCashYuan = 0;

  for (const r of monthly) {
    const month = Math.max(1, Math.round(Number(r?.month) || 0));
    const tonnage = Math.max(0, toFinite(r?.tonnage, 0));
    const workface = (r?.workface == null) ? '' : String(r.workface);

    const riskRow = riskRowByMonth.get(month) || null;
    const riskVal = riskRow ? toFinite(riskRow?.[riskMetricKey], null) : null;
    const isHighRisk = (riskLinkEnabled && (riskVal != null) && (riskVal >= riskImpactThreshold));

    const tonnageAdj = isHighRisk ? tonnage * (1 - riskDowntimeRatio) : tonnage;

    const revenueYuan = tonnageAdj * priceYuanPerTon * salesRatio;
    const varCostYuan = tonnageAdj * opexVarYuanPerTon;
    const fixedCostYuan = opexFixedWanPerMonth * 10000;
    const sustainCapexYuan = (capexSustainWanPerYear / 12) * 10000;
    const riskExtraCostYuan = isHighRisk ? (riskExtraCostWanPerHighRiskMonth * 10000) : 0;

    // 初始投资：记在第1个月
    const capexInitialYuan = (month === 1) ? (capexInitialWan * 10000) : 0;

    const netCashYuan = revenueYuan - varCostYuan - fixedCostYuan - sustainCapexYuan - riskExtraCostYuan - capexInitialYuan;
    cumCashYuan += netCashYuan;

    rows.push({
      month,
      workface,
      tonnage,
      tonnageAdj,
      risk: riskVal,
      isHighRisk,
      revenueWan: yuanToWan(revenueYuan),
      varCostWan: yuanToWan(varCostYuan),
      fixedCostWan: opexFixedWanPerMonth,
      sustainCapexWan: capexSustainWanPerYear / 12,
      riskExtraCostWan: yuanToWan(riskExtraCostYuan),
      capexInitialWan: yuanToWan(capexInitialYuan),
      netCashWan: yuanToWan(netCashYuan),
      cumCashWan: yuanToWan(cumCashYuan),
    });
  }

  // NPV
  let npvYuan = 0;
  for (let i = 0; i < rows.length; i++) {
    const t = i + 1;
    const cfYuan = (rows[i]?.netCashWan || 0) * 10000;
    const disc = Math.pow(1 + monthlyDiscountRate, t);
    npvYuan += cfYuan / disc;
  }

  // 回收期（月）：累计现金流首次>=0
  let paybackMonth = null;
  for (const r of rows) {
    if ((r?.cumCashWan ?? -Infinity) >= 0) {
      paybackMonth = r.month;
      break;
    }
  }

  const totalRevenueWan = rows.reduce((a, b) => a + (b?.revenueWan || 0), 0);
  const totalCostWan = rows.reduce((a, b) => a + (b?.varCostWan || 0) + (b?.fixedCostWan || 0) + (b?.sustainCapexWan || 0) + (b?.riskExtraCostWan || 0) + (b?.capexInitialWan || 0), 0);
  const totalNetCashWan = rows.reduce((a, b) => a + (b?.netCashWan || 0), 0);

  const totalTonnage = rows.reduce((a, b) => a + (b?.tonnageAdj || 0), 0);
  const unitCostYuanPerTon = totalTonnage > 1e-9
    ? ((totalCostWan * 10000) / totalTonnage)
    : null;

  return {
    ok: true,
    computedAt: Date.now(),
    rows,
    summary: {
      months: rows.length,
      npvWan: yuanToWan(npvYuan),
      discountRateYear: discountRate,
      discountRateMonth: monthlyDiscountRate,
      paybackMonth,
      totalRevenueWan,
      totalCostWan,
      totalNetCashWan,
      unitCostYuanPerTon,
      unitMarginYuanPerTon: (unitCostYuanPerTon == null) ? null : (priceYuanPerTon - unitCostYuanPerTon),
      highRiskMonths: rows.filter((r) => Boolean(r?.isHighRisk)).length,
      lastCumCashWan: rows.length ? rows[rows.length - 1].cumCashWan : 0,
    },
  };
}
