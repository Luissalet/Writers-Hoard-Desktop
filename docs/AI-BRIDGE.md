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
| `src/services/aiBridge/markdown.ts` | Markdown ⇄ HTML de TipTap, sin dependencias; con `footnotes: true`, las notas al pie del manuscrito. |
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
