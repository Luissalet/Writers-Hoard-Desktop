# Document images

The project Library has a **PNG** action for every workspace document kind.
Choose CSS width, pixel ratio and tile height, create the preview, then download
one PNG or a ZIP containing every PNG tile and `manifest.json`. Nothing is
removed from the document to make a thumbnail. Long flow and wide tables are
tiled in both axes; the manifest gives each tile's source rectangle and pixel
dimensions so the complete composition can be reconstructed.

The native bridge exposes the same operation as `wh_export_document_image`:

```json
{"projectId":"world-id","kind":"writings","entityId":"chapter-id","width":1440,"pixelRatio":2,"pageHeight":2048,"locale":"en"}
```

An optional `eraId` selects that era's effective document and related data.
Omitting it selects Shared base. The result reports `sourceVersion`, related
`dependencies`, framing, CSS size, pixel ratio, PNG data URLs and tile geometry.
This is a read operation; authoring data is unchanged. A generated world's
normal derived geography may need to finish generation before export.

All fifteen kinds are supported: Codex, writings, notes, dialogue scenes, maps,
generated worlds, boards, timelines, dictionaries, tables, relation trees,
character sheets, radars, media and 3D models. Prose includes its local linked
documents and endnotes. Tables include every row and column and calculated
display values. Dictionary words, sheet rows, scene turns and timeline events
have no first-N cutoff. Owner checks and hidden-era documents use the same
effective-document store as normal authoring.

Boards, relation trees, maps and generated worlds offer **Fit content** or an
explicit `{x,y,w,h}` view. Board/tree units are their native flow coordinates;
map units are percentages; world units are generated cells. A board retains
visible layers and collapsed-frame semantics, native node footprints, pressure
strokes, shapes and edge geometry; complete card text is also printed beneath
the scene. Maps retain their background and native features/pins. Tree and
radar images include complete text/value indexes beside their normal SVG.

These are complete static document compositions, not screenshots of editor
chrome. Timelines print an ordered chronology with event descriptions and
connections. Audio prints the complete decoded waveform and transcript;
video captures its initial decoded frame while paused. Models use the actual
local Three/GLTF renderer, framed orbit camera and paused rest pose. They do
not substitute a poster. The model renderer keeps its incumbent raster-detail
cap; increasing the export ratio increases the composition's PNG dimensions.

The compositor runs in an isolated, hidden local Electron window, awaits local
assets/fonts/models, scrolls each tile into view and captures actual rendered
pixels. It does not need a companion server, CDN, network resource or user
cache. Temporary HTML is removed when capture completes or fails; its session
is nonpersistent and the window is destroyed. Missing/failed assets, invalid
geometry and unavailable WebGL are errors that can be retried from the dialog.

CSS width and tile height start at320; ratio is1–4. Each physical PNG axis must
fit Chromium's16000-pixel capture range. This bounds a tile, not the document:
the remaining content becomes additional tiles. Very large documents still
take memory proportional to their complete returned PNG output.
