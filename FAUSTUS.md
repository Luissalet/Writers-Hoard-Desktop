# Writer publishing workspace

En Source compartido, pegar varios párrafos en bloques de texto raíz consecutivos o dentro de un mismo elemento de lista conserva el texto de ambos extremos y el formato del portapapeles. Si pegas en un encabezado, el primer bloque conserva su nivel y los siguientes son párrafos normales. Un solo Deshacer recupera el contenido anterior. El pegado lee la selección visible al llegar el evento, aunque acabe de cambiar con el teclado.

## Continuidad del manuscrito: viajes y libro de estado

Panel «Continuidad» junto al capítulo abierto (debajo del Juez), con dos pestañas.

- **Viajes.** Cada personaje aparece donde lo ponen los sucesos de historia del mapa que lo nombran y, en capítulos
  sin suceso, las ubicaciones del libro de estado con punto de mapa. Cada tramo entre apariciones seguidas se calcula
  con el motor de viajes del mundo (terreno, modo habitual del personaje, estación de la fecha, ritmo y perfil del
  mundo) y se compara con los días del calendario propio: imposible, muy justo (más del 75 % de los días), holgado o
  sin datos (capítulo sin fecha, otro mundo, sin ruta, mundo generándose). Enlaces al capítulo, al mapa y a la ficha;
  un tramo imposible ofrece la fecha mínima del capítulo de destino y «Usar esa fecha» (con Deshacer). Un tramo se
  marca como intencionado con una nota. En el mapa, `?trail=<id de ficha>` (botón «Mapa») dibuja el rastro del
  personaje con los tramos imposibles en rojo y los justos en ámbar. En la línea de tiempo (vista Carriles), cada
  viajero tiene un carril de solo lectura «Viajes · <nombre>» con una banda por tramo, del día de salida al de
  llegada, en el color del veredicto (gris si es intencionado); un clic abre el capítulo de destino.
- **Épocas.** Con una época con nombre activa, el informe lee los capítulos y fichas de esa época y el libro de estado
  escribe en su versión de la ficha (Deshacer en la misma época). Un tramo sin ruta posible para el medio de viaje
  cuenta como problema y se puede marcar como intencionado. El filtro admite fichas creadas solo en la época.
- **Estaciones.** El calendario del mundo dice cuándo empieza cada estación: el año en cuartos por días empezando por el
  invierno (por defecto), cada estación desde un mes, hemisferio sur (invierno y verano cambiados) o sin estaciones
  (se viaja como en verano). Se ajusta en «Calendario del mundo» (sección Estaciones).
- **Libro de estado.** Por personaje y capítulo: está en, aprende, actúa sabiendo, consigue, pierde o entrega (a otro
  personaje), usa, estado físico, muere, revive, aparece. Las líneas viven en la ficha del personaje y se acumulan
  hasta el capítulo elegido: dónde está, qué sabe, qué lleva, estado físico y si vive. Comprobaciones: usa o entrega
  un objeto que no lleva, aparece tras morir (también en sucesos del mapa y tras sucesivas muertes y resurrecciones),
  actúa sabiendo algo antes de aprenderlo (también con dos posiciones explícitas en el mismo capítulo),
  dos sitios a la vez. Los hallazgos se marcan como intencionados con nota. La ubicación del libro alimenta los viajes;
  su punto de mapa se elige entre los que ya usa la historia, buscando cualquier lugar con nombre del mundo (atlas,
  rótulos y sellos propios, sin tildes) o escribiendo `x, y`.
- **Duplicar proyecto.** Las marcas de intencionado y los sucesos de historia del mapa (quién está y en qué capítulo)
  siguen a los ids nuevos de mundos, fichas y capítulos.
- **Juez.** El modo Estado de la historia puede proponer una línea del libro por hallazgo; solo se escribe al pulsar
  «Añadir al libro», o se descarta.
- **MCP.** `wh_travel_check`, `wh_character_state`, `wh_state_ledger`, `wh_state_ledger_add`,
  `wh_state_ledger_remove` y `wh_continuity_mark` (las de escritura, con Deshacer). Detalle en `docs/AI-BRIDGE.md`.

## Voz por personaje

Panel «Voz por personaje» junto al capítulo abierto (debajo de Continuidad) y sección «Voz por personaje» en la ficha
de personaje del Códex; los dos leen el mismo informe.

- **Parlamentos.** Rayas de diálogo (—…—dijo X—) y comillas («», “”, ""), con los incisos fuera del texto hablado.
  Se atribuyen por el nombre o alias ligado al verbo de habla, el párrafo narrativo anterior que nombra a un solo
  personaje o el turno de un intercambio a dos voces. Un pronombre como «ella» se contrasta con el turno y con un
  campo de ficha «Género» o «Sexo» cuando la atribución es inequívoca. Los bloques de Dialog Scene usan su personaje.
- **Perfil.** Parlamentos y palabras, frase media y dispersión, porcentaje de exclamaciones, preguntas y puntos
  suspensivos, tratamiento (tú, usted, vos) y el dominante, registro, léxico propio frente al resto del reparto
  (log-odds, sin artículos ni preposiciones) y muletillas (aperturas y cierres repetidos). Determinista.
- **Fuera de perfil.** Parlamentos que suenan más a otro personaje, con frases mucho más largas o cortas de lo
  habitual, o con el tratamiento que el personaje no usa. «Ir al texto» selecciona esa aparición en el capítulo,
  aunque otro personaje haya dicho la misma frase.
- **Prueba ciega.** 6, 10 o 20 parlamentos sin atribución repartidos entre los personajes; el autor elige quién habla
  y el resultado da los aciertos y a quién confunde con quién.
- **Descripción.** Opcional: el modelo global la redacta a partir de las cifras y unas líneas; el autor la edita y la
  guarda en la ficha (`codexEntries.voice`), con Deshacer.
- **Épocas y MCP.** El panel y la ficha usan la época activa. `wh_voice_profile`, `wh_voice_outliers` y
  `wh_voice_describe` admiten `eraId`. Guardar o quitar una descripción se deshace en la misma ficha.

## Radiografía de ritmo

Panel «Radiografía de ritmo» junto al capítulo abierto (debajo de Voz por personaje).

- **Escenas.** Cada capítulo se parte en escenas por sus separadores (la línea horizontal del editor, `***`, `#`, `⁂`).
  Por escena: palabras, parte de diálogo, narración y descripción (frases de estado e imperfecto), verbos de acción por
  cada 100 palabras de prosa, palabras por frase y un ritmo de 0 a 1 (diálogo, acción y frases cortas lo suben).
  Los capítulos promedian sus escenas por palabras.
- **Curva.** La tensión manual o el ritmo calculado de cada escena a lo largo del manuscrito (por palabras),
  con los beats de los esquemas en morado (en su capítulo enlazado o su posición en la historia) y los tramos
  planos sombreados en ámbar.
  Clic en un punto, en una escena o en un aviso selecciona su comienzo en el capítulo; clic en un beat abre el esquema.
- **Avisos.** Tramo plano (4 o más escenas seguidas dentro de una banda de 0,04 en la curva), escena casi toda
  descripción o casi todo diálogo, escena larga sin diálogo, escena tres veces más larga que la mediana.
- **Tensión.** El autor puede guardar un valor del 0 al 100 % por escena, dejarlo en blanco para usar el ritmo
  calculado y deshacer el último ajuste. El capítulo y la tensión se leen y guardan en la época activa. El valor
  sigue a la escena al moverla si conserva un extremo reconocible.
- **MCP.** `wh_pacing` lee el informe y `wh_pacing_set_tension` fija o borra el valor, con Deshacer.

## Deriva del plan

Panel «Deriva del plan» junto al capítulo abierto (debajo de Radiografía de ritmo): el camino de vuelta de «escribir
el capítulo de este beat».

- **Comparación.** Cada beat de los esquemas de historia frente al capítulo enlazado: personajes, lugares y otras
  fichas del Códex que nombra el beat (nombre o alias), y las semillas y pagos enlazados al beat; en el capítulo, los
  nombres del texto, los sucesos del mapa contados en él y las promesas por enlace o por su título en el texto.
  Estado: lo cumple, se ha desviado (menos de la mitad de lo que nombra el beat) o sin capítulo. Dice qué falta y qué
  trae además el capítulo. Determinista, sin modelo. Capítulos, fichas y sucesos del mapa se leen en la época
  activa. Los beats y las promesas pertenecen al esquema compartido del proyecto.
- **Vistas.** «Este capítulo» (sus beats) y «Todo el esquema» (beats desviados, sin capítulo o con propuesta, y los
  capítulos que ningún beat enlaza), con enlaces al beat y al capítulo.
- **Actualizar el esquema desde el capítulo.** Propuesta con el antes y el después: el título del capítulo si el beat
  se ha desviado (si no, el del beat) y una descripción hecha con la sinopsis del capítulo (o su comienzo) y quién y
  dónde aparece. Solo se escribe al pulsar «Actualizar el beat», con Deshacer.
- **MCP.** `wh_plan_drift` (lectura) y `wh_plan_drift_apply` (escritura, con Deshacer).

## Imágenes en documentos Source compartidos — 2114

El perfil optativo de imágenes admite PNG en el cuerpo raíz. El editor y el SDK conservan la fuente y el tamaño por separado, con Deshacer por autor. Compartir contenido envía los archivos a la otra biblioteca antes de mostrar el cambio. El ZIP conserva las versiones necesarias para recuperar imágenes. MCP importa y consulta los bytes y captura cambios por canal con el mismo writer Source. El perfil optativo de 2161 añade un canal de alineación izquierda, centro o derecha y su acción `rich-image-align`. Deshacerlo conserva tamaño y fuente de otras personas. El perfil 2164 permite PNG, JPEG y WebP con sus bytes originales en el editor, el SDK y MCP. 2167 inserta también en una celda lógica mediante `rich-table-cell-image-insert` y la captura de celda. [Imágenes en celdas](tasks/vvd1095/verification-image-cells2167.md). [Formatos de imagen](tasks/vvd1095/verification-image-formats2164.md). [Alineación y pruebas](tasks/vvd1095/verification-image-alignment2161.md). [Uso y pruebas](tasks/vvd1095/verification-shared-images2114.md).

## Comprobación de documentos Markdown y términos exactos en Borges — 04-11-2026

Comprobación de documentos: panel «Comprobar documento» en las herramientas del documento del editor y herramienta MCP `wh_check_markdown_document` (el resultado trae `passed`, no `ok`, porque `ok` es la bandera del despachador). Reglas KND001-003, DUP001, VOL001, PTR001, FIN001, SUP001-002 en el módulo puro `src/engines/docCheck/checker.ts`; la convención y la sintaxis `<!-- doccheck: allow ... -- motivo -->` siguen a seiso (MIT, aviso en `THIRD_PARTY/NOTICE`), sin copiar su código. El panel comprueba el capítulo abierto; la comparación de hechos duplicados con otros capítulos solo la hace la herramienta MCP con `id`. Pruebas: `node scripts/run-doc-check-tests.mjs`, `tests/doc-check-ui.browser.tsx` (`testDocCheckUi`).

Búsqueda de la biblioteca: pata de términos exactos en la fusión híbrida (`publishing/borges/exact_terms.py`), parámetro `exact` en `library_search` y `GET /library/api/search`, casilla «Términos exactos» en Buscar. Pruebas: `tests/test_borges_exact_terms.py`, `tests/library-exact-terms.browser.tsx` (`testLibraryExactTerms`).

## Campos nuevos en herramientas Source — 2088

`sourceAdditive` declara un campo escalar y un valor por defecto para el origen Source indicado. Cambiar de versión no escribe el documento. SDK y MCP usan el mismo guardado para la primera edición y el mismo Deshacer de sesión. El historial se conserva al reabrir. [Contrato y verificación](tasks/vvd1095/verification-sdk-source-additive2088.md).

## Ancho de columna en tablas compartidas — 2082

En el perfil optativo de anchos, arrastra el borde derecho de una celda o elige un ancho con el teclado. Deshacer restaura al instante la medida y el valor guardable. El ancho sigue al ID de la columna; al guardar, el lector y la reapertura mantienen la presentación. El SDK y MCP comparten la misma operación. [Uso y pruebas](tasks/vvd1095/verification-table-width2082.md).

## Filas y columnas en tablas compartidas — 2047

Las herramientas Source que optan por el perfil de ejes pueden añadir o retirar filas y columnas, escribir en sus celdas y deshacer conservando las aportaciones ajenas representables. Las celdas vacías no crean bloques hasta la primera escritura. El editor, SDK y MCP usan el mismo documento. [Uso y pruebas](tasks/vvd1095/verification-table-axes2047.md).

## Ediciones de wiki por enlace propio — 2056

El Códex puede servir una edición guardada de la wiki en una dirección estable, pública o con enlace privado. Los cambios del mundo no sustituyen el HTML de la edición hasta elegir otra para esa dirección. Retirar el enlace no borra las ediciones. Desde Inicio puedes listar y retirar los enlaces aunque su proyecto ya no exista. MCP usa el mismo servicio y permite listar todas las publicaciones con `allProjects: true`. [Retirada tras borrar el proyecto](tasks/vvd1095/verification-wiki-addresses2085.md). Al publicar o actualizar el enlace, puedes adjuntar o quitar una portada local para la vista previa. La portada comparte el acceso del enlace; la edición guardada conserva sus bytes. [Uso y contrato MCP](tasks/vvd1095/verification-wiki-cover2091.md). [Uso, configuración y límites](tasks/vvd1095/verification-wiki-hosting2056.md). Puedes iniciar un lector local separado para que estas mismas direcciones sigan disponibles al cerrar Writer. [Configurar el lector separado](tasks/vvd1095/verification-wiki-independent2096.md).

## Ediciones de manuscrito por enlace propio — 2097

Ediciones publicadas → **Enlace de lectura de esta edición** sirve la edición congelada en `/read/<ruta>`, pública o con enlace privado, con el mismo servidor, registro CAS, tokens y lector separado que la wiki, sin tocar sus filas: `/read/x` y `/wiki/x` conviven. El dueño se deriva de la edición guardada (relato y era); otro relato, otra era o una revisión obsoleta no escriben. El enlace puede pasar a otra edición del mismo dueño y se retira desde la edición o desde Inicio (**Enlaces de lectura publicados**, también sin proyecto). MCP: `wh_published_edition_host_list`, `wh_published_edition_host_publish`, `wh_published_edition_host_withdraw`. Pruebas: `node --test tests/published-editions-hosting.node.cjs`. [Uso y contrato](docs/published-editions.md#reading-links).

## Imágenes en menciones del Códex — 2028

Las menciones enlazadas de Notas y Escritura permiten mostrar u ocultar la imagen local de la ficha en cada aparición, con el mismo texto, enlace, marcas y Deshacer. La imagen sigue siendo una vista del avatar en su proyecto y época. El lector, la wiki y el documento como imagen usan las referencias incluidas en su ámbito de captura; MCP comparte la preferencia de Escritura. [Alcance y pruebas](tasks/vvd1095/verification-mention-image2028.md).

## Tablas compartidas de tamaño fijo —2003

Las herramientas Source que optan por `blocks-tree/3` y `writers-blocks/2` pueden insertar tablas fijas, editar texto/marcas/enlaces por celda, mover/quitar la tabla y Deshacer conservando las contribuciones representables de otro autor. `examples.shared-tables` muestra ese perfil junto a hermanos estrictos. SDK y `wh_local_tool_state_apply` usan `rich-table-insert` con la captura estructural normal; lectura/export, Manual/Auto y Source siguen los mismos mecanismos. El perfil se declara por campo, selecciona motor5 y no migra historias antiguas al abrirlas.

La tabla necesaria puede sobrevivir a Undo de creación por texto o movimiento ajeno; ocultarla explícitamente sigue siendo otra acción y el último Undo de la aportación superviviente retira su soporte. Las Notas mantienen la barra contextual2009 y su TableKit existente. Filas/columnas mutables, merge/split/anchos e imágenes en el perfil causal, adopción antigua hacia tablas, schema ampliable, IME, hosting y coste siguen abiertos. [Contrato y evidencia atribuida](tasks/vvd1095/verification-shared-tables2003.md). Primer incremento aprobado2003/revisión1 e integrado como1cffcbdb, sin push ni paridad global. El seguimiento40c2400a del aviso de key está aprobado en revisión2 e integrado Main/primary: BraveR6 conserva HTML/IDs y no registra avisos tras el foco. Writer, manifest y MCP no cambian; se mantienen sus evidencias anteriores.


## Controles contextuales de tablas normales —2009

Fuente `d9039d3ee5c3a02f7fda07a355170ddc2cd31f62` aprobada2009/revisión1 e integrada Main/primary sin push. Diez acciones junto a la celda comparten TableKit, selección y Undo del editor normal; conservan el menú y añaden filas/columnas antes. Alt+F10, flechas/Home/End, Enter/Espacio y Escape; se retiran al salir, pasar a readonly o cambiar editor. `wh_edit_writing_document` incorpora `toggleHeaderRow` con CAS y Undo normales.

[Pruebas atribuidas](tasks/vvd1095/verification-table-context2009.md): autor20/legacy26/quick/build; revisor33 en tabla anidada y diálogo escalado; Brave acción/Undo/Save/reopen; Native55tools observadas (53éxitos y2rechazos),63RPC/67IPC/12UndoHTTP y otroElectron frío,89zero final/4revocaciones/EOF/PIDs cerrados. No son55tools positivas ni recibosRedo persistentes. Las tablas compartidas2003 y su arreglo posterior de selección siguen separadas y sin integrar; no paridad1095.

## Estado actual: enlaces en historias compartidas existentes

Fuente `624474ba06e2903293e6d6a4814cf07eec31cf0c` aprobada en1958/revisión2 e integrada Main sin push. **Activar enlaces** actualiza explícitamente el borrador de la pareja conocida3→4, conserva historial/propietario y continúa en la misma sala. Manual requiere Guardar; salir sin guardar recarga sólo la biblioteca local. SDK, `wh_local_tool_live_control action:adopt` y `wh_local_tool_convergence_adopt` usan los mismos editores y writer Source. No hay adopción por leer o montar.

Brave real verifica dos bibliotecas, entrada tardía, Undo/Redo antes y después de Save, reapertura y Leave; revisión independiente verifica recuperación, sala/SSE y sucesores Source/abort/copia. El Native nuevo acredita adopción/Save en77tools y17lecturas frías antes de un fallo de setup readonly: el conjunto conserva FAIL, sin total94PASS ni readonly-live inventado. [Atribución completa](tasks/vvd1095/verification-rich-links1958.md#existing-shared-histories). Auto1952 ya está entregado; rendimiento1917, imágenes/tablas, schema ampliable, IME físico, hosting y la paridad1095 siguen abiertos. Este estado sucede a los pendientes históricos de enlaces y autoguardado que aparecen más abajo.

## Rendimiento parcial del texto rico — 03-11-2026

R5 `2157bc37` y R6 `ca7c553f380ecead992303fa281988679c2fcce7` están aprobados1917/revisiones1 y2 e integrados Main/primary sin push. R6 reutiliza las identidades del recorrido físico al proyectar visibilidad, conservando validación, marcas, autoría e historia. La nueva medida original100gestos/10k da321,022263ms de media y366,7179ms p95; sigue sin aceptar fluidez ni50k.

R6 tiene Node165/109, controles propios48 y peer81 con atribución21SDK+60premisas, quick112,261s/build131,632s, Brave real y nuevo NativeR3 58tools/66RPC/58IPC con dos claves por fase y otro Electron frío. NativeR2 falló por la página QA y permanece FAIL; sóloR3 acredita el recorrido. [Pruebas y límites](tasks/vvd1095/verification-rich-performance1917.md).1917 y autoguardado1952 siguen abiertos. La conciliación1957 corrige ausencias documentales antiguas sin universalizar sus flujos.


## Contenido local compartido — 03-11-2026

Source `48ba665be0d96a10eab6774fd4798660f6c3cf1d`, padre1c41e1da, está aprobado en la revisión1 de1913 e integrado en Main y primary. La opción **Compartir también el contenido del documento** antes de Crear/Unirse intercambia todos los campos sobre las réplicas y Undo existentes; personas y cursores siguen siendo la opción predeterminada. Guardar escribe sólo en esta biblioteca. Salir sin guardar aquí concilia únicamente el Save ya iniciado y recarga el Source actual, conservando el borrador de otras vistas.

SDK y cuatro herramientas registradas operan sobre esa misma instancia abierta: query/capture de lectura, batch atómico y control undo/redo/save/leave. Consultar en frío no crea una vista ni sala. Autor Source59/original8da/UI, revisión independiente53+3 y Brave de Root tienen atribuciones separadas. El corte finalR3 añade sus tres UI, relay11, Brave nuevo, quick106,600s/build140,359s y Native nuevo58tools/66RPC/58IPC con dos claves por fase y otro Electron frío. [Pruebas y límites](tasks/vvd1095/verification-live-content1913.md).

Root integró los25blobs aprobados bajo merge lock, con índice/canon/no rastreados y rules ajenas conservados, sin push. El manual Google y la continuidad MEMORY/Store ya están actualizados con sus recibos propios; no se repiten sus escrituras. Autoguardado1952 continúa pendiente para la siguiente entrega, junto a hosting, rendimiento1917, IME físico, schema persistente ampliable y enlaces/imágenes/tablas del perfil. No se declara paridad1095 ni que los candidatos de rendimiento estén Main. Este checkpoint complementa las entregas integradas anteriores.

## Deshacer con aportaciones de otra persona — 03-11-2026

Sourceef9abe94 está aprobado1932r1 e integrado Main. Deshacer la creación de un contenedor conserva los párrafos activos de otro autor, con texto, formato e identidades; sólo mantiene el soporte causal necesario y respeta ocultaciones y retiradas independientes. Rehacer y Guardar conservan el mismo writer. SDK, revisión independiente, Brave y MCP real con segunda clave/reapertura tienen evidencia separada. [Comportamiento y límites](tasks/vvd1095/verification-undo-support1932.md). No entrega contenido vivo1913, fluidez1917, IME o paridad general.

## Estado integrado: bloques1883, borradores1890 y Enter1895 — 02-11-2026

Source69899cb9 (1883, revisión1) y Source004ee3e1 (1890, revisión1) están aprobadas e integradas Main, sin push. El perfil compartido añade H1–H3, listas anidadas, citas y toggle sobre el mismo writer/identidades/Undo; la publicación de campos de borrador es opt-in por instancia Source, separada de la consulta guardada habitual.

Enter sobre un item vacío ya sale de la lista con la misma hoja y un único Undo, Sourcee35a3185 aprobado1895r1 e integrado Main. Conserva texto ajeno, numeración actual y los casos anidados aceptados; Brave y un nuevo Native40 acreditan Save/frío con sus alcances. [Comportamiento y pruebas](tasks/vvd1095/verification-empty-item1895.md).

El estado de guardado Sourceaf68bee8 está aprobado1920r1 e integrado Main: un editor limpio no aparece guardando; guardar inmediatamente después de editar conserva la última edición y los borradores en recuperación siguen pendientes. La revisión retiene el falloR1 y su mismo control corregido; Brave y Native14 nuevo completan la aceptación. [Pruebas y límites](tasks/vvd1095/verification-rich-save-status1920.md).

Los documentos Source permiten crear o unirse a una sesión local mediante vínculo y perfiles elegidos expresamente. Una persona conserva sus conexiones distintas sin aparecer duplicada; el SDK añade presencia opcional y MCP la consulta sin unirse. El host muestra punteros, Follow y carets/selecciones reconocidos por la vista receptora; una posición desconocida se oculta sin importar ni guardar texto. Esta información efímera no forma parte del documento, Save, Undo o historial. Usa el servidor local existente, sin servicio de pago; el intercambio vivo de contenido y el hosting siguen separados. [Uso, pruebas y límites](tasks/vvd1095/verification-sdk-presence.md).

Native combinado93 prueba el Host compuesto, Save normal y frío, incluida consulta saved/published sin productores fantasma. Native36 acredita por separado la publicación explícita; Root conserva Brave, quick/build y sus alcances. [Bloques](tasks/vvd1095/verification-shared-blocks1883.md) y [publicación](tasks/vvd1095/verification-sdk-published-fields.md). Este estado supera las notas históricas de entrega pendiente. Siguen abiertos el contenido vivo 1913, hosting, coste de historiales grandes 1917, IME físico, schema persistente ampliable y enlaces/imágenes/tablas del perfil; 1095/1796 continúan abiertos.


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

En **Fichas → Adversario Daggerheart → Partida**, el **Rango de poder** 1–4 muestra el nivel del grupo: 1, 2–4, 5–7 u 8–10. El selector de tipo conserva el texto libre anterior hasta que se elige otro valor. La ficha mantiene dificultad, umbrales grave/severo, bonificador y ataque estándar, alcance, daño, motivos y tácticas, y marcas de PV/Estrés. Las experiencias tienen nombre y modificador entero; los rasgos, nombre, tipo Pasivo/Acción/Reacción y texto. Guardar aplica los cambios a Base o a la era efectiva y conserva las filas libres existentes. Papel y JSON incluyen estos datos.

Para editar por MCP, lee la ficha y su revisión con `wh_sheet_get`; envía la ficha completa y esa revisión a `wh_sheet_update` en el mismo ámbito. `rows[].daggerheartAdversary` admite `{kind:'experience',modifier:-2}` o `{kind:'feature',category:'reaction'}`; conserva el ID de fila y usa `name` y `detail` para el nombre y el texto. Las filas sin ese campo siguen siendo libres. Se conserva el Deshacer de ficha; una revisión desfasada o metadatos inválidos rechazan la escritura. [Contrato, evidencias y límites de #2985](tasks/vvd1095/verification-daggerheart-adversary2985.md).

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

Writer retains its document editor, origin5174/IndexedDB and independent fiction worker. Library, reading, paperwork and publishing are four independently controlled modules; since 04-11-2026 (Ágora #1711) reading and paperwork call Links Hoard (5181) and Kafka's Hoard (5200) by reference through Hoard Hub instead of carrying their engines (`publishing/fusion/external.py`; REST `/api/external`, MCP `wh_publishing_external_hoards` / `wh_publishing_external_start`; UI bar with Start with Hoard Hub / Check / Open); the embedded copies `publishing/links_native`, `publishing/kafka_hoard` and `publishing/native/pdf` were retired the same day. Initial catalogue/status is cold; API/MCP/UI share the 422 publishing tools (links/paperwork entries refreshed from the running apps with scripts/refresh-external-catalog.py; paperwork view has Dossiers) and native IDs/formats. Real profiles/tokens/conversations are not migrated by source changes. Cicero remains separate; Borges belongs to Writer, not Hypatia. Home/Cook and People/Dorian remain separate.

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
English function names. Calculated table columns and Codex properties also support [IFERROR](tasks/vvd1095/verification-table-iferror2709.md), with a lazy fallback for recoverable formula errors. Calculated tables accept [structured column references](tasks/vvd1095/verification-table-iferror2709.md#referencias-estructuradas-de-columna) for whole-column formulas. Excel import/export preserves explicit positive column
widths, including empty columns, with a Calibri 11 / 96 dpi conversion basis.
Renaming a column retains its saved width. Other formatting, fonts and merged
cells are not imported; the import report lists detected losses. See
`docs/verification-xlsx-widths.md` for verification and scope.

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

Tablas y hojas ofrecen Insertar fila encima, Subir/Bajar y asa de puntero, con IDs/celdas conservados y Deshacer normal. Ordenar/agrupar sigue separado del orden manual. Mayús+clic amplía la [selección por rango de filas visibles](tasks/vvd1095/verification-table-row-range2714.md). En tablas normales, las flechas y Tab recorren las celdas visibles. Mayús+flecha o Mayús+clic amplía el rectángulo desde su celda inicial. Intro o doble clic abre una celda editable. [Navegación con teclado](tasks/vvd1095/verification-table-cell-keyboard2715.md). Con el foco en la cuadrícula, Ctrl+C copia un rango como TSV y Ctrl+V pega un bloque con un solo Deshacer. [Portapapeles de tablas](tasks/vvd1095/verification-table-cell-clipboard2721.md). Suprimir o Retroceso vacía las celdas editables seleccionadas con un solo Deshacer. [Vaciar celdas](tasks/vvd1095/verification-table-cell-clear2736.md). En una hoja, escribe para reemplazar la celda o pulsa Intro para editarla y otra vez para guardar y bajar. [Teclado de hojas](tasks/vvd1095/verification-sheet-cell-keyboard2751.md). Copia fórmulas como TSV, pega dentro de los bordes de la hoja y vacía un rango con un solo Deshacer. Las columnas numéricas de la hoja muestran un total para todas sus filas, incluidos los resultados numéricos de fórmulas. Las tablas vivas del Códex también admiten [orden manual de filas por ámbito Base/era](tasks/vvd1095/verification-table-live-row2688.md). El inspector de lugar reutiliza el buscador normal de fichas por título o alias y conserva los enlaces a escenas/escritos/sucesos. Zonas añade intensidad0–100; cero conserva zona y rótulo.

Source y editor antiguo reciben `context.focusMode` opcional y hook de concentración: chrome oculto/inert pero montado, borradores/clientes retenidos y salida explícita/Escape; Pantalla completa independiente. MCP get/set usa hosts reales, sin guardado implícito y con IDs efímeros. Catálogo949. Fuente a8e9ba6+a55e6e aprobada exactamente CAS49 e integrada por FF; Main manifest949/contratos6/Nativefoco2claves pasan. Gates ROOT quick/build/crítica396 y pruebas reales Brave tienen recibos separados. [Contrato y atribución](tasks/vvd1095/verification-rows-places-zones-focus.md). 1095 y paridad general siguen abiertos; sin push.

## Pantalla completa en Tablas y hojas

Desde la barra del documento, **Pantalla completa** amplía la cuadrícula dentro de Writer. Conserva el ámbito Base/era, la agrupación, los filtros, la selección y el borrador. En vista dividida se amplía el panel dueño; el otro queda montado, sin recibir interacción. Pulsa **Salir de pantalla completa** o usa Escape si ningún editor de celda, menú o diálogo lo está usando. Cambiar la pestaña compañera mientras su tabla está ampliada restaura la vista dividida y conserva la cuadrícula anterior en su pestaña.

`wh_workspace_focus_get` y `wh_workspace_focus_set` usan el mismo estado de la interfaz para destinos montados y visibles con `namespace: 'tables'`. Los IDs de host son efímeros y se resuelven en el proyecto, la era y el documento efectivos. Un destino oculto o revocado no está disponible y la solicitud no queda en cola. Es un cambio de vista sin guardado implícito ni Deshacer de documento. La concentración del editor Source conserva su comportamiento. [Uso y evidencia de #2942](tasks/vvd1095/verification-table-fullscreen2942.md).

## Pantalla completa del Grafo del Códice

En **Códice → Grafo**, **Pantalla completa** amplía el panel del grafo dentro de Writer. Se conservan el lienzo, la cámara, la selección y los filtros. El panel vecino queda montado e inactivo mientras se amplía el grafo. **Controles del grafo** abre los mismos filtros y ajustes; desde ellos, Escape cierra los controles primero y devuelve el foco al botón. Otro Escape o **Salir de pantalla completa** recupera la disposición anterior. Ampliar o salir no guarda el proyecto; el espaciado, los ajustes y las posiciones fijadas siguen guardándose por proyecto.

`wh_workspace_focus_get` y `wh_workspace_focus_set` usan el destino visible `world-graph` por proyecto y Base/era, sin `documentId`. Usa el `hostId` efímero observado en el mismo ámbito. Un panel oculto no admite acciones; volver a Fichas revoca el destino del grafo. [Uso, contrato y pruebas de #2991](tasks/vvd1095/verification-world-graph-fullscreen2991.md).

## Tiempo por fecha y ficha del lugar

Worldgen añade tiempo determinista por punto y fecha exacta del calendario propio,
con temperatura, precipitación, viento, nubes, fenómenos, salida y puesta del sol,
fases de todas las lunas y luz nocturna relativa. El panel Lugar y Viaje comparte
la fecha activa. La opción de aplicar el tiempo a un viaje empieza desactivada,
conserva su itinerario y recalcula duración y noches; el plan guardado conserva
su calendario y fecha. La captura creativa reutiliza ese contexto.

La ficha «Estar allí» amplía las tarjetas de lugar existentes: relieve, vegetación,
sustrato y materiales posibles, alimentos del bioma, lengua y ascendencia del árbol
existente, mercado con producción/precios y asentamientos y ruinas a 150 km.
Los datos derivados no sustituyen las decisiones culturales del autor. El puente
expone `wh_get_world_weather` y `wh_describe_world_presence`, con el mismo ámbito
de proyecto/época y estado pendiente que las demás consultas Worldgen.

Modelo ficticio con inclinación axial fija y horas solares locales. La estación del
calendario gobierna la temperatura y la luz solar según la latitud. La luz lunar es
relativa, sin cálculo de salidas de luna ni posiciones sobre el horizonte. El componente de capítulo
`ChapterWorldContext` usa su fecha y vínculos explícitos al mapa, sin extraer lugares
de la prosa. [Contrato y límites](src/engines/worldgen/PLACE-CARDS.md).

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


## Entrega63: campos guardados de Source abiertos

Puerto opcional SDK, hook y MCP readonly seleccionan aliases/campos tipados de Source montados en el mismo proyecto/era. Cerrados siguen en el índice durable. Membresía efímera deduplicada y revalidada tras el último await; lectura sin montar, guardar ni hacer flush de otro draft. Kit con mounts explícitos y mismo proyector, sin segundo writer. [API, pruebas y límites](tasks/vvd1095/verification-sdk-open-documents.md).

Brave Root por dos paneles normales acredita A7→SaveA8, C11 cerrado durable, draft Unicode B intacto al cerrar/reabrir A y Save B→frío UI con hosts remontados. Trial propio eliminado mediante Descartar; paquete instalado. Setup inicial parcial y timeout de input sin replay se conservan. La textarea Browser es React local; controles Rich reales pertenecen a Native/shipping, sin DB global vacía en el perfil Browser.

F1 H2-ready y F2 opcionales pasan; RED React de primera render obsoleta tiene el mismo renderer GREEN y regresión permanente literal. Fuente `f47e8270c63570a7511732f2d1ff1309e8938879` aprobada CAS63 exacta e integrada Main FF,18blobs exactos/48untracked preservados/sin push. Gates finales recovery-ui17892ms/quick125432ms/build318546ms PASS con3255inputs exactos/WASM117/5; crítica399 anterior no se repitió ni se atribuye al final. Manual63 actualizado/readback completo; continuidad memoria/grafo63 completada por Root (ROOT-continuity63-r1.json). No todos los cards/Codex, prosa por carácter/presencia/defaults/hosting ni cierre1095.


## Entrega64: nombre inicial de landmarks colocados

El lector conserva el nombre autorado al añadir un landmark; rename explícito posterior mantiene prioridad y generados/sin nombre conservan defaults. Root Brave importó el JSON normal previo al rename, verificó búsqueda/etiqueta/ficha x5y5, recargó y borró sólo el importado, volviendo a los mismos cinco mundos. [Pruebas y límites](tasks/vvd1095/verification-source-abs.md#source64-nombre-inicial-de-landmarks-colocados). Quick y controles públicos/Native pasan; sin build/crítica nuevos. Fuente5623cb60 aprobada CAS64 exacta e integrada Main FF,2RAW exactos/48untracked preservados/sin push.1095 continúa.


## Entrega65: reapertura de sobres causales grandes

El validador Base64 deja de agotar la pila con checkpoints grandes y conserva formato canónico/presupuesto de estado. Regresión16MiB+1, Node del área y quick positivos; MCP real dos claves devuelve el estado completo y Brave importa/abre/recarga el mismo documento con10000elementos/prosa/opaco intactos. [Pruebas y límites](tasks/vvd1095/verification-sdk-convergence.md#source65-validacion-base64-grande). Fuente5db5570dd6185ecfb3be1d26b70abb08b1678d40 aprobada CAS65 exacta e integrada Main FF/sin push. Texto por caracteres, rich/presencia y1095 continúan abiertos.


## Continuación66: texto plano por identidad

El SDK y los documentos Source admiten opt-in `plain-utf16/1`, rangos capturados y `text-splice` sobre la misma historia causal, writer, CAS y receipts normales. Las unidades conservan identidad aunque se borre su ancla o se retire una inserción padre con un hijo remoto. Borrados concurrentes no se revierten al deshacer sólo uno de sus autores; pendientes y fallback válido conservan sus vínculos. Prosa atómica, rich guardado y campos opacos siguen separados. El codec portable conserva own undefined frente a ausencia/null, Blob real y etiquetas Blob/envelope literales; la regresión pura de 21 casos conserva sus comparaciones originales.

Las pruebas públicas/Source y las de persistencia mantienen alcances distintos. Root Native comprueba 41 llamadas/41 IPC en preparación y 7 llamadas/7 IPC en proceso frío, dos claves por fase, revocación401 sin IPC posterior, EOF y 89 tablas propias vacías al final. Root Brave instala el paquete por selector normal y crea un documento propio: capturas A/B del mismo G, X/Y→aYXb, Undo→aXb, Redo, recarga con G persistente, reemplazo por emoji, borrado y Undo; los hermanos atómico/rich/opaco permanecen exactos. Borrar sólo ese proyecto devuelve los cinco anteriores. No es una prueba de réplicas offline independientes dentro de Brave ni de 89 tablas vacías de su perfil normal.

El ensayo CPU del gesto 101 mide 310,5 ms con 10k y 997,3 ms con 50k unidades UTF16, con historia conservada; no son máximos, tiempo de tecla, SourceRW ni latencia Browser. Los ensayos antiguos adversos y sus límites se conservan. Rich colaborativo, IME/grafemas, selección/carets/presencia, red/hosting y la paridad general siguen abiertos. [Contrato de autor](docs/local-tool-sdk.md#opt-in-plain-utf16-text). Este avance no cierra 1790 ni los históricos 1095/1195.


## Extensiones del editor rico del SDK: fuente f437039

El componente público admite `extensions?:AnyExtension[]` estable durante el montaje y lo transmite al editor nativo. Sin prop o con `[]` conserva defaults y el orden full; un `doc` propio compatible se registra una sola vez. Se mantienen el HTML admitido, el saneador, el writer y los controles de Guardar/CAS/Deshacer, sin dependencias nuevas ni configuración dinámica.

Root probó el mismo paquete normal en Brave: atajo ignorado antes del cambio y callback/marcado después, Deshacer local exacto antes de Guardar, Save2/Undo3/Redo4 en la misma sesión y recarga posterior con4 y hermanos intactos. Comprobó también doc propio paragraph+/Save2, array vacío y conflicto entre dos pestañas: B guarda5 y A conserva su borrador al rechazar el Save obsoleto. El revisor independiente pasó Source/Owned, defaults/doc/orden full, retarget/capacidad/pin y el dispatcher registrado Source/Owned/era; esto no es una nueva prueba Native/stdio. Fuente `f43703952e92c8f78460dfe09660f97fed42c992`, cuatro rutas, aprobación exacta1796r1, Luissalet y sin push. Build e integración tienen recibos propios de Root.

El archivo remoto que desmonta otro host y oculta su borrador sigue abierto en1808/hilo1958; no se da por resuelto mediante las pruebas de readonly/pin. El perfil Browser conserva los cinco proyectos previos y un sexto QA propio con cuatro documentos: Root canceló su borrado irreversible, sin afirmar limpieza global. Engine3/routing rico continúa sólo como propuesta Stage. [API, evidencia y límites](tasks/vvd1095/verification-sdk-rich-prose.md#optional-rich-editor-extensions-source-f437039);1796 y1095 permanecen abiertas.


## Recuperación Source y navegación del cuaderno —1808/1829

La fuente `48539f81933988e49a9a028853a7a447a0e73057`, cuatro rutas sobre e807507, está aprobada exactamente en las revisiones 1 de 1808 y 1829 e integrada en Main, con autor/committer Luissalet y sin push. El Host de una prosa rica pendiente conserva su instancia y borrador al archivar Source desde otro consumidor; pierde autoridad de escritura y deja el contenido copiable readonly. Restore renueva la generación y un Save con el baseline anterior se rechaza sin perder el borrador. Descartar adopta lo guardado o libera la presentación archivada con un solo aviso. No hay restauración implícita, autosave ni nuevo escritor.

El cuaderno vinculado confirma síncronamente la retirada del string que acaba de guardar antes del check afterWrites; la comparación funcional conserva otro valor posterior, y un error o un apunte pendiente siguen bloqueando la salida. Se mantienen el ledger y el hook comunes. El revisor independiente acreditó cinco grupos con storage/Archive normales, incluidos flush, conflicto, apunte pendiente, navegación emitida y aviso default/único; no es teclado físico o transporte Native.

Root comprobó la retención y restauración en Brave real con dos pestañas. El test permanente pasa siete grupos con archive/list/restore por dispatcher MCP registrado; no hay una nueva prueba stdio ni segunda clave. La navegación intacta ya supera la frontera inicial. Conserva un FAIL posterior «Rename erased draft» y un PASS completo del mismo test con observador de lectura, con entradas habilitadas y exactas; ese PASS no reproduce ni explica el FAIL. El seguimiento de readiness es operativo, sin decisión pendiente de Luis ni causa de producto inventada.

Esto supera el pendiente 1808 de las notas históricas de extensiones 67. Su fuente f437039 y documentación e807507 ya están en Main; el manual 67 tiene una inserción de 291 UTF16 y readback íntegro verificados, que no se repiten. El núcleo rico R4 está aplicado sólo en el worktree, sin commit ni integración. Sus oráculos permanentes del SDK en memoria pasan F1/F2 (215 comprobaciones) y seis grupos límite (65); Source persistente, MCP y binding web siguen pendientes. [Evidencia atribuida](tasks/vvd1095/verification-sdk-rich-prose.md#source-recovery-48539f8); 1796/1095 y la paridad completa siguen abiertos.


Las herramientas Source locales pueden declarar un perfil propio de texto enriquecido compartido: párrafos, cinco marcas e identidades estables de texto. El editor del SDK conserva un borrador local, Guardar explícito y Deshacer/Rehacer por autor; los cambios independientes se combinan mediante el writer Source habitual. Siguen pendientes los encabezados, listas anidadas, esquemas arbitrarios y presencia compartida, y los historiales grandes aún son lentos. Es independiente del editor HTML enriquecido existente. [API de autor](docs/local-tool-sdk.md#collaborative-rich-paragraphs); [pruebas y límites](tasks/vvd1095/verification-sdk-rich-prose.md#collaborative-rich-paragraphs-source55d391be). Fuente55d391be integrada Main, aprobada en writers1796/revisión2; sin push. El manual de Google refleja el perfil y sus límites mediante dos sustituciones acotadas (+509UTF16), con209párrafos leídos y comparados. No cierra1796/1095.


El resumen del proyecto y la paleta permiten crear una línea temporal o un tablero de corcho a partir del título, además de escritos, notas y esquemas. Las opciones respetan los motores habilitados; la creación y la apertura conservan la era del panel, donde los esquemas no están disponibles. MCP ofrece las mismas opciones y Deshacer normal. [Uso y pruebas](tasks/vvd1095/verification-quick-create-engines.md#delivery44a4d4af). Fuente44a4d4af integrada Main, equivalente exacta al patch e42ac635 aprobado en1882r1. Rich67 y la mejora de rutas e247b504 también están Main; bloques compartidos1883 y cache RAW posterior siguen sólo en desarrollo, sin paridad global.


La cache privada de proyección de la réplica también está integrada en Source7d3f1365, aprobada1796r4. Reutiliza lecturas sin cambios e invalida por transacción/contexto, manteniendo copias públicas y las reglas históricas. Pruebas normales, Brave y un nuevo MCP Native con dos claves pasan; no hay una nueva medición100/50k ni aceptación de fluidez. Supera las notas anteriores de cache sólo Stage. Bloques1883 y borradores publicados1890 siguen aislados, pendientes de sus revisiones y aceptación completas. [Evidencia y límites](tasks/vvd1095/verification-sdk-rich-prose.md#private-replica-projection-source7d3f1365).


## Guardado automático opcional del editor compartido —1952

El editor normal y el SDK ofrecen Manual/Automático por instancia documental. Sin preferencia previa empieza Manual; elegir modo recuerda un predeterminado personal para futuras aperturas de esta biblioteca, sin imponerlo a otros paneles ya abiertos ni a otras personas. Automático reúne contribuciones admitidas no cubiertas durante500ms desde la primera, sin reiniciar el plazo por cada tecla o lectura, y usa el mismo Guardar/writer Source para todos los campos. Manual fuera de sala conserva Guardar independiente por campo.

Composición/recuperación/readonly o contexto retirado impiden publicar un corte incompleto. El ACK de H no confirma J admitido después; pasar a Manual cancela futuros intentos y conserva el vuelo iniciado. Un error mantiene el borrador y exige Reintentar explícito. Salir sin guardar aquí inicia cero Save/retry y concilia sólo los ya iniciados; tras recargar, la nueva sesión local vuelve a guardar con la elección retenida. SDK setSaveMode y MCP live_control normal actúan sobre el host abierto; frío no lo fabrica.

Fuente `0ac21d2cd02ef500a4ac08f6492d10b94710efe1`, Main `0ac21d2cd02ef500a4ac08f6492d10b94710efe1`, sin push. [Contrato y atribución](tasks/vvd1095/verification-autosave1952.md#current-acceptance-of-cut3). Esta adenda sucede a los pendientes históricos de Auto, sin reatribuir sus pruebas ni cerrar enlaces1958, rendimiento, IME físico, hosting o paridad1095.


## Enlaces causales en documentos compartidos nuevos —1958

Las herramientas locales pueden ofrecer enlaces en campos de párrafos o bloques compartidos. El editor normal muestra la dirección actual y permite crear, cambiar y quitar el enlace conservando texto e identidades. Deshacer/Rehacer, Manual/Automático e intercambio local usan el mismo writer Source. SDK y MCP ofrecen las mismas operaciones; un campo legado del contrato mixto conserva sus cinco marcas y no recibe enlaces por estar en engine4.

Fuente93e1766088185d209110af5f9f7b8b94bc687109 aprobada exactamente en1958/revisión1 e integrada Main, Luissalet y sin push. Node139, editor montado61, Source23, regresión Auto79, quick/build, revisión independiente157, Brave real de dos bibliotecas por SSE y Native nuevo115tools/123RPC/115IPC tienen [atribución separada](tasks/vvd1095/verification-rich-links1958.md). El manual de Google se actualizó una vez mediante CAS y lectura íntegra: sustitución64→516UTF16, delta452,215párrafos y estilos conservados; no se repite Auto1952.

Sólo documentos NUEVOS nativos4/perfiles2. La adopción explícita de historia existente3→4, decidida en2138, sigue pendiente dentro de1958. Esta nota supera su descripción histórica de diseño sin código únicamente para el primer hito. Rendimiento1917, imágenes/tablas, IME físico, hosting y demás residuos1095 siguen abiertos; no hay paridad completa ni decisión nueva pendiente de Luis.

## Descansos configurables del ritmo forzado —2319

El panel Viaje del mundo generado permite elegir los días de marcha entre descansos completos del ritmo forzado. Campo optativo `TravelProfile.hardRestEvery`, entero positivo seguro: ausencia o6 conserva el comportamiento anterior, y3 u otro valor cambia sólo ese ritmo. El intervalo cuenta el viaje completo tras unir etapas; no añade descanso después de una llegada exacta. Duración, relojes de tramos/llegada y reproducción conservan el mismo intervalo del resultado. Los itinerarios guardados mantienen su perfil propio al abrirse sin reescribir el ajuste actual del mundo.

Las herramientas MCP existentes get/set travel settings y plan journey usan el perfil compartido. La UI fusiona el escalar con los demás factores/medios; MCP `profile` reemplaza el perfil completo, por lo que debe leerse y reenviarse con `expectedRevision` para conservarlos. Undo mantiene su alcance de perfil/ritmo completos y preserva cambios posteriores conforme a ese contrato. Propiedad Base/era y portables JSON/ZIP/duplicado cubiertos por pruebas del autor. Restablecer física de serie mantiene los medios propios. Datos antiguos conservan6; no hay nueva API externa ni se altera el enrutador. Fuente `a76ba8d3`, revisión1 aprobada e integrada en main sin push: Root verificó17controles del perfil, Brave real con itinerario3 recuperado en frío/mundo5 intacto, llegada y reproducción del descanso, y puente genuino con dos claves distintas para set/get/plan más Undo HTTP autenticado. [Recibos, atribución y límites](docs/verification-travel-rests.md). Contraste actual de referencia: descanso tras3 fijo y etapa414kmSteady16½d/Hard16¾d; no se observó campo editable y no se afirma equivalencia numérica de la física ni paridad global.

## Edición visual de glifos del diccionario —2326

Configurar idioma conserva el textarea y añade edición de cada sonido. Restablecer una asociación usa el alfabeto que el autor elige explícitamente como referencia; seleccionarlo no sustituye todo el mapa. Se cambia la última entrada efectiva de esa clave conservando las demás líneas raw, duplicadas, ignoradas y saltos originales. La forma nativa ofrece Insertar glifo: inserta en el cursor o sustituye sólo la selección y usa Guardar/Cancelar/recuperación existentes. Explorar catálogos no modifica el idioma. Con la paleta abierta, cambiar la selección actualiza los glifos disponibles dentro del límite existente del campo; la inserción comprueba de nuevo el rango actual antes de escribir.

Catálogos locales declarados: Tifinagh U+2D30–U+2D67 y Runic U+16A0–U+16EA; Ogham/Glagolitic mantienen los glifos de sus presets actuales y se incluyen destinos personalizados. Son caracteres Unicode, sin fuente o gráficos copiados de la referencia; se conserva el flujo de fuente local del autor. Modelo, IDs, operaciones, CAS, drafts y MCP settings/save_word/search no cambian. Fuente `8848c659`, revisión2 aprobada e integrada sin push: Root ejecutó10grupos del área y Brave real con Tab/Enter/Escape, foco/caret, sustitución dentro del límite50000, reset individual y Guardar/frío exactos. La revisión1 falló en Brave y su corrección conserva ese recibo. La prueba genuina independiente de19MCP/19IPC y dos claves distintas verifica valores literales y mapping raw por las APIs existentes; el gesto visual se acredita por separado. [Atribución, capturas y límites](docs/verification-dictionary-glyphs.md), incluida revisión visual normal/reducida por Browser. La restauración Base/era ya existente no se duplica; archivoMCPBase2327 conserva su entrega aparte y no se afirma paridad global.

## Archivo Base de diccionarios por MCP —2327

`wh_dictionary_archive` retira un idioma de Shared base al Archivo normal, conservando palabras, identidades y mapping completos. Requiere la versión actual mediante `expectedVersion`; la restauración usa `wh_archive_restore`, la UI de Archivo o Undo HTTP existente. Para eras se mantienen hide/version/restore de era. Fuente `a6a5be43`, revisión1 aprobada e integrada sin push. Root acreditó22MCP/23IPC con dos claves distintas, Undo ligado a su recibo y cambios posteriores de idioma hermano preservados; ZIP normal desde Native → importar en Brave → restaurar esa misma copia → recarga fría con IDs, derivación y mapping exactos. Son dos bibliotecas privadas conectadas por transferencia ZIP explícita, sin afirmar MCP directo a Brave. [Contrato y límites de las pruebas](docs/verification-dictionary-archive.md). La aceptación independiente de glifos2326r2 queda separada. Continuidad2330: un párrafo del manual actualizado con revisión requerida y lectura inversa exacta de797párrafos, memoria append-only y dos conceptos Writer mediante Store sin embeddings ni alterar filas o aristas previas.

## Anotaciones declaradas en prosa colaborativa —2336

Una herramienta Source puede declarar una clase de anotación por campo `paragraphs-inline/3`, con atributos escalares completos y valores enumerados opcionales. Cuaderno de pistas usa clave y estado. El editor normal permite aplicar, editar o quitar la anotación sin perder texto, negrita, cursiva, subrayado o enlaces; Cancelar y aplicar sin cambios conservan el borrador. El perfil se declara expresamente y no migra historias anteriores al abrirlas.

SDK y MCP existentes capturan el rango por identidades y usan el mismo writer Source. Root verificó29MCP/29IPC en warm/cold separados, cuatro claves auténticas revocadas401 y una réplica SDK con autor independiente: las claves no son autores. Deshacer mantiene atributos y formato ajenos. ZIP/Native conservaron datos, descriptor, IDs y checkpoint; Brave importó el ZIP normalmente en127/localhost y comprobó SourceIDs por ruta, atributos/formato/enlace en DOM y HTML exacto tras compartir, guardar y reabrir en frío, sin leer su checkpoint privado. La conexión compartida usa el relay local normal y Join relativo conserva el origen de la otra biblioteca. Fuente `327c0051`, revisión2 aprobada e integrada sin push. [Contrato, atribución y límites](docs/verification-sdk-inline-annotations.md). Nodos arbitrarios, múltiples clases por campo, bloques anotados, migración general, rendimiento100ms y paridad completa continúan abiertos.

## Enlaces de tareas al copiar proyectos —2349

Notas → To-do conserva los enlaces a capítulos y fichas del Códex al duplicar un proyecto o importar su JSON: apuntan a los documentos de la copia. Se mantienen texto, estado, urgencia, fecha, orden, revisión y timestamps de las tareas; tampoco se sustituye un ID que aparezca como prosa literal. Una referencia ausente obtiene identidad estable por tipo, sin crear el documento ni reconectar después con la fuente. Proyectos antiguos sin todos conservan esa ausencia. El ZIP normal transporta estos enlaces entre bibliotecas.

Source `3ea6f14b`, revisión1 aprobada por Root, integrada en main `d61e174d` sin push: sólo worldMetadata y regresión; UI, modelo y herramientas MCP existentes no cambian. Root repitió seis focales finales; los57 casos de área anteriores siguen atribuidos a5a+delta y el fallo preexistente esperado88/observado89 de duplicado sigue FAIL en ambos lados. Native Root2353r4 acredita57MCP/58respuestas bridge contando UndoHTTP aparte,17canales internos, dos procesos y cuatro claves distintas EOF0/401; JSON usa la API normal del renderer con IDs fuente ocupados. Root importó sus dos ZIP intactos en Brave, abrió los documentos por gesto y cotejó regiones completas de tareas tras reload. Son bibliotecas separadas mediante ZIP explícito, no MCP directo a Brave. [Contrato, atribución y límites](docs/verification-task-link-portability.md). Sin assets externos, Assignee/Mine, nueva semántica de eras o paridad global.

Continuidad2367 ejecutada tras GO concreto de Root: manual párrafo389 con inserción213UTF16 y799párrafos/798ajenos/recurso inverso exactos; memoria append4184bytes con prefijo íntegro; dos conceptos Writer mediante Store embed=False,401/9/695→403/9/697, sin alterar filas o aristas previas. La revisión e integración de los cuatro MD tiene su voto independiente.

## Portada local de mapas generados —2365

World Generator permite elegir una imagen local de archivo o Galería para la tarjeta del mapa, cambiarla, quitarla y Deshacer. La portada es independiente de thumbnail: cuando no hay una elegida, la colección utiliza la vista generada disponible. La copia conserva sus bytes aunque cambie o se borre el original de Galería. No genera ni abre terreno ni modifica el lienzo, las exportaciones cartográficas o Reader.

El propietario efectivo sigue el ámbito normal de ajustes: una era heredada escribe la portada compartida de Base; un root propio o sólo existente en la era conserva su portada allí. El panel avisa de que cambiar o quitar una portada compartida afecta a las eras que la heredan. `wh_get_world_cover` devuelve ámbito efectivo, revisión y ownerToken opaco; `wh_set_world_cover` exige `expectedRevision` y `expectedOwnerToken` obtenidos del getter, incluso en la primera escritura. Deshacer de campo conserva terreno/metadatos ajenos y rechaza una portada posterior o un owner reemplazado. No-op conserva el dominio sin recibo mutable de campo; la auditoría MCP normal tras el relay permanece. Los checkpoints Base y assets deduplicados siguen el middleware normal; la era conserva el history de su variante.

Source2365 revisión3 está aprobada por Root e integrada en main `21bffd6134907c9e3ff64c2f51b76771d132ada6`, sin push. Native final sobre ese HEAD verifica dos procesos, cuatro claves revocadas401, DTO/snapshot fríos exactos y89tablas vacías. Brave acredita los ZIP anteriores sobre26cb con serializers/core idénticos y el aviso heredado final sobre21bffd; no se afirma una importación Brave de los ZIP de la repetición final. El manual ya recibió un único añadido de255UTF16, con816párrafos/815ajenos y estilos/listas/recurso inverso exactos. Continuidad2377 aplicada tras GO final de Root: un append de2561bytes a memoria con prefijo íntegro y dos conceptos propios mediante Store embed=False;403/9/697→405/9/699, conservando todas las filas y aristas previas. Recibos incrementales y verificación final PASS, sin nuevas llamadas Google. [Contrato, atribución y límites](docs/verification-map-cover.md), incluidos los fallos históricos del observador. La paridad completa y el panel SDK/map-lens siguen pendientes.

## Herramientas Source contextuales de mapas —2382

Mapas y World Generator ofrecen «Herramientas para este mapa». El panel mantiene el objetivo real, el tipo, la época y el modo de lectura; permite varios documentos Source por mapa y abrirlos en Source. El ejemplo «Revisión de mapa» guarda notas ricas y un sello de la versión real consultada. Guardar, Deshacer, copia JSON, duplicado y ZIP utilizan los servicios existentes. Una vista histórica muestra las notas actuales guardadas en modo de lectura; no promete reconstruir notas históricas. Base/época, borradores, cambio de objetivo y fullscreen conservan las guardas y recuperación deliberada normales. El encabezado muestra Base o «Época actual», sin exponer el ID interno, y conserva el aviso heredado.

El autor declara `mapPanel` optativo, version1, campo reference y tipos maps/worldgen admitidos. Se usa la definición compilada/pin seleccionados, sin sustituirlos por otra versión. `initialActions` sólo admite acciones set normales; el documento y su referencia se crean en una revisión inicial atómica. Omitirlas o pasar [] conserva defaults; null, validación fallida o segunda acción inválida no dejan documento parcial. No se introduce otra tabla, writer, ledger ni formato portable.

MCP añade `wh_local_tool_map_list` y `wh_local_tool_map_open`; create admite initialActions y describe devuelve el descriptor seleccionado. List no abre ni crea. Open exige host vivo, objetivo/ámbito y release exactos, y pasa por pending-save normal; applied confirma admisión de selección, no paint del mapa. No arranca aplicaciones ni deja una cola para un host ausente. Las cuatro rutas MCP aportadas por Root tienen lectura independiente del autor Source.

Source2382r2,17rutas/4711blobs ajenos exactos, está aprobado e integrado por Root en main27b4e398 bajo merge lock, sin push. Se conservan los seis gates previos y la repetición proporcional del módulo real Base/E tras corregir el encabezado. Native real de Root pasó warm/cold sobre ese HEAD:289MCP,290respuestas bridge incluyendo un UndoHTTP,17solicitudes internas de duplicación aparte, dos procesos y cuatro claves diferentes revocadas401. Se preservan fallo previo de observador y corrección de sus cuatro defaults normales, sin cambiar producto. Auditoría independiente2441r1 aprobada por Root, con8artefactos/111inputs cotejados; se conservan sus límites de compilación y ausencia/ownundefined.

Root comprobó en Brave dos ZIP importados normalmente, notas independientes Base/A2/E, nota visible en vista histórica y fullscreen, pending-flush/Save and return, cruce Maps/Worldgen en E, targets ocultos/sólo de era, deep link/Open in Source y panel420CSS de364px sin overflow propio. La aceptación final incluye JSON Base/E/F heredada y reapertura normal en F tras reload:33observaciones, no33casos, y16estados cargados cotejados. Dos lecturas tempranas A2 aún eran A; la lectura estable posterior acredita A2 guardada sin reescribirlas. Cada ZIP tiene25archivos+18directorios=43entradas físicas, con CRC completo. La revisión visual2443r1 sobre tres PNG no halló problema material; su detalle menor del input común Local image queda acotado. Los dos errores de consola observados son de Zotero, no del origen app. El autor documental no ejecutó esas pruebas; Vite y pestaña propios de Root están cerrados y viewport restablecido. Continuidad2444 aplicada tras GO concreto de Root: el manual ya actualizado por Root conserva829párrafos/828ajenos y+621UTF16; este autor hizo un único append de4102bytes a memoria (1906285→1910387, prefijo íntegro) y dos Store.upsert_concept con embed=False,405/9/699→407/9/701, conservando schema y todas las filas/aristas previas. Recibos finales PASS, EOF0/stderr0 y dos leases globales liberados, sin nuevas llamadas Google ni modelos. Source2382 está cerrado: su autor retiró normalmente WT/rama, con6ancestros/41887hijos sin reparse/0procesos y17Source-main exactos; Research preservado, perfiles históricos rechazados sin tocar. La primera entrega documental e0c41994 ya está integrada; este estado final conserva revisión propia. [Contrato, atribución y límites](docs/verification-map-tools.md). Se conservan portada y herramientas builtin; overlays, geometría por frame y paridad completa siguen fuera de este corte.

## Inserción y orden directo de ejes Radar —2425

El radar permite insertar un eje antes de otro desde el hueco del gráfico y ordenar los ejes mediante su asa de arrastre o Alt+Arriba/Abajo. Se conservan Añadir eje y los botones anteriores de subir/bajar. Identidad, escalas, pasos, unidades, iconos, colores, series, valores crudos y enlaces vivos al Códex permanecen asociados al mismo eje. El nuevo eje recibe valor0 en cada serie, sin heredar un binding ajeno.

Se usa el borrador normal con Guardar y Descartar confirmado; Escape cancela un arrastre no admitido. Un cambio de estructura durante el gesto invalida ese destino capturado. El gráfico editable denso desplaza su contenido dentro de la tarjeta en pantallas estrechas para separar los huecos; el lector muestra el contenido sin gestos de autor. La categoría de preset admite el límite existente de200caracteres.

`wh_radar_axis_insert` y `wh_radar_axis_move` guardan por identidad estable con expectedRevision y ámbito Base/era normales; beforeAxisId omitido o null añade al final. Leer primero con wh_radar_get. Negativas y CAS conservan el gráfico anterior y los controles; JSON de gráfico/proyecto, duplicado y ZIP usan los serializadores existentes. La recuperación de este gesto sigue Guardar/Descartar y cancelación antes de drop, sin otro contrato de Undo persistido Radar.

Source2425 revisión3 está aprobada e integrada localmente en main6ac8efa4, sin push. Nueve blobs de índice/HEAD exactos; ocho RAW exactos y el test normalizado íntegro de CRLF a LF por los atributos Git existentes. Root completó Brave con los dos ZIP actuales y aprobó la auditoría independiente Native2452r1. Root registró126tools/call y125respuestas bridge,17IPC internos de duplicación aparte, cuatro claves401 y cuatro stdioEOF0,89tablas vacías y perfil retirado. El renderer Native no montó un SourceHost ni un editor Radar: sus comprobaciones API y las de UI/Brave tienen atribuciones separadas. [Uso, evidencia y límites](docs/verification-radar-axis.md). El manual ya está actualizado por Root:830párrafos, los829originales íntegros, nueva viñeta409/tabt.0 y+677UTF16, con estilos/listas e inverso completo exactos. Root retiró normalmente WT/rama Source2425:6ancestros/41891hijos/0reparse/0procesos, nueve Source-main exactos, remotes/untracked intactos y sin Force; Research y perfiles rechazados conservados. Doc2 está integrada localmente en main3a6c34fa, sin push. Continuidad externa aplicada una vez tras GO Root: memoria1914920+4310=1919230bytes con prefijo/sufijo exactos y marcador único; dos Store.upsert_concept(embed=False),407/9/701→409/9/703, schema y todas las filas/aristas/historias previas exactos, embeddingsNULL. Root verificó el estado final PASS y se liberaron sólo las dos leases globales propias; cero Google adicional/modelos/aristas explícitas. La retirada del WT documental se acredita al cierre por recibo; no se afirma paridad global.

## Comprobaciones y campos map nuevos en Source — 2455

Una herramienta Source puede añadir un único map vacío mediante `sourceAdditive`, manteniendo el mismo documento, nombre y otros campos guardados. Se elige V2 en **Gestionar motores → Versiones de herramientas locales**. Leer muestra el vacío sin guardarlo; la primera edición efectiva inicia y guarda el cambio atómicamente, también si V1 se guardó sin activar intercambio. No se exige pulsar Activar antes de usar la herramienta. Un no-op o una edición inválida no inicializan el documento.

El ejemplo `examples.source-map-notebook` añade **Comprobaciones**: escribe una etiqueta y pulsa Añadir comprobación, marca su checkbox o quítala; Deshacer/Rehacer usa los recibos normales de sesión. Nombre tiene Guardar y Descartar. Un borrador permanece recuperable al pasar a readonly, con Descartar local y sin Guardar habilitado. Las claves son independientes: DeshacerA conserva la clave distinta de B aunque B escribiera después de recibirA.

SDK/MCP reutilizan creator, pin, read, state.apply/Undo y convergence start/export/import. El contrato admite predecessor engine1 completo y un map simple/default exactamente `{}`, sin flags de referencias/assets ni cambios en campos previos. CAS sigue estricto; no amplía Save completo, promociones múltiples o Undo remoto/global. Base ya promovida puede tener COW normal en época; ZIP mismoID conserva checkpoint y JSON/Duplicate nuevoID hacen fork semántico. [Contrato, pruebas y límites](tasks/vvd1095/verification-sdk-source-map-additive2455.md).

Source b7e1215 está integrado en main, con aceptación acotada de MCP autenticado, instalación CLI real, otro proceso frío y ambos ZIP finales importados en Brave. El cuaderno conserva nombre Unicode y otros valores; Base y F heredada comparten las comprobaciones y E mantiene su aportación propia. Brave verifica también primera edición sin Activar, Deshacer/Rehacer, Descartar, recarga y420CSS. El manual ya está actualizado y verificado por Root. Memoria y grafo siguen pendientes de sus leases y recibos; esta entrega no los modifica.

## Transporte de sonidos locales — 2475

En un bloque Propio Sonidos locales, selecciona un medio local y pulsa Reproducir efecto o música. Pausar conserva el handle y su posición sin sonido; Reanudar continúa y Posición en segundos permite buscar, también en pausa. Volumen, panorama estéreo, buses, foco, loop y Detener sonidos conservan su función. Al reabrir o recargar, el bloque queda detenido: los handles no se guardan con el documento.

SDK y hooks añaden pause/resume/seek/getPosition y estado paused. Las herramientas MCP existentes permiten controlar el handle preparado del ámbito y pedir posición con includePosition, sin iniciar ni poner audio en cola por una llamada de agente. La posición es digital del contexto, no medición de altavoz. [Contrato, pruebas y límites](tasks/vvd1095/verification-sdk-audio-transport2475.md).


## Preparar y liberar audio local — 2494

Sonidos locales y AssetPad permiten **Preparar** el audio seleccionado, consultar estado/duración y **Descartar preparación**, también mientras la petición está pendiente. Play sigue disponible sin preparar. Descartar sólo libera esa retención: una voz adquirida, pausada o reproduciéndose, conserva su búfer y transporte. Detener sigue actuando sobre la voz y no descarta por sí solo la preparación. Cambiar de recurso o desmontar libera las retenciones propias; al reabrir o recargar no hay caché ni autoplay.

`LocalToolAudio` añade supportsPreload, preload(lista,{signal}), getPreloads y releasePreload. Cada entrada conserva un ID runtime propio. Dentro del mismo coordinador/ámbito, un binding efectivo y versión iguales comparten decode; SDK libera sólo su owner, mientras el release MCP normal puede retirar IDs de owners del mismo proyecto/era. El backend Browser usa decode real sin contexto de salida, resume, fuentes, grafo ni cola. Los backends antiguos conservan Play y comunican unavailable si no soportan preparación. Un buffer retenido sobrevive al cierre idle de la salida; el siguiente Play admite su contexto y voz normales, revalidando recurso/versión.

`wh_local_audio_control` añade preload con refs y release-preload con preparationIds opcional; devuelve preparaciones sin iniciar ni poner audio en cola. El owner default duradero permite la primera petición MCP antes de que exista un cliente SDK o Play. `wh_local_audio_status` sólo añade preparations con includePreloads:true; leer no crea owners ni decode. Para una cascada de slot se obtiene primero la ref efectiva con wh_local_asset_resolve; una ref Source explícita por MCP resuelve el compilado seleccionado o su releaseHash exacto registrado. Un audioEngine custom es otro coordinador, sin caché compartida con el default. [Contrato, evidencia y límites](tasks/vvd1095/verification-sdk-audio-preload2494.md).

Source `873178bd` está aprobado en revisión independiente e integrado localmente en main, sin push. Root completó Brave real y Native autenticado warm/cold; el manual ya está actualizado. La tarea Source 2494 y la revisión 2493 están cerradas, con WT/rama Source retirados normalmente. Memoria y grafo siguen pendientes de su lease compartida; esta entrega no los modifica.


## Oyente y emisor de audio por cliente — 2505

Sonidos locales añade Modo de audio Estéreo/Equalpower/HRTF, emisor X/Y/Z y oyente X/Y/Z en metros, giro en grados y Restablecer oyente. El giro 0 mira a -Z y +90 a +X. Intro o salir del campo confirma un número finito; Escape recupera el valor mostrado de ese campo, manteniendo la edición. Elegir/configurar un modo no reproduce. Estéreo sigue siendo el inicio y Play continúa disponible sin preparación o modo espacial.

SDK expone supportsSpatial/spatialModels y getListener/setListener/resetListener/getSpatial/setSpatial. El oyente es de ese cliente/owner, no global del proyecto o contexto; dos hooks del mismo cliente comparten su oyente. Getters son pasivos y detached. SetSpatial sustituye la configuración completa o admite null para volver a estéreo; al mover se conservan explícitamente modelo/distancias deseados. Cambios pendientes o pausados no arrancan/reanudan. Las voces mantienen ID, buffer, volumen, panorama posterior y transporte; resume/seek reconstruyen Panner nativo, incluido HRTF, sin conservar historia del segmento anterior. El gate de reloj audio corta la respuesta al terminar recurso; no promete cola HRIR completa.

wh_local_audio_status añade owners/ownerId/spatial sólo con includeSpatial:true. wh_local_audio_control amplía listener/listener-reset por ownerId exacto y spatial por handleId/objeto o null, dentro del proyecto/era normal; no selecciona el primero ni difunde a todos. Una consulta no crea owner/contexto ni cola y el owner frío no entrega su pose a clientes futuros. Backends legacy sin capacidad conservan Play estéreo y devuelven false/null honestos. [Contrato y atribución](tasks/vvd1095/verification-sdk-audio-spatial2505.md).

Source `82eafc27`, revisión 2, está integrado en Main sin push, con Native real y Brave de Root y revisión de acabado 2521 favorable. Las poses y handles son runtime: reload reinicia estéreo/detenido y conserva el medio. No se atribuye salida de altavoz, HRTF perceptivo universal, SourceHost/CLI instalado por el arnés o migración de Soundscape/Reader/wiki. Rendimiento 2318 sigue en seguimiento; la continuidad MEM/KG combinada 2464/2504 está completada. La tarea 1095 conserva su Done histórico y la paridad continúa en hilo 1195/tareas nuevas.

## Lista vacía añadida a Source

Una definición Source puede añadir una lista vacía con `sourceAdditive`, predecessor completo e `idKey` estable. Leer y seleccionar versión son pasivos; el primer `state.apply` efectivo es atómico y conserva los campos anteriores. Los clientes SDK y las herramientas MCP normales comparten acciones list y Undo scoped; las claves MCP no identifican autores de réplica. El cuaderno shipping V1/V2 permite guardar nombre y editar, marcar, ordenar o quitar pasos con Deshacer/Rehacer. No habilita migración general, cambio de tipos, semillas no vacías ni promoción de una V1 heredada. [Contrato, evidencia y límites](tasks/vvd1095/verification-sdk-source-list-additive2540.md).

Una versión Source puede ampliar otra versión aditiva o saltar un ancestro declarado. Conserva los valores y el origen, y guarda el primer cambio efectivo en una revisión. [Ampliaciones sucesivas](tasks/vvd1095/verification-sdk-source-multiple2745.md#encadenar-ampliaciones-desde-otra-versión-aditiva). [Lee una etapa anterior](tasks/vvd1095/verification-sdk-source-multiple2745.md#leer-los-campos-de-una-etapa-anterior) para ver sus campos con los valores actuales. [Edita campos de una etapa anterior](tasks/vvd1095/verification-sdk-source-multiple2745.md#editar-los-campos-de-una-etapa-anterior) desde la lectura activa. Un [documento Source nuevo](tasks/vvd1095/verification-sdk-source-multiple2745.md#usar-etapas-declaradas-en-un-documento-nuevo) puede usar sus etapas declaradas al guardar el checkpoint activo. Una versión Source puede declarar la [migración explícita de un escalar](tasks/vvd1095/verification-sdk-source-multiple2745.md#migrar-un-escalar-a-un-nombre-nuevo). También puede [cambiar la forma del estado con un callback](tasks/vvd1095/verification-sdk-source-multiple2745.md#transformar-el-estado-source-con-un-callback). Un documento iniciado también puede [migrar valores con el mismo codec](tasks/vvd1095/verification-sdk-source-multiple2745.md#migrar-valores-source-con-el-mismo-codec). Una versión puede [migrar desde varios codecs anteriores](tasks/vvd1095/verification-sdk-source-multiple2745.md#migrar-desde-varios-orígenes-source).


## Abrir un bloque Source al lado

`client.openDocument('local-tool', documentId, {blockId: 'notes'})` pide abrir un bloque del documento en un compañero. El componente recibe `context.focus?.blockId` y decide qué sección mostrar, también en pantalla completa. La vista principal conserva el documento completo. Guardar y Deshacer desde la vista lateral usan el mismo documento y el ámbito efectivo del panel.

`wh_local_tool_document_open` recibe `projectId`, `documentId`, `blockId` y, para una época, `eraId`. `available` informa de si hay un espacio de trabajo que pueda atenderlo y `applied` de si la navegación admitió la solicitud. `wh_workspace_tabs` permite consultar la ruta. La apertura respeta el tratamiento habitual de borradores. [Uso y verificación](tasks/vvd1095/verification-sdk-source-block-focus2590.md).


## Comandos propios con Deshacer en Source

En Cuaderno vinculado, **Añadir pauta de revisión** incorpora los dos apuntes que falten en un paso. La acción usa el mismo historial de la edición normal. Deshacer y Rehacer se aplican desde el editor o compañero que la ejecutó, y una edición efectiva posterior al Deshacer inicia una nueva rama.

`useLocalToolUndoCommand` declara el lote con el mismo controlador `useLocalToolState`; un recibo efectivo añade un paso a su pila. MCP permite listar y ejecutar el comando en una instancia visible exacta mediante `wh_local_tool_command_list/run`. El token de la instancia se renueva al cambiar su binding o visibilidad. El comando se ofrece en el editor Source ordinario y en su compañero. [Contrato y verificación](tasks/vvd1095/verification-sdk-author-undo2602.md).

## Deshacer el orden de ensayo en Source

En Cuaderno vinculado, **Orden de ensayo** permite mover Apuntes y deshacer o rehacer sus movimientos durante la sesión. Cada vista mantiene su ensayo. **Aplicar orden** guarda una edición que se revierte con el Deshacer normal. Si los apuntes guardados cambiaron durante el ensayo, Aplicar conserva el ensayo para que puedas revisarlo o descartarlo.

`useLocalToolUndoProvider` registra el modelo vivo del autor y su historial en el editor Source ordinario o su compañero. El teclado usa la pila de esa vista. MCP lista y ejecuta Deshacer o Rehacer mediante `wh_local_tool_undo_provider_list` y `wh_local_tool_undo_provider_run` para la instancia y el token vigentes. [Uso, contrato y verificación](tasks/vvd1095/verification-sdk-undo-provider2614.md).

## Deshacer marcas agrupadas en Source

En Cuaderno vinculado, **Lista para revisar** marca apuntes temporalmente en cada vista. Las marcas consecutivas se deshacen y rehacen juntas. Al cerrar la vista se pierde su selección. Los apuntes guardados y el orden de ensayo conservan sus estados.

`useLocalToolUndoableCommand` registra las inversas de un modelo del autor. `LocalToolUndoAnchor` dirige el teclado al historial de la región activa. La lista publica voluntariamente `review-shortlist` para usar el mismo historial mediante las herramientas MCP de proveedor. [Contrato y verificación](tasks/vvd1095/verification-sdk-pushed-undo2620.md).

## Skills for the agents that connect

This app carries procedures from the skill library of the family's workspace for the agents that connect to it: writer: `manuscript-continuity-edit`, `writing-plans`, `notes-from-templates`; borges: `read-later-digest`, `deep-research`, `web-to-clean-markdown`, `notes-from-templates`; gutenberg: `hallmark-page-design`, `web-accessibility-design`, `docs-release-review`; scheherazade: `manuscript-continuity-edit`, `game-design-document`. They are named in what an agent reads on connecting, read with `skills_list` and `skill_read`, searched and assigned with `skills_library` and `skills_assign`, and offered as prompts. The person chooses them on the skills page (`/api/agent/skills/page`) or in the hub's Skills tab; the `skills` block of `faustus-plugin.json` holds what the app asks for by default. Over MCP stdio the adapter (`electron/aibridge/skills.ts`, used by `mcpStdio.ts`, also for `--publishing-module` and the story/core connections) reads the copy the hub keeps in `<data>/skills/` (`WH_SKILLS_DIR`, which the manifests set to `{DATA_DIR}/skills`; without it `backups/skills` beside the token folder), adds `skills_list` and `skill_read` to the tools, names the skills at the end of the instructions and offers them as `skill-<slug>` prompts; with no copy or `HOARD_SKILLS=0` nothing changes. The manifests launch the adapter built in this repository (`node electron/build.mjs`), not the one inside the installed app.
