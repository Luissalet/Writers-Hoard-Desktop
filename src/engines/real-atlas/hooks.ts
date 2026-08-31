import { makeEntityHook } from '@/engines/_shared';
import { atlasDivergenceOps, atlasPlaceOps, deleteAtlasPlace } from './operations';
import type { AtlasDivergence, AtlasPlace } from './types';

export const useAtlasPlaces = makeEntityHook<AtlasPlace>({
  fetchFn: atlasPlaceOps.getAll,
  createFn: atlasPlaceOps.create,
  updateFn: atlasPlaceOps.update,
  deleteFn: deleteAtlasPlace,
});

export const useAtlasDivergences = makeEntityHook<AtlasDivergence>({
  fetchFn: atlasDivergenceOps.getAll,
  createFn: atlasDivergenceOps.create,
  updateFn: atlasDivergenceOps.update,
  deleteFn: atlasDivergenceOps.delete,
});
