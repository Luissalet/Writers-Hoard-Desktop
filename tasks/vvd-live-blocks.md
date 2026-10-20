# Bloques vivos del Codex

- [x] Inspeccionar schema, resolver/referencias de Tablero y restricciones de BookEditor.
- [x] Nodo atómico local con contexto de proyecto, vista reactiva acotada y marcador ausente.
- [x] Selector contextual plegado con alias y activación del panel de referencias.
- [x] Serialización/recovery/undo/intercambio y pruebas de límites/proyecto/capítulos.

Contrato: `codexLiveBlock` attrs `{projectId,entryId,label}`. HTML aside con `data-wh-codex-block="true"`, `data-project-id`, `data-entry-id`, `data-label`, y párrafo `Codex: título` como respaldo. No hay campos/cuerpo/retrato fuente persistidos. El título de respaldo es máximo300; la vista muestra5 campos de200 y cuerpo600. Solo avatares raster dataURL locales. Wiki resuelve destinos admitidos y elimina excluidos/ajenos.

Verificación: Electron oculto `tests/codex-live-blocks.browser.tsx testCodexLiveBlocks` cinco grupos verdes: inserción real/alias/undo/redo; reactividad y evento contextual sin mutación del documento; recovery e intercambio y destinos borrados/restaurados; límites y aislamiento incluso al cambiar el contexto del mismo editor; schema BookDocument con títulos y fronteras protegidos, splitting y undo exactos. ESLint limpio de bloques y TiptapEditor.

Límite: vista viva de consulta, abrir edita en la ficha existente; no se añaden bloques editables de todos los otros motores ni código arbitrario. Fuentes: https://vvd.crisp.help/en/article/cards-62i16j/ y observación del editor autenticado; las páginas externas son material de referencia.
