# Navegación de celdas con teclado en tablas normales

Pulsa una celda con el ratón para seleccionarla. Las flechas y Tab o Mayús+Tab siguen el orden de las celdas visibles. Mayús+flecha o Mayús+clic amplía el rectángulo desde la celda inicial. Otro Mayús+clic ajusta el mismo rango en cualquier dirección. Un clic normal empieza una selección nueva. Intro o doble clic abre una celda editable. Intro guarda y Escape descarta el borrador pendiente y vuelve a la cuadrícula. Escape desde la cuadrícula quita la selección y permite salir con Tab.

Tab desde el último editor guarda y devuelve el foco a la misma celda. Desde la última celda de la cuadrícula, pulsa Tab una vez guardada la edición. Writer añade la fila si queda visible en la vista actual. La fila se añade en Base o en la era activa y se puede deshacer. Si el filtro oculta la fila vacía, Tab conserva el cursor.

Por MCP, `wh_table_save_cell` admite `expected: ""` para rellenar una celda vacía y `value: ""` para vaciarla. Ambos argumentos siguen siendo obligatorios. La operación conserva la comprobación del valor anterior y la validación por tipo.

## Verificación

- La tabla pública de VVD permitió flechas, Tab y Mayús+Tab entre celdas, selección con Mayús, edición con Intro y una nueva fila desde el último Tab de la cuadrícula. En el último editor, Tab sólo guardó. [Tabla pública de VVD](https://beta.vvd.world/tools/table)
- Writer en Brave r1. El clic y las flechas pasaron del foco dentro del editor a un cursor por IDs. Pasaron selección rectangular, edición, cálculo de sólo lectura, avance y retroceso entre filas, orden, grupos y apéndice en una era con Base intacta. Escape permitió salir del teclado de la cuadrícula.
- Writer en Brave r2. Tab guardó la edición en la última celda antes de ofrecer el apéndice. El focal comprobó Intro y Tab rápidos, Deshacer de la fila con el valor anterior ya guardado y dos Tabs sin filas ocultas. En la interfaz, una fila vacía visible en su grupo sí se añadió y recibió el cursor. r3 conservó los cuatro archivos de interfaz y prueba de r2. El focal final pasó tres veces.
- Native r3. Dos claves, 15 llamadas y 15 IPC. Se rellenó una celda nueva de la era con `expected: ""`, apareció 4.5 en CSV y se vació con `value: ""`. Se rechazaron el valor anterior y el token de fila obsoletos. Base se conservó. Ambas revocaciones devolvieron 401 sin IPC nuevo. EOF 0, 89 tablas de prueba vacías, puerto cerrado y perfil retirado.
- Quick y build r3 terminaron con EOF 0. De las 1046 herramientas, el catálogo sólo modifica los campos `expected` y `value` de `wh_table_save_cell`.

La revisión 1 de la tarea 2715 aprobó `83f2a991b86021cc1d48dfb822fc74296ad98d95`, integrado por fast-forward. Los recibos están en `Research/writer-parity-20261110/table-cell-keyboard`. El manual de Google recoge la navegación, la edición y el apéndice con Tab.

## Ampliar la selección con Mayús y clic

La tabla pública de VVD permitió ampliar el rectángulo con Mayús+clic en ambos sentidos. Writer en Brave reprodujo la selección de una sola celda antes del cambio y después conservó el ancla al combinar clic y flechas. El focal verificó el TSV del rango. Suprimir vació sólo el rectángulo y un Deshacer restauró sus valores. El puente con dos claves verificó la operación equivalente por IDs, con 15 IPC. Quick y build terminaron con EOF 0.

La revisión 1 de #2743 aprobó `501ae7e69f08731dd9a5647ffde1799822970eb8`, integrado por fast-forward. El manual de Google incluye la ampliación con Mayús+clic. Los recibos están en `Research/writer-parity-20261110/table-cell-shift-click`.
