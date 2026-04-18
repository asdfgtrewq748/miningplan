$ErrorActionPreference = "Stop"
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
    Write-Output "WordVersion=$($word.Version)"
    Write-Output "AddIns:"
    foreach ($addin in $word.AddIns) {
        if ($addin.Name -match "MathType|WordCmds") {
            Write-Output ("- Name={0}; Installed={1}; Path={2}" -f $addin.Name, $addin.Installed, $addin.Path)
        }
    }
    Write-Output "Templates:"
    foreach ($template in $word.Templates) {
        if ($template.Name -match "MathType|WordCmds") {
            Write-Output ("- Name={0}; FullName={1}" -f $template.Name, $template.FullName)
        }
    }
    Write-Output "CommandBars:"
    foreach ($bar in $word.CommandBars) {
        if ($bar.Name -match "MathType|Equation") {
            Write-Output ("- Bar={0}; Controls={1}" -f $bar.Name, $bar.Controls.Count)
            $count = 0
            foreach ($control in $bar.Controls) {
                if ($count -lt 30) {
                    Write-Output ("  * Caption={0}; Id={1}; OnAction={2}" -f $control.Caption, $control.Id, $control.OnAction)
                    $count += 1
                }
            }
        }
    }
    try {
        Write-Output "VBComponents:"
        foreach ($template in $word.Templates) {
            if ($template.Name -match "MathType") {
                foreach ($component in $template.VBProject.VBComponents) {
                    Write-Output ("- Component={0}; Type={1}" -f $component.Name, $component.Type)
                }
            }
        }
    } catch {
        Write-Output "VBComponentsError=$($_.Exception.Message)"
    }
} finally {
    $word.Quit()
}
