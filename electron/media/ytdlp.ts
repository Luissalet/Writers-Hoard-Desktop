// ============================================================================
// Writers Hoard — yt-dlp wrapper (main process)
// ============================================================================
//
// Replaces the standalone Python/Flask downloader. Spawns a bundled `yt-dlp`
// binary directly and uses ffmpeg-static for muxing/extraction. No Python
// runtime, no separate server to start, no CORS hoops.
//
// Binary resolution:
//   • packaged  → <resources>/bin/yt-dlp[.exe]   (electron-builder extraResources)
//   • dev       → <repo>/resources/bin/yt-dlp[.exe]  (populated by `npm run fetch:bin`)
//   • fallback  → `yt-dlp` on the system PATH
//
// Run `npm run fetch:bin` once to download the binary into resources/bin.

import { app } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

export type MediaFormat = 'video' | 'audio';

export const SUPPORTED_PLATFORMS = ['YouTube', 'X (Twitter)', 'Instagram', 'Audiomack'];

const isWin = process.platform === 'win32';
const YTDLP_BIN = isWin ? 'yt-dlp.exe' : 'yt-dlp';

/** asar-packed binaries must be read from the `.unpacked` sibling directory. */
function toUnpacked(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked');
}

function binDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin');
}

/** Resolve the yt-dlp binary, falling back to PATH if the bundled one is absent. */
export async function resolveYtDlpPath(): Promise<string> {
  const bundled = path.join(binDir(), YTDLP_BIN);
  try {
    await fs.access(bundled);
    return bundled;
  } catch {
    return YTDLP_BIN; // rely on PATH
  }
}

function resolveFfmpegPath(): string | null {
  return ffmpegStatic ? toUnpacked(ffmpegStatic) : null;
}

/** Mirror of the Python manager's detect_platform(), same labels. */
export function detectPlatform(url: string): string {
  const u = url.toLowerCase();
  if (/youtube\.com|youtu\.be/.test(u)) return 'YouTube';
  if (/twitter\.com|(^|\/\/)(www\.)?x\.com|t\.co/.test(u)) return 'X (Twitter)';
  if (/instagram\.com/.test(u)) return 'Instagram';
  if (/audiomack\.com/.test(u)) return 'Audiomack';
  return 'Desconocida';
}

export interface MediaMetadata {
  /** The post's caption / description. */
  description?: string;
  title?: string;
  uploader?: string;
  /** yt-dlp `upload_date`, format YYYYMMDD. */
  uploadDate?: string;
}

export interface DownloadOutcome {
  filePath: string;
  filename: string;
  sizeBytes: number;
  metadata?: MediaMetadata;
  /** Removes the temp directory holding the produced file. Call after streaming. */
  cleanup: () => Promise<void>;
}

/**
 * Download a single media item into a private temp directory and return the
 * largest produced file (yt-dlp may emit several; we keep the real one).
 */
export async function downloadMedia(
  url: string,
  format: MediaFormat,
  signal?: AbortSignal,
): Promise<DownloadOutcome> {
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-media-'));
  const ytdlp = await resolveYtDlpPath();
  const ffmpeg = resolveFfmpegPath();

  const args: string[] = [
    '--no-playlist',
    '--no-progress',
    '--no-warnings',
    '--restrict-filenames',
    '--write-info-json',
    '-o',
    path.join(tmpdir, '%(title).80s.%(ext)s'),
  ];
  if (ffmpeg) args.push('--ffmpeg-location', ffmpeg);
  if (format === 'audio') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4');
  }
  args.push(url);

  try {
    await runProcess(ytdlp, args, signal);
  } catch (err) {
    await fs.rm(tmpdir, { recursive: true, force: true });
    throw err;
  }

  const entries = await fs.readdir(tmpdir);

  // Pull caption/uploader/date from the sidecar info.json (best-effort).
  let metadata: MediaMetadata | undefined;
  const infoName = entries.find((n) => n.endsWith('.info.json'));
  if (infoName) {
    try {
      const raw = await fs.readFile(path.join(tmpdir, infoName), 'utf8');
      const j = JSON.parse(raw) as Record<string, unknown>;
      const str = (v: unknown): string | undefined =>
        typeof v === 'string' && v.trim() ? v : undefined;
      metadata = {
        description: str(j.description),
        title: str(j.title),
        uploader: str(j.uploader) ?? str(j.uploader_id) ?? str(j.channel),
        uploadDate: str(j.upload_date),
      };
    } catch {
      /* metadata is best-effort; ignore parse errors */
    }
  }

  // The produced media is the largest non-metadata file.
  const stats = await Promise.all(
    entries
      .filter((name) => !name.endsWith('.info.json'))
      .map(async (name) => {
        const fp = path.join(tmpdir, name);
        const st = await fs.stat(fp);
        return { fp, name, size: st.isFile() ? st.size : -1 };
      }),
  );
  const produced = stats.filter((s) => s.size >= 0).sort((a, b) => b.size - a.size)[0];
  if (!produced) {
    await fs.rm(tmpdir, { recursive: true, force: true });
    throw new Error('no output file produced');
  }

  return {
    filePath: produced.fp,
    filename: produced.name,
    sizeBytes: produced.size,
    metadata,
    cleanup: () => fs.rm(tmpdir, { recursive: true, force: true }),
  };
}

/** Kill a process and its descendants (yt-dlp spawns ffmpeg as a child). */
function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    // Detached taskkill survives our own exit and reaps the whole tree.
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}

function runProcess(cmd: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('cancelled'));
      return;
    }
    const child = spawn(cmd, args, { windowsHide: true });

    // Run the download/mux below normal priority so a heavy ffmpeg pass never
    // starves the UI or the rest of the machine.
    try {
      if (child.pid != null) {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      }
    } catch {
      /* best-effort; not fatal if the OS refuses */
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
      reject(
        new Error(
          `Could not launch yt-dlp (${err.message}). ` +
            `Make sure the binary exists — run "npm run fetch:bin".`,
        ),
      );
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
      const tail = stderr.trim().split('\n').slice(-3).join('\n');
      reject(new Error(tail || `yt-dlp exited with code ${code}`));
    });
  });
}
