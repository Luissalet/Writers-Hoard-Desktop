# Daily Optimization — 2026-04-23

## Theme
**Template-first mounting of the annotation layer** — completing the top-ranked unrealized-value item from 2026-04-21 while extracting a reusable wrapper so every future engine integrates with one line of JSX.

## Context
Yesterday's candidate-follow-ups ranked #1: *"Mount `MarginPanel` in `WritingsEngine` and `CodexEngine` detail views."* Audit today:
- WritingsView already mounts MarginPanel + BacklinksSection (~13 lines of wiring).
- CodexEntryList (the detail modal) does NOT — users see zero backlinks when browsing a character/location.
- Seeds, Maps, and Yarn-Board all have `registerAnchorAdapter` but no Margin surface — every future integration re-duplicates the same two components + layout.

## Plan
- [x] Investigate current Margin/Backlinks usages (writings only).
- [x] Verify anchor adapters exist for codex (yes).
- [ ] **Create `<AnnotationSurface>`** — single-responsibility wrapper rendering MarginPanel + BacklinksSection with two layout modes (`sidebar` for Tiptap gutter, `stack` for modal/full-width). Lives at `src/engines/annotations/components/AnnotationSurface.tsx`.
- [ ] **Mount `<AnnotationSurface layout="stack" />` in CodexEntryList** detail modal, above the Edit/Delete footer.
- [ ] **Refactor `WritingsView`** to use the same `<AnnotationSurface layout="sidebar" />` — proves the wrapper handles both shapes.
- [ ] Typecheck (`npx tsc -b --noEmit`).
- [ ] Write review in `tasks/daily-optimization-2026-04-23.md`.

## Non-goals
- No annotation engine internals touched.
- Not mounting on Seeds/Maps/Yarn-Board yet (the wrapper makes those trivial follow-ups).
- No text-range selection on codex (its content is `dangerouslySetInnerHTML`, not Tiptap — entity-level anchors only for v1).
- No DB schema or backup strategy changes.

## Verification
- `npx tsc -b --noEmit` clean.
- WritingsView visual behavior unchanged.
- CodexEntryList detail modal gains an annotation section below the image gallery.
- i18n parity unchanged.
