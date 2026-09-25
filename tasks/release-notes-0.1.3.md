# Writers Hoard 0.1.3: una sola biblioteca, auditoría de datos y modo foco

Versión preliminar para Windows x64 y Linux x64.

## Importante al actualizar desde 0.1.2

La app instalada guarda ahora su biblioteca en la misma dirección interna que el modo desarrollo (`http://127.0.0.1:5174`), así que las dos formas de abrirla ven los mismos proyectos. En el primer arranque, 0.1.3 copia tu biblioteca de 0.1.2 a esa dirección antes de abrir la ventana. Copia todas las bases de datos, las imágenes y los ajustes locales, y cuenta los registros a ambos lados. Si algo no cuadra, borra la copia y lo vuelve a intentar en el siguiente arranque. La biblioteca antigua no se toca, de modo que volver a 0.1.2 la sigue encontrando. El resultado queda en `origin-migration.json`, dentro de la carpeta de datos de la app.

Si ya hay una biblioteca en la dirección nueva, no se mezcla nada. Si el puerto 5174 está ocupado (por ejemplo, por una sesión de desarrollo), la app avisa y no se abre, en lugar de arrancar con una biblioteca vacía.

## Novedades

- **Modo foco** para escribir sin el resto de la interfaz.
- **Familia Hoard**: el puente de IA se integra con el Hub. Expone el catálogo de herramientas, las copias de seguridad de la app y el contrato común de la familia.
- **Poses y ControlNet**: se pueden instalar ControlNets y reescaladores desde la app. Las poses fijadas llegan de principio a fin a ComfyUI, y una generación atascada termina con un error en vez de quedarse esperando.
- **Recortes**: muestra qué conserva cada enlace, permite archivar los que solo tienen el enlace y exporta la lista.
- **Arcos y escenas**: los hitos de un arco abren sus escenas, y cada escena muestra los hitos que caen en ella.
- **Recuento de palabras**: el chino y el japonés se cuentan por carácter, y el tailandés por segmentos de palabra.

## Correcciones (auditoría completa de datos y cierres)

- **Manuscrito**: las importaciones conservan párrafos y saltos de línea, el Markdown conserva listas, tachado, código y citas, y escribir ya no reserializa el texto.
- **Editores**: no pierden lo escrito por un Escape suelto. Un formulario cerrado sin guardar recupera lo escrito, y borrar pide confirmación.
- **Datos**: buscar y reemplazar encuentra `&`, las restauraciones antiguas conservan lo que no pueden devolver y los enlaces nunca se sobrescriben.
- **Motores**: los elementos nuevos quedan al final, la búsqueda abre el elemento correcto y las estadísticas se actualizan.
- **Servicios de IA**: sin esperas infinitas, deshacer completo y los añadidos quedan al final.
- **Generador de mundos**: el 3D sobrevive a regenerar, una Forja caída falla con su código de salida en vez de colgarse, un trazo erróneo ya no borra el historial y las vistas cerradas dejan de dibujar.
- **Interfaz**: una página que falla conserva la barra lateral, Escape cierra solo lo que está encima y los borradores sobreviven.
- **Proceso principal**: deja de perder campos del estudio de imagen y de borrar conexiones guardadas.
- **Lectura en voz alta**: los botones vuelven a abrir el panel y se conserva la velocidad.

## Descargas y requisitos

- **Windows x64:** `Writers-Hoard-Setup-0.1.3.exe`. Instalador preliminar sin firma digital, como las versiones anteriores.
- **Linux x64:** `Writers-Hoard-0.1.3.AppImage`. Concede permiso de ejecución. Las herramientas multimedia completas requieren glibc 2.38 o posterior; gallery-dl no funciona con glibc 2.36.
- **SHA256SUMS.txt:** sumas de comprobación. Los archivos `.yml` y `.blockmap` sirven al actualizador.

## Validación

Pasan las pruebas críticas, la comprobación de tipos, el lint y la conformidad de motores. La copia de la biblioteca se probó así:

- Con una biblioteca sintética (dos bases, índices compuestos y multientrada, claves fuera de línea, autoincrementos, Blob, File, Map, Set y fechas): el resultado es idéntico byte a byte.
- Con una biblioteca real de 275 registros llevada a `file://`: tras la copia, la app abre sus 5 proyectos y sus capítulos.

Los archivos «Source code» generados por GitHub contienen la documentación pública del repositorio de releases. El código de desarrollo permanece privado.
