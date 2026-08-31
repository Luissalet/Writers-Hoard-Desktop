// ============================================================================
// AI runtime — verified downloads (main process)
// ============================================================================
//
// One way to bring a pinned file onto the disk: stream it to `<target>.part`,
// hash it as it arrives, resume with a Range request when a previous attempt
// left a partial file, refuse anything whose size or SHA-256 disagrees with
// the pin, and only then rename it into place. Used for the image runtime
// archives and the multi-gigabyte model weights, where a resume is the
// difference between an evening and a retry.

import { net } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

export interface DownloadSpec {
  url: string;
  target: string;
  sizeBytes: number;
  sha256: string;
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  /** Milliseconds between progress callbacks; the final one is always sent. */
  progressIntervalMs?: number;
}

export class DownloadError extends Error {
  code: 'cancelled' | 'http' | 'size-mismatch' | 'integrity' | 'write-failed' | 'network';

  constructor(code: DownloadError['code'], message: string) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
  }
}

async function hashExisting(file: string): Promise<{ bytes: number; digest: ReturnType<typeof createHash> } | null> {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size === 0) return null;
  const digest = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on('data', (chunk: Buffer | string) => digest.update(chunk))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return { bytes: stat.size, digest };
}

/**
 * Download `spec.url` to `spec.target`, verified. Resolves when the file is
 * in place; throws DownloadError otherwise. A partial file from an earlier
 * run is resumed when the server honours Range, restarted when it does not.
 */
export async function downloadVerified(spec: DownloadSpec, options: DownloadOptions = {}): Promise<void> {
  const part = `${spec.target}.part`;
  await fs.mkdir(path.dirname(spec.target), { recursive: true });
  const { signal } = options;
  const interval = options.progressIntervalMs ?? 150;
  let lastReport = 0;
  const report = (received: number, force = false): void => {
    const now = Date.now();
    if (!force && now - lastReport < interval) return;
    lastReport = now;
    options.onProgress?.({ receivedBytes: received, totalBytes: spec.sizeBytes });
  };

  // Resume: hash whatever is already on disk so the final digest covers it.
  let digest = createHash('sha256');
  let received = 0;
  const existing = await hashExisting(part);
  if (existing && existing.bytes < spec.sizeBytes) {
    digest = existing.digest;
    received = existing.bytes;
  } else if (existing && existing.bytes === spec.sizeBytes) {
    // A previous run got every byte and died before the rename (or during the
    // hash). If it checks out, it is the file: put it in place instead of
    // fetching gigabytes again.
    if (existing.digest.digest('hex') === spec.sha256.toLowerCase()) {
      await fs.rm(spec.target, { force: true });
      await fs.rename(part, spec.target);
      report(spec.sizeBytes, true);
      return;
    }
    await fs.rm(part, { force: true });
  } else if (existing) {
    await fs.rm(part, { force: true });
  }

  const headers: Record<string, string> = {};
  if (received > 0) headers.Range = `bytes=${received}-`;
  let res: Response;
  try {
    res = await net.fetch(spec.url, { headers, signal, redirect: 'follow' });
  } catch (err) {
    if (signal?.aborted) throw new DownloadError('cancelled', 'Cancelled.');
    throw new DownloadError('network', err instanceof Error ? err.message : String(err));
  }
  // Anything we throw below leaves the response body undrained; cancel it so
  // the underlying Chromium socket is released now rather than at GC.
  const bail = async (error: DownloadError): Promise<never> => {
    await res.body?.cancel().catch(() => undefined);
    throw error;
  };
  // A 206 is only a resume when it continues exactly where the file ends:
  // Content-Range must start at `received`. Anything else (a proxy answering a
  // different range, a server that says 206 to everything) would be appended
  // at the wrong offset and only fail the checksum after the whole download.
  const rangeStart = res.status === 206 ? contentRangeStart(res.headers.get('content-range')) : null;
  if (received > 0 && (res.status !== 206 || rangeStart !== received)) {
    // The server ignored (or mangled) the range: start over cleanly.
    await fs.rm(part, { force: true });
    digest = createHash('sha256');
    received = 0;
    if (res.status === 200 && res.body) {
      // Fall through with the full body.
    } else if (res.status === 206) {
      await bail(new DownloadError('http', `The server resumed at the wrong offset (${res.headers.get('content-range') ?? 'no Content-Range'}); retry to start over.`));
    } else {
      await bail(new DownloadError('http', `HTTP ${res.status}`));
    }
  } else if (!res.ok || !res.body) {
    await bail(new DownloadError('http', `HTTP ${res.status}`));
  }
  const contentLength = Number(res.headers.get('content-length')) || null;
  if (contentLength && received + contentLength !== spec.sizeBytes) {
    await bail(new DownloadError('size-mismatch', `The server offers ${received + contentLength} bytes; ${spec.sizeBytes} were expected.`));
  }

  const handle = await fs.open(part, received > 0 ? 'a' : 'w');
  const reader = res.body!.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > spec.sizeBytes) throw new DownloadError('size-mismatch', 'The server sent more bytes than expected.');
      digest.update(value);
      let offset = 0;
      while (offset < value.byteLength) {
        const written = await handle.write(value, offset, value.byteLength - offset);
        if (written.bytesWritten <= 0) throw new DownloadError('write-failed', 'Could not write to disk.');
        offset += written.bytesWritten;
      }
      report(received);
    }
  } catch (err) {
    if (signal?.aborted) throw new DownloadError('cancelled', 'Cancelled.');
    if (err instanceof DownloadError) throw err;
    throw new DownloadError('network', err instanceof Error ? err.message : String(err));
  } finally {
    await handle.close();
    await reader.cancel().catch(() => undefined);
  }
  report(received, true);

  if (received !== spec.sizeBytes) throw new DownloadError('size-mismatch', `Received ${received} of ${spec.sizeBytes} bytes.`);
  const actual = digest.digest('hex');
  if (actual !== spec.sha256.toLowerCase()) {
    await fs.rm(part, { force: true });
    throw new DownloadError('integrity', 'The downloaded file does not match its published checksum and was discarded.');
  }
  await fs.rm(spec.target, { force: true });
  await fs.rename(part, spec.target);
}

/** The first byte a `Content-Range: bytes <start>-<end>/<total>` header covers; null when malformed. */
export function contentRangeStart(header: string | null): number | null {
  if (!header) return null;
  const match = /^\s*bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i.exec(header);
  if (!match) return null;
  const start = Number(match[1]);
  return Number.isSafeInteger(start) ? start : null;
}

/** Verify a file already on disk against its pin (size first, hash second). */
export async function verifyFile(file: string, sizeBytes: number, sha256: string): Promise<boolean> {
  const existing = await hashExisting(file);
  if (!existing || existing.bytes !== sizeBytes) return false;
  return existing.digest.digest('hex') === sha256.toLowerCase();
}
