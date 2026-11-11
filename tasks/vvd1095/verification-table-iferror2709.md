# IFERROR en cálculos de tabla y propiedades del Códex

Usa `IFERROR(expresión, alternativa)` en una columna calculada o una propiedad del Códex. Writer evalúa primero la expresión y sólo evalúa la alternativa ante un error de fórmula recuperable. Conserva el cero, las entradas vacías y el aviso de ciclo. Si falla la alternativa, se devuelve su error. Con un solo argumento se conserva el resultado o error original. Las hojas ya admitían `IFERROR`.

Para probarlo en una tabla con la columna numérica Amount, abre **Añadir cálculo** y guarda `=IFERROR(@[Amount]/0,7)`. Una fila con Amount informado da 7. Una fila con Amount vacío sigue mostrando un resultado vacío. En MCP, guarda la misma expresión con `wh_table_save_calculation` y la versión obtenida de `wh_table_get`. Para una propiedad de tipo, indica la fórmula en `wh_save_codex_template`.

## Verificación

- En la demo pública, una columna temporal devolvió 7 para `IFERROR(1/0,7)`, 5 para `IFERROR(5,1/0)` y 0 para `IFERROR(0,7)`. El error `#DIV/0!` se conservó si fallaban ambas ramas o se omitía la alternativa. La recarga retiró la columna temporal y dejó las cinco filas. [Tabla pública de VVD](https://beta.vvd.world/tools/table)
- Writer en Brave r1. En la tabla de prueba, 12,5, 0 y una entrada vacía dieron 7, 7 y una salida vacía. Los tres resultados reaparecieron tras recargar.
- Writer en Brave r2. Cuatro grupos cubrieron promoción de propiedad, agregado local, evaluación diferida, formato, referencias, errores, ciclos, Base y era, CAS y copia JSON. El corte final recupera `#N/A` leído de una columna y propaga `#NUM!` cuando la alternativa se desborda dentro de `IF`.
- Writer por MCP Native r2. Dos claves autenticadas realizaron 13 llamadas con 13 respuestas IPC. El CSV de Base mostró 7 en la columna de recuperación, mantuvo 12.5 y 0 en la columna con alternativa diferida y preservó la entrada vacía. El CSV de la era añadió el `#NUM!` de la fórmula anidada. Se conservaron las filas persistidas y el CAS obsoleto quedó sin escritura. Ambas sesiones cerraron con EOF 0 y ambas revocaciones devolvieron 401 sin IPC nuevo. El puerto cerró y las 89 tablas de la fixture quedaron vacías.
- Quick y build r2 terminaron con EOF 0. El catálogo de 1046 herramientas conserva sus esquemas. Cambiaron la descripción de `wh_table_save_calculation` y la descripción del campo de fórmula de `wh_save_codex_template`.

La tarea 2709 aprobó en revisión 1 el commit `43a27346f36c3e5b795114ded594deb0904ecdb5`, integrado por fast-forward. Los recibos están en `Research/writer-parity-20261110/table-iferror`. El manual de Google recoge el ejemplo de uso de la función.

## Referencias estructuradas de columna

Usa `Table[Columna]` para leer la columna completa en un cálculo de tabla. En `=IFERROR(@[Souls]/SUM(Table[Souls]),0)`, `@[Souls]` toma el valor de la fila y `Table[Souls]` aporta toda la columna a la suma. Al filtrar, el porcentaje conserva el denominador. La fórmula conserva la referencia al renombrar la columna, admite nombres con espacios y se mantiene en la tabla.

La demo pública de VVD y la interfaz normal de Writer mostraron 14,94 %, 49,39 %, 10,67 %, 19,51 % y 5,49 %. El filtro Greyvale mantuvo 14,94 %. En Writer, los resultados reaparecieron al recargar. La regresión de reapertura comprobó columnas llamadas `SUM` y `TRUE`, un nuevo guardado y el total 16400. Native r2 pasó 12 llamadas MCP con dos claves, CAS sin escritura, CSV y variante de era. Quick y Build r2 terminaron con código 0. Revisión 1 de #2889 aprobó `b89e845eb65e29a6d4dcb9730664759c4288b675`, integrado por fast-forward.
