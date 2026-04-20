$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
# find D_a(x)
foreach($p in $doc.Paragraphs){ $txt=($p.Range.Text -replace "[`r`n`t]","").Trim(); if($txt -like '*D_a*'){ $r=$p.Range.Duplicate; $r.Find.Text='D_a(x)'; $r.Find.Wrap=0; if($r.Find.Execute()){ $obj=$doc.OMaths.Add($r); Write-Output "Type=$($obj.GetType().FullName)"; $obj | Get-Member | Select-Object -First 20 | Out-String | Write-Output; Write-Output "OMaths in range=$($r.OMaths.Count) doc count=$($doc.OMaths.Count)"; if($r.OMaths.Count -gt 0){ $o=$r.OMaths.Item(1); Write-Output "item type=$($o.GetType().FullName)"; $o | Get-Member | Select-Object -First 20 | Out-String | Write-Output; try{$o.BuildUp()|Out-Null; Write-Output 'buildup ok'}catch{Write-Output "buildup err $($_.Exception.Message)"} }; $doc.Save(); break }} }
