param(
    [Parameter(Mandatory=$true)][string]$DocxPath
)

$ErrorActionPreference = "Stop"

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
    $doc = $word.Documents.Open($DocxPath, $false, $false)
    try {
        $count = [Math]::Min(15, $doc.OMaths.Count)
        for ($i = 1; $i -le $count; $i++) {
            $omath = $doc.OMaths.Item($i)
            $omath.Range.Font.Size = 10.5
            $omath.Range.Font.Name = "Cambria Math"
            $omath.Range.ParagraphFormat.Alignment = 1  # wdAlignParagraphCenter
            $omath.Range.ParagraphFormat.SpaceBefore = 0
            $omath.Range.ParagraphFormat.SpaceAfter = 0
            $omath.Range.ParagraphFormat.LineSpacingRule = 0 # wdLineSpaceSingle
        }

        $tableCount = [Math]::Min(15, $doc.Tables.Count)
        for ($i = 1; $i -le $tableCount; $i++) {
            $tbl = $doc.Tables.Item($i)
            $tbl.AllowAutoFit = $false
            $tbl.Range.Font.Size = 10.5
            $tbl.Range.ParagraphFormat.SpaceBefore = 0
            $tbl.Range.ParagraphFormat.SpaceAfter = 0
            $tbl.Range.ParagraphFormat.LineSpacingRule = 0
            $tbl.Rows.Alignment = 1 # wdAlignRowCenter
            $tbl.Columns.Item(1).PreferredWidthType = 3 # wdPreferredWidthPoints
            $tbl.Columns.Item(1).PreferredWidth = 28
            $tbl.Columns.Item(2).PreferredWidthType = 3
            $tbl.Columns.Item(2).PreferredWidth = 415
            $tbl.Columns.Item(3).PreferredWidthType = 3
            $tbl.Columns.Item(3).PreferredWidth = 52
            $tbl.Cell(1,2).Range.ParagraphFormat.Alignment = 1
            $tbl.Cell(1,3).Range.ParagraphFormat.Alignment = 2 # wdAlignParagraphRight
            $tbl.Cell(1,3).Range.Font.Size = 10.5
        }

        $doc.Save()
        Write-Output "normalized_omath=$count"
    }
    finally {
        $doc.Close($true)
    }
}
finally {
    $word.Quit()
}
