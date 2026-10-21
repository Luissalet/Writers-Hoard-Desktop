# Voice memos inside documents and reading files

An inserted voice memo now shows its existing player and transcript directly in
the editor. The player uses the effective Base or named-era recording. Editing a
transcript uses the normal revision check and changes the media record, leaving
the containing prose and other eras intact. Ordinary audio/video keeps its native
player. No transcription job starts merely by opening a document.

ReadingView, standalone Reader files and offline wikis show a readonly transcript
beside the recording. Segment times seek the audio. Word buttons seek and play
their original audio interval; playback highlights the active word. Edited
segments show the edited text and a separate disclosure labelled as original
audio anchors, so corrected words are not given invented timings.

The reading surface offers the original audio plus TXT, SRT and WebVTT downloads.
These use the authored transcript and original recording bytes. The exported HTML
contains the admitted data and its playback code; it needs no Writer database,
bridge, model service or network. Excluded or foreign media contributes no audio,
transcript or download. Frozen published editions retain their captured transcript
after the original is changed.

Existing voice operations and `wh_reader_export`/`wh_wiki_export` use these same
services. The recognition model and its accuracy are unchanged. Word highlighting
follows the recogniser's original timings, including after a transcript correction.
