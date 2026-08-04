import { db } from '@/db';
import { countWords, stripHtml } from '@/utils/text';

export type HealthSeverity = 'error' | 'warning' | 'info';

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
}

export interface StoryIntelligence {
  totalWords: number;
  draftedDocuments: number;
  outlineCoverage: number;
  sceneCoverage: number;
  seedPayoffRate: number;
  arcCoverage: number;
  unusedCharacterCount: number;
  unmappedSpeakerCount: number;
  researchCoverage: number;
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
  entities: HubEntity[];
  spine: NarrativeSpineRow[];
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

function ratio(part: number, whole: number): number {
  return whole === 0 ? 100 : Math.round((part / whole) * 100);
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
    sceneCasts,
    outlines,
    outlineBeats,
    seeds,
    payoffs,
    characterArcs,
    arcBeats,
    relationships,
    annotations,
    annotationReferences,
    boards,
    boardNodes,
    storyboards,
    imageCollections,
    inspirationImages,
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
    db.sceneCasts.toArray(),
    db.outlines.where('projectId').equals(projectId).toArray(),
    db.outlineBeats.where('projectId').equals(projectId).toArray(),
    db.seeds.where('projectId').equals(projectId).toArray(),
    db.payoffs.where('projectId').equals(projectId).toArray(),
    db.characterArcs.where('projectId').equals(projectId).toArray(),
    db.arcBeats.where('projectId').equals(projectId).toArray(),
    db.relationships.where('projectId').equals(projectId).toArray(),
    db.annotations.where('projectId').equals(projectId).toArray(),
    db.annotationReferences.toArray(),
    db.boards.where('projectId').equals(projectId).toArray(),
    db.boardNodes.where('projectId').equals(projectId).toArray(),
    db.storyboards.where('projectId').equals(projectId).toArray(),
    db.imageCollections.where('projectId').equals(projectId).toArray(),
    db.inspirationImages.where('projectId').equals(projectId).toArray(),
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
  const mapIds = new Set(maps.map(row => row.id));

  const [
    writingSnapshots,
    boardEdges,
    storyboardConnectors,
    worldSnapshots,
    allSceneIds,
    allAnnotationIds,
    allWorldIds,
  ] = await Promise.all([
    db.writingSnapshots.where('projectId').equals(projectId).toArray(),
    boardIds.size ? db.boardEdges.where('boardId').anyOf([...boardIds]).toArray() : [],
    storyboardIds.size
      ? db.storyboardConnectors.where('storyboardId').anyOf([...storyboardIds]).toArray()
      : [],
    db.worldSnapshots.toArray(),
    db.scenes.toCollection().primaryKeys(),
    db.annotations.toCollection().primaryKeys(),
    db.generatedWorlds.toCollection().primaryKeys(),
  ]);
  const boardNodeIds = new Set(boardNodes.map(row => row.id));
  const boardEdgeIds = new Set(boardEdges.map(row => row.id));
  const panelIds = new Set(
    (await db.storyboardPanels.where('projectId').equals(projectId).toArray()).map(row => row.id),
  );
  const existingSceneIds = new Set(allSceneIds);
  const existingAnnotationIds = new Set(allAnnotationIds);
  const existingWorldIds = new Set(allWorldIds);

  const orphanWritingSnapshots = writingSnapshots.filter(row => !writingIds.has(row.writingId));
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
  const orphanSceneCasts = sceneCasts.filter(row => !existingSceneIds.has(row.sceneId));
  const orphanAnnotationReferences = annotationReferences.filter(
    row => !existingAnnotationIds.has(row.annotationId),
  );
  const orphanWorldSnapshots = worldSnapshots.filter(row => !existingWorldIds.has(row.worldId));
  const interruptedJobs = snapshots.filter(
    row => row.downloadState === 'downloading' || row.captureState === 'capturing',
  );
  const brokenGalleryCollections = inspirationImages.filter(
    row => row.collectionId && !collectionIds.has(row.collectionId),
  );
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
    issue('orphan-scene-casts', 'error', 'integrity', 'Orphan scene casts', 'Cast rows point to deleted scenes.', orphanSceneCasts.length, true),
    issue('orphan-annotation-references', 'error', 'integrity', 'Orphan annotation references', 'References point to deleted annotations.', orphanAnnotationReferences.length, true),
    issue('orphan-world-snapshots', 'warning', 'storage', 'Stale world caches', 'Regenerable caches remain after their worlds were deleted.', orphanWorldSnapshots.length, true),
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
  for (const image of inspirationImages) {
    for (const entryId of image.linkedEntryIds ?? []) addBacklink('codex', entryId);
  }
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
  const spine = outlineBeats
    .map(beat => {
      const writing = beat.linkedWritingId ? writingById.get(beat.linkedWritingId) : undefined;
      const scene = beat.linkedSceneId ? sceneById.get(beat.linkedSceneId) : undefined;
      return {
        beatId: beat.id,
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
  const linkedBeats = outlineBeats.filter(row => row.linkedWritingId || row.linkedSceneId).length;
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
  const researchLinked = snapshots.filter(snapshot =>
    citedSnapshotIds.has(snapshot.id) ||
    linkedSnapshotIds.has(snapshot.id) ||
    annotations.some(annotation =>
      annotation.sourceEngineId === 'scrapper' && annotation.sourceEntityId === snapshot.id,
    ),
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
    ...inspirationImages.map(image => ({
      id: `gallery:${image.id}`,
      ownerId: image.id,
      engineId: 'gallery',
      label: image.notes || image.tags[0] || 'Gallery image',
      storage: 'indexeddb' as const,
      status: image.imageData ? 'available' as const : 'failed' as const,
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
    entities,
    spine,
    spineOptions: {
      writings: writings.map(row => ({ id: row.id, title: row.title })),
      scenes: scenes.map(row => ({ id: row.id, title: row.title })),
    },
    intelligence: {
      totalWords,
      draftedDocuments: writings.filter(row => row.status !== 'idea').length,
      outlineCoverage: ratio(linkedBeats, outlineBeats.length),
      sceneCoverage: ratio(linkedScenes, scenes.length),
      seedPayoffRate: ratio(seeds.filter(seed => seedPayoffIds.has(seed.id)).length, seeds.filter(seed => seed.status !== 'cut').length),
      arcCoverage: ratio(arcsWithBeats, characterArcs.length),
      unusedCharacterCount,
      unmappedSpeakerCount,
      researchCoverage: ratio(researchLinked, snapshots.length),
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
  await db.outlineBeats.update(beatId, {
    linkedWritingId: link.writingId || undefined,
    linkedSceneId: link.sceneId || undefined,
    updatedAt: Date.now(),
  });
}

export async function repairProjectHealthIssue(projectId: string, issueId: string): Promise<void> {
  switch (issueId) {
    case 'orphan-writing-snapshots': {
      const writingIds = new Set(await db.writings.where('projectId').equals(projectId).primaryKeys());
      const rows = await db.writingSnapshots.where('projectId').equals(projectId).toArray();
      await db.writingSnapshots.bulkDelete(rows.filter(row => !writingIds.has(row.writingId)).map(row => row.id));
      break;
    }
    case 'orphan-board-edges': {
      const nodes = new Set(await db.boardNodes.where('projectId').equals(projectId).primaryKeys());
      const rows = await db.boardEdges.where('projectId').equals(projectId).toArray();
      const edgeIds = new Set(rows.map(row => row.id));
      await db.boardEdges.bulkDelete(
        rows
          .filter(
            row =>
              row.sources.length === 0 ||
              row.targets.length === 0 ||
              [...row.sources, ...row.targets].some(endpoint =>
                endpoint.on === 'edge' ? !edgeIds.has(endpoint.id) : !nodes.has(endpoint.id),
              ),
          )
          .map(row => row.id),
      );
      break;
    }
    case 'orphan-storyboard-connectors': {
      const boards = await db.storyboards.where('projectId').equals(projectId).primaryKeys();
      const panels = new Set(await db.storyboardPanels.where('projectId').equals(projectId).primaryKeys());
      const rows = boards.length ? await db.storyboardConnectors.where('storyboardId').anyOf(boards).toArray() : [];
      await db.storyboardConnectors.bulkDelete(rows.filter(row => !panels.has(row.sourceId) || !panels.has(row.targetId)).map(row => row.id));
      break;
    }
    case 'orphan-scene-casts': {
      const scenes = new Set(await db.scenes.toCollection().primaryKeys());
      const rows = await db.sceneCasts.toArray();
      await db.sceneCasts.bulkDelete(rows.filter(row => !scenes.has(row.sceneId)).map(row => row.id));
      break;
    }
    case 'orphan-annotation-references': {
      const annotations = new Set(await db.annotations.toCollection().primaryKeys());
      const rows = await db.annotationReferences.toArray();
      await db.annotationReferences.bulkDelete(rows.filter(row => !annotations.has(row.annotationId)).map(row => row.id));
      break;
    }
    case 'orphan-world-snapshots': {
      const worlds = new Set(await db.generatedWorlds.toCollection().primaryKeys());
      const rows = await db.worldSnapshots.toArray();
      await db.worldSnapshots.bulkDelete(rows.filter(row => !worlds.has(row.worldId)).map(row => row.worldId));
      break;
    }
    case 'interrupted-native-jobs': {
      await db.snapshots.where('projectId').equals(projectId).modify(snapshot => {
        if (snapshot.downloadState === 'downloading') {
          snapshot.downloadState = 'error';
          snapshot.downloadError = 'The download was interrupted. Retry it from the snapshot.';
        }
        if (snapshot.captureState === 'capturing') {
          snapshot.captureState = 'error';
          snapshot.captureError = 'The capture was interrupted. Retry it from the snapshot.';
        }
      });
      break;
    }
    case 'broken-gallery-collections': {
      const collections = new Set(await db.imageCollections.where('projectId').equals(projectId).primaryKeys());
      await db.inspirationImages.where('projectId').equals(projectId).modify(image => {
        if (image.collectionId && !collections.has(image.collectionId)) delete image.collectionId;
      });
      break;
    }
    case 'broken-map-pins': {
      const maps = new Set(await db.worldMaps.where('projectId').equals(projectId).primaryKeys());
      const pins = await db.mapPins.where('projectId').equals(projectId).toArray();
      await db.mapPins.bulkDelete(pins.filter(pin => !maps.has(pin.mapId)).map(pin => pin.id));
      break;
    }
    case 'broken-spine-links': {
      const writings = new Set(await db.writings.where('projectId').equals(projectId).primaryKeys());
      const scenes = new Set(await db.scenes.where('projectId').equals(projectId).primaryKeys());
      await db.outlineBeats.where('projectId').equals(projectId).modify(beat => {
        if (beat.linkedWritingId && !writings.has(beat.linkedWritingId)) delete beat.linkedWritingId;
        if (beat.linkedSceneId && !scenes.has(beat.linkedSceneId)) delete beat.linkedSceneId;
      });
      break;
    }
    case 'engine-order': {
      const project = await db.projects.get(projectId);
      if (!project) return;
      const enabled = [...new Set(project.enabledEngines)];
      const enabledSet = new Set(enabled);
      const ordered = [...new Set(project.engineOrder)].filter(id => enabledSet.has(id));
      await db.projects.update(projectId, {
        enabledEngines: enabled,
        engineOrder: [...ordered, ...enabled.filter(id => !ordered.includes(id))],
        updatedAt: Date.now(),
      });
      break;
    }
  }
}
