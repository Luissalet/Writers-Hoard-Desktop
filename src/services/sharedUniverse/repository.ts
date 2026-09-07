import { db } from '@/db';
import { notifyProjectsChanged, touchProject } from '@/db/operations';
import { resolveEntityInEngine } from '@/engines/_shared/entityResolverRegistry';
import { canonicalJson, sha256Hex } from '@/services/aiRuntime/recipe';
import { generateId } from '@/utils/idGenerator';
import type { Project } from '@/types';
import type {
  ResolvedSharedEntity,
  SharedCanonEntity,
  SharedCanonEntityKind,
  SharedEntityBinding,
  SharedEntityDeletionPreview,
  SharedEntityOverride,
  SharedEntitySource,
  SharedUniverseArchive,
  SharedUniverseImportPreview,
} from './types';
import { SharedUniverseConflictError } from './types';

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function requireSeries(seriesId: string): Promise<Project> {
  const series = await db.projects.get(seriesId);
  if (!series || series.type !== 'saga') throw new Error('The shared universe must be a saga project.');
  return series;
}

async function requireMember(projectId: string, seriesId: string): Promise<Project> {
  const [project, series] = await Promise.all([db.projects.get(projectId), requireSeries(seriesId)]);
  if (!project || project.type === 'saga') throw new Error('A shared-universe member must be a book project.');
  if (project.parentId !== seriesId && !series.children?.includes(projectId)) {
    throw new Error('The project is not a member of this shared universe.');
  }
  return project;
}

async function requireLocalSource(source: SharedEntitySource): Promise<void> {
  const entity = await resolveEntityInEngine(source.engineId, source.entityId);
  if (!entity || entity.projectId !== source.projectId) {
    throw new Error('The local source is missing or belongs to another project.');
  }
}

export async function createSharedUniverse(title: string, initialProjectId: string): Promise<Project> {
  const project = await db.projects.get(initialProjectId);
  if (!project || project.type === 'saga') throw new Error('A shared universe needs an existing book project.');
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error('A shared universe needs a title.');
  const now = Date.now();
  const series: Project = {
    id: generateId('universe'),
    title: normalizedTitle,
    mode: project.mode,
    type: 'saga',
    color: project.color,
    description: '',
    children: [project.id],
    status: 'in-progress',
    enabledEngines: [],
    engineOrder: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction('rw', db.projects, async () => {
    const current = await db.projects.get(project.id);
    if (!current || current.type === 'saga') throw new Error('The initial project changed.');
    if (current.parentId) {
      const previous = await db.projects.get(current.parentId);
      if (previous) {
        await db.projects.update(previous.id, {
          children: (previous.children ?? []).filter((id) => id !== current.id),
          updatedAt: now,
        });
      }
    }
    await db.projects.add(series);
    await db.projects.update(current.id, { parentId: series.id, updatedAt: now });
  });
  notifyProjectsChanged();
  return series;
}

export async function linkProjectToSharedUniverse(projectId: string, seriesId: string): Promise<void> {
  const [project, series] = await Promise.all([db.projects.get(projectId), requireSeries(seriesId)]);
  if (!project || project.type === 'saga' || project.id === series.id) {
    throw new Error('Only a book project can join a shared universe.');
  }
  await db.transaction('rw', db.projects, async () => {
    const current = await db.projects.get(projectId);
    const destination = await db.projects.get(seriesId);
    if (!current || !destination || destination.type !== 'saga') throw new Error('Project membership changed.');
    if (current.parentId && current.parentId !== seriesId) {
      const previous = await db.projects.get(current.parentId);
      if (previous) {
        await db.projects.update(previous.id, {
          children: (previous.children ?? []).filter((id) => id !== projectId),
          updatedAt: Date.now(),
        });
      }
    }
    const now = Date.now();
    await db.projects.update(projectId, { parentId: seriesId, updatedAt: now });
    await db.projects.update(seriesId, {
      children: [...new Set([...(destination.children ?? []), projectId])],
      updatedAt: now,
    });
  });
  notifyProjectsChanged();
}

export async function listSharedCanonEntities(seriesId: string): Promise<SharedCanonEntity[]> {
  return db.sharedCanonEntities.where('seriesId').equals(seriesId).sortBy('title');
}

export async function listProjectSharedBindings(projectId: string): Promise<SharedEntityBinding[]> {
  return db.sharedEntityBindings.where('projectId').equals(projectId).sortBy('sharedTitleCache');
}

export async function createSharedCanonEntity(input: {
  seriesId: string;
  projectId: string;
  kind: SharedCanonEntityKind;
  title: string;
  summary?: string;
  tags?: readonly string[];
  source: Omit<SharedEntitySource, 'projectId' | 'title'> & { title?: string };
}): Promise<{ entity: SharedCanonEntity; binding: SharedEntityBinding }> {
  await requireMember(input.projectId, input.seriesId);
  const source: SharedEntitySource = {
    ...input.source,
    projectId: input.projectId,
    title: input.source.title?.trim() || input.title.trim(),
  };
  await requireLocalSource(source);
  const title = input.title.trim();
  if (!title) throw new Error('A shared identity needs a title.');
  const now = Date.now();
  const entity: SharedCanonEntity = {
    id: generateId('shared-canon'),
    seriesId: input.seriesId,
    kind: input.kind,
    title,
    summary: input.summary?.trim() ?? '',
    tags: uniqueStrings(input.tags ?? []),
    origin: source,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const binding: SharedEntityBinding = {
    id: generateId('shared-binding'),
    seriesId: input.seriesId,
    sharedEntityId: entity.id,
    projectId: input.projectId,
    scope: 'origin',
    local: {
      engineId: source.engineId,
      entityType: source.entityType,
      entityId: source.entityId,
      title: source.title,
    },
    overrides: {},
    baseVersion: entity.version,
    sharedTitleCache: entity.title,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction('rw', db.sharedCanonEntities, db.sharedEntityBindings, async () => {
    await db.sharedCanonEntities.add(entity);
    await db.sharedEntityBindings.add(binding);
  });
  await touchProject(input.projectId);
  return { entity, binding };
}

export async function bindSharedCanonEntity(input: {
  sharedEntityId: string;
  projectId: string;
  local?: Omit<SharedEntitySource, 'projectId'>;
}): Promise<SharedEntityBinding> {
  const shared = await db.sharedCanonEntities.get(input.sharedEntityId);
  if (!shared) throw new Error('Shared identity not found.');
  await requireMember(input.projectId, shared.seriesId);
  if (input.local) await requireLocalSource({ ...input.local, projectId: input.projectId });
  const existing = await db.sharedEntityBindings
    .where('[seriesId+sharedEntityId+projectId]')
    .equals([shared.seriesId, shared.id, input.projectId])
    .first();
  if (existing) return existing;
  const now = Date.now();
  const binding: SharedEntityBinding = {
    id: generateId('shared-binding'),
    seriesId: shared.seriesId,
    sharedEntityId: shared.id,
    projectId: input.projectId,
    scope: 'reference',
    local: input.local,
    overrides: {},
    baseVersion: shared.version,
    sharedTitleCache: shared.title,
    createdAt: now,
    updatedAt: now,
  };
  await db.sharedEntityBindings.add(binding);
  await touchProject(input.projectId);
  return binding;
}

export async function updateSharedCanonEntity(
  entityId: string,
  expectedVersion: number,
  changes: Partial<Pick<SharedCanonEntity, 'title' | 'summary' | 'tags'>>,
): Promise<SharedCanonEntity> {
  return db.transaction('rw', db.sharedCanonEntities, db.sharedEntityBindings, async () => {
    const current = await db.sharedCanonEntities.get(entityId);
    if (!current) throw new Error('Shared identity not found.');
    if (current.version !== expectedVersion) {
      throw new SharedUniverseConflictError('The shared identity changed. Review it before saving again.');
    }
    const next: SharedCanonEntity = {
      ...current,
      ...(changes.title === undefined ? {} : { title: changes.title.trim() || current.title }),
      ...(changes.summary === undefined ? {} : { summary: changes.summary.trim() }),
      ...(changes.tags === undefined ? {} : { tags: uniqueStrings(changes.tags) }),
      version: current.version + 1,
      updatedAt: Date.now(),
    };
    await db.sharedCanonEntities.put(next);
    await db.sharedEntityBindings.where('sharedEntityId').equals(entityId).modify({ sharedTitleCache: next.title });
    return next;
  });
}

export async function updateSharedEntityOverride(
  bindingId: string,
  expectedSharedVersion: number,
  overrides: SharedEntityOverride,
): Promise<SharedEntityBinding> {
  return db.transaction('rw', db.sharedCanonEntities, db.sharedEntityBindings, async () => {
    const binding = await db.sharedEntityBindings.get(bindingId);
    if (!binding) throw new Error('Shared binding not found.');
    const shared = await db.sharedCanonEntities.get(binding.sharedEntityId);
    if (!shared) throw new Error('The shared identity is unavailable.');
    if (shared.version !== expectedSharedVersion) {
      throw new SharedUniverseConflictError('The series canon changed. Review it before rebasing this override.');
    }
    const normalized: SharedEntityOverride = {
      ...(overrides.title?.trim() ? { title: overrides.title.trim() } : {}),
      ...(overrides.summary?.trim() ? { summary: overrides.summary.trim() } : {}),
      ...(overrides.tags?.length ? { tags: uniqueStrings(overrides.tags) } : {}),
    };
    const next: SharedEntityBinding = {
      ...binding,
      overrides: normalized,
      scope: Object.keys(normalized).length ? 'override' : 'reference',
      baseVersion: shared.version,
      sharedTitleCache: shared.title,
      updatedAt: Date.now(),
    };
    await db.sharedEntityBindings.put(next);
    return next;
  });
}

export function resolveSharedEntity(
  shared: SharedCanonEntity,
  binding: SharedEntityBinding | null,
  originAvailable: boolean,
): ResolvedSharedEntity {
  return {
    shared,
    binding,
    title: binding?.overrides.title ?? shared.title,
    summary: binding?.overrides.summary ?? shared.summary,
    tags: binding?.overrides.tags ? [...binding.overrides.tags] : [...shared.tags],
    scope: binding?.scope ?? 'unbound',
    staleOverride: Boolean(binding && binding.baseVersion !== shared.version),
    originAvailable,
  };
}

export async function previewDeleteSharedCanonEntity(entityId: string): Promise<SharedEntityDeletionPreview> {
  const entity = await db.sharedCanonEntities.get(entityId);
  if (!entity) throw new Error('Shared identity not found.');
  const bindings = await db.sharedEntityBindings.where('sharedEntityId').equals(entityId).toArray();
  const body = {
    sharedEntityId: entity.id,
    seriesId: entity.seriesId,
    title: entity.title,
    version: entity.version,
    updatedAt: entity.updatedAt,
    bindings: bindings.map(({ id, projectId, scope, sharedTitleCache, updatedAt }) => ({
      id, projectId, scope, sharedTitleCache, updatedAt,
    })),
  };
  return { ...body, confirmationToken: sha256Hex(canonicalJson(body)) };
}

export async function deleteSharedCanonEntity(
  preview: SharedEntityDeletionPreview,
  confirmationToken: string,
): Promise<void> {
  const current = await previewDeleteSharedCanonEntity(preview.sharedEntityId);
  if (current.confirmationToken !== confirmationToken || preview.confirmationToken !== confirmationToken) {
    throw new SharedUniverseConflictError('Shared bindings changed after the deletion preview.');
  }
  await db.transaction('rw', db.sharedCanonEntities, db.sharedEntityBindings, async () => {
    await db.sharedEntityBindings.where('sharedEntityId').equals(preview.sharedEntityId).delete();
    await db.sharedCanonEntities.delete(preview.sharedEntityId);
  });
}

export async function exportSharedUniverseArchive(seriesId: string): Promise<SharedUniverseArchive> {
  const seriesProject = await requireSeries(seriesId);
  const [entities, bindings] = await Promise.all([
    db.sharedCanonEntities.where('seriesId').equals(seriesId).toArray(),
    db.sharedEntityBindings.where('seriesId').equals(seriesId).toArray(),
  ]);
  return {
    version: 1,
    exportedAt: Date.now(),
    seriesProject,
    memberProjectIds: [...new Set([
      ...(seriesProject.children ?? []),
      ...bindings.map((binding) => binding.projectId),
    ])].sort(),
    entities: entities.sort((a, b) => a.id.localeCompare(b.id)),
    bindings: bindings.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function validateArchive(archive: SharedUniverseArchive): void {
  if (archive.version !== 1 || archive.seriesProject.type !== 'saga') throw new Error('Unsupported shared-universe archive.');
  const seriesId = archive.seriesProject.id;
  const entityIds = new Set(archive.entities.map((entity) => entity.id));
  const bindingIds = new Set(archive.bindings.map((binding) => binding.id));
  const members = new Set(archive.memberProjectIds);
  if (entityIds.size !== archive.entities.length) throw new Error('Shared-universe archive contains duplicate identities.');
  if (bindingIds.size !== archive.bindings.length) throw new Error('Shared-universe archive contains duplicate bindings.');
  if (archive.entities.some((entity) => entity.seriesId !== seriesId)) throw new Error('Shared identity escaped the archived series.');
  if (archive.bindings.some((binding) => binding.seriesId !== seriesId || !entityIds.has(binding.sharedEntityId))) {
    throw new Error('Shared-universe archive contains an invalid binding.');
  }
  if (archive.bindings.some((binding) => !members.has(binding.projectId))) {
    throw new Error('Shared-universe archive contains a binding outside its member set.');
  }
}

export async function previewSharedUniverseImport(
  archive: SharedUniverseArchive,
): Promise<SharedUniverseImportPreview> {
  validateArchive(archive);
  const [projects, existingEntities, existingBindings] = await Promise.all([
    db.projects.bulkGet(archive.memberProjectIds),
    db.sharedCanonEntities.where('seriesId').equals(archive.seriesProject.id).toArray(),
    db.sharedEntityBindings.where('seriesId').equals(archive.seriesProject.id).toArray(),
  ]);
  const collisions = [
    ...existingEntities.map((row) => `entity:${row.id}`),
    ...existingBindings.map((row) => `binding:${row.id}`),
    ...projects.flatMap((project, index) => (
      project?.parentId && project.parentId !== archive.seriesProject.id
        ? [`membership:${archive.memberProjectIds[index]}:${project.parentId}`]
        : []
    )),
  ].sort();
  const body = {
    seriesId: archive.seriesProject.id,
    entityCount: archive.entities.length,
    bindingCount: archive.bindings.length,
    missingMemberProjectIds: archive.memberProjectIds.filter((_id, index) => !projects[index]),
    collisions,
  };
  return { ...body, confirmationToken: sha256Hex(canonicalJson(body)) };
}

export async function importSharedUniverseArchive(
  archive: SharedUniverseArchive,
  preview: SharedUniverseImportPreview,
  confirmationToken: string,
  replaceExisting = false,
): Promise<void> {
  const current = await previewSharedUniverseImport(archive);
  if (current.confirmationToken !== confirmationToken || preview.confirmationToken !== confirmationToken) {
    throw new SharedUniverseConflictError('The shared-universe import preview is stale.');
  }
  if (current.collisions.length && !replaceExisting) {
    throw new SharedUniverseConflictError('This shared universe already exists. Choose explicit replacement.');
  }
  await db.transaction('rw', db.projects, db.sharedCanonEntities, db.sharedEntityBindings, async () => {
    if (replaceExisting) {
      await db.sharedEntityBindings.where('seriesId').equals(current.seriesId).delete();
      await db.sharedCanonEntities.where('seriesId').equals(current.seriesId).delete();
    }
    await db.projects.put(archive.seriesProject);
    const members = await db.projects.bulkGet(archive.memberProjectIds);
    const now = Date.now();
    for (const member of members) {
      if (!member || member.type === 'saga') continue;
      if (member.parentId && member.parentId !== current.seriesId) {
        const previous = await db.projects.get(member.parentId);
        if (previous) {
          await db.projects.update(previous.id, {
            children: (previous.children ?? []).filter((id) => id !== member.id),
            updatedAt: now,
          });
        }
      }
      await db.projects.update(member.id, { parentId: current.seriesId, updatedAt: now });
    }
    if (archive.entities.length) await db.sharedCanonEntities.bulkPut(archive.entities);
    if (archive.bindings.length) await db.sharedEntityBindings.bulkPut(archive.bindings);
  });
  notifyProjectsChanged();
}
