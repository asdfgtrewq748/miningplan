import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';

const fmtNum = (n, digits = 0) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return '-';
  return x.toFixed(digits);
};

function MiniPlanPreview({
  loopsWorld,
  panels,
  productionParams,
  hoveredWorkfaceId,
  selectedWorkfaceId,
  onPickWorkface,
  onHoverWorkfaceId,
  yardOrder,
  onYardSelectDir,
  onYardConfirm,
  onYardClear,
}) {
  const loops = Array.isArray(loopsWorld) ? loopsWorld : [];
  const orderedPanels = Array.isArray(panels) ? panels : [];

  const orderPosByFaceIndex = useMemo(() => {
    const m = new Map();
    orderedPanels.forEach((p, i) => {
      const fi = Number(p?.faceIndex);
      if (Number.isFinite(fi) && fi >= 1) m.set(fi, i + 1);
    });
    return m;
  }, [orderedPanels]);

  const hoveredFi = (() => {
    const s = String(hoveredWorkfaceId ?? '').trim();
    const m = s.match(/No\.(\d+)/i);
    if (!m) return null;
    const fi = Number(m[1]);
    return (Number.isFinite(fi) && fi >= 1) ? fi : null;
  })();
  const hoveredPos = (hoveredFi != null) ? (orderPosByFaceIndex.get(hoveredFi) ?? null) : null;

  const containerRef = useRef(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isInPreview, setIsInPreview] = useState(false);

  const hoveredPanelInfo = useMemo(() => {
    const s = String(hoveredWorkfaceId ?? '').trim();
    const ps = Array.isArray(panels) ? panels : [];
    const p = ps.find((x) => String(x?.id) === s)
      ?? (() => {
        const m = s.match(/No\.(\d+)/i);
        if (!m) return null;
        const fi = Number(m[1]);
        if (!(Number.isFinite(fi) && fi >= 1)) return null;
        return ps.find((x) => Number(x?.faceIndex) === fi) ?? null;
      })();

    const m2 = s.match(/No\.(\d+)/i);
    const fi = (m2 && Number.isFinite(Number(m2[1]))) ? Number(m2[1]) : null;
    if (!p) return (fi != null) ? { fi, widthM: null, advanceLengthM: null, reserveWanT: null } : null;

    const widthM = Number(p?.widthM ?? p?.width ?? null);
    const advanceLengthM = Number(p?.advanceLengthM ?? p?.lengthM ?? p?.length ?? null);

    const mh = Math.max(0, Number(productionParams?.miningHeightM ?? 4.5));
    const density = Math.max(0, Number(productionParams?.coalDensity ?? 1.35));
    const rrMin = Math.max(0, Math.min(1, Number(productionParams?.recoveryRateMin ?? 0.85)));
    const rrMax = Math.max(0, Math.min(1, Number(productionParams?.recoveryRateMax ?? 0.95)));
    const rr = Math.max(0, Math.min(1, (rrMin + rrMax) / 2));

    const reserveTon = (
      Number.isFinite(widthM) && Number.isFinite(advanceLengthM) && widthM > 0 && advanceLengthM > 0 &&
      Number.isFinite(mh) && mh > 0 && Number.isFinite(density) && density > 0
    ) ? (widthM * advanceLengthM * mh * density * rr) : null;

    const reserveWanT = Number.isFinite(reserveTon) ? (reserveTon / 10000) : null;
    return { fi: (fi != null ? fi : Number(p?.faceIndex ?? null)), widthM: Number.isFinite(widthM) ? widthM : null, advanceLengthM: Number.isFinite(advanceLengthM) ? advanceLengthM : null, reserveWanT };
  }, [hoveredWorkfaceId, panels, productionParams]);

  const fillOf = (pos, total) => {
    if (!(Number.isFinite(pos) && pos >= 1 && Number.isFinite(total) && total >= 1)) return 'rgba(148,163,184,0.25)';
    if (total === 1) return 'hsl(243, 75%, 40%)';
    const t = Math.max(0, Math.min(1, (pos - 1) / (total - 1)));
    const light = 30 + 55 * t; // 深->浅
    return `hsl(243, 75%, ${light}%)`;
  };

  const pickTextColorForFill = (fill) => {
    const s = String(fill ?? '').trim().toLowerCase();
    // return true if dark background
    const isDark = (() => {
      const mHsl = s.match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/);
      if (mHsl) {
        const lightness = Number(mHsl[3]);
        if (Number.isFinite(lightness)) return lightness < 55;
      }

      const mRgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
      if (mRgb) {
        const r = Number(mRgb[1]);
        const g = Number(mRgb[2]);
        const b = Number(mRgb[3]);
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
          // Relative luminance approximation
          const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          return y < 0.6;
        }
      }

      return false;
    })();

    return isDark ? '#ffffff' : '#0f172a';
  };

  const strokeOf = (pos, total) => {
    if (!(Number.isFinite(pos) && pos >= 1 && Number.isFinite(total) && total >= 1)) return 'rgba(100,116,139,0.55)';
    if (total === 1) return 'hsl(243, 75%, 32%)';
    const t = Math.max(0, Math.min(1, (pos - 1) / (total - 1)));
    const light = 22 + 48 * t;
    return `hsl(243, 75%, ${light}%)`;
  };

  const { vb, shapes } = useMemo(() => {
    const pts = [];
    for (const wf of loops) {
      for (const p of (wf?.loop ?? [])) {
        const x = Number(p?.x);
        const y = Number(p?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
      }
    }
    if (!pts.length) return { vb: '0 0 100 100', shapes: [] };

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }

    const padX = (maxX - minX) * 0.08 + 1;
    const padY = (maxY - minY) * 0.08 + 1;

    const vbX = minX - padX;
    const vbY = minY - padY;
    const vbW = (maxX - minX) + padX * 2;
    const vbH = (maxY - minY) + padY * 2;

    // 与智能规划主图保持一致：world y 越大，屏幕越靠上（SVG y 轴向下，需要做一次上下镜像）。
    const flipY = (y) => (2 * vbY + vbH) - Number(y);

    const mkPath = (loop) => {
      const pts2 = (loop ?? [])
        .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (pts2.length < 3) return '';
      let d = `M ${pts2[0].x} ${flipY(pts2[0].y)}`;
      for (let i = 1; i < pts2.length; i++) d += ` L ${pts2[i].x} ${flipY(pts2[i].y)}`;
      d += ' Z';
      return d;
    };

    const allowed = (() => {
      const s = new Set();
      for (const p of orderedPanels) {
        const fi = Number(p?.faceIndex);
        if (Number.isFinite(fi) && fi >= 1) s.add(String(fi));
      }
      return s;
    })();

    const shapes0 = loops
      .map((wf) => {
        const fi = Math.round(Number(wf?.faceIndex));
        const key = Number.isFinite(fi) ? String(fi) : String(wf?.id ?? '');
        if (allowed.size && !allowed.has(String(fi))) return null;

        const loop0 = Array.isArray(wf?.loop) ? wf.loop : [];
        const pts2 = loop0
          .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (pts2.length < 3) return null;

        const d = mkPath(loop0);
        if (!d) return null;

        const c0 = pts2.reduce((acc, p) => ({ x: acc.x + p.x / pts2.length, y: acc.y + p.y / pts2.length }), { x: 0, y: 0 });
        return {
          key,
          faceIndex: Number.isFinite(fi) ? fi : null,
          d,
          cx: c0.x,
          cy: flipY(c0.y),
        };
      })
      .filter(Boolean);

    return { vb: `${vbX} ${vbY} ${vbW} ${vbH}`, shapes: shapes0 };
  }, [loops, orderedPanels]);

  const dirs = [
    { key: 'NW', label: '西北' },
    { key: 'N', label: '北' },
    { key: 'NE', label: '东北' },
    { key: 'W', label: '西' },
    { key: 'E', label: '东' },
    { key: 'SW', label: '西南' },
    { key: 'S', label: '南' },
    { key: 'SE', label: '东南' },
  ];
  const selected = String(yardOrder?.selectedDir ?? 'NE');
  const confirmed = Boolean(yardOrder?.confirmed);
  const confirmedDir = String(yardOrder?.confirmedDir ?? '');
  const activeKey = selected;

  const mkBtn = (k, text) => {
    const isActive = String(activeKey) === String(k);
    const isConfirmed = confirmed && confirmedDir && String(confirmedDir) === String(k);
    return (
      <button
        type="button"
        onClick={() => onYardSelectDir?.(k)}
        className={`w-10 h-10 rounded-full border text-[12px] font-black transition-all ${isActive ? 'bg-indigo-600 border-indigo-600 text-white shadow' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'} ${isConfirmed ? 'ring-2 ring-emerald-400/70 ring-offset-2 ring-offset-white' : ''}`}
        title={`采区在工业广场${text}侧`}
      >
        {text}
      </button>
    );
  };

  return (
    <div className="h-full w-full bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
        <div className="text-[13px] font-black text-slate-600">开采方案平面布置图</div>
        <div className="text-[12px] text-slate-400">{shapes.length} 面</div>
      </div>
      <div className="flex-1 min-h-[220px] p-2">
        {shapes.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-400">暂无工作面几何</div>
        ) : (
          <div
            ref={containerRef}
            className="relative w-full h-full"
            onMouseEnter={() => setIsInPreview(true)}
            onMouseLeave={() => {
              setIsInPreview(false);
              onHoverWorkfaceId?.(null);
            }}
            onMouseMove={(e) => {
              const rect = containerRef.current?.getBoundingClientRect?.();
              if (!rect) return;
              setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            }}
          >
            <svg className="w-full h-full" viewBox={vb}>
              <g>
                {shapes.map((s) => {
                const fi = Number(s?.faceIndex);
                const workfaceId = (Number.isFinite(fi) && fi >= 1) ? `No.${fi}` : String(s.key);
                const pos = (Number.isFinite(fi) && fi >= 1) ? (orderPosByFaceIndex.get(fi) ?? null) : null;
                const total = Math.max(1, orderedPanels.length);

                const completed = (hoveredPos != null && pos != null) ? (pos < hoveredPos) : false;
                const isHovered = (hoveredFi != null && pos != null) ? (fi === hoveredFi) : false;
                const isSelected = String(selectedWorkfaceId ?? '') === String(workfaceId);

                const fill = completed ? 'rgba(226,232,240,0.85)' : fillOf(pos, total);
                const stroke = completed ? 'rgba(148,163,184,0.95)' : strokeOf(pos, total);
                const sw = isHovered ? 4 : isSelected ? 3.2 : 2;

                const label = (Number.isFinite(fi) && fi >= 1) ? `No.${fi}` : String(s.key);

                return (
                  <g
                    key={s.key}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onPickWorkface?.({ workfaceId, faceIndex: (Number.isFinite(fi) && fi >= 1) ? fi : null })}
                    onMouseEnter={() => onHoverWorkfaceId?.(workfaceId)}
                    onMouseLeave={() => onHoverWorkfaceId?.(null)}
                  >
                    <path d={s.d} fill={fill} stroke={stroke} strokeWidth={sw} />
                  </g>
                );
              })}
              </g>
            </svg>

            {/* 绝对字号标签层：不随 SVG viewBox 缩放 */}
            <div className="absolute inset-0 pointer-events-none">
              {(() => {
                const [vbX, vbY, vbW, vbH] = String(vb ?? '').split(/\s+/).map((n) => Number(n));
                if (!(Number.isFinite(vbX) && Number.isFinite(vbY) && Number.isFinite(vbW) && Number.isFinite(vbH) && vbW > 0 && vbH > 0)) return null;
                const toPct = (x, y) => {
                  const lx = ((Number(x) - vbX) / vbW) * 100;
                  const ty = ((Number(y) - vbY) / vbH) * 100;
                  return { left: `${lx}%`, top: `${ty}%` };
                };

                return shapes.map((s) => {
                  const fi = Number(s?.faceIndex);
                  const workfaceId = (Number.isFinite(fi) && fi >= 1) ? `No.${fi}` : String(s.key);
                  const pos = (Number.isFinite(fi) && fi >= 1) ? (orderPosByFaceIndex.get(fi) ?? null) : null;
                  const total = Math.max(1, orderedPanels.length);

                  const completed = (hoveredPos != null && pos != null) ? (pos < hoveredPos) : false;
                  const isHovered = (hoveredFi != null && pos != null) ? (fi === hoveredFi) : false;
                  const isSelected = String(selectedWorkfaceId ?? '') === String(workfaceId);

                  const label = (Number.isFinite(fi) && fi >= 1) ? `No.${fi}` : String(s.key);
                  const fill = completed ? 'rgba(226,232,240,0.85)' : fillOf(pos, total);
                  const textFill = pickTextColorForFill(fill);
                  const opacity = isHovered ? 1 : 0.95;

                  if (!(Number.isFinite(Number(s?.cx)) && Number.isFinite(Number(s?.cy)))) return null;
                  const stylePos = toPct(s.cx, s.cy);
                  return (
                    <div
                      key={`label-${s.key}`}
                      className="absolute font-black"
                      style={{
                        ...stylePos,
                        transform: 'translate(-50%, -50%)',
                        color: textFill,
                        opacity,
                        fontSize: '13px',
                        lineHeight: '1',
                      }}
                    >
                      {label}
                    </div>
                  );
                });
              })()}
            </div>

            {isInPreview && hoveredPanelInfo ? (
              (() => {
                const w = containerRef.current?.clientWidth ?? 0;
                const h = containerRef.current?.clientHeight ?? 0;
                const pad = 10;
                const tipW = 220;
                const tipH = 72;
                const x0 = Math.max(pad, Math.min((mousePos.x ?? 0) + 14, Math.max(pad, w - tipW - pad)));
                const y0 = Math.max(pad, Math.min((mousePos.y ?? 0) + 14, Math.max(pad, h - tipH - pad)));

                return (
                  <div
                    className="absolute pointer-events-none"
                    style={{ left: x0, top: y0, width: tipW }}
                  >
                    <div className="rounded-xl border border-slate-200 bg-white/95 shadow-lg px-3 py-2">
                      <div className="text-[12px] font-black text-slate-700">No.{hoveredPanelInfo.fi}</div>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-600">
                        <div className="text-slate-400">宽度</div>
                        <div className="text-right font-bold">{Number.isFinite(hoveredPanelInfo.widthM) ? `${fmtNum(hoveredPanelInfo.widthM, 1)} m` : '-'}</div>
                        <div className="text-slate-400">推进长度</div>
                        <div className="text-right font-bold">{Number.isFinite(hoveredPanelInfo.advanceLengthM) ? `${fmtNum(hoveredPanelInfo.advanceLengthM, 0)} m` : '-'}</div>
                        <div className="text-slate-400">储量（万t）</div>
                        <div className="text-right font-bold">{Number.isFinite(hoveredPanelInfo.reserveWanT) ? `${fmtNum(hoveredPanelInfo.reserveWanT, 1)}` : '-'}</div>
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : null}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] text-slate-400 font-black uppercase">采区方位（相对工业广场） → 顺序：近到远</div>
            <div className="mt-1 text-[13px] text-slate-600">
              {confirmed ? `已确认：${dirs.find((d) => d.key === confirmedDir)?.label ?? confirmedDir}` : `未确认（当前选择：${dirs.find((d) => d.key === selected)?.label ?? selected}）`}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={onYardConfirm}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800"
            >
              {confirmed ? '重新确认' : '确认顺序'}
            </button>
            <button
              type="button"
              onClick={onYardClear}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
              disabled={!confirmed}
            >
              清除
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-stretch gap-0">
          <div className="flex items-center justify-center flex-shrink-0 pr-3">
            <div className="grid grid-cols-3 gap-1">
              <div className="flex items-center justify-center">{mkBtn('NW', '西北')}</div>
              <div className="flex items-center justify-center">{mkBtn('N', '北')}</div>
              <div className="flex items-center justify-center">{mkBtn('NE', '东北')}</div>
              <div className="flex items-center justify-center">{mkBtn('W', '西')}</div>
              <div className="w-10 h-10 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-[12px] font-black text-slate-500">广场</div>
              <div className="flex items-center justify-center">{mkBtn('E', '东')}</div>
              <div className="flex items-center justify-center">{mkBtn('SW', '西南')}</div>
              <div className="flex items-center justify-center">{mkBtn('S', '南')}</div>
              <div className="flex items-center justify-center">{mkBtn('SE', '东南')}</div>
            </div>
          </div>

          <div className="w-px bg-slate-200 self-stretch" />

          <div className="flex-1 min-w-0 max-w-[520px] pl-3">
            <div className="grid grid-cols-2 gap-x-2">
              <div className="text-[12px] text-slate-400 font-black uppercase">顺序颜色（回采）</div>
              <div className="text-[12px] text-slate-400 text-right">{confirmed ? '已应用到排程' : '确认后生效'}</div>
            </div>

            <div className="mt-2">
              {(() => {
                const total = orderedPanels.length;
                const list = orderedPanels
                  .map((p) => ({ fi: Number(p?.faceIndex) }))
                  .filter((x) => Number.isFinite(x.fi) && x.fi >= 1)
                  .map((x, i) => ({ fi: x.fi, pos: i + 1 }));

                const row1Count = Math.max(1, Math.ceil(list.length / 2));
                const row1 = list.slice(0, row1Count);
                const row2 = list.slice(row1Count);

                const renderChip = (r) => {
                  if (!r) return null;
                  const color = fillOf(r.pos, Math.max(1, total));
                  const label = `No.${r.fi}`;
                  const hint = (r.pos === 1) ? '先采' : (r.pos === total) ? '后采' : '';
                  return (
                    <div
                      key={`fi-${r.fi}-pos-${r.pos}`}
                      className="flex items-center gap-2 px-2 py-1 rounded-xl bg-white border border-slate-200 shadow-sm"
                      title={hint ? `${label}（${hint}）` : label}
                    >
                      <div className="w-3 h-3 rounded" style={{ background: color }} />
                      <div className="text-[13px] font-mono font-bold text-slate-700">{label}</div>
                      {hint ? <div className="text-[12px] text-slate-400 font-black">{hint}</div> : null}
                    </div>
                  );
                };

                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {row1.map((r) => renderChip(r))}
                    </div>
                    {row2.length ? (
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {row2.map((r) => renderChip(r))}
                      </div>
                    ) : null}

                    <div className="h-px bg-slate-200" />
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-slate-200" />
                        <div className="text-[13px] font-bold text-slate-500">采完</div>
                      </div>
                      <div className="text-[12px] text-slate-400">hover 甘特显示</div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stage1Gantt({ title, subtitle, tasks, daysPerMonth, productionParams, hoveredWorkfaceId, selectedWorkfaceId, onHoverWorkfaceId }) {
  const data = Array.isArray(tasks) ? tasks : [];
  if (!data.length) return null;

  const clamp01Local = (x) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  };
  const clampLocal = (x, a, b) => Math.max(a, Math.min(b, x));
  const toFiniteLocal = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const minDay = Math.min(...data.map((d) => d.startDay));
  const maxDay = Math.max(...data.map((d) => d.endDay));
  const total = Math.max(1e-6, maxDay - minDay);

  const timelineRef = useRef(null);
  const [timelinePx, setTimelinePx] = useState(900);
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const update = () => {
      const w = el.getBoundingClientRect?.().width;
      if (Number.isFinite(w) && w > 50) setTimelinePx(w);
    };
    update();
    // 监听容器宽度变化，实现“按窗口最大自适应”
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [progressDayRaw, setProgressDayRaw] = useState(() => 0);
  const progressDay = useMemo(() => clampLocal(toFiniteLocal(progressDayRaw, 0), minDay, maxDay), [progressDayRaw, minDay, maxDay]);

  const utilization = clamp01Local(productionParams?.utilization ?? 0.85);
  const shearAdvanceRate = Math.max(0, toFiniteLocal(productionParams?.shearAdvanceRate, 6));

  const workfaces = [...new Set(data.map((d) => String(d.workface)))];

  const colorOf = (t) => {
    // 颜色口径（RGB）：掘进 79,89,109；安装 250,192,15；回采 1,86,153；搬家 243,118,74
    if (t === 'drive') return 'bg-[rgb(79,89,109)]';
    if (t === 'install') return 'bg-[rgb(250,192,15)]';
    if (t === 'mining') return 'bg-[rgb(1,86,153)]';
    if (t === 'relocation') return 'bg-[rgb(243,118,74)]';
    return 'bg-slate-400';
  };

  const monthTicks = (() => {
    const m0 = Math.floor(minDay / daysPerMonth);
    const m1 = Math.ceil(maxDay / daysPerMonth);
    const out = [];
    for (let m = m0; m <= m1; m++) {
      const day = m * daysPerMonth;
      out.push({ m: m + 1, day });
    }
    return out;
  })();

  const yearTicks = useMemo(() => {
    return monthTicks
      .map((t) => {
        const monthNumber = Number(t?.m ?? 1);
        const displayMonth = ((monthNumber - 1) % 12) + 1;
        const yearNumber = Math.floor((monthNumber - 1) / 12) + 1;
        return { ...t, monthNumber, displayMonth, yearNumber };
      })
      .filter((t) => t.displayMonth === 1);
  }, [monthTicks]);

  // 方案1：月线全保留，文字按密度抽样（避免叠字）
  const labelEveryMonths = useMemo(() => {
    const monthPx = timelinePx * (daysPerMonth / Math.max(1e-6, total));
    const minLabelPx = 46; // 字体加大后，留更稳的间距
    return Math.max(1, Math.ceil(minLabelPx / Math.max(1, monthPx)));
  }, [daysPerMonth, total, timelinePx]);

  const labelEveryYears = useMemo(() => {
    const yearPx = timelinePx * ((daysPerMonth * 12) / Math.max(1e-6, total));
    const minYearLabelPx = 70; // “第12年”级别的宽度余量
    return Math.max(1, Math.ceil(minYearLabelPx / Math.max(1, yearPx)));
  }, [daysPerMonth, total, timelinePx]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
        <div className="text-[15px] font-black text-slate-600">{title ?? '接续甘特图'}</div>
        <div className="flex items-center gap-3">
          <div className="text-[12px] text-slate-400">{subtitle ?? `单位：天（按${daysPerMonth}天/月显示刻度）`}</div>
          <div className="flex items-center gap-2 text-[12px] text-slate-500">
            <div className="font-bold">观察日</div>
            <input
              type="number"
              step="1"
              value={progressDayRaw}
              onChange={(e) => setProgressDayRaw(e.target.value)}
              className="w-20 bg-white border border-slate-200 rounded px-2 py-1 text-[12px] text-slate-700"
              title="输入当前观察日（第N天）"
            />
            <div className="text-slate-400">/ {fmtNum(maxDay, 0)}天</div>
          </div>
        </div>
      </div>
      <div className="p-2 overflow-x-auto">
        <div className="w-full">
          <div className="flex items-center mb-2 text-[12px] text-slate-400">
            <div className="w-16 flex-shrink-0" />
            <div ref={timelineRef} className="flex-1 relative h-14">
              {(() => {
                const left = ((progressDay - minDay) / total) * 100;
                return (
                  <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${left}%` }}>
                    <div className="absolute bottom-0 h-3 w-px bg-slate-900/30" />
                  </div>
                );
              })()}

              {/* 年刻度（上排） */}
              {yearTicks
                .filter((t) => ((t.yearNumber - 1) % labelEveryYears) === 0)
                .map((t) => {
                const left = ((t.day - minDay) / total) * 100;
                return (
                  <div key={`y-${t.yearNumber}`} className="absolute top-0 bottom-0" style={{ left: `${left}%` }}>
                    <div className="absolute top-0 h-3 w-px bg-slate-300" />
                    <div className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[12px] leading-none text-slate-400 bg-white/70 px-0.5 rounded">
                      第{t.yearNumber}年
                    </div>
                  </div>
                );
              })}

              {monthTicks.map((t, idx) => {
                const left = ((t.day - minDay) / total) * 100;
                const isFirst = idx === 0;
                const isLast = idx === monthTicks.length - 1;
                const shouldLabel = isFirst || isLast || (((t.m - 1) % labelEveryMonths) === 0);

                const monthNumber = Number(t?.m ?? 1);
                const displayMonth = ((monthNumber - 1) % 12) + 1;
                const isYearStart = displayMonth === 1;
                return (
                  <div key={t.m} className="absolute top-0 bottom-0" style={{ left: `${left}%` }}>
                    {shouldLabel ? (
                      <>
                        {/* 刻度线：更短、更稀疏 */}
                        <div className={`absolute bottom-0 h-3 w-px ${isYearStart ? 'bg-slate-300' : 'bg-slate-200'}`} />
                        {/* 月份文字：放在刻度线与图之间 */}
                        <div
                          className="absolute bottom-3 -translate-x-1/2 whitespace-nowrap text-[12px] leading-none text-slate-400 bg-white/70 px-0.5 rounded"
                          title={`${displayMonth}月`}
                        >
                          {displayMonth}月
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="w-20 flex-shrink-0" />
          </div>

          <div className="space-y-2">
            {workfaces.map((wf) => {
              const wfTasks = data.filter((d) => String(d.workface) === wf);
              const isHovered = String(hoveredWorkfaceId ?? '') === String(wf);
              const isSelected = String(selectedWorkfaceId ?? '') === String(wf);

              const wfTasksSorted = [...wfTasks].sort((a, b) => Number(a?.startDay ?? 0) - Number(b?.startDay ?? 0));
              const statusText = (() => {
                if (!wfTasksSorted.length) return '-';
                const s0 = Number(wfTasksSorted[0]?.startDay ?? 0);
                const e1 = Number(wfTasksSorted[wfTasksSorted.length - 1]?.endDay ?? 0);
                if (progressDay < s0) return '未开始';
                if (progressDay >= e1) return '已完成';
                const active = wfTasksSorted.find((t) => Number(progressDay) >= Number(t?.startDay) && Number(progressDay) < Number(t?.endDay));
                const type = String(active?.type ?? '');
                const label = (type === 'drive') ? '掘进' : (type === 'install') ? '安装' : (type === 'mining') ? '回采' : (type === 'relocation') ? '搬家' : type;
                const dur = Math.max(1e-6, Number(active?.endDay ?? 0) - Number(active?.startDay ?? 0));
                const doneDays = clampLocal(Number(progressDay) - Number(active?.startDay ?? 0), 0, dur);

                if (type === 'mining') {
                  const totalLen = Math.max(0, toFiniteLocal(active?.lengthM, 0));
                  const doneLen = clampLocal(doneDays * shearAdvanceRate * utilization, 0, totalLen || Infinity);
                  const frac = (totalLen > 1e-6) ? clamp01Local(doneLen / totalLen) : clamp01Local(doneDays / dur);
                  return `${label} ${fmtNum(frac * 100, 0)}%（${fmtNum(doneLen, 0)}/${fmtNum(totalLen, 0)}m）`;
                }

                return `${label} ${fmtNum((doneDays / dur) * 100, 0)}%`;
              })();

              const progressLeft = ((progressDay - minDay) / total) * 100;
              return (
                <div
                  key={wf}
                  className={`flex items-center gap-2 ${isSelected ? 'bg-indigo-50/60 rounded-xl px-1 py-0.5' : ''}`}
                  onMouseEnter={() => onHoverWorkfaceId?.(wf)}
                  onMouseLeave={() => onHoverWorkfaceId?.(null)}
                >
                  <div className={`w-16 flex-shrink-0 text-[13px] font-mono truncate pr-2 text-right ${isHovered || isSelected ? 'text-slate-900 font-black' : 'text-slate-700'}`}>{wf}</div>
                  <div className={`flex-1 h-8 bg-slate-100 rounded relative ${isHovered ? 'ring-2 ring-slate-900/15' : ''} ${isSelected ? 'ring-2 ring-indigo-600/25' : ''}`}>
                    <div className="absolute top-0 bottom-0 w-px bg-slate-900/25 pointer-events-none" style={{ left: `${progressLeft}%` }} />
                    {wfTasks.map((t, idx) => {
                      const left = ((t.startDay - minDay) / total) * 100;
                      const width = ((t.endDay - t.startDay) / total) * 100;

                      const dur = Math.max(1e-6, Number(t.endDay) - Number(t.startDay));
                      const doneDays = clampLocal(Number(progressDay) - Number(t.startDay), 0, dur);

                      let doneFrac = clamp01Local(doneDays / dur);
                      let progressHint = '';
                      if (String(t?.type) === 'mining') {
                        const totalLen = Math.max(0, toFiniteLocal(t?.lengthM, 0));
                        const doneLen = clampLocal(doneDays * shearAdvanceRate * utilization, 0, totalLen || Infinity);
                        doneFrac = (totalLen > 1e-6) ? clamp01Local(doneLen / totalLen) : doneFrac;
                        progressHint = `；推进：${fmtNum(doneLen, 0)}/${fmtNum(totalLen, 0)}m`;
                      }

                      return (
                        <div
                          key={idx}
                          className="absolute top-0 bottom-0 overflow-hidden rounded"
                          style={{ left: `${left}%`, width: `${Math.max(width, 0.8)}%` }}
                        >
                          <div
                            className={`absolute inset-0 h-full ${colorOf(t.type)} opacity-90`}
                            title={`${t.type}: ${fmtNum(t.startDay, 1)}~${fmtNum(t.endDay, 1)}天；进度：${fmtNum(doneFrac * 100, 0)}%${progressHint}`}
                            onMouseEnter={() => onHoverWorkfaceId?.(wf)}
                          />
                          {doneFrac > 1e-6 ? (
                            <>
                              <div
                                className="absolute left-0 top-0 bottom-0 bg-black/15 pointer-events-none"
                                style={{ width: `${fmtNum(doneFrac * 100, 3)}%` }}
                              />
                              {doneFrac < 0.999 ? (
                                <div
                                  className="absolute top-0 bottom-0 w-px bg-white/80 pointer-events-none"
                                  style={{ left: `${fmtNum(doneFrac * 100, 3)}%` }}
                                />
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <div className={`w-20 flex-shrink-0 text-[12px] truncate ${isHovered || isSelected ? 'text-slate-700 font-bold' : 'text-slate-400'}`} title={statusText}>
                    {statusText}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center mt-3 text-[12px] text-slate-500">
            <div className="w-16 flex-shrink-0" />
            <div className="flex flex-wrap gap-3">
              {[
                ['掘进', 'drive', 'bg-[rgb(79,89,109)]'],
                ['安装', 'install', 'bg-[rgb(250,192,15)]'],
                ['回采', 'mining', 'bg-[rgb(1,86,153)]'],
                ['搬家', 'relocation', 'bg-[rgb(243,118,74)]'],
              ].map(([label, key, cls]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <div className={`w-3 h-3 rounded ${cls}`} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SuccessionStage1View({
  source,
  loopsWorld,
  panels,
  plan,
  risk,
  yardOrder,
  onYardSelectDir,
  onYardConfirm,
  onYardClear,
  stage3,
  onStage3Run,
  onStage3Apply,
  onStage3ParamsChange,
  onStage3OrderModeChange,
  mineCapacityWanPerYear,
  productionParams,
  onPickWorkface,
}) {
  const ok = Boolean(plan?.ok);

  const [hoveredWorkfaceId, setHoveredWorkfaceId] = useState(null);
  const [selectedWorkfaceId, setSelectedWorkfaceId] = useState(null);

  const targetTonsPerMonth = useMemo(() => {
    const capWan = Number(mineCapacityWanPerYear);
    if (!Number.isFinite(capWan) || capWan <= 0) return null;
    // 万吨/年 -> t/月
    return (capWan * 10000) / 12;
  }, [mineCapacityWanPerYear]);

  const selectedPanel = useMemo(() => {
    const id = String(selectedWorkfaceId ?? '').trim();
    if (!id) return null;
    const ps = Array.isArray(panels) ? panels : [];
    return ps.find((p) => String(p?.id) === id) ?? null;
  }, [panels, selectedWorkfaceId]);

  const selectedFaceMonthly = useMemo(() => {
    const id = String(selectedWorkfaceId ?? '').trim();
    if (!id) return [];
    const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
    const daysPerMonth = Math.max(1, Math.round(Number(plan?.daysPerMonth) || 25));
    const miningTasks = tasks.filter((t) => t?.type === 'mining' && String(t?.workface) === id);
    if (!miningTasks.length) return [];

    const pp = (productionParams && typeof productionParams === 'object') ? productionParams : {};
    const utilization = Math.max(0, Math.min(1, Number(pp?.utilization ?? 0.85)));
    const shearAdvanceRate = Math.max(0, Number(pp?.shearAdvanceRate ?? 6));
    const coalDensity = Math.max(0, Number(pp?.coalDensity ?? 1.35));
    const miningHeightM = Math.max(0, Number(pp?.miningHeightM ?? 4.5));
    const rrMin = Math.max(0, Math.min(1, Number(pp?.recoveryRateMin ?? 0.85)));
    const rrMax = Math.max(0, Math.min(1, Number(pp?.recoveryRateMax ?? 0.95)));
    const recoveryRate = Math.max(0, Math.min(1, (rrMin + rrMax) / 2));

    const widthM = Math.max(0, Number(selectedPanel?.widthM ?? 0));
    const totalEndDay = Math.max(...miningTasks.map((t) => Number(t?.endDay) || 0));
    const totalMonths = Math.max(1, Math.ceil(totalEndDay / daysPerMonth));

    const out = [];
    for (let m = 1; m <= totalMonths; m++) {
      const mStart = (m - 1) * daysPerMonth;
      const mEnd = m * daysPerMonth;

      let tonnage = 0;
      for (const t of miningTasks) {
        const startDay = Number(t?.startDay) || 0;
        const endDay = Number(t?.endDay) || 0;
        const overlap = Math.max(0, Math.min(endDay, mEnd) - Math.max(startDay, mStart));
        if (!(overlap > 1e-9)) continue;
        const len = overlap * shearAdvanceRate * utilization;
        const volume = len * widthM * miningHeightM;
        tonnage += volume * coalDensity * recoveryRate;
      }
      out.push({ month: m, tonnage });
    }
    return out;
  }, [selectedWorkfaceId, plan?.tasks, plan?.daysPerMonth, productionParams, selectedPanel?.widthM]);

  const prodData = useMemo(() => {
    const useSelected = Boolean(String(selectedWorkfaceId ?? '').trim()) && Array.isArray(selectedFaceMonthly) && selectedFaceMonthly.length;
    const rows = useSelected ? selectedFaceMonthly : (Array.isArray(plan?.monthly) ? plan.monthly : []);
    return rows.map((r) => ({
      month: r.month,
      tonnage: Number(r.tonnage) || 0,
      // 目标线是“全矿月度目标”，选中单面时不显示，避免误导。
      target: (!useSelected && Number.isFinite(targetTonsPerMonth)) ? targetTonsPerMonth : null,
    }));
  }, [plan?.monthly, targetTonsPerMonth, selectedWorkfaceId, selectedFaceMonthly]);

  const riskData = useMemo(() => {
    const rows = Array.isArray(risk?.rows) ? risk.rows : [];
    const metric = String(risk?.metric ?? 'p90');
    const key = (metric === 'p95') ? 'p95' : (metric === 'mean') ? 'mean' : (metric === 'exceed') ? 'exceed' : 'p90';
    return rows.map((r) => ({
      month: r.month,
      value: Number(r?.[key]),
      threshold: (key === 'exceed') ? null : Number(risk?.threshold),
    }));
  }, [risk?.rows, risk?.metric, risk?.threshold]);

  if (!source?.ok) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-amber-500 mt-0.5" size={18} />
          <div className="min-w-0">
            <div className="text-sm font-black text-slate-800">请先确认开采方案</div>
            <div className="text-xs text-slate-500 mt-1 leading-5">
              当前未检测到“协同调控已确认方案”，也没有“采区规划已选中方案”。
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={source?.goPlanning}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800"
              >
                去采区规划选择
              </button>
              <button
                type="button"
                onClick={source?.goCocontrol}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700"
              >
                去协同调控确认
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-black text-slate-800">方案来源：{source.label}</div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
            {ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            <span className="font-bold">{ok ? '已生成计划' : '未生成'}</span>
          </div>
          <div className="text-[11px] text-slate-400">工作面：{Array.isArray(panels) ? panels.length : 0}</div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-5 flex flex-col gap-3 min-h-0">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="text-[13px] font-black text-slate-600">总工期</div>
              <div className="mt-1 text-2xl font-mono font-bold text-slate-800">{fmtNum(plan?.totalMonths, 0)} 月</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="text-[13px] font-black text-slate-600">目标产能</div>
              <div className="mt-1 text-2xl font-mono font-bold text-slate-800">{fmtNum(mineCapacityWanPerYear, 0)} 万吨/年</div>
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <MiniPlanPreview
              loopsWorld={loopsWorld}
              panels={panels}
              productionParams={productionParams}
              hoveredWorkfaceId={hoveredWorkfaceId}
              selectedWorkfaceId={selectedWorkfaceId}
              onPickWorkface={(p) => {
                const wf = String(p?.workfaceId ?? '').trim();
                if (!wf) return;
                setSelectedWorkfaceId(wf);
                setHoveredWorkfaceId(wf);
                onPickWorkface?.(p);
              }}
              onHoverWorkfaceId={setHoveredWorkfaceId}
              yardOrder={yardOrder}
              onYardSelectDir={onYardSelectDir}
              onYardConfirm={onYardConfirm}
              onYardClear={onYardClear}
            />
          </div>
        </div>

        <div className="col-span-12 xl:col-span-7 flex flex-col gap-4 min-h-0">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <div className="text-[13px] font-black text-slate-600">月产曲线{String(selectedWorkfaceId ?? '').trim() ? `· ${String(selectedWorkfaceId)}` : ''}</div>
              <div className="flex items-center gap-2">
                <div className="text-[10px] text-slate-400">万t/月{String(selectedWorkfaceId ?? '').trim() ? '' : '（含目标线）'}</div>
                {String(selectedWorkfaceId ?? '').trim() && (
                  <button
                    type="button"
                    className="px-2.5 py-1.5 rounded-xl text-[11px] font-black bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                    onClick={() => setSelectedWorkfaceId(null)}
                    title="清除选中，恢复全矿月产"
                  >
                    清除选中
                  </button>
                )}
              </div>
            </div>
            <div className="h-[260px] p-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={prodData} margin={{ top: 10, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={46}
                    tickMargin={2}
                    tickFormatter={(v) => fmtNum(Number(v) / 10000, 1)}
                  />
                  <Tooltip
                    labelFormatter={(m) => `${String(m)}月`}
                    formatter={(v, name) => [fmtNum(Number(v) / 10000, 2), String(name ?? '')]}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="tonnage"
                    name={String(selectedWorkfaceId ?? '').trim() ? '该面月产量（万t）' : '月产量（万t）'}
                    stroke={String(selectedWorkfaceId ?? '').trim() ? '#6366f1' : '#015699'}
                    strokeWidth={2}
                    dot={false}
                  />
                  {Number.isFinite(targetTonsPerMonth) && (
                    <Line type="monotone" dataKey="target" name="目标" stroke="#111827" strokeWidth={2} strokeDasharray="6 4" dot={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <div className="text-[13px] font-black text-slate-600">ODI 风险曲线</div>
              <div className="text-[10px] text-slate-400">
                {risk?.ok ? `${String(risk?.fieldLabel ?? 'ODI')} · 指标=${String(risk?.metric ?? 'p90')}` : '需要 ODI 插值场/ODI*'}
              </div>
            </div>

            {!risk?.ok ? (
              <div className="p-4 flex-1 min-h-0">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="text-amber-500 mt-0.5" size={18} />
                  <div className="min-w-0">
                    <div className="text-sm font-black text-slate-800">暂无法生成 ODI 风险曲线</div>
                    <div className="text-xs text-slate-500 mt-1 leading-5">
                      {String(risk?.reason ?? '缺少 ODI 插值场或尚未生成排程。')}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={source?.goOdi}
                        className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800"
                      >
                        去ODI生成插值场
                      </button>
                      <button
                        type="button"
                        onClick={source?.goCocontrol}
                        className="px-3 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700"
                      >
                        去协同调控（ODI*）
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0 p-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={riskData} margin={{ top: 10, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 1]} width={44} tickMargin={2} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="value" name="ODI风险" stroke="#f97316" strokeWidth={2} dot={false} />
                    {Number.isFinite(Number(risk?.threshold)) && String(risk?.metric ?? 'p90') !== 'exceed' && (
                      <ReferenceLine y={Number(risk?.threshold)} stroke="#111827" strokeDasharray="6 4" ifOverflow="extendDomain" />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>

      <Stage1Gantt
        tasks={plan?.tasks ?? []}
        daysPerMonth={plan?.daysPerMonth ?? 25}
        productionParams={productionParams}
        hoveredWorkfaceId={hoveredWorkfaceId}
        selectedWorkfaceId={selectedWorkfaceId}
        onHoverWorkfaceId={setHoveredWorkfaceId}
      />

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
          <div className="text-[13px] font-black text-slate-600">推荐与对比</div>
          <button
            type="button"
            onClick={onStage3Run}
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800"
          >
            生成推荐
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            <div className="space-y-1 lg:col-span-1">
              <div className="text-xs text-slate-400 font-black">权重-稳产</div>
              <input
                type="number"
                step="0.05"
                value={stage3?.params?.wProd}
                onChange={(e) => onStage3ParamsChange?.({ wProd: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="space-y-1 lg:col-span-1">
              <div className="text-xs text-slate-400 font-black">权重-风险</div>
              <input
                type="number"
                step="0.05"
                value={stage3?.params?.wRisk}
                onChange={(e) => onStage3ParamsChange?.({ wRisk: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="space-y-1 lg:col-span-1">
              <div className="text-xs text-slate-400 font-black">权重-工期</div>
              <input
                type="number"
                step="0.05"
                value={stage3?.params?.wMonths}
                onChange={(e) => onStage3ParamsChange?.({ wMonths: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="space-y-1 sm:col-span-2 lg:col-span-2">
              <div className="text-xs text-slate-400 font-black">
                回采顺序（风险口径：{stage3?.hasCurveRisk ? '协同调控推进曲线' : '未启用'}）
              </div>
              <select
                value={stage3?.orderMode ?? 'yardConfirmed'}
                onChange={(e) => onStage3OrderModeChange?.(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-[11px] font-bold outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="faceIndex">按工作面储量排序（由大到小）</option>
                <option value="yardConfirmed">按距工业广场远近排序（由近及远）</option>
                <option value="odiLowFirst">按ODI风险低优先（先低后高）</option>
              </select>
            </div>
          </div>

          {stage3?.result?.ok && Array.isArray(stage3?.result?.results) && (
            <div className="grid gap-2 sm:grid-flow-col sm:auto-cols-[minmax(320px,1fr)] sm:grid-rows-2 sm:overflow-x-auto sm:pr-1">
              {stage3.result.results
                .filter((r) => String(r?.key ?? '') !== 'base')
                .sort((a, b) => {
                  const sa = Number(a?.score);
                  const sb = Number(b?.score);
                  const fa = Number.isFinite(sa);
                  const fb = Number.isFinite(sb);
                  if (fa && fb) return sb - sa;
                  if (fa && !fb) return -1;
                  if (!fa && fb) return 1;
                  return 0;
                })
                .map((r) => {
                const hit = Number.isFinite(Number(r?.planSummary?.hitRate)) ? (Number(r.planSummary.hitRate) * 100) : null;
                const score = Number.isFinite(Number(r?.score)) ? Number(r.score) : null;
                const rm = Number.isFinite(Number(r?.planSummary?.riskMax)) ? Number(r.planSummary.riskMax) : null;

                const orderModeLabel = (m0) => {
                  const m = String(m0 ?? '');
                  if (m === 'faceIndex') return '按工作面储量排序（由大到小）';
                  if (m === 'yardConfirmed') return '按距工业广场远近排序（由近及远）';
                  if (m === 'odiLowFirst') return '按ODI风险低优先（先低后高）';
                  return m || '-';
                };

                const riskSourceLabel = (s0) => {
                  const s = String(s0 ?? '');
                  if (!s || s === 'n/a') return '-';
                  if (s === 'cocontrol-curve') return '协同调控推进曲线';
                  if (s === 'odi-field') return 'ODI插值场';
                  if (s === 'odi-star') return 'ODI标定（ODI*）';
                  return s;
                };

                return (
                  <div key={r.key} className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 h-full">
                    <div className="grid grid-cols-12 gap-x-3 gap-y-1 items-center">
                      <div className="col-span-12 sm:col-span-9 min-w-0">
                        <div className="text-xs font-black text-slate-700 truncate">{r.label}</div>
                      </div>
                      <div className="col-span-12 sm:col-span-3 flex items-center justify-start sm:justify-end">
                        <button
                          type="button"
                          onClick={() => onStage3Apply?.(r)}
                          className="px-3 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                          应用
                        </button>
                      </div>

                      <div className="col-span-12 text-[10px] text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                        <span>评分：{score == null ? '-' : score.toFixed(2)}</span>
                        <span>工期：{String(r?.planSummary?.months ?? '-')}个月</span>
                        <span>达标率：{hit == null ? '-' : `${hit.toFixed(0)}%`}</span>
                        <span>ODI峰值：{rm == null ? '-' : rm.toFixed(2)}</span>
                        <span className="text-slate-400">排序：{orderModeLabel(r?.orderMode ?? 'faceIndex')}</span>
                        <span className="text-slate-400">风险来源：{riskSourceLabel(r?.riskSource ?? 'n/a')}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {stage3?.result && !stage3?.result?.ok && (
            <div className="text-xs text-rose-600">推荐计算失败：{String(stage3?.result?.error ?? '')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
