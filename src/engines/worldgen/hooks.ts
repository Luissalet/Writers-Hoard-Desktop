import { makeEntityHook } from '@/engines/_shared';
import type { GeneratedWorld, WorldWaypoint } from './types';
import { generatedWorldOps, worldWaypointOps, deleteWorldCascade } from './operations';

export const useGeneratedWorlds = makeEntityHook<GeneratedWorld>({
  fetchFn: generatedWorldOps.getAll,
  createFn: generatedWorldOps.create,
  updateFn: generatedWorldOps.update,
  deleteFn: deleteWorldCascade,
});

export const useWorldWaypoints = makeEntityHook<WorldWaypoint>({
  fetchFn: worldWaypointOps.getAll,
  createFn: worldWaypointOps.create,
  updateFn: worldWaypointOps.update,
  deleteFn: worldWaypointOps.delete,
});
