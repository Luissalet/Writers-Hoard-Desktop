import { db } from '@/db';
import { t } from '@/i18n/useTranslation';
import { toLocalDateKey } from '@/engines/writing-stats/date';
import type { OutlineBeat } from '@/engines/outline/types';
import type { Payoff, Seed } from '@/engines/seeds/types';
import {
  buildAppearanceCandidates,
  findAppearances,
  localDaysBetween,
  type ProofreaderCodexRow,
} from './proofreader';
import { indexNameCandidates } from '@/engines/_shared/nameAppearances';
import { countWords, stripHtml } from '@/utils/text';

export type HealthSeverity = 'error' | 'warning' | 'info';
export type ProjectHealthStatus = 'not-applicable' | 'clean' | 'issues';
export type CompletionPercentage = number | null;

export interface ProjectHealthIssue {
  id: string;
  severity: HealthSeverity;
  category: 'integrity' | 'workflow' | 'storage' | 'configuration';
  title: string;
  detail: string;
  count: number;
  repairable: boolean;
}

export interface RecentProjectItem {
  id: string;
  engineId: string;
  title: string;
  subtitle: string;
  updatedAt: number;
}

export interface HubEntity {
  key: string;
  id: string;
  engineId: string;
  entityType: string;
  title: string;
  subtitle?: string;
  updatedAt?: number;
  backlinkCount: number;
}

export interface NarrativeSpineRow {
  beatId: string;
  outlineId: string;
  beatTitle: string;
  outlineTitle: string;
  position?: number;
  status: string;
  writingId?: string;
  writingTitle?: string;
  sceneId?: string;
  sceneTitle?: string;
  seedCount: number;
  arcBeatCount: number;
  continuitySignals: NarrativeContinuitySignal[];
}

export type NarrativeContinuitySignalKind =
  | 'unlinked-beat'
  | 'unpaid-seed'
  | 'payoff-before-setup';

export interface NarrativeContinuitySignal {
  id: string;
  kind: NarrativeContinuitySignalKind;
  beatId?: string;
  seedId?: string;
  seedTitle?: string;
  payoffId?: string;
  payoffTitle?: string;
  setupPosition?: number;
  payoffPosition?: number;
}

export interface NarrativeContinuity {
  signals: NarrativeContinuitySignal[];
  counts: Record<NarrativeContinuitySignalKind, number>;
}

export interface StoryIntelligence {
  totalWords: number;
  draftedDocuments: number;
  outlineCoverage: CompletionPercentage;
  sceneCoverage: CompletionPercentage;
  seedPayoffRate: CompletionPercentage;
  arcCoverage: CompletionPercentage;
  unusedCharacterCount: number;
  unmappedSpeakerCount: number;
  researchCoverage: CompletionPercentage;
}

export interface AssetInventoryItem {
  id: string;
  ownerId: string;
  engineId: string;
  label: string;
  storage: 'indexeddb' | 'managed-file' | 'remote';
  status: 'available' | 'pending' | 'failed' | 'reference-only';
  sizeBytes?: number;
  path?: string;
}

export interface ProjectCockpitData {
  recent: RecentProjectItem[];
  health: ProjectHealthIssue[];
  healthStatus: ProjectHealthStatus;
  entities: HubEntity[];
  spine: NarrativeSpineRow[];
  continuity: NarrativeContinuity;
  spineOptions: {
    writings: Array<{ id: string; title: string }>;
    scenes: Array<{ id: string; title: string }>;
  };
  intelligence: StoryIntelligence;
  assets: AssetInventoryItem[];
  counts: {
    writings: number;
    scenes: number;
    codex: number;
    notes: number;
    research: number;
    unresolved: number;
  };
}

function issue(
  id: string,
  severity: HealthSeverity,
  category: ProjectHealthIssue['category'],
  title: string,
  detail: string,
  count: number,
  repairable = false,
): ProjectHealthIssue | null {
  return count > 0 ? { id, severity, category, title, detail, count, repairable } : null;
}

export function calculateCoverage(part: number, whole: number): CompletionPercentage {
  return whole <= 0 ? null : Math.round((part / whole) * 100);
}

export function deriveProjectHealthStatus(
  issueCount: number,
  assessableItemCount: number,
): ProjectHealthStatus {
  if (issueCount > 0) return 'issues';
  return assessableItemCount > 0 ? 'clean' : 'not-applicable';
}

function knownStoryPosition(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

/**
 * Structural continuity checks only. These signals intentionally avoid prose
 * interpretation so the same local project data always produces the same
 * result, without persistence or a model request.
 */
export function deriveNarrativeContinuity(
  outlineBeats: Pick<OutlineBeat, 'id' | 'linkedWritingId' | 'linkedSceneId' | 'storyPosition'>[],
  seeds: Pick<Seed, 'id' | 'title' | 'status' | 'plantedAt' | 'linkedBeatId'>[],
  payoffs: Pick<Payoff, 'id' | 'seedId' | 'title' | 'paidAt' | 'linkedBeatId'>[],
  existingWritingIds: ReadonlySet<string>,
  existingSceneIds: ReadonlySet<string>,
): NarrativeContinuity {
  const signals: NarrativeContinuitySignal[] = [];
  const beatById = new Map(outlineBeats.map(beat => [beat.id, beat]));
  const payoffsBySeed = new Map<string, typeof payoffs>();

  for (const payoff of payoffs) {
    const group = payoffsBySeed.get(payoff.seedId) ?? [];
    group.push(payoff);
    payoffsBySeed.set(payoff.seedId, group);
  }

  for (const beat of outlineBeats) {
    const hasWriting = Boolean(
      beat.linkedWritingId && existingWritingIds.has(beat.linkedWritingId),
    );
    const hasScene = Boolean(
      beat.linkedSceneId && existingSceneIds.has(beat.linkedSceneId),
    );
    if (!hasWriting && !hasScene) {
      signals.push({
        id: `unlinked-beat:${beat.id}`,
        kind: 'unlinked-beat',
        beatId: beat.id,
      });
    }
  }

  for (const seed of seeds) {
    if (seed.status === 'cut') continue;
    const seedPayoffs = payoffsBySeed.get(seed.id) ?? [];
    const linkedBeatId = seed.linkedBeatId && beatById.has(seed.linkedBeatId)
      ? seed.linkedBeatId
      : undefined;

    if (seedPayoffs.length === 0) {
      signals.push({
        id: `unpaid-seed:${seed.id}`,
        kind: 'unpaid-seed',
        beatId: linkedBeatId,
        seedId: seed.id,
        seedTitle: seed.title,
      });
      continue;
    }

    const linkedSetupPosition = linkedBeatId
      ? beatById.get(linkedBeatId)?.storyPosition
      : undefined;
    const setupPosition = knownStoryPosition(seed.plantedAt)
      ? seed.plantedAt
      : linkedSetupPosition;
    if (!knownStoryPosition(setupPosition)) continue;

    for (const payoff of seedPayoffs) {
      const payoffBeatId = payoff.linkedBeatId && beatById.has(payoff.linkedBeatId)
        ? payoff.linkedBeatId
        : undefined;
      const linkedPayoffPosition = payoffBeatId
        ? beatById.get(payoffBeatId)?.storyPosition
        : undefined;
      const payoffPosition = knownStoryPosition(payoff.paidAt)
        ? payoff.paidAt
        : linkedPayoffPosition;
      if (!knownStoryPosition(payoffPosition) || payoffPosition >= setupPosition) continue;

      signals.push({
        id: `payoff-before-setup:${payoff.id}`,
        kind: 'payoff-before-setup',
        beatId: linkedBeatId ?? payoffBeatId,
        seedId: seed.id,
        seedTitle: seed.title,
        payoffId: payoff.id,
        payoffTitle: payoff.title,
        setupPosition,
        payoffPosition,
      });
    }
  }

  return {
    signals,
    counts: {
      'unlinked-beat': signals.filter(signal => signal.kind === 'unlinked-beat').length,
      'unpaid-seed': signals.filter(signal => signal.kind === 'unpaid-seed').length,
      'payoff-before-setup': signals.filter(signal => signal.kind === 'payoff-before-setup').length,
    },
  };
}

/**
 * One reactive read model for the project shell. Consumers should subscribe
 * with Dexie's liveQuery so all engine writes invalidate this view naturally.
 */
export async function loadProjectCockpit(projectId: string): Promise<ProjectCockpitData> {
  const [
    project,
    writings,
    snapshots,
    codexEntries,
    notes,
    scenes,
    dialogBlocks,
    outlines,
    outlineBeats,
    seeds,
    payoffs,
    characterArcs,
    arcBeats,
    relationships,
    annotations,
    boards,
    boardNodes,
    storyboards,
    imageCollections,
    inspirationImageIds,
    maps,
    mapPins,
    diaryEntries,
    videoSegments,
    entityLinks,
    citations,
  ] = await Promise.all([
    db.projects.get(projectId),
    db.writings.where('projectId').equals(projectId).toArray(),
    db.snapshots.where('projectId').equals(projectId).toArray(),
    db.codexEntries.where('projectId').equals(projectId).toArray(),
    db.notes.where('projectId').equals(projectId).toArray(),
    db.scenes.where('projectId').equals(projectId).toArray(),
    db.dialogBlocks.where('projectId').equals(projectId).toArray(),
    db.outlines.where('projectId').equals(projectId).toArray(),
    db.outlineBeats.where('projectId').equals(projectId).toArray(),
    db.seeds.where('projectId').equals(projectId).toArray(),
    db.payoffs.where('projectId').equals(projectId).toArray(),
    db.characterArcs.where('projectId').equals(projectId).toArray(),
    db.arcBeats.where('projectId').equals(projectId).toArray(),
    db.relationships.where('projectId').equals(projectId).toArray(),
    db.annotations.where('projectId').equals(projectId).toArray(),
    db.boards.where('projectId').equals(projectId).toArray(),
    db.boardNodes.where('projectId').equals(projectId).toArray(),
    db.storyboards.where('projectId').equals(projectId).toArray(),
    db.imageCollections.where('projectId').equals(projectId).toArray(),
    // Keys only. A gallery row carries `imageData`, `imageDataOriginal` and
    // `thumbnailData`; this read model never needs any of the three, and this
    // query re-runs on every autosave.
    db.inspirationImages.where('projectId').equals(projectId).primaryKeys(),
    db.worldMaps.where('projectId').equals(projectId).toArray(),
    db.mapPins.where('projectId').equals(projectId).toArray(),
    db.diaryEntries.where('projectId').equals(projectId).toArray(),
    db.videoSegments.where('projectId').equals(projectId).toArray(),
    db.entityLinks.where('projectId').equals(projectId).toArray(),
    db.citations.where('projectId').equals(projectId).toArray(),
  ]);

  const writingIds = new Set(writings.map(row => row.id));
  const sceneIds = new Set(scenes.map(row => row.id));
  const sceneBlocks = dialogBlocks.filter(row => sceneIds.has(row.sceneId));
  const outlineById = new Map(outlines.map(row => [row.id, row]));
  const seedPayoffIds = new Set(payoffs.map(row => row.seedId));
  const boardIds = new Set(boards.map(row => row.id));
  const storyboardIds = new Set(storyboards.map(row => row.id));
  const annotationIds = new Set(annotations.map(row => row.id));
  const collectionIds = new Set(imageCollections.map(row => row.id));
  const imageIds = new Set(inspirationImageIds as string[]);
  const mapIds = new Set(maps.map(row => row.id));

  // sceneCasts, annotationReferences, worldSnapshots and canonTiles carry no
  // projectId of their own. A row whose parent is gone therefore belongs to no
  // project at all, so it can only be found — and can only honestly be
  // reported — app-wide. The three health rows below say so, and their repair
  // deletes exactly the parentless rows. Every read here is index keys only:
  // one key per row, never the multi-MB canon/world payloads.
  const [
    projectWritingSnapshotIds,
    livingWritingSnapshotIds,
    boardEdges,
    storyboardConnectors,
    sceneCastSceneIds,
    allSceneIds,
    referenceAnnotationIds,
    allAnnotationIds,
    annotationReferences,
    worldSnapshotOwnerIds,
    canonTileWorldIds,
    renderedTileWorldIds,
    allWorldIds,
  ] = await Promise.all([
    // A writing snapshot carries a whole manuscript body. Counting the orphans
    // is a set difference over primary keys: every snapshot filed under this
    // project, minus every snapshot reachable from a writing that still exists.
    db.writingSnapshots.where('projectId').equals(projectId).primaryKeys(),
    writingIds.size
      ? db.writingSnapshots.where('writingId').anyOf([...writingIds]).primaryKeys()
      : [],
    boardIds.size ? db.boardEdges.where('boardId').anyOf([...boardIds]).toArray() : [],
    storyboardIds.size
      ? db.storyboardConnectors.where('storyboardId').anyOf([...storyboardIds]).toArray()
      : [],
    db.sceneCasts.orderBy('sceneId').keys(),
    db.scenes.toCollection().primaryKeys(),
    db.annotationReferences.orderBy('annotationId').keys(),
    db.annotations.toCollection().primaryKeys(),
    // Backlink counting needs this project's own reference rows.
    annotationIds.size
      ? db.annotationReferences.where('annotationId').anyOf([...annotationIds]).toArray()
      : [],
    db.worldSnapshots.toCollection().primaryKeys(),
    db.canonTiles.orderBy('worldId').keys(),
    db.renderedTiles.orderBy('worldId').keys(),
    db.generatedWorlds.toCollection().primaryKeys(),
  ]);
  const boardNodeIds = new Set(boardNodes.map(row => row.id));
  const boardEdgeIds = new Set(boardEdges.map(row => row.id));
  const panelIds = new Set(
    (await db.storyboardPanels.where('projectId').equals(projectId).primaryKeys()) as string[],
  );
  const existingSceneIds = new Set(allSceneIds as string[]);
  const existingAnnotationIds = new Set(allAnnotationIds as string[]);
  const existingWorldIds = new Set(allWorldIds as string[]);

  const livingWritingSnapshots = new Set(livingWritingSnapshotIds as string[]);
  const orphanWritingSnapshots = (projectWritingSnapshotIds as string[]).filter(
    id => !livingWritingSnapshots.has(id),
  );
  // A board relation may have many endpoints and may hang off another
  // relation, so "broken" means any endpoint whose target no longer exists.
  const orphanBoardEdges = boardEdges.filter(row =>
    row.sources.length === 0 ||
    row.targets.length === 0 ||
    [...row.sources, ...row.targets].some(endpoint =>
      endpoint.on === 'edge' ? !boardEdgeIds.has(endpoint.id) : !boardNodeIds.has(endpoint.id),
    ),
  );
  const orphanStoryboardConnectors = storyboardConnectors.filter(
    row => !panelIds.has(row.sourceId) || !panelIds.has(row.targetId),
  );
  const orphanSceneCasts = (sceneCastSceneIds as string[]).filter(
    id => !existingSceneIds.has(id),
  );
  const orphanAnnotationReferences = (referenceAnnotationIds as string[]).filter(
    id => !existingAnnotationIds.has(id),
  );
  const orphanWorldSnapshots = (worldSnapshotOwnerIds as string[]).filter(
    id => !existingWorldIds.has(id),
  );
  const orphanCanonTiles = (canonTileWorldIds as string[]).filter(id => !existingWorldIds.has(id));
  const orphanRenderedTiles = (renderedTileWorldIds as string[]).filter(
    id => !existingWorldIds.has(id),
  );
  const interruptedJobs = snapshots.filter(
    row => row.downloadState === 'downloading' || row.captureState === 'capturing',
  );
  // `collectionId` is indexed, so an image filed under a deleted album is
  // visible from the index alone. The cursor walks every gallery row in the
  // app because that index is not compound with `projectId`; testing the
  // cursor's primary key against this project's own keys restores the scope.
  const brokenGalleryCollections: string[] = [];
  await db.inspirationImages.orderBy('collectionId').eachKey((collectionId, cursor) => {
    const imageId = cursor.primaryKey as string;
    if (collectionId && imageIds.has(imageId) && !collectionIds.has(collectionId as string)) {
      brokenGalleryCollections.push(imageId);
    }
  });
  const brokenMapPins = mapPins.filter(row => !mapIds.has(row.mapId));
  const brokenSpineLinks = outlineBeats.filter(
    row =>
      (row.linkedWritingId && !writingIds.has(row.linkedWritingId)) ||
      (row.linkedSceneId && !sceneIds.has(row.linkedSceneId)),
  );
  const unlinkedSpine = outlineBeats.filter(row => !row.linkedWritingId && !row.linkedSceneId);
  const orphanedAnnotations = annotations.filter(row => row.isOrphaned);
  const unpaidSeeds = seeds.filter(row => row.status !== 'cut' && !seedPayoffIds.has(row.id));

  const health = [
    issue('orphan-writing-snapshots', 'error', 'integrity', 'Orphan writing history', 'Snapshots point to deleted writings.', orphanWritingSnapshots.length, true),
    issue('orphan-board-edges', 'error', 'integrity', 'Broken board relations', 'Relations point to missing nodes or relations.', orphanBoardEdges.length, true),
    issue('orphan-storyboard-connectors', 'error', 'integrity', 'Broken storyboard connectors', 'Connectors point to missing panels.', orphanStoryboardConnectors.length, true),
    issue('orphan-scene-casts', 'error', 'integrity', 'Orphan scene casts', 'Cast rows across the app point to deleted scenes.', orphanSceneCasts.length, true),
    issue('orphan-annotation-references', 'error', 'integrity', 'Orphan annotation references', 'References across the app point to deleted annotations.', orphanAnnotationReferences.length, true),
    issue('orphan-world-snapshots', 'warning', 'storage', 'Stale world caches', 'Regenerable caches across the app remain after their worlds were deleted.', orphanWorldSnapshots.length + orphanCanonTiles.length + orphanRenderedTiles.length, true),
    issue('interrupted-native-jobs', 'warning', 'storage', 'Interrupted capture jobs', 'Jobs were still marked active after the previous session ended.', interruptedJobs.length, true),
    issue('broken-gallery-collections', 'warning', 'integrity', 'Images in missing collections', 'Gallery images reference a deleted collection.', brokenGalleryCollections.length, true),
    issue('broken-map-pins', 'error', 'integrity', 'Pins on missing maps', 'Map pins reference a deleted map.', brokenMapPins.length, true),
    issue('broken-spine-links', 'error', 'workflow', 'Broken narrative links', 'Outline beats point to missing scenes or writings.', brokenSpineLinks.length, true),
    issue('unlinked-spine', 'info', 'workflow', 'Unlinked outline beats', 'Beats are not yet connected to a scene or writing.', unlinkedSpine.length),
    issue('orphaned-annotations', 'warning', 'workflow', 'Annotations need reanchoring', 'Text moved and the original selection could not be found.', orphanedAnnotations.length),
    issue('unpaid-seeds', 'info', 'workflow', 'Seeds without payoffs', 'Active story seeds do not have a payoff yet.', unpaidSeeds.length),
    issue(
      'engine-order',
      'warning',
      'configuration',
      'Engine preferences need repair',
      'Enabled engines and their saved order disagree.',
      project && (
        new Set(project.enabledEngines).size !== project.enabledEngines.length ||
        new Set(project.engineOrder).size !== project.engineOrder.length ||
        project.enabledEngines.some(id => !project.engineOrder.includes(id))
      ) ? 1 : 0,
      true,
    ),
  ].filter((row): row is ProjectHealthIssue => Boolean(row));
  const assessableItemCount = [
    writings,
    snapshots,
    codexEntries,
    notes,
    scenes,
    dialogBlocks,
    outlines,
    outlineBeats,
    seeds,
    payoffs,
    characterArcs,
    arcBeats,
    relationships,
    annotations,
    boards,
    boardNodes,
    storyboards,
    imageCollections,
    inspirationImageIds,
    maps,
    mapPins,
    diaryEntries,
    videoSegments,
    entityLinks,
    citations,
  ].reduce((sum, rows) => sum + rows.length, 0);
  const healthStatus = deriveProjectHealthStatus(health.length, assessableItemCount);

  const backlinkCounts = new Map<string, number>();
  const addBacklink = (engineId: string, entityId: string) => {
    const key = `${engineId}:${entityId}`;
    backlinkCounts.set(key, (backlinkCounts.get(key) ?? 0) + 1);
  };
  for (const relationship of relationships) {
    addBacklink(relationship.entityAType === 'codex-entry' ? 'codex' : relationship.entityAType, relationship.entityAId);
    addBacklink(relationship.entityBType === 'codex-entry' ? 'codex' : relationship.entityBType, relationship.entityBId);
  }
  for (const reference of annotationReferences) {
    if (annotationIds.has(reference.annotationId)) {
      addBacklink(reference.targetEngineId, reference.targetEntityId);
    }
  }
  for (const annotation of annotations) {
    addBacklink(annotation.sourceEngineId, annotation.sourceEntityId);
  }
  for (const node of boardNodes) {
    if (node.ref) addBacklink(node.ref.engineId, node.ref.entityId);
  }
  // `*linkedEntryIds` is a multi-entry index: one index entry per (image, entry)
  // pair, which is exactly what the backlink tally counts. Scoped by primary
  // key for the same reason as the album check above.
  await db.inspirationImages.orderBy('linkedEntryIds').eachKey((entryId, cursor) => {
    if (imageIds.has(cursor.primaryKey as string)) addBacklink('codex', entryId as string);
  });
  for (const link of entityLinks) {
    addBacklink(link.sourceEngineId, link.sourceEntityId);
    addBacklink(link.targetEngineId, link.targetEntityId);
  }
  for (const citation of citations) {
    if (citation.snapshotId) addBacklink('scrapper', citation.snapshotId);
    for (const writingId of citation.writingIds) addBacklink('writings', writingId);
  }

  const rawEntities: Array<Omit<HubEntity, 'key' | 'backlinkCount'>> = [
    ...codexEntries.map(row => ({ id: row.id, engineId: 'codex', entityType: row.type, title: row.title, subtitle: row.type, updatedAt: row.updatedAt })),
    ...writings.map(row => ({ id: row.id, engineId: 'writings', entityType: 'writing', title: row.title, subtitle: row.status, updatedAt: row.updatedAt })),
    ...scenes.map(row => ({ id: row.id, engineId: 'dialog-scene', entityType: 'scene', title: row.title, subtitle: row.setting, updatedAt: row.updatedAt })),
    ...outlineBeats.map(row => ({ id: row.id, engineId: 'outline', entityType: 'outline-beat', title: row.title, subtitle: row.status, updatedAt: row.updatedAt })),
    ...seeds.map(row => ({ id: row.id, engineId: 'seeds', entityType: 'seed', title: row.title, subtitle: row.status, updatedAt: row.updatedAt })),
    ...notes.map(row => ({ id: row.id, engineId: 'notes', entityType: 'note', title: row.text.split('\n')[0] || 'Note', subtitle: row.kind, updatedAt: row.updatedAt })),
    ...snapshots.map(row => ({ id: row.id, engineId: 'scrapper', entityType: 'snapshot', title: row.title || row.url, subtitle: row.source, updatedAt: row.preservedAt || row.createdAt })),
    ...mapPins.map(row => ({ id: row.id, engineId: 'maps', entityType: 'map-pin', title: row.name, subtitle: row.description })),
  ];
  const entities: HubEntity[] = rawEntities.map(row => {
    const key = `${row.engineId}:${row.id}`;
    return { ...row, key, backlinkCount: backlinkCounts.get(key) ?? 0 };
  }).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const writingById = new Map(writings.map(row => [row.id, row]));
  const sceneById = new Map(scenes.map(row => [row.id, row]));
  const continuity = deriveNarrativeContinuity(
    outlineBeats,
    seeds,
    payoffs,
    writingIds,
    sceneIds,
  );
  const continuityByBeat = new Map<string, NarrativeContinuitySignal[]>();
  for (const signal of continuity.signals) {
    if (!signal.beatId) continue;
    const group = continuityByBeat.get(signal.beatId) ?? [];
    group.push(signal);
    continuityByBeat.set(signal.beatId, group);
  }
  const spine = outlineBeats
    .map(beat => {
      const writing = beat.linkedWritingId ? writingById.get(beat.linkedWritingId) : undefined;
      const scene = beat.linkedSceneId ? sceneById.get(beat.linkedSceneId) : undefined;
      return {
        beatId: beat.id,
        outlineId: beat.outlineId,
        beatTitle: beat.title,
        outlineTitle: outlineById.get(beat.outlineId)?.title ?? 'Outline',
        position: beat.storyPosition,
        status: beat.status,
        writingId: writing?.id,
        writingTitle: writing?.title,
        sceneId: scene?.id,
        sceneTitle: scene?.title,
        seedCount: seeds.filter(seed => seed.linkedBeatId === beat.id).length,
        arcBeatCount: arcBeats.filter(arcBeat => arcBeat.linkedBeatId === beat.id).length,
        continuitySignals: continuityByBeat.get(beat.id) ?? [],
      };
    })
    .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));

  const usedCharacterIds = new Set(
    sceneBlocks.filter(block => block.characterId).map(block => block.characterId as string),
  );
  const characterEntries = codexEntries.filter(row => row.type === 'character');
  const unusedCharacterCount = characterEntries.filter(row => !usedCharacterIds.has(row.id)).length;
  const unmappedSpeakerCount = new Set(
    sceneBlocks
      .filter(block => block.type === 'dialog' && !block.characterId && block.characterName)
      .map(block => block.characterName.toLocaleLowerCase()),
  ).size;
  const totalWords = writings.reduce((sum, row) => sum + (row.wordCount || countWords(stripHtml(row.content))), 0);
  const linkedBeats = outlineBeats.filter(
    row =>
      (row.linkedWritingId && writingIds.has(row.linkedWritingId)) ||
      (row.linkedSceneId && sceneIds.has(row.linkedSceneId)),
  ).length;
  const linkedScenes = scenes.filter(scene => outlineBeats.some(beat => beat.linkedSceneId === scene.id)).length;
  const arcsWithBeats = new Set(arcBeats.map(row => row.arcId)).size;
  const citedSnapshotIds = new Set(
    citations.map(citation => citation.snapshotId).filter((id): id is string => Boolean(id)),
  );
  const linkedSnapshotIds = new Set(
    entityLinks.flatMap(link => {
      const ids: string[] = [];
      if (link.sourceEngineId === 'scrapper') ids.push(link.sourceEntityId);
      if (link.targetEngineId === 'scrapper') ids.push(link.targetEntityId);
      return ids;
    }),
  );
  const annotatedSnapshotIds = new Set(
    annotations
      .filter(annotation => annotation.sourceEngineId === 'scrapper')
      .map(annotation => annotation.sourceEntityId),
  );
  const researchLinked = snapshots.filter(snapshot =>
    citedSnapshotIds.has(snapshot.id) ||
    linkedSnapshotIds.has(snapshot.id) ||
    annotatedSnapshotIds.has(snapshot.id),
  ).length;

  const recent: RecentProjectItem[] = [
    ...writings.map(row => ({ id: row.id, engineId: 'writings', title: row.title, subtitle: row.status, updatedAt: row.updatedAt })),
    ...codexEntries.map(row => ({ id: row.id, engineId: 'codex', title: row.title, subtitle: row.type, updatedAt: row.updatedAt })),
    ...scenes.map(row => ({ id: row.id, engineId: 'dialog-scene', title: row.title, subtitle: 'scene', updatedAt: row.updatedAt })),
    ...notes.map(row => ({ id: row.id, engineId: 'notes', title: row.text.split('\n')[0] || 'Note', subtitle: row.kind, updatedAt: row.updatedAt })),
    ...snapshots.map(row => ({ id: row.id, engineId: 'scrapper', title: row.title || row.url, subtitle: row.source, updatedAt: row.preservedAt || row.createdAt })),
    ...diaryEntries.map(row => ({ id: row.id, engineId: 'diary', title: row.title || row.entryDate, subtitle: 'diary', updatedAt: row.updatedAt })),
  ].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);

  const assets: AssetInventoryItem[] = [
    // Label and status used to come from the row itself (`notes || tags[0]`
    // and the presence of `imageData`). No index carries either, and reading
    // them meant deserialising every base64 payload in the project on every
    // autosave; the inventory now names the rows the index can name.
    ...(inspirationImageIds as string[]).map(id => ({
      id: `gallery:${id}`,
      ownerId: id,
      engineId: 'gallery',
      label: t('projectCockpit.assets.galleryImage'),
      storage: 'indexeddb' as const,
      status: 'available' as const,
    })),
    ...maps.filter(map => map.backgroundImage).map(map => ({
      id: `maps:${map.id}`,
      ownerId: map.id,
      engineId: 'maps',
      label: map.title,
      storage: 'indexeddb' as const,
      status: 'available' as const,
    })),
    ...snapshots.flatMap(snapshot => {
      const rows: AssetInventoryItem[] = [];
      const managed = [
        snapshot.localMediaPath,
        snapshot.capturePdfPath,
        snapshot.captureImagePath,
        snapshot.captureHtmlPath,
        ...(snapshot.mediaItems?.map(item => item.relPath) ?? []),
      ].filter((path): path is string => Boolean(path));
      for (const path of managed) {
        rows.push({
          id: `scrapper:${snapshot.id}:${path}`,
          ownerId: snapshot.id,
          engineId: 'scrapper',
          label: snapshot.title || path,
          storage: 'managed-file',
          status: 'available',
          sizeBytes: snapshot.mediaSizeBytes,
          path,
        });
      }
      if (managed.length === 0) {
        rows.push({
          id: `scrapper:${snapshot.id}:remote`,
          ownerId: snapshot.id,
          engineId: 'scrapper',
          label: snapshot.title || snapshot.url,
          storage: 'remote',
          status:
            snapshot.downloadState === 'downloading' || snapshot.captureState === 'capturing'
              ? 'pending'
              : snapshot.downloadState === 'error' || snapshot.captureState === 'error'
                ? 'failed'
                : 'reference-only',
        });
      }
      return rows;
    }),
    ...videoSegments.filter(segment => segment.visualImageData).map(segment => ({
      id: `video-planner:${segment.id}`,
      ownerId: segment.id,
      engineId: 'video-planner',
      label: segment.title,
      storage: 'indexeddb' as const,
      status: 'available' as const,
    })),
  ];

  return {
    recent,
    health,
    healthStatus,
    entities,
    spine,
    continuity,
    spineOptions: {
      writings: writings.map(row => ({ id: row.id, title: row.title })),
      scenes: scenes.map(row => ({ id: row.id, title: row.title })),
    },
    intelligence: {
      totalWords,
      draftedDocuments: writings.filter(row => row.status !== 'idea').length,
      outlineCoverage: calculateCoverage(linkedBeats, outlineBeats.length),
      sceneCoverage: calculateCoverage(linkedScenes, scenes.length),
      seedPayoffRate: calculateCoverage(seeds.filter(seed => seedPayoffIds.has(seed.id)).length, seeds.filter(seed => seed.status !== 'cut').length),
      arcCoverage: calculateCoverage(arcsWithBeats, characterArcs.length),
      unusedCharacterCount,
      unmappedSpeakerCount,
      researchCoverage: calculateCoverage(researchLinked, snapshots.length),
    },
    assets,
    counts: {
      writings: writings.length,
      scenes: scenes.length,
      codex: codexEntries.length,
      notes: notes.length,
      research: snapshots.length,
      unresolved: health.reduce((sum, row) => sum + row.count, 0),
    },
  };
}

export async function repairMissingManagedAssets(
  projectId: string,
  availablePaths: string[],
): Promise<number> {
  const available = new Set(availablePaths);
  let repaired = 0;
  await db.snapshots.where('projectId').equals(projectId).modify(snapshot => {
    const removeMissing = (field: 'localMediaPath' | 'capturePdfPath' | 'captureImagePath' | 'captureHtmlPath') => {
      const value = snapshot[field];
      if (value && !available.has(value)) {
        delete snapshot[field];
        repaired++;
        return true;
      }
      return false;
    };
    const mediaMissing = removeMissing('localMediaPath');
    const captureMissing = [
      removeMissing('capturePdfPath'),
      removeMissing('captureImagePath'),
      removeMissing('captureHtmlPath'),
    ].some(Boolean);
    if (snapshot.mediaItems) {
      const retained = snapshot.mediaItems.filter(item => available.has(item.relPath));
      repaired += snapshot.mediaItems.length - retained.length;
      snapshot.mediaItems = retained.length ? retained : undefined;
    }
    if (mediaMissing) {
      snapshot.downloadState = 'error';
      snapshot.downloadError = 'The managed media file is missing. Download it again.';
    }
    if (captureMissing) {
      snapshot.captureState = 'error';
      snapshot.captureError = 'One or more archive files are missing. Capture the page again.';
    }
  });
  return repaired;
}

export async function updateNarrativeSpineLink(
  projectId: string,
  beatId: string,
  link: { writingId?: string; sceneId?: string },
): Promise<void> {
  const beat = await db.outlineBeats.get(beatId);
  if (!beat || beat.projectId !== projectId) throw new Error('Outline beat not found');
  if (link.writingId) {
    const writing = await db.writings.get(link.writingId);
    if (!writing || writing.projectId !== projectId) throw new Error('Writing does not belong to this project');
  }
  if (link.sceneId) {
    const scene = await db.scenes.get(link.sceneId);
    if (!scene || scene.projectId !== projectId) throw new Error('Scene does not belong to this project');
  }
  // Only the keys the caller actually sent. Writing both unconditionally meant
  // a select that changed the scene also rewrote the writing link from whatever
  // its own render happened to hold, silently undoing the other select.
  const changes: Partial<OutlineBeat> = { updatedAt: Date.now() };
  if ('writingId' in link) changes.linkedWritingId = link.writingId || undefined;
  if ('sceneId' in link) changes.linkedSceneId = link.sceneId || undefined;
  await db.outlineBeats.update(beatId, changes);
}

// ---------------------------------------------------------------------------
// Day two — what the writer needs to see before they have opened anything
// ---------------------------------------------------------------------------
//
// Everything below answers questions the dashboard could not: how big is this
// project, when did I last touch it, and what sentence was I in the middle of.

/** Progress for one project, as the dashboard card shows it. */
export interface ProjectProgress {
  /** Sum of the stored `wordCount` of every writing in the project. */
  totalWords: number;
  /** `updatedAt` of the most recently edited writing, or null when there is none. */
  lastWrittenAt: number | null;
  /** The most recently edited writing — where "continue" lands by default. */
  lastWritingId: string | null;
  /**
   * Every writing's current title, by id. Two jobs: it names a remembered
   * chapter with the title the writing has NOW (a rename must not leave a stale
   * label on the card), and its absence proves a remembered chapter was deleted,
   * so the card can fall back instead of offering a dead link.
   */
  writingTitles: Map<string, string>;
}

function emptyProgress(): ProjectProgress {
  return { totalWords: 0, lastWrittenAt: null, lastWritingId: null, writingTitles: new Map() };
}

/**
 * Word totals and last-edited stamps for EVERY project, in one pass.
 *
 * One query for the whole dashboard, not one per card: a grid of twenty
 * projects used to mean twenty round trips, each re-reading rows the one
 * before it had already walked. A cursor keeps peak memory at one chapter
 * rather than the whole hoard, and the sum reads the stored `wordCount`
 * field — recomputing it would mean stripping the HTML of every chapter you
 * own to draw a number on a card.
 */
export async function loadAllProjectProgress(): Promise<Map<string, ProjectProgress>> {
  const byProject = new Map<string, ProjectProgress>();
  await db.writings.toCollection().each(row => {
    let progress = byProject.get(row.projectId);
    if (!progress) {
      progress = emptyProgress();
      byProject.set(row.projectId, progress);
    }
    progress.totalWords += row.wordCount || 0;
    progress.writingTitles.set(row.id, row.title);
    if (progress.lastWrittenAt === null || row.updatedAt > progress.lastWrittenAt) {
      progress.lastWrittenAt = row.updatedAt;
      progress.lastWritingId = row.id;
    }
  });
  return byProject;
}

/**
 * Whole local calendar days between a timestamp and today.
 *
 * Calendar days, not 24-hour blocks: something saved at 23:50 was edited
 * "yesterday" at 00:10, not "0 days ago". Goes through the local-date helpers
 * so a timezone west of Greenwich cannot shift the day.
 */
export function localDaysSince(timestamp: number): number {
  return localDaysBetween(toLocalDateKey(new Date(timestamp)), toLocalDateKey());
}

// ---------------------------------------------------------------------------
// Resume memory — the route each project was last left on
// ---------------------------------------------------------------------------
//
// Per device and per install, never synced and never in a backup: this is a
// convenience ("put me back where I was"), not project data, and losing it
// costs the writer one click. localStorage is therefore the right store — but
// it throws outright in some contexts (private windows, blocked site data), so
// every access is guarded and a failure simply means the card offers the plain
// open it always did.

const RESUME_KEY_PREFIX = 'wh.resume.';

export interface ProjectResume {
  /** Engine tab the writer was on, e.g. `writings`. */
  engineId: string;
  /** The entity inside that engine, when they were inside one. */
  entityId?: string;
  /**
   * When this position was recorded, epoch ms.
   *
   * It is what separates "where I was" from "where I was a week ago": a chapter
   * whose `updatedAt` is newer than this stamp is the better answer, because
   * the writer has been working somewhere this route never heard about. A route
   * stored before routes carried a stamp cannot be weighed at all, and is
   * therefore ancient — `readProjectRoute` drops it.
   */
  savedAt: number;
}

function resumeKey(projectId: string): string {
  return `${RESUME_KEY_PREFIX}${projectId}`;
}

/**
 * Record where the writer is, so the dashboard can offer it back to them.
 *
 * Called from wherever the writer actually arrives — opening a chapter,
 * switching engine tab — and not only from the "Continue" button: a route that
 * only the button wrote could never point anywhere but the button's own last
 * click, which is how a card kept offering a chapter abandoned a week ago.
 */
export function rememberProjectRoute(
  projectId: string,
  route: Omit<ProjectResume, 'savedAt'>,
): void {
  if (!projectId || !route.engineId) return;
  const stamped: ProjectResume = { ...route, savedAt: Date.now() };
  try {
    window.localStorage.setItem(resumeKey(projectId), JSON.stringify(stamped));
  } catch {
    // Storage unavailable or full — the card falls back to the plain open.
  }
}

/** The remembered route for a project, or null when there is nothing usable. */
export function readProjectRoute(projectId: string): ProjectResume | null {
  if (!projectId) return null;
  try {
    const raw = window.localStorage.getItem(resumeKey(projectId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { engineId, entityId, savedAt } = parsed as Partial<ProjectResume>;
    if (typeof engineId !== 'string' || !engineId) return null;
    // Unstamped means written before routes were dated: there is no way to tell
    // whether the writer has moved on since, so it is treated as ancient and
    // the card falls back to the chapter that was actually edited last.
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null;
    return {
      engineId,
      entityId: typeof entityId === 'string' && entityId ? entityId : undefined,
      savedAt,
    };
  } catch {
    // Unreadable or corrupt — treat it as "nothing remembered".
    return null;
  }
}

/**
 * Record the engine tab the writer moved to, keeping whatever entity was
 * remembered inside that same engine.
 *
 * Arriving on a tab is recorded on every visit, including the one a "Continue"
 * click makes, so it must not overwrite the finer-grained position: landing on
 * Writings means "the writer is in Writings", not "the writer is in no
 * chapter". Opening one records the chapter itself.
 */
export function rememberProjectTab(projectId: string, engineId: string): void {
  const previous = readProjectRoute(projectId);
  const entityId = previous && previous.engineId === engineId ? previous.entityId : undefined;
  rememberProjectRoute(projectId, { engineId, entityId });
}

/** Drop a project's remembered route. Called when the project itself is deleted. */
export function forgetProjectRoute(projectId: string): void {
  if (!projectId) return;
  try {
    window.localStorage.removeItem(resumeKey(projectId));
  } catch {
    // Nothing to clean up if the store cannot be reached.
  }
}

// ---------------------------------------------------------------------------
// Codex appearances — where a character is actually on the page
// ---------------------------------------------------------------------------

/** One chapter a codex character is named in. */
export interface CodexAppearance {
  writingId: string;
  title: string;
  chapter?: number;
}

/**
 * The scans currently running, by project.
 *
 * Deliberately NOT a result cache: the entry is dropped the moment the scan
 * settles, so a writer who leaves the Codex, writes a chapter and comes back
 * gets an answer that includes it. What it does buy is that the same manuscript
 * is never scanned twice at once — which is exactly what StrictMode's
 * mount → cleanup → mount does to the effect that asks for it. A ref flag would
 * have swallowed the second run instead of serving it (tasks/lessons.md #19).
 */
const appearanceScansInFlight = new Map<string, Promise<Map<string, CodexAppearance[]>>>();

/**
 * Manuscript order — the chapter number first, then creation time, then the id
 * so the sort is total. Mirrors the proofreader and the publishing profile.
 */
function compareAppearanceOrder(
  left: { chapter?: number; createdAt: number; writingId: string },
  right: { chapter?: number; createdAt: number; writingId: string },
): number {
  const chapter =
    (left.chapter ?? Number.MAX_SAFE_INTEGER) - (right.chapter ?? Number.MAX_SAFE_INTEGER);
  if (chapter !== 0) return chapter;
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  return left.writingId.localeCompare(right.writingId);
}

/**
 * Which chapters each codex character appears in, keyed by codex entry id.
 *
 * The Codex could say who a character is related to and which dialogue scenes
 * she is cast in, but not the one thing a novelist actually asks — when was she
 * last on the page? The proofreader already answers that to find characters who
 * disappear; this is the same scan, kept for the codex.
 *
 * The cost model is the proofreader's, and it matters: ONE pass over the
 * manuscript, with the candidate names indexed by first token, so a chapter
 * costs `O(words)` map lookups however large the codex is — never a regex per
 * (chapter x character). Both tables are streamed with a cursor and projected
 * down immediately, so the two base64 avatar columns on a codex row and the
 * whole manuscript never sit in memory at once.
 *
 * Call it once per project (the codex list does, on demand), never per render
 * and never per entry.
 */
export function loadCodexAppearances(
  projectId: string,
): Promise<Map<string, CodexAppearance[]>> {
  const running = appearanceScansInFlight.get(projectId);
  if (running) return running;
  const scan = scanCodexAppearances(projectId).finally(() => {
    appearanceScansInFlight.delete(projectId);
  });
  appearanceScansInFlight.set(projectId, scan);
  return scan;
}


async function scanCodexAppearances(
  projectId: string,
): Promise<Map<string, CodexAppearance[]>> {
  const byEntry = new Map<string, CodexAppearance[]>();

  const codexRows: ProofreaderCodexRow[] = [];
  await db.codexEntries
    .where('projectId')
    .equals(projectId)
    .each(row => {
      codexRows.push({ id: row.id, type: row.type, title: row.title });
    });

  const candidates = buildAppearanceCandidates(codexRows);
  if (candidates.length === 0) return byEntry;

  // `findAppearances` wants the candidates grouped by their first token.
  const byFirstToken = indexNameCandidates(candidates);

  const scanned: Array<CodexAppearance & { createdAt: number; entryIds: Set<string> }> = [];
  await db.writings
    .where('projectId')
    .equals(projectId)
    .each(row => {
      const entryIds = findAppearances(stripHtml(row.content), byFirstToken);
      if (entryIds.size === 0) return;
      scanned.push({
        writingId: row.id,
        title: row.title,
        chapter: row.chapter,
        createdAt: row.createdAt,
        entryIds,
      });
    });
  scanned.sort(compareAppearanceOrder);

  for (const { writingId, title, chapter, entryIds } of scanned) {
    for (const entryId of entryIds) {
      const list = byEntry.get(entryId);
      if (list) list.push({ writingId, title, chapter });
      else byEntry.set(entryId, [{ writingId, title, chapter }]);
    }
  }
  return byEntry;
}
