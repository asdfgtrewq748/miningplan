# 智能规划（smart-efficiency / smart-resource / smart-weighted）证据链与算法点（可写入论文版）

> 目标：把“UI 触发 → API → 后端路由 → Node harness → Worker 实现”的端到端链路，以及每个关键算法点的**双锚点**（实现锚点 + 调用/使用锚点）补齐，便于后续直接粘贴进论文正文。
>
> 约束：本文档只陈述仓库内可直接定位的事实；每条关键结论尽量给出路径 + 行号范围链接。

---

## 1. 模式与职责边界（仅仓库事实）

- **smart-efficiency（工程效率）**：核心计算在前端 Worker `smartEfficiency.worker.js`；后端 FastAPI 的 `/planning/smart-efficiency/compute` 通过 Node harness 直接执行该 worker，以保证输出与前端一致（实现锚点：[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L1162-L1211)，[mining-plan/tools/run-smart-efficiency.mjs](mining-plan/tools/run-smart-efficiency.mjs#L1-L55)，[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L1-L260)）。
- **smart-resource（资源回收）**：核心计算在前端 Worker `smartResource.worker.js`；后端 FastAPI 的 `/planning/smart-resource/compute` 同样通过 Node harness 复用该 worker（实现锚点：[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L1214-L1270)，[mining-plan/tools/run-smart-resource.mjs](mining-plan/tools/run-smart-resource.mjs#L1-L56)，[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L2520-L2705)）。
- **smart-weighted（加权三目标）**：后端 FastAPI 端点 `/planning/smart-weighted/compute` 负责**候选池拼接 + Recovery/Disturbance 评分 + NSGA-II TopK 选择 + 加权综合得分**；候选生成仍复用 Node harness 运行的 smart-efficiency / smart-resource /（可选）disturbance（实现锚点：[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L1273-L1808)）。

---

## 2. 端到端调用链（UI → API → 后端 → Node harness → Worker）

### 2.1 Sequence（以 smart-efficiency / smart-resource / smart-weighted 为主）

```mermaid
sequenceDiagram
  participant UI as React UI (App.jsx)
  participant API as frontend/src/api.js
  participant PY as FastAPI (planning.py)
  participant NODE as Node harness (.mjs)
  participant W as Worker code (.worker.js)

  UI->>API: POST /planning/smart-efficiency/compute
  API->>PY: smart_efficiency_compute()
  PY->>NODE: node tools/run-smart-efficiency.mjs (stdin JSON)
  NODE->>W: import smartEfficiency.worker.js; self.onmessage({type:'compute'})
  W-->>NODE: self.postMessage({type:'result', payload})
  NODE-->>PY: stdout JSON(result.payload)
  PY-->>API: JSON
  API-->>UI: respPayload

  UI->>API: POST /planning/smart-resource/compute
  API->>PY: smart_resource_compute()
  PY->>NODE: node tools/run-smart-resource.mjs
  NODE->>W: import smartResource.worker.js; self.onmessage(...)
  W-->>NODE: postMessage({type:'result'})
  NODE-->>PY: stdout JSON
  PY-->>API: JSON
  API-->>UI: respPayload

  UI->>API: POST /planning/smart-weighted/compute (AbortSignal)
  API->>PY: smart_weighted_compute()
  PY->>NODE: node harness (eff/recovery/(dist))
  PY->>PY: smart_resource_tonnage() + disturbance sampling + NSGA-II select
  PY-->>API: weighted pack
  API-->>UI: resp
```

证据锚点：
- UI 触发：`smartEfficiencyCompute(...)`、`smartResourceCompute(...)`、`smartWeightedComputeCancelable(...)`（调用锚点：[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L4412-L4461)，[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L5020-L5070)，[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L14208-L14347)）。
- API 封装与超时：`apiPostWithTimeout`/`apiPostWithTimeoutAndSignal`，以及三条 planning endpoint（调用锚点：[mining-plan/frontend/src/api.js](mining-plan/frontend/src/api.js#L134-L205)）。
- 后端路由：`/planning/smart-efficiency/compute`、`/planning/smart-resource/compute`、`/planning/smart-weighted/compute`（实现锚点：[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L1162-L1808)）。
- Node harness：通过模拟 `self.postMessage` 收集 outbox，并取最后一次 `type==='result'`（实现锚点：[mining-plan/tools/run-smart-efficiency.mjs](mining-plan/tools/run-smart-efficiency.mjs#L1-L55)，[mining-plan/tools/run-smart-resource.mjs](mining-plan/tools/run-smart-resource.mjs#L1-L56)）。

---

## 3. 可复现性与工程约束（超时/缓存/随机性/进度）

### 3.1 前端请求超时与 watchdog

- smart-efficiency / smart-resource：前端对后端请求使用 `120000ms` 超时（实现锚点：[mining-plan/frontend/src/api.js](mining-plan/frontend/src/api.js#L160-L188)）。
- smart-weighted：前端对后端请求使用 `180000ms` 超时，并支持 AbortSignal（实现锚点：[mining-plan/frontend/src/api.js](mining-plan/frontend/src/api.js#L191-L205)）。
- UI watchdog：当优先走后端 compute 时，watchdog 设为 `130000ms`，并用“伪进度”把 elapsed 线性映射到 0~95%（实现锚点：[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L4350-L4461)，[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L4930-L5070)，[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L14180-L14233)）。

### 3.2 后端 Node harness 执行超时与缓存

- Node harness 子进程超时：`timeout_s=120.0`（默认）用于 `_run_node_smart_efficiency/_run_node_smart_resource`（实现锚点：[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L653-L761)）。
- Node 输出缓存：
  - key = `eff|sha1(payload)` 或 `rec|sha1(payload)`（实现锚点：[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L17-L74)，[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L653-L761)）。
  - 缓存容量上限 `_NODE_RESULT_CACHE_MAX = 16`，LRU-ish 淘汰（实现锚点：[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L17-L74)）。
- Node 模块解析：后端优先把 `frontend/node_modules` 加入 `NODE_PATH`，以便 worker 依赖（如 jsts）在 Node 下可解析（实现锚点：[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L678-L708)）。

### 3.3 Worker 内部确定性（seed 与排序稳定性）

- smart-efficiency 使用基于 `cacheKey` 的字符串种子：`hash32FNV1a` → `xorshift32` 生成 RNG（实现锚点：[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L29-L80)）。
- 排序稳定性：覆盖率比较采用 `COVERAGE_EPS=1e-5`，将微小几何抖动视为同档，再使用次级指标做 tie-break（实现锚点：[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L10-L18)）。
- weighted 为“严格单目标等价”保留每个子模式 cacheKey：`effCacheKey/recCacheKey/distCacheKey`，并在 `w=1` 的情况下不做 salt 合并（实现锚点：[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L14210-L14241)，[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L1344-L1409)）。

### 3.4 Node harness 结果提取的稳定窗口

- Node harness 通过环境变量 `MP_WORKER_WAIT_MS` 控制等待 outbox 稳定的最大时长，默认 `8000ms`；稳定条件为“120ms 内 outbox 不再增长且已出现 result”，最后取最后一条 `type==='result'`（实现锚点：[mining-plan/tools/run-smart-efficiency.mjs](mining-plan/tools/run-smart-efficiency.mjs#L30-L55)，[mining-plan/tools/run-smart-resource.mjs](mining-plan/tools/run-smart-resource.mjs#L32-L56)）。

---

## 4. 约束分层（输入校验 → 几何可行 → 验收口径 → 兜底与告警）

> 该部分只陈述已定位到的硬编码阈值与逻辑。

### 4.1 输入校验（A1 防线）

- smart-efficiency：边界点数不足直接失败并记录 `failTypes.BOUNDARY_TOO_FEW`；工作面宽度区间非法则 `failTypes.INPUT_INVALID_B=1`（实现锚点：[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L2007-L2058)）。
- smart-resource：同样对 `boundaryLoopWorld` 点数与 Bmin/Bmax 做硬校验，并维护 `attemptSummary.failTypes`（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L2624-L2705)）。

### 4.2 几何可行性（条带求交/区间求解/矩形构造）

- smart-efficiency：在“带宽条带”与 Ω 求交后，在条带内采样求“共同可行区间”并构造矩形；失败会累加 `BAND_POLY_EMPTY / BAND_NO_FEASIBLE_X|Y / RECT_BUILD_FAIL / ASSERT_RECT_OUTSIDE_OMEGA` 等 failTypes（实现锚点：[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L1200-L1455)）。
- smart-resource：当 relaxed 构造也无法找到 N 个面时，记录 `RELAX_NO_FEASIBLE`（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L1867-L1878)）。

### 4.3 验收口径（coverage / full cover / per-face inRatio）

- smart-efficiency：覆盖率硬阈值 `COVERAGE_MIN=0.70`，并用于 top1 的 `qualified` 标记；若 `usedFallback` 则顶层 `warning` 给出“未达标兜底”提示（实现锚点：[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L1879-L1881)，[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L3278-L3330)）。
- smart-resource：
  - “资源回收”模式下 `COVERAGE_MIN=0`（不设覆盖率硬阈值，仅几何硬约束）（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L2542-L2544)）。
  - per-face 硬约束：`PER_FACE_IN_RATIO_MIN` 默认 `0.7`，候选 `qualified = overlapOk && rminOk`（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L3052-L3100)，[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L3732-L3816)）。
  - v1.2 工程验收口径：`fullCoverMin` 默认 `0.995`；`ignoreCoalPillarsInCoverage` 默认跟随 `fullCover`（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L2555-L2563)）。

### 4.4 工程化“全覆盖增强”（cleanupResidual + fullCoverPatch）

- cleanupResidual（分段变宽 + 残煤清扫）只在 `SEG_ENABLED && CLEAN_ENABLED && !fastMode && sharedOmegaPoly` 时启用，并记录 `cleanupSummary`（enabled/ran/replacements/coverageBefore/After/residualAreaBefore/After/elapsedMs/note）（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L4949-L5060)，[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L5061-L5470)）。
- cleanupResidual 会把“清扫后候选”作为一个新 candidate（`key/signature` 追加 `|segW=1|clean=1`），并把 `cleanupSummary` 同时挂到 `candidate.cleanupResidual` 与 `candidate.metrics.cleanupResidual`；若能改进，则插到 candidates 第 1 名并参与后续 topK 截断与裁剪渲染（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L5420-L5520)）。
- fullCoverPatch：
  - 开关：`FULL_COVER_PATCH_ENABLED = payload.fullCoverPatch ?? FULL_COVER_ENABLED`；预算：`FULL_COVER_PATCH_BUDGET_MS = clamp(payload.fullCoverPatchMaxTimeMs ?? 1200, 100..8000)`（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L2555-L2563)）。
  - Lazy patch：仅对最终排序后的 Top3 做 LIGHT 档补片，写回 `renderPatched/fullCoverAchieved_patched/metrics.patchStats/metrics.patchBudgetMs`，并标记 `patchBudgetTier`（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L6529-L6638)）。
  - patchCandidateFullCover 的实现：按 residualPoly 的子多边形质心就近分配到工作面，做 `face ∪ residualPart`，再重算“扣煤柱后的有效覆盖率”，只有 `coverageAfter > coverageBefore + 1e-9` 才接受；输出 `renderPatched`（含 `plannedUnionLoopsWorldPatched` 与 `residualLoopsWorld`）与 `patchStats`（coverage/residual before/after 等）（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L7427-L7700)）。
- UI 参数来源（调用锚点）：smart-resource 的 payload 显式传入 `fullCoverPatchMaxTimeMs: 3000`、`fullCoverMin: 0.995`、`segmentWidth{...}`、`cleanupResidual{...maxTimeMs:3000}`（调用锚点：[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L4700-L4795)）。

---

## 5. 核心算法点清单（双锚点：实现 + 调用/使用）

> 说明：这里的“算法点”以论文可描述粒度组织；每行至少给一个实现锚点和一个调用/使用锚点。

| 算法点（论文可描述） | 实现锚点（实现在哪里） | 调用/使用锚点（从哪里触发/复用） | 可复现参数/默认值（已定位） |
|---|---|---|---|
| A0. UI→后端优先、失败回退 worker | — | smart-efficiency 后端优先、失败 fallbackToWorker（[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L4412-L4487)）；smart-resource 同理（[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L5020-L5070)） | watchdog 130000ms；伪进度 0~95%（同锚点） |
| A1. API 超时与可取消请求 | `apiPostWithTimeout*`（[mining-plan/frontend/src/api.js](mining-plan/frontend/src/api.js#L120-L158)） | `smartEfficiencyCompute/smartResourceCompute/smartWeightedComputeCancelable`（[mining-plan/frontend/src/api.js](mining-plan/frontend/src/api.js#L160-L205)） | 120000ms/180000ms |
| A2. Node harness 复用 worker（L2-first） | `_run_node_smart_efficiency/_run_node_smart_resource`（[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L653-L761)） | `/planning/smart-*/compute`（[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L1162-L1270)） | 子进程 timeout=120s；NODE_PATH 注入（同锚点） |
| A3. Node harness outbox 稳定抽取 result | `MP_WORKER_WAIT_MS` + outbox 稳定策略（[mining-plan/tools/run-smart-efficiency.mjs](mining-plan/tools/run-smart-efficiency.mjs#L30-L55)） | `_run_node_smart_efficiency` 调用 node（[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L693-L719)） | 默认 wait=8000ms；稳定窗=120ms |
| A4. 确定性随机数（cacheKey→seed→xorshift32） | `makeRng/hash32FNV1a`（[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L29-L80)） | weighted 保留 per-mode cacheKey 实现严格单目标等价（[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L1344-L1409)） | seedStr=cacheKey（隐式：由 payload 传入） |
| A5. 工程效率评分（覆盖率主导 + N/CV/短面惩罚） | `EFF_SCORE_WEIGHTS_V2` + `computeEfficiencyScoreV2*`（[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L170-L241)） | smart-efficiency worker 输出 `efficiencyScoreDetail`（[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L3221-L3244)） | `wN=0.20,wCV=10,wShort=5,minLRef=100` |
| A6. 条带求交→区间求交→矩形构造（含 failTypes） | `pickBandMaxInterval/getIntervalsAt` 与 `bumpFail('BAND_NO_FEASIBLE_*')`（[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L1200-L1455)） | smart-efficiency compute 主流程（responseBase/attemptSummary）（[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L1879-L1998)） | insideEps、sampleCount 等为内部派生（见实现锚点） |
| A7. smart-efficiency 覆盖率阈值 qualified + fallback warning | `COVERAGE_MIN=0.70`（[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L1879-L1881)） | 返回体 `warning` / `top1.qualified`（[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L3278-L3330)） | 覆盖阈值 0.70 |
| A8. smart-efficiency：ws 采样 + (ws,N) 上的 B 两阶段搜索（coarse + fine） | wsSamples（disturbance/exact 走 1m 枚举；balanced 走 coarse 采样）与 Bsearch 参数（`B_COARSE_STEP/B_FINE_HALFWIN/DO_FINE` 等）（[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L2260-L2415)）+ 主循环（按 ws→N→coarseBs→TopM seeds→fineBs 精修，并累加 `coarseEvaluatedBCount/fineEvaluatedBCount/seedBs`）（[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L2860-L3035)） | UI 默认 `searchProfile: 'balanced'` 且显式走 worker compute payload（[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L4157-L4229)） | balanced 默认 coarseStep=10m + fineWin=12；exact coarseStep=1m 且 DO_FINE 关闭（见实现锚点） |
| B1. smart-resource 协议冻结：ThicknessGrid 语义与 axis 不影响厚度坐标系 | `SMART_RESOURCE_VERSION` 注释与约束（[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L800-L816)） | UI 构造 thickness.fieldPack/gridRes（[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L4685-L4775)） | `gridRes=20`（UI） |
| B2. 厚度采样器（field / constant / none） | `buildThicknessSampler`（[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L828-L962)） | worker 内吨位积分 `integrateTonnageForLoop` 调用 `sampler.sampleAt`（[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L964-L1043)） | constantM 仅应急；rho 默认 1 |
| B3. 吨位网格积分（loop 内点判定 + 厚度采样） | `integrateTonnageForLoop`（[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L964-L1043)） | smart-resource 启用 `tonnageObjectiveEnabled` 重排 topK（[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L4860-L4947)） | `tonnageSampleStepM` 默认 fast:40/full:30（worker） |
| B4. per-face trapezoid 枚举与硬阈值 r_min | `PER_FACE_DELTA_SET`、`PER_FACE_IN_RATIO_MIN=0.7`（[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L3032-L3100)） | UI 明确开启 perFaceTrapezoid + delta 集合（[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L4629-L4678)） | `perFaceAdjMaxStepDeg=4`、`perFaceInRatioTry=0.5`（UI） |
| B5. fullCover / ignoreCoalPillarsInCoverage / patch 预算 | `FULL_COVER_MIN=0.995`、`FULL_COVER_PATCH_BUDGET_MS`（[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L2555-L2563)） | UI payload 指定 fullCoverPatchMaxTimeMs=3000（[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L4708-L4716)） | 默认 fullCoverMin=0.995 |
| B6. 工程化全覆盖：segmentWidth + cleanupResidual 参数解析 | `SEG_*`/`CLEAN_*` 从 payload 读取（[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L4949-L5034)） | UI payload 提供 segmentWidth/cleanupResidual（[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L4726-L4769)） | CLEAN_BUDGET_MS 默认 1500（worker）/ UI 给 3000 |
| B7. cleanupResidual：生成“清扫后候选”并插入 Top1 | `tryCleanupResidual()`：计算 union/residual、挑面替换变宽、可选新增短面、比较 coverage/residual 改善，生成候选并挂 `cleanupResidual` 摘要（[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L5034-L5480)） | `const improved = tryCleanupResidual(); if (improved) candidates = [improved, ...candidates].slice(0,wantK)`（[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L5471-L5520)） | CLEAN_MAX_REPL=2、CLEAN_MAX_FACES=5、CLEAN_ALLOW_ADD 等（见实现锚点；UI 也可覆写） |
| B8. fullCoverPatch：Top3 lazy patch + renderPatched 输出 | Top3 LIGHT 档调用 `patchCandidateFullCover` 并写回 `renderPatched/fullCoverAchieved_patched/metrics.patchStats`（[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L6529-L6638)）+ `patchCandidateFullCover` 实现（[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L7427-L7700)） | UI 传入 `fullCoverPatchMaxTimeMs: 3000`、`ignoreCoalPillarsInCoverage: true`（[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L4700-L4756)） | worker 默认 patchMaxTimeMs=1200；UI 将其提高到 3000 |
| C1. weighted：候选池拼接 + qualified 优先、否则回退 unqualified | pool_qualified / fallback_unqualified（[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L1450-L1516)） | UI 直接调用 `/planning/smart-weighted/compute` 并在 NO_CANDIDATES 时拼接子结果摘要（[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L14280-L14333)） | `topK` 默认 60（UI） |
| C2. weighted：RecoveryScore 统一口径（后端 tonnage endpoint） | `smart_resource_tonnage(...)` + `recoveryScoreBySignature`（[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L1588-L1627)） | `/planning/smart-resource/tonnage`（[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L2513-L2815)） | wT=0.55,wC=0.30,wE=0.15（tonnage endpoint） |
| C3. weighted：NSGA-II TopK 选择（非支配排序 + 拥挤距离） | `_select_topk_nsga`（[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L567-L615)） | `smart_weighted_compute` 调用（[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L1680-L1708)） | `selection.method='nsga2-select'`（返回体 derived） |
| C4. weighted：返回 pack（best/table/effResult/recResult/distResult/stats） | `out = { ... }`（[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L1750-L1808)） | UI 默认联动展示 Top1（[mining-plan/frontend/src/App.jsx](mining-plan/frontend/src/App.jsx#L14348-L14373)） | weightsUsed / nodeElapsedMs / tonnageElapsedMs 等 |

---

## 6. 输出结构（对 UI 可用字段的“证据锚点式”摘要）

### 6.1 smart-efficiency result（Worker 回包）

- 顶层字段：`bestKey/selectedCandidateKey/N/B/wb/ws/coverageRatio/efficiencyScore/byN/stats/candidates/table`（实现锚点：[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L3238-L3338)）。
- `stats`：包含 `candidateCount/topK/qualifiedCount/usedFallback` 等（实现锚点：[mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js](mining-plan/frontend/src/planning/workers/smartEfficiency.worker.js#L3290-L3321)）。

### 6.2 smart-resource result（Worker 回包）

- `responseBase` 约定：`tonnageTotal` 顶层字段必须存在（前端硬校验）+ `attemptSummary`（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L2566-L2603)）。
- 候选 `candidate` 的 `qualified`：`overlapOk && rminOk`（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L3770-L3816)）。
- 工程化增强字段：
  - cleanupResidual 成功时会产生一个额外 candidate，并携带 `candidate.cleanupResidual` / `candidate.metrics.cleanupResidual`（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L5420-L5480)）。
  - fullCoverPatch 为 Top3 写回 `candidate.renderPatched`、`candidate.fullCoverAchieved_patched`、`candidate.metrics.patchStats`、`candidate.metrics.patchBudgetMs`（实现锚点：[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L6529-L6638)，[mining-plan/frontend/src/planning/workers/smartResource.worker.js](mining-plan/frontend/src/planning/workers/smartResource.worker.js#L7606-L7685)）。

### 6.3 smart-weighted result（后端回包）

- `best`：`{signature, source}`；`table.rows`：包含 `effScore/recScore/distPoints/.../totalScore/paretoRank/crowding`（实现锚点：[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L1710-L1808)）。
- 嵌入原始子结果：`effResult/recResult/distResult`，用于 UI 联动展示（实现锚点：[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L1777-L1806)）。

---

## 7. 验证与一致性检查（L2 comparator）

- 后端提供 `/planning/l2/compare` 与 `/planning/l2/compare-batch`：对比 baseline/candidate loops 的几何差异（对称差面积比、out-of-baseline 面积、bbox/centroid 偏移等），用于“迁移/重构时的视觉一致性”验收（实现锚点：[mining-plan/backend_python/routers/planning.py](mining-plan/backend_python/routers/planning.py#L820-L1158)）。

---

## 8. 附：离线复现实用脚本（仓库内已有）

- `frontend/tools/run-smart-resource.mjs`：从 boundary CSV 构造 payload 并直接调用 worker `compute`（实现锚点：[mining-plan/frontend/tools/run-smart-resource.mjs](mining-plan/frontend/tools/run-smart-resource.mjs#L1-L140)）。

---

## 9. 待补齐（明确未完成的证据点）

> 以下内容在本轮收集里只定位到“入口/阈值/关键片段”，但还缺少更细粒度的函数级锚点，后续可以继续补。

- 本文件已补齐 smart-efficiency 的 ws 采样 + B 两阶段搜索主循环，以及 smart-resource 的 cleanupResidual 与 fullCoverPatch（含写回字段与插入排序位置）的函数级锚点。
- 若要把“全仓论文版”一次性补齐，还需要把 legacy Node/Express（[mining-plan/backend/](mining-plan/backend/)）与 Python FastAPI（[mining-plan/backend_python/](mining-plan/backend_python/)）的功能对照表、以及 smart-weighted 之外的其它算法模块（如地质建模/GNN/强化学习）也按同样“双锚点”口径整理成总表。
