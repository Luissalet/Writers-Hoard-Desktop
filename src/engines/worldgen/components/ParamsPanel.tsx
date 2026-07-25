import { Dices, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { WorldParams } from '../core/types';
import { WORLD_PRESETS } from '../core/presets';

interface ParamsPanelProps {
  params: WorldParams;
  onChange: (params: WorldParams) => void;
  onGenerate: () => void;
  onRandomSeed: () => void;
  generating: boolean;
  hasWorld: boolean;
}

export default function ParamsPanel({
  params, onChange, onGenerate, onRandomSeed, generating, hasWorld,
}: ParamsPanelProps) {
  const { t } = useTranslation();

  const set = <K extends keyof WorldParams>(key: K, value: WorldParams[K]) =>
    onChange({ ...params, [key]: value });

  return (
    <div className="space-y-4">
      {/* Seed */}
      <div>
        <label className="text-[11px] uppercase tracking-wide text-text-dim block mb-1.5">
          {t('worldgen.params.seed')}
        </label>
        <div className="flex gap-1.5">
          <input
            value={params.seed}
            onChange={(e) => set('seed', e.target.value)}
            className="flex-1 min-w-0 bg-elevated border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-gold/60"
            placeholder="seed…"
          />
          <button
            onClick={onRandomSeed}
            title={t('worldgen.params.randomSeed')}
            className="p-2 rounded-lg border border-border bg-elevated text-text-muted hover:text-accent-gold hover:border-accent-gold/50 transition"
          >
            <Dices size={14} />
          </button>
        </div>
      </div>

      {/* Presets */}
      <div>
        <label className="text-[11px] uppercase tracking-wide text-text-dim block mb-1.5">
          {t('worldgen.preset.title')}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {WORLD_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => onChange({ ...params, ...p.overrides })}
              className="px-2.5 py-1 text-[11px] rounded-full border border-border bg-elevated text-text-muted hover:text-accent-gold hover:border-accent-gold/50 transition"
            >
              {t(`worldgen.preset.${p.id}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Resolution */}
      <div>
        <label className="text-[11px] uppercase tracking-wide text-text-dim block mb-1.5">
          {t('worldgen.params.resolution')}
        </label>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {([[1024, 'Fast'], [2048, 'Standard'], [3072, 'High']] as const).map(([w, key]) => (
            <button
              key={w}
              onClick={() => set('width', w)}
              className={`flex-1 px-2 py-1.5 text-[11px] transition ${
                params.width === w
                  ? 'bg-accent-gold/15 text-accent-gold'
                  : 'bg-elevated text-text-muted hover:text-text-primary'
              }`}
            >
              {t(`worldgen.params.res${key}`)}
            </button>
          ))}
        </div>
      </div>

      <Slider label={t('worldgen.params.plates')} value={params.plates} min={4} max={20} step={1}
        display={String(params.plates)} onChange={(v) => set('plates', v)} />
      <Slider label={t('worldgen.params.landRatio')} value={params.landRatio} min={0.1} max={0.6} step={0.01}
        display={`${Math.round(params.landRatio * 100)}%`} onChange={(v) => set('landRatio', v)} />
      <Slider label={t('worldgen.params.clustering')} value={params.continentClustering} min={0} max={1} step={0.05}
        display={pct(params.continentClustering)} onChange={(v) => set('continentClustering', v)} />
      <Slider label={t('worldgen.params.worldScale')} value={params.worldScale} min={0.75} max={2.5} step={0.05}
        display={`×${params.worldScale.toFixed(2)}`} onChange={(v) => set('worldScale', v)} />
      <Slider label={t('worldgen.params.mountainousness')} value={params.mountainousness} min={0} max={1} step={0.05}
        display={pct(params.mountainousness)} onChange={(v) => set('mountainousness', v)} />
      <Slider label={t('worldgen.params.ruggedness')} value={params.ruggedness} min={0} max={1} step={0.05}
        display={pct(params.ruggedness)} onChange={(v) => set('ruggedness', v)} />
      <Slider label={t('worldgen.params.erosion')} value={params.erosion} min={0} max={1} step={0.05}
        display={pct(params.erosion)} onChange={(v) => set('erosion', v)} />
      <Slider label={t('worldgen.params.temperature')} value={params.temperature} min={-10} max={10} step={0.5}
        display={`${params.temperature > 0 ? '+' : ''}${params.temperature}°C`} onChange={(v) => set('temperature', v)} />
      <Slider label={t('worldgen.params.moisture')} value={params.moisture} min={0.5} max={1.5} step={0.05}
        display={pct(params.moisture)} onChange={(v) => set('moisture', v)} />
      <Slider label={t('worldgen.params.riverDensity')} value={params.riverDensity} min={0} max={1} step={0.05}
        display={pct(params.riverDensity)} onChange={(v) => set('riverDensity', v)} />

      {/* Landmarks toggle */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={params.landmarks}
          onChange={(e) => set('landmarks', e.target.checked)}
          className="accent-[#c4973b]"
        />
        <span className="text-xs text-text-primary">{t('worldgen.params.landmarks')}</span>
      </label>

      <button
        onClick={onGenerate}
        disabled={generating}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent-gold text-deep text-sm font-semibold hover:bg-accent-amber transition disabled:opacity-50"
      >
        <Sparkles size={15} />
        {generating
          ? t('worldgen.generating')
          : hasWorld
            ? t('worldgen.regenerate')
            : t('worldgen.generate')}
      </button>
      <p className="text-[10px] text-text-dim leading-snug">
        {t('worldgen.params.determinismNote')}
      </p>
    </div>
  );
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function Slider({ label, value, min, max, step, display, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] uppercase tracking-wide text-text-dim">{label}</label>
        <span className="text-[11px] font-mono text-text-muted">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#c4973b]"
      />
    </div>
  );
}
