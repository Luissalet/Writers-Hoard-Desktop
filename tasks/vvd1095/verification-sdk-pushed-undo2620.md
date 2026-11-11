# Deshacer agrupado y anclas locales en Source

## Uso

En **Cuaderno vinculado**, usa **Lista para revisar** para marcar los apuntes que quieras inspeccionar. Dos marcas consecutivas se deshacen y rehacen juntas con **Deshacer selección** y **Rehacer selección**. Cada vista mantiene sus marcas durante la sesión. Cerrar el compañero descarta su selección. Marcar apuntes deja intactos el documento guardado y el orden de ensayo.

El teclado dirige Deshacer y Rehacer al historial de la región activa más profunda que tenga un paso disponible. Al mover el foco fuera de esa región vuelves al historial del editor. Los campos de texto conservan su Deshacer nativo.

## SDK y MCP

`useLocalToolUndoableCommand(client, context, model)` registra las inversas de una acción que el componente ya ejecutó sobre su modelo. `push` acepta los callbacks `undo` y `redo`, una etiqueta, `isStale` opcional y `batchKey` opcional. Los callbacks comprueban `operation.isCurrent()` tras sus propias esperas. Dos acciones consecutivas del mismo modelo y montaje se agrupan con la misma clave no vacía. Un paso compartido entre ellas inicia otro grupo. Deshacer va del último paso al primero y Rehacer, del primero al último. Si una inversión queda a medias, la siguiente operación en la misma dirección retoma el paso pendiente. `LocalToolUndoAnchor` dirige el teclado a un historial de la región que contiene el foco. [Contrato SDK](../../docs/local-tool-sdk.md#inverse-commands-and-local-undo-anchors).

Con el cuarto argumento `{expose: {id, label}}`, el autor publica el historial mediante `wh_local_tool_undo_provider_list` y `wh_local_tool_undo_provider_run`. La lista del cuaderno publica `review-shortlist`. Usa el token vigente del modelo y montaje exactos. Cerrar o reemplazar ese registro invalida el token. El historial agrupa acciones del modelo de sesión en el editor Source editable o su compañero. Owned, fullscreen y las demás superficies especiales quedan fuera de esta entrega.

## Verificación

- **Brave r3.** El cuaderno abrió dos vistas con selección separada. Dos marcas se deshicieron y rehicieron juntas. Con un paso de selección y otro de ensayo disponibles, la región profunda deshizo las marcas y el foco en la raíz deshizo el ensayo. Al cerrar y volver a abrir el compañero, su selección estaba vacía y los apuntes conservaban su orden. El arranque esperó a la compilación inicial tras un timeout de selector. El recibo registra cero errores de Writer. La captura `BRAVE2620-shortlist.png` corresponde a este recorrido.
- **Brave r4.** La comprobación final conservó ambas vistas y el orden guardado exacto tras dos marcas y un Deshacer por teclado. `BRAVE2620-RESULT-r2.json` registra cero errores.
- **Focos y Native r4.** Los dos focos terminaron en EOF 0. Se conservaron las cuatro regresiones de teclado con EOF 0 de r3 para el ámbito que r4 mantuvo. Native usó dos claves para deshacer y rehacer el grupo con el mismo token y datos guardados exactos. Al cerrar el compañero, el token retirado quedó indisponible con el principal vivo. El recibo registra 12 llamadas, 14 RPC, 12 IPC, dos HTTP 401, dos stdio EOF 0 y limpieza del perfil.
- **Incidencias previas.** El primer foco intentó pulsar una fila tras detectar sólo la región, antes de que cargaran sus apuntes. El arnés pasó a esperar las filas. Los dos primeros Quick se detuvieron en lint del candidato, primero por inmutabilidad y después por acceso a referencias durante el render. El delta r4 conserva la consulta de IDs dentro del callback de caducidad.
- **Quick r4.** `QUICK2620-RESULT-r3.json` registra EOF 0 para el corte `67e950f1`.
- **Build r4.** `BUILD2620-RESULT-r1.json` registra EOF 0. El log `c339c21b…` acredita 117 entradas y cinco artefactos WASM 1.92. Vite terminó en 1 min 35 s.
