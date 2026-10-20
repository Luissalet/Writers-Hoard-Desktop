# VVD map parity: implemented and verified

- [x] Optional map features, named layers and historical versions without a DB migration.
- [x] Local polygon regions, routes, labels, category visibility and named layers shared by pins and shapes.
- [x] Metadata/vertex editing, confirmed deletion, bounded undo/redo, durable drafts, Codex links, SVG export.
- [x] Dated map eras, scrubber, read-only preview, version metadata and atomic restore with automatic safety snapshot.
- [x] Auto-fit/zoom and responsive contextual inspector.
- [x] Legacy JSON clone remaps live/historical card links and pin ownership; missing card/Worldgen links detach safely.
- [x] Card deletion unlinks live/historical map pointers while keeping authored content.
- [x] Hidden Electron geometry/lifecycle/archive tests, real pointer drag/save and visual QA.

## Validation

- `npx electron scripts/run-focused-browser-tests.cjs tests/vvd-maps.browser.tsx testVvdMaps 180000` — seven passed groups.
- `npx electron scripts/run-focused-browser-tests.cjs tests/vvd-map-versions.browser.tsx testVvdMapVersions 180000` — seven passed groups.
- `npx electron scripts/run-focused-browser-tests.cjs tests/vvd-map-import.browser.ts testVvdMapImport 120000` — three passed groups.
- `npx electron scripts/run-vvd-map-qa.cjs` — trusted pointer drag/save and three screenshots pass in isolated profile.
- Scoped ESLint passes. Full renderer typecheck passed after all map additions and the first world-graph integration.

## Limits

Dates accept the author's calendar as free text; era order follows the saved sequence. Snapshots capture saved content. Drawing overlays uploaded/Gallery/Worldgen imagery; terrain tools remain in Worldgen. Restoring a historical pin whose ID belongs to another map creates a new pin ID. Legacy JSON does not carry Worldgen rows, so cloned provenance becomes standalone imagery.

All operations stay inside the existing map engine and local archive; no external service is required.
