# Writer publishing workspace

La entrega55 de1095 está integrada en Main con fuente `7989bfcad06531da35182e71cbe769e90136ce02`, aprobación exacta CAS55 y133 blobs/disk verificados. Incorpora hojas finitas rectangulares o verticales, cambio real de terreno con nueve anclas y relleno mar/tierra, preparación cancelable y Undo compatible. Solape caliente14 buffers RAW; codec frío con pérdidas previas. La revisión causó y corrigió reinos/caminos/viajes, límites MCP y anotaciones Map2D; el caller separado renderCartography conserva un residuo estático, sin certificar Carta/export completo. [Uso, MCP y atribución](tasks/vvd1095/verification-world-domain.md). Root final2:quick184833ms,396críticas151607ms y build394076ms,108Source/133code exactos; no Native de app Main. Manual+1361UTF16 con recurso completo verificado y bloqueos libres.1095/paridad siguen abiertos.

Las apps locales componen Host y Surface sobre documentos Source reales, estado/CAS, releases, épocas, Undo y router existentes. Comparten documentos entre instancias con clientes de montaje independientes, retienen borradores declarados ante separación o cambio compatible de versión y exportan capturas mediante Wiki. `wh_local_app_list`, `wh_local_app_describe`, `wh_local_app_set_route` y `wh_local_app_export` tienen prueba Root Native real con dos claves, incluida repetición tras el último fix del Host; Brave acredita edición compartida, recarga y aislamiento de era. [API, evidencia y residuos SDK](tasks/vvd1095/verification-sdk-app-host.md). CRDT, paquetes runtime y el resto del ledger continúan abiertos.

La ampliación 1526 añade `client.icons.resolveSvg?` y `wh_local_tool_icon_svg` readonly sobre el catálogo propio existente. Devuelve SVG estándar 24/currentColor con avisos de licencia, o null para IDs desconocidos; los errores del resolver se propagan. Metadata/fake siguen puros sin geometría implícita; el runtime real la carga sólo para un ID conocido solicitado. Cuaderno de iconos permite Descargar SVG sin guardar notas ni modificar estado/ledger; desmontar, cambiar cliente o cambiar selección revoca respuestas tardías, incluso A→B→A, mientras editar notas conserva el pedido. Geometría verificada para 1688 símbolos/6717 shapes/7334 E/10722 A; raster exacto 3376 sigue FAIL histórico (2158 exactos/1218 diferentes). El acuerdo 1650 no certifica igualdad fotométrica. SDK/paridad1095 continúan parciales; revisión formal, gates e integración tienen [estado separado](tasks/vvd1095/verification-sdk-icon-svg.md).

El SDK local expone el catálogo propio de símbolos mediante `client.icons` opcional: `get`, `search` paginado y `packs` devuelven metadatos desprendidos; `LocalToolIcon` dibuja el ID con el pintor existente y fallback, también desde clientes World/Owned. `wh_local_tool_icons` ofrece las mismas lecturas sin necesitar proyecto/época ni escribir datos, y el transporte conserva el `null` de un ID desconocido. El ejemplo importable Cuaderno de iconos guarda icono y notas por acciones separadas, sin guardar el borrador al buscar o elegir. El corte1523 no instalaba/habilitaba código ni añadía SVG, packs externos o formato de prosa/preview. [Contrato, evidencias y entrega](tasks/vvd1095/verification-sdk-icons.md). SDK general y1095 continúan parciales/abiertos.

El SDK local añade lectura opcional de destino: `refs.resolve(reference,{includePath:true})` conserva identidad, título efectivo, disponibilidad y procedencia, y añade `path:string|null` del ámbito Base/época del cliente. Comparte la resolución de `openDocument`, sin despachar navegación, hacer flush ni escribir; un documento disponible puede tener ruta nula si su adaptador no emite destino. `wh_local_tool_reference_resolve` transmite la opción booleana y sigue siendo de lectura. Omitido, `{}` o false conservan la forma anterior. El valor es una ruta de aplicación, sin dominio ni adaptación al alojamiento; no cambia las guardas, los paneles ni las aperturas existentes. [Contrato, evidencia y estado](tasks/vvd1095/verification-sdk-document-path.md).

El cliente de herramientas locales admite `openDocument(kind,id,{placement:'beside'})` y el selector conserva Abrir junto a Ver al lado. Reutiliza resolución efectiva, ámbito y navegación lateral existentes; las llamadas sin opciones y `refs.open` mantienen su contrato. Source principal conserva su documento al consultar B; un Source lateral queda montado, oculto y recuperable al abrir otro motor. Los pendientes usan el flush normal y Códex presenta su Modal global habitual. `Promise<void>` confirma resolución y despacho, sin ACK del guard asíncrono ni garantía de flush completado. No añade herramientas MCP, servicios, permisos, tablas o dependencias. [Contrato, evidencia y límites](tasks/vvd1095/verification-sdk-placement.md).

La luz del mapa Worldgen se guarda desde el selector existente en cuanto se elige: `off`, `dawn`, `morning`, `noon`, `afternoon`, `dusk`, `night` o `journey`. Los mundos antiguos sin campo se leen como `off` sin escribirlo. El control mantiene una operación en vuelo, CAS y recuperación con Reintentar explícito; un conflicto conserva los ajustes ganadores y descarta sólo la intención propia. Getter/setter, ámbito Base/época, recibo de Deshacer y render existentes comparten el campo opcional `mapHour`; `journey` conserva sólo el modo, sin guardar ticks ni compartir reloj entre montajes. No añade ABI host de lenses, herramienta de itinerarios ni lavado 3D/Carta. [Contrato, atribución y estado de entrega](tasks/vvd1095/verification-map-lighting.md).

**Archivo de recursos** permite previsualizar audio y vídeo locales sin abrir otro motor: Resumen → Producir → Archivo de recursos → Abrir → Play en los controles nativos. El panel sobre la lista tiene nombre completo y Cerrar; no reproduce automáticamente, duplica archivos ni guarda la selección. Cambiar de recurso/proyecto, filtrarlo fuera o reemplazar sus bytes retira la fuente anterior. La biblioteca permanece Base; las lecturas MCP de catálogo/usos siguen disponibles, sin reproductor headless nuevo. [Contrato, evidencia y recibos](tasks/vvd1095/verification-assets-media-preview.md).

El editor Source y el editor antiguo de herramientas pueden ofrecer menús contextuales opcionales mediante clic derecho, Shift+F10/ContextMenu o Acciones. Contador contextual conserva las acciones planas y botones Incrementar/Restablecer, y añade Más acciones → Incrementar y Cuenta → Restablecer dentro de esa rama. La apertura es explícita; Atrás/Izquierda/Escape vuelven un nivel, y Tab cierra todo para continuar. Navegar no guarda datos; las hojas comparten funciones MCP y Deshacer/Rehacer explícitos por recibos. Los ejemplos deben habilitarse; los bloques propios/mundiales, sólo lectura y pantalla completa no reciben este puerto. [Entrega plana anterior](tasks/vvd1095/verification-sdk-context-menus.md); [contrato anidado y evidencia](tasks/vvd1095/verification-local-tool-submenus.md).

La ficha guardada del Códex incorpora **Exportar**: Markdown individual, ZIP opcional con los adjuntos locales consumidos, PDF/PNG en Desktop y vista imprimible en Browser. La copia de autor se captura en sólo lectura para Base o la época efectiva; no incluye borradores, anotaciones ni toda la galería. Las herramientas MCP existentes añaden selección individual optativa y conservan sus formatos predeterminados. [Uso, pruebas r1/r2 y estado de entrega](tasks/vvd1095/verification-card-export.md). No se atribuye una descarga confirmada en Brave ni paridad completa con VVD.

Las herramientas fuente pueden declarar recorridos opcionales en su editor Source o antiguo. **Ayuda** permite iniciarlos o reanudarlos; los pasos avanzan manualmente, tras una acción confirmada o cuando aparece un elemento en esa instancia. El progreso sigue la estructura ordenada del recorrido y el idioma sólo cambia sus textos. Contador guiado es el ejemplo ejecutable. Los bloques propios, bloques mundiales, vistas de sólo lectura y pantalla completa no reciben este puerto. [API, pruebas y estado de entrega](tasks/vvd1095/verification-sdk-tours.md).

Las fechas del mundo añaden mes anterior/siguiente, Borrar y campos separados de año/mes/día con Aplicar/Cancelar, junto al texto libre y la cuadrícula existente. Navegar conserva la fecha escrita. Hoy usa el día civil local del ordenador sólo con una correlación terrestre completa y utilizable; eventos y capítulos mantienen sus reglas de guardado. [Uso, pruebas y límites](tasks/vvd1095/verification-date-controls.md).

Tablero: Archivos en Recursos y soltar archivos permiten importar audio/vídeo local a la biblioteca del ámbito y crear su referencia; El botón Imagen sigue limitado a imágenes y conserva Galería/portapapeles. Añadir/arrastrar recursos existentes, Referencia e importar desde la biblioteca siguen disponibles. Los nodos comparten archivo, usan controles nativos sin autoplay y liberan la reproducción al ocultar/cerrar; Deshacer/Rehacer conserva el recurso. MCP compone importación y referencia existentes con recibos separados, sin nuevo tool/kind/tabla ni atomicidad conjunta. [Reproducción anterior](tasks/vvd1095/verification-board-local-media.md); [entrada directa, pruebas y límites](tasks/vvd1095/verification-board-file-import.md). El SDK general y otros huecos del tablero siguen parciales; no se acreditan nuevos stdio, segunda clave ni salida acústica medida.

Los bloques propios de una herramienta fuente pueden optar por evolución aditiva del codec: una versión compatible añade campos al mismo bloque sin modificarlo al elegirla o leerlo. La primera edición efectiva guarda datos, codec y preview portable juntos; Deshacer de acciones restaura el envelope anterior completo. La compatibilidad estricta sigue siendo predeterminada, el estado Source conserva su migración existente y el SDK general sigue siendo parcial. [Contrato, ejemplo y evidencia](tasks/vvd1095/verification-sdk-owned-evolution.md).

Las notas enriquecidas admiten imágenes de Archivo o Galería del proyecto. Puede ajustar ancho, marco y alineación, sustituir una imagen conservando sus ajustes o quitarla y usar Deshacer/Rehacer. También puede guardar y reabrir notas formadas sólo por una imagen. [Uso, pruebas y límites](tasks/vvd1095/verification-note-inline-images.md).

Los lugares de Worldgen admiten una imagen local copiada de archivo o Galería, con sus colores o con la tinta del mapa. Al retirarla vuelve el gráfico disponible y después el símbolo o edificio conservado; cambiar o borrar el original de Galería no altera la copia. Maps y los retratos vinculados al Códex conservan su comportamiento. [Contrato y verificación](tasks/vvd1095/verification-place-images.md).

Los lugares de Worldgen también ofrecen un catálogo gráfico con búsqueda y categorías: 1688 geometrías propias y 1689 nombres en el selector (Wand2 se guarda como WandSparkles). Celdas, selección, mapas, 3D proyectado, hojas regionales y PNG comparten el mismo dibujo numérico. La imagen local preparada tiene prioridad; al quitarla vuelve el gráfico y, al quitar éste, el modelo/símbolo conservado. Elegir un modelo en el inspector retira expresamente los overrides activos. Es una capacidad offline acotada, sin acreditar todo el inventario temático de VVD ni equivalencia general del SDK. [Uso, contrato nativo y pruebas](tasks/vvd1095/verification-map-symbol-catalog.md).

Los campos de una herramienta fuente pueden optar por prosa enriquecida: títulos, listas, enlaces textuales e imágenes raster locales copiadas usan el editor nativo y siguen legibles sin el módulo de autor. El informe se guarda explícitamente; un bloque propio requiere después guardar su documento padre y el dock exige Guardar/Descartar el hijo antes de salir. Es edición local string+CAS, sin colaboración por caracteres; el SDK general sigue siendo un subconjunto parcial. [Uso y límites](tasks/vvd1095/verification-sdk-rich-prose.md).

Las bandas del calendario admiten estandartes guardados por cronología, vínculos vivos, copias independientes y vuelta al estilo manual conservado. Trama cruzada, cuadrícula y mosaicos raster locales tienen tamaño y opacidad opcionales; editar el estandarte repinta sus eventos vinculados sin reaplicarlo. Los traslados conservan su cronología propietaria. Controles normales, MCP nativo, Deshacer por ámbito, épocas y copias portables comparten contrato. [Uso, comprobaciones y límites](tasks/vvd1095/verification-calendar-banners.md). Se acredita el flujo offline acotado de C-writing83; la tarea1095 continúa. En aquella entrega de estandartes la prosa enriquecida seguía en investigación; su ampliación posterior tiene [evidencia separada](tasks/vvd1095/verification-sdk-rich-prose.md).

Un mismo mundo puede contener varios relatos de autoría independientes, con capítulos, metadatos, cubierta y lectura propios. Conservan las identidades compartidas del Códex, mapas y cronologías. La biblioteca, el editor de libro, la importación, los perfiles de publicación y las copias usan el relato seleccionado; el principal antiguo sigue implícito. MCP añade catálogo y edición con revisión y Deshacer. [Contrato y comprobaciones](tasks/vvd1095/verification-shared-manuscripts.md). La importación local font/data del SDK y la portada/resumen de cada relato están integradas en la entrega `416be426337f22f128c5f4d0875167d48738e05c` (fuente funcional `c2b7cb0dba116485264a8ae86e48635c82706e72`) tras CAS23 independiente y las comprobaciones finales de raíz. Los archivos se eligen por documento o instalación y se conservan en lectura/copias sin conexión; la biblioteca y la vista del relato muestran cubierta, resumen y fecha de sus capítulos. [Contrato, evidencia y límites](tasks/vvd1095/verification-sdk-asset-files.md). La tarea1095 continúa.

El audio del SDK `fcf94f6` está integrado tras CAS20 independiente: niveles digitales RMS/pico por voz y canales, y panorama estéreo sobre el grafo real de reproducción. Sonidos locales ofrece sus controles normales; MCP consulta niveles y modifica el mismo panorama por ámbito. Brave probó paneo, silencio medido, Detener y guardar/reabrir sin reproducción automática. La revisión registra29 grupos focales distintos (7 autor +4 propios +18 legacy), con capacidades solapadas. Verify/build de main limpio pasó: Vite43.33s, Electron, Node937/esquema y el kit de autor original sin dependencias de base de datos. El manual tiene su recibo propio415UTF16/revisión/relectura. La regresión headless de previews de recursos se corrigió aparte en043e906/CAS19. Siguen siendo firmas propias y reproducción del SDK, con panorama estéreo; no3D, medición del altavoz ni transporte stdio final nuevo. [Evidencia y límites](tasks/vvd1095/verification-sdk-audio-levels.md). La comparación1095 continúa.

Graph source `ecb1703` is integrated after independent CAS16: optional spacing/type areas, preserved pins and portable display/hidden/saved views. Root's real Brave verified drag, filtering, reload and saved-view restoration; 26 distinct peer result labels across two overlapping passes. Final clean-main verify:quick/Vite32.31s/Electron/Node937 passed; manual355UTF16 insertion preserved197other paragraph texts/styles with required revision/readback. Both merge/manual locks are released. Receipts are in tasks/vvd1095/verification-graph-display.md. Project-wide settings remain separate from effective era cards; no full parity or new stdio claim.

Player attacks are implemented at `112f1fc3e108cd83d73ed9c8ad9accf7ad2d60f3`, approved by fresh independent CAS 18. Earlier CAS 17 approved `971870a`; the two-byte test-EOF amendment required its own new vote, without inheriting that approval. Optional fiveEAttack metadata coexists with generic/spell rows and requires explicit opt-in. Attack/Damage uses native sheet history, scoped CAS/Undo and existing dice; no AC, critical adjudication or resource spending. Labels identify action/name/type, use ES in the editor and canonical EN through MCP, and abbreviate only derived context within the existing label limit while preserving Unicode and complete source rows. Existing history is not migrated. Discard/Reload reuse contextual native confirmations; actual Delete remains unchanged. Peer technical review records 32 distinct focused groups (10 author, 5 independent, 17 legacy), with final repetitions attributed separately; root Brave confirms save/reopen, final history labels, discard/cancel and paper. Root integrated exact `112f1fc` FF-only under the merge lock. Final clean-main verify:quick passed with 34 engines, 64 tables, 6515 locale keys, 22 locale files and zero warnings; shipping lint zero, Vite 36.92s, Electron and both plain-Node checks PASS (937 tools and Reveal schema/limits). Root session 30517 exited zero, main stayed clean and the merge lock was released. The separate Google manual receipt records 412 UTF-16 units, requiredRevision/readback, 198 paragraphs, 197 other texts unchanged and all paragraph styles preserved. Existing Age37/Height1.72m custom properties were saved/reopened/printed without new code. See tasks/vvd1095/verification-player-attacks.md; no final-source stdio or universal parity claim.

Calendar banner shapes are integrated at `2f21eed73c87d9c3af1e6b7f7a191f2be939b591` after independent CAS 14. Optional Plain/Ribbon/Bunting/Scallop stays separate from fill patterns; the shared editor, native create/update/list, normal Undo and era/JSON/ZIP paths preserve that distinction. Root's normal Brave checked shape/fill combinations, return to Plain, single-day bands and week/month boundaries. Final clean-main checks passed: renderer/Electron types, zero lint fingerprints, conformance 34 engines / 64 tables / 6515 keys / 22 locale files / zero warnings, Vite 27.77s, Electron bundles and two plain-Node checks with 934 tools. Root session 36816 ended exit 0, main remained at the exact source and the merge lock was released. The shape manual receipt records 314 added characters with 197 other paragraphs/styles preserved; calendar/audio's earlier 610-character update is separate and complete. Year view stays points and wiki stays an event list. See tasks/vvd1095/verification-calendar-shapes.md; no full-reference parity or task closure is claimed.

Calendar direct editing is integrated as `4e4bf5ddb92177becf55c001f8a26e2e1bf42e7d`, independently approved CAS12. The selected-day event button uses its existing owner-timeline editor/current pane era, keeps Calendar mounted and returns month/day/focus; save errors retain draft/retry. Root's normal Brave flow opened originalJan10–12Weekly from occurrenceJan17 and saved its description back to17. Final clean-main verify:quick and Vite27.91s/Electron/Node932 passed; root released the merge lock. Existing MCP/range/recurrence is unchanged. See tasks/vvd1095/verification-calendar.md.

Scoped SDK audio7c4e3fb is integrated FF-only after independent CAS13; root left main clean and released the merge lock. Optional client.audio/hooks own local scoped handles; five buses/focus/fades only share SDK sounds in this renderer, leaving legacy Soundscape/Reader separate. Native wh_local_audio_status/control expose real status/stop/bus; play validates media and returns started:false, queued:false, gesture-required. Do not claim MCP audible playback or hardware recording. Four peer P2 corrections passed11final peer groups with17matching hashes; root repeated corrected-source Play/Stop at5% after reload. Final main verify:quick/Vite26.31s/Electron/Node934 passed (root session97961 exit0). The native calendar/audio manual update is complete: its separate receipt records 610 added characters with 197 other paragraphs and all styles preserved. API signatures are Writer's own; resource defaults were outside that audio-only source and are covered by the separate delivery below. Spatial/getLevels measured and a unified legacy graph remain outside this PARTIAL contract. See tasks/vvd1095/verification-sdk-audio.md.

Source `d542365` adds native tool resources: bundled image/audio defaults, document → installation → package selection, Revert, scoped asset MCP tools and portable references. AssetPad uses the normal owned-block menu. Independent technical review records 34 distinct focused groups (18 author + 6 reviewer + 10 legacy); normal Brave confirmed imports, selection/Revert, save/reopen and a 96px read-only preview. Approved CAS15 and integrated FF-only from f44e387 to exact d542365 under a fresh merge lock, with clean main. Final verify:quick/shipping lint, Vite28.92s, Electron and Node937/schema2PASS completed; root session2655 exited0 and the merge lock was released. The Google manual update added588 UTF-16 units with requiredRevision/readback,198 paragraphs,197 others and all styles preserved; both manual locks were released. Own SDK signatures remain partial; installation has CAS/Revert without Undo, the d542 cut had font/data Blob defaults without a generic picker (local import/choice was added later; [current contract](tasks/vvd1095/verification-sdk-asset-files.md)), and wiki may apply its own SVG frame. [Resource evidence and final receipts](tasks/vvd1095/verification-sdk-assets.md). Native audio play with a source-slot ref still reports started:false, queued:false, gesture-required; it is not remote audible playback or a new stdio receipt.

Optional rich notes are integrated at `0a90dd40f18361a0ae67e87923bb8890cccf24d6`, independently approved CAS9. `richHtml` stores sanitized native editor HTML; `text` stays coherent for ordinary search/AI/Copy. Rich writes derive text, metadata preserves formatting, plain text replacement clears rich content, and native MCP/Undo restores both fields and optional absence within the existing scope/era contract. Read does not migrate plain notes. Enter/bare capture stays plain. Captured wiki/local raster images, document-image sources and JSON/ZIP/clone are covered by focused tests; no blanket claim covers every editor control or interactive embed. Root's Brave save/reload, exact three-line Copy and search are separately attributed in tasks/vvd1095/verification-notes.md. Clean-main verify:quick, Vite1m18s/Electron build and plain-Node931 passed after exact-lock dependency restoration; earlier TS2307/TS2322 attempts remain failures. The peer's Node932 working-tree result included concurrent atlas and is not its catalogue proof. The stdio cache limitation and open task1095 remain.

Atlas-to-card is integrated at `ff3baead8149aefa03c3ba0c9ead6875eb6bc6b0`, independently approved CAS10. Native `wh_create_place_card {worldId,key,type?}` reuses scoped creation/link operations and atomic Undo; project JSON carries/remaps optional entityLinks. Root's normal Brave flow used Index→Place and cards, created a Faction, linked the existing Character, opened the Faction and returned with both links retained. Root's clean-main verify:quick/Vite43.47s/Electron/Node932 passed; this final 932 catalogue is distinct from the earlier concurrent working-tree check. FF-only integration from0a90dd4 left main clean and the merge lock was released. Native manual readback preserved197other paragraphs/styles. Evidence and remaining card search/alias/name-sync limits: tasks/vvd1095/verification-place-cards.md. Cached stdio and task1095 remain open at their stated scope.

Writer1095 at source12264fd adds opt-in saved CoC summaries/roster and linked compact embeds; full paper, rules, defaults and ink remain intact. `wh_sheet_get` exposes `derived.summary`; `wh_sheet_list` opts in with `includeSummary:true`, preserving the ordinary list shape otherwise. Featured skill IDs (up to five summary slots) are separate from development marks. Owned live editable embeds dispatch native source rolls with saved-revision CAS and normal Undo receipts; readonly About/Reader/export have no roll controls or writes. Codex About now hydrates saved tool/source blocks and references through readonly pipelines; player projections keep reveal/private-field policy and remove nested cached atoms before textual projection.

The additive SDK hooks `useLocalToolWorldList`/`useLocalToolWorldRead` subscribe to committed scoped reads, reject stale results and expose error/retry with cleanup; the author fake publishes only committed changes, not intermediate/aborted writes. Root's normal Brave checks followed create/rename/archive in one still-mounted WorldCardList and reopened both saved blocks in About. Complementary CAS8 approved7b841e2+12264fd; root integrated without push and recorded clean-main build/Node931. These are source capabilities, not an installed-executable update or new final-source stdio transport: that host remains cached and its restart was rejected. Evidence/attribution and remaining comparison gaps: tasks/vvd1095/verification-compact.md. Task1095 remains open.

Live-table follow-up adds five missing filter operators to the shared UI/MCP query: negative containment, prefix, suffix and inclusive numeric bounds. Existing operators and data remain intact; see tasks/vvd1095/verification-tables.md for final-source dispatcher/Browser evidence and the cached stdio limitation.

Writer1095 live-reference continuation: native source-tool field/reference indexes are portable and queryable from SDK, live UI and `wh_local_tool_document_query` (931 source catalogue tools at that earlier delivery). Normal search includes declared list/map values. Focused tool documents/owned blocks/legacy views gain scoped keyboard Undo/Redo without swallowing native text Undo or global commands. CoC paper/read-only projection retains investigator play state, derived/manual values, development marks and linked pushes; the original paper/ink coordinates stay intact. Non-destructive sheet actions have matching confirmations. Exact evidence and remaining reference limits: tasks/vvd1095/verification-live.md. This source delivery does not update the installed executable.

Writer retains its document editor, origin5174/IndexedDB and independent fiction worker. Library, reading, paperwork and publishing are four independently controlled native modules. Initial catalogue/status is cold; API/MCP/UI share the existing401 publishing tools and native IDs/formats. Real profiles/tokens/conversations are not migrated by source changes. Cicero remains separate; Borges belongs to Writer, not Hypatia. Home/Cook and People/Dorian remain separate.

931 CAS5: failed shutdown retains app/resources and worker; ON/new native requests are rejected until explicit Retry OFF succeeds. Four factories expose cleanup checkpoints; EOF retries only cleanup. Kafka owned client closure propagates failure without editing SDK; editorial sessions remain retained through complete joins. Native DOM stays mounted while an owner is retained.

Synthetic source and frozen-worker checks exercise all four factories. --worker-only reconstructs the frozen worker without Rust builds; native binary hashes are preserved. See docs/PUBLISHING.md and tasks/submission931-cas5.md for evidence and limits. Root owns independent review, CUA, real migration, aliases, installation/activation and publication. No installed app, personal data/model/Hub or original source repository was changed.


HTTPX closure: is_closed is not proof of released resources. The owned wrapper snapshots actual default/proxy transports and HTTPcore connections before a pool can consume its list, then checkpoints each physical close. Tests cover a real SDK twin poisoned by early HTTPX CLOSED, two failing OFFs, a held third close with consumer cancellation, and an actual HTTPcore/HTTP11 pool path. SDK files remain unchanged.

CAS6 corrects repeated completed physical cleanup: after success, a connection is removed by identity from its pool under the pool lock; failed connections stay owned. The final transport close does not invoke completed connection closes again. CAS5 remains historical; final package/test evidence is recorded separately in tasks/submission931-cas6.md.

## Local world-authoring tool context (2026-10-21)

Use [WORLD_AUTHORING](docs/WORLD_AUTHORING.md) for current capabilities and limits;
this extension preserves the native publishing factories and their lifecycle
above. UI and MCP reuse scoped product operations. Read the current project,
document and optional era before writing; omitting `eraId` means Shared base.
Do not infer a pane's scope from another open pane, guess revisions after a
conflict, or overwrite an author's unsaved draft to make a retry succeed.

Maps: read before writing. `wh_get_world_presentation` and
`wh_get_world_travel_settings` return revisions to pass as `expectedRevision`;
`wh_list_labels`, `wh_list_stamps` and `wh_list_map_versions` return the keys and
ids that `wh_update_label`, `wh_move_place`/`wh_rename_place`/`wh_remove_place`
and `wh_link_map_version` take. A painted label or stamp key is where it was
first placed (`label:x,y`, `stamp:x,y`, with `#n` for a second one in the same
cell), never its current position. The reader's-eye fog is separate from the
world: paint it with `wh_paint_reader_fog` (seen/heard/hide, optional chapter),
check what the reader knows with `wh_reader_view` before describing a place as
known, and render it with `wh_render_world_map` `readerView`/`readerChapter`. Story
events (`wh_list_story_events`, `knownByChapter`) say what happened where and
when, in which order inside a chapter and who was there (`who` Codex ids, `whoNames`), and `wh_story_chapters` gives the story chapter by chapter with how much
of the map the reader knows by each; read them before describing what a character could know, and keep
planned events apart from happened ones. For trade, famine or prices in a
scene, ask `wh_world_economy` for that month and settlement instead of
inventing figures; it is deterministic for the world. To add a river that
follows the ground, use `wh_add_spring_river` from its source (`dryRun` first
to see where it ends) instead of drawing one by hand; when a story lives on one island or one country, create the world with `wh_create_world` preset `island`, `country` or `continent` (and `landmassKm` for another size) instead of carving it out of a planet; when the story says a ford washed out or a bridge fell, close that crossing with `wh_set_river_crossing` (`blocked: false` opens it again) and let `wh_plan_journey` find the way round (it reports `fords`, `bridges` and `frozenRivers`); to change the ground of an area (a fungal forest, an ash plain) use `wh_paint_biome` and check it with `wh_place_at`'s `ground`; to tell a journey in a scene, use `wh_plan_journey`'s `passes`, `roads`, `clock` (set `setOffHour` when the text says when they leave) and each night's `shelter` rather than inventing towns, roads or hours; to show the whole world in 3D as a tabletop model or as a landscape set `stage3D` (maqueta/paisaje) with `wh_set_world_presentation`, and `skin3D: "pintado"` for a hand-painted relief map; on a classic map, `wh_set_map_layers` shows pins as their entries' portraits and every pin name; move the sea level or snowline with `wh_set_world_levels` only when the author
asks; to name a region, sea, range or town label, offer names from `wh_roll_name` (in the world's own languages, at the spot when you have one) instead of inventing them; for a lake use `wh_add_lake` (`dryRun` first,
`size` only when the author gives one) and `wh_drain_lake` to remove one; a place marked `locked: true` is
the author's to move: do not unlock it with `wh_lock_place` unless asked; copy a
town with `wh_duplicate_place`; to lay a road between two
places use `wh_add_world_road` (`dryRun` first; `width`, `pattern` only when
the author asks for a look). For a story set on one island or country, keep the land on its own sheet (the default for those presets; `worldKm` only when the author gives a size); name regions the author describes with `wh_add_zone`; change relief with `wh_shape_terrain` (`volcano`, `height` with `heightM`) and rivers with `wh_draw_river` / `wh_reverse_river` only when asked. Use the world's own ways (`profile.ways`, `wh_plan_journey way`) for how a party travels, `wh_render_world_map hour` to see a scene's light, and link a story event to its chapter (`writingId`). On a classic (image) map,
positions are percent of the picture: list shapes with `wh_list_map_features`
before changing one, leave a comment about a spot with `wh_annotate` `at`, and
before replacing the picture call `wh_preview_map_ground`; only use `fit:
"stretch"` in `wh_change_map_ground` when the author wants shapes stretched.
For distances or travel times on a classic map use `wh_measure_map` (it needs
the map's scale; set one with `wh_set_map_scale` only when the author gives
it), and name lettered pins from a key with `wh_name_map_pins_from_key`
(`dryRun` first).

Writing (wave C): read before writing here too. To put a rules box in a
chapter, call `wh_codex_rules_card` without `writingId` first to see which
slots it filled and which it left empty, and fix the mapping with `slots`
rather than inventing values for empty ones. `wh_extract_block_to_card` moves a
block: list the blocks with `list: true` and pass `expectText`. Use
`wh_text_effect` only when the author asks for an effect; effects are for the
screen and print plain. Dates: in a calendar with a leap month, a date in that
month exists only in leap years; ask `wh_world_date` instead of computing it,
and with a Gregorian correlation use its `earth`/`earthDate`. Change a
calendar with `wh_world_calendar_set` without `redate` first: it refuses a
calendar that would strand events and says which; `redate: true` moves them to
the nearest date that exists (undoable). In sheets,
inserting or removing rows and columns moves formula references; a reference to
a removed cell reads `#REF!`. Book layout belongs to the publishing profile
(`bookStyle`), not to the chapters' HTML.

Tabletop (wave D1): rules facts come from the bundled SRD 5.2 compendium
(`wh_compendium_search`/`get`), not from memory; add an entry to the world only
when asked. Run fights through `wh_encounter_action` with the revision read last.
Roll with `wh_dice_roll` instead of inventing results, and say natural 20s and 1s
as they came. Offer names from `wh_name_generate` (with the author's brief) and
make a card only on request. Tasks and boards (`wh_todo_*`, `wh_kanban`) are the
author's: add or change them when asked. In sheets, formulas may use Spanish or
English function names; an Excel import says what it did not keep.

For Library creation, read `wh_workspace_library_get`, then pass `folderId` and
`expectedLibraryRevision` to `wh_create_codex_entry`. An empty folder ID means
Unfiled; omitting placement options keeps ordinary card creation. A conflict
requires a fresh read and explicit review, not an unfiled fallback.

The `wh_writing_tool_dock_*` family reads/applies layout and block operations and
Undo/Redo with observed versions and receipts. Its owner is the real Project or
chapter; the dock is authoring metadata, not manuscript or exported reader prose.
`wh_project_duplicate_preview` returns the source version and asset findings.
`wh_project_duplicate` needs that version and a stable caller operation ID;
reuse it after interruption and inspect `complete`/`unfinished` rather than
creating another destination. `wh_project_duplicate_undo` preserves edited copies
and shared originals. It does not upgrade legacy JSON clone coverage.

Local source tools execute trusted built React code, not downloaded arbitrary
JavaScript. Recognition/search needs prepared cached models; text generation
uses the configured global runtime. Neither these tools nor this documentation
activates a module or model. The 21 October composed source checks pass: 210 groups across 44 suites with
0 failures, 383 critical checks, renderer/Electron builds, shipping lint with
0 debt and conformance (34 engines, 64 tables, 5650 keys, 22 locale files).
The production entry is 1589.09 kB, below the blocking 1600 kB budget; lazy/total
size advisories remain. Production dependency audit reports 0 vulnerabilities.
Native document-service tests pass 14 with 0 skipped; directory packaging,
packaged startup smoke and CPU dependency checks pass. D3, W01, the bounded 5e
profile, map M1/M2/M3 corrections, Archive and legacy-tool corrections have
independent SHIP verdicts within their reviewed contracts.

These are composed checks, not a global `verify:release` result. The inherited
full development audit still reports 13 findings, and the optional `resources/bin`
packaging warning remains. QA, manual and repository documentation are complete;
Git integration remains pending.
Installation, the real user profile and total feature parity are not certified.

Composed evidence: `D:/LocalAI/projectlesswork/worldcraft1041-vvd-suite-corrected-final.log`
and `worldcraft1041-critical-final-composed.log`; build, budget, packaging and
audit logs are alongside them. CPU checks load packaged dependencies without
model inference, model downloads or GPU activation.

The manual update used requiredRevisionId and exact content readback; see
`tasks/evidence/worldcraft1041-manual-verification.json` and the remaining limits
in [final verification](tasks/worldcraft1041-final-verification.md).

## Session and picture-map preparation (2026-10-23)

The outline planner groups table sessions by prep/next/live/played and exposes
revision-checked status/date/note operations. Check, encounter and handout blocks
use the same editor, gallery and combat operations as the UI. Comments expose
read state and positioned pins on boards and maps. Picture-map exploration is
a visual mask; the exported asset still contains the complete picture. Wiki
map navigation, artwork and audio are opt-in. Named MCP keys support independent
revocation while preserving the existing Principal token. See
[tasks/vvd1095/verification-D345.md](tasks/vvd1095/verification-D345.md) and the
D2/Bmatrices for proof, scope and remaining gaps.


## Writer1095 continuation — offline preparation
Source extends named wiki profiles with10additional page kinds, explicit/bulk/nested curation and immutable captured source policy. Home adds real monthly document counts, normal-operation quick creation and contextual guidance. Native fiction uses a companion preparation table, original19contracts intact,3additive tools, attendance/manual recap and explicit retired status; private notes stay out of default agent/context/recap. Library context bookmarks use CAS Undo/session opens;4appearance effects obey motion/performance. See docs/OFFLINE-PREPARATION.md and tasks/vvd1095/verification-next.md for exact tests and narrower gaps. Existing installed executables/profiles are not updated by source integration.


## Textos propios de las herramientas

Las herramientas fuente pueden declarar sus catálogos y usar `useLocalToolT(client)` para etiquetas, interpolación, plurales y formatos Intl. Cambiar el idioma normal de la aplicación conserva las notas escritas; el ejemplo Libreta traducida permite edición Source y Propio con guardado explícito. Guarda una tarjeta nueva del Códex antes de insertar su bloque propio y guarda después el hijo y el documento padre por separado. Es una ampliación offline acotada del SDK; [evidencia, estado de entrega y límites](tasks/vvd1095/verification-sdk-locale.md) separan comprobación técnica e integración.

## Preferencias compartidas de herramientas locales

El SDK opcional `client.defaults` y `useLocalToolDefaults` separa preferencias JSON por mundo/herramienta/clave del estado de los documentos. `wh_local_tool_default_get` consulta y `wh_local_tool_default_update` ejecuta set/undo/redo con snapshots y recibos propios. Base y épocas comparten el dato mundial, manteniendo las comprobaciones de contexto. Cuaderno de iconos distingue Guardar favorito de Usar favorito; las notas se guardan aparte. Ausencia y null son distintos; conflictos conservan propuesta y permiten recarga/reintento explícitos. [Pruebas, entrega y límites](tasks/vvd1095/verification-sdk-defaults.md). No certifica Owned/WorldPick, runtime upstream, instalación fría o paridad global.

## Tema resuelto de herramientas locales

`client.theme?` y `useLocalToolTheme` leen nueve colores y el modo efectivo por proyecto/época; `wh_workspace_appearance_get` añade `resolved:{mode,tokens}` a su respuesta existente. No son nuevos escritores. El modo sigue el contraste real del fondo, que puede diferir del modo solicitado. El icono Canvas del espacio normal se invalida junto al commit que aplica el estilo de su propio panel; una lectura de datos anticipada no certifica que ese CSS ya esté aplicado. Borradores y color explícito se conservan. [Pruebas, estado y límites](tasks/vvd1095/verification-sdk-theme.md). Las colecciones de mundo ya disponían de lectores y avisos vivos; este contraste no añade un catálogo paralelo ni certifica paridad global.

## Presentación persistente de animaciones de modelos

El visor 3D permite guardar etiquetas y ordenar todos los clips originales sin reescribir el modelo ni sus archivos fuente. `wh_model_animation_get` devuelve índices de origen, nombres, etiquetas, orden y versión sin binarios; `wh_model_animation_action` renombra, mueve por posición o restablece con la versión observada. Base/época, conflicto conservador y Deshacer normal comparten el writer de la interfaz. Reader/wiki y vistas compactas usan esa presentación sin editor. No hay una nueva herramienta `wh_undo`: el transporte nativo conserva su Undo HTTP habitual mediante audit_index. La fuente31c5598664c4f4de14880ae71d65c45530cc78f7 está aprobada exactamente por CAS47 e integrada en Main con cuatro focos PASS, incluido Native con dos claves. ManualGoogle+329UTF16 y continuidad común están verificados, con sus bloqueos liberados. El commit/FF documental separado se acredita en ROOT-delivery-final.json; no se atribuye paridad global ni edición de rigs/eliminación de clips. [Uso, contrato y estado de entrega](tasks/vvd1095/verification-model-animation-presentation.md).


## Filas, vínculos, intensidad y concentración

Tablas y hojas ofrecen Insertar fila encima, Subir/Bajar y asa de puntero, con IDs/celdas conservados y Deshacer normal. Ordenar/agrupar sigue separado del orden manual; las vistas vivas del Códex mantienen su alcance previo. El inspector de lugar reutiliza el buscador normal de fichas por título o alias y conserva los enlaces a escenas/escritos/sucesos. Zonas añade intensidad0–100; cero conserva zona y rótulo.

Source y editor antiguo reciben `context.focusMode` opcional y hook de concentración: chrome oculto/inert pero montado, borradores/clientes retenidos y salida explícita/Escape; Pantalla completa independiente. MCP get/set usa hosts reales, sin guardado implícito y con IDs efímeros. Catálogo949. Fuente a8e9ba6+a55e6e aprobada exactamente CAS49 e integrada por FF; Main manifest949/contratos6/Nativefoco2claves pasan. Gates ROOT quick/build/crítica396 y pruebas reales Brave tienen recibos separados. [Contrato y atribución](tasks/vvd1095/verification-rows-places-zones-focus.md). 1095 y paridad general siguen abiertos; sin push.

## Viajes desde lugares y decisiones duraderas de candidatos — corte1095

El inspector Worldgen fija origen o destino desde el lugar efectivo; la selección normal completa el otro extremo y el guardado del itinerario usa el flujo existente. `wh_plan_journey` conserva su función de lectura. El lector común hace efectivo un projectId explícito en Base, sin exigirlo cuando se omite y manteniendo primero la guarda histórica de conversación. La regresión final independiente cubre13casos; Native final3 usa dos claves y el perfil LVXQWp, no la ejecución anterior2.

`wh_entity_candidate_dismissals` consulta decisiones y `wh_entity_candidate_dismissal_action` descarta, recupera o deshace con la identidad estructural del propietario/época/borrador y CAS por clave. Administran metadatos y funcionan también con Códex apagado; las herramientas históricas de detectar/crear conservan su guarda. Los receipts de Undo son de sesión. No se promete ABA universal tras volver a ausencia con versión vacía. La prosa, aliases y fechas del documento no se reescriben por descartar. JSON/ZIP y Duplicate transportan/remapean la metadata; las salidas de lectura la omiten.

Native YNArl3 acredita68llamadas de tool/72RPC/68IPC con dos claves reales; no inferencia positiva. Los spans controlados del editor tampoco son un modelo. Three C01–C07 prueba la capacidad existente del autor Source con imports dinámicos y loaders; no añade tools binarias, fachada upstream o instalación runtime de paquetes. [Evidencia, límites y estado](tasks/vvd1095/verification-directions-dismissals-three.md). Fuente45 comprometida47d448bfac8d8441f07943d4c032aca1ad674e3d; CAS50 approve exacto y FF verificado en Main47d448bf; Main verificado y manual actualizado; documentación final/continuidad comunes conservan sus recibos separados. Browser frío del descarte ya está acreditado con inferencia controlada; la conexión del nuevo runtime NER real y su prueba de modelo permanecen separadas y pendientes. Paridad1095 abierta.

## Clasificador Browser y viewport de Timeline — fuente07d868d

UI y puente usan el selector común del detector: conserva la API Electron cuando existe y usa Worker Browser CPU/WASM cuando falta. `wh_entity_detection_status` lee preparación sin cargar modelo; `wh_entity_detection_prepare` prepara los assets fijados y `wh_entity_detect` devuelve spans UTF-16 exactos, excluyendo nombres/alias y decisiones duraderas del ámbito actual. `jobId` identifica prepare/detect antes de iniciarlos; `wh_entity_detection_cancel` cancela sólo ese trabajo Browser, activo o en cola. Un Desktop sin cancelación real responde supported:false. Crear ficha sigue siendo explícito y crea título/tipo con prosa/campos vacíos.

`wh_timeline_view_get` enumera hosts SwimLane montados y visibles del proyecto/época exactos. `wh_timeline_view_fit` usa su hostId efímero e invoca el mismo Fit que la interfaz, sin persistir cámara ni editar documentos. Host ausente, oculto o revocado no se encola. El cliente SDK público lo alcanza por tools/callTool existentes; su prueba conserva un borrador React independiente y no acredita SourceToolDocumentHost.

NER real ya tiene inferencia CPU/WASM y dos claves16tools/20RPC/18IPC con2Undo HTTP reales. El primer Native Timeline16/20/16 es histórico anterior al clamp; el formal frescoJj9Qlr y MainV7ztgv repiten16/20/16 sobre la fuente final, conservando formulario/datos y cleanup0. [Fuente, atribución, Browser real y límites](tasks/vvd1095/verification-browser-ner-timeline.md). Fuente41rutas07d868d8982ca46f4e1a192f20a4688db60155d8 aprobada exactamente en CAS51 e integrada por FF verificado en Main; manifest954/queries/synthetic/NativeTimeline pasan. El manual51 ya tiene recibo verificado; commit documental y continuidad se consultan en los registros separados ROOT-delivery51.json/ROOT-continuity51.json, según su emisión. No se declara paridad general.

## C41: frente editorial capturado y jacket físico — fuente congelada 52

`includeCover` opt-in usa el frente real 1200×1800 del renderer existente antes de título/capítulos en HTML/EPUB/DOCX y el PDF nativo derivado de HTML. Es independiente de Reader.showAtStart. Preparación asíncrona captura datos/etiquetas/reloj antes de await y mantiene compatible el compositor síncrono; los writers consumen el IR congelado sin consultar DB. MCP set/list de perfiles incorpora el flag y Undo normal; compile añade complete y HTML con portada completo automáticamente, preservando el modo previo de 200k explícitamente truncado.

`wh_reader_cover_export` conserva PNG/SVG canónicos y añade spread físico PDF/PNG/JPEG mediante printLayout y dpi opcional (300 por defecto). Comparte captura/render con el diseñador, no guarda el draft y devuelve archivo completo con dimensiones/densidad/cajas. El PDF es un pliego RGB de una hoja; no acredita PDF/X, CMYK, imprenta, texto vectorial ni PDF de libro Browser/batch C42. [Verificación por formato, fuente 40 y estado](tasks/vvd1095/verification-cover-exports.md). Front Brave frío está acreditado. Print Brave acredita recarga real con 77 tablas RAW exactas y limpieza propia a 0; las acciones PDF/PNG no confirman bytes descargados de Browser. Fuente fc3ed49d82807e8c14b394391fb5b24dfc9af1de tiene aprobación exacta CAS52 y está integrada en Main con verificación focal. Los flujos C41 acotados están entregados; paridad 1095 abierta.

## Escala física de una hoja existente — A1-039 fase1

WorldView añade Escala de este mapa: ancho físico, alto/celda derivados y Aplicar/Cancelar/Restablecer/Deshacer, separados del formulario generativo. `mapWidthKm` y `scaleRevision` son metadatos del mundo, no cambios en params, semilla o arrays. El writer común drena ediciones/regiones pendientes, vuelve a resolver el dueño y fusiona sólo escala/revisión/updatedAt con CAS. Era heredada escribe Base; variante propia escribe su documento. Undo conserva otros campos y rechaza una calibración posterior o un propietario archivado.

`wh_get_world_scale` y `wh_set_world_scale` exponen el mismo contrato normal. El getter no genera terreno; setter acepta ancho positivo finito representable y null para recuperar la receta, con expectedRevision del getter. Medidas, rutas y áreas leen la escala efectiva; el canon y el ruido conservan la receta original. El objeto runtime y sus buffers no se sustituyen por calibrar. JSON/ZIP/Duplicar conservan la escala, incluidas variantes y ausencia tras Reset.

La fuente42 bbf18aff3f1521cf9ea4b71bbe97529638c131ef tiene aprobación exacta CAS53 y entrega Main verificada, con catálogo956 y transporte Native propio de dos claves. Los recibos de documentación/manual/comunes permanecen separados. [Contrato, Browser, Native, frío y límites](tasks/vvd1095/verification-world-scale.md). Una miniatura automática anterior puede materializar una variante al abrir una era; no se atribuye al writer de escala. Rectángulos/grow/crop/anclajes y paridad1095 siguen abiertos.

## C42: PDF de libro Browser y preparación multiformato

Writer prepara Markdown, HTML, EPUB, DOCX, PDF de libro seleccionable/buscable y PDF de cubierta física desde una captura de sólo lectura del manuscrito y época efectivos. La UI conserva resultados por formato, cancelar y reintentar pendientes sobre esa misma copia; descargar uno o los listos en ZIP requiere una acción explícita. Preparar no guarda el borrador. Los márgenes físicos enfrentados y el número inicial son opcionales para PDF/Word; el EPUB no adquiere paginación fija.

MCP añade `wh_publishing_export` y `wh_publishing_cancel_export`: una llamada devuelve archivos completos por salida, y otra detiene sólo el operación activo del mismo proyecto. Cada llamada nueva de exportación recaptura datos persistidos; no recupera la copia privada de la UI. El catálogo observado tiene 958 herramientas, sin atribuir sus transportes a todas ellas. [Contrato, pruebas por corte y estado de entrega](tasks/vvd1095/verification-publishing-batch.md). No se afirma descarga ZIP en disco de Brave, diálogo de guardado Native probado ni paridad general.

La fuente `2e54a2d476c31b49cea48a56cb5c4582c9d38114` tiene aprobación exacta CAS54 y está integrada en Main con comprobaciones focales propias. El manual ya está actualizado y verificado en ROOT-manual54-receipt.json; commit documental y continuidad se acreditan por sus recibos separados, sin anticiparlos aquí.


## Entrega56: rótulos y consumidores finitos

El inspector normal de rótulos pintados de Worldgen añade negrita, cursiva, mayúsculas de dibujo, tinta y familia del catálogo existente, con herencia individual y reset conjunto reversible. Los cinco overrides conservan false explícito, grafía Unicode, preset, forma e identidad; el reset elimina sólo formato. Atlas, Carta y los dos modos3D consumen esos atributos. Las tres tools de rótulos existentes exponen los mismos campos/null, sin otro servicio o writer. [Contrato, uso y evidencia](tasks/vvd1095/verification-lettering.md).

Se verificaron Base/épocas, Undo real, JSON/Duplicate/ZIP y recorte/ampliación conservando atributos y todos los bytes de los14 buffers solapados del caso caliente. Native propio e independiente usan dos claves reales y los mismos cuatro grupos; Root observó los cinco valores tras recarga Brave, reset/Undo, preservación al cambiar preset y dibujo Satélite/Pintado. No son certificaciones de todos los archivos de fuentes, plataformas o píxeles3D.

El consumidor separado renderCartography de dots/trail y las copias finitas de sucesos tienen ahora RED/GREEN causales propios. Las familias públicas de coordenadas/road tienen cobertura acotada y errores exteriores antes de redondear. [La adenda de dominio](tasks/vvd1095/verification-world-domain.md) separa autorías, capas y controles legacy. No presentar estos resultados como prueba universal de todos los consumidores cartográficos.

Corte r6:111Source/142code, fuente comprometida `4f463f9abc4e0d6989a8d1b10e02033d7e3fa4da`. Root quick227919ms,396críticas157760ms y build370224ms pasaron con código y guardas ajenas exactos; aprobación exacta CAS56 y FFMain ya verificados(23blobs/disco exactos,48no rastreados conservados, índice limpio, sin push). La documentación de56 acompaña esta entrega; la continuidad común tiene recibo separado. El manual ya está actualizado y verificado. La entrega55 y sus recibos anteriores siguen históricos y literales.1095 continúa abierta; quedan los demás residuos del ledger y no hay descarga web a disco confirmada ni terreno frío RAW lossless.

Los nueve fallos ABS reservados para57 se conservan aparte: dos keys de AddPlace/Duplicate y siete criterios de Story (listado local, prosa y reorder), con16criterios/9fallos y controles legacy/Undo sanos. El parche57 sigue su propia verificación y no forma parte del commit56; no se deduce paridad global de los gates56. [Causa57](_stage/parity-map-domain-next/independent-source-abs-r1/CAUSAL-RED1.md).

[Recibo Main56](_stage/parity-map-domain-next/ROOT-main56-FF-r1.json) y [revisión formal56](_stage/parity-map-domain-next/INDEPENDENT-FORMAL56-REVIEW-R1.md), con recusaciones por autoría central/Road explícitas.

Root actualizó el manual una vez:90→638UTF16, delta548 en113268/t.0; recurso completo exacto salvo revisión, con otros textos/estilos/tabs/metadatos intactos. Cinco alias liberados. [Recibo manual56](_stage/parity-map-domain-next/ROOT-manual56-receipt-r1.json). La continuidad común conserva su recibo separado.


## Entrega57: identidades y sucesos de hojas finitas

La entrega corrige la clave devuelta por `wh_add_place`/`wh_duplicate_place`: coincide con la identidad ABS de los listados, manteniendo x/y públicos locales. Story lista centros locales y las actualizaciones de prosa y orden conservan posiciones durables, IDs y texto de ambos hermanos. El lector de landmarks deriva canonical/alias histórico desde el origen ABS sin desplazar sus coordenadas locales; label/stamp conservan la segunda marca#2.

[Uso, causalidad y límites](tasks/vvd1095/verification-source-abs.md):16criterios originales GREEN,69comprobaciones de cuatro familias y Native independiente de dos claves20criterios/32tools/36RPC/16Undo/48IPC. La regresión pura añadida26aserciones usa fixture explícita en la rama generada y helpers normales de adopción, alias/precedencia/move/style/remove y dos bounds; el prefijo legacy6324B es literal. No acredita generación procedural.

Gates finales Root quick220674ms/397críticas152033ms/build456009ms PASS sobre112Source/146code. Fuente `a91027f3dc54864fc91c17d92d6dc23b2290f342`, aprobación exacta CAS57 y FFMain verificado:7blobs/disco exactos,48untracked preservados,índice limpio,sin push. Los gates143 anteriores siguen históricos. Sin migración de claves locales ambiguas ni reparación automática de posiciones antiguas ya dobladas. El nombre visible por defecto de landmark pintado (`Volcán`) sigue como residuo separado. Fog/zones13fallos medidos y wrap3 quedan para58; Paper cut requiere contraste funcional adicional.1095 sigue abierta; frío y descargas conservan sus límites previos.

## Entrega58: zonas y niebla de capítulos en hojas finitas

Los controles normales de zonas y niebla trabajan sobre la hoja actual sin sumar dos veces su origen. Renombrar una zona conserva el polígono; el área usa la escala física vigente. Una zona ancha mantiene su forma y el pincel de un borde no revela el opuesto. Mapa y Carta dibujan una sola copia en hojas finitas; los mapas cilíndricos conservan su comportamiento anterior. Las mismas operaciones siguen disponibles por las herramientas MCP existentes.

[Verificación58 y límites](tasks/vvd1095/verification-fog-zones.md). Root observó en Brave creación y cambio de nombre de zona, contorno y nombre en Mapa/Carta, y una franja visible de niebla del capítulo3. Root confirmó la reapertura en frío por UI; tres Undo normales tras frío restauraron las nueve ediciones previas. Fuente `08c8e0cd9af53651831d246957fbd809b1688879`, aprobada exactamente en CAS58 e integrada en Main. No se acredita aquí PNG público, routeReveal, otras proyecciones, eras ni portables. Paper cut y los demás residuos de escritura/SDK continúan;1095 sigue abierta. El manual56 conserva su recibo anterior, sin otra modificación atribuida a58.


## Corte59 preparado: paquetes locales runtime

El gestor normal de versiones permite inspeccionar e instalar un archivo con una app y sus herramientas documentales sin reconstruir Writer. El inventario es global; instalar no activa motores ni elige versiones del proyecto. Aplicar versión, actualizar y volver a una anterior reutilizan pins/CAS, Source y sus documentos. Exportar devuelve el archivo completo. El CLI existente produce el formato runtime propio y conserva Source/1 separado. [Uso, API y verificación atribuida](tasks/vvd1095/verification-sdk-runtime-packages.md).

Se verificaron hooks/Host/Surface y activo Unicode reales, Native con dos claves (30tools/34RPC/29IPC), carga fría dev en proceso nuevo, v2/rollback/aislamiento P-Q y conservación del borrador Tiptap hasta Discard con el cliente anterior revocado. Brave normal acredita selector, inventario tras recarga, Save/Undo/reapertura del documento y Host de app; no Surface con hijo ni archivo descargado. Los cuatro proyectos QA de Browser y el inventario de prueba se conservan intencionadamente.

Estado r4:137Source/191code/45rutas propias, quick153910ms PASS. Crítica397 PASS142311ms corresponde a r2, anterior a dos ajustes de tipos y dos comentarios del Panel. Build r4 PASS392221ms y producción/CSP fría Root PASS38tools/46RPC/37IPC/2402inputs exactos/89tablas0, cuatro EOF y revocaciones401/cierre. Se usaron index/CSP sin transformación y49recursos dist exactos/MIME/0fallos; sólo GSI opcional suprimido y registrado. Es renderer privado de producción, no Main instalada. Commit `d4fad2377926191a17320bee8277d347800852ac`,45rutas RAW exactas, autor Luissalet. CAS59 aprobado por codex-rt59rev sobre el commit exacto e integrado FF en Main, con mergelease/HEAD fresco,48untracked preservados e índice limpio, sin push. El informe formal independiente conserva sus pruebas propias y sus límites. Trial, uso/errorfeed (60/61 sólo Stage), hosting/CRDT y paridad1095 siguen abiertos.

Adenda posterior a58: el MCP público de dos claves exportó14PNG completos (2339547B,14,890s), con firma/CRC y doble decodificación, zona finita ancha y niebla por capítulo local correctas. Cuatro Undo restauraron journal/14grids/meta y RGBA;88tablas privadas0/3Workers terminados. [Evidencia independiente](_stage/parity-map-png-next/PNG2-REVIEW-R2.md). Actualiza el hueco de evidencia PNG del checkpoint58; no reescribe sus primeros gates ni demuestra Browser, eras/portables o todas las proyecciones. R1 fue fallo de observación de una celda dentro del pincel, no RED de producto.


## Entrega60: Probar, Conservar, Descartar y Uso

El gestor de paquetes instalados permite Probar en un proyecto normal nuevo con versiones explícitas. La franja Conservar quita sólo el marcador de prueba: mantiene ruta, IDs, pins, datos guardados y borrador/editor real. Descartar resuelve escrituras mediante sus controles normales y borra sólo el proyecto marcado; un pendiente no resuelto conserva el proyecto y muestra el conflicto. El paquete global y los proyectos hermanos permanecen. No otro writer ni inventario.

Uso consulta sólo datos guardados y pins actuales por namespace, incluyendo motores deshabilitados y cinco procedencias: estado legado, estado propio de época, documento, variante de época y archivo. Una fila heredada no se cuenta otra vez por cada época; no se cuentan montajes ni histories como instancias. [Cuatro tools, uso y pruebas](tasks/vvd1095/verification-sdk-runtime-trials.md).

Root verificó Native con dos claves y dos PID:38tools/44RPC/38IPC,2174inputs exactos/89tablas0/4EOF y revocaciones401sinIPC/cierre. Se conservan RED y errores de observación anteriores; el área restante suma9PASS con runner correcto, no una consola global limpia. Browser Root acredita una prueba conservada con texto guardado/frío y otra con marcador frío, cancelar Descartar y confirmar borrado→Inicio; paquete instalado. UsoUI Browser mostró tres documentos retenidos y no el descartado; su enlace abrió el editor Unicode y cerró el gestor. Root contrastó desktop/390 con diálogo358px y sin overflow local. Finish independiente SHIP acotado; detector estático=[] sobre dos componentes, no UIglobal.

Corte r3 SHA5946164825cf02003a27f9630b1e02573db35b553d6bf3db8f310c2de7978d27,26rutas propias/148Source/204code, sobre59/documentos ya integrados. Quick final r3 PASS133786ms/204code y foreign exactos. Build final r3 PASS320405ms; fuente9c9c7c4e65c968280da40894da28ac621a184f94 aprobada CAS60 exacta e integrada FF en Main con mergelease/HEAD fresco,26RAW exactos,48untracked preservados/índice limpio, sin push. Revisión independiente preparatoria finalR3 positiva: shipping3PASS y Native38tools/44RPC/38IPC,2174inputs wrapper/2173porhijo/89tablas0/EOF401cierre; aprobación formal posterior CAS60 exacta. Crítica399r1 corresponde a20core antes de handoff UI y actualizaciones de tests; no gate final. Errorfeed61/hosting/CRDT y los demás residuos continúan. PNG58 y runtime59 permanecen literales, sin heredar sus gates a60 ni cerrar1095.


## Entrega61: errores de paquetes locales durante la sesión

UI y MCP comparten historial efímero por identidad verificada/fase/montaje/operación, tipo/count y texto fijo del host. Consulta readonly/clear no evalúan código ni cambian DB/pins/disponibilidad; clear no significa reparación. Fallo de un hijo conserva el Rich vecino; Retry agrupa y recupera. Operación autoral fallida conserva rollback; Source compilado se excluye. F1 corregido: el error sigue al componente realmente retenido, manteniendo autoridad/readonly del pin actual.

Fuente23cf590c113ffe892702152eec0bce11b9c57cd6,17RAW exactos, aprobación CAS61 exacta e integración FF Main con mergelease/HEAD fresco,48untracked preservados/índice limpio/sin push. Quick133502ms/crítica399 141224ms/build502485ms PASS sobre152Source/213code r1/f0b4e522. Corte finalr2/ab251935 retira sólo un LF vacío final de fixture de test:152Source/otros212code y JavaScript emitido exactos, según ROOT-eof61-r1.json. Gates y casos previos se atribuyen al r1, sin repetir pruebas/build por ese formato. [Uso/evidencia](tasks/vvd1095/verification-sdk-runtime-errors.md). Browser Brave normal desktop/390 confirma historial/clear y copia C1, paquete anterior y documento Unicode preservados. Manual actualizado con CAS y readback; Native/área/Browser conservan sus propios cortes. Convergencia/CRDT, prosa por carácter/carets, defaults aditivos, presencia, Host/world-query completo, distribución/hosting y todos los demás residuos del ledger siguen abiertos. Debate1772 fija direcciónA, sin biblioteca ni implementación elegida al entregar61. Sólo suboperaciones de API externa/pago demostradas quedan excluidas; ONLINE no es una exclusión. Sin porcentaje, done1095 ni nuevo asunto de Luis en PENDIENTES.


## Source62: intercambio causal local, integrada

Documentos Source con activación explícita, réplicas independientes scalar/map/listas estables y formatos propios de checkpoint/update. Se mantienen CAS, Save y Undo/Redo autoral; data/checkpoint/conflicto se guardan atómicamente en el writer existente. Pending persiste al reabrir; eras heredadas y cambios de contrato bifurcan historias con retención completa en History. Restore misma identidad conserva causalidad; remap de nueva identidad crea génesis independiente. No hay otro writer, DB, transporte automático ni prosa por carácter. [API y atribución](tasks/vvd1095/verification-sdk-convergence.md).

Root acredita persistencia7trazas/4295inputs y Native frío dos claves/PIDs243632→246772:22+9tools/26+13RPC/22+9IPC,2152inputs exactos, cuatro EOF0/pending0/stderr0/revoke401sinIPC/cierre. Prepare conserva datos/pending; sólo resume mide89tablas0. UI real Source/Tiptap/CSS pasa8grupos en1280 y8en390, con cleanup propio por viewport; el wrapper inicial falló al cambiar de viewport y390 se reanudó separadamente. Brave verifica activación/Save/Undo/frío e inválido/recovery, sin importación positiva ni descarga a disco confirmadas.

Fuente `603a3c991f82367e537a38965aebb77775720692` aprobada CAS62 e integrada Main:40 rutas exactas,48 archivos no rastreados conservados, índice limpio, sin push. Manual nativo actualizado con escritura CAS y lectura completa posterior. La ruta permanente offline UI pasa16 grupos,8a1280 y8a390, con89 tablas vacías por viewport; el arranque anterior detenido conserva su resultado separado. Siguen abiertos prosa por caracteres, presencia, defaults aditivos, Host/query completo, hosting y el resto de1095. No se afirma producción/Main instalada ni descarga Browser a disco.

Quickr3/buildr2 incluyen seis hunks finales del control de exportación; crítica399/buildr1 son anteriores. Buildr2 precede la corrección exclusiva del author-kit; contracts-r3 y tipos finales0 cubren ésta. Trece EOL se normalizaron con emisión esbuild idéntica; sólo se retiraron dos LF terminales redundantes del aviso MIT después. No se atribuyen los gates previos a todos los RAW posteriores como una única ejecución. Las tres ventanas runtime solapadas de receipts siguen sin acreditarse, sin defecto Source confirmado. [Verificación y límites](tasks/vvd1095/verification-sdk-convergence.md).
