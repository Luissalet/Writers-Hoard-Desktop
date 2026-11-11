# Portapapeles de celdas en tablas normales

Con el foco en la cuadrícula, Ctrl+C copia una celda o un rectángulo como texto tabulado sin cabeceras. Ctrl+V pega desde la esquina superior izquierda de la selección y sigue las filas visibles. Al llegar al borde derecho, Writer recorta las columnas sobrantes. Si faltan filas, las añade en Base o en la era activa cuando quedan visibles en la vista actual. Un solo Deshacer restaura las celdas y retira las filas nuevas.

Writer conserva las celdas vacías del bloque y todas las celdas de fuera. Si alguna celda de destino es calculada, un valor no encaja con su tipo, una referencia está fuera del ámbito o la vista ocultaría una fila nueva, Writer rechaza todo el bloque.

En MCP, llama a `wh_table_edit` con `action: "paste-cells"`, `tableId`, los `rowIds` existentes y los `columnIds` de destino en su orden, la matriz `values` y el valor `version` de `wh_table_get` en `expectedVersion`. Las filas de la matriz que excedan `rowIds` se añaden al final. Se recortan los valores a la derecha de `columnIds`. El pegado comprueba la versión del ámbito y devuelve un recibo de Deshacer cuando cambia la tabla.

## Verificación

- VVD copió un rectángulo 2×2 sin cabeceras y lo pegó preservando las otras columnas. Añadió una fila al pegar al final y recortó el exceso a la derecha. [Tabla pública de VVD](https://beta.vvd.world/tools/table)
- Writer en Brave r1. Se reprodujo la ausencia de copia y pegado, y después funcionó el bloque 2×2. Se comprobaron el rechazo de un número incompatible, el recorte, el apéndice en la era, un solo Deshacer y el rechazo de una fila oculta por la búsqueda. Pasaron el focal de portapapeles y la regresión de teclado.
- Brave r2. Copiar una celda vacía tras recargar y pegarla vació sólo su destino. El focal cubrió los vacíos de una columna y las comillas literales.
- Native r2. Dos claves, 17 llamadas MCP y un Deshacer HTTP autenticado, 18 IPC en total. Pasaron el CAS obsoleto, la repetición con la misma versión, el rechazo de un número inválido y de una referencia inexistente, el recorte, el CSV de era y la recuperación de la herencia de Base. Repetir Deshacer devolvió `already-undone` sin IPC. Las dos revocaciones dieron 401 sin IPC y el ensayo cerró con EOF 0, 89 tablas de prueba vacías, perfil retirado y puerto cerrado.
- Quick y build r2 terminaron con EOF 0. De las 1046 herramientas, sólo cambió `wh_table_edit`. Su descripción tiene 716 caracteres.

La revisión 1 de la tarea 2721 aprobó `7a0337b4673966f5e09b2246f80366ff0c016795`, integrado por fast-forward. Los recibos están en `Research/writer-parity-20261110/table-cell-clipboard`. El manual de Google recoge el flujo de copia y pegado.
