import { MAX_MEDIA_BYTES, MAX_PROJECT_MEDIA_BYTES, mediaKind, type LocalMediaAsset } from './types';
import { validateVoiceMeta } from './voiceValidation';
export interface PortableLocalMedia extends Omit<LocalMediaAsset, 'blob'> { dataUrl: string }
export async function encodeLocalMedia(asset: LocalMediaAsset): Promise<PortableLocalMedia> {
  const bytes = new Uint8Array(await asset.blob.arrayBuffer()); let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  const { blob: _blob, ...metadata } = asset; void _blob;
  return { ...metadata, dataUrl: `data:${asset.mime};base64,${btoa(binary)}` };
}
/** Validated before a clone transaction opens; no URL is ever fetched. */
export function decodeLocalMedia(rows: PortableLocalMedia[], projectId: string): LocalMediaAsset[] {
  if (!Array.isArray(rows)) throw new Error('Invalid media list.');
  const ids = new Set<string>(); let total = 0;
  return rows.map(row => {
    if (!row || row.projectId !== projectId || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.title !== 'string' || typeof row.notes !== 'string' || !Array.isArray(row.tags) || row.tags.some(tag => typeof tag !== 'string') || !Array.isArray(row.linkedEntryIds) || row.linkedEntryIds.some(id => typeof id !== 'string') || !mediaKind(row.mime) || !Number.isSafeInteger(row.size) || row.size <= 0 || row.size > MAX_MEDIA_BYTES || typeof row.dataUrl !== 'string') throw new Error('Invalid portable media.');
    ids.add(row.id); total += row.size; if (total > MAX_PROJECT_MEDIA_BYTES) throw new Error('Media capacity exceeded.');
    if(row.voiceMemo){if(mediaKind(row.mime)!=='audio')throw new Error('Invalid voice memo media.');validateVoiceMeta(row.voiceMemo);}
    const prefix = `data:${row.mime};base64,`; if (!row.dataUrl.startsWith(prefix) || row.dataUrl.length > prefix.length + Math.ceil(row.size / 3) * 4 + 4) throw new Error('Invalid media bytes.');
    const encoded = row.dataUrl.slice(prefix.length); if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid media base64.');
    const binary = atob(encoded); if (binary.length !== row.size) throw new Error('Truncated media.');
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const { dataUrl: _dataUrl, ...metadata } = row; void _dataUrl;
    return { ...metadata, kind: mediaKind(row.mime)!, blob: new Blob([bytes], { type: row.mime }) };
  });
}
