# Writer publishing workspace

Writer retains its document editor, origin5174/IndexedDB and independent fiction worker. Library, reading, paperwork and publishing are four independently controlled native modules. Initial catalogue/status is cold; API/MCP/UI share the existing401 publishing tools and native IDs/formats. Real profiles/tokens/conversations are not migrated by source changes. Cicero remains separate; Borges belongs to Writer, not Hypatia. Home/Cook and People/Dorian remain separate.

931 CAS5: failed shutdown retains app/resources and worker; ON/new native requests are rejected until explicit Retry OFF succeeds. Four factories expose cleanup checkpoints; EOF retries only cleanup. Kafka owned client closure propagates failure without editing SDK; editorial sessions remain retained through complete joins. Native DOM stays mounted while an owner is retained.

Synthetic source and frozen-worker checks exercise all four factories. --worker-only reconstructs the frozen worker without Rust builds; native binary hashes are preserved. See docs/PUBLISHING.md and tasks/submission931-cas5.md for evidence and limits. Root owns independent review, CUA, real migration, aliases, installation/activation and publication. No installed app, personal data/model/Hub or original source repository was changed.


HTTPX closure: is_closed is not proof of released resources. The owned wrapper snapshots actual default/proxy transports and HTTPcore connections before a pool can consume its list, then checkpoints each physical close. Tests cover a real SDK twin poisoned by early HTTPX CLOSED, two failing OFFs, a held third close with consumer cancellation, and an actual HTTPcore/HTTP11 pool path. SDK files remain unchanged.

CAS6 corrects repeated completed physical cleanup: after success, a connection is removed by identity from its pool under the pool lock; failed connections stay owned. The final transport close does not invoke completed connection closes again. CAS5 remains historical; final package/test evidence is recorded separately in tasks/submission931-cas6.md.

## Local world-authoring tool context (2026-10-21)

Use [WORLD_AUTHORING](docs/WORLD_AUTHORING.md) for current capabilities and limits;
this extension preserves the native publishing factories and their lifecycle
above. UI and MCP reuse scoped product operations. Read the current project,
document and optional era before writing; omitting `eraId` means Shared base.
Do not infer a pane's scope from another open pane, guess revisions after a
conflict, or overwrite an author's unsaved draft to make a retry succeed.

Maps: read before writing. `wh_get_world_presentation` and
`wh_get_world_travel_settings` return revisions to pass as `expectedRevision`;
`wh_list_labels`, `wh_list_stamps` and `wh_list_map_versions` return the keys and
ids that `wh_update_label`, `wh_move_place`/`wh_rename_place`/`wh_remove_place`
and `wh_link_map_version` take. A painted label or stamp key is where it was
first placed (`label:x,y`, `stamp:x,y`, with `#n` for a second one in the same
cell), never its current position. The reader's-eye fog is separate from the
world: paint it with `wh_paint_reader_fog` (seen/heard/hide, optional chapter),
check what the reader knows with `wh_reader_view` before describing a place as
known, and render it with `wh_render_world_map` `readerView`/`readerChapter`. Story
events (`wh_list_story_events`, `knownByChapter`) say what happened where and
when, in which order inside a chapter and who was there (`who` Codex ids, `whoNames`), and `wh_story_chapters` gives the story chapter by chapter with how much
of the map the reader knows by each; read them before describing what a character could know, and keep
planned events apart from happened ones. For trade, famine or prices in a
scene, ask `wh_world_economy` for that month and settlement instead of
inventing figures; it is deterministic for the world. To add a river that
follows the ground, use `wh_add_spring_river` from its source (`dryRun` first
to see where it ends) instead of drawing one by hand; when a story lives on one island or one country, create the world with `wh_create_world` preset `island`, `country` or `continent` (and `landmassKm` for another size) instead of carving it out of a planet; when the story says a ford washed out or a bridge fell, close that crossing with `wh_set_river_crossing` (`blocked: false` opens it again) and let `wh_plan_journey` find the way round (it reports `fords`, `bridges` and `frozenRivers`); to change the ground of an area (a fungal forest, an ash plain) use `wh_paint_biome` and check it with `wh_place_at`'s `ground`; to tell a journey in a scene, use `wh_plan_journey`'s `passes`, `roads`, `clock` (set `setOffHour` when the text says when they leave) and each night's `shelter` rather than inventing towns, roads or hours; to show the whole world in 3D as a tabletop model or as a landscape set `stage3D` (maqueta/paisaje) with `wh_set_world_presentation`, and `skin3D: "pintado"` for a hand-painted relief map; on a classic map, `wh_set_map_layers` shows pins as their entries' portraits and every pin name; move the sea level or snowline with `wh_set_world_levels` only when the author
asks; to name a region, sea, range or town label, offer names from `wh_roll_name` (in the world's own languages, at the spot when you have one) instead of inventing them; for a lake use `wh_add_lake` (`dryRun` first,
`size` only when the author gives one) and `wh_drain_lake` to remove one; a place marked `locked: true` is
the author's to move: do not unlock it with `wh_lock_place` unless asked; copy a
town with `wh_duplicate_place`; to lay a road between two
places use `wh_add_world_road` (`dryRun` first; `width`, `pattern` only when
the author asks for a look). For a story set on one island or country, keep the land on its own sheet (the default for those presets; `worldKm` only when the author gives a size); name regions the author describes with `wh_add_zone`; change relief with `wh_shape_terrain` (`volcano`, `height` with `heightM`) and rivers with `wh_draw_river` / `wh_reverse_river` only when asked. Use the world's own ways (`profile.ways`, `wh_plan_journey way`) for how a party travels, `wh_render_world_map hour` to see a scene's light, and link a story event to its chapter (`writingId`). On a classic (image) map,
positions are percent of the picture: list shapes with `wh_list_map_features`
before changing one, leave a comment about a spot with `wh_annotate` `at`, and
before replacing the picture call `wh_preview_map_ground`; only use `fit:
"stretch"` in `wh_change_map_ground` when the author wants shapes stretched.
For distances or travel times on a classic map use `wh_measure_map` (it needs
the map's scale; set one with `wh_set_map_scale` only when the author gives
it), and name lettered pins from a key with `wh_name_map_pins_from_key`
(`dryRun` first).

Writing (wave C): read before writing here too. To put a rules box in a
chapter, call `wh_codex_rules_card` without `writingId` first to see which
slots it filled and which it left empty, and fix the mapping with `slots`
rather than inventing values for empty ones. `wh_extract_block_to_card` moves a
block: list the blocks with `list: true` and pass `expectText`. Use
`wh_text_effect` only when the author asks for an effect; effects are for the
screen and print plain. Dates: in a calendar with a leap month, a date in that
month exists only in leap years; ask `wh_world_date` instead of computing it,
and with a Gregorian correlation use its `earth`/`earthDate`. Change a
calendar with `wh_world_calendar_set` without `redate` first: it refuses a
calendar that would strand events and says which; `redate: true` moves them to
the nearest date that exists (undoable). In sheets,
inserting or removing rows and columns moves formula references; a reference to
a removed cell reads `#REF!`. Book layout belongs to the publishing profile
(`bookStyle`), not to the chapters' HTML.

Tabletop (wave D1): rules facts come from the bundled SRD 5.2 compendium
(`wh_compendium_search`/`get`), not from memory; add an entry to the world only
when asked. Run fights through `wh_encounter_action` with the revision read last.
Roll with `wh_dice_roll` instead of inventing results, and say natural 20s and 1s
as they came. Offer names from `wh_name_generate` (with the author's brief) and
make a card only on request. Tasks and boards (`wh_todo_*`, `wh_kanban`) are the
author's: add or change them when asked. In sheets, formulas may use Spanish or
English function names; an Excel import says what it did not keep.

For Library creation, read `wh_workspace_library_get`, then pass `folderId` and
`expectedLibraryRevision` to `wh_create_codex_entry`. An empty folder ID means
Unfiled; omitting placement options keeps ordinary card creation. A conflict
requires a fresh read and explicit review, not an unfiled fallback.

The `wh_writing_tool_dock_*` family reads/applies layout and block operations and
Undo/Redo with observed versions and receipts. Its owner is the real Project or
chapter; the dock is authoring metadata, not manuscript or exported reader prose.
`wh_project_duplicate_preview` returns the source version and asset findings.
`wh_project_duplicate` needs that version and a stable caller operation ID;
reuse it after interruption and inspect `complete`/`unfinished` rather than
creating another destination. `wh_project_duplicate_undo` preserves edited copies
and shared originals. It does not upgrade legacy JSON clone coverage.

Local source tools execute trusted built React code, not downloaded arbitrary
JavaScript. Recognition/search needs prepared cached models; text generation
uses the configured global runtime. Neither these tools nor this documentation
activates a module or model. The 21 October composed source checks pass: 210 groups across 44 suites with
0 failures, 383 critical checks, renderer/Electron builds, shipping lint with
0 debt and conformance (34 engines, 64 tables, 5650 keys, 22 locale files).
The production entry is 1589.09 kB, below the blocking 1600 kB budget; lazy/total
size advisories remain. Production dependency audit reports 0 vulnerabilities.
Native document-service tests pass 14 with 0 skipped; directory packaging,
packaged startup smoke and CPU dependency checks pass. D3, W01, the bounded 5e
profile, map M1/M2/M3 corrections, Archive and legacy-tool corrections have
independent SHIP verdicts within their reviewed contracts.

These are composed checks, not a global `verify:release` result. The inherited
full development audit still reports 13 findings, and the optional `resources/bin`
packaging warning remains. QA, manual and repository documentation are complete;
Git integration remains pending.
Installation, the real user profile and total feature parity are not certified.

Composed evidence: `D:/LocalAI/projectlesswork/worldcraft1041-vvd-suite-corrected-final.log`
and `worldcraft1041-critical-final-composed.log`; build, budget, packaging and
audit logs are alongside them. CPU checks load packaged dependencies without
model inference, model downloads or GPU activation.

The manual update used requiredRevisionId and exact content readback; see
`tasks/evidence/worldcraft1041-manual-verification.json` and the remaining limits
in [final verification](tasks/worldcraft1041-final-verification.md).

## Session and picture-map preparation (2026-10-23)

The outline planner groups table sessions by prep/next/live/played and exposes
revision-checked status/date/note operations. Check, encounter and handout blocks
use the same editor, gallery and combat operations as the UI. Comments expose
read state and positioned pins on boards and maps. Picture-map exploration is
a visual mask; the exported asset still contains the complete picture. Wiki
map navigation, artwork and audio are opt-in. Named MCP keys support independent
revocation while preserving the existing Principal token. See
[tasks/vvd1095/verification-D345.md](tasks/vvd1095/verification-D345.md) and the
D2/Bmatrices for proof, scope and remaining gaps.
