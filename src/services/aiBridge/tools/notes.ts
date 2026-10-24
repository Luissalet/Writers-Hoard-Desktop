// ============================================================================
// AI bridge tools — notes and the project-less inbox
// ============================================================================
//
// Notes retain a plain projection and optional native rich formatting. The inbox
// (`GLOBAL_NOTES_SCOPE`) is a real scope id, not a null project, so the same
// table and ops serve both.

import { normalizeNoteContent } from '@/engines/notes/content';
import { isInlineRaster } from '@/components/editor/blocks/imageLayout';
import type { Note, NoteKind } from '@/engines/notes/types';
import { GLOBAL_NOTES_SCOPE, noteTitle } from '@/engines/notes/types';
import { createNote, getNote, getNotes, updateNote, deleteNote } from '@/engines/notes/operations';
import { scopedTableOps } from '@/services/worldEras/tableOps';
import { worldEraToolScope } from '@/services/worldEras/toolScope';
import { generateId } from '@/utils/idGenerator';
import {
  assertEngineEnabled,
  assertRowInScope,
  BridgeError,
  clampLimit,
  optBoolean,
  optEnum,
  optNumber,
  optString,
  optStringArray,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

const KINDS = ['note', 'quote', 'idea', 'word'] as const satisfies readonly NoteKind[];

/** The inbox is a scope, not a project — so it never needs an open project. */
function noteScope(args: ToolArgs): string {
  if (args.inbox === true && args.eraId !== undefined) throw new BridgeError('bad-args', 'The global inbox has no world eras. Omit eraId.');
  return optBoolean(args, 'inbox') === true ? GLOBAL_NOTES_SCOPE : resolveProjectId(args);
}
const noteOps = (args: ToolArgs) => scopedTableOps(worldEraToolScope(args), 'notes', 'projectId', { getAll: getNotes, getOne: getNote, create: createNote, update: updateNote, delete: deleteNote });

export async function whListNotes(args: ToolArgs): Promise<unknown> {
  const scope = noteScope(args);
  const kind = optEnum(args, 'kind', KINDS);
  const limit = clampLimit(optNumber(args, 'limit'), 50, 300);
  let notes = await noteOps(args).getAll(scope);
  if (kind) notes = notes.filter((note) => note.kind === kind);
  return {
    scope: scope === GLOBAL_NOTES_SCOPE ? 'inbox' : scope,
    total: notes.length,
    notes: notes.slice(0, limit).map((note) => ({
      id: note.id,
      kind: note.kind,
      title: noteTitle(note),
      text: note.text,
      ...(note.richHtml!==undefined?{richHtml:note.richHtml}:{}),
      source: note.source,
      tags: note.tags,
      pinned: note.pinned,
      updatedAt: note.updatedAt,
    })),
  };
}

export async function whCreateNote(args: ToolArgs): Promise<unknown> {
  noteScope(args);
  // The inbox belongs to no project, so no engine can be off in it. A note
  // aimed at a project goes through the same gate as everything else.
  const scope = optBoolean(args, 'inbox') === true
    ? GLOBAL_NOTES_SCOPE
    : await resolveProjectForEngine(args, 'notes');
  const now = Date.now();
  if (typeof args.text !== 'string') throw new BridgeError('bad-args', '"text" is required and must be a string.');
  const note: Note = normalizeNoteContent({
    id: generateId('note'),
    projectId: scope,
    kind: optEnum(args, 'kind', KINDS) ?? 'note',
    text: args.text,
    ...(args.richHtml!==undefined?{richHtml:requireString(args,'richHtml')}:{}),
    source: optString(args, 'source'),
    ...(optString(args, 'title')?.trim() ? { title: optString(args, 'title')!.trim().slice(0, 200) } : {}),
    tags: optStringArray(args, 'tags') ?? [],
    pinned: optBoolean(args, 'pinned') ?? false,
    createdAt: now,
    updatedAt: now,
  });
  if (!args.text.trim()) {
    const html = new DOMParser().parseFromString(note.richHtml ?? '', 'text/html');
    if (!note.text.trim() && ![...html.querySelectorAll('img')].some(image => isInlineRaster(image.getAttribute('src')))) throw new BridgeError('bad-args', 'Empty "text" requires normalized rich content or an embedded raster image.');
  }
  await noteOps(args).create(note);
  return withAudit(
    { id: note.id, title: noteTitle(note), created: true },
    {
      projectId: scope,
      entityId: note.id,
      table: 'notes',
      summary: `captured ${note.kind} "${noteTitle(note, 40)}"`,
    },
  );
}

export async function whUpdateNote(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  if (args.inbox === true && args.eraId !== undefined) noteScope(args);
  const existing = await noteOps(args).getOne(id);
  if (!existing) throw new BridgeError('not-found', `No note with id "${id}".`);
  if (existing.projectId !== GLOBAL_NOTES_SCOPE) {
    await assertEngineEnabled(existing.projectId, 'notes');
    assertRowInScope(args, existing.projectId);
  }

  const changes: Partial<Note> = {};
  const text = optString(args, 'text');
  if (text !== undefined) changes.text = text;
  if(args.richHtml===null)changes.richHtml=undefined;else if(args.richHtml!==undefined)changes.richHtml=requireString(args,'richHtml');
  const kind = optEnum(args, 'kind', KINDS);
  if (kind !== undefined) changes.kind = kind;
  const source = optString(args, 'source');
  if (source !== undefined) changes.source = source;
  if (args.title === null) changes.title = undefined;
  else { const title = optString(args, 'title'); if (title !== undefined) changes.title = title.trim().slice(0, 200) || undefined; }
  const tags = optStringArray(args, 'tags');
  if (tags !== undefined) changes.tags = tags;
  const pinned = optBoolean(args, 'pinned');
  if (pinned !== undefined) changes.pinned = pinned;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  const normalized=normalizeNoteContent(changes);
  await noteOps(args).update(id, normalized);
  return withAudit(
    { id, updated: Object.keys(normalized) },
    {
      projectId: existing.projectId,
      entityId: id,
      table: 'notes',
      summary: `updated note "${noteTitle(existing, 40)}"`,
      before: { richHtml:existing.richHtml,title:existing.title,cover:existing.cover,text: existing.text, kind: existing.kind, tags: existing.tags, source: existing.source, pinned: existing.pinned, __absent: (['source','title','cover','richHtml'] as const).filter(key=>existing[key]===undefined) },
    },
  );
}
