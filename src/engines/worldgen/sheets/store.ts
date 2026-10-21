import { worldgenScopeOperations } from '../era';
import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { stableStringify } from '../region/workerProtocol';
import type { GeneratedWorld, SavedWorldRegion } from '../types';
import { sheetSpec, savedSheetFrame } from './frame';
import type { WorldData } from '../core/types';

export class WorldRegionConflict extends Error {}
/** Apply only changed region IDs. Unrelated concurrent regions/metadata survive. */
export async function saveWorldRegionChanges(projectId: string, worldId: string, base: readonly SavedWorldRegion[], next: readonly SavedWorldRegion[], expectedParams?: GeneratedWorld['params'], eraId?: string): Promise<SavedWorldRegion[]> {
  const { worlds } = worldgenScopeOperations({ projectId, eraId });
  const result = await db.transaction('rw', eraId ? db.tables : [db.generatedWorlds], async () => {
    const world = await worlds.getOne(worldId);
    if (!world || world.projectId !== projectId || (expectedParams && stableStringify(world.params) !== stableStringify(expectedParams))) throw new WorldRegionConflict('World changed');
    const previous = new Map(base.map(item => [item.id, item])), proposed = new Map(next.map(item => [item.id, item])), current = new Map((world.regions ?? []).map(item => [item.id, item]));
    if (proposed.size !== next.length) throw new WorldRegionConflict('Duplicate region identity');
    for (const id of new Set([...previous.keys(), ...proposed.keys()])) {
      const before = previous.get(id), after = proposed.get(id);
      if (stableStringify(before) === stableStringify(after)) continue;
      if (stableStringify(current.get(id)) !== stableStringify(before)) throw new WorldRegionConflict('Region changed');
      if (after) {
        if (!after.id || !after.title.trim() || !Number.isFinite(after.x) || !Number.isFinite(after.y) || !Number.isFinite(after.spanKm) || after.spanKm <= 0 || !Number.isFinite(after.params.aspect) || after.params.aspect <= 0) throw new Error('Invalid region');
        if (after.frameMode === 'canon') sheetSpec({ width: world.params.width, height: world.params.width / 2 } as WorldData, savedSheetFrame(after));
        current.set(id, structuredClone(after));
      } else current.delete(id);
    }
    const regions = [...current.values()]; await worlds.update(worldId, { regions, updatedAt: Date.now() }); return regions;
  });
  notifyDataChanged({ source: 'other', table: 'generatedWorlds', projectId, entityId: worldId }); return result;
}
