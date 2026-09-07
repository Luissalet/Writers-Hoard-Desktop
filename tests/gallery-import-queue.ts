import { BoundedImportQueue } from '../src/components/gallery/importQueue';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function nextTurn(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 2));
}

async function testConcurrencyLimit(): Promise<void> {
  let active = 0;
  let peak = 0;
  const completed: number[] = [];
  const queue = new BoundedImportQueue<number>({
    concurrency: 2,
    worker: async value => {
      active += 1;
      peak = Math.max(peak, active);
      await nextTurn();
      completed.push(value);
      active -= 1;
    },
  });

  queue.enqueue(Array.from({ length: 12 }, (_, index) => ({
    id: `limited-${index}`,
    label: `limited-${index}.png`,
    input: index,
  })));
  await queue.waitForIdle();

  const snapshot = queue.getSnapshot();
  assert(peak === 2, `expected exactly two concurrent workers, observed ${peak}`);
  assert(completed.length === 12, `expected all 12 files to complete, got ${completed.length}`);
  assert(snapshot.completed === 12 && snapshot.failed === 0, 'the bounded batch did not settle cleanly');
}

async function testFailureIsolationAndRetry(): Promise<void> {
  const attempts = new Map<string, number>();
  const completed: string[] = [];
  const queue = new BoundedImportQueue<string>({
    concurrency: 2,
    worker: async value => {
      const attempt = (attempts.get(value) ?? 0) + 1;
      attempts.set(value, attempt);
      await nextTurn();
      if (value === 'broken' && attempt === 1) throw new Error('synthetic decode failure');
      completed.push(value);
    },
  });

  queue.enqueue(['before', 'broken', 'after-a', 'after-b'].map(value => ({
    id: value,
    label: `${value}.png`,
    input: value,
  })));
  await queue.waitForIdle();

  let snapshot = queue.getSnapshot();
  assert(snapshot.completed === 3, `one failure stopped neighbours: ${snapshot.completed} completed`);
  assert(snapshot.failed === 1, `expected one isolated failure, got ${snapshot.failed}`);
  assert(completed.includes('after-a') && completed.includes('after-b'), 'files after the failure never ran');
  assert(queue.retry('broken'), 'the failed file was not retained for retry');

  await queue.waitForIdle();
  snapshot = queue.getSnapshot();
  assert(snapshot.completed === 4 && snapshot.failed === 0, 'a successful per-file retry did not heal the batch');
  assert(attempts.get('broken') === 2, 'retry did not run exactly one additional attempt');
}

async function testCancellationReleasesTheBatch(): Promise<void> {
  const queue = new BoundedImportQueue<number>({
    concurrency: 1,
    worker: (_value, { signal }) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 100);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    }),
  });

  queue.enqueue(Array.from({ length: 4 }, (_, index) => ({
    id: `cancel-${index}`,
    label: `cancel-${index}.png`,
    input: index,
  })));
  queue.cancelPending();
  await queue.waitForIdle();

  const snapshot = queue.getSnapshot();
  assert(snapshot.cancelled === 4, `cancel left ${4 - snapshot.cancelled} file(s) alive`);
  assert(snapshot.running === 0 && snapshot.queued === 0, 'cancel left runnable work behind');
  assert(queue.clearSettled(), 'a cancelled batch could not release its settled records');
  assert(queue.getSnapshot().total === 0, 'clearing the batch retained queue records');
}

export async function runGalleryImportQueueTests(): Promise<string[]> {
  await testConcurrencyLimit();
  await testFailureIsolationAndRetry();
  await testCancellationReleasesTheBatch();
  return [
    'gallery import concurrency is bounded',
    'gallery import failures are isolated and retryable',
    'gallery import cancellation releases pending work',
  ];
}
