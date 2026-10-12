import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
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
import { assertEngineEnabled, assertRowInScope, BridgeError, requireString, withAudit, type ToolArgs } from './shared';

/** The same chapter schema is used for editorial and language operations. */
export function createWritingEditor(content: string): Editor {
  return new Editor({ element: document.createElement('div'), extensions: [StarterKit.configure({ link: { openOnClick: false } }), Image.configure({ allowBase64: true }), FootnoteNode, ...createAdvancedExtensions(), ...createRevisionExtensions(), ...createEditorialExtensions()], content: normalizeAdvancedHtml(content) });
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
  return withAudit({ id: writing.id, changed: true, updatedAt: saved?.updatedAt, editorial: describeEditorial(editor) }, { projectId: writing.projectId, entityId: writing.id, before: { content: writing.content, wordCount: writing.wordCount }, summary });
}
export async function whGetWritingEditorial(args: ToolArgs) {
  const writing = await writingForEditorial(args, false); const editor = createWritingEditor(writing.content);
  try {
    const references = await db.citations.where('projectId').equals(writing.projectId).toArray();
    return { id: writing.id, projectId: writing.projectId, updatedAt: writing.updatedAt, ...describeEditorial(editor), references, notices: describeEditorialReferences(editor, references) };
  } finally { editor.destroy(); }
}
export async function whEditWritingEditorial(args: ToolArgs) {
  const writing = await writingForEditorial(args, true);
  if (!args.operation || typeof args.operation !== 'object' || Array.isArray(args.operation)) throw new BridgeError('bad-args', 'Indica una operación editorial.');
  const request = args.operation as Record<string, unknown>;
  const references = await db.citations.where('projectId').equals(writing.projectId).toArray();
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
