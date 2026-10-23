import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { validateBoards, type KanbanBoard, type KanbanList } from './model';

export class KanbanConflict extends Error { constructor() { super('kanban_conflict'); this.name = 'KanbanConflict'; } }
export async function readKanbans(projectId: string): Promise<KanbanList> { return (await db.projects.get(projectId))?.kanbans ?? { revision: 0, boards: [] }; }
export async function saveKanbans(projectId: string, boards: KanbanBoard[], expectedRevision: number): Promise<KanbanList> {
  validateBoards(boards);
  const saved = await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    const current = project.kanbans ?? { revision: 0, boards: [] };
    if (current.revision !== expectedRevision) throw new KanbanConflict();
    const next: KanbanList = { revision: current.revision + 1, boards: structuredClone(boards) };
    await db.projects.update(projectId, { kanbans: next, updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
    return next;
  });
  notifyProjectsChanged();
  return saved;
}
export async function restoreKanbans(projectId: string, previous: KanbanList): Promise<void> {
  await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    await db.projects.update(projectId, { kanbans: { revision: (project.kanbans?.revision ?? 0) + 1, boards: previous.boards }, updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
  });
  notifyProjectsChanged();
}
