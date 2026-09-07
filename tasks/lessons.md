# Lessons Learned

## 23. El copiloto interno y el MCP externo deben compartir el mismo núcleo de herramientas
**Date:** 2026-08-30
**Context:** Al planificar la IA nativa de Writer's Hoard, el usuario aclaró que
la nueva experiencia interna no sustituye ni compite con el acceso desde
Odysseus u otros agentes. El MCP existente debe seguir siendo una interfaz
externa de primera clase y reutilizarse dentro de la aplicación.
**Rule:** Separar el catálogo y la ejecución de herramientas de sus transportes.
El copiloto interno, MCP stdio y cualquier API local deben invocar el mismo
manifiesto, validadores, handlers, confirmaciones, auditoría y undo. No crear
herramientas paralelas ni reglas de permisos específicas de una sola interfaz.

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

## #31 — Un banco que monta no es un banco que dibuja
**Fecha:** 2026-08-10
**Contexto:** El único banco que monta el `World3D` real devolvía `ok: true`, sin
errores, con dos lienzos y un HUD legible. No estaba dibujando nada: el
componente se coloca con `absolute inset-0`, la página del banco no lleva
Tailwind, el contenedor medía cero y el lienzo nacía de 1100×8. La captura era
negra con una tira de terreno arriba y nadie la había mirado. Seis utilidades de
CSS declaradas a mano lo arreglaron — y entonces el banco empezó a fallar sus
propias comprobaciones, porque por fin las estaba midiendo.
**Regla:** Para una vista, el criterio de un banco no es «monta sin excepciones»
sino «dibuja algo, y el algo es el correcto». Mide el tamaño del lienzo, cuenta
los píxeles que no son fondo, y MIRA la captura. Un banco visual que nadie mira
es un banco que da verde por construcción.

## #32 — Pon el contador antes de acusar
**Fecha:** 2026-08-10
**Contexto:** Al cablear la vegetación, el fotograma del banco pasó de 14 a
3.688 ms. Toda la evidencia apuntaba a las plantas. En vez de optimizar, le puse
al módulo su propio contador en el HUD — cuántas instancias y cuánto costó
sembrarlas — y el contador dijo CERO instancias en esa pose: era una vista de
océano. La diferencia real estaba dos números más allá, en «41,3 triángulos por
celda» contra «4,0»: dos poses distintas, no comparables.
**Regla:** Antes de optimizar lo que acabas de añadir, haz que lo nuevo declare
su propio coste. Un número atribuible cuesta diez líneas y evita una tarde
entera afinando algo que no era. Y de paso queda puesto para el día en que
alguien diga que el 3D va lento.

## #33 — El número que alimenta un mecanismo tiene que medir lo que el mecanismo gobierna
**Fecha:** 2026-08-11
**Contexto:** El 3D cronometraba el JavaScript de `draw()` (13-15 ms) y con ese
número gobernaba tres cosas que dependen del FOTOGRAMA ENTREGADO (2-15 s en
SwiftShader, rasterizado incluido): el vigilante mataba relojes sanos a los
500 ms y no los resucitaba jamás, la escalera de calidad SUBÍA el pixelRatio en
la máquina de 0,07 fps, y el amortiguado por fotograma no se apagaba nunca. Los
tres mecanismos eran correctos; su dieta no.
**Regla:** Antes de alimentar un mecanismo automático, pregunta qué gobierna y
mide ESO: un plazo de entrega se alimenta de intervalos entre entregas, no del
coste de encolar. Y un mecanismo que puede apagar algo necesita el camino de
vuelta medido con la misma vara (aquí, el rAF canario que resucita el reloj).
Corolario de #32: el número va al HUD — «31641 ms» en el banco fue la prueba de
que por fin medía el mundo y no la intención.

## #34 — Tres síntomas idénticos pueden ser dos enfermedades
**Fecha:** 2026-08-11
**Contexto:** Tres puertas «ciegas» idénticas en el banco de ciudad. La sonda
de dominio (inundar desde los dos lados y buscar el tabique) dijo que dos eran
discos de puerta FLOTANDO en labranza (el suavizado de la muralla corta la
esquina cóncava y el punto dibujado cae a 4-7 u del vértice soldado) — y al
arreglarlas apareció la tercera, distinta: grafo conexo con todo camino a peso
infinito (la ciudadela sentada sobre el ancla de la puerta). El discriminador
barato fue un BFS doble: puro (¿el grafo llega?) contra finito (¿llega sin
pesos infinitos?). Uno separa topología de política de pesos en cuatro líneas.
**Regla:** Cuando N fallos comparten síntoma, diagnostica CADA UNO hasta su
tabique antes de escribir el arreglo del primero — y tras arreglar, vuelve a
correr el banco esperando que el recuento CAMBIE de forma, no sólo de tamaño.
Un arreglo que convierte «3 ciegas» en «1 ciega distinta» no falló: reveló.

## #35 — Una corrección local sobre datos ya corregidos fabrica cadenas
**Fecha:** 2026-08-12
**Contexto:** El 2D corregía las mudanzas del lector al dibujar (`movedAt`)
porque en su día los constructores de geografía no las miraban. La pasada 7
les enseñó a mirarlas — y nadie retiró la corrección local. Resultado: la
lista llegaba YA mudada, el hit del dibujo llevaba la llave del DESTINO, el
segundo arrastre emitía `move` con esa llave, y el estado acumulaba cadenas
`{origen→d1, d1→d2}` que sólo la vista con la doble corrección sabía seguir:
carta, globo y atlas se quedaban en d1 desde la segunda mudanza de cualquier
objeto. Tres vistas de acuerdo entre sí y una cuarta «más lista» que las
demás es exactamente el aspecto que tiene este fallo.
**Regla:** Cuando un constructor central aprende a aplicar una corrección,
BUSCA y retira las compensaciones locales que nacieron de su ausencia — y si
un identificador estable puede reconstruirse desde datos corregidos, colapsa
la indirección donde se construye el estado (aquí `applyEdits`), no en cada
consumidor. Un replay que colapsa además CURA los datos guardados con la
forma vieja al primer uso.

## #36 — Un vínculo por identidad de objeto muere con el primer derivado
**Fecha:** 2026-08-12
**Contexto:** El almacén de canon ligaba mundo→worldId con un WeakMap enseñado
sobre el mundo EDITADO — pero las teselas hondas y el calentador viajan con el
PRÍSTINO del `canonSource`, otro objeto derivado del mismo mundo. Para el
almacén ese objeto no tenía vínculo: 41 `canonBuilt` a la basura, cada `load`
null, y el multi-sesión degenerado en duplicación silenciosa. La captura que
lo delató decía «guardadas 41 · sembradas 0» — trabajo pagado, memoria vacía.
**Regla:** Si un dato debe sobrevivir a derivaciones del objeto que lo indexa
(clones, prístinos, poses), no lo ligues SOLO por identidad: liga por
contenido además (aquí `seed:W×H` como respaldo), o enseña el vínculo en el
punto donde nace CADA derivado. Y pon en el HUD la palabra «ligado/SIN
LIGAR»: un vínculo es invisible justo hasta que falta.

## #37 — El vigilante nace con la petición, no con el trabajo
**Fecha:** 2026-08-12
**Contexto:** El plazo de cada tesela se armaba en el `post()` al worker. Todo
lo anterior (adquirir sesión, sembrar canon desde Dexie) podía rechazar o
colgarse — y entonces el vigilante nunca llegaba a existir: promesa colgada,
sesión «ocupada» eterna, marcador del almacén de pantalla huérfano, y el mapa
sin re-pedir un id que cree en vuelo. Pedidas 336 = entregadas 336 con 0/54
clavado: el sistema no estaba atascado, estaba CONVENCIDO de que no faltaba
nada.
**Regla:** Toda promesa que un almacén marque como en-vuelo lleva su plazo
armado desde el NACIMIENTO de la petición, cubriendo cada tramo previo al
trabajo (colas, cargas, siembras); los tramos posteriores lo REARMAN si su
silencio legítimo es más corto. Y ninguna fase auxiliar puede costar la
petición: cuerpo bajo try y `.catch(→ seguir)` en la juntura.

## #38 — La rama que ningún banco pisa está rota (y un null mudo lo esconde)
**Fecha:** 2026-08-12
**Contexto:** La vía rgba de la Forja (píxeles crudos cruzando la frontera de
proceso, mapa de bits refabricado al llegar) no se ejercitaba en NINGÚN banco
ni en el smoke: los Web Workers entregan `reply.bitmap` directo. En la máquina
de Luis `createImageBitmap` rechazaba para CADA tesela y el `resolve(null)` de
su rama de error no decía palabra: «✓ entregada» contado, pantalla borrosa,
0/28 eterno. Tres capturas y un volcado de consola costó encontrarlo; el log
lo desenmascaró por una sola huella (el mismo suelo re-naciendo 100 ms después
de entregarse, con sus hermanas en vuelo). La cura ni siquiera necesitó saber
POR QUÉ rechazaba: putImageData sobre lienzo no tiene rama de rechazo.
**Regla:** Enumera las vías por las que un dato puede llegar (worker/proceso,
bitmap/rgba) y exige un banco que pise CADA una — con los huesos reales del
otro lado si hace falta calzarlos (aquí @napi-rs/canvas en node). Y jamás
resuelvas null en silencio: cada rama de fallo cuenta (contador en HUD) y
canta (traza con la causa y los números medidos). Si existe una vía sin rama
de fallo posible (síncrona, sin GPU), prefiérela a la elegante que puede
rechazar.

## #39 — Dos guardas que se creen la una a la otra suman un agujero
**Fecha:** 2026-08-12
**Contexto:** Una tesela que se resolvía vacía (caducada, cancelada, worker
caído) soltaba su marcador de en-vuelo y nada más. Map2D soltaba SU guarda
(`lastWant`) «para que el siguiente fotograma re-pida», pero el almacén de
pantalla tenía OTRA (`lastAsk` por nivel) que con la cámara quieta devolvía
el mismo `ask` y cortaba el re-pedido antes de llegar a `fetch`. Cada guarda
asumía que la otra re-pedía; ninguna lo hacía. El banco de retención lo midió
sin ambigüedad: 60 nacimientos justos y un plan 0/60 durante cuatro minutos
de reposo absoluto — el cuadrado borroso eterno sobre mapa quieto. Con la
cámara EN MOVIMIENTO el mismo agujero se disfraza de lo contrario (tormenta
de renacimientos), que es lo que enseñaba el volcado de Luis.
**Regla:** Cada guarda de deduplicación debe LIMPIARSE en el mismo sitio donde
muere aquello que deduplicaba: el asentamiento vacío de una promesa borra la
memoria del nivel que la habría bloqueado. Nunca dos capas de dedupe sin un
banco que pruebe que un hueco se re-pide con la vista clavada.

## #40 — Un plazo que mide duración castiga al que trabaja
**Fecha:** 2026-08-12
**Contexto:** El plazo de una tesela (120 s totales) retiraba la sesión a
media generación de canon cuando el suelo costaba más que el plazo — tirando
minutos de trabajo Y la caché entera de la sesión — y la siguiente tesela
arrancaba la MISMA generación desde cero en una sesión virgen: 163 caducadas
y un plan clavado en el banco. Y las teselas EN COLA detrás de un pool sano
caducaban igual, porque el fondo de una cola FIFO no oye nada en minutos.
**Regla:** Un plazo sano mide SILENCIO, no duración: toda prueba de vida lo
rearma — el `progress` por supertesela de la propia fragua, y el pulso del
pool entero (`queuePulse`: cada sesión liberada y cada progreso rearman a
TODOS los que esperan). Matar sólo lo que lleva 120 s sin dar señal alguna.

## #41 — La respuesta de una cola async no se lee en el mismo tick
**Fecha:** 2026-08-13
**Contexto:** `consume-only-probe` llamaba al núcleo del worker y leía las
respuestas SÍNCRONAMENTE — y desde que el núcleo encadena los mensajes en una
cola de promesas (pasada 9, la fragua pre-forja con partes de `progress`),
la respuesta llega por microtarea. La sonda cantó «¿nada? en 0 ms» tres veces
y «¡CONTRATO ROTO!» sobre un contrato perfectamente cumplido: declinada en
3,8 ms, generada en 21,8 s, residente en 1,9 s cuando por fin se le esperó.
**Regla:** Cuando un módulo pasa de contestar en el tick a contestar por
cola, TODOS sus bancos-sonda cambian de contrato aunque no cambie una línea
suya: buscar cada lector síncrono de sus respuestas y hacerle esperar (sondeo
con techo, no `await` ciego — el banco debe distinguir «tarda» de «mudo»).

## #42 — Un banco que mide por una traza se queda ciego cuando la vía nueva no la canta
**Fecha:** 2026-08-13
**Contexto:** El corredor de retención media el nivel de bajada contando las
trazas «nace» del POOL. Con el almacén de entintadas delante (F1), la segunda
visita servía las teselas del disco — sin pool, sin «nace» — y el corredor
bajó a ciegas: nivelActual -1, «bajada de 232 s» que eran sus propios bucles
de espera girando en vacío, con el mapa ya nítido debajo.
**Regla:** Cada vez que una vía nueva SUSTITUYE trabajo de la vía que un
banco instrumenta, darle al banco la señal equivalente de la vía nueva (el
par sintético nacimiento+entrega del «disco ✓») ANTES de leer sus números:
un banco ciego a la mejora la retrata como regresión.

## #43 — Un defecto nuevo aplicado hacia atrás borra contenido del usuario
**Fecha:** 2026-08-13
**Contexto:** «Los lugares al grifo» codificó el grifo como ausencia-de-edición
= cerrado. Correcto para mundos NUEVOS; para los EXISTENTES — cuyas listas de
ediciones son de antes de que el grifo existiera — significó abrir la app y
encontrarse los mapas sin sus ciudades ni caminos. Luis: «Había mapas con
ciudades y caminos ya. Los has borrado. Una cosa es lo que te pedí para
NUEVOS mundos… pero no te pedí que borrases lo existente.»
**Regla:** La AUSENCIA de un dato nuevo significa LEGADO (lo que ese contenido
era cuando se creó), jamás el defecto nuevo. El defecto nuevo se escribe como
asiento EXPLÍCITO en el momento de la creación (aquí: `placesEverywhere:false`
como primera edición del mundo nuevo — visible en el tick y reversible con
Ctrl+Z). Y toda pasada que cambie un defecto necesita una vara de
RESTAURACIÓN: contenido viejo antes == contenido viejo después, bit a bit.

## #44 — Una cola sin prioridad castiga exactamente lo que el lector mira
**Fecha:** 2026-08-13
**Contexto:** La cola del tileService (F1 v1) era FIFO con descarte por la
cabeza. El `want` pide del centro afuera → lo más CERCANO al centro entra
primero → es lo más viejo → el desborde lo mata primero, y los restos del
nivel que el lector ya dejó despachaban por delante del plan que MIRA. En el
log de Luis: las z10 del centro renaciendo en bucle, el río pixelado
eternamente, y — con la cámara quieta y una ola entera descartada en nulos —
un 0/60 congelado sin nada que volviera a dibujar. renderd no tiene este
fallo porque su cola ES un escalafón (reqPrio→req→reqLow→dirty→bulk, drenado
estricto; llena = descartar, `request_queue.c`).
**Regla:** Una cola de render lleva SIEMPRE dos prioridades: qué se despacha
primero (el plan vigente — la ola más nueva) y qué se descarta primero (el
plan abandonado — la ola más vieja). Y todo camino que resuelva «ahora no»
(null) debe dejar programado el re-pedido (el empujón coalescido del
almacén): un null sin re-pedido es un mapa congelado con la maquinaria sana.

## #45 — Cuatro cuelgues distintos en el mismo sitio no se curan: se derriba
**Fecha:** 2026-08-14
**Contexto:** El pool de sesiones con estado (casadas por identidad de objeto,
desalojadas por hueco, vigiladas por plazos por-petición con pulso de cola)
produjo CUATRO modos de fallo en dos días: la fila india, el thrash de dos
familias, los 20 huecos de vuelo clavados en el acquire (re-armados
eternamente por el progreso de las sábanas: caducadas 0 con todo muerto), y
el funeral del renderer («RangeError: Array buffer allocation failed») por
los clones de mundo de cada contexto nacido y muerto — 24-58 por sesión de
uso. Cada cura destapaba el siguiente. Luis: «Nuestra prioridad es que
funcione, no conservar la arquitectura si NO funciona» — y tenía razón antes
que yo.
**Regla:** Cuando el mismo subsistema acumula el TERCER modo de fallo
estructural, la siguiente sesión no le añade una guarda: lo sustituye por el
modelo de referencia (aquí: granja fija de obreros nunca-desalojados,
reconfigurables por contexto con afinidad, un solo vigía por SILENCIO de
obrero, y aparcamiento sin predicados — cada rama del tomar termina). El
inventario de guardas de un módulo es su detector de humo: plazos que se
rearman unos a otros, pulsos, libros de siembras y desalojos con calor no
son robustez — son la lista de sus cadáveres.

## #46 — Que las teselas lleguen no basta si cada LOD cuenta otro mundo
**Fecha:** 2026-08-14
**Contexto:** La primera corrección consiguió terreno, caminos, ciudades y ríos
durante el zoom, pero Luis detectó que la geografía mutaba demasiado entre la
vista lejana y la cercana, que la ciudad seguía siendo sólo un punto, que el
bosque revelaba la retícula y que el primer montaje parecía congelado. El
transporte ya funcionaba; faltaba continuidad cartográfica y respuesta visual.
**Regla:** Una regresión de mapa debe probar también IDENTIDAD entre niveles, no
sólo entrega: misma costa/río/bioma al muestrear el mismo punto, detalle urbano
visible sin interacción, máscaras sin huella de celda y primer fotograma de
carga antes de preparar datos pesados. «18/18 teselas» es salud del transporte,
no aceptación visual del mapa.

## #47 — Conservar el recorrido de un río no conserva su jerarquía
**Fecha:** 2026-08-14
**Contexto:** Tras unificar la geometría, el río principal seguía el mismo valle
al acercarse, pero el canon olvidaba su caudal mundial y recalculaba la anchura
desde la cuenca visible/local. Luis detectó que los ríos grandes perdían su
grandeza y ya no se distinguían de los riachuelos.
**Regla:** La identidad hidrológica que cruza niveles incluye RECORRIDO y
MAGNITUD. Un tronco mundial transporta su caudal global hasta la tinta profunda;
la hidrología local puede añadir afluentes y detalle, pero no reclasificar el río
principal. La regresión debe comparar la relación de anchuras entre categorías,
no limitarse a preguntar si existen píxeles azules.

## #48 — Una clave correcta sobre la línea equivocada sigue siendo otro río
**Fecha:** 2026-08-14
**Contexto:** La primera corrección preservó `worldFlow` y `sourceRiverKey`, pero
los asignó al primer cauce local que superaba un umbral de proximidad. La prueba
comprobaba clave, unicidad y anchura, no que sus puntos siguieran la polilínea
mundial. En la aplicación, un tramo corto aleatorio recibió dos kilómetros de
anchura mientras el río verdadero desaparecía. Durante la espera, además, el
río ya horneado en el raster mundial se amplificaba como una mancha azul.
**Regla:** La identidad de una geometría exige comparar su RECORRIDO. Una
geometría autoritativa no se reasigna por proximidad: se transporta, recorta y
dibuja directamente. Y una capa lineal que tiene fallback vectorial no debe
estar duplicada dentro de un raster que vaya a ampliarse por encima de su
resolución nativa. Toda regresión de hand-off debe observar el mismo encuadre
antes, durante y después de sustituir la fuente.

## #49 — Geometría autoritativa no significa cartografía aceptable
**Fecha:** 2026-08-14
**Contexto:** El tronco mundial dejó de cambiar durante la carga, pero al verlo
de cerca quedaron expuestos defectos que las capas anteriores ocultaban: la ley
de anchura convertía el caudal máximo en 2,2 km, un salto de longitud en la
costura cilíndrica se unía como una línea horizontal mundial, la hidrología
local publicaba largos tramos D8 casi axiales y el plano urbano tapaba el terreno
con un relleno claro uniforme. El recorrido correcto no hacía correctos su
grosor, sus orillas ni las geometrías auxiliares.
**Regla:** Toda capa autoritativa debe validar también ESCALA, TOPOLOGÍA y
COMPOSICIÓN: anchuras físicas plausibles en metros; separación explícita de la
costura antes de trazar; rechazo de cauces locales degenerados por longitud,
rectitud y dirección; y tinta urbana que integre edificios/calles sin sustituir
el suelo por una silueta opaca. Las regresiones visuales deben cubrir vista
mundial y primer plano, no sólo el hand-off intermedio.

## #50 — Una ciudad colocada sobre geografía no es una ciudad que la comprende
**Fecha:** 2026-08-14
**Contexto:** El plano urbano empezó a verse directamente sobre las teselas, pero
seguía generándose en aislamiento. En una ciudad ribereña, el gran río se pintó
por encima de edificios y murallas; al abrir el plano, la misma población dejó
de ser costera y su silueta ignoró por completo el agua que justificaba su
emplazamiento. La coincidencia de coordenadas sólo hizo visible la contradicción.
**Regla:** Una entidad espacial detallada debe recibir las RESTRICCIONES del
entorno que ocupa, no sólo su punto central. Costa, cauces, orillas y accesos se
transforman al sistema local antes de generar el plano; la ciudad decide qué
suelo es edificable, si ocupa una o dos orillas, dónde necesita puentes/puertos
y cómo termina la muralla. El orden de dibujo expresa semántica —agua bajo
puentes y lejos de edificios— y la regresión compara mapa y plano sobre la misma
geografía, no dos ilustraciones independientes.

## #51 — Una constante afinada contra una magnitud falsa se rompe al arreglar la magnitud
**Fecha:** 2026-08-15
**Contexto:** Durante años el ancho del río en el plano urbano fue una licencia
del dibujante (`PLAN_RIVER_SQUEEZE = 0,10`, ≈0,09·radio). Todas las reglas de
«aquí no se construye» se escribieron como MÚLTIPLOS de ese ancho: 1,5× para la
plaza, 1,6× para el foso, 0,8× para el edificio, 2× para separar puentes, 1,9×
para el tablero, 5× para el molino. Al pasar el ancho a físico —correcto, porque
`Map2D` repinta encima el vector del mundo— cada uno de esos múltiplos creció con
el caudal: un río de 200 m esterilizaba una franja de 600 m dentro de una ciudad
de 1 km. El resultado medido: 78 m de media entre la casa más cercana y su propia
orilla, en las 32 ciudades fluviales del mundo, y ni un muelle. Todos los bancos
seguían en verde porque medían sobre ciudades SINTÉTICAS, donde el ancho no había
cambiado.
**Regla:** Cuando una magnitud pasa de ser una licencia de dibujo a ser física,
hay que auditar TODA constante expresada como múltiplo suyo. Y, mejor, no
escribirlas así: separar la magnitud del mundo (el canal, hidrológico) de la
magnitud del oficio (el muelle y la vega, urbanas, en unidades absolutas). Una
distancia de retranqueo no escala con el caudal — un muelle mide diez metros
tanto en el Sena como en un arroyo.
**Corolario:** Un umbral de decisión que compara una magnitud FÍSICA con el
TAMAÑO DEL DIBUJO (`ancho ≤ 0,64·R0`) no es un criterio, es una coincidencia de
escala. Un puente se mide en metros de luz; con el criterio anterior el planeta
entero se quedó sin un solo puente y el banco no lo vio porque sólo miraba dos
ciudades de su propio mundo de pruebas, las dos sobre estuarios de 600 m.

## #52 — Un interruptor que baraja el hilo de números cambia cosas que no menciona
**Fecha:** 2026-08-15
**Contexto:** El plano urbano entero sale de un `Rng` en orden de llamada, así
que cualquier rama condicional que consuma un sorteo desplaza a todas las de
detrás. El interruptor «Río» de la ficha movía el FOSO en 61 de 120 planos —y en
38 de 200 lo AÑADÍA, que es imposible por geometría— además de los lóbulos, los
barrios y las plazas. Luis lo vio antes que cualquier banco: «¿por qué "río"
añade un foso?».
**Regla:** Una decisión que el usuario puede encender y apagar necesita su propio
hilo derivado de la semilla (`createRng(seed, 'city:moat')`). Y al sacarla del
hilo común hay que SEGUIR GASTANDO el sorteo que ocupaba, o el arreglo de una
cosa cambia todas las demás: quitarlo bajó la fachada a espacio público del
92,3 % al 89,3 % sin que nada estuviera peor, sólo distinto.
**Corolario, y es de Luis:** lo que se ofrece como opción tiene que ser lo que
alguien DECIDIÓ, no dónde está la cosa. Murallas, ciudadela, catedral y foso son
opciones; río y costa son el sitio, y ofrecerlos permitía apagarle el río a una
ciudad fluvial y contradecir el mapa a un clic de distancia. Si el emplazamiento
cambia —mover el pueblo— el plano se re-mide solo.

## #53 — Una sonda visual que no repinta su fondo mide la pintura vieja
**Fecha:** 2026-08-16
**Contexto:** `tile-ghost-look` dibujaba el «antes» y el «después» en el mismo
lienzo sin limpiarlo entre medias. El «antes» —donde el almacén se vacía y no
sirve NADA— salía idéntico al «después», porque lo que se veía era lo que había
pintado la pasada anterior. La sonda «demostró» durante dos intentos que el
cambio no aportaba nada.
**Regla:** Una sonda visual repinta el cuadro entero desde el fondo, igual que
hace el motor, y el fondo tiene que ser el DE VERDAD: aquí, el raster del mundo
que `Map2D` blitea debajo. Comparar contra negro no es comparar contra el estado
anterior, es comparar contra la nada — y comparar contra la nada siempre gana.
**Corolario:** la mejor forma de que el «antes» no mienta es que lo produzca el
MISMO código: `setGeneration` sin familia ES el comportamiento viejo, así que
los dos cuadros salen de la misma rutina y la comparación no se puede inclinar.

## #54 — Medir a la escala equivocada convierte un +22 % en un +0 %
**Fecha:** 2026-08-16
**Contexto:** El snap a píxel entero se midió primero con la tesela reducida 5:1.
Resultado: +0,1 %, o sea «esto no sirve para nada». A 1:1 el mismo cambio da
+21,7 %. No era el cambio: a esa reducción manda el filtro de minificación y
mover medio píxel el destino no puede cambiar nada.
**Regla:** Antes de dar por bueno un «no se nota», comprobar que se está midiendo
donde el efecto PUEDE existir, y barrer el rango en vez de elegir un punto. Y
publicar el barrido entero: aquí la ganancia es +22 % en los bordes de nivel,
ruido en medio y negativa en reducción fuerte —donde menos gradiente es menos
moaré, no menos detalle—. Un solo número habría sido mentira en las dos
direcciones.

## #55 — Un árbol convertido a CRLF entierra el trabajo real en su propio diff
**Fecha:** 2026-08-16
**Contexto:** `git status` enseñaba 193 ficheros modificados. Con
`--ignore-cr-at-eol` eran 12: los otros 181 eran 22.000 líneas de puro fin de
línea. Debajo de ese ruido estaban sin commitear el paquete de navegación y el
descenso a la calle — un día entero de trabajo que un `git add -A` habría
sepultado en un commit ilegible.
**Regla:** Antes de creerse un `git status` grande, medirlo con
`git diff --stat --ignore-cr-at-eol`. Y si el repo no tiene `.gitattributes`, el
problema no es este árbol: es que va a volver a pasar. `* text=auto eol=lf` más
`binary` para los formatos que no son texto lo cierra de una vez.

## #56 — Arreglar la mitad de una cadena de precisión la mueve, no la cura
**Fecha:** 2026-08-16
**Contexto:** El 3D estaba clavado en 2 km de vano por el escalón de la uv del
vértice (2,389 m). Detrás había un SEGUNDO escalón del mismo orden —
`modelViewMatrix * p` restando dos números de ~96 unidades, 1,274 m— que nadie
había medido. Arreglar sólo la uv habría llevado el tope a 1 km y habría parecido
un arreglo completo: mejor, pero roto igual y sin explicación a la vista.
**Regla:** En un problema de coma flotante, ENUMERAR la cadena entera antes de
tocar nada y medir cada eslabón por separado. Una cadena se queda con el peor de
sus eslabones, así que un arreglo parcial se paga con el mismo síntoma un poco
más abajo y con la certeza falsa de haberlo entendido.
**Corolario:** la cura de los dos era la misma — subir la resta grande a la CPU,
que trabaja en doble precisión, y dejar en el shader sólo números pequeños. Un
`mesh.position` en el centro de la ventana y un uniforme con la resta ya hecha
valen más que cualquier truco dentro del shader.

## #57 — Una cuenta que se rompe no borra detalle: lo sustituye por RUIDO
**Fecha:** 2026-08-16
**Contexto:** La sonda visual del marco local midió primero «contraste local» y
dio el ANTES ganando por veinte puntos; se cambió a «moteado» (píxeles que se
separan de sus dos vecinos) y contó como ruido las calles de un píxel, que son
justo lo que hay que conservar. Los dos números decían que el cambio no servía,
y la imagen enseñaba lo contrario a primera vista.
**Regla:** Antes de creerse una métrica de imagen, MIRAR el cuadro. Y cuando la
métrica y el ojo discrepan, la métrica está midiendo otra cosa: un ráster que se
deshace tiene MÁS contraste local que uno limpio, no menos.
**Corolario, y es lo que funcionó:** la mejor vara no puntúa la calidad, sino
una INVARIANTE que la cuenta correcta cumple por definición. Aquí: la cámara
encuadra siempre la misma ventana, así que los cuatro cuadros tienen que salir
iguales — bajar no cambia lo que se ve, sólo dónde estás. Comparar cada cuadro
con el de su propia fila no necesita ningún umbral inventado, y los umbrales
inventados eran lo que había hundido los dos intentos anteriores.
**Y una tercera trampa del mismo día:** un banco no puede exigir una resolución
mejor que su propio muestreo. `descent-precision` pedía «menos de un milímetro
por salto» contando valores distintos sobre 1400 muestras de un vano de 250 m,
donde el mínimo aritmético es 0,18 m. Salió rojo midiendo su muestreo. El número
honesto era el ULP del float32, que no depende del banco.

## #58 — Si dos sitios calculan «dónde está la cosa», uno de los dos está mal
**Fecha:** 2026-08-17
**Contexto:** el mapa dibuja un pueblo en `settlementCellCenter(s)` (celda +0,5)
y el vuelo del gesto «pinchar una ciudad» iba a `s.x, s.y`. Media celda de un
mundo de 2048 son 9,8 km: a vista de continente, dos píxeles que ningún banco
podía ver; con el vano de 2,17 km que pide el vuelo, seis pantallas y media. Y
la otra cara del mismo error: «ya estás ahí» comparaba contra la esquina, así
que 154 de 154 poblaciones no contaban NUNCA como alcanzadas y el segundo clic
—el que abre la lámina— no llegaba jamás.
**Regla:** la posición de una entidad se calcula en UN sitio y todos la piden
ahí. Si una función la dibuja y otra navega hasta ella, tienen que llamar a la
misma. Dos expresiones que «son lo mismo» divergen en cuanto una de las dos
aprende algo (aquí, el medio de la celda).
**Corolario de diagnóstico:** un desfase CONSTANTE y en diagonal hacia el
noroeste es la firma de una esquina de celda donde debería haber un centro. La
captura de Luis dijo dónde mirar antes que ninguna traza.
**Y el motivo de que durase tanto:** una cuenta metida en un `.tsx` no tiene
banco posible sin montar React. Sacarla a `townFrame` en un módulo es lo que
permitió medirla sobre 154 poblaciones de un mundo de verdad en vez de
razonarla — y lo que convirtió «creo que ya está» en ocho varas.

## #37 — En esta máquina, `npm run` no sobrevive a una tubería de PowerShell

**Qué pasó (2026-08-21).** `npm run verify:quick 2>&1 | Out-String` (y con
`Select-Object`) devolvió exit 1 en medio segundo, sin un solo diagnóstico —
parecía un typecheck roto al instante. Los mismos portones lanzados directos
(`npx tsc -b --noEmit`, `node scripts/check-lint.mjs`,
`node scripts/check-conformance.mjs`, `npx electron
scripts/run-critical-tests.cjs`) salieron todos verdes con su salida entera.

**Regla.** Los portones de verificación se lanzan con `npx`/`node` directos en
el shell de Desktop Commander, cada uno seguido de `"X_EXIT=$LASTEXITCODE"`.
Nunca `npm run … | Out-String`: el exit 1 es falso y la salida del hijo se
pierde, así que ni siquiera puedes distinguir un fallo real de este artefacto.
Y `tsc -b` sin `--verbose` calla hasta terminar — si necesitas prueba de que
compiló de verdad, pídesela.

## #38 — Conectar un motor nuevo sin tocar el índice deja mintiendo a la búsqueda

**Qué pasó (2026-08-30).** Conecté trece motores al puente IA y no toqué
`src/services/projectSearchIndex.ts`, que sólo leía cinco tablas. Ni el
typecheck, ni el lint, ni la conformance, ni los 29 tests críticos dijeron
nada: no había nada roto, sólo una promesa —«busca en todos los motores»— que
había dejado de ser verdad. Un modelo buscando el texto de una semilla o de un
beat no encontraba nada y concluía que no existía. Y no era sólo cosa de las
IA: `searchProjectContent` alimenta también la búsqueda global de la app, así
que al escritor le pasaba lo mismo.

**Regla.** Añadir una tabla que guarda prosa del autor obliga a decidir, en el
mismo cambio, si entra en `buildIndex`. Si entra, un `add(...)` con su
`engineId`. Si no entra, un comentario diciendo **por qué** — y la descripción
de la herramienta que la ofrece tiene que decirlo también, en vez de dejar que
el modelo lo descubra buscando y fallando.

**Cómo se vigila.** El autotest planta ahora una palabra inventada
(`wh-probe-…`) en un campo que el título no muestra de cada origen y exige que
`wh_search` la encuentre **con el `engineId` correcto**. Quita un origen de
`buildIndex` y la comprobación falla nombrando cuál. Una promesa que no se
puede comprobar se pudre; una que se comprueba, no.

**Corolario.** El criterio para dejar algo fuera del índice no es el gusto: es
el coste. `boardNodes`, `inspirationImages`, `storyboardPanels` y
`videoSegments` guardan base64 en la fila, e indexarlos deserializaría todas
las fotos del proyecto en la primera pulsación de tecla — la regresión que
`engines/board/index.ts` ya documenta haber arreglado una vez.

## #39 — Poder escribir hijos no es poder usar un motor

**Qué pasó (2026-08-30).** El puente exponía `wh_add_board_card`,
`wh_create_beat`, `wh_add_storyboard_panel` y `wh_add_video_segment`, todas
pidiendo el id de un contenedor —tablero, esquema, storyboard, plan— que
**ninguna herramienta sabía crear**. En un proyecto vacío esos cuatro motores
eran callejones sin salida: un modelo podía listarlos eternamente y no meter
nunca nada. Los tests no lo veían porque cada handler funcionaba
perfectamente; lo que faltaba era el paso cero.

**Regla.** Al exponer un motor, recorrer el camino desde **proyecto vacío**,
no desde el estado que ya tienes en tu instalación. Si un `wh_add_*` pide un
id de padre, la pregunta obligatoria es: ¿existe un `wh_create_*` para ese
padre? Si el padre necesita algo que un modelo no puede tener —una imagen
subida, como en los mapas— eso se dice en la documentación, no se deja como
silencio.

**Y el corolario que casi se me escapa.** Cada contenedor nuevo que se puede
crear es un contenedor que hay que poder **borrar y deshacer**. `undo.ts` cae
a un `db.table(...).delete()` pelado si el tipo no está en `DELETABLE`, y eso
deja huérfanos a todos los hijos. Lo cazó el test crítico
(`"board" can be deleted but is not offered in the schema`), que es
exactamente para lo que está: crear, borrar, deshacer y el `enum` de
`wh_delete` son cuatro sitios, no uno.

## #40 — `enabledEngines` no es cosmética: decide si un dato existe para el autor

**Qué pasó (2026-08-30).** Ningún handler del puente miraba
`Project.enabledEngines`. Una escritura en un motor apagado creaba una fila
correcta, indexada, con su `projectId` bien puesto… e **inalcanzable**: la
pestaña no se renderiza y `GlobalSearch` filtra por
`getOrderedEnabledEngineIds`, así que la búsqueda del propio autor la salta. Ni
error ni aviso. Y el preset `essentials` deja tres motores de veintiuno
encendidos, o sea que era el caso normal en un proyecto recién creado, no un
borde.

**Regla.** Antes de dar por buena una escritura, preguntar **por qué vía la
vería el autor**. Si la respuesta depende de un flag de configuración
(`enabledEngines`, un filtro de vista, un modo de proyecto), ese flag es parte
del contrato de la escritura, no decoración: hay que comprobarlo y rechazar con
un mensaje que diga cómo desatascarse. Escribir algo que nadie puede encontrar
es peor que no escribirlo, porque además parece que funcionó.

**Corolario sobre el rechazo.** Bloquear **lecturas** por lo mismo sería
teatro: las filas están ahí. Y la herramienta que desbloquea (`wh_enable_engine`)
va en un solo sentido — encender es aditivo y reversible en un clic; apagar
esconde material del autor, y eso no lo decide un modelo.

**Cómo se vigila.** Cada herramienta declara su `engineId` en el manifiesto, y
la prueba **deriva** de ahí la lista a comprobar (`writes && engineId &&
schema.properties.projectId`) en vez de escribirla a mano. Se llama a cada una
con **sólo `projectId`**: si falla por argumento que falta en lugar de por
motor apagado, la guardia está en la línea equivocada y el informe la nombra.

## #41 — La descripción de una herramienta es código: audítala contra su handler

**Qué pasó (2026-08-30).** Una revisión sistemática de las 88 descripciones del
puente contra sus handlers encontró **diez** afirmaciones que el código no
cumplía. `wh_get_context` prometía decir «si está permitido escribir» y no
devolvía ese campo. `wh_add_payoff` afirmaba «pasa la semilla a pagada» con un
`'paid'` fijo, contradiciendo a `computeSeedStatus` para las semillas cortadas.
`wh_list_scenes` decía «reparto» y devolvía sólo quien tiene frases.
`wh_list_annotations` prometía decir si un ancla se había roto, leyendo una
marca que **sólo** refresca la app al abrir la entidad —justo lo que un modelo
que acaba de reescribir el capítulo necesita saber, respondido mal—. Nada de
esto lo ve un typecheck, un lint ni un test de contrato: todo compilaba.

**Regla.** Para un consumidor externo, la descripción **es** la API. Cada frase
que afirma un comportamiento hay que leerla al lado del handler y preguntarse
«¿esto es cierto hoy?». Y al tocar un handler, releer su descripción: la
mayoría de estas empezaron siendo verdad y dejaron de serlo. Lo mismo con los
`enum` del esquema — declarar un conjunto cerrado donde el modelo de datos
acepta cualquier cadena hace que un cliente estricto rechace valores válidos.

**Corolario metodológico.** Esta auditoría la hicieron subagentes en paralelo
sobre las fuentes subidas al contenedor, con una consigna estrecha («encuentra
promesas que el handler no cumpla, verifica ambos lados antes de reportar»).
Encontraron cosas que yo había mirado y dado por buenas — incluida una guardia
que **yo mismo había escrito una hora antes** y documentado como completa. Vale
la pena pagar el coste: el autor de un cambio es el peor auditor de ese cambio.

## #42 — «Cierro la puerta principal» sólo vale si sabes dónde están las puertas

**Qué pasó (2026-08-30).** Al guardar las escrituras contra `enabledEngines`
guardé las dieciséis que reciben `projectId` y **razoné** que bastaba: las
escrituras de hijo reciben el id de un padre que sólo puede existir si el motor
estuvo encendido. Lo escribí en la documentación como decisión de diseño. Una
hora después, una auditoría encontró los dos agujeros del razonamiento:

1. Un motor se puede apagar **después** de que existan sus filas — todos los
   `wh_update_*` seguían escribiendo en él.
2. **Galería y mapas no tienen herramienta de creación en el puente.** Sus
   filas las crea la app, así que su superficie de escritura **entera** llegaba
   al proyecto por el padre. No había puerta principal que cerrar: eran todo
   ventanas.

**Regla.** Cuando una defensa se justifique con «los demás casos no pueden
darse», enumerar los casos en vez de argumentarlos. Aquí bastaba con listar las
51 herramientas de escritura y ver cuáles pasaban por la guardia: 16. El
razonamiento sonaba bien y era falso para 33 de ellas.

**Y la forma de la prueba importa.** La comprobación derivada del manifiesto
cubría `writes && engineId && schema.properties.projectId` — la misma
condición que la guardia—, así que pasaba en verde mientras dejaba fuera
exactamente lo que no estaba guardado. Una prueba derivada del criterio
equivocado confirma el error en vez de encontrarlo. La que vale es la de
**cobertura**: toda herramienta de escritura con motor tiene que estar en una
de las dos listas de sondas, o falla nombrándose.

## #43 — Un `load` no re-lista; los efectos dependen de ids, no de arrays

**Qué pasó (2026-08-31).** `loadModels` terminaba llamando a `loadConnections()`
para «refrescar el estado» de la fila. Eso ponía un array nuevo en la store; el
selector de rutas tenía un `useEffect` dependiente de ese array que llamaba a
`loadModels` por cada conexión; que volvía a re-listar. 192 `ai:listConnections`
en segundos, `ERR_INSUFFICIENT_RESOURCES`, y al recargar el renderer una
pantalla negra que parecía otra cosa.

**Regla.** Un `loadX` actualiza **su** fila en su sitio (`map` sobre la store) y
nunca vuelve a listar la colección entera. Y un efecto que dispara cargas se
declara sobre una clave derivada de ids (`connections.map(c => c.id).join('|')`),
nunca sobre la identidad de un array que la store reemplaza en cada `set`.
Cuando aparezca «Forbidden IPC sender» repetido cientos de veces, es un bucle
de render, no un problema de seguridad: mirar el efecto antes que el `security.ts`.

## #44 — Dexie no cuenta la clave primaria como índice

**Qué pasó (2026-08-31).** `deleteProject` barre «toda tabla con índice
`projectId`» mirando `schema.idxByName`. La tabla nueva `aiProjectSettings`
tiene `projectId` como **clave primaria**, y `_parseStoresSpec` hace
`indexes.shift()` antes de construir `idxByName`: la clave primaria no está.
Borrar un proyecto dejaba su fila de ajustes de IA viva, y la documentación de
la tabla decía lo contrario porque yo había leído la regla, no el código.

**Regla.** «Toda tabla con `projectId`» tiene que comprobar también
`schema.primKey.name === 'projectId'`. Y cualquier tabla nueva con una clave
que no sea `id` se prueba en `testCascades` con el borrado de proyecto, no se
confía en el barrido genérico. Una regla genérica sólo protege las tablas que
tienen la forma que la regla imaginó.

## #45 — Escribir en la app ajena con la ventana correcta delante

**Qué pasó (2026-08-31).** Un `Type` de Windows-MCP fue a parar al compositor de
la app de Claude en vez de al copiloto: el foco había cambiado y el mensaje
«se envió solo» al usuario, que tuvo que aclararlo al despertar.

**Regla.** Antes de teclear en una ventana que no es la del propio agente:
`App switch` a la ventana destino, clic en el campo, teclear con
`press_enter: false`, captura para comprobar dónde ha caído el texto, y sólo
entonces pulsar el botón de enviar. Nunca `press_enter: true` a ciegas.

## #46 — Una estimación no compite en el mismo eje que una medida

**Qué pasó (2026-08-31).** El ranking del «mejor modelo local» restaba
tokens/s al puntuar. Mientras todo era estimado, `qwen3-coder:30b` (35 tok/s)
ganaba a `qwen3-coder-next` (33). En cuanto el copiloto midió el 30b de verdad
—28 tok/s, por debajo de la estimación— el otro, aún estimado, pasó a ser «el
mejor» por 0,15 puntos. La medida honesta se castigaba frente a la conjetura
que nadie había comprobado.

**Regla.** Cuando un ranking mezcla números medidos y estimados, la estimación
entra con descuento (aquí al 70 %) o en un escalón inferior; nunca al mismo
valor nominal. Y la prueba del ranking debe incluir el caso mixto: un modelo
medido más lento que su estimación contra otro sólo estimado.

## #47 — «Nativo» antes que «bonito»: el tamaño por defecto lo pone el modelo

**Qué pasó (2026-08-31).** El Estudio y `wh_generate_image` arrancaban a
1024×1024 porque es el tamaño canónico de la API de OpenAI. Un UNet de SD 1.5
entrenado a 512 px produce a 1024 figuras dobles y fondos de sopa; el primer
usuario del runtime local habría concluido que «los modelos locales son
malos».

**Regla.** Cuando el modelo declara una resolución de entrenamiento, el
formato por defecto es esa, y la UI lo dice («Nativo del modelo · 512×512»).
Los presets grandes siguen disponibles, pero no son el valor inicial.

## #48 — Verificar por el binario de electron del proyecto, no por `npx electron`

**Qué pasó (2026-08-31).** A media sesión, los tests críticos empezaron a
colgarse en «Downloading Electron binary…». Causa: `npx electron` resuelve un
electron de la caché de npx/global, distinto del `node_modules/electron` del
proyecto; una de mis barridas de `taskkill` mató un `install.js` a medias y
dejó esa caché sin binario, así que cada `npx electron` intentaba —y fallaba—
re-descargar 150 MB. El binario del proyecto (`node_modules/electron/dist/
electron.exe`, 235 MB) estaba intacto todo el tiempo.

**Regla.** Para correr los tests críticos, invocar el electron del proyecto
directamente: `ELECTRON_OVERRIDE_DIST_PATH=<...>/node_modules/electron/dist
node node_modules/electron/cli.js scripts/run-critical-tests.cjs`. No depender
de `npx electron`. Y el electron es una app GUI en Windows: su stdout NO llega
a un fichero redirigido con `Start-Process -RedirectStandardOutput`; hay que
leerlo por el pipe de Desktop Commander (que sí lo captura). Los tests tardan
~90 s y Desktop Commander corta cada llamada a 60 s: lanzar y luego
`read_process_output` en llamadas sucesivas SIN `force_terminate`.

## #49 — Un sondeo lento no es un trabajo fallido

**Qué pasó (2026-08-31).** El adaptador de imagen sondeaba el estado del
trabajo con `connectTimeoutMs: 10_000`. Cuando `sd-server` estaba saturado
—Vulkan cayendo a CPU porque Ollama ocupaba los 12 GB de la tarjeta— no
contestaba al sondeo en 10 s, el request lanzaba `timeout`, y el `catch` de la
generación lo trataba como fallo: una imagen que se estaba generando bien se
tiraba a la basura.

**Regla.** Al sondear un trabajo asíncrono, distinguir «el trabajo falló» de
«no pude preguntar por el trabajo». Un error transitorio de sondeo (timeout,
conexión reseteada) se reintenta hasta el plazo global; sólo un estado
`failed` explícito, un abort o el plazo terminan el trabajo. Un `404/410`
(el servidor olvidó el trabajo) sí es terminal.

## #50 — En una GPU compartida, medir antes de culpar al código

**Qué pasó (2026-08-31).** Tras reiniciar la app para cargar cambios de main,
las generaciones de imagen empezaron a colgarse. Parecía una regresión de mis
cambios. `nvidia-smi` lo aclaró en un comando: la tarjeta al 95 %, con un
modelo de Ollama residente ocupando 8,9 GB. `sd-server` no tenía VRAM y caía a
CPU. Con la tarjeta libre (`ollama` descargado), la misma generación: 7 s.

**Regla.** En una máquina con GPU compartida entre LLM e imagen, antes de
sospechar del código medir el estado real: `nvidia-smi --query-gpu=memory.used`
y `GET /api/ps` de Ollama. Y no verificar generación de imagen justo después
de ejercitar el copiloto con un modelo grande: Ollama mantiene la VRAM 30 min.

## #51 — Un efecto que corre por token no puede cancelar la fila del turno vivo

**Qué pasó (2026-08-31, auditoría 2).** El dock del copiloto refresca su lista
de mensajes con un efecto dependiente de `dataVersion`, y el runner hace
`bumpData()` tras CADA evento del stream —incluido cada `delta`—. Ese efecto
llamaba a `settleStaleMessages(threadId)`, que marcaba como `cancelled`
CUALQUIER fila en estado `streaming`. Resultado: al primer token, la fila del
asistente en curso se cancelaba a sí misma; la respuesta mostraba «cancelado»
durante toda la generación y sólo aparecía entera al final. Invisible en turnos
con herramientas (las tarjetas tapaban el texto), evidente en respuestas de
sólo texto. Los tests de filas no lo cazaban: era un bug de timing entre el
efecto de React y la función de saneo.

**Regla.** Una función de «saneo de huérfanos» (marcar como cancelado lo que
quedó a medias por un cierre/recarga) sólo debe tocar filas SIN un run vivo. El
run en curso es dueño de su fila y la cierra él mismo en `finish()`. Guardar la
invariante en la propia función (`if (runsByThread[threadId]) return;`), no en
quien la llama, porque se la llama desde muchos sitios (incluido un refresco por
token). Regla general: si algo corre una vez por token, revísalo como código en
caliente y pregúntate qué escribe en disco/estado en cada iteración.

## #52 — Reclamar el turno de forma síncrona ANTES del primer await

**Qué pasó (2026-08-31, auditorías 2 y 3).** El mismo patrón, tres veces:
`sendCopilotTurn`, `downloadSdModel` e `installSdRuntime` comprobaban su guarda
(«ya hay un run», «ya hay una descarga») y sólo DESPUÉS de varios `await`
registraban el estado que la guarda mira. Entre la comprobación y el registro
hay una ventana; un doble clic (o doble Enter, o un botón de reintento sin
deshabilitar) mete dos ejecuciones concurrentes: dos mensajes de usuario, dos
descargas escribiendo los mismos ficheros (corrupción de pesos que
`refreshModels` no detecta porque sólo compara tamaño), buffers de stream
pisados.

**Regla.** La guarda y el registro deben ser atómicos. Reclamar el hueco de
forma síncrona antes de cualquier `await`: un `Set<threadId>` de módulo, o
mover la asignación del estado/AbortController por delante del primer `await`
(envolviendo lo que sigue en try/finally para liberar en todos los caminos,
incluido el de error). El botón se deshabilita cuando el push de estado vuelve
—un ida y vuelta—, así que la UI NO cierra la ventana; la corrección va en el
proceso que hace el trabajo, no en el clic.

## #53 — Decodificar UTF-8 una sola vez, al final del cuerpo

**Qué pasó (2026-08-31, auditoría 3).** El puente HTTP acumulaba el cuerpo con
`raw += chunk.toString('utf8')` por cada trozo del socket, y el lector de la
respuesta MCP con `raw += chunk`. Un carácter multibyte (á, é, í, ñ, emoji)
partido en la frontera de dos trozos se decodifica por mitades: cada mitad se
vuelve U+FFFD. En cuerpos de prosa en castellano por encima de ~64 KB eso es
corrupción silenciosa del manuscrito (el JSON sigue parseando; U+FFFD es válido
en una cadena JSON, así que no salta ningún error).

**Regla.** Nunca decodificar UTF-8 trozo a trozo. Acumular `Buffer`s y decodificar
una vez (`Buffer.concat(chunks).toString('utf8')`), o poner `req.setEncoding('utf8')`
/ `res.setEncoding('utf8')` y dejar que el `StringDecoder` interno guarde la
secuencia parcial entre trozos. El límite de tamaño se mantiene sumando
`chunk.length` sobre los buffers.

## #54 — Un validador IPC fail-closed reconstruye el objeto: los campos nuevos se caen solos

**Qué pasó (2026-08-31, img2img).** Para pasar `initImage`/`strength` del Estudio
al servidor, añadí los campos a `AiImageRequest`, a `buildSdJobPayload` y a la
UI. Habría fallado en silencio: el handler `ai:generateImage` no reenvía el
objeto tal cual —lo sanea con `asImageRequest`, que RECONSTRUYE el request campo
a campo (whitelist), así que cualquier campo no listado se descarta antes de
llegar al gateway. El typecheck no lo caza (el objeto sigue siendo un
`AiImageRequest` válido); la función simplemente no lo copia.

**Regla.** Cuando un dato nuevo cruza IPC, el tipo NO basta: hay que añadirlo al
validador que reconstruye el payload en main (aquí `asImageRequest`), con sus
cotas (data URL de imagen ≤ 32 MB, `strength` recortado a [0,1]). Buscar el
patrón `as<Thing>Request(value: unknown)` y comprobar que el campo está en el
objeto que devuelve, no sólo en la interfaz.

## #55 — Para el contrato de un binario externo, léelo del binario

**Qué pasó (2026-08-31, img2img).** El formato JSON del endpoint `img_gen` de
sd-server (nombres de campo para la imagen de init y la fuerza) no está en el
repo: el servidor es un binario descargado. En vez de adivinar, extraje las
cadenas ASCII del `.exe` y busqué las claves: aparecieron `init_image` (un data
URL, no base64 pelado), `strength` (recortado a [0,1], defecto .75),
`denoising_strength`, y el propio `/sdcpp/v1/img_gen`. El binario llevaba dentro
su UI web, cuyo JS construye el request —fuente de la verdad exacta—.

**Regla.** Antes de cablear contra un binario de terceros del que no tienes el
código, saca sus strings (`[regex]::Matches($bytes_ascii,'[ -~]{4,}')`) y busca
las claves/rutas: confirma nombres, tipos (data URL vs base64) y rangos de valor
en lugar de asumir el formato «típico». Diez minutos de lectura evitan un
img2img que no hace nada sin dar error.

## #56 — Audita los adaptores en paralelo: la corrección de uno delata la del hermano

**Qué pasó (2026-08-31, rondas 6-7).** Auditar `openAiCompatible.ts` y luego
`ollama.ts` reveló los mismos huecos en ambos, porque comparten forma: un error
de servidor en mitad del stream emitido SIN `redact()` (fuga del bearer si un
proxy remoto refleja la cabecera), y `content`/`reasoning` emitidos sin
comprobar que son string (un servidor que manda contenido estructurado se
convierte en "[object Object]" en el mensaje del asistente). El adaptador que ya
tenía la guarda fue el patrón para el que no la tenía. Además, `openAiCompatible`
tenía dos fallos propios de la ruta de imagen remota: la URL firmada del
resultado (con query) la rechazaba `normaliseBaseUrl` (reservado para URLs base),
y la descarga no tenía timeout (podía colgar la cola de imágenes serializada).

**Regla.** Cuando hay varios adaptadores/handlers de la misma familia, audítalos
en tanda y aplica cada corrección a TODOS: `redact(msg, ctx.secret)` en todo
mensaje de error que lleve texto del servidor; `typeof x === 'string'` antes de
emitir contenido del modelo; un timeout combinado (`combineSignals([signal,
AbortSignal.timeout(...)])`) en toda descarga sin cota de tiempo; y para validar
una URL de recurso (no base) parsea con `new URL` + `classifyHost` en vez de
reutilizar el normalizador de URL base, que refuse las query.

## #57 — Un dato que no es fila necesita su propio modelo de escritura (y un solo escritor)

**Qué pasó (2026-08-31, Worldgen MCP).** Los lugares de un mundo no son filas:
se derivan del relieve y las ediciones son un blob JSON que la vista lee UNA vez
y reescribe entero con debounce. Un `wh_create_settlement` que escribiera una
fila habría creado algo invisible para el mapa, y un `update` del blob mientras
la vista está abierta habría perdido la carrera contra su siguiente guardado (la
vista lo pisa y nunca lo ve). La solución fue nombrar al dueño: la vista abierta
se registra (`core/liveWorlds.ts`) y el escritor externo le ENTREGA las
ediciones (mismo camino que una pincelada: `applyEditGroup`); sin vista, se
añade a la fila. La lectura sin vista reproduce el blob sobre una réplica
privada de la instantánea, nunca sobre el objeto que la vista pinta.

**Regla.** Antes de exponer un motor al puente, pregunta: ¿sus entidades son
filas con id, o se derivan de algo? Si se derivan, no inventes filas paralelas:
direcciona por la identidad que el motor YA usa (aquí `settlement:x,y`) y
escribe por el mismo camino que la UI. Y si la UI mantiene estado en memoria
que luego vuelca entero, hay UN escritor: o le entregas el cambio, o no hay
nadie en casa y escribes tú. Nunca los dos.

## #58 — Las vistas no se refrescaban tras una escritura de la IA (los hooks sólo refetch tras las suyas)

**Qué pasó (2026-08-31).** Al verificar en vivo un undo del puente sobre el
mundo abierto, la fila cambió y la pantalla no. `makeEntityHook` (y Graph/
ReadOnly) leen una vez por scope y refetch sólo tras SUS `addItem/editItem/
removeItem`; el puente y el copiloto escriben por otro camino. Llevaba así
desde la Fase 0: el copiloto creaba una entrada del códice y la pestaña abierta
no la mostraba hasta remontar. El motor de notas lo había resuelto sólo para sí
(`wh:notes-changed`).

**Regla.** Cuando añadas un escritor nuevo (bridge, importación, undo, otro
proceso) sobre tablas que la UI cachea en hooks, emite un aviso genérico
(`notifyDataChanged` en `engines/_shared/dataChanged.ts`, ya cableado en
`runBridgeTool` para toda escritura y undo) y comprueba EN PANTALLA que la vista
abierta cambia — no basta con leer la fila. Un test de la fila no ve este fallo;
sólo lo ve una captura después del tool call.

## #59 — La captura por pantalla en Windows-MCP: pide un display, no el escritorio virtual

**Qué pasó (2026-08-31).** El primer `Snapshot` devolvió el escritorio virtual
entero (6004×2160, seis monitores) reducido a 1920 px; el primer clic calculado
desde esa imagen cayó en otro monitor (el origen virtual es negativo). Con
`display=[0]` la captura es 1:1 en coordenadas de pantalla y el backend `dxcam`
(el `pillow` de `Screenshot` devolvió negro para ese display).

**Regla.** En un equipo multimonitor, antes de hacer clic pide la captura de UN
display (`Snapshot display=[0]`, coordenadas 1:1) y verifica que la ventana
objetivo esté en él; nunca escales coordenadas desde la captura del escritorio
virtual. Y comprueba `IDLE_SECONDS` (GetLastInputInfo) antes de reiniciar la
app del usuario: si lleva media hora sin tocar el teclado, no le rompes nada.

## #60 — Las puertas completas caben en el contenedor: úsalo para iterar, y deja la máquina del usuario para confirmar

**Qué pasó (2026-08-31, tarde).** Hasta hoy cada cambio viajaba a Windows para
cada typecheck y cada suite (minutos por vuelta, y un shell que se moría al
encadenar). Con `npm ci --ignore-scripts`, `node node_modules/electron/install.js`
(y `echo -n electron > node_modules/electron/path.txt` porque el instalador
deja `path.txt` vacío), `ELECTRON_OVERRIDE_DIST_PATH` y `xvfb-run -a`, la suite
crítica entera corre aquí en ~2 min; y los harnesses de navegador corren en
Chromium headless (Playwright global) si el user-agent lleva `Electron/` (si no,
`isDesktop()` es falso y `App.tsx` elige `BrowserRouter`, y el arranque falla
por una razón que no es tuya). Dos fallos del autotest resultaron ser del
harness (los adaptadores de anclaje se registran al importar `@/engines`).

**Regla.** Antes de mandar nada a la máquina del usuario, corre AQUÍ tsc×2,
lint, conformance, la suite Electron bajo xvfb y el autotest del puente con
IndexedDB real. Windows es para la confirmación final (hash byte a byte,
verify:quick, críticos) y para lo que sólo existe allí: la GPU, el app en
marcha, la vista abierta. Y cuando un harness falla, comprueba primero que el
harness reproduce el entorno real (UA, módulos que se registran al importar)
antes de tocar el código.

## #61 — Un test que falla tras un cambio deliberado es una pregunta de contrato, no una caza de bugs

**Qué pasó (2026-09-02).** La ronda 3 cambió cinco comportamientos a propósito y cinco tests se
pusieron rojos. Ninguno era un fallo del código: el sanitizador ya no tira una nota que empieza por
«data:», los anillos del mapa se desenrollan más allá de ±180 para que Fiji sea una figura y no una
banda, una ventana de dos mundos de ancho dibuja dos copias, las columnas de teselas se dejan sin
acotar para `wrapTileX`, y una llamada del copiloto lleva un pin de proyecto que la del puente no
lleva. Cuatro de los cinco tests consagraban además la limitación que la ronda venía a quitar —
uno lo decía por escrito: «Recorded here so the limitation is visible, not discovered».

**Regla.** Ante un test rojo después de un cambio querido, primero decide de quién es la verdad. Si
el código nuevo es el que manda, el test no se «ajusta» al número que salga: se REESCRIBE para
enunciar el invariante que ahora rige, con el porqué en un comentario, y —esto es lo que salva -—
añadiendo la comprobación de que el cambio no abrió la puerta que el código viejo guardaba (aquí:
que un `data:image/svg+xml` dentro de un `<img>` sigue rechazado). Un test corregido a base de
cambiar el número esperado no protege nada.

**Y una señal.** Si el número que sale es MENOR que el esperado y el asunto es un recuento de
palabras, no lo toques hasta contar a mano: nueve eran ocho más un pedazo de atributo que se colaba.

## #62 — Vite recarga el renderer, no el preload: para probar algo que cruza el IPC hay que reiniciar

**Qué pasó (2026-09-02).** Extraje la iteración 2 en la máquina de Luis con la app de desarrollo en
marcha y fui a probar el botón «Buscar las coordenadas». No estaba. El código estaba bien: el botón
sólo se dibuja si existe `window.electronAPI.atlas.geocode`, y eso lo expone el PRELOAD, que es un
bundle del proceso principal. Vite había recargado el renderer con el botón dentro, pero Electron
seguía con el `dist-electron/preload.cjs` viejo, sin ese puente. Diez minutos buscando un fallo que
no existía.

**Regla.** Un cambio en `electron/**` (main, preload, security) no llega por recarga en caliente:
mata `dev-desktop.mjs` y relánzalo, y comprueba en su salida que `preload.cjs` cambió de tamaño. Antes
de reiniciar la app del usuario, mira `IDLE_SECONDS`; si la instancia la levanté yo para probar, es
mía y la reinicio sin más.

## #63 — Un paquete «desde HEAD~1» no es «lo que falta en la otra máquina»

**Qué pasó (2026-09-02, 23:38).** Abrí el Generador de Mundos en la app de Luis y Vite escupió
«Failed to resolve import ../core/measure». Los ficheros nuevos de worldgen (regla, leyenda,
teclado) NUNCA habían llegado a Windows: la ronda eran varios commits y mi `push.sh HEAD~1`
empaquetaba sólo el último. Las puertas de Windows habían salido verdes porque el `Map2D.tsx`
que las importaba tampoco había llegado aún; llegó en el commit siguiente, ya con los imports
rotos, y esa vez no repetí las puertas allí. Ningún test lo vio: los tests corrían en el contenedor,
donde todo estaba. Lo vio abrir la pestaña.

**Regla.** El paquete se calcula desde el último commit que DE VERDAD aterrizó en la otra máquina
(`push.sh` guarda ese hash y `--landed` lo avanza), nunca desde `HEAD~1`. Tras extraer, hash
agregado de TODOS los ficheros del paquete a ambos lados, y las cuatro puertas EN WINDOWS otra vez
— y después, la app abierta con los ojos, pestaña por pestaña. Un árbol verde aquí no dice nada de
qué ficheros tiene el otro.

## #64 — Un `counter-reset` en un hijo NO reinicia el contador que el padre ya posee (2026-09-03)

**Qué pasó.** Para reiniciar la numeración de notas por capítulo en el libro entero puse
`counter-reset: wh-footnote` en cada `.wh-chapter-heading`. El agente lo dio por bueno («no se
puede verificar en el harness») y el test sólo comprobaba que el selector encontraba las cabeceras.
En la app el marcador del capítulo 2 seguía siendo «‡»: `.ProseMirror` ya hacía `counter-reset`
del mismo contador, y en css-lists-3 (como lo implementa Chromium) un reset en un hijo de un
elemento que YA tiene ese contador crea un contador ANIDADO, visible sólo dentro del hijo — los
hermanos siguientes siguen incrementando el del padre. Con el padre en `counter-reset: none`, la
primera cabecera instancia el contador y los hermanos sí lo ven.

**Regla.** Un contador CSS que deba reiniciarse «en cada hermano X» no puede tener también un
`counter-reset` en el ancestro común. Y lo que un test no puede ver (contadores, `::marker`,
`::before`) se mira en un navegador de verdad: un `page.setContent` de Playwright con diez líneas de
HTML tarda un segundo y me habría ahorrado el paquete extra.

## #65 — `git` sobre la carpeta montada deja un `index.lock` huérfano (2026-09-03)

**Qué pasó.** Un `git status` lanzado desde el shell de la VM sobre `mnt/Writers hoard desktop`
creó `.git/index.lock` y no pudo borrarlo («Operation not permitted»: el montaje no permite
unlink). Git en Windows quedó bloqueado hasta que Luis lo pidió y lo quité con PowerShell.

**Regla.** Nunca `git` (ni nada que cree y borre ficheros temporales) desde el shell de la VM sobre
la carpeta montada: git va SIEMPRE por PowerShell (Desktop Commander). Si aparece
«unable to unlink … index.lock», borrarlo en el acto desde Windows.

## #66 — Las features deben reforzar el propósito creativo del producto, no copiar su mercado (2026-09-06)

**Qué pasó.** Al ampliar una auditoría con ideas de producto, convertí referencias de otras
herramientas de escritura en una hoja de ruta de pitches, envíos, beta readers y procesos
editoriales. El usuario aclaró que Writers Hoard está centrado en explorar ideas y desarrollarlas,
no en construir un flujo comercial alrededor del manuscrito.

**Regla.** Antes de proponer features, nombra el trabajo central del producto y evalúa cada idea
contra él. Para Writers Hoard, prioriza pensamiento divergente y convergente, hipótesis, conexiones,
ramas, consecuencias, canon, tensión y transformación de ideas en estructura y escenas. No añadas
CRM, envíos, colaboración comercial o paridad competitiva salvo petición explícita. Las referencias
de mercado pueden validar una necesidad, pero nunca deben sustituir la dirección propia del producto.

## #67 — La compatibilidad se calibra contra los datos que de verdad importan (2026-09-07)

**Qué pasó.** Durante la remediación integral estaba tratando cada fila legacy del entorno como si
fuera producción irremplazable. El usuario aclaró que casi todo el contenido actual son pruebas; la
única excepción material son los enlaces guardados en Recortes.

**Regla.** Para este proyecto, no consumir semanas en compatibilidad histórica hipotética ni dejar
que los fixtures actuales dicten la arquitectura. Se puede reestructurar esquema, backups y módulos
con libertad si mejora el producto futuro. Los enlaces de Recortes son la única excepción real:
ninguna limpieza, migración, restore o prueba puede borrarlos, reescribirlos o sacarlos de alcance
sin una copia y una comprobación explícitas.

## #68 — Un módulo sin integración aún necesita una frontera de idioma (2026-09-07)

**Qué pasó.** Construí Creative Lab aislado para evitar conflictos con el Cockpit y los catálogos de
idioma, pero dejé el texto de la interfaz y de las operaciones deterministas incrustado en inglés.
Eso hacía que la integración ES/EN posterior exigiera reescribir el componente en vez de limitarse
a conectarlo.

**Regla.** Cuando una entrega vertical prohíba tocar los locales compartidos, extraer desde el primer
momento un contrato de copy completo fuera del archivo React, ofrecer defaults por `locale` y permitir
inyectar el objeto entero. Esto incluye aria-labels, errores, estados vacíos, formatos dinámicos y el
texto que generan las operaciones; aislar la UI no justifica fijar su idioma.

## #69 — No reabrir permisos que el usuario ya concedió (2026-09-07)

**Qué pasó.** El usuario tuvo que recalcar que dispongo de acceso completo y que no quiere interrupciones
por permisos mientras implemento la reestructuración autorizada.

**Regla.** Ejecutar directamente toda lectura, edición, prueba y reestructuración normal dentro del
workspace y del alcance ya aprobado. No convertir cautelas internas en preguntas repetitivas. Solo detenerse
si la plataforma exige técnicamente una aprobación fuera del workspace o si la acción ampliaría de verdad
el alcance; ninguna de las dos cosas aplica a la implementación normal de Writers Hoard.
