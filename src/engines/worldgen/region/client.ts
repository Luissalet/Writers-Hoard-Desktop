import type { HumanGeography } from '../core/settlements';
import type { TilePlace } from './deepTile';
import { forgeAvailable, forgeDegraded, spawnForgeWorker } from '../forge/bridge';
import type { WorldData } from '../core/types';
import { regionGeometry, type RegionGeometry } from './terrain';
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

/** A display tile from the worker: pixels plus, for DEEP tiles, the named
 *  places on its ground — the main thread letters those live. */
export interface RenderedTile {
  bitmap: ImageBitmap;
  places?: TilePlace[];
}

export interface RegionRequestOptions {
  params?: Partial<RegionParams>;
  onProgress?: (stage: string, overall: number) => void;
  signal?: AbortSignal;
  /** Canon tiles pass their world-aligned grid; freeform sheets omit it. */
  geometry?: RegionGeometry;
  /** Serialized edit list for canon replay-at-resolution. Part of the cache
   *  identity: the same ground with different strokes is different country. */
  edits?: string;
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
  bytes: number;
  epoch: number;
}

/** Approximate resident size of a RegionData — the rasters dominate. */
function regionBytes(r: RegionData): number {
  return r.elevation.byteLength + r.water.byteLength + r.flow.byteLength
    + r.slope.byteLength + r.wet.byteLength + r.biome.byteLength
    + r.cover.byteLength + 4096;
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

// The Forge first: a dedicated OS process per session, outside the renderer's
// memory budget and crash boundary. The Web Worker stays as the universal
// fallback — browsers, harnesses, any desktop where the Forge is missing —
// and also as the EMERGENCY lane: if a forge child dies unanswered (bundle
// roto, módulo nativo ausente), the bridge marks itself degraded and every
// later spawn silently returns a Web Worker instead of hanging the pool.
const webWorkerFactory: RegionWorkerFactory | null = typeof Worker === 'undefined'
  ? null
  : () => new Worker(new URL('../region.worker.ts', import.meta.url), { type: 'module' });

const defaultWorkerFactory: RegionWorkerFactory | null = forgeAvailable()
  ? () => (forgeDegraded() && webWorkerFactory
    ? webWorkerFactory()
    : spawnForgeWorker('region') as unknown as Worker)
  : webWorkerFactory;

function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function abortError(): Error {
  const error = new Error('Regional generation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function cacheGeometryKey(
  world: WorldData,
  window: RegionWindow,
  params: RegionParams,
  explicit?: RegionGeometry,
): string {
  const geometry = explicit ?? regionGeometry(world, window, params);
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
  /** Hard byte ceiling for cached RegionData. A 1024-width world's canon
   *  tile weighs ~25 MB — sixteen of those was 400 MB on the renderer's
   *  main thread, which is the classic silent "Render process gone". */
  private readonly cacheByteBudget: number;
  private cacheBytes = 0;
  /** Bumped when the reader moves to a new world (regenerate, load). Entries
   *  and idle sessions from older epochs are purged eagerly instead of
   *  waiting for count-based eviction to reach them. */
  private epoch = 0;
  private nextWorldId = 1;
  private nextGeographyId = 1;
  private nextRequestId = 1;
  private nextContextId = 1;

  constructor(cacheLimit = 6, sessionLimit = 2, cacheByteBudget = 144 * 1024 * 1024) {
    this.cacheLimit = Math.max(1, Math.floor(cacheLimit));
    this.sessionLimit = Math.max(1, Math.floor(sessionLimit));
    this.cacheByteBudget = Math.max(16 * 1024 * 1024, cacheByteBudget);
  }

  /**
   * The reader moved to another world. Everything cached or idling for the
   * previous one is dead weight from this moment — free it NOW, not when a
   * count-based eviction happens to reach it. Active sessions finish their
   * request and are reclaimed by the ordinary mismatch eviction.
   */
  newEpoch(): void {
    this.epoch++;
    for (const [key, entry] of this.cache) {
      if (entry.epoch !== this.epoch) {
        this.cacheBytes -= entry.bytes;
        this.cache.delete(key);
      }
    }
    for (const session of [...this.sessions]) {
      if (!session.activeRequestId) this.terminateSession(session);
    }
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
    const key = `${worldKey}:${geographyKey}:${cacheGeometryKey(world, window, params, options.geometry)}`
      + (options.edits ? `:e${hashString(options.edits)}` : '');
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
        this.notifyFree();
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

      this.acquireSessionWhenFree(factory, world, geography, requestId).then((acquired) => {
        if (settled) {
          acquired.activeRequestId = undefined;
          acquired.lastUsed = Date.now();
          this.notifyFree();
          return;
        }
        session = acquired;
        attach(acquired);
      }).catch((error: unknown) => fail(error));

      const attach = (live: WorkerSession) => {
      live.worker.onmessage = (event) => {
        const reply = event.data;
        if (reply.type === 'configured' || settled) return;
        if (reply.requestId !== requestId) return;
        if (reply.type === 'progress') {
          options.onProgress?.(reply.stage, reply.overall);
        } else if (reply.type === 'done') {
          finish(reply.region);
        } else if (reply.type === 'cancelled') {
          cancel();
        } else if (reply.type === 'error') {
          fail(new Error(reply.message));
        }
      };
      live.worker.onerror = (event) => {
        event.preventDefault();
        fail(new Error(event.message || 'Regional worker failed.'));
      };
      live.worker.onmessageerror = () => {
        fail(new Error('Regional worker returned an unreadable message.'));
      };
      try {
        live.worker.postMessage({
          type: 'generate',
          requestId,
          contextId: live.contextId,
          window,
          params,
          geometry: options.geometry,
          edits: options.edits,
        });
      } catch (error) {
        fail(error);
      }
      };
    });

    if (!settled) {
      abortListener = cancel;
      options.signal?.addEventListener('abort', abortListener, { once: true });
      this.active.set(requestId, { cancel });
    }
    return { requestId, promise, cancel };
  }

  /**
   * One carta display tile from a worker that already holds this world.
   *
   * Deliberately lean next to `request()`: no progress, no renderer-side
   * cache (the DisplayTileStore owns residency and eviction), same session
   * pool — a tile behind a 3-second canon build waits its turn, which is the
   * right order of importance for something a gesture repaints per frame
   * from whatever is already resident.
   */
  requestTile(
    world: WorldData,
    geography: HumanGeography,
    tile: { z: number; tx: number; ty: number },
    opts: {
      themeId: string;
      layers: Record<string, boolean>;
      density: number;
      reliefAmount: number;
      /** Serialized strokes, required for DEEP tiles over a pristine world. */
      edits?: string;
      workerFactory?: RegionWorkerFactory;
    },
  ): { promise: Promise<RenderedTile | null>; cancel: () => void } {
    const requestId = `tile-${this.nextRequestId++}`;
    let session: WorkerSession | null = null;
    let settled = false;
    let rejectPromise: (reason: unknown) => void = () => undefined;

    const cleanup = (terminate: boolean) => {
      this.active.delete(requestId);
      if (!session) return;
      if (terminate) {
        this.terminateSession(session);
      } else {
        session.worker.onmessage = null;
        session.worker.onerror = null;
        session.worker.onmessageerror = null;
        session.activeRequestId = undefined;
        session.lastUsed = Date.now();
        this.pruneSessions();
        this.notifyFree();
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

    const promise = new Promise<RenderedTile | null>((resolve, reject) => {
      rejectPromise = reject;
      const factory = opts.workerFactory === undefined ? defaultWorkerFactory : opts.workerFactory;
      if (!factory) {
        resolve(null);
        return;
      }
      this.acquireSessionWhenFree(factory, world, geography, requestId).then((acquired) => {
        if (settled) {
          acquired.activeRequestId = undefined;
          acquired.lastUsed = Date.now();
          this.notifyFree();
          return;
        }
        session = acquired;
        attach(acquired);
      }).catch(() => {
        if (!settled) { settled = true; resolve(null); }
      });

      const attach = (live: WorkerSession) => {
      live.worker.onmessage = (event) => {
        const reply = event.data;
        if (settled || reply.type === 'configured') return;
        if (reply.requestId !== requestId) return;
        if (reply.type === 'tile') {
          settled = true;
          cleanup(false);
          if (reply.bitmap) {
            resolve({ bitmap: reply.bitmap, places: reply.places });
          } else if (reply.rgba && reply.width && reply.height) {
            // Forge tiles cross a process boundary as raw pixels; the bitmap
            // is rebuilt here, off the worker's clock.
            const img = new ImageData(
              new Uint8ClampedArray(reply.rgba), reply.width, reply.height);
            createImageBitmap(img).then(
              (bitmap) => resolve({ bitmap, places: reply.places }),
              () => resolve(null),
            );
          } else {
            resolve(null);
          }
        } else if (reply.type === 'error' || reply.type === 'cancelled') {
          settled = true;
          cleanup(reply.type === 'error');
          resolve(null);
        }
      };
      live.worker.onerror = (event) => {
        event.preventDefault();
        if (settled) return;
        settled = true;
        cleanup(true);
        resolve(null);
      };
      live.worker.onmessageerror = () => {
        if (settled) return;
        settled = true;
        cleanup(true);
        resolve(null);
      };
      try {
        live.worker.postMessage({
          type: 'renderTile',
          requestId,
          contextId: live.contextId,
          z: tile.z,
          tx: tile.tx,
          ty: tile.ty,
          themeId: opts.themeId,
          layers: opts.layers,
          density: opts.density,
          reliefAmount: opts.reliefAmount,
          edits: opts.edits,
        });
      } catch {
        if (!settled) {
          settled = true;
          cleanup(true);
          resolve(null);
        }
      }
      };
    });
    if (!settled) this.active.set(requestId, { cancel });
    return { promise, cancel };
  }

  clear(world?: WorldData): void {
    if (!world) {
      this.cache.clear();
      this.cacheBytes = 0;
      for (const request of [...this.active.values()]) request.cancel();
      for (const session of [...this.sessions]) this.terminateSession(session);
      return;
    }
    for (const [key, entry] of this.cache) {
      if (entry.world === world) {
        this.cacheBytes -= entry.bytes;
        this.cache.delete(key);
      }
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
    this.cacheBytes = 0;
  }

  get cacheByteSize(): number {
    return this.cacheBytes;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  get workerSessionCount(): number {
    return this.sessions.size;
  }

  /** Callers parked until a session slot frees. FIFO: the composite's centre
   *  tile queued first stays first. */
  private waiters: Array<() => void> = [];

  private notifyFree(): void {
    this.waiters.shift()?.();
  }

  /**
   * A session, WITHIN THE CAP, or a promise that waits for one.
   *
   * The old acquire spawned whenever nothing idle matched — one worker per
   * concurrent request, each configured with its own ~80 MB structured clone
   * of the world. The canonical composite and the display tiles ask in
   * BURSTS, so a regeneration followed by a zoom could stack dozens of
   * workers and take the renderer process down with it. Now: reuse an idle
   * match, spawn only under the cap, evict an idle non-match at the cap, and
   * otherwise WAIT — memory stays bounded no matter how eager the callers.
   */
  private async acquireSessionWhenFree(
    factory: RegionWorkerFactory,
    world: WorldData,
    geography: HumanGeography,
    requestId: string,
  ): Promise<WorkerSession> {
    for (;;) {
      const revision = world.revision ?? 0;
      let busyMatch = false;
      for (const candidate of this.sessions) {
        const matches = candidate.factory === factory
          && candidate.world === world
          && candidate.geography === geography
          && candidate.revision === revision;
        if (!matches) continue;
        if (candidate.activeRequestId) {
          busyMatch = true;
          continue;
        }
        candidate.activeRequestId = requestId;
        candidate.lastUsed = Date.now();
        return candidate;
      }
      if (busyMatch) {
        // A session for THIS world exists and is working. Wait for it rather
        // than cloning another ~80 MB world into a second worker — a tile
        // burst used to do exactly that, and the duplicate then re-generated
        // the same canon ground its twin already held.
        await new Promise<void>((resolveWait) => this.waiters.push(resolveWait));
        continue;
      }
      if (this.sessions.size < this.sessionLimit) {
        return this.spawnSession(factory, world, geography, requestId);
      }
      let idle: WorkerSession | null = null;
      for (const candidate of this.sessions) {
        if (candidate.activeRequestId) continue;
        if (!idle || candidate.lastUsed < idle.lastUsed) idle = candidate;
      }
      if (idle) {
        this.terminateSession(idle);
        continue;
      }
      await new Promise<void>((resolveWait) => this.waiters.push(resolveWait));
    }
  }

  private spawnSession(
    factory: RegionWorkerFactory,
    world: WorldData,
    geography: HumanGeography,
    requestId: string,
  ): WorkerSession {
    const worker = factory();
    const session: WorkerSession = {
      contextId: `region-context-${this.nextContextId++}`,
      worker,
      factory,
      world,
      geography,
      revision: world.revision ?? 0,
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
    this.notifyFree();
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
    const prior = this.cache.get(key);
    if (prior) {
      this.cacheBytes -= prior.bytes;
      this.cache.delete(key);
    }
    const bytes = regionBytes(region);
    this.cache.set(key, { world, region, bytes, epoch: this.epoch });
    this.cacheBytes += bytes;
    // Evict by COUNT and by BYTES: sixteen entries of a small world are fine,
    // sixteen canon tiles of a 1024-width world are a renderer funeral.
    while (this.cache.size > this.cacheLimit || this.cacheBytes > this.cacheByteBudget) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      const entry = this.cache.get(oldest);
      if (entry) this.cacheBytes -= entry.bytes;
      this.cache.delete(oldest);
      if (this.cache.size <= 1) break; // never evict the entry just stored
    }
  }
}

// 16 entries: a 3x3 canon ring plus history must fit without evicting
// mid-compose. 256 MB of bytes: enough to keep a whole 1024-width canon
// neighbourhood warm on a workstation, an order of magnitude below where
// the renderer started dying — the electron main process also raises the
// V8 ceiling for real headroom.
//
// Session count is where the Forge changes the game: a web-worker session is
// an 80 MB clone INSIDE the renderer (two was already brave); a Forge session
// is its own OS process, so four of them generating canon ground in parallel
// cost this window nothing but ports.
export const regionClient = new RegionWorkerClient(
  16,
  forgeAvailable() ? 4 : 2,
  256 * 1024 * 1024,
);

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
