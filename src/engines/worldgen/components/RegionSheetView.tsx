import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, X, Loader2, Minus, Plus, Sliders } from 'lucide-react';
import { saveAs } from 'file-saver';
import type { WorldData } from '../core/types';
import type { HumanGeography, Settlement } from '../core/settlements';
import { generateRegion } from '../region/generate';
import { renderRegion } from '../region/render';
import { DEFAULT_REGION_PARAMS, type RegionData, type RegionParams, type RegionWindow } from '../region/types';
import { kmPerWorldCell } from '../region/terrain';
import type { CartoTheme } from '../cartography/theme';
import type { Ctx } from '../cartography/symbols';

/**
 * The regional sheet: the scale between the world map and the town plan.
 *
 * The sheet is DERIVED, never stored — a pure function of (world, window,
 * params) — so panning and zooming are just a different window on the same
 * country, and nothing has to be saved for the reader to find the same hamlet in
 * the same place next session.
 *
 * Regeneration is debounced rather than live because a sheet costs ~1.5 s, which
 * is fine once the reader has stopped moving and unusable while they are still
 * dragging. The previous sheet stays on screen, dimmed, until the new one lands:
 * a stale map is a far better answer to "where am I" than a spinner.
 */

interface RegionSheetViewProps {
  world: WorldData;
  geography: HumanGeography;
  theme: CartoTheme;
  /** Where to open, in world cell coordinates. */
  at: { x: number; y: number };
  onClose: () => void;
  onPickSettlement?: (s: Settlement) => void;
}

const SPANS = [30, 45, 60, 90, 120, 160, 200, 280, 400];

export default function RegionSheetView({
  world, geography, theme, at, onClose, onPickSettlement,
}: RegionSheetViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [spanIdx, setSpanIdx] = useState(4);
  const [centre, setCentre] = useState({ x: at.x, y: at.y });
  const [params, setParams] = useState<RegionParams>(DEFAULT_REGION_PARAMS);
  const [showControls, setShowControls] = useState(false);
  const [region, setRegion] = useState<RegionData | null>(null);
  const [busy, setBusy] = useState(true);
  const [stage, setStage] = useState('relieve');

  const win: RegionWindow = useMemo(
    () => ({ cx: centre.x, cy: centre.y, spanKm: SPANS[spanIdx] }),
    [centre.x, centre.y, spanIdx],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => setSize({ w: host.clientWidth, h: host.clientHeight }));
    ro.observe(host);
    setSize({ w: host.clientWidth, h: host.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ---- generation, debounced ----------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      // A frame of breathing room so the "generating" state paints before the
      // main thread disappears into the sheet.
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        try {
          const r = generateRegion(world, geography, win, {
            params,
            onProgress: (s) => { if (!cancelled) setStage(s); },
          });
          if (!cancelled) { setRegion(r); setBusy(false); }
        } catch {
          if (!cancelled) setBusy(false);
        }
      });
    }, 260);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [world, geography, win, params]);

  // ---- draw ----------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !region || size.w < 8 || size.h < 8) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderRegion(region, ctx as unknown as Ctx, {
      theme,
      width: canvas.width,
      height: canvas.height,
      typeScale: dpr,
    });
  }, [region, size.w, size.h, theme]);

  // The sheet's aspect follows the window it is drawn in, so the reader never
  // gets letterboxing or a crop — the country shown is the country that fits.
  useEffect(() => {
    if (size.w < 8 || size.h < 8) return;
    const a = size.w / size.h;
    setParams((p) => (Math.abs(p.aspect - a) < 0.02 ? p : { ...p, aspect: a }));
  }, [size.w, size.h]);

  // ---- pan and zoom --------------------------------------------------------
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const kmCell = kmPerWorldCell(world);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, cx: centre.x, cy: centre.y, moved: false };
  }, [centre.x, centre.y]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || size.w < 8) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) < 3) return;
    d.moved = true;
    const worldPerPx = (SPANS[spanIdx] / kmCell) / size.w;
    setCentre({
      x: d.cx - dx * worldPerPx,
      y: Math.min(world.height - 1, Math.max(0, d.cy - dy * worldPerPx)),
    });
  }, [size.w, spanIdx, kmCell, world.height]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || !region || !onPickSettlement) return;
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * region.width;
    const sy = ((e.clientY - rect.top) / rect.height) * region.height;
    // A town on the sheet is the same town the world map has; clicking it should
    // go on down to the street plan rather than stopping here.
    let best: { id: number; d: number } | null = null;
    for (const p of region.places) {
      if (p.kind !== 'town' || p.worldId === undefined) continue;
      const dd = Math.hypot(p.x - sx, p.y - sy);
      if (dd < 14 && (!best || dd < best.d)) best = { id: p.worldId, d: dd };
    }
    if (!best) return;
    const s = geography.settlements.find((q) => q.id === best!.id);
    if (s) onPickSettlement(s);
  }, [region, onPickSettlement, geography]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    setSpanIdx((i) => Math.min(SPANS.length - 1, Math.max(0, i + (e.deltaY > 0 ? 1 : -1))));
  }, []);

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !region) return;
    canvas.toBlob((b) => {
      if (b) saveAs(b, `${region.title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.png`);
    }, 'image/png');
  }, [region]);

  const set = (patch: Partial<RegionParams>) => setParams((p) => ({ ...p, ...patch }));

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/70 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-black/50">
        <span className="text-sm text-white/90 font-medium">
          {region?.title ?? 'Hoja regional'}
        </span>
        <span className="text-[11px] text-white/45">{region?.subtitle ?? ''}</span>
        {busy && (
          <span className="flex items-center gap-1 text-[11px] text-accent-gold/90">
            <Loader2 size={12} className="animate-spin" /> {stage}…
          </span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1 mr-2">
          <button
            onClick={() => setSpanIdx((i) => Math.max(0, i - 1))}
            disabled={spanIdx === 0}
            className="p-1 rounded bg-white/8 hover:bg-white/15 disabled:opacity-30"
            title="Acercar"
          >
            <Minus size={13} />
          </button>
          <span className="text-[11px] text-white/70 tabular-nums w-14 text-center">
            {SPANS[spanIdx]} km
          </span>
          <button
            onClick={() => setSpanIdx((i) => Math.min(SPANS.length - 1, i + 1))}
            disabled={spanIdx === SPANS.length - 1}
            className="p-1 rounded bg-white/8 hover:bg-white/15 disabled:opacity-30"
            title="Alejar"
          >
            <Plus size={13} />
          </button>
        </div>
        <button
          onClick={() => setShowControls((v) => !v)}
          className={`p-1.5 rounded ${showControls ? 'bg-accent-gold/25' : 'bg-white/8 hover:bg-white/15'}`}
          title="Ajustes de la hoja"
        >
          <Sliders size={14} />
        </button>
        <button onClick={download} className="p-1.5 rounded bg-white/8 hover:bg-white/15" title="Descargar">
          <Download size={14} />
        </button>
        <button onClick={onClose} className="p-1.5 rounded bg-white/8 hover:bg-white/15" title="Cerrar">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        <div
          ref={hostRef}
          className="relative flex-1 min-w-0 cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { drag.current = null; }}
          onWheel={onWheel}
        >
          <canvas
            ref={canvasRef}
            className="block transition-opacity duration-150"
            style={{ opacity: busy ? 0.55 : 1 }}
          />
          {!region && (
            <div className="absolute inset-0 grid place-items-center text-white/60 text-xs">
              trazando la hoja…
            </div>
          )}
          <div className="absolute left-3 bottom-3 text-[10px] text-white/55 pointer-events-none">
            arrastra para recorrer · rueda para cambiar de escala · pincha una villa para su plano
          </div>
        </div>

        {showControls && (
          <div className="w-56 shrink-0 border-l border-white/10 bg-black/50 p-3 flex flex-col gap-3 overflow-y-auto">
            <p className="text-[10px] text-white/45 leading-snug">
              La hoja se deduce del mundo: la misma semilla, la misma ventana y los mismos
              ajustes dan siempre la misma comarca.
            </p>
            <Slider label="Relieve inventado" value={params.detail} min={0} max={1.4} step={0.05}
              format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => set({ detail: v })} />
            <Slider label="Tierra roturada" value={params.settled} min={0} max={1} step={0.05}
              format={(v) => (v <= 0 ? 'yerma' : `${Math.round(v * 100)} %`)}
              onChange={(v) => set({ settled: v })} />
            <Slider label="Poblamiento" value={params.habitation} min={0.2} max={2.2} step={0.1}
              format={(v) => `×${v.toFixed(1)}`} onChange={(v) => set({ habitation: v })} />
            <Slider label="Cursos de agua" value={params.streamDensity} min={0} max={1} step={0.05}
              format={(v) => (v < 0.3 ? 'solo los ríos' : v > 0.7 ? 'hasta los arroyos' : 'normal')}
              onChange={(v) => set({ streamDensity: v })} />
            <Slider label="Resolución" value={params.res} min={384} max={1024} step={64}
              format={(v) => `${v} celdas`} onChange={(v) => set({ res: v })} />
            {region && (
              <div className="text-[10px] text-white/45 leading-relaxed border-t border-white/10 pt-2">
                {region.places.filter((p) => p.kind === 'village').length} aldeas ·
                {' '}{region.places.filter((p) => p.kind === 'hamlet').length} caseríos ·
                {' '}{region.places.filter((p) => p.kind === 'farm').length} granjas<br />
                {region.streams.length} cursos · {region.tracks.length} caminos<br />
                {region.places.filter((p) => p.kind === 'bridge').length} puentes ·
                {' '}{region.places.filter((p) => p.kind === 'ford').length} vados
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex justify-between text-[10px] text-white/45">
        <span>{label}</span>
        <span className="tabular-nums text-white/70">{format(value)}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-400"
      />
    </label>
  );
}
