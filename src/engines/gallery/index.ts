import { Image } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { db } from '@/db';
import GalleryEngine from './GalleryEngine';

const galleryEngine: EngineDefinition = {
  id: 'gallery',
  name: 'Gallery',
  description: 'Image collections with tagging and albums',
  icon: Image,
  category: 'core',
  tables: {
    imageCollections: 'id, projectId',
    inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
  },
  component: GalleryEngine,
};

registerEngine(galleryEngine);

registerEntityResolver({
  engineId: 'gallery',
  entityTypes: ['gallery', 'image'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const image = await db.inspirationImages.get(entityId);
    if (!image) return null;
    return {
      id: image.id,
      type: entityType,
      engineId: 'gallery',
      title: image.notes || 'Image',
      thumbnail: image.thumbnailData ?? image.imageData,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.inspirationImages.filter(i => (i.notes || '').toLowerCase().includes(q)).toArray();
    return rows.map(i => ({
      id: i.id,
      type: 'image',
      engineId: 'gallery',
      title: i.notes || 'Image',
      thumbnail: i.thumbnailData ?? i.imageData,
    }));
  },
});

export { galleryEngine };
