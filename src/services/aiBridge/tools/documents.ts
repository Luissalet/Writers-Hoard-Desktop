import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { CellSelection } from '@tiptap/pm/tables';
import { TextSelection } from '@tiptap/pm/state';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import { applyAdvancedFormatting, createAdvancedExtensions, describeAdvancedDocument, normalizeAdvancedFormatting, normalizeAdvancedHtml, validEditorRange } from '@/components/editor/advanced';
import { getWriting, updateWriting, WritingConflictError } from '@/engines/writings/operations';
import { takeSnapshot } from '@/engines/writings/snapshots';
import { countWords } from '@/utils/text';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { callDocumentTool } from '@/services/documents/client';
import { NATIVE_DOCUMENT_ACTIONS } from '../manifestDocuments';
import { assertEngineEnabled, assertRowInScope, BridgeError, requireString, withAudit, type ToolArgs } from './shared';
import type { Writing } from '@/types';
import { createRevisionExtensions } from '@/engines/writings/revisions';

function editorFor(html: string): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), Image.configure({ allowBase64: true }), FootnoteNode, ...createAdvancedExtensions(), ...createRevisionExtensions()],
    content: normalizeAdvancedHtml(html),
  });
}

async function writingFor(args: ToolArgs, editing: boolean): Promise<Writing> {
  const writing = await getWriting(requireString(args, 'id'));
  if (!writing) throw new BridgeError('not-found', 'No se encuentra ese capítulo.');
  assertRowInScope(args, writing.projectId);
  if (editing) {
    await assertEngineEnabled(writing.projectId, 'writings');
    if (args.expectedUpdatedAt !== undefined && args.expectedUpdatedAt !== writing.updatedAt) {
      throw new BridgeError('conflict', 'El capítulo ha cambiado. Consulta su documento actualizado antes de editar.');
    }
  }
  return writing;
}

function rangeFor(editor: Editor, args: ToolArgs, all: boolean) {
  const given = args.from !== undefined || args.to !== undefined;
  if (!given) return all ? { from: 1, to: Math.max(1, editor.state.doc.content.size - 1) } : undefined;
  const from = args.from;
  const to = args.to ?? from;
  if (typeof from !== 'number' || typeof to !== 'number' || !validEditorRange(editor, { from, to })) {
    throw new BridgeError('bad-args', 'from/to deben ser posiciones ProseMirror válidas del documento consultado.');
  }
  return { from, to };
}

async function persistEdit(writing: Writing, editor: Editor) {
  const content = sanitizeRichHtml(editor.getHTML());
  if (content === writing.content) return { id: writing.id, changed: false, updatedAt: writing.updatedAt };
  await takeSnapshot(writing, 'pre-ai');
  try {
    await updateWriting(writing.id, { content, wordCount: countWords(content) }, writing.updatedAt);
  } catch (error) {
    if (error instanceof WritingConflictError) throw new BridgeError('conflict', 'El capítulo cambió durante la edición. La versión propuesta se ha conservado en su historial.');
    throw error;
  }
  const saved = await getWriting(writing.id);
  return withAudit({ id: writing.id, changed: true, updatedAt: saved?.updatedAt, wordCount: saved?.wordCount }, {
    projectId: writing.projectId, entityId: writing.id,
    before: { content: writing.content, wordCount: writing.wordCount },
    summary: `edited rich document of "${writing.title}"`,
  });
}

export async function whGetWritingDocument(args: ToolArgs) {
  const writing = await writingFor(args, false);
  const editor = editorFor(writing.content);
  try {
    const cells: { from: number; to: number; type: string }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') cells.push({ from: pos, to: pos + node.nodeSize, type: node.type.name });
    });
    return { id: writing.id, projectId: writing.projectId, updatedAt: writing.updatedAt,
      html: editor.getHTML(), document: editor.getJSON(), ...describeAdvancedDocument(editor), cells };
  } finally { editor.destroy(); }
}

export async function whFormatWriting(args: ToolArgs) {
  const writing = await writingFor(args, true);
  const supplied = args.format;
  const format = normalizeAdvancedFormatting(supplied);
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || !Object.keys(format).length || Object.keys(supplied).some(key => !Object.hasOwn(format, key))) {
    throw new BridgeError('bad-args', 'format contiene atributos desconocidos o valores no válidos.');
  }
  const editor = editorFor(writing.content);
  try {
    if (!applyAdvancedFormatting(editor, format, rangeFor(editor, args, true))) throw new BridgeError('bad-args', 'No se pudo aplicar el formato a ese rango.');
    return await persistEdit(writing, editor);
  } finally { editor.destroy(); }
}

const TABLE_OPERATIONS = ['addRowBefore', 'addRowAfter', 'deleteRow', 'addColumnBefore', 'addColumnAfter', 'deleteColumn', 'mergeCells', 'splitCell', 'deleteTable'] as const;

export async function whEditWritingDocument(args: ToolArgs) {
  const writing = await writingFor(args, true);
  const operation = requireString(args, 'operation');
  const editor = editorFor(writing.content);
  try {
    const range = rangeFor(editor, args, false);
    if (range) {
      try {
        const selection = operation === 'mergeCells'
          ? CellSelection.create(editor.state.doc, range.from, range.to)
          : TextSelection.between(editor.state.doc.resolve(range.from), editor.state.doc.resolve(range.to));
        editor.view.dispatch(editor.state.tr.setSelection(selection));
      } catch { throw new BridgeError('bad-args', 'Ese rango no selecciona celdas o texto compatibles con la operación.'); }
    } else editor.commands.setTextSelection(Math.max(1, editor.state.doc.content.size - 1));
    let applied = false;
    if (operation === 'insertTable') {
      const rows = args.rows ?? 3, cols = args.cols ?? 3;
      if (typeof rows !== 'number' || typeof cols !== 'number' || !Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) throw new BridgeError('bad-args', 'rows y cols deben ser enteros positivos.');
      applied = editor.commands.insertTable({ rows, cols, withHeaderRow: true });
    } else if (operation === 'insertPageBreak') applied = editor.commands.insertPageBreak();
    else if (operation === 'replaceSelection') {
      if (!range || typeof args.text !== 'string') throw new BridgeError('bad-args', 'replaceSelection necesita from/to y text, que puede ser vacío.');
      editor.view.dispatch(editor.state.tr.insertText(args.text, editor.state.selection.from, editor.state.selection.to));
      applied = true;
    } else if ((TABLE_OPERATIONS as readonly string[]).includes(operation)) {
      applied = editor.commands[operation as typeof TABLE_OPERATIONS[number]]();
    } else throw new BridgeError('bad-args', `Operación desconocida: ${operation}`);
    if (!applied) throw new BridgeError('bad-args', 'La operación no se puede aplicar a la selección actual.');
    return await persistEdit(writing, editor);
  } finally { editor.destroy(); }
}

export const DOCUMENT_HANDLERS: Record<string, (args: ToolArgs) => Promise<unknown>> = {
  ...Object.fromEntries(Object.keys(NATIVE_DOCUMENT_ACTIONS).map(tool => [tool, async (args: ToolArgs) => {
    const reply = await callDocumentTool(tool, args);
    if (!reply.ok) throw new BridgeError(reply.code || 'tool-error', reply.error || 'Document operation failed');
    return reply.result;
  }])),
  wh_get_writing_document: whGetWritingDocument,
  wh_format_writing: whFormatWriting,
  wh_edit_writing_document: whEditWritingDocument,
};
