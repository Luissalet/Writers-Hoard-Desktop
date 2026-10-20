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

### Navigation

El lateral exterior usa entradas de 14px, iconos de 18px, relleno 10px/12px y esquinas de 8px. La activa combina oro y fondo dorado al 15%. El lateral interno mantiene entradas de 40px de altura y su estado seleccionado tonal, con icono de acento. Las secciones pertenecen al mundo abierto; las globales conservan mundos, backends, actividad y ajustes. La marca de Faustus se abre desde su botón canónico explícito.

### Cards and chips

Escena, dados y continuidad conservan tarjetas de 16px de relleno, borde fino, esquinas de 10px y sombra difusa. Chips y pestañas de modo usan contornos redondos completos, con estado seleccionado escrito y acento. Las tarjetas son herramientas de contexto, no contenedores decorativos para cada párrafo.

### Contextual documents and dialogs

Los bloques de herramienta y las referencias de Códex muestran contenido y acceso al documento de origen; el origen se edita con su herramienta real en un diálogo de contexto. El selector de inserción se despliega bajo su botón y ofrece búsqueda y tipo, sin mantener todo el catálogo abierto. El diálogo de herramienta usa un cuerpo desplazable con borde y fondo profundo; la ayuda, la acción de guardar/cerrar y los avisos de bloqueo permanecen explícitos. La navegación interna respeta el ámbito del documento y no sustituye la ruta o selección del editor anfitrión.

Los diálogos comunes conservan título serif dorado, superficie tonal, borde y esquinas de 12px. El modal grande usa anchura `min(96vw, 100rem)` y altura máxima de 94vh; los diálogos normal y ancho conservan sus medidas existentes. El foco queda atrapado, el fondo es inerte y al cerrar se restaura el foco previo. Los cambios pendientes o fallos de guardado se comunican en el diálogo y requieren una salida explícita; no se disimulan con un cierre exitoso. Los formularios sin enviar conservan su acción propia antes de cerrar.

### Spatial tools and canvas controls

Árboles y Board usan los controles nativos de ReactFlow dentro de un ámbito común: superficie `surface`, texto `text-primary`, borde `border`; al hover cambian a `elevated` y oro. El foco es un contorno dorado de 2px hacia el interior, para seguir visible en la pila de botones. La biblioteca conserva sus operaciones de zoom y encuadre. El grafo de mundo tiene su tratamiento oscuro equivalente. Tipos de conexión, leyendas, títulos y evidencia acompañan el color; la selección de nodos usa borde/anillo dorado.

**The Canvas Chrome Rule.** Los controles de un lienzo heredan las superficies, tinta y foco del escritorio aunque su biblioteca aporte un tema claro por defecto.

Los mapas con capas e historial, hojas físicas de Worldgen, calendarios de cronología, diccionarios y fuentes, tablas, hojas RPG, radar, GLB y medios conservan la forma del contenido y sus herramientas contextuales. No se deriva de una visualización especializada un patrón obligatorio para las demás herramientas.

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
