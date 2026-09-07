// ============================================================================
// Project Health & Recovery — read-only inventory and guarded repairs
// ============================================================================
//
// A health finding is not authority to mutate data. Every repair goes through
// the same sequence:
//
//   inspect -> immutable preview -> explicit UI confirmation -> safety backup
//   -> repeat the inspection inside the write transaction -> apply
//
// The repeated inspection closes the race between preview/backup and commit.
// The full archive is written by Electron, outside IndexedDB, so a database
// rollback and a recovery copy are independent failure boundaries.

import { db } from '@/db';
import {
  getAllEntityResolvers,
  type EntityResolverConfig,
} from '@/engines/_shared/entityResolverRegistry';
import { canonicalJson, sha256Hex } from '@/services/aiRuntime/recipe';

export type ProjectHealthRepairIssueId =
  | 'orphan-writing-snapshots'
  | 'orphan-board-edges'
  | 'orphan-storyboard-connectors'
  | 'orphan-scene-casts'
  | 'orphan-annotation-references'
  | 'orphan-world-snapshots'
  | 'interrupted-native-jobs'
  | 'broken-gallery-collections'
  | 'broken-map-pins'
  | 'broken-spine-links'
  | 'engine-order'
  | 'broken-entity-links'
  | 'broken-citations'
  | 'broken-annotation-targets';

export type ProjectProvenanceFindingId =
  | 'broken-entity-links'
  | 'broken-citations'
  | 'broken-conversion-provenance'
  | 'broken-annotation-origins'
  | 'broken-annotation-targets';

export type ProjectHealthRepairErrorCode =
  | 'project-not-found'
  | 'not-repairable'
  | 'nothing-to-repair'
  | 'confirmation-required'
  | 'stale-preview'
  | 'pending-writes'
  | 'backup-unavailable'
  | 'backup-failed';

export class ProjectHealthRepairError extends Error {
  public readonly code: ProjectHealthRepairErrorCode;

  constructor(
    code: ProjectHealthRepairErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProjectHealthRepairError';
    this.code = code;
  }
}

export interface ProjectHealthInventoryTotals {
  records: number;
  verified: number;
  unchecked: number;
  broken: number;
}

export interface ProjectProvenanceCoverage {
  id: 'entity-links' | 'citations' | 'conversion-history' | 'annotations';
  records: number;
  verified: number;
  unchecked: number;
  broken: number;
}

export interface ProjectProvenanceFinding {
  id: ProjectProvenanceFindingId;
  severity: 'error' | 'warning';
  count: number;
  repairable: boolean;
  scope: 'project';
}

export interface ProjectProvenanceReport {
  status: 'clean' | 'issues' | 'partial';
  totals: ProjectHealthInventoryTotals;
  coverage: ProjectProvenanceCoverage[];
  findings: ProjectProvenanceFinding[];
}

export interface ProjectHealthRepairChange {
  table: string;
  action: 'delete' | 'update';
  count: number;
}

export interface ProjectHealthRepairPreview {
  projectId: string;
  issueId: ProjectHealthRepairIssueId;
  scope: 'project' | 'application';
  count: number;
  changes: ProjectHealthRepairChange[];
  requiresBackup: true;
  confirmationToken: string;
}

export interface ProjectRepairBackupReceipt {
  kind: 'full-archive';
  createdAt: number;
  sizeBytes: number;
}

export interface ProjectHealthRepairResult {
  projectId: string;
  issueId: ProjectHealthRepairIssueId;
  repaired: number;
  backup: ProjectRepairBackupReceipt;
}

type EndpointState = 'valid' | 'missing' | 'foreign' | 'unchecked';
type RecordState = 'valid' | 'broken' | 'unchecked';

interface DeleteRow {
  key: string;
  /** Hash of the row observed during preview; no deleted content enters the UI preview. */
  fingerprint: string;
}

interface DeleteStep {
  kind: 'delete';
  table: string;
  rows: DeleteRow[];
}

interface PatchRow {
  key: string;
  /** Relevant values observed during preview; included in the stale token. */
  expect: Record<string, unknown>;
  set?: Record<string, unknown>;
  unset?: string[];
}

interface PatchStep {
  kind: 'update';
  table: string;
  rows: PatchRow[];
}

type RepairStep = DeleteStep | PatchStep;

interface RepairPlan {
  projectId: string;
  issueId: ProjectHealthRepairIssueId;
  scope: 'project' | 'application';
  steps: RepairStep[];
}

interface ProvenanceAnalysis {
  report: ProjectProvenanceReport;
  brokenEntityLinks: DeleteRow[];
  brokenCitationPatches: PatchRow[];
  brokenAnnotationReferences: DeleteRow[];
}

type BackupWriter = () => Promise<ProjectRepairBackupReceipt>;

const APPLICATION_REPAIRS = new Set<ProjectHealthRepairIssueId>([
  'orphan-scene-casts',
  'orphan-annotation-references',
  'orphan-world-snapshots',
]);

const REPAIRABLE_ISSUES = new Set<ProjectHealthRepairIssueId>([
  'orphan-writing-snapshots',
  'orphan-board-edges',
  'orphan-storyboard-connectors',
  'orphan-scene-casts',
  'orphan-annotation-references',
  'orphan-world-snapshots',
  'interrupted-native-jobs',
  'broken-gallery-collections',
  'broken-map-pins',
  'broken-spine-links',
  'engine-order',
  'broken-entity-links',
  'broken-citations',
  'broken-annotation-targets',
]);

export function isProjectHealthRepairIssueId(
  value: string,
): value is ProjectHealthRepairIssueId {
  return REPAIRABLE_ISSUES.has(value as ProjectHealthRepairIssueId);
}

function abortError(): DOMException {
  return new DOMException('Project health scan cancelled', 'AbortError');
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function compactDelete(table: string, rows: Iterable<DeleteRow>): DeleteStep | null {
  const unique = new Map<string, DeleteRow>();
  for (const row of rows) unique.set(row.key, row);
  const sorted = [...unique.values()].sort((left, right) => left.key.localeCompare(right.key));
  return sorted.length ? { kind: 'delete', table, rows: sorted } : null;
}

function observedDelete(key: string, value: unknown): DeleteRow {
  return { key, fingerprint: sha256Hex(canonicalJson(value)) };
}

function compactPatch(table: string, rows: PatchRow[]): PatchStep | null {
  const sorted = [...rows].sort((left, right) => left.key.localeCompare(right.key));
  return sorted.length ? { kind: 'update', table, rows: sorted } : null;
}

function planCount(plan: RepairPlan): number {
  return plan.steps.reduce(
    (sum, step) => sum + step.rows.length,
    0,
  );
}

function planToken(plan: RepairPlan): string {
  return `health-repair-v1:${sha256Hex(canonicalJson(plan))}`;
}

function previewOf(plan: RepairPlan): ProjectHealthRepairPreview {
  const changes = plan.steps.map((step) => ({
    table: step.table,
    action: step.kind,
    count: step.rows.length,
  }));
  return {
    projectId: plan.projectId,
    issueId: plan.issueId,
    scope: plan.scope,
    count: planCount(plan),
    changes,
    requiresBackup: true,
    confirmationToken: planToken(plan),
  };
}

function sameDisplayedPreview(
  supplied: ProjectHealthRepairPreview,
  current: ProjectHealthRepairPreview,
): boolean {
  return supplied.projectId === current.projectId
    && supplied.issueId === current.issueId
    && supplied.scope === current.scope
    && supplied.count === current.count
    && supplied.requiresBackup === current.requiresBackup
    && supplied.confirmationToken === current.confirmationToken
    && canonicalJson(supplied.changes) === canonicalJson(current.changes);
}

function resolverMap(): Map<string, EntityResolverConfig> {
  return new Map(getAllEntityResolvers().map((resolver) => [resolver.engineId, resolver]));
}

async function resolveExactEndpoint(
  resolvers: ReadonlyMap<string, EntityResolverConfig>,
  projectId: string,
  engineId: string,
  entityType: string,
  entityId: string,
  signal?: AbortSignal,
): Promise<EndpointState> {
  checkAbort(signal);
  const resolver = resolvers.get(engineId);
  if (!resolver || !entityId) return resolver ? 'missing' : 'unchecked';
  try {
    const entity = await resolver.resolveEntity(entityId, entityType);
    checkAbort(signal);
    if (!entity) return 'missing';
    return entity.projectId === projectId ? 'valid' : 'foreign';
  } catch (error) {
    if (signal?.aborted) throw abortError();
    console.warn(`[projectHealth] could not verify ${engineId} provenance`, error);
    return 'unchecked';
  }
}

async function resolveEndpointInEngine(
  resolvers: ReadonlyMap<string, EntityResolverConfig>,
  projectId: string,
  engineId: string,
  entityId: string,
  signal?: AbortSignal,
): Promise<EndpointState> {
  checkAbort(signal);
  const resolver = resolvers.get(engineId);
  if (!resolver) return 'unchecked';
  if (!entityId) return 'missing';
  try {
    let foundForeign = false;
    for (const entityType of resolver.entityTypes) {
      checkAbort(signal);
      const entity = await resolver.resolveEntity(entityId, entityType);
      if (!entity) continue;
      if (entity.projectId === projectId) return 'valid';
      foundForeign = true;
    }
    return foundForeign ? 'foreign' : 'missing';
  } catch (error) {
    if (signal?.aborted) throw abortError();
    console.warn(`[projectHealth] could not verify ${engineId} provenance`, error);
    return 'unchecked';
  }
}

function combineStates(states: readonly EndpointState[]): RecordState {
  if (states.includes('missing') || states.includes('foreign')) return 'broken';
  if (states.includes('unchecked')) return 'unchecked';
  return 'valid';
}

function summarizeCoverage(
  id: ProjectProvenanceCoverage['id'],
  states: readonly RecordState[],
): ProjectProvenanceCoverage {
  return {
    id,
    records: states.length,
    verified: states.filter((state) => state === 'valid').length,
    unchecked: states.filter((state) => state === 'unchecked').length,
    broken: states.filter((state) => state === 'broken').length,
  };
}

async function analyzeProvenance(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProvenanceAnalysis> {
  checkAbort(signal);
  const project = await db.projects.get(projectId);
  if (!project) {
    throw new ProjectHealthRepairError('project-not-found', 'Project not found');
  }
  const [links, citations, receipts, annotations, writingIds, snapshotIds] = await Promise.all([
    db.entityLinks.where('projectId').equals(projectId).toArray(),
    db.citations.where('projectId').equals(projectId).toArray(),
    db.conversionReceipts.where('projectId').equals(projectId).toArray(),
    db.annotations.where('projectId').equals(projectId).toArray(),
    db.writings.where('projectId').equals(projectId).primaryKeys(),
    db.snapshots.where('projectId').equals(projectId).primaryKeys(),
  ]);
  checkAbort(signal);

  const annotationIds = annotations.map((annotation) => annotation.id);
  const references = annotationIds.length
    ? await db.annotationReferences.where('annotationId').anyOf(annotationIds).toArray()
    : [];
  const resolvers = resolverMap();
  const validWritingIds = new Set(writingIds as string[]);
  const validSnapshotIds = new Set(snapshotIds as string[]);

  const linkStates: RecordState[] = [];
  const brokenEntityLinks: DeleteRow[] = [];
  for (const link of links) {
    const state = combineStates([
      await resolveExactEndpoint(
        resolvers,
        projectId,
        link.sourceEngineId,
        link.sourceEntityType,
        link.sourceEntityId,
        signal,
      ),
      await resolveExactEndpoint(
        resolvers,
        projectId,
        link.targetEngineId,
        link.targetEntityType,
        link.targetEntityId,
        signal,
      ),
    ]);
    linkStates.push(state);
    if (state === 'broken') {
      brokenEntityLinks.push(observedDelete(link.id, link));
    }
  }

  const citationStates: RecordState[] = [];
  const brokenCitationPatches: PatchRow[] = [];
  for (const citation of citations) {
    checkAbort(signal);
    const retainedWritings = citation.writingIds.filter((id) => validWritingIds.has(id));
    const keepSnapshot = !citation.snapshotId || validSnapshotIds.has(citation.snapshotId);
    const broken = retainedWritings.length !== citation.writingIds.length || !keepSnapshot;
    citationStates.push(broken ? 'broken' : 'valid');
    if (broken) {
      brokenCitationPatches.push({
        key: citation.id,
        expect: {
          writingIds: citation.writingIds,
          snapshotId: citation.snapshotId ?? null,
        },
        set: { writingIds: retainedWritings },
        unset: keepSnapshot ? undefined : ['snapshotId'],
      });
    }
  }

  const receiptStates: RecordState[] = [];
  for (const receipt of receipts) {
    const source = await resolveEndpointInEngine(
      resolvers,
      projectId,
      receipt.sourceEngineId,
      receipt.sourceEntityId,
      signal,
    );
    const target = await resolveEndpointInEngine(
      resolvers,
      projectId,
      receipt.targetEngineId,
      receipt.targetEntityId,
      signal,
    );
    // A successfully undone conversion is expected to have no target. A
    // foreign target is still broken, and an unavailable resolver stays
    // explicitly unchecked rather than being painted green.
    const normalizedTarget = receipt.undoneAt && target === 'missing'
      ? 'valid'
      : target;
    receiptStates.push(combineStates([source, normalizedTarget]));
  }

  const annotationStates: RecordState[] = [];
  for (const annotation of annotations) {
    annotationStates.push(combineStates([
      await resolveEndpointInEngine(
        resolvers,
        projectId,
        annotation.sourceEngineId,
        annotation.sourceEntityId,
        signal,
      ),
    ]));
  }
  const referenceStates: RecordState[] = [];
  const brokenAnnotationReferences: DeleteRow[] = [];
  for (const reference of references) {
    const endpointState = await resolveEndpointInEngine(
      resolvers,
      projectId,
      reference.targetEngineId,
      reference.targetEntityId,
      signal,
    );
    const state = combineStates([endpointState]);
    referenceStates.push(state);
    if (state === 'broken') {
      brokenAnnotationReferences.push(observedDelete(reference.id, reference));
    }
  }

  const coverage = [
    summarizeCoverage('entity-links', linkStates),
    summarizeCoverage('citations', citationStates),
    summarizeCoverage('conversion-history', receiptStates),
    summarizeCoverage('annotations', [...annotationStates, ...referenceStates]),
  ];
  const totals = coverage.reduce<ProjectHealthInventoryTotals>(
    (sum, row) => ({
      records: sum.records + row.records,
      verified: sum.verified + row.verified,
      unchecked: sum.unchecked + row.unchecked,
      broken: sum.broken + row.broken,
    }),
    { records: 0, verified: 0, unchecked: 0, broken: 0 },
  );
  const findings: ProjectProvenanceFinding[] = [];
  const addFinding = (
    id: ProjectProvenanceFindingId,
    count: number,
    repairable: boolean,
    severity: ProjectProvenanceFinding['severity'],
  ): void => {
    if (count > 0) findings.push({ id, severity, count, repairable, scope: 'project' });
  };
  addFinding('broken-entity-links', brokenEntityLinks.length, true, 'error');
  addFinding('broken-citations', brokenCitationPatches.length, true, 'warning');
  addFinding(
    'broken-conversion-provenance',
    receiptStates.filter((state) => state === 'broken').length,
    false,
    'warning',
  );
  addFinding(
    'broken-annotation-origins',
    annotationStates.filter((state) => state === 'broken').length,
    false,
    'warning',
  );
  addFinding('broken-annotation-targets', brokenAnnotationReferences.length, true, 'warning');

  return {
    report: {
      status: totals.broken > 0 ? 'issues' : totals.unchecked > 0 ? 'partial' : 'clean',
      totals,
      coverage,
      findings,
    },
    brokenEntityLinks,
    brokenCitationPatches,
    brokenAnnotationReferences,
  };
}

/**
 * Deep, local provenance inventory. It returns counts and finding kinds only:
 * entity ids, titles, paths and content never cross into the UI report.
 */
export async function scanProjectProvenance(
  projectId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ProjectProvenanceReport> {
  return (await analyzeProvenance(projectId, options.signal)).report;
}

async function buildRepairPlan(
  projectId: string,
  issueId: ProjectHealthRepairIssueId,
): Promise<RepairPlan> {
  const project = await db.projects.get(projectId);
  if (!project) throw new ProjectHealthRepairError('project-not-found', 'Project not found');
  const steps: RepairStep[] = [];
  const add = (step: RepairStep | null): void => {
    if (step) steps.push(step);
  };

  switch (issueId) {
    case 'orphan-writing-snapshots': {
      const writings = new Set(
        (await db.writings.where('projectId').equals(projectId).primaryKeys()) as string[],
      );
      const rows: DeleteRow[] = [];
      await db.writingSnapshots.where('projectId').equals(projectId).each((row) => {
        if (!writings.has(row.writingId)) {
          rows.push(observedDelete(row.id, row));
        }
      });
      add(compactDelete('writingSnapshots', rows));
      break;
    }
    case 'orphan-board-edges': {
      const nodeIds = new Set(
        (await db.boardNodes.where('projectId').equals(projectId).primaryKeys()) as string[],
      );
      const rows = await db.boardEdges.where('projectId').equals(projectId).toArray();
      const edgeIds = new Set(rows.map((row) => row.id));
      add(compactDelete(
        'boardEdges',
        rows.filter((row) =>
          row.sources.length === 0
          || row.targets.length === 0
          || [...row.sources, ...row.targets].some((endpoint) =>
            endpoint.on === 'edge' ? !edgeIds.has(endpoint.id) : !nodeIds.has(endpoint.id),
          ),
        ).map((row) => observedDelete(row.id, row)),
      ));
      break;
    }
    case 'orphan-storyboard-connectors': {
      const storyboardIds = (
        await db.storyboards.where('projectId').equals(projectId).primaryKeys()
      ) as string[];
      const panelIds = new Set(
        (await db.storyboardPanels.where('projectId').equals(projectId).primaryKeys()) as string[],
      );
      const rows = storyboardIds.length
        ? await db.storyboardConnectors.where('storyboardId').anyOf(storyboardIds).toArray()
        : [];
      add(compactDelete(
        'storyboardConnectors',
        rows.filter((row) => !panelIds.has(row.sourceId) || !panelIds.has(row.targetId))
          .map((row) => observedDelete(row.id, row)),
      ));
      break;
    }
    case 'orphan-scene-casts': {
      const sceneIds = new Set((await db.scenes.toCollection().primaryKeys()) as string[]);
      const rows = await db.sceneCasts.toArray();
      add(compactDelete(
        'sceneCasts',
        rows.filter((row) => !sceneIds.has(row.sceneId))
          .map((row) => observedDelete(row.id, row)),
      ));
      break;
    }
    case 'orphan-annotation-references': {
      const annotationIds = new Set(
        (await db.annotations.toCollection().primaryKeys()) as string[],
      );
      const rows = await db.annotationReferences.toArray();
      add(compactDelete(
        'annotationReferences',
        rows.filter((row) => !annotationIds.has(row.annotationId))
          .map((row) => observedDelete(row.id, row)),
      ));
      break;
    }
    case 'orphan-world-snapshots': {
      const worldIds = new Set(
        (await db.generatedWorlds.toCollection().primaryKeys()) as string[],
      );
      const worldSnapshotIds = (await db.worldSnapshots.toCollection().primaryKeys()) as string[];
      add(compactDelete(
        'worldSnapshots',
        worldSnapshotIds
          .filter((worldId) => !worldIds.has(worldId))
          .map((worldId) => observedDelete(worldId, { worldId })),
      ));
      for (const [tableName, table] of [
        ['canonTiles', db.canonTiles],
        ['renderedTiles', db.renderedTiles],
      ] as const) {
        const rows: DeleteRow[] = [];
        await table.orderBy('worldId').eachKey((worldId, cursor) => {
          if (!worldIds.has(worldId as string)) {
            rows.push(observedDelete(
              cursor.primaryKey as string,
              { worldId: worldId as string },
            ));
          }
        });
        add(compactDelete(tableName, rows));
      }
      break;
    }
    case 'interrupted-native-jobs': {
      const patches: PatchRow[] = [];
      await db.snapshots.where('projectId').equals(projectId).each((row) => {
        const set: Record<string, unknown> = {};
        if (row.downloadState === 'downloading') {
          set.downloadState = 'error';
          set.downloadError = 'The download was interrupted. Retry it from the snapshot.';
        }
        if (row.captureState === 'capturing') {
          set.captureState = 'error';
          set.captureError = 'The capture was interrupted. Retry it from the snapshot.';
        }
        if (Object.keys(set).length) {
          patches.push({
            key: row.id,
            expect: {
              downloadState: row.downloadState ?? null,
              downloadError: row.downloadError ?? null,
              captureState: row.captureState ?? null,
              captureError: row.captureError ?? null,
            },
            set,
          });
        }
      });
      add(compactPatch('snapshots', patches));
      break;
    }
    case 'broken-gallery-collections': {
      const collections = new Set(
        (await db.imageCollections.where('projectId').equals(projectId).primaryKeys()) as string[],
      );
      const patches: PatchRow[] = [];
      await db.inspirationImages.where('projectId').equals(projectId).each((row) => {
        if (row.collectionId && !collections.has(row.collectionId)) {
          patches.push({
            key: row.id,
            expect: { collectionId: row.collectionId },
            unset: ['collectionId'],
          });
        }
      });
      add(compactPatch('inspirationImages', patches));
      break;
    }
    case 'broken-map-pins': {
      const mapIds = new Set(
        (await db.worldMaps.where('projectId').equals(projectId).primaryKeys()) as string[],
      );
      const rows = await db.mapPins.where('projectId').equals(projectId).toArray();
      add(compactDelete(
        'mapPins',
        rows.filter((row) => !mapIds.has(row.mapId))
          .map((row) => observedDelete(row.id, row)),
      ));
      break;
    }
    case 'broken-spine-links': {
      const writingIds = new Set(
        (await db.writings.where('projectId').equals(projectId).primaryKeys()) as string[],
      );
      const sceneIds = new Set(
        (await db.scenes.where('projectId').equals(projectId).primaryKeys()) as string[],
      );
      const rows = await db.outlineBeats.where('projectId').equals(projectId).toArray();
      const patches = rows.flatMap<PatchRow>((row) => {
        const unset: string[] = [];
        if (row.linkedWritingId && !writingIds.has(row.linkedWritingId)) {
          unset.push('linkedWritingId');
        }
        if (row.linkedSceneId && !sceneIds.has(row.linkedSceneId)) {
          unset.push('linkedSceneId');
        }
        return unset.length ? [{
          key: row.id,
          expect: {
            linkedWritingId: row.linkedWritingId ?? null,
            linkedSceneId: row.linkedSceneId ?? null,
          },
          unset,
        }] : [];
      });
      add(compactPatch('outlineBeats', patches));
      break;
    }
    case 'engine-order': {
      const enabled = [...new Set(project.enabledEngines)];
      const enabledSet = new Set(enabled);
      const ordered = [...new Set(project.engineOrder)].filter((id) => enabledSet.has(id));
      const engineOrder = [...ordered, ...enabled.filter((id) => !ordered.includes(id))];
      if (
        canonicalJson(enabled) !== canonicalJson(project.enabledEngines)
        || canonicalJson(engineOrder) !== canonicalJson(project.engineOrder)
      ) {
        add(compactPatch('projects', [{
          key: projectId,
          expect: {
            enabledEngines: project.enabledEngines,
            engineOrder: project.engineOrder,
          },
          set: { enabledEngines: enabled, engineOrder },
        }]));
      }
      break;
    }
    case 'broken-entity-links': {
      const analysis = await analyzeProvenance(projectId);
      add(compactDelete('entityLinks', analysis.brokenEntityLinks));
      break;
    }
    case 'broken-citations': {
      const analysis = await analyzeProvenance(projectId);
      add(compactPatch('citations', analysis.brokenCitationPatches));
      break;
    }
    case 'broken-annotation-targets': {
      const analysis = await analyzeProvenance(projectId);
      add(compactDelete('annotationReferences', analysis.brokenAnnotationReferences));
      break;
    }
    default:
      throw new ProjectHealthRepairError('not-repairable', 'Health issue is not repairable');
  }

  return {
    projectId,
    issueId,
    scope: APPLICATION_REPAIRS.has(issueId) ? 'application' : 'project',
    steps,
  };
}

/** Read-only, exact impact preview. An empty/stale dashboard row cannot repair. */
export async function previewProjectHealthRepair(
  projectId: string,
  issueId: ProjectHealthRepairIssueId,
): Promise<ProjectHealthRepairPreview> {
  const plan = await buildRepairPlan(projectId, issueId);
  if (planCount(plan) === 0) {
    throw new ProjectHealthRepairError('nothing-to-repair', 'No matching rows remain');
  }
  return previewOf(plan);
}

function validBackupReceipt(value: ProjectRepairBackupReceipt): boolean {
  return value.kind === 'full-archive'
    && Number.isFinite(value.createdAt)
    && value.createdAt > 0
    && Number.isFinite(value.sizeBytes)
    && value.sizeBytes > 0;
}

async function applyPlan(plan: RepairPlan): Promise<void> {
  for (const step of plan.steps) {
    const table = db.table(step.table);
    if (step.kind === 'delete') {
      await table.bulkDelete(step.rows.map((row) => row.key));
      continue;
    }
    for (const row of step.rows) {
      const changes = { ...row.set };
      for (const field of row.unset ?? []) changes[field] = undefined;
      await table.update(row.key, changes);
    }
  }
}

async function executeWithBackup(
  suppliedPreview: ProjectHealthRepairPreview,
  backupWriter: BackupWriter,
): Promise<ProjectHealthRepairResult> {
  const currentPlan = await buildRepairPlan(suppliedPreview.projectId, suppliedPreview.issueId);
  const currentPreview = previewOf(currentPlan);
  if (
    !suppliedPreview.confirmationToken.startsWith('health-repair-v1:')
    || suppliedPreview.confirmationToken !== currentPreview.confirmationToken
  ) {
    const code = suppliedPreview.confirmationToken.startsWith('health-repair-v1:')
      ? 'stale-preview'
      : 'confirmation-required';
    throw new ProjectHealthRepairError(code, 'Repair preview is missing or stale');
  }
  if (!sameDisplayedPreview(suppliedPreview, currentPreview)) {
    throw new ProjectHealthRepairError('stale-preview', 'Repair preview no longer matches');
  }
  if (currentPreview.count === 0) {
    throw new ProjectHealthRepairError('nothing-to-repair', 'No matching rows remain');
  }

  let backup: ProjectRepairBackupReceipt;
  try {
    backup = await backupWriter();
  } catch (error) {
    if (error instanceof ProjectHealthRepairError) throw error;
    throw new ProjectHealthRepairError('backup-failed', 'Safety backup failed', { cause: error });
  }
  if (!validBackupReceipt(backup)) {
    throw new ProjectHealthRepairError('backup-failed', 'Safety backup was not verified');
  }

  await db.transaction('rw', db.tables, async () => {
    const commitPlan = await buildRepairPlan(suppliedPreview.projectId, suppliedPreview.issueId);
    if (planToken(commitPlan) !== suppliedPreview.confirmationToken) {
      throw new ProjectHealthRepairError(
        'stale-preview',
        'Project changed after the safety backup; preview again',
      );
    }
    await applyPlan(commitPlan);
  });

  return {
    projectId: suppliedPreview.projectId,
    issueId: suppliedPreview.issueId,
    repaired: currentPreview.count,
    backup,
  };
}

/**
 * Core executor shared by the production backup adapter and deterministic
 * browser tests. UI code must import `projectHealthRecoveryBackup`, whose
 * writer flushes pending edits and requires Electron to confirm a full archive.
 */
export function executeProjectHealthRepairWithBackup(
  preview: ProjectHealthRepairPreview,
  backupWriter: BackupWriter,
): Promise<ProjectHealthRepairResult> {
  return executeWithBackup(preview, backupWriter);
}
