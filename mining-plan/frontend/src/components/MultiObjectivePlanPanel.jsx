import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Target,
  ShieldCheck,
  TrendingUp,
  Layers,
  Sliders,
  Info,
} from 'lucide-react';

const clamp01 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

const normalize3 = (w) => {
  const a = clamp01(w?.efficiency);
  const b = clamp01(w?.disturbance);
  const c = clamp01(w?.recovery);
  const s = a + b + c;
  if (!(s > 1e-12)) return { efficiency: 1 / 3, disturbance: 1 / 3, recovery: 1 / 3 };
  return { efficiency: a / s, disturbance: b / s, recovery: c / s };
};

const fmtPct0 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '--';
  return `${Math.round(n * 100)}%`;
};

const fmtPctInt = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '--';
  return `${Math.round(n)}%`;
};

export default function MultiObjectivePlanPanel({
  value,
  onChange,
  weights,
  onWeightsChange,
  defaultCollapsed = false,
  showSummaryWhenCollapsed = false,
}) {
  const [collapsed, setCollapsed] = useState(Boolean(defaultCollapsed));
  const rootRef = useRef(null);
  const weightPanelRef = useRef(null);

  const normalizedWeights = useMemo(() => normalize3(weights), [weights]);

  const modes = useMemo(
    () => [
      {
        id: 'efficiency',
        title: '工程效率最优',
        subtitle: '优先提升推进效率与组织效率',
        Icon: Target,
        classes: {
          active: 'border-blue-500 bg-blue-50/30 text-blue-700 shadow-sm',
          dot: 'bg-blue-500',
          iconActive: 'bg-blue-500 text-white shadow-md',
        },
      },
      {
        id: 'disturbance',
        title: '覆岩扰动优化',
        subtitle: '优先降低覆岩扰动风险',
        Icon: ShieldCheck,
        classes: {
          active: 'border-emerald-500 bg-emerald-50/30 text-emerald-700 shadow-sm',
          dot: 'bg-emerald-500',
          iconActive: 'bg-emerald-500 text-white shadow-md',
        },
      },
      {
        id: 'recovery',
        title: '资源回收最优',
        subtitle: '优先提升资源回收与覆盖率',
        Icon: TrendingUp,
        classes: {
          active: 'border-indigo-500 bg-indigo-50/30 text-indigo-700 shadow-sm',
          dot: 'bg-indigo-500',
          iconActive: 'bg-indigo-500 text-white shadow-md',
        },
      },
      {
        id: 'weighted',
        title: '权重自定义调节',
        subtitle: '三目标加权综合（可调）',
        Icon: Sliders,
        classes: {
          active: 'border-orange-500 bg-orange-50/30 text-orange-700 shadow-sm',
          dot: 'bg-orange-500',
          iconActive: 'bg-orange-500 text-white shadow-md',
        },
      },
    ],
    []
  );

  const activeMeta = useMemo(() => modes.find((m) => m.id === value) ?? modes[1], [modes, value]);

  const setMode = (id) => {
    if (typeof onChange === 'function') onChange(id);
    if (id === 'weighted' && typeof onWeightsChange === 'function') {
      onWeightsChange(normalize3(weights));
    }

    // 选择“权重自定义”后，尽量把滑块面板滚动到可视区
    if (id === 'weighted') {
      setTimeout(() => {
        if (weightPanelRef.current?.scrollIntoView) {
          weightPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else if (rootRef.current?.scrollIntoView) {
          rootRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 0);
    }
  };

  const updateWeight = (key, nextValue) => {
    if (typeof onWeightsChange !== 'function') return;
    const cur = normalize3(weights);
    const v = clamp01(nextValue);

    // 保持三者和为 1：改动一个，其余两个按比例缩放
    const keysOther = ['efficiency', 'disturbance', 'recovery'].filter((k) => k !== key);
    const sumOther = keysOther.reduce((s, k) => s + (cur[k] ?? 0), 0);
    const remaining = Math.max(0, 1 - v);

    const next = { ...cur, [key]: v };
    if (sumOther <= 1e-12) {
      const half = remaining / 2;
      next[keysOther[0]] = half;
      next[keysOther[1]] = half;
    } else {
      next[keysOther[0]] = (cur[keysOther[0]] / sumOther) * remaining;
      next[keysOther[1]] = (cur[keysOther[1]] / sumOther) * remaining;
    }

    onWeightsChange(normalize3(next));
  };

  const updateWeightPct = (key, nextPct) => {
    const pct = Number(nextPct);
    if (!Number.isFinite(pct)) return;
    updateWeight(key, pct / 100);
  };

  const toggleCollapsed = () => {
    const nextCollapsed = !collapsed;
    setCollapsed(nextCollapsed);

    // 展开后把卡片滚动到中间滚动容器的可视区
    if (!nextCollapsed) {
      setTimeout(() => {
        rootRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  };

  return (
    <section
      ref={rootRef}
      className={`bg-white border border-slate-200 shadow-sm relative overflow-hidden group flex flex-col shrink-0 transition-all duration-300 rounded-[2rem] ${collapsed ? 'h-14' : 'h-auto'}`}
    >
      <div
        className="p-4 border-b border-slate-50 flex items-center justify-between bg-white/80 backdrop-blur-sm shrink-0 cursor-pointer hover:bg-slate-50"
        onClick={toggleCollapsed}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') toggleCollapsed();
        }}
      >
        <div className="flex items-center gap-4">
          <h3 className="font-bold text-slate-700 flex items-center gap-2 text-base">
            <Layers size={16} className="text-indigo-600" /> 多目标规划优化方案
          </h3>
        </div>
        <div className="flex gap-2 items-center">
          <button
            className="p-1 hover:bg-slate-200 rounded transition-colors"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed();
            }}
            title={collapsed ? '展开' : '收起'}
          >
            {collapsed ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
          </button>
        </div>
      </div>

      {collapsed && showSummaryWhenCollapsed && (
        <div className="px-4 pb-3 flex items-center justify-between gap-3">
          <div className="text-[12px] text-slate-500 flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1">
              <span className={`inline-block w-2 h-2 rounded-full ${activeMeta.classes?.dot ?? 'bg-slate-400'}`} />
              <span className="font-black truncate">{activeMeta.title}</span>
            </span>
            {value === 'weighted' && (
              <span className="font-mono text-slate-400 truncate">
                {fmtPct0(normalizedWeights.efficiency)} / {fmtPct0(normalizedWeights.disturbance)} / {fmtPct0(normalizedWeights.recovery)}
              </span>
            )}
          </div>
        </div>
      )}

      <div
        className={
          'overflow-hidden transition-all duration-300 ease-out ' +
          (collapsed
            ? 'max-h-0 opacity-0 -translate-y-2 pointer-events-none'
            : 'max-h-[2000px] opacity-100 translate-y-0')
        }
      >
        <div className="p-6 pt-5">
          <div className="grid grid-cols-4 gap-4 shrink-0">
            {modes.map((m) => {
              const selected = m.id === value;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={
                    `flex items-center gap-4 p-5 rounded-3xl border-2 transition-all text-left relative overflow-hidden group h-20 ` +
                    (selected
                      ? m.classes.active
                      : 'border-slate-100 bg-white hover:border-slate-200 text-slate-500')
                  }
                  title={m.subtitle}
                >
                  {/* 图标底纹（水印）：不影响原图标展示 */}
                  <m.Icon
                    size={56}
                    className={
                      `pointer-events-none absolute -right-1 -bottom-4 rotate-[-12deg] ` +
                      (selected
                        ? `${(m.classes.dot || 'bg-slate-500').replace('bg-', 'text-')} opacity-[0.16]`
                        : `${(m.classes.dot || 'bg-slate-500').replace('bg-', 'text-')} opacity-[0.08]`)
                    }
                  />

                  <div
                    className={
                      `relative p-3 rounded-2xl transition-colors shrink-0 ` +
                      (selected ? m.classes.iconActive : 'bg-slate-50 text-slate-400 group-hover:bg-slate-100')
                    }
                  >
                    <m.Icon size={24} />
                  </div>

                  <h4 className="relative min-w-0 text-[16px] font-black leading-tight truncate">{m.title}</h4>

                  {selected && (
                    <div className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${m.classes.dot} animate-pulse`} />
                  )}
                </button>
              );
            })}
          </div>

          {value === 'weighted' && (
            <div
              ref={weightPanelRef}
              className="mt-4 p-6 bg-orange-50/40 rounded-[2rem] border border-orange-100 shadow-inner"
            >
              <div className="flex items-center gap-2 mb-8">
                <Sliders size={16} className="text-orange-600" />
                <span className="text-[13px] font-black text-orange-800 uppercase tracking-widest">
                  核心权重指标动态调节
                </span>
              </div>

              <div className="grid grid-cols-3 gap-8">
                <div className="flex flex-col gap-4 group">
                  <div className="flex justify-between items-baseline px-1">
                    <span className="text-[12px] font-bold text-slate-400 uppercase tracking-tight group-hover:text-orange-600 transition-colors">
                      几何效率权重
                    </span>
                    <span className="text-sm font-black text-orange-600 font-mono tracking-tighter">
                      {fmtPctInt(Math.round(normalizedWeights.efficiency * 100))}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(normalizedWeights.efficiency * 100)}
                    onChange={(e) => updateWeightPct('efficiency', e.target.value)}
                    className="w-full h-1.5 bg-orange-100 rounded-full appearance-none cursor-pointer accent-orange-600 hover:accent-orange-700 transition-all"
                  />
                </div>

                <div className="flex flex-col gap-4 group">
                  <div className="flex justify-between items-baseline px-1">
                    <span className="text-[12px] font-bold text-slate-400 uppercase tracking-tight group-hover:text-orange-600 transition-colors">
                      安全扰动权重
                    </span>
                    <span className="text-sm font-black text-orange-600 font-mono tracking-tighter">
                      {fmtPctInt(Math.round(normalizedWeights.disturbance * 100))}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(normalizedWeights.disturbance * 100)}
                    onChange={(e) => updateWeightPct('disturbance', e.target.value)}
                    className="w-full h-1.5 bg-orange-100 rounded-full appearance-none cursor-pointer accent-orange-600 hover:accent-orange-700 transition-all"
                  />
                </div>

                <div className="flex flex-col gap-4 group">
                  <div className="flex justify-between items-baseline px-1">
                    <span className="text-[12px] font-bold text-slate-400 uppercase tracking-tight group-hover:text-orange-600 transition-colors">
                      资源回收权重
                    </span>
                    <span className="text-sm font-black text-orange-600 font-mono tracking-tighter">
                      {fmtPctInt(Math.round(normalizedWeights.recovery * 100))}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(normalizedWeights.recovery * 100)}
                    onChange={(e) => updateWeightPct('recovery', e.target.value)}
                    className="w-full h-1.5 bg-orange-100 rounded-full appearance-none cursor-pointer accent-orange-600 hover:accent-orange-700 transition-all"
                  />
                </div>
              </div>

              <div className="mt-8 p-4 bg-white/60 rounded-2xl border border-orange-100 flex items-start gap-3 shadow-sm">
                <Info size={16} className="text-orange-400 shrink-0 mt-0.5" />
                <div className="flex flex-col gap-0.5">
                  <p className="text-[12px] text-orange-900 font-bold uppercase">反演策略说明</p>
                  <p className="text-[12px] text-orange-800/60 font-medium leading-relaxed italic">
                    权重分配将影响寻优算法的适应度函数。建议总和保持为 100% 以获得最稳定的布局结果。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
