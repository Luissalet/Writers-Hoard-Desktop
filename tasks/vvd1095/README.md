# VVD catalogue cross-reference (Agora 1095, continuation of 1041)

## Why this exists

The 148-row inventory of task 1041 has no row for VVD's map editor (its M rows are
the 3D model viewer) and no rows for whole areas: Campaign, Compendium, Name
generator, Soundscape, Animator, Annotator, Cartographer, To-do list. This pass
starts from VVD's own shipped interface catalogue instead of from screenshots.

## Method and evidence levels

1. Source catalogue: the English interface strings VVD serves to the
   authenticated editor (`/i18n/en.<hash>.json`, 21,286 keys, read 21-10-2026).
   They are the list of controls and options the product exposes. They are not
   proof of behaviour; where a row infers behaviour from a label it says so.
   The raw file is third-party data and is not stored in this repository.
2. Authenticated observation (21-10-2026): Map Beta 0.1.58 in the tool preview
   of the reference session — starters (blank sea/land, size presets, templates
   including the Roman Mediterranean), biome palette, elevation, rivers, paths,
   places, zones, labels, settings, look selector. Luis's video of 20-10
   (12.45 s, VVD promotional reel) shows the biome brush on a tablet, a painted
   regional map with pins, Quill's 3D book, the 3D tilt and a relation tree.
3. Writer side: six independent read-only agents opened Writer's source for
   every offline capability and classified it PRESENT / PARTIAL / ABSENT with
   file evidence. This is source reading, not execution. A PRESENT here is not a
   tested workflow; a PARTIAL names the concrete difference.

| Area | File | Rows | Present | Partial | Absent | Online |
|---|---|---:|---:|---:|---:|---:|
| Map authoring (atlasTool) | A1-atlas-authoring.md | 75 | 17 | 31 | 24 | 2 |
| Map lenses: travel, trade, campaign, image maps | A2-atlas-lenses.md | 66 | 10 | 25 | 25 | 6 |
| Campaign manager | B-campaign.md | 82 | 4 | 46 | 16 | 17 |
| Writing, timeline, trees, tables, codex | C-writing.md | 113 | 39 | 48 | 21 | 5 |
| Smaller tools | D1-tools.md | 69 | 20 | 25 | 17 | 12 |
| Platform surfaces | D2-platform.md | 88 | 20 | 40 | 12 | 16 |

Counts are grep counts over each table (a row may mention two statuses). They
are a work list, not a parity score. Each file ends with ranked offline gaps,
implementation sketches, risks and UNKNOWN items.

The counts above are from the first pass. The status cells in each file are the
current ones, updated in place with "(1095: …) — was X" where a wave delivered the row.

## Delivery waves

Wave 1, maps (Luis's priority): saved look per world; blank sea/land starters;
area measurement and reference-outline scale; hand-placeable stamp library;
travel profile (ways, pace, ground costs, day hours) with MCP planner; label
handles; map versions linked to timeline events with playback.
Later waves follow the ranked lists of the other areas. Every delivery keeps
existing capabilities and is proved through UI, MCP, persistence/reopen and
export where relevant, then independently reviewed.

## Delivered so far (worktree writer-vvd1095, integrated into main at commit deeeba9 on 22-10-2026, without push)

Each item was shown through the normal UI with trusted input, through MCP
(focused tests, and the native stdio transport where noted), across reopen, and
reviewed independently (rounds r1–r13, r13 approving: stamps from r4, grid and playback from r5, reader's fog from r6, story events from r7, trade lens from r8; classic map styling and the later waves were reviewed in r9–r13; reports in
`D:/LocalAI/_claude_tmp/vvd1095-review`). Evidence screenshots:
`D:/LocalAI/artifacts/writer-vvd1095`.

| A1/A2 row | What changed | Status now |
|---|---|---|
| A1 #1, #2 blank sea / land | Presets, Coast brush, shape controls off with a way back | PRESENT |
| A1 #35–36 look saved with the map | Per-world look for views, exports and MCP; Base shared while an era inherits | PRESENT (the look set is still Writer's four) |
| A1 #39 scale compare | Ten real outlines laid at true scale | PARTIAL (no "set map width" control) |
| A1 #43 measure area | Ruler loop area and perimeter, polar caps | PARTIAL (no hover-a-zone area) |
| A1 #52 label handles | Rotate, spacing, curve handles; exact size/angle/spacing/curve | PARTIAL (size by slider, not four resize handles; no rank "Title") |
| A1 #59 stamps | 32 stamps in four categories, S/M/L, names, all views | PARTIAL (no per-glyph colour schemes, row 61) |
| A1 #71–72 versions on the timeline | Era ↔ event links, calendar order, play, orphans, portability | PARTIAL (no snapshot strip, no "open in Timeline") |
| A2 travel rows | World pace, speeds, ground costs, per-leg modes, rest days, MCP planner, day-by-day playback | see A2 rows #29–#37 (trade lens is in its own row below) |
| A2 #20, #21 reader's view and fog brushes | Fog brush Seen/Heard/Hide with chapter; Reader's view per chapter in atlas, Carta and PNG; MCP paint/view/render | PRESENT (not in 3D) |
| A2 #25 story playback | Previous / Play / Next and a scrub bar through the chapters in the Reader's view; the map follows each chapter's events, a caption names them and what is planned next; MCP wh_story_chapters | PARTIAL (no session replay, "Now" or "As you saw it") |
| A1 #14 view band | "Mundo / Continente / Región / Comarca · N km de ancho" on the atlas, following the zoom | PRESENT |
| A1 #20 fantasy grounds | Fantasy row in the Biome brush; travel classes and leg names; MCP wh_paint_biome, wh_place_at ground | PRESENT |
| A1 #24 plateau | Relieve → Meseta: square, flat-edged head in one click | PRESENT (lifts evenly, does not level the top) |
| A1 #30 contour lines | Toolbar: as the look, none or every 100/200/500/1000 m on atlas, Carta and export; saved with the look; MCP presentation contours | PRESENT (not in 3D) |
| Map tool 3D look | Plane with the whole world: tabletop model (cut walls with water column, soil, strata, plinth; lit table and soft shadow; sea clipped to the block) or landscape; saved with the look; landmark marks as in 2D; road seam cut; globe relief tamed; MCP presentation stage3D | PRESENT (no clouds, no standing tree cards, one block look) |
| Maps tool portrait pins | Pins linked to an entry with a picture show it framed in the pin colour with the name under it; Portraits and Names layers; SVG export; MCP wh_set_map_layers | PRESENT |
| Map tool painted 3D | Skin Pintado: painted relief map (blended grounds, rock and snow, shelf and coast rings, painted forests and dunes) with a flat painted sea; map lettering over Pintado and Dibujado; Dibujado shows its 2D colours; satellite tiles below a region; MCP skin3D pintado | PRESENT (trees painted flat, not standing cards; no clouds) |
| A2 #34, #36, #41 journey in words | Sentence, towns passed with km, roads named by their towns, day and part of day per stretch, set-off / camp / arrival clock, inns and ruins for the nights; MCP wh_plan_journey | PRESENT (no travel by air) |
| A2 #59 roll a name | Roll button on Point → Label: names for region, water, range and place labels in the world's languages, with etymology; MCP wh_roll_name | PRESENT |
| A2 #61 play grid and map settings | Grid Off / Square / Hex with km size in the toolbar (see A1 play grid), themes and paper | PRESENT |
| A2 #28 reader's map settings | Start state saved with the look; route marked as seen with sight radius and chapter | PARTIAL (no "land in ink", towns as dots or trail) |
| A1 play grid | Square/hex grid in km over atlas, Carta, PNG export and MCP render | PRESENT (atlas: equirect and Mercator) |
| A2 #43–47 trade lens | Deterministic economy: sites by ground, needs, granaries, shortages, prices, road and sea shipments, month playback; Trade tab; sites and shipments on the map; MCP | PRESENT except #46 PARTIAL (no per-port goods list); no population growth |
| A2 #5–10, #12–13 classic map styling | Several layers per item, drawing order, add/remove vertex, outline, hatch, lettering, pin size and icon; SVG export; MCP map features | PRESENT except #12 PARTIAL |
| A2 #22, #24, #26 story events and party marks | Events by kind (incl. travelling, camp, inn), chapter, planned/happened, note; place, edit, drag, remove; story so far by chapter with order inside each chapter (earlier/later) and who was there (Codex characters and factions, named in the playback caption); reader's view by chapter; exports; MCP who/order | PRESENT (order by arrows, not drag; chapters, not real-life sessions; playback is row 25) |
| A2 #14, #15, #18 classic map picker, right-click menu, ground change | Searchable Codex link that creates entries by type; right-click new entry / pin / region / route / label / comment at the spot (map_point notes drawn on the map); change-picture dialog with keep/stretch, era saved first, comments move too; MCP wh_annotate `at`, wh_preview/change_map_ground | PRESENT |
| A2 #51–54, A1 #44 classic map scale | Width in km (typed or from a measured distance), scale bar, measure tool, lengths/areas/travel times, real places at true size, road/trail/river paths with thickness and solid/dashed/dotted line, drawn with Enter/Backspace/Escape and bent by halfway handles, pasted key names lettered pins; MCP set_map_scale, measure_map, name_map_pins_from_key, linePattern | PRESENT except #51 ground kinds |
| A2 #27, #33 journey stops | Ends and stops as towns or points of open ground; stop list with earlier/later and remove; legs and route follow; MCP wh_plan_journey {x,y} stops | PRESENT (arrows, not dragging the line) |
| A1 #29 sea level and snowline | Paint → Whole world sliders (one undoable edit each): sea level moves every height and the biomes follow; snowline moves where snow is drawn in every 2D renderer; MCP wh_set_world_levels, wh_get_world | PRESENT (rivers keep their courses until Recalculate) |
| A1 #27 lake tool | River tool Water → Lake: click fills the hollow to its spill (Least size dams a bigger one), Ctrl+click drains; survives recalculation; MCP wh_add_lake, wh_drain_lake, lake in wh_place_at | PRESENT |
| A1 #56 duplicate and lock a place | Index card and Place inspector: Duplicate (town, ruin, landmark → "<name> 2" on the nearest free dry cell) and Lock/Unlock (one rule for every tool, card and the bridge: not moved or hidden; the Move tool says why); MCP wh_lock_place, wh_duplicate_place, locked in place lists | PRESENT (realms/seas not copied; reshaping the ground under a locked town can still drown it) |
| A1 #63 line thickness and pattern | Hand-drawn world roads: Line (solid/dashed/dotted) and Thickness (×0.5–3) on the Road tool, drawn on map, 3D and Carta; MCP wh_add_world_road routes one between two places; classic routes as above | PRESENT (generated roads keep the theme's line) |

Commits: 22cdf7d, dd8f6a5, 4849ac8 (look, blank starters, measure, travel),
6b3a3e6 (review r1), 3258e65 (map eras), 59e7ad9 (review r2), 07f14f6 (labels),
fef1c9a (stamps, review r3), 342b8b7 (playback, grid, review r4) and the reader's-eye fog and review-r5 commit that follows.

## Wave C — writing, publishing, Codex, timelines, trees, tables (integrated into main on 23-10-2026, without push)

Matrix: [C-writing.md](C-writing.md) — 107 of 113 rows PRESENT, 5 n/a (online
hosting, plans and embeds), 1 PARTIAL (#1, several stories inside one world).
Each row names the focused test or QA runner that proves it; the suite is in
`scripts/run-vvd-tests.cjs`, the QA runners are `run-board-quick-qa`,
`run-sprint-rounds-qa`, `run-tree-groups-qa`, `run-timeline-calendar-qa`,
`run-timeline-duplicate-qa`, `run-world-reader-plus-qa` and
`run-workspace-library-qa`. An independent review (12 findings: sheet
references after inserts, table query sanitising, timeline settings undo per
era, re-dating into a missing leap month, calendar re-date undo, ePub book
style scoped to chapters, publishing profile presets, Word inline image size,
engine checks on three tools, eraser on turned strokes) was fixed and each
fix has a check in `tests/review-1095c.browser.tsx`. Bridge tools: AI-BRIDGE
section 29. Known limits: PENDIENTES, "Escritura 1095 (ola C)".

## Maps after fb67d94 — sheet, zones, relief, 3D, light, ways, reader (integrated with wave C)

A1 #3, #17, #23, #25, #28, #33, #34, #66, #67 and A2 #22, #26, #28, #29, #30,
#38, #46 updated in place ("— was X"). Tests: `world-sheet`, `world-zones`,
`world-terrain-ops`, `world-3d-model`, `world-light-ways`, `world-reader-plus`,
`world-trade-routes`, `world-story-scenes` (focused) and the QA runners
`run-world-{sheet,zones,terrain-ops,3d-model,light-ways,reader-plus,routes-scenes}-qa.cjs`.
Bridge tools: AI-BRIDGE section 28 ("Mundos: hoja a la medida…"). An
independent review of these waves found no blocker; its findings were fixed
before the merge: the trade lens is worked out off the click (a moment after
the tab opens or the last stroke, a few shipment ways per frame), a day never
holds more than 24 moving hours (night ways at a hard pace), the 3D readout
and the zoom tiers use the sheet's own kilometres, trade ways keep their line
round the seam, a river put down point by point needs two different cells,
and zone hatching is anchored to the map so it does not slide while panning.

## Wave D1 — tabletop tools (first part)

Matrix: [D1-tools.md](D1-tools.md) — 44 of 69 rows PRESENT (was 19), 14
PARTIAL, 1 ABSENT on purpose (#66, licensed art), 10 online. Tests:
`compendium-encounter`, `table-tools`, `board-context-menu`,
`world-graph-settings`, `soundscape`, `kanban`, plus additions to
`codex-reference-panel`, `model-viewer`, `writing-blocks`. Bridge tools:
AI-BRIDGE section 30. Known limits: PENDIENTES, "Herramientas de mesa 1095".
An independent review (11 findings: Excel export and import, formulas, undo
safety, live-table export, the mixer) was fixed, each with a check in
`tests/review-1095d1`.
