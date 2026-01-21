import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { 
  Activity, 
  BrainCircuit,
  CalendarClock,
  CircleDollarSign,
  DraftingCompass,
  ListOrdered,
  Settings, 
  FileUp, 
  AlertTriangle, 
  CheckCircle2,
  BarChart3, 
  Grid, 
  Droplets, 
  ArrowUpCircle, 
  TrendingDown, 
  Maximize2, 
  RefreshCw, 
  Undo2,
  Redo2,
  Trash2,
  Info, 
  MapPin, 
  Layers, 
  Box,
  ClipboardCheck,
  Zap,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import PlanningDebugPanel from './planning/PlanningDebugPanel.jsx';
import { Delaunay } from 'd3-delaunay';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import SmoothnessSlider from './components/SmoothnessSlider.jsx';
import MultiObjectivePlanPanel from './components/MultiObjectivePlanPanel.jsx';

const DEFAULT_PLANNING_PARAMS = {
  mineCapacity: '',
  seamThickness: '',
  coalDensity: '1.4',
  recoveryRateMin: '0.85',
  recoveryRateMax: '0.95',
  roadwayOrientation: 'x',
  miningMethod: '综放',
  coalPillarMin: '30',
  coalPillarMax: '50',
  coalPillarTarget: '40',
  faceCountSuggestedMin: '',
  faceCountSuggestedMax: '',
  faceCountSelected: '',
  faceWidthMin: '',
  faceWidthMax: '',
  faceAdvanceMin: '',
  faceAdvanceMax: '',
  boundaryPillarMin: '50',
  boundaryPillarMax: '80',
  boundaryPillarTarget: '65',
};

const App = () => {
  const DEBUG_PANEL = import.meta.env.DEV;
  // Worker 抓包日志：在浏览器控制台执行 localStorage.setItem('mp.debugWorker','1') 并刷新即可开启。
  // 默认关闭，避免刷屏影响性能。
  const DEBUG_WORKER_LOG = (() => {
    try {
      return String(window?.localStorage?.getItem('mp.debugWorker') ?? '') === '1';
    } catch {
      return false;
    }
  })();
  const workerLog = (...args) => { if (DEBUG_WORKER_LOG) console.log(...args); };
  const workerWarn = (...args) => { if (DEBUG_WORKER_LOG) console.warn(...args); };
  const workerError = (...args) => { if (DEBUG_WORKER_LOG) console.error(...args); };
  // 状态管理：场景切换、采高、步长、富裕系数及权重
  const [activeTab, setActiveTab] = useState('surface'); 
  const [mainViewMode, setMainViewMode] = useState('odi'); // 'odi' | 'geology' | 'planning'
  const [miningHeight, setMiningHeight] = useState(4.5);
  const [stepLength, setStepLength] = useState(25);
  const [richFactor, setRichFactor] = useState(1.1);
  const [scenarioWeights, setScenarioWeights] = useState({ wd: 0.45, wo: 0.30, wf: 0.25 });
  const [lastParamExtractionMode, setLastParamExtractionMode] = useState('full'); // 'full' | 'geo'
  const [planningParams, setPlanningParams] = useState(() => ({ ...DEFAULT_PLANNING_PARAMS }));
  // 智能规划：保存反算可行解集，用于调节 N 时即时重绘
  const [planningReverseSolutions, setPlanningReverseSolutions] = useState([]);
  const [planningAdvanceAxis, setPlanningAdvanceAxis] = useState('x');
  // 智能规划：多目标规划优化方案（仅 UI 选择，不改既有算法触发逻辑）
  const [planningOptMode, setPlanningOptMode] = useState('efficiency'); // 'efficiency' | 'disturbance' | 'recovery' | 'weighted'
  const [planningOptWeights, setPlanningOptWeights] = useState({ efficiency: 0.34, disturbance: 0.33, recovery: 0.33 });

  // 工程效率最优（候选 + 缓存 + 联动绘图）
  const efficiencyWorkerRef = useRef(null);
  const resourceWorkerRef = useRef(null);
  const efficiencyCacheRef = useRef(new Map());
  const efficiencyReqSeqRef = useRef(0);
  const efficiencyPendingRefineKeyRef = useRef('');
  const efficiencyPendingRefineAxisRef = useRef('');
  // 记录“正在计算中的请求”对应的 cacheKey：用于按钮二次点击时判断是否需要重算。
  const efficiencyInFlightKeyRef = useRef('');
  // 记住“用户手动选择的候选方案”（按 cacheKey 维度），避免 refine/full 回包把选中态强行覆盖回 best。
  const efficiencySelectedSigByKeyRef = useRef(new Map());

  const [planningEfficiencyBusy, setPlanningEfficiencyBusy] = useState(false);
  const [planningEfficiencyResult, setPlanningEfficiencyResult] = useState(null);
  const [planningEfficiencyCacheKey, setPlanningEfficiencyCacheKey] = useState('');
  // progress/filter 需要“同步可读”的最新 cacheKey（避免 setState 尚未生效导致丢弃 progress）。
  const planningEfficiencyCacheKeyRef = useRef('');
  const [planningEfficiencySelectedSig, setPlanningEfficiencySelectedSig] = useState('');
  const [planningInnerOmegaOverrideWb, setPlanningInnerOmegaOverrideWb] = useState(null);
  const [planningEfficiencyShowAllCandidates, setPlanningEfficiencyShowAllCandidates] = useState(false);
  const [planningEfficiencyProgress, setPlanningEfficiencyProgress] = useState(null);
  const planningEfficiencyProgressLastTsRef = useRef(0);
  // 显式点击触发时：至少展示一小段时间的“计算中…”，避免结果过快返回导致肉眼看不到。
  const planningEfficiencyMinBusyUntilRef = useRef(0);
  const planningEfficiencyMinBusyReqSeqRef = useRef(0);

  // 工程效率：计算过程弹窗（用于复制“请求+回包+TopK候选关键字段”给排障用）
  const efficiencyLastRequestRef = useRef(null);
  const efficiencyLastResponseRef = useRef(null);
  const [planningEfficiencyDebugOpen, setPlanningEfficiencyDebugOpen] = useState(false);
  const [planningEfficiencyDebugText, setPlanningEfficiencyDebugText] = useState('');

  // 资源回收最优（复用同一 worker：传 optMode=recovery，按吨位/覆盖率排序）
  const recoveryCacheRef = useRef(new Map());
  const recoveryReqSeqRef = useRef(0);
  const recoveryPendingRefineKeyRef = useRef('');
  const recoveryPendingRefineAxisRef = useRef('');
  const recoveryInFlightKeyRef = useRef('');
  const recoverySelectedSigByKeyRef = useRef(new Map());

  const [planningRecoveryBusy, setPlanningRecoveryBusy] = useState(false);
  const [planningRecoveryResult, setPlanningRecoveryResult] = useState(null);
  const [planningRecoveryCacheKey, setPlanningRecoveryCacheKey] = useState('');
  const planningRecoveryCacheKeyRef = useRef('');
  const [planningRecoverySelectedSig, setPlanningRecoverySelectedSig] = useState('');
  const [planningRecoveryShowAllCandidates, setPlanningRecoveryShowAllCandidates] = useState(false);
  const [planningRecoveryProgress, setPlanningRecoveryProgress] = useState(null);
  const planningRecoveryProgressLastTsRef = useRef(0);
  const planningRecoveryMinBusyUntilRef = useRef(0);
  const planningRecoveryMinBusyReqSeqRef = useRef(0);

  // 资源回收：调试弹窗（用于复制“请求+回包+TopK候选关键字段”给排障用）
  const recoveryLastRequestRef = useRef(null);
  const recoveryLastResponseRef = useRef(null);
  const [planningRecoveryDebugOpen, setPlanningRecoveryDebugOpen] = useState(false);
  const [planningRecoveryDebugText, setPlanningRecoveryDebugText] = useState('');

  // “启动智能采区规划”：首次默认工程效率；后续按多目标 tab 选择触发
  const planningHasStartedRef = useRef(false);

  // 工程效率：预览布局（当 N 不在 bestKeyByN 时给一个“可画出来但不保证最优”的方案）
  const efficiencyPreviewReqSeqRef = useRef(0);
  const efficiencyPreviewDebounceRef = useRef(null);
  const [planningEfficiencyPreviewBusy, setPlanningEfficiencyPreviewBusy] = useState(false);
  const [planningEfficiencyPreview, setPlanningEfficiencyPreview] = useState(null);

  // 调试面板快照：用于追踪“输入 -> 请求 -> 响应”链路（DEV only）
  const [planningDebugSnapshot, setPlanningDebugSnapshot] = useState(null);

  const hashStringFNV1a32 = (s) => {
    const str = String(s ?? '');
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `h${h.toString(16).padStart(8, '0')}`;
  };

  const hashBoundaryLoopWorld = (loop) => {
    const pts = Array.isArray(loop) ? loop : [];
    if (!pts.length) return 'h00000000';
    const parts = [];
    for (const p of pts) {
      const x = Number(p?.x);
      const y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      parts.push(`${x.toFixed(3)},${y.toFixed(3)}`);
    }
    return hashStringFNV1a32(parts.join(';'));
  };

  const parseNonNegOrNull = (v) => {
    if (v == null) return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  };

  const getFaceWidthRange = () => {
    const defLo = 100;
    const defHi = 350;

    const rawLo = planningParams?.faceWidthMin;
    const rawHi = planningParams?.faceWidthMax;

    const parseOptionalNumber = (v) => {
      if (v == null) return null;
      if (typeof v === 'string' && v.trim() === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const lo0 = parseOptionalNumber(rawLo);
    const hi0 = parseOptionalNumber(rawHi);

    const warnings = [];
    let invalid = false;
    if (lo0 != null && lo0 <= 0) invalid = true;
    if (hi0 != null && hi0 <= 0) invalid = true;

    let a = (lo0 != null ? lo0 : defLo);
    let b = (hi0 != null ? hi0 : defHi);

    // 输入了非法值（<=0）：回退默认（A1 规则）
    if (invalid) {
      a = defLo;
      b = defHi;
      warnings.push('宽度范围非法（应为正数），已回退默认');
    }

    // 仅在没有触发“非法回退默认”时处理 min>max 交换
    if (!invalid && Number.isFinite(a) && Number.isFinite(b) && a > b) {
      const t = a;
      a = b;
      b = t;
      warnings.push('宽度范围 min>max，已自动交换');
    }

    // 最终兜底：确保为正数
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
      a = defLo;
      b = defHi;
      warnings.push('宽度范围解析失败，已回退默认');
    }

    return {
      min: a,
      max: b,
      defMin: defLo,
      defMax: defHi,
      rawMin: rawLo,
      rawMax: rawHi,
      warnings,
    };
  };

  const getRangeWithFallback = (minV, maxV, targetV) => {
    const t = parseNonNegOrNull(targetV);
    const lo = parseNonNegOrNull(minV);
    const hi = parseNonNegOrNull(maxV);
    const mean = (lo != null && hi != null) ? (lo + hi) / 2 : (t != null ? t : 0);
    const a = (lo != null ? lo : (t != null ? t : mean));
    const b = (hi != null ? hi : (t != null ? t : mean));
    return { min: Math.min(a, b), max: Math.max(a, b) };
  };

  const computeBoundaryBboxWorld = (loop) => {
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
    if (!count || !Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return { xmin: null, xmax: null, ymin: null, ymax: null };
    }
    return { xmin: minX, xmax: maxX, ymin: minY, ymax: maxY };
  };

  const buildEfficiencyDebugResponseSummary = (result, selectedSig) => {
    const r = result ?? null;
    const list = Array.isArray(r?.candidates) ? r.candidates : [];
    const ok = Boolean(r?.ok);
    const failedReason = ok ? '' : String(r?.failedReason ?? r?.message ?? '');

    const pickBySig = (sig) => {
      const s = String(sig ?? '');
      if (!s) return null;
      return list.find((c) => String(c?.signature) === s) ?? null;
    };
    const top1 = pickBySig(r?.bestSignature) ?? list[0] ?? null;
    const selected = pickBySig(selectedSig) ?? pickBySig(r?.bestSignature) ?? list[0] ?? null;

    const toLoops = (c) => {
      const loops = Array.isArray(c?.omegaRender?.loops)
        ? c.omegaRender.loops
        : (Array.isArray(c?.omegaRender?.innerOmegaLoopWorld) ? [c.omegaRender.innerOmegaLoopWorld] : []);
      return loops;
    };

    const toResultOmegaLoops = () => {
      const loops = Array.isArray(r?.omegaRender?.loops)
        ? r.omegaRender.loops
        : (Array.isArray(r?.omegaRender?.innerOmegaLoopWorld) ? [r.omegaRender.innerOmegaLoopWorld] : []);
      return loops;
    };
    const toFaces = (c) => {
      if (Array.isArray(c?.render?.rectLoops)) {
        return c.render.rectLoops
          .map((loop, idx) => ({ faceIndex: idx + 1, loop }))
          .filter((x) => Array.isArray(x?.loop) && x.loop.length >= 3);
      }
      const faces = Array.isArray(c?.render?.facesLoops)
        ? c.render.facesLoops
        : (Array.isArray(c?.render?.plannedWorkfaceLoopsWorld) ? c.render.plannedWorkfaceLoopsWorld : []);
      return faces;
    };
    const loopPointsSum = (arr) => (arr ?? []).reduce((sum, item) => sum + (Array.isArray(item) ? item.length : 0), 0);
    const facesPointsSum = (arr) => (arr ?? []).reduce((sum, item) => sum + (Array.isArray(item?.loop) ? item.loop.length : 0), 0);

    const omegaLoops = toResultOmegaLoops();
    const selectedFacesLoops = selected ? toFaces(selected) : [];

    const omegaArea = Number(r?.omegaArea);
    const faceAreaTotal = Number(selected?.metrics?.faceAreaTotal ?? selected?.coveredArea);
    const ratio = Number(selected?.metrics?.coverageRatio ?? selected?.coverageRatio ?? selected?.metrics?.recoveryRatio ?? selected?.recoveryRatio);

    const omegaAreaOut = Number.isFinite(omegaArea) ? omegaArea : null;
    const omegaEmpty = omegaLoops.length === 0 || (omegaAreaOut != null && omegaAreaOut <= 0);
    const facesEmpty = selectedFacesLoops.length === 0 || !(Number(selected?.N ?? selected?.metrics?.faceCount ?? 0) > 0);

    const attemptSummary = r?.attemptSummary ?? null;
    const omegaReadyButNoCandidates = !ok && omegaLoops.length > 0;

    return {
      ok,
      failedReason,
      reqSeq: r?.reqSeq ?? null,
      cacheKey: r?.cacheKey ?? null,
      candidatesCount: list.length,
      selectedCandidateKey: selected ? String(selected?.signature ?? '') : '',

      omegaArea: omegaAreaOut,
      omegaLoopsCount: omegaLoops.length,
      omegaTotalPoints: loopPointsSum(omegaLoops),
      omegaEmpty,
      omegaReadyButNoCandidates,

      attemptSummary: attemptSummary
        ? {
          attemptedCombos: attemptSummary?.attemptedCombos ?? null,
          feasibleCombos: attemptSummary?.feasibleCombos ?? null,
          failTypes: attemptSummary?.failTypes ?? null,
        }
        : null,

      facesLoopsCount: selectedFacesLoops.length,
      facesTotalPoints: facesPointsSum(selectedFacesLoops),
      faceAreaTotal: Number.isFinite(faceAreaTotal) ? faceAreaTotal : null,
      facesEmpty,

      N: selected?.N ?? selected?.metrics?.faceCount ?? null,
      B: selected?.B ?? null,
      wb: selected?.wb ?? selected?.genes?.wb ?? null,
      ws: selected?.ws ?? selected?.genes?.ws ?? null,
      coverageRatio: Number.isFinite(ratio) ? ratio : null,

      top1: top1
        ? {
          key: String(top1?.signature ?? ''),
          wb: top1?.wb ?? top1?.genes?.wb ?? null,
          ws: top1?.ws ?? top1?.genes?.ws ?? null,
          N: top1?.N ?? top1?.metrics?.faceCount ?? null,
          B: top1?.B ?? null,
          ratio: Number(top1?.metrics?.coverageRatio ?? top1?.coverageRatio ?? top1?.metrics?.recoveryRatio ?? top1?.recoveryRatio) || null,
        }
        : null,
    };
  };

  const buildEfficiencyCacheKey = () => {
    const axis = (String(planningParams?.roadwayOrientation ?? 'x') === 'y') ? 'y' : 'x';
    const bHash = hashBoundaryLoopWorld(boundaryLoopWorld);

    const wbR = getRangeWithFallback(planningParams?.boundaryPillarMin, planningParams?.boundaryPillarMax, planningParams?.boundaryPillarTarget);
    const wsR = getRangeWithFallback(planningParams?.coalPillarMin, planningParams?.coalPillarMax, planningParams?.coalPillarTarget);
    const fw = getFaceWidthRange();

    // 工程效率最优（更新：2026-01-20）：wb 固定取最小值；ws 在范围内按 1m 步长枚举
    const wbRep = (Number.isFinite(Number(wbR?.min)) && Number.isFinite(Number(wbR?.max)))
      ? Math.min(Number(wbR.min), Number(wbR.max))
      : (Number.isFinite(Number(wbR?.min)) ? Number(wbR.min) : 0);

    const f3 = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(3) : '0.000');

    // v2 评分口径：用于缓存隔离（避免新旧评分/排序口径混用同一 cacheKey）
    const effScoreSpec = 'effScore=v2(wN=0.20,wCV=10.0,wShort=5.0,minLRef=100)';
    const sortSpec = 'sort=coverageFirst(eps=1e-5,tie=NascThenScoreV2)';

    // 工程效率“均衡档近似”（默认启用）：确定性粗到细 + 种子精修
    // - ws：9 点采样（包含端点 + target）
    // - B：10m 粗搜 + 局部 1m 精修（win=12m, seed=3）
    // - Ncap：20
    const effSearchProfile = 'balanced-v1(ws=9,target=on,Ncap=20,B=10->1,seed=3,win=12)';
    const wsTarget = parseNonNegOrNull(planningParams?.coalPillarTarget);
    return [
      'eff',
      `axis=${axis}`,
      `bnd=${bHash}`,
      `wb=${f3(wbRep)}`,
      `ws=${f3(wsR.min)}-${f3(wsR.max)}`,
      `wsTarget=${f3(wsTarget ?? (wsR.min + wsR.max) / 2)}`,
      'wsEnum=coarse9',
      `B=${f3(fw.min)}-${f3(fw.max)}`,
      `Bdef=${f3(fw.defMin)}-${f3(fw.defMax)}`,
      // worker 内搜索策略版本（均衡档近似）：确定性粗到细
      `searchProfile=${effSearchProfile}`,
      'Bsearch=v4(balancedCoarse=10,fastCoarse=5,fine=1,win=12,seed=3,topM=3,Ncap=20)',
      // axis=y 内部 swapXY 修复版本（用于淘汰历史错误缓存）
      'axisSwapFix=v1',
      effScoreSpec,
      sortSpec,
    ].join('|');
  };

  const hashCoalThicknessSamples = (samples) => {
    const pts = Array.isArray(samples) ? samples : [];
    if (!pts.length) return 'h00000000';
    const parts = [];
    for (const p of pts) {
      const x = Number(p?.x);
      const y = Number(p?.y);
      const v = Number(p?.value ?? p?.v ?? p?.thickness ?? p?.Mi);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(v)) continue;
      parts.push(`${x.toFixed(3)},${y.toFixed(3)},${v.toFixed(3)}`);
    }
    return hashStringFNV1a32(parts.join(';'));
  };

  const buildRecoveryCacheKey = () => {
    // 资源回收：缓存必须与实际请求轴向一致，否则会命中旧缓存导致“看起来没变化”
    const axis = (String(planningParams?.roadwayOrientation ?? 'x') === 'y') ? 'y' : 'x';
    const bHash = hashBoundaryLoopWorld(boundaryLoopWorld);

    const wbR = getRangeWithFallback(planningParams?.boundaryPillarMin, planningParams?.boundaryPillarMax, planningParams?.boundaryPillarTarget);
    const wsR = getRangeWithFallback(planningParams?.coalPillarMin, planningParams?.coalPillarMax, planningParams?.coalPillarTarget);
    const fw = getFaceWidthRange();

    // 资源回收最优：边界煤柱/区段煤柱均按“最小值”口径固定参与计算（用于统一验收口径）
    const wbEff = Number.isFinite(Number(wbR?.min)) ? Number(wbR.min) : 0;
    const wsEff = Number.isFinite(Number(wsR?.min)) ? Number(wsR.min) : 0;
    const wbRep = wbEff;

    const seamThickness = Number(planningParams?.seamThickness);
    const coalDensity = Number(planningParams?.coalDensity);
    const hasConstThk = Number.isFinite(seamThickness) && seamThickness > 0;
    const rho = (Number.isFinite(coalDensity) && coalDensity > 0) ? coalDensity : 1;

    const thkSamples = boreholeParamSamples?.CoalThk;
    const thicknessDataHash = hashCoalThicknessSamples(thkSamples);
    const thkCount = Array.isArray(thkSamples) ? thkSamples.length : 0;
    const targetSeam = 'CoalThk';
    const gridRes = 20;
    const interpVersion = 'idw-v1';

    const f3 = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(3) : '0.000');
    // v1.0：明确 wbMin/wbMax/wbFixed；recovery 口径固定取最小值
    const wbFixedRaw = wbEff;

    const perFaceTrapezoid = true;
    const perFaceInRatioMin = 0.7;
    const perFaceAdjMaxStepDeg = 4;
    const perFaceDeltaSetDeg = [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10];
    const perFaceMaxSeq = 160;
    const perFaceSeedM = 12;
    const perFaceNSet = [3, 4, 5, 6, 7];
    const perFaceExtraBudgetMs = 1500;
    const perFaceVarB = true;
    const perFaceBListMax = 10;
    const preferPerFaceBest = false;
    const relaxedAllowPerFaceShift = true;

    // v1.1：工程化全覆盖（分段变宽 + 残煤清扫）参数纳入 cacheKey
    const segLtM = 50;
    const segGmax = 0.4; // m/m（等价：每100m允许变宽/变窄≤40m）
    const segDeltaBMaxMain = 5;
    const segDeltaBMaxCleanup = 10;
    const cleanupEnable = true;
    const cleanupAllowAddShortFace = true;

    const fullCover = true;
    const fullCoverMin = 0.995;
    const ignoreCoalPillarsInCoverage = true;

    return [
      'res',
      // v1.2：破坏旧缓存（修复：缓存 key 轴向一致性 + worker 裁剪 loop 稳定性）
      'res-v1.2',
      `axis=${axis}`,
      `bnd=${bHash}`,
      `wbMin=${f3(wbEff)}`,
      `wbMax=${f3(wbEff)}`,
      `wbFixed=${f3(wbFixedRaw)}`,
      `ws=${f3(wsEff)}-${f3(wsEff)}`,
      `B=${f3(fw.min)}-${f3(fw.max)}`,
      `thicknessDataHash=${thicknessDataHash}`,
      `targetSeam=${targetSeam}`,
      `gridRes=${gridRes}`,
      `interpVersion=${interpVersion}`,
      `thkN=${thkCount}`,
      `thkConst=${hasConstThk ? f3(seamThickness) : 'none'}`,
      `rho=${f3(rho)}`,
      // 厚度坐标系冻结：axis/y 不跟随 swap
      'thkAxisFixed=v1.0',
      // per-face “远边调斜”参数纳入 cacheKey，避免候选/缓存串扰
      `pfTrap=${perFaceTrapezoid ? '1' : '0'}`,
      `pfRmin=${f3(perFaceInRatioMin)}`,
      `pfAdj=${f3(perFaceAdjMaxStepDeg)}`,
      `pfDSet=${perFaceDeltaSetDeg.join(',')}`,
      `pfMaxSeq=${String(perFaceMaxSeq)}`,
      `pfSeedM=${String(perFaceSeedM)}`,
      `pfN=${perFaceNSet.join(',')}`,
      `pfExtra=${String(perFaceExtraBudgetMs)}`,
      `pfVarB=${perFaceVarB ? '1' : '0'}`,
      `pfBListMax=${String(perFaceBListMax)}`,
      `pfPrefer=${preferPerFaceBest ? '1' : '0'}`,
      `relShift=${relaxedAllowPerFaceShift ? '1' : '0'}`,

      `fullCover=${fullCover ? '1' : '0'}`,
      `fullCoverMin=${String(fullCoverMin)}`,
      `ignorePillars=${ignoreCoalPillarsInCoverage ? '1' : '0'}`,

      `segLt=${String(segLtM)}`,
      `segG=${String(segGmax)}`,
      `segDBmain=${String(segDeltaBMaxMain)}`,
      `segDBclean=${String(segDeltaBMaxCleanup)}`,
      `clean=${cleanupEnable ? '1' : '0'}`,
      `cleanAdd=${cleanupAllowAddShortFace ? '1' : '0'}`,
    ].join('|');
  };

  const assertPlanningPayload = (uiMode, payload) => {
    const m = String(uiMode ?? '');
    const mode = String(payload?.mode ?? '');
    const cacheKey = String(payload?.cacheKey ?? '');
    const inputMode = String(payload?.input?.mode ?? '');

    if (m === 'recovery') {
      if (mode !== 'smart-resource') throw new Error(`payload.mode 必须为 smart-resource（当前=${mode || '空'}）`);
      if (!cacheKey.includes('res|')) throw new Error(`payload.cacheKey 必须包含 res|（当前=${cacheKey || '空'}）`);
      if (cacheKey.includes('eff|')) throw new Error('payload.cacheKey 不得包含 eff|（疑似串模式）');
      if (inputMode === 'efficiency') throw new Error('payload.input.mode 不得为 efficiency（疑似串模式）');
      return;
    }

    if (m === 'efficiency') {
      if (mode !== 'smart-efficiency') throw new Error(`payload.mode 必须为 smart-efficiency（当前=${mode || '空'}）`);
      if (!cacheKey.includes('eff|')) throw new Error(`payload.cacheKey 必须包含 eff|（当前=${cacheKey || '空'}）`);
      return;
    }
  };

  const assertPlanningResponse = (uiMode, response) => {
    const m = String(uiMode ?? '');
    const mode = String(response?.mode ?? '');
    const cacheKey = String(response?.cacheKey ?? '');

    if (m === 'recovery') {
      if (mode !== 'smart-resource') throw new Error(`response.mode 不匹配（期望 smart-resource，实际=${mode || '空'}）`);
      const need = ['thicknessDataHash=', 'targetSeam=', 'gridRes=', 'interpVersion='];
      for (const k of need) {
        if (!cacheKey.includes(k)) throw new Error(`response.cacheKey 缺少 ${k}（当前=${cacheKey || '空'}）`);
      }
      if (!(Object.prototype.hasOwnProperty.call(response, 'tonnageTotal'))) {
        throw new Error('response 中必须存在 tonnageTotal（缺失说明串模式/回包格式异常）');
      }
      return;
    }

    if (m === 'efficiency') {
      if (mode !== 'smart-efficiency' && mode !== 'smart-efficiency-preview') {
        throw new Error(`response.mode 不匹配（期望 smart-efficiency，实际=${mode || '空'}）`);
      }
      if (Object.prototype.hasOwnProperty.call(response, 'tonnageTotal')) {
        throw new Error('efficiency 响应不得出现 tonnageTotal（出现说明串模式）');
      }
      return;
    }
  };

  const applyRecoveryCandidateBySignature = (sig, result) => {
    const r = result ?? planningRecoveryResult;
    if (!r?.candidates?.length) return;
    const picked = r.candidates.find((c) => String(c?.signature) === String(sig)) ?? r.candidates[0];
    if (!picked) return;

    try {
      const pickedN = Number(picked?.N ?? picked?.metrics?.faceCount);
      const nRange = r?.nRange;
      setPlanningParams((p) => ({
        ...p,
        faceCountSelected: Number.isFinite(pickedN) ? String(Math.min(20, Math.max(1, Math.round(pickedN)))) : p.faceCountSelected,
        faceCountSuggestedMin: (nRange?.nMin != null && Number.isFinite(Number(nRange.nMin))) ? String(Math.min(20, Math.max(1, Math.round(Number(nRange.nMin))))) : p.faceCountSuggestedMin,
        faceCountSuggestedMax: (nRange?.nMax != null && Number.isFinite(Number(nRange.nMax))) ? String(Math.min(20, Math.max(1, Math.round(Number(nRange.nMax))))) : p.faceCountSuggestedMax,
      }));
    } catch {
      // ignore
    }

    setPlanningRecoverySelectedSig(String(picked.signature ?? ''));
    setPlanningInnerOmegaOverrideWb(Number.isFinite(Number(picked.wb)) ? Number(picked.wb) : null);

    let loops = [];
    // 资源回收验收口径：必须裁剪到粉色 Ω 内再展示（超出部分不画）
    if (Array.isArray(picked?.render?.clippedFacesLoops) && picked.render.clippedFacesLoops.length) {
      loops = picked.render.clippedFacesLoops;
    } else if (Array.isArray(picked?.render?.plannedWorkfaceLoopsWorld) && picked.render.plannedWorkfaceLoopsWorld.length) {
      loops = picked.render.plannedWorkfaceLoopsWorld;
    } else if (Array.isArray(picked?.render?.rectLoops)) {
      loops = picked.render.rectLoops
        .map((loop, idx) => ({ faceIndex: idx + 1, loop }))
        .filter((x) => Array.isArray(x?.loop) && x.loop.length >= 3);
    } else if (Array.isArray(picked?.render?.facesLoops)) {
      loops = picked.render.facesLoops;
    }
    setPlannedWorkfaceLoopsWorld(cloneJson(loops));
    // 绘制：用 union 外轮廓覆盖 stroke，可消除相邻工作面共享边导致的重线
    const unionLoops = Array.isArray(picked?.render?.plannedUnionLoopsWorld) ? picked.render.plannedUnionLoopsWorld : [];
    setPlannedWorkfaceUnionLoopsWorld(cloneJson(unionLoops));
    setShowWorkfaceOutline(true);
    setShowPlanningBoundaryOverlay(true);
  };

  const buildRecoveryDebugCopyPayload = (result, selectedSig) => {
    const r = result ?? planningRecoveryResult;
    const req = recoveryLastRequestRef.current;

    // 屏幕坐标（viewBox）级诊断：很多“短线”并非世界坐标短边，而是缩放后 < 1px 的边/重复点/闭合点导致。
    // 这里统一在前端做一次统计，定位短线来自哪一层（boundary / overlay / union / fill）。
    const computeLoopStatsScreen = (loops0, { shortEdgePx = 1.0 } = {}) => {
      const loops = Array.isArray(loops0) ? loops0 : (loops0 ? [loops0] : []);
      let loopCount = 0;
      let pointCount = 0;
      let segCount = 0;
      let shortSegCount = 0;
      let nanPointCount = 0;
      let minSegLen = Infinity;
      let minSegLenLoop = -1;

      const normLoop = (loopLike) => {
        const loop = Array.isArray(loopLike)
          ? loopLike
          : (Array.isArray(loopLike?.loop) ? loopLike.loop : []);
        const pts = (loop ?? [])
          .map((p) => ({ x: Number(p?.nx ?? p?.x), y: Number(p?.ny ?? p?.y) }))
          .filter((p) => {
            const ok = Number.isFinite(p.x) && Number.isFinite(p.y);
            if (!ok) nanPointCount++;
            return ok;
          });
        if (pts.length >= 2) {
          const a = pts[0];
          const b = pts[pts.length - 1];
          if (Math.abs(a.x - b.x) <= 1e-12 && Math.abs(a.y - b.y) <= 1e-12) pts.pop();
        }
        return pts;
      };

      for (let li = 0; li < loops.length; li++) {
        const pts = normLoop(loops[li]);
        if (pts.length < 2) continue;
        loopCount++;
        pointCount += pts.length;

        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (!Number.isFinite(d)) continue;
          segCount++;
          if (d < shortEdgePx) shortSegCount++;
          if (d < minSegLen) {
            minSegLen = d;
            minSegLenLoop = li;
          }
        }
      }

      return {
        loopCount,
        pointCount,
        segCount,
        shortEdgePx,
        shortSegCount,
        minSegLen: Number.isFinite(minSegLen) ? minSegLen : null,
        minSegLenLoop: (minSegLenLoop >= 0 ? minSegLenLoop : null),
        nanPointCount,
      };
    };

    const candidates = Array.isArray(r?.candidates) ? r.candidates : [];
    const picked = selectedSig
      ? (candidates.find((c) => String(c?.signature ?? '') === String(selectedSig)) ?? candidates[0])
      : (candidates[0] ?? null);

    const pickCand = (c) => {
      const m = c?.metrics ?? {};
      const r = c?.render ?? {};
      return {
        signature: String(c?.signature ?? ''),
        N: c?.N,
        B: c?.B,
        BMin: (c?.BMin ?? m?.BMin ?? null),
        BMax: (c?.BMax ?? m?.BMax ?? null),
        BList: (Array.isArray(c?.BList) ? c.BList : (Array.isArray(m?.BList) ? m.BList : null)),
        wb: c?.wb,
        ws: c?.ws,
        thetaDeg: (c?.thetaDeg ?? m?.thetaDeg ?? null),
        deltaDegList: (Array.isArray(c?.deltaDegList) ? c.deltaDegList : (Array.isArray(m?.deltaDegList) ? m.deltaDegList : null)),
        nearAngleDegList: (Array.isArray(c?.nearAngleDegList) ? c.nearAngleDegList : (Array.isArray(m?.nearAngleDegList) ? m.nearAngleDegList : null)),
        farAngleDegList: (Array.isArray(c?.farAngleDegList) ? c.farAngleDegList : (Array.isArray(m?.farAngleDegList) ? m.farAngleDegList : null)),
        coverageRatio: (c?.coverageRatio ?? m?.coverageRatio ?? null),
        coverageRatioEff: (c?.coverageRatioEff ?? m?.coverageRatioEff ?? null),
        coveredArea: (c?.coveredArea ?? m?.faceAreaTotal ?? null),
        faceAreaTotal: (c?.faceAreaTotal ?? m?.faceAreaTotal ?? null),
        innerArea: (c?.innerArea ?? m?.omegaArea ?? null),
        omegaAreaEff: (c?.omegaAreaEff ?? m?.omegaAreaEff ?? null),
        pillarArea: (c?.pillarArea ?? m?.pillarArea ?? null),
        pillarGapCount: (c?.pillarGapCount ?? m?.pillarGapCount ?? null),
        pillarGapWidthSum: (c?.pillarGapWidthSum ?? m?.pillarGapWidthSum ?? null),
        residualAreaEff: (c?.residualAreaEff ?? m?.residualAreaEff ?? null),
        minInRatio: (c?.minInRatio ?? m?.minFaceInRatio ?? m?.minInRatio ?? null),
        rminOk: (c?.rminOk ?? m?.rminOk ?? null),
        overlapOk: (c?.overlapOk ?? m?.overlapOk ?? null),
        overlapPairs: (c?.overlapPairs ?? m?.overlapPairs ?? null),
        overlapAreaTotal: (c?.overlapAreaTotal ?? m?.overlapAreaTotal ?? null),
        maxOverlapArea: (c?.maxOverlapArea ?? m?.maxOverlapArea ?? null),
        qualified: (c?.qualified ?? m?.qualified ?? null),
        qualifiedFullCover: (c?.qualifiedFullCover ?? m?.qualifiedFullCover ?? null),
        reason: (c?.reason ?? m?.reason ?? null),
        lenCV: (c?.lenCV ?? m?.lenCV ?? null),
        minL: (c?.minL ?? m?.minL ?? null),
        maxL: (c?.maxL ?? m?.maxL ?? null),
        meanL: (c?.meanL ?? m?.meanL ?? null),
        abnormalFaceCount: (c?.abnormalFaceCount ?? m?.abnormalFaceCount ?? null),
        abnormalFaces: (Array.isArray(c?.abnormalFaces) ? c.abnormalFaces : (Array.isArray(m?.abnormalFaces) ? m.abnormalFaces : null)),
        sumAbsDeltaDeg: (c?.sumAbsDeltaDeg ?? m?.sumAbsDeltaDeg ?? null),
        smoothnessDeg: (c?.smoothnessDeg ?? m?.smoothnessDeg ?? null),
        fullCoverPatch: (m?.fullCoverPatch ?? null),

        // 诊断：排查“煤柱区边界短线/重线”
        renderStats: {
          fillFaceCount: (r?.fillFaceCount ?? null),
          unionLoopCount: (r?.unionLoopCount ?? null),
          unionOutlineStats: (r?.unionOutlineStats ?? null),
          fillLoopsStats: (r?.fillLoopsStats ?? null),
        },
      };
    };

    const topK = candidates.slice(0, 10).map(pickCand);
    const tableRows = Array.isArray(r?.table?.rows) ? r.table.rows.slice(0, 10) : [];

    // 仅统计“当前前端正在绘制的图层”。理论上它应对应 picked（选中候选）的 loops。
    // 若短线仍出现但 worker 世界坐标最短边并不短，这里通常能看到屏幕级 shortSegCount。
    const shortEdgePx = 1.0;
    const screenDiagnostics = {
      viewBox: { w: 800, h: 500 },
      shortEdgePx,
      boundaryStats: computeLoopStatsScreen(normalizedBoundaryLoop, { shortEdgePx }),
      boundaryOverlayStats: computeLoopStatsScreen(planningBoundaryOverlayLoop, { shortEdgePx }),
      omegaOverlayStats: computeLoopStatsScreen(planningOmegaOverlayLoops, { shortEdgePx }),
      plannedFillStats: computeLoopStatsScreen(
        (Array.isArray(normalizedPlannedWorkfaceLoops) ? normalizedPlannedWorkfaceLoops.map((x) => x?.loop).filter(Boolean) : []),
        { shortEdgePx },
      ),
      plannedUnionStats: computeLoopStatsScreen(normalizedPlannedWorkfaceUnionLoops, { shortEdgePx }),
      renderFlags: {
        showWorkfaceOutline: Boolean(showWorkfaceOutline),
        showPlanningBoundaryOverlay: Boolean(showPlanningBoundaryOverlay),
        planningOptMode: String(planningOptMode ?? ''),
      },
    };

    return {
      ts: Date.now(),
      ui: {
        mainViewMode,
        planningOptMode,
        recoveryBusy: Boolean(planningRecoveryBusy),
        recoveryLatestReqSeq: Number(recoveryReqSeqRef.current || 0),
        recoverySelectedSig: String(planningRecoverySelectedSig || ''),
      },
      request: {
        payload: req ? {
          reqSeq: req?.reqSeq,
          cacheKey: String(req?.cacheKey ?? ''),
          axis: String(req?.axis ?? ''),
          fast: Boolean(req?.fast),
          boundaryPillarMin: req?.boundaryPillarMin,
          boundaryPillarMax: req?.boundaryPillarMax,
          coalPillarMin: req?.coalPillarMin,
          coalPillarMax: req?.coalPillarMax,
          faceWidthMin: req?.faceWidthMin,
          faceWidthMax: req?.faceWidthMax,
          faceAdvanceMax: req?.faceAdvanceMax,
          topK: req?.topK,
          perFaceTrapezoid: req?.perFaceTrapezoid,
          perFaceAdjMaxStepDeg: req?.perFaceAdjMaxStepDeg,
          perFaceDeltaSetDeg: req?.perFaceDeltaSetDeg,
          perFaceInRatioMin: req?.perFaceInRatioMin,
          perFaceVarB: req?.perFaceVarB,
          perFaceBListMax: req?.perFaceBListMax,
          maxTimeMs: req?.maxTimeMs,
          fullCover: req?.fullCover,
          fullCoverMin: req?.fullCoverMin,
          ignoreCoalPillarsInCoverage: req?.ignoreCoalPillarsInCoverage,
          includeClippedLoops: req?.includeClippedLoops,
          fullCoverPatch: req?.fullCoverPatch,
          fullCoverPatchMaxTimeMs: req?.fullCoverPatchMaxTimeMs,
          segmentWidth: req?.segmentWidth ?? null,
          cleanupResidual: req?.cleanupResidual ?? null,
          thickness: {
            thicknessDataHash: req?.thickness?.thicknessDataHash,
            targetSeam: req?.thickness?.targetSeam,
            gridRes: req?.thickness?.gridRes,
            interpVersion: req?.thickness?.interpVersion,
          },
        } : null,
      },
      response: r ? {
        ui: {
          shownResponseReqSeq: Number(r?.reqSeq || 0),
          lastRequestReqSeq: Number(req?.reqSeq || 0),
          latestReqSeq: Number(recoveryReqSeqRef.current || 0),
          busy: Boolean(planningRecoveryBusy),
        },
        ok: Boolean(r?.ok),
        failedReason: String(r?.failedReason ?? ''),
        reqSeq: r?.reqSeq,
        cacheKey: String(r?.cacheKey ?? ''),
        fast: Boolean(r?.fast),
        candidatesCount: Array.isArray(r?.candidates) ? r.candidates.length : null,
        // 注意：这里不再用 selectedSig 覆盖 worker 字段，避免造成“明明 top1 合格但 selectedCandidateKey 显示不合格”的误判。
        workerSelectedCandidateKey: String(r?.selectedCandidateKey || ''),
        workerBestKey: String(r?.bestKey || ''),
        workerBestSignature: String(r?.bestSignature || ''),
        uiSelectedSig: String(selectedSig || ''),
        omegaArea: r?.omegaArea,
        tonnageTotal: r?.tonnageTotal,
        stats: r?.stats ?? null,
        debugPerFace: r?.debug?.perFace ?? null,
      } : null,
      selectedCandidate: picked ? pickCand(picked) : null,
      screenDiagnostics,
      top10: topK,
      tableTop10: tableRows,
    };
  };

  const openRecoveryDebugModal = () => {
    try {
      const sig = String(planningRecoverySelectedSig || planningRecoveryResult?.selectedCandidateKey || planningRecoveryResult?.bestKey || '');
      const blob = buildRecoveryDebugCopyPayload(planningRecoveryResult, sig);
      setPlanningRecoveryDebugText(JSON.stringify(blob, null, 2));
    } catch (e) {
      setPlanningRecoveryDebugText(JSON.stringify({ ts: Date.now(), error: String(e?.message ?? e) }, null, 2));
    }
    setPlanningRecoveryDebugOpen(true);
  };

  const copyRecoveryDebugText = async () => {
    const text = String(planningRecoveryDebugText ?? '');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fallback
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {
      // ignore
    }
  };

  const buildEfficiencyDebugCopyPayload = (result, selectedSig) => {
    const r = result ?? planningEfficiencyResult;
    const req = efficiencyLastRequestRef.current;

    const computeLoopStatsScreen = (loops0, { shortEdgePx = 1.0 } = {}) => {
      const loops = Array.isArray(loops0) ? loops0 : (loops0 ? [loops0] : []);
      let loopCount = 0;
      let pointCount = 0;
      let segCount = 0;
      let shortSegCount = 0;
      let nanPointCount = 0;
      let minSegLen = Infinity;
      let minSegLenLoop = -1;

      const normLoop = (loopLike) => {
        const loop = Array.isArray(loopLike)
          ? loopLike
          : (Array.isArray(loopLike?.loop) ? loopLike.loop : []);
        const pts = (loop ?? [])
          .map((p) => ({ x: Number(p?.nx ?? p?.x), y: Number(p?.ny ?? p?.y) }))
          .filter((p) => {
            const ok = Number.isFinite(p.x) && Number.isFinite(p.y);
            if (!ok) nanPointCount++;
            return ok;
          });
        if (pts.length >= 2) {
          const a = pts[0];
          const b = pts[pts.length - 1];
          if (Math.abs(a.x - b.x) <= 1e-12 && Math.abs(a.y - b.y) <= 1e-12) pts.pop();
        }
        return pts;
      };

      for (let li = 0; li < loops.length; li++) {
        const pts = normLoop(loops[li]);
        if (pts.length < 2) continue;
        loopCount++;
        pointCount += pts.length;

        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (!Number.isFinite(d)) continue;
          segCount++;
          if (d < shortEdgePx) shortSegCount++;
          if (d < minSegLen) {
            minSegLen = d;
            minSegLenLoop = li;
          }
        }
      }

      return {
        loopCount,
        pointCount,
        segCount,
        shortEdgePx,
        shortSegCount,
        minSegLen: Number.isFinite(minSegLen) ? minSegLen : null,
        minSegLenLoop: (minSegLenLoop >= 0 ? minSegLenLoop : null),
        nanPointCount,
      };
    };

    const candidates = Array.isArray(r?.candidates) ? r.candidates : [];
    const picked = selectedSig
      ? (candidates.find((c) => String(c?.signature ?? '') === String(selectedSig)) ?? candidates[0])
      : (candidates[0] ?? null);

    const pickCand = (c) => {
      const m = c?.metrics ?? {};
      return {
        signature: String(c?.signature ?? ''),
        N: c?.N,
        B: c?.B,
        wb: c?.wb,
        ws: c?.ws,
        coverageRatio: (c?.coverageRatio ?? m?.coverageRatio ?? null),
        coveredArea: (c?.coveredArea ?? m?.faceAreaTotal ?? null),
        innerArea: (c?.innerArea ?? m?.omegaArea ?? null),
        efficiencyScore: (c?.efficiencyScore ?? m?.efficiencyScore ?? null),
        qualified: (c?.qualified ?? m?.qualified ?? null),
        reason: (c?.reason ?? m?.reason ?? null),
        overlapOk: (c?.overlapOk ?? m?.overlapOk ?? null),
        rminOk: (c?.rminOk ?? m?.rminOk ?? null),
      };
    };

    const topK = candidates.slice(0, 10).map(pickCand);
    const tableRows = Array.isArray(r?.table?.rows) ? r.table.rows.slice(0, 10) : [];

    const shortEdgePx = 1.0;
    const screenDiagnostics = {
      viewBox: { w: 800, h: 500 },
      shortEdgePx,
      boundaryStats: computeLoopStatsScreen(normalizedBoundaryLoop, { shortEdgePx }),
      boundaryOverlayStats: computeLoopStatsScreen(planningBoundaryOverlayLoop, { shortEdgePx }),
      omegaOverlayStats: computeLoopStatsScreen(planningOmegaOverlayLoops, { shortEdgePx }),
      plannedFillStats: computeLoopStatsScreen(
        (Array.isArray(normalizedPlannedWorkfaceLoops) ? normalizedPlannedWorkfaceLoops.map((x) => x?.loop).filter(Boolean) : []),
        { shortEdgePx },
      ),
      plannedUnionStats: computeLoopStatsScreen(normalizedPlannedWorkfaceUnionLoops, { shortEdgePx }),
      renderFlags: {
        showWorkfaceOutline: Boolean(showWorkfaceOutline),
        showPlanningBoundaryOverlay: Boolean(showPlanningBoundaryOverlay),
        planningOptMode: String(planningOptMode ?? ''),
      },
    };

    return {
      ts: Date.now(),
      ui: {
        mainViewMode,
        planningOptMode,
        efficiencyBusy: Boolean(planningEfficiencyBusy),
        efficiencyLatestReqSeq: Number(efficiencyReqSeqRef.current || 0),
        efficiencySelectedSig: String(planningEfficiencySelectedSig || ''),
      },
      request: {
        payload: req ? {
          reqSeq: req?.reqSeq,
          cacheKey: String(req?.cacheKey ?? ''),
          axis: String(req?.axis ?? ''),
          fast: Boolean(req?.fast),
          boundaryPillarMin: req?.boundaryPillarMin,
          boundaryPillarMax: req?.boundaryPillarMax,
          coalPillarMin: req?.coalPillarMin,
          coalPillarMax: req?.coalPillarMax,
          faceWidthMin: req?.faceWidthMin,
          faceWidthMax: req?.faceWidthMax,
          faceAdvanceMax: req?.faceAdvanceMax,
          topK: req?.topK,
          maxTimeMs: req?.maxTimeMs,
        } : null,
      },
      response: r ? {
        ok: Boolean(r?.ok),
        failedReason: String(r?.failedReason ?? ''),
        message: String(r?.message ?? ''),
        reqSeq: r?.reqSeq,
        cacheKey: String(r?.cacheKey ?? ''),
        fast: Boolean(r?.fast),
        candidatesCount: Array.isArray(r?.candidates) ? r.candidates.length : null,
        workerSelectedCandidateKey: String(r?.selectedCandidateKey || ''),
        workerBestKey: String(r?.bestKey || ''),
        workerBestSignature: String(r?.bestSignature || ''),
        uiSelectedSig: String(selectedSig || ''),
        stats: r?.stats ?? null,
      } : null,
      selectedCandidate: picked ? pickCand(picked) : null,
      screenDiagnostics,
      top10: topK,
      tableTop10: tableRows,
    };
  };

  const openEfficiencyDebugModal = () => {
    try {
      const sig = String(planningEfficiencySelectedSig || planningEfficiencyResult?.selectedCandidateKey || planningEfficiencyResult?.bestKey || planningEfficiencyResult?.bestSignature || '');
      const blob = buildEfficiencyDebugCopyPayload(planningEfficiencyResult, sig);
      setPlanningEfficiencyDebugText(JSON.stringify(blob, null, 2));
    } catch (e) {
      setPlanningEfficiencyDebugText(JSON.stringify({ ts: Date.now(), error: String(e?.message ?? e) }, null, 2));
    }
    setPlanningEfficiencyDebugOpen(true);
  };

  const copyEfficiencyDebugText = async () => {
    const text = String(planningEfficiencyDebugText ?? '');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fallback
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {
      // ignore
    }
  };

  const applyEfficiencyCandidateBySignature = (sig, result) => {
    const r = result ?? planningEfficiencyResult;
    if (!r?.candidates?.length) return;
    const picked = r.candidates.find((c) => String(c?.signature) === String(sig)) ?? r.candidates[0];
    if (!picked) return;

    // 方案C：回填“采区参数编辑器”的工作面个数滑块（仅用于显示/切换，不参与 cacheKey）
    try {
      const pickedN = Number(picked?.N ?? picked?.metrics?.faceCount);
      const nRange = r?.nRange;
      setPlanningParams((p) => ({
        ...p,
        faceCountSelected: Number.isFinite(pickedN) ? String(Math.min(20, Math.max(1, Math.round(pickedN)))) : p.faceCountSelected,
        faceCountSuggestedMin: (nRange?.nMin != null && Number.isFinite(Number(nRange.nMin))) ? String(Math.min(20, Math.max(1, Math.round(Number(nRange.nMin))))) : p.faceCountSuggestedMin,
        faceCountSuggestedMax: (nRange?.nMax != null && Number.isFinite(Number(nRange.nMax))) ? String(Math.min(20, Math.max(1, Math.round(Number(nRange.nMax))))) : p.faceCountSuggestedMax,
      }));
    } catch {
      // ignore
    }

    setPlanningEfficiencySelectedSig(String(picked.signature ?? ''));
    setPlanningInnerOmegaOverrideWb(Number.isFinite(Number(picked.wb)) ? Number(picked.wb) : null);

    // 工程效率最优：蓝色图层必须使用“设计矩形”（规则矩形），裁切多边形仅解释不参与评分。
    let loops = [];
    if (Array.isArray(picked?.render?.rectLoops)) {
      loops = picked.render.rectLoops
        .map((loop, idx) => ({ faceIndex: idx + 1, loop }))
        .filter((x) => Array.isArray(x?.loop) && x.loop.length >= 3);
    } else if (Array.isArray(picked?.render?.facesLoops)) {
      loops = picked.render.facesLoops;
    } else if (Array.isArray(picked?.render?.plannedWorkfaceLoopsWorld)) {
      loops = picked.render.plannedWorkfaceLoopsWorld;
    }
    setPlannedWorkfaceLoopsWorld(cloneJson(loops));
    setPlannedWorkfaceUnionLoopsWorld([]);
    setShowWorkfaceOutline(true);
    setShowPlanningBoundaryOverlay(true);

    // 开发期自检输出：看不到时先确认“算出来”还是“没画出来”。
    try {
      const omegaArea = Number(picked?.metrics?.omegaArea ?? picked?.innerArea);
      const faceAreaTotal = Number(picked?.metrics?.faceAreaTotal ?? picked?.coveredArea);
      console.log('[smart-efficiency] selected', {
        signature: String(picked?.signature ?? ''),
        omegaArea,
        faceAreaTotal,
        facesLoops: Array.isArray(loops) ? loops.length : 0,
        wb: picked?.wb,
        ws: picked?.ws,
        N: picked?.N,
        B: picked?.B,
      });
    } catch {
      // ignore
    }
  };

  const applyEfficiencyPreviewCandidate = (candidate) => {
    const picked = candidate;
    if (!picked) return;

    // 预览不改变“真实候选选中态”（4A），只更新绘图层
    setPlanningInnerOmegaOverrideWb(Number.isFinite(Number(picked.wb)) ? Number(picked.wb) : null);

    let loops = [];
    if (Array.isArray(picked?.render?.rectLoops)) {
      loops = picked.render.rectLoops
        .map((loop, idx) => ({ faceIndex: idx + 1, loop }))
        .filter((x) => Array.isArray(x?.loop) && x.loop.length >= 3);
    } else if (Array.isArray(picked?.render?.facesLoops)) {
      loops = picked.render.facesLoops;
    } else if (Array.isArray(picked?.render?.plannedWorkfaceLoopsWorld)) {
      loops = picked.render.plannedWorkfaceLoopsWorld;
    }

    if (Array.isArray(loops) && loops.length > 0) {
      setPlannedWorkfaceLoopsWorld(cloneJson(loops));
      setPlannedWorkfaceUnionLoopsWorld([]);
      setShowWorkfaceOutline(true);
      setShowPlanningBoundaryOverlay(true);
    }
  };

  const requestComputeEfficiency = ({ force = false, fast = false, refine = false, background = false, ignoreCache = false } = {}) => {
    // 说明：force 用于“点击按钮立即触发”，避免 setState 尚未生效时被 early-return 导致需要点多次。
    if (!force) {
      if (mainViewMode !== 'planning') return;
      if (planningOptMode !== 'efficiency') return;
    }
    if (!boundaryLoopWorld?.length || boundaryLoopWorld.length < 3) return;

    // 用户要求：关闭 fast，仅输出最终精算结果。
    // 说明：保留函数签名以兼容旧调用点，但在内部强制 fast/refine=false。
    const fastFinal = false;
    const refineFinal = false;

    const cacheKey = buildEfficiencyCacheKey();
    planningEfficiencyCacheKeyRef.current = String(cacheKey);
    setPlanningEfficiencyCacheKey(cacheKey);

    // 关闭 fast：不再使用 fast+refine 流程
    if (fastFinal && refineFinal) {
      efficiencyPendingRefineKeyRef.current = String(cacheKey);
      const axisNow = (String(planningParams?.roadwayOrientation ?? 'x') === 'y') ? 'y' : 'x';
      efficiencyPendingRefineAxisRef.current = axisNow;
    }

    if (DEBUG_PANEL) {
      const axis = (String(planningParams?.roadwayOrientation ?? 'x') === 'y') ? 'y' : 'x';
      const wbR = getRangeWithFallback(planningParams?.boundaryPillarMin, planningParams?.boundaryPillarMax, planningParams?.boundaryPillarTarget);
      const wsR = getRangeWithFallback(planningParams?.coalPillarMin, planningParams?.coalPillarMax, planningParams?.coalPillarTarget);
      const fw = getFaceWidthRange();
      const bHash = hashBoundaryLoopWorld(boundaryLoopWorld);
      const bbox = computeBoundaryBboxWorld(boundaryLoopWorld);
      setPlanningDebugSnapshot((prev) => ({
        ts: Date.now(),
        mode: 'smart-efficiency',
        input: {
          mode: planningOptMode,
          axis,
          Bmin: fw.min,
          Bmax: fw.max,
          BrawMin: (fw.rawMin == null ? '' : String(fw.rawMin)),
          BrawMax: (fw.rawMax == null ? '' : String(fw.rawMax)),
          Bnormalized: [fw.min, fw.max],
          BnormalizeWarnings: fw.warnings,
          Bdef: [fw.defMin, fw.defMax],
          Lmax: Number(planningParams?.faceAdvanceMax) || null,
          wbMin: wbR.min,
          wbMax: wbR.max,
          wsMin: wsR.min,
          wsMax: wsR.max,
          boundaryPointCount: boundaryLoopWorld.length,
          boundaryBbox: bbox,
        },
        request: {
          mode: 'smart-efficiency',
          requestId: null,
          cacheKey,
          axis,
          wbMin: wbR.min,
          wbMax: wbR.max,
          wsMin: wsR.min,
          wsMax: wsR.max,
          Bmin: fw.min,
          Bmax: fw.max,
          Lmax: Number(planningParams?.faceAdvanceMax) || null,
          Bnormalized: [fw.min, fw.max],
          BnormalizeWarnings: fw.warnings,
          boundaryHash: bHash,
          boundaryPointCount: boundaryLoopWorld.length,
          topK: 10,
        },
        response: prev?.response ?? null,
        lastError: prev?.lastError ?? '',
      }));
    }

    // 用户显式点击“启动智能采区规划”时，即使 cacheKey 不变也应重新计算，避免第二次点击直接命中缓存导致
    // UI 不出现“计算中…”（看起来像没响应）。
    const explicitForeground = Boolean(force && !background);
    const ignoreCacheFinal = Boolean(ignoreCache || explicitForeground);

    const cached = ignoreCacheFinal ? null : efficiencyCacheRef.current.get(cacheKey);
    // 重要：历史版本曾出现 request.axis=y 但返回 axis=x 的错误缓存；这里做一致性校验避免“错缓存复活”。
    const axisNow = (String(planningParams?.roadwayOrientation ?? 'x') === 'y') ? 'y' : 'x';
    const cachedAxis = String(cached?.result?.axis ?? '');
    const cachedFast = Boolean(cached?.result?.fast);
    const cachedPartial = Boolean(cached?.result?.stats?.partial);
    const cachedSig = String(
      cached?.selectedSig
      || cached?.result?.bestKey
      || cached?.result?.selectedCandidateKey
      || cached?.result?.bestSignature
      || (cached?.result?.candidates?.[0]?.signature ?? '')
      || ''
    );
    const cachedLooksConsistent = cached?.result?.ok
      && !cachedFast
      && !cachedPartial
      && cachedAxis === axisNow
      && cachedSig.startsWith(`${axisNow}|`);

    if (!ignoreCacheFinal && cachedLooksConsistent) {
      workerLog('[worker][efficiency] cache-hit', { cacheKey, axis: axisNow, sig: cachedSig });
      setPlanningEfficiencyResult(cached.result);
      try {
        efficiencyLastResponseRef.current = cached.result;
      } catch {
        // ignore
      }
      const rememberedSig = String(efficiencySelectedSigByKeyRef.current.get(cacheKey) || '');
      const rememberedOk = Boolean(
        rememberedSig
        && Array.isArray(cached?.result?.candidates)
        && cached.result.candidates.some((c) => String(c?.signature ?? '') === rememberedSig)
      );

      const sig = (rememberedOk ? rememberedSig : (
        cached.selectedSig
        || cached.result.bestKey
        || cached.result.selectedCandidateKey
        || cached.result.bestSignature
        || (cached.result.candidates?.[0]?.signature ?? '')
      ));

      // 同步缓存里的 selectedSig，保证下次命中缓存也稳定。
      if (sig) {
        efficiencySelectedSigByKeyRef.current.set(cacheKey, String(sig));
        if (cached?.selectedSig !== String(sig)) {
          efficiencyCacheRef.current.set(cacheKey, { ...cached, selectedSig: String(sig) });
        }
      }
      applyEfficiencyCandidateBySignature(sig, cached.result);

      // compute/cached 成功：清理预览（回到“真实候选集”）
      setPlanningEfficiencyPreview(null);
      setPlanningEfficiencyPreviewBusy(false);

      if (DEBUG_PANEL) {
        setPlanningDebugSnapshot((prev) => ({
          ...(prev ?? {}),
          ts: Date.now(),
          mode: 'smart-efficiency',
          response: buildEfficiencyDebugResponseSummary(cached.result, sig),
          lastError: cached?.result?.ok ? '' : String(cached?.result?.message ?? ''),
        }));
      }
      return;
    }

    // 不一致的缓存直接丢弃，避免错误命中
    if (cached && !cachedLooksConsistent) {
      try {
        efficiencyCacheRef.current.delete(cacheKey);
      } catch {
        // ignore
      }
    }

    if (!efficiencyWorkerRef.current) return;
    const axis = axisNow;
    const wbR = getRangeWithFallback(planningParams?.boundaryPillarMin, planningParams?.boundaryPillarMax, planningParams?.boundaryPillarTarget);
    const wsR = getRangeWithFallback(planningParams?.coalPillarMin, planningParams?.coalPillarMax, planningParams?.coalPillarTarget);
    const fw = getFaceWidthRange();

    // 工程效率最优（更新：2026-01-20）：wb 固定取最小值（与 worker/cacheKey 保持一致）
    const wbFixed = (Number.isFinite(Number(wbR?.min)) && Number.isFinite(Number(wbR?.max)))
      ? Math.min(Number(wbR.min), Number(wbR.max))
      : (Number.isFinite(Number(wbR?.min)) ? Number(wbR.min) : 0);

    const reqSeq = (efficiencyReqSeqRef.current += 1);
    if (explicitForeground) {
      planningEfficiencyMinBusyUntilRef.current = Date.now() + 260;
      planningEfficiencyMinBusyReqSeqRef.current = reqSeq;
    }
    // 即使是 background 重算，也需要展示“计算中…（进度）”
    setPlanningEfficiencyBusy(true);
    setPlanningEfficiencyProgress({ percent: 0, attemptedCombos: 0, feasibleCombos: 0, phase: '开始' });
    planningEfficiencyProgressLastTsRef.current = 0;

    // 计算触发时尽量保证“计算中…”提示条可见：
    // - 前台触发：总是置为“计算中”，避免 UI/调试面板继续展示上一轮响应，同时清空旧图。
    // - 后台触发：若 cacheKey 发生变化（或没有旧结果），也需要置为“计算中”，否则用户会误以为没动。
    const shouldClearLayers = !background;
    if (shouldClearLayers) {
      try {
        setPlanningEfficiencySelectedSig('');
        setPlannedWorkfaceLoopsWorld([]);
        setPlannedWorkfaceUnionLoopsWorld([]);
      } catch {
        // ignore
      }
    }
    try {
      setPlanningEfficiencyResult((prev) => {
        const prevKey = String(prev?.cacheKey ?? '');
        const sameKey = prevKey && prevKey === String(cacheKey);
        // 后台同 key 且已有 ok 结果：不覆盖内容（progress handler 会刷新 message）
        if (background && prev?.ok && sameKey) return prev;
        // 后台同 key 但无 ok 结果：允许覆盖为“计算中”以显示进度
        // 后台 key 变化：也要覆盖为“计算中”
        return {
          ok: false,
          mode: 'smart-efficiency',
          message: '计算中…（0%，已尝试0，可行0，开始）',
          failedReason: '',
          reqSeq,
          cacheKey,
          axis,
          fast: false,
          candidates: [],
          omegaRender: prev?.omegaRender ?? null,
          omegaArea: prev?.omegaArea ?? null,
        };
      });
    } catch {
      // ignore
    }

    const gridRes = 20;
    const interpVersion = 'idw-v1';

    const msg = {
      type: 'compute',
      payload: {
        reqSeq,
        mode: 'smart-efficiency',
        cacheKey,
        input: { mode: 'efficiency' },
        boundaryLoopWorld: cloneJson(boundaryLoopWorld),
        axis,
        fast: Boolean(fastFinal),
        // 默认启用“均衡档近似”：确定性粗到细 + 种子精修（更快）
        searchProfile: 'balanced',
        // smart-efficiency：wb 固定取最小值（不做搜索/枚举）
        boundaryPillarMin: wbFixed,
        boundaryPillarMax: wbFixed,
        coalPillarMin: wsR.min,
        coalPillarMax: wsR.max,
        coalPillarTarget: parseNonNegOrNull(planningParams?.coalPillarTarget),
        faceWidthMin: fw.min,
        faceWidthMax: fw.max,
        faceAdvanceMax: Number(planningParams?.faceAdvanceMax) || null,
        topK: 10,
      },
    };

    try {
      efficiencyLastRequestRef.current = cloneJson(msg.payload);
    } catch {
      efficiencyLastRequestRef.current = msg.payload;
    }

    try {
      assertPlanningPayload('efficiency', msg.payload);
      console.log('start', { uiMode: 'efficiency', requestId: reqSeq, mode: msg.payload.mode, cacheKey: msg.payload.cacheKey });
      workerLog('[worker][efficiency] postMessage', {
        reqSeq,
        cacheKey: msg.payload.cacheKey,
        axis: msg.payload.axis,
        fast: Boolean(msg.payload.fast),
        topK: msg.payload.topK,
        maxTimeMs: msg.payload.maxTimeMs,
      });
    } catch (e) {
      const errMsg = String(e?.message ?? e);
      console.error('mismatch', { uiMode: 'efficiency', requestId: reqSeq, error: errMsg });
      setPlanningEfficiencyBusy(false);
      setPlanningEfficiencyResult({ ok: false, mode: 'smart-efficiency', message: errMsg, failedReason: errMsg, candidates: [] });
      return;
    }

    if (DEBUG_PANEL) {
      setPlanningDebugSnapshot((prev) => ({
        ...(prev ?? {}),
        ts: Date.now(),
        mode: 'smart-efficiency',
        request: {
          ...(prev?.request ?? {}),
          requestId: reqSeq,
          cacheKey,
          axis,
          wbMin: wbR.min,
          wbMax: wbR.max,
          wsMin: wsR.min,
          wsMax: wsR.max,
          wsTarget: parseNonNegOrNull(planningParams?.coalPillarTarget),
          Bmin: fw.min,
          Bmax: fw.max,
          Lmax: Number(planningParams?.faceAdvanceMax) || null,
          BrawMin: (fw.rawMin == null ? '' : String(fw.rawMin)),
          BrawMax: (fw.rawMax == null ? '' : String(fw.rawMax)),
          Bnormalized: [fw.min, fw.max],
          BnormalizeWarnings: fw.warnings,
          boundaryHash: hashBoundaryLoopWorld(boundaryLoopWorld),
          boundaryPointCount: boundaryLoopWorld.length,
          searchProfile: 'balanced',
          topK: 10,
        },
      }));
    }

    // 标记“正在计算”的 key（用于二次点击判断是否需要重算）
    efficiencyInFlightKeyRef.current = String(cacheKey);
    efficiencyWorkerRef.current.postMessage(msg);
  };

  const requestComputeRecovery = ({ force = false, fast = false, refine = false, background = false, ignoreCache = false } = {}) => {
    if (!force) {
      if (mainViewMode !== 'planning') return;
      if (planningOptMode !== 'recovery') return;
    }
    if (!boundaryLoopWorld?.length || boundaryLoopWorld.length < 3) return;

    const cacheKey = buildRecoveryCacheKey();
    planningRecoveryCacheKeyRef.current = String(cacheKey);
    setPlanningRecoveryCacheKey(cacheKey);

    // 每次“触发计算”都默认回到候选 Top1 展示：清掉该 cacheKey 下的历史选中态
    // 否则会一直显示上次手动选的旧方案（例如未补残煤的版本）。
    try {
      recoverySelectedSigByKeyRef.current.delete(cacheKey);
      const cached0 = recoveryCacheRef.current.get(cacheKey);
      if (cached0?.selectedSig) {
        recoveryCacheRef.current.set(cacheKey, { ...cached0, selectedSig: '' });
      }
    } catch {
      // ignore
    }

    const axisNow = (String(planningParams?.roadwayOrientation ?? 'x') === 'y') ? 'y' : 'x';

    if (fast && refine) {
      recoveryPendingRefineKeyRef.current = String(cacheKey);
      recoveryPendingRefineAxisRef.current = axisNow;
    }

    const explicitForeground = Boolean(force && !background);
    const ignoreCacheFinal = Boolean(ignoreCache || explicitForeground);
    const cached = ignoreCacheFinal ? null : recoveryCacheRef.current.get(cacheKey);
    workerLog('[worker][recovery] cache-check', { cacheKey, axisNow, force: Boolean(force), fast: Boolean(fast), refine: Boolean(refine), background: Boolean(background) });
    const cachedAxis = String(cached?.result?.axis ?? '');
    const cachedFast = Boolean(cached?.result?.fast);
    const cachedSig = String(
      cached?.selectedSig
      || cached?.result?.bestKey
      || cached?.result?.selectedCandidateKey
      || cached?.result?.bestSignature
      || (cached?.result?.candidates?.[0]?.signature ?? '')
      || ''
    );
    const cachedLooksConsistent = cached?.result?.ok
      && !cachedFast
      && cachedAxis === axisNow
      && cachedSig.startsWith(`${axisNow}|`);

    if (!ignoreCacheFinal && cachedLooksConsistent) {
      workerLog('[worker][recovery] cache-hit', { cacheKey, axis: axisNow, sig: cachedSig });
      setPlanningRecoveryResult(cached.result);
      try {
        recoveryLastResponseRef.current = cached.result;
      } catch {
        // ignore
      }
      const rememberedSig = String(recoverySelectedSigByKeyRef.current.get(cacheKey) || '');
      const rememberedOk = Boolean(
        rememberedSig
        && Array.isArray(cached?.result?.candidates)
        && cached.result.candidates.some((c) => String(c?.signature ?? '') === rememberedSig)
      );

      const sig = (rememberedOk ? rememberedSig : (
        cached.selectedSig
        || cached.result.bestKey
        || cached.result.selectedCandidateKey
        || cached.result.bestSignature
        || (cached.result.candidates?.[0]?.signature ?? '')
      ));

      if (sig) {
        recoverySelectedSigByKeyRef.current.set(cacheKey, String(sig));
        if (cached?.selectedSig !== String(sig)) {
          recoveryCacheRef.current.set(cacheKey, { ...cached, selectedSig: String(sig) });
        }
      }
      applyRecoveryCandidateBySignature(sig, cached.result);
      return;
    }

    if (cached && !cachedLooksConsistent) {
      workerWarn('[worker][recovery] cache-evict(inconsistent)', {
        cacheKey,
        axisNow,
        cachedAxis,
        cachedFast,
        cachedSig,
      });
      try {
        recoveryCacheRef.current.delete(cacheKey);
      } catch {
        // ignore
      }
    }

    if (!resourceWorkerRef.current) {
      const curSeq = Number(recoveryReqSeqRef.current) || 0;
      const errMsg = '资源回收 worker 未就绪（resourceWorkerRef=null）';
      console.error('mismatch', { uiMode: 'recovery', requestId: curSeq, error: errMsg });
      setPlanningRecoveryBusy(false);
      setPlanningRecoveryResult({ ok: false, mode: 'smart-resource', message: errMsg, failedReason: errMsg, candidates: [] });
      return;
    }
    const axis = axisNow;
    const wbR = getRangeWithFallback(planningParams?.boundaryPillarMin, planningParams?.boundaryPillarMax, planningParams?.boundaryPillarTarget);
    const wsR = getRangeWithFallback(planningParams?.coalPillarMin, planningParams?.coalPillarMax, planningParams?.coalPillarTarget);
    const fw = getFaceWidthRange();

    // 资源回收最优：边界煤柱/区段煤柱均按“最小值”口径固定参与计算
    const wbRep = Number.isFinite(Number(wbR?.min)) ? Number(wbR.min) : 0;
    const wsMin = Number.isFinite(Number(wsR?.min)) ? Number(wsR.min) : 0;

    const seamThickness = Number(planningParams?.seamThickness);
    const hasConstThk = Number.isFinite(seamThickness) && seamThickness > 0;
    const coalDensity = Number(planningParams?.coalDensity);
    const rho = (Number.isFinite(coalDensity) && coalDensity > 0) ? coalDensity : 1;

    const thkSamples = boreholeParamSamples?.CoalThk;
    const thicknessDataHash = hashCoalThicknessSamples(thkSamples);
    const targetSeam = 'CoalThk';
    const gridRes = 20;
    const interpVersion = 'idw-v1';
    const fieldPack = (coalThicknessField?.field && coalThicknessField?.gridW && coalThicknessField?.gridH)
      ? {
        field: coalThicknessField.field,
        gridW: coalThicknessField.gridW,
        gridH: coalThicknessField.gridH,
        width: coalThicknessField.width,
        height: coalThicknessField.height,
        bounds: coalThicknessField.bounds,
        pad: coalThicknessField?.bounds?.pad,
      }
      : null;

    const reqSeq = (recoveryReqSeqRef.current += 1);
    if (explicitForeground) {
      planningRecoveryMinBusyUntilRef.current = Date.now() + 260;
      planningRecoveryMinBusyReqSeqRef.current = reqSeq;
    }
    setPlanningRecoveryBusy(true);
    setPlanningRecoveryProgress({ percent: 0, attemptedCombos: 0, feasibleCombos: 0, phase: '开始' });
    planningRecoveryProgressLastTsRef.current = 0;

    // 计算耗时较长时，旧图会造成误判；这里在真正发起 compute 时先清空绘图层。
    try {
      setPlanningRecoverySelectedSig('');
      setPlannedWorkfaceLoopsWorld([]);
      setPlannedWorkfaceUnionLoopsWorld([]);
    } catch {
      // ignore
    }

    // 与工程效率一致：尽量保证“计算中…”提示条可见。
    try {
      setPlanningRecoveryResult((prev) => {
        const prevKey = String(prev?.cacheKey ?? '');
        const sameKey = prevKey && prevKey === String(cacheKey);
        if (background && prev?.ok && sameKey) return prev;
        return {
          ok: false,
          mode: 'smart-resource',
          message: '计算中…（0%，已尝试0，可行0，开始）',
          failedReason: '',
          reqSeq,
          cacheKey,
          axis,
          fast: Boolean(fast),
          candidates: [],
          tonnageTotal: 0,
          omegaRender: prev?.omegaRender ?? null,
          omegaArea: prev?.omegaArea ?? null,
        };
      });
    } catch {
      // ignore
    }

    const msg = {
      type: 'compute',
      payload: {
        reqSeq,
        cacheKey,
        mode: 'smart-resource',
        input: { mode: 'recovery' },
        boundaryLoopWorld: cloneJson(boundaryLoopWorld),
        axis,
        fast: Boolean(fast),
        // per-face：固定近边（煤柱侧）+ 远边调斜（deltaDeg_i）
        perFaceTrapezoid: true,
        perFaceDeltaSetDeg: [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10],
        perFaceAdjMaxStepDeg: 4,
        perFaceInRatioMin: 0.7,
        perFaceInRatioTry: 0.5,
        perFaceMaxSeq: 160,
        perFaceSeedM: 12,
        perFaceNSet: [3, 4, 5, 6, 7],
        perFaceExtraBudgetMs: 1500,
        // per-face：每面工作面宽度 B_i 独立枚举（参与面积最优排序）
        perFaceVarB: true,
        perFaceBListMax: 10,
        preferPerFaceBest: false,
        relaxedAllowPerFaceShift: true,
        // 无解兜底：若严格/主阈值找不到条带组合，自动降低“每面有效占比”阈值到 floor。
        autoRelaxInRatio: true,
        autoRelaxInRatioFloor: 0.5,
        // 性能：给足 per-face（含长度增长/边界自适应）枚举时间，减少 timeBudgetHit → partial/fast=true
        maxTimeMs: 18000,
        // 新口径：优先全覆盖粉色区域（达不到则降级并给 warning）
        fullCover: true,
        fullCoverMin: 0.995,
        // 工程验收口径：中间煤柱区不计入覆盖/残煤评价（也不允许被补片覆盖）
        ignoreCoalPillarsInCoverage: true,
        // 为了能在画布上看到分段变宽/残煤清扫后的真实形状，需要回传裁剪后的 loops。
        // 注意：这会增加回包体积；若后续要优化，可改成仅回传 top1 的 loops。
        includeClippedLoops: true,

        // v1.1：工程化全覆盖（分段变宽 + 残煤清扫）
        segmentWidth: {
          enabled: true,
          LtM: 50,
          gmax: 0.4, // m/m
          // 主方案微调（更像现场）
          deltaBMaxMainM: 5,
          // 残煤清扫（更激进但受限规模）
          deltaBMaxCleanupM: 10,
          deltaBStepM: 1,
          segmentCountMaxMain: 3,
          segmentCountMaxCleanup: 3,
          breakRatios2: [0.4, 0.5, 0.6],
          breakRatios3: [[0.35, 0.65], [0.4, 0.7], [0.45, 0.75]],
        },
        cleanupResidual: {
          enabled: true,
          maxFacesToAdjust: 5,
          maxReplacements: 2,
          allowAddShortFace: true,
          maxNewFaces: 1,
          maxTimeMs: 1500,
        },

        boundaryPillarMin: wbRep,
        boundaryPillarMax: wbRep,
        coalPillarMin: wsMin,
        coalPillarMax: wsMin,
        faceWidthMin: fw.min,
        faceWidthMax: fw.max,
        faceAdvanceMax: Number(planningParams?.faceAdvanceMax) || null,
        topK: 10,
        thickness: {
          fieldPack,
          constantM: (hasConstThk ? seamThickness : null),
          rho,
          gridRes,
          interpVersion,
          thicknessDataHash,
          targetSeam,
        },
      },
    };

    try {
      recoveryLastRequestRef.current = cloneJson(msg.payload);
    } catch {
      recoveryLastRequestRef.current = msg.payload;
    }

    try {
      assertPlanningPayload('recovery', msg.payload);
      console.log('start', { uiMode: 'recovery', requestId: reqSeq, mode: msg.payload.mode, cacheKey: msg.payload.cacheKey });
      workerLog('[worker][recovery] postMessage', {
        reqSeq,
        cacheKey: msg.payload.cacheKey,
        axis: msg.payload.axis,
        fast: Boolean(msg.payload.fast),
        topK: msg.payload.topK,
        maxTimeMs: msg.payload.maxTimeMs,
        includeClippedLoops: Boolean(msg.payload.includeClippedLoops),
      });
    } catch (e) {
      const errMsg = String(e?.message ?? e);
      console.error('mismatch', { uiMode: 'recovery', requestId: reqSeq, error: errMsg });
      setPlanningRecoveryBusy(false);
      setPlanningRecoveryResult({ ok: false, mode: 'smart-resource', message: errMsg, failedReason: errMsg, candidates: [] });
      return;
    }

    if (DEBUG_PANEL) {
      setPlanningDebugSnapshot((prev) => ({
        ts: Date.now(),
        mode: 'smart-resource',
        input: {
          mode: 'recovery',
          axis,
          wbMin: wbR.min,
          wbMax: wbR.max,
          wsMin: wsR.min,
          wsMax: wsR.max,
          Bmin: fw.min,
          Bmax: fw.max,
          Lmax: Number(planningParams?.faceAdvanceMax) || null,
          thicknessDataHash,
          targetSeam,
          gridRes,
          interpVersion,
        },
        request: {
          mode: 'smart-resource',
          requestId: reqSeq,
          cacheKey,
        },
        response: prev?.response ?? null,
        lastError: prev?.lastError ?? '',
      }));
    }

    recoveryInFlightKeyRef.current = String(cacheKey);
    resourceWorkerRef.current.postMessage(msg);
  };

  const requestEfficiencyPreview = (targetN) => {
    if (mainViewMode !== 'planning') return;
    if (planningOptMode !== 'efficiency') return;
    if (!boundaryLoopWorld?.length || boundaryLoopWorld.length < 3) return;
    if (!efficiencyWorkerRef.current) return;

    const N = Math.max(1, Math.round(Number(targetN)));
    if (!Number.isFinite(N)) return;

    if (efficiencyPreviewDebounceRef.current) clearTimeout(efficiencyPreviewDebounceRef.current);
    efficiencyPreviewDebounceRef.current = setTimeout(() => {
      const cacheKey = buildEfficiencyCacheKey();
      planningEfficiencyCacheKeyRef.current = String(cacheKey);
      setPlanningEfficiencyCacheKey(cacheKey);
      const axis = (String(planningParams?.roadwayOrientation ?? 'x') === 'y') ? 'y' : 'x';
      const wbR = getRangeWithFallback(planningParams?.boundaryPillarMin, planningParams?.boundaryPillarMax, planningParams?.boundaryPillarTarget);
      const wsR = getRangeWithFallback(planningParams?.coalPillarMin, planningParams?.coalPillarMax, planningParams?.coalPillarTarget);
      const fw = getFaceWidthRange();

      const wbRep = Number.isFinite(Number(wbR?.target))
        ? Number(wbR.target)
        : (Number.isFinite(Number(wbR?.min)) && Number.isFinite(Number(wbR?.max)))
          ? (Number(wbR.min) + Number(wbR.max)) / 2
          : (Number.isFinite(Number(wbR?.min)) ? Number(wbR.min) : 0);

      const reqSeq = (efficiencyPreviewReqSeqRef.current += 1);
      setPlanningEfficiencyPreviewBusy(true);
      setPlanningEfficiencyPreview({ ok: false, preview: true, targetN: N, reqSeq, cacheKey, message: '预览计算中…' });

      workerLog('[worker][efficiency] postMessage(preview)', { reqSeq, cacheKey, axis, targetN: N });

      efficiencyWorkerRef.current.postMessage({
        type: 'preview',
        payload: {
          reqSeq,
          cacheKey,
          axis,
          boundaryLoopWorld: cloneJson(boundaryLoopWorld),
          targetN: N,
          boundaryPillar: wbRep,
          coalPillarMin: wsR.min,
          coalPillarMax: wsR.max,
          faceWidthMin: fw.min,
          faceWidthMax: fw.max,
          faceAdvanceMax: Number(planningParams?.faceAdvanceMax) || null,
        },
      });
    }, 140);
  };

  useEffect(() => {
    const terminateWorkers = () => {
      try {
        efficiencyWorkerRef.current?.terminate?.();
      } catch {
        // ignore
      }
      try {
        resourceWorkerRef.current?.terminate?.();
      } catch {
        // ignore
      }
      efficiencyWorkerRef.current = null;
      resourceWorkerRef.current = null;
    };

    const initEfficiencyWorker = () => {
      if (efficiencyWorkerRef.current) return;
      try {
        efficiencyWorkerRef.current = new Worker(
          new URL('./planning/workers/smartEfficiency.worker.js', import.meta.url),
          { type: 'module' }
        );
      } catch (e) {
        console.error('init efficiency worker failed', e);
        efficiencyWorkerRef.current = null;
      }
    };

    const initResourceWorker = () => {
      if (resourceWorkerRef.current) return;
      try {
        resourceWorkerRef.current = new Worker(
          new URL('./planning/workers/smartResource.worker.js', import.meta.url),
          { type: 'module' }
        );
      } catch (e) {
        console.error('init resource worker failed', e);
        resourceWorkerRef.current = null;
      }
    };

    const getOmegaLoopsFromResult = (r) => {
      const loopsW = Array.isArray(r?.omegaRender?.loops)
        ? r.omegaRender.loops
        : (Array.isArray(r?.omegaRender?.innerOmegaLoopWorld) ? [r.omegaRender.innerOmegaLoopWorld] : []);
      return loopsW;
    };

    const handleComputeResult = (uiMode, payload, opts = {}) => {
      const isRecovery = uiMode === 'recovery';
      const payloadSeq = Number(payload?.reqSeq);
      const payloadKey = String(payload?.cacheKey ?? '');
      const payloadFast = Boolean(payload?.fast);

      try {
        assertPlanningResponse(uiMode, payload);
        console.log('end', { uiMode, requestId: payloadSeq, mode: payload?.mode, cacheKey: payloadKey });
        workerLog('[worker] onmessage(result)', {
          uiMode,
          reqSeq: payloadSeq,
          cacheKey: payloadKey,
          fast: payloadFast,
          ok: Boolean(payload?.ok),
          partial: Boolean(payload?.stats?.partial),
          elapsedMs: payload?.stats?.elapsedMs ?? null,
          candidatesCount: Array.isArray(payload?.candidates) ? payload.candidates.length : (payload?.stats?.candidateCount ?? null),
        });
      } catch (e) {
        const errMsg = String(e?.message ?? e);
        console.error('mismatch', { uiMode, requestId: payloadSeq, error: errMsg, responseMode: payload?.mode, cacheKey: payloadKey });
        workerError('[worker] response-assert-failed', { uiMode, reqSeq: payloadSeq, cacheKey: payloadKey, error: errMsg });
        if (isRecovery) {
          setPlanningRecoveryBusy(false);
          setPlanningRecoveryResult({ ok: false, mode: 'smart-resource', message: errMsg, failedReason: errMsg, candidates: [] });
        } else {
          setPlanningEfficiencyBusy(false);
          setPlanningEfficiencyResult({ ok: false, mode: 'smart-efficiency', message: errMsg, failedReason: errMsg, candidates: [] });
          setPlanningEfficiencyPreview(null);
          setPlanningEfficiencyPreviewBusy(false);
        }
        return;
      }

      // 忽略过期响应（用户可能在计算中又改了参数）
      const latestSeq = isRecovery ? recoveryReqSeqRef.current : efficiencyReqSeqRef.current;
      if (Number.isFinite(payloadSeq) && payloadSeq !== latestSeq) {
        workerWarn('[worker] discard-stale', { uiMode, payloadSeq, latestSeq, cacheKey: payloadKey, fast: payloadFast, ok: Boolean(payload?.ok) });
        if (!payloadFast && payload?.ok && payloadKey) {
          const workerBestSig = (payload.candidates?.[0]?.signature ?? '')
            || payload.bestKey
            || payload.selectedCandidateKey
            || payload.bestSignature
            || '';

          const rememberedSig = String((isRecovery ? recoverySelectedSigByKeyRef.current : efficiencySelectedSigByKeyRef.current).get(payloadKey) || '');
          const rememberedOk = Boolean(
            rememberedSig
            && Array.isArray(payload?.candidates)
            && payload.candidates.some((c) => String(c?.signature ?? '') === rememberedSig)
          );
          const preferredSig = String((rememberedOk ? rememberedSig : (workerBestSig || '')));
          (isRecovery ? recoveryCacheRef.current : efficiencyCacheRef.current).set(payloadKey, { result: payload, selectedSig: preferredSig });
        }
        return;
      }

      // 显式点击触发：若返回过快，result 会立刻覆盖掉“计算中…”，用户会感觉“第二次点击没反应”。
      // 这里对“结果应用”做最短延迟（busy/progress 不提前清）。
      try {
        const skipMinDelay = Boolean(opts?.skipMinDelay);
        if (!skipMinDelay) {
          const now = Date.now();
          const minUntil = isRecovery ? Number(planningRecoveryMinBusyUntilRef.current || 0) : Number(planningEfficiencyMinBusyUntilRef.current || 0);
          const minSeq = isRecovery ? Number(planningRecoveryMinBusyReqSeqRef.current || 0) : Number(planningEfficiencyMinBusyReqSeqRef.current || 0);
          const delayMs = (Number.isFinite(minUntil) && payloadSeq === minSeq) ? Math.max(0, minUntil - now) : 0;
          if (delayMs > 0) {
            const seqForDelay = payloadSeq;
            setTimeout(() => {
              const latest = isRecovery ? recoveryReqSeqRef.current : efficiencyReqSeqRef.current;
              if (Number.isFinite(seqForDelay) && Number.isFinite(latest) && seqForDelay !== latest) return;
              handleComputeResult(uiMode, payload, { skipMinDelay: true });
            }, delayMs);
            return;
          }
        }
      } catch {
        // ignore
      }

      if (isRecovery) {
        setPlanningRecoveryBusy(false);
        setPlanningRecoveryProgress(null);
      } else {
        setPlanningEfficiencyBusy(false);
        setPlanningEfficiencyProgress(null);
      }

      if (!payload?.ok) {
        if (isRecovery) setPlanningRecoveryResult(payload);
        else setPlanningEfficiencyResult(payload);

        // 关键：即使 candidates=0 / ok=false，只要 worker 已生成 innerOmega，就必须显示粉色可采区
        // 用于诊断“参数过严导致无可行条带组合”的情况。
        try {
          const omegaLoopsW = getOmegaLoopsFromResult(payload);
          if (omegaLoopsW.length > 0) setShowPlanningBoundaryOverlay(true);
        } catch {
          // ignore
        }

        if (isRecovery) setPlanningRecoverySelectedSig('');
        else setPlanningEfficiencySelectedSig('');
        setPlannedWorkfaceLoopsWorld([]);
        setPlannedWorkfaceUnionLoopsWorld([]);

        // efficiency compute 失败：清理预览状态
        if (!isRecovery) {
          setPlanningEfficiencyPreview(null);
          setPlanningEfficiencyPreviewBusy(false);
        }

        if (DEBUG_PANEL && !isRecovery) {
          setPlanningDebugSnapshot((prev) => ({
            ...(prev ?? {}),
            ts: Date.now(),
            mode: 'smart-efficiency',
            response: buildEfficiencyDebugResponseSummary(payload, planningEfficiencySelectedSig),
            lastError: String(payload?.message ?? '工程效率计算失败'),
          }));
        }
        return;
      }

      const cacheKey = payloadKey || (isRecovery ? buildRecoveryCacheKey() : buildEfficiencyCacheKey());
      const workerBestSig = (payload.candidates?.[0]?.signature ?? '')
        || payload.bestKey
        || payload.selectedCandidateKey
        || payload.bestSignature
        || '';

      // 优先恢复用户在该 cacheKey 下的手动选择（若仍存在于候选集中）
      const rememberedSig = String((isRecovery ? recoverySelectedSigByKeyRef.current : efficiencySelectedSigByKeyRef.current).get(cacheKey) || '');
      const rememberedOk = Boolean(
        rememberedSig
        && Array.isArray(payload?.candidates)
        && payload.candidates.some((c) => String(c?.signature ?? '') === rememberedSig)
      );
      const preferredSig = String((rememberedOk ? rememberedSig : (workerBestSig || '')));

      // fast 结果只用于“快速出图”，不进入主缓存，避免阻塞 full compute
      if (!payloadFast) {
        (isRecovery ? recoveryCacheRef.current : efficiencyCacheRef.current).set(cacheKey, { result: payload, selectedSig: preferredSig });
        if (preferredSig) (isRecovery ? recoverySelectedSigByKeyRef.current : efficiencySelectedSigByKeyRef.current).set(cacheKey, preferredSig);
      }
      if (isRecovery) {
        setPlanningRecoveryResult(payload);
        try {
          recoveryLastResponseRef.current = payload;
        } catch {
          // ignore
        }
        applyRecoveryCandidateBySignature(preferredSig, payload);
      } else {
        setPlanningEfficiencyResult(payload);
        try {
          efficiencyLastResponseRef.current = payload;
        } catch {
          // ignore
        }
        applyEfficiencyCandidateBySignature(preferredSig, payload);
        // compute 成功：清理预览（回到“真实候选集”）
        setPlanningEfficiencyPreview(null);
        setPlanningEfficiencyPreviewBusy(false);
      }

      if (DEBUG_PANEL && !isRecovery) {
        setPlanningDebugSnapshot((prev) => ({
          ...(prev ?? {}),
          ts: Date.now(),
          mode: 'smart-efficiency',
          response: buildEfficiencyDebugResponseSummary(payload, preferredSig),
          lastError: '',
        }));
      }

      if (DEBUG_PANEL && isRecovery) {
        setPlanningDebugSnapshot((prev) => ({
          ...(prev ?? {}),
          ts: Date.now(),
          mode: 'smart-resource',
          response: {
            ok: Boolean(payload?.ok),
            failedReason: String(payload?.failedReason ?? ''),
            reqSeq: payload?.reqSeq,
            cacheKey: String(payload?.cacheKey ?? ''),
            fast: Boolean(payload?.fast),
            candidatesCount: Array.isArray(payload?.candidates) ? payload.candidates.length : (payload?.stats?.candidateCount ?? null),
            selectedCandidateKey: String(preferredSig || ''),
            omegaArea: Number.isFinite(Number(payload?.omegaArea)) ? Number(payload.omegaArea) : null,
            tonnageTotal: Number.isFinite(Number(payload?.tonnageTotal)) ? Number(payload.tonnageTotal) : null,
            perFace: {
              enabled: Boolean(payload?.debug?.perFace?.enabled),
              generated: Number(payload?.debug?.perFace?.generated ?? null),
              qualified: Number(payload?.debug?.perFace?.qualified ?? null),
              pushedUnique: Number(payload?.debug?.perFace?.pushedUnique ?? null),
              lastReason: String(payload?.debug?.perFace?.lastReason ?? ''),
            },
          },
          lastError: '',
        }));
      }

      // fast+refine：快速结果返回后，立即补一轮 full compute（同一 cacheKey & axis 才执行）
      try {
        if (payloadFast && payload?.ok) {
          const wantKey = String((isRecovery ? recoveryPendingRefineKeyRef : efficiencyPendingRefineKeyRef).current || '');
          const wantAxis = String((isRecovery ? recoveryPendingRefineAxisRef : efficiencyPendingRefineAxisRef).current || '');
          const axisNow = (String(planningParams?.roadwayOrientation ?? 'x') === 'y') ? 'y' : 'x';
          const keyNow = isRecovery ? buildRecoveryCacheKey() : buildEfficiencyCacheKey();
          const shouldRefine = wantKey
            && wantKey === String(payloadKey || cacheKey)
            && wantKey === String(keyNow)
            && wantAxis
            && wantAxis === String(payload?.axis ?? '')
            && (isRecovery ? true : (wantAxis === String(axisNow)))
            && mainViewMode === 'planning'
            && planningOptMode === (isRecovery ? 'recovery' : 'efficiency');

          if (shouldRefine) {
            if (isRecovery) {
              recoveryPendingRefineKeyRef.current = '';
              recoveryPendingRefineAxisRef.current = '';
            } else {
              efficiencyPendingRefineKeyRef.current = '';
              efficiencyPendingRefineAxisRef.current = '';
            }
            setTimeout(() => {
              if (isRecovery) requestComputeRecovery({ force: true, fast: false, refine: false, background: true });
              else requestComputeEfficiency({ force: true, fast: false, refine: false, background: true });
            }, 150);
          }
        }
      } catch {
        // ignore
      }
    };

    initEfficiencyWorker();
    initResourceWorker();

    if (efficiencyWorkerRef.current) {
      efficiencyWorkerRef.current.onmessage = (ev) => {
        const data = ev?.data ?? {};
        if (data?.type !== 'result' && data?.type !== 'preview' && data?.type !== 'progress') return;
        const payload = data?.payload ?? {};

        if (data?.type === 'progress') {
          const payloadSeq = Number(payload?.reqSeq);
          const latestSeq = efficiencyReqSeqRef.current;
          if (Number.isFinite(payloadSeq) && payloadSeq !== latestSeq) return;
          const payloadKey = String(payload?.cacheKey ?? '');
          const latestKey = String(planningEfficiencyCacheKeyRef.current || planningEfficiencyCacheKey || '');
          if (payloadKey && latestKey && payloadKey !== latestKey) return;
          const now = Date.now();
          if (now - (planningEfficiencyProgressLastTsRef.current || 0) < 120) return;
          planningEfficiencyProgressLastTsRef.current = now;
          setPlanningEfficiencyProgress(payload?.progress ?? null);

          // 同步更新“结果提示条”的文案（用户主要关注这里的“计算中…”）。
          try {
            const p = payload?.progress ?? null;
            const pct = Number(p?.percent);
            const tried = Number(p?.attemptedCombos);
            const ok = Number(p?.feasibleCombos);
            const phase = String(p?.phase ?? '').trim();
            const wsI = Number(p?.wsIndex);
            const wsT = Number(p?.wsTotal);
            const nI = Number(p?.nIndex);
            const nT = Number(p?.nTotal);
            const parts = [];
            if (Number.isFinite(pct)) parts.push(`${Math.max(0, Math.min(99, Math.round(pct)))}%`);
            if (Number.isFinite(wsI) && Number.isFinite(wsT) && wsT >= 1) parts.push(`ws ${Math.max(1, Math.round(wsI))}/${Math.round(wsT)}`);
            if (Number.isFinite(nI) && Number.isFinite(nT) && nT >= 1) parts.push(`N ${Math.max(1, Math.round(nI))}/${Math.round(nT)}`);
            if (Number.isFinite(tried)) parts.push(`已尝试${Math.max(0, Math.round(tried))}`);
            if (Number.isFinite(ok)) parts.push(`可行${Math.max(0, Math.round(ok))}`);
            if (phase) parts.push(phase);
            const suffix = parts.length ? `（${parts.join('，')}）` : '';
            setPlanningEfficiencyResult((prev) => {
              if (!prev || prev.ok) return prev;
              const msg0 = String(prev?.message ?? '');
              if (!msg0.startsWith('计算中')) return prev;
              const msg1 = `计算中…${suffix}`;
              return (msg0 === msg1) ? prev : { ...prev, message: msg1 };
            });
          } catch {
            // ignore
          }
          return;
        }

        if (data?.type === 'preview') {
          const payloadSeq = Number(payload?.reqSeq);
          if (Number.isFinite(payloadSeq) && payloadSeq !== efficiencyPreviewReqSeqRef.current) return;
          setPlanningEfficiencyPreviewBusy(false);
          setPlanningEfficiencyPreview(payload);
          if (payload?.ok && payload?.candidate) {
            applyEfficiencyPreviewCandidate(payload.candidate);
          }
          return;
        }

        handleComputeResult('efficiency', payload);
      };
    }

    if (resourceWorkerRef.current) {
      resourceWorkerRef.current.onmessage = (ev) => {
        const data = ev?.data ?? {};
        if (data?.type !== 'result' && data?.type !== 'progress') return;
        const payload = data?.payload ?? {};

        if (data?.type === 'progress') {
          const payloadSeq = Number(payload?.reqSeq);
          const latestSeq = recoveryReqSeqRef.current;
          if (Number.isFinite(payloadSeq) && payloadSeq !== latestSeq) return;
          const payloadKey = String(payload?.cacheKey ?? '');
          const latestKey = String(planningRecoveryCacheKeyRef.current || planningRecoveryCacheKey || '');
          if (payloadKey && latestKey && payloadKey !== latestKey) return;
          const now = Date.now();
          if (now - (planningRecoveryProgressLastTsRef.current || 0) < 120) return;
          planningRecoveryProgressLastTsRef.current = now;
          setPlanningRecoveryProgress(payload?.progress ?? null);

          try {
            const p = payload?.progress ?? null;
            const pct = Number(p?.percent);
            const tried = Number(p?.attemptedCombos);
            const ok = Number(p?.feasibleCombos);
            const phase = String(p?.phase ?? '').trim();
            const parts = [];
            if (Number.isFinite(pct)) parts.push(`${Math.max(0, Math.min(99, Math.round(pct)))}%`);
            if (Number.isFinite(tried)) parts.push(`已尝试${Math.max(0, Math.round(tried))}`);
            if (Number.isFinite(ok)) parts.push(`可行${Math.max(0, Math.round(ok))}`);
            if (phase) parts.push(phase);
            const suffix = parts.length ? `（${parts.join('，')}）` : '';
            setPlanningRecoveryResult((prev) => {
              if (!prev || prev.ok) return prev;
              const msg0 = String(prev?.message ?? '');
              if (!msg0.startsWith('计算中')) return prev;
              const msg1 = `计算中…${suffix}`;
              return (msg0 === msg1) ? prev : { ...prev, message: msg1 };
            });
          } catch {
            // ignore
          }
          return;
        }
        handleComputeResult('recovery', payload);
      };
    }

    return terminateWorkers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectEfficiencyCandidate = (signature) => {
    const sig = String(signature ?? '');
    if (!sig) return;

    // 选择真实候选时退出“预览模式”（4A）
    setPlanningEfficiencyPreview(null);
    setPlanningEfficiencyPreviewBusy(false);

    const cacheKey = planningEfficiencyCacheKey || buildEfficiencyCacheKey();
    // 记住用户选择，防止后续 refine/full 回包把选中态覆盖回 best。
    efficiencySelectedSigByKeyRef.current.set(cacheKey, sig);
    const cached = efficiencyCacheRef.current.get(cacheKey);
    if (cached?.result?.ok) {
      efficiencyCacheRef.current.set(cacheKey, { ...cached, selectedSig: sig });
    }
    applyEfficiencyCandidateBySignature(sig, cached?.result ?? planningEfficiencyResult);

    if (DEBUG_PANEL) {
      const res = cached?.result ?? planningEfficiencyResult;
      setPlanningDebugSnapshot((prev) => ({
        ...(prev ?? {}),
        ts: Date.now(),
        mode: 'smart-efficiency',
        response: buildEfficiencyDebugResponseSummary(res, sig),
      }));
    }
  };

  const handleSelectRecoveryCandidate = (signature) => {
    const sig = String(signature ?? '');
    if (!sig) return;
    const cacheKey = planningRecoveryCacheKey || buildRecoveryCacheKey();
    recoverySelectedSigByKeyRef.current.set(cacheKey, sig);
    const cached = recoveryCacheRef.current.get(cacheKey);
    if (cached?.result?.ok) {
      recoveryCacheRef.current.set(cacheKey, { ...cached, selectedSig: sig });
    }
    applyRecoveryCandidateBySignature(sig, cached?.result ?? planningRecoveryResult);
  };

  const selectEfficiencyByN = (n) => {
    const N = Number(n);
    if (!(Number.isFinite(N) && N >= 1)) return;
    const r = planningEfficiencyResult;
    const bestKey = r?.bestKeyByN?.[String(N)] || r?.byN?.[String(N)]?.bestKey;
    if (!bestKey) return;

    // 切到可行 N：清理预览
    setPlanningEfficiencyPreview(null);
    setPlanningEfficiencyPreviewBusy(false);

    handleSelectEfficiencyCandidate(bestKey);
  };
  const [showMainMap, setShowMainMap] = useState(true);
  const [showErrorAnalysis, setShowErrorAnalysis] = useState(true);
  const [showMeasuredMapping, setShowMeasuredMapping] = useState(true);
  const [activeAccordion, setActiveAccordion] = useState(['summary']);

  const lastAutoSeamThicknessRef = useRef(null);
  const mainCenterScrollRef = useRef(null);
  const planningOptPanelAnchorRef = useRef(null);
  const planningEfficiencySectionRef = useRef(null);
  const planningRecoverySectionRef = useRef(null);

  const handleToggleEfficiencyCandidates = () => {
    const rows0 = planningEfficiencyResult?.table?.rows ?? [];
    const topSig = String(rows0?.[0]?.signature ?? '');

    if (planningEfficiencyShowAllCandidates) {
      // 折叠：自动回到 Top1 并滚回板块顶部，避免长表视角跑偏
      if (topSig) handleSelectEfficiencyCandidate(topSig);
      setPlanningEfficiencyShowAllCandidates(false);
      setTimeout(() => {
        planningEfficiencySectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }, 0);
      return;
    }

    setPlanningEfficiencyShowAllCandidates(true);
  };

  const handleToggleRecoveryCandidates = () => {
    const rows0 = planningRecoveryResult?.table?.rows ?? [];
    const topSig = String(rows0?.[0]?.signature ?? '');

    if (planningRecoveryShowAllCandidates) {
      if (topSig) handleSelectRecoveryCandidate(topSig);
      setPlanningRecoveryShowAllCandidates(false);
      setTimeout(() => {
        planningRecoverySectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }, 0);
      return;
    }

    setPlanningRecoveryShowAllCandidates(true);
  };

  const openRightPanelOnly = (key) => {
    setActiveAccordion(key ? [key] : []);
  };

  const handlePlanningOptModeChange = (nextMode) => {
    const m = String(nextMode ?? '').trim();
    setPlanningOptMode(m);

    // 体验优化：在“采区规划图”视图下，切换到 efficiency/recovery 立即启动对应计算。
    // 注意：这里使用 force=true，避免 setState 未生效导致 requestCompute* 被门禁提前 return。
    if (mainViewMode !== 'planning') return;
    if (!boundaryLoopWorld?.length || boundaryLoopWorld.length < 3) return;
    if (m === 'efficiency') {
      // 显式切换：展示“计算中…”更符合用户预期
      requestComputeEfficiency({ force: true, fast: false, refine: false, background: false });
      return;
    }
    if (m === 'recovery') {
      requestComputeRecovery({ force: true, fast: true, refine: true, background: false });
    }
  };

  const switchMainViewModeWithRightPanel = (mode) => {
    setMainViewMode(mode);
    if (mode === 'planning') openRightPanelOnly('planning');
    if (mode === 'odi') openRightPanelOnly('summary');
  };

  // 智能规划：进入“采区规划图”后自动把“多目标规划优化方案”滚动到可视区
  // 说明：该面板在主图卡片下方，主图较高时容易被“中间滚动窗口”遮在下方。
  useEffect(() => {
    if (mainViewMode !== 'planning') return;
    const panel = planningOptPanelAnchorRef.current;
    if (!panel) return;

    const ensureVisible = () => {
      const container = mainCenterScrollRef.current;
      if (container?.getBoundingClientRect && panel?.getBoundingClientRect) {
        const c = container.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        const fullyVisible = p.top >= c.top && p.bottom <= c.bottom;
        if (!fullyVisible) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
        return;
      }

      panel.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
    };

    const t = setTimeout(ensureVisible, 0);
    return () => clearTimeout(t);
  }, [mainViewMode]);
  const [boundaryData, setBoundaryData] = useState([]);
  const [drillholeData, setDrillholeData] = useState([]);
  const [drillholeLayersById, setDrillholeLayersById] = useState({});
  // 含水层扰动场景：含水层类型选择（来自“含水层标记”列，例如：1含、2含、3）
  const [selectedAquiferType, setSelectedAquiferType] = useState('');
  const [workingFaceData, setWorkingFaceData] = useState([]);
  // 智能规划：规划工作面轮廓（世界坐标）
  const [plannedWorkfaceLoopsWorld, setPlannedWorkfaceLoopsWorld] = useState([]); // [{ faceIndex, loop: [{x,y}...] }]
  // 智能规划：规划工作面“合并后外轮廓”（世界坐标；用于避免相邻面共享边形成重线）
  const [plannedWorkfaceUnionLoopsWorld, setPlannedWorkfaceUnionLoopsWorld] = useState([]); // [[{x,y}...]]
  // 智能规划：工作面悬停 Tooltip（仅 UI 派生，不触发任何重算；位置固定，避免 mousemove 频繁 setState）
  const [planningWorkfaceHover, setPlanningWorkfaceHover] = useState(null); // { faceIndex:number }
  const planningWorkfaceTooltipRef = useRef(null);
  const planningWorkfaceTooltipRafRef = useRef(0);
  const planningWorkfaceTooltipLastClientRef = useRef({ x: null, y: null });
  const [showPlanningBoundaryOverlay, setShowPlanningBoundaryOverlay] = useState(false);
  const [generatedPoints, setGeneratedPoints] = useState(null);
  // 智能规划：工作面宽度范围仅首次计算回填，后续保持用户选择（需纳入清空/撤回）
  const [hasInitializedFaceWidthRange, setHasInitializedFaceWidthRange] = useState(false);
  const [planningPreStartSnapshot, setPlanningPreStartSnapshot] = useState(null);
  // 工作面：高精度参数提取（向导 Step2）
  const [mineActualHeightM, setMineActualHeightM] = useState(4.5);
  // 含水层扰动场景：多工作面采高（按工作面编号 No.1~No.n 分别设置）
  const [aquiferMineHeightByFace, setAquiferMineHeightByFace] = useState([]); // number[]; index=faceIndex-1
  const [aquiferSelectedFaceNo, setAquiferSelectedFaceNo] = useState(1); // 1..n
  const [roofCavingAngleDeg, setRoofCavingAngleDeg] = useState(0);

  // 含水层扰动场景：多工作面顶板垮落角 δ（按工作面编号 No.1~No.n 分别设置）
  const [aquiferRoofCavingAngleByFace, setAquiferRoofCavingAngleByFace] = useState([]); // number[]; index=faceIndex-1

  // 地表下沉场景：多工作面采高/顶板垮落角（按工作面编号分别设置）
  const [surfaceMineHeightByFace, setSurfaceMineHeightByFace] = useState([]);
  const [surfaceSelectedFaceNo, setSurfaceSelectedFaceNo] = useState(1);
  const [surfaceRoofCavingAngleByFace, setSurfaceRoofCavingAngleByFace] = useState([]);

  // 上行开采场景：多工作面采高/顶板垮落角（按工作面编号分别设置）
  const [upwardMineHeightByFace, setUpwardMineHeightByFace] = useState([]);
  const [upwardSelectedFaceNo, setUpwardSelectedFaceNo] = useState(1);
  const [upwardRoofCavingAngleByFace, setUpwardRoofCavingAngleByFace] = useState([]);
  const [paramExtractionResult, setParamExtractionResult] = useState(null);
  // ODI 计算结果（分级响应 + 中间主图）
  const [odiResult, setOdiResult] = useState(null);
  // 主图：图层叠加 & 交互分析
  const [showLayerDrillholes, setShowLayerDrillholes] = useState(true);
  const [showLayerEvalPoints, setShowLayerEvalPoints] = useState(true);
  const [showLayerInterpolation, setShowLayerInterpolation] = useState(true);
  const [showEvalBoundaryPoints, setShowEvalBoundaryPoints] = useState(true); // gray
  const [showEvalWorkfaceLocPoints, setShowEvalWorkfaceLocPoints] = useState(true); // pink
  const [showEvalEdgeCtrlPoints, setShowEvalEdgeCtrlPoints] = useState(true); // green
  const [showEvalCenterCtrlPoints, setShowEvalCenterCtrlPoints] = useState(true); // red
  const [odiLevelFilter, setOdiLevelFilter] = useState(null); // null | 0..4
  // ODI 可视化配置：色带 / 分级数量 / 映射区间（过滤低扰动噪音）
  const [odiVizPalette, setOdiVizPalette] = useState('blueRed');
  const [odiVizSteps, setOdiVizSteps] = useState(5); // 3~10
  const [odiVizRange, setOdiVizRange] = useState({ min: '', max: '' }); // string inputs
  // 含水层扰动场景：ODI 自然邻域插值输出平滑度（0=不平滑；越大越丝滑）
  const [aquiferOdiSmoothPasses, setAquiferOdiSmoothPasses] = useState(2); // 0~6
  // 地表下沉 / 上行开采：平滑度（目前仅用于 UI 预留，不接入业务计算逻辑）
  const [surfaceOdiSmoothPasses, setSurfaceOdiSmoothPasses] = useState(2); // 0~6
  const [upwardOdiSmoothPasses, setUpwardOdiSmoothPasses] = useState(2); // 0~6
  const [showMainMapCoordinates, setShowMainMapCoordinates] = useState(true);
  const [crosshair, setCrosshair] = useState({
    active: false,
    sx: 0,
    sy: 0,
    wx: null,
    wy: null,
    values: { odiNorm: null, Ti: null, Hi: null, Di: null },
  });
  const [selectedCoal, setSelectedCoal] = useState('');
  const [showBoundaryLabels, setShowBoundaryLabels] = useState(false);
  const [showDrillholeLabels, setShowDrillholeLabels] = useState(false);
  const [showWorkfaceOutline, setShowWorkfaceOutline] = useState(false);
  const [showMeasuredPoints, setShowMeasuredPoints] = useState(true);

  // 主图测量工具：点击两点，显示水平/垂直距离（世界坐标单位）
  const [measureEnabled, setMeasureEnabled] = useState(false);
  const [measureAxis, setMeasureAxis] = useState('h'); // 'h' | 'v'
  const [measurePoints, setMeasurePoints] = useState([]); // [{ sx, sy, wx, wy }]

  // 实测约束数据（分场景独立存储）：当前先实现“地表下沉场景”的分区逻辑
  const [measuredConstraintData, setMeasuredConstraintData] = useState([]);
  // 实测测线（按导入文件分组）：用于误差计算/测线选择
  const [measuredConstraintLines, setMeasuredConstraintLines] = useState([]); // [{ lineId, label, points: [{id,x,y,measured,fileId}] }]
  const [selectedMeasuredLineId, setSelectedMeasuredLineId] = useState('');
  const [errorAnalysisByLineId, setErrorAnalysisByLineId] = useState({}); // { [lineId]: { computedAt, data: [...] } }
  const [showErrorExportMenu, setShowErrorExportMenu] = useState(false);
  const [measuredZoningResult, setMeasuredZoningResult] = useState(null);

  const setMeasuredZoningResultTracked = (next) => {
    if (import.meta?.env?.DEV) {
      const binsLen = next?.bins?.length;
      console.debug('[measuredZoningResult] set ->', binsLen ? `bins.length=${binsLen}` : next);
      console.trace('[measuredZoningResult] trace');
    }
    setMeasuredZoningResult(next);
  };

  const [geologyLayoutMode, setGeologyLayoutMode] = useState('2x2'); // '1x1' | '1x2' | '2x2'
  const [geoPickA, setGeoPickA] = useState('Ti');
  const [geoPickB, setGeoPickB] = useState('Hi');

  const boundaryFileInputRef = useRef(null);
  const drillholeFileInputRef = useRef(null);
  const drillholeLayersFileInputRef = useRef(null);
  const measuredConstraintFileInputRef = useRef(null);
  const workingFaceFileInputRef = useRef(null);
  const mainMapSvgRef = useRef(null);
  const mainMapContainerRef = useRef(null);
  const errorChartContainerRef = useRef(null);
  const errorExportMenuRef = useRef(null);
  const errorExportButtonRef = useRef(null);

  const [isMainMapFullscreen, setIsMainMapFullscreen] = useState(false);
  const [showMainMapExportMenu, setShowMainMapExportMenu] = useState(false);
  const [showMainMapLabelsMenu, setShowMainMapLabelsMenu] = useState(false);

  const uid = useId();
  const [mapVizSettings, setMapVizSettings] = useState({
    Ti: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
    Hi: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
    Di: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
    Mi: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
  });

  // 三个场景的参数互不关联：为每个场景保存一套参数快照
  const cloneJson = (v) => JSON.parse(JSON.stringify(v));
  const scenarioDefaultsById = useMemo(
    () => ({
      surface: {
        boundaryData: [],
        drillholeData: [],
        drillholeLayersById: {},
        workingFaceData: [],
        generatedPoints: null,
        mineActualHeightM: 4.5,
        aquiferMineHeightByFace: [],
        aquiferSelectedFaceNo: 1,
        roofCavingAngleDeg: 0,
        aquiferRoofCavingAngleByFace: [],
        surfaceMineHeightByFace: [],
        surfaceSelectedFaceNo: 1,
        surfaceRoofCavingAngleByFace: [],
        upwardMineHeightByFace: [],
        upwardSelectedFaceNo: 1,
        upwardRoofCavingAngleByFace: [],
        paramExtractionResult: null,
        odiResult: null,
        showLayerDrillholes: true,
        showLayerEvalPoints: true,
        showLayerInterpolation: true,
        showEvalBoundaryPoints: true,
        showEvalWorkfaceLocPoints: true,
        showEvalEdgeCtrlPoints: true,
        showEvalCenterCtrlPoints: true,
        odiLevelFilter: null,
        odiVizPalette: 'blueRed',
        odiVizSteps: 5,
        odiVizRange: { min: '', max: '' },
        aquiferOdiSmoothPasses: 0,
        showBoundaryLabels: false,
        showDrillholeLabels: false,
        showWorkfaceOutline: false,
        showMeasuredPoints: true,
        miningHeight: 4.5,
        stepLength: 25,
        richFactor: 1.1,
        scenarioWeights: { wd: 0.45, wo: 0.30, wf: 0.25 },
        selectedCoal: '',
        geologyLayoutMode: '2x2',
        geoPickA: 'Ti',
        geoPickB: 'Hi',
        mapVizSettings: {
          Ti: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
          Hi: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
          Di: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
          Mi: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
        },
        measuredConstraintData: [],
        measuredConstraintLines: [],
        selectedMeasuredLineId: '',
        errorAnalysisByLineId: {},
        measuredZoningResult: null,
        selectedAquiferType: '',
      },
      aquifer: {
        boundaryData: [],
        drillholeData: [],
        drillholeLayersById: {},
        workingFaceData: [],
        generatedPoints: null,
        mineActualHeightM: 4.5,
        aquiferMineHeightByFace: [],
        aquiferSelectedFaceNo: 1,
        roofCavingAngleDeg: 0,
        aquiferRoofCavingAngleByFace: [],
        surfaceMineHeightByFace: [],
        surfaceSelectedFaceNo: 1,
        surfaceRoofCavingAngleByFace: [],
        upwardMineHeightByFace: [],
        upwardSelectedFaceNo: 1,
        upwardRoofCavingAngleByFace: [],
        paramExtractionResult: null,
        odiResult: null,
        showLayerDrillholes: true,
        showLayerEvalPoints: true,
        showLayerInterpolation: true,
        showEvalBoundaryPoints: true,
        showEvalWorkfaceLocPoints: true,
        showEvalEdgeCtrlPoints: true,
        showEvalCenterCtrlPoints: true,
        odiLevelFilter: null,
        odiVizPalette: 'blueRed',
        odiVizSteps: 5,
        odiVizRange: { min: '', max: '' },
        aquiferOdiSmoothPasses: 2,
        showBoundaryLabels: false,
        showDrillholeLabels: false,
        showMeasuredPoints: true,
        miningHeight: 4.5,
        stepLength: 25,
        richFactor: 1.1,
        scenarioWeights: { wd: 0.15, wo: 0.25, wf: 0.6 },
        selectedCoal: '',
        geologyLayoutMode: '2x2',
        geoPickA: 'Ti',
        geoPickB: 'Hi',
        mapVizSettings: {
          Ti: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
          Hi: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
          Di: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
          Mi: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
        },
        measuredConstraintData: [],
        measuredConstraintLines: [],
        selectedMeasuredLineId: '',
        errorAnalysisByLineId: {},
        measuredZoningResult: null,
        selectedAquiferType: '',
      },
      upward: {
        boundaryData: [],
        drillholeData: [],
        drillholeLayersById: {},
        workingFaceData: [],
        generatedPoints: null,
        mineActualHeightM: 4.5,
        aquiferMineHeightByFace: [],
        aquiferSelectedFaceNo: 1,
        roofCavingAngleDeg: 0,
        aquiferRoofCavingAngleByFace: [],
        surfaceMineHeightByFace: [],
        surfaceSelectedFaceNo: 1,
        surfaceRoofCavingAngleByFace: [],
        upwardMineHeightByFace: [],
        upwardSelectedFaceNo: 1,
        upwardRoofCavingAngleByFace: [],
        paramExtractionResult: null,
        odiResult: null,
        showLayerDrillholes: true,
        showLayerEvalPoints: true,
        showLayerInterpolation: true,
        showEvalBoundaryPoints: true,
        showEvalWorkfaceLocPoints: true,
        showEvalEdgeCtrlPoints: true,
        showEvalCenterCtrlPoints: true,
        odiLevelFilter: null,
        odiVizPalette: 'blueRed',
        odiVizSteps: 5,
        odiVizRange: { min: '', max: '' },
        aquiferOdiSmoothPasses: 0,
        showBoundaryLabels: false,
        showDrillholeLabels: false,
        showMeasuredPoints: true,
        miningHeight: 4.5,
        stepLength: 25,
        richFactor: 1.1,
        scenarioWeights: { wd: 0.2, wo: 0.45, wf: 0.35 },
        selectedCoal: '',
        geologyLayoutMode: '2x2',
        geoPickA: 'Ti',
        geoPickB: 'Hi',
        mapVizSettings: {
          Ti: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
          Hi: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
          Di: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
          Mi: { palette: 'viridis', range: { enabled: false, min: '', max: '' } },
        },
        measuredConstraintData: [],
        measuredConstraintLines: [],
        selectedMeasuredLineId: '',
        errorAnalysisByLineId: {},
        measuredZoningResult: null,
        selectedAquiferType: '',
      },
    }),
    []
  );

  const [scenarioParamsById, setScenarioParamsById] = useState(() => ({
    surface: cloneJson(scenarioDefaultsById.surface),
    aquifer: cloneJson(scenarioDefaultsById.aquifer),
    upward: cloneJson(scenarioDefaultsById.upward),
  }));

  const snapshotCurrentScenarioParams = () => ({
    boundaryData: cloneJson(boundaryData),
    drillholeData: cloneJson(drillholeData),
    drillholeLayersById: cloneJson(drillholeLayersById),
    workingFaceData: cloneJson(workingFaceData),
    generatedPoints: cloneJson(generatedPoints),
    mineActualHeightM,
    aquiferMineHeightByFace: cloneJson(aquiferMineHeightByFace),
    aquiferSelectedFaceNo,
    roofCavingAngleDeg,
    aquiferRoofCavingAngleByFace: cloneJson(aquiferRoofCavingAngleByFace),
    surfaceMineHeightByFace: cloneJson(surfaceMineHeightByFace),
    surfaceSelectedFaceNo,
    surfaceRoofCavingAngleByFace: cloneJson(surfaceRoofCavingAngleByFace),
    upwardMineHeightByFace: cloneJson(upwardMineHeightByFace),
    upwardSelectedFaceNo,
    upwardRoofCavingAngleByFace: cloneJson(upwardRoofCavingAngleByFace),
    paramExtractionResult: cloneJson(paramExtractionResult),
    odiResult: cloneJson(odiResult),
    showLayerDrillholes,
    showLayerEvalPoints,
    showLayerInterpolation,
    showEvalBoundaryPoints,
    showEvalWorkfaceLocPoints,
    showEvalEdgeCtrlPoints,
    showEvalCenterCtrlPoints,
    odiLevelFilter,
    odiVizPalette,
    odiVizSteps,
    odiVizRange: cloneJson(odiVizRange),
    aquiferOdiSmoothPasses,
    showBoundaryLabels,
    showDrillholeLabels,
    showWorkfaceOutline,
    showMeasuredPoints,
    miningHeight,
    stepLength,
    richFactor,
    scenarioWeights: cloneJson(scenarioWeights),
    selectedCoal,
    geologyLayoutMode,
    geoPickA,
    geoPickB,
    mapVizSettings: cloneJson(mapVizSettings),
    measuredConstraintData: cloneJson(measuredConstraintData),
    measuredConstraintLines: cloneJson(measuredConstraintLines),
    selectedMeasuredLineId,
    errorAnalysisByLineId: cloneJson(errorAnalysisByLineId),
    measuredZoningResult: cloneJson(measuredZoningResult),
    selectedAquiferType,
  });

  const applyScenarioParams = (p) => {
    if (!p) return;
    setBoundaryData(p.boundaryData ?? []);
    setDrillholeData(p.drillholeData ?? []);
    setDrillholeLayersById(p.drillholeLayersById ?? {});
    setWorkingFaceData(p.workingFaceData ?? []);
    setGeneratedPoints(p.generatedPoints ?? null);
    setMineActualHeightM(Number.isFinite(Number(p.mineActualHeightM)) ? Number(p.mineActualHeightM) : 4.5);
    setAquiferMineHeightByFace(Array.isArray(p.aquiferMineHeightByFace) ? p.aquiferMineHeightByFace.map((v) => Number(v)) : []);
    {
      const v = Number(p.aquiferSelectedFaceNo);
      const s = Number.isFinite(v) ? Math.max(1, Math.round(v)) : 1;
      setAquiferSelectedFaceNo(s);
    }
    setRoofCavingAngleDeg(Number.isFinite(Number(p.roofCavingAngleDeg)) ? Number(p.roofCavingAngleDeg) : 0);
    setAquiferRoofCavingAngleByFace(Array.isArray(p.aquiferRoofCavingAngleByFace) ? p.aquiferRoofCavingAngleByFace.map((v) => Number(v)) : []);
    setSurfaceMineHeightByFace(Array.isArray(p.surfaceMineHeightByFace) ? p.surfaceMineHeightByFace.map((v) => Number(v)) : []);
    {
      const v = Number(p.surfaceSelectedFaceNo);
      const s = Number.isFinite(v) ? Math.max(1, Math.round(v)) : 1;
      setSurfaceSelectedFaceNo(s);
    }
    setSurfaceRoofCavingAngleByFace(Array.isArray(p.surfaceRoofCavingAngleByFace) ? p.surfaceRoofCavingAngleByFace.map((v) => Number(v)) : []);
    setUpwardMineHeightByFace(Array.isArray(p.upwardMineHeightByFace) ? p.upwardMineHeightByFace.map((v) => Number(v)) : []);
    {
      const v = Number(p.upwardSelectedFaceNo);
      const s = Number.isFinite(v) ? Math.max(1, Math.round(v)) : 1;
      setUpwardSelectedFaceNo(s);
    }
    setUpwardRoofCavingAngleByFace(Array.isArray(p.upwardRoofCavingAngleByFace) ? p.upwardRoofCavingAngleByFace.map((v) => Number(v)) : []);
    setParamExtractionResult(p.paramExtractionResult ?? null);
    setOdiResult(p.odiResult ?? null);
    setShowLayerDrillholes(p.showLayerDrillholes ?? true);
    setShowLayerEvalPoints(p.showLayerEvalPoints ?? true);
    setShowLayerInterpolation(p.showLayerInterpolation ?? true);
    setShowEvalBoundaryPoints(p.showEvalBoundaryPoints ?? true);
    setShowEvalWorkfaceLocPoints(p.showEvalWorkfaceLocPoints ?? true);
    setShowEvalEdgeCtrlPoints(p.showEvalEdgeCtrlPoints ?? true);
    setShowEvalCenterCtrlPoints(p.showEvalCenterCtrlPoints ?? true);
    setOdiLevelFilter(p.odiLevelFilter ?? null);
    setOdiVizPalette(String(p.odiVizPalette ?? 'blueRed'));
    {
      const steps = Number(p.odiVizSteps);
      const s = Number.isFinite(steps) ? Math.max(3, Math.min(10, Math.round(steps))) : 5;
      setOdiVizSteps(s);
    }
    setOdiVizRange(p.odiVizRange ?? { min: '', max: '' });
    {
      const v = Number(p.aquiferOdiSmoothPasses);
      const s = Number.isFinite(v) ? Math.max(0, Math.min(6, Math.round(v))) : 2;
      setAquiferOdiSmoothPasses(s);
    }
    setShowBoundaryLabels(Boolean(p.showBoundaryLabels));
    setShowDrillholeLabels(Boolean(p.showDrillholeLabels));
    setShowWorkfaceOutline(Boolean(p.showWorkfaceOutline));
    setShowMeasuredPoints(p.showMeasuredPoints ?? true);
    setMiningHeight(Number(p.miningHeight));
    setStepLength(Number(p.stepLength));
    setRichFactor(Number(p.richFactor));
    setScenarioWeights(p.scenarioWeights);
    setSelectedCoal(String(p.selectedCoal ?? ''));
    setGeologyLayoutMode(String(p.geologyLayoutMode ?? '2x2'));
    setGeoPickA(String(p.geoPickA ?? 'Ti'));
    setGeoPickB(String(p.geoPickB ?? 'Hi'));
    setMapVizSettings(p.mapVizSettings);
    setMeasuredConstraintData(p.measuredConstraintData ?? []);
    setMeasuredConstraintLines(p.measuredConstraintLines ?? []);
    setSelectedMeasuredLineId(String(p.selectedMeasuredLineId ?? ''));
    setErrorAnalysisByLineId(p.errorAnalysisByLineId ?? {});
    setMeasuredZoningResultTracked(p.measuredZoningResult ?? null);
    setSelectedAquiferType(String(p.selectedAquiferType ?? ''));
  };

  const handleScenarioSelect = (nextId) => {
    if (!nextId || nextId === activeTab) return;
    const currentId = activeTab;
    const currentSnapshot = snapshotCurrentScenarioParams();
    const nextParams = scenarioParamsById?.[nextId] ?? scenarioDefaultsById?.[nextId];

    setScenarioParamsById((prev) => ({
      ...prev,
      [currentId]: cloneJson(currentSnapshot),
      [nextId]: prev?.[nextId] ? prev[nextId] : cloneJson(nextParams),
    }));

    applyScenarioParams(nextParams);
    setActiveTab(nextId);
  };

  // 全局：清空当前场景 / 撤回 / 前进一步（重做）
  const HISTORY_MAX = 30;
  const isRestoringRef = useRef(false);
  const historyPastRef = useRef([]);
  const historyFutureRef = useRef([]);
  const lastSnapshotRef = useRef(null);
  const lastHashRef = useRef('');
  const recordTimerRef = useRef(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoRef = useRef(() => {});
  const redoRef = useRef(() => {});

  const syncHistoryFlags = () => {
    setCanUndo(historyPastRef.current.length > 0);
    setCanRedo(historyFutureRef.current.length > 0);
  };

  const getAppSnapshot = () => {
    const currentScenario = snapshotCurrentScenarioParams();
    const scenarioParamsMerged = cloneJson(scenarioParamsById ?? {});
    scenarioParamsMerged[activeTab] = cloneJson(currentScenario);
    return {
      activeTab,
      mainViewMode,
      showMainMap,
      showMeasuredMapping,
      showErrorAnalysis,
      planningParams: cloneJson(planningParams),
      planningReverseSolutions: cloneJson(planningReverseSolutions),
      planningAdvanceAxis,
      plannedWorkfaceLoopsWorld: cloneJson(plannedWorkfaceLoopsWorld),
      plannedWorkfaceUnionLoopsWorld: cloneJson(plannedWorkfaceUnionLoopsWorld),
      showPlanningBoundaryOverlay,
      hasInitializedFaceWidthRange,
      planningPreStartSnapshot: cloneJson(planningPreStartSnapshot),
      scenarioParamsById: scenarioParamsMerged,
    };
  };

  const applyAppSnapshot = (snap) => {
    if (!snap) return;
    isRestoringRef.current = true;
    try {
      const tab = String(snap.activeTab ?? 'surface');
      const merged = snap.scenarioParamsById ?? {};
      const nextScenarioParams = merged?.[tab] ?? scenarioDefaultsById?.[tab];

      setMainViewMode(String(snap.mainViewMode ?? 'odi'));
      setShowMainMap(Boolean(snap.showMainMap));
      setShowMeasuredMapping(Boolean(snap.showMeasuredMapping));
      setShowErrorAnalysis(Boolean(snap.showErrorAnalysis));
      setPlanningParams(snap.planningParams ? cloneJson(snap.planningParams) : { ...DEFAULT_PLANNING_PARAMS });
      setPlanningReverseSolutions(snap.planningReverseSolutions ?? []);
      setPlanningAdvanceAxis(String(snap.planningAdvanceAxis ?? 'x') === 'y' ? 'y' : 'x');
      setPlannedWorkfaceLoopsWorld(snap.plannedWorkfaceLoopsWorld ?? []);
      setPlannedWorkfaceUnionLoopsWorld(snap.plannedWorkfaceUnionLoopsWorld ?? []);
      setShowPlanningBoundaryOverlay(Boolean(snap.showPlanningBoundaryOverlay));
      setHasInitializedFaceWidthRange(Boolean(snap.hasInitializedFaceWidthRange));
      setPlanningPreStartSnapshot(snap.planningPreStartSnapshot ? cloneJson(snap.planningPreStartSnapshot) : null);
      setScenarioParamsById(cloneJson(merged));
      applyScenarioParams(nextScenarioParams);
      setActiveTab(tab);
    } finally {
      // 让 React 完成本次恢复后再允许记录
      setTimeout(() => {
        isRestoringRef.current = false;
      }, 0);
    }
  };

  const pushHistoryFromCurrentTo = (nextSnap) => {
    const current = getAppSnapshot();
    historyPastRef.current.push(current);
    if (historyPastRef.current.length > HISTORY_MAX) historyPastRef.current.shift();
    historyFutureRef.current = [];
    syncHistoryFlags();
    lastSnapshotRef.current = nextSnap;
    try {
      lastHashRef.current = JSON.stringify(nextSnap);
    } catch {
      lastHashRef.current = '';
    }
  };

  const handleUndo = () => {
    if (!historyPastRef.current.length) return;
    const current = getAppSnapshot();
    const prev = historyPastRef.current.pop();
    historyFutureRef.current.push(current);
    syncHistoryFlags();
    applyAppSnapshot(prev);
    lastSnapshotRef.current = prev;
    try {
      lastHashRef.current = JSON.stringify(prev);
    } catch {
      lastHashRef.current = '';
    }
  };

  const handleRedo = () => {
    if (!historyFutureRef.current.length) return;
    const current = getAppSnapshot();
    const next = historyFutureRef.current.pop();
    historyPastRef.current.push(current);
    if (historyPastRef.current.length > HISTORY_MAX) historyPastRef.current.shift();
    syncHistoryFlags();
    applyAppSnapshot(next);
    lastSnapshotRef.current = next;
    try {
      lastHashRef.current = JSON.stringify(next);
    } catch {
      lastHashRef.current = '';
    }
  };

  useEffect(() => {
    undoRef.current = handleUndo;
    redoRef.current = handleRedo;
  });

  useEffect(() => {
    const isEditableTarget = (el) => {
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = String(el.tagName ?? '').toUpperCase();
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const onKeyDown = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (isEditableTarget(e.target)) return;

      const key = String(e.key ?? '').toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = key === 'y' || (key === 'z' && e.shiftKey);

      if (isUndo) {
        if (!historyPastRef.current.length) return;
        e.preventDefault();
        e.stopPropagation();
        undoRef.current();
      }

      if (isRedo) {
        if (!historyFutureRef.current.length) return;
        e.preventDefault();
        e.stopPropagation();
        redoRef.current();
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  const handleClearAll = () => {
    const current = getAppSnapshot();

    // 若当前已有“智能规划”产物，则优先回退到“启动智能规划”点击前的规划快照（只影响规划模块，不清空场景输入）
    const hasPlanningArtifacts = Boolean(
      current.showPlanningBoundaryOverlay
      || (Array.isArray(current.plannedWorkfaceLoopsWorld) && current.plannedWorkfaceLoopsWorld.length)
      || (Array.isArray(current.plannedWorkfaceUnionLoopsWorld) && current.plannedWorkfaceUnionLoopsWorld.length)
      || (Array.isArray(current.planningReverseSolutions) && current.planningReverseSolutions.length)
      || (!Array.isArray(current.planningReverseSolutions) && current.planningReverseSolutions)
      || current.hasInitializedFaceWidthRange
      || String(current?.planningParams?.faceCountSelected ?? '').trim()
      || String(current?.planningParams?.faceCountSuggestedMin ?? '').trim()
      || String(current?.planningParams?.faceCountSuggestedMax ?? '').trim()
    );

    if (hasPlanningArtifacts && planningPreStartSnapshot) {
      const nextSnap = {
        ...current,
        planningParams: cloneJson(planningPreStartSnapshot.planningParams ?? current.planningParams),
        planningReverseSolutions: cloneJson(planningPreStartSnapshot.planningReverseSolutions ?? current.planningReverseSolutions),
        planningAdvanceAxis: String(planningPreStartSnapshot.planningAdvanceAxis ?? current.planningAdvanceAxis ?? 'x') === 'y' ? 'y' : 'x',
        plannedWorkfaceLoopsWorld: cloneJson(planningPreStartSnapshot.plannedWorkfaceLoopsWorld ?? []),
        plannedWorkfaceUnionLoopsWorld: cloneJson(planningPreStartSnapshot.plannedWorkfaceUnionLoopsWorld ?? []),
        showPlanningBoundaryOverlay: Boolean(planningPreStartSnapshot.showPlanningBoundaryOverlay),
        hasInitializedFaceWidthRange: Boolean(planningPreStartSnapshot.hasInitializedFaceWidthRange),
        planningPreStartSnapshot: null,
      };
      pushHistoryFromCurrentTo(nextSnap);
      applyAppSnapshot(nextSnap);
      setPlanningPreStartSnapshot(null);
      setMeasureEnabled(false);
      setMeasurePoints([]);
      return;
    }

    const tab = String(current.activeTab ?? activeTab);
    const merged = cloneJson(current.scenarioParamsById ?? {});
    merged[tab] = cloneJson(scenarioDefaultsById?.[tab] ?? scenarioDefaultsById.surface);
    // 清空：同时重置智能规划模块，且支持撤回
    const nextSnap = {
      ...current,
      scenarioParamsById: merged,
      activeTab: tab,
      planningParams: { ...DEFAULT_PLANNING_PARAMS },
      planningReverseSolutions: [],
      planningAdvanceAxis: 'x',
      plannedWorkfaceLoopsWorld: [],
      plannedWorkfaceUnionLoopsWorld: [],
      showPlanningBoundaryOverlay: false,
      hasInitializedFaceWidthRange: false,
      planningPreStartSnapshot: null,
    };
    pushHistoryFromCurrentTo(nextSnap);
    applyAppSnapshot(nextSnap);
    setPlanningPreStartSnapshot(null);
    setMeasureEnabled(false);
    setMeasurePoints([]);
  };

  // 自动记录：把用户操作形成的状态变化纳入历史栈（防止每次输入都刷屏，做一个短暂 debounce）
  useEffect(() => {
    if (isRestoringRef.current) return;
    const snap = getAppSnapshot();
    let hash = '';
    try {
      hash = JSON.stringify(snap);
    } catch {
      return;
    }

    if (!lastHashRef.current) {
      lastHashRef.current = hash;
      lastSnapshotRef.current = snap;
      syncHistoryFlags();
      return;
    }

    if (hash === lastHashRef.current) return;
    if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
    recordTimerRef.current = setTimeout(() => {
      if (isRestoringRef.current) return;
      // 把“上一个稳定状态”入栈
      if (lastSnapshotRef.current) {
        historyPastRef.current.push(lastSnapshotRef.current);
        if (historyPastRef.current.length > HISTORY_MAX) historyPastRef.current.shift();
        historyFutureRef.current = [];
        syncHistoryFlags();
      }
      lastSnapshotRef.current = snap;
      lastHashRef.current = hash;
    }, 220);

    return () => {
      if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
    };
  }, [
    odiResult,
    activeTab,
    mainViewMode,
    showMainMap,
    showMeasuredMapping,
    showErrorAnalysis,
    planningParams,
    planningReverseSolutions,
    planningAdvanceAxis,
    plannedWorkfaceLoopsWorld,
    showPlanningBoundaryOverlay,
    hasInitializedFaceWidthRange,
    boundaryData,
    drillholeData,
    drillholeLayersById,
    selectedCoal,
    showBoundaryLabels,
    showDrillholeLabels,
    showWorkfaceOutline,
    miningHeight,
    stepLength,
    richFactor,
    scenarioWeights,
    geologyLayoutMode,
    geoPickA,
    geoPickB,
    mapVizSettings,
    measuredConstraintData,
    measuredZoningResult,
    aquiferOdiSmoothPasses,
    aquiferMineHeightByFace,
    aquiferSelectedFaceNo,
    aquiferRoofCavingAngleByFace,
    surfaceMineHeightByFace,
    surfaceSelectedFaceNo,
    surfaceRoofCavingAngleByFace,
    upwardMineHeightByFace,
    upwardSelectedFaceNo,
    upwardRoofCavingAngleByFace,
    scenarioParamsById,
  ]);

  const workingFaceDataTagged = useMemo(() => {
    // 约定：每 4 个点为 1 个工作面（No.1~No.n），依导入顺序编号
    const src = Array.isArray(workingFaceData) ? workingFaceData : [];
    return src.map((p, idx) => ({ ...p, faceIndex: Math.floor(idx / 4) + 1 }));
  }, [workingFaceData]);

  const workfaceCount = useMemo(() => {
    // 以导入工作面坐标数据为准：按 4 点一组判别工作面数量
    const n = Math.floor((workingFaceDataTagged?.length ?? 0) / 4);
    return Math.max(0, n);
  }, [workingFaceDataTagged]);

  const activeSelectedFaceNo = useMemo(() => {
    if (activeTab === 'surface') return surfaceSelectedFaceNo;
    if (activeTab === 'upward') return upwardSelectedFaceNo;
    return aquiferSelectedFaceNo;
  }, [activeTab, surfaceSelectedFaceNo, upwardSelectedFaceNo, aquiferSelectedFaceNo]);

  const setActiveSelectedFaceNo = (next) => {
    if (activeTab === 'surface') setSurfaceSelectedFaceNo(next);
    else if (activeTab === 'upward') setUpwardSelectedFaceNo(next);
    else setAquiferSelectedFaceNo(next);
  };

  const activeMineHeightByFace = useMemo(() => {
    if (activeTab === 'surface') return surfaceMineHeightByFace;
    if (activeTab === 'upward') return upwardMineHeightByFace;
    return aquiferMineHeightByFace;
  }, [activeTab, surfaceMineHeightByFace, upwardMineHeightByFace, aquiferMineHeightByFace]);

  const setActiveMineHeightByFace = (next) => {
    if (activeTab === 'surface') setSurfaceMineHeightByFace(next);
    else if (activeTab === 'upward') setUpwardMineHeightByFace(next);
    else setAquiferMineHeightByFace(next);
  };

  const activeRoofAngleByFace = useMemo(() => {
    if (activeTab === 'surface') return surfaceRoofCavingAngleByFace;
    if (activeTab === 'upward') return upwardRoofCavingAngleByFace;
    return aquiferRoofCavingAngleByFace;
  }, [activeTab, surfaceRoofCavingAngleByFace, upwardRoofCavingAngleByFace, aquiferRoofCavingAngleByFace]);

  const setActiveRoofAngleByFace = (next) => {
    if (activeTab === 'surface') setSurfaceRoofCavingAngleByFace(next);
    else if (activeTab === 'upward') setUpwardRoofCavingAngleByFace(next);
    else setAquiferRoofCavingAngleByFace(next);
  };

  useEffect(() => {
    if (!workfaceCount) {
      // 无工作面时，保持默认
      if (activeSelectedFaceNo !== 1) setActiveSelectedFaceNo(1);
      if ((activeMineHeightByFace?.length ?? 0) !== 0) setActiveMineHeightByFace([]);
      if ((activeRoofAngleByFace?.length ?? 0) !== 0) setActiveRoofAngleByFace([]);
      return;
    }

    // 选择项保持在 1..n
    if (activeSelectedFaceNo < 1 || activeSelectedFaceNo > workfaceCount) {
      setActiveSelectedFaceNo(1);
    }

    // 采高数组对齐 workfaceCount：缺失部分用当前 mineActualHeightM 兜底
    const cur = Array.isArray(activeMineHeightByFace) ? activeMineHeightByFace : [];
    if (cur.length !== workfaceCount) {
      const fallback = Number.isFinite(Number(mineActualHeightM)) ? Number(mineActualHeightM) : 4.5;
      const next = Array.from({ length: workfaceCount }, (_, i) => {
        const v = Number(cur[i]);
        return Number.isFinite(v) ? v : fallback;
      });
      setActiveMineHeightByFace(next);
    }

    // 顶板垮落角数组对齐 workfaceCount：缺失部分用当前 roofCavingAngleDeg 兜底
    const curD = Array.isArray(activeRoofAngleByFace) ? activeRoofAngleByFace : [];
    if (curD.length !== workfaceCount) {
      const fallbackD = Number.isFinite(Number(roofCavingAngleDeg)) ? Number(roofCavingAngleDeg) : 0;
      const nextD = Array.from({ length: workfaceCount }, (_, i) => {
        const v = Number(curD[i]);
        return Number.isFinite(v) ? v : fallbackD;
      });
      setActiveRoofAngleByFace(nextD);
    }
  }, [activeTab, workfaceCount, activeSelectedFaceNo, activeMineHeightByFace, activeRoofAngleByFace, mineActualHeightM, roofCavingAngleDeg]);

  const safeFileId = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const normalizeMinMax = (values, eps = 1e-12) => {
    const a = (Array.isArray(values) ? values : []).map((v) => Number(v)).filter(Number.isFinite);
    if (!a.length) return { min: 0, max: 1, norm: () => 0 };
    const min = Math.min(...a);
    const max = Math.max(...a);
    const span = max - min;
    if (!(span > eps)) return { min, max, norm: () => 0 };
    return { min, max, norm: (v) => (Number(v) - min) / span };
  };

  const getMeasuredValueLabelByScenario = (tab) => {
    if (tab === 'surface') return '实测地表下沉';
    if (tab === 'aquifer') return '实测严重破坏高度';
    return '实测值';
  };

  const buildErrorTrendForLine = (linePoints, lineId) => {
    const pts = Array.isArray(linePoints) ? linePoints : [];
    if (!pts.length) return { lineId, data: [], stats: null };

    // 实测值归一化（按测线）
    const measuredArr = pts.map((p) => Number(p?.measured)).filter(Number.isFinite);
    const measuredNormer = normalizeMinMax(measuredArr);

    // 采样 ODI：先按“文件/测线”提取 ODI 列，再在该文件内做 min-max 归一化
    // 注意：归一化前不做 clamp，避免压缩该文件内 ODI 取值范围；仅对归一化结果 clamp 到 [0,1]
    const odiSampledRaw = pts.map((p) => {
      const x = Number(p?.x);
      const y = Number(p?.y);
      const v = (Number.isFinite(x) && Number.isFinite(y) && odiFieldPack?.field)
        ? sampleFieldAtWorldXY(odiFieldPack, x, y)
        : null;
      return Number.isFinite(v) ? v : null;
    });
    const odiNormer = normalizeMinMax(odiSampledRaw.filter(Number.isFinite));

    const data = pts.map((p, idx) => {
      const id = String(p?.id ?? '').trim() || `P-${idx + 1}`;
      const x = Number(p?.x);
      const y = Number(p?.y);
      const measured = Number(p?.measured);
      const measuredNorm = Number.isFinite(measured) ? clamp(measuredNormer.norm(measured), 0, 1) : null;

      const odiRaw = odiSampledRaw[idx];
      const odiRenorm = Number.isFinite(odiRaw) ? clamp(odiNormer.norm(odiRaw), 0, 1) : null;

      // 误差：两个归一化值相减取绝对值（0~1），显示/导出时转成百分数
      const errorRatioRaw = (measuredNorm != null && odiRenorm != null)
        ? Math.abs(measuredNorm - odiRenorm)
        : null;
      const errorRatio = errorRatioRaw != null ? errorRatioRaw : null;
      const errorRatioChart = errorRatio != null ? clamp(errorRatio, 0, 1) : null;

      return {
        id,
        x: Number.isFinite(x) ? x : null,
        y: Number.isFinite(y) ? y : null,
        measured: Number.isFinite(measured) ? measured : null,
        measuredNorm,
        odiRenorm,
        errorRatio,
        errorRatioChart,
      };
    });

    const measuredMax = measuredArr.length ? Math.max(...measuredArr) : 0;
    return {
      lineId,
      data,
      stats: {
        measuredMin: measuredNormer.min,
        measuredMax: measuredNormer.max,
        measuredMaxAbs: measuredMax,
        odiMin: odiNormer.min,
        odiMax: odiNormer.max,
      },
    };
  };

  const parseBoundaryText = (text) => {
    const cleaned = String(text ?? '').replace(/^\uFEFF/, '');
    const lines = cleaned.split(/\r?\n/);
    const points = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(/[\s,]+/).filter(Boolean);
      if (parts.length < 3) continue;

      const id = String(parts[0]).trim();
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      if (!id || Number.isNaN(x) || Number.isNaN(y)) continue;

      points.push({ id, x, y });
    }

    return points;
  };

  const parseWorkingFaceText = (text) => {
    const cleaned = String(text ?? '').replace(/^\uFEFF/, '');
    const lines = cleaned.split(/\r?\n/);
    const points = [];
    let autoId = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(/[\t,，\s]+/).filter(Boolean);
      if (parts.length < 2) continue;

      let id = '';
      let x = NaN;
      let y = NaN;
      if (parts.length >= 3) {
        id = String(parts[0]).trim();
        x = Number(parts[1]);
        y = Number(parts[2]);
      } else {
        id = `WF-${autoId++}`;
        x = Number(parts[0]);
        y = Number(parts[1]);
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ id: id || `WF-${autoId++}`, x, y });
    }
    return points;
  };

  const parseMeasuredConstraintText = (text, fallbackFileId = '') => {
    // 期望格式：测点ID，坐标x，坐标y，实测值
    // 支持：英文逗号/中文逗号/制表符/空格混合分隔；允许第一行为表头
    const cleaned = String(text ?? '').replace(/^[\uFEFF\s]+/, '');
    const lines = cleaned.split(/\r?\n/);
    const rows = [];
    let autoId = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = String(lines[i] ?? '').trim();
      if (!line) continue;
      const parts = line.split(/[\t,，\s]+/).filter(Boolean);
      if (parts.length < 4) continue;

      const idRaw = String(parts[0] ?? '').trim();
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const measured = Number(parts[3]);
      // 跳过可能的表头
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(measured)) continue;
      const id = idRaw || `${fallbackFileId || 'MP'}-${autoId++}`;
      rows.push({ id, x, y, measured, fileId: fallbackFileId || '' });
    }

    return rows;
  };

  const splitIntoFiveGroups = (sortedArr) => {
    const arr = Array.isArray(sortedArr) ? sortedArr : [];
    const n = arr.length;
    if (n === 0) return [[], [], [], [], []];
    const base = Math.floor(n / 5);
    const rem = n % 5;
    const sizes = Array.from({ length: 5 }, (_, i) => base + (i < rem ? 1 : 0));
    const groups = [];
    let idx = 0;
    for (const sz of sizes) {
      groups.push(arr.slice(idx, idx + sz));
      idx += sz;
    }
    return groups;
  };

  const buildEqualValueBins5 = (minV, maxV) => {
    const lo = Number(minV);
    const hi = Number(maxV);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    if (!(hi > lo)) return null;
    const step = (hi - lo) / 5;
    const edges = [lo];
    for (let k = 1; k < 5; k++) edges.push(lo + step * k);
    edges.push(hi);
    return edges; // length=6
  };

  const assignGradeByEdges5 = (value, edges) => {
    const v = Number(value);
    const e = edges ?? [];
    if (!Number.isFinite(v) || e.length !== 6) return null;
    // I:[e0,e1]  II:(e1,e2]  III:(e2,e3]  IV:(e3,e4]  V:(e4,e5]
    if (v <= e[1]) return 1;
    if (v <= e[2]) return 2;
    if (v <= e[3]) return 3;
    if (v <= e[4]) return 4;
    return 5;
  };
  const finiteNumbers = (arr) => (Array.isArray(arr) ? arr.filter(Number.isFinite) : []);
  const minOf = (arr) => {
    const a = finiteNumbers(arr);
    return a.length ? Math.min(...a) : null;
  };
  const maxOf = (arr) => {
    const a = finiteNumbers(arr);
    return a.length ? Math.max(...a) : null;
  };
  const percentile = (arr, p = 0.5) => {
    const a = finiteNumbers(arr).sort((x, y) => x - y);
    if (!a.length) return null;
    const t = Math.min(1, Math.max(0, p));
    const idx = (a.length - 1) * t;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return a[lo];
    const w = idx - lo;
    return a[lo] * (1 - w) + a[hi] * w;
  };

  const classifyByOdiThresholds = (odiArr, T) => {
    const t = (T ?? []).map((x) => Number(x)).filter(Number.isFinite);
    if (t.length !== 4) return (odiArr ?? []).map(() => 1);
    const [T1, T2, T3, T4] = t;
    return (odiArr ?? []).map((odi) => {
      const v = Number(odi);
      if (!Number.isFinite(v)) return 1;
      if (v > T4) return 5;
      if (v > T3) return 4;
      if (v > T2) return 3;
      if (v > T1) return 2;
      return 1;
    });
  };

  const enforceMinGapThresholds = (T, epsGap = 1e-3, lb = 0, ub = 1) => {
    const t = (T ?? []).map((x) => clamp(Number(x), lb, ub));
    if (t.length !== 4) return [0.2, 0.4, 0.6, 0.8];

    for (let k = 1; k < 4; k++) {
      if (!(t[k] > t[k - 1] + epsGap)) {
        t[k] = t[k - 1] + epsGap;
      }
    }

    if (t[3] > ub) {
      t[3] = ub;
      for (let k = 2; k >= 0; k--) {
        if (!(t[k] < t[k + 1] - epsGap)) {
          t[k] = t[k + 1] - epsGap;
        }
      }
    }

    for (let k = 0; k < 4; k++) {
      t[k] = clamp(t[k], lb, ub);
    }
    return t;
  };

  const pickThresholdAtBoundary = (sortedValues, leftEndIdx, eps = 1e-6) => {
    // 边界在 [leftEndIdx] 与 [leftEndIdx+1] 之间，尽量取“相邻不同值”的中点
    const vals = sortedValues ?? [];
    const n = vals.length;
    if (n < 2) return 0.5;
    const i = Math.max(0, Math.min(n - 2, leftEndIdx));
    const leftVal = Number(vals[i]);
    if (!Number.isFinite(leftVal)) return 0.5;

    let rightVal = null;
    for (let j = i + 1; j < n; j++) {
      const v = Number(vals[j]);
      if (Number.isFinite(v) && v > leftVal) {
        rightVal = v;
        break;
      }
    }
    if (rightVal != null) return (leftVal + rightVal) / 2;

    let prevVal = null;
    for (let j = i; j >= 0; j--) {
      const v = Number(vals[j]);
      if (Number.isFinite(v) && v < leftVal) {
        prevVal = v;
        break;
      }
    }
    if (prevVal != null) return (prevVal + leftVal) / 2;
    return clamp(leftVal + eps, 0, 1);
  };

  const computeOptimalOdiThresholdsDP = (rowsWithOdiAndGrade, epsGap = 1e-3) => {
    // rows: { odi:0..1, G:1..5 }
    const rows = (rowsWithOdiAndGrade ?? [])
      .map((r) => ({ odi: Number(r?.odi), G: Number(r?.G) }))
      .filter((r) => Number.isFinite(r.odi) && r.odi >= 0 && r.odi <= 1 && Number.isFinite(r.G) && r.G >= 1 && r.G <= 5)
      .sort((a, b) => a.odi - b.odi);
    const N = rows.length;
    if (N < 5) return null;

    const odiSorted = rows.map((r) => r.odi);
    const Gsorted = rows.map((r) => r.G);

    const prefixG = new Array(N + 1).fill(0);
    const prefixG2 = new Array(N + 1).fill(0);
    for (let i = 0; i < N; i++) {
      prefixG[i + 1] = prefixG[i] + Gsorted[i];
      prefixG2[i + 1] = prefixG2[i] + Gsorted[i] * Gsorted[i];
    }

    const cost = (l, r, grade) => {
      // inclusive [l,r]
      const n = r - l + 1;
      const sumG = prefixG[r + 1] - prefixG[l];
      const sumG2 = prefixG2[r + 1] - prefixG2[l];
      return sumG2 - 2 * grade * sumG + grade * grade * n;
    };

    const K = 5;
    const INF = 1e30;
    const dp = Array.from({ length: K + 1 }, () => new Array(N + 1).fill(INF));
    const prev = Array.from({ length: K + 1 }, () => new Array(N + 1).fill(-1));
    dp[0][0] = 0;

    for (let s = 1; s <= K; s++) {
      for (let i = s; i <= N; i++) {
        // last segment is [p, i-1]
        let best = INF;
        let bestP = -1;
        for (let p = s - 1; p <= i - 1; p++) {
          const cand = dp[s - 1][p] + cost(p, i - 1, s);
          if (cand < best) {
            best = cand;
            bestP = p;
          }
        }
        dp[s][i] = best;
        prev[s][i] = bestP;
      }
    }

    if (!Number.isFinite(dp[K][N])) return null;

    // backtrack cut positions (segment ends)
    let i = N;
    const ends = new Array(K).fill(-1); // end index inclusive for segment s (1..K)
    for (let s = K; s >= 1; s--) {
      const p = prev[s][i];
      if (p < 0) return null;
      ends[s - 1] = i - 1;
      i = p;
    }
    // segment s is [start_s .. ends[s-1]] where start_s = (s==1?0:ends[s-2]+1)
    const end1 = ends[0];
    const end2 = ends[1];
    const end3 = ends[2];
    const end4 = ends[3];
    if (![end1, end2, end3, end4].every((x) => Number.isInteger(x) && x >= 0 && x < N - 1)) {
      return null;
    }

    let T1 = pickThresholdAtBoundary(odiSorted, end1);
    let T2 = pickThresholdAtBoundary(odiSorted, end2);
    let T3 = pickThresholdAtBoundary(odiSorted, end3);
    let T4 = pickThresholdAtBoundary(odiSorted, end4);
    const T = enforceMinGapThresholds([T1, T2, T3, T4], epsGap, 0, 1);
    [T1, T2, T3, T4] = T;

    const Ghat = classifyByOdiThresholds(odiSorted, T);
    let correct = 0;
    let mse = 0;
    const confusion = Array.from({ length: 5 }, () => new Array(5).fill(0));
    for (let idx = 0; idx < N; idx++) {
      const g = Gsorted[idx];
      const gh = Ghat[idx];
      if (g === gh) correct++;
      const d = (gh - g);
      mse += d * d;
      const r = Math.max(1, Math.min(5, g)) - 1;
      const c = Math.max(1, Math.min(5, gh)) - 1;
      confusion[r][c] += 1;
    }
    const acc = correct / N;
    const rmse = Math.sqrt(mse / N);

    return {
      T,
      acc,
      rmse,
      J: dp[K][N],
      confusion,
    };
  };

  const computeMeasuredZoningSurface = (odiFieldPackForZoning, measuredConstraintRows, epsGap = 1e-3, options = {}) => {
    if (!odiFieldPackForZoning?.field) {
      return { ok: false, message: '请先完成 ODI 计算并生成 ODI 分布场。' };
    }
    const rowsIn = Array.isArray(measuredConstraintRows) ? measuredConstraintRows : [];
    if (!rowsIn.length) {
      return { ok: false, message: '请先导入“实测约束数据”。' };
    }

    const scenario = String(options?.scenario ?? 'surface');

    const assignGradeByOdiThresholds = (odiNorm, T) => {
      const v = Number(odiNorm);
      const t = (T ?? []).map((x) => Number(x));
      if (!Number.isFinite(v) || t.length !== 4 || t.some((x) => !Number.isFinite(x))) return null;
      const [T1, T2, T3, T4] = t;
      // I:[0,T1)  II:[T1,T2)  III:[T2,T3)  IV:[T3,T4)  V:[T4,1]
      if (v < T1) return 1;
      if (v < T2) return 2;
      if (v < T3) return 3;
      if (v < T4) return 4;
      return 5;
    };

    // A) 预处理实测值（数量门槛）
    const measuredAll = rowsIn.map((r) => Number(r?.measured)).filter(Number.isFinite);
    if (measuredAll.length < 5) {
      return { ok: false, message: '实测点数量过少（至少需要 5 个）。' };
    }
    const measuredMinAll = Math.min(...measuredAll);
    const measuredMaxAll = Math.max(...measuredAll);

    // B) 在每个实测点位置提取 ODI
    const sampled = rowsIn
      .map((r) => {
        const x = Number(r?.x);
        const y = Number(r?.y);
        const measured = Number(r?.measured);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(measured)) return null;
        const odi = sampleFieldAtWorldXY(odiFieldPackForZoning, x, y);
        return {
          id: String(r?.id ?? '').trim(),
          x,
          y,
          measured,
          odi,
        };
      })
      .filter(Boolean);

    const valid = sampled.filter((r) => Number.isFinite(r.odi));
    if (valid.length < 5) {
      return {
        ok: false,
        message: '实测点可用于提取 ODI 的数量不足（需要至少 5 个有效点）。\n提示：请检查实测点是否落在 ODI 评价范围内。',
      };
    }

    // ODI 原本即 0~1 归一化，直接使用不再重新缩放
    const validWithNorm = valid.map((r) => ({ ...r, odiNorm: clamp(r.odi, 0, 1) }));

    // C) 分级与阈值：surface 与 aquifer 采用不同规则
    if (scenario === 'aquifer') {
      // 含水层扰动等级：固定 ODI 五级区间
      // Ⅰ: [0,0.40) Ⅱ:[0.40,0.65) Ⅲ:[0.65,0.85) Ⅳ:[0.85,0.90) Ⅴ:[0.90,1]
      const T = enforceMinGapThresholds([0.40, 0.65, 0.85, 0.90], epsGap, 0, 1);
      if (!T || T.length !== 4 || T.some((v) => !Number.isFinite(v))) {
        return { ok: false, message: '阈值配置错误：请检查 ODI 分级边界。' };
      }
      const [T1, T2, T3, T4] = T;

      const withGrade = validWithNorm
        .map((r) => ({ ...r, G: assignGradeByOdiThresholds(r.odiNorm, T) }))
        .filter((r) => Number.isFinite(r.G) && r.G >= 1 && r.G <= 5);

      const measuredByGrade = Array.from({ length: 5 }, () => []);
      const odiByGrade = Array.from({ length: 5 }, () => []);
      for (const r of withGrade) {
        const idx = r.G - 1;
        measuredByGrade[idx].push(r.measured);
        odiByGrade[idx].push(r.odiNorm);
      }

      const measuredStats = Array.from({ length: 5 }, (_, i) => ({
        measuredMin: minOf(measuredByGrade[i]),
        measuredMax: maxOf(measuredByGrade[i]),
        measuredCount: measuredByGrade[i].length,
        odiNormMin: minOf(odiByGrade[i]),
        odiNormMax: maxOf(odiByGrade[i]),
      }));

      const odiRanges = [
        { odiLo: 0, odiHi: T1 },
        { odiLo: T1, odiHi: T2 },
        { odiLo: T2, odiHi: T3 },
        { odiLo: T3, odiHi: T4 },
        { odiLo: T4, odiHi: 1 },
      ].map((r, idx) => {
        let lo = clamp(Number(r.odiLo), 0, 1);
        let hi = clamp(Number(r.odiHi), 0, 1);
        if (!(hi > lo)) {
          const eps = 1e-6;
          hi = clamp(lo + eps, 0, 1);
        }
        if (idx === 4) hi = 1;
        return { odiLo: lo, odiHi: hi };
      });

      const bins = Array.from({ length: 5 }, (_, i) => ({
        levelIndex: i,
        measuredMin: measuredStats[i].measuredMin,
        measuredMax: measuredStats[i].measuredMax,
        measuredCount: measuredStats[i].measuredCount,
        odiLo: odiRanges[i].odiLo,
        odiHi: odiRanges[i].odiHi,
        odiNormMin: measuredStats[i].odiNormMin,
        odiNormMax: measuredStats[i].odiNormMax,
      }));

      return {
        ok: true,
        result: {
          thresholds: { T1, T2, T3, T4, epsGap },
          fit: null,
          bins,
          measuredEdges: null,
          sampledCount: sampled.length,
          validOdiCount: withGrade.length,
          odiSample: withGrade,
        },
      };
    }

    // surface：沿用原逻辑（实测下沉分级 + 固定 ODI 阈值）
    const measuredEdges = [
      Math.min(0, measuredMinAll),
      0.30,
      1.20,
      2.80,
      4.20,
      Math.max(measuredMaxAll, 4.20),
    ];

    const validWithGrade = validWithNorm
      .map((r) => ({ ...r, G: assignGradeByEdges5(r.measured, measuredEdges) }))
      .filter((r) => Number.isFinite(r.G) && r.G >= 1 && r.G <= 5);

    if (validWithGrade.length < 5) {
      return {
        ok: false,
        message: '实测点可用于分级的数量不足（需要至少 5 个有效点）。\n提示：请检查实测值是否为有效数值。',
      };
    }

    // C) 按测点分级分布反推 4 个 ODI 归一化临界值
    const odiByGrade = Array.from({ length: 5 }, () => []);
    for (const r of validWithGrade) {
      const idx = Math.max(1, Math.min(5, r.G)) - 1;
      odiByGrade[idx].push(r.odiNorm);
    }

    // 采用业务指定的 ODI 分级临界值（无需再次拟合）
    const T = enforceMinGapThresholds([0.045, 0.345, 0.825, 0.847], epsGap, 0, 1);
    if (!T || T.length !== 4 || T.some((v) => !Number.isFinite(v))) {
      return { ok: false, message: '阈值配置错误：请检查 ODI 分级边界。' };
    }
    const [T1, T2, T3, T4] = T;

    const measuredStats = Array.from({ length: 5 }, (_, i) => ({
      measuredMin: measuredEdges[i],
      measuredMax: measuredEdges[i + 1],
      measuredCount: validWithNorm.filter((r) => r.G === i + 1).length,
      odiNormMin: minOf(odiByGrade[i]),
      odiNormMax: maxOf(odiByGrade[i]),
    }));

    const odiRanges = [
      { odiLo: 0, odiHi: T1 },
      { odiLo: T1, odiHi: T2 },
      { odiLo: T2, odiHi: T3 },
      { odiLo: T3, odiHi: T4 },
      { odiLo: T4, odiHi: 1 },
    ].map((r, idx) => {
      let lo = clamp(Number(r.odiLo), 0, 1);
      let hi = clamp(Number(r.odiHi), 0, 1);
      if (!(hi > lo)) {
        const eps = 1e-6;
        hi = clamp(lo + eps, 0, 1);
      }
      if (idx === 4) hi = 1;
      return { odiLo: lo, odiHi: hi };
    });

    const bins = Array.from({ length: 5 }, (_, i) => ({
      levelIndex: i,
      measuredMin: measuredStats[i].measuredMin,
      measuredMax: measuredStats[i].measuredMax,
      measuredCount: measuredStats[i].measuredCount,
      odiLo: odiRanges[i].odiLo,
      odiHi: odiRanges[i].odiHi,
      odiNormMin: measuredStats[i].odiNormMin,
      odiNormMax: measuredStats[i].odiNormMax,
    }));

    return {
      ok: true,
      result: {
        thresholds: { T1, T2, T3, T4, epsGap },
        fit: null,
        bins,
        measuredEdges,
        sampledCount: sampled.length,
        validOdiCount: validWithGrade.length,
        odiSample: validWithGrade,
      },
    };
  };

  const medianOfNumbers = (nums) => {
    const a = (nums ?? []).filter(Number.isFinite).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    if (a.length % 2 === 1) return a[m];
    return (a[m - 1] + a[m]) / 2;
  };

  const dist2 = (a, b) => {
    const dx = (a.x - b.x);
    const dy = (a.y - b.y);
    return dx * dx + dy * dy;
  };

  const dist = (a, b) => Math.sqrt(dist2(a, b));

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const polygonContainsPoint = (poly, p) => {
    // 射线法；poly 为按顺/逆时针排序的顶点数组
    const pts = poly ?? [];
    if (pts.length < 3) return false;
    const x = p?.x;
    const y = p?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x;
      const yi = pts[i].y;
      const xj = pts[j].x;
      const yj = pts[j].y;
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const distPointToSegment = (p, a, b) => {
    // 返回点到线段的最小距离
    const px = p?.x;
    const py = p?.y;
    const ax = a?.x;
    const ay = a?.y;
    const bx = b?.x;
    const by = b?.y;
    if (![px, py, ax, ay, bx, by].every(Number.isFinite)) return Infinity;
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    if (ab2 <= 1e-12) return Math.sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
    const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  };

  const minDistToPolyEdges = (p, corners) => {
    const c = corners ?? [];
    if (c.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      best = Math.min(best, distPointToSegment(p, a, b));
    }
    return best;
  };

  const getWorkfaceCenterline = (corners) => {
    // 取四边中最短的两条边，连其中心作为中线（长轴方向）
    const c = corners ?? [];
    if (c.length !== 4) return null;
    const edges = [
      { i: 0, j: 1, len: dist(c[0], c[1]) },
      { i: 1, j: 2, len: dist(c[1], c[2]) },
      { i: 2, j: 3, len: dist(c[2], c[3]) },
      { i: 3, j: 0, len: dist(c[3], c[0]) },
    ].filter((e) => Number.isFinite(e.len));
    if (edges.length < 4) return null;
    const sorted = [...edges].sort((a, b) => a.len - b.len);
    const e1 = sorted[0];
    const e2 = sorted[1];
    const m1 = { x: (c[e1.i].x + c[e1.j].x) / 2, y: (c[e1.i].y + c[e1.j].y) / 2 };
    const m2 = { x: (c[e2.i].x + c[e2.j].x) / 2, y: (c[e2.i].y + c[e2.j].y) / 2 };
    return { a: m1, b: m2 };
  };

  const normalizeVec = (v) => {
    const len = Math.sqrt(v.x * v.x + v.y * v.y) || 1;
    return { x: v.x / len, y: v.y / len };
  };

  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (v, k) => ({ x: v.x * k, y: v.y * k });
  const dot = (a, b) => a.x * b.x + a.y * b.y;

  const sortQuadByAngle = (pts) => {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return [...pts].sort((p1, p2) => {
      const a1 = Math.atan2(p1.y - cy, p1.x - cx);
      const a2 = Math.atan2(p2.y - cy, p2.x - cx);
      return a1 - a2;
    });
  };

  const getRectBasisFromQuad = (quad) => {
    if (!quad || quad.length !== 4) return null;
    const q = sortQuadByAngle(quad);
    const edges = [
      { i: 0, j: 1, len: dist(q[0], q[1]) },
      { i: 1, j: 2, len: dist(q[1], q[2]) },
      { i: 2, j: 3, len: dist(q[2], q[3]) },
      { i: 3, j: 0, len: dist(q[3], q[0]) },
    ];
    const sorted = [...edges].sort((a, b) => a.len - b.len);
    const shortLen = sorted[0].len;
    const longLen = sorted[3].len;

    // 选择一条长边作为 u 方向
    const longEdge = edges.reduce((best, e) => (e.len > best.len ? e : best), edges[0]);
    const p0 = q[longEdge.i];
    const p1 = q[longEdge.j];
    let u = normalizeVec(sub(p1, p0));

    // 找到 p0 的相邻点中另一点，用于确定 v 方向（指向矩形内部）
    const neighborIdx = (longEdge.i + 3) % 4; // p0 的另一个相邻点（不是 p1 那个）
    const p3 = q[neighborIdx];
    let vRaw = sub(p3, p0);
    // 去除 u 分量得到近似垂直方向
    vRaw = sub(vRaw, mul(u, dot(vRaw, u)));
    let v = normalizeVec(vRaw);

    // 确保 v 指向 q 的中心（而不是外侧）
    const center = {
      x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
      y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
    };
    const toC = sub(center, p0);
    if (dot(toC, v) < 0) v = mul(v, -1);

    // 以 p0 为原点构造四角（近似正交）
    const L = longLen;
    const W = shortLen;
    const c0 = p0;
    const c1 = add(p0, mul(u, L));
    const c3 = add(p0, mul(v, W));
    const c2 = add(c1, mul(v, W));
    return { corners: [c0, c1, c2, c3], u, v, L, W, shortLen: W, longLen: L };
  };

  const generateBilateralPositions = (len, step) => {
    const L = Number(len);
    const s = Math.max(1e-6, Number(step));
    if (!Number.isFinite(L) || !Number.isFinite(s) || L <= 0) return [0];
    const eps = 1e-6;
    const pos = new Set([0, L]);
    let left = 0;
    let right = L;
    while (true) {
      const nl = left + s;
      const nr = right - s;
      if (nr < nl - eps) break;
      const gap = nr - nl;

      if (gap > 2 * s + eps) {
        pos.add(nl);
        pos.add(nr);
        left = nl;
        right = nr;
        continue;
      }

      if (Math.abs(gap - 2 * s) <= eps) {
        pos.add(nl);
        pos.add(nr);
        pos.add((nl + nr) / 2);
        break;
      }

      if (gap > s + eps && gap < 2 * s - eps) {
        pos.add(nl);
        pos.add(nr);
        break;
      }

      // gap <= s：避免过密；若能落在同一点则补一个
      if (Math.abs(gap) <= eps) pos.add(nl);
      break;
    }

    return Array.from(pos)
      .filter((x) => Number.isFinite(x) && x >= -eps && x <= L + eps)
      .sort((a, b) => a - b);
  };

  const projectLocalToWorld = (origin, u, v, uu, vv) => add(origin, add(mul(u, uu), mul(v, vv)));

  const computeEvalBoundaryRectFromDrillholes = (points) => {
    if (!points?.length) return [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return [];
    return [
      { id: 'BND-1', x: minX, y: minY },
      { id: 'BND-2', x: maxX, y: minY },
      { id: 'BND-3', x: maxX, y: maxY },
      { id: 'BND-4', x: minX, y: maxY },
    ];
  };

  const buildWorkfacePointSets = ({ workingFacePoints, step }) => {
    // 参考 MATLAB：
    // - 边线控制点（BJ）：对 4 条边分别按 floor(edge_len/step) 生成
    // - 中线控制点（ZX）：按 long_dir/half_short/valid_len 生成
    const faces = [];
    const pink = [];
    const green = [];
    const red = [];
    const s = Math.max(1e-6, Number(step));

    const pts = (workingFacePoints ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const keyOf = (p) => `${Number(p.x).toFixed(3)}|${Number(p.y).toFixed(3)}`;
    const uniqueByXY = (arr) => {
      const m = new Map();
      for (const p of arr) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const k = keyOf(p);
        if (!m.has(k)) m.set(k, p);
      }
      return Array.from(m.values());
    };
    const isNearAny = (p, corners, eps = 1e-3) => {
      const e2 = eps * eps;
      for (const c of corners) {
        if (dist2(p, c) <= e2) return true;
      }
      return false;
    };
    const lerp2 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

    for (let i = 0; i + 3 < pts.length; i += 4) {
      const BJ1 = pts[i + 0];
      const BJ2 = pts[i + 1];
      const BJ3 = pts[i + 2];
      const BJ4 = pts[i + 3];

      const len12 = dist(BJ1, BJ2);
      const len23 = dist(BJ2, BJ3);
      if (!Number.isFinite(len12) || !Number.isFinite(len23)) continue;

      let longDir = { x: 0, y: 0 };
      let shortLen = 0;
      let midP1 = { x: 0, y: 0 };
      let midP2 = { x: 0, y: 0 };

      if (len12 >= len23) {
        longDir = normalizeVec(sub(BJ2, BJ1));
        shortLen = dist(BJ1, BJ4);
        midP1 = mul(add(BJ1, BJ4), 0.5);
        midP2 = mul(add(BJ2, BJ3), 0.5);
      } else {
        longDir = normalizeVec(sub(BJ3, BJ2));
        shortLen = dist(BJ1, BJ2);
        midP1 = mul(add(BJ1, BJ2), 0.5);
        midP2 = mul(add(BJ4, BJ3), 0.5);
      }

      if (!Number.isFinite(shortLen) || !(shortLen > 80)) continue;
      const faceIndex = faces.length + 1;
      const cornersRaw = [BJ1, BJ2, BJ3, BJ4];
      const corners = sortQuadByAngle(cornersRaw);
      const centroid = {
        x: corners.reduce((s0, p) => s0 + p.x, 0) / corners.length,
        y: corners.reduce((s0, p) => s0 + p.y, 0) / corners.length,
      };
      faces.push({ faceIndex, corners, cornersRaw, shortLen, centroid });

      // 工作面定位控制点：4 个角点（粉色）
      cornersRaw.forEach((c, idx) => {
        pink.push({ id: `WF-${faceIndex}-LOC${idx + 1}`, x: c.x, y: c.y, faceIndex });
      });

      // ================= 3. 边界控制点（仅边线） =================
      const boundaryPts = [];
      const edges = [
        [BJ1, BJ2],
        [BJ2, BJ3],
        [BJ3, BJ4],
        [BJ4, BJ1],
      ];

      for (let eIdx = 0; eIdx < edges.length; eIdx++) {
        const P1 = edges[eIdx][0];
        const P2 = edges[eIdx][1];
        const edgeLen = dist(P1, P2);
        if (!Number.isFinite(edgeLen)) continue;
        let npt = Math.floor(edgeLen / s);
        if (npt < 1) npt = 1;
        for (let k = 0; k <= npt; k++) {
          const t = k / npt;
          boundaryPts.push(lerp2(P1, P2, t));
        }
      }

      const boundaryUnique = uniqueByXY(boundaryPts)
        .filter((p) => !isNearAny(p, corners, 1e-3))
        .map((p, idx) => ({ id: `WF-${faceIndex}-BJ${idx + 1}`, x: p.x, y: p.y, faceIndex }));
      green.push(...boundaryUnique);

      // ================= 4. 中线控制点（ZX 编号） =================
      const halfShort = shortLen / 2;
      const midLen = dist(midP2, midP1);
      const validLen = midLen - 2 * halfShort;
      if (Number.isFinite(validLen) && validLen >= 0) {
        const startPt = add(midP1, mul(longDir, halfShort));
        const nMid = Math.floor(validLen / s);
        const centerPts = [];
        for (let k = 0; k <= nMid; k++) {
          const p = add(startPt, mul(longDir, k * s));
          centerPts.push(p);
        }
        const centerUnique = uniqueByXY(centerPts)
          .map((p, idx) => ({ id: `WF-${faceIndex}-ZX${idx + 1}`, x: p.x, y: p.y, faceIndex }));
        red.push(...centerUnique);
      }
    }

    return { faces, pink, green, red };
  };

  const handleWorkingFaceImportClick = () => {
    workingFaceFileInputRef.current?.click();
  };

  const handleWorkingFaceFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const points = parseWorkingFaceText(text);
      setWorkingFaceData(points);
      setActiveSelectedFaceNo(1);
      setActiveMineHeightByFace([]);
      setActiveRoofAngleByFace([]);
      // 新导入后默认清掉旧生成结果
      setGeneratedPoints(null);
      setParamExtractionResult(null);
      setOdiResult(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleGeneratePoints = () => {
    if (!drillholeData?.length) {
      console.warn('生成评价点需要先导入钻孔坐标数据');
      return;
    }
    if (!workingFaceData?.length) {
      console.warn('生成评价点需要先导入工作面坐标数据');
      return;
    }

    const evalBoundary = computeEvalBoundaryRectFromDrillholes(drillholeData);
    const miningBoundaryCtrl = boundaryData ?? [];
    const wfSets = buildWorkfacePointSets({ workingFacePoints: workingFaceData, step: stepLength });

    const gray = evalBoundary.map((p, idx) => ({ ...p, id: p.id || `BND-${idx + 1}` }));
    const blue = (miningBoundaryCtrl ?? []).map((p, idx) => ({ ...p, id: p.id || `AREA-${idx + 1}` }));
    const pink = wfSets.pink;
    const green = wfSets.green;
    const red = wfSets.red;

    const total = gray.length + blue.length + pink.length + green.length + red.length;
    setGeneratedPoints({
      gray,
      blue,
      pink,
      green,
      red,
      faceCount: wfSets.faces.length,
      faces: wfSets.faces,
      totalPoints: total,
    });
    // 点位重新生成后，参数提取结果需要重新计算
    setParamExtractionResult(null);
    setOdiResult(null);
  };

  const parseStratificationText = (text) => {
    const cleaned = String(text ?? '').replace(/^\uFEFF/, '');
    const lines = cleaned.split(/\r?\n/);
    const layers = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw) continue;

      // 支持：逗号/制表符/空格/中文逗号
      // 注意：CSV 里可能存在空列（例如：",,"），不能用 filter(Boolean) 否则会导致列错位。
      let parts = [];
      if (raw.includes(',') || raw.includes('，')) {
        parts = raw
          .replace(/，/g, ',')
          .split(',')
          .map((s) => String(s ?? '').trim());
      } else if (raw.includes('\t')) {
        parts = raw.split('\t').map((s) => String(s ?? '').trim());
      } else {
        parts = raw.split(/\s+/).map((s) => String(s ?? '').trim());
      }
      if (parts.length < 3) continue;

      const seq = Number(parts[0]);
      const name = String(parts[1] ?? '').trim();
      const thickness = Number(parts[2]);
      if (!name || Number.isNaN(thickness)) continue;

      // 新格式扩展列：含水层标记、关键层标记
      const aquiferTag = String(parts[3] ?? '').trim();
      // 若出现多余列，关键层标记把剩余内容拼回，避免偶发分隔符干扰
      const keyLayerTag = String((parts.length > 5 ? parts.slice(4).join(',') : parts[4]) ?? '').trim();

      layers.push({
        // 注意：序号仅作为记录字段；层序以“导入行序”为准（从上到下：地表→深部）
        seq: Number.isNaN(seq) ? null : seq,
        name,
        thickness,
        aquiferTag,
        keyLayerTag,
      });
    }
    return layers;
  };

  const inferElasticModulus = (name) => {
    const n = String(name ?? '');
    if (n.includes('砂岩')) return 25;
    if (n.includes('泥岩')) return 12;
    if (n.includes('粉砂岩')) return 20;
    if (n.includes('页岩')) return 15;
    if (n.includes('灰岩')) return 40;
    if (n.includes('煤')) return 6;
    return 18;
  };

  const coalSeams = useMemo(() => {
    const set = new Set();
    for (const layers of Object.values(drillholeLayersById ?? {})) {
      for (const layer of layers ?? []) {
        const name = String(layer?.name ?? '').trim();
        if (name && name.includes('煤')) set.add(name);
      }
    }
    return Array.from(set);
  }, [drillholeLayersById]);

  const aquiferTypeOptions = useMemo(() => {
    const set = new Set();
    for (const layers of Object.values(drillholeLayersById ?? {})) {
      for (const layer of layers ?? []) {
        const tag = String(layer?.aquiferTag ?? '').trim();
        if (tag) set.add(tag);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh'));
  }, [drillholeLayersById]);

  useEffect(() => {
    if (activeTab !== 'aquifer') return;
    if (!selectedAquiferType && aquiferTypeOptions.length > 0) {
      setSelectedAquiferType(aquiferTypeOptions[0]);
    }
  }, [activeTab, aquiferTypeOptions, selectedAquiferType]);

  useEffect(() => {
    if (!selectedCoal && coalSeams.length > 0) {
      setSelectedCoal(coalSeams[0]);
    }
  }, [coalSeams, selectedCoal]);

  const identifiedTarget = useMemo(() => {
    const counts = new Map();

    // 含水层扰动场景：目标评价层 = “目标含水层下关键层（关键层标记=目标层）”
    if (activeTab === 'aquifer') {
      const normalizeTag = (v) => String(v ?? '').replace(/\s+/g, '').trim();

      for (const layers of Object.values(drillholeLayersById ?? {})) {
        const ls = layers ?? [];
        const idxTarget = ls.findIndex((l) => {
          const tag = normalizeTag(l?.keyLayerTag);
          return tag && tag.includes('目标层');
        });
        if (idxTarget < 0) continue;
        const name = String(ls[idxTarget]?.name ?? '').trim();
        if (!name) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }

      if (counts.size === 0) {
        return {
          name: '',
          reason: '',
        };
      }

      let bestName = '';
      let bestCount = -1;
      for (const [n, c] of counts.entries()) {
        if (c > bestCount) {
          bestName = n;
          bestCount = c;
        }
      }

      return {
        name: bestName,
        reason: '',
      };
    }

    for (const layers of Object.values(drillholeLayersById ?? {})) {
      const ls = layers ?? [];
      // 最上层基岩：从地表向深部，首个不包含“土”的层
      const idx = ls.findIndex((l) => {
        const n = String(l?.name ?? '').trim();
        return n && !n.includes('土');
      });
      if (idx < 0) continue;
      const name = String(ls[idx]?.name ?? '').trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    if (counts.size === 0) {
      return { name: '', reason: '未识别到“最上层基岩”（可能分层数据全为“土”或文件为空）。' };
    }

    // 显示为“最常见的基岩岩性（汇总）”，同时下面会展示每孔结果
    let bestName = '';
    let bestCount = -1;
    for (const [n, c] of counts.entries()) {
      if (c > bestCount) {
        bestName = n;
        bestCount = c;
      }
    }
    return {
      name: bestName,
      reason: '算法依据：从地表向深部检索，首个不包含“土”的岩层定义为“最上层基岩”。（下方列表显示各钻孔识别结果）',
    };
  }, [activeTab, drillholeLayersById]);

  const perBoreholeTarget = useMemo(() => {
    const out = {};

    if (activeTab === 'aquifer') {
      const normalizeTag = (v) => String(v ?? '').replace(/\s+/g, '').trim();

      for (const [bhId, layers] of Object.entries(drillholeLayersById ?? {})) {
        const ls = layers ?? [];
        const idxTarget = ls.findIndex((l) => {
          const tag = normalizeTag(l?.keyLayerTag);
          return tag && tag.includes('目标层');
        });
        if (idxTarget < 0) continue;
        out[bhId] = {
          targetIdx: idxTarget,
          targetName: String(ls[idxTarget]?.name ?? '').trim(),
        };
      }
      return out;
    }

    // 其它场景：目标评价层=最上层基岩（与煤层选择无关）
    for (const [bhId, layers] of Object.entries(drillholeLayersById ?? {})) {
      const ls = layers ?? [];
      const targetIdx = ls.findIndex((l) => {
        const n = String(l?.name ?? '').trim();
        return n && !n.includes('土');
      });
      if (targetIdx < 0) continue;
      out[bhId] = {
        targetIdx,
        targetName: String(ls[targetIdx]?.name ?? '').trim(),
      };
    }
    return out;
  }, [activeTab, drillholeLayersById]);

  const perBoreholeTargetList = useMemo(() => {
    return Object.entries(perBoreholeTarget ?? {})
      .map(([id, v]) => ({ id, targetName: String(v?.targetName ?? '').trim() }))
      .filter((x) => x.id && x.targetName)
      .sort((a, b) => a.id.localeCompare(b.id, 'zh'));
  }, [perBoreholeTarget]);

  const drillholeCoordsById = useMemo(() => {
    const m = new Map();
    for (const p of drillholeData ?? []) {
      const id = String(p?.id ?? '').trim();
      if (!id) continue;
      m.set(id, p);
    }
    return m;
  }, [drillholeData]);

  const boreholeParamSamples = useMemo(() => {
    const coal = String(selectedCoal ?? '').trim();
    // Ti/Di 不依赖煤层；Hi/煤厚依赖所选煤层

    const Ti = [];
    const Ei = [];
    const Hi = [];
    const Di = [];
    const Mi = [];
    const CoalThk = [];

    for (const [bhId, lsRaw] of Object.entries(drillholeLayersById ?? {})) {
      const coord = drillholeCoordsById.get(bhId);
      if (!coord) continue;
      const ls = lsRaw ?? [];

      const mark = perBoreholeTarget?.[bhId];
      const targetIdx = mark?.targetIdx;
      const hasTarget = Number.isInteger(targetIdx);

      // Ti/Di 依赖目标层
      if (hasTarget) {
        const tThickness = Number(ls[targetIdx]?.thickness);
        if (Number.isFinite(tThickness)) {
          const eMod = inferElasticModulus(ls[targetIdx]?.name);
          // Di：目标层埋深 = 目标层上覆岩层厚度累加（目标层顶深，不含目标层本身）
          let depthTop = 0;
          for (let k = 0; k < targetIdx; k++) {
            const v = Number(ls[k]?.thickness);
            if (Number.isFinite(v)) depthTop += v;
          }
          Ti.push({ id: bhId, x: coord.x, y: coord.y, value: tThickness });
          Di.push({ id: bhId, x: coord.x, y: coord.y, value: depthTop });
          if (Number.isFinite(eMod)) {
            Ei.push({ id: bhId, x: coord.x, y: coord.y, value: eMod });
          }
        }
      }

      // Mi/CoalThk 依赖所选煤层：Mi=“目标煤层”选择的煤层厚度（各场景一致）
      if (coal) {
        const coalIdx = ls.findIndex((l) => String(l?.name ?? '').trim() === coal);
        if (coalIdx >= 0) {
          const coalThk = Number(ls[coalIdx]?.thickness);
          if (Number.isFinite(coalThk)) {
            CoalThk.push({ id: bhId, x: coord.x, y: coord.y, value: coalThk });

            // Mi：目标层煤层厚度 = “目标煤层”选择的煤层厚度
            Mi.push({ id: bhId, x: coord.x, y: coord.y, value: coalThk });
          }

          // Hi：煤层与目标层间距 = 两者之间岩层厚度累加（不含目标层与煤层本层）
          if (hasTarget && coalIdx !== targetIdx) {
            const a = Math.min(coalIdx, targetIdx);
            const b = Math.max(coalIdx, targetIdx);
            let hi = 0;
            for (let k = a + 1; k <= b - 1; k++) {
              const v = Number(ls[k]?.thickness);
              if (Number.isFinite(v)) hi += v;
            }
            Hi.push({ id: bhId, x: coord.x, y: coord.y, value: hi });
          }
        }
      }
    }

    return { Ti, Ei, Hi, Di, Mi, CoalThk };
  }, [activeTab, drillholeCoordsById, drillholeLayersById, perBoreholeTarget, selectedCoal]);

  const autoSeamThicknessInfo = useMemo(() => {
    const coal = String(selectedCoal ?? '').trim();
    if (!coal) return null;

    const values = [];
    for (const lsRaw of Object.values(drillholeLayersById ?? {})) {
      const ls = lsRaw ?? [];
      const idx = ls.findIndex((l) => String(l?.name ?? '').trim() === coal);
      if (idx < 0) continue;
      const thk = Number(ls[idx]?.thickness);
      if (Number.isFinite(thk) && thk > 0) values.push(thk);
    }

    if (values.length === 0) return null;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    if (!Number.isFinite(avg) || !(avg > 0)) return null;
    return { coal, avg, n: values.length };
  }, [drillholeLayersById, selectedCoal]);

  useEffect(() => {
    const avg = autoSeamThicknessInfo?.avg;
    if (!Number.isFinite(avg) || !(avg > 0)) return;
    const next = avg.toFixed(2);
    setPlanningParams((p) => {
      const cur = String(p?.seamThickness ?? '').trim();
      if (cur === next) return p;
      return { ...p, seamThickness: next };
    });
    lastAutoSeamThicknessRef.current = next;
  }, [autoSeamThicknessInfo?.avg, autoSeamThicknessInfo?.coal]);

  const paletteStops = useMemo(() => {
    // 仅做最小可用的“色带选择”，避免引入额外依赖
    const palettes = {
      viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
      turbo: ['#30123b', '#4145ab', '#2a7bcb', '#19b6a1', '#7fd34e', '#f9e721', '#f26b2e', '#7a0403'],
      blueRed: ['#1d4ed8', '#60a5fa', '#f8fafc', '#fca5a5', '#dc2626'],
    };
    return palettes;
  }, []);

  const hexToRgb = (hex) => {
    const h = String(hex ?? '').replace('#', '').trim();
    if (h.length !== 6) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  };

  const lerpColor = (a, b, t) => {
    const c1 = hexToRgb(a);
    const c2 = hexToRgb(b);
    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b2 = Math.round(c1.b + (c2.b - c1.b) * t);
    return `rgb(${r},${g},${b2})`;
  };

  const valueToColor = (t, paletteName) => {
    const stops = paletteStops[paletteName] ?? paletteStops.viridis;
    const tt = Math.max(0, Math.min(1, Number(t)));
    const n = stops.length - 1;
    const x = tt * n;
    const i = Math.min(n - 1, Math.max(0, Math.floor(x)));
    const frac = x - i;
    return lerpColor(stops[i], stops[i + 1], frac);
  };

  const valueToRgb = (t, paletteName) => {
    const stops = paletteStops[paletteName] ?? paletteStops.viridis;
    const tt = Math.max(0, Math.min(1, Number(t)));
    const n = stops.length - 1;
    const x = tt * n;
    const i = Math.min(n - 1, Math.max(0, Math.floor(x)));
    const frac = x - i;
    const c1 = hexToRgb(stops[i]);
    const c2 = hexToRgb(stops[i + 1]);
    return {
      r: Math.round(c1.r + (c2.r - c1.r) * frac),
      g: Math.round(c1.g + (c2.g - c1.g) * frac),
      b: Math.round(c1.b + (c2.b - c1.b) * frac),
    };
  };

  const getEffectiveRange = (rangeCfg, fieldPack) => {
    const cfg = rangeCfg ?? { enabled: false, min: '', max: '' };
    const autoMin = fieldPack?.min;
    const autoMax = fieldPack?.max;
    if (!cfg.enabled) return { min: autoMin, max: autoMax, isAuto: true };

    const min = cfg.min === '' ? autoMin : Number(cfg.min);
    const max = cfg.max === '' ? autoMax : Number(cfg.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      return { min: autoMin, max: autoMax, isAuto: true };
    }
    return { min, max, isAuto: false };
  };

  const renderHeatmapDataUrl = (fieldPack, min, max, paletteName, clipRange, steps, filterRange, customBreaks) => {
    if (!fieldPack?.field || !fieldPack.gridW || !fieldPack.gridH) return null;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return null;
    if (typeof document === 'undefined') return null;

    const clip = clipRange
      ? {
          lo: Number(clipRange.lo),
          hi: Number(clipRange.hi),
          includeHi: Boolean(clipRange.includeHi),
        }
      : null;
    const hasClip = clip && Number.isFinite(clip.lo) && Number.isFinite(clip.hi) && clip.hi > clip.lo;

    const width = Number(fieldPack.width ?? 320);
    const height = Number(fieldPack.height ?? 220);
    const grid = fieldPack.field;
    const gridH = grid.length;
    const gridW = grid[0]?.length ?? 0;
    if (gridW < 2 || gridH < 2) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(width, height);
    const data = img.data;
    const denom = (max - min) || 1;

    const stepsInt = (() => {
      const s = Number(steps);
      if (!Number.isFinite(s)) return null;
      return Math.max(3, Math.min(10, Math.round(s)));
    })();

    const breaks = (() => {
      if (!Array.isArray(customBreaks)) return null;
      const arr = customBreaks
        .map((v) => clamp(Number(v), 0, 1))
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b);
      // need at least 2 points spanning [0,1]
      if (arr.length < 2) return null;
      const uniq = [];
      for (const v of arr) {
        if (!uniq.length || Math.abs(v - uniq[uniq.length - 1]) > 1e-6) uniq.push(v);
      }
      if (uniq[0] > 0) uniq.unshift(0);
      if (uniq[uniq.length - 1] < 1) uniq.push(1);
      return uniq.length >= 2 ? uniq : null;
    })();

    const filter = (() => {
      if (!filterRange) return null;
      const fMin = Number(filterRange.min);
      const fMax = Number(filterRange.max);
      if (!Number.isFinite(fMin) || !Number.isFinite(fMax) || fMax <= fMin) return null;
      return { min: fMin, max: fMax };
    })();

    // 双线性插值：把较粗网格平滑上采样到 320x220
    for (let py = 0; py < height; py++) {
      const gy = (py / (height - 1)) * (gridH - 1);
      const y0 = Math.floor(gy);
      const y1 = Math.min(gridH - 1, y0 + 1);
      const ty = gy - y0;

      for (let px = 0; px < width; px++) {
        const gx = (px / (width - 1)) * (gridW - 1);
        const x0 = Math.floor(gx);
        const x1 = Math.min(gridW - 1, x0 + 1);
        const tx = gx - x0;

        const v00 = grid[y0][x0];
        const v10 = grid[y0][x1];
        const v01 = grid[y1][x0];
        const v11 = grid[y1][x1];

        const v0 = v00 + (v10 - v00) * tx;
        const v1 = v01 + (v11 - v01) * tx;
        const v = v0 + (v1 - v0) * ty;

        const inFilter = !filter || (v >= filter.min && v <= filter.max);
        const inClip = !hasClip || (clip.includeHi ? v >= clip.lo && v <= clip.hi : v >= clip.lo && v < clip.hi);
        const a = inFilter && inClip ? 235 : 0;

        // 分级量化：3~10 级
        let t = (v - min) / denom;
        if (breaks) {
          // 依据自定义分段，将值压到各分段中点，确保等值线按实测反演分区显示
          let idx = -1;
          for (let k = 1; k < breaks.length; k++) {
            if (t < breaks[k] || (k === breaks.length - 1 && t <= breaks[k])) {
              idx = k;
              break;
            }
          }
          if (idx === -1) idx = breaks.length - 1;
          const loB = breaks[idx - 1];
          const hiB = breaks[idx];
          const mid = (loB + hiB) / 2;
          t = clamp(mid, 0, 1);
        } else if (stepsInt && stepsInt >= 3) {
          const q = stepsInt - 1;
          t = q > 0 ? Math.round(t * q) / q : t;
        }

        const { r, g, b } = valueToRgb(t, paletteName);

        const idx = (py * width + px) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }

    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  };

  const odiFieldPack = useMemo(() => {
    const clamp01 = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return clamp(n, 0, 1);
    };

    const pts = (odiResult?.points ?? [])
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.odiNorm));
    if (pts.length < 3) return null;

    // ODI 的插值域：与主图边界一致（就地计算，避免引用后置 const 引发 TDZ 黑屏）
    const worldBounds = (() => {
      const ptsAll = [
        ...(boundaryData ?? []),
        ...(drillholeData ?? []),
        ...((workingFaceData ?? []) || []),
        ...((measuredConstraintData ?? []) || []),
      ].filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
      if (!ptsAll.length) return null;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of ptsAll) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
      if (maxX <= minX || maxY <= minY) return null;
      return { minX, maxX, minY, maxY };
    })();

    const samples = pts
      .map((p) => ({ id: String(p.id ?? ''), x: p.x, y: p.y, value: clamp01(p.odiNorm) }))
      .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.value));
    if (samples.length < 3) return null;

    // 仅“含水层扰动场景”使用 GIS 自然邻域插值法；其它场景保持 ODI 原插值（IDW）。
    const pack = activeTab === 'aquifer'
      ? computeFieldNaturalNeighbor(samples, 500, 400, boundaryData, worldBounds, {
          pad: 18,
          clampRange: { min: 0, max: 1 },
          kNearest: 32,
          smoothPasses: aquiferOdiSmoothPasses,
        })
      : computeFieldIdwWorld(samples, 500, 400, worldBounds, {
          pad: 18,
          clampRange: { min: 0, max: 1 },
          kNearest: 24,
        });
    if (!pack?.field) return pack;
    // ODI 归一化场固定 0~1，避免色带/分级受 min/max 波动影响
    return { ...pack, min: 0, max: 1 };
  }, [activeTab, odiResult, boundaryData, drillholeData, workingFaceData, measuredConstraintData, aquiferOdiSmoothPasses]);

  const odiLevelRanges = useMemo(() => {
    // 默认：ODI 0~1 均分 5 段
    const fallback = [
      { lo: 0.0, hi: 0.2, includeHi: false },
      { lo: 0.2, hi: 0.4, includeHi: false },
      { lo: 0.4, hi: 0.6, includeHi: false },
      { lo: 0.6, hi: 0.8, includeHi: false },
      { lo: 0.8, hi: 1.0, includeHi: true },
    ];
    if (activeTab !== 'surface' && activeTab !== 'aquifer') return fallback;
    if (measuredZoningResult?.scenario && measuredZoningResult.scenario !== activeTab) return fallback;
    const bins = measuredZoningResult?.bins;
    if (!Array.isArray(bins) || bins.length !== 5) return fallback;
    const mapped = bins
      .map((b, idx) => ({
        lo: clamp(Number(b?.odiLo), 0, 1),
        hi: clamp(Number(b?.odiHi), 0, 1),
        includeHi: idx === 4,
      }))
      .filter((r) => Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.hi > r.lo);
    return mapped.length === 5 ? mapped : fallback;
  }, [activeTab, measuredZoningResult]);

  const odiHeatmapHref = useMemo(() => {
    if (!odiFieldPack?.field) return null;
    // 归一化后：范围固定 0~1（允许用户手动缩放/过滤）
    const clip = Number.isInteger(odiLevelFilter) && odiLevelFilter >= 0 && odiLevelFilter <= 4
      ? odiLevelRanges[odiLevelFilter]
      : null;

    const parseNumOrNull = (s) => {
      if (s === '' || s == null) return null;
      const v = Number(s);
      return Number.isFinite(v) ? v : null;
    };
    const autoMin = 0;
    const autoMax = 1;
    const vMin = parseNumOrNull(odiVizRange.min);
    const vMax = parseNumOrNull(odiVizRange.max);
    const effMin = vMin == null ? autoMin : Math.max(autoMin, Math.min(autoMax, vMin));
    const effMax = vMax == null ? autoMax : Math.max(autoMin, Math.min(autoMax, vMax));
    const hasUserRange = (vMin != null || vMax != null) && effMax > effMin;
    const filterRange = hasUserRange ? { min: effMin, max: effMax } : null;

    // 3) 中间主图分级：默认 5 级；滑块为 N 级时基于这 5 段“等值”派生 N 段
    const breaks = (() => {
      const rs = Array.isArray(odiLevelRanges) && odiLevelRanges.length === 5 ? odiLevelRanges : null;
      if (!rs) return null;

      const baseEdgesRaw = [
        clamp(Number(rs[0]?.lo), 0, 1),
        clamp(Number(rs[0]?.hi), 0, 1),
        clamp(Number(rs[1]?.hi), 0, 1),
        clamp(Number(rs[2]?.hi), 0, 1),
        clamp(Number(rs[3]?.hi), 0, 1),
        clamp(Number(rs[4]?.hi), 0, 1),
      ];

      const baseEdges = [];
      for (const v of baseEdgesRaw) {
        if (!Number.isFinite(v)) continue;
        if (!baseEdges.length || Math.abs(v - baseEdges[baseEdges.length - 1]) > 1e-6) baseEdges.push(v);
      }
      if (baseEdges.length < 2) return null;
      if (baseEdges[0] > 0) baseEdges.unshift(0);
      if (baseEdges[baseEdges.length - 1] < 1) baseEdges.push(1);
      if (baseEdges.length < 2) return null;

      const N = (() => {
        const s = Number(odiVizSteps);
        if (!Number.isFinite(s)) return 5;
        return Math.max(3, Math.min(10, Math.round(s)));
      })();

      // 基准就是 5 段（6 个断点）
      if (N === 5) return baseEdges;

      const totalLo = baseEdges[0];
      const totalHi = baseEdges[baseEdges.length - 1];
      const totalW = (totalHi - totalLo) || 1;

      if (N < 5) {
        // 合并：只在基准断点上取子集，尽量让每段宽度接近 totalW/N
        const target = totalW / N;
        const out = [totalLo];
        let acc = 0;
        let last = totalLo;
        // 可用的内部断点
        const inner = baseEdges.slice(1, -1);
        for (let i = 0; i < inner.length && out.length < N; i++) {
          const e = inner[i];
          const w = e - last;
          const remainingCutsNeeded = (N - 1) - (out.length - 1);
          const remainingEdgesAvailable = inner.length - i;
          acc += w;
          // 需要保证后面还够断点可选
          const mustCut = remainingEdgesAvailable === remainingCutsNeeded;
          if (mustCut || acc >= target) {
            out.push(e);
            acc = 0;
            last = e;
          } else {
            last = e;
          }
        }
        out.push(totalHi);
        // 去重 + 单调
        const uniq = [];
        for (const v of out) {
          if (!uniq.length || Math.abs(v - uniq[uniq.length - 1]) > 1e-6) uniq.push(v);
        }
        return uniq.length >= 2 ? uniq : null;
      }

      // N > 5：在每个基准区间内等距细分，细分数量按区间宽度占比分配，并保证每段至少 1
      const intervals = [];
      for (let i = 0; i < baseEdges.length - 1; i++) {
        const a = baseEdges[i];
        const b = baseEdges[i + 1];
        const w = b - a;
        if (w > 1e-12) intervals.push({ a, b, w });
      }
      if (!intervals.length) return baseEdges;

      const alloc = intervals.map((it) => ({ ...it, seg: 1, frac: 0 }));
      let remaining = N - alloc.length;
      // 先按比例给出期望增量
      for (const it of alloc) {
        const ideal = (it.w / totalW) * remaining;
        const add = Math.max(0, Math.floor(ideal));
        it.seg += add;
        it.frac = ideal - add;
      }
      let used = alloc.reduce((s, it) => s + it.seg, 0);
      // 调整到正好 N 段
      while (used < N) {
        let best = 0;
        for (let i = 1; i < alloc.length; i++) if (alloc[i].frac > alloc[best].frac) best = i;
        alloc[best].seg += 1;
        alloc[best].frac = 0;
        used += 1;
      }
      while (used > N) {
        // 从 seg 最大的区间回收
        let best = -1;
        for (let i = 0; i < alloc.length; i++) {
          if (alloc[i].seg > 1 && (best === -1 || alloc[i].seg > alloc[best].seg)) best = i;
        }
        if (best === -1) break;
        alloc[best].seg -= 1;
        used -= 1;
      }

      const out = [totalLo];
      for (const it of alloc) {
        const seg = it.seg;
        for (let k = 1; k <= seg; k++) {
          const t = k / seg;
          const v = it.a + (it.b - it.a) * t;
          out.push(clamp(v, 0, 1));
        }
      }
      const uniq = [];
      for (const v of out) {
        if (!Number.isFinite(v)) continue;
        if (!uniq.length || Math.abs(v - uniq[uniq.length - 1]) > 1e-6) uniq.push(v);
      }
      if (uniq[0] > 0) uniq.unshift(0);
      if (uniq[uniq.length - 1] < 1) uniq.push(1);
      return uniq.length >= 2 ? uniq : null;
    })();

    return renderHeatmapDataUrl(
      odiFieldPack,
      hasUserRange ? effMin : 0,
      hasUserRange ? effMax : 1,
      odiVizPalette,
      clip,
      odiVizSteps,
      filterRange,
      breaks
    );
  }, [odiFieldPack, odiLevelFilter, odiLevelRanges, odiVizPalette, odiVizSteps, odiVizRange, measuredZoningResult, activeTab]);

  const handleComputeOdi = () => {
    const pts = paramExtractionResult?.points ?? [];
    const r = computeOdi(pts, scenarioWeights);
    setOdiResult(r);

    // 重新计算 ODI 后：旧的“实测约束分区”基于旧场，需作废，回到“”之前
    setMeasuredZoningResultTracked(null);
    // 同步清空误差评估结果：旧误差同样基于旧 ODI 场
    setErrorAnalysisByLineId({});
    setOdiLevelFilter(null);
  };

  const handleComputeMeasuredZoning = () => {
    if (activeTab !== 'surface' && activeTab !== 'aquifer') {
      window.alert('该场景的“实测约束分区”暂未实现（界面已预留）。');
      return;
    }
    if (!measuredConstraintData?.length) {
      window.alert('请先在左侧导入“实测约束数据”。');
      return;
    }
    if (!odiFieldPack?.field) {
      window.alert('请先完成 ODI 计算并生成 ODI 分布场，再。');
      return;
    }

    const zoning = computeMeasuredZoningSurface(odiFieldPack, measuredConstraintData, 1e-3, { scenario: activeTab });
    if (!zoning?.ok) {
      window.alert(zoning?.message || '实测分区失败：请检查数据。');
      return;
    }

    const { thresholds, fit, bins, validOdiCount, measuredEdges } = zoning.result;

    setMeasuredZoningResultTracked({
      scenario: activeTab,
      createdAt: new Date().toISOString(),
      importedCount: measuredConstraintData.length,
      validOdiCount,
      thresholds,
      fit,
      measuredEdges,
      bins,
    });
    setOdiLevelFilter(null);
  };

  const handleComputeErrorAnalysis = () => {
    if (activeTab !== 'surface' && activeTab !== 'aquifer') {
      window.alert('该场景的“误差分析”暂未实现（界面已预留）。');
      return;
    }
    if (!measuredConstraintLines?.length) {
      window.alert('请先导入实测约束数据（可多文件=多测线）。');
      return;
    }
    if (!odiFieldPack?.field) {
      window.alert('请先完成 ODI 计算并生成 ODI 分布场，再计算误差。');
      return;
    }

    const next = {};
    for (const line of measuredConstraintLines) {
      const lineId = String(line?.lineId ?? '').trim();
      if (!lineId) continue;
      const built = buildErrorTrendForLine(line?.points ?? [], lineId);
      next[lineId] = {
        computedAt: new Date().toISOString(),
        label: String(line?.label ?? lineId),
        data: built.data,
        stats: built.stats,
      };
    }
    setErrorAnalysisByLineId(next);
    if (!selectedMeasuredLineId) {
      const first = measuredConstraintLines?.[0]?.lineId;
      if (first) setSelectedMeasuredLineId(String(first));
    }
    setShowErrorAnalysis(true);
  };

  const exportErrorChartPng = async (lineId) => {
    try {
      const container = errorChartContainerRef.current;
      if (!container) return;
      const svg = container.querySelector('svg');
      if (!svg) {
        window.alert('未找到可导出的误差图（请先计算误差并展开误差趋势模块）。');
        return;
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeLine = String(lineId ?? '测线').replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
      const filename = `误差趋势_${safeLine}_${stamp}.png`;

      const rect = svg.getBoundingClientRect();
      const w = Math.max(400, Math.round(rect.width || 900));
      const h = Math.max(240, Math.round(rect.height || 260));

      const cloned = svg.cloneNode(true);
      if (!cloned.getAttribute('xmlns')) cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!cloned.getAttribute('xmlns:xlink')) cloned.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      cloned.setAttribute('width', String(w));
      cloned.setAttribute('height', String(h));

      const xml = new XMLSerializer().serializeToString(cloned);
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const img = new Image();
      img.decoding = 'async';
      const loaded = new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      img.src = url;
      await loaded;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      downloadDataUrlFile(filename, canvas.toDataURL('image/png'));
    } catch (e) {
      console.error('exportErrorChartPng failed', e);
    }
  };

  const exportErrorCsv = (lineId) => {
    try {
      const lineKey = String(lineId ?? '').trim();
      if (!lineKey) {
        window.alert('请先选择测线。');
        return;
      }
      const pack = errorAnalysisByLineId?.[lineKey];
      const data = pack?.data ?? [];
      if (!data.length) {
        window.alert('暂无可导出的误差数据（请先计算误差）。');
        return;
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeLine = String(lineKey).replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
      const header = ['测点ID', '坐标x', '坐标y', '实测值(m)', '实测归一化', 'ODI', '误差'];

      const esc = (v) => {
        const s = String(v ?? '');
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const rows = [header.join(',')];
      for (const r of data) {
        const errPct = Number.isFinite(r?.errorRatio) ? (Number(r.errorRatio) * 100) : null;
        rows.push([
          esc(r?.id ?? ''),
          Number.isFinite(r?.x) ? Number(r.x).toFixed(6) : '',
          Number.isFinite(r?.y) ? Number(r.y).toFixed(6) : '',
          Number.isFinite(r?.measured) ? Number(r.measured).toFixed(6) : '',
          Number.isFinite(r?.measuredNorm) ? Number(r.measuredNorm).toFixed(6) : '',
          Number.isFinite(r?.odiRenorm) ? Number(r.odiRenorm).toFixed(6) : '',
          errPct != null ? errPct.toFixed(2) : '',
        ].join(','));
      }

      downloadTextFile(`误差数据_${safeLine}_${stamp}.csv`, `\uFEFF${rows.join('\n')}\n`, 'text/csv;charset=utf-8');
    } catch (e) {
      console.error('exportErrorCsv failed', e);
    }
  };

  const handleExportErrorAnalysis = async (mode) => {
    const lineKey = String(selectedMeasuredLineId ?? '').trim();
    if (!lineKey) {
      window.alert('请先选择测线。');
      return;
    }
    if (!errorAnalysisByLineId?.[lineKey]?.data?.length) {
      window.alert('暂无可导出的误差数据（请先计算误差）。');
      return;
    }
    const m = String(mode ?? '').toLowerCase();
    if (m === 'csv') {
      exportErrorCsv(lineKey);
      return;
    }
    if (m === 'png') {
      await exportErrorChartPng(lineKey);
      return;
    }
    window.alert('请选择导出类型（PNG 或 CSV）。');
  };

  const downloadTextFile = (filename, content, mime = 'text/plain;charset=utf-8') => {
    try {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('downloadTextFile failed', e);
    }
  };

  const downloadDataUrlFile = (filename, dataUrl) => {
    if (!dataUrl) return;
    try {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error('downloadDataUrlFile failed', e);
    }
  };

  useEffect(() => {
    const onFsChange = () => {
      const el = document.fullscreenElement;
      setIsMainMapFullscreen(Boolean(el) && el === mainMapContainerRef.current);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    if (!showMainMapExportMenu) return;
    const onDocDown = (e) => {
      const root = mainMapContainerRef.current;
      if (!root) {
        setShowMainMapExportMenu(false);
        return;
      }
      const menu = root.querySelector('[data-main-map-export-menu]');
      const btn = root.querySelector('[data-main-map-export-button]');
      const t = e.target;
      if (menu && menu.contains(t)) return;
      if (btn && btn.contains(t)) return;
      setShowMainMapExportMenu(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [showMainMapExportMenu]);

  useEffect(() => {
    if (!showMainMapLabelsMenu) return;
    const onDocDown = (e) => {
      const root = mainMapContainerRef.current;
      if (!root) {
        setShowMainMapLabelsMenu(false);
        return;
      }
      const menu = root.querySelector('[data-main-map-labels-menu]');
      const btn = root.querySelector('[data-main-map-labels-button]');
      const t = e.target;
      if (menu && menu.contains(t)) return;
      if (btn && btn.contains(t)) return;
      setShowMainMapLabelsMenu(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [showMainMapLabelsMenu]);

  useEffect(() => {
    if (!showErrorExportMenu) return;
    const onDocDown = (e) => {
      const menu = errorExportMenuRef.current;
      const btn = errorExportButtonRef.current;
      const t = e.target;
      if (menu && menu.contains(t)) return;
      if (btn && btn.contains(t)) return;
      setShowErrorExportMenu(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [showErrorExportMenu]);

  const handleToggleMainMapFullscreen = async () => {
    try {
      const el = mainMapContainerRef.current;
      if (!el) return;
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      }
    } catch (e) {
      console.error('toggle fullscreen failed', e);
    }
  };

  const exportMainMapPng = async () => {
    try {
      const svg = mainMapSvgRef.current;
      if (!svg) return;

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `ODI分布图_${stamp}.png`;

      // 克隆 SVG 并补齐命名空间，便于序列化渲染
      const cloned = svg.cloneNode(true);
      if (!cloned.getAttribute('xmlns')) cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!cloned.getAttribute('xmlns:xlink')) cloned.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      // 固定导出尺寸（与 viewBox 一致）
      cloned.setAttribute('width', '800');
      cloned.setAttribute('height', '500');

      const xml = new XMLSerializer().serializeToString(cloned);
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const img = new Image();
      img.decoding = 'async';
      const loaded = new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      img.src = url;
      await loaded;

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 500;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      downloadDataUrlFile(filename, canvas.toDataURL('image/png'));
    } catch (e) {
      console.error('exportMainMapPng failed', e);
    }
  };

  const exportOdiCsvByDrillholes = () => {
    try {
      if (!drillholeData?.length) {
        window.alert('请先导入钻孔坐标数据。');
        return;
      }
      if (!odiFieldPack?.field) {
        window.alert('请先完成 ODI 计算（生成 ODI 分布场）后再导出。');
        return;
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const header = ['钻孔ID', '坐标x', '坐标y', 'ODI'];

      const esc = (v) => {
        const s = String(v ?? '');
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const rows = [header.join(',')];
      for (const p of drillholeData) {
        const id = p?.id ?? '';
        const x = Number(p?.x);
        const y = Number(p?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const odi = sampleFieldAtWorldXY(odiFieldPack, x, y);
        rows.push([
          esc(id),
          Number.isFinite(x) ? x.toFixed(6) : '',
          Number.isFinite(y) ? y.toFixed(6) : '',
          Number.isFinite(odi) ? odi.toFixed(6) : '',
        ].join(','));
      }

      downloadTextFile(`钻孔ODI_${stamp}.csv`, `\uFEFF${rows.join('\n')}\n`, 'text/csv;charset=utf-8');
    } catch (e) {
      console.error('exportOdiCsvByDrillholes failed', e);
    }
  };

  const getCurrentGeologyPickKeys = () => {
    if (geologyLayoutMode === '2x2') return ['Ti', 'Mi', 'Hi', 'Di'];
    if (geologyLayoutMode === '1x2') return [geoPickA, geoPickB];
    return [geoPickA];
  };

  const exportGeologyCloudMapsPng = () => {
    const keys = getCurrentGeologyPickKeys();
    const ts = new Date();
    const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}_${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;

    for (const k of keys) {
      const panel = geologyPanelsByKey[k] ?? geologyPanelsByKey.Ti;
      const fieldPack = contourData[panel.key];
      if (!fieldPack?.field) continue;

      const cfg = mapVizSettings?.[panel.key];
      const paletteName = cfg?.palette ?? 'viridis';
      const range = getEffectiveRange(cfg?.range, fieldPack);
      const href = renderHeatmapDataUrl(fieldPack, range.min, range.max, paletteName);
      const safeKey = String(panel.key ?? k).replace(/[^a-zA-Z0-9_-]/g, '_');
      downloadDataUrlFile(`云图_${safeKey}_${stamp}.png`, href);
    }
  };

  const toCsvRow = (cells) => {
    return cells
      .map((c) => {
        const s = String(c ?? '');
        const escaped = s.replace(/"/g, '""');
        return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
      })
      .join(',');
  };

  const exportGeologyBoreholeCsv = () => {
    const keys = getCurrentGeologyPickKeys();
    const ts = new Date();
    const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}_${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;

    for (const k of keys) {
      const panel = geologyPanelsByKey[k] ?? geologyPanelsByKey.Ti;
      const samples = boreholeParamSamples?.[panel.key] ?? [];
      if (!samples.length) continue;

      const rows = [];
      rows.push(toCsvRow(['钻孔ID', '坐标x', '坐标y', '对应数值']));

      const sorted = [...samples].sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''), 'zh'));
      for (const s of sorted) {
        const id = String(s?.id ?? '').trim();
        const x = s?.x;
        const y = s?.y;
        const v = s?.value;
        if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(v)) continue;
        rows.push(toCsvRow([id, x, y, v]));
      }

      const safeKey = String(panel.key ?? k).replace(/[^a-zA-Z0-9_-]/g, '_');
      // Excel 友好：加 BOM
      downloadTextFile(`钻孔数据_${safeKey}_${stamp}.csv`, `\uFEFF${rows.join('\n')}\n`, 'text/csv;charset=utf-8');
    }
  };

  const exportEvalPointsFullParamsCsv = () => {
    if (!paramExtractionResult?.points?.length) return;
    const ts = new Date();
    const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}_${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
    const modeTag = lastParamExtractionMode === 'geo' ? '地质插值' : '全参插值';

    const rows = [];
    rows.push(toCsvRow([
      '钻孔ID',
      '坐标x',
      '坐标y',
      '目标层厚度（Ti）',
      '目标层弹性模量（Ei）',
      '煤层与目标层间距（Hi）',
      '目标层埋深（Di）',
      '采高（Mi）',
      '顶板岩层垮落角（δi）',
      '工作面宽度（lpi）',
      '区段煤柱（lci）',
    ]));

    const pts = [...paramExtractionResult.points]
      .filter((p) => p && String(p.id ?? '').trim())
      .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? ''), 'zh'));

    for (const p of pts) {
      rows.push(toCsvRow([
        String(p.id ?? ''),
        Number.isFinite(p.x) ? p.x : '',
        Number.isFinite(p.y) ? p.y : '',
        Number.isFinite(p.Ti) ? p.Ti : '',
        Number.isFinite(p.Ei) ? p.Ei : '',
        Number.isFinite(p.Hi) ? p.Hi : '',
        Number.isFinite(p.Di) ? p.Di : '',
        Number.isFinite(p.Mi) ? p.Mi : '',
        Number.isFinite(p.delta) ? p.delta : '',
        Number.isFinite(p.lpi) ? p.lpi : '',
        Number.isFinite(p.lci) ? p.lci : '',
      ]));
    }

    downloadTextFile(`评价点全参数_${modeTag}_${stamp}.csv`, `\uFEFF${rows.join('\n')}\n`, 'text/csv;charset=utf-8');
  };

  const exportEvalPointsFullParamsWithOdiCsv = () => {
    const pts = paramExtractionResult?.points ?? [];
    if (!pts.length) return;

    const r = computeOdi(pts, scenarioWeights);
    if (r?.error) {
      window.alert(String(r.error));
      return;
    }

    const ts = new Date();
    const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}_${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
    const modeTag = lastParamExtractionMode === 'geo' ? '地质插值' : '全参插值';

    const keyOf = (p) => `${String(p?.id ?? '').trim()}@@${Number(p?.x).toFixed(6)}@@${Number(p?.y).toFixed(6)}`;
    const odiByKey = new Map();
    for (const p of (r?.points ?? [])) {
      const id = String(p?.id ?? '').trim();
      if (!id || !Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
      odiByKey.set(keyOf(p), Number(p?.odiNorm));
    }

    const rows = [];
    rows.push(toCsvRow([
      '钻孔ID',
      '坐标x',
      '坐标y',
      '目标层厚度（Ti）',
      '目标层弹性模量（Ei）',
      '煤层与目标层间距（Hi）',
      '目标层埋深（Di）',
      '采高（Mi）',
      '顶板岩层垮落角（δi）',
      '工作面宽度（lpi）',
      '区段煤柱（lci）',
      'ODI',
    ]));

    const sorted = [...pts]
      .filter((p) => p && String(p.id ?? '').trim())
      .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? ''), 'zh'));

    for (const p of sorted) {
      const id = String(p?.id ?? '').trim();
      const x = p?.x;
      const y = p?.y;
      const odi = (id && Number.isFinite(x) && Number.isFinite(y)) ? odiByKey.get(keyOf(p)) : null;

      rows.push(toCsvRow([
        id,
        Number.isFinite(x) ? x : '',
        Number.isFinite(y) ? y : '',
        Number.isFinite(p?.Ti) ? p.Ti : '',
        Number.isFinite(p?.Ei) ? p.Ei : '',
        Number.isFinite(p?.Hi) ? p.Hi : '',
        Number.isFinite(p?.Di) ? p.Di : '',
        Number.isFinite(p?.Mi) ? p.Mi : '',
        Number.isFinite(p?.delta) ? p.delta : '',
        Number.isFinite(p?.lpi) ? p.lpi : '',
        Number.isFinite(p?.lci) ? p.lci : '',
        Number.isFinite(odi) ? odi : '',
      ]));
    }

    downloadTextFile(`评价点全参数_ODI_${modeTag}_${stamp}.csv`, `\uFEFF${rows.join('\n')}\n`, 'text/csv;charset=utf-8');
  };

  function computeField(samples, width = 320, height = 220) {
    if (!samples || samples.length < 3) return { field: null, min: null, max: null, gridW: 0, gridH: 0, width, height, points: [] };

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let minV = Infinity, maxV = -Infinity;
    for (const p of samples) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.value)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.value < minV) minV = p.value;
      if (p.value > maxV) maxV = p.value;
    }
    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
      return { field: null, min: Number.isFinite(minV) ? minV : null, max: Number.isFinite(maxV) ? maxV : null, gridW: 0, gridH: 0, width, height, points: [], bounds: { minX, maxX, minY, maxY, pad: 14 } };
    }
    if (minV === maxV) {
      const pad = 14;
      const gridW = 60;
      const gridH = 42;
      const field = Array.from({ length: gridH }, () => Array.from({ length: gridW }, () => minV));
      return { field, min: minV, max: maxV, gridW, gridH, width, height, points: [], bounds: { minX, maxX, minY, maxY, pad } };
    }

    const pad = 14;
    const sx = (x) => pad + ((x - minX) / (maxX - minX || 1)) * (width - pad * 2);
    const sy = (y) => pad + (1 - (y - minY) / (maxY - minY || 1)) * (height - pad * 2);

    const pts = samples
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.value))
      .map((p) => ({ x: sx(p.x), y: sy(p.y), v: p.value }));

    const gridW = 60;
    const gridH = 42;
    const field = Array.from({ length: gridH }, () => Array.from({ length: gridW }, () => 0));
    const p = 2;
    const eps = 1e-6;

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const x = (gx / (gridW - 1)) * width;
        const y = (gy / (gridH - 1)) * height;
        let num = 0;
        let den = 0;
        let snapped = null;
        for (const pt of pts) {
          const dx = x - pt.x;
          const dy = y - pt.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < eps) {
            snapped = pt.v;
            break;
          }
          const w = 1 / Math.pow(d2, p / 2);
          num += w * pt.v;
          den += w;
        }
        field[gy][gx] = snapped != null ? snapped : num / (den || 1);
      }
    }

    return { field, min: minV, max: maxV, gridW, gridH, width, height, points: pts, bounds: { minX, maxX, minY, maxY, pad } };
  }

  function computeFieldBarrierSpline(samples, width = 500, height = 400, barrierPolygon, worldBounds, options) {
    const opts = options ?? {};
    const pad = Number.isFinite(opts.pad) ? Number(opts.pad) : 14;
    const clampRange = opts.clampRange && Number.isFinite(opts.clampRange.min) && Number.isFinite(opts.clampRange.max)
      ? { min: Number(opts.clampRange.min), max: Number(opts.clampRange.max) }
      : null;

    if (!samples || samples.length < 3) {
      return { field: null, min: null, max: null, gridW: 0, gridH: 0, width, height, points: [], bounds: null };
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let minV = Infinity, maxV = -Infinity;
    for (const p of samples) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.value)) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      minV = Math.min(minV, p.value);
      maxV = Math.max(maxV, p.value);
    }

    if (worldBounds && Number.isFinite(worldBounds.minX) && Number.isFinite(worldBounds.maxX) && Number.isFinite(worldBounds.minY) && Number.isFinite(worldBounds.maxY)) {
      if (worldBounds.maxX > worldBounds.minX && worldBounds.maxY > worldBounds.minY) {
        minX = worldBounds.minX;
        maxX = worldBounds.maxX;
        minY = worldBounds.minY;
        maxY = worldBounds.maxY;
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY) || maxX <= minX || maxY <= minY) {
      return { field: null, min: null, max: null, gridW: 0, gridH: 0, width, height, points: [], bounds: null };
    }

    const sx = (x) => pad + ((x - minX) / ((maxX - minX) || 1)) * (width - pad * 2);
    const sy = (y) => pad + (1 - (y - minY) / ((maxY - minY) || 1)) * (height - pad * 2);

    const pts = samples
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.value))
      .map((p) => ({ x: sx(p.x), y: sy(p.y), v: clampRange ? clamp(p.value, clampRange.min, clampRange.max) : p.value }));

    const poly = (barrierPolygon ?? [])
      .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => ({ x: sx(p.x), y: sy(p.y) }));

    const orient = (ax, ay, bx, by, cx, cy) => {
      return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    };
    const onSeg = (ax, ay, bx, by, cx, cy) => {
      return Math.min(ax, bx) - 1e-9 <= cx && cx <= Math.max(ax, bx) + 1e-9 && Math.min(ay, by) - 1e-9 <= cy && cy <= Math.max(ay, by) + 1e-9;
    };
    const segIntersects = (a, b, c, d) => {
      const o1 = orient(a.x, a.y, b.x, b.y, c.x, c.y);
      const o2 = orient(a.x, a.y, b.x, b.y, d.x, d.y);
      const o3 = orient(c.x, c.y, d.x, d.y, a.x, a.y);
      const o4 = orient(c.x, c.y, d.x, d.y, b.x, b.y);

      if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) return true;
      if (Math.abs(o1) <= 1e-12 && onSeg(a.x, a.y, b.x, b.y, c.x, c.y)) return true;
      if (Math.abs(o2) <= 1e-12 && onSeg(a.x, a.y, b.x, b.y, d.x, d.y)) return true;
      if (Math.abs(o3) <= 1e-12 && onSeg(c.x, c.y, d.x, d.y, a.x, a.y)) return true;
      if (Math.abs(o4) <= 1e-12 && onSeg(c.x, c.y, d.x, d.y, b.x, b.y)) return true;
      return false;
    };

    const visible = (a, b) => {
      if (!poly || poly.length < 3) return true;
      for (let i = 0; i < poly.length; i++) {
        const c = poly[i];
        const d = poly[(i + 1) % poly.length];
        // 只要连线穿越边界（与任一边相交）即视为被障碍阻断
        if (segIntersects(a, b, c, d)) return false;
      }
      return true;
    };

    const U = (r2) => {
      if (r2 <= 1e-18) return 0;
      const r = Math.sqrt(r2);
      return r2 * Math.log(r + 1e-12);
    };

    const solveLinear = (A, b) => {
      const n = A.length;
      const M = A.map((row) => row.slice());
      const x = b.slice();
      for (let i = 0; i < n; i++) {
        let pivot = i;
        let best = Math.abs(M[i][i]);
        for (let r = i + 1; r < n; r++) {
          const v = Math.abs(M[r][i]);
          if (v > best) {
            best = v;
            pivot = r;
          }
        }
        if (best <= 1e-12) return null;
        if (pivot !== i) {
          const tmpRow = M[i];
          M[i] = M[pivot];
          M[pivot] = tmpRow;
          const tmpV = x[i];
          x[i] = x[pivot];
          x[pivot] = tmpV;
        }

        const diag = M[i][i];
        for (let c = i; c < n; c++) M[i][c] /= diag;
        x[i] /= diag;

        for (let r = 0; r < n; r++) {
          if (r === i) continue;
          const f = M[r][i];
          if (Math.abs(f) <= 1e-15) continue;
          for (let c = i; c < n; c++) M[r][c] -= f * M[i][c];
          x[r] -= f * x[i];
        }
      }
      return x;
    };

    const idwAt = (x, y, neigh) => {
      const p = 2;
      const eps = 1e-6;
      let num = 0;
      let den = 0;
      for (const pt of neigh) {
        const dx = x - pt.x;
        const dy = y - pt.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < eps) return pt.v;
        const w = 1 / Math.pow(d2, p / 2);
        num += w * pt.v;
        den += w;
      }
      return num / (den || 1);
    };

    const selectKNearestVisible = (x, y, k) => {
      const a = { x, y };
      const best = [];
      let worstD2 = -Infinity;
      let worstIdx = -1;
      for (const pt of pts) {
        if (!visible(a, pt)) continue;
        const dx = x - pt.x;
        const dy = y - pt.y;
        const d2 = dx * dx + dy * dy;
        if (best.length < k) {
          best.push({ ...pt, d2 });
          if (d2 > worstD2) {
            worstD2 = d2;
            worstIdx = best.length - 1;
          }
        } else if (d2 < worstD2) {
          best[worstIdx] = { ...pt, d2 };
          worstD2 = -Infinity;
          worstIdx = -1;
          for (let i = 0; i < best.length; i++) {
            if (best[i].d2 > worstD2) {
              worstD2 = best[i].d2;
              worstIdx = i;
            }
          }
        }
      }
      best.sort((m, n) => m.d2 - n.d2);
      return best;
    };

    const tpsAt = (x, y, neigh) => {
      const n = neigh.length;
      if (n < 3) return null;

      const size = n + 3;
      const A = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
      const b = Array.from({ length: size }, () => 0);
      const lambda = 1e-10;

      for (let i = 0; i < n; i++) {
        const xi = neigh[i].x;
        const yi = neigh[i].y;
        b[i] = neigh[i].v;
        for (let j = 0; j < n; j++) {
          const dx = xi - neigh[j].x;
          const dy = yi - neigh[j].y;
          const r2 = dx * dx + dy * dy;
          A[i][j] = U(r2);
        }
        A[i][i] += lambda;
        A[i][n] = 1;
        A[i][n + 1] = xi;
        A[i][n + 2] = yi;
      }

      for (let j = 0; j < n; j++) {
        const xj = neigh[j].x;
        const yj = neigh[j].y;
        A[n][j] = 1;
        A[n + 1][j] = xj;
        A[n + 2][j] = yj;
      }
      // 右下角 3x3 为 0，b 的最后三项也为 0

      const sol = solveLinear(A, b);
      if (!sol) return null;
      const w = sol.slice(0, n);
      const a0 = sol[n];
      const a1 = sol[n + 1];
      const a2 = sol[n + 2];

      let f = a0 + a1 * x + a2 * y;
      for (let i = 0; i < n; i++) {
        const dx = x - neigh[i].x;
        const dy = y - neigh[i].y;
        f += w[i] * U(dx * dx + dy * dy);
      }
      return Number.isFinite(f) ? f : null;
    };

    const gridW = 80;
    const gridH = 56;
    const field = Array.from({ length: gridH }, () => Array.from({ length: gridW }, () => 0));
    const k = 18;

    for (let gy = 0; gy < gridH; gy++) {
      const y = (gy / (gridH - 1)) * height;
      for (let gx = 0; gx < gridW; gx++) {
        const x = (gx / (gridW - 1)) * width;
        const neigh = selectKNearestVisible(x, y, k);
        let v = null;
        if (neigh.length >= 6) {
          v = tpsAt(x, y, neigh);
        }
        if (!Number.isFinite(v)) {
          // TPS 点不足或求解失败：退化到可见邻域 IDW
          v = idwAt(x, y, neigh.length ? neigh : pts);
        }
        if (clampRange) v = clamp(v, clampRange.min, clampRange.max);
        field[gy][gx] = v;
      }
    }

    return {
      field,
      min: Number.isFinite(minV) ? minV : null,
      max: Number.isFinite(maxV) ? maxV : null,
      gridW,
      gridH,
      width,
      height,
      points: pts,
      bounds: { minX, maxX, minY, maxY, pad },
    };
  }

  function computeFieldNaturalNeighbor(samples, width = 500, height = 400, barrierPolygon, worldBounds, options) {
    const opts = options ?? {};
    const pad = Number.isFinite(opts.pad) ? Number(opts.pad) : 14;
    const clampRange = opts.clampRange && Number.isFinite(opts.clampRange.min) && Number.isFinite(opts.clampRange.max)
      ? { min: Number(opts.clampRange.min), max: Number(opts.clampRange.max) }
      : null;
    const kNearest = Number.isFinite(opts.kNearest) ? Math.max(6, Math.min(64, Math.round(opts.kNearest))) : 24;
    const smoothPasses = Number.isFinite(opts.smoothPasses) ? Math.max(0, Math.min(6, Math.round(opts.smoothPasses))) : 0;

    if (!samples || samples.length < 3) {
      return { field: null, min: null, max: null, gridW: 0, gridH: 0, width, height, points: [], bounds: null };
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let minV = Infinity, maxV = -Infinity;
    for (const p of samples) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.value)) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      minV = Math.min(minV, p.value);
      maxV = Math.max(maxV, p.value);
    }

    if (worldBounds && Number.isFinite(worldBounds.minX) && Number.isFinite(worldBounds.maxX) && Number.isFinite(worldBounds.minY) && Number.isFinite(worldBounds.maxY)) {
      if (worldBounds.maxX > worldBounds.minX && worldBounds.maxY > worldBounds.minY) {
        minX = worldBounds.minX;
        maxX = worldBounds.maxX;
        minY = worldBounds.minY;
        maxY = worldBounds.maxY;
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY) || maxX <= minX || maxY <= minY) {
      return { field: null, min: null, max: null, gridW: 0, gridH: 0, width, height, points: [], bounds: null };
    }

    const sx = (x) => pad + ((x - minX) / ((maxX - minX) || 1)) * (width - pad * 2);
    const sy = (y) => pad + (1 - (y - minY) / ((maxY - minY) || 1)) * (height - pad * 2);

    const pts = samples
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.value))
      .map((p) => ({
        x: sx(p.x),
        y: sy(p.y),
        v: clampRange ? clamp(p.value, clampRange.min, clampRange.max) : p.value,
      }));

    const idwAt = (x, y, neigh) => {
      const p = 2;
      const eps = 1e-6;
      let num = 0;
      let den = 0;
      for (const pt of neigh) {
        const dx = x - pt.x;
        const dy = y - pt.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < eps) return pt.v;
        const w = 1 / Math.pow(d2, p / 2);
        num += w * pt.v;
        den += w;
      }
      return num / (den || 1);
    };

    // 共享边长度：通过“同一对顶点”的边匹配（d3-delaunay 的 Voronoi 单元会共享完全相同的边顶点）
    const sharedEdgeLength = (polyA, polyB) => {
      if (!Array.isArray(polyA) || !Array.isArray(polyB) || polyA.length < 2 || polyB.length < 2) return 0;
      const keyPt = (p) => `${Number(p[0]).toFixed(4)},${Number(p[1]).toFixed(4)}`;
      const edgeKey = (p, q) => {
        const a = keyPt(p);
        const b = keyPt(q);
        return a < b ? `${a}|${b}` : `${b}|${a}`;
      };
      const edgeMap = new Map();
      for (let i = 0; i < polyA.length - 1; i++) {
        const p = polyA[i];
        const q = polyA[i + 1];
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const len = Math.hypot(dx, dy);
        if (!(len > 1e-9)) continue;
        edgeMap.set(edgeKey(p, q), len);
      }
      let sum = 0;
      for (let i = 0; i < polyB.length - 1; i++) {
        const p = polyB[i];
        const q = polyB[i + 1];
        const k = edgeKey(p, q);
        const len = edgeMap.get(k);
        if (len) sum += len;
      }
      return sum;
    };

    const selectKNearest = (x, y, k) => {
      const best = [];
      let worstD2 = -Infinity;
      let worstIdx = -1;
      for (const pt of pts) {
        const dx = x - pt.x;
        const dy = y - pt.y;
        const d2 = dx * dx + dy * dy;
        if (best.length < k) {
          best.push({ ...pt, d2 });
          if (d2 > worstD2) {
            worstD2 = d2;
            worstIdx = best.length - 1;
          }
        } else if (d2 < worstD2) {
          best[worstIdx] = { ...pt, d2 };
          worstD2 = -Infinity;
          worstIdx = -1;
          for (let i = 0; i < best.length; i++) {
            if (best[i].d2 > worstD2) {
              worstD2 = best[i].d2;
              worstIdx = i;
            }
          }
        }
      }
      best.sort((a, b) => a.d2 - b.d2);
      return best;
    };

    const naturalNeighborAt = (x, y) => {
      const neigh = selectKNearest(x, y, kNearest);
      if (neigh.length < 3) return idwAt(x, y, pts);

      // 命中采样点：直接返回
      if (neigh[0]?.d2 != null && neigh[0].d2 < 1e-8) return neigh[0].v;

      const local = [...neigh.map((p) => ({ x: p.x, y: p.y, v: p.v })), { x, y, v: null }];
      const qi = local.length - 1;

      let delaunay;
      try {
        delaunay = Delaunay.from(local, (p) => p.x, (p) => p.y);
      } catch {
        return idwAt(x, y, neigh);
      }

      const vor = delaunay.voronoi([0, 0, width, height]);
      const polyQ = vor.cellPolygon(qi);
      if (!polyQ) return idwAt(x, y, neigh);

      let sumW = 0;
      let sumWV = 0;
      const eps = 1e-9;
      for (const j of delaunay.neighbors(qi)) {
        const pj = local[j];
        if (!pj) continue;
        const dist = Math.hypot(x - pj.x, y - pj.y);
        if (!(dist > eps)) {
          return pj.v;
        }
        const polyJ = vor.cellPolygon(j);
        const L = sharedEdgeLength(polyQ, polyJ);
        if (!(L > 1e-9)) continue;
        const w = L / dist;
        sumW += w;
        sumWV += w * pj.v;
      }

      if (!(sumW > 1e-12)) return idwAt(x, y, neigh);
      return sumWV / sumW;
    };

    const gridW = 80;
    const gridH = 56;
    const field = Array.from({ length: gridH }, () => Array.from({ length: gridW }, () => 0));

    for (let gy = 0; gy < gridH; gy++) {
      const y = (gy / (gridH - 1)) * height;
      for (let gx = 0; gx < gridW; gx++) {
        const x = (gx / (gridW - 1)) * width;
        let v = naturalNeighborAt(x, y);
        if (clampRange) v = clamp(v, clampRange.min, clampRange.max);
        field[gy][gx] = v;
      }
    }

    const smoothOnce = (src) => {
      const dst = Array.from({ length: gridH }, () => Array.from({ length: gridW }, () => 0));
      // 近似高斯核：[[1,2,1],[2,4,2],[1,2,1]] / 16
      const w00 = 1, w01 = 2, w02 = 1;
      const w10 = 2, w11 = 4, w12 = 2;
      const w20 = 1, w21 = 2, w22 = 1;
      const denom = 16;

      for (let y = 0; y < gridH; y++) {
        const y0 = Math.max(0, y - 1);
        const y1 = y;
        const y2 = Math.min(gridH - 1, y + 1);
        for (let x = 0; x < gridW; x++) {
          const x0 = Math.max(0, x - 1);
          const x1 = x;
          const x2 = Math.min(gridW - 1, x + 1);
          const v00 = src[y0][x0];
          const v01 = src[y0][x1];
          const v02 = src[y0][x2];
          const v10 = src[y1][x0];
          const v11 = src[y1][x1];
          const v12 = src[y1][x2];
          const v20 = src[y2][x0];
          const v21 = src[y2][x1];
          const v22 = src[y2][x2];

          let s = 0;
          s += w00 * v00 + w01 * v01 + w02 * v02;
          s += w10 * v10 + w11 * v11 + w12 * v12;
          s += w20 * v20 + w21 * v21 + w22 * v22;
          let out = s / denom;
          if (clampRange) out = clamp(out, clampRange.min, clampRange.max);
          dst[y][x] = out;
        }
      }
      return dst;
    };

    let smoothedField = field;
    for (let pass = 0; pass < smoothPasses; pass++) {
      smoothedField = smoothOnce(smoothedField);
    }

    return {
      field: smoothedField,
      min: Number.isFinite(minV) ? minV : null,
      max: Number.isFinite(maxV) ? maxV : null,
      gridW,
      gridH,
      width,
      height,
      points: pts,
      bounds: { minX, maxX, minY, maxY, pad },
    };
  }

  function computeFieldIdwWorld(samples, width = 500, height = 400, worldBounds, options) {
    const opts = options ?? {};
    const pad = Number.isFinite(opts.pad) ? Number(opts.pad) : 14;
    const clampRange = opts.clampRange && Number.isFinite(opts.clampRange.min) && Number.isFinite(opts.clampRange.max)
      ? { min: Number(opts.clampRange.min), max: Number(opts.clampRange.max) }
      : null;
    const kNearest = Number.isFinite(opts.kNearest) ? Math.max(4, Math.min(64, Math.round(opts.kNearest))) : 24;

    if (!samples || samples.length < 3) {
      return { field: null, min: null, max: null, gridW: 0, gridH: 0, width, height, points: [], bounds: null };
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let minV = Infinity, maxV = -Infinity;
    for (const p of samples) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.value)) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      minV = Math.min(minV, p.value);
      maxV = Math.max(maxV, p.value);
    }

    if (worldBounds && Number.isFinite(worldBounds.minX) && Number.isFinite(worldBounds.maxX) && Number.isFinite(worldBounds.minY) && Number.isFinite(worldBounds.maxY)) {
      if (worldBounds.maxX > worldBounds.minX && worldBounds.maxY > worldBounds.minY) {
        minX = worldBounds.minX;
        maxX = worldBounds.maxX;
        minY = worldBounds.minY;
        maxY = worldBounds.maxY;
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY) || maxX <= minX || maxY <= minY) {
      return { field: null, min: null, max: null, gridW: 0, gridH: 0, width, height, points: [], bounds: null };
    }

    const sx = (x) => pad + ((x - minX) / ((maxX - minX) || 1)) * (width - pad * 2);
    const sy = (y) => pad + (1 - (y - minY) / ((maxY - minY) || 1)) * (height - pad * 2);

    const pts = samples
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.value))
      .map((p) => ({
        x: sx(p.x),
        y: sy(p.y),
        v: clampRange ? clamp(p.value, clampRange.min, clampRange.max) : p.value,
      }));

    const idwAt = (x, y, neigh) => {
      const p = 2;
      const eps = 1e-6;
      let num = 0;
      let den = 0;
      for (const pt of neigh) {
        const dx = x - pt.x;
        const dy = y - pt.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < eps) return pt.v;
        const w = 1 / Math.pow(d2, p / 2);
        num += w * pt.v;
        den += w;
      }
      return num / (den || 1);
    };

    const selectKNearest = (x, y, k) => {
      const best = [];
      let worstD2 = -Infinity;
      let worstIdx = -1;
      for (const pt of pts) {
        const dx = x - pt.x;
        const dy = y - pt.y;
        const d2 = dx * dx + dy * dy;
        if (best.length < k) {
          best.push({ ...pt, d2 });
          if (d2 > worstD2) {
            worstD2 = d2;
            worstIdx = best.length - 1;
          }
        } else if (d2 < worstD2) {
          best[worstIdx] = { ...pt, d2 };
          worstD2 = -Infinity;
          worstIdx = -1;
          for (let i = 0; i < best.length; i++) {
            if (best[i].d2 > worstD2) {
              worstD2 = best[i].d2;
              worstIdx = i;
            }
          }
        }
      }
      best.sort((a, b) => a.d2 - b.d2);
      return best;
    };

    const gridW = 80;
    const gridH = 56;
    const field = Array.from({ length: gridH }, () => Array.from({ length: gridW }, () => 0));

    for (let gy = 0; gy < gridH; gy++) {
      const y = (gy / (gridH - 1)) * height;
      for (let gx = 0; gx < gridW; gx++) {
        const x = (gx / (gridW - 1)) * width;
        const neigh = selectKNearest(x, y, kNearest);
        let v = idwAt(x, y, neigh.length ? neigh : pts);
        if (clampRange) v = clamp(v, clampRange.min, clampRange.max);
        field[gy][gx] = v;
      }
    }

    return {
      field,
      min: Number.isFinite(minV) ? minV : null,
      max: Number.isFinite(maxV) ? maxV : null,
      gridW,
      gridH,
      width,
      height,
      points: pts,
      bounds: { minX, maxX, minY, maxY, pad },
    };
  }

  const sampleFieldAtWorldXY = (fieldPack, worldX, worldY) => {
    if (!fieldPack?.field || !fieldPack.gridW || !fieldPack.gridH) return null;
    const b = fieldPack?.bounds;
    if (!b || !Number.isFinite(b.minX) || !Number.isFinite(b.maxX) || !Number.isFinite(b.minY) || !Number.isFinite(b.maxY)) return null;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
    const width = Number(fieldPack.width ?? 320);
    const height = Number(fieldPack.height ?? 220);
    const pad = Number(b.pad ?? 14);
    const minX = b.minX;
    const maxX = b.maxX;
    const minY = b.minY;
    const maxY = b.maxY;
    // 与 computeField 的 sx/sy 对齐
    const sx = pad + ((worldX - minX) / ((maxX - minX) || 1)) * (width - pad * 2);
    const sy = pad + (1 - (worldY - minY) / ((maxY - minY) || 1)) * (height - pad * 2);

    const grid = fieldPack.field;
    const gridH = grid.length;
    const gridW = grid[0]?.length ?? 0;
    if (gridW < 2 || gridH < 2) return null;
    const gx = clamp((sx / width) * (gridW - 1), 0, gridW - 1);
    const gy = clamp((sy / height) * (gridH - 1), 0, gridH - 1);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(gridW - 1, x0 + 1);
    const y1 = Math.min(gridH - 1, y0 + 1);
    const tx = gx - x0;
    const ty = gy - y0;
    const v00 = grid[y0][x0];
    const v10 = grid[y0][x1];
    const v01 = grid[y1][x0];
    const v11 = grid[y1][x1];
    const v0 = v00 * (1 - tx) + v10 * tx;
    const v1 = v01 * (1 - tx) + v11 * tx;
    const v = v0 * (1 - ty) + v1 * ty;
    return Number.isFinite(v) ? v : null;
  };

  const contourData = useMemo(() => {
    return {
      Ti: computeField(boreholeParamSamples.Ti),
      Ei: computeField(boreholeParamSamples.Ei),
      Hi: computeField(boreholeParamSamples.Hi),
      Di: computeField(boreholeParamSamples.Di),
      Mi: computeField(boreholeParamSamples.Mi),
    };
  }, [boreholeParamSamples]);

  const coalThicknessField = useMemo(() => {
    return computeField(boreholeParamSamples.CoalThk);
  }, [boreholeParamSamples]);

  const handleExtractGeologyInterpolatedParams = () => {
    // “地质插值提取”：边界点 + 采区坐标点
    // - Ti/Ei/Hi/Di：由钻孔分层数据生成的插值场提取
    // - Mi：插值提取目标煤层厚度（煤厚）
    if (!(drillholeData?.length >= 3) || Object.keys(drillholeLayersById ?? {}).length === 0) {
      window.alert('请先导入“钻孔坐标数据”和“钻孔分层数据”。');
      return;
    }
    if (!(boundaryData?.length >= 1)) {
      window.alert('请先导入“采区边界坐标”。');
      return;
    }
    if (!(boreholeParamSamples?.Ti?.length >= 3) || !(boreholeParamSamples?.Di?.length >= 3) || !(boreholeParamSamples?.Ei?.length >= 3)) {
      window.alert('地质插值提取需要足够的钻孔样本（Ti/Di/Ei 至少 3 个有效点）。');
      return;
    }
    if (!(boreholeParamSamples?.CoalThk?.length >= 3)) {
      window.alert('地质插值提取需要“目标煤层厚度（煤厚）”样本：请先确认已选择目标煤层且钻孔分层中含该煤层。');
      return;
    }

    const ts = new Date();
    const stamp = ts.toISOString();

    const boundaryPts = computeEvalBoundaryRectFromDrillholes(drillholeData)
      .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p, idx) => ({ ...p, id: `BND-${idx + 1}`, __cat: 'gray' }));

    const areaPts = (boundaryData ?? [])
      .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p, idx) => ({ ...p, id: String(p?.id ?? `AREA-${idx + 1}`), __cat: 'blue' }));

    const geologyPts = (drillholeData ?? [])
      .filter((p) => p && String(p.id ?? '').trim() && Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => ({ ...p, id: String(p.id ?? '').trim(), __cat: 'geo' }));

    const uniq = new Map();
    for (const p of [...geologyPts, ...boundaryPts, ...areaPts]) {
      const id = String(p?.id ?? '').trim();
      if (!id) continue;
      const k = `${id}@@${Number(p.x).toFixed(6)}@@${Number(p.y).toFixed(6)}`;
      if (!uniq.has(k)) uniq.set(k, p);
    }
    const pts = Array.from(uniq.values());

    const extracted = pts.map((p) => {
      const Ti = sampleFieldAtWorldXY(contourData.Ti, p.x, p.y);
      const Ei = sampleFieldAtWorldXY(contourData.Ei, p.x, p.y);
      const Hi = sampleFieldAtWorldXY(contourData.Hi, p.x, p.y);
      const Di = sampleFieldAtWorldXY(contourData.Di, p.x, p.y);
      const Mi = sampleFieldAtWorldXY(coalThicknessField, p.x, p.y);
      return {
        id: String(p.id ?? ''),
        cat: p.__cat,
        faceIndex: null,
        x: p.x,
        y: p.y,
        Ti,
        Ei: Number.isFinite(Ei) ? Ei : null,
        Hi,
        Di,
        Mi: Number.isFinite(Mi) ? Mi : null,
        delta: 0,
        lpi: 0,
        lci: 0,
        trueCoalThk: Number.isFinite(Mi) ? Mi : null,
        inWorkface: false,
        onWorkfaceEdge: false,
      };
    });

    setLastParamExtractionMode('geo');
    setParamExtractionResult({
      doneAt: stamp,
      points: extracted,
      geology: {
        boundaryCtrl: extracted.filter((p) => p.cat === 'blue'),
        workfaceCtrl: [],
      },
      mining: {
        evalPoints: [],
      },
      summary: {
        geologyEvalCount: extracted.filter((p) => p.cat === 'geo').length,
        generatedEvalCount: extracted.filter((p) => p.cat !== 'geo').length,
        evalPointCount: extracted.length,
      },
    });
    setOdiResult(null);
  };

  const handleExtractHighPrecisionParams = () => {
    if (!generatedPoints) return;

    const ts = new Date();
    const stamp = ts.toISOString();

    // Step 2.1：开采参数提取（所有评价点：灰/蓝/粉/绿/红）
    const faces = (generatedPoints?.faces ?? []).filter((f) => f?.corners?.length === 4);
    const faceByIndex = new Map(faces.map((f) => [f.faceIndex, f]));

    const pointHitsFace = (p, f, eps = 1e-6) => {
      // 面内 or 在边界线上：都认为“在工作面中”
      if (!f?.corners?.length) return false;
      if (polygonContainsPoint(f.corners, p)) return true;
      const d = minDistToPolyEdges(p, f.corners);
      return Number.isFinite(d) && d <= eps;
    };

    const findHitFace = (p) => {
      for (const f of faces) {
        if (pointHitsFace(p, f, 1e-6)) return f;
      }
      return null;
    };

    const getMineHeightForFace = (faceIndex) => {
      // 按工作面编号取采高：三个场景都支持；若未设置则回退到全局输入
      if (Number.isFinite(Number(faceIndex)) && Number(faceIndex) >= 1) {
        const i = Math.round(Number(faceIndex)) - 1;
        const byFace = activeTab === 'surface'
          ? surfaceMineHeightByFace
          : (activeTab === 'upward' ? upwardMineHeightByFace : aquiferMineHeightByFace);
        const v = Number(byFace?.[i]);
        if (Number.isFinite(v) && v > 0) return v;
      }
      const v = Number(mineActualHeightM);
      return Number.isFinite(v) && v > 0 ? v : 0;
    };

    const getRoofCavingAngleForFace = (faceIndex) => {
      // 按工作面编号取 δ：三个场景都支持；若未设置则回退到全局输入
      if (Number.isFinite(Number(faceIndex)) && Number(faceIndex) >= 1) {
        const i = Math.round(Number(faceIndex)) - 1;
        const byFace = activeTab === 'surface'
          ? surfaceRoofCavingAngleByFace
          : (activeTab === 'upward' ? upwardRoofCavingAngleByFace : aquiferRoofCavingAngleByFace);
        const v = Number(byFace?.[i]);
        if (Number.isFinite(v)) return v;
      }
      const v = Number(roofCavingAngleDeg);
      return Number.isFinite(v) ? v : 0;
    };

    // lci（区段煤柱）提取规则（3 个场景一致）：
    // - 仅 1 个工作面：所有点 lci=0
    // - >=2 个工作面：相邻工作面之间的间距 = “短边中线（长轴中心线）的垂直距离 - 两工作面宽度(短边长度)之和”
    //   仅对“工作面中心点”赋值（每个工作面选取其 -ZX 点中离质心最近的 1 个作为中心点），其它点均为 0

    const getLineMidAndDir = (corners) => {
      const cl = getWorkfaceCenterline(corners);
      if (!cl?.a || !cl?.b) return null;
      const dRaw = sub(cl.b, cl.a);
      const dLen = Math.sqrt(dRaw.x * dRaw.x + dRaw.y * dRaw.y);
      if (!Number.isFinite(dLen) || dLen <= 1e-9) return null;
      const dir = { x: dRaw.x / dLen, y: dRaw.y / dLen };
      const mid = { x: (cl.a.x + cl.b.x) / 2, y: (cl.a.y + cl.b.y) / 2 };
      return { mid, dir };
    };

    const getPerpDistBetweenCenterlines = (f, g) => {
      const lf = getLineMidAndDir(f?.corners);
      const lg = getLineMidAndDir(g?.corners);
      if (!lf || !lg) return null;
      // 用两条中心线方向的“平均方向”作为共同法向，减少导入点顺序差异导致的抖动
      let avgDir = add(lf.dir, lg.dir);
      const avgLen = Math.sqrt(avgDir.x * avgDir.x + avgDir.y * avgDir.y);
      if (!Number.isFinite(avgLen) || avgLen <= 1e-9) avgDir = lf.dir;
      else avgDir = { x: avgDir.x / avgLen, y: avgDir.y / avgLen };
      const n = { x: -avgDir.y, y: avgDir.x }; // 法向
      const v = sub(lg.mid, lf.mid);
      const d = Math.abs(dot(v, n));
      return Number.isFinite(d) ? d : null;
    };

    const isZXCenterPoint = (p) => String(p?.id ?? '').includes('ZX');

    const faceLci = new Map();
    if (faces.length <= 1) {
      // 只有一个工作面：所有点均为 0（这里仍写入 map 便于统一读取）
      if (faces[0]) faceLci.set(faces[0].faceIndex, 0);
    } else {
      const sortedFaces = [...faces].sort((a, b) => Number(a.faceIndex) - Number(b.faceIndex));
      const pairGap = new Map(); // key: "i-j" => gap
      const key = (i, j) => `${i}-${j}`;
      for (let i = 0; i < sortedFaces.length - 1; i++) {
        const f = sortedFaces[i];
        const g = sortedFaces[i + 1];
        const fi = Math.round(Number(f.faceIndex));
        const gi = Math.round(Number(g.faceIndex));
        const d = getPerpDistBetweenCenterlines(f, g);
        // “短边中线垂直距离 - 工作面宽度(短边长度)”：这里按几何口径用“半宽之和”扣除
        // 也就是 gap = d - (Wf/2 + Wg/2) = d - (Wf + Wg)/2
        const widthHalfSum = (Number(f.shortLen) + Number(g.shortLen)) / 2;
        let gap = null;
        if (Number.isFinite(d) && Number.isFinite(widthHalfSum)) {
          gap = d - widthHalfSum;
          if (!Number.isFinite(gap)) gap = null;
        }
        // 按要求：若计算失败/为负则按 0 处理
        gap = Number.isFinite(gap) && gap > 0 ? gap : 0;
        pairGap.set(key(fi, gi), gap);
      }

      for (let idx = 0; idx < sortedFaces.length; idx++) {
        const f = sortedFaces[idx];
        const fi = Math.round(Number(f.faceIndex));
        let left = null;
        let right = null;
        if (idx - 1 >= 0) {
          const li = Math.round(Number(sortedFaces[idx - 1].faceIndex));
          left = pairGap.get(key(li, fi));
        }
        if (idx + 1 < sortedFaces.length) {
          const ri = Math.round(Number(sortedFaces[idx + 1].faceIndex));
          right = pairGap.get(key(fi, ri));
        }
        let v = 0;
        if (Number.isFinite(left) && Number.isFinite(right)) v = Math.min(left, right);
        else if (Number.isFinite(left)) v = left;
        else if (Number.isFinite(right)) v = right;
        faceLci.set(fi, Number.isFinite(v) ? v : 0);
      }
    }

    const evalPoints = [];
    for (const k of ['gray', 'blue', 'pink', 'green', 'red']) {
      const arr = (generatedPoints?.[k] ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      for (const p of arr) evalPoints.push({ ...p, __cat: k });
    }

    // δ：对 aquifer 按工作面匹配；其它场景为全局常量

    const computeLpiForPoint = (p, hitFace, isCenterlineGenerated) => {
      if (!hitFace) return 0;
      if (isCenterlineGenerated) return hitFace.shortLen;
      const dMin = minDistToPolyEdges(p, hitFace.corners);
      return Number.isFinite(dMin) ? (dMin * 2) : 0;
    };

    const miningAtEvalPoints = evalPoints.map((p) => {
      const hitFace = findHitFace(p);
      const inWorkface = Boolean(hitFace);
      const trueCoalThk = sampleFieldAtWorldXY(coalThicknessField, p.x, p.y);
      const M = getMineHeightForFace(hitFace?.faceIndex ?? null);
      const delta = getRoofCavingAngleForFace(hitFace?.faceIndex ?? null);
      let MiPoint = 0;
      if (inWorkface) {
        const t = Number(trueCoalThk);
        if (Number.isFinite(t) && t > 0 && Number.isFinite(M) && M > 0) {
          MiPoint = t > M ? M : t;
        } else if (Number.isFinite(t) && t > 0 && !(Number.isFinite(M) && M > 0)) {
          // 若未提供实际采高，则退化为“采高=真实煤厚”
          MiPoint = t;
        } else {
          MiPoint = 0;
        }
      } else {
        MiPoint = 0;
      }

      const faceIndex = hitFace?.faceIndex ?? null;
      const isCenterlineGenerated = p.__cat === 'red' || String(p.id ?? '').includes('-ZX');
      const lpi = computeLpiForPoint(p, hitFace, isCenterlineGenerated);
      const lci = (hitFace && isZXCenterPoint(p)) ? (faceLci.get(hitFace.faceIndex) ?? 0) : 0;

      // 地质参数：对所有评价点统一插值
      const Ti = sampleFieldAtWorldXY(contourData.Ti, p.x, p.y);
      const Hi = sampleFieldAtWorldXY(contourData.Hi, p.x, p.y);
      const Di = sampleFieldAtWorldXY(contourData.Di, p.x, p.y);

      return {
        id: String(p.id ?? ''),
        cat: p.__cat,
        faceIndex,
        x: p.x,
        y: p.y,
        Ti,
        Ei: 0,
        Hi,
        Di,
        Mi: MiPoint,
        delta,
        lpi,
        lci,
        trueCoalThk: Number.isFinite(trueCoalThk) ? trueCoalThk : null,
        inWorkface,
        onWorkfaceEdge: inWorkface ? (Number.isFinite(minDistToPolyEdges(p, hitFace?.corners ?? [])) && minDistToPolyEdges(p, hitFace?.corners ?? []) <= 1e-6) : false,
      };
    });

    // 地质评价点（钻孔坐标点）：纳入“所有评价点”导出
    const geologyEvalPoints = (drillholeData ?? [])
      .filter((p) => p && String(p.id ?? '').trim() && Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => {
        const hitFace = findHitFace(p);
        const inWorkface = Boolean(hitFace);
        const trueCoalThk = sampleFieldAtWorldXY(coalThicknessField, p.x, p.y);

        const M = getMineHeightForFace(hitFace?.faceIndex ?? null);
        const delta = getRoofCavingAngleForFace(hitFace?.faceIndex ?? null);
        let MiPoint = 0;
        if (inWorkface) {
          const t = Number(trueCoalThk);
          if (Number.isFinite(t) && t > 0 && Number.isFinite(M) && M > 0) {
            MiPoint = t > M ? M : t;
          } else if (Number.isFinite(t) && t > 0 && !(Number.isFinite(M) && M > 0)) {
            MiPoint = t;
          } else {
            MiPoint = 0;
          }
        } else {
          MiPoint = 0;
        }

        const faceIndex = hitFace?.faceIndex ?? null;
        const lpi = computeLpiForPoint(p, hitFace, false);
        const lci = (hitFace && isZXCenterPoint(p)) ? (faceLci.get(hitFace.faceIndex) ?? 0) : 0;

        const Ti = sampleFieldAtWorldXY(contourData.Ti, p.x, p.y);
        const Hi = sampleFieldAtWorldXY(contourData.Hi, p.x, p.y);
        const Di = sampleFieldAtWorldXY(contourData.Di, p.x, p.y);

        return {
          id: String(p.id ?? ''),
          cat: 'geo',
          faceIndex,
          x: p.x,
          y: p.y,
          Ti,
          Ei: 0,
          Hi,
          Di,
          Mi: MiPoint,
          delta,
          lpi,
          lci,
          trueCoalThk: Number.isFinite(trueCoalThk) ? trueCoalThk : null,
          inWorkface,
          onWorkfaceEdge: inWorkface ? (Number.isFinite(minDistToPolyEdges(p, hitFace?.corners ?? [])) && minDistToPolyEdges(p, hitFace?.corners ?? []) <= 1e-6) : false,
        };
      });

    // 兼容：仍保留“地质控制点”两个分组（便于后续独立查看/校验）
    const geologyAtBoundaryCtrl = miningAtEvalPoints.filter((p) => p.cat === 'blue');
    const geologyAtWorkfaceCtrl = miningAtEvalPoints.filter((p) => p.cat === 'pink');

    const allPoints = [...geologyEvalPoints, ...miningAtEvalPoints];

    setParamExtractionResult({
      doneAt: stamp,
      points: allPoints,
      geology: {
        boundaryCtrl: geologyAtBoundaryCtrl,
        workfaceCtrl: geologyAtWorkfaceCtrl,
      },
      mining: {
        evalPoints: miningAtEvalPoints,
      },
      summary: {
        geologyEvalCount: geologyEvalPoints.length,
        generatedEvalCount: miningAtEvalPoints.length,
        evalPointCount: allPoints.length,
      },
    });
    setLastParamExtractionMode('full');
    setOdiResult(null);
  };

  const ODI_MATRIX = useMemo(() => {
    // 行：Di, Ei, Hi, lci, lpi, Mi, Ti, δi
    // 列：Smax, DSmax, Kσ, Dσmax, Aσ, Hf, Kw, Bf, Af
    return {
      rowKeys: ['Di', 'Ei', 'Hi', 'lci', 'lpi', 'Mi', 'Ti', 'delta'],
      colKeys: ['Smax', 'DSmax', 'Ksi', 'Dsi', 'Asi', 'Hf', 'Kw', 'Bf', 'Af'],
      W: [
        [0.057389, 0,        0.024286, 0.058885, 0.196652, 0.026673, 0.044067, 0.015795, 0.045139],
        [0.314349, 0.105842, 0,        0,        0,        0,        0,        0,        0],
        [0.061192, 0.049348, 0.047564, 0.044506, 0.175154, 0.611954, 0.115051, 0.319025, 0.062264],
        [0,        0.290717, 0.309626, 0.117770, 0.034283, 0,        0,        0.214748, 0.147835],
        [0.124117, 0.366249, 0.088621, 0.382754, 0.064932, 0,        0,        0.044108, 0.106237],
        [0.101988, 0,        0.102697, 0.121286, 0.243085, 0.143936, 0.589151, 0.128533, 0.335152],
        [0.190565, 0.086577, 0.154086, 0.039257, 0.212361, 0.217437, 0.251731, 0.131501, 0.154793],
        [0.150401, 0.101268, 0.273120, 0.235541, 0.073533, 0,        0,        0.146290, 0.148581],
      ],
    };
  }, []);

  const isRowDegenerate = (vals) => {
    const xs = (vals ?? []).filter((v) => Number.isFinite(v));
    if (xs.length === 0) return true;
    const allZero = xs.every((v) => Math.abs(v) <= 1e-12);
    if (allZero) return true;
    const v0 = xs[0];
    const allSame = xs.every((v) => Math.abs(v - v0) <= 1e-12);
    return allSame;
  };

  const renormalizeColumns = (W) => {
    const out = W.map((r) => [...r]);
    if (!out.length) return out;
    const cols = out[0].length;
    for (let j = 0; j < cols; j++) {
      let s = 0;
      for (let i = 0; i < out.length; i++) s += Number(out[i][j]) || 0;
      if (s <= 1e-12) continue;
      for (let i = 0; i < out.length; i++) out[i][j] = (Number(out[i][j]) || 0) / s;
    }
    return out;
  };

  const mulXW = (X, W) => {
    // X: N x R, W: R x C => N x C
    const N = X.length;
    const R = W.length;
    const C = W[0]?.length ?? 0;
    const out = Array.from({ length: N }, () => Array.from({ length: C }, () => 0));
    for (let n = 0; n < N; n++) {
      for (let c = 0; c < C; c++) {
        let s = 0;
        for (let r = 0; r < R; r++) s += (Number(X[n][r]) || 0) * (Number(W[r][c]) || 0);
        out[n][c] = s;
      }
    }
    return out;
  };

  const computeOdi = (points, weights) => {
    const pts = (points ?? []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (!pts.length) return null;

    const w = weights ?? { wd: 0.45, wo: 0.30, wf: 0.25 };
    const sumW = Number(w.wd) + Number(w.wo) + Number(w.wf);
    if (!Number.isFinite(sumW) || Math.abs(sumW - 1) > 1e-6) {
      return { error: '权重约束：wd + wo + wf 必须等于 1', points: [] };
    }

    const rowKeys = ODI_MATRIX.rowKeys;
    const W0 = ODI_MATRIX.W;

    // 收集每行（因子）在所有点的值，用于剔除
    const rowVals = new Map(rowKeys.map((k) => [k, []]));
    for (const p of pts) {
      rowVals.get('Di').push(Number(p.Di) || 0);
      rowVals.get('Ei').push(Number(p.Ei) || 0);
      rowVals.get('Hi').push(Number(p.Hi) || 0);
      rowVals.get('lci').push(Number(p.lci) || 0);
      rowVals.get('lpi').push(Number(p.lpi) || 0);
      rowVals.get('Mi').push(Number(p.Mi) || 0);
      rowVals.get('Ti').push(Number(p.Ti) || 0);
      rowVals.get('delta').push(Number(p.delta) || 0);
    }

    const keepIdx = [];
    const keptKeys = [];
    for (let i = 0; i < rowKeys.length; i++) {
      const k = rowKeys[i];
      const vals = rowVals.get(k) ?? [];
      if (!isRowDegenerate(vals)) {
        keepIdx.push(i);
        keptKeys.push(k);
      }
    }

    const Wk = keepIdx.map((i) => W0[i]);
    const Wn = renormalizeColumns(Wk);

    const X = pts.map((p) => {
      const full = [
        Number(p.Di) || 0,
        Number(p.Ei) || 0,
        Number(p.Hi) || 0,
        Number(p.lci) || 0,
        Number(p.lpi) || 0,
        Number(p.Mi) || 0,
        Number(p.Ti) || 0,
        Number(p.delta) || 0,
      ];
      return keepIdx.map((idx) => full[idx]);
    });

    const R = mulXW(X, Wn);
    const pointsOut = [];
    let minOdi = Infinity;
    let maxOdi = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const row = R[i];
      const Smax = row[0];
      const DSmax = row[1];
      const Ksi = row[2];
      const Dsi = row[3];
      const Asi = row[4];
      const Hf = row[5];
      const Kw = row[6];
      const Bf = row[7];
      const Af = row[8];
      const wd = (Smax || 0) + (DSmax || 0);
      const wo = (Ksi || 0) + (Dsi || 0) + (Asi || 0);
      const wf = (Hf || 0) + (Kw || 0) + (Bf || 0) + (Af || 0);
      const odi = Number(w.wd) * wd + Number(w.wo) * wo + Number(w.wf) * wf;
      if (Number.isFinite(odi)) {
        minOdi = Math.min(minOdi, odi);
        maxOdi = Math.max(maxOdi, odi);
      }

      pointsOut.push({
        ...pts[i],
        indicators: { Smax, DSmax, Ksi, Dsi, Asi, Hf, Kw, Bf, Af },
        wd,
        wo,
        wf,
        odi,
      });
    }

    const denom = (maxOdi - minOdi) || 1;
    const pointsNorm = pointsOut.map((p) => ({
      ...p,
      odiNorm: Number.isFinite(p.odi) ? (p.odi - minOdi) / denom : null,
    }));

    return {
      keptFactorKeys: keptKeys,
      weights: { ...w },
      minOdi: Number.isFinite(minOdi) ? minOdi : null,
      maxOdi: Number.isFinite(maxOdi) ? maxOdi : null,
      points: pointsNorm,
    };
  };

  const normalizeCoords = (points, boundsPoints = points) => {
    // 主图绘图区：尽量铺满 viewBox（800×500），横向更宽；并略向上移动
    const rect = { left: 10, top: 10, width: 780, height: 470 };
    const padding = 18;
    const x0 = rect.left + padding;
    const x1 = rect.left + rect.width - padding;
    const y0 = rect.top + padding;
    const y1 = rect.top + rect.height - padding;
    const w = x1 - x0;
    const h = y1 - y0;

    if (!points || points.length === 0) return [];
    const boundsSrc = boundsPoints && boundsPoints.length > 0 ? boundsPoints : points;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of boundsSrc) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    const safeRangeX = rangeX === 0 ? 1 : rangeX;
    const safeRangeY = rangeY === 0 ? 1 : rangeY;

    return points.map((p) => {
      const nx = x0 + ((p.x - minX) / safeRangeX) * w;
      // 反转 y：地理坐标 y 越大越靠上
      const ny = y1 - ((p.y - minY) / safeRangeY) * h;
      return { ...p, nx, ny };
    });
  };

  const hasBoundaryData = boundaryData.length > 0;
  const hasDrillholeData = drillholeData.length > 0;
  const hasWorkingFaceData = (workingFaceData?.length ?? 0) > 0;
  const hasMeasuredConstraintData = (measuredConstraintData?.length ?? 0) > 0;
  const hasSpatialData = hasBoundaryData || hasDrillholeData || hasWorkingFaceData || hasMeasuredConstraintData;
  const combinedPointsForBounds = hasSpatialData
    ? [...boundaryData, ...drillholeData, ...(workingFaceDataTagged ?? []), ...(measuredConstraintData ?? [])]
    : [];

  const spatialBounds = useMemo(() => {
    if (!combinedPointsForBounds.length) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of combinedPointsForBounds) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
    return { minX, maxX, minY, maxY, rangeX: (maxX - minX) || 1, rangeY: (maxY - minY) || 1 };
  }, [combinedPointsForBounds]);

  const MAIN_MAP_RECT = useMemo(() => ({ left: 10, top: 10, width: 780, height: 470, padding: 18 }), []);

  const getSvgCoordsFromMouseEvent = (evt) => {
    const svg = mainMapSvgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const vb = svg.viewBox?.baseVal;
    const vbX = vb?.x ?? 0;
    const vbY = vb?.y ?? 0;
    const vbW = vb?.width ?? 800;
    const vbH = vb?.height ?? 500;
    const nx = (evt.clientX - rect.left) / rect.width;
    const ny = (evt.clientY - rect.top) / rect.height;
    const sx = vbX + nx * vbW;
    const sy = vbY + ny * vbH;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
    return { sx, sy };
  };

  const handleMainMapMouseMove = (evt) => {
    const pos = getSvgCoordsFromMouseEvent(evt);
    if (!pos) return;

    const { sx, sy } = pos;
    const x0 = MAIN_MAP_RECT.left + MAIN_MAP_RECT.padding;
    const x1 = MAIN_MAP_RECT.left + MAIN_MAP_RECT.width - MAIN_MAP_RECT.padding;
    const y0 = MAIN_MAP_RECT.top + MAIN_MAP_RECT.padding;
    const y1 = MAIN_MAP_RECT.top + MAIN_MAP_RECT.height - MAIN_MAP_RECT.padding;

    const inside = sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
    if (!inside || !spatialBounds) {
      setCrosshair((p) => (p.active ? { ...p, active: false } : p));
      return;
    }

    const wx = spatialBounds.minX + ((sx - x0) / ((x1 - x0) || 1)) * spatialBounds.rangeX;
    const wy = spatialBounds.minY + ((y1 - sy) / ((y1 - y0) || 1)) * spatialBounds.rangeY;

    const odiNorm = sampleFieldAtWorldXY(odiFieldPack, wx, wy);
    const Mi = sampleFieldAtWorldXY(coalThicknessField, wx, wy);

    setCrosshair({
      active: true,
      sx,
      sy,
      wx,
      wy,
      values: { odiNorm, Mi },
    });
  };

  const handleMainMapMouseLeave = () => {
    setCrosshair((p) => (p.active ? { ...p, active: false } : p));
    setPlanningWorkfaceHover(null);
  };

  const handleMainMapClick = (evt) => {
    if (!measureEnabled) return;
    const pos = getSvgCoordsFromMouseEvent(evt);
    if (!pos || !spatialBounds) return;

    const { sx, sy } = pos;
    const x0 = MAIN_MAP_RECT.left + MAIN_MAP_RECT.padding;
    const x1 = MAIN_MAP_RECT.left + MAIN_MAP_RECT.width - MAIN_MAP_RECT.padding;
    const y0 = MAIN_MAP_RECT.top + MAIN_MAP_RECT.padding;
    const y1 = MAIN_MAP_RECT.top + MAIN_MAP_RECT.height - MAIN_MAP_RECT.padding;

    const inside = sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
    if (!inside) return;

    const wx = spatialBounds.minX + ((sx - x0) / ((x1 - x0) || 1)) * spatialBounds.rangeX;
    const wy = spatialBounds.minY + ((y1 - sy) / ((y1 - y0) || 1)) * spatialBounds.rangeY;
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;

    const nextPoint = { sx, sy, wx, wy };
    setMeasurePoints((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      if (arr.length >= 2) return [nextPoint];
      return [...arr, nextPoint];
    });
  };

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setMeasureEnabled(false);
        setMeasurePoints([]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const normalizedBoundaryData = hasBoundaryData ? normalizeCoords(boundaryData, combinedPointsForBounds) : [];
  const normalizedDrillholeData = hasDrillholeData ? normalizeCoords(drillholeData, combinedPointsForBounds) : [];
  const normalizedWorkingFaceData = hasWorkingFaceData ? normalizeCoords(workingFaceDataTagged, combinedPointsForBounds) : [];
  const normalizedMeasuredConstraintData = (hasMeasuredConstraintData && combinedPointsForBounds.length)
    ? normalizeCoords(measuredConstraintData, combinedPointsForBounds)
    : [];

  const computeNonSelfIntersectingLoop = (points, getX, getY) => {
    const raw = (points ?? [])
      .map((p) => ({ x: Number(getX(p)), y: Number(getY(p)) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

    const uniq = new Map();
    for (const p of raw) {
      const k = `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
      if (!uniq.has(k)) uniq.set(k, p);
    }
    const pts = Array.from(uniq.values());
    if (pts.length <= 2) return pts;

    const c = pts.reduce(
      (acc, p) => ({ x: acc.x + p.x / pts.length, y: acc.y + p.y / pts.length }),
      { x: 0, y: 0 }
    );
    pts.sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));

    const segIntersects = (a, b, c2, d) => {
      const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const onSeg = (p, q, r) => (
        Math.min(p.x, r.x) - 1e-9 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-9 &&
        Math.min(p.y, r.y) - 1e-9 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-9
      );
      const o1 = orient(a, b, c2);
      const o2 = orient(a, b, d);
      const o3 = orient(c2, d, a);
      const o4 = orient(c2, d, b);
      if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) return true;
      if (Math.abs(o1) < 1e-9 && onSeg(a, c2, b)) return true;
      if (Math.abs(o2) < 1e-9 && onSeg(a, d, b)) return true;
      if (Math.abs(o3) < 1e-9 && onSeg(c2, a, d)) return true;
      if (Math.abs(o4) < 1e-9 && onSeg(c2, b, d)) return true;
      return false;
    };

    const n = pts.length;
    const nextIdx = (i) => (i + 1) % n;
    let improved = true;
    let guard = 0;
    while (improved && guard < 2000) {
      improved = false;
      guard++;
      for (let i = 0; i < n; i++) {
        const i2 = nextIdx(i);
        for (let j = i + 2; j < n; j++) {
          const j2 = nextIdx(j);
          if (i === j2) continue;
          const a = pts[i];
          const b = pts[i2];
          const c2 = pts[j];
          const d = pts[j2];
          if (segIntersects(a, b, c2, d)) {
            let l = i2;
            let r = j;
            while (l < r) {
              const tmp = pts[l];
              pts[l] = pts[r];
              pts[r] = tmp;
              l++;
              r--;
            }
            improved = true;
          }
          if (improved) break;
        }
        if (improved) break;
      }
    }
    return pts;
  };

  // 渲染级清理：消除重复点/极短边/近共线点，避免虚线边界出现“短线/毛刺”。
  // 注意：仅用于屏幕坐标（nx/ny）loop；不要拿它改 world 坐标几何以免影响计算。
  const sanitizeRenderLoop = (pts0, { minSegLen = 1.5, collinearSin = 0.01 } = {}) => {
    const pts = (Array.isArray(pts0) ? pts0 : [])
      .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length < 3) return pts;

    const dist = (a, b) => {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.hypot(dx, dy);
    };

    // 1) 去掉连续重复点/极短边
    const a1 = [];
    for (const p of pts) {
      const prev = a1[a1.length - 1];
      if (prev && dist(prev, p) < Math.max(0.2, minSegLen * 0.25)) continue;
      a1.push(p);
    }
    if (a1.length < 3) return a1;

    const a2 = [a1[0]];
    for (let i = 1; i < a1.length; i++) {
      const p = a1[i];
      const prev = a2[a2.length - 1];
      if (prev && dist(prev, p) < minSegLen) continue;
      a2.push(p);
    }
    if (a2.length < 3) return a2;

    // 2) 删除近共线点（方向一致时）
    const isNearCollinear = (p0, p1, p2) => {
      const ax = p1.x - p0.x;
      const ay = p1.y - p0.y;
      const bx = p2.x - p1.x;
      const by = p2.y - p1.y;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (!(la > 1e-9 && lb > 1e-9)) return true;
      const cross = ax * by - ay * bx;
      const sin = Math.abs(cross) / (la * lb);
      const dot = ax * bx + ay * by;
      return sin <= collinearSin && dot >= 0;
    };

    let out = a2;
    for (let pass = 0; pass < 2; pass++) {
      if (out.length < 4) break;
      const b = [];
      for (let i = 0; i < out.length; i++) {
        const pPrev = out[(i - 1 + out.length) % out.length];
        const p = out[i];
        const pNext = out[(i + 1) % out.length];
        // 保留 3 点以上的闭环：删除近共线点
        if (out.length > 3 && isNearCollinear(pPrev, p, pNext)) continue;
        b.push(p);
      }
      // 避免删到不成形
      if (b.length >= 3) out = b;
    }

    return out.length >= 3 ? out : a2;
  };

  const normalizedBoundaryLoop = useMemo(() => {
    if (!hasBoundaryData || !normalizedBoundaryData?.length) return [];
    const pts0 = computeNonSelfIntersectingLoop(normalizedBoundaryData, (p) => p?.nx, (p) => p?.ny);
    const pts = sanitizeRenderLoop(pts0, { minSegLen: 1.6, collinearSin: 0.012 });
    return pts.map((p) => ({ nx: p.x, ny: p.y }));
  }, [hasBoundaryData, normalizedBoundaryData]);

  const boundaryLoopWorld = useMemo(() => {
    if (!hasBoundaryData || !boundaryData?.length) return [];
    return computeNonSelfIntersectingLoop(boundaryData, (p) => p?.x, (p) => p?.y);
  }, [hasBoundaryData, boundaryData]);

  // 工程效率模式：轴向/煤柱/面宽/边界等输入变化时，自动触发重算（或命中缓存切换）。
  // 注意：`boundaryLoopWorld` 在文件更靠后的位置声明（useMemo），因此该 hook 必须放在它之后。
  const efficiencyAutoRecomputeDebounceRef = useRef(null);
  useEffect(() => {
    if (mainViewMode !== 'planning') return;
    if (planningOptMode !== 'efficiency') return;
    if (!boundaryLoopWorld?.length || boundaryLoopWorld.length < 3) return;

    const cacheKey = buildEfficiencyCacheKey();
    planningEfficiencyCacheKeyRef.current = String(cacheKey);
    setPlanningEfficiencyCacheKey(cacheKey);

    // 若 cache 中已有结果，直接切换（不必再次计算）
    const cached = efficiencyCacheRef.current.get(cacheKey);
    const axisNow = (String(planningParams?.roadwayOrientation ?? 'x') === 'y') ? 'y' : 'x';
    const cachedAxis = String(cached?.result?.axis ?? '');
    const cachedSig = String(
      cached?.selectedSig
      || cached?.result?.bestKey
      || cached?.result?.selectedCandidateKey
      || cached?.result?.bestSignature
      || (cached?.result?.candidates?.[0]?.signature ?? '')
      || ''
    );
    const cachedLooksConsistent = cached?.result?.ok
      && cachedAxis === axisNow
      && cachedSig.startsWith(`${axisNow}|`);

    if (cachedLooksConsistent) {
      // 避免重复 setState 抖动：若当前已是同 key 的结果就不重复应用
      if (String(planningEfficiencyResult?.cacheKey ?? '') !== String(cacheKey)) {
        setPlanningEfficiencyResult(cached.result);
        const sig = cached.selectedSig
          || cached.result.bestKey
          || cached.result.selectedCandidateKey
          || cached.result.bestSignature
          || (cached.result.candidates?.[0]?.signature ?? '');
        applyEfficiencyCandidateBySignature(sig, cached.result);
        setPlanningEfficiencyPreview(null);
        setPlanningEfficiencyPreviewBusy(false);
      }
      return;
    }

    if (cached && !cachedLooksConsistent) {
      try {
        efficiencyCacheRef.current.delete(cacheKey);
      } catch {
        // ignore
      }
    }

    // 输入变化后做一次 debounce：后台 full compute（关闭 fast，仅输出精算结果）。
    if (planningEfficiencyBusy) return;
    if (!efficiencyWorkerRef.current) return;

    if (efficiencyAutoRecomputeDebounceRef.current) clearTimeout(efficiencyAutoRecomputeDebounceRef.current);
    efficiencyAutoRecomputeDebounceRef.current = setTimeout(() => {
      requestComputeEfficiency({ force: true, fast: false, refine: false, background: true });
    }, 220);

    return () => {
      if (efficiencyAutoRecomputeDebounceRef.current) {
        clearTimeout(efficiencyAutoRecomputeDebounceRef.current);
        efficiencyAutoRecomputeDebounceRef.current = null;
      }
    };
  }, [
    mainViewMode,
    planningOptMode,
    boundaryLoopWorld,
    planningParams?.roadwayOrientation,
    planningParams?.boundaryPillarMin,
    planningParams?.boundaryPillarMax,
    planningParams?.boundaryPillarTarget,
    planningParams?.coalPillarMin,
    planningParams?.coalPillarMax,
    planningParams?.coalPillarTarget,
    planningParams?.faceWidthMin,
    planningParams?.faceWidthMax,
    planningParams?.faceWidthDefMin,
    planningParams?.faceWidthDefMax,
    planningParams?.faceAdvanceMax,
    planningEfficiencyBusy,
  ]);

  // 资源回收模式：轴向/煤柱/面宽/厚度/密度/边界等输入变化时，自动触发重算（或命中缓存切换）。
  const recoveryAutoRecomputeDebounceRef = useRef(null);
  useEffect(() => {
    if (mainViewMode !== 'planning') return;
    if (planningOptMode !== 'recovery') return;
    if (!boundaryLoopWorld?.length || boundaryLoopWorld.length < 3) return;

    const cacheKey = buildRecoveryCacheKey();
    planningRecoveryCacheKeyRef.current = String(cacheKey);
    setPlanningRecoveryCacheKey(cacheKey);

    const cached = recoveryCacheRef.current.get(cacheKey);
    const axisNow = (String(planningParams?.roadwayOrientation ?? 'x') === 'y') ? 'y' : 'x';
    const cachedAxis = String(cached?.result?.axis ?? '');
    const cachedSig = String(
      cached?.selectedSig
      || cached?.result?.bestKey
      || cached?.result?.selectedCandidateKey
      || cached?.result?.bestSignature
      || (cached?.result?.candidates?.[0]?.signature ?? '')
      || ''
    );
    const cachedLooksConsistent = cached?.result?.ok
      && cachedAxis === axisNow
      && cachedSig.startsWith(`${axisNow}|`);

    if (cachedLooksConsistent) {
      if (String(planningRecoveryResult?.cacheKey ?? '') !== String(cacheKey)) {
        setPlanningRecoveryResult(cached.result);
        const sig = cached.selectedSig
          || cached.result.bestKey
          || cached.result.selectedCandidateKey
          || cached.result.bestSignature
          || (cached.result.candidates?.[0]?.signature ?? '');
        applyRecoveryCandidateBySignature(sig, cached.result);
      }
      return;
    }

    if (cached && !cachedLooksConsistent) {
      try {
        recoveryCacheRef.current.delete(cacheKey);
      } catch {
        // ignore
      }
    }

    if (planningRecoveryBusy) return;
    if (!resourceWorkerRef.current) return;

    if (recoveryAutoRecomputeDebounceRef.current) clearTimeout(recoveryAutoRecomputeDebounceRef.current);
    recoveryAutoRecomputeDebounceRef.current = setTimeout(() => {
      // recovery 的 per-face 设计在 worker 端会禁用 fastMode；因此这里直接 full compute。
      requestComputeRecovery({ force: true, fast: false, refine: false, background: true });
    }, 220);

    return () => {
      if (recoveryAutoRecomputeDebounceRef.current) {
        clearTimeout(recoveryAutoRecomputeDebounceRef.current);
        recoveryAutoRecomputeDebounceRef.current = null;
      }
    };
  }, [
    mainViewMode,
    planningOptMode,
    boundaryLoopWorld,
    planningParams?.roadwayOrientation,
    planningParams?.boundaryPillarMin,
    planningParams?.boundaryPillarMax,
    planningParams?.boundaryPillarTarget,
    planningParams?.coalPillarMin,
    planningParams?.coalPillarMax,
    planningParams?.coalPillarTarget,
    planningParams?.faceWidthMin,
    planningParams?.faceWidthMax,
    planningParams?.faceWidthDefMin,
    planningParams?.faceWidthDefMax,
    planningParams?.faceAdvanceMax,
    planningParams?.seamThickness,
    planningParams?.coalDensity,
    boreholeParamSamples?.CoalThk,
    planningRecoveryBusy,
  ]);

  const planningEfficiencySelectedCandidate = useMemo(() => {
    const r = planningEfficiencyResult;
    const list = Array.isArray(r?.candidates) ? r.candidates : [];
    if (!r?.ok || !list.length) return null;
    const sig = String(planningEfficiencySelectedSig || r.bestSignature || list[0]?.signature || '');
    return list.find((c) => String(c?.signature) === sig) ?? list[0] ?? null;
  }, [planningEfficiencyResult, planningEfficiencySelectedSig]);

  const planningRecoverySelectedCandidate = useMemo(() => {
    const r = planningRecoveryResult;
    const list = Array.isArray(r?.candidates) ? r.candidates : [];
    if (!r?.ok || !list.length) return null;
    const sig = String(planningRecoverySelectedSig || r.bestSignature || list[0]?.signature || '');
    return list.find((c) => String(c?.signature) === sig) ?? list[0] ?? null;
  }, [planningRecoveryResult, planningRecoverySelectedSig]);

  // 智能规划：粉色覆盖层使用“边界煤柱确定值”对采区边界内缩后的范围
  const planningBoundaryOverlayLoop = useMemo(() => {
    if (!showPlanningBoundaryOverlay) return [];
    if (!hasBoundaryData) return [];
    if (!boundaryLoopWorld || boundaryLoopWorld.length < 3) return [];
    if (!combinedPointsForBounds || combinedPointsForBounds.length < 3) return [];

    const parsePositive = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, n) : null;
    };

    const overrideWb = (mainViewMode === 'planning' && (planningOptMode === 'efficiency' || planningOptMode === 'recovery'))
      ? parsePositive(planningInnerOmegaOverrideWb)
      : null;

    const target = parsePositive(planningParams?.boundaryPillarTarget);
    const minV = parsePositive(planningParams?.boundaryPillarMin);
    const maxV = parsePositive(planningParams?.boundaryPillarMax);
    const shrinkDist = overrideWb != null
      ? overrideWb
      : (target ?? (minV != null && maxV != null ? (minV + maxV) / 2 : 0));

    const buildJstsPolygonFromLoop = (loop) => {
      const pts = (loop ?? [])
        .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (pts.length < 3) return null;
      const first = pts[0];
      const last = pts[pts.length - 1];
      const closed = (first.x === last.x && first.y === last.y) ? pts : [...pts, first];
      const gf = new GeometryFactory();
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

    let basePoly = buildJstsPolygonFromLoop(boundaryLoopWorld);
    if (!basePoly) return [];
    try {
      const fixed = BufferOp.bufferOp(basePoly, 0);
      const picked = pickLargestPolygon(fixed);
      if (picked && !picked.isEmpty?.() && picked.getArea?.() > 0) basePoly = picked;
    } catch {
      // ignore
    }

    let overlayPoly = basePoly;
    if (Number.isFinite(shrinkDist) && shrinkDist > 0) {
      try {
        const shrunk = BufferOp.bufferOp(basePoly, -shrinkDist);
        const picked = pickLargestPolygon(shrunk);
        if (picked && !picked.isEmpty?.() && picked.getArea?.() > 0) overlayPoly = picked;
      } catch {
        overlayPoly = basePoly;
      }
    }

    let coords = [];
    try {
      const ring = overlayPoly.getExteriorRing?.();
      const raw = ring?.getCoordinates?.() ?? [];
      coords = Array.isArray(raw) ? raw : [];
    } catch {
      coords = [];
    }
    if (!coords.length) return [];

    const ptsWorld = coords
      .map((c) => ({ x: Number(c?.x), y: Number(c?.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

    // JSTS 的 ring 往往首尾重复，这里去掉尾点
    const loopWorld = (ptsWorld.length >= 2 && ptsWorld[0].x === ptsWorld[ptsWorld.length - 1].x && ptsWorld[0].y === ptsWorld[ptsWorld.length - 1].y)
      ? ptsWorld.slice(0, -1)
      : ptsWorld;

    if (loopWorld.length < 3) return [];
    const normalized = normalizeCoords(loopWorld, combinedPointsForBounds);
    const pts0 = computeNonSelfIntersectingLoop(normalized, (p) => p?.nx, (p) => p?.ny);
    const pts = sanitizeRenderLoop(pts0, { minSegLen: 1.6, collinearSin: 0.012 });
    return pts.map((p) => ({ nx: p.x, ny: p.y }));
  }, [
    showPlanningBoundaryOverlay,
    hasBoundaryData,
    boundaryLoopWorld,
    combinedPointsForBounds,
    mainViewMode,
    planningOptMode,
    planningInnerOmegaOverrideWb,
    planningParams?.boundaryPillarTarget,
    planningParams?.boundaryPillarMin,
    planningParams?.boundaryPillarMax,
  ]);

  // 智能规划：覆盖层数据源（efficiency/recovery：严格用 worker 返回的 innerOmega loops；其他模式：沿用本地 buffer 结果）
  const planningOmegaOverlayLoops = useMemo(() => {
    if (!showPlanningBoundaryOverlay) return [];

    if (mainViewMode === 'planning' && (planningOptMode === 'efficiency' || planningOptMode === 'recovery')) {
      const r = (planningOptMode === 'recovery') ? planningRecoveryResult : planningEfficiencyResult;
      const loopsW = Array.isArray(r?.omegaRender?.loops)
        ? r.omegaRender.loops
        : (Array.isArray(r?.omegaRender?.innerOmegaLoopWorld) ? [r.omegaRender.innerOmegaLoopWorld] : []);
      if (!loopsW.length) return [];
      if (!combinedPointsForBounds?.length) return [];

      return loopsW
        .map((loopW) => {
          const loop = Array.isArray(loopW) ? loopW : [];
          if (loop.length < 3) return null;
          return normalizeCoords(loop, combinedPointsForBounds).map((p) => ({ nx: p.nx, ny: p.ny }));
        })
        .filter((l) => Array.isArray(l) && l.length >= 3);
    }

    return (planningBoundaryOverlayLoop.length >= 3) ? [planningBoundaryOverlayLoop] : [];
  }, [
    showPlanningBoundaryOverlay,
    mainViewMode,
    planningOptMode,
    planningEfficiencyResult,
    planningRecoveryResult,
    combinedPointsForBounds,
    planningBoundaryOverlayLoop,
  ]);

  useEffect(() => {
    if (isRestoringRef.current) return;
    setPlannedWorkfaceLoopsWorld([]);
    setPlanningReverseSolutions([]);
    setPlanningParams((p) => ({ ...p, faceCountSelected: '', faceWidthMin: '', faceWidthMax: '' }));
    setShowPlanningBoundaryOverlay(false);
    setHasInitializedFaceWidthRange(false);
    setPlanningPreStartSnapshot(null);
    setPlanningEfficiencyResult(null);
    planningEfficiencyCacheKeyRef.current = '';
    setPlanningEfficiencyCacheKey('');
    setPlanningEfficiencySelectedSig('');
    setPlanningRecoveryResult(null);
    planningRecoveryCacheKeyRef.current = '';
    setPlanningRecoveryCacheKey('');
    setPlanningRecoverySelectedSig('');
    setPlanningInnerOmegaOverrideWb(null);
    planningHasStartedRef.current = false;
    try {
      efficiencyCacheRef.current?.clear?.();
    } catch {
      // ignore
    }
    try {
      recoveryCacheRef.current?.clear?.();
    } catch {
      // ignore
    }
    setMeasureEnabled(false);
    setMeasurePoints([]);
  }, [boundaryLoopWorld]);

  const applyPlannedFaceCountSelection = (rawN) => {
    const targetN = Math.max(1, Math.round(Number(rawN)));
    if (!boundaryLoopWorld || boundaryLoopWorld.length < 3) return;

    const buildJstsPolygonFromLoop = (loop) => {
      const pts = (loop ?? []).map((p) => ({ x: Number(p?.x), y: Number(p?.y) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (pts.length < 3) return null;
      const first = pts[0];
      const last = pts[pts.length - 1];
      const closed = (first.x === last.x && first.y === last.y) ? pts : [...pts, first];
      const gf = new GeometryFactory();
      const coords = closed.map((p) => new Coordinate(p.x, p.y));
      const ring = gf.createLinearRing(coords);
      const poly = gf.createPolygon(ring);
      if (!poly || poly.isEmpty() || !(poly.getArea() > 0)) return null;
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

    const buildPlannedFaceLoopsWithinPolygon = ({ innerPoly, axis, N, B, Ws }) => {
      if (!innerPoly || innerPoly.isEmpty?.()) return [];
      if (!(Number.isFinite(N) && N >= 1)) return [];
      if (!(Number.isFinite(B) && B > 0)) return [];
      if (!(Number.isFinite(Ws) && Ws >= 0)) return [];

      let polyForOps = innerPoly;
      try {
        const fixed = BufferOp.bufferOp(innerPoly, 0);
        const picked = pickLargestPolygon(fixed);
        if (picked && !picked.isEmpty?.() && picked.getArea?.() > 0) polyForOps = picked;
      } catch {
        polyForOps = innerPoly;
      }

      const env = polyForOps.getEnvelopeInternal();
      const minX = env.getMinX();
      const maxX = env.getMaxX();
      const minY = env.getMinY();
      const maxY = env.getMaxY();
      if (![minX, maxX, minY, maxY].every(Number.isFinite)) return [];

      const gf = new GeometryFactory();
      const totalW = N * B + (N - 1) * Ws;
      const loops = [];

      const toLoopFromPoly = (poly) => {
        try {
          const ring = poly?.getExteriorRing?.();
          const coords = ring?.getCoordinates?.();
          if (!coords || coords.length < 3) return null;
          const pts = [];
          for (const c of coords) {
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
        } catch {
          return null;
        }
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

      const chooseBestStart = (startMin, startMax, startGuess, buildForStart) => {
        const out = { loops: [], count: 0, area: 0 };
        if (!Number.isFinite(startMin) || !Number.isFinite(startMax)) return out;
        const lo = Math.min(startMin, startMax);
        const hi = Math.max(startMin, startMax);
        if (!(hi > lo)) return buildForStart(lo);
        const steps = 10;
        const cand = [];
        cand.push(clamp(startGuess, lo, hi));
        for (let i = 0; i <= steps; i++) cand.push(lo + (i / steps) * (hi - lo));
        let best = null;
        for (const s of cand) {
          const r = buildForStart(s);
          if (!best) { best = r; continue; }
          if (r.count > best.count) best = r;
          else if (r.count === best.count && r.area > best.area) best = r;
        }
        return best || out;
      };

      let interior = null;
      try {
        interior = polyForOps.getInteriorPoint?.()?.getCoordinate?.();
      } catch {
        interior = null;
      }
      const cx = Number(interior?.x);
      const cy = Number(interior?.y);

      if (axis === 'x') {
        const yCenter = Number.isFinite(cy) ? cy : (minY + maxY) / 2;
        const yStartGuess = yCenter - totalW / 2;
        const yMin = minY;
        const yMax = maxY - totalW;
        const best = chooseBestStart(yMin, yMax, yStartGuess, (yStart) => {
          const tmp = [];
          let areaSum = 0;
          let count = 0;
          for (let i = 0; i < N; i++) {
            const y0 = yStart + i * (B + Ws);
            const y1 = y0 + B;
            let inter = null;
            try {
              inter = polyForOps.intersection(rectPoly(minX, y0, maxX, y1));
            } catch {
              inter = null;
            }
            const poly = pickLargestPolygon(inter);
            if (!poly || poly.isEmpty?.() || !(poly.getArea?.() > 0)) continue;
            const loop = toLoopFromPoly(poly);
            if (!loop) continue;
            count += 1;
            const a = poly.getArea?.();
            if (Number.isFinite(a)) areaSum += a;
            tmp.push({ faceIndex: i + 1, loop });
          }
          return { loops: tmp, count, area: areaSum };
        });
        return best?.loops ?? [];
      }

      const xCenter = Number.isFinite(cx) ? cx : (minX + maxX) / 2;
      const xStartGuess = xCenter - totalW / 2;
      const xMin = minX;
      const xMax = maxX - totalW;
      const best = chooseBestStart(xMin, xMax, xStartGuess, (xStart) => {
        const tmp = [];
        let areaSum = 0;
        let count = 0;
        for (let i = 0; i < N; i++) {
          const x0 = xStart + i * (B + Ws);
          const x1 = x0 + B;
          let inter = null;
          try {
            inter = polyForOps.intersection(rectPoly(x0, minY, x1, maxY));
          } catch {
            inter = null;
          }
          const poly = pickLargestPolygon(inter);
          if (!poly || poly.isEmpty?.() || !(poly.getArea?.() > 0)) continue;
          const loop = toLoopFromPoly(poly);
          if (!loop) continue;
          count += 1;
          const a = poly.getArea?.();
          if (Number.isFinite(a)) areaSum += a;
          tmp.push({ faceIndex: i + 1, loop });
        }
        return { loops: tmp, count, area: areaSum };
      });
      return best?.loops ?? [];
    };

    // --- 新模式：MATLAB 风格条带圈定（通过 planningReverseSolutions.kind=strip-v1） ---
    if (planningReverseSolutions && typeof planningReverseSolutions === 'object' && !Array.isArray(planningReverseSolutions) && planningReverseSolutions.kind === 'strip-v1') {
      const ctx = planningReverseSolutions?.context ?? {};
      const axis = String(ctx.advanceAxis ?? 'x') === 'y' ? 'y' : 'x';
      const wbMean = Number(ctx.wbMean);
      const wsMean = Number(ctx.wsMean);
      const lMax = Number(ctx.lMax);
      const qAnnualTons = Number(ctx.qAnnualTons);
      const seamThickness = Number(ctx.seamThickness);
      const coalDensity = Number(ctx.coalDensity);
      const etaMin = Number(ctx.etaMin);
      const etaMax = Number(ctx.etaMax);
      const widthEngMin = Number.isFinite(Number(ctx.widthEngMin)) ? Number(ctx.widthEngMin) : 100;
      const widthEngMax = Number.isFinite(Number(ctx.widthEngMax)) ? Number(ctx.widthEngMax) : 350;
      const lMinRatio = Number.isFinite(Number(ctx.lMinRatio)) ? Number(ctx.lMinRatio) : 0.6;
      const lMaxRatio = Number.isFinite(Number(ctx.lMaxRatio)) ? Number(ctx.lMaxRatio) : 1.0;
      const nMin = Number(ctx.nMin);
      const nMax = Number(ctx.nMax);
      const spanMin = Number(ctx.spanMin);
      const spanMax = Number(ctx.spanMax);

      // 兼容两种上下文：
      // 1) 旧版：带产量反算（qAnnualTons 等齐全）
      // 2) 新版：仅几何截面推导（spanMin/spanMax）
      const hasProdCtx = [qAnnualTons, seamThickness, coalDensity, etaMin, etaMax].every(Number.isFinite)
        && qAnnualTons > 0 && seamThickness > 0 && coalDensity > 0 && etaMin > 0 && etaMax > 0;
      const hasSpanCtx = Number.isFinite(spanMin) && Number.isFinite(spanMax) && spanMax > 0;
      if (![wbMean, wsMean, lMax].every(Number.isFinite)) return;
      if (!(lMax > 0)) return;
      if (!(hasProdCtx || hasSpanCtx)) return;

      const lMin = lMax * lMinRatio;
      const lMaxUse = lMax * lMaxRatio;
      if (!(lMin > 0 && lMaxUse > 0)) return;

      const clampN = (n) => {
        const nn = Math.max(1, Math.round(Number(n)));
        if (Number.isFinite(nMin) && Number.isFinite(nMax) && nMax >= nMin) {
          return Math.min(Math.max(nn, Math.round(nMin)), Math.min(20, Math.round(nMax)));
        }
        return Math.min(20, nn);
      };

      const pickedN = clampN(targetN);
      if (pickedN !== targetN) setPlanningParams((p) => ({ ...p, faceCountSelected: String(pickedN) }));

      // 反算工作面宽度范围：读取当前边界煤柱/区段煤柱范围
      const parseNonNeg = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(0, n) : null;
      };

      const wbTarget = parseNonNeg(planningParams?.boundaryPillarTarget);
      const wbMinP = parseNonNeg(planningParams?.boundaryPillarMin);
      const wbMaxP = parseNonNeg(planningParams?.boundaryPillarMax);
      const wbMeanNow = (wbTarget ?? (wbMinP != null && wbMaxP != null ? (wbMinP + wbMaxP) / 2 : wbMean));
      const wbRangeMin = (wbMinP != null ? wbMinP : (wbTarget != null ? wbTarget : wbMeanNow));
      const wbRangeMax = (wbMaxP != null ? wbMaxP : (wbTarget != null ? wbTarget : wbMeanNow));

      const wsTarget = parseNonNeg(planningParams?.coalPillarTarget);
      const wsMinP = parseNonNeg(planningParams?.coalPillarMin);
      const wsMaxP = parseNonNeg(planningParams?.coalPillarMax);
      const wsMeanNow = (wsTarget ?? (wsMinP != null && wsMaxP != null ? (wsMinP + wsMaxP) / 2 : wsMean));
      const wsRangeMin = (wsMinP != null ? wsMinP : (wsTarget != null ? wsTarget : wsMeanNow));
      const wsRangeMax = (wsMaxP != null ? wsMaxP : (wsTarget != null ? wsTarget : wsMeanNow));

      const computeSpanMinPerp = (poly, axisLocal) => {
        const e = poly.getEnvelopeInternal();
        const ex0 = e.getMinX();
        const ex1 = e.getMaxX();
        const ey0 = e.getMinY();
        const ey1 = e.getMaxY();
        const eps = 1e-6;
        const gf = new GeometryFactory();
        const sampleCount = 25;
        const lens = [];

        if (axisLocal === 'x') {
          const dx = ex1 - ex0;
          if (!(dx > eps)) return Math.max(0, ey1 - ey0);
          for (let i = 0; i < sampleCount; i++) {
            const t = (i + 0.5) / sampleCount;
            const x = ex0 + t * dx;
            const line = gf.createLineString([
              new Coordinate(x, ey0 - 1e6),
              new Coordinate(x, ey1 + 1e6),
            ]);
            try {
              const inter = poly.intersection(line);
              const len = Number(inter?.getLength?.());
              if (Number.isFinite(len) && len > 1e-3) lens.push(len);
            } catch {
              // ignore
            }
          }
          return lens.length ? Math.min(...lens) : Math.max(0, ey1 - ey0);
        }

        const dy = ey1 - ey0;
        if (!(dy > eps)) return Math.max(0, ex1 - ex0);
        for (let i = 0; i < sampleCount; i++) {
          const t = (i + 0.5) / sampleCount;
          const y = ey0 + t * dy;
          const line = gf.createLineString([
            new Coordinate(ex0 - 1e6, y),
            new Coordinate(ex1 + 1e6, y),
          ]);
          try {
            const inter = poly.intersection(line);
            const len = Number(inter?.getLength?.());
            if (Number.isFinite(len) && len > 1e-3) lens.push(len);
          } catch {
            // ignore
          }
        }
        return lens.length ? Math.min(...lens) : Math.max(0, ex1 - ex0);
      };

      const spanMinWithWb = (wb) => {
        const basePoly = buildJstsPolygonFromLoop(boundaryLoopWorld);
        if (!basePoly) return null;
        let poly = basePoly;
        try {
          const fixed = BufferOp.bufferOp(poly, 0);
          const picked = pickLargestPolygon(fixed);
          if (picked && !picked.isEmpty?.() && picked.getArea?.() > 0) poly = picked;
        } catch {
          // ignore
        }
        let buf = null;
        try {
          buf = BufferOp.bufferOp(poly, -Math.max(0, Number(wb) || 0));
        } catch {
          buf = null;
        }
        const inner = pickLargestPolygon(buf);
        if (!inner || inner.isEmpty?.() || !(inner.getArea?.() > 0)) return null;
        const m = computeSpanMinPerp(inner, axis);
        return Number.isFinite(m) && m > 0 ? m : null;
      };

      const spanMinAtWbMin = spanMinWithWb(wbRangeMin) ?? (hasSpanCtx ? spanMin : null);
      const spanMinAtWbMax = spanMinWithWb(wbRangeMax) ?? (hasSpanCtx ? spanMin : null);

      // 当前煤柱范围下的可行 N 上限（保证 B_max >= 100）
      const denomN = (widthEngMin + wsRangeMin);
      const nMaxFeasibleByWidth = (spanMinAtWbMin != null && denomN > 0)
        ? Math.max(1, Math.floor((spanMinAtWbMin + wsRangeMin) / denomN))
        : null;

      let bMin = widthEngMin;
      let bMax = widthEngMax;

      if (spanMinAtWbMin != null && spanMinAtWbMax != null) {
        const bMaxByRanges = (spanMinAtWbMin - (pickedN - 1) * wsRangeMin) / pickedN;
        const bMinByRanges = (spanMinAtWbMax - (pickedN - 1) * wsRangeMax) / pickedN;

        const bLowRaw = Math.min(bMinByRanges, bMaxByRanges);
        const bHighRaw = Math.max(bMinByRanges, bMaxByRanges);
        bMin = Math.max(widthEngMin, bLowRaw);
        bMax = Math.min(widthEngMax, bHighRaw);

        // 若该 N 的反算面宽上限 < 100，剔除该方案：自动回退到可行最大 N
        if (Number.isFinite(bMax) && bMax < widthEngMin - 1e-9) {
          const fallbackN = Number.isFinite(nMaxFeasibleByWidth) ? nMaxFeasibleByWidth : null;
          if (fallbackN != null && fallbackN >= 1 && fallbackN !== pickedN) {
            setPlanningParams((p) => ({ ...p, faceCountSelected: String(fallbackN) }));
          }
          setPlanningParams((p) => ({ ...p, faceWidthMin: '', faceWidthMax: '' }));
          setPlannedWorkfaceLoopsWorld([]);
          return;
        }
      }

      if (hasProdCtx) {
        // 旧版：工程约束 + 几何可布置上限 + 产量反算下限（需要 ctx.wZone）
        const wZone = Number(ctx.wZone);
        if (!(Number.isFinite(wZone) && wZone > 0)) return;
        const bGeoMax = (wZone - (pickedN - 1) * wsMean) / pickedN;
        const bReqMin = qAnnualTons / (pickedN * lMaxUse * seamThickness * coalDensity * etaMax);
        bMin = Math.max(widthEngMin, Number.isFinite(bReqMin) ? bReqMin : widthEngMin);
        bMax = Math.min(widthEngMax, Number.isFinite(bGeoMax) ? bGeoMax : widthEngMax);
      } else {
        // 新版：工程约束 + 最短截面几何上限（确保最窄处也摆得下）
        const bGeoMax = (spanMin - (pickedN - 1) * wsMean) / pickedN;
        bMin = widthEngMin;
        bMax = Math.min(widthEngMax, Number.isFinite(bGeoMax) ? bGeoMax : widthEngMax);
      }

      setPlanningParams((p) => ({
        ...p,
        faceAdvanceMin: String(lMin.toFixed(1)),
        faceAdvanceMax: String(lMaxUse.toFixed(1)),
        faceWidthMin: Number.isFinite(bMin) ? String(bMin.toFixed(1)) : p.faceWidthMin,
        faceWidthMax: Number.isFinite(bMax) ? String(bMax.toFixed(1)) : p.faceWidthMax,
      }));

      if (!(Number.isFinite(bMax) && bMax > 0 && Number.isFinite(bMin) && bMax >= bMin)) {
        setPlannedWorkfaceLoopsWorld([]);
        return;
      }

      const bForDraw = clamp((bMin + bMax) / 2, bMin, bMax);

      const basePoly = buildJstsPolygonFromLoop(boundaryLoopWorld);
      if (!basePoly) return;
      let buffered = null;
      try {
        buffered = BufferOp.bufferOp(basePoly, -wbMean);
      } catch {
        buffered = null;
      }
      const innerPoly = pickLargestPolygon(buffered);
      if (!innerPoly || innerPoly.isEmpty?.() || !(innerPoly.getArea?.() > 0)) return;

      const loops = buildPlannedFaceLoopsWithinPolygon({ innerPoly, axis, N: pickedN, B: bForDraw, Ws: wsMean });
      if (loops.length) {
        setMainViewMode('planning');
        setPlannedWorkfaceLoopsWorld(loops);
        setPlannedWorkfaceUnionLoopsWorld([]);
        setShowWorkfaceOutline(true);
      } else {
        setPlannedWorkfaceLoopsWorld([]);
        setPlannedWorkfaceUnionLoopsWorld([]);
      }
      return;
    }

    // --- 旧模式：反算可行解集 ---
    const sols = Array.isArray(planningReverseSolutions) ? planningReverseSolutions : [];
    if (!sols.length) return;

    const basePoly = buildJstsPolygonFromLoop(boundaryLoopWorld);
    if (!basePoly) return;

    const sorted = [...sols].sort((a, b) => Number(a.wb) - Number(b.wb));
    let picked = null;
    let bestDiff = Infinity;

    for (const s of sorted) {
      const wb = Number(s?.wb);
      const wsItems = [...(s.ws ?? [])].sort((a, b) => Number(a.ws) - Number(b.ws));
      for (const item of wsItems) {
        const ws = Number(item?.ws);
        for (const f of (item.feasible ?? [])) {
          const n = Math.max(1, Math.round(Number(f?.N)));
          const bu = Number(f?.B_upper);
          if (!Number.isFinite(n) || !Number.isFinite(bu) || !(bu > 0)) continue;
          const diff = Math.abs(n - targetN);
          if (diff < bestDiff) {
            bestDiff = diff;
            picked = { wb, ws, N: n, B: bu };
          } else if (diff === bestDiff && picked) {
            // tie-break: 更小 wb/ws；再更大 B
            if (wb < picked.wb - 1e-9) picked = { wb, ws, N: n, B: bu };
            else if (Math.abs(wb - picked.wb) <= 1e-9 && ws < picked.ws - 1e-9) picked = { wb, ws, N: n, B: bu };
            else if (Math.abs(wb - picked.wb) <= 1e-9 && Math.abs(ws - picked.ws) <= 1e-9 && bu > picked.B + 1e-9) picked = { wb, ws, N: n, B: bu };
          }
          if (bestDiff === 0) break;
        }
        if (bestDiff === 0) break;
      }
      if (bestDiff === 0) break;
    }

    if (!picked || !(picked.N >= 1) || !(picked.B > 0) || !(picked.wb >= 0) || !(picked.ws >= 0)) return;

    // 若目标 N 不可行，自动回退到最近可行 N，并同步 UI
    if (picked.N !== targetN) {
      setPlanningParams((p) => ({ ...p, faceCountSelected: String(picked.N) }));
    }

    let buffered = null;
    try {
      buffered = BufferOp.bufferOp(basePoly, -picked.wb);
    } catch {
      buffered = null;
    }
    const innerPoly = pickLargestPolygon(buffered);
    if (!innerPoly || innerPoly.isEmpty?.() || !(innerPoly.getArea?.() > 0)) return;

    const loops = buildPlannedFaceLoopsWithinPolygon({ innerPoly, axis: planningAdvanceAxis, N: picked.N, B: picked.B, Ws: picked.ws });
    if (loops.length) {
      setMainViewMode('planning');
      setPlannedWorkfaceLoopsWorld(loops);
      setPlannedWorkfaceUnionLoopsWorld([]);
      setShowWorkfaceOutline(true);
    }
  };

  const handleStartIntelligentPlanning = () => {
    try {
      // 切换到规划视图
      switchMainViewModeWithRightPanel('planning');

      if (!boundaryLoopWorld?.length || boundaryLoopWorld.length < 3) {
        window.alert('请先导入采区边界坐标数据。');
        return;
      }

      setShowPlanningBoundaryOverlay(true);

      // 二次点击策略：先判断“是否需要重算”，若不需要则不要触发任何额外 setState，
      // 否则可能引发 cacheKeyRef 更新/进度被过滤，导致用户看到“进度不显示”。
      if (planningOptMode === 'efficiency') {
        const currentKey = String(buildEfficiencyCacheKey());
        const inFlightKey = String(efficiencyInFlightKeyRef.current || '');
        const lastShownKey = String(planningEfficiencyResult?.cacheKey ?? planningEfficiencyCacheKeyRef.current ?? '');
        const isComputingSame = Boolean(planningEfficiencyBusy && inFlightKey && currentKey === inFlightKey);
        const isUpToDate = Boolean(!planningEfficiencyBusy && lastShownKey && currentKey === lastShownKey);
        if (isComputingSame || isUpToDate) return;
      }
      if (planningOptMode === 'recovery') {
        const currentKey = String(buildRecoveryCacheKey());
        const inFlightKey = String(recoveryInFlightKeyRef.current || '');
        const lastShownKey = String(planningRecoveryResult?.cacheKey ?? planningRecoveryCacheKeyRef.current ?? '');
        const isComputingSame = Boolean(planningRecoveryBusy && inFlightKey && currentKey === inFlightKey);
        const isUpToDate = Boolean(!planningRecoveryBusy && lastShownKey && currentKey === lastShownKey);
        if (isComputingSame || isUpToDate) return;
      }

      // 工程效率最优：优先采用候选寻优 + 点击联动（矩形等宽）
      const roadwayDirEff = String(planningParams.roadwayOrientation ?? 'x');
      const advanceAxisEff = roadwayDirEff === 'y' ? 'y' : 'x';
      setPlanningAdvanceAxis(advanceAxisEff);

      // 工作面宽度默认范围（空值时归一化到工程默认）
      setPlanningParams((p) => {
        const fwMin = Number(p?.faceWidthMin);
        const fwMax = Number(p?.faceWidthMax);
        const needMin = !(Number.isFinite(fwMin) && fwMin > 0);
        const needMax = !(Number.isFinite(fwMax) && fwMax > 0);
        if (!needMin && !needMax) return p;
        return {
          ...p,
          faceWidthMin: needMin ? '100' : p.faceWidthMin,
          faceWidthMax: needMax ? '350' : p.faceWidthMax,
        };
      });

      if (planningOptMode === 'efficiency') {
        // 参数变化/首次：记录“点击前”快照，用于清空时回退
        setPlanningPreStartSnapshot({
          planningParams: cloneJson(planningParams),
          planningReverseSolutions: cloneJson(planningReverseSolutions),
          planningAdvanceAxis,
          plannedWorkfaceLoopsWorld: cloneJson(plannedWorkfaceLoopsWorld),
          plannedWorkfaceUnionLoopsWorld: cloneJson(plannedWorkfaceUnionLoopsWorld),
          showPlanningBoundaryOverlay,
          hasInitializedFaceWidthRange,
        });

        // 重算：清空旧图/选中态
        setPlannedWorkfaceLoopsWorld([]);
        setPlannedWorkfaceUnionLoopsWorld([]);
        setPlanningInnerOmegaOverrideWb(null);
        setPlanningEfficiencySelectedSig('');
        requestComputeEfficiency({ force: true, fast: false, refine: false, background: false, ignoreCache: true });
        return;
      }
      if (planningOptMode === 'recovery') {
        setPlanningPreStartSnapshot({
          planningParams: cloneJson(planningParams),
          planningReverseSolutions: cloneJson(planningReverseSolutions),
          planningAdvanceAxis,
          plannedWorkfaceLoopsWorld: cloneJson(plannedWorkfaceLoopsWorld),
          plannedWorkfaceUnionLoopsWorld: cloneJson(plannedWorkfaceUnionLoopsWorld),
          showPlanningBoundaryOverlay,
          hasInitializedFaceWidthRange,
        });

        setPlannedWorkfaceLoopsWorld([]);
        setPlannedWorkfaceUnionLoopsWorld([]);
        setPlanningInnerOmegaOverrideWb(null);
        setPlanningRecoverySelectedSig('');
        requestComputeRecovery({ force: true, fast: false, refine: false, background: false, ignoreCache: true });
        return;
      }

      window.alert('当前优化目标暂未接入计算：请先选择“工程效率最优”或“资源回收最优”。');
      return;

      // 工程约束：工作面宽度默认范围（按需求先固定）
      const faceWidthEngMin = 100;
      const faceWidthEngMax = 350;
      const advanceLenRatioMin = 0.60;
      const advanceLenRatioMax = 1.00;

      const roadwayDir = String(planningParams.roadwayOrientation ?? 'x');
      const advanceAxis = roadwayDir === 'y' ? 'y' : 'x';

      // 规划几何输入：优先使用“确定值”，否则回退到 (Min+Max)/2
      const parseNonNeg = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(0, n) : null;
      };

      const wbTarget = parseNonNeg(planningParams.boundaryPillarTarget);
      const wbMin = parseNonNeg(planningParams.boundaryPillarMin);
      const wbMax = parseNonNeg(planningParams.boundaryPillarMax);
      const wbMean = wbTarget ?? (wbMin != null && wbMax != null ? (wbMin + wbMax) / 2 : 0);

      // 范围用于反算面宽：若 min/max 缺失则回退到 target（或均值）
      const wbRangeMin = (wbMin != null ? wbMin : (wbTarget != null ? wbTarget : wbMean));
      const wbRangeMax = (wbMax != null ? wbMax : (wbTarget != null ? wbTarget : wbMean));

      const wsTarget = parseNonNeg(planningParams.coalPillarTarget);
      const wsMin = parseNonNeg(planningParams.coalPillarMin);
      const wsMax = parseNonNeg(planningParams.coalPillarMax);
      const wsMean = wsTarget ?? (wsMin != null && wsMax != null ? (wsMin + wsMax) / 2 : 0);

      const wsRangeMin = (wsMin != null ? wsMin : (wsTarget != null ? wsTarget : wsMean));
      const wsRangeMax = (wsMax != null ? wsMax : (wsTarget != null ? wsTarget : wsMean));

      if (!(Number.isFinite(wbMean) && wbMean >= 0 && Number.isFinite(wsMean) && wsMean >= 0)) {
        window.alert('煤柱范围无效：请检查 Min/Max。');
        return;
      }

      const buildJstsPolygonFromLoop = (loop) => {
        const pts = (loop ?? []).map((p) => ({ x: Number(p?.x), y: Number(p?.y) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (pts.length < 3) return null;
        const first = pts[0];
        const last = pts[pts.length - 1];
        const closed = (first.x === last.x && first.y === last.y) ? pts : [...pts, first];
        const gf = new GeometryFactory();
        const coords = closed.map((p) => new Coordinate(p.x, p.y));
        const ring = gf.createLinearRing(coords);
        const poly = gf.createPolygon(ring);
        if (!poly || poly.isEmpty() || !(poly.getArea() > 0)) return null;
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

      const basePoly = buildJstsPolygonFromLoop(boundaryLoopWorld);
      if (!basePoly) {
        window.alert('采区边界多边形无效：请检查边界是否闭合、是否自相交。');
        return;
      }

      let buffered = null;
      try {
        buffered = BufferOp.bufferOp(basePoly, -wbMean);
      } catch (e) {
        window.alert(`内缩采区边界失败：${String(e?.message ?? e)}`);
        return;
      }
      const innerPoly = pickLargestPolygon(buffered);
      if (!innerPoly || innerPoly.isEmpty?.() || !(innerPoly.getArea?.() > 0)) {
        window.alert('内缩后可采区为空：请减小边界煤柱均值或检查边界数据。');
        return;
      }

      // 依据“工作面布置方向”：若沿 x 布置，则沿 y 方向求可采区截面长度的最短/最长距离；反之亦然
      const env = innerPoly.getEnvelopeInternal();
      const minX = env.getMinX();
      const maxX = env.getMaxX();
      const minY = env.getMinY();
      const maxY = env.getMaxY();
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const lMax = advanceAxis === 'x' ? spanX : spanY;
      if (!(Number.isFinite(lMax) && lMax > 0)) {
        window.alert('可采区几何尺寸无效：请检查边界数据。');
        return;
      }

      const computeSpanRangePerpToAdvance = (poly, axis) => {
        const e = poly.getEnvelopeInternal();
        const ex0 = e.getMinX();
        const ex1 = e.getMaxX();
        const ey0 = e.getMinY();
        const ey1 = e.getMaxY();
        const eps = 1e-6;
        const gf = new GeometryFactory();

        const sampleCount = 25;
        const lens = [];

        if (axis === 'x') {
          // 沿 x 前进 -> 用竖线 x=const 求 y 向截长
          const dx = ex1 - ex0;
          if (!(dx > eps)) return { min: Math.max(0, ey1 - ey0), max: Math.max(0, ey1 - ey0) };
          for (let i = 0; i < sampleCount; i++) {
            const t = (i + 0.5) / sampleCount;
            const x = ex0 + t * dx;
            const line = gf.createLineString([
              new Coordinate(x, ey0 - 1e6),
              new Coordinate(x, ey1 + 1e6),
            ]);
            try {
              const inter = poly.intersection(line);
              const len = Number(inter?.getLength?.());
              if (Number.isFinite(len) && len > 1e-3) lens.push(len);
            } catch {
              // ignore
            }
          }
          if (!lens.length) {
            const fallback = Math.max(0, ey1 - ey0);
            return { min: fallback, max: fallback };
          }
          return { min: Math.min(...lens), max: Math.max(...lens) };
        }

        // 沿 y 前进 -> 用横线 y=const 求 x 向截长
        const dy = ey1 - ey0;
        if (!(dy > eps)) return { min: Math.max(0, ex1 - ex0), max: Math.max(0, ex1 - ex0) };
        for (let i = 0; i < sampleCount; i++) {
          const t = (i + 0.5) / sampleCount;
          const y = ey0 + t * dy;
          const line = gf.createLineString([
            new Coordinate(ex0 - 1e6, y),
            new Coordinate(ex1 + 1e6, y),
          ]);
          try {
            const inter = poly.intersection(line);
            const len = Number(inter?.getLength?.());
            if (Number.isFinite(len) && len > 1e-3) lens.push(len);
          } catch {
            // ignore
          }
        }
        if (!lens.length) {
          const fallback = Math.max(0, ex1 - ex0);
          return { min: fallback, max: fallback };
        }
        return { min: Math.min(...lens), max: Math.max(...lens) };
      };

      const spanRange = computeSpanRangePerpToAdvance(innerPoly, advanceAxis);
      const spanMin = Number(spanRange?.min);
      const spanMax = Number(spanRange?.max);
      if (!(Number.isFinite(spanMin) && Number.isFinite(spanMax) && spanMax > 0)) {
        window.alert('计算可采区截面距离失败：请检查边界数据。');
        return;
      }

      // 面数范围：最短/最长截面 ÷ 面宽最大/最小（后续会再按“反算面宽上限>=100”收紧）
      const nMin0 = Math.max(1, Math.floor(spanMin / faceWidthEngMax));
      const nMax0 = Math.max(nMin0, Math.floor(spanMax / faceWidthEngMin));
      let nMin = nMin0;
      let nMax = nMax0;

      // 工作面个数全局上限：20
      nMax = Math.min(nMax, 20);

      const lMin = lMax * advanceLenRatioMin;
      const lMaxUse = lMax * advanceLenRatioMax;

      // 反算工作面宽度范围：读取边界煤柱/区段煤柱范围
      // - 面宽上限：边界煤柱取最小（区域最大） + 区段煤柱取最小（间距最小）
      // - 面宽下限：边界煤柱取最大（区域最小） + 区段煤柱取最大（间距最大）
      const spanMinWithWb = (wb) => {
        let poly = basePoly;
        try {
          const fixed = BufferOp.bufferOp(poly, 0);
          const picked = pickLargestPolygon(fixed);
          if (picked && !picked.isEmpty?.() && picked.getArea?.() > 0) poly = picked;
        } catch {
          // ignore
        }

        let buf = null;
        try {
          buf = BufferOp.bufferOp(poly, -Math.max(0, Number(wb) || 0));
        } catch {
          buf = null;
        }
        const inner = pickLargestPolygon(buf);
        if (!inner || inner.isEmpty?.() || !(inner.getArea?.() > 0)) return null;
        const r = computeSpanRangePerpToAdvance(inner, advanceAxis);
        const m = Number(r?.min);
        return Number.isFinite(m) && m > 0 ? m : null;
      };

      const spanMinAtWbMin = spanMinWithWb(wbRangeMin) ?? spanMin;
      const spanMinAtWbMax = spanMinWithWb(wbRangeMax) ?? spanMin;

      // 剔除方案：若在“最乐观”条件下（wb最小、ws最小）反算的 B_max 仍 < 100，则该 N 不展示
      // B_max >= widthEngMin  <=>  N <= (spanMinAtWbMin + wsMin) / (widthEngMin + wsMin)
      const denomN = (faceWidthEngMin + wsRangeMin);
      const nMaxFeasibleByWidth = denomN > 0
        ? Math.max(1, Math.floor((spanMinAtWbMin + wsRangeMin) / denomN))
        : nMax;

      nMax = Math.min(nMax, nMaxFeasibleByWidth, 20);
      if (nMax < nMin) {
        window.alert(
          '根据煤柱范围反算后：所有可选工作面个数方案的“工作面宽度上限”均小于 100m，已自动剔除。\n' +
          '建议：减小区段煤柱/边界煤柱，或降低工作面个数后重试。'
        );
        setPlanningReverseSolutions([]);
        setPlanningParams((p) => ({ ...p, faceCountSuggestedMin: '', faceCountSuggestedMax: '', faceCountSelected: '', faceWidthMin: '', faceWidthMax: '' }));
        setPlannedWorkfaceLoopsWorld([]);
        return;
      }
      // 保持用户选择：再次启动时不重置滑块位置
      const prevNRaw = Number(planningParams.faceCountSelected);
      const prevN = Number.isFinite(prevNRaw) ? Math.max(1, Math.round(prevNRaw)) : null;
      const nDefault = Math.max(1, Math.round((nMin + nMax) / 2));
      const nSelected = prevN != null ? clamp(prevN, nMin, nMax) : nDefault;

      const bMaxByRanges = (spanMinAtWbMin - (nSelected - 1) * wsRangeMin) / nSelected;
      const bMinByRanges = (spanMinAtWbMax - (nSelected - 1) * wsRangeMax) / nSelected;

      const bLowRaw = Math.min(bMinByRanges, bMaxByRanges);
      const bHighRaw = Math.max(bMinByRanges, bMaxByRanges);

      // 显示用范围：下限不低于工程最小；上限不高于工程最大
      const bMin = Math.max(faceWidthEngMin, bLowRaw);
      const bMax = Math.min(faceWidthEngMax, bHighRaw);

      setPlanningParams((p) => ({
        ...p,
        faceCountSuggestedMin: String(Math.round(nMin)),
        faceCountSuggestedMax: String(Math.round(nMax)),
        faceCountSelected: String(nSelected),
        faceAdvanceMin: String(lMin.toFixed(1)),
        faceAdvanceMax: String(lMaxUse.toFixed(1)),
        // 工作面宽度范围只在首次生成时回填；后续保持用户输入不被覆盖
        faceWidthMin: (!hasInitializedFaceWidthRange && Number.isFinite(bMin)) ? String(bMin.toFixed(1)) : p.faceWidthMin,
        faceWidthMax: (!hasInitializedFaceWidthRange && Number.isFinite(bMax)) ? String(bMax.toFixed(1)) : p.faceWidthMax,
      }));

      if (!hasInitializedFaceWidthRange && Number.isFinite(bMin) && Number.isFinite(bMax) && bMax >= faceWidthEngMin && bMax >= bMin) {
        setHasInitializedFaceWidthRange(true);
      }

      // 保存上下文：供滑块调节 N 时即时重绘
      setPlanningReverseSolutions({
        kind: 'strip-v1',
        context: {
          advanceAxis,
          wbMean,
          wsMean,
          lMax,
          lMinRatio: advanceLenRatioMin,
          lMaxRatio: advanceLenRatioMax,
          widthEngMin: faceWidthEngMin,
          widthEngMax: faceWidthEngMax,
          nMin,
          nMax,
          spanMin,
          spanMax,
        }
      });
      setPlanningAdvanceAxis(advanceAxis);

      const buildPlannedFaceLoopsWithinPolygon = ({ innerPoly, axis, N, B, Ws }) => {
        if (!innerPoly || innerPoly.isEmpty?.()) return [];
        if (!(Number.isFinite(N) && N >= 1)) return [];
        if (!(Number.isFinite(B) && B > 0)) return [];
        if (!(Number.isFinite(Ws) && Ws >= 0)) return [];

        // 交叠/裁剪在少数情况下可能抛出拓扑异常；先尝试用 0-buffer 修复几何
        let polyForOps = innerPoly;
        try {
          const fixed = BufferOp.bufferOp(innerPoly, 0);
          const picked = pickLargestPolygon(fixed);
          if (picked && !picked.isEmpty?.() && picked.getArea?.() > 0) polyForOps = picked;
        } catch {
          polyForOps = innerPoly;
        }

        const env = polyForOps.getEnvelopeInternal();
        const minX = env.getMinX();
        const maxX = env.getMaxX();
        const minY = env.getMinY();
        const maxY = env.getMaxY();
        if (![minX, maxX, minY, maxY].every(Number.isFinite)) return [];

        const gf = new GeometryFactory();
        const totalW = N * B + (N - 1) * Ws;
        const loops = [];

        const toLoopFromPoly = (poly) => {
          try {
            const ring = poly?.getExteriorRing?.();
            const coords = ring?.getCoordinates?.();
            if (!coords || coords.length < 3) return null;
            const pts = [];
            for (const c of coords) {
              const x = Number(c?.x);
              const y = Number(c?.y);
              if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
              pts.push({ x, y });
            }
            // 去掉闭合重复点
            if (pts.length >= 2) {
              const f = pts[0];
              const l = pts[pts.length - 1];
              if (f.x === l.x && f.y === l.y) pts.pop();
            }
            return pts.length >= 3 ? pts : null;
          } catch {
            return null;
          }
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

        const chooseBestStart = (startMin, startMax, startGuess, buildForStart) => {
          const out = { loops: [], count: 0, area: 0 };
          if (!Number.isFinite(startMin) || !Number.isFinite(startMax)) return out;

          // 若范围退化/反转，直接用 startMin
          const lo = Math.min(startMin, startMax);
          const hi = Math.max(startMin, startMax);
          if (!(hi > lo)) {
            return buildForStart(lo);
          }

          const steps = 10;
          const cand = [];
          cand.push(clamp(startGuess, lo, hi));
          for (let i = 0; i <= steps; i++) {
            cand.push(lo + (i / steps) * (hi - lo));
          }

          let best = null;
          for (const s of cand) {
            const r = buildForStart(s);
            if (!best) {
              best = r;
              continue;
            }
            // 优先：尽量让所有工作面都有轮廓；其次：相交面积更大
            if (r.count > best.count) best = r;
            else if (r.count === best.count && r.area > best.area) best = r;
          }
          return best || out;
        };

        let interior = null;
        try {
          interior = polyForOps.getInteriorPoint?.()?.getCoordinate?.();
        } catch {
          interior = null;
        }
        const cx = Number(interior?.x);
        const cy = Number(interior?.y);

        if (axis === 'x') {
          const yCenter = Number.isFinite(cy) ? cy : (minY + maxY) / 2;
          const yStartGuess = yCenter - totalW / 2;
          const yMin = minY;
          const yMax = maxY - totalW;

          const best = chooseBestStart(yMin, yMax, yStartGuess, (yStart) => {
            const tmp = [];
            let areaSum = 0;
            let count = 0;
            for (let i = 0; i < N; i++) {
              const y0 = yStart + i * (B + Ws);
              const y1 = y0 + B;
              let inter = null;
              try {
                inter = polyForOps.intersection(rectPoly(minX, y0, maxX, y1));
              } catch {
                inter = null;
              }
              const poly = pickLargestPolygon(inter);
              if (!poly || poly.isEmpty?.() || !(poly.getArea?.() > 0)) continue;
              const loop = toLoopFromPoly(poly);
              if (!loop) continue;
              count += 1;
              const a = poly.getArea?.();
              if (Number.isFinite(a)) areaSum += a;
              tmp.push({ faceIndex: i + 1, loop });
            }
            return { loops: tmp, count, area: areaSum };
          });

          return best?.loops ?? [];
        }

        const xCenter = Number.isFinite(cx) ? cx : (minX + maxX) / 2;
        const xStartGuess = xCenter - totalW / 2;
        const xMin = minX;
        const xMax = maxX - totalW;

        const best = chooseBestStart(xMin, xMax, xStartGuess, (xStart) => {
          const tmp = [];
          let areaSum = 0;
          let count = 0;
          for (let i = 0; i < N; i++) {
            const x0 = xStart + i * (B + Ws);
            const x1 = x0 + B;
            let inter = null;
            try {
              inter = polyForOps.intersection(rectPoly(x0, minY, x1, maxY));
            } catch {
              inter = null;
            }
            const poly = pickLargestPolygon(inter);
            if (!poly || poly.isEmpty?.() || !(poly.getArea?.() > 0)) continue;
            const loop = toLoopFromPoly(poly);
            if (!loop) continue;
            count += 1;
            const a = poly.getArea?.();
            if (Number.isFinite(a)) areaSum += a;
            tmp.push({ faceIndex: i + 1, loop });
          }
          return { loops: tmp, count, area: areaSum };
        });

        return best?.loops ?? [];
      };

      // 绘制：N 取均值；B 优先按几何上限与工程范围取中值
      if (!(Number.isFinite(bMax) && bMax >= faceWidthEngMin && Number.isFinite(bMin) && bMax >= bMin)) {
        setPlannedWorkfaceLoopsWorld([]);
        return;
      }
      const userBMin = Number(planningParams.faceWidthMin);
      const userBMax = Number(planningParams.faceWidthMax);
      const userBCenter = (Number.isFinite(userBMin) && Number.isFinite(userBMax) && userBMax >= faceWidthEngMin && userBMax >= userBMin)
        ? (userBMin + userBMax) / 2
        : null;

      const bForDraw = userBCenter != null
        ? clamp(userBCenter, bMin, bMax)
        : clamp((bMin + bMax) / 2, bMin, bMax);
      const loops = buildPlannedFaceLoopsWithinPolygon({ innerPoly, axis: advanceAxis, N: nSelected, B: bForDraw, Ws: wsMean });
      if (loops.length) {
        setPlannedWorkfaceLoopsWorld(loops);
        setPlannedWorkfaceUnionLoopsWorld([]);
        setShowWorkfaceOutline(true);
      } else {
        setPlannedWorkfaceLoopsWorld([]);
        setPlannedWorkfaceUnionLoopsWorld([]);
      }
    } catch (e) {
      console.error('handleStartIntelligentPlanning failed', e);
      window.alert(`启动智能采区规划失败：${String(e?.message ?? e)}`);
    }
  };

  const normalizedWorkingFaceDataVisible = useMemo(() => {
    // “定位点”开关应控制所有工作面定位点的隐藏/显示；因此这里不按选中No过滤。
    return normalizedWorkingFaceData ?? [];
  }, [normalizedWorkingFaceData]);

  const normalizedWorkfaceLoops = useMemo(() => {
    if (!hasWorkingFaceData || !normalizedWorkingFaceDataVisible?.length) return [];

    const byFace = new Map();
    for (const p of (normalizedWorkingFaceDataVisible ?? [])) {
      const faceIndex = Number(p?.faceIndex);
      const k = Number.isFinite(faceIndex) ? faceIndex : 1;
      if (!byFace.has(k)) byFace.set(k, []);
      byFace.get(k).push(p);
    }

    const res = [];
    const keys = Array.from(byFace.keys()).sort((a, b) => a - b);
    for (const k of keys) {
      const ptsRaw = (byFace.get(k) ?? []).filter((p) => Number.isFinite(p?.nx) && Number.isFinite(p?.ny));
      if (ptsRaw.length < 3) continue;
      const loop = computeNonSelfIntersectingLoop(ptsRaw, (p) => p?.nx, (p) => p?.ny).map((p) => ({ nx: p.x, ny: p.y }));
      res.push({ faceIndex: k, loop });
    }
    return res;
  }, [hasWorkingFaceData, normalizedWorkingFaceDataVisible]);

  const normalizedPlannedWorkfaceLoops = useMemo(() => {
    const src = Array.isArray(plannedWorkfaceLoopsWorld) ? plannedWorkfaceLoopsWorld : [];
    if (!src.length) return [];

    const loopKey = (loopN) => {
      const pts = Array.isArray(loopN) ? loopN : [];
      if (pts.length < 2) return '';

      // bbox + 点集哈希：同一 faceIndex 下可能出现多个裁剪后子多边形，必须保证 key 唯一
      let minX = pts[0].nx;
      let maxX = pts[0].nx;
      let minY = pts[0].ny;
      let maxY = pts[0].ny;
      let h = 2166136261;
      const mix = (v) => { h ^= (v | 0); h = Math.imul(h, 16777619); };
      const q = (v) => {
        const x = Number(v);
        if (!Number.isFinite(x)) return 0;
        // 量化到 1e-3，避免浮点抖动导致 key 不稳定
        return Math.round(x * 1000);
      };
      for (const p of pts) {
        const x = Number(p?.nx);
        const y = Number(p?.ny);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        mix(q(x));
        mix(q(y));
      }
      mix(pts.length);
      const hu = (h >>> 0).toString(16);
      return `${q(minX)}|${q(minY)}|${q(maxX)}|${q(maxY)}|n=${pts.length}|h=${hu}`;
    };

    return src
      .map((wf) => {
        const loopW = (wf?.loop ?? []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
        if (loopW.length < 2) return null;

        const loopN0 = normalizeCoords(loopW, combinedPointsForBounds).map((p) => ({ x: p.nx, y: p.ny }));
        // 填充面（尤其 patch=1）在屏幕坐标可能出现亚像素级短边，SVG 抗锯齿会表现为“短线/毛刺”。
        // 这里仅做渲染级清理，不改变世界坐标几何与任何评分/覆盖率口径。
        const loopN1 = sanitizeRenderLoop(loopN0, { minSegLen: 1.2, collinearSin: 0.01 });
        const loopN = loopN1.map((p) => ({ nx: p.x, ny: p.y }));
        return { faceIndex: wf.faceIndex, loop: loopN, __k: loopKey(loopN) };
      })
      .filter(Boolean);
  }, [plannedWorkfaceLoopsWorld, combinedPointsForBounds]);

  const normalizedPlannedWorkfaceUnionLoops = useMemo(() => {
    const src = Array.isArray(plannedWorkfaceUnionLoopsWorld) ? plannedWorkfaceUnionLoopsWorld : [];
    if (!src.length) return [];
    return src
      .map((loopW) => {
        const ptsW = (loopW ?? []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
        if (ptsW.length < 2) return null;
        const loopN0 = normalizeCoords(ptsW, combinedPointsForBounds).map((p) => ({ x: p.nx, y: p.ny }));
        // union 外轮廓（尤其 patch=1）常带极短边/近共线点：会表现为边界上的短线段。
        // 这里只做渲染级清理，不改变世界坐标的几何口径。
        const loopN = sanitizeRenderLoop(loopN0, { minSegLen: 1.2, collinearSin: 0.01 });
        return loopN.map((p) => ({ nx: p.x, ny: p.y }));
      })
      .filter(Boolean);
  }, [plannedWorkfaceUnionLoopsWorld, combinedPointsForBounds]);

  const safeLoopNoClosure = (loop) => {
    const pts = Array.isArray(loop) ? loop.filter((p) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y))).map((p) => ({ x: Number(p.x), y: Number(p.y) })) : [];
    if (pts.length >= 2) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (Math.abs(a.x - b.x) <= 1e-12 && Math.abs(a.y - b.y) <= 1e-12) pts.pop();
    }
    return pts;
  };

  const bboxOfLoop = (loop) => {
    const pts = safeLoopNoClosure(loop);
    if (!pts.length) return null;
    let minX = pts[0].x;
    let maxX = pts[0].x;
    let minY = pts[0].y;
    let maxY = pts[0].y;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY };
  };

  const areaShoelace = (loop) => {
    const pts = safeLoopNoClosure(loop);
    if (pts.length < 3) return null;
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      s += a.x * b.y - b.x * a.y;
    }
    const area = Math.abs(s) / 2;
    return Number.isFinite(area) ? area : null;
  };

  const fmtOrDash = (v, digits) => {
    const n = (typeof v === 'string' && v.trim() === '') ? NaN : Number(v);
    return Number.isFinite(n) ? n.toFixed(digits) : '—';
  };

  const schedulePlanningWorkfaceTooltipMove = (clientX, clientY) => {
    const x = Number(clientX);
    const y = Number(clientY);
    if (!(Number.isFinite(x) && Number.isFinite(y))) return;
    planningWorkfaceTooltipLastClientRef.current = { x, y };
    if (planningWorkfaceTooltipRafRef.current) return;
    planningWorkfaceTooltipRafRef.current = requestAnimationFrame(() => {
      planningWorkfaceTooltipRafRef.current = 0;
      const el = planningWorkfaceTooltipRef.current;
      const container = mainMapContainerRef.current;
      if (!el || !container) return;
      const rect = container.getBoundingClientRect?.();
      if (!rect) return;
      const tipRect = el.getBoundingClientRect?.();
      const tipW = tipRect?.width || 0;
      const tipH = tipRect?.height || 0;

      const pad = 10;
      const ox = 14;
      const oy = 14;
      let px = (x - rect.left) + ox;
      let py = (y - rect.top) + oy;
      const maxX = Math.max(pad, rect.width - pad - tipW);
      const maxY = Math.max(pad, rect.height - pad - tipH);
      px = Math.max(pad, Math.min(maxX, px));
      py = Math.max(pad, Math.min(maxY, py));
      el.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    });
  };

  const handlePlannedWorkfaceMouseEnter = (e, faceIndex) => {
    const fi = Number(faceIndex);
    if (!Number.isFinite(fi) || fi < 1) return;
    setPlanningWorkfaceHover({ faceIndex: fi });
    schedulePlanningWorkfaceTooltipMove(e?.clientX, e?.clientY);
  };
  const handlePlannedWorkfaceMouseMove = (e) => {
    schedulePlanningWorkfaceTooltipMove(e?.clientX, e?.clientY);
  };
  const handlePlannedWorkfaceMouseLeave = () => {
    setPlanningWorkfaceHover(null);
  };

  const planningWorkfaceTooltipData = useMemo(() => {
    const fi = Number(planningWorkfaceHover?.faceIndex);
    if (!(Number.isFinite(fi) && fi >= 1)) return null;

    const isRec = planningOptMode === 'recovery';
    const result = isRec ? planningRecoveryResult : planningEfficiencyResult;
    const candidate = isRec ? planningRecoverySelectedCandidate : planningEfficiencySelectedCandidate;
    const axis = String(planningAdvanceAxis ?? result?.axis ?? candidate?.axis ?? 'x') || 'x';

    const loopW = (Array.isArray(plannedWorkfaceLoopsWorld)
      ? plannedWorkfaceLoopsWorld.find((x) => Number(x?.faceIndex) === fi)?.loop
      : null);
    const bb = bboxOfLoop(loopW);
    if (!bb) return { faceIndex: fi, B_m: null, L_m: null, A_face_m2: null };

    const toFiniteNum = (x) => {
      const n = (typeof x === 'string' && x.trim() === '') ? NaN : Number(x);
      return Number.isFinite(n) ? n : null;
    };
    const bList = Array.isArray(candidate?.BList)
      ? candidate.BList
      : (Array.isArray(candidate?.metrics?.BList) ? candidate.metrics.BList : null);
    const bFace = Array.isArray(bList) ? toFiniteNum(bList[fi - 1]) : null;
    const B_m = (bFace != null) ? bFace : (toFiniteNum(candidate?.B) ?? toFiniteNum(result?.B));
    const ws_m = (toFiniteNum(candidate?.ws) ?? toFiniteNum(result?.ws));

    const L_m = axis === 'y'
      ? (bb.maxY - bb.minY)
      : (bb.maxX - bb.minX);

    const A_face_m2 = areaShoelace(loopW);
    const abnormalFaces = Array.isArray(candidate?.abnormalFaces)
      ? candidate.abnormalFaces
      : (Array.isArray(candidate?.metrics?.abnormalFaces) ? candidate.metrics.abnormalFaces : []);
    const abnormal = Array.isArray(abnormalFaces)
      ? abnormalFaces.some((x) => Number(x?.faceIndex) === fi)
      : false;
    return {
      faceIndex: fi,
      B_m,
      L_m,
      A_face_m2,
      abnormal,
    };
  }, [
    planningWorkfaceHover,
    plannedWorkfaceLoopsWorld,
    planningOptMode,
    planningEfficiencySelectedCandidate,
    planningEfficiencyResult,
    planningRecoverySelectedCandidate,
    planningRecoveryResult,
    planningAdvanceAxis,
  ]);

  useEffect(() => {
    // Tooltip 显示时，尝试用最近一次鼠标位置进行定位（避免首次出现位置跳到 (0,0)）。
    if (!planningWorkfaceHover) return;
    const last = planningWorkfaceTooltipLastClientRef.current;
    if (Number.isFinite(last?.x) && Number.isFinite(last?.y)) {
      schedulePlanningWorkfaceTooltipMove(last.x, last.y);
    }
    return () => {
      if (planningWorkfaceTooltipRafRef.current) {
        cancelAnimationFrame(planningWorkfaceTooltipRafRef.current);
        planningWorkfaceTooltipRafRef.current = 0;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planningWorkfaceHover]);

  const generatedAllPoints = useMemo(() => {
    if (!generatedPoints) return [];
    const all = [];
    for (const k of ['gray', 'blue', 'pink', 'green', 'red']) {
      const arr = generatedPoints?.[k] ?? [];
      for (const p of arr) all.push({ ...p, __cat: k });
    }
    return all;
  }, [generatedPoints]);

  const normalizedGeneratedPoints = useMemo(() => {
    if (!generatedAllPoints.length) return [];
    return normalizeCoords(generatedAllPoints, combinedPointsForBounds);
  }, [generatedAllPoints, combinedPointsForBounds]);

  const generatedByCat = useMemo(() => {
    const m = { gray: [], blue: [], pink: [], green: [], red: [] };
    for (const p of normalizedGeneratedPoints) {
      const c = String(p.__cat ?? '');
      if (m[c]) m[c].push(p);
    }
    return m;
  }, [normalizedGeneratedPoints]);

  const handleBoundaryImportClick = () => {
    boundaryFileInputRef.current?.click();
  };

  const handleBoundaryFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const points = parseBoundaryText(text);
      setBoundaryData(points);
    };
    reader.readAsText(file);

    // 允许重复选择同一个文件
    e.target.value = '';
  };

  const handleDrillholeImportClick = () => {
    drillholeFileInputRef.current?.click();
  };

  const handleDrillholeFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const points = parseBoundaryText(text);
      setDrillholeData(points);
    };
    reader.readAsText(file);

    e.target.value = '';
  };

  const handleDrillholeLayersImportClick = () => {
    drillholeLayersFileInputRef.current?.click();
  };

  const handleDrillholeLayersFileChange = async (e) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const readText = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file);
    });

    try {
      const entries = await Promise.all(
        files.map(async (file) => {
          const id = String(file.name ?? '').replace(/\.[^.]+$/, '').trim();
          const text = await readText(file);
          const layers = parseStratificationText(text);
          return [id, layers];
        })
      );

      setDrillholeLayersById((prev) => {
        const next = { ...(prev ?? {}) };
        for (const [id, layers] of entries) {
          if (!id) continue;
          next[id] = layers;
        }
        return next;
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleMeasuredConstraintImportClick = () => {
    measuredConstraintFileInputRef.current?.click();
  };

  const handleMeasuredConstraintFileChange = async (e) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const measuredValueLabel = getMeasuredValueLabelByScenario(activeTab);

    const readText = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file);
    });

    try {
      const entries = await Promise.all(
        files.map(async (file) => {
          const text = await readText(file);
          const fileId = safeFileId(String(file.name ?? '').replace(/\.[^.]+$/, '').trim());
          const rows = parseMeasuredConstraintText(text, fileId);
          return { fileId, rows };
        })
      );

      // 按文件保留测线（用于误差分析）
      const lines = entries
        .filter((it) => it?.rows?.length)
        .map((it, idx) => ({
          lineId: String(it.fileId || `LINE-${idx + 1}`),
          label: String(it.fileId || `测线${idx + 1}`),
          points: it.rows,
        }));
      setMeasuredConstraintLines(lines);
      // 导入后：默认选中第一条测线（若当前未选中）
      if (!selectedMeasuredLineId && lines.length) setSelectedMeasuredLineId(lines[0].lineId);
      // 导入新数据后：旧误差结果作废
      setErrorAnalysisByLineId({});

      const merged = entries.flatMap((it) => it.rows ?? []);
      // 合并同 ID：以后读到的覆盖以前的
      const byId = new Map();
      for (const r of merged) {
        const id = String(r?.id ?? '').trim();
        const x = Number(r?.x);
        const y = Number(r?.y);
        const measured = Number(r?.measured);
        if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(measured)) continue;
        byId.set(id, { id, x, y, measured, fileId: String(r?.fileId ?? '') });
      }
      const next = Array.from(byId.values());
      setMeasuredConstraintData(next);
      setMeasuredZoningResultTracked(null);
      // 确保导入后立即显示在主图
      setShowLayerEvalPoints(true);
      setShowEvalBoundaryPoints(true);
      setShowEvalWorkfaceLocPoints(true);
      setShowEvalEdgeCtrlPoints(true);
      setShowEvalCenterCtrlPoints(true);
      setShowMeasuredPoints(true);
      setShowMainMap(true);
    } catch (err) {
      console.error('导入实测约束数据失败', err);
      window.alert(`导入实测约束数据失败：请检查文件格式（测点ID, x, y, ${measuredValueLabel}）。`);
    } finally {
      e.target.value = '';
    }
  };

  const CloudPanel = ({ title, paramKey, fieldPack, unit, subtitleOverride, vizSize = 'md' }) => {
    const gradientId = `grad_${uid}_${paramKey}`;
    const subtitle = subtitleOverride ?? (identifiedTarget.name ? `评价层：${identifiedTarget.name}` : '评价层：未识别');
    const settings = mapVizSettings[paramKey] ?? { palette: 'viridis', range: { enabled: false, min: '', max: '' } };
    const paletteName = settings.palette ?? 'viridis';
    const range = getEffectiveRange(settings.range, fieldPack);
    const hint = range?.min == null ? '--' : `${range.min.toFixed(2)} ~ ${range.max.toFixed(2)}${unit ? ` ${unit}` : ''}${range.isAuto ? '（自动）' : '（自定义）'}`;
    const hasField = !!fieldPack?.field && fieldPack.gridW > 0 && fieldPack.gridH > 0;

    const heatmapHref = useMemo(() => {
      if (!hasField) return null;
      return renderHeatmapDataUrl(fieldPack, range.min, range.max, paletteName);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasField, fieldPack, range.min, range.max, paletteName]);

    const w = 320;
    const h = 220;

    const svgHeightClass = vizSize === 'lg' ? 'h-96' : 'h-48';

    return (
      <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col ${vizSize === 'lg' ? 'h-full' : ''}`}>
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-700">{title}</div>
              <div className="text-[10px] text-slate-400 font-mono tracking-tight">{subtitle}</div>
            </div>
            <div className="text-[10px] text-slate-500 font-mono text-right">
              <div>{hint}</div>
              <div className="mt-1 flex items-center justify-end gap-2">
                <select
                  className="bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-bold text-slate-700"
                  value={paletteName}
                  onChange={(e) =>
                    setMapVizSettings((prev) => ({
                      ...prev,
                      [paramKey]: { ...(prev[paramKey] ?? settings), palette: e.target.value },
                    }))
                  }
                  title="色带"
                >
                  <option value="viridis">Viridis</option>
                  <option value="turbo">Turbo</option>
                  <option value="blueRed">Blue-Red</option>
                </select>

                <select
                  className="bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-bold text-slate-700"
                  value={settings.range?.enabled ? 'custom' : 'auto'}
                  onChange={(e) => {
                    const mode = e.target.value;
                    setMapVizSettings((prev) => {
                      const cur = prev[paramKey] ?? settings;
                      const nextRange = { ...(cur.range ?? { enabled: false, min: '', max: '' }), enabled: mode === 'custom' };
                      return { ...prev, [paramKey]: { ...cur, range: nextRange } };
                    });
                  }}
                  title="范围"
                >
                  <option value="auto">自动</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
              {settings.range?.enabled ? (
                <div className="mt-1 flex items-center justify-end gap-2">
                  <input
                    type="number"
                    value={settings.range?.min ?? ''}
                    onChange={(e) =>
                      setMapVizSettings((prev) => {
                        const cur = prev[paramKey] ?? settings;
                        return {
                          ...prev,
                          [paramKey]: {
                            ...cur,
                            range: { ...(cur.range ?? { enabled: true, min: '', max: '' }), min: e.target.value },
                          },
                        };
                      })
                    }
                    className="w-20 bg-white border border-slate-200 rounded px-2 py-1 text-[10px] text-slate-700"
                    placeholder="min"
                    title="min"
                  />
                  <input
                    type="number"
                    value={settings.range?.max ?? ''}
                    onChange={(e) =>
                      setMapVizSettings((prev) => {
                        const cur = prev[paramKey] ?? settings;
                        return {
                          ...prev,
                          [paramKey]: {
                            ...cur,
                            range: { ...(cur.range ?? { enabled: true, min: '', max: '' }), max: e.target.value },
                          },
                        };
                      })
                    }
                    className="w-20 bg-white border border-slate-200 rounded px-2 py-1 text-[10px] text-slate-700"
                    placeholder="max"
                    title="max"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="p-4 flex-1 flex flex-col">
          <svg viewBox="0 0 320 220" className={`w-full ${svgHeightClass} flex-1`}>
            <defs>
              <radialGradient id={gradientId} cx="45%" cy="45%" r="70%">
                <stop offset="0%" stopColor="#0f172a" stopOpacity="0.05" />
                <stop offset="100%" stopColor="#0f172a" stopOpacity="0.02" />
              </radialGradient>
            </defs>
            <rect x="0" y="0" width="320" height="220" rx="12" fill={`url(#${gradientId})`} />

            {hasField && heatmapHref ? (
              <image
                href={heatmapHref}
                x="0"
                y="0"
                width={w}
                height={h}
                preserveAspectRatio="none"
                style={{ imageRendering: 'auto' }}
              />
            ) : (
              <text x="16" y="26" fontSize="12" fill="#94a3b8">
                数据不足（需同时导入：钻孔坐标 + 钻孔分层）
              </text>
            )}

            {hasField && fieldPack.points?.length ? (
              <g>
                {fieldPack.points.map((p, idx) => (
                  <circle key={`${paramKey}-pt-${idx}`} cx={p.x} cy={p.y} r="2.2" fill="#0f172a" fillOpacity="0.55" />
                ))}
              </g>
            ) : null}
          </svg>

          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="text-[10px] text-slate-400">数据接口：{paramKey} 分布云图（简化插值示意）</div>
            <div className="flex items-center gap-2">
              <div className="text-[10px] text-slate-500">色带</div>
              <div
                className="h-2 w-24 rounded border border-slate-200"
                style={{
                  background: `linear-gradient(to right, ${(paletteStops[paletteName] ?? paletteStops.viridis).join(',')})`,
                }}
                title="色带预览"
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const geologyParamOptions = useMemo(() => {
    const miLabel = '目标层煤层厚度（Mi）';
    return [
      { key: 'Ti', label: '目标层厚度（Ti）' },
      { key: 'Mi', label: miLabel },
      { key: 'Hi', label: '煤层与目标层间距（Hi）' },
      { key: 'Di', label: '目标层埋深（Di）' },
    ];
  }, []);

  const geologyPanelsByKey = useMemo(() => {
    const miTitle = '目标层煤层厚度 (Mi)';
    return {
      Ti: {
        title: '目标层厚度 (Ti)',
        key: 'Ti',
        unit: 'm',
        subtitleOverride: undefined,
      },
      Mi: {
        title: miTitle,
        key: 'Mi',
        unit: 'm',
        subtitleOverride: selectedCoal ? `煤层：${selectedCoal}` : '煤层：未选择',
      },
      Hi: {
        title: '煤层与目标层间距 (Hi)',
        key: 'Hi',
        unit: 'm',
        subtitleOverride: undefined,
      },
      Di: {
        title: '目标层埋深 (Di)',
        key: 'Di',
        unit: 'm',
        subtitleOverride: undefined,
      },
    };
  }, [selectedCoal]);

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-900 overflow-hidden text-[17px]">
      {/* 左侧控制栏 - 数据上传与输入 */}
      <aside className="w-80 bg-white border-r border-slate-200 flex flex-col shadow-xl z-10 shrink-0">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="text-blue-600" size={20} />
            <h1 className="text-base font-bold text-slate-800 tracking-tight">基于覆岩扰动约束的采区多目标智能规划系统</h1>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
          {/* 1. 场景选择 */}
          <section>
            <label className="text-xs font-bold text-slate-500 mb-3 block uppercase tracking-wider">评估场景选择</label>
            <div className="grid grid-cols-1 gap-2">
              {[
                { id: 'surface', label: '地表下沉场景', icon: <TrendingDown size={14} />, accent: 'bg-blue-600', active: 'bg-blue-600 border-blue-600 text-white', inactive: 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-slate-100' },
                { id: 'aquifer', label: '含水层扰动场景', icon: <Droplets size={14} />, accent: 'bg-emerald-600', active: 'bg-emerald-600 border-emerald-600 text-white', inactive: 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-slate-100' },
                { id: 'upward', label: '上行开采可行性', icon: <ArrowUpCircle size={14} />, accent: 'bg-amber-500', active: 'bg-amber-500 border-amber-500 text-white', inactive: 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-slate-100' }
              ].map(item => (
                <button
                  key={item.id}
                  onClick={() => handleScenarioSelect(item.id)}
                  className={`relative flex items-center gap-3 px-4 py-3 rounded border transition-all overflow-hidden ${
                    activeTab === item.id 
                    ? `${item.active} shadow-md` 
                    : item.inactive
                  }`}
                >
                  <span className={`absolute left-0 top-0 bottom-0 w-1 ${item.accent} ${activeTab === item.id ? 'opacity-100' : 'opacity-60'}`} />
                  {item.icon}
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* 2. 数据导入中心 */}
          <section>
            <label className="text-xs font-bold text-slate-500 mb-3 block uppercase tracking-wider">数据导入中心</label>
            <div className="space-y-2">
              <button
                className="w-full flex items-center justify-between px-4 py-2 bg-white border border-slate-200 rounded text-xs text-slate-600 hover:border-blue-500 hover:text-blue-600 transition-all group"
                onClick={handleBoundaryImportClick}
              >
                <span className="flex items-center gap-2 font-medium">
                  <Box size={14} className="text-slate-400 group-hover:text-blue-500" /> 导入采区边界坐标
                </span>
                <div className="flex items-center gap-2">
                  {boundaryData.length > 0 && (
                    <span className="text-[10px] text-slate-400">已导入 {boundaryData.length} 个点</span>
                  )}
                  <FileUp size={12} className="text-slate-300" />
                </div>
              </button>
              <input
                ref={boundaryFileInputRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={handleBoundaryFileChange}
              />
              <button
                className="w-full flex items-center justify-between px-4 py-2 bg-white border border-slate-200 rounded text-xs text-slate-600 hover:border-blue-500 hover:text-blue-600 transition-all group"
                onClick={handleDrillholeImportClick}
              >
                <span className="flex items-center gap-2 font-medium">
                  <MapPin size={14} className="text-slate-400 group-hover:text-blue-500" /> 导入钻孔坐标数据
                </span>
                <div className="flex items-center gap-2">
                  {drillholeData.length > 0 && (
                    <span className="text-[10px] text-slate-400">已导入 {drillholeData.length} 个点</span>
                  )}
                  <FileUp size={12} className="text-slate-300" />
                </div>
              </button>
              <input
                ref={drillholeFileInputRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={handleDrillholeFileChange}
              />
              <button
                className="w-full flex items-center justify-between px-4 py-2 bg-white border border-slate-200 rounded text-xs text-slate-600 hover:border-blue-500 hover:text-blue-600 transition-all group"
                onClick={handleDrillholeLayersImportClick}
              >
                <span className="flex items-center gap-2 font-medium">
                  <Layers size={14} className="text-slate-400 group-hover:text-blue-500" /> 导入钻孔分层数据
                </span>
                <div className="flex items-center gap-2">
                  {Object.keys(drillholeLayersById).length > 0 && (
                    <span className="text-[10px] text-slate-400">已导入 {Object.keys(drillholeLayersById).length} 个钻孔</span>
                  )}
                  <FileUp size={12} className="text-slate-300" />
                </div>
              </button>
              <input
                ref={drillholeLayersFileInputRef}
                type="file"
                multiple
                accept=".csv,.txt"
                className="hidden"
                onChange={handleDrillholeLayersFileChange}
              />
              <button
                className="w-full flex items-center justify-between px-4 py-2 bg-white border border-slate-200 rounded text-xs text-slate-600 hover:border-emerald-500 hover:text-emerald-600 transition-all group"
                onClick={handleMeasuredConstraintImportClick}
                type="button"
              >
                <span className="flex items-center gap-2 font-medium">
                  <ClipboardCheck size={14} className="text-slate-400 group-hover:text-emerald-500" /> 导入实测约束数据
                </span>
                <div className="flex items-center gap-2">
                  {measuredConstraintData.length > 0 && (
                    <span className="text-[10px] text-slate-400">已导入 {measuredConstraintData.length} 条</span>
                  )}
                  <FileUp size={12} className="text-slate-300" />
                </div>
              </button>
              <input
                ref={measuredConstraintFileInputRef}
                type="file"
                multiple
                accept=".csv,.txt"
                className="hidden"
                onChange={handleMeasuredConstraintFileChange}
              />
            </div>
          </section>

          {/* 场景标记配置 */}
          <section>
            <label className="text-xs font-bold text-slate-500 mb-3 block uppercase tracking-wider">场景标记配置</label>
            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm space-y-3">
              <div>
                <div className="text-[11px] text-slate-500 mb-2 font-bold">目标煤层选择</div>
                <select
                  className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm text-slate-700"
                  value={selectedCoal}
                  onChange={(e) => setSelectedCoal(e.target.value)}
                  disabled={coalSeams.length === 0}
                >
                  {coalSeams.length === 0 ? (
                    <option value="">请先导入钻孔分层数据（检索含“煤”的层位）</option>
                  ) : (
                    coalSeams.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))
                  )}
                </select>
              </div>

              {activeTab === 'aquifer' && (
                <div>
                  <div className="text-[11px] text-slate-500 mb-2 font-bold">含水层选择</div>
                  <select
                    className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm text-slate-700"
                    value={selectedAquiferType}
                    onChange={(e) => setSelectedAquiferType(e.target.value)}
                    disabled={aquiferTypeOptions.length === 0}
                  >
                    {aquiferTypeOptions.length === 0 ? (
                      <option value="">请先导入钻孔分层数据（含“含水层标记”列）</option>
                    ) : (
                      aquiferTypeOptions.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))
                    )}
                  </select>
                </div>
              )}
              <div>
                <div className="text-[11px] text-slate-500 mb-2 font-bold">{activeTab === 'aquifer' ? '识别目标评价层（目标含水层下关键层）' : '识别目标评价层（最上层基岩）'}</div>
                {activeTab !== 'aquifer' && (
                  <div className={`flex items-start gap-2 rounded border p-3 ${identifiedTarget.name ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                    {identifiedTarget.name ? (
                      <CheckCircle2 size={16} className="text-emerald-600 mt-0.5" />
                    ) : (
                      <AlertTriangle size={16} className="text-amber-600 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-800 truncate">{identifiedTarget.name || '未识别'}</div>
                      <div className="text-[10px] text-slate-600 mt-1 leading-4">{identifiedTarget.reason}</div>
                    </div>
                  </div>
                )}

                <div className={activeTab === 'aquifer' ? '' : 'mt-3'}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] text-slate-500 font-bold">各钻孔识别结果</div>
                    <div className="text-[10px] text-slate-400">{perBoreholeTargetList.length} 个</div>
                  </div>
                  <div className="border border-slate-200 rounded bg-slate-50 max-h-40 overflow-auto">
                    {perBoreholeTargetList.length === 0 ? (
                      <div className="p-3 text-[11px] text-slate-500">暂无结果（请先导入钻孔分层数据）</div>
                    ) : (
                      <table className="w-full text-[11px]">
                        <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="text-left px-3 py-2 text-slate-500 font-bold">钻孔</th>
                            <th className="text-left px-3 py-2 text-slate-500 font-bold">{activeTab === 'aquifer' ? '目标含水层下关键层岩性' : '最上层基岩岩性'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {perBoreholeTargetList.map((r) => (
                            <tr key={r.id} className="border-b border-slate-100 last:border-b-0">
                              <td className="px-3 py-2 text-slate-700 font-mono">{r.id}</td>
                              <td className="px-3 py-2 text-slate-700">{r.targetName}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

        </div>
      </aside>

      {/* 中间区域 - 分布图(上) + 误差分析(下) */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-slate-50/50 shadow-inner">
        <div className="px-6 pt-6 flex items-center justify-between gap-4">
          <div className="inline-flex bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
            <button
              className={`px-4 py-2 rounded-md text-xs font-bold transition-colors ${mainViewMode === 'odi' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              onClick={() => switchMainViewModeWithRightPanel('odi')}
            >
              综合扰动结果
            </button>
            <button
              className={`px-4 py-2 rounded-md text-xs font-bold transition-colors ${mainViewMode === 'geology' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              onClick={() => setMainViewMode('geology')}
            >
              地质参数分析
            </button>
            <button
              className={`px-4 py-2 rounded-md text-xs font-bold transition-colors ${mainViewMode === 'planning' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              onClick={() => switchMainViewModeWithRightPanel('planning')}
            >
              智能规划
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              className={`p-2 rounded-lg border transition-colors ${canUndo ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
              onClick={handleUndo}
              disabled={!canUndo}
              title="撤回上一步"
            >
              <Undo2 size={16} />
            </button>
            <button
              className={`p-2 rounded-lg border transition-colors ${canRedo ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
              onClick={handleRedo}
              disabled={!canRedo}
              title="前进一步（重做）"
            >
              <Redo2 size={16} />
            </button>
            <button
              className="p-2 rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-50"
              onClick={handleClearAll}
              title="清空当前场景的输入数据与参数设置（可撤回）"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div ref={mainCenterScrollRef} className="flex-1 flex flex-col p-6 space-y-6 overflow-y-auto">
          {mainViewMode === 'geology' ? (
            <>
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500 font-bold">分布云图</div>
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                    onClick={exportGeologyCloudMapsPng}
                    title="导出当前布局下显示的分布云图（PNG）"
                  >
                    导出云图
                  </button>
                  <button
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                    onClick={exportGeologyBoreholeCsv}
                    title="按钻孔ID导出 CSV：钻孔ID, 坐标x, 坐标y, 对应数值"
                  >
                    导出CSV
                  </button>

                  <div className="text-[10px] text-slate-400">每张图可单独设置色带与范围</div>
                  <div className="h-4 w-px bg-slate-200"></div>
                  <div className="text-[11px] text-slate-500 font-bold">布局</div>
                  <select
                    className="bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700"
                    value={geologyLayoutMode}
                    onChange={(e) => setGeologyLayoutMode(e.target.value)}
                    title="地质参数分析布局"
                  >
                    <option value="1x1">1×1</option>
                    <option value="1x2">1×2</option>
                    <option value="2x2">2×2</option>
                  </select>

                  {geologyLayoutMode === '1x1' && (
                    <>
                      <div className="h-4 w-px bg-slate-200"></div>
                      <div className="text-[11px] text-slate-500 font-bold">视图</div>
                      <select
                        className="bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700"
                        value={geoPickA}
                        onChange={(e) => setGeoPickA(e.target.value)}
                        title="选择 1×1 显示的参数云图"
                      >
                        {geologyParamOptions.map((o) => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              </div>

              {geologyLayoutMode === '1x2' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-4 border-b border-slate-100">
                    <div className="text-sm font-bold text-slate-700">视图选择</div>
                    <div className="text-[10px] text-slate-400 mt-1">
                      1×2 显示：选择两个参数云图
                    </div>
                  </div>
                  <div className="p-4">
                    <div className={`grid gap-3 ${geologyLayoutMode === '1x1' ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
                      <div>
                        <div className="text-[11px] text-slate-500 mb-2 font-bold">视图 A</div>
                        <select
                          className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm text-slate-700"
                          value={geoPickA}
                          onChange={(e) => setGeoPickA(e.target.value)}
                        >
                          {geologyParamOptions.map((o) => (
                            <option key={o.key} value={o.key}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 mb-2 font-bold">视图 B</div>
                        <select
                          className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm text-slate-700"
                          value={geoPickB}
                          onChange={(e) => setGeoPickB(e.target.value)}
                        >
                          {geologyParamOptions.map((o) => (
                            <option key={o.key} value={o.key}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {(() => {
                const pickKeys = geologyLayoutMode === '2x2'
                  ? ['Ti', 'Mi', 'Hi', 'Di']
                  : geologyLayoutMode === '1x2'
                    ? [geoPickA, geoPickB]
                    : [geoPickA];

                const cols = geologyLayoutMode === '2x2'
                  ? 'grid-cols-1 lg:grid-cols-2'
                  : geologyLayoutMode === '1x2'
                    ? 'grid-cols-1 lg:grid-cols-2'
                    : 'grid-cols-1';

                return (
                  <div className={`grid ${cols} gap-6 ${geologyLayoutMode === '1x1' ? 'flex-1' : ''}`}>
                    {pickKeys.map((k, idx) => {
                      const p = geologyPanelsByKey[k] ?? geologyPanelsByKey.Ti;
                      const fieldPack = contourData[p.key];
                      return (
                        <CloudPanel
                          key={`${geologyLayoutMode}-${idx}-${p.key}`}
                          title={p.title}
                          paramKey={p.key}
                          fieldPack={fieldPack}
                          unit={p.unit}
                          subtitleOverride={p.subtitleOverride}
                          vizSize={geologyLayoutMode === '1x1' ? 'lg' : 'md'}
                        />
                      );
                    })}
                  </div>
                );
              })()}
            </>
          ) : (
            <>
          {/* 核心区域扰动分布主图可视化 - 可折叠 */}
          <div
            ref={mainMapContainerRef}
            className={`bg-white border border-slate-200 shadow-sm relative overflow-hidden group flex flex-col shrink-0 transition-all duration-300 ${
              isMainMapFullscreen ? 'rounded-none border-0 shadow-none h-screen' : 'rounded-2xl'
            } ${showMainMap ? 'min-h-[450px]' : 'h-14'}`}
          >
            {/* 背景点状装饰 */}
            {showMainMap && !hasSpatialData && (
              <div className="absolute inset-0 pointer-events-none opacity-[0.03]" 
                   style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>
            )}

            {/* 图名及说明条 - 放到上部（可点击折叠） */}
            <div className="p-4 border-b border-slate-50 flex items-center justify-between bg-white/80 backdrop-blur-sm shrink-0 cursor-pointer hover:bg-slate-50" onClick={() => setShowMainMap(!showMainMap)}>
               <div className="flex items-center gap-4">
                 <h3 className="font-bold text-slate-700 flex items-center gap-2 text-sm">
                    {mainViewMode === 'planning' ? '采区规划图' : '覆岩扰动 (ODI) 分布图'}
                 </h3>
                 {showMainMap && null}
               </div>
               <div className="flex gap-2 items-center">
                 {showMainMap && (
                   <div
                     className="flex flex-nowrap items-center justify-end gap-x-3 gap-y-0 overflow-x-auto max-w-full"
                     onClick={(e) => e.stopPropagation()}
                   >
                     <div className="flex items-center gap-2">
                       <select
                         className="bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700"
                         value={odiVizPalette}
                         onChange={(e) => setOdiVizPalette(e.target.value)}
                         title="ODI 色带"
                       >
                         {Object.keys(paletteStops).map((k) => (
                           <option key={k} value={k}>{k}</option>
                         ))}
                       </select>
                     </div>

                     <div className="h-4 w-px bg-slate-200 hidden md:block"></div>

                     <div className="flex items-center gap-1">
                       <div className="text-[11px] text-slate-500 font-bold">分级</div>
                       <input
                         type="range"
                         min={3}
                         max={10}
                         step={1}
                         value={odiVizSteps}
                         onChange={(e) => setOdiVizSteps(Number(e.target.value))}
                         className="w-24"
                         title="颜色分级数量（3~10）"
                       />
                       <div className="text-[11px] text-slate-600 font-mono w-5 -ml-2 text-right">{odiVizSteps}</div>
                     </div>

                     <div className="h-4 w-px bg-slate-200 hidden md:block"></div>

                     <div className="flex items-center gap-2">
                       <div className="text-[11px] text-slate-500 font-bold">区间</div>
                       <input
                         type="number"
                         step="0.01"
                         min={0}
                         max={1}
                         placeholder="Min"
                         value={odiVizRange.min}
                         onChange={(e) => setOdiVizRange((p) => ({ ...p, min: e.target.value }))}
                         className="w-20 bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700"
                         title="最小值（留空=自动）"
                       />
                       <span className="text-[11px] text-slate-400 font-mono">~</span>
                       <input
                         type="number"
                         step="0.01"
                         min={0}
                         max={1}
                         placeholder="Max"
                         value={odiVizRange.max}
                         onChange={(e) => setOdiVizRange((p) => ({ ...p, max: e.target.value }))}
                         className="w-20 bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700"
                         title="最大值（留空=自动）"
                       />
                     </div>

                     <div className="h-4 w-px bg-slate-200 hidden md:block"></div>

                     {(['aquifer', 'surface', 'upward'].includes(activeTab)) && (
                       <>
                         <SmoothnessSlider
                           value={activeTab === 'surface' ? surfaceOdiSmoothPasses : (activeTab === 'upward' ? upwardOdiSmoothPasses : aquiferOdiSmoothPasses)}
                           onChange={(v) => {
                             if (activeTab === 'surface') setSurfaceOdiSmoothPasses(v);
                             else if (activeTab === 'upward') setUpwardOdiSmoothPasses(v);
                             else setAquiferOdiSmoothPasses(v);
                           }}
                           label="平滑度"
                           title={activeTab === 'surface'
                             ? '地表下沉场景：平滑度（UI预留，后续可接入插值/后处理）'
                             : (activeTab === 'upward'
                               ? '上行开采场景：平滑度（UI预留，后续可接入插值/后处理）'
                               : '含水层场景：ODI 自然邻域插值平滑度（0=不平滑，越大越丝滑）')}
                         />
                         <div className="h-4 w-px bg-slate-200 hidden md:block"></div>
                       </>
                     )}

                     <button
                       className={`px-2 py-1 rounded text-[10px] font-bold border border-slate-200 transition-colors ${
                         showMainMapCoordinates ? 'bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-100 text-slate-400 hover:bg-slate-50'
                       }`}
                       onClick={() => setShowMainMapCoordinates((v) => !v)}
                       title={showMainMapCoordinates ? '隐藏主图坐标刻度与读数' : '显示主图坐标刻度与读数'}
                     >
                       {showMainMapCoordinates ? '隐藏坐标' : '显示坐标'}
                     </button>

                     <button
                       className={`px-2 py-1 rounded text-[10px] font-bold border border-slate-200 transition-colors ${
                         (!hasSpatialData || !spatialBounds)
                           ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                           : (measureEnabled ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700' : 'bg-white text-slate-600 hover:bg-slate-50')
                       }`}
                       onClick={() => {
                         if (!hasSpatialData || !spatialBounds) return;
                         setMeasurePoints([]);
                         setMeasureEnabled((v) => !v);
                       }}
                       disabled={!hasSpatialData || !spatialBounds}
                       title={(!hasSpatialData || !spatialBounds) ? '请先导入空间数据（边界/钻孔/工作面/实测）' : (measureEnabled ? '关闭测量（Esc）' : '开启测量：在图上点击两点')}
                       type="button"
                     >
                       测量
                     </button>

                     {measureEnabled && (
                       <div className="flex items-center gap-1 whitespace-nowrap shrink-0">
                         <button
                           className={`px-2 py-1 rounded text-[10px] font-bold border border-slate-200 transition-colors ${
                             measureAxis === 'h' ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700' : 'bg-white text-slate-600 hover:bg-slate-50'
                           }`}
                           onClick={() => setMeasureAxis('h')}
                           title="显示水平距离（ΔX）"
                           type="button"
                         >
                           水平
                         </button>
                         <button
                           className={`px-2 py-1 rounded text-[10px] font-bold border border-slate-200 transition-colors ${
                             measureAxis === 'v' ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700' : 'bg-white text-slate-600 hover:bg-slate-50'
                           }`}
                           onClick={() => setMeasureAxis('v')}
                           title="显示垂直距离（ΔY）"
                           type="button"
                         >
                           垂直
                         </button>
                         <button
                           className="px-2 py-1 rounded text-[10px] font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                           onClick={() => setMeasurePoints([])}
                           title="清空已选点"
                           type="button"
                         >
                           重置
                         </button>
                       </div>
                     )}
                   </div>
                 )}
                 <button className="p-1 hover:bg-slate-200 rounded transition-colors">
                   {showMainMap ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronUp size={16} className="text-slate-500" />}
                 </button>
               </div>
            </div>
            
            {showMainMap && (
              <div
                className="flex-1 flex items-center justify-center p-3 relative"
              >
                {/* 智能规划：工作面悬停 Tooltip（蓝色工作面） */}
                {mainViewMode === 'planning' && planningWorkfaceHover && planningWorkfaceTooltipData && (
                  <div
                    ref={planningWorkfaceTooltipRef}
                    className="absolute z-40 pointer-events-none"
                    style={{ left: 0, top: 0, transform: 'translate3d(12px, 12px, 0)' }}
                  >
                    <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg shadow-lg px-3 py-2 inline-block w-fit max-w-[360px]">
                      <div className="text-[11px] text-slate-700 font-mono whitespace-nowrap">
                        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                          <span className="text-slate-500">工作面编号：</span>
                          <span className="text-left">{`No. ${planningWorkfaceTooltipData.faceIndex}`}</span>

                          <span className="text-slate-500">工作面宽度（m）：</span>
                          <span className="text-left">{fmtOrDash(planningWorkfaceTooltipData.B_m, 2)}</span>

                          <span className="text-slate-500">推进长度（m）：</span>
                          <span className="text-left">{fmtOrDash(planningWorkfaceTooltipData.L_m, 2)}</span>

                          <span className="text-slate-500">工作面面积（m²）：</span>
                          <span className="text-left">{fmtOrDash(planningWorkfaceTooltipData.A_face_m2, 2)}</span>

                          <span className="text-slate-500">异常标记：</span>
                          <span className={planningWorkfaceTooltipData.abnormal ? 'text-left text-red-700 font-bold' : 'text-left text-slate-700'}>
                            {planningWorkfaceTooltipData.abnormal ? '裁剪后非矩形' : '正常'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 图显示容器：仅包裹 SVG，本次仅增加 bottom spacing（不移动下部图例、不改父级布局、不用 transform） */}
                <div className="flex items-center justify-center w-full h-full mb-6 pl-6">
                  <svg
                    ref={mainMapSvgRef}
                    viewBox="0 0 800 500"
                    className="w-[96%] h-[96%] drop-shadow-2xl transition-all duration-300"
                    onMouseMove={handleMainMapMouseMove}
                    onMouseLeave={handleMainMapMouseLeave}
                    onClick={handleMainMapClick}
                    style={{
                      ...(measureEnabled ? { cursor: 'crosshair' } : null),
                      // 允许坐标刻度文本在 viewBox 外渲染，避免左侧长坐标被裁剪
                      overflow: 'visible',
                    }}
                  >
                  <defs>
                    <radialGradient id="planning-boundary-overlay" cx="50%" cy="50%" r="0.85">
                      <stop offset="0%" stopColor="#f472b6" stopOpacity="0.35" />
                      <stop offset="60%" stopColor="#f472b6" stopOpacity="0.18" />
                      <stop offset="100%" stopColor="#f472b6" stopOpacity="0.08" />
                    </radialGradient>

                  </defs>
                  {/* 采区外框矩形（仅未导入数据时显示占位外框） */}
                  {!hasSpatialData && (
                    <rect x={MAIN_MAP_RECT.left} y={MAIN_MAP_RECT.top} width={MAIN_MAP_RECT.width} height={MAIN_MAP_RECT.height} fill="none" stroke="#e2e8f0" strokeWidth="2" strokeDasharray="10 5" />
                  )}

                  {/* 坐标刻度网格（工业风：主图坐标尺） */}
                  {showMainMapCoordinates && hasSpatialData && spatialBounds && (
                    <g pointerEvents="none">
                      {(() => {
                        const rect = MAIN_MAP_RECT;
                        const x0 = rect.left + rect.padding;
                        const x1 = rect.left + rect.width - rect.padding;
                        const y0 = rect.top + rect.padding;
                        const y1 = rect.top + rect.height - rect.padding;
                        const tickN = 6;
                        const fmt = (v) => {
                          const a = Math.abs(v);
                          if (a >= 1000) return v.toFixed(0);
                          if (a >= 100) return v.toFixed(1);
                          return v.toFixed(2);
                        };

                        const lines = [];
                        for (let i = 0; i < tickN; i++) {
                          const t = tickN <= 1 ? 0 : i / (tickN - 1);
                          const sx = x0 + t * (x1 - x0);
                          const wx = spatialBounds.minX + t * spatialBounds.rangeX;
                          lines.push(
                            <g key={`grid-x-${i}`}>
                              <line x1={sx} y1={y0} x2={sx} y2={y1} stroke="#cbd5e1" strokeOpacity="0.45" strokeWidth="1" />
                              <line x1={sx} y1={y1} x2={sx} y2={y1 + 5} stroke="#94a3b8" strokeOpacity="0.7" strokeWidth="1" />
                              <text x={sx} y={y1 + 16} fontSize="9" fill="#64748b" textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace">
                                {fmt(wx)}
                              </text>
                            </g>
                          );
                        }

                        for (let j = 0; j < tickN; j++) {
                          const t = tickN <= 1 ? 0 : j / (tickN - 1);
                          const sy = y1 - t * (y1 - y0);
                          const wy = spatialBounds.minY + t * spatialBounds.rangeY;
                          lines.push(
                            <g key={`grid-y-${j}`}>
                              <line x1={x0} y1={sy} x2={x1} y2={sy} stroke="#cbd5e1" strokeOpacity="0.45" strokeWidth="1" />
                              <line x1={x0 - 5} y1={sy} x2={x0} y2={sy} stroke="#94a3b8" strokeOpacity="0.7" strokeWidth="1" />
                              <text x={x0 - 8} y={sy + 3} fontSize="9" fill="#64748b" textAnchor="end" fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace">
                                {fmt(wy)}
                              </text>
                            </g>
                          );
                        }

                        // 细边框
                        lines.push(
                          <rect
                            key="grid-frame"
                            x={x0}
                            y={y0}
                            width={x1 - x0}
                            height={y1 - y0}
                            fill="none"
                            stroke="#94a3b8"
                            strokeOpacity="0.35"
                            strokeWidth="1"
                          />
                        );

                        return <>{lines}</>;
                      })()}
                    </g>
                  )}
                  {/* ODI 背景（未计算 ODI 时的占位底图） */}
                  {!odiHeatmapHref && !hasSpatialData && showLayerInterpolation && (
                    <>
                      <path d="M200 100 Q 400 0 600 100 T 600 400 Q 400 500 200 400 Z" fill="rgba(59, 130, 246, 0.05)" stroke="#3b82f6" strokeWidth="1" strokeOpacity="0.3" />
                      <path d="M250 150 Q 400 70 550 150 T 550 350 Q 400 430 250 350 Z" fill="rgba(59, 130, 246, 0.1)" stroke="#3b82f6" strokeWidth="2" strokeOpacity="0.5" />
                      <path d="M300 200 Q 400 150 500 200 T 500 300 Q 400 350 300 300 Z" fill="rgba(59, 130, 246, 0.2)" stroke="#3b82f6" strokeWidth="3" />
                    </>
                  )}

                  {/* 计算得到的 ODI 归一化等值分布（热力） */}
                  {odiHeatmapHref && showLayerInterpolation && (
                    <image href={odiHeatmapHref} x={MAIN_MAP_RECT.left} y={MAIN_MAP_RECT.top} width={MAIN_MAP_RECT.width} height={MAIN_MAP_RECT.height} preserveAspectRatio="none" opacity="0.92" />
                  )}
                  {hasSpatialData ? (
                    <g>
                      {showPlanningBoundaryOverlay && mainViewMode === 'planning' && hasBoundaryData && planningOmegaOverlayLoops.length >= 1 && (
                        <g pointerEvents="none">
                          {planningOmegaOverlayLoops.map((loop, i) => {
                            const pathD = (loop ?? [])
                              .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.nx} ${p.ny}`)
                              .join(' ');
                            if (!pathD) return null;
                            return (
                              <path
                                key={`planning-omega-${i}`}
                                d={`${pathD} Z`}
                                fill="url(#planning-boundary-overlay)"
                                opacity="0.85"
                                stroke="none"
                              />
                            );
                          })}
                        </g>
                      )}
                      {/* 采区边界虚线（连接全部边界点；自动消除相交） */}
                      {hasBoundaryData && normalizedBoundaryLoop.length >= 2 && (
                        (() => {
                          const pts = normalizedBoundaryLoop.map((p) => `${p.nx},${p.ny}`);
                          const closedPts = normalizedBoundaryLoop.length >= 3 ? [...pts, pts[0]] : pts;
                          return (
                            <polyline
                              points={closedPts.join(' ')}
                              fill="none"
                              stroke="#2563eb"
                              strokeWidth="2"
                              strokeOpacity="0.65"
                              strokeDasharray="8 6"
                            />
                          );
                        })()
                      )}

                      {/* 工作面虚线圈定（按 4 点一组判别工作面；自动消除相交） */}
                      {showWorkfaceOutline && hasWorkingFaceData && normalizedWorkfaceLoops.length > 0 && !(mainViewMode === 'planning' && normalizedPlannedWorkfaceLoops.length > 0) && (
                        <g>
                          {normalizedWorkfaceLoops.map((wf) => {
                            const loop = wf?.loop ?? [];
                            if (loop.length < 2) return null;
                            const pts = loop.map((p) => `${p.nx},${p.ny}`);
                            const closedPts = loop.length >= 3 ? [...pts, pts[0]] : pts;
                            return (
                              <polyline
                                key={`wf-outline-${wf.faceIndex}`}
                                points={closedPts.join(' ')}
                                fill="none"
                                stroke="#ec4899"
                                strokeWidth="2"
                                strokeOpacity="0.65"
                                strokeDasharray="7 6"
                              />
                            );
                          })}
                        </g>
                      )}

                      {/* 规划工作面虚线圈定（智能规划生成） */}
                      {mainViewMode === 'planning' && normalizedPlannedWorkfaceLoops.length > 0 && (
                        <g>
                          {normalizedPlannedWorkfaceLoops.map((wf) => {
                            const loop = wf?.loop ?? [];
                            if (loop.length < 2) return null;
                            const pts = loop.map((p) => `${p.nx},${p.ny}`);
                            const closedPts = loop.length >= 3 ? [...pts, pts[0]] : pts;
                            const showUnionOutline = planningOptMode === 'recovery' && normalizedPlannedWorkfaceUnionLoops.length > 0;
                            return (
                              <polygon
                                key={`wf-plan-${wf.faceIndex}-${String(wf?.__k ?? '')}`}
                                points={closedPts.join(' ')}
                                fill="#3b82f6"
                                fillOpacity="0.22"
                                // recovery：用 union 外轮廓统一描边，避免相邻面共享边重线
                                // efficiency：保持单面描边（不受 recovery 的外轮廓策略影响）
                                stroke={showUnionOutline ? 'none' : '#2563eb'}
                                strokeWidth={showUnionOutline ? 0 : 2}
                                strokeOpacity={showUnionOutline ? 0 : 0.7}
                                onMouseEnter={(e) => handlePlannedWorkfaceMouseEnter(e, wf.faceIndex)}
                                onMouseMove={handlePlannedWorkfaceMouseMove}
                                onMouseLeave={handlePlannedWorkfaceMouseLeave}
                              />
                            );
                          })}
                        </g>
                      )}

                      {/* 规划工作面外轮廓（union 后描边）：避免相邻面共享边产生“重线” */}
                      {mainViewMode === 'planning' && planningOptMode === 'recovery' && normalizedPlannedWorkfaceUnionLoops.length > 0 && (
                        <g pointerEvents="none">
                          {normalizedPlannedWorkfaceUnionLoops.map((loop, i) => {
                            if (!Array.isArray(loop) || loop.length < 2) return null;
                            const pts = loop.map((p) => `${p.nx},${p.ny}`);
                            const closedPts = loop.length >= 3 ? [...pts, pts[0]] : pts;
                            return (
                              <polyline
                                key={`wf-plan-union-${i}`}
                                points={closedPts.join(' ')}
                                fill="none"
                                stroke="#1d4ed8"
                                strokeWidth="2"
                                strokeOpacity="0.9"
                                strokeLinejoin="round"
                                strokeLinecap="round"
                              />
                            );
                          })}
                        </g>
                      )}

                      {/* 采区边界坐标控制点（蓝色） */}
                      {hasBoundaryData && normalizedBoundaryData.map((p) => (
                        <g key={`b-${p.id}-${p.x}-${p.y}`}>
                          <circle cx={p.nx} cy={p.ny} r="4" fill="#2563eb" opacity="0.9" />
                          {showBoundaryLabels && (
                            <text x={p.nx + 6} y={p.ny - 6} fontSize="10" fill="#334155">
                              {p.id}
                            </text>
                          )}
                        </g>
                      ))}

                      {/* 工作面坐标点（导入后立即显示，粉色；受“评价点-定位点”开关控制） */}
                      {hasWorkingFaceData && showEvalWorkfaceLocPoints && normalizedWorkingFaceDataVisible.map((p) => (
                        <g key={`wf-raw-${p.id}-${p.x}-${p.y}`}>
                          <circle
                            cx={p.nx}
                            cy={p.ny}
                            r="4"
                            fill={Number(p.faceIndex) === Number(activeSelectedFaceNo) ? '#ffffff' : '#ec4899'}
                            stroke={Number(p.faceIndex) === Number(activeSelectedFaceNo) ? '#ec4899' : 'none'}
                            strokeWidth={Number(p.faceIndex) === Number(activeSelectedFaceNo) ? 1.8 : 0}
                            opacity="0.9"
                          />
                        </g>
                      ))}

                      {/* 钻孔点（绿色，与边界区分） */}
                      {hasDrillholeData && showLayerDrillholes && normalizedDrillholeData.map((p) => (
                        <g key={`d-${p.id}-${p.x}-${p.y}`}>
                          <circle cx={p.nx} cy={p.ny} r="4" fill="#000000" opacity="0.85" />
                          {showDrillholeLabels && (
                            <text x={p.nx + 6} y={p.ny - 6} fontSize="10" fill="#334155">
                              {p.id}
                            </text>
                          )}
                        </g>
                      ))}

                      {/* 工作面评估点生成结果（按类别配色） */}
                      {generatedPoints && showLayerEvalPoints && (
                        <g>
                          {/* 评价边界点：灰色 */}
                          {showEvalBoundaryPoints && generatedByCat.gray.map((p) => (
                            <circle key={`gen-gray-${p.id}-${p.x}-${p.y}`} cx={p.nx} cy={p.ny} r="4" fill="#94a3b8" opacity="0.9" />
                          ))}
                          {/* 工作面定位控制点：粉色 */}
                          {showEvalWorkfaceLocPoints && (
                            generatedByCat.pink
                          ).map((p) => (
                            <circle
                              key={`gen-pink-${p.id}-${p.x}-${p.y}`}
                              cx={p.nx}
                              cy={p.ny}
                              r="4.5"
                              fill={Number(p.faceIndex) === Number(activeSelectedFaceNo) ? '#ffffff' : '#ec4899'}
                              stroke={Number(p.faceIndex) === Number(activeSelectedFaceNo) ? '#ec4899' : 'none'}
                              strokeWidth={Number(p.faceIndex) === Number(activeSelectedFaceNo) ? 1.8 : 0}
                              opacity="0.95"
                            />
                          ))}
                          {/* 边线控制点：绿色 */}
                          {showEvalEdgeCtrlPoints && generatedByCat.green.map((p) => (
                            <circle key={`gen-green-${p.id}-${p.x}-${p.y}`} cx={p.nx} cy={p.ny} r="3.2" fill="#22c55e" opacity="0.85" stroke="#14532d" strokeOpacity="0.25" />
                          ))}
                          {/* 中心控制点：红色 */}
                          {showEvalCenterCtrlPoints && generatedByCat.red.map((p) => (
                            <circle key={`gen-red-${p.id}-${p.x}-${p.y}`} cx={p.nx} cy={p.ny} r="3.2" fill="#ef4444" opacity="0.85" />
                          ))}
                        </g>
                      )}

                      {/* 实测点（叠加显示） */}
                      {normalizedMeasuredConstraintData.length > 0 && showMeasuredPoints && (
                        <g>
                          {normalizedMeasuredConstraintData.map((p) => (
                            <circle
                              key={`measured-${p.id}-${p.x}-${p.y}`}
                              cx={p.nx}
                              cy={p.ny}
                              r="4"
                              fill="#ffffff"
                              fillOpacity="0.85"
                              stroke="#ef4444"
                              strokeWidth="1.8"
                              opacity="0.95"
                            />
                          ))}
                        </g>
                      )}

                      {/* 十字准星（实时坐标与即时插值） */}
                      {showMainMapCoordinates && crosshair.active && (
                        <g pointerEvents="none">
                          {(() => {
                            const rect = MAIN_MAP_RECT;
                            const x0 = rect.left + rect.padding;
                            const x1 = rect.left + rect.width - rect.padding;
                            const y0 = rect.top + rect.padding;
                            const y1 = rect.top + rect.height - rect.padding;
                            const sx = crosshair.sx;
                            const sy = crosshair.sy;
                            return (
                              <>
                                <line x1={sx} y1={y0} x2={sx} y2={y1} stroke="#0f172a" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="4 3" />
                                <line x1={x0} y1={sy} x2={x1} y2={sy} stroke="#0f172a" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="4 3" />
                                <circle cx={sx} cy={sy} r="3" fill="#0f172a" fillOpacity="0.65" />
                              </>
                            );
                          })()}
                        </g>
                      )}

                      {/* 测量工具：两点距离（水平/垂直） */}
                      {measureEnabled && spatialBounds && (
                        <g pointerEvents="none">
                          {(() => {
                            const pts = Array.isArray(measurePoints) ? measurePoints : [];
                            const p1 = pts[0];
                            const p2 = pts[1] ?? (pts.length === 1 && crosshair.active && Number.isFinite(crosshair.wx) && Number.isFinite(crosshair.wy)
                              ? { sx: crosshair.sx, sy: crosshair.sy, wx: crosshair.wx, wy: crosshair.wy }
                              : null);
                            if (!p1) return null;

                            const has2 = Boolean(p2);
                            const dx = has2 ? Math.abs(Number(p2.wx) - Number(p1.wx)) : null;
                            const dy = has2 ? Math.abs(Number(p2.wy) - Number(p1.wy)) : null;
                            const dist = has2 ? (measureAxis === 'v' ? dy : dx) : null;
                            const label = (has2 && Number.isFinite(dist))
                              ? `${measureAxis === 'v' ? '垂直' : '水平'}距离：${dist.toFixed(2)}`
                              : '点击选择第 2 个点';

                            const midX = has2 ? (p1.sx + p2.sx) / 2 : p1.sx;
                            const midY = has2 ? (p1.sy + p2.sy) / 2 : p1.sy;

                            return (
                              <>
                                {/* 点标记 */}
                                <circle cx={p1.sx} cy={p1.sy} r="5" fill="#10b981" fillOpacity="0.95" stroke="#064e3b" strokeWidth="1.2" />
                                {has2 && (
                                  <circle cx={p2.sx} cy={p2.sy} r="5" fill="#f59e0b" fillOpacity="0.95" stroke="#78350f" strokeWidth="1.2" />
                                )}

                                {/* 连线 */}
                                {has2 && (
                                  <line x1={p1.sx} y1={p1.sy} x2={p2.sx} y2={p2.sy} stroke="#0f172a" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="6 5" />
                                )}

                                {/* 标签（描边提升可读性） */}
                                <text
                                  x={midX + 10}
                                  y={midY - 10}
                                  fontSize="12"
                                  fill="#0f172a"
                                  fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
                                  stroke="#ffffff"
                                  strokeWidth="3"
                                  paintOrder="stroke"
                                >
                                  {label}
                                </text>
                              </>
                            );
                          })()}
                        </g>
                      )}
                    </g>
                  ) : (
                    <>
                      {/* 默认示意点 */}
                      {[...Array(12)].map((_, i) => (
                        <circle key={i} cx={220 + Math.random() * 360} cy={100 + Math.random() * 300} r="3" fill="#94a3b8" />
                      ))}
                    </>
                  )}
                  </svg>
                </div>

                {/* 动态图例：有哪类点就显示哪类 */}
                {(() => {
                  const items = [];
                  if (hasDrillholeData && showLayerDrillholes) items.push({ key: 'geo', label: '地质坐标点', color: '#000000' });
                  if (generatedPoints?.gray?.length && showLayerEvalPoints && showEvalBoundaryPoints) items.push({ key: 'bnd', label: '边界点', color: '#94a3b8' });
                  if (hasBoundaryData) items.push({ key: 'area', label: '采区边界控制点', color: '#2563eb' });
                  if (normalizedMeasuredConstraintData.length > 0 && showMeasuredPoints) items.push({ key: 'measured', label: '实测点', color: '#ef4444' });
                  if (generatedPoints?.pink?.length && showLayerEvalPoints && showEvalWorkfaceLocPoints) {
                    items.push({ key: 'wfLoc', label: '工作面定位点', color: '#ec4899' });
                  } else if (hasWorkingFaceData && showEvalWorkfaceLocPoints) {
                    items.push({ key: 'wfRaw', label: '工作面坐标点', color: '#ec4899' });
                  }
                  if (generatedPoints?.green?.length && showLayerEvalPoints && showEvalEdgeCtrlPoints) items.push({ key: 'wfEdge', label: '边线控制点', color: '#22c55e' });
                  if (generatedPoints?.red?.length && showLayerEvalPoints && showEvalCenterCtrlPoints) items.push({ key: 'wfCenter', label: '中心控制点', color: '#ef4444' });
                  if (!items.length) return null;

                  return (
                    <div className="absolute left-4 right-4 bottom-2 z-30 flex items-end justify-between gap-4">
                      <div className="pointer-events-none">
                        <div className="bg-white/70 rounded px-3 py-2 flex flex-wrap gap-x-4 gap-y-2">
                          {items.map((it) => (
                            <div key={it.key} className="flex items-center gap-2 text-[11px] text-slate-600 font-medium">
                              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: it.color }} />
                              <span className="tracking-wide">{it.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* bottomActionBar：放大/导出/工作面标记/图层/重点（与图例同排，右侧右对齐） */}
                      <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
                        <button
                          className="p-1.5 hover:bg-white/60 rounded text-slate-500 border border-slate-200 bg-white/70 backdrop-blur-sm"
                          title={isMainMapFullscreen ? '退出全屏' : '全屏查看'}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleMainMapFullscreen();
                          }}
                          type="button"
                        >
                          <Maximize2 size={16} />
                        </button>

                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                          <button
                            data-main-map-export-button
                            className="p-1.5 rounded text-slate-600 text-[10px] font-bold uppercase tracking-tighter border border-slate-200 px-3 transition-colors bg-white/70 hover:bg-white"
                            onClick={() => {
                              setShowMainMapLabelsMenu(false);
                              setShowMainMapExportMenu((v) => !v);
                            }}
                            type="button"
                          >
                            导出
                          </button>
                          {showMainMapExportMenu && (
                            <div
                              data-main-map-export-menu
                              className="absolute right-0 bottom-full mb-2 w-44 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-50"
                            >
                              <button
                                className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                                onClick={() => {
                                  setShowMainMapExportMenu(false);
                                  exportMainMapPng();
                                }}
                                type="button"
                              >
                                导出 PNG
                              </button>
                              <button
                                className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${paramExtractionResult?.points?.length ? 'text-slate-700' : 'text-slate-400 cursor-not-allowed'}`}
                                disabled={!paramExtractionResult?.points?.length}
                                title={paramExtractionResult?.points?.length ? '导出 CSV：评价点全参数 + ODI' : '请先完成“全参插值提取 / 地质插值提取”'}
                                onClick={() => {
                                  setShowMainMapExportMenu(false);
                                  exportEvalPointsFullParamsWithOdiCsv();
                                }}
                                type="button"
                              >
                                导出 CSV（全参数+ODI）
                              </button>
                            </div>
                          )}
                        </div>

                        <button
                          className={`p-1.5 rounded text-[10px] font-bold uppercase tracking-tighter border border-slate-200 px-3 transition-colors ${
                            hasWorkingFaceData
                              ? (showWorkfaceOutline ? 'bg-slate-900 text-white' : 'bg-white/70 text-slate-700 hover:bg-white')
                              : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!hasWorkingFaceData) return;
                            setShowMainMapExportMenu(false);
                            setShowMainMapLabelsMenu(false);
                            setShowWorkfaceOutline((v) => !v);
                          }}
                          disabled={!hasWorkingFaceData}
                          title={hasWorkingFaceData ? `工作面虚线圈定开关（已识别 ${workfaceCount} 个工作面）` : '请先导入工作面坐标数据'}
                          type="button"
                        >
                          工作面标记
                        </button>

                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <div className="relative" onClick={(e) => e.stopPropagation()}>
                            <button
                              data-main-map-labels-button
                              className="p-1.5 rounded text-[10px] font-bold uppercase tracking-tighter border border-slate-200 px-3 transition-colors bg-white/70 text-slate-700 hover:bg-white"
                              onClick={() => {
                                setShowMainMapExportMenu(false);
                                setShowMainMapLabelsMenu((v) => !v);
                              }}
                              title="标签显示/隐藏"
                              type="button"
                            >
                              标签
                            </button>
                            {showMainMapLabelsMenu && (
                              <div
                                data-main-map-labels-menu
                                className="absolute right-0 bottom-full mb-2 w-48 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-50"
                              >
                                <button
                                  className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center justify-between"
                                  onClick={() => setShowBoundaryLabels((v) => !v)}
                                  type="button"
                                >
                                  <span>采区边界标签</span>
                                  <span className="text-[10px] text-slate-400">{showBoundaryLabels ? '显示' : '隐藏'}</span>
                                </button>
                                <button
                                  className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center justify-between"
                                  onClick={() => setShowDrillholeLabels((v) => !v)}
                                  type="button"
                                >
                                  <span>地质钻孔标签</span>
                                  <span className="text-[10px] text-slate-400">{showDrillholeLabels ? '显示' : '隐藏'}</span>
                                </button>
                              </div>
                            )}
                          </div>

                          <button
                            className={`p-1.5 rounded text-[10px] font-bold uppercase tracking-tighter border border-slate-200 px-3 transition-colors ${
                              showMeasuredPoints
                                ? 'bg-slate-900 text-white'
                                : 'bg-white/70 text-slate-700 hover:bg-white'
                            }`}
                            onClick={() => setShowMeasuredPoints((v) => !v)}
                            title="实测点显示/隐藏"
                            type="button"
                          >
                            实测点
                          </button>

                          {/* 图层开关 */}
                          <div className="flex items-center gap-1 ml-1">
                            <button
                              className={`p-1.5 rounded text-[10px] font-bold uppercase tracking-tighter border border-slate-200 px-3 transition-colors ${
                                showLayerInterpolation ? 'bg-slate-900 text-white' : 'bg-white/70 text-slate-700 hover:bg-white'
                              }`}
                              onClick={() => setShowLayerInterpolation((v) => !v)}
                              title="插值背景（ODI 热力）开关"
                              type="button"
                            >
                              插值
                            </button>
                            <button
                              className={`p-1.5 rounded text-[10px] font-bold uppercase tracking-tighter border border-slate-200 px-3 transition-colors ${
                                showLayerDrillholes ? 'bg-slate-900 text-white' : 'bg-white/70 text-slate-700 hover:bg-white'
                              }`}
                              onClick={() => setShowLayerDrillholes((v) => !v)}
                              title="地质钻孔点图层开关"
                              type="button"
                            >
                              钻孔
                            </button>
                            <div className="flex items-center gap-1">
                              <button
                                className={`p-1.5 rounded text-[10px] font-bold uppercase tracking-tighter border border-slate-200 px-3 transition-colors ${
                                  showLayerEvalPoints ? 'bg-slate-900 text-white' : 'bg-white/70 text-slate-700 hover:bg-white'
                                }`}
                                onClick={() =>
                                  setShowLayerEvalPoints((v) => {
                                    const next = !v;
                                    // “评价点”=四类评价点总开关：边界点/定位点/边线点/中心点
                                    setShowEvalBoundaryPoints(next);
                                    setShowEvalWorkfaceLocPoints(next);
                                    setShowEvalEdgeCtrlPoints(next);
                                    setShowEvalCenterCtrlPoints(next);
                                    return next;
                                  })
                                }
                                title="工作面评价点图层开关"
                                type="button"
                              >
                                评价点
                              </button>
                              {showLayerEvalPoints && (
                                <div className="flex items-center gap-1">
                                  <button
                                    className={`px-2 py-1 rounded text-[10px] font-bold border border-slate-200 transition-colors ${
                                      showEvalBoundaryPoints ? 'bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-100 text-slate-400 hover:bg-slate-50'
                                    }`}
                                    onClick={() => setShowEvalBoundaryPoints((v) => !v)}
                                    title="评价点：边界点（灰）"
                                    type="button"
                                  >
                                    边界点
                                  </button>
                                  <button
                                    className={`px-2 py-1 rounded text-[10px] font-bold border border-slate-200 transition-colors ${
                                      showEvalWorkfaceLocPoints ? 'bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-100 text-slate-400 hover:bg-slate-50'
                                    }`}
                                    onClick={() => setShowEvalWorkfaceLocPoints((v) => !v)}
                                    title="评价点：工作面定位点（粉）"
                                    type="button"
                                  >
                                    定位点
                                  </button>
                                  <button
                                    className={`px-2 py-1 rounded text-[10px] font-bold border border-slate-200 transition-colors ${
                                      showEvalEdgeCtrlPoints ? 'bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-100 text-slate-400 hover:bg-slate-50'
                                    }`}
                                    onClick={() => setShowEvalEdgeCtrlPoints((v) => !v)}
                                    title="评价点：边线控制点（绿）"
                                    type="button"
                                  >
                                    边线点
                                  </button>
                                  <button
                                    className={`px-2 py-1 rounded text-[10px] font-bold border border-slate-200 transition-colors ${
                                      showEvalCenterCtrlPoints ? 'bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-100 text-slate-400 hover:bg-slate-50'
                                    }`}
                                    onClick={() => setShowEvalCenterCtrlPoints((v) => !v)}
                                    title="评价点：中心控制点（红）"
                                    type="button"
                                  >
                                    中心点
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* 十字准星读数面板 */}
                {showMainMapCoordinates && crosshair.active && (
                  <div className="absolute left-4 top-4 z-30 pointer-events-none">
                    <div className="bg-white/85 backdrop-blur-sm rounded border border-slate-200 px-3 py-2 shadow-sm">
                      <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">实时剖面探针</div>
                      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-700 font-mono">
                        <div>Y: {Number.isFinite(crosshair.wy) ? crosshair.wy.toFixed(2) : '-'}</div>
                        <div>X: {Number.isFinite(crosshair.wx) ? crosshair.wx.toFixed(2) : '-'}</div>
                        <div>Mi: {Number.isFinite(crosshair.values?.Mi) ? crosshair.values.Mi.toFixed(3) : '-'}</div>
                        <div>ODI: {Number.isFinite(crosshair.values?.odiNorm) ? crosshair.values.odiNorm.toFixed(3) : '-'}</div>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">移动鼠标：实时坐标 + 即时插值</div>
                    </div>
                  </div>
                )}

              </div>
            )}

          </div>
            </>
          )}

          {mainViewMode === 'planning' && (
            <div ref={planningOptPanelAnchorRef} style={{ scrollMarginTop: 24 }}>
              <MultiObjectivePlanPanel
                value={planningOptMode}
                onChange={handlePlanningOptModeChange}
                weights={planningOptWeights}
                onWeightsChange={setPlanningOptWeights}
                defaultCollapsed={false}
                showSummaryWhenCollapsed={false}
              />

              {planningOptMode === 'efficiency' && (
                <section ref={planningEfficiencySectionRef} className="mt-4 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">工程效率候选对比表</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {planningEfficiencyBusy && (
                        <div className="text-[10px] text-slate-400 font-mono">
                          {(() => {
                            const p = planningEfficiencyProgress;
                            const pct = Number(p?.percent);
                            const tried = Number(p?.attemptedCombos);
                            const ok = Number(p?.feasibleCombos);
                            const phase = String(p?.phase ?? '').trim();
                            const wsI = Number(p?.wsIndex);
                            const wsT = Number(p?.wsTotal);
                            const nI = Number(p?.nIndex);
                            const nT = Number(p?.nTotal);
                            const parts = [];
                            if (Number.isFinite(pct)) parts.push(`${Math.max(0, Math.min(99, Math.round(pct)))}%`);
                            if (Number.isFinite(wsI) && Number.isFinite(wsT) && wsT >= 1) parts.push(`ws ${Math.max(1, Math.round(wsI))}/${Math.round(wsT)}`);
                            if (Number.isFinite(nI) && Number.isFinite(nT) && nT >= 1) parts.push(`N ${Math.max(1, Math.round(nI))}/${Math.round(nT)}`);
                            if (Number.isFinite(tried)) parts.push(`已尝试${Math.max(0, Math.round(tried))}`);
                            if (Number.isFinite(ok)) parts.push(`可行${Math.max(0, Math.round(ok))}`);
                            if (phase) parts.push(phase);
                            const suffix = parts.length ? `（${parts.join('，')}）` : '';
                            return `计算中…${suffix}`;
                          })()}
                        </div>
                      )}
                      {planningEfficiencyResult?.ok && (
                        <>
                          <div className="text-[10px] text-slate-400 font-mono">
                            候选：{planningEfficiencyResult?.stats?.topK ?? 0} / {planningEfficiencyResult?.stats?.candidateCount ?? 0}
                          </div>
                          <button
                            type="button"
                            className="px-2 py-1 text-[10px] rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
                            onClick={openEfficiencyDebugModal}
                            title="打开计算过程弹窗，可复制请求/回包/Top10候选的关键字段"
                          >
                            计算过程
                          </button>
                          {Array.isArray(planningEfficiencyResult?.table?.rows) && planningEfficiencyResult.table.rows.length > 1 && (
                            <button
                              type="button"
                              className="px-2 py-1 text-[10px] rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
                              onClick={handleToggleEfficiencyCandidates}
                              title="默认仅展示最优方案；可展开查看TopK候选对比表"
                            >
                              {planningEfficiencyShowAllCandidates ? '仅显示最优' : '展开候选'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {!planningEfficiencyResult && (
                    <div className="p-4 text-[11px] text-slate-500">请点击“启动智能采区规划”，或调整煤柱/面宽范围以生成候选。</div>
                  )}

                  {planningEfficiencyResult && !planningEfficiencyResult.ok && (
                    <div className="p-4 text-[11px] text-amber-700 bg-amber-50 border-t border-amber-100">
                      {String(planningEfficiencyResult?.message ?? '工程效率计算失败')}
                    </div>
                  )}

                  {planningEfficiencyResult?.ok && (
                    <div className="w-full">
                      <div className="w-full overflow-x-auto">
                      <table className="w-full table-auto text-[11px]">
                        <thead className="sticky top-0 bg-white border-b border-slate-100">
                          <tr>
                            <th className="w-12 text-center py-2 px-1 text-slate-500 font-bold whitespace-nowrap">序号</th>
                            <th className="w-14 text-center py-2 px-1 text-slate-500 font-bold whitespace-nowrap">方案选择</th>
                            <th className="min-w-[96px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">工作面个数 N（个）</th>
                            <th className="min-w-[112px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">工作面宽度 B（m）</th>
                            <th className="min-w-[96px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">边界煤柱 w_b（m）</th>
                            <th className="min-w-[96px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">区段煤柱 w_s（m）</th>
                            <th className="min-w-[88px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">覆盖率（%）</th>
                            <th className="min-w-[112px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">可采区面积（㎡）</th>
                            <th className="min-w-[112px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">回采面积（㎡）</th>
                            <th className="min-w-[112px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">工程效率综合评分</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const rows0 = planningEfficiencyResult?.table?.rows ?? [];
                            const rows = planningEfficiencyShowAllCandidates ? rows0 : rows0.slice(0, 1);

                            return rows.map((r) => {
                              const sig = String(r?.signature ?? '');
                              const active = sig && sig === planningEfficiencySelectedSig;
                              const fmt1 = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '--');
                              const fmt0 = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(0) : '--');
                              const fmtPct = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '--');
                              const fmtScore = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '--');

                              return (
                                <tr
                                  key={sig || `row-${r?.rank}`}
                                  className={
                                    `border-b border-slate-50 last:border-b-0 cursor-pointer transition-colors ` +
                                    (active ? 'bg-pink-50/60' : 'hover:bg-slate-50')
                                  }
                                  onClick={() => handleSelectEfficiencyCandidate(sig)}
                                  title="点击：联动绘图"
                                >
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{r?.rank ?? '--'}</td>
                                  <td className="py-2 px-2 text-center">
                                    <input
                                      type="radio"
                                      name="planning-efficiency-choice"
                                      checked={Boolean(active)}
                                      onChange={() => handleSelectEfficiencyCandidate(sig)}
                                      onClick={(e) => e.stopPropagation()}
                                      aria-label="选择方案"
                                    />
                                  </td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-bold">{r?.N ?? '--'}</td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{fmt1(r?.B)}</td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{fmt1(r?.wb)}</td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{fmt1(r?.ws)}</td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{fmtPct(r?.coveragePct)}</td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{fmt0(r?.innerArea)}</td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{fmt0(r?.coveredArea)}</td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{fmtScore(r?.efficiencyScore)}</td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  )}

                  {planningEfficiencyDebugOpen && (
                    <div
                      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
                      role="dialog"
                      aria-modal="true"
                      onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setPlanningEfficiencyDebugOpen(false);
                      }}
                    >
                      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                        <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                          <div className="text-[12px] font-bold text-slate-700">工程效率计算过程（可复制）</div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="px-2 py-1 text-[11px] rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                              onClick={copyEfficiencyDebugText}
                            >
                              复制JSON
                            </button>
                            <button
                              type="button"
                              className="px-2 py-1 text-[11px] rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                              onClick={() => setPlanningEfficiencyDebugOpen(false)}
                            >
                              关闭
                            </button>
                          </div>
                        </div>
                        <div className="p-3">
                          <textarea
                            className="w-full h-[70vh] font-mono text-[11px] rounded border border-slate-200 p-2 text-slate-700"
                            readOnly
                            value={String(planningEfficiencyDebugText ?? '')}
                          />
                          <div className="mt-2 text-[11px] text-slate-500">
                            提示：把这段JSON完整复制发我即可（包含请求参数、回包 stats、Top10 候选关键字段）。
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {planningOptMode === 'recovery' && (
                <section ref={planningRecoverySectionRef} className="mt-4 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">资源回收最优计算结果</div>
                      {planningRecoveryResult?.ok && planningRecoveryResult?.stats && planningRecoveryResult?.stats?.hasThickness === false && (
                        <div className="mt-1 text-[11px] text-amber-700">当前未检测到厚度输入：已按覆盖率进行排序（退化模式）。</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {planningRecoveryBusy && (
                        <div className="text-[10px] text-slate-400 font-mono">
                          {(() => {
                            const p = planningRecoveryProgress;
                            const pct = Number(p?.percent);
                            const tried = Number(p?.attemptedCombos);
                            const ok = Number(p?.feasibleCombos);
                            const phase = String(p?.phase ?? '').trim();
                            const parts = [];
                            if (Number.isFinite(pct)) parts.push(`${Math.max(0, Math.min(99, Math.round(pct)))}%`);
                            if (Number.isFinite(tried)) parts.push(`已尝试${Math.max(0, Math.round(tried))}`);
                            if (Number.isFinite(ok)) parts.push(`可行${Math.max(0, Math.round(ok))}`);
                            if (phase) parts.push(phase);
                            const suffix = parts.length ? `（${parts.join('，')}）` : '';
                            return `计算中…${suffix}`;
                          })()}
                        </div>
                      )}
                      {planningRecoveryResult?.ok && (
                        <>
                          <div className="text-[10px] text-slate-400 font-mono">
                            候选：{planningRecoveryResult?.stats?.topK ?? 0} / {planningRecoveryResult?.stats?.candidateCount ?? 0}
                          </div>
                          <button
                            type="button"
                            className="px-2 py-1 text-[10px] rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
                            onClick={openRecoveryDebugModal}
                            title="打开调试弹窗，可复制请求/回包/Top10候选的关键字段"
                          >
                            计算过程
                          </button>
                          {Array.isArray(planningRecoveryResult?.table?.rows) && planningRecoveryResult.table.rows.length > 1 && (
                            <button
                              type="button"
                              className="px-2 py-1 text-[10px] rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
                              onClick={handleToggleRecoveryCandidates}
                              title="默认仅展示最优方案；可展开查看TopK候选对比表"
                            >
                              {planningRecoveryShowAllCandidates ? '仅显示最优' : '展开候选'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {!planningRecoveryResult && (
                    <div className="p-4 text-[11px] text-slate-500">请点击“启动智能采区规划”，或调整煤柱/面宽范围以生成候选。</div>
                  )}

                  {planningRecoveryResult && !planningRecoveryResult.ok && (
                    <div className="p-4 text-[11px] text-amber-700 bg-amber-50 border-t border-amber-100">
                      {String(planningRecoveryResult?.message ?? '资源回收计算失败')}
                    </div>
                  )}

                  {planningRecoveryResult?.ok && (
                    <div className="w-full">
                      <div className="w-full overflow-x-auto">
                        <table className="w-full table-auto text-[11px]">
                          <thead className="sticky top-0 bg-white border-b border-slate-100">
                            <tr>
                              <th className="w-12 text-center py-2 px-1 text-slate-500 font-bold whitespace-nowrap">序号</th>
                              <th className="w-14 text-center py-2 px-1 text-slate-500 font-bold whitespace-nowrap">方案选择</th>
                              <th className="min-w-[96px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">工作面个数（个）</th>
                              <th className="min-w-[112px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">工作面宽度（m）</th>
                              <th className="min-w-[120px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">推进长度（m）</th>
                              <th className="min-w-[84px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">异常面</th>
                              <th className="min-w-[96px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">边界煤柱（m）</th>
                              <th className="min-w-[96px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">区段煤柱（m）</th>
                              <th className="min-w-[88px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">覆盖率（%）</th>
                              <th className="min-w-[112px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">回采面积（㎡）</th>
                              <th className="min-w-[112px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">总储量（t）</th>
                              <th className="min-w-[112px] text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">资源回收评分</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const rows0 = planningRecoveryResult?.table?.rows ?? [];
                              const rows = planningRecoveryShowAllCandidates ? rows0 : rows0.slice(0, 1);

                              return rows.map((r) => {
                              const sig = String(r?.signature ?? '');
                              const active = sig && sig === planningRecoverySelectedSig;
                              const fmt1 = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '--');
                              const fmt0 = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(0) : '--');
                              const fmtPct = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '--');
                              const fmtScore = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '--');

                              return (
                                <tr
                                  key={sig || `row-${r?.rank}`}
                                  className={
                                    `border-b border-slate-50 last:border-b-0 cursor-pointer transition-colors ` +
                                    (active ? 'bg-pink-50/60' : 'hover:bg-slate-50')
                                  }
                                  onClick={() => handleSelectRecoveryCandidate(sig)}
                                  title="点击：联动绘图"
                                >
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{r?.rank ?? '--'}</td>
                                  <td className="py-2 px-2 text-center">
                                    <input
                                      type="radio"
                                      name="planning-recovery-choice"
                                      checked={Boolean(active)}
                                      onChange={() => handleSelectRecoveryCandidate(sig)}
                                      onClick={(e) => e.stopPropagation()}
                                      aria-label="选择方案"
                                    />
                                  </td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-bold">{r?.N ?? '--'}</td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">
                                    {(() => {
                                      const b0 = Number(r?.BMin);
                                      const b1 = Number(r?.BMax);
                                      if (Number.isFinite(b0) && Number.isFinite(b1)) {
                                        if (Math.abs(b0 - b1) <= 1e-6) return fmt1(b0);
                                        return `${fmt1(b0)}~${fmt1(b1)}`;
                                      }
                                      return fmt1(r?.B);
                                    })()}
                                  </td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">
                                    {(() => {
                                      const l0 = Number(r?.minL);
                                      const l1 = Number(r?.maxL);
                                      if (Number.isFinite(l0) && Number.isFinite(l1)) {
                                        if (Math.abs(l0 - l1) <= 1e-6) return fmt1(l0);
                                        return `${fmt1(l0)}~${fmt1(l1)}`;
                                      }
                                      return '--';
                                    })()}
                                  </td>
                                  <td
                                    className={
                                      `py-2 px-2 text-center font-mono ` +
                                      ((Number(r?.abnormalFaceCount) > 0) ? 'text-red-700 font-bold' : 'text-slate-700')
                                    }
                                    title={(Number(r?.abnormalFaceCount) > 0 && String(r?.abnormalFaceIndices || ''))
                                      ? `异常面编号：${String(r.abnormalFaceIndices)}`
                                      : ''}
                                  >
                                    {(() => {
                                      const k = Number(r?.abnormalFaceCount);
                                      if (!Number.isFinite(k)) return '--';
                                      if (k <= 0) return '0';
                                      const idx = String(r?.abnormalFaceIndices || '');
                                      return idx ? `${Math.round(k)}（${idx}）` : String(Math.round(k));
                                    })()}
                                  </td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{fmt1(r?.wb)}</td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{fmt1(r?.ws)}</td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{fmtPct(r?.coveragePct)}</td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{fmt0(r?.coveredArea)}</td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{fmt0(r?.tonnageTotal)}</td>
                                  <td className="py-2 px-2 text-center text-slate-700 font-mono">{fmtScore(r?.recoveryScore)}</td>
                                </tr>
                              );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {planningRecoveryDebugOpen && (
                    <div
                      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
                      role="dialog"
                      aria-modal="true"
                      onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setPlanningRecoveryDebugOpen(false);
                      }}
                    >
                      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                        <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                          <div className="text-[12px] font-bold text-slate-700">资源回收计算过程（可复制）</div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="px-2 py-1 text-[11px] rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                              onClick={copyRecoveryDebugText}
                            >
                              复制JSON
                            </button>
                            <button
                              type="button"
                              className="px-2 py-1 text-[11px] rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                              onClick={() => setPlanningRecoveryDebugOpen(false)}
                            >
                              关闭
                            </button>
                          </div>
                        </div>
                        <div className="p-3">
                          <textarea
                            className="w-full h-[70vh] font-mono text-[11px] rounded border border-slate-200 p-2 text-slate-700"
                            readOnly
                            value={String(planningRecoveryDebugText ?? '')}
                          />
                          <div className="mt-2 text-[11px] text-slate-500">
                            提示：把这段JSON完整复制发我即可（包含请求参数、fast标记、Top10签名、dlt/theta/bL、minInRatio/面积等）。
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}

          {mainViewMode === 'odi' && (
            <>
              {/* 实测分级对应分析（主图 ↔ 误差趋势之间，可折叠） */}
              <section className={`bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col shrink-0 transition-all duration-300 ${showMeasuredMapping ? 'h-auto' : 'h-14 overflow-hidden'}`}>
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
                  onClick={() => setShowMeasuredMapping((v) => !v)}
                >
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <ClipboardCheck size={14} className="text-emerald-500" /> 实测分级对应分析
                  </h3>
                  <div className="flex items-center gap-3">
                    {showMeasuredMapping && (
                      <div className="text-[10px] text-slate-400 font-mono">
                        {(activeTab === 'surface' || activeTab === 'aquifer')
                          ? ((measuredZoningResult?.scenario === activeTab && measuredZoningResult?.bins?.length === 5)
                            ? '已分级'
                            : (measuredConstraintData?.length ? '待分区' : '未导入'))
                          : '待实现'}
                      </div>
                    )}
                    <button className="p-1 hover:bg-slate-200 rounded transition-colors" type="button">
                      {showMeasuredMapping ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronUp size={16} className="text-slate-500" />}
                    </button>
                  </div>
                </div>
                {showMeasuredMapping && (
                  <div className="p-4">
                    {activeTab === 'aquifer' ? (
                      <div className="w-full overflow-x-auto">
                        <table className="w-full table-fixed text-[11px]">
                          <thead className="sticky top-0 bg-white border-b border-slate-100">
                            <tr>
                              <th className="w-1/3 text-center py-2 px-3 text-slate-500 font-bold whitespace-nowrap">扰动等级</th>
                              <th className="w-1/3 text-center py-2 px-3 text-slate-500 font-bold whitespace-nowrap">ODI区间</th>
                              <th className="w-1/3 text-center py-2 px-3 text-slate-500 font-bold whitespace-nowrap">工程含义</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              {
                                lv: 'Ⅰ 轻微扰动',
                                odi: '0.00 ≤ ODI < 0.40',
                                meaning: '覆岩结构整体稳定，采动扰动影响有限',
                              },
                              {
                                lv: 'Ⅱ 较弱扰动',
                                odi: '0.40 ≤ ODI < 0.65',
                                meaning: '覆岩产生一定扰动响应，破坏程度较低',
                              },
                              {
                                lv: 'Ⅲ 中等扰动',
                                odi: '0.65 ≤ ODI < 0.85',
                                meaning: '覆岩扰动显著，裂隙发育逐步增强',
                              },
                              {
                                lv: 'Ⅳ 较强扰动',
                                odi: '0.85 ≤ ODI < 0.90',
                                meaning: '对应实测覆岩严重破坏高度约50~55 m',
                              },
                              {
                                lv: 'Ⅴ 强扰动',
                                odi: 'ODI ≥ 0.90',
                                meaning: '对应实测覆岩严重破坏高度大于55 m',
                              },
                            ].map((r) => (
                              <tr key={r.lv} className="border-b border-slate-50 last:border-b-0">
                                <td className="w-1/3 py-2 px-3 text-center text-slate-700 font-bold whitespace-nowrap">{r.lv}</td>
                                <td className="w-1/3 py-2 px-3 text-center text-slate-700 font-mono whitespace-nowrap">{r.odi}</td>
                                <td className="w-1/3 py-2 px-3 text-center text-slate-700 whitespace-normal break-words">{r.meaning}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (activeTab === 'surface') ? (
                      (measuredZoningResult?.scenario === activeTab && measuredZoningResult?.bins?.length === 5) ? (
                        <div className="w-full overflow-x-auto">
                          <table className="w-full table-fixed text-[11px]">
                            <thead className="sticky top-0 bg-white border-b border-slate-100">
                              <tr>
                                <th className="w-1/6 text-center py-2 px-3 text-slate-500 font-bold whitespace-nowrap">扰动等级</th>
                                {['I 级', 'II 级', 'III 级', 'IV 级', 'V 级'].map((lv) => (
                                  <th key={lv} className="w-1/6 text-center py-2 px-3 text-slate-500 font-bold whitespace-nowrap">{lv}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(() => {
                                const bins = measuredZoningResult?.bins ?? [];
                                const fmtOdi = (v) => (Number.isFinite(v) ? Number(v).toFixed(3) : '--');
                                const fmtS = (v) => (Number.isFinite(v) ? Number(v).toFixed(2) : '--');
                                const odiCell = (idx) => {
                                  const b = bins[idx];
                                  const lo = Number(b?.odiLo);
                                  const hi = Number(b?.odiHi);
                                  if (idx === 0) return `${fmtOdi(lo)} ≤ ODI < ${fmtOdi(hi)}`;
                                  if (idx === 4) return `ODI ≥ ${fmtOdi(lo)}`;
                                  return `${fmtOdi(lo)} ≤ ODI < ${fmtOdi(hi)}`;
                                };
                                const sCell = (idx) => {
                                  const b = bins[idx];
                                  const lo = Number(b?.measuredMin);
                                  const hi = Number(b?.measuredMax);
                                  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi >= lo)) return '--';
                                  if (idx === 4) return `≥ ${fmtS(lo)}`;
                                  return `${fmtS(lo)}~${fmtS(hi)}`;
                                };

                                const measuredRowLabel = '对应地表下沉量范围（m）';

                                return (
                                  <>
                                    <tr className="border-b border-slate-50">
                                      <td className="w-1/6 py-2 px-3 text-center text-slate-700 font-bold whitespace-nowrap">ODI</td>
                                      {[0, 1, 2, 3, 4].map((i) => (
                                        <td key={`odi-${i}`} className="w-1/6 py-2 px-3 text-center text-slate-700 font-mono whitespace-nowrap">{odiCell(i)}</td>
                                      ))}
                                    </tr>
                                    <tr className="border-b border-slate-50 last:border-b-0">
                                      <td className="w-1/6 py-2 px-3 text-center text-slate-700 font-bold whitespace-normal break-words">{measuredRowLabel}</td>
                                      {[0, 1, 2, 3, 4].map((i) => (
                                        <td key={`s-${i}`} className="w-1/6 py-2 px-3 text-center text-slate-700 font-mono whitespace-nowrap">{sCell(i)}</td>
                                      ))}
                                    </tr>
                                  </>
                                );
                              })()}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 leading-5">
                          {measuredConstraintData?.length
                            ? '已导入实测约束数据，请在右侧“分级响应详情”中点击“启动实测约束分区”。'
                            : '请先在左侧导入“实测约束数据”，再点击“启动实测约束分区”。'}
                        </div>
                      )
                    ) : (
                      <div className="text-[11px] text-slate-500 leading-5">
                        该场景的实测分级对应分析后续再优化（界面功能保持一致）。
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* 误差分析趋势模块 - 可折叠 */}
              <section className={`bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col shrink-0 transition-all duration-300 ${showErrorAnalysis ? 'h-64' : 'h-14'}`}>
                <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50" onClick={() => setShowErrorAnalysis(!showErrorAnalysis)}>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <BarChart3 size={14} className="text-emerald-500" /> 评估结果误差分析趋势
                  </h3>
                  <div className="flex items-center gap-3">
                    {showErrorAnalysis && (
                      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const measuredLabel = getMeasuredValueLabelByScenario(activeTab);
                          return (
                        <div className="flex items-center gap-3 text-[10px] text-slate-400 font-medium">
                          <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-500"></span> ODI</div>
                          <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 border-b border-dashed border-red-500"></span> {measuredLabel}(m)</div>
                          <div className="flex items-center gap-1.5"><span className="w-3 h-2 bg-slate-300 rounded-sm"></span> 误差</div>
                        </div>
                          );
                        })()}
                        <div className="h-4 w-px bg-slate-200"></div>
                        <select
                          className="bg-white border border-slate-200 rounded px-2 py-1 text-[10px] font-bold text-slate-700"
                          value={selectedMeasuredLineId || ''}
                          onChange={(e) => setSelectedMeasuredLineId(e.target.value)}
                          title="测线选择（按导入文件分组）"
                        >
                          {measuredConstraintLines?.length ? (
                            measuredConstraintLines.map((l) => (
                              <option key={l.lineId} value={l.lineId}>{l.label || l.lineId}</option>
                            ))
                          ) : (
                            <option value="">未导入测线</option>
                          )}
                        </select>
                      </div>
                    )}
                    <button className="p-1 hover:bg-slate-200 rounded transition-colors">
                      {showErrorAnalysis ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronUp size={16} className="text-slate-500" />}
                    </button>
                  </div>
                </div>
                {showErrorAnalysis && (
                  <div ref={errorChartContainerRef} className="flex-1 w-full min-h-0 px-5 pb-5">
                    {(() => {
                      const lineKey = String(selectedMeasuredLineId ?? '').trim();
                      const data = errorAnalysisByLineId?.[lineKey]?.data ?? [];
                      const measuredMaxAbs = errorAnalysisByLineId?.[lineKey]?.stats?.measuredMaxAbs;
                      const rightMax = Number.isFinite(measuredMaxAbs) ? Math.max(0, measuredMaxAbs) : 0;

                      if (!measuredConstraintLines?.length) {
                        return <div className="h-full flex items-center justify-center text-[11px] text-slate-500">未导入实测测线数据</div>;
                      }
                      if (!data.length) {
                        return <div className="h-full flex items-center justify-center text-[11px] text-slate-500">暂无误差数据：请在右侧点击“计算误差”</div>;
                      }

                      return (
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="id" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                            {/* 左轴1：误差柱状（0→1，自下而上） */}
                            <YAxis
                              yAxisId="err"
                              orientation="left"
                              domain={[0, 1]}
                              tick={{ fontSize: 9, fill: '#94a3b8' }}
                              axisLine={false}
                              tickLine={false}
                            />
                            {/* 左轴2：ODI 再归一化（1→0，自下而上显示为递减），与误差轴重叠 */}
                            <YAxis
                              yAxisId="odi"
                              orientation="left"
                              domain={[0, 1]}
                              reversed
                              tick={false}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              yAxisId="right"
                              orientation="right"
                              domain={[0, Math.max(0.000001, rightMax)]}
                              reversed
                              tick={{ fontSize: 9, fill: '#94a3b8' }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '10px' }}
                              cursor={{ fill: '#f8fafc' }}
                              formatter={(value, name, props) => {
                                const row = props?.payload;
                                const measuredLabel = getMeasuredValueLabelByScenario(activeTab);

                                if (name === 'errorRatioChart' || name === 'errorRatio') {
                                  const raw = Number(row?.errorRatio);
                                  const pct = Number.isFinite(raw) ? raw * 100 : null;
                                  return [pct != null ? `${pct.toFixed(2)}%` : '--', '误差'];
                                }
                                if (name === 'odiRenorm') {
                                  const v = Number(value);
                                  return [Number.isFinite(v) ? v.toFixed(3) : '--', 'ODI'];
                                }
                                if (name === 'measured') {
                                  const v = Number(value);
                                  return [Number.isFinite(v) ? `${v.toFixed(3)} m` : '--', measuredLabel];
                                }
                                return [value, name];
                              }}
                            />
                        <Bar yAxisId="err" dataKey="errorRatioChart" fill="#cbd5e1" name="误差" radius={[4, 4, 0, 0]} barSize={20} />
                        <Line yAxisId="odi" type="monotone" dataKey="odiRenorm" stroke="#3b82f6" name="ODI" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} />
                        <Line yAxisId="right" type="monotone" dataKey="measured" stroke="#ef4444" name={getMeasuredValueLabelByScenario(activeTab)} strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: '#ef4444' }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  );
                })()}
              </div>
            )}
          </section>
            </>
          )}
        </div>
      </main>

      {/* 右侧 - Accordion（布局重构：不改算法联动） */}
      <aside className="w-96 bg-slate-50 border-l border-slate-200 flex flex-col overflow-y-auto shrink-0 shadow-inner">
        {/* 1) 评估结果响应面板（Summary） */}
        <div className="border-b border-slate-100">
          <button
            className="w-full p-5 flex items-center justify-between gap-4 hover:bg-white/60 transition-colors"
            onClick={() => setActiveAccordion((prev) => (prev.includes('summary') ? prev.filter((k) => k !== 'summary') : [...prev, 'summary']))}
            type="button"
          >
            <div className="flex items-center justify-between gap-3 min-w-0 flex-1">
              <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2 uppercase tracking-tight truncate">
                <Grid size={16} className="text-red-500" /> 覆岩扰动综合评价
              </h2>
              <span className="text-[9px] font-mono text-slate-400 bg-white px-2 py-0.5 rounded border border-slate-200 shrink-0">系统就绪: 100%</span>
            </div>
            <ChevronDown
              size={18}
              className={`text-slate-400 transition-transform duration-300 ${activeAccordion.includes('summary') ? 'rotate-180' : ''}`}
            />
          </button>

          <div className={`overflow-hidden transition-all duration-500 ${activeAccordion.includes('summary') ? 'max-h-[calc(100vh-120px)]' : 'max-h-0'}`}>
            <div className="px-5 pb-5 space-y-6 max-h-[calc(100vh-160px)] overflow-y-auto custom-scrollbar">
              {/* 工作面：两步向导（评价点生成 → 全参插值提取） */}
              <section className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                      <MapPin size={14} className="text-red-500" /> 工作面评估点导入
                    </h3>
                    <div className="mt-1 text-[10px] text-slate-400">
                      2 步向导：先生成评价点，再全参插值提取
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">Step: {stepLength}m</div>
                </div>

                {/* Stepper */}
                <div className="grid grid-cols-2 gap-2">
                  <div className={`rounded-lg border px-3 py-2 ${generatedPoints ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] text-slate-500 font-bold">① 评价点生成</div>
                      {generatedPoints ? (
                        <span className="text-[10px] text-emerald-700 font-bold">已完成</span>
                      ) : (
                        <span className="text-[10px] text-slate-400">待执行</span>
                      )}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-400">导入工作面坐标并生成点位</div>
                  </div>
                  <div className={`rounded-lg border px-3 py-2 ${paramExtractionResult ? 'border-emerald-200 bg-emerald-50/40' : generatedPoints ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] text-slate-500 font-bold">② 参数提取</div>
                      {paramExtractionResult ? (
                        <span className="text-[10px] text-emerald-700 font-bold">已完成</span>
                      ) : generatedPoints ? (
                        <span className="text-[10px] text-blue-700 font-bold">可执行</span>
                      ) : (
                        <span className="text-[10px] text-slate-400">未就绪</span>
                      )}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-400">高精度插值：地质 + 开采全参数</div>
                  </div>
                </div>

                {/* Step 1 */}
                <div className="space-y-2">
                  <button
                    className="w-full flex items-center justify-between px-4 py-2 bg-white border border-slate-200 rounded text-xs text-slate-600 hover:border-blue-500 hover:text-blue-600 transition-all group"
                    onClick={handleWorkingFaceImportClick}
                    title="导入工作面坐标（按 4 点一组）"
                    type="button"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <MapPin size={14} className="text-slate-400 group-hover:text-blue-500" /> 导入工作面坐标
                    </span>
                    <div className="flex items-center gap-2">
                      {workingFaceData.length > 0 && (
                        <span className="text-[10px] text-slate-400">已导入 {workingFaceData.length} 点</span>
                      )}
                      <FileUp size={12} className="text-slate-300" />
                    </div>
                  </button>
                  <input
                    ref={workingFaceFileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={handleWorkingFaceFileChange}
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2">
                      <div className="text-[10px] text-slate-500 font-bold">步长 (m)</div>
                      <input
                        type="number"
                        value={stepLength}
                        onChange={(e) => setStepLength(Number(e.target.value))}
                        className="w-full bg-transparent text-sm font-bold outline-none border-b border-slate-200 focus:border-blue-500"
                      />
                    </div>
                    <button
                      className="bg-slate-900 text-white rounded border border-slate-900 text-xs font-bold hover:bg-slate-800 transition-colors flex items-center justify-center"
                      onClick={handleGeneratePoints}
                      title="生成评价点并在中间 SVG 中联动显示"
                      type="button"
                    >
                      评价点生成
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">工作面数量</div>
                    <div className="mt-1 text-xl font-mono font-bold text-slate-800">
                      {workfaceCount}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">总点数</div>
                    <div className="mt-1 text-xl font-mono font-bold text-slate-800">
                      {generatedPoints?.totalPoints ?? 0}
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <div className="text-[11px] text-slate-500 font-bold">参数提取设置</div>
                  <div className={`grid gap-2 ${workfaceCount > 0 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2">
                      <div className="text-[10px] text-slate-500 font-bold">矿井实际采高 M (m)</div>
                      {workfaceCount > 0 ? (
                        <div className="mt-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="text-[10px] text-slate-400 shrink-0">工作面</div>
                            <select
                              className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700"
                              value={activeSelectedFaceNo}
                              onChange={(e) => setActiveSelectedFaceNo(Number(e.target.value))}
                              title="选择工作面编号（No.1~No.n）"
                            >
                              {Array.from({ length: workfaceCount }, (_, i) => i + 1).map((n) => (
                                <option key={n} value={n}>{`No. ${n}`}</option>
                              ))}
                            </select>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            {Array.from({ length: workfaceCount }, (_, i) => i + 1).map((no) => (
                              <div key={`mh-${no}`} className={`rounded border px-2 py-1 ${no === activeSelectedFaceNo ? 'border-blue-200 bg-white' : 'border-slate-200 bg-transparent'}`}>
                                <div className="flex items-center justify-between">
                                  <div className="text-[10px] text-slate-400 font-bold">{`No. ${no}`}</div>
                                  {no === activeSelectedFaceNo && (
                                    <div className="text-[9px] text-blue-600 font-bold">当前</div>
                                  )}
                                </div>
                                <input
                                  type="number"
                                  value={Number.isFinite(Number(activeMineHeightByFace?.[no - 1])) ? Number(activeMineHeightByFace?.[no - 1]) : ''}
                                  onChange={(e) => {
                                    const v = Number(e.target.value);
                                    setMineActualHeightM(v);
                                    setActiveMineHeightByFace((prev) => {
                                      const arr = Array.isArray(prev) ? [...prev] : [];
                                      while (arr.length < workfaceCount) arr.push(Number.isFinite(Number(mineActualHeightM)) ? Number(mineActualHeightM) : 4.5);
                                      arr[no - 1] = v;
                                      return arr;
                                    });
                                  }}
                                  className="w-full bg-transparent text-sm font-bold outline-none border-b border-slate-200 focus:border-blue-500"
                                  title="该工作面的矿井实际采高"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <input
                          type="number"
                          value={mineActualHeightM}
                          onChange={(e) => setMineActualHeightM(Number(e.target.value))}
                          className="w-full bg-transparent text-sm font-bold outline-none border-b border-slate-200 focus:border-blue-500"
                        />
                      )}
                    </div>
                    <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2">
                      <div className="text-[10px] text-slate-500 font-bold">顶板垮落角 δ (°)</div>
                      {workfaceCount > 0 ? (
                        <div className="mt-1 grid grid-cols-2 gap-2">
                          {Array.from({ length: workfaceCount }, (_, i) => i + 1).map((no) => (
                            <div key={`delta-${no}`} className={`rounded border px-2 py-1 ${no === activeSelectedFaceNo ? 'border-blue-200 bg-white' : 'border-slate-200 bg-transparent'}`}>
                              <div className="flex items-center justify-between">
                                <div className="text-[10px] text-slate-400 font-bold">{`No. ${no}`}</div>
                                {no === activeSelectedFaceNo && (
                                  <div className="text-[9px] text-blue-600 font-bold">当前</div>
                                )}
                              </div>
                              <input
                                type="number"
                                value={Number.isFinite(Number(activeRoofAngleByFace?.[no - 1])) ? Number(activeRoofAngleByFace?.[no - 1]) : ''}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  setRoofCavingAngleDeg(v);
                                  setActiveRoofAngleByFace((prev) => {
                                    const arr = Array.isArray(prev) ? [...prev] : [];
                                    while (arr.length < workfaceCount) arr.push(Number.isFinite(Number(roofCavingAngleDeg)) ? Number(roofCavingAngleDeg) : 0);
                                    arr[no - 1] = v;
                                    return arr;
                                  });
                                }}
                                className="w-full bg-transparent text-sm font-bold outline-none border-b border-slate-200 focus:border-blue-500"
                                title="该工作面的顶板垮落角"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <input
                          type="number"
                          value={roofCavingAngleDeg}
                          onChange={(e) => setRoofCavingAngleDeg(Number(e.target.value))}
                          className="w-full bg-transparent text-sm font-bold outline-none border-b border-slate-200 focus:border-blue-500"
                        />
                      )}
                    </div>
                  </div>

                  {(() => {
                    const canGeoExtract = (drillholeData?.length >= 3)
                      && (Object.keys(drillholeLayersById ?? {}).length > 0)
                      && (boundaryData?.length >= 1)
                      && (boreholeParamSamples?.Ti?.length >= 3)
                      && (boreholeParamSamples?.Di?.length >= 3)
                      && (boreholeParamSamples?.Ei?.length >= 3)
                      && (boreholeParamSamples?.CoalThk?.length >= 3);

                    return (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          className={`w-full rounded text-xs font-bold py-2 border transition-colors ${generatedPoints ? 'bg-white border-slate-200 text-slate-700 hover:border-blue-500 hover:text-blue-600' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                          onClick={handleExtractHighPrecisionParams}
                          disabled={!generatedPoints}
                          title={generatedPoints ? '对控制点与评价点进行全参插值提取' : '请先完成“评价点生成”'}
                          type="button"
                        >
                          全参插值提取
                        </button>

                        <button
                          className={`w-full rounded text-xs font-bold py-2 border transition-colors ${canGeoExtract ? 'bg-white border-slate-200 text-slate-700 hover:border-blue-500 hover:text-blue-600' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                          onClick={handleExtractGeologyInterpolatedParams}
                          disabled={!canGeoExtract}
                          title={canGeoExtract ? '对边界点与采区坐标点进行地质插值提取（Ti/Ei/Hi/Di/Mi）' : '请先导入：采区边界坐标 + 钻孔坐标 + 钻孔分层，并选择目标煤层'}
                          type="button"
                        >
                          地质插值提取
                        </button>
                      </div>
                    );
                  })()}

                  {!generatedPoints && (
                    <div className="text-[10px] text-slate-400">提示：请先完成 Step①“评价点生成”，再执行 Step②。</div>
                  )}

                  {paramExtractionResult?.summary && (
                    <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                      <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">提取概览</div>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <div>
                          <div className="text-[10px] text-slate-400">地质评价点</div>
                          <div className="text-sm font-mono font-bold text-slate-800">{paramExtractionResult.summary.geologyEvalCount ?? 0}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-400">生成评价点</div>
                          <div className="text-sm font-mono font-bold text-slate-800">{paramExtractionResult.summary.generatedEvalCount ?? 0}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-400">总评价点</div>
                          <div className="text-sm font-mono font-bold text-slate-800">{paramExtractionResult.summary.evalPointCount ?? 0}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={`rounded text-xs font-bold py-2 border transition-colors ${paramExtractionResult ? 'bg-white border-slate-200 text-slate-700 hover:border-blue-500 hover:text-blue-600' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                      onClick={exportEvalPointsFullParamsCsv}
                      disabled={!paramExtractionResult}
                      title={paramExtractionResult ? `导出${lastParamExtractionMode === 'geo' ? '地质插值提取' : '全参插值提取'}结果（CSV）` : '请先完成“全参插值提取 / 地质插值提取”'}
                      type="button"
                    >
                      参数导出（CSV）
                    </button>
                    <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2">
                      <div className="text-[10px] text-slate-500 font-bold">已提取</div>
                      <div className="text-sm font-mono font-bold text-slate-800">{paramExtractionResult?.summary?.evalPointCount ?? 0}</div>
                    </div>
                  </div>
                </div>
              </section>

              {/* 扰动分级响应 */}
              <section className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest italic flex items-center gap-2">
                      <ListOrdered size={14} className="text-red-500" /> 分级响应详情
                    </h3>
                    {activeTab === 'surface' && measuredZoningResult?.bins?.length === 5 && (
                      <span className="text-[9px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-bold shrink-0">实测分区已启用</span>
                    )}
                  </div>
                  <div className="relative group shrink-0">
                    <Info
                      size={12}
                      className="text-slate-300 cursor-help"
                      aria-label="权重取值建议"
                    />
                    <div className="pointer-events-none absolute right-0 top-5 z-20 hidden w-72 rounded-lg border border-slate-200 bg-white p-3 text-[10px] text-slate-600 shadow-xl group-hover:block">
                      <div className="text-[10px] font-bold text-slate-700">权重取值建议</div>
                      <div className="mt-2 space-y-2">
                        <div>
                          <div className="font-bold text-slate-600">沉陷场景：</div>
                          <div>位移 0.45–0.55｜应力 0.25–0.30｜裂隙 0.20–0.25</div>
                        </div>
                        <div>
                          <div className="font-bold text-slate-600">突水场景：</div>
                          <div>裂隙 0.55–0.60｜应力 0.25–0.30｜位移 0.15–0.20</div>
                        </div>
                        <div>
                          <div className="font-bold text-slate-600">上行开采：</div>
                          <div>应力 0.40–0.45｜裂隙 0.30–0.35｜位移 0.20–0.25</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ODI 计算入口 */}
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2">
                      <div className="text-[10px] text-slate-500 font-bold">位移权重</div>
                      <input
                        type="number"
                        step="0.01"
                        value={scenarioWeights.wd}
                        onChange={(e) => setScenarioWeights((p) => ({ ...p, wd: Number(e.target.value) }))}
                        className="w-full bg-transparent text-sm font-bold outline-none border-b border-slate-200 focus:border-blue-500"
                      />
                    </div>
                    <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2">
                      <div className="text-[10px] text-slate-500 font-bold">力学权重</div>
                      <input
                        type="number"
                        step="0.01"
                        value={scenarioWeights.wo}
                        onChange={(e) => setScenarioWeights((p) => ({ ...p, wo: Number(e.target.value) }))}
                        className="w-full bg-transparent text-sm font-bold outline-none border-b border-slate-200 focus:border-blue-500"
                      />
                    </div>
                    <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2">
                      <div className="text-[10px] text-slate-500 font-bold">水力权重</div>
                      <input
                        type="number"
                        step="0.01"
                        value={scenarioWeights.wf}
                        onChange={(e) => setScenarioWeights((p) => ({ ...p, wf: Number(e.target.value) }))}
                        className="w-full bg-transparent text-sm font-bold outline-none border-b border-slate-200 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <button
                      className={`w-full rounded text-xs font-bold py-2 border transition-colors ${paramExtractionResult?.points?.length ? 'bg-white border-slate-200 text-slate-700 hover:border-blue-500 hover:text-blue-600' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                      onClick={handleComputeOdi}
                      disabled={!paramExtractionResult?.points?.length}
                      title={paramExtractionResult?.points?.length ? `基于${lastParamExtractionMode === 'geo' ? '地质插值提取' : '全参插值提取'}结果计算 ODI 并生成等值分布` : '请先完成“全参插值提取 / 地质插值提取”'}
                      type="button"
                    >
                      综合扰动系数计算（ODI）
                    </button>
                  </div>

                  {(() => {
                    const sum = Number(scenarioWeights.wd) + Number(scenarioWeights.wo) + Number(scenarioWeights.wf);
                    if (!Number.isFinite(sum)) return null;
                    if (Math.abs(sum - 1) <= 1e-6) return null;
                    return (
                      <div className="text-[10px] text-amber-600">
                        约束：wd + wsigma + wf 必须等于 1（当前：{sum.toFixed(3)}）
                      </div>
                    );
                  })()}
                </div>

                <div className="space-y-2">
                  {(() => {
                    const levelsMeta = [
                      { lv: 'I 级', msg: '稳定区', color: 'border-l-emerald-500 bg-emerald-50/40', text: 'text-emerald-700', icon: 'text-emerald-500', pulse: false },
                      { lv: 'II 级', msg: '轻微扰动区', color: 'border-l-lime-500 bg-lime-50/40', text: 'text-lime-700', icon: 'text-lime-500', pulse: false },
                      { lv: 'III 级', msg: '中等扰动区', color: 'border-l-yellow-500 bg-yellow-50/40', text: 'text-yellow-700', icon: 'text-yellow-500', pulse: false },
                      { lv: 'IV 级', msg: '较强扰动区', color: 'border-l-orange-500 bg-orange-50/40', text: 'text-orange-700', icon: 'text-orange-500', pulse: true },
                      { lv: 'V 级', msg: '强扰动核心区', color: 'border-l-red-500 bg-red-50/40', text: 'text-red-700', icon: 'text-red-500', pulse: true },
                    ];

                    const pts = (odiResult?.points ?? []).filter((p) => Number.isFinite(p.odiNorm));
                    const total = pts.length;

                    return levelsMeta.map((meta, idx) => {
                      const r = odiLevelRanges?.[idx] ?? { lo: 0, hi: 1, includeHi: idx === 4 };
                      const lo = Number(r.lo);
                      const hi = Number(r.hi);
                      const includeHi = Boolean(r.includeHi);
                      const bin = pts.filter((p) => {
                        const v = p.odiNorm;
                        if (!Number.isFinite(v)) return false;
                        if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return false;
                        if (includeHi) return v >= lo && v <= hi;
                        return v >= lo && v < hi;
                      });
                      const cnt = bin.length;
                      const mean = cnt ? (bin.reduce((s, p) => s + p.odiNorm, 0) / cnt) : null;
                      const valLabel = Number.isFinite(lo) && Number.isFinite(hi) ? `${lo.toFixed(3)}-${hi.toFixed(3)}` : '--';
                      const active = odiLevelFilter === idx;

                      return (
                        <div
                          key={meta.lv}
                          className={`p-3 border-l-4 rounded transition-all hover:translate-x-1 ${meta.color} flex justify-between items-center group cursor-pointer shadow-sm ${
                            active ? 'ring-2 ring-slate-900/15' : ''
                          }`}
                          onClick={() => setOdiLevelFilter((p) => (p === idx ? null : idx))}
                          title={active ? '已筛选该等级（点击取消）' : '点击筛选该等级'}
                        >
                          <div>
                            <div className={`text-xs font-bold ${meta.text}`}>{meta.lv} - {meta.msg}</div>
                            <div className="text-[10px] text-slate-500 mt-1 font-mono uppercase tracking-tighter italic">
                              ODI 区间: {valLabel}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <AlertTriangle size={14} className={`${meta.icon} ${meta.pulse ? 'animate-pulse' : ''}`} />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* 基于实测约束分区 */}
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">基于实测约束分区</div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {measuredConstraintData?.length ? `实测点: ${measuredConstraintData.length}` : '未导入'}
                    </div>
                  </div>

                  {activeTab === 'surface' ? (
                    <div className="text-[10px] text-slate-500 leading-4">
                      导入实测地表下沉点后，可按实测值分级并反推对应 ODI 分区，联动本模块 5 个等级区间。
                    </div>
                  ) : activeTab === 'aquifer' ? (
                    <div className="text-[10px] text-slate-500 leading-4">
                      导入实测破坏高度点后，可按实测值分级并反推对应 ODI 分区，联动本模块 5 个等级区间。
                    </div>
                  ) : (
                    <div className="text-[10px] text-slate-500 leading-4">
                      该场景的实测约束分区逻辑后续再优化（界面功能保持一致）。
                    </div>
                  )}

                  {(activeTab === 'surface' || activeTab === 'aquifer') &&
                    measuredZoningResult?.scenario === activeTab &&
                    measuredZoningResult?.bins?.length === 5 && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                      <div className="text-[10px] text-emerald-800 font-bold">分区已生成</div>
                      <div className="text-[10px] text-emerald-700 mt-1">
                        有效提取 ODI 的实测点：{measuredZoningResult.validOdiCount} / 导入：{measuredZoningResult.importedCount}
                      </div>
                    </div>
                  )}

                  {(() => {
                    const canCompute = (activeTab === 'surface' || activeTab === 'aquifer')
                      && measuredConstraintData?.length > 0
                      && !!odiFieldPack?.field;
                    const title = (activeTab !== 'surface' && activeTab !== 'aquifer')
                      ? '该场景暂未实现'
                      : !measuredConstraintData?.length
                        ? '请先导入实测约束数据'
                        : !odiFieldPack?.field
                          ? '请先完成 ODI 计算并生成 ODI 分布场'
                          : '按实测值分级并生成 ODI 分区';

                    const canComputeError = (activeTab === 'surface' || activeTab === 'aquifer')
                      && measuredConstraintLines?.length > 0
                      && !!odiFieldPack?.field;
                    const canExportError = canComputeError && !!errorAnalysisByLineId?.[selectedMeasuredLineId]?.data?.length;
                    const errorTitle = (activeTab !== 'surface' && activeTab !== 'aquifer')
                      ? '该场景暂未实现'
                      : !measuredConstraintLines?.length
                        ? '请先导入实测约束数据（多文件=多测线）'
                        : !odiFieldPack?.field
                          ? '请先完成 ODI 计算并生成 ODI 分布场'
                          : '计算误差（实测归一化 vs ODI再归一化）';

                    return (
                      <div className="space-y-2">
                        <button
                          className={`w-full rounded text-xs font-bold py-2 border transition-colors ${canCompute ? 'bg-white border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-600' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                          onClick={handleComputeMeasuredZoning}
                          disabled={!canCompute}
                          title={title}
                          type="button"
                        >
                          {(measuredZoningResult?.scenario === activeTab && measuredZoningResult?.bins?.length === 5)
                            ? '重新计算实测分区'
                            : '启动实测约束分区'}
                        </button>

                        <div className="flex items-center gap-2">
                          <button
                            className={`flex-1 rounded text-xs font-bold py-2 border transition-colors ${canComputeError ? 'bg-white border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-600' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                            onClick={handleComputeErrorAnalysis}
                            disabled={!canComputeError}
                            title={errorTitle}
                            type="button"
                          >
                            计算误差
                          </button>

                          <div className="relative flex-1">
                            <button
                              ref={errorExportButtonRef}
                              className={`w-full rounded text-xs font-bold py-2 border transition-colors ${canExportError ? 'bg-white border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-600' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                              onClick={() => {
                                if (!canExportError) return;
                                setShowErrorExportMenu((v) => !v);
                              }}
                              disabled={!canExportError}
                              title={canExportError ? '选择导出类型：PNG 或 CSV' : (canComputeError ? '请先计算误差' : errorTitle)}
                              type="button"
                            >
                              误差数据导出
                            </button>

                            {showErrorExportMenu && canExportError && (
                              <div
                                ref={errorExportMenuRef}
                                className="absolute right-0 mt-2 w-40 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-50"
                              >
                                <button
                                  className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                                  onClick={() => {
                                    setShowErrorExportMenu(false);
                                    handleExportErrorAnalysis('png');
                                  }}
                                  type="button"
                                >
                                  导出 PNG
                                </button>
                                <button
                                  className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                                  onClick={() => {
                                    setShowErrorExportMenu(false);
                                    handleExportErrorAnalysis('csv');
                                  }}
                                  type="button"
                                >
                                  导出 CSV
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </section>

              {/* 底部系统自检信息 */}
              <div className="pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between text-[9px] text-slate-400 font-mono tracking-widest">
                  <span>内核处理: 正常</span>
                  <span>数据版本: 2024.12.Q4</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2) 智能规划建议（Intelligent Planning） */}
        <div className="border-b border-slate-100">
          <button
            className="w-full p-5 flex items-center justify-between gap-4 hover:bg-white/60 transition-colors"
            onClick={() => setActiveAccordion((prev) => (prev.includes('planning') ? prev.filter((k) => k !== 'planning') : [...prev, 'planning']))}
            type="button"
          >
            <div className="flex items-center gap-3 min-w-0">
              <BrainCircuit size={18} className="text-blue-500" />
              <div className="min-w-0 text-left">
                <div className="text-sm font-bold text-slate-700 truncate">采区参数编辑器</div>
                <div className="text-[10px] text-slate-400 truncate">采区智能规划参数输入</div>
              </div>
            </div>
            <ChevronDown
              size={18}
              className={`text-slate-400 transition-transform duration-300 ${activeAccordion.includes('planning') ? 'rotate-180' : ''}`}
            />
          </button>

          <div className={`overflow-hidden transition-all duration-500 ${activeAccordion.includes('planning') ? 'max-h-[calc(100vh-120px)]' : 'max-h-0'}`}>
            <div className="p-5 max-h-[calc(100vh-160px)] overflow-y-auto custom-scrollbar">
              <div className="space-y-5">

                {/* B2: 开采方式 */}
                <div className="bg-white rounded-[2rem] p-5 border border-slate-100 shadow-sm space-y-4">
                  <div className="flex items-center gap-2">
                    <DraftingCompass size={14} className="text-blue-500" />
                    <span className="text-[13px] font-black text-slate-700 uppercase tracking-wider">资源赋存与开采方式</span>
                  </div>

                  {/* 0) 煤层平均厚度 + 煤的容重（从“回采规模与生产效率”迁移至此，置顶） */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[12px] font-black text-slate-400">煤层平均厚度（m）</label>
                      <input
                        type="number"
                        value={planningParams.seamThickness}
                        onChange={(e) => setPlanningParams((p) => ({ ...p, seamThickness: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[12px] font-black text-slate-400">煤的容重（t/m³）</label>
                      <input
                        type="number"
                        value={planningParams.coalDensity}
                        onChange={(e) => setPlanningParams((p) => ({ ...p, coalDensity: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                  </div>

                  <div className="h-px bg-slate-100"></div>

                  {/* 1) 大巷空间位置 */}
                  <div className="space-y-2">
                    <div className="text-[12px] font-black text-slate-400">工作面布置方向</div>
                    <select
                      className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      value={planningParams.roadwayOrientation}
                      onChange={(e) => setPlanningParams((p) => ({ ...p, roadwayOrientation: String(e.target.value) }))}
                    >
                      <option value="x">沿x轴横向布置</option>
                      <option value="y">沿y轴纵向布置</option>
                    </select>
                  </div>

                  <div className="h-px bg-slate-100"></div>

                  {/* 2) 采煤方法选择 */}
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <label className="text-[12px] font-black text-slate-400">采煤方法</label>
                      <select
                        className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                        value={planningParams.miningMethod}
                        onChange={(e) => {
                          const next = String(e.target.value);
                          setPlanningParams((p) => {
                            const n = { ...p, miningMethod: next };
                            if (next === '综采') {
                              n.coalPillarMin = '20';
                              n.coalPillarMax = '30';
                              n.coalPillarTarget = '25';
                              n.boundaryPillarMin = '30';
                              n.boundaryPillarMax = '50';
                              n.boundaryPillarTarget = '40';
                            } else {
                              n.coalPillarMin = '30';
                              n.coalPillarMax = '50';
                              n.coalPillarTarget = '40';
                              n.boundaryPillarMin = '50';
                              n.boundaryPillarMax = '80';
                              n.boundaryPillarTarget = '65';
                            }
                            return n;
                          });
                        }}
                      >
                        <option value="综采">综采</option>
                        <option value="综放">综放</option>
                      </select>
                    </div>

                    <div className="h-px bg-slate-100"></div>

                    {/* 3) 煤柱留设约束（合并到本板块底部） */}
                    <div className="space-y-3">
                      <div className="text-[12px] font-black text-slate-400">煤柱留设约束</div>

                      <div className="space-y-2">
                        <label className="text-[12px] font-black text-slate-400">区段煤柱留设范围（m）</label>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-2">
                            <label className="text-[12px] font-black text-slate-400">最小值</label>
                            <input
                              type="number"
                              value={planningParams.coalPillarMin}
                              onChange={(e) => setPlanningParams((p) => ({ ...p, coalPillarMin: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                              placeholder="Min"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[12px] font-black text-slate-400">最大值</label>
                            <input
                              type="number"
                              value={planningParams.coalPillarMax}
                              onChange={(e) => setPlanningParams((p) => ({ ...p, coalPillarMax: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                              placeholder="Max"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[12px] font-black text-slate-400">确定值</label>
                            <input
                              type="number"
                              value={planningParams.coalPillarTarget}
                              onChange={(e) => setPlanningParams((p) => ({ ...p, coalPillarTarget: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                              placeholder="Target"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[12px] font-black text-slate-400">采区边界煤柱留设范围（m）</label>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-2">
                            <label className="text-[12px] font-black text-slate-400">最小值</label>
                            <input
                              type="number"
                              value={planningParams.boundaryPillarMin}
                              onChange={(e) => setPlanningParams((p) => ({ ...p, boundaryPillarMin: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                              placeholder="Min"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[12px] font-black text-slate-400">最大值</label>
                            <input
                              type="number"
                              value={planningParams.boundaryPillarMax}
                              onChange={(e) => setPlanningParams((p) => ({ ...p, boundaryPillarMax: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                              placeholder="Max"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[12px] font-black text-slate-400">确定值</label>
                            <input
                              type="number"
                              value={planningParams.boundaryPillarTarget}
                              onChange={(e) => setPlanningParams((p) => ({ ...p, boundaryPillarTarget: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                              placeholder="Target"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* C: 工作面几何 */}
                <div className="bg-white rounded-[2rem] p-5 border border-slate-100 shadow-sm space-y-4">
                  <div className="flex items-center gap-2">
                    <Maximize2 size={14} className="text-blue-500" />
                    <span className="text-[13px] font-black text-slate-700 uppercase tracking-wider">工作面几何参数</span>
                  </div>

                  {/* 工作面个数：滑块 + 输入编辑框 */}
                  {(() => {
                    const nMinRaw = Number(planningParams.faceCountSuggestedMin);
                    const nMaxRaw = Number(planningParams.faceCountSuggestedMax);
                    const hasRange = Number.isFinite(nMinRaw) && Number.isFinite(nMaxRaw) && nMaxRaw >= nMinRaw && nMaxRaw >= 1;

                    const effHasRange = Boolean(
                      planningOptMode === 'efficiency'
                      && planningEfficiencyResult?.ok
                      && Array.isArray(planningEfficiencyResult?.nRange?.nValues)
                      && planningEfficiencyResult.nRange.nValues.length > 0
                    );
                    const effNValues = effHasRange
                      ? (planningEfficiencyResult.nRange.nValues ?? [])
                        .map((x) => Math.round(Number(x)))
                        .filter((x) => Number.isFinite(x) && x >= 1 && x <= 20)
                      : [];
                    const effMinBound = effHasRange ? Math.max(1, Math.min(20, Math.round(Number(planningEfficiencyResult.nRange.nMin)))) : null;
                    const effMaxBound = effHasRange ? Math.max(1, Math.min(20, Math.round(Number(planningEfficiencyResult.nRange.nMax)))) : null;

                    const minBound0 = effHasRange ? effMinBound : (hasRange ? Math.max(1, Math.round(nMinRaw)) : 1);
                    const maxBound0 = effHasRange ? effMaxBound : (hasRange ? Math.max(1, Math.round(nMaxRaw)) : 20);
                    const minBound = Math.min(20, Math.max(1, Number(minBound0) || 1));
                    const maxBound = Math.max(minBound, Math.min(20, Math.max(1, Number(maxBound0) || 20)));

                    const clampN = (v) => {
                      const n = Math.round(Number(v));
                      if (!Number.isFinite(n)) return minBound;
                      return Math.min(maxBound, Math.max(minBound, n));
                    };

                    const nSel = planningParams.faceCountSelected;
                    const nSelSafe = (() => {
                      if (String(nSel ?? '').trim() !== '') return clampN(nSel);
                      if (effHasRange || hasRange) return clampN((minBound + maxBound) / 2);
                      return minBound;
                    })();

                    const applyNChange = (nextRaw) => {
                      const v = clampN(nextRaw);
                      setPlanningParams((p) => ({ ...p, faceCountSelected: String(v) }));

                      if (!effHasRange) {
                        applyPlannedFaceCountSelection(v);
                        return;
                      }

                      // efficiency：若 N 可行则直接切换候选；否则走预览（1B/2A/3B/4A）
                      if (effNValues.includes(v)) {
                        selectEfficiencyByN(v);
                        return;
                      }
                      requestEfficiencyPreview(v);
                    };

                    return (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[12px] font-black text-slate-400">工作面个数 N（可调）</label>
                          <span className="text-[10px] text-slate-400 font-bold">范围：{minBound}~{maxBound}，当前：{nSelSafe}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min={minBound}
                            max={maxBound}
                            step={1}
                            value={nSelSafe}
                            onChange={(e) => {
                              applyNChange(e.target.value);
                            }}
                            className="flex-1"
                          />
                          <input
                            type="number"
                            min={minBound}
                            max={maxBound}
                            step={1}
                            value={nSelSafe}
                            onChange={(e) => {
                              applyNChange(e.target.value);
                            }}
                            className="w-20 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            title={effHasRange ? '工程效率模式：可行N直接切换；不可行N触发预览（不重算最优）' : '调节后会自动用可行解集重绘规划工作面'}
                          />
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {effHasRange
                            ? `工程效率模式：可行N直接切换（不重算）；不可行N将生成预览布局（非最优）。可行 N：${effNValues.join(' / ')}`
                            : (hasRange ? '默认方案：N 取可行范围的均值；调节后将自动选取最接近的可行 N 并重绘。' : '提示：尚未生成可行范围时，提供默认范围 1~20 供预设。')}
                        </div>

                        {effHasRange && (
                          <div className="text-[10px] mt-1">
                            {planningEfficiencyPreviewBusy && (
                              <span className="text-slate-400 font-mono">预览计算中…</span>
                            )}
                            {!planningEfficiencyPreviewBusy
                              && planningEfficiencyPreview?.preview
                              && Number(planningEfficiencyPreview?.targetN) === Number(nSelSafe)
                              && (
                                planningEfficiencyPreview?.ok
                                  ? (
                                    <span className="text-slate-500">
                                      预览：N={planningEfficiencyPreview?.candidate?.N ?? nSelSafe}，B={Number(planningEfficiencyPreview?.candidate?.B ?? 0).toFixed(1)}，w_s={Number(planningEfficiencyPreview?.candidate?.ws ?? 0).toFixed(1)}，覆盖率={Number(planningEfficiencyPreview?.candidate?.coverageRatio ?? 0).toFixed(4)}（非最优；点击“工程效率最优”可重算）
                                    </span>
                                  )
                                  : (
                                    <span className="text-amber-700">
                                      {String(planningEfficiencyPreview?.message || '该N无法布置，图形保持当前方案')}
                                    </span>
                                  )
                              )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[12px] font-black text-slate-400">工作面宽度范围（m）</label>
                      <span className="text-[10px] text-slate-400 font-bold">
                        工作面个数：{(() => {
                          const a = String(planningParams.faceCountSuggestedMin ?? '').trim();
                          const b = String(planningParams.faceCountSuggestedMax ?? '').trim();
                          if (a && b && a !== b) return `${a}~${b}`;
                          if (a || b) return `${a || b}`;
                          return String(workfaceCount ?? 0);
                        })()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-[12px] font-black text-slate-400">最小值</label>
                        <input
                          type="number"
                          value={planningParams.faceWidthMin}
                          onChange={(e) => setPlanningParams((p) => ({ ...p, faceWidthMin: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                          placeholder="Min"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[12px] font-black text-slate-400">最大值</label>
                        <input
                          type="number"
                          value={planningParams.faceWidthMax}
                          onChange={(e) => setPlanningParams((p) => ({ ...p, faceWidthMax: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                          placeholder="Max"
                        />
                      </div>
                    </div>

                    {(() => {
                      const fw = getFaceWidthRange();
                      const rawMin = (fw.rawMin == null ? '' : String(fw.rawMin));
                      const rawMax = (fw.rawMax == null ? '' : String(fw.rawMax));
                      const rawMinDisp = rawMin.trim() === '' ? '未输入' : rawMin;
                      const rawMaxDisp = rawMax.trim() === '' ? '未输入' : rawMax;
                      const warn = Array.isArray(fw.warnings) ? fw.warnings.filter(Boolean) : [];
                      return (
                        <div className="space-y-1">
                          <div className="text-[10px] text-slate-400 font-bold">
                            输入：{rawMinDisp} ~ {rawMaxDisp}；规范化：{Number(fw.min).toFixed(1)} ~ {Number(fw.max).toFixed(1)}（默认：{fw.defMin} ~ {fw.defMax}）
                          </div>
                          {warn.length > 0 && (
                            <div className="text-[10px] text-amber-700 font-black">
                              {warn.join('；')}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="space-y-2">
                    <label className="text-[12px] font-black text-slate-400">工作面推进长度范围（m）</label>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-[12px] font-black text-slate-400">最小值</label>
                        <input
                          type="number"
                          value={planningParams.faceAdvanceMin}
                          onChange={(e) => setPlanningParams((p) => ({ ...p, faceAdvanceMin: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                          placeholder="Min"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[12px] font-black text-slate-400">最大值</label>
                        <input
                          type="number"
                          value={planningParams.faceAdvanceMax}
                          onChange={(e) => setPlanningParams((p) => ({ ...p, faceAdvanceMax: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                          placeholder="Max"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-[2rem] font-bold text-sm shadow-md shadow-blue-200 transition-all active:scale-[0.99] flex items-center justify-center gap-2"
                  onClick={handleStartIntelligentPlanning}
                  type="button"
                >
                  <Zap size={18} className="text-white/90" /> 启动智能采区规划
                </button>

                {DEBUG_PANEL && (
                  <PlanningDebugPanel snapshot={planningDebugSnapshot} />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 3) 采掘接续计划（Succession Plan） */}
        <div className="border-b border-slate-100">
          <button
            className="w-full p-5 flex items-center justify-between gap-4 hover:bg-white/60 transition-colors"
            onClick={() => setActiveAccordion((prev) => (prev.includes('succession') ? prev.filter((k) => k !== 'succession') : [...prev, 'succession']))}
            type="button"
          >
            <div className="flex items-center gap-3 min-w-0">
              <CalendarClock size={18} className="text-purple-500" />
              <div className="min-w-0 text-left">
                <div className="text-sm font-bold text-slate-700 truncate">采掘接续计划</div>
                <div className="text-[10px] text-slate-400 truncate">全周期进度监测</div>
              </div>
            </div>
            <ChevronDown
              size={18}
              className={`text-slate-400 transition-transform duration-300 ${activeAccordion.includes('succession') ? 'rotate-180' : ''}`}
            />
          </button>

          <div className={`overflow-hidden transition-all duration-500 ${activeAccordion.includes('succession') ? 'max-h-[calc(100vh-120px)]' : 'max-h-0'}`}>
            <div className="p-5 max-h-[calc(100vh-160px)] overflow-y-auto custom-scrollbar">
              <div className="space-y-5">

                {/* 从“采区参数编辑器”迁移：生产规模配置 */}
                <div className="bg-slate-50 p-5 rounded-[2rem] border border-slate-100 transition-all hover:bg-white hover:shadow-md">
                  <div className="flex items-center gap-2 mb-4">
                    <ClipboardCheck size={14} className="text-blue-600" />
                    <span className="text-[13px] font-black text-slate-700 uppercase tracking-wider">生产规模配置</span>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[12px] font-black text-slate-400 uppercase">矿井生产能力（万吨/年）</label>
                    <input
                      type="number"
                      value={planningParams.mineCapacity}
                      onChange={(e) => setPlanningParams((p) => ({ ...p, mineCapacity: e.target.value }))}
                      className="w-full bg-white border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm transition-all"
                    />
                  </div>
                </div>

                {/* 从“采区参数编辑器”迁移：回采规模与生产效率 */}
                <div className="bg-white rounded-[2rem] p-5 border border-slate-100 shadow-sm space-y-4">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={14} className="text-blue-500" />
                    <span className="text-[13px] font-black text-slate-700 uppercase tracking-wider">回采规模与生产效率</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[12px] font-black text-slate-400">煤层平均厚度（m）</label>
                      <input
                        type="number"
                        value={planningParams.seamThickness}
                        onChange={(e) => setPlanningParams((p) => ({ ...p, seamThickness: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[12px] font-black text-slate-400">煤的容重（t/m³）</label>
                      <input
                        type="number"
                        value={planningParams.coalDensity}
                        onChange={(e) => setPlanningParams((p) => ({ ...p, coalDensity: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[12px] font-black text-slate-400">采出率（0~1）</label>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-[12px] font-black text-slate-400">最小值</label>
                        <input
                          type="number"
                          value={planningParams.recoveryRateMin}
                          onChange={(e) => setPlanningParams((p) => ({ ...p, recoveryRateMin: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                          placeholder="Min"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[12px] font-black text-slate-400">最大值</label>
                        <input
                          type="number"
                          value={planningParams.recoveryRateMax}
                          onChange={(e) => setPlanningParams((p) => ({ ...p, recoveryRateMax: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                          placeholder="Max"
                        />
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>

        {/* 4) 工程经济分析（Economic Analysis） */}
        <div className="border-b border-slate-100">
          <button
            className="w-full p-5 flex items-center justify-between gap-4 hover:bg-white/60 transition-colors"
            onClick={() => setActiveAccordion((prev) => (prev.includes('economics') ? prev.filter((k) => k !== 'economics') : [...prev, 'economics']))}
            type="button"
          >
            <div className="flex items-center gap-3 min-w-0">
              <CircleDollarSign size={18} className="text-amber-500" />
              <div className="min-w-0 text-left">
                <div className="text-sm font-bold text-slate-700 truncate">工程经济分析</div>
                <div className="text-[10px] text-slate-400 truncate">产值与成本预估</div>
              </div>
            </div>
            <ChevronDown
              size={18}
              className={`text-slate-400 transition-transform duration-300 ${activeAccordion.includes('economics') ? 'rotate-180' : ''}`}
            />
          </button>

          <div className={`overflow-hidden transition-all duration-500 ${activeAccordion.includes('economics') ? 'max-h-[500px]' : 'max-h-0'}`}>
            <div className="px-5 pb-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="text-[10px] text-emerald-700 font-bold uppercase tracking-widest">预估净利润</div>
                  <div className="mt-1 text-2xl font-mono font-bold text-emerald-800">¥ 1280.5</div>
                  <div className="mt-1 text-[10px] text-emerald-700/70">单位：万元（示意）</div>
                </div>
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <div className="text-[10px] text-blue-700 font-bold uppercase tracking-widest">投资回报率</div>
                  <div className="mt-1 text-2xl font-mono font-bold text-blue-800">18.6%</div>
                  <div className="mt-1 text-[10px] text-blue-700/70">内部估算（示意）</div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-[11px] text-slate-500 font-bold mb-2">明细</div>
                <div className="space-y-2">
                  {[
                    { name: '资源残余成本', value: '¥ 120.0' },
                    { name: '环境治理金', value: '¥ 36.5' },
                    { name: '设备折旧', value: '¥ 88.2' },
                  ].map((row) => (
                    <div key={row.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 text-slate-600">
                        <CircleDollarSign size={14} className="text-amber-400" />
                        <span>{row.name}</span>
                      </div>
                      <div className="font-mono text-slate-800">{row.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};

export default App;
