$root = 'C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop'
Set-Location $root
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='electron.exe'" |
  Where-Object { $_.CommandLine -like "*Writers hoard desktop*" } |
  ForEach-Object { Write-Output ("KILL {0} {1}" -f $_.ProcessId, $_.CommandLine.Substring(0,[Math]::Min(90,$_.CommandLine.Length))); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
Start-Process -FilePath 'node' -ArgumentList 'scripts/dev-desktop.mjs' -WorkingDirectory $root -WindowStyle Minimized
Write-Output 'RESTARTED'
