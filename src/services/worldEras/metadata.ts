import { db } from '@/db';
import { validateArchivedMetadata } from '@/services/documentArchive/metadata';
import { hideEraDocument, readEraRow, readWorldDocument, saveEraDocument } from './store';
import type { EraDocumentKind, EraRow, WorldEraScope } from './types';

export async function saveRevisionedEraMetadata<T extends { id: string; revision: number; title: string; createdAt: number; updatedAt: number }>(scope: WorldEraScope, kind: EraDocumentKind, draft: T, expected: number | null, conflict: (current?: T) => Error, normalize: (draft: T, current?: T) => T = draft => draft): Promise<T> {
  return db.transaction('rw', db.tables, async () => {
    const read = await readWorldDocument(scope, kind, draft.id), current = read?.document.root as unknown as T | undefined;
    if (expected === null ? !!current : current?.revision !== expected) throw conflict(current);
    const now = Math.max(Date.now(), (current?.updatedAt ?? 0) + 1), next = { ...normalize(structuredClone(draft), current), title: draft.title.trim(), revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? draft.createdAt, updatedAt: now };
    if (!next.title) throw new Error('title_required');
    const refs = validateArchivedMetadata(kind === 'genealogy' ? 'relation-tree' : kind as Parameters<typeof validateArchivedMetadata>[0], next as unknown as EraRow);
    for (const id of refs) if (!await readEraRow(scope, 'codexEntries', id)) throw new Error('invalid_codex_link');
    return (await saveEraDocument(scope, kind, { root: next as unknown as EraRow, children: {} }, read?.version ?? null)).document.root as unknown as T;
  });
}
export async function archiveEraMetadata(scope: WorldEraScope, kind: EraDocumentKind, id: string, expected?: number, conflict: (current?: never) => Error = () => new Error('Document changed')): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const current = await readWorldDocument(scope, kind, id);
    if (!current || expected !== undefined && current.document.root.revision !== expected) throw conflict(current?.document.root as never);
    await hideEraDocument(scope, kind, id, current.version);
  });
}
