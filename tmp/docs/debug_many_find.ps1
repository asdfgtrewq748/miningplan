$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
foreach($tok in @('W_f','B_b','w_s','A_π','T_ODI','S_r','E_0.70')){
$foundAny=$false
foreach($p in $doc.Paragraphs){ $clean=(($p.Range.Text -replace "[`r`n`t]","").Trim()); if($clean -eq '参考文献'){break}; if($clean.Contains($tok)){ $r=$p.Range.Duplicate; $r.Find.Text=$tok; $r.Find.Wrap=0; $ok=$r.Find.Execute(); Write-Output "$tok contains paragraph; find=$ok text=[$($r.Text)] om=$($r.OMaths.Count)"; $foundAny=$true; break }}
if(-not $foundAny){Write-Output "$tok no contains"}
}
