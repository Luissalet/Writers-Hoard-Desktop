# Black-screen startup regression — 2026-07-27

## Follow-up: stale Vite instance / port drift

- [x] Identify the process and source actually served after the error persisted.
- [x] Confirm Vite had moved from configured port `5174` to `5175`.
- [x] Replace the fixed-port Electron wait/load sequence with one coordinated launcher.
- [x] Verify `dev:desktop` uses Vite's resolved URL and mounts the current renderer.
- [x] Run release verification and refresh project knowledge.

### Finding

The source fix was present both on disk and in the renderer served at `5175`.
The old launcher nevertheless waited for and loaded hard-coded port `5174`.
When an older Vite process occupied `5174`, the new server automatically moved
to `5175` while Electron connected to the older renderer, preserving the exact
pre-fix `lazy` initialization error.

### Review

Fixed at the launcher boundary. With ports `5174` and `5175` deliberately
occupied, `dev:desktop` selected `5176`; Electron established its renderer
connection to `5176`, and that server exposed the corrected engine module.
Closing the Electron process also closed the coordinated Vite instance. The
release gate passes all types, lint, conformance, six critical browser/startup
scenarios, production builds, and bundle budgets. The external project-graph
files configured by the update skill are absent in this desktop environment,
so `docs/PROJECT_KNOWLEDGE.md` remains the durable updated graph.

---

- [x] Capture the renderer exception and identify the module initialization fault.
- [x] Move every React `lazy` import before its first use.
- [x] Add a complete renderer-startup smoke test with page/console error capture.
- [x] Run quick/release verification and a real development-mode startup check.
- [x] Refresh project knowledge and confirm no commit or push was created.

## Review

Fixed. The DevTools Autofill protocol warnings were unrelated; all 22 engine
indexes used `lazy` before the corresponding React import. Imports now precede
execution, conformance rejects that ordering error, and the isolated Electron
suite mounts both the complete bundled renderer and the actual Vite development
renderer. `npm run verify:release` passes all six browser scenarios plus types,
lint, conformance, production builds, and bundle budgets.

---

# Full stability, UX, engine, and feature roadmap — implementation

**Started:** 2026-07-27
**Constraint:** leave every change uncommitted and unpushed for user review.

## Phase 1 — Trust and data safety

- [x] Make every engine backup strategy complete, including child-only tables.
- [x] Make ZIP export/import fail closed with structured completeness reports.
- [x] Preflight archives before mutation and make restore atomic or rollback-safe.
- [x] Add Scrapper external-asset inventory, missing-file reconciliation, and explicit backup semantics.
- [x] Repair Writings autosave with a serialized awaited save queue and recovery journal.
- [x] Add ownership-aware deletion coverage for child rows, caches, and native assets.
- [x] Reconcile interrupted media/page-capture jobs at startup.
- [x] Use local calendar dates for Writing Stats.
- [x] Make entity identity and deep navigation project-aware.
- [x] Add storage/load errors and retry states to shared hooks.
- [x] Add automated backup, migration, autosave, cascade, and navigation tests.
- [x] Add reliable quick/release verification commands and CI gates.
- [x] Pin downloaded helper binaries and document supported packaging targets.

## Phase 2 — Consistent experience and performance

- [x] Heal invalid/disabled engine routes and zero-engine states.
- [x] Standardize engine dashboards, modals, keyboard behavior, and error/loading UI.
- [x] Add Project Health diagnostics and repair actions.
- [x] Add a Project Cockpit for recent work, inbox, goals, failures, and unresolved items.
- [x] Centralize one-time initialization and reactive data invalidation.
- [x] Lazy-load engine UI and add practical bundle/performance budgets.
- [x] Replace full-table global search scans with a project-aware search index.
- [x] Add visible backup, save, storage, and native-job progress/status.

## Phase 3 — Cross-engine workflows and engine upgrades

- [x] Build a canonical project-aware Entity Hub with backlinks and delete impact.
- [x] Build the Outline Beat ↔ Scene ↔ Writing narrative spine.
- [x] Canonicalize Codex/Relationships and generic entity references.
- [x] Expand annotation adapters/surfaces across linkable engines.
- [x] Expose dormant Seed, Arc, Map, Gallery, Biography, and Video links.
- [x] Add Notes/Diary promotion and research-to-draft actions.
- [x] Make Gallery the shared asset source for visual engines.
- [x] Add typed cross-engine converters with preview, provenance, and undo.
- [x] Add engine conformance checks for schema, locale, backup, resolver, and lifecycle coverage.

## Phase 4 — New product capabilities

- [x] Add Story Intelligence analytical views.
- [x] Add reusable project templates and recipes.
- [x] Add research citations and bibliography export.
- [x] Expand publishing profiles for manuscript, screenplay, research, biography, and video.
- [x] Add a managed external asset vault with relocation and repair.
- [x] Add project-grounded AI with citations and privacy controls.
- [x] Add secure browser/OS capture integrations.

## Final verification and handoff

- [x] Run renderer and Electron typechecks.
- [x] Run shipping-code lint and automated tests.
- [x] Run production renderer/Electron builds and critical desktop smoke flows.
- [x] Update this review and `docs/PROJECT_KNOWLEDGE.md`; the configured external graph files were unavailable, so the repository knowledge document is the durable fallback.
- [x] Confirm no commit or push was created.

## Review

Implemented and release-verified.

- Trust: complete parent-aware backup strategies, read-only archive preflight,
  structured failures, transactional restore rollback, explicit Scrapper
  external-asset semantics, serialized autosave with a recovery journal, and
  ownership-aware deletion/reconciliation.
- Experience: project-aware navigation, route healing, per-engine failure
  boundaries, shared hook retry states, storage persistence feedback, lazy
  engine chunks, an invalidation-aware search index, and a Project Cockpit with
  health checks and safe repairs.
- Workflows: canonical project entity links/backlinks, editable
  Outline-to-Scene-to-Writing spine, fallback anchors for searchable engines,
  Gallery asset reuse, promotion/conversion provenance with undo, citations,
  templates, publishing profiles, asset relocation/audit, and opt-in grounded
  AI with source IDs and privacy controls.
- Quality: helper binaries are version/checksum pinned, the shipping-lint
  baseline is empty, conformance covers 22 engines and paired locales, CI runs
  the critical Electron tests, and renderer bundle limits are enforced.
- Verification: `npm run verify:release` passed, including renderer/Electron
  typechecks, zero-fingerprint shipping lint, engine conformance, six isolated
  Chromium/IndexedDB and renderer-startup scenarios, production renderer/Electron builds,
  and the post-build bundle budget.

---

# Project exploration and knowledge refresh — 2026-07-27

- [x] Inventory the repository, instructions, and accumulated lessons.
- [x] Map runtime entry points, routing, layout, and engine architecture.
- [x] Map domain entities, Dexie schema, state, services, and cross-engine flows.
- [x] Map Electron IPC, media integration, build, packaging, and release workflow.
- [x] Assess verification coverage, active worktree state, and high-risk areas.
- [x] Persist a current project knowledge map for future tasks.
- [x] Cross-check the map against the current source and document the review.

## Review

- Added `docs/PROJECT_KNOWLEDGE.md`, a current-state map of the runtime,
  routes, source layout, 22-engine catalog, Dexie v22/46-table persistence
  layer, shared registries, major workflows, Electron boundary, extension
  checklist, and verification commands.
- The map is explicitly based on the current dirty worktree, including the
  in-progress Notes/quick-note and Links-to-Scrapper migration. No existing
  source change was overwritten or reformatted.
- Highest-priority finding: structured ZIP backup is not a reliable full
  round-trip. Timeline still assumes a removed legacy path; some generic
  strategies list child tables without `projectId`; per-engine errors continue
  silently; Scrapper disk assets are not included. No behavior was changed in
  this exploration task.
- Other recorded priorities: writing last-save durability, uneven cascades and
  soft-reference cleanup, project-less/wrong-project global navigation, UTC
  writing-stat day boundaries, missing automated tests, incomplete CI gates,
  and unpinned external binaries.
- Static cross-check: 22 registered engines, 46 typed Dexie tables, 20 engine
  entity resolvers, six actual engine anchor adapters, and 21 engines with
  backup registration; every engine appears in the catalog.
- Verification: renderer TypeScript passed (`tsc -b --noEmit`); Electron
  TypeScript passed (`tsc -p electron/tsconfig.json`). Repository-wide ESLint
  ran and reported 40 errors / 11 warnings, including active Worldgen code and
  archived `_stage`, `_to_delete`, and harness files. These are pre-existing
  code/tooling findings; this task changed only Markdown.
- The project-graph skill's configured `/sessions/.../.auto-memory` files are
  not present in this desktop workspace. The durable in-repository knowledge
  document is the safe fallback for future tasks.

---

# Scrapper (Recortes) — descargar el vídeo a local y reproducirlo en el recorte

**Date:** 2026-06-24 · Target: **Writers hoard desktop** (Electron, repo primario)

## Problema
Hoy, al pegar un enlace de Instagram/Twitter/YouTube en Recortes, el recorte guarda **solo el enlace** (metadata + tags). El `SnapshotDetail` muestra la URL y, para YouTube, un `<iframe>` al CDN — nunca descarga el archivo ni lo reproduce desde disco. El usuario quiere: **pego enlace → se descarga el vídeo a local → aparece reproducible en el recorte**.

## Lo que ya existe (verificado)
- `electron/media/ytdlp.ts` → `downloadMedia(url, 'video'|'audio')` ya descarga a un tempdir y devuelve `{ filePath, filename, sizeBytes, cleanup }`. Plataformas: YouTube, X (Twitter), Instagram, Audiomack.
- `electron/media/server.ts` → HTTP `:8765` que hace stream del archivo y luego `cleanup()` (lo borra). No persiste.
- `electron/main.ts` → patrón IPC `ipcMain.handle` + `app.getPath('userData')`. **No** hay protocolo custom para servir archivos al renderer (sandbox + `file://`).
- `src/engines/scrapper/types.ts` → `Snapshot` sin campos de media local. Índice Dexie `snapshots: 'id, projectId, source, status, createdAt'` → **los campos nuevos no van indexados ⇒ sin migración de versión** (lección #9: no inventar storage de más).
- `SnapshotDetail.tsx` / `SnapshotCard.tsx` → render del recorte; `useSnapshots` (makeEntityHook) para CRUD.
- `src/utils/platform.ts` → `isDesktop()` para gatear features de escritorio.
- Electron **^33.2.1** ⇒ `protocol.handle()` disponible (sirve `file://` vía `net.fetch`, con Range/seeking gratis). Sin meta-CSP en `index.html` que estorbe.

## Decisiones de producto (confirmadas con el usuario)
- **Descarga automática al capturar** un enlace de plataforma soportada (en segundo plano; reproductor aparece al terminar).
- **Formato: vídeo con audio (mp4).**

## Decisiones técnicas
- **Reproducir local** vía protocolo privilegiado **`wh-media://`** (no blob-en-memoria): `<video controls src="wh-media://media/<projectId>/<file>">`. Soporta seeking y no carga el archivo entero en RAM. (Matiz vs lección #14: el flujo browser-native blob es para descargas one-off de la página media-downloader; aquí es "guardado gestionado y repetido en carpeta de la app", donde el IPC/protocolo nativo es lo correcto.)
- **Guardar gestionado** en `<userData>/scrapper-media/<projectId>/<snapshotId>.<ext>` (lo posee la app; se puede limpiar al borrar el recorte). Descarga vía **IPC en main process** (el archivo nunca pasa por el renderer ni por IndexedDB).
- **Sin migración Dexie** (campos no indexados).

## Plan (checkable)
- [ ] 1. **Electron — protocolo + IPC** (`electron/main.ts`):
  - `protocol.registerSchemesAsPrivileged([{ scheme: 'wh-media', privileges: { standard, secure, supportFetchAPI, stream } }])` antes de `app.whenReady`.
  - Tras ready: `protocol.handle('wh-media', …)` → resuelve a `<userData>/scrapper-media/…`, **valida que la ruta resuelta queda dentro de esa carpeta** (anti path-traversal), devuelve `net.fetch(pathToFileURL(abs))`.
  - IPC `media:downloadToLibrary({ url, format, projectId, snapshotId })` → `downloadMedia()` → copia a `scrapper-media/<projectId>/<snapshotId>.<ext>` → `cleanup()` temp → `{ ok, relPath, filename, sizeBytes, kind, error? }`.
  - IPC `media:deleteLibraryFile(relPath)` (limpieza al borrar; ruta validada).
- [ ] 2. **Bridge** (`electron/preload.ts` + `src/electron-env.d.ts`): exponer `media.downloadToLibrary` y `media.deleteLibraryFile` con tipos.
- [ ] 3. **Tipo Snapshot** (`src/engines/scrapper/types.ts`): `localMediaPath?`, `mediaFilename?`, `mediaSizeBytes?`, `mediaKind?: 'video'|'audio'`, `downloadState?: 'idle'|'downloading'|'done'|'error'`, `downloadError?`.
- [ ] 4. **Servicio renderer** (`src/services/` p. ej. `scrapperMedia.ts`): `canDownload(source)`, `downloadSnapshotMedia({url,format,projectId,snapshotId})` (gate `isDesktop()`), `snapshotMediaUrl(relPath)` → `wh-media://media/<relPath>`.
- [ ] 5. **Auto-descarga al capturar** (`ScrapperEngine.tsx` ArchiveMode): al crear un recorte de fuente descargable en desktop → set `downloadState:'downloading'` → disparar descarga en background → `editSnapshot(id, { localMediaPath, mediaFilename, mediaSizeBytes, mediaKind, downloadState:'done' })` o `{ downloadState:'error', downloadError }`. No bloquea la UI.
- [ ] 6. **Reproductor + estado** (`SnapshotDetail.tsx`): si `downloadState==='downloading'` → spinner "Descargando vídeo…"; si `localMediaPath` → `<video controls>` (o `<audio>`); si `'error'` → aviso + botón **Reintentar**. Mantener `<iframe>` YouTube como fallback solo si no hay archivo local. Indicador de estado en `SnapshotCard.tsx`.
- [ ] 7. **Limpieza al borrar**: en el borrado del recorte, si hay `localMediaPath` → `deleteLibraryFile`.
- [ ] 8. **i18n** (`locales/en.ts` + `locales/es.ts`): claves `scrapper.downloading`, `downloadFailed`, `retryDownload`, `localVideo`, etc. Backfill en **ambos** locales (lección #11). Sin native prompts (lección #12).
- [ ] 9. **Verificación** (lección #1): `npx tsc -b --noEmit` (renderer) + `npm run typecheck:electron` + `npm run lint`. Si aparecen errores de truncación JSX en masa → comprobar mount stale por `stat` antes de tocar nada (lección #13). **Sin commit** — se deja para revisión (feedback: no-autocommit).

## Riesgos / notas
- Descargas grandes: la auto-descarga puede tardar/ocupar espacio; el estado `downloading` y el botón Reintentar lo cubren. (Futuro: ajuste para desactivar auto-descarga, o límite de tamaño.)
- Backups (`zipBackup`): los vídeos NO se incluyen por ahora (pueden ser cientos de MB). Anotar como decisión; reconsiderar con externalización de assets.
- Web build (no Electron): `isDesktop()` falso ⇒ se mantiene el comportamiento actual (solo enlace). Sin regresión.

## Review (2026-06-24)

### Archivos nuevos (1)
1. `src/services/scrapperMedia.ts` — `canDownloadMedia(source)`, `downloadSnapshotMedia()` (IPC), `deleteSnapshotMedia()`, `snapshotMediaUrl(relPath)` → `wh-media://media/…`, y `runSnapshotDownload(snapshot, update, format)` (ciclo completo descargando→done/error; nunca lanza).

### Archivos modificados (8)
1. `electron/main.ts` — esquema privilegiado `wh-media://` + `protocol.handle` (sirve `<userData>/scrapper-media` vía `net.fetch(file://)`, con guarda anti path-traversal `resolveLibraryPath`); IPC `media:downloadToLibrary` (downloadMedia → copia a `<projectId>/<snapshotId>.<ext>` → cleanup) y `media:deleteLibraryFile`.
2. `electron/preload.ts` — `media.downloadToLibrary` + `media.deleteLibraryFile` (+ `DownloadToLibraryResult`).
3. `src/electron-env.d.ts` — tipos de los dos métodos nuevos.
4. `src/engines/scrapper/types.ts` — `Snapshot`: localMediaPath, mediaFilename, mediaSizeBytes, mediaKind, downloadState, downloadError (sin migración Dexie).
5. `src/engines/scrapper/components/ScrapperEngine.tsx` — `handleCapture` (auto-descarga tras persistir) + `handleDelete` (limpia el archivo).
6. `src/engines/scrapper/components/SnapshotDetail.tsx` — reproductor `<video>/<audio>` (wh-media://) + estados descargando/error+reintentar; YouTube embed como fallback.
7. `src/engines/scrapper/components/SnapshotCard.tsx` — indicador de estado (descargando / reproducible / error).
8. `src/locales/en.ts` + `es.ts` — 4 claves `scrapper.*` en ambos locales.

### Verificación
- ✅ Revisión cruzada por subagente vía Read tool (archivos reales) + node_modules: APIs de Electron 33 (`registerSchemesAsPrivileged`/`protocol.handle`/`net.fetch`/`Response` global con @types/node) correctas; iconos lucide 0.575 existen; firmas preload↔electron-env.d.ts↔scrapperMedia coherentes; ternario JSX balanceado; sin imports sin usar; paridad de claves locales 4/4. **Sin defectos.**
- ⚠️ **tsc/lint NO ejecutados**: el mount bash del sandbox volvió a quedar stale/corrupto a mitad de sesión (lección #13: `main.ts` visto con fecha del 19-jun, `package.json` leído como JSON corrupto). No se actuó sobre esos falsos errores.
- ▶️ **Acción del usuario (Windows):** `npx tsc -b --noEmit` · `npm run typecheck:electron` · `npm run lint`; luego `npm run dev:desktop` y probar: pegar un reel de Instagram en Recortes → ver "Descargando…" → reproductor al terminar; borrar → archivo eliminado de `<userData>/scrapper-media`.
- 🚫 Sin commit (no-autocommit) — para revisión.

### Notas
- Requiere el binario yt-dlp (`npm run fetch:bin`) — ya parte del flujo desktop existente.
- 100% desktop: sin ramas web ni inclusión en backups (por decisión del usuario).

## Update — blindaje CPU/procesos (2026-06-24)

**Motivo:** al guardar un reel, pico de CPU (ffmpeg muxando) y riesgo de procesos huérfanos si se cierra la app a media descarga. (Nota: el "97%" que se vio era un pico transitorio; en Detalles, System Idle Process 79% = CPU al ~21%.)

**Cambios:**
- `electron/media/ytdlp.ts` — `downloadMedia(url, format, signal?)`; `runProcess` baja prioridad (`os.setPriority` BELOW_NORMAL), escucha `AbortSignal` y, al abortar, mata el **árbol** de procesos (`taskkill /pid <pid> /T /F` en Windows — mata yt-dlp **y** su ffmpeg hijo), y rechaza con `'cancelled'`.
- `electron/main.ts` — `activeDownloads: Map<snapshotId, AbortController>`; **cola de concurrencia 1** (`enqueueDownload`) para no spawnear descargas en paralelo; guard anti-duplicado; IPC `media:cancelDownload`; `abortAllDownloads()` en `will-quit` (no quedan huérfanos al cerrar).
- `electron/preload.ts` + `src/electron-env.d.ts` — `media.cancelDownload(snapshotId)`.
- `src/services/scrapperMedia.ts` — `cancelSnapshotDownload()`; `runSnapshotDownload` trata `'cancelled'` (→ `idle`) y `'already downloading'` (no-op) sin marcar error.
- `src/engines/scrapper/components/SnapshotDetail.tsx` — botón **Cancelar** mientras descarga.
- `src/locales/en.ts` + `es.ts` — `scrapper.cancelDownload`.

**Verificación:** revisión vía Read (APIs Node/Electron: `os.setPriority`/`os.constants.priority`, `AbortController`/`AbortSignal.addEventListener`, `taskkill`; cola sin fugas; tipos preload↔d.ts↔servicio; paridad locales 5/5). El mount bash siguió stale → **correr en Windows** `npx tsc -b --noEmit` · `npm run typecheck:electron` · `npm run lint`. Sin commit.

## Update — miniaturas de vídeo en las tarjetas (2026-06-24)

**Motivo:** la tarjeta solo mostraba la URL; no se distingue qué reel es.
**Cambio:** `src/engines/scrapper/components/SnapshotCard.tsx` — si hay `localMediaPath` (vídeo), la tarjeta muestra un `<video muted preload="metadata">` con el fotograma a `#t=0.5` como miniatura + overlay `PlayCircle`; fallback al `thumbnail` base64 (entradas manuales). Reutiliza `snapshotMediaUrl` y el archivo ya descargado → **cubre también los recortes existentes** sin tocar backend ni almacenar pósters. Sin commit.

**Ajuste (a petición):** mostrar la miniatura **entera en cualquier formato** (vertical/horizontal/cuadrado) → contenedor `h-56` con fondo neutro + `object-contain` (antes recortaba con `object-cover`/`aspect-[9/16]`). Grid a `grid-cols-2 md:3 lg:4`.

## Update — etiquetas (UX) (2026-06-24)

- **Guardado fiable:** `TagInput` confirma la etiqueta en curso en `onBlur` (antes solo con Enter → se perdía al pulsar Hecho).
- **Separación por coma:** teclear o pegar `,` divide en varias etiquetas (`commitInput` hace split).
- **El modal ya no se cierra al guardar:** `ScrapperEngine` ArchiveMode mostraba el spinner global en cada refresh y desmontaba el modal → ahora `loading && snapshots.length === 0` (solo carga inicial). Ver lección #16.
- **Autocompletado:** `TagInput` recibe `suggestions`; dropdown (hacia arriba, `onMouseDown` para no perder foco) con las etiquetas existentes que coinciden, navegable con flechas/Enter/Escape. `ScrapperEngine` computa `allTags` (únicas del proyecto) → `SnapshotCard` → `SnapshotDetail` → `TagInput`.
- **Búsqueda por etiquetas:** `filteredSnapshots` ahora incluye `s.tags.some(...)` además de título/url/notas/texto.
- **Autocompletado en el buscador:** el input de búsqueda muestra el mismo dropdown de etiquetas (reutiliza `allTags`, excluye el término exacto para cerrarse al elegir); al seleccionar, `setSearchQuery(tag)` filtra por ella.
- **Campo Descripción:** nuevo `description?: string` en `Snapshot` + textarea en `SnapshotDetail` (guardado `onBlur`) **encima de Notas** + claves `scrapper.description(.Placeholder)` en ambos locales.
- **Autorrelleno desde el reel:** al descargar, `yt-dlp --write-info-json` → `ytdlp.ts` lee el sidecar y devuelve `MediaMetadata` (description/uploader/uploadDate/title); el bridge (`DownloadToLibraryResult`) lo propaga; `runSnapshotDownload` rellena `description` (caption), `author` y `publishDate` (YYYYMMDD→ISO) **solo si están vacíos** (no pisa ediciones del usuario). Best-effort, y solo en descargas **nuevas** (no retroactivo a recortes ya guardados). NOTA: cambios en `electron/` requieren reiniciar `dev:desktop` (rebuild del main), no basta `Ctrl+R`.
- **Descripción legible:** el textarea de Descripción auto-crece con el contenido (`useRef`+`useEffect`, cap 360px, luego scroll) + `leading-relaxed`. Solo renderer (basta `Ctrl+R`).

## Update — fotos y carruseles de Instagram (gallery-dl) (2026-06-24)

**Motivo:** yt-dlp solo baja vídeos ("There is no video in this post"); fotos/carruseles requieren login.
**Enfoque:** para Instagram, `downloadToLibrary` intenta yt-dlp (vídeo, anónimo); si falla → **gallery-dl** con `--cookies-from-browser` (prueba Firefox/Chrome/Edge/Brave/…) y baja la foto o el carrusel a `scrapper-media/<projectId>/<snapshotId>/`.

**Archivos:** `scripts/fetch-ytdlp.mjs` (baja también gallery-dl); `electron/media/gallerydl.ts` (NUEVO — prueba navegadores, `-D`+`--write-metadata`, lista imágenes/vídeos, extrae description/uploader/date, prioridad baja+cancelación+tree-kill); `ytdlp.ts` exporta `killProcessTree`; `main.ts` (fallback yt-dlp→gallery-dl, `items[]`+`kind 'image'`, `deleteLibraryFile` recursivo); bridge `MediaItemRef`+`items[]`; `types.ts` (`mediaItems[]`, `mediaKind 'image'`); `scrapperMedia.ts` (mapea items, `deleteSnapshotMedia(snapshot)` deriva archivo/carpeta); `MediaGallery.tsx` (NUEVO — carrusel); `SnapshotDetail.tsx` (usa galería); `SnapshotCard.tsx` (miniatura 1er item + badge nº).

**Verificación:** subagente vía Read (A–H) → sin errores de tipos/lint; bridge coincide a 3 bandas; `mediaItems` persiste en Dexie.

**Prueba en Windows (no testeable en sandbox):** (1) `npm run fetch:bin` (baja gallery-dl); (2) reiniciar `npm run dev:desktop` (rebuild del main); (3) **Instagram logueado** en Firefox/Chrome/Edge/Brave; (4) capturar un post de fotos/carrusel.

**Riesgos:** depende de cookies del navegador; si ninguno tiene sesión IG → error claro. Carrusel mixto (vídeo+foto): si yt-dlp baja el vídeo, no se llega a gallery-dl. Sin commit.

## Update — login de Instagram embebido (2026-06-24)

**Motivo:** depender de cookies de un navegador externo es frágil; mejor sesión propia en la app.
**Enfoque:** ventana de Instagram embebida (NO usuario/contraseña). El usuario inicia sesión normal (2FA incluido) en una `BrowserWindow` con `partition: 'persist:instagram'`; al detectar `sessionid` se exportan las cookies a Netscape `cookies.txt` en userData. yt-dlp y gallery-dl reciben `--cookies <file>` (gallery-dl mantiene `--cookies-from-browser` como respaldo). La contraseña nunca toca el código.

**Archivos:** `electron/media/igAuth.ts` (NUEVO — `openIgLogin`/`exportIgCookies`/`igStatus`/`igLogout`/`igCookiesPath`, UA de Chrome); `ytdlp.ts`+`gallerydl.ts` aceptan `cookiesFile`; `main.ts` (refresca cookies antes de cada descarga, IPC `ig:login`/`ig:status`/`ig:logout`); bridge `instagram` en preload/env; `InstagramConnect.tsx` (NUEVO — botón Conectar/Desconectar con estado) en la cabecera de Recortes.

**Verificación:** subagente vía Read + electron.d.ts (A–H) → APIs `session`/`cookies`/`BrowserWindow` correctas, bridge coincide, JSX balanceado, sin errores.

**Prueba en Windows:** (1) `npm run fetch:bin`; (2) reiniciar `npm run dev:desktop`; (3) en Recortes → **Conectar Instagram** → iniciar sesión en la ventana → queda "Instagram ✓"; (4) capturar un post de fotos. **No testeable en sandbox** (login real). Riesgo: IG puede pedir verificación/captcha en el webview. Sin commit.

Verificación: revisión cruzada por subagente vía Read (flujo de tipos `tagSuggestions?`, `React.KeyboardEvent` en scope, JSX balanceado, paridad de locales, autocomplete y filtro) → sin errores. Mount stale → typecheck/lint en Windows. Sin commit.

---

# Full Audit — 2026-07-11

Auditoría completa + mejoras en 5 oleadas (continúa la sesión del audit anterior que quedó a medias por el mount stale). **Verificación esta vez vía Desktop Commander (shell real de Windows)**: `tsc` renderer **0 errores**, `tsc` electron **0 errores**, ESLint **71 problemas → 0 errores / 2 warnings** (preexistentes e intencionados: `useEnsureDefault`, `GoogleDocsPicker`), paridad de locales **931/931**.

## Oleada 0 — verificación de la sesión anterior
- Fixes de factories (`makeEntityHook` + race guards) y migraciones timeline/writings de la sesión anterior: **compilan limpio** (el mount saboteó su verificación, no su código).
- `RelationshipsEngine.tsx:138` (error de tipo preexistente): `onDelete` ahora es `(id) => void` (abre ConfirmDialog, no promesa).

## Oleada 1 — bugs y pérdida de datos (CRÍTICOS)
1. **`deleteProject` reescrito genérico** (`db/operations.ts`): antes borraba solo las 13 tablas originales y dejaba huérfanas ~25 tablas de engines (fugaban a búsqueda global y backlinks para siempre). Ahora barre TODA tabla con índice `projectId` (cubre engines futuros) + hijos sin índice (`yarnEdges`, `sceneCasts`, `storyboardConnectors`, `brainstormConnections`, `annotationReferences`) vía padres. También limpia la carpeta de media descargada (`cleanupProjectMedia`).
2. **Borrar proyecto pedía 0 confirmaciones** (un clic en el icono papelera = proyecto entero fuera). Ahora `ConfirmDialog` destructivo con nombre del proyecto + toast.
3. **Editor de Writings: autosave completo.** Antes: cambiar de engine por la sidebar descartaba TODO lo no guardado. Ahora: autosave con debounce 1.2s, flush en unmount/Back/Ctrl+S/beforeunload, indicador Guardado/Sin guardar, sesión de escritura registrada (ver Oleada 4).
4. Confirmaciones añadidas: borrar writing, borrar entrada de codex.
5. Diario: **Back guarda** si hay cambios (antes descartaba en silencio); entrada nueva y vacía no crea basura.
6. `useProjects`/`useProject` con guards del factory (el dashboard ya no parpadea el spinner al recolorear).
7. `dialog-scene/hooks` migrado al factory (cast + beats); `annotations/hooks` con seq/mounted guards (notas de A ya no aparecen en B al cambiar rápido).
8. **Sistema de toasts** (`components/common/toast.tsx` + host en MainLayout) y **eliminados los 8 `alert()`/`prompt()` nativos** (Dashboard ×4, TiptapEditor, FactEditor, ManualSnapshotModal, SprintTimer) — la clase exacta del data-loss del Timeline (lección #12).
9. `AiToolbar`: `useState` condicional (crash real si se activaba la IA con el panel montado) → hoisted.
10. `TiptapEditor`: `ToolButton` a module scope (los botones se remontaban en cada tecla); link por formulario inline, no `prompt()`.
11. `GoalSetter`: mutaba los goals de props en sitio → objetos nuevos; ids via `generateId`; reskin dark.
12. Electron: **IPC `fs:readFile/writeFile` eliminados** (path arbitrario sin validación, 0 callers — pura superficie de ataque); **CORS del media server restringido** (antes `*`: cualquier web podía lanzar yt-dlp local); **persistencia de ventana** (tamaño/posición/maximizado en `window-state.json`, con sanity check multi-monitor).
13. Import/export: `importFullDatabase` legacy limpia TODAS las tablas (antes 15 → huérfanos tras restore); export de proyecto de la sidebar ahora es **ZIP completo por registry** (el JSON antiguo perdía ~25 tablas silenciosamente); import de proyecto acepta `.zip` con semántica restore-in-place (borra copia local + reimporta con ids originales).

## Oleada 2 — redundancia
- `src/utils/text.ts`: `countWords`/`stripHtml` únicos (había 4 implementaciones con 2 algoritmos que **daban cuentas distintas**; `split(' ')` contaba mal espacios múltiples). Adoptado en writings, googleDocsHtmlCleaner, chronometry, pov-audit, diary EntryCard, biography FactCard/NarrativeView.
- 6 archivos muertos borrados (`useCodexEntries`, `useGallery`, `useMaps`, `useExternalLinks`, `useDownloadFolder`, `cropImage`) — por fin, vía shell real.
- `writing-stats` completo al sistema de tokens (era el único engine en tema claro) + i18n de SprintTimer/GoalSetter.
- ids ad-hoc → `generateId` (ConnectorEditor, GoalSetter).

## Oleada 3 — UX (integrada en las demás)
- Crear writing/entrada de codex **abre lo creado** (antes te dejaba en la lista a buscarlo).
- **Ctrl+S** guarda, **Esc** sale del modo concentración; **modo concentración** (oculta AI toolbar + margen, columna centrada).
- Toasts de éxito/error en import/export/borrados.
- Codex: tipos traducidos (el shadowing de `t` en el filtro renderizaba claves en inglés), filtro "Todos".

## Oleada 4 — features nuevas
1. **Compilar manuscrito** (`writings` → botón "Compilar"): selección/orden de escritos, portada y sinopsis opcionales → **Markdown / HTML imprimible / PDF real** (reusa el pipeline `export:scriptToPdf` de Electron). `manuscriptExport.ts` incluye conversor HTML→MD afinado al output de Tiptap.
2. **Export Fountain** (`dialog-scene` → botón "Fountain"): guion completo en el formato estándar que abren Final Draft/Highland/Fade In — slug/action/dialog/parenthetical/transiciones/dual dialogue (`^`)/notas `[[…]]`/escenas OMITTED. Cierra el residual del Dialog Engine feedback.
3. **Historial de versiones de writings** (Dexie **v18**, tabla `writingSnapshots`): snapshot automático al abrir cada sesión de edición + manuales + pre-restore (restaurar es reversible); poda a 25; UI con preview/restaurar/borrar; incluido en backup ZIP y en el cascade de borrado. TiptapEditor ahora sincroniza contenido externo (restore) sin pelear con el cursor.
4. **La escritura real alimenta writing-stats** (`services/writingActivity.ts`): el flush del autosave acumula palabras+tiempo en una sesión `freewrite` diaria por proyecto — antes solo contaba el sprint timer y escribir horas en el editor no movía metas/racha.

## Oleada 5 — interconectividad
1. **Red del personaje** en el detalle de codex (`CharacterConnections.tsx`): arcos, relaciones (con emoji del tipo) y escenas donde aparece, con salto a cada engine. Antes esos vínculos existían en datos pero eran invisibles desde el personaje.
2. **Búsqueda global por CONTENIDO** (`useGlobalSearch`): además de títulos, busca dentro de writings/codex/diario/diálogos con snippet «…contexto…» (filtro barato sobre HTML crudo, stripHtml solo en matches); debounce 160ms; deduplicado contra matches de título.
3. **Fallback de navegación** en Cmd+K: engines sin anchor-adapter ahora navegan a su pestaña del proyecto (antes el clic no hacía nada).
4. i18n del indicador de beats vinculados en escenas.

## Lint: 71 → 0 errores
Incluye: render-adjust pattern en ColorPicker/IconPicker/GlobalSearch/ScriptAutocomplete/ConnectorEditor/VideoPlanView/MarginPanel; `useHydratedList` con estado vacío derivado; memos manuales que hacían bail-out del compiler eliminados (InspirationGallery, GettingStartedChecklist, PovAudit `NO_ROWS`); disables documentados solo para falsos positivos (Date.now() en handlers ×4, resolveIcon, module-singleton del toast, constantes de guion).

## Pendientes sugeridos (no bloqueantes)
- Seeds: picker de `linkedWritingId` (metadato aún sin UI).
- Timeline events ↔ escenas (campo + picker).
- Montar `AnnotationSurface` en más engines (timeline, dialog-scene, outline, diary).
- Migrar los 6 dashboards forked a `CollectionDashboard` extendido (`renderThumbnail`/`getSubtitle`).
- Esc/backdrop en los modales hand-rolled restantes (BeatEditor, FactEditor, SegmentEditor, BrainstormItemEditor) o migrarlos a `<Modal>`.
- `@`-menciones en Tiptap hacia codex (extensión Mention).

**▶️ Prueba manual sugerida:** `npm run dev:desktop` → (1) borrar un proyecto de prueba (confirma + toast, sin huérfanos); (2) escribir en un writing, navegar fuera sin guardar y volver (texto intacto), Ctrl+S, historial→restaurar; (3) Compilar→PDF; (4) Recortes→Fountain en un proyecto con escenas; (5) Cmd+K buscando una frase escrita dentro de un capítulo. 🚫 **Sin commit** (no-autocommit) — todo queda para revisión.

---

# Worldgen multiscale world — full implementation

**Started:** 2026-07-27
**Constraint:** preserve the current dirty worktree and leave all changes uncommitted/unpushed.

## Specification

- A generated spatial feature keeps one deterministic identity across the world,
  regional sheet, 2D map, 3D map, Atlas, reloads, and render resolutions.
- Generated terrain and regional tiles remain derived/cacheable. Persistence
  stores only saved region definitions and compact user overrides.
- Rename, hide/remove, restore, move, and symbol/style changes resolve through
  one shared entity model before any renderer sees a feature.
- 2D and 3D use the same selection contract and inspector; renderer-specific
  copies of editing logic are not allowed.
- Dynamic resolution is split into screen DPR, mesh density, and semantic data
  detail. Increasing the base world grid is not the close-range LOD strategy.
- Regional generation is cancellable and runs outside the renderer thread
  before it is driven automatically by viewport changes.
- Existing serialized worlds and edits remain readable.

## Phase 1 — Spatial identity and editing

- [x] Add first-class landmark and regional-place edit targets with backward-compatible serialization.
- [x] Add deterministic spatial keys and one resolved spatial-entity model.
- [x] Apply landmark overrides consistently in Atlas, 2D, 3D, and regional views.
- [x] Add shared selection/inspector UI with rename, symbol/style, move, hide, restore, and linking entry point.
- [x] Add generated-landmark hit testing and placement tools in 2D.
- [x] Render and select the same landmarks in 3D.

## Phase 2 — Saved regions and regional generation

- [x] Add lightweight saved-region definitions to world persistence.
- [x] Make regional sheets renameable, bookmarkable, searchable, and reopenable.
- [x] Give regional places resolution-independent source keys.
- [x] Fix margin-aware regional pointer conversion.
- [x] Add selection/editing for regional places.
- [x] Move regional generation to a cancellable worker with an LRU cache.

## Phase 3 — Multiscale rendering

- [x] Introduce a parent-owned world viewport shared by 2D, 3D, and regional sheets.
- [x] Add semantic zoom tiers and progressive regional overlays to 2D.
- [x] Feed close-range regional elevation/surface data into 3D.
- [x] Add adaptive DPR/mesh quality with frame-budget hysteresis.
- [x] Preserve focus and selected spatial entity when switching views.

## Phase 4 — Cross-engine place foundation

- [x] Expose Worldgen spatial entities through project-aware entity resolution.
- [x] Add exact reveal actions for 2D, 3D, and regional sheets.
- [x] Let the Maps engine consume live Worldgen-backed maps/places without breaking uploaded maps.
- [x] Add reusable entity-link affordances for Codex, scenes, writings, and timeline consumers.

## Verification and review

- [x] Add regression tests for landmark edit persistence and regional identity.
- [x] Add cancellation/cache tests for regional generation.
- [x] Run renderer and Electron typechecks.
- [x] Run shipping lint, conformance, and critical tests.
- [x] Run production builds and the real renderer-startup smoke test.
- [x] Review the complete diff for accidental overlap with pre-existing work.
- [x] Refresh the project knowledge graph and document results here.
- [x] Confirm no commit or push was created.

## Review

- Google Maps-style semantic zoom now moves through planetary, continental,
  regional, and local tiers with hysteresis, feature visibility rules, label
  budgets, deterministic decluttering, and progressive regional overlays.
- Global landmarks and generated regional places share deterministic identities
  and sparse overrides for rename, move, symbol/style, label visibility, hide,
  and restore across Atlas, 2D, 3D, and regional sheets.
- Saved regions persist as lightweight bookmarks; regional data is generated in
  a cancellable worker, cached with an LRU, and blended into 2D and 3D without
  blocking or replacing the last usable view.
- Worldgen locations resolve through project search/navigation, link to Codex,
  scenes, writings, and timeline events, and synchronize into provenance-aware
  Maps records without changing uploaded maps.
- Release verification passed after implementation: renderer/Electron
  typechecks, shipping lint, 22-engine conformance, 11 critical browser/WebGL
  tests, production renderer/Electron builds, and bundle budgets.
- Manual validation exposed and fixed a cold-route race: `ProjectDetail`
  previously rejected `/worldgen` while the project hook still held its initial
  empty engine list, silently replacing the route with `/overview`. The startup
  harness now seeds a persisted project/world and asserts the real lazy
  Worldgen route remains mounted after asynchronous hydration.
- The configured session-memory graph path was unavailable on this Windows
  host, so the repository's current-state architecture companion
  `docs/PROJECT_KNOWLEDGE.md` was refreshed with the same Worldgen and Maps
  invariants.
- The worktree was reviewed with `git diff --check`; all work remains uncommitted
  and unpushed for user review.

---

# Worldgen close-zoom 3D blackout

**Started:** 2026-07-27

- [x] Reproduce and profile the close-zoom transition in the real World3D path.
- [x] Fix camera/LOD/detail synchronization so close zoom cannot render black.
- [x] Bound expensive work triggered by wheel and regional-detail updates.
- [x] Add a regression test for close camera distances and repeated zoom events.
- [x] Run the full release gate and document the verified result.

## Review

- The blackout was a CPU/GPU terrain mismatch: regional elevation displaced
  vertices in the shader, but camera clearance still sampled only base terrain.
  The shared CPU sampler now reproduces the regional blend and keeps plane and
  globe cameras outside the rendered surface.
- Close interaction keeps one stable mesh preset, bounds automatic adaptation
  to DPR, caps projected labels, throttles viewport propagation, and waits for a
  settled, padded viewport before requesting regional detail.
- WebGL context loss stops the 3D frame pump and presents the functional 2D
  sculptor instead of leaving a black viewport.
- The regression suite now traverses 32 decreasing camera distances, verifies
  finite UV windows and terrain clearance, checks seam-wrapped detail, prevents
  redundant geometry rebuilds, reads back visible WebGL pixels, and starts the
  real Vite regional worker.
- `npm run verify:release` passes: renderer and Electron typechecks, shipping
  lint, 22-engine conformance, 12 critical browser/WebGL tests, production
  renderer/Electron builds, and bundle budgets.
- The configured session-memory graph directory is unavailable on this host;
  `docs/PROJECT_KNOWLEDGE.md` was updated as the repository architecture
  companion. No commit or push was created.

# Worldgen: one world, one camera, one zoom — Google-Maps rework

**Started:** 2026-08-01 · **Approval:** full P4 + "magnum opus" mandate
**Constraint:** working tree only (no commits/pushes on this machine); every
increment individually verified in the container gate (tsc app + eslint 0
warnings) plus numeric harnesses and eyeballed PNGs before delivery.

## P0 — ride-alongs

- [x] CartoMap dropped-settle fix (pending-render ref, rAF finally re-run).
- [x] Baseline harness: PNGs + timings for carta/satellite/region/3D (A/B reference).

## P1 — one camera + navigation

- [x] `core/camera.ts`: single EARTH_KM=40075 (view-side only; region noise keeps
      its frozen 40030.17), viewport⇄carta conversions, clamps, `flightAt`
      (log-span, parabolic bow, seam short-way), `doubleClickTarget`.
- [x] Carta adopts the shared `WorldViewport` (adopt/report, 180 ms debounce,
      echo-break epsilon); wheel/pointerdown cancel flights.
- [x] Double-click = animated zoom-to-point in all three views.
- [x] Region modal off the navigation path: sheet = export/bookmark, "volar aquí".

## P2 — scale-canonical region engine

- [x] `region/tiles.ts`: canon pinned to the world grid (128@2048 ≈ 152.7 m/cell),
      supertile 4×4 world cells (~78 km), 640² grid (512² interior + 64 apron),
      exact origins, x-wrap.
- [x] Origin-seeded RNGs dead (abbey → wrapped 1/256-lattice hash — also fixed a
      latent `i += 3` stride bug; render RNG → tile id).
- [x] `region/tileClient.ts`: nearest-first cover, ≤1024² composites, interior-only
      cell-exact copy, stream/track remap, dedup.
- [x] Verified: byte-equal regen per id, overlap equality across request shapes,
      A/B canon-vs-today PNGs, ms/MB recorded.

## P3 — resolution-independent edits + live painting

- [x] Serialization 1/256 cell (identity on legacy quarter-grid points; corpus
      replay byte-identical at L0).
- [x] Canon edit replay: worker gets PRISTINE elevation + edit list, re-applies
      sculpt ops at canon res (`region/canonEdits.ts`) — no double application.
- [x] Live stroke preview in 2D (all tools) and 3D trail preview; sub-cell radii
      legal (km-labelled slider, min 0.125 cell).
- [x] Painted rivers carved at canon; biome cover overlay honours eraser contract.

## P4 — display-tile pyramid (slice 1 + tramo 2 in progress)

- [x] `cartography/tiles.ts` + `tileStore.ts`: 256 px tiles z2–z8, worker-rendered
      (OffscreenCanvas), parent-fallback compositor in CartoMap gestures —
      blurry-then-sharp, never blocking. Labels/furniture stay screen-space.
- [x] World-anchored paper grain: `PaperOptions.anchor` samples the level's
      virtual whole-sheet coordinates; vignette skipped for tiles. Tonal step
      across joins measured Δ mean luminance **0.00** (was a visible band).
- [x] Position-keyed ink: wobble noise hashed from WORLD position (coast +
      lakes), paper tooth hashed from virtual-sheet pixel, tone lattice
      phase-aligned to the level. New harness assert: a tile is pixel-equal to
      its half of a monolithic render — 0.005/0.012 mean |Δ| (residue is
      Skia clip-AA on edge-crossing glyphs, documented; every LOGIC leak
      measures 0.000 exactly).
- [x] Culling: coast X+Y, lakes, river bbox, road bbox, windowed borders
      (O(view) instead of O(grid)) — borders+roads tile cost 34→17 ms.
      Relief/forest cull pads now cover the tallest glyph (edge-pop fix).
- [x] DEEP ZOOM GROUNDWORK (the renderer side): the pliego renderer now inks
      identically in any window over the same ground — vegetation on a global
      hash lattice (position + private per-symbol shape streams), furrows by
      parcel centroid, buildings by place identity, fixed contour interval
      per level, dash phase carried through window cuts, window-cut chains
      exempt from speckle culls, cartouche off tiles, paper level-anchored.
      Plus `region/composeWindow.ts`: exact canon-lattice window composer
      (with fields/hedges/dykes; streams/ways smoothed once in cell space
      before clipping). Root-cause bonus: chain stitching in contours.ts was
      forward-only and split chains at scan-order seeds — now bidirectional,
      which also removes latent split-kinks from every pliego/carta line.
      Measured: two overlapping windows, shared ground mean |Δ| **0.001**
      (was 2.262), one hot pixel; 2×2 mosaic seam == off-seam; 120-195 ms
      per 256px tile with canon warm; pliego A/B clean (line realization
      only). Harness: harness-p4/deep-tiles.ts.
- [x] Deep zoom WIRED (region/deepTile.ts + worker branch + CartoMap):
      z10-z12 tiles draw the canon countryside pliego-style — canon supertile
      LRU (cap 3) per worker session, exact-window compose, strokes re-applied
      at canon over the PRISTINE world (CartoMap gets canonWorld/canonEdits
      from WorldView's canonSource; carta levels keep the edited raster).
      MAX_TILE_Z=12 (~38 m/px), contour ladder 100/50/25 m per level, camera
      cap derived from the ladder (z12 with canon behind it, z9 without —
      the camera stops where the data stops). Verified on the SHIPPING
      renderDeepTile: adjacent z11 tiles join, cache reuse, 220-250 ms warm;
      window-identity 0.001 remains the hard proof. Style handover at z9/z10
      = the existing parent-fallback fade (carta blurs up, sheet sharpens in).
- [x] Deep zoom polish: regional place NAMES ride the tile replies (interior-
      only, no dedup needed) and are lettered live under their buildings
      (declutter budget 64, town/village/rest type ramp); world settlement
      MARKS stand down at deep z. Verified end-to-end in deep-tiles §4
      ("Majada de Iesgiring" reported with world coords).
- [x] Pool session AFFINITY: a busy session matching the requested world is
      waited for, never duplicated (a z10 burst used to clone a second 80 MB
      world and regenerate the same canon ground twice); two different worlds
      still coexist under the cap. pool-test: 1 spawn per 14-burst, warm
      reuse on return.
- [x] SATELLITE WINDOW (Map2D atlas): past 2.5× the settled view renders one
      pixel per screen pixel — bilinear fields, per-pixel hillshade, sub-cell
      coastline, land colours never bleed ocean blue. Kills the 28× nearest-
      neighbour cliff on the primary painting surface. Identity at 1:1 vs the
      cell raster: mean |Δ| 0.07. (satwin-test + satwin-live in Chromium.)
- [x] LIVE TERRAIN SCULPT on the satellite: terrain/land strokes run the same
      SculptGesture as 3D/sculptor — ground deforms under the brush per move
      (palette dirty-rect + sharp-window subrect on the same sample lattice),
      rollback-then-commit on release. Chromium: corridor Δ20.4 mid-drag,
      exactly one edit.
- [x] LIVE BIOME PAINT on the satellite: restore-then-restamp per move with
      EXACTLY applyEdits' overlay rules (filterFor/restriction shared);
      biome-parity.ts proves live≡replay cell-exact (0/2239). Rollback
      residue 0.00 in Chromium. Eraser keeps the polyline preview (only the
      session knows the pre-overlay biome). Live paths arm only when a fresh
      sharp window can show them — everywhere else the classic preview stays.
- [ ] Sub-canon stream meanders (L2+ amplification, future).
- [ ] Placement budget caps per tile (only if profiling asks).
- [x] LIVE LETTERING: labels + settlement marks are screen entities drawn on
      EVERY frame (gesture and settle) through one `drawLettering` path — the
      tiles, the whole-world blit and the settled sheet no longer bake type,
      so names move with the ground, never pop on settle, never double under
      a zoomed blit, and marks stop stretching under ancestor fallback.
      Browser-verified (labels-live.mjs): mid-gesture ink density ≥ settled;
      overlay costs 3.2 ms/frame (assert < 8). Explicit quarter-octave bucket
      cache + `nextSemanticTier` hysteresis: deferred until a profile shows
      the per-frame solve mattering (it re-solves stably today).
- [x] Satellite sharpness for Map2D — via the settled WINDOW render (above),
      no tile pyramid needed for the 2D after all.
- [ ] Delete `glsymbols.ts` (zero importers).

## P5 — 3D real close-up

- [x] Root cause of the "noise": vertex aliasing (mesh point-sampling the 150 m
      canon field) — band-limited via `uDetailDisp`; per-pixel resolvability gate
      picks the lighting texel; micro detail relief-gated and deferred below
      canon; canon albedo (`regionAlbedoCanvas`) gutter-blended at close range.
- [ ] Perf gate ON THIS MACHINE: wheel-descent + orbit sweep, p95 ≤ 33 ms
      sustained, no frame > 120 ms. Fallback ladder ends at raising
      `MIN_SPAN_KM` in `core/camera.ts` (the agreed "scrap" outcome).

## Hotfixes (user-reported, fixed + regression-guarded)

- [x] TDZ mount crash ("Cannot access 'session' before initialization"): ref
      moved above the memo; permanent WorldView mount smoke added (the gap was
      harnesses never mounted WorldView itself).
- [x] "Render process gone" after regenerate: unbounded worker spawn (~80 MB
      world clone each) → hard session cap 2 + FIFO waiters + idle eviction;
      burst of 14 → peak 2.
- [x] Strokes surviving regenerate: same seed keeps strokes (parameter tweaks),
      NEW seed clears the edit list and persists `[]`.
- [x] Frankenworld one-frame mismatch: sessionWorld ref gate in canonSource.
- [x] Pool "reuse inefficiency" was a test artifact: harness fake geography
      lacked `languages.living`, so every spawn threw and nulls passed a lax
      assert. Fake fixed, assert hardened; pool proven (2 spawns / 14 requests).

## Pending decisions / on-device work

- [ ] `npm run verify:release` + 32-distance 3D regression suite on this machine.
- [ ] 2D-view convergence (Luis deciding): recommendation = keep 2D for now
      (distortion-free brush, projections, WebGL fallback); converge later via
      ortho top-down mode in World3D.
- Minor: 2D live terrain sculpt via windowed renderBaseRect; live biome channel
  via SculptSurface.patch; canon biome overlay ignores slope filter
  (documented); painted river names only when matching a named world river.

---

# Worldgen 2D: zoom continuo con terreno, caminos y ciudades

**Started:** 2026-08-14
**Mandate:** prioridad absoluta a funcionamiento tipo Google Maps; se permite
reemplazar la arquitectura actual. Preservar el trabajo local no relacionado y
dejar los cambios sin commit/push salvo petición expresa.

## Especificación verificable

- [x] Una sola cámara (`centro + zoom`) gobierna cobertura, resolución y
      transformación de todas las capas 2D.
- [x] Al cruzar cualquier nivel de zoom nunca aparece un hueco: se conservan el
      raster base, la ventana nítida y los antepasados residentes hasta que
      llega la tesela ideal.
- [x] El terreno se solicita por el plan visible vigente, priorizado desde el
      centro, sin sesiones huérfanas ni peticiones bloqueadas para siempre.
- [x] Ríos, caminos y ciudades usan las mismas coordenadas mundiales y la misma
      transformación que el terreno; no dependen del contenido efímero de una
      tesela para seguir visibles.
- [x] El zoom lejano conserva generalización y decluttering; el zoom cercano
      añade detalle sin cambiar identidades ni desplazar geometría.
- [x] El mapa queda inactivo cuando converge: cero cola/vuelo permanente y cero
      renacimientos en reposo.

## Plan

- [x] Diagnosticar capturas, log y flujo cámara → cobertura → servicio → tienda
      → composición → lettering.
- [x] Contrastar el código actual con `INVESTIGACION-MAPAS.md` y fijar el diseño
      mínimo de referencia.
- [x] Sustituir el transporte con estado restante por una granja/cola estable
      orientada a contenido y al plan visible.
- [x] Unificar la composición de terreno, caminos y asentamientos en el mismo
      sistema de coordenadas y ciclo de render.
- [x] Añadir regresiones de zoom quieto, zoom continuo, retención, caminos y
      ciudades, incluyendo la vía real del navegador.
- [x] Verificar typecheck, lint dirigido, bancos worldgen, arranque real y las
      capas cartográficas en varios niveles de zoom.
- [x] Actualizar arquitectura y esta revisión con resultados medidos.
- [ ] Refrescar el grafo de memoria de la aplicación: bloqueado porque la ruta
      de sesión indicada por la habilidad (`/sessions/festive-cool-keller/...`)
      no existe en este entorno y no hay copia local que actualizar.

## Review

- Causa directa del `0/N`: React StrictMode desmontaba el efecto y dejaba a
  `Map2D` reutilizando un `DisplayTileStore` ya desechado; cada bitmap que
  llegaba se cerraba. El almacén pertenece ahora al efecto que lo destruye.
- Un nuevo plan cancela trabajo obsoleto de **todos** los niveles; el 3D declara
  suelo y nitidez juntos. El zoom ya no deja una procesión de niveles viejos
  delante de la cámara actual.
- Identidad y persistencia son por contenido de mundo + geografía + profundidad
  + ediciones. Las escrituras tardías ya no pueden reemplazar otra versión.
- Las metateselas canon compartidas se construyen en *single-flight* global y
  el disco se consulta antes de ocupar un worker. En el log original, 130
  construcciones eran sólo 53 únicas (77 repetidas, 61 % de desperdicio).
- Contrato de capas 2D: teselas = terreno/agua/campos; pantalla = carreteras,
  ciudades principales/rótulos y río de respaldo. La tesela exacta sustituye
  el río de respaldo cuando llega, pero una carga nunca deja el mapa sin él.
- Pruebas nuevas verdes: plan/retención StrictMode, contrato de capas, tinta de
  ríos, carreteras en todos los niveles y canon compartido (cada metatesela se
  genera una sola vez). También pasan `verify:quick`, las 12 pruebas críticas
  y el build de producción.
- La previsualización local del Browser integrado se abrió, pero ese entorno no
  ejecutó los scripts de la página; la validación dinámica se realizó con los
  bancos Chromium/TypeScript del proyecto y el arranque Vite de la suite crítica.
- Cambios deliberadamente sin rama, commit, staging ni push.

---

# Worldgen 2D: continuidad visual, ciudades, bosques y arranque

**Started:** 2026-08-14

## Especificación verificable

- [x] La costa, ríos, relieve y biomas conservan la misma silueta al cambiar de
      nivel; acercarse añade detalle, no sustituye el territorio por otro.
- [x] Las ciudades visibles se representan físicamente con su huella urbana y
      edificios sin requerir clic, hover ni otra interacción.
- [x] Los bosques cercanos no exponen bordes de celda ni bandas rectangulares
      entre teselas.
- [x] La primera entrada a 2D pinta inmediatamente un estado de carga y mantiene
      respuesta visual mientras se preparan los datos pesados.

## Plan

- [x] Medir el nuevo log y localizar cada cambio de fuente cartográfica.
- [x] Unificar el contrato de LOD para que todas las escalas deriven de la misma
      geografía y sólo cambie su filtrado/detalle.
- [x] Hacer que la tinta urbana sea una capa visible estable y deduplicada.
- [x] Suavizar la máscara forestal en coordenadas mundiales, con continuidad de
      borde entre teselas.
- [x] Añadir el estado inicial de carga antes de cualquier trabajo síncrono.
- [x] Añadir regresiones y verificar navegador, bancos, typecheck y build.
- [x] Documentar resultados y actualizar el grafo del proyecto si está disponible.

## Review

- El log nuevo probó que el transporte estaba sano (830 teselas entregadas,
  cero errores) y que el supuesto “freeze de teselas” era un cálculo de
  geografía de 26,86 s ejecutado en callbacks del hilo visual. Ahora vive en un
  worker, se deduplica y conserva la geografía anterior mientras recalcula.
- Una sola costa sirve atlas, satélite y canon. La comparación dibujada queda
  en 99,9 % de IoU atlas→satélite y 99,8 % satélite→canon; el desacuerdo es
  0,07 % y 0,06 %. El canon medido discrepa 0,0 % del agua mundial.
- La ciudad estaba desplazada media celda: a z17 eran 5.434 px. El ancla común
  corrige marcador, mancha, lugar y plano. El banco encuentra tinta urbana a
  z10/z12/z14/z16 y plano de calles a z16 sin interacción.
- La máscara forestal y las copas comparten deformación mundial. La prueba
  cercana registra 5.669 px vegetales y 21 px de variación p10–p90 en el borde,
  en lugar de una arista de celda.
- Navegador real: primera entrada 2D en 700 ms, spinner visible inmediatamente,
  resultado completo (120 ruinas) y cero errores tras terminar. La primera
  prueba descubrió y permitió corregir la familia lingüística no clonable del
  worker; se repitió desde una sesión limpia.
- Verificación verde: `verify:quick`, `test:critical` (12/12), build de
  producción, presupuesto informativo, contratos de capas, servicio de
  teselas, caminos, ciudades, cohesión LOD y cliente de geografía.
- El refresco del grafo se intentó al final, pero la ruta obligatoria de la
  habilidad (`/sessions/festive-cool-keller/mnt/.auto-memory`) no existe en
  este entorno; la arquitectura local sí queda actualizada.
- Sin rama, commit, staging ni push.

---

# Worldgen 2D: jerarquía física de los ríos

**Started:** 2026-08-14

## Especificación verificable

- [x] Un río mundial conserva en el canon profundo la misma categoría de
      anchura que tenía en el mapa lejano.
- [x] Los afluentes y arroyos locales siguen siendo estrechos: heredar la
      magnitud mundial no engorda por error cualquier cauce que confluya con él.
- [x] La diferencia entre un río principal y un arroyo se mantiene legible en
      varios niveles de zoom, usando metros reales más un mínimo perceptivo.

## Plan

- [x] Trazar la pérdida de caudal mundo → canon → tinta y fijar un único
      contrato físico.
- [x] Propagar la magnitud mundial sólo por el tronco que realmente coincide
      con el río original.
- [x] Invalidar canon y entintado incompatibles y añadir una regresión de
      jerarquía multizoom.
- [x] Verificar bancos, tipos, build y navegador real.
- [x] Documentar el resultado y refrescar el grafo si está disponible.

## Review

- La pérdida no era subjetiva: para un mundo 2048, el río máximo pasaba de
  2.220 m en la vista mundial a unos 20 m en canon (111× más estrecho); caudales
  medios perdían entre 200× y 427× al renormalizarse por metatesela.
- `riverScale.ts` fija una ley física compartida. Cada tronco canon transporta
  el `worldFlow` original y una clave por contenido; los cauces locales siguen
  midiendo por su propia cuenca.
- En confluencias gana el candidato de mayor caudal, se exige solape mayoritario
  y una clave sólo puede tener un ganador. El banco real encontró un único
  tronco de 2.220 m y 16.378 cauces locales, sin contagios ni duplicados.
- La relación principal/arroyo se mantiene a 1.000, 100 y 10 m/px. El mismo
  banco prueba igualdad exacta entre anchura mundial y profunda.
- Se invalidaron canon (v3) y entintado (v4). La ida y vuelta real de un canon
  de 21,47 MB preserva todos los streams byte a byte y es estable al recodificar.
- Verificación verde: `verify:quick`, `test:critical` (12/12), build de
  producción, typecheck, banco de jerarquía y banco de persistencia. El Browser
  integrado cargó 12/12 teselas profundas a z16 sin huecos ni errores.
- El grafo de memoria no pudo actualizar su catálogo: la ruta obligatoria de la
  habilidad (`/sessions/festive-cool-keller/mnt/.auto-memory`) no está montada
  en este entorno. El contrato sí queda recogido en `ARQUITECTURA-TESELAS.md`.
- Cambios locales sobre `main`, sin rama, commit, staging ni push.

---

# Worldgen 2D: cartografía fluvial y urbana sin artefactos

**Started:** 2026-08-14

## Especificación verificable

- [x] Un río principal conserva jerarquía sin ocupar kilómetros de anchura ni
      mostrar orillas matemáticamente lisas en primer plano.
- [x] Los cauces locales no producen familias de líneas horizontales/verticales
      largas ni segmentos rectos nacidos en límites de tesela.
- [x] Un río que cruza la costura cilíndrica levanta el lápiz: nunca aparece una
      línea horizontal que atraviese el mundo lejano.
- [x] Las ciudades mantienen edificios, calles, muralla y barrios sin una
      silueta clara opaca que tape el terreno circundante.

## Plan

- [x] Medir anchuras, discontinuidades y rectitud en las cuatro rutas de dibujo.
- [x] Sustituir el trazo uniforme del tronco por una escala plausible con orilla
      determinista en coordenadas mundiales.
- [x] Cortar correctamente la costura y filtrar hidrología local degenerada.
- [x] Integrar el plano urbano con el albedo en vez de rellenar toda su huella.
- [x] Añadir regresiones y verificar navegador, bancos, tipos y build.
- [x] Documentar resultados, actualizar el grafo si existe y limpiar temporales.

## Review

- La anchura mundial deja de ser lineal y constante: usa caudal por celda y una
  curva convexa de 24–700 m. A corta distancia se rellena un polígono de orillas
  asimétricas, determinista y estable al cambiar de zoom; en vista lejana sólo
  queda un mínimo cartográfico jerarquizado.
- La hidrología D8 regional vuelve a ser estrictamente local. Se eliminó la
  segunda inyección del caudal mundial, se corrigió la herencia de cuenca en
  confluencias, se añadieron desempates de pendiente y se descartan rayas
  cardinales degeneradas.
- La costura se detecta en las celdas fuente, no en píxeles de una vista. El
  atlas completo ya no puede unir extremos del cilindro con una línea azul.
- El plano de una ciudad conserva edificios, calles, bloques y muralla, pero no
  rellena su Voronoi con pergamino ni tintes de barrio. `tile-ink` registra 0 px
  de suelo claro opaco en z10, z12, z14 y z16.
- Verificación: navegador real en z2 y z15; `river-width`, `river-hierarchy`,
  `tile-ink`, `map2d-layer-contract`, `satellite-handoff`,
  `satellite-lod-cohesion` y `canon-persist` verdes; `verify:quick`, 12 pruebas
  críticas y build de producción verdes.

---

# Worldgen 2D: continuidad real del tronco fluvial

**Started:** 2026-08-14

## Especificación verificable

- [x] Mientras cargan teselas profundas, el terreno de respaldo no contiene
      ríos rasterizados que se conviertan en manchas al ampliarse.
- [x] El río vectorial provisional conserva recorrido y grosor legibles.
- [x] La tesela cargada dibuja exactamente el mismo tronco mundial, no un cauce
      local cercano al que una heurística haya prestado su magnitud.
- [x] La transición provisional → exacta no desplaza, corta ni sustituye el río.

## Plan

- [x] Trazar las dos capas visibles en las capturas y cuantificar su desacuerdo.
- [x] Separar el terreno raster de toda tinta fluvial ampliable.
- [x] Hacer del vector mundial recortado la geometría autoritativa del tronco
      dentro del canon; la hidrología local sólo añade tributarios.
- [x] Añadir regresiones de recorrido, clipping y carga.
- [x] Verificar navegador, bancos, tipos y build; documentar el resultado.

## Review

- Las capturas contenían dos defectos independientes. El respaldo era el raster
  mundial de ríos estirado con suavizado al ampliar, de ahí la mancha azul
  gigante; la línea final era un cauce D8 local que coincidía por casualidad con
  el tronco y reclamaba antes su clave y caudal.
- El atlas equirectangular dibuja ahora una única capa vectorial mundial después
  de todo el terreno. Las teselas y sus ancestros no hornean troncos ampliables;
  el canon sólo añade arroyos locales bajo esa capa.
- El canon recibe directamente la polilínea tallada del mundo. Se eliminó la
  inferencia por proximidad y la composición no vuelve a suavizar el tronco.
  La regresión real compara todos sus puntos, no sólo identidad o anchura:
  16.380 cauces = 1 tronco mundial exacto + 16.379 locales, principal de 2.220 m.
- Navegador real a z10 (68 px/celda): con 0/20 teselas el río ya era nítido y
  con 20/20 conservó el mismo recorrido; ninguna entrega tardía lo sustituyó.
  La costa cambió sólo de nivel de detalle bajo la capa fluvial.
- Persistencia verde: canon de 21,52 MB, 6.427 streams idénticos tras
  encode/decode y recodificación byte-estable. Handoff de costa: 99,9 % de IoU
  atlas→satélite y 99,8 % satélite→canon.
- Verificación verde: `verify:quick`, `test:critical` (12/12), build de
  producción, bancos de jerarquía fluvial, contrato de capas, persistencia,
  tinta profunda, handoff satélite y cohesión LOD.
- El refresco del grafo se intentó al final, pero la ruta exigida por la
  habilidad (`/sessions/festive-cool-keller/mnt/.auto-memory`) no está montada
  en este entorno; el contrato vigente queda actualizado en
  `ARQUITECTURA-TESELAS.md`.
- Cambios locales sobre `main`, sin rama, commit, staging ni push.
