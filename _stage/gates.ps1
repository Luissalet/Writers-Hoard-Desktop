$ErrorActionPreference = 'Continue'
Set-Location 'C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop'
npx tsc -b --noEmit
Write-Output ("TSC_RENDERER_EXIT=" + $LASTEXITCODE)
npx tsc -p electron/tsconfig.json
Write-Output ("TSC_ELECTRON_EXIT=" + $LASTEXITCODE)
node scripts/check-lint.mjs
Write-Output ("LINT_EXIT=" + $LASTEXITCODE)
node scripts/check-conformance.mjs
Write-Output ("CONF_EXIT=" + $LASTEXITCODE)
Write-Output "GATES_DONE"
