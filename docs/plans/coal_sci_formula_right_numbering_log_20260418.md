# 公式右编号与 MathType/OMML 处理记录（2026-04-18）

## 工作对象

- 正式工作稿：`E:\xiangmu\miningplan\煤科投稿\最新版论文4.16_插图版_煤科格式_大修工作稿_20260418.docx`
- 公式右编号前备份：`E:\xiangmu\miningplan\煤科投稿\00_过程文档\过程备份\大修工作稿_公式右编号前备份_20260418_2050.docx`
- 表间分隔修正前备份：`E:\xiangmu\miningplan\煤科投稿\00_过程文档\过程备份\大修工作稿_公式表分隔修正前备份_20260418_2120.docx`
- PDF 预览：`E:\xiangmu\miningplan\tmp\docs\formula_right_number_render_20260418\大修工作稿_公式右编号预览_20260418_v3.pdf`

## 已完成处理

1. 已将 15 个正文主公式整理为无边框三列表格：
   - 左列为空白平衡列；
   - 中列公式居中；
   - 右列编号右对齐；
   - 编号采用（1）至（15），符合中文期刊常见右编号排版习惯。
2. 已修复相邻公式表在 Word 中被识别为同一表格的问题：
   - 第（3）式和第（4）式之间补入极小分隔段落；
   - Word 打开后可识别为 15 个独立右编号公式块。
3. 已测试 MathType/Word 公式对象方案：
   - 本机已检测到 MathType 7 和 Word MathType 模板；
   - 临时试验稿 `omath_test_prepared.docx` 可批量转为 15 个 OMML 公式对象；
   - 但复杂约束式在 Word 自动 BuildUp 后出现字号偏大、多字符下标显示不够理想等问题，因此未覆盖正式工作稿。

## 验证结果

- 公式表检查：
  - `total_tables=19`
  - `data_tables=4`
  - `formula_tables=15`
  - `formula_numbers=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15`
  - `formula_sequence_ok=True`
- 参考文献一致性检查：
  - `reference_count=50`
  - `doi_count=50`
  - `used_body_count=50`
  - `missing_in_body=[]`
  - `missing_in_refs=[]`
- 全文一致性审计：
  - `issues=0`

## 后续建议

正式投稿前若需要严格 MathType OLE 公式，可在当前右编号表格结构基础上逐式替换中列公式对象；这样右编号位置无需重做，只需处理公式本体。
