# Writers document engine — protocol 1

The owned executable reads UTF-8 JSON lines from stdin and flushes one JSON line to stdout per request. It uses no window or dialog. stderr is reserved for diagnostics. Electron must launch with `windowsHide: true`. The Windows binary uses the GUI subsystem to avoid creating a console. Source and Cargo dependencies are entirely inside this repository; ordinary third-party crates come from crates.io with Cargo.lock.

Request: `{ "id": 1, "action": "document.new", "args": {} }`.

Success: `{ "id": 1, "ok": true, "result": { ... } }`.

Error: `{ "id": 1, "ok": false, "error": { "code": "document_error", "message": "..." } }`.

All state is held in the process. Session IDs include a process-instance nonce; after process failure previous IDs cannot address new sessions. Caller persists document archives as needed. Unknown session IDs return an error. No implicit file writes: `document.save` requires an explicit path; exports return bytes unless a path is explicitly supplied.

File outputs use a unique temporary file beside the explicit destination, flush/sync the complete bytes, then replace the destination by rename. A failed write preserves the previous output and cleans up the owned temporary file. The executable can be terminated during generation without truncating the previous destination. Password-protected Word packages opened with a password retain it in the session for later saves/byte exports; `file.encrypt` changes or clears it, and a save's explicit password override becomes the next default only after a successful save. Results of Word open/save/byte-export report `encrypted`; passwords are never included in results. Other formats remain their ordinary unencrypted formats.

| Action | Args | Result |
|---|---|---|
| `commands` | `query?` (case-insensitive id/label/location filter) | `protocolVersion`, `totalCommands`, `commands` (id/label/location/shortcut/params/mutates/atomicBatch), `actions`, `positionUnit` |
| `document.new` | `template?`, `text?`, `sessionId?` | Session metadata |
| `document.open` | `path`, `password?`, `sessionId?` | Session metadata |
| `document.openBytes` | `dataBase64`, `format`, `fileName?`, `password?`, `sessionId?` | Session metadata |
| `document.importHtml` | `html`, `assets?` map of image src to base64, `sessionId?` | Session metadata |
| `document.save` | `sessionId`, `path`, `password?` | Session metadata, path, bytes |
| `document.exportBytes` | `sessionId`, `format`, `fileName?`, `password?` | mimeType, dataBase64, fileName |
| `document.exportHtml` | `sessionId` | html (images embedded), assets (base64 map) |
| `document.inspect` | `sessionId` | Session metadata, document, assets, passthrough, selection, undoDepth |
| `document.text` | `sessionId` | text |
| `document.renderPage` | `sessionId`, `page?` (1-based, default 1), `scale?` (default 1) | mimeType, dataBase64, width, height |
| `document.exportPdf` | `sessionId`, `includeMarkup?`, `path?` | mimeType, dataBase64 |
| `execute` | `sessionId`, `command`, `params?` | Session metadata, commandResult, uiRequests |
| `batch` | `sessionId`, `commands` array of command/params | Session metadata, results, atomic:true, uiRequests |
| `document.close` | `sessionId` | sessionId, closed:true |

Session metadata contains `sessionId`, `revision`, `dirty`, and `summary` with `pages`, `words`, `paragraphs`, `assets`. Import/open/new creates a new session when sessionId is omitted, and replaces an existing session document when supplied. Replacement is undoable. `document.new` accepts blank/sample/letter/resume/report templates. Format is selected by `format` for byte operations and by file extension for path operations. The complete native format is `writer.json`: `{format:"writers-document",version:1,document,assets,passthrough}`. Both binary maps use base64 and preserve media and retained original DOCX parts. Legacy unwrapped JSON remains readable; it cannot recover previously lost binary data.

`batch` commits the whole in-memory session clone only after every command succeeds, preserving document, selection, undo/redo, clipboard and editing state on failure. Operations with external effects (file writing, system speech, global dictionary changes) and macro/repeat dispatch run separately through `execute`; they cannot claim atomic rollback. `atomicBatch` in the catalogue reports that distinction. UI requests are data only; this headless process never opens dialogs.

Session undo has no fixed depth limit and never discards the oldest edits automatically. Closing the session releases its history; document archives persist the complete document, while undo/redo stays in the active session. Edit snapshots retain the complete shared history and restore it exactly, including after intervening undo operations.

Selection paths and offsets follow the owned document model: story plus block/table path, and UTF-8 **byte** offsets. They are not DOM UTF-16 offsets. Convert explicitly in UI adapters. HTML roundtrip covers supported rich text and tables/images; it is not a lossless representation of all DOCX sections, revisions or objects. Use the native archive for complete persistence.

The HTML adapter understands Writers' `sup[data-footnote-id][data-footnote]` atoms, turning their bodies into native footnote parts without adding them to the prose. Editable HTML restores those attributes and IDs; DOCX and PDF include actual notes. Manual `div[data-wh-page-break]` and CSS breaks are paginated and exported as explicit editor atoms. Block indentation, line height and normal/lead/quote/caption styles plus inline font/size/colour/highlight attributes map to the native document model. Table widths from `data-wh-colwidth`, `colwidth`, CSS width and column groups map pixel widths to native points and return as editor column attributes, including spans. Native archive persistence also preserves chart/diagram/OLE XML and relationships, alongside binary package parts.
