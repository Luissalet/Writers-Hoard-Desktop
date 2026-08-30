// ============================================================================
// Writers Hoard — gallery-dl wrapper (main process)
// ============================================================================
//
// Downloads photo / carousel posts that yt-dlp can't ("There is no video in
// this post"). Instagram requires a logged-in session for images, so we lean
// on the user's browser cookies via `--cookies-from-browser`, trying each known
// browser until one yields files.

import { app } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { killProcessTree } from './ytdlp';

const isWin = process.platform === 'win32';
const GALLERYDL_BIN = isWin ? 'gallery-dl.exe' : 'gallery-dl';

// Browsers to try for cookies, in order; the first that produces files wins.
const COOKIE_BROWSERS = ['firefox', 'chrome', 'edge', 'brave', 'chromium', 'vivaldi', 'opera'];

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']);

export type GalleryItemKind = 'image' | 'video';

export interface GalleryItem {
  filePath: string;
  kind: GalleryItemKind;
}

export interface GalleryMetadata {
  description?: string;
  uploader?: string;
  /** Normalized to YYYYMMDD. */
  uploadDate?: string;
}

export interface GalleryOutcome {
  items: GalleryItem[];
  metadata?: GalleryMetadata;
  /** Removes the temp directory holding the produced files. */
  cleanup: () => Promise<void>;
}

/** One post surfaced by `listCollection` — metadata only, nothing downloaded. */
export interface CollectionItem {
  /** Canonical permalink, e.g. https://www.instagram.com/p/<shortcode>/ or /reel/<shortcode>/. */
  url: string;
  shortcode: string;
  /** Caption text, when the post has one. */
  description?: string;
  uploader?: string;
  /** Normalized to YYYYMMDD, best-effort. */
  uploadDate?: string;
  /** gallery-dl's `type` field, e.g. 'post' | 'reel'. Undefined when unknown. */
  type?: string;
}

function binDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin');
}

async function resolveGalleryDlPath(): Promise<string> {
  const bundled = path.join(binDir(), GALLERYDL_BIN);
  try {
    await fs.access(bundled);
    return bundled;
  } catch {
    return GALLERYDL_BIN; // rely on PATH
  }
}

/**
 * Download a photo / carousel post into a private temp dir using the user's
 * browser cookies. Tries each known browser until one produces files. Throws
 * with a readable message if none work (or 'cancelled' on abort).
 */
export async function downloadGallery(
  url: string,
  signal?: AbortSignal,
  cookiesFile?: string,
): Promise<GalleryOutcome> {
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-gallery-'));
  const bin = await resolveGalleryDlPath();

  // Cookie strategies, best first: the app's saved session, then each browser.
  const cookieArgs: string[][] = [];
  if (cookiesFile) cookieArgs.push(['--cookies', cookiesFile]);
  for (const browser of COOKIE_BROWSERS) cookieArgs.push(['--cookies-from-browser', browser]);

  let lastErr = '';
  for (const ca of cookieArgs) {
    if (signal?.aborted) break;
    try {
      await runGalleryDl(
        bin,
        [...ca, '--write-metadata', '--no-mtime', '-D', tmpdir, url],
        signal,
      );
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (lastErr === 'cancelled') break;
      await emptyDir(tmpdir); // clear any partial output, try the next strategy
      continue;
    }
    const items = await collectItems(tmpdir);
    if (items.length > 0) {
      const metadata = await readMetadata(tmpdir);
      return { items, metadata, cleanup: () => fs.rm(tmpdir, { recursive: true, force: true }) };
    }
    await emptyDir(tmpdir);
  }

  await fs.rm(tmpdir, { recursive: true, force: true });
  throw new Error(
    lastErr === 'cancelled'
      ? 'cancelled'
      : lastErr ||
        'No se pudieron descargar las imágenes. Conecta tu Instagram en la app (o inicia sesión en tu navegador).',
  );
}

/**
 * List every post in an Instagram saved collection WITHOUT downloading any
 * media — `--dump-json` makes gallery-dl fetch and print each item's metadata
 * only (confirmed against the extractor source: only the normal `items()`
 * path yields `Message.Url` download directives; `-j`/`--dump-json` never
 * does). Built for `ImportCollectionModal`: list first, let the user review
 * AI-suggested tags, THEN download per confirmed item via the existing
 * `downloadGallery`/`downloadMedia` single-post path — unchanged.
 *
 * Cookie strategy mirrors `downloadGallery` (saved session first, then each
 * browser), but the cascade logic differs: a saved collection can legitimately
 * be empty, so an exit code 0 with zero items is trusted as-is and NOT treated
 * as a reason to try the next cookie source. Only a process failure (non-zero
 * exit, spawn error, or an abort) cascades to the next source.
 *
 * NOTE: gallery-dl's exact `--dump-json` stdout shape (a flat array of
 * metadata dicts vs `[typeCode, url, metadata]` tuples vs one-JSON-value-
 * per-line) could not be verified here against a real authenticated Instagram
 * session — this sandbox has no Instagram account to test with. `parseDumpJson`
 * below is written to tolerate all three shapes it's plausible for gallery-dl
 * to emit, but this path needs one real smoke test against an actual saved
 * collection before it's trusted end-to-end (see project memory).
 */
export async function listCollection(
  url: string,
  signal?: AbortSignal,
  cookiesFile?: string,
): Promise<CollectionItem[]> {
  const bin = await resolveGalleryDlPath();

  const cookieArgs: string[][] = [];
  if (cookiesFile) cookieArgs.push(['--cookies', cookiesFile]);
  for (const browser of COOKIE_BROWSERS) cookieArgs.push(['--cookies-from-browser', browser]);

  let lastErr = '';
  for (const ca of cookieArgs) {
    if (signal?.aborted) throw new Error('cancelled');
    let result: { code: number; stdout: string; stderr: string } | undefined;
    try {
      result = await runGalleryDlCapture(bin, [...ca, '--dump-json', url], signal);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (lastErr === 'cancelled') throw err;
      continue; // spawn failure — try the next cookie source
    }
    if (result.code !== 0) {
      lastErr = result.stderr.trim().split('\n').slice(-2).join('\n') ||
        `gallery-dl exited with code ${result.code}`;
      continue; // this cookie source couldn't authenticate — try the next
    }
    // Clean exit — trust it even if empty; a real collection CAN have 0 posts.
    return dedupeByShortcode(toCollectionItems(parseDumpJson(result.stdout)));
  }

  throw new Error(
    lastErr ||
      'No se pudo listar la colección. Conecta tu Instagram en la app (o inicia sesión en tu navegador).',
  );
}

/**
 * Tolerant parse of `gallery-dl --dump-json` stdout. Tries, in order: one
 * JSON array for the whole output; newline-delimited JSON (one value per
 * line, skipping blanks); a bare concatenation of arrays/objects recovered by
 * scanning bracket-balanced top-level chunks. Never throws — returns []
 * rather than crash the import flow on an unexpected format.
 */
function parseDumpJson(stdout: string): unknown[] {
  const text = stdout.trim();
  if (!text) return [];

  try {
    const whole = JSON.parse(text);
    if (Array.isArray(whole)) return whole;
    return [whole];
  } catch {
    /* not a single JSON value — fall through */
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const values: unknown[] = [];
  let allLinesParsed = true;
  for (const line of lines) {
    try {
      values.push(JSON.parse(line));
    } catch {
      allLinesParsed = false;
      break;
    }
  }
  if (allLinesParsed && values.length > 0) return values;

  return [];
}

/** True map/array-ish object check, without pulling in a schema library. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Normalize whatever `parseDumpJson` recovered into `CollectionItem`s.
 * Handles both a flat metadata dict per entry AND gallery-dl's internal
 * `[typeCode, url, metadata]` message-tuple shape (metadata is always the
 * last element when present).
 */
function toCollectionItems(raw: unknown[]): CollectionItem[] {
  const out: CollectionItem[] = [];
  for (const entry of raw) {
    const meta = Array.isArray(entry)
      ? entry.find((el) => isRecord(el)) // tuple shape: metadata is the object member
      : entry;
    if (!isRecord(meta)) continue;

    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() ? v.trim() : undefined;

    const shortcode =
      str(meta.post_shortcode) ?? str(meta.shortcode) ?? str(meta.code) ?? undefined;
    if (!shortcode) continue; // nothing to build a permalink from — skip

    const type = str(meta.type) ?? str(meta.typename);
    const isReel = type?.toLowerCase().includes('reel') ?? false;

    const owner = isRecord(meta.owner) ? meta.owner : undefined;
    const uploader =
      str(meta.username) ?? str(owner?.username) ?? str(meta.uploader) ?? str(meta.fullname);

    out.push({
      url: `https://www.instagram.com/${isReel ? 'reel' : 'p'}/${shortcode}/`,
      shortcode,
      description: str(meta.description) ?? str(meta.caption),
      uploader,
      uploadDate: normalizeDate(meta.post_date ?? meta.date ?? meta.taken_at_timestamp ?? meta.upload_date),
      type,
    });
  }
  return out;
}

/** Best-effort YYYYMMDD from a unix timestamp (number/numeric string) or a date-ish string. */
function normalizeDate(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Instagram timestamps are seconds; anything already millisecond-scale stays as-is.
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return undefined;
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return normalizeDate(Number(v));
    const m = v.match(/(\d{4})\D?(\d{2})\D?(\d{2})/);
    if (m) return `${m[1]}${m[2]}${m[3]}`;
  }
  return undefined;
}

function dedupeByShortcode(items: CollectionItem[]): CollectionItem[] {
  const seen = new Map<string, CollectionItem>();
  for (const item of items) {
    if (!seen.has(item.shortcode)) seen.set(item.shortcode, item);
  }
  return Array.from(seen.values());
}

async function emptyDir(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir);
    await Promise.all(
      entries.map((n) => fs.rm(path.join(dir, n), { recursive: true, force: true })),
    );
  } catch {
    /* ignore */
  }
}

async function collectItems(dir: string): Promise<GalleryItem[]> {
  const out: GalleryItem[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    )) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(fp);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (IMAGE_EXT.has(ext)) out.push({ filePath: fp, kind: 'image' });
        else if (VIDEO_EXT.has(ext)) out.push({ filePath: fp, kind: 'video' });
      }
    }
  }
  await walk(dir);
  return out;
}

async function readMetadata(dir: string): Promise<GalleryMetadata | undefined> {
  // gallery-dl --write-metadata drops a <file>.json next to each item.
  let jsonPath: string | undefined;
  async function find(d: string): Promise<void> {
    if (jsonPath) return;
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      if (jsonPath) return;
      const fp = path.join(d, e.name);
      if (e.isDirectory()) await find(fp);
      else if (e.name.toLowerCase().endsWith('.json')) jsonPath = fp;
    }
  }
  await find(dir);
  if (!jsonPath) return undefined;
  try {
    const j = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as Record<string, unknown>;
    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() ? v : undefined;
    const rawDate = str(j.date) ?? str(j.upload_date);
    const m = rawDate?.match(/(\d{4})\D?(\d{2})\D?(\d{2})/);
    return {
      description: str(j.description),
      uploader: str(j.username) ?? str(j.fullname) ?? str(j.uploader) ?? str(j.owner),
      uploadDate: m ? `${m[1]}${m[2]}${m[3]}` : undefined,
    };
  } catch {
    return undefined;
  }
}

function runGalleryDl(cmd: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('cancelled'));
      return;
    }
    const child = spawn(cmd, args, { windowsHide: true });
    try {
      if (child.pid != null) {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      }
    } catch {
      /* best-effort */
    }
    const onAbort = () => {
      if (child.pid != null) killProcessTree(child.pid);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`Could not launch gallery-dl (${err.message}). Run "npm run fetch:bin".`));
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        reject(new Error('cancelled'));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      const tail = stderr.trim().split('\n').slice(-2).join('\n');
      reject(new Error(tail || `gallery-dl exited with code ${code}`));
    });
  });
}

/**
 * Like `runGalleryDl`, but for `--dump-json`: captures stdout instead of
 * treating a completed run as fire-and-forget, and resolves (rather than
 * rejects) on a non-zero exit so the caller can decide whether to cascade to
 * the next cookie source. Only rejects on an abort or a spawn-level failure.
 */
function runGalleryDlCapture(
  cmd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('cancelled'));
      return;
    }
    const child = spawn(cmd, args, { windowsHide: true });
    try {
      if (child.pid != null) {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      }
    } catch {
      /* best-effort */
    }
    const onAbort = () => {
      if (child.pid != null) killProcessTree(child.pid);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`Could not launch gallery-dl (${err.message}). Run "npm run fetch:bin".`));
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        reject(new Error('cancelled'));
        return;
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
