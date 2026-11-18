import { BridgeError } from '@/services/aiBridge/tools/shared';
import type { UndoResult } from '@/services/aiBridge/undo';
import { revertMapPlate } from './manuscript';
import { revertInWorldMap, type MapChange } from './store';

export async function undoInWorldMapAudit(entry: Record<string, unknown>): Promise<UndoResult> {
  const { projectId, entityId, eraId, before } = entry;
  if (typeof projectId !== 'string' || typeof entityId !== 'string' || !before || typeof before !== 'object') {
    throw new BridgeError('cannot-undo', 'The map write has no undo receipt.');
  }
  const scope = { projectId, eraId: typeof eraId === 'string' ? eraId : undefined };
  const stamp = (before as { __inWorldMapPlate?: unknown }).__inWorldMapPlate;
  const change = (before as { __inWorldMap?: MapChange }).__inWorldMap;
  try {
    if (entry.tool === 'wh_insert_in_world_map' && typeof stamp === 'string') {
      await revertMapPlate(scope, projectId, entityId, stamp);
    } else if (change && typeof change.id === 'string') {
      await revertInWorldMap(scope, entityId, change);
    } else throw new Error('The map write has no undo receipt.');
  } catch (error) {
    throw new BridgeError('cannot-undo', error instanceof Error ? error.message : String(error));
  }
  return { undone: true, kind: 'update', entityId, what: String(entry.summary ?? 'in-world map change') };
}
