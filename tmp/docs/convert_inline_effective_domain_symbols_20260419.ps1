$ErrorActionPreference = "Stop"
$docx = "E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx"
$tokens = @("Conn_max(·)", "Ω_0", "Ω_e", "B_b", "B_s", "D_p", "𝔅(·)")
$openedHere = $false
try {
    $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
} catch {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
}
$doc = $null
foreach ($d in $word.Documents) {
    if ($d.FullName -eq $docx) { $doc = $d; break }
}
if ($null -eq $doc) {
    $doc = $word.Documents.Open($docx, $false, $false, $false)
    $openedHere = $true
}

$converted = 0
$failed = @()
$targetStarts = @(
    "设原始采区边界为",
    "式中，Ω_0为原始采区边界"
)

for ($pi = 1; $pi -le $doc.Paragraphs.Count; $pi++) {
    $p = $doc.Paragraphs.Item($pi)
    $plain = $p.Range.Text.Trim()
    $isTarget = $false
    foreach ($s in $targetStarts) {
        if ($plain.StartsWith($s)) { $isTarget = $true; break }
    }
    if (-not $isTarget) { continue }

    foreach ($token in $tokens) {
        # Repeatedly find token in this paragraph and convert the found range to inline OMath.
        $search = $p.Range.Duplicate
        $search.End = $search.End - 1
        while ($true) {
            $find = $search.Find
            $find.ClearFormatting() | Out-Null
            $find.Text = $token
            $find.Forward = $true
            $find.Wrap = 0
            $ok = $find.Execute()
            if (-not $ok) { break }
            $found = $search.Duplicate
            try {
                $null = $doc.OMaths.Add($found)
                $found.OMaths.Item(1).BuildUp()
                $found.Font.Name = "Cambria Math"
                $found.Font.Size = 10.5
                $converted += 1
            } catch {
                $failed += ("p{0}:{1}:{2}" -f $pi, $token, $_.Exception.Message)
                $found.Font.Name = "Cambria Math"
                $found.Font.Size = 10.5
            }
            $newStart = $found.End
            if ($newStart -ge ($p.Range.End - 1)) { break }
            $search = $doc.Range($newStart, $p.Range.End - 1)
        }
    }
}
$doc.Save()
if ($openedHere) {
    $doc.Close($false)
    $word.Quit()
}
[PSCustomObject]@{Converted=$converted; Failed=$failed.Count; FailedItems=$failed} | ConvertTo-Json -Compress
