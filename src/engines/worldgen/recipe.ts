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
}

export class WorldRecipeConflict extends Error {
  constructor() { super('World changed while generating'); this.name = 'WorldRecipeConflict'; }
}

export async function prepareRegeneration(worldId: string, params: WorldParams, locations: LocationPolicy): Promise<RegenerationPlan> {
  return db.transaction('r', [db.generatedWorlds, db.worldWaypoints], async () => {
    const base = await db.generatedWorlds.get(worldId);
    if (!base) throw new WorldRecipeConflict();
    return { base, waypoints: await db.worldWaypoints.where('worldId').equals(worldId).toArray(), params: normalizeParams({ ...params, drainageVersion: DEFAULT_PARAMS.drainageVersion, hydrologyVersion: DEFAULT_PARAMS.hydrologyVersion }), locations };
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
  const result = await db.transaction('rw', [db.generatedWorlds, db.worldWaypoints], async () => {
    const current = await db.generatedWorlds.get(plan.base.id);
    if (!current || recipeKey(current) !== recipeKey(plan.base)) throw new WorldRecipeConflict();
    if (plan.locations === 'clear') {
      const pins = await db.worldWaypoints.where('worldId').equals(current.id).toArray();
      if (JSON.stringify(pins) !== JSON.stringify(plan.waypoints)) throw new WorldRecipeConflict();
      await db.worldWaypoints.where('worldId').equals(current.id).delete();
    }
    const updated: GeneratedWorld = {
      ...current, params: plan.params, edits: freshWorldEdits(), thumbnail: undefined,
      regions: plan.locations === 'clear' ? [] : rescaleRegions(current.regions ?? [], current.params.width, plan.params.width),
      updatedAt: Date.now(),
    };
    await db.generatedWorlds.put(updated);
    return updated;
  });
  notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: result.id, projectId: result.projectId });
  return result;
}

/** A terrain alternative owns its recipe; the original and its authored places stay intact. */
export async function createWorldAlternative(worldId: string, params: WorldParams, title: string): Promise<GeneratedWorld> {
  const result = await db.transaction('rw', db.generatedWorlds, async () => {
    const source = await db.generatedWorlds.get(worldId);
    if (!source) throw new WorldRecipeConflict();
    const now = Date.now();
    const alternative: GeneratedWorld = {
      id: generateId('world'), projectId: source.projectId, title: title.trim() || source.title,
      params: normalizeParams({ ...params, drainageVersion: DEFAULT_PARAMS.drainageVersion, hydrologyVersion: DEFAULT_PARAMS.hydrologyVersion }), edits: freshWorldEdits(), regions: [],
      originWorldId: source.id, createdAt: now, updatedAt: now,
    };
    await db.generatedWorlds.add(alternative);
    return alternative;
  });
  notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: result.id, projectId: result.projectId });
  return result;
}

export async function prepareWorldRecalculation(worldId: string, projectId: string): Promise<GeneratedWorld> {
  const current = await db.generatedWorlds.get(worldId);
  if (!current || current.projectId !== projectId) throw new WorldRecipeConflict();
  return current;
}

/** A derived-environment checkpoint is an edit; keep all unrelated authored fields. */
export async function commitWorldRecalculation(base: GeneratedWorld, edits: string): Promise<void> {
  await db.transaction('rw', db.generatedWorlds, async () => {
    const current = await db.generatedWorlds.get(base.id);
    if (!current || current.projectId !== base.projectId || JSON.stringify(current.params) !== JSON.stringify(base.params) || current.edits !== base.edits) throw new WorldRecipeConflict();
    await db.generatedWorlds.update(base.id, { edits, updatedAt: Date.now() });
  });
  notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: base.id, projectId: base.projectId });
}
