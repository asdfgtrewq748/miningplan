$word=New-Object -ComObject Word.Application
$word.Visible=$false
$doc=$word.Documents.Open('E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx')
$out='E:\xiangmu\miningplan\tmp\docs\reordered_refs_preview_20260419.pdf'
if(Test-Path $out){Remove-Item $out -Force}
$doc.ExportAsFixedFormat($out,17)
$doc.Save()
$doc.Close([ref](-1)) | Out-Null
$word.Quit() | Out-Null
Write-Output $out
