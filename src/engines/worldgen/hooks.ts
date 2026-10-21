import { useEraEntities } from '@/services/worldEras/hooks';
import type { GeneratedWorld, WorldWaypoint } from './types';
import { generatedWorldOps, worldWaypointOps, deleteWorldCascade } from './operations';

const worldOptions = {
  fetchFn: generatedWorldOps.getAll,
  createFn: generatedWorldOps.create,
  updateFn: generatedWorldOps.update,
  deleteFn: deleteWorldCascade,
};

const waypointOptions = {
  fetchFn: worldWaypointOps.getAll,
  createFn: worldWaypointOps.create,
  updateFn: worldWaypointOps.update,
  deleteFn: worldWaypointOps.delete,
};

const byCreated = <T extends { createdAt: number }>(a: T, b: T) => a.createdAt - b.createdAt;
export function useGeneratedWorlds(projectId: string) { return useEraEntities<GeneratedWorld>(projectId, 'generatedWorlds', 'projectId', worldOptions, undefined, byCreated); }
export function useWorldWaypoints(worldId: string) { return useEraEntities<WorldWaypoint>(worldId, 'worldWaypoints', 'worldId', waypointOptions, undefined, byCreated); }
