import type { ProgressFn, WorldData } from './core/types';
import { serializeEdits, type WorldEdit } from './core/edits';
import { getRecalculationCheckpoint, installRecalculationCheckpoints, type EnvironmentFields, type RecalculationCheckpoint } from './core/recalculate';
import type { RecalculationRequest } from './recalculation.worker';

export interface RecalculationOptions { signal?: AbortSignal; onProgress?: ProgressFn }
type Reply = { type: 'progress'; stage: string; overall: number } | { type: 'error'; message: string } | { type: 'done'; environment?: EnvironmentFields; checkpoints?: RecalculationCheckpoint[] };
function run(request: RecalculationRequest, options: RecalculationOptions): Promise<Extract<Reply, { type: 'done' }>> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const worker = new Worker(new URL('./recalculation.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { worker.terminate(); options.signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Recalculation worker failed')); };
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      if (reply.type === 'progress') { options.onProgress?.(reply.stage, reply.overall); return; }
      cleanup();
      if (reply.type === 'error') reject(new Error(reply.message)); else resolve(reply);
    };
    // Clone, never transfer the displayed world's buffers: cancellation leaves it intact.
    try { worker.postMessage(request); } catch (error) { cleanup(); reject(error); }
  });
}

export async function requestWorldRecalculation(world: WorldData, options: RecalculationOptions = {}): Promise<EnvironmentFields> {
  const { elevation, boundary, width, height, params } = world;
  const reply = await run({ type: 'derive', world: { elevation, boundary, width, height, params } }, options);
  if (!reply.environment) throw new Error('Missing recalculation result');
  return reply.environment;
}

/** Prepare once on opening. Subsequent PaintSession replay/undo/redo consumes these cached prefixes. */
export async function preparePaintReplay(world: WorldData, edits: WorldEdit[], options: RecalculationOptions = {}, pristineSource?: WorldData | (() => WorldData)): Promise<void> {
  let last = edits.length - 1;
  while (last >= 0 && edits[last].kind !== 'recalculate') last--;
  if (last < 0 || getRecalculationCheckpoint(world, serializeEdits(edits.slice(0, last + 1)))) return;
  const source = typeof pristineSource === 'function' ? pristineSource() : pristineSource ?? world;
  const reply = await run({ type: 'prepare', world: source, edits }, options);
  if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!reply.checkpoints) throw new Error('Missing replay checkpoints');
  installRecalculationCheckpoints(world, reply.checkpoints);
}
