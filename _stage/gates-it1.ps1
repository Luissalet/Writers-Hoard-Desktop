Set-Location "C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop"
npx tsc -b --noEmit
"TSC_RENDERER_EXIT=$LASTEXITCODE"
npx tsc -p electron/tsconfig.json
"TSC_ELECTRON_EXIT=$LASTEXITCODE"
node scripts/check-lint.mjs
"LINT_EXIT=$LASTEXITCODE"
node scripts/check-conformance.mjs
"CONFORMANCE_EXIT=$LASTEXITCODE"
