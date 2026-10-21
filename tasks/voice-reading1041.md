# Embedded voice transcripts —1041

## Contract before implementation

Inventory A04 identifies a concrete consumer gap: the Media engine has timed
transcripts and original-audio export, but editor media blocks and standalone
Reader/wiki show only a basic audio control. Reuse the authored transcript and
existing voice player rather than start another transcription job or model.

In editor blocks, resolve the effective Base/era asset and show the existing voice
player when it is a voice memo. Ordinary audio/video remains unchanged. Reuse its
normal edit/CAS and original download; context changes must remount playback and
invalidate earlier reads.

For reading surfaces, render a readonly transcript beside the audio: segment time
links, word seeking/highlight and edited text with original word anchors explicitly
labelled. Export TXT/SRT/VTT and the original audio locally. The HTML contains
escaped authored text and numeric timing attributes, no runtime database or
inference. A shared pure renderer/runtime serves live ReadingView and exported
Reader/wiki. Excluded, hidden or foreign media must never contribute transcript
text or downloads. Cleanup removes handlers/Blob URLs; metadata updates refresh
transcript without unnecessarily restarting audio.

## Success criteria

- [x] Base/era editor blocks show correct memo and preserve ordinary audio/video.
- [x] Normal UI transcript editing uses existing CAS, with same-scope prose unchanged.
- [x] Live ReadingView refreshes transcript and releases playback/URLs on unmount.
- [x] Fresh standalone Reader/wiki, blocked network/no DB, seek segments and words
      through pointer/keyboard; edited text preserves explicit original anchors.
- [x] TXT/SRT/VTT and original audio bytes match the source exactly.
- [x] Exclusions and foreign scope never serialize text/assets; editions stay frozen.
- [x] Desktop/narrow visual and native MCP export/voice regressions pass.

Root owns the media consumers and additive Reader/wiki rendering seams. The cover
renderer and model runtime stay unchanged. Existing voice13tools are reused; no
new tool is needed for these consumers, but normal reader/wiki MCP exports must
exercise the new readonly output.

## Verification

Functional3 groups, normal editor/ReadingView2 widths, native registered Reader/wiki Base/era exports plus fresh offline standalone runtimes pass. Four real downloads per file exactly match TXT/SRT/VTT/64,044-byte PCM WAV. Native pointer/keyboard seek edited original anchors and highlight. Source-close snapshot and immutable edition checks pass. Regressions in the combined wiki/profile/appearance transport pass (13 groups total). UI4 captures and standalone4 were inspected individually; the one material color correction makes live Reader download links inherit its reading theme. Initial insufficient CSS specificity failed an explicit theme assertion; correct specificity then passed. A failed native run caused by an unrelated active source-backup import is preserved. One test initially used a wrong publication function signature; corrected call retains the same freeze oracle. The UI select-all/text race is fixed with separate native handshakes plus input-value assertions.

Source freeze/provenance: `.impeccable/review/voice-reading1041/provenance.json`. Independent review and final aggregate/build remain root work; ASR backend/model code is unchanged.
