# Lessons Learned

## 15. Spawned child processes (yt-dlp/ffmpeg) must be tracked, throttled, and tree-killed
**Date:** 2026-06-24
**Context:** Auto-download on capture (Scrapper) spawned yt-dlp + ffmpeg per captured link with no tracking. A heavy ffmpeg mux spiked CPU, and closing the app mid-download could orphan the processes — they kept running and looked "invisible" in Task Manager's *Processes* tab (only visible under *Details*). The user reported a CPU spike. Aside on diagnosis: the "97% CPU" was a transient peak; in *Details*, **System Idle Process at 79% means the CPU was actually ~21% used** — read the Idle process correctly before concluding something is runaway.
**Rule:** Whenever the main process spawns external binaries: (1) keep a registry (`Map` keyed by a stable id, e.g. snapshotId) of in-flight children, each with its own `AbortController`; (2) **serialize** with a concurrency-1 queue so captures can't fan out into parallel CPU-pinning processes; (3) lower priority via `os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL)`; (4) on cancel/quit kill the **whole tree** — on Windows `taskkill /pid <pid> /T /F`, because `child.kill()` alone leaves ffmpeg (a grandchild) alive; (5) expose a cancel IPC + a Cancel button, and wire `app.on('will-quit', abortAllDownloads)`. A detached `taskkill` still completes even though the parent is exiting.

## 14. Default to browser-native downloads, not File System Access API
**Date:** 2026-05-28
**Context:** Built the Media Downloader page with `showDirectoryPicker()` + persistent `FileSystemDirectoryHandle` because the user said "use File System Access API". On first run the page was unusable: the embedded/native browser tier flagged the API as unsupported and showed a big "your browser doesn't support folder downloads" banner. The user pushed back: "should be like anything you download on the web — click download and a Windows pop-up opens for choosing folder".
**Rule:** For one-off file downloads triggered from a button click, default to the browser-native flow: `fetch` → `await res.blob()` → `<a download>` click → revoke the object URL on the next tick. The OS save-as dialog only appears if the user has "Ask where to save each file before downloading" enabled in their browser — that's the right place for the preference to live; we don't replicate it. Reserve File System Access API for genuine repeated-saves-into-the-same-folder workflows (e.g. a continuous logger), and even then degrade gracefully when the API is missing.
**Implementation note:** The `<a download>` href can be either an object URL (from a fetched blob) or a direct GET endpoint. Object URLs let us POST + handle errors but buffer the file in memory. For typical yt-dlp output (audio ≤ ~10 MB, video tens to a few hundred MB) memory is fine. If we ever need true streaming, switch to a GET endpoint with the URL in query params and let the browser stream directly.

## 12. Never use `window.confirm()` for destructive actions
**Date:** 2026-05-26
**Context:** A user left a Timeline tab open, closed the laptop, walked away. On resume, the deletion-confirmation popup flashed for a fraction of a second and the timeline was deleted instantly. Root cause: `CollectionDashboard.tsx` gated deletion with native `window.confirm()`. When a tab is suspended (laptop closed, OS sleep, Page Lifecycle `frozen`) while a native dialog is up or a click is buffered for one, the browser/OS may auto-dismiss it on resume — and on some browser/OS combinations the dismissed dialog resolves as `true`. Native dialogs are also opaque to React state.
**Rule:** Never use `window.confirm()`, `window.alert()`, or `window.prompt()` for destructive or irreversible actions. Always use the React-owned `ConfirmDialog` (`@/engines/_shared` → `ConfirmDialog`): it requires an explicit click on the confirm button, default-focuses Cancel (so an accidental Enter cancels), maps Escape/backdrop/X to Cancel, and has a `destructive` variant for the danger styling. Senior-engineer rule of thumb: a destructive action should require an explicit, React-owned, focus-managed click that cannot be triggered by the OS or browser life-cycle.
**Status:** Fully migrated. All 23 previously-flagged native `confirm()` call sites across 17 files have been replaced with `ConfirmDialog`. Four hardcoded-English confirm strings were promoted to locale keys in the same pass (`biography.fact.deleteConfirm`, `brainstorm.deleteItemConfirm`, `diary.deleteConfirm`, `videoPlanner.deleteConfirm`). An ESLint `no-restricted-globals` rule in `eslint.config.js` now blocks native `confirm` / `alert` / `prompt` so this can't regress.

## 13. The Linux sandbox `bash` mount can go stale mid-session
**Date:** 2026-05-26
**Context:** While doing a large multi-file migration via a subagent, the Linux `bindfs` mount at `/sessions/.../mnt/Writers hoard/` stopped reflecting writes from the file tools. `bash`/`tsc`/`wc -l` saw a snapshot frozen at an old modify time (2026-04-18 in this case) while the Read/Write/Edit tools continued to see the actual Windows files. This produced a flood of phantom "JSX element has no corresponding closing tag" tsc errors against files that were actually well-formed on disk.
**Rule:** If `tsc` errors look like JSX-truncation across many unrelated files, do NOT panic-revert. First confirm the bash view matches the Read-tool view by `stat`-ing one of the files and comparing the modify time against the file's actual most recent edit. If bash sees an older modify time than expected, the mount is stale and tsc is reading lies. In that case, do not trust sandbox-side typecheck for that session; verify file contents via the Read tool and ask the user to typecheck from Windows. Reverting to "fix" tsc errors against a stale mount would destroy correctly-migrated code.

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

## 7. When registering a new engine, add the EngineManager name/description keys
**Date:** 2026-04-18
**Context:** Phase 2 added three engines with locale blocks under `characterArc.*` / `relationships.*` / `seeds.*`. The engine-manager UI showed raw keys (`engines.character-arc.name`) because it resolves labels via the template literal `t(\`engines.${engine.id}.name\`)` — not via any alias table. User caught the regression from a screenshot.
**Rule:** Whenever a new engine is added to `ENGINE_REGISTRY`, add both `engines.<engine-id>.name` and `engines.<engine-id>.description` to every locale. The engine's `id` is the literal suffix — no renaming, no dotted-name translation. Missing keys fall through to the UI as literal strings; there is no fallback logic.

## 8. Don't localize through shared components with English string templates
**Date:** 2026-04-18
**Context:** `CollectionDashboard` received a translated `itemNoun` prop but interpolated it into English templates (`New ${itemNoun}`, `Delete ${itemNoun} "${item.title}"?`, `No ${itemNoun.toLowerCase()}s yet...`). In Spanish UI this produced Spanglish ("New Mapa"). Refactored to pull full translated phrases from `shared.dashboard.*` keys with `{item}`/`{name}` templates filled via `.replace()`.
**Rule:** Shared/generic components must not concatenate an English template around a translated fragment. Use full-phrase translation keys with placeholder tokens (`{item}`, `{name}`) that every locale fills in its own grammar, and call `.replace()` at the call site. This also makes grammatical-agreement differences (pluralization, gender) localizable.

## 9. Tableless engines are valid — don't invent storage for derived views
**Date:** 2026-04-19
**Context:** POV Audit needed a per-character usage view (sceneCount, lineCount, wordCount, isUnused, isUnmapped). All inputs already lived in `codexEntries`, `scenes`, `sceneCasts`, `dialogBlocks`. The temptation was to mirror these into a new `characterUsage` table; the elegance principle said no.
**Rule:** When an engine is purely a derived/analytical view, declare `tables: {}` in its `EngineDefinition` and compute on read. The engine system already supports this (no schema bump, no DB version), and `assertBackupCoverage` trivially passes (zero declared tables → zero coverage gaps). Apply this to: Tension Heatmap, Word-Count by Chapter, Character Co-occurrence Matrix, and any future analytical lens.

## 10. Project-scoped read-only fetches deserve a factory
**Date:** 2026-04-19
**Context:** `useAllPayoffs` in seeds was a 30-line hand-rolled `useEffect` + `useState<Payoff[]>` + `setLoading` + `refresh` triad. POV Audit wanted the exact same shape over a different fetch. Two near-identical hooks invited a third, fourth, fifth — each a chance to re-introduce a loading-state race condition.
**Rule:** Use `makeReadOnlyHook<T>({ fetchFn })` from `src/engines/_shared/` for any project-scoped (or other scope-scoped) derived/aggregate fetch where you don't need CRUD. Pass an optional fetch function that takes a single `scopeId`. Empty scopeId → empty items, no fetch. Fetch re-fires on scopeId change. Future improvement: optional `deps: unknown[]` for filter-dependent re-fetches.

## 11. Spanish-only locales are a gap, not a deliberate choice
**Date:** 2026-04-19
**Context:** `WritingsView.tsx` had a `STATUS_CONFIG` with both `label` (English) and `labelEs` (Spanish) properties — but every render path read `labelEs`. The English half was dead code. Worse, the Spanish locale file (`es.ts`) had ZERO `writings.*` keys despite the engine being live for months — every `t('writings.*')` call I added would have rendered raw keys in Spanish until I backfilled all 32 entries.
**Rule:** When wiring `t()` into a previously-hardcoded component, immediately diff `Object.keys(en) ⊖ Object.keys(es)` for the affected namespace and backfill missing translations in the same edit. Long-term: build a CI/dev-only script that diffs locale key sets globally and warns on drift. Never trust that "the type field has both" implies "both render paths exist."
