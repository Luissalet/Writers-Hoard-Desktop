# Navegar y editar celdas en hojas

Pulsa una celda de una hoja. Las flechas, Tab y Mayús+Tab recorren las celdas visibles. Mayús+clic o Mayús+flecha amplía la selección desde la celda inicial. Escribe para reemplazar la celda seleccionada. Intro abre el editor y, al confirmar, guarda y baja una fila. Escape descarta el borrador pendiente y devuelve el foco a la cuadrícula. El último Tab mantiene la celda y el tamaño de la hoja.

La edición abre el texto original de la fórmula. Al guardar una celda, Writer recalcula las fórmulas que dependen de ella y conserva las direcciones del orden guardado. La edición se guarda en Base o en la era activa.

## Verificación

- En la demo oficial de Sheet, Tab avanzó de A1 a B1. Escribir abrió el editor con el carácter nuevo. Intro guardó y bajó una fila, y el último Tab mantuvo las dimensiones. [Demo de Sheet](https://docs.beta.vvd.world/workshop/starter-kits/tool-sheet#try-it)
- Brave en Writer reprodujo que Intro dejaba el foco fuera de la cuadrícula. Después, las pruebas verificaron movimiento, selección, escritura directa, fórmula y Escape, con 13 en Base y 15 en la era. Pasaron el focal de hoja y la regresión de tabla normal.
- El puente real pasó diez llamadas MCP con dos claves, guardado por ID, CAS, fórmula y CSV, Base y era. El recibo anterior de edición de una celda se sigue en #2759. Quick y build terminaron con EOF 0.

La revisión 1 de #2751 aprobó `9a76aac443059c026939aad8e3c82c5008d9e820`, integrado por fast-forward. El manual de Google recoge estas teclas. Los recibos están en `Research/writer-parity-20261110/sheet-grid/keyboard`.
