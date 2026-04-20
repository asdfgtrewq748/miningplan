try {
  $word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
  foreach($d in @($word.Documents)){ Write-Output "doc=$($d.FullName) saved=$($d.Saved)"; $d.Save(); $d.Close([ref](-1)) | Out-Null }
  $word.Quit() | Out-Null
  Write-Output 'word-saved-quit'
} catch { Write-Output ('COM quit failed: '+$_.Exception.Message) }
