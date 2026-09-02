// ============================================================================
// AI bridge tools — the reference gallery
// ============================================================================
//
// Every image is base64 in Dexie in three sizes. Only `thumbnailData` (or, as
// a fallback, the cropped `imageData`) is ever sent to a model; the untouched
// `imageDataOriginal` is never read here — it is the archive copy, and a model
// gains nothing from the extra pixels.

import type { ImageCollection, InspirationImage } from '@/types';
import { imageCollectionOps, inspirationImageOps } from '@/engines/gallery/operations';
import {
  assertEngineEnabled,
  assertRowInScope,
  BridgeError,
  clampLimit,
  dataUrlToBlob,
  optBoolean,
  optNumber,
  optString,
  optStringArray,
  requireString,
  resolveProjectId,
  toVisionJpeg,
  withAudit,
  withMedia,
  type ToolArgs,
} from './shared';

async function mustGetImage(id: string): Promise<InspirationImage> {
  const image = await inspirationImageOps.getOne(id);
  if (!image) throw new BridgeError('not-found', `No gallery image with id "${id}".`);
  return image;
}

/** The cheapest usable rendition. */
function viewableData(image: InspirationImage): string | undefined {
  const candidate = image.thumbnailData || image.imageData;
  return candidate?.startsWith('data:') ? candidate : undefined;
}

export async function whListImages(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const tag = optString(args, 'tag');
  const untaggedOnly = optBoolean(args, 'untaggedOnly') === true;
  const limit = clampLimit(optNumber(args, 'limit'), 50, 200);

  const [images, collections] = await Promise.all([
    inspirationImageOps.getAll(projectId),
    imageCollectionOps.getAll(projectId),
  ]);
  const collectionName = (id?: string): string | undefined =>
    collections.find((collection: ImageCollection) => collection.id === id)?.title;

  let rows = images;
  if (tag) rows = rows.filter((image) => image.tags.includes(tag));
  if (untaggedOnly) rows = rows.filter((image) => image.tags.length === 0);

  return {
    projectId,
    total: rows.length,
    collections: collections.map((collection) => ({
      id: collection.id,
      title: collection.title,
    })),
    images: rows.slice(0, limit).map((image) => ({
      id: image.id,
      collection: collectionName(image.collectionId),
      tags: image.tags,
      notes: image.notes,
      linkedEntryIds: image.linkedEntryIds ?? [],
      viewable: Boolean(viewableData(image)),
      createdAt: image.createdAt,
    })),
  };
}

export async function whViewImage(args: ToolArgs): Promise<unknown> {
  const image = await mustGetImage(requireString(args, 'id'));
  assertRowInScope(args, image.projectId);
  const data = viewableData(image);
  if (!data) throw new BridgeError('no-image', 'That gallery entry has no image data stored.');
  const media = await toVisionJpeg(dataUrlToBlob(data));
  return withMedia(
    {
      id: image.id,
      existingTags: image.tags,
      notes: image.notes,
      hint: 'Describe what is in the frame, then write it back with wh_tag_image.',
    },
    [{ ...media, label: image.id }],
  );
}

export async function whTagImage(args: ToolArgs): Promise<unknown> {
  const image = await mustGetImage(requireString(args, 'id'));
  await assertEngineEnabled(image.projectId, 'gallery');
  assertRowInScope(args, image.projectId);
  const changes: Partial<InspirationImage> = {};

  const replaceTags = optStringArray(args, 'tags');
  const addTags = optStringArray(args, 'addTags');
  if (replaceTags) changes.tags = [...new Set(replaceTags)];
  else if (addTags) changes.tags = [...new Set([...image.tags, ...addTags])];

  const notes = optString(args, 'notes');
  if (notes !== undefined) changes.notes = notes;
  const linkedEntryIds = optStringArray(args, 'linkedEntryIds');
  if (linkedEntryIds !== undefined) changes.linkedEntryIds = linkedEntryIds;

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass tags, addTags, notes or linkedEntryIds.');
  }
  await inspirationImageOps.update(image.id, changes);
  return withAudit(
    { id: image.id, updated: Object.keys(changes), tags: changes.tags ?? image.tags },
    {
      projectId: image.projectId,
      entityId: image.id,
      summary: `described a gallery image (${(changes.tags ?? image.tags).join(', ') || 'no tags'})`,
      before: { tags: image.tags, notes: image.notes },
    },
  );
}
