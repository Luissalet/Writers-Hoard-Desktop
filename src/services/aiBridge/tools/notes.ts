// ============================================================================
// AI bridge tools — notes and the project-less inbox
// ============================================================================
//
// Notes are deliberately flat: plain text, no title, no rich text. The inbox
// (`GLOBAL_NOTES_SCOPE`) is a real scope id, not a null project, so the same
// table and ops serve both.

import type { Note, NoteKind } from '@/engines/notes/types';
import { GLOBAL_NOTES_SCOPE, noteTitle } from '@/engines/notes/types';
import { createNote, getNote, getNotes, updateNote } from '@/engines/notes/operations';
import { generateId } from '@/utils/idGenerator';
import {
  assertEngineEnabled,
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
  return optBoolean(args, 'inbox') === true ? GLOBAL_NOTES_SCOPE : resolveProjectId(args);
}

export async function whListNotes(args: ToolArgs): Promise<unknown> {
  const scope = noteScope(args);
  const kind = optEnum(args, 'kind', KINDS);
  const limit = clampLimit(optNumber(args, 'limit'), 50, 300);
  let notes = await getNotes(scope);
  if (kind) notes = notes.filter((note) => note.kind === kind);
  return {
    scope: scope === GLOBAL_NOTES_SCOPE ? 'inbox' : scope,
    total: notes.length,
    notes: notes.slice(0, limit).map((note) => ({
      id: note.id,
      kind: note.kind,
      title: noteTitle(note),
      text: note.text,
      source: note.source,
      tags: note.tags,
      pinned: note.pinned,
      updatedAt: note.updatedAt,
    })),
  };
}

export async function whCreateNote(args: ToolArgs): Promise<unknown> {
  // The inbox belongs to no project, so no engine can be off in it. A note
  // aimed at a project goes through the same gate as everything else.
  const scope = optBoolean(args, 'inbox') === true
    ? GLOBAL_NOTES_SCOPE
    : await resolveProjectForEngine(args, 'notes');
  const now = Date.now();
  const note: Note = {
    id: generateId('note'),
    projectId: scope,
    kind: optEnum(args, 'kind', KINDS) ?? 'note',
    text: requireString(args, 'text'),
    source: optString(args, 'source'),
    tags: optStringArray(args, 'tags') ?? [],
    pinned: optBoolean(args, 'pinned') ?? false,
    createdAt: now,
    updatedAt: now,
  };
  await createNote(note);
  return withAudit(
    { id: note.id, title: noteTitle(note), created: true },
    {
      projectId: scope,
      entityId: note.id,
      summary: `captured ${note.kind} "${noteTitle(note, 40)}"`,
    },
  );
}

export async function whUpdateNote(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const existing = await getNote(id);
  if (!existing) throw new BridgeError('not-found', `No note with id "${id}".`);
  if (existing.projectId !== GLOBAL_NOTES_SCOPE) {
    await assertEngineEnabled(existing.projectId, 'notes');
  }

  const changes: Partial<Note> = {};
  const text = optString(args, 'text');
  if (text !== undefined) changes.text = text;
  const kind = optEnum(args, 'kind', KINDS);
  if (kind !== undefined) changes.kind = kind;
  const source = optString(args, 'source');
  if (source !== undefined) changes.source = source;
  const tags = optStringArray(args, 'tags');
  if (tags !== undefined) changes.tags = tags;
  const pinned = optBoolean(args, 'pinned');
  if (pinned !== undefined) changes.pinned = pinned;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await updateNote(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: existing.projectId,
      entityId: id,
      summary: `updated note "${noteTitle(existing, 40)}"`,
      before: { text: existing.text, kind: existing.kind, tags: existing.tags },
    },
  );
}
