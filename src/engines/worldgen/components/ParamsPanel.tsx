import { useId } from 'react';
import { Check, Dices, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { WorldParams } from '../core/types';
import { WORLD_PRESETS, applyWorldPreset, matchesWorldPreset } from '../core/presets';
import { worldWorkspaceCopy } from '../workspaceCopy';

interface ParamsPanelProps {
  params: WorldParams;
  onChange: (params: WorldParams) => void;
  onGenerate: () => void;
  onRandomSeed: () => void;
  generating: boolean;
  hasWorld: boolean;
  onCreateAlternative?: () => void;
  onReset?: () => void;
}

export default function ParamsPanel({
  params, onChange, onGenerate, onRandomSeed, generating, hasWorld, onCreateAlternative, onReset,
}: ParamsPanelProps) {
  const { t, locale } = useTranslation();
  const copy = worldWorkspaceCopy(locale);
  const seedId = useId();
  const preset = WORLD_PRESETS.find((candidate) => matchesWorldPreset(params, candidate));

  const set = <K extends keyof WorldParams>(key: K, value: WorldParams[K]) =>
    onChange({ ...params, [key]: value });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-text-primary">{t('worldgen.params.startWithShape')}</h3>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{t('worldgen.params.startWithShapeHint')}</p>
      </div>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={t('worldgen.preset.title')}>
        {WORLD_PRESETS.map((p) => {
          const selected = preset?.id === p.id;
          return (
            <button
              key={p.id}
              aria-pressed={selected}
              disabled={generating}
              onClick={() => onChange(applyWorldPreset(params, p))}
              className={`flex min-h-10 items-center justify-between gap-1 rounded-lg border px-2.5 py-2 text-left text-xs transition disabled:opacity-50 ${selected ? 'border-accent-gold/60 bg-accent-gold/10 text-accent-gold' : 'border-border text-text-primary hover:bg-elevated'}`}
            >
              {t(`worldgen.preset.${p.id}`)}
              {selected && <Check size={13} className="shrink-0" />}
            </button>
          );
        })}
      </div>
      <p className="text-xs leading-relaxed text-text-muted">
        {t(preset ? `worldgen.preset.${preset.id}.hint` : 'worldgen.params.customHint')}
      </p>
      {/* Seed */}
      <div>
        <label htmlFor={seedId} className="text-xs text-text-muted block mb-1.5">
          {t('worldgen.params.seed')}
        </label>
        <div className="flex gap-1.5">
          <input
            id={seedId}
            value={params.seed}
            disabled={generating}
            onChange={(e) => set('seed', e.target.value)}
            className="flex-1 min-w-0 bg-elevated border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-gold/60"
          />
          <button
            onClick={onRandomSeed}
            title={t('worldgen.params.randomSeed')}
            aria-label={t('worldgen.params.randomSeed')}
            disabled={generating}
            className="p-2 rounded-lg border border-border bg-elevated text-text-muted hover:text-accent-gold hover:border-accent-gold/50 transition"
          >
            <Dices size={14} />
          </button>
        </div>
      </div>

      {/* Resolution */}
      <div>
        <p className="text-xs text-text-muted block mb-1.5">
          {t('worldgen.params.resolution')}
        </p>
        <div className="flex rounded-lg border border-border overflow-hidden" role="group" aria-label={t('worldgen.params.resolution')}>
          {([[1024, 'Fast'], [2048, 'Standard'], [3072, 'High']] as const).map(([w, key]) => (
            <button
              key={w}
              disabled={generating}
              aria-pressed={params.width === w}
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
        <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{t('worldgen.params.resolutionHint')}</p>
      </div>

      <details className="border-y border-border py-3">
        <summary className="cursor-pointer text-sm font-medium text-text-primary">{t('worldgen.params.advanced')}</summary>
        <fieldset disabled={generating} className="mt-4 space-y-4 disabled:opacity-50">
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
      <Slider label={t('worldgen.params.coastalComplexity')} value={params.coastalComplexity} min={0} max={1} step={0.05}
        display={pct(params.coastalComplexity)} onChange={(v) => set('coastalComplexity', v)} />
      <Slider label={t('worldgen.params.glaciation')} value={params.glaciation} min={0} max={1} step={0.05}
        display={pct(params.glaciation)} onChange={(v) => set('glaciation', v)} />

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
        </fieldset>
      </details>

      {hasWorld && onCreateAlternative && <div className="space-y-2">
        <button disabled={generating} onClick={onCreateAlternative} className="w-full rounded-lg bg-accent-gold px-4 py-2.5 text-sm font-semibold text-deep hover:bg-accent-amber disabled:opacity-50">{copy.alternative}</button>
        <p className="text-xs leading-relaxed text-text-muted">{copy.alternativeHint}</p>
      </div>}
      <button
        onClick={onGenerate}
        disabled={generating}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border text-text-primary text-sm font-semibold hover:bg-elevated transition disabled:opacity-50"
      >
        <Sparkles size={15} />
        {generating
          ? t('worldgen.generating')
          : hasWorld
            ? t('worldgen.regenerate')
            : t('worldgen.generate')}
      </button>
      {onReset && <button disabled={generating} onClick={onReset} className="text-xs text-text-muted underline underline-offset-4 hover:text-text-primary disabled:opacity-50">{copy.reset}</button>}
      <p className="text-xs text-text-muted leading-relaxed">
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
  const id = useId();
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor={id} className="text-xs text-text-muted">{label}</label>
        <span className="text-[11px] font-mono text-text-muted">{display}</span>
      </div>
      <input
        id={id}
        aria-valuetext={display}
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
