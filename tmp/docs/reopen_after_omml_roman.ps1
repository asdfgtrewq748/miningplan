$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$target='E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx'
$doc=$word.Documents.Open($target)
$doc.Save()
Write-Output $doc.FullName
