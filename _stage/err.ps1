$log = 'C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop\crit.log'
$raw = Get-Content $log -Raw
if ($raw -match '(?s)Error: Error: (.{0,400})') { Write-Output ("ERR: " + ($Matches[1] -replace "`r`n", ' ' -replace "`n", ' ')) }
if ($raw -match 'Critical tests passed: (\d+)') { Write-Output ("TOTAL: " + $Matches[1]) }
$p = [regex]::Matches($raw, 'PASS ')
Write-Output ("PASS lines: " + $p.Count)
