import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { MAX_MEDIA_BYTES, MAX_PROJECT_MEDIA_BYTES, mediaKind, mediaMime, type LocalMediaAsset } from './types';
import { listEraRows } from '@/services/worldEras/store';
import type { CodexEntry } from '@/types';
import { mediaAsset, mediaRows, removeMediaAsset, saveMediaAsset } from './scope';

export async function importLocalMedia(projectId: string, file: File, eraId?: string, options?: {id?:string;notify?:boolean}): Promise<LocalMediaAsset> {
  const mime = mediaMime(file); const kind = mediaKind(mime);
  if (!kind || !file.size || file.size > MAX_MEDIA_BYTES) throw new Error('invalid_media');
  const now = Date.now();
  if(options?.id!==undefined&&(typeof options.id!=='string'||!options.id.trim()))throw new Error('invalid_media_id');
  const asset: LocalMediaAsset = { id: options?.id??crypto.randomUUID(), projectId, title: file.name, kind, mime, blob: file.slice(0, file.size, mime), size: file.size, notes: '', tags: [], linkedEntryIds: [], createdAt: now, updatedAt: now };
  await db.transaction('rw', db.tables, async () => {
    const current = await mediaRows(projectId, eraId);
    if(current.some(row=>row.id===asset.id)||await db.localMediaAssets.get(asset.id))throw new Error('media_id_occupied');
    if (current.reduce((total, row) => total + row.size, 0) + file.size > MAX_PROJECT_MEDIA_BYTES) throw new Error('media_capacity');
    await saveMediaAsset(projectId, asset, null, eraId);
  });
  if(options?.notify!==false)notifyDataChanged({ source: 'import', table: 'localMediaAssets', projectId, entityId: asset.id });
  return asset;
}

type MediaChanges = Pick<LocalMediaAsset, 'title' | 'notes' | 'tags' | 'linkedEntryIds'>;
export async function updateLocalMedia(projectId: string, id: string, changes: MediaChanges, base?: MediaChanges, eraId?: string): Promise<void> {
  if (!changes.title.trim()) throw new Error('title_required');
  await db.transaction('rw', db.tables, async () => {
    const asset = await mediaAsset(projectId, id, eraId); if (!asset) throw new Error('missing_media');
    const merged = { ...changes };
    if (base) for (const field of ['title', 'notes', 'tags', 'linkedEntryIds'] as const) {
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      if (!same(changes[field], base[field]) && !same(asset[field], base[field]) && !same(asset[field], changes[field])) throw new Error('media_conflict');
      if (same(changes[field], base[field])) Object.assign(merged, { [field]: asset[field] });
    }
    const entries = await listEraRows<CodexEntry>({projectId, eraId}, 'codexEntries');
    const targets = merged.linkedEntryIds.map(id => entries.find(entry => entry.id === id));
    if (targets.some(entry => !entry || entry.projectId !== projectId)) throw new Error('invalid_link');
    const now = Date.now();
    await saveMediaAsset(projectId, { ...asset, ...merged, title: merged.title.trim(), updatedAt: now }, asset, eraId);
  });
  notifyDataChanged({ source: 'other', table: 'localMediaAssets', projectId, entityId: id });
}

export async function deleteLocalMedia(projectId: string, id: string, eraId?: string): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await removeMediaAsset(projectId, id, eraId);
  });
  notifyDataChanged({ source: 'other', table: 'localMediaAssets', projectId, entityId: id });
}
