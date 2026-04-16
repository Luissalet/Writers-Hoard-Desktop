import { makeEntityHook } from '@/engines/_shared';
import * as ops from './operations';
import type { Biography, BiographyFact } from './types';

export const useBiographies = makeEntityHook<Biography>({
  fetchFn: ops.getBiographies,
  createFn: ops.createBiography,
  updateFn: ops.updateBiography,
  deleteFn: ops.deleteBiography,
});

export const useBiographyFacts = makeEntityHook<BiographyFact>({
  fetchFn: ops.getFacts,
  createFn: ops.createFact,
  updateFn: ops.updateFact,
  deleteFn: ops.deleteFact,
  reorderFn: ops.reorderFacts,
});
