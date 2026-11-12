# Subtotales en grupos de Tablas — #3020

## Uso y persistencia

En una tabla normal o viva, añade al menos un nivel en **Agrupar por**. Elige una columna numérica en **Sumar en los grupos**. Cada encabezado de grupo muestra la suma de sus filas filtradas, incluidos los niveles anidados. La suma sigue en el encabezado al plegar el grupo. Una entrada numérica con valor cero cuenta. Un grupo sin números muestra **Sin valor**. Una suma fuera del rango numérico muestra `#NUM!`.

La elección se guarda por ID de columna y por tabla. Una era hereda la elección de Base hasta que la cambia. Elegir **Ninguna** en una era quita allí la suma y conserva la agrupación. Las copias remapean los IDs de columna. Una columna numérica calculada se suma por su valor y usa el formato del resultado en pantalla. Cada valor no vacío se convierte primero a `Number`; sólo se cuentan los finitos. La suma combina los coeficientes decimales de esos valores ya normalizados y convierte el resultado una vez a `Number`. Cambiar el orden de las filas no cambia la suma; esto no aporta precisión arbitraria a los datos de entrada.

## MCP

`wh_table_query` puede agrupar una tabla normal o viva con `groupBy: [{ columnId, direction }]` (`asc` o `desc`). `subtotalColumnId` requiere al menos un grupo y el ID de una columna numérica, incluida una calculada cuyo resultado no sea texto. La consulta es optativa y de solo lectura: no aplica ni cambia la selección guardada de la vista. Omitir ambos argumentos conserva la forma anterior sin `groups`.

Cada elemento de `groups` incluye `key`, `columnId`, `value`, `label`, `depth` y `count` de filas. Con `subtotalColumnId` también devuelve `subtotal: { columnId, value, count }`; ese `count` cuenta celdas numéricas, incluido cero. `value` es el número, `null` si no hay números o `"#NUM!"` si la suma desborda el dominio finito. Los subtotales usan todas las filas que cumplen las condiciones; el límite de 500 se aplica sólo a la lista devuelta en `rows`. Las referencias conservan el ID de ficha como valor de grupo y usan el título efectivo del Códice para la etiqueta y el orden en Base o la era consultada. Si una referencia no tiene título efectivo, se usa su ID como etiqueta.

## Contraste y verificación

En la demo pública Tables 0.1.44, el grupo House Marrow mostraba dos filas de 2.450 y 1.750 y su recuento. El caso explorado no mostraba la suma. La prueba de Writer añadió 4.200 al grupo, conservó ese valor al plegarlo y mostró 2.450 tras filtrar una fila. La tabla viva mostró 15 % + 25 % = 40 %. La era heredó la selección y pudo quitarla sin cambiar Base. Brave también verificó que el céntimo sobrevive a ordenar y que se muestran los dieciséis dígitos del entero seguro máximo. La observación de la demo pública queda acotada al grupo explorado; no afirma ausencia de otros agregados en toda la referencia. `RED-BRAVE.md` registra por separado el Writer anterior, sin selector ni subtotal.

Recibos en `Research/writer-parity-20261110/table-group-subtotals3020/`. `COMMIT-CUT3020-r2.json` (SHA-256 `2d123b26681cc7d76660f2967583e2aee43f041d2d81350686af6532ca94dc26`) relaciona ocho rutas y once hashes de evidencia con `2b359bf85f00700d8e5136e7d13e674a4d0edc86`.

- `BRAVE-GREEN.md` registra los niveles anidados, 4.200 al plegar, 2.450 tras filtrar, cero y ausencia de valor, reapertura y herencia/override de era con panel real. El primer intento sin contexto de panel no contó como prueba de era. `BRAVE-GREEN-r2.md` repite el contrato y verifica 0,01 con los tres órdenes, el entero 9.007.199.254.740.991, 501 coincidencias con 500 filas devueltas, los títulos Alpha/Zulu en Base y Aardvark/Alpha en era con IDs estables, y el 40 % de la tabla viva. La forma MCP anterior permanece sin `groups`.
- `NATIVE-r2.md` y `native3020/run-20261112T051247Z-409a4b21/RESULT.json`: Electron aislado con dos claves reales y ocho respuestas IPC. Base 4.200, era 3.750, condición 2.450, cero/vacío, título efectivo/ID de referencias y cancelación decimal estable. Las revocaciones devolvieron 401 sin IPC; stdio EOF 0, puerto cerrado, 89 tablas de prueba vacías y perfil retirado. SHA-256 del resultado `f52cc8f989e8dcd076a6719b4e0d6b0582fff6985ae67a2185f99ad74067d94d`.
- `NODE-r2.log`: siete pruebas, cero fallos. `QUICK-r2.log` y `BUILD-r2.log`: exit 0, 34 motores, 64 tablas de motores y cero advertencias conocidas de conformidad; compilación de producción en 2m 36s. `DETECT-r2.json` conserva un aviso tipográfico de 10px en TablesEngine.
- `MERGE3020-RESULT-r2.json` y `DONE3020-r2.json`: #3020 aprobada en revisión exacta 2, integrada por avance rápido desde `50662b80132a36096c8e49192041e6ccf88d46c4` a `2b359bf85f00700d8e5136e7d13e674a4d0edc86`. Ocho rutas verificadas; la rama y el worktree de fuente se retiraron normalmente (`RETIRE3020-FINAL-r2.json`). `MANUAL3020-r2.json` acredita 214 caracteres y relectura exacta del manual. Sin push.

El corte de C97 añade la suma local de una columna por grupo. Las vistas nombradas y los demás agregados siguen abiertos.
