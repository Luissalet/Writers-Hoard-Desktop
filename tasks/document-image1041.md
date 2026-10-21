# W13 — image export for individual documents

## Contract and sources, before implementation

The official Import & Export help (updated20August2026) documents an individual
document Share menu and different available formats per document. The current
official changelog explicitly states that any document can export as an image.
Neither source specifies exact pixel dimensions, pagination, SVG-vs-PNG or
infinite-canvas framing. These must be an explicit Writer contract, not invented
claims about the reference.

Sources:
- https://vvd.crisp.help/en/article/import-export-15oat5e/
- https://vvd.world/whats-new (August2026 update, “any document as an image”)
- Project inventory `work/worldcraft1041-full-inventory.md`, rowW13.

## Success criteria

- One normal Library action and native MCP operation export any of the fifteen
  workspace kinds: dialog-scene, codex, writings, maps, worldgen, board,
  timeline, notes, media, dictionary, tables, genealogy, character-sheets,
  radar, model-viewer. Resolve the effective document and related data from the
  requested project and explicit Base/era; never a global active-era flag.
- PNG output declares CSS width, pixel ratio, framing and page geometry.
  Complete flow content is captured, paginating long documents without
  truncation. Infinite scenes explicitly choose fit-to-content or a requested
  world-space view. No tool-summary previews or arbitrary first-N rows.
- Reuse complete normal engine exporters/render primitives and local assets.
  Tables/sheets retain all rows/columns and calculated display values; long
  text, nested tool blocks, notes and character sheet sections retain content.
  Static captures of model/video/audio declare camera/time/visual form.
- A local isolated Electron renderer captures actual composed HTML/SVG/WebGL,
  awaits assets/fonts and reports failed resources. No external server, CDN,
  network dependency or user-profile/cache mutation. A QA screenshot alone is
  not the product capability.
- Normal UI at1440/640, native external MCP, Base/era and source immutability,
  all fifteen kinds, pagination/last-content markers, deterministic dimensions,
  pixelRatio and real asset/model rendering are verified. Missing/foreign/
  excluded sources produce honest errors.

## Plan

- [x] Audit per-kind full render/export authority and record honest limits.
- [x] Define common request/result/source-version and framing/page contract.
- [x] Implement scoped full-document adapters under services/documentImage.
- [x] Implement isolated local Electron capture behind normal IPC, with root
  coordinating main/preload/security/type seams before edits.
- [x] Add Library export action, preview/options/download and normal MCP schema
  and handler, wired by root at shared seams.
- [x] Verify real fifteen-kind fixtures, Base/era, full content/assets, image
  geometry/pagination, actual external MCP and1440/640 composition.
- [x] Update capability docs and evidence; freeze for full authoring review.

No commits/integration. Existing Board viewport PNG and resource-free truncated
tool previews remain available but do not satisfy this common image contract.


## Verification and delivery

Native external MCP transport completed successfully on20October2026. All15
kinds were exported from Base and an explicit era (30compositions), with source
versions unchanged. Wide table1233×1840 rendered as4tiles; manuscript960×3199
as3; sheet960×4126 as3. A yellow final-paragraph marker is checked in the actual
last manuscript PNG. PixelRatio2 returns1280px for640CSSpx, and repeated note
exports have byte-identical PNG output. Explicit board view and foreign-owner
rejection are covered. A separate real VP8 video capture shows frame0.

Normal Library action, options, full preview and actual ZIP downloads passed at
1440/640. Images were inspected with view_image. Electron/source renderer
checks and ESLint passed; full native transport also retained original Codex,
Reader, eras/Undo, timeline batch, radar, board,7MiB byte-identical GLB and real
CPU voice tests. Added relation-tree image bytes survive save/get/normalSVG;
number-table cell1.25→2.75 lives only in its era and exports correctly asCSV.

Proof: `.impeccable/review/document-image1041/`, native log
`.impeccable/document-image1041-run.log`; product contract in
`docs/DOCUMENT_IMAGES.md`. GLB context reports ANGLE NVIDIA RTX4070Ti D3D11;
no software-renderer switch, global model or GPU-service change was used.
Native compositor uses a resized hidden content viewport and applies zoom
AFTER navigation. Initial Windows window placement had clamped height and
navigation had reset zoom; those were the causes behind the discarded capture
approaches. Dimensions are now checked against decoded PNG bytes.

C confirmed the normal projectWorldTable contract frozen; the image adapter now
uses it for effective calculated/live columns. Additional builder + native MCP
image proof shows7.5×3→22.5. Final native run and both typechecks exit0.
Source frozen for independent full authoring review; no commits/integration.
