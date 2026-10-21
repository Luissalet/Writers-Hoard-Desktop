import { worldgenScopeOperations } from './era';
import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import type { WorldJourney } from './journeyTypes';
import type { GeneratedWorld } from './types';
import { normalizeTravelProfile, TRAVEL_PACES, type TravelPace, type TravelProfile } from './core/travel';
import { worldSettingsScope } from './settingsScope';

function validJourney(journey: WorldJourney): boolean {
  return !!journey.id && !!journey.name.trim() && journey.stops.length >= 2
    && journey.stops.every(stop => typeof stop.name === 'string' && Number.isFinite(stop.u) && stop.u >= 0 && stop.u < 1 && Number.isFinite(stop.v) && stop.v >= 0 && stop.v <= 1)
    && ['foot', 'horse', 'cart', 'boat', 'ship'].includes(journey.options.mode)
    && ['spring', 'summer', 'autumn', 'winter'].includes(journey.options.season)
    && [journey.options.hoursPerDay, journey.options.planetRadiusKm].every(value => value === undefined || (Number.isFinite(value) && value > 0))
    && (journey.options.pace === undefined || TRAVEL_PACES.includes(journey.options.pace))
    && (journey.options.legModes === undefined || (Array.isArray(journey.options.legModes) && journey.options.legModes.length === journey.stops.length - 1
      && journey.options.legModes.every(mode => ['foot', 'horse', 'cart', 'boat', 'ship'].includes(mode))))
    && validProfile(journey.options.profile);
}

function validProfile(profile: unknown): boolean {
  try { normalizeTravelProfile(profile); return true; } catch { return false; }
}

export interface TravelSettingsReceipt {
  from: { profile?: TravelProfile; pace?: TravelPace }; to: { profile?: TravelProfile; pace?: TravelPace }; revision: number;
  /** Where the change was written (Base for a world an era inherits), so undo reverts that row. */
  scope?: { projectId: string; eraId?: string };
}

/**
 * Save the world's travel physics and default pace in its own era. Itineraries
 * snapshot what they were planned with, so changing this never rewrites a
 * saved journey; it applies to the next plan.
 */
/** One factor set by hand; 1 removes it. Applied to the stored profile, so other factors changed elsewhere survive. */
export interface TravelFactorEdit { table: 'speed' | 'ground'; key: string; value: number }

export async function saveWorldTravelSettings(requested: { projectId: string; eraId?: string }, worldId: string, change: { profile?: unknown; pace?: unknown; factors?: TravelFactorEdit[] }, expectedRevision?: number): Promise<TravelSettingsReceipt> {
  const scope = await worldSettingsScope(requested, worldId);
  const next: { profile?: TravelProfile; pace?: TravelPace } = {};
  if ('profile' in change) next.profile = normalizeTravelProfile(change.profile);
  if ('pace' in change) {
    if (change.pace !== undefined && change.pace !== null && !TRAVEL_PACES.includes(change.pace as TravelPace)) throw new Error(`pace must be one of ${TRAVEL_PACES.join(', ')}.`);
    next.pace = (change.pace ?? undefined) as TravelPace | undefined;
  }
  const { worlds } = worldgenScopeOperations(scope);
  const receipt = await db.transaction('rw', scope.eraId ? db.tables : [db.generatedWorlds], async () => {
    const current = await worlds.getOne(worldId);
    if (!current || current.projectId !== scope.projectId) throw new Error('World no longer belongs to this project');
    const revision = current.travelRevision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== revision) throw new Error(`Travel settings changed (revision ${revision}); read them again before saving.`);
    if (change.factors?.length) {
      const merged = structuredClone(next.profile ?? current.travelProfile ?? {}) as Record<string, Record<string, number>>;
      for (const edit of change.factors) {
        const table = { ...(merged[edit.table] ?? {}) };
        if (Math.abs(edit.value - 1) < 0.001) delete table[edit.key]; else table[edit.key] = Math.round(edit.value * 100) / 100;
        if (Object.keys(table).length) merged[edit.table] = table; else delete merged[edit.table];
      }
      next.profile = normalizeTravelProfile(merged);
    }
    const from = { profile: current.travelProfile, pace: current.travelPace };
    const to = { profile: 'profile' in next ? (Object.keys(next.profile ?? {}).length ? next.profile : undefined) : current.travelProfile, pace: 'pace' in next ? next.pace : current.travelPace };
    if (JSON.stringify(from) === JSON.stringify(to)) return { from, to, revision, scope };
    await worlds.update(worldId, { travelProfile: to.profile, travelPace: to.pace, travelRevision: revision + 1, updatedAt: Date.now() });
    return { from, to, revision: revision + 1, scope };
  });
  notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: worldId, projectId: scope.projectId });
  return receipt;
}

/** Undo one recorded change, keeping fields changed again since. */
export async function revertWorldTravelSettings(requested: { projectId: string; eraId?: string }, worldId: string, receipt: TravelSettingsReceipt): Promise<{ reverted: string[]; kept: string[] }> {
  const scope = receipt.scope ?? await worldSettingsScope(requested, worldId);
  const { worlds } = worldgenScopeOperations(scope);
  const result = await db.transaction('rw', scope.eraId ? db.tables : [db.generatedWorlds], async () => {
    const current = await worlds.getOne(worldId);
    if (!current || current.projectId !== scope.projectId) throw new Error('World no longer belongs to this project');
    const reverted: string[] = [], kept: string[] = [], patch: Partial<GeneratedWorld> = {};
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    for (const [field, key] of [['profile', 'travelProfile'], ['pace', 'travelPace']] as const) {
      if (same(receipt.from[field], receipt.to[field])) continue;
      if (!same(current[key], receipt.to[field])) { kept.push(field); continue; }
      (patch as Record<string, unknown>)[key] = receipt.from[field];
      reverted.push(field);
    }
    if (reverted.length) await worlds.update(worldId, { ...patch, travelRevision: (current.travelRevision ?? 0) + 1, updatedAt: Date.now() });
    return { reverted, kept };
  });
  notifyDataChanged({ source: 'undo', table: 'generatedWorlds', entityId: worldId, projectId: scope.projectId });
  return result;
}

/** Atomic append, preserving concurrent recipes and other itineraries. Retrying the same ID is idempotent. */
export async function saveWorldJourney(worldId: string, projectId: string, journey: WorldJourney, eraId?: string): Promise<WorldJourney[]> {
  if (!validJourney(journey)) throw new Error('Invalid itinerary');
  const { worlds } = worldgenScopeOperations({ projectId, eraId });
  const result = await db.transaction('rw', eraId ? db.tables : [db.generatedWorlds], async () => {
    const current = await worlds.getOne(worldId);
    if (!current || current.projectId !== projectId) throw new Error('World no longer belongs to this project');
    const journeys = [...(current.journeys ?? [])];
    const existing = journeys.find(row => row.id === journey.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(journey)) throw new Error('Itinerary changed; save it as a new itinerary');
      return journeys;
    }
    journeys.push(structuredClone(journey));
    await worlds.update(worldId, { journeys, updatedAt: Date.now() });
    return journeys;
  });
  notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: worldId, projectId });
  return result;
}

/** Delete only the version the reader confirmed, preserving concurrent changes and other plans. */
export async function deleteWorldJourney(worldId: string, projectId: string, expected: WorldJourney, eraId?: string): Promise<void> {
  const { worlds } = worldgenScopeOperations({ projectId, eraId });
  await db.transaction('rw', eraId ? db.tables : [db.generatedWorlds], async () => {
    const current = await worlds.getOne(worldId);
    if (!current || current.projectId !== projectId) throw new Error('World no longer belongs to this project');
    const target = current.journeys?.find(journey => journey.id === expected.id);
    if (!target) return;
    if (JSON.stringify(target) !== JSON.stringify(expected)) throw new Error('Itinerary changed since deletion was requested');
    await worlds.update(worldId, { journeys: current.journeys!.filter(journey => journey.id !== expected.id), updatedAt: Date.now() });
  });
  notifyDataChanged({ source: 'other', table: 'generatedWorlds', entityId: worldId, projectId });
}
