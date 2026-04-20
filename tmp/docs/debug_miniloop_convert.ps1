$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
$tokens=@('D_a(x)','D_u(x)','W_f','B_b','S_e') | Sort-Object Length -Descending -Unique
$converted=0
foreach($p in $doc.Paragraphs){
  $clean=(($p.Range.Text -replace "[`r`n`t]","").Trim())
  if($clean -eq '参考文献'){break}
  foreach($token in $tokens){
    if($clean.Contains($token)){ Write-Output "contains $token" }
    $search=$p.Range.Duplicate
    $search.Find.ClearFormatting(); $search.Find.Text=$token; $search.Find.MatchCase=$true; $search.Find.MatchWholeWord=$false; $search.Find.MatchWildcards=$false; $search.Find.Wrap=0
    while($search.Find.Execute()){
      $found=$search.Duplicate
      Write-Output "found token=$token text=[$($found.Text)] om=$($found.OMaths.Count)"
      if($found.OMaths.Count -eq 0){ try{ $added=$doc.OMaths.Add($found); $math=$added.OMaths.Item(1); $math.BuildUp()|Out-Null; $converted++; $search.Start=$math.Range.End; Write-Output "converted $token" }catch{ Write-Output "err $token $($_.Exception.Message)"; $search.Start=$found.End }} else {$search.Start=$found.End}
      $search.End=$p.Range.End
      $search.Find.ClearFormatting(); $search.Find.Text=$token; $search.Find.MatchCase=$true; $search.Find.MatchWholeWord=$false; $search.Find.MatchWildcards=$false; $search.Find.Wrap=0
      if($converted -gt 5){ break }
    }
  }
  if($converted -gt 5){ break }
}
$doc.Save(); Write-Output "converted=$converted count=$($doc.OMaths.Count)"
