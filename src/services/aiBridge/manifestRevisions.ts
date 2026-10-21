import { arr, n, s, type BridgeTool } from './schema';

const id = s('Id del capítulo, obtenido al consultar el manuscrito.');
const from = n('Inicio del rango ProseMirror leído en wh_get_writing_document.');
const to = n('Final del rango ProseMirror; igual a from para una inserción.');
const expectedUpdatedAt = n('updatedAt leído al consultar el capítulo; utiliza una lectura reciente.');

const scope = { projectId: s('Proyecto del capítulo; necesario con eraId.'), eraId: s('Era explícita; omitir usa Base.'), expectedDocumentVersion: s('Token documentVersion leído en esta era; compare-and-swap del documento efectivo.') };

export const REVISION_TOOLS: BridgeTool[] = [
  {
    name: 'wh_get_writing_revisions', writes: false,
    description: 'Consulta los cambios propuestos de un capítulo, su autor y sus rangos.\nDevuelve inserciones, borrados y reemplazos pendientes con texto original/propuesto, origen, fecha y posiciones ProseMirror. No modifica el manuscrito. Útil para revisar una propuesta de Faustus antes de aceptarla o rechazarla.',
    schema: { type: 'object', properties: { ...scope, id }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'wh_propose_writing_revision', writes: true,
    description: 'Propone una sustitución de texto conservando el original como cambio pendiente.\nUsa from/to del documento consultado y text literal, que puede ser vacío para un borrado. Autor y origen quedan en el manuscrito. Conserva formato y datos fuera del rango, toma una versión previa y permite deshacer. Aceptar o rechazar es una operación separada.',
    schema: { type: 'object', properties: { ...scope, id, from, to, text: s('Texto literal propuesto; no se interpreta como HTML.'), author: s('Autor de la propuesta; por defecto Faustus.'), source: s('Origen de la propuesta; por defecto faustus.'), expectedUpdatedAt }, required: ['id', 'from', 'to', 'text'], additionalProperties: false },
  },
  {
    name: 'wh_resolve_writing_revisions', writes: true,
    description: 'Acepta o rechaza cambios pendientes de un capítulo por id, selección o en conjunto.\nLa decisión accept conserva las inserciones y elimina los borrados; reject restaura el original. Una selección decide el reemplazo completo al que pertenece, dentro de ese capítulo. Conserva los otros cambios y admite recuperación y deshacer normal.',
    schema: { type: 'object', properties: { ...scope, id, decision: s('Decisión de revisión.', { enum: ['accept', 'reject'] }), ids: arr('Ids de cambios concretos devueltos al consultar revisiones.'), from, to, expectedUpdatedAt }, required: ['id', 'decision'], additionalProperties: false },
  },
];
