param(
    [string]$DocPath = "E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx"
)

$ErrorActionPreference = "Stop"
$wdFindStop = 0
$wdUnderlineNone = 0
$wdColorAutomatic = -16777216

function Is-CitationToken {
    param([string]$Token)
    if ($Token -eq "[0,1]" -or $Token -eq "[0，1]") { return $false }
    $inner = $Token.Trim("[", "]")
    if ($inner -notmatch "^[0-9,，\-\–\—\s]+$") { return $false }
    $nums = [regex]::Matches($inner, "\d+") | ForEach-Object { [int]$_.Value }
    if ($nums.Count -eq 0) { return $false }
    if (($nums | Measure-Object -Minimum).Minimum -lt 1) { return $false }
    if (($nums | Measure-Object -Maximum).Maximum -gt 50) { return $false }
    return $true
}

function First-RefNumber {
    param([string]$Token)
    $m = [regex]::Match($Token, "\d+")
    if ($m.Success) { return [int]$m.Value }
    return $null
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Open([System.IO.Path]::GetFullPath($DocPath))

try {
    # Remove stale bookmarks and old internal hyperlinks pointing to REF_*.
    for ($i = 1; $i -le 50; $i++) {
        $name = "REF_{0:D3}" -f $i
        if ($doc.Bookmarks.Exists($name)) {
            $doc.Bookmarks.Item($name).Delete()
        }
    }

    $refStart = $null
    $refHeaderIndex = 0
    $pIndex = 0
    foreach ($p in $doc.Paragraphs) {
        $pIndex += 1
        $clean = (($p.Range.Text -replace "[`r`n`t]", "").Trim())
        if ($clean -eq "参考文献") {
            $refStart = $p.Range.Start
            $refHeaderIndex = $pIndex
            break
        }
    }
    if ($null -eq $refStart) {
        throw "Reference heading not found."
    }

    $bookmarksAdded = 0
    $refsFound = @{}
    $pIndex = 0
    foreach ($p in $doc.Paragraphs) {
        $pIndex += 1
        if ($pIndex -le $refHeaderIndex) { continue }
        $clean = (($p.Range.Text -replace "[`r`n`t]", "").Trim())
        $m = [regex]::Match($clean, "^\[(\d{1,2})\]")
        if ($m.Success) {
            $n = [int]$m.Groups[1].Value
            if ($n -ge 1 -and $n -le 50) {
                $name = "REF_{0:D3}" -f $n
                $r = $p.Range.Duplicate
                $r.End = $r.End - 1
                $doc.Bookmarks.Add($name, $r) | Out-Null
                $refsFound[$n] = $true
                $bookmarksAdded += 1
            }
        }
    }

    # Collect unique body citation strings before references.
    $citationTokens = @{}
    foreach ($p in $doc.Paragraphs) {
        if ($p.Range.Start -ge $refStart) { break }
        $clean = (($p.Range.Text -replace "[`r`n`t]", "").Trim())
        foreach ($m in [regex]::Matches($clean, "\[[0-9,，\-\–\—\s]+\]")) {
            $token = $m.Value
            if (Is-CitationToken $token) {
                $first = First-RefNumber $token
                if ($null -ne $first -and $refsFound.ContainsKey($first)) {
                    $citationTokens[$token] = $first
                }
            }
        }
    }

    $linksAdded = 0
    foreach ($entry in $citationTokens.GetEnumerator()) {
        $token = [string]$entry.Key
        $first = [int]$entry.Value
        $bookmarkName = "REF_{0:D3}" -f $first

        $search = $doc.Range(0, $refStart)
        $search.Find.ClearFormatting()
        $search.Find.Text = $token
        $search.Find.MatchCase = $true
        $search.Find.MatchWholeWord = $false
        $search.Find.MatchWildcards = $false
        $search.Find.Wrap = $wdFindStop

        while ($search.Find.Execute()) {
            $found = $search.Duplicate
            if ($found.Start -ge $refStart) { break }
            # Add an internal hyperlink to the first reference in the token. This keeps
            # ranges such as [1-3,26-32] visually intact while making the marker jumpable.
            $doc.Hyperlinks.Add($found, "", $bookmarkName) | Out-Null
            $found.Font.Superscript = $true
            $found.Font.Size = 9
            $found.Font.Underline = $wdUnderlineNone
            $found.Font.Color = $wdColorAutomatic
            $linksAdded += 1

            $search.Start = $found.End
            $search.End = $refStart
            $search.Find.ClearFormatting()
            $search.Find.Text = $token
            $search.Find.MatchCase = $true
            $search.Find.MatchWholeWord = $false
            $search.Find.MatchWildcards = $false
            $search.Find.Wrap = $wdFindStop
        }
    }

    $doc.Save()

    [PSCustomObject]@{
        Document = $doc.FullName
        ReferenceBookmarks = $bookmarksAdded
        UniqueBodyCitationTokens = $citationTokens.Keys.Count
        BodyCitationHyperlinks = $linksAdded
    } | Format-List
}
finally {
    $doc.Close([ref](-1)) | Out-Null
    $word.Quit() | Out-Null
}


