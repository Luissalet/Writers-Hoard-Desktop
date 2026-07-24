// ============================================
// World Generator — Web Worker
// ============================================
// Runs the full generation pipeline off the main thread. One worker per
// generation run — the UI terminates it to cancel. Typed arrays are
// transferred (zero-copy) back to the main thread.

import { generateWorld } from './core/pipeline';
import { packWorld } from './core/types';
import type { WorldParams } from './core/types';

export interface GenerateRequest {
  type: 'generate';
  params: WorldParams;
}

export type WorkerReply =
  | { type: 'progress'; stage: string; overall: number }
  | { type: 'done'; world: ReturnType<typeof packWorld>['transfer'] }
  | { type: 'error'; message: string };

const ctx = self as unknown as {
  postMessage(msg: WorkerReply, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<GenerateRequest>) => void) | null;
};

ctx.onmessage = (e: MessageEvent<GenerateRequest>) => {
  const msg = e.data;
  if (msg.type !== 'generate') return;
  try {
    let lastSent = 0;
    const world = generateWorld(msg.params, (stage, overall) => {
      // Throttle progress messages (~40/s max is plenty).
      const now = overall;
      if (now - lastSent >= 0.005 || now >= 1) {
        lastSent = now;
        ctx.postMessage({ type: 'progress', stage, overall });
      }
    });
    const { transfer, buffers } = packWorld(world);
    ctx.postMessage({ type: 'done', world: transfer }, buffers);
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
