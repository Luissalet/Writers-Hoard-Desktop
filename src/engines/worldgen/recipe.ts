import type { WorldEraScope } from '@/services/worldEras/types';
import { worldgenScopeOperations } from './era';
import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { generateId } from '@/utils/idGenerator';
import { DEFAULT_PARAMS, normalizeParams, type WorldParams } from './core/types';
import { serializeEdits } from './core/edits';
import type { GeneratedWorld, SavedWorldRegion, WorldWaypoint } from './types';

export type LocationPolicy = 'keep' | 'clear';
export const freshWorldEdits = () => serializeEdits([{ kind: 'placesEverywhere', enabled: false }]);

export interface RegenerationPlan {
  base: GeneratedWorld;
  waypoints: WorldWaypoint[];
  params: WorldParams;
  locations: LocationPolicy;
  scope?: WorldEraScope;
}

export class WorldRecipeConflict extends Error {
  constructor() { super('World changed while generating'); this.name = 'WorldRecipeConflict'; }
}

export async function prepareRegeneration(worldId: string, params: WorldParams, locations: LocationPolicy, scope?: WorldEraScope): Promise<RegenerationPlan> {
  const { worlds, waypoints } = worldgenScopeOperations(scope);
  return db.transaction('r', scope?.eraId ? db.tables : [db.generatedWorlds, db.worldWaypoints], async () => {
    const base = await worlds.getOne(worldId);
    if (!base) throw new WorldRecipeConflict();
    return { base, scope, waypoints: await waypoints.getAll(worldId), params: normalizeParams({ ...params, drainageVersion: DEFAULT_PARAMS.drainageVersion, hydrologyVersion: DEFAULT_PARAMS.hydrologyVersion }), locations };
  });
}

/** Bookmarks retain latitude/longitude when the generation grid changes. */
export function rescaleRegions(regions: SavedWorldRegion[], oldWidth: number, newWidth: number): SavedWorldRegion[] {
  const factor = newWidth / Math.max(1, oldWidth);
  return regions.map(region => ({ ...region, x: region.x * factor, y: region.y * factor }));
}

const recipeKey = (world: GeneratedWorld) => JSON.stringify([world.projectId, world.params, world.edits, world.regions]);

/** Publish one complete recipe. A failure leaves terrain, edits and locations together. */
export async function commitRegeneration(plan: RegenerationPlan): Promise<GeneratedWorld> {
  const { worlds, waypoints } = worldgenScopeOperations(plan.scope);
  const result = await db.transaction('rw', plan.scope?.eraId ? db.tables : [db.generatedWorlds, db.worldWaypoints], async () => {
    const current = await worlds.getOne(plan.base.id);
    if (!current || recipeKey(current) !== recipeKey(plan.base)) throw new WorldRecipeConflict();
    if (plan.locations === 'clear') {
      const pins = await waypoints.getAll(current.id);
      if (JSON.stringify(pins) !== JSON.stringify(plan.waypoints)) throw new WorldRecipeConflict();
      for (const pin of pins) await waypoints.delete(pin.id);
    }
    const updated: GeneratedWorld = {
      ...current, params: plan.params, edits: freshWorldEdits(), thumbnail: undefined,
      regions: plan.locations === 'clear' ? [] : rescaleRegions(current.regions ?? [], current.params.width, plan.params.width),
      updatedAt: Date.now(),
    };
    if (plan.scope?.eraId) await worlds.update(updated.id, updated); else await db.generatedWorlds.put(updated);
    return updated;
  });
  notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: result.id, projectId: result.projectId });
  return result;
}

/** A terrain alternative owns its recipe; the original and its authored places stay intact. */
export async function createWorldAlternative(worldId: string, params: WorldParams, title: string, scope?: WorldEraScope): Promise<GeneratedWorld> {
  const { worlds } = worldgenScopeOperations(scope);
  const result = await db.transaction('rw', scope?.eraId ? db.tables : [db.generatedWorlds], async () => {
    const source = await worlds.getOne(worldId);
    if (!source) throw new WorldRecipeConflict();
    const now = Date.now();
    const alternative: GeneratedWorld = {
      id: generateId('world'), projectId: source.projectId, title: title.trim() || source.title,
      params: normalizeParams({ ...params, drainageVersion: DEFAULT_PARAMS.drainageVersion, hydrologyVersion: DEFAULT_PARAMS.hydrologyVersion }), edits: freshWorldEdits(), regions: [],
      originWorldId: source.id, createdAt: now, updatedAt: now,
    };
    await worlds.create(alternative);
    return alternative;
  });
  notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: result.id, projectId: result.projectId });
  return result;
}

export async function prepareWorldRecalculation(worldId: string, projectId: string, eraId?: string): Promise<GeneratedWorld> {
  const current = await worldgenScopeOperations({ projectId, eraId }).worlds.getOne(worldId);
  if (!current || current.projectId !== projectId) throw new WorldRecipeConflict();
  return current;
}

/** A derived-environment checkpoint is an edit; keep all unrelated authored fields. */
export async function commitWorldRecalculation(base: GeneratedWorld, edits: string, eraId?: string): Promise<void> {
  const { worlds } = worldgenScopeOperations({ projectId: base.projectId, eraId });
  await db.transaction('rw', eraId ? db.tables : [db.generatedWorlds], async () => {
    const current = await worlds.getOne(base.id);
    if (!current || current.projectId !== base.projectId || JSON.stringify(current.params) !== JSON.stringify(base.params) || current.edits !== base.edits) throw new WorldRecipeConflict();
    await worlds.update(base.id, { edits, updatedAt: Date.now() });
  });
  notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: base.id, projectId: base.projectId });
}
