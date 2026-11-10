# Portada local de mapas generados

Source2365 revisión3 está aprobada e integrada localmente en main `21bffd6134907c9e3ff64c2f51b76771d132ada6`, sin push. Compone `26cb1be6785e85d049f0889763762c48c38ae256` y la aclaración de herencia en dos rutas UI, sin cambiar core/schema/ownership. Corte `SOURCE-CUT-2365-r3.json`, SHA256 `2f1f8d039f3d755f373fec7d91a16fb64ec8d14173568884ef3ed13f224b22ff`.

## Uso y ámbito

En World Generator, **Portada del mapa** permite elegir Archivo o Galería, cambiar la imagen, quitarla y Deshacer. La colección usa portada elegida → thumbnail generado disponible → ninguna imagen. Los bytes copiados son independientes del asset original. La portada no es una superposición del terreno ni una generación por IA; no cambia lienzo, exports cartográficos, Reader o publicación.

Base y una era que hereda el mapa comparten el owner Base, sin crear una copia de terreno por elegir portada. Un root propio activo o un mapa sólo existente en la era escribe allí; oculto/eliminado no puede editar Base por fallback. El panel informa, con los ámbitos reales del getter: «Esta portada se comparte desde Base. Cambiarla o quitarla afecta a las eras que la heredan». No muestra ese aviso en Base o root propio.

## Contrato UI y MCP

`coverImage`/`coverRevision` son opcionales e independientes de `thumbnail`. `wh_get_world_cover` es de lectura: worldId, requestedScope, scope efectivo, bytes o null, revision y ownerToken opaco. `wh_set_world_cover` recibe coverImage (dataURL local o null), expectedRevision y expectedOwnerToken obtenidos del getter. Ambas precondiciones son obligatorias, incluida la primera escritura; no hay bootstrap ni fabricación local del token.

El setter revalida visibilidad/owner y CAS dentro de la transacción. Deshacer usa el recibo de campo normal y owner registrado; conserva terreno, título, thumbnail, calibración, waypoints y demás ediciones ajenas. Una portada posterior, reset/recrear o restaurar A1 después de B2 invalidan el recibo/token antiguo aunque reaparezcan bytes y revisión. No-op de iguales bytes/ausencia conserva el dominio y no emite __worldCover mutable. ExecutorCore conserva su auditoría MCP normal tras el relay, incluso no-op/error; los rechazos previos mantienen su política actual.

Editar Base conserva el checkpoint documentHistory del agregado anterior y sus imágenes locales deduplicadas; era usa el history de worldEraVariants. El observador comprueba esos efectos normales y no suprime el middleware. Leer/elegir portada no abre/genera/flush terreno ni materializa caches. JSON serialize/parse/import con IDs fuente ocupados, duplicado CAS/IPC nativo y ZIP normales conservan bytes, thumbnail, eras/history e identidades propias de destino, manteniendo source/control exactos.

## Pruebas y autoridad de entrega

Root aprobó la propuesta2365r3 tras lectura del core/UI/tests,15rutas y165artefactos;13blobs anteriores permanecen exactos en el delta UI final. Su revisión independiente14funciones/20casos focales y12observaciones de cleanup pertenece a26cb, con core/tests idénticos en21bffd. El autor conserva32casos y quick0; tras el copy final repitió UI5+owner2 y quick0. React act warnings se mantienen atribuidos; no se afirma un PASS nuevo de toda la suite.

Native final genuino de Root sobre21bffd: `map-cover-native-root/final-head/run-20261110T013033Z-066d0b67`, warm85284/cold74540 EOF0; cuatro adaptadores EOF0/stderr0 y cuatro claves distintas revocadas401.181MCP=180relays+1negativa previa,13UndoHTTP=193bridge;17solicitudes internas de duplicación aparte. Tres DTOpares fríos y snapshot completo exactos, mismo perfil/origen/bundles sin reseed ni editor/SourceHost;89tablas realmente contadas vacías y perfil retirado normalmente. Las claves no son personas. Dos ZIP normales tienen CRC/SHA correctos. Root cotejó4411inputs únicos/4642entradas en tres builds; la reutilización cold se verificó durante ejecución y no se rehashean offline bundles ya retirados.

Brave real se atribuye por corte: sobre26cb, Archivo/Gallery/cambiar/quitar/Undo, selector vacío/cancelación, tarjeta, recargas y ancho420CSS; importó los dos ZIP físicos de Native4,24ámbitos y6rechecks fríos exactos. Son bibliotecas privadas separadas mediante ZIP explícito, no MCP directo a Brave. Sobre21bffd y esos mismos fixtures con core/serializers idénticos, verificó aviso ausente en Base/propio, presente heredado y tras reload, bytes correctos y panel normal/420CSS sin overflow propio ni consoleErrors. Se observó locale en; la copia en español se contrastó por Source/typecheck. No se afirma importar en Brave los ZIP nuevos del Native final ni ausencia de overflow en todas las barras de WorldView. Pestañas/viewport se restauraron y Vite Root quedó parado.

El manual ya está actualizado por Root: una lectura fresca, una escritura CAS y una relectura completa;816párrafos/815ajenos, añadido255UTF16 al párrafo409, índice40425, estilos/listas/recurso inverso exactos. El snapshot offline anterior799 no se usa como revisión actual ni autoriza repetir esa escritura. Source2365 está cerrado y su autor retiró WT/rama, con15blobs main exactos y Research preservado. Memoria/grafo tienen payloads separados pendientes de GO; no se atribuyen como aplicados por este documento.

Referencias locales bajo `E:/Development/IA/Research/`:

- `writer-parity-20261110/map-cover-native-root/APPROVE-SOURCE-r3.md`, `INTEGRATION-SOURCE-r3.json` y `SOURCE-CHECK-r3.json`.
- `writer-parity-20261110/map-cover-native-root/ROOT-RESULT-CHECK-final.json`, `FINAL-INPUT-CHECK.json`, `BRAVE-final-head.json`, `BRAVE-REPORT-r1.md`, `BRAVE-ZIPS-r4.json` y `BRAVE-EXPECTED-r4.json`.
- `writer-parity-20261110/map-cover-native-root/MANUAL-CHECK-current.json`.
- `writer-parity-20261109/map-cover-red/retire2365/RETIRE-2365.json` y `REMOVAL.json`.

## Históricos y límites

Native2371r2 sigue FAIL: el observador omitió un checkpoint Base legítimo y falló antes de guardar el par completo del primer setter. R3 conserva warmPASS/coldFAIL por la colisión state.source antes de renderer/claves;145MCP=144relay+1previa,13UndoHTTP y157bridge,17internos aparte. R3 no acredita lectura fría ni89tablas vacías. R4 sobre26cb fue un intento nuevo PASS, previo a la repetición final21bffd; no se cambian retrospectivamente los fallos ni su conteo corregido.

En R4/final, evidenceIndex reutiliza el nombre del primer getter en cold: ese par físico se atribuye sólo a cold. Los DTO/calls warm se conservan en receipt/stdio y las mutaciones/negativas en sus propios artefactos; no se fabrica otra pareja. Esta página referencia los registros existentes, sin crear otro auditor ni repetir las ejecuciones.

No acredita publicación de portadas, APIs pagadas, modelos, equivalencia total con la referencia o paridad web/SDK completa. El panel SDK/map-lens sigue en su frente propio2370/SDK y1095 permanece abierto. La documentación de esta capacidad conserva su aceptación acotada y las tareas ajenas mantienen su estado.
