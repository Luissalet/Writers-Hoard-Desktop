import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { BoundedImportQueue } from '../src/components/gallery/importQueue';

const CONCURRENCY = 2;
const BATCH_SIZES = [20, 100] as const;
const WARMUPS = 1;
const REPETITIONS = 5;
// A deterministic encoded-image working set. Persisted output is accounted for
// separately because Dexie must retain it after transient buffers are released.
const TRANSIENT_BYTES_PER_WORKER = 4 * 1024 * 1024;
const PERSISTED_BYTES_PER_RESULT = 1024 * 1024;

interface Measurement {
  elapsedMs: number;
  peakWorkers: number;
  peakTransientBytes: number;
  persistedResultBytes: number;
}

function percentile(values: number[], percentileValue: number): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * percentileValue) - 1)];
}

async function measure(batchSize: number): Promise<Measurement> {
  let activeWorkers = 0;
  let peakWorkers = 0;
  let persistedResultBytes = 0;
  let checksum = 0;
  const startedAt = performance.now();
  const queue = new BoundedImportQueue<number>({
    concurrency: CONCURRENCY,
    worker: async value => {
      // Allocate inside the worker, touch the memory, then stop retaining it as
      // soon as this file settles. This models the transient encode/decode
      // buffer without allocating all originals up front.
      const transient = new Uint8Array(TRANSIENT_BYTES_PER_WORKER);
      transient[0] = value & 0xff;
      transient[transient.length - 1] = (value * 17) & 0xff;
      activeWorkers += 1;
      peakWorkers = Math.max(peakWorkers, activeWorkers);
      await new Promise<void>(resolve => setImmediate(resolve));
      checksum ^= transient[0] ^ transient[transient.length - 1];
      persistedResultBytes += PERSISTED_BYTES_PER_RESULT;
      activeWorkers -= 1;
    },
  });

  queue.enqueue(Array.from({ length: batchSize }, (_, index) => ({
    id: `bench-${batchSize}-${index}`,
    label: `fixture-${index}.jpg`,
    input: index,
  })));
  await queue.waitForIdle();
  if (queue.getSnapshot().completed !== batchSize) throw new Error('benchmark batch did not complete');
  // Keep the reads observable to the runtime without retaining any buffer.
  if (checksum < 0) throw new Error('unreachable checksum');

  return {
    elapsedMs: performance.now() - startedAt,
    peakWorkers,
    peakTransientBytes: peakWorkers * TRANSIENT_BYTES_PER_WORKER,
    persistedResultBytes,
  };
}

export async function runGalleryImportQueueBenchmark(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  for (const batchSize of BATCH_SIZES) {
    for (let warmup = 0; warmup < WARMUPS; warmup += 1) await measure(batchSize);
    const measurements: Measurement[] = [];
    for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
      measurements.push(await measure(batchSize));
    }
    const elapsed = measurements.map(measurement => measurement.elapsedMs);
    results[String(batchSize)] = {
      medianMs: Number(percentile(elapsed, 0.5).toFixed(2)),
      p95Ms: Number(percentile(elapsed, 0.95).toFixed(2)),
      peakWorkers: Math.max(...measurements.map(measurement => measurement.peakWorkers)),
      peakTransientMiB: Math.max(...measurements.map(measurement => measurement.peakTransientBytes)) / 1024 / 1024,
      persistedResultMiB: measurements[0].persistedResultBytes / 1024 / 1024,
    };
  }

  const transientBudgetBytes = CONCURRENCY * TRANSIENT_BYTES_PER_WORKER;
  return {
    protocol: {
      runtime: process.version,
      platform: `${process.platform} ${process.arch}`,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpus: os.cpus().length,
      totalMemoryGiB: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(1)),
      fixture: `${TRANSIENT_BYTES_PER_WORKER / 1024 / 1024} MiB transient working buffer + ${PERSISTED_BYTES_PER_RESULT / 1024 / 1024} MiB persisted result per image`,
      batches: BATCH_SIZES,
      concurrency: CONCURRENCY,
      warmups: WARMUPS,
      repetitions: REPETITIONS,
    },
    budget: {
      maxWorkers: CONCURRENCY,
      maxTransientMiB: transientBudgetBytes / 1024 / 1024,
      rule: 'The 100-image batch must have the same transient peak as the 20-image batch; persisted result bytes are reported separately.',
    },
    results,
  };
}
