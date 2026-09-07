import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/** Keeps an existing editor mounted while a failed read can be retried. */
export default function ReadErrorNotice({ onRetry, retrying = false }: { onRetry: () => Promise<void>; retrying?: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
      <AlertTriangle size={18} className="shrink-0 text-accent-gold" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-text-primary">{t('common.readFailed')}</p>
      <button type="button" disabled={retrying} onClick={() => { void onRetry(); }} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-text-primary hover:bg-elevated disabled:opacity-50">
        <RotateCcw size={14} aria-hidden="true" />{t('common.retryRead')}
      </button>
    </div>
  );
}
