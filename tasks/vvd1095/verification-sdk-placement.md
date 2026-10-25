# Navegación lateral opcional del SDK local —1512

## Uso y contrato propio

El selector de documentos vinculados conserva Abrir y añade **Ver al lado** / **Open beside**. La nueva intención está disponible como `client.openDocument(kind,id,{placement:'beside'})`; las llamadas anteriores sin opciones, con objeto vacío y `client.refs.open(reference)` mantienen su apertura. Si el anfitrión carece de `openBeside`, se utiliza su navegación normal.

La misma resolución de documentos efectivos comprueba existencia y conserva proyecto/época capturados antes de despachar por Source, raíz Worldgen, adaptador de anclaje o ruta normal de herramienta. El cliente vuelve a comprobar su lease vigente tras la lectura asíncrona. Ocultos en la era, ausentes y documentos de otro proyecto no despachan. Un ID de waypoint hijo no es un documento raíz Worldgen y conserva el rechazo existente; no se añade una API de hijos. Un motor desconocido sigue el fallback de navegación ya existente del workspace.

Source principal A conserva su ruta e identidad al consultar B en el companion. Cuando A ya vive en companion, abrir otro motor conserva su montaje oculto/inert y permite retornar con su borrador. La reparación previa de Host evita caer a preview por una reemisión de navegación del mismo owner; el cleanup sigue revocando irrevocablemente los clientes antiguos. Owned/embed conserva su apertura lateral anterior. Pantalla completa no se cierra automáticamente.

El guard del workspace ejecuta el flush normal de pendientes antes de la transición; la nueva acción no promete conservar las notas sin guardar. `openDocument` devuelve `Promise<void>` tras resolver y despachar una callback void: no es ACK del guard asíncrono, un guardado confirmado ni un recibo de navegación terminada. Un fallo del guard conserva sus reglas anteriores. Códex presenta su **Modal global normal**, no un detalle confinado al companion; cerrarlo permite continuar con Source y Códex. No se prometen dos editores interactivos bajo ese Modal.

El fake headless añade `placement:'beside'` sólo para la petición explícita. Las anteriores conservan claves exactas y tres argumentos de callback. No se crean servicios, permisos, tablas, dependencias, overlay ni herramientas MCP. `wh_local_tool_reference_resolve` sigue resolviendo identidad/título/procedencia efectivos; no navega una UI headless.

## Evidencia atribuida a cada ejecución

Los recibos están bajo `_stage/sdk-selection-next/`; sus hashes y comandos conservan las ejecuciones originales. Este documento no vuelve a ejecutar ni fusiona resultados en una suite ficticia.

| Evidencia | Resultado y alcance |
| --- | --- |
| `implementation/DRAFT-FIX-REPORT.md`, `draft-fix-baseline-first.json`, `draft-fix-lease-first.json` | Host previo:4 grupos funcionales y3 originales de lease PASS tras el RED material de pérdida de borrador. Draft de companion exacto, hidden/retorno y negocio conservados; sin cambiar el oráculo histórico. |
| `implementation/CONTRACT-FIRST-REPORT.md`, `API5-FIRST-REPORT.md` | RED contractual y primera ampliación de cinco fuentes del puerto existente; el selector se añadió después como sexta fuente; historial de primeras ejecuciones conservado. |
| `implementation/PICKER-FLUSH-FIRST-REPORT.md` | El agregado exit1 completó baseline/contrato y ambos pickers EN/ES antes de fallar por exigir waypoint como raíz. No se presenta como agregado PASS. El test se alineó con el flush normal: revisión+1 y sólo sus cuatro hojas de metadatos/datos observadas. |
| `implementation/ROUTES-STATES-FIRST-REPORT.md` | Primeros focales de rutas y estados PASS, con raíz Worldgen positiva e hijo negativo, fallback, ámbito, consulta readonly y revocación antes del despacho. No hubo nuevo comportamiento waypoint. |
| `ROOT-css-scoped.json` y log | Exit0/3PASS: picker EN y ES conservan Source/Base/notas tras flush; CSS real1280/390, Tab nativo,40px, sin overflow y correlación del dispatcher registrado. Respuesta de `wh_local_tool_reference_resolve` coincide en ID/título/provenance Base con B visible. Cuatro SKIP explícitos de pseudo-foco por documento Electron sin foco. |
| `architecture-review/TECHNICAL-REVIEW.md`, `TECHNICAL-FIRST.json` | Revisor independiente:4 grupos PASS en una sola ejecución; opciones antiguas, fallback, rutas reales Source/Worldgen/Códex Base/variante, ausentes/foreign/ocultos y revocación durante lectura. Tablas completas exactas tras setup; no montaje ni flush certificados por ese focal. |
| `ROOT-node-first.json` y log |4PASS: claves/argumentos anteriores exactos, intención explícita Base/era readonly, ausentes/foreign sin despacho, author host Node sin aplicación/DB/red/IndexedDB. |
| `ROOT-original-gates.json` | Exit0 en manifiesto2 (941 herramientas), kit original4+bundle puro, lease3, workspace3 y Native1. El transporte Native original prueba su escenario compartido de estado, CAS/rollback/Undo; no es nuevo stdio externo, segunda clave ni prueba de presentación del botón. |
| `ROOT-product-gates-r2.json`, `ROOT-critical-incomplete-before-stop.json` | Quick, build y Electron build exit0. Crítica R2 quedó incompleta con394 PASS sin resumen y se retiró sólo su proceso propio tras la espera; causa desconocida. No se atribuye a HMR/optimizer/Worker ni se transforma en PASS. |
| `ROOT-critical-r3.json` y log | Gate crítico original completo: exit0,396 PASS,207.562s, sin timeout externo; fuente11,187protegidas yforeign2 exactos. Separado de R2 y de los diagnósticos aislados de los dos casos Journey finales. No se modificó fuente/test/worker/assertion original. |
| `ROOT-final-aggregate.json` y log | ROOT obtuvo agregado9 PASS en8.086s sobre oráculo RAW b12925f1; ese resultado previo permanece histórico y no elimina el FAIL formal posterior del mismo oráculo. |
| `formal-review/REVIEW.md`, `aggregate-first.json`, `VOTE-READBACK.json` | Revisión40 sobre commit6a39b5a6: changes tras primer agregado exit1/6.361s, sin líneas PASS finales; CSS/Node no iniciados. F1: igualdad entre Source.updatedAt y Project.updatedAt no contractual. ES guardó notas exactas/revisión3 con timestamps monótonos separados por1ms. No se reprodujo pérdida de notas ni defecto de navegación; no se demostró otro defecto en las seis fuentes por lectura/observaciones alcanzadas. Se solicita corregir sólo el oráculo a monotonía propia de cada registro y conservar notas, revisión única y comparación completa salvo las mismas cuatro hojas normales. La corrección y su nueva revisión se acreditan en los recibos finales siguientes. |
| `ROOT-brave-product.md`, DOM/JPG before/target/preserved/cold/original-open | Brave real1920 ES: formulario/selector normales, notas guardadas por el flush, Source conservado, Modal global del Faro, cerrar, recarga de página, Abrir original y Atrás al mismo Source. No se consultó IndexedDB para fabricar el resultado. |
| `ROOT-brave-keyboard.json` y JPG | Foco real sobre Ver al lado; `focus` y `focusVisible` true, contorno sólido2px rgb(213,181,117),40px. Separado del SKIP de Electron oculto. |
| `finish-review/FULL.md` | Acabado independiente SHIP, SHA256 `c57576c92e898b2e3a3a5846f3d1c7f72e19dcb130d795b730d143e5bc5c1eb5`; doce imágenes originales revisadas, sin nuevo bloqueo material. No voto CAS. |

## Imágenes y mundo conservado

Los ocho PNG `ui-evidence/local-tool-beside-{en,es}-{before,after}-{1280,390}.png` usan CSS real en Electron aislado. Before muestra la acción construida antes de consultar; after muestra el Modal global Códex. ROOT aporta JPG Brave1920 de consulta, paneles recuperados y foco. El documenter abrió cuatro originales representativos, registrados por SHA en `documentation/manifest.json`: ES390 antes, EN1280 después, Brave preserved y Brave keyboard. No recapturó ni ejecutó Browser.

La acción hermana mantiene carbón/oro, sans compacta, borde, radio, hover y foco incumbentes. A390 envuelve sin cortar el texto nuevo; el select Documento y algunos títulos heredados siguen estrechos. No se cambia esa composición ni se acredita Brave390, móvil, táctil o accesibilidad global. DESIGN y la superficie registran únicamente esta extensión; sin tokens ni sidecar regenerados.

## Incidencias y límites conservados

Permanecen las primeras fallas de identidad/borrador, el RED contractual, la expectativa inicial de notas sin flush, el positivo waypoint fuera del contrato, el launcher relativo y las ejecuciones CSS fallidas por foco oculto. No se borran ni se convierten retrospectivamente en PASS; los informes explican el arreglo de producto y las correcciones del oráculo por separado. La conversión accidental LF→CRLF de registry/Host durante API5 y su restauración posterior quedan en `implementation/EOL-RESTORATION.json`: bytes normalizados iguales; el primer GREEN mantiene sus hashes RAW anteriores y no se repitió por formato. Los avisos import.meta/iife, React act y red conservan su atribución; no se promete consola universalmente limpia.

La primera revisión formal40 añadió un FAIL real del gate nuevo: Source y proyecto emplean llamadas a Date.now/contadores propios, por lo que la igualdad de sus updatedAt no es contractual. EN coincidió; ES difirió1ms con ambos valores monótonos, revisión2→3 y notas exactas. El informe pide ajustar exclusivamente esa expectativa a la monotonía individual, sin reloj simulado, sustitución de valores, cambio del store ni retirada de las comprobaciones fuertes. La petición se resolvió exclusivamente en el test, con monotonía estricta por registro y el resto de las comprobaciones intacto; los resultados nuevos figuran después. El primer FAIL queda en `formal-review/aggregate-first.log` con SHA256 `e64da506bc36e1ca581d7220916a141bef3b1b09a4cc263a472190b86fe6adbd`.

El quick inicial encontró una exportación anónima en el wrapper QA ignorado. Se corrigió el paquete propio1.0.1 por pack/check/install y lint focal, pero Vite mantuvo compilado1.0.0. El segundo reinicio QA fue rechazado por revisión automática y no se eludió. Brave probó las seis fuentes nuevas con ese wrapper compilado1.0.0: no certifica arranque frío del servidor, catálogo/pin1.0.1 ni instalación nueva tras reinicio. El paquete QA queda fuera del commit.

Las referencias de investigación son [HostServices](https://docs.beta.vvd.world/workshop/reference/sdk#hostservices), [vínculos documentales](https://docs.beta.vvd.world/workshop/reference/tools#linking-to-other-documents) y [anatomía del proyecto](https://docs.beta.vvd.world/workshop/guides/project-anatomy), leídas el25-10-2026 y atribuidas en `FULL RESEARCH.md`. La observación web de Biblioteca/Switch Map no demuestra ejecución de un hook SDK beta. El contrato Writer es propio; su `apiVersion:1` y paquete0.1.6 no acreditan runtime, ABI, peek universal o paridad SDK global.1095 permanece abierta.

## Entrega y recibos confirmados

Las once rutas de fuente se entregan en `6a39b5a66f262e8b8e4bf744c3a367fcf36c2203` y `4068c11f263a86e5bac2c5cf87c4b752ff3b943c`. El segundo commit cambia una sola aserción del test, con autor/committer Luissalet e índice explícito. Las seis fuentes de producto permanecen exactas. Oráculo final SHA256 `89846dd40e8a36aa247e7b2ecb7c9a121dd08346aa167f67dee92db764eed3c1`, freeze `ROOT-freeze-source-v2.json`; notas, revisión única, comparación completa salvo cuatro hojas y prefijo histórico22805B preservados.

| Recibo en `_stage/sdk-selection-next/` | Resultado |
| --- | --- |
| `implementation/F1-REPORT.md`, `F1-aggregate-first.json` | Primera ejecución corregida9PASS,exit0/7.391s; fallo formal40 conservado. |
| `formal-review-r41/REVIEW.md`, `VOTE-READBACK.json`, `ROOT-formal-read.json` | Submission41 leída antes de probar: agregado9/CSS3/Node4 propios PASS; approve exacto de ambos commits y readback confirmado. |
| `ROOT-main-gates.json` | FF exacto bajo merge lock y HEAD fresco; once comandos exit0: quick/build/Electron, crítica original396, agregado9, CSS3, peer4, Node4, manifiesto2, nativecodec1 y lease3. Main limpio y merge liberado. |
| `ROOT-manual-receipt.json` | +380UTF16, revisión exigida; documento completo, otros párrafos, estilos y estructura exactos. |
| `ROOT-continuity-receipt.json`, `ROOT-common-release.json` | MEMORY conserva todos los bytes previos; grafo sólo nodo propio sin embeddings, otros nodos/aristas exactos; bloqueos comunes liberados. |

Los primeros PASS de ROOT siguen atribuidos a sus RAW previos; la corrección F1 no los convierte en repeticiones sobre el nuevo test. Main y revisión nueva tienen sus propias ejecuciones. No se repitió Browser, acabado ni detector por el ajuste de aserción o la prosa. Las nueve inserciones documentales conservan íntegros los bytes previos; la candidata r1 permanece en `documentation/history-r1/`.

La integración de documentación final y el cierre exclusivo de research1512 se confirman después en `ROOT-delivery-final.json`. Parent1095 y su worktree siguen abiertos, SDK/paridad general parciales. Sin push.
