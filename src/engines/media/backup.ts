import { db } from '@/db';
import type JSZip from 'jszip';
import { readBinary, readJson, type BackupStrategy } from '@/engines/_shared/backupRegistry';
import { MAX_MEDIA_BYTES, MAX_PROJECT_MEDIA_BYTES, mediaKind, type LocalMediaAsset } from './types';
type ArchiveAsset = Omit<LocalMediaAsset, 'blob'> & { file: string };
const fileFor = (id: string) => `assets/${encodeURIComponent(id)}.bin`;
// Construct Blob handles during read-only preflight, before the restore's IDB transaction.
const PREPARED = new WeakMap<JSZip, Map<string, LocalMediaAsset[]>>();
async function rows(zip: JSZip, projectDir: string): Promise<LocalMediaAsset[]> {
  const descriptors = await readJson<ArchiveAsset[]>(zip, `${projectDir}/media/index.json`) ?? [];
  if (!Array.isArray(descriptors)) throw new Error('Invalid media manifest.');
  const result: LocalMediaAsset[] = [];
  let total = 0;
  for (const row of descriptors) {
    if (!row || typeof row.id !== 'string' || typeof row.projectId !== 'string' || typeof row.title !== 'string' || row.file !== fileFor(row.id) || !mediaKind(row.mime) || !Number.isSafeInteger(row.size) || row.size <= 0 || row.size > MAX_MEDIA_BYTES || !Array.isArray(row.tags) || row.tags.some(tag => typeof tag !== 'string') || !Array.isArray(row.linkedEntryIds) || row.linkedEntryIds.some(id => typeof id !== 'string') || typeof row.notes !== 'string') throw new Error('Invalid media record.');
    total += row.size; if (total > MAX_PROJECT_MEDIA_BYTES) throw new Error('Media archive exceeds project capacity.');
    const bytes = await readBinary(zip, `${projectDir}/media/${row.file}`);
    if (!bytes || bytes.byteLength !== row.size) throw new Error('Media bytes are missing or truncated.');
    const { file: _file, ...metadata } = row;
    void _file;
    result.push({ ...metadata, kind: mediaKind(row.mime)!, blob: new Blob([new Uint8Array(bytes)], { type: row.mime }) });
  }
  return result;
}
export const mediaBackup: Omit<BackupStrategy, 'engineId' | 'tables'> = {
  async exportProject({ zip, projectId, projectDir }) {
    const assets = await db.localMediaAssets.where('projectId').equals(projectId).toArray();
    const descriptors: ArchiveAsset[] = [];
    for (const asset of assets) {
      const { blob, ...metadata } = asset;
      const file = fileFor(asset.id); zip.file(`${projectDir}/media/${file}`, await blob.arrayBuffer()); descriptors.push({ ...metadata, file });
    }
    zip.file(`${projectDir}/media/index.json`, JSON.stringify(descriptors, null, 2));
  },
  async inspectImport({ zip, projectDir }) {
    const assets = await rows(zip, projectDir);
    const projects = PREPARED.get(zip) ?? new Map<string, LocalMediaAsset[]>(); projects.set(projectDir, assets); PREPARED.set(zip, projects);
    return [{ table: 'localMediaAssets', path: `${projectDir}/media/index.json`, rows: assets }];
  },
  async importProject({ zip, projectDir }) {
    const assets = PREPARED.get(zip)?.get(projectDir);
    if (!assets) throw new Error('Media must pass read-only preflight before restore.');
    if (assets.length) await db.localMediaAssets.bulkPut(assets);
  },
};
