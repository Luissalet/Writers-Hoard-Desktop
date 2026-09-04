// ============================================================================
// The LoRA stack — N of them, their weights, and their trigger words
// ============================================================================
//
// One at a time was the ceiling, and character fidelity is LoRAs: a character
// LoRA plus a style LoRA plus a detail LoRA is the ordinary case. The request
// has carried an array all along.
//
// The trigger word sits next to each entry because a LoRA whose trigger the
// writer cannot see is a LoRA they will use wrong — the token is what the
// weights were fused onto, and a correctly loaded LoRA whose trigger never
// reaches the prompt does approximately nothing, which reads as "broken".

import { useMemo, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { SdLoraFile } from '@/services/aiRuntime/sdServer';
import {
  LORA_WEIGHT_MAX,
  LORA_WEIGHT_MIN,
  loraStem,
  makeManualEntry,
  missingTriggers,
  type FieldState,
  type LoraStackEntry,
} from '../studio';
import ParameterField, { FIELD_CLASS } from './ParameterField';

export interface LoraStackProps {
  /** References first, then the writer's own — already merged and de-duplicated. */
  stack: readonly LoraStackEntry[];
  /** Only the manual half is editable here; a reference owns its own LoRA. */
  manual: readonly LoraStackEntry[];
  onChangeManual: (entries: LoraStackEntry[]) => void;
  available: readonly SdLoraFile[];
  state: FieldState;
  /** The resolved prompt, so a trigger word that never made it in can be named. */
  prompt: string;
  lorasDir?: string | null;
}

export default function LoraStack({
  stack, manual, onChangeManual, available, state, prompt, lorasDir,
}: LoraStackProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const used = useMemo(() => new Set(stack.map((entry) => entry.fileName.toLowerCase())), [stack]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return available
      .filter((file) => !used.has(file.fileName.toLowerCase()))
      .filter((file) => !needle || file.name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [available, used, query]);

  const missing = missingTriggers(stack, prompt);

  return (
    <ParameterField label={t('imageStudio.lora.stack')} state={state} as="div">
      <div className="space-y-1.5">
        {stack.length === 0 && (
          <p className="text-[10px] text-text-dim">
            {available.length === 0 ? t('imageStudio.lora.empty') : t('imageStudio.lora.stackEmpty')}
          </p>
        )}

        {stack.map((entry) => {
          const fromRef = entry.source === 'reference';
          return (
            <div
              key={entry.fileName}
              className={`rounded-lg border px-2 py-1.5 space-y-1 ${
                entry.enabled ? 'border-border bg-elevated' : 'border-border/60 bg-elevated/40'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  disabled={!state.enabled || fromRef}
                  aria-label={entry.name}
                  title={fromRef ? t('imageStudio.lora.ownedByRef').replace('{name}', entry.refName ?? '') : entry.name}
                  onChange={() => onChangeManual(manual.map((row) => (
                    row.fileName === entry.fileName ? { ...row, enabled: !row.enabled } : row
                  )))}
                  className="accent-accent-gold disabled:cursor-not-allowed"
                />
                <span className="flex-1 min-w-0 truncate text-[11px] text-text-primary" title={entry.fileName}>
                  {entry.name}
                </span>
                <input
                  type="number"
                  step={0.05}
                  min={LORA_WEIGHT_MIN}
                  max={LORA_WEIGHT_MAX}
                  value={entry.weight}
                  disabled={!state.enabled || fromRef}
                  aria-label={t('imageStudio.lora.weight')}
                  onChange={(event) => onChangeManual(manual.map((row) => (
                    row.fileName === entry.fileName ? { ...row, weight: Number(event.target.value) } : row
                  )))}
                  className="w-16 px-1.5 py-0.5 bg-elevated border border-border rounded text-[10px] font-mono text-text-primary outline-none focus:border-accent-gold disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  disabled={fromRef}
                  onClick={() => onChangeManual(manual.filter((row) => row.fileName !== entry.fileName))}
                  title={fromRef ? t('imageStudio.lora.ownedByRef').replace('{name}', entry.refName ?? '') : t('imageStudio.lora.remove')}
                  aria-label={fromRef ? t('imageStudio.lora.ownedByRef').replace('{name}', entry.refName ?? '') : t('imageStudio.lora.remove')}
                  className="p-0.5 rounded text-text-dim hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 size={11} />
                </button>
              </div>
              <p className="text-[9px] text-text-dim font-mono truncate">
                {entry.trigger
                  ? `${t('imageStudio.lora.trigger')}: ${entry.trigger}`
                  : t('imageStudio.lora.noTrigger')}
                {fromRef && entry.refName ? ` · ${entry.refName}` : ''}
              </p>
            </div>
          );
        })}

        {missing.length > 0 && (
          <p className="text-[10px] text-accent-amber">
            {t('imageStudio.lora.triggerMissing').replace('{words}', missing.join(', '))}
          </p>
        )}

        <label className="block">
          <span className="sr-only">{t('imageStudio.lora.search')}</span>
          <span className="relative block">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim" />
            <input
              value={query}
              disabled={!state.enabled || available.length === 0}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('imageStudio.lora.search')}
              className={`${FIELD_CLASS} pl-6`}
            />
          </span>
        </label>

        {matches.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {matches.map((file) => (
              <button
                key={file.fileName}
                type="button"
                disabled={!state.enabled}
                onClick={() => {
                  onChangeManual([...manual, makeManualEntry(file.fileName)]);
                  setQuery('');
                }}
                title={file.fileName}
                className="px-1.5 py-0.5 rounded border border-border text-[10px] text-text-dim hover:text-accent-gold hover:border-accent-gold/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loraStem(file.name)}
              </button>
            ))}
          </div>
        )}

        {available.length === 0 && lorasDir && (
          <p className="text-[10px] text-text-dim break-all">
            {t('imageStudio.lora.folder').replace('{path}', lorasDir)}
          </p>
        )}
      </div>
    </ParameterField>
  );
}
