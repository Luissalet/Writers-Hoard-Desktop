Add-Type -AssemblyName System.IO.Compression.FileSystem
$dir = Join-Path $env:APPDATA 'writers-hoard\backups'
$file = (Get-ChildItem $dir -Filter *.zip | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
$zip = [System.IO.Compression.ZipFile]::OpenRead($file)
Write-Output ("ENTRIES: " + $zip.Entries.Count)
$zip.Entries | Select-Object -First 14 | ForEach-Object { Write-Output ("  " + $_.FullName) }
$manifest = $zip.Entries | Where-Object { $_.FullName -eq 'manifest.json' }
if ($manifest) {
  $reader = New-Object System.IO.StreamReader($manifest.Open())
  Write-Output ("MANIFEST: " + $reader.ReadToEnd().Substring(0, 260))
  $reader.Close()
} else { Write-Output 'NO MANIFEST' }
$zip.Dispose()
