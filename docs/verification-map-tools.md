# Herramientas Source contextuales de mapas

Source2382 revisión2, commit `27b4e398b872112ec1e1f109a59a7877f5626bd4`, aprobado formalmente e integrado por Root en main bajo merge lock, sin push. Los17RAW/blobs de índice,4711blobs ajenos, remotos y untracked permanecen exactos y main limpio, según INTEGRATION2382-FINAL.json. Native real final warm/cold, auditoría independiente2441r1, aceptación Brave y revisión visual2443r1 están aprobados para esta capacidad. La primera entrega documental2444 está aprobada e integrada como `e0c419944445eeb6dda8197d818a8c5362a74a89`; la actualización final de estados tiene su revisión e integración propias.

## Uso

En Maps o World Generator, abre **Tools for this map / Herramientas para este mapa**. Selecciona una herramienta compilada habilitada, escribe un título y crea un documento o abre uno existente del mapa actual. Puedes mantener varias revisiones independientes del mismo mapa. **Open in Source** abre el mismo documento mediante su ruta normal.

El ejemplo **Map review / Revisión de mapa** mantiene notas ricas y permite registrar la versión real del mapa como revisada o deshacer ese cambio. Usa Guardar/Descartar y Deshacer normales. El panel informa Base o Época actual y, cuando procede, herencia de Base. Los documentos siguen las reglas normales de Base, variantes de época, ocultación y copia al editar. Un mapa distinto no retargetea el documento ya abierto: la vista conservada pausa su edición hasta resolver el contexto.

Fullscreen conserva el contexto, la autoridad y la sesión local. Un borrador o fallo de guardado no desaparece por cambiar de mapa: la navegación usa los pendientes normales y existe recuperación deliberada del intento propio fallido. No borra borradores ajenos. Una operación admitida antes de perder el contexto no promete un rollback posterior al commit. Una vista histórica o readonly muestra las notas actuales guardadas sin editarlas; no muestra una supuesta versión histórica de las notas.

## Contrato del autor y MCP

El descriptor optativo `mapPanel` declara `version:1`, `targetField` de tipo reference y una lista no vacía de tipos permitidos entre maps/worldgen. El target inicial es null. Se valida y conserva el descriptor de la definición compilada realmente seleccionada y de su pin; una versión distinta no se adopta automáticamente. La herramienta recibe el contexto real de mapa, versión, procedencia, época y readonly. Se reutilizan SourceDoc, codec, escritor, recibos, history y portabilidad existentes; no se añade una tabla paralela.

La creación normal admite `initialActions` ordenadas, sólo set, por el mismo merge/codec/validador del autor. Documento y referencia del mapa se crean en la misma transacción y revisión inicial. Una asignación inválida o una segunda acción fallida no dejan documento ni recibo parcial. Omitir el campo o [] mantiene defaults; null explícito es inválido. Las guardas se revalidan dentro del RW; la admisión y el evento IDB complete no se confunden con rollback.

| Ruta normal | Comportamiento |
| --- | --- |
| `wh_local_tool_document_create` | Acepta initialActions y conserva creación atómica; no convierte null en ausencia. |
| `wh_local_tool_describe` | Devuelve el mapPanel de la definición seleccionada. |
| `wh_local_tool_map_list` | Consulta objetivos efectivos, herramientas, documentos vinculados y hosts realmente montados en el ámbito; target opcional limita el catálogo. No crea, monta ni flush-ea. |
| `wh_local_tool_map_open` | Recibe hostId vivo, target, namespace, documento y expectedContentHash exactos. La selección pasa por pendientes normales; available:false no inicia la app ni encola trabajo. applied expresa admisión, sin acreditar paint. |

JSON/import normal, duplicado CAS y ZIP remapean las referencias tipadas hacia los IDs reales de la copia. Conservan valores literales, codec, historia y datos fuente/control mediante los serializadores existentes. No se reclama cobertura nueva de overlays, proyección geométrica, gestos del lienzo o ABI de otro SDK. Journey/Trade, la portada de mapa y las nueve herramientas builtin conservan su ámbito anterior.

## Evidencia Source y revisiones

Source2382 tiene17rutas (15producto/2tests), con4711blobs ajenos exactos sobre main3f862. El r1 `b49b1536` permanece intacto, incluidos363artefactos y todos los fallos de desarrollo. El r2 `27b4e398` es un commit sucesor, sólo módulo ejemplo y cinco líneas añadidas al test; las otras15rutas permanecen exactas. No hubo amend ni rebase posterior. Las cuatro rutas MCP aportadas por Root tienen lectura independiente del autor; Root revisó el resto y el corte final. No se presenta la contribución Root como revisión independiente de sí misma.

El autor pasó el oráculo público original a698 intacto (30checks), descriptor/null/[], portabilidad JSON/duplicado/ZIP/Base/E/Undo y seis funciones legacy; UI8final358checks; ejemplo real readonly Base/E con nota/markup/fullscreen, edición DOM, mismo nodo+borrador conservados, Discard y snapshots íntegros; quick final0 (renderer/Electron/lint/conformance). Los distintos gates conservan sus hashes y deltas causales; no son una suite global nueva. Tras el único changes UI r1 por el UUID visible, r2 repitió sólo el focal del módulo real con cuatro grupos PASS, EOF0/cleanup0/17inputs estables, lint focal0 y diffcheck0. Las aserciones previas quedan exactas y el test añade panel/fullscreen Base/E, ausencia de ID y herencia real.

## Native real de Root

Run final: `map-tools-native-root/final-source-r2-preparation-r4/run-20261110T065935Z-689f48fa`, sobre27b4e398. Dos procesos distintos en el mismo perfil/origen; warm123MCP/124respuestas bridge y cold166MCP/166respuestas. Total289MCP y290bridge, incluyendo un UndoHTTP normal;17solicitudes nativas internas de duplicación, en cuatro canales, se cuentan aparte. Cuatro adaptadores stdio EOF0/stderr0 y cuatro claves distintas revocadas401. Las claves no representan autores independientes.

Se verificaron creación/lectura/estado/Undo normales, negativas sin cambios parciales, CAS, host contextual real y readonly, grafos portables completos, JSON normal con IDs ocupados, duplicado/Undo/replay y dos ZIP normales. Cold conservó DTO/snapshot y bindings remapeados con hosts readonly reales, sin reseed, usando los bundles cálidos. El último proceso contó las89tablas vacías. Perfil propio retirado normalmente: siete ancestros,93hijos, sin reparse,0procesos ni force. El autor documental lee recibos; no vuelve a ejecutar Native ni rehashea bundles ya retirados. La auditoría independiente2441r1 fue leída y aprobada por Root, con8artefactos/111inputs exactos:48DTO y snapshot cold completos,36montajes readonly. Su equivalencia declarada de ausencia/ownundefined no equivale a JSON bruto byteexacto; el auditor no rehashó íntegramente todos los inputs de compilación ni bundles ya retirados. El recorrido real de limpieza se distingue de su comentario descriptivo. No es otra ejecución Native.

El primer Native sobre el mismo Source permanece warmFAIL y no acredita cold: su observador no esperaba cuatro defaults normales del proyecto (`publishedEditionRevision`, `workspaceFolders`, `workspacePlacements`, `workspaceRevision`). Se conservan66MCP/67bridge, sus dos claves401,89tablas0 y retirada propia. La corrección r4 del oráculo fue revisada antes de la ejecución nueva, sin cambiar producto ni eliminar campos arbitrariamente. No se reetiqueta ese fallo como PASS.

## Brave real de Root — aceptación final

Root importó normalmente los dos ZIP Native y comprobó notas independientes Base/A2/E, nota actual visible en vista histórica readonly y fullscreen, pending-flush y Save and return; cruce Maps/Worldgen en E, target Base oculto en E y target sólo de E, deep link en E y Open in Source. El JSON importado conserva A-two en Base, A-one propia en E, B oculto y F heredada; tras reload se reabre A-one por su botón normal en F y mantiene la nota Base. No se promete persistir la selección del panel tras recargar. Cada ZIP tiene25archivos y18directorios:43entradas físicas, todas con CRC válido. Las bibliotecas Brave y Native se transfieren por ZIP explícito, no por un supuesto MCP directo al navegador.

El panel a420×920CSS mide364px de clientWidth y scrollWidth, con22controles dentro: no es una afirmación sobre todas las barras o lienzos del programa. Los controles nuevos principales miden40CSS. La revisión visual independiente2443r1 leyó tres PNG y no encontró un problema material; M1 es un detalle menor heredado del input común Local image, sin pérdida funcional demostrada. Root cotejó sus cuatro artefactos y aprobó el informe; no se le atribuyen gestos ni Native.

BRAVE-observations-final.json conserva33observaciones (lecturas, no33casos independientes); FINAL-ACCEPTANCE2382-CHECK coteja16estados cargados y los cortes independientes. Dos lecturas tempranas rotuladas A2-auto-flush aún muestreaban A saliente, incluso la rotulada confirmed: se conservan intactas y la autoridad estable posterior map-B-retains-A-paused acredita A2 guardada. No se reescribe el histórico para atribuirles ese valor. El primer selector de archivo agotó su espera antes de seleccionar; el segundo registro sí capturó la selección y se observó una importación. Los timeouts de control se resolvieron comprobando el estado, sin atribuirlos a pérdida de datos.

Las observaciones y capturas pertenecen a Root. El locale observado es en; la copia española figura en Source y en el focal que acepta las etiquetas declaradas. Dos errores de conexión del búfer final pertenecen a la extensión Zotero, chrome-extension://; no se observó error del origen app en ese búfer y no se afirma una consola global vacía. Root cerró su pestaña, restableció viewport y paró Vite propio PID105648/puerto65492 tras Ctrl+C (EOF1 esperado); no quedaron proceso ni listener. Los fixtures sintéticos permanecen en su origen aislado. No se tocaron perfiles reales ni datos reales.

## Continuidad y cierre Source

El manual ya fue actualizado por Root mediante una lectura fresca, una escritura CAS y una relectura completa:829párrafos/828ajenos exactos, párrafo412/tabt.0/índice41726 y+621UTF16. Estilos/listas/recurso inverso y revisiones antes/después son exactos en MANUAL2444-CHECK.json. Este autor no repitió Google; los baselines816/799 son históricos.

Tras leer plan/payloads/script/API y cotejar27inputs y baselines completos, Root dio GO concreto al corte externo dbc52095. El autor ejecutó una sola vez apply-external.py con el Python de Faustus: EOF0/stderr0, sin producto/apps/modelos. Un append de4102bytes dejó memoria1906285→1910387, con prefijo y sufijo completos exactos, SHA final1228c18bf9173124b9120a5fbe4e4485c4251121f5f4ecf18006ff3617858239 y marcador único. Dos Store.upsert_concept normales con embed=False dejaron407conceptos/9aristas/701historiales; las405+9+699filas anteriores y schema se conservaron exactos. Los dos conceptos nuevos tienen embeddingNULL y dos historiales create/beforeNULL/after igual al recibo; ninguna arista explícita nueva. No existe una transacción atómica entre archivo y ambos upserts: los recibos incrementales registran el orden real. FINAL-RECEIPT y APPLICATION-EXIT son PASS; después se liberaron ambos leases globales.

Source2382 quedó Done tras integración y coordinación documental. Su autor original retiró únicamente writer-map-tools2382 y codex/map-tools2382 por git worktree remove/git branch -d normales:6ancestros/41887hijos inspeccionados sin reparse,0procesos, limpio/ancestro de main,17Source RAW/índice exactos y main/ajenos/remotos/untracked intactos, sin force/push. El texto inicial del cierre decía8ancestros por transcripción; se conservó y se corrigió públicamente, con los recibos ejecutados siempre6 y sin repetir la retirada. Research y los perfiles históricos rechazados wh-inline-review-7oayFi/finite-debug permanecen; no se intentó retirarlos ni se afirma limpieza total. Los leasesSource quedaron liberados. DocsWT2444 se conserva para revisión e integración de este estado final; tiene ciclo de retirada propio.

Referencias bajo `E:/Development/IA/Research/writer-parity-20261110/`:

- `map-tools-source2382/CUT-r1.json`, `ARTIFACTS-r1-final.json`, `CUT-r2.json`, `SOURCE-SUBMIT-r2.md`, `r2/DELTA-r2.diff`, `r2/ORACLE-DELTA-CHECK.json`, `r2/LINT-r2.json` y `MCP-INDEPENDENT-REVIEW-final.json`.
- `map-tools-source2382/observations/20261110T060835Z-testActualMapReviewReadonly-863fab2c/RUNNER.json` y `cleanup.json`; los seis gates anteriores están referenciados por el corte r1.
- `map-tools-mcp-root2382/APPROVE-SOURCE2382-r2.md` y `SOURCE2382-ROOT-INPUT-CHECK-r2.json`.
- `map-tools-native-root/FIRST-NATIVE-FAILURE-CHECK.json`, `APPROVE-PREPARATION2432-r4.md` y el run final citado: `run-receipt.json`, `warm-receipt.json`, `cold-receipt.json`, `cleanup.json` y dos ZIP.
- `map-tools-native-root/APPROVE-SOURCE2382-FINAL-r2.md`, `INTEGRATION2382-FINAL.json`, `FINAL-ACCEPTANCE2382-CHECK.json`, `APPROVE-NATIVE-AUDIT2441-r1.md` y `APPROVE-VISUAL2443-r1.md`.
- `map-tools-native-root/BRAVE-REPORT-r1.md`, `BRAVE-observations-final.json`, `BRAVE-duplicate-era-E.png`, `BRAVE-historical-note.png`, `BRAVE-panel-narrow420.png`, `BRAVE-json-inherited-panel.png`.
- `map-tools-native-root/MANUAL2444-CHECK.json`, `GO-EXTERNAL2444.md` y `EXTERNAL2444-PREP-ROOT-CHECK.json`.
- `map-tools-continuity2444/external-prep/CUT-EXTERNAL-PREP.json`, `PLAN-EXTERNAL.md`, `apply-external.py`, `PREFLIGHT.json`, `MEMORY-RECEIPT.json`, `STORE-RECEIPT-1.json`, `STORE-RECEIPT-2.json`, `GRAPH-AFTER.json`, `FINAL-RECEIPT.json`, `APPLICATION-EXIT.json` y `GLOBAL-LEASE-RELEASE.json`. Las propuestas previas y el borrador se preservan como historia, sin reescribir sus estados.
- `map-tools-source2382/retire2382/RETIRE-2382.json`, `DONE-RECEIPT.json` y `COUNT-CORRECTION.md`; `map-tools-native-root/INTEGRATION-DOCS2444-FINAL-r1.json`.

No se declara cierre1095, rendimiento100ms, paridad completa, generación/servicios externos ni snapshot histórico de las notas. La capacidad está aceptada e integrada y la continuidad externa está aplicada; la revisión/integración del estado documental final y la retirada propia de DocsWT conservan sus pasos pendientes.
