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
