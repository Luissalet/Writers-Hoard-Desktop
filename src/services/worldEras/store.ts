import {projectWritingOwner} from '@/engines/writings/manuscriptStore';
import { applyEraReaderCover, validateProjectCoverMetadata } from '@/engines/writings/coverDesign/model';
import {validateToolDockProjectMetadata,renewToolDockGeneration} from '@/engines/writings/toolDock/types';
import Dexie, { type Transaction } from 'dexie';
import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import type { Project } from '@/types';
import { validateWorldCalendar } from '@/engines/timeline/worldCalendar';
import { validateLocalToolProjectStates } from '@/engines/local/stateTypes';
import { validateWorkspaceAppearanceProject } from '@/services/workspaceAppearance/validation';
import { baseEraDocuments, eraAdapters, eraAdapterForTable, eraDocumentVersion, validateEraDocument } from './adapters';
import { releaseUnreferencedEraAsset, resolveEraDocumentAssets, storeEraDocumentAssets } from './assets';
import { eraDocumentKey, eraDocumentKinds, WorldEraConflict, type EraDocument, type EraDocumentKind, type EraDocumentRead, type EraRow, type WorldEra, type WorldEraScope, type WorldEraVariant, type WorldEraVariantState } from './types';

// Nested domain operations share a transaction. Announce only committed state,
// and never let event handlers inherit a transaction that is about to close.
const pendingAnnouncements = new WeakMap<Transaction, { projects: boolean; owners: Set<string> }>();
export function announceEraChange(projectId: string, projects = false): void {
  const emit = (owners: Iterable<string>, projectMetadata: boolean) => Dexie.ignoreTransaction(() => { if (projectMetadata) notifyProjectsChanged(); for (const owner of owners) notifyDataChanged({ source: 'other', projectId: owner }); });
  let transaction = Dexie.currentTransaction;
  if (!transaction) { emit([projectId], projects); return; }
  while (transaction.parent) transaction = transaction.parent;
  let announcement = pendingAnnouncements.get(transaction);
  if (!announcement) {
    announcement = { projects: false, owners: new Set() }; pendingAnnouncements.set(transaction, announcement);
    const committed = announcement;
    transaction.on('complete', () => emit(committed.owners, committed.projects));
  }
  announcement.owners.add(projectId); announcement.projects ||= projects;
}

function variantHistory(previous?: WorldEraVariant): WorldEraVariantState[] {
  if (!previous) return [];
  const { revision, updatedAt, hidden, archived, document } = previous;
  return [...previous.history ?? [], { revision, updatedAt, hidden, archived, document }];
}
export async function assertWorldEra(scope: WorldEraScope): Promise<Project> {
  const project = await db.projects.get(scope.projectId); if (!project) throw new Error('project_missing');
  if (scope.eraId && !project.worldEras?.some(era => era.id === scope.eraId)) throw new Error('world_era_missing');
  return project;
}
export async function saveWorldEra(projectId: string, draft: WorldEra, expectedRevision: number | null): Promise<WorldEra> {
  if (!draft.id || !draft.name.trim() || typeof draft.description !== 'string' || draft.theme && Object.values(draft.theme).some(value => value !== undefined && !/^#[\da-f]{6}$/i.test(value))) throw new Error('world_era_invalid');
  if (draft.defaults?.worldCalendar && validateWorldCalendar(draft.defaults.worldCalendar).length) throw new Error('world_era_calendar_invalid');
  const saved = await db.transaction('rw', db.projects, async () => {
    const project = await assertWorldEra({ projectId }), current = project.worldEras?.find(era => era.id === draft.id);
    if (expectedRevision === null ? !!current : current?.revision !== expectedRevision) throw new WorldEraConflict();
    const now = Date.now(), next = { ...structuredClone(draft), readerCover: current?.readerCover ?? draft.readerCover, workspaceAppearance: current?.workspaceAppearance ?? draft.workspaceAppearance, localToolStates: current?.localToolStates ?? draft.localToolStates, name: draft.name.trim(), revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now };
    validateWorkspaceAppearanceProject({ worldEras: [next] });
    validateProjectCoverMetadata({ worldEras: [next] });
    validateToolDockProjectMetadata({worldEras:[next]});
    validateLocalToolProjectStates({ ...project, worldEras: current ? project.worldEras!.map(era => era.id === next.id ? next : era) : [...project.worldEras ?? [], next] });
    await db.projects.update(projectId, { worldEras: current ? project.worldEras!.map(era => era.id === next.id ? next : era) : [...project.worldEras ?? [], next], updatedAt: Math.max(now, project.updatedAt + 1) }); return next;
  }); announceEraChange(projectId, true); return saved;
}
export async function listWorldDocuments(scope: WorldEraScope, kind: EraDocumentKind, entityId?: string): Promise<EraDocumentRead[]> {
  const project = await assertWorldEra(scope), base = await baseEraDocuments(scope.projectId, kind, project, entityId), byId = new Map<string, EraDocumentRead>(await Promise.all(base.map(async document => [document.root.id, { document, provenance: 'base' as const, version: await eraDocumentVersion(document), variantRevision: null }] as const)));
  if (scope.eraId) for (const variant of await (entityId ? db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([scope.projectId, scope.eraId, kind, entityId]) : db.worldEraVariants.where('[projectId+eraId+kind]').equals([scope.projectId, scope.eraId, kind])).toArray()) {
    if (variant.archived) continue;
    if (variant.hidden) byId.delete(variant.entityId);
    else if (variant.document) byId.set(variant.entityId, { document: await resolveEraDocumentAssets(scope.projectId, structuredClone(variant.document)), provenance: 'variant', version: `variant:${variant.revision}`, variantRevision: variant.revision });
  }
  if(kind==='writings')for(const read of byId.values())read.document=await projectWritingOwner(scope.projectId,read.document);
  return [...byId.values()];
}
export async function readWorldDocument(scope: WorldEraScope, kind: EraDocumentKind, entityId: string): Promise<EraDocumentRead | undefined> {
  const project = await assertWorldEra(scope);
  if (scope.eraId) {
    const variant = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([scope.projectId, scope.eraId, kind, entityId]).first();
    if (variant && !variant.archived) {
      if (variant.hidden || !variant.document) return undefined;
      const document=await resolveEraDocumentAssets(scope.projectId, structuredClone(variant.document));return { document:kind==='writings'?await projectWritingOwner(scope.projectId,document):document, provenance: 'variant', version: `variant:${variant.revision}`, variantRevision: variant.revision };
    }
  }
  const document = (await baseEraDocuments(scope.projectId, kind, project, entityId))[0];
  return document ? { document:kind==='writings'?await projectWritingOwner(scope.projectId,document):document, provenance: 'base', version: await eraDocumentVersion(document), variantRevision: null } : undefined;
}
export interface WorldEraWriteOptions { checkpoint?: boolean }
export function saveEraDocument(scope: WorldEraScope, kind: EraDocumentKind, document: EraDocument, expectedVersion: string | null, options: WorldEraWriteOptions = {}): Promise<EraDocumentRead> {
  if (!scope.eraId) return Dexie.Promise.reject(new Error('world_era_required_for_variant'));
  return Dexie.Promise.resolve(resolveEraDocumentAssets(scope.projectId,document)).then(resolved=>{
  document=resolved;
  validateEraDocument(scope.projectId, kind, document.root.id, document);
  return db.transaction('rw', db.tables, async tx => {
    await assertWorldEra(scope);
    if(kind==='writings')document=await projectWritingOwner(scope.projectId,document);
    const current = await readWorldDocument(scope, kind, document.root.id);
    if ((current?.version ?? null) !== expectedVersion) throw new WorldEraConflict();
    const previous = await tx.table<WorldEraVariant>('worldEraVariants').where('[projectId+eraId+kind+entityId]').equals([scope.projectId, scope.eraId!, kind, document.root.id]).first();
    const revision = (previous?.revision ?? 0) + 1, now = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1, Number(current?.document.root.updatedAt ?? 0) + 1), nextDocument = structuredClone(document);
    const sameWriting = kind === 'writings' && current && await eraDocumentVersion({ root: current.document.root, children: {} }) === await eraDocumentVersion({ root: nextDocument.root, children: {} });
    if ('updatedAt' in nextDocument.root && !sameWriting && current) nextDocument.root.updatedAt = now;
    if ('revision' in nextDocument.root) nextDocument.root.revision = Number(current?.document.root.revision ?? 0) + 1;
    const next: WorldEraVariant = { id: previous?.id ?? crypto.randomUUID(), projectId: scope.projectId, eraId: scope.eraId!, kind, entityId: document.root.id, revision, updatedAt: now, document: await storeEraDocumentAssets(scope, kind, nextDocument), history: options.checkpoint ? previous?.history ?? [] : variantHistory(previous) };
    await tx.table<WorldEraVariant>('worldEraVariants').put(next);
    if (options.checkpoint) await releaseUnreferencedEraAsset(scope.projectId, previous?.document?.root.__worldEraAssetId);
    return { document: nextDocument, provenance: 'variant' as const, version: `variant:${revision}`, variantRevision: revision };
  });
  }).then(result=>{announceEraChange(scope.projectId);return result;});
}
export async function hideEraDocument(scope: WorldEraScope, kind: EraDocumentKind, entityId: string, expectedVersion: string): Promise<void> {
  if (!scope.eraId) throw new Error('world_era_required_for_variant');
  await db.transaction('rw', db.tables, async () => {
    const current = await readWorldDocument(scope, kind, entityId); if (current?.version !== expectedVersion) throw new WorldEraConflict();
    const previous = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([scope.projectId, scope.eraId!, kind, entityId]).first();
    await db.worldEraVariants.put({ id: previous?.id ?? crypto.randomUUID(), projectId: scope.projectId, eraId: scope.eraId!, kind, entityId, hidden: true, document: await storeEraDocumentAssets(scope, kind, structuredClone(current.document)), history: variantHistory(previous), revision: (previous?.revision ?? 0) + 1, updatedAt: Date.now() });
  }); announceEraChange(scope.projectId);
}
export async function resetEraDocument(scope: WorldEraScope, kind: EraDocumentKind, entityId: string, expectedRevision: number): Promise<void> {
  if (!scope.eraId) throw new Error('world_era_required_for_variant');
  await db.transaction('rw', [db.projects, db.worldEraVariants], async () => {
    await assertWorldEra(scope);
    const current = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([scope.projectId, scope.eraId!, kind, entityId]).first();
    if (current?.revision !== expectedRevision) throw new WorldEraConflict();
    // Retain the previous variant as recoverable history; reads inherit the base.
    await db.worldEraVariants.update(current.id, { archived: true, history: variantHistory(current), revision: current.revision + 1, updatedAt: Date.now() });
  }); announceEraChange(scope.projectId);
}
export async function getEraProject(scope: WorldEraScope): Promise<Project> {
  const project = await assertWorldEra(scope); if (!scope.eraId) return project;
  const defaults = project.worldEras?.find(era => era.id === scope.eraId)?.defaults;
  const result = { ...project, ...Object.fromEntries(Object.entries(defaults ?? {}).filter(([key, value]) => value !== undefined && !(key==='writingToolDock'&&value===null))) };
  for (const kind of eraDocumentKinds) { const field = eraAdapters[kind].metadata; if (field) Object.assign(result, { [field]: (await listWorldDocuments(scope, kind)).map(item => item.document.root) }); }
  return applyEraReaderCover(result, project.worldEras?.find(era => era.id === scope.eraId));
}
/** Contextual defaults and authoring sidecars; world documents remain variants. */
export async function updateWorldEraDefaults(scope: WorldEraScope, changes: NonNullable<WorldEra['defaults']>): Promise<void> {
  if (!scope.eraId) throw new Error('world_era_required_for_defaults');
  await db.transaction('rw', db.projects, async () => {
    const project = await assertWorldEra(scope), era = project.worldEras!.find(item => item.id === scope.eraId)!;
    await saveWorldEra(scope.projectId, { ...era, defaults: { ...era.defaults, ...changes } }, era.revision);
  });
}
export async function listEraRows<T>(scope: WorldEraScope, table: string): Promise<T[]> {
  const adapter = eraAdapterForTable(table); if (!adapter) throw new Error('world_era_table_unsupported');
  const documents = await listWorldDocuments(scope, adapter.kind);
  return documents.flatMap(item => adapter.parentField ? item.document.children[table] ?? [] : [item.document.root]) as T[];
}
export async function readEraRow<T>(scope: WorldEraScope, table: string, id: string): Promise<T | undefined> {
  const adapter = eraAdapterForTable(table); if (!adapter) throw new Error('world_era_table_unsupported');
  if (!adapter.parentField) return (await readWorldDocument(scope, adapter.kind, id))?.document.root as T | undefined;
  return (await listEraRows<T & { id: string }>(scope, table)).find(row => row.id === id);
}
export interface EraRowMutation { table: string; id: string; row?: EraRow; changes?: Record<string, unknown>; remove?: boolean }
export async function mutateEraRows(scope: WorldEraScope, changes: EraRowMutation[], expected?: ReadonlyMap<string, string>): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const expanded = [...changes];
    for (const change of changes.filter(change => change.remove)) {
      if (change.table === 'timelineEvents' || change.table === 'timelines') {
        const eventIds = change.table === 'timelineEvents' ? [change.id] : (await listEraRows<EraRow>(scope, 'timelineEvents')).filter(row => row.timelineId === change.id).map(row => row.id);
        for (const row of await listEraRows<EraRow>(scope, 'timelineConnections')) if (eventIds.includes(String(row.sourceEventId)) || eventIds.includes(String(row.targetEventId))) {
          if (change.table !== 'timelines' || row.timelineId !== change.id) expanded.push({ table: 'timelineConnections', id: row.id, remove: true });
        }
      }
      if (change.table === 'boardLayers') {
        for (const table of ['boardNodes', 'boardEdges']) for (const row of await listEraRows<EraRow>(scope, table)) if (row.layerId === change.id) expanded.push({ table, id: row.id, changes: { layerId: undefined } });
        for (const row of await listEraRows<EraRow>(scope, 'boardViews')) if (Array.isArray(row.layerIds) && row.layerIds.includes(change.id)) expanded.push({ table: 'boardViews', id: row.id, changes: { layerIds: row.layerIds.filter(id => id !== change.id) } });
      }
    }
    const documents = new Map<string, { kind: EraDocumentKind; read?: EraDocumentRead; document: EraDocument }>();
    for (const change of expanded) {
      const adapter = eraAdapterForTable(change.table); if (!adapter) throw new Error('world_era_table_unsupported');
      const row = change.row ?? await readEraRow<EraRow>(scope, change.table, change.id);
      if (!row && adapter.parentField) continue;
      const rootId = adapter.parentField ? String(row![adapter.parentField]) : change.id, key = eraDocumentKey(adapter.kind, rootId);
      let target = documents.get(key);
      if (!target) { const read = await readWorldDocument(scope, adapter.kind, rootId); target = { kind: adapter.kind, read, document: read ? structuredClone(read.document) : { root: change.row!, children: {} } }; documents.set(key, target); }
      if (adapter.parentField) {
        const rows = target.document.children[change.table] ?? [], old = rows.find(row => row.id === change.id);
        target.document.children[change.table] = change.remove ? rows.filter(row => row.id !== change.id) : old ? rows.map(row => row.id === change.id ? { ...row, ...change.row, ...change.changes } : row) : [...rows, { ...change.row!, ...change.changes }];
      } else if (change.remove) { if (target.read) await hideEraDocument(scope, adapter.kind, rootId, target.read.version); documents.delete(key); }
      else target.document.root = { ...target.document.root, ...change.row, ...change.changes };
    }
    for (const [key, target] of documents) await saveEraDocument(scope, target.kind, target.document, expected?.get(key) ?? target.read?.version ?? null);
  });
}
export async function saveEraMetadata(scope: WorldEraScope, kind: EraDocumentKind, row: EraRow, expectedRoot?: EraRow | null, options?: WorldEraWriteOptions): Promise<EraRow> {
  const current = await readWorldDocument(scope, kind, row.id);
  if (expectedRoot && (!current || await eraDocumentVersion({ root: expectedRoot, children: {} }) !== await eraDocumentVersion({ root: current.document.root, children: {} }))) throw new WorldEraConflict();
  if (expectedRoot === null && current) throw new WorldEraConflict();
  return (await saveEraDocument(scope, kind, { root: row, children: {} }, current?.version ?? null, options)).document.root;
}
/** Existing domain operations validate/mutate a projected collection, then persist only changed documents. */
export async function updateEraProjectMetadata(scope: WorldEraScope, changes: Partial<Project>): Promise<void> {
  if (!scope.eraId) { await db.projects.update(scope.projectId, changes); return; }
  await db.transaction('rw', db.tables, async () => {
    for (const kind of eraDocumentKinds) {
      const field = eraAdapters[kind].metadata; if (!field || !Object.hasOwn(changes, field)) continue;
      const next = changes[field] as EraRow[], current = await listWorldDocuments(scope, kind);
      for (const read of current) if (!next.some(row => row.id === read.document.root.id)) await hideEraDocument(scope, kind, read.document.root.id, read.version);
      for (const row of next) {
        const read = current.find(item => item.document.root.id === row.id), document = { root: row, children: {} };
        if (!read || await eraDocumentVersion(read.document) !== await eraDocumentVersion(document)) await saveEraDocument(scope, kind, document, read?.version ?? null);
      }
    }
  });
}

/** Restore an archived variant or an earlier own version without changing Base. */
export async function restoreEraVersion(scope: WorldEraScope, kind: EraDocumentKind, entityId: string, expectedRevision: number, sourceRevision: number): Promise<void> {
  if (!scope.eraId) throw new Error('world_era_required_for_variant');
  await db.transaction('rw', [db.projects, db.worldEraVariants], async () => {
    await assertWorldEra(scope);
    const current = await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([scope.projectId, scope.eraId!, kind, entityId]).first();
    if (current?.revision !== expectedRevision) throw new WorldEraConflict();
    const source = current.revision === sourceRevision ? current : current.history?.find(item => item.revision === sourceRevision);
    if (!source?.document) throw new Error('world_era_version_missing');
    const document = structuredClone(source.document);
    if(kind==='local-tool')document.root.generation=crypto.randomUUID();
    if(kind==='writings'&&document.root.toolDock)document.root.toolDock=renewToolDockGeneration(document.root.toolDock as import('@/engines/writings/toolDock/types').ToolDockLayout,crypto.randomUUID());
    if ('revision' in document.root) document.root.revision = Number(current.document?.root.revision ?? 0) + 1;
    if ('updatedAt' in document.root) document.root.updatedAt = Math.max(Date.now(), Number(current.document?.root.updatedAt ?? 0) + 1);
    await db.worldEraVariants.put({ ...current, document, hidden: false, archived: false, history: variantHistory(current), revision: current.revision + 1, updatedAt: Date.now() });
  }); announceEraChange(scope.projectId);
}
