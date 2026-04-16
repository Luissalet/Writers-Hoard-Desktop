import { db } from './index';
import type {
  Project,
  CodexEntry,
  Timeline,
  TimelineEvent,
  YarnBoard,
  YarnNode,
  YarnEdge,
  WorldMap,
  MapPin,
  ImageCollection,
  InspirationImage,
  ExternalLink,
  Writing,
} from '../types';

// ===== Projects =====
export async function getAllProjects(): Promise<Project[]> {
  return db.projects.orderBy('updatedAt').reverse().toArray();
}

export async function getProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id);
}

export async function createProject(project: Project): Promise<string> {
  return db.projects.add(project);
}

export async function updateProject(id: string, changes: Partial<Project>): Promise<void> {
  await db.projects.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteProject(id: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.codexEntries, db.writings, db.timelines, db.timelineEvents, db.yarnBoards, db.yarnNodes, db.yarnEdges, db.worldMaps, db.mapPins, db.imageCollections, db.inspirationImages, db.externalLinks], async () => {
    await db.projects.delete(id);
    await db.codexEntries.where('projectId').equals(id).delete();
    await db.writings.where('projectId').equals(id).delete();
    await db.timelines.where('projectId').equals(id).delete();
    await db.timelineEvents.where('projectId').equals(id).delete();
    await db.yarnBoards.where('projectId').equals(id).delete();
    await db.yarnNodes.where('projectId').equals(id).delete();
    await db.worldMaps.where('projectId').equals(id).delete();
    await db.mapPins.where('projectId').equals(id).delete();
    await db.imageCollections.where('projectId').equals(id).delete();
    await db.inspirationImages.where('projectId').equals(id).delete();
    await db.externalLinks.where('projectId').equals(id).delete();
  });
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

export async function deleteCodexEntry(id: string): Promise<void> {
  await db.codexEntries.delete(id);
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
  await db.writings.delete(id);
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

// ===== Yarn Boards =====
export async function getYarnBoards(projectId: string): Promise<YarnBoard[]> {
  return db.yarnBoards.where('projectId').equals(projectId).toArray();
}

export async function createYarnBoard(board: YarnBoard): Promise<string> {
  return db.yarnBoards.add(board);
}

export async function deleteYarnBoard(id: string): Promise<void> {
  await db.transaction('rw', [db.yarnBoards, db.yarnNodes, db.yarnEdges], async () => {
    await db.yarnBoards.delete(id);
    await db.yarnNodes.where('boardId').equals(id).delete();
    await db.yarnEdges.where('boardId').equals(id).delete();
  });
}

// ===== Yarn Nodes & Edges =====
export async function getYarnNodes(boardId: string): Promise<YarnNode[]> {
  return db.yarnNodes.where('boardId').equals(boardId).toArray();
}

export async function createYarnNode(node: YarnNode): Promise<string> {
  return db.yarnNodes.add(node);
}

export async function updateYarnNode(id: string, changes: Partial<YarnNode>): Promise<void> {
  await db.yarnNodes.update(id, changes);
}

export async function deleteYarnNode(id: string): Promise<void> {
  await db.yarnNodes.delete(id);
}

export async function getYarnEdges(boardId: string): Promise<YarnEdge[]> {
  return db.yarnEdges.where('boardId').equals(boardId).toArray();
}

export async function createYarnEdge(edge: YarnEdge): Promise<string> {
  return db.yarnEdges.add(edge);
}

export async function updateYarnEdge(id: string, changes: Partial<YarnEdge>): Promise<void> {
  await db.yarnEdges.update(id, changes);
}

export async function deleteYarnEdge(id: string): Promise<void> {
  await db.yarnEdges.delete(id);
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

// ===== External Links =====
export async function getExternalLinks(projectId: string): Promise<ExternalLink[]> {
  return db.externalLinks.where('projectId').equals(projectId).toArray();
}

export async function createExternalLink(link: ExternalLink): Promise<string> {
  return db.externalLinks.add(link);
}

export async function updateExternalLink(id: string, changes: Partial<ExternalLink>): Promise<void> {
  await db.externalLinks.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteExternalLink(id: string): Promise<void> {
  await db.externalLinks.delete(id);
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
  const [project, entries, writings, timelines, events, boards, nodes, edges, maps, pins, collections, images, links] = await Promise.all([
    getProject(projectId),
    getCodexEntries(projectId),
    getWritings(projectId),
    getTimelines(projectId),
    db.timelineEvents.where('projectId').equals(projectId).toArray(),
    getYarnBoards(projectId),
    db.yarnNodes.where('projectId').equals(projectId).toArray(),
    db.yarnEdges.toArray(), // Filter client-side
    getWorldMaps(projectId),
    db.mapPins.where('projectId').equals(projectId).toArray(),
    getImageCollections(projectId),
    getInspirationImages(projectId),
    getExternalLinks(projectId),
  ]);

  const boardIds = new Set(boards.map(b => b.id));
  const filteredEdges = edges.filter(e => boardIds.has(e.boardId));

  return {
    project,
    codexEntries: entries,
    writings,
    timelines,
    timelineEvents: events,
    yarnBoards: boards,
    yarnNodes: nodes,
    yarnEdges: filteredEdges,
    worldMaps: maps,
    mapPins: pins,
    imageCollections: collections,
    inspirationImages: images,
    externalLinks: links,
    exportedAt: Date.now(),
  };
}

export async function importProjectData(data: Awaited<ReturnType<typeof exportProjectData>>): Promise<string> {
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
    db.yarnBoards, db.yarnNodes, db.yarnEdges, db.worldMaps, db.mapPins,
    db.imageCollections, db.inspirationImages, db.externalLinks,
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

    // Yarn boards
    for (const b of data.yarnBoards || []) {
      await db.yarnBoards.add({ ...b, id: remap(b.id, 'board'), projectId: newProjectId });
    }

    // Yarn nodes
    for (const n of data.yarnNodes || []) {
      await db.yarnNodes.add({
        ...n,
        id: remap(n.id, 'ynode'),
        projectId: newProjectId,
        boardId: remap(n.boardId, 'board'),
      });
    }

    // Yarn edges
    for (const e of data.yarnEdges || []) {
      await db.yarnEdges.add({
        ...e,
        id: remap(e.id, 'edge'),
        boardId: remap(e.boardId, 'board'),
        sourceId: remap(e.sourceId, 'ynode'),
        targetId: remap(e.targetId, 'ynode'),
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

    // External links
    for (const l of data.externalLinks || []) {
      await db.externalLinks.add({ ...l, id: remap(l.id, 'link'), projectId: newProjectId });
    }
  });

  return newProjectId;
}

// ===== Full Database Export / Import (all projects) =====
export async function exportFullDatabase() {
  const [projects, codexEntries, writings, timelines, timelineEvents, yarnBoards, yarnNodes, yarnEdges, worldMaps, mapPins, imageCollections, inspirationImages, externalLinks, tags, settings] = await Promise.all([
    db.projects.toArray(),
    db.codexEntries.toArray(),
    db.writings.toArray(),
    db.timelines.toArray(),
    db.timelineEvents.toArray(),
    db.yarnBoards.toArray(),
    db.yarnNodes.toArray(),
    db.yarnEdges.toArray(),
    db.worldMaps.toArray(),
    db.mapPins.toArray(),
    db.imageCollections.toArray(),
    db.inspirationImages.toArray(),
    db.externalLinks.toArray(),
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
    yarnBoards,
    yarnNodes,
    yarnEdges,
    worldMaps,
    mapPins,
    imageCollections,
    inspirationImages,
    externalLinks,
    tags,
    settings,
    exportedAt: Date.now(),
  };
}

export async function importFullDatabase(data: Awaited<ReturnType<typeof exportFullDatabase>>): Promise<void> {
  // Clear all existing data, then import everything with original IDs
  await db.transaction('rw', [
    db.projects, db.codexEntries, db.writings, db.timelines, db.timelineEvents,
    db.yarnBoards, db.yarnNodes, db.yarnEdges, db.worldMaps, db.mapPins,
    db.imageCollections, db.inspirationImages, db.externalLinks, db.tags, db.settings,
  ], async () => {
    // Clear all tables
    await Promise.all([
      db.projects.clear(),
      db.codexEntries.clear(),
      db.writings.clear(),
      db.timelines.clear(),
      db.timelineEvents.clear(),
      db.yarnBoards.clear(),
      db.yarnNodes.clear(),
      db.yarnEdges.clear(),
      db.worldMaps.clear(),
      db.mapPins.clear(),
      db.imageCollections.clear(),
      db.inspirationImages.clear(),
      db.externalLinks.clear(),
      db.tags.clear(),
      db.settings.clear(),
    ]);

    // Import all data with original IDs (preserving references)
    if (data.projects?.length) await db.projects.bulkAdd(data.projects);
    if (data.codexEntries?.length) await db.codexEntries.bulkAdd(data.codexEntries);
    if (data.writings?.length) await db.writings.bulkAdd(data.writings);
    if (data.timelines?.length) await db.timelines.bulkAdd(data.timelines);
    if (data.timelineEvents?.length) await db.timelineEvents.bulkAdd(data.timelineEvents);
    if (data.yarnBoards?.length) await db.yarnBoards.bulkAdd(data.yarnBoards);
    if (data.yarnNodes?.length) await db.yarnNodes.bulkAdd(data.yarnNodes);
    if (data.yarnEdges?.length) await db.yarnEdges.bulkAdd(data.yarnEdges);
    if (data.worldMaps?.length) await db.worldMaps.bulkAdd(data.worldMaps);
    if (data.mapPins?.length) await db.mapPins.bulkAdd(data.mapPins);
    if (data.imageCollections?.length) await db.imageCollections.bulkAdd(data.imageCollections);
    if (data.inspirationImages?.length) await db.inspirationImages.bulkAdd(data.inspirationImages);
    if (data.externalLinks?.length) await db.externalLinks.bulkAdd(data.externalLinks);
    if (data.tags?.length) await db.tags.bulkAdd(data.tags);
    if (data.settings?.length) await db.settings.bulkAdd(data.settings);
  });
}
