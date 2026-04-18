import { makeTableOps } from '@/engines/_shared';
import type { Relationship } from './types';

const ops = makeTableOps<Relationship>({
  tableName: 'relationships',
  scopeField: 'projectId',
  sortFn: (a, b) => b.updatedAt - a.updatedAt,
});

export const getRelationships = ops.getAll;
export const getRelationship = ops.getOne;
export const createRelationship = ops.create;
export const updateRelationship = ops.update;
export const deleteRelationship = ops.delete;
