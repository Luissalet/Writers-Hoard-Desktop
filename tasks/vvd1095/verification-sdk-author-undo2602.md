# Comandos de autor con Deshacer en Source

## Uso

En **Cuaderno vinculado**, ve a Apuntes y pulsa **Añadir pauta de revisión**. La acción añade «Revisar la continuidad» y «Comprobar los nombres» cuando faltan. Los dos apuntes forman un único paso. **Deshacer** lo revierte y **Rehacer** lo recupera desde la vista que ejecutó el comando. Guardar Notas y añadir un apunte individual siguen compartiendo la pila de esa vista. Un cambio efectivo después de Deshacer inicia una nueva rama. Repetir la pauta cuando ya están sus apuntes conserva el estado y la rama anterior.

Puedes ejecutar la pauta desde el documento principal o su compañero. Cada montaje tiene su historial de acciones y observa los mismos datos persistidos. En el editor enfocado, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z y Ctrl+Y usan los pasos normales. Dentro de un campo de texto se mantiene el Deshacer nativo.

## API

`useLocalToolUndoCommand(client, context, state, spec)` recibe el mismo controlador `useLocalToolState(client)` utilizado por el componente. El descriptor incluye ID, nombres en inglés y castellano, esquema de input objeto y un `plan(snapshot,input)` síncrono que devuelve acciones Writer. El host obtiene el snapshot del documento, valida el input y ejecuta el lote mediante el escritor normal. Un recibo efectivo entra como un paso en la misma pila. Un borrador o una operación en curso pueden bloquearlo.

`wh_local_tool_command_list` recibe `projectId, namespace, documentId` y, para una época, `eraId`. Sus descriptores publican `instanceId, id, label, inputSchema`. Para ejecutar, `wh_local_tool_command_run` añade el token exacto `instanceId`, `commandId` e `input` opcional. El ejemplo usa `add-review-checklist` con `{locale:'en'}` o `{locale:'es'}`. La respuesta `{available,applied}` informa de disponibilidad y efecto. El token pertenece al binding actual y debe consultarse de nuevo tras cambios de montaje o visibilidad. La reversión se hace mediante los controles y atajos del editor. [API del SDK](../../docs/local-tool-sdk.md#reversible-author-commands).

La capacidad se ofrece en el editor Source ordinario y su compañero, vinculada al proyecto, época, namespace, documento, release y cliente vigentes. Al abrir el modal de pantalla completa, el registro retira al padre y el modal no ofrece el comando. Proveedores de historial externos, inversas de efectos arbitrarios y agrupación entre llamadas siguen pendientes.

## Verificación

- **Foco de producto r3.** El recorrido con ProjectWorkspace, cuaderno y escritor reales pasó con EOF 0 y limpieza 0. Comprueba recibo único, pila compartida con la edición normal, ramas Undo/Redo, aislamiento de texto y rechazo de montajes caducados o con borrador. Los avisos React de la ejecución quedan en el log.
- **Teclado.** La regresión existente pasó sus cuatro casos, incluidos documento Source enfocado, campos nativos, bloque Owned y liberación de control al retirar o dejar la herramienta de sólo lectura.
- **Native autenticado.** Dos claves ejecutaron sobre el mismo token del compañero. El lector normal comprobó revisiones +1, +2 tras Deshacer y +3 tras la segunda ejecución. El principal observó los datos y mantuvo vacía su pila. Cerrar el compañero retiró su token aunque el principal seguía abierto. El recibo registra 13 llamadas a herramientas, 15 RPC y 13 respuestas IPC, dos revocaciones HTTP 401 y dos stdio EOF 0. El fixture quedó sin proyectos, hosts ni pendientes propios y el perfil privado se retiró normalmente.
- **Quick.** `QUICK2602-RESULT-r1.json` registra EOF 0 para la verificación rápida del candidato r3.
- **Brave real.** Las dos vistas conservaron el mismo documento: la pauta añadió dos filas y dos Deshacer y dos Rehacer recuperaron en orden los pasos normales y el comando. Se comprobó Deshacer nativo del texto, una rama nueva que reemplazó el Redo anterior y la recarga con los datos y ambas vistas conservados. `BRAVE2602-RESULT-r1.json` registra el recorrido, con errores de aplicación vacíos; `BRAVE2602-command.png` conserva su captura.
- **Build.** `BUILD2602-RESULT-r1.json` registra EOF 0. El log `fdffb6a6…` terminó en 1 min 45 s.

Esta cobertura corresponde a comandos declarativos del autor sobre las acciones y recibos Writer del editor Source.
