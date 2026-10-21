import { db } from '@/db';
import type JSZip from 'jszip';
import { readJson as readBackupJson, type ImportContext } from '@/engines/_shared/backupRegistry';
import { decodeManuscriptSources } from './portability';
import type { ManuscriptSourceRow } from './types';
const cache = new WeakMap<JSZip, Map<string, ManuscriptSourceRow[]>>();
export async function readManuscriptSourceBackup({ zip, projectDir, projectId }: ImportContext): Promise<ManuscriptSourceRow[]> {
  const existing = cache.get(zip)?.get(projectDir); if (existing) return existing;
  const prefix = `${projectDir}/writings/_sources/`, manifest = await readBackupJson<unknown>(zip, `${prefix}manifest.json`);
  if (manifest === null) return [];
  if (!Array.isArray(manifest)) throw Error('manuscript_source_manifest_invalid');
  const rows = [];
  for (const row of manifest) {
    if (!row || typeof row.id !== 'string' || row.original?.path !== `${prefix}${encodeURIComponent(row.id)}.bin` || typeof row.original.mime !== 'string') throw Error('manuscript_source_path_invalid');
    const entry = zip.file(row.original.path); if (!entry) throw Error('manuscript_source_bytes_missing');
    rows.push({ ...row, original: new Blob([Uint8Array.from(await entry.async('uint8array'))], { type: row.original.mime }) });
  }
  const decoded = await decodeManuscriptSources(rows, projectId);
  if (!cache.has(zip)) cache.set(zip, new Map()); cache.get(zip)!.set(projectDir, decoded); return decoded;
}
export async function exportManuscriptSourceBackup({ zip, projectDir, projectId }: ImportContext) {
  const rows = await db.manuscriptSources.where('projectId').equals(projectId).toArray(), manifest = [];
  for (const row of rows) { const path = `${projectDir}/writings/_sources/${encodeURIComponent(row.id)}.bin`; zip.file(path, await row.original.arrayBuffer()); manifest.push({ ...row, original: { path, mime: row.original.type } }); }
  if (rows.length) zip.file(`${projectDir}/writings/_sources/manifest.json`, JSON.stringify(manifest));
}
