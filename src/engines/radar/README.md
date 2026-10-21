# Radar charts

Radar documents compare independent series over author-defined axes. Every axis has its own minimum, maximum and unit. Existing chart data, manual fallback values, Codex source links, revision checks, recovery drafts and recoverable archiving remain compatible.

## Editing the graphic

Drag a vertex to change its manual value. With several overlapping series, **Series to drag** chooses which series receives pointer input; keyboard focus also selects its series. The captured pointer can leave the vertex without ending the drag. Pointer cancellation or Escape restores the initial raw value, including a manual outlier that was clipped in the drawing.

Vertices are keyboard sliders: arrows change one step, Shift or Page Up/Down changes ten steps, and Home/End selects the axis endpoints. Every handle exposes its series, axis, current value and scale. Values outside the scale remain in the document and accessible value text; only their drawing is clipped.

In **Axes & scales**, configure a positive interaction step, a Lucide icon and an axis color. With no explicit step, dragging and keyboard use one hundredth of the scale. Manual numeric fields continue accepting the author's raw values rather than snapping or clipping them. Notches thin out when necessary to remain legible; their drawing density does not limit the supported step or values.

A vertex bound to a Codex field is read-only in the graphic. The linked source name and current numeric value resolve live, including calculated Codex properties. Missing or invalid fields visibly use the authored fallback. Edit the source card, unbind the field, or deliberately edit **Manual value** to change its fallback. Dragging a radar never writes to the Codex.

## Presets

The preset selector offers suggested character, location and faction skeletons and every saved world chart marked **Offer this chart as a world preset**. Categories are author-defined. Save the chart to make its preset available in the selector.

Creating from a preset makes a separate document with new chart, series and axis identities. Scales, steps, icons, colors and authored values are retained. Codex references and live bindings are cleared so the new chart can be used with another subject. Existing charts and their unsaved drafts are preserved.

## Optional sound

Sound starts muted. **Sound muted / Sound on** controls quiet, locally synthesized WebAudio ticks when a manually edited value crosses a notch. The preference persists on the local device and updates open charts when changed through the native bridge. No sound files, network requests or models are involved. The audio context closes when the graphic unmounts.

## Interchange

- JSON retains the existing version-one format, including optional axis settings and preset metadata. Import creates an independent chart; links outside the current project are removed.
- CSV captures resolved values as an independent numeric chart. New exports use `axis,min,max,unit,step,icon,color,series:…`; the importer also accepts the original four-column axis header. Axis styles and steps round-trip.
- SVG is self-contained and includes scales, notches, colors, series and actual local Lucide paths. `exportRadarSvgComplete` resolves the local icon catalogue before exporting. The synchronous `exportRadarSvg` helper remains compatible and can consume a supplied icon catalogue.
- Normal project cloning preserves the new optional metadata and remaps project-local Codex links through the existing portability workflow.

## Native API / MCP

`RADAR_HANDLERS` and `RADAR_TOOLS` provide:

- `wh_radar_list` / `wh_radar_get`: chart/preset inventory, complete document and current resolved values/issues.
- `wh_radar_save`: create with `expectedRevision: null`, or edit with the revision just read. Axis and series IDs are stable within a document.
- `wh_radar_set_value`: the same scale snapping and read-only binding behavior as direct manipulation.
- `wh_radar_from_preset`: independent copies of saved charts or suggested skeletons.
- `wh_radar_export` / `wh_radar_import`: complete SVG, portable JSON and styled or legacy CSV.
- `wh_radar_archive`: the normal recoverable Document archive.
- `wh_radar_settings`: read or set the local optional audio preference.

`setRadarValue`, `radarValueAtPoint`, `snapRadarValue`, `radarNotches` and `cloneRadarChart` are reusable pure operations. Writes use the existing transactional revision checks; concurrent changes preserve the latest saved document and the GUI's draft.

## Verification

```powershell
node scripts/run-radar-tests.mjs
.\node_modules\.bin\electron.cmd scripts/run-focused-browser-tests.cjs tests/radar.browser.tsx testRadarCharts 180000
.\node_modules\.bin\electron.cmd scripts/run-focused-browser-tests.cjs tests/radar-depth.browser.tsx testRadarDepth 180000
.\node_modules\.bin\electron.cmd tests/radar-depth.runner.cjs
```

The new tests use isolated profiles and synthetic records. They cover actual renderer bridge dispatch, scale/step math, immutable series editing, read-only and calculated Codex sources, typed schema validation, styled and legacy interchange, complete local icons, project cloning, presets, keyboard editing, raw-outlier cancellation, recovery, and native pointer input with capture and Escape. The layout runner compiles the shipped stylesheet at 1440×1000 and 640×860. It executes real local WebAudio while muting the test window's audio output, and verifies that muted interaction creates no audio. These are desktop and narrow desktop tests, not a mobile product claim.
