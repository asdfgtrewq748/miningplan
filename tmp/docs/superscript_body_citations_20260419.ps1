param(
    [string]$DocPath = "E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx"
)

$ErrorActionPreference = "Stop"
$wdFindStop = 0

function Is-CitationToken {
    param([string]$Token)
    if ($Token -eq "[0,1]") { return $false }
    $inner = $Token.Trim("[", "]")
    if ($inner -match "^0[,，]1$") { return $false }
    if ($inner -notmatch "^[0-9,，\-\–\—\s]+$") { return $false }
    $nums = [regex]::Matches($inner, "\d+") | ForEach-Object { [int]$_.Value }
    if ($nums.Count -eq 0) { return $false }
    if (($nums | Measure-Object -Maximum).Maximum -gt 50) { return $false }
    if (($nums | Measure-Object -Minimum).Minimum -lt 1) { return $false }
    return $true
}

try {
    $word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
}
catch {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
}
$doc = $null
$full = [System.IO.Path]::GetFullPath($DocPath)
foreach ($d in $word.Documents) {
    if ([string]::Equals([System.IO.Path]::GetFullPath($d.FullName), $full, [System.StringComparison]::OrdinalIgnoreCase)) {
        $doc = $d
        break
    }
}
if ($null -eq $doc) {
    $doc = $word.Documents.Open($full)
}

$regex = [regex]"\[[0-9,，\-\–\—\s]+\]"
$converted = 0
$tokens = @{}
$inRefs = $false

foreach ($p in $doc.Paragraphs) {
    $clean = (($p.Range.Text -replace "[`r`n`t]", "").Trim())
    if ($clean -eq "参考文献") { $inRefs = $true }
    if ($inRefs) { break }
    if ([string]::IsNullOrWhiteSpace($clean)) { continue }

    $matches = $regex.Matches($clean)
    foreach ($m in $matches) {
        $token = $m.Value
        if (-not (Is-CitationToken $token)) { continue }

        $search = $p.Range.Duplicate
        $search.Find.ClearFormatting()
        $search.Find.Text = $token
        $search.Find.MatchCase = $true
        $search.Find.MatchWholeWord = $false
        $search.Find.MatchWildcards = $false
        $search.Find.Wrap = $wdFindStop

        while ($search.Find.Execute()) {
            $found = $search.Duplicate
            if ($found.Start -ge $p.Range.End) { break }
            $found.Font.Superscript = $true
            $found.Font.Size = 9
            $converted += 1
            if ($tokens.ContainsKey($token)) {
                $tokens[$token] += 1
            }
            else {
                $tokens[$token] = 1
            }
            $search.Start = $found.End
            $search.End = $p.Range.End
            $search.Find.ClearFormatting()
            $search.Find.Text = $token
            $search.Find.MatchCase = $true
            $search.Find.MatchWholeWord = $false
            $search.Find.MatchWildcards = $false
            $search.Find.Wrap = $wdFindStop
        }
    }
}

$doc.Save()

[PSCustomObject]@{
    Document = $doc.FullName
    SuperscriptedCitations = $converted
    UniqueCitationTokens = $tokens.Keys.Count
} | Format-List

"TOKENS:"
$tokens.GetEnumerator() | Sort-Object Name | ForEach-Object { "{0}`t{1}" -f $_.Key, $_.Value }


