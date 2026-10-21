# D3 — compositor lateral de escritura

Estado: implementación D3 terminada, en cierre de pruebas y congelación para revisión independiente. El preflight y contrato que siguen se escribieron antes del producto; root autorizó D3 después del SHIP independiente D2-1/D2-2. Se conserva ese historial de diseño. No se reescriben proofs D1/D2; D3 tiene packet propio en tasks/local-sdk-D3-closure.md.

## Incumbente y alcance

WritingsView ya tiene columna ReferencePanel/Judge/Footnotes/Annotations y ReferencePanel temporal en foco. BookEditor conserva Footnotes bajo notesOpen y ReferencePanel temporal, además del editor combinado que guarda capítulos reales. ReferencePanel mantiene búsqueda/pins/edición Codex y selección; no se toca su fuente. El nuevo ToolDock se añade después de utilidades en la columna del capítulo y usa su propio botón/drawer en foco/libro/narrow. No sustituye paneles ni modifica sus estilos. Se usa pane.width/overlayTarget para dos paneles y drawer, no anchura global asumida.

Frontera lazy natural: sólo el componente ToolDock y, al abrirlo, los hosts/editor adapters D2. Una escritura sin bloques no importa los cinco editores de forma eager. Root evalúa el presupuesto entry actual1600kB en build final; no se rehace el sistema de carga.

Fuente del alcance: plan aprobado tasks/local-sdk-host1041.md, sección5 y criterios D3, basado en el artículo público Quill Side Panel ya leído. No se infiere cuadrícula XY, colaboración online, CRDT ni compatibilidad API VVD.

## Datos y semántica

Leaf puro `src/engines/writings/toolDock/types.ts`, sin DB/React/DOM/UI:

```ts
interface ToolDockLayout {
  version:1;
  revision:number;
  generation:string;
  blocks:ToolDockBlock[];
}
type ToolDockOwner = {kind:'project'} | {kind:'writings';documentId:string};
// El Project real siempre es scope.projectId; nunca book:<id> ni writing ficticio.
// Clases: document (referencia), owned (envelope source host), world (envelope readonly).
// Slot id estable; height opcional finita >0; orden=array, sin coordenadas XY.
Project.writingToolDock?: ToolDockLayout|null;
Writing.toolDock?: ToolDockLayout|null;
// WorldEra.defaults Pick<Project> añade writingToolDock.
```

Document refs usan IDs canónicos de Codex y los10 tipos ya soportados por ToolDocument (genealogy es el kind canónico del árbol); local-tool requiere namespace. Preview/editor reusa D2, cuyo editor enfocado existe para Codex/Map/Board/Timeline/Tree y source declarado. Resto conserva preview/modal existente; no promesa de editor para cada engine.

Missing y null en runtime heredan; null es reset explícito portable, mientras missing en import legacy conserva el valor existente donde se reemplaza el mismo registro. Un objeto blocks:[] es personalización vacía explícita. Nuevo layout se materializa sólo por acción explícita, nunca al abrir/leer/preview o crear era. Root aprobó null y generation tras el preflight.

Capítulo: su Writing efectiva.toolDock no nula gana; si no, el default del Project efectivo. Libro combinado: default Project, sin cambiar por selección del capítulo. Named era: default propio en WorldEra.defaults.writingToolDock; null/ausente hereda Base; overrides de Writing siguen las reglas normales del overlay documental. Dos panes tienen owners/scopes distintos. Personalizar capítulo copia explícitamente el layout efectivo a su override; copiar mantiene slots lógicos pero da generation nueva. Reset elimina propiedad efectiva con null, sin tocar el default ni documentos referenciados. Referencia documental puede abrir/editar su destino aunque layout heredado; owned heredado se muestra readonly hasta Personalizar, para no cambiar silenciosamente el default desde un capítulo.

ABA real: layout generationA/revision1 → reset null → personalizar mismos blocks revision1. Una revisión sola aceptaría el snapshot antiguo. GenerationB nueva lo rechaza. Undo/Redo, recuperación y restore normal de un layout histórico también renuevan generation; clone remapea generation y reinicia revision0. En estado vacío se incluye la versión del dueño en el token para no aceptar creación stale tras create/reset. No epoch volátil global.

## Exports puros para root

- `ToolDockLayout`, `ToolDockBlock`, `ToolDockOwner`, `ToolDockDocumentReference`.
- `validateToolDockLayout(value)` admite undefined/null y valida layout, IDs únicos, tres clases y heights. Envelopes usan validadores C/D2 existentes; payload opaque no se recorre para adivinar refs.
- `validateToolDockProjectMetadata({writingToolDock?,worldEras?})` y `validateToolDockWritingMetadata({toolDock?})`.
- `remapToolDockLayout(layout, remap)` preserva missing/null; remapea slot IDs, doc IDs por worldDocumentPrefixes, y sólo refs declaradas del envelope. Revision0 y generation remapeada. Names, opaque prose y local stable item IDs exactos.
- `renewToolDockGeneration(layout, newGeneration)` para restore normal Writing/history/era, sin aleatoriedad/DB dentro del helper puro.
- `toolDockSourceEnvelopes(layout)` para validar pins actuales/retained/restaurables en D2 releases.

Ejemplo clone: document target {kind:'codex',documentId:'cardA'} → remap('cardA','codex'); source-owned slot=envelope.id 'atomA' → remap('atomA','source-block'), data.linked declarada codex → mismo card remapeado; data.notes='cardA' queda igual. Layout generationG → remap('generationG','tool-dock-generation'), revision0.

Seams root reservados: types/index.ts, worldEras/types/store/portability, worldMetadata, projectArchiveMetadata, db/operations/ZIP, manifest/index y globalUndo. Root añade validators a Base Writing/import/full/ZIP/archived/era retained y remaps a Project default, era defaults, Writing roots/history/archive. Mismo registro legacy ausente conserva, null explícito hereda, blocks[] explícito borra slots. Se valida todo antes de clear/put. Root añade renew helper a restores normales que recuperan layout histórico, sin middleware nuevo.

## Escritor/CAS y prosa

Servicio `toolDock/store.ts` lee sólo Project/Writing efectiva; no tabla nueva ni pseudo-documentos. Layout CAS usa token compacto de layout completo/origen/generation/revision; hash de JSON fuera de R global, continuaciones Dexie en RW con tablas explícitas. En null/ausencia incluye contexto/version del dueño para ABA. Snapshot read no persiste cache.

Mutación lee último dueño dentro RW, compara baseline del layout, escribe sólo toolDock/writingToolDock/default específico, manteniendo otros campos/children. Writing.updatedAt y Project/era revisions conservan monotonicidad normal y history existente. Named Writing usa readWorldDocument/saveEraDocument con expectedVersion actual. Default era conserva los otros defaults y saveWorldEra normal. No restore/delete Base para cambiar era. Notificaciones y recibos disponibles sólo tras outercomplete; rollback restaura disponibilidad de receipt.

Metadata Dock puede elevar updatedAt mientras se escribe prosa. Writings/Book adoptan sólo la versión cuando título/contenido/wordCount guardados siguen realmente iguales al remoto; no setContent/remount, no mover selección, no borrar draft. Si el aviso llega después de iniciar save, retry sólo para el payload exacto title/content/wordCount que los editores normales envían, verificando current authored contra baseline antes del retry. Ninguna relajación para tags/status/chapter/synopsis/u otros escritores ni si el texto remoto cambió. Se probará la carrera antes del aviso y la que sí cambia texto. BookSave requiere ese hunk mínimo; no refactor general.

Owned utiliza createOwnedBlockClient/state actions C y un port sobre el envelope del slot, no otra biblioteca de estado. Dependencia D2 mínima aprobada: tipo de data-owner admite Project real además de dueños de prosa; operaciones D2 sobre HTML siguen restringidas a Codex/Writings. Host D3 conserva la lease irrevocable corregida y guards de contexto/pin/readOnly. Pin candidato valida envelopes del dock en Project/Base Writing/era/history/archive mediante helper puro; no evalúa código desde middleware.

## Operaciones, Undo y MCP

UI y bridge llaman al mismo servicio. Acciones add/remove/move/resize/customize/reset y actualización source-owned. Cancelar picker no crea slot. Remove elimina sólo slot; referencia no borra documento. Default Project tiene Undo de sesión explícito por layout, sin snapshot Project entero. Chapter override conserva el history normal Writing; no se afirma durable history de todo Project ni se añade otro middleware.

Recibo de sesión scope+owner+prelayout+afterversion, un uso, exacto: refuse wrong owner/era, cambios de layout posteriores, colisiones de ID, o receipt consumido. Undo/Redo no modifica prose ni datos de otro bloque/documento. Audit guarda sólo `{__writingToolDockReceipt,owner}`; root delega globalUndo al mismo reverse helper antes de era genérico. Outer abort no publica/consume receipts. Recovery diario local scoped owner/project/era conserva layout/datos source pendientes; engine-disabled recovery y reverse siguen siendo operativos sin exigir habilitar un motor para recuperar.

Bridge leaf/manifest propios propuestos: read/apply, block_read/block_apply, undo/redo. Writes normales comprueban engine-enabled writing/source según la operación; readonly, fuente ausente/incompatible, namespace/pin incorrectos y scope extranjero rechazan. Recovery/Undo no queda bloqueado por motor desactivado. Root registra nombres/export al freeze; selftest usa fixtures habilitadas y añade engine-disabled reales, no falsos PASS con bridge rechazado.

## UI, foco y lifecycle

Botón añadir abre picker de refs/source block types efectivos. Varias tarjetas con header, título, leer/editar, abrir aparte, subir/bajar y quitar. Altura resize pointer capture; equivalente teclado/input numérico. Pointer move sólo draft local, commit una vez al soltar; teclado/blur con commit explícito. Height opcional positiva sin máximo arbitrario. Contenido scroll local; headers/controles quedan accesibles. Preview readonly si falta módulo. Tres clases visibles en la misma pila.

Todos los pending guards D2 continúan: antes de quitar/cambiar owner/cerrar, flush o conservar editor/borrador visible. Hacer click en dock no cambia selección del manuscrito; Escape devuelve foco donde corresponda. Layout MCP no pisa prosa local; conflicto deja draft con reload/retry explícitos. Contexto key por Project/era/owner/layout generation; ningún callback tardío puede escribir después de readonly/retarget/unmount. Abrir preview/drawer/reload no crea versión.

## Publicación y lectores

Dock es sidecar de autoría; no se inserta automáticamente en texto ni se publica silenciosamente en Reader/wiki. Reader/export sigue readonly y no monta compositor editable. Root recibe helpers puros para capturar/mostrar un dock si un consumidor lo pide expresamente; no fallback a DB viva en snapshots. JSON/full/ZIP/clone y world source payloads sí conservan sus datos y referencias. No nuevo export runtime ni defineApp.

## Criterios de éxito y secuencia

1. Leaf puro + test Node boot sin React/DB/DOM: tipos/validate/remap/null/duplicate/opaque/legacy; root wiring antes de UI.
2. Writer/Base/era/default/chapter, cero writes al abrir, custom/resetABA y restore, fields/children preserved, nested abort/postcommit, source actions/Undo; servicios y native transport.
3. UI normal1440/640: tres clases, varios bloques, add/cancel/remove/order/height pointer+keyboard, reload; chapter override frente Book/default; Base/era dos panes; conservar todas utilidades y selección.
4. Carrera metadata vs prosa/Book antes del aviso, solapamiento real conserva ambos; readonly/pin/retarget/unmount y active peers; engine-disabled recovery y Undo.
5. JSON/full/ZIP/clone Base/era/history/archive/codeabsent y validación antes de reemplazo; exact declared refs/opaque bytes.
6. Build/lint/typecheck/regresiones de D2/D1 y snapshots root, proof D3 nuevo; revisión independiente antes de integrar. No D3 SHIP por vertical incompleta ni CRDT.

## Notas de implementación al cierre

- Los owned blocks usan un Project real o Writing real en Snapshot.block.owner. El host crea una lease nueva por setup confirmado, sin revivir clientes StrictMode anteriores; revalida dentro de RW y antes de commit. Cambios MCP externos notifican la suscripción sin remount y el hook preserva drafts propios.
- El primer cambio de altura captura baseline y journal; todos los ajustes pendientes de esa sesión se guardan en un batch CAS. Una actualización MCP durante edición no sustituye esa baseline. Conflicto conserva input/journal y la recuperación explícita renueva generation.
- Los guardas de navegación pertenecen al pane, proyecto y era exactos. Se conservan pending flushers y avisos de cierre existentes. Prosa autosave sigue independiente.
- BookBaseline conserva persistedTitle además del título del heading, porque un heading vacío se guarda como Untitled. El retry de metadatos compara el título realmente escrito, sin relajar CAS para renumerar capítulos ni para otros payloads.
- La presentación de los documentos heredados puede cambiar localmente a editor sin personalizar el layout del padre. El modo persisted de un layout propio sigue siendo CAS. Las consultas world montan la declaración compilada con cliente readonly; sin fuente se usa el preview semántico guardado.
