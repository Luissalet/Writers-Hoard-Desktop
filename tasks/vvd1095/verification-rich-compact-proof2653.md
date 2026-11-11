# Validación por tramos de texto rico con historial retenido (2318)

Source2653 reduce trabajo interno al validar snapshots compactos de párrafos sin marcas durante la comprobación de cambios pendientes. Después de la validación global, una prueba positiva por tramos conserva el texto UTF-16 exacto, la identidad y prioridad de rutas, los límites de visibilidad y la alcanzabilidad del historial. Si no puede demostrar el caso, usa el validador anterior; los snapshots antiguos, con marcas o estructurales conservan esa ruta. No cambian el formato guardado, la política de validación, la API, el escritor ni la interfaz.

## Comprobaciones funcionales

Corte `21d559f8`, tres rutas sobre `b5f92bc6`; Source2653 / hilo 2919, commit `6195a14984c3567b1f3678cb4ac2d252663eca50`. CAS 1 aprobada y Main por fast-forward, sin push (`23f6002d`). Siete grupos focales contrastan texto y tramos exactos, exclusiones interiores, historial inactivo y casos que deben volver al validador anterior. Tres grupos compuestos verifican el snapshot `/2` junto con campos plain/list, un enlace real que requiere la ruta anterior y la prioridad de una ruta activa sobre un testigo inactivo. El modo comparativo ejecutó **769 comprobaciones** con el validador completo anterior. Las regresiones existentes completaron **35 comprobaciones de codec y 83 de anotaciones**, con nueve réplicas cerradas. Quick y build exit 0 sobre el mismo corte (log de build `ee028f9d`).

En Brave extensión 3 se usó un Source normal de un proyecto sintético con sesión compartida. El campo largo partió de **50.000 unidades UTF-16**; una edición breve produjo **50.001**, con Deshacer y Rehacer exactos. Guardar y reabrir en frío conservó el texto y la cursiva de un segundo campo. Es una comprobación funcional de ambos recorridos en el editor, sin medida de latencia, IME físico ni garantía para otros documentos. Recibo `BRAVE2653-r1.json`.

## Medición del SDK, con historial retenido

| Carga | Base → candidato | Alcance |
| --- | --- | --- |
| 10.000 unidades UTF-16, dos pares cruzados | p95 de gesto **406,0217 → 280,5397 ms** y **316,9004 → 288,4521 ms** | Reducciones de 30,91 % y 8,98 %; ambos superan el umbral predeclarado del 5 %. |
| 50.000 unidades UTF-16, una pareja sin perfilador, base y después candidato | p95 de gesto **2.230,7707 → 1.336,6789 ms**; media **1.467,1333 → 1.207,4047 ms** | Oráculo sintético del SDK público, 100 gestos por lado. No es otra pareja cruzada ni latencia del editor. |

La medición anterior de **1.549,4158 ms** a 50.000 unidades corresponde a otro corte y no es la base de esta pareja. La comparación muestra una mejora acotada del SDK; no demuestra latencia interactiva ni cumple el objetivo de **100 ms**. 2318 sigue abierta. No se añaden instrucciones al Manual para esta optimización interna.

Recibos en `Research/writer-parity-20261110/rich-perf-2318-next/compact-proof-next`: `CANDIDATE-r1.json`, `focal-r1/EXECUTION.json`, `composite-r1/EXECUTION.json`, `existing-regressions-r1/EXECUTION.json`, `CROSS-RESULT.json`, `PAIR50-RESULT.json`, `BRAVE2653-r1.json` y `QUICK-r1.json`.
