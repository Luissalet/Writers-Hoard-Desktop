# Menús contextuales propios del SDK — 1095/1501

El editor Source y el editor antiguo admiten un menú opcional del host. Se abre mediante clic derecho, Shift+F10/ContextMenu o Acciones. Es plano: acciones, etiquetas y separadores, estados disabled y variante destructive. No guarda datos al abrir/cerrar; las acciones usan los clientes y operaciones existentes.

## Uso normal y contrato

Habilitar **Contador contextual** en el gestor de motores y crear o abrir su documento Source. El módulo compilado no se habilita automáticamente. Incrementar y Restablecer funcionan tanto desde botones como desde el menú. Deshacer/Rehacer aplica los recibos obtenidos por ese montaje; no promete Ctrl+Z ni adopta el historial de otra instancia. El módulo tiene catálogos propios EN/ES.

La [API pública](../../docs/local-tool-sdk.md#optional-host-context-menus) ofrece `useLocalToolContextMenu(context)` y el puerto `open(event, entries, {label}): boolean`/`close()`. La copia pertenece al host y no congela el input del autor. El callback sólo se invoca después de retirar el popup y devolver el foco al trigger. Los puertos y selecciones revocados no adoptan otro montaje, release, época o documento. Esto no cancela ni deshace efectos arbitrarios de un callback que ya empezó.

Sin host o ante una solicitud inválida, `open` devuelve `false` sin consumir el evento. El grabador/fake mantiene metadatos detached sin DOM/eventos/callbacks y no ejecuta acciones. El popup no se guarda en JSON, ZIP, estado o capturas publicadas. No se añade tool ni permiso; [describe/call/Undo/Redo existentes](../../docs/AI-BRIDGE.md#operaciones-del-ejemplo-de-menú-contextual) muestran y ejecutan operaciones normales, nunca callbacks serializados.

## Evidencia conservada y atribución

La entrega del autor conserva `implementation/FREEZE15.json` y `REPORT.md`, con quince rutas y guardas de los originales. ROOT congeló dieciocho rutas r1 en `ROOT-freeze-final.json`, SHA256 `ee82d6b244c341a6ad2558bb01bddfab8643222cf670b3e190b9bbf24f6296fc`: autor15, test independiente, runner y plan. Es el baseline técnico histórico, no un hash de commit. La fuente final es `d6d2e1b4d93701c024ec486e230ddc49d2920acd`, dieciocho rutas, con freeze r4 `c9ca03db1899090fa6b6a7bafb581d3e7d1292fb1cbeb0e007b67835bbc57b53`.

| Evidencia | Resultado y alcance |
| --- | --- |
| RED de presentación | Source real y menú existente como controles positivos; `RED-host-first`→`GREEN-host-first`, mismo archivo completo en esa fase. |
| RED tour/menú | Primer Escape cerraba el tour. Mismo oráculo GREEN tras guard DOM sólo para popup SDK visible; controller/store/nueve TOURS intactos. |
| RED realm independiente | Trigger conectado de iframe real rechazado por constructor global. Mismo archivo completo GREEN con ownerDocument; Node/PointerEvent exterior sólo se alcanzó en GREEN, sin inventar otro RED previo. |
| RED orden callback | Dentro del callback el popup seguía en DOM. Mismo oráculo GREEN tras retirada síncrona; foco restaurado antes de invocar. |
| Autor CSS final | Agregado de 10 grupos, un renderer; Source/legacy, alcance, teclado, tour, errores, recibos y orden de selección. |
| Autor Node | 6 grupos: grafo público/fake, CLI pack/check real y test público del módulo. No es instalación de paquete E2E. |
| Autor Native | 1 grupo: ejecutor→IPC→handlers y recibos; anterior al último ajuste de activación/DOM del presentador, sin presentarlo como repetición exacta posterior. |
| Autor originales | Guided: 15; SDK tours: 10; headless: 5; archivos intactos. Guided/SDK se ejecutaron tras el guard y realm, antes del último ajuste DOM/activación; atribución temporal conservada. |
| Revisión técnica independiente | 2 grupos CSS y 1 Native propios sobre las 18 rutas exactas, sin hallazgos técnicos abiertos; `architecture-review/TECHNICAL-REVIEW.md`. No es aprobación formal/CAS ni revisión visual. |
| Visual del autor | Cuatro PNG EN/ES1280/390 con CSS productiva, abiertas; warm frames excluidos. No son Brave390 ni móvil, ni acreditan el contraste destructive habilitado. |

Las tandas no se suman como capacidades ni paridad general. El informe del autor conserva fallos de fixtures y avisos de act/Network Service. En Electron oculto, un control HTML positivo probó keydown sin click y foco sin focusin automático; los dispatches finales prueban sus listeners, no la continuación visible normal. No se debilitaron los oráculos causales para ocultar esos límites.

ROOT observó Brave real: Source A con Enter de 0→1, Tab→Deshacer, Shift+Tab→Restablecer, clic derecho/Escape→Cuenta, Shift+F10/Space de 1→2, cierre al mover el foco fuera sin pointer y Undo de 2→1/Redo de 1→2. Source B en companion pasó de 0→1 manteniendo A en 2 y un solo popup. La recarga fría de ambos confirmó cuentas 2/1, títulos A/B y cero popups; el historial local del montaje no se presenta como persistente. La confirmación F1 de ROOT hizo A2→Restablecer0→Deshacer2; se cerró el companion sin borrar B. Son observaciones de montaje y datos propios, no instalación de paquete ni ejecución upstream. `ROOT-brave-results.md` conserva los incidentes de lectura y arranque.

ROOT conserva quince gates r1, todos exit0, en `ROOT-source-gates.json`: quick/build/Electron, crítica396, manifiesto2, Node6, CSS10, Native1, SDK original6, author Node5/CSS2 y tours Node4/Native1/CSS10/global15. Son tandas de ese baseline, no otra batería completa sobre r4. Después de F1, `ROOT-F1-checks.json` acredita lint0, CSS10 y visual1; las cuatro PNG Electron y las dos Brave fueron abiertas para la revisión de F1. Los avisos y negativos históricos quedan preservados en los logs.

La revisión visual fresca dio FIX por un único F1: etiqueta destructive habilitada a 3,26:1. r1→r2 cambia sólo la clase local enabled del presentador, RAW `9ec334493d8512167fbf5bcbe4631257691388b6d2dc9e5ba41a41bcfd2cf355`, con tokens existentes y sin cambiar lógica ni disabled. `finish-review/VERDICT-F1.md` confirma resolved/ship exclusivamente para F1, con contraste informado 5,82:1 en surface y 5,05:1 en elevated. No es una segunda revisión visual completa ni una nueva prueba de persistencia.

## Referencia y límites

La [referencia primaria Tools / Host capabilities](https://docs.beta.vvd.world/workshop/reference/tools#host-capabilities) describe un servicio opcional, fallback y grabador; su API también incluye submenús. ROOT observó un menú normal de Canvas sobre su WAV, sin ejecutar sus acciones ni acreditar su implementación SDK. La página no certifica una versión runtime probada aquí. Este contrato propio plano no equivale a compatibilidad binaria ni paridad universal con ese servicio.

No puerto en Owned/world/readonly/fullscreen/Reader/Published. No submenús, iconos, callbacks en describe/backup, nuevo permiso/servidor/clave, cancelación mágica o teclado Undo implícito. El portal usa el documento del trigger; primer Escape cierra el popup y conserva el tour, siguiente Escape conserva la conducta normal del tour. Native cubre el ejecutor local real, no una nueva sesión stdio externa.

## Fuente, revisiones y recibos finales

- Fuente final y relación con r1/F1: `d6d2e1b4d93701c024ec486e230ddc49d2920acd`, dieciocho rutas; r2 corrige únicamente F1 de clase enabled, r3 retira una LF final del test del autor y r4 un espacio en la línea32 del test independiente. Las sentencias y assertions no cambian; los incidentes de índice y recuperación siguen conservados.
- Revisión formal de la entrega exacta: CAS36 aprobado para ese único commit; ROOT leyó íntegro el informe formal SHA `111370e91dba060c623302e257dace7876992c6d55a98fd91008762eabb6f74b` y el readback exacto en `ROOT-formal-read.json`. La confirmación formal propia fue CSS2; Native1 propio conserva su atribución anterior a r1.
- Gates finales y Main: FF exacto bajo el lock merge real y siete comprobaciones Main exit0: quick, build, electron-build, manifest, menus-css, menus-native, global-tours. Build de producción terminó en 148.09 s; fuente exacta, Main limpio y merge liberado según `ROOT-main-gates.json`. No hubo push.
- Manual y continuidad: Manual nativo: inserción y lectura posterior confirmadas, delta 498 unidades UTF-16, otros párrafos y estructura completa intactos, según `ROOT-manual-receipt.json`. `ROOT-continuity-receipt.json` confirma prefijo de MEMORY y otros nodos/aristas conservados, más lectura posterior del nodo propio.
- Confirmación visual: Único F1 de contraste resolved/ship; veredicto y seis PNG abiertos con la atribución anterior. No amplía su alcance a revisión técnica, paridad general o producto móvil.

La equivalencia de formato se comprobó en memoria: añadir la LF retirada o reinsertar el espacio reproduce los hashes históricos. El prefijo8014/SHA8d54 es histórico antes de esa limpieza; no identifica el archivo ni el prefijo del commit actual. No se presenta el formato posterior como otra ejecución de los quince gates r1.

Los recibos están en `_stage/sdk-context-menus-next/`. La integración de documentación y el cierre de research1501 se registrarán después de ocurrir en el recibo final de ROOT; este texto no anticipa su hash o estado. La tarea1095 permanece abierta para las brechas restantes.
