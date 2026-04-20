try{$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application'); foreach($d in $word.Documents){ Write-Output $d.FullName }}catch{Write-Output $_.Exception.Message}
