# Lectura beta

Primera fase, todo en local: el escritor elige capítulos, genera **un único archivo HTML** que el lector abre en cualquier navegador, el lector comenta y devuelve **un archivo JSON**, y la app lo importa y recoloca cada comentario sobre el capítulo tal como está hoy.

No hay cuentas, servidor, red ni publicación. Nada sale del ordenador salvo el archivo que el propio escritor envía.

## Qué hace

1. **Paquete.** Desde el motor *Lectura beta* (o con `wh_beta_package_create`) se eligen capítulos y se crea un paquete versionado. La app guarda una copia (HTML saneado y texto plano de cada capítulo, con su hash) y escribe el archivo `<proyecto> - beta v<N>.html`. En el escritorio se guarda en `<userData>/exports/beta-reading/`; fuera del escritorio se descarga. El botón *Descargar de nuevo* regenera exactamente el mismo archivo.
2. **Lectura.** El lector abre el HTML (doble clic). Selecciona texto y pulsa *Comentar la selección*, o comenta el capítulo entero; marca reacciones por capítulo (me encanta, me hace reír, tensión, me entristece, me pierdo, se me hace lento); escribe su nombre y descarga sus comentarios. Los borradores se guardan en el navegador del lector (si lo permite) para no perder trabajo.
3. **Importación.** *Importar respuestas…* (o `wh_beta_import`) lee uno o varios JSON. Cada comentario se guarda por proyecto con lector, versión del paquete, capítulo, ancla, texto y fecha. Importar el mismo archivo otra vez no añade nada.
4. **Revisión.** Los comentarios se agrupan por capítulo con estado, filtros por capítulo, estado y lector, y las acciones *Ir a la cita*, *Resolver / Reabrir* y *Eliminar* (con *Deshacer* durante diez segundos). Los huérfanos se muestran aparte.

## Estados de un comentario

| Estado | Significado |
| --- | --- |
| `attached` (anclado) | La cita sigue en el capítulo, palabra por palabra. Si aparece varias veces gana la copia cuyo contexto y párrafo encajan mejor. |
| `moved` (movido) | La cita ya no está literal pero hay un pasaje muy parecido (similitud de caracteres ≥ 0,7, con el contexto anterior/posterior como desempate). Se asocia al más cercano. |
| `orphaned` (huérfano) | No se encuentra nada parecido. El comentario se conserva y se muestra aparte; el escritor decide. |
| `resolved` (resuelto) | El escritor lo cerró. Al reabrirlo vuelve a mostrar su estado de anclaje actual. |

Los comentarios sobre el capítulo entero no tienen cita y siempre están anclados mientras el capítulo exista. Una cita de menos de 12 caracteres nunca se busca por similitud. Los estados se recalculan solos cuando cambia el texto del capítulo (se compara un hash del texto).

**Indicador de cambios.** Para cada capítulo de cada paquete se compara el hash del texto de entonces con el de hoy; si difiere se muestra un resumen por palabras (`+añadidas / -quitadas`, párrafos distintos) calculado entre la instantánea del paquete y el texto actual.

## Formatos

Ambos llevan `formatVersion` (hoy `1`). Un archivo de versión mayor se rechaza.

### Paquete (`writers-hoard.beta-package`)

Un solo HTML con CSS y JS en línea, sin recursos externos y con una política CSP que los prohíbe (`default-src 'none'`). El HTML de los capítulos está saneado; las imágenes solo viajan si son `data:` PNG/JPEG/GIF/WebP, los enlaces se desactivan. Lleva el manifiesto en `<script type="application/json" id="wh-manifest">`:

```json
{
  "format": "writers-hoard.beta-package",
  "formatVersion": 1,
  "packageId": "beta_…",
  "version": 3,
  "projectId": "…",
  "projectTitle": "…",
  "createdAt": "2026-10-09T12:00:00.000Z",
  "locale": "es",
  "chapters": [
    { "chapterId": "<id del Writing>", "title": "…", "order": 1,
      "contentHash": "<14 hex>", "wordCount": 4210, "text": "un párrafo por línea" }
  ]
}
```

`version` crece de uno en uno por proyecto. Un capítulo se divide en *bloques* (sus elementos de primer nivel); el índice de párrafo de un comentario es el índice de bloque, y `text` es el texto de los bloques unidos por `\n`.

### Respuesta del lector (`writers-hoard.beta-response`)

```json
{
  "format": "writers-hoard.beta-response",
  "formatVersion": 1,
  "packageId": "beta_…",
  "packageVersion": 3,
  "reader": "Lucía",
  "exportedAt": "2026-10-10T08:00:00.000Z",
  "chapters": [{ "chapterId": "…", "contentHash": "…" }],
  "reactions": { "<chapterId>": ["love", "tense"] },
  "comments": [
    { "id": "r…", "chapterId": "…", "quote": "nadie salió a mirar el mar",
      "prefix": "sobre el puerto y ", "suffix": " aquella noche.",
      "paragraph": 0, "text": "Gran imagen.", "createdAt": "2026-10-10T07:55:00.000Z" }
  ]
}
```

El ancla es **cita + 40 caracteres de contexto a cada lado + índice de párrafo**, nunca un desplazamiento. `quote` vacío = comentario sobre el capítulo entero. Reacciones válidas: `love`, `laugh`, `tense`, `sad`, `confused`, `bored`.

### Datos que guarda la app (Dexie v36)

`betaPackages` (el paquete y su instantánea), `betaResponses` (una por lector y paquete: reacciones y hashes vistos) y `betaComments`. El id de un comentario es un hash de proyecto + paquete + lector + capítulo + párrafo + cita + texto + fecha, por eso la importación es idempotente aunque el lector cambie sus ids internos; un segundo archivo del mismo lector solo añade lo nuevo. Entran en la copia de seguridad del motor `beta-reading`.

## Seguridad de la importación

El archivo viene de fuera: se valida el formato y la versión, se limitan los tamaños (8 MB, 5000 comentarios, 5000 caracteres por comentario, 600 por cita), se eliminan caracteres de control y se descartan (y cuentan) los comentarios inutilizables. Los textos se muestran como texto, nunca como HTML.

## Puente / MCP

| Herramienta | Escribe | Qué hace |
| --- | --- | --- |
| `wh_beta_package_create {projectId, writingIds[]}` | sí | Crea el paquete; devuelve `packageId`, `version`, capítulos con hash y `filePath` (null si no hay escritorio). |
| `wh_beta_import {projectId, json}` | sí | Importa una respuesta; devuelve `imported`, `duplicates`, `attached`, `moved`, `orphaned`, capítulos desconocidos y capítulos cambiados. |
| `wh_beta_comments {projectId, writingId?, status?}` | no | Lista comentarios con su estado actual y si el capítulo cambió desde el paquete. |
| `wh_beta_comment_set_status {commentId, status}` | sí | `resolved` o `open`. |

Las tres de escritura se niegan si el motor *Lectura beta* está apagado en el proyecto. La autocomprobación del puente (`__selftest`) recorre: crear paquete (v1, v2) → respuesta simulada → importar dos veces (la segunda añade 0) → cambiar el capítulo → reimportar (movido/huérfano correctos) → resolver y reabrir.

## Pruebas

- `node scripts/run-beta-reading-tests.mjs`: lógica pura (bloques, hash, paquete, anclas, formato de respuesta, idempotencia, diff).
- `npm run test:beta`: lo anterior y `tests/beta-reading.browser.tsx`, que crea un paquete desde la pantalla, abre el HTML generado en la ventana de pruebas, añade comentarios y reacciones desde su interfaz, exporta el JSON, lo importa en la app, edita el capítulo y comprueba movido/huérfano, resolver, deshacer y la versión 2.

## Límites de esta fase

- Sin cuentas, sin edición compartida, sin biblioteca comunitaria ni alojamiento del paquete: son frentes aparte. El canal entre escritor y lector es el que ellos elijan (correo, mensajería) con un archivo cada vez.
- Un comentario ancla a un solo párrafo: una selección que cruza párrafos se recorta al primero.
- Las imágenes solo viajan en línea (`data:`); los enlaces del capítulo se desactivan en el paquete.
- La similitud es textual (caracteres y palabras), no semántica: una frase reescrita por completo queda huérfana.
- El paquete es una instantánea: no se actualiza solo. Para que el lector vea cambios hay que crear una versión nueva.
- La tarjeta social para compartir el paquete no está hecha.
- Fuera de la app de escritorio no se puede escribir en la carpeta de exportaciones: el panel descarga el archivo.
