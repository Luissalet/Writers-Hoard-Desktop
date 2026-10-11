export const worldBiblePanelCopy = (locale: 'es' | 'en') => locale === 'es' ? {
    detail: 'Reúne fichas, cronologías, mapas y relaciones del proyecto en un documento de consulta.',
    select: 'Contenido', secrets: 'Incluir relaciones secretas', preview: 'Vista previa de la Biblia del mundo',
    empty: 'No hay registros en esta sección.', loading: 'Cargando contenido…', error: 'No se pudo preparar la Biblia. Vuelve a abrir este panel.',
    html: 'Guardar HTML', pdf: 'Guardar PDF', pdfDetail: 'PDF disponible en la aplicación de escritorio.',
    failed: 'No se pudo exportar.', canceled: 'Exportación cancelada.', saved: 'Documento exportado.',
    caveat: 'Incluye registros guardados en este proyecto. Los mapas generados se incluyen cuando se guardan como mapa. El canon de otros libros no se añade automáticamente.',
  } : {
    detail: 'Combine project entries, timelines, maps and relationships into a reference document.',
    select: 'Content', secrets: 'Include secret relationships', preview: 'World bible preview',
    empty: 'No records in this section.', loading: 'Loading content…', error: 'Could not prepare the bible. Reopen this panel.',
    html: 'Save HTML', pdf: 'Save PDF', pdfDetail: 'PDF is available in the desktop app.',
    failed: 'Export failed.', canceled: 'Export canceled.', saved: 'Document exported.',
    caveat: 'Includes records saved in this project. Generated maps are included once saved as a map. Canon from other books is not expanded automatically.',
  };
