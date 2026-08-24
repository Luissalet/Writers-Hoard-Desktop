# Writers Hoard — Desktop

Local-first creative writing platform, packaged as a desktop app with
**Electron**. Same React/Vite/Dexie codebase as the web build, wrapped in a
native shell that lifts the browser storage ceiling and bundles real media
downloaders (`yt-dlp` + `gallery-dl`) — no separate Python server.

> Transition plan and rationale: [`tasks/desktop-transition.md`](tasks/desktop-transition.md)

## Quick start

```bash
npm install            # one-time dependency setup
npm run fetch:bin      # downloads yt-dlp + gallery-dl into resources/bin/
npm run verify:quick   # renderer/Electron types, shipping lint, conformance
npm run dev:desktop    # Vite dev server + Electron window (HMR)
```

`npm run dev` still runs the plain web app in a browser if you prefer.
On Windows, `setup.bat` performs the one-time setup; subsequent launches use
`run.bat` without reinstalling or changing dependencies.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | Web app only (Vite, browser). |
| `dev:desktop` | Coordinated Vite + Electron launcher with hot reload and automatic port selection. |
| `build` | Typecheck + build the web renderer. |
| `build:desktop` | Build renderer (relative base) + bundle Electron main/preload. |
| `electron:build` | Bundle `electron/` → `dist-electron/*.cjs` (esbuild). |
| `typecheck:renderer` | Typecheck the React renderer without emitting files. |
| `typecheck:electron` | Typecheck the main-process code. |
| `lint:shipping` | Lint shipping renderer, Electron, and tooling sources. |
| `lint:baseline:prune` | Remove fixed fingerprints from the checked-in lint debt baseline. |
| `conformance` | Check engine registration, schema, locale, backup, and binary declarations. |
| `test:critical` | Run isolated Electron/Chromium tests for migration, backup, cascades, recovery/navigation, full rendering, and Vite startup. |
| `test:packaged` | Smoke-test the already-built `release/win-unpacked` desktop app with an isolated temporary profile. |
| `bundle:budget` | Enforce renderer entry, lazy-chunk, and total JavaScript size limits. |
| `audit:security` | Fail when npm reports a moderate-or-higher dependency vulnerability. |
| `verify:quick` | Run both typechecks, shipping lint, and conformance. |
| `verify:release` | Run the dependency audit, quick checks, critical tests, production builds, and bundle budgets. |
| `fetch:bin` | Download `yt-dlp` and `gallery-dl` for this OS into `resources/bin/`. |
| `dist` | Verify and build a local installer into `release/`. |
| `dist:publish` | Verify, build, and publish a release to GitHub. |

`lint:shipping` compares ESLint output to
`scripts/lint-baseline.json`. Existing debt remains visible, but any new
file/line/rule/message fingerprint fails CI. After fixing baseline violations,
run `npm run lint:baseline:prune`; it only removes resolved fingerprints and
refuses to absorb new violations.

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
scripts/fetch-ytdlp.mjs   Downloads yt-dlp + gallery-dl binaries
scripts/binary-manifest.json  Pinned binary assets, versions, and SHA-256 hashes
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

Published Windows releases are fail-closed: GitHub Actions must provide the
repository secrets `WIN_CSC_LINK` (a PFX path/URL or base64 value accepted by
electron-builder) and `WIN_CSC_KEY_PASSWORD`. `dist:publish` refuses to run
without them and also enables electron-builder's `forceCodeSigning` check.
Local `npm run dist` remains available for unsigned development installers.

### Reproducible media binaries

The binary manifest pins each supported platform to immutable release versions
and SHA-256 hashes. `npm run fetch:bin` verifies the download before replacing
an existing binary, and conformance rejects mutable or incomplete manifest
entries.

For an intentional binary upgrade, these environment variables can override the
manifest after their version and matching platform checksum are reviewed:

- `WH_YTDLP_VERSION` and `WH_YTDLP_SHA256`
- `WH_GALLERYDL_VERSION` and `WH_GALLERYDL_SHA256`

Pinned versions use GitHub's `releases/download/<version>/<asset>` path. Keep
the committed manifest as the default release source of truth.

## Notes

- Run `npm install` once and commit the regenerated `package-lock.json` so CI
  (`npm ci`) stays in sync.
- Add `build/icon.ico` to customise the app icon (optional).
- Google Docs sync uses a web OAuth popup; on desktop that may need a
  loopback/system-browser flow. Sync is optional — the rest of the app works
  offline regardless.
