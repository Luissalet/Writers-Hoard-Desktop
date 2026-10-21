# D3 — compositor lateral: cierre para revisión independiente

Estado: producto terminado; no se declara SHIP ni paridad total SDK. La revisión independiente de D3 queda pendiente. D1/D2 y sus proofs anteriores se conservan sin reescribir. El contrato preproducto y la secuencia autorizada están en [local-sdk-D3-plan.md](local-sdk-D3-plan.md).

## Resultado y perímetro

Writing permite una pila lateral propia de documentos enlazados, bloques source-owned y consultas source-world. Book usa el Project real como default; capítulo puede heredar, personalizar o restaurar herencia con null. Una era nombrada dispone de defaults y overrides contextuales, sin cambiar Base ni duplicar el mundo al abrir. Orden y alturas son metadata portable; sólo acciones explícitas materializan layouts. Las referencias abren los mismos documentos y cinco editores enfocados D2, no listas completas de motores. Los otros previews y el acceso anterior por modal continúan.

ToolDockPanel es la frontera lazy; sus hosts/adapters no entran por abrir Writing sin dock. El panel mantiene Reference/Judge/Footnotes/Annotations. En Book/foco el acceso es un botón propio y modal. La altura de cada cuerpo limita sólo su scroll; controles de orden/altura/quitar permanecen fuera de ese cuerpo. Teclado usa botones y entrada numérica; puntero usa capture y guarda al finalizar, no por cada move. El formulario source de ejemplo se apila por container query en columna estrecha; no hay cambios de estilo fuera del dock.

## Integridad y lifecycle

- Escritor normal, CAS compacto y generaciones persistidas para reset/recovery/history/Undo; no nuevo schema DB, middleware ni overlay paralelo. Writing/Project/era conservan updatedAt/revision y history normales.
- Guardas antes de salir/quitar, journal scoped `wh.tool-dock-drafts.v1.<project>[.era:<era>]`, avisos existentes de cierre y recuperación/Undo con motores desactivados.
- Cliente owned entrega owner Project o Writing real. Lease irrevocable por setup, independiente de otros hosts/panes; revocación readonly/retarget/unmount y dentro de una RW hace rollback. Las actualizaciones MCP se observan sin remount; un draft de un pane no bloquea otro.
- Metadata Dock no reserializa prosa. Retry sólo para `{title,content,wordCount}`, mismo authored baseline y Dock cambiado; otros campos remotos no se reenvían. Book conserva el título persistido cuando el heading del editor está vacío. Cambios de prosa solapados siguen rechazados.
- Recibo audit pequeño `{__writingToolDockReceipt,owner}`; Undo global y UI delegan al mismo servicio, exact afterversion, scope/owner y single-use. Outer abort no publica ni consume recibos. Undo/Redo/recovery renuevan generation.
- Pin valida declaraciones del dock actual y retenido: Project/default de era, Writing, variantes ocultas, history y Archive. Una fuente ausente conserva preview readonly del payload guardado.

## Seams entregados y conectados por root

Puros: `toolDock/types.ts` exports ToolDockLayout/Owner/Value/Block, validateToolDockLayout, validateToolDockProjectMetadata, validateToolDockWritingMetadata, remapToolDockLayout, renewToolDockGeneration y toolDockSourceEnvelopes. Slot/source IDs y refs declaradas se remapean; prose/data opacas siguen exactas, revision0 y generation nueva en clone.

Servicio `toolDock/store.ts`: readWritingToolDock, applyWritingToolDock, applyWritingToolDockBlock, replaceWritingToolDockEnvelope, reverseWritingToolDock y restoreWritingToolDockDraft. Root conectó Project/Writing/era metadata, JSON/full/ZIP/clone, Writing history/Archive/era restore y limpieza scoped del journal.

Bridge/manifest: WRITING_TOOL_DOCK_HANDLERS y WRITING_TOOL_DOCK_TOOLS, seis tools `wh_writing_tool_dock_{read,apply,block_read,block_apply,undo,redo}`. Son core sin engineId porque reads/reverse deben operar en recuperación; las writes normales exigen writings/source en el servicio. Root registró schema/handlers y rama dedicada Undo antes del fallback genérico de era.

## Pruebas y evidencia

Los logs finales se conservan en `work/local-sdk-D3/`. Fuentes, tests, capturas y logs llevan SHA256 en `tasks/evidence/local-sdk-D3-proof.json`. Todos los perfiles son sintéticos aislados; no datos reales, app real, modelos ni red de modelos.

| Prueba | Resultado |
| --- | --- |
| Node puro validators/remap/boot/guardas exactos | 4 grupos PASS |
| Store Base/era/default/override/ABA/outer abort/engine-off | 3 grupos PASS |
| Prosa + Book stale metadata y conflicto real, incluido heading vacío | 2 grupos PASS |
| Lease StrictMode/readonly/retarget/unmount/queued RW/beforecommit rollback | 2 grupos PASS |
| Formulario altura baseline anterior vs MCP Base/era, journal + descarte | 1 grupo PASS |
| Recovery y UI Undo con fuente ausente y motores apagados | 1 grupo PASS |
| Dos docks activos Base/era, draft independiente y MCP refresh in-place | 1 grupo PASS |
| Pin actual y retenido: seis escenarios | 2 grupos PASS |
| stdio externo → HTTP → executor → IPC → dispatch normal/IndexedDB | 4 contextos PASS |
| UI nativa/CSS 1440/640 + named era | 3 grupos PASS; 5 capturas |
| Root JSON/full/ZIP/clone/history/era/Archive y global Undo | 4 + 1 grupos PASS |
| Regresiones D1 retained, D2 blocks/retained/lease | 2 + 3 + 1 + 3 grupos PASS |

El transporte cubre CAS stale, tres clases, audit→Undo, Redo, one-use, owner incorrecto, rollback/abort y retry, consulta readonly, edición posterior y Undo con motor apagado. El UI usa los componentes normales Writing y Book, conserva DOM/selección/bytes del manuscrito, verifica pending remove/close, añadir/cancelar/quitar, orden, alturas teclado/puntero, reload y ausencia de overflow horizontal.

Diagnósticos durante autoría conservados: el primer drag del driver emitía pointermove.buttons=0; se registraron los eventos reales en profile9RvFRZ y se corrigió el driver Electron con modifier leftButtonDown. Un segundo fallo del fixture intentaba Next round antes de que acabara el query del cliente al montar640; el fixture ahora espera el botón real habilitado. No se atribuyeron esos fallos a producto. Perfiles previos sVjLaa/MWIskT/9RvFRZ/z42vJG/JCL8ni siguen en Temp. Warnings React act de queries asíncronos siguen visibles en logs; assertions funcionales/CAS no se omitieron.

## Límites explícitos

El dock es sidecar de autoría; no se publica automáticamente en Reader/wiki ni se añade al manuscrito. JSON/full/ZIP/clone sí lo conservan. Project default tiene Undo de sesión; capítulo mantiene history documental normal. No se promete history durable nuevo del Project, CRDT, presencia ni colaboración online (S02 sigue parcial). Un codec de prosa continúa como scalar CAS. Source code es compilado local y un pin ausente no selecciona latest. Pending UI arbitrario de un source debe usar el hook/contrato normal; no se adivina ni serializa su estado interno privado.

## Cierre independiente posterior (2026-10-21)

El estado pendiente al comienzo de este documento corresponde al envío histórico
del autor y queda superado por **SHIP dentro del alcance D3 revisado**, incluida
la corrección root de sidecars de eras antiguas. Informe independiente:
`D:/LocalAI/projectlesswork/worldcraft1041-D3-independent-review.md`, SHA256
`41a65a26b58e5f6b64baac0e35ea5be66f1e0d88c96184b79c2de9aa0187fe93`;
proof separado: `D:/LocalAI/projectlesswork/worldcraft1041-D3-independent-proof.json`,
SHA256 `27c5cff09764e17ca8657089240ed191702f95ae1deebe886999f07574ecfe1a`.
Los proofs, fallos y diagnósticos históricos del autor y el addendum se conservan.
Este dictamen funcional acotado no certifica paridad universal ni versión
instalada. La integración y QA global continúan abiertas por la corrección de
mapas y el presupuesto del renderizador, fuera de esta revisión D3.
