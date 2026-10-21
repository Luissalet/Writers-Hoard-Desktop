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
