// ============================================================================
// El servicio de teselas — la cola corta y descartable delante del pool
// ============================================================================
// La pieza central de la reestructura (tasks/ARQUITECTURA-TESELAS.md, encargo
// de Luis del 2026-08-13: «investiga cómo se hacen este tipo de aplicaciones
// de mapas… esto ya se ha resuelto en otras apps»). Es la regla de renderd,
// el servidor de teselas de OpenStreetMap, traída a casa:
//
//   1. SERVIR DEL ALMACÉN PRIMERO. Una tesela entintada ayer se decodifica de
//      Dexie en milisegundos; el pool ni se entera. Es lo que hace que
//      reabrir un mundo se sienta Google Maps y no «80 años cargando».
//   2. COLA CORTA, Y SE DESCARTA. El techo de vuelo es el número de sesiones
//      del pool: nunca se despacha trabajo que sólo puede esperar. Lo que la
//      vista deja de querer ANTES de despacharse sale de la cola y ya está —
//      sin plazos por petición, sin vigilantes, sin pulso. La fila india del
//      log de Luis (404 peticiones por una sola sesión) no puede formarse:
//      la cola honda vivía en el pool, y al pool ya sólo llegan ≤techo.
//   3. LO DESPACHADO NO SE CANCELA: SE RECOGE Y SE GUARDA. Un render en curso
//      ya está pagado. Si el lector se fue, la tesela aterriza igual, se
//      persiste, y se entrega — el almacén de pantalla decide si la conserva
//      (su guarda de época cierra lo que ya no vale). renderd hace lo mismo:
//      jamás interrumpe un render, descarta COLAS.
//
// El servicio es deliberadamente ignorante: no conoce Dexie (la persistencia
// se inyecta, como `setCanonPersistence`), no conoce React, y no tiene estado
// por consumidor — el 2D, la carta y el 3D piden por el mismo embudo y una
// tesela que dos vistas quieren a la vez se fabrica UNA vez.

import type { HumanGeography } from '../core/settlements';
import type { WorldData } from '../core/types';
import type { TileKey } from '../cartography/tiles';
import {
  regionClient, traceTiles,
  type RegionWorkerFactory, type RenderedTile,
} from './client';
import type { TilePlace } from './deepTile';
import { mapSourceKey } from './contentIdentity';

/** Opciones de una tesela servida — las mismas que `requestTile`, porque el
 *  servicio es el nuevo único cliente de aquél. */
export interface ServeTileOptions {
  themeId: string;
  layers: Record<string, boolean>;
  density: number;
  reliefAmount: number;
  /** Lista de ediciones serializada; presente (aunque sea '') = tesela HONDA
   *  sobre el mundo prístino del canon — el suelo caro, y el único que se
   *  persiste: su contenido es semilla+params+ediciones, direccionable. */
  edits?: string;
  ink?: 'carta' | 'satellite';
  /** Sólo entintar si el canon ya es residente (el contrato del 3D). */
  consumeOnly?: boolean;
  workerFactory?: RegionWorkerFactory;
}

/**
 * La persistencia de entintadas, inyectada desde el lado con base de datos
 * (`renderedSnapshots.ts`) para que este módulo siga corriendo en bancos y
 * bundles sin Dexie. `load` devuelve la tesela lista para dibujar o null;
 * `save` es fuego-y-olvido — un guardado que falla es sólo caché perdida.
 */
export interface RenderedTilePersistence {
  load(
    world: WorldData, geography: HumanGeography, key: TileKey,
    editsJson: string, estilo: string,
  ): Promise<RenderedTile | null>;
  save(
    world: WorldData, geography: HumanGeography, key: TileKey,
    editsJson: string, estilo: string,
    bytes: Uint8Array, places: TilePlace[] | undefined,
  ): void;
}

let persistence: RenderedTilePersistence | null = null;
export function setRenderedTilePersistence(p: RenderedTilePersistence | null): void {
  persistence = p;
}

export const tileServiceStats = {
  /** Peticiones entradas por el embudo. */
  asked: 0,
  /** Compartidas con un encargo ya vivo (dos vistas, un render). */
  shared: 0,
  /** Servidas del almacén de entintadas (disco, milisegundos). */
  diskHits: 0,
  /** Consultas al almacén que fallaron (y siguieron a la cola). */
  diskMisses: 0,
  /** Entregadas al pool de verdad. */
  dispatched: 0,
  /** Descartadas EN COLA (la vista dejó de quererlas antes de despachar). */
  droppedQueued: 0,
  /** Aterrizaron ya huérfanas (nadie las esperaba con la vista puesta) —
   *  igualmente entregadas y persistidas: el render estaba pagado. */
  landedOrphan: 0,
  /** Guardadas en el almacén de entintadas. */
  saved: 0,
};

/** Un consumidor esperando una tesela concreta. */
interface Espera {
  resolve: (tile: RenderedTile | null) => void;
  /** El que canceló sigue esperando el aterrizaje si su encargo ya voló —
   *  pero cuenta como huérfano para las estadísticas y el trazado. */
  cancelled: boolean;
}

interface Encargo {
  id: string;
  world: WorldData;
  geography: HumanGeography;
  key: TileKey;
  opts: ServeTileOptions;
  estilo: string;
  /** Honda sobre canon (edits presentes) y por tanto persistible. */
  persistible: boolean;
  esperas: Espera[];
  estado: 'carga' | 'cola' | 'vuelo';
  /** El latido de la vista al que pertenece; ver `waveDe`. */
  wave: number;
  /** Todas las esperas canceladas mientras cargaba del disco: el resultado
   *  de la carga ya no tiene dueño y se descarta sin encolar. */
  muerto: boolean;
}

/** Techo de renders en vuelo = sesiones que el pool puede tener. Más sólo
 *  reconstruye la cola honda DENTRO del pool. */
const flightLimit = (): number => Math.max(1, regionClient.sessionCapacity);

/** Techo de la cola: tres planes de vista (~60 teselas cada uno). Si el
 *  lector cambia de plan más deprisa de lo que se rinde, lo MÁS VIEJO se
 *  descarta — regla renderd: la cola se queda con lo último querido y punto.
 *  Descartar es barato porque un descarte es re-pedible (el almacén de
 *  pantalla borra su memoria del nivel al recibir null). */
const QUEUE_LIMIT = 192;

const cola: Encargo[] = [];
const porId = new Map<string, Encargo>();
let enVuelo = 0;

/**
 * LA OLA: el lote de peticiones de un mismo latido de la vista. El plan
 * vigente SIEMPRE va por delante de los restos del plan anterior — sin esto,
 * la cola FIFO de la primera versión despachaba los sobrantes del nivel que
 * el lector ya dejó mientras el nivel que MIRA esperaba, y el desborde
 * descartaba por la cabeza… que era el CENTRO de la pantalla (el `want`
 * pide del centro afuera, así que lo más cercano entraba primero y moría
 * primero: las z10(488-491,308-311) renaciendo en bucle en el log de Luis
 * del 2026-08-13, con el río en el centro pixelado para siempre). Con olas:
 * se despacha la ola más NUEVA en su orden (centro afuera), y el desborde
 * se come la ola más VIEJA — exactamente las dos prioridades de renderd.
 * Una ola nueva empieza cuando entre dos peticiones pasan >8 ms (los lotes
 * de un mismo `want` llegan en el mismo tick; los latidos de la vista, a
 * fotogramas de distancia).
 */
let waveCounter = 0;
let lastAskAt = -Infinity;
function waveDe(): number {
  const now = performance.now();
  if (now - lastAskAt > 8) waveCounter++;
  lastAskAt = now;
  return waveCounter;
}

function estiloDe(opts: ServeTileOptions): string {
  const layers = Object.keys(opts.layers).sort()
    .map((k) => (opts.layers[k] ? k : `!${k}`)).join(',');
  return `${opts.ink ?? 'carta'}|${opts.themeId}|d${opts.density}|r${opts.reliefAmount}|${layers}`;
}

/**
 * La identidad de un encargo para COMPARTIR trabajo en esta sesión (la clave
 * de invalidación del disco, con ediciones relevantes por huella, vive en la
 * puerta de persistencia — aquí basta con no fabricar dos veces lo mismo).
 * Una tesela honda es contenido puro: semilla+params+ediciones+estilo. Una
 * somera se pinta del ráster editado en vivo, así que lleva la REVISIÓN del
 * objeto — compartible dentro de la sesión, jamás entre sesiones (y por eso
 * las someras tampoco se persisten: se re-pintan en milisegundos).
 * `consumeOnly` entra en la clave: una petición que genera no puede colgarse
 * de una que declina en frío.
 */
function idDe(
  world: WorldData,
  geography: HumanGeography,
  key: TileKey,
  opts: ServeTileOptions,
  estilo: string,
): string {
  const suelo = opts.edits !== undefined ? 'deep' : 'shallow';
  const co = opts.consumeOnly ? ':co' : '';
  return `${mapSourceKey(world, geography, opts.edits ?? '')}:${suelo}:${estilo}${co}`
    + `:${key.z}/${key.tx}/${key.ty}`;
}

/** Copia para el segundo consumidor: dos vistas no pueden compartir un
 *  ImageBitmap — la primera que lo cierre (desalojo LRU) dejaría a la otra
 *  dibujando un mapa en blanco. Si la copia falla (el original ya cerrado a
 *  mitad), null: re-pedible, y a la vuelta lo sirve el disco. */
async function cloneTile(tile: RenderedTile): Promise<RenderedTile | null> {
  try {
    if (typeof createImageBitmap !== 'undefined') {
      return { bitmap: await createImageBitmap(tile.bitmap as ImageBitmap), places: tile.places };
    }
  } catch { /* cae al lienzo */ }
  try {
    const w = (tile.bitmap as { width: number }).width;
    const h = (tile.bitmap as { height: number }).height;
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = (canvas as OffscreenCanvas).getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(tile.bitmap as CanvasImageSource, 0, 0);
    return { bitmap: canvas, places: tile.places };
  } catch {
    return null;
  }
}

/** Resolver todas las esperas de un encargo. La primera recibe el original;
 *  las demás, copias (asíncronas — si una copia falla, esa espera recibe
 *  null y re-pide). */
function entregar(encargo: Encargo, tile: RenderedTile | null): void {
  const esperas = encargo.esperas;
  encargo.esperas = [];
  if (!tile) {
    for (const e of esperas) e.resolve(null);
    return;
  }
  let original = false;
  for (const e of esperas) {
    if (!original) {
      original = true;
      e.resolve(tile);
    } else {
      void cloneTile(tile).then((copia) => e.resolve(copia));
    }
  }
}

/**
 * El volcado SÍNCRONO a un lienzo propio, hecho ANTES de entregar: el almacén
 * de pantalla puede desalojar (y cerrar) el bitmap en cualquier momento
 * posterior, y `convertToBlob` es asíncrono — codificar el lienzo propio en
 * vez del bitmap hace imposible la carrera «cerrado a mitad de codificar».
 */
function volcar(tile: RenderedTile): OffscreenCanvas | HTMLCanvasElement | null {
  try {
    const w = (tile.bitmap as { width: number }).width;
    const h = (tile.bitmap as { height: number }).height;
    if (!w || !h) return null;
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = (canvas as OffscreenCanvas).getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(tile.bitmap as CanvasImageSource, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}

/** Lienzo → webp. Con calidad alta: la tesela es el producto final y la
 *  letra pequeña del canon (setos, tejados) no debe empastarse. */
async function codificar(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array | null> {
  try {
    let blob: Blob | null;
    if ('convertToBlob' in canvas) {
      blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.95 });
    } else {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/webp', 0.95));
    }
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

function aterrizar(encargo: Encargo, tile: RenderedTile | null): void {
  porId.delete(encargo.id);
  enVuelo--;
  const huerfano = encargo.esperas.every((e) => e.cancelled);
  if (huerfano && tile) tileServiceStats.landedOrphan++;
  // El volcado va ANTES de entregar (ver `volcar`); la codificación y el
  // guardado, después y sin bloquear a nadie.
  const p = persistence;
  const lienzo = tile && encargo.persistible && p ? volcar(tile) : null;
  entregar(encargo, tile);
  if (lienzo && p) {
    void codificar(lienzo).then((bytes) => {
      if (!bytes) return;
      tileServiceStats.saved++;
      p.save(encargo.world, encargo.geography, encargo.key,
        encargo.opts.edits ?? '', encargo.estilo,
        bytes, tile?.places);
    });
  }
  bombear();
}

/** Despachar mientras haya hueco de vuelo y cola: primero la ola más nueva,
 *  y dentro de ella en su orden (del centro afuera). */
function bombear(): void {
  while (enVuelo < flightLimit() && cola.length) {
    // Los muertos (canceladas en cola) se barren al pasar.
    while (cola.length && cola[cola.length - 1].esperas.length === 0) cola.pop();
    if (!cola.length) break;
    const nueva = cola[cola.length - 1].wave;
    let i = cola.length - 1;
    while (i > 0 && cola[i - 1].wave === nueva) i--;
    const encargo = cola.splice(i, 1)[0];
    if (encargo.esperas.length === 0) continue; // descartado en cola
    encargo.estado = 'vuelo';
    enVuelo++;
    tileServiceStats.dispatched++;
    const req = regionClient.requestTile(encargo.world, encargo.geography, encargo.key, {
      themeId: encargo.opts.themeId,
      layers: encargo.opts.layers,
      density: encargo.opts.density,
      reliefAmount: encargo.opts.reliefAmount,
      edits: encargo.opts.edits,
      ink: encargo.opts.ink,
      consumeOnly: encargo.opts.consumeOnly,
      workerFactory: encargo.opts.workerFactory,
    });
    req.promise.then(
      (tile) => aterrizar(encargo, tile),
      () => aterrizar(encargo, null),
    );
  }
}

function encolar(encargo: Encargo): void {
  encargo.estado = 'cola';
  // INSERTADO EN ORDEN DE OLA, no al final a secas: un encargo hondo pasa
  // por la consulta al disco (asíncrona) antes de encolarse, así que uno de
  // la ola 5 puede llegar aquí DESPUÉS de que la ola 6 ya esté en cola — y
  // el despacho lee la ola nueva del final. La inserción estable lo deja
  // con los suyos: el final es siempre la ola vigente, la cabeza la más
  // vieja, y dentro de cada ola el orden del `want` (del centro afuera).
  let i = cola.length;
  while (i > 0 && cola[i - 1].wave > encargo.wave) i--;
  cola.splice(i, 0, encargo);
  // La cola se queda con lo último querido: el desborde se come la OLA MÁS
  // VIEJA (la cabeza — el plan que el lector ya dejó atrás), con respuesta
  // honesta (null = re-pedible). El plan vigente vive en la cola de atrás y
  // no se toca.
  while (cola.length > QUEUE_LIMIT) {
    const viejo = cola.shift()!;
    if (viejo.esperas.length === 0) continue;
    porId.delete(viejo.id);
    tileServiceStats.droppedQueued++;
    traceTiles('servicio', viejo.id, 'DESCARTADA (cola llena)');
    entregar(viejo, null);
  }
  bombear();
}

/**
 * Una tesela, por el embudo: disco → cola corta → pool. El contrato de vuelta
 * es el de `requestTile` — promesa + cancel — para que los tres consumidores
 * (2D, carta, 3D) cambien de interlocutor sin cambiar de forma.
 */
export function serveTile(
  world: WorldData,
  geography: HumanGeography,
  key: TileKey,
  opts: ServeTileOptions,
): { promise: Promise<RenderedTile | null>; cancel: () => void } {
  tileServiceStats.asked++;
  const estilo = estiloDe(opts);
  const id = idDe(world, geography, key, opts, estilo);

  let espera!: Espera;
  const promise = new Promise<RenderedTile | null>((resolve) => {
    espera = { resolve, cancelled: false };
  });

  const compartido = porId.get(id);
  if (compartido) {
    tileServiceStats.shared++;
    compartido.esperas.push(espera);
    return { promise, cancel: () => cancelar(compartido, espera) };
  }

  const encargo: Encargo = {
    id, world, geography, key, opts, estilo,
    persistible: opts.edits !== undefined,
    esperas: [espera],
    estado: 'carga',
    wave: waveDe(),
    muerto: false,
  };
  porId.set(id, encargo);

  const p = persistence;
  if (p && encargo.persistible) {
    p.load(world, geography, key, opts.edits ?? '', estilo).then((tile) => {
      if (encargo.muerto) {
        // Nadie la espera ya; un bitmap recién decodificado sin dueño se
        // cierra aquí o no se cierra nunca.
        (tile?.bitmap as ImageBitmap | undefined)?.close?.();
        return;
      }
      if (tile) {
        tileServiceStats.diskHits++;
        porId.delete(id);
        traceTiles('servicio', id, 'disco ✓');
        entregar(encargo, tile);
      } else {
        tileServiceStats.diskMisses++;
        encolar(encargo);
      }
    }).catch(() => {
      if (!encargo.muerto) { tileServiceStats.diskMisses++; encolar(encargo); }
    });
  } else {
    encolar(encargo);
  }

  return { promise, cancel: () => cancelar(encargo, espera) };
}

/**
 * La cancelación, con la disciplina renderd:
 *  - aún CARGANDO del disco o EN COLA → se suelta ya (null, re-pedible); si
 *    era la última espera, el encargo entero muere sin llegar al pool.
 *  - ya EN VUELO → no se toca nada: el render está pagado, aterriza, se
 *    persiste y se entrega — el almacén de pantalla, con su guarda de época,
 *    decide si el suelo aún vale. La promesa del consumidor se resuelve al
 *    aterrizar (tarde pero con la tesela), no ahora.
 */
function cancelar(encargo: Encargo, espera: Espera): void {
  if (espera.cancelled) return;
  espera.cancelled = true;
  if (encargo.estado === 'vuelo') return;
  const i = encargo.esperas.indexOf(espera);
  if (i >= 0) encargo.esperas.splice(i, 1);
  espera.resolve(null);
  if (encargo.esperas.length === 0) {
    encargo.muerto = true;
    porId.delete(encargo.id);
    if (encargo.estado === 'cola') {
      const j = cola.indexOf(encargo);
      if (j >= 0) cola.splice(j, 1);
    }
  }
}

/** SÓLO BANCOS: vaciar el estado del módulo entre casos. Los encargos en
 *  vuelo quedan a su suerte (sus aterrizajes encuentran el mapa vacío). */
export function resetTileServiceForBench(): void {
  for (const encargo of [...cola]) entregar(encargo, null);
  cola.length = 0;
  porId.clear();
  enVuelo = 0;
  for (const k of Object.keys(tileServiceStats) as (keyof typeof tileServiceStats)[]) {
    tileServiceStats[k] = 0;
  }
}
