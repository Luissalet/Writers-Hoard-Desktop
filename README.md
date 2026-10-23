# Writers Hoard — Desktop

[Español](README.es.md)

Local-first creative writing platform, packaged as a desktop app with
**Electron**. Same React/Vite/Dexie codebase as the web build, wrapped in a
native shell that lifts the browser storage ceiling and bundles real media
downloaders (`yt-dlp` + `gallery-dl`) — no separate Python server.

> Transition plan and rationale: [`tasks/desktop-transition.md`](tasks/desktop-transition.md)

## Offline planning and local publishing (task1095)

Calendar event titles now open the existing full event editor directly. Save/Cancel returns to the same month and selected day; clean Escape also restores keyboard focus to the event button. Timeline ownership, pane era and failed-save drafts are preserved. Source `4e4bf5d` is integrated after independent CAS12; clean-main verify/build passed (Vite27.91s, Electron and Node932). Existing recurrence and range logic is unchanged. [Calendar evidence and limits](tasks/vvd1095/verification-calendar.md).

Calendar bands also support Plain, Ribbon, Bunting and Scallop shapes independently of their fill patterns. Shapes preserve continuity across days and show titles at occurrence/week/month starts; Plain retains its earlier display. Source `2f21eed` is integrated after independent CAS 14. Its final clean-main build passed (Vite 27.77s, Electron and Node 934), and the manual update is recorded separately. Year view remains points and wiki remains an event list. [Shape evidence and limits](tasks/vvd1095/verification-calendar-shapes.md).

Scoped SDK audio `7c4e3fb` is integrated after independent CAS13, a corrected-source Browser repeat and clean-main verify/build (Vite26.31s, Electron and Node934). It adds scoped local playback/hooks and SDK-owned bus/focus handling; legacy Soundscape/Reader graphs remain separate. MCP play returns gesture-required without playing or queuing sound. That audio-only source did not include resource defaults; native resources are covered separately below. Exact upstream signatures, spatial audio and measured levels remain outside the partial contract. [SDK audio progress and limits](tasks/vvd1095/verification-sdk-audio.md).

Source `d542365` adds native tool resources: bundled image/audio defaults, document → installation → package selection, Revert, scoped asset MCP tools and portable references. AssetPad uses the normal owned-block menu. Independent technical review records 34 distinct focused groups (18 author + 6 reviewer + 10 legacy); normal Brave confirmed imports, selection/Revert, save/reopen and a 96px read-only preview. Approved CAS15 and integrated FF-only from f44e387 to exact d542365 under a fresh merge lock, with clean main. Final verify:quick/shipping lint, Vite28.92s, Electron and Node937/schema2PASS completed; root session2655 exited0 and the merge lock was released. The Google manual update added588 UTF-16 units with requiredRevision/readback,198 paragraphs,197 others and all styles preserved; both manual locks were released. Own SDK signatures remain partial; installation has CAS/Revert without Undo, font/data have Blob defaults without a generic picker, and wiki may apply its own SVG frame. [Resource evidence and final receipts](tasks/vvd1095/verification-sdk-assets.md).

Notes can opt into Rich text using the existing editor for headings, lists and local raster images. Saved rich HTML keeps a matching plain-text projection for search, Copy, AI context and existing clients; quick capture with Enter stays plain. Native MCP writes/Undo, eras, captured wiki pages, document-image sources and JSON/ZIP/clone preserve the supported content. [Verified note flows and limits](tasks/vvd1095/verification-notes.md).

Atlas Index→Place and cards opens the existing place inspector. Create a Codex card of the selected type from the confirmed place name, link other cards or open a linked card in its normal pane/era. Creation/link and native Undo are atomic; project JSON/ZIP preserve their links. Source `ff3baead`, independently approved CAS10, is integrated and passed root's Browser flow and clean-main build. Card search/aliases and automatic rename synchronization are not added. [Atlas-to-card verification and limits](tasks/vvd1095/verification-place-cards.md).

Typed-table filters also support negative containment, prefixes/suffixes and inclusive lower/upper bounds. The existing `wh_table_query` uses the same operator list and evaluator as the UI; old filters remain available. [Live comparison and verification](tasks/vvd1095/verification-tables.md).

Source tools can declare portable indexed fields and document references, query saved effective documents through `client.queryDocuments()` / `useLocalToolIndex()`, and expose the same query through MCP. The initiative authoring example includes participant/minimum-initiative filters. Normal project search can find declared values inside lists and maps. Focused source-tool documents, owned blocks and legacy tool views support Ctrl/Cmd+Z, Ctrl+Shift+Z and Ctrl+Y using their existing scoped receipts; editable text keeps native Undo and global shortcuts remain available.

Call of Cthulhu paper and read-only views now include investigator conditions, era/Pulp mode, daily sanity and pending checks, characteristic targets, automatic/manual derived values, development marks and linked pushed-roll context. New sections follow the existing content and ink without moving the original tables. Recalculation, a new day and skill development use a non-destructive confirmation. See [live comparison and verification](tasks/vvd1095/verification-live.md) for the tested scope and limits.

Saved CoC investigators also offer a roster and an optional compact linked view with HP/Sanity/Luck, eight traits and up to five explicitly selected skills, independent of development marks. Full paper remains the default. Editable owned embeds can roll regular/hard/extreme checks against the saved source and undo the source roll; About, Reader and exports stay read-only. Codex About resolves saved tool/source blocks and references; the player view retains its existing reveal/private-field rules. Source tools can subscribe to scoped world document lists/reads through `useLocalToolWorldList()` / `useLocalToolWorldRead()`; the WorldCardList example follows committed card creation, renaming and archiving without reopening its host. [Compact views, live SDK reads and verification limits](tasks/vvd1095/verification-compact.md).

Named wiki profiles can publish selected notes, tables, boards, timelines, character sheets, dictionaries, relation trees, radar charts, 3D models and declarative local-tool documents as their own pages. Search and bulk include/omit/move controls, nested sections and drag ordering share the saved profile and immutable local editions. Boards publish their visible cards as a semantic list; spatial drawing and soundscape pages remain outside this delivery. Source-era policies, secret fields and exclusions still apply before content and assets are resolved.

Project Overview adds monthly creation counts for existing writings, scenes, Codex entries, notes, outlines and research sources, a contextual next action and manual navigation tips. Overview and the command palette can create writings, notes and outlines through their normal operations; writings/notes support eras, outlines remain Base-only. Filtered search syntax never becomes a new document. Library documents have a right-click pin menu with revision-checked Undo and a window-session list of documents opened from the Library. Optional snow, rain, embers or fireflies respect reduced motion and performance mode.

Fiction sessions can be planned separately from starting play, with date/time, local timezone, duration, place, hook, private DM notes and attendance. Author-written recaps stay drafts until marked ready to share locally, which also marks the session played; no external posting occurs. Retired characters remain in the world and can be changed explicitly from linked attendance after a session. The original19 tools and session row shapes are unchanged; three session tools are additive. See [offline scope and limits](docs/OFFLINE-PREPARATION.md).

## Library and publishing

Writer incorporates the full library, reading/links, paperwork/PDF and Gutenberg editorial engine/editor as independent modules, initially OFF. Native formats and MCP contracts are retained. See [capabilities, verification and migration](docs/PUBLISHING.md). Existing fiction and profile/origin 5174 are preserved.

## Interactive fiction

Writer includes Scheherazade's worlds, continuity, sessions, dice, threads,
clocks, narration and exports. Open **Interactive fiction** in the sidebar;
worlds/play, global-model narration, voice and illustrations have independent
switches, all **OFF** initially. Existing fiction data stays in its original
directory. The complete UI, 19 original MCP tools and native API are incorporated
in Writer; the former server is unnecessary. The installed app includes its
private worker runtime. See [operation, data and limits](docs/FICTION.md).

## Local world authoring

The current source adds named eras over Shared base, independent document panes,
a mixed Library, reusable Codex types/properties and contextual document editors.
Library's **New card** reuses the normal Codex form and saves the card with its
selected folder atomically. Manuscript tools can sit in a separate, reorderable
dock with project/chapter inheritance; its layout does not become reader prose.
Maps, trees, calendars, typed tables, local media, Reader and static wiki retain
their document-specific editors and exports. Generated worlds keep their look, start
blank if wanted, measure areas against real outlines, plan journeys with the
world's own pace and travel physics (told in words: towns passed, roads followed, day and hour of each stretch, inns), and carry editable labels (angle, spacing,
curve, names rolled in the world's own languages), 32 map stamps, a square or hex play grid, hand-drawn roads with their
own thickness and pattern, places that can be duplicated or locked, a reader's-eye fog that
reveals the map chapter by chapter, story events placed by chapter and played
back chapter by chapter or scrubbed to any chapter (with their order inside a chapter, who was there
and what is planned next),
a right-click menu (village, note, story event, a
spring whose river finds its way downhill, no crossing / open the crossing again on a river), river fords that cost a party time (bridges on the roads do not; frozen rivers in a hard winter are walked over), a lake tool that fills a hollow to its spill, worlds of a single island, country or continent of a chosen size (300 to 9,000 km) that the map and the 3D tabletop model frame, fantasy grounds and a one-click plateau brush, contour lines at a chosen interval, a whole-world sea level and snowline, a 3D view of the whole world as a tabletop model (its cut through rock and sea showing, on a table with its shadow) or as a landscape to the horizon, a Painted skin (grounds that melt into each other, a sea with shallows and coast rings, painted forests and dunes, names lettered like a map), with the 2D map's own landmark marks, clouds and a block of rock, stacked paper or an engraving with standing trees on the model, a single land on its own flat sheet of its size, named zones, volcanoes and heights in metres, rivers drawn point by point or turned round, the map at an hour of the day with the party's lantern, the world's own ways of travel (a griffin, a sledge), each port's sea trade, a reader's view with the land in ink, towns as dots and the party's trail, story events linked to their chapter, and a
month-by-month trade lens (sites, shortages, prices, shipments); classic image
maps carry styled shapes (outline, hatch, lettering, drawing order, several
layers), pin sizes, pins that show their entry's picture framed in their colour with the name under it (and every name in view on request), a searchable Codex link that can create the entry, a
right-click menu (new entry, pin, region, route, label or comment at that spot),
a confirmed picture change that keeps shapes in proportion, a scale with a
measuring tool, lengths, areas, travel times and real places at the same
scale, road/trail/river paths with their own thickness and solid, dashed or
dotted line (drawn with Enter to finish) and a pasted key that names lettered pins;
hand-drawn map eras can follow timeline
events and play in sequence. Each has bridge tools (see docs/AI-BRIDGE.md, section 28). The optional 5e (2014), SRD 5.1
character profile preserves manual values and played counters; it is not a
complete rules or spell-catalogue engine.

**Wiki look and publishing (task 1095, wave D2).** The offline wiki's appearance
editor now has a catalogue of 20 named palettes (light, dark, book and high
contrast, all readable), a "Save my palette" list that is renamed and deleted in
place and travels with the profile in backups and clones, footer links (web or
mail addresses only) with a signature line, and terminal extras for the Terminal
and Shell layouts: phosphor colours, CRT scanlines, dithered pictures, a boot line
and an editable "New here?" command list. Profiles that use none of it export the
same bytes as before. The export panel shows what changed since the last local
edition ("Publish (3 changes)" with added, changed and removed documents); the
read-only bridge tool `wh_wiki_profile_changes` returns the same list.

**Wiki maps (task 1095, wave D2).** Exported wiki maps can now be moved and zoomed
(drag, pinch, Ctrl + wheel, keys; free or contained in the frame, with a reset
button and pins that keep their size), show optional illustration layers
(background, middle, foreground) that drift gently while the reader pans (still
under reduced motion) with a drifting cloud overlay the reader can hide, and loop
ambience for the map and for each pin that starts only when the reader presses the
sound button. All of it is off by default and a profile that does not ask for it
exports the same bytes as before. The layers and ambience live on the map in the
map editor ("Capas de ilustración") and travel with backups and copies; the bridge
tools `wh_map_artwork_get` and `wh_map_artwork` (revision-checked, undoable) set
them. See `docs/wiki-appearance.md`.

**Assets library (task 1095, wave D2).** The project's Assets tab now lists
pictures, sounds, videos and 3D models together: search by name or tag, six
sort orders, a kind filter, multi-select, download and rename. Deleting reads
where the asset is used first ("Used in N places: ...") and then goes through
each tool's own delete path, with Undo for pictures and sounds. In the desktop
app a sound or video of 8 MB or more offers **Compress** (only when asked,
cancellable, sizes before and after, saved as a copy or in place of the
original). The crop dialog has named frames (avatar, cards, banner, cover,
wallpaper) with a "too small" notice, and the gallery lightbox zooms and pans
(wheel, drag, `+`/`-`, `0`, arrows). Bridge tools `wh_list_assets` and
`wh_asset_usage` (docs/AI-BRIDGE.md, "Biblioteca de recursos"); matrix: tasks/vvd1095/D2-platform.md.

**Comments: read state and pins (task 1095, wave D2).** Comment threads now
know whether you have read them. Threads you write are read; threads and replies
that arrive through the AI bridge are unread until you open them (touching a
thread or clicking its pin is enough). The comment list shows "N unread", can
sort "Unread first", mark one thread read or unread, or "Mark all as read" (one
Undo for the lot), and the Interconnectedness tab in the sidebar (where comments live) carries a gold unread
pill. The project's comment dashboard also filters "Only unread" and "Only this
document". On a board, right-click the empty canvas and choose "Comment here"
to pin a comment to that point: the pin follows pan and zoom, survives a reload,
can be dragged, and clicking it opens its thread; classic-map point comments
open their thread the same way. Bridge: `wh_annotation_mark_read`,
`wh_annotation_mark_all_read`, `unreadOnly` on `wh_list_annotations`, `at` on
`wh_annotate` for boards (docs/AI-BRIDGE.md, "Comentarios: leídos y chinchetas").
Not built: pins on the generated world map, off-screen marker arrows, a
hide-markers switch. Matrix: tasks/vvd1095/D2-platform.md.

**Named AI-bridge keys.** In Settings, AI bridge, "Access keys" lists each key with
its name, creation date, last use and status. "New key" gives a client its own key
(the token is shown once, with buttons to copy it and the client configuration);
keys can be renamed and revoked (with confirmation, effective at once). The token
you already use stays as the main key and keeps working. The activity list says
which key made each change. Docs: docs/AI-BRIDGE.md, "Varias claves del puente";
matrix: tasks/vvd1095/D2-platform.md.

**Workspace tabs and Undo.** The companion pane's tabs can be renamed (the
document keeps its title), pinned, duplicated, closed in bulk (the others, or
those to the right) and reopened (`Ctrl/Cmd+Shift+T`, the last ten); `Ctrl/Cmd+1-9`
jumps to a tab, and an overview lists them. They come back when the project is
reopened (stored per project in this window's storage, not in the project).
Closing a tab with a brand-new empty card or chapter asks whether to keep or
delete it; deleting goes through the tool's own delete path. Archiving and
renaming a Library folder now show a toast with **Undo**, also reachable from the
workspace bar; it is refused ("could not undo: it changed since") if the
document or the Library moved on. Bridge: `wh_workspace_tabs` (read).

**Revealing lore to the players (task 1095, gap 4).** A Codex card can be marked
"Revealed" ("Reveal to the players" / "Hide again" in the card dialog, the card
editor and the Consult panel; an optional moment such as "Session 3"). Revealed
cards carry a badge, the list filters by "Only revealed / Not revealed yet", and a
"Player view" shows only revealed cards, without hidden blocks, spoiler text or the
project's excluded fields (nothing is saved). Wiki profiles get a policy "Publish
only what is revealed" (off by default; maps stay out while on; editions already
published do not change). Bridge: `wh_set_revealed` (several cards, undoable, the
undo is refused if a card changed since), plus `revealed` in `wh_list_codex` and
`wh_get_codex_entry`. Not built: the marker is per card (no per-block reveal),
fiction-engine entities have their own secrets switch and are not linked to it,
and there is no per-page "waiting for publish" dot in the Codex list yet.

**Session prep and the planner (task 1095, gap 7).** Three new outline templates for
running a table: "Session prep: eight steps" (characters, strong start, possible scenes,
secrets and clues, locations, NPCs, monsters, rewards, each with a short prompt),
"Hub and spoke" and "Three-act session". An outline can be marked "This outline is a
table session" with a date, a status (In prep / Up next / Live / Played) and a linked
prep note. A new "Session planner" tab in Outline lists sessions grouped Live / Up next
/ In prep / Played, with a quick status change, open, open the prep note and a
"New session" box; its Combat / Map / Reference buttons lay the project's first
documents of those kinds into the prep note's tool dock (undoable). The fields travel with
backups and project copies. Bridge: `wh_session_planner` (read),
`wh_session_set_status` (revision-checked, undoable) and session fields in
`wh_create_outline`. Not built: icons or colours per session, per-scene notes, choosing
which map or board goes into a layout, a PDF beside the notes, a campaign-wide hub
across fiction, maps and journal.

**Exploration fog and the party marker on picture maps (task 1095, gap 9).** A
picture map (not a generated world) gets a "Fog" strip: switch the fog on and the
whole map is hidden from the players; reveal or hide it with a round brush, reveal
or hide it all, or place the party and drag its marker, which reveals a circle of
its sight radius and, with "Leave a trail", adds a step to a trail labelled with a
session. "Player view" draws the opaque fog, hides the pins and shapes under it and
keeps the trail; the author sees the fog semi-transparent. The record (mask, party,
trail, revision) is an optional map field that travels with JSON/ZIP backups,
clones and eras. Wiki profiles get "With exploration fog" (off by default; exports
without it are byte-identical to before) and the map's SVG export has its own
"Export with fog" button. Bridge: `wh_map_reveal` and `wh_map_party` (revision
guard, undoable, engine-guarded) plus `exploration` in `wh_list_maps`. Not built:
"start in ink / land in ink" presets, sight in km, looking back by session, "near X"
placement, a party marker on generated worlds, and the picture file still contains
the whole image (the fog is a visual mask, not secrecy).

**Guided tours (task 1095, wave D2).** The compass button in the top bar (and a
"See the guided tours" link under the Getting started card, which stays) opens a
list of nine short tours over the real screen: your first world, first chapter,
first card, first map, the timeline, the board, switching tools on, publishing a
wiki edition and backups. Each step dims the screen except the element it talks
about and follows it if the window resizes; **Back**, **Next**/**Finish**, **Skip**,
the arrow keys and Esc all work (arrows are left alone while you type). A step
whose element is not on screen, or that needs a world or a tool you have not got,
is skipped with a notice instead of breaking. The list shows each tour as not
started, "Step 2 of 4" (Continue) or Done (Repeat). Progress is app-wide, kept in
one settings row, and is not part of any world's backup. A fresh install with no
worlds gets a one-time, dismissible offer. Spanish and English; no bridge tool.

**Writing, publishing, Codex, timelines and tables (task 1095, wave C).** The
editor's "/" menu offers 26 blocks (callouts including read-aloud and sidebar
boxes, toggles, checklists, sent/received messages, letter, email, column
break…), screen text effects (glow, shake, wave, rainbow, pulse, blur; still for
reduced motion and print), page-wide images and rules cards: a spell, magic
item or creature box filled from a Codex card's properties through a slot
mapping that can be refreshed. Chapters take a kicker (Prologue, Interlude),
can be held back from the book and moved before any other; a chapter's header
image sits above, beside or as a banner. Publishing adds an author byline,
title, copyright and back-cover pages, book styles (classic, modern, epic and a
two-column "sourcebook" with striped tables) with paper, format and page counts,
device previews and a per-chapter review, in HTML/PDF, DOCX and ePub. The
Reader has text size, typeface and light/dark, and a built-in library of 12
sounds made on the device; a paragraph cue can play through to a later
paragraph. The cover designer writes vertical text and erases part of a
stroke; a new project can design its cover at creation, and a saga shelves its
books on the Dashboard. Codex cards gain a type picker, alias chips, select and
required properties, frozen cards, card faces, a guided wizard, private types,
block fold/copy/extract-to-card and card drops into the manuscript. Timelines
gain duplicate and click-to-add, display precision, week modes, a leap month,
re-dating on calendar change (undoable), moon colours and phases, a date
calculator and picker, a calendar grid, repeats and banners, tags, saved views
and a Gregorian correlation that shows both calendars' events on either grid.
Relation trees gain a catalogue of relationship sets, groups, variants and
multi-select; tables gain find, insert/duplicate rows and columns (formula
references follow, a removed one reads #REF!), multi-sort and filters.
Everything has bridge tools (docs/AI-BRIDGE.md, section 29); the matrix with
evidence is tasks/vvd1095/C-writing.md.

**Game-prep blocks and player handouts (task 1095, B gaps 3 and 10).** The "/" menu
in notes and chapters now also offers three prep blocks. "Check" holds a skill, a
difficulty, a modifier and a note about what the roll reveals; "Roll" throws the
d20 with the dice engine and keeps the last result on the block (and in the dice
tray). "Encounter" lists creatures with a count and an optional link to the SRD
compendium or a Codex card; "Prepare combat" creates a fight in the encounter
tracker with those combatants and "Open combat" goes to it. "Player handout"
points at a gallery picture with a label and "when to hand it out", and its
studio draws a letter, a case file, a terminal screen or a notice board from
editable text (with three opening hooks), saves it to the gallery and redraws the
same picture when the text changes. Each block reads as plain text in Markdown,
Word, ePub, the reader and the wiki (checks and encounters start hidden from the
wiki), survives backup and copies, and is read and written by the bridge
(`> [!CHECK]`, `> [!ENCOUNTER]`, `> [!HANDOUT]` in `wh_create_writing`;
`wh_create_handout`, `wh_render_handout`). Not built: a "mark spoken" count on the
read-aloud box, a live/done state on the encounter block, a dream template, PDF
handouts. Test: `tests/prep-blocks-handouts.browser.tsx`; evidence and gaps in
tasks/vvd1095/B-campaign.md.

**Table rules (task 1095, B gap 6).** Sheets has a "Table rules" tab (also
reachable from the project settings): pick the game system (D&D 5e 2024 or 2014,
Daggerheart, Call of Cthulhu 7e, freeform), see the rules that system has with
their usual value, change what your table plays differently (hit points fixed or
rolled, rests, critical damage, flanking, potion action, carrying, death saves,
Fear, Experiences, gold and more), and keep notes for the evening (when, where,
house rules, food, dress code, your own sections) in the order you like. Each
changed rule is marked and has its own reset; one button resets them all. It is
saved with the project (undo-safe revision, JSON and ZIP backup, copies), answers
the bridge (`wh_table_rules_get`, `wh_table_rules_set`) and is read by only two
things so far: a note on the 5e class preview when hit points are rolled and a
note in the dice tray when the table rolls its own dice.

**Tabletop tools (task 1095, wave D1).** Character sheets gain an offline SRD 5.2
compendium (341 monsters, 339 spells, 262 magic items, 15 conditions; search and
filters; "Add to world" makes a Codex card and a stat block; CC BY 4.0 credit),
a Fight tab (initiative, turns and rounds, damage with temporary HP, healing,
conditions that wear off, concentration checks, death saves), a dice tray
(4d6kh3, advantage, a target with pass or miss, natural 20 / 1 called out, six
dice sets, saved formulas, a roll log) and a 5e sheet's hit points in play
(damage, healing, death saves, condition chips) with a stat block's
spellcasting sentence. A name generator makes inns, shops, people, villages and
noble houses in 13 styles with owner, charm, secret, trouble and motto, and
turns one into a Codex card ("/nombre" in the editor; "/dados" rolls). Notes
gain a to-do list (status, urgency, due days, links) and kanban boards, and a
note takes a title and a cover. Sheets compute IF, SUMIF, COUNTIF, VLOOKUP and
other functions (Spanish names too), open and save Excel workbooks with their
tabs, and group sheets as tabs of a workbook. The board has a right-click menu,
white, lined and chalk surfaces, an assets rail and comments about one card;
the world graph has display settings, hidden cards and saved graphs; the
project ambience has a soundscape mixer; the icon picker has categories,
genres and recent icons. Bridge tools: docs/AI-BRIDGE.md, section 30; matrix:
tasks/vvd1095/D1-tools.md.

**Workspace themes.** Appearance (Base or an era) has eight built-in styles
(Parchment, Midnight, Forest, Ember, Ocean, Slate, Dusty rose, High contrast) and
an accent-hue slider. "Save as theme" names the look you see, including its
background picture; saved themes can be applied to Base or to the current era
(through the same revision-checked save, so a stale form is refused), renamed,
deleted after a confirmation, and exported or imported as .json (a bad file is
refused with a plain message and changes nothing). Themes belong to the device:
one app-wide settings row, carried by full backups but not by a single-project
export. Bridge tools `wh_workspace_theme_list/save/apply/delete` (undoable):
docs/AI-BRIDGE.md, section 31.

**Duplicate project** creates one local project copy, remaps declared internal
references and copies available managed Scrapper files. Global library and native
publishing originals remain shared. A copied book stays in its saga; a copied
saga does not recursively copy its children. Interrupted native completion resumes
the same copy; Undo requires an unchanged copy. This operation is separate from
the partial legacy project/full JSON formats.

See [local workflows, recovery and limits](docs/WORLD_AUTHORING.md) and the
[local tool SDK](docs/local-tool-sdk.md). Source tools require trusted source and
a local build; archives do not embed arbitrary compiled JavaScript. Cached local
recognition/search models need preparation before offline use. Text generation
uses the configured global runtime. The 21 October composed source checks pass: 210 groups across 44 suites with
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

[Final verification and limits](tasks/worldcraft1041-final-verification.md);
manual revision/readback evidence: `tasks/evidence/worldcraft1041-manual-verification.json`.

## Quick start

```bash
npm install            # one-time dependency setup
npm run fiction:setup  # development worker; included in installed builds
npm run fetch:bin      # downloads yt-dlp + gallery-dl into resources/bin/
npm run verify:quick   # renderer/Electron types, shipping lint, conformance
npm run dev:desktop    # Vite dev server + Electron window (HMR)
```

`npm run dev` still runs the plain web app in a browser if you prefer.
On Windows, `setup.bat` performs the one-time setup; subsequent launches use
`run.bat` without reinstalling or changing dependencies.

## Rich document editor

The editor adds semantic font, size, colour, highlight, paragraph style,
alignment, line spacing, indentation, sub/superscript, editable tables and
manual page breaks. Formatting survives save, reload, sanitization and undo.
The Document panel opens rich files, previews native pages and downloads DOCX,
PDF and other formats through Writers' own Rust document engine. Importing into
a continuous book replaces the current chapter body while preserving its
boundaries and other chapters.

`native/` contains an owned, detached source fork: no upstream Git dependency,
submodule or updater. Build requires the pinned Rust 1.92 toolchain;
`npm run document:build`, desktop launch and desktop packaging compile this
source and include its notices. The complete `.writer.json` archive preserves
assets and original package parts. HTML interchange is not universally lossless.
Existing publishing exports keep their previous scope; the Document panel is
the rich-format route. See [editor, MCP and verification](docs/editor-native/README.md).

The Changes panel keeps anchored proposals with their author, source and date.
It records ordinary paragraph edits, accepts or rejects proposals within the
current chapter and preserves them through save, reload and undo. UI and MCP
share the same operations. Document previews and downloads can use Final or
Original text without changing pending proposals. A separate DOCX download keeps
compatible pending changes with author, date and proposal identity; importing
them preserves editable revisions. Final/Original downloads keep their selected
text. See [scope and verification](docs/editor-revisions/README.md).

The Editorial panel stores reusable named styles, section geometry, literal
headers/footers, signed list starts and inline references linked to project
sources. Styles are materialized presets, not a complete word-processor cascade.
The heading navigator derives its outline directly from the current manuscript.
Spanish proofing offers local spelling, a persistent project dictionary and
optional local grammar suggestions. Grammar uses the bundled LanguageTool 6.6
runtime and requires Java 17 or newer on the computer; spelling works without
Java. Suggestions are reviewable and reversible, not guarantees of correctness.
UI and MCP share these operations. See the
[editor comparison and measured Spanish corpus](docs/editor-comparison/README.md).

Document print options can inherit the opened file's language and hyphenation,
or select Spanish/English and enable/disable automatic hyphenation in an export
copy. Spanish patterns support Unicode and long patterns; generated line-end
hyphens stay visible without becoming extra characters in PDF selection. Original
URLs, dates and written hyphens remain text. The native layout reserves footer
space before placing body text and footnotes. The MCP cut query reports original
word offsets and provider support; these print operations preserve the session
and its history.

## Shared Faustus copilot

The desktop copilot mounts Faustus's shared `<faustus-chat>` panel. Faustus owns
conversations, model selection, memory and the tool loop. Writer supplies its
project, current manuscript and live selection, and keeps its native tools,
editor, snapshots and undo. Existing conversations are imported by their original
identifiers; the original Dexie rows remain in Writer's backups.

Keep Faustus running. `WH_FAUSTUS_URL` selects its service (the local default is
`http://127.0.0.1:7000`); `WH_FAUSTUS_MCP_SERVER_ID` can select a registered Writer
tool connection for an isolated profile. Closing the dock retains its draft and
session, and leaving the application does not stop a remote Faustus turn.
See [integration and verification](docs/FAUSTUS-COPILOT.md).

## AI subscriptions and external assistants

In **AI settings → Use my subscriptions**, sign in with the official Claude or
Codex client, or import an existing subscription session. Check the connection,
then choose it as the default text model. API connections and local models remain
available. Subscription requests verify the account's authentication method and
never fall back to API billing. Standalone text actions are supported; image
generation continues to use the separate image providers. The desktop copilot
uses Faustus's central model and agent settings.

The **AI bridge** section explains how to connect Claude Desktop, Codex or Gemini
CLI back to the app, with client-specific configuration and a separate, safe
prompt to brief the assistant. Keep Writers Hoard open while connected. A normal
web chat cannot gain access by pasting a prompt or a localhost address.

See [subscription setup](docs/ai-subscriptions.md) and
[external assistant setup](docs/ai-external-connection.md).

## Suggested continuation (ghost text)

**Settings → Writing assistance → Suggested continuation** (off by default) shows
a faint one-sentence continuation after you pause at the end of a paragraph in a
chapter or book editor. **Tab** accepts it, **Ctrl+→** accepts one word, **Esc**
or any key dismisses it. The suggestion is a visual hint only: it is not part of
the document, the undo history or any save until accepted, and accepting is one
undo step. The toolbar's sparkle button also turns it on or off. It uses only a
local model (an embedded or loopback Ollama / OpenAI-compatible connection) with
the text before the cursor, the Codex entries you just mentioned and the project's
style profile. Nothing is sent to a cloud provider, and nothing is suggested
mid-word, with a selection or in read-only mode.

## Genealogy and imports

Enable **Genealogy** in the project's engines to view explicit parents,
guardians and partners in a family tree and export it as DOT or text.
**Codex import** imports Markdown folders from Obsidian, Notion, World Anvil
or Campfire, with a preview of new entries, duplicates, conflicts and issues.
Typed JSON collections are also supported. It preserves complete source text,
adds accepted new entries atomically and can undo the import during the session,
preserving later edits. Native bridge/MCP tools `wh_codex_import_*` expose this
flow; `wh_genealogy_*` separately import and apply explicit family links.
Existing references and project data are preserved by database upgrade v38.
See [genealogy](docs/GENEALOGY_CONTRACT.md) for supported metadata, JSON shapes,
session undo and other limits.

**Import mixed documents** also takes pasted text (a line with only `---8<---`
separates documents), text-layer PDFs and a destination Library folder, with
export guides, "select all of this type" and a reason for every skipped file.
**Import manuscript** in Writings reads ePub (book order, images reported) and
PDF with text; a scanned PDF is refused with an OCR message. Bridge arguments
`pasted` and `libraryFolderId`; see
[world folder import](docs/world-folder-import.md).

## Export a whole world as Markdown

**Export as Markdown** (the file icon on a project card in the dashboard, and the
button under *Export* in the project sidebar) writes the project as a folder of
plain, readable files in a ZIP: one `.md` per Codex card (`Codex/<type>/`),
chapter (`Writings/`), note (`Notes/`), timeline (`Timelines/`, a dated list),
map (`Maps/`), outline and diary page, each with YAML frontmatter (type, title,
aliases, tags, fields, id, updated date) and the body as Markdown. Links the
author made between cards, and the first mention of each card in a document,
become `[[Title]]` links; ambiguous names are left alone. Tables come out as CSV,
and there is an `index.md` and a `world.json` with the project record minus
embedded pictures. A checkbox adds pictures and sounds under `media/`; the dialog
shows the size estimate with and without them, the phase it is in, and a Cancel
button. The export only reads: it does not touch the ZIP backup. Bridge/MCP tool
`wh_world_markdown_export` returns the same ZIP as base64 (up to 25 MB). Not
included yet: era variants, boards, Kanban, storyboards and character sheets.

## World bible export

**Project tools → Publishing** compiles selected Codex entries, timelines, maps
and relationships into a reference document with an index, internal links,
saved images and provenance. Inspect the preview, save standalone HTML or use
the desktop PDF exporter. Secret relationships are excluded by default;
compilation leaves project data untouched. Shared canon from other books and
unsaved generated worlds are not expanded automatically.

Native bridge/MCP tools `wh_build_world_bible` and `wh_export_world_bible` expose
the same selections and explicit success/cancellation/error results. See
[world bible](docs/WORLD-BIBLE.md) for the contract and isolated QA command.

## Investigation (research projects)

The **Investigation** engine (`inquiry`, category research; on by default in the
Reporter preset, suggested in Biographer and Realist) turns the research a
project already holds into claims and reasons about them.

- **Sources are graded and can be retracted.** Each citation may carry a
  reliability (A-F) and a credibility (1-6), shown as `B2`, plus an origin used
  to judge independence. Older citations read "ungraded". Retracting a source
  never deletes it or its excerpts; the claims that rested on it are
  re-derived and the app says how many were affected. A retracted source stays
  in the bibliography, marked with the date and reason, in every citation style
  and every publishing format; the publishing preview counts them.
- **Claims rest on recorded excerpts.** A claim is a statement (optionally
  subject, predicate, object, with partial dates) with at least one support
  pointing at an existing excerpt. Its status is never stored: it is derived
  every time as unsupported, claimed, corroborated (two or more independent
  origins), confirmed or disputed (the author's override) or retracted, always
  shown next to its excerpt and independent-source counts.
- **Time.** Every view takes an "as of" date. A claim whose period is over is
  *ended*; one not seen for longer than the staleness window (365 days by
  default) is *stale*.
- **Tabs:** Claims, Chronology (with contradictions over one-at-a-time
  predicates and unknown stretches), Graph, Hypotheses (analysis of competing
  hypotheses, worded as "the least contradicted so far", never "proven"),
  Report (Markdown with a citation check; an optional model summary must pass
  the check and is flagged, not hidden) and Entities.
- **Privacy.** A codex person is private unless the author marks them a public
  figure. Enrichment never runs on a private person, library searches take
  their names out of the query, and the report labels them "private person".
- **Lookups.** Organisations, places, events and public figures can be matched
  to Wikidata from the main process (identified User-Agent, serial requests,
  timeouts). Applying fills empty fields only, stores the item id, files a C3
  source and logs a run that can be undone. The desktop app can also search the
  user's other local apps through the Hoard hub (`library_search`,
  `search_links`); hits become ungraded sources and the hub being down is
  reported, not fatal.
- **AI bridge.** `wh_grade_source`, `wh_retract_source`, `wh_list_claims`,
  `wh_add_claim`, `wh_update_claim`, `wh_inquiry_timeline`, `wh_add_hypothesis`,
  `wh_rate_hypothesis`, `wh_ach_matrix`, `wh_enrich_codex`,
  `wh_undo_enrichment`, `wh_inquiry_report`, `wh_search_library` and
  `wh_bibliography`, the reference list with grades and retractions marked (details in
  [`docs/AI-BRIDGE.md`](docs/AI-BRIDGE.md)).

`npm run test:inquiry` runs its focused tests (pure logic, migration,
enrichment, UI and the bridge tools).

- **Hoard family hand-offs.** `wh_character_to_prospero`,
  `wh_storyboard_to_prospero`, `wh_world_to_scheherazade` and
  `wh_world_from_scheherazade` (desktop app, through the local Hoard hub). A
  codex character becomes a Prospero cast member, a storyboard becomes a
  Prospero production, and a project's world travels to and from Scheherazade as
  a neutral `hoard.world/1` document (schema in Scheherazade's
  `docs/WORLD_SCHEMA.md`). Importing creates new records, never overwrites
  anything edited here, keeps each source `ref` and `revision`, and can be
  undone; deleted records stay deleted. Buttons "Send to Prospero", "Send to
  Scheherazade" and "Bring from Scheherazade" show clear success and error
  messages (including which app to start). Details in
  [`docs/AI-BRIDGE.md`](docs/AI-BRIDGE.md) section 26.

`npm run test:family` runs its focused tests (exchange logic and UI).

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | Web app only (Vite, browser). |
| `dev:desktop` | Coordinated Vite + Electron launcher with hot reload and automatic port selection. |
| `build` | Typecheck + build the web renderer. |
| `build:desktop` | Build renderer (relative base) + bundle Electron main/preload. |
| `electron:build` | Bundle `electron/` → `dist-electron/*.cjs` (esbuild). |
| `typecheck:renderer` | Typecheck the React renderer without emitting files. |
| `typecheck:electron` | Typecheck the main-process code. |
| `lint:shipping` | Lint shipping renderer, Electron, and tooling sources. |
| `lint:baseline:prune` | Remove fixed fingerprints from the checked-in lint debt baseline. |
| `conformance` | Check engine registration, schema, locale, backup, and binary declarations. |
| `test:critical` | Run isolated Electron/Chromium tests for migration, backup, cascades, recovery/navigation, full rendering, and Vite startup. |
| `test:ghost` | Test the suggested continuation: rules, debounce and cancel, Codex selection, trimming, accept/dismiss and off-by-default. |
| `test:family` | Test the hand-offs to the other Hoard apps: world exchange logic, import, undo and the UI. |
| `test:inquiry` | Test the Investigation engine: pure logic, migration, Wikidata enrichment with mocked requests, the UI and the AI-bridge tools. |
| `test:subscriptions` | Test subscription isolation, tool protocol, connection controls and external-assistant setup without calling providers. |
| `test:packaged` | Smoke-test the already-built `release/win-unpacked` desktop app with an isolated temporary profile. |
| `bundle:budget` | Enforce renderer entry, lazy-chunk, and total JavaScript size limits. |
| `audit:security` | Fail when npm reports a moderate-or-higher dependency vulnerability. |
| `verify:quick` | Run both typechecks, shipping lint, and conformance. |
| `verify:release` | Run the dependency audit, quick checks, critical tests, production builds, and bundle budgets. |
| `fetch:bin` | Download `yt-dlp` and `gallery-dl` for this OS into `resources/bin/`. |
| `dist` | Verify and build a local installer into `release/`. |
| `dist:publish` | Verify, build, and publish a release to GitHub. |

`lint:shipping` compares ESLint output to
`scripts/lint-baseline.json`. Existing debt remains visible, but any new
file/line/rule/message fingerprint fails CI. After fixing baseline violations,
run `npm run lint:baseline:prune`; it only removes resolved fingerprints and
refuses to absorb new violations.

## Architecture (desktop bits)

```
electron/
  main.ts            Window, security, IPC, auto-update, starts media server
  preload.ts         contextBridge → window.electronAPI (app/fs/updates)
  media/
    ytdlp.ts         Resolve + spawn bundled yt-dlp; ffmpeg via ffmpeg-static
    server.ts        Embedded 127.0.0.1:8765 HTTP service (same contract as
                     the old Python server → renderer needs no changes)
  build.mjs          esbuild → dist-electron/*.cjs (CommonJS)
scripts/fetch-ytdlp.mjs   Downloads yt-dlp + gallery-dl binaries
scripts/binary-manifest.json  Pinned binary assets, versions, and SHA-256 hashes
electron-builder.yml      NSIS installer + GitHub publish config
```

The renderer detects Electron at runtime (`src/utils/platform.ts`) to choose
`HashRouter` (needed under `file://`) and to show the desktop-only Media
Downloader. This repository does not publish the web build; CI (`.github/workflows/ci.yml`)
verifies, tests and builds it on every push.

## Releasing

See [the release guide](docs/RELEASES.md) for the public repository, the six Windows/Linux assets, naming and checksum conventions, manual upload commands, and the scope of the Windows-only publishing workflow.

```bash
# bump "version" in package.json, then:
git tag v0.1.0
git push origin v0.1.0     # .github/workflows/release.yml builds + publishes
```

Auto-update is wired via `electron-updater` against the
`Luissalet/Writers-Hoard-Releases` releases. The titlebar Updates panel reports
new versions after startup checks and every six hours. Downloads and installation
are explicit user actions; restart first uses the pending-write shutdown guard.
**Help ▸ Check for Updates…** opens the same panel, which also links to GitHub
for a manual download. This preview includes prereleases and refuses downgrades.

Published Windows releases are fail-closed: GitHub Actions must provide the
repository secrets `WIN_CSC_LINK` (a PFX path/URL or base64 value accepted by
electron-builder) and `WIN_CSC_KEY_PASSWORD`. `dist:publish` refuses to run
without them and also enables electron-builder's `forceCodeSigning` check.
Local `npm run dist` remains available for unsigned development installers.

The public distribution repository is separate from this source repository.
Configure `RELEASES_GITHUB_TOKEN` with Contents: write permission on
`Luissalet/Writers-Hoard-Releases` for the publishing workflow. Only installers,
update metadata, checksums and public documentation belong there. Package rules
exclude source maps; never copy this repository or its Git history to the public one.
The initial manually published v0.1.0 preview is unsigned and marked as a prerelease;
the automated stable publishing path continues to require signing credentials.

### Reproducible media binaries

The binary manifest pins each supported platform to immutable release versions
and SHA-256 hashes. `npm run fetch:bin` verifies the download before replacing
an existing binary, and conformance rejects mutable or incomplete manifest
entries.

For an intentional binary upgrade, these environment variables can override the
manifest after their version and matching platform checksum are reviewed:

- `WH_YTDLP_VERSION` and `WH_YTDLP_SHA256`
- `WH_GALLERYDL_VERSION` and `WH_GALLERYDL_SHA256`

Pinned versions use GitHub's `releases/download/<version>/<asset>` path. Keep
the committed manifest as the default release source of truth.

## Notes

- Run `npm install` once and commit the regenerated `package-lock.json` so CI
  (`npm ci`) stays in sync.
- Add `build/icon.ico` to customise the app icon (optional).
- Google Docs sync uses a web OAuth popup; on desktop that may need a
  loopback/system-browser flow. Sync is optional — the rest of the app works
  offline regardless.


## Owned data and compatibility

Native module data can be relocated into `data/native/<module>/data`, with per-module configuration beside it. Writer fiction uses the owning desktop profile `writers-hoard/fiction/data`. Move complete data trees, including SQLite WAL/SHM, media, downloaded models and browser sessions; update saved absolute paths before enabling a module. The compatibility manifests in `compatibility/<id>/faustus-plugin.json` preserve native IDs, tool schemas and tokens without a retired checkout. Add each merged application's `compatibility` directory to Hub roots before the general repository root. Discovery and compatibility bridges never start an application. All modules remain OFF during relocation.

Legacy in-place adoption scripts are optional import helpers; keeping the old repository is unnecessary once relocation and route updates have been verified.


Publishing shutdown correction931 CAS5: a failed native close retains the app/resources and worker, rejects ON/new native work and offers Retry OFF. Per-factory cleanup checkpoints preserve completed steps; EOF retries closure without replaying writes. Four real factories and the rebuilt frozen worker were exercised with synthetic profiles. `node scripts/build-publishing-runtime.mjs --worker-only` reuses existing native binaries without Rust builds. See tasks/submission931-cas5.md for exact evidence/limits.
