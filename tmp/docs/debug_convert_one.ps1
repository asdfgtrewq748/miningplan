$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
$i=0
foreach($p in $doc.Paragraphs){ $i++; $txt=($p.Range.Text -replace "[`r`n`t]","").Trim(); if($txt -like '*D_s*'){ $r=$p.Range.Duplicate; $r.Find.Text='D_s(x)'; $r.Find.MatchWildcards=$false; $r.Find.Wrap=0; if($r.Find.Execute()){ try { $m=$doc.OMaths.Add($r); $m.BuildUp() | Out-Null; Write-Output "converted, count=$($doc.OMaths.Count) text=$($m.Range.Text)"; $doc.Save() } catch { Write-Output "ERR $($_.Exception.Message)" } }; break }}
