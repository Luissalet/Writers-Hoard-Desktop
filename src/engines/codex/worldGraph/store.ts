import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { trackPendingWrite } from '@/services/pendingWrites';
import { normalizeWorldGraphDisplay, type CodexGraphLayout } from './types';

/** Layout-only writes merge into the latest project row and stay project-scoped. */
export async function saveWorldGraphLayout(projectId: string, positions: CodexGraphLayout['positions']): Promise<void> {
  const write = db.transaction('rw', [db.projects, db.codexEntries], async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('Project no longer exists');
    const known = new Set(await db.codexEntries.where('projectId').equals(projectId).primaryKeys());
    const accepted = Object.fromEntries(Object.entries(positions).filter(([id, position]) => known.has(id) && Number.isFinite(position.x) && Number.isFinite(position.y)).map(([id, position]) => [id, { x: Math.max(-100000, Math.min(100000, position.x)), y: Math.max(-100000, Math.min(100000, position.y)) }]));
    await db.projects.update(projectId, { codexGraphLayout: { ...project.codexGraphLayout, positions: accepted }, updatedAt: Date.now() });
  });
  await trackPendingWrite(write, () => saveWorldGraphLayout(projectId, positions), `codex-graph-layout:${projectId}`);
  notifyProjectsChanged();
}

/** Display settings, hidden cards and saved views merge into the layout without touching positions. */
export async function saveWorldGraphSettings(projectId: string, patch: Partial<Omit<CodexGraphLayout, 'positions'>>): Promise<CodexGraphLayout> {
  const saved = await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('Project no longer exists');
    const current = project.codexGraphLayout ?? { positions: {} };
    const display = patch.display ? normalizeWorldGraphDisplay({ ...current.display, ...patch.display }) : current.display;
    const next: CodexGraphLayout = { ...current, ...(display ? { display } : {}), ...(patch.hiddenIds ? { hiddenIds: [...new Set(patch.hiddenIds.filter(id => typeof id === 'string'))].slice(0, 5000) } : {}), ...(patch.views ? { views: patch.views.slice(0, 50).map(view => ({ ...view, display: normalizeWorldGraphDisplay(view.display), name: String(view.name).trim().slice(0, 80) || '—' })) } : {}) };
    await db.projects.update(projectId, { codexGraphLayout: next, updatedAt: Date.now() });
    return next;
  });
  notifyProjectsChanged();
  return saved;
}
