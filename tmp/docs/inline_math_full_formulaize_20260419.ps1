param(
    [string]$DocPath = "E:\xiangmu\miningplan\煤科投稿\最新版论文4.18.docx"
)

$ErrorActionPreference = "Stop"

$wdFindStop = 0
$wdWithInTable = 12

function Get-ActiveWordDocument {
    param([string]$Path)

    $word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
    $full = [System.IO.Path]::GetFullPath($Path)
    foreach ($d in $word.Documents) {
        if ([string]::Equals([System.IO.Path]::GetFullPath($d.FullName), $full, [System.StringComparison]::OrdinalIgnoreCase)) {
            return @($word, $d)
        }
    }
    $opened = $word.Documents.Open($full)
    return @($word, $opened)
}

function Convert-PlainTokenToOMath {
    param(
        [Parameter(Mandatory=$true)]$Document,
        [Parameter(Mandatory=$true)]$ContainerRange,
        [Parameter(Mandatory=$true)][string]$Token
    )

    $converted = 0
    $search = $ContainerRange.Duplicate
    $search.Find.ClearFormatting()
    $search.Find.Text = $Token
    $search.Find.MatchCase = $true
    $search.Find.MatchWholeWord = $false
    $search.Find.MatchWildcards = $false
    $search.Find.Wrap = $wdFindStop

    while ($search.Find.Execute()) {
        if ($search.Start -ge $ContainerRange.End) { break }

        $found = $search.Duplicate
        if ($found.OMaths.Count -eq 0) {
            try {
                $addedRange = $Document.OMaths.Add($found)
                $math = $addedRange.OMaths.Item(1)
                $null = $math.BuildUp()
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
            $search.Start = $found.End
        }
        $search.End = $ContainerRange.End
        $search.Find.ClearFormatting()
        $search.Find.Text = $Token
        $search.Find.MatchCase = $true
        $search.Find.MatchWholeWord = $false
        $search.Find.MatchWildcards = $false
        $search.Find.Wrap = $wdFindStop
    }

    return $converted
}

$items = Get-ActiveWordDocument -Path $DocPath
$word = $items[0]
$doc = $items[1]

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
    "a_1",
    "a_2",
    "a_3",
    "a_4",
    "b_1",
    "b_2",
    "b_3",
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

$beforeOMath = $doc.OMaths.Count
$convertedTotal = 0
$paragraphsTouched = New-Object 'System.Collections.Generic.HashSet[int]'
$tokensTouched = New-Object 'System.Collections.Generic.Dictionary[string,int]'

$inRefs = $false
$pIndex = 0
foreach ($p in $doc.Paragraphs) {
    $pIndex += 1
    $text = $p.Range.Text
    $clean = ($text -replace "[`r`n`t]", "").Trim()
    if ($clean -eq "参考文献") {
        $inRefs = $true
    }
    if ($inRefs) { break }
    if ([string]::IsNullOrWhiteSpace($clean)) { continue }
    if ($clean -match "^\[\d+\]") { continue }

    # Keep standalone numbered formula tables intact. Their expressions are already OMML.
    if (($p.Range.Information($wdWithInTable)) -and ($clean -match "^\(?\d+\)?$")) { continue }

    foreach ($token in $tokens) {
        if ($clean.Contains($token)) {
            $n = Convert-PlainTokenToOMath -Document $doc -ContainerRange $p.Range -Token $token
            if ($n -gt 0) {
                $convertedTotal += $n
                $null = $paragraphsTouched.Add($pIndex)
                if ($tokensTouched.ContainsKey($token)) {
                    $tokensTouched[$token] += $n
                }
                else {
                    $tokensTouched.Add($token, $n)
                }
                $text = $p.Range.Text
                $clean = ($text -replace "[`r`n`t]", "").Trim()
            }
        }
    }
}

$omathCount = $doc.OMaths.Count
for ($i = 1; $i -le $omathCount; $i++) {
    try {
        $doc.OMaths.Item($i).BuildUp() | Out-Null
    }
    catch {
    }
}

$doc.Save()
$afterOMath = $doc.OMaths.Count

[PSCustomObject]@{
    Document = $doc.FullName
    OMathBefore = $beforeOMath
    OMathAfter = $afterOMath
    ConvertedInlineItems = $convertedTotal
    TouchedParagraphs = $paragraphsTouched.Count
    TouchedTokens = ($tokensTouched.Keys.Count)
} | Format-List

"TOKENS:"
$tokensTouched.GetEnumerator() | Sort-Object Name | ForEach-Object { "{0}`t{1}" -f $_.Key, $_.Value }



