param([Parameter(Mandatory=$true)][string]$Tgz)
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop'
Set-Location $root
& tar -xzf $Tgz
if ($LASTEXITCODE -ne 0) { Write-Output "EXTRACT FAILED $LASTEXITCODE"; exit 1 }
Write-Output "EXTRACT OK $Tgz"
& git status --porcelain | Select-Object -First 40
