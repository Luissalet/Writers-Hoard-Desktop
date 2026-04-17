# Daily Modularization & Optimization Report — 2026-04-18

## Summary

Two-front session: **(1)** closed a critical data-loss bug in the backup pipeline by migrating it from a hardcoded table list to an engine-driven registry, and **(2)** finished off long-tail i18n gaps in YarnBoard's node components and engine view. Also pruned orphaned legacy hooks and brainstormed the next wave of engines / platform capabilities.

TypeScript compiles clean — `npx tsc -b --noEmit` exits 0.

---

## Changes Made

### 1. Modular Backup Registry (CRITICAL — fixes silent data loss)

**Problem**: `src/services/zipBackup.ts` was a 600+ line monolith that hardcoded the list of tables it knew how to export/import. It only handled **15 of 33** Dexie tables. Every engine added since the original backup code (diary, biography, outline, writing-stats, storyboard, video-planner, scrapper, brainstorm, dialog-scene extras, timeline connections — covering 18 tables) was being silently dropped on backup. Users restoring from a ZIP would lose all data in those engines, with no error or warning.

**Solution**: New `src/engines/_shared/backupRegistry.ts` introduces a per-engine `BackupStrategy` interface. Each engine registers its own `exportProject`/`importProject` in its `index.ts`. `zipBackup.ts` discovers strategies via `getAllBackupStrategies()` and runs them inside the existing per-project loop.

A `makeSimpleBackupStrategy({ engineId, tables, folder?, projectIdField? })` covers the 90% case (tables scoped by `projectId`). Engines with non-standard scoping (storyboard connectors keyed by `storyboardId`, dialog-scene's `sceneCasts` keyed by `sceneId`) supply custom `exportProject`/`importProject` functions.

Critically, the legacy hardcoded export/import code stays intact alongside the registry loop, so **existing user backups still restore correctly**. New engines get covered additively.

**Files touched**:
- New: `src/engines/_shared/backupRegistry.ts` (~120 LOC)
- Updated: `src/engines/_shared/index.ts` (re-exports with name-conflict aliases)
- New strategy registrations in 10 engine `index.ts`:
  - biography, brainstorm, diary, outline, scrapper, video-planner, writing-stats — simple strategies
  - dialog-scene — custom strategy for `sceneCasts` (walks `scenes` to gather IDs, then `where('sceneId').anyOf(...)`)
  - storyboard — custom strategy for `storyboardConnectors` (walks `storyboards`, then `where('storyboardId').anyOf(...)`)
  - timeline — supplemental strategy adds `timelineConnections` (the v15 table that legacy code never knew about); folder is `timeline-extras` to avoid colliding with the legacy `timeline/` folder
- `src/services/zipBackup.ts`:
  - Imports the engine barrel so registrations fire
  - Iterates `getAllBackupStrategies()` inside both export and import loops
  - Dynamic table-clear list combines legacy + registered strategy tables, filtered against `db.tables` to skip any not present in the open schema

**Impact**: Backup coverage went from 15/33 → 33/33 tables. Adding a new engine that needs persistence is now a single `registerBackupStrategy(makeSimpleBackupStrategy({...}))` line in `index.ts` — no edit to `zipBackup.ts`.

### 2. Orphaned Hook Cleanup

**Problem**: After the engine-migration work that moved CRUD into per-engine `hooks.ts`, four files in `src/hooks/` (`useMaps.ts`, `useExternalLinks.ts`, `useCodexEntries.ts`, `useGallery.ts`) were left behind as orphans. Confirmed zero imports across the codebase.

**Solution**: Sandbox can't delete files, so each was rewritten as an empty placeholder with a `@deprecated` JSDoc pointing to the new engine location and `export {};`. A clean checkout (or anyone with write access on the host) can `rm` them safely.

### 3. YarnBoard i18n Gap Closure

**Problem**: A long-standing memory note flagged "60+ hardcoded English strings in YarnBoard.tsx". Investigation revealed the main `YarnBoard.tsx` has been fully translated (40 `t()` calls, 64 `yarn.*` keys in `en.ts`) — the memory was stale. But there were still real residual gaps:

- `src/engines/yarn-board/YarnBoardEngine.tsx`: `placeholder="Board name..."` was hardcoded English
- 6 node components (`PostItNode`, `TextNode`, `ShapeNode`, `SemanticNode`, `ImageNode`, `GroupNode`) had hardcoded `title="Edit"` / `title="Delete"` tooltips
- `SemanticNode.tsx` had a dead `NODE_TYPES_CONFIG` with hardcoded English `label` fields (the runtime actually displayed `{d.nodeType}` raw — also untranslated)

**Solution**:
- Added `yarn.boardNamePlaceholder` to `en.ts` and `es.ts`
- Wired `useTranslation` into all 6 node components, replaced `title="Edit"` → `title={t('common.edit')}` and `title="Delete"` → `title={t('common.delete')}` (both keys already existed for other engines)
- Cleaned up `SemanticNode.tsx`: removed dead `label` fields from `NODE_TYPES_CONFIG`, replaced `{d.nodeType}` display with `{t(\`yarn.node.${d.nodeType}\`)}`

**Verification**: A grep for `title="(Edit|Delete)"|placeholder="[A-Z]..."|label: '[A-Z]` across the entire `yarn-board/` tree returns zero matches. Memory note `feedback_yarnboard_i18n.md` now needs to be updated/retired.

---

## Metrics

| Area | Before | After | Delta |
|---|---|---|---|
| Backup table coverage | 15/33 (45%) | 33/33 (100%) | +18 tables protected |
| Engines self-registering backup | 0 | 10 | +10 |
| Steps to add new engine to backup | edit zipBackup.ts (3 places) | 1 line in `index.ts` | -2 file touches |
| Orphan hooks in `src/hooks/` | 4 active orphans | 4 empty placeholders | safe to delete |
| YarnBoard hardcoded strings | 9 (8 tooltip + 1 placeholder) + 4 dead label fields | 0 | fully i18n'd |
| Locale keys added | — | `yarn.boardNamePlaceholder` (en + es) | +2 |
| TypeScript errors | 0 | 0 | green |

---

## Future Engine / Capability Brainstorm

Captured here so the next session can pick from a stocked queue rather than re-deriving ideas. Grouped by likely category and rough effort.

### High-leverage engines (fits existing project shape)

- **Character Arc Tracker** (`character-arc`) — Per-character timeline of internal change beats (want vs. need, lie vs. truth, ghost, save-the-cat-style arc points). Cross-links Outline beats and Biography. *Tables*: `characterArcs`, `arcBeats`. *Effort*: M. *Why*: writers consistently ask for this; current Outline tracks plot beats but not character interiority.
- **Relationship Matrix** (`relationships`) — Pair-wise grid showing how every character relates to every other (rival, mentor, lover, etc.). Complementary to YarnBoard (network view) — this is the dense matrix view. *Tables*: `relationships` (entityA, entityB, kind, intensity, notes). *Effort*: S.
- **Magic / Rules System** (`ruleset`) — Structured rules with cost/limitation/source fields, à la Sanderson's Three Laws. *Tables*: `rulesets`, `rules`. *Effort*: S.
- **Worldbuilding Calendar** (`calendar`) — Custom week/month/year systems for fantasy/sci-fi worlds; pin Timeline events to in-world dates. *Tables*: `calendars`, `calendarPeriods`, `calendarEvents`. *Effort*: M.
- **Conlang / Lexicon** (`lexicon`) — Word list with phonetics, etymology, part-of-speech, sample sentences. *Tables*: `lexicons`, `lexemes`. *Effort*: S.
- **POV / Scene Audit** (`pov-audit`) — Counts scenes per POV character and flags imbalance; uses existing `scenes` data. *No new tables*; pure derived view. *Effort*: XS.
- **Foreshadowing / Payoff Tracker** (`seeds`) — "Planted" notes paired with "harvested" payoffs across the manuscript. *Tables*: `seeds`, `payoffs`. *Effort*: S.
- **Theme & Motif Tracker** (`themes`) — Recurring imagery/symbols mapped to scenes. *Tables*: `themes`, `themeOccurrences`. *Effort*: S.
- **Submission / Query Log** (`submissions`) — For published-track writers: agents queried, response status, royalties, etc. *Tables*: `submissions`, `submissionEvents`. *Effort*: S.
- **Beta Reader Feedback** (`feedback`) — Aggregates comments per chapter from external readers. *Tables*: `feedbackThreads`, `feedbackComments`. *Effort*: M.
- **Encounter Builder / Combat Log** (`encounters`) — RPG/tabletop crossover: stat-blocks for creatures, encounter difficulty calc. *Tables*: `creatures`, `encounters`. *Effort*: M.

### Cross-engine platform capabilities

- **Entity Mention Auto-complete** in writing & editor surfaces (`@character`, `#location`) using the existing `entityResolverRegistry.searchEntities`. Single shared component, slots into Writings/Diary/Dialog-Scene editors. *Effort*: M. *Highest payoff for "feels like one app".*
- **Tag-as-Cross-Engine-Index** — `tags` already exists but is per-engine. Make it the universal join table; build a `/tag/:slug` route that lists every entity (any engine) sharing that tag. *Effort*: S.
- **Snapshot / Branch / "What-if" Forks** — Per-project soft-fork that copies engine data into an alt namespace. Useful for trying alternate plot directions. *Effort*: L (touches DB + project scoping everywhere).
- **Plugin / Third-Party Engine Loading** — The current `registerEngine` registry is already plugin-shaped; formalize a manifest + dynamic import loader so users can drop engine bundles into a folder. *Effort*: L.
- **Universal Backup-Strategy Validator** — Add a dev-mode assertion that every table declared in `EngineDefinition.tables` is covered by some `BackupStrategy.tables` or by `legacyTables` in `zipBackup.ts`. Prevents the v15 timelineConnections-style regression we just fixed. *Effort*: XS. **Recommend implementing first thing next session.**
- **Markdown / Scrivener / Word Round-Trip Export** — Beyond the ZIP backup, export the manuscript per-engine to standard formats. *Effort*: M per format.
- **AI-Assisted Consistency Checker** — Scans manuscript text against Biography facts, flags contradictions ("Eyes called blue in ch.2, brown in ch.7"). Could plug into the Codex entity references. *Effort*: L (needs LLM integration).
- **Cloud Sync (opt-in)** — Currently local IndexedDB only. A sync adapter that pushes the existing ZIP-backup payload to user-supplied storage (Dropbox/GDrive/S3) is the lowest-friction path. *Effort*: M.

### Quick UX wins (no new engines)

- Cross-engine **command palette** (Cmd+K) using `entityResolverRegistry.searchEntities` for jump-to.
- **Trash / Soft-delete** with restore (currently every delete is permanent — risky).
- **Bulk operations** on dashboard cards (multi-select + delete/tag/move).
- Per-engine **CSV import** built atop `BackupStrategy.importProject` (decompose the strategy interface to accept arbitrary sources, not just ZIP).

---

## Self-Review (per CLAUDE.md "Demand Elegance")

**Is the backup registry the elegant solution, or did I just paper over zipBackup.ts?**

The elegant end-state would have **only** the registry — the legacy hardcoded export/import block deleted. I deliberately didn't go that far this session because (a) doing so would break anyone restoring an older ZIP that was generated against the legacy folder layout, and (b) the legacy code handles cross-cutting concerns (image data-URL externalization for `inspirationImages`, ID rewriting for `projects`) that aren't yet generalized into the strategy interface.

The honest path forward — for a future session — is to:

1. Lift image-externalization into a `BackupContext.externalizeImage(field)` helper on the strategy interface.
2. Lift the project-ID-rewrite step into a `BackupContext.rewriteForeignKey()` helper.
3. Migrate the 7 legacy engine blocks (codex, writings, timeline, yarn-board, maps, gallery, links) onto strategies that use those helpers.
4. **Then** delete the legacy block — and keep a versioned `manifest.json` in the ZIP that lets the importer dispatch by strategy version.

Today's change was a strict superset of the old behavior (additive registry alongside the legacy code). That's the right shape for incremental migration, but it's worth being honest that the file isn't fully modular yet.

**Is "leave orphan hooks as empty placeholders" elegant?** No — it's a sandbox limitation workaround. Flagging it for the next clean-checkout session: `git rm src/hooks/{useMaps,useExternalLinks,useCodexEntries,useGallery}.ts`.

---

## Verification

- `npx tsc -b --noEmit` → exit 0, no errors
- `grep` audit of `yarn-board/` for hardcoded English UI strings → zero matches
- Backup-strategy table coverage cross-checked against `db.ts` schema (33 tables): 15 legacy + 18 newly registered = 33 ✅
- Per CLAUDE.md: **no auto-commit**. Changes left staged-conceptually for user review.

---

## Lessons Captured

Three patterns worth remembering for the next session, written into `tasks/lessons.md`:

1. **Memory notes age fast** — the YarnBoard "60+ strings" note was wildly outdated. Treat memory as "true at write-time"; verify before acting on file/symbol claims.
2. **Sandbox can't `rm` files** — when cleanup requires deletion, fall back to empty-placeholder + `@deprecated` JSDoc and surface the followup in the report.
3. **`db.table('foo')` throws if `foo` isn't in the schema** — guard with `new Set(db.tables.map(t => t.name)).has('foo')` before constructing the table-array passed to `db.transaction(...)`.
