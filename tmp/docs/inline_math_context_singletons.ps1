$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
function ConvertTokenInPara($p, [string]$tok){
  $local=0
  $r=$p.Range.Duplicate
  $r.Find.ClearFormatting(); $r.Find.Text=$tok; $r.Find.Wrap=0; $r.Find.MatchCase=$true; $r.Find.MatchWholeWord=$true; $r.Find.MatchWildcards=$false
  while($r.Find.Execute()){
    $f=$r.Duplicate
    if($f.Start -ge $p.Range.End){break}
    if($f.OMaths.Count -eq 0){try{$added=$script:doc.OMaths.Add($f); $m=$added.OMaths.Item(1); $m.BuildUp()|Out-Null; $m.Range.Font.Name='Cambria Math'; $m.Range.Font.Size=10.5; $local++; $r.Start=$m.Range.End}catch{$r.Start=$f.End}} else {$r.Start=$f.End}
    $r.End=$p.Range.End; $r.Find.ClearFormatting(); $r.Find.Text=$tok; $r.Find.Wrap=0; $r.Find.MatchCase=$true; $r.Find.MatchWholeWord=$true; $r.Find.MatchWildcards=$false
  }
  return $local
}
$converted=0
foreach($p in $doc.Paragraphs){
  $clean=(($p.Range.Text -replace "[`r`n`t]","").Trim())
  if($clean -eq '参考文献'){break}
  if($clean.Contains('P90')){$converted += ConvertTokenInPara $p 'P90'}
  if($clean.Contains('0.20N')){ $r=$p.Range.Duplicate; $r.Find.Text='0.20N'; $r.Find.Wrap=0; if($r.Find.Execute() -and $r.OMaths.Count -eq 0){$added=$doc.OMaths.Add($r); $m=$added.OMaths.Item(1); $m.BuildUp()|Out-Null; $converted++} }
  if($clean.Contains('工作面数量N') -or $clean.Contains('N为工作面数量')){$converted += ConvertTokenInPara $p 'N'}
  if($clean.Contains('距离衰减指数')){$converted += ConvertTokenInPara $p 'p'}
  if($clean.Contains('任意位置x') -or $clean.Contains('规划位置x') -or $clean.Contains('位置x与')){$converted += ConvertTokenInPara $p 'x'}
  if($clean.Contains('第i个')){$converted += ConvertTokenInPara $p 'i'}
  if($clean.Contains('第t月')){$converted += ConvertTokenInPara $p 't'}
}
for($i=1;$i -le $doc.OMaths.Count;$i++){try{$doc.OMaths.Item($i).BuildUp()|Out-Null}catch{}}
$doc.Save(); Write-Output "context converted=$converted om=$($doc.OMaths.Count)"
