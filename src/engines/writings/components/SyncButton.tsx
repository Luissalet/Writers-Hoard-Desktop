import { useCallback, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { handleGoogleAuthError, useGoogleStore } from '@/stores/googleStore';
import {
  applyGoogleDocSync,
  syncGoogleDoc,
  type GoogleDocSyncPreview,
} from '@/services/googleDocs';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import { ConfirmDialog } from '@/engines/_shared';
import type { Writing } from '@/types';

interface SyncButtonProps {
  writing: Writing;
  onSynced: (changes: Partial<Writing>) => void;
  size?: 'sm' | 'md';
}

export default function SyncButton({ writing, onSynced, size = 'sm' }: SyncButtonProps) {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A pull that came back empty or far shorter than the cached copy. */
  const [pendingPull, setPendingPull] = useState<GoogleDocSyncPreview | null>(null);
  const { accessToken, hasValidSession, expireSession } = useGoogleStore();

  const showSessionExpired = useCallback(() => {
    setError(t('gdocs.sessionExpired'));
    toast.error(t('gdocs.sessionExpired'));
  }, [t]);

  const reportFailure = useCallback(
    (err: unknown) => {
      // A 401 is not "this document failed" — it is "the integration is no
      // longer connected". Reset the session so the picker offers the connect
      // screen again instead of showing Google's raw error body in a chip.
      if (handleGoogleAuthError(err)) {
        showSessionExpired();
        return;
      }
      const message = err instanceof Error ? err.message : t('writings.gdoc.syncError');
      setError(message);
      toast.error(message);
    },
    [showSessionExpired, t],
  );

  const finishPull = useCallback(
    (changes: Partial<Writing>) => {
      onSynced(changes);
      toast.success(t('writings.gdoc.synced'));
    },
    [onSynced, t],
  );

  const handleSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!accessToken || syncing) return;

    // The token expires roughly an hour after connecting and there is nothing
    // to refresh it with, so check before spending a round trip on a request
    // that would come back 401.
    if (!hasValidSession()) {
      expireSession();
      showSessionExpired();
      return;
    }

    setSyncing(true);
    setError(null);
    try {
      const outcome = await syncGoogleDoc(accessToken, writing);
      if (outcome.status === 'needs-confirmation') setPendingPull(outcome.preview);
      else finishPull(outcome.changes);
    } catch (err: unknown) {
      reportFailure(err);
    } finally {
      setSyncing(false);
    }
  };

  const confirmPull = async () => {
    const preview = pendingPull;
    if (!preview) return;
    setPendingPull(null);
    setSyncing(true);
    setError(null);
    try {
      finishPull(await applyGoogleDocSync(writing, preview));
    } catch (err: unknown) {
      reportFailure(err);
    } finally {
      setSyncing(false);
    }
  };

  const cancelPull = () => {
    setPendingPull(null);
    toast.info(t('writings.gdoc.syncKeptLocal'));
  };

  const shrinkMessage = pendingPull
    ? (pendingPull.risk === 'emptied'
        ? t('writings.gdoc.shrinkEmptied')
        : t('writings.gdoc.shrinkShorter')
      )
        .replace('{title}', writing.title)
        .replace('{cached}', String(pendingPull.cachedWordCount))
        .replace('{incoming}', String(pendingPull.incomingWordCount))
    : '';

  const sizeClasses = size === 'sm'
    ? 'p-1.5 text-xs'
    : 'px-3 py-1.5 text-sm gap-1.5';

  return (
    <div className="relative">
      <button
        onClick={handleSync}
        disabled={syncing || !accessToken}
        className={`inline-flex items-center ${sizeClasses} rounded-lg transition
          ${syncing
            ? 'bg-blue-500/10 text-blue-400 cursor-wait'
            : 'hover:bg-elevated text-text-muted hover:text-blue-400'
          }
          ${!accessToken ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        title={!accessToken ? t('writings.gdoc.connectFirst') : t('writings.gdoc.syncTooltip')}
      >
        <RefreshCw size={size === 'sm' ? 14 : 16} className={syncing ? 'animate-spin' : ''} />
        {size === 'md' && <span>{syncing ? t('writings.gdoc.syncing') : t('writings.gdoc.sync')}</span>}
      </button>
      {error && (
        <div className="absolute top-full right-0 mt-1 px-2 py-1 bg-red-500/20 text-red-400 text-[10px] rounded max-w-xs z-10">
          {error}
        </div>
      )}

      {/* A pull that empties or guts the local copy is put to the writer rather
          than applied. Cancelling leaves the cached chapter exactly as it was. */}
      <ConfirmDialog
        open={pendingPull !== null}
        destructive
        title={t('writings.gdoc.shrinkTitle')}
        message={shrinkMessage}
        confirmLabel={t('writings.gdoc.shrinkConfirm')}
        cancelLabel={t('writings.gdoc.shrinkKeep')}
        onConfirm={confirmPull}
        onCancel={cancelPull}
      />
    </div>
  );
}
