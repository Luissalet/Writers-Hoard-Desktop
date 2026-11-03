import type { Editor } from '@tiptap/react';
import { closeHistory } from '@tiptap/pm/history';

export const TABLE_ACTIONS = ['insert', 'rowBefore', 'row', 'columnBefore', 'column', 'deleteRow', 'deleteColumn', 'merge', 'split', 'header', 'deleteTable'] as const;
export type TableAction = typeof TABLE_ACTIONS[number];
export const TABLE_COPY = {
  es: { table: 'Tabla', insert: 'Insertar tabla 3 × 3', row: 'Añadir fila', column: 'Añadir columna', rowBefore: 'Añadir fila arriba', rowAfter: 'Añadir fila abajo', columnBefore: 'Añadir columna a la izquierda', columnAfter: 'Añadir columna a la derecha', deleteRow: 'Eliminar fila', deleteColumn: 'Eliminar columna', merge: 'Combinar celdas', split: 'Dividir celda', header: 'Alternar encabezado', deleteTable: 'Eliminar tabla', controls: 'Controles de tabla', shortcut: 'Controles de tabla (Alt+F10)' },
  en: { table: 'Table', insert: 'Insert 3 × 3 table', row: 'Add row', column: 'Add column', rowBefore: 'Add row above', rowAfter: 'Add row below', columnBefore: 'Add column left', columnAfter: 'Add column right', deleteRow: 'Delete row', deleteColumn: 'Delete column', merge: 'Merge cells', split: 'Split cell', header: 'Toggle header', deleteTable: 'Delete table', controls: 'Table controls', shortcut: 'Table controls (Alt+F10)' },
} as const;
const command = { rowBefore: 'addRowBefore', row: 'addRowAfter', columnBefore: 'addColumnBefore', column: 'addColumnAfter', deleteRow: 'deleteRow', deleteColumn: 'deleteColumn', merge: 'mergeCells', split: 'splitCell', header: 'toggleHeaderRow', deleteTable: 'deleteTable' } as const;

export function canTableAction(editor: Editor, action: TableAction): boolean {
  if (editor.isDestroyed || !editor.isEditable || !editor.schema.nodes.table) return false;
  return action === 'insert' ? editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true }) : editor.can()[command[action]]();
}

/** Same commands/history for the select and floating toolbar. Keyboard keeps toolbar focus. */
export function runTableAction(editor: Editor, action: TableAction, focus = true): boolean {
  if (!canTableAction(editor, action)) return false;
  let chain = editor.chain().command(({ tr }) => { closeHistory(tr); return true; });
  if (focus) chain = chain.focus(null, { scrollIntoView: false });
  return action === 'insert' ? chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() : chain[command[action]]().run();
}

export function tableActionLabel(action: TableAction, locale: 'es' | 'en') {
  const copy = TABLE_COPY[locale];
  return action === 'row' ? copy.rowAfter : action === 'column' ? copy.columnAfter : copy[action];
}
