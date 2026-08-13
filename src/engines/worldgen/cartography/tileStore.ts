// ============================================
// Cartography — display tile store + compositor
// ============================================
// The renderer-side half of the slippy carta. Owns the cache of finished
// tiles, the in-flight dedup — and its CANCELLATION, because a tile the reader
// has panned off is not merely unwanted, it is work the pool would otherwise
// do BEFORE the tile they stopped on — and ONE drawing routine that composes
// whatever is resident RIGHT NOW: exact tiles where they exist, an ancestor's
// scaled quarter where they do not, and nothing that ever blocks the gesture. The
// component calls `draw` every interim frame and `want` when the view
// settles; tiles arriving later fire `onArrive`, which the component uses to
// repaint the interim once more. That loop IS the Google-Maps feel:
// blurry-then-sharp, and the thread the reader's hand lives on never waits.

import type { CartoView } from './render';
import {
  MIN_TILE_Z, TILE_PX, tileCountX, tileCountY, tileId, tilesInView, wrapTileX,
  type TileKey,
} from './tiles';

export type TileBitmap = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
/** A build in progress, and the handle that stops it. */
export interface TileRequest {
  promise: Promise<TileBitmap | null>;
  cancel: () => void;
}
/**
 * What the consumer hands back for one tile.
 *
 * Either shape: a bare promise (what this store was born with) or that promise
 * WITH its cancel handle. The union is not indecision — it is what lets the
 * store stop work it no longer wants without every caller having to change on
 * the same day, and a loader that genuinely cannot be interrupted (a canvas
 * drawn inline, a harness) has nothing to lie about.
 */
export type TileRenderer = (key: TileKey) => Promise<TileBitmap | null> | TileRequest;

interface Entry { bmp: TileBitmap; at: number }
/** One unfinished request. The OBJECT is the token: only the request that owns
 *  an id may clear its marker (see `settled`). */
interface Pending { cancel: () => void }

const close = (b: TileBitmap) => {
  (b as ImageBitmap).close?.();
};

export class DisplayTileStore {
  private tiles = new Map<string, Entry>();
  private inflight = new Map<string, Pending>();
  private stamp = 1;
  /** Everything cached is for THIS generation of the world/theme; bumping the
   *  generation empties the store (a painted stroke is a different country). */
  private generation = '';
  /** Monotonic with `generation`, and bumped once more by `dispose`. A request
   *  captures it when it starts and re-checks it when it lands, which the
   *  generation STRING could not do: two generations can share a string (the
   *  reader undoes a stroke), and a disposed store has no string of its own. */
  private epoch = 0;
  /** The component is gone. Nothing may enter the store after this: the maps
   *  are cleared, so a bitmap arriving later would be one nobody ever closes. */
  private disposed = false;

  // Explicit fields, not constructor parameter properties: the project builds
  // with `erasableSyntaxOnly`.
  private renderer: TileRenderer;
  private onArrive: () => void;
  private capacity: number;

  constructor(renderer: TileRenderer, onArrive: () => void, capacity = 320 /* ≈84 MB of 256² RGBA */) {
    this.renderer = renderer;
    this.onArrive = onArrive;
    this.capacity = capacity;
  }

  setGeneration(gen: string): void {
    // Both consumers call this on EVERY frame, so clearing `lastAsk` before the
    // early return cleared it every frame: by the time `want` compared its ask
    // against it, it was always '' and the dedupe below could never fire. The
    // carta has no drag guard of its own — it calls `setGeneration` and then
    // `want` on every interim frame of a pan — so the whole `tilesInView` +
    // sort + Set + id-join ran per frame for the length of the gesture, which is
    // the cost the note on `lastAsk` says it prevents. It belongs INSIDE the
    // change: a new generation is when the previous ask stops meaning anything.
    if (gen === this.generation) return;
    this.lastAsk.clear();
    this.generation = gen;
    this.epoch++;
    for (const e of this.tiles.values()) close(e.bmp);
    this.tiles.clear();
    // STOP the builds, do not merely forget them. Every one is seconds of a
    // worker drawing a country that no longer exists — queued AHEAD of the
    // tiles of the country the reader is looking at right now.
    for (const p of this.inflight.values()) p.cancel();
    this.inflight.clear();
  }

  get(key: TileKey): TileBitmap | null {
    const e = this.tiles.get(tileId(key));
    if (!e) return null;
    e.at = this.stamp++;
    return e.bmp;
  }

  /** Ask for every tile of the view at level z, nearest the centre first. */
  /** The last set of tiles asked for, so an identical ask costs nothing. The
   *  carta calls `want` once per interim FRAME of a gesture, and now that a
   *  `want` cancels what fell out of the window, an unchanged repeat would
   *  cancel-and-refetch the same tiles for the length of the pan.
   *  POR NIVEL desde que el 3D pide dos niveles por fotograma (el del plan y
   *  el suelo somero de respaldo): con una sola cadena, cada llamada pisaba a
   *  la otra y la dedupe no disparaba nunca — el coste por fotograma que esta
   *  nota existe para impedir. */
  private lastAsk = new Map<number, string>();

  want(world: { width: number; height: number }, z: number, view: CartoView): void {
    const keys = tilesInView(world, z, view);
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    const cells = world.width / tileCountX(z);
    keys.sort((a, b) => {
      // Distance from the UNWRAPPED column. The wrapped one puts a tile a whole
      // world away whenever the view straddles the seam, so "nearest first"
      // asked for the far edge before the middle of the screen.
      const da = ((a.viewTx + 0.5) * cells - cx) ** 2 + ((a.ty + 0.5) * cells - cy) ** 2;
      const db = ((b.viewTx + 0.5) * cells - cx) ** 2 + ((b.ty + 0.5) * cells - cy) ** 2;
      return da - db;
    });
    // Drop what the reader has moved OFF before asking for what they moved
    // onto. A one-second pan at deep zoom crosses ~30 tiles, each a real canon
    // build of seconds and tens of MB, and the pool serves them in order — so
    // without this the tile under the reader's eyes when they stop waits behind
    // every tile they merely flew over.
    //
    // ONLY AT THIS LEVEL, though. `inflight` is keyed across every level, and
    // cancelling the others kills exactly the tiles `draw` falls back on: its
    // "walk up, an ancestor's quarter, blurry beats blank" loop needs the
    // parents. Wheeling from z9 to z14 cancelled z9…z13 on the way down, so the
    // gesture ended on the bare 39 km raster instead of on a progressively
    // sharper blur. Parents finish; only siblings the reader flew past go.
    const wanted = new Set<string>();
    for (const key of keys) wanted.add(tileId(key));
    const ask = `${this.generation}|${z}|${[...wanted].join()}`;
    if (ask === this.lastAsk.get(z)) return;
    this.lastAsk.set(z, ask);
    const levelPrefix = `${z}/`;
    for (const [id, pending] of this.inflight) {
      if (wanted.has(id) || !id.startsWith(levelPrefix)) continue;
      this.inflight.delete(id);
      pending.cancel();
    }
    for (const key of keys) this.fetch(key);
  }

  private fetch(key: TileKey): void {
    const id = tileId(key);
    if (this.tiles.has(id) || this.inflight.has(id)) return;
    const epoch = this.epoch;
    const handle = this.renderer(key);
    // A loader that hands back a bare promise cannot be stopped; it still gets
    // a marker, so the id is deduped now and re-askable when it lands.
    const request: TileRequest = 'promise' in handle
      ? handle
      : { promise: handle, cancel: () => undefined };
    const pending: Pending = { cancel: request.cancel };
    this.inflight.set(id, pending);
    request.promise.then((bmp) => {
      this.settled(id, pending);
      if (!bmp) {
        // UN HUECO RE-PEDIBLE, TAMBIÉN CON LA CÁMARA QUIETA. Una tesela que
        // se resuelve vacía (caducada, cancelada, worker caído, fabricación
        // fallida) soltaba su marcador y nada más — y el `want` siguiente,
        // con la vista clavada, devolvía el mismo `ask` y se iba por la
        // guarda sin re-pedir nada: el cuadrado borroso eterno sobre mapa
        // quieto que el banco de retención retrató (60 nacimientos justos y
        // un plan 0/60 durante cuatro minutos de reposo). El comentario de
        // Map2D («Drop the guard so the NEXT frame asks again») siempre
        // contó con que este almacén re-pediría; borrar la memoria del nivel
        // es lo que lo hace verdad. Cuesta re-recorrer un `want` — los
        // residentes y los volando se saltan solos.
        this.lastAsk.delete(key.z);
        return;
      }
      // A stale country, or a store the component has already torn down:
      // `dispose` empties the maps but cannot un-start the builds behind them,
      // and a bitmap that lands afterwards is one nobody will ever close.
      if (this.disposed || epoch !== this.epoch) { close(bmp); return; }
      // Two builds of the same ground CAN both land — a cancel is best effort,
      // and a loader is free not to honour it. Overwriting the entry leaked
      // the bitmap it replaced.
      const prior = this.tiles.get(id);
      if (prior && prior.bmp !== bmp) close(prior.bmp);
      this.tiles.set(id, { bmp, at: this.stamp++ });
      this.evict();
      this.onArrive();
    }).catch(() => {
      this.settled(id, pending);
      // El mismo hueco por la vía del rechazo (una cancelación que asienta
      // tarde): re-pedible, no eterno.
      this.lastAsk.delete(key.z);
    });
  }

  /**
   * Clear the in-flight marker — but only if this request still OWNS it.
   *
   * Deleting blindly erases somebody else's marker, and the store then fetches
   * that tile a THIRD time. Two ways it happens, both routine: `setGeneration`
   * empties the map while old requests are still running, so a promise from
   * the world-as-it-was lands and deletes the new generation's marker for the
   * same id; and a cancelled request settles late (its rejection is a
   * microtask, the pan that cancelled it is not), by which time `want` may
   * have asked for that ground again.
   */
  private settled(id: string, pending: Pending): void {
    if (this.inflight.get(id) === pending) this.inflight.delete(id);
  }

  private evict(): void {
    while (this.tiles.size > this.capacity) {
      let oldest: string | null = null;
      let at = Infinity;
      for (const [id, e] of this.tiles) if (e.at < at) { at = e.at; oldest = id; }
      if (!oldest) return;
      const e = this.tiles.get(oldest);
      if (e) close(e.bmp);
      this.tiles.delete(oldest);
    }
  }

  /**
   * Compose the view at level z onto a screen rect. For each needed tile:
   * the tile itself, else the nearest resident ANCESTOR's quarter scaled up
   * (never a child — four fetches to fill one tile is the wrong trade mid-
   * gesture). Returns how many of the needed tiles were exact, so the caller
   * knows whether a settle render is still worth scheduling.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    world: { width: number; height: number },
    z: number,
    view: CartoView,
    screen: { x: number; y: number; w: number; h: number },
  ): { needed: number; exact: number } {
    const pxPerCell = screen.w / view.w;
    const keys = tilesInView(world, z, view);
    // Counted by GROUND, not by occurrence. A view wider than the world shows
    // its two seam columns twice, and counting both told the reader they were
    // waiting on 40 tiles when 32 was the whole of it.
    const needed = new Set<string>();
    const sharp = new Set<string>();
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const key of keys) {
      const id = tileId(key);
      needed.add(id);
      const cells = world.width / tileCountX(key.z);
      // Screen placement of this OCCURRENCE, from the unwrapped column.
      //
      // This used to search for the wrapped branch nearest the centre of the
      // view, because the wrapped index was all `tilesInView` returned and the
      // branch had to be guessed back. The search finds exactly the value
      // below while the view plus a tile still fits inside the world, and
      // cannot find it once the view is wider — the DEFAULT fitted view, since
      // `fit()` sizes the map to 98 % of the canvas — because there the same
      // ground is on screen twice and half a world is the very tie it breaks:
      // each edge column came out a full width away, drawn on top of its own
      // twin, leaving ~14 px of coarse raster at the edge it had vacated.
      const gx = key.viewTx * cells;
      const sx = screen.x + (gx - view.x) * pxPerCell;
      const sy = screen.y + (key.ty * cells - view.y) * pxPerCell;
      const sw = cells * pxPerCell;

      const own = this.get(key);
      if (own) {
        ctx.drawImage(own as CanvasImageSource, sx, sy, sw + 0.5, sw + 0.5);
        sharp.add(id);
        continue;
      }
      // Walk up: an ancestor's quarter, scaled. Blurry beats blank.
      let az = key.z - 1, atx = key.tx, aty = key.ty;
      let found = false;
      while (az >= MIN_TILE_Z) {
        atx = Math.floor(atx / 2); aty = Math.floor(aty / 2);
        const anc = this.get({ z: az, tx: wrapTileX(az, atx), ty: Math.min(tileCountY(az) - 1, aty) });
        if (anc) {
          const scale = 1 << (key.z - az);
          const frac = TILE_PX / scale;
          const ox = (key.tx - atx * scale) * frac;
          const oy = (key.ty - aty * scale) * frac;
          ctx.drawImage(anc as CanvasImageSource, ox, oy, frac, frac, sx, sy, sw + 0.5, sw + 0.5);
          found = true;
          break;
        }
        az--;
      }
      void found;
    }
    ctx.imageSmoothingEnabled = smoothing;
    return { needed: needed.size, exact: sharp.size };
  }

  dispose(): void {
    this.lastAsk.clear();
    this.disposed = true;
    this.epoch++;
    for (const e of this.tiles.values()) close(e.bmp);
    this.tiles.clear();
    // The component is gone; nothing will ever draw these. Cancelling is the
    // difference between a closed view releasing the pool and a closed view
    // holding a worker busy for the next minute.
    for (const p of this.inflight.values()) p.cancel();
    this.inflight.clear();
  }
}
