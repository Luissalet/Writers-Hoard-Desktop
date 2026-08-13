import { scaleBytes, scaleCount, workerSlots } from '@/utils/capacity';
import type { HumanGeography } from '../core/settlements';
import { deepTileSpec, deepTileSupported, type TilePlace } from './deepTile';
import { satelliteDeepSupported, satelliteTileSpec } from './satelliteTile';
import { canonWindowCover } from './composeWindow';
import { canonTileKey } from './generate';
import { canonParams, tileGeometry, tileWindow, type TileId } from './tiles';
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
  hashEditsString,
  packRegionGeography,
  type RegionWorkerReply,
  type RegionWorkerRequest,
} from './workerProtocol';

/**
 * The renderer's canon storage, injected rather than imported: this module is
 * reachable from benches and from `core`-adjacent code that must never pull
 * the database in (see `snapshots.ts`'s header for the rule). The app
 * registers `canonSnapshots.ts` here once at engine load; nothing registered
 * means canon stays session-local, exactly the pre-persistence behaviour.
 */
export interface CanonPersistence {
  /** Stored bytes for one supertile under the CURRENT edit list, or null. */
  load(world: WorldData, canonKey: string, editsJson: string): Promise<ArrayBuffer | null>;
  /** Persist one freshly generated supertile, built at `editsJson`. */
  save(world: WorldData, canonKey: string, editsJson: string, bytes: ArrayBuffer): void;
}

let canonPersistence: CanonPersistence | null = null;

export function setCanonPersistence(persistence: CanonPersistence | null): void {
  canonPersistence = persistence;
}

/**
 * DEBUG (temporal, Luis 2026-08-12): contadores de sesión de la vía de
 * teselas, para que los HUD del 2D y del 3D puedan decir POR QUÉ el suelo
 * está borroso — «pedida y declinada», «entregada», «sembrada del almacén» y
 * «error» se ven idénticas desde fuera y son cuatro historias distintas.
 */
/** TRAZA COMPLETA en consola (temporal, lo pidió Luis el 2026-08-12): cada
 *  petición cuenta su vida entera — nace, sesión, siembra (con el porqué de
 *  cada acierto o fallo), post, respuesta, caducidad. Apagar aquí. */
export const DEBUG_TRACE = true;
const TRACE_T0 = Date.now();
export function traceTiles(...args: unknown[]): void {
  if (!DEBUG_TRACE) return;
  console.log(`[teselas +${((Date.now() - TRACE_T0) / 1000).toFixed(1)}s]`, ...args);
}

export const tileStats = {
  asked: 0,
  delivered: 0,
  declined: 0,
  errors: 0,
  timeouts: 0,
  canonBuilt: 0,
  seeded: 0,
  seedErrors: 0,
  /** Entregadas cuyo mapa de bits no pudo fabricarse en el lado del lector
   *  (vía rgba de la Forja). Si esto sube, el HUD y la traza dicen por qué. */
  fabErrors: 0,
};

/** Cuándo se posteó cada petición viva, para que el HUD pueda decir la EDAD
 *  de la más vieja — un «EN VUELO 1» de 40 s es una generación; de 5 min es
 *  una sesión muerta que el vigilante está a punto de retirar. */
const inFlightSince = new Map<string, number>();

export function oldestInFlightMs(): number {
  let oldest = 0;
  const now = Date.now();
  for (const t of inFlightSince.values()) oldest = Math.max(oldest, now - t);
  return oldest;
}

/**
 * EL VIGILANTE DE PETICIONES (el agujero que la captura de Luis retrató el
 * 2026-08-12: EN VUELO 1 eterno, entregadas 0/35, forja «sí»). El puente de
 * la Forja sólo vigila la PRIMERA respuesta de cada proceso: un hijo que
 * muere DESPUÉS de haber contestado algo deja su petición en vuelo para
 * siempre, la sesión «ocupada» eternamente, y el pool encolado detrás de un
 * muerto sin que nada lo declare. Cada petición lleva ahora su propio plazo;
 * al vencer, la sesión se TERMINA (el pool abre una fresca al siguiente uso)
 * y la petición se resuelve como fallo re-pedible. El plazo de una tesela es
 * total (no emite progreso); el de una sábana se rearma con cada `progress`,
 * porque su silencio legítimo es corto aunque su total sea largo.
 */
export const requestDeadlines = {
  /** Total de una tesela (no emite progreso). */
  tileMs: 120_000,
  /** Inactividad de una sábana (cada `progress` rearma). */
  generateIdleMs: 180_000,
};

export interface RegionWorkerLike {
  onmessage: ((event: MessageEvent<RegionWorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: RegionWorkerRequest): void;
  terminate(): void;
}

export type RegionWorkerFactory = () => RegionWorkerLike;

/** A display tile from the worker: pixels plus, for DEEP tiles, the named
 *  places on its ground — the main thread letters those live. Lienzo cuando
 *  los píxeles vienen crudos de la Forja (ver la fabricación en requestTile);
 *  todos los consumidores componen con drawImage, que acepta ambos. */
export interface RenderedTile {
  bitmap: ImageBitmap | OffscreenCanvas | HTMLCanvasElement;
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
  /** Canon-lattice identity (`c:tx:ty`) when this sheet IS a supertile — the
   *  composite path sets it so the request can seed from storage, answer from
   *  worker residency, and ship fresh builds back for persistence. */
  canonKey?: string;
  /** Política de sembrado explícita para hojas que no pueden mandar `edits`
   *  (viajan con el mundo editado). Ver RegionBuildOptions.sitesPolicy. */
  sitesPolicy?: import('../core/edits').SitesPolicy;
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
  /** Canon supertile keys this session has been seeded with (or has built) —
   *  the "don't ask Dexie twice" ledger. Entries are struck when a
   *  `consumeOnly` decline proves the worker evicted them. */
  seeded: Set<string>;
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
    + `:${params.detail}:${params.settled}:${params.habitation}:${params.streamDensity}`
    + `:${params.sites ?? 'everywhere'}`;
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
  /** Bancos: fuerza (true/false) el multi-sesión por mundo; null = decide la
   *  Forja (procesos propios sí, web workers dentro del renderer no). */
  parallelWorldSessions: boolean | null = null;
  /** Superteselas ya calentadas (clave canon + hash de ediciones), para que
   *  cada gesto no relance el mismo calentamiento. Se vacía por época. */
  private warmed = new Set<string>();
  /** Calentamientos VIVOS, con su mando de cancelar: cuando el plan cambia,
   *  los obsoletos se retiran — cuarenta warms de un paseo encolados delante
   *  de las teselas de la pantalla eran siete minutos de cola (la captura de
   *  Luis del «0/50 clavado», 2026-08-12). Un warm encolado se cancela
   *  gratis; uno ya en sesión, en el peor caso, cuesta esa sesión — minutos
   *  de cola contra segundos de reconfigurar, y gana retirarlo. */
  private warming = new Map<string, () => void>();
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
    this.warmed.clear();
    for (const cancelWarm of this.warming.values()) cancelWarm();
    this.warming.clear();
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
    let idleTimer = 0;
    let rejectPromise: (reason: unknown) => void = () => undefined;
    let abortListener: (() => void) | null = null;

    const cleanup = (terminateSession: boolean) => {
      if (abortListener) options.signal?.removeEventListener('abort', abortListener);
      abortListener = null;
      this.active.delete(requestId);
      inFlightSince.delete(requestId);
      // OJO: aquí `window` es la ventana REGIONAL (el parámetro); los relojes
      // van por los globales pelados.
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; }
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
      /** El vigilante de INACTIVIDAD: una sábana legítima tarda minutos pero
       *  habla (progress); un worker muerto calla. Cada señal lo rearma. */
      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (settled) return;
          tileStats.timeouts++;
          traceTiles(requestId, 'CADUCADA (sábana muda; sesión retirada)');
          fail(new Error('El worker regional dejó de responder; sesión retirada.'));
        }, requestDeadlines.generateIdleMs) as unknown as number;
      };
      live.worker.onmessage = (event) => {
        const reply = event.data;
        // Una sábana que habla también es el pool trabajando: pulso para las
        // teselas en cola (ver `pulseQueue`).
        if (reply.type === 'progress' || reply.type === 'canonBuilt') { armIdle(); this.pulseQueue(); }
        // A composite sheet that generated fresh canon ships it for storage
        // ahead of `done` — same contract as the display tiles, same guard:
        // ground the reader has painted past since the request is refused.
        if (reply.type === 'canonBuilt') {
          if (reply.requestId !== requestId) return;
          const persistence = canonPersistence;
          if (persistence && reply.editsHash === hashEditsString(options.edits ?? '')) {
            live.seeded.add(reply.key);
            persistence.save(world, reply.key, options.edits ?? '', reply.bytes);
          }
          return;
        }
        if (reply.type === 'configured' || settled) return;
        if (reply.requestId !== requestId) return;
        if (reply.type === 'progress') {
          options.onProgress?.(reply.stage, reply.overall);
        } else if (reply.type === 'done') {
          traceTiles(requestId, '✓ sábana lista');
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
      const post = () => {
        if (settled) return;
        try {
          inFlightSince.set(requestId, Date.now());
          traceTiles(requestId, options.canonKey
            ? `sábana canónica ${options.canonKey} → worker`
            : '→ worker (sábana libre)');
          armIdle();
          live.worker.postMessage({
            type: 'generate',
            requestId,
            contextId: live.contextId,
            window,
            params,
            geometry: options.geometry,
            edits: options.edits,
            sitesPolicy: options.sitesPolicy,
            canonKey: options.canonKey,
          });
        } catch (error) {
          fail(error);
        }
      };
      // A canonical sheet checks storage first: seed the worker and it answers
      // from residency instead of regenerating — the composite path was the
      // one canon consumer the persistence didn't reach.
      if (options.canonKey && canonPersistence && !live.seeded.has(options.canonKey)) {
        const k = options.canonKey;
        canonPersistence.load(world, k, options.edits ?? '')
          .then((bytes) => {
            live.seeded.add(k);
            if (bytes && !settled) {
              try {
                live.worker.postMessage({
                  type: 'seedCanon',
                  contextId: live.contextId,
                  tiles: [{ key: k, bytes }],
                });
              } catch { /* generate as before */ }
            }
          })
          .catch(() => undefined)
          .finally(post);
      } else {
        post();
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
  /**
   * Read the canon under one world point, from what is already resident.
   *
   * Never generates: the reply is null when this session has not built the
   * canon tile there yet. That is what makes it safe to call from a hover.
   */
  requestProbe(
    world: WorldData,
    geography: HumanGeography,
    wx: number,
    wy: number,
    opts: { workerFactory?: RegionWorkerFactory } = {},
  ): Promise<import('./workerProtocol').RegionProbe | null> {
    const requestId = `probe-${this.nextRequestId++}`;
    const factory = opts.workerFactory === undefined ? defaultWorkerFactory : opts.workerFactory;
    if (!factory) return Promise.resolve(null);
    // Reuse a session that is ALREADY configured for this world and idle. A
    // probe must never queue behind a tile, never spin one up, and never make
    // the reader wait: if there is nothing free, there is no answer.
    let session: WorkerSession | null = null;
    for (const candidate of this.sessions) {
      if (candidate.world === world && candidate.geography === geography
        && !candidate.activeRequestId) {
        session = candidate;
        break;
      }
    }
    if (!session) return Promise.resolve(null);
    const live = session;
    /**
     * RESERVE THE SESSION. This used to borrow it without marking it busy.
     *
     * The sequence that wedged the whole pyramid: the probe swapped
     * `worker.onmessage` for its own and left `activeRequestId` unset, so the
     * session still looked idle; the very next frame's `want()` acquired it for
     * a tile and overwrote `onmessage` with the tile's handler; the probe's
     * reply was then dropped, its 400 ms timer fired, and its cleanup restored
     * `prev` — which was `null` — DESTROYING the tile's handler. That tile
     * promise never settled, so the store kept it in `inflight` for ever and the
     * session's `activeRequestId` was never cleared. After `sessionLimit` such
     * collisions every acquire waited on a notification that could not come and
     * the map stopped loading tiles entirely, for the rest of the session.
     *
     * A probe is a few milliseconds of reading resident memory. Holding the
     * session for its duration costs nothing and makes the race impossible.
     */
    live.activeRequestId = requestId;
    return new Promise((resolve) => {
      const prev = live.worker.onmessage;
      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // Only take back what is still ours: if something else has since
        // installed a handler, restoring `prev` would destroy it.
        if (live.worker.onmessage === mine) live.worker.onmessage = prev;
        if (live.activeRequestId === requestId) {
          live.activeRequestId = undefined;
          // AND WAKE THE QUEUE. Reserving the session without this was a second
          // way to strand the pyramid: `acquireSessionWhenFree` parks on a busy
          // match before it will spawn a second session, so a tile requested
          // during a 400 ms probe waited in `waiters` for a notification that
          // only some OTHER request could send. On a settled view there is no
          // other request, and `DisplayTileStore` leaves the id in `inflight`
          // for the whole generation — that square of map never comes back.
          this.notifyFree();
        }
      };
      const timer = setTimeout(() => { cleanup(); resolve(null); }, 400);
      const mine = (event: MessageEvent) => {
        const reply = event.data as RegionWorkerReply;
        if (reply && reply.type === 'probed' && reply.requestId === requestId) {
          cleanup();
          resolve(reply.probe);
          return;
        }
        if (prev) (prev as (e: MessageEvent) => void)(event);
      };
      live.worker.onmessage = mine;
      live.worker.postMessage({
        type: 'probe', requestId, contextId: live.contextId, wx, wy,
      });
    });
  }

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
      /** Paper or ground. Absent = paper, so old callers are unchanged. */
      ink?: 'carta' | 'satellite';
      /** Sólo entintar si el canon ya es residente; ver workerProtocol. */
      consumeOnly?: boolean;
      workerFactory?: RegionWorkerFactory;
    },
  ): { promise: Promise<RenderedTile | null>; cancel: () => void } {
    const requestId = `tile-${this.nextRequestId++}`;
    let session: WorkerSession | null = null;
    let settled = false;
    let watchdog = 0;
    /** Cancelled AFTER a worker had already started drawing: the caller is
     *  gone, but the reply still has to be collected. */
    let abandoned = false;
    let rejectPromise: (reason: unknown) => void = () => undefined;
    /** El rearme del plazo, visible fuera del ejecutor para que `cleanup`
     *  pueda darlo de baja del pulso de la cola. */
    let armDeadlineRef: () => void = () => undefined;

    const cleanup = (terminate: boolean) => {
      this.active.delete(requestId);
      inFlightSince.delete(requestId);
      this.queuePulse.delete(armDeadlineRef);
      if (watchdog) { clearTimeout(watchdog); watchdog = 0; }
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
    /**
     * Give up on this tile.
     *
     * The display store cancels on every pan now — a one-second gesture crosses
     * ~30 tiles — so what this costs matters as much as what it saves.
     *
     * NOT DISPATCHED YET is where the saving is: the request simply leaves the
     * queue (`acquireSessionWhenFree` drops it at its next wake) and never
     * becomes work at all. That is the ordinary case; the pool only ever has
     * `sessionLimit` tiles actually in a worker.
     *
     * ALREADY IN A WORKER cannot be stopped: the worker's handler is
     * synchronous, so the tile it is drawing runs to completion whatever we
     * post — the cancel set is only read BEFORE a render begins. Terminating is
     * the only real interruption, and it throws away the session's configured
     * world and its canon supertile cache: seconds of CPU and tens of MB that
     * the very next tile at this zoom needs. Paying that once per gesture would
     * make the deep levels slower, which is the opposite of the point. So the
     * request is ABANDONED instead — the caller's promise settles now, and the
     * reply is still collected below, which releases the session and closes the
     * pixels nobody will draw.
     */
    const cancel = () => {
      if (settled || abandoned) return;
      if (session) {
        abandoned = true;
        this.active.delete(requestId);
        rejectPromise(abortError());
        return;
      }
      settled = true;
      cleanup(true);
      rejectPromise(abortError());
    };

    const promise = new Promise<RenderedTile | null>((resolve, reject) => {
      rejectPromise = reject;
      const factory = opts.workerFactory === undefined ? defaultWorkerFactory : opts.workerFactory;
      if (!factory) {
        resolve(null);
        return;
      }
      // El plazo nace CON la petición, no con el post: una cadena que se
      // cuelga ANTES de postear (adquisición, siembra) dejaba el marcador del
      // almacén de pantalla huérfano para siempre y el mapa no re-pedía — la
      // 4.ª captura de Luis (pedidas quietas, EN VUELO 0, 0/54 eterno). El
      // post lo rearma para el tramo de trabajo.
      inFlightSince.set(requestId, Date.now());
      const born = Date.now();
      traceTiles(requestId, `nace z${tile.z}(${tile.tx},${tile.ty})`,
        opts.ink ?? 'carta', opts.consumeOnly ? 'consume' : '');
      /** El plazo mide SILENCIO: nace con la petición, se rearma en el post y
       *  con cada `progress` de la fragua (una señal por supertesela). */
      const armDeadline = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          if (settled) return;
          tileStats.timeouts++;
          settled = true;
          traceTiles(requestId, `CADUCADA a los ${((Date.now() - born) / 1000).toFixed(1)}s (sesión retirada)`);
          cleanup(true);
          resolve(null);
        }, requestDeadlines.tileMs) as unknown as number;
      };
      armDeadlineRef = armDeadline;
      armDeadline();
      // EL PULSO DE LA COLA: mientras el pool entregue, ninguna tesela en
      // espera debe caducar. `notifyFree` despierta a UN parado (FIFO), así
      // que el del fondo de una cola larga no oye nada en minutos — 163 de
      // las teselas del banco de retención caducaban EN LA COLA detrás de dos
      // sesiones que fraguaban canon legítimamente (contenedor lento), y el
      // plan entero renacía en tromba. Registrar el rearme en `queuePulse`
      // deja el plazo midiendo lo único que debe matar: el SILENCIO del pool
      // entero, no la longitud de la cola.
      this.queuePulse.add(armDeadline);
      this.acquireSessionWhenFree(factory, world, geography, requestId, () => settled).then((acquired) => {
        traceTiles(requestId, `sesión ${acquired.contextId} (cola ${Date.now() - born} ms)`);
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
      /** The supertile keys under THIS tile, kept for the decline bookkeeping. */
      let coverKeys: string[] | null = null;
      live.worker.onmessage = (event) => {
        const reply = event.data;
        // Fresh canon rides ahead of the tile that grew it, and it is worth
        // storing even when the reader has already panned away (abandoned):
        // the 31 s were paid either way. The edits-hash guard refuses ground
        // the reader has painted past since the request went out.
        if (reply.type === 'canonBuilt') {
          if (reply.requestId !== requestId) return;
          tileStats.canonBuilt++;
          const persistence = canonPersistence;
          const fresh = reply.editsHash === hashEditsString(opts.edits ?? '');
          traceTiles(requestId, `canon nuevo ${reply.key}`,
            `${(reply.bytes.byteLength / 1e6).toFixed(1)}MB`,
            persistence ? (fresh ? '→ almacén' : 'DESCARTADO (ediciones cambiaron)') : 'sin almacén');
          if (persistence && fresh) {
            live.seeded.add(reply.key);
            persistence.save(world, reply.key, opts.edits ?? '', reply.bytes);
          }
          return;
        }
        if (settled || reply.type === 'configured') return;
        if (reply.requestId !== requestId) return;
        if (reply.type === 'progress') {
          // La fragua canta una vez por supertesela (workerCore): cada señal
          // rearma el plazo, que así mide SILENCIO y no duración total — una
          // tesela cuyo suelo cueste tres minutos ya no caduca a los 120 s
          // retirando la sesión a media generación (la espiral del banco de
          // retención: 163 caducadas y un plan 0/60 eterno).
          armDeadline();
          // Y el pulso para TODA la cola: esta fragua demuestra que el pool
          // trabaja, también para los que esperan sesión.
          this.pulseQueue();
          traceTiles(requestId, `fragua canon ${(reply.overall * 100).toFixed(0)}%`);
          return;
        }
        if (reply.type === 'tile') {
          if (reply.declined) tileStats.declined++;
          else tileStats.delivered++;
          traceTiles(requestId, reply.declined ? 'DECLINADA (canon frío)' : '✓ entregada',
            `${((Date.now() - born) / 1000).toFixed(1)}s`);
          // A `consumeOnly` decline for ground the ledger says was seeded
          // means the worker has since evicted it: strike those entries so
          // the NEXT request re-seeds from storage instead of trusting a
          // ledger that lies.
          if (reply.declined && coverKeys) {
            for (const k of coverKeys) live.seeded.delete(k);
          }
          // El bus de desalojos de la vía que GENERA: la misma tachadura que
          // la declinación consumeOnly, pero contada por el worker — sin ella
          // el libro daba por sembrado lo desalojado y el suelo se regeneraba
          // en silencio en vez de re-sembrarse de Dexie.
          if (reply.evictedCanon) {
            for (const k of reply.evictedCanon) live.seeded.delete(k);
          }
          settled = true;
          cleanup(false);
          if (abandoned) {
            // The reader panned off this ground while the worker was drawing
            // it. The session goes back to the pool intact — that is the whole
            // reason the cancel was gentle — but the pixels must not: an
            // ImageBitmap outlives the promise that carried it, so a gesture
            // that abandoned thirty tiles would strand thirty of them.
            reply.bitmap?.close();
            return;
          }
          if (reply.declined) {
            // La declinación es una respuesta SANA del contrato consumeOnly
            // (el 3D pide, el canon no está, el worker contesta en µs) — no
            // una fabricación fallida. Contarla como FÁBRICA-ERR mandó a Luis
            // a la consola a buscar un error que no existía: su HUD del
            // 2026-08-12 decía «declinadas 475 · FÁBRICA-ERR 475» y las 475
            // eran el 3D consumiendo suelo frío, tal y como está decidido.
            resolve(null);
          } else if (reply.bitmap) {
            resolve({ bitmap: reply.bitmap, places: reply.places });
          } else if (reply.rgba && reply.width && reply.height) {
            // Los píxeles de la Forja cruzan la frontera de proceso crudos y
            // el mapa de bits se reconstruye aquí — EN LIENZO, no con
            // `createImageBitmap`. En la máquina de Luis (2026-08-12) esa
            // llamada RECHAZABA en silencio para cada tesela: el cliente
            // cantaba «✓ entregada», la promesa se resolvía null y el plan se
            // quedaba en 0/28 con el suelo borroso para siempre. Su log lo
            // retrató sin ambigüedad: tile-821 entregada a los 0.1 s y el
            // MISMO suelo re-nace 100 ms después como tile-850 mientras sus
            // 27 hermanas seguían en vuelo — sólo un resolve(null) deja esa
            // huella (un descarte por época las habría renacido a las 28, y
            // una excepción habría dejado el marcador clavado sin re-pedido).
            // putImageData es síncrono y no tiene rama de rechazo; todos los
            // consumidores componen con drawImage, que acepta lienzos.
            try {
              const img = new ImageData(
                new Uint8ClampedArray(reply.rgba), reply.width, reply.height);
              const canvas = typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(reply.width, reply.height)
                : Object.assign(document.createElement('canvas'),
                  { width: reply.width, height: reply.height });
              const c2d = (canvas as OffscreenCanvas).getContext('2d');
              if (!c2d) throw new Error('sin contexto 2d para la tesela');
              c2d.putImageData(img, 0, 0);
              resolve({ bitmap: canvas, places: reply.places });
            } catch (error) {
              // Que el fallo CANTE. El resolve(null) mudo que había aquí
              // costó tres capturas y un volcado de consola encontrar.
              tileStats.fabErrors++;
              traceTiles(requestId, 'FABRICACIÓN falló:',
                error instanceof Error ? error.message : String(error),
                `rgba ${reply.rgba.byteLength} bytes,`,
                `esperados ${reply.width * reply.height * 4}`);
              resolve(null);
            }
          } else {
            tileStats.fabErrors++;
            traceTiles(requestId, 'SIN PÍXELES en la respuesta (ni bitmap ni rgba/width/height)');
            resolve(null);
          }
        } else if (reply.type === 'error' || reply.type === 'cancelled') {
          if (reply.type === 'error') {
            tileStats.errors++;
            traceTiles(requestId, 'ERROR del worker:', reply.message);
          }
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
      const post = () => {
        try {
          tileStats.asked++;
          traceTiles(requestId, '→ worker');
          // Rearme para el tramo de trabajo: la sesión que no conteste se
          // retira, y la siguiente petición abre una fresca.
          armDeadline();
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
            ink: opts.ink,
            consumeOnly: opts.consumeOnly,
          });
        } catch {
          if (!settled) {
            settled = true;
            cleanup(true);
            resolve(null);
          }
        }
      };
      // Seed the worker's canon from storage BEFORE the tile request: the
      // worker processes messages in arrival order, so by the time the render
      // runs the ground is resident — a ~300 ms decode standing in for the
      // ~31.900 ms generation it replaces (PENDIENTE §2b.1). The seed never
      // blocks the pixels: any failure just falls through to the old path.
      this.seedCanonFor(live, world, tile, opts).then((keys) => {
        coverKeys = keys;
        if (settled) return;
        if (abandoned) {
          // Cancelled while seeding, before any work was posted: the worker
          // owes no reply, so release the session here or it leaks. The seed
          // itself stays — the next tile at this zoom is glad of it.
          settled = true;
          cleanup(false);
          return;
        }
        post();
      }).catch(() => {
        // La siembra JAMÁS puede costar la tesela: aunque su cadena reviente,
        // el post sale y el peor caso es regenerar como toda la vida.
        tileStats.seedErrors++;
        if (!settled && !abandoned) post();
      });
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
      // Settle the caller's promise, THEN take the session down — a region
      // build's cancel already did (hence the membership check), but a TILE's
      // is deliberately gentle: it abandons the reply and keeps the session so
      // a pan does not throw away the canon cache. That is exactly the wrong
      // trade when the world itself is the thing going away.
      if (session.activeRequestId) this.active.get(session.activeRequestId)?.cancel();
      if (this.sessions.has(session)) this.terminateSession(session);
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

  /** Rearmes de plazo de las teselas VIVAS (en cola o en vuelo): cada vez que
   *  el pool suelta una sesión, todas reciben un pulso. Ver el comentario del
   *  registro en `requestTile` — el plazo mata silencios, no colas largas. */
  private queuePulse = new Set<() => void>();

  private notifyFree(): void {
    this.waiters.shift()?.();
    this.pulseQueue();
  }

  /** El pool está VIVO: que ninguna petición en espera caduque. Lo dispara
   *  cada sesión que se libera Y cada `progress` de una fragua — en suelo
   *  frío la primera supertesela tarda minutos sin soltar sesión alguna, y
   *  sin este segundo disparador la cola entera caducaba en silencio detrás
   *  de un worker perfectamente sano (159 caducadas en el banco). */
  pulseQueue(): void {
    for (const pulse of this.queuePulse) pulse();
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
    /** True once the caller has given up. Checked after every wait, because
     *  this queue is where a cancelled display tile actually lives: handing it
     *  a session anyway — or, worse, SPAWNING one and cloning the world into it
     *  — only to release it again is the entire cost the cancel exists to
     *  avoid. Absent for callers that never cancel mid-queue. */
    abandoned?: () => boolean,
  ): Promise<WorkerSession> {
    /** Pass the wake-up on. `notifyFree` resolves exactly ONE waiter, so a
     *  request that leaves the queue after being woken must hand its turn to
     *  the next in line or the rest of the queue parks behind a ghost. */
    const leave = (): never => {
      this.notifyFree();
      throw abortError();
    };
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
        /**
         * Una sesión de este mundo existe y está trabajando. ANTES se esperaba
         * SIEMPRE («no clonar otro mundo de 80 MB a un segundo worker»), y eso
         * convirtió el primer paseo por suelo nuevo en una fila india: una
         * supertesela cada 30-60 s con quince cores mirando (la captura de
         * Luis del 2026-08-12: EN VUELO 1, entregadas 0/35). Con la FORJA cada
         * sesión es su propio proceso — el clon no le cuesta memoria al
         * renderer — y el peligro de «dos gemelas generando el mismo canon»
         * lo desactiva la persistencia: el calentador reparte UNA petición
         * por supertesela y las demás sesiones se siembran de Dexie. Así que
         * bajo Forja sana se abre otra sesión mientras quepa; con web workers
         * (el mundo vive DENTRO del renderer) se espera como siempre.
         */
        const parallel = this.parallelWorldSessions
          ?? (forgeAvailable() && !forgeDegraded());
        if (parallel && this.sessions.size < this.sessionLimit) {
          return this.spawnSession(factory, world, geography, requestId);
        }
        await new Promise<void>((resolveWait) => this.waiters.push(resolveWait));
        if (abandoned?.()) leave();
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
      if (abandoned?.()) leave();
    }
  }

  /**
   * Load any stored canon under a DEEP tile and post it to the session ahead
   * of the render. Returns the tile's supertile keys (for the decline
   * bookkeeping) or null when the tile is shallow / persistence is absent.
   * Never rejects: a storage error is a cache miss, not a broken tile.
   */
  private async seedCanonFor(
    session: WorkerSession,
    world: WorldData,
    tile: { z: number; tx: number; ty: number },
    opts: { edits?: string; ink?: 'carta' | 'satellite' },
  ): Promise<string[] | null> {
    const persistence = canonPersistence;
    if (!persistence) return null;
    // TODO el cuerpo bajo try: esta función corre POR DELANTE del post de la
    // tesela, y un lanzamiento síncrono suyo (una spec rara, una cubierta que
    // no cuadra) rechazaba la cadena entera — el post nunca corría, el
    // vigilante (que se armaba EN el post) nunca vigilaba, y el marcador del
    // almacén de pantalla quedaba huérfano para siempre: pedidas quietas,
    // EN VUELO 0, y 0/54 clavado (la 4.ª captura de Luis, 2026-08-12). La
    // siembra es una optimización; jamás puede costar la tesela.
    try {
      const satellite = opts.ink === 'satellite';
      const deep = satellite
        ? satelliteDeepSupported(world, tile.z)
        : deepTileSupported(world, tile.z);
      if (!deep) return null;
      const spec = (satellite ? satelliteTileSpec : deepTileSpec)(world, tile);
      const keys = canonWindowCover(world, spec).map(canonTileKey);
      const missing = keys.filter((k) => !session.seeded.has(k));
      if (!missing.length) return keys;
      const t0 = Date.now();
      const loaded = await Promise.all(missing.map(async (k) => ({
        key: k,
        bytes: await persistence.load(world, k, opts.edits ?? '').catch(() => null),
      })));
      traceTiles('siembra', missing.map((k, i) => `${k} ${loaded[i].bytes
        ? `HIT ${(loaded[i].bytes!.byteLength / 1e6).toFixed(1)}MB` : 'miss'}`).join(' · '),
      `${Date.now() - t0} ms`);
      // Mark the whole batch attempted — hit or miss — so a burst of thirty
      // tiles over the same ground asks Dexie once per supertile, not once
      // per tile. Misses re-enter through `canonBuilt` when the worker
      // generates them, or through the decline strike-out if it evicts.
      for (const k of missing) session.seeded.add(k);
      const tiles = loaded.filter((t): t is { key: string; bytes: ArrayBuffer } => !!t.bytes);
      if (tiles.length) {
        tileStats.seeded += tiles.length;
        // No transfer list: a copy keeps the payload compatible with the
        // Forge bridge, and seeding is rare enough that copying ~2 MB beats
        // owning a second postMessage signature.
        session.worker.postMessage({
          type: 'seedCanon',
          contextId: session.contextId,
          tiles,
        });
      }
      return keys;
    } catch (err) {
      tileStats.seedErrors++;
      if (tileStats.seedErrors === 1) {
        // Una vez por sesión: la causa exacta, para la próxima captura.
        console.warn('[worldgen] la siembra del canon falló (la tesela sigue su camino)', err);
      }
      return null;
    }
  }

  /**
   * EL CALENTADOR: una petición `generate` por supertesela del plan, para que
   * el primer paseo por suelo nuevo use TODOS los procesos de la Forja en vez
   * de una fila india (la captura de Luis, 2026-08-12: EN VUELO 1 con quince
   * cores parados). Cada warm genera UNA supertesela en su propia sesión, la
   * emite a Dexie (`canonBuilt`) y la deja residente; las teselas de pantalla
   * la encuentran por residencia o por siembra. Deduplicado por clave+edits y
   * por época, y fire-and-forget: calentar nunca puede romper nada — lo peor
   * que puede pasar es exactamente lo que ya pasaba.
   */
  warmCanon(
    world: WorldData,
    geography: HumanGeography,
    ids: TileId[],
    edits?: string,
    workerFactory?: RegionWorkerFactory,
  ): void {
    const editsHash = hashString(edits ?? '');
    const wanted = new Set(ids.map((id) => `${this.worldIdentity(world)}:${canonTileKey(id)}:e${editsHash}`));
    // Primero retirar lo que el plan ya no pisa: el suelo que el lector dejó
    // atrás no puede ir por delante del que está mirando.
    for (const [key, cancelWarm] of [...this.warming]) {
      if (wanted.has(key)) continue;
      this.warming.delete(key);
      this.warmed.delete(key);
      cancelWarm();
    }
    for (const id of ids) {
      const key = `${this.worldIdentity(world)}:${canonTileKey(id)}:e${editsHash}`;
      if (this.warmed.has(key)) continue;
      this.warmed.add(key);
      const handle = this.request(world, geography, tileWindow(world, id), {
        params: canonParams(world),
        geometry: tileGeometry(world, id),
        canonKey: canonTileKey(id),
        edits,
        workerFactory,
      });
      this.warming.set(key, handle.cancel);
      handle.promise.then(() => {
        this.warming.delete(key);
      }).catch(() => {
        // Un warm fallido (timeout, cancelación, worker caído) debe poder
        // reintentarse en el siguiente gesto.
        this.warming.delete(key);
        this.warmed.delete(key);
      });
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
      seeded: new Set(),
    };
    this.sessions.add(session);
    try {
      worker.postMessage({
        type: 'configure',
        contextId: session.contextId,
        world,
        geography: packRegionGeography(geography),
        persistCanon: !!canonPersistence,
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
// Sized from the hardware, not from a constant. A Forge session is its own OS
// process, so the pool tracks the core count directly; a web-worker session
// lives inside the renderer, so that path stays at half the cores.
export const regionClient = new RegionWorkerClient(
  scaleCount(16),
  forgeAvailable() ? workerSlots() : Math.max(2, Math.floor(workerSlots() / 2)),
  scaleBytes(256 * 1024 * 1024),
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
