# Abrir un bloque de un documento Source al lado

## Uso en Writer

Abre **Cuaderno vinculado**. Usa **Abrir notas al lado** o **Abrir apuntes al lado** para editar esa sección en una pestaña compañera mientras el principal sigue mostrando el cuaderno completo. Volver a abrir el mismo bloque selecciona su pestaña. Guardar notas y Deshacer se reflejan en las dos vistas del mismo documento. Dentro del compañero se puede volver al documento completo y regresar al bloque. Cerrar una pestaña conserva el documento guardado.

La solicitud pasa por el guardado habitual de cambios pendientes. Si el guard la rechaza, la vista activa y el borrador se conservan. Abrir o cerrar una vista estable sólo cambia la navegación. Si el guard llega a guardar un borrador, ese guardado conserva su efecto normal.

## SDK y MCP

```ts
if (client.documentId) {
  await client.openDocument('local-tool', client.documentId, {blockId: 'notes'});
}
```

`blockId` pide una apertura lateral sobre un documento Source existente, con el ámbito del cliente y un puerto lateral vigente. `context.focus?.blockId` entrega el ID al componente, también en pantalla completa. Cada pestaña monta su propia vista del mismo documento efectivo. El componente interpreta el ID y puede mostrar la vista completa para IDs desconocidos, como hace el cuaderno. `context.focusMode` sigue controlando la concentración del espacio de trabajo. [Contrato del SDK](../../docs/local-tool-sdk.md#open-a-source-block-beside-the-document).

`wh_local_tool_document_open` recibe `projectId`, `documentId`, `blockId` y, para una época concreta, `eraId`. Si se omite, usa Base. `available` expresa la disponibilidad del espacio de trabajo y `applied` la admisión de la ruta por el guard. Usa `wh_workspace_tabs` para consultar la ruta admitida. Sin espacio de trabajo montado devuelve ambos valores en falso. La edición y su Deshacer siguen usando los controles y el escritor Source del documento.

## Verificación

- **Autor y revisión independiente.** Los focos normales Node y Electron comprobaron identidad, deduplicación, guard de borradores, pantalla completa, guardado y Deshacer, reapertura, ID desconocido, época heredada y rechazo del documento oculto. El sucesor r3 verifica caducidad del cliente durante el guardado, sin abrir pestañas ni alterar el snapshot del caso. La revisión 2593 leyó el contrato y el código de quince rutas de r3.
- **Brave real.** En una biblioteca privada, el registro `BRAVE2590-UI-r1.json` conserva Notas y Apuntes del mismo documento junto al principal, reutilización de pestaña, Guardar y Deshacer visibles en ambas vistas, borrador retenido al rechazar la apertura, documento completo y regreso, y reapertura de las dos pestañas tras recargar.
- **Puente autenticado.** El recorrido Native montó ProjectWorkspace y LinkedNotebook reales. Dos claves alternaron la apertura y lectura de pestañas. El DOM y el lector normal confirmaron el bloque visible y Guardar y Deshacer sobre el mismo documento. Tras desmontar ProjectWorkspace, la solicitud devolvió ambos valores en falso. `NATIVE-FINAL-RESULT-r1.json` registra 10 llamadas a herramientas, 14 RPC y 10 respuestas IPC, dos revocaciones HTTP 401 sin IPC adicional, dos stdio EOF 0 y limpieza del perfil privado.
- **Gates.** Quick r2 completó typecheck de renderer y Electron, lint shipping y conformance sobre el candidato de producto r3. Los recibos anteriores conservan el primer quick fallido y los avisos React de los focos Electron.

La cobertura corresponde a bloques del editor documental Source y a su navegación lateral. La ficha normal, los bloques Owned y otras superficies tienen seguimientos propios.
