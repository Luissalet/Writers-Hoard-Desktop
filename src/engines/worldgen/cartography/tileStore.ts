// ============================================
// Cartography — display tile store + compositor
// ============================================
// The renderer-side half of the slippy carta. Owns the cache of finished
// tiles, the in-flight dedup, and ONE drawing routine that composes whatever
// is resident RIGHT NOW: exact tiles where they exist, an ancestor's scaled
// quarter where they do not, and nothing that ever blocks the gesture. The
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
export type TileRenderer = (key: TileKey) => Promise<TileBitmap | null>;

interface Entry { bmp: TileBitmap; at: number }

const close = (b: TileBitmap) => {
  (b as ImageBitmap).close?.();
};

export class DisplayTileStore {
  private tiles = new Map<string, Entry>();
  private inflight = new Set<string>();
  private stamp = 1;
  /** Everything cached is for THIS generation of the world/theme; bumping the
   *  generation empties the store (a painted stroke is a different country). */
  private generation = '';

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
    if (gen === this.generation) return;
    this.generation = gen;
    for (const e of this.tiles.values()) close(e.bmp);
    this.tiles.clear();
    this.inflight.clear();
  }

  get(key: TileKey): TileBitmap | null {
    const e = this.tiles.get(tileId(key));
    if (!e) return null;
    e.at = this.stamp++;
    return e.bmp;
  }

  /** Ask for every tile of the view at level z, nearest the centre first. */
  want(world: { width: number; height: number }, z: number, view: CartoView): void {
    const keys = tilesInView(world, z, view);
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    const cells = world.width / tileCountX(z);
    keys.sort((a, b) => {
      const da = ((a.tx + 0.5) * cells - cx) ** 2 + ((a.ty + 0.5) * cells - cy) ** 2;
      const db = ((b.tx + 0.5) * cells - cx) ** 2 + ((b.ty + 0.5) * cells - cy) ** 2;
      return da - db;
    });
    for (const key of keys) this.fetch(key);
  }

  private fetch(key: TileKey): void {
    const id = tileId(key);
    if (this.tiles.has(id) || this.inflight.has(id)) return;
    this.inflight.add(id);
    const gen = this.generation;
    this.renderer(key).then((bmp) => {
      this.inflight.delete(id);
      if (!bmp) return;
      if (gen !== this.generation) { close(bmp); return; } // stale country
      this.tiles.set(id, { bmp, at: this.stamp++ });
      this.evict();
      this.onArrive();
    }).catch(() => {
      this.inflight.delete(id);
    });
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
    let exact = 0;
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const key of keys) {
      const cells = world.width / tileCountX(key.z);
      // Screen placement of this tile: nearest wrapped branch to the view.
      let gx = key.tx * cells;
      while (gx - view.x > world.width / 2) gx -= world.width;
      while (gx - view.x < -world.width / 2) gx += world.width;
      const sx = screen.x + (gx - view.x) * pxPerCell;
      const sy = screen.y + (key.ty * cells - view.y) * pxPerCell;
      const sw = cells * pxPerCell;

      const own = this.get(key);
      if (own) {
        ctx.drawImage(own as CanvasImageSource, sx, sy, sw + 0.5, sw + 0.5);
        exact++;
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
    return { needed: keys.length, exact };
  }

  dispose(): void {
    for (const e of this.tiles.values()) close(e.bmp);
    this.tiles.clear();
    this.inflight.clear();
  }
}
