# Vaciar celdas en tablas normales

En la cuadrícula de una tabla normal, selecciona una celda o un rectángulo y pulsa Suprimir o Retroceso. Writer vacía las celdas editables del rango visible sin añadir filas. Las fórmulas siguen calculándose y un solo Deshacer restaura los valores. Dentro del editor de texto, las dos teclas se comportan como al editar cualquier texto.

Para el mismo cambio por MCP, lee `version` con `wh_table_get`. Llama a `wh_table_edit` con `action: "paste-cells"`, los `rowIds` y `columnIds` editables, la misma cantidad de filas y columnas en `values` y todas las entradas como cadenas vacías. Envía la versión en `expectedVersion`. La operación devuelve un recibo de Deshacer cuando cambia algún valor.

## Verificación

- Brave comparó la tabla gratuita de VVD y Writer. Writer pasó el borrado de un rectángulo 2×2, un rango de número, texto y fórmula, el borrado bajo filtro, el editor de texto y una era con Deshacer. Pasó el focal de portapapeles y borrado. [Tabla pública de VVD](https://beta.vvd.world/tools/table)
- El puente real usó dos claves para 14 llamadas MCP y un Deshacer HTTP autenticado. Conservó los IDs y valores vecinos, rechazó una versión obsoleta y verificó CSV Base y era. Repetir Deshacer devolvió `already-undone`. Las dos revocaciones dieron 401 sin IPC, las sesiones terminaron con EOF 0 y la prueba retiró el perfil privado.
- Quick y build finalizaron con EOF 0. Se preservó el contrato MCP del portapapeles.

La revisión 1 de la tarea 2736 aprobó `98ddea70be68bee211b15eec26490a5aa86b0f2f`, integrado por fast-forward. El manual de Google recoge las teclas y Deshacer. Los recibos están en `Research/writer-parity-20261110/table-cell-clear`.

## Deshacer una celda guardada por MCP

Una escritura efectiva de `wh_table_save_cell` devuelve el recibo de Deshacer para esa celda. Puedes usar el Deshacer habitual del puente. Writer comprueba que la celda conserva el valor de esa escritura y restaura el valor anterior o el hueco original. Las ediciones en otras celdas se conservan. En una era, Deshacer vuelve a la herencia si la edición creó la variante y ésta sigue en la misma versión. Una llamada con el mismo valor conserva la versión y no ofrece Deshacer.

La prueba RED del puente devolvió un recibo que no identificaba la tabla. Brave r3 verificó ausencia, vecino, CAS y era. Native r3 pasó con dos claves, 17 llamadas MCP y cuatro respuestas IPC de Deshacer. Una de ellas confirmó el rechazo tras una edición posterior en la misma celda. Repetir un Deshacer ya aplicado devolvió `already-undone` sin IPC. Quick y build r3 terminaron con EOF 0.

La revisión 1 de #2759 aprobó `ea3d832b1ce56905719d65e346881634885c8bfa`, integrado por fast-forward. El manual de Google recoge el recibo de celda. Recibos en `Research/writer-parity-20261110/sheet-grid/cell-undo`.
