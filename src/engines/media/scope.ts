import { db } from '@/db';
import { getEraProject, hideEraDocument, listEraRows, readEraRow, readWorldDocument, saveEraMetadata, type WorldEraWriteOptions } from '@/services/worldEras/store';
import type { EraRow } from '@/services/worldEras/types';
import type { LocalMediaAsset } from './types';

export async function mediaRows(projectId: string, eraId?: string): Promise<LocalMediaAsset[]> {
  await getEraProject({ projectId, eraId });
  return listEraRows<LocalMediaAsset>({ projectId, eraId }, 'localMediaAssets');
}
export async function mediaAsset(projectId: string, id: string, eraId?: string): Promise<LocalMediaAsset | undefined> {
  const row = await readEraRow<LocalMediaAsset>({ projectId, eraId }, 'localMediaAssets', id);
  return row?.projectId === projectId ? row : undefined;
}
/** The era store owns immutable byte deduplication and compare-and-swap. */
export async function saveMediaAsset(projectId: string, row: LocalMediaAsset, previous: LocalMediaAsset | null, eraId?: string, options?: WorldEraWriteOptions): Promise<LocalMediaAsset> {
  if (eraId) return await saveEraMetadata({ projectId, eraId }, 'media', row as unknown as EraRow, previous as unknown as EraRow | null, options) as unknown as LocalMediaAsset;
  await db.localMediaAssets.put(row);
  await db.projects.update(projectId, { updatedAt: row.updatedAt });
  return row;
}
export async function removeMediaAsset(projectId: string, id: string, eraId?: string): Promise<void> {
  if (eraId) {
    const current = await readWorldDocument({ projectId, eraId }, 'media', id);
    if (current) await hideEraDocument({ projectId, eraId }, 'media', id, current.version);
  } else if (await mediaAsset(projectId, id)) await db.localMediaAssets.delete(id);
}
