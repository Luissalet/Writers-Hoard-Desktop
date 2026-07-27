import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorldData } from '../core/types';
import type { HumanGeography, Settlement } from '../core/settlements';
import { renderCartoCanvas, pickSettlement } from '../cartography/texture';
import type { CartoLayers, CartoView } from '../cartography/render';
import type { CartoTheme } from '../cartography/theme';
import { CartoBaseGL } from '../cartography/glbase';
import { computeFields, getTintFieldFor } from '../cartography/render';
import { drawAnnotations, type CartoAnnotations } from '../cartography/annotations';

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
  layers: Partial<CartoLayers>;
  density: number;
  reliefAmount: number;
  title?: string;
  subtitle?: string;
  onPickSettlement?: (s: Settlement) => void;
  /** Double-click anywhere: open the regional sheet centred on that ground. */
  onOpenRegion?: (x: number, y: number) => void;
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
const MAX_ZOOM = 22;
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
  onPickSettlement, onOpenRegion, onInspect, onViewChange, annotations,
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
  // The GPU base pass. Created lazily, kept for the life of the world, and simply
  // absent when WebGL2 is unavailable — in which case the renderer falls back to
  // its CPU pixel loop and nothing else changes.
  const glBase = useRef<CartoBaseGL | null>(null);
  const glCanvas = useRef<HTMLCanvasElement | null>(null);
  const glFailed = useRef(false);
  const drag = useRef<{ x: number; y: number; cu: number; cv: number; moved: boolean } | null>(null);
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

  // Props the render needs, read through a ref so the event handlers never have
  // to be rebuilt when a prop changes.
  const propsRef = useRef({ world, theme, geography, layers, density, reliefAmount, title, subtitle });
  propsRef.current = { world, theme, geography, layers, density, reliefAmount, title, subtitle };
  const annRef = useRef<CartoAnnotations | undefined>(annotations);
  annRef.current = annotations;

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
  }, [viewFor, size.w, size.h, world.width, world.height, theme.paper.base, theme.ocean.deep]);

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
    if (size.w < 8 || size.h < 8 || rendering.current) return;
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
        const off = renderCartoCanvas(p.world, {
          theme: p.theme,
          width: w,
          height: h,
          view: v,
          layers: p.layers,
          density: p.density,
          reliefAmount: p.reliefAmount,
          title: p.title,
          subtitle: p.subtitle,
          geography: p.geography,
          typeScale: factor < 1 ? 1 / factor * 0.72 : dpr > 1 ? 1 : 0.92,
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
            layers: { ...p.layers, frame: false, compass: false, scaleBar: false },
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
          }
        }
      } finally {
        rendering.current = false;
        setBusy(false);
      }
    });
  }, [size.w, size.h, viewFor, drawBase]);

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
    quickTimer.current = window.setTimeout(() => render(QUICK_SCALE, false), QUICK_MS);
    fullTimer.current = window.setTimeout(() => render(1, true), FULL_MS);
  }, [render]);

  /** Called by the event handlers: paint now, render soon. */
  const viewChanged = useCallback(() => {
    setZoomLabel(live.current.zoom);
    requestInterim();
    scheduleRender();
    paintInk();
    onViewChange?.(viewFor(live.current, size.w, size.h));
  }, [requestInterim, scheduleRender, paintInk, onViewChange, viewFor, size.w, size.h]);

  // Annotations are cheap and change often (a slider drag), so they repaint on
  // their own rather than waiting for the map's debounced render.
  useEffect(() => { paintInk(); }, [annotations, paintInk, size.w, size.h]);

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
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    glBase.current?.dispose();
    glBase.current = null;
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
      const rect = host.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const v = viewFor(live.current, size.w, size.h);
      // World point under the cursor, held fixed across the zoom.
      const wu = (v.x + px * v.w) / world.width;
      const wv = (v.y + py * v.h) / world.height;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, live.current.zoom * Math.pow(1.0022, -e.deltaY)));
      live.current.zoom = next;
      const nv = viewFor(live.current, size.w, size.h);
      live.current.cu = wu + (0.5 - px) * (nv.w / world.width);
      live.current.cv = Math.min(1, Math.max(0, wv + (0.5 - py) * (nv.h / world.height)));
      viewChanged();
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [viewFor, size.w, size.h, world.width, world.height, viewChanged]);

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
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = {
      x: e.clientX, y: e.clientY,
      cu: live.current.cu, cv: live.current.cv, moved: false,
    };
  }, []);

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
    live.current.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    viewChanged();
  }, [viewChanged]);

  // Double-click drops a league below the world map. Deliberately not a mode or
  // a tool: descending into the country you are looking at should cost one
  // gesture, the same way a settlement's plan costs one click.
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!onOpenRegion) return;
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const v = viewFor(live.current, size.w, size.h);
    const x = v.x + ((e.clientX - rect.left) / rect.width) * v.w;
    const y = v.y + ((e.clientY - rect.top) / rect.height) * v.h;
    onOpenRegion(((x % world.width) + world.width) % world.width,
      Math.min(world.height - 1, Math.max(0, y)));
  }, [onOpenRegion, viewFor, size.w, size.h, world.width, world.height]);

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
