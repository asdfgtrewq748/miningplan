# Figure Manifest

说明：本清单仅用于作者手动插图；生成过程未修改论文DOCX。本轮在已安装 scientific-visualization 技能的出版图规范基础上，结合《煤炭科学技术》同类论文图面习惯，统一设置中文宋体、英文Times New Roman字体族。

## Fig06
- 图号建议：图06 / Fig06
- 中文图名：原始边界到有效布置域演化图
- 英文图名：Evolution from the original boundary to the effective layout domain
- 生成方式：根据现有边界和论文明确约束参数重画，已按期刊图风格重导出
- 输出文件：Fig06_boundary_to_effective_domain.png；Fig06_boundary_to_effective_domain.svg；Fig06_boundary_to_effective_domain.pdf
- 数据/来源路径：D:\xiangmu\miningplan\论文\重构工作区\05_支撑材料\接口结果\边界数据.json；D:\xiangmu\miningplan\论文\重构工作区\05_支撑材料\接口结果\采区设计结果.json；D:\xiangmu\miningplan\煤科投稿\00_过程文档\当前论文文本抽取.md
- 是否为结果图或示意图：方法示意图；几何内缩结果图
- 推荐插入位置：1.2 有效布置域与连续参数场构建，式(6)之后
- 图注建议：图示原始采区边界经边界煤柱30 m内缩、区段煤柱20 m叠加约束后形成有效布置域。项目内未发现独立保护对象坐标，故未绘制额外局部保护对象裁剪。
- 作者手动插入时的注意事项：适合通栏；建议保留a/b/c/d四个子图。

## Fig07
- 图号建议：图07 / Fig07
- 中文图名：连续参数场构建流程图
- 英文图名：Workflow for constructing the continuous parameter field
- 生成方式：根据现有钻孔、边界和论文公式重画，已按期刊图风格重导出
- 输出文件：Fig07_continuous_parameter_field_workflow.png；Fig07_continuous_parameter_field_workflow.svg；Fig07_continuous_parameter_field_workflow.pdf
- 数据/来源路径：D:\xiangmu\miningplan\论文\重构工作区\05_支撑材料\接口结果\钻孔数据.json；D:\xiangmu\miningplan\论文\重构工作区\05_支撑材料\接口结果\边界数据.json；D:\xiangmu\miningplan\论文\重构工作区\05_支撑材料\接口结果\地质建模结果.json；D:\xiangmu\miningplan\煤科投稿\00_过程文档\当前论文文本抽取.md
- 是否为结果图或示意图：过程图；方法示意与数据重画结合
- 推荐插入位置：2.2 连续参数场构建结果，图2之前或之后
- 图注建议：插值采用论文式(7)明确的反距离加权思想，p=2；用于展示离散样点到连续场的构建流程。
- 作者手动插入时的注意事项：适合通栏；建议作为过程图，不替代已有普通煤厚场图。

## Fig08
- 图号建议：图08 / Fig08
- 中文图名：ODI扰动场分布与上行专项权重代理场
- 英文图名：Spatial ODI disturbance fields and upward-mining special-weight proxy field
- 生成方式：根据项目导出的ODI评价点重画；上行开采面板采用已核实的上行专项权重情景代理场
- 输出文件：Fig08_odi_component_fields.png；Fig08_odi_component_fields.svg；Fig08_odi_component_fields.pdf
- 数据/来源路径：D:\xiangmu\miningplan\data\export_package\0-地表下沉.miningplan\地表下沉\ODI评价点.csv；D:\xiangmu\miningplan\data\export_package\2-含水层扰动评价.miningplan\含水层扰动\ODI评价点.csv；D:\xiangmu\miningplan\data\export_package\5-采掘接续.miningplan\含水层扰动\ODI评价点.csv；D:\xiangmu\miningplan\docs\plans\coal_sci_third_round_logic_closure_log_20260418.md
- 是否为结果图或示意图：结果图与代理场说明图；面板(c)不是独立实测上行开采分量场
- 推荐插入位置：2.3 多场景ODI风险表征结果，综合ODI图之后
- 图注建议：图示地表沉陷、含水层扰动及上行专项权重情景下的ODI空间分布。由于项目未导出独立上行开采评价点，面板(c)仅作为专项权重代理场，不能表述为独立实测分量。
- 作者手动插入时的注意事项：适合通栏；需在图题或图注中明确(c)为上行专项权重代理场，不是独立实测分量。

## Fig09
- 图号建议：图09 / Fig09
- 中文图名：候选方案生成与筛选流程图
- 英文图名：Workflow of candidate generation and filtering
- 生成方式：根据现有算法逻辑和候选表统计重画；本轮按PPT流程图风格单独重绘
- 输出文件：Fig09_candidate_generation_filtering_flow.png；Fig09_candidate_generation_filtering_flow.svg；Fig09_candidate_generation_filtering_flow.pdf
- 数据/来源路径：export_scene_visuals.py；D:\xiangmu\miningplan\output\scene_visual_exports\20260416_201037\05_mining_succession\overview\planning_efficiency_table.csv；D:\xiangmu\miningplan\output\scene_visual_exports\20260416_201037\05_mining_succession\overview\planning_recovery_table.csv；D:\xiangmu\miningplan\output\scene_visual_exports\20260416_201037\05_mining_succession\overview\planning_disturbance_table.csv；D:\xiangmu\miningplan\output\scene_visual_exports\20260416_201037\05_mining_succession\overview\planning_weighted_table.csv；D:\xiangmu\miningplan\docs\plans\coal_sci_abc_odi_unified_stats_20260418.csv
- 是否为结果图或示意图：方法示意图
- 推荐插入位置：1.3 候选方案生成与多目标协同规划模型之后
- 图注建议：图中候选数仅采用已保存表格行数；未把未保存的内存候选过程扩写为结果。
- 作者手动插入时的注意事项：适合通栏；本轮已按PPT绘图风格重画。

## Fig10
- 图号建议：图10 / Fig10
- 中文图名：A/B/C三方案多指标对比图
- 英文图名：Multi-indicator comparison among schemes A, B and C
- 生成方式：根据现有统计表重画，已按期刊图风格重导出
- 输出文件：Fig10_abc_multi_indicator_comparison.png；Fig10_abc_multi_indicator_comparison.svg；Fig10_abc_multi_indicator_comparison.pdf
- 数据/来源路径：D:\xiangmu\miningplan\docs\plans\coal_sci_abc_odi_unified_stats_20260418.csv；D:\xiangmu\miningplan\docs\plans\coal_sci_odi_sensitivity_summary_20260418.md
- 是否为结果图或示意图：结果图
- 推荐插入位置：3.1 结构化规划结果或3.2方案统计段之后
- 图注建议：仅绘制统计表中可核实的覆盖率、ODI均值、P90、ODI>0.70比例和风险得分；未补造缺失的资源回收指标。
- 作者手动插入时的注意事项：适合通栏；建议与A/B/C方案叠置图或统计表相邻。

## Fig11
- 图号建议：图11 / Fig11
- 中文图名：阈值敏感性分析图
- 英文图名：Threshold sensitivity analysis
- 生成方式：根据现有阈值敏感性表重画，已按期刊图风格重导出
- 输出文件：Fig11_threshold_sensitivity.png；Fig11_threshold_sensitivity.svg；Fig11_threshold_sensitivity.pdf
- 数据/来源路径：D:\xiangmu\miningplan\docs\plans\coal_sci_threshold_sensitivity_candidates_20260418.csv；D:\xiangmu\miningplan\docs\plans\coal_sci_odi_sensitivity_summary_20260418.md
- 是否为结果图或示意图：结果图
- 推荐插入位置：4.3 后续深化方向或3.2风险统计后
- 图注建议：阈值点为0.65、0.70、0.75、0.80，全部来自项目CSV。
- 作者手动插入时的注意事项：单栏或通栏均可；若正文不展开敏感性，可作为补充图。

## Fig12
- 图号建议：图12 / Fig12
- 中文图名：权重敏感性分析图
- 英文图名：Weight sensitivity analysis
- 生成方式：根据现有权重敏感性表重画，已按期刊图风格重导出
- 输出文件：Fig12_weight_sensitivity.png；Fig12_weight_sensitivity.svg；Fig12_weight_sensitivity.pdf
- 数据/来源路径：D:\xiangmu\miningplan\docs\plans\coal_sci_weight_sensitivity_candidates_20260418.csv；D:\xiangmu\miningplan\docs\plans\coal_sci_odi_sensitivity_summary_20260418.md
- 是否为结果图或示意图：结果图
- 推荐插入位置：4.3 后续深化方向或3.2风险统计后
- 图注建议：情景名称按CSV中的case_id和权重值整理；项目表中该行名为aquifer_special，但权重为wf=0.60，图中按权重解释为上行专项，建议作者复核原始命名。
- 作者手动插入时的注意事项：适合通栏；需说明风险得分越低越好。

## Fig13
- 图号建议：图13 / Fig13
- 中文图名：地表沉陷ODI预测-实测验证图
- 英文图名：Measured versus predicted ODI validation for surface subsidence
- 生成方式：根据项目已有Case 0地表沉陷预测-实测配对误差数据重画
- 输出文件：Fig13_odi_measured_predicted_validation.png；Fig13_odi_measured_predicted_validation.svg；Fig13_odi_measured_predicted_validation.pdf
- 数据/来源路径：D:\xiangmu\miningplan\mining-plan\frontend\dist\demo\0-地表下沉.miningplan.json；D:\xiangmu\miningplan\data\export_package\0-地表下沉.miningplan\地表下沉\实测数据.csv；D:\xiangmu\miningplan\data\output\supplementary_figures\figS2_measured_vs_predicted.png；generate_supplementary_figures.py
- 是否为结果图或示意图：模型验证结果图；不是煤厚插值留一交叉验证图
- 推荐插入位置：2.3 或3.2模型验证与风险统计说明之后；也可作为补充图
- 图注建议：图示三条实测测线的归一化实测值与预测ODI之间的对应关系，并给出1:1参考线、线性拟合线和R²。该图验证的是地表沉陷ODI预测-实测一致性，不应写作煤厚插值精度验证。
- 作者手动插入时的注意事项：适合通栏或半通栏；请勿标注为煤厚插值留一交叉验证图。

## Fig14
- 图号建议：图14 / Fig14
- 中文图名：规划结果传递示意图
- 英文图名：Schematic chain of planning-result transfer
- 生成方式：根据论文方法文字重画；本轮按PPT流程图风格单独重绘
- 输出文件：Fig14_planning_result_transfer_chain.png；Fig14_planning_result_transfer_chain.svg；Fig14_planning_result_transfer_chain.pdf
- 数据/来源路径：D:\xiangmu\miningplan\煤科投稿\00_过程文档\当前论文文本抽取.md；D:\xiangmu\miningplan\论文\重构工作区\05_支撑材料\接口结果\采区设计结果.json
- 是否为结果图或示意图：方法示意图
- 推荐插入位置：1.4 方案传递与评价流程之后，或3.2开头
- 图注建议：仅表达对象传递关系，不绘制未独立导出的经济结果。
- 作者手动插入时的注意事项：适合通栏；本轮已按PPT绘图风格重画，明确为方法示意图。
