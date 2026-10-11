# Editor avanzado y núcleo documental de Writers

Writers conserva React, TypeScript, Tiptap y Electron para el producto y su edición interactiva. El procesamiento documental vive en `native/`: doce crates Rust propios incorporados como un fork separado del código histórico de Wordcraft. No hay submódulos, dependencias Git, actualizadores ni llamadas al repositorio original. Las licencias y el registro de procedencia se conservan.

## Editor

La barra de formato ofrece fuentes, tamaños, colores, resaltado, alineación, interlineado, sangrías, estilos de párrafo, subíndice, superíndice, tablas y saltos manuales. Los atributos semánticos `data-wh-*` sobreviven a la sanitización, guardado, reapertura y deshacer. Las columnas redimensionadas conservan su anchura. El modo de páginas interpreta saltos manuales y mantiene las notas en la hoja correspondiente.

Las funciones anteriores siguen presentes: capítulos y libro continuo, notas, búsqueda, referencias, anotaciones, versiones, recuperación y copiloto compartido. Al importar desde el panel Documento en modo libro, se sustituye solo el cuerpo del capítulo actual; sus títulos, identificadores y los otros capítulos se conservan. En un editor de capítulo se sustituye su cuerpo mediante una transacción que admite deshacer.

## Documento

El panel Documento abre DOCX, ODT, RTF, HTML, TXT o archivos Writers mediante el núcleo propio. Abrir conserva un documento separado para inspeccionar, previsualizar o descargar; no modifica el borrador. Aplicar el texto al editor es una acción explícita. Después de aplicarlo, la descarga sigue el texto actual; el archivo completo original continúa seleccionable.

El núcleo expone un catálogo filtrable de 505 órdenes, sesiones, lotes atómicos, importación/exportación, render PNG y PDF. Interfaz y MCP usan el mismo servicio de producto. El ejecutable persiste mientras se usa y se lanza sin ventanas de consola.

El archivo `.writer.json` es un contenedor propio versionado con documento, imágenes y partes originales. También conserva XML y referencias de objetos y gráficos que antes quedaban excluidos de la serialización. DOCX conserva su contraseña al abrir y guardar documentos cifrados, salvo cambio explícito. El guardado utiliza temporal y reemplazo atómico para conservar el destino si falla.

La vista de página y el PDF de este panel usan el mismo motor Rust. El modo de escritura Tiptap y su paginación visual no garantizan idénticas páginas al motor nativo: son representaciones distintas. Las exportaciones anteriores de proyecto permanecen disponibles con su alcance previo; el panel Documento es la nueva vía para formato rico y assets. El formato `.writer.json` conserva información que una proyección a HTML/Tiptap puede no representar, como ciertas cabeceras, revisiones u objetos. La interfaz explica esa diferencia antes de aplicar texto.

## API y MCP

`wh_get_writing_document`, `wh_format_writing` y `wh_edit_writing_document` leen y editan un capítulo rico mediante el mismo esquema del editor, guardado normal, recuperación y deshacer del puente. Sus rangos son posiciones ProseMirror.

Las herramientas `wh_document_*` gestionan sesiones nativas independientes de las filas de capítulos: catálogo, crear, abrir archivos o bytes, importar HTML, inspeccionar, leer texto, ejecutar órdenes/lotes, guardar, exportar HTML/bytes/PDF, renderizar páginas y cerrar. Las selecciones del núcleo usan rutas de bloque y offsets UTF-8, no posiciones ProseMirror. La herramienta de render devuelve una imagen real para visión por MCP sin duplicar su base64 en el texto.

Las órdenes que necesitan datos adicionales pueden devolver solicitudes de UI como datos; el proceso no abre diálogos. Los lotes solo prometen rollback de efectos en memoria. Las operaciones con efectos externos se ejecutan por separado. Guardar sesiones es explícito; su estado no persistido desaparece al cerrar el proceso.

## Construcción y pruebas

Se utiliza Rust 1.92 fijado en `native/rust-toolchain.toml`. El primer build necesita el toolchain y los crates del lockfile; nunca descarga Wordcraft. `npm run document:build` compila el código propio y prepara el ejecutable junto con ocho avisos/licencias, incluidos los de fuentes. Los lanzadores desktop y el empaquetado incluyen ese paso. Un build web no requiere el motor de escritorio.

Comprobaciones de área:

```text
npm run test:editor-advanced
npm run test:document-editor
npm run test:document-service
node scripts/run-document-integration.mjs
node scripts/run-document-full-app.mjs
npm run verify:quick
npm run build:desktop
```

La prueba de servicio se ejecuta con `WRITER_DOCUMENT_ENGINE_TEST_BINARY` apuntando al ejecutable construido para incluir el motor real; sin esa variable, prueba el transporte con un proceso fixture. Los perfiles QA son aislados y las ventanas permanecen ocultas.

La evidencia del núcleo está en `native/VERIFICATION.json`; el contrato, en `native/PROTOCOL.md`; el origen histórico y sus SHA, en `source-provenance.json`.

## Límites

No se declara paridad total con Word ni fidelidad universal de DOCX de terceros. El corpus real amplio sigue por evaluar; sí se han comprobado formato, imágenes, tablas, notas, contraseñas, PDF y conservación de partes. El corrector y la división de palabras heredados del núcleo usan recursos ingleses; no son un corrector de castellano. Las mejoras no añaden otro LLM: el copiloto y la inferencia de texto corresponden al servicio global configurado de Faustus/Sparks.
