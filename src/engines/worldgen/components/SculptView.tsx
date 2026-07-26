import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WorldData } from '../core/types';
import { BIOME_COUNT } from '../core/types';
import { BIOME_COLORS } from '../core/render';
import { SculptGL, type ViewRect } from '../sculpt/gl';
import { LiveStroke, landRule, terrainRule } from '../sculpt/brush';
import { drawSculptFallback } from '../sculpt/fallback';
import { SphereNoise } from '../core/noise';
import type { Pt, WorldEdit } from '../core/edits';
import type { PaintTool } from './PaintPanel';

/**
 * The editing view.
 *
 * Painting used to happen on the cartographic map, and it was the wrong place:
 * that view exists to draw a finished sheet — paper grain, hand-drawn coastline,
 * thousands of symbols, lettering — so every stroke asked it for a few hundred
 * milliseconds of work and the map blinked. You cannot sculpt on a printing press.
 *
 * Here the terrain lives in a GPU texture. A stroke rewrites the cells under the
 * pointer, uploads that rectangle, and redraws in one shader pass: the ground
 * moves under the brush while the button is still down. Nothing is re-derived and
 * no React state changes during the drag.
 *
 * On release the stroke is committed as ONE `WorldEdit` to the session, so the
 * storage contract — a world is a seed, its parameters and an ordered edit list —
 * is exactly as it was.
 */

interface SculptViewProps {
  world: WorldData;
  tool: PaintTool;
  onEdit: (edit: WorldEdit) => void;
  /** Bumped by the owner when the world data changed underneath us. */
  revision: number;
  onHover?: (info: { x: number; y: number; elevation: number } | null) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 40;

export default function SculptView({ world, tool, onEdit, revision, onHover }: SculptViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<SculptGL | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [failed, setFailed] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [glTick, setGlTick] = useState(0);
  // Diagnostics, on screen. Two remote fixes have now been attempted for a black
  // canvas that does not reproduce here, which means guessing has been tried and
  // has failed. These four numbers separate every remaining hypothesis: whether
  // the backing store is sized, whether the context exists, whether draws are
  // happening at all, and whether the world arrived.
  const [diag, setDiag] = useState('iniciando');
  /**
   * The GPU has had its chance.
   *
   * Set when WebGL either refuses to initialise or, worse, initialises and then
   * never produces a frame — which is the failure this whole flag exists for,
   * because it is silent. After a second of no picture the view switches to the
   * Canvas2D renderer and keeps working.
   */
  const [soft, setSoft] = useState(false);
  const softRef = useRef(false);
  softRef.current = soft;

  // Live view state lives in refs: a pan must not re-render React.
  const view = useRef({ zoom: 1, cu: 0.5, cv: 0.5 });
  const drag = useRef<{ x: number; y: number; cu: number; cv: number } | null>(null);
  const stroke = useRef<LiveStroke | null>(null);
  const cursor = useRef<Pt | null>(null);
  const raf = useRef(0);
  /** Declared above the draw so the diagnostic can report which clock is running. */
  const rafAliveRef = useRef(true);
  const drawCount = useRef(0);
  /**
   * Event counters, on screen.
   *
   * Two hypotheses survive for a frozen view: the frames are not arriving, or
   * the EVENTS are not — a wheel that never reaches the element requests no
   * draws, and the result is indistinguishable from a dead clock. Counting both
   * separates them in one glance at a screenshot, which is cheaper than a sixth
   * round of guessing.
   */
  const wheelCount = useRef(0);
  const pointerCount = useRef(0);
  const glFailed = useRef(false);
  const uploadedRev = useRef(-1);
  const revisionRef = useRef(revision);
  // Filled in below; the layout effect above needs to call it before it exists.
  const requestRef = useRef<() => void>(() => {});
  const frames = useRef<{ n: number; t: number }>({ n: 0, t: 0 });
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const palette = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let i = 0; i < BIOME_COUNT; i++) {
      const c = BIOME_COLORS[i] ?? [136, 136, 136];
      out.push([c[0] / 255, c[1] / 255, c[2] / 255]);
    }
    return out;
  }, []);

  // Noise for the coastline brush and the roughen op. Seeded from the world so a
  // live stroke and the committed edit produce the same shape.
  const noise = useMemo(() => ({
    coast: new SphereNoise(world.params.seed, 'paint-coast'),
    rough: new SphereNoise(world.params.seed, 'paint-rough'),
  }), [world.params.seed]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: host.clientWidth, h: host.clientHeight });
      requestRef.current();
    });
    ro.observe(host);
    setSize({ w: host.clientWidth, h: host.clientHeight });
    requestRef.current();
    return () => ro.disconnect();
  }, []);

  // ---- GL lifecycle --------------------------------------------------------
  // A new world means a new context; the draw below builds it on its next frame.
  useEffect(() => {
    glRef.current?.dispose();
    glRef.current = null;
    glFailed.current = false;
    uploadedRev.current = -1;
    setFailed(null);
    setGlTick((t) => t + 1);
    return () => { glRef.current?.dispose(); glRef.current = null; };
  }, [world, palette]);

  // The owner changed the data (a commit, an undo, a regeneration): re-upload on
  // the next frame rather than here, so this too cannot run before the context.
  useEffect(() => {
    revisionRef.current = revision;
    request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const viewRect = useCallback((): ViewRect => {
    const v = view.current;
    const host = hostRef.current;
    const cw = host?.clientWidth ?? 0, ch = host?.clientHeight ?? 0;
    const aspect = cw > 0 && ch > 0 ? cw / ch : 2;
    let h = world.height / v.zoom;
    let w = h * aspect;
    if (w > world.width) { w = world.width; h = w / aspect; }
    if (h > world.height) { h = world.height; w = h * aspect; }
    const y = Math.min(world.height - h, Math.max(0, v.cv * world.height - h / 2));
    return { x: v.cu * world.width - w / 2, y, w, h };
  }, [world.width, world.height]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current, host = hostRef.current;
    if (!canvas || !host) { setDiag('sin lienzo'); return; }

    // ---- the renderer that cannot fail -----------------------------------
    if (softRef.current) {
      const cw0 = host.clientWidth, ch0 = host.clientHeight;
      if (cw0 < 2 || ch0 < 2) { setDiag(`caja ${cw0}x${ch0}: sin tamaño`); return; }
      const dpr0 = Math.min(2, window.devicePixelRatio || 1);
      const w0 = Math.max(1, Math.round(cw0 * dpr0)), h0 = Math.max(1, Math.round(ch0 * dpr0));
      if (canvas.width !== w0 || canvas.height !== h0) { canvas.width = w0; canvas.height = h0; }
      const c0 = cursor.current;
      const ok = drawSculptFallback(canvas, {
        world,
        palette,
        view: viewRect(),
        brush: c0 && toolRef.current.mode !== 'off'
          ? { x: c0.x, y: c0.y, r: toolRef.current.radius } : null,
        contourKm: 0.25,
        shade: 0.85,
      });
      drawCount.current++;
      if (drawCount.current < 3 || drawCount.current % 30 === 0) {
        setDiag(ok ? `modo compatible · ${canvas.width}x${canvas.height}` : 'ni WebGL ni 2D disponibles');
      }
      return;
    }
    // The context is created HERE, on the first frame that has a canvas and a
    // size — not in an effect.
    //
    // The effect version took `if (!canvas) return` on its single run and left
    // the context null forever, with no error to show for it: a black rectangle
    // and a diagnostic still reading "iniciando". An effect that can fail to
    // initialise and never retries is a trap; a lazy init inside the frame loop
    // retries every frame by construction and cannot get stuck.
    let gl = glRef.current;
    if (!gl && !glFailed.current) {
      try {
        gl = new SculptGL(canvas, { width: world.width, height: world.height, palette });
        gl.uploadAll(world.elevation, world.biome);
        glRef.current = gl;
        uploadedRev.current = revisionRef.current;
      } catch (e) {
        glFailed.current = true;
        setFailed(e instanceof Error ? e.message : String(e));
        // Not a dead end any more: fall through to the 2D renderer on the next
        // frame instead of leaving the reader with a black rectangle and a
        // message they cannot act on.
        setSoft(true);
        return;
      }
    }
    if (!gl) return;
    // Measured from the DOM, never from React state.
    //
    // The state version produced a 1×1 backing store stretched across the whole
    // panel — which is a solid black rectangle and a frame counter stuck at zero.
    // The size arrives from a ResizeObserver, the draw arrives from an animation
    // frame, and any ordering between two async sources that has to be right is
    // a bug waiting for a slower machine. Reading the live layout cannot be stale.
    const cw = host.clientWidth, ch = host.clientHeight;
    if (cw < 2 || ch < 2) { setDiag(`caja ${cw}x${ch}: sin tamaño`); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cw * dpr));
    const h = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (uploadedRev.current !== revisionRef.current) {
      gl.uploadAll(world.elevation, world.biome);
      uploadedRev.current = revisionRef.current;
    }
    drawCount.current++;
    if (drawCount.current < 4 || drawCount.current % 20 === 0) {
      setDiag(`${canvas.width}x${canvas.height} · dibujos ${drawCount.current}`
        + ` · rueda ${wheelCount.current} · puntero ${pointerCount.current}`
        + ` · reloj ${rafAliveRef.current ? 'rAF' : 'propio'}`);
    }
    const c = cursor.current;
    gl.setBrush(c?.x ?? 0, c?.y ?? 0, toolRef.current.radius, !!c && toolRef.current.mode !== 'off');
    gl.draw(viewRect());

    // Frame COST, not frame rate. The view draws on demand, so an idle sheet
    // legitimately runs at zero frames a second and saying so reads as "broken"
    // — which is exactly how it read. Milliseconds per frame is the number that
    // means something here, and it is the one that tells you whether a stroke
    // will feel immediate.
    const now = performance.now();
    const f = frames.current;
    f.n++;
    if (f.t) setFps(Math.round(now - f.t));
    f.t = now;
  }, [viewRect]);

  // The scheduled frame must call the LATEST draw, not the one that was current
  // when the frame was booked.
  //
  // This is why the view came up black. On mount the size is 0×0, the size effect
  // books a frame, and then the real size arrives — but `request()` sees a frame
  // already booked and returns, and the booked frame then runs the OLD closure,
  // which draws a 1×1 canvas. Nothing ever asks again, so the canvas stays empty
  // for the life of the component. A ref indirection costs nothing and removes
  // the whole class of bug.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  /**
   * A frame pump that does not trust `requestAnimationFrame`.
   *
   * This is the actual bug, and the diagnostic badge caught it: `dibujos 1`.
   * ONE frame, ever. The first one landed through the rescue interval; then that
   * interval switched itself off — "a frame has landed, my job is done" — and
   * every later `request()` booked a rAF that never fired. Because the guard is
   * `if (raf.current) return`, the very first unfired booking wedges the view
   * shut forever: zero fps, a dead mouse wheel, and a brush that changes the data
   * without ever changing the picture. All three symptoms, one cause.
   *
   * Why rAF does not fire here I still do not know — it is an Electron window
   * that believes it is not being composited, most likely — and after five
   * attempts the honest move is to stop depending on it. So: a flag says a draw
   * is wanted, rAF is tried because when it works it is the right clock, and a
   * permanent timer draws whatever rAF did not. If a booked frame is overdue,
   * rAF is declared dead and never used again.
   */
  const needsDraw = useRef(false);
  const rafAlive = rafAliveRef;
  const bookedAt = useRef(0);
  const request = useCallback(() => {
    needsDraw.current = true;
    if (!rafAlive.current || raf.current) return;
    bookedAt.current = performance.now();
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (!needsDraw.current) return;
      needsDraw.current = false;
      drawRef.current();
    });
  }, []);
  requestRef.current = request;

  useEffect(() => { request(); }, [request, size.w, size.h, glTick]);

  useEffect(() => {
    const id = window.setInterval(() => {
      // A frame booked and not delivered inside a tenth of a second is not a
      // slow frame, it is a frame that is not coming.
      if (raf.current && performance.now() - bookedAt.current > 120) {
        rafAlive.current = false;
        cancelAnimationFrame(raf.current);
        raf.current = 0;
        setDiag((d) => (d.startsWith('reloj') ? d : 'reloj propio · el navegador no entrega fotogramas'));
      }
      if (!needsDraw.current) return;
      needsDraw.current = false;
      drawRef.current();
    }, 16);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  // ---- pointer -------------------------------------------------------------
  const toCell = useCallback((clientX: number, clientY: number): Pt | null => {
    const host = hostRef.current;
    if (!host) return null;
    const r = host.getBoundingClientRect();
    const v = viewRect();
    return {
      x: v.x + ((clientX - r.left) / r.width) * v.w,
      y: v.y + ((clientY - r.top) / r.height) * v.h,
    };
  }, [viewRect]);

  const neighbourMean = useCallback((i: number) => {
    const W = world.width, H = world.height;
    const x = i % W, y = (i / W) | 0;
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        sum += world.elevation[yy * W + ((x + dx + W) % W)];
        n++;
      }
    }
    return n ? sum / n : world.elevation[i];
  }, [world]);

  const startStroke = useCallback(() => {
    const t = toolRef.current;
    if (t.mode !== 'terrain' && t.mode !== 'land') return false;
    stroke.current = new LiveStroke(world.width, world.height, world.elevation, {
      radius: t.radius, strength: t.strength, softness: t.softness,
    });
    return true;
  }, [world]);

  const strokeRule = useCallback(() => {
    const t = toolRef.current;
    const W = world.width, H = world.height;
    const uv = (i: number) => ({ u: ((i % W) + 0.5) / W, v: (((i / W) | 0) + 0.5) / H });
    if (t.mode === 'land') {
      return landRule(t.landOp, t.strength, (i) => {
        const { u, v } = uv(i);
        return 0.72 + 0.62 * noise.coast.fbm(u, v, 34, 4);
      });
    }
    return terrainRule(t.terrainOp, t.strength, neighbourMean, (i) => {
      const { u, v } = uv(i);
      return noise.rough.fbm(u, v, 90, 3);
    });
  }, [world.width, world.height, noise, neighbourMean]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointerCount.current++;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = toCell(e.clientX, e.clientY);
    if (!p) return;
    const t = toolRef.current;
    const wantsPaint = e.button === 0 && !e.shiftKey && t.mode !== 'off';
    if (wantsPaint && startStroke()) {
      const rule = strokeRule();
      const step = stroke.current!.extend(p, rule);
      glRef.current?.uploadRect(world.elevation, null, step.x0, step.y0, step.x1 - step.x0 + 1, step.y1 - step.y0 + 1);
      cursor.current = p;
      request();
      return;
    }
    if (wantsPaint && (t.mode === 'marker' || t.mode === 'label' || t.mode === 'erase' || t.mode === 'biome' || t.mode === 'river')) return;
    drag.current = { x: e.clientX, y: e.clientY, cu: view.current.cu, cv: view.current.cv };
  }, [toCell, startStroke, strokeRule, world.elevation, request]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const p = toCell(e.clientX, e.clientY);
    if (p) {
      cursor.current = p;
      if (onHover) {
        const W = world.width;
        const xi = ((Math.round(p.x) % W) + W) % W;
        const yi = Math.min(world.height - 1, Math.max(0, Math.round(p.y)));
        onHover({ x: xi, y: yi, elevation: world.elevation[yi * W + xi] });
      }
    }
    const st = stroke.current;
    if (st && p) {
      const rule = strokeRule();
      const step = st.extend(p, rule);
      // Only the rectangle this move dirtied goes to the GPU. That is the whole
      // difference between sculpting and waiting.
      glRef.current?.uploadRect(world.elevation, null, step.x0, step.y0, step.x1 - step.x0 + 1, step.y1 - step.y0 + 1);
      request();
      return;
    }
    const d = drag.current;
    const host = hostRef.current;
    if (d && host) {
      const v = viewRect();
      view.current.cu = d.cu - ((e.clientX - d.x) / host.clientWidth) * (v.w / world.width);
      view.current.cv = Math.min(1, Math.max(0, d.cv - ((e.clientY - d.y) / host.clientHeight) * (v.h / world.height)));
    }
    request();
  }, [toCell, strokeRule, world, viewRect, request, onHover]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const st = stroke.current;
    stroke.current = null;
    drag.current = null;
    if (!st) {
      // A click with a marker/label/erase tool: one edit, no live preview needed.
      const p = toCell(e.clientX, e.clientY);
      const t = toolRef.current;
      if (!p) return;
      if (t.mode === 'marker') {
        onEdit(t.marker === 'ruin'
          ? { kind: 'marker', marker: 'ruin', x: p.x, y: p.y, ruin: t.ruin }
          : { kind: 'marker', marker: 'settlement', x: p.x, y: p.y, rank: t.rank });
      } else if (t.mode === 'label' && t.labelText.trim()) {
        onEdit({ kind: 'label', x: p.x, y: p.y, text: t.labelText.trim(), style: t.labelStyle });
      } else if (t.mode === 'erase') {
        onEdit({ kind: 'eraseMarkers', x: p.x, y: p.y, radius: t.radius });
      } else if (t.mode === 'biome') {
        onEdit({ kind: 'biome', biome: t.biome, stroke: { pts: [p], radius: t.radius, strength: t.strength, softness: t.softness } });
      }
      return;
    }
    // Roll the preview back and hand the stroke to the session, which replays it
    // from the pristine snapshot. The preview and the replay agree cell for cell;
    // rolling back anyway means that if they ever stop agreeing, the authoritative
    // one wins and the drift cannot accumulate.
    st.rollback();
    const t = toolRef.current;
    const strokeSpec = { pts: st.pts, radius: t.radius, strength: t.strength, softness: t.softness };
    if (t.mode === 'terrain') onEdit({ kind: 'terrain', op: t.terrainOp, stroke: strokeSpec });
    else if (t.mode === 'land') onEdit({ kind: 'land', op: t.landOp, stroke: strokeSpec });
  }, [toCell, onEdit]);

  // Wheel zoom, bound natively so preventDefault works.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelCount.current++;
      const r = host.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      const v = viewRect();
      const wu = (v.x + px * v.w) / world.width;
      const wv = (v.y + py * v.h) / world.height;
      view.current.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.current.zoom * Math.pow(1.0022, -e.deltaY)));
      const nv = viewRect();
      view.current.cu = wu + (0.5 - px) * (nv.w / world.width);
      view.current.cv = Math.min(1, Math.max(0, wv + (0.5 - py) * (nv.h / world.height)));
      request();
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [viewRect, world.width, world.height, request]);

  // Deliberately NO early return for a WebGL failure any more. Returning a
  // message instead of the view removed the canvas from the DOM, which meant the
  // 2D fallback had nothing to draw into — a safety net that unhooks itself the
  // moment it is needed. The notice goes over the working view instead.

  return (
    <div
      ref={hostRef}
      className={`absolute inset-0 overflow-hidden touch-none ${tool.mode === 'off' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { cursor.current = null; onHover?.(null); request(); }}
      onPointerCancel={() => {
        stroke.current?.rollback();
        stroke.current = null;
        drag.current = null;
        glRef.current?.uploadAll(world.elevation, world.biome);
        request();
      }}
    >
      <canvas ref={canvasRef} className="block" style={{ width: '100%', height: '100%' }} />
      {soft && (
        <div className="absolute left-2 top-2 max-w-sm px-2 py-1 rounded bg-black/60 text-[10px] text-amber-200/90 pointer-events-none leading-snug">
          Modo compatible: esta máquina no ha entregado ningún fotograma por WebGL, así que el
          relieve se dibuja por CPU. Se esculpe igual, sólo va algo más lento.
          {failed ? ` (${failed})` : ''}
        </div>
      )}
      <div className="absolute left-2 bottom-2 flex gap-2 pointer-events-none">
        <span className="px-2 py-0.5 rounded bg-black/45 text-[10px] text-white/80 tabular-nums">
          {fps ? `${fps} ms/fotograma` : '—'}
        </span>
        <span className="px-2 py-0.5 rounded bg-black/45 text-[10px] text-white/70">
          esculpir · rueda para zoom · Mayús o botón central para mover
        </span>
        <span className="px-2 py-0.5 rounded bg-amber-500/25 text-[10px] text-amber-200/90 tabular-nums">
          {diag}
        </span>
      </div>
    </div>
  );
}
