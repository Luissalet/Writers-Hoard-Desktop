import { db } from '@/db';
import { listEraRows, mutateEraRows } from '@/services/worldEras/store';
import type { EraRow } from '@/services/worldEras/types';
import { generateId } from '@/utils/idGenerator';
import { countWords } from '@/utils/text';
import type { PaneDocument } from './parallelDrafts';
import type { SnapshotReason, WritingSnapshot, WritingSnapshotMeta } from './snapshotTypes';

type DraftScope = Pick<PaneDocument, 'projectId' | 'eraId' | 'writingId' | 'draftId'>;
function belongs(row: WritingSnapshot, scope: DraftScope) { return row.kind === 'parallel-draft-history' && row.projectId === scope.projectId && row.writingId === scope.writingId && row.sourceDraftId === scope.draftId; }

export async function listParallelDraftHistory(scope: DraftScope): Promise<WritingSnapshotMeta[]> {
  if (!scope.draftId) throw Error('parallel_draft_required');
  const result: WritingSnapshotMeta[] = [];
  const consume = (row: WritingSnapshot) => {
    if (!belongs(row, scope)) return;
    const { id, writingId, projectId, title, wordCount, reason, createdAt, kind, draftName, sourceDraftId, sourceDraftVersion } = row;
    result.push({ id, writingId, projectId, title, wordCount, reason, createdAt, kind, draftName, sourceDraftId, sourceDraftVersion });
  };
  if (scope.eraId) (await listEraRows<WritingSnapshot>(scope, 'writingSnapshots')).forEach(consume);
  else await db.writingSnapshots.where('writingId').equals(scope.writingId).each(consume);
  return result.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export async function readParallelDraftHistory(scope: DraftScope, id: string): Promise<WritingSnapshot> {
  const row = scope.eraId ? (await listEraRows<WritingSnapshot>(scope, 'writingSnapshots')).find(row => row.id === id) : await db.writingSnapshots.get(id);
  if (!scope.draftId || !row || !belongs(row, scope)) throw Error('parallel_draft_history_missing');
  return row;
}

/** Called inside the draft write transaction; history and replacement commit together. */
export async function recordParallelDraftHistory(document: PaneDocument, reason: SnapshotReason = 'auto'): Promise<string> {
  if (!document.draftId) throw Error('parallel_draft_required');
  const latest = (await listParallelDraftHistory(document))[0];
  if (reason === 'auto' && latest && (await readParallelDraftHistory(document, latest.id)).content === document.content) return latest.id;
  const row: WritingSnapshot = { id: generateId('wdhist'), projectId: document.projectId, writingId: document.writingId, title: document.title, content: document.content, wordCount: countWords(document.content), reason, createdAt: Math.max(Date.now(), (latest?.createdAt ?? 0) + 1), kind: 'parallel-draft-history', sourceDraftId: document.draftId, sourceDraftVersion: document.version, draftName: document.draftName };
  if (document.eraId) await mutateEraRows(document, [{ table: 'writingSnapshots', id: row.id, row: row as unknown as EraRow }]);
  else await db.writingSnapshots.add(row);
  return row.id;
}
