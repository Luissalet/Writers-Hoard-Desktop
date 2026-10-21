# Character sheet ink — contract before code

Reference evidence supplied by root: authenticated Draw/Erase/Undo gesture on
the reference5e sheet, `outputs/vvd-reference/5e-ink-live.png`. No reference
paper, art, template, typography or proprietary asset will be copied.

Writer currently has tabbed editable sheet forms, CAS/revisioned Base/era
metadata, JSON portability and board pressure-stroke geometry. Its Reader
sheet block is a truncated trait/resource summary. Adding ink to responsive
form coordinates would move marks when width/tabs change. Keep those forms
and add an original **Paper** view shared by UI/Reader/PNG.

## Contract

-One logical continuous paper surface `paper-v1`,1000units wide, full current
  sheet contents with deterministic text/table layout. Height grows for full
  rows/details and retained ink bounds. The surface scales uniformly to the
  available width; x/y are absolute paper units, never viewport percentages.
  Author edits can move the underlying printed text; ink remains at its paper
  coordinates, like a drawing on a page. This is declared in the UI/help.
-Optional backward-compatible `CharacterSheet.ink` stores version1,
  surface`paper-v1`, width1000 and ordered stroke operations. Each has ID,
  pen/marker/eraser, colour, logical brush width, x/y/optional pressure samples.
  Reuse existing simplification and pressure `strokeOutline` geometry.
-Eraser masks only earlier ink through SVG masks. It never erases sheet data,
  paper or later strokes. Undo removes the latest ink operation, including an
  eraser, so restoration is exact and survives save/reload. No extra snapshot
  history, arbitrary first-N cutoff or new DB store/migration.
-Normal drawing edits the incumbent unsaved draft; Save/Discard/conflict and
  era semantics stay the same. Tools remain outside the scaled paper; pen,
  marker, eraser, colour, width, Undo and Done have normal accessible controls.
-`wh_sheet_ink_action` uses current revision and explicit Base/era, supported
  draw/erase/undo operations and identical validation/mutation. Existing
  get/update/export/import retain ink. Register alongside SHEET_TOOLS rather
  than editing central shared monoliths.
-Shared own SVG paper renderer prints complete sheet contents and ink in
  normal Reader, standalone Reader/wiki and W13PNG. Typed validated sheet
  preview payload follows the existing typed model pattern; cached arbitrary
  HTML does not become trusted. JSON/whole-worldZIP preserve the optional field
  via existing metadata portability. Existing formulas/rules are reused.

## Planned paths/seams

-`src/engines/character-sheets/{types,SheetEditor,bridge,bridgeManifest}.ts[x]`
  and new `ink.ts`, `paper.ts`, `SheetPaper.tsx`; no CoC rule change.
-`src/components/editor/toolBlocks/{preview,reading}.ts` sheet branch/payload;
  normal Reader/wiki composition branches only where the typed payload is
  serialized. Root must reserve these seams before product edits.
-`src/services/documentImage/build.ts` character-sheet adapter uses the same
  SVG paper renderer, preserving the complete image/pagination contract.
-Focused browser/native tests and existing external MCP transport: root owns
  central registration/build seams. No board/map/history DB source edits.

## Acceptance

- [x] Pure stroke validation/simplification/pressure, draw→erase→Undo pixels,
  distinct later stroke survives earlier eraser, reload/JSON/ZIP exact data.
- [x] Actual pen/mouse gestures in normal sheet UI at1440/640, stable paper
  coordinates through resize, Done restores form interaction, saved reload.
- [x] Native external MCP draw/erase/undo with CAS rejection, era-only ink and
  Base unchanged; normal sheet export/import includes identical operations.
- [x] Same ink/paper positions in normal ReadingView, standalone Reader/wiki
  without HTTP and native W13PNG, including ink beyond the original text end.
- [x] Character-sheet/CoC/export regressions, typecheck/lint, bounded visual
  inspection and evidence. No map work or new RPG rule engine.


## Verification

Final native transport run exited0:7focused pressure/mask/Undo/data groups,
normal externalMCP ink writes with stale CAS rejection and era-only state,
exact JSON roundtrip, normal projectJSON clone and full projectZIP replace/
restore, full3tilePNG and ink at y8000 beyond the text end. Offline Reader/wiki
HTML was opened in isolated Electron with HTTP requests blocked and counted0.
Normal CharacterSheetsEngine/ReadingView at1440/640 were inspected. Simulated
pen points x100/y120 persist within1logical unit at both widths.

The coordinate assertion caught focus-induced scroll on pointer-down; focus
now uses preventScroll. Evidence waits for the persisted sheet and refreshed
paper, rather than capturing the transient loader after a ZIP/save update.
The first7SVG/PNG/Reader/editor files and the3confirmation files were opened
with view_image. Only one grouped material correction pass was used.

RPGlogic5groups and CoCdepth8groups/native mouse+keyboard pass. The same final
transport also passes all30W13Base/era images, original authoring/Reader/Undo,
7MiBGLB, realCPUvoice, Treeimage bytes, decimal tables and root's4dictionary
operations plus stale/era checks. Focused ESLint and electron typecheck pass;
renderer typecheck also completed with exit0.

Proof `.impeccable/review/sheet-ink1041/`, logs
`.impeccable/sheet-ink1041-run.log` and
`.impeccable/sheet-ink1041-coc-regression.log`. No map/CoC rule/DB/history edits,
commits or integration. W13's prior evidence is retained separately; the new
paper adapter's30image regression is under this ink evidence directory.

Known visual finding, reserved by root for the independent finish review:
Pen/Marker/Erase expose aria-pressed but the incumbent button class has no
selected border/text styling. Their active tool is therefore not visibly
marked. Source remains frozen; do not start another private polish cycle.
