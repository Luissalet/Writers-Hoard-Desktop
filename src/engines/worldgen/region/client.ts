import type { HumanGeography } from '../core/settlements';
import type { WorldData } from '../core/types';
import { regionGeometry } from './terrain';
import {
  DEFAULT_REGION_PARAMS,
  type RegionData,
  type RegionParams,
  type RegionWindow,
} from './types';
import {
  packRegionGeography,
  type RegionWorkerReply,
  type RegionWorkerRequest,
} from './workerProtocol';

export interface RegionWorkerLike {
  onmessage: ((event: MessageEvent<RegionWorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: RegionWorkerRequest): void;
  terminate(): void;
}

export type RegionWorkerFactory = () => RegionWorkerLike;

export interface RegionRequestOptions {
  params?: Partial<RegionParams>;
  onProgress?: (stage: string, overall: number) => void;
  signal?: AbortSignal;
  /** Used by tests and constrained runtimes. Omit to use the Vite worker. */
  workerFactory?: RegionWorkerFactory;
}

export interface RegionRequestHandle {
  requestId: string;
  promise: Promise<RegionData>;
  cancel: () => void;
}

interface CacheEntry {
  world: WorldData;
  region: RegionData;
}

interface ActiveRequest {
  cancel: () => void;
}

interface WorkerSession {
  contextId: string;
  worker: RegionWorkerLike;
  factory: RegionWorkerFactory;
  world: WorldData;
  geography: HumanGeography;
  revision: number;
  activeRequestId?: string;
  lastUsed: number;
}

const defaultWorkerFactory: RegionWorkerFactory | null = typeof Worker === 'undefined'
  ? null
  : () => new Worker(new URL('../region.worker.ts', import.meta.url), { type: 'module' });

function abortError(): Error {
  const error = new Error('Regional generation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function cacheGeometryKey(
  world: WorldData,
  window: RegionWindow,
  params: RegionParams,
): string {
  const geometry = regionGeometry(world, window, params);
  return `${world.params.seed}:${world.revision ?? 0}`
    + `:${geometry.originX.toFixed(6)}:${geometry.originY.toFixed(6)}`
    + `:${geometry.worldPerCellX.toFixed(9)}:${geometry.width}x${geometry.height}`
    + `:${params.detail}:${params.settled}:${params.habitation}:${params.streamDensity}`;
}

/**
 * Renderer-side coordinator for derived regional data.
 *
 * The worker keeps a structured-cloned world context while it is idle, so
 * panning does not copy the global rasters on every cache miss. A cancelled
 * synchronous build terminates only its session, while request IDs make stale
 * replies harmless. Both the result LRU and idle-worker pool are bounded.
 */
export class RegionWorkerClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly active = new Map<string, ActiveRequest>();
  private readonly sessions = new Set<WorkerSession>();
  private readonly worldIds = new WeakMap<WorldData, number>();
  private readonly geographyIds = new WeakMap<HumanGeography, number>();
  private readonly cacheLimit: number;
  private readonly sessionLimit: number;
  private nextWorldId = 1;
  private nextGeographyId = 1;
  private nextRequestId = 1;
  private nextContextId = 1;

  constructor(cacheLimit = 6, sessionLimit = 2) {
    this.cacheLimit = Math.max(1, Math.floor(cacheLimit));
    this.sessionLimit = Math.max(1, Math.floor(sessionLimit));
  }

  request(
    world: WorldData,
    geography: HumanGeography,
    window: RegionWindow,
    options: RegionRequestOptions = {},
  ): RegionRequestHandle {
    const requestId = `region-${this.nextRequestId++}`;
    const params: RegionParams = { ...DEFAULT_REGION_PARAMS, ...options.params };
    const worldKey = this.worldIdentity(world);
    const geographyKey = this.geographyIdentity(geography);
    const key = `${worldKey}:${geographyKey}:${cacheGeometryKey(world, window, params)}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      options.onProgress?.('listo', 1);
      const region = hit.region.window.cx === window.cx && hit.region.window.cy === window.cy
        ? hit.region
        : { ...hit.region, window };
      return { requestId, promise: Promise.resolve(region), cancel: () => undefined };
    }

    if (options.signal?.aborted) {
      return { requestId, promise: Promise.reject(abortError()), cancel: () => undefined };
    }

    let session: WorkerSession | null = null;
    let settled = false;
    let rejectPromise: (reason: unknown) => void = () => undefined;
    let abortListener: (() => void) | null = null;

    const cleanup = (terminateSession: boolean) => {
      if (abortListener) options.signal?.removeEventListener('abort', abortListener);
      abortListener = null;
      this.active.delete(requestId);
      if (!session) return;
      if (terminateSession) {
        this.terminateSession(session);
      } else {
        session.worker.onmessage = null;
        session.worker.onerror = null;
        session.worker.onmessageerror = null;
        session.activeRequestId = undefined;
        session.lastUsed = Date.now();
        this.pruneSessions();
      }
      session = null;
    };

    const cancel = () => {
      if (settled) return;
      settled = true;
      try {
        session?.worker.postMessage({ type: 'cancel', requestId });
      } finally {
        cleanup(true);
        rejectPromise(abortError());
      }
    };

    const promise = new Promise<RegionData>((resolve, reject) => {
      rejectPromise = reject;
      const finish = (region: RegionData) => {
        if (settled) return;
        settled = true;
        cleanup(false);
        this.remember(key, world, region);
        resolve(region);
      };
      const fail = (reason: unknown) => {
        if (settled) return;
        settled = true;
        cleanup(true);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      };
      const factory = options.workerFactory === undefined ? defaultWorkerFactory : options.workerFactory;
      if (!factory) {
        fail(new Error('Regional generation requires a Web Worker.'));
        return;
      }

      try {
        session = this.acquireSession(factory, world, geography, requestId);
      } catch (error) {
        fail(error);
        return;
      }

      session.worker.onmessage = (event) => {
        const reply = event.data;
        if (reply.type === 'configured' || settled) return;
        if (reply.requestId !== requestId) return;
        if (reply.type === 'progress') {
          options.onProgress?.(reply.stage, reply.overall);
        } else if (reply.type === 'done') {
          finish(reply.region);
        } else if (reply.type === 'cancelled') {
          cancel();
        } else {
          fail(new Error(reply.message));
        }
      };
      session.worker.onerror = (event) => {
        event.preventDefault();
        fail(new Error(event.message || 'Regional worker failed.'));
      };
      session.worker.onmessageerror = () => {
        fail(new Error('Regional worker returned an unreadable message.'));
      };
      try {
        session.worker.postMessage({
          type: 'generate',
          requestId,
          contextId: session.contextId,
          window,
          params,
        });
      } catch (error) {
        fail(error);
      }
    });

    if (!settled) {
      abortListener = cancel;
      options.signal?.addEventListener('abort', abortListener, { once: true });
      this.active.set(requestId, { cancel });
    }
    return { requestId, promise, cancel };
  }

  clear(world?: WorldData): void {
    if (!world) {
      this.cache.clear();
      for (const request of [...this.active.values()]) request.cancel();
      for (const session of [...this.sessions]) this.terminateSession(session);
      return;
    }
    for (const [key, entry] of this.cache) {
      if (entry.world === world) this.cache.delete(key);
    }
    for (const session of [...this.sessions]) {
      if (session.world !== world) continue;
      if (session.activeRequestId) {
        this.active.get(session.activeRequestId)?.cancel();
      } else {
        this.terminateSession(session);
      }
    }
  }

  dispose(): void {
    for (const request of [...this.active.values()]) request.cancel();
    for (const session of [...this.sessions]) this.terminateSession(session);
    this.cache.clear();
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  get workerSessionCount(): number {
    return this.sessions.size;
  }

  private acquireSession(
    factory: RegionWorkerFactory,
    world: WorldData,
    geography: HumanGeography,
    requestId: string,
  ): WorkerSession {
    const revision = world.revision ?? 0;
    for (const candidate of this.sessions) {
      if (candidate.activeRequestId
        || candidate.factory !== factory
        || candidate.world !== world
        || candidate.geography !== geography
        || candidate.revision !== revision) continue;
      candidate.activeRequestId = requestId;
      candidate.lastUsed = Date.now();
      return candidate;
    }

    const worker = factory();
    const session: WorkerSession = {
      contextId: `region-context-${this.nextContextId++}`,
      worker,
      factory,
      world,
      geography,
      revision,
      activeRequestId: requestId,
      lastUsed: Date.now(),
    };
    this.sessions.add(session);
    try {
      worker.postMessage({
        type: 'configure',
        contextId: session.contextId,
        world,
        geography: packRegionGeography(geography),
      });
    } catch (error) {
      this.terminateSession(session);
      throw error;
    }
    this.pruneSessions();
    return session;
  }

  private terminateSession(session: WorkerSession): void {
    session.worker.onmessage = null;
    session.worker.onerror = null;
    session.worker.onmessageerror = null;
    session.worker.terminate();
    this.sessions.delete(session);
  }

  private pruneSessions(): void {
    while (this.sessions.size > this.sessionLimit) {
      let oldest: WorkerSession | null = null;
      for (const candidate of this.sessions) {
        if (candidate.activeRequestId) continue;
        if (!oldest || candidate.lastUsed < oldest.lastUsed) oldest = candidate;
      }
      if (!oldest) return;
      this.terminateSession(oldest);
    }
  }

  private geographyIdentity(geography: HumanGeography): number {
    let id = this.geographyIds.get(geography);
    if (id === undefined) {
      id = this.nextGeographyId++;
      this.geographyIds.set(geography, id);
    }
    return id;
  }

  private worldIdentity(world: WorldData): number {
    let id = this.worldIds.get(world);
    if (id === undefined) {
      id = this.nextWorldId++;
      this.worldIds.set(world, id);
    }
    return id;
  }

  private remember(key: string, world: WorldData, region: RegionData): void {
    this.cache.delete(key);
    this.cache.set(key, { world, region });
    while (this.cache.size > this.cacheLimit) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

export const regionClient = new RegionWorkerClient();

export function requestRegion(
  world: WorldData,
  geography: HumanGeography,
  window: RegionWindow,
  options?: RegionRequestOptions,
): RegionRequestHandle {
  return regionClient.request(world, geography, window, options);
}

export function generateRegionAsync(
  world: WorldData,
  geography: HumanGeography,
  window: RegionWindow,
  options?: RegionRequestOptions,
): Promise<RegionData> {
  return requestRegion(world, geography, window, options).promise;
}
