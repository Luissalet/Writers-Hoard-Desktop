import { clearRegionCache, generateRegion } from './region/generate';
import { regionTransferables, type RegionWorkerReply, type RegionWorkerRequest } from './region/workerProtocol';
import { buildLanguageFamily } from './core/language';
import type { HumanGeography } from './core/settlements';
import type { WorldData } from './core/types';

const cancelled = new Set<string>();
let context: { id: string; world: WorldData; geography: HumanGeography } | null = null;

const ctx = self as unknown as {
  postMessage(message: RegionWorkerReply, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<RegionWorkerRequest>) => void) | null;
};

ctx.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'configure') {
    const { languageCount, ...geography } = message.geography;
    context = {
      id: message.contextId,
      world: message.world,
      geography: {
        ...geography,
        languages: buildLanguageFamily(message.world.params.seed, languageCount),
      },
    };
    ctx.postMessage({ type: 'configured', contextId: message.contextId });
    return;
  }
  if (message.type === 'cancel') {
    cancelled.add(message.requestId);
    ctx.postMessage({ type: 'cancelled', requestId: message.requestId });
    return;
  }

  const { requestId } = message;
  if (!context || context.id !== message.contextId) {
    ctx.postMessage({ type: 'error', requestId, message: 'Regional worker context is not configured.' });
    return;
  }
  if (cancelled.delete(requestId)) {
    ctx.postMessage({ type: 'cancelled', requestId });
    return;
  }

  try {
    const region = generateRegion(context.world, context.geography, message.window, {
      params: message.params,
      onProgress: (stage, overall) => {
        if (!cancelled.has(requestId)) {
          ctx.postMessage({ type: 'progress', requestId, stage, overall });
        }
      },
    });
    if (cancelled.delete(requestId)) {
      ctx.postMessage({ type: 'cancelled', requestId });
      return;
    }
    // The renderer owns the bounded cache. Clear the worker's reference before
    // transferring buffers so a detached cached result can never be reused.
    clearRegionCache(context.world);
    ctx.postMessage({ type: 'done', requestId, region }, regionTransferables(region));
  } catch (error) {
    ctx.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
