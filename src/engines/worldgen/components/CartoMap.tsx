import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorldData } from '../core/types';
import type { WorldViewport } from '../types';
import type { HumanGeography, Settlement } from '../core/settlements';
import { renderCartoCanvas, pickSettlement } from '../cartography/texture';
import type { CartoLayers, CartoView } from '../cartography/render';
import type { CartoTheme } from '../cartography/theme';
import { CartoBaseGL } from '../cartography/glbase';
import { computeFields, getTintFieldFor } from '../cartography/render';
import { drawAnnotations, type CartoAnnotations } from '../cartography/annotations';
import { LabelSpace, drawOverlay } from '../cartography/overlay';
import { drawArrivalMark } from '../cartography/screenFurniture';
import {
  cartaViewToViewport, viewportToCartaCamera, clampViewport, sameViewport,
  flightAt, FLIGHT_MS, type FlyMark,
  type FlyTarget,
} from '../core/camera';
import { DisplayTileStore } from '../cartography/tileStore';
import { levelFor, MAX_TILE_Z, MAX_WORLD_TILE_Z, TILE_PX } from '../cartography/tiles';
import { DEEP_TILE_Z, type TilePlace } from '../region/deepTile';
import { serveTile } from '../region/tileService';
import { worldFamilyKey } from '../region/contentIdentity';
import { declutterLabels } from '../core/semanticZoom';

/**
 * Pan/zoom viewer for the hand-drawn cartographic map.
 *
 * A full cartographic render costs a few hundred milliseconds, so it cannot run
 * per frame. Three things keep the gesture smooth:
 *
 *   1. REACT IS OUT OF THE HOT PATH. The live view lives in a ref, not in state.
 *      Pointer and wheel events mutate the ref and request one animation frame;
 *      state is only committed once the gesture settles. Calling setState per
 *      wheel tick re-runs the component, its memos and its effects dozens of
 *      times a second, and that alone made the view feel broken.
 *   2. THE GESTURE PAINTS A TRANSFORM, not a render. The last finished bitmap is
 *      blitted at the new offset and scale — the map slides and stretches
 *      instantly, slightly soft, and is replaced by the real thing a moment
 *      later. This is what a slippy map does with tiles, minus the tiles.
 *   3. THE REAL RENDER IS PROGRESSIVE. On settle it draws at reduced resolution
 *      first (roughly a third of the pixels, so roughly a third of the cost) and
 *      only goes to full resolution once the reader has actually stopped.
 */

interface CartoMapProps {
  world: WorldData;
  theme: CartoTheme;
  geography?: HumanGeography;
  /**
   * The PRISTINE world + serialized strokes, for the deep tile levels
   * (z ≥ DEEP_TILE_Z): canon generation re-applies the strokes at 152 m
   * resolution, so handing it the already-edited raster would apply them
   * twice. Absent → the camera stops at the world raster's honest depth.
   */
  canonWorld?: WorldData;
  canonEdits?: string;
  layers: Partial<CartoLayers>;
  density: number;
  reliefAmount: number;
  title?: string;
  subtitle?: string;
  onPickSettlement?: (s: Settlement) => void;
  /** Double-click anywhere: descend a league toward that ground. The parent
   *  owns the flight — same gesture, same meaning, in every view. */
  onZoomTo?: (x: number, y: number) => void;
  /**
   * The shared camera. When present the carta LOOKS WHERE THE OTHER VIEWS LOOK:
   * it adopts the viewport on mount and whenever the parent moves it, and
   * reports its own gestures back, so switching views never loses the place.
   */
  viewport?: WorldViewport;
  onViewportChange?: (viewport: WorldViewport) => void;
  /** One-shot animated flight request (double-click, "volar aquí"). */
  flyTarget?: FlyTarget | null;
  /**
   * La chincheta de llegada del localizador, en celdas de mundo.
   *
   * La carta era la única de las tres vistas que se quedaba muda: el
   * localizador vuela en las tres —ése es su contrato— y aterrizar sin marca
   * en la vista que MÁS se parece a un mapa de verdad era donde peor sentaba.
   */
  flyMark?: FlyMark | null;
  /**
   * A plain click, in world coordinates, when the caller wants to inspect the
   * ground rather than open a town. Takes priority over `onPickSettlement`, so
   * the index can pick a sea or a mountain range and not only a dot.
   */
  onInspect?: (x: number, y: number) => void;
  /**
   * Annotations drawn on the ink layer above the map: a planned route, the
   * ancient coastline, the journey's two ends.
   *
   * They live on the ink canvas rather than in the cartographic render because
   * they change for reasons the map does not — dragging a sea-level slider must
   * not cost a full re-render of the sheet — and because they are the reader's
   * marks on the map, not part of it.
   */
  annotations?: CartoAnnotations;
  onViewChange?: (view: CartoView) => void;
}

/*
 * There is deliberately no brush here.
 *
 * The carta used to accept strokes, and it was wrong twice over. It is a
 * FINISHED DRAWING: what you see is symbols placed by a blue-noise pass over
 * quantiles of local relief, so the mountain you are pointing at is not where
 * the mountain is, it is where a picture of a mountain fitted. Painting on it
 * meant aiming at the drawing and hitting the data somewhere else. And the map
 * you edit should be the one that shows you what is actually there — the
 * satellite raster and the 3D world — with the carta as the thing you make
 * afterwards from a world you are happy with. So the brush lives in those two
 * and only in those two.
 */

const MIN_ZOOM = 1;
/** Zoom cap when only the world raster backs the tiles (the classic depth). */
const MAX_ZOOM_WORLD = 22;
/**
 * Half a second of stillness before anything re-renders.
 *
 * Short delays meant a wheel gesture kicked off a render between every click of
 * the wheel, and each one blocked the main thread mid-gesture: the stutter was
 * not the render being slow, it was the render happening AT ALL while the reader
 * was still moving. Nothing redraws until the view has been still for this long.
 */
const QUICK_MS = 500;
/** Delay before the full-resolution pass. Longer: only when really idle. */
const FULL_MS = 620;
/** Resolution factor for the quick pass. */
const QUICK_SCALE = 0.58;

interface LiveView { zoom: number; cu: number; cv: number }

export default function CartoMap({
  world, theme, geography, layers, density, reliefAmount, title, subtitle,
  onPickSettlement, onZoomTo, onInspect, onViewChange, annotations,
  viewport, onViewportChange, flyTarget, flyMark = null, canonWorld, canonEdits,
}: CartoMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [zoomLabel, setZoomLabel] = useState(1);

  // The live view. Never in state: see (1) above.
  const live = useRef<LiveView>({ zoom: 1, cu: 0.5, cv: 0.5 });
  // What the last finished render covered, for the interim transform.
  const base = useRef<{ canvas: HTMLCanvasElement; view: CartoView; full: boolean } | null>(null);
  const rafRef = useRef(0);
  const interimFallback = useRef(0);
  const quickTimer = useRef(0);
  const fullTimer = useRef(0);
  const rendering = useRef(false);
  /**
   * A render requested while another is still executing. Without this stash the
   * full-resolution pass died silently almost every gesture: it fires 120 ms
   * after the quick pass, the quick pass is still inside its rAF, the guard
   * returned — and nothing ever rescheduled, so the sheet sat at 0.58× until the
   * next prop change. Last writer wins; a new gesture clears it (scheduleRender)
   * because its own fresh timers supersede anything stale.
   */
  const pendingRender = useRef<{ factor: number; full: boolean } | null>(null);
  const renderRef = useRef<((factor: number, full: boolean) => void) | null>(null);
  // The GPU base pass. Created lazily, kept for the life of the world, and simply
  // absent when WebGL2 is unavailable — in which case the renderer falls back to
  // its CPU pixel loop and nothing else changes.
  const glBase = useRef<CartoBaseGL | null>(null);
  const glCanvas = useRef<HTMLCanvasElement | null>(null);
  const glFailed = useRef(false);
  const drag = useRef<{ x: number; y: number; cu: number; cv: number; moved: boolean } | null>(null);
  /** The viewport this component last told the parent about — incoming props
   *  that merely echo it must not snap the camera mid-gesture. */
  const lastReported = useRef<WorldViewport | null>(null);
  /** Trailing debounce for those reports. React stays OUT of the gesture loop
   *  (see the design notes at the top of this file): the parent hears about the
   *  camera once per settled moment, not once per wheel tick. */
  const reportTimer = useRef(0);
  /** An in-progress double-click / fly-here animation. */
  const flight = useRef<number>(0);
  /**
   * A render of the WHOLE WORLD, kept as the source for every interim frame.
   *
   * This is the reader's design and it is the right one. Blitting the last
   * viewport render cannot cover area that render never saw, so zooming out
   * always exposed bare paper at the edges — and no amount of tuning fixes that,
   * because the pixels do not exist. A whole-world bitmap covers every possible
   * view by construction: there is no such thing as an uncovered edge.
   */
  const globalMap = useRef<{ canvas: HTMLCanvasElement; rev: number; theme: string } | null>(null);
  /**
   * The slippy layer: sharp ground tiles composed OVER the whole-world blit
   * during gestures. The blit guarantees coverage (its whole design point);
   * the tiles replace its cell-sized pixels with real drawn map wherever one
   * is resident, an ancestor's quarter where not — so a gesture degrades to
   * blurry-then-sharp instead of to mush. Labels and furniture stay out of
   * tiles; they return with the settled render, exactly like every slippy map
   * the reader has ever used.
   */
  const tileStore = useRef<DisplayTileStore | null>(null);
  const requestInterimRef = useRef<() => void>(() => undefined);
  /** Named places delivered by DEEP tiles, keyed by tile id. Names never bake
   *  into tiles; the lettering pass draws these live like everything else. */
  const deepPlaces = useRef<Map<string, TilePlace[]>>(new Map());
  const lastTileGeneration = useRef('');

  // Props the render needs, read through a ref so the event handlers never have
  // to be rebuilt when a prop changes.
  const propsRef = useRef({ world, theme, geography, layers, density, reliefAmount, title, subtitle, canonWorld, canonEdits });
  propsRef.current = { world, theme, geography, layers, density, reliefAmount, title, subtitle, canonWorld, canonEdits };
  const annRef = useRef<CartoAnnotations | undefined>(annotations);
  annRef.current = annotations;
  const markRef = useRef<FlyMark | null>(flyMark);
  markRef.current = flyMark;

  /**
   * Deepest useful zoom for THIS canvas: the tile ladder's honest top —
   * z12 (4 px per canon cell, ~38 m/px) with a canon source behind the deep
   * levels, z9 without — translated back into camera zoom. The camera stops
   * where the data stops; there is no zoom level that shows magnified mush.
   */
  const maxZoomFor = useCallback((cssH: number): number => {
    const p = propsRef.current;
    const zTop = p.canonWorld && p.geography ? MAX_TILE_Z : MAX_WORLD_TILE_Z;
    const pxCell = (TILE_PX * Math.pow(2, zTop)) / world.width;
    return Math.max(MAX_ZOOM_WORLD,
      Math.min(4000, ((pxCell * world.height) / Math.max(120, cssH)) * 1.1));
  }, [world.width, world.height]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => setSize({ w: host.clientWidth, h: host.clientHeight }));
    ro.observe(host);
    setSize({ w: host.clientWidth, h: host.clientHeight });
    return () => ro.disconnect();
  }, []);

  /** Source rect for a live view, clamped in latitude and free in longitude. */
  const viewFor = useCallback((v: LiveView, w: number, h: number): CartoView => {
    const W = world.width, H = world.height;
    const aspect = w > 0 && h > 0 ? w / h : 2;
    let vh = H / v.zoom;
    let vw = vh * aspect;
    if (vw > W) { vw = W; vh = vw / aspect; }
    if (vh > H) { vh = H; vw = vh * aspect; }
    const y = Math.min(H - vh, Math.max(0, v.cv * H - vh / 2));
    return { x: v.cu * W - vw / 2, y, w: vw, h: vh };
  }, [world.width, world.height]);

  // ---- painting ------------------------------------------------------------

  /**
   * Lettering and settlement marks are SCREEN entities — type keeps one size on
   * your screen whatever the ground scale, and a mark baked into a bitmap
   * stretches the moment that bitmap is blitted at any other zoom. So NOTHING
   * in this component bakes them: not the tiles, not the whole-world blit, not
   * the settled sheet. This one function draws them, through the SAME
   * `drawOverlay` the exports use, on every frame that reaches the screen —
   * gesture and settle alike. One source of words; nothing to double.
   */
  /** Regional place names harvested from DEEP tiles, lettered live under the
   *  same law as everything else: type belongs to the screen. */
  const drawDeepNames = useCallback((
    ctx: CanvasRenderingContext2D,
    v: CartoView,
    outW: number,
    outH: number,
    typeScale: number,
    z: number,
    space: LabelSpace,
  ) => {
    const p = propsRef.current;
    const scale = outW / v.w;
    const W = p.world.width;
    const cx = v.x + v.w / 2;
    const prefix = `${z}/`;
    const principalNames = new Set(
      p.geography?.settlements.map((s) => s.name.trim().toLocaleLowerCase()) ?? [],
    );
    interface Deco { pl: TilePlace; sx: number; sy: number; size: number; font: string }
    const cands: { value: Deco; x: number; y: number; width: number; height: number; priority: number }[] = [];
    for (const [key, list] of deepPlaces.current) {
      if (!key.startsWith(prefix)) continue;
      for (const pl of list) {
        if ((pl.kind === 'town' || pl.kind === 'village')
          && principalNames.has(pl.name.trim().toLocaleLowerCase())) continue;
        let x = pl.worldX;
        while (x < cx - W / 2) x += W;
        while (x > cx + W / 2) x -= W;
        const sx = (x - v.x) * scale;
        const sy = (pl.worldY - v.y) * scale;
        if (sx < -60 || sy < -30 || sx > outW + 60 || sy > outH + 30) continue;
        const town = pl.kind === 'town';
        const village = pl.kind === 'village';
        const size = (town ? 12.5 : village ? 11 : 9.5) * typeScale;
        const font = `${town || village ? '' : 'italic '}${town ? 600 : village ? 500 : 400} ${size}px ${p.theme.type.body}`;
        ctx.font = font;
        const tw = ctx.measureText(pl.name).width;
        const ly = sy + size * 1.15; // beneath its buildings
        cands.push({
          value: { pl, sx, sy: ly, size, font },
          x: sx - tw / 2, y: ly, width: tw, height: size * 1.2,
          priority: (town ? 3 : village ? 2 : pl.kind === 'abbey' ? 1.5 : 1) + pl.importance,
        });
      }
    }
    if (!cands.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const c of declutterLabels(cands, 64, 3)) {
      const d = c.value;
      const rect = { x: c.x, y: c.y - c.height! / 2, w: c.width, h: c.height! };
      if (!space.fits(rect, 3)) continue;
      space.add(rect);
      ctx.font = d.font;
      ctx.strokeStyle = p.theme.type.halo;
      ctx.lineWidth = p.theme.type.haloWidth * Math.max(0.6, d.size / 14);
      ctx.strokeText(d.pl.name, d.sx, d.sy);
      ctx.fillStyle = p.theme.type.color;
      ctx.fillText(d.pl.name, d.sx, d.sy);
    }
    ctx.restore();
  }, []);

  /**
   * La diana de llegada, en la retícula de la carta.
   *
   * Va FUERA de `drawLettering` a propósito: aquella se calla entera cuando el
   * lector apaga los rótulos o las poblaciones, y la marca no es una capa del
   * mapa sino la respuesta a lo que acaba de buscar. Apagar los nombres no
   * puede esconder dónde has aterrizado.
   *
   * `pxScale` es la razón entre el lienzo y sus píxeles de CSS: esta vista
   * dibuja en píxeles de dispositivo (ver `drawArrivalMark`).
   */
  const drawFlyMark = useCallback((
    ctx: CanvasRenderingContext2D,
    v: CartoView,
    outW: number,
    outH: number,
    pxScale: number,
  ) => {
    const mark = markRef.current;
    if (!mark) return;
    const p = propsRef.current;
    const W = p.world.width;
    const scale = outW / v.w;
    // La misma vuelta al mundo que dan los rótulos profundos: la carta puede
    // estar mirando a caballo de la costura, y la marca tiene que aparecer en
    // la copia que se ve, no en la de al lado.
    const cx = v.x + v.w / 2;
    let x = mark.x;
    while (x < cx - W / 2) x += W;
    while (x > cx + W / 2) x -= W;
    const sx = (x - v.x) * scale;
    const sy = (mark.y - v.y) * scale;
    if (sx < -80 * pxScale || sy < -40 * pxScale
      || sx > outW + 80 * pxScale || sy > outH + 40 * pxScale) return;
    const r1 = drawArrivalMark(ctx, sx, sy, '#ffd479', pxScale);
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = `600 ${12 * pxScale}px ${p.theme.type.body}`;
    ctx.lineWidth = 3 * pxScale;
    ctx.strokeStyle = 'rgba(6,8,13,0.85)';
    ctx.strokeText(mark.name, sx + r1 + 6 * pxScale, sy);
    ctx.fillStyle = '#ffd479';
    ctx.fillText(mark.name, sx + r1 + 6 * pxScale, sy);
    ctx.restore();
  }, []);

  const drawLettering = useCallback((
    ctx: CanvasRenderingContext2D,
    v: CartoView,
    outW: number,
    outH: number,
    typeScale: number,
  ) => {
    const p = propsRef.current;
    const geo = p.geography;
    const wantMarks = p.layers.settlements !== false;
    const wantNames = p.layers.labels !== false;
    if (!geo || (!wantMarks && !wantNames)) return;
    const z = levelFor(p.world, outW / v.w, p.canonWorld ? MAX_TILE_Z : MAX_WORLD_TILE_Z);
    const deep = z >= DEEP_TILE_Z && !!p.canonWorld && geo.depth === 'full';
    const space = drawOverlay(ctx, p.world, geo, {
      theme: p.theme,
      view: v,
      scale: outW / v.w,
      width: outW,
      height: outH,
      worldWidth: p.world.width,
      // Principal settlements stay authoritative in screen space. Tile detail
      // may add buildings and hamlets, but loading state never removes a city.
      layers: { roads: false, borders: false, settlements: wantMarks, labels: wantNames },
      typeScale,
    });
    if (deep && wantNames) drawDeepNames(ctx, v, outW, outH, typeScale, z, space);
  }, [drawDeepNames]);

  /** Blit the last finished bitmap at the live view. Cheap enough for 60 fps. */
  const paintInterim = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const v = viewFor(live.current, size.w, size.h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';

    // Source of truth for a gesture frame: the whole-world bitmap. Every view is
    // a sub-rectangle of it, so every frame is fully covered — the beige edges
    // are not tuned away, they are made impossible.
    const p = propsRef.current;
    const gm = globalMap.current;
    if (gm) {
      const kx = gm.canvas.width / world.width;
      const ky = gm.canvas.height / world.height;
      const sw = v.w * kx, sh = v.h * ky;
      const sx = v.x * kx;
      // Draw the seam twice so a view straddling it has no gap either.
      ctx.fillStyle = theme.ocean.deep;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const shift of [-gm.canvas.width, 0, gm.canvas.width]) {
        ctx.drawImage(gm.canvas, sx + shift, v.y * ky, sw, sh, 0, 0, canvas.width, canvas.height);
        if (shift === 0 && sx >= 0 && sx + sw <= gm.canvas.width) break;
      }
    } else {
      const b = base.current;
      if (!b) return;
      const k = b.view.w / v.w;
      let dx = b.view.x - v.x;
      const W = world.width;
      while (dx > W / 2) dx -= W;
      while (dx < -W / 2) dx += W;
      ctx.fillStyle = theme.paper.base;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(b.canvas, (dx / v.w) * canvas.width, ((b.view.y - v.y) / v.h) * canvas.height,
        canvas.width * k, canvas.height * k);
    }

    // The sharp layer. Resident tiles draw over the blit; missing ones fall
    // back to an ancestor's scaled quarter inside the store; truly uncovered
    // ground keeps the blit underneath. Requests go out for the current level
    // only — arrivals repaint this same frame path via onArrive.
    const store = tileStore.current;
    if (store) {
      const generation = `${p.world.params.seed}:${p.world.revision ?? 0}:${p.theme.id}:${p.density}:${p.reliefAmount}`
        + `:${JSON.stringify(p.layers)}`;
      if (generation !== lastTileGeneration.current) {
        lastTileGeneration.current = generation;
        deepPlaces.current.clear();
      }
      // Mismo planeta = la lámina anterior se queda de fantasma bajo la
      // nueva mientras se entinta, y se funde en 250 ms. Ver `DisplayTileStore`.
      store.setGeneration(generation, worldFamilyKey(p.world));
      const z = levelFor(p.world, canvas.width / v.w, p.canonWorld ? MAX_TILE_Z : MAX_WORLD_TILE_Z);
      store.want(p.world, z, v);
      store.draw(ctx, p.world, z, v, { x: 0, y: 0, w: canvas.width, h: canvas.height });
    }

    // Lettering rides every frame (see drawLettering) — the blit and the tiles
    // underneath carry no type at all.
    drawLettering(ctx, v, canvas.width, canvas.height, canvas.width / Math.max(1, size.w));
    drawFlyMark(ctx, v, canvas.width, canvas.height, canvas.width / Math.max(1, size.w));
  }, [viewFor, size.w, size.h, world.width, world.height, theme.paper.base, theme.ocean.deep, drawLettering, drawFlyMark]);

  /**
   * Book an interim blit, with a timer behind it.
   *
   * `if (rafRef.current) return` on its own is a latch, not a guard: one booked
   * frame that never arrives and the blit is off for the life of the component.
   * That is not hypothetical — the sculpt view was found frozen at exactly one
   * frame for precisely this reason, because a window whose only content is a
   * static canvas can stop being composited and stop getting animation frames
   * altogether. The timer is the floor.
   */
  const requestInterim = useCallback(() => {
    if (rafRef.current) return;
    const booked = performance.now();
    const fire = () => {
      if (!rafRef.current) return;
      rafRef.current = 0;
      window.clearTimeout(interimFallback.current);
      paintInterim();
    };
    rafRef.current = requestAnimationFrame(fire);
    window.clearTimeout(interimFallback.current);
    interimFallback.current = window.setTimeout(() => {
      if (rafRef.current && performance.now() - booked > 90) fire();
    }, 100);
  }, [paintInterim]);
  requestInterimRef.current = requestInterim;

  /** The GPU base, or null to let the renderer use its CPU path. */
  const drawBase = useCallback((w: number, h: number, v: CartoView): CanvasImageSource | null => {
    if (glFailed.current) return null;
    const p = propsRef.current;
    const L = { ...p.layers };
    try {
      if (!glBase.current) {
        if (!glCanvas.current) glCanvas.current = document.createElement('canvas');
        glBase.current = new CartoBaseGL(glCanvas.current, p.world);
      }
      const gl = glBase.current;
      gl.sync(p.world, computeFields(p.world), getTintFieldFor(p.world, p.theme));
      gl.draw(v, w, h, {
        theme: p.theme,
        shading: L.shading !== false,
        biomeTint: L.biomeTint !== false,
        coastRings: L.coastRings !== false,
      }, 0);
      return gl.canvas as HTMLCanvasElement;
    } catch {
      // One failure is enough: fall back for good rather than throwing per frame.
      glFailed.current = true;
      glBase.current = null;
      return null;
    }
  }, []);

  /** Full pipeline render at a given resolution factor. Synchronous. */
  const render = useCallback((factor: number, full: boolean) => {
    if (size.w < 8 || size.h < 8) return;
    if (rendering.current) { pendingRender.current = { factor, full }; return; }
    const p = propsRef.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(8, Math.round(size.w * dpr * factor));
    const h = Math.max(8, Math.round(size.h * dpr * factor));
    const v = viewFor(live.current, size.w, size.h);

    rendering.current = true;
    setBusy(true);
    // Yield one frame so the spinner and the interim blit are actually on screen
    // before the main thread blocks.
    requestAnimationFrame(() => {
      try {
        // Lettering is specified in CSS pixels. A quick bitmap is enlarged
        // on screen; multiplying by its inverse scale enlarged type twice.
        const typeScale = w / Math.max(1, size.w);
        // Lettering is NOT baked (see drawLettering): this canvas doubles as
        // the gesture blit source, and baked type stretches under any other
        // zoom — the classic doubled-name artifact.
        const off = renderCartoCanvas(p.world, {
          theme: p.theme,
          width: w,
          height: h,
          view: v,
          layers: { ...p.layers, labels: false, settlements: false },
          density: p.density,
          reliefAmount: p.reliefAmount,
          title: p.title,
          subtitle: p.subtitle,
          geography: p.geography,
          typeScale,
          drawBase,
        });
        base.current = { canvas: off, view: v, full };
        // Refresh the whole-world bitmap when it is missing or out of date. Done
        // here, on the settle, so it never competes with the gesture.
        const gm = globalMap.current;
        const rev = p.world.revision ?? 0;
        if (full && (!gm || gm.rev !== rev || gm.theme !== p.theme.id)) {
          const gw = 2048, gh = 1024;
          const wholeView = { x: 0, y: 0, w: p.world.width, h: p.world.height };
          const whole = renderCartoCanvas(p.world, {
            theme: p.theme,
            width: gw, height: gh,
            view: wholeView,
            // No furniture and no type: this bitmap exists to be magnified
            // arbitrarily under gestures, and only the GROUND survives that.
            layers: {
              ...p.layers, frame: false, compass: false, scaleBar: false,
              labels: false, settlements: false,
            },
            density: p.density,
            reliefAmount: p.reliefAmount,
            geography: p.geography,
            typeScale: 1,
            drawBase,
          });
          globalMap.current = { canvas: whole, rev, theme: p.theme.id };
        }
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = w;
          canvas.height = h;
          canvas.style.width = `${size.w}px`;
          canvas.style.height = `${size.h}px`;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(off, 0, 0);
            // Words on top, live — the settle draws the same lettering the
            // gesture frames do, so nothing jumps at the handover.
            drawLettering(ctx, v, w, h, typeScale);
            drawFlyMark(ctx, v, w, h, w / Math.max(1, size.w));
          }
        }
      } finally {
        rendering.current = false;
        setBusy(false);
        // Run whatever was requested while this pass was on the main thread —
        // in the common case, the full-resolution settle that used to be lost.
        const p = pendingRender.current;
        if (p && canvasRef.current) {
          pendingRender.current = null;
          renderRef.current?.(p.factor, p.full);
        }
      }
    });
  }, [size.w, size.h, viewFor, drawBase, drawLettering, drawFlyMark]);
  renderRef.current = render;

  // ---- the ink layer -------------------------------------------------------
  // A separate transparent canvas above the map: the reader's own marks — a
  // planned route, an ancient coastline, the two ends of a journey — live here
  // rather than in the cartographic render, because they change for reasons the
  // map does not. Dragging a sea-level slider must not cost a full re-render of
  // the sheet.
  const paintInk = useCallback(() => {
    const ink = inkRef.current;
    if (!ink) return;
    const ctx = ink.getContext('2d');
    if (!ctx) return;
    if (ink.width !== Math.round(size.w) || ink.height !== Math.round(size.h)) {
      ink.width = Math.max(1, Math.round(size.w));
      ink.height = Math.max(1, Math.round(size.h));
    }
    ctx.clearRect(0, 0, ink.width, ink.height);
    const v = viewFor(live.current, size.w, size.h);
    const k = size.w / v.w;
    const sx = (wx: number) => {
      let d = wx - v.x;
      while (d > world.width / 2) d -= world.width;
      while (d < -world.width / 2) d += world.width;
      return d * k;
    };
    const sy = (wy: number) => (wy - v.y) * k;
    drawAnnotations(ctx, annRef.current, world, sx, sy, k);
  }, [viewFor, size.w, size.h, world]);

  /** Queue the two-tier settle. */
  const scheduleRender = useCallback(() => {
    window.clearTimeout(quickTimer.current);
    window.clearTimeout(fullTimer.current);
    pendingRender.current = null;
    quickTimer.current = window.setTimeout(() => render(QUICK_SCALE, false), QUICK_MS);
    fullTimer.current = window.setTimeout(() => render(1, true), FULL_MS);
  }, [render]);

  /** Called by the event handlers: paint now, render soon. */
  const viewChanged = useCallback(() => {
    setZoomLabel(live.current.zoom);
    requestInterim();
    scheduleRender();
    paintInk();
    const v = viewFor(live.current, size.w, size.h);
    if (onViewportChange) {
      window.clearTimeout(reportTimer.current);
      reportTimer.current = window.setTimeout(() => {
        const vp = cartaViewToViewport(viewFor(live.current, size.w, size.h), world);
        lastReported.current = vp;
        onViewportChange(vp);
      }, 180);
    }
    onViewChange?.(v);
  }, [requestInterim, scheduleRender, paintInk, onViewportChange, onViewChange, viewFor, size.w, size.h, world]);

  const cancelFlight = useCallback(() => {
    if (flight.current) { cancelAnimationFrame(flight.current); flight.current = 0; }
  }, []);

  // Adopt the shared camera: on mount, and whenever the parent moves it for a
  // reason of its own (a reveal, a bookmark, another view's gesture). Echoes of
  // our own reports are ignored, or every wheel tick would fight its round-trip.
  useEffect(() => {
    if (!viewport || size.w < 8 || size.h < 8) return;
    if (sameViewport(viewport, lastReported.current)) return;
    cancelFlight();
    window.clearTimeout(reportTimer.current);
    live.current = viewportToCartaCamera(viewport, world, size.w, size.h, MIN_ZOOM, maxZoomFor(size.h));
    lastReported.current = viewport; // adopting is not a gesture; do not report it back
    setZoomLabel(live.current.zoom);
    requestInterim();
    scheduleRender();
    paintInk();
  }, [viewport, size.w, size.h, world, cancelFlight, requestInterim, scheduleRender, paintInk, maxZoomFor]);

  // A one-shot flight: interim blits per frame (exactly what a gesture paints),
  // one real render at the destination.
  useEffect(() => {
    if (!flyTarget || size.w < 8 || size.h < 8) return;
    cancelFlight();
    const from = cartaViewToViewport(viewFor(live.current, size.w, size.h), world);
    const to = clampViewport({ u: flyTarget.u, v: flyTarget.v, spanKm: flyTarget.spanKm ?? from.spanKm });
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / FLIGHT_MS);
      live.current = viewportToCartaCamera(
        flightAt(from, to, t), world, size.w, size.h, MIN_ZOOM, maxZoomFor(size.h));
      if (t < 1) {
        requestInterim();
        paintInk();
        flight.current = requestAnimationFrame(step);
      } else {
        flight.current = 0;
        viewChanged();
      }
    };
    flight.current = requestAnimationFrame(step);
    return cancelFlight;
    // The token IS the request; everything else is read fresh when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTarget?.token]);

  // Annotations are cheap and change often (a slider drag), so they repaint on
  // their own rather than waiting for the map's debounced render.
  useEffect(() => { paintInk(); }, [annotations, paintInk, size.w, size.h]);

  // Y la marca de llegada repinta por el camino BARATO. El repintado completo
  // de más abajo reconstruye la lámina del mundo entera (segundos, y con GL de
  // por medio): buscar un sitio no puede costar eso, y quitar la marca con Esc
  // menos todavía.
  useEffect(() => { requestInterim(); }, [flyMark, requestInterim]);

  // Re-render from scratch when anything other than the view changes.
  //
  // `world.revision` is in the dependency list because painting mutates the world
  // IN PLACE: the object identity never changes, so without the revision a stroke
  // updates the data and the map keeps showing the state before it.
  useEffect(() => {
    window.clearTimeout(quickTimer.current);
    window.clearTimeout(fullTimer.current);
    base.current = null;
    render(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, world.revision, theme, geography, JSON.stringify(layers), density, reliefAmount, size.w, size.h]);

  useEffect(() => () => {
    window.clearTimeout(quickTimer.current);
    window.clearTimeout(fullTimer.current);
    window.clearTimeout(reportTimer.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    glBase.current?.dispose();
    glBase.current = null;
  }, []);

  // The tile store lives exactly as long as the component. Cache-guarded and
  // re-runnable (StrictMode mounts twice); the renderer reads props through
  // the ref so a theme or layer flip never rebuilds the store — it just
  // changes the generation string and the store empties itself.
  useEffect(() => {
    const store = new DisplayTileStore(
      (key) => {
        const q = propsRef.current;
        if (!q.geography) return Promise.resolve(null);
        // Deep levels render the canon countryside from the PRISTINE world
        // (strokes re-applied at canon resolution inside the worker); the
        // carta levels read the edited raster as always. Two worlds, two
        // worker sessions — the pool holds both.
        const deep = key.z >= DEEP_TILE_Z && q.canonWorld && q.geography.depth === 'full';
        // Handed back whole, so the store can cancel a tile that has left the
        // window rather than making the one you stopped on wait behind it.
        // Por el SERVICIO (ARQUITECTURA-TESELAS §3.1): disco primero, cola
        // corta delante del pool, render compartido entre vistas.
        const req = serveTile(deep ? q.canonWorld! : q.world, q.geography, key, {
          themeId: q.theme.id,
          layers: q.layers as Record<string, boolean>,
          density: q.density,
          reliefAmount: q.reliefAmount,
          // `?? ''`: hondo sin ediciones sigue siendo contenido direccionable
          // (ver la nota gemela en Map2D — el `s:r3` del log de Luis).
          edits: deep ? (q.canonEdits ?? '') : undefined,
        });
        const promise = req.promise.then((res) => {
          if (!res) return null;
          if (res.places?.length) {
            const map = deepPlaces.current;
            map.set(`${key.z}/${key.tx}/${key.ty}`, res.places);
            // Bounded: drop the oldest entries rather than growing forever.
            while (map.size > 256) {
              const first = map.keys().next().value;
              if (first === undefined) break;
              map.delete(first);
            }
          }
          return res.bitmap;
        }).catch(() => null);
        return { promise, cancel: req.cancel };
      },
      () => requestInterimRef.current(),
    );
    tileStore.current = store;
    return () => {
      tileStore.current = null;
      store.dispose();
    };
  }, []);

  // A new world means new field textures.
  useEffect(() => {
    glBase.current?.dispose();
    glBase.current = null;
    glFailed.current = false;
  }, [world]);

  // ---- interaction ---------------------------------------------------------
  // Wheel is bound natively because React's onWheel is passive: preventDefault
  // inside it is ignored and the page scrolls behind the map.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelFlight();
      const rect = host.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const v = viewFor(live.current, size.w, size.h);
      // World point under the cursor, held fixed across the zoom.
      const wu = (v.x + px * v.w) / world.width;
      const wv = (v.y + py * v.h) / world.height;
      const next = Math.min(maxZoomFor(size.h), Math.max(MIN_ZOOM, live.current.zoom * Math.pow(1.0022, -e.deltaY)));
      live.current.zoom = next;
      const nv = viewFor(live.current, size.w, size.h);
      live.current.cu = wu + (0.5 - px) * (nv.w / world.width);
      live.current.cv = Math.min(1, Math.max(0, wv + (0.5 - py) * (nv.h / world.height)));
      viewChanged();
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [viewFor, size.w, size.h, world.width, world.height, viewChanged, cancelFlight, maxZoomFor]);

  // Undo and redo belong to the world, not to a view, and the pointer is always
  // over the map — so the shortcut has to work from here even though nothing on
  // this sheet is editable.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(e.shiftKey ? 'wg-redo' : 'wg-undo'));
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    cancelFlight();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = {
      x: e.clientX, y: e.clientY,
      cu: live.current.cu, cv: live.current.cv, moved: false,
    };
  }, [cancelFlight]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const host = hostRef.current;
    if (!host) return;

    const d = drag.current;
    if (!d) { paintInk(); return; }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    const v = viewFor(live.current, size.w, size.h);
    live.current.cu = d.cu - (dx / host.clientWidth) * (v.w / world.width);
    live.current.cv = Math.min(1, Math.max(0, d.cv - (dy / host.clientHeight) * (v.h / world.height)));
    viewChanged();
  }, [viewFor, size.w, size.h, world.width, world.height, viewChanged, paintInk]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const geo = propsRef.current.geography;
    if (!d || d.moved || !geo) return;
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const v = viewFor(live.current, size.w, size.h);
    const wx = v.x + ((e.clientX - rect.left) / rect.width) * v.w;
    const wy = v.y + ((e.clientY - rect.top) / rect.height) * v.h;
    if (onInspect) {
      onInspect(((wx % world.width) + world.width) % world.width,
        Math.min(world.height - 1, Math.max(0, wy)));
      return;
    }
    if (!onPickSettlement) return;
    const tol = (18 / rect.width) * v.w;
    const s = pickSettlement(world, geo, ((wx / world.width) % 1 + 1) % 1, wy / world.height, Math.max(6, tol));
    if (s) onPickSettlement(s);
  }, [onPickSettlement, onInspect, viewFor, size.w, size.h, world]);

  const setZoom = useCallback((z: number) => {
    live.current.zoom = Math.min(maxZoomFor(size.h), Math.max(MIN_ZOOM, z));
    viewChanged();
  }, [viewChanged, maxZoomFor, size.h]);

  // Double-click descends toward the ground under the cursor. Deliberately not
  // a mode or a tool: going down a league should cost one gesture — and it is
  // the SAME gesture with the same meaning in the satellite and 3D views.
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!onZoomTo) return;
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const v = viewFor(live.current, size.w, size.h);
    const x = v.x + ((e.clientX - rect.left) / rect.width) * v.w;
    const y = v.y + ((e.clientY - rect.top) / rect.height) * v.h;
    onZoomTo(((x % world.width) + world.width) % world.width,
      Math.min(world.height - 1, Math.max(0, y)));
  }, [onZoomTo, viewFor, size.w, size.h, world.width, world.height]);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 overflow-hidden touch-none cursor-grab active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onPointerCancel={() => { drag.current = null; }}
    >
      <canvas ref={canvasRef} className="block" />
      {/* Fixed frame. The border belongs to the sheet the reader is holding, not
          to the render underneath it, so it must not move, scale or disappear
          while the map is catching up. */}
      <div className="absolute inset-0 pointer-events-none" style={{
        border: `2px solid ${theme.furniture.frame}`,
        boxShadow: `inset 0 0 0 4px ${theme.furniture.frameFill}, inset 0 0 0 6px ${theme.furniture.frame}`,
      }} />
      <canvas
        ref={inkRef}
        className="absolute left-0 top-0 pointer-events-none"
        style={{ width: size.w, height: size.h }}
      />

      <div className="absolute left-2 bottom-2 flex items-center gap-2 pointer-events-none">
        <span className="px-2 py-1 rounded-md border border-white/20 bg-[#0b0e14]/92 text-[11px] text-white tabular-nums shadow-lg shadow-black/50">
          ×{zoomLabel.toFixed(1)}
        </span>
        {busy && (
          <span className="px-2 py-1 rounded-md border border-white/20 bg-[#0b0e14]/92 text-[11px] text-white shadow-lg shadow-black/50">dibujando…</span>
        )}
      </div>

      <div className="absolute right-2 bottom-2 flex flex-col gap-1">
        <ZoomBtn label="+" onClick={() => setZoom(live.current.zoom * 1.6)} />
        <ZoomBtn label="−" onClick={() => setZoom(live.current.zoom / 1.6)} />
        <ZoomBtn
          label="⌖"
          title="Encuadrar el mundo"
          onClick={() => {
            live.current = { zoom: 1, cu: 0.5, cv: 0.5 };
            viewChanged();
          }}
        />
      </div>
    </div>
  );
}

function ZoomBtn({ label, onClick, title }: { label: string; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 grid place-items-center rounded-md border border-white/20 bg-[#0b0e14]/92 text-white text-sm hover:bg-[#161b26] transition shadow-lg shadow-black/50"
    >
      {label}
    </button>
  );
}
