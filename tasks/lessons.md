# Lessons Learned

## 1. Always run `npx tsc -b --noEmit` before declaring work complete
**Date:** 2026-04-16
**Context:** Delivered code changes without checking TypeScript compilation. User caught two TS errors.
**Rule:** After any code change in this project, run TypeScript type-checking and fix all errors before telling the user it's done. No exceptions.

## 2. Don't use useAutoSelect on engines with list→detail navigation
**Date:** 2026-04-17
**Context:** Dialog engine used `useAutoSelect` which immediately re-selected a scene after pressing Back, trapping the user in the editor. The scene list view was unreachable.
**Rule:** `useAutoSelect` is for engines where something should always be selected (Codex, Diary). Engines with explicit list→editor flows (Dialog/Scene, Video Planner) must NOT use it — the empty state IS the list view.

## 3. Memory notes age — verify before acting on symbol/file claims
**Date:** 2026-04-18
**Context:** Memory note `feedback_yarnboard_i18n.md` claimed YarnBoard had "60+ hardcoded English strings". Investigation found the main file was already fully translated (40 t() calls, 64 yarn.* keys); only 9 small residual strings in node components and one engine placeholder remained.
**Rule:** A memory that names files, symbols, or counts is true at write-time only. Before recommending or acting, grep the current state. Update or retire stale memories rather than carrying forward obsolete claims.

## 4. Sandbox can't `rm` files — use empty-placeholder + `@deprecated`
**Date:** 2026-04-18
**Context:** Tried to delete orphaned hooks in `src/hooks/` after engine migration; Bash `rm` returned "Operation not permitted".
**Rule:** When a file should be removed but the sandbox blocks deletion, rewrite it as `export {};` plus a `@deprecated` JSDoc pointing to the new location, and call out the pending `git rm` in the daily report so a clean checkout finishes the job.

## 5. `db.table('foo')` throws if 'foo' isn't in the open Dexie schema
**Date:** 2026-04-18
**Context:** While building dynamic table-clear logic in `zipBackup.ts`, calling `db.table(name)` for a name not present in the current schema version raised TypeError, breaking the import path entirely.
**Rule:** Before constructing the table-array passed into `db.transaction(...)`, filter against `new Set(db.tables.map(t => t.name))`. Never trust strategy-supplied table names blindly — older project DBs may not have the newest tables yet.

## 6. Modular backup pattern — additive registry, keep legacy intact
**Date:** 2026-04-18
**Context:** Found `zipBackup.ts` only handled 15 of 33 tables; engines added since the original code (~18 tables) were silently dropped on backup/restore. Could have rewritten the whole file, but that risks breaking restore from existing user ZIPs.
**Rule:** When migrating a fragile cross-cutting subsystem (backup, migrations, telemetry), prefer an **additive registry** that runs alongside the legacy code first. Mark the legacy block as candidate-for-removal in the daily report and migrate piecewise in later sessions, ideally with a manifest version field to dispatch by strategy version.
