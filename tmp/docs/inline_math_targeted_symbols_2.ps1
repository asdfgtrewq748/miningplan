$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
$tokens=@('X_i(x)','X_i,min','X_i,max','z_i','z(x)','d_i(x)','C_L','I_ODI','C_cov','P_N','CV_L','P_short','R_ton','R_area','S_eng','c_1/c_2/c_3','c_1','c_2','c_3','P_s','R_s','C_s','Rev_t','Cost_t','RiskCost_t','NCF_t','h_min','h_max','h_avg','A_0','L_f','N_e/N_r','N_m')
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
      if($f.OMaths.Count -eq 0){try{$added=$doc.OMaths.Add($f); $math=$added.OMaths.Item(1); $math.BuildUp()|Out-Null; $math.Range.Font.Name='Cambria Math'; $math.Range.Font.Size=10.5; $converted++; $tokCount++; $r.Start=$math.Range.End}catch{Write-Output "err $tok $($_.Exception.Message)"; $r.Start=$f.End}} else {$r.Start=$f.End}
      $r.End=$p.Range.End; $r.Find.ClearFormatting(); $r.Find.Text=$tok; $r.Find.Wrap=0; $r.Find.MatchCase=$true; $r.Find.MatchWholeWord=$false; $r.Find.MatchWildcards=$false
    }
  }
  if($tokCount -gt 0){Write-Output "$tok=$tokCount"}
}
for($i=1;$i -le $doc.OMaths.Count;$i++){try{$doc.OMaths.Item($i).BuildUp()|Out-Null}catch{}}
$doc.Save(); Write-Output "total added=$converted om=$($doc.OMaths.Count)"
