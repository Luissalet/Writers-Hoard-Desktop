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
import { deleteEntityAnnotations } from '@/engines/_shared/deleteEntityAnnotations';
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
 * How long a project's `updatedAt` is considered fresh enough to leave alone.
 *
 * The editor autosaves every couple of seconds; without a window, "writing
 * bumps the project" would mean a second row write per keystroke burst.
 */
const PROJECT_TOUCH_WINDOW_MS = 60_000;

/**
 * When each project was last bumped BY THIS TAB. Checking the window in memory
 * means the common case — the autosave that fires two seconds after the last
 * one — costs nothing at all, not even the read `db.projects.update` would do
 * to apply the change.
 */
const lastProjectTouch = new Map<string, number>();

/**
 * Mark a project as worked on.
 *
 * `getAllProjects` orders the dashboard by `projects.updatedAt`, but writing a
 * chapter only ever touched `writings.updatedAt` — nothing called
 * `updateProject`. So a project you put four thousand words into yesterday sat
 * below one you recoloured in March. Every writing create/update/delete now
 * calls this.
 *
 * Throttled, never awaited by its callers, and it swallows its own errors: a
 * failed sort-key refresh must not fail the save that triggered it.
 */
export async function touchProject(projectId: string): Promise<void> {
  if (!projectId) return;
  const now = Date.now();
  if (now - (lastProjectTouch.get(projectId) ?? 0) < PROJECT_TOUCH_WINDOW_MS) return;
  lastProjectTouch.set(projectId, now);
  try {
    const updated = await db.projects.update(projectId, { updatedAt: now });
    if (updated) notifyProjectsChanged();
  } catch (error) {
    // Let the next write try again rather than staying quiet for a minute.
    lastProjectTouch.delete(projectId);
    console.error('[touchProject] could not refresh the project sort key', error);
  }
}

/**
 * Delete a project and EVERY row it owns, across all engine tables.
 *
 * Generic by design: any table with a `projectId` index is wiped
 * automatically, so engines added in the future are covered without touching
 * this function. Child tables that have no `projectId` index (they hang off a
 * parent: sceneCasts, storyboardConnectors, annotationReferences,
 * worldSnapshots) are resolved through their parents first, and the flat
 * `settings` store through `PROJECT_SETTING_PREFIXES`.
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
    const deletingProject = await db.projects.get(id);
    if (deletingProject?.parentId) {
      const parent = await db.projects.get(deletingProject.parentId);
      if (parent) {
        await db.projects.update(parent.id, {
          children: (parent.children ?? []).filter((childId) => childId !== id),
          updatedAt: Date.now(),
        });
      }
    }
    if (deletingProject?.type === 'saga') {
      // A saga owns shared identities, never the content of its books. Removing
      // it detaches those books and clears only the shared identity layer.
      await db.sharedEntityBindings.where('seriesId').equals(id).delete();
      await db.sharedCanonEntities.where('seriesId').equals(id).delete();
      await db.projects.where('parentId').equals(id).modify((project) => {
        project.parentId = undefined;
        project.updatedAt = Date.now();
      });
    }

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

    // --- the settings rows keyed BY the project id ---
    // `settings` is `'id, key'`: no projectId index, so the generic sweep above
    // cannot see it and the sprint log, the active sprint, the dismissed
    // findings, the saved searches and the grounded-AI flags used to outlive
    // the project — and be inherited by a re-import that reuses its id.
    await db.settings.where('key').anyOf(projectSettingKeys(id)).delete();

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

/**
 * Update a codex entry, propagating a RENAME to the tables that denormalise
 * the entry's title at creation time.
 *
 * `relationships.entityAName` / `entityBName` and `characterArcs.characterName`
 * are copies, not lookups: the relationship list, the matrix tooltip, the
 * entity resolver and the search index all read them. A bare
 * `db.codexEntries.update` left those copies frozen at the old name, so the
 * matrix header (which reads live codex titles) and the list view disagreed
 * forever, and Cmd+K only ever found the relationship under the OLD name.
 */
export async function updateCodexEntry(id: string, changes: Partial<CodexEntry>): Promise<void> {
  const title = changes.title;
  if (title === undefined) {
    await db.codexEntries.update(id, { ...changes, updatedAt: Date.now() });
    return;
  }

  const entry = await db.codexEntries.get(id);
  const projectId = entry?.projectId;

  await db.transaction('rw', [db.codexEntries, db.relationships, db.characterArcs], async () => {
    const now = Date.now();
    await db.codexEntries.update(id, { ...changes, updatedAt: now });

    // Both endpoints are indexed; a self-pairing would match twice, hence the map.
    const [asA, asB] = await Promise.all([
      db.relationships.where('entityAId').equals(id).toArray(),
      db.relationships.where('entityBId').equals(id).toArray(),
    ]);
    const rels = new Map(
      [...asA, ...asB]
        .filter((r) => !projectId || r.projectId === projectId)
        .map((r) => [r.id, r] as const),
    );
    if (rels.size > 0) {
      await db.relationships.bulkPut(
        Array.from(rels.values(), (r) => ({
          ...r,
          entityAName: r.entityAId === id ? title : r.entityAName,
          entityBName: r.entityBId === id ? title : r.entityBName,
          updatedAt: now,
        })),
      );
    }

    const arcs = (await db.characterArcs.where('characterId').equals(id).toArray()).filter(
      (arc) => !projectId || arc.projectId === projectId,
    );
    if (arcs.length > 0) {
      await db.characterArcs.bulkPut(
        arcs.map((arc) => ({ ...arc, characterName: title, updatedAt: now })),
      );
    }
  });
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
 *  • `annotations` — a margin note whose entity is gone has nothing left to
 *    point at, so it goes with its reference rows.
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
      db.annotations,
      db.annotationReferences,
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
          arcs.map((arc) => ({
            ...arc,
            characterId: undefined,
            characterName: undefined,
            updatedAt: now,
          })),
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

      await deleteEntityAnnotations('codex', id);

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
  const id = await db.writings.add(writing);
  void touchProject(writing.projectId);
  return id;
}

export async function updateWriting(id: string, changes: Partial<Writing>): Promise<void> {
  await db.writings.update(id, { ...changes, updatedAt: Date.now() });
  // This entry point is the Google Docs sync, not the prose editor (that saves
  // through the writings engine's own operations), so resolving the parent with
  // a row read costs nothing anyone is waiting on.
  const projectId = changes.projectId ?? (await db.writings.get(id))?.projectId;
  if (projectId) void touchProject(projectId);
}

// There is deliberately no `deleteWriting` here. Deleting a writing means
// cascading its annotations, unlinking the outline beats that point at it and
// building the undo bundle `restoreDeletedWriting` reads back — all of which
// lives in `src/engines/writings/operations.ts`. A second one here took only
// the row and its snapshots, so anything that autocompleted to it lost the
// rest without saying so.

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
  await db.transaction('rw', [db.inspirationImages, db.imageRecipes], async () => {
    await db.imageRecipes.where('imageId').equals(id).delete();
    await db.inspirationImages.delete(id);
  });
}

// ===== Settings =====

/**
 * The settings keys that belong to ONE project, written as `<prefix><projectId>`.
 *
 * `settings` is a flat key/value store with no `projectId` index, so nothing
 * about a project's rows here can be discovered — they have to be named.
 * `deleteProject` sweeps exactly these, which makes a future per-project
 * setting a ONE-LINE addition to this record and nothing else.
 *
 * It lives beside `getSetting`/`setSetting` because that is the module every
 * writer of these keys already imports: the sprint log and the active sprint
 * (`engines/writing-stats/sprints.ts`), the proofreader's dismissals
 * (`services/proofreader.ts`) and the command centre's saved searches
 * (`services/commandCenter.ts`) all take their prefix from here rather than
 * spelling it out again.
 */
export const PROJECT_SETTING_PREFIXES = {
  sprintLog: 'writingStats.sprintLog.',
  activeSprint: 'writingStats.activeSprint.',
  proofreaderDismissed: 'proofreader.dismissed.',
  savedSearches: 'commandCenter.savedSearches.',
  /** Written by `saveGroundedAiPrivacy` in `services/projectTools.ts`. */
  groundedAiPrivacy: 'project-tools.ai-privacy.',
  /** Written by `saveReadingPosition` in `engines/writings/readingPositionPersist.ts`. */
  readingPosition: 'writings.readingPosition.',
  /** Written by `saveAtlasMapPrefs` in `engines/real-atlas/mapPrefs.ts`: the map's view and layer toggles. */
  atlasMap: 'realAtlas.map.',
  /** Written by `saveAtlasRoutes` in `engines/real-atlas/routes.ts`: the project's itineraries (also in its backup, via the engine's strategy). */
  atlasRoutes: 'realAtlas.routes.',
  /** Per-character Web Speech voice choices for Dialog Scene table reads. */
  tableReadVoices: 'dialogScene.tableRead.voices.',
} as const;

/** Every settings key the given project owns. */
export function projectSettingKeys(projectId: string): string[] {
  return Object.values(PROJECT_SETTING_PREFIXES).map(prefix => `${prefix}${projectId}`);
}

/** The row id a key is always stored under, so a write never has to look one up. */
function settingId(key: string): string {
  return `set_${key}`;
}

export async function getSetting(key: string): Promise<string | undefined> {
  const setting = await db.settings.where('key').equals(key).first();
  return setting?.value;
}

/**
 * Write a value. One `put` on the deterministic id: the previous read-then-add
 * let two concurrent writes to the same key both see "no row" and then collide
 * on that same primary key.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ id: settingId(key), key, value });
}

/**
 * Read-modify-write a setting ATOMICALLY.
 *
 * Several of these values are JSON collections that are changed by adding or
 * removing one member (dismissed findings, saved searches, the sprint log).
 * Done as `getSetting` → mutate → `setSetting`, two overlapping calls both read
 * the same starting value and the later write silently drops the earlier one —
 * a dismissal that comes back, a saved search that never arrives. The read and
 * the write belong in one transaction, which is all this is.
 *
 * `update` runs INSIDE that transaction and must stay synchronous: awaiting
 * anything that is not a Dexie operation would let the transaction commit
 * underneath it.
 */
export async function updateSetting(
  key: string,
  update: (current: string | undefined) => string,
): Promise<string> {
  return db.transaction('rw', db.settings, async () => {
    const existing = await db.settings.where('key').equals(key).first();
    const value = update(existing?.value);
    await db.settings.put({ id: existing?.id ?? settingId(key), key, value });
    return value;
  });
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

/**
 * The tables the legacy `fullExport: true` JSON can carry, keyed by the name
 * they use in the payload. `externalLinks` is deliberately absent: those rows
 * are merged into `snapshots`, a table the legacy format does not own.
 */
const LEGACY_FULL_EXPORT_TABLES: Record<string, string> = {
  projects: 'projects',
  codexEntries: 'codexEntries',
  writings: 'writings',
  timelines: 'timelines',
  timelineEvents: 'timelineEvents',
  boards: 'boards',
  boardNodes: 'boardNodes',
  boardEdges: 'boardEdges',
  boardLayers: 'boardLayers',
  boardViews: 'boardViews',
  worldMaps: 'worldMaps',
  mapPins: 'mapPins',
  imageCollections: 'imageCollections',
  inspirationImages: 'inspirationImages',
  tags: 'tags',
  settings: 'settings',
};

/**
 * Children that hang off a parent instead of carrying their own `projectId`,
 * as `deleteProject` resolves them. Clearing a parent has to take them too or
 * they survive as rows nothing can reach.
 */
const LEGACY_CHILD_TABLES: Record<string, string[]> = {
  scenes: ['sceneCasts'],
  storyboards: ['storyboardConnectors'],
  annotations: ['annotationReferences'],
  generatedWorlds: ['worldSnapshots'],
};

/**
 * Restore a legacy `fullExport: true` JSON. This is a PARTIAL restore: that
 * format only ever carried the tables in `LEGACY_FULL_EXPORT_TABLES`, so only
 * those are cleared and repopulated. Every other table — the engines added
 * since — is left exactly as it was, because the file holds nothing to put
 * back into it. Use the ZIP backup for a whole-database replacement.
 *
 * As `importProjectData`: legacy `externalLinks` arrive as snapshots, merged
 * rather than replacing the `snapshots` table.
 */
export async function importFullDatabase(
  data: Awaited<ReturnType<typeof exportFullDatabase>> & { externalLinks?: LegacyExternalLink[] },
): Promise<void> {
  const payload = data as unknown as Record<string, unknown>;
  const toClear = new Set<string>();
  for (const [key, tableName] of Object.entries(LEGACY_FULL_EXPORT_TABLES)) {
    if (!Array.isArray(payload[key])) continue;
    toClear.add(tableName);
    for (const child of LEGACY_CHILD_TABLES[tableName] ?? []) toClear.add(child);
  }

  await db.transaction('rw', db.tables, async () => {
    for (const tableName of toClear) await db.table(tableName).clear();

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
