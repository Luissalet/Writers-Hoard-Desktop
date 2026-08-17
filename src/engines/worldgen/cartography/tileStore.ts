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
//
// DOS REMATES DE §19.2 DE `INVESTIGACION-MAPAS.md` VIVEN AQUÍ:
//
//  · LA GENERACIÓN ANTERIOR NO SE TIRA, SE DEGRADA A FANTASMA. Una pincelada
//    cambia la clave de contenido y hasta hoy eso VACIABA el almacén: el
//    lector veía su trazo y, de premio, todo el suelo que estaba mirando se
//    volvía el cuarto borroso de un antepasado durante los segundos que
//    tardaba la tinta nueva. El fantasma es el MISMO suelo a la MISMA
//    resolución — sólo le falta la pincelada — así que taparlo con él y fundir
//    la tesela nueva encima (250 ms) es estrictamente mejor que el borrón. Es
//    el «stale-while-revalidate» de cualquier mapa deslizante.
//  · EN REPOSO, EL DESTINO VA A PÍXEL ENTERO. Un rect fraccionario obliga al
//    lienzo a remuestrear una tesela de 256² sobre medios píxeles: el mapa
//    quieto se ve lavado y hacía falta medio píxel de solape (`+ 0.5`) para
//    que no se abrieran costuras. Con la cámara parada se redondea, y los
//    anchos salen por DIFERENCIA de redondeos, que es lo que hace que el borde
//    derecho de una tesela y el izquierdo de la siguiente sean el mismo entero.
//
// El reposo lo detecta el propio almacén comparando el cuadro con el anterior:
// cualquier movimiento —arrastre, rueda, vuelo del localizador, cambio de
// tamaño— mueve la vista, así que el primer cuadro de una posición nueva jamás
// se redondea y todos los siguientes sí. No hace falta que ningún componente
// le cuente su gesto.

import type { CartoView } from './render';
import {
  MIN_TILE_Z, TILE_PX, tileCountX, tileCountY, tileId, tilesInView, wrapTileX,
  type TileKey,
} from './tiles';

export type TileBitmap = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

/** Lo que tarda una tesela nueva en tapar del todo a su fantasma. 250 ms es lo
 *  que pide §19.2: se nota que el suelo se refresca y no llega a leerse como
 *  un parpadeo. */
export const FADE_MS = 250;
/** El paso del re-dibujo mientras algo se funde (~60 Hz). El almacén se lo
 *  pide a sí mismo por `onArrive`: sin esto el fundido se quedaría clavado en
 *  el alfa del último cuadro que alguien dibujara por otro motivo. */
const FADE_STEP_MS = 16;
/**
 * Cuántos fantasmas se guardan. Una pantalla de 1920×1080 necesita ~40 teselas
 * por nivel; 96 cubre la vista y su nivel de respaldo con holgura, y son ~25 MB
 * frente a los ~84 MB del almacén vivo. Guardar la generación entera habría
 * DOBLADO la memoria del mapa para tapar un cuarto de segundo.
 */
const GHOST_CAPACITY = 96;
/** Y se van solos: una vista que nunca llega a cubrirse (canon frío, worker
 *  caído) no puede quedarse con 96 mapas de bits colgando para siempre. */
const GHOST_MAX_AGE_MS = 10_000;
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

/** `at` es el sello del LRU (orden de uso); `born` es reloj de pared, y son
 *  cosas distintas a propósito: el fundido mide TIEMPO y el desalojo mide
 *  ORDEN. Mezclarlos haría que mirar una tesela reiniciara su fundido. */
interface Entry { bmp: TileBitmap; at: number; born: number }
/** One unfinished request. The OBJECT is the token: only the request that owns
 *  an id may clear its marker (see `settled`). */
interface Pending { cancel: () => void }

const close = (b: TileBitmap) => {
  (b as ImageBitmap).close?.();
};

export class DisplayTileStore {
  private tiles = new Map<string, Entry>();
  /**
   * La generación ANTERIOR, viva mientras la nueva se fabrica.
   *
   * Sólo se puebla cuando el que cambia es el CONTENIDO del mismo suelo (ver
   * `setGeneration`): un planeta distinto no deja fantasma, porque enseñar el
   * mar de otro mundo bajo el continente nuevo no es «un poco viejo», es
   * mentira. Un mapa de bits que entra aquí sale de `tiles` sin cerrarse: el
   * fantasma es su ÚNICO dueño hasta que `draw` lo suelta o `dispose` lo
   * cierra.
   */
  private ghosts = new Map<string, Entry>();
  /** Cuándo se degradó la generación viva a fantasma (reloj de pared). */
  private ghostsAt = 0;
  /** Qué SUELO representa lo cacheado — el mundo, sin la revisión ni la tinta.
   *  Es lo que distingue «otra versión de esto» de «otra cosa». */
  private family = '';
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
  /** El reloj. Inyectable porque el fundido es una MEDIDA y una medida sin
   *  banco no existe: el banco le pasa un reloj falso y comprueba el alfa a
   *  los 0, 125 y 250 ms sin dormir un cuarto de segundo. */
  private now: () => number;
  /** El re-dibujo pendiente tras una ola de nulos; ver `nudge`. */
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  /** El re-dibujo pendiente mientras algo se funde; ver `pumpFade`. */
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  /** El último cuadro dibujado (nivel + vista + rect). Igual = cámara quieta. */
  private lastFrame = '';

  constructor(
    renderer: TileRenderer,
    onArrive: () => void,
    capacity = 320 /* ≈84 MB of 256² RGBA */,
    now: () => number = () => performance.now(),
  ) {
    this.renderer = renderer;
    this.onArrive = onArrive;
    this.capacity = capacity;
    this.now = now;
  }

  /**
   * @param gen  La identidad del CONTENIDO: cambia y lo cacheado deja de valer.
   * @param family La identidad del SUELO — el mismo mundo con otra tinta. Si no
   *   se pasa, vale `gen`, y entonces toda generación nueva es «otro planeta»:
   *   el comportamiento exacto de antes de que existieran los fantasmas, que es
   *   lo que deben tener los consumidores que no han optado por esto.
   */
  setGeneration(gen: string, family: string = gen): void {
    // Both consumers call this on EVERY frame, so clearing `lastAsk` before the
    // early return cleared it every frame: by the time `want` compared its ask
    // against it, it was always '' and the dedupe below could never fire. The
    // carta has no drag guard of its own — it calls `setGeneration` and then
    // `want` on every interim frame of a pan — so the whole `tilesInView` +
    // sort + Set + id-join ran per frame for the length of the gesture, which is
    // the cost the note on `lastAsk` says it prevents. It belongs INSIDE the
    // change: a new generation is when the previous ask stops meaning anything.
    if (gen === this.generation) return;
    this.lastAsk = '';
    // El primer arranque no tiene nada que degradar, y un `family` que se
    // mueve es otro planeta: en los dos casos se cierra todo, como siempre.
    const sameGround = this.generation !== '' && family === this.family;
    this.generation = gen;
    this.family = family;
    this.epoch++;
    if (sameGround) this.demote(); else this.clearTiles();
    // STOP the builds, do not merely forget them. Every one is seconds of a
    // worker drawing a country that no longer exists — queued AHEAD of the
    // tiles of the country the reader is looking at right now.
    for (const p of this.inflight.values()) p.cancel();
    this.inflight.clear();
  }

  /** Vaciar de verdad: vivos y fantasmas, cerrados y fuera. */
  private clearTiles(): void {
    for (const e of this.tiles.values()) close(e.bmp);
    this.tiles.clear();
    for (const e of this.ghosts.values()) close(e.bmp);
    this.ghosts.clear();
  }

  /**
   * La generación viva pasa a fantasma.
   *
   * Los fantasmas de ANTES sí se cierran: se guarda UNA generación anterior, no
   * una pila. Encadenar cinco pinceladas rápidas dejaría si no cinco capas de
   * suelo viejo que nadie va a mirar, y el fundido se haría siempre contra la
   * más vieja de todas. Se conservan los `GHOST_CAPACITY` más recientemente
   * usados —el LRU ya sabe cuáles estaban en pantalla— y el resto se cierra
   * aquí mismo.
   */
  private demote(): void {
    for (const e of this.ghosts.values()) close(e.bmp);
    this.ghosts.clear();
    const byUse = [...this.tiles.entries()].sort((a, b) => b[1].at - a[1].at);
    this.tiles.clear();
    for (const [id, e] of byUse) {
      if (this.ghosts.size < GHOST_CAPACITY) this.ghosts.set(id, e);
      else close(e.bmp);
    }
    this.ghostsAt = this.now();
  }

  /** Soltar los fantasmas. Un mapa de bits que sale de aquí no lo tiene nadie
   *  más, así que se cierra en el mismo gesto. */
  private dropGhosts(): void {
    if (!this.ghosts.size) return;
    for (const e of this.ghosts.values()) close(e.bmp);
    this.ghosts.clear();
  }

  get(key: TileKey): TileBitmap | null {
    return this.entry(this.tiles, key)?.bmp ?? null;
  }

  /** La entrada, refrescando su sello de LRU. `draw` necesita la ENTRADA y no
   *  sólo el mapa de bits, porque el fundido pregunta por `born`. */
  private entry(map: Map<string, Entry>, key: TileKey): Entry | null {
    const e = map.get(tileId(key));
    if (!e) return null;
    e.at = this.stamp++;
    return e;
  }

  /** The complete last plan, so an identical frame costs nothing. Both the
   *  carta and the 3D call this during gestures; deduping the whole plan avoids
   *  rebuilding coverage while still letting a consumer ask atomically for a
   *  coarse floor and a sharp level. */
  private lastAsk = '';

  want(world: { width: number; height: number }, z: number, view: CartoView): void {
    this.wantPlan(world, [{ z, view }]);
  }

  /** Replace the complete wanted set atomically. Consumers which need both a
   * coarse floor and a sharp level submit both together. */
  wantPlan(
    world: { width: number; height: number },
    levels: ReadonlyArray<{ z: number; view: CartoView }>,
  ): void {
    const wanted = new Set<string>();
    const ordered: TileKey[] = [];
    const parts: string[] = [];
    for (const { z, view } of levels) {
      const keys = tilesInView(world, z, view);
      const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
      const cells = world.width / tileCountX(z);
      keys.sort((a, b) => {
        const da = ((a.viewTx + 0.5) * cells - cx) ** 2 + ((a.ty + 0.5) * cells - cy) ** 2;
        const db = ((b.viewTx + 0.5) * cells - cx) ** 2 + ((b.ty + 0.5) * cells - cy) ** 2;
        return da - db;
      });
      const ids: string[] = [];
      for (const key of keys) {
        const id = tileId(key);
        ids.push(id);
        if (wanted.has(id)) continue;
        wanted.add(id);
        ordered.push(key);
      }
      parts.push(`${z}:${ids.join(',')}`);
    }
    const ask = `${this.generation}|${parts.join('|')}`;
    if (ask === this.lastAsk) return;
    this.lastAsk = ask;

    // Resident parents stay in the LRU as fallback. Only obsolete unfinished
    // work is cancelled, across every level crossed by the camera.
    for (const [id, pending] of this.inflight) {
      if (wanted.has(id)) continue;
      this.inflight.delete(id);
      pending.cancel();
    }
    for (const key of ordered) this.fetch(key);
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
        this.lastAsk = '';
        this.nudge();
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
      this.tiles.set(id, { bmp, at: this.stamp++, born: this.now() });
      this.evict();
      // Una llegada REAL devuelve el empujón a su paso corto (ver `nudge`).
      this.nudgeDelayMs = 400;
      this.onArrive();
    }).catch(() => {
      this.settled(id, pending);
      // El mismo hueco por la vía del rechazo (una cancelación que asienta
      // tarde): re-pedible, no eterno — y con el mismo empujón.
      this.lastAsk = '';
      this.nudge();
    });
  }

  /**
   * UNA OLA DE NULOS TIENE QUE VOLVER A PEDIRSE SOLA. Un nulo borra la
   * memoria del plan (`lastAsk`) para que el siguiente `want` re-pida — pero
   * el siguiente `want` sólo corre cuando algo DIBUJA, y con la cámara quieta
   * sólo dibuja `onArrive`… que un nulo no dispara. Si el plan entero se
   * resuelve en nulos (la cola del servicio descartó una ola completa), no
   * queda ninguna llegada que despierte el bucle: el 0/60 clavado con
   * EN VUELO 0 de la captura de Luis (2026-08-13) — el mapa congelado en
   * borroso para siempre sobre una vista perfectamente sana. Este empujón
   * coalescido convierte el nulo en lo que siempre debió ser: «ahora no —
   * vuelve a preguntar en nada». Los 400 ms le dan a la cola tiempo de
   * drenar algo antes del re-pedido, para no girar en seco.
   */
  /** Retraso vigente del empujón. CON RETROCESO: cada empujón sin llegada
   *  real lo multiplica (×1,7 hasta 6 s) y cualquier tesela que SÍ llega lo
   *  devuelve a 400 ms. Sin esto, el 3D sobre canon frío era un bucle de
   *  sondeo eterno — pedir → declinar en µs → null → empujón a los 400 ms →
   *  pedir… (las 432 declinadas del tercer parte de Luis, 2026-08-14). */
  private nudgeDelayMs = 400;

  private nudge(): void {
    if (this.nudgeTimer !== null || this.disposed) return;
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = null;
      if (!this.disposed) this.onArrive();
    }, this.nudgeDelayMs);
    this.nudgeDelayMs = Math.min(6_000, Math.round(this.nudgeDelayMs * 1.7));
  }

  /**
   * EL FUNDIDO SE TIENE QUE PEDIR SUS PROPIOS CUADROS.
   *
   * El alfa es una función del tiempo, pero `draw` sólo corre cuando el
   * componente decide pintar — y con la cámara quieta y todas las teselas ya
   * llegadas no hay ningún motivo para pintar. Sin este empujón el fundido se
   * quedaba congelado en el alfa del último cuadro que alguien dibujara por
   * otro motivo: mitad tesela vieja, mitad nueva, para siempre. Coalescido, y
   * se apaga solo en cuanto ninguna tesela está a medio fundir.
   */
  private pumpFade(): void {
    if (this.fadeTimer !== null || this.disposed) return;
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null;
      if (!this.disposed) this.onArrive();
    }, FADE_STEP_MS);
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
    const now = this.now();
    const pxPerCell = screen.w / view.w;
    const keys = tilesInView(world, z, view);
    /**
     * ¿ESTÁ QUIETA LA CÁMARA? Lo dice el cuadro anterior, y lo dice para
     * CUALQUIER movimiento —arrastre, rueda, vuelo del localizador, cambio de
     * tamaño de la ventana—, que es más de lo que ningún componente sabe contar
     * de sí mismo (`dragRef` no ve la rueda, la rueda no ve el vuelo). El
     * PRIMER cuadro de una posición nueva se dibuja como siempre: redondear
     * mientras la vista se mueve hace que cada tesela cambie de ancho un píxel
     * por su cuenta y el mosaico hierve. Del segundo cuadro en adelante, a
     * píxel entero — y siempre hay un segundo, porque cada tesela que llega
     * repinta y el fundido se pide sus propios cuadros.
     */
    const frame = `${z}|${view.x},${view.y},${view.w},${view.h}`
      + `|${screen.x},${screen.y},${screen.w},${screen.h}`;
    const atRest = frame === this.lastFrame;
    this.lastFrame = frame;
    /** Cuántas teselas están a medio tapar a su fantasma ahora mismo. */
    let fading = 0;
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
      /**
       * El destino. En reposo, a PÍXEL ENTERO — y el ancho por DIFERENCIA DE
       * BORDES, jamás `round(ancho)`.
       *
       * El borde derecho de esta tesela se calcula con la MISMA expresión que
       * el izquierdo de la siguiente, cambiando sólo el índice entero: mismo
       * número en coma flotante, mismo redondeo, mismo píxel. Por eso no queda
       * costura y sobra el medio píxel de solape que había —y que se pagaba
       * remuestreando los 256² de cada tesela sobre medios píxeles, que es
       * exactamente por qué el mapa quieto se veía lavado—. Redondear el ANCHO
       * en vez de los bordes no vale: dos vecinas redondean su ancho por
       * separado y la suma se desalinea a la tercera tesela.
       */
      const nx = screen.x + ((key.viewTx + 1) * cells - view.x) * pxPerCell;
      const ny = screen.y + ((key.ty + 1) * cells - view.y) * pxPerCell;
      const dx = atRest ? Math.round(sx) : sx;
      const dy = atRest ? Math.round(sy) : sy;
      const dw = atRest ? Math.round(nx) - dx : sw + 0.5;
      const dh = atRest ? Math.round(ny) - dy : sw + 0.5;

      const own = this.entry(this.tiles, key);
      const ghost = this.entry(this.ghosts, key);
      if (own) {
        // El fundido sólo existe si hay algo debajo que fundir: una tesela que
        // llega a suelo virgen entra opaca, exactamente como antes.
        const t = ghost ? Math.min(1, Math.max(0, (now - own.born) / FADE_MS)) : 1;
        if (ghost && t < 1) {
          ctx.drawImage(ghost.bmp as CanvasImageSource, dx, dy, dw, dh);
          const alpha = ctx.globalAlpha;
          ctx.globalAlpha = alpha * t;
          ctx.drawImage(own.bmp as CanvasImageSource, dx, dy, dw, dh);
          ctx.globalAlpha = alpha;
          fading++;
        } else {
          ctx.drawImage(own.bmp as CanvasImageSource, dx, dy, dw, dh);
        }
        sharp.add(id);
        continue;
      }
      if (ghost) {
        // LA TESELA ANTERIOR, MIENTRAS LLEGA LA NUEVA: mismo suelo, misma
        // resolución, sólo le falta la pincelada. No cuenta como exacta —el
        // aviso de «N de M» sigue diciendo la verdad y el nivel se sigue
        // re-pidiendo—, pero tapa el borrón, que es de lo que iba esto.
        ctx.drawImage(ghost.bmp as CanvasImageSource, dx, dy, dw, dh);
        continue;
      }
      // Walk up: an ancestor's quarter, scaled. Blurry beats blank. Primero
      // entre los vivos; después entre los fantasmas, porque un antepasado con
      // la tinta de hace un segundo sigue ganándole al papel desnudo.
      const anc = this.ancestorQuarter(this.tiles, key)
        ?? this.ancestorQuarter(this.ghosts, key);
      if (anc) {
        ctx.drawImage(
          anc.bmp as CanvasImageSource, anc.ox, anc.oy, anc.frac, anc.frac,
          dx, dy, dw, dh,
        );
      }
    }
    ctx.imageSmoothingEnabled = smoothing;
    /**
     * LOS FANTASMAS SE SUELTAN SOLOS. En cuanto la generación nueva cubre todo
     * lo que se ve y no queda nada a medio fundir ya no tapan nada, y retenerlos
     * son ~25 MB de mapas de bits que nadie va a dibujar jamás. Y si la vista
     * NUNCA llega a cubrirse —canon frío, un obrero caído, un nivel que el
     * mundo no soporta—, el plazo los suelta igual: un fantasma eterno es una
     * fuga con buena excusa.
     */
    if (this.ghosts.size
      && ((fading === 0 && sharp.size >= needed.size)
        || now - this.ghostsAt > GHOST_MAX_AGE_MS)) {
      this.dropGhosts();
    }
    if (fading > 0) this.pumpFade();
    return { needed: needed.size, exact: sharp.size };
  }

  /** El cuarto del antepasado residente más cercano en `map`, ya escalado.
   *  Sacado del bucle de `draw` porque ahora se recorre dos veces: los vivos
   *  primero y los fantasmas después. */
  private ancestorQuarter(
    map: Map<string, Entry>, key: TileKey,
  ): { bmp: TileBitmap; ox: number; oy: number; frac: number } | null {
    if (!map.size) return null;
    let az = key.z - 1, atx = key.tx, aty = key.ty;
    while (az >= MIN_TILE_Z) {
      atx = Math.floor(atx / 2); aty = Math.floor(aty / 2);
      const anc = this.entry(
        map, { z: az, tx: wrapTileX(az, atx), ty: Math.min(tileCountY(az) - 1, aty) });
      if (anc) {
        const scale = 1 << (key.z - az);
        const frac = TILE_PX / scale;
        return {
          bmp: anc.bmp,
          ox: (key.tx - atx * scale) * frac,
          oy: (key.ty - aty * scale) * frac,
          frac,
        };
      }
      az--;
    }
    return null;
  }

  dispose(): void {
    this.lastAsk = '';
    this.lastFrame = '';
    this.disposed = true;
    if (this.nudgeTimer !== null) { clearTimeout(this.nudgeTimer); this.nudgeTimer = null; }
    // El temporizador del fundido también: un `onArrive` de un componente ya
    // desmontado es el mismo fallo que el empujón, con otro nombre.
    if (this.fadeTimer !== null) { clearTimeout(this.fadeTimer); this.fadeTimer = null; }
    this.epoch++;
    this.clearTiles();
    // The component is gone; nothing will ever draw these. Cancelling is the
    // difference between a closed view releasing the pool and a closed view
    // holding a worker busy for the next minute.
    for (const p of this.inflight.values()) p.cancel();
    this.inflight.clear();
  }
}
