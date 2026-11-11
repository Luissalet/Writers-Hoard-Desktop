# Navegar y editar celdas en hojas

Pulsa una celda de una hoja. Las flechas, Tab y Mayús+Tab recorren las celdas visibles. Mayús+clic o Mayús+flecha amplía la selección desde la celda inicial. Escribe para reemplazar la celda seleccionada. Intro abre el editor y, al confirmar, guarda y baja una fila. Escape descarta el borrador pendiente y devuelve el foco a la cuadrícula. El último Tab mantiene la celda y el tamaño de la hoja.

La edición abre el texto original de la fórmula. Al guardar una celda, Writer recalcula las fórmulas que dependen de ella y conserva las direcciones del orden guardado. La edición se guarda en Base o en la era activa.

## Verificación

- En la demo oficial de Sheet, Tab avanzó de A1 a B1. Escribir abrió el editor con el carácter nuevo. Intro guardó y bajó una fila, y el último Tab mantuvo las dimensiones. [Demo de Sheet](https://docs.beta.vvd.world/workshop/starter-kits/tool-sheet#try-it)
- Brave en Writer reprodujo que Intro dejaba el foco fuera de la cuadrícula. Después, las pruebas verificaron movimiento, selección, escritura directa, fórmula y Escape, con 13 en Base y 15 en la era. Pasaron el focal de hoja y la regresión de tabla normal.
- El puente real pasó diez llamadas MCP con dos claves, guardado por ID, CAS, fórmula y CSV, Base y era. El recibo anterior de edición de una celda se sigue en #2759. Quick y build terminaron con EOF 0.

La revisión 1 de #2751 aprobó `9a76aac443059c026939aad8e3c82c5008d9e820`, integrado por fast-forward. El manual de Google recoge estas teclas. Los recibos están en `Research/writer-parity-20261110/sheet-grid/keyboard`.

## Copiar, pegar y vaciar celdas

Selecciona una celda o un rectángulo con Mayús+clic o Mayús+flecha. Ctrl+C copia los valores y las expresiones de las fórmulas como texto tabulado. Ctrl+V pega desde la primera celda de destino. El bloque se recorta al ancho y alto disponibles y las fórmulas se recalculan. Suprimir o Retroceso vacían la selección. Un solo Deshacer restaura el bloque pegado o vaciado.

En MCP, `wh_table_edit` con `paste-cells` recibe los IDs de filas y columnas de destino y los valores crudos. Usa la versión de `wh_table_get`. Un pegado efectivo devuelve recibo para Deshacer. Repetirlo con los mismos valores mantiene la versión y deja un registro de auditoría sin acción Deshacer.

Brave verificó fórmula copiada, recorte en ambos bordes, vaciado y Deshacer. El puente real verificó 13 llamadas MCP y un IPC de Deshacer con dos claves, CSV calculado, Base y era. Quick y Build r2 terminaron con EOF 0. La revisión 2 de #2752 aprobó `368c9e3ba4a09081d61e39d20966b97f9bb30715`, integrado por fast-forward. El manual de Google recoge los atajos.

## Suma de las columnas numéricas

El pie muestra la suma de cada columna numérica en todas las filas guardadas de la hoja del ámbito activo. Incluye resultados numéricos de fórmulas e ignora texto y errores. Una columna vacía muestra cero. Al editar, vaciar o deshacer, la suma se recalcula. Los filtros y el orden de la vista mantienen la suma de toda la columna.

`wh_table_get` devuelve los mismos resultados en `columnTotals`, con los IDs de las columnas numéricas como claves. La hoja sigue devolviendo `computed` por dirección de celda. Las tablas normales conservan su respuesta.

Brave comprobó 98 en Base y 100 tras editar una era, 84 con texto, 42 con una fórmula errónea y 0 al vaciar. Deshacer restauró 42. El puente real verificó 14 llamadas MCP y un IPC de Deshacer con dos claves. Quick y Build r1 terminaron con EOF 0. La revisión 2 de #2772 aprobó `3ee951d57563ed2074fd97531d2f9089f0d45a38`, integrado por fast-forward. El manual de Google recoge la suma y el ámbito.
