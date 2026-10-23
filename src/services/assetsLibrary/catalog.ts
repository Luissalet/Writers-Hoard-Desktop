// ============================================================================
// Assets library — one list over the project's pictures, sounds, videos and 3D
// models. Each kind keeps living in its own engine's store; this file only
// reads them side by side and sorts, filters and names them.
// ============================================================================

import { db } from '@/db';
import { t } from '@/i18n/useTranslation';
import { mediaRows } from '@/engines/media/scope';
import { getEraProject } from '@/services/worldEras/store';
import { modelStoredBytes } from '@/engines/model-viewer/portable';
import type { InspirationImage } from '@/types';

export type AssetKind = 'image' | 'audio' | 'video' | 'model';
export type AssetStore = 'gallery' | 'media' | 'model';
export type AssetSort = 'name-asc' | 'name-desc' | 'date-asc' | 'date-desc' | 'size-asc' | 'size-desc';

export const ASSET_KINDS: readonly AssetKind[] = ['image', 'audio', 'video', 'model'];
export const ASSET_SORTS: readonly AssetSort[] = ['date-desc', 'date-asc', 'name-asc', 'name-desc', 'size-desc', 'size-asc'];

/** From this size on, a sound or video is offered "Comprimir". */
export const COMPRESS_THRESHOLD_BYTES = 8 * 1024 * 1024;

export interface LibraryAsset {
  id: string;
  kind: AssetKind;
  store: AssetStore;
  name: string;
  /** Bytes stored for it. */
  size: number;
  createdAt: number;
  /** MIME type when known (images from the data URL, media from the blob). */
  mime: string;
  tags: string[];
  /** True when the sound or video is big enough that compressing it is worth offering. */
  oversize: boolean;
}

/** Bytes a base64 data URL decodes to, without decoding it. */
export function dataUrlBytes(dataUrl: string | undefined): number {
  if (!dataUrl) return 0;
  const comma = dataUrl.indexOf(',');
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

export function dataUrlMime(dataUrl: string): string {
  return /^data:([^;,]+)/i.exec(dataUrl)?.[1]?.toLowerCase() ?? 'image/png';
}

/** The name an image shows: its own name, else the first line of its caption, else a plain placeholder. */
export function imageDisplayName(image: Pick<InspirationImage, 'id' | 'name' | 'notes'>): string {
  const own = image.name?.trim();
  if (own) return own;
  const caption = image.notes?.replace(/\s+/g, ' ').trim();
  if (caption) return caption.length > 60 ? `${caption.slice(0, 59)}…` : caption;
  return t('assetsLibrary.untitledImage').replace('{id}', image.id.slice(0, 6));
}

function fromImage(image: InspirationImage): LibraryAsset {
  const size = dataUrlBytes(image.imageData) + (image.imageDataOriginal && image.imageDataOriginal !== image.imageData ? dataUrlBytes(image.imageDataOriginal) : 0);
  return { id: image.id, kind: 'image', store: 'gallery', name: imageDisplayName(image), size, createdAt: image.createdAt, mime: dataUrlMime(image.imageData), tags: image.tags ?? [], oversize: false };
}

/** Every picture, sound, video and 3D model of the project. `eraId` reads that era's effective world. */
export async function listProjectAssets(projectId: string, eraId?: string): Promise<LibraryAsset[]> {
  const [images, media, project] = await Promise.all([
    db.inspirationImages.where('projectId').equals(projectId).toArray(),
    mediaRows(projectId, eraId),
    eraId ? getEraProject({ projectId, eraId }) : db.projects.get(projectId),
  ]);
  return [
    ...images.map(fromImage),
    ...media.map((row): LibraryAsset => ({ id: row.id, kind: row.kind, store: 'media', name: row.title, size: row.size, createdAt: row.createdAt, mime: row.mime, tags: row.tags ?? [], oversize: row.size >= COMPRESS_THRESHOLD_BYTES })),
    ...(project?.modelAssets ?? []).map((row): LibraryAsset => ({ id: row.id, kind: 'model', store: 'model', name: row.name, size: modelStoredBytes(row), createdAt: row.createdAt, mime: 'model/gltf-binary', tags: [], oversize: false })),
  ];
}

export interface AssetFilter { kind?: AssetKind | 'all'; query?: string; sort?: AssetSort; limit?: number }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Filter by kind, then by every word of the query (name, tags), then order. */
export function filterAssets(assets: readonly LibraryAsset[], filter: AssetFilter = {}): LibraryAsset[] {
  const words = (filter.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const rows = assets.filter(asset => (!filter.kind || filter.kind === 'all' || asset.kind === filter.kind)
    && words.every(word => asset.name.toLowerCase().includes(word) || asset.tags.some(tag => tag.toLowerCase().includes(word))));
  const sort = filter.sort ?? 'date-desc';
  const [field, direction] = sort.split('-') as ['name' | 'date' | 'size', 'asc' | 'desc'];
  const sign = direction === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const order = field === 'name' ? collator.compare(a.name, b.name) : field === 'size' ? a.size - b.size : a.createdAt - b.createdAt;
    return (order || collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1)) * (order ? sign : 1);
  });
  return filter.limit !== undefined ? rows.slice(0, Math.max(0, filter.limit)) : rows;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
