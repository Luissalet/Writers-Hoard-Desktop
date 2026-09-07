// ============================================================================
// One process lane for every yt-dlp / ffmpeg entry point
// ============================================================================

export class MediaDownloadCancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'AbortError';
  }
}

type QueueState = 'pending' | 'active' | 'settled';

interface QueueEntry {
  state: QueueState;
  controller: AbortController;
  externalSignal?: AbortSignal;
  onExternalAbort?: () => void;
  run: (signal: AbortSignal) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * FIFO, concurrency-one queue with real pending cancellation.
 *
 * Aborting an entry that has not started removes it from the queue and rejects
 * it without ever invoking `run`. An active entry receives an aborted signal,
 * but keeps the lane until its runner settles; this prevents the next yt-dlp
 * process from starting while the old process tree is still being reaped.
 */
export class MediaDownloadQueue {
  private readonly pending: QueueEntry[] = [];
  private active: QueueEntry | null = null;

  get pendingCount(): number {
    return this.pending.length;
  }

  get activeCount(): number {
    return this.active ? 1 : 0;
  }

  enqueue<T>(
    run: (signal: AbortSignal) => Promise<T>,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    if (externalSignal?.aborted) return Promise.reject(new MediaDownloadCancelledError());

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = {
        state: 'pending',
        controller: new AbortController(),
        externalSignal,
        run,
        resolve: (value) => resolve(value as T),
        reject,
      };

      if (externalSignal) {
        entry.onExternalAbort = () => this.cancel(entry);
        externalSignal.addEventListener('abort', entry.onExternalAbort, { once: true });
      }

      this.pending.push(entry);
      if (externalSignal?.aborted) {
        this.cancel(entry);
        return;
      }
      this.drain();
    });
  }

  /** Abort the active runner and reject every pending entry without running it. */
  cancelAll(): void {
    this.active?.controller.abort();
    for (const entry of [...this.pending]) this.cancel(entry);
  }

  private cancel(entry: QueueEntry): void {
    if (entry.state === 'settled') return;
    entry.controller.abort();

    if (entry.state === 'active') return;
    const index = this.pending.indexOf(entry);
    if (index >= 0) this.pending.splice(index, 1);
    entry.state = 'settled';
    this.detachExternalSignal(entry);
    entry.reject(new MediaDownloadCancelledError());
  }

  private drain(): void {
    if (this.active) return;

    let entry = this.pending.shift();
    while (entry?.controller.signal.aborted) {
      if (entry.state !== 'settled') {
        entry.state = 'settled';
        this.detachExternalSignal(entry);
        entry.reject(new MediaDownloadCancelledError());
      }
      entry = this.pending.shift();
    }
    if (!entry) return;

    entry.state = 'active';
    this.active = entry;
    Promise.resolve()
      .then(() => {
        if (entry.controller.signal.aborted) throw new MediaDownloadCancelledError();
        return entry.run(entry.controller.signal);
      })
      .then(
        (value) => this.finish(entry, () => entry.resolve(value)),
        (error: unknown) => this.finish(entry, () => entry.reject(error)),
      );
  }

  private finish(entry: QueueEntry, settle: () => void): void {
    if (entry.state === 'settled') return;
    entry.state = 'settled';
    this.detachExternalSignal(entry);
    if (this.active === entry) this.active = null;
    settle();
    this.drain();
  }

  private detachExternalSignal(entry: QueueEntry): void {
    if (entry.externalSignal && entry.onExternalAbort) {
      entry.externalSignal.removeEventListener('abort', entry.onExternalAbort);
    }
  }
}

/** Shared by the embedded HTTP route and every main-process IPC download. */
export const mediaDownloadQueue = new MediaDownloadQueue();
