# Editable book jacket

Open Reader presentation → Design text, artwork and ink. The jacket editor uses the existing3D cover and its hardcover/paperback/paper styles. Choose Full jacket, Back, Spine or Front. Add literal text, local raster artwork or a drawn stroke. Text supports eight system font stacks, size, bold, alignment and color. Drag an element to move it; the lower handle resizes and the upper handle rotates. Numeric X/Y/Width/Height/Rotation fields provide keyboard access; arrows move the selected element and Shift uses10units. Layer buttons change stacking order.

Draw has Fine/Medium/Broad brushes, six colors and custom color. Clear drawing removes ink only. Undo/Redo restore local design edits. Apply to presentation returns the design to the ordinary Reader presentation form; Save presentation persists it. Cancel asks before discarding edited design. A failed save retains the presentation form. This is a local working edit, not a separate persistent draft journal.

The authored jacket is1272×900units: back600, spine72, front600. Artwork and text are clipped into their element boxes and each face. Text wraps into its box; explicit line breaks are retained. System font availability can vary by platform. Fonts are not downloaded. The original implicit title/project-image cover remains when jacket is absent; an explicit empty jacket intentionally removes authored elements. Existing project-image/color/texture controls remain available.

Base covers are inherited by eras without their own cover. Saving a cover in a named era writes that era’s readerCover, preserving Base and sibling eras. Cover fields use three-way merge; the complete jacket is one authored field. Chapter/audio/playback settings keep their existing shared project scope. Reader presentation revision is still shared; it is not an independent per-era CAS token. Unchanged unavailable chapter/audio references are retained.

The same design renders in normal3D, ReadingView, standalone ReaderHTML and SVG/PNG face/spread exports. Custom jackets can rotate through180degrees to inspect the back; legacy cover rotation keeps its prior65degree range. A local published edition captures the cover settings and its self-contained HTML. Editing the current cover does not change earlier editions; republishing captures the new design.

## API and MCP

wh_reader_settings accepts optional eraId and returns effective presentation. wh_reader_settings_save accepts that complete presentation plus expectedRevision. The normal manifest describes cover.jacket and its typed text/image/ink elements. IDs are stable; image.src is a local raster data URL; ink.points are normalized to the element box. Array order is layer order. Removing jacket restores the legacy automatic cover; retaining {version:1,elements:[]} keeps an intentionally empty authored jacket.

wh_reader_cover_export is a query: optional eraId, face=spread/front/back/spine, format=png/svg, pixelRatio for PNG. It returns filename, dimensions and dataUrl (plus svg for SVG). It never saves or publishes. JSON/full/ZIP/clone retain image bytes and remap authored element IDs and publication metadata; frozen HTML bytes remain exact.

This feature exports a digital cover image. It does not add print bleed, physical trim calculations, hosted stories, network fonts, a glTF book model or jacket composition in the existing image-free DOCX/EPUB publishing pipeline. The observed reference did not demonstrate saved/uploaded/exported cover behavior, and no stylus hardware or pressure equivalence is claimed.

## Captured book front and physical print jacket — C41 continuation

The earlier digital-only/non-goal paragraph records the original scope. The current implementation adds two separate opt-in paths without changing the 1272×900 authored jacket or its existing SVG/PNG exports.

In a publishing profile, Include cover captures the effective manuscript/era front at 1200×1800 before the title in HTML, EPUB, DOCX and the existing native PDF path. It is independent of Reader.showAtStart. Preparation freezes the selected content, labels, date and rendered front before writers run; later edits cannot replace that captured image. EPUB marks cover-image and places cover first in spine; DOCX keeps it outside the two-column body. Leaving includeCover absent/false retains prior output. Publishing compile returns full HTML automatically with the cover; complete:true requests complete text explicitly for other cases, while the legacy bounded mode reports truncated.

From the normal designer, Print cover uses the visible draft without Apply. Set one-cover trim width/height in mm, manual spine (0 allowed), outer bleed (0 allowed), resolution and PDF/PNG/JPEG. Preview is explicitly 72 dpi; default export sampling is 300 dpi. Each face retains its proportions and extends its edge pixels to fill the panel; bleed repeats the outside edge. Shared pixel boundaries avoid gaps, with quantization up to 1 px. PDF physical geometry uses 72/25.4 pt per mm without raster rounding. Cancel/Back and errors keep the design; exporting does not save it.

The existing wh_reader_cover_export query accepts printLayout={trimWidthMm,trimHeightMm,spineMm,bleedMm}, face:spread and format pdf/png/jpeg. dpi is optional and defaults to 300. It returns the whole dataURL with filename/MIME/pixels, dpi/metadataDpi, layoutMm and boxesPt. Canonical PNG/SVG without printLayout keeps its prior options. Physical SVG, pixelRatio mixed with physical layout, dpi without layout and PDF without layout are rejected. PNG/JPEG embed density in their own units; metadataDpi reports rounding.

Print PDF is one raster RGB sheet: Media/Crop/Bleed cover the exterior, Trim is inset by outer bleed. The chosen PDF compatibility limit is 14400 pt per side at UserUnit=1; it is not a global PNG/JPEG/canvas quota. Export can fail if an image size is not representable/allocatable while preserving the design. No PDF/X, CMYK, ICC, searchable/vector text or arbitrary printer compliance is certified. Browser book PDF and batch remain separate C42 work. [Attributed source, QA method and current delivery state](../tasks/vvd1095/verification-cover-exports.md).

## Book PDF and captured publishing batch — C42 continuation

The earlier Browser-book-PDF/batch paragraph records the C41 boundary. Publishing profiles now add a searchable book PDF in Browser and can prepare six outputs from one captured manuscript/era, including a separate print-cover PDF. The book has text pages; the jacket remains one raster RGB physical sheet with its own trim/spine/bleed/resolution. They are distinct results, not two names for the same PDF.

Use Prepare files in the normal publishing profile, then Download or the optional ready-files ZIP. Retry pending files uses the captured design/content; preparing again captures current data. Batch `print-cover` requires explicit DPI as part of printLayout, while the standalone C41 `wh_reader_cover_export` keeps its optional DPI/default 300 contract. [Usage, evidence and limits](../tasks/vvd1095/verification-publishing-batch.md). No PDF/X, CMYK or printer conformity is implied.

The bounded C42 flow is delivered in Main with exact CAS54 approval and a fresh Main transport check. This does not extend the historical C41 jacket/reader/printer guarantees.
