---
name: "Writer's Hoard"
description: "Sistema vigente del escritorio Writer, sus herramientas de mundo y su extensión de ficción interactiva."
colors:
  deep: "#17191a"
  surface: "#202223"
  elevated: "#2a2d2e"
  border: "#3b3e3e"
  border-hover: "#626560"
  text-primary: "#eeeae2"
  text-muted: "#babcb6"
  text-dim: "#a1a49e"
  accent-gold: "#d5b575"
  accent-amber: "#e4a853"
  accent-plum-light: "#9b7ed8"
  success: "#4a9e6d"
  warning: "#d4a843"
  danger: "#c4463a"
  fiction-accent: "#c4973b"
  fiction-accent-strong: "#ddb055"
  fiction-text: "#e1eaec"
  fiction-surface: "#1e2121"
typography:
  headline:
    fontFamily: "'Cinzel', 'Iowan Old Style', Charter, Georgia, 'Liberation Serif', 'Noto Serif', 'Times New Roman', serif"
    fontSize: "20px"
    lineHeight: 1.4
  brand:
    fontFamily: "'Cinzel', 'Iowan Old Style', Charter, Georgia, 'Liberation Serif', 'Noto Serif', 'Times New Roman', serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: "20px"
  body:
    fontFamily: "'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', 'Liberation Sans', Arial, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  control:
    fontFamily: "'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', 'Liberation Sans', Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  detail:
    fontFamily: "'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', 'Liberation Sans', Arial, sans-serif"
    fontSize: "12px"
  manuscript:
    fontFamily: "'Iowan Old Style', Charter, 'Bitstream Charter', Georgia, 'Liberation Serif', 'Noto Serif', 'DejaVu Serif', 'Times New Roman', serif"
    fontSize: "1.0625rem"
    lineHeight: 1.7
  code:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'DejaVu Sans Mono', monospace"
rounded:
  field: "4px"
  control: "8px"
  panel: "10px"
  pill: "999px"
spacing:
  compact-gap: "8px"
  control-gap: "12px"
  panel: "16px"
  native-content: "20px"
  engine-inline: "24px"
components:
  fiction-switch:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  fiction-switch-on:
    backgroundColor: "color-mix(in oklab, #d5b575 10%, transparent)"
    textColor: "{colors.accent-gold}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  navigation-active:
    backgroundColor: "color-mix(in oklab, #d5b575 15%, transparent)"
    textColor: "{colors.accent-gold}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  native-button:
    backgroundColor: "{colors.fiction-surface}"
    textColor: "{colors.fiction-text}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
    height: "36px"
  native-button-primary:
    backgroundColor: "{colors.fiction-accent}"
    textColor: "#161818"
    rounded: "{rounded.control}"
    padding: "7px 14px"
  native-field:
    backgroundColor: "#171919"
    textColor: "{colors.fiction-text}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  native-card:
    backgroundColor: "{colors.fiction-surface}"
    textColor: "{colors.fiction-text}"
    rounded: "{rounded.panel}"
    padding: "16px"
  writer-button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "36px"
  writer-button-primary:
    backgroundColor: "{colors.accent-gold}"
    textColor: "{colors.deep}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "36px"
  canvas-control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
---
# Design System: Writer's Hoard

## Overview

**Creative North Star: "El escritorio Writer de la familia Hoard"**

Writer conserva su identidad de escritorio: carbón, oro, marca propia, títulos con la pila Cinzel y controles con la pila Source Sans 3. La ficción se abre dentro de ese marco de Electron y mantiene su interfaz de mundos completa en una superficie de estilos aislada. No se cambia la identidad ni se establece un producto móvil.

La extensión distingue claramente los controles que habilitan funciones del espacio de trabajo que aparece después. El estado apagado conserva cuatro interruptores, ubicación de datos y explicación; el estado activo añade navegación de mundo, transcripción y herramientas laterales. La lectura de manuscritos sigue teniendo tipografía y medida propias, separadas del título de la aplicación.

Las herramientas de mundo amplían ese escritorio mediante documentos reales, biblioteca mixta, paneles independientes y edición contextual del origen. El contenido espacial, la prosa y las salidas de lectura conservan sus materiales propios; el marco de autoría mantiene el carbón, el oro y los controles de Writer. Esta extensión se registra a partir del código construido, sin sustituir las reglas de ficción ni las superficies de publicación existentes.

**Key Characteristics:**

- Carbón y oro del marco existente, con icono Writer y SVG canónico de Faustus.
- Interruptores explícitos con estado escrito y acceso directo a la carpeta de ficción.
- Espacio de trabajo denso con navegación, transcripción y contexto simultáneos.
- Tipografía de lectura configurable en el manuscrito, distinta del título de la aplicación.
- Documentos conectados mediante biblioteca, paneles con estado propio y edición contextual del origen.

## Colors

### Primary

El oro `accent-gold` identifica marca, selección de navegación, foco y controles activos del marco. La ficción nativa conserva su oro más cálido `fiction-accent` y su respuesta `fiction-accent-strong`, dentro del Shadow DOM. Son dos ámbitos ya construidos del mismo producto; el panel superior no toma sus colores de otra aplicación.

### Secondary

`accent-plum-light` distingue enlaces del manuscrito y del texto asistido; `accent-amber` destaca coincidencias o acciones en sus contextos existentes. No son acentos nuevos de la ficción. Success, warning y danger pertenecen a estados semánticos y se acompañan de texto. La marca canónica coral de Faustus mantiene su propia identidad y no define la paleta del producto.

### Neutral

`deep`, `surface` y `elevated` componen el marco, lateral y controles. `border` y `border-hover` separan y responden a interacción. Los tres tonos de texto ordenan contenido, ayuda y metadatos. La ficción conserva los tonos neutros de la variante familiar dentro de sus estilos aislados; la cabecera contiene los tokens usados para las muestras de esa variante. Su opción clara conservada pertenece al ámbito interno y no recolorea el marco oscuro de Electron.

**The Writer Identity Rule.** La ficción hereda el icono, el marco y el oro de Writer; sus herramientas no introducen una nueva identidad de producto.

Los tipos y subtipos de Códex, los colores de nodos y conexiones, las capas de mapas y las anotaciones de árbol son codificación de contenido. Los selectores de color de cubierta y capítulo pertenecen a la presentación elegida por el autor. Sus valores no amplían la paleta normativa del marco; el papel blanco, noche y sepia del lector no son nuevos temas de navegación.

**The Content Palette Rule.** El color configurable de un documento permanece en ese documento; la herramienta que lo edita conserva los colores y el foco de Writer.

## Typography

**Display Font:** pila Cinzel con respaldos serif elegidos.
**Body Font:** pila Source Sans 3 con respaldos sans elegidos.
**Code Font:** pila JetBrains Mono y respaldos monoespaciados.

Estas son las pilas declaradas en `src/index.css`; ese archivo no declara `@font-face`. La disponibilidad local determina el rostro que finalmente dibuja Electron. No se afirma que la fusión empaquete o descargue los archivos de esas fuentes.

El título de ficción usa 20px/28px y la marca exterior 14px/20px con peso 700. La interfaz emplea 14px; los botones nativos, 13px/500; las ayudas y estados compactos, 12px. Los nombres de página nativos usan 15px/600. La transcripción nativa conserva sus estilos de roles, con acción a 14px, diálogo en cursiva y turnos deshechos tachados; esos estilos describen la herramienta incorporada y no sustituyen la política de lectura del manuscrito.

El manuscrito usa por defecto una pila serif de lectura, tamaño medio 1.0625rem y medida máxima de 46rem, con interlínea 1.7. Sus opciones conservadas son 0.9375rem y 1.25rem, medida estrecha de 34rem y familias serif/sans/mono. Los encabezados de capítulo heredan esa familia y el contenido puede aparecer sobre hojas claras, con su geometría propia; esas hojas son un modo de documento existente, no el tema de la ficción.

**The Prose and Chrome Rule.** Los títulos de la aplicación y la prosa del manuscrito pertenecen a roles distintos; los encabezados de capítulo heredan la familia de lectura del manuscrito.

## Layout

Electron conserva una franja de título de 36px y lateral exterior de 220px, contraíble a 60px u ocultable a cero con semántica inert. La navegación desplaza su propio contenido. La cabecera de ficción tiene relleno horizontal de 24px y vertical de 20px; los cuatro interruptores se distribuyen con flex-wrap y separación de 12px. La explicación apagada queda centrada en el espacio restante.

Activar Mundos y juego monta el espacio nativo: lateral interior de 220px, cabecera de 64px y contenido con relleno de 20px. Play distribuye transcripción flexible y panel de contexto de 280px, separados 16px. La transcripción y los paneles largos desplazan su propio contenido; el compositor conserva modos, campo y botones. Los bloques de contexto son tarjetas funcionales para escena, dados y continuidad.

El código conserva reglas para ventanas estrechas: el lateral exterior se contrae bajo 800px; Play pasa a columna bajo 900px y la navegación interna pasa a cajón bajo 760px. Son ajustes del escritorio, no una promesa ni una verificación de producto móvil. Las capturas de esta extensión corresponden a Electron de escritorio.

El espacio de proyecto conserva una barra de herramientas adaptable, un panel principal y hasta cuatro pestañas compañeras con historial y estado de editor propios. En ventanas grandes los dos paneles se sitúan en columnas con una proporción ajustable del 35–65%; por debajo del punto `xl` (1280px) pasan a filas de al menos 30rem, con desplazamiento propio. Las acciones de duplicar, volver al principal y cerrar siguen visibles. La biblioteca mixta separa carpetas y documentos en una columna de 15rem más contenido flexible desde `lg` (1024px); debajo se apila. Sus filas se adaptan y conservan título, tipo, carpeta y acciones de apertura.

Los inspectores de grafos y árboles pasan bajo el lienzo cuando no cabe su columna lateral. El lienzo conserva pan, zoom y encuadre; tablas y contenido espacial mantienen desplazamiento en lugar de comprimir sus coordenadas. El grafo de mundo usa tarjetas controladas de 220px de ancho y 74px de altura mínima, con evidencia y enlaces al origen en un inspector separado. El árbol usa su propia geometría editable. Estas dimensiones pertenecen a esos componentes y no son una cuadrícula universal.

La presentación del lector usa una vista de cubierta junto a sus ajustes desde `lg`, y se apila en ventanas estrechas. La salida HTML autónoma dedica el espacio al libro, índice y capítulos, con medida máxima de 900px y navegación de lectura. El modo de páginas horizontales conserva sus controles de avance. Son salidas de documento, no una transformación del escritorio de autoría.

## Elevation & Depth

La estructura principal se separa con color y bordes. Las tarjetas nativas mantienen la sombra difusa familiar `0 8px 28px rgba(0, 0, 0, 0.38)`; no hay sombra de offset duro en la ficción. El marco conserva foco dorado de 2px con separación de 3px; el ámbito nativo usa su foco familiar de 2px separado 2px, y los campos añaden borde de acento y contorno suave.

La anchura del lateral exterior transiciona en 200ms. El producto conserva las preferencias de movimiento del sistema y el ajuste explícito de movimiento reducido; no se añade animación decorativa a los interruptores de ficción. Las sombras del modo página y de diálogos mantienen ámbito propio y no se convierten en relieve obligatorio del panel de funciones.

La cubierta del lector tiene profundidad y giro como vista del libro configurado por el autor. Esa geometría se limita al contenido de lectura y a su estudio de presentación; no establece una tarjeta tridimensional para herramientas o navegación.

## Shapes

El marco usa esquinas de 8px en navegación e interruptores, de 4px en el campo de carpeta y bordes de 1px. La ficción nativa usa 8px en botones/campos, 10px en tarjetas y forma de píldora en modos y etiquetas. El icono Writer conserva su imagen existente de 32px con esquinas de 8px. Lucide aporta iconos SVG de línea de 18px en navegación exterior; el encabezado de ficción usa dados de 22px.

## Components

### Function switches

Son botones con `role=switch`, nombre accesible y `aria-checked`, no una pista deslizante. Tienen icono de encendido, nombre y texto On/Off o Activado/Desactivado; apagados muestran borde y texto neutro, encendidos borde/acento dorado y fondo al 10%. La espera los deshabilita con opacidad reducida. Los cuatro permanecen visibles en la primera apertura.

### Buttons

La ficción nativa conserva botones secundarios con superficie tonal, borde, relleno 7px/14px y altura mínima de 36px. Los primarios usan el oro cálido y tinta oscura; hover usa oro claro. El estado deshabilitado reduce opacidad a la mitad y usa cursor de prohibición. Narrar se deshabilita cuando la narración global está apagada y muestra ayuda visible asociada; Enviar sigue disponible para escritura manual si el campo tiene contenido. El manejador verifica el estado actual antes de crear un borrador.

En las herramientas de mundo, los secundarios comparten borde fino, texto claro, esquinas de 8px, relleno 8px/12px y altura mínima de 36px. El hover usa `elevated`; el foco visible usa oro. La acción de guardar en Presentación del lector usa tinta `deep` sobre `accent-gold` y pasa a `accent-amber` al hover, conservando la tinta. Las clases estructurales se comparten sin mezclar los colores de primario y secundario. El estado ocupado deshabilita las acciones y reduce su opacidad.

**The Primary Ink Rule.** La etiqueta de una acción primaria dorada mantiene tinta oscura en reposo y hover; no hereda el texto claro del botón secundario.

### Inputs / Fields

La carpeta se despliega con `details`; etiqueta accesible, campo flexible y botón de confirmación comparten una línea adaptable. Campo y botón se deshabilitan mientras Mundos y juego está activo o hay una operación pendiente. El espacio nativo conserva campos con relleno 8px/10px, borde tonal, superficie oscura y foco de acento. El compositor usa textarea flexible de altura mínima 44px; el borrador propuesto se presenta con acciones explícitas de aceptación o rechazo.

### World calendar dates

El campo de fecha del mundo conserva la entrada libre, Limpiar junto al texto y el botón de calendario. El panel se expande debajo, dentro del formulario existente. La cuadrícula mantiene selección dorada, meses y elección de todo el mes; anterior/siguiente y año absoluto permiten recorrerla sin sustituir el texto escrito. Hoy aparece cuando el calendario dispone de una correlación terrestre completa y aplica su conversión al día local.

Introducir fecha exacta abre un borrador separado con etiquetas visibles de año absoluto, mes y día opcional. Aplicar fecha confirma un borrador válido; Cancelar lo descarta sin cambiar el texto del autor. Los errores locales se presentan como estado textual. Las acciones conservan una altura mínima de 36px, bordes finos, esquinas redondeadas y foco dorado; los campos exactos se apilan y las filas de acciones se ajustan cuando falta anchura. Este comportamiento pertenece al componente y no establece una composición móvil ni una escala tipográfica nueva.

### Navigation

El lateral exterior usa entradas de 14px, iconos de 18px, relleno 10px/12px y esquinas de 8px. La activa combina oro y fondo dorado al 15%. El lateral interno mantiene entradas de 40px de altura y su estado seleccionado tonal, con icono de acento. Las secciones pertenecen al mundo abierto; las globales conservan mundos, backends, actividad y ajustes. La marca de Faustus se abre desde su botón canónico explícito.

### Cards and chips

Escena, dados y continuidad conservan tarjetas de 16px de relleno, borde fino, esquinas de 10px y sombra difusa. Chips y pestañas de modo usan contornos redondos completos, con estado seleccionado escrito y acento. Las tarjetas son herramientas de contexto, no contenedores decorativos para cada párrafo.

### Contextual documents and dialogs

Los bloques de herramienta y las referencias de Códex muestran contenido y acceso al documento de origen; el origen se edita con su herramienta real en un diálogo de contexto. El selector de inserción se despliega bajo su botón y ofrece búsqueda y tipo, sin mantener todo el catálogo abierto. El diálogo de herramienta usa un cuerpo desplazable con borde y fondo profundo; la ayuda, la acción de guardar/cerrar y los avisos de bloqueo permanecen explícitos. La navegación interna respeta el ámbito del documento y no sustituye la ruta o selección del editor anfitrión.

Los diálogos comunes conservan título serif dorado, superficie tonal, borde y esquinas de 12px. El modal grande usa anchura `min(96vw, 100rem)` y altura máxima de 94vh; los diálogos normal y ancho conservan sus medidas existentes. El foco queda atrapado, el fondo es inerte y al cerrar se restaura el foco previo. Los cambios pendientes o fallos de guardado se comunican en el diálogo y requieren una salida explícita; no se disimulan con un cierre exitoso. Los formularios sin enviar conservan su acción propia antes de cerrar.

### Individual Códex export

Exportar se añade a las acciones de la ficha en vista de autor, junto a crear plantilla, editar y eliminar. El diálogo compacto conserva título serif dorado, texto sans, superficie carbón, borde fino e iconos Lucide; no crea otra identidad ni una escala de tokens. El título, las filas de formatos y el pie con actualización y cierre envuelven cuando falta anchura, tanto en inglés como en español.

La descripción presenta una copia de la ficha de autor guardada, incluido su contenido privado, y excluye cambios sin guardar, anotaciones y galería vinculada. El ámbito muestra la era o base compartida y distingue la ficha guardada de la copia ya preparada. La copia preparada es de solo lectura y se reutiliza entre formatos hasta Actualizar copia guardada; esta acción permanece deshabilitada antes de preparar. No es una edición de la ficha ni una publicación para jugadores.

Markdown descarga el documento; Incluir adjuntos locales lo convierte en un ZIP. La segunda acción ofrece PDF con el servicio de escritorio disponible o Abrir vista imprimible en el navegador. PNG permanece visible y deshabilitado cuando falta el servicio de escritorio, con una explicación que remite a la vista imprimible para imprimir o guardar PDF. Preparación, cancelación, resultado y fallo usan texto; los errores se anuncian como alerta y los demás estados como estado. Durante la operación se deshabilitan formatos y actualización; Cerrar sigue disponible. El mensaje de descarga preparada no se presenta como prueba de un archivo ya guardado.

La salida de lectura reutiliza el papel claro, tinta oscura, prosa serif y rótulos sans del compositor de documentos. Cabecera, propiedades en filas, referencias y cuerpo con sus encabezados sustituyen al marco de autoría. En esta rama de ficha capturada, los rótulos de propiedades y referencias sin definición explícita usan los diccionarios EN/ES disponibles o un nombre con palabras separadas; los labels explícitos permanecen intactos. Los alias muestran nombres separados por un punto medio, sin sintaxis JSON. La presentación humana no cambia las claves canónicas del documento ni traduce el texto escrito por el autor; no establece traducción integral de todos los metadatos de salida.

### Localized notebook and insertion feedback

La libreta localizada reutiliza el editor de prosa rico compartido tanto en el documento de fuente como en el bloque propio del documento anfitrión. El título, la ayuda breve, la etiqueta de notas y el editor conservan esa jerarquía; la fecha de último guardado aparece cuando está disponible. Las etiquetas siguen el idioma global elegido en Ajustes, sin un selector duplicado dentro de la libreta. Cambiar ese idioma no traduce las notas ni los títulos escritos por el autor.

El guardado y el descarte siguen siendo acciones explícitas del editor. En un bloque propio, guardar la edición hija no sustituye Guardar cambios del documento padre. La superficie mantiene el ancho flexible sin imponer un mínimo que desborde; los controles y acciones pasan a varias filas cuando falta espacio. La diferencia tipográfica entre Source y Owned conserva el contexto de cada anfitrión y no introduce otra familia ni escala global.

Si el comando de inserción no añade el bloque, un estado textual neutro junto a las opciones explica que no se ha insertado e indica guardar el documento y situar el cursor en su texto antes de repetir. El mensaje usa `role=status`, se limpia al reabrir el selector o insertar correctamente y no crea ni guarda el documento por su cuenta.

### Optional local-tool tutorials

La Ayuda/Help del anfitrión aparece antes del contenido de las herramientas locales que declaran recorridos, en su editor Source o heredado. Conserva el botón secundario de Writer y ofrece un selector cuando hay más de un recorrido. Es una entrada explícita; las herramientas que no declaran recorridos conservan su interfaz. Esta extensión no añade ayuda en bloques propios, vistas de lectura, exportación o pantalla completa.

El recorrido reutiliza el spotlight y el popover compartidos: oscurecimiento alrededor de un objetivo accionable, contorno dorado, superficie carbón, borde fino y sombra. El título serif dorado, cuerpo sans, contador de posición y acciones mantienen sus roles existentes. El popover limita su ancho al espacio de la ventana; el español puede aumentar su altura sin truncar texto ni expulsar las acciones. Las vistas estrechas muestran ese reflujo del anfitrión, sin establecer una composición móvil.

Los pasos manuales ofrecen Siguiente o Terminar. Los pasos que esperan una acción confirmada o la aparición de un elemento omiten ese avance; Atrás y Saltar permanecen. El ejemplo del contador señala Incrementar como acción normal de guardado. Al terminar, el aviso de una herramienta remite a su Ayuda/Help para repetir; el aviso de los recorridos globales conserva su destino propio. Cambiar el idioma adapta la ayuda, sin traducir el contenido del autor. Esta ampliación conserva los colores y la tipografía del overlay y no crea tokens nuevos.

### Optional local-tool context menus

El editor Source o heredado editable puede presentar un menú opcional junto al resultado o desde Acciones. Conserva acciones planas, etiquetas, separadores y botones normales; la extensión1505 añade ramas anidadas sin esconder esas rutas. Raíz e hijos comparten superficie carbón, borde fino, esquinas redondeadas, sombra difusa, texto de interfaz de 14px, filas de al menos 36px y foco dorado. Las ramas muestran un cheurón Lucide hacia la derecha y cada hijo incluye Atrás/Back con cheurón hacia la izquierda; son indicadores y retorno del host, no iconos arbitrarios del autor. Se mantienen la tipografía y la paleta existentes.

Cada nivel es un panel fijo y no modal en el portal del documento anfitrión, sin fondo de bloqueo ni trampa de foco. Su anchura de 15rem se limita al viewport, conserva un margen mínimo de 8px y permite texto envuelto y desplazamiento vertical. El hijo se ancla a su fila y sale al lado disponible; en una ventana de 390px puede solaparse con el padre, conservando Atrás visible para volver con pointer. No se exige que dos paneles completos quepan contiguos. El árbol entero constituye una presentación del servicio por documento: foco y pointer entre sus paneles permanecen dentro; otra solicitud sustituye la anterior. Resize, scroll exterior, foco exterior o invalidación del anfitrión retiran la presentación; desplazar un panel puede retirar sus descendientes. Son reglas locales del popup, no una composición global del escritorio ni soporte móvil.

El foco entra en la primera entrada habilitada del nivel, con retorno o contenedor disponibles si no hay una acción habilitada. Flechas verticales e Inicio/Fin recorren el panel actual, omitiendo etiquetas, separadores y entradas deshabilitadas. Clic, Intro/Espacio o Derecha abren una rama explícitamente sin ejecutar una hoja; no hay apertura por hover temporizado. Izquierda, Escape o Atrás en un hijo retiran ese nivel y devuelven foco a su rama. Escape en raíz cierra todo y devuelve foco al disparador conectado. Tab cierra todo sin consumir la continuación real del navegador; un clic exterior conserva el foco de su destino. Seleccionar una hoja retira todo el DOM del menú y restaura el foco antes del callback, sin prometer conservarlo tras cualquier actualización posterior de la herramienta. Las aperturas y sus hojas son efímeras y revocables: un nodo retenido no adopta otra apertura de la misma rama.

La fila deshabilitada conserva su opacidad reducida; sólo la hoja destructiva habilitada mezcla localmente `danger` al 60% con `text-primary`, manteniendo legibilidad sobre `surface` y `elevated`. Es el tratamiento F1 heredado de1501, no una nueva regla global de danger. Las ramas no tienen acción ni variante destructiva; la acción pertenece a la hoja. Las ramas exponen nombre, estado expandido y relación con su panel hijo; Atrás es un control interno localizado, ajeno a las entradas del autor.

Contador contextual conserva título, ayuda, cifra tabular, Incrementar dorado, Restablecer secundario y Acciones, con Deshacer/Rehacer en su fila propia. La raíz mantiene Cuenta, Incrementar, separador y Restablecer; añade Más acciones/More actions con otra hoja Incrementar y Cuenta/Count → Restablecer. Esa repetición aditiva muestra el SDK sin esconder las acciones previas. Restablecer se deshabilita a cero; carga o espera deshabilitan las acciones pertinentes y un fallo muestra una alerta textual localizada. Botones y hojas comparten las acciones normales y sus recibos. Deshacer/Rehacer corresponde al montaje actual; reabrir conserva la cuenta guardada, sin presentar el historial o el menú como persistentes ni prometer atajos de deshacer.

Al abrir, el host valida y copia el árbol completo antes de consumir el evento o sustituir el menú: conserva sólo copias propias congeladas, con IDs únicos y ramas finitas con hojas, sin congelar el input del autor. Solicitudes, callbacks y leases de apertura quedan en memoria, fuera del estado guardado, las vistas de lectura y los descriptores. El grabador conserva metadata recursiva sin funciones/eventos/DOM; no presenta ni selecciona por MCP.

Source compone ayuda del tutorial → anfitrión del menú → componente. Cada panel hijo conserva la marca SDK, ámbito de panel y capa sobre el overlay del recorrido. Sus teclas pertenecen al nivel enfocado: Escape vuelve de hijo a padre, Escape en raíz vuelve al disparador y el siguiente sigue el recorrido. Se conservan Ayuda, progreso y controles sin cambiar TourHost. Sin un anfitrión admitido, el helper no consume el evento; bloques propios, lectura/exportación y pantalla completa quedan fuera de esta presentación. La evidencia histórica plana1501 y la evidencia aditiva1505 se separan en la superficie `vvd-worldbuilding.md`; este registro no establece paridad universal del SDK.

### Map lighting selection

El selector de iluminación permanece en la fila de vista y proyección del mapa, con etiqueta localizada, superficie elevada, borde fino y sans compacta. De día conserva tinta neutra; una hora elegida o el modo de viaje usan borde y texto dorados. El lavado nocturno pertenece a la cartografía y no cambia los colores del escritorio. La fila envuelve y el contenido espacial conserva su desplazamiento cuando falta anchura.

La elección se guarda como parte de la presentación del mundo en su ámbito existente y se recupera al abrirlo. De día, las horas con nombre y la hora del viaje siguen siendo opciones del mismo selector; el viaje guarda el modo, sin convertir cada fotograma en una elección persistida. Durante la escritura el selector se deshabilita, reduce su opacidad y muestra cursor de espera; el mapa y sus demás herramientas conservan su uso. El conflicto muestra un aviso EN/ES que explica que cambiaron los ajustes del mapa, conserva los cambios guardados y pide elegir de nuevo la luz. El fallo de guardado reutiliza el aviso y Reintentar existentes. Son estados del control construido; las capturas asentadas no prueban el acabado de esos transitorios ni crean un panel, reloj compartido o escala de tokens nuevos.

### Spatial tools and canvas controls

Árboles y Board usan los controles nativos de ReactFlow dentro de un ámbito común: superficie `surface`, texto `text-primary`, borde `border`; al hover cambian a `elevated` y oro. El foco es un contorno dorado de 2px hacia el interior, para seguir visible en la pila de botones. La biblioteca conserva sus operaciones de zoom y encuadre. El grafo de mundo tiene su tratamiento oscuro equivalente. Tipos de conexión, leyendas, títulos y evidencia acompañan el color; la selección de nodos usa borde/anillo dorado.

**The Canvas Chrome Rule.** Los controles de un lienzo heredan las superficies, tinta y foco del escritorio aunque su biblioteca aporte un tema claro por defecto.

Los mapas con capas e historial, hojas físicas de Worldgen, calendarios de cronología, diccionarios y fuentes, tablas, hojas RPG, radar, GLB y medios conservan la forma del contenido y sus herramientas contextuales. No se deriva de una visualización especializada un patrón obligatorio para las demás herramientas.

El selector gráfico de lugares es una opción acotada del inspector carbón/oro: controles de 36px, seis columnas y portal anclado al viewport con cierre/foco explícitos. Las miniaturas y la selección reutilizan la geometría numérica del contenido, no otro proveedor de iconos. El neutro cálido `#b3a48e` es intencional para esas celdas secundarias; no sustituye los tokens globales. El resto de consumidores de IconPicker mantiene sus defaults y no se amplía aquí la tipografía ni se refactorizan los 21 avisos heredados de fuentes.

### Board media references and assets

La referencia de audio o vídeo del Board conserva la tarjeta elevada, el borde fino y el relleno compacto de las referencias existentes. La encabeza el título serif; debajo aparecen los controles nativos del reproductor local compartido. La carga y la falta de disponibilidad se expresan con texto, y un fallo de reproducción añade su estado junto al control. Este componente no incorpora un rótulo de tipo por encima del título.

Recursos mantiene su panel flotante carbón, búsqueda y cierre explícito. Cada audio o vídeo local disponible reúne título y acción Añadir con icono SVG; admite también arrastre al lienzo. El audio conserva la acción Escuchar/Parar independiente de Añadir. Importar abre la biblioteca del proyecto y era efectivos. Los botones reutilizan borde, altura mínima de 36px, hover tonal y foco dorado del escritorio. El panel sigue superponiéndose al lienzo en una ventana estrecha; no se convierte en una composición móvil nueva.

Los gestos y teclas del reproductor quedan dentro de sus controles para conservar el trabajo espacial del lienzo. La reproducción comienza por una acción explícita; el player de la tarjeta se monta sólo mientras su referencia está visible en el panel y el lienzo. Al desmontarse pausa y libera su recurso local. Este comportamiento pertenece a estas referencias y no redefine las demás tarjetas ni los reproductores de otras herramientas.

### Board Files input

Archivos/Files añade selección local múltiple junto a Importar en biblioteca, dentro de Recursos. Abre el selector nativo para imágenes, audio y vídeo; Imagen conserva su entrada sólo para imágenes. El botón reutiliza los secundarios del panel: borde fino, altura mínima de 36px, hover tonal y foco dorado. Cabecera y acciones envuelven en ES/EN cuando falta anchura, conservando búsqueda y lista debajo.

Elegir o soltar audio/vídeo crea un recurso en la biblioteca y su referencia normal en el lienzo; la tarjeta mantiene título serif y reproductor nativo compartido, sin autoplay. Los errores parciales se comunican con texto; si el medio quedó guardado sin nodo, el aviso indica añadirlo desde Recursos en una capa visible y desbloqueada. Esta entrada no añade un diálogo de producto, estilo de reproductor ni patrón para la superposición heredada del panel en ventanas estrechas.

### Assets library media preview

La Biblioteca de recursos añade la apertura de audio y vídeo en una región inline sobre la lista, separada por bordes finos y con la superficie carbón heredada. El nombre completo y los controles conservan la sans de interfaz de 14px; el nombre tiene mayor peso y envuelve sin elipsis cuando falta anchura. Cerrar permanece a su lado con altura mínima de 36px, borde, hover tonal y foco dorado. El reproductor HTML nativo compartido mantiene sus controles, sin autoplay; carga, archivo no disponible y error usan estados textuales localizados, y un formato no reproducible remite a descargar una copia. Búsqueda, orden, filtros, selección y operaciones siguen presentes; las imágenes conservan su lightbox. El reflujo estrecho pertenece a este componente y no crea una composición móvil, otra identidad, un estilo global de reproductor ni tokens nuevos.

### Linked-document beside action

El selector de referencias conserva Documento vinculado, ayuda, selects nativos, Vincular, Abrir y Quitar vínculo; añade Ver al lado/Open beside junto al destino. La acción hermana reutiliza superficie carbón, sans de interfaz, borde fino, esquinas redondeadas, altura de 40px, hover tonal y foco dorado. Las filas envuelven cuando falta anchura; Guardar notas conserva su protagonismo. El título de la referencia sigue siendo contenido efectivo y no una identidad nueva.

El destino usa el panel lateral del workspace. Códex abre su Modal global normal, con título y cierre; tras cerrarlo se continúa con Source y Códex. No se convierte ese Modal en un detalle confinado al companion. Los estados disabled/no disponible y el error de consulta existentes cubren ambas aperturas. Los cuatro fixtures ES/EN1280/390 acreditan reflujo local; el foco visible de 2px dorado se atribuye por separado a Brave1920. No se crean tokens, tipografía, raster, overlay o composición móvil nuevos.

### Reader, wiki and parallel text

El estudio del lector separa cubierta, ajustes de capítulo y audio. Fondo, familia de lectura, imagen y modo de páginas son opciones del documento. La cubierta puede usar la imagen local del proyecto, y el audio conserva controles explícitos. La exportación de lector o wiki autónomo ofrece navegación y referencias para leer fuera del editor; no arrastra la barra de autoría. Las marcas de contenido oculto y spoiler del editor usan subrayado discontinuo/punteado y fondo tonal, además del color. Las vistas de conversación y borradores paralelos conservan su contexto de lectura y edición, con estado de guardado por borrador.

## Do's and Don'ts

### Do:

- **Do** conservar el icono Writer, la navegación Lucide y la marca canónica independiente de Faustus.
- **Do** acompañar cada interruptor con su etiqueta y estado escrito.
- **Do** mostrar una explicación visible cuando una función necesaria está apagada.
- **Do** mantener las preferencias de lectura del manuscrito y su medida de línea.
- **Do** conservar bordes, foco y texto de estado en ambos ámbitos de estilos.
- **Do** conservar tinta oscura en acciones doradas y controles de lienzo con superficie, texto y foco legibles.
- **Do** mantener el estado propio de cada panel y devolver las referencias a su documento de origen.
- **Do** limitar los colores, fondos y fuentes elegidos por el autor al documento o lector que configuran.

### Don't:

- **Don’t** sustituir la identidad existente por una marca de ficción nueva.
- **Don’t** usar la tipografía de títulos como regla general para la prosa extensa.
- **Don’t** expresar el estado únicamente mediante el color.
- **Don’t** presentar los ajustes de ventana estrecha como soporte móvil verificado.
- **Don’t** convertir los colores de un mapa, Códex o lector en una nueva paleta de marca.
- **Don’t** cerrar una edición pendiente como si se hubiera guardado cuando existe un fallo o formulario sin enviar.
