import type { DomainPreparationReply, DomainPreparationRequest } from './domain.worker';

/** One owned worker per preparation. Cancel terminates only this job's worker. */
export function prepareWorldDomain(request: DomainPreparationRequest, signal: AbortSignal, onProgress?: (stage: string, progress: number) => void): Promise<Extract<DomainPreparationReply, { type: 'done' }>> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Canceled', 'AbortError')); return; }
    const worker = new Worker(new URL('./domain.worker.ts', import.meta.url), { type: 'module' });
    const close = () => { signal.removeEventListener('abort', cancel); worker.terminate(); };
    const cancel = () => { close(); reject(new DOMException('Canceled', 'AbortError')); };
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<DomainPreparationReply>) => {
      const reply = event.data;
      if (reply.type === 'progress') { onProgress?.(reply.stage, reply.progress); return; }
      close();
      if (reply.type === 'error') reject(new Error(reply.error)); else resolve(reply);
    };
    worker.onerror = event => { close(); reject(new Error(event.message || 'Domain worker failed')); };
    try { worker.postMessage(request); } catch (error) { close(); reject(error); }
  });
}
