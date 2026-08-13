# Auditoría de motores — segunda pasada

**Fecha:** 2026-08-12 · Continuación de `auditoria-motores-2026-08-12.md`, atacando la hoja de ruta
que dejó la primera pasada.

**Verificación:** `tsc -b --noEmit` ✅ · `tsc -p electron/tsconfig.json` ✅ · `eslint .` **0 errores / 0 avisos** ✅ · locales **1865/1865**, sin duplicados ✅
**Sin commits.**

---

## 1 · Los deep links ya funcionan

Era el punto nº 1 de la hoja de ruta. Los adaptadores de anclaje llevaban desde siempre componiendo
URLs como `/project/:id/codex?entry=<id>` — es por donde pasan la búsqueda global, Cmd+K y los
backlinks de anotaciones — y **nadie leía el parámetro al otro lado**. Pulsabas un resultado y
aterrizabas en la pestaña correcta, mirando la rejilla, a buscar la ficha a mano.

Nuevo `useDeepLinkParam` en `_shared` (exportado desde `_shared/index.ts`). Dos decisiones:

- **Lee también el hash**, porque bajo ruta hash el query vive tras el `#` y `location.search` está vacío.
- **No consume el parámetro.** Mi primera versión lo borraba de la URL para dejarla limpia; el valor
  desaparecía un render después, antes de que llegasen las filas asíncronas (los pines de un mapa, los
  escritos). Dejándolo, además, refrescar o volver atrás sigue llevando al mismo registro.

Cableado en cuatro motores:

| Motor | Parámetro | Comportamiento |
|-------|-----------|----------------|
| codex | `?entry=` | abre el modal de detalle de la entrada |
| seeds | `?seed=` | abre el detalle de la semilla |
| writings | `?writing=` | cambia al estado que toque y abre el editor |
| maps | `?pin=` | cambia al mapa dueño del pin y `MapView` lo selecciona (`focusPinId`) |

En codex y seeds está resuelto con **ajuste en render** (comparar contra un estado `applied`), no con
un efecto: el linter de React Compiler rechaza `setState` sincrónico dentro de `useEffect`, y el
patrón ya estaba en el repo (`CompileModal`). Además evita que cerrar el modal se deshaga solo en el
siguiente re-render.

## 2 · La búsqueda global ya no escanea toda la base de datos

`EntityResolverConfig.searchEntities` pasa a recibir `(query, projectId?)`, y el registro se lo
propaga. Siete motores lo usan ahora con `.where('projectId')`: gallery, board, codex, timeline, maps,
notes y diary.

Antes, **cada pulsación** en la búsqueda global recorría tablas enteras de todos los proyectos que
hayas creado nunca — gallery deserializando el base64 completo de cada foto, board el de cada imagen
de nodo — y el filtrado por proyecto ocurría *después*, en memoria.

De paso, `NoteCreator` acota su buscador de referencias al proyecto actual: listaba entidades de otros
proyectos y elegir una creaba una referencia cruzada cuyo backlink navegaba a una URL muerta.

## 3 · Defectos

- **`teleprompterRecorder`** — cancelar la grabación en la ventana entre «el bucle pide parar» y
  «llega `onstop`» disparaba las dos guardas a la vez (`finished` en la ruta de aborto,
  `signal.aborted` en la de parada): **la promesa no se resolvía nunca**, el stream del canvas seguía
  vivo y el modal de exportación quedaba en `phase='recording'` con la X escondida tras `busy`.
  Imposible de cerrar. Ahora hay una única salida (`settleFromChunks`), con watchdog de 1,5 s por si
  `onstop` no llega. Y el avance se deriva del reloj real, movido por rAF **y** un `setInterval`: sólo
  con rAF, minimizar la ventana congelaba el scroll mientras `MediaRecorder` seguía escribiendo, y el
  vídeo salía con un fotograma fijo del tiempo que hubieras mirado a otro lado.
- **character-arc** — cada arco nuevo se guardaba con los prompts de la plantilla como contenido
  (`"What past event still haunts them?"` literal dentro del campo «ghost»), en inglés, encendiendo
  los chips Lie/Truth/Want/Need e indexado por la búsqueda. Ahora son `placeholder`.
- **storyboard** — entre fila y fila se pintaba un conector **por columna**, todos apuntando al mismo
  panel. Ahora es uno solo, del último panel de una fila al primero de la siguiente, que es el orden
  de lectura. Y el botón de borrar del `ConnectorBadge` tenía `group-hover:` con la clase `group` en
  su *hermano*, así que era permanentemente invisible.

## 4 · i18n

Tres vistas **no importaban siquiera el hook**: `StoryboardView` (la vista principal del motor),
`BoardNodeView` y `SegmentCard`. Y `InstagramConnect` tenía español fijo, así que con la app en inglés
se leía «Conectar Instagram».

`ConnectorBadge` ahora consume las claves `storyboard.connector.types.*.label` que ya existían y usaba
`ConnectorEditor` — llevaba una segunda copia en inglés incrustada en el propio fichero.

**+44 claves** en ambos locales (1865/1865, sin duplicados).

---

## 5 · Lo que sigue pendiente

Por orden de rentabilidad:

1. **La cascada de reanclaje de anotaciones sigue muerta.** `resolveTextRangeAnchor`, `markOrphaned`,
   `updateAnchor` y los tres `getEntityText` están escritos enteros y sin llamante: editas un capítulo,
   los offsets de las notas al margen quedan obsoletos y el badge de huérfanas es siempre 0.
2. **Escritura por pulsación** en cinco motores (`SceneEditor:419`, outline, seeds, character-arc,
   relationships): escritura en Dexie + `refresh()` por tecla, con el campo controlado desde el array
   refrescado. Se pierden caracteres al teclear rápido. Un `useDebouncedField` en `_shared` los cubre.
3. `BoardCanvas.tsx:118` memoiza `computeMetrics` sobre la identidad del array de nodos, que se
   reconstruye en cada mutación → ~300 BFS completos por tecla al renombrar en un board grande.
4. Campos declarados que ninguna UI escribe: `TimelineEvent.linkedEntryId`,
   `StoryboardPanel.linkedSceneId`, los tres `linked*Id` de Seed, `OutlineBeat.parentId` (sin él toda
   la jerarquía de `BeatList` es código muerto), `Biography.subjectId`, `ArcBeat.linked*`.
5. i18n restante (~200 cadenas): biography ~48, outline ~37, `SceneEditor` 16, `ChronometryBadge`,
   `AiToolbar` 13, y los `label` en inglés incrustados en los objetos de configuración.
6. `SyncButton` de writings no se monta en ningún sitio → los Google Docs vinculados se quedan con
   `content: ''` y quedan fuera de Compilar.
7. Importar Fountain/FDX y ciclado con Tab en dialog-scene; exportación en storyboard, timeline y maps.
