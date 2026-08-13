// ============================================
// Regional worker — the CORE, host-agnostic
// ============================================
// One message handler, two homes. In the browser it runs inside a Web Worker
// (a thread of the renderer process, paying renderer memory prices). In the
// Forge it runs inside an Electron utilityProcess — a real OS process with
// its own memory space, where a generation can gorge on RAM and a crash
// cannot take the window down. The host injects the two things that differ:
// how to POST a reply, and how to make a 2D SURFACE for tile rendering.

import { canonTileKey, clearRegionCache, generateRegion } from './generate';
import { deserializeEdits } from '../core/edits';
import { renderCartaTile, TILE_PX } from '../cartography/tiles';
import { canonRefinement, tileAt, tileGeometry, tileKey as canonKeyOf } from './tiles';
import { renderBase } from '../core/render';
import {
  renderSatelliteDeepTile, renderSatelliteShallowTile, satelliteDeepSupported, satelliteTileSpec,
} from './satelliteTile';
import { canonBytes, canonCoverFor, deepTileSpec, installCanon } from './deepTile';
import { canonWindowCover } from './composeWindow';
import { CANON_CACHE_CAP, CANON_CACHE_BYTES } from './deepTile';
import { deepTileSupported, makeCanonCache, renderDeepTile, type CanonCache, type TilePlace } from './deepTile';
import { encodeCanonTile, decodeCanonTile, quantizeCanonTile } from './canonStore';
import { THEMES } from '../cartography/theme';
import {
  hashEditsString, regionTransferables,
  type RegionCancelWorkerRequest, type RegionWorkerReply, type RegionWorkerRequest,
} from './workerProtocol';
import { buildLanguageFamily } from '../core/language';
import type { HumanGeography } from '../core/settlements';
import type { WorldData } from '../core/types';
import type { RegionData } from './types';

/** What a finished tile hands back: either a zero-copy bitmap (web worker,
 *  same process) or raw pixels (forge, crossing a process boundary). */
export interface TileResult {
  bitmap?: ImageBitmap;
  rgba?: ArrayBuffer;
  width?: number;
  height?: number;
  transfer: Transferable[];
}

export interface RegionWorkerHost {
  post(message: RegionWorkerReply, transfer?: Transferable[]): void;
  /** Draw one tile with `draw`, then package the pixels for this host. */
  renderTile(px: number, draw: (ctx: CanvasRenderingContext2D) => void): TileResult;
}

export function createRegionWorkerCore(host: RegionWorkerHost): (message: RegionWorkerRequest) => void {
  const cancelled = new Set<string>();
  let context: {
    id: string;
    world: WorldData;
    geography: HumanGeography;
    /** Canon supertiles for deep display tiles, LRU per session. */
    canon: CanonCache;
    /** Client persists canon: encode fresh supertiles and post `canonBuilt`. */
    persistCanon: boolean;
    /** The unshaded atlas raster, built once and only if a shallow satellite
     *  tile ever asks for it — it is ~8 MB and the carta path never needs it. */
    unshaded?: Uint8ClampedArray;
    /** Claves que la LRU ha desalojado y el cliente aún no sabe: viajan en la
     *  próxima respuesta de tesela (`evictedCanon`) para que el libro de
     *  siembras no dé por residente lo ya tirado. Ver workerProtocol. */
    evictedPending: Set<string>;
    /** Espejo de las claves residentes tras el último recuento, para sacar
     *  los desalojos por DIFERENCIA — `installCanon` es puro y compartido, y
     *  enseñarle a hablar con la sesión costaría la pureza que lo hace de
     *  bancos. */
    canonKnown: Set<string>;
  } | null = null;

  /** Anota en `evictedPending` lo que había y ya no está. Llamar tras
   *  cualquier tramo que instale canon (siembra, teselas, compuestas). */
  const settleCanonLedger = (live: NonNullable<typeof context>) => {
    for (const key of live.canonKnown) {
      if (!live.canon.map.has(key)) live.evictedPending.add(key);
    }
    live.canonKnown = new Set(live.canon.map.keys());
    for (const key of live.canonKnown) live.evictedPending.delete(key);
  };

  /**
   * MESSAGES RUN IN ARRIVAL ORDER, ALWAYS. The handler used to be fully
   * synchronous and got that for free; canon persistence introduces awaits
   * (gzip streams in `encodeCanonTile`/`decodeCanonTile`), and an awaited
   * `seedCanon` letting the next `renderTile` overtake it would regenerate the
   * very supertile the seed was carrying — 31 s paid to lose a race. So every
   * message chains on this queue. `cancel` alone stays OUTSIDE the chain: a
   * cancel that queued behind the work it cancels would arrive after the
   * corpse, and registering it immediately lets a queued-but-unstarted render
   * be dropped, which is strictly better than the old synchronous behaviour.
   */
  let queue: Promise<void> = Promise.resolve();

  /**
   * Ningún paso de la persistencia puede atascar la cola. El encode/decode
   * pasan por `CompressionStream` + `Blob` + `Response`, y una promesa de
   * stream que nunca resuelve en un runtime raro no sería un error — sería
   * TODA la sesión muda para siempre: peticiones que crecen, entregas a cero,
   * errores a cero (la firma exacta de un atasco silencioso). Con el plazo,
   * el peor caso es «esta supertesela no se persistió / no se sembró», que la
   * vía de teselas cubre regenerando como siempre.
   */
  const withDeadline = <T>(work: Promise<T>, ms: number): Promise<T | null> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      work.then(
        (v) => { clearTimeout(timer); resolve(v); },
        () => { clearTimeout(timer); resolve(null); },
      );
    });

  // `cancel` never reaches this: the dispatcher below handles it outside the
  // queue, and the narrower type is what lets each branch see its own fields.
  const handle = async (message: Exclude<RegionWorkerRequest, RegionCancelWorkerRequest>): Promise<void> => {
    if (message.type === 'configure') {
      const { languageCount, ...geography } = message.geography;
      context = {
        id: message.contextId,
        world: message.world,
        geography: {
          ...geography,
          languages: buildLanguageFamily(message.world.params.seed, languageCount),
        },
        canon: makeCanonCache(),
        persistCanon: message.persistCanon === true,
        evictedPending: new Set(),
        canonKnown: new Set(),
      };
      host.post({ type: 'configured', contextId: message.contextId });
      return;
    }
    if (message.type === 'seedCanon') {
      // A seed for a stale context is not an error, just a parcel for a house
      // that moved: drop it. A payload that will not decode is a cache miss —
      // the tile path regenerates exactly as it did before persistence existed.
      if (!context || context.id !== message.contextId) return;
      const decoded: { key: string; data: RegionData }[] = [];
      for (const t of message.tiles) {
        const data = await withDeadline(decodeCanonTile(t.bytes), 10_000);
        if (data) decoded.push({ key: t.key, data });
      }
      // THE BATCH MUST FIT. A small world's supertiles are huge (a 512-width
      // world's weighs ~90 MB against the ~96 MB default budget), and a seed
      // whose own eviction expels what it just planted leaves the very next
      // `consumeOnly` declining ground the reader paid for. So the limits
      // stretch to the batch — which is no more than the composition of ONE
      // display tile holds live anyway — and the next install tightens back
      // to the defaults.
      const batchBytes = decoded.reduce((sum, d) => sum + canonBytes(d.data), 0);
      const limits = {
        cap: Math.max(CANON_CACHE_CAP, decoded.length),
        bytes: Math.max(CANON_CACHE_BYTES, batchBytes),
      };
      for (const d of decoded) installCanon(context.canon, d.key, d.data, limits);
      // La siembra también puede desalojar (presupuesto en bytes): que el
      // libro se entere en la próxima tesela, no cuando ya costó una espera.
      settleCanonLedger(context);
      return;
    }

    const { requestId } = message;
    if (!context || context.id !== message.contextId) {
      host.post({ type: 'error', requestId, message: 'Regional worker context is not configured.' });
      return;
    }
    if (cancelled.delete(requestId)) {
      host.post({ type: 'cancelled', requestId });
      return;
    }

    if (message.type === 'probe') {
      const live = context;
      const id = tileAt(live.world, message.wx, message.wy);
      const data = live.canon.map.get(canonKeyOf(id));
      if (!data) {
        host.post({ type: 'probed', requestId, probe: null });
        return;
      }
      const g = tileGeometry(live.world, id);
      const per = 1 / canonRefinement(live.world);
      const gx = Math.round((message.wx - g.originX) / per - 0.5);
      const gy = Math.round((message.wy - g.originY) / per - 0.5);
      if (gx < 0 || gy < 0 || gx >= data.width || gy >= data.height) {
        host.post({ type: 'probed', requestId, probe: null });
        return;
      }
      const i = gy * data.width + gx;
      host.post({
        type: 'probed',
        requestId,
        probe: {
          elevationM: data.elevation[i] * 1000,
          water: data.water[i],
          cover: data.cover[i],
          biome: data.biome[i],
          slope: data.slope[i],
          wet: data.wet[i],
          metresPerCell: data.metresPerCell,
        },
      });
      return;
    }

    if (message.type === 'renderTile') {
      try {
        const theme = THEMES.find((t) => t.id === message.themeId) ?? THEMES[0];
        const live = context;
        let places: TilePlace[] | undefined;
        const built: { key: string; data: RegionData }[] = [];
        const satellite = message.ink === 'satellite';
        /**
         * EL CONTRATO «SÓLO CONSUMIR» (el 3D; decisión de Luis, 2026-08-11).
         *
         * Una tesela honda se dibuja componiendo superteselas de canon, y
         * generar una supertesela son SEGUNDOS. Con `consumeOnly`, antes de
         * abrir el lienzo se comprueba si TODO el canon que esta tesela pisa
         * ya es residente; si falta una sola supertesela, se declina — la
         * respuesta cuesta microsegundos y el llamante compone con lo que
         * tiene (los padres someros). Así el 2D sigue siendo el único que
         * paga generación, y el 3D se vuelve nítido exactamente allí donde el
         * lector ya estuvo mirando el mapa.
         */
        const deepSat = satellite && satelliteDeepSupported(live.world, message.z);
        const deepCarta = !satellite && deepTileSupported(live.world, message.z);
        if (message.consumeOnly) {
          if (deepSat || deepCarta) {
            const spec = (deepSat ? satelliteTileSpec : deepTileSpec)(
              live.world, { z: message.z, tx: message.tx, ty: message.ty },
            );
            const cover = canonWindowCover(live.world, spec);
            const resident = cover.every((id) => live.canon.map.has(canonTileKey(id)));
            if (!resident) {
              host.post({ type: 'tile', requestId, declined: true });
              return;
            }
          }
        } else if (deepSat || deepCarta) {
          /**
           * EL CANON SE FRAGUA AQUÍ, SUPERTESELA A SUPERTESELA Y CANTANDO.
           *
           * Antes las superteselas frías se generaban DENTRO del dibujado, en
           * silencio: una tesela cuyo suelo costara más que el plazo del
           * vigilante (120 s) caducaba, el cliente RETIRABA la sesión a media
           * generación — tirando minutos de trabajo y toda la caché de canon —
           * y la siguiente tesela arrancaba la MISMA generación desde cero en
           * una sesión virgen: la espiral que el banco de retención retrató
           * (163 caducadas y un plan 0/60 eterno en contenedor). Generar el
           * faltante ANTES de abrir el lienzo, con un `progress` por
           * supertesela, convierte el plazo en lo que debe ser — «silencio de
           * 120 s», no «no acabaste en 120 s» — porque el cliente rearma el
           * vigilante con cada señal, igual que las sábanas.
           */
          const spec = (deepSat ? satelliteTileSpec : deepTileSpec)(
            live.world, { z: message.z, tx: message.tx, ty: message.ty },
          );
          const cover = canonWindowCover(live.world, spec);
          const missing = cover.filter((id) => !live.canon.map.has(canonTileKey(id)));
          if (missing.length) {
            const edits = message.edits ? deserializeEdits(message.edits) : undefined;
            let done = 0;
            for (const id of missing) {
              host.post({
                type: 'progress', requestId, stage: 'canon', overall: done / missing.length,
              });
              canonCoverFor(
                live.world, live.geography, live.canon, [id], edits,
                { cap: CANON_CACHE_CAP, bytes: CANON_CACHE_BYTES },
                built, live.persistCanon,
              );
              done++;
            }
          }
        }
        const result = host.renderTile(TILE_PX, (c2d) => {
          if (satellite) {
            if (satelliteDeepSupported(live.world, message.z)) {
              const deep = renderSatelliteDeepTile(
                live.world, live.geography, live.canon, c2d,
                { z: message.z, tx: message.tx, ty: message.ty },
                {
                  layers: message.layers,
                  density: message.density,
                  edits: message.edits ? deserializeEdits(message.edits) : undefined,
                  quantizeCanon: live.persistCanon,
                },
                { cap: CANON_CACHE_CAP, bytes: CANON_CACHE_BYTES },
              );
              if (deep.places.length) places = deep.places;
              // ACUMULA, no pisa: la fragua previa ya pudo dejar superteselas
              // en `built`, y perderlas aquí era perder su persistencia.
              built.push(...deep.built);
            } else {
              if (!live.unshaded) {
                live.unshaded = renderBase(live.world, 'atlas', { shade: false });
              }
              renderSatelliteShallowTile(
                live.world, live.unshaded, c2d,
                { z: message.z, tx: message.tx, ty: message.ty },
                { rivers: message.layers.rivers !== false },
              );
            }
          } else if (deepTileSupported(live.world, message.z)) {
            // Deep levels draw the canon COUNTRYSIDE pliego-style. The session
            // world here is the pristine one; strokes ride the request and are
            // re-applied at canon resolution inside generation.
            const deep = renderDeepTile(
              live.world,
              live.geography,
              live.canon,
              c2d,
              { z: message.z, tx: message.tx, ty: message.ty },
              {
                theme,
                layers: message.layers,
                density: message.density,
                edits: message.edits ? deserializeEdits(message.edits) : undefined,
                quantizeCanon: live.persistCanon,
              },
            );
            if (deep.places.length) places = deep.places;
            built.push(...deep.built);
          } else {
            renderCartaTile(live.world, live.geography, c2d, {
              key: { z: message.z, tx: message.tx, ty: message.ty },
              theme,
              layers: message.layers,
              density: message.density,
              reliefAmount: message.reliefAmount,
            });
          }
        });
        // Fresh canon goes out BEFORE the tile that grew it: the client's
        // message handler for this request detaches the moment the tile reply
        // lands, and a parcel posted after that is a parcel to nobody. The
        // encode (~hundreds of ms) only ever rides a generation (~31 s), and
        // a failed encode costs the persistence, never the pixels.
        if (live.persistCanon && built.length) {
          const editsHash = hashEditsString(message.edits ?? '');
          for (const b of built) {
            const bytes = await withDeadline(encodeCanonTile(b.data), 15_000);
            if (!bytes) continue; // session-local only; the tile still ships
            try {
              host.post(
                { type: 'canonBuilt', requestId, key: b.key, editsHash, bytes: bytes.buffer as ArrayBuffer },
                [bytes.buffer as ArrayBuffer],
              );
            } catch { /* the ground stays session-local */ }
          }
        }
        // El bus de desalojos: lo que la LRU tiró desde la última respuesta
        // viaja con la tesela, y el cliente tacha esas claves de su libro de
        // siembras — la próxima petición sobre ese suelo re-siembra de Dexie
        // (~300 ms) en vez de regenerar en silencio (decenas de segundos).
        settleCanonLedger(live);
        const evictedCanon = live.evictedPending.size ? [...live.evictedPending] : undefined;
        live.evictedPending.clear();
        host.post({
          type: 'tile',
          requestId,
          bitmap: result.bitmap,
          rgba: result.rgba,
          width: result.width,
          height: result.height,
          places,
          evictedCanon,
        }, result.transfer);
      } catch (error) {
        host.post({
          type: 'error',
          requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    try {
      const canonKey = message.canonKey;
      // A supertile this session already holds — seeded from storage, or built
      // for a display tile moments ago — answers WITHOUT generating: a copy of
      // the rasters (the resident one must survive the transfer), the vector
      // layers cloned by the post itself.
      if (canonKey) {
        const held = context.canon.map.get(canonKey);
        if (held) {
          const copy: RegionData = {
            ...held,
            window: message.window,
            elevation: held.elevation.slice(),
            water: held.water.slice(),
            flow: held.flow.slice(),
            slope: held.slope.slice(),
            wet: held.wet.slice(),
            biome: held.biome.slice(),
            cover: held.cover.slice(),
          };
          host.post({ type: 'done', requestId, region: copy }, regionTransferables(copy));
          return;
        }
      }
      let region = generateRegion(context.world, context.geography, message.window, {
        params: message.params,
        geometry: message.geometry,
        edits: message.edits ? deserializeEdits(message.edits) : undefined,
        sitesPolicy: message.sitesPolicy,
        onProgress: (stage, overall) => {
          if (!cancelled.has(requestId)) {
            host.post({ type: 'progress', requestId, stage, overall });
          }
        },
      });
      if (cancelled.delete(requestId)) {
        host.post({ type: 'cancelled', requestId });
        return;
      }
      if (canonKey) {
        // The stored self is the canon (see `quantizeCanonTile`), and the
        // session cache keeps its own copy so the display tiles and the 3D's
        // `consumeOnly` inherit the ground the composite just paid for —
        // before this, the composite was the one producer whose canon died
        // with the request.
        if (context.persistCanon) region = quantizeCanonTile(region);
        installCanon(context.canon, canonKey, {
          ...region,
          elevation: region.elevation.slice(),
          water: region.water.slice(),
          flow: region.flow.slice(),
          slope: region.slope.slice(),
          wet: region.wet.slice(),
          biome: region.biome.slice(),
          cover: region.cover.slice(),
        });
        settleCanonLedger(context);
        if (context.persistCanon) {
          const editsHash = hashEditsString(message.edits ?? '');
          const bytes = await withDeadline(encodeCanonTile(region), 15_000);
          if (bytes) {
            try {
              host.post(
                { type: 'canonBuilt', requestId, key: canonKey, editsHash, bytes: bytes.buffer as ArrayBuffer },
                [bytes.buffer as ArrayBuffer],
              );
            } catch { /* session-local only */ }
          }
        }
      }
      // The renderer owns the bounded cache. Clear the worker's reference before
      // transferring buffers so a detached cached result can never be reused.
      clearRegionCache(context.world);
      host.post({ type: 'done', requestId, region }, regionTransferables(region));
    } catch (error) {
      host.post({
        type: 'error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (message: RegionWorkerRequest) => {
    if (message.type === 'cancel') {
      cancelled.add(message.requestId);
      host.post({ type: 'cancelled', requestId: message.requestId });
      return;
    }
    queue = queue.then(() => handle(message)).catch(() => undefined);
  };
}
