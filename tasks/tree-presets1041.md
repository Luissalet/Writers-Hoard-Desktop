# Relationship tree presets and alignment

Verified source: official changelog, 20 September 2026, describes Family, Corporate, Military, Royal court and Blank starts, editable relationship names and alignment while dragging. Populated authenticated family preview was inspected; other starts are documented, not executed remotely.

Success criteria:
- [x] Five meaningful native starts with independently editable nodes/links; no canonical genealogy or Codex changes.
- [x] Optional alignment while dragging, retaining authored coordinates when disabled, working with normal undo/save/CAS and named eras.
- [x] Create, inspect and update through ordinary MCP; full schemas and the same storage operation as UI.
- [x] Native UI at desktop/narrow sizes, actual pointer alignment before releasing the mouse, persisted read/reopen/Undo, JSON portability and existing tree regressions.

Preserve charcoal/gold workspace identity, current freeform editor, annotations, junctions, canonical genealogy and independent variants. No claim of corporate or military simulation rules: these are editable diagram starts.

## Verified result

Local PNG/JPEG/WebP node artwork is now independent from the linked Codex avatar, decoded before a save, retained in JSON and SVG, and omitted by the explicit export image policy. Removing own artwork reveals the live Codex avatar again. Stable async requests preserve later author edits and do not write into an unmounted inspector.

`tree-presets-depth.browser.tsx` passed with actual product CSS and native input at 1440/640, including five starts, creation, live drag alignment, save, Undo, own image bytes, scoped SVG/image exclusion, CAS refusal and JSON clone. Final screenshots: `Temp/wh-codex-properties-ui-G9Fyah/tree-presets-{1440,640}.png`; root inspected the preceding identical-image pair, and final pair requires the finish reviewer. The renderer emits expected stale-CAS diagnostics and harness act/ResizeObserver warnings; these are retained in the test log.

The native external authoring transport passed registered tree create/get/save/export in its named era without changing Base. Eight logic regression groups passed after the final image/live-alignment change. A reusable named relationship vocabulary remains unverified in the reference contract; individual labels and preset roles are editable.

Harness correction: after Create, wait for the new document's node IDs. Waiting for any four cards could drag the previous diagram while asynchronous selection completed. A disabled Save button can indicate an in-flight save; wait for aria-busy=false as well.
