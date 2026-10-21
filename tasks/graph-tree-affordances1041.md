# G02/T04/T05/T07 — graph and tree affordances

Estado: implementación acotada completada tras lectura y aprobación de root; fuentes congeladas para revisión independiente. WT1041, sin commits. Fuera de alcance mapas, statblock y los34 estados de authoring ya revisados. Cuota comunicada por root:28% primaria medida22:31+02, stale=false; secundaria desconocida. No se delega trabajo ni se consulta Hub/model.

## Evidencia y gaps reales

Inventario base: `C:/Users/luism/Documents/Codex/2026-10-20/fun-with-qwen-image-2-x20/work/worldcraft1041-full-inventory.md`, filas G02/T04/T05/T07 actuales, sin sumar sus duplicados históricos.

Fuentes primarias reabiertas20-10-2026:

- [Connections & The Graph](https://vvd.crisp.help/en/article/connections-the-graph-eir68m/), actualizado01/06/2026: filtros de tipo, hover, arrastrar/fijar y separación entre conexiones de tarjetas/grafo y árboles. No especifica descendencia de templates ni abrir fichas al pulsar nodos.
- [Relation Trees](https://vvd.crisp.help/en/article/relation-trees-1v7xebv/), actualizado20/08/2026: flechas en cuatro lados para añadir vecinos, conectar puntos, cambiar tipo/icono/trazo y arrastrar círculos de extremos. Dice que los tipos personalizados todavía no se guardan para reutilizar; guardarlos dentro del árbol se anuncia para el futuro. No convertir ese anuncio en capacidad presente.

Observación autenticada comunicada por root: WorldGraph16 documentos/127 enlaces; settings con checkboxes Location5/Character4/Item3/Creature2/Event2, nombres Hover/Main/All, spacing, Pictures/TypeAreas/Unlinked/CardSize/Links/Reset. No aparecen subtipos en esa muestra. Pulsar nodos no produjo cambio AX; apertura no demostrada. Se abrió individualmente `outputs/vvd-reference/world-graph-preview-full.png`: grafo poblado y controles básicos; no se deducen menús que no estén en esa imagen.

Root también inspeccionó Tree0.1.17fullscreen poblado: botones semánticos Add relation Top/Bottom/Left/Right, toolbar persona/nota/texto, variantes Main/New variant y nombres hover/always. Dos intentos de MerlinTop no cambiaron AX ni imagen; no se creó vecino ni apareció editor. Son affordances visibles, no ejecución o Save remoto demostrado; el preview podría ser de sólo lectura.

| ID | Estado propio comprobado | Gap que se propone cerrar |
|---|---|---|
| G02 | `WorldGraphWorkspace.tsx:17–18,84` define siete categorías fijas y un selector de una sola categoría. `types.ts:WorldGraphNode` pierde `entry.templateId`; `model.ts:filterWorldGraph` sólo compara `node.type`. El proyecto ya tiene templates jerárquicos y `templateIsWithin`. | Multi-selección de categorías para conservar dos tipos sin todos los restantes, y filtro opcional por template concreto con descendientes. Lo primero corresponde a checkboxes observados; template/descendencia es mejora offline propia autorizada, sin reclamar ausencia VVD. |
| T04 | `RelationTreesWorkspace.tsx:119–124` añade nodo en cuadrícula; `147–152` conecta por separado. Los cuatro handles de PersonNode sirven para arrastrar conexiones. No botón/flecha que abra un vecino contextual ni operación atómica nodo+conexión. | Añadir vecino desde un lado del nodo, manteniendo el formulario global y el arrastre existente. |
| T05 | `243–251` ya cambia origen/destino y anclajes desde inspector, con validación. ReactFlow tiene `onConnect`, pero ningún `onReconnect`; `TreeRelationFlow.tsx` sólo dibuja BaseEdge/label. | Reenganchar directamente el extremo de una conexión existente sin crear otra, con alternativa de teclado en el inspector existente. No confundir este gap gestual con ausencia de edición de extremos. |
| T07 | `RelationTreeEdge` ya conserva label/icon/kind/style/handles/via. `TREE_KINDS` son cinco semánticas; presets Family/Corporate/etc. crean ejemplos editables. No colección guardable de vocabulario. | Guardar/reutilizar configuraciones de relación como mejora propia. La fuente actual describe expresamente la falta de guardado en VVD; no es una obligación de equivalencia demostrada. |

Baseline propio ejecutado, sin datos reales: `.impeccable/graph-tree-plan-graph-baseline.log` PASS5 (incluye5.000 fichas/10.000 enlaces, filtros/caps/layout/SVG/clone); `.impeccable/graph-tree-plan-tree-baseline.log` PASS10 (edición de extremos por inspector, drag de nodo, recuperación, CAS, annotations/junctions/iconos/Undo/JSON). El test de árbol emite advertencias React act ya existentes; no son prueba de gesto nativo de reenganche. No se ejecutaron controles nuevos inexistentes.

## Contrato de comportamiento propuesto

### G02: categorías y templates

1. Conservar búsqueda, tags, foco1/2 saltos, fuentes de conexión, aislados, límites, inspector/Open, posición manual y SVG. Añadir categoría múltiple mediante checks con recuento y Todos/Limpiar; cero categorías significa cero coincidencias, sin fallback silencioso a todas.
2. Añadir selector opcional «Plantilla» con nombre/ruta jerárquica y toggle «Incluir descendientes». El resultado es la intersección de categorías elegidas, rama de template, búsqueda/tag/foco y fuentes actuales. Por defecto todas las categorías y ninguna plantilla. Elegir un padre incluye self+hijos+nietos; desactivar descendientes sólo self. No deriva identidades del nombre; usa IDs y `templateIsWithin` existente.
3. Mantener el antiguo `WorldGraphFilters.type` como entrada compatible para tests/consumidores; el nuevo conjunto opcional tiene precedencia sólo cuando se proporciona. No reescribir filtros antiguos persistidos ni posiciones. No hace falta guardar filtros nuevos para cerrar este alcance: siguen siendo estado de vista, como hoy.
4. `WorldGraphNode.templateId?` conserva identidad desde la ficha. `WorldGraphWorkspace` recibe templates del proyecto a través de Pane; `filterWorldGraph` recibe el contexto jerárquico opcional. El worker conserva los mismos resultados que el fallback y no necesita transportar imágenes ni ampliar su trabajo de menciones. Jerarquías importadas con ciclos/parents ausentes terminan mediante el helper existente. Template borrado/desaparecido nunca hace match con otro por nombre; el control muestra la selección no disponible o permite limpiarla explícitamente.
5. Sin cambio de política de proyecto/era: fichas efectivas desde el contexto existente; templates/layout continúan siendo metadatos de proyecto compartidos, porque WorldEra.defaults no define esos campos. No crear preferencias/posición por era en esta tanda. Fuentes de relaciones mantienen su semántica actual. Un query MCP nuevo usa exactamente ese mismo contrato, sin reconstruir otro grafo por su cuenta.

### T04: vecino contextual

1. Cuatro acciones semánticas con nombre accesible «Añadir vecino arriba/abajo/izquierda/derecha» en el nodo seleccionado o enfocado, separadas de los handles existentes. Se abre un formulario contextual en el inspector; aún no cambia el documento.
2. Permite nombre libre o ficha del Codex efectivo, tipo de relación o línea sin nombre, y dirección origen/destino explícita. La posición arriba no inventa progenitor ni otra regla: el valor por defecto es línea personalizada sin nombre. Conservar los cinco tipos semánticos y el formulario global.
3. Crear añade nodo y arista juntos mediante helper puro, IDs nuevos, distancia estable del lado elegido y búsqueda sencilla de hueco si está ocupado. No cambia nodos antiguos ni ejecuta layout global. Entra como una operación en Undo; cancelar/escape no crea datos ni deja Undo vacío. Selecciona el nuevo nodo y enfoca su nombre. Enter confirma desde formulario; teclado puede acceder a las cuatro acciones.

### T05: reenganche real de extremos

1. Usar `onReconnect` de la versión local de XYFlow, manteniendo ID lógico, kind/label/icon/style, extremo no movido y `via` ordenado. El gesto terminado en el mismo anclaje es no-op; soltar en vacío o Escape conserva la arista, sin borrarla.
2. Los segmentos de `relationTreeSegments` son proyección de una arista lógica. Sólo primer origen y último destino muestran extremo reenganchable; una arista sin via permite ambos. Segmentos intermedios siguen moviéndose mediante sus junction nodes existentes. No aplicar `reconnectEdge` directamente a los IDs de segmento ni almacenar segmentos como aristas nuevas.
3. El helper valida referencias, self/ciclo semántico y rutas antes de cambiar el draft. Error visible conserva documento/Undo. Un reenganche válido es una sola operación Undo/Redo. Inspector de origen/destino/anclajes permanece como alternativa de teclado y usa el mismo helper cuando cambia extremos.

### T07: vocabulario portable sin estado global nuevo

1. Añadir al documento opcional `relationVocabulary?:[{id,name,kind,label?,icon?,style}]`. Ausencia significa biblioteca vacía; todos los labels viejos permanecen inline. Los cinco kinds semánticos no se amplían ni se deducen de labels. Validar IDs únicos locales, nombre no vacío e icono/estilo/kind existentes.
2. Desde una relación seleccionada, «Guardar como tipo» captura sus valores bajo un nombre editable. Se puede aplicar un tipo a una arista o elegirlo al crear/conectar un vecino. Aplicar copia valores en los campos existentes de la arista; no crea enlace vivo a la definición. Renombrar/editar/quitar un tipo no altera aristas ya escritas.
3. Picker permite tipos del árbol actual y copiar/aplicar desde otro árbol del mismo proyecto/era efectivo, identificando su origen. Copia explícita al árbol actual si se quiere conservar allí; ningún árbol ajeno se escribe. Sin biblioteca entre proyectos, nueva tabla, migración, sincronización global ni catálogo que convierta ejemplos de presets en reglas.
4. El vocabulario viaja con Save/variant/recovery/history/archive/JSON/clone/fullJSON/ZIP existentes; IDs son locales al árbol. La exportación SVG sigue representando relaciones aplicadas, sin imprimir toda la biblioteca ni perder textos anteriores.

## Seams concretos y orden

Tras lectura/aprobación de root, una tanda acotada en estas rutas:

1. Grafo: `src/engines/codex/worldGraph/{types.ts,model.ts,WorldGraphWorkspace.tsx,WorldGraphPane.tsx,copy.ts}`. Reutilizar `templateHierarchy.ts` sin cambiar semánticas de herencia. `useWorldGraph.ts`/worker sólo si hace falta mantener paridad de payload; no rehacer indexación ni el trabajo rich-pointers ya cerrado. Nuevos leaves locales de query/manifest, registrados en el catálogo central mínimo.
2. Árbol: `src/engines/genealogy/{relationTrees.ts,relationTreeRoutes.ts,relationTreeCopy.ts,treeBridge.ts,treeManifest.ts}` y `components/{RelationTreesWorkspace.tsx,TreeRelationFlow.tsx}`. Nuevo `treeAffordances.ts` para helpers puros de vecino/reconnect/vocabulario; sin nuevo motor. `relationTreeStore.ts` mantiene su único Save/CAS; no tocar geneología canónica ni fichas.
3. MCP: un read `wh_world_graph_query` con filtros/resultados y provenance explícitos; un `wh_relation_tree_action` con acciones neighbor/reconnect/vocabulary-save/apply/remove, expectedRevision y project/era. El bridge usa los mismos helpers y `saveRelationTree`; `wh_relation_tree_get/save` conservan forma completa y schema añade el campo opcional. El consumidor de JSON completo sigue pudiendo hacer esas ediciones.
4. Undo nativo: treeBridge actual sólo emite entityId sin before/receipt; igual que el gap previo observado en fichas, no sirve para prometer Undo de una acción nueva. Para el action nuevo, recibo opaco por sesión dentro de la transacción, comprobación de scope/version y restauración por operaciones normales. Primera variante de era vuelve a herencia; variante previa conserva su contenido. Seam central aditivo `src/services/aiBridge/undo.ts` sólo para ese recibo, si root lo cede. No ampliar creación/eliminación ni otros motores ni refactorizar statblock.
5. Docs del área y tests dedicados. No cambiar grafos a editor de relaciones canónicas ni rediseñar UI; controles charcoal/gold existentes, Copy ES/EN y visual inspect1440/640 en una tanda, una corrección material y confirmación como máximo.

## Casos de éxito que deben ejecutarse antes de cerrar

- G02: dos categorías a la vez; vacío; padre/hijo/nieto de template y hermano excluido; sólo-self; fichas sin template; mismo nombre/distintoID; template eliminado y jerarquía malformada; intersección con query/tag/foco/kinds/aislados/caps; SVG sólo visible; posiciones guardadas intactas. Worker y fallback iguales. Base y era con fichas distintas no filtran por datos de otra vista.
- T04: cuatro lados por puntero y al menos una por teclado; vecino libre/Codex/línea sin nombre; cancelar; nombre Unicode; espacio ocupado; crea exactamente1 nodo+1 arista; Undo/Redo conjunto y Save/reopen; no cambia Codex ni canon.
- T05: arrastre nativo de source y target al mismo nodo/otro nodo y a distinto lado; también ruta con dos junctions, manteniendo vía y metadatos; no-op/cancel/soltar fuera sin cambio; self/ciclo inválido sin draft ni Undo añadido; un Undo restaura todos los endpoints/handles.
- T07: guardar/configurar/aplicar tipo, editar/borrar definición sin retocar aristas existentes; tipo sin nombre visible permite línea; reutilizar/copia entre dos árboles del mismo effectiveproject; vocablos homónimos independientes; variante/era propia y Base intactos; recovery/JSON clone/fullJSON/ZIP/archive/version restore conservan biblioteca y labels antiguos.
- Native MCP externo stdio→HTTP→executor→IPC para query/action/save/get; CAS rechazado sin modificación, scope de fichas, Base/era, Undo normal de acción con recibo y posterior-write refusal; no se acepta un dispatch local como sustituto del transporte externo.
- UI real CSS1440/640 con accesibilidad por nombre, sin overflow ni controles cortados, renderer aislado/sin red; native PNG y SVG de árbol conservan ruta/último contenido/artwork/tinta. Ejecutar world-graph y relation-trees existentes más pruebas específicas; tsc/lint apropiados. Congelar hashes y evidencia para revisión independiente de root. No equivalencia global ni acciones remotas de referencia no realizadas.

El contrato anterior fue aprobado por root antes de código. Implementación y evidencia final en projectless work/worldcraft1041-graph-tree-affordances.md y .impeccable/review/graph-tree1041/provenance.json. Root registró los arrays MCP; el único seam Undo central añadido corresponde a wh_relation_tree_action. No commits.



## Cierre de implementación

Core3 + Worker/query/tree external MCP/artifact4 =7grupos PASS; UI nativa1440/640 PASS2; graph/model5+graph/UI2+relationTrees10+presets4 regresiones PASS. Scope tests incluyen JSONclone/full/ZIP, archivo y versión de era, artwork, CAS, rollback outertx, normal API Undo, same-node sidechange y same-anchor no-op con un solo Undo. Ver logs .impeccable/graph-tree-*-final.log y graph-tree-presets-regression-postfreeze.log. Lint18archivos PASS. tsc global pendiente de las ediciones SDK ajenas (diagnósticos actuales en ToolDocument*/LocalToolDocumentHost; ninguno en rutas propias).

Visual: una tanda9vistas, corrección material de unnamedline (fallback custom), confirmación11vistas (incluye formulario de vocabulario a ambas anchuras), sin nuevas rondas cosméticas. Últimos replays funcionales verifican capturas por hashes idénticos a las confirmadas. Native regression presets espera fitView inicial calculado antes de medir el gesto; mantiene las afirmaciones de snap/save/Undo/imagen. Se conservan logs FAIL iniciales.
