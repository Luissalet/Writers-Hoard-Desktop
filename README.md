# Writers Hoard — Desktop

[Español](README.es.md)

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

## AI subscriptions and external assistants

In **AI settings → Use my subscriptions**, sign in with the official Claude or
Codex client, or import an existing subscription session. Check the connection,
then choose it as the default text model. API connections and local models remain
available. Subscription requests verify the account's authentication method and
never fall back to API billing. Text and copilot actions are supported; image
generation continues to use the separate image providers.

The **AI bridge** section explains how to connect Claude Desktop, Codex or Gemini
CLI back to the app, with client-specific configuration and a separate, safe
prompt to brief the assistant. Keep Writers Hoard open while connected. A normal
web chat cannot gain access by pasting a prompt or a localhost address.

See [subscription setup](docs/ai-subscriptions.md) and
[external assistant setup](docs/ai-external-connection.md).

## Investigation (research projects)

The **Investigation** engine (`inquiry`, category research; on by default in the
Reporter preset, suggested in Biographer and Realist) turns the research a
project already holds into claims and reasons about them.

- **Sources are graded and can be retracted.** Each citation may carry a
  reliability (A-F) and a credibility (1-6), shown as `B2`, plus an origin used
  to judge independence. Older citations read "ungraded". Retracting a source
  never deletes it or its excerpts; the claims that rested on it are
  re-derived and the app says how many were affected. A retracted source stays
  in the bibliography, marked with the date and reason, in every citation style
  and every publishing format; the publishing preview counts them.
- **Claims rest on recorded excerpts.** A claim is a statement (optionally
  subject, predicate, object, with partial dates) with at least one support
  pointing at an existing excerpt. Its status is never stored: it is derived
  every time as unsupported, claimed, corroborated (two or more independent
  origins), confirmed or disputed (the author's override) or retracted, always
  shown next to its excerpt and independent-source counts.
- **Time.** Every view takes an "as of" date. A claim whose period is over is
  *ended*; one not seen for longer than the staleness window (365 days by
  default) is *stale*.
- **Tabs:** Claims, Chronology (with contradictions over one-at-a-time
  predicates and unknown stretches), Graph, Hypotheses (analysis of competing
  hypotheses, worded as "the least contradicted so far", never "proven"),
  Report (Markdown with a citation check; an optional model summary must pass
  the check and is flagged, not hidden) and Entities.
- **Privacy.** A codex person is private unless the author marks them a public
  figure. Enrichment never runs on a private person, library searches take
  their names out of the query, and the report labels them "private person".
- **Lookups.** Organisations, places, events and public figures can be matched
  to Wikidata from the main process (identified User-Agent, serial requests,
  timeouts). Applying fills empty fields only, stores the item id, files a C3
  source and logs a run that can be undone. The desktop app can also search the
  user's other local apps through the Hoard hub (`library_search`,
  `search_links`); hits become ungraded sources and the hub being down is
  reported, not fatal.
- **AI bridge.** `wh_grade_source`, `wh_retract_source`, `wh_list_claims`,
  `wh_add_claim`, `wh_update_claim`, `wh_inquiry_timeline`, `wh_add_hypothesis`,
  `wh_rate_hypothesis`, `wh_ach_matrix`, `wh_enrich_codex`,
  `wh_undo_enrichment`, `wh_inquiry_report`, `wh_search_library` and
  `wh_bibliography`, the reference list with grades and retractions marked (details in
  [`docs/AI-BRIDGE.md`](docs/AI-BRIDGE.md)).

`npm run test:inquiry` runs its focused tests (pure logic, migration,
enrichment, UI and the bridge tools).

- **Hoard family hand-offs.** `wh_character_to_prospero`,
  `wh_storyboard_to_prospero`, `wh_world_to_scheherazade` and
  `wh_world_from_scheherazade` (desktop app, through the local Hoard hub). A
  codex character becomes a Prospero cast member, a storyboard becomes a
  Prospero production, and a project's world travels to and from Scheherazade as
  a neutral `hoard.world/1` document (schema in Scheherazade's
  `docs/WORLD_SCHEMA.md`). Importing creates new records, never overwrites
  anything edited here, keeps each source `ref` and `revision`, and can be
  undone; deleted records stay deleted. Buttons "Send to Prospero", "Send to
  Scheherazade" and "Bring from Scheherazade" show clear success and error
  messages (including which app to start). Details in
  [`docs/AI-BRIDGE.md`](docs/AI-BRIDGE.md) section 26.

`npm run test:family` runs its focused tests (exchange logic and UI).

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
| `test:family` | Test the hand-offs to the other Hoard apps: world exchange logic, import, undo and the UI. |
| `test:inquiry` | Test the Investigation engine: pure logic, migration, Wikidata enrichment with mocked requests, the UI and the AI-bridge tools. |
| `test:subscriptions` | Test subscription isolation, tool protocol, connection controls and external-assistant setup without calling providers. |
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
Downloader. This repository does not publish the web build; CI (`.github/workflows/ci.yml`)
verifies, tests and builds it on every push.

## Releasing

See [the release guide](docs/RELEASES.md) for the public repository, the six Windows/Linux assets, naming and checksum conventions, manual upload commands, and the scope of the Windows-only publishing workflow.

```bash
# bump "version" in package.json, then:
git tag v0.1.0
git push origin v0.1.0     # .github/workflows/release.yml builds + publishes
```

Auto-update is wired via `electron-updater` against the
`Luissalet/Writers-Hoard-Releases` releases. The titlebar Updates panel reports
new versions after startup checks and every six hours. Downloads and installation
are explicit user actions; restart first uses the pending-write shutdown guard.
**Help ▸ Check for Updates…** opens the same panel, which also links to GitHub
for a manual download. This preview includes prereleases and refuses downgrades.

Published Windows releases are fail-closed: GitHub Actions must provide the
repository secrets `WIN_CSC_LINK` (a PFX path/URL or base64 value accepted by
electron-builder) and `WIN_CSC_KEY_PASSWORD`. `dist:publish` refuses to run
without them and also enables electron-builder's `forceCodeSigning` check.
Local `npm run dist` remains available for unsigned development installers.

The public distribution repository is separate from this source repository.
Configure `RELEASES_GITHUB_TOKEN` with Contents: write permission on
`Luissalet/Writers-Hoard-Releases` for the publishing workflow. Only installers,
update metadata, checksums and public documentation belong there. Package rules
exclude source maps; never copy this repository or its Git history to the public one.
The initial manually published v0.1.0 preview is unsigned and marked as a prerelease;
the automated stable publishing path continues to require signing credentials.

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
