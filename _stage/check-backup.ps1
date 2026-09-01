$dir = Join-Path $env:APPDATA 'writers-hoard\backups'
if (Test-Path $dir) {
  Get-ChildItem $dir | Select-Object Name,Length,LastWriteTime | Format-Table -AutoSize | Out-String -Width 200
} else {
  Write-Output "NO BACKUP DIR: $dir"
}
