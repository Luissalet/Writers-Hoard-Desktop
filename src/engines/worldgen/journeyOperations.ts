import { worldgenScopeOperations } from './era';
import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import type { WorldJourney } from './journeyTypes';

function validJourney(journey: WorldJourney): boolean {
  return !!journey.id && !!journey.name.trim() && journey.stops.length >= 2
    && journey.stops.every(stop => typeof stop.name === 'string' && Number.isFinite(stop.u) && stop.u >= 0 && stop.u < 1 && Number.isFinite(stop.v) && stop.v >= 0 && stop.v <= 1)
    && ['foot', 'horse', 'cart', 'boat', 'ship'].includes(journey.options.mode)
    && ['spring', 'summer', 'autumn', 'winter'].includes(journey.options.season)
    && [journey.options.hoursPerDay, journey.options.planetRadiusKm].every(value => value === undefined || (Number.isFinite(value) && value > 0));
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
