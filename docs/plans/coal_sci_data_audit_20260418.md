# 《煤炭科学技术》论文数据复核记录

创建日期：2026-04-18  
用途：为论文大修提供可复核的数据口径、候选方案证据和待补数据清单。  
对应执行稿：`docs/plans/coal_sci_revision_execution_draft_20260418.md`

## 1. 已检查的数据源

本轮重点检查了以下文件：

| 数据源 | 检查结果 |
|---|---|
| `软件案例附件/工程文件案例/3-采区规划案例.miningplan.json` | 含 `workfacePlan`、`planningResults`、`cocontrol`、`succession`；可提取候选方案和多目标排序证据 |
| `软件案例附件/工程文件案例/5-采掘接续.miningplan.json` | 含工作面规划和采掘接续数据；适合作为后续传递证据 |
| `data/export_package/*/ODI评价点.csv` | 含不同场景 ODI 点数据；可做多场景统计，但不能直接替代 4480 栅格统计 |
| `mining-plan/backend_python/routers/planning.py` | 后端多目标规划实现证据；明确含候选池、扰动统计、NSGA-II 选择 |

## 2. 关键发现

### 2.1 工程文件存在候选池与多目标排序证据

`3-采区规划案例.miningplan.json` 中 `planningResults` 包含 4 类规划模式：

| 模式 | 含义 | 候选数量/表格状态 | 可用于论文 |
|---|---|---|---|
| `efficiency` | 工程效率优先 | 保存 top 10；统计显示候选总数 2417 | 可作为方案 A |
| `recovery` | 资源回收优先 | 保存 top 10；统计显示候选总数 1149 | 可作为方案 B |
| `disturbance` | 扰动控制优先 | 保存 top 13，含 ODI 均值、P90、超限比例 | 可作为 ODI 风险优先方案 |
| `weighted` | 加权多目标 | 保存 top 10，含总分和三目标信息 | 需谨慎，top 1 为 `qualified=false` |

后端代码 `mining-plan/backend_python/routers/planning.py` 的 `smart_weighted_compute` 注释明确说明：

> Select TopK via non-dominated sorting + crowding distance (NSGA-II selection).

因此，论文可以将求解机制写为：

> 候选方案由工程效率、资源回收和扰动控制模式共同生成；对候选池进行工程约束过滤后，采用非支配排序与拥挤距离选择形成 Top-K 方案，再按综合权重排序。

注意：正文应避免把所有输出都称为“全局最优”，更稳妥的说法是“候选池排序结果”或“推荐方案”。

## 3. A/B/C 候选方案初步表

已整理到：

`docs/plans/coal_sci_abc_candidate_summary_20260418.csv`

摘要如下：

| 方案 | 方案含义 | signature | 合格性 | 工作面数 | 覆盖率/% | 工程效率评分 | 资源回收评分 | ODI均值 | ODI P90 | ODI>0.70/% | 备注 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| A | 工程效率优先 | `x|wb=50...N=5...B=308` | true | 5 | 89.3412 | 87.8180 | - | 0.4463 | 0.6407 | 0.44 | 已用统一 ODI 场补算 |
| B | 资源回收优先 | `y|wb=50...N=9...B=335` | true | 9 | 98.5184 | 98.5184 | 89.7629 | 0.4552 | 0.6462 | 0.56 | 已用统一 ODI 场补算 |
| C | 统一 ODI 筛选合格低风险候选 | `x|wb=50...N=4...B=350` | true | 4 | 80.6700 | 79.2700 | - | 0.4416 | 0.6353 | 1.22 | 当前正文 C 方案 |
| C_old | 旧 disturbance 候选 | `x|wb=80...N=13...B=100-100` | true | 13 | 75.0609 | 71.1738 | - | 0.4560 | 0.6472 | 0.80 | 旧口径候选，不作为正文 C 方案 |

## 4. 重要口径差异

当前确认版正文中出现：

- ODI 均值：0.4669；
- ODI P90：0.7474；
- ODI>0.70：15.89%；
- ODI>0.80：3.55%；
- 80×56 网格，共 4480 栅格。

后续已在 `论文/重构工作区/05_支撑材料/接口结果/000_mindong_layout_odi_field.json` 中定位 `field/gridW/gridH` 形式的高密度 ODI 场数据，并复核上述全域统计。

在早期初查中，`3-采区规划案例.miningplan.json` 的旧 disturbance 结果包含另一组方案级统计：

- ODI 均值：0.3872047855；
- ODI P90：0.7414105062；
- ODI>0.70：14.2476697736%；
- sampleCount：751；
- threshold：0.7；
- outerBufferM：30。

更新判断：

1. `0.4669/P90=0.7474/15.89%` 是研究区全域 ODI 场统计；
2. 旧 disturbance 方案不再作为正文 C 方案，统一口径下的 C 方案为 `x|wb=50...N=4...B=350`；
3. A/B/C 方案均已用同一 ODI 场重新采样统计；
4. 投稿正文仍必须明确“研究区全域 ODI 统计”和“候选方案区域 ODI 统计”的区别。

## 5. 对论文正文的直接影响

### 5.1 方法部分可以补强

可以明确写出：

- 候选池由 `efficiency`、`recovery`、`disturbance` 模式共同生成；
- 资源评分和工程效率评分在候选中已有保存；
- 扰动控制模式保存 ODI 均值、P90 和超限比例；
- 加权多目标模式使用非支配排序和拥挤距离进行 Top-K 选择。

### 5.2 结果部分需要谨慎

不能直接把 weighted top 1 当作本文最终方案，因为它的 `qualified=false`。

建议主文采用两层表达：

1. 用 A、B、C 展示工程效率、资源回收、扰动控制之间的权衡；
2. 说明 C 是统一 ODI 场下的合格低风险候选，但不是覆盖率最大方案，也不是可直接外推的真实矿井工程定案。

### 5.3 A/B/C 风险对比已补算

当前已对 A/B/C 的工作面区域重新采样同一 ODI 场，计算：

- ODI 均值；
- ODI P90；
- ODI>0.70；
- ODI>0.80。

正式结果保存至 `docs/plans/coal_sci_abc_odi_unified_stats_20260418.csv`，阈值和权重敏感性分别保存至 `coal_sci_threshold_sensitivity_candidates_20260418.csv` 和 `coal_sci_weight_sensitivity_candidates_20260418.csv`。

可行路径：

1. 从后端重跑 `planning/smart-weighted/compute` 或 disturbance 评价；
2. 将 A/B 的 candidate geometry 输入 `_compute_disturbance_for_candidates`；
3. 重新导出包含 `field/gridW/gridH` 的 ODI field pack；
4. 若高密度网格缺失，至少用已保存的 ODI 点或导出点做近似统计，但主文要说明口径。

### 5.4 本轮补算尝试记录

本轮尝试基于 `scenarioParamsById/aquifer/odiResult/points` 中的 32 个含水层 ODI 点，对 A、B、C 候选方案进行 IDW 近似采样，结果已保存至：

`docs/plans/coal_sci_abc_candidate_odi_idw_20260418.csv`

该结果不能作为正文正式对比数据，原因如下：

1. 该口径基于 32 个含水层 ODI 点重新插值，不是工程文件中 weighted/disturbance 计算时使用的完整 ODI field pack；
2. 近似补算得到的 C 方案统计与工程文件中已保存的 C 方案正式扰动统计不一致；
3. 若写入正文，会造成“同一方案存在两套 ODI 统计”的证据冲突。

因此，正文目前仍采用工程文件中已保存的 disturbance 方案统计作为已复核结果；A、B 方案 ODI 指标应等待同一 ODI 场重新导出后再正式补入。

### 5.5 统一 ODI 场复核与正式 A/B/C 对比结果

后续在支撑材料中找到完整 ODI 场文件：

`论文/重构工作区/05_支撑材料/接口结果/000_mindong_layout_odi_field.json`

该文件含 `field/gridW/gridH/bounds`，可复核正文中的 `80×56`、4480 栅格结果：

| 指标 | 结果 |
|---|---:|
| 栅格数 | 4480 |
| ODI 均值 | 0.4669 |
| ODI 中位数 | 0.4542 |
| ODI P90 | 0.7474 |
| ODI>0.70 | 15.89% |
| ODI>0.80 | 3.55% |

已基于该统一 ODI 场重新计算 A/B/C 候选方案，正式结果保存至：

- `docs/plans/coal_sci_abc_odi_unified_stats_20260418.csv`
- `docs/plans/coal_sci_threshold_sensitivity_candidates_20260418.csv`
- `docs/plans/coal_sci_weight_sensitivity_candidates_20260418.csv`
- `docs/plans/coal_sci_weight_sensitivity_field_20260418.csv`
- `docs/plans/coal_sci_odi_sensitivity_summary_20260418.md`

统一口径下的 A/B/C 结果为：

| 方案 | 含义 | 覆盖率/% | 工程效率 | 资源回收 | ODI均值 | P90 | ODI>0.70/% |
|---|---|---:|---:|---:|---:|---:|---:|
| A | 工程效率优先 | 89.34 | 87.82 | - | 0.4463 | 0.6407 | 0.44 |
| B | 资源回收优先 | 98.52 | 98.52 | 89.76 | 0.4552 | 0.6462 | 0.56 |
| C | 统一 ODI 筛选合格低风险候选 | 80.67 | 79.27 | - | 0.4416 | 0.6353 | 1.22 |

说明：旧 `disturbance` 保存结果中的 C_old 在统一 ODI 场下均值为 0.4560、P90 为 0.6472，不再作为本文统一口径下的 C 方案。正文已据此更新。

敏感性结果：

1. 阈值为 0.65/0.70/0.75/0.80 时，C 方案超限率分别为 6.31%/1.22%/0.13%/0.00%；
2. 在基准权重、各分量 ±10% 相对扰动及含水层专项权重 `0.15/0.25/0.60` 下，风险综合得分均表现为 C 最低、A 次之、B 最高。

## 6. 可直接写入正文的补充段落

### 候选方案生成机制

候选方案生成并非只输出单一布局，而是先在统一规则约束下形成候选池。工程效率模式侧重覆盖率、工作面数量和推进长度均衡性；资源回收模式侧重煤厚场和可采资源覆盖；扰动控制模式侧重 ODI 均值、P90 和超限暴露比例。各模式生成的候选方案经工作面几何、煤柱、边界和连通性约束过滤后进入统一候选池。对加权多目标情形，采用非支配排序和拥挤距离选择形成 Top-K 候选方案，再按工程效率、资源回收和扰动控制权重计算综合得分并排序。

### 方案级统计口径

需要区分研究区全域 ODI 统计与候选方案区域 ODI 统计。前者用于描述研究区扰动背景，后者用于评价某一规划方案在其实际布置区域内的风险暴露水平。本文方案级 ODI 统计以工作面布置区域为采样对象，计算 ODI 均值、90%分位数和超过阈值 0.70 的采样比例，从而将风险场转化为可参与方案比较的量化指标。

## 7. 当前计算状态

| 任务 | 目标 | 状态 |
|---|---|---|
| 复现 4480 栅格 ODI 场 | 校核正文 0.4669、0.7474、15.89%、3.55% | 已定位 `000_mindong_layout_odi_field.json` 并完成复核 |
| 计算 A/B/C 方案 ODI 统计 | 完成统一口径 A/B/C 对比实验 | 已完成，见 `coal_sci_abc_odi_unified_stats_20260418.csv` |
| 完成阈值敏感性 | 检验 0.65/0.70/0.75/0.80 阈值影响 | 已完成，见 `coal_sci_threshold_sensitivity_candidates_20260418.csv` |
| 完成权重敏感性 | 检验基准、±10%扰动和含水层专项权重影响 | 已完成，见 `coal_sci_weight_sensitivity_candidates_20260418.csv` |
| 处理旧 C1/C2 口径 | 避免把旧 `disturbance` 或不合格 `weighted` 候选写成推荐方案 | 已在正文中改为统一 ODI 场下的合格低风险 C 方案，旧候选仅作口径说明 |
| 重新组织对比表 | 把 A/B/C 与 C_old 分层呈现 | 已更新工作稿和执行稿 |
