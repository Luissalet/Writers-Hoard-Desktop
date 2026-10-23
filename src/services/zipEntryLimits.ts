// ============================================================================
// Reading a zip entry without trusting it
//
// A hostile archive can declare a small entry and inflate to gigabytes (a zip
// bomb), or hold thousands of entries that are small one by one. These helpers
// refuse before and while decompressing: the declared size is checked first and
// the real bytes are counted as they come out, aborting the moment a limit is
// crossed. Nothing here depends on the caller's format (ePub, folder import).
// ============================================================================
import type JSZip from 'jszip';

export class ZipLimitError extends Error {
  readonly path: string;
  constructor(path: string) { super(`zip_entry_too_large:${path}`); this.name = 'ZipLimitError'; this.path = path; }
}

interface StreamLike {
  on(event: 'data', handler: (chunk: Uint8Array) => void): StreamLike;
  on(event: 'error', handler: (error: unknown) => void): StreamLike;
  on(event: 'end', handler: () => void): StreamLike;
  pause(): StreamLike;
  resume(): StreamLike;
}
type EntryInternals = { internalStream?: (type: 'uint8array') => StreamLike; _data?: { uncompressedSize?: number } };

/** Size the archive declares for an entry (undefined when the library does not expose it). */
export function declaredEntrySize(entry: JSZip.JSZipObject): number | undefined {
  const size = (entry as unknown as EntryInternals)._data?.uncompressedSize;
  return typeof size === 'number' && Number.isFinite(size) ? size : undefined;
}

/** A running allowance shared by every entry of one archive (or of one import). */
export interface ZipBudget { remaining: number }

/**
 * The entry's bytes, never more than `limit` and never more than the shared budget allows.
 * Refuses on the declared size first, then counts the bytes actually inflated and stops reading as soon as it is exceeded.
 */
export async function readZipEntryBytes(entry: JSZip.JSZipObject, limit: number, budget?: ZipBudget): Promise<Uint8Array> {
  const cap = Math.min(limit, budget ? budget.remaining : limit);
  const declared = declaredEntrySize(entry);
  if (declared !== undefined && declared > cap) throw new ZipLimitError(entry.name);
  const stream = (entry as unknown as EntryInternals).internalStream;
  if (typeof stream !== 'function') {
    // Without a stream the declared size is all there is to check before decompressing; check again after.
    const bytes = await entry.async('uint8array');
    if (bytes.length > cap) throw new ZipLimitError(entry.name);
    if (budget) budget.remaining -= bytes.length;
    return bytes;
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0, settled = false;
    const source = stream.call(entry, 'uint8array');
    source.on('data', chunk => {
      if (settled) return;
      total += chunk.length;
      if (total > cap) { settled = true; source.pause(); reject(new ZipLimitError(entry.name)); return; }
      chunks.push(chunk);
    });
    source.on('error', error => { if (!settled) { settled = true; reject(error); } });
    source.on('end', () => {
      if (settled) return;
      settled = true;
      const out = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
      if (budget) budget.remaining -= total;
      resolve(out);
    });
    source.resume();
  });
}
