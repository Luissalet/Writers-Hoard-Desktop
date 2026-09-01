$dir = Join-Path $env:APPDATA 'writers-hoard\backups'
Write-Output ("DIR: " + $dir + "  exists=" + (Test-Path $dir))
if (Test-Path $dir) {
  Get-ChildItem $dir | Sort-Object LastWriteTime -Descending | Select-Object -First 6 |
    ForEach-Object { Write-Output ("  " + $_.LastWriteTime.ToString('HH:mm:ss') + "  " + [math]::Round($_.Length/1KB,1) + " KB  " + $_.Name) }
}
