# Puente IA — puerto local para modelos externos

Writers Hoard expone un puerto en `127.0.0.1` para que un modelo de IA que
corre fuera de la app (Odysseus, Claude Desktop, OpenCode, Cowork…) pueda
**leer y escribir** en tus proyectos: manuscrito, codex, diario y líneas de
tiempo.

Está **apagado por defecto**. Se enciende en **Ajustes → Puente IA**, donde
además tienes el token y el JSON listo para pegar en el cliente.

El catálogo mantiene las 203 herramientas anteriores y añade las 19 de ficción
interactiva, `wh_story_modules` y `wh_story_module_set` (224 en total). Ficción
empieza desactivada y tiene controles independientes de narración, voz e imágenes.
La API completa está bajo `/api/fiction/*` en el mismo puerto; se ejecuta en un
motor privado por stdio, sin servidor antiguo ni puerto adicional. Véase
[la arquitectura y conservación de datos](FICTION.md).

---

## 1. Cómo encaja

Los datos de la app viven en Dexie/IndexedDB **dentro del renderer**, así que
ningún proceso externo puede tocarlos. La cadena completa es:

```
cliente MCP
   │  JSON-RPC 2.0 por stdio
   ▼
dist-electron/aibridge/mcpStdio.cjs        ← proceso Node suelto
   │  HTTP + Bearer token
   ▼
127.0.0.1:8766  (proceso main de Electron)
   │  IPC  aibridge:request / aibridge:reply
   ▼
ventana principal → Dexie
```

Dos consecuencias que conviene tener claras:

- **Writers Hoard tiene que estar abierto.** Si está cerrado, `tools/list`
  sigue respondiendo (el catálogo va compilado dentro del adaptador) pero
  cualquier llamada devuelve `app-closed` con un mensaje claro.
- **Las escrituras pasan por las operaciones reales de la app**, no por SQL a
  pelo: se respetan las cascadas, se dispara `notifyProjectsChanged` y los
  `useLiveQuery` refrescan la interfaz. Ves aparecer el texto en pantalla
  mientras el modelo escribe.

## 2. Conectar un cliente

Copia el bloque de **Ajustes → Puente IA → Configuración para el cliente MCP**.
Tiene esta forma:

```json
{
  "mcpServers": {
    "writers-hoard": {
      "command": "node",
      "args": ["C:\\...\\dist-electron\\aibridge\\mcpStdio.cjs"],
      "env": {
        "WH_BRIDGE_TOKEN": "…",
        "WH_BRIDGE_URL": "http://127.0.0.1:8766"
      }
    }
  }
}
```

- **Odysseus** — Ajustes → MCP → añadir servidor, transporte `stdio`, comando
  `node`, argumento la ruta del adaptador, y `WH_BRIDGE_TOKEN` en `env`.
  (Odysseus no tiene campo de cabeceras HTTP; por eso el transporte es stdio.)
- **Claude Desktop / OpenCode / Cowork** — el mismo bloque en su
  `mcp.json` / `claude_desktop_config.json`.

Variables que entiende el adaptador:

| Variable | Para qué |
|---|---|
| `WH_BRIDGE_TOKEN` | El token. Sin él no se atiende nada. |
| `WH_BRIDGE_TOKEN_FILE` | Ruta alternativa al fichero del token. |
| `WH_BRIDGE_URL` | Por si cambias el puerto (`WH_AIBRIDGE_PORT` en la app). |

Si no pasas token, el adaptador lo busca en
`%APPDATA%\writers-hoard\aibridge\token` (y el equivalente en macOS/Linux).

## 3. El modelo no necesita que le expliques nada

Al conectarse, el servidor MCP devuelve en `initialize` un campo
`instructions` con un briefing completo: qué es la app, qué motores tiene,
por dónde empezar (`wh_get_context`), que la prosa va en Markdown, que los
campos no enviados no se tocan, y que no hay herramientas de borrado. Ese
texto vive en `BRIDGE_INSTRUCTIONS`, en `src/services/aiBridge/manifest.ts`,
y también se sirve en `GET /api/instructions`.

Cada herramienta lleva su propia descripción y su JSON Schema en el mismo
manifiesto. Si cambias una, cambia en los dos sitios a la vez porque hay uno
solo.

## 4. Catálogo de herramientas

Todas llevan prefijo `wh_`. `projectId` es opcional en todas: si lo omites, se
usa **el proyecto que tengas abierto en la app**, que es lo que hace que
«añade esto a mi codex» funcione sin resolver ids antes.

**Orientación**

| Herramienta | Qué hace |
|---|---|
| `wh_get_context` | Proyecto y motor abiertos ahora mismo. Punto de entrada. |
| `wh_list_projects` | Todos los proyectos con recuentos por motor. |
| `wh_search` | Búsqueda por **cuerpo completo** en los diecisiete orígenes de prosa del proyecto (§15). |
| `wh_delete` | Borra una cosa, con diálogo de confirmación. Ver §13. |
| `wh_enable_engine` | Enciende un motor en un proyecto. No apaga. Ver §16. |

**Manuscrito**

| Herramienta | Escribe | Notas |
|---|---|---|
| `wh_list_writings` | no | Sin cuerpos; filtra por estado. |
| `wh_get_writing` | no | Cuerpo en Markdown. |
| `wh_create_writing` | sí | |
| `wh_update_writing` | sí | `content` REEMPLAZA el cuerpo; guarda versión `pre-ai` antes. |
| `wh_append_writing` | sí | Añade al final. Lo correcto para continuar una escena. |
| `wh_list_writing_versions` | no | |
| `wh_restore_writing_version` | sí | Guarda versión antes de restaurar. |

**Notas al pie.** El manuscrito las lleva en Markdown con la sintaxis de
siempre: `[^etiqueta]` en la prosa y, al final del cuerpo, un bloque
`[^etiqueta]: texto` (las líneas siguientes de una misma nota van con cuatro
espacios). `wh_get_writing` usa como etiqueta el **id real** de cada nota
(`[^mf3k2a_x9y8z7]`), y `wh_update_writing`/`wh_create_writing`/
`wh_append_writing` aceptan cualquier etiqueta: si es segura
(`[A-Za-z0-9_-]{1,40}`) y está libre se conserva como id — así una ida y
vuelta por el modelo deja cada nota con el id que tenía —; si no, se genera
uno nuevo. Una referencia sin definición es una nota vacía (la marca no se
pierde); una definición sin referencia se ignora; dos referencias a la misma
etiqueta son dos notas con el mismo texto. `wh_append_writing` sólo convierte
lo añadido y nunca renumera ni toca las notas ya existentes (sus ids quedan
reservados para que un `[^1]` nuevo no choque con ellos). El texto de la nota
es texto plano: no se interpreta Markdown dentro. Sólo el manuscrito tiene
nodo de nota; en codex, diario y biografía `[^1]` sigue siendo texto literal.

**Codex**

| Herramienta | Escribe | Notas |
|---|---|---|
| `wh_list_codex` | no | Filtra por tipo y, con `revealed`, por fichas reveladas o no a los jugadores; cada ficha trae `revealed` (booleano). |
| `wh_get_codex_entry` | no | Trae `revealed` y, si la ficha está revelada, `reveal` ({at, note?, moment?}). |
| `wh_create_codex_entry` | sí | `fields` es un mapa etiqueta→valor libre. |
| `wh_update_codex_entry` | sí | `fields` se **fusiona**; `""` borra una clave; `replaceFields:true` sustituye el mapa entero. |
| `wh_set_revealed` | sí | `{entryIds[], revealed, note?, moment?, eraId?}`: revela a los jugadores (o vuelve a ocultar) varias fichas de una vez; todo o nada, y una ficha que ya está en ese estado se deja como está (con `note` o `moment` renueva la marca). Con el Códex apagado devuelve `engine-disabled` antes de tocar nada. Se deshace con `__undo`, pero se rechaza (`cannot-undo`) si alguna ficha se editó, reveló u ocultó después; nunca se fuerza. |

**Diario**: `wh_list_diary`, `wh_create_diary_entry`, `wh_update_diary_entry`.

**Líneas de tiempo**: `wh_list_timelines`, `wh_create_timeline`,
`wh_list_events`, `wh_create_event`, `wh_update_event`, `wh_connect_events`.

**Esquema**: `wh_list_outlines`, `wh_create_outline`, `wh_list_beats`,
`wh_create_beat`, `wh_update_beat`. `wh_create_outline` acepta `template` y
deja plantado un beat sheet entero (`save-the-cat`, `three-act`,
`heros-journey`, `five-act`) ya traducido.

**Notas**: `wh_list_notes`, `wh_create_note`, `wh_update_note` (con
`inbox: true` para el buzón sin proyecto).

**Recortes y visión**: `wh_list_snapshots`, `wh_get_snapshot`,
`wh_view_snapshot_image`, `wh_tag_snapshot`, `wh_list_instagram_collection`,
`wh_import_snapshots`, `wh_download_snapshot_media`. Ver §11.

**No todo proyecto tiene todos los motores.** Escribir en uno apagado se
rechaza con `engine-disabled`, porque la fila sería invisible para el autor
(§16). `wh_get_context` y `wh_list_projects` traen `enabledEngines`.

**Contenedores antes que contenido.** Esquemas, tableros, storyboards, planes
de vídeo y líneas de tiempo son contenedores: sin uno, el motor no tiene dónde
guardar nada. Todos tienen ya su `wh_create_*` (§15). Los mapas no: necesitan
una imagen que el modelo no tiene.

## 5. Seguridad

- **Token obligatorio** (`Authorization: Bearer …`) en todas las rutas. Vale el de cualquier clave no revocada (ver «Varias claves del puente»).
- **Se rechaza cualquier petición con cabecera `Origin`.** Un adaptador MCP o
  un CLI no manda `Origin`; una página web siempre lo hace. Esa regla cierra
  el agujero que CORS no cubre: que una web cualquiera que visites dispare
  escrituras a ciegas contra tu localhost.
- Sólo loopback, cuerpo máximo 4 MB.
- Dos interruptores independientes: puente encendido, y escritura permitida.
- Antes de sobrescribir un escrito se guarda una versión con motivo `pre-ai`,
  visible y restaurable desde el historial del propio editor.
- Todo lo que escribe un modelo queda en `<userData>/aibridge/audit.jsonl`
  con herramienta, entidad, resumen y **estado previo** (sin campos base64),
  para poder deshacer a mano lo que no tiene historial propio. Las 20 últimas
  líneas se ven en Ajustes.
- Lo que llega de fuera se convierte de Markdown a HTML y pasa por
  `sanitizeRichHtml` antes de tocar la base de datos.

## 6. API HTTP (por si quieres saltarte MCP)

```
GET  /api/health        { ok, appOpen, enabled, writesEnabled, inFlight, version }
GET  /api/tools         { tools: [{ name, description, writes, schema }] }
GET  /api/instructions   { instructions }
POST /api/call          { tool, args, client? } -> { ok, result } | { ok:false, error, code }
```

Ejemplo:

```bash
curl -s http://127.0.0.1:8766/api/call \
  -H "Authorization: Bearer $WH_BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"wh_search","args":{"query":"Odiseo"}}'
```

Códigos de error que puede devolver: `app-closed`, `timeout`, `unknown-tool`,
`writes-disabled`, `bridge-disabled`, `bad-args`, `not-found`, `no-project`,
`tool-error`, `missing-token`, `bad-token`, `revoked-token`, `browser-origin-refused`.

### Importar una sesión de Scheherazade

`wh_import_story_session` recibe `projectId`, `worldId`, `sessionId`, `title`,
`content` y, opcionalmente, `refresh`. `content` es el capítulo Markdown completo
de `session_export`: si la exportación indica `truncated`, hay que concatenar
todas las páginas en orden usando `next_offset` antes de llamar a Writer.

La primera llamada devuelve `state: "created"` y el ID de la pieza. Repetirla
con la misma sesión devuelve el mismo ID y `state: "unchanged"`. Si el texto de
origen cambió, devuelve `source_changed` sin alterar el manuscrito. Una segunda
llamada con `refresh: true` lo actualiza solo cuando el cuerpo de Writer sigue
igual que tras la última importación; antes guarda la versión anterior. Si el
autor editó el capítulo, devuelve `local_modified` y conserva sus cambios.
El título local tampoco se sustituye al actualizar el texto.
La procedencia guarda `sourceRef` (`hoard://scheherazade/session/<sessionId>`)
y `sourceRevision` (`sha256:<hash>` del Markdown exportado), siguiendo el
contrato de referencias de HoardLink.

## 7. Dónde está cada pieza

| Fichero | Papel |
|---|---|
| `src/services/aiBridge/manifest.ts` | **Fuente única** del catálogo y del briefing. Datos puros: lo importan el renderer, el main y el adaptador. |
| `src/services/aiBridge/tools/*.ts` | Los handlers, uno por dominio, más `shared.ts` (coerción de argumentos, ámbito de proyecto, Markdown). |
| `src/services/aiBridge/tools/index.ts` | Tabla nombre → handler. |
| `src/services/aiBridge/dispatch.ts` | Escucha `aibridge:request` a nivel de módulo y responde. |
| `src/services/aiBridge/markdown.ts` | Markdown ⇄ HTML de TipTap, sin dependencias; con `footnotes: true`, las notas al pie del manuscrito. |
| `electron/aibridge/server.ts` | El puerto HTTP y su política de acceso. |
| `electron/aibridge/rpc.ts` | El canal main→renderer con correlación por id. |
| `electron/aibridge/state.ts` | Token principal, interruptores y registro de auditoría. |
| `electron/aibridge/keys.ts` | Las claves con nombre (almacén `keys.json`; el fichero `token` es la clave principal). |
| `electron/aibridge/mcpStdio.ts` | El adaptador MCP. **No importa `electron`**: ahí no hay runtime de Electron. |
| `src/components/settings/AiBridgePane.tsx` | La sección de Ajustes. |
| `tests/ai-bridge.ts` | Paridad manifiesto↔handlers e ida y vuelta del Markdown. |

## 8. Añadir una herramienta

1. Entrada en `BRIDGE_TOOLS` (`manifest.ts`) con descripción **útil** y su
   esquema. El test crítico exige más de 40 caracteres de descripción: si no
   sabes qué poner, la herramienta probablemente no está bien pensada.
2. Handler en el fichero de dominio que le toque, dentro de
   `src/services/aiBridge/tools/`.
3. Alta en `TOOL_HANDLERS` (`tools/index.ts`).
4. Si escribe, devuelve `withAudit(resultado, { projectId, entityId, summary, before })`.

`tests/ai-bridge.ts` falla si el manifiesto y la tabla de handlers se
desincronizan en cualquiera de los dos sentidos, así que el fallo aparece en
la puerta de release y no delante de un modelo.

## 9. Canales IPC nuevos: la trampa

Todo canal IPC tiene que estar en `IPC_CHANNEL_ROLES`, en
`electron/security.ts`. La política es *fail-closed*: un canal que no esté en
ese mapa se rechaza siempre, en silencio, aunque el `ipcMain.handle` exista.
`ig:listCollection` llevaba así desde que se escribió — se arregló al montar
esto, y hay un test que lo fija.

## 10. Todavía no

- Instagram → Recortes con etiquetado por modelo de visión.
- Herramientas de borrado (con confirmación en la app).
- El resto de motores: notas, esquema, tablero, biografía, arcos.
- Eventos push: que el modelo se entere de lo que vas escribiendo.

---

## 11. Fase 2 — visión, recortes, notas y esquema

Añadido en la segunda pasada (2026-08-30). El catálogo pasa de 23 a 37
herramientas.

### El bucle de visión

La pieza nueva de verdad: una herramienta puede devolver **imágenes**, no sólo
texto. Un handler adjunta `_media: [{ base64, mimeType }]` al resultado y el
adaptador MCP lo convierte en un bloque de contenido `type: "image"`, que es lo
que un modelo con visión puede mirar de verdad.

El flujo completo, tal como lo haría un modelo:

1. `wh_list_snapshots` con `untaggedOnly: true, withImageOnly: true` → los
   recortes que valen la pena describir.
2. `wh_view_snapshot_image` → devuelve la imagen, reescalada a 1024 px de lado
   mayor y JPEG al 80 %. Un original de 4000 px no le aporta nada a un modelo
   de visión y sí se come su contexto; con esto una captura de página entera
   viaja en unos 35 KB.
3. El modelo mira la foto y llama a `wh_tag_snapshot` con las etiquetas y una
   descripción de lo que hay REALMENTE en el encuadre.

El base64 nunca aparece en el bloque de texto: iría duplicado y sería ruido
puro en el contexto. Hay test que lo fija (`tests/electron-security.ts`).

### Instagram

- `wh_list_instagram_collection` — lista una colección guardada **sin
  descargar nada**. Lenta a propósito: gallery-dl espacia sus peticiones 6-12 s
  para no despertar a Instagram, así que treinta posts son varios minutos. Por
  eso esta herramienta declara `timeoutMs: 600_000` y el adaptador ajusta el
  timeout del socket a lo que declare cada herramienta.
- `wh_import_snapshots` — guarda los que el usuario haya aprobado, sólo como
  enlaces. Salta duplicados por URL.
- `wh_download_snapshot_media` — descarga la media de UNO. De uno en uno a
  propósito: cada descarga es lenta y así el usuario ve avanzar la cosa.

Tras la descarga ya hay imagen que mirar, y el bucle de visión se cierra.

### Notas y esquema

- `wh_list_notes`, `wh_create_note`, `wh_update_note`. Con `inbox: true` operan
  sobre el buzón sin proyecto (`__inbox__`), que es un ámbito real, no un
  proyecto nulo — así que funcionan aunque no haya ningún proyecto abierto.
- `wh_list_outlines`, `wh_list_beats`, `wh_create_beat`, `wh_update_beat`. Leer
  los beats es la forma más rápida de que un modelo entienda la forma de una
  historia antes de escribir dentro de ella.

### La trampa que costó una vuelta

**`fetch('wh-media://…')` no funciona desde el renderer.** El esquema está
registrado como privilegiado y con `supportFetchAPI`, y la galería lo pinta sin
problema con `<img src>`, pero un `fetch` es siempre *cross-origin*: el
renderer vive en `http://127.0.0.1:5174` (en desarrollo lo sirve Vite; en la
app empaquetada, `electron/rendererServer.ts`).
Relajar la CSP no arregla nada porque el problema es CORS, no CSP.

La solución es la misma que ya usaba el proyecto para Ollama: **por IPC**. El
canal `media:readLibraryFile` lee el fichero en el main —que ya es el dueño de
la raíz de media y de sus comprobaciones de contención— y devuelve base64. Si
alguna vez añades otra herramienta que necesite bytes de un fichero gestionado,
usa `readLibraryBlob()` de `tools/shared.ts`, no `fetch`.

---

## 12. Fase 3 — todos los motores, y grupos de herramientas

Tercera pasada (2026-08-30). El catálogo pasa de 37 a **82 herramientas**:
están conectados los 21 motores del proyecto. (Worldgen se conectó después,
en §23: sus lugares no son filas y necesitaban otro modelo de escritura.)

### Grupos, porque 82 herramientas ahogan a un modelo pequeño

Cada herramienta pertenece a un grupo. Un cliente puede pedir sólo los que
necesita; **`core` va siempre incluido**, porque sin `wh_get_context` y
`wh_search` el resto no sirve de nada.

| Grupo | Qué trae | Nº |
|---|---|---:|
| `core` | contexto, proyectos, búsqueda | 3 |
| `writing` | escritos, esquema, notas, diario | 17 |
| `people` | codex, biografía, relaciones | 12 |
| `story` | líneas de tiempo, semillas, arcos | 18 |
| `script` | escenas de diálogo | 6 |
| `visual` | tablero, galería, mapas, storyboard, vídeo | 18 |
| `research` | recortes e Instagram | 7 |
| `analysis` | anotaciones, auditoría de POV, estadísticas, cobertura narrativa | 10 |

**Cobertura narrativa (`analysis`)** — `wh_get_narrative_coverage` (matriz
personaje×capítulo: mención = prosa del capítulo; `plannedPresence`/`plannedPov`
son enlaces de planificación y no suben el rol; presencia solo manual; POV solo
con marcador `pov:Nombre` o manual), `wh_set_coverage_cell`,
`wh_list_timeline_evidence` (narrado solo si las palabras del título aparecen en
prosa; mención del personaje enlazado sin eso → no narrado; hash obsoleto →
`unverified`+`stale`), `wh_set_timeline_evidence`, `wh_get_manuscript_board`
(list/binder/kanban sobre las mismas filas Writing) y
`wh_list_phrase_recurrence` (muletillas/frases repetidas, sin autocorregir). No
sustituye `wh_pov_audit`, la Biblia del mundo ni los porcentajes de outline.

Cómo se filtra:

```
GET /api/tools?groups=writing,story        →  ~35 en vez de 82
env WH_BRIDGE_GROUPS=script,people         →  en el adaptador MCP
```

Odysseus hace recuperación de herramientas por relevancia, así que ahí puedes
dejarlo sin filtrar. Para un cliente que manda todos los esquemas en cada
turno, filtra.

### Lo nuevo, por motores

**Diálogo (`script`)** — `wh_list_scenes`, `wh_get_scene`, `wh_create_scene`,
`wh_update_scene`, `wh_add_dialog`, `wh_update_dialog_block`. `wh_add_dialog`
resuelve el personaje contra el reparto de la escena, y si no está lo añade
buscando además su ficha de codex por nombre (misma regla que el import de
Fountain). El paréntesis se guarda **sin** paréntesis. Diálogo dual: pasa
`dualWithBlockId` y ambos bloques comparten grupo.

**Arcos (`story`)** — `wh_list_arcs`, `wh_get_arc`, `wh_create_arc`,
`wh_add_arc_beat`, `wh_update_arc_beat`. No se exponen las plantillas a
propósito: guardan claves i18n que hay que resolver con `t()` antes de
convertirse en contenido del autor, y un modelo escribiendo sus propios beats
es mejor que uno pegando claves.

**Relaciones (`people`)** — `wh_list_relationships` (con `entityId` mira los
dos lados), `wh_create_relationship`, `wh_update_relationship`. Éste es el
almacén real; `CodexEntry.relations` es un campo legacy inerte que nadie
escribe.

**Semillas (`story`)** — `wh_list_seeds` (con `orphanedOnly`: qué prometiste y
no cumpliste), `wh_create_seed`, `wh_update_seed`, `wh_add_payoff`. El estado
se **calcula** con `computeSeedStatus`, no se lee de la fila: una semilla sin
payoff y sin cortar sale `orphaned` aunque guarde `planted`.

**Biografía (`people`)** — `wh_list_biographies`, `wh_get_biography`,
`wh_create_biography`, `wh_add_biography_fact`, `wh_update_biography_fact`.
El `confidence` importa: es lo que separa investigación de ficción.

**Tablero (`visual`)** — `wh_list_boards`, `wh_create_board`, `wh_get_board`, `wh_add_board_card`,
`wh_update_board_card`, `wh_connect_board_cards`, `wh_view_board_image`.

**Galería (`visual`)** — `wh_list_images`, `wh_view_image`, `wh_tag_image`.
Segundo bucle de visión: se manda `thumbnailData`, nunca el original.

**Mapas, storyboard y vídeo (`visual`)** — listar, añadir y actualizar pines,
paneles y segmentos, más `wh_create_storyboard` y `wh_create_video_plan`
(§15). Los mapas siguen sin crearse desde el puente: hacen falta una imagen y
sus dimensiones, que un modelo no tiene.

**Anotaciones (`analysis`)** — `wh_list_annotations` y `wh_annotate`. Con
`quote` la nota se ancla a esa frase exacta dentro del texto; sin `quote`, a
la entidad entera. **No hace falta selección viva en el DOM**: se resuelve el
texto plano con el adaptador de anclaje, se localiza con `indexOf` y se
guardan offsets más 40 caracteres de contexto a cada lado, que es exactamente
lo que hace el editor desde una selección real. Anclaje por rango sólo en
`writings`, `codex` y `seeds`. Sirve para que un modelo **pregunte en el
margen** en vez de reescribir la prosa por su cuenta.

**Auditoría y estadísticas (`analysis`)** — `wh_pov_audit` (quién aparece de
verdad: personajes del codex que no salen en ninguna escena, y hablantes en la
página sin ficha, que suele ser un nombre mal escrito) y `wh_writing_stats`.

### writing-stats es de sólo lectura, a propósito

La app escribe sus propias sesiones mientras escribes, con una fila
identificada por la tupla `(projectId, date, 'freewrite', notes:'editor')`. Si
un escritor externo crea una fila con esa firma, el siguiente autoguardado la
absorbe o la borra; y una fecha con otro formato rompe la racha en silencio.
Por eso el puente lee y no escribe ahí.

### La trampa de esta pasada

El filtro de grupos no llegaba: el adaptador construía `?groups=…` pero
`http.request` recibía sólo `url.pathname`, que **tira la query**. Salían 82
herramientas pidieras lo que pidieras. Es un fallo que ningún typecheck
detecta y que sólo apareció al probar el adaptador de punta a punta.

---

## 13. Fase 4 — autoverificación y borrado

Cuarta pasada (2026-08-30). **83 herramientas.** Dos objetivos: que el puente se
pueda verificar sin que nadie haga clic, y que una IA pueda trabajar sola sin
acumular basura.

### El CLI

```
node scripts/wh-bridge.mjs health
node scripts/wh-bridge.mjs tools writing,story
node scripts/wh-bridge.mjs instructions
node scripts/wh-bridge.mjs selftest [--keep]
node scripts/wh-bridge.mjs cleanup [projectId]
node scripts/wh-bridge.mjs call wh_search query=quokka limit=5
```

Lee el token solo, así que no hay que pegar nada. Los argumentos admiten tres
formas: **`clave=valor`** (la buena: PowerShell se come las comillas dobles de
argv, así que un JSON literal en la línea de comandos no llega entero), un
JSON, o `@fichero.json`. El código de salida es 1 cuando la llamada falla, así
que encadena con `&&`.

### El autotest

`POST /api/selftest` (o `wh-bridge selftest`) **crea su propio proyecto**, ejerce
las dieciocho comprobaciones que de verdad se rompen en silencio, y **se borra
entero al terminar**. Tarda unos 200 ms y es seguro contra una instalación real:
`deleteProject` barre toda tabla con `projectId` más los hijos que no lo tienen.

Qué comprueba, y por qué esas y no otras — cada una corresponde a algo que un
typecheck no ve:

- que el Markdown sobrevive el viaje de ida y vuelta;
- que `wh_append_writing` no destruye lo que había;
- que sobrescribir deja una versión `pre-ai` detrás;
- que la búsqueda encuentra una palabra que sólo está en el cuerpo;
- que fusionar un campo del codex no borra los demás, y que `""` borra sólo uno;
- que una relación guardada en el lado A se ve desde el lado B, con el nombre
  denormalizado resuelto;
- que el estado de una semilla es derivado y un pago lo cambia;
- que un arco conserva el nombre de su personaje;
- que `wh_add_dialog` crea el reparto, guarda el paréntesis sin paréntesis y
  empareja el diálogo dual;
- que anclar a una frase funciona y que una cita inexistente se rechaza;
- que los listados no revientan sobre un motor vacío;
- que un `create` sin título se rechaza en vez de aplicarse a medias.

Con `--keep` deja el proyecto para mirarlo; `wh-bridge cleanup` lo borra
después. La limpieza **se niega** a tocar un proyecto cuyo título no empiece
por `Bridge self-test `, así que apuntarla a trabajo real no hace nada.

La primera ejecución ya encontró algo: anclé una anotación a `Smuggler`, que
vive en los campos estructurados del codex, y `getEntityText` sólo devuelve el
cuerpo. Los campos no son anclables. Ahora está en la suite.

### Borrado, por fin

`wh_delete { type, id, reason? }`. Una sola herramienta con un registro de 25
tipos, cada uno apuntando a **la operación correcta** — que aquí importa más
que en ningún otro sitio, porque casi todas tienen cascada: `deleteScene`
desvincula beats del esquema y `deleteCodexEntry` borra filas de unión pero
sólo desvincula el texto que alguien escribió.

Antes de tocar nada abre un `ConfirmDialog` en la app que dice qué se va y qué
se lleva por delante. **Si nadie contesta en dos minutos, no se borra**:
verificado en vivo — la llamada devolvió `declined` y el escrito seguía ahí.
Nunca `window.confirm`: un diálogo nativo puede autorresolverse a `true` al
despertar el equipo, y eso ya destruyó una Timeline de verdad una vez.

El diálogo se compone con `t()`, no en inglés dentro del handler. Hay test que
falla si a un tipo le falta su nombre o su texto de cascada en cualquiera de
los dos idiomas — son claves de plantilla, que el gate de conformance no ve.

Errores rápidos antes de molestar a nadie: un tipo desconocido devuelve la
lista de los admitidos, y un id que no existe devuelve `not-found`. Un modelo
que tantea no llena la pantalla de diálogos.

---

## 14. Deshacer

El log de auditoría ya guardaba qué hizo cada escritura y cómo estaba la fila
antes. Ahora eso se puede revertir, desde Ajustes (botón por línea) o desde el
CLI:

```
node scripts/wh-bridge.mjs audit 20     # qué ha cambiado, lo más nuevo arriba
node scripts/wh-bridge.mjs undo 23      # revertir la línea 23
```

Cada línea se direcciona por su **número de línea** en `audit.jsonl`, no por un
payload que el llamante componga: así nadie puede pedir que se revierta otra
cosa. El log es append-only, así que el número es estable, y el propio deshacer
se apunta como una línea más — que es también cómo se sabe que algo ya se
revirtió (repetirlo devuelve `already-undone`).

Qué hace según el caso:

| Lo que se hizo | Lo que hace el deshacer |
|---|---|
| crear | borra la fila, **por la operación con cascada del motor** |
| actualizar | vuelve a poner los campos registrados |
| borrar | reinserta la fila |

**Y dice la verdad sobre lo que no puede.** Un update devuelve `caveat` con los
campos que realmente se restauraron, porque el log guarda lo que el handler
consideró digno de anotar, no la fila entera. Un delete deshecho devuelve la
fila pero **no** lo que se fue en cascada con ella: esos hijos nunca se
registraron. Es preferible decirlo a poner una marca verde que lo esconda.

### Cómo sabe el log qué tipo de operación fue

No lo declara cada handler: se **deduce del resultado** en el servidor. Todo
resultado de creación lleva `created: true` y todo borrado `deleted: true`, así
que cuarenta call sites no tuvieron que aprenderse un campo nuevo. La única
excepción es la tabla, que sólo el borrado anota — porque sólo él la necesita:
cuando toca reinsertar ya no queda fila de la que deducirla.

### Verificado en vivo

Crear una semilla → `undo` → desapareció, y repetir el undo devolvió
`already-undone`. Cambiar el título de una ficha a "NombreCambiado" → `undo` →
volvió a "Marta", con el `caveat` diciendo qué campos se restauraron.

---

## 15. Fase 5 — contenedores, y una promesa que no era verdad

Quinta pasada (2026-08-30). **87 herramientas, 23 comprobaciones en el
autotest.**

### Lo que yo mismo había roto

`wh_search` prometía buscar «en todos los motores a la vez». Era verdad cuando
había cinco motores conectados. Después de conectar trece más, dejó de serlo y
nadie se enteró: `src/services/projectSearchIndex.ts` sólo leía cinco tablas
—escritos, codex, diario, bloques de diálogo y recortes—. Un modelo que
buscara el texto de una semilla, de un beat o de un evento no encontraba nada
y concluía, razonablemente, que no existía.

Había dos salidas: rebajar la descripción, o arreglar el índice. Arreglarlo,
porque `searchProjectContent` alimenta también la búsqueda global de la propia
app — la carencia no era sólo para las IA.

Ahora lee **diecisiete** orígenes: los cinco de antes más notas, beats de
esquema, semillas, payoffs, arcos, beats de arco, relaciones, hechos
biográficos, eventos de línea de tiempo, pines de mapa y anotaciones.

**Lo que deliberadamente NO entra**, y por qué: `boardNodes`,
`inspirationImages`, `storyboardPanels` y `videoSegments` guardan imágenes en
base64 dentro de la propia fila. Indexarlas significaría deserializar todas las
fotos del proyecto en la primera pulsación de tecla — exactamente la regresión
que `engines/board/index.ts` documenta haber arreglado una vez. Sus títulos
siguen siendo alcanzables por los resolvers de entidad. La descripción de
`wh_search` ahora lo dice en voz alta, en vez de dejar que el modelo lo
descubra buscando.

### La comprobación que lo mantiene honesto

Arreglar el índice no basta: dentro de tres motores más volvería a estar
mintiendo. El autotest planta ahora una palabra inventada (`wh-probe-…`) en un
campo que **el título no muestra** de cada origen, y exige que `wh_search` la
encuentre **con el `engineId` correcto** — porque un acierto atribuido al motor
equivocado manda al lector al sitio equivocado.

```
PASS  search covers every engine its own description promises
```

Diez sondas: esquema, semilla, payoff, columna vertebral del arco, beat de
arco, relación, hecho biográfico, evento, nota y anotación. Quita un origen de
`buildIndex` y esta comprobación falla nombrando cuál.

### Motores que eran callejones sin salida

Cuatro motores se podían leer y rellenar, pero no **empezar**. `wh_add_board_card`
pide un `boardId`; `wh_create_beat`, un `outlineId`; y no existía forma de crear
ni el tablero ni el esquema. En un proyecto nuevo, un modelo podía listar esos
motores eternamente y no poner nunca nada dentro. Para «una IA trabajando sola
con la app» eso no es una carencia menor: es la mitad del programa apagada.

| Nueva | Qué hace |
|---|---|
| `wh_create_outline` | Esquema vacío, o un beat sheet entero con `template`. |
| `wh_create_board` | Tablero, con `surface`: `cork`, `slate`, `grid`, `blueprint`. |
| `wh_create_storyboard` | Storyboard; `columns` se recorta a 1–8. |
| `wh_create_video_plan` | Plan de vídeo, con `totalDuration` en texto libre. |

Los mapas se quedan fuera a propósito: un mapa es una imagen subida con sus
dimensiones, y un modelo no la tiene. `wh_add_map_pin` sigue sirviendo sobre
los mapas que ya existan.

### Las plantillas de beat sheet, y por qué se resuelven aquí

`wh_create_outline` con `template: 'three-act'` deja quince beats plantados,
con su posición en la historia y su color. Las plantillas guardan **claves
i18n**, no prosa, y hay que resolverlas con `t()` **en el momento de crear**:
las cadenas resultantes se copian a las filas del autor y viven ahí para
siempre. Una clave escrita hoy no se volvería a traducir nunca. Es la misma
regla que ya seguía `OutlineEngine.tsx` por su lado; el autotest la vigila
ahora comprobando que ningún beat empieza por `outline.`.

La lista de plantillas válidas está **una sola vez**: `TEMPLATE_IDS` sale de
`BEAT_SHEET_TEMPLATES` en el manifiesto, y el handler importa esa misma
constante. El esquema no puede ofrecer una plantilla que el handler rechace.
(`engines/outline/types.ts` es un módulo hoja sin imports: no arrastra Dexie ni
DOM al proceso principal, que es la regla que protege el manifiesto.)

### Crear obliga a poder borrar

Tres contenedores nuevos son tres cosas nuevas que un modelo puede dejar
tiradas, y —peor— tres cosas que el **deshacer** tendría que quitar. `undo.ts`
borra lo creado «por la operación con cascada del motor» si la encuentra en
`DELETABLE`, y si no, con un `db.table(...).delete()` pelado que dejaría
huérfanos todos los hijos. Así que `board`, `storyboard` y `video-plan` entran
en el registro con su `deleteBoard` / `deleteStoryboard` / `deleteVideoPlan`
correctos, sus seis claves i18n en ambos idiomas, y su sitio en el `enum` de
`wh_delete`.

Eso último no lo recordé yo: lo cazó el test crítico con
`"board" can be deleted but is not offered in the schema`. Es exactamente para
lo que está.

### La trampa de esta pasada

Ninguna, y merece decirse: el índice extendido, los cuatro contenedores y las
tres entradas de borrado pasaron typecheck, lint, conformance y los 29 tests
críticos a la primera. Lo único que falló fue el `enum` de `wh_delete`, y falló
en el sitio donde tenía que fallar — en la puerta de release, no delante de un
modelo.

### Deshacer un borrado: por fin verificado

Era lo único de §14 que quedaba sin comprobar, porque llegar a un borrado
registrado exige que un humano confirme un diálogo. Ahora se comprueba en
`tests/ai-bridge.ts` contra la base de datos real, separando las dos cosas que
antes iban juntas: la confirmación tiene su propio test (deniega si nadie
contesta), y lo que quedaba —que la fila vuelva a su sitio— se prueba llamando
a `undoAuditEntry` con una entrada de log sintética.

Las cuatro propiedades que fija:

- Deshacer una **creación** usa la operación con cascada del motor: el test
  crea una semilla con su payoff y comprueba que tras el undo **no queda el
  payoff huérfano**. Un `delete` pelado sobre la tabla lo habría dejado ahí,
  invisible para siempre.
- Deshacer un **update** devuelve los campos registrados y dice en `caveat`
  cuáles fueron.
- Deshacer un **borrado** reinserta la fila y devuelve `caveat`, porque los
  hijos que se fueron en cascada no vuelven.
- Un borrado que **no anotó su tabla** se rechaza (`cannot-undo`) en vez de
  adivinarla, y una fila que ya volvió se rechaza (`bad-args`) en vez de
  duplicarse.

---

## 16. Fase 6 — escribir en un motor apagado

Sexta pasada (2026-08-30). **88 herramientas, 26 comprobaciones en el
autotest.**

### El agujero

`Project.enabledEngines` decide dos cosas: qué pestañas se ven y —vía
`getOrderedEnabledEngineIds`— contra qué motores busca la búsqueda global de la
app. Ningún handler del puente lo miraba. Una IA que creara un evento en un
proyecto con `timeline` apagado escribía una fila que el escritor **no podía
alcanzar por ninguna vía**: sin pestaña donde aparecer y saltada por su propia
búsqueda. Ni error, ni aviso: trabajo hecho y perdido.

No es un caso de laboratorio. El preset `essentials` —el de cualquier proyecto
nuevo— enciende **tres** motores de veintiuno. Justo el escenario en el que más
probable es que alguien le pida a una IA que construya algo desde cero.

### La guardia

`resolveProjectForEngine(args, engineId)` sustituye a `resolveProjectId` en las
dieciséis escrituras de nivel superior. Resuelve el proyecto **y** rechaza con
`engine-disabled` si el motor está apagado, con un mensaje que dice por qué y
qué hacer:

```
The "seeds" engine is switched off in "VIdeos sobre libros", so anything
written there would be invisible to the writer — no tab, and the app's own
search skips it. Call wh_enable_engine with engineId "seeds" to turn it on,
or ask them first if you are not sure they want it.
```

**Leer no se bloquea.** Si las filas están ahí, decirlo es más útil que fingir
que el motor no existe: «hay doce eventos guardados pero la pestaña está
apagada» es una respuesta; un `not-found` es una mentira.

**El buzón de notas es la excepción**, y por el motivo correcto: no pertenece a
ningún proyecto, así que no hay ningún motor que pueda estar apagado en él.
`wh_create_note` con `inbox: true` pasa de largo.

**Las escrituras de hijo no llevan guardia** (`wh_add_dialog`,
`wh_create_beat`, `wh_add_payoff`…): no reciben `projectId`, sino el id de un
padre que sólo puede existir si el motor estuvo encendido alguna vez. Se cierra
la puerta de entrada, no cada habitación.

### `wh_enable_engine`, y por qué no existe `wh_disable_engine`

Rechazar sin dar salida deja a un modelo atascado, así que hay una herramienta
para encender un motor. Es **de un solo sentido, a propósito**:

- Encender es aditivo. Añade una pestaña, vuelve a hacer buscables filas que ya
  estaban, y el escritor lo deshace en un clic.
- Apagar **esconde** material que además deja de ser buscable. Eso no lo decide
  un modelo. Que la asimetría se note es parte del diseño, y la descripción de
  la herramienta la explica.

`engineOrder` no se toca: `getOrderedEnabledEngineIds` añade al final lo que
esté encendido y no figure en el orden, así que la pestaña aparece sin
reordenar lo que el autor hubiera colocado.

### La prueba se deriva del manifiesto

Cada herramienta declara ahora su `engineId` (`inEngine(...)` en el ensamblado,
igual que `grouped(...)`). Eso convierte la comprobación en algo que no hay que
mantener a mano:

```js
const guarded = BRIDGE_TOOLS.filter(
  (tool) => tool.writes && tool.engineId && tool.schema.properties.projectId,
);
```

El autotest crea un proyecto con **un** motor encendido —`pov-audit`, que no
tiene escrituras— y llama a las dieciséis pasando **sólo `projectId`**. Cada
una tiene que fallar con `engine-disabled`. Que se pase el argumento mínimo es
deliberado: una herramienta que falle por «falta el título» en vez de por el
motor es una herramienta con la guardia en el sitio equivocado, y el informe la
nombra.

Añadir mañana un `wh_create_lo_que_sea` sin guardia hace fallar esta
comprobación sola, sin que nadie se acuerde de actualizar una lista.

### La lista de motores vive dos veces, y hay un test que lo vigila

`BRIDGE_ENGINE_IDS` está escrita a mano en el manifiesto. No es pereza:
`engines/_registry.ts` importa iconos de lucide-react, y el manifiesto lo carga
también el **proceso principal**, que no puede arrastrar React. Así que la
copia se compara con el registro vivo en `tests/ai-bridge.ts`, donde ambos
existen: si aparece un motor nuevo y nadie toca la lista, el test lo dice por
su nombre. (`worldgen` estuvo exento hasta §23; hoy ya no hay exenciones: los
22 motores del registro están en la lista y tienen herramientas.)

### Verificado en vivo

Contra un proyecto real de Luis, «VIdeos sobre libros», con `seeds` apagado:
`wh_create_seed` devolvió `engine-disabled` y **no escribió nada**. Antes de
esto habría dejado una semilla que él no habría visto nunca.

### La trampa de esta pasada

El test de deshacer que escribí hace un rato usaba un `projectId` inventado
(`'undo-test-project'`) que nunca existió como fila. Funcionaba porque nadie
comprobaba el proyecto; con la guardia puesta, reventó al instante con
`No project with id "undo-test-project"`. El test estaba apoyado en el mismo
descuido que la guardia arregla — y lo correcto era arreglar el test, no
ablandar la guardia.

---

## 17. Fase 7 — auditoría de promesas

Séptima pasada (2026-08-30). **88 herramientas, 28 comprobaciones.** Ninguna
funcionalidad nueva: esta pasada consistió en revisar **cada descripción contra
su handler** y arreglar todo lo que el código no cumplía. Un modelo externo no
tiene más documentación que esas frases; una frase falsa es una funcionalidad
rota que ningún typecheck ve.

### La guardia de motores estaba a un tercio

La pasada anterior guardó las dieciséis escrituras que reciben `projectId`, y
documenté el razonamiento —«guardia en la puerta, no en cada habitación»—
convencido de que bastaba. No bastaba, por dos agujeros:

- Un motor se puede apagar **después** de que existan sus filas. Todos los
  `wh_update_*` seguían escribiendo en él.
- **Galería y mapas no tienen herramienta de creación aquí en absoluto.** Sus
  imágenes y mapas los crea la app. Así que `wh_tag_image`, `wh_add_map_pin` y
  `wh_update_map_pin` —el motor entero— llegaban al proyecto por el padre, sin
  pasar por ninguna puerta. Justo donde yo había escrito que ya no pasaba.

Ahora `assertEngineEnabled(projectId, engineId)` va en las **cuarenta y nueve**
escrituras que declaran motor. `wh_restore_writing_version` hubo que
reestructurarlo: `restoreSnapshot` hacía todo el trabajo y devolvía sólo prosa,
así que para cuando respondía ya no quedaba nada contra lo que comprobar —y la
escritura ya había ocurrido—. Ahora lee el snapshot **antes**, lo que además
arregló su registro de auditoría, que apuntaba al snapshot en vez de al escrito
(un deshacer habría caído en el vacío).

### Y la prueba, esta vez, es completa

Las herramientas por id no se pueden sondear con un id inventado: cargan el
padre primero, así que fallan con `not-found` y no demuestran nada. Hacen falta
padres de verdad. El autotest construye ahora **uno por motor**, escribe
directamente en Dexie el mapa y la imagen que ninguna herramienta sabe crear,
apaga **todos** los motores del proyecto y lanza las treinta y tres llamadas.

Encima hay la propiedad que sostiene el resto:

```js
const covered = new Set([...guardadasPorProjectId, ...PARENT_PROBE_TOOLS]);
const uncovered = BRIDGE_TOOLS.filter(t => t.writes && t.engineId && !covered.has(t.name));
```

Una herramienta de escritura nueva que declare motor y a la que nadie añada
sonda hace fallar la comprobación con su nombre. Sin eso, las otras dos sólo
demostrarían algo sobre las herramientas que alguien se acordó de incluir.

### Las otras nueve promesas que no se cumplían

| Herramienta | Decía | Hacía | Ahora |
|---|---|---|---|
| `wh_get_context` | «y si está permitido escribir» | no devolvía ese campo | lo pide al proceso principal, que es quien tiene el interruptor |
| `wh_add_payoff` | «pasa la semilla a pagada» | devolvía `'paid'` fijo | lo calcula con `computeSeedStatus`: una semilla **cortada** sigue cortada |
| `wh_list_scenes` | «con su reparto» | devolvía sólo quien tiene frases | devuelve `cast` (el reparto) **y** `speakers` (quien habla) |
| `wh_list_annotations` | «si el ancla se ha ido (huérfana)» | leía una marca que sólo refresca la app al abrir la entidad | la recalcula contra el texto actual, y `orphanStatus` dice cuál de las dos te dieron |
| `wh_connect_board_cards` | `enum` cerrado de 14 tipos | aceptaba cualquier cadena | ya no declara `enum`: el tablero admite tipos propios y los pinta gris |
| `wh_add_board_card` | «da una posición» | tiraba la `x` si faltaba la `y` | honra cada coordenada por separado, como su herramienta hermana |
| `wh_list_diary` | «más recientes primero» | fijadas primero, luego por fecha | lo dice, y avisa de que un `limit` pequeño puede traer una entrada fijada antigua |
| beats, semillas, pagos | «0-100» | guardaba `-40` o `250` tal cual | `optPercent` recorta, como ya hacían intensidad, fuerza y certeza |
| `wh_create_codex_entry` | «la app siembra una plantilla» | creaba la ficha vacía | dice que eso es el formulario de la app, no esta herramienta |

### Las anotaciones huérfanas se recalculan sin escribir

Tentación evidente: llamar a `reanchorEntityAnnotations`, que es exactamente lo
que hace la app al abrir una entidad. Pero eso **escribe** —marca huérfanas,
mueve offsets—, y `wh_list_annotations` es `writes: false`. Un cliente en modo
sólo lectura que mutase filas de paso rompería la única garantía que ese modo
da.

Así que se usa el mismo resolvedor y se descarta el resultado: se calcula el
veredicto y se devuelve, sin tocar la fila. La app sigue persistiéndolo cuando
el autor abra la entidad; esto sólo se niega a informar de uno viejo. Y se hace
sólo con `engineId` + `entityId`, porque recalcular lee el cuerpo entero: para
un listado de proyecto habría que cargar el manuscrito para responder a un
listado. El campo `orphanStatus` dice cuál de los dos casos ha ocurrido, en vez
de dejar que el modelo lo suponga.

### Lo que la auditoría confirmó que sí era verdad

Merece decirse, porque el valor de una auditoría depende de que también mire lo
que funciona: la lista de motores de `wh_search` coincide exactamente con el
índice, incluida la advertencia sobre los motores con imágenes; los 28 tipos de
`wh_delete` son exactamente las claves de `DELETABLE`; «si no hay nadie, no se
borra nada» es real; la semántica de fusión de `fields` está implementada tal
cual se describe; los recortes se ordenan como dicen y `restoreSnapshot` toma
su instantánea previa; y **ninguna** herramienta declara un argumento que su
handler no lea, ni lee uno que no declare, ni tiene mal el flag `writes`.

### El fallo de esta pasada

Tres, y los cazó la propia sonda antes de salir de la máquina:
`wh_import_snapshots` llamado sin `projectId`, la tabla de mapas es `worldMaps`
y no `maps`, y el import devuelve las filas en `snapshots`, no en `imported`.
La sonda sirvió de test de sí misma.

El cuarto es el que importa: esos tres fallos ocurrían **dentro** del
constructor de sondas, así que su proyecto anfitrión se quedaba sin borrar —
tres «Bridge self-test …» huérfanos en la instalación de verdad, justo lo que
esta suite promete no hacer nunca. Ahora el borrado va en un `finally` con el
id capturado en el momento de crearlo, no al final del camino feliz.

## 18. IA nativa — el mismo ejecutor, dentro de la app

Octava pasada (2026-08-31). El puente externo sigue igual para Odysseus, Claude
Desktop u OpenCode; lo nuevo es que la app tiene ahora su propia IA por dentro,
y que **usa exactamente las mismas herramientas**. El plan está en
`docs/PLAN-IA-NATIVA.md`; lo hecho, aquí.

### Un ejecutor, dos puertas

Antes, `handleCall` en `electron/aibridge/server.ts` hacía todo: buscar la
herramienta, validar, decidir si podía escribir, reenviar al renderer, apuntar
en auditoría. Eso se ha sacado a `src/services/aiRuntime/executorCore.ts`:

```ts
const executeTool = createToolExecutor({ writesEnabled, relay, audit });
// puente:   executeTool(call, { origin: 'bridge',  clientLabel })
// copiloto: executeTool(call, { origin: 'copilot', projectId, policy, conversationId })
```

Lookup → `validateToolArgs` (coerción de tipos, claves desconocidas fuera) →
`applyProjectScope` (el copiloto inyecta y **fuerza** su `projectId`: una
llamada a otro proyecto se rechaza aunque el modelo insista) →
`decidePermission` (el interruptor de escritura del puente; para el copiloto la
política del proyecto: sólo lectura / preguntar / permitir; `wh_delete` nunca se
pregunta dos veces) → aprobación → relay → línea de auditoría con `origin` y
`conversationId` → índice de auditoría de vuelta, que es lo que el botón
«deshacer» de la tarjeta necesita.

El autotest de 28 comprobaciones pasa por ahí sin cambios, y `tests/ai-runtime.ts`
demuestra con dependencias falsas que el puente y el copiloto producen la misma
línea de auditoría para la misma llamada.

### Conexiones por IP, y ninguna clave en el renderer

`electron/ai/` es la pasarela: `connectionStore.ts` guarda las conexiones en
`<userData>/ai/connections.json` (escritura atómica) y las claves **sólo** como
texto cifrado con `safeStorage`; el renderer recibe `hasSecret` y una pista
(`sk-…7f3a`), nunca la clave, nunca una URL que no haya escrito el propio
usuario. `urlPolicy.ts` normaliza lo que se teclea (`192.168.1.20:1234`,
`http://host:8080/v1`, `https://api…`), clasifica la localidad (loopback / red
local / remoto), rechaza usuario:contraseña, query y fragmentos, y bloquea HTTP
plano hacia fuera salvo consentimiento explícito. La pasarela no sigue
redirecciones, acota cuerpos y redacta la clave de cualquier error.

Dos adaptadores: **OpenAI compatible** (`/v1/models`, `/v1/chat/completions`
en SSE con ensamblado de fragmentos de tool-calls, `/v1/images/generations`) y
**Ollama nativo** (`/api/tags` con capacidades, `/api/show` de respaldo,
`/api/chat` NDJSON con `num_ctx` 32K y reintento sin `think` para modelos que
no lo aceptan). Un `/v1/models` que responde 404 marca la conexión como
`modelsRouteMissing` y la detección local la ignora: un backend de Docker en el
8100 estuvo a punto de salir como «servidor de IA encontrado».

### Modelos locales con veredicto

`fit.ts` es la estimación de si un modelo cabe: pesos + caché KV (capas × 2 ×
8 cabezas × 128 × 2 bytes × contexto × factor de familia para las
arquitecturas híbridas) + sobrecarga, contra la VRAM menos 1 GB y el 75 % de la
RAM. Cuando no cabe entero en la GPU, la velocidad se estima por ancho de banda
(450 GB/s la GPU, 55 GB/s la RAM) sobre los **bytes que se leen por token**: un
mixture-of-experts con 3B activos lee su rebanada, no el archivo, y por eso
`qwen3-coder:30b` sale «Bien · rápido» en una 4070 Ti mientras un 27B denso en
q8 sale «Justo · lento». Las etiquetas son perfecto / bien / justo / no cabe, y
«≈» avisa de que el tamaño es de catálogo, no medido. Es una estimación limpia:
la forma sigue el enfoque público de llmfit (MIT), sin código de Odysseus (AGPL).

### El copiloto

Panel derecho por proyecto (`src/components/copilot/`), hilo por proyecto en
Dexie v27 (`aiThreads`, `aiMessages`, `aiProjectSettings`; van en el backup con
la estrategia `ai-assistant`, se barren al borrar el proyecto). El bucle está en
`electron/ai/agentLoop.ts`: selección léxica y determinista de herramientas por
turno (núcleo + motor abierto + motores nombrados + coincidencias, máximo 16,
sólo lectura si la política lo dice), 8 rondas / 20 llamadas / 16 KB por
resultado, sin repetir una llamada idéntica que ya falló. Las escrituras que
piden permiso llegan al renderer como tarjeta con Permitir / Rechazar, y cada
tarjeta ejecutada guarda su `auditIndex` para deshacer desde ahí mismo. Los
modelos sin herramientas hablan pero no tocan nada, y lo dicen.

### Estudio de imagen

Motor `image-studio`, sin tablas: cada resultado es una fila de
`inspirationImages` con `source: 'generated'` y `generation { prompt, modelId,
seed, width, height… }`, así que aparece en Galería con la etiqueta «generated»
y sobrevive a los backups sin ninguna estrategia nueva. La herramienta
`wh_generate_image` (grupo `visual`) hace lo mismo desde el puente o el copiloto
y devuelve ids más una miniatura, nunca el base64 dentro del JSON. Sirve con
cualquier servidor que exponga `/v1/images/generations` —Odysseus en el 8100, un
proxy de OpenAI, o `scripts/fake-image-server.mjs`, que responde con PNG reales
de un color derivado del prompt y con el que se probó todo el camino sin GPU.

### Lo que se probó en vivo

Autotest 28/28 a través del ejecutor compartido; `wh_get_context` informa del
proyecto abierto; conexión de imágenes añadida por IP, probada, guardada sin
duplicarse y fijada como modelo de imagen por defecto; generación desde la
pestaña y desde `wh-bridge call wh_generate_image` con la fila en Galería y la
línea de auditoría `generated 1 image(s)`; en el copiloto, un turno de lectura
(`list codex` → lista de personajes) y uno de escritura con tarjeta de permiso
(crear nota → Permitir → nota creada → deshacer desde la tarjeta).

### El fallo de esta pasada

Una tormenta de IPC. `loadModels` volvía a listar las conexiones al terminar,
eso entregaba un array nuevo a un efecto que dependía del array, y el efecto
volvía a llamar a `loadModels`: 192 `ai:listConnections` en segundos, el
renderer sin recursos y una pantalla negra tras recargar. La regla que queda:
un `load` actualiza su fila **en su sitio**, y los efectos se declaran sobre
ids (`connectionKey`), nunca sobre la identidad de un array de la store.

### Todavía no

- Runtime de difusión local (fase 6B del plan): el estudio genera contra un
  servidor; no descarga ni ejecuta modelos de imagen por sí mismo.
- La velocidad estimada con reparto GPU/RAM es una heurística de ancho de
  banda; no mide.
- La conexión `CLIProxyAPI` migrada de los ajustes antiguos aparece «sin
  respuesta» mientras ese proxy no esté arrancado; se puede borrar o editar.

## 19. Fase 6B — imágenes sin servidor ajeno, y velocidad medida

Novena pasada (2026-08-31, segunda mitad de la noche). Tres encargos de Luis
al despertar a medias: que el modelo de texto por defecto fuera el Qwen que
mejor se adaptara a su equipo, que el veredicto de velocidad midiera en vez de
estimar, y que la fase 6B del plan —descargar y ejecutar modelos de imagen en
local— se hiciera «con Odysseus como ejemplo».

### Lo que se copió de Odysseus y lo que no

Odysseus resuelve la imagen local con un servidor Python (`diffusion_server.py`:
torch + diffusers + FastAPI) que un «cookbook» instala con pip. Se copió la
**forma**: un servidor propio en un puerto fijo de loopback que habla la API de
imágenes, arrancado por la app con un modelo cargado, y un catálogo con
veredicto de hardware. No se copió ni una línea ni la dependencia de Python:
Writer's Hoard empaqueta **stable-diffusion.cpp** (MIT, C++/ggml, binario de
una release fijada) igual que empaqueta Ollama.

### El runtime

`electron/ai/sdRuntimeManifest.ts` fija la release `master-709-92a3b73` con el
SHA-256 que GitHub publica para cada activo. Tres backends en Windows: Vulkan
por defecto (42 MB, cualquier GPU), CUDA 12 para NVIDIA (352 MB + 563 MB de
runtime CUDA) y sólo CPU (21 MB); Linux y macOS también están fijados.
`electron/ai/sdRuntime.ts` descarga, verifica, extrae y guarda el runtime en
`<userData>/ai/sd-runtime/<backend>/` con recibo; descarga los pesos del
catálogo a `<userData>/ai/image-models/<id>/`; lanza `sd-server` en
`127.0.0.1:8102` con un modelo cargado y lo cambia cuando se pide otro; y **lo
apaga a los cinco minutos sin uso**, porque la GPU es la misma que usan los
modelos de texto y 7 GB de SDXL aparcados en VRAM son 7 GB que Ollama no
tiene.

Las descargas pasan por `electron/ai/download.ts`: `.part` + hash incremental,
reanudación con `Range` cuando el servidor lo honra (Hugging Face y GitHub lo
hacen), tamaño y huella comprobados antes de renombrar, y nada que no cuadre
llega jamás a `sd-server`. Un test en `tests/electron-security.ts` levanta un
servidor HTTP local y demuestra las cuatro ramas: entera, reanudada, corrupta y
con `Content-Length` mentiroso.

### El catálogo

`src/services/aiRuntime/imageCatalog.ts`: cinco modelos, todos de repositorios
sin puerta (nada de aceptar términos con cuenta), cada archivo con su tamaño y
su `lfs.oid` de agosto de 2026. DreamShaper 8 y SD 1.5 Q8 (SD1, 512 px),
DreamShaper XL Turbo y SDXL Turbo (SDXL), y FLUX.1 schnell Q4 en cuatro archivos
(difusión GGUF, VAE, CLIP-L, T5 Q8). El veredicto (`computeImageFit`) mira la
VRAM a la resolución nativa: cabe entero → perfecto/bien; los pesos en RAM con
`--offload-to-cpu` → justo; sin GPU sólo SD1 y despacio. La licencia de cada
modelo va en la tarjeta con su enlace: SDXL Turbo es sólo no comercial y hay
que saberlo antes de descargar 7 GB.

### La conexión y el adaptador

El servidor gestionado aparece como conexión integrada «Imágenes locales
(stable-diffusion.cpp)» (`builtin-sd`, tipo `sdcpp`): no se edita, no se borra,
no lleva clave. Su adaptador (`electron/ai/adapters/sdcpp.ts`) usa la API
nativa asíncrona del servidor (`/sdcpp/v1/img_gen` → trabajo → sondeo →
cancelación) en vez de la ruta OpenAI, porque esa no acepta semilla, pasos ni
prompt negativo salvo incrustados en el prompt. La semilla se elige en el
adaptador cuando el usuario la deja al azar, así la fila de Galería siempre
puede reproducir la imagen. El Estudio y `wh_generate_image` no cambiaron: la
conexión entra por la misma puerta que la falsa del 8101 o Odysseus en el
8100. Lo único nuevo para ellos es «Nativo del modelo» como formato por
defecto: un UNet de 512 px a 1024 hace sopa.

### Velocidad medida

Ollama devuelve `eval_count` y `eval_duration` en el último trozo; el
adaptador OpenAI cronometra la ventana de streaming y cuenta tokens del
servidor si los da, o caracteres/4 marcados como aproximados. Cada respuesta
de más de 24 tokens se funde con media móvil (α = 0,35) en
`<userData>/ai/model-metrics.json`, por conexión y modelo; una lectura exacta
sustituye de golpe a un historial aproximado. `decorate` la pega al descriptor
y `computeFit` la usa: el número reemplaza la banda estimada y, si el modelo
no cabía entero en la GPU, también la etiqueta (justo sólo significaba «va a
ir lento»; si va a 28 tok/s, es bien). El copiloto muestra «28 tok/s · 73
tokens» bajo cada respuesta.

### Y el mejor modelo, en un botón

`src/services/aiRuntime/pickModel.ts` ordena los modelos de chat: herramientas
obligatorias, etiqueta de fit, banda de velocidad, tokens/s (la medida cuenta
entera, la estimación al 70 %: una conjetura no adelanta a una lectura por
dos tokens), huella de memoria (más ligero antes), general antes que «coder»,
visión, parámetros. En Valores por defecto: «Usar el mejor modelo local». En el
equipo de Luis eligió `qwen3-coder:30b` (MoE, 19 GB, bien · 28 tok/s medidos)
y es lo que quedó por defecto. Las funciones clásicas además **recaen** en ese
mismo ranking si la ruta por defecto no responde —el proxy CLIProxyAPI
apagado dejaba «resumen» muerto— y avisan una vez con un toast de qué modelo
han usado.

### Dos guardias más

- `check-conformance` lee `electron/security.ts` y todos los
  `ipcMain.handle('…')` del proceso principal: un canal sin rol declarado
  falla la conformidad con su nombre, en vez de fallar en ejecución con
  «Forbidden IPC sender» (la trampa de §9, ahora con red).
- El conversor Markdown → TipTap anida listas **dentro** del `<li>` padre y lee
  un guion a ras de margen bajo un «1.» como sublista, que es lo que escriben
  todos los modelos; la numeración ya no vuelve a 1 en cada personaje.

### Probado en vivo

Runtime Vulkan instalado en 8 s con huella verificada; SD 1.5 Q8 descargado,
cancelado a 600 MB y reanudado con `Range` desde el `.part`; «Usar» lo fija
como imagen por defecto; el Estudio genera un faro en un acantilado a 512×512
en menos de 15 s contando el arranque del servidor; `wh-bridge call
wh_generate_image` genera con el modelo local en 5 s con el servidor caliente
y a resolución nativa; `sd-server` queda vivo (160 MB de proceso, pesos en
GPU) y se apaga solo. El copiloto midió 28 tok/s en `qwen3-coder:30b` y el
botón del mejor modelo lo escogió.

### La auditoría (un subagente, adversarial)

Antes de cerrar, un subagente revisó los ficheros nuevos de main buscando
bugs. Encontró ocho, todos corregidos: `extractZip` re-lanzaba en Linux
porque GNU tar no lee zip (ahora `unzip`); el temporizador de inactividad de
5 min podía matar una generación en curso (ahora el sondeo lo empuja); un
fallo de `spawn` (binario ausente) colgaba 4 min en vez de fallar al
instante; `mergeSpeedSample` no tenía techo y un servidor mentiroso podía
envenenar la velocidad con una muestra (ahora ≤ 2000 tok/s); la extracción de
CUDA (dos zips) podía tirar las DLLs del runtime (ahora se aplana todo el
árbol a un directorio); la escritura de métricas tenía una carrera
lectura-modificación-escritura (ahora dentro de la cadena de escritura); las
descargas dejaban el cuerpo de respuesta sin drenar en los throws tempranos
(ahora `cancel()`); y `decorate` duplicaba modelos fijados repetidos.

Y en la verificación en vivo tras la auditoría salió un noveno, más
importante: el sondeo del trabajo tenía un timeout de conexión de 10 s, y un
`sd-server` saturado (fallback a CPU porque Ollama ocupaba la tarjeta) no
contestaba a tiempo, así que **un sondeo lento tiraba una imagen buena**.
Ahora un error transitorio de sondeo no es un fallo: se reintenta hasta el
plazo global; sólo un `failed` explícito, un abort o el plazo terminan el
trabajo.

### La contención de VRAM, que es física, no un bug

En la 4070 Ti de 12 GB, con `qwen3.8:27b` residente en Ollama (8,9 GB, la
tarjeta al 95 %), `sd-server` Vulkan no consigue memoria y cae a CPU: una
imagen que tarda 7 s con la tarjeta libre tarda minutos. No es un fallo del
código —es un modelo grande y un modelo de imagen peleando por 12 GB—. El
apagado por inactividad devuelve la VRAM del lado de la imagen; del lado del
texto, Ollama la mantiene 30 min (`OLLAMA_KEEP_ALIVE`). Con la tarjeta libre,
generación limpia en 7 s incluyendo arranque del servidor y carga del modelo,
con semilla reproducible.

### Todavía no

- Sin medida de segundos por imagen: el veredicto de imagen sigue siendo
  estimación por VRAM.
- Sin img2img ni LoRA en el Estudio, aunque el servidor los sirve.
- CUDA 12 está fijado y su extracción de dos zips corregida, pero no se ha
  probado en vivo esta noche (Vulkan sí).
- Aviso de contención de VRAM en el Estudio cuando un LLM grande ocupa la
  tarjeta: no está; sólo el apagado por inactividad mitiga una dirección.

## 20. Dos vueltas de auditoría más (2026-08-31, madrugada)

Tras dejar todo en verde, dos auditorías adversariales con subagente sobre el
código más nuevo y sobre zonas que las pasadas anteriores tocaron poco. Ocho
hallazgos reales; los importantes, corregidos y verificados.

### Vuelta 2 — copiloto y runtime de inferencia

**El bug gordo: el stream se cancelaba a sí mismo.** El dock refresca su lista
de mensajes con un efecto que depende de `dataVersion`, y el runner hace
`bumpData()` tras cada evento —incluido cada `delta`—. Ese efecto llamaba a
`settleStaleMessages`, que marcaba como `cancelled` cualquier fila en
`streaming`, **incluida la del turno en curso**. Al primer token la respuesta
mostraba «cancelado» y sólo aparecía entera al final. Tapado en turnos con
herramientas, evidente en respuestas de sólo texto. Arreglo: `settleStaleMessages`
sólo sanea huérfanos —`if (runsByThread[threadId]) return;`—; el run vivo cierra
su propia fila en `finish()`. Verificado en vivo: respuesta de sólo texto que
ahora fluye token a token (antes: «cancelado» toda la generación). Test nuevo en
`critical.browser.ts` (`testCopilotRunGuards`): la fila `streaming` de un run
vivo sobrevive a un refresco; el huérfano sí se sanea; un turno no arranca si ya
hay otro en vuelo.

**Carrera de doble envío.** `sendCopilotTurn` comprobaba «ya hay un run» y sólo
tras varios `await` registraba el run. Un doble clic/Enter metía dos turnos.
Arreglo: un `Set` de módulo reclama el hilo de forma síncrona antes del primer
`await`, liberado en `finally`.

**Lectura de sondeo sin límite.** El sondeo del trabajo de imagen pasaba
`maxBodyBytes` a `request()`, que —a diferencia de `requestJson`— lo ignora, y
leía el cuerpo con `res.text()` sin cota. Arreglo: `readBounded` exportado y
usado en el sondeo (el `request()` no puede acotar porque también sirve
streaming).

### Vuelta 3 — runtime de imagen y puente externo

**Corrupción silenciosa de UTF-8 (lo más serio).** El puente HTTP acumulaba el
cuerpo con `raw += chunk.toString('utf8')` por trozo, y el lector de respuesta
MCP con `raw += chunk`. Un carácter multibyte partido en la frontera de dos
trozos se decodificaba por mitades → dos U+FFFD. En prosa en castellano por
encima de ~64 KB, corrupción silenciosa del manuscrito (el JSON seguía
parseando). Arreglo: acumular `Buffer`s y decodificar una vez
(`Buffer.concat(...).toString('utf8')`) en el cuerpo; `res.setEncoding('utf8')`
en la respuesta. Demostrado con un caso partido a propósito: antes `"A��ade"`,
ahora `"Añade"`.

**Carrera de descarga/instalación de imagen.** `downloadSdModel` e
`installSdRuntime` comprobaban su guarda antes de varios `await` y reclamaban el
`AbortController`/estado después: un doble clic lanzaba dos descargas a los
mismos ficheros (corrupción de pesos que `refreshModels` no ve porque sólo mira
el tamaño). Arreglo: reclamar de forma síncrona antes del primer `await`, con
`try/finally` para liberar en todos los caminos; `stopSdServer` movido dentro
del `try` para que un throw no deje el `installAbort` colgado.

**Error «busy» pegajoso.** Un doble clic dejaba un error rojo permanente en una
fila de modelo ya instalado (el segundo clic devolvía `busy` y el store lo
pintaba; el primero, que sí terminaba, no lo limpiaba). Arreglo: `busy` es un
rechazo por concurrencia, no un fallo de esa fila; no se pinta.

**Buffer de stdin sin cota.** El lector JSON-RPC por stdin (`mcpStdio.ts`)
acumulaba sin límite si el cliente no mandaba salto de línea. Cota de 8 MB: al
pasarse, se descarta y se responde `-32700`.

### Zonas revisadas y limpias

Teardown de las suscripciones push `sd:status`/`sd:progress` (una sola vez a
nivel de módulo, sin fugas por montaje); `assertIpcSender` en los 27 handlers;
validación de argumentos IPC; barras de progreso (guardan `total > 0`);
cancelación del Estudio; auth del puente (loopback + sin Origin + Bearer,
fail-closed); framing de stdio (trozos partidos, CRLF, múltiples mensajes por
trozo).

### Todavía no (de estas vueltas)

- Índice de auditoría no estable ante rotación del log (`audit.jsonl` > 5 MB →
  `audit.jsonl.1`, el contador reinicia a 0) ni ante una línea truncada por un
  crash a mitad de append: un `undoBridgeChange` con un índice viejo podría
  revertir la entrada equivocada. Requiere una sesión que escriba > 5 MB de
  auditoría (uso muy intenso) y deshacer una tarjeta antigua. Arreglo correcto
  = índice monotónico global persistido; se deja anotado por no tocar el núcleo
  de auditoría/undo con prisa.
- Reanudación de descarga: no valida el `Content-Range` de un 206, y un `.part`
  completo-pero-sin-renombrar se re-descarga entero. Ambos se autocorrigen (la
  verificación tamaño+SHA descarta cualquier `.part` corrupto), por eso quedan
  como endurecimiento de baja prioridad.

## 21. Del texto a la imagen, y referencias (2026-08-31, mañana)

Dos funciones pedidas por Luis, hechas y verificadas en vivo.

### Seleccionar texto en Escritos → generar imagen

El editor (TipTap, `src/components/editor/TiptapEditor.tsx`) ya tenía una barra
flotante sobre la selección para "Añadir nota"; ahora, cuando el host pasa
`onGenerateImage`, muestra además "Generar imagen". Al pulsarla, el modelo de
texto ELEGIDO DEL PROYECTO (`settings.chatRoute ?? defaults.chat` — la misma
cadena que el copiloto, no el global de `callAi`) lee el extracto más ±500
caracteres de contexto y redacta un prompt de imagen en inglés (SD rinde mucho
mejor en inglés; el usuario lo ve y puede editarlo). El prompt se entrega al
Estudio por un store efímero (`imageHandoffStore`) —no por la URL, que un prompt
largo reventaría— y el Estudio lo drena al montar y genera solo en cuanto hay
ruta resuelta. Pieza de servicio nueva: `completeOnRoute(route, system, user)`
en `aiService.ts` (una compleción de un tiro sobre una ruta explícita, con el
mismo fallback local que `callAi`). Verificado: «A quokka in the doorway.» →
"A tiny brown marsupial with a distinctive wide smile, standing in a wooden
doorway…" → imagen del quokka en la galería.

### Imagen de referencia (img2img)

El Estudio acepta una imagen de referencia cuando el modelo la admite
(`routeModel.family` ∈ {sd1, sdxl}; FLUX no hace img2img clásico y no muestra el
control). Formato del servidor confirmado leyendo el binario de sd-server:
`init_image` (un data URL) y `strength` (0..1, defecto .75, menos = más fiel a
la referencia) al NIVEL SUPERIOR del payload de `/sdcpp/v1/img_gen`. Camino
completo: UI (subida de fichero → data URL → `makeThumbnail` a ≤1024 para acotar
→ preview + slider) → `generate()` → `startGeneration` → `AiImageRequest`
(`initImage`, `strength`) → IPC → **`asImageRequest` valida y acota** (data URL
de imagen ≤ 32 MB, strength a [0,1]) → gateway → adaptador sdcpp →
`buildSdJobPayload` añade `init_image`+`strength` → sd-server. Verificado de
punta a punta: una referencia burda (círculo amarillo sobre azul, franja verde
abajo) + "a glowing golden moon over a green meadow" → luna en la misma
posición, cielo azul, hierba abajo; la composición de la referencia respetada.

### Nota de física que reaparece

El flujo de "seleccionar texto → imagen" usa un modelo de texto y luego uno de
imagen seguidos, así que en una sola GPU AGRAVA la contención de VRAM (el LLM
queda residente y el modelo de imagen cae a CPU). No es un bug de la función;
con la GPU libre (`ollama stop`), la generación img2img tardó ~15 s. Candidato a
mejora: liberar/avisar de la VRAM entre el paso de texto y el de imagen.

### Ya no está en "Todavía no"

- ~~Sin img2img ni LoRA en el Estudio~~ → img2img hecho (LoRA sigue pendiente).

## 22. Endurecimiento de adaptadores (2026-08-31, rondas 6-7)

Auditoría en paralelo de los dos adaptadores de chat. En `openAiCompatible.ts`:
la URL firmada de una imagen de resultado (con query) la rechazaba
`normaliseBaseUrl` → ahora se parsea con `new URL` + `classifyHost`, manteniendo
la MISMA política SSRF (mismo host, o https público); la descarga de imagen no
tenía timeout y podía colgar la cola serializada → `combineSignals([signal,
AbortSignal.timeout(120s)])`; el nombre de la tool se ensamblaba por
concatenación (`+=`) → asignación única (un servidor que repite el nombre por
delta daba "get_xget_x"); errores de stream sin `redact()`; `content`/`reasoning`
emitidos sin comprobar string; y la velocidad se marcaba como no-aproximada pese
a ser reloj de pared. En `ollama.ts` (ruta primaria de qwen): el error de stream
sin `redact()` y las mismas guardas de string. La ruta caliente de qwen se
confirmó correcta (tool calls completos en un mensaje, args objeto/string,
eval_duration ns→tok/s con guarda de división por cero, retry de think una sola
vez). Todo en verde: build de producción (renderer+electron), 33 tests.

## 23. El motor de mundos, y desarrollo continuo por IA (2026-08-31)

Worldgen era el único motor sin herramientas. No por pereza: sus lugares **no
son filas**. Un mundo se guarda como semilla + parámetros + una lista ordenada
de ediciones (`edits`, JSON), y el terreno, los asentamientos, los reinos y las
carreteras se regeneran de forma determinista cada vez que se abre (~26 s para
un planeta de 2048 celdas). Un `wh_create_settlement` que escribiera una fila
no existiría para el mapa. Así que el puente habla el idioma del motor.

### Cómo se lee un mundo sin abrirlo

`engines/worldgen/bridgeAccess.ts` → `openWorldForReading(world, depth)`:

1. Si una vista tiene el mundo abierto, su objeto vivo ES el estado actual: se
   lee (`getCachedWorld`) y no se toca nada.
2. Si no, se carga la instantánea (`loadSnapshot`, ~1 s) en un objeto **privado**,
   se le reproducen las ediciones guardadas (`new PaintSession(snap, edits)`) y
   se construye la geografía y el atlas ahí. Caché privada de 2 mundos / 5 min,
   con clave `id|params|depth|edits`, así que una lista distinta rehace.
3. Si nunca se generó en esta máquina, se lanza la forja en segundo plano
   (worker) y la herramienta responde `{ pending: true, code: 'generating' }`.
   Es un **resultado, no un error**: el modelo espera medio minuto y repite. Las
   instrucciones del manifiesto se lo dicen.

### Cómo se escribe: un solo escritor

`WorldView` lee `world.edits` UNA vez y luego es dueño de la lista: cada
pincelada añade a su `PaintSession` y un guardado con debounce escribe el blob
entero. Cualquiera que escribiera la fila mientras la vista está abierta
perdería la carrera (el siguiente guardado de la vista lo pisa) y la vista no
lo vería. De ahí `core/liveWorlds.ts`: la vista abierta se registra
(`registerLiveWorld`) con `apply(edits)` —que llama a su propio
`applyEditGroup`, el mismo camino que una pincelada, con undo/redo de la
vista— y `snapshot()`. `applyWorldEdits(world, edits)` entrega a la vista si
la hay y, si no, añade a la fila. El resultado dice `delivered: 'view' | 'row'`
y la auditoría guarda `before: { edits }` con `table: 'generatedWorlds'`, así
que el **undo genérico** (`update` → restaurar campos) devuelve la lista
anterior. La vista abierta recarga cuando cambia la prop `world.edits` (efecto
nuevo en `WorldView`), con lo que un undo externo también se ve en pantalla.
Caveat honesto: el undo es de **grano grueso** —restaura la lista entera, así
que pinceladas posteriores a la edición de la IA se van con ella. Un undo más
fino necesitaría identidad por edición, y `PaintSession` la prohíbe a
propósito (las ediciones son JSON plano sin ids).

### Las 17 herramientas (`tools/worldgen.ts`)

Lectura: `wh_list_worlds`, `wh_get_world` (con `live` y `forging`),
`wh_list_places`, `wh_find_place` (plegado de acentos, prefijo antes que
contenido, empate por importancia), `wh_place_at` (elevación, mar, lugar más
importante al alcance), `wh_world_summary` (el gacetero en Markdown),
`wh_list_waypoints`, `wh_list_place_links`. Escritura: `wh_add_place`
(asentamiento/ruina/hito; rechaza mar si el mundo está en memoria),
`wh_rename_place`, `wh_move_place`, `wh_remove_place`, `wh_restore_place`,
`wh_add_label`, `wh_add_waypoint`, `wh_update_waypoint`, `wh_link_place`
(enlaza un lugar con codex/escena/escrito/evento, misma identidad
`<worldId>::<key>` que escribe `SpatialEntityInspector`). Los lugares se
direccionan por la clave derivada de posición que ya usan las ediciones del
propio motor (`settlement:512,201`, `landmark:volcano:12,6`): un renombrado
desde aquí es EXACTAMENTE el que haría el lector a mano.

`wh_remove_place` no es un borrado: añade una edición `remove` reversible, y
por eso está exento (con aserción en su descripción) de la regla "una sola
herramienta de borrado" en `tests/ai-bridge.ts`. Los borrados de verdad
(`generated-world`, `world-waypoint`) van por `wh_delete`, y
`deleteWorldCascade` ahora se lleva también los enlaces de sus lugares y las
teselas renderizadas (antes quedaban huérfanos; el mismo camino que usa la UI).

### Hallazgo colateral: ninguna vista se refrescaba tras una escritura de la IA

Al verificar en vivo el undo sobre el mundo abierto, la fila cambió y la
pantalla no. La causa no era de worldgen: `makeEntityHook` (y `makeGraphHook`,
`makeReadOnlyHook`) leen una vez por scope y refetch sólo tras SUS propias
escrituras; el puente y el copiloto escriben por otro camino. Llevaba así desde
la Fase 0 — el copiloto creaba una entrada del códice y la pestaña abierta no
la mostraba hasta remontar; el motor de notas se lo había resuelto sólo a sí
mismo con `wh:notes-changed`. Ahora `engines/_shared/dataChanged.ts` define el
evento genérico `wh:data-changed` (`notifyDataChanged` / `onDataChanged`),
`runBridgeTool` lo emite tras toda escritura (`writes: true`) y tras `__undo`
con lo que sabe la envoltura de auditoría (tabla, entidad, proyecto), y los tres
hooks refetch al oírlo. Verificado en vivo: `wh_rename_place` → índice del mundo
actualizado; `/api/undo` → la vista abierta recarga la lista y el nombre vuelve.
Cualquier lista montada de cualquier motor se beneficia.

### La tapa de 16 herramientas

Worldgen tiene 17 y el turno del copiloto ofrece 16 (3 fijas). Antes se
cortaba por orden de declaración; ahora `toolSelection.ts` ordena dentro de
cada motor por coincidencia léxica con el mensaje, así que «link the place to
the scene» conserva `wh_link_place` y «gazetteer summary» conserva
`wh_world_summary`. Con aserción en `tests/ai-runtime.ts`.

### Lo que se probó

- En vivo, sobre «mundo 2» de Luis (2048×1024, 10 ediciones): lectura sin vista
  abierta (`wh_list_places` 638 ms en `places`; `full` 12 s la primera vez y
  ~20 ms después, por la caché privada), `wh_find_place`, `wh_place_at`,
  `wh_world_summary` (26 k caracteres). Con la vista abierta: `wh_add_place`
  → `delivered: 'view'`, Pincel (10→11), la ciudad en el índice de la vista;
  `wh_rename_place` en vivo; `/api/undo` recarga la vista abierta. El mundo
  quedó exactamente como estaba (undo de las dos ediciones de prueba).
- `tests/worldgen-bridge.ts` (crítico, nuevo): forja real de un planeta de
  128 celdas, instantánea, `wh_add_place` sobre tierra → `wh_find_place` lo ve
  en la reproducción privada, `wh_place_at` lo resuelve, una lista cambiada no
  reutiliza la caché, undo genérico del renombrado devuelve la lista y la
  lectura posterior lo refleja, una vista registrada recibe la edición sin
  tocar la fila, y el cascade borra enlaces e instantánea.
- Autotest del puente (`wh_self_test`): tres pasos worldgen sin forjar nunca
  (el camino fila), 31/31.
- Novedad de método: los harnesses de navegador (`tests/critical.browser.ts`
  y el autotest) corren también en Chromium headless (Playwright) fuera de
  Electron, con IndexedDB real. Es lo que permitió iterar sin la máquina de
  Luis; el gate sigue siendo el de Windows.


## 24. Mejoras pendientes cerradas, y el Atlas real (2026-08-31, tarde)

### VRAM: el modelo de texto se aparta antes de que cargue el de imagen

Dos piezas. (1) `AiChatRequest.releaseAfter`: el flujo «seleccionar texto →
imagen» pide al modelo de texto que se descargue al terminar su respuesta
(`keep_alive: 0` en Ollama) SÓLO cuando la ruta de imagen es el runtime local
(`builtin-sd`); una API de imagen remota no necesita la GPU. Validado en
`asImageRequest`/`asChatRequest` como todo campo nuevo (lección #54). (2)
`electron/ai/vramRoom.ts`: justo antes de que `ensureSdServer` arranque
sd-server, mide la VRAM libre (nvidia-smi) y, si no da para `entry.vramBytes`
+ 1 GB, pide a cada Ollama LOCAL (loopback o embebido; nunca uno de otra
máquina) que descargue lo que tenga cargado (`/api/ps` → `/api/generate
{model, keep_alive: 0}`) y espera hasta 6 s a que `/api/ps` quede vacío. Sin
medida (otro fabricante) descarga siempre que haya algo cargado: acertar
cuesta segundos, fallar cuesta minutos. La contención sigue siendo física
(§19); esto sólo decide quién se sienta.

### Descargas, auditoría, velocidad

- `download.ts`: un `.part` completo que pasa el hash se adopta sin volver a
  la red (antes se borraba y se bajaban los gigas otra vez); un 206 sólo es
  reanudación si `Content-Range` empieza exactamente en `received` — un proxy
  que devuelve otro rango ya no se concatena a ciegas. Test en
  `tests/electron-security.ts`.
- `aibridge/state.ts`: los índices de auditoría son continuos a través de la
  rotación (sidecar `audit.offset`); `audit.jsonl.1` sigue siendo direccionable
  por número, y un undo anterior a la rotación sigue contando. Antes, tras
  rotar, el `#412` de una tarjeta del copiloto apuntaba a OTRA línea. Test.
- `run-critical-tests.cjs`: el bundle nativo de tests externaliza `electron`;
  antes `app` era `undefined` dentro de él y cualquier test que tocara
  `app.getPath` fallaba en silencio.
- `ollama.ts`: si el servidor no manda `eval_duration`, tok/s por reloj de
  pared con `approximate: true` (como el adaptador OpenAI).
- Estudio/Galería: «Usar como referencia (img2img)» desde cada resultado del
  Estudio y desde el lightbox de la Galería (`ImageHandoff.initImage`).

### Atlas real — motor `real-atlas`

La pregunta de Luis: ¿motor aparte o preset de worldgen para quien escribe en
el mundo real (o el real con cambios)? Motor aparte, y además un preset. En
worldgen los lugares se DERIVAN del relieve que el lector pinta; en el mundo
real son hechos que el autor afirma: Lisboa está donde está, el bar de la
calle tal no existía en 1936. Son filas con autoridad, y las filas ya tienen
todo el aparato (backup, búsqueda, sweep, puente, undo). Dos tablas (Dexie
v28): `atlasPlaces` (nombre, tipo, alias, lat/lon WGS84, dirección, país,
padre, época, `description` = en la historia, `realNotes` = datos comprobados,
fuentes, `fictional` para un Macondo dentro del mapa real, etiquetas) y
`atlasDivergences` (título, categoría, lugar opcional —sin lugar es global—,
`reality`, `fiction`, `reason`, `since`). Borrar un lugar NO borra sus
divergencias (son hechos sobre el libro): las desancla y sube sus hijos.

UI en `engines/real-atlas/components/`: pestañas Lugares/Divergencias, lista
con búsqueda plegada (mismo `foldForSearch` que worldgen) y filtro por tipo,
árbol padre→hijo, editor con coordenadas validadas y enlace a OpenStreetMap
(`window.open`, nunca `<a href>` en Electron), padre sin ciclos, divergencias
del lugar, deep link `?place=`, borradores que sobreviven al refresco
(`useRowDraft`: se re-siembra sólo si cambia el id o si `updatedAt` se movió y
no había nada escrito). Preset «Realista» (`realist`): escritos, códice,
atlas, cronología, esquema, recortes, galería; y el atlas sugerido en
novelista, biógrafo y periodista.

Puente (`tools/realAtlas.ts`, 9 herramientas, 115 en total):
`wh_list_atlas_places` (búsqueda por nombre/alias, filtro por tipo, cuenta de
divergencias), `wh_get_atlas_place` (padre, hijos, divergencias),
`wh_create_atlas_place` / `wh_update_atlas_place` (coordenadas en rango y por
pares, padre del mismo proyecto y sin ciclo, `before` en la auditoría),
`wh_list_divergences` / `wh_get_divergence` / `wh_create_divergence` /
`wh_update_divergence`, y `wh_reality_check`: un informe para que el copiloto
pueda decir «tienes tres lugares reales sin nada comprobado» antes de dar por
coherente el escenario. Autotest: 5 pasos + dos sondas de búsqueda
(`wh-probe-atlas`, `wh-probe-divergence`) + guardias de motor apagado.

### Método: las puertas corren también en el contenedor

Novedad de esta tarde que cambia el ritmo: con `npm ci --ignore-scripts` +
el binario de Electron descargado y `xvfb-run`, la suite crítica ENTERA
(nativa + navegador + arranque + Vite) corre en el contenedor de Claude, y los
harnesses de navegador corren además en Chromium headless (Playwright) con un
user-agent de Electron (sin él, `isDesktop()` es falso y el arranque escoge
`BrowserRouter`). La máquina de Luis queda para la confirmación final y las
pruebas en vivo, no para cada iteración.

## 25. Investigación: fuentes graduadas, afirmaciones derivadas y 14 herramientas nuevas

Motor `inquiry` («Investigación»), categoría investigación; por defecto en el
preset Periodista y sugerido en Biógrafo y Realista. Esquema de datos v35
(`inquiryCases`, `inquiryClaims`, `inquiryHypotheses`, `inquiryRatings`,
`enrichmentRuns`; las citas ganan campos opcionales de graduación y retractación).
Lo que importa para el puente:

- **El estado de una afirmación se DERIVA, nunca se guarda**
  (`engines/inquiry/derive.ts`): retractada > disputada a mano > sin respaldo
  (una confirmación manual no sobrevive a su evidencia) > confirmada a mano >
  corroborada (≥2 orígenes independientes) > afirmada. Dos extractos del mismo
  origen cuentan como UNA fuente independiente; los orígenes desconocidos nunca
  se agrupan entre sí. Por eso ninguna herramienta puede fijar el estado, y cada
  respuesta lleva los recuentos de extractos y de fuentes independientes.
- **`asOf`** (`YYYY`, `YYYY-MM` o `YYYY-MM-DD`) en las herramientas de lectura:
  deja fuera lo que no estaba vigente, y «terminada» (`validTo` pasó) no es
  «desactualizada» (no se ve hace más de `staleDays`, 365 por defecto).
- **Privacidad.** Un personaje del códice es privado salvo `publicFigure: true`,
  y ese indicador solo lo cambia el autor desde la interfaz (no hay herramienta
  para ello, a propósito). `wh_enrich_codex` se niega con el código
  `private-person` y una pista antes de enviar nada; `wh_search_library` quita
  de la consulta los nombres de personas privadas y se niega si solo quedaba un
  nombre; el informe las rotula «persona privada».

### Las 14 herramientas (`tools/inquiry.ts`, manifiesto en `manifestInquiry.ts`, grupo `research`, 141 en total)

| Herramienta | Escribe | Motor | Qué hace |
| --- | --- | --- | --- |
| `wh_grade_source` | sí | (biblioteca de investigación) | Gradúa una fuente: fiabilidad A-F, credibilidad 1-6 (se lee `B2`), origen; `clear` la deja sin graduar. Deshacer restaura, incluido quitar lo que no existía (`__absent` en `before`). |
| `wh_retract_source` | sí | (biblioteca) | Retracta una fuente (o con `restore`, la repone). No borra nada; devuelve cuántas afirmaciones se vieron afectadas (`claimsAffected`, `becameUnsupported`, `weakened`…). |
| `wh_bibliography` | no | (biblioteca) | La bibliografía en APA (por defecto), MLA o Chicago, ordenada por primer autor y en el idioma de la app, igual que la exportación y el manuscrito publicado: una fuente retractada sigue en la lista con una nota final `[Retirada: fecha — motivo]`. Cada entrada lleva `grade`, `retracted`, `retractedAt` y `retractReason`; `includeRetracted:false` las omite de la respuesta (`omittedRetracted` dice cuántas). |
| `wh_list_claims` | no | `inquiry` | Filtros por estado, entidad, etiqueta, tiempo y texto, `asOf`, paginación; cada afirmación con su estado derivado y ambos recuentos. |
| `wh_add_claim` | sí | `inquiry` | Exige al menos un extracto existente (`supports`) o una cita textual (`quotes`, que se registra como extracto pendiente). Tripleta estructurada opcional. |
| `wh_update_claim` | sí | `inquiry` | Edita campos, `supports` (reemplaza, nunca por debajo de uno), `manualStatus` (exige `reason`), `retract`/`restore`. |
| `wh_inquiry_timeline` | no | `inquiry` | Cronología, contradicciones (predicados de un solo valor) y tramos desconocidos (se informan, no se rellenan). |
| `wh_add_hypothesis` | sí | `inquiry` | Añade una hipótesis. |
| `wh_rate_hypothesis` | sí | `inquiry` | Una celda de la matriz (CC, C, N, I, II, NA o `none`). |
| `wh_ach_matrix` | no | `inquiry` | Puntúa solo inconsistencia, diagnosticidad, sensibilidad; el veredicto dice «la menos contradicha hasta ahora», nunca «demostrada». |
| `wh_enrich_codex` | sí | `inquiry` | `candidates` (solo busca) o `apply` (rellena campos vacíos, guarda el QID, archiva una fuente C3 de wikidata.org, registra una ejecución). |
| `wh_undo_enrichment` | sí | `inquiry` | Revierte una ejecución; conserva lo que el autor editó después y lo dice. |
| `wh_inquiry_report` | no | `inquiry` | Informe en Markdown con la comprobación de citas (marca, no oculta). No llama a ningún modelo. |
| `wh_search_library` | sí | `inquiry` | Pregunta por el hub a la biblioteca de lectura y a las páginas guardadas (`POST <hub>/api/apps/<app>/call`, `library_search` y `search_links`, `{q, limit}`); los resultados se archivan como fuentes sin graduar con una referencia `hoard://` en las notas y su vista previa como extracto PENDIENTE. `save:false` solo mira. |

Las cinco escrituras con `engineId` y `projectId` (`wh_add_claim`,
`wh_add_hypothesis`, `wh_enrich_codex`, `wh_search_library`) se niegan con
`engine-disabled` si el motor está apagado, antes de validar argumentos; las
que llegan por un id (`wh_update_claim`, `wh_rate_hypothesis`,
`wh_undo_enrichment`) cargan la fila y comprueban `assertEngineEnabled` y
`assertRowInScope`. Las citas y los códices a los que apunta una escritura se
validan con `requireLinkedRow`: de otro proyecto dan `scope`, inexistentes
`not-found`.

**Borrado.** Solo por `wh_delete`, con los tipos nuevos `inquiry-claim` y
`inquiry-hypothesis` (ambos en cascada sobre las valoraciones; las fuentes y los
extractos nunca se tocan). Borrar una cita con afirmaciones apoyadas en ella se
rechaza («retráctala»).

**Deshacer (`undo.ts`).** Tres añadidos: `before` puede llevar `__absent` (campos
que la fila no tenía: se quitan), el deshacer de `wh_enrich_codex` revierte la
ejecución entera (campos, QID, fuente creada) en lugar de borrar su recibo, y
deshacer las fuentes archivadas por `wh_search_library` se niega mientras alguna
afirmación se apoye en ellas.

**`wh_get_research_evidence`** añade (sin quitar nada) `grade`, `origin`,
`retracted` y `retractReason` por cita. **`wh_search`** indexa ahora
afirmaciones e hipótesis (no el estado, que es derivado).

### Red y seguridad

- **Wikidata** (`electron/wikidata.ts`, IPC `wikidata:request`, solo ventana
  principal): el renderer nombra una operación (`search`, `entity`, `labels`) y
  main construye la única petición permitida contra `www.wikidata.org`; User-Agent
  identificado, cola en serie con 250 ms de separación, 12 s de tiempo de espera,
  3 MB de tope, `redirect: 'error'`, errores tipados. El CSP ya permitía https.
- **Hub de la familia** (`electron/familySearch.ts`, IPC `family:search`):
  dos apps (`borges`, `links`), una herramienta fija cada una, consulta ≤200
  caracteres y límite 1-10; token del puente; hub apagado → `hub_unreachable`,
  nunca una excepción. Las pruebas de seguridad (`tests/wikidata-main.ts`,
  `tests/family-search-main.ts`) corren en la suite crítica.

### Pruebas

`npm run test:inquiry` (lógica pura, migración v34→v35, enriquecimiento con
`fetch` simulado, interfaz, herramientas del puente y el autotest del puente) y,
en la suite crítica, `testInquiryBridge` (manifiesto, banderas, esquemas,
comportamiento, privacidad, scope de copiloto, deshacer, borrado) y
`testBridgeSelfTest` (47 comprobaciones, incluidas 8 de investigación, la sonda
`wh-probe-claim` de búsqueda y las guardias de motor apagado para las
herramientas nuevas). De paso se corrigió una comprobación ya rota del autotest:
`wh_run_judge` no tenía sonda de guardia de motor.

## 26. Entre apps de la familia: personajes, storyboards y mundos (0.7)

Cuatro herramientas nuevas (`tools/family.ts`, manifiesto en `manifestFamily.ts`,
grupo `story`) entregan trabajo a las demás apps de Hoard y traen mundos de
vuelta. Solo existen en la app de escritorio: pasan por el hub local
(`POST <hub>/api/apps/<id>/call`) con el token del puente. Si el hub o la otra
app no están en marcha, la respuesta dice cuál arrancar; nunca es una excepción.

| Herramienta | Escribe | Qué hace |
| --- | --- | --- |
| `wh_character_to_prospero` | sí | `{project_id, character_id}`. Envía un personaje del códice a Prospero (`cast_import_character`): nombre, descripción armada con la ficha y el cuerpo, rasgos físicos, retrato y hasta 3 imágenes de la galería enlazadas (PNG temporales, borrados al terminar). No cambia la entrada; avisa al hub de que ambos registros son la misma cosa. |
| `wh_storyboard_to_prospero` | sí | `{project_id, storyboard_id}`. Envía un storyboard como producción (`production_from_storyboard`): planos ordenados con descripción, duración e imagen (hasta 40). |
| `wh_world_to_scheherazade` | sí | `{project_id}`. Exporta el mundo del proyecto como `hoard.world/1` y lo importa en Scheherazade (`world_import`). Los registros secretos y los dangling no se envían (se cuentan). |
| `wh_world_from_scheherazade` | sí | `{project_id, world_id}`. Pide el mundo a Scheherazade (`world_export`) y lo importa. Deshacer lo revierte. |

Los argumentos se aceptan en `snake_case` y en `camelCase` (`validateToolArgs`
asigna la gemela camelCase; gana la clave exacta). Las cuatro son de riesgo
`external` y dejan siempre línea de auditoría. Descripción: la primera línea
≤110 caracteres.

### El formato `hoard.world/1`

Documento neutro compartido con Scheherazade; el esquema completo está en
`docs/WORLD_SCHEMA.md` del repositorio de Scheherazade. Cada elemento lleva una
`ref` (`hoard://<app>/...`, la de Writer en el espacio `hoard://writer/`) y una
`revision` = `sha256:` + SHA-256 del JSON canónico (claves ordenadas, compacto,
UTF-8) del registro sin `ref`, `revision` ni `same_as`. Writer reproduce los
resúmenes de Python exactamente (comprobado con una exportación real de
Scheherazade y a la inversa).

Correspondencias: concepto, magia y personalizado → `lore`; personalizado con
`fields.kind = creature` → `creature`; alias, estado y resumen salen de los
campos (el resumen cae al primer párrafo). Las relaciones y los eventos del
mundo se exportan aparte; `relationships` y `timeline` en la importación son
opcionales (la cronología «<mundo> (Scheherazade)» se crea al vuelo).

### Importar sin pisar lo editado

`importWorldDoc` (`familyBridge/worldImport.ts`) es una sola transacción de
Dexie. Cada elemento termina en una de estas categorías: `created`,
`unchanged`, `updated`, `local_modified` (se editó aquí: no se toca),
`linked_existing`, `name_collision`, `own` (eco de un documento de esta misma
app) o `skipped` (`bad_ref`, `no_name`, `no_summary`, `invalid`,
`endpoint_missing`, `engine_disabled`, `deleted_locally`). La edición local se
detecta con `familySource.localHash` frente al resumen actual de la fila; las
filas importadas guardan `familySource` (`ref`, `revision`, `localHash`).
Un libro de cuentas por proyecto (ajuste `familyBridge.world.<proyectoId>`,
`{v:1, refs:{ref:tipo}}`) hace que lo borrado a mano siga borrado, y recuerda las
referencias enviadas; deshacer lo poda para que una reimportación vuelva a
crear. Limitaciones conocidas: `parent_ref` se ignora al importar, las
relaciones secretas no se exportan por defecto, intensidad y estado se pierden al
exportar y la criatura va y viene por `fields.kind`.

### Interfaz

Botones «Enviar a Prospero» (ficha de personaje y cabecera del storyboard),
«Enviar a Scheherazade» y «Traer de Scheherazade» (modal con el id del mundo) en
`components/family/FamilyHandoff.tsx`; avisos claros de éxito (con recuentos) y
de error (con la app a arrancar). `data-testid`: `send-character-to-prospero`,
`send-storyboard-to-prospero`, `send-world-to-scheherazade`,
`bring-world-from-scheherazade`, `scheherazade-world-id`.

### Seguridad y llamadas

`electron/familyCall.ts` (IPC `family:call` y `family:link`, solo ventana
principal): lista cerrada de 4 herramientas en 2 apps; PNG verificados por
firma; límites de 40 archivos, 8 MB cada uno, 48 MB en total y 8 MB de
argumentos; tiempo 1-300 s; los marcadores `@file:<id>` se sustituyen por
archivos temporales privados (directorio 0700, archivos 0600), que se borran tras
cada llamada (y los restos de más de un día al arrancar). `callApp()` en
`electron/aibridge/family.ts` devuelve `hub_unreachable`, `unauthorized`,
`timeout`, `too-large`, `bad_response`, `app_unavailable` o `tool_failed`.

### Pruebas

`npm run test:family` (intercambio: resúmenes, importación, deshacer, libro de
cuentas; interfaz) y `tests/family-call-main.ts` en las pruebas de seguridad de
Electron. Verificado además de punta a punta en la app real contra un hub de
prueba respaldado por el código real de Scheherazade.

## 27. Calendario del mundo y fechas del mundo

Cada proyecto (o su saga) puede tener un calendario propio: meses con sus días,
días de la semana, eras, lunas, festivos y una regla de años bisiestos. Con él,
los eventos y los capítulos se fechan en el calendario de la historia ("12
Frostfall 431 TE") y no en el real. Tres herramientas y un modo de fecha.

### `wh_world_calendar_get`

`{ projectId? }`. Devuelve `calendar` (o `null` si el proyecto no tiene),
`daysInCommonYear` e `inheritedFrom` cuando el calendario viene de la saga.

### `wh_world_calendar_set`

`{ projectId?, calendar, force?, remove? }`.

- `calendar`: `{ name, months, weekdays, eras, moons?, holidays?, leap? }`. Se
  valida entero; si algo está mal responde `bad-args` con la lista de problemas
  y no guarda nada.
- Si el cambio dejaría eventos o capítulos ya fechados en días que el calendario
  nuevo no tiene (por ejemplo, acortar un mes), responde `conflict` con los
  títulos afectados y NO guarda. Con `force: true` guarda igual: esos elementos
  conservan su texto pero salen del eje de fechas. La respuesta cuenta
  `eventsLeftWithoutAValidDate` y `chaptersLeftWithoutAValidDate`.
- `remove: true` borra el calendario propio del proyecto (`bad-args` si no tiene
  uno). Los elementos fechados conservan su etiqueta.

### `wh_world_date`

`{ projectId?, date | dayNumber, plusDays?, to? }`. Lee una fecha del mundo y
devuelve día de la semana, fases de luna, festivos y número de día absoluto.
`plusDays` la desplaza (cruza meses y años) y `to` añade `daysBetween`, la
distancia en días hasta otra fecha. Sin calendario responde `not-found`.

### Fechas en eventos: `dateMode: "world"`

`wh_create_event` y `wh_update_event` aceptan `dateMode: "world"` con
`worldDate` y, opcionalmente, `worldDateEnd` (un rango). La fecha puede ir como
texto del calendario (`"12 Frostfall 431 TE"`, `"Frostfall 431 TE"`,
`"431 TE"`) o como objeto `{ year, month, day }` (año absoluto) o
`{ era, eraYear, month, day }`. Con una era, `year` solo se rechaza para no
confundir un año absoluto con uno de la era. Un día que el calendario no tiene
responde `bad-args`; sin calendario, `not-found`. En `wh_update_event`,
`worldDateEnd: ""` quita el final. Los eventos listados devuelven `worldDate`
(estructurada) y `date` (el texto del calendario), y se ordenan por la fecha del
mundo en la vista de carriles.

### Fechas en capítulos

`wh_create_writing` y `wh_update_writing` aceptan `worldDate` y `worldDateEnd`
con los mismos formatos y los mismos errores que los eventos (no hace falta
`dateMode`). En `wh_update_writing`, `worldDate: ""` quita la fecha y su final;
un cambio que no menciona la fecha la conserva. `wh_list_writings` y
`wh_get_writing` devuelven `worldDate`, `worldDateEnd` y `worldDateText` (la
fecha formateada en el calendario) solo en los capítulos fechados. En la
aplicación, el campo vive en los metadatos del capítulo (junto a sinopsis y
etiquetas), la lista de capítulos muestra la fecha formateada y la vista de
línea de tiempo coloca los capítulos fechados en un carril de solo lectura
"Manuscrito"; un clic abre el capítulo.

### Pruebas

`runWorldDateWritingChecks` en `selftest.ts` (capítulos fechados: guardado,
lectura estructurada y formateada, día inexistente, conservar y quitar la
fecha), `scripts/run-world-calendar-tests.mjs` (lógica del calendario) y
`npm run test:worlddates` (interfaz: fijar la fecha de un capítulo, verla en la
lista, verla en la línea de tiempo en orden y quitarla).

## 28. Mapas: aspecto, viaje, medidas, épocas y rótulos (Ágora 1095)

Cada capacidad nueva de los mapas tiene su herramienta, con validación, ámbito
de época (`eraId`) y deshacer que sólo revierte lo que sigue teniendo el valor
deshecho.

- **Aspecto guardado del mundo.** `wh_get_world_presentation` y
  `wh_set_world_presentation` (estilo, capas, densidad de relieve, piel 3D,
  cuadrícula de juego cuadrada o hexagonal en km;
  `expectedRevision` opcional). `wh_render_world_map` usa el aspecto guardado si
  no se le pasa un tema. En una época que hereda el mundo, el aspecto se guarda
  en Base y no copia el mundo a la época; si la época ya tiene su copia, se
  guarda en ella. El recibo de deshacer recuerda dónde se escribió.
- **Mundos en blanco o de una sola tierra.** `wh_create_world` con `preset`
  (`blankSea`, `blankLand`, `island`, `country`, `continent` u otro; con una
  sola tierra, `landmassKm` de 300 a 9000 km, que se niega con un planeta),
  semilla, anchura (1024/2048/3072) y título.
- **Medir.** `wh_measure_world`: tramos, distancia, área encerrada y perímetro
  cerrado con tres o más puntos; un anillo que rodea un polo mide el casquete.
- **Viaje.** `wh_get_world_travel_settings` / `wh_set_world_travel_settings`
  (ritmo habitual y factores de velocidad por medio y de coste por tipo de
  terreno, con revisión) y `wh_plan_journey` (paradas por lugar o celda, ritmo,
  medio por tramo; con `atDay`, dónde está el grupo ese día y si viaja, pasa la
  noche, descansa o ha llegado; además `passes` —pueblos por los que pasa, en
  orden, con km recorridos y a cuánto quedan—, `roads` —caminos que sigue,
  nombrados por los pueblos de sus extremos—, `grounds`, `kmOnWater`,
  `stretches` —los tramos en el orden del viaje, cada uno con su día (contando
  los días de descanso del ritmo forzado) y parte del día—, `clock` —sale, acampa y llega— según `setOffHour`
  (hora entera, 7 por defecto) y la posada o ruina de cada noche). Los itinerarios guardados conservan los ajustes
  con los que se planificaron.
- **Épocas del mapa enlazadas a la cronología.** `wh_list_map_versions` (en el
  orden del calendario del mundo, cada evento en el calendario de su propia
  línea de tiempo), `wh_capture_map_version` (con `eventId`; sin fecha toma la
  del momento) y `wh_link_map_version` (`eventId` o `null`; sella la fecha de
  una época sin fecha y el deshacer la quita). Deshacer una captura se niega si
  la época se cambió después.
- **Rótulos pintados.** `wh_add_label` acepta `size`, `angleDegrees`,
  `spacing` y `curve`; `wh_list_labels` devuelve clave, texto, estilo, celda
  actual y forma; `wh_update_label` cambia sólo los campos dados. Las claves
  `label:x,y` sirven también para `wh_move_place`, `wh_rename_place` y
  `wh_remove_place`. Un segundo rótulo en la misma celda tiene clave propia
  (`label:x,y#2`). `wh_roll_name` (sólo lectura) tira nombres para un rótulo
  `region`, `water`, `range` o `settlement` en las lenguas del mundo, con su
  lengua y etimología; con `x`,`y` en la lengua del pueblo más cercano; nunca
  uno que el mundo ya usa.
- **Sellos.** `wh_add_stamp` pone uno de 32 dibujos (posada, santuario, torre
  del mago, túmulo, faro, monte…) en tamaño S, M o L con nombre opcional;
  `wh_list_stamps` los devuelve con su clave `stamp:x,y`, que también vale para
  mover, renombrar o quitar.
- **Rejilla de juego.** `wh_set_world_presentation` acepta `grid`
  (`{kind:'square'|'hex', km}` o `null`); se dibuja en el Mapa, la Carta, la
  exportación PNG y `wh_render_world_map`.
- **Mapa del lector (niebla).** `wh_paint_reader_fog` pinta una pincelada
  (`op`: `seen`, `heard` o `hide`; `points` en celdas; `radiusCells`; `chapter`
  opcional desde el que se revela). No cambia el mundo. `wh_reader_view` da la
  proporción vista, de oídas y oculta hasta un capítulo, los capítulos que
  revelan algo y el estado de las celdas pedidas. `wh_render_world_map` con
  `readerView` (y `readerChapter`) pinta el mapa del lector, y
  `wh_set_world_presentation` guarda `readerStart` (`blank`, `sketch`, `ink`):
  cómo empieza antes de la primera pincelada. Una línea de más de un cuarto del
  mundo se guarda como varias pinceladas. `wh_plan_journey` devuelve `path`
  (celdas de la ruta) para pasarlo como `points`.
- **Sucesos de la historia.** `wh_add_story_event` (lugar o celda, `type`:
  fight, find, meeting, rest, change, journey, camp, inn, custom; `title`,
  `note`, `chapter`, `status` planned/happened, `order` dentro del capítulo,
  `who` ids de fichas del Códice que estaban; ids que no existen se rechazan),
  `wh_update_story_event` (sólo los campos dados; `chapter: null` lo desata,
  `order: null` y `who: []` los quitan), `wh_remove_story_event` y
  `wh_lock_place` (bloquea un lugar contra mover y ocultar, `locked: false`
  lo desbloquea; `wh_list_places`/`wh_find_place` lo marcan `locked: true` y
  `wh_place_at` también; mover u ocultar un lugar bloqueado se rechaza, también
  con la vista abierta; la clave debe existir),
  `wh_duplicate_place` (copia un pueblo —una capital como ciudad—, ruina o
  hito como «<nombre> 2» en la tierra libre más cercana o en `x`,`y`; mar,
  lago o una celda con lugar o historial se rechazan; reinos y mares no; se
  deshace),
  `wh_plan_journey` cuenta aparte `fords` (vados fuera del camino: hora y media
  a pie, una a caballo, unas cuatro con carro), `bridges` (el camino cruza por un
  puente, sin coste) y `frozenRivers` (en pleno invierno, ríos helados que se
  cruzan a pie sin coste).
  `wh_set_world_presentation` acepta `skin3D: "pintado"` (el mundo pintado como
  mapa de relieve: terrenos fundidos, bajíos y orillas, bosques y dunas pintados,
  rótulos de mapa) además de satelite, dibujado y arcilla, y `stage3D` (`maqueta`, por defecto: el mundo
  entero en el plano 3D como un bloque sobre una mesa, con el corte de roca y mar,
  su sombra y el mar recortado al bloque; `paisaje`: hasta el horizonte; se
  guarda con el aspecto y se deshace), y `wh_set_map_layers` (mapa clásico:
  `pins`, `region`, `path`, `label`, `portraits` —un marcador enlazado a una
  ficha con imagen la muestra enmarcada en su color, con el nombre debajo; activo
  si no se apaga— y `names` —todos los nombres a la vista—; booleanos, rechaza
  campos desconocidos y nada que cambiar; se deshace y el deshacer se niega si
  alguien cambió las capas después; la exportación SVG lleva los retratos),
  `wh_set_world_presentation` acepta `contours` (cada N metros, 50–2000, sobre
  cualquier estilo; `"off"` sin curvas; `null` las del estilo), que dibujan el
  atlas, la Carta, las exportaciones y `wh_render_world_map`;
  `wh_paint_biome` (pinta un terreno por clave sobre un trazo de celdas con
  radio, también los fantásticos —volcanic, ashPlain, petrifiedForest,
  fungalForest, crystalFlats, glowMarsh—, o lo borra con `erase`; mar y lago no;
  devuelve las celdas de tierra pintadas y rechaza un trazo que no toca tierra;
  `wh_place_at` devuelve `ground`; se deshace),
  `wh_set_world_levels` (`seaLevelM` ±1000 y/o `snowlineM` ±3000, absolutos;
  el mar mueve todas las alturas —también las de las hojas de comarca— y los
  biomas lo siguen; un lago que el mar cubre vuelve cuando baja; la nieve sólo
  cambia dónde se pinta; `wh_get_world` los devuelve; se deshace),
  `wh_add_lake` (un lago: el agua baja unas celdas al fondo de su hondonada y la
  llena hasta que rebosa —al mar, una albufera—; sin hondonada cerca se embalsa
  donde se pide (`dammed`);
  junto a otro lago se rechaza; `size` lo hace de al menos esas celdas, `maxCells` lo limita,
  `dryRun` sólo lo mide; se rechaza en el mar o un lago), `wh_drain_lake`
  (seca el lago de ese punto; `wh_place_at` dice `lake`),
  `wh_add_world_road` (un camino trazado a mano entre dos lugares o celdas
  por la ruta de carro, como la herramienta Camino; `major` calzada real o
  camino, `width` 0,5–3 y `pattern` solid/dashed/dotted; `dryRun` sólo la
  calcula; se deshace),
  `wh_add_spring_river` (un río que baja solo desde un manantial en `place` o
  `x`,`y` hasta el mar, otro río o una hondonada; `dryRun` sólo traza; se
  deshace), `wh_set_river_crossing` (`blocked: true` cierra el paso por el río
  en la celda de río más cercana a `x`,`y`, hasta celda y media, y en las celdas
  de río de alrededor: ningún viaje por tierra lo cruza ahí, camino incluido, ni
  se cuela en diagonal; `blocked: false` abre todos los pasos cerrados a una
  celda de ahí y devuelve `unchanged` si no había ninguno; se niega donde no hay
  río; se deshace; una parada puesta sobre el propio tramo cerrado —un pueblo o
  un punto de paso— sigue siendo alcanzable y se puede salir de ella, y
  trazar un camino con `wh_add_world_road` tiende puentes) y
  `wh_list_story_events` (orden por capítulo y dentro de él, con `whoNames`; `knownByChapter` deja lo que el
  lector sabe). `wh_story_chapters` da la historia capítulo a capítulo (lo que
  ocurre, lo planeado y cuánto del mapa ha visto u oído el lector al final de
  cada uno), como la reproduce la vista del lector. `wh_render_world_map` los
  marca con `storyEvents: true`, y con `readerView` marca los ocurridos hasta su
  capítulo.
- **Comercio.** `wh_world_economy` (mes 1..240: quién come, quién se queda sin
  qué y cuándo, precios frente a lo normal, envíos por tierra y mar, mercancías
  que nadie produce; `place` para el detalle de una población; determinista),
  `wh_list_trade_sites`, `wh_add_trade_site` (granja, pesquería, pastos,
  aserradero, cantera, mina, salinas; S/M/L; lugar o celda) y
  `wh_remove_trade_site` (quita una del autor o apaga una generada; deshacible)
  y `wh_restore_trade_site` (vuelve a abrir una generada). Las generadas se
  identifican por la celda de su población (`auto:x,y:tipo:n`), estable aunque
  se rehaga el poblamiento.
- **Mapas clásicos: figuras con estilo.** `wh_list_map_features`,
  `wh_add_map_feature` (región, ruta o rótulo en % de la imagen; contorno,
  trama, rotulación —letra, tamaño, color, halo, negrita, cursiva, giro—, capas
  propias) y `wh_update_map_feature` (sólo los campos dados; `order`
  front/forward/backward/back; la rotulación se mezcla campo a campo). El
  deshacer devuelve las figuras anteriores sólo si nadie las cambió después.
  `wh_add_map_pin`/`wh_update_map_pin` aceptan `size` (S/M/L) y `hideIcon`.
- **Mapas clásicos: cambiar la imagen.** `wh_preview_map_ground` (sólo lectura:
  tamaños, si la forma es la misma —proporciones a menos de un 2 %— y cuántos
  lugares, zonas, rutas y nombres se mueven con el mapa) y `wh_change_map_ground`
  (`galleryAssetId` o `imageDataUrl`; `fit` `keep` por defecto conserva las
  proporciones de figuras y marcadores colocando el dibujo antiguo centrado en la
  nueva imagen, `stretch` deja las coordenadas). Antes guarda el mapa como época
  «Before changing the ground image». El deshacer devuelve imagen, figuras y
  marcadores y retira esa época, salvo que alguno haya cambiado después. La
  interfaz hace lo mismo tras un diálogo de confirmación (`ChangeGroundDialog`).
  Los comentarios dejados en un punto del mapa se mueven con él y vuelven al
  deshacer.
- **Mapas clásicos: escala y medidas.** `wh_set_map_scale` fija cuántos
  kilómetros abarca la imagen de izquierda a derecha (`widthKm`, de 0,01 a
  40000), o lo calcula con `knownDistance: {from:{x,y}, to:{x,y}, km}` (dos
  puntos en % de la imagen que distan `km`; las proporciones se leen de la
  imagen del mapa, o se pasan como `aspect` = alto/ancho si no hay imagen), o
  lo quita con `clear: true`; exactamente uno de los tres. El deshacer devuelve
  la escala anterior sólo mientras siga siendo la que puso la llamada.
  `wh_measure_map` (sólo lectura; `points` o `featureId`) devuelve los km de la
  línea o ruta, y en una región también `perimeterKm` (contorno cerrado) y
  `areaKm2`, junto con el `widthKm` usado y los tiempos de viaje (a pie, a
  caballo, en carruaje, tren, coche, avión); falla con un mensaje claro si el
  mapa no tiene escala. `wh_list_maps` devuelve `widthKm` cuando existe, y
  `wh_list_map_features` devuelve `lengthKm` por ruta y `areaKm2` por región
  cuando hay escala.
- **Mapas clásicos: rutas con estilo y claves.** `wh_add_map_feature` y
  `wh_update_map_feature` aceptan `pathStyle` (`road`, `trail` o `river`;
  `null` al actualizar lo quita) y `linePattern` (`solid`, `dashed` o
  `dotted`, sobre el del estilo; `null` vuelve al del estilo; el grosor es
  `strokeWidth`) sólo en rutas; en regiones y rótulos se rechazan.
  `wh_list_map_features` los devuelve. `wh_name_map_pins_from_key`
  toma una clave pegada («A. El molino / B) La posada / 3 - La atalaya») y
  renombra los marcadores que aún se llaman sólo por su letra o número («A»,
  «b.», «(3)»); `dryRun: true` sólo informa de `matches` (`pinId`, `key`,
  `from`, `to`) y de las líneas sin marcador (`unmatched`). El deshacer
  devuelve cada nombre antiguo sólo donde el marcador conserva el nombre que
  puso la llamada.
- **Mapas clásicos: comentarios en un punto.** `wh_annotate` con
  `engineId: "maps"` acepta `at: {x, y}` (en % de la imagen, como marcadores y
  figuras; no junto a `quote`): el comentario se dibuja como marca en ese punto
  del mapa y aparece en las notas con «En el mapa». `wh_list_annotations`
  devuelve `at`. `wh_annotation_move` (con `expectedRevision`) lo lleva a otro
  punto y devuelve un recibo que `wh_annotation_undo` deshace. En la interfaz:
  clic derecho → «Comentar aquí»; la marca se arrastra para moverlo.
- **Mapas clásicos: enlazar y crear fichas.** El enlace al Códex de figuras y
  marcadores es un buscador (sin acentos, por palabras) que también crea una
  ficha nueva del tipo elegido; clic derecho → «Nueva ficha aquí» crea la ficha y
  un marcador enlazado en ese punto. Por el puente: `wh_create_codex_entry` y
  después `wh_add_map_pin` con `linkedEntryId`.

- **Mundos: hoja a la medida, zonas, relieve y ríos (continuación).**
  `wh_create_world` con preset `island`, `country` o `continent` pone la tierra
  en su propia hoja plana (unas 3,2 veces su tamaño; `worldKm` de 1000 a 40074
  km la fija; `sheet: false` vuelve al planeta entero); `wh_get_world` dice si es
  hoja y su `worldKm`. Zonas con nombre: `wh_add_zone` (nombre, esquinas, color,
  relleno `outline`/`wash`/`hatch`), `wh_list_zones` (con su área),
  `wh_update_zone` y `wh_remove_zone` (no es un borrado: una edición que se
  deshace). `wh_shape_terrain` con `op: "volcano"` (borde y cráter; en mar
  profundo, una isla) o `op: "height"` con `heightM` (metros, -11000 a 9000); `wh_draw_river` por puntos
  desde el manantial; `wh_reverse_river` invierte un río dibujado.
- **Aspecto 3D y luz.** `wh_set_world_presentation` guarda `clouds` (nubes con
  sombra, más donde llueve) y `block3D` (`roca`, `papel`, `grabado`) de la
  maqueta; con Pintado los árboles se ponen de pie en la maqueta.
  `wh_render_world_map` acepta `hour` (amanecer rosa, anochecer rojo, noche azul
  con el farol del grupo) y la vista del lector con `readerStart: "land"`
  (tierra a tinta), `readerTowns` (pueblos como puntos) y `readerTrail` (rastro
  numerado por capítulo).
- **Viaje y comercio.** `wh_set_world_travel_settings` admite `ways` (las vías
  propias del mundo: velocidad, día y noche, por mar, tierra o ambos, como un
  grifo o un trineo) y `wh_plan_journey` las usa con `way`. `wh_world_economy`
  dice qué llega por mar a un puerto y de dónde; los envíos rodean bahías por
  tierra y siguen los ríos, también en proyecciones curvas.
- **Sucesos y manuscrito.** `wh_add_story_event`/`wh_update_story_event`
  enlazan un suceso al capítulo donde se cuenta (`writingId`, `null` lo
  desenlaza) y aceptan las marcas `lantern`, `sneaking` y `inside`; los sucesos se
  reordenan arrastrando dentro de su capítulo.

Pruebas: `tests/world-presentation*.ts*`, `world-blank-starters`,
`world-measure-area`, `world-travel-profile`, `world-map-eras*` (con transporte
nativo stdio + HTTP), `world-labels`, `world-stamps`, `world-grid`,
`world-journey-playback`, `world-reader-fog`, `world-story-events`,
`world-economy`, `world-trade`, `world-sheet`, `world-zones`, `world-terrain-ops`, `world-3d-model`, `world-light-ways`, `world-reader-plus`, `world-trade-routes`, `world-story-scenes`, `map-style`, `map-ground`, `map-picker`, `map-scale`, y los recorridos de interfaz
`scripts/run-world-{presentation,blank,measure,travel,map-eras,labels,stamps,grid,reader-fog,story,trade}-qa.cjs` y `scripts/run-map-{style,ground,picker,scale}-qa.cjs`.

## 29. Escritura, publicación, Códex, cronologías y tablas (Ágora 1095, ola C)

Todo lo que la ola C añadió a la interfaz tiene su camino por el puente, con
deshacer donde la herramienta escribe.

### Publicación
- `wh_publishing_profiles` lista los perfiles de publicación del proyecto con sus
  piezas; `wh_publishing_profile_set` crea o cambia uno (selección, orden, portada
  de título, índice, página de derechos `includeCopyright`, contracubierta
  `includeBlurb`, imágenes de capítulo `includeChapterImages`, imágenes del texto
  `includeInlineImages`, estilo de libro `bookStyle`) y deshacer lo devuelve o lo
  borra; `wh_publishing_compile` compila un perfil a Markdown o HTML.
- `bookStyle` es un preajuste (`classic`, `modern`, `epic`, `sourcebook`), `null`
  o un objeto con alineación, interlineado, espaciado, párrafos sangrados o
  espaciados, capitular, versalitas de apertura, separador de escena, tamaño y
  ornamento del título, formato (A4, Letter, A5, 6×9), papel, `columns` 1|2 y
  `stripedTables`. `sourcebook` es el manual de juego: dos columnas en Letter,
  tablas rayadas; un salto de columna empieza la siguiente; los títulos, los h2 y
  las imágenes a página completa ocupan las dos.
- `wh_update_project_details` acepta `blurb` (texto de contracubierta).

### Bloques y texto
- El Markdown del puente lee y escribe `> [!READALOUD]` (para leer en voz alta) y
  `> [!SIDEBAR]` (recuadro) además de NOTE/INFO/QUESTION/TIP/WARNING.
- `wh_codex_rules_card` construye una ficha de reglas (hechizo, objeto mágico o
  criatura) desde una ficha del Códex: cada hueco toma la propiedad asignada
  (adivinada por el nombre —Nivel, Escuela, Alcance, CA, PG, FUE…— o con
  `slots`); devuelve HTML, Markdown, huecos rellenos y vacíos; con `writingId` la
  añade al final del capítulo (versión pre-IA y deshacer).
- `wh_extract_block_to_card` mueve el bloque n.º `blockIndex` de un capítulo o
  ficha a una ficha nueva y deja en su lugar una referencia viva; con
  `list:true` solo enseña los bloques con su número, y `expectText` (sus primeras
  palabras) evita mover otro si el texto cambió. Deshacer devuelve el bloque (la
  ficha nueva queda). Solo en la base compartida.
- En una hoja, insertar o quitar filas y columnas (`wh_table_edit`, la interfaz)
  mueve las referencias de las fórmulas; una referencia a una celda quitada da
  `#REF!`. `wh_table_query` acepta números en las condiciones.
- Deshacer `wh_world_calendar_set` con `redate:true` devuelve el calendario y
  las fechas de los sucesos movidos; deshacer `wh_timeline_settings` respeta la
  era en la que se hizo.
- `wh_text_effect` pone o quita un efecto (glow, shake, wave, rainbow, pulse,
  blur) en la n-ésima aparición de una frase de un capítulo.
- `wh_dictionary_settings` activa la escritura nativa junto a las glosas en la
  prosa.

### Códex
- Plantillas: `privateType` (el tipo y sus herederos no salen en la wiki
  publicada), propiedades `select`, `required` y `description`;
  `wh_get_codex_entry` devuelve `missingRequired`.

### Cronologías y calendario
- `wh_timeline_settings` (precisión, modo de semana, fases lunares que se ven);
  eventos con `repeat` (año/mes/semana hasta un año) y `bannerPattern`.
- El calendario admite un **mes bisiesto** (un mes de 0 días al que la regla
  bisiesta da sus días: solo existe en años bisiestos; una fecha en él un año
  común se rechaza con el motivo) y una **correlación** con el gregoriano
  (`calendar.correlation {date, earth}` en `wh_world_calendar_set`). Con ella
  `wh_world_date` devuelve `earth` (el día gregoriano) y acepta `earthDate` para
  convertir al revés; la vista de calendario muestra los sucesos de los dos
  calendarios.

### Tablas, árboles, tablero, barra de herramientas y sonido
- `wh_table_edit` (insertar/duplicar/quitar filas y columnas), `wh_table_query`
  (filtros con operadores, ordenación múltiple, buscar) y
  `wh_table_create_cards_view` (vista de solo lectura de todas las fichas).
- `wh_relation_tree_action`: `nodes-remove` (varias personas a la vez) y
  `vocabulary-catalogue` (familia, empresa, ejército, corte real, orden,
  bajos fondos: añade un juego de tipos de relación al árbol).
- `wh_board_canvas_action border` (solid/dashed/sketch) y
  `wh_writing_tool_dock_apply` con `span` (bloque a fila entera).
- `wh_sound_library` lista la biblioteca de sonidos hecha en el equipo (lluvia,
  viento, trueno, hoguera, olas, bosque de noche, taberna, latido, campana,
  pasos, llamada, espadas) y con `add` la añade a los sonidos del proyecto
  devolviendo su `assetId`; las pistas de párrafo admiten `through` (suena hasta
  ese párrafo) en `wh_reader_settings_save`.

Pruebas: `tests/publishing-{front-matter,book-style,chapter-images,inline-images,sourcebook,review}`,
`codex-{rules-cards,card-drop,private-type,required-properties,type-picker,card-faces}`,
`block-actions`, `text-effects`, `writing-{blocks,email-block}`, `wiki-hidden-block`,
`world-calendar-{weeks-moons,leap-lens}`, `world-date-picker`, `timeline-{precision-settings,repeat-banners}`,
`table-{edits,all-types}`, `relation-catalogue`, `sound-library`, `cover-vertical-eraser`,
`saga-shelf`, `create-cover`, `tool-dock-tiles`, `sprint-pause`, `library-bulk-delete`,
`dictionary-native-prose`, y los recorridos `scripts/run-{board-quick,tree-groups,timeline-calendar,sprint-rounds}-qa.cjs`.

## 30. Herramientas de mesa: compendio, combate, dados, nombres, tareas, hojas y más (Ágora 1095, ola D1)

- **Compendio SRD 5.2** (Hojas → Compendio; sin conexión, CC BY 4.0):
  `wh_compendium_search` (texto y filtros: `kind`, `crMin`/`crMax`, `type`,
  `level`, `school`, `className`, `rarity`), `wh_compendium_get` (la entrada
  completa) y `wh_compendium_add` (la copia como ficha del Códex con su
  atribución; un monstruo trae además su bloque de estadísticas). Deshacer quita
  la ficha.
- **Combate** (Hojas → Combate): `wh_encounter_list` y `wh_encounter_action`
  (create, rename, add, add-monster, add-sheet, remove, roll-initiative,
  set-initiative, sort, next, previous, damage, heal, temp-hp, condition,
  death-save, concentrating, end) con `expectedRevision`; cada cambio se
  deshace.
- **Dados** (Hojas → Dados y «/dados»): `wh_dice_roll` (2d6+1d8-1, 4d6kh3, d%,
  `mode` advantage/disadvantage, `target`, `times`; con `projectId` queda en el
  historial) y `wh_dice_tray` (read, clear-log, save-formula, remove-formula).
- **Nombres** (Códex → Generar un nombre y «/nombre»): `wh_name_generate`
  (posada, tienda, persona, pueblo, casa noble; 13 estilos; `brief`, `seed`,
  `count`; `makeCard` crea la ficha con sus partes). Se hace en el equipo con
  tablas de palabras, sin modelo.
- **Revelar a los jugadores** (Códex): `wh_set_revealed` marca fichas como
  reveladas (con fecha, nota y momento opcionales) o las vuelve a ocultar; la
  marca la leen la «Vista de jugadores» del Códex y la política de wiki
  `onlyRevealed` (`wh_wiki_profile_save`, `wh_wiki_export`), que publica solo lo
  revelado, sin mapas, sin fichas de tipos privados y con los bloques ocultos y
  los campos excluidos fuera igual que siempre. `wh_list_codex` y
  `wh_get_codex_entry` muestran `revealed`.
- **Tareas y tableros** (Notas → Tareas / Tableros): `wh_todo_list`,
  `wh_todo_action` (add, update por `id` o `match`, remove; estado, urgencia,
  día, enlaces) y `wh_kanban` (tableros, columnas y tarjetas que se mueven).
  Las notas aceptan `title`.
- **Hojas**: funciones SI, SUMAR.SI, CONTAR.SI, PROMEDIO.SI, BUSCARV,
  SI.ERROR, Y, O, NO, MEDIANA, REDONDEAR.MAS/MENOS, ENTERO, RESIDUO, POTENCIA,
  RAIZ, CONCATENAR, LARGO, MAYUSC, MINUSC, ESPACIOS (o en inglés), comparaciones
  y `&`; `wh_table_import_xlsx` (cada hoja de Excel como una pestaña, con
  informe de lo que no se conserva), `wh_table_export_xlsx` y
  `wh_table_workbook` (pestañas: add, duplicate, rename, colour, hide, show,
  move, remove).
- **Grafo del mundo**: `wh_world_graph_settings` (read, display, hide, show,
  save-view, remove-view).
- **Sonido**: `wh_soundscape` (paisajes sonoros por escenas con bucles y
  efectos; el puente nunca empieza a sonar).
- **Lienzo**: superficies `white`, `lined` y `chalk` en `wh_create_board`; el
  menú de clic derecho, los recursos y los comentarios sobre una tarjeta son de
  la interfaz.
- **Bloque de estadísticas**: el lanzamiento de conjuros va en `details`
  (`spellAbility`, `spellsAtWill`, `spellsPerDay`) de `wh_sheet_update`.

- **Reglas de la mesa** (Hojas → Reglas de la mesa): `wh_table_rules_get` (sistema,
  cada regla con valor, valor habitual y si está cambiada, y las notas de la
  velada en orden; devuelve `revision`) y `wh_table_rules_set` (`system`
  5e-2024/5e-2014/daggerheart/coc7/free; `values` {regla: valor}, `null` vuelve
  al valor habitual; `resetAll`; `infoOps` add/update/move/remove sobre las notas;
  `expectedRevision` rechaza una escritura caducada; con el motor de hojas
  apagado la escritura se rechaza y la lectura sigue). Solo se guardan las
  diferencias respecto al sistema. Deshacer con `wh_undo`; si las reglas
  cambiaron después, deshacer se rechaza (`cannot-undo`). Una escritura idéntica
  no cambia nada ni deja rastro.

Pruebas: `tests/compendium-encounter`, `table-tools`, `table-rules`, `board-context-menu`,
`world-graph-settings`, `soundscape`, `kanban`, `codex-reference-panel` y
`model-viewer`.

## 31. Temas del espacio de trabajo (Ágora 1095, ola D2)

Apariencia (Base o una era) guarda **temas con nombre** para todo el equipo: una
sola fila de ajustes (`workspaceThemes.library`, con `revision`), que van en las
copias completas y no en la exportación de un proyecto. Un tema es
`{id, name, values, createdAt, updatedAt}` con los mismos campos que
`wh_workspace_appearance_save` (la imagen de fondo, PNG/JPEG/WebP de hasta 8 MB,
se valida igual). Hasta 40 temas y 32 MB; los nombres son únicos (1 a 60
caracteres).

- `wh_workspace_theme_list` (lectura): `revision`, los temas (la imagen se
  informa como `hasBackgroundImage`, sin sus bytes) y los ocho estilos
  predefinidos.
- `wh_workspace_theme_save`: guarda `name` con `values` o, sin `values`, con la
  apariencia efectiva de `projectId` (y `eraId`). `expectedRevision` opcional
  (de la biblioteca). Un nombre repetido o valores no válidos se rechazan.
  Deshacer quita el tema.
- `wh_workspace_theme_apply`: `themeId`, `projectId`, `eraId` opcional (si no,
  Base) y `expectedRevision` de la apariencia (el de `wh_workspace_appearance_get`).
  Sustituye la apariencia propia de ese ámbito por la del tema con el mismo
  guardado con revisión que el formulario; una revisión vieja se rechaza.
  Deshacer devuelve la apariencia anterior.
- `wh_workspace_theme_delete`: `themeId` y `expectedRevision` (de la
  biblioteca). Los proyectos que ya usan ese look lo conservan. Deshacer
  devuelve el tema.

Deshacer es estricto: si la biblioteca (o la apariencia) cambió después de la
entrada, se rechaza con `cannot-undo` en vez de forzar. En la interfaz,
Apariencia añade los estilos, el tono del acento, «Guardar como tema», la lista
(aplicar, renombrar, eliminar con confirmación, exportar) e importar `.json`
(`{kind: "writer-workspace-themes", version: 1, themes: [{name, values}]}`); un
archivo no válido se rechaza entero. `saveWorkspaceAppearance` con `reset` y un
parche no vacío ahora **sustituye** los valores propios (con parche vacío sigue
siendo el restablecimiento de siempre).

Prueba: `tests/workspace-themes.browser.tsx` (`scripts/run-vvd-tests.cjs`).

## 32. Exportar el mundo como Markdown (Ágora 1095, ola D2)

El botón «Exportar como Markdown» (en la tarjeta del proyecto y en la barra
lateral) y `wh_world_markdown_export`
(solo lectura; `projectId`, `includeMedia`, `locale`). Devuelve
`{fileName, files, bytes, includeMedia, summary, warnings?, base64}`: un ZIP
con un `.md` por ficha (`Codex/<tipo>/`), capítulo (`Writings/`), nota
(`Notes/`), cronología (`Timelines/`), mapa (`Maps/`), esquema (`Outlines/`) y
página de diario (`Diary/`), con cabecera YAML y enlaces `[[Título]]`; tablas
en CSV (`Tables/`), `index.md` y `world.json` (el proyecto sin imágenes
incrustadas). `includeMedia: true` añade imágenes y sonidos en `media/`. Por
encima de 25 MB responde `too-large` y aconseja `includeMedia: false`. No
cambia datos ni toca el formato de las copias de seguridad
(`src/services/worldMarkdownExport/`).

Prueba: `tests/world-markdown-export.browser.tsx` (`scripts/run-vvd-tests.cjs`).

## 33. Pestañas del espacio de trabajo (Ágora 1095, ola D2)

Panel de consulta: `wh_workspace_tabs`
(lectura): las pestañas abiertas del proyecto tal como el espacio de trabajo
las guardó en esta ventana (posición, herramienta, ruta, título del
documento, nombre puesto por la persona, fijada, activa) y cuántas cerradas
se pueden reabrir. No abre, cierra ni renombra nada.
Archivar y renombrar carpetas de la Biblioteca se deshacen desde el aviso o la barra del espacio de trabajo (en la interfaz, no por el puente).

Prueba: `tests/workspace-tabs.browser.tsx`.

## 34. Cambios de la wiki desde la última edición (Ágora 1095, ola D2)

`wh_wiki_profile_changes` (lectura; `projectId`, `profileId`): `{changes: [{documentId, title, kind, change}], count, lastEditionAt, configChanged, sourceChanged, editionId}`. `wh_wiki_profile_save` acepta además paletas propias, extras de terminal y enlaces del pie (detalle en `docs/wiki-profiles.md` y `docs/wiki-appearance.md`).

Prueba: `tests/wiki-look-changes.browser.tsx`.

## 35. Revelar lore a los jugadores (Ágora 1095, ola B)

Una ficha del Códex puede llevar la marca opcional `revealed` (`{at, note?,
moment?}`): «el autor ya contó esto a los jugadores». Sin marca, la ficha no está
revelada. La marca viaja con las copias de seguridad JSON/ZIP, el clonado y las
épocas como cualquier otro campo opcional de la ficha.

- `wh_set_revealed` (escribe; motor Códex): `{projectId?, entryIds[1..100],
  revealed, note?, moment?, eraId?}`. Todo o nada: un id desconocido da
  `not-found` sin tocar nada. Una ficha que ya está en el estado pedido se deja
  como está (con `note` o `moment` se renueva la marca). `note` y `moment` solo
  con `revealed:true`. Devuelve `{changed:[{id,title,revealed}], unchanged:[ids]}`.
  Con el Códex apagado responde `engine-disabled` antes de leer nada.
- Deshacer (`__undo`): devuelve cada marca a como estaba; se rechaza entero con
  `cannot-undo` si alguna ficha se editó, reveló u ocultó después, o se borró.
- Lectura: `wh_list_codex` (filtro `revealed`, campo `revealed`) y
  `wh_get_codex_entry` (`revealed`, `reveal`).
- Política de wiki: `onlyRevealed` en `wh_wiki_profile_save` y `wh_wiki_export`
  (por defecto apagada; sin mapas mientras esté activa). Detalle en
  `docs/wiki-profiles.md`.

En la interfaz: «Revelar a los jugadores» / «Ocultar de nuevo» (diálogo de la
ficha, editor y panel Consultar), insignia «Revelada», filtro «Solo reveladas /
Sin revelar» y «Vista de jugadores» en el Códex (solo lo revelado, sin bloques
ni campos secretos; no guarda nada).

Prueba: `tests/codex-reveal.browser.tsx` (`scripts/run-vvd-tests.cjs`).


## 36. Importar: texto pegado, ePub y PDF (Ágora 1095, ola D2)

Ampliación aditiva de `wh_world_folder_import_preview/apply` y de
`wh_manuscript_import_inspect/apply`; los nombres y los argumentos anteriores no
cambian.

- **`pasted`**: lista `[{name?, text}]` con texto escrito o pegado en lugar de
  archivos (`files` puede omitirse si hay `pasted`). Una línea que contenga solo
  `---8<---` separa documentos. En la importación del mundo cada trozo entra como
  un archivo virtual (`pasted.md`, `pasted-2.md`, o el `name` dado), con su hash
  dentro del digest del plan, así que cambiar el texto cambia el digest y el
  mismo texto pegado otra vez se ve como «ya importado». Un nombre ya usado por
  una importación anterior con otro texto pasa al siguiente número libre. En el
  manuscrito, `pasted` se lee como un `.md` con ese nombre.
- **`libraryFolderId`** (solo importación del mundo): carpeta de la biblioteca
  donde se archivan los documentos creados en la misma transacción. La vista
  previa devuelve `libraryFolder: {id, name, path}`; una carpeta que no existe da
  `world_folder_library_folder_missing`. Deshacer el lote quita también las
  colocaciones.
- **PDF**: `.pdf` se lee en ambas herramientas (texto con `pdfjs-dist`;
  párrafos reconstruidos por la posición de las líneas, títulos solo si son
  claramente más grandes). Un PDF sin capa de texto no se importa: en el
  manuscrito responde con el código `scanned-pdf` y el texto «Este PDF es una
  imagen escaneada: necesita OCR»; en la importación del mundo queda como
  hallazgo con `reason: "needs-ocr"`. Otros códigos del manuscrito: `invalid-pdf`,
  `invalid-epub`, `protected` (contraseña o DRM).
- **ePub** (solo manuscrito): capítulos en el orden del libro (el «spine», no el
  orden de nombres), sin portada ni índice. Los hallazgos del plan dicen cuántas
  imágenes no se importan (`epub-images-skipped`), qué páginas se omitieron
  (`epub-pages-skipped`) y tablas aplanadas (`epub-tables-flattened`); en PDF,
  `pdf-pages-without-text` y `pdf-layout-guess`. El original se conserva como con
  cualquier otro archivo.
- **`reason` en los hallazgos** de la vista previa del mundo: cada archivo que no
  produce nada lleva `reason` (`unsupported-type`, `empty`, `too-large`,
  `duplicate`, `encrypted`, `needs-ocr`, `unreadable`). El campo es opcional; el
  resto del hallazgo no cambia.

La interfaz añade tarjetas de guía de exportación, el cuadro «Pegar texto», el
selector de carpeta de la biblioteca, «Seleccionar todo de este tipo» y la lista
«Archivos omitidos y por qué» (`src/components/import/`).

Límites: sin OCR, sin reordenar columnas de un PDF, ePub solo en el importador de
manuscritos, sin planificador con modelo local.

Prueba: `tests/import-paste-epub-pdf.browser.tsx` (`scripts/run-vvd-tests.cjs`).

## 37. Biblioteca de recursos (Ágora 1095, ola D2)

Dos herramientas de solo lectura sobre la pestaña Recursos del panel del proyecto, que reúne imágenes, sonidos, vídeos y modelos 3D:

- `wh_list_assets` (`projectId`, `kind` all|image|audio|video|model, `query`, `sort` date-desc|date-asc|name-asc|name-desc|size-desc|size-asc, `limit` hasta 500, `eraId`): `{total, returned, assets: [{id, kind, name, size, createdAt, mime, tags}]}`. No incluye los bytes de las imágenes.
- `wh_asset_usage` (`projectId`, `assetId` de `wh_list_assets`): `{assetId, kind, name, usedIn, places: [{kind, id, name}], warning?}` con los sitios que usan el recurso (avatares y enlaces de fichas, nodos de lienzo, viñetas, segmentos de vídeo, fondos de mapa, portada, banners de wiki, referencias visuales, bandas del paisaje sonoro y bloques dentro de capítulos) y el aviso «Se usa en N sitios: …». Las imágenes que se copian por valor se reconocen por tener los mismos bytes.

Borrar, renombrar y comprimir se hacen desde la pestaña, no por el puente: el borrado pasa por la vía de cada herramienta y se deshace desde el aviso.

Prueba: `tests/assets-library.browser.tsx`.


## 38. Planificador de sesiones (Ágora 1095, ola B)

Un esquema (outline) puede marcarse como **sesión de mesa**. No hay tabla nueva: el
`Outline` lleva cuatro campos opcionales (`kind:'session'`, `sessionStatus`
`prep|next|live|played`, `sessionDate` `YYYY-MM-DD`, `linkedWritingId` con la nota de
preparación) y un `sessionRevision` que sube con cada cambio. Un esquema sin ellos es
un esquema normal. Los campos viajan con las copias JSON/ZIP y el clonado de
proyecto (el enlace a la nota se reasigna a la nota copiada).

Plantillas nuevas de `wh_create_outline template` (se añaden al final; los ids antiguos no
cambian): `session-prep` (ocho pasos de preparación), `hub-and-spoke` (centro y
ramales) y `three-act-session`. Los textos salen en el idioma de la app.

- `wh_create_outline` (escribe; motor Esquema): además acepta `session` (bool),
  `sessionStatus`, `sessionDate` y `linkedWritingId`; cualquiera de ellos marca el
  esquema como sesión. Una fecha inexistente o una nota de otro proyecto se rechazan
  antes de crear nada. `wh_list_outlines` devuelve `session {status, date,
  linkedWritingId, revision}` en las sesiones.
- `wh_session_planner` (lee): `{projectId?, outlineId?, preset?}`. Devuelve `groups`
  (`live`, `next`, `prep`, `played`; la fecha más próxima primero y las jugadas de la más
  reciente a la más antigua), `counts`, `presets` (`combat`, `map`, `reference`) y, por
  sesión, `id, title, templateId, status, date, linkedWritingId, revision, beatCount,
  done`. Con `outlineId` y `preset` añade `dockPlan {documents, apply}`: `apply` son el
  `owner`, el `expectedVersion` y las `actions` listos para pasar a
  `wh_writing_tool_dock_apply` (`null` si el proyecto no tiene ningún documento de esos
  tipos). No escribe nada.
- `wh_session_set_status` (escribe; motor Esquema): `{projectId?, outlineId, status?,
  date?, linkedWritingId?, expectedRevision?}`; `date` y `linkedWritingId` admiten `null`
  para borrarlos. Marca como sesión un esquema normal. Con el motor apagado responde
  `engine-disabled` antes de leer nada; `expectedRevision` distinto del actual da
  `conflict` sin tocar nada. Devuelve `{id, status, date, linkedWritingId, revision}`.
- Deshacer (`wh_undo`): devuelve estado, fecha, nota y marca de sesión, y también la
  revisión, de modo que se pueden deshacer varios cambios seguidos; se rechaza con
  `cannot-undo` si la sesión cambió después.

En la interfaz: pestaña «Planificador» en el motor Esquema (también
`?view=planner`) con los grupos En juego / Siguiente / En preparación / Jugada, un
selector de estado, «Abrir», «Abrir nota de preparación», «Nueva sesión» desde una de las
tres plantillas y las disposiciones de herramientas Combate (hojas, tablas, tablero),
Mapa (mapas, Códex) y Consulta (Códex, diccionario, cronología) para la nota de
preparación, con «Deshacer disposición». Cada disposición toma el primer documento de
cada tipo y sustituye el panel de herramientas de esa nota. Las casillas y campos del
esquema («Este esquema es una sesión de mesa», fecha, estado, nota) están bajo el título.

Prueba: `tests/session-planner.browser.tsx` (`scripts/run-vvd-tests.cjs`).

## 39. Comentarios: leídos y chinchetas (Ágora 1095, ola D2)

Cada hilo de comentarios tiene ahora un estado de lectura y los comentarios pueden clavarse en un punto del lienzo de un tablero (además de los que ya podían ponerse en un punto de un mapa clásico).

**Lectura.** El campo `readAt` es opcional en la fila del comentario: si falta, el hilo está leído (todos los anteriores y los que escribe la persona); con valor `0` está sin leer. Lo que se crea por el puente (`wh_annotate`) nace sin leer, y una respuesta que añade el puente (`wh_annotation_reply`) vuelve a dejar sin leer un hilo ya leído. Leer no es editar: no cambia la revisión de un hilo ni invalida un borrador ni el «Deshacer» de la última edición. Los cambios de contenido que hace la persona desde la interfaz cuentan como haberlo leído; los que hace el puente, no.

- `wh_annotation_thread_get` devuelve además `unread` y `readAt`.
- `wh_list_annotations` acepta `unreadOnly: true`; cada nota trae `unread` y `readAt`, y el resultado `unreadCount`.
- `wh_annotation_mark_read` (`id`, `expectedRevision`, `read` por defecto `true`; `false` lo deja sin leer): comprueba la revisión del hilo y devuelve un recibo para `wh_annotation_undo`.
- `wh_annotation_mark_all_read` (`projectId`, `eraId`, opcional `engineId` + `entityId` para un solo documento): marca como leídos todos los hilos sin leer del contexto, devuelve `{marked, undo}` y un único recibo que `wh_annotation_undo` deshace; sólo devuelve cada hilo a su estado anterior si sigue como lo dejó la llamada. El recibo es de un solo uso.

**Chinchetas en un tablero.** `wh_annotate` con `engineId: "board"`, `entityId` el id del tablero y `at: {x, y}` en coordenadas del tablero (las mismas que las posiciones de las tarjetas; admite negativos); no junto a `quote`, y el motor Tablero debe estar activo. El comentario se dibuja como chincheta en ese punto del lienzo: sigue el desplazamiento y el zoom y conserva su tamaño. `wh_list_annotations` devuelve `at: {x, y}` y `atSpace` (`percent` en mapas, `board` en tableros). `wh_annotation_move` (con `expectedRevision`) mueve tanto las marcas de un mapa (0 a 100, % de la imagen) como las de un tablero (coordenadas del tablero) y devuelve un recibo que lo deshace. En la interfaz: clic derecho en el tablero vacío → «Comentar aquí»; la chincheta se arrastra para moverla y al pulsarla se abre y se marca como leído su hilo.

**Para quien lo amplíe.** Un motor con lienzo registra, además de su `AnchorAdapter` (que no cambia), un `PositionalAnchorAdapter` con `registerPositionalAnchorAdapter` (`src/engines/_shared/anchoring/registry.ts`): dice qué tipo de ancla guarda, en qué espacio van `x` e `y`, cómo validar un punto y cómo describirlo. `wh_annotate` consulta ese registro para aceptar `at`, de modo que otro motor sólo tiene que registrarse. Los mapas (`map_point`) y el tablero (`board_point`) ya lo hacen; los mundos generados no.

Quedan fuera: chinchetas en el mapa del mundo generado, flechas para marcas fuera de pantalla y un interruptor para ocultar marcas.

Prueba: `tests/comments-read-pins.browser.tsx`.

## 40. Varias claves del puente (Ágora 1095, ola D2)

El puente ya no tiene un único token: tiene una lista de claves con nombre, para dar una a cada cliente y cortar una sin tocar las demás.

- **La clave principal («Principal»)** es el token de siempre (`<userData>/aibridge/token`). No cambia nada para los clientes ya configurados: `WH_BRIDGE_TOKEN`, el fichero que lee el adaptador stdio y el hub de la familia siguen funcionando. Se puede renombrar y regenerar, no revocar. Es la única cuyo token se vuelve a mostrar en Ajustes, como hasta ahora.
- **Claves nuevas** (Ajustes → Puente de IA → Claves de acceso → «Nueva clave»): un nombre de 1 a 60 caracteres, sin repetir entre claves activas, hasta 20 activas. El token (64 caracteres hexadecimales) se enseña **una sola vez**, con botones para copiarlo y para copiar la configuración del cliente; en disco solo queda su hash SHA-256 en `keys.json`. Si se pierde, se crea otra clave.
- **Revocar** pide confirmación y es inmediato: la siguiente petición con esa clave recibe 401 `revoked-token`. No se puede deshacer, y liberar el nombre permite reutilizarlo.
- **Uso**: cada clave guarda `createdAt` y `lastUsedAt` (se escribe como mucho una vez por minuto y clave). El panel muestra nombre, fecha de creación, último uso y estado.
- **Auditoría**: las líneas de `audit.jsonl` de escrituras hechas por el puerto llevan el campo aditivo `keyLabel` (nombre de la clave que autenticó la llamada, también en deshacer) junto al `client` que declara el cliente. El panel de actividad lo muestra. Las llamadas del copiloto no lo llevan.
- **IPC** (solo la ventana principal, `electron/security.ts`): `aibridge:listKeys`, `aibridge:createKey`, `aibridge:renameKey`, `aibridge:revokeKey`. Solo `createKey` devuelve un token; el resto nunca.
- **Límites**: sin permisos por clave (todas ven lo mismo y respetan el interruptor global de escritura), sin caducidad, y el adaptador stdio solo lee por su cuenta el token de la clave principal (con una clave nueva hay que pasarla en `WH_BRIDGE_TOKEN`).

Pruebas: `tests/ai-bridge-keys-main.ts` (migración, alta, renombrado, revocación, autenticación de cada clave, límite de `lastUsedAt`; se ejecuta desde `tests/electron-security.ts`) y `tests/ai-bridge-keys.browser.tsx` (panel con IPC simulado). Matriz: `tasks/vvd1095/D2-platform.md`, fila 75 y hueco 13.

## 41. Bloques de preparación y material para jugadores (Ágora 1095, ola B)

El menú «/» del editor ofrece tres bloques de preparación de partida: **Prueba**
(habilidad o característica, CD, modificador, ventaja o desventaja, qué revela y un
botón «Tirar» que guarda la última tirada en el bloque y la anota en la bandeja de
dados), **Encuentro** (criaturas con cantidad, vínculo opcional al compendio SRD o a
una ficha del Códex, «Preparar combate» crea una pelea en el seguimiento de
combate) y **Material para jugadores** (una imagen de la galería, qué es y cuándo
se entrega). Cada bloque se guarda como HTML semántico con sus datos en un atributo
(`data-wh-prep="check|encounter|handout"`, `data-wh-prep-data`) y su texto legible
dentro, de modo que Markdown, Word, ePub, el lector y la wiki lo dicen sin leer
atributos. La Prueba y el Encuentro nacen ocultos en la wiki (`wikiHidden`); el
material para jugadores no.

Markdown (lo que leen y escriben `wh_get_writing`, `wh_create_writing` y
`wh_update_writing`, además de la exportación a Markdown):

- `> [!CHECK] Prueba de Percepción CD 15 — hay huellas` (también `[!PRUEBA]`). A
  mano basta `> [!CHECK] Percepción CD 15 — nota`.
- `> [!ENCOUNTER] Emboscada` con líneas `> - 2x Goblin Warrior` y, opcional,
  `{monster:goblin-boss}` o `{card:<idDeFicha>}` al final de la línea (también
  `[!ENCUENTRO]`). Sin vínculo, un nombre que coincide exactamente con una criatura
  del compendio se rellena con sus datos al preparar el combate.
- `> [!HANDOUT] Carta del barón — al llegar a la posada` con una línea
  `> image: <id de imagen de la galería>` (también `[!MATERIAL]`).
- Al leer, cada bloque lleva una última línea `> <!-- wh-prep {…} -->` con todos sus
  datos; escribir ese Markdown de vuelta conserva la tirada, los vínculos y la
  referencia a la galería. `wh_extract_block_to_card` con `list:true` nombra los
  bloques `prep-check`, `prep-encounter` y `prep-handout`.

Herramientas nuevas (motor Galería):

- `wh_render_handout` (lectura): dibuja un material con estilo y devuelve
  `{template, width, height, mimeType:'image/png', base64}` sin guardar nada.
  Argumentos: `template` (`letter`, `casefile`, `terminal`, `noticeboard`), `title`,
  `body`, `signature`, `extra`, `lang`, `scale` (0,2 a 2), o `imageId` de un
  material ya guardado para redibujarlo desde su texto.
- `wh_create_handout` (escribe; motor Galería): lo dibuja y lo guarda en la galería
  (etiquetas `handout` y la plantilla, con el texto editable en la propia imagen);
  devuelve `{id, name, template}`. Se deshace con `wh_undo`; con la Galería apagada
  responde `engine-disabled`.

Las plantillas se hacen también en la interfaz («Crear desde una plantilla» en el
bloque): carta, expediente, pantalla de terminal y tablón de anuncios, con tres
ganchos de apertura (visita inesperada, hallazgo, suceso repentino). Editar el
texto de un material redibuja la misma imagen de la galería, así que los bloques
que la señalan siguen valiendo. Copias de seguridad JSON/ZIP y clonado conservan el
texto editable y reasignan las referencias a la galería y a las fichas.

No hay herramienta de puente para editar un material ya guardado (se crea otro o se
edita en la interfaz), ni se extendió `wh_export_document_image`.

Prueba: `tests/prep-blocks-handouts.browser.tsx` (`scripts/run-vvd-tests.cjs`).

## 42. Niebla de exploración en mapas de imagen (Ágora 1095, ola B)

Los mapas de imagen (motor Mapas; no los mundos generados, que tienen su propia
niebla de lector por capítulo) pueden llevar el campo opcional `exploration`:
`{revision, enabled, cols, rows, mask, party?, trail?}`. `mask` es una cuadrícula
de 256 celdas de ancho (las filas siguen el aspecto de la imagen) codificada por
tramos y en base64; una celda es explorada (1) o con niebla (0). `party` es
`{x, y, sightRadius}` (x e y en porcentaje de la imagen, `sightRadius` en
porcentaje de su ancho) y `trail` son pasos `{x, y, at, session?}` (hasta 500, se
descartan los más antiguos). `revision` sube con cada escritura. El campo viaja
con las copias JSON/ZIP, el clonado y las épocas como cualquier otro campo
opcional del mapa; sin campo, el mapa es el de siempre.

- `wh_map_reveal` (escribe; motor Mapas, comprobado antes de leer nada):
  `{projectId?, mapId, ops?, enabled?, expectedRevision?, eraId?}`. `ops` es una
  lista de 1 a 200 pinceladas `{op:"reveal"|"hide", x, y, radius}` (radio 0,5 a 100)
  o `{op:"all"}` (todo explorado) / `{op:"none"}` (todo con niebla); `enabled`
  enciende o apaga la niebla para los jugadores sin perder lo explorado. La
  primera llamada sobre un mapa crea el registro con la niebla encendida.
- `wh_map_party` (escribe): `{projectId?, mapId, x, y, sightRadius?, trail?,
  session?, expectedRevision?, eraId?}`. Mueve el grupo: se explora un círculo de
  `sightRadius` (0,5 a 100; por defecto el último, o 8) alrededor del lugar nuevo y,
  con `trail:true`, se añade un paso al rastro con su `session` (hasta 60
  caracteres).
- `expectedRevision` es la revisión leída en `wh_list_maps` →
  `exploration.revision` (0 si el mapa aún no tiene registro); si la niebla cambió
  desde entonces la llamada se rechaza con `conflict` y no cambia nada. Una llamada
  que no cambiaría nada (celdas ya exploradas, niebla ya encendida) se rechaza con
  `bad-args`.
- Deshacer (`__undo`): devuelve el registro anterior (o lo quita si no había). Se
  rechaza con `cannot-undo` si la niebla ya no está como la dejó esa llamada; las
  llamadas se deshacen en orden inverso. La revisión no baja nunca, de modo que una
  `expectedRevision` anterior sigue siendo obsoleta después de deshacer.
- Lectura: `wh_list_maps` añade `exploration` (`revision`, `enabled`,
  `exploredPercent`, `party`, `trailSteps`, `trail` con los últimos 50 pasos) solo
  en los mapas que lo tienen.
- Exportaciones: `exploredFog` en las opciones de la wiki
  (`wh_wiki_profile_save`, `wh_wiki_export`; por defecto apagada, y con ella apagada
  la salida es idéntica byte a byte a la de antes). Encendida, los mapas con la
  niebla activa dejan fuera lo no explorado y los marcadores y figuras que hay ahí,
  y conservan el rastro y la posición del grupo. El SVG del editor tiene su botón
  «Exportar con niebla». La niebla es una máscara visual: la imagen del mapa
  viaja entera en el archivo.

En la interfaz (pestaña Mapas): botón «Niebla» con «Niebla activa», pinceles
«Revelar» / «Ocultar» con radio, «Revelar todo» / «Ocultar todo», «Colocar el
grupo» (o arrastrar su marcador, que revela un círculo de «Visión»), «Dejar
rastro» con una «Sesión» opcional, «Borrar rastro» y «Vista de jugadores», que
dibuja la niebla opaca, oculta marcadores y figuras bajo ella y mantiene el rastro.
En la vista del autor la niebla se ve semitransparente.

Prueba: `tests/map-exploration.browser.tsx` (`scripts/run-vvd-tests.cjs`).

## 43. Mapas de la wiki: navegar, capas y sonido (Ágora 1095, ola D2)

La wiki exportada puede mover y ampliar sus mapas, dibujar capas de ilustración con paralaje y sonar con ambiente. Todo está apagado por defecto: un perfil que no lo pide exporta los mismos bytes que antes.

- `wh_wiki_profile_save` acepta cuatro opciones nuevas en `options`, sin tocar las anteriores: `mapNavigation` (`free` | `contained`), `mapArtwork`, `mapClouds` y `mapAmbience` (booleanos). `wh_wiki_profile_preview` y `wh_wiki_profile_publish` las aplican.
- `wh_map_artwork_get` (solo lectura, `mapId`): `{mapId, title, updatedAt, layers:{background|mid|front:{present, chars?}}, clouds, ambience, pinsWithAmbience}`. No devuelve las imágenes; `updatedAt` es la revisión que pide la escritura.
- `wh_map_artwork` (escritura, `mapId`, `expectedUpdatedAt` obligatorio): `background`, `mid`, `front` (URL de datos `data:image/` raster, nunca SVG ni remota; `null` quita la capa), `clouds` (booleano) y `ambience` (`{assetId, volume?}` de un audio local del proyecto, o `null`). Rechaza un mapa que cambió desde la lectura (`conflict`), imágenes demasiado grandes y audios inexistentes; exige el motor Mapas encendido. Se deshace: el recibo guarda marcas y las imágenes anteriores esperan en el almacén de imágenes; el deshacer se rechaza si esa parte se editó otra vez o la imagen salió del almacén.
- `wh_update_map_pin` acepta `ambience` (`{assetId, volume?, radius?}` con radio 2 a 60 por ciento del ancho del mapa, o `null` para quitarlo) y se deshace como el resto de sus cambios.
- `wh_list_assets` / `wh_asset_usage`: un audio usado como ambiente de un mapa o de un marcador aparece en `places` con el tipo `map-ambience`.

Prueba: `tests/wiki-map-navigation.browser.tsx`.
