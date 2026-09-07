// ============================================================================
// Pending writes — one truthful save ledger for every buffered editor
// ============================================================================

export interface PendingWritesSnapshot {
  pending: number;
  failed: number;
  dirty: number;
  lastSavedAt: number | null;
}

interface FailedWrite {
  retry?: () => Promise<unknown>;
}

type Flusher = () => Promise<boolean>;

const listeners = new Set<() => void>();
const active = new Map<number, Promise<unknown>>();
const failed = new Map<string, FailedWrite>();
const ownerGeneration = new Map<string, number>();
const flushers = new Map<string, Flusher>();
let nextWriteId = 0;
let lastSavedAt: number | null = null;
let snapshot: PendingWritesSnapshot = { pending: 0, failed: 0, dirty: 0, lastSavedAt: null };

function publish(): void {
  snapshot = {
    pending: active.size,
    failed: failed.size,
    dirty: flushers.size,
    lastSavedAt,
  };
  for (const listener of listeners) listener();
}

export function subscribePendingWrites(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPendingWritesSnapshot(): PendingWritesSnapshot {
  return snapshot;
}

/**
 * Track an async persistence promise until it settles. Rejections remain in
 * the ledger with an optional retry instead of disappearing into `void`.
 */
export function trackPendingWrite<T>(
  promise: Promise<T>,
  retry?: () => Promise<unknown>,
  ownerId?: string,
): Promise<T> {
  const id = ++nextWriteId;
  const failureKey = ownerId ?? `write:${id}`;
  ownerGeneration.set(failureKey, id);
  active.set(id, promise);
  publish();
  return promise.then(
    (value) => {
      active.delete(id);
      if (ownerGeneration.get(failureKey) === id) {
        failed.delete(failureKey);
        ownerGeneration.delete(failureKey);
      }
      lastSavedAt = Date.now();
      publish();
      return value;
    },
    (error: unknown) => {
      active.delete(id);
      // A slow, obsolete write must not paint a later successful save red.
      if (ownerGeneration.get(failureKey) === id) {
        failed.set(failureKey, { retry });
      }
      publish();
      throw error;
    },
  );
}

/** Register buffered work that must be flushed before navigation/app close. */
export function registerPendingFlusher(id: string, flush: Flusher): () => void {
  flushers.set(id, flush);
  publish();
  return () => {
    if (flushers.get(id) === flush) {
      flushers.delete(id);
      publish();
    }
  };
}

export async function retryFailedWrites(): Promise<void> {
  // A failure without a retry callback must remain visible. Silently clearing
  // it would turn the status chip green without ever persisting the edit.
  const retries = [...failed.entries()].filter(([, entry]) => Boolean(entry.retry));
  for (const [id] of retries) failed.delete(id);
  publish();
  await Promise.allSettled(
    retries.map(([, entry]) => entry.retry!()),
  );
}

/** Only after deliberate discard or confirmed deletion of this owner's data. */
export function discardPendingOwner(ownerId: string): void {
  failed.delete(ownerId);
  flushers.delete(ownerId);
  ownerGeneration.delete(ownerId);
  publish();
}

export interface FlushPendingWritesResult {
  ok: boolean;
  timedOut: boolean;
  failed: number;
}

/**
 * Ask every buffered owner to enqueue its latest value, then wait for all
 * writes that exist after that flush. The timeout keeps a broken storage layer
 * from holding the desktop window forever.
 */
export async function flushPendingWrites(timeoutMs = 8_000): Promise<FlushPendingWritesResult> {
  const work = (async (): Promise<FlushPendingWritesResult> => {
    const flushed = await Promise.allSettled([...flushers.values()].map(flush => flush()));
    // Writes can enqueue another serialised write as they settle. Drain until
    // the ledger is actually empty; the outer timeout remains the hard stop.
    while (active.size > 0) {
      await Promise.allSettled([...active.values()]);
    }
    const flusherFailed = flushed.some(result => result.status === 'rejected' || !result.value);
    return { ok: !flusherFailed && failed.size === 0, timedOut: false, failed: failed.size };
  })();

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<FlushPendingWritesResult>((resolve) => {
    timeoutId = setTimeout(() => resolve({ ok: false, timedOut: true, failed: failed.size }), timeoutMs);
  });
  const result = await Promise.race([work, timeout]);
  if (timeoutId !== null) clearTimeout(timeoutId);
  return result;
}
