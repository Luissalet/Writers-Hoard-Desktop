import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CodexLink } from '@/components/editor/codexBlocks/CodexLink';
import Image from '@tiptap/extension-image';
import { db } from '@/db';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import { createAdvancedExtensions, normalizeAdvancedHtml } from '@/components/editor/advanced';
import { createRevisionExtensions } from '@/engines/writings/revisions';
import { createEditorialExtensions, describeEditorial, describeEditorialReferences, executeEditorialOperation, citationFromReference, type EditorialOperation } from '@/engines/writings/editorial';
import { getWriting, updateWriting, WritingConflictError } from '@/engines/writings/operations';
import { takeSnapshot } from '@/engines/writings/snapshots';
import { countWords } from '@/utils/text';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { generateId } from '@/utils/idGenerator';
import type { Writing } from '@/types';
import type { Citation } from '@/types/projectTools';
import { assertEngineEnabled, assertRowInScope, BridgeError, requireString, withAudit, type ToolArgs } from './shared';

/** The same chapter schema is used for editorial and language operations. */
export function createWritingEditor(content: string): Editor {
  return new Editor({ element: document.createElement('div'), extensions: [StarterKit.configure({ link: false }), CodexLink.configure({ openOnClick: false }), Image.configure({ allowBase64: true }), FootnoteNode, ...createAdvancedExtensions(), ...createRevisionExtensions(), ...createEditorialExtensions()], content: normalizeAdvancedHtml(content) });
}
export async function writingForEditorial(args: ToolArgs, editing: boolean): Promise<Writing> {
  const writing = await getWriting(requireString(args, 'id'));
  if (!writing) throw new BridgeError('not-found', 'No se encuentra ese capítulo.');
  assertRowInScope(args, writing.projectId);
  if (editing) {
    await assertEngineEnabled(writing.projectId, 'writings');
    if (args.expectedUpdatedAt !== undefined && args.expectedUpdatedAt !== writing.updatedAt) throw new BridgeError('conflict', 'El capítulo cambió. Consulta de nuevo su documento.');
  }
  return writing;
}
export async function persistEditorialWriting(writing: Writing, editor: Editor, summary: string) {
  const content = sanitizeRichHtml(editor.getHTML());
  if (content === writing.content) return { id: writing.id, changed: false, updatedAt: writing.updatedAt };
  await takeSnapshot(writing, 'pre-ai');
  try { await updateWriting(writing.id, { content, wordCount: countWords(content) }, writing.updatedAt); }
  catch (error) { if (error instanceof WritingConflictError) throw new BridgeError('conflict', 'El capítulo cambió durante la edición. Se conserva la versión previa.'); throw error; }
  const saved = await getWriting(writing.id);
  return withAudit({ id: writing.id, changed: true, updatedAt: saved?.updatedAt, editorial: describeEditorial(editor) }, { projectId: writing.projectId, entityId: writing.id, table: 'writings', kind: 'update', before: { content: writing.content, wordCount: writing.wordCount }, summary });
}
export async function whGetWritingEditorial(args: ToolArgs) {
  const writing = await writingForEditorial(args, false); const editor = createWritingEditor(writing.content);
  try {
    const references = await db.citations.where('projectId').equals(writing.projectId).toArray();
    return { id: writing.id, projectId: writing.projectId, updatedAt: writing.updatedAt, ...describeEditorial(editor), references, notices: describeEditorialReferences(editor, references) };
  } finally { editor.destroy(); }
}
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The table a data station handed over with a source (wh_import_evidence nightingale), inserted as it came: header row,
 * one row per data row and a caption paragraph that cites the source. No figure passes through the agent.
 */
async function insertDataTable(writing: Writing, request: Record<string, unknown>, references: Citation[]) {
  const reference = references.find(source => source.id === request.sourceId);
  if (!reference) throw new BridgeError('not-found', 'La fuente no pertenece al proyecto del capítulo.');
  const table = reference.dataTable;
  if (!table) throw new BridgeError('bad-args', 'Esa fuente no trae una tabla de datos: archívala con wh_import_evidence {nightingale}.');
  const caption = typeof request.caption === 'string' && request.caption.trim() ? request.caption.trim() : reference.title;
  const editor = createWritingEditor(writing.content);
  try {
    const size = editor.state.doc.content.size;
    const at = request.at === undefined ? size : request.at;
    if (typeof at !== 'number' || !Number.isInteger(at) || at < 0 || at > size) throw new BridgeError('bad-args', `at es una posición entre 0 y ${size}.`);
    const cell = (value: unknown) => escapeHtml(value === null || value === undefined ? '' : String(value));
    const html = `<table><tbody><tr>${table.columns.map(c => `<th>${cell(c)}</th>`).join('')}</tr>`
      + table.rows.map(row => `<tr>${row.map(v => `<td>${cell(v)}</td>`).join('')}</tr>`).join('')
      + `</tbody></table><p>${escapeHtml(caption)}</p>`;
    if (!editor.commands.insertContentAt(at, html)) throw new BridgeError('bad-args', 'No se puede insertar la tabla en esa posición.');
    // The caption is the first paragraph after the inserted table: the citation goes at its end.
    let end = -1, afterTable = false;
    editor.state.doc.descendants((node, pos) => {
      if (end >= 0) return false;
      if (pos < at) return node.type.name !== 'table';
      if (node.type.name === 'table') { afterTable = true; return false; }
      if (afterTable && node.type.name === 'paragraph' && node.textContent === caption) { end = pos + 1 + node.content.size; return false; }
      return true;
    });
    if (end < 0) throw new BridgeError('tool-error', 'No se encontró el pie de la tabla insertada.');
    const citation = citationFromReference(reference, { id: generateId('citation'), label: typeof request.label === 'string' ? request.label : reference.title, locator: typeof request.locator === 'string' ? request.locator : undefined });
    const result = executeEditorialOperation(editor, { kind: 'insertCitation', citation, range: { from: end, to: end } }, { from: 0, to: editor.state.doc.content.size });
    if (!result.ok) throw new BridgeError('bad-args', result.reason ?? 'No se pudo citar la tabla.');
    return await persistEditorialWriting(writing, editor, `inserted data table ${table.ref}${table.version !== undefined ? ` v${table.version}` : ''}`);
  } finally { editor.destroy(); }
}

export async function whEditWritingEditorial(args: ToolArgs) {
  const writing = await writingForEditorial(args, true);
  if (!args.operation || typeof args.operation !== 'object' || Array.isArray(args.operation)) throw new BridgeError('bad-args', 'Indica una operación editorial.');
  const request = args.operation as Record<string, unknown>;
  const references = await db.citations.where('projectId').equals(writing.projectId).toArray();
  if (request.kind === 'insertDataTable') return insertDataTable(writing, request, references);
  let operation: EditorialOperation;
  if (request.kind === 'insertCitation') {
    const reference = references.find(source => source.id === request.sourceId);
    if (!reference) throw new BridgeError('not-found', 'La fuente no pertenece al proyecto del capítulo.');
    if (typeof request.evidenceId === 'string' && !reference.researchEvidence?.some(evidence => evidence.id === request.evidenceId)) throw new BridgeError('bad-args', 'Ese extracto no pertenece a la fuente elegida.');
    operation = { kind: 'insertCitation', citation: citationFromReference(reference, { id: typeof request.citationId === 'string' ? request.citationId : generateId('citation'), label: typeof request.label === 'string' ? request.label : reference.title, locator: typeof request.locator === 'string' ? request.locator : undefined, evidenceId: typeof request.evidenceId === 'string' ? request.evidenceId : undefined }), range: request.range as { from: number; to: number } | undefined };
  } else if (request.kind === 'refreshReferences' || request.kind === 'bibliography') operation = { kind: request.kind, references };
  else if (['upsertStyle', 'applyStyle', 'removeStyle', 'setSection', 'removeCitation', 'list'].includes(String(request.kind))) operation = request as unknown as EditorialOperation;
  else throw new BridgeError('bad-args', 'Operación editorial desconocida. Consulta el catálogo.');
  const editor = createWritingEditor(writing.content);
  try {
    const result = executeEditorialOperation(editor, operation, { from: 0, to: editor.state.doc.content.size });
    if (!result.ok) throw new BridgeError('bad-args', result.reason ?? 'No se puede aplicar la operación.');
    return await persistEditorialWriting(writing, editor, `edited manuscript ${operation.kind}`);
  } finally { editor.destroy(); }
}
export const EDITORIAL_HANDLERS = { wh_get_writing_editorial: whGetWritingEditorial, wh_edit_writing_editorial: whEditWritingEditorial };
