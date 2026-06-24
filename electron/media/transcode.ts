// ============================================================================
// Writers Hoard — WebM → MP4 transcode (main process)
// ============================================================================
//
// The teleprompter recorder (renderer) captures a canvas to a WebM blob via
// MediaRecorder — the only container Chromium's MediaRecorder reliably emits.
// To hand the user a portable MP4 we re-encode here with the bundled
// ffmpeg-static binary (H.264 / yuv420p, faststart for web playback).
//
// The captured stream is video-only (a canvas has no audio track), so `-an`.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

/** asar-packed binaries must be read from the `.unpacked` sibling directory. */
function toUnpacked(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked');
}

function resolveFfmpegPath(): string | null {
  return ffmpegStatic ? toUnpacked(ffmpegStatic) : null;
}

/** Re-encode a WebM buffer to MP4 (H.264) and return the MP4 bytes. */
export async function transcodeWebmToMp4(webm: Buffer): Promise<Buffer> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) throw new Error('ffmpeg is not available in this build.');

  const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-teleprompter-'));
  const inPath = path.join(tmpdir, 'in.webm');
  const outPath = path.join(tmpdir, 'out.mp4');

  try {
    await fs.writeFile(inPath, webm);
    await runFfmpeg(ffmpeg, [
      '-y',
      '-i', inPath,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      outPath,
    ]);
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(tmpdir, { recursive: true, force: true });
  }
}

function runFfmpeg(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) =>
      reject(new Error(`Could not launch ffmpeg (${err.message}).`)),
    );
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const tail = stderr.trim().split('\n').slice(-3).join('\n');
      reject(new Error(tail || `ffmpeg exited with code ${code}`));
    });
  });
}
