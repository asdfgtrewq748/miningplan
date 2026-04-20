$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$target=[System.IO.Path]::GetFullPath('E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx')
foreach($d in @($word.Documents)){
  if([System.IO.Path]::GetFullPath($d.FullName) -ieq $target){
    $d.Save()
    $saveChanges = [ref](-1)
    $originalFormat = [ref](0)
    $route = [ref]($false)
    $d.Close($saveChanges,$originalFormat,$route)
    Write-Output 'closed'
    break
  }
}
