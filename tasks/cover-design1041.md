# Editable book jacket —1041 plan before product code

## Evidence and incumbent audit

Root authenticated action20October2026: Quill/NewStory unsaved form, hardcover/paperback/paper; back/spine/front spread; Add text with Faros; fonts8, size45, bold/alignment/color and move/resize/rotate handles; Fine/Medium/Broad brush and6colors; actual gold stroke; text and ink appear simultaneously on3D book. Clear Drawing visible. Jacket artwork AddArtwork/basecolor observed, no file chosen. No CreateStory/save/upload/export performed. Evidence outputs/vvd-reference/quill-cover-text-ink-live.png. This does not prove persisted save or stylus pressure.

Primary sources: [Quill overview](https://vvd.crisp.help/en/article/quill-overview-jpl3u0/) documents cover gallery/upload and editable cover writing; [Publish styling](https://vvd.crisp.help/en/article/publish-side-styling-p4vl90/) documents3Dhard/paperback/paper, artwork/color/texture; [Quill publishing](https://vvd.crisp.help/en/article/quill-publishing-5m51zu/) documents EPUB/PDF/DOCX export, not a cover-fidelity guarantee. Inventory identity for cover is Q12/Q01, not Q03(drafts); Q14 remains export with format-specific limits.

Writer already has ReaderBookCover CSS3D, project cover raster, style/color/texture/showAtStart, pointer/range rotation, normal ReaderPresentationModal, field-merge/CAS save and self-contained ReaderHTML. Three styles are not an arbitrary jacket designer: current back is blank; front artwork or one implicit title; spine implicit title. No authored text boxes/transforms/ink or spread export. Reader HTML duplicates current simple markup. Presentation settings are currently project-wide; eraId validates chapter/audio refs only. Q17 snapshots preserve the existing presentation and HTML. PublishingDocument DOCX/EPUB intentionally omits images; no cover-specific publishing renderer located in audited product paths. Do not claim jacket export to EPUB/DOCX from that pipeline.

## Additive contract proposed

Reuse ReaderPresentation.cover and normal Reader modal. Optional cover.jacket={version:1,elements:[...]} stores authored full-spread text/image/stroke elements in stable canonical coordinates (back600 + spine72 + front600; height900). Absence retains the exact legacy implicit title/project artwork behavior. First edit initializes existing front/spine title; explicit empty design stays empty. Text has stable id, rectangle, rotation, font from8offline system-safe stacks, size, bold, alignment, color and literal text. Artwork is supported local raster data bytes and transforms. Ink has id/color/width/points (use existing simplifyStroke; mouse fallback). No external font/network dependency or physical pressure claim. Face rendering clips the same authored spread to back/spine/front; shared pure SVG/markup renderer powers normal3D, exported ReaderHTML and spread/front/back/spine PNG. No new engine or second design format.

Normal CoverDesigner is a leaf in the current Reader presentation workflow: spread, selection/text/draw modes, text properties, move/resize/rotate handles and numeric keyboard controls,3brush sizes/6colors+custom, clear drawing, delete selection, local Undo/Redo; simultaneous existing3Dpreview. Keep compact charcoal/gold chrome, content-selected cover color. Save through the ordinary Reader presentation API, retaining chapter settings/unknown sibling metadata. Snapshot editions capture the design and exact self-contained HTML; later cover edits do not update earlier publication versions.

MCP: extend normal reader settings schema with complete jacket data and reuse saveReaderPresentation; add a read-only wh_reader_cover_export query for PNG/SVG (same renderer, no hidden save). Root wires pure leaf schema/tool/handler exports into shared registries. Export rendered face/spread only; print-production bleed/physical sizing, EPUB/DOCX jacket composition and hosted stories not claimed.

Era seam must be agreed before implementation: current reader presentation is project-wide. Preferred bounded option is optional WorldEra.readerCover override only, with helper applying it to an effective Project in getEraProject and captured publicationReaderSource; normal cover saves use era own cover while chapter/audio presentation remains current shared behavior. Root owns types/store/snapshot wiring; own save merges latest own worldEra and revision. Alternative keep shared cover explicitly labelled; do not silently pretend era isolation.

## Owned paths / requested seams

Proposed own: src/engines/writings/coverDesign/** (pure types/validation/geometry/SVG+PNG/export/schema and UI leaf), readerPresentationTypes.ts, readerPresentation.ts, readerPresentationStyle.ts, components/ReaderBookCover.tsx, components/ReaderPresentationModal.tsx, readerExport.ts only cover markup seam; tests/cover-design*; docs/cover-design.md. Ink helper reuse without modifying utils/freehand.ts. No wiki edits, Q05/Q16 prose/history or shared tool preview edits.

Root: optional WorldEra.readerCover type and effective Project/captured publication cover seam if accepted; manifestReader.ts/tools reader registry wiring from pure exports; global JSON/full/ZIP validation calls to cover helper and clone remap(elementIDs only, no semantic refs in image/text/points). PublishedEdition validation calls same pure jacket validator so malformed future snapshots reject; source snapshot implementation stays frozen otherwise. Need exact incumbent publishing-cover-renderer path if one exists outside audited files; reuse it if it genuinely implements normal cover composition.

## Acceptance

- [x] Legacy style/art/title unchanged; real authored text+gold stroke visible together on3Dfront and spread, back/spine/front editing.
- [x] Mouse/keyboard move/resize/rotate and Undo/Redo/clear onlyink; cancel/failedCAS preserves author data. Resize and Unicode multiline text remain finite and clipped safely.
- [x] Same normal API/MCP can author/read/export; invalid schema/stale concurrent writes do not replace existing design or unrelated chapters/metadata.
- [x] Base/named era behavior explicit and tested; two cover changes retain sibling era/Base/presentation. JSON/full/ZIP/clone preserve image/ink/text and valid snapshots.
- [x] Actual Reader normal and standalone HTML render authored layers with no live fetch; PNG bytes/pixels/dimensions and face clipping verified. Frozen edition remains exact after cover edits/source deletion, later republish captures new design.
- [x] Actual UI1440/640 native pointer/keyboard plus external stdio→HTTP→executor→IPC→renderer, Reader/presentation/Q17 regressions and scoped checks; canonical screenshots/report keep initial failures and precise limits.

No product edits until routes/era contract communicated to parent. No commits, CUA, user data, services/models/GPU changes or proprietary assets/code reuse.

## Accepted contract and scoped closure

Root accepted WorldEra.readerCover only; own save3way cover preserves global chapter/audio behavior, increments only the changed own cover era revision, and does not call the global revision an era CAS token. Root wired pure helper/validation/remap into effective/captured Projects and normal JSON/full/ZIP/editions. No separate publishing cover renderer existed to duplicate.

Cover functional4groups + actual external reader/MCP/PNG/SVG/publication + fresh standalone runtime PASS6groups (cOGpfU). Normal native UI1440/640 PASS2groups after inline-CSS harness fix (ZOm84T). Reader5 and Q17old3 regressions PASS. Scoped renderer tsc/ESLint/diff checks PASS. Canonical screenshots/report in work/worldcraft1041-cover-depth.md. No global parity or hosting claim.

Definitive freeze addendum: legacy artwork-only Open→Apply reproduced FAIL and fixed with conditional initialization preserving front image/lomo. Same oracle PASS; native6group repeat RhgFsn PASS and source hashes refreshed. Existing capture fixtures artwork=false retain identical semantic design.
