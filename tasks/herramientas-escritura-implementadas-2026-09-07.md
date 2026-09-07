# Herramientas de escritura implementadas

## Disponible en el código

- Centro creativo → Desarrollar → IA contextual: perfil de voz, público, criterios y contexto del proyecto. Guardado con detección de conflictos y recuperación de cambios pendientes. Propuesta editable desde muestra propia y comparación con/sin perfil; requiere IA configurada.
- Centro creativo → Producir → Citas: afirmaciones vinculadas a citas o recortes, fragmento literal, ubicación, notas y estado de revisión humana. Consulta de texto conservado del recorte y filtros de estado. Ediciones de metadatos conservan las evidencias; borrar exige confirmar la fuente y su versión.
- Centro creativo → Producir → Flujos: procesos para reportaje, ensayo y narrativa. Pasos editables y opcionales; selección de notas, escritos, recortes y citas con evidencias; generación explícita, historial y recuperación. Crear escrito preserva el resultado original y evita duplicados; permite abrir el escrito creado.
- Contexto editorial compartido por copiloto, análisis, juez y procesos. El juez contabiliza y vincula el perfil a la autorización de envío remoto. Las herramientas de lectura `wh_get_editorial_context` y `wh_get_research_evidence` están disponibles en el núcleo común MCP/copiloto.
- Persistencia sobre las tablas existentes: perfil/procesos pertenecen al proyecto y evidencias a las citas. ZIP conserva los datos. La clonación JSON remapea referencias al material que ese formato incluye.

## Comprobaciones

- TypeScript renderer/Electron, lint y conformidad del proyecto aprobados.
- Suite crítica completa: 325 comprobaciones aprobadas, incluidas las regresiones del núcleo compartido, arranque del renderer y workers reales.
- Pruebas focales de perfiles, evidencias, procesos y puente: 14 grupos aprobados.
- Tres recorridos de formulario en navegador: perfil, proceso manual y evidencia; guardado/reapertura, recuperación y aislamiento, sin errores React.
- Renderer completo con Vite y perfil aislado: tres paneles a 1280 y 760 px, sin errores de consola ni desbordamiento horizontal del documento. Capturas inspeccionadas del perfil y las afirmaciones.
- Compilación del renderer y Electron aprobada. Sin empaquetar ni publicar instalador.

## Límites de esta entrega

Se trabaja con fuentes ya incorporadas al proyecto mediante citas y Recortes. No se añadió un proveedor de búsqueda web autónoma, OCR ni transcripción de entrevistas. El estado de revisión registra la decisión del autor; no certifica la veracidad externa. Las propuestas IA están conectadas al gateway existente, pero no se ha evaluado su calidad con un modelo real en esta sesión.

No se implementaron colaboración con editores, CMS ni funciones de marketing. La exportación de documentos existente sigue disponible.

Arquitectura actualizada en `.odysseus/project_architecture.md` y su índice. La ruta de memoria histórica de la habilidad no existe en este entorno; se usa la referencia local ya establecida.
