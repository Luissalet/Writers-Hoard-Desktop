import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import { createAdvancedExtensions, normalizeAdvancedHtml } from '@/components/editor/advanced';
import { createRevisionExtensions, describeRevisions, proposeRevision, resolveRevisions, type RevisionOperationResult } from '@/engines/writings/revisions';
import { getWriting, updateWriting, WritingConflictError } from '@/engines/writings/operations';
import { takeSnapshot } from '@/engines/writings/snapshots';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { countWords } from '@/utils/text';
import type { Writing } from '@/types';
import { assertEngineEnabled, assertRowInScope, BridgeError, requireString, withAudit, type ToolArgs } from './shared';

function editorFor(content: string) {
  return new Editor({ element: document.createElement('div'), extensions: [StarterKit.configure({ link: { openOnClick: false } }), Image.configure({ allowBase64: true }), FootnoteNode, ...createAdvancedExtensions(), ...createRevisionExtensions()], content: normalizeAdvancedHtml(content) });
}

async function writingFor(args: ToolArgs, editing: boolean) {
  const writing = await getWriting(requireString(args, 'id'));
  if (!writing) throw new BridgeError('not-found', 'No se encuentra ese capítulo.');
  assertRowInScope(args, writing.projectId);
  if (editing) {
    await assertEngineEnabled(writing.projectId, 'writings');
    if (args.expectedUpdatedAt !== undefined && args.expectedUpdatedAt !== writing.updatedAt) throw new BridgeError('conflict', 'El capítulo ha cambiado. Consulta de nuevo su documento antes de proponer o resolver cambios.');
  }
  return writing;
}

function assertResult(result: RevisionOperationResult) {
  if (!result.ok) throw new BridgeError(result.reason === 'stale-source' ? 'conflict' : 'bad-args', result.message ?? 'La revisión no se puede aplicar a ese rango.');
}

async function persist(writing: Writing, editor: Editor, ids: string[]) {
  const content = sanitizeRichHtml(editor.getHTML());
  if (content === writing.content) return { id: writing.id, changed: false, updatedAt: writing.updatedAt, revisionIds: ids };
  await takeSnapshot(writing, 'pre-ai');
  try { await updateWriting(writing.id, { content, wordCount: countWords(content) }, writing.updatedAt); }
  catch (error) {
    if (error instanceof WritingConflictError) throw new BridgeError('conflict', 'El capítulo cambió durante la revisión. Consulta su versión actual; se conserva la recuperación previa.');
    throw error;
  }
  const saved = await getWriting(writing.id);
  return withAudit({ id: writing.id, changed: true, updatedAt: saved?.updatedAt, revisionIds: ids, revisions: describeRevisions(editor) }, {
    projectId: writing.projectId, entityId: writing.id, before: { content: writing.content, wordCount: writing.wordCount }, summary: `reviewed proposed changes of "${writing.title}"`,
  });
}

export async function whGetWritingRevisions(args: ToolArgs) {
  const writing = await writingFor(args, false);
  const editor = editorFor(writing.content);
  try { return { id: writing.id, projectId: writing.projectId, updatedAt: writing.updatedAt, revisions: describeRevisions(editor) }; }
  finally { editor.destroy(); }
}

export async function whProposeWritingRevision(args: ToolArgs) {
  const writing = await writingFor(args, true);
  if (typeof args.from !== 'number' || typeof args.to !== 'number' || typeof args.text !== 'string' || (args.author !== undefined && typeof args.author !== 'string') || (args.source !== undefined && typeof args.source !== 'string')) throw new BridgeError('bad-args', 'La propuesta necesita from/to y texto literal, con autor y origen de texto.');
  const editor = editorFor(writing.content);
  try {
    const result = proposeRevision(editor, { from: args.from, to: args.to, text: args.text, author: typeof args.author === 'string' ? args.author : 'Faustus', source: typeof args.source === 'string' ? args.source : 'faustus' });
    assertResult(result);
    return await persist(writing, editor, result.ids);
  } finally { editor.destroy(); }
}

export async function whResolveWritingRevisions(args: ToolArgs) {
  const writing = await writingFor(args, true);
  if (!['accept', 'reject'].includes(String(args.decision)) || (args.ids !== undefined && (!Array.isArray(args.ids) || args.ids.some(id => typeof id !== 'string'))) || (args.from !== undefined && typeof args.from !== 'number') || (args.to !== undefined && typeof args.to !== 'number') || ((args.from === undefined) !== (args.to === undefined))) throw new BridgeError('bad-args', 'Indica accept o reject y una selección válida o ids de cambios.');
  const editor = editorFor(writing.content);
  try {
    const result = resolveRevisions(editor, { decision: args.decision as 'accept' | 'reject', ids: args.ids as string[] | undefined, from: args.from as number | undefined, to: args.to as number | undefined, scopeFrom: 0, scopeTo: editor.state.doc.content.size });
    assertResult(result);
    return await persist(writing, editor, result.ids);
  } finally { editor.destroy(); }
}

export const REVISION_HANDLERS: Record<string, (args: ToolArgs) => Promise<unknown>> = {
  wh_get_writing_revisions: whGetWritingRevisions,
  wh_propose_writing_revision: whProposeWritingRevision,
  wh_resolve_writing_revisions: whResolveWritingRevisions,
};
