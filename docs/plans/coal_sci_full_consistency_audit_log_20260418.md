# 全文一致性总审记录

- 文档: `E:\xiangmu\miningplan\煤科投稿\最新版论文4.16_插图版_煤科格式_大修工作稿_20260418.docx`
- 时间: 2026-04-18
- 目标: 检查摘要、引言、结论贡献口径，章节编号，图表题名，关键数值，旧口径残留和强结论表述。

## 本轮处理

1. 生成全文一致性总审报告，检查章节结构、图表题名、表格结构、关键数值出现情况、旧口径/风险词残留、摘要-引言-结论口径和公式段落。
2. 修正总审脚本的图表题名识别规则，避免把“图2显示”“表3列出”等正文句误识别为题名。
3. 对摘要口径进行小幅收束：
   - 中文摘要末尾由“研究结果说明”调整为“样例结果表明”。
   - 英文摘要中由 “scheme C has the lowest composite risk score” 调整为 “scheme C has a lower composite risk score than schemes A and B”。
   - 英文摘要中由 “engineering optimization under real mine conditions” 调整为 “engineering scheme selection under real mine conditions”。

## 校验结果

- 全文一致性总审: `issues=0`
- 章节结构: 0、1、1.1-1.4、2、2.1-2.3、3、3.1-3.3、4、4.1-4.3、5、参考文献均已识别
- 关键数值: 80×56、4480、0.4669、0.7474、15.89%、0.4463/0.4552/0.4416、0.6407/0.6462/0.6353、0.44%/0.56%/1.22%均已识别
- 旧口径残留: 0.3872、0.7414、14.25、911343、NPV、退修、待复核、仍需补算、qualified=false 均未检出
- 高风险强结论短语: `主要证明`、`稳定降低`、`可用于工程定案`、`对象链有效性`、`能够证明方法链`、`所证明的是` 均未检出
- 参考文献一致性: 50条参考文献全部被正文引用，正文引用均可在参考文献表中找到

## 保留说明

“普适工程常数”和“直接外推”仍在正文中出现，但均用于否定/限制语境，即说明ODI权重不是普适工程常数、单一样例阈值不能直接外推为通用工程标准，建议保留。

## 产物

- 全文一致性总审报告: `E:\xiangmu\miningplan\docs\plans\coal_sci_full_consistency_audit_20260418.md`
- 引用一致性报告: `E:\xiangmu\miningplan\docs\plans\coal_sci_in_text_reference_consistency_20260418.md`
