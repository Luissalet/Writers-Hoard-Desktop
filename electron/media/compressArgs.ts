// ============================================================================
// Writers Hoard — argument builder for "Comprimir" (audio / video)
// ============================================================================
//
// Pure on purpose: no node or electron imports, so the exact ffmpeg command a
// compression runs can be unit-tested without spawning anything.

export type CompressKind = 'audio' | 'video';
export type CompressPreset = 'balanced' | 'small';

export interface CompressPlan {
  /** Extension of the file written, without the dot. */
  ext: 'm4a' | 'mp4';
  /** MIME type of that file; both are accepted by the media library. */
  mime: 'audio/mp4' | 'video/mp4';
}

export function compressPlan(kind: CompressKind): CompressPlan {
  return kind === 'audio' ? { ext: 'm4a', mime: 'audio/mp4' } : { ext: 'mp4', mime: 'video/mp4' };
}

/** Largest input handed to ffmpeg through IPC (bytes are copied across the process boundary). */
export const MAX_COMPRESS_INPUT_BYTES = 250 * 1024 * 1024;

/** A compression that runs longer than this is killed: nobody waits on a stuck encoder. */
export const COMPRESS_TIMEOUT_MS = 10 * 60 * 1000;
/** How much of ffmpeg's error output is kept to explain a failure. */
export const FFMPEG_STDERR_LIMIT = 8 * 1024;
/** Keep only the last `limit` characters of the error output, so a chatty encoder cannot grow memory. */
export function appendBoundedStderr(current: string, chunk: string, limit: number = FFMPEG_STDERR_LIMIT): string {
  const joined = current + chunk;
  return joined.length > limit ? joined.slice(joined.length - limit) : joined;
}

export function isCompressKind(value: unknown): value is CompressKind {
  return value === 'audio' || value === 'video';
}

export function isCompressPreset(value: unknown): value is CompressPreset {
  return value === 'balanced' || value === 'small';
}

/**
 * ffmpeg arguments that re-encode `inPath` into `outPath`.
 * Audio keeps only the sound (AAC in an m4a); video is H.264 capped at 1280 px
 * wide with AAC sound and faststart so it plays while it loads.
 */
export function buildCompressArgs(input: { kind: CompressKind; preset: CompressPreset; inPath: string; outPath: string }): string[] {
  const { kind, preset, inPath, outPath } = input;
  if (kind === 'audio') {
    return ['-nostats', '-loglevel', 'error', '-y', '-i', inPath, '-vn', '-map_metadata', '-1', '-c:a', 'aac', '-b:a', preset === 'small' ? '64k' : '96k', '-movflags', '+faststart', outPath];
  }
  return [
    '-nostats', '-loglevel', 'error',
    '-y', '-i', inPath, '-sn',
    '-vf', "scale='min(1280,iw)':-2",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', preset === 'small' ? '32' : '28', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', preset === 'small' ? '64k' : '96k',
    '-movflags', '+faststart',
    outPath,
  ];
}
