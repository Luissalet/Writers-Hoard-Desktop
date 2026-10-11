import type { FaustusFetchEvent, FaustusFetchRequest, FaustusFetchResponse } from '../../src/services/copilot/faustusProtocol';

/** Transport only: turns, history, prompts and tools remain in Faustus. */
export class FaustusRelay {
  private readonly requests = new Map<string, AbortController>();

  constructor(private readonly server: string, private readonly token = '', private readonly fetchImpl: typeof fetch = fetch) {}

  async request(request: FaustusFetchRequest, emit: (event: FaustusFetchEvent) => void): Promise<FaustusFetchResponse> {
    const target = new URL(request.url, this.server);
    if (target.origin !== new URL(this.server).origin || !target.pathname.startsWith('/api/')) throw new Error('Invalid Faustus API request.');
    if (this.requests.has(request.id)) throw new Error('Duplicate Faustus request.');
    const controller = new AbortController();
    this.requests.set(request.id, controller);
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);
    try {
      const response = await this.fetchImpl(target, { method: request.method, headers, body: request.body, signal: controller.signal });
      const reader = response.body?.getReader();
      void (async () => {
        try {
          if (reader) {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              emit({ id: request.id, type: 'chunk', chunk: value });
            }
          }
          emit({ id: request.id, type: 'end' });
        } catch (error) { emit({ id: request.id, type: 'error', message: String(error instanceof Error ? error.message : error) }); }
        finally { this.requests.delete(request.id); reader?.releaseLock(); }
      })();
      const responseHeaders: Array<[string, string]> = [];
      response.headers.forEach((value, key) => responseHeaders.push([key, value]));
      return { status: response.status, statusText: response.statusText, headers: responseHeaders };
    } catch (error) { this.requests.delete(request.id); throw error; }
  }

  cancel(id: string): void { this.requests.get(id)?.abort(); }
}
