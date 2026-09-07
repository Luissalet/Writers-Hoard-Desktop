import {
  flushPendingWrites,
  getPendingWritesSnapshot,
  registerPendingFlusher,
  retryFailedWrites,
  subscribePendingWrites,
  trackPendingWrite,
} from '@/services/pendingWrites';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export async function runPendingWriteTests(): Promise<string[]> {
  const passed: string[] = [];
  let notifications = 0;
  const unsubscribe = subscribePendingWrites(() => { notifications += 1; });

  const first = deferred<void>();
  const trackedFirst = trackPendingWrite(first.promise, undefined, 'pending-test:first');
  assert(getPendingWritesSnapshot().pending === 1, 'a live write must be visible as pending');
  first.resolve();
  await trackedFirst;
  assert(getPendingWritesSnapshot().pending === 0, 'a settled write must leave the pending ledger');
  assert(getPendingWritesSnapshot().lastSavedAt !== null, 'a successful write must publish its saved time');
  passed.push('Pending writes: pending and saved states are observable');

  const old = deferred<void>();
  const newest = deferred<void>();
  const oldTracked = trackPendingWrite(old.promise, undefined, 'pending-test:generation');
  const newestTracked = trackPendingWrite(newest.promise, undefined, 'pending-test:generation');
  newest.resolve();
  await newestTracked;
  old.reject(new Error('obsolete write failed late'));
  await oldTracked.catch(() => undefined);
  assert(
    getPendingWritesSnapshot().failed === 0,
    'an obsolete rejection must not overwrite the later successful generation',
  );
  passed.push('Pending writes: stale failures cannot overwrite a newer success');

  let retries = 0;
  const retry = async (): Promise<void> => {
    retries += 1;
    await trackPendingWrite(Promise.resolve(), retry, 'pending-test:retry');
  };
  await trackPendingWrite(
    Promise.reject(new Error('storage unavailable')),
    retry,
    'pending-test:retry',
  ).catch(() => undefined);
  assert(getPendingWritesSnapshot().failed === 1, 'a rejected write must remain visible');
  await retryFailedWrites();
  assert(retries === 1, 'retry must invoke the stored persistence operation exactly once');
  assert(getPendingWritesSnapshot().failed === 0, 'a successful retry must clear the failure');
  passed.push('Pending writes: failed edits remain retryable until persistence succeeds');

  let flushes = 0;
  const unregisterFlush = registerPendingFlusher('pending-test:flusher', async () => {
    flushes += 1;
    await trackPendingWrite(Promise.resolve(), undefined, 'pending-test:flushed-write');
    return true;
  });
  assert(getPendingWritesSnapshot().dirty === 1, 'buffered work must be exposed as dirty');
  const flushed = await flushPendingWrites(100);
  unregisterFlush();
  assert(flushed.ok && !flushed.timedOut, 'a successful close flush must be accepted');
  assert(flushes === 1, 'the global flush must ask every dirty owner once');
  assert(getPendingWritesSnapshot().dirty === 0, 'unmounted owners must leave the dirty ledger');
  passed.push('Pending writes: close flush drains registered editors');

  const unregisterStuck = registerPendingFlusher(
    'pending-test:stuck',
    () => new Promise<boolean>(() => undefined),
  );
  const timedOut = await flushPendingWrites(5);
  unregisterStuck();
  assert(!timedOut.ok && timedOut.timedOut, 'a stuck storage layer must time out visibly');
  assert(notifications > 0, 'ledger subscribers must be notified of state transitions');
  unsubscribe();
  passed.push('Pending writes: a stuck flush times out instead of hanging window close');

  return passed;
}
