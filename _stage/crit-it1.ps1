Set-Location "C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop"
$env:ELECTRON_OVERRIDE_DIST_PATH = "C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop\node_modules\electron\dist"
node node_modules\electron\cli.js scripts/run-critical-tests.cjs *> _stage\crit-it1.log
"CRIT_EXIT=$LASTEXITCODE" | Out-File -Append _stage\crit-it1.log
