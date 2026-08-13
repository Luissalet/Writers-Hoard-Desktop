# Auditoría de motores — Writers Hoard desktop

**Fecha:** 2026-08-12 · **Ámbito:** los 21 motores no-worldgen + la capa `_shared` (~32.000 líneas).
**Worldgen queda fuera por petición explícita.**

**Estado de verificación:** `tsc -b --noEmit` ✅ · `tsc -p electron/tsconfig.json` ✅ · `eslint .` **0 errores / 0 avisos** ✅ · paridad de locales **1841/1841**, sin duplicados ✅
**Sin commits** — todo queda en el árbol de trabajo para que lo revises.

---

## 1 · Resumen ejecutivo

La arquitectura está sana: motores autorregistrados, factorías CRUD compartidas, backup modular
(sólo `pov-audit` no registra estrategia, y es correcto porque no tiene tablas), y **paridad i18n
perfecta en el catálogo**. El bloque legacy de `zipBackup.ts` que la memoria daba como pendiente
**ya está migrado**.

Lo que sí apareció, y en cantidad, son **defectos de estado de React** y **cascadas de borrado
incompletas**. Tres motores tenían funciones enteras inalcanzables desde la UI. El patrón que más se
repite —y el más caro— es **el modal que nunca se desmonta**: un componente que siembra su estado con
`useState(prop?.…)` pero se oculta con `if (!isOpen) return null` en vez de desmontarse. Los
inicializadores sólo corren una vez, así que el formulario recuerda el registro anterior. En
biography eso rompía el motor entero; en storyboard **sobrescribía un panel con el contenido de otro**.

## 2 · Lo que he arreglado (23 correcciones)

### Pérdida de datos

| # | Motor | Defecto | Arreglo |
|---|-------|---------|---------|
| 1 | **biography** | `FactEditor` no se remontaba: editar cualquier hecho abría el formulario **en blanco** y no dejaba guardar (`toast.error`). El motor era inusable. | Montaje condicional + `key` por hecho. |
| 2 | **storyboard** | `PanelEditor`, mismo patrón: editabas el panel 2 y el modal mostraba los datos del 1; al guardar, **`{...panel2, ...formData1}` machacaba el panel 2**. | Montaje condicional + `key={panel.id}`. |
| 3 | **outline** | Borrar un beat dejaba a sus hijos con un `parentId` inexistente: `BeatList` sólo pinta desde la raíz, así que **una rama entera desaparecía para siempre**. | `deleteBeat` reparenta los hijos al abuelo, en transacción. Y ahora confirma. |
| 4 | **outline** | «Add Beat» en un esquema vacío creaba la fila con `outlineId: ''` — invisible para siempre y fuera del alcance de `deleteProject`. | `outlineId`/`projectId` pasan por props. |
| 5 | **gallery** | `ImagePreviewCrop` no reseteaba `completedCrop`/`zoom`/`rotation` entre ficheros: soltabas 3 fotos y la 2ª y 3ª se recortaban con el rectángulo de la 1ª. | `key={pendingFiles[0]}`. |
| 6 | **gallery** | Borrar una imagen era un clic sin confirmar sobre la miniatura (borrar un *álbum* sí confirmaba). | `ConfirmDialog`. |
| 7 | **notes** | Ctrl+Shift+N con el compositor ya abierto hacía *toggle*; `Modal` desmonta a sus hijos → **texto perdido sin aviso**. | El atajo sólo abre, nunca cierra. |
| 8 | **writings** | `CompileModal` cacheaba con `${título}:${writings.length}`: borrabas un capítulo y escribías otro → misma clave, no reinicializa, y **el capítulo nuevo quedaba fuera del manuscrito compilado**. | La clave usa el conjunto real de ids. |

### Huérfanos y cascadas

| # | Motor | Defecto | Arreglo |
|---|-------|---------|---------|
| 9 | **codex** (raíz de 3 hallazgos) | `deleteCodexEntry` era un `delete` pelado. Borrabas un personaje y sobrevivían: relaciones y arcos con **nombre fantasma**, `sceneCasts`, `dialogBlocks`, pines de mapa e imágenes enlazadas. Todo eso seguía indexado en la búsqueda y viajaba en cada ZIP. | Cascada con política por tabla: se **borran** relaciones y `sceneCasts` (sin sentido sin su extremo); se **desvincula** en arcos, diálogos, pines e imágenes (eso es escritura tuya). |
| 10 | **maps** | Único motor con hijos sin cascada: borrar un mapa **dejaba vivos sus pines**, que seguían apareciendo en la búsqueda y no navegaban a ninguna parte. | `makeCascadeDeleteOp` a `mapPins`. |
| 11 | **timeline** | Las conexiones cruzan líneas y se guardan con el `timelineId` del **destino**: borrar la línea origen dejaba conexiones apuntando a eventos inexistentes, ocultas en pantalla pero vivas en Dexie y en el backup. | Cascada también por `sourceEventId`/`targetEventId`. |
| 12 | **timeline** | `deleteTimelineEvent` escaneaba la tabla entera de **todos los proyectos** y borraba en paralelo fuera de transacción, existiendo índices. | Dos búsquedas por índice dentro de una transacción. |
| 13 | **_shared** | `useAutoSelect` no se recuperaba de una selección colgante: borrabas el elemento activo y el motor se quedaba mirando un id inexistente, con el panel vacío. | Reselecciona — con un `ref` que evita pisar una selección optimista recién creada. |

### Funcionalidad rota o inalcanzable

| # | Motor | Defecto | Arreglo |
|---|-------|---------|---------|
| 14 | **outline** | `handleDeleteOutline` estaba neutralizado con `void handleDeleteOutline`: **no había forma de borrar un esquema**. | Botón de borrado en las tarjetas + `ConfirmDialog`. |
| 15 | **outline** | Todas las tarjetas menos la activa mostraban «0 beats» (contaban sobre los beats del esquema activo). | Conteo real por esquema. |
| 16 | **outline** | El botón «editar» renderizaba `<div className="w-4 h-4" />`: un botón **invisible**. | `<Pencil size={14} />`. |
| 17 | **board** | `onRenameBoard` se declaraba, se pasaba… y nunca se desestructuraba. **Un board no se podía renombrar jamás.** | Doble clic sobre el chip → edición en línea. |
| 18 | **board** | Al copiar y pegar, `remap()` descartaba `side`: los hilos pegados se re-enrutaban centro-a-centro. Y las meta-aristas se validaban contra la lista de entrada, no contra las supervivientes → **el board pegado quedaba enlazado al original**. | `side` preservado; `kept` calculado como punto fijo. |
| 19 | **video-planner** | El drag **intercambiaba** dos segmentos en vez de moverlos: arrastrar el 1 sobre el 5 daba `5,2,3,4,1`. | Move real (splice). |
| 20 | **scrapper** | `url.includes('x.com')` casa con **netflix.com, linux.com, phoenix.com**… Esas páginas se clasificaban como tweet, entraban por el descargador de medios en vez del archivador, y morían en `downloadState: 'error'` sin capturar nada. | Comparación por hostname parseado (exacto o subdominio), compartida con `legacyLinks`. |
| 21 | **relationships** | El `ConfirmDialog` vivía dentro del backdrop del editor: pulsar **«Cancelar» cerraba también el editor**. | Envoltorio con `stopPropagation`. |
| 22 | **writing-stats** | El sprint contaba con `setInterval`; Chromium estrangula los timers en ventanas ocultas a ~1 tick/minuto → **un sprint de 25 min en otra ventana se registraba como ~2**. | El tiempo se deriva del reloj real (`deadline` absoluto). |
| 23 | **diary** | `sortFn` ignoraba `pinned` pese a que el tipo lo promete y el botón existe: **fijar una entrada no hacía nada visible**. Y la búsqueda sólo miraba `entryDate`, nunca el título ni el cuerpo. | Orden con `pinned` primero; búsqueda sobre fecha + título + contenido. |

### De propina

- **seeds**: `orphanCount` y `computeSeedStatus` usaban definiciones distintas de «huérfana» — el panel decía «Orphans: 3» mientras todas las tarjetas ponían «Planted» y el filtro no devolvía nada. Ahora comparten una sola definición.
  **⚠️ Decisión de criterio:** he tomado *huérfana = sin pago y no cortada*, que es lo que ya contaba el panel. Efecto: una semilla recién plantada aparece como «huérfana» en vez de «plantada». Es lo coherente para una herramienta de foreshadowing (una semilla sin pago **es** un cabo suelto), pero si prefieres lo contrario se invierte en una línea en `seeds/types.ts:80`.
- **writing-stats**: `{dailyGoal && …}` con un número → React pintaba un **`0` suelto** dos veces en la tarjeta del gráfico. Arreglado, y de paso `ProgressChart` pasa entero por `t()` (días de la semana incluidos).
- **notes**: `useNotes` no escuchaba `wh:notes-changed`, así que capturar con Ctrl+Shift+N subía el contador del sidebar **pero la nota no aparecía en el tablero** hasta remontar.
- **20 claves i18n nuevas** en ambos locales.

---

## 3 · Lo que queda (hoja de ruta priorizada)

Todo verificado leyendo el código, con ruta y línea. No lo he tocado por tiempo, no por dudas.

### 3.1 · Alto impacto

- **Los enlaces profundos no los lee nadie.** `codex/index.ts:83` (`?entry=`), `writings/index.ts:80` (`?writing=`), `maps/index.ts:88` (`?pin=`), `seeds/index.ts:93` (`?seed=`) generan URLs que **ningún componente consume** — sólo `board/BoardCanvas.tsx:836` implementa el patrón. Buscar «Draven» y pulsar el resultado abre la pestaña pero **no la ficha**; los backlinks de anotaciones aterrizan igual de ciegos. ~5 líneas por motor.
- **Toda la cascada de reanclaje de anotaciones es código muerto.** `resolveTextRangeAnchor` (`_shared/anchoring/anchorResolver.ts:43`), `markOrphaned` y `updateAnchor` no los llama nadie, y los tres `getEntityText` implementados (writings, codex, seeds) nunca se consumen. Consecuencia: editas un capítulo, los offsets quedan obsoletos, `isOrphaned` nunca pasa a `true` y el badge de huérfanas es permanentemente 0. **El código ya está escrito entero** — falta cablearlo.
- **`NoteCreator.tsx:252`** llama a `searchEntities` **sin `projectId`** teniéndolo a mano: el buscador de referencias lista entidades de otros proyectos y crea referencias cruzadas que luego navegan a un enlace muerto.
- **`SceneEditor.tsx:419`** (dialog-scene) escribe en Dexie **en cada pulsación** con el `<textarea>` controlado desde el DB: se pierden caracteres y el cursor salta al final al teclear rápido. Mismo patrón en `outline:118`, `seeds:386/446/566`, `character-arc:340/477/518`, `relationships:517/527`. Un `useDebouncedField` en `_shared` los resuelve los cinco.
- **`teleprompterRecorder.ts:210-231`**: cancelar en la ventana equivocada deja la promesa **sin resolver nunca**, el stream vivo y el modal en `phase='recording'` con la X oculta → **imposible de cerrar**. Además el avance va por `rAF`, que se congela con la ventana oculta mientras `MediaRecorder` sigue grabando.
- **`BoardCanvas.tsx:118`**: `computeMetrics` (Brandes + closeness + Tarjan) se memoiza sobre la identidad del array de nodos, que `applyOps` reconstruye en cada mutación. Renombrar en línea en un board de 300 nodos ejecuta **~300 BFS completos por tecla**.
- **`character-arc:183`**: cada arco nuevo se guarda con **los prompts de la plantilla como contenido** (`"What past event still haunts them?"` literal dentro del campo), en inglés y indexado por la búsqueda. Deberían ser `placeholder`, no `value`.
- **`StoryboardView.tsx:259`**: los conectores entre filas se pintan **uno por columna** apuntando todos al mismo panel. Con 3 columnas, 3 insignias idénticas.

### 3.2 · Campos declarados que ninguna UI escribe

Cinco enlaces cross-engine ya existen en los tipos y en el esquema Dexie, y **no hay forma de rellenarlos**. Son el puente natural entre motores y cuestan un `<select>` cada uno (el patrón está en `outline/BeatEditor.tsx:185`):

`TimelineEvent.linkedEntryId` · `StoryboardPanel.linkedSceneId` · `Seed.linkedWritingId`/`linkedBeatId`/`linkedSceneId` · `OutlineBeat.parentId` y `linkedWritingId` (sin el primero, **toda la jerarquía de `BeatList` es código muerto**) · `Biography.subjectId` · `ArcBeat.linkedBeatId`/`linkedSceneId`.

Y tres motores exponen `reorderFn` con asas `GripVertical` decorativas que **no llaman a nadie**: outline, character-arc, biography.

### 3.3 · i18n restante (~250 cadenas)

El catálogo tiene paridad perfecta; el problema es el código que no lo usa. Peores casos:

- `StoryboardView.tsx` — **la vista principal del motor no importa `useTranslation`**.
- `SegmentCard.tsx` (video-planner) y `BoardNodeView.tsx` — igual, sin importar el hook.
- `biography` ~48 cadenas · `outline` ~37 · `SceneEditor` 16 · `ChronometryBadge` (panel entero) · `AiToolbar` 13, con dos `{/* TODO: i18n */}` explícitos.
- **`InstagramConnect.tsx:56,66,74` tiene cadenas en español fijas**: con la app en inglés se lee «Conectar Instagram».
- Objetos de configuración con `label` incrustado en inglés que se pintan crudos: `SEED_KIND_CONFIG`, `SEED_STATUS_CONFIG`, `ARC_STAGE_CONFIG`, `ARC_STATUS_CONFIG`, `RELATIONSHIP_KIND_CONFIG`, `RELATIONSHIP_STATE_CONFIG`, `MOOD_CONFIG`, `BEAT_STATUS_CONFIG`, `BIOGRAPHY_CATEGORIES`.
- `ConnectorBadge.tsx:224` pinta el label crudo **cuando las claves `storyboard.connector.types.*.label` ya existen** y las usa `ConnectorEditor`.

### 3.4 · Huecos funcionales que valen la pena

- **Importar Fountain/FDX** (dialog-scene). El export ya existe; el parser inverso es directo. Y el ciclado con Tab entre tipos de bloque (paridad Final Draft) tiene la tecla libre.
- **Exportar** desde storyboard (contact sheet), timeline (el SVG ya está construido en `SwimLaneView.tsx:689`) y maps (`BoardCanvas.tsx:902` ya hace exactamente eso con `html-to-image`).
- **`SyncButton` de writings es código muerto**: `syncGoogleDoc` y `hasDocChanged` existen pero el componente **no se monta en ningún sitio**, así que los docs vinculados se quedan con `content: ''` para siempre y quedan excluidos de Compilar.
- **El número de capítulo sólo se puede fijar al crear** (`WritingsView.tsx:669`); en el editor es de sólo lectura, y la lista ordena por él.
- **`thumbnailData` nunca se genera** en gallery: sólo se lee. El masonry pinta el base64 a tamaño completo de cada foto.
- **Motores analíticos sin tablas** al estilo `pov-audit`, todos derivados de datos que ya existen: *Foreshadow Audit* (el 80 % ya está calculado en `SeedsEngine.tsx:68`), *Arc Coverage*, *Structure Health*, *Continuity Cross-Check* (detector genérico de FKs colgantes).
- **`BoardSurface` tiene 4 valores y `SURFACE_CLASS` los pinta**, pero se escribe `'cork'` fijo y no hay selector: `slate`, `grid` y `blueprint` son inalcanzables. Igual con `board.viewport`, que se **lee** (`defaultViewport`) y nunca se escribe.

### 3.5 · Rendimiento

Cuatro `searchEntities` escanean su tabla entera **de todos los proyectos** en cada pulsación de la búsqueda global: gallery (cargando el base64 completo de cada foto), board (idem con las imágenes de nodo), codex y timeline. El filtrado por proyecto ocurre *después*, en `entityResolverRegistry.ts:101`.

---

## 4 · Notas

- **`assertBackupCoverage` sólo mira las tablas que declara algún `EngineDefinition`**, así que una tabla Dexie que ningún motor declare es invisible para el guardarraíl. Hoy hay 7 así; 4 se salvan por `services/projectToolsBackup.ts` (por suerte, no por comprobación). Además su comentario manda sincronizar con `legacyTables` de `zipBackup.ts`, **identificador que ya no existe**.
- Ficheros de trabajo que he dejado en `_stage/analysis/` (`src.tgz`, `wh-changes.tgz`, `lint.json`, `lintsum.cjs`): bórralos cuando quieras, no los usa nada.
