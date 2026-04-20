try{
$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$target=[System.IO.Path]::GetFullPath('E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx')
foreach($d in @($word.Documents)){ if([System.IO.Path]::GetFullPath($d.FullName) -ieq $target){ $d.Save(); $d.Close([ref](-1)); Write-Output 'closed-target' }}
if($word.Documents.Count -eq 0){ $word.Quit(); Write-Output 'quit-word' }
}catch{Write-Output $_.Exception.Message}
