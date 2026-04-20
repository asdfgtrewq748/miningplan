$p='E:\xiangmu\miningplan\tmp\docs\inline_math_full_formulaize_pass2_20260419.ps1'
$text=Get-Content -Path $p -Raw -Encoding UTF8
Write-Output ($text.Contains('D_u(x)'))
