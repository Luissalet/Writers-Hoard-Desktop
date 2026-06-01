// ============================================
// Media Downloader — typed client for the Python yt-dlp HTTP wrapper
// ============================================
//
// Backend lives in `Universal video downloader/server.py` (Flask + yt-dlp).
// Endpoints:
//   GET  /api/health              -> { ok, platforms }
//   POST /api/detect    {url}     -> { platform }
//   POST /api/download  {url, format} -> stream of bytes (application/octet-stream)
//
// The base URL is configurable via the `VITE_MEDIA_DOWNLOADER_URL` env var.
// Defaults to http://localhost:8765, matching server.py's default port.

const DEFAULT_BASE_URL = 'http://localhost:8765';

function getBaseUrl(): string {
  const fromEnv = (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }).env?.VITE_MEDIA_DOWNLOADER_URL;
  return (fromEnv || DEFAULT_BASE_URL).replace(/\/$/, '');
}

export type MediaFormat = 'video' | 'audio';

export type MediaPlatform =
  | 'YouTube'
  | 'X (Twitter)'
  | 'Instagram'
  | 'Audiomack'
  | 'Desconocida'
  | string;

export interface HealthResponse {
  ok: boolean;
  platforms: string[];
}

export interface DownloadResult {
  filename: string;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function checkHealth(signal?: AbortSignal): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/health`, {
      method: 'GET',
      signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as HealthResponse;
    return json;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Detect
// ---------------------------------------------------------------------------

export async function detectPlatform(url: string): Promise<MediaPlatform> {
  const res = await fetch(`${getBaseUrl()}/api/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `detect failed (${res.status})`);
  }
  const json = (await res.json()) as { platform: MediaPlatform };
  return json.platform;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Extract a filename from a Content-Disposition header.
 * Supports both `filename="..."` and RFC 5987 `filename*=UTF-8''...`.
 */
function parseFilename(header: string | null, fallback: string): string {
  if (!header) return fallback;
  // Prefer the RFC 5987 form (handles non-ASCII)
  const star = /filename\*\s*=\s*([^']*)''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2]);
    } catch {
      // fall through
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : fallback;
}

/**
 * Download `url` via the backend and write the resulting file directly
 * into the given directory handle (File System Access API).
 *
 * Returns the final filename + size for UI feedback.
 */
export async function downloadToDirectory(
  url: string,
  format: MediaFormat,
  directoryHandle: FileSystemDirectoryHandle,
  opts?: { signal?: AbortSignal },
): Promise<DownloadResult> {
  const res = await fetch(`${getBaseUrl()}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, format }),
    signal: opts?.signal,
  });

  if (!res.ok) {
    let message = `download failed (${res.status})`;
    try {
      const errBody = await res.json();
      if (errBody?.error) message = errBody.error;
    } catch {
      // body not JSON — keep generic message
    }
    throw new Error(message);
  }

  if (!res.body) {
    throw new Error('download response has no body');
  }

  const filename = parseFilename(
    res.headers.get('Content-Disposition'),
    `download-${Date.now()}`,
  );

  // Create / overwrite the file inside the chosen folder.
  const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();

  let sizeBytes = 0;
  try {
    const reader = res.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        await writable.write(value);
        sizeBytes += value.byteLength;
      }
    }
    await writable.close();
  } catch (e) {
    try {
      await writable.abort();
    } catch {
      // ignore secondary error
    }
    throw e;
  }

  return { filename, sizeBytes };
}

// ---------------------------------------------------------------------------
// Capability check
// ---------------------------------------------------------------------------

export function supportsDirectoryPicker(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}
