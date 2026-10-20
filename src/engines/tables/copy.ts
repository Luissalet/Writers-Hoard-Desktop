const en = {
  title: 'Tables and sheets', intro: 'Keep typed records, edit Codex entries in a grid, or calculate an economy without leaving your project.',
  newTable: 'New document', table: 'Table', sheet: 'Formula sheet', live: 'Live Codex table', name: 'Document name', create: 'Create', cancel: 'Cancel',
  column: 'New column', columnName: 'Column name', columnKind: 'Column kind', text: 'Text', number: 'Whole number', reference: 'Codex link', checkbox: 'Checkbox', field: 'Codex field key',
  addColumn: 'Add column', addRow: 'Add row', newCard: 'New Codex entry', search: 'Filter rows', group: 'Group by', none: 'None',
  remove: 'Delete', removeDocument: 'Move this document and its stored rows to the archive? Live Codex entries stay available. Restore the document from Document archive.', removeColumn: 'Delete this column and its stored cells?', removeRow: 'Delete this row?',
  columnActions: 'Column actions', editColumn: 'Edit column', sort: 'Sort column', left: 'Move left', right: 'Move right', save: 'Save', export: 'Export CSV', import: 'Import CSV',
  empty: 'Create a typed table, a live view of your Codex, or a formula sheet.', noRows: 'No rows match this filter.',
  error: 'The change could not be saved. Check the value and retry. Another edit to the same cell may require reopening this document.',
  invalid: 'Use a whole number for this column.', width: 'Column width', noLink: 'No linked entry', openCard: 'Open entry',
  formulaHelp: 'Enter =SUM(A1:A5), =AVERAGE(B1:B4), arithmetic, MIN, MAX, COUNT, ABS or ROUND. Cell addresses follow the saved row order, even while sorting or filtering.',
  cellHint: 'Changes save after a pause or when you leave the cell. Press Enter to save, Escape to cancel.', count: 'rows', value: 'Calculated value', editCard: 'Edit Codex entry', retry: 'Retry save', missingLink: 'Entry unavailable',
};
const es: typeof en = {
  title: 'Tablas y hojas', intro: 'Organiza registros tipados, edita fichas del Códice en una tabla o calcula una economía sin salir del proyecto.',
  newTable: 'Nuevo documento', table: 'Tabla', sheet: 'Hoja de cálculo', live: 'Tabla del Códice', name: 'Nombre del documento', create: 'Crear', cancel: 'Cancelar',
  column: 'Nueva columna', columnName: 'Nombre de columna', columnKind: 'Tipo de columna', text: 'Texto', number: 'Número entero', reference: 'Enlace al Códice', checkbox: 'Casilla', field: 'Clave del campo del Códice',
  addColumn: 'Añadir columna', addRow: 'Añadir fila', newCard: 'Nueva ficha del Códice', search: 'Filtrar filas', group: 'Agrupar por', none: 'Ninguna',
  remove: 'Eliminar', removeDocument: '¿Mover este documento y sus filas al archivo? Las fichas del Códice siguen disponibles. Puedes restaurar el documento desde Archivo de documentos.', removeColumn: '¿Eliminar esta columna y sus valores guardados?', removeRow: '¿Eliminar esta fila?',
  columnActions: 'Acciones de columna', editColumn: 'Editar columna', sort: 'Ordenar columna', left: 'Mover a la izquierda', right: 'Mover a la derecha', save: 'Guardar', export: 'Exportar CSV', import: 'Importar CSV',
  empty: 'Crea una tabla tipada, una vista de las fichas del Códice o una hoja de cálculo.', noRows: 'No hay filas con este filtro.',
  error: 'No se ha podido guardar el cambio. Comprueba el valor y vuelve a intentarlo. Si ha cambiado la misma celda en otro lugar, vuelve a abrir el documento.',
  invalid: 'Esta columna requiere un número entero.', width: 'Anchura de columna', noLink: 'Sin ficha vinculada', openCard: 'Abrir ficha',
  formulaHelp: 'Escribe =SUM(A1:A5), =AVERAGE(B1:B4), operaciones, MIN, MAX, COUNT, ABS o ROUND. Las direcciones siguen el orden guardado de las filas aunque ordenes o filtres la vista.',
  cellHint: 'Se guarda tras una pausa o al salir de la celda. Intro guarda y Escape cancela.', count: 'filas', value: 'Valor calculado', editCard: 'Editar ficha del Códice', retry: 'Reintentar guardado', missingLink: 'Ficha no disponible',
};
export const tableCopy = { en, es };
