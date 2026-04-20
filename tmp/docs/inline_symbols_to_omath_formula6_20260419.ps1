$ErrorActionPreference = "Stop"
$docx = "E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx"
$tokens = @("Conn_max(·)", "𝔅(·)", "Ω_0", "Ω_e", "B_b", "B_s", "D_p")

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
    $doc = $word.Documents.Open($docx, $false, $false)
}

$converted = @()
for ($pi = 1; $pi -le $doc.Paragraphs.Count; $pi++) {
    $p = $doc.Paragraphs.Item($pi)
    $txt = $p.Range.Text.Trim()
    $isTarget = $txt.StartsWith("设原始采区边界为") -or $txt.StartsWith("式中，Ω_0为原始采区边界")
    if (-not $isTarget) { continue }

    foreach ($tok in $tokens) {
        $search = $p.Range.Duplicate
        $search.End = $search.End - 1
        $count = 0
        while ($true) {
            $find = $search.Find
            $find.ClearFormatting()
            $find.Text = $tok
            $find.Forward = $true
            $find.Wrap = 0 # wdFindStop
            $find.MatchWildcards = $false
            $found = $find.Execute()
            if (-not $found) { break }
            $r = $search.Duplicate
            try {
                # Avoid rebuilding if the range is already inside an equation by trying conversion once only.
                $null = $doc.OMaths.Add($r)
                $r.OMaths.Item(1).BuildUp()
                $r.Font.Name = "Cambria Math"
                $r.Font.Size = 10.5
                $count += 1
            } catch {
                Write-Output ("InlineBuildUpFailed para={0} token={1} err={2}" -f $pi,$tok,$_.Exception.Message)
            }
            $search.Start = $r.End
            $search.End = $p.Range.End - 1
            if ($search.Start -ge $search.End) { break }
        }
        if ($count -gt 0) { $converted += ("p{0}:{1}x{2}" -f $pi,$tok,$count) }
    }
}
$doc.Save()
[PSCustomObject]@{Converted=$converted; Saved=$doc.Saved} | ConvertTo-Json -Compress
