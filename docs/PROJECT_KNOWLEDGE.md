# Writers Hoard project knowledge

Last verified: 2026-07-27 against the current working tree, including uncommitted
Notes/quick-note and Links-to-Scrapper migration work.

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
| `/project/:id` | Redirects to the project's first enabled engine |
| `/project/:id/:tab` | Renders the selected engine |

`ProjectDetail` is intentionally thin. It reads the project's ordered engine
IDs, resolves them through the registry, and renders the selected engine root
with only `projectId`.

## Source map

| Area | Responsibility |
|---|---|
| `src/engines/` | Feature modules, domain models, operations, hooks, and UI |
| `src/engines/_shared/` | CRUD/hook factories, reusable engine UI, search, backup, anchoring |
| `src/db/` | Dexie schema/migrations plus project/settings and legacy operations |
| `src/components/` | Application shell and general UI primitives |
| `src/pages/` | Global pages and dynamic project composition |
| `src/stores/` | Thin Zustand layer for UI/integration state |
| `src/services/` | Backup, AI, Google, writing activity, media/capture bridges |
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
| `maps` | core | Uploaded world maps and pins | `worldMaps`, `mapPins` |
| `gallery` | core | Image collections and linked inspiration | `imageCollections`, `inspirationImages` |
| `notes` | core | Short notes, quotes, ideas, and global inbox capture | `notes` |
| `writing-stats` | core | Sessions, goals, sprints, progress, streaks | `writingSessions`, `writingGoals` |
| `biography` | creative | Subjects and ordered sourced facts | `biographies`, `biographyFacts` |
| `brainstorm` | creative | Mixed freeform boards with entity references | `brainstormBoards`, `brainstormItems`, `brainstormConnections` |
| `dialog-scene` | creative | Scenes, formatted dialog/action blocks, cast | `scenes`, `dialogBlocks`, `sceneCasts` |
| `diary` | creative | Timestamped entries, moods, and tags | `diaryEntries` |
| `worldgen` | creative | Deterministic worlds, maps, 3D, cartography, editing | `generatedWorlds`, `worldWaypoints` |
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

`WritersHoardDB` currently reaches schema version 22 and exposes 46 typed table
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

Recent schema direction:

- v18 added writing history.
- v19-v20 added generated worlds, waypoints, and derived world snapshots.
- v21 added Notes, migrated legacy Links into link-only Scrapper snapshots, and
  removed `links` from project engine lists.
- v22 dropped the retired `externalLinks` store.

## Cross-engine infrastructure

Engine `index.ts` files can register three independent capabilities:

1. Entity resolvers power global title search and entity preview.
2. Anchor adapters power annotations, backlinks, and deep navigation.
3. Backup strategies own project ZIP serialization and restoration.

Current coverage:

- 20 of 22 engines register entity resolvers. Annotations and the tableless POV
  audit do not.
- Six engines register anchor adapters: Writings, Codex, Yarn Board, Maps,
  Seeds, and Worldgen.
- Every persisted engine has some backup registration, but registration by
  table name is not proof that the strategy can round-trip its relationships.

Global search combines registered title resolvers with full-content scans of
Writings, Codex, Diary, and Dialog bodies.

## Important workflows

### Writing

Writings store TipTap HTML and autosave after a 1.2-second debounce. A session
snapshot is created when editing begins; manual and pre-restore snapshots make
restoration reversible. Positive word/time deltas feed Writing Stats.

### Scrapper

A snapshot row is created first. Desktop then runs one of two asynchronous
pipelines:

- media sources: yt-dlp, with gallery-dl fallback for Instagram;
- normal pages: hidden Chromium render, PDF, screenshot, HTML, metadata, and
  Readability extraction.

Downloads/captures are serialized, cancellable, and aborted on application
quit. Relative paths and lifecycle/error state are written back to the snapshot.

### Quick notes

The floating quick-note window never opens Dexie. It submits through IPC, the
main process relays to the already-mounted main renderer, and `QuickNoteHost`
performs the only database write. This avoids multi-window refresh conflicts.

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
- Google Identity/Drive/Docs are called directly from the renderer.
- AI uses an OpenAI-compatible endpoint, defaulting to
  `http://localhost:8317`.
- Google OAuth tokens remain in memory; locale and AI configuration persist in
  Dexie settings.

## Current risks and future inspection priorities

These are findings from the exploration, not fixes made by this task.

1. **ZIP backup can silently omit data.**
   - Timeline registers only `timelineConnections`; `timelines` and
     `timelineEvents` still assume a removed legacy export path.
   - The generic backup strategy assumes every listed table has a `projectId`
     index. `brainstormConnections` and `annotationReferences` do not.
   - Per-engine backup/import failures are logged and ignored, while the outer
     UI can still report success. Full restore clears registered tables first.
   - Scrapper backs up path metadata, not the external media/archive files.
   - Empty gallery collections are not exported.
   - There is no automated backup round-trip test.

2. **Last-write durability deserves a focused review.**
   Writing autosave marks its baseline/UI saved before the asynchronous write
   is known to have completed, including unmount/beforeunload paths.

3. **Soft-reference and cascade behavior is uneven.**
   Engine-level writing deletion can leave version snapshots, Yarn node deletion
   can leave incident edges, and project deletion leaves derived world snapshot
   cache rows. Most cross-engine references are not repaired when targets die.

4. **Global search results lack project ownership.**
   Title resolvers search across all projects but `EntityPreview` has no
   `projectId`. Anchor navigation infers the current project from
   `window.location.pathname`, which is unreliable from the dashboard, another
   project, and Electron's hash-based routes.

5. **Writing Stats uses UTC day boundaries.**
   `toISOString()` can assign late-night activity to a different perceived day
   in Europe/Madrid.

6. **Quality gates are incomplete.**
   There is no test runner, test script, coverage threshold, or backup
   round-trip suite. The 52-file `harness/` collection is useful but ad hoc,
   partially Linux-specific, and not wired to CI.

7. **Release CI does not run all available static checks.**
   Neither Pages nor desktop release CI runs lint or Electron typechecking.
   Electron main/preload are bundled by esbuild, which does not typecheck.

8. **Binary and documentation reproducibility can drift.**
   yt-dlp and gallery-dl are downloaded from mutable `latest` URLs without
   pinned versions/checksums. `.env.example` still names Vite port 5173 while
   the project uses 5174, and README/build comments underdescribe gallery-dl.

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
10. Verify renderer TypeScript, Electron TypeScript, lint, and the relevant
    manual/harness workflow. For persistence work, manually round-trip a ZIP
    until an automated suite exists.

## Verification commands

```powershell
npx tsc -b --noEmit
npm run typecheck:electron
npm run lint
```

For desktop behavior, use `npm run dev:desktop`. Changes under `electron/`
require restarting the Electron process; refreshing the renderer is not enough.

Always inspect `git status` first. The repository often contains deliberate
uncommitted work, staged alternatives, and archived experiments that must not be
overwritten or treated as disposable.
