import type { WorldData, ProgressFn } from './types';
import { computeCurrents, nearshoreSst } from './currents';
import { computeClimate } from './climate';
import { computeHydrology } from './hydrology';
import { classifyBiomes } from './biomes';
import { detectLandmarks } from './landmarks';
import { distanceTo, localRelief } from './fields';
import { applyGlaciers } from './glaciers';

export type EnvironmentFields = Pick<WorldData, 'temperature' | 'precipitation' | 'biome' | 'flow' | 'lake' | 'rivers' | 'landmarks' | 'currentU' | 'currentV' | 'sst' | 'currentSpeed' | 'ice'> & { lakeSurface?: Float32Array };

/** Independent snapshot: restores must never mutate a checkpoint's buffers. */
export function captureEnvironment(world: EnvironmentFields): EnvironmentFields {
  return structuredClone({ temperature: world.temperature, precipitation: world.precipitation, biome: world.biome,
    flow: world.flow, lake: world.lake, lakeSurface: world.lakeSurface, rivers: world.rivers, landmarks: world.landmarks,
    currentU: world.currentU, currentV: world.currentV, sst: world.sst, currentSpeed: world.currentSpeed, ice: world.ice });
}

export function restoreEnvironment(world: WorldData, environment: EnvironmentFields): void {
  // A 2048-wide environment owns ~76 MiB. Replacing every grid during undo
  // allocates another full world before the previous buffers can be collected.
  // Keep the live world's writable buffers; snapshots remain independent.
  const floatFields = ['temperature', 'precipitation', 'flow', 'currentU', 'currentV', 'sst', 'currentSpeed', 'ice'] as const;
  for (const key of floatFields) {
    if (world[key].length === environment[key].length && world[key].buffer !== environment[key].buffer) world[key].set(environment[key]);
    else world[key] = environment[key].slice();
  }
  for (const key of ['biome', 'lake'] as const) {
    if (world[key].length === environment[key].length && world[key].buffer !== environment[key].buffer) world[key].set(environment[key]);
    else world[key] = environment[key].slice();
  }
  if (!environment.lakeSurface) world.lakeSurface = undefined;
  else if (world.lakeSurface?.length === environment.lakeSurface.length && world.lakeSurface.buffer !== environment.lakeSurface.buffer) world.lakeSurface.set(environment.lakeSurface);
  else world.lakeSurface = environment.lakeSurface.slice();
  world.rivers = structuredClone(environment.rivers);
  world.landmarks = structuredClone(environment.landmarks);
}

/** Pure derivation from the current terrain. Never erodes or re-applies a brush stroke. */
export type RecalculationTerrain = Pick<WorldData, 'params' | 'elevation' | 'boundary' | 'width' | 'height'>;
export function recalculateEnvironment(world: RecalculationTerrain, onProgress?: ProgressFn): EnvironmentFields {
  const { elevation, width: W, height: H } = world;
  // The explicit v1 action upgrades environmental drainage without regenerating legacy terrain.
  const params = { ...world.params, hydrologyVersion: 2 as const, drainageVersion: 2 as const };
  const report = (stage: string, progress: number) => onProgress?.(stage, progress);
  report('currents', 0);
  const currents = computeCurrents(params, elevation, fraction => report('currents', fraction * 0.22));
  const sst = nearshoreSst(currents.sst, elevation, W, H, Math.max(3, Math.round(W / 150)));
  const climate = computeClimate(params, elevation, null, fraction => report('climate', 0.22 + fraction * 0.3), { sst });
  report('hydrology', 0.52);
  const hydro = computeHydrology(params, elevation, climate.precipitation, null, climate.temperature);
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = elevation[i] <= 0 ? 1 : 0;
  report('biomes', 0.7);
  const biome = classifyBiomes(params, { elevation, ...climate, lake: hydro.lake, flow: hydro.flowMap,
    relief: localRelief(elevation, W, H, Math.max(3, Math.round(W / 150))), seaDist: distanceTo(mask, W, H),
    sst, boundary: world.boundary, filters: params.filters });
  report('landmarks', 0.8);
  const landmarks = detectLandmarks(params, elevation, world.boundary, climate.precipitation, climate.temperature, hydro.rivers, hydro.lake);
  // Ice depends on the new terrain; glacial carving is discarded so authoring is never eroded again.
  const { ice } = applyGlaciers(params, elevation.slice(), fraction => report('glaciers', 0.88 + fraction * 0.12));
  report('finish', 1);
  return { ...climate, biome, flow: hydro.flowMap, lake: hydro.lake, lakeSurface: hydro.lakeSurface,
    rivers: hydro.rivers, landmarks, currentU: currents.u, currentV: currents.v, currentSpeed: currents.speed, sst, ice };
}

export interface RecalculationCheckpoint { key: string; elevation: Float32Array; environment: EnvironmentFields }
const checkpoints = new WeakMap<WorldData, Map<string, RecalculationCheckpoint>>();
const CACHE_BUDGET = 192 * 1024 * 1024;
let cacheOrder: { world: WeakRef<WorldData>; key: string; bytes: number }[] = [];
export function getRecalculationCheckpoint(world: WorldData, key: string): RecalculationCheckpoint | undefined { return checkpoints.get(world)?.get(key); }
export function installRecalculationCheckpoints(world: WorldData, rows: RecalculationCheckpoint[]): void {
  const cache = checkpoints.get(world) ?? new Map<string, RecalculationCheckpoint>();
  for (const row of rows) {
    cache.delete(row.key); cache.set(row.key, row);
    cacheOrder = cacheOrder.filter(entry => entry.world.deref() !== world || entry.key !== row.key);
    const bytes = row.elevation.byteLength + Object.values(row.environment).reduce((sum, field) => sum + (ArrayBuffer.isView(field) ? field.byteLength : 0), 0)
      + row.environment.rivers.reduce((sum, river) => sum + river.cells.byteLength, 0);
    cacheOrder.push({ world: new WeakRef(world), key: row.key, bytes });
  }
  // Two recent checkpoints keep ordinary undo instant. Older history is prepared in the worker.
  while (cache.size > 2) cache.delete(cache.keys().next().value!);
  checkpoints.set(world, cache);
  // Global bound across cached worlds; weak owners do not keep abandoned worlds alive.
  cacheOrder = cacheOrder.filter(entry => { const owner = entry.world.deref(); return owner && checkpoints.get(owner)?.has(entry.key); });
  let bytes = cacheOrder.reduce((sum, entry) => sum + entry.bytes, 0);
  while (bytes > CACHE_BUDGET && cacheOrder.length > 1) {
    const oldest = cacheOrder.shift()!;
    const owner = oldest.world.deref();
    if (owner) checkpoints.get(owner)?.delete(oldest.key);
    bytes -= oldest.bytes;
  }
}
export function worldRecalculationCheckpoints(world: WorldData): RecalculationCheckpoint[] { return [...(checkpoints.get(world)?.values() ?? [])]; }
