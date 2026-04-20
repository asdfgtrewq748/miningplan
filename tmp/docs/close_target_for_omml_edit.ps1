$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$target='E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'
foreach($d in @($word.Documents)){ if([System.IO.Path]::GetFullPath($d.FullName) -ieq [System.IO.Path]::GetFullPath($target)){ $d.Save(); $d.Close(1); Write-Output 'closed-target-doc'; break }}
