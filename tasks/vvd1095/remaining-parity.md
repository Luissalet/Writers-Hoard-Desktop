## Estado vigente — 11 de noviembre de 2026

Esta cabecera distingue las entregas acreditadas del historial inferior. No es una nueva ejecución de todo el inventario ni un porcentaje de paridad. Los antiguos «pendiente», checks sin marcar o «1095 abierta» describen sus respectivos cortes: antes de convertirlos en trabajo nuevo se consulta la verificación posterior correspondiente. El bloque HISTORIAL conserva íntegros los bytes anteriores.

| Capacidad posterior acreditada | Contrato y evidencia | Límite que se conserva |
| --- | --- | --- |
| Filas/columnas compartidas por ID y ancho de columna | [Ejes 2047](../../docs/local-tool-sdk.md#collaborative-row-and-column-editing-2047), [anchos 2082](../../docs/local-tool-sdk.md#shared-table-column-widths-2082) | No equivale a cerrar toda la tabla, schema general o adopción arbitraria. |
| Agrupación y ajustes de vista de tabla (C97, 2647/2656/2658/2664) | [Dos niveles](verification-table-nested-groups2647.md), [agrupación persistida](verification-table-grouping-persistence2656.md), [filtros y orden persistidos](verification-table-view-persistence2658.md), [más niveles](verification-sdk-type-icon2659-table-levels2664.md#agrupar-por-más-de-dos-columnas) | **P/E local acotado; resto P/G**. Configuración por tabla normal/viva y ámbito Base/era; pliegue de sesión. Vistas nombradas, agregados y orden manual de la vista viva (C95) siguen abiertos. |
| Arrastre de columnas en tablas normales (2673) | [Uso y verificación](verification-table-column-drag2673.md) | Destino antes o después con guía visible, persistencia por ámbito Base/era y clic breve para ordenar. Las hojas y vistas vivas conservan sus controles. |
| Ancho de columnas en tablas normales (2676) | [Uso y verificación](verification-table-column-resize2676.md) | Tirador y teclado con ancho guardado por ámbito. Brave comprobó la era. Native comprobó movimiento y ancho por MCP en Base. |
| Renombrado en cabecera de tablas normales (2681) | [Uso y verificación](verification-table-inline-rename2681.md) | Lápiz y F2 con foco restaurado. Brave comprobó una era y Native comprobó rename-column por MCP en Base. |
| Campo escalar y map vacío añadidos a Source | [Escalar 2088](../../docs/local-tool-sdk.md#add-a-scalar-or-map-field-to-an-existing-source-document), [map 2455](verification-sdk-source-map-additive2455.md) | Declaraciones propias y evolución acotada; no schema persistente arbitrario ni migración general. |
| Lista vacía añadida a Source (2540) | [Contrato y evidencia acotados](verification-sdk-source-list-additive2540.md) | Source `38db3169` aprobado CAS r3 e integrado en Main; Native warm/cold acreditado. Sin migración general ni cambio de tipos. |
| Abrir un bloque Source al lado (2590) | [Uso y verificación](verification-sdk-source-block-focus2590.md) | Vista del mismo documento en un espacio de trabajo activo. El componente decide qué mostrar para cada ID de bloque. |
| Abrir un bloque propio de Codex o Escritura al lado (2628) | [Uso y verificación](verification-sdk-owned-panel2628.md) | El mismo bloque, ligado al editor dueño vivo; no es un documento independiente ni se restaura como pestaña. |
| Comandos propios con Deshacer en Source (2602) | [Uso y verificación](verification-sdk-author-undo2602.md) | Lotes declarativos de acciones Writer con un recibo efectivo en la pila del editor Source o su compañero. |
| Proveedor de Deshacer en Source (2614) | [Uso y verificación](verification-sdk-undo-provider2614.md) | Modelo de ensayo e historial de sesión en editor o compañero. Aplicar usa un recibo Writer. |
| Historial de modelo agrupado y anclas de Source (2620) | [Uso y verificación](verification-sdk-pushed-undo2620.md) | Inversas y marcas de sesión por editor o compañero. Publicación MCP optativa por proveedor vivo. |
| Validación por tramos de texto rico sin marcas (2318, 2653) | [Pruebas funcionales y medición SDK](verification-rich-compact-proof2653.md), Source `6195a149` en Main con CAS 1 | Optimización interna acotada; dos pares a 10.000 y uno a 50.000 UTF-16. P95 a 50.000: 2.230,7707 → 1.336,6789 ms; no es latencia interactiva ni acredita 100 ms. |
| Catálogo observable de tipos del Códex en Source (S04, 2644/2659) | [Uso y verificación por corte](verification-sdk-codex-types2644.md), Source `f3d276b1` en Main con CAS 1, [icono efectivo en el SDK](verification-sdk-type-icon2659-table-levels2664.md#icono-de-tipo-del-códex-en-el-sdk) | **P/E local acotado; resto P/G**. `list/read/watch` de tipos efectivos por proyecto compartidos en Base y eras; lectura MCP optativa. Sin CRUD nuevo ni paridad general del SDK. |
| Resolución por lote de referencias del SDK (2679) | [Contrato y verificación](verification-sdk-reference-batch2679.md) | Metadatos de lectura en Base y era, con orden, repetidos y ausencias explícitas. La ruta de apertura sigue en la resolución singular. |
| Operaciones e índice derivados de campos Source (S05, 2633) | [Uso y verificación](verification-sdk-derived-agent2633.md), Source `c5d0917f` en Main con CAS 1 | **P/E local acotado; resto P/G**. SDK Source compilado con opt-in: ocho operaciones y tres escalares indexados en el ejemplo. CLI Source/1, paquetes arbitrarios y paridad general siguen sin acreditar. |
| Catálogo de operaciones antes de instalar (S05, 2639) | [Uso y verificación por corte](verification-sdk-package-catalogue2639.md), Source `9d255227` en Main con CAS 1 | **P/E local acotado; resto P/G**. Catálogo optativo del paquete runtime propio, lectura sin ejecutar y cotejo al instalar; Source/1, paquetes ajenos y paridad general no acreditados. |
| Pausa, reanudación y búsqueda de audio local | [Transporte 2475](verification-sdk-audio-transport2475.md) | Runtime SDK; no playback guardado ni unificación de reproductores legacy. |
| Preparación reutilizable de audio local | [Precarga 2494](verification-sdk-audio-preload2494.md) | Retenciones por owner/coordinador, sin salida por preparar ni caché portable. |
| Oyente por owner, emisor puntual y modelos equalpower/HRTF | [Espacial 2505](verification-sdk-audio-spatial2505.md), Source `82eafc27` en Main con CAS r2 | Contrato propio del SDK, controles MCP y SoundPad; no room/occlusión, altavoz, curva HRTF universal o migración de Soundscape/Reader/wiki. |

La continuidad documental SourceMap/transporte está integrada en 441e y la de precarga en 471; sus WTs/tareas documentales se cerraron normalmente. Estos recibos superan los pasos de entrega aún sin marcar en sus notas antiguas, sin alterarlas retrospectivamente. Espacial 2505 tiene Brave real, Native autenticado warm/cold y acabado revisados por separado; las observaciones Browser no son un recuento de tests y la prueba offline no es salida física.

**Pendientes actuales de este seguimiento:** rendimiento de texto rico con historial retenido en 2318 (open; objetivo 100 ms todavía sin aceptación). [Medición SDK a 50.000 UTF-16](verification-sdk-package-catalogue2639.md#medición-2318-a-50000-unidades-utf-16): p95 de gesto 1.549,4158 ms; sin aceptación interactiva. La continuidad MEM/KG específica de Source 2540 está completada según los recibos de memoria y del grafo de Writer. Source `38db3169` está aprobado en revisión CAS 3 e integrado en Main, con Native warm/cold y manual específico acreditados. La continuidad MEM/KG combinada de 2464/2504 y el manual espacial están completados; las frases equivalentes pendientes del historial inferior pertenecen a sus cortes anteriores. No se dan por resueltos hosting, IME físico, schema general o los demás subcontratos sin evidencia actual, ni se convierten filas históricas en ausencias actuales sin contraste nuevo.

La tarea 1095 mantiene su Done y voto históricos. La instrucción de continuar hasta paridad se sigue en el hilo 1195, reabierto, y en tareas nuevas. La paridad global continúa abierta; no se modifican los recuentos antiguos.

---

## HISTORIAL PRESERVADO — estados de sus cortes originales

Lo siguiente se conserva íntegro como registro histórico. Sus cabeceras «Estado actual» pertenecen a la fecha/corte que describen y no reemplazan el aviso fechado anterior.

# Paridad web y SDK: registro de capacidades restantes

## Pegar párrafos sobre toda la selección en Source

VVD y Writer sustituyeron una selección completa que contenía una tabla por párrafos con formato. Writer conserva el orden, Unicode y las marcas. Un solo Deshacer recupera la estructura anterior, incluida la tabla, y el cambio guardado reaparece al recargar. El SDK y el puente del documento abierto comparten la operación `rich-block-replace-with-paragraphs`. [Verificación de la tarea 2196](verification-rich-performance1917.md#pegado-de-párrafos-sobre-toda-la-selección-2196).

## Imágenes en Source compartido — 2114

El perfil optativo incorpora PNG raíz, reemplazo, tres tamaños y retirada con Deshacer. Brave confirmó que una biblioteca sin imágenes recibe los PNG por el relay, conserva una edición de tamaño ajena al deshacer el reemplazo y abre en frío el resultado guardado. El puente con dos claves y el ZIP acreditan el historial y los bytes locales. 2161 añade [alineación izquierda, centro y derecha](verification-image-alignment2161.md), con tamaño y archivo independientes. 2164 añade [JPEG y WebP con bytes originales](verification-image-formats2164.md). 2167 añade [imágenes dentro de celdas](verification-image-cells2167.md). 2170 añade [selección rectangular de celdas](verification-table-selection2170.md). 2172 añade [copia del rectángulo en HTML y texto](verification-table-selection2170.md#copiar-el-rectángulo). 2174 añade [la conmutación de la cabecera](verification-table-header2174.md). 2176 añade [altura de filas compartida](verification-table-height2176.md). 2179 añade [corte de texto en rectángulos](verification-table-selection2170.md#cortar-el-texto-del-rectángulo). 2180 añade [pegado de párrafos HTML con cabeceras por celda](verification-table-paste2180.md), con ampliación desde cursor y repetición en la selección. 2183 añade [archivos locales en el portapapeles de las celdas](verification-table-image-clipboard2183.md). 2185 añade [pegado y copia de celdas combinadas en una selección](verification-table-spans2185.md). 2188 añade el recorte de combinaciones al llegar al borde de la selección. 2190 añade el pegado de una tabla combinada desde cursor. Quedan los enlaces de imágenes remotas y comprobar las operaciones manuales de combinar o dividir en la referencia, adopción y los demás huecos del perfil compartido. [Pruebas y alcance](verification-shared-images2114.md).

## Añadir un campo escalar a Source — 2088

S02/SDK06/SDK07/SDK09: el primer incremento admite una declaración optativa y exacta, lectura del valor por defecto, primera edición atómica con historial y Deshacer de la misma sesión. Brave real, SDK y puente con dos claves verificaron la reapertura; la revisión 1 aprobó el corte `d078b70`. [Verificación y alcance](verification-sdk-source-additive2088.md). El esquema persistente general, la evolución de otros perfiles y los demás residuos de estas filas siguen abiertos.

## Estado actual: ejes compartidos2047 integrados

Main y primario incluyen fadf69a, aprobado en2047/revisión1. Las herramientas Source del perfil optativo pueden añadir o retirar filas y columnas por ID. La intersección sólo crea contenido al escribir y Deshacer conserva la aportación ajena cuando su soporte es representable. SDK/MCP y editor comparten escritor. Brave y puente real confirmaron la reapertura. [Alcance y pruebas](verification-table-axes2047.md). 2082 añade [ancho compartido por columna](verification-table-width2082.md), con Deshacer inmediato, SDK/MCP y reapertura. Quedan combinar o dividir celdas, adoptar documentos anteriores, IME físico y las demás diferencias del SDK. El alcance de las imágenes está en 2114.

## Estado actual: wiki por enlace propio2056 integrada

Main y primario incluyen 40d6fb9, aprobado en2056/revisión1. Los perfiles de wiki mantienen las capturas locales y ahora enlazan una edición congelada a una URL estable, pública o privada, con actualización y retirada desde UI y MCP. Brave, HTTP, revisión y puente de dos claves con reapertura en frío verificaron los pasos del producto. [Alcance y pruebas](verification-wiki-hosting2056.md). 2085 añade [retirada desde Inicio tras borrar el proyecto](verification-wiki-addresses2085.md). 2091 añade [portada para la vista previa del enlace](verification-wiki-cover2091.md). Contraseña e invitaciones aparecen reservadas a un plan superior en Brave. 2096 añade [lector separado que sigue sirviendo al cerrar Writer](verification-wiki-independent2096.md). Siguen pendientes dominio, programación, manuscritos servidos (2097) y los demás residuos agrupados de C44/D2/SDK27–28.

## Estado actual: imagen por mención normal2028 integrada

Main y el worktree primario incluyen b727329d, aprobado en2028/revisión1. Notas y Escritura permiten mostrar/ocultar la imagen por aparición enlazada, conservando alias, marcas y Deshacer. Brave comprobó el editor y la tarjeta guardada en frío; el puente real verificó dos claves por fase, reapertura, NoteCard y ReadingView. La preferencia normal está disponible por MCP, y las capturas compatibles usan el avatar admitido. [Contrato, pruebas y alcance](verification-mention-image2028.md). Quedan el compilador general DOCX/EPUB/Markdown/PDF, el perfil causal compartido y las demás diferencias; no se da por cerrada la paridad general.

## Estado actual: tablas compartidas fijas2003 entregadas

El incremento de tamaño fijo ya tiene inserción, texto/formato/enlace por celda, movimiento/retirada total y Undo que conserva contribuciones ajenas representables. El causal de movimientoB sin texto y el estado de los botones tras selección sola quedaron corregidos y verificados. Autor, peer, Brave y puente autenticado conservan ámbitos propios; los dos focos y gates del árbol compuesto también pasaron. [Contrato y evidencia](verification-shared-tables2003.md). La composición1cffcbdb está aprobada en2003/revisión1 e integrada Main/primary. El seguimiento40c2400a del aviso de key está aprobado en revisión2 e integrado; BraveR6 conserva HTML/23IDs/9celdas sin avisos. El primer hito fijo está entregado, pero el intentoR5 entre dos bibliotecas no se ha completado.

Siguen pendientes filas/columnas mutables, merge/split/anchos, imágenes/bytes y adopción de orígenes anteriores hacia este perfil; schema persistente ampliable, IME, hosting y rendimiento mantienen su alcance abierto. Las Notas conservan los controles2009 y las funciones previas; no se da por entregado todo consumidor/exportación ni paridad global. Los registros inferiores conservan sus estados históricos, sin reciclar aprobaciones de otros cortes.


## Estado actual: tabla normal2009 integrada

`d9039d3`, aprobado2009/revisión1, está Main/primary sin push. Barra contextual de diez acciones, selección y teclado, Undo/Save/reopen normales; MCP añade encabezado. Autor, peer33, Brave y Native55observadas=53éxitos+2rechazos tienen [evidencia separada](verification-table-context2009.md). C16 cierra ese control dedicado en el editor HTML; los demás consumidores/exportaciones no se dan por probados por esa UI.

La tabla causal compartida2003 aún NO está integrada. CUT3 corrigió movimientoB→UndoA con mismo causal peer13; Brave conservó textoB/cuadrícula, y detectó botones que no se actualizaban al cambiar sólo selección. CUT4 presenta un arreglo UI en revisión; no se atribuye como capacidad entregada. Imágenes, ejes variables, merge/redimensionado, adopción antigua y demás residuos siguen abiertos.2014 confirmó Show/Hide de imagen en una mención normal VVD y persistencia tras Undo/reload; Writer aún requiere implementarla y probar sus consumidores. Sin paridad global.

## Estado actual tras entregar la adopción de enlaces1958

Fuente `624474ba06e2903293e6d6a4814cf07eec31cf0c`, aprobada exactamente en1958/revisión2 e integrada Main sin push, completa la pareja conocida3→4: activación explícita, mismo historial y sala, recuperación de originales pendientes, propietario Undo, Save/frío y Leave local. [Contrato, evidencia atribuida y límites](verification-rich-links1958.md#existing-shared-histories). Enlaces nuevos93e1766, autoguardado1952 y contenido vivo1913 también están entregados; sus pendientes históricos inferiores no son trabajo nuevo.

La revisión independiente, Brave real y MCP real tienen ámbitos separados; el Native de adopción conserva FAIL de setup después de77tools de preparación y17lecturas frías, sin total94PASS. Imágenes/tablas del perfil compartido, schema ampliable, IME físico, coste de historiales grandes, hosting y las demás filas siguen abiertas. No se modifica el inventario histórico ni se afirma paridad global.

## Ahorro parcial de escritura compartida (1917 y 2192)

R8 recorre los tramos delimitados por anclajes y visibilidad. Con el mismo SDK, el percentil 95 a 10.000 unidades pasó de 377,51 ms a 349,28 ms y 363,15 ms. A 50.000 pasó de 2.103,91 ms a 1.814,64 ms. El objetivo de 100 ms sigue abierto. El pegado de 10.000 unidades en un solo gesto dejó el borrador recuperable sin guardarlo tanto con la base como con R8. VVD reabrió el mismo texto con cursiva en otra pestaña. Writers 2193 corrige ese caso. En un documento de un párrafo, Ctrl+A y pegar conservan la identidad del párrafo. Writer guardó y reabrió los 10.000 caracteres en cursiva en Brave.

R5 `2157bc37` y R6 `ca7c553f` están aprobados1917/revisiones1 y2 e integrados Main/primary sin push. Último oráculo100gestos/10k:321,022263ms de media y366,7179ms p95 frente al histórico511,4712/593,8358ms; R5 había dado360,787677/410,3989ms. Los contextos y límites de cada medida se conservan; no aceptación de fluidez,50k o coste sparse, ni cierre1917.

R6 añade Node165/109, peer81 con cobertura diferenciada, quick/build, Brave y NativeR3 nuevo58/66/58 con dos claves por fase y otro Electron frío. NativeR2 continúa FAIL por su HTML QA, sin89zero/401 acreditados. [Pruebas y límites](verification-rich-performance1917.md). La conciliación1957 actualiza diez anchors de exportación/SDK/runtime ya entregados; no cierra sus residuos. Continúan1952/autoguardado,1958/enlaces causales, latencia grande, IME físico, hosting y los demás huecos comprobables1095/1796.


## Contenido vivo1913 integrado — 03-11-2026

Source48ba665b,25rutas del CUT finalR3 ee833d17, tiene aprobación formal1913/revisión1 y está integrado Main/primary sin push. Intercambia el documento completo mediante opción explícita, manteniendo personas/cursores por defecto y el mismo writer/Undo. Save es local; salir concilia sólo el vuelo ya iniciado y recarga Source actual sin retirar el borrador de otras vistas. SDK/consulta/capturas/acciones/control se vinculan a esa instancia abierta y no fabrican un host frío.

Original8da/b6, Source59 y UI del autor, peer53+3, BraveRootR1 y el nuevo BraveR3 conservan sus atribuciones. El R3 pasó quick/build y Native nuevo58tools/66RPC/58IPC: dos claves genuinas por fase, SourceHost normal/dos campos, sesión UI/SSE real y frío en otro Electron/mismo perfil y origen, sin seed/host. Root verificó los25blobs/index/canon/no rastreados tras el FF y completó manual Google y continuidad con sus recibos propios; se conservan las rules ajenas y todo el contenido previo. [Pruebas y fallos preservados](verification-live-content1913.md).

Autoguardado1952 permanece pendiente como entrega posterior; hosting, rendimiento1917, IME físico, schema persistente ampliable, enlaces/imágenes/tablas y los demás residuos siguen abiertos. No se afirma integración del candidato de rendimiento ni cierre de filas enteras o de1095. El estado de presencia1893 descrito debajo sigue vigente para su modo predeterminado sin contenido.

## Deshacer con hijos de otro autor — 03-11-2026

Sourceef9abe94 aprobado1932r1 e integrado Main corrige el caso confirmado de contenedorA/hijoB: UndoA conserva B visible con texto, marcas e identidades, y sólo deriva el soporte causal necesario. Retiradas independientes/ocultación explícita no se revierten; slots incompatibles exponen conflicto. Original192/nuevos223/peer98, Brave y Native42 con dos claves/reapertura mantienen sus atribuciones. [Verificación y límites](verification-undo-support1932.md). No cierra contenido vivo1913, autoguardado, rendimiento1917 ni las demás filas del registro.

## Estado actual tras1883/1890/1895 — 02-11-2026

Bloques compartidos Source69899cb9 y publicación explícita de borradores Source004ee3e1 están aprobados en sus revisiones1 e integrados Main. Los encabezados/listas/citas/toggle ya no son sólo Stage; los campos publicados son opt-in por instancia Source, con consulta guardada por defecto y sin publicación implícita del cuaderno. Native combinado93 del Host compuesto y Native36 de publicación tienen recibos separados, junto a Brave/quick/build atribuidos. [Bloques](verification-shared-blocks1883.md) y [campos publicados](verification-sdk-published-fields.md).

Enter sobre un item vacío, Sourcee35a3185 aprobado1895r1 e integrado Main, conserva hoja/IDs y Undo autoral mediante una acción atómica. La numeración usa attrs actuales y mantiene aportaciones ajenas. RootBrave y Native40 nuevo (dos claves por fase, Save y otro proceso frío) tienen evidencia separada de los Native93/36 anteriores. [Pruebas y límites](verification-empty-item1895.md).

El estado de guardado Sourceaf68bee8, aprobado1920r1 e integrado Main, deja de mostrar actividad ficticia en un editor limpio y conserva el guardado inmediato y la recuperación. Los controles independientes24+21, Source26, legacy7, Brave y Native14 mantienen su atribución; R1rechazada no se reaprueba. [Verificación](verification-rich-save-status1920.md).

Presencia local 1893 añade perfiles elegidos por la UI, personas deduplicadas con conexiones distintas, publicaciones efímeras por instancia, hooks opcionales y consulta MCP readonly sin join. El vínculo local permite compartir presencia; el host presenta puntero/Follow y carets/selecciones causales conocidos, retirando las posiciones desconocidas y los miembros que salen. Awareness no modifica contenido, Save, Undo ni historial. Contenido vivo entre bibliotecas y hosting continúan pendientes; no se convierten las dos claves MCP en dos personas. [Contrato, atribución y límites](verification-sdk-presence.md).

Esta actualización supera únicamente los estados de entrega pendiente de1883/1890/1895 en las notas anteriores. No cierra filas enteras SDK34 ni1095: continúan contenido vivo 1913, hosting, coste de historiales grandes 1917, IME físico, schema persistente ampliable, enlaces/imágenes/tablas del perfil y los demás residuos no acreditados. El comportamiento de publicación no documentado del proveedor de referencia sigue sin atribuirse.


## Trabajo actual, 27-10-2026: dominio finito y apps locales

**Entrega55 integrada en Main, con alcance acotado.** Fuente `7989bfcad06531da35182e71cbe769e90136ce02`,133rutas de código; CAS55 aprobado exactamente, revisión641411. Final2:quick184833ms/crítica396151607ms/build394076ms,108guardas Source/133código exactos. [FFMain133blobs/disk](../../_stage/parity-map-domain-next/ROOT-main55-FF-r1.json) preservó48no rastreados, índice limpio, sin push. Manual81→1442UTF16/delta1361 y recurso completo verificados; [recibo](../../_stage/parity-map-domain-next/ROOT-manual55-receipt-r1.json). Se entregan subcontratos de A1-003/039/040/041 y SDK02/03/04/12/19; los residuos siguen separados y1095/paridad general abiertos.

Dominio: creación W×H, celda física, nueve anclas, crecer/recortar con relleno, journal v3 e identidad narrativa absoluta tienen pruebas focales; los mapas conservan los14 buffers de solape y Undo sin resucitar el terreno cortado al volver a ampliar. Las pruebas permanentes añaden nueve grupos de kernels finitos y86 comprobaciones públicas de puntos/regla/eras/clonación/limpieza, con Workers reales. El primer test de limpieza falló en dos snapshots de era; el cambio de deleteProject elimina también identidades de variantes de worldgen y sus claves runtime. El mismo test pasa por Root y por otro revisor, conservando el proyecto y bytes de control. Los positivos controlados de las otras dos cachés y del prefijo vecino se mantienen separados de los snapshots generados reales.

El recibo [Native de preparación3](../../_stage/parity-map-domain-next/ROOT-native-map-v3-pre3.json) prueba dos claves nuevas y transporte stdio→HTTP→IPC real:11 grupos,41 llamadas tool de stdio y2 Undo HTTP,104 entradas de fuente y9 del propio paquete exactas;88 tablas vacías,9 Workers terminados, EOF/pendientes0, claves revocadas401 sin IPC y servidor/ventana cerrados. La [síntesis Root](../../_stage/parity-map-domain-next/ROOT-cache-and-native3-summary.json) conserva el primer FAIL Native2 y sus límites. Es una ejecución histórica del worktree anterior a las últimas correcciones; no una prueba Native de la app Main ni del SDK nuevo.

Root verificó en Brave real la hoja propia300×600km/512×1024 después de recarga fría: Inicio,3D con borde inferior completo, regreso Mapa y Carta×1.0. La [revisión de cámara](../../_stage/parity-map-domain-next/ROOT-3d-camera-review-R2.md) distingue el plano y=0 de relieve/raycast y corrige el recuento de sus pruebas privadas a74 tablas indexadas. El caller normal del canon pasó43 asserts tras corregir la caché de WorldView; no se atribuye ese control a todas las operaciones de exportación o recarga.

SDK: defineLocalApp/registro/Host/Surface/instancias usan Source, sus clientes y rutas existentes. Las revisiones independientes causaron y corrigieron captura owned con canon excluido, pérdida de subárbol pendiente al cambiar pin y cinco requisitos de definición/registro. Se conservan sus RED y los mismos GREEN; un positivo posterior pulsa Discard real y adopta v2 con cliente viejo revocado, datos/historial/pin exactos y ledger resuelto. [Revisión5](../../_stage/parity-sdk-app-host-next/independent/SDK-SOURCE-RETEST-CUT5-R3.md) y [resolución del borrador](../../_stage/parity-sdk-app-host-next/independent/SDK-CHILD-RESOLUTION-R4.md). P2 tiene12 grupos completos; P1 canónico R12 tiene13, conservando las brechas previas del observador React. Root ejecutó Native real de las cuatro herramientas: dos claves,23 tool calls/27RPC/23IPC,2112 entradas exactas,88 tablas privadas vacías y cierre/revocación completos. En Brave real verificó Host/Surface, rutas independientes, documento compartido, Save/Undo, recarga y aislamiento de era; limpió sólo sus dos proyectos propios. [Revisión y límites de transporte/web](../../_stage/parity-sdk-app-host-next/ROOT-native-and-brave-review-r1.md): no se acredita descarga web en disco ni instalación fría de paquete por esa fixture DEVELOPMENT. El borrador propio del Host tuvo después su RED→GREEN literal y repetición independiente; Root NativeSDKfinal1 posterior al fix repitió23tools/27RPC/23IPC/2112inputs y cierre completo, con SDK40 exacto. Estos resultados no cierran CRDT, paquetes runtime, hosting ni todo HostServices.

La revisión final reprodujo tres fallos de reinos/caminos y ocho de viajes finitos, corregidos y repetidos con los mismos oráculos por revisor independiente. [Informes y alcance](verification-world-domain.md). Después, Native causó cinco fallos de seis criterios de coordenadas MCP; el mismo escenario pasa tras cinco líneas de corrección y Root lo repitió personalmente sobre final2 con dos claves/108fuentes exactas/88tablas vacías/cierre completo. Map2D pasó de omitir sus cinco marcas a dibujarlas una vez; su repetición intermedia detectó dos dots/trails en Mercator finito y el mismo R4 ahora pasa con topología explícita. Los tres controleslegacy conservan literalmente observaciones y píxeles. Root verificó en Brave frío el itinerario guardado15km/2,8h, extremos en Mercator y línea visible en equirectangular. [Revisión Root y límites](../../_stage/parity-map-domain-next/ROOT-boundary-and-annotations-review-r1.md). `renderCartography` conserva un caller envolvente distinto, detectado estáticamente y con próximo oráculo preparado: no se le atribuye este GREEN ni se cierra todo Carta/export.

Referencia viva27-10: herramienta Map oficial0.1.63, con Continent/Island/Archipelago/The Mediterranean. El preview mediterráneo muestra costa, nombres, ciudades y caminos; Roma se seleccionó como lugar editable. Root pulsó Remove names and roads en ese preview: desaparecieron nombres/caminos y quedaron terreno/puntos urbanos. [Antes/después y límites](../../_stage/parity-map-domain-next/ROOT-reference-remove-names-0163.md). No se crearon documentos ni se probó eliminación persistente o Undo; no se infieren polígonos provinciales de las etiquetas. La preparación de A1-007 queda en [brief de procedencia/contrato](../../_stage/parity-mediterranean-next/BRIEF.md), pendiente de implementación, sin cerrar la fila.

El resto del registro continúa abierto. Sólo se excluyen las suboperaciones con API externa o pago demostrado; esta fase no altera ese criterio.

Reconciliación documental del 26-10-2026 para tarea **1095 / hilo1195**, identidad raíz `codex-writer1095`. Base comunicada por ROOT: Main y WT `bc3646d9d09faf120ab198a710b4938bb5fc6c82` (clips y documentación entregados). **La tarea y la paridad general siguen abiertas.** Este fichero no ejecuta pruebas, no aprueba una entrega ni declara un porcentaje de paridad. Los PASS citados pertenecen a sus recibos originales, no a esta lectura.

El encargo continúa hasta cubrir la paridad funcional web y SDK. Sólo una **API externa o un pago demostrado** permite excluir su suboperación. ONLINE, multiplayer, hosting, servidor propio, contenido remoto, una firma diferente o un antiguo «non-goal» no son exclusiones. No se ejecuta escritorio ni se hace push. No se añaden permisos, cuotas artificiales, vigilancia ni puertas de aprobación como sustituto de capacidades.

## Fuentes y regla de actualización

Fuentes auditadas completas, con evidencias y rutas de producto/test por fila:

- **A**: [Atlas/Campaign REPORT](../../_stage/parity-completion-next/atlas-campaign/REPORT.md) y [PRIORITIES](../../_stage/parity-completion-next/atlas-campaign/PRIORITIES.json).
- **T**: [Tools/Writing REPORT](../../_stage/parity-completion-next/tools-writing/REPORT.md).
- **S**: [SDK/Platform REPORT](../../_stage/parity-completion-next/sdk-platform/REPORT.md) y [PLAN](../../_stage/parity-completion-next/sdk-platform/PLAN.md).
- Matrices originales: [A1](A1-atlas-authoring.md), [A2](A2-atlas-lenses.md), [B](B-campaign.md), [C](C-writing.md), [D1](D1-tools.md), [D2](D2-platform.md). Se reconciliaron sus tablas originales de capacidades, estado y gap; una columna Gap antigua no prevalece sobre su estado añadido ni sobre una verificación posterior.
- **I1041**: [inventario1041](../worldcraft1041-feature-inventory.md), bloque `current-148`, niveles, E1–E49 y las referencias pertinentes W/C/Q/R/X/M/A/P/S; sus repeticiones históricas no son otra evaluación actual. Las auditorías A/T/S remiten a los task1041 y recibos concretos: aquí se conserva esa atribución, sin afirmar haber reejecutado esos taskfiles ni su QA.
- Continuidad leída: `D:/LocalAI/CRITERIOS.md` primero, AGENTS del WT y tramo Writer1095 pertinente de `D:/LocalAI/MEMORY.md` (la salida extensa inicial se truncó; se recuperaron tramos recientes y referencias concretas, sin presumir lectura íntegra de entradas de otros proyectos).

Identificadores A1/A2/B/C/D1/D2 corresponden al número original de fila; `-aboard`, `-growth`, etc. son subcontratos que las auditorías encontraron dentro de PRESENT. SDK01–52 son el índice documental de S, no nuevas filas del catálogo. Una fila agrupada conserva **todos** sus IDs; cerrarla requiere resolver todos sus subcontratos o separarlos explícitamente.

Estados: **G** diferencia concreta localizada por auditoría de fuente; **P** parte funcional entregada y residuo concreto; **V** implementación localizada que necesita una prueba específica; **U** contrato de referencia/estado aún insuficiente; **E** falso hueco antiguo, flujo acotado ya entregado; **X** sólo dependencia externa/pago identificado. **BATCH** es trabajo actual sin cierre verificable. Prioridad pequeña o cosmética no equivale a exclusión. Salvo observación primaria acotada señalada por A/T/S, la conducta VVD viene de cadenas o documentación: antes de especificar su detalle debe contrastarse; no se inventa su comportamiento.

Al actualizar: enlazar fuente/commit exactos, contraste primario y recibo UI web + MCP/Undo/portabilidad que corresponda; conservar FAIL, límites y atribución. No sustituir «no probado» por «ausente», ni «hay fichero/tool» por «funciona». Un cierre parcial conserva el resto de esta fila. El catálogo de herramientas no certifica todos sus transportes.

## Lote integrado: cuatro deltas, sin cierre global

Actualización de ROOT tras aprobar CAS49 e integrar a8e9ba6+a55e6e por FF: Main manifest949, contratos6 y Nativefoco2claves pasan; merge liberado. [Evidencia atribuida completa](verification-rows-places-zones-focus.md). La auditoría inicial sigue siendo lectura documental y no se rebautiza como ejecución.

| IDs | Cambio en trabajo | Estado de cierre |
|---|---|---|
| C-95 | Insert above y orden manual de filas authored, MCP/Undo | **E/P**. Gesto Pointer real, teclado, IDs/celdas/referencias, filtros, CAS/Undo/eras/portable y dos claves verificados; CAS49/Main. Orden de vista viva del Códex sigue separado y pendiente. |
| A1-054 | Buscador de tarjetas por título/alias en inspector de lugar | **E** acotado. Picker normal, palabras/acentos/alias, grupos anteriores, link/OpenCard, scope/era y puente existentes verificados; CAS49/Main. Crear/abrir tarjeta ya era producto antes. |
| A1-067 | Intensidad de zona 0–100% | **E** acotado. 0/50/100, Map2D real/PNG/MCP/Undo/reopen/eras verificados; 12 casos positivos antiguos RGBA exactos, cero conserva nombre/zona. CAS49/Main. Dato opacity/MCP ya existían; el rango0.05–1 es histórico. |
| SDK47 / S09-foco | focusMode del shell real, SDK/hook y get/set MCP; catálogo949 | **E/P** acotado. Shell real, dos borradores/clientes/nodos/eras, revocación/unavailable, get/set por dos claves y CAS49/Main verificados. Otros hosts/ABI general siguen sus residuos; fullscreen mantiene su acción separada. |

No se reduce la tarea a estas cuatro unidades. Tras integrarlas siguen las diferencias y verificaciones siguientes.

## A1: autoría de atlas

Fuente A y matriz A1. Sin dependencia externa demostrada salvo suboperación identificada en la tabla X final.

| IDs | Estado actual y residuo / criterio de cierre |
|---|---|
| A1-003 / A1-039 / A1-040 / A1-041 | **P/E acotado**. Entrega55 Main/CAS55 incorpora W×H físicos/celda, nueve anclas y marco de borrador, crecer/recortar terreno con relleno mar/tierra,14arrays calientes, journal/ABS/Undo/era/portable y MCP. [Verificación y pérdidas frías declaradas](verification-world-domain.md). Sigue el consumidor renderCartography de marcas del lector y contrastes aún no acreditados; no extender Map2D a todos los exports/proyecciones. |
| A1-007 | **G/U**. Falta starter histórico mediterráneo editable con provincias/caminos/ciudades y procedencia. Confirmar el contrato romano/bundled; modernos countries110m y presets existentes no lo sustituyen. |
| A1-009 / A2-049 / A2-050 / A2-051 / A2-055 | **P/G/U**, no X. Background raster, calibración/keypins y edits ordenados existen; faltan imagen→landmask/heightmap/terrain, triage/revisión manual suelo/lugares y reconstruir conservando añadidos compatibles. La supuesta nube se infirió de cadenas; investigar dependencia real y probar revisión/rebuild offline con identidad estable. |
| A1-010 | **P/G**. Las capas ya persisten. Falta retirar en lote nombres/caminos generados con intención persistente y Undo; ocultar capa no equivale. Primaria0.1.63: la acción de su preview quita visualmente nombres/líneas y conserva puntos de ciudades/terreno; su persistencia, entidades y Undo siguen sin acreditarse. |
| A1-013 | **P/U**. CityPlan procedural/descenso existe. Autoría urbana independiente editable y navegación world↔city con identidad requieren contraste VVD antes de exigir un editor urbano nuevo. |
| A1-015 | **G**. Portada elegida/cambiar/quitar distinta del thumbnail derivado, por era y portable, sin alterar terreno/background. |
| A1-016 | **G/U**. Performance test user-facing y reporte copiable; observar medidas de referencia antes de definirlo. No excluir por «low value». |
| A1-025 / A1-064 | **P/G/U**. Dibujo point/freehand, ancho al dibujar y MCP existen; classic MAP inserta/elimina vértices. Falta seleccionar y editar después ancho/vértices de río/camino Worldgen sin rehacer los demás. El upstream de edición de caminos es inferido: contrastarlo; Undo/reload/ID/MCP coherentes. |
| A1-037 | **G**. Ground designer propio: imagen/mezcla/tinte/grano/tiling km/travels-like y repintado al borrar; render y ruta/JSON/ZIP sin red. Biomas y siete GroundClass existentes no cubren suelo authored. |
| A1-038 | **P/U**. Generate y ajustes live existen. Concretar ajustes no generativos/reset/preview/cancel que falten sin confundir Generate con defecto. Guardar sólo confirmado y conservar ediciones. |
| A1-043 | **P/G**. Loop área/perímetro existe; falta hover sobre zona/realm existente con mismos resultados de escala/latitud y MCP. |
| A1-046 | **E/P/U**. Catálogo/search1688 geometrías ya entregado. Residuo: usar icono de tarjeta enlazada/fallback y comparar inventario temático observado; igualdad de cantidades no prueba cobertura. |
| A1-047 | **P/V**. Copied-raster File/Gallery colour/inked ya integrado0e2ba761/CAS26. Comparar selección/escala/límites/fallback VVD. Descarga normal Brave no confirmada no anula PNG productivo probado por otra vía. |
| A1-048 / A1-049 | **P/G**. House/tower/keep/hall/cabin/windmill y siete paletas culturales existen. Falta casa festoneada/material colour-vs-inked del mesh, paletas neutrales y roof/wall/trim independientes en2D/3D/PNG/MCP/Undo. Raster inked no modifica mesh. |
| A1-050 | **P/G**. Color hex existe. Swatches de tinta y reset a herencia del mapa; cambio de tema debe demostrar ausencia heredada frente a color fijo. |
| A1-051 | **P/G/U**. Font/size existen; quedan bold/italic/caps/color/presets y herencia coherentes en todos consumidores. Referencia primaria Map0.1.63: Hispania es rótulo con giro/espaciado/curva; Lettering ofrece Fell English/Cinzel/Garamond/Crimson/Plain, tres estilos y presets Region/Water/Peak. [Observación y límites](../../_stage/parity-map-domain-next/ROOT-reference-lettering-0163.md). No se infiere licencia de fuente ni persistencia por abrir el selector. |
| A1-052 / A2-059-title | **P/G**. Rotación/espaciado/curva/sliders/MCP existentes; faltan rank Title y cuatro handles de resize sobre lienzo, con mismo shape/Undo/exports. |
| A1-054 | **E**. Véase lote integrado y verificación; no falta create/open de todos los tipos. |
| A1-055 | **G/U**. Reroll gráfico del lugar con semilla/Undo sin cambiar nombre/coordenadas/mundo; observar qué cambia en VVD. |
| A1-058 / A2-062 | **E/P/G**. Cerrar/abrir paso ya afecta rutas. Falta toggle gráfico de puente por camino/cruce que coincida con ruta y restore; no rehacer ford solver. |
| A1-059 / A1-061 / A2-058 | **P/G/U**. 32stamps/4categorías/S/M/L incluyen muchos glyphs que el Gap viejo negaba. Comparar vocabulario y añadir sólo faltantes observados (ship/seaMonster/pine/hill, etc.), furniture como objetos editables y variantes multi-tono/material por glifo; portable sin perder posición/tipo. |
| A1-060 | **P/G**. Farms/hamlets procedural existen; layout mixed/farmsteads/hut-hamlets configurable por zona, reproducible con seed/Undo/MCP. |
| A1-062 / A2-056 / A2-057 | **P/G**. BlankSea/blankLand, biomas, stamps, roads/rivers/borders existen. Falta lienzo cartographer libre completo: wall/fence/hedge/cliff/street/border y plots con autoillustration, control points y semántica travel explícita; editar sólo regenera el elemento, export/MCP normales. |
| A1-067 | **E**. Véase intensidad integrada y verificación; sin campo/tool duplicado. |
| A1-068 | **G**. Hide/show/recenter/cut-loose de etiqueta de zona y edición de puntos; labelVisible actual significa alwaysShowName, no hide. Ancla/nombre independientes del contorno con reset/export. |
| A1-069 | **P/G**. Classic MAP ya tiene named/multilayers. Residuo image-map icon/search/hidden-count/options; Worldgen capas authored y asignación por objeto con visibilidad uniforme2D/3D/Carta/Reader/MCP/export. Borrar capa conserva objetos. |
| A1-070 | **P/G**. Leyenda derivada existe; faltan símbolos/zonas/captions/corner authored, overrides persistentes y mismo frame PNG. |
| A1-071 / A1-072 | **P/G**. Snapshots classic completos/fecha/eventId/orden/play/orphan y eras COW ya existen. Faltan terreno temporal «desde aquí», prev/next, strip, Open Timeline/find/new/unlink y límite/confirmación concretos. Editar t2 no cambia t1; borrar evento conserva snapshot y estado orphan. |
| A1-074 | **E/D**. Remite a A2/TRIP/FOG/B; no segunda tarea genérica de party/journey/reveal/event. |
| A1-075 | **E/P/V**. MCP de worlds/terrain/biome/rivers/lakes/roads/zones/travel/fog/trade/presentation/features/layers/versions existe. Residuo inventariar UI→op→tool de sheets regionales/resize/regenerate y guardar/listar itinerarios (plan actual es read). Probar transporte+Undo por acción restante, sin fachada duplicada. |

## A2: lentes, imagen, viajes y economía

Fuente A; residuos compartidos con A1 conservan sus IDs arriba.

| IDs | Estado actual y residuo / criterio de cierre |
|---|---|
| A2-001 | **G/U**. Starter image-map por género/walkthrough con datos propios editables offline; no falta upload genérico. |
| A2-012 | **E/V**. CodexEntryPicker onCreate y createEntryFromMap ya existen; el «no create card from pin» es falso. Verificar pin→create/link/open, color/size/hideIcon y tool actuales en flujo normal. |
| A2-019 | **V**. CAS local existe; probar dos montajes cambiando background mismaDB. ONLINE no excluye el conflicto ni demuestra fallo actual. |
| A2-020-share / A2-048 | **P/G/U**. Reader/player preview y trade play local existen; entrega a peers y play/pause compartido con identidad requieren contrato propio / servidor, sin API externa demostrada. |
| A2-023 / A2-037-aboard | **P/G**. Pace/rest/directions/clock/playback existentes. Falta fecha absoluta de salida/llegada usando calendario del mundo y caption aboard según tramo agua. Probar mes/intercalario/año/descansos y itinerary/MCP/export. |
| A2-024 / A2-026 / A2-025 | **P/G/U**. Story events/orden/replay **por capítulo** funcionan. Residuo identidad de sesión real/Now/As-you-saw-it/next-planned y replay histórico, quién estuvo y estado sesión; FICT ya tiene sesiones. No aceptar equivalencia universal chapter=session ni afirmar que no existen sesiones. |
| A2-028 / B-020 | **P/G**. Reader start/town dots/chapter trail funcionan; los subcampos sight km/date/lookback/session number se cierran por B020/022/025 y no por PRESENT agrupado. |
| A2-030 / A2-031 / A2-035 | **P/G**. Ways custom/speed/flies/night, paces y ford/bridge/frozen costs existentes. Faltan icono/flags de terreno/vado/paso por way, intervalo rest editable, never/impassable, trail como suelo y ford penalty configurable. Dos ways iguales de base con restricciones distintas deben dar rutas distintas; defaults antiguos intactos. |
| A2-036 | **P/V**. Horas/día/set-off/shelter/clock existen. La matriz aún distingue playback en días frente a horas: contrastar presentación actual antes de cerrarla por clock del solver. |
| A2-039 | **G/U**. Open card existe; falta Directions from here desde inspector. Observar si conserva destino/modo; después exact-origin→JourneyPanel/solver/save/reload con era/lugar correctos. |
| A2-041 | **P/V**. Route words/grounds/roads/water existen; representación air y river-vs-sea no se cierra con frase water ni con vuelo del solver. Contrastar necesidad actual antes de añadir vocabulario. |
| A2-043-growth | **P/G**. Needs/granary/shortage/fed/price existentes, población fija. Crecer/descender por shortage/surplus sin mutar población base; mismo mes/seed/reset da estado reproducible. |
| A2-047-speed | **P/V**. Play/pause/next/reset/scrub y shipments existen. Comprobar speed/date y seed/start persistentes; velocidad distinta llega al mismo estado y pause no añade tick. |
| A2-049 / A2-050 / A2-051 / A2-055 | **P/G/U**. Desglose image→terrain/review/rebuild en A1-009; no excluir el editor manual por su origen supuesto AI. |
| A2-053 | **P/U**. Caminos classic por puntos y handles/Enter/Backspace/Esc/line styles existen. Segmentos rectos frente a curvas es límite explícito de matriz; verificar contrato de curva actual, no inferirlo de la palabra bends. |
| A2-056 / A2-057 / A2-058 / A2-059-title | **P/G/U**. Cubiertos en autoría A1-052/059/061/062; no duplicar motores. |
| A2-060 | **P/G/U**. Duplicate/lock/size/angle/delete existen. Density/rotation/reroll individual/style/all persistentes sin cambiar datos ajenos; distinguir reroll objeto del mundo entero. |
| A2-063-classicPNG | **V**. Worldgen PNG whole/view/grid sí; classic MAP SVG sí. PNG classic no acreditado: cerrar con salida local que refleje background/layers/fog/scale, no transferir PASS Worldgen. |
| A2-064 | **P/G**. Blank/island y town procedural existen. Starters river-valley/walled-town authored editables faltan como tales. |
| A2-065-drop | **P/G**. Link/placeCards existen; falta drag-card→sheet creando landmark/pin enlazado con mismoID/Undo atómico. |
| A2-066 | **G/U**. Demo play/replay user-facing; observar enseñanza/conducta antes de implementar, no excluir por antiguo skip. |

## B: campaña, sesiones, mesa y personajes

Fuente A y B; referencias primarias limitadas:5e ataque manual/clase y CoC fueron observados en subflujos acotados, no todo el wizard/tracker.

| IDs | Estado actual y residuo / criterio de cierre |
|---|---|
| B-001 / B-009 / B-025 / B-061 / B-077 | **P/G**. Sheets/FICT entities/attendance existen. Falta roster campaign estable, seat/player↔character/premade/claim/intake/DM questions/finish-later y panel party/DM actual con AC/Init/speed/passive/status/mentions. Añadir/quitar conserva ficha; tracker add-party sólo PCs activos. Invitación/identidad local no excluida por ONLINE. |
| B-002 / B-003 / B-017 / B-018 / B-019 / B-040 / B-080 | **P/G**. Mundos/eras/documents/wiki editions y exchange existen. Falta contenedor campaign name/pitch/wizard/review ligado al world, selección all/chosen/none viva, mapa/overrides propios, instance/rebase de publicación y hub Campaign/Planner/Map/Journal. Dos campañas heredan y divergen/reinherit sin copiar al leer, sin tocar world/hermana, conservando drafts/referencias. |
| B-004 | **G**. Party chat/replies/delete con participantes propios; annotations no sustituye chat. Servicio local/self-host viable, no externa demostrada. |
| B-005 / B-006 / B-012 | **G/P**. Poll fechas/answers/best/tie/lock/answer-by, RSVP/reminders/comments/next-step/live-soon, voto sistema y setups propios. Cálculo/persistencia/respuestas manuales locales primero; entrega remota se desglosa, no excluye el núcleo. |
| B-007 / B-041 | **P/G**. Dice pool/modifier/adv/dis/repeat/log/natural/target/formulas ya funcionan. Falta entrada física/manual distinguida, who/source/visibility filters y broadcast/turn identity separado; no crear roller duplicado. |
| B-008 | **G**. Journal player single-author pencil/signature/private-party notes/drawing/frontmatter/map; tinta de sheets no cubre journal. Probar contenido público/privado y portabilidad real. |
| B-010 / B-074 | **P/G/U/X**. Fetch D&D Beyond tercero excluido; JSON propio/reimport/source/snapshot/provenance siguen locales. Sheet import/export existe; conservar identidad/cambios locales frente a snapshot reimportado. |
| B-011 | **P/G/X**. Compra/licencias ajenas sólo X si requeridas; biblioteca propia de módulos/homebrew/preview/search/origen y creación world-from-adventure siguen pendientes. No declarar todos los módulos de pago. |
| B-013 / B-028 | **P/G/X**. Mapbox X; scheduling UTC/timezoneLabel/duration/place/hook/status funciona. Falta usual-place/override/countdown/IANA edit/ICS y video-room link manual local; probar DST/reprogramación/otra zona sin exigir poll. |
| B-014 | **P/G**. Voice memo existe; asociar grabación a carta/invite y preview/narración local faltan. Publicar/entregar es dimensión separada. |
| B-015 / B-029 | **P/G/U**. PREP letter/caseFile/terminal/noticeBoard SVG/PNG/signature-text/editor existen. Falta runtime local tap-to-continue y dream/font/drawn-signature si observados, PDF y editar misma gallery row por MCP conservandoID/bloque. |
| B-016 | **G/U/X condicional**. Bookmark/PWA/addhomescreen y acceso local pendientes, sin externa obligatoria. Email-link sólo X si requiere proveedor de entrega; backend de identidad propio no es pago por definición. |
| B-020 | **P/G**. Picture reveal/party/session trail y Worldgen reader-start existen. Picture land/ink presets, sight km calibrado, historial/lookback y fog embedded/world-bible necesitan cierre. Raster land-in-ink requiere clasificación;100km/radio5km y replay/export visibles coherentes. |
| B-021 | **P/G**. Party layer picture/MCP y journey point stops/playback existen; falta picker nearX/sea/distance y party persistente en generado distinta del marcador transitorio. |
| B-022 | **G**. Today-story persistente y calendar source/avance por sesión/itinerary; cruzar día/mes/año del mundo sin fechaPC ni sesión ajena. |
| B-023 | **P/G**. None/snow/rain/embers/fireflies/intensity existen. Fog/leaves/petals/stars/aurora/runes/bats y scope campaign pendientes, cada efecto real respeta motion/performance y persiste. |
| B-024 / B-031 / B-078 | **P/G**. Hooks/presets y DM notes privados existen. Campo público pre-notes/teaser/session1 banner y policy/preview separados; exports públicos jamás incluyen DM, aunque enlazado. |
| B-026 | **P/G**. 5e 2014/2024/DH/CoC/freeform settings y custom sheet presets existen. Falta PF2e/own system como reglas campaign y compatibilidad módulos; elegir setting no selecciona lógica de ficha automáticamente. |
| B-027 | **P/G**. 40notas info add/update/move/remove existen. Icon/collapse/rich text/image y vista info campaign; mismo orden/MCP/export y exclusión DM. |
| B-030 / B-045 / B-046 / B-048 | **P/G**. FICT planned/live/played/hook, planner rail/group/status y slash31/prep blocks existen. Falta numeración/timeline/reorder/insert-before/hidden-until-recap/GM-only; Prep+SceneN tabs reales, notas/icons/split `/scene`/merge; rail/tabs/colors/resize/collapse/delete Undo y editor fiction prep rico. Dividir/mover/reabrir conserva texto/IDs/links/drafts/foco. |
| B-032 | **E/P/V**. Manual recap draft/ready/played/download sinDM y start/end ya entregados. Conservar test atómico/edit→draft/preview; hosted delivery/comments locales son subflujos residuales, no rehacer recap básico. |
| B-033 | **P/G**. Wiki editions/diff/reveal/publication existen. Journal Shown/Hidden/Waiting por página, pending-dot y grupos type colapsables; sólo fila afectada pending hasta republicar, edición vieja literal. |
| B-034 | **P/G**. Cover/reader/wiki styling existentes. Book binding/material/emblem/leather/RunBy y preview/export consistentes. |
| B-035 | **P/G**. Banner/wiki y Codex crop existen; falta banner/crop propio por campaign/session, dos recortes de misma foto sin cambiar fuente/hermanas. |
| B-036 / B-037-writingsPlayer | **P/G**. Codex reveal/playerView/wiki onlyRevealed/hide/spoiler existen. Falta reveal por bloque/statblock ligado a SessionID, marcador fiction+lore combinado y preview player de notes/writings físicamente admitido. Replay sesión anterior conserva su estado. |
| B-038 / B-060 | **P/G**. Context/reference pins por capítulo/book/search y sesión de ventana existen. Faltan biblioteca/ref list campaign/type/letter, bookmarks arbitrarios/rules/grid y scope sesión durable; no cambiar pins de otros scopes. |
| B-042 / D1-33 | **P/G/U**. Seis sets, device prefs y throw2D CSS existen. Throw3D real por contrastar (física VVD no demostrada); mantener resultado/RNG/reduced-motion/lazy y preferencias reales. |
| B-043 | **P/G**. SRD cuatro familias lazy/search/get/add-world/add-fight funciona. Falta general rules/book chapters, pin-to-scene, homebrew shelf campaign/world/adventure y corpus adicionales; D1-01/02/04/05 detalla contenido. |
| B-044-trackerStatblock | **P/G/U**. Statblock completo/papel/secciones sí; tracker source kind/id/hp/ac no es ficha completa. Abrir fuente real del combatiente y contrastar lair/mythic sin confundir snapshot HP con sheet compartida. |
| B-049 | **G**. Mark spoken/contador por bloque y sesión, distinto de callout readaloud/TTS. Estado/estadística no cambia contenido ni cuenta TTS como hablado. |
| B-050-revealAfterRoll | **P/G/U**. Check guarda resultado/log; falta nota reveal-conditioned y bonus desde skill-sheet si referencia lo confirma. No inferir conducta del rótulo. |
| B-051 | **P/G**. Parse/linkSRD/card→fight/encounterId/open funcionan. Live/done ligado al mismo combate y nueva preparación explícita; card-stats y estado no regeneran accidentalmente combate. |
| B-052 | **P/G**. Thumbnail/Gallery/studio edit/when existen. Open full-size, delivered por sesión y bytes de imagen en Reader/export (hoy caption); click/portabilidad/estado reales. |
| B-053 / B-054 | **P/G**. Writings dock stack/height/span/Source y presets primeros docs existen. Tabs de panels/kinds tracker/dice/compendium/party/bookmarks, tidy/drag-between-tabs, elección docs/PDF y setups nombrados adventure/campaign; remount conserva estado y Duplicate remapeaIDs. |
| B-055 | **E/P/V**. Tracker real ya tiene turno/ronda/next/back/sort/add-name/sheet/monster/end. Falta add-party del roster y contrastar clear vs end; no usar example initiative foreign ni declarar tracker ausente. |
| B-056 | **P/G**. Damage/heal/tempHP/death/Undo MCP existen. Set-currentHP directo, multi-select/half damage, historia Undo/Redo UI explícita; daño10 absorbe temp3 yhp7 sólo seleccionados, revert exacto. |
| B-057 | **P/G**. Until-removed/rounds/decrement/custom MCP existen. Minutes, custom words UI y inline rule lookup; conversión por sistema observado, persistencia y reglaSRD real. |
| B-058 | **E/P/V**. Death-save1/20/hit-zero y concentrationDC/max30/prompt ya existen. Verificar reglas/casos contra fuente; workflow save concentration enlazado aún parcial: fallo quita concentrating sin alterarHP. |
| B-059 | **P/G**. Roll all/missing/selected puro, modifiers/sort/setinitiative existen. Row-roll UI, tie-drag, targeted attack-vsAC/applydamage y all-foes-down; preserve no target rows/log/Undo. |
| B-062 | **P/V/U**. Panes/toolDock existentes; tray resize/Add-to-page exactos no acreditados. Contrastar, después crear linked block normal conservando ID/era, no segunda copia. |
| B-063 | **P/G**. Start/end y timestamps existen. Elapsed timer/pause/SceneNofM/header, reload coherente sin avanzar otra sesión. |
| B-064 | **P/G**. Attendance/manual recap/status/retire existentes. End sheet spoken/checks/fights/rounds/cards y auto recap **draft editable** sin dados/DM/unrevealed, sólo sesión actual. |
| B-065 / B-066 | **P/G**. Attendance present/entity/note UI/native y status/retire existen. Historial por character/unset/absence labels y vista alive/dead/retired de fin sesión; cambios explícitos conservan momento histórico, ficha y asistencia ajenas. |
| B-067 | **P/G**. Heading split/import_story_session existen. Import semántico SessionN/ISO/bulk titles con review/merge/split/reorder/insert-before/Undo; fixture ambigua pide ajuste local y Undo una unidad. |
| B-068 | **P/G**. Archive/restore documents existen. Archivo campaign completo con opción lectura/conservación refs/export/restore y estado visible; no sustituir por disable engine ni bloqueo general. |
| B-069 / B-070-DHconsume | **P/G**. TableRules panel/settings/reset/CAS/backup y notas consumidas existen. Falta books selector y efectos de opciones en sheets/dice/fight, criticalDamage en attack, DH Experiences/Fear/rest/gold consumidos. Cada opción cambia mecánica pertinente y conserva defaults antiguos. |
| B-071 / B-076 | **P/G**. Class/level/HP preview/actions, manual rows/spells, name roller y portraits propios existen. Wizard species/background/feat/boosts/point buy27/skills/expertise/spellbook/gear/review/print y sugerencias inline sin ficha extra, stock/placeholders con licencia. Reglas verificadas número a número, no falta general de5e/names. |
| B-072 | **P/G/U**. Ataque manual/rollhistory/paper/MCP y health/spells/resources entregados. Targeting/critical/AC/resource automation y rollable actions con imagen no demostrados por tirada manual; concretar referencia y Undo conjunto/portabilidad. |
| B-073 | **P/G**. CoC derived/override y fiveE applied/detach/spell overrides existen. ShowMath unificado con inputs/source/effects/formulaerrors/as-entered, reset exacto. |
| B-075 | **P/G/U**. Paper SVG/PNG/Reader existen; botón print/PDF directo no localizado en engine/editor. Contrastar salida upstream y producir salida web imprimible completa sin recorte, todos presets pertinentes. |
| B-079 | **P/G**. Next move/project home existente por documentos; falta guidance según campaign plan/schedule/recap/next-session real. Terminar recap cambia sugerencia pertinente. |
| B-081 | **P/V**. LibreríaDnD y flechas/select accesibles no prueban anuncios. Teclado completa reorder/cancel campaign/planner/map y anuncia origen/destino/resultado ES/EN con foco correcto. |

## D1 y C: herramientas, escritura y publicación

Fuente T; duplicados B/SDK conservados por IDs. No repetir capacidades entregadas de las filas E del informe.

| IDs | Estado actual y residuo / criterio de cierre |
|---|---|
| D1-01 / D1-02a / D1-04 / B-043 | **P/G**. SRD5.2 monster/spell/item/condition search/pages/add/credit existen. Falta chooser corpus2014/DH/persistencia campaign, shelves clases/species/backgrounds/rules/feat/equipment/TOC/recents y facts/requisitos/outline de esos kinds. Dos corpus propios atribuibles seleccionables y mismo corpus en búsqueda/get/seeding/UI/MCP/backup. |
| D1-05 / I1041-R13 | **P/G/U**. DH sheet/adversary/tier/HPStressArmor/paper existe; falta corpus adversary/domain/environment y seeding, contraste thresholds/type/features/Fear. Investigar contenido reutilizable real, sin declarar todo DH prohibido. |
| D1-06a | **E/P/U**. Gear/XP-in-lair ya se pintan; saves en línea existen. Residuo columna Save por ability si referencia demuestra diferencia material. |
| D1-07a | **P/G/U**. Todas secciones statblock ordenables/paper existen. LegendaryUses tipado ligado a sección no localizado; recursos/description no demuestran equivalencia exacta. Contrastar y, si falta, campo opcional/paper/MCP/Undo sin alterar legado. |
| D1-08 / D1-17 / D1-19 | **P/V/U**. Spellcasting generado/at-will/Nday y spells catálogo/rows existen. Matriz conserva límites de spell-list structured/picker y proficiency armor/weapon/tool typed. No nuevos gaps generales por esas frases viejas: contrastar cada control concreto actual y comprobar fuente antes de añadir. |
| D1-09 / D1-10 | **P/G/U**. Statblock name/detail/expression/quantity, sheet rolls y seeding desde libro existen. Falta ataque monstruo con tohit/damage/type/uses separados y rollers initiative/HP-hitdice/check/save/attack en card/page. Observar controles VVD y dueño writable; no volver escribible paper readonly por inferencia. |
| D1-16a / D1-U03 | **P/G/U**. Skills/saves/training/cálculos existen. Toggle trained/proficient-only visual falta según auditoría; filtro no muta training, EN/ES/readonly. |
| D1-20 / B-074 | **P/G/X**. Source/credit y JSON sheet import existen; badges manual/book/file y reimport/provenance siguen locales. Sólo fetch cuenta Beyond tercero X; nunca fabricar ese origen para JSON sin metadata. |
| D1-22a / D1-23 / D1-U02 / C-98 / X03 | **P/G/U**. Fórmulas, tabs, XLSX local import/export y reportes reales existen. Faltan cell-format/colors/width/merge/freeze, preservar styles/merged/charts/images/macros, cálculo crosssheet; catálogo de sintaxisExcel VVD aún insuficiente. Dos tabs con Hoja2!A1/estilos/merged→export/reimport, valores/errores/report exactos. No prometer todoExcel. |
| D1-26 | **P/V/U**. Embed/panel/readonly sheet existentes; compact selection/readonly wiki upstream sin ejercitar. Comparar ese subflujo, no nuevo motor. |
| D1-27 / C-100 / D1-40 / D1-55 / D1-62 | **P/G/U**. Sheet/radar/voice single-user funcionan. Residuo peers/presence/follow/cell coordination, quién graba/mueve y people-thinking con usuarios propios reales/cleanup/reconnect. ServicioLAN/loopback posible; no X ni counts fingidos. Bloqueos no se añaden como fin por sí mismos. |
| D1-28 | **E/P/U**. Notes title/cover/count/rich slash/H2/list/save/copy/search/Undo/era entregados0a90dd4/CAS9. Sólo panel/toggle/botón concreto upstream no observado requiere comparación; no «faltan rich notes». |
| D1-29 | **P/G**. Raster note File/Gallery/alignment/replace/remove/Undo/capture/portable entregado d1860db8/CAS27. Falta A/V **inline notes**, UI+MCP/save/reopen/seek/readonly / wiki/bytes/backup sin autoplay; Board/Assets/manuscript media no lo sustituye. |
| D1-30 / C-28 | **E/P/U**. Descartar/Recuperar/Undo individual, decisiones duraderas por owner/era/draft con CAS y decisiones provisionales explícitas en formularios están entregados47d448bf/CAS50. Brave frío conserva decisiones y prosa; MCP68/72/68 acredita metadata con dos claves, sin inferencia atribuida a esa fase. Runtime Browser CPU/WASM posterior07d868d/CAS51 acredita preparación/import, detección y creación por tipo con sus pruebas separadas. [Alcance y evidencias](verification-browser-ner-timeline.md). No queda ausencia de Dismiss; duración entre stories de referencia y exactitud universal/idiomas conservan sus límites. |
| D1-31a | **P/G**. Tasks status/urgency/due/filter/refs/count existen. Assignee/perfil local y Mine faltan; sin dependencia externa, preservar open-count general y backup. |
| D1-33 / B-042 | **P/G/U**. Ver dados3D arriba; sets/prefs no faltan. |
| D1-36 / D2-12 | **P/G**. ProjectSoundtrack/Soundscape/mixing local existe. Radio local estaciones/playlists/dial/power/mute/volume/shuffle/static/topbar persistente, sin fingir audiencia/sintonía. Servicio remoto concreto sólo X en esa conexión. |
| D1-41a | **P/G/U**. Surfaces y snapgrid existen; snap-arrows-to-edges independiente no localizado. Contrastar, después ON/OFF separado de grid con persistencia/UI/MCP. |
| D1-42a | **G/V**. Duplicate/copy-data/boardPNG existen; node Copy-image PNG/clipboard no localizado. Verificar bounds/alpha/bytes y disponibilidad web por acción normal, conservar clipboard de datos. |
| D1-43 / D1-U04 | **E/V**. Assets rail local import/search/A/V play y Files/drop entregados. Clipboard PNG→addImagesFromFiles está localizado; nueva prueba OS-clipboard no ejecutada. No reimplementar import/play; probar sólo gesto real faltante y texto/editable sin interceptar. |
| D1-45a | **P/V**. Comment node menu/count y AnnotationSurface existen; anchor que siga move/rename/delete/Undo/Duplicate aún requiere prueba identidad. Texto que nombra nodo no basta. |
| D1-51 | **E/P/U/V**. Names/spacing/card-size/link-opacity/pictures/typeareas/reset/pins/filters/saved/portable entregados ecb1703/CAS16. Ningún control adicional concreto confirmado; enumerarlo antes de cambiar producto. SVG generator probado; Browser descarga sin artifact sigue V de transporte. |
| D1-53a | **P/G/U**. Radar drag-values/keyboard/add/remove/reorder-buttons/presets/bindings existen. Insert-axis-between y drag axis-order faltan como gesto; preserve series/bindings y Codex readonly. |
| D1-56 / I1041-M05 | **P/G/U**. Labels/order/owner/MCP/Undo/portability/Reader/wiki entregados31c5598/CAS47. Falta clip removal/ocultación si satisface contrato observado, rig/animation creation no definidos. Conservar source-index / modelo / clips originales/restores; contraste Animatorruntime actual aún insuficiente. |
| D1-57 / C-111 / I1041-A06 | **P/G/U/X**. Files/audio/video/iframes propios parciales. Falta embed page local con back/forward/resize/edit/fallback y captura portable cuando viable. Spotify/Apple/YouTube y GitHub stats específicos dependen de sus servicios; no excluyen localhost/file embed. URL sola no es contenido offline. |
| D1-58 | **P/G**. Annotation/voice/crop son building blocks. Falta annotator local page-element/priority/bug/screenshot-crop/dictation/review-flow/Undo; informe local con anchors/bytes abre sin proveedor. Envío al statusboard ajeno X, no todo annotator. |
| D1-59 / D1-66 | **P/G/U**. Catalog/search/categories/genres/recent/Worldgen raster y SDK icons/SVG existen. Residuo inventario temático observado y upload genérico entre consumidores; arte propio con source/alt/credit en statblock/export. No copiar WotC sin licencia ni convertir esa restricción de contenido en ausencia de ilustración propia. |
| D1-60a | **P/G**. Editor reference peek/back/width/pins/Esc/Open-beside y SDK beside entregados. Falta peek común desde Board/timeline/otras mentions, con mismo contexto/draft/era/readonly. |
| D1-61 / C-113 | **P/V/U**. Tool loading/error/fallback/recovery existe. Identificar needs-reload concreto y probar missing/lazy-import/world-file/bridge desconectado→Retry sin perder draft ni duplicar write. No inferir fallo por rótulo. |
| D1-63 | **P/G/U**. Assets search y Gallery visual CPU existen. Board Find-images local/text/visual y añade con origen/crédito pendientes. Web-search requiere identificar fuente real antes de excluir por proveedorAPI/pago. |
| D1-69 | **P**. Detalle S01–09/SDK abajo; infraestructura y audio/resources/refs/tours/menus/locales/defaults/theme propios ya entregados. Legacy Soundscape/Reader graph unificado y audio3D siguen fuera del contrato parcial. |
| C-01 / I1041-Q01 | **E/P/U**. Multi-manuscript A/B+legacy shelf/home/last-edited/author/blurb/cover/Reader/compile/eras entregadosCAS21/23. Upgrade impidió referenciaB, no Writer B. Sólo presentación referencia no especificada, sin reabrir multi-story. |
| C-16 | **E/P/V**. Barra contextual dedicada normal entregada d9039d3/2009r1, teclado y selección/Undo/Save/reopen verificados; menú anterior conservado y MCP encabezado. Publicación/exports y perfil causal2003 conservan su alcance separado, sin cobertura universal inferida. |
| C-29 / I1041-Q10 | **P/G/V**. Selection/@/aliases/link-text y creación existentes. Root2014 confirma Show/Hide/Undo/reload de miniatura por mención en nota normal VVD; Writer necesita el flag por aparición y sus lectores/exports. Era aún no probada; no declarar creación ausente ni excluir por API/pago. |
| C-31 / I1041-Q11 | **E/P/U**. Biblioteca12/categorías/search/cues music/ambience/SFX existen. Fingerprint exige reasignar tras editar; score temporal arbitrario no entregado. Exigir sólo control adicional observado. |
| C-34 | **P/V**. Offline Reader size/font/light-dark y app flow/pages existen. Standalone scroll-vs-pages/use-book-own/reset/reload sin DB no cerrados. |
| C-41 / I1041-Q12 | **Flujos acotados entregados; comparación restante U**. Frente in-book opt-in capturado antes de await, misma imagen HTML/native PDF/EPUB/DOCX, cover.xhtml/manifest/primer spine, scopes manuscript/era y defaults omitido/false conservados. Jacket físico separado PDF/PNG/JPEG con medidas/cajas/DPI y S0/B0. Fuente fc3ed49d aprobada CAS52 e integrada Main; [recibos y límites](verification-cover-exports.md). No faltan estos flujos. Siguen sin acreditar archivos/medidas de referencia y descarga Browser completa en disco; no se infiere compatibilidad universal ni cierre de la fila general. |
| C-42 | **Flujo local entregado; comparación restante U**. PDF Browser seleccionable, lote de seis salidas desde una captura readonly, reintento UI de esa copia, cancelación propia y ZIP explícito; márgenes y número inicial opcionales PDF/Word verificados con bytes/XML. Fuente 2e54a2d aprobada CAS54 e integrada Main; [recibos y límites](verification-publishing-batch.md). Nueva RPC recaptura; no retiene operación terminada. Siguen sin inspeccionar bytes/medidas/paginación de referencia, descarga ZIP de Brave en disco y diálogo Native de guardado; fidelidad universal y hosting no acreditados. |
| C-44 / D2-19 / D2-37 / D2-39 / D2-40 | **P/G/U/X**. Frozen editions/HTML/links internos existen. Falta publicación **servida** por host propio/link estable/takedown/audience/password/perfil/comentarios/reacciones/tags/schedule-timezone/follow/subscription local. Publicar al despertar debe servir edición real. Pago y email tercero sólo X si requeridos; archivoHTML no equivale hosting. |
| C-49 | **P/V/U**. Original/recrop/rotate/media frames existen. Ratios custom nombrados/reusables no localizados; probar control equivalente o añadir catálogo conservando original/JSON. |
| C-51 / C-52 | **P/G/U**. Required/select/default/description/herencia/parent-hierarchy existen. Subflags table-only/shared/existing-vs-new y drag-to-nest/reorder requieren contraste; resultado de anidar ya funciona por selector. |
| C-55 | **P/V**. Template-sync preview/recompute/CAS/transaction y history existen. Undo **compuesto** de dos fichas aún no acreditado; comprobar ruta nativa antes de implementar receipt; no pisar edición posterior. |
| C-57 | **P/V/U**. Fold/copy/extract/hide y Source/Owned existen; rich body único no prueba reordenado/independencia de bloque heterogéneo. Probar gesto preservando binding/IDs/history. |
| C-60 / C-85 / C-86 | **E**. Timelines/wiki/includeTimelines/views/tags/hide entregados. No volver al «no timelines in wiki». |
| C-73 / C-80 | **E/P/U**. Eras/startYear/yearZero/countdown y year/month/day grid/parser existen. Helper length y selector era-year separado son ergonomía por contrastar; mismo absoluto/conversiones/invalid/leap, no falta de eras/date picker. |
| C-74 | **P/G/U**. Leap month/day y century except/restore/redate existentes. Lista arbitraria múltiple no acreditada: buscar dos excepciones no representables y roundtrip límite antes de ampliar. |
| C-81 | **P/G/U**. Month/year grid/today/correlation existentes. Day scale dedicada/tiles-imagen/time deben compararse; no duplicar eventos/recurrentes para simular vista. |
| C-83 | **E/P/U**. Shapes/pattern/colour/image/linked saved presets/Undo/era/portable entregadosCAS24. Used-preset deletion/upstream global scope aún sin observar; year points/wiki list son consumidores distintos. |
| C-87 | **E/P/V**. Fit horizontal del canvas swim-lane entregado07d868d/CAS51: ajusta contenedor/rango configurado sin cambiar fechas, precisión o filtros, sigue resize y sale a manual con zoom. Brave final/frío y dos Native finales16/20/16 acreditan sus ámbitos; All years es otra escritura scoped ya probada. [Pruebas y límites](verification-browser-ner-timeline.md#timeline-fit-y-all-years). No ausencia de Fit; no encaje vertical, cámara persistida ni lifecycle arbitrario de Source acreditados. |
| C-88 / C-92 / C-93 | **E/V/U**. Tree reusable vocabulary/multiselect/fit y Table all-types readonly existen. Sólo gesto exacto adicional/all-types writes requiere referencia; SheetXLSX no falta por prohibición del motor Table. |
| C-95 | **E/P**. Orden authored integrado y probado; ordenar la vista viva del Códex sigue pendiente. |
| C-97 | **P/G/U**. 14operators/multi-sort y grouping simple entregados; nested multi-group no acreditado. Dos niveles reales con aggregations/sort/filter/views guardadas, no confundir queryGroups. |
| C-98 | **P/U**. Ver D1-23: fórmula concreta no soportada con oráculo; no «Excel universal» inferido. |
| C-100a | **P/V/U**. HTTP/MCP backend local existe; endpoint semántico table con keys requiere flujo real read/write del mismo backend/CAS/version/era/cell. List-tools no basta; sin API externa obligatoria. |
| C-101 / C-102 | **P/G/V/U**. Dictionaries color/icon/senses/scripts/font/mapping existen. Delete→Archive→restore idioma completo no acreditado; glyph-grid individual no existe frente textarea. Probar Unicode/font/overrides/portability y sólo script realmente requerido, sin usar conteo de presets como paridad. |
| C-107 / C-109 / C-110 | **P/G/V**. Sourcebook HTML/PDF/EPUB/DOCX2columns/breaks/boxes/page wide images existen. DOCX chapter-title span entre columnas falta; overflow warning sustituido por flow. Inspección real de output y sección por capítulo si contrato lo exige, no nuevo motor. |
| C-112 | **P/G/X**. Documentos locales ilimitados y readonly/reveal/policy existen. Share local writable / readonly por perfiles sigue colaboración; billing/plan/document-limit proveedor X, no imitar cuotas artificiales. |

## SDK y hosts: residuos específicos

Fuente S (SDK01–52, S01–09), D1-69/D2-73 e I1041. Servicios opcionales actuales no equivalen a compatibilidad ABI/Yjs/socket/token vendedor; **ABI desconocida sola no es una tarea ni un bloqueo**. DefineTool/codec/actions/media/nav/refs/resources/font/data/audio/locale/icons/resolveSvg/theme/defaults/tours/menus/submenus/fake/releases son capacidades reales propias.

| IDs | Estado actual y residuo / criterio de cierre |
|---|---|
| S01 / SDK02 / SDK03 / SDK04 / SDK12 / SDK19 | **P/E acotado**. Entrega55 Main/CAS55 añade autoría pública Host/Surface/registro/instancias/miembros/rutas/presets sobre Source, sin writer paralelo. Dos apps comparten documento y conservan clientes/rutas/SaveUndo/frío/eras/borradores, incluida recuperación propia del Host antes de NativeSDKfinal1. [Verificación por capa](verification-sdk-app-host.md). Siguen CRDT, runtime packages, hosting, todo HostServices y equivalencia completa de agrupación/tab-instance; no cerrar estas filas enteras. |
| S02 / SDK06 / SDK07 / SDK09 / SDK22 | **P/E de perfiles compartidos; G/U del resto**. Codec scalar/prose/map/stablelist/ref, seedJSON, evolución Owned y texto por caracteres con Undo autoral ya existen. Source compartido añade bloques, contenido vivo entre bibliotecas, Manual/Auto y enlaces nuevos o adopción explícita de la pareja conocida3→4; [pruebas](verification-rich-links1958.md#existing-shared-histories). Siguen codec/schema persistente arbitrario, semilla colaborativa de autor cuando el caso la necesite y migración general Source/legacy. No se cierra la fila agrupada ni se equipara CAS aislado a colaboración. |
| S03 / SDK10 / SDK13 / SDK20 | **P/V/G**. Hosts editor/embed/fullscreen y proyecciones/capturas restaurables reales existen. Falta foco blockId arbitrario Source; hook genérico de documento referido y restore editable desde snapshot propio por comprobar. HTML readonly no reconstruye código/editor. Combinaciones nuevas no certificadas requieren consumidor concreto. |
| S04 / SDK18 / SDK32 / SDK33 / SDK35 | **E/P/V**. world.list/read16/queryCodex/queryDocuments/media/search/callTool/eras/subscriptions y tools taxonomía/meta/graph existen. Probar dos Sources con cambio normal nombre/propiedad/fórmula/appearance/meta→subscribe tras commit, lectura sinwrites, era/control/drafts exactos. Watch/renderIcon/WorldPick schema/graph uniforme aún sin cierre; sólo extender getter si falta comportamiento, no fachada duplicada. |
| SDK34 | **P/E acotado de Source; resto P/G/U**. Saved open projection conserva el índice durable para cerrados. Source editable opta por publicar campos tipados pendientes mediante context.documentFields/useLocalToolDocumentFields; queryPublished/hook y MCP source:published leen copias por instanceId, sin Save/flush ni alterar borrador ajeno. Save confirmado retira sólo su token; newer draft/fallo/abort y otro montaje se preservan; Discard/unmount/lease revocan. Fuente 004ee3e1 aprobada1890r1 e integrada Main; [verificación](verification-sdk-published-fields.md). No publica automáticamente otros paquetes, Codex/cards o hosts no Source; la política de drafts de referencia y cobertura Host general siguen sin acreditar. |
| S05 | **P/G**. OperationSchema/handler/index descriptor/agent tools reales; generación automática útil de operaciones/índice desde codec aún no existe. Caso nuevo sin duplicar descriptor, opt-out y tools antiguos preservados. |
| S06 / SDK29 / SDK52 / D2-70 | **P/E local acotado; grupo general P/G/U**. CLI/scaffold/HMR y releases se conservan. Picker/inspect/install runtime sin rebuild, inventario/export y pin/update/rollback por proyecto están entregados59; Trial/Keep/Discard y Usage readonly por proyectos consumidores están entregados60; panel/list/clear de errores runtime de sesión está entregado61. [59](verification-sdk-runtime-packages.md), [60](verification-sdk-runtime-trials.md), [61](verification-sdk-runtime-errors.md). Usage no demuestra gestor de proyectos de autoría; feed instrumentado no captura toda excepción libre ni sustituye devStream completo. Source/1 sigue siendo formato de autoría, no el paquete ejecutable runtime. Distribución/hosting y restantes contratos requieren contraste propio; sin exclusión automática por ONLINE/API/pago. |
| S07 | **E/V**. Mismos handlers renderer/HTTP/IPC/stdio probados por contratos concretos. No cada tool ni CLI wrapper semántico por cadaop; probar la acción requerida, no inferir transporte de manifest. |
| S08 / SDK50 | **E/V**. Public fake/fixtures/CLI honesto sinDB/red existe. ÍndiceDB/crawler/dominio entero no simulado; límites explícitos y escenarios integración según consumidor, no fake backend nuevo como objetivo. |
| SDK14 / SDK21 / D2-79 / D2-87 | **P/E local; G del resto**. Presencia1893 entrega perfiles elegidos, personas/conexiones, publicación efímera, hooks/MCP readonly, puntero/Follow y carets conocidos. Contenido vivo1913 y adopción1958 mantienen la misma sala con editores Source, Guardar local, salida y entrada tardía; [evidencia](verification-rich-links1958.md#existing-shared-histories). Scope/project/era/canEdit/readOnly conservan su aislamiento. Siguen hosting, acceso entre equipos, roles e invitaciones de acceso y los subcontratos no acreditados; no cierre global SDK21. |
| SDK15 / SDK16 / SDK17 | **E/P/V/U**. Media/import/search/create/refs/coordinates/path existen. Stock remoto fuente por definir; creación cualquierengine desde palette texto (D2-15), canonical cold router/hash/file aún no probado. No bloquear consultas normales por falta de cold QA. |
| SDK23 / SDK25 / SDK43 | **P/G/U**. Errors/toasts y beta-reading/chapter reactions/comments existen. Falta feedback específico tool y feed reusable anysubject/reactions/rating/report; eventos explícitos autor locales/fake opcionales por examinar, inertes sinhost, sin red/notas/vigilancia. Contrato concreto antes de persistencia nueva; no excluir automáticamente analytics por nombre. |
| SDK24 / SDK40 | **E/P/V/U**. Tours manual/event/element y menus/submenus Source/legacy/keyboard/scoped revocables existen. Owned/World/fullscreen omiten esos puertos deliberadamente; iconos de menús tampoco incluidos. Consumidor real determina ampliación, no «fullscreen ausente». |
| SDK26 | **E/X**. Readonly/enable locales funcionan; pago/membership/entitlement proveedor X. Sharing local no se excluye por esta fila. |
| SDK27 / SDK28 | **P/G**. Reader/wiki/Published frozen/config history/restore offline existen. Hosting/link servido/domain/rutas/audience/takedown local pendiente en C44/D2, sin pago requerido. |
| SDK31 | **E/P/G**. Font/data bytes/import/choices/FontFace/ZIP/capture funcionan. Inventario UI/delete/GC es residuo del producto assets, no falta de resolver. |
| SDK36 / SDK37 / D1-69-audioGraph | **E/P/G**. Local SDK audio buses/fades/duck/exclusive/levels/RMS/peak/stereo funcionan. Falta listener3D/distancia/HRTF y unificación legacy Soundscape/Reader graph. Map ambience por distancia no es listener SDK; movimiento geométrico real cambia nivel/canales. |
| SDK38 / D2-74 | **P/G/X**. CallTool/backend propio ya existe. Autor no declara endpoint persistente server propio local; probar cliente local sin proxy ad hoc. Secret/API tercero sólo X para esa conexión, no todo server. |
| SDK39 | **E/P/G/V**. Icons get/search/packs/resolveSvg/Canvas/download/Native existen. Packs externos/subidos residuo de contenido/catalogue; raster exactoFAIL se conserva, contrato geométrico acordado no se invalida. Descarga en disco Brave no confirmada en reciboSVG. |
| SDK41 | **P/G**. MIME strict documentdrag/accept/drop-hook/picker/keyboard existen. Coordinador cross-surface hover/morph/preview/sharedstate falta; drag Source↔Library↔canvas real sin pérdidas/dobledrop. |
| SDK42 | **P/G**. Scoped state receipts/Source/Owned/dock/domainUndo existen. Autor no registra comandos estructurales invertibles/scope genérico en journal común; mismo undo texto nativo y acciones actuales conservados. |
| SDK44 / SDK46 | **E/P/V/G**. 9 resolved colors/mode/appliedCSS/Canvas y Source defaults compartidos Base/era existen. Owned theme/icons/locale heredados, defaults read sí/set readonly; WorldPick omite theme/defaults/audio/assets. Caso real define ampliación editable/readonly; no tratar Source como ausente ni anunciar cobertura de hosts universal. |
| SDK45 | **E/V**. Locale/catalogs/fallback/Intl/Source/Owned/WorldPick/fake entregados; no19idiomas globales ni traducción de userdata. Nuevas combinaciones de hosts por demanda, no reimplementar idioma. |
| SDK47 / S09-foco | **E/P**. Foco Source/legacy integrado con Native2claves; otros hosts/ABI siguen separados. |
| SDK48 / SDK51 | **E/U**. Runtime/lifetimes/scopes/optional fallback/errores propios existen. Named needs declaration sólo si ayuda a mensajes; no nuevo consent/approval gate ni réplica ABI. |
| SDK49 / I1041-M03 | **E/P/V/G**. Import dinámico Three y cinco loaders por autores Source ya acreditado en47d448bf/CAS50: build real, frío sin carga previa, cuatro imports concurrentes/dos autores, namespaces compartidos, repetición sin otro request y cinco geometrías OBJ/STL ASCII/PLY ASCII/FBX ASCII/GLTF data-URI. Dos WebGLRenderer SwiftShader con píxeles observados y dispose tienen prueba acotada. [C01–C07 y límites](verification-directions-dismissals-three.md#shared-three-sdk49--i1041-m03). Sin wrapper ni nueva tool; Brave visual/GPU física/fugas, GLB/FBX binario/texturas/Draco/Meshopt/KTX2 permanecen sin acreditar. No vender el grafo como inventario final de integridad ni caché entre procesos. |

Cobertura por host a preservar: Source editor completo; Legacy sin documentId por identidad propia; embed/fullscreen con view/flush/lease; Owned atom writable y facilities readOnly; WorldPick limitado; Reader/wiki/Published usan proyección capturada, no ejecución de autor; fake Node sin CSS/DOM/DB; Native no equivale aUI/Canvas. No mover límites de un host a todos los demás ni extrapolar el transporte cached antiguo a los Native nuevos de theme/defaults/icons/path.

## D2: plataforma y publicación, residuos no absorbidos arriba

Fuente S y D2. Las filas E se preservan en la sección de falsos huecos; las siguientes cubren todos los PARTIAL/ABSENT/UNKNOWN y locales de ONLINE del índice88.

| IDs | Estado actual y residuo / criterio de cierre |
|---|---|
| D2-02 | **G/U**. Analog/digital clock toggle cosmético no localizado; confirmar referencia visible antes de implementar reloj alternable. |
| D2-03 / D2-22 | **P/E local; G del resto**. Perfil y presencia1893, contenido compartido1913 y actualización de enlaces1958 están integrados y probados entre bibliotecas locales; [alcance](verification-rich-links1958.md#existing-shared-histories). Siguen roles, invitaciones de acceso, hosting y colaboración entre equipos (SDK21/B001); un login de proveedor sólo es X si ese proveedor es requisito real. |
| D2-04 / D2-61 | **X**. Monetisation/billing/quota proveedor explícitos; no imitar topes. |
| D2-05 | **P/G**. Fresh empty close guarda sólo cards/chaptersBase por inferencia12h; faltan otrosdocs/era y unpin+close si referencia lo confirma. No perder datos ni confundir pinned X disabled con confirm. |
| D2-06 / D2-08 | **E/P/V**. Launcher/pin/duplicate/delete, rename/reopen/overview/tab shortcuts existen. Show-more/fewer lista grande por probar; cuatro companions/S/M/L/tab-layout per device/boot retry son límites explícitos. Más tabs/size/retry no desplazan drafts; localStorage no equivale backup/world share. |
| D2-09 / D2-15 | **P/G**. Home/recent/quickcreate/palette existen para tresmotores. Creación engine/tipo arbitrario soportado desde flujo normal sin interceptar búsqueda filtrada. |
| D2-10 / D2-11 | **P/G/U**. Graph/appearance/counts reales existen. Graph/map backdrop/tray de home y series words/docs/edges/períodos requieren contenido/mediciones reales; observar portada y no inventar historia. |
| D2-12 / D2-13 | **P/G**. Local soundtrack/Library/search existen. Radio/playlist topbar arriba; new-tab pinned tiles/startpage/recents faltan como flujo. |
| D2-18 / D2-84 | **P/G**. JSON/ZIP backups y on-demandMDvault existen. LegiblesMD/CSV de board/kanban/storyboard/sheets/dictionary/genealogy/era variants aún faltan; watchedfolder/livevaultsync no existe. Probar links/media/IDs, no llamar vaultvivo alZIP. |
| D2-19 / D2-37 / D2-39 / D2-40 | **P/G/U/X**. Hosting/domain/links/audience y subscriptioncapture/cola locales en C44. Emailprovider/payout/pago específicos sólo X. |
| D2-24 / D2-73 | **P/V**. Toggle/SDK/tool inventory existen; reconciliar cada experimento con D1/SDK actuales, no paquete entero ABSENT ni typed host PRESENT como cierre general. |
| D2-25 / D2-26 / D2-27 | **E/P/G/U**. 4 layouts/fonts/20 palettes/Terminal y Shell commands existen. StoryFirst/PictureBook/scene-gallery layouts y block-letter title / boot opening list pendientes; parejas light/dark por comparar, no gap de conteo. Layout útil con contenido, no preset renombrado. |
| D2-28 / D2-29 | **P/G**. Map parallax/dataURL / fixed clouds/map+pin-distance loops existen. Asset refs/modo por perfil, site-wide track/cards/home/pin UI pendientes; distinguir de audio espacial SDK. |
| D2-30 | **E/V**. 390/768/desktop preview existe; tablet/dispositivo real sigue cobertura, no ausencia de preview. |
| D2-31 / D2-32 | **P/G**. Sections/layout/marks/excluded fields existen. Subsecciones / drag / page icons/single-block hide y propiedad por card/type pendientes; físicamente omitir bytes/assets de cada destino, árbol portable / orden estable. |
| D2-33 / D2-34 / D2-35 | **P/G**. Standalone/captured pages/home/branding footer existen. Engines omitidos/Board espacial, bandas WYSIWYG de home/slots/order/responsive y footer links/signature width pendientes; cerrar por documento/banda concreta. |
| D2-36 | **U/V**. Not found no inspeccionado; probar hash/ruta desconocida antes de declarar defecto o añadir mensaje. |
| D2-38 | **E/P/U**. Captura/local editions/history/change-list existen. Word diff adicional no se deriva del rótulo; contrato concreto por observar. |
| D2-41 / D2-42 / D2-43 | **P/G/V**. Frames/crop/zoom mouse/keyboard/import/transcode existen. Preselect slot avatar/banner/cover, touch pinch, compresión antes de importar oversize faltan o no cerrados; ffmpeg real recibo actual por revisar. No ejecución desktop nueva en este encargo. |
| D2-44 / D2-45 / D2-46 | **P/G/V/U**. Assets search/CRUD/Base A/V preview y delete usage scan/aviso existen. Files/PDF inventory/era preview, byte-match recrop-vs-ID/model Archive y picker URL/upload exacto pendientes. D2-45 «no guard» es obsoleto; D2-46 no-verificado no es ausencia. |
| D2-47 / D2-49 / D2-50 / D2-51 | **P/G/U/X**. PNG16kinds y page capture/download queue propios existen. Elegir render como asset/avatar sin export manual y stock curado local con licencia pendientes. Moderation cloud tercero sólo X si ese servicio se requiere; función local concreta se examina sin proponer nuevas trabas. El mecanismo capture propio no exige extension right-click exacta. |
| D2-53 / D2-56 / D2-57 / D2-58 / D2-59 / D2-60 | **P/G/V/U**. MD/text/CSV/JSON/media/ZIP/DOCX/PDF text/manuscript EPUB/paste/review/atomic Undo/own roundtrip existen. OCR; doc/rtf/odt importers; EPUB world; PDF layout/columns/tables/footnotes/images; profundidad ZIP; planner contextual revisable; selección por carpeta de origen/groupview/drag; resumen detallado/salto inicial; JSON VVD con fixture primaria; texto libre→timeline pendientes. Sparks global para inferencia, no LLM de texto como fallback local; parser determinista posible, sin API externa automática. |
| D2-64 / D2-66 / D2-67 | **P/G/U**. Theme save/apply/delete/import/export, nueve global tours/SDK tours y EngineManager existen. Local shared theme explorer, mini lessons/dots/leave/video, local tool catalog categories/featured/search/rating/request/trial pendientes; remoto no obligatorio. SDK tours no aumenta global 9. |
| D2-69 / D2-70 / D2-71 / D2-72 | **P/E local acotado; resto P/G/U**. Versions/pins/scaffold/HMR, picker/install runtime sin rebuild59, Trial/Keep/Discard y proyectos consumidores Usage60, panel/list/clear de errores de sesión61 entregados. No se reabren como ausencias. Gestor de proyectos de autoría, devStream general y equivalencia del resumen Uses/Learns de referencia no acreditados; no nuevo consent obligatorio ni borrar otras instancias. Véase S06/SDK29/52 y sus verificaciones. |
| D2-74 / D2-75 / D2-76 | **E/P/G/V/X**. Named keys/revoke/lastUsed y spec-check locales existen. Settings UI/no-default adapter cobertura por verificar; local server endpoint, withdraw release/listado storefront/eventos opt-in pendientes; GitHub deploy/payout/API secrets terceros X específicos. No priorizar nuevos scopes/expiry como controles. |
| D2-77 | **G**. SDK map lens dentro mapa/open-on-which-map/leer-editar capa efectiva falta; narrative StoryLens y maps layers no son esa extensión. Reusar motor y scopes. |
| D2-78 / D2-79 | **P/G**. Threads/replies/read/pins/mentions locales existen. Otros canvas/offscreen/hide markers/follow document y author identity/cursor local pendientes; no X por ONLINE. |
| D2-80 | **P/G**. Journal de cuatro fuentes/domain/source Undo existen. Engine delete/document rename/restore/all redo/durable journal no uniformes; acción estructural normal→Undo/Redo con conflicto real, conservar text undo. |
| D2-83 | **E/P/V**. Saved card MD/attachment ZIP/PDF/PNG/browser print entregados. Drafts/annotations/full gallery/player-safe/bytes de descarga Brave no certificados; no reabrir individual export entero. Sólo ampliar contrato cuando subflujo concreto lo exija. |
| D2-85 / D2-86 / D2-87 | **P/G/U**. Snapshots/targets / split/compile/audio/effects/publish parciales reales. Screenplay/corkboard siguen U de comparación; detalles C arriba. Live coedit/shared access sigue SDK21/22 local, no X por ONLINE. |

D2 filas sin residuo material identificado en S: D2-01, D2-07, D2-14, D2-16, D2-17, D2-20, D2-21, D2-23, D2-48, D2-52, D2-54, D2-55, D2-62, D2-63, D2-65, D2-68, D2-81, D2-82, D2-88. Sus E son acotados a los contratos/recibos originales; no una certificación universal de cada dispositivo/control. D2-26/30/38/49/69/75/83 conservan los residuos de contraste o combinaciones señalados arriba.

## I1041: límites y contratos que no desaparecen en la agregación

| IDs | Disposición actual |
|---|---|
| W03 / W09 / W12 / W15 | **P/V/U**. Acceso único desde cualquier doc, migración instalada desde 42, payload legado arbitrario y accesibilidad / escala global no certificados. History preimagen/restore/Undo y 43→44 sí; cron idéntico no es gap material sin estado recuperable perdido demostrado. JSON/ZIP propios no prueban compatibilidad de todo payload externo. |
| C14 / C-59 | **P/U**. El wizard guiado propio existe; reestructurar un apunte existente preservando hechos/campos no se acredita por wizard/create. Ejecutar un input concreto en VVD y contrastar; Sparks si hace falta inferencia. |
| C16 / C17 | **P/V**. Media usage scan y búsqueda visual CPU ya existen. Completo mapa nested/orphan uses y descarga/cache de primera instalación interrumpida no certificados; ranking fixtures ES/EN no exactitud universal. |
| D02 | **G-H/U**. Branching dialogue choices/edges/Walk ausente en inventario fuente, pero origen VVD histórico404, no contrato vigente. Mantener investigación de vigencia antes de llamarlo requisito actual; ConversationComposer existente no es ese grafo. |
| L12 | **U**. CalendarTool0.1.0 upstream Preview unavailable, sin comportamiento demostrado. Calendar propio ya existe; no inferir dependencia externa/ausencia por error de preview. |
| R01 / R02 / R05–R10 / R12 / R13 | **P/V/U**. 5e 2014/2024/clases/recursos/HP manual; CoC derived/Pulp/override/push/majorwound/SAN/development; nueve DH classes y NPC presets funcionan en sus recibos. Multiclass/catalog full/classic section by section, CoC opposed/bonus/penalty/weekly healing/bouts/magic/rewards/Pulp talents/Luck, DH full NPC thresholds/type/features/Fear y cláusula primaria 96+ quedan sin cierre. No exigir automatización no observada ni llamar todo RPG ausente. |
| R11 / A01–A04 / M03 / M04 | **E/P/V**. Compact chosen skills / editable rolls y voice embedded/word seek/download/Reader/wiki posteriores cierran límites antiguos. Mic / ASR hardware/primer model download/alineación automática/packaged smoke/códecs universales no certificados; M03 decoders/FBX binario arriba. Native animation get/action CAS47 no prueba todo viewer transport. |
| Q14 / Q19 | **E/P/V**. Export editorial y quote / drop cap correction revisados; FAIL first letter original conservado/resuelto acotado. Grafema entre fuentes/marks incompatibles puede separar acento; DOCX fidelity/Word desktop/EPUB device no universal. No repetir como bug resuelto el incidente viejo sin distinguir límite restante. |
| T07 / P04 / P06 / P08 / P09 / P11 / P12 | **E/P/V**. Vocabulario reusable como mejora propia, wiki perfiles / ediciones/omisión física/banner / grid / carousel/fonts/branding/Terminal / Shell ya entregados. Hosting y layout/compositor avanzado están en D2; comandos OS/VVD exactos no demostrados. No inventar deuda de todos los perfiles/wiki. |

## Exclusiones: suboperación concreta y parte que sigue local

| IDs | Dependencia demostrada o condicionada | Parte local que continúa |
|---|---|---|
| B-010 / D1-20 | **X** fetch cuenta/personaje del servicio D&D Beyond | Import file JSON, badge/provenance, snapshot/reimport/override. |
| B-013 | **X** Mapbox API | Texto/dirección/usual place/ICS y video-room URL manual. |
| D2-04 / D2-61 / SDK26 / C-112 / B-011 | **X** monetisation/billing/quota/membership y compra/licencia de catálogo tercero cuando requerida | Documentos sin límites artificiales, biblioteca propia/homebrew, access readonly/peers / local publication. No todos módulos son pagos. |
| D1-57 / C-111 / I1041-A07 | **X** integración específica Spotify/AppleMusic/YouTube; GitHub stats por API | Audio/vídeo/file/local page embed, navegación/resize/fallback/captura propia. Una URL remota no es API externa por sí sola. |
| D1-58 | **X** enviar al statusboard del proveedor | Annotator/informe/review flow/screenshot/voice/Undo locales. |
| D2-76 | **X** GitHub deploy/payout tercero | Pack/spec-check, catálogo/listado/withdraw release y trial locales. |
| B-016 / C-44 / D2-37 | **X condicional**, sólo envío email si exige proveedor externo | Capturar suscripción/cola/lista local; identity backend/bookmark/PWA/host propio no excluidos. Falta probar necesidad exacta del proveedor. |
| D2-51 / D2-74 / SDK38 / D2-49 / D1-63 | **X condicional** sólo cloud moderation/API secret/captura/search de proveedor expresamente requerido | Backend endpoint, media review/capture / search local o selfhost no excluidos. No proponer moderación/permisos nuevos por defecto. |

**No X acreditado** para image→map AI (A1-009 / A2-049 / A2-050), colaboración/local peers, hosting/local domain, availability poll, journal, campaign, app hosts/runtime packages, local stock gallery o local radio. Licencia de arte WotC restringe copiar **ese contenido**; ilustración propia/autorizada y su crédito siguen capacidad local. La falta de firma/ABI vendedor exacta tampoco excluye una equivalencia funcional propia.

## Falsos huecos antiguos que deben permanecer cerrados en su alcance

Cierres explícitos adicionales para el índice: **A1-056** duplicate/lock, **D1-18** ataques manuales player, **D1-39** transcripción/lectura de voz, **SDK05** codec/field, **SDK08** carga/acciones/contexto del documento, **SDK11** bloque Owned y **SDK30** resolver de recursos ya son E acotados; sus límites están en A1, D1/B e inventario de hosts, no son capacidades enteras pendientes.

- A1: blank sea / land / island/presets/size parcial; right-click, lake/spring/reverse/levels/contours/clouds/3D skins; saved look/layers/hour, roads width/pattern, place duplicate/lock, symbols search/raster markers, card create/open, zonas y amplio MCP ya existen. Residuo preciso arriba, nunca «atlas no tiene autoría».
- A2: classic layers/styles/scale/background replace/keypins/card picker/create pin, journeys/ways/pace/per leg/clock/shelter/route words/playback y trade/ports ya existen. Capítulo/event reader no prueba sesión histórica; tampoco justifica «no hay viajes».
- B/D1: dice pad/sets/device prefs/name generator, SRD compendium/add world / add fight, tracker turn / HP / temp / conditions / death/concentration prompt, manual player attacks/class / level / HP, slash menu, attendance/DM notes/recap/start/end existentes. Nuevos corpus/wizard/roster/automation no los sustituyen ni los niegan.
- C: multi-story/manuscripts/book home, author byline/create cover/chapter drag/holdback/kicker, writing blocks/callouts/text effects/messages, images / exports / book styles / front matter / preview / stats / sprint, aliases/required/select/genre templates/freeze/faces/guided/types private/library bulk/archive bulk, event duplicate/precision/weeks/moons/leap months/redate/correlation/calculator/repeats/tags/wiki/views/hide, tree groups/vocab/variants, table edits/find/all types/formulas/XLSX, dictionary senses/native/paste y sourcebook/rules cards están implementados acotadamente. No usar las columnas Gap previas a esos añadidos como backlog nuevo.
- SDK: A/B/C y D1/D2/D3/consumer reviews ya entregados; fakeHost/releases/pin/document host/index/ref drag/scoped Undo/rich prose/additive Owned, audio/resources/font data/stereo/measured levels, path/beside, icons/SVG, locale/defaults/theme, tours y menus/submenus no están ausentes. ABI/CRDT/cobertura de hosts/instalación runtime siguen diferenciados.
- Plataforma: perfiles wiki/ediciones/branding/layouts/console, date field/month controls, card individual export, Board local A/V Files/drop y Assets A/V preview entregados. PENDIENTES/sketches de «queda integración» y «no tasks/mixer/names/XLSX/graph/rich notes» son historia. Guardar incidentes QA reales no obliga a reejecutar helpers consumidos.

## Riesgos y siguiente cierre verificable

1. Lote de cuatro deltas resuelto contra oráculos finales y recibos exactos, CAS49/Main. Continuar los residuos siguientes: ni catálogo949 ni un gesto sintético certifican paridad global.
2. Después elegir residuo concreto, con conducta primaria observada cuando haga falta: A2-039 directions, D1-30 dismiss, C-87 Fit, C-41 cover export (ya entregado con límites propios, no ausencia pendiente) son pequeños; no reemplazan fundamentos bounded maps/custom grounds/layers, campaign/roster/scenes, corpus/wizard, app hosts/migrations/runtime packages o colaboración local.
3. Muchas referencias VVD son sólo cadenas/histórico; las auditorías son lectura sin ejecución. No sumar sus recibos como nuevas suites ni exigir equivalencia de raster/firma sin contrato. Las matrices contienen estados/planes repetidos y límites resueltos más tarde: leer la verificación posterior y el índice, no la primera coincidencia.
4. UI web/MCP/Undo/era/portable se cierran por acción y host relevante. No extrapolar Source→Owned→WorldPick, classic MAP→Worldgen, manual roll→automation, chapter→session, file export→hosting, dispatcher→stdio, UI→Native o build→cold installed. Hardware/cold/otros dispositivos/latencias/códecs universales siguen sólo donde sus filas lo declaran.
5. Este registro es documental y la única ruta escrita por su autor. No cambió producto/tests/matrices/runtime/Git/Ágora ni otras apps, no creó agentes y no llamó herramientas de modelo. La cuota 83% fresh16:38:44Z / secundaria UNKNOWN fue comunicada por ROOT, no una medición nueva de este pase.


Actualización primaria ROOT de A2-039 (Brave Map0.1.58,26-10): Directions sobre Torre deja Torre como única parada y pide origen; pulsar Faro produce Faro→Torre. Sobre un recorrido existente, Directions sobre Faro lo sustituye por Faro y vuelve a pedir origen; Horse/Steady se conservan. El lugar seleccionado es destino en este flujo, no origen como infería la auditoría de cadenas. Pruebas ROOT-directions-two-stops-reference y ROOT-directions-existing-reference. Contrato siguiente propone además una acción explícita desde el lugar; no está implementada ni cerrada por esta observación.

## Delta26-10: Directions, descartes duraderos y Three; fuente45 entregada

Esta adenda sucede al contraste primario final de A2-039 y conserva todos los bytes, IDs, FAIL y límites anteriores. Base Main comunicada por ROOT:7c3ff16; el lote de45rutas está comprometido47d448bfac8d8441f07943d4c032aca1ad674e3d, aprobado exactamente en CAS50 e integrado por FF verificado en Main47d448bf; Main y manual verificados; registro documental final/continuidad pendientes, no un nuevo cierre general. [Verificación atribuida](verification-directions-dismissals-three.md).

| IDs conservados | Estado de este corte y residuo |
|---|---|
| A2-039 | **E acotado**. Dos acciones explícitas anclan el lugar efectivo como origen/destino; picking normal, opciones temporales, save/reopen Base/era y Native final3 verificados. El primario demuestra destino, corrigiendo la inferencia antigua. CAS50 exacta/MainFF verificados; Main verificado y manual actualizado; documentación final/continuidad comunes conservan sus recibos separados. Sin cold Browser Directions ni supervivencia de borrador creativo tras desmontar Inspector. El flujo concreto queda cerrado; A2-023/036/041 y los demás residuos de viajes siguen abiertos. |
| D1-30 / C-28 | **P/V**. Descartar/Recuperar/Undo de sesión duradero por owner/era/draft, portables, privacidad y Native68/72/68 con dos claves verificados. Browser frío real del descarte pasa con ledger/tokens exactos y Restore/Undo frescos, HTML/datos exactos y0ediciones. La fixture usa inferencia controlada. Runtime NER real con wiring en progreso fuera de47d448bf y prueba de modelo pendiente; metadata/spans no son inferencia positiva. Cross-story de referencia UNKNOWN; no lista global ni ABA universal de versión ausente. No E de la fila agrupada. |
| SDK49 / I1041-M03 | **P/V** general, C01–C07 acreditado en build/run propios concretos. No falta wrapper para la vía actual de imports dinámicos. Quedan formatos/decoders no ejercidos, evidencia fuera de SwiftShader y procedencia explícita de builds reutilizados; no pack/install/pin ni ABI upstream acreditados. |
| D1-69 / D2-73 / S01–S09 y demás SDK | Conservan sus residuos y sus propios IDs. Three, metadata NER y Directions no cierran hosts, CRDT, paquetes runtime, ABI, colaboración, audio3D ni ninguna fila agrupada por arrastre. |

Los demás residuos del ledger siguen vigentes. Quick y crítica396 de ROOT tienen recibos exit0; el primer crítico scope fallido y las ejecuciones Native anteriores permanecen históricos. El build WT tiene recibo exit0 separado; nada de ello certifica por sí solo la fuente nueva del runtime NER posterior, Main o entrega. Parent1095 y paridad general ABIERTOS.

## Delta Browser NER y Timeline Fit — fuente07d868d entregada

Esta adenda conserva todos los bytes, filas/IDs, FAIL y límites anteriores. El NER Browser ya no está sólo en wiring: hay inferencia real y el corte está comprometido07d868d8982ca46f4e1a192f20a4688db60155d8 sobre3f3c029,41rutas. CAS51 aprobada exactamente, FF Main41blobs verificado y checks Main954/query/synthetic/NativeTimeline completados. Manual51 actualizado y verificado; el estado final documental/común se consulta en los registros separados ROOT-delivery51.json/ROOT-continuity51.json, según su emisión. [Verificación por capa](verification-browser-ner-timeline.md).

| IDs | Avance concreto y residuo conservado |
|---|---|
| D1-30 / C-28 | **E/P acotado** por alcance agrupado. Browser CPU/WASM real, cuatro Files, cache/recreate offline, auto-scan/crear vacío/durable decisions/reload y MCP16/20/18+2Undo acreditados. No confundir metadata68 ni spans controlados con modelo. UI Cancelar preparación no ejercitada, red Browser no capturada; denegación externa pertenece al renderer aislado. Exactitud universal y scope cross-story referencia siguen fuera de lo demostrado. |
| C-87 | **E/P acotado**. Fit entregado en Main/CAS51; Fit horizontal efímero con resize y salida manual, rango/precisión conservados; All years swim/list corrige época. Brave final y revisión dirigida del clamp acreditados; Native16/20/16 anterior al clamp se conserva histórico; el formal fresco y Main repiten16/20/16 sobre la fuente final. No cámara persistida/encaje vertical/Source host; otros subcontratos de Timeline no se cierran por arrastre. |
| SDK / D2-73 / D1-69 | Las tools viewport reutilizan SDK público con borrador React independiente. No cierre general de hosts/ABI/CRDT/packages ni de filas agrupadas. |

Quick117s, crítica396/135s y build303s pasan con19/20hashes estables; fullbuild emite worker/WASM iguales a la producción focal que sí ejecutó inferencia. Los fallos originales y cambios legítimos de fixtures/negativas se conservan. La preparación de cuatro archivos y el estado de vista son capacidades locales; no se excluyen por ONLINE antiguo. Parent1095, paridad general y el resto del ledger ABIERTOS, sin porcentaje.

## Delta C41 Front + Print — fuente 40 aprobada CAS52 y entregada en Main

Se conserva íntegro el ledger anterior, sus IDs, FAIL, matrices y conteos. [La verificación C41](verification-cover-exports.md) registra capacidades propias construidas y límites de ejecución, sin cambiar por arrastre otras filas.

| IDs | Avance acotado y residuo |
|---|---|
| C-41 / I1041-Q12 | **Flujos acotados entregados; fila general abierta**. Frente in-book opt-in capturado A→live B/DB cerrada, misma imagen HTML/native PDF/EPUB/DOCX, scopes y legacy; mejora propia separada del jacket de referencia. Print cover físico PDF/PNG/JPEG de una hoja, medidas/cajas/DPI, S0/B0/seams/readonly con archivos reales verificados. Front Brave cold final acreditado; Print acciones normales y 390 observados, recarga fría con 77 tablas exactas y limpieza 0. Fuente fc3ed49d aprobada exactamente en CAS52 e integrada en Main; formal fresco y Native Print Main verificados. No cierra otros subcontratos de la fila. |
| C-42 | **P/G/V conservado**. No Browser book PDF ni batch multiformato implementados por este lote. PDF nativo existente y jacket de una hoja no los sustituyen; márgenes/numeración por salida y descargas de referencia siguen con su alcance propio. |
| SDK / D2 / herramientas | Captura y callTool reutilizados; no nueva ABI/host, CRDT, runtime package, registry o contador global. Native Front y Print tienen fuentes/formatos/tiempos diferentes, no un PASS único acumulado. |

Referencia VVD: Printcover activa PDF y muestra 2 files/4 files; bytes, medidas/sangrado efectivos y front-in-book siguen UNKNOWN. El no-goal histórico de una implementación anterior no excluye este avance offline. Fuente fc3ed49d tiene 40 RAW congeladas, gates combinados PASS, aprobación exacta CAS52 y FF Main verificado. FORMAL y sus transportes nuevos suceden al dictamen preparatorio; el Native del autor anterior conserva su alcance histórico. Parent 1095 y resto de paridad ABIERTOS, sin porcentaje.

## Delta A1-039 fase1 — calibrar una hoja existente (histórico CAS53)

Se conserva íntegro el ledger previo, sus IDs, matrices, conteos y fallos. Esta sección describe el corte CAS53; sus frases de creación/resize pendientes quedaron superadas sólo en el alcance entregado CAS55 de la fila vigente superior. El consumidor cartográfico residual y otros contrastes permanecen abiertos.

| IDs | Avance concreto y residuo |
|---|---|
| A1-039 | Calibración construida y verificada: ancho físico de hoja existente, alto/celda derivados, Aplicar/Cancelar/Restablecer/Deshacer, referencias físicas y tools normales. Fuente42 bbf18aff aprobada exactamente CAS53 y entregada en Main con catálogo956 y Native propio verificados; documentos/manual/comunes conservan sus recibos separados. No se atribuye regeneración ni resize de dominio a este control. |
| A1-003 | Coherencia de medidas de la hoja existente refinada; creación con ancho/alto independientes y lectura de nueva celda rectangular siguen pendientes. Se conserva la proporción del grid actual. |
| A1-040 / A1-041 | Abiertos: crecer/recortar terreno, mar/tierra de relleno, dominio vertical/rectangular, nueve anclas y handles. Frame/viewport no los sustituyen. Referencia observada de resize/grow/crop/portrait no prueba RAW, snapping ni anclaje exacto. |
| SDK / MCP /3D | Getter/setter y transporte de dos claves propios; sin ABI/host nuevo ni cierre de SDK agrupado. Render3D normal y exageración19 conservada observados; no certificación numérica pixel/raycast/mesh-water-model. |

[Verificación por capa](verification-world-scale.md). Quick41, crítica/build42, Native34 anterior al CAS, shipping5 y Brave tienen alcances diferentes. El primer full-precision→snapshot cuantiza cinco arrays por codec legado; no hay promesa RAW fría universal. Miniatura automática puede materializar una era sin escala; el inspector final atómico separa ese comportamiento del writer. Parent1095/paridad global abiertos, sin porcentaje.

## C-42: estado vigente del flujo PDF Browser y lote capturado

Esta adenda sustituye sólo las frases anteriores de ausencia de Browser book PDF/batch y selección física de C-42; conserva sus IDs, matrices, FAIL, historial de C41 y todos los demás residuos. El estado de entrega exacto se registra en [verification-publishing-batch.md](verification-publishing-batch.md), sin deducir commit/CAS/Main del hecho de existir fuente o este documento.

| Subcontrato | Estado y residuo concreto |
| --- | --- |
| C-42 / PDF Browser seleccionable | Implementado con el núcleo Rust/WASM existente, texto/Unicode/subconjuntos de fuentes, autoflow, columnas/tablas, notas y TOC; prueba final rica y geometrías atribuidas. No equivale a PDF/X/CMYK o compatibilidad universal. |
| C-42 / lote y reintento | Seis salidas de una captura de sólo lectura y reintento UI de esa copia tras live B/DB cerrada; resultados parciales y ZIP explícito. Una nueva RPC recaptura, sin copia capturada persistente de operación. |
| C-42 / márgenes y número inicial | Opcionales en PDF/Word con bytes/XML reales; A4/Letter/A5/6×9 y preliminares/cover acotados. EPUB reajustable y cubierta completa separada no heredan el contrato de páginas del libro. |
| C-42 / cancelar y ownership | Worker real propio cancelado por segunda clave MCP; los listos/otra operación se conservan. El ZIP tardío A→B→A tiene RED/GREEN y shipping de dos casos sobre UI final. Native 41, Brave anterior a PRE/ZIP y fuente 42 tienen atribución separada. |
| C-42 / referencia y resto | **P/U conservado**: bytes/medidas/paginación de archivos VVD no inspeccionados; los botones 2/4 archivos no los prueban. No hay fichero ZIP de Brave confirmado en disco ni diálogo de guardado Native ejercitado. Las diferencias concretas restantes requieren su propio contraste; no se reabren como ausencia las funciones aquí verificadas. |

La fila agrupada, sus conteos y la paridad 1095 siguen abiertas. La dependencia externa/pago sólo excluye una suboperación cuando esté demostrada; estos límites de prueba no la sustituyen.

La fuente `2e54a2d476c31b49cea48a56cb5c4582c9d38114` está aprobada exactamente en CAS54 e integrada en Main: 42 blobs exactos y 48 archivos no rastreados preservados. Las comprobaciones finales de fuente42 y Native Main fresco tienen recibos distintos de pre2/formal; [la verificación](verification-publishing-batch.md) registra esa entrega sin cerrar la fila agrupada. El manual está actualizado y verificado; documentos/continuidad permanecen en sus registros separados.


## Delta56 entregado: A1-051 y consumidores finitos

Esta adenda sucede sólo a las frases previas de formato PaintedLabel pendiente y consumidor renderCartography estático. Conserva literalmente matrices, IDs, conteos, fallos e historial; no cambia el alcance agrupado ni afirma paridad general por existir código. Estado de este corte: **P/E acotado en fuente verificada y comprometida `4f463f9abc4e0d6989a8d1b10e02033d7e3fa4da`; aprobada exactamente CAS56 e integrada Main por FF verificado; documentación de este corte entregada; continuidad común con recibo separado; manual actualizado y verificado**.

| ID / subcontrato | Evidencia vigente y residuo |
|---|---|
| A1-051 / formato PaintedLabel | Cinco overrides públicos propios bold/italic/caps/color/font, herencia/null, false explícito, reset conjunto y preservación al cambiar preset. UI normal, bridge, dos claves Native, Brave frío, Base/épocas/Undo/JSON/ZIP/Duplicate y consumidores reales Atlas/Carta/3D tienen atribuciones separadas en [verification-lettering](verification-lettering.md). Tamaño, giro, espaciado y curva ya existían; no se vuelven a contar como ausentes o recién añadidos. |
| A1-051 / referencia y familias | Se reutiliza theme/serif/sans/mono/script. La presencia primaria de Fell English/Cinzel/Garamond/Crimson/Plain y presets no prueba archivos, licencias o equivalencia visual exacta; ese contraste sigue **U**. No fuente nueva instalada ni cierre tipográfico universal. |
| A1-003/039/040/041 / identidades de pintura | Label y stamp sobre origen finito no0 devolvían key local inutilizable; mismo oráculo público causal pasa tras calcular la respuesta del journal real postflush. Claves ABS, hermanos y Undo conservados; legado focal intacto. No generalizar a otras familias de claves sin su evidencia. |
| A1-003/039/040/041 / lectores Carta y sucesos | renderCartography dots/trail y copias finitas de anotaciones tienen RED/GREEN propios con Canvas/controles legacy. El flujo montado Story/Carta6frames tiene positivos funcionales, pero una guarda pathset fue false por una incorporación de evidencia ajena: no se llama gate completo. Ver [adenda de dominio](verification-world-domain.md). |
| A1-003/039/040/041 / entradas MCP | Road y familias de coordenadas se verifican contra dominio actual, no params.width. Rechazan entradas originalmente exteriores y limitan el redondeo interior al último índice. Su cobertura concreta no acredita todos los handlers numéricos ni nuevas semánticas de ruta. |
| Capacidades aún abiertas | Otros estilos/consumidores no ejercitados, contraste de fuentes de referencia, Mediterráneo, suelo/imagen y todos los residuos ajenos siguen abiertos. Frío no es RAW lossless; archivos de la referencia y descarga web a disco continúan UNKNOWN cuando no se inspeccionaron. No equivalencia global ni cierre1095. |

Root quick227919ms,396críticas157760ms y build370224ms pasaron sobre freeze r6/111Source/142code con guardas exactas. La fuente56 está aprobada exactamente CAS56 e integrada Main por FF verificado; documentación de este corte entregada; continuidad común con recibo separado; manual actualizado y verificado. La evidencia previa de55 mantiene su propia fuente, revisión y fecha; estos resultados posteriores no se le atribuyen retroactivamente.

### Residuo57 causal, separado de56

Los nueve fallos ABS reservados para57 se conservan aparte: dos keys de AddPlace/Duplicate y siete criterios de Story (listado local, prosa y reorder), con16criterios/9fallos y controles legacy/Undo sanos. El parche57 sigue su propia verificación y no forma parte del commit56; no se deduce paridad global de los gates56.

[Causa independiente](../../_stage/parity-map-domain-next/independent-source-abs-r1/CAUSAL-RED1.md), oráculo original776425dad910f9b975c92491026df8b97239f5523f56aac0116688d260e17dd2, RAWc20bdcace06fa6afe6076fb38c0e01efe87c5a26cd5529af4e1bbed65412f5a9. Add/duplicate guardanABS correctos pero devuelvenkeylocal; Storyadd es correcto y list/update/reorder mezclanABS/local. No defecto inferido de fog/zones u otros lectores. [Propuesta57 original](../../_stage/parity-source-abs-next/PLAN-r1.md).

[Main56](../../_stage/parity-map-domain-next/ROOT-main56-FF-r1.json) y [formal56](../../_stage/parity-map-domain-next/INDEPENDENT-FORMAL56-REVIEW-R1.md) acreditan este estado; las recusaciones del revisor sobre central/Road permanecen explícitas.

Root actualizó el manual una vez:90→638UTF16, delta548 en113268/t.0; recurso completo exacto salvo revisión, con otros textos/estilos/tabs/metadatos intactos. Cinco alias liberados. [Recibo manual56](../../_stage/parity-map-domain-next/ROOT-manual56-receipt-r1.json). La continuidad común conserva su recibo separado.


## Entrega57: nueve causas ABS y lector de landmarks

Esta adenda sucede al checkpoint57 pendiente de la sección56; no reescribe su evidencia histórica. Fuente `a91027f3dc54864fc91c17d92d6dc23b2290f342` aprobada exactamente CAS57 e integrada Main; evidencia histórica conservada por corte y fecha:

| Capacidad acotada | Evidencia actual y residuo |
|---|---|
| AddPlace/Duplicate, key pública | Original16criterios:9RED→16GREEN, repetido personalmente por peer. Respuesta/lista usan identidad ABS; x/y públicos locales. Control69 conserva settlement/landmark y label/stamp#2 en legacy y origen48. |
| Story list/prosa/order | Proyección local antes del mismo writer evita segundo origen; ambos hermanos conservan posición durable, IDs, texto, capítulo/estado y orden.12Undo del original restauran14buffers/ediciones/params/dominio. No reparación automática del daño previo. |
| Landmark canonical/feature alias | RED real ACKABS/listlocal ce25d6fa precede al arreglo lector1cbd; mismo controlR2green2 pasa69/69. Sólo identidad incorpora origen; posición/sourceX/Y locales. No alias local ambiguo ni migración. |
| Native57 y rama generada | PeerR3:20criterios,32tools/36RPC/16Undo/48IPC, dos claves reales;112/144 exactos y88tablas0. Regresión pura26asserts instalada con prefijo legacy6324B literal y entrada crítica; fixture explícita, no generador real ni14RAW propio de ese unit. |
| Residuo de nombre landmark | Custom add name está en journal, pero lector/lista muestran defaultVolcán en el caso medido. Es previo y separado; esta entrega no lo corrige ni lo confunde con las keys. |

[Verificación57](verification-source-abs.md). Gate final112Source/146code `765f62196ac505a45db5a4538d2b270c72f6e9ec033ca18083e965cebc6d9b26`: quick220674ms/397críticas152033ms/build456009ms PASS. Los gates143 previos no cubrían el lector/regresión final. [Formal57](../../_stage/parity-map-domain-next/INDEPENDENT-FORMAL57-REVIEW-R1.md) y [FFMain](../../_stage/parity-map-domain-next/ROOT-main57-FF-r1.json):7blobs/disco exactos,48untracked preservados,índice limpio,sin push.

### Próximos residuos causales, sin adelantar58

Fog/zones:13fallos finitos medidos (9API+4Canvas) y3wrap aislados con ABS=local/origen0, controles legacy sanos; [causa API/Canvas](../../_stage/parity-fog-zones-next/CAUSAL-RED-R1.md) y [wrap](../../_stage/parity-fog-zones-next/WRAP-CAUSAL-RED-R1.md). No son una ausencia de todo fog/zones ni un GREEN58; quedan fuera de57.

Paper cut: [referencia Rootr2](../../_stage/ROOT-brave-evidence-next/VVD-mountains-r2.md) observa acabado2D distinto en un volcán y conserva límites de algoritmo/3D/export. Revisar equivalentes propios antes de fijar delta.1095 y el resto de filas siguen abiertos, sin porcentaje/paridad global ni exclusión por ONLINE. Frío con cuantización legacy y descarga Browser a disco no confirmada conservan atribución previa.

## Entrega58: zonas y niebla finitas

Esta adenda sucede al estado pendiente58 conservado arriba; no reatribuye los arreglos a57.

| Subcontrato | Resultado acotado |
|---|---|
| Geometría pública y renombrado | Lectura local desde geometría ABS; cambio sólo de nombre conserva el polígono. Áreas con la escala física vigente. Mismos43criterios API pasan tras9RED causales. |
| Borde finito de niebla | Origen0 real128×64: pincel izquierdo no revela127; trazo2→125 revela63 y no toma el atajo por0. Mismos17criterios pasan tras3RED; legacy conserva wrap. |
| Mapa/Carta Canvas | Proyección local, zona ancha literal/centro correcto y una copia de niebla;7criterios del consumidor de anotaciones y7del consumidor render pasan tras4RED cada uno. Observaciones y RGBA legacy literales. |
| Flujo público y regresión | Native independiente de dos claves cubre36criterios y20controles legacy; Root instala y ejecuta74criterios nuevos conservando los cuerpos originales. Brave Root observa zona/nombre y niebla del capítulo3; reapertura fría UI confirmada y limpieza Browser completada por tres Undo hasta nueve ediciones. |

[Verificación58](verification-fog-zones.md) contiene recibos y atribuciones. Fuente `08c8e0cd9af53651831d246957fbd809b1688879`; aprobación CAS58 exacta e integración Main verificadas. Gates Root PASS sobre115Source/153code. No acredita PNG público, routeReveal, proyecciones adicionales, eras ni portables. Paper cut, nombre custom de landmarks y resto de escritura/SDK siguen abiertos.1095 continúa.


## Adenda59 preparada: SDK29/52/D2-70 y evidencia PNG58

Esta adenda actualiza el estado vivo de S06/SDK29/SDK52/D2-70 y la fila agrupada D2-69..72, conservando literalmente sus checkpoints anteriores. **P/E acotado del core runtime; grupo completo aún P/G**: picker normal, inspección sin ejecutar, paquete único app+tools, instalación al inventario sin rebuild, catálogo, export completo y pins/update/rollback por proyecto ya tienen positivos reales. No instalar pins implícitos ni otro writer. El formato runtime propio no convierte Source/1 en ejecutable. [API, uso y recibos](verification-sdk-runtime-packages.md).

Root hot literal6grupos; Native2claves30tools/34RPC/29IPC/2137inputs exactos/89tablas0; CLI real8criterios/9389B deterministas; renderer del artefacto CLI6positivos con wrapper FAIL de ruta C: conservado. P2 conserva el RED de borrador rico y el mismo GREEN8grupos/69calls/3inputs reales, P-Q/era/CAS/v2/rollback. BOM y dependencia fría Ahash<Bhash conservan RED/GREEN con cuerpos originales; shipping puro5PASS y cold dev propio Root/revisor18tools/26RPC/18IPC/2130exactos/89tablas0. Brave tiene selector, inventario frío, pins explícitos, Save/Undo/cold de documento y app Host; no Surface con hijo ni descarga a disco confirmadas. QA Browser conservada por diseño, no cleanup0 de ese perfil.

Corte r4 e51884cef206a66eb59970c886d1868a6a734d85a6395f436368cbaddf123843,137Source/191code/45owned. Quick r4 PASS153910ms; crítica397 PASS142311ms es r2 anterior a dos cambios de tipos y dos comentarios. Build r4 PASS392221ms. Producción CSP fría Root PASS38tools/46RPC/37IPC/2402inputs exactos/89tablas0,4EOF/revokes401sinIPC/cierre; index/CSP intactos,49recursos dist MIME/SHA exactos/0fallos. GSI opcional suprimido y registrado, no login/app Main instalada. Commit fuente `d4fad2377926191a17320bee8277d347800852ac`,45rutas RAW exactas/Luissalet; CAS59 aprobado exacto por codex-rt59rev y FF Main comprobado bajo mergelease/HEAD fresco;48untracked preservados/índice limpio/sin push. Informe formal distingue runtime propio previo y comprobación final de bytes. **Residuos**: Trial/Keep/Discard, lista de uso/errorfeed60/61 aún sólo Stage, hosting/CRDT/servicios completos y demás ledger. No excluirlos por ONLINE ni inventar dependencia de pago.

PNG58: evidencia posterior sobre115Source/153code, no Source59 ni primeros gates58. Dos claves públicas wh_render_world_map:14PNG/2339547B en14,890s, firma/CRC, nativeImage+CanvasRGBA,15legacy+15finite+sibling/2catálogos PASS y4UndoHTTP. Hoja24×48/origen56,16/cell2; zona2,12→22,20/ABS58,28→78,36, PNG384×768; fog visto11,10 y oculto0,30, capítulo0 intacto. Journal/14grids/meta y píxeles restaurados;88tablas0/3Workers cerrados/hermano literal. [Informe](../../_stage/parity-map-png-next/PNG2-REVIEW-R2.md). R1 observó como oculta una celda dentro del pincel: erratum de fixture, no RED de producto. Permanece abierto Storyraw→render como candidato estático y las demás proyecciones/rutas/eras/portables; no ampliar atribución a Browser/Main instalado ni cerrar1095.


## Entrega60: Trial y Usage sobre paquetes instalados

Actualiza S06/SDK29/SDK52 y D2-69..72 sin reescribir los checkpoints anteriores. **P/E acotado Trial/Usage; grupo general aún P/G**. `wh_local_package_trial_create/keep/discard` crean un proyecto normal con selección explícita, conservan sólo retirando marcador y descartan mediante pending writes/deleteProject habituales. Keep conserva nodo Tiptap real/texto/ruta y datos guardados. Discard permite Save normal antes del check; si el pendiente no se resuelve rechaza sin borrar. No desinstala paquete ni altera hermanos. `wh_local_package_usage` es readonly, sin eval, y devuelve pin actual/disabled y categorías legacy/era-state/document/era-variant/archive; no histories ni montajes actuales.

Root Native dos claves/dos procesos:38tools/44RPC/38IPC/2174inputs exactos/89tablas0/4EOF/401sinIPC/cierre. Portables: Duplicate/JSON identidad nueva retiran marcador y mantienen regla de revisión inicial0 incumbente; ZIP/JSON misma identidad conservan marcador recibido, y ausencia legacy no lo resucita. P1Keep conserva draft; documento y singleton participando del mismo ledger. Nueve pruebas restantes PASS con runners correctos; el recibo richr3 histórico conserva siete PASS y fallo de ListMarkers por runner sin CSS, sin relabel. El caso montado repetido ya no registra project_missing; mantiene avisos act.

Root Browser acredita proyecto conservado con texto guardado/frío y otro con marcador frío→cancelar Descartar→confirmar borrado→Inicio/cinco proyectos; paquete instalado. Son datos QA conservados deliberadamente, sin cleanup0 de perfil Browser ni IDs completos inventados. UsageUI Browser confirmó tres documentos retenidos/ausencia del descartado, pin actual y enlace→editor Unicode con gestor cerrado. Desktop/390/358pxmodal sin overflow local en lo observado; finish SHIP acotado y detector estático=[] no son UIglobal. [Uso/API/recibos](verification-sdk-runtime-trials.md).

Corte60r3 SHA5946164825cf02003a27f9630b1e02573db35b553d6bf3db8f310c2de7978d27:26owned/148Source/204code, HEAD documental59 comunicado09950b6. Quick final r3 PASS133786ms/204code-foreign exactos. Build final r3 PASS320405ms; fuente9c9c7c4e65c968280da40894da28ac621a184f94 aprobada CAS60 exacta e integrada FF en Main con mergelease/HEAD fresco,26RAW exactos,48untracked preservados/índice limpio, sin push. Revisión preparatoria independiente finalR3 positiva: shipping3PASS y Native38tools/44RPC/38IPC,2174wrapper/2173hijos exactos/89tablas0/4EOF401cierre; con aprobación formal CAS60 posterior sobre el commit exacto. Crítica399r1 pertenece a20core antes de handoffUI/tests, no al final. No producciónCSP60 acreditada por la prueba dev; el recibo59 conserva su alcance anterior. Errorfeed61 sigue Stage; hosting/CRDT/servicios completos y demás paridad abiertos. No exclusión automática por ONLINE, cierre1095 ni nuevo asunto de Luis en PENDIENTES.


## Entrega61: feedback efímero y límites SDK

D2-72/SDK29/52/S06 reciben P/E acotado para historial local UI/list/clear, sin cerrar el grupo. Factory fallida antes de instalar conserva identidad de paquete; callbacks transaccionales fallidos revierten datos. Hijo fallido mantiene Rich vecino; Retry mismo montaje count1→2 y recuperación conserva historial. F1 old implementation/new pin tiene RED causal y GREEN propio: se captura hash de presentación, no cambia autoridad ni CAS. Source compilado real lanzando error no entra en feed.

Fuente23cf590c113ffe892702152eec0bce11b9c57cd6,17RAW exactos, aprobación CAS61 exacta e integración FF Main con mergelease/HEAD fresco,48untracked preservados/índice limpio/sin push. Quick133502ms/crítica399 141224ms/build502485ms PASS sobre152Source/213code r1/f0b4e522. Corte finalr2/ab251935 retira sólo un LF vacío final de fixture de test:152Source/otros212code y JavaScript emitido exactos, según ROOT-eof61-r1.json. Gates y casos previos se atribuyen al r1, sin repetir pruebas/build por ese formato. [API/recibos](verification-sdk-runtime-errors.md). Cinco regresiones permanentes; Root área Render/RuntimeRollback/RuntimeTrial PASS3; peer owner PASS2+PASS3 sobre219guardas. Native peer completo13tools17RPC13IPC/dos procesos/2139inputs/4EOF401/cierre/89tablas0 pertenece al candidato anterior al ajuste de presentación/copia, no al corte final. Root wrapper Native original sigue FAIL de loggingguard/preservación; resume-only posterior4/6/4 concluye89tablas0 sin replay de preparación ni relabel. BrowserC1 final390 conserva alerta de fallo actual al limpiar historial y vuelve al mismo texto/ruta; sin Retry Browser ni producción61.

Convergencia/CRDT, prosa por carácter/carets, defaults aditivos, presencia, Host/world-query completo, distribución/hosting y todos los demás residuos del ledger siguen abiertos. Debate1772 fija direcciónA, sin biblioteca ni implementación elegida al entregar61. Sólo suboperaciones de API externa/pago demostradas quedan excluidas; ONLINE no es una exclusión. Sin porcentaje, done1095 ni nuevo asunto de Luis en PENDIENTES. [Primaria local de API](../../_stage/parity-sdk-runtime-next/VVD-sdk-external-apis61-r1.md): d20 y throwd1 funcionan en stand-in de la propia página, por tanto no justifican excluir endpoints/host completos. No apropiarse del alcance de PNG58/runtime59/TrialUsage60 ni reabrir funciones ya entregadas.


## Source62: avance acotado de S02/SDK06/SDK07/SDK09/SDK22

P/E acotado para réplicas explícitas scalar/map/lista estable y persistencia Source; **grupo completo aún P/G**. Se conservan CAS/Save/Undo y writer único. Activación explícita, import/replay/pending/cold, conflicto raw con vista autoral válida, epochs declaradas, historia Base/era y portables sameID frente a nueva génesis tienen pruebas propias. Ni lectura ni export legacy inician historia. Prosa plain/rich sigue siendo un registro entero, no CRDT por carácter. [Capacidad y recibos](verification-sdk-convergence.md).

Fuente `603a3c991f82367e537a38965aebb77775720692` aprobada CAS62 e integrada Main:40 rutas exactas,48 archivos no rastreados conservados, índice limpio, sin push. Manual nativo actualizado con escritura CAS y lectura completa posterior. La ruta permanente offline UI pasa16 grupos,8a1280 y8a390, con89 tablas vacías por viewport; el arranque anterior detenido conserva su resultado separado. Siguen abiertos prosa por caracteres, presencia, defaults aditivos, Host/query completo, hosting y el resto de1095. No se afirma producción/Main instalada ni descarga Browser a disco.

Quickr3/buildr2 incluyen seis hunks finales del control de exportación; crítica399/buildr1 son anteriores. Buildr2 precede la corrección exclusiva del author-kit; contracts-r3 y tipos finales0 cubren ésta. Trece EOL se normalizaron con emisión esbuild idéntica; sólo se retiraron dos LF terminales redundantes del aviso MIT después. No se atribuyen los gates previos a todos los RAW posteriores como una única ejecución. Las tres ventanas runtime solapadas de receipts siguen sin acreditarse, sin defecto Source confirmado. [Verificación y límites](verification-sdk-convergence.md).

Permanecen abiertos carácter/carets, presencia, defaults aditivos, SDK34, Host/world-query completo, transporte automático/hosting y todo residuo no cubierto expresamente. Nueva primaria SDK34 confirma campos tipados de documentos abiertos y exclusión deliberada de cerrados, cuya fuente es el índice durable; no prueba drafts sin guardar. Las entregas runtime59/TrialUsage60/errorfeed61 y las restantes mantienen sus propios positivos. Ningún grupo se excluye por ONLINE sin dependencia API/pago concreta demostrada; no cierre1095 ni porcentaje.


## Entrega63: campos guardados de Source abiertos (SDK34)

**P/E acotado de Source; SDK34 completo sigue P/G**. Puerto opcional `client.openDocuments`, hook `useLocalToolOpenDocuments` y MCP readonly `wh_local_tool_open_document_query` proyectan aliases/campos tipados guardados de Source montados en el proyecto/era actual. Cerrados siguen en el índice durable. Dos hosts deduplican; cierre/reapertura no rescata una consulta antigua y el segundo host ya capturado sí conserva la fila. Lectura sin montar, escribir ni hacer flush; kit con `mountDocument` explícito por instancia. [Uso y pruebas atribuidas](verification-sdk-open-documents.md).

Pruebas públicas/Node/kit, shipping unavailable2/full9 y Native anterior al fix tienen recibos separados. Brave Root posterior por dos paneles normales confirma A7→SaveA8, C11 sólo durable, draft B intacto al cerrar/reabrir A; Save B→reload conserva texto guardado con hosts remontados. Descartar elimina sólo su Trial y conserva el paquete, sin afirmar DB global vacía. Setup parcial inicial y timeout de input confirmado después sin replay se conservan.

F1 H2-ready PASS; mismo probe F2 opcionales PASS; recuperación React conserva RED de primera render A7 obsoleta y mismo renderer GREEN: primera[]/loadingtrue y settled[]. Regresión permanente promovida literal. Corte final18:9producto/8tests+runner, SHA839e8de9. Gates finales PASS recovery-ui2 en17892ms/quick125432ms/build318546ms,3255inputs exactos y comprobación WASM117/5; crítica399 anterior sigue histórica y no se repite. Fuente `f47e8270c63570a7511732f2d1ff1309e8938879` aprobada CAS63 exacta e integrada Main FF:18blobs exactos/48untracked preservados/sin push. Manual63 actualizado y leído completo; continuidad memoria/grafo63 completada por Root (ROOT-continuity63-r1.json).

Siguen abiertos prosa por carácter/carets, presencia, defaults aditivos, documentos fuera de Source, Host/query completo, transporte/hosting y todos los demás residuos. No ABI propietaria, drafts difundidos, cierre SDK34/1095, porcentaje ni exclusión por ONLINE.


## Entrega64: residuo de nombre inicial de landmark

Actualiza **sólo** la fila histórica «Residuo de nombre landmark» de Source57: el nombre custom de add, ya guardado en journal, ahora se propaga a lector/list/find/place_at/Atlas y etiqueta/ficha observadas. Es P/E acotado, aprobado CAS64 exacto e integrado Main; no cierre del área landmarks ni otras filas. Rename sparse explícito mantiene prioridad; quitarlo recupera nombre inicial y defaults generados/sin nombre siguen iguales. [Pruebas](verification-source-abs.md#source64-nombre-inicial-de-landmarks-colocados).

Root GREEN175checks/2066inputs, Nodeárea2/33 y quick149355ms/3255inputs. Native real dos claves19tools23RPC19IPC/2157inputs/89tablas0/EOF401cierres; export JSON normal5252B previo al rename, no MCPexport inventado. Brave normal import→buscar→etiqueta/ficha x5y5→reload conserva nombre; Eliminar sólo importado devuelve los mismos cinco mundos. No14RAW Browser, Undo Native, frío Native, todos los tipos/eras/portables ni app Main instalada. Sin build/crítica nuevos. Fuente5623cb601e5f5a4de7f09e942be2ea40ae78ed1f aprobada CAS64 exacta e integrada Main FF,2RAW exactos/48untracked preservados/sin push. Docs64 integradas Main15d39074 y continuidad64 completas según recibos Root; resto ledger/1095 abierto.


## Source65: reapertura grande verificada

Se cierra sólo el fallo del matcher Base64 con sobres grandes. Regresión16MiB+1/controles inválidos, Node134inputs y quick207708ms/3255inputs positivos. MCP real dos claves conserva15903351B binarios/21204468Base64 completos idénticosA/B/update; exportProjectData normal23162900B, sin MCPexport ficticio. Brave importa, instala definición QA por flujo normal/pin explícito y lee10000elementos/prosa/opaco antes/después de reload; borra sólo importado y mantiene cinco proyectos/dos paquetes anteriores más QAformat65 explícitamente instalado. [Atribución](verification-sdk-convergence.md#source65-validacion-base64-grande). CAS65/Main aprobados, sin build/crítica nuevos ni push.

No entrega textRange/plain: primer público25PASS/1FAIL por puerto ausente, proxylistadverso10k/50k y continuación600s/history44 incompleta conservados. Parche experimental de caracteres sóloStage; no rich/IME/grafemas/presencia/red ni cierre1095.


## Apoyo de Faustus y propuesta plainR3 —28-10-2026

Faustus dispone de transporte MCP y extensión propios para la sesión existente de Brave, integrados en su master mediante el commit e5cb885e2559bc3d07c877492cbcb65d3e61965b y aprobados exactamente en1717/CAS1. Root probó las ocho acciones reales; el revisor comprobó la lectura compacta/completa, referencias, texto, controles, mismos cinco proyectos, pestaña activa, release y EOF. La conexión normal823416aa está disponible. El manual de Google está actualizado y verificado. Este resultado es de clientes MCP: el encargo mediante el modelo sigue pendiente en writers1671 y no cierra1095. El ejecutable portable y el foco global del sistema no están acreditados.

El código funcional de Writer sigue en la entrega65; Source66 no se ha aplicado. El hunk plainR3 LOOKUP.patch2fd319b3 atiende estáticamente S1 mediante un cache limitado a la preparación, manteniendo offsets, duplicados y ancestros. La revisión independiente2f0c4e41 no es ejecución ni SourceGO. Permanecen los seis grupos, v1/A/B/C, RW/Save/Undo/eras/portables,10k/50k/historia100 y MCP/Brave antes de adopción. Rich, presencia y demás residuos conservan su estado previo.

Contraste primario nuevo: [Map](https://beta.vvd.world/tools/map) muestra la versión0.1.67 y la plantilla Mediterranean en su vista previa, con provincias, caminos y ciudades repintables según la interfaz; no se usó Add to World. Esto no prueba datos propios licenciados, persistencia ni funcionamiento sin conexión. A1-007 sigue abierto. Véase _stage/ROOT-brave-evidence-next/ROOT-map-reference67-r1.md.


## Source66: alcance acotado de texto plano

Queda cubierta la parte local opt-in de prosa por identidad UTF16: `textRange` readonly, intención `text-splice`, réplicas independientes del SDK, writer Source/CAS/Save, Undo/Redo autoral y conservación causal. La compatibilidad v1 sigue separada de engine2; el descriptor codec continúa en versión 1. [Contrato actual](../../docs/local-tool-sdk.md#opt-in-plain-utf16-text). El codec JSON/ZIP conserva own undefined frente a ausencia/null y distingue Blob real de datos literales reservados; sus 21 casos puros no se presentan como prueba completa de todos los backups.

Native: dos claves por fase, 41 llamadas en preparación/7 en frío, revocación401/EOF/cierre y 89 tablas propias vacías. Brave: paquete normal, documento nuevo, capturas A/B sobre G, inserciones X/Y, Undo/Redo, reload, reemplazo emoji y borrado/Undo; hermanos guardados exactos y limpieza de sólo su proyecto. Las pruebas SDK de concurrencia independiente y los casos Source/épocas/portables tienen atribución propia; no se infiere igualdad de G entre Native y Browser.

Siguen abiertos rich colaborativo/binding, grafemas/IME, carets/presencia, transporte/hosting, demás Host/query y los otros residuos del inventario. El gesto 101 CPU mide 310,5 ms para 10k y 997,3 ms para 50k, sin promesa de tiempo interactivo ni máximo. Los fallos anteriores de proxylistas y formato permanecen históricos. Source66 está aprobada en writers1790/revisión1 e integrada en Main mediante 77e09b40bf71f4efbe300ea24fed98d619690c99, sin push. El manual66 tiene una sola inserción de 561 UTF16 con CAS y readback íntegro de 201 párrafos; la documentación3db1d298 está en Main y ROOT-continuity66-r1 acredita MEMORY con prefijo exacto y los grafos histórico y propio de Writer, preservando conceptos ajenos, aristas e historia previa. No cierre global ni porcentaje; writers1790 registra este corte y los históricos1095/1195 siguen abiertos.


## Rich HTML editor extensions: bounded continuation

`LocalToolRichProseEditor` now accepts stable optional extensions through the normal host, with unchanged no-prop/[] defaults and full order, and a compatible custom doc installed once. Source `f43703952e92c8f78460dfe09660f97fed42c992` is approved exactly at1796r1; no dependency, arbitrary persistent schema, dynamic reconfiguration or rich collaborative engine3 follows. [API and attributed evidence](verification-sdk-rich-prose.md#optional-rich-editor-extensions-source-f437039).

Root's normal package/Brave checks cover the custom shortcut, local Undo, Save2/Undo3/Redo4 in one session, cold revision4, stable rerenders, custom doc/Save2, Empty and two-tab CAS with B5 winning while A keeps its draft. Independent Source/Owned/readonly/pin/retarget, defaults/full order, Node and registered dispatcher checks retain separate attribution; no new Native/stdio run is claimed. The reference Notes preview's bold/Undo control does not prove multi-author rich behavior. The initial selection-settling attempt remains a preparation failure, without hiding it as a successful gesture.

Open:1808/hilo1958 remote archive removes another host and hides its draft; the readonly/pin positives do not close it. One extra own QA project with four documents is retained after cancellation of irreversible deletion, preserving the original five. No cleanup-to-five or uninstall claim. The proposed engine3 buffers/segment routing, split/join/movement, partial marks, selection/IME and full binding remain Stage only. Presence, Host/query, transport/hosting, the other inventory rows and general1796/1095 remain open; this changes only the bounded extension capability.


## Recuperación Source 1808/1829 y continuidad 67

Fuente 48539f8, aprobada exactamente en ambas revisiones 1 e integrada Main, resuelve la pérdida concreta del borrador rich al archivar Source desde otro consumidor y la primera frontera de navegación del cuaderno. Se conserva la presentación readonly y copiable, se revoca la lease de escritura, restore renueva la generación y el baseline viejo sigue rechazado; Descartar adopta lo guardado o libera el borrador archivado con un aviso único. El flusher del cuaderno confirma el string guardado antes del check pending sin retirar conflictos ni apuntes sin añadir. [Pruebas y límites](verification-sdk-rich-prose.md#source-recovery-48539f8).

Queda superado el «Open:1808» histórico de las extensiones. Brave real y los siete grupos del dispatcher registrado acreditan esa recuperación; no son una nueva prueba stdio/Native ni segunda clave. La revisión independiente añade cinco grupos de storage/Workspace/Host/notebook. Para Rename se conservan un FAIL posterior y un PASS del mismo incumbente observado; la causa no está demostrada y sigue el control operativo de readiness, sin decisión pendiente de Luis ni afirmación de suite determinista.

Las extensiones 67 f437039 y sus docs e807507 ya están en Main; su manual 291 está actualizado y no se repite. El núcleo rico R4 está aplicado sólo en el worktree, sin commit ni integración; pasan F1/F2 (215 comprobaciones) y seis grupos límite (65) del SDK en memoria. Completar la verificación persistente de split/join/movimiento/marcas, Source/CAS/portables, costes y binding, IME/selección/remotos, presencia, Host/query, transporte/hosting y los demás residuos 1095. Se conserva el sexto proyecto QA y sus cuatro documentos tras cancelar el borrado irreversible; no se afirma vuelta a cinco ni desinstalación. Ninguno de estos avances cierra1796/1095 o la paridad completa.


## Texto rico compartido: Source55d391be en Main

La entrega de42rutas está aprobada en writers1796/submission2 e integrada Main por avance directo desde f610a2be. Ya no es una propuesta Stage ni un núcleo únicamente aplicado al worktree. Codec2/engine3 y paragraphs-inline/1 añaden identidades de párrafo y unidades UTF16, cinco marcas, split/join/movimiento y Undo autoral, con componente SDK normal, borrador, Save/Source/CAS/época y capturas readonly por MCP. La explicación de intercambio distingue los campos compatibles de los bloques atómicos.

Native final exacto42:94herramientas/102RPC/94IPC, dos claves por fase, reapertura en otro proceso sobre el mismo perfil sin resembrar,89tablas vacías al final y cierre completo. Node normal147inputs estables, renderer/electron/lint/conformance y build positivos; Brave escribir/Undo/Redo/Discard conserva texto y HTML exactos. [Pruebas por ámbito](verification-sdk-rich-prose.md#collaborative-rich-paragraphs-source55d391be).

Siguen abiertos el árbol de bloques (H1–H3, listas anidadas, citas y toggle), enlaces/tablas/imágenes del perfil compartido, esquema persistente ampliable, IME físico, presencia/cursores/follow, portables no acreditados por este Native, transporte/hosting y demás filas del inventario. Los historiales grandes todavía son lentos: el memo privado reduce trabajo repetido pero no acredita fluidez; el fastpath por run posterior sigue sólo Stage. La ampliación de creación rápida1882 tiene su revisión separada. Conservar abiertas1796/1095 y el hilo1195; no porcentaje ni cierre global.


## Creación rápida44a4d4af y rutas compartidase247b504

Inicio y paleta añaden timeline/board y wh_project_quick_create publica las mismas opciones. La corrección de Home respeta la era real y el navegador del panel, omite Outline y conserva peticiones de otro contexto sin limpiar ni navegar el nuevo. Fuente44a4d4af equivalente exacta a e42ac635 aprobada1882r1, Main12blobs/quick/build y Brave/ejecutorMCP acreditados; manual295UTF16/209párrafos verificado. [Evidencia](verification-quick-create-engines.md#delivery44a4d4af). No cierre general D2-09/15 ni de todos los motores.

El fastpath de rutase247b504 ya está Main con aprobación1796r3 y Native nuevo; supera su anterior estadoStage. El perfilCPU100 sigue midiendo560,7ms de media por gesto10k, no fluidez. CacheRAW y bloques compartidos1883 permanecen en desarrollo aislado. Presencia, IME físico, borradores abiertos, hosting/transporte y demás residuos1095 continúan.


La cache privada de proyección de la réplica también está integrada en Source7d3f1365, aprobada1796r4. Reutiliza lecturas sin cambios e invalida por transacción/contexto, manteniendo copias públicas y las reglas históricas. Pruebas normales, Brave y un nuevo MCP Native con dos claves pasan; no hay una nueva medición100/50k ni aceptación de fluidez. Supera las notas anteriores de cache sólo Stage. Bloques1883 y borradores publicados1890 siguen aislados, pendientes de sus revisiones y aceptación completas. [Evidencia y límites](verification-sdk-rich-prose.md#private-replica-projection-source7d3f1365).


## Actualización1952: guardado automático opcional del perfil compartido

El residuo local de Auto optativo queda cubierto en el alcance1952 tras aceptación/integración de Source `0ac21d2cd02ef500a4ac08f6492d10b94710efe1`, Main `0ac21d2cd02ef500a4ac08f6492d10b94710efe1`. Manual sigue siendo el inicio sin preferencia; la elección personal se recuerda para futuras instancias de la biblioteca, sin cambiar las abiertas.500ms coalescen cambios admitidos sobre el mismo Save/writer, con cobertura documental de ambos campos, H sin confirmar J, composición/readonly/error y salida local sin nuevo Save. SDKsetSaveMode/MCP live_control usan el mismo host existente; lectura/frío no crean editor. [Atribución y límites](verification-autosave1952.md#current-acceptance-of-cut3). No ampliar a todos los módulos o a igualdad del modo predeterminado de referencia.

Las notas previas de Auto pendiente describen sus cortes históricos. Enlaces1958 continúa en diseño sin código. Rendimiento1917 sigue abierto: R6 adoptado conserva la medida histórica321.022263ms medios/p95366.7179 para100gestos/10k; R7 fue medido, marginal y retirado sin commit. No trasladar su cifra a Main ni prometer fluidez, IME físico, hosting o paridad general.


##1958: enlaces compartidos en documentos nuevos

P/E acotado del primer hito: Fuente93e1766088185d209110af5f9f7b8b94bc687109, aprobada exactamente1958/revisión1 e integrada Main sin push, añade links causales en campos optativos paragraph2/tree2. Editor normal, SDK y MCP conservan autoría, rangos, Undo/Redo y el mismo writer/Manual/Auto. Campo1 mixto y lectores3 estrictos no adquieren esa capacidad implícitamente. [Pruebas por superficie](verification-rich-links1958.md).

Native nuevo115/123/115 con cuatro claves y otro Electron/mismo perfil/origen; peer157 y Brave real de dos bibliotecas por SSE tienen evidencias distintas. No se venden dos claves como dos autores ni se trasladan al corte final los positivos parciales deCUT2. Dos defectos de validación SDK corregidos mantienen sus primeros FAIL. ManualGoogle actualizado una vez, delta452UTF16 con215párrafos/estilos comparados.

La frase histórica «enlaces1958 en diseño sin código» queda superada para documentos NUEVOS. Permanece pendiente el segundo hito de adopción explícita de historia3→4(decisión2138);1958/1095/1796 siguen abiertas. Tablas/imágenes, esquema ampliable, IME físico, hosting y demás filas no cubiertas siguen pendientes. Rendimiento1917 conserva su medida histórica deR6 y la retirada deR7; no hay benchmark nuevo ni aceptación de fluidez.
