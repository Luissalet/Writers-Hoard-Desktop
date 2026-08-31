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
  void api.chat(requestId, request).then((ack) => {
    if (!ack.ok) {
      const listener = streamListeners.get(requestId);
      streamListeners.delete(requestId);
      listener?.({ type: 'error', code: 'bad-request', message: ack.error ?? 'Rejected.' });
    }
  });
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
    void api.generateImage(requestId, request).then((ack) => {
      if (!ack.ok) {
        imageListeners.delete(requestId);
        resolve({ ok: false, code: 'bad-request', error: ack.error ?? 'Rejected.' });
      }
    });
  });
  return {
    requestId,
    result,
    cancel: () => {
      void api.cancel(requestId);
    },
  };
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
  void api.run({ ...request, runId }).then((ack) => {
    if (!ack.ok) {
      const listener = copilotListeners.get(runId);
      copilotListeners.delete(runId);
      listener?.({ type: 'error', code: 'bad-request', message: ack.error ?? 'Rejected.' });
    }
  });
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
