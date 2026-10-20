# Local tool document blocks

- [x] Inspect entity resolvers, pointer-only Codex/media blocks, document selection and SVG/export helpers.
- [x] Add a scoped pointer atom and picker for maps, board, timeline, relation tree, dictionary, table/sheet, RPG, radar and model.
- [x] Add bounded live read previews and honest unavailable/foreign states; source refresh must never edit host prose/undo.
- [x] Reuse actual source engines in isolated modal/router/pane scope, cap nested editing, flush journals/CAS writes before closing and keep failures visible.
- [x] Add local static export/hydration helper with safe SVG/raster/text; no JSON dumps, remote resources or foreign titles.
- [x] Verify actual picker/atom/edit/refresh/undo, multi-document selection, nested safety, failed save retention and offline portable exports.

HTML contract: figure[data-wh-tool-block="true"] with data-project-id, data-tool-kind, data-document-id, data-label. Attributes contain only a project-scoped pointer and a bounded label fallback. Rich source bodies are resolved live from local data.

Verification: seven focused browser groups pass, including real source Tables/Maps/RPG edits, buffered-cell flush, unsaved map feature close veto, same-source CAS refusal and recovery preservation, real picker and undo, reader live refresh, malicious SVG/HTML, foreign scopes, nested editing cap, actual project cloning and a 161-entry snapshot deduplicating 322 references to two previews. Existing wiki export five groups, wiki presentation five groups and GLB viewer five groups pass. Focused source ESLint passes. Renderer typecheck passed before unrelated in-progress workspace/library/model.ts27 implicit-any folder error. Visual QA inspected current CSS at1280px and720px; final captures are .impeccable/review/tool-blocks-desktop.png, tool-blocks-narrow.png, tool-source-editor.png and tool-source-editor-narrow.png.

Bounded behavior: board and textual documents use semantic summaries; maps/relation trees/radar use safe local SVG; 3D editor blocks reuse the actual GLB viewport while reader/wiki provide a model description. Editors reuse each tool's own Save/CAS/recovery; explicit unfinished source forms must be saved or cancelled before closing. Cross-tool navigation stays within the modal scope and is refused if it would leave its tool/project. No new storage/schema or network resource is introduced. Wiki previews resolve in the same database snapshot, are tied to the current export admission policy, and are rebuilt through an HTML/SVG allowlist before injection.
