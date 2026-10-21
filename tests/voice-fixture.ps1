param([Parameter(Mandatory=$true)][string]$OutputPath)
# Synthetic fixture: SAPI writes to a file stream; never the microphone or speakers.
$voice = New-Object -ComObject SAPI.SpVoice
$voices = $voice.GetVoices()
for ($index=0; $index -lt $voices.Count; $index++) {
  if ($voices.Item($index).GetDescription() -match 'David|Zira|English') { $voice.Voice=$voices.Item($index); break }
}
$stream = New-Object -ComObject SAPI.SpFileStream
$stream.Format.Type = 22
$stream.Open($OutputPath, 3, $false)
try {
  $voice.AudioOutputStream = $stream
  $voice.Rate = -1
  [void]$voice.Speak('Ada and Borges are waiting near the old library. The weather is sunny and the story begins.', 0)
} finally { $stream.Close() }
