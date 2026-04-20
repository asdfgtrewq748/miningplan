$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
$tok='N_e'; $converted=0
foreach($p in $doc.Paragraphs){$clean=(($p.Range.Text -replace "[`r`n`t]","").Trim()); if($clean -eq '参考文献'){break}; if(-not $clean.Contains($tok)){continue}; $r=$p.Range.Duplicate; $r.Find.ClearFormatting(); $r.Find.Text=$tok; $r.Find.Wrap=0; $r.Find.MatchCase=$true; $r.Find.MatchWholeWord=$false; $r.Find.MatchWildcards=$false; while($r.Find.Execute()){ $f=$r.Duplicate; if($f.Start -ge $p.Range.End){break}; if($f.OMaths.Count -eq 0){try{$added=$doc.OMaths.Add($f); $m=$added.OMaths.Item(1); $m.BuildUp()|Out-Null; $converted++; $r.Start=$m.Range.End}catch{$r.Start=$f.End}} else {$r.Start=$f.End}; $r.End=$p.Range.End; $r.Find.ClearFormatting(); $r.Find.Text=$tok; $r.Find.Wrap=0; $r.Find.MatchCase=$true; $r.Find.MatchWholeWord=$false; $r.Find.MatchWildcards=$false }}
$doc.Save(); Write-Output "converted=$converted om=$($doc.OMaths.Count)"
