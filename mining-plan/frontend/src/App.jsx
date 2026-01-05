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

const App = () => {
  // 状态管理：场景切换、采高、步长、富裕系数及权重
  const [activeTab, setActiveTab] = useState('surface'); 
  const [mainViewMode, setMainViewMode] = useState('odi'); // 'odi' | 'geology'
  const [miningHeight, setMiningHeight] = useState(4.5);
  const [stepLength, setStepLength] = useState(25);
  const [richFactor, setRichFactor] = useState(1.1);
  const [scenarioWeights, setScenarioWeights] = useState({ wd: 0.45, wo: 0.30, wf: 0.25 });
  const [showMainMap, setShowMainMap] = useState(true);
  const [showErrorAnalysis, setShowErrorAnalysis] = useState(true);
  const [showMeasuredMapping, setShowMeasuredMapping] = useState(true);
  const [activeAccordion, setActiveAccordion] = useState(['summary']);
  const [boundaryData, setBoundaryData] = useState([]);
  const [drillholeData, setDrillholeData] = useState([]);
  const [drillholeLayersById, setDrillholeLayersById] = useState({});
  const [workingFaceData, setWorkingFaceData] = useState([]);
  const [generatedPoints, setGeneratedPoints] = useState(null);
  // 工作面：高精度参数提取（向导 Step2）
  const [mineActualHeightM, setMineActualHeightM] = useState(4.5);
  const [roofCavingAngleDeg, setRoofCavingAngleDeg] = useState(0);
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

  // 实测约束数据（分场景独立存储）：当前先实现“地表下沉场景”的分区逻辑
  const [measuredConstraintData, setMeasuredConstraintData] = useState([]);
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

  const [isMainMapFullscreen, setIsMainMapFullscreen] = useState(false);
  const [showMainMapExportMenu, setShowMainMapExportMenu] = useState(false);

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
        roofCavingAngleDeg: 0,
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
        showBoundaryLabels: false,
        showDrillholeLabels: false,
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
        measuredZoningResult: null,
      },
      aquifer: {
        boundaryData: [],
        drillholeData: [],
        drillholeLayersById: {},
        workingFaceData: [],
        generatedPoints: null,
        mineActualHeightM: 4.5,
        roofCavingAngleDeg: 0,
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
        showBoundaryLabels: false,
        showDrillholeLabels: false,
        miningHeight: 4.5,
        stepLength: 25,
        richFactor: 1.1,
        scenarioWeights: { wd: 0.6, wo: 0.25, wf: 0.15 },
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
        measuredZoningResult: null,
      },
      upward: {
        boundaryData: [],
        drillholeData: [],
        drillholeLayersById: {},
        workingFaceData: [],
        generatedPoints: null,
        mineActualHeightM: 4.5,
        roofCavingAngleDeg: 0,
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
        showBoundaryLabels: false,
        showDrillholeLabels: false,
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
        measuredZoningResult: null,
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
    roofCavingAngleDeg,
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
    showBoundaryLabels,
    showDrillholeLabels,
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
    measuredZoningResult: cloneJson(measuredZoningResult),
  });

  const applyScenarioParams = (p) => {
    if (!p) return;
    setBoundaryData(p.boundaryData ?? []);
    setDrillholeData(p.drillholeData ?? []);
    setDrillholeLayersById(p.drillholeLayersById ?? {});
    setWorkingFaceData(p.workingFaceData ?? []);
    setGeneratedPoints(p.generatedPoints ?? null);
    setMineActualHeightM(Number.isFinite(Number(p.mineActualHeightM)) ? Number(p.mineActualHeightM) : 4.5);
    setRoofCavingAngleDeg(Number.isFinite(Number(p.roofCavingAngleDeg)) ? Number(p.roofCavingAngleDeg) : 0);
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
    setShowBoundaryLabels(Boolean(p.showBoundaryLabels));
    setShowDrillholeLabels(Boolean(p.showDrillholeLabels));
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
    setMeasuredZoningResultTracked(p.measuredZoningResult ?? null);
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

  // 全局：清空所有 / 撤回 / 前进一步（重做）
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
    const clearedScenarioParamsById = {
      surface: cloneJson(scenarioDefaultsById.surface),
      aquifer: cloneJson(scenarioDefaultsById.aquifer),
      upward: cloneJson(scenarioDefaultsById.upward),
    };
    const nextSnap = {
      activeTab: 'surface',
      mainViewMode: 'odi',
      showMainMap: true,
      showErrorAnalysis: true,
      scenarioParamsById: clearedScenarioParamsById,
    };
    pushHistoryFromCurrentTo(nextSnap);
    applyAppSnapshot(nextSnap);
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
    boundaryData,
    drillholeData,
    drillholeLayersById,
    selectedCoal,
    showBoundaryLabels,
    showDrillholeLabels,
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
    scenarioParamsById,
  ]);

  // 模拟误差分析数据
  const errorData = [
    { id: '测点1', odi: 0.12, measured: 0.85, error: 0.05 },
    { id: '测点2', odi: 0.35, measured: 1.25, error: 0.08 },
    { id: '测点3', odi: 0.68, measured: 2.90, error: -0.12 },
    { id: '测点4', odi: 0.82, measured: 4.10, error: 0.02 },
    { id: '测点5', odi: 0.91, measured: 4.80, error: 0.15 },
  ];

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
    // 期望格式：测点ID，坐标x，坐标y，实测地表下沉/m
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
      rows.push({ id, x, y, measured });
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

  const computeMeasuredZoningSurface = (odiFieldPackForZoning, measuredConstraintRows, epsGap = 1e-3) => {
    if (!odiFieldPackForZoning?.field) {
      return { ok: false, message: '请先完成 ODI 计算并生成 ODI 分布场。' };
    }
    const rowsIn = Array.isArray(measuredConstraintRows) ? measuredConstraintRows : [];
    if (!rowsIn.length) {
      return { ok: false, message: '请先导入“实测约束数据”。' };
    }

    // A) 实测值按范围均分为 5 段（等值分段），生成边界
    const measuredAll = rowsIn.map((r) => Number(r?.measured)).filter(Number.isFinite);
    if (measuredAll.length < 5) {
      return { ok: false, message: '实测点数量过少（至少需要 5 个）。' };
    }
    const measuredMinAll = Math.min(...measuredAll);
    const measuredMaxAll = Math.max(...measuredAll);
    const measuredEdges = buildEqualValueBins5(measuredMinAll, measuredMaxAll);
    if (!measuredEdges) {
      return { ok: false, message: '实测值范围过小或无效，无法将实测值均分为 5 段。' };
    }

    // B) 在每个实测点位置提取 ODI，并按实测边界赋予等级 G
    const sampled = rowsIn
      .map((r) => {
        const x = Number(r?.x);
        const y = Number(r?.y);
        const measured = Number(r?.measured);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(measured)) return null;
        const odi = sampleFieldAtWorldXY(odiFieldPackForZoning, x, y);
        const G = assignGradeByEdges5(measured, measuredEdges);
        return {
          id: String(r?.id ?? '').trim(),
          x,
          y,
          measured,
          odi,
          G,
        };
      })
      .filter(Boolean);

    const valid = sampled.filter((r) => Number.isFinite(r.odi) && Number.isFinite(r.G) && r.G >= 1 && r.G <= 5);
    if (valid.length < 5) {
      return {
        ok: false,
        message: '实测点可用于提取 ODI 的数量不足（需要至少 5 个有效点）。\n提示：请检查实测点是否落在 ODI 评价范围内。',
      };
    }

    // C) 阈值反推（目标：min sum (Ghat-G)^2，约束：严格递增间隔 epsGap）
    const opt = computeOptimalOdiThresholdsDP(valid, epsGap);
    if (!opt?.T || opt.T.length !== 4) {
      return { ok: false, message: '阈值反推失败：请检查数据覆盖范围或增加实测点数量。' };
    }
    const [T1, T2, T3, T4] = opt.T;

    const measuredStats = Array.from({ length: 5 }, (_, i) => ({
      measuredMin: measuredEdges[i],
      measuredMax: measuredEdges[i + 1],
      measuredCount: valid.filter((r) => r.G === i + 1).length,
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
    }));

    return {
      ok: true,
      result: {
        thresholds: { T1, T2, T3, T4, epsGap },
        fit: { J: opt.J, acc: opt.acc, rmse: opt.rmse, confusion: opt.confusion },
        bins,
        measuredEdges,
        sampledCount: sampled.length,
        validOdiCount: valid.length,
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
      // 支持：逗号/空格/制表符/中文逗号
      const parts = raw.split(/[\t,，\s]+/).filter(Boolean);
      if (parts.length < 3) continue;

      const seq = Number(parts[0]);
      const name = String(parts[1] ?? '').trim();
      const thickness = Number(parts[2]);
      if (!name || Number.isNaN(thickness)) continue;

      layers.push({ seq: Number.isNaN(seq) ? i + 1 : seq, name, thickness });
    }

    // 若序号可用则按序号排序；否则保持导入顺序
    const hasNumericSeq = layers.some((l) => Number.isFinite(l.seq));
    if (hasNumericSeq) {
      layers.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
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

  useEffect(() => {
    if (!selectedCoal && coalSeams.length > 0) {
      setSelectedCoal(coalSeams[0]);
    }
  }, [coalSeams, selectedCoal]);

  const identifiedTarget = useMemo(() => {
    const counts = new Map();
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
  }, [drillholeLayersById]);

  const perBoreholeTarget = useMemo(() => {
    // 目标评价层：最上层基岩（与煤层选择无关）
    const out = {};
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
  }, [drillholeLayersById]);

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
    const Hi = [];
    const Di = [];
    const Mi = [];
    const CoalThk = [];

    for (const [bhId, mark] of Object.entries(perBoreholeTarget ?? {})) {
      const coord = drillholeCoordsById.get(bhId);
      if (!coord) continue;
      const ls = drillholeLayersById[bhId] ?? [];

      const targetIdx = mark?.targetIdx;
      if (!Number.isInteger(targetIdx)) continue;

      const tThickness = Number(ls[targetIdx]?.thickness);
      if (!Number.isFinite(tThickness)) continue;

      // Di：目标层埋深 = 目标层上覆岩层厚度累加（目标层顶深，不含目标层本身）
      let depthTop = 0;
      for (let k = 0; k < targetIdx; k++) {
        const v = Number(ls[k]?.thickness);
        if (Number.isFinite(v)) depthTop += v;
      }
      const di = depthTop;

      Ti.push({ id: bhId, x: coord.x, y: coord.y, value: tThickness });
      Di.push({ id: bhId, x: coord.x, y: coord.y, value: di });

      if (coal) {
        const coalIdx = ls.findIndex((l) => String(l?.name ?? '').trim() === coal);
        if (coalIdx >= 0) {
          // Mi：目标煤层埋深 = 目标煤层上覆岩层厚度累加（煤层顶深，不含煤层本身）
          let coalDepthTop = 0;
          for (let k = 0; k < coalIdx; k++) {
            const v = Number(ls[k]?.thickness);
            if (Number.isFinite(v)) coalDepthTop += v;
          }
          if (Number.isFinite(coalDepthTop)) {
            Mi.push({ id: bhId, x: coord.x, y: coord.y, value: coalDepthTop });
          }

          // 真实煤厚（用于采高判别）：直接取该煤层厚度
          const coalThk = Number(ls[coalIdx]?.thickness);
          if (Number.isFinite(coalThk)) {
            CoalThk.push({ id: bhId, x: coord.x, y: coord.y, value: coalThk });
          }

          // Hi：煤层与最上层基岩之间夹层总厚度（不含两者本身）
          if (coalIdx > targetIdx + 1) {
            let hi = 0;
            for (let k = targetIdx + 1; k <= coalIdx - 1; k++) {
              const v = Number(ls[k]?.thickness);
              if (Number.isFinite(v)) hi += v;
            }
            Hi.push({ id: bhId, x: coord.x, y: coord.y, value: hi });
          }
        }
      }
    }

    return { Ti, Hi, Di, Mi, CoalThk };
  }, [drillholeCoordsById, drillholeLayersById, perBoreholeTarget, selectedCoal]);

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

  const renderHeatmapDataUrl = (fieldPack, min, max, paletteName, clipRange, steps, filterRange) => {
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
        if (stepsInt && stepsInt >= 3) {
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
    const pts = (odiResult?.points ?? [])
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.odiNorm));
    if (pts.length < 3) return null;
    const samples = pts.map((p) => ({ id: String(p.id ?? ''), x: p.x, y: p.y, value: p.odiNorm }));
    return computeField(samples, 500, 400);
  }, [odiResult]);

  const odiLevelRanges = useMemo(() => {
    // 默认：ODI 0~1 均分 5 段
    const fallback = [
      { lo: 0.0, hi: 0.2, includeHi: false },
      { lo: 0.2, hi: 0.4, includeHi: false },
      { lo: 0.4, hi: 0.6, includeHi: false },
      { lo: 0.6, hi: 0.8, includeHi: false },
      { lo: 0.8, hi: 1.0, includeHi: true },
    ];
    if (activeTab !== 'surface') return fallback;
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

    return renderHeatmapDataUrl(
      odiFieldPack,
      hasUserRange ? effMin : 0,
      hasUserRange ? effMax : 1,
      odiVizPalette,
      clip,
      odiVizSteps,
      filterRange
    );
  }, [odiFieldPack, odiLevelFilter, odiLevelRanges, odiVizPalette, odiVizSteps, odiVizRange]);

  const handleComputeOdi = () => {
    const pts = paramExtractionResult?.points ?? [];
    const r = computeOdi(pts, scenarioWeights);
    setOdiResult(r);

    // 重新计算 ODI 后：旧的“实测约束分区”基于旧场，需作废，回到“”之前
    setMeasuredZoningResultTracked(null);
    setOdiLevelFilter(null);
  };

  const handleComputeMeasuredZoning = () => {
    if (activeTab !== 'surface') {
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

    const zoning = computeMeasuredZoningSurface(odiFieldPack, measuredConstraintData, 1e-3);
    if (!zoning?.ok) {
      window.alert(zoning?.message || '实测分区失败：请检查数据。');
      return;
    }

    const { thresholds, fit, bins, validOdiCount, measuredEdges } = zoning.result;

    setMeasuredZoningResultTracked({
      scenario: 'surface',
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
        Number.isFinite(p.Ei) ? p.Ei : 0,
        Number.isFinite(p.Hi) ? p.Hi : '',
        Number.isFinite(p.Di) ? p.Di : '',
        Number.isFinite(p.Mi) ? p.Mi : '',
        Number.isFinite(p.delta) ? p.delta : '',
        Number.isFinite(p.lpi) ? p.lpi : '',
        Number.isFinite(p.lci) ? p.lci : '',
      ]));
    }

    downloadTextFile(`评价点全参数_${stamp}.csv`, `\uFEFF${rows.join('\n')}\n`, 'text/csv;charset=utf-8');
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
    if (!Number.isFinite(minV) || !Number.isFinite(maxV) || minV === maxV) {
      return { field: null, min: Number.isFinite(minV) ? minV : null, max: Number.isFinite(maxV) ? maxV : null, gridW: 0, gridH: 0, width, height, points: [], bounds: { minX, maxX, minY, maxY, pad: 14 } };
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
      Hi: computeField(boreholeParamSamples.Hi),
      Di: computeField(boreholeParamSamples.Di),
      Mi: computeField(boreholeParamSamples.Mi),
    };
  }, [boreholeParamSamples]);

  const coalThicknessField = useMemo(() => {
    return computeField(boreholeParamSamples.CoalThk);
  }, [boreholeParamSamples]);

  const handleExtractHighPrecisionParams = () => {
    if (!generatedPoints) return;

    const ts = new Date();
    const stamp = ts.toISOString();

    // Step 2.1：开采参数提取（所有评价点：灰/蓝/粉/绿/红）
    const faces = (generatedPoints?.faces ?? []).filter((f) => f?.corners?.length === 4);
    const faceByIndex = new Map(faces.map((f) => [f.faceIndex, f]));

    const faceLci = new Map();
    if (faces.length <= 1) {
      if (faces[0]) faceLci.set(faces[0].faceIndex, 0);
    } else {
      for (const f of faces) {
        let best = Infinity;
        for (const g of faces) {
          if (g.faceIndex === f.faceIndex) continue;
          const d = dist(f.centroid, g.centroid);
          if (Number.isFinite(d)) best = Math.min(best, d);
        }
        faceLci.set(f.faceIndex, Number.isFinite(best) ? best : 0);
      }
    }

    const evalPoints = [];
    for (const k of ['gray', 'blue', 'pink', 'green', 'red']) {
      const arr = (generatedPoints?.[k] ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      for (const p of arr) evalPoints.push({ ...p, __cat: k });
    }

    const M = Number(mineActualHeightM);
    const delta = Number(roofCavingAngleDeg);

    const computeLpiForPoint = (p, hitFace, isCenterlineGenerated) => {
      if (!hitFace) return 0;
      if (isCenterlineGenerated) return hitFace.shortLen;
      const dMin = minDistToPolyEdges(p, hitFace.corners);
      return Number.isFinite(dMin) ? (dMin * 2) : 0;
    };

    const miningAtEvalPoints = evalPoints.map((p) => {
      const isOnEdge = p.__cat === 'green' || p.__cat === 'pink';
      let hitFace = null;
      for (const f of faces) {
        if (polygonContainsPoint(f.corners, p)) {
          hitFace = f;
          break;
        }
      }
      const inWorkface = Boolean(hitFace);
      const trueCoalThk = sampleFieldAtWorldXY(coalThicknessField, p.x, p.y);
      let MiPoint = 0;
      if (isOnEdge) {
        MiPoint = 0;
      } else if (inWorkface) {
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
      const lci = hitFace ? (faceLci.get(hitFace.faceIndex) ?? 0) : 0;

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
        onWorkfaceEdge: isOnEdge,
      };
    });

    // 地质评价点（钻孔坐标点）：纳入“所有评价点”导出
    const geologyEvalPoints = (drillholeData ?? [])
      .filter((p) => p && String(p.id ?? '').trim() && Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => {
        let hitFace = null;
        for (const f of faces) {
          if (polygonContainsPoint(f.corners, p)) {
            hitFace = f;
            break;
          }
        }
        const inWorkface = Boolean(hitFace);
        const trueCoalThk = sampleFieldAtWorldXY(coalThicknessField, p.x, p.y);

        const M = Number(mineActualHeightM);
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
        const lci = hitFace ? (faceLci.get(hitFace.faceIndex) ?? 0) : 0;

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
          onWorkfaceEdge: false,
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
    const rect = { left: 150, top: 50, width: 500, height: 400 };
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
  const hasSpatialData = hasBoundaryData || hasDrillholeData || hasWorkingFaceData;
  const combinedPointsForBounds = hasSpatialData
    ? [...boundaryData, ...drillholeData, ...(workingFaceData ?? [])]
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

  const MAIN_MAP_RECT = useMemo(() => ({ left: 150, top: 50, width: 500, height: 400, padding: 18 }), []);

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
    const Ti = sampleFieldAtWorldXY(contourData.Ti, wx, wy);
    const Hi = sampleFieldAtWorldXY(contourData.Hi, wx, wy);
    const Di = sampleFieldAtWorldXY(contourData.Di, wx, wy);

    setCrosshair({
      active: true,
      sx,
      sy,
      wx,
      wy,
      values: { odiNorm, Ti, Hi, Di },
    });
  };

  const handleMainMapMouseLeave = () => {
    setCrosshair((p) => (p.active ? { ...p, active: false } : p));
  };
  const normalizedBoundaryData = hasBoundaryData ? normalizeCoords(boundaryData, combinedPointsForBounds) : [];
  const normalizedDrillholeData = hasDrillholeData ? normalizeCoords(drillholeData, combinedPointsForBounds) : [];
  const normalizedWorkingFaceData = hasWorkingFaceData ? normalizeCoords(workingFaceData, combinedPointsForBounds) : [];
  const normalizedMeasuredConstraintData = (hasMeasuredConstraintData && combinedPointsForBounds.length)
    ? normalizeCoords(measuredConstraintData, combinedPointsForBounds)
    : [];

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
          const fileId = String(file.name ?? '').replace(/\.[^.]+$/, '').trim();
          const rows = parseMeasuredConstraintText(text, fileId);
          return rows;
        })
      );
      const merged = entries.flat();
      // 合并同 ID：以后读到的覆盖以前的
      const byId = new Map();
      for (const r of merged) {
        const id = String(r?.id ?? '').trim();
        const x = Number(r?.x);
        const y = Number(r?.y);
        const measured = Number(r?.measured);
        if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(measured)) continue;
        byId.set(id, { id, x, y, measured });
      }
      const next = Array.from(byId.values());
      setMeasuredConstraintData(next);
      setMeasuredZoningResultTracked(null);
    } catch (err) {
      console.error('导入实测约束数据失败', err);
      window.alert('导入实测约束数据失败：请检查文件格式（测点ID, x, y, 实测值）。');
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

  const geologyParamOptions = useMemo(
    () => [
      { key: 'Ti', label: '目标层厚度（Ti）' },
      { key: 'Mi', label: '目标煤层埋深（Mi）' },
      { key: 'Hi', label: '煤层与目标层间距（Hi）' },
      { key: 'Di', label: '目标层埋深（Di）' },
    ],
    []
  );

  const geologyPanelsByKey = useMemo(() => {
    return {
      Ti: {
        title: '目标层厚度 (Ti)',
        key: 'Ti',
        unit: 'm',
        subtitleOverride: undefined,
      },
      Mi: {
        title: '目标煤层埋深 (Mi)',
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
    <div className="flex h-screen bg-slate-100 font-sans text-slate-900 overflow-hidden">
      {/* 左侧控制栏 - 数据上传与输入 */}
      <aside className="w-80 bg-white border-r border-slate-200 flex flex-col shadow-xl z-10 shrink-0">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="text-blue-600" size={20} />
            <h1 className="text-base font-bold text-slate-800 tracking-tight">覆岩扰动定量表征系统</h1>
          </div>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">定量评价与预测平台</p>
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
              <div>
                <div className="text-[11px] text-slate-500 mb-2 font-bold">识别目标评价层（最上层基岩）</div>
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

                <div className="mt-3">
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
                            <th className="text-left px-3 py-2 text-slate-500 font-bold">最上层基岩岩性</th>
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

        <div className="p-4 border-t border-slate-100 bg-slate-50 text-center">
          <button className="w-full bg-slate-800 text-white py-3 rounded-md text-sm font-bold hover:bg-slate-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-200 uppercase tracking-widest">
            启动计算引擎
          </button>
        </div>
      </aside>

      {/* 中间区域 - 分布图(上) + 误差分析(下) */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-slate-50/50 shadow-inner">
        <div className="px-6 pt-6 flex items-center justify-between gap-4">
          <div className="inline-flex bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
            <button
              className={`px-4 py-2 rounded-md text-xs font-bold transition-colors ${mainViewMode === 'odi' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              onClick={() => setMainViewMode('odi')}
            >
              综合扰动结果
            </button>
            <button
              className={`px-4 py-2 rounded-md text-xs font-bold transition-colors ${mainViewMode === 'geology' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              onClick={() => setMainViewMode('geology')}
            >
              地质参数分析
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
              title="清空所有场景的输入数据与参数设置（可撤回）"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col p-6 space-y-6 overflow-y-auto">
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
                    覆岩扰动 (ODI) 分布图
                 </h3>
                 {showMainMap && (
                   <>
                     <div className="h-4 w-px bg-slate-200"></div>
                     {!hasSpatialData && (
                       <div className="flex gap-4">
                          <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                            <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.5)]"></span> 高强度扰动区
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                            <span className="w-2 h-2 rounded-full bg-blue-100 border border-blue-200"></span> 低强度扰动区
                          </div>
                       </div>
                     )}
                   </>
                 )}
               </div>
               <div className="flex gap-2 items-center">
                 {showMainMap && (
                   <>
                     <button
                       className="p-1.5 hover:bg-slate-100 rounded text-slate-400"
                       title={isMainMapFullscreen ? '退出全屏' : '全屏查看'}
                       onClick={(e) => {
                         e.stopPropagation();
                         handleToggleMainMapFullscreen();
                       }}
                     >
                       <Maximize2 size={16} />
                     </button>

                     <div className="relative" onClick={(e) => e.stopPropagation()}>
                       <button
                         data-main-map-export-button
                         className="p-1.5 hover:bg-slate-100 rounded text-slate-400 text-[10px] font-bold uppercase tracking-tighter border border-slate-200 px-3"
                         onClick={() => setShowMainMapExportMenu((v) => !v)}
                       >
                         导出
                       </button>
                       {showMainMapExportMenu && (
                         <div
                           data-main-map-export-menu
                           className="absolute right-0 mt-2 w-44 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-50"
                         >
                           <button
                             className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                             onClick={() => {
                               setShowMainMapExportMenu(false);
                               exportMainMapPng();
                             }}
                           >
                             导出 PNG
                           </button>
                           <button
                             className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${odiFieldPack?.field ? 'text-slate-700' : 'text-slate-400 cursor-not-allowed'}`}
                             disabled={!odiFieldPack?.field}
                             title={odiFieldPack?.field ? '导出 CSV：钻孔ID,x,y,ODI' : '请先完成 ODI 计算'}
                             onClick={() => {
                               setShowMainMapExportMenu(false);
                               exportOdiCsvByDrillholes();
                             }}
                           >
                             导出 CSV（钻孔ODI）
                           </button>
                         </div>
                       )}
                     </div>
                     <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                       <button
                         className={`p-1.5 rounded text-[10px] font-bold uppercase tracking-tighter border border-slate-200 px-3 transition-colors ${
                           showBoundaryLabels
                             ? 'bg-slate-900 text-white'
                             : 'bg-white text-slate-600 hover:bg-slate-50'
                         }`}
                         onClick={() => setShowBoundaryLabels((v) => !v)}
                         title="采区边界标签开关"
                       >
                         采区边界标签
                       </button>
                       <button
                         className={`p-1.5 rounded text-[10px] font-bold uppercase tracking-tighter border border-slate-200 px-3 transition-colors ${
                           showDrillholeLabels
                             ? 'bg-slate-900 text-white'
                             : 'bg-white text-slate-600 hover:bg-slate-50'
                         }`}
                         onClick={() => setShowDrillholeLabels((v) => !v)}
                         title="地质钻孔标签开关"
                       >
                         地质钻孔标签
                       </button>

                       {/* 图层开关：紧挨标签按钮 */}
                       <div className="flex items-center gap-1 ml-1">
                         <button
                           className={`p-1.5 rounded text-[10px] font-bold uppercase tracking-tighter border border-slate-200 px-3 transition-colors ${
                             showLayerInterpolation ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                           }`}
                           onClick={() => setShowLayerInterpolation((v) => !v)}
                           title="插值背景（ODI 热力）开关"
                         >
                           插值
                         </button>
                         <button
                           className={`p-1.5 rounded text-[10px] font-bold uppercase tracking-tighter border border-slate-200 px-3 transition-colors ${
                             showLayerDrillholes ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                           }`}
                           onClick={() => setShowLayerDrillholes((v) => !v)}
                           title="地质钻孔点图层开关"
                         >
                           钻孔
                         </button>
                         <div className="flex items-center gap-1">
                           <button
                             className={`p-1.5 rounded text-[10px] font-bold uppercase tracking-tighter border border-slate-200 px-3 transition-colors ${
                               showLayerEvalPoints ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                             }`}
                             onClick={() => setShowLayerEvalPoints((v) => !v)}
                             title="工作面评价点图层开关"
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
                               >
                                 边界点
                               </button>
                               <button
                                 className={`px-2 py-1 rounded text-[10px] font-bold border border-slate-200 transition-colors ${
                                   showEvalWorkfaceLocPoints ? 'bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-100 text-slate-400 hover:bg-slate-50'
                                 }`}
                                 onClick={() => setShowEvalWorkfaceLocPoints((v) => !v)}
                                 title="评价点：工作面定位点（粉）"
                               >
                                 定位点
                               </button>
                               <button
                                 className={`px-2 py-1 rounded text-[10px] font-bold border border-slate-200 transition-colors ${
                                   showEvalEdgeCtrlPoints ? 'bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-100 text-slate-400 hover:bg-slate-50'
                                 }`}
                                 onClick={() => setShowEvalEdgeCtrlPoints((v) => !v)}
                                 title="评价点：边线控制点（绿）"
                               >
                                 边线点
                               </button>
                               <button
                                 className={`px-2 py-1 rounded text-[10px] font-bold border border-slate-200 transition-colors ${
                                   showEvalCenterCtrlPoints ? 'bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-100 text-slate-400 hover:bg-slate-50'
                                 }`}
                                 onClick={() => setShowEvalCenterCtrlPoints((v) => !v)}
                                 title="评价点：中心控制点（红）"
                               >
                                 中心点
                               </button>
                             </div>
                           )}
                         </div>
                       </div>
                     </div>
                   </>
                 )}
                 <button className="p-1 hover:bg-slate-200 rounded transition-colors">
                   {showMainMap ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronUp size={16} className="text-slate-500" />}
                 </button>
               </div>
            </div>

            {/* 上部横向动态可视化配置模块（放在本图模块内） */}
            {showMainMap && (
              <div className="px-4 py-3 border-b border-slate-100 bg-white" onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] text-slate-500 font-bold">色带</div>
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

                  <div className="flex items-center gap-2">
                    <div className="text-[11px] text-slate-500 font-bold">分级</div>
                    <input
                      type="range"
                      min={3}
                      max={10}
                      step={1}
                      value={odiVizSteps}
                      onChange={(e) => setOdiVizSteps(Number(e.target.value))}
                      className="w-40"
                      title="颜色分级数量（3~10）"
                    />
                    <div className="text-[11px] text-slate-600 font-mono w-8 text-right">{odiVizSteps}</div>
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
                    <div className="text-[10px] text-slate-400">区间外透明</div>
                  </div>

                  <div className="h-4 w-px bg-slate-200 hidden md:block"></div>

                  <button
                    className={`px-2 py-1 rounded text-[10px] font-bold border border-slate-200 transition-colors ${
                      showMainMapCoordinates ? 'bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-100 text-slate-400 hover:bg-slate-50'
                    }`}
                    onClick={() => setShowMainMapCoordinates((v) => !v)}
                    title={showMainMapCoordinates ? '隐藏主图坐标刻度与读数' : '显示主图坐标刻度与读数'}
                  >
                    {showMainMapCoordinates ? '隐藏坐标' : '显示坐标'}
                  </button>
                </div>
              </div>
            )}
            
            {showMainMap && (
              <div className="flex-1 flex items-center justify-center p-4 relative">
                <svg
                  ref={mainMapSvgRef}
                  viewBox="0 0 800 500"
                  className="w-full h-full drop-shadow-2xl transition-transform duration-700 group-hover:scale-[1.01]"
                  onMouseMove={handleMainMapMouseMove}
                  onMouseLeave={handleMainMapMouseLeave}
                >
                  {/* 采区外框矩形（仅未导入数据时显示占位外框） */}
                  {!hasSpatialData && (
                    <rect x="150" y="50" width="500" height="400" fill="none" stroke="#e2e8f0" strokeWidth="2" strokeDasharray="10 5" />
                  )}

                  {/* 坐标刻度网格（工业风：主图坐标尺） */}
                  {showMainMapCoordinates && hasSpatialData && spatialBounds && (
                    <g pointerEvents="none">
                      {(() => {
                        const rect = { left: 150, top: 50, width: 500, height: 400, padding: 18 };
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
                    <image href={odiHeatmapHref} x="150" y="50" width="500" height="400" preserveAspectRatio="none" opacity="0.92" />
                  )}
                  {hasSpatialData ? (
                    <g>
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
                      {hasWorkingFaceData && showEvalWorkfaceLocPoints && normalizedWorkingFaceData.map((p) => (
                        <g key={`wf-raw-${p.id}-${p.x}-${p.y}`}>
                          <circle cx={p.nx} cy={p.ny} r="4" fill="#ec4899" opacity="0.9" />
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
                          {showEvalWorkfaceLocPoints && generatedByCat.pink.map((p) => (
                            <circle key={`gen-pink-${p.id}-${p.x}-${p.y}`} cx={p.nx} cy={p.ny} r="4.5" fill="#ec4899" opacity="0.95" />
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
                      {normalizedMeasuredConstraintData.length > 0 && showLayerEvalPoints && (
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
                            const rect = { left: 150, top: 50, width: 500, height: 400, padding: 18 };
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

                {/* 动态图例：有哪类点就显示哪类 */}
                {(() => {
                  const items = [];
                  if (hasDrillholeData && showLayerDrillholes) items.push({ key: 'geo', label: '地质坐标点', color: '#000000' });
                  if (generatedPoints?.gray?.length && showLayerEvalPoints && showEvalBoundaryPoints) items.push({ key: 'bnd', label: '边界点', color: '#94a3b8' });
                  if (hasBoundaryData) items.push({ key: 'area', label: '采区边界控制点', color: '#2563eb' });
                  if (normalizedMeasuredConstraintData.length > 0 && showLayerEvalPoints) items.push({ key: 'measured', label: '实测点', color: '#ef4444' });
                  if (generatedPoints?.pink?.length && showLayerEvalPoints && showEvalWorkfaceLocPoints) {
                    items.push({ key: 'wfLoc', label: '工作面定位点', color: '#ec4899' });
                  } else if (hasWorkingFaceData && showEvalWorkfaceLocPoints) {
                    items.push({ key: 'wfRaw', label: '工作面坐标点', color: '#ec4899' });
                  }
                  if (generatedPoints?.green?.length && showLayerEvalPoints && showEvalEdgeCtrlPoints) items.push({ key: 'wfEdge', label: '边线控制点', color: '#22c55e' });
                  if (generatedPoints?.red?.length && showLayerEvalPoints && showEvalCenterCtrlPoints) items.push({ key: 'wfCenter', label: '中心控制点', color: '#ef4444' });
                  if (!items.length) return null;

                  return (
                    <div className="absolute left-4 right-4 bottom-2 z-20 pointer-events-none">
                      <div className="bg-white/70 rounded px-3 py-2 flex flex-wrap gap-x-4 gap-y-2">
                        {items.map((it) => (
                          <div key={it.key} className="flex items-center gap-2 text-[11px] text-slate-600 font-medium">
                            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: it.color }} />
                            <span className="tracking-wide">{it.label}</span>
                          </div>
                        ))}
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
                        <div>ODI: {Number.isFinite(crosshair.values?.odiNorm) ? crosshair.values.odiNorm.toFixed(3) : '-'}</div>
                        <div>Ti: {Number.isFinite(crosshair.values?.Ti) ? crosshair.values.Ti.toFixed(3) : '-'}</div>
                        <div>Hi: {Number.isFinite(crosshair.values?.Hi) ? crosshair.values.Hi.toFixed(3) : '-'}</div>
                        <div>Di: {Number.isFinite(crosshair.values?.Di) ? crosshair.values.Di.toFixed(3) : '-'}</div>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">移动鼠标：实时坐标 + 即时插值</div>
                    </div>
                  </div>
                )}

              </div>
            )}

          </div>

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
                    {activeTab === 'surface'
                      ? (measuredZoningResult?.bins?.length === 5 ? '已分级' : (measuredConstraintData?.length ? '待分区' : '未导入'))
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
                {activeTab === 'surface' ? (
                  measuredZoningResult?.bins?.length === 5 ? (
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-white border-b border-slate-100">
                        <tr>
                          <th className="text-left py-2 pr-3 text-slate-500 font-bold whitespace-nowrap">扰动等级</th>
                          {['I 级', 'II 级', 'III 级', 'IV 级', 'V 级'].map((lv) => (
                            <th key={lv} className="text-center py-2 px-2 text-slate-500 font-bold whitespace-nowrap">{lv}</th>
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
                            if (idx === 0) return `≤ ${fmtOdi(hi)}`;
                            if (idx === 4) return `${fmtOdi(lo)}<`;
                            return `${fmtOdi(lo)}~${fmtOdi(hi)}`;
                          };
                          const sCell = (idx) => {
                            const b = bins[idx];
                            const lo = Number(b?.measuredMin);
                            const hi = Number(b?.measuredMax);
                            if (idx === 0) return `≤ ${fmtS(hi)}`;
                            if (idx === 4) return `${fmtS(lo)}<`;
                            return `${fmtS(lo)}~${fmtS(hi)}`;
                          };

                          return (
                            <>
                              <tr className="border-b border-slate-50">
                                <td className="py-2 pr-3 text-slate-700 font-bold whitespace-nowrap">ODI</td>
                                {[0, 1, 2, 3, 4].map((i) => (
                                  <td key={`odi-${i}`} className="py-2 px-2 text-center text-slate-700 font-mono whitespace-nowrap">{odiCell(i)}</td>
                                ))}
                              </tr>
                              <tr className="border-b border-slate-50 last:border-b-0">
                                <td className="py-2 pr-3 text-slate-700 font-bold whitespace-nowrap">对应地表下沉量范围（m）</td>
                                {[0, 1, 2, 3, 4].map((i) => (
                                  <td key={`s-${i}`} className="py-2 px-2 text-center text-slate-700 font-mono whitespace-nowrap">{sCell(i)}</td>
                                ))}
                              </tr>
                            </>
                          );
                        })()}
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-[11px] text-slate-500 leading-5">
                      {measuredConstraintData?.length
                        ? '已导入实测约束数据，请在右侧“分级响应详情”中点击“”。'
                        : '请先在左侧导入“实测约束数据”，再。'}
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
                  <div className="flex items-center gap-4 text-[10px] text-slate-400 font-medium">
                     <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-500"></span> ODI 预测值</div>
                     <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 border-b border-dashed border-red-500"></span> 现场实测值</div>
                  </div>
                )}
                <button className="p-1 hover:bg-slate-200 rounded transition-colors">
                  {showErrorAnalysis ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronUp size={16} className="text-slate-500" />}
                </button>
              </div>
            </div>
            {showErrorAnalysis && (
              <div className="flex-1 w-full min-h-0 px-5 pb-5">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={errorData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="id" tick={{fontSize: 9, fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="left" tick={{fontSize: 9, fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="right" orientation="right" tick={{fontSize: 9, fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '10px' }} 
                      cursor={{fill: '#f8fafc'}}
                    />
                    <Bar yAxisId="left" dataKey="error" fill="#cbd5e1" name="绝对误差" radius={[4, 4, 0, 0]} barSize={20} />
                    <Line yAxisId="left" type="monotone" dataKey="odi" stroke="#3b82f6" name="ODI 预测" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} />
                    <Line yAxisId="right" type="monotone" dataKey="measured" stroke="#ef4444" name="实测结果" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: '#ef4444' }} />
                  </ComposedChart>
                </ResponsiveContainer>
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
                <Grid size={16} className="text-blue-500" /> 评估结果响应面板
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
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">工作面评估点导入</h3>
                    <div className="mt-1 text-[10px] text-slate-400">
                      2 步向导：先生成评价点，再启动全参插值提取
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
                      {generatedPoints?.faceCount ?? 0}
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
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2">
                      <div className="text-[10px] text-slate-500 font-bold">矿井实际采高 M (m)</div>
                      <input
                        type="number"
                        value={mineActualHeightM}
                        onChange={(e) => setMineActualHeightM(Number(e.target.value))}
                        className="w-full bg-transparent text-sm font-bold outline-none border-b border-slate-200 focus:border-blue-500"
                      />
                    </div>
                    <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2">
                      <div className="text-[10px] text-slate-500 font-bold">顶板垮落角 δ (°)</div>
                      <input
                        type="number"
                        value={roofCavingAngleDeg}
                        onChange={(e) => setRoofCavingAngleDeg(Number(e.target.value))}
                        className="w-full bg-transparent text-sm font-bold outline-none border-b border-slate-200 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <button
                    className={`w-full rounded text-xs font-bold py-2 border transition-colors ${generatedPoints ? 'bg-white border-slate-200 text-slate-700 hover:border-blue-500 hover:text-blue-600' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                    onClick={handleExtractHighPrecisionParams}
                    disabled={!generatedPoints}
                    title={generatedPoints ? '对控制点与评价点进行全参插值提取' : '请先完成“评价点生成”'}
                    type="button"
                  >
                    启动全参插值提取
                  </button>

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
                      title={paramExtractionResult ? '导出全参提取结果（CSV）' : '请先完成“启动全参插值提取”'}
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
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest italic">分级响应详情</h3>
                    {activeTab === 'surface' && measuredZoningResult?.bins?.length === 5 && (
                      <span className="text-[9px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-bold shrink-0">实测分区已启用</span>
                    )}
                  </div>
                  <Info size={12} className="text-slate-300" />
                </div>

                {/* ODI 计算入口 */}
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2">
                      <div className="text-[10px] text-slate-500 font-bold">位移响应权重 (wd)</div>
                      <input
                        type="number"
                        step="0.01"
                        value={scenarioWeights.wd}
                        onChange={(e) => setScenarioWeights((p) => ({ ...p, wd: Number(e.target.value) }))}
                        className="w-full bg-transparent text-sm font-bold outline-none border-b border-slate-200 focus:border-blue-500"
                      />
                    </div>
                    <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2">
                      <div className="text-[10px] text-slate-500 font-bold">力学响应权重 (wsigma)</div>
                      <input
                        type="number"
                        step="0.01"
                        value={scenarioWeights.wo}
                        onChange={(e) => setScenarioWeights((p) => ({ ...p, wo: Number(e.target.value) }))}
                        className="w-full bg-transparent text-sm font-bold outline-none border-b border-slate-200 focus:border-blue-500"
                      />
                    </div>
                    <div className="bg-slate-50 rounded border border-slate-200 px-3 py-2">
                      <div className="text-[10px] text-slate-500 font-bold">水力响应权重 (wf)</div>
                      <input
                        type="number"
                        step="0.01"
                        value={scenarioWeights.wf}
                        onChange={(e) => setScenarioWeights((p) => ({ ...p, wf: Number(e.target.value) }))}
                        className="w-full bg-transparent text-sm font-bold outline-none border-b border-slate-200 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <button
                    className={`w-full rounded text-xs font-bold py-2 border transition-colors ${paramExtractionResult?.points?.length ? 'bg-white border-slate-200 text-slate-700 hover:border-blue-500 hover:text-blue-600' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                    onClick={handleComputeOdi}
                    disabled={!paramExtractionResult?.points?.length}
                    title={paramExtractionResult?.points?.length ? '基于全参提取结果计算 ODI 并生成等值分布' : '请先完成全参插值提取'}
                    type="button"
                  >
                    综合扰动系数计算（ODI）
                  </button>

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
                      const right = odiResult?.points?.length
                        ? `${cnt}/${total}${total ? ` (${Math.round((cnt / total) * 100)}%)` : ''}`
                        : '';

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
                              ODI 区间: {valLabel}{mean != null ? ` / 均值: ${mean.toFixed(3)}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {right && <div className="text-[10px] text-slate-500 font-mono">{right}</div>}
                            <AlertTriangle size={14} className={`${meta.icon} ${meta.pulse ? 'animate-pulse' : ''}`} />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* 基于实测约束分区（目前仅地表下沉场景实现） */}
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">基于实测约束分区</div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {measuredConstraintData?.length ? `实测点: ${measuredConstraintData.length}` : '未导入'}
                    </div>
                  </div>

                  {activeTab === 'surface' ? (
                    <div className="text-[10px] text-slate-500 leading-4">
                      导入实测地表下沉点后，可按实测值五等分并反推对应 ODI 分区，联动本模块 5 个等级区间。
                    </div>
                  ) : (
                    <div className="text-[10px] text-slate-500 leading-4">
                      该场景的实测约束分区逻辑后续再优化（界面功能保持一致）。
                    </div>
                  )}

                  {activeTab === 'surface' && measuredZoningResult?.bins?.length === 5 && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                      <div className="text-[10px] text-emerald-800 font-bold">分区已生成</div>
                      <div className="text-[10px] text-emerald-700 mt-1">
                        有效提取 ODI 的实测点：{measuredZoningResult.validOdiCount} / 导入：{measuredZoningResult.importedCount}
                      </div>
                    </div>
                  )}

                  {(() => {
                    const canCompute = activeTab === 'surface' && measuredConstraintData?.length > 0 && !!odiFieldPack?.field;
                    const title = activeTab !== 'surface'
                      ? '该场景暂未实现'
                      : !measuredConstraintData?.length
                        ? '请先导入实测约束数据'
                        : !odiFieldPack?.field
                          ? '请先完成 ODI 计算并生成 ODI 分布场'
                          : '按实测值五等分并生成 ODI 分区';

                    return (
                      <button
                        className={`w-full rounded text-xs font-bold py-2 border transition-colors ${canCompute ? 'bg-white border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-600' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                        onClick={handleComputeMeasuredZoning}
                        disabled={!canCompute}
                        title={title}
                        type="button"
                      >
                        {measuredZoningResult?.bins?.length === 5 ? '重新计算实测分区' : ''}
                      </button>
                    );
                  })()}
                </div>
              </section>

              {/* 贯通系数预警面板：仅“含水层扰动场景”显示 */}
              {activeTab === 'aquifer' && (
                <section className="bg-white p-6 rounded-2xl text-slate-900 border border-slate-200 shadow-sm relative overflow-hidden group">
                  {/* 背景大图标修饰 */}
                  <div className="absolute -right-6 -top-6 opacity-[0.06] group-hover:opacity-[0.10] transition-opacity rotate-12 text-slate-300">
                    <AlertTriangle size={120} className="text-slate-300" />
                  </div>
                  <div className="relative z-10">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-3 border-b border-slate-100 pb-2">关键贯通风险预警</div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-mono font-bold text-emerald-600 tracking-tighter">K = 0.842</span>
                      <span className="text-[9px] text-slate-400 uppercase font-mono tracking-widest">贯通系数</span>
                    </div>
                    <div className="mt-6 flex flex-col gap-2">
                      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold border border-emerald-200">
                        <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
                        实时监测：评价区域安全
                      </div>
                      <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-slate-500 uppercase tracking-widest">设置富裕系数</span>
                          <span className="font-mono text-slate-900 underline decoration-emerald-500/50 underline-offset-4">{richFactor}</span>
                        </div>
                        <div className="mt-2 h-1 w-full bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 w-[84%] opacity-60"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              )}

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
              <BrainCircuit size={18} className="text-slate-700" />
              <div className="min-w-0 text-left">
                <div className="text-sm font-bold text-slate-700 truncate">智能规划建议</div>
                <div className="text-[10px] text-slate-400 truncate">工作面布局与路径策略提示</div>
              </div>
            </div>
            <ChevronDown
              size={18}
              className={`text-slate-400 transition-transform duration-300 ${activeAccordion.includes('planning') ? 'rotate-180' : ''}`}
            />
          </button>

          <div className={`overflow-hidden transition-all duration-500 ${activeAccordion.includes('planning') ? 'max-h-[500px]' : 'max-h-0'}`}>
            <div className="px-5 pb-5">
              <div className="bg-slate-900 text-white rounded-xl border border-slate-900 shadow-sm p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
                    <DraftingCompass size={16} className="text-white/80" />
                    智能工作面规划
                  </div>
                  <button
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-white/15 bg-white/10 text-[10px] font-bold hover:bg-white/15 transition-colors"
                    type="button"
                  >
                    <Zap size={14} className="text-white/80" /> 启动
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="flex items-start gap-3">
                      <ListOrdered size={16} className="text-white/70 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-white">建议清单</div>
                        <div className="mt-1 text-[10px] text-white/70 leading-4">
                          以现有 ODI 分级与空间约束为输入，给出工作面优先级、避让策略与路径规划要点。
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="flex items-start gap-3">
                      <BrainCircuit size={16} className="text-white/70 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-white">智能提示</div>
                        <div className="mt-1 text-[10px] text-white/70 leading-4">
                          保持浅色工业风框架，关键建议区域使用深色卡片突出科技感。
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
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
              <CalendarClock size={18} className="text-slate-700" />
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

          <div className={`overflow-hidden transition-all duration-500 ${activeAccordion.includes('succession') ? 'max-h-[500px]' : 'max-h-0'}`}>
            <div className="px-5 pb-5 space-y-4">
              {[
                { name: '巷道准备期', days: 45, pct: 0.35, bar: 'bg-orange-500' },
                { name: '工作面回采期', days: 180, pct: 0.72, bar: 'bg-blue-500' },
                { name: '接续空窗期', days: 20, pct: 0.18, bar: 'bg-red-500' },
              ].map((item) => (
                <div key={item.name} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between text-xs">
                    <div className="font-bold text-slate-700">{item.name}</div>
                    <div className="font-mono text-slate-600">{item.days} 天</div>
                  </div>
                  <div className="mt-2 h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                    <div className={`h-full ${item.bar}`} style={{ width: `${Math.round(item.pct * 100)}%` }}></div>
                  </div>
                </div>
              ))}

              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-2">
                <AlertTriangle size={16} className="text-orange-600 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-orange-700">风险提示：接续空窗期过长将显著抬升生产组织风险</div>
                  <div className="mt-1 text-[10px] text-orange-700/80">建议提前锁定接续资源，避免关键节点延误造成产量波动。</div>
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
              <CircleDollarSign size={18} className="text-slate-700" />
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
                        <CircleDollarSign size={14} className="text-slate-400" />
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
