$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
$i=0
foreach($p in $doc.Paragraphs){ $i++; $clean=(($p.Range.Text -replace "[`r`n`t]","").Trim()); if($i -eq 27){ Write-Output "P27=$clean"; foreach($tok in @('D_u(x)','D_s(x)','Ω')){ Write-Output "$tok contains=$($clean.Contains($tok))" }; break}}
