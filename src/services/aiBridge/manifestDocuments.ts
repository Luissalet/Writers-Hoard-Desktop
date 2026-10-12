import { b, n, s, type BridgeTool } from './schema';

const sessionId = s('Sesión documental devuelta al crear o abrir el documento.');
const printOptions = { language: s('Idioma para la copia exportada, como es-ES o en-US. Omitir conserva el documento.'), hyphenation: b('Guionado automático para la copia; omitir conserva el documento.') };
const path = s('Ruta absoluta del archivo. Solo se escribe al guardar o exportar con ruta explícita.');
const object = (description: string) => ({ type: 'object', description, additionalProperties: true });
const summaries: Record<string, string> = {
  wh_document_commands: 'Consulta las órdenes del núcleo documental de Writers y sus parámetros.',
  wh_document_hyphenation: 'Consulta cortes de guionado por idioma conservando las palabras originales.',
  wh_document_new: 'Crea una sesión documental propia de Writers sin escribir archivos.',
  wh_document_open: 'Abre un documento en el núcleo de Writers sin modificar el archivo original.',
  wh_document_open_bytes: 'Abre un documento desde bytes base64 en una sesión de Writers.',
  wh_document_import: 'Carga HTML y assets en una sesión documental propia de Writers.',
  wh_document_save: 'Guarda un documento de Writers en la ruta y el formato indicados.',
  wh_document_inspect: 'Inspecciona estructura, revisión, selección y assets del documento.',
  wh_document_text: 'Lee el texto de una sesión documental de Writers.',
  wh_document_html: 'Exporta HTML y assets de una sesión documental de Writers.',
  wh_document_render: 'Renderiza una página como PNG para comprobar la maquetación del documento.',
  wh_document_pdf: 'Exporta PDF desde la maquetación del núcleo propio de Writers.',
  wh_document_export_bytes: 'Exporta un documento a bytes base64 para descargarlo desde Writers.',
  wh_document_execute: 'Ejecuta una orden de edición en una sesión documental de Writers.',
  wh_document_batch: 'Ejecuta un lote atómico de órdenes documentales de Writers.',
  wh_document_close: 'Cierra una sesión documental de Writers sin escribir archivos.',
  wh_get_writing_document: 'Lee el documento rico y las posiciones ProseMirror de un capítulo.',
  wh_format_writing: 'Aplica formato persistente a un capítulo o a un rango ProseMirror.',
  wh_edit_writing_document: 'Edita tablas, saltos o texto del capítulo con el editor propio de Writers.',
};
const tool = (name: string, description: string, writes: boolean,
  properties: Record<string, unknown>, required: string[] = []): BridgeTool => ({
  name, description: `${summaries[name]}\n${description}`, writes, timeoutMs: 120_000,
  schema: { type: 'object', properties, required, additionalProperties: false },
});

/** Native sessions and manuscript edits share the ordinary Writer tool surface. */
export const DOCUMENT_TOOLS: BridgeTool[] = [
  tool('wh_document_hyphenation', 'Consulta patrones de guionado por idioma sin editar el documento. Devuelve cortes UTF8/caracteres, segmentos y proveedor. Usa language explícito o el idioma de sessionId; sin ambos usa inglés. supported indica si existe proveedor.', false, { words: { type: 'array', items: { type: 'string' }, description: 'Palabras originales que se consultan.' }, language: s('Idioma BCP47, como es-ES o en-US.'), sessionId }, ['words']),
  tool('wh_document_commands', 'Consulta las órdenes del núcleo documental de Writers y sus parámetros; query filtra por id, etiqueta o ubicación. Usa los ids devueltos con wh_document_execute o wh_document_batch; el catálogo incluye formato, tablas, revisión, referencias y diseño de página.', false, { query: s('Filtro de búsqueda opcional.') }),
  tool('wh_document_new', 'Crea una sesión documental propia de Writers, sin escribir archivos. Conserva el sessionId para editar, inspeccionar y exportar. Las sesiones se cierran con wh_document_close.', true, { text: s('Texto inicial opcional.'), template: s('Plantilla: blank, sample, letter, resume o report.'), sessionId }),
  tool('wh_document_open', 'Abre un documento en una sesión del núcleo de Writers conservando estructura y assets compatibles. La extensión determina el formato; abrir no modifica el original. No equivale a importar un manuscrito simplificado.', true, { path, sessionId, password: s('Contraseña del archivo, si la necesita.') }, ['path']),
  tool('wh_document_open_bytes', 'Abre un documento recibido como bytes base64, sin ruta ni archivo temporal de usuario. Útil para el selector de archivos dentro de Writers. Devuelve sessionId y resumen.', true, { dataBase64: s('Bytes completos codificados como base64.'), format: s('Extensión sin punto, como docx, odt, rtf o writer.json.'), fileName: s('Nombre informativo.'), password: s('Contraseña del archivo si la necesita.'), sessionId }, ['dataBase64', 'format']),
  tool('wh_document_import', 'Carga HTML y assets en una sesión documental de Writers. Si sessionId existe, reemplaza su documento; si se omite, crea una sesión. Para conservar binarios envía assets por clave y base64. No guarda el manuscrito en Dexie.', true, { html: s('Documento HTML de intercambio.'), sessionId, assets: object('Mapa clave de media a bytes base64.') }, ['html']),
  tool('wh_document_save', 'Guarda una sesión documental en la ruta indicada. DOCX conserva los elementos compatibles; writer.json guarda el contenedor propio completo con assets y partes originales. La extensión determina el formato.', true, { sessionId, path, password: s('Contraseña opcional para DOCX.') }, ['sessionId', 'path']),
  tool('wh_document_inspect', 'Inspecciona documento, selección, revisión y assets de una sesión de Writers. Úsalo para verificar cambios y localizar estructura antes de editar. Los offsets del núcleo son UTF-8; no son posiciones ProseMirror del manuscrito.', false, { sessionId }, ['sessionId']),
  tool('wh_document_text', 'Lee el texto de una sesión documental de Writers sin exportar archivos.', false, { sessionId }, ['sessionId']),
  tool('wh_document_html', 'Exporta HTML y assets de intercambio. includeRevisions conserva inserciones, borrados y marcas de párrafo compatibles, con autor/fecha y metadatos propios; por defecto usa texto final. El archivo rico conserva el original completo. No escribe archivos.', false, { sessionId, includeRevisions: b('Incluir revisiones compatibles para editarlas en Writers.') }, ['sessionId']),
  tool('wh_document_render', 'Renderiza una página de la sesión documental como PNG. page empieza en 1; includeMarkup muestra revisiones. Por defecto usa el texto final. La respuesta incluye la imagen para visión.', false, { sessionId, page: n('Página, desde 1.'), scale: n('Escala del raster, por defecto 1.'), includeMarkup: b('Incluir las revisiones en la página.'), ...printOptions }, ['sessionId', 'page']),
  tool('wh_document_pdf', 'Exporta el PDF desde la misma maquetación del núcleo de Writers. Devuelve bytes base64; solo escribe al indicar path. Verifica fuentes y texto seleccionable para documentos exigentes.', true, { sessionId, path, includeMarkup: b('Incluir marcas de revisión.'), ...printOptions }, ['sessionId']),
  tool('wh_document_export_bytes', 'Exporta una sesión documental a bytes base64 para descargar desde la interfaz de Writers, sin ruta obligatoria. Formatos: docx, odt, rtf, html, txt, md, tex o writer.json.', false, { sessionId, format: s('Formato de salida sin punto.'), fileName: s('Nombre sugerido para descargar.'), password: s('Contraseña opcional para DOCX.'), ...printOptions }, ['sessionId', 'format']),
  tool('wh_document_execute', 'Ejecuta una orden del catálogo documental de Writers en una sesión. Consulta wh_document_commands para ids y parámetros. Los cambios se verifican con inspect, render y exportación; undo/redo son órdenes del mismo catálogo.', true, { sessionId, command: s('Id exacto del catálogo.'), params: object('Parámetros según la orden elegida.') }, ['sessionId', 'command']),
  tool('wh_document_batch', 'Ejecuta un lote atómico de órdenes en una sesión documental de Writers: si falla alguna, revierte el lote en memoria. No usar órdenes que escriban archivos dentro del lote; guardar es una operación separada.', true, { sessionId, commands: { type: 'array', items: { type: 'object', properties: { command: s('Id de orden.'), params: object('Parámetros.') }, required: ['command'], additionalProperties: false } } }, ['sessionId', 'commands']),
  tool('wh_document_close', 'Cierra una sesión documental de Writers. Guarda o exporta antes si necesitas conservar los cambios; cerrar no escribe archivos.', true, { sessionId }, ['sessionId']),
  tool('wh_get_writing_document', 'Lee el documento rico y la estructura de un capítulo de Writers: HTML, JSON de editor, bloques, formato y posiciones ProseMirror. A diferencia de Markdown, permite comprobar estilos y tablas. Devuelve updatedAt para editar la revisión consultada.', false, { id: s('Id del capítulo.') }, ['id']),
  tool('wh_format_writing', 'Aplica formato persistente al capítulo o al rango ProseMirror from/to consultado. format admite fontFamily, fontSize, color, highlight, subscript, superscript, alignment, lineHeight, indent y paragraphStyle. Conserva texto, toma versión previa y usa el guardado normal con recuperación.', true, { id: s('Id del capítulo.'), format: object('Formato semántico según el editor avanzado.'), from: n('Inicio del rango ProseMirror.'), to: n('Final del rango ProseMirror.'), expectedUpdatedAt: n('updatedAt leído previamente; si cambió, consultar otra vez.') }, ['id', 'format']),
  tool('wh_edit_writing_document', 'Edita tablas, saltos o un rango de texto del capítulo con el editor propio de Writers. operation: insertTable, addRowBefore, addRowAfter, deleteRow, addColumnBefore, addColumnAfter, deleteColumn, mergeCells, splitCell, deleteTable, insertPageBreak o replaceSelection. Inspecciona las posiciones antes de actuar; cada edición conserva versión y puede deshacerse.', true, { id: s('Id del capítulo.'), operation: s('Operación semántica.'), from: n('Posición inicial ProseMirror.'), to: n('Posición final ProseMirror.'), rows: n('Filas al insertar tabla, por defecto 3.'), cols: n('Columnas al insertar tabla, por defecto 3.'), text: s('Texto literal para reemplazar la selección.'), expectedUpdatedAt: n('updatedAt leído previamente.') }, ['id', 'operation']),
];

export const NATIVE_DOCUMENT_ACTIONS: Readonly<Record<string, string>> = {
  wh_document_hyphenation: 'document.hyphenation',
  wh_document_commands: 'commands', wh_document_new: 'document.new',
  wh_document_open: 'document.open', wh_document_open_bytes: 'document.openBytes',
  wh_document_import: 'document.importHtml', wh_document_save: 'document.save',
  wh_document_inspect: 'document.inspect', wh_document_text: 'document.text',
  wh_document_html: 'document.exportHtml', wh_document_render: 'document.renderPage',
  wh_document_pdf: 'document.exportPdf', wh_document_export_bytes: 'document.exportBytes',
  wh_document_execute: 'execute', wh_document_batch: 'batch', wh_document_close: 'document.close',
};
