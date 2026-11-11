# Vaciar celdas en tablas normales

En la cuadrícula de una tabla normal, selecciona una celda o un rectángulo y pulsa Suprimir o Retroceso. Writer vacía las celdas editables del rango visible sin añadir filas. Las fórmulas siguen calculándose y un solo Deshacer restaura los valores. Dentro del editor de texto, las dos teclas se comportan como al editar cualquier texto.

Para el mismo cambio por MCP, lee `version` con `wh_table_get`. Llama a `wh_table_edit` con `action: "paste-cells"`, los `rowIds` y `columnIds` editables, la misma cantidad de filas y columnas en `values` y todas las entradas como cadenas vacías. Envía la versión en `expectedVersion`. La operación devuelve un recibo de Deshacer cuando cambia algún valor.

## Verificación

- Brave comparó la tabla gratuita de VVD y Writer. Writer pasó el borrado de un rectángulo 2×2, un rango de número, texto y fórmula, el borrado bajo filtro, el editor de texto y una era con Deshacer. Pasó el focal de portapapeles y borrado. [Tabla pública de VVD](https://beta.vvd.world/tools/table)
- El puente real usó dos claves para 14 llamadas MCP y un Deshacer HTTP autenticado. Conservó los IDs y valores vecinos, rechazó una versión obsoleta y verificó CSV Base y era. Repetir Deshacer devolvió `already-undone`. Las dos revocaciones dieron 401 sin IPC, las sesiones terminaron con EOF 0 y la prueba retiró el perfil privado.
- Quick y build finalizaron con EOF 0. Se preservó el contrato MCP del portapapeles.

La revisión 1 de la tarea 2736 aprobó `98ddea70be68bee211b15eec26490a5aa86b0f2f`, integrado por fast-forward. El manual de Google recoge las teclas y Deshacer. Los recibos están en `Research/writer-parity-20261110/table-cell-clear`.
