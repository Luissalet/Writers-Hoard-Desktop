## Estado vigente — 11 de noviembre de 2026

Esta cabecera distingue las entregas acreditadas del historial inferior. No es una nueva ejecución de todo el inventario ni un porcentaje de paridad. Los antiguos «pendiente», checks sin marcar o «1095 abierta» describen sus respectivos cortes: antes de convertirlos en trabajo nuevo se consulta la verificación posterior correspondiente. El bloque HISTORIAL conserva íntegros los bytes anteriores.

| Capacidad posterior acreditada | Contrato y evidencia | Límite que se conserva |
| --- | --- | --- |
| Filas/columnas compartidas por ID y ancho de columna | [Ejes 2047](../../docs/local-tool-sdk.md#collaborative-row-and-column-editing-2047), [anchos 2082](../../docs/local-tool-sdk.md#shared-table-column-widths-2082) | No equivale a cerrar toda la tabla, schema general o adopción arbitraria. |
| Campo escalar y map vacío añadidos a Source | [Escalar 2088](../../docs/local-tool-sdk.md#add-a-scalar-or-map-field-to-an-existing-source-document), [map 2455](verification-sdk-source-map-additive2455.md) | Declaraciones propias y evolución acotada; no schema persistente arbitrario ni migración general. |
| Lista vacía añadida a Source (2540) | [Contrato y evidencia acotados](verification-sdk-source-list-additive2540.md) | Source `38db3169` aprobado CAS r3 e integrado en Main; Native warm/cold acreditado. Sin migración general ni cambio de tipos. |
| Abrir un bloque Source al lado (2590) | [Uso y verificación](verification-sdk-source-block-focus2590.md) | Vista del mismo documento en un espacio de trabajo activo. El componente decide qué mostrar para cada ID de bloque. |
| Comandos propios con Deshacer en Source (2602) | [Uso y verificación](verification-sdk-author-undo2602.md) | Lotes declarativos de acciones Writer con un recibo efectivo en la pila del editor Source o su compañero. |
| Proveedor de Deshacer en Source (2614) | [Uso y verificación](verification-sdk-undo-provider2614.md) | Modelo de ensayo e historial de sesión en editor o compañero. Aplicar usa un recibo Writer. |
| Historial de modelo agrupado y anclas de Source (2620) | [Uso y verificación](verification-sdk-pushed-undo2620.md) | Inversas y marcas de sesión por editor o compañero. Publicación MCP optativa por proveedor vivo. |
| Pausa, reanudación y búsqueda de audio local | [Transporte 2475](verification-sdk-audio-transport2475.md) | Runtime SDK; no playback guardado ni unificación de reproductores legacy. |
| Preparación reutilizable de audio local | [Precarga 2494](verification-sdk-audio-preload2494.md) | Retenciones por owner/coordinador, sin salida por preparar ni caché portable. |
| Oyente por owner, emisor puntual y modelos equalpower/HRTF | [Espacial 2505](verification-sdk-audio-spatial2505.md), Source `82eafc27` en Main con CAS r2 | Contrato propio del SDK, controles MCP y SoundPad; no room/occlusión, altavoz, curva HRTF universal o migración de Soundscape/Reader/wiki. |

La continuidad documental SourceMap/transporte está integrada en 441e y la de precarga en 471; sus WTs/tareas documentales se cerraron normalmente. Estos recibos superan los pasos de entrega aún sin marcar en sus notas antiguas, sin alterarlas retrospectivamente. Espacial 2505 tiene Brave real, Native autenticado warm/cold y acabado revisados por separado; las observaciones Browser no son un recuento de tests y la prueba offline no es salida física.

**Pendientes actuales de este seguimiento:** rendimiento de texto rico con historial retenido en 2318 (open; objetivo 100 ms todavía sin aceptación). La continuidad MEM/KG específica de Source 2540 está completada según los recibos de memoria y del grafo de Writer. Source `38db3169` está aprobado en revisión CAS 3 e integrado en Main, con Native warm/cold y manual específico acreditados. La continuidad MEM/KG combinada de 2464/2504 y el manual espacial están completados; las frases equivalentes pendientes del historial inferior pertenecen a sus cortes anteriores. No se dan por resueltos hosting, IME físico, schema general o los demás subcontratos sin evidencia actual, ni se convierten filas históricas en ausencias actuales sin contraste nuevo.

La tarea 1095 mantiene su Done y voto históricos. La instrucción de continuar hasta paridad se sigue en el hilo 1195, reabierto, y en tareas nuevas. La paridad global continúa abierta; no se modifican los recuentos antiguos.

---

## HISTORIAL PRESERVADO — estados de sus cortes originales

Lo siguiente se conserva íntegro como registro histórico. Sus cabeceras «Estado actual» pertenecen a la fecha/corte que describen y no reemplazan el aviso fechado anterior.

# VVD catalogue cross-reference (Agora 1095, continuation of 1041)

## Estado actual: primer incremento de tablas compartidas2003 entregado

Las herramientas que declaran el nuevo perfil pueden insertar tablas de tamaño fijo, escribir/formatear/enlazar por celda y mover/quitar/Deshacer preservando aportaciones ajenas. No se migran módulos antiguos al abrirlos ni se sustituyen los controles contextuales de Notas2009. La evidencia de autor, peer, BraveRoot y puente Native es separada; el árbol compuesto pasó los dos focos y quick/build. [Contrato, fallos preservados y estado formal](verification-shared-tables2003.md).

El commit1cffcbdb ya está aprobado en2003/revisión1 e integrado Main/primary. El seguimiento40c2400a también está aprobado en revisión2 e integrado, con aceptación BraveR6 y resultados anteriores conservados; el intento BraveR5 de dos bibliotecas sigue parcial. Filas/columnas mutables, combinar/dividir/anchos, imágenes/bytes y adopción antigua hacia este perfil siguen abiertos, junto a schema/IME/hosting/coste. No se cierra1095 ni se cambian recuentos históricos. Los estados inferiores se conservan como historia de sus respectivos cortes.


Controles de tabla normal2009 integrados como `d9039d3`, aprobación formal1 y sin push: barra junto a la celda, teclado y selección/Undo originales, MCP encabezado. [Contrato y pruebas](verification-table-context2009.md). No equivale al perfil causal compartido2003, aún en desarrollo/revisión. La mención con imagen de VVD se confirmó por Show/Hide/Undo/reload en nota normal QA; su residuo Writer permanece en2014.1095 continúa abierta.

La ampliación 1526 añade `client.icons.resolveSvg?`, el MCP readonly separado `wh_local_tool_icon_svg` y Descargar SVG en Cuaderno de iconos, sin guardar notas pendientes ni insertar SVG en datos/prosa/preview. Reutiliza el catálogo existente y conserva los clientes antiguos sin método. El acuerdo 1650 y el verificador independiente certifican geometría estándar de 1688 símbolos; el diagnóstico raster 3376 sigue FAIL histórico, con 2158 exactos/1218 diferentes. SDK/paridad general continúan PARTIAL y 1095 abierta. [Contrato, límites, pruebas y estado de entrega](verification-sdk-icon-svg.md).

La capacidad1523 añade `client.icons` opcional (`get/search/packs`) y `LocalToolIcon` reutilizando el catálogo/pintor propios existentes. La lectura MCP `wh_local_tool_icons` comparte sus metadatos y el adaptador conserva null explícito; no necesita proyecto o Source. Cuaderno de iconos es una definición importable normal: buscar/paginar no escribe, seleccionar guarda sólo iconId y Guardar notas mantiene el borrador y su conflicto separados. El corte1523 no incluía instalación automática, SVG resolver, packs ajenos/subidos o prosa/preview gráficos. SDK general PARTIAL, matrices históricas sin recuento nuevo y1095 abierta. [Contrato, pruebas atribuidas y estado de entrega](verification-sdk-icons.md).

La capacidad1518 añade `refs.resolve(reference,{includePath:true})` y la misma opción al MCP de referencias existente. Lee título, identidad, disponibilidad y ruta efectiva Base/época de un B aún no abierto, sin navegar, guardar notas ni modificar el workspace. Omitido/{}/false conserva el resultado anterior. Comparte el resolvedor de apertura, con ruta nula cuando no existe destino efectivo o el adaptador no emite; no añade controles visuales ni garantía nueva de flush. SDK general PARTIAL y1095 abierta. [Contrato, pruebas atribuidas y estado de entrega](verification-sdk-document-path.md).

La capacidad1512 añade `openDocument(kind,id,{placement:'beside'})` y Ver al lado al selector, conservando Abrir y la navegación sin opciones. Source, raíz Worldgen y adaptadores normales comparten resolución efectiva/época; el companion conserva el Source recuperable y el guard existente trata sus pendientes. Códex usa su Modal global. Los focos de autor, revisión independiente, Node, CSS real y Brave tienen atribuciones separadas; 1095 y SDK general continúan parciales. [Contrato, límites y estado de entrega](verification-sdk-placement.md).

Worldgen retains the existing Light menu choice per map with optional `mapHour`: `off`, the existing named lights or `journey`. A selection starts saving immediately, with one pending choice, scoped CAS and explicit storage Retry; a conflict adopts saved settings without automatic replay. Legacy absence reads as `off` without writing. Base/inherited-era saves and receipt Undo keep their captured target and original absence. Render without `hour` uses saved light; explicit 0, 24 or a name wins. Journey stores the mode without frames or a shared runtime clock. This bounded map-light extension leaves 1095 and general parity open. [Contract, attributed evidence and delivery status](verification-map-lighting.md).

Archivo de recursos añade preview local de audio/vídeo en Base: Abrir presenta un panel sobre la lista; Play requiere el control nativo y Cerrar/filtro/owner/versión retiran la fuente anterior. No copia archivos, guarda preview ni añade herramienta MCP; catálogo y usos existentes concuerdan con los IDs de la UI. El original focused9 y el rojo CSS incumbente confirmado se mantienen separados de los nuevos focos CSS. D2 fila44 continúa PARTIAL. [Contrato, pruebas y estado de entrega](verification-assets-media-preview.md).

El SDK propio amplía los menús Source/legacy con submenús opcionales: Contador contextual conserva Incrementar/Restablecer planos y añade Más acciones → Incrementar y Cuenta → Restablecer dentro de esa rama. Entrada explícita, Atrás/teclado, copias profundas y aperturas revocables conservan el fallback sin host. El fake sólo graba metadata serializable, sin callbacks. Las operaciones y Undo/Redo por recibos siguen siendo los existentes; no se promete Ctrl+Z. Compilar no habilita el ejemplo. SDK general PARTIAL y 1095 abierta. [Entrega plana anterior](verification-sdk-context-menus.md); [contrato, evidencia y recibos de submenús](verification-local-tool-submenus.md).

La ficha guardada del Códex incorpora **Exportar**: Markdown individual, ZIP opcional con los adjuntos locales consumidos, PDF/PNG en Desktop y vista imprimible en Browser. La copia de autor se captura en sólo lectura para Base o la época efectiva; no incluye borradores, anotaciones ni toda la galería. Las herramientas MCP existentes añaden selección individual optativa y conservan sus formatos predeterminados. [Uso, pruebas r1/r2 y estado de entrega](verification-card-export.md). No se atribuye una descarga confirmada en Brave ni paridad completa con VVD.

Source tools can declare optional tutorials in their normal Source or legacy editor. Help starts or resumes manual, confirmed-action or visible-element steps within that instance. Structural progress survives copy/repack, while a changed structure starts separately even at the same revision. The nine global tours remain unchanged. The Guided counter and readonly describe extension have [separate API, evidence and delivery status](verification-sdk-tours.md); Owned/world/readonly/fullscreen and universal SDK parity are outside this extension.

World dates now offer Previous/Next month, Clear and separate exact-year/month/day fields with Apply/Cancel, alongside free text and the existing grid. Browsing leaves the authored date unchanged. Today uses the computer's local day only when the world calendar has a complete usable Earth correlation. Event and chapter saves retain their existing rules. [Use, verification and limits](verification-date-controls.md). Source `2878f66` was approved independently at submission32 and integrated into main. Final main checks, manual and continuity are recorded separately in that verification file; task1095 stays open for the remaining gaps.

Board references can play project audio and video using native controls. Add an existing file through Assets or Reference, or drag it from Assets. For a new local file, use Files in Assets or drop it onto the board: audio/video is imported into the scoped library and pinned as a reference; images retain the existing image flow. The normal media-library import also remains available. Nodes share the library file, start paused and release playback when hidden or closed. Normal Undo/Redo affects the reference, preserving the file. Static PNG remains a caption/frame without playback controls. [Playback evidence](verification-board-local-media.md); [direct file import, verification and limits](verification-board-file-import.md).

Owned source blocks can opt into additive codec evolution: a compatible version can add fields to the same saved block without changing it on selection or read. The first meaningful edit saves data, codec and portable preview together; scoped action Undo restores the complete prior envelope. Strict compatibility remains the default, Source state keeps its existing migration contract, and the general SDK remains partial. [Contract, example and evidence](verification-sdk-owned-evolution.md).

Rich notes support inline images from File or project Gallery. Set width, frame and left/centre/right alignment, replace an image while keeping its layout, or remove it and use Undo/Redo. Image-only notes can also be saved and reopened. [Use, evidence and limits](verification-note-inline-images.md).

Worldgen places can use a copied local image from File or Gallery, in its original colours or the map’s ink. Remove it to reveal an available graphic, then the retained symbol or building; changing or deleting the Gallery original does not alter the copy. Maps and Codex-linked portraits keep their existing behaviour. [Contract and verification](verification-place-images.md).

Worldgen places also offer a searchable graphic catalog with categories: 1,688 own geometries and 1,689 picker names (Wand2 saves as WandSparkles). Cells, selection, maps, projected 3D, regional sheets and PNG share the same numeric drawing. A prepared local image takes priority; removing it reveals the graphic, and removing that reveals the retained model/symbol. Choosing a model in the normal inspector explicitly clears the active overrides. The catalog is a bounded offline capability, not proof of the full thematic VVD inventory or general SDK parity. [Use, native contract and evidence](verification-map-symbol-catalog.md).

Source-tool fields can opt into rich prose: headings, lists, text links and copied local raster images use the native editor and remain readable without the author module. Save the briefing explicitly; an Owned block then needs its parent document saved, and the dock requires child Save/Discard before leaving. This is local string-and-CAS editing, without character collaboration; the general SDK remains a partial local subset. [Use and limits](verification-sdk-rich-prose.md).

Calendar banners now have timeline-owned presets with live links, independent copies and a preserved manual style. Crosshatch, Grid and local raster fills have optional repeat size and opacity; changing a linked preset repaints its events without reapplying it. Moves retain the original preset owner. Normal controls, native MCP, scoped Undo, eras and portable backups use the same contract. Source `101ada925f6f8a41d0226e52298a55a7ce43e73b`; delivery/review: _stage/sdk-following-research/delivery-banners30-final.json / _stage/banner-preliminary-review/review-cas24-approve.txt. Final global/main/Browser/manual receipts: _stage/sdk-following-research/banners30-global-final-receipt.json; _stage/sdk-following-research/main-fontdata-101ada9-20261024-035156-receipt.json; _stage/sdk-following-research/banners-root-window3-receipt.json; _stage/sdk-following-research/manual-banners-receipt.json. [Usage, verification and limits](verification-calendar-banners.md). This establishes the bounded offline workflow in C-writing row83; task1095 continues. Rich prose was still research at that banner delivery; its later scoped extension has separate [evidence](verification-sdk-rich-prose.md).

One world now contains independent authored manuscripts, sharing the same Codex/maps/timelines. The library, structural chapter ownership, book/import/Reader scopes, separate presentation/positions, publishing profiles and portable restores are covered in [shared-manuscript verification](verification-shared-manuscripts.md). The original manuscript remains implicit. This closes the specific multi-story gap in C-writing row1; historical wave counts below are unchanged. Local SDK font/data import and Book home are integrated in delivery `416be426337f22f128c5f4d0875167d48738e05c` (feature source `c2b7cb0dba116485264a8ae86e48635c82706e72`) after independent CAS23 and final root checks. Project files can be chosen per document or installation and preserved in offline reading/backups; manuscript covers, summaries and chapter-update dates are visible in the library and book overview. [Contract, evidence and limits](verification-sdk-asset-files.md). Task1095 continues.

SDK audio `fcf94f6` is integrated after fresh independent CAS20: per-handle digital RMS/peak and left/right levels, plus stereo pan, use the real playback graph. Local sounds exposes these through normal controls; native status/control share the scoped contract. Brave verified pan, measured silence, Stop and save/reopen without autoplay. Peer coverage is29 distinct focused groups (7 author +4 own +18 legacy), with overlap of capabilities. Clean-main verify/build passed: Vite43.33s, Electron, Node937/schema checks and the original headless author kit. The Google manual has a separate415 UTF-16 revision/readback receipt. The headless regression from resource previews was corrected separately in043e906/CAS19. Own signatures, SDK-only playback and stereo scope remain partial; no3D, speaker measurement or final-source stdio claim. [Audio evidence and limits](verification-sdk-audio-levels.md). Task1095 continues.

Graph source `ecb1703` is separately integrated after CAS16: spacing/type areas and JSON/Duplicate preservation of settings, hidden cards and views. Real Brave verified final pins, filtering and restored views; [evidence](verification-graph-display.md) distinguishes generated SVG checks from the Browser download timeout. Historical counts remain unchanged and task1095 stays open.

Manual player 5e attacks are implemented at `112f1fc`, approved by fresh independent CAS 18 after a test-only EOF amendment. CAS 17 approved predecessor `971870a`; its vote is historical and was not inherited. Root Brave verified split fields/save/reopen, spell coexistence/clear, final action labels, contextual Discard and the paper appendix. Technical peer review has 32 distinct focused groups, including CAS/Undo/era/portability and read-only refresh; repetitions are not additional groups. Root integrated exact `112f1fc` FF-only and completed clean-main verify:quick (34 engines, 64 tables, 6515 keys, 22 locale files, zero warnings/lint), Vite 36.92s, Electron and both plain-Node checks (937 tools and Reveal schema/limits). Session 30517 exited zero, main stayed clean and the merge lock was released. The separate Google manual receipt adds 412 UTF-16 units using requiredRevision/readback, with 198 paragraphs, 197 other texts and all styles preserved. Reference evidence proves fields/persistence, not row roller controls; Age/Height custom fields already worked without new implementation. [Attack evidence and limits](verification-player-attacks.md). Historical counts and the open task remain unchanged.

## Why this exists

The 148-row inventory of task 1041 has no row for VVD's map editor (its M rows are
the 3D model viewer) and no rows for whole areas: Campaign, Compendium, Name
generator, Soundscape, Animator, Annotator, Cartographer, To-do list. This pass
starts from VVD's own shipped interface catalogue instead of from screenshots.

## Method and evidence levels

Banner-shape source `2f21eed73c87d9c3af1e6b7f7a191f2be939b591` is integrated after independent CAS 14. Plain/Ribbon/Bunting/Scallop and fill patterns are separate; root's normal Brave exercised their combinations, Plain restoration, single-day and week/month boundaries. Ten frozen paths, author six focal groups and peer sixteen overlapping groups remain separately attributed. Root's final clean-main verify/build passed: Vite 27.77s, Electron and two Node checks with 934 tools; conformance 34 engines / 64 tables / 6515 keys / 22 locale files / zero warnings. The shape manual receipt is complete (314 added characters, 197 other paragraphs/styles preserved); calendar/audio's earlier 610-character receipt remains separate. That shape-only delivery kept C #83 PARTIAL for its broader image/saved-banner claim. The later bounded workflow is in verification-calendar-banners.md; historical counts are not recast as a parity score. [Shape evidence and limits](verification-calendar-shapes.md).

Calendar direct-editor source `4e4bf5d` is integrated after CAS12; root's normal Brave day17→originalJan10–12Weekly→Escape/focus and description Save→day17 passed. Independent17final focal groups and the initial focus RED remain separately attributed. Clean-main verify:quick/Vite27.91s/Electron/Node932 passed and root released the merge lock. [Calendar evidence](verification-calendar.md).

SDK audio7c4e3fb is integrated after independent CAS13; corrected17path freeze and final clean-main verify/build26.31s/Electron/Node934 passed. Initial peer NO APTO found four P2; final peer11groups/17hashes close them, and root repeated bounded corrected-source Play/Stop after reload. Its PARTIAL SDK-only graph and own signatures did not include resource defaults in that audio-only source; legacy-player graph integration, spatialization and measured levels remain outside its scope; MCP play remains gesture-required/unqueued. Initial Browser status/cleanup is not hardware recording. [Audio evidence and pending receipts](verification-sdk-audio.md). Historical counts and open1095 remain.

Source `d542365` adds native tool resources: bundled image/audio defaults, document → installation → package selection, Revert, scoped asset MCP tools and portable references. AssetPad uses the normal owned-block menu. Independent technical review records 34 distinct focused groups (18 author + 6 reviewer + 10 legacy); normal Brave confirmed imports, selection/Revert, save/reopen and a 96px read-only preview. Approved CAS15 and integrated FF-only from f44e387 to exact d542365 under a fresh merge lock, with clean main. Final verify:quick/shipping lint, Vite28.92s, Electron and Node937/schema2PASS completed; root session2655 exited0 and the merge lock was released. The Google manual update added588 UTF-16 units with requiredRevision/readback,198 paragraphs,197 others and all styles preserved; both manual locks were released. Own SDK signatures remain partial; installation has CAS/Revert without Undo, the d542 cut had font/data Blob defaults without a generic picker (local import/choice was added later; [current contract](verification-sdk-asset-files.md)), and wiki may apply its own SVG frame. [Resource evidence and final receipts](verification-sdk-assets.md).

Atlas-to-card is integrated at `ff3baead8149aefa03c3ba0c9ead6875eb6bc6b0` after independent CAS10. Eleven frozen source/test paths plus oracle/runner retain the reviewed bytes; five author focal functions and fifteen overlapping peer groups are not a new global suite. Root's normal Brave flow created a Faction from QA Faro del puerto, linked the existing Character, opened the Faction and returned with both links retained. Root's final clean-main verify:quick/Vite43.47s/Electron/Node932 passed, separately from notes' prior build. [Contract, evidence and limits](verification-place-cards.md). A1#54 remains PARTIAL for unadded search/aliases; no global count uplift or task closure follows. Manual readback preserved197other paragraphs/styles.

Notes follow-up integrated at `0a90dd4`, independently approved CAS9: actual reference slash Heading2/list persisted after reopen; root's Writer Brave flow converted a plain note, saved/reloaded, copied the exact three plain lines and searched them while Enter capture stayed plain. Optional richHtml/text normalization, MCP/Undo/era, captured wiki/raster images and JSON/ZIP/clone are covered by separately attributed focused tests. [Evidence and limits](verification-notes.md). Author17 and peer26 groups overlap and are not a combined suite; the peer's Node932 included concurrent atlas. Root's clean-main verify:quick/Vite1m18s/Electron/Node931 passed after exact-lock dependency restoration, with TS2307/TS2322 attempts retained separately. Atlas-to-card is not promoted by these notes receipts. Historical counts and open task1095 remain.

Earlier integrated follow-up: source12264fd after930f6b2+7b841e2, with complementary CAS8 approvals for7b841e2/12264fd. Actual reference card-backed creation/name synchronization and a compact CoC source roll were exercised. Writer supplies optional saved-investigator summaries/selected skills/roster, compact linked source rolls with Undo, readonly Codex About hydration and reactive SDK world lists/reads. Root's normal Brave checks saved/reopened the blocks and followed create/rename/archive while the original list stayed mounted. [Detailed evidence and limits](verification-compact.md). Existing table counts below remain historical; no global status/count uplift, universal parity or task closure follows from this delivery.

1. Source catalogue: the English interface strings VVD serves to the
   authenticated editor (`/i18n/en.<hash>.json`, 21,286 keys, read 21-10-2026).
   They are the list of controls and options the product exposes. They are not
   proof of behaviour; where a row infers behaviour from a label it says so.
   The raw file is third-party data and is not stored in this repository.
2. Authenticated observation (21-10-2026): Map Beta 0.1.58 in the tool preview
   of the reference session — starters (blank sea/land, size presets, templates
   including the Roman Mediterranean), biome palette, elevation, rivers, paths,
   places, zones, labels, settings, look selector. Luis's video of 20-10
   (12.45 s, VVD promotional reel) shows the biome brush on a tablet, a painted
   regional map with pins, Quill's 3D book, the 3D tilt and a relation tree.
3. Writer side: six independent read-only agents opened Writer's source for
   every offline capability and classified it PRESENT / PARTIAL / ABSENT with
   file evidence. This is source reading, not execution. A PRESENT here is not a
   tested workflow; a PARTIAL names the concrete difference.

| Area | File | Rows | Present | Partial | Absent | Online |
|---|---|---:|---:|---:|---:|---:|
| Map authoring (atlasTool) | A1-atlas-authoring.md | 75 | 17 | 31 | 24 | 2 |
| Map lenses: travel, trade, campaign, image maps | A2-atlas-lenses.md | 66 | 10 | 25 | 25 | 6 |
| Campaign manager | B-campaign.md | 82 | 4 | 46 | 16 | 17 |
| Writing, timeline, trees, tables, codex | C-writing.md | 113 | 39 | 48 | 21 | 5 |
| Smaller tools | D1-tools.md | 69 | 20 | 25 | 17 | 12 |
| Platform surfaces | D2-platform.md | 88 | 20 | 40 | 12 | 16 |

Counts are grep counts over each table (a row may mention two statuses). They
are a work list, not a parity score. Each file ends with ranked offline gaps,
implementation sketches, risks and UNKNOWN items.

The counts above are from the first pass. The status cells in each file are the
current ones, updated in place with "(1095: …) — was X" where a wave delivered the row.

## Delivery waves

Wave 1, maps (Luis's priority): saved look per world; blank sea/land starters;
area measurement and reference-outline scale; hand-placeable stamp library;
travel profile (ways, pace, ground costs, day hours) with MCP planner; label
handles; map versions linked to timeline events with playback.
Later waves follow the ranked lists of the other areas. Every delivery keeps
existing capabilities and is proved through UI, MCP, persistence/reopen and
export where relevant, then independently reviewed.

## Delivered so far (worktree writer-vvd1095, integrated into main at commit deeeba9 on 22-10-2026, without push)

Each item was shown through the normal UI with trusted input, through MCP
(focused tests, and the native stdio transport where noted), across reopen, and
reviewed independently (rounds r1–r13, r13 approving: stamps from r4, grid and playback from r5, reader's fog from r6, story events from r7, trade lens from r8; classic map styling and the later waves were reviewed in r9–r13; reports in
`D:/LocalAI/_claude_tmp/vvd1095-review`). Evidence screenshots:
`D:/LocalAI/artifacts/writer-vvd1095`.

| A1/A2 row | What changed | Status now |
|---|---|---|
| A1 #1, #2 blank sea / land | Presets, Coast brush, shape controls off with a way back | PRESENT |
| A1 #35–36 look saved with the map | Per-world look for views, exports and MCP; Base shared while an era inherits | PRESENT (the look set is still Writer's four) |
| A1 #39 scale compare | Ten real outlines laid at true scale | PARTIAL (no "set map width" control) |
| A1 #43 measure area | Ruler loop area and perimeter, polar caps | PARTIAL (no hover-a-zone area) |
| A1 #52 label handles | Rotate, spacing, curve handles; exact size/angle/spacing/curve | PARTIAL (size by slider, not four resize handles; no rank "Title") |
| A1 #59 stamps | 32 stamps in four categories, S/M/L, names, all views | PARTIAL (no per-glyph colour schemes, row 61) |
| A1 #71–72 versions on the timeline | Era ↔ event links, calendar order, play, orphans, portability | PARTIAL (no snapshot strip, no "open in Timeline") |
| A2 travel rows | World pace, speeds, ground costs, per-leg modes, rest days, MCP planner, day-by-day playback | see A2 rows #29–#37 (trade lens is in its own row below) |
| A2 #20, #21 reader's view and fog brushes | Fog brush Seen/Heard/Hide with chapter; Reader's view per chapter in atlas, Carta and PNG; MCP paint/view/render | PRESENT (not in 3D) |
| A2 #25 story playback | Previous / Play / Next and a scrub bar through the chapters in the Reader's view; the map follows each chapter's events, a caption names them and what is planned next; MCP wh_story_chapters | PARTIAL (no session replay, "Now" or "As you saw it") |
| A1 #14 view band | "Mundo / Continente / Región / Comarca · N km de ancho" on the atlas, following the zoom | PRESENT |
| A1 #20 fantasy grounds | Fantasy row in the Biome brush; travel classes and leg names; MCP wh_paint_biome, wh_place_at ground | PRESENT |
| A1 #24 plateau | Relieve → Meseta: square, flat-edged head in one click | PRESENT (lifts evenly, does not level the top) |
| A1 #30 contour lines | Toolbar: as the look, none or every 100/200/500/1000 m on atlas, Carta and export; saved with the look; MCP presentation contours | PRESENT (not in 3D) |
| Map tool 3D look | Plane with the whole world: tabletop model (cut walls with water column, soil, strata, plinth; lit table and soft shadow; sea clipped to the block) or landscape; saved with the look; landmark marks as in 2D; road seam cut; globe relief tamed; MCP presentation stage3D | PRESENT (no clouds, no standing tree cards, one block look) |
| Maps tool portrait pins | Pins linked to an entry with a picture show it framed in the pin colour with the name under it; Portraits and Names layers; SVG export; MCP wh_set_map_layers | PRESENT |
| Map tool painted 3D | Skin Pintado: painted relief map (blended grounds, rock and snow, shelf and coast rings, painted forests and dunes) with a flat painted sea; map lettering over Pintado and Dibujado; Dibujado shows its 2D colours; satellite tiles below a region; MCP skin3D pintado | PRESENT (trees painted flat, not standing cards; no clouds) |
| A2 #34, #36, #41 journey in words | Sentence, towns passed with km, roads named by their towns, day and part of day per stretch, set-off / camp / arrival clock, inns and ruins for the nights; MCP wh_plan_journey | PRESENT (no travel by air) |
| A2 #59 roll a name | Roll button on Point → Label: names for region, water, range and place labels in the world's languages, with etymology; MCP wh_roll_name | PRESENT |
| A2 #61 play grid and map settings | Grid Off / Square / Hex with km size in the toolbar (see A1 play grid), themes and paper | PRESENT |
| A2 #28 reader's map settings | Start state saved with the look; route marked as seen with sight radius and chapter | PARTIAL (no "land in ink", towns as dots or trail) |
| A1 play grid | Square/hex grid in km over atlas, Carta, PNG export and MCP render | PRESENT (atlas: equirect and Mercator) |
| A2 #43–47 trade lens | Deterministic economy: sites by ground, needs, granaries, shortages, prices, road and sea shipments, month playback; Trade tab; sites and shipments on the map; MCP | PRESENT except #46 PARTIAL (no per-port goods list); no population growth |
| A2 #5–10, #12–13 classic map styling | Several layers per item, drawing order, add/remove vertex, outline, hatch, lettering, pin size and icon; SVG export; MCP map features | PRESENT except #12 PARTIAL |
| A2 #22, #24, #26 story events and party marks | Events by kind (incl. travelling, camp, inn), chapter, planned/happened, note; place, edit, drag, remove; story so far by chapter with order inside each chapter (earlier/later) and who was there (Codex characters and factions, named in the playback caption); reader's view by chapter; exports; MCP who/order | PRESENT (order by arrows, not drag; chapters, not real-life sessions; playback is row 25) |
| A2 #14, #15, #18 classic map picker, right-click menu, ground change | Searchable Codex link that creates entries by type; right-click new entry / pin / region / route / label / comment at the spot (map_point notes drawn on the map); change-picture dialog with keep/stretch, era saved first, comments move too; MCP wh_annotate `at`, wh_preview/change_map_ground | PRESENT |
| A2 #51–54, A1 #44 classic map scale | Width in km (typed or from a measured distance), scale bar, measure tool, lengths/areas/travel times, real places at true size, road/trail/river paths with thickness and solid/dashed/dotted line, drawn with Enter/Backspace/Escape and bent by halfway handles, pasted key names lettered pins; MCP set_map_scale, measure_map, name_map_pins_from_key, linePattern | PRESENT except #51 ground kinds |
| A2 #27, #33 journey stops | Ends and stops as towns or points of open ground; stop list with earlier/later and remove; legs and route follow; MCP wh_plan_journey {x,y} stops | PRESENT (arrows, not dragging the line) |
| A1 #29 sea level and snowline | Paint → Whole world sliders (one undoable edit each): sea level moves every height and the biomes follow; snowline moves where snow is drawn in every 2D renderer; MCP wh_set_world_levels, wh_get_world | PRESENT (rivers keep their courses until Recalculate) |
| A1 #27 lake tool | River tool Water → Lake: click fills the hollow to its spill (Least size dams a bigger one), Ctrl+click drains; survives recalculation; MCP wh_add_lake, wh_drain_lake, lake in wh_place_at | PRESENT |
| A1 #56 duplicate and lock a place | Index card and Place inspector: Duplicate (town, ruin, landmark → "<name> 2" on the nearest free dry cell) and Lock/Unlock (one rule for every tool, card and the bridge: not moved or hidden; the Move tool says why); MCP wh_lock_place, wh_duplicate_place, locked in place lists | PRESENT (realms/seas not copied; reshaping the ground under a locked town can still drown it) |
| A1 #63 line thickness and pattern | Hand-drawn world roads: Line (solid/dashed/dotted) and Thickness (×0.5–3) on the Road tool, drawn on map, 3D and Carta; MCP wh_add_world_road routes one between two places; classic routes as above | PRESENT (generated roads keep the theme's line) |

Commits: 22cdf7d, dd8f6a5, 4849ac8 (look, blank starters, measure, travel),
6b3a3e6 (review r1), 3258e65 (map eras), 59e7ad9 (review r2), 07f14f6 (labels),
fef1c9a (stamps, review r3), 342b8b7 (playback, grid, review r4) and the reader's-eye fog and review-r5 commit that follows.

## Wave C — writing, publishing, Codex, timelines, trees, tables (integrated into main on 23-10-2026, without push)

Matrix: [C-writing.md](C-writing.md) — 107 of 113 rows PRESENT, 5 n/a (online
hosting, plans and embeds), 1 PARTIAL (#1, several stories inside one world).
Each row names the focused test or QA runner that proves it; the suite is in
`scripts/run-vvd-tests.cjs`, the QA runners are `run-board-quick-qa`,
`run-sprint-rounds-qa`, `run-tree-groups-qa`, `run-timeline-calendar-qa`,
`run-timeline-duplicate-qa`, `run-world-reader-plus-qa` and
`run-workspace-library-qa`. An independent review (12 findings: sheet
references after inserts, table query sanitising, timeline settings undo per
era, re-dating into a missing leap month, calendar re-date undo, ePub book
style scoped to chapters, publishing profile presets, Word inline image size,
engine checks on three tools, eraser on turned strokes) was fixed and each
fix has a check in `tests/review-1095c.browser.tsx`. Bridge tools: AI-BRIDGE
section 29. Known limits: PENDIENTES, "Escritura 1095 (ola C)".

## Maps after fb67d94 — sheet, zones, relief, 3D, light, ways, reader (integrated with wave C)

A1 #3, #17, #23, #25, #28, #33, #34, #66, #67 and A2 #22, #26, #28, #29, #30,
#38, #46 updated in place ("— was X"). Tests: `world-sheet`, `world-zones`,
`world-terrain-ops`, `world-3d-model`, `world-light-ways`, `world-reader-plus`,
`world-trade-routes`, `world-story-scenes` (focused) and the QA runners
`run-world-{sheet,zones,terrain-ops,3d-model,light-ways,reader-plus,routes-scenes}-qa.cjs`.
Bridge tools: AI-BRIDGE section 28 ("Mundos: hoja a la medida…"). An
independent review of these waves found no blocker; its findings were fixed
before the merge: the trade lens is worked out off the click (a moment after
the tab opens or the last stroke, a few shipment ways per frame), a day never
holds more than 24 moving hours (night ways at a hard pace), the 3D readout
and the zoom tiers use the sheet's own kilometres, trade ways keep their line
round the seam, a river put down point by point needs two different cells,
and zone hatching is anchored to the map so it does not slide while panning.

## Wave D1 — tabletop tools (first part)

Matrix: [D1-tools.md](D1-tools.md) — 44 of 69 rows PRESENT (was 19), 14
PARTIAL, 1 ABSENT on purpose (#66, licensed art), 10 online. Tests:
`compendium-encounter`, `table-tools`, `board-context-menu`,
`world-graph-settings`, `soundscape`, `kanban`, plus additions to
`codex-reference-panel`, `model-viewer`, `writing-blocks`. Bridge tools:
AI-BRIDGE section 30. Known limits: PENDIENTES, "Herramientas de mesa 1095".
An independent review (11 findings: Excel export and import, formulas, undo
safety, live-table export, the mixer) was fixed, each with a check in
`tests/review-1095d1`.

## Wave D2 — platform (first batch)

Matrix: [D2-platform.md](D2-platform.md). Delivered in this batch: saved
workspace themes (library, presets, apply with Deshacer), the world as a
Markdown vault (ZIP with `world.json`, optional media with size guards), the
wiki look and the wiki changes since the last edition, and workspace tabs
(pin, rename, duplicate, close others, recently closed, `Mod+1..9`,
`Mod+Shift+T`, keep-or-delete for an empty new document, an undo journal with
Deshacer in the toast). Tests: `workspace-themes`, `world-markdown-export`,
`workspace-tabs`, `workspace-appearance`, `wiki-look-changes`, plus
`project-workspace*` and `document-archive`. Bridge tools: AI-BRIDGE sections
31 to 34. An independent review (10 findings: receipts that carried whole
pictures, wiki pages in `world.json`, export memory guards, a quadratic CSV
render, theme apply without confirmation or undo, undo that lost its entry on
failure, stale closes, what counts as an empty document, shortcut guards,
Windows reserved names and leftover tab keys) was addressed, each with a check
in `tests/review-1095d2a`.

## Wave D2 (second batch) and wave B (first part)

Matrices: [D2-platform.md](D2-platform.md) and [B-campaign.md](B-campaign.md).
This batch covers table rules, reveal and the player view, guided tours,
import from pasted text, ePub and PDF, and the assets library with compression.
Tests: `codex-reveal`, `assets-library`, `import-paste-epub-pdf`,
`wiki-look-changes`, plus the wiki suites. Bridge tools: AI-BRIDGE sections 35
to 37.

An independent review of the reveal / player view, assets library, ePub / PDF
import and compression work (9 findings) was addressed, each with a check in
`tests/review-1095d2b`: timelines in a revealed-only wiki publish only events
tied to admitted cards; the player view strips Codex, tool and source blocks of
unrevealed cards, searches only player-safe text and honours the project
preferences plus the saved profiles that publish only revealed cards; the usage
scan now covers Codex, diary and board blocks, reader audio, published editions
and recipe inputs; ePub and ZIP intake check the declared size before inflating,
count the real bytes while inflating, read a repeated spine file once and cap
chapters, text, entries and PDF pages; pasted text counts in the import budgets;
compression releases its slot on failure, times out, runs quiet and bounded,
accepts one job at a time and is cancelled when the assets panel closes; the
export settings no longer count maps while only revealed cards are published.


## Tool-owned interface translations

Source tools can declare their own catalogs and use `useLocalToolT(client)` for translated labels, interpolation, plurals and Intl formats. Changing the normal app language preserves authored notes; the Localized notebook example supports Source and Owned editing with explicit saves. Save a new Codex card before inserting its Owned block, then save the child and parent separately. This is a bounded offline SDK extension; [evidence, delivery status and limits](verification-sdk-locale.md) distinguish technical verification from integration.

## Shared tool preferences

Optional `client.defaults` and `useLocalToolDefaults` provide world/tool/key JSON preferences independently of Source notes. Icon notebook adds explicit Save favorite/Use favorite and preference Undo/Redo; Base/era sharing, conflicts, retained proposals, stale bindings and normal JSON/ZIP/Duplicate have attributed tests. [Delivery, exact evidence and remaining limits](verification-sdk-defaults.md). Task1095 and overall web/SDK parity stay open.

## Resolved tool theme —1532

The optional own `client.theme`/`useLocalToolTheme` contract reads nine colors and effective mode for Base/era; the existing Appearance MCP getter adds `resolved`. Normal workspace icons repaint at their own pane's applied-style commit without remounting or saving notes. This supersedes the theme-as-research statement in the historical1528 continuation. World/media collections already have readers, queries and live invalidation, so no duplicate collection facade was added. [Attributed evidence, delivery status and limits](verification-sdk-theme.md). Parent1095 and general parity remain open/partial.

## Persistent model animation presentation —26October2026

The owner model viewer now implements saved labels and full clip presentation order, with original source indices, unchanged GLB/originals, scoped CAS and normal Undo. Previous/next and read-only Reader/wiki consume that order; no clip is removed or fabricated. Two own MCP tools expose the same inventory/writer. D1#56 remains PARTIAL and historical counts remain unchanged. Source validation, Browser, Native, finish and integration are attributed separately in [the verification](verification-model-animation-presentation.md); source31c5598664c4f4de14880ae71d65c45530cc78f7 is approved exactly by CAS47 and integrated into Main with four focused checks passed. Manual/common updates are complete; the separate documentation commit/FF is recorded by ROOT-delivery-final.json. No global web/SDK parity or reference Animator runtime equivalence follows.

## Continuation26October: Directions, durable dismissals and Three C01–C07

Source45, committed as47d448bfac8d8441f07943d4c032aca1ad674e3d, has bounded Directions UI/Native evidence, durable candidate decisions with two-key Native and real Brave cold-reload evidence, and a production test of the existing shared dynamic Three runtime. [The attributed verification](verification-directions-dismissals-three.md) retains the failures, exact source boundaries and the separate Browser model runtime still in progress. Controlled inference in the cold persistence fixture is not a real model. Matrix A2#39, D1#30/C#28 and SDK49/I1041-M03 are refined by their appendices; original counts and grouped SDK rows are unchanged. FormalCAS50 approves the exact source45 commit; ROOT verified its FF into Main47d448bf with45blobs, clean tracked/index state and unchanged foreign files. Main manifest951/contract8/two-key Native and the native manual update are verified; documentary finalization and common continuity remain separate; overall parity stays open. [All residual capabilities remain tracked](remaining-parity.md).

## Real Browser NER and horizontal Timeline Fit — source07d868d

The previous Browser-runtime investigation now has real CPU/WASM, origin-cache/import, UTF-16/corpus, active cancellation, Browser and two-key MCP evidence. Timeline adds ephemeral horizontal Fit and correct era-scoped All years, with real Brave and scoped SDK/Native checks. [The new verification](verification-browser-ner-timeline.md) separates synthetic, no-model, real inference, production artifacts, UI, transport and final-clamp evidence. Source41 is committed07d868d8982ca46f4e1a192f20a4688db60155d8, approved exactly at CAS51 and integrated in Main with manifest954/query/synthetic and fresh NativeTimeline checks. Manual51 is updated and verified; final document/common status belongs to the separate ROOT-delivery51.json/ROOT-continuity51.json records when issued. Historical matrices/counts and global parity stay open.

## C41 Front and Print — source fc3ed49d delivered in Main

Two distinct capabilities now have implementation and attributed evidence: an opt-in captured front in the four existing book writers, and a separate one-sheet physical jacket PDF/PNG/JPEG. [The verification](verification-cover-exports.md) retains source 40, real files, independent pre-CAS and exact formal review, Front Brave cold and Print Brave cold reload/cleanup with 77 exact stored tables. Normal download status is separate from inspected Browser bytes. It separates Native runs before final guards from the independent causal guard checks, and the retained DOCX visual method from a new compliant bundled render. The combined build passed with source 40/foreign stable. Source fc3ed49d82807e8c14b394391fb5b24dfc9af1de has exact CAS52 approval and verified Main delivery, with fresh formal Front/Print transport and focused Main Print checks. The bounded C41 flows are delivered; document/manual/common records remain separate. C42 Browser book PDF/batch, original matrices/counts and overall 1095 parity remain open.

## A1-039 fase1: escala física de una hoja guardada

La calibración que faltaba en el mundo generado ya tiene controles normales, getter/setter MCP, writer/Undo comunes, resolución Base/era y portabilidad. La fuente42 bbf18aff3f1521cf9ea4b71bbe97529638c131ef está aprobada exactamente en CAS53 e integrada por FF verificado en Main, con comprobaciones propias de catálogo y Native. Los recibos documentales/manual/comunes siguen separados. [La verificación](verification-world-scale.md) distingue los5 casos shipping, el Native de34 fuentes previas, quick41, crítica/build42, el diagnóstico de miniatura y las observaciones Browser reales. No se acumulan como un único PASS ni sustituyen los recibos de integración.

Se refina A1-039 y la coherencia métrica de A1-003 sin cerrar la fila agrupada de tamaño/resize: ancho/alto independientes, portrait, grow/crop del terreno, relleno y anclajes siguen abiertos. La cuantización heredada de cinco campos en el primer snapshot no es un cambio de escala ni permite afirmar RAW frío globalmente exacto. Matrices históricas, conteos y restantes capacidades se conservan.

## C42: one captured book, several publishing outputs

The own workflow now prepares Markdown, HTML, EPUB, DOCX, searchable Browser book PDF and separate physical print-cover PDF from one effective manuscript/era capture. UI retry retains that copy after live edits/DB close; another public RPC export always captures current persisted data. Optional facing margins/page start apply to PDF/Word, while cover physical settings remain separate. Normal explicit download/ZIP, cancel and per-file results share the existing modal.

[Usage, final 42-path source, preserved REDs, attributed Browser/Native/production proofs and delivery state](verification-publishing-batch.md). This succeeds the earlier C41 absence statement without changing its historical evidence. Original counts, broader reference output details and overall1095 parity remain open. Commit/CAS/Main and document/manual/common status come from their separate Root receipts.

Source `2e54a2d476c31b49cea48a56cb5c4582c9d38114` has exact CAS54 approval and verified Main delivery. Its fresh Main transport uses Main executor/stdio and the existing WT renderer only after all42 canonical tuples match. The manual is updated with exact native readback; document/common records remain separate.


## Existing shared histories can enable links

Source `624474ba06e2903293e6d6a4814cf07eec31cf0c` is approved at writers1958/revision2 and integrated in Main. An updated local definition offers explicit Enable links for the known3→4 pair, preserving text, history, author Undo and the same shared room. Manual Save, late join, Leave and cold reopening have normal Brave evidence; independent Source/SDK/relay and genuine two-key MCP evidence retain their separate scopes and setup failures. [Usage, exact results and limits](verification-rich-links1958.md#existing-shared-histories).

Optional autosave1952, live content1913, new-document links and known-history adoption are delivered. Images/tables in the shared profile, extensible persisted schemas, physical IME, large-history performance, hosting and the [remaining web/SDK work](remaining-parity.md) continue; historical pending notes do not reopen delivered capabilities.
