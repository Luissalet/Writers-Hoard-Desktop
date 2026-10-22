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
| A2 #25 story playback | Previous / Play / Next through the chapters in the Reader's view; the map follows each chapter's events and a caption names them; MCP wh_story_chapters | PARTIAL (no scrub bar or "next planned") |
| A2 #28 reader's map settings | Start state saved with the look; route marked as seen with sight radius and chapter | PARTIAL (no "land in ink", towns as dots or trail) |
| A1 play grid | Square/hex grid in km over atlas, Carta, PNG export and MCP render | PRESENT (atlas: equirect and Mercator) |
| A2 #43–47 trade lens | Deterministic economy: sites by ground, needs, granaries, shortages, prices, road and sea shipments, month playback; Trade tab; sites and shipments on the map; MCP | PRESENT except #46 PARTIAL (no per-port goods list); no population growth |
| A2 #5–10, #12–13 classic map styling | Several layers per item, drawing order, add/remove vertex, outline, hatch, lettering, pin size and icon; SVG export; MCP map features | PRESENT except #12 PARTIAL |
| A2 #22, #24, #26 story events and party marks | Events by kind (incl. travelling, camp, inn), chapter, planned/happened, note; place, edit, drag, remove; story so far by chapter; reader's view by chapter; exports; MCP | PRESENT (no per-session numbering or "who was there" list; no playback, row 25) |
| A2 #14, #15, #18 classic map picker, right-click menu, ground change | Searchable Codex link that creates entries by type; right-click new entry / pin / region / route / label / comment at the spot (map_point notes drawn on the map); change-picture dialog with keep/stretch, era saved first, comments move too; MCP wh_annotate `at`, wh_preview/change_map_ground | PRESENT |
| A2 #51–54, A1 #44 classic map scale | Width in km (typed or from a measured distance), scale bar, measure tool, lengths/areas/travel times, real places at true size, road/trail/river paths, pasted key names lettered pins; MCP set_map_scale, measure_map, name_map_pins_from_key | PRESENT except #51 ground kinds and #53 bend handles |

Commits: 22cdf7d, dd8f6a5, 4849ac8 (look, blank starters, measure, travel),
6b3a3e6 (review r1), 3258e65 (map eras), 59e7ad9 (review r2), 07f14f6 (labels),
fef1c9a (stamps, review r3), 342b8b7 (playback, grid, review r4) and the reader's-eye fog and review-r5 commit that follows.
