import { saveRevisionedEraMetadata, archiveEraMetadata } from '@/services/worldEras/metadata';
import { db } from '@/db';
import { archiveMetadataWithMutation } from '@/services/documentArchive/metadata';
import { notifyProjectsChanged } from '@/db/operations';
import { validateRelationTree, type RelationTreeDocument } from './relationTrees';
import { decodeTreeImage } from './treeImages';
import Dexie from 'dexie';

export class RelationTreeConflict extends Error {
  readonly current: RelationTreeDocument | undefined;
  constructor(current: RelationTreeDocument | undefined) { super('relation_tree_conflict'); this.current = current; this.name = 'RelationTreeConflict'; }
}

/** Compare only this tree's revision, then patch the latest project row atomically. */
export async function saveRelationTree(projectId: string, draft: RelationTreeDocument, expectedRevision: number | null, eraId?: string): Promise<RelationTreeDocument> {
  validateRelationTree(draft);
  // Decode before opening the persistence transaction; malformed artwork never commits a partial tree.
  const decoded=Promise.all([...new Set(draft.nodes.flatMap(node => node.image ? [node.image] : []))].map(decodeTreeImage));
  if(Dexie.currentTransaction)await Dexie.waitFor(decoded);else await decoded;
  if (eraId) return saveRevisionedEraMetadata({ projectId, eraId }, 'genealogy', draft, expectedRevision, current => new RelationTreeConflict(current));
  const saved = await db.transaction('rw', db.projects, db.codexEntries, async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('project_missing');
    for (const id of new Set(draft.nodes.flatMap(node => node.codexEntryId ? [node.codexEntryId] : []))) if ((await db.codexEntries.get(id))?.projectId !== projectId) throw new Error('invalid_codex_link');
    const trees = project.relationTrees ?? [];
    const current = trees.find(tree => tree.id === draft.id);
    if (expectedRevision === null ? current !== undefined : current?.revision !== expectedRevision) throw new RelationTreeConflict(current);
    const now = Math.max(Date.now(), (current?.updatedAt ?? 0) + 1);
    const next = structuredClone({ ...draft, revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? draft.createdAt, updatedAt: now });
    await db.projects.update(projectId, { relationTrees: current ? trees.map(tree => tree.id === draft.id ? next : tree) : [...trees, next], updatedAt: Math.max(now, project.updatedAt + 1) });
    return next;
  });
  notifyProjectsChanged();
  return saved;
}

export async function deleteRelationTree(projectId: string, id: string, expectedRevision: number, eraId?: string): Promise<void> {
  if (eraId) return archiveEraMetadata({ projectId, eraId }, 'genealogy', id, expectedRevision, current => new RelationTreeConflict(current));
  await archiveMetadataWithMutation('relation-tree',projectId,id,()=>db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('project_missing');
    const current = project.relationTrees?.find(tree => tree.id === id);
    if (current?.revision !== expectedRevision) throw new RelationTreeConflict(current);
    await db.projects.update(projectId, { relationTrees: project.relationTrees!.filter(tree => tree.id !== id), updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
  }));
  notifyProjectsChanged();
}
