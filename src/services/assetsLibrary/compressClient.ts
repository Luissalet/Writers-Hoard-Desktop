// ============================================================================
// Typed client for "Comprimir" (desktop only). It runs only when a person asks,
// returns the smaller bytes for them to keep or discard, and can be cancelled.
// Without the desktop bridge (web build, tests) `canCompress()` is false and
// the library hides the button.
// ============================================================================

import type { CompressAssetResult } from '@/electron-env';

export type CompressPreset = 'balanced' | 'small';

export type CompressOutcome =
  | { status: 'done'; bytes: ArrayBuffer; mime: string; ext: string; beforeBytes: number; afterBytes: number }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | { status: 'unavailable' };

export interface CompressRun {
  requestId: string;
  result: Promise<CompressOutcome>;
  cancel: () => void;
}

interface CompressBridge {
  compressAsset: NonNullable<NonNullable<Window['electronAPI']>['media']['compressAsset']>;
  cancelCompress?: NonNullable<Window['electronAPI']>['media']['cancelCompress'];
}

function bridge(): CompressBridge | null {
  if (typeof window === 'undefined') return null;
  const media = window.electronAPI?.media;
  return media && typeof media.compressAsset === 'function' ? { compressAsset: media.compressAsset.bind(media), cancelCompress: media.cancelCompress?.bind(media) } : null;
}

/** True only in the desktop shell with the compression bridge. */
export const canCompress = (): boolean => bridge() !== null;

export function startCompress(bytes: ArrayBuffer, kind: 'audio' | 'video', preset: CompressPreset = 'balanced'): CompressRun {
  const requestId = crypto.randomUUID();
  const native = bridge();
  let cancelled = false;
  const result: Promise<CompressOutcome> = native
    ? native.compressAsset({ requestId, kind, preset, bytes }).then((response: CompressAssetResult): CompressOutcome => {
        if (response.ok) return { status: 'done', bytes: response.bytes, mime: response.mime, ext: response.ext, beforeBytes: response.beforeBytes, afterBytes: response.afterBytes };
        return cancelled || response.cancelled ? { status: 'cancelled' } : { status: 'error', message: response.error };
      }).catch((error: unknown): CompressOutcome => cancelled ? { status: 'cancelled' } : { status: 'error', message: error instanceof Error ? error.message : String(error) })
    : Promise.resolve({ status: 'unavailable' });
  return {
    requestId,
    result,
    cancel: () => { cancelled = true; void native?.cancelCompress?.(requestId); },
  };
}

/** Percentage saved, rounded; negative when the result is bigger. */
export function savedPercent(before: number, after: number): number {
  return before > 0 ? Math.round((1 - after / before) * 100) : 0;
}
