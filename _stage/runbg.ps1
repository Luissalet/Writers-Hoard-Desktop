param([Parameter(Mandatory=$true)][string]$Script, [string]$Out = 'runbg.log')
$root = 'C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop'
$outPath = Join-Path $root $Out
$errPath = Join-Path $root ($Out + '.err')
Remove-Item $outPath, $errPath -ErrorAction SilentlyContinue
$runner = Join-Path $root '_stage\runfile.ps1'
$argList = @('-NoProfile','-ExecutionPolicy','Bypass','-File', "`"$runner`"", "`"$Script`"")
Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -RedirectStandardOutput $outPath -RedirectStandardError $errPath -WindowStyle Hidden
Write-Output ("STARTED -> " + $outPath)
