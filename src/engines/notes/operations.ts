// ============================================
// Notes Engine — Operations
// ============================================

import { db } from '@/db';
import { makeTableOps } from '@/engines/_shared';
import { generateId } from '@/utils/idGenerator';
import { GLOBAL_NOTES_SCOPE, type Note, type NoteKind } from './types';

const ops = makeTableOps<Note>({
  tableName: 'notes',
  scopeField: 'projectId',
  // Pinned first, then newest — the board always reads top-down as "what
  // matters, then what's fresh".
  sortFn: (a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt,
});

export const getNotes = ops.getAll;
export const getNote = ops.getOne;
export const createNote = ops.create;
export const updateNote = ops.update;
export const deleteNote = ops.delete;

/** Build a fresh note row. Shared by the composer, quick capture and imports. */
export function makeNote(
  projectId: string,
  fields: Partial<Note> & { text: string },
): Note {
  const now = Date.now();
  return {
    id: generateId('note'),
    projectId,
    kind: 'note',
    tags: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
    ...fields,
    text: fields.text.trim(),
  };
}

/** Move a note between scopes (inbox → project, or project → project). */
export async function moveNote(id: string, projectId: string): Promise<void> {
  await db.table('notes').update(id, { projectId, updatedAt: Date.now() });
}

/** How many notes are sitting in the project-less inbox (sidebar badge). */
export async function countInboxNotes(): Promise<number> {
  return db.table('notes').where('projectId').equals(GLOBAL_NOTES_SCOPE).count();
}

/**
 * Capture entry point used outside React (global shortcut IPC, services).
 * Returns the created note so callers can toast its title.
 */
export async function captureNote(args: {
  projectId: string;
  text: string;
  kind?: NoteKind;
  source?: string;
}): Promise<Note | null> {
  const text = args.text.trim();
  if (!text) return null;
  const note = makeNote(args.projectId, {
    text,
    kind: args.kind ?? 'note',
    source: args.source?.trim() || undefined,
  });
  await createNote(note);
  return note;
}
