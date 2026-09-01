Set-Location 'C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop'
$s = git status --porcelain -- src electron tests scripts
Write-Output ("modified=" + (@($s | Where-Object { $_ -like ' M*' })).Count)
Write-Output ("untracked=" + (@($s | Where-Object { $_ -like '??*' })).Count)
Write-Output "--- new files ---"
$s | Where-Object { $_ -like '??*' } | ForEach-Object { $_.Substring(3) }
