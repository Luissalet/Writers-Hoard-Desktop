import type { FaustusHostBridge, FaustusFetchEvent } from './faustusProtocol';

/** A Fetch implementation over Electron's existing isolated preload. */
export function createFaustusFetch(bridge: FaustusHostBridge): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const id = crypto.randomUUID();
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let closed = false;
    const pending: FaustusFetchEvent[] = [];
    const process = (event: FaustusFetchEvent): void => {
      if (!streamController) { pending.push(event); return; }
      if (closed) return;
      if (event.type === 'chunk') streamController.enqueue(new Uint8Array(event.chunk));
      else {
        closed = true;
        cleanup();
        if (event.type === 'end') streamController.close();
        else streamController.error(new Error(event.message));
      }
    };
    const unsubscribe = bridge.onEvent((event) => { if (event.id === id) process(event); });
    const abort = (): void => {
      void bridge.cancel(id);
      process({ id, type: 'error', message: 'The request was aborted.' });
    };
    const cleanup = (): void => { unsubscribe(); request.signal.removeEventListener('abort', abort); };
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) { cleanup(); throw new DOMException('The request was aborted.', 'AbortError'); }
    try {
      const response = await bridge.request({ id, url: request.url, method: request.method, headers: [...request.headers], body });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { streamController = controller; for (const event of pending.splice(0)) process(event); },
        cancel() { closed = true; cleanup(); void bridge.cancel(id); },
      });
      if ([204, 205, 304].includes(response.status) || request.method === 'HEAD') {
        closed = true;
        cleanup();
        return new Response(null, response);
      }
      return new Response(stream, response);
    } catch (error) { closed = true; cleanup(); throw error; }
  };
}
