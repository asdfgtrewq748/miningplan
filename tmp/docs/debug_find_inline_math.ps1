$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
$i=0
foreach($p in $doc.Paragraphs){ $i++; $txt=($p.Range.Text -replace "[`r`n`t]","").Trim(); if($txt -like '*D_s*'){ Write-Output "P=$i TEXT=$txt"; $r=$p.Range.Duplicate; $r.Find.Text='D_s(x)'; $r.Find.MatchWildcards=$false; $r.Find.Wrap=0; $ok=$r.Find.Execute(); Write-Output "Find D_s(x)=$ok start=$($r.Start) end=$($r.End) found=[$($r.Text)] OMath=$($r.OMaths.Count)"; break }}
