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

## Remaining Opportunities

1. **Central hooks migration**: `src/hooks/useMaps.ts`, `useCodexEntries.ts`, `useExternalLinks.ts`, `useGallery.ts` could be moved into their respective engine folders using `makeEntityHook` for full self-containment.
2. **Large component splits**: ColorPicker (457 lines), InspirationGallery (491 lines), zipBackup (451 lines) could be decomposed.
3. **i18n extraction**: Spanish strings hardcoded in aiService/aiFeatures should move to a localization system.
4. **DB schema deduplication**: Every Dexie version copies all table definitions. Could define base schema once + apply diffs.
5. **makeGraphDataHook**: For Brainstorm/Storyboard/Yarn Board — batched node+edge refresh pattern.

## TypeScript Status
✅ `tsc --noEmit` passes with zero errors.
