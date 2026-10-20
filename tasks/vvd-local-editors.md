# Local authoring, media and reader workflows

User request: investigate VVD deeply, preserve Writer's identity, and implement the useful workflows that can run locally. This document records the root-owned implementation; sibling `vvd-*.md` documents cover maps, graphs, trees, calendars, drafts, RPG, radar, archive, tool blocks and the split workspace.

## Dictionary and tables

`src/engines/dictionary` adds multiple project languages, editable script mappings and word anatomy (native spelling, pronunciation, class, meaning, examples, phrases, derivatives and origin). Search covers all of those fields. The dictionary can decorate manuscript words transiently with a gloss and local navigation. Fonts and script presets are documented separately in `vvd-dictionary-scripts.md`. Portable JSON validates file size, shape and records before changing project data. Forms retain cancelled/failed drafts in the existing local journal; explicit discard is available. Per-field comparisons merge independent edits and reject overlapping changes while preserving the draft. No online translation or generated linguistic claim is involved.

`src/engines/tables` adds typed text/numeric/reference/checkbox tables and sheets. Codex tables edit the actual cards through the existing three-way save path. Columns can be renamed, reordered and resized; rows support filtering, sorting and grouping. CSV import/export uses an explicit parser, size limits and spreadsheet-injection protection. Sheets evaluate arithmetic, ranges and SUM/AVERAGE/MIN/MAX/COUNT/ABS/ROUND through a bounded parser with dependency/cycle handling; no JavaScript evaluation. Cell edits use the existing debounced pending-write infrastructure and stable row/column identities.

Verified in `vvd-dictionary.browser.tsx` (6 groups), `vvd-tables.browser.tsx` (5), `inline-mentions.browser.ts` (2), and `dictionary-scripts.browser.tsx` (5), plus existing reference regressions. The common indexed mention matcher is shared with the Codex graph and generated wiki links.

## Local sound and video

`src/engines/media` stores real binary files in `localMediaAssets`, rather than serializing their bytes into manuscript HTML. Limits are visible: 50 MB per file and 500 MB per project. Native local players support playback speed and looping; metadata includes notes/transcripts, tags and Codex references. An explicit microphone action records voice notes; no permission is requested when opening the engine. Recording cleanup stops every track, handles permission arriving after unmount, and retains failed writes. Closing/navigation flushes live recordings and preview recordings once. Tests use a synthetic recorder and silent WAV, without requesting the user's microphone.

`localMediaBlock` saves a scoped pointer and small fallback label. The editor and read-only view resolve current data from the same project. Source changes do not add edits to the manuscript. Audio/video Blob URLs, playback and subscriptions are released on close. JSON clones include the actual admitted bytes and remap pointers. ZIP uses binary entries and preflight validation outside the IndexedDB write transaction. A real rollback test exposed a Dexie promise-zone exhaustion bug across many backup strategies; nested transaction zones now share the outer physical transaction, preserving atomic rollback.

Verified in `vvd-media.browser.tsx` (7 groups), `media-blocks.browser.tsx` (5), and `vvd-world-portability.browser.ts` (3). Actual native WAV decoding, ZIP restore, late permission resolution, recording close/restore and project isolation are exercised.

## Reader and portable wiki

`readerPresentationTypes.ts`, `readerPresentation.ts`, the presentation modal and `ReaderBookCover` add real CSS 3D hardcover/paperback/paper geometry, local cover art, color/texture, pointer rotation and keyboard range control. Chapter presentation controls font, background, local image placement and vertical/horizontal reading. Automatic foreground selection maintains readable contrast on custom backgrounds. These project settings never modify writing content. Saves compare individual cover/chapter fields; independent changes merge and conflicts keep the open form.

`ReaderAudioSettings`, `readerSoundtrack.ts` and `ReaderSoundtrackControl` assign local audio to a chapter or exact paragraph. Two independent channels follow the visible text after an explicit reader activation, with volume and loop controls. Paragraph cues retain an index and content fingerprint: edited or displaced prose does not silently trigger the old cue. Missing/foreign files cannot resolve, and disable/unmount releases playback and URLs. This is ambience, independent of existing system text-to-speech.

`ProjectSoundtrack` provides local ambience while worldbuilding. It remains mounted across tool/pane changes, keeps the same player when its controls collapse or metadata changes, and releases playback when the source is deleted or the project closes. This is the local-file alternative to VVD's online radio stations. A dedicated real decoder/lifecycle test (`project-soundtrack.browser.tsx`) passes without autoplay or foreign titles.

`buildReaderHtml` exports a self-contained HTML reader with cover rotation, chapter presentation, page controls, opt-in soundtrack, current Codex projections and linked local media. CSP permits embedded data media and nonce-authorized local controls while refusing network connections. The serialized soundtrack runtime is actually executed in the exported test document. JSON clones remap chapter settings and both kinds of audio pointer.

`WorldWikiExport`/`WikiExportSettings` add a portable world wiki, search, categories/tags, relationships/backlinks, auto-linked aliases, maps with annotations and layers, selected raster/media, themes, layout/font/accent controls, document/field exclusion and sandboxed desktop/tablet/phone preview. Hidden text is physically removed before indexing; spoilers can be revealed. Excluded/foreign Codex labels and media bytes do not survive via cached fallbacks. Generic tool blocks add their own policy-bound projections, documented in `vvd-tool-blocks.md`.

Verified in `reader-presentation.browser.tsx` (5 groups), `reader-soundtrack.browser.tsx` (6), `wiki-export.browser.tsx` (5), `wiki-presentation.browser.tsx` (5) and shared portability tests. The wiki test opens a saved `file://` artifact with networking disabled. Current CSS screenshots cover desktop and narrow widths, including the actual integrated toolbar and the reader settings. Independent review found and fixed a settings lock after archiving a chapter: unchanged archived-chapter settings and unchanged missing audio remain recoverable without blocking unrelated cover/font edits. A real archive/restore regression proves that path.

Manual Codex text links preserve the selected prose and resolve in the correct editor pane; inserting without a selection uses the card title. Live blocks remain a separate choice. JSON cloning remaps those semantic links, the wiki turns them into local anchors, and the standalone reader supplies a bounded local reference appendix. `codex-text-links.browser.tsx` passes three groups including actual picker, custom label, activation, undo and BookDocument boundaries.

Global search and fallback anchors now discover dictionaries, tables/sheets, model assets and independent relation trees. Search only projects metadata and text from the owning project; binary model/media bytes never enter the index. `world-documents-search.browser.tsx` verifies real registered search/resolve and an actual tree deep link.

## UI integration and limits

The core formatting toolbar remains immediately visible. Advanced formatting and document references/tools use separate native disclosures, reducing the permanent toolbar height. Codex/media/tool insertion pickers begin closed. Source editors keep Writer's charcoal/gold/serif identity; the local reader has an intentional reading surface.

The local archive covers documents, not every word/pin/event deletion. Custom proprietary fonts are supplied by the author; Unicode presets are visual mappings rather than linguistic transliteration. Media uses codecs available in Electron. Paragraph audio intentionally requires reassignment when text changes. Source tool previews are bounded projections; the actual tool opens for full editing. The six RPG presets do not claim an exhaustive rules engine. These limits must remain explicit in the final comparison.

## Integrated verification

`npm run test:vvd` runs the isolated focused browser suites and records one log per suite in `work/vvd-suite`. `npm run verify:quick` covers renderer/Electron typechecks, shipping lint and conformance. `npm run test:critical` retains the existing 383 regression checks, including startup and Worldgen. Production build, bundle budget and the independent finish review are recorded in the final audit when complete.
