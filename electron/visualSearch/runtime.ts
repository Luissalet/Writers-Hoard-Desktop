import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { VISUAL_MODEL } from './models';
import type { VisualEmbedding, VisualSearchStatus } from '../../src/services/visualSearch/types';

/** A CPU worker is started on use, then releases its model memory after idle. */
export class VisualSearchRuntime {
  private worker?: Worker;
  private sequence = 0;
  private idle?: ReturnType<typeof setTimeout>;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private state?: VisualSearchStatus;
  private preparing?: Promise<VisualSearchStatus>;
  constructor(private directory: string, private workerFile = path.join(__dirname, 'worker.cjs')) {}
  async status(): Promise<VisualSearchStatus> {
    if (this.state) return this.state;
    try { const marker = JSON.parse(await readFile(path.join(this.directory, 'ready.json'), 'utf8')); return { state: marker.model === VISUAL_MODEL ? 'ready' : 'missing', model: VISUAL_MODEL }; }
    catch { return { state: 'missing', model: VISUAL_MODEL }; }
  }
  private call<T>(action: string, value?: unknown): Promise<T> {
    clearTimeout(this.idle);
    if (!this.worker) {
      const worker = new Worker(this.workerFile, { workerData: { directory: this.directory } }); this.worker = worker;
      worker.on('message', message => {
        if (message.status) { this.state = message.status; return; }
        const job = this.pending.get(message.id); if (!job) return;
        this.pending.delete(message.id);
        if (message.error) { this.state = { state: 'error', model: VISUAL_MODEL, detail: String(message.error) }; job.reject(Error(message.error)); }
        else job.resolve(message.result);
        if (!this.pending.size) this.idle = setTimeout(() => { void this.close(); }, 120000);
      });
      worker.on('error', error => this.failed(error));
      worker.on('exit', code => { if (this.worker === worker) { this.worker = undefined; if (this.pending.size) this.failed(Error(`visual_worker_exited_${code}`)); } });
    }
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => { this.pending.set(id, { resolve: value => resolve(value as T), reject }); this.worker!.postMessage({ id, action, value }); });
  }
  private failed(error: Error) { this.state = { state: 'error', model: VISUAL_MODEL, detail: error.message }; for (const job of this.pending.values()) job.reject(error); this.pending.clear(); }
  prepare(): Promise<VisualSearchStatus> {
    if (!this.preparing) {
      this.state = { state: 'preparing', model: VISUAL_MODEL };
      this.preparing = this.call<VisualSearchStatus>('prepare').then(status => { this.state = status; return status; }).finally(() => { this.preparing = undefined; });
    }
    return this.preparing;
  }
  image(dataUrl: string): Promise<VisualEmbedding> {
    const match = typeof dataUrl === 'string' && /^data:image\/(?:png|jpeg|jpg|webp|gif|avif|bmp);base64,([a-z\d+/=\s]+)$/i.exec(dataUrl);
    if (!match) return Promise.reject(Error('visual_image_data_invalid'));
    return this.call('image', Uint8Array.from(Buffer.from(match[1], 'base64')));
  }
  text(query: string): Promise<number[]> { if (typeof query !== 'string' || !query.trim()) return Promise.reject(Error('visual_query_missing')); return this.call('text', query); }
  async close(): Promise<void> { clearTimeout(this.idle); const worker = this.worker; this.worker = undefined; if (this.pending.size) this.failed(Error('visual_worker_closed')); if (worker) await worker.terminate(); }
}
