// ============================================================================
// Parameters — the knobs, and the ones this model cannot turn
// ============================================================================
//
// The studio used to hide the cfg slider for FLUX by name. That instinct is
// right and the special case is not, so what decides here is
// `parameterVisibility(model)`: a field is offered when the chosen model can
// honour it and refused when it cannot.
//
// Refused, not removed. The same contract that asks the fields to answer to the
// model also says a feature that cannot run must stay visible and disabled with
// a reason — hiding it teaches the writer that this program has no cfg slider,
// and they never find out that the distilled model they picked is the reason.

import { Dices, Lock, LockOpen } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import ModelRoutePicker from '@/components/ai-settings/ModelRoutePicker';
import type { AiRouteSelection } from '@/services/aiRuntime/types';
import type { SeedMode } from '@/services/visualRef';
import type { ParameterVisibility } from '../studioModel';
import { IMAGE_SIZE_PRESETS } from '../operations';

const SAMPLERS = ['euler', 'euler_a', 'heun', 'dpm++2m', 'dpm++2s_a', 'lcm'] as const;
const SCHEDULERS = ['discrete', 'karras', 'exponential', 'ays'] as const;

export interface ParametersState {
  sizePreset: string;
  steps: string;
  cfg: string;
  sampler: string;
  scheduler: string;
  seedMode: SeedMode;
  manualSeed: string;
  batch: number;
}

export interface ParametersColumnProps {
  route?: AiRouteSelection;
  onRoute: (route: AiRouteSelection | null) => void;
  visibility: ParameterVisibility;
  value: ParametersState;
  onChange: (changes: Partial<ParametersState>) => void;
  /** False when no image model is chosen: changes what a refused field means. */
  hasModel: boolean;
  /** Whether the reference in the composer actually has a hero seed to lock to. */
  hasHeroSeed: boolean;
  nativeSize?: { width: number; height: number };
}

/** A field the model cannot honour: still there, still labelled, not usable. */
function fieldClass(enabled: boolean): string {
  return enabled ? '' : 'opacity-45';
}

export default function ParametersColumn({
  route, onRoute, visibility, value, onChange, hasModel, hasHeroSeed, nativeSize,
}: ParametersColumnProps) {
  const { t } = useTranslation();
  // With no model chosen, every field is refused for the same reason, and it is
  // not "this model runs at a fixed guidance" — saying that about a model the
  // writer has not picked is the kind of confident wrong answer that makes a
  // panel untrustworthy.
  const noModel = t('visualRef.reason.noModel');
  const refused = (available: boolean, reason: string): string | undefined => {
    if (available) return undefined;
    return hasModel ? reason : noModel;
  };
  const cfgReason = refused(visibility.cfg, t('visualRef.reason.cfgFixed'));
  const samplerReason = refused(visibility.sampler, t('visualRef.reason.serverChoosesSampler'));
  const schedulerReason = refused(visibility.scheduler, t('visualRef.reason.serverChoosesSampler'));

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-text-primary">{t('visualRef.params.title')}</h3>

      <label className="block">
        <span className="block text-[10px] text-text-muted mb-1">{t('imageStudio.model')}</span>
        <ModelRoutePicker type="image" value={route} onChange={onRoute} allowNone={false} />
      </label>

      <label className="block">
        <span className="block text-[10px] text-text-muted mb-1">{t('imageStudio.size')}</span>
        <select
          value={value.sizePreset}
          onChange={(event) => onChange({ sizePreset: event.target.value })}
          className="w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[11px] text-text-primary outline-none focus:border-accent-gold"
        >
          {nativeSize && (
            <option value="native">
              {t('imageStudio.size.native')} · {nativeSize.width}×{nativeSize.height}
            </option>
          )}
          {IMAGE_SIZE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {t(`imageStudio.size.${preset.labelKey}`)} · {preset.width}×{preset.height}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className={`block ${fieldClass(visibility.steps)}`}>
          <span className="block text-[10px] text-text-muted mb-1">{t('imageStudio.steps')}</span>
          <input
            value={value.steps}
            disabled={!visibility.steps}
            title={visibility.steps ? undefined : noModel}
            onChange={(event) => onChange({ steps: event.target.value.replace(/[^\d]/g, '') })}
            placeholder={t('imageStudio.stepsPlaceholder')}
            className="w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[11px] font-mono text-text-primary outline-none focus:border-accent-gold disabled:cursor-not-allowed"
          />
        </label>
        <label className={`block ${fieldClass(visibility.cfg)}`}>
          <span className="block text-[10px] text-text-muted mb-1">{t('visualRef.params.cfg')}</span>
          <input
            value={value.cfg}
            disabled={!visibility.cfg}
            title={cfgReason}
            onChange={(event) => onChange({ cfg: event.target.value.replace(/[^\d.]/g, '') })}
            placeholder={t('visualRef.params.cfgPlaceholder')}
            className="w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[11px] font-mono text-text-primary outline-none focus:border-accent-gold disabled:cursor-not-allowed"
          />
        </label>
      </div>
      {cfgReason && <p className="text-[10px] text-accent-amber">{cfgReason}</p>}

      <div className="grid grid-cols-2 gap-2">
        <label className={`block ${fieldClass(visibility.sampler)}`}>
          <span className="block text-[10px] text-text-muted mb-1">{t('visualRef.params.sampler')}</span>
          <select
            value={value.sampler}
            disabled={!visibility.sampler}
            title={samplerReason}
            onChange={(event) => onChange({ sampler: event.target.value })}
            className="w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[11px] text-text-primary outline-none focus:border-accent-gold disabled:cursor-not-allowed"
          >
            <option value="">{t('visualRef.params.auto')}</option>
            {SAMPLERS.map((sampler) => <option key={sampler} value={sampler}>{sampler}</option>)}
          </select>
        </label>
        <label className={`block ${fieldClass(visibility.scheduler)}`}>
          <span className="block text-[10px] text-text-muted mb-1">{t('visualRef.params.scheduler')}</span>
          <select
            value={value.scheduler}
            disabled={!visibility.scheduler}
            title={schedulerReason}
            onChange={(event) => onChange({ scheduler: event.target.value })}
            className="w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[11px] text-text-primary outline-none focus:border-accent-gold disabled:cursor-not-allowed"
          >
            <option value="">{t('visualRef.params.auto')}</option>
            {SCHEDULERS.map((scheduler) => <option key={scheduler} value={scheduler}>{scheduler}</option>)}
          </select>
        </label>
      </div>

      <div>
        <span className="block text-[10px] text-text-muted mb-1">{t('imageStudio.seed')}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange({ seedMode: value.seedMode === 'lock' ? 'explore' : 'lock' })}
            disabled={!hasHeroSeed && value.seedMode !== 'lock'}
            title={hasHeroSeed ? t('visualRef.params.lockSeed') : t('visualRef.reason.noHeroSeed')}
            className={`p-1.5 rounded-lg border transition disabled:opacity-40 disabled:cursor-not-allowed ${
              value.seedMode === 'lock'
                ? 'border-accent-gold/50 bg-accent-gold/15 text-accent-gold'
                : 'border-border text-text-dim hover:text-text-primary'
            }`}
          >
            {value.seedMode === 'lock' ? <Lock size={12} /> : <LockOpen size={12} />}
          </button>
          <input
            value={value.manualSeed}
            onChange={(event) => onChange({ manualSeed: event.target.value.replace(/[^\d]/g, ''), seedMode: 'manual' })}
            placeholder={t('imageStudio.seedPlaceholder')}
            className="flex-1 min-w-0 px-2 py-1.5 bg-elevated border border-border rounded-lg text-[11px] font-mono text-text-primary outline-none focus:border-accent-gold"
          />
          <button
            type="button"
            onClick={() => onChange({ seedMode: 'explore', manualSeed: '' })}
            title={t('visualRef.params.exploreSeed')}
            className={`p-1.5 rounded-lg border transition ${
              value.seedMode === 'explore'
                ? 'border-accent-gold/50 bg-accent-gold/15 text-accent-gold'
                : 'border-border text-text-dim hover:text-text-primary'
            }`}
          >
            <Dices size={12} />
          </button>
        </div>
        <p className="text-[10px] text-text-dim mt-1">{t(`visualRef.params.seedMode.${value.seedMode}`)}</p>
      </div>

      <label className="block">
        <span className="block text-[10px] text-text-muted mb-1">{t('visualRef.params.batch')}</span>
        <select
          value={value.batch}
          onChange={(event) => onChange({ batch: Number(event.target.value) })}
          className="w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[11px] text-text-primary outline-none focus:border-accent-gold"
        >
          {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
        </select>
      </label>
    </div>
  );
}
