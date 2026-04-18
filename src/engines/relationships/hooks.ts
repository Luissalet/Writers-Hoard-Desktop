import { makeEntityHook } from '@/engines/_shared';
import * as ops from './operations';
import type { Relationship } from './types';

export const useRelationships = makeEntityHook<Relationship>({
  fetchFn: ops.getRelationships,
  createFn: ops.createRelationship,
  updateFn: ops.updateRelationship,
  deleteFn: ops.deleteRelationship,
});
