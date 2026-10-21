# World eras — task 1041

Implement document overlays with explicit per-pane context. Creating an era copies no content. Base storage remains canonical and untouched by era reads/switches; no fake project IDs, global active era, database swapping or restore-based switching.

## Contract and verification

- [x] Add small era definitions and an indexed variant table; additive migration.
- [x] Typed document adapters for base-row aggregates and metadata documents; scoped reads, CAS saves, era-only documents, tombstones and reinheritance.
- [x] Pane-local era selection/theme/navigation, isolated recovery namespaces and normal Codex/Writings editing.
- [x] Integrate Notes, Maps, Board, Timeline and six metadata tools; coordinate active character-sheet/worldgen authors.
- [x] Expose native era API/MCP and coordinate existing tool/read-derived consumers with root.
- [x] Preserve eras through project JSON clone, ZIP backup/restore and recoverable archive.
- [x] Tests: create era produces zero document copies; same logical document in two panes/eras stays isolated from base; stale writes preserve drafts; tombstone/reinherit and era-only data; derived references; clone/archive/ZIP; actual CSS desktop/narrow and native bridge.

## Decisions

Named eras inherit the default/base view. A saved variant replaces one logical document (including its own child rows); it does not deep-merge arbitrary arrays. Unmodified documents continue reading current base data. Existing base operations retain their domain-specific behavior. Explicit era operations never invoke base rename propagation or deletion policies. Assets remain shared references whenever the source format already separates them.

Root owns readerExport, projectSearchIndex, toolBlocks/preview, global bridge registrations, active character-sheet work and worldgen rendering. Coordinate API changes before touching those paths.

## Progress / evidence

Implementation and scoped verification complete; awaiting root's fresh independent review and integration checks. No claim of complete external-product parity.

The store contains 15 document adapters. Definition creation and inherited reads create zero variants. CAS tokens hash actual binary bytes and remain fixed-size. Immutable audio/model payloads are deduplicated outside retained history. Explicit capture checkpoints replace only provisional recording versions; final saves preserve normal history. Individual reads query logical IDs without hashing unrelated document payloads. Store notifications wait for the outer domain transaction to commit and run outside its Dexie context; rollback does not trigger a refetch into a closing transaction.

Normal per-pane UI covers Codex/Writings, Notes, Maps, Board, Timeline, Dictionary, Tables, Genealogy trees, Character Sheets, Radar, Models Conversation/scenes and Worldgen. Root owns derived readers/wiki/search/preview and ordinary Codex/Writings MCP integration. Agent B owns Media/Voice scoping. Archive and Library capture the focused pane when opened; archive/restore/reinherit remain contextual. The shared Base archive also now actually archives Radar rows shown in its active list.

Worldgen recipes, waypoints, regions, regeneration/location policy, recalculation, journeys, alternative worlds and map export use explicit context. Runtime terrain buffers, live writers, snapshots and canon bindings use an era/document cache key while references retain logical IDs. Local manuscript links are a small field on the world recipe; absent links inherit Base. Journey capture creates era-local notes or scenes and records its source link on the contextual world recipe. Conversation/scenes include the root, cast and authored blocks; normal scene editors, cast selection, composer recovery, preview, Fountain export/import and native MCP tools share the same explicit scope. Scene numbering/reordering is contextual; simply opening an inherited scene does not create numbering variants.

Retiring a shared Codex type now retains compiled definitions in current and historical era cards, advances affected current CAS revisions and creates no inherited overlays. Native reproduction of the independent Cargo fixture passes: total21 → retire → total21 → crates4 → total28. A stale pre-retirement candidate is rejected; historical restoration still calculates.

Commands and evidence (isolated Electron profiles, synthetic data):

- `electron scripts/run-focused-browser-tests.cjs tests/world-eras.browser.tsx testWorldEras 250000` — 7 groups PASS: zero-copy fallback, independent contexts, CAS/history/Undo/recovery, hide/reinherit, type retirement, clone/ZIP, registered dispatch.
- `electron scripts/run-focused-browser-tests.cjs tests/world-eras.browser.tsx testWorldWorkspaceUi 250000` — real ProjectWorkspace two-pane Writings, focused Library and Archive hide/restore, return to Base PASS.
- `electron scripts/run-focused-browser-tests.cjs tests/world-eras-adapters.browser.tsx testWorldEraAdapters 250000` — 6 groups PASS: metadata domain operations, map snapshots, timeline/calendar cascade, board merge/conflict, binary identity/dedup, normal JSON/full-project ZIP.
- `electron scripts/run-focused-browser-tests.cjs tests/world-eras-worldgen.browser.tsx testWorldEraWorldgen 250000` and `testWorldEraWorldgenUi` — real small terrain/cache/live-writer isolation, recipe/journey/link/capture/clone, registered handlers and two real waypoint editors PASS.
- `electron scripts/run-focused-browser-tests.cjs tests/world-eras-conversation.browser.tsx testWorldEraConversation 250000` and `testWorldEraConversationUi` — own cast/card/sheet, atomic append ordering, effective preview, journal recovery, script import/Fountain export, Undo, JSON clone and full project ZIP PASS. `testWorldEraNotificationLifecycle` verifies post-commit notification isolation, deduplication and rollback; `testWorldEraDraftCleanup` verifies live/cold Base/era/Board journal cleanup preserves a similar project ID.
- `electron tests/world-eras-transport.cjs` — real MCP stdio → HTTP → executor → IPC → normal renderer handlers → IndexedDB PASS, including era tools, Cargo retirement and ordinary Maps/Board/Timeline/Calendar/Worldgen tools and Conversation cast/turn/scene creation with actual audit Undo.
- `electron tests/world-eras.runner.cjs` — actual product CSS at1440/640, local dark/light themes, create/edit CAS/archive/restore era toolbar PASS. Inspected screenshots: `%TEMP%/wh-world-eras-ui-dbXIXg/world-eras-{1440,640}.png` and `world-eras-editor-640.png`. The same run captures `world-eras-conversation-{1440,640}.png`, inspected with effective era turns.
- Base regressions `testWorldgenBridgeAccess`, `testWorldgenRecipes`, `testWorldgenJourneys`, `testWorldgenCreative`, `testWorldEnvironment` PASS.
- Targeted ESLint for store/adapters/UI/worldgen/native changes PASS. Final renderer TypeScript PASS locally after Conversation/cleanup changes (session13017); shared full-build checks belong to root.

Remaining verification belongs to root: fresh independent review, shared full build and final cross-engine derived consumers. No production app/model started; no real projects modified; no commits made.


## Hook dependency follow-up

Resolved the18 shipping-lint warnings in MapsEngine, TimelineEngine, BookEditor, HistoryModal, ParallelDraftPane/Workspace and WritingsView by declaring their actual memoized scoped readers/writers and scope dependencies. Parallel-draft metadata queries now include eraId. No hook rule suppression or lint-baseline change. Existing useWorldEraScope/useEraWritingOperations/useEraSnapshotOperations memoization keeps callbacks stable for geometry/visibility updates, so adding dependencies does not reload chapters or create additional saves/snapshots.

`testWorldEraHookStability` verifies stable method identities/effect count across width/visibility updates and exactly one rebind when switching era or returning to Base. Base map deep links retain direct table reads: a missing project selected only for a stale/foreign link still resolves as absent, preserving the former behavior without an unhandled project_missing from era validation. Named map reads remain scoped.

Area ESLint PASS. Regression suites PASS: testParallelDrafts(9groups), testBookEditorAutosave, testWorldWorkspaceUi, testTimelineScopes(6groups), testVvdMaps(7groups). Full shipping lint result is coordinated with root.
