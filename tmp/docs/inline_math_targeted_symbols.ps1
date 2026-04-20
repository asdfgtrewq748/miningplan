$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
$tokens=@('W_f','B_b','B_s','w_s','w_a','w_u','A_π','T_ODI','Q_0.90','E_π','S_r','S_m','H_m','E_0.70')
$converted=0
foreach($tok in $tokens){
  $tokCount=0
  foreach($p in $doc.Paragraphs){
    $clean=(($p.Range.Text -replace "[`r`n`t]","").Trim())
    if($clean -eq '参考文献'){break}
    if(-not $clean.Contains($tok)){continue}
    $r=$p.Range.Duplicate
    $r.Find.ClearFormatting(); $r.Find.Text=$tok; $r.Find.Wrap=0; $r.Find.MatchCase=$true; $r.Find.MatchWholeWord=$false; $r.Find.MatchWildcards=$false
    while($r.Find.Execute()){
      $f=$r.Duplicate
      if($f.Start -ge $p.Range.End){break}
      if($f.OMaths.Count -eq 0){
        try{ $added=$doc.OMaths.Add($f); $math=$added.OMaths.Item(1); $math.BuildUp()|Out-Null; $converted++; $tokCount++; $r.Start=$math.Range.End } catch { Write-Output "err $tok $($_.Exception.Message)"; $r.Start=$f.End }
      } else { $r.Start=$f.End }
      $r.End=$p.Range.End
      $r.Find.ClearFormatting(); $r.Find.Text=$tok; $r.Find.Wrap=0; $r.Find.MatchCase=$true; $r.Find.MatchWholeWord=$false; $r.Find.MatchWildcards=$false
    }
  }
  Write-Output "$tok=$tokCount"
}
$doc.Save(); Write-Output "total added=$converted om=$($doc.OMaths.Count)"
