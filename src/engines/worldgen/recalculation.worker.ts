import type { WorldData } from './core/types';
import { applyEdits, type WorldEdit } from './core/edits';
import { recalculateEnvironment, worldRecalculationCheckpoints, type RecalculationTerrain } from './core/recalculate';

export type RecalculationRequest = { type: 'derive'; world: RecalculationTerrain } | { type: 'prepare'; world: WorldData; edits: WorldEdit[] };
const ctx = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((event: MessageEvent<RecalculationRequest>) => void) | null };
function sendResult(message: unknown): void {
  const buffers = new Set<ArrayBuffer>();
  const visit = (value: unknown) => {
    if (ArrayBuffer.isView(value)) { if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer); }
    else if (value && typeof value === 'object') for (const item of Object.values(value)) visit(item);
  };
  visit(message); ctx.postMessage(message, [...buffers]);
}
ctx.onmessage = event => {
  try {
    const request = event.data;
    if (request.type === 'derive') {
      const environment = recalculateEnvironment(request.world, (stage, overall) => ctx.postMessage({ type: 'progress', stage, overall }));
      sendResult({ type: 'done', environment });
    } else {
      ctx.postMessage({ type: 'progress', stage: 'climate', overall: 0 });
      applyEdits(request.world, request.edits);
      sendResult({ type: 'done', checkpoints: worldRecalculationCheckpoints(request.world) });
    }
  } catch (error) { ctx.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};
