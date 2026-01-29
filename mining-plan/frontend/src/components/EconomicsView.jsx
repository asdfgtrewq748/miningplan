import React, { useMemo, useState } from 'react';
import { CircleDollarSign, ArrowRight } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
  Line,
} from 'recharts';

export default function EconomicsView({ result, onGoSuccession }) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const s = result?.summary ?? null;

  const yearCount = Math.max(1, Math.ceil(rows.length / 12));
  const yearOptions = useMemo(() => {
    return Array.from({ length: yearCount }, (_, i) => i + 1);
  }, [yearCount]);

  const [yearRevenueCost, setYearRevenueCost] = useState('1');
  const [yearTonnageRisk, setYearTonnageRisk] = useState('1');
  const [yearUnitMetrics, setYearUnitMetrics] = useState('1');
  const [yearMonthlyTable, setYearMonthlyTable] = useState('1');
  const [yearCashflow, setYearCashflow] = useState('1');

  const COLORS = {
    // 用户指定 RGB 配色（工程经济分析）
    // 第一个表：净现金流/累计现金流/折现累计
    netCash: 'rgb(77,133,189)',
    cumCash: 'rgb(247,144,61)',
    cumNpv: 'rgb(89,169,90)',

    // 收入（万元）
    revenue: 'rgb(127,165,183)',

    // 成本构成（万元）
    costVar: 'rgb(210,32,39)',
    costInitial: 'rgb(56,89,137)',
    // 未显式给定的成本项：采用同体系的辅助色（保持整体一致）
    costFixed: 'rgb(129,184,223)',
    costSustain: 'rgb(77,133,189)',
    costRisk: 'rgb(254,129,125)',

    // 风险
    risk: 'rgb(210,32,39)',
    riskMid: 'rgb(254,129,125)',
    riskLow: 'rgb(129,184,223)',
    riskMissing: 'rgb(148,163,184)',

    // 产量-风险联动
    tonnageBase: 'rgb(56,89,137)',
    tonnageAdj: 'rgb(127,165,183)',

    // 单位指标（元/吨）
    unitCost: 'rgb(77,133,189)',
    unitMargin: 'rgb(247,144,61)',
    unitNet: 'rgb(89,169,90)',
  };

  const formatNumber = (v, digits = 1) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };
  const formatInt = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return Math.round(n).toLocaleString('en-US');
  };

  const RADIAN = Math.PI / 180;
  const makeOutsideValueLabel = (valueFormatter) => (props) => {
    const { cx, cy, midAngle, outerRadius, value, fill } = props;
    if (!Number.isFinite(Number(value))) return null;
    const r = (Number(outerRadius) || 0) + 14;
    const x = (Number(cx) || 0) + r * Math.cos(-midAngle * RADIAN);
    const y = (Number(cy) || 0) + r * Math.sin(-midAngle * RADIAN);
    const anchor = x > (Number(cx) || 0) ? 'start' : 'end';
    const txt = valueFormatter ? valueFormatter(value) : String(value);
    if (!txt || txt === '-') return null;
    return (
      <text
        x={x}
        y={y}
        textAnchor={anchor}
        dominantBaseline="central"
        fill={fill || '#475569'}
        fontSize={12}
        fontWeight={700}
      >
        {txt}
      </text>
    );
  };

  const formatWan = (v, digits = 1) => formatNumber(v, digits);
  const formatYuanPerTon = (v) => formatNumber(v, 1);
  const formatTon = (v) => formatInt(v);
  const formatWanTon = (v) => formatNumber(v, 2);
  const formatRisk01 = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  };
  const formatPercent = (v, digits = 1) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return (n * 100).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + '%';
  };
  const tooltipFormatter = (value, name) => {
    const key = String(name || '');
    if (key.includes('元/吨') || key.includes('元每吨')) {
      const label = key
        .replace(/_元每吨/g, '')
        .replace(/\(元\/吨\)/g, '')
        .replace(/（元\/吨）/g, '');
      return [`${formatYuanPerTon(value)} 元/吨`, label];
    }
    if (key.includes('万元')) {
      const label = key
        .replace(/_万元/g, '')
        .replace(/\(万元\)/g, '')
        .replace(/（万元）/g, '');
      return [`${formatWan(value)} 万元`, label];
    }
    if (key.includes('风险值') || key.includes('0~1')) return [formatRisk01(value), '调整风险值'];
    if (key.includes('万t')) {
      const label = key
        .replace(/_万t/g, '')
        .replace(/\(万t\)/g, '')
        .replace(/（万t）/g, '');
      return [`${formatWanTon(value)} 万t`, label];
    }
    if (key.includes('产量') || key.includes('吨')) {
      const label = key
        .replace(/_吨/g, '')
        .replace(/\(吨\)/g, '')
        .replace(/（吨）/g, '');
      return [`${formatTon(value)} 吨`, label];
    }
    return [String(value ?? ''), key];
  };

  function safeNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  const sumWan = (key) => rows.reduce((acc, r) => acc + safeNum(r?.[key], 0), 0);

  const monthlyDiscountRate = useMemo(() => {
    const m = Number(s?.discountRateMonth);
    if (Number.isFinite(m) && m > -0.999999) return m;
    const y = Number(s?.discountRateYear);
    if (Number.isFinite(y) && y > -0.999999) return Math.pow(1 + y, 1 / 12) - 1;
    return 0;
  }, [s?.discountRateMonth, s?.discountRateYear]);
  const totalRevenueWan = sumWan('revenueWan');
  const totalVarCostWan = sumWan('varCostWan');
  const totalFixedCostWan = sumWan('fixedCostWan');
  const totalSustainWan = sumWan('sustainCapexWan');
  const totalRiskExtraWan = sumWan('riskExtraCostWan');
  const totalInitialCapexWan = sumWan('capexInitialWan');
  const totalNetCashWan = sumWan('netCashWan');
  const totalNetCashWanAll = Number.isFinite(Number(s?.totalNetCashWan))
    ? Number(s.totalNetCashWan)
    : totalNetCashWan;
  const netCashRateAll = (Number.isFinite(Number(totalRevenueWan)) && Math.abs(Number(totalRevenueWan)) > 1e-9)
    ? (totalNetCashWanAll / totalRevenueWan)
    : null;
  const months = rows.length;
  const highRiskMonths = rows.reduce((acc, r) => acc + (r?.isHighRisk ? 1 : 0), 0);

  const donutCostData = useMemo(() => {
    // 仅此板块按用户指定 RGB 配色
    const COST_RGB = {
      var: 'rgb(77,133,189)',
      initial: 'rgb(247,144,61)',
      other: 'rgb(89,169,90)',
    };
    const parts = [
      { name: '变动成本', value: totalVarCostWan, color: COST_RGB.var },
      { name: '固定成本', value: totalFixedCostWan, color: COST_RGB.other },
      { name: '维持性投资', value: totalSustainWan, color: COST_RGB.other },
      { name: '风险附加', value: totalRiskExtraWan, color: COST_RGB.other },
      { name: '初始投资', value: totalInitialCapexWan, color: COST_RGB.initial },
    ];
    return parts.filter((d) => Number.isFinite(d.value) && Math.abs(d.value) > 1e-9);
  }, [totalVarCostWan, totalFixedCostWan, totalSustainWan, totalRiskExtraWan, totalInitialCapexWan]);

  const donutCashData = useMemo(() => {
    // 现金流汇总：收入 vs 总成本 vs 净现金流（净现金流可能为负，环形图用绝对值展示，并在中心显示符号）
    const totalCostWan = totalVarCostWan + totalFixedCostWan + totalSustainWan + totalRiskExtraWan + totalInitialCapexWan;
    const netAbs = Math.abs(totalNetCashWanAll);
    const parts = [
      // 按用户指定：收入=210,32,39；总成本=56,89,137；净现金流(绝对值)=127,165,183
      { name: '收入', value: totalRevenueWan, color: COLORS.costVar },
      { name: '总成本', value: totalCostWan, color: COLORS.costInitial },
      { name: '净现金流(绝对值)', value: netAbs, color: COLORS.revenue },
    ];
    return parts.filter((d) => Number.isFinite(d.value) && d.value > 1e-9);
  }, [totalRevenueWan, totalVarCostWan, totalFixedCostWan, totalSustainWan, totalRiskExtraWan, totalInitialCapexWan, totalNetCashWanAll]);

  const donutRiskData = useMemo(() => {
    // 方案A：风险等级分布（0~1）
    // - 高风险：isHighRisk（阈值来自经济分析风险联动设置）
    // - 中风险：risk >= 0.5 且非高风险
    // - 低风险：risk < 0.5
    // - 无数据：risk 为空/非数
    let low = 0;
    let mid = 0;
    let high = 0;
    let missing = 0;
    for (const r of rows) {
      const rv = Number(r?.risk);
      if (!Number.isFinite(rv)) {
        missing += 1;
        continue;
      }
      if (r?.isHighRisk) {
        high += 1;
        continue;
      }
      if (rv >= 0.5) {
        mid += 1;
      } else {
        low += 1;
      }
    }

    return [
      { name: '高风险', value: high, color: COLORS.risk },
      { name: '中风险(≥0.5)', value: mid, color: COLORS.riskMid },
      { name: '低风险(<0.5)', value: low, color: COLORS.riskLow },
      { name: '无风险数据', value: missing, color: COLORS.riskMissing },
    ].filter((d) => d.value > 0);
  }, [rows, COLORS.risk, COLORS.riskMid, COLORS.riskLow, COLORS.riskMissing]);

  const unitYuanPerTon = (wan, ton) => {
    const t = Number(ton);
    if (!(Number.isFinite(t) && t > 0)) return null;
    const w = Number(wan);
    if (!Number.isFinite(w)) return null;
    return (w * 10000) / t;
  };

  const chartData = useMemo(() => {
    return rows.map((r, idx) => {
      const year = Math.floor(idx / 12) + 1;
      const monthInYear = (idx % 12) + 1;
      const month = safeNum(r?.month, idx + 1);

      const revenueWan = safeNum(r?.revenueWan, 0);
      const varCostWan = safeNum(r?.varCostWan, 0);
      const fixedCostWan = safeNum(r?.fixedCostWan, 0);
      const sustainCapexWan = safeNum(r?.sustainCapexWan, 0);
      const riskExtraCostWan = safeNum(r?.riskExtraCostWan, 0);
      const capexInitialWan = safeNum(r?.capexInitialWan, 0);
      const netCashWan = safeNum(r?.netCashWan, 0);
      const cumCashWan = safeNum(r?.cumCashWan, 0);

      const totalCostWan = varCostWan + fixedCostWan + sustainCapexWan + riskExtraCostWan + capexInitialWan;
      const marginWan = revenueWan - totalCostWan;

      return {
        month,
        monthIndex: month,
        year,
        monthInYear,

        收入_万元: revenueWan,
        变动成本_万元: varCostWan,
        维持性投资_万元: sustainCapexWan,
        风险附加成本_万元: riskExtraCostWan,
        初始投资_万元: capexInitialWan,

        产量_吨: safeNum(r?.tonnage, 0),
        产量_吨_风险调整: safeNum(r?.tonnageAdj, 0),
        产量_万t: safeNum(r?.tonnage, 0) / 10000,
        产量_万t_风险调整: safeNum(r?.tonnageAdj, 0) / 10000,
        风险值_0_1: (() => {
          const rv = Number(r?.risk);
          return Number.isFinite(rv) ? rv : null;
        })(),

        净现金流_万元: netCashWan,
        累计现金流_万元: cumCashWan,

        单位净现金流_元每吨: unitYuanPerTon(netCashWan, r?.tonnageAdj),
        单位总成本_元每吨: unitYuanPerTon(totalCostWan, r?.tonnageAdj),
        单位毛利_元每吨: unitYuanPerTon(marginWan, r?.tonnageAdj),
      };
    });
  }, [rows]);

  const getYearFiltered = (data, yearValue) => {
    if (!Array.isArray(data) || data.length === 0) return [];
    if (yearValue === 'all') return data;
    const y = Number(yearValue);
    if (!Number.isFinite(y)) return data;
    return data.filter((d) => d?.year === y);
  };

  const revenueCostData = getYearFiltered(chartData, yearRevenueCost);
  const revenueCostXAxisKey = (yearRevenueCost === 'all') ? 'month' : 'monthInYear';

  const hasAnyNonZero = (data, key) => {
    if (!Array.isArray(data) || data.length === 0) return false;
    for (const row of data) {
      const v = Number(row?.[key]);
      if (Number.isFinite(v) && Math.abs(v) > 1e-9) return true;
    }
    return false;
  };

  const showVarCost = hasAnyNonZero(revenueCostData, '变动成本_万元');
  const showSustain = hasAnyNonZero(revenueCostData, '维持性投资_万元');
  const showRiskExtra = hasAnyNonZero(revenueCostData, '风险附加成本_万元');
  const showInitial = hasAnyNonZero(revenueCostData, '初始投资_万元');
  const showRevenue = hasAnyNonZero(revenueCostData, '收入_万元');
  const showRevenueCostLegend = showVarCost || showSustain || showRiskExtra || showInitial || showRevenue;

  const tonnageRiskData = getYearFiltered(chartData, yearTonnageRisk);
  const tonnageRiskXAxisKey = (yearTonnageRisk === 'all') ? 'month' : 'monthInYear';

  const cashflowBase = getYearFiltered(chartData, yearCashflow);
  const cashflowXAxisKey = (yearCashflow === 'all') ? 'month' : 'monthInYear';
  const cashflowData = useMemo(() => {
    if (yearCashflow === 'all') {
      let runDisc = 0;
      return cashflowBase.map((d) => {
        const net = Number(d?.净现金流_万元);
        const t = Number(d?.month);
        const disc = Math.pow(1 + monthlyDiscountRate, (Number.isFinite(t) && t >= 1) ? t : 1);
        const pv = (Number.isFinite(net) && disc > 0) ? (net / disc) : (Number.isFinite(net) ? net : 0);
        runDisc += pv;
        return {
          ...d,
          展示累计现金流_万元: d.累计现金流_万元,
          折现累计_万元: Number.isFinite(runDisc) ? Number(runDisc.toFixed(2)) : null,
        };
      });
    }
    let yearCum = 0;
    let yearDisc = 0;
    return cashflowBase.map((d) => {
      const net = Number(d?.净现金流_万元);
      if (Number.isFinite(net)) yearCum += net;

      const t = Number(d?.monthInYear);
      const disc = Math.pow(1 + monthlyDiscountRate, (Number.isFinite(t) && t >= 1) ? t : 1);
      const pv = (Number.isFinite(net) && disc > 0) ? (net / disc) : (Number.isFinite(net) ? net : 0);
      yearDisc += pv;

      return {
        ...d,
        展示累计现金流_万元: Number.isFinite(yearCum) ? Number(yearCum.toFixed(2)) : null,
        折现累计_万元: Number.isFinite(yearDisc) ? Number(yearDisc.toFixed(2)) : null,
      };
    });
  }, [cashflowBase, yearCashflow, monthlyDiscountRate]);

  const unitMetricsData = getYearFiltered(chartData, yearUnitMetrics);
  const unitMetricsXAxisKey = (yearUnitMetrics === 'all') ? 'month' : 'monthInYear';

  const tableRows = useMemo(() => {
    return rows.map((r, idx) => ({
      ...r,
      year: Math.floor(idx / 12) + 1,
      monthInYear: (idx % 12) + 1,
    }));
  }, [rows]);

  const currentWorkface = useMemo(() => {
    const src = (yearCashflow === 'all')
      ? tableRows
      : tableRows.filter((r) => r?.year === Number(yearCashflow));
    const last = src.length ? src[src.length - 1] : null;
    const wf = (last?.workface == null) ? '' : String(last.workface);
    return wf || '-';
  }, [tableRows, yearCashflow]);
  const monthlyTableRows = useMemo(() => {
    if (yearMonthlyTable === 'all') return tableRows;
    const y = Number(yearMonthlyTable);
    if (!Number.isFinite(y)) return tableRows;
    return tableRows.filter((r) => r.year === y);
  }, [tableRows, yearMonthlyTable]);

  if (!result?.ok) {
    return (
      <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <CircleDollarSign size={16} className="text-amber-600" />
          <div className="text-sm font-black text-slate-800">工程经济分析</div>
        </div>
        <div className="text-sm text-slate-600">{result?.reason || '暂无结果。'}</div>
        {onGoSuccession && (
          <button
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-bold"
            type="button"
            onClick={onGoSuccession}
          >
            前往采掘接续生成排程 <ArrowRight size={14} />
          </button>
        )}
      </section>
    );
  }

  return (
    <>
      <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <CircleDollarSign size={16} className="text-amber-600" />
            <div className="text-sm font-black text-slate-800">工程经济分析（按月现金流）</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-[10px] text-slate-500 font-bold">年份</div>
            <select
              className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700"
              value={yearCashflow}
              onChange={(e) => setYearCashflow(e.target.value)}
            >
              <option value="all">全部</option>
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>{`第${y}年`}</option>
              ))}
            </select>

            {onGoSuccession && (
              <button
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-[11px] font-bold"
                type="button"
                onClick={onGoSuccession}
                title="经济分析基于接续阶段1产量序列"
              >
                调整接续参数 <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-[14px] text-emerald-700 font-bold">净现值（万元）</div>
            <div className="mt-1 text-xl font-mono font-black text-emerald-800">{formatWan(s?.npvWan ?? 0, 2)}</div>
          </div>

          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="text-[14px] text-indigo-700 font-bold">利润（万元）</div>
            <div className="mt-1 text-xl font-mono font-black text-indigo-800">{formatWan((s?.totalNetCashWan ?? totalNetCashWan ?? 0))}</div>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="text-[14px] text-blue-700 font-bold">回收期（月）</div>
            <div className="mt-1 text-xl font-mono font-black text-blue-800">{s?.paybackMonth ?? '-'}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-[14px] text-slate-600 font-bold">单位成本（元/吨）</div>
            <div className="mt-1 text-xl font-mono font-black text-slate-800">{(s?.unitCostYuanPerTon == null) ? '-' : formatYuanPerTon(s.unitCostYuanPerTon)}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-[14px] text-amber-700 font-bold">高风险月（个）</div>
            <div className="mt-1 text-xl font-mono font-black text-amber-800">{formatInt(s?.highRiskMonths ?? 0)}</div>
          </div>

          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
            <div className="text-[14px] text-violet-700 font-bold">当前回采工作面</div>
            <div className="mt-1 text-xl font-mono font-black text-violet-800 truncate" title={currentWorkface}>{currentWorkface}</div>
          </div>
        </div>

        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={cashflowData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey={cashflowXAxisKey} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={tooltipFormatter} />
              <Legend />
              <Bar dataKey="净现金流_万元" name="净现金流（万元）" fill={COLORS.netCash} radius={[6, 6, 0, 0]} opacity={0.92} />
              <Line
                type="monotone"
                dataKey="展示累计现金流_万元"
                name={yearCashflow === 'all' ? '累计现金流（万元）' : '年内累计现金流（万元）'}
                stroke={COLORS.cumCash}
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="折现累计_万元"
                name={yearCashflow === 'all' ? '折现累计（万元）' : '年内折现累计（万元）'}
                stroke={COLORS.cumNpv}
                strokeWidth={2.5}
                dot={false}
                strokeDasharray="6 4"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="text-[12px] font-black text-slate-800 mb-2">总成本构成（万元）</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutCostData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={2}
                    stroke="#ffffff"
                    strokeWidth={2}
                    labelLine={false}
                    label={makeOutsideValueLabel((v) => `${formatWan(v)}`)}
                  >
                    {donutCostData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [`${formatWan(v)} 万元`, n]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="text-[12px] font-black text-slate-800 mb-2">现金流汇总结构（万元）</div>
            <div className="h-56 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutCashData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={2}
                    stroke="#ffffff"
                    strokeWidth={2}
                    labelLine={false}
                    label={makeOutsideValueLabel((v) => `${formatWan(v)}`)}
                  >
                    {donutCashData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [`${formatWan(v)} 万元`, n]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-[10px] text-slate-500 font-bold">净现金流率（%）</div>
                  <div className={`text-lg font-black font-mono ${totalNetCashWanAll >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatPercent(netCashRateAll, 1)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="text-[12px] font-black text-slate-800 mb-2">风险等级分布（0~1）</div>
            <div className="h-56 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutRiskData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={2}
                    stroke="#ffffff"
                    strokeWidth={2}
                    labelLine={false}
                    label={makeOutsideValueLabel((v) => `${formatInt(v)}`)}
                  >
                    {donutRiskData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [`${v} 个月`, n]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-[10px] text-slate-500 font-bold">高风险月</div>
                  <div className="text-lg font-black font-mono text-rose-700">{formatInt(highRiskMonths)}/{formatInt(months || 0)}</div>
                  <div className="text-[10px] text-slate-400">{months ? `${Math.round((highRiskMonths / months) * 100)}%` : '0%'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[12px] font-black text-slate-800">收入-成本构成（万元/月）</div>
              <div className="flex items-center gap-2">
                <div className="text-[10px] text-slate-500 font-bold">年份</div>
                <select
                  className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700"
                  value={yearRevenueCost}
                  onChange={(e) => setYearRevenueCost(e.target.value)}
                >
                  <option value="all">全部</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={String(y)}>{`第${y}年`}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={revenueCostData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey={revenueCostXAxisKey} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={tooltipFormatter} />
                  {showRevenueCostLegend && <Legend />}
                  {showVarCost && (
                    <Bar dataKey="变动成本_万元" name="变动成本（万元）" stackId="cost" fill={COLORS.costVar} radius={[6, 6, 0, 0]} opacity={0.92} />
                  )}
                  {showSustain && (
                    <Bar dataKey="维持性投资_万元" stackId="cost" fill={COLORS.costSustain} opacity={0.92} />
                  )}
                  {showRiskExtra && (
                    <Bar dataKey="风险附加成本_万元" stackId="cost" fill={COLORS.costRisk} opacity={0.92} />
                  )}
                  {showInitial && (
                    <Bar dataKey="初始投资_万元" name="初始投资（万元）" stackId="cost" fill={COLORS.costInitial} opacity={0.92} />
                  )}
                  {showRevenue && (
                    <Line type="monotone" dataKey="收入_万元" name="收入（万元）" stroke={COLORS.revenue} strokeWidth={2.5} dot={false} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[12px] font-black text-slate-800">产量-风险联动（风险值 0~1）</div>
              <div className="flex items-center gap-2">
                <div className="text-[10px] text-slate-500 font-bold">年份</div>
                <select
                  className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700"
                  value={yearTonnageRisk}
                  onChange={(e) => setYearTonnageRisk(e.target.value)}
                >
                  <option value="all">全部</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={String(y)}>{`第${y}年`}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={tonnageRiskData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey={tonnageRiskXAxisKey} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 1]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={tooltipFormatter} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="产量_万t" name="产量（万t）" fill={COLORS.tonnageBase} radius={[6, 6, 0, 0]} opacity={0.85} />
                  <Bar yAxisId="left" dataKey="产量_万t_风险调整" name="风险调整后产量（万t）" fill={COLORS.tonnageAdj} radius={[6, 6, 0, 0]} opacity={0.92} />
                  <Line yAxisId="right" type="monotone" dataKey="风险值_0_1" name="调整风险值" stroke={COLORS.risk} strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-[12px] font-black text-slate-800">单位指标（元/吨，按风险调整后产量口径）</div>
            <div className="flex items-center gap-2">
              <div className="text-[10px] text-slate-500 font-bold">年份</div>
              <select
                className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700"
                value={yearUnitMetrics}
                onChange={(e) => setYearUnitMetrics(e.target.value)}
              >
                <option value="all">全部</option>
                {yearOptions.map((y) => (
                  <option key={y} value={String(y)}>{`第${y}年`}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={unitMetricsData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey={unitMetricsXAxisKey} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={tooltipFormatter} />
                <Legend />
                <Bar dataKey="单位总成本_元每吨" name="单位总成本（元/吨）" fill={COLORS.unitCost} radius={[6, 6, 0, 0]} opacity={0.88} />
                <Bar dataKey="单位毛利_元每吨" name="单位毛利（元/吨）" fill={COLORS.unitMargin} radius={[6, 6, 0, 0]} opacity={0.88} />
                <Bar dataKey="单位净现金流_元每吨" name="单位净现金流（元/吨）" fill={COLORS.unitNet} radius={[6, 6, 0, 0]} opacity={0.88} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-sm font-black text-slate-800">月度明细（万元）</div>
          <div className="flex items-center gap-2">
            <div className="text-[10px] text-slate-500 font-bold">年份</div>
            <select
              className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700"
              value={yearMonthlyTable}
              onChange={(e) => setYearMonthlyTable(e.target.value)}
            >
              <option value="all">全部</option>
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>{`第${y}年`}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="border border-slate-200 rounded-xl overflow-auto max-h-[420px]">
          <table className="w-full table-auto text-sm">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-center px-3 py-2 text-slate-500 font-bold whitespace-nowrap">月</th>
                <th className="text-center px-3 py-2 text-slate-500 font-bold whitespace-nowrap">当前开采工作面</th>
                <th className="text-center px-3 py-2 text-slate-500 font-bold whitespace-nowrap">月产量（吨）</th>
                <th className="text-center px-3 py-2 text-slate-500 font-bold whitespace-nowrap">收入</th>
                <th className="text-center px-3 py-2 text-slate-500 font-bold whitespace-nowrap">变动成本</th>
                <th className="text-center px-3 py-2 text-slate-500 font-bold whitespace-nowrap">固定成本</th>
                <th className="text-center px-3 py-2 text-slate-500 font-bold whitespace-nowrap">净现金流</th>
                <th className="text-center px-3 py-2 text-slate-500 font-bold whitespace-nowrap">累计现金流</th>
              </tr>
            </thead>
            <tbody>
              {monthlyTableRows.map((r) => (
                <tr key={r.month} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2 text-center text-slate-700 font-mono whitespace-nowrap">{yearMonthlyTable === 'all' ? r.month : `${r.monthInYear}月`}</td>
                  <td className="px-3 py-2 text-center text-slate-700 font-mono whitespace-nowrap">{String(r.workface || '-')}</td>
                  <td className="px-3 py-2 text-center text-slate-700 font-mono whitespace-nowrap">{formatTon(r.tonnage ?? 0)}</td>
                  <td className="px-3 py-2 text-center text-slate-700 font-mono whitespace-nowrap">{formatWan(r.revenueWan || 0)}</td>
                  <td className="px-3 py-2 text-center text-slate-700 font-mono whitespace-nowrap">{formatWan(r.varCostWan || 0)}</td>
                  <td className="px-3 py-2 text-center text-slate-700 font-mono whitespace-nowrap">{formatWan(r.fixedCostWan || 0)}</td>
                  <td className={`px-3 py-2 text-center font-mono whitespace-nowrap ${Number(r.netCashWan || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatWan(r.netCashWan || 0)}</td>
                  <td className={`px-3 py-2 text-center font-mono whitespace-nowrap ${Number(r.cumCashWan || 0) >= 0 ? 'text-emerald-700' : 'text-slate-700'}`}>{formatWan(r.cumCashWan || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
