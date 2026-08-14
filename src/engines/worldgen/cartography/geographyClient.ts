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

export function requestGeographyBase(
  world: WorldData,
  depth: GeoDepth = 'full',
  params: HumanGeographyParams = { ...DEFAULT_HUMAN_PARAMS, sites: 'auto' },
  workerFactory: GeographyWorkerFactory = defaultFactory,
): Promise<HumanGeography> {
  const key = buildKey(world, depth, params);
  const cached = CACHE.get(world);
  if (cached?.key === key) return Promise.resolve(cached.geography);
  if (active?.world === world && active.key === key) return active.promise;

  if (active) {
    active.worker.terminate();
    active.reject(new DOMException('Geography build superseded.', 'AbortError'));
    active = null;
  }

  const requestId = nextRequestId++;
  const worker = workerFactory();
  let rejectFlight!: (reason?: unknown) => void;
  const promise = new Promise<HumanGeography>((resolve, reject) => {
    rejectFlight = reject;
    worker.onmessage = (event) => {
      const reply = event.data;
      if (reply.requestId !== requestId) return;
      worker.terminate();
      if (active?.worker === worker) active = null;
      if (reply.type === 'error') {
        reject(new Error(reply.message));
        return;
      }
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
      resolve(geography);
    };
    worker.onerror = (event) => {
      worker.terminate();
      if (active?.worker === worker) active = null;
      reject(new Error(event.message || 'Geography worker failed.'));
    };
    worker.postMessage({ type: 'build', requestId, world, depth, params });
  });
  active = { world, key, worker, promise, reject: rejectFlight };
  return promise;
}

/** Test isolation and app teardown helper. Does not touch the immutable cache. */
export function cancelActiveGeographyBuild(): void {
  if (!active) return;
  active.worker.terminate();
  active.reject(new DOMException('Geography build cancelled.', 'AbortError'));
  active = null;
}
