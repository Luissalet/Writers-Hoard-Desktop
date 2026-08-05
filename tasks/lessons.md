# Lessons Learned

## 22. Desktop launchers must consume Vite's resolved URL
**Date:** 2026-07-27
**Context:** The engine `lazy` import ordering bug was fixed and the current Vite
renderer served the corrected module, but the user still saw the exact old
exception. A stale server had occupied port 5174, so Vite correctly started the
new renderer on 5175 while the Electron command independently waited for and
loaded hard-coded port 5174. Electron therefore opened the stale application.
**Rule:** Never coordinate Vite and Electron through a guessed fixed port or a
bare TCP readiness check. Start Vite from the desktop launcher, read
`server.resolvedUrls`, pass that exact URL through `ELECTRON_RENDERER_URL`, and
own both lifecycles in the same process so closing the app also closes Vite.

## 21. A successful build is not an application-startup test
**Date:** 2026-07-27
**Context:** The release gate passed typechecks, lint, conformance, data-level Electron tests, and production bundling, but the actual app opened to a black screen. A bulk lazy-loading edit had placed `import { lazy } from 'react'` after its first use in every engine index. TypeScript and Rollup accepted the modules, while Vite's development transform exposed a temporal-dead-zone `ReferenceError` before React mounted.
**Rule:** After changing module initialization, registration side effects, routing, or lazy imports, launch the complete renderer entry and assert that the root UI mounts without `pageerror` or console errors. Keep imports before executable module code even where ESM grammar technically permits later declarations. Data-level tests and successful bundling do not replace an application-startup smoke test.

## 20. Choose the platform from the integration target, not the tool at hand
**Date:** 2026-07-24
**Context:** The world generator almost started as a Unity (C#) project — an empty Unity template already existed for it. The stated end goal was "plug it into Writers Hoard", which is Electron + React + TS; a Unity build can never embed there cleanly (separate process or 30-80MB WebGL iframe, no shared Dexie/UI, two languages forever). Building the engine as pure TS in a Web Worker hit the perf bar comfortably (1024×512 planet with ~30 erosion iterations ≈ 3s).
**Rule:** Before picking a stack for a new subsystem, name the system it must ultimately live inside and check what that system is made of. "Most powerful engine" loses to "same runtime as the host" unless measured numbers prove the host runtime can't do the job. Prototype the hot loop and measure before reaching for a second runtime.

## 19. One-shot effects that own a resource must be re-runnable under StrictMode — guard with the cache, not a ref flag
**Date:** 2026-07-24
**Context:** Worldgen auto-generation used `useRef(false)` as a "run once" guard around an effect that spawns a Web Worker, while the hook's cleanup terminates the worker. StrictMode's mount→cleanup→remount cycle kept the ref `true` (refs persist), so the cleanup killed the worker and the guarded effect never respawned it — generation hung at 0% forever, only in dev.
**Rule:** If an effect's cleanup destroys the resource the effect creates (worker, socket, subscription), the effect must be safe to run again after cleanup. Never use a ref flag as a once-guard around resource creation; make the operation idempotent-by-cache (cache hit → instant no-op) or key the effect on stable identity (`[generate]` per entity id). This is the resource-owning sibling of lesson #17's render-adjust pattern.

## 18. When the sandbox mount goes stale, verify through Desktop Commander (real Windows shell)
**Date:** 2026-07-11
**Context:** Two audit sessions in a row, the bash sandbox mount served truncated copies of files written that same session ("Invalid character" on every column past EOF, `'}' expected` mid-file — lesson #13's signature). The previous session died unable to verify its own correct code; the fix was never the code. This session ran `npx tsc -b --noEmit`, `tsc -p electron/tsconfig.json` and `eslint` via the Desktop Commander MCP (`start_process` on powershell.exe in the real repo path) and verification was instant and truthful all session.
**Rule:** File tools (Read/Write/Edit) always see the real filesystem; only the bash sandbox lies. When mount staleness appears — or preemptively for any verification gate — run typecheck/lint through Desktop Commander on the real Windows path instead of sandbox bash. Also: `Remove-Item` there deletes files the sandbox can't (supersedes the lesson-#4 workaround), and `eslint --format json` + a small `node -e` reducer gives compact, parseable results.

## 17. React Compiler lint: fix the pattern, don't fight the rule
**Date:** 2026-07-11
**Context:** Clearing 71 lint problems surfaced recurring compiler-rule classes: `set-state-in-effect` for prop→state syncs, `static-components` for components created inside render (Tiptap's ToolButton remounted per keystroke and lost focus), `preserve-manual-memoization` for stale manual `useMemo`/`useCallback`, and `purity` for `Date.now()` in submit handlers (false positive).
**Rule:** (1) Prop→state sync belongs in the render-adjust pattern (`const [prev, setPrev] = useState(x); if (prev !== x) { setPrev(x); …sync… }`), not an effect. (2) Never declare a component inside another component's body — hoist to module scope; for dynamic icon components, `useMemo` the reference and disable the rule with a comment if it still fires. (3) When the compiler says it can't preserve manual memoization, DELETE the manual memo — it's bailing out the whole component. (4) `Date.now()`/`generateId` in real event handlers are safe: hoist to one `const now` and add a documented `eslint-disable-next-line react-hooks/purity`. (5) Empty states for keyed fetch hooks should be DERIVED in the return (`items: key ? items : EMPTY`), not set synchronously in the effect.

## 16. `loading` from makeEntityHook flips on every refresh — don't gate the whole view on it while a modal is open
**Date:** 2026-06-24
**Context:** The Scrapper detail modal closed itself every time the user added a tag. Root cause: `editItem` (makeEntityHook) does `await updateFn` then `await refresh()`, and `refresh()` sets `loading=true`. The engine view did `if (loading) return <EngineSpinner/>`, so each edit briefly replaced the whole subtree (grid + the open `<SnapshotDetail>` modal) with the spinner; when loading cleared, `SnapshotCard` re-mounted with `isDetailOpen=false` → the modal closed mid-edit. The tag had actually saved — it just looked like "Enter closes the modal".
**Rule:** A full-view `if (loading) return <Spinner/>` must only fire on the INITIAL load, never on post-edit refreshes. Gate it on `loading && items.length === 0` (or a dedicated `initialLoading` flag). Any engine that (a) renders a detail/edit modal inside the list and (b) saves via `editItem` is exposed to this — the modal's open state lives in the child component and is lost on unmount. Audit other engines for the same `if (loading) return` pattern.

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

## 18. Startup smoke tests must navigate the changed lazy route with realistic persistence
**Date:** 2026-07-27
**Context:** The generic renderer startup test passed while opening Worldgen in the real project redirected silently to Project Cockpit. The test proved only that the application root mounted; it never waited for persisted project preferences and navigated the actual lazy Worldgen route.
**Rule:** After changing an engine root or its navigation contract, add a route-level smoke test that seeds a realistic project/world, opens `/project/:id/<engine>`, waits through async project hydration and lazy import, and asserts the engine remains active. A root-mount assertion is not evidence that a specific engine route works.

## 19. A shader compile test is not a 3D interaction test
**Date:** 2026-07-27
**Context:** The regional-detail shader compiled and rendered once in the critical suite, yet repeated close-range wheel zoom in the real World3D view blocked the main thread and left the viewport black.
**Rule:** Changes to interactive 3D LOD must be tested across camera-distance thresholds with repeated wheel/control updates. Assert finite camera/UV state, visible terrain, bounded geometry rebuilds, and recovery after detail changes; one successful static shader render does not cover the render-loop lifecycle.

## #21 — Medir el renderizador no es medir la vista

2026-08-04. Entregué la capa de caminos del 2D con un banco que la medía contra
`buildHumanGeography(world, params, 'full')` y daba 2,0-2,4 % de tinta en tres
escalones de zoom. En la aplicación dibujaba NADA: `WorldView` pedía profundidad
`'places'`, donde `roads` es `[]`. El renderizador era correcto y la vista lo
estaba matando de hambre, y ninguno de los dos ficheros lo delataba por separado.

**Regla**: un banco tiene que consumir sus entradas por el MISMO camino que la
aplicación. Si la vista pide los datos a través de una caché, una profundidad o
un selector, el banco pide por ahí también — o el banco mide otro programa.

**Cómo aplicarlo**: antes de dar por buena una capa nueva, buscar quién le pasa
los datos en la aplicación real y comprobar ESE valor. Cuando la comprobación no
se pueda hacer en un banco (React, canvas), dejarla en `scripts/check-conformance.mjs`
como invariante de código — que es donde está ahora la de esta cicatriz.

## #22 — Revisa adversarialmente tu propio arreglo, no sólo el código que tocas

2026-08-04, segunda pasada sobre el modo 2D. De los hallazgos graves, **ocho eran
regresiones introducidas por la pasada anterior**, verificada en su momento con
tsc, eslint, conformance y dos bancos en verde. Los bancos medían lo que yo había
decidido medir.

Los dos peores compartían forma: **un cambio correcto en su intención, aplicado un
nivel demasiado arriba.** Saltarse el DIBUJO de la ciudad cuando las teselas ya la
dibujan es correcto; saltarse el BLOQUE se llevó por delante los impactos y con
ellos el plano de ciudad, el pincel Camino y el selector de viaje. Quitar la
supresión de la pirámide durante un trazo es correcto; hacerlo sin mirar el ORDEN
de dibujado dejó al pincel más ciego que antes — y escribí un comentario
afirmando lo contrario, que es peor que no comentar.

**Regla**: después de un cambio grande, una pasada adversarial sobre el propio
cambio, mecanismo por mecanismo, antes de darlo por bueno. Y cuando un comentario
afirme un orden o una invariante, comprobarla leyendo el código que la implementa,
no la intención con la que se escribió.

**Y sobre los bancos**: el banco de fronteras muestreaba cuatro spans y ninguno
era la vista con la que el mapa ABRE. Justo ahí la capa costaba 15 ms por
fotograma. Un banco que sólo prueba los casos que se te ocurrieron al escribirlo
mide tu imaginación. Incluye siempre el estado inicial y el estado por defecto.

## #23 — Un arreglo que no llega a la vía barata no llega a nadie
**Fecha:** 2026-08-05
**Contexto:** El pincel de fronteras estaba entero: vocabulario de edición,
rasterizadores, cuatro gestos, panel, tinte, línea. Los bancos daban todo en
verde porque llamaban a `buildHumanGeography` directamente. En la aplicación no
pintaba nada. `patchGeography` — lo ÚNICO que corre tras soltar el pincel —
devolvía `base.realmOf` intacto; la pasada completa que sí habría aplicado la
capa cuesta 19 s y está deliberadamente suprimida mientras haya un pincel en la
mano. La herramienta funcionaba en toda su longitud salvo en el último metro.
**Regla:** Cuando una función tiene un camino caro y otro barato, el banco tiene
que recorrer el BARATO, porque es el que corre de verdad. Escribe la prueba
como la vive el lector: aplica la edición, sube la revisión, vuelve a pedir lo
mismo, y comprueba que lo pedido cambió. Y comprueba también el DESHACER: una
capa que llega pero no se puede levantar es peor que una que nunca llegó.

## #24 — Fusionar segmentos cambia la pregunta que hace el recorte
**Fecha:** 2026-08-05
**Contexto:** `mergeRuns` fusionó 9 939 aristas de una celda en 5 781 tramos
largos — mismo dibujo, una fracción de las llamadas. El recorte de
`drawRealmBorders` seguía preguntando `ax < x0 || ax > x1`: correcto cuando cada
entrada medía una celda, y exactamente al revés cuando mide veinte. Descartaba
el tramo que ATRAVIESA la ventana, que es justo el que miras cuando te acercas a
una frontera. Invisible a escala planetaria (todo cabe), total a 40 km (nada
cabe). La tinta a 200 km pasó de 0,062 % a 0,344 % al arreglarlo.
**Regla:** Cuando cambies la GRANULARIDAD de una estructura, repasa todo lo que
la filtra. Contención y solape son la misma prueba mientras el elemento sea un
punto, y dejan de serlo en cuanto tiene longitud. El banco que lo caza no mide
"cuántos se dibujan" sino "¿se ve ESTE, el que cruza la vista?".

## #25 — Una capa apagada por defecto es una herramienta que no existe
**Fecha:** 2026-08-05
**Contexto:** `cartoLayers.borders` arrancaba en `false`, y es la capa donde la
herramienta de fronteras dibuja TODO: la línea y el tinte. El lector escogía
Frontera, elegía país, arrastraba, veía la previsualización seguir al puntero —
y lo confirmado caía en una capa oculta. Cada trazo funcionaba. No aparecía
nada. El interruptor existía, dos botones más allá del retículo y con el mismo
icono que él.
**Regla:** Una herramienta enciende la capa en la que escribe. No hay lectura de
"he cogido el pincel de fronteras" bajo la cual quiera las fronteras ocultas. Y
dos interruptores contiguos no comparten icono: si dos cosas se dibujan con el
mismo dibujo, para el lector son la misma cosa.

## #26 — Un banco que sólo cuenta no encuentra nada
**Fecha:** 2026-08-05
**Contexto:** El generador de ciudades llevaba cinco bancos: milisegundos,
recuentos de manzanas, edificios, puertas, torres, avenidas, puentes; la
centralidad de la catedral; el alargamiento del contorno; determinismo. Todo
verde siempre. El primer banco que midió CALIDAD del trazado — `city-quality` —
encontró a la primera que la mitad de las casas de cada pueblo no tenía salida
rodada, que 39 de 42 avenidas se estrangulaban por debajo del ancho de un carro
y que 5 de 38 puertas eran inalcanzables desde el mercado. Y el barrio 'puerta',
que no se asignó jamás en ningún pueblo, sobrevivió cuatro pasadas medidas
porque ningún banco lo contaba.
**Regla:** Contar cosas no es medirlas. Un banco tiene que preguntar lo que
preguntaría el lector — ¿sale un carro de aquí?, ¿tiene esta casa puerta a
algo?, ¿mide una casa lo que mide una casa? — y no cuántas hay. Si una
comprobación no puede ponerse roja, no es una comprobación.

## #27 — Cuando un banco te contradice, deja de parchear
**Fecha:** 2026-08-05
**Contexto:** El banco dijo que el 50,8 % de las casas tenía salida. Arreglé dos
cosas reales — el retranqueo se medía a los vértices de la calle y no al trazado
(por eso las avenidas se estrangulaban), y añadí el paso de carro que abre el
corral — y subió a 60,2 %. Entonces ensanché los callejones, convencido de que
el ancho era la causa: el número no se movió ni un punto. La hipótesis era
falsa, y el siguiente parche habría sido a ciegas sobre una teoría ya refutada.
**Regla:** Un arreglo que no mueve la medida es un arreglo que no entendía el
problema. Deshaz la teoría antes que el código: anota el número, anota lo que
probaste y por qué no era, y deja el hallazgo abierto. Un rojo honesto con su
diagnóstico vale más que un verde conseguido bajando el listón.

## #28 — La cohesión visual es parte del contrato
**Fecha:** 2026-08-05
**Contexto:** El plano de ciudad ganó tejados a dos aguas, materiales y distritos
con nombre — un salto enorme de estructura. Y salió de terracota, sobre una
lámina cuyo propio encabezado dice que existe «para que bajar del atlas a un
pueblo sea un cambio de escala y no un cambio de medio». Cada mejora era
correcta por separado; juntas convirtieron la ciudad en un mapa de otro
programa.
**Regla:** Al profundizar una vista, mírala AL LADO de las otras antes de darla
por buena. La pregunta no es «¿está mejor que antes?» sino «¿sigue siendo el
mismo mundo?».

## #29 — Instrumenta el dominio, no la intuición
**Fecha:** 2026-08-05
**Contexto:** El banco decía que sólo el 60 % de las casas tenía salida rodada.
Mi primera sonda inundó desde las puertas y dio 99,8 % alcanzado: parecía un
fallo del banco. Lo era de la sonda — había inundado la CAJA ENTERA, campo
incluido, donde todo está abierto por definición. Repetida con el mismo dominio
que usa el banco (la unión de los distritos interiores), dio 64,5 % y, lo que
resolvió el caso, **242 componentes conexas**: el suelo del pueblo estaba
troceado en bolsas selladas, la mayor de 3 600 m².
**Regla:** Cuando una medida tuya contradiga a la del banco, sospecha primero de
la tuya, y compara el DOMINIO antes que el algoritmo. Y no midas sólo el
porcentaje alcanzado: cuenta las componentes y mira las mayores. Un porcentaje
te dice que algo falla; la lista de bolsas te dice qué es y dónde.

## #30 — Un umbral por cada falta
**Fecha:** 2026-08-05
**Contexto:** Talar las casas que invaden una avenida con un solo criterio no
tenía punto bueno. Por cualquier esquina al ancho completo: ninguna avenida
estrangulada, pero mediana de 27,8 m y un 17 % del caserío por delante — la
calle dejaba de cortarse porque ya no había nada que la cortara. Sólo por el
centro: mediana sana de 9,2 m, pero 17 de 42 seguían cortadas. Eran dos faltas
distintas metidas en la misma vara.
**Regla:** Si un umbral no tiene punto bueno, probablemente estás midiendo dos
cosas con él. Sepáralas y dale a cada una el suyo: una casa plantada en mitad de
la calzada se cae entera; un pico que asoma sobre el arcén es una fachada
irregular, que es lo normal en una calle medieval.
