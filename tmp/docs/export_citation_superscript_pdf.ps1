$word=$null
try{$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')}catch{$word=New-Object -ComObject Word.Application; $word.Visible=$false}
$target='E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'
$doc=$null
foreach($d in $word.Documents){ if([System.IO.Path]::GetFullPath($d.FullName) -ieq [System.IO.Path]::GetFullPath($target)){ $doc=$d }}
if($null -eq $doc){$doc=$word.Documents.Open($target)}
$out='E:\xiangmu\miningplan\tmp\docs\citation_superscript_preview_20260419.pdf'
if(Test-Path $out){Remove-Item $out -Force}
$doc.ExportAsFixedFormat($out,17)
$doc.Save()
Write-Output $out
