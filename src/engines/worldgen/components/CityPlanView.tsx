import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dices, Download, Trash2, X } from 'lucide-react';
import { saveAs } from 'file-saver';
import type { WorldData } from '../core/types';
import type { Settlement } from '../core/settlements';
import { generateCity, type CityParams, type CityPlan } from '../city/generate';
import { renderCity } from '../city/render';
import { cityParamsFor } from '../cartography/texture';
import type { CartoTheme } from '../cartography/theme';
import type { Ctx } from '../cartography/symbols';
import EditableName from './EditableName';

/**
 * City plan panel. A settlement's plan is derived from its own id, so the same
 * town always yields the same streets — which is the whole point: the reader can
 * write about a place and find it unchanged next session. The dice button
 * re-rolls a variant without losing that default.
 */

interface CityPlanViewProps {
  world: WorldData;
  settlement: Settlement;
  theme: CartoTheme;
  onClose: () => void;
  /**
   * Rename this town. Absent means the caller cannot take edits — the name then
   * simply reads as text rather than pretending to be editable.
   */
  onRename?: (name: string) => void;
  /** Delete this town from the world. The modal closes itself afterwards. */
  onDelete?: () => void;
}

export default function CityPlanView({ world, settlement, theme, onClose, onRename, onDelete }: CityPlanViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [variant, setVariant] = useState(0);
  const [overrides, setOverrides] = useState<Partial<CityParams>>({});

  const base = useMemo(() => cityParamsFor(world, settlement), [world, settlement]);

  const plan: CityPlan = useMemo(() => generateCity({
    ...base,
    ...overrides,
    seed: variant === 0 ? base.seed : `${base.seed}::v${variant}`,
  }), [base, overrides, variant]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => setSize({ w: host.clientWidth, h: host.clientHeight }));
    ro.observe(host);
    setSize({ w: host.clientWidth, h: host.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 8 || size.h < 8) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderCity(plan, ctx as unknown as Ctx, {
      theme, width: canvas.width, height: canvas.height,
    });
  }, [plan, theme, size.w, size.h]);

  const exportPng = useCallback(() => {
    const out = document.createElement('canvas');
    out.width = 2200;
    out.height = 2200;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    renderCity(plan, ctx as unknown as Ctx, { theme, width: out.width, height: out.height });
    out.toBlob((blob) => {
      if (blob) saveAs(blob, `${plan.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-plano.png`);
    }, 'image/png');
  }, [plan, theme]);

  const buildings = useMemo(
    () => plan.patches.reduce((n, p) => n + p.buildings.length, 0),
    [plan],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex flex-col w-full max-w-5xl h-[min(92vh,900px)] rounded-xl border border-border bg-deep overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-wrap">
          <div className="min-w-0">
            {/* The town's name lives here, where the town is. */}
            <EditableName
              value={settlement.name || plan.name}
              onRename={onRename}
              className="text-sm text-text-primary"
            />
            <div className="text-[11px] text-text-muted">
              {plan.population.toLocaleString('es-ES')} hab · {buildings.toLocaleString('es-ES')} edificios
              {plan.wall ? ` · ${plan.gates.length} puertas, ${plan.towers.length} torres` : ' · sin murallas'}
            </div>
          </div>

          <div className="flex-1" />

          <Toggle label="Murallas" on={overrides.walls ?? base.walls} onClick={() => setOverrides((o) => ({ ...o, walls: !(o.walls ?? base.walls) }))} />
          <Toggle label="Ciudadela" on={overrides.citadel ?? base.citadel} onClick={() => setOverrides((o) => ({ ...o, citadel: !(o.citadel ?? base.citadel) }))} />
          <Toggle label="Río" on={overrides.river ?? base.river} onClick={() => setOverrides((o) => ({ ...o, river: !(o.river ?? base.river) }))} />
          <Toggle label="Costa" on={overrides.coast ?? base.coast} onClick={() => setOverrides((o) => ({ ...o, coast: !(o.coast ?? base.coast) }))} />

          <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
            Tamaño
            <input
              type="range" min={5} max={44} step={1}
              value={overrides.size ?? base.size}
              onChange={(e) => setOverrides((o) => ({ ...o, size: Number(e.target.value) }))}
              className="w-24 accent-accent-gold"
            />
          </label>

          {onDelete && (
            <IconBtn
              title="Quitar esta población del mundo"
              onClick={() => { onDelete(); onClose(); }}
              danger
            >
              <Trash2 size={14} />
            </IconBtn>
          )}
          <IconBtn title="Otra variante" onClick={() => setVariant((v) => v + 1)}><Dices size={14} /></IconBtn>
          <IconBtn title="Exportar PNG" onClick={exportPng}><Download size={14} /></IconBtn>
          <IconBtn title="Cerrar" onClick={onClose}><X size={14} /></IconBtn>
        </div>

        <div ref={hostRef} className="flex-1 min-h-0 relative bg-deep">
          <canvas ref={canvasRef} className="block absolute inset-0" />
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded text-[11px] border transition ${
        on
          ? 'border-accent-gold/50 bg-accent-gold/15 text-accent-gold'
          : 'border-border bg-elevated text-text-muted hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );
}

function IconBtn({ title, onClick, danger, children }: {
  title: string; onClick: () => void; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 grid place-items-center rounded border bg-elevated transition ${
        danger
          ? 'border-border text-text-muted hover:text-danger hover:border-danger/50'
          : 'border-border text-text-muted hover:text-text-primary hover:border-accent-gold/50'
      }`}
    >
      {children}
    </button>
  );
}
