param(
    [string]$DocPath = "E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx"
)

$ErrorActionPreference = "Stop"
$wdFindStop = 0

$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
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

$tokens = @(
    "n_π(ODI(x)>T_ODI)",
    "α+β+γ=1",
    "A_i∩A_j=∅",
    "0.45+0.55(·)",
    "Conn_max(·)",
    "ODI>0.70",
    "ODI(x)>T_ODI",
    "X_i,min",
    "X_i,max",
    "X_i'(x)",
    "D_s(x)",
    "D_a(x)",
    "D_u(x)",
    "ODI(x)",
    "E_π(T_ODI)",
    "Q_0.90",
    "T_ODI",
    "E_0.70",
    "A_π",
    "N_π",
    "n_π",
    "z(x)",
    "z_i",
    "d_i(x)",
    "Π_all",
    "Π_e",
    "Π_r",
    "Π_m",
    "W_f",
    "B_b",
    "B_s",
    "D_p",
    "L_π",
    "R_π",
    "y_π",
    "A_i",
    "A_j",
    "C_L",
    "I_ODI",
    "C_cov",
    "P_N",
    "CV_L",
    "P_short",
    "R_ton",
    "R_area",
    "S_eng",
    "H_m",
    "S_m",
    "S_e",
    "S_r",
    "F(π)",
    "G(s)",
    "P_s",
    "R_s",
    "C_s",
    "Rev_t",
    "Cost_t",
    "RiskCost_t",
    "NCF_t",
    "π_i",
    "π_j",
    "λ_e",
    "λ_r",
    "λ_m",
    "c_1/c_2/c_3",
    "c_1",
    "c_2",
    "c_3",
    "h_min",
    "h_max",
    "h_avg",
    "A_0",
    "L_f",
    "L_a,check",
    "w_s/w_a/w_u",
    "w_t/w_c/w_e",
    "w_s",
    "w_a",
    "w_u",
    "w_t",
    "w_c",
    "w_e",
    "N_e/N_r",
    "N_m,low",
    "N_m",
    "N_e",
    "N_r",
    "𝔅(·)",
    "Ω_0",
    "Ω_e",
    "X_i(x)",
    "Θ",
    "θ",
    "Π",
    "π",
    "Ω",
    "α",
    "β",
    "γ"
) | Sort-Object Length -Descending -Unique

$before = $doc.OMaths.Count
$converted = 0
$inRefs = $false

foreach ($p in $doc.Paragraphs) {
    $clean = (($p.Range.Text -replace "[`r`n`t]", "").Trim())
    if ($clean -eq "参考文献") { $inRefs = $true }
    if ($inRefs) { break }
    if ([string]::IsNullOrWhiteSpace($clean)) { continue }
    if ($clean -match "^\[\d+\]") { continue }

    foreach ($token in $tokens) {
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
            if ($found.OMaths.Count -eq 0) {
                try {
                    $addedRange = $doc.OMaths.Add($found)
                    $math = $addedRange.OMaths.Item(1)
                    $math.BuildUp() | Out-Null
                    $math.Range.Font.Name = "Cambria Math"
                    $math.Range.Font.NameAscii = "Cambria Math"
                    $math.Range.Font.NameOther = "Cambria Math"
                    $math.Range.Font.Size = 10.5
                    $converted += 1
                    $search.Start = $math.Range.End
                }
                catch {
                    $search.Start = $found.End
                }
            }
            else {
                try { $found.OMaths.Item(1).BuildUp() | Out-Null } catch {}
                $search.Start = $found.End
            }
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

$total = $doc.OMaths.Count
for ($i = 1; $i -le $total; $i++) {
    try { $doc.OMaths.Item($i).BuildUp() | Out-Null } catch {}
}

$doc.Save()

[PSCustomObject]@{
    Document = $doc.FullName
    OMathBefore = $before
    OMathAfter = $doc.OMaths.Count
    ConvertedInlineItems = $converted
} | Format-List

