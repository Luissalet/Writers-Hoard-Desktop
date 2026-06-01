import { useEffect, useRef } from 'react';
import Modal from '@/components/common/Modal';
import { useTranslation } from '@/i18n/useTranslation';

export interface ConfirmDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Dialog title — defaults to "Confirm" / "Confirmar". */
  title?: string;
  /** Body copy describing what the user is about to do. */
  message: string;
  /**
   * Label for the confirm button. Defaults to the translated `common.delete`
   * when `destructive` is true, otherwise translated `common.confirm`.
   */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to translated `common.cancel`. */
  cancelLabel?: string;
  /**
   * When true, the confirm button is styled with the danger token and the
   * dialog title defaults to a deletion-style title. The interaction model
   * is identical in both variants — the styling just signals risk.
   */
  destructive?: boolean;
  /** Called when the user explicitly confirms. */
  onConfirm: () => void | Promise<void>;
  /** Called when the user cancels (Cancel button, Escape, backdrop, X). */
  onCancel: () => void;
}

/**
 * Safe replacement for `window.confirm()`.
 *
 * Why this exists: native `confirm()` is unsafe for destructive actions
 * across the browser tab lifecycle (Page Lifecycle `frozen` → `active`,
 * laptop close/open, OS sleep). On resume, the native dialog can be
 * auto-dismissed and — depending on the browser/OS — auto-resolved as
 * `true`. We had a real incident where a user's Timeline was deleted
 * after their laptop woke from sleep because of this. See
 * `tasks/lessons.md`.
 *
 * Interaction contract — verified safe across tab suspend/resume:
 *  • Confirm requires an explicit click on the confirm button.
 *  • Default keyboard focus is on **Cancel** — pressing Enter cancels.
 *  • Escape, backdrop click, and X all map to `onCancel`.
 *  • The dialog is React-owned, so no buffered native UI can fire on resume.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);

  const resolvedTitle =
    title ?? (destructive ? t('common.delete') : t('common.confirm'));
  const resolvedConfirmLabel =
    confirmLabel ?? (destructive ? t('common.delete') : t('common.confirm'));
  const resolvedCancelLabel = cancelLabel ?? t('common.cancel');

  // Focus the Cancel button when the dialog opens, so an accidental Enter
  // press maps to Cancel rather than confirm. This is the safe default for
  // destructive actions.
  useEffect(() => {
    if (open) {
      // Defer one tick — Modal mounts via AnimatePresence after this effect runs.
      const id = window.setTimeout(() => cancelRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const handleConfirm = () => {
    void onConfirm();
  };

  return (
    <Modal open={open} onClose={onCancel} title={resolvedTitle}>
      <p className="text-sm text-text-primary mb-6 whitespace-pre-wrap">{message}</p>
      <div className="flex items-center justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-elevated transition focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
        >
          {resolvedCancelLabel}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className={
            destructive
              ? 'px-4 py-2 text-sm rounded-lg bg-danger text-white font-semibold hover:bg-danger/90 transition focus:outline-none focus:ring-2 focus:ring-danger/50'
              : 'px-4 py-2 text-sm rounded-lg bg-accent-gold text-deep font-semibold hover:bg-accent-amber transition focus:outline-none focus:ring-2 focus:ring-accent-gold/50'
          }
        >
          {resolvedConfirmLabel}
        </button>
      </div>
    </Modal>
  );
}
