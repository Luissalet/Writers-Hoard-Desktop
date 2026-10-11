import { Extension, Mark, Node, mergeAttributes, type AnyExtension, type Editor } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import { TableCell, TableHeader, TableKit } from '@tiptap/extension-table';
import { BLOCK_KEYS, FORMAT_ATTRIBUTES, INLINE_KEYS, formattingFromElement, formattingHtmlAttributes, normalizeAdvancedFormatting, normalizeColumnWidths, type AdvancedFormatting } from './model';
import { normalizeAdvancedHtml } from './interchange';

const TextFormat = Mark.create({
  name: 'advancedTextStyle',
  addAttributes() {
    return Object.fromEntries(INLINE_KEYS.map(key => [key, { default: null, rendered: false, parseHTML: (element: HTMLElement) => formattingFromElement(element)[key] ?? null }]));
  },
  parseHTML: () => [{ tag: 'span', getAttrs: element => INLINE_KEYS.some(key => element.hasAttribute(FORMAT_ATTRIBUTES[key])) ? {} : false }],
  renderHTML: ({ mark }) => ['span', formattingHtmlAttributes(mark.attrs, INLINE_KEYS), 0],
});

const Subscript = Mark.create({ name: 'subscript', excludes: 'superscript', parseHTML: () => [{ tag: 'sub' }], renderHTML: () => ['sub', 0] });
const Superscript = Mark.create({ name: 'superscript', excludes: 'subscript', parseHTML: () => [{ tag: 'sup:not([data-footnote])' }], renderHTML: () => ['sup', 0] });

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: { insertPageBreak: () => ReturnType };
  }
}

const PageBreak = Node.create({
  name: 'pageBreak', group: 'block', atom: true, selectable: true,
  parseHTML: () => [{ tag: 'div[data-wh-page-break]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-wh-page-break': 'true', class: 'wh-manual-page-break' })],
  addCommands() { return { insertPageBreak: () => ({ commands }) => commands.insertContent({ type: this.name }) }; },
});

const ParagraphFormat = Extension.create({
  name: 'advancedParagraphFormat',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { transformPastedHTML: html => normalizeAdvancedHtml(html) } })];
  },
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading'], attributes: Object.fromEntries(BLOCK_KEYS.map(key => [key, {
      default: null,
      parseHTML: (element: HTMLElement) => formattingFromElement(element)[key] ?? null,
      renderHTML: (attributes: Record<string, unknown>) => formattingHtmlAttributes({ [key]: attributes[key] }, [key]),
    }])) }];
  },
  onCreate() {
    const document = this.editor.view.dom.ownerDocument;
    if (document.getElementById('wh-advanced-editor-css')) return;
    const style = document.createElement('style');
    style.id = 'wh-advanced-editor-css';
    style.textContent = '.ProseMirror table{border-collapse:collapse;table-layout:fixed;width:100%;overflow:hidden}.ProseMirror td,.ProseMirror th{border:1px solid var(--color-border,#888);padding:.4em;position:relative;vertical-align:top}.ProseMirror th{font-weight:bold}.ProseMirror .selectedCell::after{background:rgba(180,150,80,.2);content:"";position:absolute;inset:0;pointer-events:none}.ProseMirror .column-resize-handle{position:absolute;right:-2px;top:0;bottom:0;width:4px;background:var(--color-accent-gold,#c9a35c)}.wh-manual-page-break{break-after:page;page-break-after:always;border-top:1px dashed var(--color-border,#888);height:1em;margin:1em 0}@media print{.wh-manual-page-break{border:0;height:0;margin:0}}';
    document.head.appendChild(style);
  },
});

const columnWidthAttribute = {
  default: null,
  parseHTML: (element: HTMLElement) => normalizeColumnWidths(element.getAttribute('data-wh-colwidth') ?? element.getAttribute('colwidth')),
  renderHTML: (attributes: Record<string, unknown>) => {
    const widths = normalizeColumnWidths(attributes.colwidth);
    return widths ? { 'data-wh-colwidth': widths.join(',') } : {};
  },
};
const PortableTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), colwidth: columnWidthAttribute }; } });
const PortableTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), colwidth: columnWidthAttribute }; } });

/** Added alongside StarterKit; no second editor, storage or history stack. */
export function createAdvancedExtensions(): AnyExtension[] {
  return [TextFormat, ParagraphFormat, Subscript, Superscript, PageBreak, TableKit.configure({ table: { resizable: true }, tableCell: false, tableHeader: false }), PortableTableCell, PortableTableHeader];
}

export interface EditorRange { from: number; to: number }
export function validEditorRange(editor: Editor, range: EditorRange): boolean {
  return Number.isInteger(range.from) && Number.isInteger(range.to) && range.from >= 0 && range.to >= range.from && range.to <= editor.state.doc.content.size;
}

/** One transaction: selections, block and inline changes undo together. */
export function applyAdvancedFormatting(editor: Editor, input: unknown, range?: EditorRange): boolean {
  if (range && !validEditorRange(editor, range)) return false;
  const format = normalizeAdvancedFormatting(input);
  if (!Object.keys(format).length) return false;
  const tr = editor.state.tr;
  if (range && tr.doc.resolve(range.from).parent.inlineContent && tr.doc.resolve(range.to).parent.inlineContent) tr.setSelection(TextSelection.create(tr.doc, range.from, range.to));
  const { from, to } = range ?? tr.selection;
  const inline = Object.fromEntries(INLINE_KEYS.filter(key => key in format).map(key => [key, format[key]]));
  if (Object.keys(inline).length) {
    const markType = editor.schema.marks.advancedTextStyle;
    if (!markType) return false;
    if (from === to) {
      const prior = (tr.storedMarks ?? tr.selection.$from.marks()).find(mark => mark.type === markType)?.attrs ?? {};
      const attrs = { ...prior, ...inline };
      tr.removeStoredMark(markType);
      if (INLINE_KEYS.some(key => attrs[key] !== null && attrs[key] !== undefined && attrs[key] !== 'inherit')) tr.addStoredMark(markType.create(attrs));
    } else {
      const segments: { from: number; to: number; attrs: Record<string, unknown> }[] = [];
      tr.doc.nodesBetween(from, to, (node, position) => {
        if (node.isText) segments.push({ from: Math.max(from, position), to: Math.min(to, position + node.nodeSize), attrs: { ...(node.marks.find(mark => mark.type === markType)?.attrs ?? {}), ...inline } });
      });
      for (const segment of segments) {
        tr.removeMark(segment.from, segment.to, markType);
        if (INLINE_KEYS.some(key => segment.attrs[key] !== null && segment.attrs[key] !== undefined && segment.attrs[key] !== 'inherit')) tr.addMark(segment.from, segment.to, markType.create(segment.attrs));
      }
    }
  }
  const block = Object.fromEntries(BLOCK_KEYS.filter(key => key in format).map(key => [key, format[key]]));
  if (Object.keys(block).length) tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...block });
  });
  for (const key of ['subscript', 'superscript'] as const) {
    if (format[key] === undefined) continue;
    const type = editor.schema.marks[key];
    if (!type) return false;
    if (format[key]) {
      const opposite = editor.schema.marks[key === 'subscript' ? 'superscript' : 'subscript'];
      if (from === to) { tr.removeStoredMark(opposite); tr.addStoredMark(type.create()); }
      else { tr.removeMark(from, to, opposite); tr.addMark(from, to, type.create()); }
    } else if (from === to) tr.removeStoredMark(type);
    else tr.removeMark(from, to, type);
  }
  editor.view.dispatch(tr);
  return true;
}

export function describeAdvancedDocument(editor: Editor) {
  const blocks: { from: number; to: number; type: string; formatting: AdvancedFormatting }[] = [];
  const marks: { from: number; to: number; type: string; formatting: AdvancedFormatting }[] = [];
  const tables: { from: number; rows: number; columns: number }[] = [];
  const pageBreaks: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') blocks.push({ from: pos, to: pos + node.nodeSize, type: node.type.name, formatting: normalizeAdvancedFormatting(node.attrs) });
    if (node.type.name === 'table') tables.push({ from: pos, rows: node.childCount, columns: TableMap.get(node).width });
    if (node.type.name === 'pageBreak') pageBreaks.push(pos);
    if (node.isText) for (const mark of node.marks) {
      if (['advancedTextStyle', 'subscript', 'superscript'].includes(mark.type.name)) marks.push({ from: pos, to: pos + node.nodeSize, type: mark.type.name, formatting: normalizeAdvancedFormatting(mark.attrs) });
    }
  });
  return { selection: { from: editor.state.selection.from, to: editor.state.selection.to }, blocks, marks, tables, pageBreaks };
}
