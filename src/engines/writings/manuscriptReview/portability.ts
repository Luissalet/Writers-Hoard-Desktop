import type { ManuscriptSourceRow } from './sourceTypes';
export { cloneManuscriptSource, cloneManuscriptWritingSource, cloneImportedCommentOrigin, validateImportedCommentOrigin } from './sourceMetadata';
import { sha256Hex } from '@/services/judge/text';
import { base64FromBytes, bytesFromBase64 } from '@/services/documents/client';
export type PortableManuscriptSource = Omit<ManuscriptSourceRow, 'original'> & { original: { base64: string; mime: string } };
export async function encodeManuscriptSource(row: ManuscriptSourceRow): Promise<PortableManuscriptSource> {
  return { ...row, original: { base64: base64FromBytes(new Uint8Array(await row.original.arrayBuffer())), mime: row.original.type } };
}
export async function decodeManuscriptSources(value: unknown, projectId: string, eras?: ReadonlySet<string>): Promise<ManuscriptSourceRow[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw Error('manuscript_sources_invalid');
  const ids = new Set<string>(), rows: ManuscriptSourceRow[] = [];
  for (const input of value) {
    if (!input || typeof input !== 'object') throw Error('manuscript_source_invalid');
    const row = input as ManuscriptSourceRow;
    if (typeof row.id !== 'string' || !row.id || ids.has(row.id) || row.projectId !== projectId || typeof row.name !== 'string' || typeof row.format !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.revision) || row.revision < 0 || !Number.isFinite(row.createdAt) || !Array.isArray(row.receipts)) throw Error('manuscript_source_invalid');
    const bytes = input.original;
    const original = bytes instanceof Blob ? bytes : bytes && typeof bytes.base64 === 'string' && typeof bytes.mime === 'string' ? new Blob([bytesFromBase64(bytes.base64)], { type: bytes.mime }) : undefined;
    if (!original || await sha256Hex(await original.arrayBuffer()) !== row.sha256) throw Error('manuscript_source_hash_invalid');
    for (const receipt of row.receipts) if (!receipt || typeof receipt.id !== 'string' || !receipt.id || !Number.isFinite(receipt.createdAt) || !/^[a-f0-9]{64}$/.test(receipt.planDigest) || !Array.isArray(receipt.writingIds) || receipt.writingIds.some(id => typeof id !== 'string' || !id) || receipt.eraId !== undefined && (typeof receipt.eraId !== 'string' || eras && !eras.has(receipt.eraId))) throw Error('manuscript_receipt_invalid');
    ids.add(row.id); rows.push({ ...row, original });
  }
  return rows;
}
