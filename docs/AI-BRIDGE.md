# Puente IA — puerto local para modelos externos

Writers Hoard expone un puerto en `127.0.0.1` para que un modelo de IA que
corre fuera de la app (Odysseus, Claude Desktop, OpenCode, Cowork…) pueda
**leer y escribir** en tus proyectos: manuscrito, codex, diario y líneas de
tiempo.

Está **apagado por defecto**. Se enciende en **Ajustes → Puente IA**, donde
además tienes el token y el JSON listo para pegar en el cliente.

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

**Codex**

| Herramienta | Escribe | Notas |
|---|---|---|
| `wh_list_codex` | no | Filtra por tipo. |
| `wh_get_codex_entry` | no | |
| `wh_create_codex_entry` | sí | `fields` es un mapa etiqueta→valor libre. |
| `wh_update_codex_entry` | sí | `fields` se **fusiona**; `""` borra una clave; `replaceFields:true` sustituye el mapa entero. |

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

- **Token obligatorio** (`Authorization: Bearer …`) en todas las rutas.
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
`tool-error`, `missing-token`, `bad-token`, `browser-origin-refused`.

## 7. Dónde está cada pieza

| Fichero | Papel |
|---|---|
| `src/services/aiBridge/manifest.ts` | **Fuente única** del catálogo y del briefing. Datos puros: lo importan el renderer, el main y el adaptador. |
| `src/services/aiBridge/tools/*.ts` | Los handlers, uno por dominio, más `shared.ts` (coerción de argumentos, ámbito de proyecto, Markdown). |
| `src/services/aiBridge/tools/index.ts` | Tabla nombre → handler. |
| `src/services/aiBridge/dispatch.ts` | Escucha `aibridge:request` a nivel de módulo y responde. |
| `src/services/aiBridge/markdown.ts` | Markdown → HTML de TipTap, sin dependencias. |
| `electron/aibridge/server.ts` | El puerto HTTP y su política de acceso. |
| `electron/aibridge/rpc.ts` | El canal main→renderer con correlación por id. |
| `electron/aibridge/state.ts` | Token, interruptores y registro de auditoría. |
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
problema con `<img src>`, pero un `fetch` es siempre *cross-origin*: en
desarrollo el renderer es `http://localhost` y empaquetado es `file://`.
Relajar la CSP no arregla nada porque el problema es CORS, no CSP.

La solución es la misma que ya usaba el proyecto para Ollama: **por IPC**. El
canal `media:readLibraryFile` lee el fichero en el main —que ya es el dueño de
la raíz de media y de sus comprobaciones de contención— y devuelve base64. Si
alguna vez añades otra herramienta que necesite bytes de un fichero gestionado,
usa `readLibraryBlob()` de `tools/shared.ts`, no `fetch`.

---

## 12. Fase 3 — todos los motores, y grupos de herramientas

Tercera pasada (2026-08-30). El catálogo pasa de 37 a **82 herramientas**:
están conectados los 21 motores del proyecto. (Worldgen no: tiene su propio
proyecto.)

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
| `analysis` | anotaciones, auditoría de POV, estadísticas | 4 |

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
su nombre. `worldgen` está exento —está registrado pero no tiene herramientas
aquí, así que encenderlo desde un modelo no prometería nada.

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
