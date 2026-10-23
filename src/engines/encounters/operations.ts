// Encounters are stored with the project (they belong to the table, not to an
// era of the world), with a revision so two windows cannot overwrite each other.
import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { validateEncounter, type Encounter } from './model';

export class EncounterConflict extends Error { readonly current: Encounter | undefined; constructor(current: Encounter | undefined) { super('encounter_conflict'); this.name = 'EncounterConflict'; this.current = current; } }

export async function listEncounters(projectId: string): Promise<Encounter[]> {
  return (await db.projects.get(projectId))?.encounters ?? [];
}

export async function saveEncounter(projectId: string, draft: Encounter, expectedRevision: number | null): Promise<Encounter> {
  validateEncounter(draft);
  if (!draft.title.trim()) throw new Error('encounter_title_required');
  const saved = await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    const list = project.encounters ?? [], current = list.find(item => item.id === draft.id);
    if (expectedRevision === null ? Boolean(current) : current?.revision !== expectedRevision) throw new EncounterConflict(current);
    if (!current && list.length >= 200) throw new Error('encounter_limit');
    const now = Math.max(Date.now(), (current?.updatedAt ?? 0) + 1);
    const next: Encounter = structuredClone({ ...draft, title: draft.title.trim(), log: draft.log.slice(-200), revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? draft.createdAt, updatedAt: now });
    await db.projects.update(projectId, { encounters: current ? list.map(item => item.id === next.id ? next : item) : [...list, next], updatedAt: Math.max(now, project.updatedAt + 1) });
    return next;
  });
  notifyProjectsChanged();
  return saved;
}

export async function deleteEncounter(projectId: string, id: string, expectedRevision: number): Promise<Encounter> {
  const removed = await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    const current = project.encounters?.find(item => item.id === id);
    if (!current || current.revision !== expectedRevision) throw new EncounterConflict(current);
    await db.projects.update(projectId, { encounters: project.encounters!.filter(item => item.id !== id), updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
    return current;
  });
  notifyProjectsChanged();
  return removed;
}

/** Put an encounter back exactly as it was (undo), whatever its revision now. */
export async function restoreEncounter(projectId: string, previous: Encounter | null, id: string): Promise<void> {
  await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    const list = (project.encounters ?? []).filter(item => item.id !== id);
    await db.projects.update(projectId, { encounters: previous ? [...list, { ...previous, revision: (project.encounters?.find(item => item.id === id)?.revision ?? previous.revision) + 1, updatedAt: Date.now() }] : list, updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
  });
  notifyProjectsChanged();
}
