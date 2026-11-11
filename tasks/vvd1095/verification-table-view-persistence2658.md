# Conservar filtros y orden de una tabla

Writer guarda las condiciones de filtro y las reglas de orden por tabla y ámbito, tanto en tablas normales como en tablas vivas. Al recargar recupera esos ajustes junto con la [agrupación persistida](verification-table-grouping-persistence2656.md). El texto de Buscar y el plegado de grupos son de sesión.

Una era hereda cada ajuste de Base por separado. Puede tener una agrupación propia y seguir heredando el filtro y el orden. Si quitas todos los filtros en la era, se guarda una lista vacía explícita para ese ámbito. Base conserva sus condiciones. Estos cambios afectan a la vista y dejan fuera las filas y su historial de Deshacer.

Dos pestañas pueden guardar ajustes distintos de una misma tabla y conservar ambos. Si ambas editan el mismo filtro, el primer guardado válido conserva su valor y la otra pestaña muestra el borrador en conflicto. **Recargar filtros guardados** descarta ese borrador, vuelve al valor guardado y permite seguir cambiando de era. Al duplicar una pestaña de hoja, Writer espera los guardados pendientes, vuelve a leer los ajustes vigentes y remapea las columnas de los tres ajustes en la copia.

## Evidencia por corte

Source2658 / hilo 2924, candidato `d73a0e53f6bddd5e86fae750a23bb8a6ebd33c70`, ocho rutas. Recibos en `Research/writer-parity-20261110/tables-persisted-filters-sort`.

| Corte | Qué acredita |
| --- | --- |
| Referencia, `PLAN-r1.md` (`76ce5a42`) | En una tabla de un mundo sintético, Name Z → A, el filtro «QA orden vivo A Ω» y la fila resultante sobrevivieron a la recarga. La prueba no incluyó vistas nombradas, OR, filtros rápidos, agregados ni arrastre de filas. |
| Brave 3 r2, `BRAVE2658-r2.md` (`8cfd4388`) | Dos pestañas guardaron filtro South y agrupación descendente, manteniendo Name 1↓. Quitar el orden persistió tras recarga con North high intacto. También se vieron herencia por ajuste en la era, edición sucesiva y copia tras teclear «Última Ω». El primer par de recarga de Districts precedió al ajuste de la cola; estas pruebas quedan atribuidas a r2. |
| Brave 3 r4, `BRAVE2658-r4.md` (`3939216f`) | Districts recuperó el filtro North, Name 1↓, Amount 2↑ y las tres filas esperadas. En el conflicto entre pestañas, South quedó guardado y North low quedó como borrador. Recargar filtros guardados convergió a South y permitió seleccionar la era inmediatamente. La era conservó su filtro vacío y agrupación Amount. La tabla viva mantuvo Guard QA Ω, Name ascendente y Type → Name. Duplicar inmediatamente tras teclear «Último texto Δ» conservó el texto completo en la copia. |
| Focal r4, `FOCAL2658-r4.log` (`fd482018`) | Tres casos anteriores de proyección y búsqueda y un caso determinista del sello de revisión. Tras confirmar B en rev5, llega un eco atrasado de A en rev4. B conserva el borrador y el sello para editar otra condición. Una rev6 remota posterior se acepta aunque el texto coincida con A. El retraso se forzó en el focal. |
| Quick y build r4 | `QUICK2658-r4.log` (`4f5ca322`) y `BUILD2658-r4.log` (`d5c1404f`) terminan en EOF 0. |

El alcance es una configuración por tabla y ámbito. Vistas nombradas, agregados y orden manual de la vista viva (C95) quedan fuera. Los exportadores se conservaron por inspección del corte; no se verificaron descargas ni bytes CSV/XLSX.

## Integración y manual

La revisión 1 aprobó el commit Source. Se integró en Main por fast-forward con las ocho rutas verificadas y sin push. Los recibos son CAS2658-r1.json, MERGE2658-RESULT-r1.json (2feb147b) y RETIRE2658-FINAL-r1.json (958ceccd). El manual de Google recibió una inserción verificada de 257 caracteres según GOOGLE-MANUAL2658-r1.json (7177bf05).
