import { workerSlots } from '@/utils/capacity';
import type { HumanGeography } from '../core/settlements';
import { deepTileSpec, deepTileSupported, type TilePlace } from './deepTile';
import { satelliteDeepSupported, satelliteTileSpec } from './satelliteTile';
import { canonWindowCover } from './composeWindow';
import { canonTileKey } from './generate';
import type { TileId } from './tiles';
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
import { geographyContentKey, mapSourceKey, worldContentKey } from './contentIdentity';

/**
 * The renderer's canon storage, injected rather than imported: this module is
 * reachable from benches and from `core`-adjacent code that must never pull
 * the database in (see `snapshots.ts`'s header for the rule). The app
 * registers `canonSnapshots.ts` here once at engine load; nothing registered
 * means canon stays session-local, exactly the pre-persistence behaviour.
 */
export interface CanonPersistence {
  /** Stored bytes for one supertile under the CURRENT edit list, or null. */
  load(
    world: WorldData, geography: HumanGeography, canonKey: string, editsJson: string,
  ): Promise<ArrayBuffer | null>;
  /** Persist one freshly generated supertile, built at `editsJson`. */
  save(
    world: WorldData, geography: HumanGeography, canonKey: string,
    editsJson: string, bytes: ArrayBuffer,
  ): void;
}

let canonPersistence: CanonPersistence | null = null;

/**
 * LECTURAS DE CANON EN VUELO, deduplicadas globalmente.
 *
 * Un plan de 28 teselas hondas pide las MISMAS 4-12 superteselas: sin esto
 * eran ~100 lecturas simultáneas de 2,2 MB contra IndexedDB, que las
 * serializa — la última tardaba OCHO SEGUNDOS en el log de Luis
 * («siembra c:245:155 HIT 2.2MB 8279 ms») y cada una copiaba su buffer al
 * worker. Con la dedupe son 4-12 lecturas y el resto se cuelga de la misma
 * promesa. La entrada se borra al resolverse: esto NO es una caché de bytes
 * (eso volvería a llenar el renderer), sólo un embudo.
 */
const canonLoadsEnVuelo = new Map<string, Promise<ArrayBuffer | null>>();

interface CanonBuildFlight {
  id: string;
  promise: Promise<ArrayBuffer | null>;
  resolve: (bytes: ArrayBuffer | null) => void;
  settled: boolean;
}

/** Global single-flight for canon generation. Adjacent display tiles overlap
 * the same supertiles; only the first request may generate each one, while the
 * rest await its bytes and seed their own worker. */
const canonBuildsEnVuelo = new Map<string, CanonBuildFlight>();

interface CanonPreparation {
  keys: string[];
  seeds: Array<{ key: string; bytes: ArrayBuffer }>;
  owned: Map<string, CanonBuildFlight>;
}

function canonBuildId(
  world: WorldData, geography: HumanGeography, canonKey: string, editsJson: string,
): string {
  return `${mapSourceKey(world, geography, editsJson)}:${canonKey}`;
}

function claimCanonBuild(id: string): { flight: CanonBuildFlight; owner: boolean } {
  const existing = canonBuildsEnVuelo.get(id);
  if (existing) return { flight: existing, owner: false };
  let resolve!: (bytes: ArrayBuffer | null) => void;
  const flight: CanonBuildFlight = {
    id,
    promise: new Promise<ArrayBuffer | null>((done) => { resolve = done; }),
    resolve: (bytes) => {
      if (flight.settled) return;
      flight.settled = true;
      resolve(bytes);
      if (bytes) {
        // Keep the resolved flight briefly: persistence writes are asynchronous,
        // and a request arriving in that gap should seed these bytes, not rebuild.
        setTimeout(() => {
          if (canonBuildsEnVuelo.get(id) === flight) canonBuildsEnVuelo.delete(id);
        }, 2_000);
      } else if (canonBuildsEnVuelo.get(id) === flight) {
        canonBuildsEnVuelo.delete(id);
      }
    },
    settled: false,
  };
  canonBuildsEnVuelo.set(id, flight);
  return { flight, owner: true };
}

function loadCanonDedup(
  world: WorldData, geography: HumanGeography, canonKey: string, editsJson: string,
): Promise<ArrayBuffer | null> {
  const persistence = canonPersistence;
  if (!persistence) return Promise.resolve(null);
  const k = `${mapSourceKey(world, geography, editsJson)}:${canonKey}`;
  const vivo = canonLoadsEnVuelo.get(k);
  if (vivo) return vivo;
  const p = persistence.load(world, geography, canonKey, editsJson)
    .catch(() => null)
    .finally(() => { canonLoadsEnVuelo.delete(k); });
  canonLoadsEnVuelo.set(k, p);
  return p;
}

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

/** HISTÓRICO: la granja no desaloja obreros — no hay «calor» que medir.
 *  Se conserva el símbolo para no romper importadores viejos; no hace nada. */
export const sessionHeat = { coldMs: 10_000 };

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

/**
 * UN OBRERO DE LA GRANJA — el sustituto de las «sesiones» (2026-08-14, orden
 * de Luis: «manda a tomar por culo el sistema actual y haz uno que funcione»).
 *
 * El pool viejo casaba sesiones por identidad de objeto y las mataba para
 * abrir hueco: cuatro modos de cuelgue distintos en dos días (la fila india,
 * el thrash de familias, los 20 huecos de vuelo clavados en el acquire, y el
 * `RangeError: Array buffer allocation failed` — el renderer sin memoria de
 * tanto clonar mundos de 2048 por cada contexto que nacía y moría: 24-58 por
 * sesión de uso en sus logs). La granja es lo que hacen renderd y todos los
 * servidores de teselas de verdad:
 *
 *   · N obreros fijos, arrancados perezosos y JAMÁS desalojados — un obrero
 *     sólo muere si su latido calla (y se le reemplaza al siguiente trabajo).
 *   · Cualquier obrero libre sirve cualquier trabajo; si su contexto
 *     residente no es el pedido, se reconfigura — un envío, no una muerte.
 *     Con el mundo quieto, las reconfiguraciones tienden a CERO por afinidad
 *     (se prefiere el obrero que ya tiene el contexto).
 *   · La supervisión es POR OBRERO y por SILENCIO (un solo reloj de granja),
 *     no por petición: fuera plazos por tesela, rearmes y pulsos de cola.
 *   · Tomar obrero no tiene predicados que puedan no cumplirse nunca: libre
 *     con contexto > libre > abrir hueco > aparcar con re-intento por reloj.
 */
interface Obrero {
  worker: RegionWorkerLike;
  factory: RegionWorkerFactory;
  /** Identidad del contexto RESIDENTE (mundo+geografía+revisión), o '' si
   *  aún no se configuró. */
  contextId: string;
  busy: boolean;
  /** Última señal de vida (cualquier mensaje del worker). */
  lastBeat: number;
  /** Presupuesto de silencio del trabajo en curso (teselas o sábanas). */
  idleBudgetMs: number;
  /** Aviso al trabajo en curso cuando el vigía retira al obrero mudo. */
  onDead: (() => void) | null;
  /** Canon supertile keys this obrero has been seeded with (or has built) —
   *  the "don't ask Dexie twice" ledger. Entries are struck when a
   *  `consumeOnly` decline proves the worker evicted them. */
  seeded: Set<string>;
  muerto: boolean;
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
  /** La granja: una flota de obreros por fábrica (la de la app, y las de
   *  mentira de cada banco). */
  private readonly flotas = new Map<RegionWorkerFactory, Obrero[]>();
  /** Trabajos aparcados esperando obrero: cada uno es un intento re-ejecutable
   *  (devuelve true si consiguió obrero). Se drena al liberar Y por reloj —
   *  sin predicados imposibles, aparcarse no puede ser eterno. */
  private readonly parked: Array<() => boolean> = [];
  private parkedTimer: ReturnType<typeof setInterval> | null = null;
  /** El vigía único de la granja (ver `vigilar`). */
  private latido: ReturnType<typeof setInterval> | null = null;
  private readonly cacheLimit: number;
  private readonly sessionLimit: number;
  /** Hard byte ceiling for cached RegionData. A 1024-width world's canon
   *  tile weighs ~25 MB — sixteen of those was 400 MB on the renderer's
   *  main thread, which is the classic silent "Render process gone". */
  private readonly cacheByteBudget: number;
  private cacheBytes = 0;
  /** HISTÓRICO (los bancos aún lo tocan): la granja siempre es paralela —
   *  el campo se conserva para no romper firmas y se ignora. */
  parallelWorldSessions: boolean | null = null;
  /** Bumped when the reader moves to a new world (regenerate, load). */
  private epoch = 0;
  private nextRequestId = 1;

  constructor(cacheLimit = 6, sessionLimit = 2, cacheByteBudget = 144 * 1024 * 1024) {
    this.cacheLimit = Math.max(1, Math.floor(cacheLimit));
    this.sessionLimit = Math.max(1, Math.floor(sessionLimit));
    this.cacheByteBudget = Math.max(16 * 1024 * 1024, cacheByteBudget);
  }

  /** Cuántas sesiones puede tener el pool a la vez. El `tileService` lo lee
   *  para dimensionar su techo de vuelo: despachar más teselas que sesiones
   *  posibles sólo reconstruye la cola honda del pool que la cola corta y
   *  descartable del servicio existe para impedir. */
  get sessionCapacity(): number {
    return this.sessionLimit;
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
    // Los obreros LIBRES de mundos anteriores se retiran (su contexto es peso
    // muerto); los ocupados terminan su trabajo y se reconfigurarán al primer
    // uso — la granja jamás mata trabajo en curso.
    for (const flota of this.flotas.values()) {
      for (const obrero of [...flota]) {
        if (!obrero.busy) this.matar(obrero);
      }
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
    const key = `${mapSourceKey(world, geography, options.edits ?? '')}`
      + `:${cacheGeometryKey(world, window, params, options.geometry)}`;
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

    let session: Obrero | null = null;
    let settled = false;
    let rejectPromise: (reason: unknown) => void = () => undefined;
    let abortListener: (() => void) | null = null;

    const cleanup = (roto: boolean) => {
      if (abortListener) options.signal?.removeEventListener('abort', abortListener);
      abortListener = null;
      this.active.delete(requestId);
      inFlightSince.delete(requestId);
      if (!session) return;
      if (roto) this.matar(session);
      else this.liberar(session);
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

      this.tomar(factory, world, geography).then((acquired) => {
        if (!acquired) {
          fail(new Error('No hay obrero regional disponible.'));
          return;
        }
        if (settled) {
          this.liberar(acquired);
          return;
        }
        session = acquired;
        attach(acquired);
      }).catch((error: unknown) => fail(error));

      const attach = (live: Obrero) => {
      // El presupuesto de silencio de una sábana: cada mensaje es su latido
      // (una sábana legítima tarda minutos pero HABLA por `progress`); el
      // vigía de la granja retira al obrero mudo — ningún reloj propio aquí.
      live.idleBudgetMs = requestDeadlines.generateIdleMs;
      live.onDead = () => {
        if (settled) return;
        settled = true;
        session = null; // el vigía ya lo retiró
        this.active.delete(requestId);
        inFlightSince.delete(requestId);
        traceTiles(requestId, 'CADUCADA (obrero mudo; retirado por el vigía)');
        rejectPromise(new Error('El worker regional dejó de responder; obrero retirado.'));
      };
      live.worker.onmessage = (event) => {
        const reply = event.data;
        live.lastBeat = Date.now();
        // A composite sheet that generated fresh canon ships it for storage
        // ahead of `done` — same contract as the display tiles, same guard:
        // ground the reader has painted past since the request is refused.
        if (reply.type === 'canonBuilt') {
          if (reply.requestId !== requestId) return;
          const persistence = canonPersistence;
          if (persistence && reply.editsHash === hashEditsString(options.edits ?? '')) {
            live.seeded.add(reply.key);
            persistence.save(world, geography, reply.key, options.edits ?? '', reply.bytes);
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
        loadCanonDedup(world, geography, k, options.edits ?? '')
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
    // Un obrero LIBRE que ya tenga el contexto residente. Una sonda jamás
    // encola, jamás abre obrero, jamás reconfigura: sin residencia, no hay
    // respuesta — es lo que la hace segura desde un hover.
    const ctx = this.contextIdFor(world, geography);
    let session: Obrero | null = null;
    for (const flota of this.flotas.values()) {
      const candidato = flota.find((o) => !o.busy && o.contextId === ctx);
      if (candidato) { session = candidato; break; }
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
    live.busy = true;
    live.lastBeat = Date.now();
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
        if (live.busy && !live.muerto) {
          live.busy = false;
          this.drenarParking();
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
    let session: Obrero | null = null;
    let settled = false;
    /** Cancelled AFTER a worker had already started drawing: the caller is
     *  gone, but the reply still has to be collected. */
    let abandoned = false;
    let rejectPromise: (reason: unknown) => void = () => undefined;
    let preparation: CanonPreparation | null = null;

    const releaseOwnedCanon = () => {
      if (!preparation) return;
      for (const flight of preparation.owned.values()) flight.resolve(null);
      preparation.owned.clear();
    };

    const cleanup = (roto: boolean) => {
      this.active.delete(requestId);
      inFlightSince.delete(requestId);
      releaseOwnedCanon();
      if (!session) return;
      if (roto) this.matar(session);
      else this.liberar(session);
      session = null;
    };
    /**
     * Give up on this tile.
     *
     * The display store cancels on every pan now — a one-second gesture crosses
     * ~30 tiles — so what this costs matters as much as what it saves.
     *
     * NOT DISPATCHED YET is where the saving is: the request simply leaves the
     * parking (`tomar` deja de intentar al ver `abandoned`) and never becomes
     * work at all. That is the ordinary case; the farm only ever has
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
      inFlightSince.set(requestId, Date.now());
      const born = Date.now();
      traceTiles(requestId, `nace z${tile.z}(${tile.tx},${tile.ty})`,
        opts.ink ?? 'carta', opts.consumeOnly ? 'consume' : '');
      // Sin plazo propio: el vigía de la granja mide el silencio POR OBRERO,
      // y una tesela aparcada sin obrero no puede caducar — se descarta desde
      // el servicio o deja de intentar (`abandoned`). Fuera el plazo por
      // petición, el rearme y el pulso de cola: era la maquinaria que
      // mantenía vivo el cuelgue que decía curar (los 20 huecos de vuelo
      // clavados en el acquire de los logs de Luis, re-armados eternamente
      // por el progreso de las sábanas).
      // Storage and single-flight coordination happen BEFORE taking a worker.
      // The old order reserved every worker during 3-8 s IndexedDB reads, which
      // is why the log showed a full farm doing no CPU work.
      this.prepareCanonFor(world, geography, tile, opts, () => settled || abandoned)
        .then((prepared) => {
          preparation = prepared;
          if (settled || abandoned) {
            releaseOwnedCanon();
            return null;
          }
          return this.tomar(factory, world, geography, () => settled || abandoned);
        })
        .then((acquired) => {
          if (!acquired) {
            if (!settled && !abandoned) { settled = true; cleanup(false); resolve(null); }
            return;
          }
          traceTiles(requestId, `obrero ${acquired.contextId} (cola ${Date.now() - born} ms)`);
          if (settled || abandoned) {
            this.liberar(acquired);
            if (!settled) { settled = true; cleanup(false); resolve(null); }
            return;
          }
          session = acquired;
          attach(acquired);
        }).catch(() => {
          if (!settled) { settled = true; cleanup(false); resolve(null); }
        });

      const attach = (live: Obrero) => {
      live.idleBudgetMs = requestDeadlines.tileMs;
      live.onDead = () => {
        if (settled) return;
        settled = true;
        session = null; // el vigía ya lo retiró
        this.active.delete(requestId);
        inFlightSince.delete(requestId);
        traceTiles(requestId, `CADUCADA a los ${((Date.now() - born) / 1000).toFixed(1)}s (obrero mudo retirado)`);
        resolve(null);
      };
      /** The supertile keys under THIS tile, kept for the decline bookkeeping. */
      let coverKeys: string[] | null = null;
      live.worker.onmessage = (event) => {
        const reply = event.data;
        live.lastBeat = Date.now();
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
            persistence.save(world, geography, reply.key, opts.edits ?? '', reply.bytes);
          }
          preparation?.owned.get(reply.key)?.resolve(reply.bytes);
          return;
        }
        if (settled || reply.type === 'configured') return;
        if (reply.requestId !== requestId) return;
        if (reply.type === 'progress') {
          // La fragua canta una vez por supertesela (workerCore): cada señal
          // es latido del obrero (ya anotado arriba) — una tesela cuyo suelo
          // cueste tres minutos no caduca mientras su fragua HABLE.
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
      this.seedPreparedCanon(live, preparation).then((keys) => {
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
      for (const flota of this.flotas.values()) for (const o of [...flota]) this.matar(o);
      return;
    }
    for (const [key, entry] of this.cache) {
      if (entry.world === world) {
        this.cacheBytes -= entry.bytes;
        this.cache.delete(key);
      }
    }
    // Los obreros con el contexto de ESTE mundo: los libres se retiran (su
    // contexto muere con el mundo); los ocupados terminan su trabajo — un
    // mundo que se va con un render en vuelo no justifica matar al obrero,
    // se reconfigurará al siguiente uso.
    const prefix = `w${worldContentKey(world)}:g`;
    for (const flota of this.flotas.values()) {
      for (const o of [...flota]) {
        if (!o.contextId.startsWith(prefix)) continue;
        if (!o.busy) this.matar(o);
      }
    }
  }

  dispose(): void {
    for (const request of [...this.active.values()]) request.cancel();
    for (const flota of this.flotas.values()) for (const o of [...flota]) this.matar(o);
    this.flotas.clear();
    this.parked.length = 0;
    if (this.parkedTimer !== null) { clearInterval(this.parkedTimer); this.parkedTimer = null; }
    if (this.latido !== null) { clearInterval(this.latido); this.latido = null; }
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
    let n = 0;
    for (const flota of this.flotas.values()) n += flota.length;
    return n;
  }

  /**
   * TOMAR OBRERO — el corazón de la granja, sin predicados imposibles:
   *   1. libre con el CONTEXTO pedido ya residente (afinidad: cero envíos);
   *   2. cualquier libre (se reconfigura: UN envío, ninguna muerte);
   *   3. hueco bajo el techo → nace uno;
   *   4. nada → aparcado re-intentable, drenado al liberar Y por reloj.
   * No hay desalojo, ni calor, ni coincidencia por identidad que pueda no
   * darse nunca: las cuatro ramas terminan. Un `abandoned` (tesela cancelada
   * en cola del servicio) simplemente deja de intentar.
   */
  private tomar(
    factory: RegionWorkerFactory,
    world: WorldData,
    geography: HumanGeography,
    abandoned?: () => boolean,
  ): Promise<Obrero | null> {
    return new Promise((resolve) => {
      const intentar = (): boolean => {
        if (abandoned?.()) { resolve(null); return true; }
        const ctx = this.contextIdFor(world, geography);
        const flota = this.flota(factory);
        // El orden de la afinidad: (1) libre CON el contexto; (2) hueco bajo
        // el techo — un obrero fresco cuesta el mismo configure que
        // reconfigurar a uno ajeno y CONSERVA la residencia de la otra
        // familia (sin el paso 2 por delante, dos familias alternando se
        // robaban los mismos dos obreros: 24 configures para 24 teselas en el
        // banco); (3) cualquier libre, reconfigurado; (4) aparcar.
        let libre: Obrero | null = flota.find((o) => !o.busy && o.contextId === ctx) ?? null;
        if (!libre && flota.length < this.sessionLimit) {
          libre = this.spawnObrero(factory);
          if (!libre) { resolve(null); return true; } // la fábrica falló
        }
        if (!libre) libre = flota.find((o) => !o.busy) ?? null;
        if (!libre) return false;
        libre.busy = true;
        libre.lastBeat = Date.now();
        if (libre.contextId !== ctx && !this.configurar(libre, ctx, world, geography)) {
          // La configuración reventó: obrero retirado; probar con uno fresco
          // UNA vez (hay hueco: acabamos de retirar).
          const fresco = this.spawnObrero(factory);
          if (!fresco || !this.configurar(fresco, ctx, world, geography)) {
            resolve(null);
            return true;
          }
          fresco.busy = true;
          fresco.lastBeat = Date.now();
          this.armarLatido();
          resolve(fresco);
          return true;
        }
        this.armarLatido();
        resolve(libre);
        return true;
      };
      if (intentar()) return;
      this.parked.push(intentar);
      this.armarRecheck();
    });
  }

  private flota(factory: RegionWorkerFactory): Obrero[] {
    let flota = this.flotas.get(factory);
    if (!flota) { flota = []; this.flotas.set(factory, flota); }
    return flota;
  }

  private contextIdFor(world: WorldData, geography: HumanGeography): string {
    return `w${worldContentKey(world)}:g${geography.depth}:${geographyContentKey(geography)}`;
  }

  private spawnObrero(factory: RegionWorkerFactory): Obrero | null {
    try {
      const obrero: Obrero = {
        worker: factory(),
        factory,
        contextId: '',
        busy: false,
        lastBeat: Date.now(),
        idleBudgetMs: requestDeadlines.tileMs,
        onDead: null,
        seeded: new Set(),
        muerto: false,
      };
      this.flota(factory).push(obrero);
      return obrero;
    } catch {
      return null;
    }
  }

  /** Enviar el contexto al obrero. El workerCore procesa los mensajes EN
   *  ORDEN, así que no se espera confirmación: el render que sigue ya lo
   *  encuentra puesto. Reconfigurar vacía el canon del obrero — la siembra
   *  de Dexie lo repone en frío — así que el libro de siembras se vacía. */
  private configurar(
    obrero: Obrero, ctx: string, world: WorldData, geography: HumanGeography,
  ): boolean {
    try {
      traceTiles('granja', `obrero ${ctx}`, obrero.contextId ? `reconfigura (era ${obrero.contextId})` : 'primer contexto');
      obrero.worker.postMessage({
        type: 'configure',
        contextId: ctx,
        world,
        geography: packRegionGeography(geography),
        persistCanon: !!canonPersistence,
      });
      obrero.contextId = ctx;
      obrero.seeded = new Set();
      return true;
    } catch {
      this.matar(obrero);
      return false;
    }
  }

  /** El obrero terminó su trabajo y vuelve a la flota; se drena el parking. */
  private liberar(obrero: Obrero): void {
    if (obrero.muerto) return;
    obrero.worker.onmessage = null;
    obrero.worker.onerror = null;
    obrero.worker.onmessageerror = null;
    obrero.busy = false;
    obrero.onDead = null;
    obrero.lastBeat = Date.now();
    this.drenarParking();
  }

  /** Retirar a un obrero (mudo, roto, o de un mundo que ya no existe). No se
   *  reemplaza aquí: el siguiente `tomar` abre hueco perezosamente. */
  private matar(obrero: Obrero): void {
    obrero.muerto = true;
    obrero.worker.onmessage = null;
    obrero.worker.onerror = null;
    obrero.worker.onmessageerror = null;
    try { obrero.worker.terminate(); } catch { /* ya muerto */ }
    const flota = this.flotas.get(obrero.factory);
    if (flota) {
      const i = flota.indexOf(obrero);
      if (i >= 0) flota.splice(i, 1);
    }
    this.drenarParking();
  }

  private drenarParking(): void {
    while (this.parked.length && this.parked[0]()) this.parked.shift();
    if (!this.parked.length && this.parkedTimer !== null) {
      clearInterval(this.parkedTimer);
      this.parkedTimer = null;
    }
  }

  private armarRecheck(): void {
    if (this.parkedTimer !== null) return;
    this.parkedTimer = setInterval(() => this.drenarParking(), 500);
  }

  /**
   * EL VIGÍA — el único reloj del sistema. Un obrero OCUPADO cuyo último
   * mensaje quedó más atrás que el presupuesto de su trabajo está mudo
   * (proceso caído, bundle roto): se retira, y su trabajo recibe `onDead`
   * (la tesela resuelve null re-pedible; la sábana rechaza). Nada de plazos
   * por petición, rearmes ni pulsos: una sábana legítima HABLA (progress) y
   * cada mensaje es su latido.
   */
  private vigilar(): void {
    let ocupados = 0;
    for (const flota of this.flotas.values()) {
      for (const obrero of [...flota]) {
        if (!obrero.busy) continue;
        ocupados++;
        if (Date.now() - obrero.lastBeat <= obrero.idleBudgetMs) continue;
        tileStats.timeouts++;
        traceTiles('granja', obrero.contextId,
          `obrero MUDO ${(Date.now() - obrero.lastBeat) / 1000 | 0}s — retirado`);
        const onDead = obrero.onDead;
        this.matar(obrero);
        onDead?.();
      }
    }
    if (!ocupados && this.latido !== null) {
      clearInterval(this.latido);
      this.latido = null;
    }
  }

  private armarLatido(): void {
    if (this.latido !== null) return;
    // El paso del vigía sigue a los presupuestos (los bancos los aprietan a
    // cientos de ms): un tercio del menor, entre 250 ms y 5 s.
    const paso = Math.max(250, Math.min(5_000,
      Math.floor(Math.min(requestDeadlines.tileMs, requestDeadlines.generateIdleMs) / 3)));
    this.latido = setInterval(() => this.vigilar(), paso);
  }

  /** Resolve stored and concurrently-built canon before reserving a worker.
   * Every missing supertile has exactly one owner across the whole farm. */
  private async prepareCanonFor(
    world: WorldData,
    geography: HumanGeography,
    tile: { z: number; tx: number; ty: number },
    opts: { edits?: string; ink?: 'carta' | 'satellite'; consumeOnly?: boolean },
    abandoned: () => boolean,
  ): Promise<CanonPreparation | null> {
    const persistence = canonPersistence;
    if (!persistence) return null;
    try {
      const satellite = opts.ink === 'satellite';
      const deep = satellite
        ? satelliteDeepSupported(world, tile.z)
        : deepTileSupported(world, tile.z);
      if (!deep) return null;
      const spec = (satellite ? satelliteTileSpec : deepTileSpec)(world, tile);
      const keys = canonWindowCover(world, spec).map(canonTileKey);
      const t0 = Date.now();
      const loaded = await Promise.all(keys.map(async (key) => ({
        key,
        bytes: await loadCanonDedup(world, geography, key, opts.edits ?? ''),
      })));
      if (abandoned()) return null;

      const seeds = loaded.filter(
        (item): item is { key: string; bytes: ArrayBuffer } => !!item.bytes,
      );
      const owned = new Map<string, CanonBuildFlight>();
      const waiting: Array<Promise<{ key: string; bytes: ArrayBuffer | null }>> = [];
      if (!opts.consumeOnly) {
        for (const miss of loaded) {
          if (miss.bytes) continue;
          const id = canonBuildId(world, geography, miss.key, opts.edits ?? '');
          const claimed = claimCanonBuild(id);
          if (claimed.owner) owned.set(miss.key, claimed.flight);
          else waiting.push(claimed.flight.promise.then((bytes) => ({ key: miss.key, bytes })));
        }
      }
      const shared = await Promise.all(waiting);
      if (abandoned()) {
        for (const flight of owned.values()) flight.resolve(null);
        return null;
      }
      for (const item of shared) if (item.bytes) seeds.push({ key: item.key, bytes: item.bytes });
      traceTiles('canon-plan',
        `${keys.length} hojas · disco ${seeds.length - shared.filter((x) => !!x.bytes).length}`
          + ` · compartidas ${shared.length} · propias ${owned.size}`,
        `${Date.now() - t0} ms`);
      return { keys, seeds, owned };
    } catch (err) {
      tileStats.seedErrors++;
      if (tileStats.seedErrors === 1) {
        console.warn('[worldgen] la preparación del canon falló (la tesela sigue su camino)', err);
      }
      return null;
    }
  }

  /** Seed only bytes this particular worker does not already hold. Misses are
   * never written into the ledger: an owner must remain visibly missing so its
   * render generates it and emits `canonBuilt`. */
  private async seedPreparedCanon(
    session: Obrero,
    preparation: CanonPreparation | null,
  ): Promise<string[] | null> {
    if (!preparation) return null;
    const tiles = preparation.seeds.filter((item) => !session.seeded.has(item.key));
    if (tiles.length) {
      tileStats.seeded += tiles.length;
      session.worker.postMessage({
        type: 'seedCanon',
        contextId: session.contextId,
        tiles,
      });
      for (const item of tiles) session.seeded.add(item.key);
    }
    return preparation.keys;
  }

  /**
   * HISTÓRICO — el calentador está JUBILADO por la granja (2026-08-14).
   * Existía para que el primer paseo usara todos los procesos en vez de una
   * fila india; la granja ya reparte cualquier trabajo entre todos los
   * obreros libres, el servicio de teselas mantiene el plan vigente por
   * delante, y el canon persiste en Dexie — calentar aparte sólo volvía a
   * encolar por delante de lo que el lector mira. Firma conservada para no
   * romper llamantes; no hace nada.
   */
  warmCanon(
    ...args: [WorldData, HumanGeography, TileId[], (string | undefined)?, (RegionWorkerFactory | undefined)?]
  ): void {
    void args; // nada — ver arriba
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
// EL TECHO DE LA GRANJA: min(cores, 8). Los 20 obreros que permitía el
// core-count fueron parte del funeral del renderer de Luis (2026-08-14,
// «RangeError: Array buffer allocation failed»): cada configure clona el
// mundo A TRAVÉS del renderer aunque el obrero viva en su propio proceso, y
// veinte clones de un 2048 en ráfaga son gigas de tránsito. Ocho obreros
// fraguan ocho superteselas a la vez — de sobra para llenar un plan — con el
// tránsito acotado. Los web workers (sin Forja) siguen a la mitad.
// Y LA CACHÉ DE SÁBANAS, AL MÍNIMO ÚTIL (64 MB, 6 entradas). Los 256 MB de
// RegionData vivían en el HILO PRINCIPAL del renderer, junto a los mapas de
// bits del almacén de pantalla y al mundo mismo: ese apilamiento es lo que
// reventó con «RangeError: Array buffer allocation failed» al pedir 3,6 MB
// (log de Luis, 2026-08-14). Desde la pasada 8 el canon vive en Dexie y
// desde la 10 la tinta también, así que una caché de sábanas enorme en RAM
// ya no ahorra minutos — ahorra milisegundos y cuesta el renderer.
export const regionClient = new RegionWorkerClient(
  6,
  forgeAvailable() ? Math.min(8, workerSlots()) : Math.max(2, Math.floor(workerSlots() / 2)),
  64 * 1024 * 1024,
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
