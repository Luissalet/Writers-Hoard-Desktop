# Writers Hoard project knowledge

Last verified: 2026-07-27 against the current uncommitted working tree after the
stability, cross-engine workflow, and product-capability implementation.

Use this as the current-state companion to `tasks/lessons.md`. The older
`tasks/architecture-unified-app.md` is a design/migration plan; many of its
ideas are now implemented, so it should not be treated as the current map.

## Product and runtime shape

Writers Hoard is a local-first creative-writing platform. The same React
renderer can run as a web app or inside Electron, but the desktop shell is the
primary target.

```text
Electron main process
├─ BrowserWindow + application menu + updater
├─ sandboxed preload bridge (`window.electronAPI`)
├─ managed media/archive files under Electron userData
├─ loopback media downloader on 127.0.0.1:8765
├─ `wh-media://` playback protocol
└─ yt-dlp / gallery-dl / ffmpeg / hidden-page capture

React renderer
├─ Router + persistent application shell
├─ project dashboard and global pages
├─ dynamic project engine
├─ Dexie/IndexedDB (authoritative structured data)
├─ Web Workers for world generation
└─ direct Google APIs and local OpenAI-compatible AI endpoint
```

There is no central application server. Structured data lives in IndexedDB.
Scrapper media and page archives are the important exception: Dexie stores
relative paths while Electron owns the files on disk.

## Boot, routing, and shell

- `src/main.tsx` mounts `App` under React StrictMode.
- `src/App.tsx` imports `@/engines` for registration side effects.
- Desktop uses `HashRouter` because the renderer loads under `file://`; web uses
  `BrowserRouter`.
- `MainLayout` permanently mounts the sidebar, route outlet, global search,
  quick-note host, and toast host.

Current routes:

| Route | Purpose |
|---|---|
| `/` | Project dashboard, import/export, project creation |
| `/notes` | Project-less quick-capture inbox |
| `/media-downloader` | Desktop-only standalone downloader |
| `/project/:id` | Redirects to the Project Overview cockpit |
| `/project/:id/overview` | Project Cockpit, health, intelligence, and cross-engine tools |
| `/project/:id/:tab` | Lazily renders a valid enabled engine |

`ProjectDetail` repairs duplicate/stale engine ordering, heals missing or
disabled tabs back to Overview only after the project has hydrated, supports a
zero-engine management state, and wraps lazy engine roots in Suspense plus an
engine-local error boundary.

## Source map

| Area | Responsibility |
|---|---|
| `src/engines/` | Feature modules, domain models, operations, hooks, and UI |
| `src/engines/_shared/` | CRUD/hook factories, reusable engine UI, search, backup, anchoring |
| `src/db/` | Dexie schema/migrations plus project/settings and legacy operations |
| `src/components/` | Application shell and general UI primitives |
| `src/pages/` | Global pages and dynamic project composition |
| `src/stores/` | Thin Zustand layer for UI/integration state |
| `src/services/` | Backup, AI, search, project intelligence/tools, Google, writing activity, media/capture bridges |
| `electron/` | Native shell, IPC, updater, media/archive infrastructure |
| `harness/` | Ad-hoc worldgen checks, renderers, profilers, and browser drivers |
| `docs/worldgen/` | Worldgen research and visual references |
| `tasks/` | Plans, reviews, accumulated lessons, and historical audits |

The current source is dominated by the engine layer: roughly 57k lines across
285 files. Worldgen alone is roughly 30k lines and should be treated as a
sub-application rather than a normal CRUD engine.

## Engine architecture

Importing `src/engines/index.ts` registers 22 engines. An `EngineDefinition`
declares metadata, category, table names, root component, and an optional
sidebar badge. Projects store their active engine IDs in `enabledEngines` and
their presentation order in `engineOrder`.

Project modes are creation presets, not separate application modes:

- `essentials`
- `novelist`
- `biographer`
- `reporter`
- `playwright`
- `content-creator`
- `custom`

Most engines follow:

```text
src/engines/<engine>/
├─ index.ts        registration and cross-engine integrations
├─ types.ts        engine-owned domain types
├─ operations.ts   persistence and domain operations
├─ hooks.ts        React-facing data adapter
└─ components/     root and child UI
```

Typical mutation flow:

```text
component
→ makeEntityHook / makeGraphHook / custom hook
→ engine operation / makeTableOps
→ Dexie
→ guarded scoped refresh
→ component state
```

The shared hooks distinguish initial loading from background mutation refreshes
and reject stale asynchronous results. Project rows additionally use a small
publish/subscribe version counter because the sidebar and page keep independent
copies of the same project.

### Engine catalog

| Engine | Category | Purpose | Owned tables |
|---|---|---|---|
| `writings` | core | Drafts, chapters, manuscripts, version history | `writings`, `writingSnapshots` |
| `codex` | core | Characters, locations, items, factions, concepts | `codexEntries` |
| `timeline` | core | Multi-lane events, ranges, event links | `timelines`, `timelineEvents`, `timelineConnections` |
| `yarn-board` | core | Freeform node/edge concept maps | `yarnBoards`, `yarnNodes`, `yarnEdges` |
| `maps` | core | Uploaded maps plus synchronized Worldgen-backed maps and editable pins | `worldMaps`, `mapPins` |
| `gallery` | core | Image collections and linked inspiration | `imageCollections`, `inspirationImages` |
| `notes` | core | Short notes, quotes, ideas, and global inbox capture | `notes` |
| `writing-stats` | core | Sessions, goals, sprints, progress, streaks | `writingSessions`, `writingGoals` |
| `biography` | creative | Subjects and ordered sourced facts | `biographies`, `biographyFacts` |
| `brainstorm` | creative | Mixed freeform boards with entity references | `brainstormBoards`, `brainstormItems`, `brainstormConnections` |
| `dialog-scene` | creative | Scenes, formatted dialog/action blocks, cast | `scenes`, `dialogBlocks`, `sceneCasts` |
| `diary` | creative | Timestamped entries, moods, and tags | `diaryEntries` |
| `worldgen` | creative | Deterministic multiscale worlds, semantic 2D/3D maps, saved regions, cartography, and spatial editing | `generatedWorlds`, `worldWaypoints` |
| `annotations` | planning | Margin notes, references, backlinks, reanchoring | `annotations`, `annotationReferences` |
| `character-arc` | planning | Character journey templates and beats | `characterArcs`, `arcBeats` |
| `outline` | planning | Hierarchical beats and plot templates | `outlines`, `outlineBeats` |
| `pov-audit` | planning | Derived character usage and imbalance analysis | none |
| `relationships` | planning | Cross-entity relationship graph | `relationships` |
| `seeds` | planning | Foreshadowing seeds and payoff tracking | `seeds`, `payoffs` |
| `storyboard` | planning | Ordered visual panels and connectors | `storyboards`, `storyboardPanels`, `storyboardConnectors` |
| `video-planner` | planning | Script/visual segments, teleprompter, recording | `videoPlans`, `videoSegments` |
| `scrapper` | research | Web/media capture, metadata, archive, local playback | `snapshots` |

## Persistence and domain invariants

`WritersHoardDB` currently reaches schema version 23 and exposes 50 typed table
properties. Engine table declarations are descriptive and support backup
coverage checks; they do **not** generate the Dexie schema. A persisted engine
still needs a central, versioned change in `src/db/index.ts`.

Important rules:

- Every engine-owned root row should carry the correct `projectId`.
- Child tables without `projectId` must be traversed through their parent for
  project deletion, backup, and restore.
- Dexie does not enforce foreign keys. Parent/child IDs and cross-engine IDs are
  soft references whose lifecycle must be handled explicitly.
- `engineOrder` should contain each enabled engine exactly once.
- Ordered-item APIs must receive every scoped row; omitted IDs can be assigned
  an invalid `order` such as `-1`.
- Prose is stored as TipTap HTML. Many embedded images are base64 in IndexedDB.
- Notes use `__inbox__` as the project-less scope because Dexie cannot index an
  undefined project ID.
- Worldgen source-of-truth is `(seed/params + ordered edits)`. The compressed
  `worldSnapshots` table is a replaceable cache and is intentionally excluded
  from backups.
- Worldgen landmarks and regional places use deterministic source keys. Rename,
  move, style, hide, and restore operations remain sparse edits so regenerated
  terrain and resolution changes do not orphan user-authored changes.
- Saved Worldgen regions are lightweight viewport definitions on the generated
  world. Regional terrain is derived in a cancellable worker and held in an LRU
  cache rather than persisted as authoritative data.

Recent schema direction:

- v18 added writing history.
- v19-v20 added generated worlds, waypoints, and derived world snapshots.
- v21 added Notes, migrated legacy Links into link-only Scrapper snapshots, and
  removed `links` from project engine lists.
- v22 dropped the retired `externalLinks` store.
- v23 added project-scoped `entityLinks`, `citations`, `publishingProfiles`, and
  `conversionReceipts`.

## Cross-engine infrastructure

Engine `index.ts` files can register three independent capabilities:

1. Entity resolvers power global title search and entity preview.
2. Anchor adapters power annotations, backlinks, and deep navigation.
3. Backup strategies own project ZIP serialization and restoration.

Current coverage:

- Searchable entities carry their owning `projectId`; title search can be
  project-scoped or global without guessing ownership from the current route.
- Rich anchor adapters remain for engines with native selection semantics.
  Every other searchable engine receives a navigation-safe fallback adapter.
- Persisted engine strategies pass static schema/ownership conformance and the
  critical browser suite round-trips parent/child and empty-parent cases.
- Project-tool tables use a project-scoped backup strategy registered at engine
  bootstrap.

Global full-content search uses one invalidation-aware in-memory index instead
of rescanning tables per keypress. It indexes Writings, Codex, Diary, Dialog,
and Scrapper research text, while registered resolvers cover entity titles.

## Important workflows

### Writing

Writings store TipTap HTML and autosave after a 1.2-second debounce. Saves are
serialized and awaited; edits arriving during a save are coalesced into the next
write. Dirty/saving/saved/error UI reflects confirmed persistence, and a
localStorage recovery journal survives a failed/unload-time IndexedDB write.
A session snapshot is created when editing begins; manual and pre-restore
snapshots make restoration reversible. Positive word/time deltas feed Writing
Stats using local calendar-day keys.

### Scrapper

A snapshot row is created first. Desktop then runs one of two asynchronous
pipelines:

- media sources: yt-dlp, with gallery-dl fallback for Instagram;
- normal pages: hidden Chromium render, PDF, screenshot, HTML, metadata, and
  Readability extraction.

Downloads/captures are serialized, cancellable, and aborted on application
quit. Relative paths and lifecycle/error state are written back to the snapshot.
Interrupted states are reconciled on the next startup. Asset Vault can audit
managed files, clear missing references, and relocate the managed library while
retaining the old directory as a safety copy.

### Quick notes

The floating quick-note window never opens Dexie. It submits through IPC, the
main process relays to the already-mounted main renderer, and `QuickNoteHost`
performs the only database write. This avoids multi-window refresh conflicts.
The Project Cockpit can explicitly open this capture surface or read clipboard
text after a user click.

### Worldgen

The world viewport is shared across 2D, 3D, and regional sheets. Semantic zoom
uses planetary, continental, regional, and local tiers with hysteresis,
deterministic label decluttering, and tier-specific feature budgets. Close
views request regional worker tiles; the 2D renderer composites their terrain
and places, while the 3D surface blends their elevation through a detail
texture. Three-dimensional display quality adapts DPR and mesh density against
a rolling frame budget.

Landmarks and regional places resolve through one spatial-entity model and one
inspector. Selection, renaming, movement, symbol/style edits, label visibility,
hide/restore, exact reveal, and cross-engine links therefore remain consistent
between renderers. Worldgen-backed Maps rows retain source provenance and
synchronize source waypoints; uploaded maps remain standalone.

### Project Cockpit and cross-engine tools

Overview is a reactive Dexie read model covering recent work, health issues,
repair actions, aggregated entities/backlinks, the editable
Outline Beat ↔ Scene ↔ Writing narrative spine, story metrics, and asset
inventory. Its tool views add:

- Notes/Diary/Scrapper promotion to Writings with typed provenance receipts and
  transactional undo;
- project recipes and custom templates;
- citations, bibliography formatting/export, and research coverage;
- publishing profiles for manuscript, screenplay, research, biography, and
  video outputs;
- explicitly opt-in grounded AI. Both the feature and remote requests default
  off; only selected indexed excerpts are sent and answers are instructed to
  cite their source IDs.

### World generation

The deterministic pipeline is:

```text
plates → terrain → erosion → glaciers → currents → climate
→ hydrology → biomes → landmarks → final fields
```

The UI checks a small in-memory cache, then a compressed IndexedDB snapshot,
then runs the pipeline in a Web Worker. Typed arrays are transferred back
zero-copy. Painting mutates live arrays, so saved edits must replay exactly once
against a pristine generated copy.

## Native and external boundaries

- The preload bridge exposes app metadata, limited filesystem checks/pickers,
  media, page capture, Instagram login, export, quick notes, and updates.
- Browser windows use context isolation, sandboxing, and no Node integration.
- Managed paths are traversal-checked before disk access.
- The media-library relocation IPC chooses its destination in the main process,
  writes its location atomically, and never accepts an arbitrary renderer path.
- Google Identity/Drive/Docs are called directly from the renderer.
- AI uses an OpenAI-compatible endpoint, defaulting to
  `http://localhost:8317`.
- Google OAuth tokens remain in memory; locale and AI configuration persist in
  Dexie settings.

## Current guardrails and residual risks

- ZIP restore preflights before mutation, imports inside a Dexie transaction,
  and fails closed with structured engine/path diagnostics. Scrapper backups
  deliberately preserve metadata but reset unavailable external-file states;
  the native files themselves are not embedded in ZIP archives.
- Parent deletion owns high-risk children/caches (writing snapshots, Yarn
  edges, world caches), and Project Health can detect/repair other stale soft
  references. Dexie still has no foreign keys, so new relationships require a
  deliberate lifecycle audit.
- `verify:quick` enforces renderer/Electron types, a zero-fingerprint shipping
  lint baseline, engine/schema/backup/locale conformance, and pinned binary
  metadata. `verify:release` additionally runs isolated Electron/IndexedDB
  critical tests, complete bundled/Vite renderer startup smoke tests,
  production builds, and renderer bundle budgets.
- Engine roots are split, including large Worldgen and editor paths. The shared
  renderer entry remains sizeable (about 1.49 MB minified in this verification)
  and is protected by a 1.6 MB ratchet rather than considered fully optimized.
- The recovery journal is intentionally best-effort and remains subject to
  browser localStorage quota. Writing analytics never turn a successful
  document save into a failure.

## Efficient extension checklist

When adding or changing an engine:

1. Start from the engine's `index.ts`, types, operations, hooks, and root UI.
2. If persistence changes, add a new Dexie version and typed table property.
3. Add/update `engines.<id>.name` and `.description` in both locales.
4. Update relevant project-mode defaults/suggestions only when intentional.
5. Register entity resolution if the data should be globally searchable.
6. Register an anchor adapter if it should support annotations/deep links.
7. Implement a round-trippable backup strategy. Use custom parent traversal for
   every child table that lacks `projectId`.
8. Audit single-entity deletion, whole-project deletion, and external files.
9. Preserve the guarded initial-load/background-refresh hook contract.
10. Run `verify:quick`; for persistence, lifecycle, route, or backup changes,
    extend and run `test:critical`. Run `verify:release` before packaging.

## Verification commands

```powershell
npm run verify:quick
npm run test:critical
npm run verify:release
```

For desktop behavior, use `npm run dev:desktop`. The coordinated launcher starts
Vite, reads its resolved local URL, passes that exact URL to Electron, and owns
both lifecycles. Port fallback is therefore safe even when another local Vite
instance is already listening. Changes under `electron/` require restarting the
Electron process; refreshing the renderer is not enough.

Always inspect `git status` first. The repository often contains deliberate
uncommitted work, staged alternatives, and archived experiments that must not be
overwritten or treated as disposable.
