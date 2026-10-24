import {encodeAssetFile,decodeAssetFiles,type PortableLocalAssetFile,type LocalAssetFile} from '@/engines/local/assetFileFormat';
import {validateManuscriptContents,writingSelection,structuralManuscriptOwners} from '@/engines/writings/manuscripts';
import {validateWritingOwner,assertWritingOwnerUnchanged} from '@/engines/writings/manuscriptStore';
import { encodeManuscriptSource, decodeManuscriptSources, cloneManuscriptSource, cloneManuscriptWritingSource } from '@/engines/writings/manuscriptReview/portability';
import { validateCodexOptionLists } from '@/engines/codex/optionListTypes';
import {validateLocalToolBlockRichContent} from '@/engines/local/blocks/types';
import {remapToolDockLayout,validateToolDockWritingMetadata} from '@/engines/writings/toolDock/types';
import { preserveLegacyProjectMetadata, preserveLegacyWritingToolDock, preserveLegacyEraWritingToolDock, validateProjectArchiveMetadata } from '@/services/projectArchiveMetadata';
import { decodeDocumentHistory, cloneDocumentHistory } from '@/services/documentHistory/portability';
import { exportAnnotationData, decodeAnnotationData, cloneAnnotationData, annotationSourceIds } from '@/engines/annotations/portability';
import { validatePublishedEditionsProject } from '@/services/publishedEditions/validation';
import type { DocumentHistoryEntry } from '@/services/documentHistory/types';
import { suppressDocumentHistoryForTransaction } from '@/services/documentHistory/context';
import type { WorldEraAsset, WorldEraVariant } from '@/services/worldEras/types';
import { eraAdapters } from '@/services/worldEras/adapters';
import { cloneEraVariants, decodeEraVariants, decodeEraAssets, encodeEraValue, worldDocumentCloner } from '@/services/worldEras/portability';
import { archiveWithMutation } from '@/services/documentArchive/store';
import { db } from './index';
import Dexie from 'dexie';
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
import { clearProjectDraftStores } from '@/hooks/localDraftStore';
import { projectToolIds, remapWorldMetadata, remapWorldRichContent } from '@/services/worldMetadata';
import { decodeLocalMedia, encodeLocalMedia, type PortableLocalMedia } from '@/engines/media/portability';
import { remapImportedWorldMap, remapImportedMapPin, unlinkCodexEntryFromMap } from '@/engines/maps/mapPortability';
import { eventEntryIds } from '@/engines/timeline/eventDetails';

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
  return (await db.projects.orderBy('updatedAt').reverse().toArray()).sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned)));
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
 * worldSnapshots, canonTiles, renderedTiles) are resolved through their
 * parents first, and the flat `settings` store through
 * `PROJECT_SETTING_PREFIXES`.
 *
 * Previously this only covered the 13 original tables and silently orphaned
 * ~25 engine tables' rows — which then leaked into global search and
 * backlinks forever.
 */
export async function deleteProject(id: string): Promise<void> {
  let outer = Dexie.currentTransaction;
  while (outer?.parent) outer = outer.parent;
  // Dexie keeps the primary key out of `idxByName`, so a table keyed BY the
  // project (aiProjectSettings) needs the second test.
  const projectScoped = db.tables.filter(
    (t) => t.name !== 'projects' && ('projectId' in t.schema.idxByName || t.schema.primKey.name === 'projectId'),
  );

  await db.transaction('rw', db.tables, async () => {
    suppressDocumentHistoryForTransaction();
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
      // The forged tile caches hang off the world, not the project, exactly
      // like the snapshot above — and are megabytes per world, so an orphan
      // is not free just because the budget evicts it eventually.
      await db.canonTiles.where('worldId').anyOf(worldIds as string[]).delete();
      await db.renderedTiles.where('worldId').anyOf(worldIds as string[]).delete();
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
  // Recovery copies outlive mounted engines. Clear them only after the database
  // transaction commits; storage errors remain retryable in PendingWrites.
  const committed = () => { clearProjectDraftStores(id); notifyProjectsChanged(); };
  if (outer) outer.on('complete', () => Dexie.ignoreTransaction(committed));
  else committed();
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
  return archiveWithMutation('codex', id, () => deleteCodexEntryRows(id));
}
async function deleteCodexEntryRows(id: string): Promise<void> {
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
      db.worldMaps,
      db.inspirationImages,
      db.localMediaAssets,
      db.timelineEvents,
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
      const mapQuery = projectId ? db.worldMaps.where('projectId').equals(projectId) : db.worldMaps.toCollection();
      for (const map of await mapQuery.toArray()) {
        const unlinked = unlinkCodexEntryFromMap(map, id);
        if (unlinked !== map) await db.worldMaps.put(unlinked);
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

      const eventQuery = projectId ? db.timelineEvents.where('projectId').equals(projectId) : db.timelineEvents.toCollection();
      const linkedEvents = (await eventQuery.toArray()).filter(event => eventEntryIds(event).includes(id));
      if (linkedEvents.length) await db.timelineEvents.bulkPut(linkedEvents.map(event => {
        const links = eventEntryIds(event).filter(entryId => entryId !== id);
        return { ...event, linkedEntryIds: links, linkedEntryId: links[0], updatedAt: Date.now() };
      }));

      await db.codexEntries.delete(id);
      const mediaQuery = projectId ? db.localMediaAssets.where('projectId').equals(projectId) : db.localMediaAssets.toCollection();
      await mediaQuery.filter(asset => asset.linkedEntryIds.includes(id)).modify(asset => { asset.linkedEntryIds = asset.linkedEntryIds.filter(entryId => entryId !== id); });
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

export function createWriting(writing: Writing): Promise<string> {
  return db.transaction('rw', [db.projects, db.writings, db.worldEraVariants, db.worldEraAssets, db.documentArchives], () =>
    Dexie.Promise.resolve(validateWritingOwner(writing)).then(row => db.writings.add(row)),
  ).then(id => {
    // Creation and its catalogue membership commit together; UndoCreate cannot
    // remove the owner between validation and insertion.
    void touchProject(writing.projectId);
    return id;
  });
}

export async function updateWriting(id: string, changes: Partial<Writing>): Promise<void> {
  const previous=await db.writings.get(id);if(previous)assertWritingOwnerUnchanged(previous,changes);
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
  return archiveWithMutation('timeline', id, () => deleteTimelineRows(id));
}
async function deleteTimelineRows(id: string): Promise<void> {
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
  return archiveWithMutation('maps', id, () => deleteWorldMapRows(id));
}
async function deleteWorldMapRows(id: string): Promise<void> {
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
  spanishPersonalWords: 'proofing:es-ES:',
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
  /** Written by `importWorldDoc` in `services/familyBridge/worldImport.ts`: refs brought in from a story world, so a record the writer deleted is never brought back. */
  familyWorld: 'familyBridge.world.',
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

  const entityLinks = await db.entityLinks.where('projectId').equals(projectId).toArray();
  const publishingProfiles=project?.manuscriptCatalog?await db.publishingProfiles.where('projectId').equals(projectId).toArray():[];
  return {
    ...(publishingProfiles.length?{publishingProfiles}:{}),
    project,
    ...(entityLinks.length ? { entityLinks } : {}),
    ...await exportAnnotationData(projectId),
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
    manuscriptSources: await Promise.all((await db.manuscriptSources.where('projectId').equals(projectId).toArray()).map(encodeManuscriptSource)),
    localToolAssetFiles: await Promise.all((await db.localToolAssetFiles.where('projectId').equals(projectId).toArray()).map(encodeAssetFile)),
    localMediaAssets: await Promise.all((await db.localMediaAssets.where('projectId').equals(projectId).toArray()).map(encodeLocalMedia)),
    documentHistory: await encodeEraValue(await db.documentHistory.where('projectId').equals(projectId).toArray()),
    scenes: await db.scenes.where('projectId').equals(projectId).toArray(),
    sceneCasts: await db.sceneCasts.where('sceneId').anyOf(await db.scenes.where('projectId').equals(projectId).primaryKeys()).toArray(),
    dialogBlocks: await db.dialogBlocks.where('projectId').equals(projectId).toArray(),
    worldEraVariants: await encodeEraValue(await db.worldEraVariants.where('projectId').equals(projectId).toArray()),
    worldEraAssets: await encodeEraValue(await db.worldEraAssets.where('projectId').equals(projectId).toArray()),
    writingSnapshots: await db.writingSnapshots.where('projectId').equals(projectId).toArray(),
    notes: await db.notes.where('projectId').equals(projectId).toArray(),
    timelineConnections: await db.timelineConnections.where('projectId').equals(projectId).toArray(),
    generatedWorlds: await db.generatedWorlds.where('projectId').equals(projectId).toArray(),
    worldWaypoints: await db.worldWaypoints.where('projectId').equals(projectId).toArray(),
    exportedAt: Date.now(),
  };
}

/**
 * Legacy JSON import. `externalLinks` no longer exists as a table, but old
 * export files still carry it — those rows are converted into link-only
 * Scrapper snapshots on the way in (see engines/scrapper/legacyLinks.ts).
 */
export async function importProjectData(
  data: Omit<Awaited<ReturnType<typeof exportProjectData>>, 'localToolAssetFiles' | 'manuscriptSources' | 'localMediaAssets' | 'annotations' | 'annotationReferences' | 'documentHistory' | 'scenes' | 'sceneCasts' | 'dialogBlocks' | 'worldEraVariants' | 'worldEraAssets' | 'writingSnapshots' | 'notes' | 'timelineConnections' | 'generatedWorlds' | 'worldWaypoints'> & Partial<Pick<Awaited<ReturnType<typeof exportProjectData>>, 'annotations' | 'annotationReferences' | 'documentHistory' | 'scenes' | 'sceneCasts' | 'dialogBlocks' | 'worldEraVariants' | 'worldEraAssets' | 'writingSnapshots' | 'notes' | 'timelineConnections' | 'generatedWorlds' | 'worldWaypoints'>> & { manuscriptSources?: import('@/engines/writings/manuscriptReview/portability').PortableManuscriptSource[]; localToolAssetFiles?: PortableLocalAssetFile[]; localMediaAssets?: PortableLocalMedia[]; externalLinks?: LegacyExternalLink[] },
): Promise<string> {
  const idMap = new Map<string, string>();
  const remap = (oldId: string, prefix: string): string => {
    const key=['asset-file','img','media'].includes(prefix)?JSON.stringify([prefix,oldId]):oldId;
    if (!idMap.has(key)) {
      idMap.set(key, `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    }
    return idMap.get(key)!;
  };

  const newProjectId = remap(data.project!.id, 'proj');
  for (const link of data.entityLinks ?? []) {
    if (!link || link.projectId !== data.project!.id || ['id', 'sourceEntityId', 'targetEntityId', 'sourceEngineId', 'targetEngineId'].some(key => typeof link[key as keyof typeof link] !== 'string' || !String(link[key as keyof typeof link]).trim())) throw Error('entity_link_invalid');
  }
  validatePublishedEditionsProject(data.project!);
  validateCodexOptionLists(data.project!.codexOptionLists);
  validateProjectArchiveMetadata(data.project!);
  for(const writing of data.writings??[])validateToolDockWritingMetadata(writing);
  for (const rows of Object.values(data)) if (Array.isArray(rows)) {
    for (const row of rows) validateLocalToolBlockRichContent(row, data.project!.id);
  }
  const annotationData = decodeAnnotationData(data, data.project!.id, new Set(data.project!.worldEras?.map(era => era.id)));
  const sources = await decodeManuscriptSources(data.manuscriptSources, data.project!.id, new Set(data.project!.worldEras?.map(era => era.id)));
  const clonedAnnotations = cloneAnnotationData(annotationData, newProjectId, remap, annotationSourceIds(data));
  const assetFiles=await decodeAssetFiles(data.localToolAssetFiles??[],data.project!.id);
  const media = decodeLocalMedia(data.localMediaAssets ?? [], data.project!.id);
  const eraAssets = await decodeEraAssets(data.worldEraAssets, data.project!.id);
  const eraVariants = decodeEraVariants(data.worldEraVariants, data.project!.id, eraAssets);
  validateManuscriptContents(data.project!,data.writings??[],eraVariants,data.publishingProfiles??[]);
  const history = await decodeDocumentHistory(data.documentHistory, data.project!.id, eraAssets);
  const clonedHistory = await cloneDocumentHistory(history, eraVariants, data.project!, newProjectId, remap, { ...data, localMediaAssets: media }, eraAssets);
  const sceneSources = (data.scenes ?? []).map(root => ({ kind: 'dialog-scene' as const, document: { root, children: { sceneCasts: (data.sceneCasts ?? []).filter(row=>row.sceneId===root.id), dialogBlocks: (data.dialogBlocks ?? []).filter(row=>row.sceneId===root.id) } } as unknown as import('@/services/worldEras/types').EraDocument }));
  const cloneScene = worldDocumentCloner([...eraVariants,...history,...sceneSources], data.project!,newProjectId,remap,{...data,localMediaAssets:media},eraAssets);
  const clonedEraVariants = cloneEraVariants(eraVariants, data.project!, newProjectId, remap, { ...data, localMediaAssets: media }, eraAssets);
  const eraRoots = (kind: string) => eraVariants.filter(row => row.kind === kind).flatMap(row => row.document ? [row.document.root] : []);
  const codexIds = new Set([...(data.codexEntries ?? []).map(entry => entry.id), ...eraRoots('codex').map(row => row.id)]), mediaIds = new Set([...media.map(asset => asset.id), ...eraRoots('media').map(row => row.id)]);
  const referenceProject = { ...data.project! };
  for (const [kind, adapter] of Object.entries(eraAdapters)) if (adapter.metadata) Object.assign(referenceProject, { [adapter.metadata]: [...(data.project![adapter.metadata] as { id: string }[] | undefined) ?? [], ...eraRoots(kind)] });
  const toolIds = projectToolIds(referenceProject, { writings:[...data.writings??[],...eraRoots('writings')],scenes:data.scenes,generatedWorlds:data.generatedWorlds,worldMaps: [...data.worldMaps ?? [], ...eraRoots('maps')], boards: [...data.boards ?? [], ...eraRoots('board')], timelines: [...data.timelines ?? [], ...eraRoots('timeline')] });
  const richContent = (content: string) => remapWorldRichContent(content, data.project!.id, newProjectId, remap, codexIds, mediaIds, toolIds);

  await db.transaction('rw', [
    db.projects, db.codexEntries, db.writings, db.publishingProfiles, db.manuscriptSources, db.timelines, db.timelineEvents, db.documentHistory, db.annotations, db.annotationReferences, db.scenes, db.sceneCasts, db.dialogBlocks,
    db.boards, db.boardNodes, db.boardEdges, db.boardLayers, db.boardViews,
    db.worldMaps, db.mapPins, db.entityLinks,
    db.imageCollections, db.inspirationImages, db.snapshots, db.localMediaAssets, db.localToolAssetFiles, db.worldEraVariants, db.worldEraAssets, db.notes, db.writingSnapshots, db.timelineConnections, db.generatedWorlds, db.worldWaypoints,
  ], async () => {
    suppressDocumentHistoryForTransaction();
    // Project
    await db.projects.add({
      ...data.project!,
      id: newProjectId,
      ...remapWorldMetadata(data.project!, remap, codexIds, mediaIds, new Set([...(data.writings ?? []).map(writing => writing.id), ...eraRoots('writings').map(row => row.id)]), toolIds),
      title: `${data.project!.title} (Imported)`,
      // JSON imports clone IDs. Keep workflow pointers inside the new project;
      // unlike ZIP, this legacy format does not carry notes or citations.
      writingWorkflows: data.project!.writingWorkflows?.map(workflow => ({
        ...workflow,
        id: remap(workflow.id, 'workflow'),
        materials: workflow.materials.flatMap(material => {
          if (material.kind === 'writing' && data.writings?.some(row => row.id === material.id)) {
            return [{ ...material, id: remap(material.id, 'wr') }];
          }
          if (material.kind === 'snapshot' && data.externalLinks?.some(row => row.id === material.id)) {
            return [{ ...material, id: remap(material.id, 'snap') }];
          }
          return [];
        }),
        exports: workflow.exports.filter(item => data.writings?.some(row => row.id === item.writingId))
          .map(item => ({ ...item, writingId: remap(item.writingId, 'wr') })),
      })),
      updatedAt: Date.now(),
    });

    // Codex entries
    for (const e of data.codexEntries || []) {
      await db.codexEntries.add({ ...e, id: remap(e.id, 'codex'), projectId: newProjectId,
        content: richContent(e.content),
        templateId: e.templateId ? remap(e.templateId, 'template') : undefined,
        referenceFields: e.referenceFields ? Object.fromEntries(Object.entries(e.referenceFields).map(([key, ids]) => [key, ids.filter(id => data.codexEntries?.some(entry => entry.id === id)).map(id => remap(id, 'codex'))])) : undefined,
        relations: (e.relations ?? []).filter(relation => data.codexEntries?.some(entry => entry.id === relation.targetId))
          .map(relation => ({ ...relation, targetId: remap(relation.targetId, 'codex') })),
      });
    }

    for (const source of sources) await db.manuscriptSources.add(cloneManuscriptSource(source, newProjectId, remap));
    // Writings
    for (const w of data.writings || []) {
      await db.writings.add({ ...w,...(w.manuscriptId?{manuscriptId:remap(w.manuscriptId,'manuscript')}:{}), toolDock:remapToolDockLayout(w.toolDock,remap), id: remap(w.id, 'wr'), projectId: newProjectId, manuscriptSource: cloneManuscriptWritingSource(w.manuscriptSource, remap), content: richContent(w.content) });
    }

    for(const asset of assetFiles)await db.localToolAssetFiles.add({...asset,id:remap(asset.id,'asset-file'),projectId:newProjectId});
    for (const asset of media) await db.localMediaAssets.add({ ...asset, id: remap(asset.id, 'media'), projectId: newProjectId, linkedEntryIds: asset.linkedEntryIds.filter(id => codexIds.has(id)).map(id => remap(id, 'codex')) });

    // Timelines
    for (const t of data.timelines || []) {
      await db.timelines.add({ ...t, id: remap(t.id, 'tl'), projectId: newProjectId });
    }

    // Timeline events
    for (const ev of data.timelineEvents || []) {
      const links = eventEntryIds(ev).filter(id => data.codexEntries?.some(entry => entry.id === id)).map(id => remap(id, 'codex'));
      await db.timelineEvents.add({
        ...ev,
        linkedEntryIds: links,
        linkedEntryId: links[0],
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
        richContent: n.richContent ? richContent(n.richContent) : n.richContent,
        id: remap(n.id, 'bnode'),
        memberNodeIds: n.memberNodeIds?.map(id => remap(id, 'bnode')),
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
    const importedCodexIds = new Set((data.codexEntries ?? []).map(entry => entry.id));
    const importedEventIds = new Set((data.timelineEvents ?? []).map(event => event.id));
    for (const m of data.worldMaps || []) {
      await db.worldMaps.add(remapImportedWorldMap(m, newProjectId, remap, importedCodexIds, importedEventIds, mediaIds));
    }

    // Map pins
    for (const p of data.mapPins || []) {
      await db.mapPins.add(remapImportedMapPin(p, newProjectId, remap(p.mapId, 'map'), remap, importedCodexIds, mediaIds));
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

    for(const profile of data.publishingProfiles??[]){const scope=profile.writingScope?writingSelection(profile.writingScope):undefined;await db.publishingProfiles.add({...profile,id:remap(profile.id,'publish'),projectId:newProjectId,...(scope?{writingScope:scope.kind==='manuscript'&&scope.id!=='main'?{kind:'manuscript',id:remap(scope.id,'manuscript')}:scope}:{}),selectedWritingIds:profile.selectedWritingIds.map(id=>remap(id,'wr')),writingOrder:profile.writingOrder?.map(id=>remap(id,'wr'))});}
    for (const row of data.writingSnapshots ?? []) await db.writingSnapshots.add({ ...row, id: remap(row.id, 'wsnap'), projectId: newProjectId, writingId: remap(row.writingId, 'wr'), sourceDraftId: row.sourceDraftId ? remap(row.sourceDraftId, 'wsnap') : undefined, content: richContent(row.content) });
    for (const row of data.notes ?? []) await db.notes.add({ ...row, id: remap(row.id, 'note'), projectId: newProjectId });
    for (const row of data.timelineConnections ?? []) await db.timelineConnections.add({ ...row, id: remap(row.id, 'tconn'), projectId: newProjectId, timelineId: remap(row.timelineId, 'tl'), sourceEventId: remap(row.sourceEventId, 'evt'), targetEventId: remap(row.targetEventId, 'evt') });
    for (const world of data.generatedWorlds ?? []) await db.generatedWorlds.add({ ...world, id: remap(world.id, 'world'), projectId: newProjectId, originWorldId: world.originWorldId && data.generatedWorlds?.some(item => item.id === world.originWorldId) ? remap(world.originWorldId, 'world') : undefined });
    for (const point of data.worldWaypoints ?? []) await db.worldWaypoints.add({ ...point, id: remap(point.id, 'waypoint'), worldId: remap(point.worldId, 'world'), projectId: newProjectId });
    if (eraAssets.length) await db.worldEraAssets.bulkAdd(eraAssets.map(asset => ({ ...asset, id: remap(asset.id, 'era-asset'), projectId: newProjectId })));
    if (clonedEraVariants.length) await db.worldEraVariants.bulkAdd(clonedEraVariants);
    if (clonedHistory.length) await db.documentHistory.bulkAdd(clonedHistory);
    if (clonedAnnotations.annotations.length) await db.annotations.bulkAdd(clonedAnnotations.annotations);
    if (clonedAnnotations.annotationReferences.length) await db.annotationReferences.bulkAdd(clonedAnnotations.annotationReferences);
    for(const source of sceneSources){const document=cloneScene('dialog-scene',source.document);await db.table('scenes').add(document.root);for(const [table,rows] of Object.entries(document.children))if(rows.length)await db.table(table).bulkAdd(rows);}
    // All imported documents have allocated their IDs now. Unknown historical
    // targets retain their identity, as in the existing era document cloner.
    const linkTarget = (id: string) => { const split = id.indexOf('::'); return split < 0 ? idMap.get(id) ?? id : `${idMap.get(id.slice(0, split)) ?? id.slice(0, split)}${id.slice(split)}`; };
    for (const link of data.entityLinks ?? []) await db.entityLinks.add({ ...link, id: remap(link.id, 'entity-link'), projectId: newProjectId, sourceEntityId: linkTarget(link.sourceEntityId), targetEntityId: linkTarget(link.targetEntityId) });

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
    annotations: await db.annotations.toArray(), annotationReferences: await db.annotationReferences.toArray(),
    documentHistory: await encodeEraValue(await db.documentHistory.toArray()),
    scenes: await db.scenes.toArray(), sceneCasts: await db.sceneCasts.toArray(), dialogBlocks: await db.dialogBlocks.toArray(),
    notes: await db.notes.toArray(), generatedWorlds: await db.generatedWorlds.toArray(), worldWaypoints: await db.worldWaypoints.toArray(), writingSnapshots: await db.writingSnapshots.toArray(), timelineConnections: await db.timelineConnections.toArray(),
    manuscriptSources: await Promise.all((await db.manuscriptSources.toArray()).map(encodeManuscriptSource)),
    localToolAssetFiles: await Promise.all((await db.localToolAssetFiles.toArray()).map(encodeAssetFile)),
    localMediaAssets: await Promise.all((await db.localMediaAssets.toArray()).map(encodeLocalMedia)),
    worldEraVariants: await encodeEraValue(await db.worldEraVariants.toArray()),
    worldEraAssets: await encodeEraValue(await db.worldEraAssets.toArray()),
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
  annotations: 'annotations', annotationReferences: 'annotationReferences',
  manuscriptSources: 'manuscriptSources', documentHistory: 'documentHistory', scenes: 'scenes', sceneCasts: 'sceneCasts', dialogBlocks: 'dialogBlocks', notes: 'notes', generatedWorlds: 'generatedWorlds', worldWaypoints: 'worldWaypoints', writingSnapshots: 'writingSnapshots', timelineConnections: 'timelineConnections', localMediaAssets: 'localMediaAssets', localToolAssetFiles:'localToolAssetFiles',
  worldEraVariants: 'worldEraVariants',
  worldEraAssets: 'worldEraAssets',
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
  data: Omit<Awaited<ReturnType<typeof exportFullDatabase>>, 'manuscriptSources' | 'localToolAssetFiles' | 'annotations' | 'annotationReferences' | 'documentHistory' | 'scenes' | 'sceneCasts' | 'dialogBlocks' | 'notes' | 'generatedWorlds' | 'worldWaypoints' | 'writingSnapshots' | 'timelineConnections' | 'localMediaAssets'> & Partial<Pick<Awaited<ReturnType<typeof exportFullDatabase>>, 'annotations' | 'annotationReferences' | 'documentHistory' | 'scenes' | 'sceneCasts' | 'dialogBlocks' | 'notes' | 'generatedWorlds' | 'worldWaypoints' | 'writingSnapshots' | 'timelineConnections' | 'localMediaAssets'>> & { localToolAssetFiles?:PortableLocalAssetFile[]; manuscriptSources?: import('@/engines/writings/manuscriptReview/portability').PortableManuscriptSource[]; externalLinks?: LegacyExternalLink[] },
): Promise<void> {
  const payload = data as unknown as Record<string, unknown>;
  for(const writing of data.writings??[])validateToolDockWritingMetadata(writing);
  const eraAssets: WorldEraAsset[] = [];
  const eraVariants: WorldEraVariant[] = [];
  const history: DocumentHistoryEntry[] = [];
  const annotations: import('@/engines/annotations/types').Annotation[] = [], annotationReferences: import('@/engines/annotations/types').AnnotationReference[] = [];
  const manuscriptSources: import('@/engines/writings/manuscriptReview/types').ManuscriptSourceRow[] = [];
  const assetFiles:LocalAssetFile[]=[];
  const media: import('@/engines/media/types').LocalMediaAsset[] = [];
  for (const project of data.projects ?? []) {
    manuscriptSources.push(...await decodeManuscriptSources((data.manuscriptSources ?? []).filter(row => row.projectId === project.id), project.id, new Set(project.worldEras?.map(era => era.id))));
    validateProjectArchiveMetadata(project);
    for (const rows of Object.values(data)) if (Array.isArray(rows)) {
      for (const row of rows) if (row && typeof row === 'object' && 'projectId' in row && row.projectId === project.id) {
        validateLocalToolBlockRichContent(row, project.id);
      }
    }
    validatePublishedEditionsProject(project);validateCodexOptionLists(project.codexOptionLists);
    const ownedAnnotations = (data.annotations ?? []).filter(row => row.projectId === project.id), ownedIds = new Set(ownedAnnotations.map(row => row.id));
    const decodedComments = decodeAnnotationData({ annotations: ownedAnnotations, annotationReferences: (data.annotationReferences ?? []).filter(row => ownedIds.has(row.annotationId)) }, project.id, new Set(project.worldEras?.map(era => era.id)));
    annotations.push(...decodedComments.annotations); annotationReferences.push(...decodedComments.annotationReferences);
    const assets = await decodeEraAssets(Array.isArray(data.worldEraAssets) ? data.worldEraAssets.filter(row => row && typeof row === 'object' && row.projectId === project.id) : [], project.id);
    eraAssets.push(...assets);
    history.push(...await decodeDocumentHistory(Array.isArray(data.documentHistory)?data.documentHistory.filter(row=>row && typeof row==='object' && row.projectId===project.id):[],project.id,assets));
    assetFiles.push(...await decodeAssetFiles((data.localToolAssetFiles??[]).filter(row=>row.projectId===project.id),project.id));
    media.push(...decodeLocalMedia((data.localMediaAssets ?? []).filter(row=>row.projectId===project.id),project.id));
    eraVariants.push(...decodeEraVariants(Array.isArray(data.worldEraVariants) ? data.worldEraVariants.filter(row => row && typeof row === 'object' && row.projectId === project.id) : [], project.id, assets));
  }
  if(assetFiles.length!==(data.localToolAssetFiles?.length??0))throw Error('local_asset_import_scope_invalid');
  if (annotations.length !== (data.annotations?.length ?? 0) || annotationReferences.length !== (data.annotationReferences?.length ?? 0)) throw Error('annotation_import_scope_invalid');
  // An older full JSON may carry era assets but predate Base history. Keep
  // retained history's binary references valid when that legacy asset table is replaced.
  const retainedHistory: DocumentHistoryEntry[] = [];
  if (!Array.isArray(data.documentHistory) && Array.isArray(data.worldEraAssets)) {
    const owners = new Set(data.projects?.map(project => project.id));
    for (const entry of await db.documentHistory.toArray()) if (owners.has(entry.projectId)) {
      const ids = new Map<string,string>();
      for (const id of entry.assetIds) {
        const original = await db.worldEraAssets.get(id); if (!original) throw Error('document_history_asset_missing');
        let asset = eraAssets.find(row => row.projectId === original.projectId && row.sha256 === original.sha256);
        if (!asset) { asset = { ...original, id: eraAssets.some(row => row.id === original.id) ? crypto.randomUUID() : original.id }; eraAssets.push(asset); }
        ids.set(id,asset.id);
      }
      const rewrite = (value:unknown):unknown => value instanceof Blob ? value : Array.isArray(value) ? value.map(rewrite) : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).map(([key,child])=>[key,(key==='__worldEraAssetId'||key==='__documentHistoryAsset')&&typeof child==='string'?ids.get(child)??child:rewrite(child)])) : value;
      retainedHistory.push({...entry,assetIds:entry.assetIds.map(id=>ids.get(id)!),document:rewrite(entry.document) as DocumentHistoryEntry['document']});
    }
  }
  const toClear = new Set<string>();
  for (const [key, tableName] of Object.entries(LEGACY_FULL_EXPORT_TABLES)) {
    if (!Array.isArray(payload[key])) continue;
    toClear.add(tableName);
    for (const child of LEGACY_CHILD_TABLES[tableName] ?? []) toClear.add(child);
  }

  await db.transaction('rw', db.tables, async () => {
    suppressDocumentHistoryForTransaction();
    const restoredProjects = await Promise.all((data.projects ?? []).map(async project => preserveLegacyProjectMetadata(project, await db.projects.get(project.id))));
    const [previousWritings,previousVariants,previousArchives]=await Promise.all([db.writings.toArray(),db.worldEraVariants.toArray(),db.documentArchives.toArray()]);
    const previousOwners=new Map(restoredProjects.map(project=>[project.id,structuralManuscriptOwners(previousWritings.filter(row=>row.projectId===project.id),previousVariants.filter(row=>row.projectId===project.id),previousArchives.filter(row=>row.projectId===project.id))]));
    const restoredWritings = (data.writings??[]).map(writing=>{const existing=previousWritings.find(row=>row.id===writing.id&&row.projectId===writing.projectId);return preserveLegacyWritingToolDock(writing,existing,previousOwners.get(writing.projectId)?.get(writing.id));});
    const restoredVariants = eraVariants.map(row=>preserveLegacyEraWritingToolDock(row,previousVariants.find(previous=>previous.id===row.id),previousOwners.get(row.projectId)?.get(row.entityId)));
    for(const project of restoredProjects)validateManuscriptContents(project,restoredWritings.filter(row=>row.projectId===project.id),restoredVariants.filter(row=>row.projectId===project.id),Array.isArray(payload.publishingProfiles)?payload.publishingProfiles.filter(row=>row.projectId===project.id):[],previousArchives.filter(row=>row.projectId===project.id));
    if(restoredWritings.some(row=>row.manuscriptId&&!restoredProjects.some(project=>project.id===row.projectId)))throw Error('manuscript_project_missing');
    for (const tableName of toClear) await db.table(tableName).clear();

    // Import all data with original IDs (preserving references).
    // Legacy project metadata cannot erase an option library it never carried.
    if (restoredProjects.length) await db.projects.bulkAdd(restoredProjects);
    if (eraAssets.length) await db.worldEraAssets.bulkAdd(eraAssets);
    if (restoredVariants.length) await db.worldEraVariants.bulkAdd(restoredVariants);
    if(history.length)await db.documentHistory.bulkAdd(history);
    if (annotations.length) await db.annotations.bulkAdd(annotations);
    if (annotationReferences.length) await db.annotationReferences.bulkAdd(annotationReferences);
    if(retainedHistory.length)await db.documentHistory.bulkPut(retainedHistory);
    if(manuscriptSources.length)await db.manuscriptSources.bulkAdd(manuscriptSources);
    if(assetFiles.length)await db.localToolAssetFiles.bulkAdd(assetFiles);
    if(media.length)await db.localMediaAssets.bulkAdd(media);
    for(const name of ['scenes','sceneCasts','dialogBlocks','notes','generatedWorlds','worldWaypoints','writingSnapshots','timelineConnections'] as const){const rows=data[name];if(rows?.length)await db.table(name).bulkAdd(rows);}
    if (data.codexEntries?.length) await db.codexEntries.bulkAdd(data.codexEntries);
    if (restoredWritings.length) await db.writings.bulkAdd(restoredWritings);
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
      // The v21 upgrade kept each link's id, so a link in an old file can
      // already live here as a snapshot the writer has since captured, noted
      // or retagged. Saved links are the one irreplaceable table: add the
      // missing ones, never overwrite a live row with its bare legacy copy.
      const incoming = data.externalLinks.map(legacyLinkToSnapshot);
      const existing = new Set(
        await db.snapshots.where('id').anyOf(incoming.map((snapshot) => snapshot.id)).primaryKeys(),
      );
      const missing = incoming.filter((snapshot) => !existing.has(snapshot.id));
      if (missing.length) await db.snapshots.bulkPut(missing);
    }
    if (data.tags?.length) await db.tags.bulkAdd(data.tags);
    if (data.settings?.length) await db.settings.bulkAdd(data.settings);
  });
}
