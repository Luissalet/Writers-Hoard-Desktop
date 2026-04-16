import { makeTableOps } from '@/engines/_shared';
import type { InspirationImage, ImageCollection } from '@/types';

export const imageCollectionOps = makeTableOps<ImageCollection>({
  tableName: 'imageCollections',
  scopeField: 'projectId',
});

export const inspirationImageOps = makeTableOps<InspirationImage>({
  tableName: 'inspirationImages',
  scopeField: 'projectId',
});
