import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { assertWorldEra } from '@/services/worldEras/store';
import type { Project } from '@/types';
import { normalizeAppearance, validateRasterImage } from './validation';
import type { AppearanceRead, AppearanceScope, WorkspaceAppearanceValues } from './types';
export class WorkspaceAppearanceConflict extends Error { constructor() { super('workspace_appearance_conflict'); this.name = 'WorkspaceAppearanceConflict'; } }
export function appearanceFromProject(project: Project, scope: AppearanceScope): AppearanceRead {
  const era = scope.eraId ? project.worldEras?.find(item => item.id === scope.eraId) : undefined;
  const profile = scope.eraId ? era?.workspaceAppearance : project.workspaceAppearance;
  const own = normalizeAppearance(profile?.values ?? {}), base = normalizeAppearance(project.workspaceAppearance?.values ?? {});
  // Existing era themes remain authoritative until a specific appearance field is overridden.
  const legacy = era?.theme ?? {};
  return { ...scope, revision: profile?.revision ?? 0, own, effective: { ...base, ...legacy, ...own }, inherited: !!scope.eraId && Object.keys(own).length === 0 };
}
export async function getWorkspaceAppearance(scope: AppearanceScope): Promise<AppearanceRead> { return appearanceFromProject(await assertWorldEra(scope), scope); }
/** `reset` clears the own values; with a non-empty patch it REPLACES them (saved themes), so no field of the old look survives. */
export async function saveWorkspaceAppearance(scope: AppearanceScope, patch: WorkspaceAppearanceValues, expectedRevision: number, reset = false): Promise<AppearanceRead> {
  const changes = normalizeAppearance(patch);
  if (changes.backgroundImage) await validateRasterImage(changes.backgroundImage);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error('workspace_appearance_revision_invalid');
  const saved = await db.transaction('rw', db.projects, async () => {
    const project = await assertWorldEra(scope), current = appearanceFromProject(project, scope);
    if (current.revision !== expectedRevision) throw new WorkspaceAppearanceConflict();
    const profile = { revision: current.revision + 1, values: reset ? changes : { ...current.own, ...changes } };
    // Update only our field against the freshly read row; metadata and sibling eras survive.
    const changeset = scope.eraId ? { worldEras: project.worldEras!.map(era => era.id === scope.eraId ? { ...era, workspaceAppearance: profile, revision: era.revision + 1, updatedAt: Date.now() } : era) } : { workspaceAppearance: profile };
    await db.projects.update(scope.projectId, { ...changeset, updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
    return appearanceFromProject({ ...project, ...changeset }, scope);
  });
  notifyProjectsChanged(); return saved;
}
export const resetWorkspaceAppearance = (scope: AppearanceScope, expectedRevision: number) => saveWorkspaceAppearance(scope, {}, expectedRevision, true);
