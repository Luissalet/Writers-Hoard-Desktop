# Cálculos de Tablas durante cambios de vista — #3030

## Qué se reutiliza

El panel de Tablas reutiliza la proyección mientras conserva las mismas referencias de entrada: la tabla guardada, las plantillas y, sólo en una tabla viva, las entradas efectivas del Códice. Una búsqueda, un pliegue o un cambio de selección puede actualizar la vista sin repetir esa proyección. Una hoja también reutiliza el cálculo de sus celdas mientras su tabla proyectada no cambie. Una edición guardada, un cambio en las fichas de una tabla viva o un cambio en los datos efectivos del ámbito vuelve a calcular cuando cambia la entrada correspondiente.

La reutilización vive en la instancia del panel; no crea una caché persistente ni una caché separada por era. La proyección usa los datos efectivos del panel. No modifica el guardado, las fórmulas ni los contratos MCP. El cálculo inicial, la edición de datos y otras fases de renderizado conservan sus costes.

## Comprobación en Brave

`BASELINE-BRAVE.json` registra el producto en `2b359bf85f00700d8e5136e7d13e674a4d0edc86`: una tabla normal de 3.500 filas, con dos visibles por filtro guardado y una columna que divide el valor de la fila entre la suma de toda la columna. Los tres gestos de búsqueda fueron `Navigator`, vaciar la búsqueda y `Navigator`. Cada gesto ejecutó una proyección: 9,7, 11,9 y 10,7 ms internos, respectivamente.

`BRAVE-GREEN.md` registra la misma secuencia con el candidato sobre `dc808bea` y tras recargar el código exacto: cero proyecciones en los tres gestos y el 50,01 % visible intacto. El primer intento con HMR conservaba el código anterior y se excluyó. Guardar 3.500 → 7.000 ejecutó una proyección (20,9 ms internos) y cambió el resultado a 66,67 %; reapertura en frío mostró de nuevo el valor guardado y el porcentaje. La variante de era de esa prueba conservó 3.500 y 50,01 % mientras Base tenía 7.000 y 66,67 %.

En la hoja, filtrar no repitió proyección ni cálculo de celdas; editar 2 → 5 produjo una proyección y un cálculo, y el doble pasó de 4 a 10. En la tabla viva, filtrar no repitió la proyección; cambiar la ficha sintética de 3 a 7 produjo una proyección y cambió el resultado de 6 a 14. Se retiraron el proyecto sintético y la instrumentación; la limpieza dejó 89 tablas de prueba vacías y cerró la pestaña. `INSTRUMENTATION-REMOVED.json` distingue los bytes instrumentados del fichero entregado.

Las cifras son duraciones del cálculo interno y recuentos de llamadas de ese caso. No miden pintura, latencia total ni percentiles y no establecen una mejora equivalente en otras tablas, tamaños o equipos.

## Recibos de verificación

Los recibos están en `Research/writer-parity-20261110/table-projection-perf3030/`. `COMMIT-CUT3030-r1.json` (SHA-256 `5ce339c31e1d2bf9e97c8f43b24d199bf8cec0cdd5e1fd46bbbe258618e9f1f0`) identifica la única ruta de fuente y once hashes de evidencia del commit `a26fb0827028f4ef9ad4e8dfac961c55d3b99bc4`.

- `NATIVE.md` y `native3030/run-20261112T053231Z-64b6ab53/RESULT.json`: dos claves reales, cuatro IPC. A leyó 3.500/50,01 %; B guardó 7.000 con el valor esperado; A releyó 7.000/66,67 % y el renderer abierto reflejó el cambio. B leyó una variante de era distinta con 1.750/33,34 %. El intento previo falló al localizar un rol explícito en el resultado y se corrigió en la prueba. Ambas revocaciones devolvieron 401 sin IPC; stdio EOF 0, puerto cerrado, 89 tablas vacías y perfil retirado. SHA-256 del resultado `bbde7ce16613133a9cfd6154e0433f7593320f6c525bf7a773ec6da19faebc49`.
- `NODE.log`: siete pruebas de vistas de tabla sin fallos. `QUICK.log` y `BUILD.log`: exit 0; 34 motores, 64 tablas de motores y cero advertencias conocidas de conformidad; compilación de producción en 2m 40s. `DETECT.json` registra un aviso tipográfico de 10px en TablesEngine.
- `MERGE3030-RESULT-r1.json` y `DONE3030-r1.json`: #3030 aprobada en revisión exacta 1 e integrada por avance rápido desde `dc808bea08cb10d723e18a4d48c686a845172f57` a `a26fb0827028f4ef9ad4e8dfac961c55d3b99bc4`. Una ruta verificada; rama y worktree de fuente retirados normalmente (`RETIRE3030-FINAL-r1.json`). Sin push.
