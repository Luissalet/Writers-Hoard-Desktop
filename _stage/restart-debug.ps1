$root = 'C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop'
Set-Location $root
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='electron.exe'" |
  Where-Object { $_.CommandLine -like "*Writers hoard desktop*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
$env:WH_ELECTRON_ARGS = '--remote-debugging-port=9222'
Start-Process -FilePath 'node' -ArgumentList 'scripts/dev-desktop.mjs' -WorkingDirectory $root -WindowStyle Minimized
Start-Sleep -Seconds 12
try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9222/json/version).Content } catch { "CDP not up: $_" }
