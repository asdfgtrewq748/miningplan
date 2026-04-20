$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
$token='D_u(x)'
foreach($p in $doc.Paragraphs){
  $clean=(($p.Range.Text -replace "[`r`n`t]","").Trim())
  if($clean.Contains($token)){
    Write-Output "contains: $clean"
    $search=$p.Range.Duplicate
    $search.Find.ClearFormatting(); $search.Find.Text=$token; $search.Find.Wrap=0; $search.Find.MatchCase=$true; $search.Find.MatchWholeWord=$false; $search.Find.MatchWildcards=$false
    $ok=$search.Find.Execute()
    Write-Output "execute=$ok found=[$($search.Text)] om=$($search.OMaths.Count)"
    if($ok -and $search.OMaths.Count -eq 0){$added=$doc.OMaths.Add($search); $math=$added.OMaths.Item(1); $math.BuildUp()|Out-Null; Write-Output "converted count=$($doc.OMaths.Count)"; $doc.Save()}
    break
  }
}
