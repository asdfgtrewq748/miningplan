$ErrorActionPreference = "Stop"
$docx = "E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx"
$formula = "Ω_e=Conn_max{[Ω_0⊖𝔅(B_b)]⊖𝔅(B_s)⊖𝔅(D_p)}"
$newText = "式中，Ω_0为原始采区边界，B_b为边界煤柱宽度，B_s为区段煤柱宽度，D_p为局部保护距离，𝔅(·)为按给定距离生成的缓冲内缩算子，Conn_max(·)表示保留面积最大的主连通区域，Ω_e为经约束内缩和几何合法性处理后的有效布置域。若内缩后出现多连通域或局部狭长畸变，则优先保留主连通区域，并在不突破安全煤柱底线的前提下采用降级内缩策略，以保证后续工作面布置具有几何可解性。"
$word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc = $null
foreach ($d in $word.Documents) {
    if ($d.FullName -eq $docx) { $doc = $d; break }
}
if ($null -eq $doc) { throw "Target document not open in Word" }

$changedFormula = $false
for ($i = 1; $i -le $doc.Tables.Count; $i++) {
    $tbl = $doc.Tables.Item($i)
    if ($tbl.Rows.Count -eq 1 -and $tbl.Columns.Count -eq 3) {
        $num = $tbl.Cell(1,3).Range.Text.Trim([char]7, [char]13, [char]32)
        if ($num -match "6") {
            $range = $tbl.Cell(1,2).Range
            $range.End = $range.End - 1
            $range.Text = $formula
            $range = $tbl.Cell(1,2).Range
            $range.End = $range.End - 1
            try {
                $null = $doc.OMaths.Add($range)
                $range.OMaths.Item(1).BuildUp()
            } catch {
                Write-Output ("BuildUpFailed=" + $_.Exception.Message)
            }
            $range.Font.Name = "Cambria Math"
            $range.Font.Size = 10.5
            $range.ParagraphFormat.Alignment = 1
            $changedFormula = $true
            break
        }
    }
}
if (-not $changedFormula) { throw "Equation (6) table not found" }

$changedPara = $false
for ($i = 1; $i -le $doc.Paragraphs.Count; $i++) {
    $p = $doc.Paragraphs.Item($i)
    $txt = $p.Range.Text.Trim()
    if ($txt.StartsWith("式中，Ω_0为原始采区边界")) {
        $p.Range.Text = $newText + "`r"
        $p.Range.Font.Size = 10.5
        $changedPara = $true
        break
    }
}
if (-not $changedPara) { throw "Explanation paragraph not found" }
$doc.Save()
[PSCustomObject]@{ChangedFormula=$changedFormula; ChangedParagraph=$changedPara; Saved=$doc.Saved} | ConvertTo-Json -Compress
