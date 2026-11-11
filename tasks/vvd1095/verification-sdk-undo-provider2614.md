# Proveedor de Deshacer para el orden de ensayo en Source

## Uso

En **Cuaderno vinculado**, mueve los apuntes arriba o abajo en **Orden de ensayo**. Usa **Deshacer ensayo** y **Rehacer ensayo** para recorrer los cambios de ese modelo durante la sesión. El documento principal y el compañero pueden ensayar órdenes distintos. El ensayo conserva el orden guardado hasta pulsar **Aplicar orden**.

Aplicar guarda la permutación con un solo recibo Writer. El **Deshacer** y **Rehacer** habituales restauran o recuperan ese orden guardado. Si los apuntes guardados cambiaron mientras ensayabas, Aplicar conserva tu ensayo para revisarlo. **Descartar ensayo** vuelve al orden guardado. Un intento de salir con ensayo pendiente pasa por el guard de cambios y puede mantener abierta la vista.

## SDK y MCP

`useLocalToolUndoProvider(client, context, handle)` registra un modelo de autor con su propio historial. El autor declara `canUndo`, `canRedo` y callbacks que devuelven un booleano. El callback comprueba `operation.isCurrent()` después de sus propias esperas y antes de mutar el modelo. Si el proveedor ofrece `lastStep`, usa `nextLocalToolUndoStep()` para ordenar su historial con los recibos del editor. Un proveedor disponible sin paso tiene prioridad. Los campos de texto mantienen su Deshacer nativo.

`wh_local_tool_undo_provider_list` recibe `projectId`, `namespace`, `documentId` y `eraId` opcional. Para ejecutar, `wh_local_tool_undo_provider_run` añade `instanceId`, `providerId`, `providerToken` y `mode: 'undo' | 'redo'`. Un token identifica un registro vivo del modelo. Cerrar, ocultar o reemplazar ese registro invalida el token anterior. El comando usa el mismo dispatcher del proveedor y devuelve `{available,applied}`. Aplicar y revertir un recibo guardado siguen siendo acciones del editor. [Contrato SDK](../../docs/local-tool-sdk.md#live-undo-providers-for-author-models).

El editor Source editable ordinario y su compañero publican proveedores. Su historial pertenece al montaje vivo. El contrato mantiene fuera los hosts Owned y demás superficies especiales, las inversas de efectos arbitrarios, la agrupación de operaciones y los anchors.

## Verificación

- **Focal y teclado.** Los dos focos r3 cubrieron el modelo real, el orden de teclado, los tokens caducados, la conservación de ramas, los errores de proveedor, la aplicación de un recibo y el conflicto de base guardada. La regresión de teclado pasó cuatro casos, incluido Deshacer nativo de texto y los recibos de Owned. Ambos procesos terminaron en EOF 0 y retiraron sus perfiles. Los avisos React quedan en los logs.
- **Native autenticado.** A deshizo y B rehízo sobre el mismo token del compañero con la lectura persistida exacta. El ensayo del principal permaneció limpio. Aplicar registró una revisión y el Deshacer Writer restauró el orden anterior. Cerrar el compañero invalidó el token con el principal aún abierto. El recibo r3 registra 15 llamadas a herramientas, 17 RPC y 15 respuestas IPC, dos revocaciones HTTP 401 sin IPC adicional, dos stdio EOF 0 y limpieza de fixture y perfil.
- **Brave real.** El cuaderno real mostró órdenes de ensayo separados. Se comprobaron Deshacer/Rehacer de ensayo, Deshacer nativo de texto, guard al intentar salir, Aplicar, Deshacer/Rehacer del orden guardado y recarga con el orden persistido y los ensayos limpios. Una segunda tecla durante una operación pendiente dejó intacto el orden. La recarga registró dos errores de una extensión ajena al origen, sin errores de Writer.
- **Quick.** `QUICK2614-RESULT-r2.json` registra EOF 0 sobre el corte r3 `d3154c5b`.
- **Build.** `BUILD2614-RESULT-r1.json` registra EOF 0, con 117 entradas y cinco artefactos WASM verificados. Vite terminó en 1 min 34 s, en el log `aa248673…`.
