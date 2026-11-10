# Audio espacial por cliente — 2505

Source `82eafc275ae6a03d1fd80a5042596ae8183bcdd7`, sucesor de `0b8a65c0` y base acumulada `47143f9a`, está aprobado en CAS 2505 revisión 2 e integrado en Main sin push. Source 2505, revisión 2513 y acabado 2521 están Done; el WT/rama Source se han retirado normalmente. Root completó Brave y Native sobre el corte final. Manual actualizado por Root; continuidad MEM/KG de SourceMap, transporte, precarga y espacial permanece en 2464 bajo su lease separada. No se declara paridad global.

## Uso

En un bloque Propio **Sonidos locales**, selecciona un audio local y elige **Estéreo**, **Equalpower** o **HRTF** en Modo de audio. Configura emisor y oyente X/Y/Z en metros. Giro del oyente usa grados alrededor de +Y: 0 mira a -Z y +90 a +X. Intro o salir del campo confirma un valor finito; Escape recupera el valor mostrado sin cerrar la ficha. Restablecer oyente recupera sólo su posición/orientación iniciales. Fuera del campo, Escape conserva el cierre normal del diálogo.

Configurar no reproduce ni crea salida. Play sigue disponible sin preparar o elegir espacial. Los cambios durante pausa conservan handle y posición, sin avanzar ni reanudar; el panorama estéreo se aplica después de la posición espacial. Volumen, buses, preparación, efecto/música, Stop, pausa/reanudación, búsqueda y niveles conservan sus flujos. Reload/reapertura vuelve a estéreo detenido con pose inicial y medios disponibles: posiciones/owners/handles son temporales, no playback guardado.

## SDK, hooks y MCP

`supportsSpatial` y `spatialModels` declaran modelos disponibles. Cada cliente/owner tiene su oyente virtual; el listener del contexto nativo permanece fijo. Dos hooks del mismo cliente comparten ese oyente. `getListener()` y `getSpatial(handleId)` devuelven copias pasivas sin registrar cliente, resolver, crear contexto/grafo o decode. `setListener(pose)` explícito registra/retiene su owner antes de Play sin abrir salida. Reset termina sólo esa retención y recalcula las voces restantes; Stop y liberar preparación mantienen significados separados.

`setSpatial(handleId,options)` es sustitución completa con defaults para opcionales omitidos; null vuelve a estéreo sobre el mismo handle. Para mover conservando modelo/distancias se extiende el getter completo. Posición/orientación son mundiales; forward/up se normalizan, defaults inversos refDistance 1/maxDistance 10000/rolloffFactor 1 y modelos nativos equalpower/HRTF. Datos o derivadas no representables se rechazan antes de aplicar parcialmente la pose o voces. Backend legacy/sin modelo conserva Play y responde false/null honesto; un Play espacial no soportado falla antes de admisión, sin fallback silencioso a estéreo.

Los hooks reconcilian la última configuración explícita con el ID exacto de SU Play pendiente antes de devolver/exponer ese resultado. No garantizan la primera muestra ya emitida al admitir. La ruta preadmisión es SDK/MCP sobre un handle loading observado. Retarget/abort/unmount invalidan la reconciliación; limpiar un hook no resetea el oyente compartido del otro.

`wh_local_audio_status` añade owners con pose/modelos y ownerId/spatial por voz sólo con includeSpatial:true; la forma ordinaria y flags posición/niveles/preparación permanecen. `wh_local_audio_control` añade listener/listener-reset por ownerId exacto y spatial por handleId/objeto o null explícito, en proyecto/era normales. No elige el primer owner ni difunde a todos. Lookup sin destino no fabrica cliente/owner o cola; IDs extranjeros son not-found, datos malformados bad-args y capacidad válida no disponible changed:false intacto. El owner frío de precarga no transfiere su pose a un SDK futuro que comparta buffer. [API y ejemplo](../../docs/local-tool-sdk.md#spatial-audio-for-each-owner).

## DSP y vida

Cada segmento espacial audible usa PannerNode real y conserva gain/bus/duck, panorama posterior y medidas. Bytes preparados pueden compartirse mientras cada voz tiene nodos propios. Pause/seek retiran fuente/Panner del segmento; resume crea otros frescos desde el offset retenido, también en HRTF. No se continúa historia convolutiva antigua ni se sustituye por bypass estéreo. Cambiar pose/emisor no repite el sonido; config en pausa/loading no inicia fuentes.

El gate independiente de volumen programa en reloj audio el final del recurso; loop/seek/resume reprograman y bus/duck/fades no borran ese cierre. Pause/stop/fin cortan la respuesta restante; un fade solicitado transcurre antes de cortar. Onended posterior libera recursos, no es un reloj JS sample-exacto. La política corta cola HRIR fuera de duración: no promete preservarla completa. El cierre idle puede invocar backend.close sin perder pose/buffer retenidos; el control custom Native acredita ese callback, no cierre físico de una salida Browser.

## Source y verificación atribuida

Ambos commits son Luissalet, mensajes ingleses sin trailers. R1 aporta 14 exports propios y 36 regresiones; seis focos DSP se ejecutaron antes de fixes puros posteriores de preflight/UUID, conservando sus inputs/atribución sin llamarlos repetidos sobre el árbol final. De las regresiones, 33 cuerpos son literales y 3 cambian sólo readiness/selectores de audio cargado, sin quitar asserts PCM/estado. R2 añade EscapeModal y repite Example: 15 exports distintos/16 pasadas del frente Source. No es una suite global.

F3 fue un defecto real observado por Root en Brave sobre 0b: Escape en una coordenada restauraba el valor pero propagaba al Modal y cerraba la ficha. Se preservan r1/corte 879, observaciones y RED. El único fix de producto es stopPropagation local en esa rama Escape. El mismo test normal con Modal/portal/cliente/medios pasa después y mantiene Enter/blur, handle pausado y DB; no modifica Modal global, DSP, SDK, MCP o estilos. El detector previo 0 no se repite por ese handler. Source 14 incluye tres regresiones de readiness explícitas y el test nuevo; no hay Source adicional en esta documentación.

Quick r2 y build r2 finalizan EOF 0 en 189,102/189,113 s, ambos 4748 inputs sin drift y hash 77baa40d572971f260af3643fb8dd67f9e69c08ac382a98d436969e9634896a7. Los avisos de empaquetado se conservan. Revisión 2513 aprueba exactamente submission 2/ambos commits y audita offline la evidencia; no se hereda un voto r1 ni se llama a la lectura documental una ejecución propia.

## Brave y acabado

Root conserva 14 observaciones, no 14 tests. Teclas nativas confirman borrador inválido «-», Escape que restaura 0 sin cerrar, Intro/blur con -2/0,5 y giro 90. Un gesto real HRTF muestra reproducción/posición/niveles digitales; pausa 9,48 se mantiene al mover emisor/oyente/giro y restablecer. Estéreo y panorama 1 se configuran pausado; al reanudar avanza y aparece señal derecha. En estrecho Equalpower reproduce/pausa/Stop. Escape fuera de coordenadas cierra y la recarga asentada vuelve a estéreo/pose inicial/pan0/detenido, conservando el archivo local.

La vista solicitada 378×820 mide realmente 420×911 CSS; scrollWidth 420 y diálogo 386/386, campos contenidos. Los tres JPEG reales muestran vista amplia y dos posiciones de scroll estrecho, no capturas de los timeouts previos. Root recuperó el compositor con activación normal de su propia pestaña, sin alterar página/imágenes o usar Desktop/IAB. El documentador ha visto los tres archivos guardados, sin abrir Browser ni hacer nuevas capturas. Acabado 2521 fue favorable dentro del alcance visual/UX, sin hallazgo material y sin convertirlo en auditoría de accesibilidad total/hardware.

Viewport restablecido 2133×956 CSS, pestaña cerrada/tabs[] y Vite PID 110416/listener 60835 detenidos normalmente CtrlC/Y/EOF 1. Consola r2 sin warnings/errores capturados; no se atribuye a r1 o a todos los contextos. Los resultados del navegador no son MCP autenticado directo a su IndexedDB ni igualdad global DB por UI.

## Native real final de Root

run-20261110T192845Z-a157bb82 sobre 82: warm PID 87068/cold 121036, EOF 0 y cleanup 0. Son 57+7 tools/call, 64 MCP/64 IPC; initialize/tools-list permanecen fuera de ese recuento. Cuatro claves genuinas revocadas 401 y cuatro stdio EOF 0/stderr vacío. Se conservan avisos import.meta del bundler warm; no se afirma stderr global vacío.

Default Browser antes de SDK/Play: una decodificación offline real y cero salida/grafo/start. Getter/status son pasivos y cold owner no presta su pose a otro cliente. El tramo custom posterior usa AudioNodes/decoder/OfflineAudioContext reales inyectados explícitamente: A/B y después voces positivas de era E propia/proyecto Q comparten coordinador/contexto, con nodos independientes y listener nativo fijo. No se afirma que cuatro voces suenen simultáneamente ni que ese backend sea salida Browser física.

Cuatro comparaciones modelo/posición resultan byte-exactas producto/Panner nativo directo, con coordenadas manuales y sin helper esperado del producto. HRTF cambia por elevación (peak 0,29708035) frente al control Equalpower vertical 0; HRTF y Equalpower también difieren. Transporte con procesadores frescos da peak error 2,91e-8 frente a referencia nueva; se mantienen PCM por canal, pan posterior, atomicidad multivoz, pendientes/pausa y negativas de scope/IDs.

El límite natural es 0,5 s. En la MISMA ventana 0,5+1 muestra→0,525 s, energía producto 0 y control nativo sin gate 8,145658e-5. Al observar DSPtime 0,8 el handle aún existía antes de ceder al callback y se retiró después; retención REAL medida 0,7 ms, bound 1000 ms. No es espera fija de 1 s, latencia interactiva, garantía de tiempo real o retiro sample-exacto de handle.

Root rehasheó 32 canales PCM y las entradas actuales de tres metafiles (129/119/4401) ANTES de retirar Source. Warm final/saved/cold conservan 89 tablas completas, Blobs y own-undefined exactos, mismo perfil/origin/tres builds y sin reseed. Cold probe 0/scopes vacíos, sin owners/poses/handles/cache/autoplay. Limpieza normal deja 89 tablas 0/perfil ausente, 7 ancestros/92 hijos sin reparse/procesos; no Force o perfiles rechazados tocados. Los helpers con paths del WT retirado no se vuelven a ejecutar para documentarlo.

El documentador escribió la preparación 2507, no se presenta como auditor independiente de su ejecución. Root ajustó y ligó su copia a Source final; el revisor 2513 hizo su lectura/auditoría aparte. Fixture compilada normal registrada en rendererbundle no equivale a SourceHost montado o paquete CLI instalado. No altavoz/HRTF perceptivo/curva universal ni igualdad con una ABI ajena.

## Integración, manual e historial

Root hizo un único FF 471→82 bajo merge lock. Catorce HEAD/índice exactos y 4734 RAW/índices ajenos/refs/URLs/ramas/untracked preservados, Main limpio, sin push. Trece RAW Source son idénticos; el test nuevo pasa de 60363 B/4 CRLF a 60359 B/LF en checkout, comprobado entero contra Git. El guard estricto falló POST merge 0; su recibo se conserva y no hubo segundo merge o rewrite Source/Main. El matiz pertenece a la verificación, no a un fallo de producto.

Source 2505 y peer 2513 están Done. Retiro normal Source: WT/admin/rama ausentes, 6 ancestros/42186 hijos y admin 9/8 sin reparse/procesos; Main 4748 RAW/índice/refs y WTs ajenos preservados. Un preflight anterior vio la shell exterior con literal WT y se detuvo antes de borrar; después de su EOF el mismo guard pasó 0 procesos antes del PRIMER remove. Sin relajar exclusiones, Force, reset o reintento de remove/branch; Research y perfiles históricos conservados.

Manual Root actualizado una vez con revisión fresca/CAS/readback: 619 UTF16 en 54060/tabt.0 y 870 párrafos antes/después. La comparación del recurso completo sólo admite la inserción prevista, con estilos/listas/elementos nativos intactos. El recurso completo antes/después se retiene en sesión de herramienta, no se inventa un artefacto completo en disco. Proposal/write/check y guard de target son los recibos locales; el documentador no repite Google. MEM/KG de los tres frentes anteriores más espacial sigue pendiente en 2464 bajo su lease.

Las dos cabeceras de inventario incorporan estado fechado con el texto previo íntegro bajo HISTORIAL; los checks antiguos no son nuevos diagnósticos. Rendimiento 2318 permanece open, sin aceptación del objetivo 100 ms; no hay benchmark de rendimiento compartido por esta entrega. 1095 es Done histórica y la paridad sigue en 1195/tareas nuevas. Sin cierre global ni porcentaje.

Fuentes: audio-spatial-source/{SOURCE-REPORT-r1.md,RETIRE-FINAL.json}; audio-spatial-source/r2/{SOURCE-REPORT-r2.md,SOURCE-CUT-r2.json,GATES-FINAL-r2.json,F3-RESULTS-r1.json}; audio-spatial-root/{BRAVE-RESULT-r2.json,BRAVE-r2-observations.json,BRAVE-r2-desktop.jpg,BRAVE-r2-narrow.jpg,BRAVE-r2-narrow-lower.jpg,NATIVE-r1-ROOT-AUDIT.json,INTEGRATION-SOURCE-FINAL.json,INTEGRATED-SOURCE.md,manual2505-check.json,manual2505-proposal.json,manual2505-write.json,LEDGER-CONTINUITY-NOTE.md}; audio-spatial-root/native-r1/run-20261110T192845Z-a157bb82/{run-receipt.json,cleanup.json}; audio-spatial-finish/{RESULT.md,CUT.json}; revisión 2513/CASr2 y task2318 consultadas en Ágora. Raíz Research: E:/Development/IA/Research/writer-parity-20261110. No nuevas suites/apps/Source/globales por esta documentación.
