import { db } from '@/db';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { MAX_MEDIA_BYTES, MAX_PROJECT_MEDIA_BYTES, mediaKind, mediaMime, type LocalMediaAsset } from './types';

export async function importLocalMedia(projectId: string, file: File): Promise<LocalMediaAsset> {
  const mime = mediaMime(file); const kind = mediaKind(mime);
  if (!kind || !file.size || file.size > MAX_MEDIA_BYTES) throw new Error('invalid_media');
  const now = Date.now();
  const asset: LocalMediaAsset = { id: crypto.randomUUID(), projectId, title: file.name, kind, mime, blob: file.slice(0, file.size, mime), size: file.size, notes: '', tags: [], linkedEntryIds: [], createdAt: now, updatedAt: now };
  await db.transaction('rw', [db.projects, db.localMediaAssets], async () => {
    if (!await db.projects.get(projectId)) throw new Error('missing_project');
    const current = await db.localMediaAssets.where('projectId').equals(projectId).toArray();
    if (current.reduce((total, row) => total + row.size, 0) + file.size > MAX_PROJECT_MEDIA_BYTES) throw new Error('media_capacity');
    await db.localMediaAssets.add(asset);
    await db.projects.update(projectId, { updatedAt: now });
  });
  notifyDataChanged({ source: 'import', table: 'localMediaAssets', projectId, entityId: asset.id });
  return asset;
}

type MediaChanges = Pick<LocalMediaAsset, 'title' | 'notes' | 'tags' | 'linkedEntryIds'>;
export async function updateLocalMedia(projectId: string, id: string, changes: MediaChanges, base?: MediaChanges): Promise<void> {
  if (!changes.title.trim()) throw new Error('title_required');
  await db.transaction('rw', [db.projects, db.localMediaAssets, db.codexEntries], async () => {
    const asset = await db.localMediaAssets.get(id); if (!asset || asset.projectId !== projectId) throw new Error('missing_media');
    const merged = { ...changes };
    if (base) for (const field of ['title', 'notes', 'tags', 'linkedEntryIds'] as const) {
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      if (!same(changes[field], base[field]) && !same(asset[field], base[field]) && !same(asset[field], changes[field])) throw new Error('media_conflict');
      if (same(changes[field], base[field])) Object.assign(merged, { [field]: asset[field] });
    }
    const targets = await db.codexEntries.bulkGet(merged.linkedEntryIds);
    if (targets.some(entry => !entry || entry.projectId !== projectId)) throw new Error('invalid_link');
    const now = Date.now();
    await db.localMediaAssets.update(id, { ...merged, title: merged.title.trim(), updatedAt: now });
    await db.projects.update(projectId, { updatedAt: now });
  });
  notifyDataChanged({ source: 'other', table: 'localMediaAssets', projectId, entityId: id });
}

export async function deleteLocalMedia(projectId: string, id: string): Promise<void> {
  await db.transaction('rw', db.localMediaAssets, async () => {
    const asset = await db.localMediaAssets.get(id); if (asset && asset.projectId === projectId) await db.localMediaAssets.delete(id);
  });
  notifyDataChanged({ source: 'other', table: 'localMediaAssets', projectId, entityId: id });
}
