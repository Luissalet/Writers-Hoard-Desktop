import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorldData } from '../core/types';
import type { HumanGeography, Settlement } from '../core/settlements';
import { renderCartoCanvas, pickSettlement } from '../cartography/texture';
import type { CartoLayers, CartoView } from '../cartography/render';
import type { CartoTheme } from '../cartography/theme';

/**
 * Pan/zoom viewer for the hand-drawn cartographic map.
 *
 * A full cartographic render costs 1–3 s, far too slow to run per frame, so the
 * component keeps the last rendered bitmap and transforms it during the gesture
 * — the map stretches and slides instantly — then re-renders at the new view
 * once the pointer has been still for a moment. That is the same trick a slippy
 * map uses with tiles, minus the tiles.
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
  /** Fires when the reader clicks near a settlement. */
  onPickSettlement?: (s: Settlement) => void;
  /** Reports the live view so the parent can drive an export at the same framing. */
  onViewChange?: (view: CartoView) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 22;
const SETTLE_MS = 240;

export default function CartoMap({
  world, theme, geography, layers, density, reliefAmount, title, subtitle,
  onPickSettlement, onViewChange,
}: CartoMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);

  // zoom + centre in normalized world coordinates
  const [zoom, setZoom] = useState(1);
  const [centre, setCentre] = useState({ u: 0.5, v: 0.5 });

  // What the last full render covered, so the interim transform knows its base.
  const baseRef = useRef<{ canvas: HTMLCanvasElement; view: CartoView } | null>(null);
  const timerRef = useRef<number | null>(null);
  const dragRef = useRef<{ x: number; y: number; u: number; v: number; moved: boolean } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: host.clientWidth, h: host.clientHeight });
    });
    ro.observe(host);
    setSize({ w: host.clientWidth, h: host.clientHeight });
    return () => ro.disconnect();
  }, []);

  /** The source rect implied by the current zoom/centre, clamped to the world. */
  const viewFor = useCallback((z: number, c: { u: number; v: number }): CartoView => {
    const W = world.width, H = world.height;
    // Height is the binding constraint: the world is 2:1 and the viewport is not.
    const aspect = size.w > 0 && size.h > 0 ? size.w / size.h : 2;
    let vh = H / z;
    let vw = vh * aspect;
    if (vw > W) { vw = W; vh = vw / aspect; }
    if (vh > H) { vh = H; vw = vh * aspect; }
    const y = Math.min(H - vh, Math.max(0, c.v * H - vh / 2));
    // x wraps, so it needs no clamping at all.
    const x = c.u * W - vw / 2;
    return { x, y, w: vw, h: vh };
  }, [world.width, world.height, size.w, size.h]);

  const view = useMemo(() => viewFor(zoom, centre), [viewFor, zoom, centre]);

  useEffect(() => { onViewChange?.(view); }, [view, onViewChange]);

  /** Full render, scheduled after the gesture settles. */
  const renderNow = useCallback(() => {
    if (size.w < 8 || size.h < 8) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(size.w * dpr), h = Math.round(size.h * dpr);
    setBusy(true);
    // Yield a frame so the spinner paints before the synchronous render blocks.
    requestAnimationFrame(() => {
      const v = viewFor(zoom, centre);
      const off = renderCartoCanvas(world, {
        theme, width: w, height: h, view: v, layers, density, reliefAmount,
        title, subtitle, geography,
        typeScale: dpr > 1 ? 1 : 0.92,
      });
      baseRef.current = { canvas: off, view: v };
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = `${size.w}px`;
        canvas.style.height = `${size.h}px`;
        canvas.getContext('2d')?.drawImage(off, 0, 0);
      }
      setBusy(false);
    });
  }, [world, theme, geography, layers, density, reliefAmount, title, subtitle, size.w, size.h, zoom, centre, viewFor]);

  /** Cheap interim paint: stretch the last bitmap to the new view. */
  const paintInterim = useCallback(() => {
    const base = baseRef.current;
    const canvas = canvasRef.current;
    if (!base || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const v = viewFor(zoom, centre);
    const k = base.view.w / v.w;
    // Horizontal offset must respect the seam: pick the shift nearest zero.
    let dx = base.view.x - v.x;
    const W = world.width;
    while (dx > W / 2) dx -= W;
    while (dx < -W / 2) dx += W;
    const sx = (dx / v.w) * canvas.width;
    const sy = ((base.view.y - v.y) / v.h) * canvas.height;
    ctx.save();
    ctx.fillStyle = theme.paper.base;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base.canvas, sx, sy, canvas.width * k, canvas.height * k);
    ctx.restore();
  }, [viewFor, zoom, centre, world.width, theme.paper.base]);

  /** Debounced full render; interim paint happens immediately. */
  const schedule = useCallback(() => {
    paintInterim();
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      renderNow();
    }, SETTLE_MS);
  }, [paintInterim, renderNow]);

  // Re-render immediately when anything other than the view changes.
  useEffect(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    renderNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, theme, geography, JSON.stringify(layers), density, reliefAmount, size.w, size.h]);

  // Re-render (debounced) when the view changes.
  useEffect(() => {
    if (!baseRef.current) return;
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, centre]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  // ---- interaction ---------------------------------------------------------
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const v = viewFor(zoom, centre);
    // World point under the cursor, held fixed across the zoom.
    const wu = (v.x + px * v.w) / world.width;
    const wv = (v.y + py * v.h) / world.height;

    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.pow(1.0022, -e.deltaY)));
    const nv = viewFor(next, centre);
    setZoom(next);
    setCentre({
      u: wu + (0.5 - px) * (nv.w / world.width),
      v: Math.min(1, Math.max(0, wv + (0.5 - py) * (nv.h / world.height))),
    });
  }, [zoom, centre, viewFor, world.width, world.height]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, u: centre.u, v: centre.v, moved: false };
  }, [centre]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    const host = hostRef.current;
    if (!d || !host) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    const v = viewFor(zoom, centre);
    setCentre({
      u: d.u - (dx / host.clientWidth) * (v.w / world.width),
      v: Math.min(1, Math.max(0, d.v - (dy / host.clientHeight) * (v.h / world.height))),
    });
  }, [zoom, centre, viewFor, world.width, world.height]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved || !geography || !onPickSettlement) return;
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const v = viewFor(zoom, centre);
    const u = ((v.x + ((e.clientX - rect.left) / rect.width) * v.w) / world.width) % 1;
    const vv = (v.y + ((e.clientY - rect.top) / rect.height) * v.h) / world.height;
    // Click tolerance shrinks as you zoom in — 18 screen pixels, in cells.
    const tol = (18 / rect.width) * v.w;
    const s = pickSettlement(world, geography, (u + 1) % 1, vv, Math.max(6, tol));
    if (s) onPickSettlement(s);
  }, [geography, onPickSettlement, viewFor, zoom, centre, world]);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 overflow-hidden touch-none"
      style={{ cursor: dragRef.current?.moved ? 'grabbing' : 'grab' }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragRef.current = null; }}
    >
      <canvas ref={canvasRef} className="block" />

      <div className="absolute left-2 bottom-2 flex items-center gap-2 pointer-events-none">
        <span className="px-2 py-0.5 rounded bg-black/45 text-[10px] text-white/80 tabular-nums">
          ×{zoom.toFixed(1)}
        </span>
        {busy && (
          <span className="px-2 py-0.5 rounded bg-black/45 text-[10px] text-white/80">
            dibujando…
          </span>
        )}
      </div>

      <div className="absolute right-2 bottom-2 flex flex-col gap-1">
        <ZoomBtn label="+" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.6))} />
        <ZoomBtn label="−" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.6))} />
        <ZoomBtn
          label="⌖"
          title="Encuadrar el mundo"
          onClick={() => { setZoom(1); setCentre({ u: 0.5, v: 0.5 }); }}
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
      className="w-7 h-7 grid place-items-center rounded bg-black/45 text-white/85 text-sm hover:bg-black/60 transition"
    >
      {label}
    </button>
  );
}
