# Importar y revisar un manuscrito local

En Escritos, **Importar un manuscrito** abre DOCX, Markdown y texto. Primero se lee el archivo y se muestra el plan: división por títulos, separador o archivo; nombres, selección, texto final de muestra y cambios conservados para revisar. Cada fila crea un borrador salvo que se elija explícitamente un capítulo existente como destino. Los nombres iguales no provocan reemplazos.

La importación completa se guarda en una transacción. Los reemplazos conservan su versión previa y los metadatos del capítulo; un destino cambiado o desaparecido cancela el lote. En una era, sólo se escribe su variante. Base y las otras eras permanecen independientes.

El núcleo documental incluido en escritorio conserva tablas, listas, imágenes locales, notas y revisiones de inserción/borrado compatibles. Las revisiones se resuelven desde **Cambios**, con Aceptar, Rechazar y Deshacer normales. Los comentarios cuyos dos límites se representan con precisión se incorporan a los hilos locales, incluidas respuestas directas y estado resuelto. Se muestran autor y fecha originales como procedencia.

Los comentarios excluidos, los que cruzan capítulos y los que no tienen un rango exacto permanecen en la fuente y se cuentan. Las revisiones de formato, vínculos de movimiento y otros casos no representables se indican cuando el núcleo los detecta. Los nombres de capítulo usan el texto final del título; las revisiones de ese título permanecen en el original. Esto no establece fidelidad universal de DOCX ni paginación idéntica a Word.

Sin el núcleo de escritorio sigue disponible la importación simplificada anterior del navegador: prosa, títulos, énfasis y notas. El plan indica las pérdidas detectadas de revisión, tablas, numeración, imágenes y comentarios; no presenta esa conversión como revisión rica.

El archivo original se conserva byte a byte en el proyecto. Puede descargarse antes de aplicar y desde **Fuentes originales conservadas** al volver a abrir el importador. Los originales viajan en JSON de proyecto/completo y ZIP; clonar remapea los recibos y conserva los mismos bytes. Borrar un capítulo no elimina la fuente. Borrar el proyecto elimina sólo sus propias fuentes. Un archivo DOCX completo puede abrirse además con las herramientas documentales existentes; las sesiones nativas se cierran sin guardar implícitamente su edición.

## Herramientas normales

- `wh_manuscript_import_inspect`: archivos base64, división y ámbito; devuelve capítulos, hallazgos, comentarios y digest del plan sin escribir el mundo.
- `wh_manuscript_import_apply`: vuelve a comprobar los archivos y el digest; crea o reemplaza con versiones explícitas y guarda fuente/recibos/comentarios atómicamente.
- `wh_manuscript_sources`: fuentes y recibos del proyecto/era.
- `wh_manuscript_source_export`: bytes exactos del original; pueden abrirse mediante `wh_document_open_bytes`.

Las tres herramientas de revisiones admiten `projectId`/`eraId`. La lectura devuelve `documentVersion` en una era, que puede enviarse junto a `expectedUpdatedAt` al proponer o resolver. La omisión de `eraId` conserva el comportamiento Base. El límite existente sigue siendo 32 MiB por archivo y 64 MiB por lote; el transporte nativo admite el correspondiente sobre base64.

Los estilos y objetos que el editor no representa permanecen en el archivo original. No se implementa aquí exportación de los nuevos hilos locales a comentarios Word, persistencia del Undo nativo ni edición universal de objetos de Word.
