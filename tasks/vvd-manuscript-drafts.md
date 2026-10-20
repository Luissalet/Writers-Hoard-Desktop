# VVD parity: parallel manuscript drafts and split editing

- [x] Inspect existing CAS writes, immutable snapshots, recovery journal, close guard, Tiptap document identity and WritingsView integration points.
- [x] Add explicit editable draft records within writingSnapshots, excluded from immutable history/deduplication.
- [x] Add independent pane sessions with recovery, flush-on-swap, conflict choices and safe paragraph merge.
- [x] Add a separate two-pane workspace with chapter/draft selection, names, explicit promotion and deep links; preserve canonical first-open behavior.
- [x] Verify actual editing, independent undo/selection, unsaved swaps, failure recovery, same-document conflicts and promotion snapshot/title/date preservation.

Storage stays in existing tables. Draft rows carry kind:'parallel-draft'; canonical manuscripts, export/compile and historical restore points retain their existing meaning. Promotion writes content/wordCount only, under a version check with an atomic safety snapshot.

Verification: nine focused browser groups pass, including actual two-pane conflicting edits and merge, actual persistence failure/block/reopen/retry, snapshot failure rollback and ZIP restore. Existing chapter/world-date UI five groups pass; focused source ESLint clean; renderer tsc passed before final test additions. Current CSS visual QA at 1280px and 720px has no horizontal overflow. Screenshots: C:\Users\luism\AppData\Local\Temp\wh-parallel-0TPDkg\parallel-desktop.png and parallel-narrow.png.

Critical suite attempted but blocked during bundle by existing publishing EditorialSurface .html?raw loader unsupported by critical runner. Conformance found only another agent's in-progress character-sheets definition. No DB schema changes. Local recovery remains existing best-effort localStorage journal; persisted alternatives live in existing writingSnapshots and full project ZIP.

