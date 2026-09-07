import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Check, LoaderCircle, RotateCcw } from 'lucide-react';
import { ConfirmDialog } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import {
  flushPendingWrites,
  getPendingWritesSnapshot,
  retryFailedWrites,
  subscribePendingWrites,
  type FlushPendingWritesResult,
} from '@/services/pendingWrites';
import {
  closeAppWindow,
  keepAppWindow,
  registerCloseGuard,
  reportUnsavedWork,
} from '@/services/closeGuard';
import { isDesktop } from '@/utils/platform';

const WARNING_OWNER = 'pending-writes';

function usePendingWritesSnapshot() {
  return useSyncExternalStore(
    subscribePendingWrites,
    getPendingWritesSnapshot,
    getPendingWritesSnapshot,
  );
}

/**
 * A compact, truthful save state for the app shell. It only appears after the
 * first edit, and a failed state is itself the retry control.
 */
export function PendingWriteStatus() {
  const { t } = useTranslation();
  const snapshot = usePendingWritesSnapshot();

  if (snapshot.failed > 0) {
    const label = t('pendingWrites.failed').replace('{count}', String(snapshot.failed));
    return (
      <button
        type="button"
        onClick={() => void retryFailedWrites()}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-danger transition hover:bg-danger/10"
        title={`${label} ${t('pendingWrites.retry')}`}
        aria-label={`${label} ${t('pendingWrites.retry')}`}
      >
        <AlertTriangle size={14} aria-hidden="true" />
        <span>{t('pendingWrites.failedShort')}</span>
        <RotateCcw size={12} aria-hidden="true" />
      </button>
    );
  }

  if (snapshot.pending > 0 || snapshot.dirty > 0) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-text-muted"
        title={t('pendingWrites.saving')}
      >
        <LoaderCircle size={14} className="animate-spin text-accent-gold" aria-hidden="true" />
        <span>{t('pendingWrites.savingShort')}</span>
      </span>
    );
  }

  if (snapshot.lastSavedAt === null) return null;

  return (
    <span
      role="status"
      aria-live="polite"
      className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-text-dim"
      title={t('pendingWrites.saved')}
    >
      <Check size={14} className="text-green-400" aria-hidden="true" />
      <span>{t('pendingWrites.savedShort')}</span>
    </span>
  );
}

/**
 * One close coordinator for every small/debounced editor. Large manuscript
 * editors retain their richer recovery dialogs, while this host covers the
 * rest of the app and makes failed writes impossible to dismiss silently.
 */
export default function PendingWritesHost() {
  const { t, locale } = useTranslation();
  const snapshot = usePendingWritesSnapshot();
  const [closeIssue, setCloseIssue] = useState<FlushPendingWritesResult | null>(null);
  const hasRisk = snapshot.pending > 0 || snapshot.dirty > 0 || snapshot.failed > 0;

  useEffect(() => {
    return registerCloseGuard(async () => {
      const result = await flushPendingWrites();
      if (result.ok) return true;
      setCloseIssue(result);
      return false;
    });
  }, []);

  useEffect(() => {
    if (!hasRisk) {
      reportUnsavedWork(null, WARNING_OWNER);
      return;
    }
    reportUnsavedWork({
      title: t('pendingWrites.close.title'),
      message: t('pendingWrites.close.nativeMessage'),
      closeAnyway: t('pendingWrites.close.anyway'),
      keepOpen: t('pendingWrites.close.retry'),
    }, WARNING_OWNER);
    return () => reportUnsavedWork(null, WARNING_OWNER);
    // `locale`, rather than `t`: the translator function is recreated each render.
  }, [hasRisk, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isDesktop() || !hasRisk) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasRisk]);

  const stayAndRetry = useCallback(() => {
    setCloseIssue(null);
    keepAppWindow();
    void retryFailedWrites().then(() => flushPendingWrites());
  }, []);

  const closeAnyway = useCallback(() => {
    setCloseIssue(null);
    closeAppWindow();
  }, []);

  const issueMessage = closeIssue?.timedOut
    ? t('pendingWrites.close.timeout')
    : t('pendingWrites.close.failed').replace(
        '{count}',
        String(Math.max(closeIssue?.failed ?? 0, snapshot.failed)),
      );

  return (
    <ConfirmDialog
      open={closeIssue !== null}
      title={t('pendingWrites.close.title')}
      message={issueMessage}
      confirmLabel={t('pendingWrites.close.anyway')}
      cancelLabel={t('pendingWrites.close.retry')}
      destructive
      onConfirm={closeAnyway}
      onCancel={stayAndRetry}
    />
  );
}
