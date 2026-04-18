param(
    [Parameter(Mandatory = $true)]
    [string]$DocxPath
)

$ErrorActionPreference = "Stop"

$resolved = Resolve-Path -LiteralPath $DocxPath
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

$converted = 0
$failed = 0

try {
    $doc = $word.Documents.Open($resolved.Path, $false, $false)
    try {
        for ($idx = $doc.Tables.Count; $idx -ge 1; $idx -= 1) {
            $table = $doc.Tables.Item($idx)
            if ($table.Rows.Count -ne 1 -or $table.Columns.Count -ne 3) {
                continue
            }

            $numText = $table.Cell(1, 3).Range.Text
            if ($numText -notmatch "[0-9]+") {
                continue
            }

            $range = $table.Cell(1, 2).Range
            $range.End = $range.End - 1
            $text = $range.Text.Trim()
            if ($text.Length -eq 0) {
                continue
            }

            try {
                $null = $doc.OMaths.Add($range)
                $range.OMaths.Item(1).BuildUp()
                $converted += 1
            }
            catch {
                $failed += 1
                Write-Output ("ConvertError table={0} num={1} err={2}" -f $table.Index, $numText.Trim(), $_.Exception.Message)
            }
        }

        $doc.Save()
    }
    finally {
        $doc.Close($false)
    }
}
finally {
    $word.Quit()
}

Write-Output ("ConvertedOMath={0}" -f $converted)
Write-Output ("FailedOMath={0}" -f $failed)
