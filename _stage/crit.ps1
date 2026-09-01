Set-Location 'C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop'
$env:ELECTRON_OVERRIDE_DIST_PATH = 'C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop\node_modules\electron\dist'
node node_modules\electron\cli.js scripts/run-critical-tests.cjs 2>&1 | Out-File -Encoding utf8 crit.log
Write-Output ("CRIT_EXIT=" + $LASTEXITCODE)
Write-Output "CRIT_DONE"
