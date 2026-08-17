# Auditoría de los 20 motores (worldgen excluido) — 2026-08-16

Barrido nuevo, hecho porque la lista de pendientes que arrastrábamos de julio y
agosto ya no era de fiar. Cinco auditores en paralelo sobre los 20 motores y
`_shared`, leyendo los ficheros enteros. **Todo lo que sigue está verificado
leyendo el código**; los tres hallazgos graves de más consecuencia y el recuento
de `searchEntities` los he vuelto a comprobar yo a mano después.

Nada de esto está arreglado todavía. Nada está commiteado.

---

## 1 · Lo que la lista vieja decía y YA NO ES VERDAD

Se borra. Esto es lo que hacía que la lista despistara.

| Pendiente que arrastrábamos | Realidad medida |
| --- | --- |
| «seeds: falta el selector de `linkedWritingId`» | **HECHO.** `SeedsEngine.tsx:496-499` tiene su `LinkSelect`, igual que los de beat y escena. |
| «`StoryboardPanel.linkedSceneId` sin UI» | **HECHO** y documentado en el propio código. |
| «`TimelineEvent.linkedEntryId` sin UI» | **HECHO**, con selector de Codex en `SwimLaneView`. |
| «`Biography.subjectId` sin UI» | **HECHO**, se escribe desde `BiographyView`. |
| «outline `deleteBeat` deja huérfanos» | **HECHO**: reparenta a los descendientes (`operations.ts:44-56`). |
| «cascadas de timeline/storyboard/seeds incompletas» | **HECHAS**, las tres dentro de transacciones Dexie. |
| «`confirm()`/`alert()` nativos por ahí» | **CERO** en los 20 motores. |
| «File System Access API en las descargas» | **CERO**. Todo es blob + `<a download>` o el diálogo de Electron. |
| «`key={index}` en listas reordenables» | **CERO** en listas con estado. |
| «condiciones de carrera en las cargas» | **CUBIERTAS** por el token de secuencia de `makeEntityHook`. |

## 2 · Lo que la lista decía y SIGUE SIENDO VERDAD

- `ArcBeat.linkedBeatId` / `linkedSceneId`: declarados, **sin UI** (ver §3.4).
- Importar Fountain/FDX: **no existe**, sólo exportación (`buildFountain`).
- Ciclado de tipo de bloque con **Tab**: **no existe**; la única Tab del motor
  acepta una sugerencia del autocompletado.
- `BEAT_SHEET_TEMPLATES` y `ARC_TEMPLATES` en inglés duro (ver §3.5).
- `biography` y `character-arc` siguen sin registrar `AnchorAdapter`: no admiten
  notas al margen ni aparecen en el selector de referencias.

---

## 3 · GRAVE

### 3.1 Borrar un personaje del Codex no limpia nada — y la función que lo haría es código muerto
`db\operations.ts:162` define `deleteCodexEntry`, que implementa la política
correcta: borra sus `relationships`, desvincula `characterArcs` y `dialogBlocks`,
limpia `mapPins.linkedEntryId` e `inspirationImages.linkedEntryIds`.
**No la llama nadie.** Verificado: su única aparición en todo `src\` es su propia
declaración. `codex\hooks.ts:13` usa `codexEntryOps.delete`, el borrado plano.

Qué ve el usuario: crea «Alicia ↔ Bob: amigos», borra a Bob del Codex. En la
vista **Lista** de Relaciones sigue apareciendo «Alicia ↔ Bob: amigos», editable,
como si Bob existiera; en la vista **Matriz** ha desaparecido. Dos vistas del
mismo motor contándole cosas distintas. Y el id fantasma de Bob se queda en los
pines del mapa y en las imágenes etiquetadas, y viaja en cada copia de seguridad.

**Arreglo:** cablear `deleteCodexEntry` en `codex\hooks.ts`.

### 3.2 El asa de arrastre de los beats del esquema no hace nada
`BeatList.tsx:88` pinta un `GripVertical` en cada fila. `reorderBeats` existe
(`operations.ts:77`) y está cableado como `reorderFn` en `hooks.ts:17`. Pero
**cero** `draggable`, `onDragStart`, `onDrop` o `dnd-kit` en toda la carpeta, y
`OutlineEngine.tsx` ni siquiera extrae `reorder` del hook. Tampoco hay botones
de subir/bajar ni campo de orden en el editor.

Qué ve el usuario: ve el asa, arrastra un capítulo para ponerlo antes que otro, y
no pasa nada. La única forma de reordenar es borrar y recrear los beats de en
medio — perdiendo sus enlaces a escena y a manuscrito.

### 3.3 El editor de diálogo dual escribe en la base de datos en cada tecla
`DualDialogGroup.tsx:81-82` liga el `<textarea>` directo a
`value={block.content}` con un `onChange` que dispara `editBlock` + `refresh()`.
El bloque de diálogo normal usa `useDebouncedField`, que se creó exactamente para
esto — el diálogo dual se quedó fuera de aquella migración.

Qué ve el usuario: empareja a dos personajes con el botón «||», escribe rápido, y
un `refresh()` que resuelve a mitad de palabra reescribe el campo con lo que
todavía había en la base de datos: el cursor salta al final y se pierden letras.

### 3.4 Tres enlaces cruzados que nadie puede rellenar, y dos contadores que por eso mienten
- **`ArcBeat.linkedBeatId` / `linkedSceneId`** (`character-arc\types.ts:77,79`):
  sin UI. Pero `services\projectIntelligence.ts:344` los LEE para calcular
  `arcBeatCount` por beat del esquema — **siempre vale cero**, y no hay forma de
  que valga otra cosa.
- **`DialogBlock.characterId` / `SceneCast.characterId`**: nunca se escriben; el
  reparto se guarda como texto libre. `projectIntelligence.ts:350-357` los lee
  para «personajes sin usar» y «hablantes sin mapear», así que el Cockpit dice
  siempre que **todos** los personajes están sin usar, por muy bien escrito que
  esté el guion. Y en el Codex, la «telaraña de personajes» filtra `sceneCasts`
  por `characterId`: nunca muestra ni una aparición en escena.
- **`Payoff.linkedBeatId` / `linkedSceneId` / `linkedWritingId`**: la semilla sí
  tiene sus tres selectores; el pago no tiene ninguno.

### 3.5 Las plantillas narrativas siembran texto en inglés como datos reales del usuario
- `outline\types.ts:72` — 4 plantillas (Save the Cat!, Tres actos, Viaje del
  héroe, Cinco actos) con **90 cadenas** en inglés duro: 4×2 de metadatos y 41
  beats × (título + descripción). Se COPIAN al `OutlineBeat` al crearlo, así que
  quedan en inglés para siempre aunque luego se traduzca la interfaz.
  `TemplateSelector.tsx` ni siquiera importa `useTranslation`: sus 6 textos
  propios también están en inglés.
- `character-arc\types.ts:115` — 5 plantillas con nombre, descripción, 5 prompts
  y hasta 10 beats cada una, igual. La plantilla «Positive Change Arc» viene
  preseleccionada, así que basta con darle a confirmar para acabar con beats
  titulados «The Ghost» en un proyecto en español.

En el mismo fichero, `BEAT_STATUS_CONFIG` y `ARC_STAGE_CONFIG` sí usan
`labelKey`. El patrón correcto está a diez líneas.

### 3.6 Borrar un evento de la línea temporal no pregunta nada
Los tres sitios que borran un `TimelineEvent` (`SwimLaneView.tsx:916` y `:1024`,
`TimelineView.tsx:263`) llaman a `onDeleteEvent(id)` a pelo. El borrado arrastra
en cascada todas las conexiones del evento y no hay deshacer.

En la vista de carriles, al seleccionar un evento salen tres botones circulares
de 12px de radio con **6px de separación real**: Editar / Conectar / Eliminar.
Un clic desviado hacia la derecha borra el evento y sus conexiones sin una sola
pregunta. Existe ya `countConnectionsForEvent` (`operations.ts:82`), escrita
justo para avisar de cuántas se perderían — **no la llama nadie**.

Es la misma clase de borrado sin red que costó datos en el timeline en mayo; la
lección se aplicó a «borrar la línea temporal entera» y no al evento suelto.

### 3.7 La grabación del teleprompter no se para al desmontar
`TeleprompterExportModal.tsx` no importa `useEffect` y no tiene limpieza: el
`AbortController` sólo se aborta desde el botón «Cancelar». `recordTeleprompter`
en sí es correcta — el fallo está en quien la orquesta.

Qué ve el usuario: empieza a grabar, navega fuera del proyecto. React desmonta el
modal, la grabación sigue viva e invisible, y al terminar llama a
`saveTeleprompterMp4`, que abre un **diálogo nativo de guardado de Electron**
encima de lo que el usuario esté haciendo, en otro proyecto.

---

## 4 · MEDIO

### 4.1 Once motores de dieciocho escanean todos los proyectos en cada tecla
Comprobado a mano, `findstr` sobre los 18 `index.ts`:

- **Acotan bien** (`(query, projectId?)` + `.where('projectId')`): board, codex,
  diary, gallery, maps, notes, timeline. **7.**
- **No acotan** (`(query: string)` a secas, escaneo completo de la tabla):
  biography, character-arc, dialog-scene, outline, relationships, scrapper,
  seeds, storyboard, video-planner, writing-stats, writings. **11.**

El registro filtra por proyecto DESPUÉS, así que no hay fuga de datos entre
proyectos: lo que hay es que cada tecla del buscador global deserializa todas las
biografías con foto, todos los snapshots con miniatura y el HTML de todos los
manuscritos **de todos los proyectos que hayas creado nunca**. El buscador se
vuelve más lento con el histórico total, no con el proyecto abierto.

Es un arreglo de una línea por motor y el contrato ya está documentado en
`entityResolverRegistry.ts`.

### 4.2 Borrar una escena no desvincula los beats del esquema
`dialog-scene\operations.ts:19-25`: `deleteScene` cascadea `dialogBlocks` y
`sceneCasts`, pero deja `outlineBeats.linkedSceneId` apuntando a una escena que ya
no existe — y el propio fichero consulta esa relación en `getLinkedBeats` unas
líneas más abajo. `projectIntelligence.ts:360` cuenta ese beat como enlazado, así
que el medidor «beats del esquema conectados» del Cockpit **sólo puede subir**.

### 4.3 Borrar una capa o una vista del tablero no pregunta ni se puede deshacer
`SidePanels.tsx:79` y `:178`: los únicos botones destructivos del motor sin
`ConfirmDialog`, en una fila de cuatro iconos de 12px. Además `useBoardLayers` /
`useBoardViews` escriben directo, fuera del sistema de comandos con deshacer, así
que Ctrl+Z tampoco lo recupera.

### 4.4 Arrastrar un pin del mapa mientras lo editas borra lo que llevabas escrito
`MapView.tsx:202`: el `pointerdown` llama a `selectPin` incondicionalmente —
también sobre el pin ya seleccionado— y `selectPin` resetea el borrador con lo
último guardado. Escribes una descripción larga, la arrastras para recolocarla
antes de guardar, y el texto desaparece sin aviso.

### 4.5 El formulario de propiedad del inspector del tablero no se limpia al cambiar de nodo
`BoardCanvas.tsx:1308` monta `<NodeInspector node={selectedNode}>` **sin `key`**.
Empiezas a escribir una propiedad para «Sospechoso A», pinchas en «Sospechoso B»
para comparar, y al darle a «+» la propiedad se añade a B.

### 4.6 Cinco sitios más con texto sin traducir que sí tiene clave
Todos ellos con la clave ya existente y usada correctamente en otro fichero del
mismo motor: `FactCard.tsx:133-136` («📸 Snapshot» / «🔗 Link» / «✏️ Manual» /
«🎤 Interview»), `AnnotationsEngine.tsx:119,127` («orphaned», «open»),
`BoardNodeView.tsx:330` (pinta el id crudo del rol, «character», donde el
inspector pinta «Personaje»), `SessionCard.tsx:16-21,28` («Sprint», «Today») y
`AiToolbar.tsx` (6 cadenas en español fijo, que un usuario en inglés ve saltar a
español al aceptar un resumen).

---

## 5 · LEVE

- `writing-stats`: `WritingSession.notes` se pinta y se busca, pero no hay ningún
  formulario que lo escriba.
- `video-planner`: `VideoSegment.speakerId` declarado, muerto del todo.
- `outline`: `wordTarget` se puede escribir y no se lee en ningún sitio; `tags`
  se crea a `[]` y nadie lo escribe ni lo lee.
- `relationships`: `color` documentado, sin selector (sin síntoma: cae al color
  del tipo).
- `character-arc`: `ArcBeat.status` se fija a `planning` al crear y no hay control
  para cambiarlo.
- `biography`: `FactSource.entityId` declarado y nunca rellenado — la fuente de
  tipo «Captura» no puede enlazarse a una captura real; y un blob sin revocar en
  cada exportación de la vista narrativa.
- `gallery`: `notes` se crea a `''` fijo, se busca y se muestra como subtítulo,
  pero no hay dónde escribirlo.
- `timeline`: las conexiones se crean con etiqueta vacía y estilo fijo, y sólo se
  pueden borrar — aunque el dibujante ya sabe pintar etiqueta y trazo discontinuo.
  Y `onEditTimeline` llega a `SwimLaneView` y no se desestructura: no hay forma de
  renombrar una línea temporal ya creada.
- `writings`: `GoogleDocsPicker` no se desmonta al cerrarse; conserva la búsqueda
  y la selección de la vez anterior.
- `_shared`: `assertBackupCoverage` sólo mira las tablas declaradas por un motor,
  así que las cuatro de `project-tools` (`entityLinks`, `citations`,
  `publishingProfiles`, `conversionReceipts`) le son invisibles. Hoy están bien
  respaldadas; el aviso que existe para cazar «tabla nueva sin respaldo» está
  ciego para cualquier tabla que no cuelgue de un motor.
- Traducciones sueltas: `MapsEngine.tsx:85,92`, `ChronometryBadge.tsx:69,127`,
  `EntryCard.tsx` y `QuickEntry.tsx` (diary), `PanelEditor.tsx:119`,
  `StoryboardPanel.tsx:90`, `SegmentEditor.tsx:215`, `CompileModal.tsx:218,226`,
  `VideoPlanView.tsx:66`, `MediaGallery.tsx:49,57`, los placeholders del
  inspector del tablero y los errores de su barra de consulta.

---

## 6 · Verificado y CORRECTO (no volver a auditarlo)

- **El patrón raíz de agosto —el modal que nunca se desmonta— está cerrado.**
  Comprobados uno a uno: `FactEditor`, `PanelEditor`, `ConnectorEditor`,
  `CompileModal`, `SegmentEditor`, `GoalSetter`, `HistoryModal`, `BeatEditor`,
  `RelationshipEditor`, `CodexEntryForm`, `EntryEditor`. Todos remontan por
  `key` o resincronizan con ajuste en render. La única excepción es
  `GoogleDocsPicker` (§5).
- Cero `confirm()` / `alert()` / `prompt()` nativos en los 20 motores.
- Cero `showSaveFilePicker`.
- Cero `key={index}` en listas con estado propio.
- Los `addEventListener` tienen su retirada; los `setTimeout`/`setInterval` se
  limpian. Único `createObjectURL` sin revocar: el de biografía (§5).
- `teleprompterRecorder.ts` para sus pistas por las cuatro salidas posibles.
- El autoguardado de `writings` hace `flush` al desmontar, con Ctrl+S y en
  `beforeunload`, y reintenta si llegan teclas mientras guardaba: no pierde la
  última.
- Las cascadas internas de cada motor están completas (seeds, storyboard,
  timeline, outline, writings→snapshots, maps→pines). Lo que falla son las
  cascadas **entre** motores (§3.1, §4.2).
- `makeEntityHook` / `makeGraphHook` / `makeReadOnlyHook` protegen contra
  respuestas asíncronas viejas con token de secuencia + `mountedRef`.
- `pov-audit` está limpio de arriba abajo.

---

## 7 · Orden de arreglo que propongo

1. **§3.1** cablear `deleteCodexEntry` — una línea, y es corrupción de datos.
2. **§3.6** confirmación al borrar un evento de la línea temporal, con el recuento
   de conexiones que ya está escrito.
3. **§3.3** `useDebouncedField` en el diálogo dual — pérdida de texto.
4. **§3.7** abortar la grabación al desmontar.
5. **§4.2** desvincular los beats al borrar una escena.
6. **§3.4** los cinco enlaces cruzados sin UI, que además arreglan tres
   contadores del Cockpit.
7. **§4.1** las once `searchEntities` — una línea cada una, todas iguales.
8. **§3.5** las plantillas a claves i18n (~110 cadenas, es el trabajo largo).
9. **§3.2** reordenar beats de verdad.
10. El resto de MEDIO y la cosecha de LEVE.
