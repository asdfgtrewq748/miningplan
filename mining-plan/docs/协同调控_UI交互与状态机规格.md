# 协同调控：UI/交互草图级规格（字段表 + 状态机）

日期：2026-01-26

> 范围约束：本规格只覆盖“输出一张 ODI 空间分布图（统一标尺 ODI*）”的 UI 与交互；不引入推进速度；推进顺序以离散工作面序号表达；统一标尺采用联合分位数 P5/P95，联合样本集包含地质-only。

## 1. UI 放置与信息架构

### 1.1 放置位置
- 右侧 Accordion 结构中新增一个 Section：**“协同调控”**。
- 建议插入位置：
  1) “覆岩扰动综合评价（Summary）”
  2) “采区参数编辑器（Planning）”
  3) **“协同调控（新增）”**
  4) “采掘接续计划 / 接续优化（若存在）”
  5) “系统日志 / 调试（若存在）”

### 1.2 面板目标（用户视角）
- 我只想要一张图：**ODI*（统一标尺）**的空间分布图。
- 我需要能明确看到：
  - 标尺是否已计算（q5/q95、样本量、是否包含地质-only）
  - 当前选的推进阶段（N 段中的第 k 段）
  - 当前图层确实用的是 ODI* 而不是本次 min-max

## 2. 面板布局草图（自上而下）

1) **运行摘要条（只读）**
- 状态徽章：`未就绪 / 输入已变更 / 计算中 / 已就绪 / 失败`
- 小字：`标尺: P5/P95 + 含地质-only`、`阶段: k/N`、`样本: |S_geo| + |S_plan|`

2) **A. 标尺与样本集（Scale）**
- 目的：定义 ODI* 的统一映射口径与可解释输出。

3) **B. 推进阶段（Stage）**
- 目的：用离散工作面序号实现“动态快照”，但保证所有阶段共用同一标尺。

4) **C. 计算与输出（Actions）**
- 目的：一键或分步计算，输出最终 ODI* 图。

5) **D. 诊断/缓存（Debug，默认折叠）**
- 目的：让调试/复现容易：显示 cacheKey、输入签名、最近一次计算耗时。

## 3. 字段表（UI 控件级）

> 说明：默认值按你已确认的口径设置；即便 UI 允许修改，也应当提供“恢复默认口径”按钮。

### 3.1 A. 标尺与样本集（Scale）

| 字段 | 控件 | 默认 | 说明 | 影响的缓存键 / Dirty 规则 |
|---|---|---:|---|---|
| 启用协同调控标尺 | Switch | 开 | 开启后，主图 ODI 色标固定使用 ODI*（P5/P95 联合标尺） | 改动 => `scaleDirty=true` + `mapDirty=true` |
| 分位数下界 | Number(0~0.2) | 0.05 | 低端分位数 $q_5$；建议提供“高级设置”，默认锁定 0.05 | 改动 => `scaleDirty` |
| 分位数上界 | Number(0.8~1) | 0.95 | 高端分位数 $q_{95}$；默认锁定 0.95 | 改动 => `scaleDirty` |
| 纳入地质-only | Checkbox | 勾选 | 已确认“包含地质-only”；UI 可展示但建议默认不可关闭（或关闭需二次确认） | 改动 => `scaleDirty` |
| 标尺统计（只读） | Text | — | 显示：q5/q95、|S_geo|、|S_plan|、计算时间、用的样本来源 | 不触发计算 |

**输入门禁（Scale 可计算的前置条件）**
- 至少具备：
  - `S_geo`：最近一次“地质插值提取”的评价点集（geo-only）
  - `S_plan`：最近一次“全参插值提取”的评价点集（full/high-precision）
- 如果缺任何一个，按钮置灰并给提示：
  - “请先完成：地质插值提取 + 全参插值提取（任意顺序）”

> 现状注意：当前实现只有一个 `paramExtractionResult`，且 `geo` 与 `full` 会互相覆盖。为落地本面板，建议在实现时将其拆成 `paramExtractionGeoResult` 与 `paramExtractionFullResult`（或按 mode 进缓存 Map）。

### 3.2 B. 推进阶段（Stage）

| 字段 | 控件 | 默认 | 说明 | 影响的缓存键 / Dirty 规则 |
|---|---|---:|---|---|
| 段数 N | Number(1~20) | 5 | 用户可配置推进阶段数 | 改动 => `stageDirty=true`（通常不必重算标尺，但会影响要展示的“当前段 ODI_plan^(k)”） |
| 当前段 k | Slider(1..N) / Stepper | 1 | 当前查看第 k 段快照 | 只影响显示；若采用“按段计算 ODI_plan^(k)”则触发 `mapDirty` |
| 工作面序号映射（只读/可选编辑） | Table | 自动 | 显示：faceNo -> 所属段；默认均分或按边界规则分配 | 改动（若支持手动编辑）=> `stageDirty=true` |

**阶段映射默认规则（建议）**
- 已知工作面数量为 `W`（来自工作面数据/生成点结果）。
- 默认把工作面序号均分到 N 段：
  - 第 k 段包含 faceNo 范围：
    $$[\lfloor (k-1)\cdot W/N \rfloor+1,\ \lfloor k\cdot W/N \rfloor]$$
- 如果 W 很小（例如 W < N），UI 自动把 N 限制到 W。

### 3.3 C. 计算与输出（Actions）

| 动作 | 位置 | 前置条件 | 结果 | 是否写入缓存 |
|---|---|---|---|---|
| 计算/更新统一标尺 | Scale 区 | 同时有 S_geo + S_plan | 产生 `odiScalePack={q5,q95,counts,signature}` | 是（按输入签名） |
| 生成 ODI*（当前段） | Actions 区 | 有 `odiScalePack` + 有对应段的 ODI_raw 点 | 产生 `odiStarPoints`（每点带 `odiStar`） | 是（按 stageKey） |
| 生成最终 ODI* 图 | Actions 区 | 有 `odiStarPoints` | 产生 `odiStarFieldPack`（插值网格）并在主图显示 | 可选 |
| 一键更新（推荐） | 面板顶部 | 能跑就跑（能到哪算到哪） | 自动串联：标尺 -> ODI* -> 场 | 可选 |
| 导出（CSV/PNG） | Actions 区 | 对应结果存在 | 导出 `odiScalePack`、`odiStarPoints`、最终图 | 否 |

### 3.4 D. 诊断/缓存（Debug，折叠）

| 字段 | 说明 |
|---|---|
| scaleKey | 由“场景 + 煤层 + 数据签名 + (P5,P95) + includeGeoOnly”生成 |
| stageKey | 由“scaleKey + N + k + 阶段映射签名”生成 |
| dirty flags | `scaleDirty / stageDirty / mapDirty` |
| last durations | 标尺计算耗时、ODI* 计算耗时、插值耗时 |

## 4. 状态机（输入/计算/缓存/输出）

> 这里给一个“可实现”的状态机骨架，落地时可以用 `useReducer` 或“多个 useState + 派生 selector”实现。

### 4.1 核心状态集合

- `IDLE`：未具备必要输入（未导入数据或未生成评价点）。
- `INPUT_READY`：输入齐全但尚未生成（或结果已被清空）。
- `GEO_READY`：地质插值提取完成，得到 `S_geo`。
- `PLAN_READY`：全参插值提取完成，得到 `S_plan`（或按段得到 `S_plan^(k)`）。
- `SCALE_READY`：统一标尺已计算，得到 `odiScalePack`（q5/q95 等）。
- `ODI_STAR_READY`：已把某段/某方案的 ODI_raw 映射成 `ODI*` 点集。
- `FIELD_READY`：已插值得到 ODI* 场，并在主图显示。
- `ERROR`：任一步计算失败（保留错误信息与可重试动作）。

### 4.2 事件与转移（简化版）

- `IMPORT_DATA / CHANGE_SCENARIO / CHANGE_COAL / CHANGE_BOUNDARY / CHANGE_BOREHOLES`
  - 任意发生 => 进入 `INPUT_READY`，并置 `scaleDirty=true, mapDirty=true`。

- `EXTRACT_GEO_OK` => `GEO_READY`（若已 `PLAN_READY` 可保持两者并存）。
- `EXTRACT_PLAN_OK` => `PLAN_READY`。

- `COMPUTE_SCALE_START` => 进入“计算中”子状态（可用 `busy.scale=true` 表达）。
- `COMPUTE_SCALE_OK` => `SCALE_READY`，清 `scaleDirty`。

- `COMPUTE_ODI_STAR_OK` => `ODI_STAR_READY`。
- `BUILD_FIELD_OK` => `FIELD_READY`，清 `mapDirty`。

- `ANY_FAIL(err)` => `ERROR`（保留 `err.step` 与 `err.message`），提供 Retry。

### 4.3 Dirty/Cache 的原则

- `scaleDirty` 触发条件（任一变更都应让标尺失效）：
  - P5/P95、includeGeoOnly
  - S_geo 或 S_plan 的输入签名变化（导入数据、煤层选择、评价点生成规则变化、参数提取参数变化等）

- `mapDirty` 触发条件：
  - `scaleDirty==true`
  - 当前段 k / 段数 N / 阶段映射变化（若采用“按段重算 ODI_plan^(k)”）
  - 插值配置变化（平滑 passes、网格分辨率等）

- 缓存优先级：
  - 命中 `odiScaleCache[scaleKey]` 时可直接复用标尺
  - 命中 `odiStarCache[stageKey]` 时可直接复用 ODI* 点
  - 命中 `odiFieldCache[stageKey+vizCfgKey]` 时可直接复用 ODI* 场

## 5. 与现有 UI/逻辑的对齐点（实现时最省改动的路线）

1) 现有 Summary 已提供两个入口：
- “地质插值提取”（geo-only）
- “全参插值提取”（full/high-precision）

协同调控面板只需要把两者结果“同时保留”并联合作为标尺样本集即可。

2) 现有 ODI 可视化与扰动规划依赖 `odiFieldPack`。
- 协同调控启用时，建议新增 `odiStarFieldPack` 并作为主图/扰动采样的默认输入（或通过一个 selector 统一输出 `activeOdiFieldPack`）。

3) 现有规划扰动门禁：要求 ODI 场 ready。
- 未来如果扰动规划要基于统一标尺，应让门禁检查 `activeOdiFieldPack`（优先 ODI*）。

## 6. 最小可交互验收点（无需实现协同优化算法）

- 能在面板中看到：`q5/q95`、`|S_geo|、|S_plan|`。
- 切换 k/N 时：主图 ODI* 色标不变（仍是 0~1），图面变化可解释。
- 任意修改会把状态显示为“输入已变更/需更新”，并能一键恢复到“已就绪”。
