import { useEditorState, type Editor } from '@tiptap/react';
import { useSyncExternalStore } from 'react';
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, IndentIncrease, IndentDecrease, Subscript, Superscript, Table2, Scissors, RemoveFormatting } from 'lucide-react';
import { applyAdvancedFormatting } from './extensions';
import { FONT_FAMILIES, PARAGRAPH_STYLES, type AdvancedFormatting } from './model';

export const ADVANCED_EDITOR_COPY = {
  es: { toolbar: 'Formato avanzado', font: 'Fuente', size: 'Tamaño', style: 'Estilo de párrafo', line: 'Interlineado', color: 'Color de texto', highlight: 'Resaltado', clear: 'Quitar formato', left: 'Alinear a la izquierda', center: 'Centrar', right: 'Alinear a la derecha', justify: 'Justificar', indent: 'Aumentar sangría', outdent: 'Reducir sangría', sub: 'Subíndice', sup: 'Superíndice', page: 'Salto de página', table: 'Tabla', insert: 'Insertar tabla 3 × 3', row: 'Añadir fila', column: 'Añadir columna', deleteRow: 'Eliminar fila', deleteColumn: 'Eliminar columna', merge: 'Combinar celdas', split: 'Dividir celda', header: 'Alternar encabezado', deleteTable: 'Eliminar tabla', inherit: 'Predeterminada', serif: 'Serif', sans: 'Sans serif', mono: 'Monoespaciada', normal: 'Normal', lead: 'Entrada', quote: 'Cita', caption: 'Pie de figura', none: 'Predeterminado', noColor: 'Quitar color', noHighlight: 'Quitar resaltado' },
  en: { toolbar: 'Advanced formatting', font: 'Font', size: 'Size', style: 'Paragraph style', line: 'Line spacing', color: 'Text color', highlight: 'Highlight', clear: 'Clear formatting', left: 'Align left', center: 'Center', right: 'Align right', justify: 'Justify', indent: 'Increase indent', outdent: 'Decrease indent', sub: 'Subscript', sup: 'Superscript', page: 'Page break', table: 'Table', insert: 'Insert 3 × 3 table', row: 'Add row', column: 'Add column', deleteRow: 'Delete row', deleteColumn: 'Delete column', merge: 'Merge cells', split: 'Split cell', header: 'Toggle header', deleteTable: 'Delete table', inherit: 'Default', serif: 'Serif', sans: 'Sans serif', mono: 'Monospace', normal: 'Normal', lead: 'Lead', quote: 'Quote', caption: 'Caption', none: 'Default', noColor: 'Clear color', noHighlight: 'Clear highlight' },
} as const;

const control = 'rounded border border-border bg-surface px-1.5 py-1 text-xs text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:opacity-40';
const button = `${control} inline-flex h-8 min-w-8 items-center justify-center hover:bg-surface/80`;
const FONT_SIZES = [8, 10, 11, 12, 14, 16, 18, 24, 36, 48, 72];
const LINE_HEIGHTS = [1, 1.15, 1.5, 2, 2.5, 3];

export default function AdvancedEditorToolbar({ editor, locale = 'es' }: { editor: Editor; locale?: 'es' | 'en' }) {
  const copy = ADVANCED_EDITOR_COPY[locale];
  const editable = useSyncExternalStore(listener => {
    editor.on('update', listener); editor.on('transaction', listener);
    return () => { editor.off('update', listener); editor.off('transaction', listener); };
  }, () => editor.isEditable);
  const state = useEditorState({ editor, selector: ({ editor: current }) => ({
    inline: current.getAttributes('advancedTextStyle'),
    block: current.getAttributes(current.isActive('heading') ? 'heading' : 'paragraph'),
    sub: current.isActive('subscript'), sup: current.isActive('superscript'), table: current.isActive('table'),
  }) });
  const apply = (format: AdvancedFormatting) => { applyAdvancedFormatting(editor, format); editor.commands.focus(); };
  const chooseTable = (action: string) => {
    const chain = editor.chain().focus();
    switch (action) {
      case 'insert': chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
      case 'row': chain.addRowAfter().run(); break;
      case 'column': chain.addColumnAfter().run(); break;
      case 'deleteRow': chain.deleteRow().run(); break;
      case 'deleteColumn': chain.deleteColumn().run(); break;
      case 'merge': chain.mergeCells().run(); break;
      case 'split': chain.splitCell().run(); break;
      case 'header': chain.toggleHeaderRow().run(); break;
      case 'deleteTable': chain.deleteTable().run(); break;
    }
  };
  return <div role="group" aria-label={copy.toolbar} className="flex flex-wrap items-center gap-1 border-b border-border bg-surface/50 px-2 py-1.5">
    <select className={control} aria-label={copy.font} disabled={!editable} value={state.inline.fontFamily ?? 'inherit'} onChange={event => apply({ fontFamily: event.target.value as AdvancedFormatting['fontFamily'] })}>
      {Object.keys(FONT_FAMILIES).map(key => <option key={key} value={key}>{copy[key as keyof typeof FONT_FAMILIES]}</option>)}
      {state.inline.fontFamily && !Object.hasOwn(FONT_FAMILIES, state.inline.fontFamily) && <option value={state.inline.fontFamily}>{state.inline.fontFamily}</option>}
    </select>
    <select className={control} aria-label={copy.size} disabled={!editable} value={state.inline.fontSize ?? ''} onChange={event => apply({ fontSize: event.target.value ? Number(event.target.value) : null })}>
      <option value="">{copy.size}</option>{FONT_SIZES.map(size => <option key={size} value={size}>{size} pt</option>)}
      {state.inline.fontSize && !FONT_SIZES.includes(state.inline.fontSize) && <option value={state.inline.fontSize}>{state.inline.fontSize} pt</option>}
    </select>
    <select className={control} aria-label={copy.style} disabled={!editable} value={state.block.paragraphStyle ?? 'normal'} onChange={event => apply({ paragraphStyle: event.target.value as AdvancedFormatting['paragraphStyle'] })}>
      {PARAGRAPH_STYLES.map(style => <option key={style} value={style}>{copy[style]}</option>)}
    </select>
    <select className={control} aria-label={copy.line} disabled={!editable} value={state.block.lineHeight ?? ''} onChange={event => apply({ lineHeight: event.target.value ? Number(event.target.value) : null })}>
      <option value="">{copy.line}</option>{LINE_HEIGHTS.map(value => <option key={value} value={value}>{value}</option>)}
      {state.block.lineHeight && !LINE_HEIGHTS.includes(state.block.lineHeight) && <option value={state.block.lineHeight}>{state.block.lineHeight}</option>}
    </select>
    <label className="inline-flex items-center gap-1 text-xs text-text-primary">{copy.color}<input className="h-7 w-7 cursor-pointer rounded border border-border" type="color" aria-label={copy.color} disabled={!editable} value={state.inline.color ?? '#000000'} onChange={event => apply({ color: event.target.value })} /></label>
    <button type="button" className={button} title={copy.noColor} aria-label={copy.noColor} disabled={!editable || !state.inline.color} onMouseDown={event => event.preventDefault()} onClick={() => apply({ color: null })}><RemoveFormatting size={14} /></button>
    <label className="inline-flex items-center gap-1 text-xs text-text-primary">{copy.highlight}<input className="h-7 w-7 cursor-pointer rounded border border-border" type="color" aria-label={copy.highlight} disabled={!editable} value={state.inline.highlight ?? '#fff2a8'} onChange={event => apply({ highlight: event.target.value })} /></label>
    <button type="button" className={button} title={copy.noHighlight} aria-label={copy.noHighlight} disabled={!editable || !state.inline.highlight} onMouseDown={event => event.preventDefault()} onClick={() => apply({ highlight: null })}><RemoveFormatting size={14} /></button>
    {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify]] as const).map(([alignment, Icon]) => <button key={alignment} type="button" className={button} title={copy[alignment]} aria-label={copy[alignment]} aria-pressed={(state.block.alignment ?? 'left') === alignment} disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={() => apply({ alignment })}><Icon size={15} /></button>)}
    <button type="button" className={button} title={copy.outdent} aria-label={copy.outdent} disabled={!editable || !(state.block.indent > 0)} onMouseDown={event => event.preventDefault()} onClick={() => apply({ indent: Math.max(0, (state.block.indent ?? 0) - 1) })}><IndentDecrease size={15} /></button>
    <button type="button" className={button} title={copy.indent} aria-label={copy.indent} disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={() => apply({ indent: (state.block.indent ?? 0) + 1 })}><IndentIncrease size={15} /></button>
    <button type="button" className={button} title={copy.sub} aria-label={copy.sub} aria-pressed={state.sub} disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={() => apply({ subscript: !state.sub })}><Subscript size={15} /></button>
    <button type="button" className={button} title={copy.sup} aria-label={copy.sup} aria-pressed={state.sup} disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={() => apply({ superscript: !state.sup })}><Superscript size={15} /></button>
    <button type="button" className={button} title={copy.page} aria-label={copy.page} disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().insertPageBreak().run()}><Scissors size={15} /></button>
    <label className="inline-flex items-center gap-1"><Table2 size={15} aria-hidden="true" /><select className={control} aria-label={copy.table} disabled={!editable} value="" onChange={event => chooseTable(event.target.value)}>
      <option value="">{copy.table}</option><option value="insert">{copy.insert}</option>
      {(['row', 'column', 'deleteRow', 'deleteColumn', 'merge', 'split', 'header', 'deleteTable'] as const).map(action => <option key={action} value={action} disabled={!state.table}>{copy[action]}</option>)}
    </select></label>
    <button type="button" className={button} title={copy.clear} aria-label={copy.clear} disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={() => { apply({ fontFamily: 'inherit', fontSize: null, color: null, highlight: null, alignment: 'left', lineHeight: null, indent: 0, paragraphStyle: 'normal', subscript: false, superscript: false }); editor.chain().focus().unsetAllMarks().run(); }}><RemoveFormatting size={15} /></button>
  </div>;
}
