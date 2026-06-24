# Writers Hoard — Desktop

Local-first creative writing platform, packaged as a desktop app with
**Electron**. Same React/Vite/Dexie codebase as the web build, wrapped in a
native shell that lifts the browser storage ceiling and bundles a real media
downloader (`yt-dlp`) — no separate Python server.

> Transition plan and rationale: [`tasks/desktop-transition.md`](tasks/desktop-transition.md)

## Quick start

```bash
npm install            # installs deps (incl. electron, esbuild, electron-builder)
npm run fetch:bin      # downloads the yt-dlp binary into resources/bin/
npm run dev:desktop    # Vite dev server + Electron window (HMR)
```

`npm run dev` still runs the plain web app in a browser if you prefer.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | Web app only (Vite, browser). |
| `dev:desktop` | Vite + Electron with hot reload. |
| `build` | Typecheck + build the web renderer. |
| `build:desktop` | Build renderer (relative base) + bundle Electron main/preload. |
| `electron:build` | Bundle `electron/` → `dist-electron/*.cjs` (esbuild). |
| `typecheck:electron` | Typecheck the main-process code. |
| `fetch:bin` | Download the `yt-dlp` binary for this OS into `resources/bin/`. |
| `dist` | Build a local installer into `release/`. |
| `dist:publish` | Build + publish a release to GitHub. |

## Architecture (desktop bits)

```
electron/
  main.ts            Window, security, IPC, auto-update, starts media server
  preload.ts         contextBridge → window.electronAPI (app/fs/updates)
  media/
    ytdlp.ts         Resolve + spawn bundled yt-dlp; ffmpeg via ffmpeg-static
    server.ts        Embedded 127.0.0.1:8765 HTTP service (same contract as
                     the old Python server → renderer needs no changes)
  build.mjs          esbuild → dist-electron/*.cjs (CommonJS)
scripts/fetch-ytdlp.mjs   Downloads the yt-dlp binary
electron-builder.yml      NSIS installer + GitHub publish config
```

The renderer detects Electron at runtime (`src/utils/platform.ts`) to choose
`HashRouter` (needed under `file://`) and to show the desktop-only Media
Downloader. The web build is unchanged and still deploys to GitHub Pages.

## Releasing

```bash
# bump "version" in package.json, then:
git tag v0.1.0
git push origin v0.1.0     # .github/workflows/release.yml builds + publishes
```

Auto-update is wired via `electron-updater` against the
`Luissalet/Writers-Hoard-Desktop` releases. Users get updates automatically;
**Help ▸ Check for Updates…** triggers a manual check.

## Notes

- Run `npm install` once and commit the regenerated `package-lock.json` so CI
  (`npm ci`) stays in sync.
- Add `build/icon.ico` to customise the app icon (optional).
- Google Docs sync uses a web OAuth popup; on desktop that may need a
  loopback/system-browser flow. Sync is optional — the rest of the app works
  offline regardless.
