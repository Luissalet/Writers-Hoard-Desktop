import { db } from './index';
import type {
  Project,
  CodexEntry,
  Timeline,
  TimelineEvent,
  WorldMap,
  MapPin,
  ImageCollection,
  InspirationImage,
  Writing,
} from '../types';
import {
  legacyLinkToSnapshot,
  type LegacyExternalLink,
} from '@/engines/scrapper/legacyLinks';
import type { BoardEndpoint } from '@/engines/board/types';

// ===== Projects =====

/**
 * Project rows are read by more than one component at a time.
 *
 * The sidebar and the project page each call `useProject(id)`, and each keeps
 * its OWN copy of the row. So a save made from the page — adding an engine, for
 * instance — refreshed the page's copy and left the sidebar's untouched: the new
 * engine did not appear in the list until you left the project and came back,
 * which remounted the sidebar and made it fetch again.
 *
 * The fix is not to lift the project into a store (every consumer would then
 * have to be rewritten) but to make the WRITE announce itself. Every project
 * mutation bumps a version; the hooks subscribe to it and re-read. One line at
 * each write site, and any future reader gets the same guarantee for free.
 */
let projectsVersion = 0;
const projectListeners = new Set<() => void>();

export function subscribeProjects(fn: () => void): () => void {
  projectListeners.add(fn);
  return () => {
    projectListeners.delete(fn);
  };
}

export function getProjectsVersion(): number {
  return projectsVersion;
}

/** Announce that a project row changed. Safe to call from anywhere. */
export function notifyProjectsChanged(): void {
  projectsVersion++;
  for (const fn of [...projectListeners]) fn();
}

export async function getAllProjects(): Promise<Project[]> {
  return db.projects.orderBy('updatedAt').reverse().toArray();
}

export async function getProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id);
}

export async function createProject(project: Project): Promise<string> {
  const key = await db.projects.add(project);
  notifyProjectsChanged();
  return key;
}

export async function updateProject(id: string, changes: Partial<Project>): Promise<void> {
  await db.projects.update(id, { ...changes, updatedAt: Date.now() });
  notifyProjectsChanged();
}

/**
 * Delete a project and EVERY row it owns, across all engine tables.
 *
 * Generic by design: any table with a `projectId` index is wiped
 * automatically, so engines added in the future are covered without touching
 * this function. Child tables that have no `projectId` index (they hang off a
 * parent: sceneCasts, storyboardConnectors, annotationReferences,
 * worldSnapshots) are resolved through their parents first.
 *
 * Previously this only covered the 13 original tables and silently orphaned
 * ~25 engine tables' rows — which then leaked into global search and
 * backlinks forever.
 */
export async function deleteProject(id: string): Promise<void> {
  // Dexie keeps the primary key out of `idxByName`, so a table keyed BY the
  // project (aiProjectSettings) needs the second test.
  const projectScoped = db.tables.filter(
    (t) => t.name !== 'projects' && ('projectId' in t.schema.idxByName || t.schema.primKey.name === 'projectId'),
  );

  await db.transaction('rw', db.tables, async () => {
    // --- children without a projectId index: resolve via parent ids ---
    const [sceneIds, storyboardIds, annotationIds, worldIds] = await Promise.all([
      db.scenes.where('projectId').equals(id).primaryKeys(),
      db.storyboards.where('projectId').equals(id).primaryKeys(),
      db.annotations.where('projectId').equals(id).primaryKeys(),
      db.generatedWorlds.where('projectId').equals(id).primaryKeys(),
    ]);

    if (sceneIds.length) await db.sceneCasts.where('sceneId').anyOf(sceneIds as string[]).delete();
    if (storyboardIds.length) {
      await db.storyboardConnectors.where('storyboardId').anyOf(storyboardIds as string[]).delete();
    }
    if (annotationIds.length) {
      await db.annotationReferences.where('annotationId').anyOf(annotationIds as string[]).delete();
    }
    if (worldIds.length) {
      await db.worldSnapshots.bulkDelete(worldIds as string[]);
    }

    // --- every project-scoped table, current and future ---
    for (const table of projectScoped) {
      await table.where('projectId').equals(id).delete();
    }

    await db.projects.delete(id);
  });
  notifyProjectsChanged();
}

// ===== Codex Entries =====
export async function getCodexEntries(projectId: string): Promise<CodexEntry[]> {
  return db.codexEntries.where('projectId').equals(projectId).toArray();
}

export async function getAllCodexEntries(): Promise<CodexEntry[]> {
  return db.codexEntries.toArray();
}

export async function getCodexEntry(id: string): Promise<CodexEntry | undefined> {
  return db.codexEntries.get(id);
}

export async function createCodexEntry(entry: CodexEntry): Promise<string> {
  return db.codexEntries.add(entry);
}

export async function updateCodexEntry(id: string, changes: Partial<CodexEntry>): Promise<void> {
  await db.codexEntries.update(id, { ...changes, updatedAt: Date.now() });
}

/**
 * Delete a codex entry and clean up everything that pointed at it.
 *
 * This used to be a bare `db.codexEntries.delete(id)`, which was the single
 * root cause of a family of "ghost character" bugs: character arcs and
 * relationships denormalise the character's NAME at creation time, so once the
 * entry was gone they kept rendering a character that no longer existed, kept
 * being indexed by global search, and kept travelling inside every backup ZIP.
 *
 * The policy per table is deliberate:
 *  • `relationships` — a relationship with a missing endpoint means nothing,
 *    so the rows go.
 *  • `sceneCasts` — likewise, a cast line for a deleted character is junk.
 *  • `characterArcs` / `dialogBlocks` — these hold the user's OWN writing.
 *    Only the foreign key is cleared, so the arc or the line survives as
 *    unassigned and can be re-linked.
 *  • `mapPins.linkedEntryId` / `inspirationImages.linkedEntryIds` — links are
 *    dropped, the pin and the image stay.
 */
export async function deleteCodexEntry(id: string): Promise<void> {
  const entry = await db.codexEntries.get(id);
  const projectId = entry?.projectId;

  await db.transaction(
    'rw',
    [
      db.codexEntries,
      db.relationships,
      db.characterArcs,
      db.sceneCasts,
      db.dialogBlocks,
      db.mapPins,
      db.inspirationImages,
    ],
    async () => {
      // Relationships: both endpoints are indexed.
      await db.relationships.where('entityAId').equals(id).delete();
      await db.relationships.where('entityBId').equals(id).delete();

      // Character arcs keep the user's authored beats — unassign, don't delete.
      const arcs = await db.characterArcs.where('characterId').equals(id).toArray();
      if (arcs.length > 0) {
        const now = Date.now();
        await db.characterArcs.bulkPut(
          arcs.map((arc) => ({ ...arc, characterId: undefined, updatedAt: now })),
        );
      }

      // Scene casts are pure join rows — drop them.
      const castIds = await db.sceneCasts.filter((c) => c.characterId === id).primaryKeys();
      if (castIds.length > 0) await db.sceneCasts.bulkDelete(castIds);

      // Dialogue lines are authored text — unassign the speaker only.
      const blockQuery = projectId
        ? db.dialogBlocks.where('projectId').equals(projectId)
        : db.dialogBlocks.toCollection();
      const blocks = (await blockQuery.toArray()).filter((b) => b.characterId === id);
      if (blocks.length > 0) {
        await db.dialogBlocks.bulkPut(blocks.map((b) => ({ ...b, characterId: undefined })));
      }

      // Map pins and gallery images keep their content, lose the link.
      const pinQuery = projectId
        ? db.mapPins.where('projectId').equals(projectId)
        : db.mapPins.toCollection();
      const pins = (await pinQuery.toArray()).filter((p) => p.linkedEntryId === id);
      if (pins.length > 0) {
        await db.mapPins.bulkPut(pins.map((p) => ({ ...p, linkedEntryId: undefined })));
      }

      const images = await db.inspirationImages.where('linkedEntryIds').equals(id).toArray();
      if (images.length > 0) {
        await db.inspirationImages.bulkPut(
          images.map((img) => ({
            ...img,
            linkedEntryIds: (img.linkedEntryIds ?? []).filter((x) => x !== id),
            linkedEntryId: img.linkedEntryId === id ? undefined : img.linkedEntryId,
          })),
        );
      }

      await db.codexEntries.delete(id);
    },
  );
}

export async function searchCodexEntries(projectId: string, query: string): Promise<CodexEntry[]> {
  const entries = await db.codexEntries.where('projectId').equals(projectId).toArray();
  const q = query.toLowerCase();
  return entries.filter(e => e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
}

// ===== Writings =====
export async function getWritings(projectId: string): Promise<Writing[]> {
  return db.writings.where('projectId').equals(projectId).toArray();
}

export async function getWriting(id: string): Promise<Writing | undefined> {
  return db.writings.get(id);
}

export async function createWriting(writing: Writing): Promise<string> {
  return db.writings.add(writing);
}

export async function updateWriting(id: string, changes: Partial<Writing>): Promise<void> {
  await db.writings.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteWriting(id: string): Promise<void> {
  await db.transaction('rw', [db.writings, db.writingSnapshots], async () => {
    await db.writings.delete(id);
    await db.writingSnapshots.where('writingId').equals(id).delete();
  });
}

// ===== Timelines =====
export async function getTimelines(projectId: string): Promise<Timeline[]> {
  return db.timelines.where('projectId').equals(projectId).toArray();
}

export async function createTimeline(timeline: Timeline): Promise<string> {
  return db.timelines.add(timeline);
}

export async function deleteTimeline(id: string): Promise<void> {
  await db.transaction('rw', [db.timelines, db.timelineEvents], async () => {
    await db.timelines.delete(id);
    await db.timelineEvents.where('timelineId').equals(id).delete();
  });
}

// ===== Timeline Events =====
export async function getTimelineEvents(timelineId: string): Promise<TimelineEvent[]> {
  return db.timelineEvents.where('timelineId').equals(timelineId).sortBy('order');
}

export async function createTimelineEvent(event: TimelineEvent): Promise<string> {
  return db.timelineEvents.add(event);
}

export async function updateTimelineEvent(id: string, changes: Partial<TimelineEvent>): Promise<void> {
  await db.timelineEvents.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteTimelineEvent(id: string): Promise<void> {
  await db.timelineEvents.delete(id);
}

// ===== World Maps =====
export async function getWorldMaps(projectId: string): Promise<WorldMap[]> {
  return db.worldMaps.where('projectId').equals(projectId).toArray();
}

export async function createWorldMap(map: WorldMap): Promise<string> {
  return db.worldMaps.add(map);
}

export async function updateWorldMap(id: string, changes: Partial<WorldMap>): Promise<void> {
  await db.worldMaps.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteWorldMap(id: string): Promise<void> {
  await db.transaction('rw', [db.worldMaps, db.mapPins], async () => {
    await db.worldMaps.delete(id);
    await db.mapPins.where('mapId').equals(id).delete();
  });
}

// ===== Map Pins =====
export async function getMapPins(mapId: string): Promise<MapPin[]> {
  return db.mapPins.where('mapId').equals(mapId).toArray();
}

export async function createMapPin(pin: MapPin): Promise<string> {
  return db.mapPins.add(pin);
}

export async function updateMapPin(id: string, changes: Partial<MapPin>): Promise<void> {
  await db.mapPins.update(id, changes);
}

export async function deleteMapPin(id: string): Promise<void> {
  await db.mapPins.delete(id);
}

// ===== Image Collections =====
export async function getImageCollections(projectId: string): Promise<ImageCollection[]> {
  return db.imageCollections.where('projectId').equals(projectId).toArray();
}

export async function createImageCollection(collection: ImageCollection): Promise<string> {
  return db.imageCollections.add(collection);
}

export async function deleteImageCollection(id: string): Promise<void> {
  await db.transaction('rw', [db.imageCollections, db.inspirationImages], async () => {
    await db.imageCollections.delete(id);
    await db.inspirationImages.where('collectionId').equals(id).delete();
  });
}

// ===== Inspiration Images =====
export async function getInspirationImages(projectId: string): Promise<InspirationImage[]> {
  return db.inspirationImages.where('projectId').equals(projectId).toArray();
}

export async function createInspirationImage(image: InspirationImage): Promise<string> {
  return db.inspirationImages.add(image);
}

export async function updateInspirationImage(id: string, changes: Partial<InspirationImage>): Promise<void> {
  await db.inspirationImages.update(id, changes);
}

export async function deleteInspirationImage(id: string): Promise<void> {
  await db.inspirationImages.delete(id);
}

// ===== Settings =====
export async function getSetting(key: string): Promise<string | undefined> {
  const setting = await db.settings.where('key').equals(key).first();
  return setting?.value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const existing = await db.settings.where('key').equals(key).first();
  if (existing) {
    await db.settings.update(existing.id, { value });
  } else {
    await db.settings.add({ id: `set_${key}`, key, value });
  }
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const settings = await db.settings.toArray();
  const result: Record<string, string> = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }
  return result;
}

// ===== Export / Import =====
export async function exportProjectData(projectId: string) {
  const [project, entries, writings, timelines, events, boards, nodes, edges, layers, views, maps, pins, collections, images] = await Promise.all([
    getProject(projectId),
    getCodexEntries(projectId),
    getWritings(projectId),
    getTimelines(projectId),
    db.timelineEvents.where('projectId').equals(projectId).toArray(),
    db.boards.where('projectId').equals(projectId).toArray(),
    db.boardNodes.where('projectId').equals(projectId).toArray(),
    db.boardEdges.where('projectId').equals(projectId).toArray(),
    db.boardLayers.where('projectId').equals(projectId).toArray(),
    db.boardViews.where('projectId').equals(projectId).toArray(),
    getWorldMaps(projectId),
    db.mapPins.where('projectId').equals(projectId).toArray(),
    getImageCollections(projectId),
    getInspirationImages(projectId),
  ]);

  return {
    project,
    codexEntries: entries,
    writings,
    timelines,
    timelineEvents: events,
    boards,
    boardNodes: nodes,
    boardEdges: edges,
    boardLayers: layers,
    boardViews: views,
    worldMaps: maps,
    mapPins: pins,
    imageCollections: collections,
    inspirationImages: images,
    exportedAt: Date.now(),
  };
}

/**
 * Legacy JSON import. `externalLinks` no longer exists as a table, but old
 * export files still carry it — those rows are converted into link-only
 * Scrapper snapshots on the way in (see engines/scrapper/legacyLinks.ts).
 */
export async function importProjectData(
  data: Awaited<ReturnType<typeof exportProjectData>> & { externalLinks?: LegacyExternalLink[] },
): Promise<string> {
  const idMap = new Map<string, string>();
  const remap = (oldId: string, prefix: string): string => {
    if (!idMap.has(oldId)) {
      idMap.set(oldId, `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    }
    return idMap.get(oldId)!;
  };

  const newProjectId = remap(data.project!.id, 'proj');

  await db.transaction('rw', [
    db.projects, db.codexEntries, db.writings, db.timelines, db.timelineEvents,
    db.boards, db.boardNodes, db.boardEdges, db.boardLayers, db.boardViews,
    db.worldMaps, db.mapPins,
    db.imageCollections, db.inspirationImages, db.snapshots,
  ], async () => {
    // Project
    await db.projects.add({
      ...data.project!,
      id: newProjectId,
      title: `${data.project!.title} (Imported)`,
      updatedAt: Date.now(),
    });

    // Codex entries
    for (const e of data.codexEntries || []) {
      await db.codexEntries.add({ ...e, id: remap(e.id, 'codex'), projectId: newProjectId });
    }

    // Writings
    for (const w of data.writings || []) {
      await db.writings.add({ ...w, id: remap(w.id, 'wr'), projectId: newProjectId });
    }

    // Timelines
    for (const t of data.timelines || []) {
      await db.timelines.add({ ...t, id: remap(t.id, 'tl'), projectId: newProjectId });
    }

    // Timeline events
    for (const ev of data.timelineEvents || []) {
      await db.timelineEvents.add({
        ...ev,
        id: remap(ev.id, 'evt'),
        projectId: newProjectId,
        timelineId: remap(ev.timelineId, 'tl'),
      });
    }

    // Boards
    for (const b of data.boards || []) {
      await db.boards.add({ ...b, id: remap(b.id, 'board'), projectId: newProjectId });
    }

    for (const layer of data.boardLayers || []) {
      await db.boardLayers.add({
        ...layer,
        id: remap(layer.id, 'blayer'),
        projectId: newProjectId,
        boardId: remap(layer.boardId, 'board'),
      });
    }

    for (const n of data.boardNodes || []) {
      await db.boardNodes.add({
        ...n,
        id: remap(n.id, 'bnode'),
        projectId: newProjectId,
        boardId: remap(n.boardId, 'board'),
        layerId: n.layerId ? remap(n.layerId, 'blayer') : undefined,
      });
    }

    // Relations carry endpoint lists, and an endpoint may be another
    // relation — so both id spaces have to be remapped, not just the two
    // denormalised index fields.
    const remapEndpoint = (endpoint: BoardEndpoint): BoardEndpoint => ({
      on: endpoint.on,
      id: remap(endpoint.id, endpoint.on === 'node' ? 'bnode' : 'bedge'),
    });
    for (const e of data.boardEdges || []) {
      const sources = (e.sources || []).map(remapEndpoint);
      const targets = (e.targets || []).map(remapEndpoint);
      await db.boardEdges.add({
        ...e,
        id: remap(e.id, 'bedge'),
        projectId: newProjectId,
        boardId: remap(e.boardId, 'board'),
        sources,
        targets,
        sourceId: sources[0]?.id ?? '',
        targetId: targets[0]?.id ?? '',
        layerId: e.layerId ? remap(e.layerId, 'blayer') : undefined,
      });
    }

    for (const view of data.boardViews || []) {
      await db.boardViews.add({
        ...view,
        id: remap(view.id, 'bview'),
        projectId: newProjectId,
        boardId: remap(view.boardId, 'board'),
        layerIds: (view.layerIds || []).map((id) => remap(id, 'blayer')),
        positions: view.positions
          ? Object.fromEntries(
              Object.entries(view.positions).map(([id, position]) => [remap(id, 'bnode'), position]),
            )
          : undefined,
      });
    }

    // World maps
    for (const m of data.worldMaps || []) {
      await db.worldMaps.add({ ...m, id: remap(m.id, 'map'), projectId: newProjectId });
    }

    // Map pins
    for (const p of data.mapPins || []) {
      await db.mapPins.add({
        ...p,
        id: remap(p.id, 'pin'),
        projectId: newProjectId,
        mapId: remap(p.mapId, 'map'),
      });
    }

    // Image collections
    for (const c of data.imageCollections || []) {
      await db.imageCollections.add({ ...c, id: remap(c.id, 'col'), projectId: newProjectId });
    }

    // Inspiration images
    for (const img of data.inspirationImages || []) {
      // Migrate linkedEntryId -> linkedEntryIds if needed
      const linkedEntryIds = img.linkedEntryIds
        ? img.linkedEntryIds.map((eid: string) => remap(eid, 'codex'))
        : img.linkedEntryId
          ? [remap(img.linkedEntryId, 'codex')]
          : [];
      await db.inspirationImages.add({
        ...img,
        id: remap(img.id, 'img'),
        projectId: newProjectId,
        collectionId: img.collectionId ? remap(img.collectionId, 'col') : undefined,
        linkedEntryIds,
      });
    }

    // External links (retired engine) → link-only Scrapper snapshots
    for (const l of data.externalLinks || []) {
      const snap = legacyLinkToSnapshot(l);
      await db.snapshots.add({ ...snap, id: remap(l.id, 'snap'), projectId: newProjectId });
    }
  });

  return newProjectId;
}

// ===== Full Database Export / Import (all projects) =====
export async function exportFullDatabase() {
  const [projects, codexEntries, writings, timelines, timelineEvents, boards, boardNodes, boardEdges, boardLayers, boardViews, worldMaps, mapPins, imageCollections, inspirationImages, tags, settings] = await Promise.all([
    db.projects.toArray(),
    db.codexEntries.toArray(),
    db.writings.toArray(),
    db.timelines.toArray(),
    db.timelineEvents.toArray(),
    db.boards.toArray(),
    db.boardNodes.toArray(),
    db.boardEdges.toArray(),
    db.boardLayers.toArray(),
    db.boardViews.toArray(),
    db.worldMaps.toArray(),
    db.mapPins.toArray(),
    db.imageCollections.toArray(),
    db.inspirationImages.toArray(),
    db.tags.toArray(),
    db.settings.toArray(),
  ]);

  return {
    version: 1,
    fullExport: true,
    projects,
    codexEntries,
    writings,
    timelines,
    timelineEvents,
    boards,
    boardNodes,
    boardEdges,
    boardLayers,
    boardViews,
    worldMaps,
    mapPins,
    imageCollections,
    inspirationImages,
    tags,
    settings,
    exportedAt: Date.now(),
  };
}

/** As `importProjectData`: legacy `externalLinks` arrive as snapshots. */
export async function importFullDatabase(
  data: Awaited<ReturnType<typeof exportFullDatabase>> & { externalLinks?: LegacyExternalLink[] },
): Promise<void> {
  // Clear ALL existing data (every table, not just the legacy 15 — otherwise
  // engine-table rows from the previous database survive the restore as
  // orphans), then import everything the legacy JSON contains with original
  // IDs.
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));

    // Import all data with original IDs (preserving references)
    if (data.projects?.length) await db.projects.bulkAdd(data.projects);
    if (data.codexEntries?.length) await db.codexEntries.bulkAdd(data.codexEntries);
    if (data.writings?.length) await db.writings.bulkAdd(data.writings);
    if (data.timelines?.length) await db.timelines.bulkAdd(data.timelines);
    if (data.timelineEvents?.length) await db.timelineEvents.bulkAdd(data.timelineEvents);
    if (data.boards?.length) await db.boards.bulkAdd(data.boards);
    if (data.boardNodes?.length) await db.boardNodes.bulkAdd(data.boardNodes);
    if (data.boardEdges?.length) await db.boardEdges.bulkAdd(data.boardEdges);
    if (data.boardLayers?.length) await db.boardLayers.bulkAdd(data.boardLayers);
    if (data.boardViews?.length) await db.boardViews.bulkAdd(data.boardViews);
    if (data.worldMaps?.length) await db.worldMaps.bulkAdd(data.worldMaps);
    if (data.mapPins?.length) await db.mapPins.bulkAdd(data.mapPins);
    if (data.imageCollections?.length) await db.imageCollections.bulkAdd(data.imageCollections);
    if (data.inspirationImages?.length) await db.inspirationImages.bulkAdd(data.inspirationImages);
    if (data.externalLinks?.length) {
      await db.snapshots.bulkPut(data.externalLinks.map(legacyLinkToSnapshot));
    }
    if (data.tags?.length) await db.tags.bulkAdd(data.tags);
    if (data.settings?.length) await db.settings.bulkAdd(data.settings);
  });
}
