// ============================================================================
// The pass chain, as a list you can reorder — not three unrelated checkboxes
// ============================================================================
//
// base → hires → detail → upscale. Every result anyone posts is a chain, and
// laying it out as a list is what makes "why does this one look better"
// answerable: the order is visible, each pass says what it was allowed to
// change, and the whole thing rides on the recipe so it can be put back.
//
// The denoise slider carries the discipline in the UI, because it is the single
// parameter that decides whether a second pass adds detail to your picture or
// generates a different one at a larger size. The band is drawn; the sentence
// under it changes as the number crosses it.

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  HIRES_DENOISE_SAFE_MAX,
  PASS_KINDS,
  addPass,
  chainOutputSize,
  movePass,
  passAvailability,
  removePass,
  togglePass,
  updatePass,
  type PassKind,
  type PassSupportInput,
  type StudioPass,
} from '../studio';
import { FIELD_CLASS, MONO_FIELD_CLASS } from './ParameterField';

export interface PassChainEditorProps {
  passes: StudioPass[];
  onChange: (passes: StudioPass[]) => void;
  support: PassSupportInput;
  /** Upscaler names offered in the picker: the builtins plus installed files. */
  upscalers: readonly string[];
  baseWidth: number;
  baseHeight: number;
}

/** Detectors an ADetailer pass would offer. Named now so the refusal is concrete. */
const DETECTORS = ['face', 'hand', 'person', 'eyes'] as const;

export default function PassChainEditor({
  passes, onChange, support, upscalers, baseWidth, baseHeight,
}: PassChainEditorProps) {
  const { t } = useTranslation();
  const output = chainOutputSize(passes, baseWidth, baseHeight, support);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h4 className="text-[10px] text-text-muted">{t('imageStudio.chain.title')}</h4>
        <span className="ml-auto text-[10px] font-mono text-text-dim">
          {output.width}×{output.height}
        </span>
      </div>

      <ol className="space-y-1.5">
        {passes.map((pass, index) => {
          const availability = passAvailability(pass.kind, support);
          const refused = !availability.enabled;
          const reason = refused ? t(availability.reasonKey ?? 'visualRef.reason.unavailable') : undefined;
          return (
            <li
              key={pass.id}
              className={`rounded-lg border px-2 py-1.5 space-y-1.5 ${
                pass.enabled && !refused ? 'border-border bg-elevated' : 'border-border/60 bg-elevated/40'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-text-dim tabular-nums">{index + 1}</span>
                <button
                  type="button"
                  disabled={pass.kind === 'base' || refused}
                  onClick={() => onChange(togglePass(passes, pass.id))}
                  title={reason ?? t(`imageStudio.pass.${pass.kind}.what`)}
                  aria-pressed={pass.enabled}
                  className={`px-1.5 py-0.5 rounded text-[10px] border transition disabled:cursor-not-allowed ${
                    pass.enabled && !refused
                      ? 'border-accent-gold/50 bg-accent-gold/15 text-accent-gold'
                      : 'border-border text-text-dim'
                  }`}
                >
                  {t(`imageStudio.pass.${pass.kind}`)}
                </button>
                <span className="flex-1 min-w-0 truncate text-[10px] text-text-dim">
                  {t(`imageStudio.pass.${pass.kind}.what`)}
                </span>
                <button
                  type="button"
                  disabled={pass.kind === 'base' || index <= 1}
                  onClick={() => onChange(movePass(passes, pass.id, -1))}
                  title={t('imageStudio.chain.moveUp')}
                  aria-label={t('imageStudio.chain.moveUp')}
                  className="p-0.5 rounded text-text-dim hover:text-accent-gold disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ArrowUp size={11} />
                </button>
                <button
                  type="button"
                  disabled={pass.kind === 'base' || index === passes.length - 1}
                  onClick={() => onChange(movePass(passes, pass.id, 1))}
                  title={t('imageStudio.chain.moveDown')}
                  aria-label={t('imageStudio.chain.moveDown')}
                  className="p-0.5 rounded text-text-dim hover:text-accent-gold disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ArrowDown size={11} />
                </button>
                <button
                  type="button"
                  disabled={pass.kind === 'base'}
                  onClick={() => onChange(removePass(passes, pass.id))}
                  title={pass.kind === 'base' ? t('imageStudio.chain.baseKept') : t('imageStudio.chain.remove')}
                  aria-label={pass.kind === 'base' ? t('imageStudio.chain.baseKept') : t('imageStudio.chain.remove')}
                  className="p-0.5 rounded text-text-dim hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 size={11} />
                </button>
              </div>

              {reason && <p className="text-[10px] text-accent-amber">{reason}</p>}

              {pass.kind === 'base' && (
                <p className="text-[10px] text-text-dim font-mono">{baseWidth}×{baseHeight}</p>
              )}

              {pass.kind === 'hires' && pass.enabled && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="block">
                      <span className="block text-[9px] text-text-muted">{t('imageStudio.pass.upscaler')}</span>
                      <select
                        value={pass.upscaler ?? ''}
                        disabled={refused}
                        onChange={(event) => onChange(updatePass(passes, pass.id, { upscaler: event.target.value }))}
                        className={FIELD_CLASS}
                      >
                        {upscalers.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="block text-[9px] text-text-muted">{t('imageStudio.pass.scale')}</span>
                      <select
                        value={String(pass.scale ?? 1.5)}
                        disabled={refused}
                        onChange={(event) => onChange(updatePass(passes, pass.id, { scale: Number(event.target.value) }))}
                        className={FIELD_CLASS}
                      >
                        {['1.25', '1.5', '2', '2.5', '3'].map((scale) => (
                          <option key={scale} value={scale}>×{scale}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block">
                    <span className="block text-[9px] text-text-muted">{t('imageStudio.pass.steps')}</span>
                    <input
                      value={pass.steps === undefined ? '' : String(pass.steps)}
                      disabled={refused}
                      onChange={(event) => onChange(updatePass(passes, pass.id, {
                        steps: event.target.value ? Number(event.target.value.replace(/[^\d]/g, '')) : undefined,
                      }))}
                      className={MONO_FIELD_CLASS}
                    />
                  </label>
                  <DenoiseSlider
                    value={pass.denoise ?? 0.4}
                    disabled={refused}
                    onChange={(denoise) => onChange(updatePass(passes, pass.id, { denoise }))}
                  />
                  <label className="block">
                    <span className="block text-[9px] text-text-muted">{t('imageStudio.pass.prompt')}</span>
                    <input
                      value={pass.prompt ?? ''}
                      disabled={refused}
                      placeholder={t('imageStudio.pass.promptPlaceholder')}
                      onChange={(event) => onChange(updatePass(passes, pass.id, { prompt: event.target.value }))}
                      className={FIELD_CLASS}
                    />
                  </label>
                </div>
              )}

              {pass.kind === 'detail' && (
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="block">
                    <span className="block text-[9px] text-text-muted">{t('imageStudio.pass.detector')}</span>
                    <select
                      value={pass.detector ?? 'face'}
                      disabled={refused}
                      onChange={(event) => onChange(updatePass(passes, pass.id, { detector: event.target.value }))}
                      className={FIELD_CLASS}
                    >
                      {DETECTORS.map((name) => (
                        <option key={name} value={name}>{t(`imageStudio.detector.${name}`)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-[9px] text-text-muted">{t('imageStudio.pass.confidence')}</span>
                    <input
                      value={String(pass.confidence ?? 0.3)}
                      disabled={refused}
                      onChange={(event) => onChange(updatePass(passes, pass.id, { confidence: Number(event.target.value) }))}
                      className={MONO_FIELD_CLASS}
                    />
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-text-dim inline-flex items-center gap-1">
          <Plus size={10} />
          {t('imageStudio.chain.add')}
        </span>
        {PASS_KINDS.filter((kind) => kind !== 'base').map((kind) => {
          const availability = passAvailability(kind, support);
          const reason = availability.enabled
            ? t(`imageStudio.pass.${kind}.what`)
            : t(availability.reasonKey ?? 'visualRef.reason.unavailable');
          return (
            <button
              key={kind}
              type="button"
              disabled={!availability.enabled}
              onClick={() => onChange(addPass(passes, kind as PassKind))}
              title={reason}
              aria-label={reason}
              className="px-1.5 py-0.5 rounded border border-border text-[10px] text-text-dim hover:text-accent-gold hover:border-accent-gold/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t(`imageStudio.pass.${kind}`)}
            </button>
          );
        })}
      </div>
      {/* The refusals belong next to the button that would have added the pass,
          not in a console: a writer who has read about ADetailer needs to find
          out here that it is coming, rather than conclude it does not exist. */}
      {PASS_KINDS.filter((kind) => kind !== 'base' && !passAvailability(kind, support).enabled).map((kind) => (
        <p key={kind} className="text-[10px] text-accent-amber">
          {t(`imageStudio.pass.${kind}`)}: {t(passAvailability(kind, support).reasonKey ?? 'visualRef.reason.unavailable')}
        </p>
      ))}
    </div>
  );
}

/**
 * Denoise, with the band drawn and the consequence named.
 *
 * A number between 0 and 1 tells a novelist nothing. "Adds detail to this
 * picture" and "generates a different picture at a larger size" tell them
 * exactly what they are choosing between, which is the whole decision.
 */
function DenoiseSlider({
  value, disabled, onChange,
}: { value: number; disabled: boolean; onChange: (value: number) => void }) {
  const { t } = useTranslation();
  const safe = value <= HIRES_DENOISE_SAFE_MAX;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] text-text-muted">{t('imageStudio.pass.denoise')}</span>
        <span className="ml-auto font-mono text-[10px] text-text-primary">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        disabled={disabled}
        aria-label={t('imageStudio.pass.denoise')}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-accent-gold disabled:cursor-not-allowed"
      />
      <p className={`text-[10px] ${safe ? 'text-text-dim' : 'text-accent-amber'}`}>
        {t(safe ? 'imageStudio.pass.denoise.adds' : 'imageStudio.pass.denoise.reimagines')}
      </p>
    </div>
  );
}
