# D — host documental y bloques de herramientas locales

Estado actual: D1 SHIP acotado tras revisión independiente; D2 implementado y congelado para revisión independiente; pruebas propias PASS. D3 requiere esa revisión antes de comenzar. D3 aún no implementado. A/B/C se amplían sólo con las dependencias D1/D2 explícitas documentadas abajo. Trabajo en writer-worldcraft1041; no aplicación real, cuenta autenticada, publicación ni datos de Luis usados.

Historial del plan: el precontrato original se escribió antes de cambios de producto; root aprobó después el alcance D1/D2/D3 y autorizó exclusivamente la ejecución secuencial de D1 con freeze/revisión antes de D2. Las secciones de auditoría y diseño siguientes conservan ese estado inicial como referencia, no como afirmación de que D1 siga sin implementar.

## Fuentes primarias consultadas

- [Modelo mental](https://docs.beta.vvd.world/workshop/guides/mental-model), leído el20-10-2026 mediante búsqueda indexada y HTTP directo tras fallar el open del navegador web. La documentación distingue contenido del mundo, contexto de era, herramientas documentales y aplicaciones que proporcionan el host. Un documento tiene identidad; las eras componen variantes al leer. Los bloques pueden pertenecer a un documento contenedor o leer el mundo sin documento propio. Nuestro Project conserva su significado actual: no se rebautiza ni se inventa otro worldId.
- [Referencia de herramientas](https://docs.beta.vvd.world/workshop/reference/tools), leída el20-10-2026. Distingue vistas editor/embed/fullscreen, embed inerte de preview frente a herramienta interactiva, y datos de bloque actualizados por su dueño. También describe rich text con CRDT y capacidades del host más amplias. Son contratos distintos: implementar nuestras vistas no demuestra CRDT ni todo el host del proveedor.
- [Quill Side Panel](https://vvd.crisp.help/en/article/quill-side-panel-kwwch0/), artículo público marcado en desarrollo, actualizado20-08-2026. Describe accesos fijos y bloques personalizables que se añaden, eliminan y redimensionan; algunas funciones abren otra pestaña. Incluye notas por capítulo y generales. No aporta aquí una ejecución autenticada ni una especificación de geometría libre en dos dimensiones.

Las rutas públicas se han verificado; no se ha probado una cuenta de VVD ni se reutiliza una sesión autenticada. Las propuestas de formatos/rutas siguientes son diseño propio sobre el repositorio, no una atribución de API compatible.

## Auditoría de lo que existe

| Pieza actual | Qué hace realmente | Qué falta |
|---|---|---|
| local/sdk.ts, storage.ts, registry.tsx | Una definición por namespace/version compilada; cliente scoped a Project/era; estado legado por namespace; codec/acciones/refs y recibos C. | No documentId, varias instancias de contenido, contexto editor/embed/fullscreen o registro de bloques. Un namespace no es un documento. |
| toolBlocks/ToolDocumentBlock.ts y model.ts | Átomo Tiptap con projectId/kind/documentId/label para nueve tipos builtin. El HTML guarda un puntero. | No tipos source dinámicos, vista editable dentro del átomo ni datos de bloque propiedad del contenedor. |
| ToolDocumentBlockView.tsx | Preview semántico vivo; botón Editar abre ToolDocumentModal. Modelo3D tiene además visor compacto real. | Preview+modal no equivale a montar el editor dentro del bloque. La excepción3D no generaliza a los demás motores. |
| ToolDocumentModal.tsx/session.ts | Engine real dentro de PaneRouter/EnginePaneContext; scope de era y foco; guardas, formularios explícitos, pending flush y diarios CAS de herramientas. | El ciclo de vida está acoplado al modal y a cuatro tipos de diario. No es una API documental source ni un compositor. Se conserva su comportamiento y acceso. |
| toolBlocks/reading.ts/preview.ts | Hidratación viva readonly y export semántico con políticas/exclusiones; ReaderSource evita consulta viva al publicar snapshots; 3D y sheet tienen salidas propias. | No registro source preview/owned block; las listas y switches de tipos son cerrados. No exportar código source desde un backup. |
| EnginePaneContext/PaneRouter/ProjectWorkspace | Foco, proyecto/era por panel, navegación aislada y paneles compañeros reales. | No contrato de documento ni vistas de fuente; los tabs compañeros residen en estado de React. No son bloques laterales con altura y orden persistidos. |
| WritingsView/BookEditor/ReferencePanel | Texto normal, columna/drawer de consulta; Codex se puede editar allí; Judge, notas al pie y comentarios conservan funciones propias. open/width del reference panel viven en localStorage. | No lista arbitraria de varios bloques fuente/referencias con geometría guardada en datos portables. No sustituir estos controles por el nuevo dock. |
| worldEras registry/store/history | Quince clases documentales, metadatos agregados, CAS/hide/reinherit/historial/archivos. | Un tipo fuente real exige ampliar las tablas de tipos y portabilidad. saveEraDocument es sólo para era nombrada: Base necesita su escritor normal, no fingir que ese método ya hace ambos. |

Se leyeron además TiptapEditor (registro de extensiones y host Codex), CodexBlockView (preview/open), readerSource, documentHistory/capture y los seams de clonación. No he tocado los trabajos DOCX/404 de B ni Reader/wiki/voz de A/root.

## Contrato mínimo propuesto

### 1. Documento fuente independiente, sin migrar el estado legado

Una sola clase documental nueva, `local-tool`, con un agregado de metadatos opcional `Project.sourceToolDocuments?: SourceToolDocument[]`:

```ts
type SourceToolDocument = {
  id: string; namespace: string; title: string;
  revision: number; createdAt: number; updatedAt: number;
  data: LocalToolJson; codec?: LocalToolStateCodec;
};
```

Cada documento tiene un ID real distinto. Namespace selecciona la definición y su pin de código; id selecciona la instancia. No nombres sintéticos de namespace/proyecto ni copia del Project completo. Codec guardado permite validar, clonar referencias y mostrar un fallback con la fuente ausente. Sólo crear explícitamente escribe initialState; abrir/pintar/exportar no crea documento ni variante. Los estados actuales Project/WorldEra.localToolStates continúan intactos y accesibles en su ruta legado; no se copian a documentos ni se borran. Las fuentes sin declaración documental siguen exactamente su flujo actual.

Extender EraDocumentKind con `local-tool` y eraAdapters con `{metadata:'sourceToolDocuments'}` permite leer/hide/reinherit el mismo ID por era y aprovechar el historial/archivo existentes. Base CRUD modifica sólo ese registro en la última fila Project dentro de RW con revisión observada; era usa el CAS del agregado existente. State actions C se ejecutan sobre ese data y revisión, preservando título/metadatos del documento. El hash genérico sigue siendo el token documental externo; no sustituirlo por una fecha. Validar la relación namespace/codec/data antes del commit. No inventar un segundo overlay. El registro/validador del nuevo tipo debe seguir siendo puro durante construcción de DB e historial: nunca resolver código compilado desde capture/middleware. Probar ambos órdenes de import y restaurar con la fuente ausente.

El pin B continúa compartido por proyecto/namespace y se comprueba para **todos** los payloads legado y documentos Base/own-era de esa fuente. Fuente ausente o incompatible conserva documentos, punteros y diarios, con estado no disponible. Selección de versión no migra datos. Biblioteca, búsqueda, refs, archive/history y cuentas normales de documentos deben incluir este tipo; habilitación sigue siendo la del engine real local-tool-<namespace>.

### 2. Una API de montaje que consume una identidad documental

Extensión opcional de LocalToolDefinition:

```ts
document?: { defaultTitle: {en:string;es:string}; embed: 'preview'|'interactive' };
preview?: (input: ReadonlySourceSnapshot) => LocalToolSemanticPreview;
blocks?: readonly LocalToolBlockDefinition[];
```

Props nuevas compatibles con componentes antiguos: `document?: {id,namespace,title}` y `context?: {view:'editor'|'embed'|'fullscreen',canEdit,scope}`. La ruta legado puede omitir document; **todo montaje documental tiene contexto concreto**. Una fuente documental usa el mismo componente en las tres vistas. Un cliente con documentId mantiene read/save/state/refs/operaciones C, apuntando al documento y nunca al blob legado. Recibos incluyen documentId, además del scope/codec/release existente.

`LocalToolDocumentHost` público resuelve identidad y pin, prepara cliente, contexto y ciclo de vida; lo consumen la ruta normal, embed y fullscreen. Internamente conviene extraer un `LocalToolStatePort` de IO read/compare-save/transaction de storage.ts: el mundo/media/search/nav común no se duplica entre namespace/documento/bloque. No crear otra app, router externo, iframe, sandbox, red ni runtime eval. Esto añade un host consumible de documentos al producto; no afirma un catálogo arbitrario de defineApp ni compatibilidad binaria con Workshop.

La ruta normal sería `/project/:id/local-tool-<namespace>?document=<id>&era=<era>`. Misma ruta lógica/ID en todas las superficies. El chrome muestra título editable, guardado/conflicto y fullscreen; no renderizar la lista de todos los documentos dentro de un embed. El componente de la herramienta recibe sólo su documento. El engine normal añade lista/crear/abrir documentos y conserva el acceso al estado legado si existe.

### 3. Tres contenidos diferentes bajo un bloque host

No confundirlos ni guardar una copia de la fuente cuando se quería una referencia:

1. **Referencia documental**: target a un documento builtin o source. Cambiar la herramienta cambia el documento referenciado. El HTML conserva ID/proyecto/tipo/namespace cuando procede y presentación opcional; un atributo ausente conserva el preview legado. El descriptor nunca guarda un título como identidad.
2. **Bloque propietario del contenedor**: nueva declaración `defineLocalToolBlock({key,scope:'host',initialState,codec,validateState,component,preview})`. El átomo guarda blockId estable, tipo cualificado namespace/blockKey, data, codec y revisión. No crea un documento independiente. Codex/Writing/dock propietario guardan sus datos con su propio CAS/recovery. onApply del host ejecuta acciones C y actualiza el nodo por transacción Tiptap; no abre una conexión paralela ni usa Project.localToolStates.
3. **Bloque de mundo**: `scope:'world'`, cliente readonly de consulta, sin data ni documento propio. Ejemplo de roster efectivo. Puede vivir en card/dock sin fabricar una instancia vacía.

La declaración vive con la fuente compilada/pin B y expone el mismo tipo estable en insertar/UI/MCP. Un bloque no disponible conserva su envelope opaco portable, presenta fallback y permite quitarlo/abrir fuente cuando vuelva a estar. No ejecutar código de un archivo importado.

Para operaciones MCP sobre un bloque propietario: owner explícito `{kind:'codex'|'writings',documentId}` más blockId. Leer el último HTML y CAS de su dueño, localizar sólo ese átomo, mezclar su data por acciones C y escribir por el escritor normal del dueño. El helper de parche debe conservar los bytes fuera del nodo objetivo; no reserializar toda la prosa con DOMParser. UI y MCP no pueden mantener dos versiones autoritativas del bloque. Si hay texto local pendiente, flush/conflicto normal antes de aplicar un cambio remoto: conservar ambos borradores, nunca setContent encima de prosa no guardada. Los bloques dentro del editor de libro identifican el capítulo dueño, no el documento compilado de todo el libro.

### 4. Embed editable y preview son contratos distintos

- `preview`: representación semántica readonly e inerte; botón Abrir/Editar separado conserva ToolDocumentModal. No presentarlo como full editor.
- `interactive` en un editor: componente documental real dentro del bloque con sus controles y cliente scoped. Acciones se guardan en la fuente referenciada; un bloque propietario guarda en su contenedor. Tiptap stopEvent/foco evita que el Undo/teclado de un mapa/canvas modifique el manuscrito.
- `fullscreen`: el mismo target/componente ocupa el host sin su chrome envolvente. Salida usa la misma sesión/guardas/flush; no navegar o desmontar antes de resolver borradores.
- Reader/wiki/export/publicación: sólo preview readonly a partir de ReaderSource/snapshot. Usar `LocalToolSemanticPreview` como estructura segura (texto/filas/imagen local opcional), no HTML/JS arbitrario. Fallback genérico desde codec/data si no hay fuente compilada. Mantener los visores3D/ink actuales. No exportar paquetes fuente ni llamar a la DB viva desde una edición publicada.

Extraer lifecycle del modal a `ToolDocumentHostSession` con flush/close guard/diario por instancia; ToolDocumentModal lo consume sin perder sus casos ya probados. Para los cinco tipos exigidos por Q08, registrar adapters explícitos de editor enfocado a documento: CodexEntryForm, Maps, Board, Genealogy y Timeline. Cada uno reutiliza el editor real y su CAS; un resumen no cuenta. EnginePaneContext y PaneRouter aíslan sus eventos/era/ruta. El adapter puede resolver una navegación a otro documento como Abrir separado, nunca retargetear en silencio el bloque fijo. Los otros tipos conservan preview+modal hasta declarar y probar su editor embebible; no afirmar full editor de cualquier builtin.

Detectar ciclos por identidades de ancestros al montar documentos referenciados; mostrar referencia/abrir ante un ciclo real. Sin nuevo tope arbitrario de anidación. Conservar compatibilidad del ToolDocumentDepth actual del modal hasta que las pruebas de lifecycle justifiquen sustituirlo.

### 5. Compositor lateral de Quill persistido y acotado

Añadir **bloques personalizados debajo de las utilidades existentes**, conservando ReferencePanel/Judge/Footnotes/Annotations y los accesos de foco/borradores/estilo. No convertir la columna existente en una aplicación nueva. Bloques: referencia documental preview/editor, bloque source propietario y bloque world-scoped.

Contrato portable propuesto:

```ts
type ToolDockLayout = {version:1;revision:number;blocks:ToolDockBlock[]};
// cada bloque: id estable, contenido/tipo y height opcional positiva finita;
// la posición es el orden del array, no una cuadrícula XY inventada.
Project.writingToolDock?: ToolDockLayout; // predeterminado del libro/proyecto
Writing.toolDock?: ToolDockLayout;       // override explícito del capítulo
// WorldEra.defaults amplía su Pick<Project> con writingToolDock.
```

Capítulo hereda el predeterminado mientras no se personalice. Era compone defaults y/o la variante Writing normal: cero copias al crear era y sin activo global. BookEditor usa el predeterminado; capítulo usa su override si existe. Restablecer al predeterminado es una acción explícita. La geometría no necesita localStorage y viaja con el proyecto.

Añadir/quitar/mover/redimensionar tiene servicio CAS sobre layout revision, teclado (subir/bajar, altura), pointer capture y recuperación del borrador de layout. Quitar una referencia no borra el documento. Quitar un bloque propietario modifica sólo su dueño y conserva su historial normal; persistir el predeterminado debe tener Undo explícito por el mismo servicio, no restaurar un Project entero. Cerrar/minimizar un editor primero usa sus pending guards. Narrow muestra stack/drawer con scroll local sin comprimir mapas o perder el manuscrito. Las alturas y posiciones guardadas sobreviven reload/ZIP; no reutilizar los tabs temporales de ProjectWorkspace como formato de datos.

## Seams y nombres que necesita ceder root

| Seam | Rutas / símbolos propuestos | Motivo |
|---|---|---|
| Puros de datos | local/documents/types.ts: SourceToolDocument, validateSourceToolDocuments, remapSourceToolDocuments; local/blocks/types.ts: LocalToolBlockEnvelope/validate/remap; writings/toolDock/types.ts: ToolDockLayout/validate/remap | Publicar primero para wiring root; sin DB/React en validators. |
| Tipo/era/storage | types/index.ts Project.sourceToolDocuments/Project.writingToolDock/Writing.toolDock; worldEras/types/registry/documentPrefixes/adapters/portability; source writer local/documents/store.ts | Una clase real local-tool, prefijo de clone, validación, CAS Base/era, dedup/historia/archivo existentes. La unión cerrada obliga revisar todos los mapas exhaustivos; no esconder este coste. |
| SDK | local/sdk/registry/storage/bridge/manifest/testing + DocumentHost/statePort/blockRegistry leaves | Documento/view/context y fake host reales; pin validation sobre todas las instancias y recibos con identidad completa. A/B/C permanecen compatibles. |
| Editor | editor/toolBlocks/{model,Block,View,Controls,Modal,session,reading,preview}; nuevo sourceBlock node; TiptapEditor; sanitizeRichHtml; codexBlocks y CodexEntryForm sólo el seam de edición inline | Preservar punteros viejos/modal; registrar tipos source, node attrs/envelope, edición real y fallback readonly. No tocar fórmulas/propiedades Codex. |
| Cinco adapters | components/codex + engines/maps/board/genealogy/timeline, EngineDefinition optional documentHost adapter | No vender full editor por montar un preview. Reutilizar motores, foco/diarios y operaciones. Locks adicionales antes de tocar. |
| Compositor | writings/components/{WritingsView,BookEditor}; nuevos writings/toolDock leaves; ReferencePanel sólo integration necesaria | Varias instancias/height/order reales sin quitar paneles actuales; capítulo/libro/foco/narrow y CAS/layout recovery. |
| Descubrimiento | workspace Library types/catalog/portability/UI; projectSearchIndex, anchoring, refs | engineId dinámico local-tool-namespace con documentId; no perder clasificación ni clonado si falta código. Necesita un resolver de prefijo en vez de indexar Record builtin con un slug dinámico. |
| Portabilidad | root worldMetadata/projectArchiveMetadata/operations/zipBackup; worldEras/portability y documentHistory/documentArchive adapters | JSON/full/ZIP/clone/source ausente, envelopes en HTML, refs declaradas, layout IDs, variante/historial y borrado. Esperar freeze DOCX/404 de B en esos solapes. |
| Lectura/publicación | root ReaderSource/readerExport/tool preview + publishedEditions source capture | Captura exacta/frozen de documentos/envelopes; ningún live fallback; no JS de fuente en export. A/root están activos aquí: delegar hunk, no pisar. |

MCP propuesto (mismos IDs que UI, por arrays normales): ampliar los once wh_local_tool_* con documentId opcional donde tenga sentido; ausencia conserva legacy. Nuevos wh_local_tool_document_list/create/rename/archive; wh_local_tool_block_types/insert/read/apply/remove con owner+blockId; wh_writing_tool_dock_read/apply con owner/revisión/acciones. get de un documento reutiliza read/describe; save/state/Undo mantienen los servicios actuales con otro state port. No generar doc IDs nuevos por cada montaje ni duplicar CRUD por engine. Layout Undo y block Undo se delegan al mismo escritor con recibos/contexto, sin snapshots completos en audit; root decidiría la rama global Undo si quiere exponerla además del Undo del host.

## Criterios de éxito antes de código

- [ ] Dos documentos de la **misma** fuente, con IDs reales distintos, guardan datos distintos; dos montajes del mismo ID comparten cambios. UI/Library/route/MCP identifican exactamente esos IDs. La fuente sigue ejecutando distinto código según el pin B; pin incompatible valida también todos los documentos.
- [ ] Base y dos paneles en eras diferentes leen el mismo ID lógico con variantes propias. Crear era/abrir preview no escribe/copia. Historial/archivo/restauración/eliminación de proyecto incluyen source docs; ningún save tras borrar reanima una fuente.
- [ ] Fuente ejemplo real “initiative counter”: dos instancias documentales; editor/embed interactivo/fullscreen alteran el mismo contador/lista por acciones C. Preview no cambia datos. Bloque propietario “roll result” cambia sólo la card/chapter dueño; bloque world roster lee la era sin documento propio. No mock UI para probar capacidad.
- [ ] Codex, Maps, Canvas, Tree y Timeline realizan al menos una mutación propia completa desde el editor inline/dock, sin abrir la ruta principal/modal como sustituto. Flush/cierre, Undo, conflicto externo con borrador conservado y foco/selección del manuscrito se prueban por tipo; el modal previo sigue pasando.
- [ ] Compositor añade tres bloques de clases distintas, cambia orden/altura por ratón y teclado, quita sólo el slot, recarga y restaura JSON/full/ZIP/clone manteniendo datos/refs. Capítulo override, Book default, named-era y dos paneles permanecen independientes.
- [ ] Cambio MCP a un bloque con prosa local pendiente no pisa texto. Patch remoto preserva bytes fuera del átomo y usa CAS real del propietario. BookEditor guarda en el capítulo correcto. Undo/Redo source/owned/dock tiene abort/retry/contexto y rechaza solapamiento posterior.
- [ ] Reader/wiki/publicación y export no abren documentos ni fuentes ni escriben; usan snapshot provider. Con código ausente se conserva/importa/clona/exporta un fallback fiel y sin ejecutar backup. Binaries siguen por activos dedup existentes, no por JSON state. Los filtros/exclusiones de export siguen vigentes.
- [ ] Fake host y escenario native idéntico cubren documento/bloque/dock reales; stdio→HTTP→executor→IPC→IndexedDB con readonly/rollback. Host queries tras Blob import y escritor RW encolado terminan: no envolver todas las lecturas en R, ni perder contexto de transacción después de crypto. Lecturas raw/commit explícitos o continuaciones Dexie donde sean necesarias, como las regresiones Q17/SDK ya enseñaron.
- [ ] Prueba normal1440/640 + lifecycle desmontaje/recuperación; regresiones A/B/C, bloques9+media/Codex, era/history, Library, export/publicación y tipos/lint correspondientes. Revisión fresca independiente antes de integración; no conformidad autodeclarada con Workshop.

## Tamaño, alternativas y cierre posible

Éste es un frente mayor que C: la parte costosa es añadir una clase documental a contratos exhaustivos, portar datos/referencias con y sin código, y coordinar dueño/flush del HTML vivo. La UI no es el único coste. El camino pequeño correcto usa metadatos agregados existentes y un state port; una nueva tabla Dexie añadiría migración/índices/transacciones sin ventaja necesaria para este primer tipo. Un blob por namespace con IDs concatenados se descarta porque no da documentos reales, archivo/clonado ni era coherente. Montar un engine entero con su lista de documentos en cada bloque tampoco cumple el contrato de editor enfocado.

Tres hitos de implementación revisables, **sin declarar acabado D al terminar el primero**: D1 identidad/CRUD/portabilidad/cliente documental; D2 host tres vistas + owned/world blocks + cinco adapters y preview/export; D3 compositor capítulo/book + lifecycle/Undo + native/UI/independent review. Antes de cada hito, root libera sus seams activos; no se desarrollan tres arquitecturas distintas.

Cierre funcional que permitiría el D completo: Q07 para add/remove/order/height persistidos; Q08 para los cinco editores citados; C05 para los bloques source/builtin declarados y probados; S03 para documentos/owned/world blocks con las tres vistas dentro del producto. S01 gana un host documental real proporcionado por el producto y herramientas que lo consumen, pero **no** un defineApp arbitrario/otro sistema de rutas publicable por terceros. Tampoco se generaliza a todos los motores sin adapter probado. S02 continúa parcial: prosa escalar CAS, sin CRDT/presencia. La página pública/exportada sigue siendo un preview readonly seguro, no un runtime genérico de herramientas source; ese límite debe constar en inventario aunque el editor normal soporte embeds interactivos.


## D1 ejecución autorizada (antes de código)

Root aprobó el plan y cedió D1. No comenzar D2/D3 antes de freeze y revisión D1. D1 incluye tipo documental local-tool con metadatos puros, CRUD/archivo/historia/era/cliente+acciones/MCP por ID real, lista/crear/abrir/renombrar en engine normal, Biblioteca/búsqueda/refs y portabilidad real. No embed/owned-block/dock ni Reader/export cambios en D1. Los seams de db/operations, zipBackup, worldMetadata, worldEras/portability y db/index siguen reservados a B/root; se publican tipos/validate/remap primero para que root pegue el wiring tras freeze de B. Estado legado y paquetes/versiones A/B/C no se migran. Fuente ejemplo opt-in documental mostrará varias instancias; pruebas exigirán mismo ID compartido y IDs diferentes aislados, Base/era, CAS/Undo/readonly/rollback, código ausente/clone/archive/history y bootstrap en dos órdenes.


### D1 CAS de documento y restauración (cierre antes de freeze)

El transporte real reprodujo `IDBTransaction finished` en el primer save heredado de era bajo la transacción SDK: readWorldDocument necesita crypto para el token Base y la continuación abre saveEraDocument anidado. Mantener todo el outer con waitFor dejó el segundo escritor encolado. D1 usa para su JSON-only una única transacción RW con el mismo WorldEraVariant existente (id/revision/history/hidden/archived/document) y announceEraChange sólo al completar el outer. No cambia el formato de overlays ni el middleware de historia. Las lecturas siguen sin R global.

SourceToolDocument añade `generation?: string` portable (UUID en nuevas instancias). Legacy de esta clase sin generation usa createdAt sólo como linaje inicial. El restore normal de Archive, History y restoreEraVersion para kind local-tool asigna generation nueva; no cambia IDs ni data. El remap puro clona generation por prefijo source-tool-generation y conserva revision0 del contrato de clonación. No hay epoch global/volátil.

Read del cliente devuelve `snapshot.document = {id,namespace,title,version,lineage}`. version es un token opaco pequeño de generation/revision/updatedAt + identidad/revision/estado del overlay (incluye variante archivada cuando vuelve a heredar). lineage contiene generation y la última revision archivada/oculta en history del overlay: cambios propios normales comparten linaje, pero resetEraDocument/hide/restoreEraVersion normales cambian el epoch, persistido en el historial existente. Crear la primera variante mantiene epoch0 y permite merge de cambios disjuntos.

Whole-state save de documentId requiere tercer argumento `expectedDocumentVersion` de read; namespace legacy conserva firma anterior. MCP wh_local_tool_save lo expone opcional en esquema pero requerido cuando hay documentId. Rename/archive requieren expectedRevision + expectedVersion. UI lee ambos del mismo documento; Reload saved title acepta explícitamente otra baseline. Acciones C validan id/lineage del baseline, comparan campos contra current y guardan con current.version; receipts incluyen lineage y son de un solo uso tras outercomplete. Reset/reinherit o restauración normal invalidan acciones/receipts de linaje viejo incluso cuando data/revision coinciden. Pruebas incluyen reload/new client, reset y restore normales, escritor paralelo y abort/retry.


### D1 evidencia y límites del hito

- PASS service `tests/local-tool-documents.browser.tsx / testSourceToolDocuments`: IDs pares/legacy, CAS exacto, disjuntos paralelos, Base/two eras, create0copias, era-only, reset/reinherit/restore normales, generación de History/Archive normales, rechazo de save borrado, abort RW/nested y eventos sólo tras outercomplete, query Blob con writer paralelo, pin incompatible por documento sólo de era/host ausente, búsqueda por palabra de prosa declarada y navegación document=ID.
- PASS native `tests/local-tool-documents.transport.cjs`: stdio→HTTP→executor→IPC→IndexedDB y host explícito en memoria ejecutan el mismo escenario de campo/map/list, conflictos, Undo/Redo/contexto/abort/retry/read-only. Además CRUD real y MCP normales wh_world_era_document_reinherit/restore y wh_document_history_restore invalidan tokens/acciones/recibos previos; create era-only no escribe Base.
- PASS UI `tests/local-tool-documents.ui.browser.tsx / testSourceToolDocumentsUi`: normal registry/PaneRouter, crear2/abrir/renombrar/archivar, flush de prosa pendiente, conflicto remoto conserva borrador y bloquea navegación, dos paneles Base/era, Biblioteca, CSS real1440/640. Capturas inspeccionadas: `work/local-sdk-D1/local-source-documents-{1440,640}.png`. El runner emitió avisos React act por finalizaciones livequery asíncronas; no errores funcionales ni CSS.
- PASS `tests/document-history.browser.ts / testDocumentHistory`: 16 tipos completos, CAS/Undo/rollback/assets/clone/JSON/ZIP/checkpoints; fixture de local-tool válido añadido. PASS `tests/history-import-order.browser.ts / testHistoryAdaptersFirst` y `testHistoryDatabaseFirst`: ambos boots reales con16tipos, metadata fuente/preimage y Blob dedup/rollback.
- Regresiones A/C headless y transporte real PASS; B selección/compatibilidad/clone/JSON/ZIP y SDK legado/UI PASS. Lint de áreas propias PASS. Typecheck renderer final PASS. B native/Vite real PASS en perfil aislado wh-release-native-VdG0iz.

D1 ofrece documento normal editable y metadata portable, no embed/fullscreen, bloques owned/world, compositor lateral ni export visual para fuentes. El tipo16 entra en world/read, archivo/historial/refs/búsqueda; el botón PNG no se ofrece para fuentes porque su adaptador de preview/export forma parte de D2. No se afirma cobertura16tipos PNG. El historial existente permite previsualizar data fuente como campos readonly aun con código ausente, y el MCP list/raw world read conserva los datos. S01/S03/C05/Q07/Q08 no se declaran cerrados por este hito. S02 continúa parcial sin CRDT/presencia.


Freeze D1: no continuar a D2/D3 hasta revisión de root. Se entrega proof SHA256 en tasks/evidence/local-sdk-D1-source-proof.json. Los paquetes Source A/B y capacidades C conservan sus pruebas previas; el proof D1 registra las dependencias añadidas (documentId, version/lineage y validación de pins documentales), sin reescribir los hashes históricos A/B/C. Ningún commit ni dato de usuario.


### D1 revisión independiente — dos correcciones acotadas

La revisión congelada `independent-D1.browser.tsx` reproduce dos defectos materiales: (1) useLiveQuery conserva el read de A al retarget a B, dejando Archive/Rename de A vivos mientras espera B; (2) el pin valida sólo listas efectivas y omite payloads ocultos/restaurables. Se conserva el oráculo y sus logs FAIL previos.

Corrección de ciclo UI: sesión de SourceToolWorkspace con key por projectId/eraId/namespace/documentId/releaseHash; al cambiar contexto se desmontan lecturas/acciones/component y comienza estado loading sin reutilizar el read anterior. Guardia de lifetime evita que un run que esperaba flush invoque una mutación o navegue después de desmontarse. No autosaves ni D2.

Corrección de pin: validar el candidato compilado contra metadata Base y todos los roots source-doc retenidos de worldEraVariants (actuales/hidden/archived/history), así como History/Archive normales de Base que pueden restaurarse. Consultas raw a stores relevantes dentro de la misma transacción de pin, sin hash ni resolver código desde middleware; namespaces ajenos siguen intactos. La transacción incluye sólo Project/variants/history/archives. Falla el pin si falta host documental o algún estado restaurable no cumple el candidato, sin cambiar ni borrar payloads. Criterio: ambos oráculos independientes sin findings, regresiones propias normal UI/servicio/native y B pin/portabilidad PASS; renovar proof D1 tras re-review.


Resultado de correcciones D1 (nuevo freeze): el oráculo independiente original se ejecutó intacto y devuelve findings:[] (SHA256 b45a3e3f687afeaeaa99d51a570e187762978352ae63dc1f1dc4238610fbe833). Se conservan `independent-D1-own-action.log` y el predecessor FAIL fuera del WT; resultado propio posterior en `work/local-sdk-D1-fixes/own-reproduction-after.log`. No se modifica el detector ni se interpreta exit0 solo como aprobación.

PASS extra: `testRetainedSourcePin` cubre cinco casos aislados (history-only de era, hidden, reinherited, BaseHistory, ArchiveOnly), rechazo con Project/variants exactos y candidato compatible aceptado; `testSourceDocumentLifetime` monta StrictMode y retarget durante flush pendiente, sin borrar/navegar desde el callback desmontado. Native stdio incluye ahora hide→pin incompatible rechazado→restore normal legible con fuente seleccionada intacta. UI nativa1440/640 completa repetida en StrictMode PASS; servicio propio4grupos y B pin/JSON/ZIP4grupos PASS; tsc renderer/lint leafs/diffcheck PASS. Las capturas finales se actualizan en el mismo directorio work/local-sdk-D1. Se congelan otra vez sólo estas correcciones, pendientes de repetición independiente A; D2 sigue sin empezar.


## D2 ejecución autorizada — después del SHIP independiente D1

Root autorizó D2, aún no D3. Se conserva el proof D1 como snapshot histórico revisado; las dependencias nuevas se registrarán en proof D2 propio. Genealogy/tree y World Graph siguen en manos de document_workflows_finish: sólo leer contratos hasta cesión explícita. ReaderSource/readerExport/worldWiki/captura de publicación quedan reservados a root.

Secuencia: (1) preview puro portable, host source por ID con context editor/embed/fullscreen y ejemplo real interactivo; (2) envelope source-owned/world, nodo/controles Tiptap, cliente sobre estado del átomo y escritor MCP owner explícito; (3) cuatro adapters enfocados CodexEntryForm/MapView/BoardCanvas/TimelineView, luego árbol cuando se libere; (4) UI/MCP por cada adapter, readonly/snapshot export con root, portabilidad y lifecycle antes de freeze D2. Se preservan nueve previews/model/media y el acceso modal anteriores.

Helpers de root: local/previewTypes.ts SemanticPreview y spec declarativo validado; local/documents/preview.ts sourceDocumentPreview(document,locale)/renderLocalToolPreview(preview), sin DB/registro/código compilado; local/blocks/types.ts validate/remap envelope y HTML conservando bytes fuera del átomo. Un spec de preview persistido describe campos/etiquetas seguros; documento antiguo sin spec usa campos JSON readonly completos. Bloque world conserva consulta declarativa world-kind/fields para preview efectivo sin fuente, no un cache de resultados. Nunca ejecutar código importado ni consultar DB viva cuando root proporciona snapshot.

Contexto de propietario: nuevo prop explícito en TiptapEditor con owner o resolver por posición y prepareExternal. Codex mantiene su guardia de borrador explícito; Writing/Book reutilizan flushSave. En Book el owner es la escritura de la sección que contiene el átomo (nearest chapter heading; first section firstChapter), no el id sintético del libro. Owned UI actualiza sólo node attrs por transacción Tiptap y el journal/escritor del contenedor guarda normalmente. Owned MCP prepara la sesión abierta, lee la última fila, aplica patch léxico del único átomo y persiste con CAS del dueño por APIs existentes. Rechazo conserva prosa local y ganador remoto. Un refresh externo actualiza sólo ese nodo sin disparar un segundo autosave ni setContent de toda la prosa. Undo/Redo native son recibos por scope/owner/block/after-version, one-use/outercommit; no snapshots en audit ni efectos arbitrarios.

Criterio D2: ejemplo documento dos instancias y tres vistas mismoID, owned roll-result sólo en card/chapter y world roster sin documento propio; cinco adapters editan su documento real (no engine-list/modal como sustituto), conflictos/borradores/cierre y foco/selección protegidos; native tools normales y pruebas readonly/rollback/late callbacks; preview fiel con fuente ausente y snapshot congelado sin DB live; PNG16 sólo cuando adapter real esté cableado/probado. No compositor de D3, CRDT/presencia ni afirmación de host genérico completo.

### D2 shared writer continuity correction (reproduction before patch)

`testLocalToolBlocks` records a real failure on the first inherited Codex variant: Base insert/apply/Undo/Redo finish; Era apply raises TransactionInactiveError at readWorldDocument/hash/saveCodexDraft/saveEraDocument. Wrapping the entire writer in waitFor deadlocks against the existing nested hash waitFor, so that wrapper was removed. Root authorizes the narrow normal seam: Dexie continuations after hashes and explicit transaction tables, retaining expected-version comparison, history, deduplicated assets, revision, checkpoints, postcommit notifications and rollback. No second overlay or middleware changes. Success requires owned Base/era and abort reproduction, all16 document kinds/history/assets/checkpoints, D1 and normal native transport.


### D2 focused-editor concurrency closure (approved before patch)

The original native race (`work/local-sdk-D2/pre-cas-race.log`) demonstrates Map pending label overwritten after a normal MCP edit. The focused adapter uses the established `mergeLocalToolActions` field/key/stable-ID merger rather than a second merge algorithm. MapPin and TimelineEvent carry optional baseline callbacks; forms compare normalized editable values with their form-open baseline. Vector selection/drawing captures the feature-array baseline before the gesture; a lightweight optional baseline travels in the existing vector draft journal and is stripped from saved content. Named layer rename/deletion capture before the edit/confirmation. Effective reference targets are revalidated in the same commit. Base uses the relevant row tables; named-era updates preserve the normal aggregate expectedVersion/history/assets writer. Nested abort leaves rows/variants and notifications untouched. Rejected pin drags retain position in the same local journal. Background upload/add/delete and existing standalone interactions retain their domain operations; no blanket new CAS guarantee is asserted for every map interaction.

Native UI race checks explicitly verify that input reached the draft and await the actual committed winner or visible conflict, rather than assuming a fixed150ms delay. One earlier concurrent run's input/commit timing failures were preserved and followed by isolated repeats; no product guarantee was changed to hide a failure.


### D2 freeze — prueba propia y límites

Producto congelado para revisión de root; no D3. No commits ni datos reales. El proof D2 registra fuentes/fixtures y dependencias normales sin reescribir los proofs históricos A/B/C/D1.

PASS con `electron scripts/run-codex-properties-ui.cjs <file> <export>`:

| Fixture / export | Resultado |
|---|---|
| local-tool-blocks.browser.ts / testLocalToolBlocks |3: CAS owner/outside bytes, Undo one-use, Base/era y nested abort, remap puro |
| local-tool-host.ui.browser.tsx / testLocalToolHostUi |3: documento editor/embed/fullscreen, peers, readonly; owned UI/Undo/draft deletion guard; CSS1440/640 |
| local-tool-focused.ui.browser.tsx / testFocusedDocumentEditors |10: cinco editores enfocados reales × Base/era; guardar/cerrar; CSS1440/640 |
| local-tool-focused-conflicts.browser.tsx / testFocusedEditorConflicts |8: marker/event Base/era, overlap conservado y disjoint combinado tras MCP normal |
| local-tool-focused-vectors.browser.tsx / testFocusedVectorConflicts |8: figura/capa Base/era, baseline previa, campo/ID disjoint, overlap y borrador intactos, adiciones remotas preservadas |
| focused-writes.browser.ts / testFocusedWrites |2: marker/event/vector/layers nested rollback y eventos postcommit; referencias efectivas validadas dentro del commit |
| local-tool-book.browser.tsx / testSourceBlocksBook |2: capítulo real correcto, bytes del otro intactos; MCP actualiza átomo sin perder DOM/selección ni autosave extra |
| local-tool-block-lifetime.browser.tsx / testSourceBlockLifetime |2: callback tardío tras retarget rechaza; readonly desmonta componente y conserva preview |
| local-tool-blocks.portability.browser.ts / testSourceBlockPortability |2: JSON/ZIP/full/clone Base, era, history y Board.richContent; datos opacos exactos; preflight rechaza antes de reemplazar |
| local-tool-blocks-retained.browser.ts / testRetainedSourceBlockPin |1: pin candidato valida átomos actuales/Base history/own hidden y rechaza sin mutar |
| world-eras.browser.tsx / testWorldEras |7: scope, first variant, parallel drafts, history/recovery, normal clone/ZIP/native dispatch |
| world-eras-adapters.browser.tsx / testWorldEraAdapters |6: metadatos/mapas/timeline/board, bytes Blob/CAS/assets y ZIP |
| document-history.browser.ts / testDocumentHistory |4:16kinds/restore/Undo/rollback/dedup/checkpoints/portabilidad |
| local-tool-documents.browser.tsx / testSourceToolDocuments |4:D1 CAS/lineage/reset/restore/parallel/rollback/query/búsqueda |
| local-tool-documents.ui.browser.tsx / testSourceToolDocumentsUi |4:StrictMode normal UI, dos documentos/drafts/conflictos/título/Archive/Base-era/Library1440/640 |
| local-tool-sdk.browser.tsx / testLocalToolSdk |6:SDK legado/JSON/CAS/registry/UI/portabilidad |
| local-tool-releases.browser.tsx / testLocalToolReleases |4:pin exacto/tombstone/ABA/JSON/full/ZIP/clone |
| local-tool-codec.browser.tsx / testLocalToolCodecPortability |2:refs declaradas y datos opacos Base/era/clone/JSON/full/ZIP |
| history-import-order.browser.ts / testHistoryAdaptersFirst + testHistoryDatabaseFirst |2:boot real ambos órdenes,16kinds/Blob/rollback |

PASS transporte real `electron tests/local-tool-blocks.transport.cjs`:4 combinaciones Codex/Writing × Base/era por stdio→HTTP→executor→IPC→IndexedDB; CAS, audit pequeño→/api/undo, one-use, scope incorrecto, edición posterior, operation abort y Undo abort/retry, readonly. PASS `electron tests/local-tool-documents.transport.cjs`:D1 normalCRUD/pin oculto/restauración/lineage/one-use y mismo escenario host explícito/native.

Renderer `tsc -p tsconfig.app.json --noEmit` y lint de SDK/editor/adapter/writer propios PASS. Los runners UI emiten avisos React act por finalización de livequeries; las repeticiones aisladas esperan el commit real y pasan. No se interpreta una captura vieja o un exit0 de otra prueba como evidencia de un editor.

Capturas finales inspeccionadas/copiadas en `work/local-sdk-D2/local-source-host-D2-{1440,640}.png` y `focused-{codex,maps,board,timeline,relation-tree}-{1440,640}.png`. Árbol usa el control normal Fit view tras resize, conservando su lógica/CSS revisadas. Fuente muestra bloque owned, world y referencia interactiva; no overflow horizontal. Las capturas son datos sintéticos aislados. Root verificó por separado consumidores Reader/wiki/snapshot y32PNG de16kinds Base/era; esta prueba propia no sustituye su revisión.

Alcance cerrado de D2: host por ID/era, tres vistas declaradas, source-owned/world en prosa normal, cinco adapters enfocadas, guards/pending/owner CAS, readonly faltando módulo, portabilidad y export helpers. Persistir orden/altura de varios bloques laterales es D3 aún pendiente; S02 CRDT/presencia continúa parcial. No compatibilidad binaria/API con VVD ni cierre global del host documental.


### D2 independent correction — emitted document-client lifetime

Independent review FIX report/provenance and both original oracles remain frozen. The diagnostic SHA e170c852f31494c1a3940aab098f0f880f0d0d898f2ea6644fd9a6adf34d9dc0 reproduced three fresh documents changing round1→99 after readonly, retarget and unmount; own pre-fix log is work/local-sdk-D2-fixes/independent-before.log. Root authorizes a narrow host/client correction, not D3.

Cause: a previously emitted createLocalToolClient retained the original readOnly=false option after its host was replaced or removed. The host will create an irrevocable per-layout-setup client lease (including StrictMode setup/cleanup); cleanup revokes only that emitted client. A pure optional isCurrent callback in client options checks that lease before mutation and at document/state transaction completion. A revocation during awaited work aborts that RW and leaves receipts unconsumed/unpublished. Non-host MCP/headless clients have no lease and retain existing behavior. No middleware, permissions layer, CRDT or alternate state writer.

Success: unchanged independent diagnostic refuses all3 callbacks with all3 source documents and current retarget document unchanged; own tests add readonly false→true, retarget A/B IDs, true unmount/remount under StrictMode, retained old client vs new live client, and revocation before transaction completion with rollback/receipt retry semantics. Repeat normal source document UI/native, owned lifetime, Book and5focused adapters. Record a new correction proof/addendum without changing the reviewed pre-fix proof or reports.


D2-1 corrección congelada: ver tasks/local-sdk-D2-lifetime-correction.md y proof nuevo separado. Ambos oráculos independientes originales PASS; own lease3, normal UI4/sourcehost3/focused10/Book2, native documental4/owned4, SDK/regresiones y tsc/lint PASS. El proof D2 original permanece intacto como baseline revisado/FIX. D3 no empieza hasta re-review de root.
