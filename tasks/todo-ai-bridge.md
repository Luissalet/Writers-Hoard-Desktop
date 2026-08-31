# Puente IA (AI Bridge) — puerto local para que modelos externos operen la app

Fecha: 2026-08-30. Estado: **implementado y verificado en vivo (2026-08-30)**. Ver la seccion Review al final.
Detonante: Odysseus (D:\LocalAI, puerto 7000) ya funciona y trae gestor MCP
con transportes stdio / SSE / streamable HTTP. Falta el lado de Writers Hoard.

---

## 0. La restricción que manda sobre todo el diseño

Los datos viven en **Dexie/IndexedDB dentro del renderer**. Ningún proceso
externo puede tocarlos: ni el main de Electron, ni un script Node, ni Odysseus.
Leer los ficheros LevelDB a pelo desde fuera es frágil y exige la app cerrada.

Por tanto el único camino honesto es:

    cliente MCP  ──stdio──►  adaptador Node  ──HTTP+token──►  main de Electron
                                                                  │ IPC
                                                                  ▼
                                                         renderer → Dexie

Consecuencias que hay que aceptar de entrada:

- **La app tiene que estar abierta.** `window-all-closed` mata la app (main.ts:1321)
  y no hay tray. Si no hay ventana, el puente responde `app-closed` con un
  mensaje claro; el adaptador puede ofrecer lanzarla.
- **Toda escritura pasa por las ops reales del renderer.** Regalo, no peaje:
  misma validación, cascadas correctas, `notifyProjectsChanged`, y los
  `useLiveQuery` refrescan la UI mientras el modelo escribe. Ves aparecer el
  texto en pantalla en tiempo real.

## 1. Decisiones tomadas (con Luis, 2026-08-30)

| Decisión | Elegido | Motivo |
|---|---|---|
| Transporte | API HTTP + adaptador MCP stdio | stdio lo soportan Odysseus, Claude Desktop, OpenCode y Cowork; la tabla `mcp_servers` de Odysseus **no tiene campo de cabeceras**, así que por HTTP el token iría en la URL. Con stdio el token va en `env`, que sí soporta. |
| Permisos | Escritura libre + snapshot previo + log auditable | Confirmar cada escritura mata cualquier tarea en lote. |
| Formato | Markdown, conversión en el puente | Los modelos locales destrozan el HTML; `htmlToMarkdown` ya existe. |
| Alcance | writings, codex, diary, timeline + búsqueda global | Instagram/visión depende de `collectionImport.ts`, que sigue sin commitear ni probar en vivo. |

Decisiones tomadas por mi cuenta, revisables:

- **Puerto 8766** fijo, sin fallback (calcado del media server en 8765).
- **Sin herramientas de borrado en el primer corte.** Borrar es el único acto
  irreversible; que el modelo no lo tenga a mano. `deleteCodexEntry` además
  arrastra una política de desvinculado tabla por tabla (db/operations.ts:162)
  que no quiero ejercitar desde fuera todavía.
- **Log de auditoría como JSONL en `userData`, escrito por el main.** Nada de
  tabla Dexie nueva: `check-conformance.mjs` exige que toda tabla tenga motor
  dueño y estrategia de backup, y el log no es un motor.
- **JSON-RPC del MCP escrito a mano** (~200 líneas para `initialize`,
  `tools/list`, `tools/call`) en vez de añadir `@modelcontextprotocol/sdk`.
  Revisable: si el subconjunto se queda corto, la dependencia entra.

## 2. Arquitectura por capas

### Capa 0 — transporte (main)
`electron/aibridge/server.ts`, http en `127.0.0.1:8766`.
Ciclo de vida idéntico al media server: `await startAiBridge()` dentro de
`app.whenReady()` con try/catch no fatal, `stopAiBridge()` en `will-quit`.

- `GET  /api/health` → `{ ok, appOpen, projectId, version }`
- `GET  /api/tools`  → manifiesto (funciona aunque no haya renderer)
- `POST /api/call`   → `{ tool, args }` → `{ ok, result }` | `{ ok:false, error, code }`

Seguridad, endurecida respecto al media server (cuyo `isAllowedOrigin` acepta
a cualquier herramienta local — aceptable para descargar vídeos, inaceptable
para escribir en la novela del usuario):

1. `Authorization: Bearer <token>` **obligatoria**. Token de 32 bytes generado
   al primer arranque, guardado en `userData/aibridge/token`.
2. **Rechazo de toda petición con cabecera `Origin`.** Un adaptador MCP o un
   CLI no manda `Origin`; una página web sí. Cierra el vector de que un sitio
   cualquiera dispare escrituras a ciegas contra el localhost del usuario.
3. Cuerpo limitado a 1 MB, como el media server.
4. Interruptor general apagado por defecto + interruptor aparte de escritura.

### Capa 1 — RPC main→renderer (no existe hoy, hay que inventarlo)
`electron/aibridge/rpc.ts`. Hoy sólo hay `handle`/`invoke` (renderer→main) y
`webContents.send` a fondo perdido. Patrón a montar:

    main:     mainWindow.webContents.send('aibridge:request', { id, tool, args })
    renderer: ipcRenderer.invoke('aibridge:reply', { id, ok, result, error })
    main:     ipcMain.handle('aibridge:reply', …) resuelve la promesa pendiente

- Timeout 30 s; se rechaza todo lo pendiente si la ventana muere.
- **Los dos canales van en `IPC_CHANNEL_ROLES` de `electron/security.ts` con
  rol `['main']`.** Sin eso, `acceptIpcSender` rechaza en silencio — es
  exactamente el bug vivo de `ig:listCollection` / `ig:cancelListCollection`,
  que llaman `assertIpcSender` sin estar en el mapa y por tanto siempre lanzan
  `Forbidden IPC sender`. (Bug aparte: anotado, no es de este trabajo.)

### Capa 2 — ejecutor (renderer)
- `src/services/aiBridge/manifest.ts` — **datos puros**, sin DOM ni Dexie:
  nombre, descripción y JSON Schema de cada herramienta. Lo importan los dos
  lados (esbuild lo mete en el bundle del main vía el alias `@`), así que
  `/api/tools` responde aunque la ventana esté cerrada.
- `src/services/aiBridge/dispatch.ts` — suscripción **a nivel de módulo** con
  guarda `window.__whAiBridgeWired` (StrictMode, lección #19), igual que
  `aiStore` con los eventos de Ollama.
- `src/services/aiBridge/tools/*.ts` — un fichero por dominio.

### Capa 3 — adaptador MCP
`electron/aibridge/mcpStdio.ts`, proceso Node independiente, **sin importar
nada de `electron`**. Lee `WH_BRIDGE_TOKEN` del entorno (o el fichero de
`userData`), traduce `tools/list` y `tools/call` a llamadas HTTP al puente.

Empaquetado: quinta entrada en `electron/build.mjs` con su propio `external`
(quitando `electron`), salida a `dist-electron/aibridge/mcpStdio.cjs`, y
`asarUnpack: dist-electron/aibridge/**` en `electron-builder.yml` — dentro del
asar, `node` a secas no puede leerlo.

## 3. Superficie de herramientas (primer corte)

Prefijo `wh_`. Ninguna borra nada.

**Contexto y búsqueda**
- `wh_list_projects` — id, título, modo, motores activos
- `wh_get_context` — qué proyecto y qué motor tiene Luis abierto ahora mismo
- `wh_search` — sobre `searchProjectContent` (projectSearchIndex.ts): indexa
  **cuerpo completo** de writings, codex, diary, dialogBlocks y snapshots. Muy
  superior a los `searchEntities` del registry, que sólo miran títulos.

**Escritos** — `wh_list_writings`, `wh_get_writing`, `wh_create_writing`,
`wh_update_writing`, `wh_append_to_writing` (para no reescribir un capítulo
entero por añadir un párrafo), `wh_list_writing_versions`,
`wh_restore_writing_version`.

**Codex** — `wh_list_codex`, `wh_get_codex_entry`, `wh_create_codex_entry`,
`wh_update_codex_entry`. Ojo con `fields`: es un `Record<string,string>` de
claves libres (la plantilla por tipo es sólo semilla). Semántica del update =
**merge**, no reemplazo, o el modelo vacía la ficha sin querer. `relations` de
`CodexEntry` es campo inerte/legacy: las relaciones reales viven en el motor
`relationships`; el puente no lo toca. Las ops buenas están en
`src/db/operations.ts`, no en `engines/codex/operations.ts`, que es código muerto.

**Diario** — `wh_list_diary`, `wh_create_diary_entry`, `wh_update_diary_entry`.

**Timeline** — `wh_list_timelines`, `wh_create_timeline`, `wh_list_events`,
`wh_create_event`, `wh_update_event`, `wh_connect_events`.

Son ~22 herramientas. Odysseus hace recuperación de herramientas por
relevancia, así que no ahogan el contexto; para clientes que las mandan todas,
descripciones cortas y esquemas escuetos.

## 4. Formato del contenido

- Leer: `htmlToMarkdown` de `manuscriptExport.ts` (regex, ajustado a la salida
  de TipTap StarterKit). No cubre tablas ni listas anidadas — irrelevante aquí.
- Escribir: **no existe markdown→HTML en el repo**. Hay que escribirlo:
  `src/services/aiBridge/markdown.ts`, zero-dep, subconjunto de TipTap
  (h1-h6, negrita, cursiva, código, enlaces, imágenes, ul/ol, cita, hr, párrafos).
- Todo lo que venga de fuera pasa por `sanitizeRichHtml` (DOMPurify endurecido)
  antes de persistirse. Innegociable.

## 5. Red de seguridad

- `takeSnapshot(writing, 'pre-ai')` antes de cada escritura sobre un writing.
  Motivo nuevo en `SnapshotReason` → etiqueta en HistoryModal → claves en
  `en.ts` y `es.ts` (conformance exige paridad total).
- Log JSONL en `userData/aibridge/audit.jsonl`: timestamp, herramienta, args,
  entidad afectada y **estado previo** (sin campos base64) para poder deshacer
  a mano lo que no tiene historial propio (codex, diario, timeline).
- El panel de Ajustes enseña las últimas entradas y permite abrir el fichero.

## 6. Fases

- [x] **F1 — Fontanería.** rpc.ts + canales en security.ts + server.ts con
      token + `/api/health`. Prueba: `curl` con y sin token.
- [x] **F2 — Manifiesto y despacho.** manifest.ts, dispatch.ts, `/api/tools`,
      `/api/call` con una herramienta trivial (`wh_list_projects`).
- [x] **F3 — Markdown.** Conversor + ida y vuelta en tests críticos.
- [x] **F4 — Herramientas.** Los cuatro motores + búsqueda + contexto.
- [x] **F5 — Red de seguridad.** Snapshots `pre-ai` + log de auditoría.
- [x] **F6 — Adaptador MCP.** mcpStdio.ts + build.mjs + asarUnpack.
- [x] **F7 — Ajustes + i18n.** Sección "Puente IA" con token, interruptores y
      el JSON listo para pegar en Odysseus.
- [x] **F8 — Verificación.** Test de política IPC en `tests/electron-security.ts`,
      ida y vuelta del conversor en `tests/critical.browser.ts`,
      `npm run verify:quick`, y prueba real contra Odysseus con qwen3.8:27b.

## 7. Fase 2, fuera de este corte

- Instagram → Recortes con etiquetado por modelo de visión (depende de
  `collectionImport.ts`, sin commitear y sin probar en vivo).
- Herramientas de borrado, con confirmación en la app.
- El resto de motores (notas, outline, board, biografía, arcos…).
- Eventos push: que el modelo se entere de lo que Luis va escribiendo.

## 8. Minas detectadas en el reconocimiento

1. `ig:listCollection` e `ig:cancelListCollection` llaman `assertIpcSender`
   pero no están en `IPC_CHANNEL_ROLES` → hoy fallan siempre. Bug real,
   ajeno a este trabajo, pero conviene arreglarlo de paso.
2. `engines/codex/operations.ts` es código muerto (nadie lo importa;
   `hooks.ts` se construye su propia copia). No confundirse de puerta.
3. `deleteSnapshotsForWriting` está exportada y no la llama nadie:
   `deleteWriting` duplica la lógica inline.
4. `exportProjectData` / `exportFullDatabase` de db/operations.ts son legacy y
   **parciales** (no cubren diary, timelineConnections, writingSnapshots…).
   El backup bueno es el de `registerBackupStrategy`. No usar los legacy.
5. `searchCodexEntries` busca sobre el HTML crudo sin `stripHtml` → falsos
   positivos con nombres de etiqueta. Otra razón para tirar de
   `searchProjectContent`.
6. Los tipos del bridge se duplican a mano en tres sitios (módulo del main,
   preload, `electron-env.d.ts`) y nada lo verifica. Es la convención del
   proyecto; respetarla y no inventar generación automática ahora.

---

## Review — 2026-08-30

Implementado entero, las ocho fases. Documentación de uso en `docs/AI-BRIDGE.md`.

### Verificación real, no sólo tipos

Puertas: `tsc -b --noEmit`, `tsc -p electron/tsconfig.json`, `check-lint.mjs`,
`check-conformance.mjs` (21 motores, 2721 claves de locale) y los 28 tests
críticos, todos en verde por Desktop Commander.

Además, prueba de punta a punta con la app corriendo y datos reales:

- `GET /api/health` con token bueno → `{"ok":true,"appOpen":true,...}`; con
  token malo → **401**; con cabecera `Origin` → **403**.
- `wh_list_projects` devolvió los proyectos reales con sus recuentos, o sea
  que la cadena HTTP → main → IPC → renderer → Dexie funciona entera.
- `wh_create_codex_entry` + `wh_get_codex_entry`: el Markdown volvió
  **idéntico** al enviado (negritas y lista incluidas) tras pasar por
  markdown → HTML de TipTap → sanitizador → Dexie → htmlToMarkdown.
- `wh_update_codex_entry` con un solo campo: fusionó sin tocar el existente.
- `wh_search` encontró la entrada nueva al instante (el índice se invalida
  solo por `storagemutated`).
- Errores tipados correctos: `not-found`, `bad-args`, `unknown-tool`.
- `audit.jsonl` registró las cuatro llamadas, con el estado previo en la de
  actualización.
- El adaptador MCP, lanzado con `node` a pelo y la app cerrada: `initialize`
  devuelve 1730 caracteres de instrucciones, `tools/list` devuelve las 23
  herramientas con esquema, y `tools/call` responde `app-closed` en limpio
  en vez de colgarse.

### Dos cosas que encontró el propio andamiaje

1. El test de paridad rechazó la descripción de `wh_create_timeline` por
   pobre (menos de 40 caracteres). Se reescribió en vez de bajar el umbral:
   esa descripción es literalmente lo único que un modelo va a leer.
2. Un `config.json` escrito por PowerShell llevaba BOM y `JSON.parse` lo
   rechazaba en silencio → los interruptores volvían a su valor por defecto y
   el puerto no levantaba. `getBridgeConfig` ahora tolera el BOM.

### Decisiones que se mantuvieron y una que cambió

Se mantuvo todo lo planeado. Cambió una cosa: `electron/tsconfig.json` no
tenía el alias `@/*` (esbuild sí, tsc no), así que se añadió `baseUrl` +
`paths` para que el main y el adaptador puedan importar el manifiesto
compartido. Sin eso habría hecho falta duplicar el catálogo, que era
exactamente lo que se quería evitar.

### Arreglado de paso

`ig:listCollection` e `ig:cancelListCollection` llamaban a `assertIpcSender`
sin estar en `IPC_CHANNEL_ROLES`, así que lanzaban `Forbidden IPC sender`
siempre: el import de colecciones de Instagram no podía funcionar desde la
app. Añadidos al mapa, con test que lo fija.

### Pendiente para quien siga

- Queda una entrada de codex de prueba, "Prueba del puente IA", en el
  proyecto **Incendios**. No hay herramienta de borrado (a propósito): hay
  que quitarla desde la app.
- El puente quedó **encendido** en la config local para poder probar Odysseus
  al vuelo. Se apaga en Ajustes → Puente IA.
- Sin commitear, como siempre en este proyecto.

---

## Fase 2 — 2026-08-30 (misma sesión)

Hecha entera. El catálogo pasa de 23 a **37 herramientas**.

- [x] **F9 — Bloques de imagen en MCP.** Un handler adjunta `_media` al
      resultado y `electron/aibridge/mcpContent.ts` lo convierte en bloques
      `type:"image"`. El base64 se saca del bloque de texto: iría duplicado y
      sería ruido puro en el contexto del modelo.
- [x] **F10 — Recortes e Instagram.** `wh_list_snapshots`, `wh_get_snapshot`,
      `wh_view_snapshot_image`, `wh_tag_snapshot`,
      `wh_list_instagram_collection`, `wh_import_snapshots`,
      `wh_download_snapshot_media`.
- [x] **F11 — Notas y esquema.** Notas con buzón `__inbox__` incluido, y
      outline con sus beats (lectura y escritura).
- [x] **F12 — Verificación.** Puertas completas + prueba en vivo.

### Decisiones nuevas

- **Timeout por herramienta.** `BridgeTool.timeoutMs` sobre los 45 s por
  defecto: 10 min para listar una colección de Instagram (gallery-dl espacia
  6-12 s por post a propósito), 5 min para descargar media. El adaptador MCP
  ajusta el timeout del socket al que declare cada herramienta más 30 s.
- **Reescalado antes de mandar una imagen** a 1024 px de lado mayor y JPEG 80 %.
  Un original de 4000 px no le aporta nada a un modelo de visión y sí se come
  su contexto. Una captura de página entera acaba pesando ~35 KB.
- **De una en una** en las descargas: cada una es lenta y así el usuario ve
  avanzar el proceso en vez de esperar a ciegas.

### La trampa que costó una vuelta

`fetch('wh-media://…')` **no funciona desde el renderer**. El esquema está
registrado como privilegiado y con `supportFetchAPI`, y la galería lo pinta con
`<img src>` sin problema, pero un `fetch` es siempre cross-origin: en
desarrollo el renderer es `http://localhost`, empaquetado es `file://`. Añadir
`wh-media:` a `connect-src` no arregla nada — el bloqueo es CORS, no CSP; se
probó y se revirtió.

Solución, la misma que el proyecto ya usaba para Ollama: **por IPC**. Canal
nuevo `media:readLibraryFile`, que lee en el main (dueño de la raíz de media y
de `resolveExistingLibraryPath`) y devuelve base64, con tope de 32 MB.
Helper para el renderer: `readLibraryBlob()` en `tools/shared.ts`.

### Verificación en vivo

- MCP completo: `tools/list` → 37; `tools/call` de `wh_view_snapshot_image` →
  bloques `image,text`, JPEG de 35 KB, y el base64 **no** aparece en el texto.
- `wh_tag_snapshot`: añadió una etiqueta y se restauró el estado original.
- `wh_create_note` en el buzón y `wh_list_notes` correctos.
- `wh_list_outlines` devolvió el esquema real del proyecto.
- Puertas: typecheck ×2, lint, conformance y **29 tests críticos**, en verde.

### Pendiente

- Queda una nota de prueba en el **buzón de notas** (Ctrl+Shift+N → bandeja) y
  la entrada de codex "Prueba del puente IA" en **Incendios**. Bórralas tú:
  el puente sigue sin poder borrar nada.
- Sin probar en vivo: `wh_list_instagram_collection` y
  `wh_download_snapshot_media` — lanzan gallery-dl y yt-dlp de verdad contra
  Instagram, y eso es cosa tuya, no de una verificación automática.
- Sigue sin commitear.

---

## Fase 3 — todos los motores restantes (2026-08-30)

De 37 a **82 herramientas**. Los 21 motores del proyecto están conectados
(worldgen no: proyecto aparte). Documentación en `docs/AI-BRIDGE.md` §12.

- [x] **F13 — Grupos filtrables.** `BridgeTool.group` + `selectTools()`;
      `GET /api/tools?groups=…` y `WH_BRIDGE_GROUPS` en el adaptador. `core`
      siempre incluido. Helpers de esquema extraídos a `schema.ts` y el
      manifiesto de los motores nuevos a `manifestEngines.ts`.
- [x] **F14 — Narrativa.** dialog-scene (6), character-arc (5),
      relationships (3), seeds (4), biography (5).
- [x] **F15 — Visual.** board (6, con visión), gallery (3, con visión),
      maps (3), storyboard (3), video-planner (3).
- [x] **F16 — Análisis.** annotations (2, con anclaje por cita), pov-audit (1),
      writing-stats (1, sólo lectura).

### Decisiones

- **Sin plantillas de arco.** `ARC_TEMPLATES` guarda claves i18n que hay que
  resolver con `t()` antes de persistirlas; exponerlas invitaba a que un modelo
  escribiera `characterArc.template.…` como si fuera prosa del autor.
- **writing-stats sólo lectura.** La app escribe sus propias sesiones con la
  tupla reservada `(projectId, date, 'freewrite', notes:'editor')`; una fila
  externa con esa firma la absorbe o la borra el siguiente autoguardado.
- **Estado de semilla derivado**, nunca leído de la fila: `computeSeedStatus`
  es la única fuente de verdad que acordó la app.
- **Anotar sin DOM.** El anclaje por rango sólo necesita el texto plano y un
  `indexOf`; los offsets más el contexto de 40 caracteres los recoloca solo el
  reanclaje difuso. Da algo que faltaba: que un modelo **pregunte en el margen**
  en vez de reescribir la prosa.
- **Sin borrado**, otra vez, en los 44 nuevos.

### Verificación en vivo

- 13 herramientas de listado × 4 proyectos = 52 llamadas, **0 fallos**.
- `wh_add_dialog`: creó el reparto solo (Marta, Julio), guardó el paréntesis
  sin paréntesis y emparejó el diálogo dual dando grupo retroactivo al primer
  bloque.
- `wh_annotate`: ancló a la frase exacta; una cita inexistente devolvió
  `quote-not-found` con instrucciones.
- Semillas: creada → `orphaned`, con payoff → `paid`, `orphanedOnly` vacío.
- `no-project` correcto cuando no hay proyecto abierto y no se pasa projectId.
- Filtro de grupos por MCP: 82 / 24 (`script,story`) / 20 (`writing`) /
  10 (`research`).
- Puertas: typecheck ×2, lint, conformance y **29 tests críticos**.

### La trampa de esta pasada

El filtro de grupos no llegaba: el adaptador MCP construía `?groups=…` pero
`http.request` recibía `url.pathname` a secas, que **tira la query**. Devolvía
las 82 pidieras lo que pidieras. No lo detecta ningún typecheck; apareció al
probar el adaptador de punta a punta con tres filtros distintos.

### Restos de prueba que hay que borrar a mano

Todo en el proyecto **Incendios**, salvo la nota:

1. Ficha de codex "Prueba del puente IA" (y la anotación colgada de ella).
2. Escena "Prueba del puente" con tres bloques.
3. Semilla "Prueba: la cafetera" con su payoff.
4. Una nota en el **buzón** de notas (Ctrl+Shift+N).

El puente sigue sin poder borrar nada: es el diseño.

---

## Fase 4 — autoverificación y borrado (2026-08-30)

**83 herramientas.** Petición de Luis: que el puente sirva para que él trabaje
a través de una IA, para que una IA trabaje sola con la app, y para que quien
lo desarrolle pueda comprobarse sin necesitarle a él. Documentación en
`docs/AI-BRIDGE.md` §13.

- [x] **F17 — Puerta de release completa.** `npm audit` (0 vulnerabilidades),
      `build:desktop` y `bundle:budget`: entrada 913,6 kB de 1600 kB
      bloqueantes. El puente es un chunk perezoso propio de 56 kB.
- [x] **F18 — CLI `scripts/wh-bridge.mjs`.** Lee el token solo. Argumentos en
      `clave=valor`, JSON o `@fichero`.
- [x] **F19 — Autotest.** `POST /api/selftest` crea su propio proyecto, corre
      18 comprobaciones y se borra. `--keep` + `cleanup` para depurar.
- [x] **F20 — `wh_delete` con confirmación en la app.** Registro de 25 tipos
      apuntando a la op con cascada correcta; `ConfirmDialog` real; sin
      respuesta no borra.

### Decisiones

- **Una sola herramienta de borrado**, no una por motor. Quince herramientas
  serían quince confirmaciones y quince sitios donde llamar a la op
  equivocada; el registro concentra la corrección en un punto.
- **El autotest crea y destruye su propio proyecto** en vez de escribir en uno
  real. `deleteProject` ya barre todas las tablas, así que es seguro correrlo
  contra la instalación de verdad — que es justo lo que lo hace útil.
- **`cleanup` se niega** a borrar un proyecto cuyo título no sea el suyo.
  Seguro por construcción, no por buena voluntad del que llama.
- **`clave=valor` en el CLI.** PowerShell se come las comillas dobles de argv;
  un JSON literal no llega entero. Descubierto peleándome con ello.
- **Confirmación con timeout que deniega.** Nadie delante nunca significa "sí".

### Verificación

- Autotest: 18/18 en ~200 ms, proyecto borrado. La primera ejecución encontró
  que los campos estructurados del codex no son anclables (`getEntityText`
  devuelve sólo el cuerpo) — era fallo de la prueba, pero el dato importaba.
- Borrado sin contestar: `declined` a los 120 s, y el escrito seguía ahí.
- `cleanup` apuntado a un proyecto real: rechazado.
- Puertas: typecheck ×2, lint, conformance (2765 claves) y 29 tests críticos.

### Corregido de la captura de Luis

El diálogo salía con el título en castellano y el cuerpo en inglés: el mensaje
se componía a mano en el handler. Ahora va por `t()`, con nombre y texto de
cascada por tipo en los dos idiomas, y un test que falla si falta alguno —
son claves de plantilla y el gate de conformance no las ve.

### Pendiente

- **Deshacer desde el log de auditoría.** El log ya guarda el estado previo de
  cada escritura; falta el botón que lo restaura para los motores sin
  historial propio. Con snapshots en escritos y confirmación en borrados, es
  ahora una comodidad más que una red de seguridad.
- Eventos push hacia el modelo.
- Sin commitear.

---

## Fase 5 — deshacer (2026-08-30)

Cerrado lo que quedaba pendiente. Documentación en `docs/AI-BRIDGE.md` §14.

- [x] **F21 — Deshacer desde el log.** `POST /api/undo` por número de línea,
      botón por entrada en Ajustes, y `wh-bridge audit` / `wh-bridge undo`.
      Crear → borra con la cascada del motor; actualizar → repone los campos
      registrados; borrar → reinserta la fila.

### Decisiones

- **Se direcciona por número de línea**, no por un payload que componga el
  llamante: así nadie puede pedir que se revierta otra cosa. El log es
  append-only, el número es estable, y el propio deshacer se apunta como una
  línea más — que es cómo se detecta el `already-undone`.
- **El tipo de operación se deduce del resultado** (`created`/`deleted`) en el
  servidor, no lo declara cada handler: cuarenta call sites no tuvieron que
  aprenderse un campo. La tabla sí la anota el borrado, porque es el único que
  la necesita y el único sitio donde se sabe.
- **Devuelve `caveat` cuando la reversión es parcial.** Un update repone los
  campos que el handler anotó, no la fila entera; un delete deshecho no
  recupera lo que se fue en cascada. Decirlo es mejor que una marca verde que
  lo esconda.

### Verificación

- Crear semilla → `undo` → desaparece; repetir → `already-undone`.
- Cambiar título de ficha → `undo` → vuelve el original, con el `caveat`
  enumerando los campos restaurados.
- Puertas: typecheck ×2, lint, conformance (2766 claves) y 29 tests críticos.
- Autotest: 18/18, proyecto limpiado.

### Pendiente de verdad

- **Deshacer un borrado no está probado en vivo**: hace falta confirmar el
  diálogo a mano. La lógica es simétrica a la del create y está tipada, pero
  no lo he visto funcionar.
- Eventos push hacia el modelo.
- Sin commitear.

---

## Fase 6 — contenedores y cobertura de búsqueda (2026-08-30)

**87 herramientas, 23 comprobaciones en el autotest.** Documentación en
`docs/AI-BRIDGE.md` §15.

- [x] **F22 — Arreglar `wh_search`, que había dejado de ser verdad.**
      `projectSearchIndex.ts` pasa de 5 a 17 orígenes: añade notas, beats de
      esquema, semillas, payoffs, arcos, beats de arco, relaciones, hechos
      biográficos, eventos, pines de mapa y anotaciones.
- [x] **F23 — Contenedores creables.** `wh_create_outline` (con plantillas de
      beat sheet), `wh_create_board`, `wh_create_storyboard`,
      `wh_create_video_plan`.
- [x] **F24 — Borrado y deshacer de esos contenedores.** `board`, `storyboard`
      y `video-plan` en `DELETABLE`, con su operación de cascada, sus seis
      claves i18n en ambos idiomas y su sitio en el `enum` de `wh_delete`.
- [x] **F25 — Comprobación de cobertura en el autotest.** Diez sondas
      `wh-probe-…` plantadas en campos que el título no muestra; exige que
      `wh_search` las encuentre con el `engineId` correcto.
- [x] **F26 — Deshacer un borrado, verificado.** En `tests/ai-bridge.ts`,
      contra la base de datos real.

### Decisiones

- **Arreglar el índice, no rebajar la descripción.** `searchProjectContent`
  alimenta también la búsqueda global de la app, así que la carencia no era
  sólo para las IA. Y la descripción dice ahora explícitamente qué **no**
  indexa, en vez de dejar que el modelo lo descubra.
- **Los motores con imágenes se quedan fuera del índice a propósito.**
  `boardNodes`, `inspirationImages`, `storyboardPanels` y `videoSegments`
  guardan base64 en la fila: indexarlos deserializaría todas las fotos del
  proyecto en la primera tecla, que es la regresión que `engines/board/index.ts`
  documenta haber arreglado ya una vez.
- **Los mapas siguen sin poder crearse desde el puente**: un mapa es una imagen
  subida con sus dimensiones, y un modelo no la tiene. `wh_add_map_pin` sigue
  valiendo sobre los que ya existan.
- **`TEMPLATE_IDS` vive una sola vez**, derivado de `BEAT_SHEET_TEMPLATES` en
  el manifiesto, y el handler importa esa constante: el esquema no puede
  ofrecer una plantilla que el handler rechace. `engines/outline/types.ts` es
  un módulo hoja sin imports, así que no arrastra Dexie al proceso principal.
- **Las claves i18n de las plantillas se resuelven al crear**, con `t()`: las
  cadenas se copian a las filas del autor y no se volverían a traducir nunca.
  El autotest lo vigila comprobando que ningún beat empieza por `outline.`.

### Verificación

- Puertas: typecheck ×2, lint, conformance (2772 claves) y 29 tests críticos.
- Autotest en vivo contra la instalación real: **23/23 en ~330 ms**, proyecto
  de pruebas creado y borrado.
- Adaptador MCP: 87 herramientas sin filtro, 25 con `visual`, 4 con un grupo
  inexistente (sólo `core`).
- `GET /api/instructions` sirve ya el briefing con los veinte motores y la
  regla de «contenedores antes que contenido».

### El fallo de esta pasada

El `enum` de `wh_delete` no se actualizó al añadir los tres contenedores
nuevos. Lo cazó el test crítico —`"board" can be deleted but is not offered in
the schema`— antes de salir de la máquina. Es exactamente el sitio donde tenía
que fallar.

### Pendiente de verdad

- Eventos push hacia el modelo (sin empezar).
- Sin commitear.

---

## Fase 7 — escribir en un motor apagado (2026-08-30)

### El problema

`Project.enabledEngines` decide qué pestañas se ven **y** contra qué motores
busca la búsqueda global (`GlobalSearch.tsx` → `getOrderedEnabledEngineIds`).
Ningún handler del puente lo mira. Un modelo que cree un evento en un proyecto
donde el motor `timeline` está apagado escribe una fila que el escritor **no
puede ver por ninguna vía**: ni pestaña, ni búsqueda.

No es un caso raro: el preset `essentials` —el de un proyecto nuevo— enciende
tres motores de veintiuno. Justo el escenario en el que más probable es que se
le pida a una IA que construya algo.

### Plan

- [x] **F27 — `engineId` en el manifiesto.** Cada herramienta declara a qué
      motor pertenece. Es también documentación para el modelo.
- [x] **F28 — Guardia en las escrituras de nivel superior.**
      `resolveProjectForEngine(args, engineId)` en `shared.ts`: resuelve el
      proyecto y rechaza con `engine-disabled` si el motor está apagado.
      Sólo escrituras: **leer** un motor apagado sigue permitido, porque los
      datos existen y decirlo es más útil que fingir que no.
- [x] **F29 — `wh_enable_engine`.** Enciende un motor. No apaga: apagar
      esconde datos del autor, y eso no lo decide un modelo.
- [x] **F30 — Prueba derivada del manifiesto.** Proyecto de pruebas con un
      solo motor; cada herramienta que declare `engineId` y `writes` tiene que
      rechazar. La lista sale del manifiesto, no escrita a mano, para que una
      herramienta nueva sin guardia falle sola.

### Decisiones

- **Rechazar, no escribir a escondidas.** Una fila en un motor apagado no está
  «oculta hasta que lo enciendan»: es inalcanzable por todas las vías que
  tiene el autor, y nadie le dijo que existía.
- **Leer sí, escribir no.** Bloquear lecturas sería teatro: los datos están
  ahí, y decirlo es más útil que fingir que el motor no existe.
- **`wh_enable_engine` sólo enciende.** Apagar esconde material del autor y lo
  saca de su búsqueda; eso no lo decide un modelo. La asimetría es
  intencionada y la descripción de la herramienta la explica.
- **Guardia en la puerta, no en cada habitación.** Las escrituras de hijo
  (`wh_add_dialog`, `wh_create_beat`…) no reciben `projectId`: reciben el id de
  un padre que sólo existe si el motor estuvo encendido. Guardar los dieciséis
  creadores de nivel superior cierra el agujero real.
- **`BRIDGE_ENGINE_IDS` es una copia a mano**, porque el registro real importa
  iconos de React y el manifiesto lo carga el proceso principal. El test la
  compara con el registro vivo, así que no puede derivar.

### Verificación

- Puertas: typecheck ×2, lint, conformance y 29 tests críticos.
- Autotest en vivo: **26/26 en 365 ms**.
- En vivo contra un proyecto real («VIdeos sobre libros», `seeds` apagado):
  `wh_create_seed` → `engine-disabled`, sin escribir nada.

### El fallo de esta pasada

El test de deshacer usaba un `projectId` inventado que nunca fue una fila.
Pasaba porque nadie comprobaba el proyecto; con la guardia puesta reventó al
instante. Se arregló el test, no la guardia.

### Pendiente de verdad

- Eventos push hacia el modelo (sin empezar).
- Sin commitear.

---

## Fase 8 — auditoría de promesas (2026-08-30)

**88 herramientas, 28 comprobaciones.** Ninguna funcionalidad nueva: revisar
cada descripción contra su handler y arreglar lo que el código no cumplía.
Documentación en `docs/AI-BRIDGE.md` §17.

- [x] **F31 — La guardia de motores, completa.** De 16 escrituras guardadas a
      **49**: `assertEngineEnabled` en todas las que llegan al proyecto por un
      padre. Galería y mapas eran el caso peor: sin herramienta de creación en
      el puente, su superficie de escritura **entera** pasaba sin puerta.
- [x] **F32 — `wh_restore_writing_version`, reestructurada.** Mutaba antes de
      saber su proyecto. De paso, su auditoría apuntaba al snapshot en vez de
      al escrito: un deshacer habría caído en el vacío.
- [x] **F33 — Prueba completa por construcción.** Un padre real por motor
      (mapa e imagen escritos directos a Dexie), todos los motores apagados, 33
      sondas — más la aserción de cobertura que obliga a añadir sonda a toda
      herramienta de escritura nueva.
- [x] **F34 — Nueve promesas más, cumplidas o corregidas.**
      `wh_get_context` (interruptor de escritura), `wh_add_payoff` (estado
      derivado, no fijo), `wh_list_scenes` (reparto **y** hablantes),
      `wh_list_annotations` (huérfanas recalculadas sin escribir),
      `wh_connect_board_cards` (sin `enum` cerrado), `wh_add_board_card`
      (coordenadas sueltas), `wh_list_diary` (orden real), porcentajes
      recortados, y la plantilla de codex.

### Decisiones

- **Recalcular sin persistir.** `wh_list_annotations` usa el mismo resolvedor
  que la app pero descarta las escrituras: es `writes: false`, y un cliente en
  sólo lectura no puede mutar filas de paso. Se recalcula sólo con
  `engineId`+`entityId`, porque leer el cuerpo entero para un listado de
  proyecto sería cargar el manuscrito para responder a un listado.
- **Sin `enum` donde el dato es libre.** El tipo de hilo del tablero admite
  cadenas del autor; declarar un conjunto cerrado hacía que un cliente
  estricto rechazara valores que la app soporta. Se enumeran en la descripción,
  no en el esquema.
- **Los porcentajes se recortan, no se rechazan.** Todos los demás rangos
  declarados ya se hacían cumplir (intensidad lanza, fuerza y certeza
  recortan); estos eran la excepción incoherente.

### Verificación

- Puertas: typecheck ×2, lint, conformance y 29 tests críticos.
- Autotest en vivo: **28/28 en 638 ms**.
- En vivo contra datos reales: `wh_get_context` trae `writesEnabled`,
  `wh_list_scenes` trae `cast` y `speakers`, y `wh_list_annotations` con
  entidad responde `"checked against the text as it stands right now"`.

### El fallo de esta pasada

Tres, todos cazados por la propia sonda antes de salir: `wh_import_snapshots`
llamado sin `projectId`, la tabla de mapas es `worldMaps` y no `maps`, y el
resultado del import lleva las filas en `snapshots`, no en `imported`. La sonda
sirvió de test de sí misma.

El cuarto es peor y es el que hay que recordar: esos tres fallos ocurrían
**dentro** del constructor de sondas, así que su proyecto anfitrión se quedaba
sin borrar. Tres «Bridge self-test …» huérfanos en la instalación real — lo que
esta suite promete no hacer nunca. El borrado está ahora en un `finally`, con
el id capturado en el instante de crear el proyecto y no devuelto al final del
camino feliz. Regla: un test que crea algo en datos de verdad lo borra en
`finally`, no en la última línea.

### Pendiente de verdad

- Eventos push hacia el modelo (sin empezar).
- Sin commitear.

## Fase 9 — IA nativa: conexiones, copiloto y estudio de imagen (2026-08-31)

Plan: `docs/PLAN-IA-NATIVA.md` (fases 0–7). Documentación en
`docs/AI-BRIDGE.md` §18. Sesión nocturna con el PC cedido: implementado, probado
en vivo y **sin commitear**.

- [x] **F35 — Fase 0: un ejecutor.** `createToolExecutor` en
      `src/services/aiRuntime/executorCore.ts`; `handleCall` del puente delega
      en él y el copiloto lo comparte (`origin`, `conversationId`,
      `auditIndex` de vuelta). `appendAudit` serializado y devuelve el índice.
- [x] **F36 — Fase 1: pasarela en main.** `electron/ai/`: registro de
      conexiones (`connections.json` atómico), claves sólo cifradas con
      `safeStorage`, `urlPolicy` (normalización, localidad, HTTP plano bloqueado
      hacia fuera), adaptadores OpenAI compatible (SSE, tool-calls, imágenes) y
      Ollama nativo (NDJSON, capacidades), errores redactados, sin redirects.
      IPC `ai:*` y `copilot:*` en `IPC_CHANNEL_ROLES`.
- [x] **F37 — Fase 2: Ajustes de IA.** Ruta `/settings/ai` desde la barra
      izquierda: conexiones (añadir/probar/editar/clave/fijar modelos/detectar
      en este equipo), modelos locales con hardware y veredicto (`fit.ts`:
      pesos + KV + sobrecarga; MoE por rebanada activa; velocidad por ancho de
      banda), valores por defecto (texto e imagen) y el Puente IA movido aquí.
- [x] **F38 — Fase 3: copiloto.** Dock derecho por proyecto, hilos en Dexie
      v27 (`aiThreads`, `aiMessages`, `aiProjectSettings`, backup
      `ai-assistant`), bucle de agente en main con selección léxica de
      herramientas, aprobaciones por tarjeta y deshacer desde la tarjeta.
- [x] **F39 — Fase 4: funciones clásicas por la pasarela.** `callAi` usa
      `ai:complete` con la ruta de texto por defecto; migración única de
      `ai_provider/ai_base_url/ai_model` a una conexión «CLIProxyAPI».
- [x] **F40 — Fase 6A: Estudio de imagen.** Motor `image-studio` sin tablas
      (filas en `inspirationImages` con `source: 'generated'` y `generation`),
      herramienta `wh_generate_image` (grupo `visual`),
      `scripts/fake-image-server.mjs` para probar sin GPU.
- [x] **F41 — Remates de la verificación en vivo.** `modelsRouteMissing`
      (un 404 en `/v1/models` ya no cuenta como servidor detectado), el
      selector de rutas no dice «sin herramientas» a un modelo de imagen ni
      pinta grupos vacíos, la fila de conexión no dice «sin probar» junto a un
      error fresco, y `deleteProject` barre también la tabla cuya **clave
      primaria** es `projectId` (Dexie la deja fuera de `idxByName`) — con
      test crítico.

### Decisiones

- **Selección de herramientas determinista, no por modelo.** Ofrecer las 89 en
  cada turno hunde a los modelos locales; se ofrecen núcleo + motor abierto +
  motores nombrados + coincidencias léxicas (máx. 16). Un modelo que necesita
  otro motor tiene `wh_enable_engine` y `wh_search` siempre a mano.
- **Consentimiento remoto por proyecto.** Enviar texto a una conexión que no
  sea local pide confirmación una vez por proyecto (`remoteConsent`), con
  `ConfirmDialog`, y queda en `aiProjectSettings`.
- **Sin runtime de difusión propio (6B aplazada).** El estudio habla con
  cualquier `/v1/images/generations`; descargar y ejecutar modelos de imagen
  queda para otra pasada.
- **Los modelos descargados no van al backup**, y las claves nunca salen del
  main: el renderer trabaja con ids de conexión.

### Verificación

- Puertas: typecheck ×2, lint, conformance (22 motores, 2964 claves) y **30**
  tests críticos (incluido `tests/ai-runtime.ts`: política de URL, fit,
  selección, permisos/alcance, equivalencia puente≡copiloto, replay de
  historial; y el barrido de tablas del copiloto al borrar proyecto).
- Autotest del puente en vivo tras reiniciar main: **28/28 en 593 ms**.
- En vivo: conexión `127.0.0.1:8101` añadida por el formulario → «Responde en
  8 ms · 2 modelos» → guardada sin duplicar → `fake-sd-1.5` como imagen por
  defecto; motor añadido desde Gestionar motores; generación desde la pestaña
  (fila en Galería con etiqueta `generated`, aviso «1 imagen(es) guardadas») y
  desde `wh-bridge call wh_generate_image` (auditoría #30 `generated 1
  image(s)`); copiloto con `qwen3-coder:30b`: lectura (`list codex`) y
  escritura con permiso (crear nota → deshacer). Detección local tras el
  reinicio: sólo Ollama; el backend de Docker del 8100 ya no aparece.

### El fallo de esta pasada

La tormenta de IPC (192 `ai:listConnections`, pantalla negra): `loadModels`
re-listaba conexiones, el array nuevo disparaba el efecto que llamaba a
`loadModels`. Y una segunda, más callada: la tabla `aiProjectSettings` no se
barría al borrar un proyecto, porque su índice `projectId` es la clave
primaria y Dexie no la lista en `idxByName`. Las dos están en `tasks/lessons.md`.

### Pendiente de verdad

- Fase 6B (runtime local de difusión) y fase 7 del plan.
- La heurística de velocidad con reparto GPU/RAM no mide nada; si molesta,
  medir tokens/s reales en la primera respuesta y guardarlos por modelo.
- Sin commitear. El proyecto «Bridge self-test 2026-08-31T02:05:28» se dejó
  con el hilo del copiloto y las imágenes de prueba para revisarlos;
  `node scripts/wh-bridge.mjs cleanup` lo borra.

## Fase 10 — 6B, velocidad medida y el mejor modelo (2026-08-31, segunda mitad)

Encargos de Luis a medianoche: el mejor Qwen instalado por defecto, medir
tokens/s en vez de estimar, y hacer la fase 6B «con Odysseus como ejemplo».
Documentación en `docs/AI-BRIDGE.md` §19. Sin commitear.

- [x] **F42 — Mejor modelo local.** `pickModel.ts` (herramientas, fit,
      velocidad, huella, general > coder, visión, parámetros) + botón «Usar el
      mejor modelo local» en Valores por defecto. En el equipo de Luis eligió
      `qwen3-coder:30b`, y se fijó como texto por defecto.
- [x] **F43 — Velocidad medida.** Ollama (`eval_duration`) y OpenAI (reloj de
      streaming) → `usage.tokensPerSecond` → `model-metrics.json` con media
      móvil → descriptor → `computeFit` sustituye banda y etiqueta →
      «· 28 tok/s» en el badge y bajo cada respuesta del copiloto.
- [x] **F44 — Runtime local de difusión.** `sdRuntimeManifest.ts` (release
      fijada, 6 activos con SHA-256 de GitHub), `download.ts` (reanudable,
      verificado), `sdRuntime.ts` (instalar/extraer/recibo, descargar pesos,
      `sd-server` en 8102 con un modelo, cambio de modelo, apagado a los 5 min
      sin uso), adaptador `sdcpp` (API nativa asíncrona con cancelación),
      conexión integrada `builtin-sd`, IPC `sd:*`, sección «Modelos de imagen
      locales» con catálogo de 5 modelos y veredicto por VRAM, «Nativo del
      modelo» como formato por defecto en el Estudio y en `wh_generate_image`.
- [x] **F45 — Recaída de las funciones clásicas.** Si la ruta por defecto no
      responde, `callAi` reintenta una vez con el mejor modelo local y avisa
      con un toast (una vez por ruta).
- [x] **F46 — Guardias.** `check-conformance` cruza `ipcMain.handle` con
      `IPC_CHANNEL_ROLES`; listas anidadas correctas en Markdown → TipTap.

### Decisiones

- **stable-diffusion.cpp, no Python.** Odysseus lanza torch + diffusers con un
  cookbook de pip; aquí un binario fijado de una release (MIT), como con
  Ollama. Vulkan por defecto (42 MB, cualquier GPU), CUDA como elección.
- **API nativa del servidor, no la ruta OpenAI.** `/v1/images/generations` de
  sd.cpp no acepta semilla, pasos ni prompt negativo como campos; la nativa sí,
  y además cancela y encola.
- **Semilla elegida en el adaptador.** Una fila de Galería sin semilla no se
  puede reproducir; se sortea antes de enviar el trabajo.
- **Apagado por inactividad.** La VRAM es compartida con los modelos de
  texto; cinco minutos sin generar y el servidor se cierra.
- **La estimación vale el 70 % de una medida** al comparar modelos: sin eso,
  el 30b medido a 28 tok/s perdía frente al coder-next estimado a 33.

### Verificación

- Puertas: typecheck ×2, lint, conformance (3001 claves, guardia IPC nueva),
  tests críticos (nuevos: velocidad medida + picker, runtime de imagen,
  manifiesto + roles IPC, descargas verificadas contra un servidor local,
  listas anidadas).
- En vivo: runtime Vulkan instalado (8 s), SD 1.5 Q8 descargado con cancelar
  + reanudar, faro generado en el Estudio a 512×512, `wh_generate_image` por
  el puente con el modelo local (5 s), servidor vivo y auto-apagado; copiloto
  a 28 tok/s medidos; botón del mejor modelo.

### El fallo de esta pasada

Comparar una medida con una estimación en el mismo eje: en cuanto el 30b
midió 28 tok/s (por debajo de su estimación de 35), el coder-next estimado a
33 pasó a «mejor». Lección #46.

### Auditoría (subagente) y verificación final

Un subagente revisó los ficheros nuevos de main y encontró 8 bugs, todos
corregidos (unzip en Linux, apagado por inactividad durante generación, fallo
de spawn colgado 4 min, techo de tok/s, extracción CUDA de dos zips, carrera
RMW de métricas, cuerpo sin drenar, dedupe de fijados). La verificación en
vivo destapó un 9º: el sondeo con timeout de 10 s tiraba imágenes buenas
cuando el servidor estaba saturado — ahora reintenta hasta el plazo. Puertas
verdes: tsc ×2, lint, conformance, **32** tests críticos. Generación limpia en
7 s con la tarjeta libre y semilla reproducible; con Ollama ocupando la VRAM
cae a CPU (física, no bug). Lecciones #46-#50.

### Pendiente de verdad

- Segundos por imagen medidos (el fit de imagen sigue estimando por VRAM).
- CUDA 12 probado en vivo; img2img/LoRA en el Estudio.
- Aviso de contención de VRAM cuando un LLM grande ocupa la tarjeta.
- Sin commitear.
