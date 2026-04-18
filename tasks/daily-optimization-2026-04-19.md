# Daily Optimization — 2026-04-19

> Self-replicating mutation experiment. Investigate, modularize, build, test until satisfied.

## Context Going In

Carrying forward from 2026-04-18:
- DB v16, 38 tables, 20 engines, all with per-engine `BackupStrategy` registered
- 8 lessons captured
- Remaining follow-ups: `makeChildEntityHook` factory, deep-form i18n gaps in writing-stats / scrapper / writings, Spanish-only strings in AiToolbar/GoogleDocsPicker, plus the `seeds.getAllPayoffsForProject` bespoke hook screaming for a factory

## Phase 1 — Generalize the Read-Only Hook Pattern

The `useAllPayoffs` hook in seeds was a one-off fetch-all-payoffs-for-project pattern. Several places want exactly this shape (project-wide derived collection + loading + refresh) but were either repeating the boilerplate or pulling a richer entity hook they didn't need.

**Built `makeReadOnlyHook<T>` factory.**

Location: `src/engines/_shared/makeReadOnlyHook.ts`

```typescript
export interface ReadOnlyHookOptions<T> {
  fetchFn: (scopeId: string) => Promise<T[]>;
}
export interface ReadOnlyHookResult<T> {
  items: T[];
  loading: boolean;
  refresh: () => Promise<void>;
}
export function makeReadOnlyHook<T>(options: ReadOnlyHookOptions<T>):
  (scopeId: string | undefined) => ReadOnlyHookResult<T>
```

Naming chose `ReadOnly` over `ChildEntity` because the shape applies to anything derived/aggregate, not just child entities. Single argument is `scopeId` (project, parent, whatever the consumer passes). Empty scopeId returns empty items, no fetch fired.

Re-exported from `src/engines/_shared/index.ts`.

**Applied to seeds.** Replaced the 30-line custom hook with a 4-line factory call:
```typescript
export const useAllPayoffs = makeReadOnlyHook<Payoff>({
  fetchFn: ops.getAllPayoffsForProject,
});
```

Net diff: shorter, fewer chances for the loading-state race conditions to be re-implemented incorrectly across engines.

## Phase 2 — POV Audit Engine (Zero-Storage Derived View)

A POV/character usage audit was the most-requested missing analytical view. Two key design constraints:

1. **No new tables.** All data already lives in `codexEntries` (type='character'), `scenes`, `sceneCasts`, `dialogBlocks`. Building yet another mirror table would violate the elegance principle.
2. **Engine system support needed.** The engine factory pattern assumed every engine owned tables. The 2026-04-18 `assertBackupCoverage` guardrail would now trip on a tableless engine.

**Resolution:** a tableless engine (`tables: {}`) trivially satisfies the coverage check (the engine declares zero tables, so the registry sees zero gaps). The `EngineDefinition` type already permitted this — no schema bump needed.

### Engine Structure

```
src/engines/pov-audit/
├── components/PovAuditEngine.tsx     # KPI strip + filter chips + ranked bar chart
├── hooks.ts                           # useUsageReport via makeReadOnlyHook
├── operations.ts                      # computeUsage(projectId)
├── types.ts                           # CharacterUsage, ProjectAuditTotals, PovAuditReport
└── index.ts                           # registerEngine({ tables: {}, ... })
```

### What `computeUsage` Does

Walks four tables in parallel, then joins:
- `codexEntries` filtered to `type === 'character'` → universe of "intended" characters
- `scenes` for the project → scope of all scenes
- `sceneCasts` joined to scenes → characters present
- `dialogBlocks` filtered to `type === 'dialog'` (excludes action / transition blocks) → spoken lines

For each character it computes: `sceneCount`, `lineCount`, `wordCount`, `isUnused` (in codex but absent from all scenes/dialog), `isUnmapped` (speaks/appears but no codex entry; `characterId` synthesized as `__unmapped__:<name>`).

Totals roll up `charactersInCodex`, `charactersUsed`, `unusedCount`, `unmappedCount`, `sceneCount`, `blockCount`, `totalWords`.

### UI

Three regions:
1. **KPI strip** (4 cards) — totals; Unused / Unmapped cards turn amber when > 0
2. **Filter chips** — all / used / unused / unmapped
3. **Ranked list** — character row with avatar (or initial), badges for unused/unmapped state, proportional bar (lineCount / maxLines), and inline scenes/lines/words stats

Wired into `_registry.ts` as a suggested engine for both `novelist` and `playwright` modes.

### Why Not Make It a Sub-View of Codex?

The audit cuts across codex + dialog-scene + scenes. Making it a tab in the codex would either (a) leak unrelated logic into codex, or (b) create a fake "summary" view that shrugs off the cross-cutting concerns. A standalone derived engine is the elegant home, and it lets us add more derived engines (Word-Count Heatmap, Scene Density, Tension Curve...) without re-litigating where they go.

### Type Note

Initial draft used `JSX.Element` and `React.ReactNode` which fail under `verbatimModuleSyntax`. Fixed by importing `import type { ReactElement, ReactNode } from 'react';` and using those directly.

## Phase 3 — i18n Catch-Up

Closed the four remaining hardcoded-string clusters identified by 2026-04-18:

### `scrapper/components/CaptureBar.tsx`
- Wired `useTranslation()`
- Replaced URL placeholder, capture button label, "Detected:" prefix, "Manual Entry"
- Source labels (`tweet/instagram/youtube`) intentionally left as raw strings — they're proper nouns / platform names

### `scrapper/components/ManualSnapshotModal.tsx`
- Wired `useTranslation()`
- Replaced: alert message, "Add Research Note" header, Title/Notes labels & placeholders, "Attachment (Optional)" label, upload hint, Remove/Cancel/Save buttons, Tags label
- Added 13 new `scrapper.*` keys (en + es)

### `scrapper/components/SnapshotDetail.tsx`
- Wired `useTranslation()`
- Replaced: delete confirm, Author/Date/Captured/Status metadata labels, "Extracted Text" heading, Notes label/placeholder, Tags label, Delete/Done buttons

### `writing-stats/components/GoalSetter.tsx`
- Wired `useTranslation()`
- Replaced: title, all three target labels, all three example placeholders, all three hint paragraphs, Cancel button, Save Goals button
- Added 11 new `writingStats.goals.*` keys (en + es). Kept new namespace `writingStats.goals.*` instead of polluting the existing `stats.*` namespace where `stats.goals` already meant just "Goals" (the noun).

### `writings/components/WritingsView.tsx`
**Big cleanup.** This file had a stale `STATUS_CONFIG` carrying both `label` (English) and `labelEs` (Spanish) properties — only `labelEs` was ever rendered, so the component was Spanish-only despite the parallel English in the type.

- **Stripped `label` and `labelEs` from STATUS_CONFIG entirely** (down to just icon, color, bg)
- Added `statusLabel = (s) => t('writings.status.${s}')` helper
- Replaced 5 `cfg.labelEs` / `stCfg.labelEs` / `config.labelEs` uses with `statusLabel(...)`
- Replaced English-only strings: "Back" → `t('common.back')`, "Save" → `t('writings.save')`, "Untitled writing..." → `t('writings.untitled')`, "Start writing..." → `t('writings.startWriting')`, "Google Docs" → `t('writings.googleDocs')`, "New Writing" → `t('writings.newWriting')`, "words"/"Chapter"/"Updated" → keys, "e.g. 1" → `t('writings.chapterExample')`, "Brief summary..." → `t('writings.synopsisPlaceholder')`, "Create"/"Cancel" → common keys
- Replaced Spanish-only strings: "Mover o copiar"/"Mover a"/"Copiar a" → already-existing English keys via t()
- Replaced the EmptyState `title=`No ${labelEs.toLowerCase()}`` template with explicit branching to `writings.noIdeas/noDrafts/noFinished` (proper nouns translate, not concatenated strings — lesson #7 from 2026-04-18 still holding)
- Added 3 new keys (`googleDocs`, `updated`, `chapterExample`)
- **Mirrored all 32 `writings.*` keys into es.ts** — Spanish locale had ZERO `writings.*` entries, an old gap the now-required `t()` calls would have hit. Everything from `writings.status.idea` through `writings.aiHint` plus the 3 new ones is now translated.

### `writings/components/GoogleDocsPicker.tsx`
- Already had `import { t } from '@/i18n/useTranslation'` for two error messages, but every UI string was Spanish-only
- Wired all hardcoded Spanish strings to keys: connect screen heading & hint, "Conectando..." spinner, "Conectar Google Drive" button, "Conectado como" prefix, "Buscar documentos..." placeholder, "Buscar" button, "No se encontraron documentos" empty, "Ya vinculado"/"Modificado" status pieces, "{count} documento(s) seleccionado(s)" pluralized counter, "Vinculando..." progress, "Vincular" submit button
- Added 15 new `gdocs.*` keys (en + es). Used `{count}` interpolation for the pluralized counter (matching the pattern shared collection dashboard already uses with `{item}`/`{name}`).

### Out of Scope This Session
- `writings/components/AiToolbar.tsx` — has explicit `// TODO: i18n` markers and Spanish-only strings interleaved with complex character-import logic. Touching it is non-trivial (modal titles, generated summaries, character preview rows). Deferred.

## Verification

`npx tsc -b --noEmit` — clean exit, zero diagnostics.

Spot-checks:
- `Grep labelEs src/engines/writings/` → no remaining usages
- `Grep "writings\." src/locales/es.ts` → 33 entries (the 32 mirrored + the existing `engines.writings.*`)
- `Grep "scrapper\." src/locales/{en,es}.ts` → 22 entries each, symmetrical

## Architecture Notes

### `makeReadOnlyHook` vs the Existing Entity Hooks

Existing factories own a Dexie table and emit a list/CRUD surface. `makeReadOnlyHook` owns nothing — it's just a `useEffect` wrapper around an arbitrary fetch. Use it when:

- The data is computed from multiple tables (POV Audit) or aggregated (Payoffs across all seeds in a project)
- You don't need create / update / delete (those should bind to the underlying entity hook anyway)
- You want consistent loading-state / refresh handling across engines

### The Tableless-Engine Pattern

POV Audit demonstrates that engines don't need to own data. This unlocks:
- Cross-cutting analytical views (POV Audit, Tension Heatmap, Pacing Tracker)
- Computed dashboards (Word-Count by Chapter, Character Co-occurrence)
- Read-only "lenses" over existing tables

The `assertBackupCoverage` guardrail handles the empty-tables case correctly: zero tables declared → zero coverage gaps → engine passes. No special-casing needed.

## Engine Catalog Update

**Was:** 20 engines, 38 tables.
**Now:** 21 engines (+pov-audit), 38 tables (no schema change).

POV Audit is the first **tableless** engine — pure derived view. Sets a template for future analytical engines.

## Lessons (Update lessons.md)

No new mistakes this session. A couple patterns worth codifying:

- **Tableless engines are valid** — the engine system trivially supports `tables: {}` for derived views, and the backup guardrail handles it. Don't invent new tables for analytical views; compute from existing data.
- **Read-only hooks deserve a factory** — anywhere you'd reach for a custom `useEffect + useState + refresh` triad over a project-scoped fetch, use `makeReadOnlyHook<T>` instead.
- **Spanish-only locales are tech debt** — WritingsView had an English type field (`label`) that was never read because every render path used `labelEs`. The Spanish locale literally had zero `writings.*` keys for a year. Cross-locale parity should be enforced (TODO future: a script that diffs key sets between en.ts/es.ts and CI-fails on drift).

## Follow-Ups for Next Session

- AiToolbar.tsx i18n cleanup (Spanish-only modal titles, generated character preview labels, "TODO: i18n" markers on lines 271/282)
- Build a CI / dev-only script that diffs `Object.keys(en) ⊖ Object.keys(es)` and warns on drift
- Tableless engine candidates worth scaffolding next:
  - **Tension Heatmap** — read scenes + dialogBlocks + characterArcs/beats, render a per-chapter tension intensity strip
  - **Word-Count by Chapter** — derived from writings (already tracked), no new storage
  - **Character Co-occurrence Matrix** — sceneCasts × sceneCasts pairwise counts
- Generalize `makeReadOnlyHook` to take an optional `deps: unknown[]` so consumers can re-fetch on dimension changes (e.g., POV Audit could depend on a "POV mode" filter)

## Files Touched

Created:
- `src/engines/_shared/makeReadOnlyHook.ts`
- `src/engines/pov-audit/types.ts`
- `src/engines/pov-audit/operations.ts`
- `src/engines/pov-audit/hooks.ts`
- `src/engines/pov-audit/components/PovAuditEngine.tsx`
- `src/engines/pov-audit/index.ts`
- `tasks/daily-optimization-2026-04-19.md` (this file)

Modified:
- `src/engines/_shared/index.ts` (re-export factory)
- `src/engines/seeds/hooks.ts` (refactor to factory)
- `src/engines/index.ts` (import pov-audit)
- `src/engines/_registry.ts` (suggest pov-audit for novelist + playwright)
- `src/engines/scrapper/components/CaptureBar.tsx`
- `src/engines/scrapper/components/ManualSnapshotModal.tsx`
- `src/engines/scrapper/components/SnapshotDetail.tsx`
- `src/engines/writing-stats/components/GoalSetter.tsx`
- `src/engines/writings/components/WritingsView.tsx`
- `src/engines/writings/components/GoogleDocsPicker.tsx`
- `src/locales/en.ts` (added pov-audit + scrapper + writingStats.goals + writings.* + gdocs.* keys)
- `src/locales/es.ts` (mirrored all of the above; backfilled all 32 `writings.*` keys that were missing)
