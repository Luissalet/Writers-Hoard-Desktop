# Hook Migration to Engine Factories - COMPLETED

## Goal
Migrate 4 central hooks from `src/hooks/` into respective engine folders using `makeEntityHook` + `makeTableOps` factory pattern.

## Completed

### Hook 1: useMaps.ts → engines/maps/hooks.ts ✓
- [x] Read src/hooks/useMaps.ts and understand exports (useWorldMaps, useMapPins)
- [x] Read src/engines/maps/ structure (MapsEngine.tsx, index.ts)
- [x] Create src/engines/maps/hooks.ts with factory pattern
- [x] Create src/engines/maps/operations.ts (for entity resolver)
- [x] Update MapsEngine.tsx import to './hooks'
- [x] Destructuring updated: { items: maps, addItem: addMap, editItem: editMap, removeItem: removeMap }
- [x] Test: TypeScript compiles clean

### Hook 2: useExternalLinks.ts → engines/links/hooks.ts ✓
- [x] Read src/hooks/useExternalLinks.ts
- [x] Read src/engines/links/ structure
- [x] Create src/engines/links/hooks.ts with factory pattern
- [x] Create src/engines/links/operations.ts
- [x] Update LinksEngine.tsx import to './hooks'
- [x] Destructuring updated: { items: links, addItem: addLink, removeItem: removeLink, loading }
- [x] Test: TypeScript compiles clean

### Hook 3: useCodexEntries.ts → engines/codex/hooks.ts ✓
- [x] Read src/hooks/useCodexEntries.ts
- [x] Read src/engines/codex/ structure
- [x] Create src/engines/codex/hooks.ts with factory pattern
- [x] Create src/engines/codex/operations.ts
- [x] Update CodexEngine.tsx import to './hooks'
- [x] Update AiToolbar.tsx import to '@/engines/codex/hooks'
- [x] Destructuring updated in both files
- [x] Test: TypeScript compiles clean

### Hook 4: useGallery.ts → engines/gallery/hooks.ts ✓
- [x] Read src/hooks/useGallery.ts
- [x] Read src/engines/gallery/ structure
- [x] Create src/engines/gallery/hooks.ts with factory pattern (both useImageCollections and useInspirationImages)
- [x] Create src/engines/gallery/operations.ts
- [x] Update GalleryEngine.tsx import to './hooks'
- [x] Update CodexEngine.tsx import to '@/engines/gallery/hooks' for useInspirationImages
- [x] Destructuring updated in both files
- [x] Test: TypeScript compiles clean

### Cleanup & Verification ✓
- [x] Verified src/hooks/ still contains: useProjects.ts, useGlobalSearch.ts, useColorDrag.ts (not migrated)
- [x] Old hooks files remain untouched (useMaps.ts, useExternalLinks.ts, useCodexEntries.ts, useGallery.ts)
- [x] Ran `npx tsc --noEmit` - ZERO ERRORS
- [x] All imports updated and verified
- [x] Verified no remaining imports from old hook locations

## Summary

All 4 hooks have been successfully migrated from `src/hooks/` into their respective engine folders:

1. **useMaps.ts**: Replaced with `src/engines/maps/hooks.ts`
   - Exports: useWorldMaps, useMapPins
   - Consumer: MapsEngine.tsx (updated to './hooks')

2. **useExternalLinks.ts**: Replaced with `src/engines/links/hooks.ts`
   - Exports: useExternalLinks
   - Consumer: LinksEngine.tsx (updated to './hooks')

3. **useCodexEntries.ts**: Replaced with `src/engines/codex/hooks.ts`
   - Exports: useCodexEntries
   - Consumers: CodexEngine.tsx ('./hooks'), AiToolbar.tsx ('@/engines/codex/hooks')

4. **useGallery.ts**: Replaced with `src/engines/gallery/hooks.ts`
   - Exports: useImageCollections, useInspirationImages
   - Consumers: GalleryEngine.tsx ('./hooks'), CodexEngine.tsx ('@/engines/gallery/hooks')

All hooks now use the `makeEntityHook` + `makeTableOps` factory pattern, returning:
- `{ items, loading, addItem, editItem, removeItem, refresh, reorder }`

Consuming code properly destructures and renames to maintain semantic clarity (e.g., `{ items: maps, addItem: addMap }`).

TypeScript: ✓ ZERO ERRORS
