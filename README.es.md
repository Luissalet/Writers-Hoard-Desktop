# Writers Hoard — Escritorio

[English](README.md)

Plataforma local de escritura creativa empaquetada como aplicación de escritorio con **Electron**. Comparte la base React/Vite/Dexie con la versión web, pero la ventana nativa amplía los límites de almacenamiento del navegador e incluye descargas multimedia con `yt-dlp` y `gallery-dl`, sin servidor Python aparte.

> Plan de transición: [`tasks/desktop-transition.md`](tasks/desktop-transition.md).

## Preparación y publicación local (tarea1095)

Los perfiles de wiki publican notas, tablas, tableros, cronologías, fichas de personaje, diccionarios, árboles, gráficos radar, modelos3D y documentos de herramientas locales declarativas como páginas propias. Incluyen búsqueda, selección masiva para incluir/omitir/mover, subsecciones y orden por arrastre, con perfiles guardados y ediciones locales inmutables. Los tableros se leen como listas de tarjetas visibles; el dibujo espacial y las páginas de paisaje sonoro quedan fuera. Las eras, campos privados y exclusiones se aplican antes de resolver contenido y recursos.

El inicio muestra creaciones mensuales de escritos, escenas, Códex, notas, esquemas y fuentes existentes, una siguiente acción contextual y consejos manuales. Inicio y paleta crean escritos, notas y esquemas por sus operaciones habituales; escritos/notas admiten eras y los esquemas pertenecen a Base. Las consultas con filtros no se convierten en documentos. La biblioteca incorpora menú contextual para fijar referencias con Deshacer sujeto a revisión y una lista de documentos abiertos desde ella durante esta sesión de ventana. Nieve, lluvia, brasas y luciérnagas opcionales respetan movimiento reducido y modo de rendimiento.

Las sesiones de ficción se planifican sin iniciar la partida: fecha/hora, zona local, duración, lugar, gancho, notas DM privadas y asistencia. El resumen manual permanece como borrador hasta dejarlo listo para compartir localmente y marcar jugada; no se envía nada. Los personajes retirados se conservan y su estado se cambia expresamente desde la asistencia vinculada al terminar. Se mantienen los19 contratos y filas originales; se añaden tres herramientas de sesión. [Alcance y límites](docs/OFFLINE-PREPARATION.md).

## Biblioteca y publicación

Writer incorpora biblioteca, lecturas/enlaces, documentos/trámites/PDF y el motor/editor editorial completo de Gutenberg como módulos independientes, apagados inicialmente. Conserva formatos y contratos MCP nativos. [Capacidades, verificación y traslado](docs/PUBLISHING.md). La ficción y el perfil/origen 5174 existentes se conservan.

## Ficción interactiva

Writer incorpora los mundos, continuidad, sesiones, dados, hilos, relojes,
narración y exportaciones de Scheherazade. **Ficción interactiva** está en la
barra lateral; mundos/juego, narración con el modelo global, voz e ilustraciones
se controlan por separado y empiezan **desactivados**. Los datos anteriores se
usan en su carpeta original. Toda la interfaz, las 19 herramientas MCP y la API
se incorporan a Writer; el antiguo servidor deja de ser necesario. El instalador
incluye el motor privado. [Funcionamiento, datos y límites](docs/FICTION.md).

## Autoría local de mundos

El código actual añade eras nombradas sobre Base compartida, paneles de documento
independientes, Biblioteca mixta, tipos/propiedades reutilizables de Códex y
editores contextuales. **Nueva ficha** en Biblioteca reutiliza el formulario
normal y guarda ficha y carpeta seleccionada en una transacción. El manuscrito
puede tener un dock aparte, ordenable y con herencia proyecto/capítulo; su diseño
no pasa a ser prosa del lector. Mapas, árboles, calendarios, tablas tipadas,
medios locales, Lector y wiki estática conservan sus editores y exportaciones.
Los mundos generados guardan su aspecto, pueden empezar en blanco, miden áreas
frente a contornos reales, planifican viajes con el ritmo y la física de viaje
del propio mundo (contados en palabras: pueblos por los que pasan, caminos, día y hora de cada tramo, posadas) y llevan rótulos editables (ángulo, espaciado, curva, nombres tirados en las
lenguas del mundo), 32
sellos, una rejilla de juego cuadrada o hexagonal, caminos trazados a mano con
su grosor y su línea (continua, discontinua o punteada), lugares que se pueden
duplicar o bloquear, una niebla del lector que
revela el mapa capítulo a capítulo, sucesos de la historia por capítulo que se
reproducen capítulo a capítulo o se recorren con una barra (con su orden dentro
del capítulo, quién estaba y lo siguiente previsto), un menú de clic derecho (pueblo, nota, suceso y
un manantial cuyo río baja solo, sin paso por el río / abrir de nuevo el paso), vados que cuestan tiempo al grupo (los puentes de los caminos no; un río helado en pleno invierno se cruza a pie), mundos de una sola isla, país o continente del tamaño que elijas (de 300 a 9.000 km), con el mapa y la maqueta 3D encuadrados en esa tierra, terrenos fantásticos, un pincel de meseta, curvas de nivel cada N metros, una herramienta de lagos que llena la
hondonada hasta que rebosa, nivel del mar y línea de nieve de todo el mundo, una vista 3D del mundo entero como maqueta (con el corte de roca y mar a la vista, sobre una mesa con su sombra) o como paisaje hasta el horizonte, una piel «Pintado» (terrenos que se funden, mar con bajíos y orillas, bosques y dunas pintados, nombres rotulados como en un mapa), con los mismos iconos de accidentes que el 2D, nubes y un bloque de roca, papel apilado o grabado con árboles de pie en la maqueta, una sola tierra en su propia hoja plana a su medida, zonas con nombre, volcanes y alturas en metros, ríos trazados por puntos o invertidos, el mapa a una hora del día con el farol del grupo, vías de viaje propias del mundo (un grifo, un trineo), el comercio por mar de cada puerto, una vista del lector con la tierra a tinta, pueblos como puntos y el rastro del grupo, sucesos enlazados a su capítulo, y una
lente de comercio mes a mes (explotaciones, escasez, precios, envíos); los mapas
de imagen tienen figuras con estilo (contorno, trama, rotulación, orden, varias
capas), marcadores de tres tamaños, marcadores que muestran la imagen de su ficha enmarcada en su color con el nombre debajo (y todos los nombres a la vista si se pide), un enlace al Códex con buscador que también
crea la ficha, un menú de clic derecho (ficha, marcador, región, ruta, rótulo o
comentario en ese punto), un cambio de imagen confirmado que conserva las
proporciones, una escala con herramienta de medir, longitudes, superficies,
tiempos de viaje y lugares reales a la misma escala, rutas como camino, senda o
río con su grosor y línea continua, discontinua o punteada (Intro termina el
trazo) y una leyenda pegada que nombra los marcadores con letra; las épocas de los mapas dibujados pueden seguir sucesos de la cronología
y reproducirse en orden. Cada capacidad tiene herramientas del puente
(docs/AI-BRIDGE.md, sección 28).
El perfil opcional 5e (2014), SRD 5.1 conserva valores manuales y contadores
jugados; no es un motor completo de reglas ni catálogo de conjuros.

**Aspecto y publicación de la wiki (tarea 1095, ola D2).** El editor de aspecto
de la wiki sin conexión trae un catálogo de 20 paletas con nombre (claras,
oscuras, de libro y de alto contraste, todas legibles), una lista «Guardar mi
paleta» que se renombra y se borra en el sitio y viaja con el perfil en copias
de seguridad y clones, enlaces en el pie (solo direcciones web o de correo) con
línea de firma, y extras de terminal para los diseños Terminal y Shell: colores
de fósforo, líneas CRT, imágenes con tramado, una línea de arranque y una lista
editable «¿Primera vez por aquí?». Los perfiles que no usan nada de esto exportan
los mismos bytes que antes. El panel de exportación muestra qué cambió desde la
última edición local («Publicar (3 cambios)» con documentos nuevos, cambiados y
quitados); la herramienta de solo lectura `wh_wiki_profile_changes` del puente
devuelve la misma lista.

**Mapas de la wiki (tarea 1095, ola D2).** Los mapas de la wiki exportada se
pueden mover y ampliar (arrastrar, pellizcar, Ctrl + rueda, teclado; libres o
contenidos en el marco, con botón de restablecer y marcadores que no cambian de
tamaño), pueden llevar capas de ilustración (fondo, media y primer plano) que se
desplazan con suavidad al mover el mapa (quietas si el lector prefiere menos
movimiento) y una capa de nubes que el lector puede ocultar, y pueden sonar con
ambiente para el mapa y para cada marcador, que empieza solo cuando el lector pulsa
el botón de sonido. Todo está apagado por defecto y un perfil que no lo pide exporta
los mismos bytes que antes. Las capas y el ambiente viven en el mapa, en el editor
de mapas («Capas de ilustración»), y viajan con las copias de seguridad y los
duplicados; las herramientas del puente `wh_map_artwork_get` y `wh_map_artwork`
(con comprobación de revisión y deshacer) los configuran. Ver
`docs/wiki-appearance.md`.

**Biblioteca de recursos (tarea 1095, ola D2).** La pestaña Recursos del proyecto
reúne ahora imágenes, sonidos, vídeos y modelos 3D: búsqueda por nombre o
etiqueta, seis órdenes, filtro por tipo, selección múltiple, descarga y cambio
de nombre. Antes de borrar se lee dónde se usa («Se usa en N sitios: …») y el
borrado pasa por la vía de cada herramienta, con Deshacer para imágenes y
sonidos. En la aplicación de escritorio, un sonido o vídeo de 8 MB o más ofrece
**Comprimir** (solo si lo pides, se puede cancelar, muestra el tamaño antes y
después y se guarda como copia o en lugar del original). El recorte tiene marcos
con nombre (avatar, fichas, banner, portada, fondo) con aviso de «demasiado
pequeña», y el visor de la galería hace zoom y desplazamiento (rueda, arrastre,
`+`/`-`, `0`, flechas). Herramientas del puente `wh_list_assets` y
`wh_asset_usage` (docs/AI-BRIDGE.md, «Biblioteca de recursos»); matriz: tasks/vvd1095/D2-platform.md.

**Comentarios: lectura y chinchetas (tarea 1095, ola D2).** Los hilos de
comentarios saben ahora si los has leído. Lo que escribes tú está leído; los hilos
y respuestas que llegan por el puente de IA están sin leer hasta que los abres
(basta tocar el hilo o pulsar su chincheta). La lista muestra «N sin leer», puede
ordenar «Sin leer primero», marcar un hilo como leído o no leído, o «Marcar todo
como leído» (con un solo Deshacer para todos), y la pestaña Interconexión de la barra lateral (donde viven los
comentarios) lleva una marca dorada de sin leer. El panel de comentarios del
proyecto también filtra «Solo sin leer» y «Solo este documento». En un tablero,
clic derecho en el lienzo vacío y «Comentar aquí» clava un comentario en ese
punto: la chincheta sigue el desplazamiento y el zoom, sobrevive a recargar, se
arrastra y al pulsarla se abre su hilo; los comentarios en un punto de un mapa
clásico abren su hilo igual. Puente: `wh_annotation_mark_read`,
`wh_annotation_mark_all_read`, `unreadOnly` en `wh_list_annotations` y `at` en
`wh_annotate` para tableros (docs/AI-BRIDGE.md, «Comentarios: leídos y
chinchetas»). Sin hacer: chinchetas en el mapa del mundo generado, flechas para
marcas fuera de pantalla e interruptor para ocultar marcas. Matriz:
tasks/vvd1095/D2-platform.md.

**Claves con nombre del puente de IA.** En Ajustes, Puente de IA, «Claves de acceso»
lista cada clave con su nombre, fecha de creación, último uso y estado. «Nueva clave»
da a un cliente la suya (el token se enseña una sola vez, con botones para copiarlo y
para copiar la configuración del cliente); las claves se pueden renombrar y revocar
(con confirmación y efecto inmediato). El token que ya usas sigue como clave principal
y sigue funcionando. La lista de actividad indica qué clave hizo cada cambio. Docs:
docs/AI-BRIDGE.md, «Varias claves del puente»; matriz: tasks/vvd1095/D2-platform.md.

**Pestañas del espacio de trabajo y Deshacer.** Las pestañas del panel de consulta
se pueden renombrar (el documento conserva su título), fijar, duplicar, cerrar en
bloque (las demás, o las de la derecha) y reabrir (`Ctrl/Cmd+Mayús+T`, las diez
últimas); `Ctrl/Cmd+1-9` salta a una pestaña y un resumen las lista. Vuelven al
reabrir el proyecto (se guardan por proyecto en el almacenamiento de esta
ventana, no en el proyecto). Al cerrar una pestaña con una ficha o un capítulo
recién creado y vacío se pregunta si conservarlo o borrarlo; borrar usa la vía de
borrado de la propia herramienta. Archivar y renombrar una carpeta de la
Biblioteca muestran un aviso con **Deshacer**, también desde la barra del espacio
de trabajo; se rechaza («No se pudo deshacer: cambió desde entonces») si el
documento o la Biblioteca han cambiado. Puente: `wh_workspace_tabs` (lectura).

**Revelar el lore a los jugadores (tarea 1095, hueco 4).** Una ficha del Códex se
puede marcar como «Revelada» («Revelar a los jugadores» / «Ocultar de nuevo» en
el diálogo de la ficha, en el editor y en el panel Consultar; con un momento
opcional como «Sesión 3»). Las fichas reveladas llevan una insignia, la lista se
filtra por «Solo reveladas / Sin revelar» y una «Vista de jugadores» enseña solo
las reveladas, sin bloques ocultos, texto de spoiler ni los campos excluidos del
proyecto (no se guarda nada). Los perfiles de wiki tienen la política «Publicar
solo lo revelado» (apagada por defecto; sin mapas mientras esté activa; las
ediciones ya publicadas no cambian). Puente: `wh_set_revealed` (varias fichas,
se deshace, y el deshacer se rechaza si una ficha cambió después), más
`revealed` en `wh_list_codex` y `wh_get_codex_entry`. Sin hacer: la marca es por
ficha (no por bloque), las entidades del motor de ficción tienen su propio
interruptor de secretos y no están enlazadas con esta marca, y la lista del
Códex aún no tiene un punto de «pendiente de publicar» por página.

**Preparar sesiones y el planificador (tarea 1095, hueco 7).** Tres plantillas nuevas
de esquema para llevar una mesa: «Preparar sesión: ocho pasos» (personajes, inicio
fuerte, escenas posibles, secretos y pistas, lugares, PNJ, monstruos, recompensas, cada
uno con una indicación breve), «Centro y ramales» y «Sesión en tres actos». Un esquema
se puede marcar como «Este esquema es una sesión de mesa», con fecha, estado (En
preparación / Siguiente / En juego / Jugada) y una nota de preparación vinculada. Una
pestaña nueva «Planificador» en Esquema lista las sesiones agrupadas En juego /
Siguiente / En preparación / Jugada, con cambio rápido de estado, abrir, abrir la nota
de preparación y una caja «Nueva sesión»; sus botones Combate / Mapa / Consulta colocan
en el panel de herramientas de la nota los primeros documentos de esos tipos del
proyecto (se puede deshacer). Los campos viajan con las copias de seguridad y las
copias de proyecto. Puente: `wh_session_planner` (lee), `wh_session_set_status`
(comprueba la revisión, se deshace) y campos de sesión en `wh_create_outline`. Sin
hacer: iconos o colores por sesión, notas por escena, elegir qué mapa o tablero entra
en una disposición, un PDF junto a las notas y un centro de campaña que una ficción,
mapas y diario.

**Niebla de exploración y marcador del grupo en mapas de imagen (tarea 1095, hueco
9).** Un mapa de imagen (no un mundo generado) tiene una franja «Niebla»: al
encenderla, todo el mapa queda oculto a los jugadores; se revela u oculta con un
pincel redondo, con «Revelar todo» / «Ocultar todo» o colocando el grupo y
arrastrando su marcador, que revela un círculo de su radio de visión y, con «Dejar
rastro», añade un paso al rastro con su sesión. La «Vista de jugadores» dibuja la
niebla opaca, oculta marcadores y figuras bajo ella y mantiene el rastro; el autor
ve la niebla semitransparente. El registro (máscara, grupo, rastro, revisión) es un
campo opcional del mapa que viaja con las copias JSON/ZIP, el clonado y las épocas.
Los perfiles de wiki tienen «Con niebla de exploración» (apagada por defecto; las
exportaciones sin ella no cambian ni un byte) y el SVG del mapa tiene su botón
«Exportar con niebla». Puente: `wh_map_reveal` y `wh_map_party` (revisión esperada,
se deshacen, comprobación de motor) y `exploration` en `wh_list_maps`. Sin hacer:
los inicios «en tinta» / «tierra en tinta», la visión en km, mirar atrás por sesión,
colocar «cerca de X», un marcador del grupo en los mundos generados, y el archivo
exportado sigue llevando la imagen entera (la niebla es una máscara visual, no un
secreto).

**Recorridos guiados (tarea 1095, ola D2).** El botón de brújula de la barra
superior (y un enlace «Ver los recorridos guiados» bajo la tarjeta Primeros
pasos, que se mantiene) abre una lista de nueve recorridos cortos sobre la
pantalla real: tu primer mundo, tu primer capítulo, tu primera ficha, tu primer
mapa, la cronología, el tablero, activar herramientas, publicar una edición de la
wiki y las copias de seguridad. Cada paso oscurece la pantalla salvo el elemento
del que habla y lo sigue si cambia el tamaño de la ventana; funcionan **Atrás**,
**Siguiente**/**Terminar**, **Saltar**, las flechas y Esc (las flechas se respetan
mientras escribes). Un paso cuyo elemento no está en pantalla, o que necesita un
mundo o una herramienta que no tienes, se salta con un aviso en vez de romperse.
La lista muestra cada recorrido como sin empezar, «Paso 2 de 4» (Continuar) o
Hecho (Repetir). El progreso es de toda la aplicación, vive en una sola fila de
ajustes y no forma parte de la copia de ningún mundo. Una instalación nueva sin
mundos recibe una oferta única que se puede descartar. Español e inglés; sin
herramienta del puente.

**Escritura, publicación, Códex, cronologías y tablas (tarea 1095, ola C).** El
menú «/» del editor ofrece 26 bloques (avisos, también «leer en voz alta» y
recuadro, desplegables, listas de tareas, mensajes enviados y recibidos, carta,
correo, salto de columna…), efectos de texto en pantalla (brillo, temblor,
ondulación, arcoíris, pulso, desenfoque; quietos con movimiento reducido y al
imprimir), imágenes a página completa y fichas de reglas: un recuadro de
hechizo, objeto mágico o criatura rellenado con las propiedades de una ficha del
Códex mediante una asignación de huecos que se puede actualizar. Los capítulos
admiten una etiqueta (Prólogo, Interludio), pueden quedarse fuera del libro y
moverse antes de cualquier otro; la imagen de cabecera va encima, al lado o como
banda. Publicar añade autoría, portadilla, página de derechos y contracubierta,
estilos de libro (clásico, moderno, épico y «manual de juego» a dos columnas con
tablas rayadas) con papel, formato y recuento de páginas, vista previa por
dispositivo y revisión por capítulo, en HTML/PDF, DOCX y ePub. El lector tiene
tamaño de letra, tipografía y claro/oscuro, y una biblioteca de 12 sonidos
hechos en el propio equipo; una señal de sonido puede durar hasta un párrafo
posterior. El diseñador de cubiertas escribe en vertical y borra parte de un
trazo; un proyecto nuevo puede diseñar su cubierta al crearse y una saga coloca
sus libros en una estantería del panel. Las fichas del Códex suman selector de
tipos, alias en chips, propiedades de lista y obligatorias, fichas congeladas,
caras, asistente guiado, tipos privados, plegar/copiar/extraer bloques a una
ficha y arrastrar fichas al manuscrito. Las cronologías suman duplicar y añadir
con un clic, precisión, modos de semana, mes bisiesto, re-fechado al cambiar el
calendario (con deshacer), colores y fases de lunas, calculadora y selector de
fechas, rejilla de calendario, repeticiones y bandas, etiquetas, vistas guardadas
y una correlación con el gregoriano que enseña los sucesos de los dos calendarios
en cualquiera de las rejillas. Los árboles de relaciones suman catálogos de
relaciones, grupos, variantes y selección múltiple; las tablas, buscar,
insertar y duplicar filas y columnas (las referencias de las fórmulas se
mueven y una quitada da #REF!), orden múltiple y filtros. Todo tiene
herramientas del puente (docs/AI-BRIDGE.md, sección 29); la matriz con pruebas
está en tasks/vvd1095/C-writing.md.

**Bloques de preparación y material para jugadores (tarea 1095, huecos 3 y 10 de B).**
El menú «/» de las notas y los capítulos ofrece ahora tres bloques de preparación.
«Prueba» guarda una habilidad, una dificultad, un modificador y una nota sobre lo
que revela la tirada; «Tirar» lanza el d20 con el motor de dados y deja la última
tirada en el bloque (y en la bandeja de dados). «Encuentro» lista criaturas con
cantidad y vínculo opcional al compendio SRD o a una ficha del Códex; «Preparar
combate» crea una pelea en el seguimiento de combate con esos combatientes y
«Abrir combate» va a ella. «Material para jugadores» señala una imagen de la
galería con un nombre y «cuándo se entrega»; su estudio dibuja una carta, un
expediente, una pantalla de terminal o un tablón de anuncios desde texto editable
(con tres ganchos de apertura), lo guarda en la galería y redibuja la misma
imagen si cambia el texto. Cada bloque se lee como texto corriente en Markdown,
Word, ePub, el lector y la wiki (las pruebas y los encuentros nacen ocultos en la
wiki), sobrevive a copias de seguridad y clonados, y el puente lo lee y lo escribe
(`> [!CHECK]`, `> [!ENCOUNTER]`, `> [!HANDOUT]` en `wh_create_writing`;
`wh_create_handout`, `wh_render_handout`). Sin hacer: contador de «marcar como
leído» en la caja de leer en voz alta, estado en curso/terminado en el encuentro,
plantilla de sueño, material en PDF. Prueba: `tests/prep-blocks-handouts.browser.tsx`;
pruebas y huecos en tasks/vvd1095/B-campaign.md.

**Reglas de la mesa (tarea 1095, hueco 6 de B).** Hojas tiene una pestaña «Reglas
de la mesa» (también desde los ajustes del proyecto): eliges el sistema (D&D 5e
2024 o 2014, Daggerheart, La llamada de Cthulhu 7ª, sistema libre), ves las reglas
de ese sistema con su valor habitual, cambias lo que vuestra mesa juega distinto
(puntos de vida fijos o tirados, descansos, daño crítico, flanqueo, poción,
carga, salvaciones de muerte, Miedo, Experiencias, oro y más) y guardas las
notas de la velada (cuándo, dónde, reglas de la casa, comida, vestimenta, tus
propias secciones) en el orden que quieras. Cada regla cambiada se marca y tiene
su propio «Restablecer»; un botón las restablece todas. Se guarda con el
proyecto (revisión con deshacer seguro, copia de seguridad JSON y ZIP, copias),
responde al puente (`wh_table_rules_get`, `wh_table_rules_set`) y por ahora solo
lo leen dos cosas: una nota en la vista previa de clase de 5e cuando los puntos de
vida se tiran y otra en la bandeja de dados cuando la mesa usa dados propios.

**Herramientas de mesa (tarea 1095, ola D1).** Las hojas de personaje suman un
compendio SRD 5.2 sin conexión (341 monstruos, 339 conjuros, 262 objetos
mágicos, 15 estados; búsqueda y filtros; «Añadir al mundo» crea una ficha del
Códex y un bloque de estadísticas; atribución CC BY 4.0), una pestaña de Combate
(iniciativa, turnos y rondas, daño con PG temporales, curación, estados que
caducan, concentración, salvaciones contra muerte), una bandeja de dados (4d6kh3,
ventaja, una dificultad que se supera o se falla, «¡20 natural!» y «1 natural»,
seis juegos de dados, fórmulas guardadas, historial) y los puntos de golpe de una
hoja 5e en partida (daño, curación, salvaciones contra muerte, estados), con la
frase de lanzamiento de conjuros de un bloque de estadísticas. Un generador de
nombres crea posadas, tiendas, personas, pueblos y casas nobles en 13 estilos,
con dueño, encanto, secreto, problema y lema, y los convierte en fichas
(«/nombre» en el editor; «/dados» tira). Las notas suman una lista de tareas
(estado, urgencia, día, enlaces) y tableros kanban, y una nota admite título y
portada. Las hojas calculan SI, SUMAR.SI, CONTAR.SI, BUSCARV y otras funciones,
abren y guardan libros de Excel con sus pestañas y agrupan hojas como pestañas
de un libro. El lienzo tiene menú de clic derecho, superficies blanca, rayada y
de tiza, una barra de recursos y comentarios sobre una tarjeta; el grafo del
mundo, ajustes de vista, fichas ocultas y grafos guardados; el ambiente del
proyecto, un mezclador de paisajes sonoros; el selector de iconos, categorías,
géneros y recientes. Herramientas del puente: docs/AI-BRIDGE.md, sección 30;
matriz: tasks/vvd1095/D1-tools.md.

**Temas del espacio.** Apariencia (Base o una era) trae ocho estilos
predefinidos (Pergamino, Medianoche, Bosque, Brasa, Océano, Pizarra, Rosa antigua,
Alto contraste) y un control del tono del acento. «Guardar como tema» da nombre a
lo que ves, con su imagen de fondo; los temas guardados se aplican a Base o a la
era actual (con el mismo guardado con revisión, así que un formulario obsoleto se
rechaza), se renombran, se eliminan tras confirmar y se exportan o importan como
.json (un archivo malo se rechaza con un mensaje claro y no cambia nada). Los
temas son del equipo: una sola fila de ajustes de la aplicación, que van en las
copias completas pero no en la exportación de un solo proyecto. Herramientas del
puente `wh_workspace_theme_list/save/apply/delete` (con deshacer):
docs/AI-BRIDGE.md, sección 31.

**Duplicar proyecto** crea una copia local, remapea referencias internas
declaradas y copia los archivos gestionados de Scrapper disponibles. Los
originales globales de biblioteca y publicación nativa siguen compartidos.
Un libro copiado sigue en su saga; copiar una saga no copia recursivamente sus
hijos. Una finalización nativa interrumpida reanuda la misma copia; Deshacer
requiere que siga sin editar. Es una operación distinta de los formatos JSON
antiguos de proyecto/completo, cuya cobertura sigue siendo parcial.

Consulta [flujos locales, recuperación y límites](docs/WORLD_AUTHORING.md) y el
[SDK de herramientas locales](docs/local-tool-sdk.md). Las herramientas de fuente
requieren código de confianza y compilación local; los archivos no incluyen
JavaScript compilado arbitrario. Los modelos locales de reconocimiento/búsqueda
necesitan preparación antes de usarse sin conexión. La generación de texto usa
el runtime global configurado. Las comprobaciones compuestas del código del 21 de octubre pasan: 210 grupos
en 44 suites con 0 fallos, 383 críticos, builds del renderizador/Electron, lint
de entrega sin deuda y conformance (34 motores, 64 tablas, 5650 claves y 22
archivos de idioma). La entrada de producción ocupa 1589.09 kB, por debajo del
límite bloqueante de 1600 kB; siguen los avisos de tamaño lazy/total. El audit
de dependencias de producción registra 0 vulnerabilidades. Pasan 14 pruebas del
servicio nativo de documentos, sin omitidas, el empaquetado en directorio, el
smoke empaquetado y las comprobaciones CPU de dependencias. D3, W01, el perfil
5e acotado, las correcciones M1/M2/M3 de mapas, Archive y herramientas antiguas
tienen dictámenes SHIP independientes dentro de sus contratos revisados.

No es un resultado global de `verify:release`. El audit completo de desarrollo
conserva 13 hallazgos heredados y sigue el aviso de empaquetado de
`resources/bin` opcional. QA, manual y documentación están completos; queda
pendiente la integración Git.
No se certifican instalación, perfil real del usuario ni paridad total.

[Verificación final y límites](tasks/worldcraft1041-final-verification.md);
prueba de revisión/lectura del manual: `tasks/evidence/worldcraft1041-manual-verification.json`.

## Empezar

```sh
npm install
npm run fiction:setup
npm run fetch:bin
npm run verify:quick
npm run dev:desktop
```

`npm run dev` abre solo la versión web. En Windows, `setup.bat` instala una vez y `run.bat` inicia la app sin reinstalar dependencias.

## Editor de documentos

El editor añade fuentes, tamaños, colores, resaltado, estilos de párrafo,
alineación, interlineado, sangrías, subíndice, superíndice, tablas editables y
saltos manuales. El formato se conserva al guardar, reabrir, sanitizar y
deshacer. El panel Documento abre archivos ricos, previsualiza páginas nativas
y descarga DOCX, PDF y otros formatos con el núcleo Rust propio de Writers.
En modo libro, aplicar una importación sustituye solo el cuerpo del capítulo
actual y conserva sus límites y los demás capítulos.

`native/` contiene código propio incorporado como fork separado: sin
dependencia Git del origen, submódulos ni actualizadores. La construcción usa
Rust 1.92 fijado; `npm run document:build`, el inicio desktop y el empaquetado
compilan ese código y distribuyen sus avisos. El archivo completo
`.writer.json` conserva assets y partes originales. La proyección a HTML no
conserva todas las propiedades de cualquier DOCX. Las exportaciones de proyecto
anteriores mantienen su alcance; Documento es la nueva vía de formato rico.
Consulta [editor, MCP y pruebas](docs/editor-native/README.md).

El panel Cambios conserva propuestas ancladas con autor, origen y fecha.
Registra ediciones ordinarias del párrafo y permite aceptar o rechazar dentro
del capítulo actual, con guardado, reapertura y deshacer. UI y MCP comparten las
operaciones. Documento previsualiza y descarga texto Final u Original sin
modificar las propuestas pendientes. Una descarga DOCX independiente conserva
los cambios compatibles con autor, fecha e identidad de propuesta; al importarlos
siguen siendo revisiones editables. Final/Original conserva el texto elegido.
Consulta [alcance y pruebas](docs/editor-revisions/README.md).

Editorial guarda estilos nombrados reutilizables, geometría de secciones,
cabeceras/pies literales, numeración de listas y citas ligadas a las fuentes del
proyecto. Los estilos son presets materializados, sin una cascada completa de
procesador de textos. El navegador obtiene los encabezados del manuscrito actual.
La revisión del español ofrece ortografía local, diccionario persistente por
proyecto y sugerencias gramaticales locales opcionales. La gramática usa
LanguageTool 6.6 incluido y requiere Java 17 o posterior en el equipo; la
ortografía funciona sin Java. Las sugerencias se revisan y se pueden deshacer.
La interfaz y MCP comparten estas operaciones. Consulta
la [comparativa y el corpus español medido](docs/editor-comparison/README.md).

Documento permite conservar el idioma y guionado del archivo abierto o elegir
español/inglés y activar/desactivar guionado automático en una copia de descarga.
Los patrones españoles admiten Unicode y patrones largos; los guiones añadidos
al final de línea se ven sin añadir caracteres al texto seleccionado del PDF.
Las URL, fechas y guiones escritos se conservan. La maquetación reserva el pie
antes de colocar cuerpo y notas. La consulta de cortes MCP informa de posiciones
en la palabra original y del proveedor disponible; imprimir conserva la sesión
y su historial.

## IA y asistentes externos

En **Ajustes de IA → Usar mis suscripciones**, inicia sesión mediante el cliente oficial de Claude o Codex, o importa una sesión ya existente. Comprueba la conexión y selecciónala como modelo de texto. También siguen disponibles las conexiones API y los modelos locales. Las solicitudes de suscripción verifican el método de autenticación y no derivan automáticamente a facturación API. Texto y copiloto están soportados; la generación de imágenes usa proveedores separados.

La sección **Puente de IA** muestra cómo conectar Claude Desktop, Codex o Gemini CLI con la app mediante configuraciones específicas por cliente. Mantén Writers Hoard abierto mientras esté conectado. Una conversación web corriente no adquiere acceso pegando un prompt o una dirección localhost. Consulta [suscripciones](docs/ai-subscriptions.md) y [asistentes externos](docs/ai-external-connection.md).

## Continuación sugerida (texto fantasma)

**Ajustes → Ayuda a la escritura → Continuación sugerida** (desactivada por defecto)
muestra una continuación tenue de una frase cuando haces una pausa al final de un
párrafo en el editor de capítulos o de libros. **Tab** la acepta, **Ctrl+→** acepta
una palabra y **Esc** o cualquier tecla la descarta. Es solo una pista visual: no
forma parte del documento, del historial de deshacer ni de ningún guardado hasta
que la aceptas, y aceptarla es un solo paso de deshacer. El botón de destello de
la barra de herramientas también la activa o desactiva. Usa solo un modelo local
(una conexión Ollama o compatible con OpenAI incrustada o en loopback) con el texto
anterior al cursor, las entradas del Codex que acabas de mencionar y el perfil de
estilo del proyecto. No se envía nada a un proveedor en la nube y no se sugiere
nada a mitad de palabra, con una selección o en modo de solo lectura.

## Genealogía e importaciones

Activa **Genealogía** en los motores del proyecto para ver padres, tutores y
parejas explícitos en un árbol familiar y exportarlo como DOT o texto.
**Importación al Codex** importa carpetas Markdown de Obsidian, Notion,
World Anvil o Campfire, con vista previa de fichas nuevas, duplicados, conflictos
e incidencias. También admite colecciones JSON tipadas. Conserva la fuente
completa, añade las fichas nuevas válidas en una transacción y permite deshacer
la importación durante la sesión respetando las ediciones posteriores.
Las herramientas de puente/MCP `wh_codex_import_*` ofrecen este mismo flujo;
`wh_genealogy_*` importan y aplican los enlaces familiares explícitos por separado.
La actualización de base de datos v38 conserva las referencias y los datos del
proyecto.

**Importar documentos mixtos** admite además texto pegado (una línea con solo
`---8<---` separa documentos), PDF con texto y una carpeta de destino de la
biblioteca, con guías de exportación, «Seleccionar todo de este tipo» y el motivo
de cada archivo omitido. **Importar manuscrito** en Escritos lee ePub (en el orden
del libro, avisando de las imágenes) y PDF con texto; un PDF escaneado se rechaza
con un mensaje de OCR. Argumentos de puente `pasted` y `libraryFolderId`; véase
[importación de carpetas](docs/world-folder-import.md).
[Contrato y límites](docs/GENEALOGY_CONTRACT.md).

## Exportar un mundo entero como Markdown

**Exportar como Markdown** (el icono de archivo en la tarjeta de cada proyecto
del panel y el botón bajo *Exportar* en la barra lateral del proyecto) escribe el
proyecto como una carpeta de archivos de texto legibles dentro de un ZIP: un
`.md` por ficha del Codex (`Codex/<tipo>/`), capítulo (`Writings/`), nota
(`Notes/`), cronología (`Timelines/`, como lista con fechas), mapa (`Maps/`),
esquema y página de diario, cada uno con cabecera YAML (tipo, título, alias,
etiquetas, campos, id, fecha de cambio) y el cuerpo en Markdown. Los enlaces que
el autor puso entre fichas, y la primera mención de cada ficha en un documento,
pasan a `[[Título]]`; los nombres ambiguos no se enlazan. Las tablas salen como
CSV, y hay un `index.md` y un `world.json` con el proyecto sin las imágenes
incrustadas. Una casilla añade imágenes y sonidos en `media/`; el diálogo
muestra el tamaño estimado con y sin ellos, la fase en la que va y un botón
Cancelar. Solo lee: no toca la copia de seguridad en ZIP. La herramienta de
puente/MCP `wh_world_markdown_export` devuelve el mismo ZIP en base64 (hasta
25 MB). Todavía no incluye variantes de era, tableros, Kanban, storyboards ni
hojas de personaje.

## Biblia del mundo exportable

**Herramientas del proyecto → Publicación** reúne las fichas del Codex, cronologías,
mapas y relaciones que selecciones en un documento de consulta con índice,
enlaces, imágenes guardadas y procedencia. Revisa la vista previa y guarda HTML
sin conexión o PDF mediante el exportador de escritorio. Las relaciones secretas
quedan fuera por defecto; los datos del proyecto no se modifican. El canon de
otros libros y los mundos generados sin guardar como mapa no se añaden automáticamente.

Las herramientas nativas de puente/MCP `wh_build_world_bible` y
`wh_export_world_bible` ofrecen la misma selección e informan del resultado,
cancelación y errores. [Contrato y pruebas](docs/WORLD-BIBLE.md).
## Investigación (proyectos de investigación)


El motor **Investigación** (`inquiry`, categoría investigación; activo por defecto
en el preset Periodista y sugerido en Biógrafo y Realista) convierte la
investigación que ya tiene un proyecto en afirmaciones y razona sobre ellas.

- **Las fuentes se gradúan y se pueden retractar.** Cada cita puede llevar una
  fiabilidad (A-F) y una credibilidad (1-6), que se muestran como `B2`, y un
  origen con el que se juzga la independencia. Las citas anteriores figuran como
  «sin graduar». Retractar una fuente nunca la borra ni borra sus extractos: las
  afirmaciones que se apoyaban en ella se recalculan y la app dice cuántas se
  vieron afectadas. Una fuente retractada sigue en la bibliografía, marcada con
  la fecha y el motivo, en todos los estilos de cita y formatos de publicación;
  la vista previa de publicación indica cuántas hay.
- **Las afirmaciones se apoyan en extractos registrados.** Una afirmación es un
  enunciado (con sujeto, predicado y objeto opcionales y fechas parciales) con al
  menos un apoyo que apunte a un extracto existente. Su estado no se guarda: se
  deriva cada vez como sin respaldo, afirmada, corroborada (dos o más orígenes
  independientes), confirmada o en disputa (decisión del autor) o retractada, y
  siempre se muestra junto a sus recuentos de extractos y fuentes independientes.
- **Tiempo.** Toda vista admite una fecha «a fecha de». Una afirmación cuyo
  periodo ha terminado está *terminada*; una que no se ha visto en más del plazo
  de caducidad (365 días por defecto) está *desactualizada*.
- **Pestañas:** Afirmaciones, Cronología (con contradicciones en predicados de
  un solo valor y tramos desconocidos), Grafo, Hipótesis (análisis de hipótesis
  en competencia, redactado como «la menos contradicha hasta ahora», nunca
  «demostrada»), Informe (Markdown con comprobación de citas; un resumen de
  modelo opcional debe superarla y se marca, no se oculta) y Entidades.
- **Privacidad.** Una persona del códice es privada salvo que el autor la marque
  como figura pública. El enriquecimiento nunca se ejecuta sobre una persona
  privada, las búsquedas en la biblioteca quitan sus nombres de la consulta y el
  informe las rotula «persona privada».
- **Consultas.** Organizaciones, lugares, sucesos y figuras públicas se pueden
  vincular con Wikidata desde el proceso principal (User-Agent identificado,
  peticiones en serie, tiempos de espera). Al aplicar solo se rellenan los campos
  vacíos, se guarda el identificador, se archiva una fuente C3 y se registra una
  ejecución que se puede deshacer. La app de escritorio también puede buscar en
  las demás apps locales del usuario a través del hub de Hoard (`library_search`,
  `search_links`); los resultados pasan a ser fuentes sin graduar y, si el hub no
  está en marcha, se avisa sin que sea un error grave.
- **Puente de IA.** `wh_grade_source`, `wh_retract_source`, `wh_list_claims`,
  `wh_add_claim`, `wh_update_claim`, `wh_inquiry_timeline`, `wh_add_hypothesis`,
  `wh_rate_hypothesis`, `wh_ach_matrix`, `wh_enrich_codex`,
  `wh_undo_enrichment`, `wh_inquiry_report`, `wh_search_library` y
  `wh_bibliography`, la bibliografía con grados y retractaciones marcadas (detalle en
  [`docs/AI-BRIDGE.md`](docs/AI-BRIDGE.md)).

`npm run test:inquiry` ejecuta sus pruebas específicas (lógica pura, migración,
enriquecimiento, interfaz y herramientas del puente).

- **Traspasos con la familia Hoard.** `wh_character_to_prospero`,
  `wh_storyboard_to_prospero`, `wh_world_to_scheherazade` y
  `wh_world_from_scheherazade` (app de escritorio, a través del hub local de
  Hoard). Un personaje del códice pasa a ser miembro del reparto de Prospero, un
  storyboard pasa a ser una producción de Prospero y el mundo de un proyecto va y
  viene de Scheherazade como un documento neutro `hoard.world/1` (esquema en
  `docs/WORLD_SCHEMA.md` de Scheherazade). Importar crea registros nuevos, nunca
  pisa lo editado aquí, conserva la `ref` y la `revision` de origen y se puede
  deshacer; lo borrado sigue borrado. Los botones «Enviar a Prospero», «Enviar a
  Scheherazade» y «Traer de Scheherazade» muestran avisos claros de éxito y de
  error (incluida la app que hay que arrancar). Detalle en
  [`docs/AI-BRIDGE.md`](docs/AI-BRIDGE.md), sección 26.

`npm run test:family` ejecuta sus pruebas específicas (intercambio e interfaz).

## Comandos principales

| Comando | Función |
| --- | --- |
| `npm run dev:desktop` | Inicia Vite y Electron con recarga en desarrollo. |
| `npm run build` | Comprueba tipos y construye la interfaz web. |
| `npm run build:desktop` | Construye interfaz y procesos de Electron. |
| `npm run verify:quick` | Tipos de renderer/Electron, lint de publicación y conformidad. |
| `npm run test:critical` | Pruebas aisladas de migración, copias, recuperación, navegación y arranque. |
| `npm run test:ghost` | Pruebas de la continuación sugerida: reglas, retardo y cancelación, selección del Codex, recorte, aceptar/descartar y desactivada por defecto. |
| `npm run test:family` | Pruebas de los traspasos a otras apps de Hoard: intercambio de mundos, importación, deshacer e interfaz. |
| `npm run test:inquiry` | Pruebas del motor Investigación: lógica pura, migración, enriquecimiento con Wikidata simulado, interfaz y herramientas del puente. |
| `npm run test:subscriptions` | Pruebas de aislamiento de suscripciones y protocolo sin llamar a proveedores. |
| `npm run dist` | Genera un instalador local; `dist:publish` exige firma y comprobaciones de release. |

El renderizador detecta Electron para usar `HashRouter` bajo `file://` y ofrecer el descargador multimedia. El build web mantiene su despliegue independiente. La arquitectura de la ventana, preload y servicio multimedia se explica en el [README inglés](README.md).

## Releases

La [guía de releases](docs/RELEASES.md) describe los instaladores para Windows/Linux, checksums y publicación. Las actualizaciones se muestran en la barra de título; descarga e instalación requieren una acción explícita del usuario. El repositorio público de distribución es independiente de este repositorio de código: solo instaladores, metadatos de actualización, checksums y documentación pública deben copiarse allí.


## Datos propios y compatibilidad

Los datos nativos pueden trasladarse a `data/native/<módulo>/data`, con configuración privada junto a cada módulo. La ficción de Writer utiliza su perfil de escritorio `writers-hoard/fiction/data`. Traslada árboles completos, incluidos WAL/SHM de SQLite, medios, modelos descargados y sesiones del navegador; actualiza las rutas absolutas guardadas antes de activar el módulo. Los manifiestos de `compatibility/<id>/faustus-plugin.json` conservan identidades, nombres de herramientas y tokens sin necesitar el repositorio retirado. Añade el directorio `compatibility` de cada producto a las raíces del Hub antes de la raíz general. El catálogo y los puentes compatibles nunca arrancan aplicaciones. Todos los módulos permanecen apagados durante el traslado.

Las instrucciones anteriores de adopción in-place describen una importación opcional. Una vez comprobados el traslado y las rutas, ya no es necesario conservar las carpetas de los productos antiguos.


Corrección931 CAS5 de cierre: ante un fallo se conservan app/recursos y worker; se rechazan ON y peticiones nuevas y se ofrece Reintentar cierre. Cada fábrica recuerda pasos completados; EOF reintenta limpieza sin repetir escrituras. Pruebas con las cuatro fábricas reales y el worker frozen reconstruido, sólo perfiles sintéticos. `node scripts/build-publishing-runtime.mjs --worker-only` reutiliza binarios nativos sin recompilar Rust. Evidencia y límites en tasks/submission931-cas5.md.
