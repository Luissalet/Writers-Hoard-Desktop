import { useEffect, useRef } from 'react';
import { Copy, RefreshCw, ShieldAlert } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { useTranslation } from '@/i18n/useTranslation';
import type { ProjectZipImportCollision } from '@/services/zipBackup';

interface ImportCollisionDialogProps {
  open: boolean;
  collisions: readonly ProjectZipImportCollision[];
  busy: boolean;
  onCancel: () => void;
  onReplace: () => void | Promise<void>;
}

export default function ImportCollisionDialog({
  open,
  collisions,
  busy,
  onCancel,
  onReplace,
}: ImportCollisionDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => cancelRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onCancel}
      title={t('dashboard.import.collision.title')}
    >
      <div className="space-y-5">
        <div className="flex gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4">
          <ShieldAlert className="mt-0.5 shrink-0 text-danger" size={20} />
          <p className="text-sm text-text-primary">
            {t('dashboard.import.collision.message')}
          </p>
        </div>

        <div className="space-y-2">
          {collisions.map((collision) => (
            <div
              key={collision.projectId}
              className="rounded-lg border border-border bg-elevated/50 p-3"
            >
              <p className="break-all font-mono text-xs text-text-dim">
                {collision.projectId}
              </p>
              <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[7rem_1fr]">
                <dt className="text-text-muted">
                  {t('dashboard.import.collision.current')}
                </dt>
                <dd className="min-w-0 break-words text-text-primary">
                  {collision.existingTitle}
                </dd>
                <dt className="text-text-muted">
                  {t('dashboard.import.collision.incoming')}
                </dt>
                <dd className="min-w-0 break-words text-text-primary">
                  {collision.incomingTitle}
                </dd>
              </dl>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-text-muted">
            <Copy size={16} />
            {t('dashboard.import.collision.copy')}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-dim">
            {t('dashboard.import.collision.copyUnavailable')}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-elevated transition disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled
            title={t('dashboard.import.collision.copyUnavailable')}
            className="flex cursor-not-allowed items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-text-dim opacity-60"
          >
            <Copy size={15} />
            {t('dashboard.import.collision.copy')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onReplace()}
            className="flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white transition hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-danger/50"
          >
            <RefreshCw size={15} className={busy ? 'animate-spin' : undefined} />
            {busy
              ? t('dashboard.import.importing')
              : t('dashboard.import.collision.replace')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
