# Seleccionar un rango de filas en una tabla

Marca una fila y haz Mayús+clic en la casilla de otra para añadir las filas visibles entre ambas. Writer usa el orden de la vista y omite los grupos plegados. Si el ancla queda oculta, el gesto actúa sobre la casilla pulsada. La selección dura mientras trabajas en esa tabla y era. Las filas de las tablas vivas del Códex se gestionan como fichas.

Pulsa **Duplicar** en la barra de selección para copiar las filas elegidas. Por MCP, llama a `wh_table_edit` con `action: 'duplicate-rows'`, `rowIds` y la versión que devuelve `wh_table_get` en `expectedVersion`. La operación sirve para tablas y hojas. Copia cada ID una vez y coloca la copia debajo de su original. Si falta una fila, no caben las copias o la versión ya cambió, se rechaza todo el lote. La respuesta incluye la versión de la propia escritura.

## Verificación

- En la tabla pública, clic en 2 y Mayús+clic en 4 marcaron 2–4. Ampliar a 5 mantuvo la selección. El primer Mayús+clic sin ancla marcó una fila y estableció el ancla. Recargar restauró las cinco filas sin selección. [Tabla pública de VVD](https://beta.vvd.world/tools/table)
- Writer en Brave r1. El gesto pasó de marcar 2 y 4 a marcar 2–4. También se verificaron el orden visual, la exclusión de un grupo plegado y la caída a una sola fila visible al filtrar el ancla. En QA Past se duplicaron dos filas con sus valores y nuevos IDs. Base conservó sus cinco IDs.
- Writer en Brave r2. Una segunda escritura entre el compromiso de la primera transacción y la respuesta reproducía un token ajeno. La corrección lee el token dentro de la primera transacción. El focal pasó con las dos escrituras y el token propio de la duplicación. El conjunto devolvió ocho grupos.
- Writer por MCP Native r2. Dos claves, 16 llamadas y 16 IPC. Las versiones devueltas por los lotes coincidieron con las lecturas de Base, era y hoja. Pasaron las copias junto a sus originales, el CSV de Base y era, las referencias A1 y el rechazo sin escritura ante ID ausente y CAS obsoleto. Las dos revocaciones dieron 401 sin IPC nuevo, ambas sesiones cerraron con EOF 0 y se retiró el perfil de prueba con 89 tablas vacías.
- Quick y build r2 terminaron con EOF 0. El catálogo conserva 1046 herramientas. En `wh_table_edit` se añadió `duplicate-rows` y se actualizaron las dos descripciones relacionadas.

La revisión 1 de la tarea 2714 aprobó `b7d30c8291cf2a23df3e71b816e596feec2bed85`, integrado por fast-forward. Los recibos están en `Research/writer-parity-20261110/table-row-range`. El manual de Google recoge el gesto y la duplicación.
