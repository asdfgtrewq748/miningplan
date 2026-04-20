$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
$out='E:\xiangmu\miningplan\tmp\docs\formula_visual_opt_preview_20260419.pdf'
if(Test-Path $out){Remove-Item $out -Force}
$doc.ExportAsFixedFormat($out,17)
Write-Output $out
