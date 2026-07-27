import { lazy } from 'react';
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
const GalleryEngine = lazy(() => import('./GalleryEngine'));

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
    if (entityType === 'gallery') {
      const collection = await db.imageCollections.get(entityId);
      if (!collection) return null;
      return {
        id: collection.id,
        type: entityType,
        engineId: 'gallery',
        projectId: collection.projectId,
        title: collection.title,
      };
    }
    const image = await db.inspirationImages.get(entityId);
    if (!image) return null;
    return {
      id: image.id,
      type: entityType,
      engineId: 'gallery',
      projectId: image.projectId,
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
      projectId: i.projectId,
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

    zip.file(
      `${projectDir}/gallery/collections.json`,
      JSON.stringify(collections, null, 2),
    );
    // Empty collections are still user data. Persist them above even when the
    // project currently contains no images.
    if (images.length === 0) return;

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
  async preflightImport({ zip, projectDir }) {
    const galleryFolder = `${projectDir}/gallery/`;
    const collectionsPath = `${galleryFolder}collections.json`;
    const collections = await readBackupJson<unknown>(zip, collectionsPath);
    if (collections !== null && !Array.isArray(collections)) {
      throw new Error(`Expected "${collectionsPath}" to contain a JSON array.`);
    }

    const imageJsonPaths: string[] = [];
    zip.forEach((path) => {
      if (path.startsWith(galleryFolder) && path.endsWith('/images.json')) {
        imageJsonPaths.push(path);
      }
    });
    for (const path of imageJsonPaths) {
      const images = await readBackupJson<unknown>(zip, path);
      if (!Array.isArray(images)) {
        throw new Error(`Expected "${path}" to contain a JSON array.`);
      }
      const folder = path.slice(0, -'/images.json'.length);
      for (const image of images) {
        if (!image || typeof image !== 'object') {
          throw new Error(`Expected "${path}" to contain image objects.`);
        }
        const record = image as Record<string, unknown>;
        for (const field of ['imageData', 'thumbnailData'] as const) {
          const value = record[field];
          if (
            typeof value === 'string' &&
            value &&
            !value.startsWith('data:') &&
            !zip.file(`${folder}/${value}`)
          ) {
            throw new Error(`Missing gallery asset "${folder}/${value}".`);
          }
        }
      }
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
          const imageData = await internalizeImage(zip, imgFolder, imgMeta.imageData);
          if (!imageData) {
            throw new Error(`Missing gallery asset "${imgFolder}/${imgMeta.imageData}".`);
          }
          imgMeta.imageData = imageData;
        }
        if (
          imgMeta.thumbnailData &&
          typeof imgMeta.thumbnailData === 'string' &&
          !imgMeta.thumbnailData.startsWith('data:')
        ) {
          const thumbnailData = await internalizeImage(
            zip,
            imgFolder,
            imgMeta.thumbnailData,
          );
          if (!thumbnailData) {
            throw new Error(
              `Missing gallery asset "${imgFolder}/${imgMeta.thumbnailData}".`,
            );
          }
          imgMeta.thumbnailData = thumbnailData;
        }
        await db.inspirationImages.add(imgMeta as never);
      }
    }
  },
});

export { galleryEngine };
