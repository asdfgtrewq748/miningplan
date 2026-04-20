$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
foreach($p in $doc.Paragraphs){ $txt=($p.Range.Text -replace "[`r`n`t]","").Trim(); if($txt -like '*D_u*'){ $r=$p.Range.Duplicate; $r.Find.Text='D_u(x)'; $r.Find.Wrap=0; if($r.Find.Execute()){ Write-Output "found [$($r.Text)] OMath=$($r.OMaths.Count)" }; break }}
