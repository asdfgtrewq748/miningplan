$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
$tokens=@(
'w_s/w_a/w_u','w_t/w_c/w_e','N_e/N_r','N_m,low','L_a,check','X_i(x)','X_i,min','X_i,max','T_ODI','Q_0.90','E_0.70','A_π','N_π','E_π','L_π','R_π','y_π','Π_all','C_cov','P_short','P_N','CV_L','R_ton','R_area','S_eng','H_m','S_m','S_e','S_r','C_L','I_ODI','W_f','B_b','B_s','D_p','z_i','d_i(x)','z(x)','P_s','R_s','C_s','Rev_t','Cost_t','RiskCost_t','NCF_t','π_i','π_j','λ_e','λ_r','λ_m','c_1/c_2/c_3','c_1','c_2','c_3','h_min','h_max','h_avg','A_0','L_f','N_m','N_e','N_r','Ω_e','Ω_0','Θ','θ','Π','π','Ω','α','β','γ'
) | Sort-Object Length -Descending -Unique
$converted=0
foreach($p in $doc.Paragraphs){
  $clean=(($p.Range.Text -replace "[`r`n`t]","").Trim())
  if($clean -eq '参考文献'){break}
  if([string]::IsNullOrWhiteSpace($clean)){continue}
  if($clean -match '^\[\d+\]'){continue}
  foreach($token in $tokens){
    if(-not $clean.Contains($token)){continue}
    $search=$p.Range.Duplicate
    $search.Find.ClearFormatting(); $search.Find.Text=$token; $search.Find.MatchCase=$true; $search.Find.MatchWholeWord=$false; $search.Find.MatchWildcards=$false; $search.Find.Wrap=0
    while($search.Find.Execute()){
      $found=$search.Duplicate
      if($found.Start -ge $p.Range.End){break}
      if($found.OMaths.Count -eq 0){
        try{$added=$doc.OMaths.Add($found); $math=$added.OMaths.Item(1); $math.BuildUp()|Out-Null; $math.Range.Font.Name='Cambria Math'; $math.Range.Font.Size=10.5; $converted++; $search.Start=$math.Range.End}catch{$search.Start=$found.End}
      } else { try{$found.OMaths.Item(1).BuildUp()|Out-Null}catch{}; $search.Start=$found.End }
      $search.End=$p.Range.End
      $search.Find.ClearFormatting(); $search.Find.Text=$token; $search.Find.MatchCase=$true; $search.Find.MatchWholeWord=$false; $search.Find.MatchWildcards=$false; $search.Find.Wrap=0
    }
    $clean=(($p.Range.Text -replace "[`r`n`t]","").Trim())
  }
}
for($i=1;$i -le $doc.OMaths.Count;$i++){try{$doc.OMaths.Item($i).BuildUp()|Out-Null}catch{}}
$doc.Save()
Write-Output "converted=$converted total=$($doc.OMaths.Count)"
