import { useMemo, useState } from 'react';
import { Biome, EXOTIC_BIOMES, type WorldParams } from '../core/types';
import { BIOME_LABEL_ES, DEFAULT_FILTERS, type GenerationFilters } from '../core/generation';
import { BIOME_COLORS } from '../core/render';
import { RUIN_KIND_KEY, RUIN_SITE_KEY } from '../core/ruins';
import { useTranslation } from '@/i18n/useTranslation';

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
    title: 'worldgen.filters.group.forest',
    ids: [Biome.TemperateForest, Biome.BorealForest, Biome.TropicalForest, Biome.TropicalRainforest,
      Biome.TemperateRainforest, Biome.MonsoonForest, Biome.MontaneForest, Biome.CloudForest,
      Biome.RiparianForest, Biome.Bamboo, Biome.Karst],
  },
  {
    title: 'worldgen.filters.group.open',
    ids: [Biome.Grassland, Biome.Savanna, Biome.Steppe, Biome.Shrubland, Biome.Chaparral,
      Biome.ThornScrub, Biome.Moor, Biome.Tundra, Biome.AlpineMeadow],
  },
  {
    title: 'worldgen.filters.group.arid',
    ids: [Biome.Desert, Biome.Erg, Biome.Reg, Biome.Badlands, Biome.ColdDesert, Biome.SaltFlat,
      Biome.FogDesert, Biome.Puna],
  },
  {
    title: 'worldgen.filters.group.waterIce',
    ids: [Biome.Marsh, Biome.PeatBog, Biome.SaltMarsh, Biome.Mangrove, Biome.Beach,
      Biome.Glacier, Biome.IceCap, Biome.Alpine],
  },
  {
    title: 'worldgen.filters.group.fireRock',
    ids: [Biome.Volcanic, Biome.AshPlain],
  },
  {
    title: 'worldgen.filters.group.exotic',
    ids: EXOTIC_BIOMES,
  },
];

const RUIN_KINDS = ['city', 'fort', 'tower', 'temple', 'stones', 'bridge', 'mine', 'wall'] as const;
const RUIN_SITES = ['harbour', 'pass', 'confluence', 'summit', 'island', 'oasis', 'ford',
  'mineral', 'holy', 'strait', 'cape'] as const;
const LANDFORMS: { id: string; label: string }[] = [
  { id: 'cape', label: 'worldgen.filters.landform.cape' }, { id: 'bay', label: 'worldgen.filters.landform.bay' },
  { id: 'fjord', label: 'worldgen.filters.landform.fjord' },
  { id: 'strait', label: 'worldgen.filters.landform.strait' }, { id: 'isthmus', label: 'worldgen.filters.landform.isthmus' },
  { id: 'peninsula', label: 'worldgen.filters.landform.peninsula' }, { id: 'delta', label: 'worldgen.filters.landform.delta' },
  { id: 'pass', label: 'worldgen.filters.landform.pass' }, { id: 'valley', label: 'worldgen.filters.landform.valley' },
  { id: 'gorge', label: 'worldgen.filters.landform.gorge' },
];
const LANDMARKS: { id: string; label: string }[] = [
  { id: 'volcano', label: 'worldgen.filters.landmark.volcano' }, { id: 'cave', label: 'worldgen.filters.landmark.cave' },
  { id: 'waterfall', label: 'worldgen.filters.landmark.waterfall' }, { id: 'gorge', label: 'worldgen.filters.landmark.gorge' },
  { id: 'hotspring', label: 'worldgen.filters.landmark.hotspring' },
];

/** How many switches in a map are off — the number the collapsed header shows. */
function offIn(map: Record<string | number, boolean>): number {
  return Object.values(map).filter((v) => v === false).length;
}

export default function FiltersPanel({ params, onChange, onGenerate, generating, hasWorld }: FiltersPanelProps) {
  const { t } = useTranslation();
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

  const offBiomes = useMemo(() => offIn(f.biomes), [f.biomes]);
  const offRuins = useMemo(() => offIn(f.ruinKinds) + offIn(f.ruinSites), [f.ruinKinds, f.ruinSites]);
  const offLandforms = useMemo(() => offIn(f.landforms), [f.landforms]);
  const offLandmarks = useMemo(() => offIn(f.landmarks), [f.landmarks]);

  return (
    /* The whole panel used to be nine- and ten-pixel type at a third opacity in
       a 320 px column — legible in a screenshot at 200 %, not on a monitor. It
       is now one readable size, and every group is a row you open, so the
       column shows five headings instead of two hundred switches. */
    <div className="flex flex-col gap-2 text-xs text-white/85">
      <p className="text-[11px] text-white/60 leading-relaxed">
        {t('worldgen.filters.introBefore')}{' '}
        <strong className="text-white/90">{t('worldgen.filters.introStrong')}</strong>{' '}
        {t('worldgen.filters.introAfter')}
      </p>

      <Section title={t('worldgen.filters.biomes')} off={offBiomes}>
        <div className="flex flex-col gap-2">
          {GROUPS.map((g) => {
            const exoticGroup = g.title === 'worldgen.filters.group.exotic';
            return (
              <div key={g.title}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">{t(g.title)}</span>
                  {exoticGroup && f.exotic <= 0 && (
                    <span className="text-[10px] text-amber-200">{t('worldgen.filters.exoticHint')}</span>
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
                        className={`flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded border text-[11px] transition ${
                          off
                            ? 'border-white/10 text-white/35 line-through'
                            : 'border-white/30 bg-white/[0.06] text-white hover:border-white/70'
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-[2px] border border-black/50"
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
        label={t('worldgen.filters.rarity')}
        hint={t('worldgen.filters.rarityHint')}
        value={f.exotic}
        min={0} max={1} step={0.05}
        format={(v) => (v <= 0 ? t('worldgen.filters.rarityOff') : `${Math.round(v * 100)} %`)}
        onChange={(v) => set({ exotic: v })}
      />

      <Section title={t('worldgen.filters.ruins')} off={offRuins}>
        <div className="flex flex-col gap-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white/60 mb-1">{t('worldgen.filters.ruinKinds')}</div>
            <div className="flex flex-wrap gap-1">
              {RUIN_KINDS.map((k) => (
                <Chip key={k} off={f.ruinKinds[k] === false} onClick={() => set({ ruinKinds: toggleIn(f.ruinKinds, k) })}>
                  {t(RUIN_KIND_KEY[k])}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white/60 mb-1">{t('worldgen.filters.ruinSites')}</div>
            <div className="flex flex-wrap gap-1">
              {RUIN_SITES.map((k) => (
                <Chip key={k} off={f.ruinSites[k] === false} onClick={() => set({ ruinSites: toggleIn(f.ruinSites, k) })}>
                  {t(RUIN_SITE_KEY[k])}
                </Chip>
              ))}
            </div>
          </div>
          <Slider
            label={t('worldgen.filters.ruinDensity')}
            value={f.ruinDensity}
            min={0} max={3} step={0.1}
            format={(v) => (v === 0 ? t('worldgen.filters.ruinsNone') : `×${v.toFixed(1)}`)}
            onChange={(v) => set({ ruinDensity: v })}
          />
        </div>
      </Section>

      <Section title={t('worldgen.filters.landforms')} off={offLandforms}>
        <div className="flex flex-wrap gap-1">
          {LANDFORMS.map((l) => (
            <Chip key={l.id} off={f.landforms[l.id] === false} onClick={() => set({ landforms: toggleIn(f.landforms, l.id) })}>
              {t(l.label)}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title={t('worldgen.filters.landmarks')} off={offLandmarks}>
        <div className="flex flex-wrap gap-1">
          {LANDMARKS.map((l) => (
            <Chip key={l.id} off={f.landmarks[l.id] === false} onClick={() => set({ landmarks: toggleIn(f.landmarks, l.id) })}>
              {t(l.label)}
            </Chip>
          ))}
        </div>
      </Section>

      <div className="h-px bg-white/10" />
      <div className="flex items-center gap-2">
        <button
          onClick={() => { onChange({ ...params, filters: { ...DEFAULT_FILTERS } }); setDirty(true); }}
          className="px-3 py-2 rounded bg-white/10 hover:bg-white/20 text-[11px] text-white"
        >
          {t('worldgen.filters.reset')}
        </button>
        <button
          onClick={() => { onGenerate(); setDirty(false); }}
          disabled={generating}
          className="flex-1 px-3 py-2 rounded bg-amber-400 text-black font-semibold text-[11px] hover:bg-amber-300 disabled:opacity-40 transition"
        >
          {generating
            ? t('worldgen.filters.generating')
            : hasWorld ? t('worldgen.filters.regenerate') : t('worldgen.filters.generate')}
        </button>
      </div>
      {dirty && hasWorld && (
        // Said plainly, because the alternative is a reader who changes ten
        // switches, sees nothing happen, and concludes the panel is broken.
        <p className="text-[11px] text-amber-200 leading-snug">
          {t('worldgen.filters.dirtyNote')}
        </p>
      )}
    </div>
  );
}

/**
 * One collapsible group.
 *
 * Closed by default and closed on purpose: the reader opens this panel to change
 * one thing, and a wall of two hundred chips is not a list of options, it is a
 * texture. The header carries the count of what is switched off inside, so a
 * shut group still tells you whether you have touched it.
 */
function Section({ title, off = 0, children, defaultOpen = false }: {
  title: string; off?: number; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-white/12 bg-white/[0.03] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs font-medium text-white/85 hover:bg-white/[0.06] transition"
      >
        <span
          className={`text-white/50 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▸
        </span>
        <span className="flex-1">{title}</span>
        {off > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-200 text-[10px] tabular-nums">
            {(off === 1 ? t('worldgen.filters.offCount.one') : t('worldgen.filters.offCount.other'))
              .replace('{n}', String(off))}
          </span>
        )}
      </button>
      {open && <div className="px-2.5 pb-2.5 pt-0.5">{children}</div>}
    </div>
  );
}

function Chip({ off, onClick, children }: { off: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded border text-[11px] transition ${
        off
          ? 'border-white/10 bg-transparent text-white/35 line-through'
          : 'border-white/30 bg-white/[0.06] text-white hover:border-white/70'
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
      <span className="flex justify-between text-[11px] text-white/75">
        <span>{label}</span>
        <span className="tabular-nums text-white">{format(value)}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-400"
      />
      {hint && <span className="text-[10px] text-white/55 leading-snug">{hint}</span>}
    </label>
  );
}
