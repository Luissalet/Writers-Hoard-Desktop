import { resolveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import { worldEraToolScope } from '@/services/worldEras/toolScope';
import { assertEngineEnabled, assertRowInScope, BridgeError, optEnum, optString, requireString, type ToolArgs, withAudit } from '@/services/aiBridge/tools/shared';
import { generateId } from '@/utils/idGenerator';
import { worldgenScopeOperations } from '../era';
import { exportPlate } from './export';
import { findOrigin, mapOrigins } from './knowledge';
import { insertMapPlate } from './manuscript';
import { openCartographerSource, plateForMap } from './source';
import { changeInWorldMap, defaultMapCalendars, InWorldMapError, type MapChange, validateInWorldMap } from './store';
import { PLATE_FORMATS, type InWorldMap } from './types';

async function worldContext(args: ToolArgs, writes = false) {
  const projectId = optString(args, 'projectId');
  if (projectId) {
    assertRowInScope(args, projectId);
    if (writes) await assertEngineEnabled(projectId, 'worldgen');
  }
  const worldId = requireString(args, 'worldId');
  const requested = worldEraToolScope(args);
  const row = await worldgenScopeOperations(requested).worlds.getOne(worldId);
  if (!row) throw new BridgeError('not-found', 'No generated world with that ID.');
  assertRowInScope(args, row.projectId);
  if (projectId && projectId !== row.projectId) throw new BridgeError('scope', 'The world belongs to a different project.');
  if (!projectId && writes) await assertEngineEnabled(row.projectId, 'worldgen');
  return { worldId, row, scope: { projectId: row.projectId, eraId: requested?.eraId } };
}

async function readMap(args: ToolArgs, writes = false) {
  const ctx = await worldContext(args, writes);
  const id = requireString(args, 'mapId');
  const map = ctx.row.inWorldMaps?.find(plate => plate.id === id);
  if (!map) throw new BridgeError('not-found', 'No map with that ID in this world.');
  return { ...ctx, map };
}

function plateError(error: unknown): never {
  if (error instanceof InWorldMapError) throw new BridgeError(error.code, error.message);
  throw error;
}

function dateCalendar(projectId: string, eraId: string | undefined, locale: 'es' | 'en') {
  return resolveWorldCalendar(projectId, undefined, eraId).then(result => result?.calendar ?? defaultMapCalendars[locale]);
}

function auditedMapChange(scope: { projectId: string }, worldId: string, change: MapChange) {
  return withAudit({ worldId, map: change.after, mapId: change.id }, {
    projectId: scope.projectId, entityId: worldId, table: 'generatedWorlds', kind: 'update',
    summary: change.after ? 'saved an in-world map' : 'removed an in-world map', before: { __inWorldMap: change },
  });
}

async function whListInWorldMaps(args: ToolArgs) {
  const { row, worldId } = await worldContext(args);
  return { worldId, maps: row.inWorldMaps ?? [] };
}

async function whListCartographers(args: ToolArgs) {
  const { row, scope, worldId } = await worldContext(args);
  const opened = await openCartographerSource(row, scope);
  if (!opened.ok) return { worldId, pending: true, code: opened.code, message: opened.message };
  return { worldId, origins: mapOrigins(opened.source.world).map(({ key, name, at, placeName }) => ({
    ...key, name, place: placeName, x: at.x, y: at.y,
  })) };
}

async function whSaveInWorldMap(args: ToolArgs) {
  const { row, scope, worldId } = await worldContext(args, true);
  const id = optString(args, 'mapId') ?? generateId('inworld-map');
  const before = row.inWorldMaps?.find(map => map.id === id) ?? null;
  if (args.mapId !== undefined && !before) throw new BridgeError('not-found', 'No map with that ID in this world.');
  if (!before && !['title', 'origin', 'date'].every(key => args[key] !== undefined)) {
    throw new BridgeError('bad-args', 'A new map requires title, origin and date.');
  }
  const pick = <T>(key: string, base: T): T => args[key] === undefined ? base : args[key] as T;
  const after: InWorldMap = {
    id, title: pick('title', before?.title ?? ''), origin: pick('origin', before?.origin as InWorldMap['origin']),
    date: pick('date', before?.date as InWorldMap['date']), reach: pick('reach', before?.reach ?? 0.11),
    distortion: pick('distortion', before?.distortion ?? 0.65),
    themeId: pick('themeId', before?.themeId ?? row.presentation?.theme ?? 'antique'),
    chapter: pick('chapter', before?.chapter) ?? undefined,
    entryId: pick('entryId', before?.entryId) ?? undefined, marks: pick('marks', before?.marks ?? []),
  };
  try {
    validateInWorldMap(after, await dateCalendar(scope.projectId, scope.eraId, 'en'));
    after.title = after.title.trim();
    if (!before || before.origin.id !== after.origin.id || before.origin.kind !== after.origin.kind) {
      const opened = await openCartographerSource(row, scope);
      if (!opened.ok) return { worldId, pending: true, code: opened.code, message: opened.message };
      if (!findOrigin(opened.source.world, after.origin)) throw new InWorldMapError('bad-args', 'Choose an origin from wh_list_cartographers.');
    }
    const change = { id, before, after };
    await changeInWorldMap(scope, worldId, change);
    return auditedMapChange(scope, worldId, change);
  } catch (error) { return plateError(error); }
}

async function whRemoveInWorldMap(args: ToolArgs) {
  const { scope, worldId, map } = await readMap(args, true);
  const change = { id: map.id, before: map, after: null };
  try {
    await changeInWorldMap(scope, worldId, change);
    return auditedMapChange(scope, worldId, change);
  } catch (error) { return plateError(error); }
}

async function renderSavedMap(args: ToolArgs, writes = false) {
  const ctx = await readMap(args, writes);
  const opened = await openCartographerSource(ctx.row, ctx.scope);
  if (!opened.ok) return { ok: false as const, pending: { worldId: ctx.worldId, pending: true, code: opened.code, message: opened.message } };
  const locale = optEnum(args, 'locale', ['es', 'en']) ?? 'en';
  const calendar = await dateCalendar(ctx.scope.projectId, ctx.scope.eraId, locale);
  try {
    validateInWorldMap(ctx.map, calendar);
    return { ok: true as const, ...ctx, plate: plateForMap(opened.source, ctx.map, calendar, locale) };
  } catch (error) { return plateError(error); }
}

async function whExportInWorldMap(args: ToolArgs) {
  const format = optEnum(args, 'format', PLATE_FORMATS);
  if (!format) throw new BridgeError('bad-args', 'Choose png, svg or pdf.');
  const rendered = await renderSavedMap(args);
  if (!rendered.ok) return rendered.pending;
  const { blob, filename } = await exportPlate(rendered.plate, rendered.map.title, format);
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { worldId: rendered.worldId, mapId: rendered.map.id, filename, mime: blob.type, bytes: blob.size, base64,
    knowledge: rendered.plate.shares, tradeRoutes: rendered.plate.routeCount, places: rendered.plate.names };
}

async function whInsertInWorldMap(args: ToolArgs) {
  const rendered = await renderSavedMap(args, true);
  if (!rendered.ok) return rendered.pending;
  return insertMapPlate({ ...args, ...rendered.scope }, rendered.scope.projectId, requireString(args, 'writingId'), rendered.map.title, rendered.plate);
}

export const IN_WORLD_MAP_HANDLERS = {
  wh_list_in_world_maps: whListInWorldMaps,
  wh_list_cartographers: whListCartographers,
  wh_save_in_world_map: whSaveInWorldMap,
  wh_export_in_world_map: whExportInWorldMap,
  wh_insert_in_world_map: whInsertInWorldMap,
  wh_remove_in_world_map: whRemoveInWorldMap,
};
