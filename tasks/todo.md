# Video Planner — rename plans + export teleprompter video (MP4) & script (PDF)

**Date:** 2026-06-24 · Target: **Writers hoard desktop** (Electron, now the primary repo)

## Context
- `video-planner` engine. `VideoPlan` has `title`; `updateVideoPlan` op + hook `editItem` exist, but there is **no rename UI** (list shows title + date + delete only).
- `TeleprompterView` scrolls script text on black. The current "Export" button only dumps the plan as **JSON**, and `VideoPlanView` strings are hardcoded English (not `t()`).
- Electron main already bundles `ffmpeg-static` (used by yt-dlp). IPC = `ipcMain.handle` + `window.electronAPI` (preload). `isDesktop()` (`src/utils/platform.ts`) gates desktop-only features.

## Plan (checkable)
- [ ] 1. i18n: add `videoPlanner.*` keys (rename, export menu, recorder progress/cancel) to `locales/en.ts` + `locales/es.ts`; switch hardcoded `VideoPlanView` strings to `t()` (lesson #11: backfill BOTH locales).
- [ ] 2. Rename plans: inline pencil-edit in plan list rows (`VideoPlannerEngine`) + click-to-edit header title (`VideoPlanView`) → `editItem(id, { title, updatedAt })`. Inline input, no native prompt (lesson #12).
- [ ] 3. Electron IPC:
  - `media:transcodeWebmToMp4(bytes, suggestedName)` → temp webm → bundled ffmpeg `-c:v libx264 -pix_fmt yuv420p -movflags +faststart` → `showSaveDialog` → write .mp4.
  - `export:scriptToPdf(html, suggestedName)` → offscreen `BrowserWindow` → `printToPDF` → save dialog.
  - Expose via `preload.ts`; extend `electron-env.d.ts`.
- [ ] 4. Teleprompter MP4 recorder (renderer util): canvas (1080p, black) lays out segments, scrolls at `50*speed` px/s, `captureStream`+`MediaRecorder` (webm) → MP4 via IPC. Progress + cancel modal. Web fallback = download `.webm` (lesson #14).
- [ ] 5. Wire export menu in `VideoPlanView`: dropdown → Plan (JSON, existing), Script (PDF), Teleprompter video (MP4).
- [ ] 6. Verify: `tsc -b --noEmit` (renderer) + `typecheck:electron` + `lint`. Watch for stale-mount phantom errors (lesson #13). **No commit** (no-autocommit) — leave for review.

## Defaults chosen (say the word to change)
- Video: **1080p**, H.264 MP4, 30fps, real-time capture (a teleprompter is watched in real time); progress bar + cancel.
- Script PDF: styled doc — plan title, then per segment: title / speaker / time / script / visual & audio notes.
- Web build (no Electron): MP4 → `.webm` download; PDF → print dialog.

## Review (2026-06-24)

### Files added (5)
1. `electron/media/transcode.ts` — `transcodeWebmToMp4(Buffer)` via bundled ffmpeg-static (H.264 / yuv420p / +faststart, `-an`). Bundled into main.cjs automatically (esbuild follows imports).
2. `src/engines/video-planner/teleprompterRecorder.ts` — canvas teleprompter renderer + `MediaRecorder` capture → WebM. AbortSignal cancel, progress callback, resolution-scaled scroll speed.
3. `src/engines/video-planner/scriptExport.ts` — builds print-styled HTML + `exportScriptPdf()` (desktop → IPC printToPDF; web → print-dialog fallback).
4. `src/engines/video-planner/components/PlanExportMenu.tsx` — Export dropdown: Plan (JSON) / Script (PDF) / Teleprompter video (MP4).
5. `src/engines/video-planner/components/TeleprompterExportModal.tsx` — options (resolution + speed) → progress + cancel → save MP4 (web: WebM fallback).

### Files modified (7)
1. `electron/main.ts` — IPC `media:saveTeleprompterMp4` (transcode + save dialog) and `export:scriptToPdf` (hidden-window printToPDF + save dialog); `saveBytesViaDialog`/`htmlToPdf` helpers.
2. `electron/preload.ts` — exposed `media.saveTeleprompterMp4` + `exporter.scriptToPdf` (+ `SaveResult`).
3. `src/electron-env.d.ts` — renderer typings for the two new bridges + `SaveResult`.
4. `src/engines/video-planner/components/VideoPlannerEngine.tsx` — inline rename in the plan list (pencil → input, Enter/Esc), `editItem` wired; list row is now a div with `role="button"`/keyboard support so nested action buttons are valid HTML.
5. `src/engines/video-planner/components/VideoPlanView.tsx` — click-to-edit header title; `<PlanExportMenu>` replaces the old JSON-only Export button; hardcoded English → `t()`.
6. `src/locales/en.ts` + `src/locales/es.ts` — full `videoPlanner.*` key block for rename/export/recorder (both locales, lesson #11).

### Verification
- ✅ Cross-file correctness reviewed via the Read tool (real files) + a subagent that checked every external API against `node_modules`: lucide icons all exported, Electron 33 `printToPDF(): Promise<Buffer>`, ffmpeg-static/file-saver/`t()` imports correct, recorder Promise settles once on every path, JSX balanced, no dangling/unused imports, preload↔typings consistent. **No issues found.**
- ⚠️ **Sandbox `tsc`/`lint` NOT run** — the Linux bash mount went stale mid-session (lesson #13): it served truncated Jun-19 snapshots of edited files (e.g. `App.tsx` seen as 23 lines) while new files read fresh, guaranteeing phantom JSX/“unterminated string” errors against untouched files. Did NOT act on those.
- ▶️ **User action:** run from a Windows terminal: `npx tsc -b --noEmit`, `npm run typecheck:electron`, `npm run lint`. Then `npm run dev:desktop` to try Export ▾ → Teleprompter video (MP4) and plan rename.
- 🚫 Not committed (no-autocommit) — left for review.

### Out of scope / notes
- `TeleprompterView.tsx` still has a few pre-existing hardcoded English strings (“Speed:”, “Click to play/pause • ESC to exit”, “Segment X of Y”) — untouched; can be localized in a follow-up.
- MP4 recording is real-time (a teleprompter is watched in real time). Faster-than-real-time (offscreen frame-pump to ffmpeg stdin) is a possible later optimization.

## Update — import plans from JSON (2026-06-24)

Complement to the JSON export (round-trips the same shape).

### Added
- `src/engines/video-planner/planImport.ts` — `parsePlanJson(raw, fallbackTitle)` (tolerant: accepts `{plan,segments}`, a bare segments array, or a flat plan object; bad/missing fields → safe defaults; throws typed `PlanImportError` `invalid-json`/`invalid-shape`) and `importPlan(projectId, parsed)` which writes a new plan + segments **atomically** via `db.transaction('rw', …)` + `bulkAdd`.

### Modified
- `VideoPlannerEngine.tsx` — hidden `<input type="file" accept=".json">`, **Import** button next to *New Plan* and in the empty state, inline auto-dismissing success/error banner (no native alert). On success: refresh list + select the imported plan.
- `locales/en.ts` + `locales/es.ts` — `videoPlanner.import.*` (label, invalid-json, invalid-shape, failed, imported) in both locales.

### Verified
- `db.videoPlans` / `db.videoSegments` are typed `Table<…>` (db/index.ts:57-58) → transaction + bulkAdd typecheck.
- Locale key parity confirmed (5/5 in both); all referenced keys exist.
- `React.ChangeEvent` used as the existing code uses `React.DragEvent` (global React namespace) — consistent.
- Same caveat: run `npx tsc -b --noEmit` / `npm run lint` on Windows. Not committed.
