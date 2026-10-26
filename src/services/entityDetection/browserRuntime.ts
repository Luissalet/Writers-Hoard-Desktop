import { readEntityBrowserStatus } from './browserAssets';
import { ENTITY_MODEL_KEY } from './modelManifest';
import type { EntityDetectionAPI, EntityDetectionStatus, EntitySpan } from './types';

export interface EntityDetectionJobOptions { jobId?: string }
export interface EntityDetectionCancellation { supported: boolean; cancelled: boolean }
export interface BrowserEntityDetectionAPI extends EntityDetectionAPI {
  prepare(options?: EntityDetectionJobOptions): Promise<EntityDetectionStatus>;
  detect(text: string, options?: EntityDetectionJobOptions): Promise<EntitySpan[]>;
  importFiles(files: readonly File[], options?: EntityDetectionJobOptions): Promise<EntityDetectionStatus>;
  cancel(jobId: string): Promise<EntityDetectionCancellation>;
  close(): Promise<void>;
}
export type EntityWorkerRequest = { id: string; action: 'prepare' | 'import' | 'detect'; text?: string; files?: readonly File[] } | { action: 'dispose' };
export type EntityWorkerReply = { id: string; status?: EntityDetectionStatus; result?: EntityDetectionStatus | EntitySpan[]; error?: string } | { disposed: true };
type EntityWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;
interface Job { request: Exclude<EntityWorkerRequest, { action: 'dispose' }>; resolve(value: EntityDetectionStatus | EntitySpan[]): void; reject(error: Error): void }
interface RuntimePorts { worker(): EntityWorker; status(): Promise<EntityDetectionStatus>; idleMs?: number }

/** One active worker job; cancelling an owner never drops a sibling's queued job. */
export class BrowserEntityDetectionRuntime implements BrowserEntityDetectionAPI {
  private worker?: EntityWorker;
  private active?: Job;
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private idle?: ReturnType<typeof setTimeout>;
  private state?: EntityDetectionStatus;
  private closing?: Promise<void>;
  private ports: RuntimePorts;
  constructor(ports?: RuntimePorts) {
    this.ports = ports ?? { worker: () => new Worker(new URL('./browserWorker.ts', import.meta.url), { type: 'module' }), status: readEntityBrowserStatus };
  }
  async status(): Promise<EntityDetectionStatus> { return this.state ?? this.ports.status(); }
  private discardWorker(): void {
    const worker = this.worker;
    this.worker = undefined;
    if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
  }
  private failed(error: Error): void {
    this.discardWorker();
    this.state = { state: 'error', model: ENTITY_MODEL_KEY, detail: error.message };
    const active = this.active;
    this.active = undefined;
    if (active) { this.jobs.delete(active.request.id); active.reject(error); }
    this.pump();
  }
  private ensureWorker(): EntityWorker {
    if (this.worker) return this.worker;
    const worker = this.ports.worker();
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<EntityWorkerReply>) => {
      if (worker !== this.worker || !('id' in event.data) || event.data.id !== this.active?.request.id) return;
      const message = event.data;
      if (message.status) { this.state = message.status; return; }
      if (message.error) { this.failed(Error(message.error)); return; }
      const active = this.active;
      this.active = undefined;
      this.jobs.delete(active.request.id);
      this.state = undefined;
      active.resolve(message.result!);
      this.pump();
    };
    worker.onerror = event => { if (worker === this.worker) this.failed(Error(event.message || 'entity_browser_worker_failed')); };
    worker.onmessageerror = () => { if (worker === this.worker) this.failed(Error('entity_browser_worker_message_invalid')); };
    return worker;
  }
  private pump(): void {
    clearTimeout(this.idle);
    if (this.active || this.closing) return;
    const job = this.queue.shift();
    if (!job) {
      if (this.worker) this.idle = setTimeout(() => { void this.close(); }, this.ports.idleMs ?? 120000);
      return;
    }
    this.active = job;
    this.state = job.request.action === 'detect' ? undefined : { state: 'preparing', model: ENTITY_MODEL_KEY, progress: 0 };
    try { this.ensureWorker().postMessage(job.request); }
    catch (cause) { this.failed(cause instanceof Error ? cause : Error(String(cause))); }
  }
  private call<T extends EntityDetectionStatus | EntitySpan[]>(request: Omit<Exclude<EntityWorkerRequest, { action: 'dispose' }>, 'id'>, options?: EntityDetectionJobOptions): Promise<T> {
    const id = options?.jobId ?? crypto.randomUUID();
    if (typeof id !== 'string' || !id.trim()) return Promise.reject(Error('entity_job_id_invalid'));
    if (this.jobs.has(id)) return Promise.reject(Error('entity_job_id_active'));
    return new Promise<T>((resolve, reject) => {
      const job: Job = { request: { ...request, id }, resolve: value => resolve(value as T), reject };
      this.jobs.set(id, job);
      this.queue.push(job);
      this.pump();
    });
  }
  prepare(options?: EntityDetectionJobOptions): Promise<EntityDetectionStatus> { return this.call({ action: 'prepare' }, options); }
  importFiles(files: readonly File[], options?: EntityDetectionJobOptions): Promise<EntityDetectionStatus> { return this.call({ action: 'import', files: [...files] }, options); }
  detect(text: string, options?: EntityDetectionJobOptions): Promise<EntitySpan[]> {
    if (typeof text !== 'string') return Promise.reject(Error('entity_text_invalid'));
    if (options?.jobId !== undefined) {
      if (typeof options.jobId !== 'string' || !options.jobId.trim()) return Promise.reject(Error('entity_job_id_invalid'));
      if (this.jobs.has(options.jobId)) return Promise.reject(Error('entity_job_id_active'));
    }
    return text.trim() ? this.call({ action: 'detect', text }, options) : Promise.resolve([]);
  }
  async cancel(jobId: string): Promise<EntityDetectionCancellation> {
    const job = this.jobs.get(jobId);
    if (!job) return { supported: true, cancelled: false };
    this.jobs.delete(jobId);
    this.queue = this.queue.filter(value => value !== job);
    if (this.active === job) { this.active = undefined; this.discardWorker(); this.state = undefined; }
    job.reject(Error('entity_operation_cancelled'));
    this.pump();
    return { supported: true, cancelled: true };
  }
  close(): Promise<void> {
    clearTimeout(this.idle);
    const hadActive = Boolean(this.active);
    for (const job of this.jobs.values()) job.reject(Error('entity_browser_worker_closed'));
    this.jobs.clear(); this.queue = []; this.active = undefined; this.state = undefined;
    if (this.closing) return this.closing;
    const worker = this.worker;
    if (!worker || hadActive) { this.discardWorker(); return Promise.resolve(); }
    // An idle classifier can dispose in order. A stuck worker is still released.
    this.closing = new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); this.discardWorker(); resolve(); };
      const timer = setTimeout(finish, 1000);
      worker.onmessage = event => { if (event.data?.disposed) finish(); };
      worker.onerror = finish;
      worker.onmessageerror = finish;
      try { worker.postMessage({ action: 'dispose' } satisfies EntityWorkerRequest); } catch { finish(); }
    }).finally(() => { this.closing = undefined; this.pump(); });
    return this.closing;
  }
}
