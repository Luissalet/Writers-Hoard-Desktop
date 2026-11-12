# Experiencias de personaje Daggerheart — #3053

## Partida, Papel y JSON

En **Fichas → Personaje Daggerheart → Partida → Experiencias**, puedes añadir una experiencia, editarla o eliminarla con confirmación. Escribe un nombre y un modificador entero con signo, como `+2`, `0` o `-1`. **Guardar experiencia** aplica el cambio a la ficha en edición. Guarda la ficha con la acción habitual para conservarlo.

Partida reconoce las filas previas de las secciones Experiencia, Experiencias, Experience y Experiences, incluso con espacios al principio o al final y diferencias de mayúsculas. Una fila sin valor muestra **Sin modificador**. Editarla conserva el ID, la sección, la nota, la cantidad y la expresión. Papel muestra nombre y modificador en Experiencias para las filas con modificador, y conserva la sección original y los detalles en la tabla Filas. JSON conserva el modificador en `rows[].daggerheartExperience` y los demás campos de la fila. Una era hereda Base hasta guardar su variante. Las fichas de adversario conservan su editor.

Cuando Partida recibe una versión actualizada de la ficha, el formulario conserva lo que has escrito, muestra un aviso y deshabilita **Guardar experiencia** si cambió el nombre o el modificador de la fila que editas, o si se eliminó esa fila. También bloquea un alta pendiente si la versión que recibe alcanza el límite de 500 filas. Revisa la fila actual antes de volver a editarla.

Si ya hay un borrador de la ficha, Partida sigue mostrando la copia local. **Guardar ficha** comprueba la revisión en la que se basa ese borrador y muestra un conflicto si otra escritura cambió la revisión guardada.

## MCP

Lee `sheet.revision` y `sheet.rows` con `wh_sheet_get`. En `wh_sheet_daggerheart_action` usa `projectId`, `sheetId`, `revision` y una de estas acciones. Incluye `eraId` en ambas llamadas si estás en una era.

- `save-experience` recibe `name` y `modifier` como entero seguro con signo. Omite `rowId` para crear. Usa el ID de una experiencia existente para editarla. El ID se coteja literalmente, incluidos sus espacios. Un `rowId` explícito vacío, desconocido o de otra clase de fila se rechaza.
- `delete-experience` requiere el `rowId` de la experiencia que se va a eliminar.

Se comprueba la revisión antes de escribir. Guardar los mismos valores devuelve `noChange`. El Deshacer por recibo restaura la fila en el ámbito donde se cambió.

## Contraste y verificación

Los recibos están en `Research/writer-parity-20261110/daggerheart-character-experiences/`. `COMMIT-CUT3053-r2.json` (SHA-256 `5c85f8257f1af4b2e44ed07bff089fa54c7e4f1ace0170ff96d147febd4e031f`) registra siete rutas y ocho hashes del candidato `2d41cec80b3b06b50472076e8df38d42a459352b` sobre `96bad7eceee4808608e9cfe84551ebc150838d94`.

- `REFERENCE.md`: la demo pública VVD Daggerheart Character Sheet 0.1.9 mostró cinco pares de campos de nombre y modificador. Se escribió `Harbour scout` y `+2` en dos campos y se vaciaron antes de cerrar. `BRAVE-RED.md` registra la ausencia de esos controles en Partida en Writer `4844af19`. La fila previa seguía en Inventario y rasgos.
- `BRAVE-GREEN.md`: la fila previa `Legacy lookout` pasó de **Sin modificador** a `+2`, y se creó `River reader -1`. Se comprobó el guardado, la reapertura, la nota y cantidad previas en Inventario y rasgos, y ambos modificadores en Papel. Later guardó `River keeper +4` y lo conservó al recargar. Base conservó `River reader -1` y `Legacy lookout +2`. El adversario mantuvo su editor. La limpieza verificó 89 tablas vacías y cerró la pestaña.
- `BRAVE-RACE-RED.md` y `BRAVE-RACE-GREEN.md`: en r1 el formulario seguía permitiendo guardar `+3` después de que otra escritura cambiara la fila a `Updated elsewhere +5`. No se intentó guardar ese borrador en RED. En r2, al recibir Partida la versión actualizada, la fila quedó visible, el borrador `+3` se conservó y el aviso deshabilitó Guardar. La eliminación externa conservó el borrador `+7` y deshabilitó Guardar. Alcanzar 500 filas desde otra escritura conservó el borrador de alta y mostró el aviso de límite con Guardar deshabilitado. Se verificaron 89 tablas vacías al retirar la prueba.
- `CONTRACT-r2.log`: PASS para la conservación de la fila previa, los modificadores con signo, Papel, JSON, Base/era y revisión. Cubre la edición y eliminación por ID literal de un espacio y el rechazo de un `rowId` explícito vacío.
- `native3053/run-20261112T070424Z-ad5d9062/RESULT.json`: dos claves, doce llamadas MCP más un Deshacer, trece respuestas IPC. Se completó una fila previa conservando sus campos, se añadió otra y se editó en la era con el mismo ID y Base intacta. Deshacer restauró la fila eliminada en la era. JSON exportado y renderer se cotejaron con el ámbito correspondiente. Ambas claves devolvieron 401 tras revocarse, sin IPC. SHA-256 `cbfda17e1ce30ab1c75029c0b7f535c6fa1c1cd93c0d2ecdc7a0ba39f6e52c57`. `NATIVE-RETIRE3053-run-20261112T070424Z-ad5d9062.json` confirma la retirada del perfil.

- `SUITES-r2.json` y `REGRESSION-r2.json`: Quick, el contrato, Build y las regresiones de adversarios, profundidad y oro terminaron con código 0.
- `CAS3053-r2.json`, `MERGE3053-RESULT-r2.json` y `RETIRE3053-FINAL-r2.json`: revisión independiente r2 del commit exacto, integración por fast-forward de siete rutas y retirada normal del worktree y la rama de Source.
- `MANUAL3053-r2.json`: se verificó la incorporación de 227 caracteres sobre editar experiencias, conservar datos previos y guardar para ver el resultado en Papel. Se conservaron 895 párrafos y 79 listas.

Aplicar el modificador en una tirada y gastar Esperanza sigue pendiente.
