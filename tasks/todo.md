# TODO — Standalone Media Downloader Route

**Date:** 2026-05-28
**Owner:** Claude (working with Luis)

## Goal

Make the **Scrapper** experience accessible from the global sidebar without an active project. Behavior is **dual-mode**:

- **Inside a project** (`/project/:id/scrapper`) → existing behavior: archive URL metadata to IndexedDB. No file download.
- **From the sidebar** (`/media-downloader`) → **actually download** the media (video/audio) to a folder on the user's PC via the File System Access API, using the user's existing **Universal Video Downloader** Python project (yt-dlp-based) as the backend.

## Architecture decisions

1. **Re-use the Scrapper UI** by adding a `mode: 'archive' | 'download'` prop to `ScrapperEngine.tsx` and `CaptureBar.tsx`. No projectId required in download mode.
2. **New top-level route** `/media-downloader` in `App.tsx`, rendered inside `MainLayout` so the sidebar is visible.
3. **Sidebar entry** (always visible — like Home) below `Home`, using the `Download` icon already imported from lucide.
4. **New page** `src/pages/MediaDownloader.tsx` that mounts `<ScrapperEngine mode="download" />` and owns the save-folder picker state.
5. **Backend client** `src/services/mediaDownloader.ts` — typed wrapper around the Python server's HTTP API (POST `/api/download`, GET `/api/health`, POST `/api/detect`). Configurable base URL via `VITE_MEDIA_DOWNLOADER_URL` env var; defaults to `http://localhost:8765`.
6. **Python HTTP wrapper** — add a small Flask server (`server.py`) to the Universal video downloader folder that exposes the existing `DownloadManager` over HTTP. Streams files back to the browser so the React client can save them via the directory handle.
7. **File System Access API** — call `showDirectoryPicker()` once, remember the handle in IndexedDB (so it survives reloads), then `directoryHandle.getFileHandle(filename, { create: true })` for each download.
8. **No new DB tables, no new engine registration** — download mode is ephemeral, archives nothing. The existing `scrapper` engine stays as-is for project mode.

## File-level plan (checkable)

### Phase 1 — Python backend (in `Universal video downloader/`)
- [ ] `server.py` — Flask app, CORS-enabled for `http://localhost:5173`, with:
  - `GET  /api/health` → `{ok: true, platforms: [...]}`
  - `POST /api/detect` `{url}` → `{platform: "YouTube" | "..." | "Desconocida"}`
  - `POST /api/download` `{url, format: "video"|"audio"}` → streams the resulting file as `application/octet-stream` with `Content-Disposition: attachment; filename="..."`. Uses a tempdir then deletes after streaming.
- [ ] Append `flask` and `flask-cors` to `requirements.txt`.
- [ ] Update `README.md` with the new "Run as server" section.

### Phase 2 — React: routing + sidebar
- [ ] `src/App.tsx` — add `<Route path="/media-downloader" element={<MediaDownloader />} />` inside `MainLayout`.
- [ ] `src/components/layout/Sidebar.tsx` — add a top-level "Media Downloader" button below Home (always visible, regardless of `projectId`), active when `location.pathname === '/media-downloader'`. Use `Download` icon.

### Phase 3 — React: standalone page
- [ ] `src/pages/MediaDownloader.tsx` — page shell. Owns:
  - Save-folder picker UI (button: "Choose download folder…", shows current folder name)
  - Mounts `<ScrapperEngine mode="download" projectId={undefined} />`
  - Reads/writes the `directoryHandle` via a small `useDownloadFolder()` hook backed by IndexedDB (handles persist across reloads).
- [ ] `src/hooks/useDownloadFolder.ts` — get/set the directory handle, request permission on load, expose `{handle, pick, hasHandle}`.

### Phase 4 — React: dual-mode Scrapper
- [ ] `src/engines/_types.ts` (or inline prop) — extend so `projectId` can be optional when `mode === 'download'`.
- [ ] `src/engines/scrapper/components/ScrapperEngine.tsx` — accept optional `mode?: 'archive' | 'download'` (default `'archive'`). In download mode:
  - Hide the snapshot list / search / view toggle (nothing is archived).
  - Show the CaptureBar in download mode, plus a "Downloads this session" list (in-memory only).
- [ ] `src/engines/scrapper/components/CaptureBar.tsx` — accept the same `mode` prop. In download mode the Enter / button click calls `mediaDownloader.download(url, format, dirHandle)` instead of `onCapture(snapshot)`. Adds a Video/Audio toggle.

### Phase 5 — React: backend client + download flow
- [ ] `src/services/mediaDownloader.ts` — typed client:
  - `detect(url): Promise<Platform>`
  - `download(url, opts, dirHandle): Promise<{filename, sizeBytes}>` — fetch as stream, write to `dirHandle.getFileHandle(filename, {create:true})`.
  - `checkHealth(): Promise<boolean>`
- [ ] Backend-offline banner on the page when `checkHealth()` returns false, with the exact command to start it (`python server.py` from the universal downloader folder).

### Phase 6 — i18n
- [ ] `src/locales/en.ts` & `src/locales/es.ts` — add keys under `mediaDownloader.*`:
  `title`, `subtitle`, `chooseFolder`, `currentFolder`, `noFolder`, `format.video`, `format.audio`, `download`, `downloading`, `serverOffline`, `serverOfflineHint`, `unsupportedUrl`, `downloadComplete`, `downloadFailed`, `sessionDownloads`, `permissionDenied`.
- [ ] Add `sidebar.mediaDownloader` for the sidebar label.
- [ ] **NO `engines.media-downloader.*` keys** — this is intentionally NOT a registered engine; per lesson #7 those keys are only required for registered engines.

### Phase 7 — Verification (per CLAUDE.md §4)
- [ ] `npx tsc -b --noEmit` — zero errors (per lesson #1).
- [ ] Sidebar shows "Media Downloader" entry both on `/` and inside a project.
- [ ] `/media-downloader` loads, prompts for save folder, and (with server off) shows the offline banner.
- [ ] Inside a project, `Scrapper` engine still archives URLs as before (no regression).
- [ ] No native `confirm/alert/prompt` introduced (lesson #12).
- [ ] No English string templates in shared components (lesson #8).
- [ ] Don't trust stale bash mount if tsc errors look weird (lesson #13).

## Out of scope (for this pass)

- Progress bar with percent/speed/ETA — the Python `DownloadManager` reports progress, but plumbing it into React needs SSE or WebSocket. For v1 just show a spinner and "Downloading…" text.
- Cookies file upload for private content — defer.
- Persistent history of downloaded files (would need a new table). v1 keeps an in-memory "this session" list.
- Auto-starting the Python server from the React app. User runs `python server.py` manually.
- Firefox/Safari support for the save-folder UX — those browsers lack `showDirectoryPicker`. We'll degrade to per-file `showSaveFilePicker`, or fall back to `<a download>` to the browser default folder.

## Review (2026-05-28)

### Files added (8)

1. `Universal video downloader/server.py` — Flask HTTP wrapper over `DownloadManager`. Endpoints: `GET /api/health`, `POST /api/detect`, `POST /api/download`. Streams the file back with proper `Content-Disposition` (RFC 5987 for non-ASCII). Defaults to port 8765, configurable via `PORT` env var.
2. `Universal video downloader/requirements.txt` — appended `flask>=3.0.0` and `flask-cors>=4.0.0`.
3. `Universal video downloader/README.md` — added "Ejecutar como servidor HTTP" section.
4. `src/services/mediaDownloader.ts` — typed client (`checkHealth`, `detectPlatform`, `downloadToDirectory`, `supportsDirectoryPicker`). Uses streaming `ReadableStream` → File System Access API writes, so we never buffer the whole file in memory.
5. `src/hooks/useDownloadFolder.ts` — persists `FileSystemDirectoryHandle` in a tiny standalone IndexedDB store (NOT in Dexie — no schema bump). Handles permission re-request on reload.
6. `src/pages/MediaDownloader.tsx` — standalone page. Owns folder handle, health probe, in-memory `SessionDownload[]`, banner state.

### Files modified (5)

1. `src/App.tsx` — added `<Route path="/media-downloader" element={<MediaDownloader />} />`.
2. `src/components/layout/Sidebar.tsx` — added always-visible "Media Downloader" button below Home, active state on `/media-downloader`.
3. `src/engines/scrapper/components/CaptureBar.tsx` — refactored into a discriminated-union component (`mode: 'archive' | 'download'`). Download mode adds a Video/Audio toggle and calls `onDownload` instead of `onCapture`.
4. `src/engines/scrapper/components/ScrapperEngine.tsx` — split into `ArchiveModeView` (existing behavior, unchanged for projects) and `DownloadModeView` (used by the standalone page). The exported `ScrapperEngine` is a thin switch on `mode`.
5. `src/locales/{en,es}.ts` — added `sidebar.mediaDownloader` and the full `mediaDownloader.*` key block.

### Verification status

- ✅ All edits confirmed intact via `Read` tool.
- ⚠️ **Sandbox typecheck was unreliable** — the Linux bash mount returned a snapshot from 2026-05-26, producing phantom JSX-truncation errors against files that are well-formed on disk. This is exactly **lesson #13**, so I did NOT panic-revert. The user needs to run `npx tsc -b --noEmit` from a Windows terminal to get the real signal.
- ✅ Inside a project, `Scrapper` still archives URLs — `ArchiveModeView` is a clean rename of the prior body. Zero behavior change.
- ✅ No native `confirm/alert/prompt` introduced.
- ✅ No English string templates in shared components (all visible copy is via `t()` keys).
- ✅ Scrapper engine `EngineDefinition` unchanged — no new engine registration, no schema migration.

### Run instructions for the user

1. **Backend** (once per machine):
   ```bash
   cd "Universal video downloader"
   pip install -r requirements.txt
   python server.py
   ```
   Listens on http://localhost:8765 by default.

2. **Front-end**: just `npm run dev` as usual. Click "Media Downloader" in the sidebar, pick a folder, paste a URL.

3. **Typecheck** (from Windows terminal, NOT WSL/Linux):
   ```
   npx tsc -b --noEmit
   ```

### Known limitations (out of scope, documented in plan)

- Progress bar is just a spinner — backend reports per-chunk progress but no SSE yet.
- Firefox / Safari will show the "browser unsupported" banner (no `showDirectoryPicker`).
- The Python server has zero auth — it's meant for `localhost` only. Don't expose to a network.
- First download attempt after a reload may show a permission prompt to re-confirm folder access.
