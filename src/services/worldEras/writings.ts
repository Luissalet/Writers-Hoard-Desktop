import Dexie from 'dexie';
import { db } from '@/db';
import { useMemo } from 'react';
import { countWords } from '@/utils/text';
import type { Writing } from '@/types';
import type { WritingSnapshot, SnapshotReason, WritingSnapshotMeta } from '@/engines/writings/snapshotTypes';
import * as ops from '@/engines/writings/operations';
import * as snapshots from '@/engines/writings/snapshots';
import { useWorldEraScope } from './hooks';
import { hideEraDocument, listEraRows, mutateEraRows, readEraRow, readWorldDocument, saveEraDocument } from './store';
import type { EraRow, WorldEraScope } from './types';
const undoSlots = new Map<string, { expected: string; bundle?: ops.DeletedWritingBundle; timer?: ReturnType<typeof setTimeout> }>();
function undoKey(scope: WorldEraScope) { return JSON.stringify([scope.projectId, scope.eraId]); }

export function eraWritingOperations(scope: WorldEraScope) {
  const key = undoKey(scope);
  const expectDeletedWriting = (id: string) => { if (!scope.eraId) return ops.expectDeletedWriting(id); const previous = undoSlots.get(key); if (previous?.timer) clearTimeout(previous.timer); undoSlots.set(key, { expected: id }); };
  const takeLastDeletedWriting = (id: string) => { if (!scope.eraId) return ops.takeLastDeletedWriting(id); const slot = undoSlots.get(key); if (slot?.expected !== id || !slot.bundle) return null; if (slot.timer) clearTimeout(slot.timer); undoSlots.delete(key); return slot.bundle; };
  const getWriting = (id: string) => scope.eraId ? readEraRow<Writing>(scope, 'writings', id) : ops.getWriting(id);
  const getWritings = (projectId: string) => scope.eraId ? listEraRows<Writing>(scope, 'writings') : ops.getWritings(projectId);
  const updateWritingAtVersion = async (id: string, changes: Partial<Writing>, expectedVersion?: number): Promise<number> => {
    if (!scope.eraId) return ops.updateWritingAtVersion(id, changes, expectedVersion);
    const outcome:{current?:Writing;rejectedSnapshotId?:string|null;version?:number}=await db.transaction('rw',db.tables,()=>Dexie.Promise.resolve(readWorldDocument(scope,'writings',id)).then(current=>{
      if(!current)throw new ops.WritingGoneError(id);
      const row=current.document.root as unknown as Writing;
      if(expectedVersion!==undefined&&row.updatedAt!==expectedVersion){
        if(changes.content!==undefined){
          const snapshot:WritingSnapshot={id:crypto.randomUUID(),projectId:scope.projectId,writingId:id,title:changes.title??row.title,content:changes.content,wordCount:countWords(changes.content),reason:'manual',createdAt:Date.now()};
          return Dexie.Promise.resolve(saveEraDocument(scope,'writings',{...current.document,children:{...current.document.children,writingSnapshots:[...current.document.children.writingSnapshots??[],snapshot as unknown as EraRow]}},current.version)).then(()=>({current:row,rejectedSnapshotId:snapshot.id}));
        }
        return{current:row,rejectedSnapshotId:null};
      }
      return Dexie.Promise.resolve(saveEraDocument(scope,'writings',{...current.document,root:{...row,...changes} as unknown as EraRow},current.version)).then(result=>({version:Number(result.document.root.updatedAt)}));
    }));
    if (outcome.current) throw new ops.WritingConflictError(outcome.current, expectedVersion!, outcome.rejectedSnapshotId ?? null);
    return outcome.version!;
  };
  const createWriting = (row: Writing): Promise<string> => !scope.eraId ? ops.createWriting(row) : Dexie.Promise.resolve(saveEraDocument(scope, 'writings', { root: row as unknown as EraRow, children: { writingSnapshots: [] } }, null)).then(() => row.id);
  const deleteWritingRestorable = async (id: string): Promise<ops.DeletedWritingBundle | null> => {
    if (!scope.eraId) return ops.deleteWritingRestorable(id);
    const current = await readWorldDocument(scope, 'writings', id); if (!current) return null;
    await hideEraDocument(scope, 'writings', id, current.version);
    const bundle: ops.DeletedWritingBundle = { writing: current.document.root as unknown as Writing, snapshots: (current.document.children.writingSnapshots ?? []) as unknown as WritingSnapshot[], annotations: [], annotationReferences: [], unlinkedBeatIds: [], deletedAt: Date.now() };
    const slot = undoSlots.get(key); if (slot?.expected === id) { slot.bundle = bundle; slot.timer = setTimeout(() => undoSlots.delete(key), 30_000); }
    return bundle;
  };
  const restoreDeletedWriting = async (bundle: ops.DeletedWritingBundle) => {
    if (!scope.eraId) return ops.restoreDeletedWriting(bundle);
    await saveEraDocument(scope, 'writings', { root: bundle.writing as unknown as EraRow, children: { writingSnapshots: bundle.snapshots as unknown as EraRow[] } }, null);
  };
  const replaceWritingWithSnapshot = async (id: string, changes: Partial<Writing>, expectedVersion: number): Promise<ops.ProtectedWritingReplacement> => {
    if (!scope.eraId) return ops.replaceWritingWithSnapshot(id, changes, expectedVersion);
    try {
      return await db.transaction('rw', db.tables, async () => {
        const current = await getWriting(id); if (!current) return { status: 'gone' as const, writingId: id };
        if (current.updatedAt !== expectedVersion) {
          try { await updateWritingAtVersion(id, changes, expectedVersion); } catch (reason) { if (reason instanceof ops.WritingConflictError) return { status: 'conflict' as const, expectedVersion, current: reason.current, rejectedSnapshotId: reason.rejectedSnapshotId }; throw reason; }
        }
        const snapshot = await eraSnapshotOperations(scope).ensureSnapshot(current, 'pre-ai');
        const version = await updateWritingAtVersion(id, changes, expectedVersion);
        return { status: 'applied' as const, version, snapshot, changes: { ...changes, updatedAt: version } };
      });
    } catch (reason) { if (reason instanceof ops.WritingGoneError) return { status: 'gone', writingId: id }; throw reason; }
  };
  return { ...ops, replaceWritingWithSnapshot, expectDeletedWriting, takeLastDeletedWriting, getWriting, getWritings, getWritingVersion: async (id: string) => (await getWriting(id))?.updatedAt, createWriting, updateWritingAtVersion, updateWriting: async (id: string, changes: Partial<Writing>, version?: number) => { await updateWritingAtVersion(id, changes, version); }, deleteWriting: async (id: string) => { await deleteWritingRestorable(id); }, deleteWritingRestorable, restoreDeletedWriting };
}
export function eraSnapshotOperations(scope: WorldEraScope) {
  const listSnapshots = async (id: string): Promise<WritingSnapshot[]> => scope.eraId ? (await listEraRows<WritingSnapshot>(scope, 'writingSnapshots')).filter(row => row.writingId === id && row.kind === undefined).sort((a, b) => b.createdAt - a.createdAt) : snapshots.listSnapshots(id);
  const ensureSnapshot = async (writing: Pick<Writing, 'id' | 'projectId' | 'title' | 'content'>, reason: SnapshotReason): Promise<snapshots.SnapshotWriteOutcome> => {
    if (!scope.eraId) return snapshots.ensureSnapshot(writing, reason);
    const read = await readWorldDocument(scope, 'writings', writing.id); if (!read) throw new ops.WritingGoneError(writing.id);
    // Simply opening an inherited document must not create a version/copy.
    if (reason === 'auto' && (read.provenance === 'base' || !writing.content.trim())) return { status: 'skipped-empty' };
    const existing = await listSnapshots(writing.id); if (reason !== 'manual' && existing[0]?.content === writing.content) return { status: 'already-covered', snapshotId: existing[0].id };
    const snapshot: WritingSnapshot = { id: crypto.randomUUID(), projectId: scope.projectId, writingId: writing.id, title: writing.title, content: writing.content, wordCount: countWords(writing.content), reason, createdAt: Date.now() };
    await mutateEraRows(scope, [{ table: 'writingSnapshots', id: snapshot.id, row: snapshot as unknown as EraRow }]); return { status: 'created', snapshotId: snapshot.id };
  };
  const takeSnapshot = async (writing: Pick<Writing, 'id' | 'projectId' | 'title' | 'content'>, reason: SnapshotReason) => { try { const result = await ensureSnapshot(writing, reason); return result.status === 'created' ? result.snapshotId : null; } catch { return null; } };
  const readSnapshot = (id: string) => scope.eraId ? readEraRow<WritingSnapshot>(scope, 'writingSnapshots', id) : snapshots.readSnapshot(id);
  return { ...snapshots, listSnapshots, ensureSnapshot, takeSnapshot, readSnapshot,
    listSnapshotMeta: async (id: string): Promise<WritingSnapshotMeta[]> => (await listSnapshots(id)).map(({ id, writingId, projectId, title, wordCount, reason, createdAt }) => ({ id, writingId, projectId, title, wordCount, reason, createdAt })),
    restoreSnapshot: async (id: string) => { if (!scope.eraId) return snapshots.restoreSnapshot(id); const snapshot = await readSnapshot(id); if (!snapshot) return null; if (snapshot.kind === 'parallel-draft-history') throw Error('Use this alternative’s own history to restore that version.'); const current = await eraWritingOperations(scope).getWriting(snapshot.writingId); if (!current) return null; await ensureSnapshot(current, 'pre-restore'); const changes = { title: snapshot.title, content: snapshot.content, wordCount: countWords(snapshot.content) }; await eraWritingOperations(scope).updateWritingAtVersion(snapshot.writingId, changes, current.updatedAt); return changes; },
    deleteSnapshot: async (id: string) => { if (!scope.eraId) return snapshots.deleteSnapshot(id); await mutateEraRows(scope, [{ table: 'writingSnapshots', id, remove: true }]); },
  };
}
export function useEraWritingOperations(projectId: string) { const scope = useWorldEraScope(projectId); return useMemo(() => eraWritingOperations(scope), [scope]); }
export function useEraSnapshotOperations(projectId: string) { const scope = useWorldEraScope(projectId); return useMemo(() => eraSnapshotOperations(scope), [scope]); }
