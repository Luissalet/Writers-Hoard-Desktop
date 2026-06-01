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
//
// `downloadInBrowser()` triggers a normal browser download: the file lands
// in the user's configured Downloads folder. If the user has the
// "Ask where to save each file before downloading" browser setting enabled
// (Chrome / Edge / Firefox all support this), Windows' native save-as
// dialog appears instead. We do NOT use the File System Access API.

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
// Download (browser-native save-as)
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
 * Trigger a browser download for the given media URL.
 *
 * Flow: fetch the backend response (which streams the file with
 * Content-Disposition: attachment), buffer it as a Blob, then click
 * an `<a download>` link with an object URL. The browser handles the
 * save location — it goes to the user's Downloads folder by default,
 * or shows the OS save-as dialog if "Ask where to save each file" is
 * enabled in browser settings.
 *
 * We buffer in memory because a streaming `<a download>` would require
 * a GET endpoint with the URL in the query string, exposing it in
 * browser history / server logs. For typical yt-dlp output sizes
 * (audio: ~5 MB, video: tens to a few hundred MB) this is acceptable.
 */
export async function downloadInBrowser(
  url: string,
  format: MediaFormat,
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

  const filename = parseFilename(
    res.headers.get('Content-Disposition'),
    `download-${Date.now()}`,
  );

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Release the object URL on the next tick — Chrome needs a beat
    // to start the download before we can revoke the URL.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  return { filename, sizeBytes: blob.size };
}
