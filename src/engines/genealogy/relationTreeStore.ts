import { db } from '@/db';
import { archiveMetadataWithMutation } from '@/services/documentArchive/metadata';
import { notifyProjectsChanged } from '@/db/operations';
import { validateRelationTree, type RelationTreeDocument } from './relationTrees';

export class RelationTreeConflict extends Error {
  readonly current: RelationTreeDocument | undefined;
  constructor(current: RelationTreeDocument | undefined) { super('relation_tree_conflict'); this.current = current; this.name = 'RelationTreeConflict'; }
}

/** Compare only this tree's revision, then patch the latest project row atomically. */
export async function saveRelationTree(projectId: string, draft: RelationTreeDocument, expectedRevision: number | null): Promise<RelationTreeDocument> {
  validateRelationTree(draft);
  const saved = await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('project_missing');
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

export async function deleteRelationTree(projectId: string, id: string, expectedRevision: number): Promise<void> {
  await archiveMetadataWithMutation('relation-tree',projectId,id,()=>db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('project_missing');
    const current = project.relationTrees?.find(tree => tree.id === id);
    if (current?.revision !== expectedRevision) throw new RelationTreeConflict(current);
    await db.projects.update(projectId, { relationTrees: project.relationTrees!.filter(tree => tree.id !== id), updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
  }));
  notifyProjectsChanged();
}
