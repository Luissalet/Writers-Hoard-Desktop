import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { normalizeSoundscape, validateSoundscapes, type Soundscape, type SoundscapeList } from './model';

export class SoundscapeConflict extends Error { constructor() { super('soundscape_conflict'); this.name = 'SoundscapeConflict'; } }

export async function readSoundscapes(projectId: string): Promise<SoundscapeList> {
  return (await db.projects.get(projectId))?.soundscapes ?? { revision: 0, items: [] };
}

export async function saveSoundscapes(projectId: string, items: Soundscape[], expectedRevision: number): Promise<SoundscapeList> {
  const normalized = items.map(normalizeSoundscape); validateSoundscapes(normalized);
  const saved = await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    const current = project.soundscapes ?? { revision: 0, items: [] };
    if (current.revision !== expectedRevision) throw new SoundscapeConflict();
    const next: SoundscapeList = { revision: current.revision + 1, items: structuredClone(normalized) };
    await db.projects.update(projectId, { soundscapes: next, updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
    return next;
  });
  notifyProjectsChanged();
  return saved;
}

export async function restoreSoundscapes(projectId: string, previous: SoundscapeList): Promise<void> {
  await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    await db.projects.update(projectId, { soundscapes: { revision: (project.soundscapes?.revision ?? 0) + 1, items: previous.items }, updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
  });
  notifyProjectsChanged();
}
