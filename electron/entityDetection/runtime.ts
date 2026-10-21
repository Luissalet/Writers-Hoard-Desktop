import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ENTITY_MODEL_KEY } from './models';
import type { EntityDetectionStatus, EntitySpan } from '../../src/services/entityDetection/types';

/** Lazy CPU-only classifier, released after two minutes without requests. */
export class EntityDetectionRuntime {
  private worker?: Worker;
  private sequence = 0;
  private idle?: ReturnType<typeof setTimeout>;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private state?: EntityDetectionStatus;
  private preparing?: Promise<EntityDetectionStatus>;
  constructor(private directory: string, private workerFile = path.join(__dirname, 'worker.cjs')) {}
  async status(): Promise<EntityDetectionStatus> {
    if (this.state) return this.state;
    try { const marker = JSON.parse(await readFile(path.join(this.directory, 'ready.json'), 'utf8')); return { state: marker.model === ENTITY_MODEL_KEY ? 'ready' : 'missing', model: ENTITY_MODEL_KEY }; }
    catch { return { state: 'missing', model: ENTITY_MODEL_KEY }; }
  }
  private call<T>(action: string, value?: unknown): Promise<T> {
    clearTimeout(this.idle);
    if (!this.worker) {
      const worker = new Worker(this.workerFile, { workerData: { directory: this.directory } }); this.worker = worker;
      worker.on('message', message => {
        if (message.status) { this.state = message.status; return; }
        const job = this.pending.get(message.id); if (!job) return; this.pending.delete(message.id);
        if (message.error) { this.state = { state: 'error', model: ENTITY_MODEL_KEY, detail: String(message.error) }; job.reject(Error(message.error)); } else job.resolve(message.result);
        if (!this.pending.size) this.idle = setTimeout(() => { void this.close(); }, 120000);
      });
      worker.on('error', error => this.failed(error));
      worker.on('exit', code => { if (this.worker === worker) { this.worker = undefined; if (this.pending.size) this.failed(Error(`entity_worker_exited_${code}`)); } });
    }
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => { this.pending.set(id, { resolve: value => resolve(value as T), reject }); this.worker!.postMessage({ id, action, value }); });
  }
  private failed(error: Error) { this.state = { state: 'error', model: ENTITY_MODEL_KEY, detail: error.message }; for (const job of this.pending.values()) job.reject(error); this.pending.clear(); }
  prepare(): Promise<EntityDetectionStatus> {
    if (!this.preparing) { this.state = { state: 'preparing', model: ENTITY_MODEL_KEY }; this.preparing = this.call<EntityDetectionStatus>('prepare').then(status => { this.state = status; return status; }).finally(() => { this.preparing = undefined; }); }
    return this.preparing;
  }
  detect(text: string): Promise<EntitySpan[]> {
    if (typeof text !== 'string') return Promise.reject(Error('entity_text_invalid'));
    return text.trim() ? this.call('detect', text) : Promise.resolve([]);
  }
  async close(): Promise<void> { clearTimeout(this.idle); const worker = this.worker; this.worker = undefined; if (this.pending.size) this.failed(Error('entity_worker_closed')); if (worker) await worker.terminate(); }
}
