$log = 'C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop\crit.log'
$raw = Get-Content $log -Raw
if ($raw -match 'TRAIL=\[([^\]]*)\]') {
  $trail = $Matches[1] -replace "`r`n", '' -replace "`n", ''
  $parts = $trail -split ','
  Write-Output ("TRAIL steps: " + $parts.Count)
  Write-Output "--- last 30 ---"
  $parts | Select-Object -Last 30 | ForEach-Object { Write-Output ("  " + $_) }
  Write-Output "--- any NOTX ---"
  $notx = $parts | Where-Object { $_ -like '*NOTX*' }
  if ($notx) { $notx | Select-Object -First 12 | ForEach-Object { Write-Output ("  " + $_) } } else { Write-Output "  none" }
} else {
  Write-Output "no TRAIL in log"
}
if ($raw -match 'Critical tests passed: (\d+)') { Write-Output ("TOTAL: " + $Matches[1]) }
