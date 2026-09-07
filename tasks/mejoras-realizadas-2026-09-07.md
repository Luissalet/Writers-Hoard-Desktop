# Mejoras ya implementadas

Trabajo realizado en la aplicación. Las propuestas están exclusivamente en [mejoras-pendientes.md](mejoras-pendientes.md).

## Capturar y desarrollar ideas

- Centro creativo con entradas a captura, laboratorio, organización, Tablero y Worldgen; captura desde la barra superior e inicio con búsqueda y reanudación del motor usado.
- Posibilidades del laboratorio persistidas en el proyecto y conservadas en exportación ZIP.
- Nota → laboratorio con la fuente original seleccionada; desarrollo con procedencia explícita. Una sola fuente permite comenzar con «¿Qué tendría que ser cierto?».
- Edición de notas recuperable ante fallo de guardado.

## Esquemas, grafos y vínculos

- Tablero: conectores, etiquetas, flechas, curvas paralelas y anclajes entre conexiones corregidos; bloqueos, cámara persistente y escrituras ordenadas.
- Captura rápida y ramificación conectada con deshacer; enlaces al tablero/nodo exactos.
- Relaciones: todos los vínculos de un par accesibles, alta desde celda vacía y nuevos vínculos del mismo par. Direcciones, estado e intensidad visibles. Extremos borrados reparables; formularios recuperables ante fallo.
- Esquema: plantillas atómicas y enlaces a escenas/escritos exactos.
- Escenas: alta abre editor; numeración confirmada al crear, reordenar y borrar, respetando bloqueos.

## Mundos, mapas y cronología

- Worldgen: cancelación recuperable, regeneración real, respuestas obsoletas descartadas y caché que evita doble pintura.
- Worldgen, segunda revisión: drenaje versionado, mosaicos y capas corregidos, repintado y miniaturas optimizados, caché con presupuesto de memoria, alternativas y regeneración atómica con política de lugares. Itinerarios guardados y navegación coherente con agua, tierra y ríos pintados. [Estudio y mediciones](estudio-worldgen-2026-09-07.md).
- Worldgen, continuación: recálculo ambiental del relieve esculpido en segundo plano con historial reproducible; caudal absoluto y balance de lagos; láminas de lago a su cota en 3D y snapshots completos. Viajes/comparaciones asíncronos y desarrollo de recorridos/noches como ideas o escenas con procedencia. Rotulado corregido para escala, encuadre y colisiones. [Detalle de la implementación](estudio-worldgen-2026-09-07.md).
- Worldgen, verificación de uso: corregidos cierre al deshacer el último recálculo, copias masivas del historial y envío no serializable de idiomas al worker de viajes. Cinco ciclos sobre mundo real de 2048, 310 comprobaciones críticas y recorrido ciudad → viaje → noche → idea guardada.
- Último trazo guardado al salir, escrituras ordenadas/reintentables, presets independientes y controles avanzados plegables.
- Mapas abre el mundo fuente exacto. Ediciones de chinchetas, lugares y divergencias recuperables al cambiar selección y al volver a la aplicación.
- Recuperación local separada del contenido guardado: Guardar aplica cambios a la entidad. Fallos visibles con reintento. Eliminar limpia solo los borradores correspondientes y tras confirmar la eliminación.
- Cronología valida inicio/final y conserva renombrados/conexiones fallidos para reintentar.

## Recuperar y conservar material

- Biblioteca, proyecto, Escritos y auditoría de personajes muestran errores de lectura y reintento; corregida la carga permanente tras fallar la primera lectura.
- Escrituras iniciadas en A que terminan tras navegar a B conservan propietario y no invalidan la lectura de B.
- Anotaciones: búsqueda por cuerpo/fragmento, filtro sin ubicación y recuentos actualizados tras reparar anclas.
- Galería: búsqueda por notas, etiquetas y títulos vinculados, ignorando acentos; limpieza de filtros y apertura exacta de imagen/álbum.
- Códice: detalle vigente, mezcla solo campos editados preservando cambios externos y resolución explícita de conflictos campo por campo.
- Diario: guardado automático sin cerrar ni bloquear edición; recoge texto escrito durante guardados anteriores; Volver espera lo pendiente.
- Storyboard: cancelar alta no deja viñetas vacías; fallo conserva editor.
- Vídeo: alta abre segmento, evita doble envío y conserva guion ante fallo.
- Captura de Códice, Recortes, Notas, Galería y otros formularios espera persistencia antes de limpiar la entrada.
- Semillas: limpiar filtros sin resultados y abrir fuentes existentes de siembra/resolución tras guardar cambios pendientes.
- Biografía: buscar hechos por texto visible, etiquetas y fuentes, combinando categoría e ignorando acentos.
- Estadísticas: objetivos positivos y fechas válidas antes de guardar, doble envío bloqueado y reintentos que conservan IDs y no duplican objetivos ya guardados.

## Presentación y comprobaciones

Superficies oscuras más legibles, acento cálido, foco visible, jerarquía de acciones y navegación compacta; identidad visual conservada.

Resultados finales en [todo.md](todo.md): tipos, lint, conformidad, regresiones, arranque de motores y compilación. Pruebas manuales de conexiones y recarga del Tablero, generación real de Worldgen, captura y nota → posibilidad, y Relaciones en escritorio/ventana estrecha. Perfiles aislados; el montaje de 23 motores no equivale a sesiones productivas completas ni ejecución de todos los modelos de IA.
