# Writers Hoard — Desktop

## Images on Codex mentions

Notes and Writings can show or hide the Codex entry image on each text link. The link, alias and formatting stay intact, and Undo restores the choice. The editor and supported readers use the scoped local avatar without adding image bytes to the prose. The writing MCP tool supports the same choice. [Use and verified scope](tasks/vvd1095/verification-mention-image2028.md).

## Fixed tables in shared local tools

Local tools that declare the new shared-table profile can insert fixed-size tables, write and format each cell, add links, move or remove the whole table, and Undo while preserving another author's contributions. Manual and Automatic saving, SDK and MCP keep the same document paths. Existing tools are not migrated just by opening them; Notes retain their normal contextual table toolbar and all earlier features.

Removing a table is an explicit action. Undoing its creation can instead retain the structure needed by another author's work. Mutable rows/columns, cell merge/split, sizing, images and adoption of older origins into this shared profile remain open. [Use, contract, evidence and delivery status](tasks/vvd1095/verification-shared-tables2003.md). The fixed-grid delivery is approved and integrated locally. The passive-preview follow-up is also approved and integrated; its real browser check preserves the saved table appearance. This does not widen the profile or establish complete parity.


## Contextual table controls

The normal rich-text editor shows row, column, header, merge, split and deletion controls beside the active cell. Alt+F10, arrow keys, Enter and Escape support keyboard use; each action shares the existing table selection and Undo. The Table menu remains available. MCP adds `toggleHeaderRow` to the existing writing-document editor.

Source `d9039d3` is approved at writers2009/revision1 and integrated locally without push. Real Brave, independent nested-table/dialog checks and a new two-key MCP/cold-process run have [separate evidence and limits](tasks/vvd1095/verification-table-context2009.md). This delivery concerns the normal HTML editor; tables in the shared causal SDK profile remain in task2003.

## Links in existing shared documents

An updated local tool can explicitly offer **Enable links** for its known older rich-text contract. It preserves the document, text, formatting and author Undo. The same shared room continues, including views that join later; Manual mode writes only through **Save to this library**, and leaving without saving reloads that library while other views retain their work. Optional Automatic saving keeps its existing behavior.

Source `624474ba06e2903293e6d6a4814cf07eec31cf0c` is approved at writers1958/revision2 and integrated locally without push. SDK and MCP use the same writer. [Author API](docs/local-tool-sdk.md#explicit-adoption-of-an-existing-engine3-rich-history) · [verification and limits](tasks/vvd1095/verification-rich-links1958.md#existing-shared-histories). Images/tables in this shared profile, extensible persisted schemas, physical IME, large-history responsiveness and hosting remain open. Earlier delivery notes below retain their historical scope.

## Shared rich-text performance

R5 and source `ca7c553f` reduce repeated work while preserving author Undo, marks, identities and the existing Save flow. The latest original100-gesture/10k test measured321ms mean and367ms p95, compared with the historical511/594ms. This remains a partial improvement; large histories still need work before accepting interactive performance.

The R6 version passed area checks, a new two-key MCP/cold reopening run and real Brave editing. [Evidence and limits](tasks/vvd1095/verification-rich-performance1917.md). Optional autosave is delivered separately; physical IME, hosting and overall parity remain open.


## Local document content sharing

Source `48ba665b` is integrated after approval in submission1. **Share document content too** before Create/Join exchanges every field through the existing rich editors and author Undo; people and cursors remain the default. **Save to this library** writes only here. **Leave without saving here** reconciles an existing Save and reloads this library's current Source while other views retain their shared draft.

Author Source/UI controls, the independent53+3 review, Root's real Brave checks and a new two-key Native run passed with separate evidence. Native made58tool calls/66RPC/58IPC across two processes, including cold reopening without an editor. Final quick/build also passed. Main integration, the Google manual and continuity updates are complete; autosave1952, hosting, performance1917, physical IME and the other parity gaps remain open. [Acceptance and limits](tasks/vvd1095/verification-live-content1913.md).

## Integrated shared blocks and explicit draft fields

Undoing a container now preserves another author's active paragraphs, text identities and marks. Only the causal structure needed to represent those contributions remains; explicit hiding and independent Undo are respected. Save, Redo and cold reopening use the same writer. [Structural Undo and verification](tasks/vvd1095/verification-undo-support1932.md).

Structured shared text is integrated in source `69899cb9`: H1–H3, nested bullet/numbered lists, quotes and toggles use the existing Source writer, stable text identities and author Undo/Redo. Source `004ee3e1` separately adds opt-in draft-field publications per open pane; saved queries remain the default and existing tools do not publish automatically.

An empty list item now exits its list level with Enter, preserving the paragraph identity, author Undo/Redo and normal Save. Root/intermediate/nested cases use the same SDK and MCP action, with remote text and current numbering preserved. [Empty-item behavior and evidence](tasks/vvd1095/verification-empty-item1895.md).

The shared rich editor no longer reports Saving for a clean document. Saving immediately after an edit remains reliable, and pending recovery drafts stay visible. [Save-state behavior and verification](tasks/vvd1095/verification-rich-save-status1920.md).

Source documents can share a local session through an explicit link and chosen local profiles. The same person is deduplicated while separate connections remain visible; presence hooks, pointers, Follow and known rich-text carets/selections are available, with a readonly MCP query that does not join a session. Presence stays outside document content, Save, Undo and history. This uses Writer's local server without a paid service; it does not exchange document edits or provide remote hosting. [Local presence, use and limits](tasks/vvd1095/verification-sdk-presence.md).

The combined SourceHost passes new two-key Native93 and Root Brave/build/quick checks; publication has its own Native36 acceptance. See [blocks](tasks/vvd1095/verification-shared-blocks1883.md) and [draft fields](tasks/vvd1095/verification-sdk-published-fields.md). These deliveries supersede older pending-delivery notes below. Live content exchange1913, hosting, large-history cost1917, physical IME, extensible persisted schemas and links/images/tables in this shared profile remain open; overall1095 parity is not closed.


Local-tool authors can now resolve a catalogue ID to standalone SVG through optional `client.icons.resolveSvg(id)`. The importable Icon notebook adds **Download SVG**, preserving pending notes without saving them. The separate readonly MCP tool `wh_local_tool_icon_svg` returns the same SVG or JSON null. This uses the existing local catalogue without an external API or payment. Standard SVG geometry is verified for all 1,688 symbols; Canvas pixel equality is not claimed. [API and author use](docs/local-tool-sdk.md#local-icon-svg-resolution); [measured limits and delivery status](tasks/vvd1095/verification-sdk-icon-svg.md).

Local-tool authors can query the existing own symbol catalogue with optional `client.icons.get/search/packs` and render a saved ID through `LocalToolIcon`, using the same local map-symbol painter. The importable Icon notebook example keeps notes independent: searching/pages do not write, selecting saves only the icon, and Save notes remains explicit with conflict recovery and Undo/Redo. This does not install or enable an example automatically. Unknown IDs keep their data and use fallback; general SDK parity remains partial. The subsequent SVG extension is documented above. [API and example](docs/local-tool-sdk.md#shared-local-icon-catalogue); [evidence and delivery status](tasks/vvd1095/verification-sdk-icons.md).

Local tools can inspect a document's contextual application path with `client.refs.resolve(reference, {includePath:true})`. It returns current title/availability plus `path:string|null` without opening the target, saving notes or changing the workspace. The existing reference-resolve MCP tool accepts the same option. Calls without it keep their previous response shape; ordinary Open and Open beside remain available. [API, evidence and delivery status](tasks/vvd1095/verification-sdk-document-path.md).

Source and legacy tools can request `client.openDocument(kind, id, {placement:'beside'})`. The linked-document picker adds **Open beside**, retaining its original Open action. Consultation uses the existing workspace companion and the pane's effective era; normal pending-note saves run before navigation. A Codex target opens its ordinary global detail modal, which you close to continue with the Source and Codex panels. Without a lateral host port, the request follows normal navigation. [Contract, evidence and delivery status](tasks/vvd1095/verification-sdk-placement.md).

The world map's Light menu saves its choice immediately: daylight (`off`), a named light or the journey's hour. Reopening uses the saved choice; older worlds without it stay in daylight without a migration write. The control waits for its pending save; storage failures retain explicit Retry, while a conflicting map-settings change keeps the saved winner and asks you to choose again. Journey saves only the mode, without playback frames or a shared runtime clock. This affects the flat map's light, without adding a wash to 3D or Carta. [Use, MCP contract, evidence and delivery status](tasks/vvd1095/verification-map-lighting.md).

In **Overview → Produce → Asset vault**, local audio and video open directly above the file list. Open a resource, then press Play in its native controls; selecting it never starts playback or copies the file. Close, filtering out the resource, changing owner or replacing its stored version releases the old player. Metadata edits may restart it paused. This library remains Base-only; image zoom and other file actions remain available. [Use, evidence and delivery status](tasks/vvd1095/verification-assets-media-preview.md).

Source and legacy tool editors can offer optional context menus through right-click, Shift+F10/ContextMenu or Actions. The Contextual counter keeps its flat Increment/Reset actions and normal buttons, adding More actions → Increment and More actions → Count → Reset. Open branches explicitly; Left, Escape or Back returns to the parent, and Tab continues normal focus traversal after closing the tree. Opening does not save data; explicit receipt Undo/Redo applies to changes made here. Compiled examples still need enabling; Owned/world/readonly/fullscreen do not receive this port. [Original flat contract](tasks/vvd1095/verification-sdk-context-menus.md); [nested API, evidence and delivery status](tasks/vvd1095/verification-local-tool-submenus.md).

Source tools can declare optional tutorials in their normal Source or legacy editor. Use **Help** to start or resume; steps advance manually, after a confirmed tool action, or when an element appears in that instance. Progress follows the ordered tutorial structure, while language changes only its copy. The Guided counter is a runnable example. Owned blocks, world blocks, readonly views and fullscreen do not receive this tutorial port. [API, evidence and delivery status](tasks/vvd1095/verification-sdk-tours.md).

World dates now offer Previous/Next month, Clear and separate exact-year/month/day fields with Apply/Cancel, alongside free text and the existing grid. Browsing leaves the authored date unchanged. Today uses the computer's local day only when the world calendar has a complete usable Earth correlation. Event and chapter saves retain their existing rules. [Use, verification and limits](tasks/vvd1095/verification-date-controls.md).

Board references can play project audio and video using native controls. Add an existing file through Assets or Reference, or drag it from Assets. For a new local file, use Files in Assets or drop it onto the board: audio/video is imported into the scoped library and pinned as a reference; images retain the existing image flow. The normal media-library import also remains available. Nodes share the library file, start paused and release playback when hidden or closed. Normal Undo/Redo affects the reference, preserving the file. Static PNG remains a caption/frame without playback controls. [Playback evidence](tasks/vvd1095/verification-board-local-media.md); [direct file import, verification and limits](tasks/vvd1095/verification-board-file-import.md).

Owned source blocks can opt into additive codec evolution: a compatible version can add fields to the same saved block without changing it on selection or read. The first meaningful edit saves data, codec and portable preview together; scoped action Undo restores the complete prior envelope. Strict compatibility remains the default, Source state keeps its existing migration contract, and the general SDK remains partial. [Contract, example and evidence](tasks/vvd1095/verification-sdk-owned-evolution.md).

Rich notes support inline images from File or project Gallery. Set width, frame and left/centre/right alignment, replace an image while keeping its layout, or remove it and use Undo/Redo. Image-only notes can also be saved and reopened. [Use, evidence and limits](tasks/vvd1095/verification-note-inline-images.md).

Worldgen places can use a copied local image from File or Gallery, in its original colours or the map’s ink. Remove it to reveal an available graphic, then the retained symbol or building; changing or deleting the Gallery original does not alter the copy. Maps and Codex-linked portraits keep their existing behaviour. [Contract and verification](tasks/vvd1095/verification-place-images.md).

Worldgen places also offer a searchable graphic catalog with categories: 1,688 own geometries and 1,689 picker names (Wand2 saves as WandSparkles). Cells, selection, maps, projected 3D, regional sheets and PNG share the same numeric drawing. A prepared local image takes priority; removing it reveals the graphic, and removing that reveals the retained model/symbol. Choosing a model in the normal inspector explicitly clears the active overrides. The catalog is a bounded offline capability, not proof of the full thematic VVD inventory or general SDK parity. [Use, native contract and evidence](tasks/vvd1095/verification-map-symbol-catalog.md).

Source-tool fields can opt into rich prose: headings, lists, text links and copied local raster images use the native editor and remain readable without the author module. Save the briefing explicitly; an Owned block then needs its parent document saved, and the dock requires child Save/Discard before leaving. This is local string-and-CAS editing, without character collaboration; the general SDK remains a partial local subset. [Use and limits](tasks/vvd1095/verification-sdk-rich-prose.md).

Calendar banners now have timeline-owned presets with live links, independent copies and a preserved manual style. Crosshatch, Grid and local raster fills have optional repeat size and opacity; changing a linked preset repaints its events without reapplying it. Moves retain the original preset owner. Normal controls, native MCP, scoped Undo, eras and portable backups use the same contract. [Usage, verification and limits](tasks/vvd1095/verification-calendar-banners.md). This establishes the bounded offline workflow in C-writing row83; task1095 continues. Rich prose was still research at that banner delivery; its later scoped extension has separate [evidence](tasks/vvd1095/verification-sdk-rich-prose.md).

A world can contain several manuscripts with their own chapters, title, author, blurb, cover and reading position. The Manuscripts library creates, opens, archives and restores them while sharing the same Codex cards, maps and timelines. The original manuscript stays compatible with older projects; book editing, imports, Reader, publishing profiles and portable backups follow the selected manuscript. [Verification and limits](tasks/vvd1095/verification-shared-manuscripts.md). Local SDK font/data import and Book home are integrated in delivery `416be426337f22f128c5f4d0875167d48738e05c` (feature source `c2b7cb0dba116485264a8ae86e48635c82706e72`) after independent CAS23 and final root checks. Project files can be chosen per document or installation and preserved in offline reading/backups; manuscript covers, summaries and chapter-update dates are visible in the library and book overview. [Contract, evidence and limits](tasks/vvd1095/verification-sdk-asset-files.md). Task1095 continues.

SDK audio `fcf94f6` is integrated after fresh independent CAS20: per-handle digital RMS/peak and left/right levels, plus stereo pan, use the real playback graph. Local sounds exposes these through normal controls; native status/control share the scoped contract. Brave verified pan, measured silence, Stop and save/reopen without autoplay. Peer coverage is29 distinct focused groups (7 author +4 own +18 legacy), with overlap of capabilities. Clean-main verify/build passed: Vite43.33s, Electron, Node937/schema checks and the original headless author kit. The Google manual has a separate415 UTF-16 revision/readback receipt. The headless regression from resource previews was corrected separately in043e906/CAS19. Own signatures, SDK-only playback and stereo scope remain partial; no3D, speaker measurement or final-source stdio claim. [Audio evidence and limits](tasks/vvd1095/verification-sdk-audio-levels.md). Task1095 continues.

[Español](README.es.md)

The world graph adds adjustable spacing and optional areas by card type, preserving manual pins and saved views. Project JSON copies and Duplicate retain graph settings and remap their card/template references. Source `ecb1703` is integrated after independent CAS16; [verification and limits](tasks/vvd1095/verification-graph-display.md) track this separate delivery. Task1095 continues.

Manual 5e player attacks can keep a separate attack bonus and free-text damage type alongside existing row notes, quantity, damage dice and spell metadata. Native Attack/Damage rolls add contextual history without spending resources or assuming a target; optional attack paper follows existing content and ink. Discard and Reload have their own confirmation labels. Source `112f1fc` is integrated after fresh independent CAS 18 approval. Clean-main verification/build passed (Vite 36.92s, Electron and Node 937); the Google manual update has its separate revision/readback receipt. [Verified player-attack flow and limits](tasks/vvd1095/verification-player-attacks.md).

Local-first creative writing platform, packaged as a desktop app with
**Electron**. Same React/Vite/Dexie codebase as the web build, wrapped in a
native shell that lifts the browser storage ceiling and bundles real media
downloaders (`yt-dlp` + `gallery-dl`) — no separate Python server.

> Transition plan and rationale: [`tasks/desktop-transition.md`](tasks/desktop-transition.md)

## Offline planning and local publishing (task1095)

Calendar event titles now open the existing full event editor directly. Save/Cancel returns to the same month and selected day; clean Escape also restores keyboard focus to the event button. Timeline ownership, pane era and failed-save drafts are preserved. Source `4e4bf5d` is integrated after independent CAS12; clean-main verify/build passed (Vite27.91s, Electron and Node932). Existing recurrence and range logic is unchanged. [Calendar evidence and limits](tasks/vvd1095/verification-calendar.md).

Calendar bands also support Plain, Ribbon, Bunting and Scallop shapes independently of their fill patterns. Shapes preserve continuity across days and show titles at occurrence/week/month starts; Plain retains its earlier display. Source `2f21eed` is integrated after independent CAS 14. Its final clean-main build passed (Vite 27.77s, Electron and Node 934), and the manual update is recorded separately. Year view remains points and wiki remains an event list. [Shape evidence and limits](tasks/vvd1095/verification-calendar-shapes.md).

Scoped SDK audio `7c4e3fb` is integrated after independent CAS13, a corrected-source Browser repeat and clean-main verify/build (Vite26.31s, Electron and Node934). It adds scoped local playback/hooks and SDK-owned bus/focus handling; legacy Soundscape/Reader graphs remain separate. MCP play returns gesture-required without playing or queuing sound. That audio-only source did not include resource defaults; native resources are covered separately below. Exact upstream signatures, spatial audio and measured levels remain outside the partial contract. [SDK audio progress and limits](tasks/vvd1095/verification-sdk-audio.md).

Source `d542365` adds native tool resources: bundled image/audio defaults, document → installation → package selection, Revert, scoped asset MCP tools and portable references. AssetPad uses the normal owned-block menu. Independent technical review records 34 distinct focused groups (18 author + 6 reviewer + 10 legacy); normal Brave confirmed imports, selection/Revert, save/reopen and a 96px read-only preview. Approved CAS15 and integrated FF-only from f44e387 to exact d542365 under a fresh merge lock, with clean main. Final verify:quick/shipping lint, Vite28.92s, Electron and Node937/schema2PASS completed; root session2655 exited0 and the merge lock was released. The Google manual update added588 UTF-16 units with requiredRevision/readback,198 paragraphs,197 others and all styles preserved; both manual locks were released. Own SDK signatures remain partial; installation has CAS/Revert without Undo, the d542 cut had font/data Blob defaults without a generic picker (local import/choice was added later; [current contract](tasks/vvd1095/verification-sdk-asset-files.md)), and wiki may apply its own SVG frame. [Resource evidence and final receipts](tasks/vvd1095/verification-sdk-assets.md).

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

## Exportar una ficha del Códex

La ficha guardada del Códex incorpora **Exportar**: Markdown individual, ZIP opcional con los adjuntos locales consumidos, PDF/PNG en Desktop y vista imprimible en Browser. La copia de autor se captura en sólo lectura para Base o la época efectiva; no incluye borradores, anotaciones ni toda la galería. Las herramientas MCP existentes añaden selección individual optativa y conservan sus formatos predeterminados. [Uso, pruebas r1/r2 y estado de entrega](tasks/vvd1095/verification-card-export.md). No se atribuye una descarga confirmada en Brave ni paridad completa con VVD.

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


## Tool-owned interface translations

Source tools can declare their own catalogs and use `useLocalToolT(client)` for translated labels, interpolation, plurals and Intl formats. Changing the normal app language preserves authored notes; the Localized notebook example supports Source and Owned editing with explicit saves. Save a new Codex card before inserting its Owned block, then save the child and parent separately. This is a bounded offline SDK extension; [evidence, delivery status and limits](tasks/vvd1095/verification-sdk-locale.md) distinguish technical verification from integration.

## Shared tool preferences

Local Source tools can use the optional `client.defaults` service and `useLocalToolDefaults` hook for JSON preferences shared by world, tool and key. In Icon notebook, Save favorite changes the preference and Use favorite explicitly changes only that notebook's symbol. Neither saves pending notes; preferences have their own Undo/Redo and conflict recovery. SDK, MCP and normal Source paths have separate verification, including two authenticated native keys. [Usage, delivery and limits](tasks/vvd1095/verification-sdk-defaults.md). General SDK parity remains partial.

## Resolved colors for local tools

The optional `client.theme` service and `useLocalToolTheme` hook expose nine resolved workspace colors and the effective light/dark mode for the tool's Base or era context. Existing Appearance controls remain the editor. Icons in the normal workspace repaint after that pane applies its appearance, preserving the Canvas, document and pending notes. [Contract, attributed verification and delivery status](tasks/vvd1095/verification-sdk-theme.md). Overall web/SDK parity remains partial.

## Model animation labels and order

The local 3D viewer saves labels and presentation order for all original animation clips. Choose a clip, edit its label and save, or move it earlier/later. Clearing a label restores its original name/fallback; Reset removes the optional presentation. Previous/next follows the saved order while identity remains the source index, including duplicate or unnamed clips. Owner editing and two scoped MCP tools share version checks and normal Undo; compact views and Reader/wiki remain read-only. Model binaries and original files are preserved. [Contract, attributed evidence and delivery status](tasks/vvd1095/verification-model-animation-presentation.md). Task1095 and overall parity remain open/partial.

Source31c5598664c4f4de14880ae71d65c45530cc78f7 was approved exactly at submission47 and integrated into Main; four focused Main checks passed, including two-key Native. The manual and common continuity are updated. The separate documentation commit/FF is recorded by ROOT-delivery-final.json; overall parity and task1095 remain open.


## Row order, map links, zone intensity and concentration

Tables and Sheets add Insert above, Move up/down and a row-header Pointer handle. Changes preserve row IDs and cells, use normal Undo and remain separate from sort/filter; live Codex view ordering is still a separate gap. Worldgen place links reuse the normal Codex picker with title/alias word search, while scenes/writings/events remain available. Zone intensity uses paired slider/number controls from0 to100; zero keeps its zone and label.

Local Source and legacy editors expose optional `context.focusMode` and `useLocalToolFocusMode(context)`. Concentration hides shell chrome while retaining editors and unsaved drafts; Exit or free Escape restores it. Fullscreen remains separate. `wh_workspace_focus_get/set` use actual mounted host IDs without a draft save; the catalogue has949tools. [Use, exact evidence and delivery](tasks/vvd1095/verification-rows-places-zones-focus.md); [remaining parity](tasks/vvd1095/remaining-parity.md). General web/SDK parity remains open.

## Place directions, durable suggestion decisions and shared Three — bounded continuation

Worldgen's place inspector offers Travel from here and Directions to here. The current place anchors the chosen end, including moved or locked places, and normal map picking completes the other end. Temporary travel options survive returning through the inspector; saving an itinerary remains explicit. This does not promise that an unsaved creative journey draft survives inspector unmounting.

Detected entity suggestions add individual Dismiss, Restore and session Undo. Saved Writing/Codex owners use durable decisions scoped by document, era and parallel draft, separate from prose and project-wide detection preferences. Unsaved forms explicitly keep provisional decisions. The own MCP metadata list/action tools share that service. Real Brave cold reload now preserves the dismissal ledger and tokens exactly; Restore and Undo renew tokens while saved/editor HTML and other own records stay exact with zero prose edits. This fixture explicitly uses controlled inference. It does not establish positive Browser model inference; that separate runtime is still in progress and has no delivered real-model inference proof.

Trusted Source authors can already dynamically import the shared Three runtime and loaders. A dedicated production integration test now verifies C01–C07: cold/lazy loading, concurrent and repeated consumers, shared namespaces, five local triangle loaders and two real WebGL renders. It adds no SDK wrapper or generic 3D widget. SwiftShader, format and lifecycle limits remain explicit. [Evidence and limits](tasks/vvd1095/verification-directions-dismissals-three.md). These bounded flows are integrated in Main47d448bf with exact CAS50 approval and Main verification. Task1095 and general web/SDK parity stay open.

## Browser entity detection and Timeline Fit

The Browser editor can now prepare the same pinned multilingual entity classifier or import its four prepared files, then classify locally on CPU/WASM. Files can be added across several selections before explicit Import. The existing panel keeps independent detection/link/animation switches, explicit card type and creation, durable Dismiss/Restore/Undo and unchanged authored prose. Status reads do not load the model; active Browser jobs can be cancelled without dropping another editor's queued work.

Timeline adds Fit timeline to view beside zoom. It adjusts the current horizontal canvas and follows panel resizing without changing authored dates, range or precision. Zoom returns to manual mode; the viewport is ephemeral. Show all years remains a separate range edit and now uses the selected era in both swim-lane and list views.

These bounded changes are integrated in Main07d868d with exact CAS51 approval and Main verification. [Usage, attributed evidence and remaining limits](tasks/vvd1095/verification-browser-ner-timeline.md). General web/SDK parity remains open.

## Captured book fronts and physical print jackets

Publishing profiles can opt into a captured front cover before the book in HTML, EPUB, DOCX and the existing native PDF path. The selected manuscript/era, labels and content are captured together; later edits do not replace that export's cover. Leaving the option off preserves prior output.

The cover designer separately exports a complete print jacket as a one-sheet PDF, PNG or JPEG with editable cover dimensions, spine, outer bleed and resolution. Its 72 dpi preview is distinct from export sampling. The PDF is raster RGB with physical boxes; Browser book PDF and batch multiformat export remain open. [Usage, attributed evidence and current delivery limits](tasks/vvd1095/verification-cover-exports.md).

## Calibrate an existing generated sheet

Open Scale of this map in the saved map's controls to set its physical width. Height and cell size follow the existing grid. Apply keeps terrain, places and authored positions; Cancel discards the draft, Reset returns to the recipe's scale and Undo restores the last compatible calibration.

Distances, areas, journeys and physical comparison outlines use the new scale. An inherited era shares Base settings until it has its own map variant. Calibration changes measurements while retaining the grid. [Usage, API, evidence and limits](tasks/vvd1095/verification-world-scale.md).

## Create and resize finite map sheets

New sheets accept independent physical width and height, including portrait maps. Resizing a saved sheet grows or crops its terrain at the current cell size, using nine anchors and sea or land fill. The preview shows effective dimensions and grid rounding; preparation supports progress, cancellation and compatible Undo. Overlapping terrain and source identities remain stable; growing after a crop fills the discarded area anew. Pins, journeys and authored places keep their source coordinates. Finite Map2D displays reader routes, endpoints, crossings, dots and trails without opposite-edge copies. The separate Cartography renderer still needs its own trail/dot correction and causal test; this delivery does not certify every chart/export consumer. [Usage, MCP, attributed verification and limits](tasks/vvd1095/verification-world-domain.md).

Delivery55 source `7989bfcad06531da35182e71cbe769e90136ce02` is integrated in Main after exact CAS55 approval. Final Root quick,396 critical checks and build passed with108 Source guards/133 code paths stable; Main verified133 blobs and disk files exactly. The manual update has a separate whole-resource receipt. Source and API verification are linked below; overall parity and task1095 remain open.

## Compose local apps from Source documents

The local SDK exposes `defineLocalApp`, a Host for an app instance and a Surface for its documentary tools. Instances use existing Source state, releases, eras and Undo; shared children keep one document with separate mount clients. App routes belong to each viewport. Pending declared drafts survive detach or compatible release changes until their recovery controls resolve them. Optional publication presets export captured document content through the existing Wiki publisher. Four MCP tools list, describe, navigate a mounted instance and export its complete HTML. [API, examples, verification and remaining SDK capabilities](tasks/vvd1095/verification-sdk-app-host.md).

## Prepare several publishing files from one captured book

Publishing profiles offer Markdown, HTML, EPUB, Word (DOCX), a searchable book PDF in Browser, and a separate print-cover PDF. Select the outputs and choose Prepare files; this keeps one captured manuscript/era, content and local assets while each writer runs. Preparation does not save the profile or start a download. Ready files have explicit Download actions and an optional ZIP.

Retry pending files uses the same prepared copy, including after the live book changes. Preparing again captures current data. PDF and Word accept optional facing margins in mm and an initial page number; EPUB remains reflowable. The print-cover PDF uses its own trim, manual spine, bleed and resolution. [Usage, API, delivery state and attributed limits](tasks/vvd1095/verification-publishing-batch.md). This extends the earlier C41 checkpoint; overall web/SDK parity remains open.

This bounded C42 workflow is delivered in Main after exact CAS54 approval; the linked verification separates final checks from the earlier C41 and pre-fix evidence.


## Painted label formatting and finite map readers

Worldgen's painted-label inspector now offers independent bold, italic, uppercase display, ink and font-family overrides. Each field can inherit its existing style; Reset format clears all five in one undoable action. Changing the Region/Water/Range preset preserves explicit overrides. Uppercase affects drawing while the authored Unicode text stays intact. Existing size, rotation, spacing and curve controls remain available. Atlas, Carta and both 3D label modes resolve the same authored overrides with their existing context defaults. No new font files are installed.

The existing `wh_add_label`, `wh_update_label` and `wh_list_labels` tools expose `bold`, `italic`, `caps`, `color` and `font`. Omission preserves a field; `null` restores inheritance, and `false` remains an explicit override. Undo, eras, JSON, ZIP restore and duplication use the normal Worldgen journal. Finite label/stamp creation returns the usable absolute identity key even when the sheet origin is nonzero.

The finite Carta dots/trail reader and story annotations now respect sheet boundaries; focused public coordinate tests also cover current-domain bounds, valid edge rounding and rejected original exterior inputs. Their legacy wrapping controls have separate evidence. See [painted-label verification](tasks/vvd1095/verification-lettering.md) and the appended [domain verification](tasks/vvd1095/verification-world-domain.md) for causal tests, actual two-key Native transport and Root's normal Brave checks.

Continuation56 Source is committed as `4f463f9abc4e0d6989a8d1b10e02033d7e3fa4da`. Root quick227919ms,396 critical checks157760ms and build370224ms pass on the frozen142 code paths. Approval is exact CAS56 and Main FF is verified:23blobs/disk exact,48untracked preserved, clean index and no push. This document records the delivered checkpoint; common continuity has its own receipt. The manual is updated and verified. General web/SDK parity remains open. Cold terrain serialization retains its declared numerical losses; returned PNG bytes do not establish a Browser download to disk.

The next57 work retains nine separately reproduced public ABS-coordinate failures (two returned place keys and seven Story criteria,9of16). Its patch has its own verification and is not part of commit56. Root also observed normal Carta Fit returning zoom1.6to1.0 with the formatted label; the [captured view](_stage/ROOT-brave-evidence-next/carta-final-mouse-fit-lettering-r1.png) is linked in domain/lettering verification.

[Main56 receipt](_stage/parity-map-domain-next/ROOT-main56-FF-r1.json), [formal56 review](_stage/parity-map-domain-next/INDEPENDENT-FORMAL56-REVIEW-R1.md).

Root updated the manual once:90→638UTF16, delta548 at113268/t.0; the whole resource matches the expected change except revision, with other text/styles/tabs/metadata exact. Five aliases were released. [Manual56 receipt](_stage/parity-map-domain-next/ROOT-manual56-receipt-r1.json). Common continuity has its own receipt.


## Finite map keys and Story coordinates: delivery57

The delivered correction makes `wh_add_place` and `wh_duplicate_place` return the same absolute source key used by public place lists, while public x/y remain local to the current sheet. Story list and prose/order updates now project the stored source position once, preserving both events' IDs, text and order. Landmark readers use the absolute source identity for canonical and historical feature keys while retaining local drawing coordinates. Label/stamp same-cell `#2` identities remain supported.

[API and attributed verification](tasks/vvd1095/verification-source-abs.md): the original16 criteria, a69-check four-family control, and independent two-key Native20 criteria pass. A separate26-assertion generated-branch fixture is installed without changing the old test prefix; it uses explicit fixture data, not procedural generation. Root final quick220674ms,397critical checks152033ms and build456009ms pass on112Source/146code. Source `a91027f3dc54864fc91c17d92d6dc23b2290f342` has exact CAS57 approval and verified Main FF:7blobs/disk exact,48untracked preserved,clean index,no push. [Main receipt](_stage/parity-map-domain-next/ROOT-main57-FF-r1.json). Earlier143-path gates remain historical.

This does not migrate ambiguous old local links or repair earlier doubled coordinates automatically. Painted landmarks still show their incumbent default name (`Volcán` in the exercised case) despite the custom add name retained in the journal; that is a separate existing residue. Fog/zones have separately measured13 failures plus3 finite-wrap failures for58. Paper-cut mountain rendering remains under reference comparison. Task1095 and overall web/SDK parity remain open.

## Finite sheet zones and chapter fog: delivery58

Zones and chapter fog now use the current sheet's local coordinates while retaining their absolute source geometry. Renaming a zone preserves its polygon; zone areas follow the current physical scale. On finite sheets, a wide zone stays wide and a brush at one edge does not reveal the opposite edge. Map and Chart draw the finite zone and fog once. Existing cylindrical maps retain their wrapping behaviour.

Use the normal zone controls and chapter fog brush, or the existing world-map MCP tools. [Verification and limits](tasks/vvd1095/verification-fog-zones.md) distinguish the normal UI, public dispatcher, actual Canvas consumers and independent two-key MCP checks. Source `08c8e0cd9af53651831d246957fbd809b1688879` has exact CAS58 approval and verified Main integration. Root also confirmed normal Browser cold reopening; three normal Undo steps after reopening restored the previous nine edits. This does not certify public PNG export, route reveal, other projections, eras or portable round trips. Paper-cut rendering and the remaining writing/SDK work stay open; task1095 has not reached complete parity.


## Local runtime packages: verified source checkpoint59

The normal local-tool version manager can inspect and install a package file containing an app and its document tools, without rebuilding Writer. Installation adds availability to the shared inventory; choose each project's version explicitly afterwards. Updates and rollback use the existing pins, compatibility checks and Source document writer. Export returns the complete installed package. The existing CLI can also produce this runtime format; Source/1 remains separate.

[Usage, four MCP tools and attributed checks](tasks/vvd1095/verification-sdk-runtime-packages.md) cover actual Host/Surface hooks and assets, two-key Native transport, a fresh-process development cold load, update/rollback and retained rich-text drafts. Root's normal Brave checks include the file picker, Save/Undo, cold document reopening and an app Host. Browser download bytes and Browser Surface with a child were not demonstrated.

At this prepared checkpoint, quick r4 passes (153910ms). The 397-check critical run passed on r2 (142311ms), before the two later type-only fixes and Panel comments. The r4 build passes (392221ms), and Root's actual built production/CSP cold run passes with38tools/46RPC/37IPC,2402inputs exact and89tables0. Source commit is `d4fad2377926191a17320bee8277d347800852ac` (45paths RAW exact). Independent CAS59 approved the exact commit; Main received it by fast-forward with a fresh merge lease and HEAD check, preserving48untracked files and a clean index, without push. This private production renderer is distinct from an installed Main app; its recorded optional GSI request was suppressed. Trial, usage/error feedback, hosting, CRDT and the rest of task1095 remain open.

Later evidence also extends the historical delivery58 record: two-key public `wh_render_world_map` exported 14 complete PNGs for finite/legacy zones and chapter fog, with checked PNG CRCs, decoded pixels and four genuine Undo operations. [Independent PNG report](_stage/parity-map-png-next/PNG2-REVIEW-R2.md). This is later evidence on Source58, not a new Source59 feature or a Browser download claim.


## Local package trials and saved usage: source checkpoint60

An installed runtime package can now be tried in a new normal project, using explicit versions for its starting app/tool and document dependencies. The trial banner offers Keep and Discard. Keep removes only the trial marker and preserves the current editor, draft, route and saved data. Discard first resolves pending writes through the existing editors, then deletes only that marked project; the package remains installed. A draft that cannot be resolved leaves the project available for recovery.

Usage lists saved projects and retained instances for each package member, including disabled engines, current project pins, own era states/variants and archived documents. It does not execute package code or count active mounts. The same four public MCP operations create, keep, discard and read usage. [Usage, API and attributed verification](tasks/vvd1095/verification-sdk-runtime-trials.md).

Root's two-key/two-process Native checks pass with38tools/44RPC/38IPC,2174inputs exact and89tables empty after private cleanup. Keep preserves the actual rich editor node; Discard allows its normal Save before checking pending state. Root Browser has kept/cold-reopened one own trial and cancelled then confirmed another trial's deletion, with the package still installed. Root's Browser Usage lists the three retained documents, omits the discarded trial, and links back to the saved Unicode editor while closing the manager. Final quick r3 passes133786ms with204code/foreign exact. Build final r3 passes320405ms; source9c9c7c4e65c968280da40894da28ac621a184f94 received exact CAS60 approval and Main FF under a fresh merge lease/HEAD check, preserving26RAW paths,48untracked files and a clean index, without push.; the earlier399-check critical run precedes UI handoff/test changes. Independent shipping3groups and Native retest pass; the preparatory report is followed by exact formal CAS60 approval. A separate scoped UI finish is SHIP for the supplied desktop/390 evidence, not a global visual verdict. Errorfeed61, hosting/CRDT and overall task1095 remain open. Prior PNG58/runtime59 evidence retains its original attribution.


## Local package session errors

The package manager shares a session-only error history with wh_local_package_errors and wh_local_package_errors_clear. Verified package/member identity, phase, count and a stable host message identify failures without persisting authored content or exception stacks. Clear removes history; existing loader and view Retry controls recover the package. A failing child view leaves its sibling draft mounted, and a retained older implementation owns its errors after a pin change.

[API and attributed verification](tasks/vvd1095/verification-sdk-runtime-errors.md). Source 23cf590c113ffe892702152eec0bce11b9c57cd6 received exact CAS61 approval and verified Main FF; quick,399critical checks and build passed. Five permanent error regression groups and independent two-key cold transport have distinct evidence scopes. Broader SDK convergence, presence, Host services, distribution/hosting and1095 remain open.


## Source document change exchange: local checkpoint62

Source documents can explicitly activate a causal history and exchange scalar/map/stable-list changes between independent SDK replicas. Normal Save and scoped Undo/Redo use the same Source writer; opening or exporting an uninitialized document does not activate it. The workspace has change-file controls and three ordinary MCP tools. [Usage and attributed checks](tasks/vvd1095/verification-sdk-convergence.md) distinguish persistence, two-key cold Native, mounted UI and normal Brave evidence.

Source commit `603a3c991f82367e537a38965aebb77775720692` is approved at CAS62 and integrated into Main:40 exact paths,48 untracked files preserved, clean index, no push. The native Google manual is updated with guarded write/readback. The permanent offline UI route passes16 checks,8at1280 and8at390, with89 empty tables per viewport; the earlier stalled launcher remains a separate failed attempt. Character-level prose, presence, additive defaults, complete Host queries and hosting remain open, as does task1095. No production/Main-installed or Browser download claim follows from these checks.


## Saved fields from open Source documents: checkpoint63

Source consumers can select typed saved fields from documents open in their project/era through optional `client.openDocuments`, `useLocalToolOpenDocuments` or readonly `wh_local_tool_open_document_query`. Closed documents stay in the durable index. Reads do not open documents or Save another editor's draft; duplicate mounts share one row. The author kit represents mounts explicitly.

[Practical API](docs/local-tool-sdk.md#optional-fields-from-currently-open-source-documents) and [verification](tasks/vvd1095/verification-sdk-open-documents.md). Root Brave split panes confirm Save, close/reopen and an independent draft preserved; reload recovers explicitly saved text with remounted hosts. Cleanup deletes only the own Trial, keeping the installed package.

Source63 passed its focused/permanent checks and final recovery, quick and build gates. Commit `f47e8270` received exact CAS63 approval and Main FF; the manual is updated. Memory/graph continuity63 is complete (Root receipt ROOT-continuity63-r1.json). Character-level prose, presence, full Host/world queries, hosting and task1095 remain open.


## Initial names for placed landmarks: delivery64

A placed landmark now exposes its authored initial name in the ordinary place readers and map label; a later explicit rename still takes precedence. Generated or unnamed landmarks keep their defaults. Public/Native checks and Root Brave normal import, search, label, place card and reload pass at this scope. [Evidence and limits](tasks/vvd1095/verification-source-abs.md#source64-nombre-inicial-de-landmarks-colocados). Source `5623cb60` received exact CAS64 approval and Main FF without push; broader map parity and task1095 remain open.


## Large causal envelopes: delivery65

Existing large Source checkpoints reopen without the observed regexp stack overflow, preserving canonical bytes and the admitted state budget. Two-key MCP returns complete identical envelopes; Brave imports, opens and reloads the normal exported project. [Evidence and limits](tasks/vvd1095/verification-sdk-convergence.md#source65-validacion-base64-grande). Source `5db5570dd6185ecfb3be1d26b70abb08b1678d40` received exact CAS65 approval and Main FF without push. Character-level text, rich collaboration and wider parity remain open.


## Opt-in plain text collaboration

Local-tool authors can opt a plain prose field into captured UTF16 edits. SDK replicas and the normal Source writer preserve character identities through concurrent inserts, overlapping deletions, author Undo/Redo and reopening. Existing whole-field prose and rich HTML retain their own behavior. `textRange` is readonly; applying its captured range, Save and change-file exchange use the existing version checks and writer. [Author API and limits](docs/local-tool-sdk.md#opt-in-plain-utf16-text).

This is plain text, not a collaborative rich editor, caret/presence service or automatic network session. The normal runtime package flow can supply an author component; it does not install a generic editor automatically. Overall SDK and web parity remain open.


## Optional extensions for SDK rich prose editors

Local-tool authors can pass a stable `extensions` array to `LocalToolRichProseEditor`, for example to add a custom keyboard command. The same native host handles explicit Save, local text Undo and Source Undo/Redo; a compatible custom `doc` node replaces StarterKit's document node. Omitting the prop or passing `[]` preserves the defaults. Keep the array and extension objects stable for the editor mount.

This adds author behavior to the existing admitted HTML profile; it does not add dynamic schema reconfiguration or collaborative rich text. [Author API](docs/local-tool-sdk.md#optional-rich-editor-extensions) and [attributed checks and remaining work](tasks/vvd1095/verification-sdk-rich-prose.md#optional-rich-editor-extensions-source-f437039) distinguish the normal package/Brave checks, registered dispatcher and independent component tests. General web/SDK parity remains open.


## Recovering a Source document with pending changes

If another consumer archives an open Source rich briefing, its unsaved draft stays visible and available to copy in the same editor, with editing and Save/Undo/Redo disabled. Restoring the saved document creates a fresh generation: saving the older draft still reports a conflict and preserves it. Discard deliberately adopts the restored saved version; discarding while archived releases the draft and leaves one unavailable notice. Retaining the draft does not restore or save the document automatically.

The linked notebook's pending flusher also confirms its saved draft has cleared before document navigation completes. Actual conflicts and an unadded item still block leaving. These changes are approved and integrated in source `48539f8`. [Recovery evidence and limits](tasks/vvd1095/verification-sdk-rich-prose.md#source-recovery-48539f8). A later rename check failed once and passed in a separate observed run; its readiness follow-up remains open. Rich collaboration and overall web/SDK parity continue.


Local Source tools can opt into a separate collaborative rich profile: paragraphs, five inline marks and stable text identities. The normal SDK editor keeps a local draft, explicit Save and author Undo/Redo; independent updates merge through the existing Source writer. Headings, nested lists, arbitrary schemas and shared presence are still pending, and large histories remain slow. This is separate from the existing rich HTML editor. [Author API](docs/local-tool-sdk.md#collaborative-rich-paragraphs); [verification and limits](tasks/vvd1095/verification-sdk-rich-prose.md#collaborative-rich-paragraphs-source55d391be).


Project Overview and the command palette can create a timeline or cork board directly from the entered title, alongside writings, notes and outlines. Choices follow enabled engines; creation and navigation retain the active pane’s era, where outlines stay unavailable. MCP exposes the same options and normal create Undo. [Use and verification](tasks/vvd1095/verification-quick-create-engines.md#delivery44a4d4af).


Quiet replica reads now reuse a private raw projection (Source7d3f1365, approved1796r4). Transaction/context changes invalidate it and public results remain detached copies. Functional Browser and new two-key Native checks pass; large-history typing performance remains open. [Evidence and limits](tasks/vvd1095/verification-sdk-rich-prose.md#private-replica-projection-source7d3f1365).


## Optional automatic saving of shared rich documents —1952

The normal shared rich editor offers **Manual** and **Automatic**. Manual is the initial default. A personal choice is remembered for future document instances in this library; panes already open and other libraries/people keep their own modes. Automatic coalesces admitted pending changes for500ms through the same whole-document Save and Source writer. Manual outside a room retains independent field saves.

A Save confirms only its captured cut: later edits remain pending. Switching to Manual stops future attempts while an existing Save settles. Errors preserve the draft for explicit Retry. Leave starts no Save, waits only for writes already in flight and returns to the saved local Source; fresh local editing can save automatically again. SDK `documentContent.setSaveMode` and normal MCP `wh_local_tool_live_control` use this same open instance; a cold request does not create an editor.

[API](docs/local-tool-sdk.md#automatic-saving-of-open-rich-documents) and [attributed acceptance](tasks/vvd1095/verification-autosave1952.md#current-acceptance-of-cut3) supersede earlier preparation notes about autosave being unavailable. Source `0ac21d2cd02ef500a4ac08f6492d10b94710efe1`, integrated in Main as `0ac21d2cd02ef500a4ac08f6492d10b94710efe1` after independent acceptance; no push. Links1958, large-history responsiveness, physical IME, hosting and complete1095 parity remain open.


## Links in new shared rich documents

Local tools can opt into causal links in paragraph or block fields. The normal editor adds Link with its current address, Apply, Remove and Cancel; author Undo/Redo, Manual/Automatic saving and local content sharing use the existing Source writer. The installed Linked notebook demonstrates two compatible fields and one legacy field. The HTML editor keeps its existing behavior.

Source `93e1766088185d209110af5f9f7b8b94bc687109` is approved at writers1958/revision1 and integrated locally without push. That first milestone covers new native4/profile2 documents; the subsequent existing-history adoption is documented above. Images/tables in this profile, physical IME, large-history responsiveness and the remaining parity work stay open. [API](docs/local-tool-sdk.md#causal-links-in-new-shared-documents-profile2) · [verification and scope](tasks/vvd1095/verification-rich-links1958.md).
