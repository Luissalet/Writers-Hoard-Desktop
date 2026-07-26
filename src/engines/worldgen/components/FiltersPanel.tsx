import { useMemo, useState } from 'react';
import { Biome, EXOTIC_BIOMES, type WorldParams } from '../core/types';
import { BIOME_LABEL_ES, DEFAULT_FILTERS, type GenerationFilters } from '../core/generation';
import { BIOME_COLORS } from '../core/render';
import { RUIN_KIND_ES, RUIN_SITE_ES } from '../core/ruins';

/**
 * What this world is allowed to contain.
 *
 * Every switch here is a HARD constraint on generation, not a display filter:
 * turning off sand seas does not hide them, it produces a world that never had
 * any — the ground becomes whatever that country would have been instead. The
 * panel says so explicitly, because "hide" and "forbid" look identical in a list
 * of checkboxes and mean completely different things.
 */

interface FiltersPanelProps {
  params: WorldParams;
  onChange: (p: WorldParams) => void;
  onGenerate: () => void;
  generating: boolean;
  hasWorld: boolean;
}

const swatch = (b: number): string => {
  const c = BIOME_COLORS[b];
  return c ? `rgb(${c[0]},${c[1]},${c[2]})` : '#888';
};

const GROUPS: { title: string; ids: number[] }[] = [
  {
    title: 'Bosque',
    ids: [Biome.TemperateForest, Biome.BorealForest, Biome.TropicalForest, Biome.TropicalRainforest,
      Biome.TemperateRainforest, Biome.MonsoonForest, Biome.MontaneForest, Biome.CloudForest,
      Biome.RiparianForest, Biome.Bamboo, Biome.Karst],
  },
  {
    title: 'Abierto',
    ids: [Biome.Grassland, Biome.Savanna, Biome.Steppe, Biome.Shrubland, Biome.Chaparral,
      Biome.ThornScrub, Biome.Moor, Biome.Tundra, Biome.AlpineMeadow],
  },
  {
    title: 'Árido',
    ids: [Biome.Desert, Biome.Erg, Biome.Reg, Biome.Badlands, Biome.ColdDesert, Biome.SaltFlat,
      Biome.FogDesert, Biome.Puna],
  },
  {
    title: 'Agua y hielo',
    ids: [Biome.Marsh, Biome.PeatBog, Biome.SaltMarsh, Biome.Mangrove, Biome.Beach,
      Biome.Glacier, Biome.IceCap, Biome.Alpine],
  },
  {
    title: 'Fuego y roca',
    ids: [Biome.Volcanic, Biome.AshPlain],
  },
  {
    title: 'Extraños',
    ids: EXOTIC_BIOMES,
  },
];

const RUIN_KINDS = ['city', 'fort', 'tower', 'temple', 'stones', 'bridge', 'mine', 'wall'] as const;
const RUIN_SITES = ['harbour', 'pass', 'confluence', 'summit', 'island', 'oasis', 'ford',
  'mineral', 'holy', 'strait', 'cape'] as const;
const LANDFORMS: { id: string; label: string }[] = [
  { id: 'cape', label: 'Cabos' }, { id: 'bay', label: 'Bahías' }, { id: 'fjord', label: 'Fiordos' },
  { id: 'strait', label: 'Estrechos' }, { id: 'isthmus', label: 'Istmos' },
  { id: 'peninsula', label: 'Penínsulas' }, { id: 'delta', label: 'Deltas' },
  { id: 'pass', label: 'Pasos' }, { id: 'valley', label: 'Valles' }, { id: 'gorge', label: 'Gargantas' },
];
const LANDMARKS: { id: string; label: string }[] = [
  { id: 'volcano', label: 'Volcanes' }, { id: 'cave', label: 'Cuevas' },
  { id: 'waterfall', label: 'Cataratas' }, { id: 'gorge', label: 'Gargantas' },
  { id: 'hotspring', label: 'Termas' },
];

export default function FiltersPanel({ params, onChange, onGenerate, generating, hasWorld }: FiltersPanelProps) {
  const f: GenerationFilters = params.filters ?? DEFAULT_FILTERS;
  const [dirty, setDirty] = useState(false);
  const set = (next: Partial<GenerationFilters>) => {
    onChange({ ...params, filters: { ...f, ...next } });
    setDirty(true);
  };
  const toggleIn = (map: Record<string | number, boolean>, key: string | number) => {
    const copy = { ...map };
    if (copy[key] === false) delete copy[key];
    else copy[key] = false;
    return copy;
  };

  const offCount = useMemo(() => {
    const n = (m: Record<string | number, boolean>) => Object.values(m).filter((v) => v === false).length;
    return n(f.biomes) + n(f.ruinKinds) + n(f.ruinSites) + n(f.landforms) + n(f.landmarks);
  }, [f]);

  return (
    <div className="flex flex-col gap-3 text-[11px] text-white/80">
      <p className="text-[10px] text-white/45 leading-snug">
        Todo lo que apagues aquí <strong className="text-white/70">no existirá</strong> en el
        mundo generado. El terreno no se queda vacío: pasa a ser lo que habría sido en un mundo
        sin esa cosa — sin desiertos hay estepa, sin bosques hay pradera.
      </p>

      <Section title={`Biomas${offCount ? ` · ${offCount} apagados` : ''}`} defaultOpen>
        <div className="flex flex-col gap-2">
          {GROUPS.map((g) => {
            const exoticGroup = g.title === 'Extraños';
            return (
              <div key={g.title}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[9px] uppercase tracking-wider text-white/35">{g.title}</span>
                  {exoticGroup && f.exotic <= 0 && (
                    <span className="text-[9px] text-amber-300/70">sube “rareza” para activarlos</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {g.ids.map((b) => {
                    const off = f.biomes[b] === false || (exoticGroup && f.exotic <= 0);
                    return (
                      <button
                        key={b}
                        title={BIOME_LABEL_ES[b] ?? String(b)}
                        onClick={() => set({ biomes: toggleIn(f.biomes, b) })}
                        className={`flex items-center gap-1 pl-1 pr-1.5 py-0.5 rounded-sm border text-[9px] transition ${
                          off ? 'border-white/10 text-white/25 line-through' : 'border-white/25 text-white/80 hover:border-white/60'
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-[2px] border border-black/40"
                          style={{ background: swatch(b), opacity: off ? 0.25 : 1 }}
                        />
                        {BIOME_LABEL_ES[b] ?? b}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Slider
        label="Rareza"
        hint="0 = ecología estrictamente plausible. Por encima, aparecen bosques fúngicos, llanos de cristal y compañía."
        value={f.exotic}
        min={0} max={1} step={0.05}
        format={(v) => (v <= 0 ? 'apagada' : `${Math.round(v * 100)} %`)}
        onChange={(v) => set({ exotic: v })}
      />

      <Section title="Ruinas">
        <div className="flex flex-col gap-2">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-white/35 mb-0.5">Qué se conserva en pie</div>
            <div className="flex flex-wrap gap-1">
              {RUIN_KINDS.map((k) => (
                <Chip key={k} off={f.ruinKinds[k] === false} onClick={() => set({ ruinKinds: toggleIn(f.ruinKinds, k) })}>
                  {RUIN_KIND_ES[k]}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-white/35 mb-0.5">Por qué había algo ahí</div>
            <div className="flex flex-wrap gap-1">
              {RUIN_SITES.map((k) => (
                <Chip key={k} off={f.ruinSites[k] === false} onClick={() => set({ ruinSites: toggleIn(f.ruinSites, k) })}>
                  {RUIN_SITE_ES[k]}
                </Chip>
              ))}
            </div>
          </div>
          <Slider
            label="Cuántas ruinas"
            value={f.ruinDensity}
            min={0} max={3} step={0.1}
            format={(v) => (v === 0 ? 'ninguna' : `×${v.toFixed(1)}`)}
            onChange={(v) => set({ ruinDensity: v })}
          />
        </div>
      </Section>

      <Section title="Accidentes con nombre">
        <div className="flex flex-wrap gap-1">
          {LANDFORMS.map((l) => (
            <Chip key={l.id} off={f.landforms[l.id] === false} onClick={() => set({ landforms: toggleIn(f.landforms, l.id) })}>
              {l.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Hitos naturales">
        <div className="flex flex-wrap gap-1">
          {LANDMARKS.map((l) => (
            <Chip key={l.id} off={f.landmarks[l.id] === false} onClick={() => set({ landmarks: toggleIn(f.landmarks, l.id) })}>
              {l.label}
            </Chip>
          ))}
        </div>
      </Section>

      <div className="h-px bg-white/10" />
      <div className="flex items-center gap-2">
        <button
          onClick={() => { onChange({ ...params, filters: { ...DEFAULT_FILTERS } }); setDirty(true); }}
          className="px-2 py-1.5 rounded bg-white/8 hover:bg-white/15 text-[10px]"
        >
          Restablecer
        </button>
        <button
          onClick={() => { onGenerate(); setDirty(false); }}
          disabled={generating}
          className="flex-1 px-2 py-1.5 rounded bg-amber-400/85 text-black font-medium text-[10px] disabled:opacity-40"
        >
          {generating ? 'Generando…' : hasWorld ? 'Regenerar el mundo' : 'Generar'}
        </button>
      </div>
      {dirty && hasWorld && (
        // Said plainly, because the alternative is a reader who changes ten
        // switches, sees nothing happen, and concludes the panel is broken.
        <p className="text-[10px] text-amber-300/80 leading-snug">
          Estos ajustes cambian cómo se genera el mundo, así que no se ven hasta que lo regeneras.
        </p>
      )}
    </div>
  );
}

function Section({ title, children, defaultOpen = false }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between text-[10px] uppercase tracking-wider text-white/45 hover:text-white/70"
      >
        <span>{title}</span>
        <span className="text-white/30">{open ? '−' : '+'}</span>
      </button>
      {open && children}
    </div>
  );
}

function Chip({ off, onClick, children }: { off: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-1.5 py-0.5 rounded-sm border text-[9px] transition ${
        off ? 'border-white/10 text-white/25 line-through' : 'border-white/25 text-white/80 hover:border-white/60'
      }`}
    >
      {children}
    </button>
  );
}

function Slider({ label, hint, value, min, max, step, format, onChange }: {
  label: string; hint?: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex justify-between text-[10px] text-white/45">
        <span>{label}</span>
        <span className="tabular-nums text-white/65">{format(value)}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-400"
      />
      {hint && <span className="text-[9px] text-white/35 leading-snug">{hint}</span>}
    </label>
  );
}
