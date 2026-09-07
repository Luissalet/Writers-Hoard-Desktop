# Referencia de motores del flujo creativo

## Tablero (`board`)

Motor vigente de esquemas y grafos, fusión de Yarnboard y Brainstorm. `BoardCanvas` integra captura, ramificación, selección y cámara. `graph/interactions.ts` delimita atajos de lienzo. `graph/geometry.ts` calcula curvas y puntos de anclaje; `EdgeLayer` ofrece etiquetas seleccionables por ratón/teclado. `hooks.ts` serializa persistencia. `copy.ts` contiene texto ES/EN. El adaptador abre tablero o nodo dentro del proyecto propietario y recuerda la ruta en `projectIntelligence`.

## Worldgen (`worldgen`)

`useWorldGeneration.ts` coordina worker, cancelación, respuestas vigentes y caché. `core/worldStore.ts` conserva snapshots de terreno base sin volver a aplicar pintura almacenada. `editWriter.ts` ordena y reintenta escrituras de trazos. `navigation.ts` resuelve mundo y propietario desde mundo, waypoint o ruta espacial. `ParamsPanel` presenta presets, nivel de detalle y controles avanzados plegables. Mapas abre el mundo fuente exacto.

Segunda revisión: mapa cenital inicial, herramientas adaptadas al ancho y selector con retorno al original. `recipe.ts` y `RegenerateWorldDialog` ofrecen alternativas y sustitución atómica con política explícita de regiones/puntos. `WorldView` serializa también regiones y publica únicamente terreno confirmado; el origen cartográfico reconoce la identidad de nuevos datos incluso con igual semilla/resolución.

`FlowSolver` conserva drenaje antiguo y añade versión topológica. `core/render.ts` dibuja miniaturas directamente con `renderAtlasPreview` y reduce asignaciones del mapa. `cartography/frameClock.ts` agrupa cuadros y temporiza vuelos; las capas 3D forman parte de las claves de textura. `region/tileClient.ts` mantiene cobertura y presupuesto en los dos ejes; `tileStore` descarta respuestas canceladas antes de alterar la caché visible.

`core/travel.ts` distingue lagos/tierra/mar, navegación fluvial pintada y embarque terminal; usa distancias esféricas y heurística admisible. `core/edits.ts` interpola trazos por el borde corto y conserva entradas ecológicas al reclasificar. `journeyTypes.ts` normaliza paradas y registra firma de receta; `journeyOperations.ts` guarda por propietario y elimina comparando la versión confirmada. `JourneyPanel` recupera itinerarios/opciones, indica terreno cambiado y conserva borradores ante fallo.

`useWorldEnvironment.ts` coordina apertura, recálculo y restauración del historial. `recalculationClient.ts` prepara estados en un worker con cancelación; `core/recalculate.ts` deriva el entorno conservando el relieve y acota los puntos del historial. `PaintSession` reutiliza matrices al restaurar y consume una fuente original diferida cuando falta un estado. `core/edits.ts` reproduce el punto de recálculo antes de los trazos posteriores y conserva las capas del autor.

`WorldParams.hydrologyVersion` selecciona hidrología compatible o caudal anual con lluvia, evaporación y área física de celda. `core/lakeSurface.ts` resuelve cotas de agua; `sculpt/lakeGeometry.ts` construye superficies de lagos en plano y globo. `lakeSurface` se conserva en transporte, snapshots y recortes regionales.

`cartography/overlay.ts` comparte ocupación de rótulos globales, regionales y del autor. `CartoMap` mantiene escala tipográfica entre dibujo rápido/final y densidades de pantalla. `texture.patchCachedGeography` solo parchea bases existentes; las reconstrucciones se solicitan a `geographyClient` con cancelación por consumidor.

`useJourneyComputation.ts` calcula ruta principal, comparaciones y paleogeografía en worker. `JourneyCreativeCapture` desarrolla un viaje o una noche como idea o escena; `journeyCreative.ts` guarda contenido, vínculo de procedencia y activación del motor en una transacción. El borrador conserva la receta y etapa de origen durante cambios del recorrido.

## Captura y referencias

Notas conserva entradas hasta confirmar persistencia, evita envíos duplicados y activa el motor al trasladar una nota a un proyecto. Códice y Recortes conservan formularios ante fallo. Diario registra guardado pendiente al salir y mantiene el editor ante error. Galería abre imagen/álbum desde ancla y confirma la creación de álbum antes de cerrar. El adaptador de Anotaciones transmite proyecto explícito.

## Organización

Cronología en lista/carriles, Storyboard y Planificador de vídeo esperan persistencia y retienen el borrador ante fallo. Esquema aísla el título diferido por documento. Relaciones abre el vínculo exacto desde ruta; editores de biografía, arco, semilla y escena se separan por entidad.

La matriz completa de necesidades y alcance de revisión está en `tasks/auditoria-creativa-2026-09-07.md`.

## Recuperación y desarrollo

Notas abre el laboratorio con `source=note:<id>`, seleccionando la fuente una sola vez. Galería busca en notas, etiquetas y títulos vinculados. Anotaciones combina búsqueda de cuerpo/fragmento con filtro de anclas huérfanas y actualización mediante `liveQuery`.

`codex/operations.saveCodexDraft` compara base, borrador y versión actual campo a campo en una transacción; conserva campos externos no editados y devuelve conflictos para resolución explícita. El formulario muestra las dos versiones.

Relaciones usa `matrix.ts` y `RelationshipMatrix.tsx` para representar todos los vínculos entre cada par, conservando dirección en el detalle, alta desde celda vacía y reparación de extremos eliminados.

Esquema crea plantillas completas en una transacción y abre escritos/escenas enlazados. Escenas recalcula numeración al crear, ordenar y borrar. Semillas abre fuentes existentes tras vaciar escrituras pendientes. Biografía busca texto visible, etiquetas y fuentes. Estadísticas valida objetivos positivos y fechas antes de guardar y evita duplicados al reintentar.

Mapas y Atlas recuperan borradores mediante `localDraftStore`; Guardar aplica sus cambios a la entidad. `timeline/dateValidation.ts` valida fechas e inicio/final. Storyboard mantiene altas locales hasta confirmar; Planificador de vídeo abre el segmento recién creado y retiene guiones fallidos.
