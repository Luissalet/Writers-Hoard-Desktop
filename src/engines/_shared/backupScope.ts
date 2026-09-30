import type { Table } from 'dexie';
import { db } from '@/db/index';
import type { BackupImportSection } from './backupRegistry';

export interface ScopedBackupSection extends BackupImportSection {
  engineId: string;
}

export interface ScopedBackupProject {
  projectId: string;
  projectDir: string;
  sections: readonly ScopedBackupSection[];
}

export interface BackupScopeIssue {
  engineId: string;
  projectId: string;
  projectDir: string;
  path: string;
  message: string;
}

interface ChildScope {
  parentTable: string;
  parentField: string;
}

/** Tables whose rows inherit project ownership from a project-scoped parent. */
const CHILD_SCOPES: Readonly<Record<string, ChildScope>> = {
  annotationReferences: { parentTable: 'annotations', parentField: 'annotationId' },
  sceneCasts: { parentTable: 'scenes', parentField: 'sceneId' },
  storyboardConnectors: { parentTable: 'storyboards', parentField: 'storyboardId' },
};

type Row = Record<string, unknown>;

interface ReferenceSpec {
  label: string;
  values: (row: Row) => unknown[];
  targets: (row: Row) => readonly string[];
  /** Parent/child integrity requires the target row to travel in this archive. */
  contained: boolean;
  /** A legitimate cross-project reference can name its target owner's project. */
  targetOwner?: (row: Row) => string | null;
}

const one = (field: string): ((row: Row) => unknown[]) =>
  (row) => row[field] === undefined || row[field] === null || row[field] === ''
    ? []
    : [row[field]];

const many = (field: string): ((row: Row) => unknown[]) =>
  (row) => Array.isArray(row[field]) ? row[field] as unknown[] : one(field)(row);

const fixed = (...tables: string[]): ((row: Row) => readonly string[]) => () => tables;

/** Engine ids are persisted in cross-engine links, so their table mapping is data validation. */
const ENGINE_TABLES: Readonly<Record<string, readonly string[]>> = {
  annotations: ['annotations'],
  biography: ['biographies', 'biographyFacts'],
  board: ['boards', 'boardNodes', 'boardEdges'],
  brainstorm: ['boards', 'boardNodes', 'boardEdges'],
  'character-arc': ['characterArcs', 'arcBeats'],
  codex: ['codexEntries'],
  'dialog-scene': ['scenes', 'dialogBlocks'],
  diary: ['diaryEntries'],
  gallery: ['imageCollections', 'inspirationImages'],
  'image-studio': ['visualRefs', 'imageRecipes', 'inspirationImages'],
  inquiry: ['inquiryCases', 'inquiryClaims', 'inquiryHypotheses', 'inquiryRatings', 'enrichmentRuns'],
  links: ['snapshots'],
  maps: ['worldMaps', 'mapPins'],
  notes: ['notes'],
  outline: ['outlines', 'outlineBeats'],
  'project-tools': [
    'entityLinks',
    'citations',
    'publishingProfiles',
    'conversionReceipts',
    'creativeBranches',
    'creativeBranchDeltas',
    'branchPromotionReceipts',
    'narrativeMoments',
    'storyClaims',
    'sharedCanonEntities',
    'sharedEntityBindings',
  ],
  'real-atlas': ['atlasPlaces', 'atlasDivergences'],
  relationships: ['relationships'],
  scrapper: ['snapshots'],
  seeds: ['seeds', 'payoffs'],
  storyboard: ['storyboards', 'storyboardPanels'],
  timeline: ['timelines', 'timelineEvents'],
  'video-planner': ['videoPlans', 'videoSegments'],
  worldgen: ['generatedWorlds', 'worldWaypoints'],
  writings: ['writings'],
  'writing-stats': ['writingSessions', 'writingGoals'],
  'yarn-board': ['boards', 'boardNodes', 'boardEdges'],
  'ai-assistant': ['aiThreads', 'aiMessages'],
};

const byEngine = (field: string): ((row: Row) => readonly string[]) =>
  (row) => typeof row[field] === 'string' ? ENGINE_TABLES[row[field]] ?? [] : [];

const branchTarget = (row: Row): readonly string[] => {
  if (row.targetKind === 'outline-beat') return ['outlineBeats'];
  if (row.targetKind === 'timeline-event') return ['timelineEvents'];
  if (row.targetKind === 'timeline-connection') return ['timelineConnections'];
  return [];
};

const branchRootTarget = (row: Row): readonly string[] => {
  if (!row.root || typeof row.root !== 'object' || Array.isArray(row.root)) return [];
  return branchTarget({ targetKind: (row.root as Row).kind });
};

const narrativeAnchorTarget = (row: Row): readonly string[] => {
  if (row.anchorKind === 'beat') return ['outlineBeats'];
  if (row.anchorKind === 'scene') return ['scenes'];
  if (row.anchorKind === 'event') return ['timelineEvents'];
  return [];
};

const nestedValues = (field: string, child: string): ((row: Row) => unknown[]) =>
  (row) => row[field] && typeof row[field] === 'object' && !Array.isArray(row[field])
    ? one(child)(row[field] as Row)
    : [];

const nestedEngine = (field: string): ((row: Row) => readonly string[]) =>
  (row) => row[field] && typeof row[field] === 'object' && !Array.isArray(row[field])
    ? byEngine('engineId')(row[field] as Row)
    : [];

const allEntityTables = [...new Set(Object.values(ENGINE_TABLES).flat())];

const REFERENCE_SPECS: Readonly<Record<string, readonly ReferenceSpec[]>> = {
  annotationReferences: [
    { label: 'annotationId', values: one('annotationId'), targets: fixed('annotations'), contained: true },
    { label: 'targetEntityId', values: one('targetEntityId'), targets: byEngine('targetEngineId'), contained: false },
  ],
  annotations: [
    { label: 'sourceEntityId', values: one('sourceEntityId'), targets: byEngine('sourceEngineId'), contained: false },
  ],
  arcBeats: [
    { label: 'arcId', values: one('arcId'), targets: fixed('characterArcs'), contained: true },
    { label: 'linkedBeatId', values: one('linkedBeatId'), targets: fixed('outlineBeats'), contained: false },
    { label: 'linkedSceneId', values: one('linkedSceneId'), targets: fixed('scenes'), contained: false },
  ],
  atlasDivergences: [
    { label: 'placeId', values: one('placeId'), targets: fixed('atlasPlaces'), contained: false },
  ],
  atlasPlaces: [
    { label: 'parentId', values: one('parentId'), targets: fixed('atlasPlaces'), contained: true },
  ],
  biographyFacts: [
    { label: 'biographyId', values: one('biographyId'), targets: fixed('biographies'), contained: true },
    {
      label: 'sources[].entityId',
      values: (row) => Array.isArray(row.sources)
        ? row.sources.flatMap((source) => {
            if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
            const value = (source as Row).entityId;
            return value === undefined || value === null || value === '' ? [] : [value];
          })
        : [],
      targets: fixed('snapshots'),
      contained: false,
    },
  ],
  biographies: [
    { label: 'subjectId', values: one('subjectId'), targets: fixed('codexEntries'), contained: false },
  ],
  boardEdges: [
    { label: 'boardId', values: one('boardId'), targets: fixed('boards'), contained: true },
    {
      label: 'endpoints',
      values: (row) => [
        ...one('sourceId')(row),
        ...one('targetId')(row),
        ...(Array.isArray(row.sources) ? row.sources.flatMap((endpoint) =>
          endpoint && typeof endpoint === 'object' && !Array.isArray(endpoint)
            ? one('id')(endpoint as Row)
            : []) : []),
        ...(Array.isArray(row.targets) ? row.targets.flatMap((endpoint) =>
          endpoint && typeof endpoint === 'object' && !Array.isArray(endpoint)
            ? one('id')(endpoint as Row)
            : []) : []),
      ],
      targets: fixed('boardNodes', 'boardEdges'),
      contained: true,
    },
    { label: 'layerId', values: one('layerId'), targets: fixed('boardLayers'), contained: false },
  ],
  boardLayers: [
    { label: 'boardId', values: one('boardId'), targets: fixed('boards'), contained: true },
  ],
  boardNodes: [
    { label: 'boardId', values: one('boardId'), targets: fixed('boards'), contained: true },
    { label: 'layerId', values: one('layerId'), targets: fixed('boardLayers'), contained: false },
    {
      label: 'ref.entityId',
      values: (row) => row.ref && typeof row.ref === 'object' && !Array.isArray(row.ref)
        ? one('entityId')(row.ref as Row)
        : [],
      targets: (row) => row.ref && typeof row.ref === 'object' && !Array.isArray(row.ref)
        ? byEngine('engineId')(row.ref as Row)
        : [],
      contained: false,
    },
  ],
  boardViews: [
    { label: 'boardId', values: one('boardId'), targets: fixed('boards'), contained: true },
    { label: 'layerIds', values: many('layerIds'), targets: fixed('boardLayers'), contained: false },
  ],
  characterArcs: [
    { label: 'characterId', values: one('characterId'), targets: fixed('codexEntries'), contained: false },
  ],
  citations: [
    { label: 'writingIds', values: many('writingIds'), targets: fixed('writings'), contained: false },
    { label: 'snapshotId', values: one('snapshotId'), targets: fixed('snapshots'), contained: false },
  ],
  codexEntries: [
    {
      label: 'relations[].targetId',
      values: (row) => Array.isArray(row.relations)
        ? row.relations.flatMap((relation) =>
            relation && typeof relation === 'object' && !Array.isArray(relation)
              ? one('targetId')(relation as Row)
              : [])
        : [],
      targets: fixed('codexEntries'),
      contained: false,
    },
  ],
  conversionReceipts: [
    { label: 'sourceEntityId', values: one('sourceEntityId'), targets: byEngine('sourceEngineId'), contained: false },
    { label: 'targetEntityId', values: one('targetEntityId'), targets: byEngine('targetEngineId'), contained: false },
  ],
  creativeBranches: [
    {
      label: 'root.entityId',
      values: (row) => row.root && typeof row.root === 'object' && !Array.isArray(row.root)
        ? one('entityId')(row.root as Row)
        : [],
      targets: branchRootTarget,
      contained: false,
    },
  ],
  creativeBranchDeltas: [
    { label: 'branchId', values: one('branchId'), targets: fixed('creativeBranches'), contained: true },
    { label: 'targetId', values: one('targetId'), targets: branchTarget, contained: false },
  ],
  branchPromotionReceipts: [
    { label: 'branchId', values: one('branchId'), targets: fixed('creativeBranches'), contained: true },
  ],
  narrativeMoments: [
    { label: 'anchorEntityId', values: one('anchorEntityId'), targets: narrativeAnchorTarget, contained: true },
  ],
  storyClaims: [
    { label: 'source.entityId', values: nestedValues('source', 'entityId'), targets: nestedEngine('source'), contained: false },
    { label: 'subject.entityId', values: nestedValues('subject', 'entityId'), targets: nestedEngine('subject'), contained: false },
    { label: 'actor.entityId', values: nestedValues('actor', 'entityId'), targets: nestedEngine('actor'), contained: false },
    { label: 'fromMomentId', values: one('fromMomentId'), targets: fixed('narrativeMoments'), contained: true },
    { label: 'untilMomentId', values: one('untilMomentId'), targets: fixed('narrativeMoments'), contained: true },
    { label: 'acquiredAtMomentId', values: one('acquiredAtMomentId'), targets: fixed('narrativeMoments'), contained: true },
    { label: 'revealedAtMomentId', values: one('revealedAtMomentId'), targets: fixed('narrativeMoments'), contained: true },
    { label: 'codexEntryId', values: one('codexEntryId'), targets: fixed('codexEntries'), contained: false },
  ],
  sharedEntityBindings: [
    {
      label: 'sharedEntityId',
      values: one('sharedEntityId'),
      targets: fixed('sharedCanonEntities'),
      contained: false,
      targetOwner: (row) => typeof row.seriesId === 'string' && row.seriesId ? row.seriesId : null,
    },
    { label: 'local.entityId', values: nestedValues('local', 'entityId'), targets: nestedEngine('local'), contained: false },
  ],
  dialogBlocks: [
    { label: 'sceneId', values: one('sceneId'), targets: fixed('scenes'), contained: true },
  ],
  entityLinks: [
    { label: 'sourceEntityId', values: one('sourceEntityId'), targets: byEngine('sourceEngineId'), contained: false },
    { label: 'targetEntityId', values: one('targetEntityId'), targets: byEngine('targetEngineId'), contained: false },
  ],
  imageRecipes: [
    { label: 'imageId', values: one('imageId'), targets: fixed('inspirationImages'), contained: false },
    {
      label: 'inputs.*.imageId',
      values: (row) => {
        if (!row.inputs || typeof row.inputs !== 'object' || Array.isArray(row.inputs)) return [];
        const inputs = row.inputs as Row;
        const singleRefs = ['initImage', 'maskImage', 'controlImage'].flatMap((field) => {
          const ref = inputs[field];
          return ref && typeof ref === 'object' && !Array.isArray(ref)
            ? one('imageId')(ref as Row)
            : [];
        });
        const refs = Array.isArray(inputs.refImages)
          ? inputs.refImages.flatMap((ref) =>
              ref && typeof ref === 'object' && !Array.isArray(ref)
                ? one('imageId')(ref as Row)
                : [])
          : [];
        return [...singleRefs, ...refs];
      },
      targets: fixed('inspirationImages'),
      contained: false,
    },
  ],
  inspirationImages: [
    { label: 'collectionId', values: one('collectionId'), targets: fixed('imageCollections'), contained: false },
    { label: 'linkedEntryIds', values: many('linkedEntryIds'), targets: fixed('codexEntries'), contained: false },
    { label: 'linkedEntryId', values: one('linkedEntryId'), targets: fixed('codexEntries'), contained: false },
    {
      label: 'generation image references',
      values: (row) => {
        if (!row.generation || typeof row.generation !== 'object' || Array.isArray(row.generation)) return [];
        const generation = row.generation as Row;
        return [
          ...one('initImageId')(generation),
          ...one('maskImageId')(generation),
          ...one('controlImageId')(generation),
          ...many('refImageIds')(generation),
        ];
      },
      targets: fixed('inspirationImages'),
      contained: false,
    },
  ],
  mapPins: [
    { label: 'mapId', values: one('mapId'), targets: fixed('worldMaps'), contained: true },
    { label: 'linkedEntryId', values: one('linkedEntryId'), targets: fixed('codexEntries'), contained: false },
    { label: 'sourceWaypointId', values: one('sourceWaypointId'), targets: fixed('worldWaypoints'), contained: false },
  ],
  outlineBeats: [
    { label: 'outlineId', values: one('outlineId'), targets: fixed('outlines'), contained: true },
    { label: 'parentId', values: one('parentId'), targets: fixed('outlineBeats'), contained: true },
    { label: 'linkedWritingId', values: one('linkedWritingId'), targets: fixed('writings'), contained: false },
    { label: 'linkedSceneId', values: one('linkedSceneId'), targets: fixed('scenes'), contained: false },
  ],
  payoffs: [
    { label: 'seedId', values: one('seedId'), targets: fixed('seeds'), contained: true },
    { label: 'linkedBeatId', values: one('linkedBeatId'), targets: fixed('outlineBeats'), contained: false },
    { label: 'linkedSceneId', values: one('linkedSceneId'), targets: fixed('scenes'), contained: false },
    { label: 'linkedWritingId', values: one('linkedWritingId'), targets: fixed('writings'), contained: false },
  ],
  publishingProfiles: [
    { label: 'selectedWritingIds', values: many('selectedWritingIds'), targets: fixed('writings'), contained: false },
    { label: 'writingOrder', values: many('writingOrder'), targets: fixed('writings'), contained: false },
  ],
  inquiryClaims: [
    {
      label: 'supports[].citationId',
      values: (row) => Array.isArray(row.supports)
        ? row.supports.flatMap((support) =>
            support && typeof support === 'object' && !Array.isArray(support)
              ? one('citationId')(support as Row)
              : [])
        : [],
      targets: fixed('citations'),
      contained: false,
    },
    {
      label: 'subject/object codex ids',
      values: (row) => ['subject', 'object'].flatMap((field) => {
        const ref = row[field];
        return ref && typeof ref === 'object' && !Array.isArray(ref) && (ref as Row).kind === 'codex'
          ? one('id')(ref as Row)
          : [];
      }),
      targets: fixed('codexEntries'),
      contained: false,
    },
    { label: 'placeIds', values: many('placeIds'), targets: fixed('atlasPlaces'), contained: false },
  ],
  inquiryRatings: [
    { label: 'hypothesisId', values: one('hypothesisId'), targets: fixed('inquiryHypotheses'), contained: true },
    { label: 'claimId', values: one('claimId'), targets: fixed('inquiryClaims'), contained: true },
  ],
  enrichmentRuns: [
    { label: 'entryId', values: one('entryId'), targets: fixed('codexEntries'), contained: false },
    { label: 'citationId', values: one('citationId'), targets: fixed('citations'), contained: false },
    { label: 'createdCitationIds', values: many('createdCitationIds'), targets: fixed('citations'), contained: false },
  ],
  relationships: [
    { label: 'entityAId', values: one('entityAId'), targets: fixed(...allEntityTables), contained: false },
    { label: 'entityBId', values: one('entityBId'), targets: fixed(...allEntityTables), contained: false },
  ],
  sceneCasts: [
    { label: 'sceneId', values: one('sceneId'), targets: fixed('scenes'), contained: true },
    { label: 'characterId', values: one('characterId'), targets: fixed('codexEntries'), contained: false },
  ],
  seeds: [
    { label: 'linkedBeatId', values: one('linkedBeatId'), targets: fixed('outlineBeats'), contained: false },
    { label: 'linkedSceneId', values: one('linkedSceneId'), targets: fixed('scenes'), contained: false },
    { label: 'linkedWritingId', values: one('linkedWritingId'), targets: fixed('writings'), contained: false },
  ],
  storyboardConnectors: [
    { label: 'storyboardId', values: one('storyboardId'), targets: fixed('storyboards'), contained: true },
    { label: 'sourceId', values: one('sourceId'), targets: fixed('storyboardPanels'), contained: true },
    { label: 'targetId', values: one('targetId'), targets: fixed('storyboardPanels'), contained: true },
  ],
  storyboardPanels: [
    { label: 'storyboardId', values: one('storyboardId'), targets: fixed('storyboards'), contained: true },
    { label: 'imageRef', values: one('imageRef'), targets: fixed('inspirationImages'), contained: false },
    { label: 'linkedSceneId', values: one('linkedSceneId'), targets: fixed('scenes'), contained: false },
  ],
  timelineConnections: [
    { label: 'timelineId', values: one('timelineId'), targets: fixed('timelines'), contained: true },
    { label: 'sourceEventId', values: one('sourceEventId'), targets: fixed('timelineEvents'), contained: true },
    { label: 'targetEventId', values: one('targetEventId'), targets: fixed('timelineEvents'), contained: true },
  ],
  timelineEvents: [
    { label: 'timelineId', values: one('timelineId'), targets: fixed('timelines'), contained: true },
    { label: 'linkedEntryId', values: one('linkedEntryId'), targets: fixed('codexEntries'), contained: false },
  ],
  videoSegments: [
    { label: 'videoPlanId', values: one('videoPlanId'), targets: fixed('videoPlans'), contained: true },
  ],
  visualRefs: [
    { label: 'codexEntryId', values: one('codexEntryId'), targets: fixed('codexEntries'), contained: false },
    { label: 'referenceImageIds', values: many('referenceImageIds'), targets: fixed('inspirationImages'), contained: false },
    { label: 'canonicalImageId', values: one('canonicalImageId'), targets: fixed('inspirationImages'), contained: false },
    { label: 'sheetImageIds', values: many('sheetImageIds'), targets: fixed('inspirationImages'), contained: false },
  ],
  worldMaps: [
    { label: 'sourceWorldId', values: one('sourceWorldId'), targets: fixed('generatedWorlds'), contained: false },
  ],
  worldWaypoints: [
    { label: 'worldId', values: one('worldId'), targets: fixed('generatedWorlds'), contained: true },
  ],
  writingSnapshots: [
    { label: 'writingId', values: one('writingId'), targets: fixed('writings'), contained: true },
  ],
  judgeRuns: [
    { label: 'writingId', values: one('writingId'), targets: fixed('writings'), contained: true },
    {
      label: 'targetVersions[].writingId',
      values: (row) => Array.isArray(row.targetVersions)
        ? row.targetVersions.flatMap((target) =>
            target && typeof target === 'object' && !Array.isArray(target)
              ? one('writingId')(target as Row)
              : [])
        : [],
      targets: fixed('writings'),
      contained: true,
    },
  ],
  judgeFindings: [
    { label: 'runId', values: one('runId'), targets: fixed('judgeRuns'), contained: true },
    { label: 'writingId', values: one('writingId'), targets: fixed('writings'), contained: true },
    {
      label: 'internal.entityId',
      values: (row) => row.internal && typeof row.internal === 'object' && !Array.isArray(row.internal)
        ? one('entityId')(row.internal as Row)
        : [],
      targets: (row) => row.internal && typeof row.internal === 'object' && !Array.isArray(row.internal)
        ? byEngine('engineId')(row.internal as Row)
        : [],
      contained: false,
    },
  ],
  aiMessages: [
    { label: 'threadId', values: one('threadId'), targets: fixed('aiThreads'), contained: true },
  ],
};

interface IndexedRow {
  projectId: string;
  projectDir: string;
  engineId: string;
  table: string;
  path: string;
  record: Row;
  key: unknown;
  keyToken: string;
}

function record(value: unknown): Row | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Row
    : null;
}

function keyToken(value: unknown): string | null {
  if (typeof value === 'string') return value ? `s:${value}` : null;
  if (typeof value === 'number' && Number.isFinite(value)) return `n:${value}`;
  if (Array.isArray(value) && value.length > 0) {
    const parts = value.map(keyToken);
    return parts.every((part): part is string => Boolean(part)) ? `a:${parts.join('|')}` : null;
  }
  return null;
}

function primaryKey(row: Row, table: Table): unknown {
  const keyPath = table.schema.primKey.keyPath;
  if (Array.isArray(keyPath)) return keyPath.map((field) => row[field]);
  if (typeof keyPath === 'string') return row[keyPath];
  return row[table.schema.primKey.name];
}

const PROJECT_SCOPE_FIELDS: Readonly<Record<string, string>> = {
  sharedCanonEntities: 'seriesId',
};

function directProjectScopeField(tableName: string, table: Table): string | null {
  const field = PROJECT_SCOPE_FIELDS[tableName] ?? 'projectId';
  return table.schema.primKey.name === field || Boolean(table.schema.idxByName[field]) ? field : null;
}

function importedKey(
  rowsByProject: Map<string, Map<string, Map<string, IndexedRow>>>,
  projectId: string,
  table: string,
  token: string,
): IndexedRow | undefined {
  return rowsByProject.get(projectId)?.get(table)?.get(token);
}

/**
 * Fail-closed ownership and reference validation shared by project and full
 * restore. It reads current rows only for single-project collision checks; it
 * never writes, rewrites or "repairs" archive data.
 */
export async function validateBackupScopes(
  projects: readonly ScopedBackupProject[],
  checkExistingCollisions: boolean,
): Promise<BackupScopeIssue[]> {
  const issues: BackupScopeIssue[] = [];
  const tables = new Map(db.tables.map((table) => [table.name, table]));
  const rows: IndexedRow[] = [];
  const rowsByProject = new Map<string, Map<string, Map<string, IndexedRow>>>();
  const ownersByTable = new Map<string, Map<string, Set<string>>>();
  const existingCache = new Map<string, Promise<Row | undefined>>();

  const addIssue = (source: Omit<BackupScopeIssue, 'message'>, message: string): void => {
    if (issues.length >= 100) return;
    issues.push({ ...source, message });
  };

  const sourceOf = (project: ScopedBackupProject, section: ScopedBackupSection) => ({
    engineId: section.engineId,
    projectId: project.projectId,
    projectDir: project.projectDir,
    path: section.path,
  });

  for (const project of projects) {
    for (const section of project.sections) {
      const table = tables.get(section.table);
      if (!table) {
        addIssue(
          sourceOf(project, section),
          `Backup section "${section.table}" targets a table outside the current schema.`,
        );
        continue;
      }
      const childScope = CHILD_SCOPES[section.table];
      const scopeField = directProjectScopeField(section.table, table);
      // Global tables may be DECLARED by a project engine but a project archive
      // is never allowed to carry their rows. An empty inventory proves the
      // strategy has no hidden write path; a single row still fails closed.
      if (!scopeField && !childScope && section.rows.length === 0) {
        continue;
      }
      if (!scopeField && !childScope) {
        addIssue(
          sourceOf(project, section),
          `Backup section "${section.table}" has no declared project ownership rule.`,
        );
        continue;
      }
      for (const [index, value] of section.rows.entries()) {
        const row = record(value);
        if (!row) {
          addIssue(sourceOf(project, section), `Table "${section.table}" row ${index + 1} is not an object.`);
          continue;
        }
        if (scopeField && row[scopeField] !== project.projectId) {
          addIssue(
            sourceOf(project, section),
            `Table "${section.table}" row ${index + 1} does not belong to project "${project.projectId}".`,
          );
          continue;
        }
        const key = primaryKey(row, table);
        const token = keyToken(key);
        if (!token) {
          addIssue(
            sourceOf(project, section),
            `Table "${section.table}" row ${index + 1} has no valid primary key.`,
          );
          continue;
        }
        const tableRows = rowsByProject.get(project.projectId) ?? new Map<string, Map<string, IndexedRow>>();
        rowsByProject.set(project.projectId, tableRows);
        const keyedRows = tableRows.get(section.table) ?? new Map<string, IndexedRow>();
        tableRows.set(section.table, keyedRows);
        if (keyedRows.has(token)) {
          addIssue(
            sourceOf(project, section),
            `Table "${section.table}" contains a duplicate primary key.`,
          );
          continue;
        }
        const indexed: IndexedRow = {
          projectId: project.projectId,
          projectDir: project.projectDir,
          engineId: section.engineId,
          table: section.table,
          path: section.path,
          record: row,
          key,
          keyToken: token,
        };
        keyedRows.set(token, indexed);
        rows.push(indexed);

        const tableOwners = ownersByTable.get(section.table) ?? new Map<string, Set<string>>();
        ownersByTable.set(section.table, tableOwners);
        const owners = tableOwners.get(token) ?? new Set<string>();
        tableOwners.set(token, owners);
        owners.add(project.projectId);
        if (owners.size > 1) {
          addIssue(
            sourceOf(project, section),
            `Table "${section.table}" reuses one primary key across archive projects.`,
          );
        }
      }
    }
  }

  const readExisting = async (tableName: string, key: unknown, token: string): Promise<Row | undefined> => {
    const cacheKey = `${tableName}\u0000${token}`;
    let pending = existingCache.get(cacheKey);
    if (!pending) {
      const table = tables.get(tableName);
      pending = table
        ? table.get(key as never).then((value) => record(value) ?? undefined)
        : Promise.resolve(undefined);
      existingCache.set(cacheKey, pending);
    }
    return pending;
  };

  const existingOwner = async (
    tableName: string,
    row: Row,
    seen = new Set<string>(),
  ): Promise<string | null> => {
    const table = tables.get(tableName);
    if (!table) return null;
    const scopeField = directProjectScopeField(tableName, table);
    if (scopeField) {
      return typeof row[scopeField] === 'string' ? row[scopeField] as string : null;
    }
    const scope = CHILD_SCOPES[tableName];
    if (!scope) return null;
    const parentKey = row[scope.parentField];
    const token = keyToken(parentKey);
    if (!token || seen.has(`${scope.parentTable}:${token}`)) return null;
    seen.add(`${scope.parentTable}:${token}`);
    const parent = await readExisting(scope.parentTable, parentKey, token);
    return parent ? existingOwner(scope.parentTable, parent, seen) : null;
  };

  if (checkExistingCollisions) {
    for (const row of rows) {
      const existing = await readExisting(row.table, row.key, row.keyToken);
      if (!existing) continue;
      const owner = await existingOwner(row.table, existing);
      if (owner !== row.projectId) {
        addIssue(
          row,
          `Table "${row.table}" would overwrite a primary key owned outside project "${row.projectId}".`,
        );
      }
    }
  }

  const targetsInArchive = (
    projectId: string,
    targetTables: readonly string[],
    token: string,
  ): boolean => targetTables.some((table) => importedKey(rowsByProject, projectId, table, token));

  const foreignArchiveTarget = (
    projectId: string,
    targetTables: readonly string[],
    token: string,
  ): boolean => targetTables.some((table) => {
    const owners = ownersByTable.get(table)?.get(token);
    return Boolean(owners?.size && !owners.has(projectId));
  });

  for (const row of rows) {
    const specs = REFERENCE_SPECS[row.table] ?? [];
    for (const spec of specs) {
      const targetTables = spec.targets(row.record).filter((table) => tables.has(table));
      const targetOwner = spec.targetOwner ? spec.targetOwner(row.record) : row.projectId;
      for (const value of spec.values(row.record)) {
        const token = keyToken(value);
        if (!token) {
          addIssue(row, `Table "${row.table}" has an invalid ${spec.label} reference.`);
          continue;
        }
        if (!targetTables.length) {
          addIssue(
            row,
            `Table "${row.table}" has a ${spec.label} reference whose owner cannot be validated.`,
          );
          continue;
        }
        if (!targetOwner) {
          addIssue(row, `Table "${row.table}" has a ${spec.label} reference with no valid owner.`);
          continue;
        }
        if (targetsInArchive(targetOwner, targetTables, token)) continue;
        if (spec.contained) {
          addIssue(
            row,
            `Table "${row.table}" has a ${spec.label} reference outside project "${targetOwner}" in this archive.`,
          );
          continue;
        }
        if (foreignArchiveTarget(targetOwner, targetTables, token)) {
          addIssue(
            row,
            `Table "${row.table}" has a ${spec.label} reference owned by another archive project.`,
          );
          continue;
        }
        if (!checkExistingCollisions) continue;
        for (const targetTable of targetTables) {
          const existing = await readExisting(targetTable, value, token);
          if (!existing) continue;
          const owner = await existingOwner(targetTable, existing);
          if (owner !== targetOwner) {
            addIssue(
              row,
              `Table "${row.table}" has a ${spec.label} reference owned outside project "${targetOwner}".`,
            );
            break;
          }
        }
      }
    }
  }

  return issues;
}
