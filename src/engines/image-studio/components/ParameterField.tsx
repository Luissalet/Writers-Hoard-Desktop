// ============================================================================
// One parameter — and, when it cannot be turned, the reason in the text
// ============================================================================
//
// The house rule this component exists to make unbreakable: a parameter the
// model cannot honour is visible and disabled with a reason, never hidden. A
// vanished CFG slider teaches "this app has no CFG"; a disabled one with a line
// under it teaches "the model you picked runs at a fixed guidance", which is a
// fact the writer can act on by picking another model.
//
// The reason goes in the TEXT, not only in a `title`. A tooltip is invisible to
// a reader who never hovers, invisible on a touch screen, and invisible to the
// test that checks this rule is being followed.

import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { FieldState } from '../studio';

export interface ParameterFieldProps {
  label: string;
  state: FieldState;
  children: ReactNode;
  /** A line the writer needs whether or not the field is usable. */
  hint?: string;
  /** Renders as a `div` when the control inside is a group of buttons. */
  as?: 'label' | 'div';
}

export default function ParameterField({ label, state, children, hint, as = 'label' }: ParameterFieldProps) {
  const { t } = useTranslation();
  const Wrapper = as;
  const reason = state.enabled ? undefined : t(state.reasonKey ?? 'visualRef.reason.unavailable');
  return (
    <Wrapper className={`block ${state.enabled ? '' : 'opacity-60'}`}>
      <span className="block text-[10px] text-text-muted mb-1">{label}</span>
      {children}
      {reason && <p className="mt-1 text-[10px] text-accent-amber">{reason}</p>}
      {hint && <p className="mt-1 text-[10px] text-text-dim">{hint}</p>}
    </Wrapper>
  );
}

/** The class every input in this panel wears, so one disabled state is enough. */
export const FIELD_CLASS =
  'w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[11px] text-text-primary '
  + 'outline-none focus:border-accent-gold disabled:cursor-not-allowed disabled:opacity-70';

export const MONO_FIELD_CLASS = `${FIELD_CLASS} font-mono`;
