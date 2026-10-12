# Writers document engine — protocol 1

The owned executable reads UTF-8 JSON lines from stdin and flushes one JSON line to stdout per request. It uses no window or dialog. stderr is reserved for diagnostics. Electron must launch with `windowsHide: true`. The Windows binary uses the GUI subsystem to avoid creating a console. Source and Cargo dependencies are entirely inside this repository; ordinary third-party crates come from crates.io with Cargo.lock.

Request: `{ "id": 1, "action": "document.new", "args": {} }`.

Success: `{ "id": 1, "ok": true, "result": { ... } }`.

Error: `{ "id": 1, "ok": false, "error": { "code": "document_error", "message": "..." } }`.

All state is held in the process. Session IDs include a process-instance nonce; after process failure previous IDs cannot address new sessions. Caller persists document archives as needed. Unknown session IDs return an error. No implicit file writes: `document.save` requires an explicit path; exports return bytes unless a path is explicitly supplied.

File outputs use a unique temporary file beside the explicit destination, flush/sync the complete bytes, then replace the destination by rename. A failed write preserves the previous output and cleans up the owned temporary file. The executable can be terminated during generation without truncating the previous destination. Password-protected Word packages opened with a password retain it in the session for later saves/byte exports; `file.encrypt` changes or clears it, and a save's explicit password override becomes the next default only after a successful save. Results of Word open/save/byte-export report `encrypted`; passwords are never included in results. Other formats remain their ordinary unencrypted formats.

| Action | Args | Result |
|---|---|---|
| `commands` | `query?` (case-insensitive id/label/location filter) | `protocolVersion`, `totalCommands`, `commands` (id/label/location/shortcut/params/mutates/atomicBatch), `actions`, `positionUnit`, `capabilities` |
| `document.new` | `template?`, `text?`, `sessionId?` | Session metadata |
| `document.open` | `path`, `password?`, `sessionId?` | Session metadata |
| `document.openBytes` | `dataBase64`, `format`, `fileName?`, `password?`, `sessionId?` | Session metadata |
| `document.importHtml` | `html`, `assets?` map of image src to base64, `sessionId?` | Session metadata |
| `document.save` | `sessionId`, `path`, `password?` | Session metadata, path, bytes |
| `document.exportBytes` | `sessionId`, `format`, `fileName?`, `password?` | mimeType, dataBase64, fileName |
| `document.exportHtml` | `sessionId`, `includeRevisions?` (default false) | html (images embedded), assets (base64 map), includeRevisions, warnings |
| `document.inspect` | `sessionId` | Session metadata, document, assets, passthrough, selection, undoDepth |
| `document.text` | `sessionId` | text |
| `document.renderPage` | `sessionId`, `page?` (1-based, default 1), `scale?` (default 1), `includeMarkup?` (default false) | mimeType, dataBase64, width, height, pageCount, includeMarkup |
| `document.exportPdf` | `sessionId`, `includeMarkup?`, `path?` | mimeType, dataBase64 |
| `execute` | `sessionId`, `command`, `params?` | Session metadata, commandResult, uiRequests |
| `batch` | `sessionId`, `commands` array of command/params | Session metadata, results, atomic:true, uiRequests |
| `document.close` | `sessionId` | sessionId, closed:true |

Session metadata contains `sessionId`, `revision`, `dirty`, and `summary` with `pages`, `words`, `paragraphs`, `assets`. Import/open/new creates a new session when sessionId is omitted, and replaces an existing session document when supplied. Replacement is undoable. `document.new` accepts blank/sample/letter/resume/report templates. Format is selected by `format` for byte operations and by file extension for path operations. The complete native format is `writer.json`: `{format:"writers-document",version:1,document,assets,passthrough}`. Both binary maps use base64 and preserve media and retained original DOCX parts. Legacy unwrapped JSON remains readable; it cannot recover previously lost binary data.

`batch` commits the whole in-memory session clone only after every command succeeds, preserving document, selection, undo/redo, clipboard and editing state on failure. Operations with external effects (file writing, system speech, global dictionary changes) and macro/repeat dispatch run separately through `execute`; they cannot claim atomic rollback. `atomicBatch` in the catalogue reports that distinction. UI requests are data only; this headless process never opens dialogs.

Session undo has no fixed depth limit and never discards the oldest edits automatically. Closing the session releases its history; document archives persist the complete document, while undo/redo stays in the active session. Edit snapshots retain the complete shared history and restore it exactly, including after intervening undo operations.

Selection paths and offsets follow the owned document model: story plus block/table path, and UTF-8 **byte** offsets. They are not DOM UTF-16 offsets. Convert explicitly in UI adapters. HTML roundtrip covers supported rich text and tables/images; it is not a lossless representation of all DOCX sections, revisions or objects. Use the native archive for complete persistence.

The HTML adapter understands Writers' `sup[data-footnote-id][data-footnote]` atoms, turning their bodies into native footnote parts without adding them to the prose. Editable HTML restores those attributes and IDs; DOCX and PDF include actual notes. Manual `div[data-wh-page-break]` and CSS breaks are paginated and exported as explicit editor atoms. Block indentation, line height and normal/lead/quote/caption styles plus inline font/size/colour/highlight attributes map to the native document model. Table widths from `data-wh-colwidth`, `colwidth`, CSS width and column groups map pixel widths to native points and return as editor column attributes, including spans. Native archive persistence also preserves chart/diagram/OLE XML and relationships, alongside binary package parts.


## Reviewed HTML and editorial interchange

The catalogue exposes `htmlRevisionInterchange`, `editorialStyles`, `editorialSections`, `editorialCitations` and `renderMarkup` capabilities. `document.exportHtml` without `includeRevisions` returns final prose: deleted content and deleted paragraph separators are resolved in the exported representation. `includeRevisions:true` preserves insertion/deletion spans, note and image references, and paragraph separator metadata before the following paragraph. The result includes warnings for revision kinds or foreign dates that cannot be represented faithfully in Writers HTML. PDF and page rendering default to final content; `includeMarkup:true` renders the retained native revisions. Both operate on a snapshot and leave the original session untouched.

Writers HTML attributes `data-wh-revision-{id,kind,author,source,created-at}` and their `data-wh-revision-break-*` equivalents map to native revisions and standard DOCX `w:ins`/`w:del`, including paragraph marks. Native milliseconds also produce a UTC Word date. Own identity, source and timestamp use optional `wh:*` metadata (`urn:writers-hoard:document:1`) with OpenXML markup compatibility declarations. Distinct foreign `w:id` values remain distinct even when author/date match. Our DOCX roundtrip preserves this metadata; other editors can discard extension metadata, so this is not a claim of universal interchange.

Hidden `data-wh-editorial-style` and `data-wh-section` JSON markers, inline `data-wh-citation`, paragraph `data-wh-style-id` and `data-wh-bibliography` are retained. Style definitions can reuse an ID in different chapters: native IDs are scoped internally and HTML restores each original definition at its document boundary. Writers styles are materialized presets; their native style association carries the editable definition without adding inherited formatting. Actual paragraph kind, inline marks and direct formatting remain authoritative, including when a user clears formatting after applying a preset. Section markers map page geometry, margins, start type, and plain header/footer stories to the native model. Citations and bibliography associations retain source metadata and labels; this does not implement CSL. JSON attributes escape `<`, `>` and `&` as Unicode escapes before HTML attribute encoding, including literal `</script>` text.

Ordered HTML lists retain signed `start` values (including zero and negative starts) and nested restarts in native numbering, DOCX and reviewed/final HTML. Native list starts use signed 64-bit integers; decimal rendering does not replace zero with an initialization sentinel. DOCX uses `w:start` and `w:startOverride`; Writers extension markers retain the HTML list boundaries. Other formats retain the capabilities their own adapters represent, and are not promised to preserve revision/editorial metadata. Use `writer.json` and original source preservation for complete persistence.


Plain header/footer and note bodies preserve authored leading/trailing spaces and line feeds. Export reads their current native stories, excluding only the document model's generated paragraph separator and note-reference object. New HTML note imports do not add an artificial body prefix; an actual native body edit is exported rather than a cached copy of the original HTML attribute.
