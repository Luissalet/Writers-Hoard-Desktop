# Daily Modularization & Optimization Report — 2026-04-16

## Summary

Major architectural refactoring session focused on reducing duplication, standardizing patterns, and implementing a self-registering plugin architecture for entity resolution. TypeScript compiles clean — zero errors.

## Changes Made

### 1. Self-Registering Entity Resolver (HIGH IMPACT)

**Problem**: `entityResolver.ts` (220 lines) had two massive switch statements mapping 13 engines. Every new engine required modifying this file in 3+ places.

**Solution**: Created `_shared/entityResolverRegistry.ts` — a Map-based registry where engines self-register their own resolve/search capabilities in their `index.ts`. The old `entityResolver.ts` is now a 14-line re-export layer.

**Impact**: Adding a new engine no longer requires touching entityResolver. Each engine owns its resolution logic.

**Files**: New `entityResolverRegistry.ts` (82 lines), updated all 14 engine `index.ts` files, refactored `entityResolver.ts` (220 → 14 lines).

### 2. CollectionDashboard Component (MEDIUM IMPACT)

**Problem**: Maps, Timeline, and Yarn Board all had ~130 lines of nearly identical dashboard UI (grid cards, active highlighting, inline new-item form, delete buttons).

**Solution**: Extracted generic `CollectionDashboard<T>` component into `_shared/components/`. Accepts icon, items, callbacks. Migrated Maps and Timeline to use it.

**Impact**: MapsEngine 192 → 85 lines (56% reduction). TimelineEngine 197 → 84 lines (57% reduction). YarnBoard already used shared components — serves as the exemplar.

### 3. makeCascadeDeleteOp Factory (MEDIUM IMPACT)

**Problem**: 7 engines wrote their own cascade delete functions with 3 different syntax styles (db.table(), tx.table(), db.tableName). Inconsistent and error-prone.

**Solution**: Created `makeCascadeDeleteOp()` factory that generates a transactional cascade delete from a declarative config: `{ tableName, cascades: [{ table, foreignKey }] }`.

**Migrated**: biography, storyboard, timeline, dialog-scene, video-planner, brainstorm, yarn-board. Left manual: deletePanel (dual FK), deleteBrainstormItem (dual FK).

### 4. Shared Hook Migration for Maps/Timeline

**Problem**: Maps and Timeline had inline `useEffect` blocks duplicating the `useAutoSelect` and `useEnsureDefault` patterns already available in `_shared/`.

**Solution**: Both now use the shared hooks. Identical to how Yarn Board already works.

## Metrics

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| entityResolver.ts | 220 lines | 14 lines | -93% |
| MapsEngine.tsx | 192 lines | 85 lines | -56% |
| TimelineEngine.tsx | 197 lines | 84 lines | -57% |
| Shared utilities | 8 files, 340 LOC | 11 files, 616 LOC | +3 files, +276 LOC |
| Cascade delete styles | 3 patterns | 1 pattern | standardized |
| Engine registration steps | 3+ files to touch | 1 file (index.ts) | simplified |

Net LOC change: approximately -250 lines of duplication removed, +276 lines of reusable shared code. The shared code serves 15 engines rather than being duplicated per-engine.

---

## Commit 2: Hook Migration, Component Splits, i18n, Graph Hook

### 5. Central Hook Migration (HIGH IMPACT)

**Problem**: 4 hooks in `src/hooks/` (useMaps, useCodexEntries, useExternalLinks, useGallery) were hand-written CRUD implementations that duplicated the `makeEntityHook` factory pattern.

**Solution**: Created `hooks.ts` + `operations.ts` in each engine folder (codex, gallery, links, maps) using `makeEntityHook` + `makeTableOps` factories. Updated all consumers to import from engine folders.

**Impact**: 8 new files. All 15 engines now fully own their data layer. `src/hooks/` only contains project-level hooks (useProjects, useGlobalSearch, useColorDrag).

### 6. makeGraphHook Factory (MEDIUM IMPACT)

**Problem**: Brainstorm and Yarn Board both implemented ~80-100 lines of custom "batched node+edge refresh" logic to prevent double re-renders on canvas.

**Solution**: Created `makeGraphHook<N, E>()` factory in `_shared/`. Both engines now use it with domain-specific name mapping (~25 lines each instead of ~100).

### 7. ColorPicker Decomposition (MEDIUM IMPACT)

**Problem**: 457-line component with two nearly identical variants (dropdown + inline) sharing 80% logic but duplicated.

**Solution**: Extracted into focused sub-components:
- `colorMath.ts` (pure HSV↔Hex functions)
- `useColorDrag.ts` (canvas/slider drag hook)
- `SaturationCanvas.tsx`, `HueSlider.tsx`, `PresetGrid.tsx`, `HexInput.tsx`
- Main file reduced from 457 → ~302 lines (34% reduction)

### 8. Page Component Extraction (MEDIUM IMPACT)

**Problem**: Dashboard.tsx (451L) and ProjectDetail.tsx (348L) each contained large embedded modals.

**Solution**: Extracted `CreateProjectModal` (300L) from Dashboard and `EngineManager` (207L) from ProjectDetail. Dashboard: 451→194 lines (-57%). ProjectDetail: 348→146 lines (-58%).

### 9. i18n Foundation (LOW-MEDIUM IMPACT)

**Problem**: 24 Spanish strings hardcoded across 6 files (aiService, aiFeatures, AiToolbar, GoogleDocsPicker, AiSettings, Dashboard).

**Solution**: Created `src/locales/es.ts` with typed translation keys and `src/i18n/useTranslation.ts` with `t()` function. Replaced all hardcoded strings with `t('key')` calls.

## Combined Metrics

| Metric | Before | After |
|--------|--------|-------|
| entityResolver.ts | 220 lines | 14 lines |
| MapsEngine.tsx | 192 lines | 85 lines |
| TimelineEngine.tsx | 197 lines | 84 lines |
| ColorPicker.tsx | 457 lines | ~302 lines |
| Dashboard.tsx | 451 lines | 194 lines |
| ProjectDetail.tsx | 348 lines | 146 lines |
| Shared utilities | 8 files, 340 LOC | 12 files, ~800 LOC |
| Engines self-contained | 8 of 15 | 15 of 15 |
| Cascade delete styles | 3 patterns | 1 pattern |
| i18n coverage | 0 keys | 24 keys |

---

## Commit 3: New Engines — Outline + Writing Stats (HIGH IMPACT)

### 10. Outline Engine (HIGH IMPACT)

**Gap identified**: Competitors like Plottr, Scrivener, and Campfire Blaze all offer structured plot planning with beat sheet templates. Writers Hoard had no equivalent.

**Solution**: Built complete Outline engine (~1,196 lines across 8 files):
- **types.ts**: Outline + OutlineBeat interfaces, 4 built-in beat sheet templates (Save the Cat!, Three-Act, Hero's Journey, Five-Act)
- **operations.ts**: CRUD via makeTableOps + makeCascadeDeleteOp
- **hooks.ts**: useOutlines, useOutlineBeats using makeEntityHook factory
- **components/**: OutlineEngine.tsx (main), BeatList.tsx (drag-reorder), BeatEditor.tsx (rich editing), TemplateSelector.tsx (template browser)
- **index.ts**: Self-registered with id 'outline', icon ListTree, category 'planning'
- DB v12: outlines + outlineBeats tables

### 11. Writing Stats Engine (HIGH IMPACT)

**Gap identified**: Tools like Novelium and One Stop For Writers offer sprint timers, word count tracking, and goal setting. Every serious writing app has this.

**Solution**: Built complete Writing Stats engine (~1,042 lines across 9 files):
- **types.ts**: WritingSession + WritingGoal interfaces
- **operations.ts**: CRUD + custom getSessionsByDateRange, getTodaySessions
- **hooks.ts**: useWritingSessions, useWritingGoals, useWritingStats (computed analytics)
- **components/**: WritingStatsEngine.tsx (main), SprintTimer.tsx (configurable timer), ProgressChart.tsx (visual tracking), GoalSetter.tsx (daily/weekly/monthly goals), SessionCard.tsx (session history)
- **index.ts**: Self-registered with id 'writing-stats', icon BarChart3, category 'core'
- DB v13: writingSessions + writingGoals tables

### Project Mode Integration

Both engines wired into relevant project modes:
- **Novelist**: outline (default), writing-stats (suggested)
- **Playwright**: outline (default), writing-stats (suggested)
- **Biographer**: outline + writing-stats (suggested)
- **Reporter**: writing-stats (suggested)
- **Content Creator**: outline + writing-stats (suggested)

## Final Combined Metrics

| Metric | Before | After |
|--------|--------|-------|
| Total engines | 15 | 17 |
| entityResolver.ts | 220 lines | 14 lines |
| MapsEngine.tsx | 192 lines | 85 lines |
| TimelineEngine.tsx | 197 lines | 84 lines |
| ColorPicker.tsx | 457 lines | ~302 lines |
| Dashboard.tsx | 451 lines | 194 lines |
| ProjectDetail.tsx | 348 lines | 146 lines |
| Shared utilities | 8 files, 340 LOC | 12 files, ~800 LOC |
| Engines self-contained | 8 of 15 | 17 of 17 |
| Cascade delete styles | 3 patterns | 1 pattern |
| i18n coverage | 0 keys | 24 keys |
| DB tables | 27 (v11) | 31 (v13) |
| New engine LOC | — | ~2,238 lines |

## Remaining Opportunities

1. **Split zipBackup.ts** (451L) into entity-specific export/import strategy modules
2. **Split InspirationGallery.tsx** (491L) into ImageGrid, CollectionManager, LinkedEntrySelector
3. **DB schema deduplication**: Define base schema once + apply diffs per version
4. **Extend CollectionDashboard** to more engines (Storyboard, Biography)
5. **Add more translation keys** as UI grows
6. **Delete old central hook files** in `src/hooks/` once all consumers confirmed migrated
7. **Future engines**: Character Arc Tracker, Relationship Maps (character graph), Magic/World Systems Builder, AI-powered Consistency Checker

## TypeScript Status
✅ `tsc --noEmit` passes with zero errors (all 3 commits).
