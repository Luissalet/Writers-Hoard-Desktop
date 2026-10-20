import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { trackPendingWrite } from '@/services/pendingWrites';
import type { CodexGraphLayout } from './types';

/** Layout-only writes merge into the latest project row and stay project-scoped. */
export async function saveWorldGraphLayout(projectId: string, positions: CodexGraphLayout['positions']): Promise<void> {
  const write = db.transaction('rw', [db.projects, db.codexEntries], async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('Project no longer exists');
    const known = new Set(await db.codexEntries.where('projectId').equals(projectId).primaryKeys());
    const accepted = Object.fromEntries(Object.entries(positions).filter(([id, position]) => known.has(id) && Number.isFinite(position.x) && Number.isFinite(position.y)).map(([id, position]) => [id, { x: Math.max(-100000, Math.min(100000, position.x)), y: Math.max(-100000, Math.min(100000, position.y)) }]));
    await db.projects.update(projectId, { codexGraphLayout: { positions: accepted }, updatedAt: Date.now() });
  });
  await trackPendingWrite(write, () => saveWorldGraphLayout(projectId, positions), `codex-graph-layout:${projectId}`);
  notifyProjectsChanged();
}
