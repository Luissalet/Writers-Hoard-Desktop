import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppStore } from '@/stores/appStore';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Required only for the rare titleless dialog. */
  ariaLabel?: string;
  children: ReactNode;
  wide?: boolean;
  /** Allow an existing editor to coexist with another pane in the workspace. */
  withinPane?: boolean;
  /** Large visual inspectors that still need modal focus semantics. */
  fullscreen?: boolean;
  /** Prevent closing and announce work while a submit is in flight. */
  busy?: boolean;
  /**
   * `false` ignores the accidental ways out — Escape and a backdrop click —
   * while the header X and the dialog's own buttons still close. Editors pass
   * `dismissible={!dirty}` so a stray key cannot throw away unsaved input.
   */
  dismissible?: boolean;
  /** Destructive confirmations pass their safe default (usually Cancel). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Editors can restore their exact text selection after this dialog closes. */
  restoreFocus?: () => void;
}

const modalStack: HTMLElement[] = [];
let inertOwners = 0;
let previousRootAriaHidden: string | null = null;
let previousBodyOverflow = '';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function visibleFocusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && !element.hidden;
  });
}

function makeBackgroundInert(): void {
  inertOwners += 1;
  if (inertOwners !== 1) return;
  const root = document.getElementById('root');
  if (root) {
    previousRootAriaHidden = root.getAttribute('aria-hidden');
    root.inert = true;
    root.setAttribute('aria-hidden', 'true');
  }
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
}

function restoreBackground(): void {
  inertOwners = Math.max(0, inertOwners - 1);
  if (inertOwners !== 0) return;
  const root = document.getElementById('root');
  if (root) {
    root.inert = false;
    if (previousRootAriaHidden === null) root.removeAttribute('aria-hidden');
    else root.setAttribute('aria-hidden', previousRootAriaHidden);
  }
  document.body.style.overflow = previousBodyOverflow;
}

export default function Modal({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  wide,
  withinPane = false,
  fullscreen = false,
  busy = false,
  dismissible = true,
  initialFocusRef,
  restoreFocus,
}: ModalProps) {
  const { t } = useTranslation();
  const pane = useEnginePane();
  const scoped = withinPane && pane?.dialogTarget !== undefined;
  const target = scoped ? pane?.dialogTarget : typeof document === 'undefined' ? null : document.body;
  const systemReduceMotion = useReducedMotion();
  const motionPreference = useAppStore((state) => state.motion);
  const reduceMotion = motionPreference === 'reduce'
    || (motionPreference === 'system' && systemReduceMotion);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  const dismissibleRef = useRef(dismissible);
  const restoreFocusRef = useRef(restoreFocus);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { dismissibleRef.current = dismissible; }, [dismissible]);
  useEffect(() => { restoreFocusRef.current = restoreFocus; }, [restoreFocus]);

  useEffect(() => {
    if (!open || !target) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    modalStack.push(dialog);
    const paneBackground = scoped ? Array.from(target.parentElement?.children ?? []).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== target && !element.inert,
    ) : [];
    for (const element of paneBackground) element.inert = true;
    if (!scoped) makeBackgroundInert();

    const focusTimer = window.setTimeout(() => {
      if (scoped && dialog.closest('[hidden], [inert]')) return;
      const preferred = initialFocusRef?.current;
      const first = visibleFocusable(dialog)[0];
      (preferred && dialog.contains(preferred) ? preferred : first ?? dialog).focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!scoped && modalStack.at(-1) !== dialog) return;
      if (scoped && (inertOwners > 0 || dialog.closest('[hidden], [inert]') ||
        !(event.target instanceof Node) || !dialog.contains(event.target))) return;
      if (event.key === 'Escape') {
        if (busyRef.current || !dismissibleRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (scoped || event.key !== 'Tab') return;
      const focusable = visibleFocusable(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      const index = modalStack.lastIndexOf(dialog);
      if (index >= 0) modalStack.splice(index, 1);
      for (const element of paneBackground) element.inert = false;
      if (!scoped) restoreBackground();
      const previous = previousFocusRef.current;
      const restore = restoreFocusRef.current;
      window.setTimeout(() => {
        if (scoped && (target.closest('[hidden], [inert]') || !target.isConnected ||
          (document.activeElement !== document.body && !dialog.contains(document.activeElement)))) return;
        if (restore) restore();
        else if (previous?.isConnected) previous.focus();
      }, 0);
    };
  }, [initialFocusRef, open, scoped, target]);

  // An exiting dialog must stop being a dialog immediately: keeping the
  // semantic node alive for an animation leaves focus and screen readers in
  // an already-closed overlay. The entrance can animate safely; closing is
  // deliberately synchronous.
  if (!target || !open) return null;

  return createPortal(
    <motion.div
      data-engine-pane-id={pane?.instanceId}
      className={`${scoped ? 'pointer-events-auto absolute overflow-y-auto' : 'fixed'} inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0.08 : 0.15 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy && dismissible) onClose();
      }}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal={scoped ? undefined : true}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel ?? t('common.dialog')}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={`relative overflow-hidden rounded-xl border border-border bg-surface shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/60 ${
          fullscreen
            ? 'w-[min(96vw,100rem)] max-h-[94vh]'
            : wide ? 'w-full max-w-3xl' : 'w-full max-w-lg'
        } ${scoped ? 'max-h-full flex flex-col' : ''}`}
        initial={reduceMotion ? { opacity: 0 } : { scale: 0.95, opacity: 0 }}
        animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
        transition={{ duration: reduceMotion ? 0.08 : 0.15 }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 id={titleId} className="text-lg font-serif font-bold text-accent-gold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg p-1 transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/60 disabled:cursor-wait disabled:opacity-50"
              aria-label={t('common.close')}
              title={t('common.close')}
            >
              <X size={20} className="text-text-muted" aria-hidden="true" />
            </button>
          </div>
        )}
        <div className={fullscreen
          ? 'max-h-[94vh] overscroll-contain overflow-y-auto'
          : `max-h-[70vh] overscroll-contain overflow-y-auto p-6 ${scoped ? 'min-h-0' : ''}`}>
          {children}
        </div>
      </motion.div>
    </motion.div>,
    target,
  );
}
