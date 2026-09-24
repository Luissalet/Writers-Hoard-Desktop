// ============================================================================
// AI runtime — renderer-side client over the preload bridge
// ============================================================================
//
// One module-scope subscription to each push channel (guarded against a dev
// HMR double-eval, tasks/lessons.md #19), fanned out to per-request listeners.
// Everything here is desktop-only: on the web build `api()` is null and every
// call resolves to a typed "not available" result instead of throwing.

import { generateId } from '@/utils/idGenerator';
import type { CopilotEvent, CopilotRunRequest } from './copilot';
import type { AiChatRequest, AiImageRequest, AiImageResult, AiStreamEvent } from './types';

declare global {
  interface Window {
    __whAiRuntimeWired?: boolean;
  }
}

type StreamListener = (event: AiStreamEvent) => void;
type ImageListener = (result: AiImageResult) => void;
type CopilotListener = (event: CopilotEvent) => void;

const streamListeners = new Map<string, StreamListener>();
const imageListeners = new Map<string, ImageListener>();
const copilotListeners = new Map<string, CopilotListener>();

export function aiApi(): NonNullable<Window['electronAPI']>['ai'] | null {
  return typeof window !== 'undefined' ? window.electronAPI?.ai ?? null : null;
}

export function copilotApi(): NonNullable<Window['electronAPI']>['copilot'] | null {
  return typeof window !== 'undefined' ? window.electronAPI?.copilot ?? null : null;
}

if (typeof window !== 'undefined' && window.electronAPI?.ai && !window.__whAiRuntimeWired) {
  window.__whAiRuntimeWired = true;
  window.electronAPI.ai.onStream(({ requestId, event }) => {
    const listener = streamListeners.get(requestId);
    if (!listener) return;
    listener(event);
    if (event.type === 'done' || event.type === 'cancelled' || event.type === 'error') {
      streamListeners.delete(requestId);
    }
  });
  window.electronAPI.ai.onImageDone(({ requestId, result }) => {
    const listener = imageListeners.get(requestId);
    imageListeners.delete(requestId);
    listener?.(result);
  });
  window.electronAPI.copilot?.onEvent(({ runId, event }) => {
    const listener = copilotListeners.get(runId);
    if (!listener) return;
    listener(event);
    if (event.type === 'done' || event.type === 'cancelled' || event.type === 'error') {
      copilotListeners.delete(runId);
    }
  });
}

export interface StreamHandle {
  requestId: string;
  cancel: () => void;
}

/** Streamed chat. `onEvent` receives the terminal event exactly once. */
export function chatStream(request: AiChatRequest, onEvent: StreamListener): StreamHandle {
  const api = aiApi();
  const requestId = generateId('req');
  if (!api) {
    queueMicrotask(() => onEvent({ type: 'error', code: 'unreachable', message: 'AI runtime is only available in the desktop app.' }));
    return { requestId, cancel: () => undefined };
  }
  streamListeners.set(requestId, onEvent);
  // A rejected invoke (no handler yet, an uncloneable request, a sender check)
  // must still end the stream: the listener waits for a terminal event and
  // nothing else will ever send one.
  const rejectStream = (message: string): void => {
    const listener = streamListeners.get(requestId);
    streamListeners.delete(requestId);
    listener?.({ type: 'error', code: 'bad-request', message });
  };
  void api.chat(requestId, request).then(
    (ack) => {
      if (!ack.ok) rejectStream(ack.error ?? 'Rejected.');
    },
    (err: unknown) => rejectStream(err instanceof Error ? err.message : String(err)),
  );
  return {
    requestId,
    cancel: () => {
      void api.cancel(requestId);
    },
  };
}

export interface ImageHandle {
  requestId: string;
  result: Promise<AiImageResult>;
  cancel: () => void;
}

export function generateImage(request: AiImageRequest): ImageHandle {
  const api = aiApi();
  const requestId = generateId('img');
  if (!api) {
    return {
      requestId,
      result: Promise.resolve({ ok: false, code: 'unreachable', error: 'AI runtime is only available in the desktop app.' }),
      cancel: () => undefined,
    };
  }
  const result = new Promise<AiImageResult>((resolve) => {
    imageListeners.set(requestId, resolve);
    const rejectImage = (error: string): void => {
      imageListeners.delete(requestId);
      resolve({ ok: false, code: 'bad-request', error });
    };
    void api.generateImage(requestId, request).then(
      (ack) => {
        if (!ack.ok) rejectImage(ack.error ?? 'Rejected.');
      },
      (err: unknown) => rejectImage(err instanceof Error ? err.message : String(err)),
    );
  });
  return {
    requestId,
    result,
    cancel: () => {
      void api.cancel(requestId);
    },
  };
}

/**
 * Ask a local Ollama to drop a chat model out of GPU memory, now.
 *
 * Ollama's documented unload is a chat call with no messages and
 * `keep_alive: 0` — it never runs the model, it only expires the runner. That
 * is the same `keep_alive: 0` the text→image hand-off sends through
 * `releaseAfter` and that `electron/ai/vramRoom.ts` sends to `/api/generate`
 * before sd-server starts; going through the gateway keeps the URL and the key
 * in main, where they belong, instead of adding a channel to say one word.
 *
 * The caller should re-read the runtime status afterwards rather than believe
 * this: an "ok" means the server accepted the request, and the only honest
 * proof that the card is free is the next measurement.
 */
export async function unloadChatModel(connectionId: string, modelId: string): Promise<{ ok: boolean; error?: string }> {
  const api = aiApi();
  if (!api) return { ok: false, error: 'The AI runtime is only available in the desktop app.' };
  const result = await api.complete({ connectionId, modelId, messages: [], maxTokens: 1, releaseAfter: true });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export interface CopilotRunHandle {
  runId: string;
  cancel: () => void;
  approve: (callId: string, approved: boolean) => void;
}

export function runCopilot(request: Omit<CopilotRunRequest, 'runId'>, onEvent: CopilotListener): CopilotRunHandle {
  const api = copilotApi();
  const runId = generateId('run');
  if (!api) {
    queueMicrotask(() => onEvent({ type: 'error', code: 'unreachable', message: 'The copilot is only available in the desktop app.' }));
    return { runId, cancel: () => undefined, approve: () => undefined };
  }
  copilotListeners.set(runId, onEvent);
  // Same as chatStream: a rejected invoke would otherwise leave the run in the
  // store, and the dock spinning, until the app is reloaded.
  const rejectRun = (message: string): void => {
    const listener = copilotListeners.get(runId);
    copilotListeners.delete(runId);
    listener?.({ type: 'error', code: 'bad-request', message });
  };
  void api.run({ ...request, runId }).then(
    (ack) => {
      if (!ack.ok) rejectRun(ack.error ?? 'Rejected.');
    },
    (err: unknown) => rejectRun(err instanceof Error ? err.message : String(err)),
  );
  return {
    runId,
    cancel: () => {
      void api.cancel(runId);
    },
    approve: (callId, approved) => {
      void api.approve(runId, callId, approved);
    },
  };
}
