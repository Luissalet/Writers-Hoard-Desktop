/** Plain-words export guides for the import panel. Generic on purpose: they describe a kind of tool, never a product. */
export interface LocalizedText { es: string; en: string }
export interface SourceGuide {
  id: string;
  title: LocalizedText;
  summary: LocalizedText;
  steps: { es: string[]; en: string[] };
  keeps: { es: string[]; en: string[] };
  drops: { es: string[]; en: string[] };
}

export const SOURCE_GUIDES: SourceGuide[] = [
  {
    id: 'notes-markdown',
    title: { es: 'Una app de notas que exporta carpetas de Markdown', en: 'A notes app that exports Markdown folders' },
    summary: { es: 'Cada nota es un archivo .md; las subcarpetas se conservan.', en: 'Each note is one .md file; subfolders are kept.' },
    steps: {
      es: ['Exporta la libreta o la bóveda entera como carpeta de archivos Markdown e incluye los adjuntos si la app lo ofrece.', 'Si solo puede exportar un .zip, no lo descomprimas: elígelo con «Archivos o ZIP».', 'Elige aquí «Elegir carpeta» y marca el origen más parecido en la lista.', 'Revisa el destino de cada nota antes de crear nada.'],
      en: ['Export the whole notebook or vault as a folder of Markdown files and include attachments if the app offers it.', 'If it can only export a .zip, do not unpack it: choose it with "Files or ZIP".', 'Choose "Choose folder" here and pick the closest source in the list.', 'Review the destination of each note before anything is created.'],
    },
    keeps: {
      es: ['Título, texto y enlaces entre notas (por ruta y con corchetes dobles).', 'Tipo, etiquetas y alias escritos como datos simples al principio de la nota.', 'Imágenes, audio y vídeo locales que la nota enlaza.'],
      en: ['Title, text and links between notes (by path and with double brackets).', 'Type, tags and aliases written as simple data at the top of the note.', 'Local images, audio and video the note links to.'],
    },
    drops: {
      es: ['Datos anidados o complejos del encabezado: quedan en el texto original, no como campos.', 'Enlaces rotos (se avisan) e imágenes de internet.', 'Consultas, tablas dinámicas y extensiones de la app.'],
      en: ['Nested or complex header data: it stays in the original text, not as fields.', 'Broken links (reported) and images from the internet.', 'Queries, dynamic tables and app extensions.'],
    },
  },
  {
    id: 'spreadsheet-csv',
    title: { es: 'Una hoja de cálculo exportada como CSV', en: 'A spreadsheet exported as CSV' },
    summary: { es: 'Un archivo CSV por hoja: tabla, fichas o cronología.', en: 'One CSV file per sheet: a table, cards or a timeline.' },
    steps: {
      es: ['Exporta cada hoja como CSV (mejor en UTF-8); un libro con varias hojas da un archivo por hoja.', 'Elígelos con «Archivos o ZIP» (o mételos en una carpeta).', 'En la revisión elige el destino: tabla, una ficha por fila o cronología.', 'Si hace falta, cambia codificación, separador, decimal y columnas; excluye las filas que no quieras.'],
      en: ['Export each sheet as CSV (UTF-8 if possible); a workbook with several sheets gives one file per sheet.', 'Choose them with "Files or ZIP" (or put them in a folder).', 'In the review pick the destination: a table, one card per row, or a timeline.', 'Change encoding, delimiter, decimal and columns if needed; exclude rows you do not want.'],
    },
    keeps: {
      es: ['Filas y columnas como tabla (texto o número) o como hoja.', 'Una ficha o un evento por fila, con las columnas que elijas para título, descripción y fechas.', 'Las demás columnas pasan a campos de la ficha.'],
      en: ['Rows and columns as a table (text or number) or as a sheet.', 'One card or event per row, with the columns you choose for title, description and dates.', 'The other columns become card fields.'],
    },
    drops: {
      es: ['Fórmulas: solo llegan los valores.', 'Colores, formatos, celdas combinadas y gráficos.', 'Las demás hojas del libro si no las exportas.'],
      en: ['Formulas: only the values arrive.', 'Colours, formats, merged cells and charts.', 'The other sheets of the workbook unless you export them.'],
    },
  },
  {
    id: 'wiki-json',
    title: { es: 'Una wiki o web de worldbuilding que exporta JSON o Markdown', en: 'A wiki or worldbuilding site that exports JSON or Markdown' },
    summary: { es: 'Artículos con título, cuerpo, tipo y etiquetas.', en: 'Articles with a title, body, type and tags.' },
    steps: {
      es: ['Busca la opción de exportar o descargar tu mundo (copia de seguridad, exportación de datos) y elige JSON o Markdown.', 'Si la descarga es un .zip, elígelo tal cual con «Archivos o ZIP».', 'Marca el origen más parecido y revisa el tipo de cada ficha.', 'Cambia el tipo o la plantilla donde la exportación no lo indicara.'],
      en: ['Look for the option to export or download your world (backup, data export) and pick JSON or Markdown.', 'If the download is a .zip, choose it as it is with "Files or ZIP".', 'Pick the closest source and review the type of each card.', 'Change the type or template where the export did not say.'],
    },
    keeps: {
      es: ['Colecciones reconocidas (personajes, lugares, objetos, facciones, conceptos, magia, documentos, artículos).', 'Título, cuerpo, tipo, etiquetas y alias.', 'Un identificador propio de la exportación, si lo trae, para no duplicar al reimportar.'],
      en: ['Recognised collections (characters, locations, items, factions, concepts, magic, documents, articles).', 'Title, body, type, tags and aliases.', 'The export\'s own identifier, if present, so re-importing does not duplicate.'],
    },
    drops: {
      es: ['Campos anidados o que no son texto: quedan en el JSON original.', 'Relaciones que la exportación no declare: nunca se deducen.', 'Mapas, imágenes de internet y comentarios.'],
      en: ['Nested or non-text fields: they stay in the original JSON.', 'Relations the export does not declare: they are never guessed.', 'Maps, images from the internet and comments.'],
    },
  },
  {
    id: 'manuscript-files',
    title: { es: 'Un libro: documento .docx, ePub o PDF con texto', en: 'A book: a .docx document, ePub or text PDF' },
    summary: { es: 'Se importan como capítulos desde Escritos; el PDF también entra aquí como una ficha o capítulo por archivo.', en: 'They import as chapters from Writings; a PDF also enters here as one card or chapter per file.' },
    steps: {
      es: ['Para un libro entero usa «Importar manuscrito» en Escritos y elige el archivo.', 'Un ePub se lee en el orden del libro; un PDF necesita tener texto seleccionable (si puedes copiar frases, lo tiene).', 'Un PDF escaneado como imagen se rechaza: pásalo antes por un programa de OCR.', 'Revisa los capítulos propuestos antes de crear.'],
      en: ['For a whole book use "Import manuscript" in Writings and choose the file.', 'An ePub is read in the book\'s own order; a PDF needs selectable text (if you can copy sentences, it has it).', 'A PDF scanned as an image is refused: run it through OCR first.', 'Review the proposed chapters before creating.'],
    },
    keeps: {
      es: ['Texto, títulos, párrafos, cursivas, negritas, citas y listas.', 'ePub: títulos de capítulo, aunque el archivo no los repita en el texto.', 'PDF: párrafos reconstruidos por la posición del texto y títulos solo si son claramente más grandes.'],
      en: ['Text, headings, paragraphs, italics, bold, quotes and lists.', 'ePub: chapter titles, even when the file does not repeat them in the text.', 'PDF: paragraphs rebuilt from text positions and headings only when clearly larger.'],
    },
    drops: {
      es: ['Imágenes (se avisa cuántas), portada, índice y navegación del ePub.', 'PDF: columnas, tablas, notas al pie, cabeceras y números de página.', 'Libros con contraseña o DRM.'],
      en: ['Images (the count is reported), cover, contents and ePub navigation.', 'PDF: columns, tables, footnotes, headers and page numbers.', 'Password-protected or DRM books.'],
    },
  },
  {
    id: 'paste-text',
    title: { es: 'Texto que ya tienes en el portapapeles', en: 'Text you already have on the clipboard' },
    summary: { es: 'Pégalo y entra en la revisión como un archivo más.', en: 'Paste it and it enters the review like any other file.' },
    steps: {
      es: ['Pega el texto (Markdown o texto plano) en el cuadro «Pegar texto».', 'Si quieres, ponle nombre; sin nombre se llama «pasted».', 'Para pegar varios documentos a la vez, separa cada uno con una línea que contenga solo ---8<---.', 'Pulsa «Revisar importación» como con cualquier archivo.'],
      en: ['Paste the text (Markdown or plain text) into the "Paste text" box.', 'Optionally give it a name; without one it is called "pasted".', 'To paste several documents at once, separate them with a line that holds only ---8<---.', 'Press "Review import" as with any file.'],
    },
    keeps: {
      es: ['Todo el texto, con títulos (#), listas y enlaces en Markdown.', 'Un encabezado de datos (tipo, etiquetas, alias) al principio, si lo escribes.'],
      en: ['All the text, with Markdown headings (#), lists and links.', 'A data header (type, tags, aliases) at the top, if you write one.'],
    },
    drops: {
      es: ['Formato visual del origen (colores, fuentes): el portapapeles de texto no lo trae.', 'Imágenes: no se pueden pegar como texto.'],
      en: ['Visual formatting from the source (colours, fonts): the text clipboard does not carry it.', 'Images: they cannot be pasted as text.'],
    },
  },
];
