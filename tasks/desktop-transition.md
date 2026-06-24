# Desktop Transition — Writers Hoard (Electron)

**Started:** 2026-06-19
**Decision (from prior chats):** **Electron**, not Tauri. Rationale: this stays
private/non-commercial for now and the priority is to *keep and directly
translate* the existing app. Electron's renderer **is** Chromium, so the
React/Vite build + Dexie/IndexedDB run unchanged — no OS-webview surprises, no
Rust. Approach is **wrap, don't rewrite**, in independently-shippable phases.

## Why desktop (the two real pains)

1. **"Limited space."** In the browser, IndexedDB is subject to per-origin quota
   and eviction-under-pressure. A packaged Electron app is not — the storage
   ceiling effectively disappears *for free*, with zero code changes. (SQLite is
   an optional later upgrade for relational querying, not a prerequisite.)
2. **"No proper scrapper."** The media downloader needed a separate Python/Flask
   `server.py` running locally, which is why the route is commented out and the
   commit log says "media downloader halted." On desktop the main process spawns
   a bundled `yt-dlp` binary directly — no Python, no separate server, no CORS.

---

## Phase 1 — Boot in a native window  ✅ implemented

- [x] `electron/main.ts` — `BrowserWindow` with secure defaults (contextIsolation
      on, nodeIntegration off, sandbox on), single-instance lock, external links
      open in the OS browser, minimal app menu, dev-vs-prod load.
- [x] `electron/preload.ts` — `contextBridge` exposing a narrow `window.electronAPI`.
- [x] `src/electron-env.d.ts` — renderer types for the bridge.
- [x] `electron/build.mjs` — esbuild bundles main+preload to **CommonJS `.cjs`**
      (sidesteps the ESM/CJS conflict with `"type": "module"`).
- [x] `electron/tsconfig.json` — standalone typecheck for the main process.
- [x] Renderer: `src/utils/platform.ts` `isDesktop()`; `App.tsx` uses **HashRouter**
      in Electron (path routing can't resolve under `file://`), BrowserRouter on web.
- [x] `package.json` — `main` field, desktop scripts, electron deps.

**Run it:** `npm install` → `npm run dev:desktop` (Vite + Electron with HMR).

## Phase 2 — Bundle the media downloader  ✅ implemented

- [x] `electron/media/ytdlp.ts` — resolve + spawn bundled `yt-dlp`, ffmpeg via
      `ffmpeg-static`, platform detection mirroring the Python labels.
- [x] `electron/media/server.ts` — embedded HTTP service on `127.0.0.1:8765`
      implementing the **exact** `/api/health|detect|download` contract the
      renderer already speaks → **zero renderer-service changes**.
- [x] Re-enabled the `/media-downloader` route + sidebar entry (desktop-only).
- [x] `scripts/fetch-ytdlp.mjs` (`npm run fetch:bin`) downloads the binary into
      `resources/bin/`; electron-builder ships it via `extraResources`.

**Design note:** keeping the HTTP contract as the seam means the *web* build still
works against the Python server (env override intact), while the *desktop* build
uses the embedded service. One renderer, two backends.

## Phase 3 — Native filesystem groundwork  — partial (intentionally staged)

- [x] Quota ceiling lifts automatically by being packaged (the actual fix for
      "limited space").
- [x] `electronAPI.fs` bridge: `pickFolder`, `readFile`, `writeFile`, `exists`
      — the door for engines to read/write real files (the "hoard").
- [ ] **Later:** route project exports / zip backups / gallery assets through a
      user-chosen folder via the fs bridge instead of `<a download>`.
- [ ] **Later (optional):** migrate IndexedDB → SQLite behind the existing store
      interfaces, with an IndexedDB→SQLite importer for current data. Big lift;
      not required to ship.

## Phase 4 — Installer + auto-update  ✅ implemented

- [x] `electron-builder.yml` — NSIS installer (Win x64), asarUnpack ffmpeg,
      extraResources for yt-dlp, GitHub publish to `Luissalet/Writers-Hoard-Desktop`.
- [x] `electron-updater` wired in `main.ts` (`checkForUpdates`, update-downloaded
      event, Help ▸ Check for Updates…).
- [x] `.github/workflows/release.yml` — on tag `v*`, Windows runner builds and
      publishes the installer.

**Ship a release:** bump `version`, `git tag v0.1.0 && git push origin v0.1.0`.

---

## Build the installer locally

```
npm install
npm run fetch:bin     # downloads yt-dlp into resources/bin
npm run dist          # outputs release/Writers Hoard Setup x.y.z.exe
```

## Open items / things to verify on the Windows machine

- [ ] `npm install` once locally to regenerate `package-lock.json` with the new
      deps (commit it so CI `npm ci` passes).
- [ ] Confirm a `file://` page can `fetch` `http://127.0.0.1:8765` in Electron
      (expected to work; if blocked, fall back to an IPC media channel).
- [ ] Google OAuth (`accounts.google.com/gsi/client`) under `file://` — the GSI
      popup flow may need a loopback/system-browser OAuth flow on desktop. Sync
      is optional; the rest of the app is unaffected.
- [ ] Optional: add `build/icon.ico` for a custom app icon.

## Review

Foundation is complete and the two motivating pains are addressed: the storage
ceiling is gone by construction, and the media downloader is self-contained
(bundled yt-dlp, no Python). Renderer changes were deliberately tiny — router
selection, one util, a re-enabled route/sidebar entry, a types file — honoring
"keep and directly translate." Full SQLite migration is documented and staged,
not forced. No auto-commit: changes left for review.
