import { listEraRows, readEraRow, mutateEraRows } from '@/services/worldEras/store';
import type { EraRow, WorldEraScope } from '@/services/worldEras/types';
import { makeTableOps } from '@/engines/_shared';
import type { WorldMap, MapPin, MapVersion, MapFeature } from '@/types';
import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { trackPendingWrite } from '@/services/pendingWrites';
import { remapMapContent, remapPoint, type GroundFitMode, type GroundSize } from '@/components/maps/mapGround';

export const worldMapOps = makeTableOps<WorldMap>({
  tableName: 'worldMaps',
  scopeField: 'projectId',
});

export const mapPinOps = makeTableOps<MapPin>({
  tableName: 'mapPins',
  scopeField: 'mapId',
});

/** `eventId` links the era to a timeline event; null unlinks it; absent leaves the link as it is. */
export interface MapVersionMetadata { name: string; date: string; description?: string; eventId?: string | null }

function makeVersion(map: WorldMap, pins: MapPin[], metadata: MapVersionMetadata): MapVersion {
  if (!metadata.name.trim()) throw new Error('Map version needs a name');
  return {
    id: generateId('map-version'), name: metadata.name.trim(), date: metadata.date.trim(), description: metadata.description?.trim(), createdAt: Date.now(),
    ...(metadata.eventId ? { timelineEventId: metadata.eventId } : {}),
    backgroundImage: map.backgroundImage, features: map.features ?? [], pins, layers: map.layers,
    layerVisibility: map.layerVisibility, source: map.source, sourceWorldId: map.sourceWorldId, sourceRevision: map.sourceRevision,
  };
}

async function runMapVersionWrite<T>(mapId: string, action: (map: WorldMap) => Promise<T>, scope?: WorldEraScope): Promise<T> {
  const write = db.transaction('rw', db.tables, async () => {
    const map = scope?.eraId ? await readEraRow<WorldMap>(scope, 'worldMaps', mapId) : await db.worldMaps.get(mapId);
    if (!map) throw new Error('Map no longer exists');
    return { result: await action(map), projectId: map.projectId };
  });
  const outcome = await trackPendingWrite(write, undefined, `map-versions:${mapId}`);
  notifyDataChanged({ source: 'other', projectId: outcome.projectId });
  return outcome.result;
}

/** Reads map + marker rows in one transaction; only saved content is captured. */
export function captureMapVersion(mapId: string, metadata: MapVersionMetadata, scope?: WorldEraScope): Promise<string> {
  return runMapVersionWrite(mapId, async map => {
    const version = makeVersion(map, await scopedPins(mapId, scope), metadata);
    await scopedMapUpdate(mapId, scope, { versions: [...(map.versions ?? []), version], updatedAt: Date.now() });
    return version.id;
  }, scope);
}

export interface ChangeGroundInput {
  /** The new background image (data URL). */
  image: string;
  /** Size of the image being replaced; null when the map had none (nothing to save or move). */
  oldSize: GroundSize | null;
  newSize: GroundSize;
  mode: GroundFitMode;
  /** Name of the safety era saved first. */
  versionName: string;
}

/** What a ground change did, enough for an undo that refuses if anything changed since. */
export interface GroundChangeReceipt {
  mapId: string;
  versionId: string;
  imageLength: number;
  imageHash: string;
  afterFeatures: MapFeature[];
  afterPins: { id: string; x: number; y: number }[];
  /** Comments left at a spot on the map, where they were and where they went. */
  notes?: { id: string; before: { x: number; y: number }; after: { x: number; y: number } }[];
  /** When the change was made: comments placed on the new picture after it stop an undo. */
  at?: number;
  /** The safety era's name; renamed by the author, it is kept on undo. */
  versionName?: string;
}

/**
 * Comments pinned to a spot on this map that see the picture being changed:
 * those of the context being edited, and, when Shared base changes, those of
 * eras that still inherit this map from it (they get the new picture too).
 */
async function mapPointNotes(mapId: string, scope?: WorldEraScope) {
  const rows = (await db.annotations.where('[sourceEngineId+sourceEntityId]').equals(['maps', mapId]).toArray())
    .filter(row => row.anchor.type === 'map_point' && Number.isFinite(row.anchor.x) && Number.isFinite(row.anchor.y));
  const inherits = new Map<string, boolean>();
  const result = [];
  for (const row of rows) {
    const era = row.eraId ?? undefined;
    if (era === (scope?.eraId ?? undefined)) { result.push(row); continue; }
    if (scope?.eraId || !era) continue;
    // An era inherits the map while it has no live variant of its own.
    if (!inherits.has(era)) inherits.set(era, !(await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([row.projectId, era, 'maps', mapId]).toArray()).some(variant => !variant.archived));
    if (inherits.get(era)) result.push(row);
  }
  return result;
}

/** Cheap fingerprint of a (large) image string; with its length it tells "still the image we set". */
export function hashImage(image: string | undefined): string {
  let hash = 0x811c9dc5;
  const text = image ?? '';
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16);
}

/**
 * Replace the ground image in one transaction: save the map as an era first
 * (the same snapshot a manual "save era" takes), then set the image and, when
 * the shapes are to keep their proportions, move every shape and pin.
 */
export function changeMapGround(mapId: string, input: ChangeGroundInput, scope?: WorldEraScope): Promise<GroundChangeReceipt> {
  return runMapVersionWrite(mapId, async map => {
    const pins = await scopedPins(mapId, scope);
    const first = !map.backgroundImage;
    const version = first ? undefined : makeVersion(map, pins, { name: input.versionName, date: '' });
    const changed = !first && !!input.oldSize && input.mode === 'keep';
    const moved = changed ? remapMapContent({ features: map.features ?? [], pins }, input.oldSize!, input.newSize, 'keep') : { features: map.features ?? [], pins };
    const notes: NonNullable<GroundChangeReceipt['notes']> = [];
    if (changed) {
      if (scope?.eraId) await mutateEraRows(scope, moved.pins.map(pin => ({ table: 'mapPins', id: pin.id, changes: { position: pin.position } })));
      else for (const pin of moved.pins) await db.mapPins.update(pin.id, { position: pin.position });
      // Comments at a spot move with the picture like pins do.
      for (const note of await mapPointNotes(mapId, scope)) {
        const before = { x: note.anchor.x!, y: note.anchor.y! }, after = remapPoint(before, input.oldSize!, input.newSize, 'keep');
        // A new revision, so an older move's undo receipt no longer applies to the new picture.
        await db.annotations.update(note.id, { anchor: { ...note.anchor, ...after }, revision: (note.revision ?? 0) + 1, updatedAt: Math.max(Date.now(), note.updatedAt + 1) });
        notes.push({ id: note.id, before, after });
      }
    }
    await scopedMapUpdate(mapId, scope, {
      backgroundImage: input.image, source: 'uploaded', sourceWorldId: undefined, sourceRevision: undefined,
      ...(changed && map.features ? { features: moved.features } : {}),
      ...(version ? { versions: [...(map.versions ?? []), version] } : {}), updatedAt: Date.now(),
    });
    return {
      mapId, versionId: version?.id ?? '', imageLength: input.image.length, imageHash: hashImage(input.image),
      afterFeatures: moved.features, afterPins: moved.pins.map(pin => ({ id: pin.id, x: pin.position.x, y: pin.position.y })),
      ...(notes.length ? { notes } : {}), at: Date.now(), versionName: version?.name,
    };
  }, scope);
}

/**
 * Take a ground change back from the era it saved: image, shapes and pin
 * positions return, and the safety era goes. Refuses when the image, the shapes
 * or the pins were changed after the change.
 */
export function undoMapGround(receipt: GroundChangeReceipt, scope?: WorldEraScope): Promise<void> {
  return runMapVersionWrite(receipt.mapId, async map => {
    const version = receipt.versionId ? map.versions?.find(item => item.id === receipt.versionId) : undefined;
    if (receipt.versionId && !version) throw new Error('The era saved before the change no longer exists');
    if (!map.backgroundImage || map.backgroundImage.length !== receipt.imageLength || hashImage(map.backgroundImage) !== receipt.imageHash) throw new Error('The ground image changed after this edit');
    if (JSON.stringify(map.features ?? []) !== JSON.stringify(receipt.afterFeatures)) throw new Error('The shapes on this map changed after this edit');
    const pins = await scopedPins(receipt.mapId, scope);
    const expected = new Map(receipt.afterPins.map(pin => [pin.id, pin]));
    if (pins.some(pin => { const was = expected.get(pin.id); return !was || was.x !== pin.position.x || was.y !== pin.position.y; }) || pins.length !== expected.size) throw new Error('The pins on this map changed after this edit');
    // A comment placed on the new picture after the change would land in the wrong spot on the old one.
    if (receipt.at !== undefined && (await mapPointNotes(receipt.mapId, scope)).some(row => row.createdAt > receipt.at! && !receipt.notes?.some(note => note.id === row.id))) throw new Error('A comment was placed on the new picture after this edit');
    // Comments go back only where nobody has moved them since; one deleted meanwhile is simply gone.
    for (const note of receipt.notes ?? []) {
      const row = await db.annotations.get(note.id);
      if (row?.anchor.type === 'map_point' && row.anchor.x === note.after.x && row.anchor.y === note.after.y) await db.annotations.update(note.id, { anchor: { ...row.anchor, ...note.before }, revision: (row.revision ?? 0) + 1, updatedAt: Math.max(Date.now(), row.updatedAt + 1) });
    }
    const before = new Map((version?.pins ?? []).map(pin => [pin.id, pin.position]));
    const restore = pins.filter(pin => before.has(pin.id));
    if (scope?.eraId) await mutateEraRows(scope, restore.map(pin => ({ table: 'mapPins', id: pin.id, changes: { position: before.get(pin.id) } })));
    else for (const pin of restore) await db.mapPins.update(pin.id, { position: before.get(pin.id)! });
    await scopedMapUpdate(receipt.mapId, scope, {
      backgroundImage: version?.backgroundImage, ...(version ? { features: version.features } : {}), source: version?.source, sourceWorldId: version?.sourceWorldId, sourceRevision: version?.sourceRevision,
      versions: (map.versions ?? []).filter(item => item.id !== receipt.versionId || (receipt.versionName !== undefined && item.name !== receipt.versionName)), updatedAt: Date.now(),
    });
  }, scope);
}

export function updateMapVersion(mapId: string, versionId: string, metadata: MapVersionMetadata, scope?: WorldEraScope): Promise<void> {
  return runMapVersionWrite(mapId, async map => {
    if (!metadata.name.trim() || !map.versions?.some(version => version.id === versionId)) throw new Error('Invalid map version');
    await scopedMapUpdate(mapId, scope, { versions: map.versions.map(version => {
      if (version.id !== versionId) return version;
      const next: MapVersion = { ...version, name: metadata.name.trim(), date: metadata.date.trim(), description: metadata.description?.trim() };
      if (metadata.eventId === null) delete next.timelineEventId;
      else if (metadata.eventId) next.timelineEventId = metadata.eventId;
      return next;
    }), updatedAt: Date.now() });
  }, scope);
}

/** What an era says about itself; undo of a capture refuses once any of it was changed. */
export function mapVersionFingerprint(version: Pick<MapVersion, 'name' | 'date' | 'description' | 'timelineEventId'>): string {
  return JSON.stringify([version.name, version.date, version.description ?? '', version.timelineEventId ?? null]);
}

export function deleteMapVersion(mapId: string, versionId: string, scope?: WorldEraScope, expectedFingerprint?: string): Promise<void> {
  return runMapVersionWrite(mapId, async map => {
    const version = map.versions?.find(item => item.id === versionId);
    if (expectedFingerprint !== undefined && version && mapVersionFingerprint(version) !== expectedFingerprint) throw new Error('Map version changed since it was saved');
    await scopedMapUpdate(mapId, scope, { versions: (map.versions ?? []).filter(version => version.id !== versionId), updatedAt: Date.now() });
  }, scope);
}

/** Full restore is atomic. A safety snapshot makes the displaced present recoverable. */
export function restoreMapVersion(mapId: string, versionId: string, recoveryName: string, scope?: WorldEraScope): Promise<void> {
  return runMapVersionWrite(mapId, async map => {
    const version = map.versions?.find(item => item.id === versionId);
    if (!version) throw new Error('Map version no longer exists');
    const currentPins = await scopedPins(mapId, scope);
    const recovery = makeVersion(map, currentPins, { name: recoveryName, date: '' });
    const pins: MapPin[] = [];
    const ids = new Set<string>();
    for (const pin of version.pins) {
      const owner = await (scope?.eraId ? readEraRow<MapPin>(scope, 'mapPins', pin.id) : db.mapPins.get(pin.id));
      let id = owner && (owner.mapId !== mapId || owner.projectId !== map.projectId) ? generateId('pin') : pin.id;
      if (ids.has(id)) id = generateId('pin');
      ids.add(id);
      pins.push({ ...pin, id, mapId, projectId: map.projectId });
    }
    if (scope?.eraId) await mutateEraRows(scope, [...currentPins.map(pin => ({ table: 'mapPins', id: pin.id, remove: true })), ...pins.map(pin => ({ table: 'mapPins', id: pin.id, row: pin as unknown as EraRow }))]);
    else { await db.mapPins.where('mapId').equals(mapId).delete(); if (pins.length) await db.mapPins.bulkAdd(pins); }
    await scopedMapUpdate(mapId, scope, {
      backgroundImage: version.backgroundImage, features: version.features, layers: version.layers,
      layerVisibility: version.layerVisibility, source: version.source ?? (version.backgroundImage ? 'uploaded' : undefined),
      sourceWorldId: version.sourceWorldId, sourceRevision: version.sourceRevision,
      versions: [...(map.versions ?? []), recovery], updatedAt: Date.now(),
    });
  }, scope);
}

async function scopedPins(mapId: string, scope?: WorldEraScope): Promise<MapPin[]> { return scope?.eraId ? (await listEraRows<MapPin>(scope, 'mapPins')).filter(pin => pin.mapId === mapId) : db.mapPins.where('mapId').equals(mapId).toArray(); }
async function scopedMapUpdate(mapId: string, scope: WorldEraScope | undefined, changes: Partial<WorldMap>): Promise<void> { if (scope?.eraId) await mutateEraRows(scope, [{ table: 'worldMaps', id: mapId, changes }]); else await db.worldMaps.update(mapId, changes); }

/**
 * Link or unlink one era to a timeline event. With `expected`, the change only
 * happens while the era still has that link — an undo cannot overwrite a newer
 * choice. Returns the link it replaced.
 */
/**
 * Link an era to an event (or unlink with null) and return the previous link.
 * `stampDate` gives an undated era the moment's date, so it still reads right
 * if the event is deleted; `clearDate` takes that stamp back on undo.
 */
export function linkMapVersion(mapId: string, versionId: string, eventId: string | null, scope?: WorldEraScope, expected?: string | null, dates: { stampDate?: string; clearDate?: string } = {}): Promise<string | null> {
  return runMapVersionWrite(mapId, async map => {
    const version = map.versions?.find(item => item.id === versionId);
    if (!version) throw new Error('Map version no longer exists');
    const previous = version.timelineEventId ?? null;
    if (expected !== undefined && previous !== expected) throw new Error('Map version link changed since');
    const stamp = !!dates.stampDate && !version.date.trim();
    const clear = !!dates.clearDate && version.date === dates.clearDate;
    if (previous === eventId && !stamp && !clear) return previous;
    await scopedMapUpdate(mapId, scope, { versions: map.versions!.map(item => {
      if (item.id !== versionId) return item;
      const next: MapVersion = { ...item };
      if (stamp) next.date = dates.stampDate!;
      if (clear) next.date = '';
      if (eventId) next.timelineEventId = eventId; else delete next.timelineEventId;
      return next;
    }), updatedAt: Date.now() });
    return previous;
  }, scope);
}

// ---------------------------------------------------------------------------
// Scale and pin names (bridge): every change keeps enough to be taken back only while it still stands
// ---------------------------------------------------------------------------

/** A map's scale before and after; `null` is "no scale". */
export interface MapScaleReceipt { mapId: string; from: number | null; to: number | null }

/** Set (or with null remove) the kilometres the picture spans left to right; returns the scale it replaced. */
export function setMapScale(mapId: string, widthKm: number | null, scope?: WorldEraScope): Promise<number | null> {
  return runMapVersionWrite(mapId, async map => {
    const previous = map.widthKm ?? null;
    await scopedMapUpdate(mapId, scope, { widthKm: widthKm ?? undefined, updatedAt: Date.now() });
    return previous;
  }, scope);
}

/** Put the previous scale back; refuses when the scale is no longer the one the change set. */
export function undoMapScale(receipt: MapScaleReceipt, scope?: WorldEraScope): Promise<void> {
  return runMapVersionWrite(receipt.mapId, async map => {
    if ((map.widthKm ?? null) !== receipt.to) throw new Error('The scale of this map changed after this edit');
    await scopedMapUpdate(receipt.mapId, scope, { widthKm: receipt.from ?? undefined, updatedAt: Date.now() });
  }, scope);
}

export interface MapPinRename { pinId: string; from: string; to: string }

async function applyPinNames(mapId: string, changes: MapPinRename[], scope?: WorldEraScope): Promise<MapPinRename[]> {
  return runMapVersionWrite(mapId, async () => {
    const pins = new Map((await scopedPins(mapId, scope)).map(pin => [pin.id, pin]));
    const applied = changes.filter(change => pins.get(change.pinId)?.name === change.from);
    if (scope?.eraId) await mutateEraRows(scope, applied.map(change => ({ table: 'mapPins', id: change.pinId, changes: { name: change.to } })));
    else for (const change of applied) await db.mapPins.update(change.pinId, { name: change.to });
    return applied;
  }, scope);
}

/** Rename pins, each only while it still has the name it was read with; returns the renames that happened. */
export function renameMapPins(mapId: string, renames: MapPinRename[], scope?: WorldEraScope): Promise<MapPinRename[]> {
  return applyPinNames(mapId, renames, scope);
}

/** Give each pin its old name back, only where it still has the name the rename gave it; returns those restored. */
export function undoRenameMapPins(mapId: string, renames: MapPinRename[], scope?: WorldEraScope): Promise<MapPinRename[]> {
  return applyPinNames(mapId, renames.map(rename => ({ pinId: rename.pinId, from: rename.to, to: rename.from })), scope);
}
