// ============================================================================
// Parameters — three levels, and the ones this model cannot turn
// ============================================================================
//
// What decides here is `studioCapabilities(...)`: a field is offered when the
// chosen model, the backend and the request shape can all honour it, and
// refused when any of them cannot — with the reason that actually applies, not
// the nearest one. "No model is connected", "this model runs at a fixed
// guidance" and "the request has no field for this yet" are three different
// facts and the writer can act on each of them differently.
//
// Refused, never removed. A vanished CFG slider teaches "this app has no CFG"
// instead of "the model you picked has a fixed one", and the writer goes
// looking for another program.

import { Dices, Lock, LockOpen, RotateCcw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import ModelRoutePicker from '@/components/ai-settings/ModelRoutePicker';
import type { SdLoraFile } from '@/services/aiRuntime/sdServer';
import type { AiRouteSelection } from '@/services/aiRuntime/types';
import type { SeedMode } from '@/services/visualRef';
import {
  CURATED_SAMPLERS,
  CURATED_SCHEDULERS,
  allSamplers,
  allSchedulers,
  bucketsForFamily,
  isFieldAtLevel,
  isOffBucket,
  samplerKey,
  type BatchSeedMode,
  type DefaultsSource,
  type LoraStackEntry,
  type PassSupportInput,
  type StudioCapabilities,
  type StudioLevel,
  type StudioPass,
} from '../studio';
import LevelSwitcher from './LevelSwitcher';
import LoraStack from './LoraStack';
import ParameterField, { FIELD_CLASS, MONO_FIELD_CLASS } from './ParameterField';
import PassChainEditor from './PassChainEditor';

export interface ParametersState {
  /** A bucket id ("1024x1024"), `native`, or `custom`. */
  sizePreset: string;
  customWidth: string;
  customHeight: string;
  steps: string;
  cfg: string;
  sampler: string;
  scheduler: string;
  clipSkip: string;
  seedMode: SeedMode;
  manualSeed: string;
  batch: number;
  batchSeedMode: BatchSeedMode;
}

export interface ParametersColumnProps {
  route?: AiRouteSelection;
  onRoute: (route: AiRouteSelection | null) => void;
  level: StudioLevel;
  onLevel: (level: StudioLevel) => void;
  capabilities: StudioCapabilities;
  value: ParametersState;
  onChange: (changes: Partial<ParametersState>) => void;
  /** Checkpoint family, which decides the buckets and the working point. */
  family?: string;
  nativeSize?: { width: number; height: number };
  /** The size the base pass will actually run at, after the preset is resolved. */
  size: { width: number; height: number };
  /** Which rule last re-pointed the knobs, so the panel can say why and undo it. */
  appliedDefaults: DefaultsSource | null;
  onUndoDefaults: () => void;
  onReapplyDefaults: () => void;
  showAllSamplers: boolean;
  onShowAllSamplers: (value: boolean) => void;
  /** Whether any reference in this prompt has a hero seed to lock to. */
  hasHeroSeed: boolean;

  passes: StudioPass[];
  onPasses: (passes: StudioPass[]) => void;
  passSupport: PassSupportInput;
  upscalers: readonly string[];

  loraStack: readonly LoraStackEntry[];
  loraManual: readonly LoraStackEntry[];
  onLoraManual: (entries: LoraStackEntry[]) => void;
  availableLoras: readonly SdLoraFile[];
  lorasDir?: string | null;
  resolvedPrompt: string;
}

export default function ParametersColumn(props: ParametersColumnProps) {
  const { t } = useTranslation();
  const {
    route, onRoute, level, onLevel, capabilities, value, onChange, family, nativeSize, size,
    appliedDefaults, onUndoDefaults, onReapplyDefaults, showAllSamplers, onShowAllSamplers, hasHeroSeed,
  } = props;

  const buckets = bucketsForFamily(family);
  const offBucket = isOffBucket(family, size.width, size.height);
  const samplers = showAllSamplers ? allSamplers() : CURATED_SAMPLERS;
  const schedulers = showAllSamplers ? allSchedulers() : CURATED_SCHEDULERS;
  const at = (field: Parameters<typeof isFieldAtLevel>[0]) => isFieldAtLevel(field, level);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-text-primary">{t('visualRef.params.title')}</h3>

      <LevelSwitcher value={level} onChange={onLevel} />

      <ParameterField label={t('imageStudio.model')} state={capabilities.model}>
        <ModelRoutePicker type="image" value={route} onChange={onRoute} allowNone={false} />
      </ParameterField>

      {!appliedDefaults && at('steps') && capabilities.model.enabled && route && (
        <button
          type="button"
          onClick={onReapplyDefaults}
          className="inline-flex items-center gap-1 text-[10px] text-text-dim hover:text-accent-gold transition"
        >
          <RotateCcw size={10} />
          {t('imageStudio.why.reapply')}
        </button>
      )}

      {appliedDefaults && at('steps') && (
        <div className="rounded-lg border border-accent-gold/30 bg-accent-gold/5 px-2 py-1.5 space-y-1">
          {/* Silent retuning is worse than no retuning: the writer changes model,
              their steps value moves, and they never learn that it did. */}
          <p className="text-[10px] text-text-muted">{t(`imageStudio.why.${appliedDefaults}`)}</p>
          <button
            type="button"
            onClick={onUndoDefaults}
            className="inline-flex items-center gap-1 text-[10px] text-accent-gold hover:underline"
          >
            <RotateCcw size={10} />
            {t('imageStudio.why.undo')}
          </button>
        </div>
      )}

      <ParameterField
        label={t('imageStudio.size')}
        state={capabilities.size}
        hint={offBucket ? undefined : `${size.width}×${size.height}`}
      >
        <select
          value={value.sizePreset}
          disabled={!capabilities.size.enabled}
          onChange={(event) => onChange({ sizePreset: event.target.value })}
          className={FIELD_CLASS}
        >
          {nativeSize && (
            <option value="native">
              {t('imageStudio.size.native')} · {nativeSize.width}×{nativeSize.height}
            </option>
          )}
          {buckets.map((bucket) => (
            <option key={bucket.id} value={bucket.id}>
              {bucket.ratio} · {bucket.width}×{bucket.height}
            </option>
          ))}
          {at('sigmas') && <option value="custom">{t('imageStudio.size.custom')}</option>}
        </select>
      </ParameterField>

      {/* Most "why does this look wrong" is an off-bucket size: the duplicated
          heads and stretched torsos are what a model does outside the aspect
          ratios its weights were trained on. */}
      {offBucket && <p className="text-[10px] text-accent-amber">{t('imageStudio.size.offBucket')}</p>}

      {value.sizePreset === 'custom' && at('sigmas') && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[10px] text-text-muted mb-1">{t('imageStudio.size.width')}</span>
            <input
              value={value.customWidth}
              onChange={(event) => onChange({ customWidth: event.target.value.replace(/[^\d]/g, '') })}
              className={MONO_FIELD_CLASS}
            />
          </label>
          <label className="block">
            <span className="block text-[10px] text-text-muted mb-1">{t('imageStudio.size.height')}</span>
            <input
              value={value.customHeight}
              onChange={(event) => onChange({ customHeight: event.target.value.replace(/[^\d]/g, '') })}
              className={MONO_FIELD_CLASS}
            />
          </label>
        </div>
      )}

      {at('steps') && (
        <div className="grid grid-cols-2 gap-2">
          <ParameterField label={t('imageStudio.steps')} state={capabilities.steps}>
            <input
              value={value.steps}
              disabled={!capabilities.steps.enabled}
              onChange={(event) => onChange({ steps: event.target.value.replace(/[^\d]/g, '') })}
              placeholder={t('imageStudio.stepsPlaceholder')}
              className={MONO_FIELD_CLASS}
            />
          </ParameterField>
          <ParameterField label={t('visualRef.params.cfg')} state={capabilities.cfg}>
            <input
              value={value.cfg}
              disabled={!capabilities.cfg.enabled}
              onChange={(event) => onChange({ cfg: event.target.value.replace(/[^\d.]/g, '') })}
              placeholder={t('visualRef.params.cfgPlaceholder')}
              className={MONO_FIELD_CLASS}
            />
          </ParameterField>
        </div>
      )}

      {at('sampler') && (
        <ParameterField
          label={t('visualRef.params.sampler')}
          state={capabilities.sampler}
          hint={value.sampler ? t(`imageStudio.sampler.${samplerKey(value.sampler)}`) : undefined}
        >
          <select
            value={value.sampler}
            disabled={!capabilities.sampler.enabled}
            onChange={(event) => onChange({ sampler: event.target.value })}
            className={FIELD_CLASS}
          >
            <option value="">{t('visualRef.params.auto')}</option>
            {samplers.map((entry) => (
              <option key={entry.id} value={entry.id} title={t(`imageStudio.sampler.${entry.key}`)}>
                {entry.id}
              </option>
            ))}
          </select>
        </ParameterField>
      )}

      {at('scheduler') && (
        <ParameterField
          label={t('visualRef.params.scheduler')}
          state={capabilities.scheduler}
          hint={value.scheduler ? t(`imageStudio.scheduler.${samplerKey(value.scheduler)}`) : undefined}
        >
          <select
            value={value.scheduler}
            disabled={!capabilities.scheduler.enabled}
            onChange={(event) => onChange({ scheduler: event.target.value })}
            className={FIELD_CLASS}
          >
            <option value="">{t('visualRef.params.auto')}</option>
            {schedulers.map((entry) => (
              <option key={entry.id} value={entry.id} title={t(`imageStudio.scheduler.${entry.key}`)}>
                {entry.id}
              </option>
            ))}
          </select>
        </ParameterField>
      )}

      {at('allSamplers') && (
        <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
          <input
            type="checkbox"
            checked={showAllSamplers}
            disabled={!capabilities.allSamplers.enabled}
            onChange={(event) => onShowAllSamplers(event.target.checked)}
            className="accent-accent-gold disabled:cursor-not-allowed"
          />
          {t('imageStudio.sampler.showAll')}
        </label>
      )}

      {at('clipSkip') && (
        <ParameterField
          label={t('imageStudio.clipSkip')}
          state={capabilities.clipSkip}
          hint={t('imageStudio.clipSkip.hint')}
        >
          <input
            value={value.clipSkip}
            disabled={!capabilities.clipSkip.enabled}
            onChange={(event) => onChange({ clipSkip: event.target.value.replace(/[^\d]/g, '') })}
            placeholder="1"
            className={MONO_FIELD_CLASS}
          />
        </ParameterField>
      )}

      <ParameterField label={t('imageStudio.seed')} state={capabilities.seed} as="div">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange({ seedMode: value.seedMode === 'lock' ? 'explore' : 'lock' })}
            disabled={!hasHeroSeed && value.seedMode !== 'lock'}
            title={hasHeroSeed ? t('visualRef.params.lockSeed') : t('visualRef.reason.noHeroSeed')}
            aria-label={hasHeroSeed ? t('visualRef.params.lockSeed') : t('visualRef.reason.noHeroSeed')}
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
            aria-label={t('imageStudio.seed')}
            onChange={(event) => onChange({ manualSeed: event.target.value.replace(/[^\d]/g, ''), seedMode: 'manual' })}
            placeholder={t('imageStudio.seedPlaceholder')}
            className="flex-1 min-w-0 px-2 py-1.5 bg-elevated border border-border rounded-lg text-[11px] font-mono text-text-primary outline-none focus:border-accent-gold"
          />
          <button
            type="button"
            onClick={() => onChange({ seedMode: 'explore', manualSeed: '' })}
            title={t('visualRef.params.exploreSeed')}
            aria-label={t('visualRef.params.exploreSeed')}
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
      </ParameterField>

      <div className="grid grid-cols-2 gap-2">
        <ParameterField label={t('visualRef.params.batch')} state={capabilities.batch}>
          <select
            value={value.batch}
            disabled={!capabilities.batch.enabled}
            onChange={(event) => onChange({ batch: Number(event.target.value) })}
            className={FIELD_CLASS}
          >
            {[1, 2, 3, 4, 6, 8].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </ParameterField>
        <ParameterField
          label={t('imageStudio.batchSeed')}
          state={capabilities.batch}
          hint={t(`imageStudio.batchSeed.${value.batchSeedMode}.what`)}
        >
          <select
            value={value.batchSeedMode}
            disabled={!capabilities.batch.enabled}
            onChange={(event) => onChange({ batchSeedMode: event.target.value as BatchSeedMode })}
            className={FIELD_CLASS}
          >
            <option value="incremental">{t('imageStudio.batchSeed.incremental')}</option>
            <option value="fixed">{t('imageStudio.batchSeed.fixed')}</option>
          </select>
        </ParameterField>
      </div>

      {at('loraStack') && (
        <LoraStack
          stack={props.loraStack}
          manual={props.loraManual}
          onChangeManual={props.onLoraManual}
          available={props.availableLoras}
          state={capabilities.loraStack}
          prompt={props.resolvedPrompt}
          lorasDir={props.lorasDir}
        />
      )}

      {at('passChain') && (
        capabilities.passChain.enabled ? (
          <PassChainEditor
            passes={props.passes}
            onChange={props.onPasses}
            support={props.passSupport}
            upscalers={props.upscalers}
            baseWidth={size.width}
            baseHeight={size.height}
          />
        ) : (
          <ParameterField label={t('imageStudio.chain.title')} state={capabilities.passChain} as="div">
            <p className="text-[10px] text-text-dim">{t('imageStudio.chain.what')}</p>
          </ParameterField>
        )
      )}

      {at('inpaint') && (
        // The request can carry a mask; the studio has nowhere to paint one yet.
        // That is a different sentence from "this model cannot inpaint", and the
        // writer is owed the true one.
        <ParameterField
          label={t('imageStudio.inpaint')}
          state={capabilities.inpaint.enabled
            ? { enabled: false, reasonKey: 'imageStudio.reason.noMaskEditor' }
            : capabilities.inpaint}
          as="div"
        >
          <p className="text-[10px] text-text-dim">{t('imageStudio.inpaint.what')}</p>
        </ParameterField>
      )}

      {at('sigmas') && (
        <div className="space-y-2 pt-1 border-t border-border/60">
          <h4 className="text-[10px] text-text-muted">{t('imageStudio.expert.title')}</h4>
          <ExpertField label={t('imageStudio.sigmas')} state={capabilities.sigmas} placeholder="0.03, 0.1, 0.5, 1.2" />
          <ExpertField label={t('imageStudio.slg')} state={capabilities.slg} placeholder="7, 8, 9" />
          <ExpertField label={t('imageStudio.apg')} state={capabilities.apg} placeholder="eta 1.0" />
          <ExpertField label={t('imageStudio.cacheMode')} state={capabilities.cacheMode} placeholder="none" />
          <ExpertField label={t('imageStudio.variationSeed')} state={capabilities.variationSeed} placeholder="0.00" />
          <ExpertField label={t('imageStudio.rawJson')} state={capabilities.rawJson} placeholder="{ }" />
        </div>
      )}
    </div>
  );
}

/**
 * An Expert knob the request cannot carry yet.
 *
 * Rendered as a real, disabled input rather than as a line of prose, because
 * the point is that the writer can SEE the control they are looking for and
 * read why it is not usable — which is what tells them it is coming rather
 * than absent.
 */
function ExpertField({
  label, state, placeholder,
}: { label: string; state: { enabled: boolean; reasonKey?: string }; placeholder: string }) {
  return (
    <ParameterField label={label} state={state}>
      <input value="" readOnly disabled placeholder={placeholder} className={MONO_FIELD_CLASS} />
    </ParameterField>
  );
}
