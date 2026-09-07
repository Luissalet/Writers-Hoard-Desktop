// Responsive full-geography builds
// ============================================
// One background flight for the active world. Results are cached by world
// object + content/revision; revisiting 2D adopts instantly, while a new world
// supersedes work that can no longer be shown.

import {
  DEFAULT_HUMAN_PARAMS,
  type GeoDepth,
  type HumanGeography,
  type HumanGeographyParams,
} from '../core/settlements';
import type { WorldData } from '../core/types';
import { buildLanguageFamily } from '../core/language';
import { worldContentKey } from '../region/contentIdentity';
import type { GeographyWorkerReply, GeographyWorkerRequest } from '../geography.worker';

interface WorkerLike {
  onmessage: ((event: MessageEvent<GeographyWorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: GeographyWorkerRequest): void;
  terminate(): void;
}

export type GeographyWorkerFactory = () => WorkerLike;

const defaultFactory: GeographyWorkerFactory = () => new Worker(
  new URL('../geography.worker.ts', import.meta.url),
  { type: 'module' },
) as unknown as WorkerLike;

interface CachedBase { key: string; geography: HumanGeography }
const CACHE = new WeakMap<WorldData, CachedBase>();

interface Flight {
  world: WorldData;
  key: string;
  worker: WorkerLike;
  promise: Promise<HumanGeography>;
  reject: (reason?: unknown) => void;
  consumers: number;
}

let active: Flight | null = null;
let nextRequestId = 1;

function buildKey(
  world: WorldData,
  depth: GeoDepth,
  params: HumanGeographyParams,
): string {
  return `${worldContentKey(world)}:${depth}:${JSON.stringify(params)}`
    + `:${JSON.stringify(world.painted?.sitesPolicy ?? null)}`;
}

/** Each caller owns its cancellation. A shared build survives until its last
 * consumer leaves; an old effect can never terminate the next world's worker. */
function subscribe(flight: Flight, signal?: AbortSignal): Promise<HumanGeography> {
  flight.consumers++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const release = () => {
      settled = true;
      flight.consumers--;
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      if (settled) return;
      release();
      reject(new DOMException('Geography request cancelled.', 'AbortError'));
      if (flight.consumers === 0 && active === flight) cancelActiveGeographyBuild();
    };
    flight.promise.then((base) => {
      if (settled) return;
      release(); resolve(base);
    }, (error) => {
      if (settled) return;
      release(); reject(error);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export function requestGeographyBase(
  world: WorldData,
  depth: GeoDepth = 'full',
  params: HumanGeographyParams = { ...DEFAULT_HUMAN_PARAMS, sites: 'auto' },
  workerFactory: GeographyWorkerFactory = defaultFactory,
  signal?: AbortSignal,
): Promise<HumanGeography> {
  if (signal?.aborted) return Promise.reject(new DOMException('Geography request cancelled.', 'AbortError'));
  const key = buildKey(world, depth, params);
  const cached = CACHE.get(world);
  if (cached?.key === key) return Promise.resolve(cached.geography);
  if (active?.world === world && active.key === key) return subscribe(active, signal);

  cancelActiveGeographyBuild();
  const requestId = nextRequestId++;
  let worker: WorkerLike;
  try { worker = workerFactory(); } catch (error) { return Promise.reject(error); }
  let resolveFlight!: (base: HumanGeography) => void;
  let rejectFlight!: (reason?: unknown) => void;
  const promise = new Promise<HumanGeography>((resolve, reject) => {
    resolveFlight = resolve; rejectFlight = reject;
  });
  const flight: Flight = { world, key, worker, promise, reject: rejectFlight, consumers: 0 };
  active = flight;
  const result = subscribe(flight, signal);
  worker.onmessage = (event) => {
    const reply = event.data;
    if (reply.requestId !== requestId || active !== flight) return;
    worker.terminate(); active = null;
    if (reply.type === 'error') { rejectFlight(new Error(reply.message)); return; }
    const geography: HumanGeography = 'languages' in reply.geography
      ? reply.geography
      : {
        ...reply.geography,
        languages: buildLanguageFamily(
          world.params.seed,
          reply.languageCount ?? Math.max(2, new Set(Object.values(reply.geography.languageOf)).size),
        ),
      };
    CACHE.set(world, { key, geography });
    resolveFlight(geography);
  };
  worker.onerror = (event) => {
    if (active !== flight) return;
    worker.terminate(); active = null;
    rejectFlight(new Error(event.message || 'Geography worker failed.'));
  };
  try { worker.postMessage({ type: 'build', requestId, world, depth, params }); }
  catch (error) { worker.terminate(); if (active === flight) active = null; rejectFlight(error); }
  return result;
}

/** Test isolation and app teardown helper. Does not touch the immutable cache. */
export function cancelActiveGeographyBuild(): void {
  if (!active) return;
  const previous = active; active = null;
  previous.worker.terminate();
  previous.reject(new DOMException('Geography build cancelled.', 'AbortError'));
}
