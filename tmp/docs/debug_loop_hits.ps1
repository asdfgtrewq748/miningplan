$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
foreach($d in $word.Documents){ if($d.FullName -eq 'E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'){ $doc=$d }}
$tokens=@('D_u(x)','Ω','W_f')
$pIndex=0; $inRefs=$false; $hits=0
foreach($p in $doc.Paragraphs){
  $pIndex++
  $clean=(($p.Range.Text -replace "[`r`n`t]","").Trim())
  if($clean -eq '参考文献'){Write-Output "ref at $pIndex"; $inRefs=$true}
  if($inRefs){break}
  foreach($token in $tokens){ if($clean.Contains($token)){ Write-Output "hit p=$pIndex tok=$token text=$clean"; $hits++ } }
}
Write-Output "hits=$hits"
