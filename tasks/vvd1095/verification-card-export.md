# Exportación individual de fichas del Códex —1496

## Estado de esta documentación

Implementación de 19 rutas comprometida en `e21211fe8ed56d27d73367bb71230614e1909385`, con revisión técnica independiente favorable y F1 visual corregido en la misma ficha normal EN/ES. Revisión formal/CAS: aprobación independiente de la revisión35 sobre `e21211fe8ed56d27d73367bb71230614e1909385`, leída antes de probar; CSS propio2, Native propio1 y F1 EN/ES1, todos exit0; ROOT leyó el informe completo y verificó el readback exacto. Integración y comprobaciones Main: integración FF exacta bajo merge propio y HEAD limpio/fresco, seguida de siete comprobaciones Main ALL_PASS: quick/build/Electron/manifest/agregado12/Native5/editorial36. Son ejecuciones distintas de las trece gates de fuente; no se declara otra suite global. Manual: Google Doc nativo actualizado con revisión requerida, +512 unidades UTF-16; 198 párrafos, otros 197 textos y toda la estructura/estilos ajustada exactos por readback.

`ROOT-source-gates-r2.json` registra `ALL_PASS` para 13 gates sobre el conjunto de 19 rutas r2 quieto. Antes del commit, r3 retiró únicamente una CRLF vacía redundante al final del test independiente: las otras 18 rutas y todas las assertions permanecen exactas. `ROOT-commit-eof-incident.json` conserva el primer guard fallido por asumir LF antes de mutar y su recuperación correcta. Los gates r2 no se presentan como otra ejecución sobre r3. Los recibos de CAS, Main y manual acreditan actuaciones separadas del commit. ROOT-continuity-receipt.json conserva todos los bytes anteriores de MEMORY y sólo actualiza el nodo propio del grafo con embed=False; los demás nodos y aristas permanecen exactos. La integración documental y el cierre de research1496 se registran después de ocurrir en ROOT-delivery-final.json. La tarea1095 y su worktree continúan abiertos.

## Uso normal y formatos

Abra una ficha guardada del Códex en la vista de autor y pulse **Exportar**, junto a Crear plantilla, Editar y Eliminar. El panel prepara una copia guardada de autor; no guarda ni incorpora un borrador abierto. **Actualizar copia guardada** permite preparar otra versión, sin recomponer silenciosamente el artefacto anterior.

| Salida | Browser | Desktop |
| --- | --- | --- |
| Markdown | Preparación de `.md` UTF-8 y descarga normal de la aplicación | El mismo formato |
| Markdown con adjuntos locales | ZIP con un Markdown y sólo los recursos consumidos | El mismo formato |
| PDF | Abre una vista imprimible propia; el usuario controla la impresión | PDF mediante diálogo y escritura nativos |
| PNG | Desactivado con explicación de Desktop | Compositor existente; una ficha larga puede producir un ZIP de mosaicos |

La captura readonly usa `capturePublicationSnapshot` y `publicationReaderSource`, sin guardar una edición Published ni modificar el proyecto. Contiene la entrada efectiva de Base/época, plantilla, nombres de referencias y recursos consumidos; después de capturar no relee esos datos desde la DB viva. Las definiciones compiladas se resuelven con el pin capturado y sus comprobaciones existentes de manifest/hash; no se adopta otra release si falta la seleccionada. No se promete que una copia admitida represente una edición guardada posteriormente.

El cuerpo incluye propiedades tipadas, fórmulas, 0/false, tags, relaciones y Entry links con sus rótulos y nombres efectivos. Los enlaces a otras fichas no añaden sus cuerpos ni archivos ficticios. Se reutilizan las proyecciones y saneadores para bloques Source/Owned, herramientas, fuentes e imágenes/medios locales. El ZIP no incorpora `world.json`, índice global, fichas ajenas ni toda la galería. No incluye borradores, pestaña Notas/anotaciones, selección de jugadores ni una garantía de publicación segura; una copia de autor puede contener contenido privado.

El cierre, cambio de ficha/ámbito o modo de jugadores invalida el trabajo pendiente, también A→B→A. Browser sólo escribe en la pestaña about:blank reservada por su gesto si conserva la identidad del Document/token; no adopta una navegación del usuario. La descarga PNG vuelve a validar admisión después de componer Blob/ZIP. Cerrar no deshace una escritura nativa que ya haya empezado.

## MCP

`wh_world_markdown_export` añade `entryId` y `eraId` opcionales. Sin `entryId` conserva el vault completo anterior; `eraId` solo se rechaza. La salida individual es `.md` con `includeMedia:false` o ZIP con `true`; mantiene 25 MiB y devuelve bytes/base64, versión y dependencias del artefacto.

`wh_build_world_bible` y `wh_export_world_bible` añaden `presentation:"card"`: exactamente un `entryIds`, secciones omitidas o `["codex"]`, sin otras selecciones no vacías y `eraId` opcional. Conservan los defaults y permisos de la Biblia normal. `includeSecrets` controla esa Biblia; la presentación individual es siempre una copia de autor y ese argumento no la convierte en una exportación para jugadores. Export HTML/PDF sigue siendo una salida de archivo; cancelar PDF individual es `code:"canceled"`. `wh_export_document_image` conserva su builder genérico; el panel nuevo captura su HTML ya preparado mediante el mismo compositor. [Argumentos y ejemplos](../../docs/AI-BRIDGE.md#exportar-una-ficha-guardada-del-códex).

## Evidencia del autor, sin sumar repeticiones

Los recibos están en `_stage/card-export-next/`. `REPORT.md`/`RESULT.json` y `FREEZE15.json` conservan r1; `REPORT-F1-r2.md`, `RESULT-F1-r2.json`, `FREEZE15-r2.json` y el freeze19 r2 de ROOT registran el delta posterior de dos rutas. Las otras17 rutas de fuente19 y los nueve originales protegidos permanecen exactos según la revisión independiente.

| Tanda | Resultado y alcance |
| --- | --- |
| Autor r1 funcional | `behavior-final.log`:11 grupos, exit0; acción normal, captura, Markdown/ZIP, MCP, ownership, carreras reales del panel, medios y ancho390 |
| Autor r1 visual | `visual-settled.log`:1 foco,8 PNG asentados y abiertos, ficha con footer y panel en EN/ES1280/390. La primera tanda con frames de entrada/stale queda excluida |
| Autor r1 Native | `native-third.log`:5 comprobaciones; PDF real de 5 páginas/texto y cancel sin archivo, PNG genérico9/capturado3 mosaicos y control del helper compartido MP4; no transcodificación MP4 atribuida |
| Originales del área r1 | Vault10, Biblia4, lectura Source5 y portabilidad Source4 grupos, todos exit0, sin alterar sus assertions |
| F1 r2 | Mismo oráculo RED→GREEN sobre aliases y campos builtin en HTML/Markdown EN/ES, con YAML y labels explícitos intactos; después artifacts2, readability1 y MCP1, todos exit0 |
| Native r2 afectado |5 comprobaciones; PDF de 6 páginas con aliases/rótulos legibles y cancel, PNG genérico9/capturado3 y helper compartido. Tipos app y lint afectado exit0 |

El agregado funcional final registra 12 grupos al añadir F1; el autor no volvió a ejecutar ese agregado entero en r2, sino los cinco grupos afectados y Native. Tampoco ejecutó otra suite global. El lint r1 tuvo un aviso de test ignorado por configuración; el lint afectado r2 no tuvo avisos. No se transforman esos resultados en cobertura universal.

ROOT ejecutó después los 13 gates r2, todos con exit0: quick, build, Electron, crítica (396), manifest (2), agregado funcional (12), Native (5), originales Markdown (10), Biblia (4), transporte Source (7: 5 renderer y 2 externos), portabilidad (4), editorial (36) y author-kit headless (5). Ésta es evidencia separada de ROOT; los dos controles externos Source pertenecen al transporte original, no a una nueva sesión stdio de la exportación individual. El recibo conserva fuente quieta, nueve originales y dos archivos ajenos exactos. No se declara una suite global nueva ni Main por estos gates.

Se conservan los RED de ausencia de la acción, PNG tardío tras revocar el dueño, omisión de Entry links/filas Markdown ilegibles y overflow390, con sus GREEN causales. También quedan los errores de observador Native (interpretación de cancel y cleanup de pdfjs), la tanda visual inválida y avisos de Network Service. ROOT adaptó sólo el shim de entrada del original editorial tras mover `htmlToPdf`: el original falló después de32 grupos por extracción textual y el mismo conjunto posterior pasó36; no se cuenta como prueba de la nueva salida individual.

## Revisión independiente, acabado y Browser real

La revisión técnica independiente (`independent-review/TECHNICAL-REVIEW.md` y `r2/ADDENDUM-F1-r2.md`) ejecutó dos grupos propios CSS y uno Native tanto sobre r1 como sobre r2, sin cambiar sus oráculos. Retiene la carga compilada después de capturar y cambia pin, Blob, imagen, WAV/metadata, plantilla, target y ficha ajena: exige la versión capturada y un ZIP acotado. Lee YAML canónico/0/false y filas con labels repetidos. Native propio comprueba cuatro opt-in/defaults y dos rechazos por ejecutor→IPC→handlers reales; no duplica PDF/PNG ni acredita stdio externo. Es revisión técnica, no voto CAS ni acabado visual.

El reviewer visual fresco señaló F1 en r1: alias JSON y keys builtin sin humanizar. El autor conservó RED y GREEN con el mismo archivo completo SHA256 `d0fb266b21acf059b323e6d8dab25a19eb7d4224c8c09f5aed0f62e2c19f05e4`. La corrección sólo afecta la presentación capturada: alias legible y rótulos EN/ES, priorizando labels explícitos; los valores guardados, YAML y builder genérico no cambian. El mismo reviewer cerró F1 con `visual-review/VERDICT-F1-r2.md`, leyendo las recapturas Brave EN/ES y sus DOM, sin otro detector ni una segunda revisión general.

ROOT probó en Brave la ficha guardada propia con alias, Población0, título/h2/dos párrafos y Entry link a Grupo del puerto. La vista imprimible mostró esos datos y sólo el nombre del target. Las recapturas F1 EN/ES acreditan rótulos y alias corregidos, no impresión física ni PDF/PNG descargados. Los clics Markdown no aportaron path ni archivo coincidente en el escaneo dirigido: no se afirma descarga Brave confirmada, defecto universal ni una causa inferida. Los bytes Markdown/ZIP y Native tienen evidencia aparte.

## Referencia y límites

La referencia VVD observada por ROOT ofrece Share→Export con PDF, Markdown y Share picture. Un `.md` previo de 37 bytes sólo acredita el título de la ficha QA vacía, no el cuerpo rico ni el último clic. PDF abrió su ruta `/print/`; la ficha rica produjo el error observado 605220853 tras un único reintento. No se certificaron bytes PDF ricos ni archivo Share picture; Preparing→listo no equivale a descarga. Se conservan las capturas asentadas y se excluye el frame anterior con popover stale. Estas observaciones no demuestran un fallo universal de VVD ni igualdad de formatos.

La implementación es local y reutiliza servicios existentes, sin nuevas dependencias, APIs de pago o colaboración remota. No incorpora draft, notas laterales, galería completa, export de jugadores, instalación E2E de paquetes, una nueva sesión stdio externa, impresión física ni paridad completa con la referencia.
