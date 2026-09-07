export const DEFAULT_GALLERY_IMPORT_CONCURRENCY = 2;
export const MAX_GALLERY_IMPORT_CONCURRENCY = 4;

export type ImportQueueItemState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ImportQueueItem<T> {
  id: string;
  label: string;
  input: T;
}

export interface ImportQueueItemSnapshot {
  id: string;
  label: string;
  state: ImportQueueItemState;
  attempts: number;
  error?: string;
}

export interface ImportQueueSnapshot {
  items: ImportQueueItemSnapshot[];
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  processed: number;
  paused: boolean;
  idle: boolean;
}

export interface ImportQueueWorkerContext {
  id: string;
  label: string;
  attempt: number;
  signal: AbortSignal;
}

export interface BoundedImportQueueOptions<T> {
  concurrency?: number;
  worker?: ImportQueueWorker<T>;
  errorMessage?: (reason: unknown) => string;
}

export type ImportQueueWorker<T> = (
  input: T,
  context: ImportQueueWorkerContext,
) => Promise<void>;

interface InternalQueueItem<T> extends ImportQueueItemSnapshot {
  input: T | undefined;
  worker: ImportQueueWorker<T>;
  cancelRequested: boolean;
}

type SnapshotListener = (snapshot: ImportQueueSnapshot) => void;

function normaliseConcurrency(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_GALLERY_IMPORT_CONCURRENCY;
  return Math.min(
    MAX_GALLERY_IMPORT_CONCURRENCY,
    Math.max(1, Math.floor(value as number)),
  );
}

function defaultErrorMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  if (typeof reason === 'string' && reason.trim()) return reason;
  return 'Import failed';
}

/**
 * A bounded, retryable queue for memory-heavy imports.
 *
 * The queue deliberately removes an input from its internal item before the
 * worker starts. A successful/cancelled input becomes unreachable as soon as
 * that worker settles; only a failed input is retained so the user can retry
 * that one file. Scheduling is incremental and never aggregates the batch into
 * one fail-fast promise, so a rejection cannot short-circuit neighbouring files.
 */
export class BoundedImportQueue<T> {
  private readonly defaultWorker?: ImportQueueWorker<T>;
  private readonly errorMessage: NonNullable<BoundedImportQueueOptions<T>['errorMessage']>;
  private readonly items = new Map<string, InternalQueueItem<T>>();
  private readonly pendingIds: string[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Set<SnapshotListener>();
  private readonly idleWaiters = new Set<() => void>();
  private activeCount = 0;
  private paused = false;
  private workerLimit: number;

  constructor(options: BoundedImportQueueOptions<T>) {
    this.workerLimit = normaliseConcurrency(options.concurrency);
    this.defaultWorker = options.worker;
    this.errorMessage = options.errorMessage ?? defaultErrorMessage;
  }

  get concurrency(): number {
    return this.workerLimit;
  }

  setConcurrency(value: number): void {
    const next = normaliseConcurrency(value);
    if (next === this.workerLimit) return;
    this.workerLimit = next;
    this.publish();
    this.pump();
  }

  getSnapshot(): ImportQueueSnapshot {
    const items = [...this.items.values()].map(({ id, label, state, attempts, error }) => ({
      id,
      label,
      state,
      attempts,
      ...(error ? { error } : {}),
    }));
    const count = (state: ImportQueueItemState) => items.filter(item => item.state === state).length;
    const queued = count('queued');
    const running = count('running');
    const completed = count('completed');
    const failed = count('failed');
    const cancelled = count('cancelled');

    return {
      items,
      total: items.length,
      queued,
      running,
      completed,
      failed,
      cancelled,
      processed: completed + failed + cancelled,
      paused: this.paused,
      idle: queued === 0 && running === 0,
    };
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  enqueue(entries: readonly ImportQueueItem<T>[], worker = this.defaultWorker): void {
    if (!worker) throw new Error('An import queue worker is required');
    const incomingIds = new Set<string>();
    for (const entry of entries) {
      if (this.items.has(entry.id) || incomingIds.has(entry.id)) {
        throw new Error(`Duplicate import queue item: ${entry.id}`);
      }
      incomingIds.add(entry.id);
    }

    for (const entry of entries) {
      this.items.set(entry.id, {
        id: entry.id,
        label: entry.label,
        input: entry.input,
        worker,
        state: 'queued',
        attempts: 0,
        cancelRequested: false,
      });
      this.pendingIds.push(entry.id);
    }

    this.publish();
    this.pump();
  }

  pause(): void {
    if (this.paused || !this.getSnapshot().queued) return;
    this.paused = true;
    this.publish();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.publish();
    this.pump();
  }

  cancelTask(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;

    if (item.state === 'queued') {
      item.state = 'cancelled';
      item.input = undefined;
      this.publish();
      this.pump();
      this.resolveIdleWaitersIfNeeded();
      return true;
    }

    if (item.state === 'running') {
      item.cancelRequested = true;
      this.controllers.get(id)?.abort(new DOMException('Import cancelled', 'AbortError'));
      return true;
    }

    return false;
  }

  cancelPending(): void {
    this.paused = false;
    for (const item of this.items.values()) {
      if (item.state === 'queued') {
        item.state = 'cancelled';
        item.input = undefined;
      } else if (item.state === 'running') {
        item.cancelRequested = true;
        this.controllers.get(item.id)?.abort(new DOMException('Import cancelled', 'AbortError'));
      }
    }
    this.publish();
    this.resolveIdleWaitersIfNeeded();
  }

  retry(id: string): boolean {
    const item = this.items.get(id);
    if (!item || item.state !== 'failed' || item.input === undefined) return false;

    item.state = 'queued';
    item.error = undefined;
    item.cancelRequested = false;
    this.pendingIds.push(id);
    this.publish();
    this.pump();
    return true;
  }

  /** Releases all settled inputs (including retry copies) after a batch. */
  clearSettled(): boolean {
    if (!this.getSnapshot().idle) return false;
    this.items.clear();
    this.pendingIds.length = 0;
    this.paused = false;
    this.publish();
    return true;
  }

  waitForIdle(): Promise<void> {
    if (this.getSnapshot().idle) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.add(resolve));
  }

  private pump(): void {
    while (!this.paused && this.activeCount < this.workerLimit) {
      const item = this.takeNextQueuedItem();
      if (!item) break;
      this.start(item);
    }
  }

  private takeNextQueuedItem(): InternalQueueItem<T> | undefined {
    while (this.pendingIds.length > 0) {
      const id = this.pendingIds.shift();
      if (!id) continue;
      const item = this.items.get(id);
      if (item?.state === 'queued') return item;
    }
    return undefined;
  }

  private start(item: InternalQueueItem<T>): void {
    const input = item.input;
    if (input === undefined) {
      item.state = 'failed';
      item.error = 'Import input was released before it could run';
      this.publish();
      return;
    }

    // This is the key memory invariant: the queue itself no longer owns the
    // active payload. At most `concurrency` worker closures can own one.
    item.input = undefined;
    item.state = 'running';
    item.attempts += 1;
    item.error = undefined;
    item.cancelRequested = false;
    this.activeCount += 1;

    const controller = new AbortController();
    this.controllers.set(item.id, controller);
    this.publish();

    void (async () => {
      try {
        await item.worker(input, {
          id: item.id,
          label: item.label,
          attempt: item.attempts,
          signal: controller.signal,
        });
        // An unabortable final write may have completed after Cancel. Report
        // that truthfully as completed instead of claiming persisted data was
        // cancelled.
        item.state = 'completed';
      } catch (reason) {
        if (controller.signal.aborted || item.cancelRequested) {
          item.state = 'cancelled';
        } else {
          item.state = 'failed';
          item.error = this.errorMessage(reason);
          item.input = input;
        }
      } finally {
        this.controllers.delete(item.id);
        this.activeCount -= 1;
        this.publish();
        this.pump();
        this.resolveIdleWaitersIfNeeded();
      }
    })();
  }

  private publish(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private resolveIdleWaitersIfNeeded(): void {
    if (!this.getSnapshot().idle) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
