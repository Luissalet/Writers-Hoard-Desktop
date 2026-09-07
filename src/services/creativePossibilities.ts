import { db } from '@/db';
import type { CreativePossibility } from '@/components/project/creative-lab/types';

/** Patch only this field, preserving project preferences and concurrent new ideas. */
export async function saveCreativePossibilities(
  projectId: string,
  possibilities: readonly CreativePossibility[],
): Promise<void> {
  if (possibilities.some(possibility => possibility.projectId !== projectId)) {
    throw new Error('Creative possibilities belong to another project');
  }
  await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('Project no longer exists');
    const merged = new Map((project.creativePossibilities ?? []).map(item => [item.id, item]));
    for (const possibility of possibilities) {
      const stored = merged.get(possibility.id);
      if (!stored || possibility.updatedAt >= stored.updatedAt) merged.set(possibility.id, possibility);
    }
    await db.projects.update(projectId, {
      creativePossibilities: [...merged.values()].sort((left, right) => right.createdAt - left.createdAt),
      updatedAt: Date.now(),
    });
  });
}
