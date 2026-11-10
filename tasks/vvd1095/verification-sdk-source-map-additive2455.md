# Añadir un map vacío a una herramienta Source

**Estado:** Source16 b7e1215/submission4 está aprobado e integrado en main por FF, sin push. Root aceptó la función tras Native2 autenticado/cold, auditoría independiente y los dos ZIP finales importados en Brave. Native1 y el fallo de scaffold engineOrder se conservan; la repetición corrige sólo esa fixture, no el producto. Navegador y Native son bibliotecas separadas. Memoria y grafo permanecen pendientes de sus leases; ambos manuales SourceMap y Audio están actualizados por Root. El corte documental conjunto se somete a revisión por separado.

## Uso

Una nueva versión de una herramienta Source puede declarar un único campo `{kind:'map'}` con valor por defecto exactamente `{}`. El proyecto elige esa versión en **Gestionar motores → Versiones de herramientas locales**. Al leer el mismo documento anterior, el campo aparece vacío y se mantienen nombre, otros mapas y datos guardados. Leer, iniciar de nuevo o exportar un predecessor ya iniciado no materializa ese vacío ni sustituye su historia.

El ejemplo `examples.source-map-notebook` conserva `name` y `other` en V1; V2 añade **Comprobaciones**, con claves independientes cuyos valores son `{label,done}`. Añadir, marcar o quitar utiliza `map-set`/`map-delete` y el cliente normal. Nombre tiene Guardar y Descartar; los cambios guardados disponen de Deshacer/Rehacer de sesión. Un borrador se conserva si el cliente pasa a sólo lectura y ofrece Descartar local, sin habilitar Guardar. Root verificó en Brave R2 añadir, marcar, quitar, Deshacer/Rehacer, Descartar el borrador de nombre y recargar, incluida la primera comprobación de una V1 anterior y de un V2 nuevo sin Activar intercambio. El borrador recuperable en readonly describe el contrato del código; no se atribuye una transición UI a readonly a esa pasada.

Si existe checkpoint predecessor, la primera acción efectiva promueve y edita en la misma escritura, manteniendo genesis, generación y linaje. Si no existe checkpoint, prepara inicialización y edición atómicas, sin comparar un genesis anterior inexistente; conserva ID/generación/linaje y avanza una revisión normal. Un `map-delete` de clave ausente sigue siendo no-op: no crea transición, presencia ni historial nuevo. Deshacer la primera clave devuelve la ausencia raw y deja el vacío visible. Dos réplicas SDK pueden conservar sus claves independientes, incluso si B recibió primero la creación de A y escribió después: DeshacerA conservaB. Esto no convierte dos claves de acceso MCP en dos autores SDK ni concede Deshacer remoto al host.

## Declaración y límites

`sourceAdditive:{from,field:'checks',defaultValue:{}}` identifica el predecessor completo: namespace, codec, validationId y schemaEpoch observados. Sólo se admite un campo antes ausente, map simple sin flags de referencias/assets y default objeto vacío; los campos previos permanecen idénticos. Predecessor engine1, codec1, triple portable `sourceDefault`, engine8 y autoridad existente se mantienen. El descriptor del campo forma parte del hash completo; no es una capacidad concedida por ordinal.

No incluye renombrar, cambiar tipo/default, maps con referencias, varias adiciones, listas/rich, migradores arbitrarios ni promociones encadenadas. Los mapas ordinarios conservan su semántica. Un V2 nuevo o fork vacío puede empezar sparse por el creador normal y admitir su primera clave, sin exigir una promoción previa.

El soporte por claves se limita al map autorizado sin presencia inicial, comprobada en genesis/DAG. Una presencia explícita activa o su retirada conservan su efecto; no se usa un OR de claves que resucite un mapa oculto. F4 precisó que el preparador normal del núcleo `prepareLocalToolReplacement` puede producir presencia posterior legítima y su Undo debe seguir válido. Esto no habilita un nuevo `client.save`: el guard Source de Save para este perfil sigue intacto. Los gestos del ejemplo usan acciones.

F5 separó un registro `scalar` incompatible después de la transición: el reader independiente y receive deben rechazarlo antes de cambiar estado. También se conservó el camino ordinario que evita recorrer claves de mapas ocultos. Es una corrección focal; no acredita un benchmark o mejora global de rendimiento.

## SDK y MCP existentes

Leer la instantánea antes de actuar. Una acción ordinaria usa:

```ts
const snapshot = await client.read();
const edit = await client.state!.apply(snapshot, [
  {type:'map-set', field:'checks', key:'first',
   value:{label:'Revisar el viaje', done:false}},
]);
// Deshacer usa el recibo propio en la misma sesión y release.
if (edit.receiptId) await client.state!.undo(edit.receiptId);
```

MCP reutiliza `wh_local_tool_document_create`, `wh_local_tool_pin`, `wh_local_tool_read`, `wh_local_tool_state_apply/undo/redo` y `wh_local_tool_convergence_start/export/import`, con projectId/eraId/namespace/documentId reales. Pin usa contentHash y revisión observada; apply recibe el baseline completo. No se añaden herramientas por nombre ni se relaja CAS al tocar el campo nuevo. Réplicas públicas intercambian sus updates completos por import; un recibo remoto no concede Undo al host. No hay UndoHTTP nuevo, recibo duradero global ni reparación implícita al leer.

El reader sin paquete comprueba codec/hash/epoch/frontera, transición única y slots ancestrales, incluidos registros borrados o inactivos. Un writer V1 tardío, incluso retagged, una transición rival o un tail incompleto no eluden esa frontera. La validación de shape no sustituye al decoder semántico.

## Base, épocas y portabilidad

Una Base ya promovida puede iniciar el fork/COW normal en una época, con su historia propia y sin sustituir Base o una hermana. No se amplía la promoción directa de una época heredada V1 que el contrato anterior rechaza. El ámbito, readonly, pin, generación y recibos siguen las reglas existentes.

ZIP restaurado con el mismo ID conserva checkpoint/export. JSON con IDs ocupados y Duplicate a IDs nuevos conservan la vista admitida y codec/default, con genesis nuevo mediante fork semántico normal; no se trasladan recibos o historia causal antigua a esa identidad. No se parchean bytes opacos ni se cambian serializadores para aparentar continuidad. Las importaciones de esos ZIP en Brave se atribuyen por separado del MCP de una biblioteca Native privada; no son una conexión directa entre ambas bibliotecas.

## Evidencia de área ya conservada

Root observó el RED original `4a7b7521`: `local_tool_source_additive_invalid` al declarar V2, después de controles2088 y creación/edición normalesV1; snapshot89tablas exacto y cleanup0. El intento anterior `94afd818` fue setup por bundle generado ausente, no RED funcional. El test del corte14rutas tiene51739bytes/94edc991 y conserva como prefijos los46931bytes/e397 del map original y21263bytes/b610 de controles2088.

El autor registró GREEN `b8d0fdeb` del export original, EOF0/cleanup0/89tablas0, con proyección, promoción/abort/no-op, dos autores/órdenes/replay/Undo secuencial, frontera, CAS, V2 sparse/false explícito, dispatcher, épocas y copias normales. Dispatcher no es MCP autenticado y reabrir Dexie no es otro proceso frío.

El focal añadido conservó el RED `719073ad`: readerRejected/importRejected/unchanged eran false ante scalar posteriorD; después, `bc08b86a` pasó siete aserciones y mantuvo bytes del receptor en la negativa. Los dos setups previos de ese focal y un cleanup que esperó al shell se conservan; no se cuentan como defectos de producto. La revisión2467 precisa F4/F5 y aprobó el cuerpo14rutas9d504ca en el voto27721, limitado a Source y sin Native/Brave. El fallo legacy posterior exige un sucesor y otra lectura, sin modificar ese voto histórico.

El autor informa además regresiones de convergencia con232inputs estables y quick del core con tipos renderer/electron, lint0 y conformance34motores/64tablas/6723claves/22catálogos. Son recibos anteriores al último ejemplo: no se trasvasan a gates finales del corte14. Las dos versiones se empaquetaron/check/instalaron con CLI real; lint detectó dos reset effects del ejemplo, se retiraron por GO y se reempaquetó. Tras una sustitución del alias local de traducción rechazada por conformance, los releases CLI del corte9d son V1 `ebeac145…` y V2 `26dcc98a…`, observados también por Root en Brave. Los paquetes previos se conservan. El Source14 tuvo tipos/lint y delta conformance/build atribuidos con sus cortes; no se inventa un verify:quick final entero a partir de esa delta. El nuevo Source tras el fallo sin Start se fija después en CUT-SOURCE-r2 y sus gates actuales, sin reescribir esos recibos anteriores.

Este autor preparó el arnés2465 y los primeros cuerpos del ejemplo; no los autoaprueba como auditor independiente. Root aprobó sólo preparación textual2465r1 tras leer seis scripts y9artefactos/8inputs, con syntax checks sin ejecución de aplicaciones. Esa preparación se cerró conservando ready/sourceCutReady/nativeExecutionGO:false y no demuestra una ejecución Native.

## Continuidad pendiente

- Revisión e integración del corte conjunto de seis Markdown SourceMap+Audio por rutas explícitas, con cuatro prefijos originales exactos.
- Memoria y dos conceptos Writer: scripts r2 revisados por Root, sin captura ni aplicación; la lease MEMORY ajena sigue en coordinación. No se toma otro recurso ni se sortea ese conflicto. El manual ya está actualizado por Root.
- Retirada normal del WT/rama documental propio tras revisión e integración; Research y fallos conservados. La documentación se entrega ahora sin esperar a una lease global ajena: no condiciona la capacidad ya integrada a una futura aplicación de memoria.

Source, Native2 y Brave tienen aceptación acotada; el cierre documental no promete paridad global.

No se afirma paridad completa web/SDK, conexión directa MCP al IndexedDB de Brave, screenshot inexistente o uso de API externa/pagada. No se ejecutaron apps, pruebas nuevas o escrituras globales para esta entrega documental.

Evidencia local: `E:/Development/IA/Research/writer-parity-20261110/source-map-additive2455/` (PROPOSAL-r1, CONSUMERS-r1 y source-r1/REPORT-SOURCE-r1); `source-map-additive-final-review2455/` (BODY-REVIEW-r1, DEBATE2-F4/F5-VERIFY); `source-map-native-prep/` (CUT-PREP-r1 y aprobación/cierre2465); `source-map-continuity/` (plan, prefijos y comprobación documental).

## Fallo legacy observado en Brave y corrección

Root guardó normalmente una V1 sin activar intercambio; conservó nombre y otro map al elegir V2, que mostró Comprobaciones vacía. La primera inserción falló con borrador retenido y ninguna checkbox. Activar intercambio seguía disponible: el Source anterior no tenía checkpoint. stateRuntime tomaba el camino Save cuando current.convergence faltaba y el guard Source de sourceAdditive rechazaba ese Save. Los controles y el escenario original habían hecho StartV1 explícito, por lo que no cubrían esa ruta normal.

BRAVE-FAILURE-r1.md y los DOM originales conservan el fallo; no se cambian rótulos tempranos por PASS. Vite PID65880 se detuvo y el listener del puerto60833 quedó ausente; pestaña propia cerrada y biblioteca QA preservada para verificar el arreglo. No hubo Native autenticado o screenshot acreditados por esa pasada.

Root autorizó dos consumidores extra, stateRuntime.ts y documents/convergence.ts: sólo ante primera acción efectiva de Source aditivo sin checkpoint, preparar inicialización atómica del mismo documento; no materializar al leer, ni por no-op, validación fallida o aborto. No formato nuevo, reset de historia existente o CAS relajado. El corte9d aprobado no acreditaba ese flujo completo; el sucesor Source16 se verificó después en BraveR2, quedó en b7e1215 y recibió aprobación4 por2467; esa aceptación no borra el fallo anterior.

El escenario sucesor preparado en Research2473 conserva StartV1 como caso principal y añade V1 creada/editada sin Start antes de pinV2. Read/pin/no-op/invalidos deben dejar documento/historia sin inicializar; primer map-set debe pasar de checkpoint null a engine8 con una revisión e ID/generación/linaje conservados y Undo propio. V2 nativa también se incluyó sin Start previo en el sucesor preparado. No se exige comparar un genesis anterior inexistente. La enumeración dinámica de documentos, copias y frío incluye el tercer documento; ninguna infraestructura o script original2465 se cambia. Root leyó y ejecutó su copia después de fijar el nuevo Source; el cuerpo de preparación se conserva.

Recibo: E:/Development/IA/Research/writer-parity-20261110/source-map-additive-root/BRAVE-FAILURE-r1.md. Delta textual: source-map-continuity/scenario-successor.cjs y scenario-successor.diff; sólo preparación, sin parser/build/apps/Sourcewrites.

## Brave R2: flujo normal resuelto y límites actuales

Root reabrió bajo V2 el mismo documento que había fallado. Antes de editar, el panel público todavía ofrecía Activar; Añadir creó «Revisar el faro Ω» sin pulsarlo y el indicador pasó a activo. Se conservaron el nombre Unicode guardado y other.keep. Después observó marcar, Deshacer que desmarca, Rehacer que marca, añadir «Traer cartas 漢字», quitarla y Deshacer que la recupera conservando la primera marcada. Descartó un borrador de nombre y recargó: nombre, otro map y ambas comprobaciones persistieron. Creó también un V2 nuevo y guardó su primera comprobación sin Activar; volver al documento anterior conservó sus contenidos.

Un check() informó fallo sincrónico mientras el input estaba temporalmente deshabilitado por guardado asíncrono; la siguiente observación lo mostró marcado y no se repitió el clic. Se conservan ese estado intermedio y el fallo de la primera pasada. El registro conserva el fallo original y estados intermedios; sus observaciones no son todos casos PASS y después se amplió con las importaciones ZIP.

Se abrieron las cuatro capturas reales BRAVE-notebook.jpg, BRAVE-checks.jpg, BRAVE-narrow.jpg y BRAVE-narrow-checks.jpg. Las dos vistas normales originales tienen2370×1063píxeles; la solicitud estrecha378×820 produjo420×911CSS por zoom, con scrollWidth de documento420 y región de herramienta ancho/scrollWidth aproximadamente304. Los controles caben en esa región. Tab desplazó el scroll normal hasta las comprobaciones y Root restableció el viewport. No hay afirmación de dispositivo táctil, todos los estados visuales, edición readonly probada o nueva auditoría visual independiente del autor de los primeros fixtures.

BRAVE-SOURCE16-before.json fija16RAW del arreglo sobre HEAD9d todavía uncommitted. El autor completó source-r2/quick-r1/RESULT.json (verify:quick) y build-r1/RESULT.json con EOF0 y53inputs estables cada uno; son la pasada actual y no transforman los quick anteriores fallidos en PASS. El sucesor b7e1215 se aprobó después en revisión4; Native1 se ejecutó por Root y se mantiene con el límite de scaffold descrito a continuación. Este documentador leyó recibos/observaciones y vio imágenes retenidas, sin abrir Browser o ejecutar tests.

Referencias: source-map-additive-root/{BRAVE-R2.md,BRAVE-observations-working.json,BRAVE-SOURCE16-before.json,BRAVE-notebook.jpg,BRAVE-checks.jpg,BRAVE-narrow.jpg,BRAVE-narrow-checks.jpg}; source-map-additive2455/source-r2/{quick-r1,build-r1}/RESULT.json. Los scripts Native originales y scenario-successor se mantienen intactos.

## Source16 aprobado y primera pasada Native Root

El commit b7e1215c82bfb0efad6859e0fb482fe4b8e042dd sucede a9d504ca sin amend. Submission4/voto27732 aprobó16rutas, CUT-SOURCE-r2.json SHA0cdf43b4b360653cc2e9f402685ebaf138bd0286a90242a39e44c58fb6d4cf28. Test db84c2a9/65552bytes conserva94ed/e397/b610. La extensión añade stateRuntime y documents/convergence para primera acción efectiva sin checkpoint; read/no-op/invalid/abort no persisten candidato. Base y variante propia conservan ID/generación/linaje, incluida ausencia legacy; la primera escritura nativa heredada usa COW/generación propios. La promoción directa V1 heredada sigue rechazada. El quick completo y build actuales terminan0 con53inputs estables cada uno. Root y peer verificaron el corte; la aceptación final y la integración se detallan en su sección propia.

Root ejecutó Native1 run-20261110T120526Z-34898393 sobre b7e1215:130MCP/130respuestas bridge en warm y63/63 en otro proceso cold, mismo origin/perfil y coldReseed:false. Hay16peticiones IPC internas de duplicate aparte, no se suman a las193respuestas MCP. Cada fase usa dos claves distintas, luego401; cuatro adaptadores stdio terminan0 sin stderr. Se leen seis pasos CLI pack/check/install V1/V2 reales y sus hashes ebeac145/26dcc98a. SourceHostMounted:false, rendererObservations:[] y httpUndos:[]: esta ejecución no acredita UI montada ni UndoHTTP de Source. Cold termina con89tablas0 y el cleanup propio registra0procesos,0reparse, perfil ausente y noForce.

Después Root detectó que el scaffold mínimo del proyecto omitía engineOrder, requerido por Overview: la pasada preservada conserva su resultado de Source/CLI/transporte, pero no prueba Overview completo. Se prepara/repite un sucesor que sólo añade ese campo normal antes del creator, sin relajar el oráculo ni cambiar Source. Este era el límite al leer Native1. Native2 y el recibo final que se detallan debajo cierran esa aceptación acotada; no convierten el scaffold original en correcto retrospectivamente.

Lecturas documentales: source-map-additive2455/source-r2/REPORT-SOURCE-r2.md; run Native1/{run-receipt.json,warm-receipt.json,cold-receipt.json,cli-receipts.json,cleanup.json}. El presente autor preparó fixtures y arnés, y no se presenta como auditor independiente de esa ejecución.

## Aceptación final: Native2, ZIP en Brave e integración

FINAL-ACCEPTANCE.md/json acepta esta función sobre b7e1215, sin porcentaje de paridad global. Root verificó16RAW/índice/HEAD,4rutas del sucesor,4725blobs ajenos y149artefactos/53inputs. INTEGRATION-SOURCE-FINAL.json registra FF9b805a19→b7e1215,16Source RAW exactos, índice=HEAD, remotes/untracked preservados, main limpio y sin push. La rama documental se compuso después por FF privado; no se editó main desde esta tarea.

Native2 run-20261110T121122Z-efbbe2b9 sólo cambia41bytes del renderer de fixture: engineOrder igual a enabledEngines, como el creador normal. Los otros cinco scripts y SOURCE-CUT, acciones/aserciones/oráculo, permanecen exactos; no se reparan exportaciones. WarmPID98780 y coldPID34676 son procesos distintos, mismo perfil/origin/builds y sin reseed. Son130+63llamadas MCP autenticadas y193respuestas bridge, más16IPC internos de duplicate separados, HTTPUndo0; cuatro claves distintas revocadas401, cuatro stdio0/stderr0. Seis CLI reales pack/check/install0 instalan los bytes shipping ebeac145/26dcc98a; bootstrap normal expande29archivos de cinco globs19/5/5/0/0. SourceHostMounted:false, no aceptación UI por Native.

La auditoría independiente2467 NATIVE-RESULT-REVIEW-r2 es favorable:193tools/call y193IPC,8RPC initialize/list aparte,5negativas esperadas,19capturas quietas completas, DTO/snapshots íntegros y copias de grafo completo80tablas,18rootproofs y12history por copia. Biyecciones1proyecto/2eras/3Source/5generation/1variant/12history; defaults4 normales explícitos. Cada ZIP final tiene30entradas físicas,18archivos/12directorios, CRC/hash completos sin duplicados y restauración normal mismoID. Cold mantiene estado y limpieza89tablas0/perfil ausente/0procesos propios/sinForce. El auditor no es este preparador de fixtures/arnés; sus comprobaciones offline no son nuevas suites de producto.

Root importó ambos ZIP Native2 por Home→Importar proyecto y chooser normal en Brave. Los dos abren Centro creativo sin el loadError del scaffold anterior. Cuaderno lista tres documentos; Base muestra nombre Unicode, ambos valoresother y B marcado; E añade Sólo época y F hereda Base sin esa entrada. F de la copia JSON se comprobó tras reload y URL de esa era. La observación inmediata Native2-ZIP-json-F todavía mostraba E por navegación asíncrona; reload-F-settled es el estado aceptado. Un primer wait de botón tras importar fue error de observación porque la importación ya había abierto el proyecto, sin repetir import. Native1 también conserva lectura de vacíos legacy/nativa y ambos ZIP Base/E/F; no se confunden los archivos entre pasadas.

Los intentos de screenshot Native2 expiraron en Page.captureScreenshot: no se afirma JPEG nuevo. BRAVE-imported-era.jpg es una imagen real de Native1; BRAVE-notebook/checks/narrow son la UI directa Source16. No se afirma consola global limpia: se observaron errores de extensión Zotero, sin atribuirlos al cuaderno. Las pestañas propias se cerraron y viewport se restableció. Dos sesiones Vite propias terminaron por Ctrl+C con EOF1 esperado; PIDs108024/102636 y listener60833 ausentes, lease app liberada. La biblioteca sintética Brave permanece separada: sus datos no forman parte del cleanup89 de Native. Sin cobertura de medios/assets, tacto físico o IME.

Referencias finales: source-map-additive-root/{FINAL-ACCEPTANCE.md,FINAL-ACCEPTANCE.json,INTEGRATION-SOURCE-FINAL.json,BRAVE-observations-working.json,NATIVE-R2-PREPARATION.json}; native-r2/run-20261110T121122Z-efbbe2b9/{run-receipt.json,warm-receipt.json,cold-receipt.json,cleanup.json}; source-map-additive-final-review2455/NATIVE-RESULT-REVIEW-r2.md. El manual fue actualizado por Root con revisión fresca y verificación; memoria/grafo siguen pendientes de sus leases y GO separados. No hay escrituras globales desde este cambio Markdown.

El manual conserva una única inserción Root de572UTF16 en el párrafo SDK, índice47734/tabt.0;832párrafos en aquella lectura, inverso del recurso entero y estilos/listas exactos según manual2473-check.json. Source2455 está cerrado y su WT/rama retirados normalmente: RETIRE-FINAL.json acredita6ancestros/42178hijos,0reparse/0procesos,16Source-main exactos y demás WT/remotes preservados, sin Force. Research permanece. Memoria/grafo quedan expresamente pendientes; la documentación se entrega ahora y su revisión/integración/retirada tiene recibos propios. El manual Audio posterior quedó en834párrafos con643UTF16 añadidos e inverso entero exacto; no se repite Google.

La ampliación Audio ya integrada sólo añade26líneas a docs/local-tool-sdk.md respecto al corte SourceMap; los otros15blobs permanecen exactos. El guard externo r2 permanece histórico e inmutable y no se ejecuta contra ese sucesor. Research propone un guard cerrado que exige el SDK completo0e y su inversión literal al blob anterior, más los15blobs/RAW exactos y los11Audio aceptados; no se finge que el hash SDKb7e siga siendo actual. Esa adaptación y cualquier baseline/aplicación requieren una fase revisada aparte. Véase [transporte de audio](verification-sdk-audio-transport2475.md).
