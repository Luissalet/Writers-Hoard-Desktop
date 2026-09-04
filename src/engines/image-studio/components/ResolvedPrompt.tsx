// ============================================================================
// The resolved-prompt disclosure
// ============================================================================
//
// Not optional. A writer who cannot see what was actually sent cannot learn the
// tool — they turn a knob, the picture changes, and they have no way to connect
// the two. And a prompt rewritten behind their back destroys the meaning of a
// seed: the same number stops reproducing the same picture, which is the one
// promise a seed makes.

import { useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ResolutionStep, ResolvedGeneration } from '@/services/visualRef';

/** Steps that report a refusal rather than a decision, drawn in the warning tone. */
const REFUSALS = new Set<ResolutionStep['code']>([
  'loraFamilyMismatch',
  'loraUnsupported',
  'noCanonical',
  'canonicalUnused',
  'negativeIgnored',
  'poseUnsupported',
]);

function stepText(step: ResolutionStep, t: (key: string) => string): string {
  let line = t(`visualRef.step.${step.code}`);
  if (step.refName) line = line.replace('{name}', step.refName);
  for (const [key, value] of Object.entries(step.values ?? {})) {
    line = line.replace(`{${key}}`, value);
  }
  return line;
}

export interface ResolvedPromptProps {
  resolved: ResolvedGeneration;
}

export default function ResolvedPrompt({ resolved }: ResolvedPromptProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-lg border border-border/60 bg-elevated/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] text-text-muted hover:text-text-primary transition"
      >
        <Chevron size={12} />
        <Info size={12} />
        {t('visualRef.composer.resolved')}
        <span className="ml-auto font-mono text-[10px] text-text-dim truncate max-w-[55%]">
          {resolved.prompt || t('visualRef.composer.resolvedEmpty')}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[10px] text-text-dim">{t('visualRef.composer.resolvedHint')}</p>
          <pre className="whitespace-pre-wrap break-words rounded bg-deep/40 px-2 py-1.5 text-[11px] font-mono text-text-primary">
            {resolved.prompt || '—'}
          </pre>
          {resolved.negativePrompt && (
            <>
              <p className="text-[10px] text-text-muted">{t('visualRef.composer.negativeResolved')}</p>
              <pre className="whitespace-pre-wrap break-words rounded bg-deep/40 px-2 py-1.5 text-[11px] font-mono text-text-primary">
                {resolved.negativePrompt}
              </pre>
            </>
          )}
          <ol className="space-y-1">
            {resolved.steps.map((step, index) => (
              <li
                key={`${step.code}-${step.refId ?? index}`}
                className={`text-[10px] flex gap-1.5 ${REFUSALS.has(step.code) ? 'text-accent-amber' : 'text-text-dim'}`}
              >
                <span className="font-mono tabular-nums opacity-60">{index + 1}.</span>
                <span>{stepText(step, t)}</span>
              </li>
            ))}
          </ol>
          {resolved.referenceImages.length > 0 && (
            <p className="text-[10px] text-text-dim">
              {t('visualRef.composer.attached').replace('{count}', String(resolved.referenceImages.length))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
