# Conservar la agrupación de una tabla (C97)

En una tabla normal o viva del Códex, elige hasta dos columnas para agrupar y la dirección de cada nivel. Writer conserva esas reglas por tabla y ámbito y las recupera al recargar. Una tabla anterior sin reglas conserva su vista inicial. El plegado de ramas sigue siendo local a la sesión. No se guarda un conjunto de vistas nombradas.

Una era hereda la agrupación de Base hasta que se personaliza allí. Cambiarla guarda sólo metadatos de vista: no modifica filas, su versión ni el historial de Deshacer, y no crea una variante de tabla. La era puede conservar su agrupación propia y seguir recibiendo cambios de filas de Base. [Agrupación de dos niveles del corte anterior](verification-table-nested-groups2647.md).

## Evidencia por corte

Source2656 / hilo 2922, commit `8eef9516d1183c18de02fb6ecc455add647440f0`, siete rutas. CAS 1 aprobada y fast-forward local a Main sin push. La comprobación posterior cotejó disco, índice y HEAD en las siete rutas y conservó los finales de línea mixtos ya presentes en `types/index.ts`. Recibos en `Research/writer-parity-20261110/tables-persisted-grouping`.

| Corte | Qué acredita |
| --- | --- |
| Entrega de Source | `COMMIT-CUT2656-r1.json` (`722290ed`), voto exacto `CAS2656-r1.json` (`79ed7af9`) y `MERGE2656-RESULT-r1.json` (`b8dc9300`). Worktree de Source retirado (`98f785ac`); inserción de 190 caracteres del Manual verificada por separado (`3a28242e`). |
| Referencia, `PLAN-r1.md` | En una tabla de datos de un mundo sintético, Tipo → Nombre y la misma fila se conservaron tras recarga. No se probó arrastre ni un selector de vistas nombradas; el menú observado no permite deducir si existe orden manual vivo. |
| Brave 3 r2, normal y era, `BRAVE2656-r2.md` | District → House descendente y las cinco filas exactas volvieron tras recargar; North volvió abierto. Una era heredó las reglas, se personalizó a Amount → House y Base quedó en District. Al añadir una sexta fila en Base, la era mantuvo Amount y recibió la fila sin cortar herencia. |
| Brave 3 r2, viva, segunda pestaña y copia | La vista viva conservó Type → Name al navegar y al recargar, independientemente de la tabla normal. Una ficha nueva apareció en el grupo sin reconfigurar. La segunda pestaña recibió el cambio de dirección guardado en la primera y conservó siete filas. Al duplicar una pestaña de hoja, B → A descendente siguió en la copia con sus nuevos IDs de columna. |
| Brave 3 r2, Deshacer y exportación | Insertar una fila llevó 7→8; después de cambiar la agrupación, Deshacer devolvió 8→7 conservando la dirección. Download CSV cerró el diálogo sin alerta, pero no se capturó la descarga ni se comprobaron sus bytes. Las entradas de CSV/XLSX conservan su proyección por inspección del diff, sin nuevo E2E de exportación. |
| Focal, Quick y build r2 | Tres grupos focales de la proyección y búsqueda anteriores, Quick y build EOF 0. Los remapeos al duplicar hoja y al copiar un mundo son rutas distintas: la copia de hoja se observó en Brave; el remapeo de mundo se atribuye al código, no a otra prueba de UI. |

El positivo es **una configuración de agrupación persistida por tabla y ámbito**. No acredita vistas nombradas, plegado persistido, subtotales o agregados de grupo, orden manual de la vista viva (C95), bytes de CSV/XLSX ni paridad general.
