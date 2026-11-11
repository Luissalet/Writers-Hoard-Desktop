# Lista vacía añadida a Source — 2540

Source `38db3169be1eb6193cd8c766d355615e2225b45e` (16 rutas) está aprobado en revisión CAS 3 e integrado en Main sin push. Quick r2, build, Native de Root y manual específico están acreditados. Esta verificación delimita esa entrega; no declara paridad global.

## Uso y contrato

La definición V2 mantiene los descriptores anteriores, declara `document`, añade `steps:{kind:'list',idKey:'key'}` y `sourceAdditive:{from,field:'steps',defaultValue:[]}`. `from` contiene namespace, codec, validationId y schemaEpoch completos del predecessor inicial. El validador admite el valor efectivo; no se infieren renames, cambios de tipo, defaults no vacíos, referenceKey o migraciones generales.

Seleccionar la versión y leer no escribe el campo, revisión, checkpoint o variante. El primer efecto usa las acciones list ya públicas y el writer Source normal, incluso desde V1 guardada sin Start. No-op, CAS obsoleto y validación fallida no dejan una promoción parcial. La promoción de V1 heredada conserva su rechazo; una V2 nativa usa las reglas de ownership de era existentes.

La vista Source puede mostrar `[]` cuando la fila es sparse. El reader de réplica de bajo nivel devuelve su data RAW: Undo de la primera autoría puede recuperar ausencia de propiedad. No se confunden esos dos DTO. Las inserciones tienen IDs estables; actualizar reemplaza la fila completa. El Undo propio conserva contribuciones de otro autor. Una clave MCP no es un autor de réplica y los receipts de sesión no persisten como Undo tras recargar.

Una entrega parcial normal puede ser retenida como pending y cerrarse al llegar el suffix. Un paquete FULL no se acredita como completo mientras falte historia. El contrato de copia mantiene los datos admitidos: JSON/duplicate crean una nueva rama causal; ZIP mismo-ID conserva checkpoint. Native acredita esa portabilidad acotada en la ejecución descrita abajo; no implica una migración general.

## Evidencia acreditada por ámbito

| Evidencia | Lo observado | Límites |
| --- | --- | --- |
| Root `source-list-root/BRAVE2540-RESULT-r1.json` | Proyecto aislado y cuaderno normal V1→V2; nombre/prior/contexto conservados, Enter/Add, editar/Escape/Save, checkbox, ordenar, eliminar/Undo/Redo, recuperar borradores y recargar. Vista420CSS sin overflow; tres PNG y DOM conservados. | Son observaciones UI, no tests ni Native. Receipts deshabilitados tras reload. Los primeros timeouts de captura se preservan sin atribuir un fallo de producto. |
| Root `source-list-root/F1-PARTIAL-ROOT-AUDIT-r2.json` | 67 checks SDK, EOF0 y cleanup89cero. Prefix sin gaps físicos con receive/reader pendientes; suffix-first pendiente; cierre en ambos órdenes a cápsula/datos exactos, replay y UndoA/B con ausencia RAW final. | Renderer privado, sin dos claves MCP. Input/stages no son PASS por sísolos. |
| Root `source-list-root/HISTORY2540-ROOT-AUDIT-r1.json` | 77 checks SDK y27 checks FULL, ambos EOF0/cleanup0: registros pre-D retenidos, header sustituido, placement borrado/retag, tx posterior incompatible, scalar post-D, V1 tardía y D competidor. Rechazos atómicos de JSON pendiente y ZIP pendiente/inválido en preview/import normal. | Focal privado. OldOrder usa una rama temporal independiente: no se acredita que fuera ancestro de D. No es Native. |
| Root `source-list-root/NATIVE2540-ROOT-RESULT-r1.json` | Source `38db3169`: warm 127 / cold 64 tools/call,191 MCP / 199 RPC / 191 respuestas IPC del puente, cuatro claves distintas, cuatro stdio EOF0 y cuatro revocaciones 401. SourceHost normal con hook/append/Undo y readonly frío. Base/E propia/F heredada, JSON con nuevos IDs/fork, duplicate IPC y dos ZIP con CRC/restore mismoID. | DOM programático, sin gesto Brave simulado. PID distintos y mismo perfil/origen/build sin reseed;89tablas warm/cold exactas,89cero final y perfil ausente. Scope Source, no paridad global. |
| `source-list-source/example-cli-r1/INSTALLED.json` | Seis pack/check/install normales EOF0, dos releases shipping reales y módulos V1/V2 conservados. | Instalación CLI solamente; SourceHost Native y UI Brave se atribuyen por separado. |

El ejemplo `examples.source-list-notebook` tiene V1 con nombre, lista prior y mapa other; V2 añade steps con idKey:key. La UI emplea el cliente/hook normal, borradores explícitos, readonly/busy y recuperación sin guardar. No se atribuye aquí una prueba UI de readonly por el solo hecho de que el código lo declare.

## Native y gates finales del candidato

Root ejecutó Native en `native-acceptance-r1/run-20261111T005644Z-055e7218`, driver EOF0. Warm PID 82380 y cold PID 125076 usan el mismo perfil/origen y builds, sin reseed. Las llamadas tools/call fueron 127/64; los RPC 131/68 incluyen initialize/tools/list. Warm registra además 16 peticiones IPC nativas auxiliares (`warm-receipt.json`, nativeRequests); se contabilizan aparte de las 191 respuestas de herramientas del puente. El Host monta el ejemplo shipping y su cliente/contexto normales: append/Undo con DOM programático en warm, componente readonly en cold. Brave real tiene su evidencia independiente; no se presenta ese DOM como isTrusted.

Las 89 tablas y sus filas guardadas coinciden warm/cold. JSON/duplicate crean ramas nuevas sin cambiar fuente/control; dos ZIP comprueban entries/CRC y roundtrip mismoID. Cleanup termina con 89 tablas vacías y perfil ausente, siete ancestros y 93 hijos sin reparse, cero procesos propios y sin Force. Se compilaron tres bundles para la ejecución; sus outputs se retiraron con cleanup y se conservan informes/hashes (4468 inputs físicos únicos/4701 filas de metadatos), no bundles vivos.

`QUICK2540-RESULT-r2.json` y `BUILD2540-RESULT-r1.json` registran `verify:quick` y build EOF0. El primer fallo de quick sigue preservado en Research; no se confunde con el resultado r2. Este documento resume recibos de Root; su autor contribuyó el arnés Native y no se presenta como auditor independiente de sus propios scripts.

## Source aprobado e integrado

Root aprobó la revisión CAS 3 de tarea 2540 sobre `38db3169be1eb6193cd8c766d355615e2225b45e`. `source-list-root/MERGE2540-RESULT-r1.json` registra un único FF a Main sin push, con 16 rutas Source canónicas iguales en disco/HEAD/índice, 4751→4761 tracked y archivos ajenos/índice/refs/remotos conservados. Se distinguen igualdad canónica de Source y RAW ajeno; no se afirma que 16 RAW con EOL mixtos sean idénticos sin normalización. La lease de merge quedó liberada.

## Manual, continuidad y límites

Root actualizó el [manual de uso](https://docs.google.com/document/d/1z095e_QAD2yaWAlJm6iclU-Tu4QF4Wyuz4iFFTmfpos) una sola vez con revisión estricta y relectura completa. `source-list-root/GOOGLE-MANUAL2540-RECEIPT-r1.json` registra 491 unidades UTF16 añadidas en t.0, índice 52920, con 874 párrafos y 79 definiciones de lista conservados. La inversión de la inserción recupera exactamente todo el documento; 873 párrafos ajenos y tamaño 12 permanecen intactos.

Root completó la continuidad MEM/KG específica de Source 2540: añadió 1335 bytes a la memoria sin alterar su prefijo y registró un concepto en el grafo de Writer mediante Store con `embed:false`. `MEMORY2540-RECEIPT-r1.json` y `CONTINUITY2540-ROOT-AUDIT-r1.json` acreditan el prefijo exacto y la conservación de las filas, BLOB y esquema anteriores. La continuidad combinada anterior 2464/2504 y el manual espacial ya están completados; no se vuelven a abrir por frases de sus verificaciones históricas. Rendimiento 2318 y los otros subcontratos no acreditados permanecen en seguimiento.

La tarea 1095 conserva su Done histórico y el trabajo hasta paridad continúa en hilo 1195/tareas nuevas. Esta ampliación no migra cualquier esquema, no cambia tipos anteriores ni acredita toda la plataforma. No se modifican verificaciones históricas para actualizar sus estados pasados.
