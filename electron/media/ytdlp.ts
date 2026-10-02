// Writers Hoard desktop adapter for HoardLink's shared yt-dlp engine.
// Packaged yt-dlp and ffmpeg-static remain available alongside HOARD_* tools.
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import {
  buildYtdlpArgs, detectMediaPlatform, fileKind, isPartialMedia,
  killTree, resolveTool, runProcess,
} from './commons';
import { desktopToolOptions } from './desktopTools';
import { publicUrlReason } from './publicNetwork';

export type MediaFormat = 'video' | 'audio';
export const SUPPORTED_PLATFORMS = ['YouTube', 'X (Twitter)', 'Instagram', 'Audiomack'];

function toolOptions() {
  return desktopToolOptions({
    isPackaged: app.isPackaged, appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath, ffmpegPath: ffmpegStatic,
  });
}

/** Retained for callers needing the executable path; downloads keep prefix arguments too. */
export async function resolveYtDlpPath(): Promise<string> {
  const tool = await resolveTool('ytdlp', toolOptions());
  return tool.command?.cmd ?? (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

export function detectPlatform(url: string): string {
  return detectMediaPlatform(url, { other: 'Desconocida' });
}

export interface MediaMetadata {
  description?: string;
  title?: string;
  uploader?: string;
  /** yt-dlp upload_date, YYYYMMDD. */
  uploadDate?: string;
}
export interface DownloadOutcome {
  filePath: string;
  filename: string;
  sizeBytes: number;
  metadata?: MediaMetadata;
  cleanup: () => Promise<void>;
}

/** Download a single item; callers own the returned temporary-directory cleanup. */
export async function downloadMedia(
  url: string, format: MediaFormat, signal?: AbortSignal, cookiesFile?: string,
): Promise<DownloadOutcome> {
  if (signal?.aborted) throw new Error('cancelled');
  const reason = await publicUrlReason(url);
  if (signal?.aborted) throw new Error('cancelled');
  if (reason) throw new Error(`Media download refused: ${reason}`);
  const options = toolOptions();
  const [ytdlp, ffmpeg, node] = await Promise.all([
    resolveTool('ytdlp', options), resolveTool('ffmpeg', options), resolveTool('node', options),
  ]);
  if (signal?.aborted) throw new Error('cancelled');
  if (!ytdlp.command) throw new Error(ytdlp.error ?? 'yt-dlp is not available. Run "npm run fetch:bin".');
  // The child environment runs Electron's self fallback as Node, so packaged
  // downloads also have a JavaScript runtime without a system Node install.
  const nodePath = node.found && !node.command?.args.length ? node.command?.cmd : null;
  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-media-'));
  try {
    const args = buildYtdlpArgs({
      url, format, dir: tmpdir, hasFfmpeg: ffmpeg.found,
      ffmpegPath: ffmpeg.command && !ffmpeg.command.args.length ? ffmpeg.command.cmd : null,
      nodePath, ytdlpVersion: ytdlp.version,
      cookie: cookiesFile ? { type: 'file', path: cookiesFile } : null,
      // Preserve desktop filenames, sidecar metadata and silent progress.
      extra: ['--no-progress', '--restrict-filenames', '--write-info-json', '-o', '%(title).80s.%(ext)s'],
    });
    const result = await runProcess(ytdlp.command, args, { signal, env: options.env });
    if (result.code !== 0) {
      throw new Error(result.stderr.trim().split('\n').slice(-3).join('\n') || `yt-dlp exited with code ${result.code}`);
    }
    if (signal?.aborted) throw new Error('cancelled');
    const entries = await fs.readdir(tmpdir);
    let metadata: MediaMetadata | undefined;
    const infoName = entries.find(name => name.endsWith('.info.json'));
    if (infoName) {
      try {
        const j = JSON.parse(await fs.readFile(path.join(tmpdir, infoName), 'utf8')) as Record<string, unknown>;
        const str = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v : undefined;
        metadata = {
          description: str(j.description), title: str(j.title),
          uploader: str(j.uploader) ?? str(j.uploader_id) ?? str(j.channel), uploadDate: str(j.upload_date),
        };
      } catch { /* optional sidecar */ }
    }
    const stats = await Promise.all(entries
      .filter(name => !isPartialMedia(name) && ['video', 'audio'].includes(fileKind(name)))
      .map(async name => {
        const fp = path.join(tmpdir, name);
        const st = await fs.stat(fp);
        return { fp, name, size: st.isFile() ? st.size : -1 };
      }));
    const produced = stats.filter(item => item.size >= 0).sort((a, b) => b.size - a.size)[0];
    if (!produced) throw new Error('no output file produced');
    if (signal?.aborted) throw new Error('cancelled');
    return {
      filePath: produced.fp, filename: produced.name, sizeBytes: produced.size, metadata,
      cleanup: () => fs.rm(tmpdir, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.rm(tmpdir, { recursive: true, force: true });
    if (signal?.aborted) throw new Error('cancelled');
    throw error;
  }
}

/** Retained for gallery-dl's process cancellation. */
export function killProcessTree(pid: number): void {
  void killTree(pid).catch(() => undefined);
}
