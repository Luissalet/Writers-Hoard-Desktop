# Inserción y orden directo de ejes Radar

## Uso

En el radar abierto, enfoca o pulsa «Insertar eje antes de · nombre» en el hueco correspondiente. El eje nuevo queda en esa posición con identidad propia y valor0 por serie; el nombre recibe foco. En Ejes y escalas, mueve su asa por arrastre o usa Alt+Arriba/Abajo. Añadir eje y los botones anteriores de subir/bajar siguen disponibles. El límite existente es24ejes/32series.

Las ediciones conservan identidad, escala/unidad/paso, icono/color, serie y binding del eje. Los valores crudos fuera de escala no se recortan por insertar o reordenar; su representación visual y la edición de un valor siguen sus reglas anteriores. Un eje nuevo no copia el binding de otro. Guardar usa la revisión observada; Descartar confirmado retira el borrador. Escape, pointercancel o pérdida de captura antes del drop cancelan el gesto. Un cambio de estructura entre inicio y drop invalida ese destino capturado; un conflicto de guardado conserva un borrador revisable.

El gráfico editable denso tiene ancho mínimo según su número de ejes y scroll horizontal interno para separar sus huecos en pantallas estrechas. El gráfico readonly no muestra inserción/ordenación de autor. La categoría de preset respeta el límite previo de200caracteres para que una entrada ordinaria no invalide el documento.

## MCP y ámbito

Leer el gráfico con `wh_radar_get` y usar su revisión actual. Las herramientas guardan por el mismo servicio normal; `projectId` y `eraId` siguen el ámbito existente de Base o época. Una escritura en la época heredada crea su variante normal, conservando Base/hermana/control.

| Herramienta | Argumentos de edición | Resultado |
| --- | --- | --- |
| `wh_radar_axis_insert` | chartId, expectedRevision; label opcional; beforeAxisId existente, null u omitido | Chart guardado y axisId nuevo; ausencia de label usa ordinal. |
| `wh_radar_axis_move` | chartId, expectedRevision, axisId existente; beforeAxisId existente, null u omitido | Chart guardado con el orden por ID estable. |

Null u omisión de beforeAxisId añade al final; label null es inválido. Anchors/tipos/IDs inválidos, destino ajeno, revisión obsoleta o capacidad rechazan sin mutación parcial del dominio. El self-move conserva el helper puro pero el handler sigue el save normal; no se promete revisión persistida no-op. La auditoría MCP normal y su metadata `_undo` no acreditan un UndoHTTP específico para radar persistido. La recuperación cubierta por estos gestos es borrador/Guardar/Descartar y cancelación antes de admitir el drop.

JSON de gráfico, export/import de proyecto, duplicado y ZIP mantienen sus servicios existentes. La copia de proyecto remapea chart/Codex/era/history hacia identidades reales del destino y conserva IDs locales de ejes/series, valores, binding y prosa. No se prueba una API externa o servicio de pago.

## Corte Source y pruebas atribuidas

Source final: `6ac8efa438cdf53f9f7937493828f0f2460e8af1`, sucesor de `fc7dfe466f98c9c8fe8e1330d787fdc961736dfc` sobre base5024cefc. Nueve rutas (siete de producto, test y brief). SOURCE-CUT-r2 SHA8a1bdce46d65c5278561f145e0cad61d0225bee5438a00c3bb3daf326a72aabd y aprobación independiente Source2425 revisión3, mensaje27571/reporte79a1a92d. El autor de este documento escribió el cuerpo inicial del test y el arnés Native2434; no los autoaprueba como auditor independiente.

Los seis focales Model/Bridge/Era/Portable/UI/Pointer y las regresiones existentes conservan sus cortes históricos: los primeros tres usaron el cuerpo662; el batch final anterior y las tres regresiones browser usaron6b66. Node existente registró cinco PASS; lint dirigido de seis archivos tuvo cero errores/warnings. No es un nuevo recuento de todas las aserciones ni una suite global.

Dos defectos reales se conservaron y corrigieron. La categoría ahora limita la entrada a200 sin relajar el modelo. El clic denso de Brave23ejes/420CSS insertaba entre B/A al pedir antesB; la corrección de ancho/scroll de Graphic conserva el test denso40653c1f que produjo RED sobre Graphicc970 y GREEN sobre a32b3e72. Un setup previo sin label no se cuenta como RED. La prueba nueva usa elementFromPoint real y click DOM sintético; no equivale a mouse trusted. Root repitió los remaining y regresiones finales con EOF0/cleanup0, y renderer/lint finales con26inputs estables; los dos últimos gates no se presentan como otra invocación literal de verify:quick.

La corrección del driver de puntero añadió el botón izquierdo retenido y las observaciones/aserciones trusted/buttons1/capture, preservando los fallos anteriores y las expectativas. No fue un arreglo de producto; las candidatas descartadas permanecen registradas. La revisión visual independiente vio tres capturas reales Electron1440/640; sus límites no incluyen PNG Brave denso ni estados hover/foco no capturados.

## Native de Root

Run `radar-axis-source-root/native-final-source2-preparation4/run-20261110T090446Z-1fd57eca` sobre6ac. Warm89tools/call/88respuestas bridge y cold37/37: total126MCP/125bridge por una negativa validada antes de IPC, no una llamada desaparecida. Los17IPC internos de duplicación se cuentan aparte, no como llamadas MCP. Dos procesos distintos, mismo perfil/origen y builds cálidos, sin reseed; cuatro claves distintas revocadas401, cuatro stdioEOF0/stderr0 y ambos procesos EOF0. Cold contó89tablas a0; el perfil fue retirado normalmente, con7ancestros/92hijos/0reparse/0procesos y sin Force.

La comprobación usa fixture normal de dos proyectos, charts y Codex, manifest/normalizer/dispatcher reales, dos claves por fase, CAS/negativas, Base/era y snapshots completos. Conserva series/metadata/outliers/binding calculado y prosa; usa los caminos existentes de save/get/list/export/import, JSON ocupado, duplicación IPC/replay/Undo de duplicación, dos ZIP con CRC y roundtrip normal. El propio oráculo incorpora exactamente cuatro defaults normales de Project y rechaza organización/publicaciones pobladas sin regla; no filtra esos campos para aceptar una copia. RAW/own-undefined y comparaciones portables tienen sus fronteras explícitas en el arnés y los recibos.

El renderer Native no montó un SourceHost ni un editor Radar. Sus APIs/portables y la prueba UI/Brave se atribuyen por separado. Las dos bibliotecas se transfieren por ZIP normal; no es una conexión MCP directa al IndexedDB de Brave. Este autor lee el recibo, no reejecuta ni autoaudita el arnés. La auditoría independiente2452r1 de codex-writer-radar-final-review es favorable y Root la aprobó:20inputs/161artefactos exactos,710comprobaciones offline del auditor, no710tests de producto. EVIDENCE-CUT-r1 SHA7ab78b19d8c73f3bc764486c03fbc9b84f463739ef6a4702d8d022226968b1e4; REPORT-r1 SHAe01a467b5c09de608d2660457649f8200fab597b62f0af927805f2e2f695bba3. El auditor conserva sus diagnósticos de lectura CP1252/UTF8 y contador26→25 sin alterar ni reejecutar Native. Root cotejó además cada ZIP actual:19archivos y14directorios,33entradas físicas, CRC de todo y SHA de los19archivos.

## Estado de entrega y referencias

Source está formalmente aprobado e integrado por FF en main6ac8efa4 desde5024cefc, sin push; la auditoría independiente2452r1 está aprobada por Root. INTEGRATION2425-FINAL registra nueve blobs de índice/HEAD exactos, ocho RAW exactos y únicamente el test completo CRLF→LF conforme a atributos Git;4722rutas ajenas, remotes e untracked intactos. FINAL-ACCEPTANCE2425-CHECK se emitió antes de esa integración (su campo integration conserva pending); el recibo posterior de integración fija el estado actual. La aceptación es de esta función, no de paridad completa. Root completó Brave con22observaciones conservadas, que incluyen fallos previos y correcciones, no22casos verdes. NATIVE-BRAVE-ROOT-CHECK-r1.json es PASS sobre6ac y los dos ZIP actuales se importaron por el chooser normal de Home: duplicate proj_copy_d13a2a48-54cb-487c-b9f1-a904d5666d7c y JSON proj_1794301504232_v8ast2.

En ambos destinos, Base muestra orden y ocho ejes, valores manuales50/-25 y el binding Codex8 readonly con IDs de copia. E conserva su eje propio al final y F hereda Base. La época E del JSON persiste al abrir su URL observada en una pestaña nueva, sin Save; el target antiguo dejó de responder y no se le atribuye un reload completado. Pestañas propias cerradas y viewport restablecido. Vite sesión88376 terminó por Ctrl+C/EOF1 esperado; procesos85252 y60832 y listener ausentes. No hay PNG Brave: los timeouts de captura no se convierten en imágenes vistas. La revisión visual utiliza sólo las tres capturas Electron reales ya citadas. Los estados de integración y auditoría se fijan con sus recibos finales separados; este documento no convierte la revisión Native en una observación propia de Browser.

Memoria y los dos conceptos de grafo se preparan como propuestas sin aplicar; Google lo actualiza Root mediante lectura fresca y revisión requerida. Nada de paridad global, Undo persistido nuevo o repetición de perfiles históricos rechazados. Este cambio Markdown no ejecuta código ni introduce dependencias.

Evidencia local conservada en `E:/Development/IA/Research/writer-parity-20261110/`: `radar-axis-source-root/SOURCE-CUT-r2.json`, `radar-axis-final-review/SOURCE-APPROVAL-r3.md`, `DENSE-DELTA-REVIEW-r1.md` y `VISUAL-REVIEW-r1.md`; `radar-axis-native-prep/r3-evidence-summary/CUT.json` y `finalSource2-prep4/PREP-CUT-r4.json`; run Native anterior con `run-receipt.json`, `warm-receipt.json`, `cold-receipt.json` y `cleanup.json`; `radar-axis-source-root/BRAVE-observations-final-r1.json` y `NATIVE-BRAVE-ROOT-CHECK-r1.json`. También se conservan radar-axis-native-result-review/REPORT-r1.md y EVIDENCE-CUT-r1.json; radar-axis-source-root/FINAL-ACCEPTANCE2425-CHECK.json e INTEGRATION2425-FINAL.json. La continuidad2453 registra cada actualización de estado por separado.
