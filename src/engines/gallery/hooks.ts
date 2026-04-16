import { makeEntityHook, makeTableOps } from '@/engines/_shared';
import type { InspirationImage, ImageCollection } from '@/types';

const imageCollectionOps = makeTableOps<ImageCollection>({
  tableName: 'imageCollections',
  scopeField: 'projectId',
});

export const useImageCollections = makeEntityHook<ImageCollection>({
  fetchFn: imageCollectionOps.getAll,
  createFn: imageCollectionOps.create,
  updateFn: imageCollectionOps.update,
  deleteFn: imageCollectionOps.delete,
});

const inspirationImageOps = makeTableOps<InspirationImage>({
  tableName: 'inspirationImages',
  scopeField: 'projectId',
});

export const useInspirationImages = makeEntityHook<InspirationImage>({
  fetchFn: inspirationImageOps.getAll,
  createFn: inspirationImageOps.create,
  updateFn: inspirationImageOps.update,
  deleteFn: inspirationImageOps.delete,
});
