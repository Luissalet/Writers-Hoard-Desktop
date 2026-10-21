import { db } from '@/db';
import { eraWritingOperations, eraSnapshotOperations } from '@/services/worldEras/writings';
import { listEraRows, mutateEraRows } from '@/services/worldEras/store';
import type { EraRow } from '@/services/worldEras/types';
import { generateId } from '@/utils/idGenerator';
import { countWords } from '@/utils/text';
import { touchProject } from '@/db/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { replaceWritingWithSnapshot, WritingConflictError, WritingGoneError } from './operations';
import type { WritingSnapshot } from './snapshotTypes';
import { readParallelDraftHistory, recordParallelDraftHistory } from './parallelDraftHistory';

export interface PaneTarget { writingId: string; draftId?: string }
export interface PaneDocument extends PaneTarget { eraId?: string; projectId: string; title: string; content: string; version: number; draftName?: string; basedOnVersion: number }
export type ParallelDraftMeta = Pick<WritingSnapshot, 'id' | 'writingId' | 'projectId' | 'draftName' | 'createdAt' | 'updatedAt' | 'wordCount' | 'basedOnVersion'>;
export const paneTargetKey = (target: PaneTarget) => `${encodeURIComponent(target.writingId)}/${target.draftId ? encodeURIComponent(target.draftId) : 'current'}`;

export class PaneConflictError extends Error {
  readonly current: PaneDocument;
  readonly rejectedSnapshotId: string | null;
  constructor(current: PaneDocument, rejectedSnapshotId: string | null) { super('Document changed'); this.name = 'PaneConflictError'; this.current = current; this.rejectedSnapshotId = rejectedSnapshotId; }
}

export async function listParallelDraftMeta(projectId: string, writingId: string, eraId?: string): Promise<ParallelDraftMeta[]> {
  const rows: ParallelDraftMeta[] = [];
  const consume = (row: WritingSnapshot) => {
    if (row.kind !== 'parallel-draft' || row.projectId !== projectId) return;
    const { id, writingId, projectId: owner, draftName, createdAt, updatedAt, wordCount, basedOnVersion } = row;
    rows.push({ id, writingId, projectId: owner, draftName, createdAt, updatedAt, wordCount, basedOnVersion });
  };
  if (eraId) (await listEraRows<WritingSnapshot>({ projectId, eraId }, 'writingSnapshots')).filter(row => row.writingId === writingId).forEach(consume);
  else await db.writingSnapshots.where('writingId').equals(writingId).each(consume);
  return rows.sort((a, b) => (a.draftName ?? '').localeCompare(b.draftName ?? '') || a.id.localeCompare(b.id));
}

export async function loadPaneDocument(projectId: string, target: PaneTarget, eraId?: string): Promise<PaneDocument> {
  const writing = await eraWritingOperations({ projectId, eraId }).getWriting(target.writingId);
  if (!writing || writing.projectId !== projectId || writing.isGoogleDoc) throw new WritingGoneError(target.writingId);
  if (!target.draftId) return { ...target, projectId, eraId, title: writing.title, content: writing.content, version: writing.updatedAt, basedOnVersion: writing.updatedAt };
  const draft = await eraSnapshotOperations({ projectId, eraId }).readSnapshot(target.draftId);
  if (!draft || draft.kind !== 'parallel-draft' || draft.projectId !== projectId || draft.writingId !== writing.id) throw new WritingGoneError(target.draftId);
  return { ...target, projectId, eraId, title: writing.title, content: draft.content, version: draft.updatedAt ?? draft.createdAt, draftName: draft.draftName, basedOnVersion: draft.basedOnVersion ?? writing.updatedAt };
}

export async function createParallelDraft(document: PaneDocument, name: string): Promise<ParallelDraftMeta> {
  const title = name.trim();
  if (!title || title.length > 100) throw new Error('Invalid draft name');
  return db.transaction('rw', document.eraId ? db.tables : [db.writings, db.writingSnapshots], async () => {
    const writing = await eraWritingOperations(document).getWriting(document.writingId);
    if (!writing || writing.projectId !== document.projectId) throw new WritingGoneError(document.writingId);
    const current = await loadPaneDocument(document.projectId, document, document.eraId);
    if (current.version !== document.version) throw new PaneConflictError(current, null);
    const existing = await listParallelDraftMeta(document.projectId, document.writingId, document.eraId);
    if (existing.some(row => row.draftName?.toLocaleLowerCase() === title.toLocaleLowerCase())) throw new Error('Duplicate draft name');
    const now = Date.now();
    const draft: WritingSnapshot = { id: generateId('wdraft'), writingId: writing.id, projectId: writing.projectId, title: writing.title, content: document.content, wordCount: countWords(document.content), reason: 'manual', kind: 'parallel-draft', draftName: title, basedOnVersion: document.basedOnVersion, createdAt: now, updatedAt: now };
    if (document.eraId) await mutateEraRows(document, [{ table: 'writingSnapshots', id: draft.id, row: draft as unknown as EraRow }]); else await db.writingSnapshots.add(draft);
    return { id: draft.id, writingId: draft.writingId, projectId: draft.projectId, draftName: draft.draftName, createdAt: draft.createdAt, updatedAt: draft.updatedAt, wordCount: draft.wordCount, basedOnVersion: draft.basedOnVersion };
  });
}

async function keepRejected(document: PaneDocument, content: string): Promise<string | null> {
  const snapshot = await eraSnapshotOperations(document).ensureSnapshot({ id: document.writingId, projectId: document.projectId, title: document.title, content }, 'manual');
  return snapshot.status === 'skipped-empty' ? null : snapshot.snapshotId;
}

/** The same CAS contract for canonical text and explicitly mutable alternatives. */
export async function savePaneDocument(document: PaneDocument, content: string, protectCurrent = false): Promise<number> {
  if (!document.draftId) {
    if (protectCurrent && !document.eraId) {
      const result = await replaceWritingWithSnapshot(document.writingId, { content, wordCount: countWords(content) }, document.version);
      if (result.status === 'gone') throw new WritingGoneError(document.writingId);
      if (result.status === 'conflict') throw new PaneConflictError({ ...document, title: result.current.title, content: result.current.content, version: result.current.updatedAt }, result.rejectedSnapshotId);
      return result.version;
    }
    try {
      if (protectCurrent) await eraSnapshotOperations(document).ensureSnapshot({ id: document.writingId, projectId: document.projectId, title: document.title, content: document.content }, 'manual');
      const version = await eraWritingOperations(document).updateWritingAtVersion(document.writingId, { content, wordCount: countWords(content) }, document.version);
      if (!document.eraId) void touchProject(document.projectId);
      notifyDataChanged({ source: 'other', table: 'writings', entityId: document.writingId, projectId: document.projectId });
      return version;
    } catch (error) {
      if (error instanceof WritingConflictError) throw new PaneConflictError({ ...document, title: error.current.title, content: error.current.content, version: error.current.updatedAt }, error.rejectedSnapshotId);
      throw error;
    }
  }
  const outcome = await db.transaction('rw', document.eraId ? db.tables : [db.writings, db.writingSnapshots], async () => {
    const current = await loadPaneDocument(document.projectId, document, document.eraId);
    if (current.version !== document.version) return { current };
    if (current.content !== content) await recordParallelDraftHistory(current, protectCurrent ? 'pre-restore' : 'auto');
    if (protectCurrent) await eraSnapshotOperations(document).ensureSnapshot({ id: document.writingId, projectId: document.projectId, title: current.title, content: current.content }, 'manual');
    const version = Math.max(Date.now(), current.version + 1);
    await updateDraft(document, { content, wordCount: countWords(content), updatedAt: version });
    return { version };
  });
  if (outcome.current) throw new PaneConflictError(outcome.current, await keepRejected(document, content));
  return outcome.version!;
}

/** Promotion replaces prose only; chapter title/date/status/order remain canonical. */
export async function promoteParallelDraft(projectId: string, draftId: string, expectedDraftVersion: number, expectedCurrentVersion: number, eraId?: string): Promise<number> {
  const outcome = await db.transaction('rw', eraId ? db.tables : [db.writings, db.writingSnapshots], async () => {
    const draft = await eraSnapshotOperations({ projectId, eraId }).readSnapshot(draftId);
    if (!draft || draft.kind !== 'parallel-draft' || draft.projectId !== projectId) throw new WritingGoneError(draftId);
    const document = await loadPaneDocument(projectId, { writingId: draft.writingId, draftId }, eraId);
    if (document.version !== expectedDraftVersion) return { conflict: document };
    const current = await loadPaneDocument(projectId, { writingId: draft.writingId }, eraId);
    if (current.version !== expectedCurrentVersion) return { conflict: current };
    await eraSnapshotOperations({ projectId, eraId }).ensureSnapshot({ id: current.writingId, projectId, title: current.title, content: current.content }, 'pre-restore');
    const version = await eraWritingOperations({ projectId, eraId }).updateWritingAtVersion(current.writingId, { content: document.content, wordCount: countWords(document.content) }, expectedCurrentVersion);
    return { version, writingId: current.writingId };
  });
  if (outcome.conflict) throw new PaneConflictError(outcome.conflict, null);
  if (!eraId) void touchProject(projectId);
  notifyDataChanged({ source: 'other', table: 'writings', entityId: outcome.writingId!, projectId });
  return outcome.version!;
}

export async function snapshotPaneText(document: PaneDocument, content: string): Promise<void> { await keepRejected(document, content); }

export async function restoreParallelDraftHistory(document: PaneDocument, historyId: string): Promise<number> {
  const row = await readParallelDraftHistory(document, historyId);
  return savePaneDocument(document, row.content, true);
}

export async function renameParallelDraft(document: PaneDocument, name: string): Promise<void> {
  if (!document.draftId || !name.trim() || name.trim().length > 100) throw new Error('Invalid draft name');
  await db.transaction('rw', document.eraId ? db.tables : [db.writings, db.writingSnapshots], async () => {
    const current = await loadPaneDocument(document.projectId, document, document.eraId);
    if (current.version !== document.version) throw new PaneConflictError(current, null);
    if ((await listParallelDraftMeta(document.projectId, document.writingId, document.eraId)).some(row => row.id !== document.draftId && row.draftName?.toLocaleLowerCase() === name.trim().toLocaleLowerCase())) throw new Error('Duplicate draft name');
    await updateDraft(document, { draftName: name.trim(), updatedAt: Math.max(Date.now(), document.version + 1) });
  });
}

export async function deleteParallelDraft(document: PaneDocument): Promise<void> {
  if (!document.draftId) throw new Error('Only an alternative can be deleted here');
  await db.transaction('rw', document.eraId ? db.tables : [db.writings, db.writingSnapshots], async () => {
    const current = await loadPaneDocument(document.projectId, document, document.eraId);
    if (current.version !== document.version) throw new PaneConflictError(current, null);
    await recordParallelDraftHistory(current, 'manual');
    await eraSnapshotOperations(document).ensureSnapshot({ id: current.writingId, projectId: current.projectId, title: current.title, content: current.content }, 'manual');
    await eraSnapshotOperations(document).deleteSnapshot(document.draftId!);
  });
}

async function updateDraft(document: PaneDocument, changes: Partial<WritingSnapshot>) {
  if (document.eraId) await mutateEraRows(document, [{ table: 'writingSnapshots', id: document.draftId!, changes }]);
  else await db.writingSnapshots.update(document.draftId!, changes);
}
