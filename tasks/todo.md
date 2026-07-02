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
