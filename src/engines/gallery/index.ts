import { Image } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import {
  registerBackupStrategy,
  sanitizeBackupName,
  externalizeImage,
  internalizeImage,
  readBackupJson,
} from '@/engines/_shared';
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

// ============================================
// Backup strategy — preserves legacy on-disk format:
//   {projectDir}/gallery/collections.json
//   {projectDir}/gallery/unsorted/{NNN}.{ext}          (uncategorized images)
//   {projectDir}/gallery/unsorted/{NNN}_thumb.{ext}
//   {projectDir}/gallery/unsorted/images.json
//   {projectDir}/gallery/{sanitizedColName}__{colId}/{NNN}.{ext}
//   {projectDir}/gallery/{sanitizedColName}__{colId}/{NNN}_thumb.{ext}
//   {projectDir}/gallery/{sanitizedColName}__{colId}/images.json
// ============================================
registerBackupStrategy({
  engineId: 'gallery',
  tables: ['imageCollections', 'inspirationImages'],
  async exportProject({ zip, projectId, projectDir }) {
    const collections = await db.imageCollections
      .where('projectId')
      .equals(projectId)
      .toArray();
    const images = await db.inspirationImages
      .where('projectId')
      .equals(projectId)
      .toArray();
    if (images.length === 0) return;

    if (collections.length > 0) {
      zip.file(
        `${projectDir}/gallery/collections.json`,
        JSON.stringify(collections, null, 2),
      );
    }

    // Shared image-externalization routine for each folder
    const exportImage = (
      img: (typeof images)[0],
      folder: string,
      index: number,
    ): Record<string, unknown> => {
      const meta: Record<string, unknown> = { ...img };
      const basename = String(index + 1).padStart(3, '0');
      const mainPath = externalizeImage(zip, folder, img.imageData, basename);
      if (mainPath) meta.imageData = mainPath;
      const thumbPath = externalizeImage(
        zip,
        folder,
        img.thumbnailData,
        `${basename}_thumb`,
      );
      if (thumbPath) meta.thumbnailData = thumbPath;
      return meta;
    };

    // Uncategorized
    const uncategorized = images.filter((img) => !img.collectionId);
    if (uncategorized.length > 0) {
      const folder = `${projectDir}/gallery/unsorted`;
      const metas = uncategorized.map((img, i) => exportImage(img, folder, i));
      zip.file(`${folder}/images.json`, JSON.stringify(metas, null, 2));
    }

    // Per-collection
    for (const col of collections) {
      const colImages = images.filter((img) => img.collectionId === col.id);
      if (colImages.length === 0) continue;
      const folder = `${projectDir}/gallery/${sanitizeBackupName(col.title)}__${col.id}`;
      const metas = colImages.map((img, i) => exportImage(img, folder, i));
      zip.file(`${folder}/images.json`, JSON.stringify(metas, null, 2));
    }
  },
  async importProject({ zip, projectDir }) {
    const galleryFolder = `${projectDir}/gallery/`;

    // Collections first (images may reference them)
    const collections = await readBackupJson<Record<string, unknown>[]>(
      zip,
      `${galleryFolder}collections.json`,
    );
    if (collections?.length) await db.imageCollections.bulkAdd(collections as never[]);

    // Every subfolder that has an images.json is an image folder
    const imgFolders = new Set<string>();
    zip.forEach((path) => {
      if (path.startsWith(galleryFolder) && path.endsWith('/images.json')) {
        imgFolders.add(path.replace('/images.json', ''));
      }
    });

    for (const imgFolder of imgFolders) {
      const imgMetas = await readBackupJson<Record<string, unknown>[]>(
        zip,
        `${imgFolder}/images.json`,
      );
      if (!imgMetas?.length) continue;
      for (const imgMeta of imgMetas) {
        if (
          imgMeta.imageData &&
          typeof imgMeta.imageData === 'string' &&
          !imgMeta.imageData.startsWith('data:')
        ) {
          imgMeta.imageData =
            (await internalizeImage(zip, imgFolder, imgMeta.imageData)) || '';
        }
        if (
          imgMeta.thumbnailData &&
          typeof imgMeta.thumbnailData === 'string' &&
          !imgMeta.thumbnailData.startsWith('data:')
        ) {
          imgMeta.thumbnailData =
            (await internalizeImage(zip, imgFolder, imgMeta.thumbnailData)) || undefined;
        }
        await db.inspirationImages.add(imgMeta as never);
      }
    }
  },
});

export { galleryEngine };
