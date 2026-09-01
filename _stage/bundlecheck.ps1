$dirs = Get-ChildItem $env:TEMP -Directory -Filter 'writers-hoard-critical-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 2
foreach ($d in $dirs) {
  $js = Join-Path $d.FullName 'critical.js'
  Write-Output ("DIR " + $d.FullName + "  exists=" + (Test-Path $js))
  if (Test-Path $js) {
    $n = (Select-String -Path $js -Pattern 'impstage' -SimpleMatch -AllMatches | Measure-Object).Count
    Write-Output ("  impstage hits = " + $n)
    $m = (Select-String -Path $js -Pattern 'preloadArchive' -SimpleMatch -AllMatches | Measure-Object).Count
    Write-Output ("  preloadArchive hits = " + $m)
  }
}
