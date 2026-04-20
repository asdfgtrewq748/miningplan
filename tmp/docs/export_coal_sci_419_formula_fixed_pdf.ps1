$word=New-Object -ComObject Word.Application
$word.Visible=$false
$doc=$word.Documents.Open('E:\xiangmu\miningplan\煤科投稿\煤科论文4.19.docx')
$out='E:\xiangmu\miningplan\tmp\docs\coal_sci_419_formula_fixed_preview_20260420.pdf'
if(Test-Path $out){Remove-Item $out -Force}
$doc.ExportAsFixedFormat($out,17)
$doc.Save()
$doc.Close([ref](-1)) | Out-Null
$word.Quit() | Out-Null
Write-Output $out
