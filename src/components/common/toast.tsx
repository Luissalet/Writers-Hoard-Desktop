// ============================================
// Toast notifications — app-wide, React-owned feedback
// ============================================
//
// Module-singleton pattern: any code (components, services, event handlers)
// calls `toast.success(...)` / `toast.error(...)` / `toast.info(...)` without
// needing context. `<ToastHost/>` (mounted once in MainLayout) subscribes and
// renders the stack.
//
// This replaces native alert() everywhere — native dialogs block the JS
// thread and can behave unpredictably across the tab lifecycle (see
// tasks/lessons.md #12), and they look terrible.

/* eslint-disable react-refresh/only-export-components --
   the module-singleton `toast` API and its host component belong together;
   hot-reloading the toast host is irrelevant. */

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (toasts: ToastItem[]) => void;

let nextId = 1;
let stack: ToastItem[] = [];
const listeners = new Set<Listener>();
const timers = new Map<number, number>();

function emit() {
  for (const l of listeners) l(stack);
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
  stack = stack.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, message: string, durationMs?: number) {
  const id = nextId++;
  stack = [...stack, { id, kind, message }];
  // Keep the stack sane if something loops
  if (stack.length > 5) {
    const evicted = stack[0];
    dismissToast(evicted.id);
  }
  emit();
  const ttl = durationMs ?? (kind === 'error' ? 6000 : 3500);
  timers.set(id, window.setTimeout(() => dismissToast(id), ttl));
}

export const toast = {
  success: (message: string, durationMs?: number) => push('success', message, durationMs),
  error: (message: string, durationMs?: number) => push('error', message, durationMs),
  info: (message: string, durationMs?: number) => push('info', message, durationMs),
};

const KIND_STYLES: Record<ToastKind, { icon: typeof Info; accent: string }> = {
  success: { icon: CheckCircle2, accent: 'text-success' },
  error: { icon: AlertCircle, accent: 'text-danger' },
  info: { icon: Info, accent: 'text-accent-gold' },
};

/** Mount exactly once (MainLayout). Renders the toast stack bottom-right. */
export function ToastHost() {
  const { t: translate } = useTranslation();
  const [items, setItems] = useState<ToastItem[]>(stack);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none">
      {items.map((t) => {
        const { icon: Icon, accent } = KIND_STYLES[t.kind];
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2.5 max-w-sm px-3.5 py-2.5 rounded-lg border border-border bg-elevated shadow-lg shadow-black/30 animate-[toast-in_0.18s_ease-out]"
            role={t.kind === 'error' ? 'alert' : 'status'}
          >
            <Icon size={16} className={`${accent} flex-shrink-0 mt-0.5`} />
            <span className="text-sm text-text-primary leading-snug flex-1">{t.message}</span>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-text-dim hover:text-text-primary transition flex-shrink-0 mt-0.5"
              type="button"
              aria-label={translate('common.dismiss')}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
