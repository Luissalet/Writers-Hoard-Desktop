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

import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { appendBoundedStderr, buildCompressArgs, COMPRESS_TIMEOUT_MS, compressPlan, MAX_COMPRESS_INPUT_BYTES, type CompressKind, type CompressPreset } from './compressArgs';

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

/**
 * Encodes in flight. A long recording can take minutes to re-encode, and an
 * ffmpeg left behind by a quit keeps a core pinned with nobody waiting for
 * its output (tasks/lessons.md #15), so will-quit kills whatever is here.
 */
const activeEncodes = new Set<ChildProcess>();

/** Kill every running encode — called on app quit. ffmpeg spawns no children. */
export function killAllTranscodes(): void {
  for (const child of activeEncodes) child.kill();
  activeEncodes.clear();
}

function runFfmpeg(cmd: string, args: string[], onSpawn?: (child: ChildProcess) => void, timeoutMs?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    activeEncodes.add(child);
    onSpawn?.(child);
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs) : undefined;
    const forget = (): void => { if (timer) clearTimeout(timer); activeEncodes.delete(child); };
    child.once('close', forget);
    child.once('error', forget);
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr = appendBoundedStderr(stderr, d.toString());
    });
    child.on('error', (err) =>
      reject(new Error(`Could not launch ffmpeg (${err.message}).`)),
    );
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (timedOut) {
        reject(new Error('ffmpeg took too long and was stopped.'));
        return;
      }
      const tail = stderr.trim().split('\n').slice(-3).join('\n');
      reject(new Error(tail || `ffmpeg exited with code ${code}`));
    });
  });
}

// ----------------------------------------------------------------------------
// "Comprimir": re-encode a library sound or video into a smaller one. Only runs
// when the person asks; the renderer decides what to do with the result.
// ----------------------------------------------------------------------------

export type CompressResult =
  | { ok: true; bytes: Buffer; mime: string; ext: string; beforeBytes: number; afterBytes: number }
  | { ok: false; cancelled?: boolean; error: string };

const compressing = new Map<string, { child?: ChildProcess; cancelled: boolean }>();

/** Stop a running compression. Returns false when nothing was running under that id. */
export function cancelCompress(requestId: string): boolean {
  const job = compressing.get(requestId);
  if (!job) return false;
  job.cancelled = true;
  job.child?.kill();
  return true;
}

export async function compressMedia(requestId: string, bytes: Buffer, kind: CompressKind, preset: CompressPreset): Promise<CompressResult> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return { ok: false, error: 'ffmpeg is not available in this build.' };
  if (!bytes.byteLength || bytes.byteLength > MAX_COMPRESS_INPUT_BYTES) return { ok: false, error: 'This file is too large to compress here.' };
  // One compression at a time: a second request is refused instead of queued, so two encodes never fight over the cores.
  if (compressing.size > 0) return { ok: false, error: compressing.has(requestId) ? 'Already compressing.' : 'busy' };
  const job: { child?: ChildProcess; cancelled: boolean } = { cancelled: false };
  compressing.set(requestId, job);
  const plan = compressPlan(kind);
  let tmpdir = '';
  try {
    tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'wh-compress-'));
    const inPath = path.join(tmpdir, 'in.bin');
    const outPath = path.join(tmpdir, `out.${plan.ext}`);
    await fs.writeFile(inPath, bytes);
    if (job.cancelled) return { ok: false, cancelled: true, error: 'Cancelled.' };
    await runFfmpeg(ffmpeg, buildCompressArgs({ kind, preset, inPath, outPath }), child => { job.child = child; if (job.cancelled) child.kill(); }, COMPRESS_TIMEOUT_MS);
    if (job.cancelled) return { ok: false, cancelled: true, error: 'Cancelled.' };
    const out = await fs.readFile(outPath);
    return { ok: true, bytes: out, mime: plan.mime, ext: plan.ext, beforeBytes: bytes.byteLength, afterBytes: out.byteLength };
  } catch (error) {
    if (job.cancelled) return { ok: false, cancelled: true, error: 'Cancelled.' };
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    compressing.delete(requestId);
    if (tmpdir) await fs.rm(tmpdir, { recursive: true, force: true });
  }
}
