import { useCallback, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { handleGoogleAuthError, useGoogleStore } from '@/stores/googleStore';
import {
  applyGoogleDocSync,
  syncGoogleDoc,
  type GoogleDocSyncPreview,
  type GoogleDocSyncOutcome,
} from '@/services/googleDocs';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import { ConfirmDialog } from '@/engines/_shared';
import Modal from '@/components/common/Modal';
import { stripHtml } from '@/utils/text';
import type { Writing } from '@/types';

interface SyncButtonProps {
  writing: Writing;
  onSynced: (changes: Partial<Writing>) => void;
  onReviewConflict?: (snapshotId: string) => void;
  size?: 'sm' | 'md';
}

type GoogleDocConflict = Extract<GoogleDocSyncOutcome, { status: 'conflict' }>;

function readableExcerpt(html: string, limit = 1800): string {
  const text = stripHtml(html).trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export default function SyncButton({
  writing,
  onSynced,
  onReviewConflict,
  size = 'sm',
}: SyncButtonProps) {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A pull that came back empty or far shorter than the cached copy. */
  const [pendingPull, setPendingPull] = useState<GoogleDocSyncPreview | null>(null);
  /** A local edit that landed while Google was answering the pull. */
  const [pendingConflict, setPendingConflict] = useState<GoogleDocConflict | null>(null);
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

  const handleOutcome = useCallback((outcome: GoogleDocSyncOutcome) => {
    if (outcome.status === 'applied') {
      finishPull(outcome.changes);
      return;
    }
    if (outcome.status === 'needs-confirmation') {
      setPendingPull(outcome.preview);
      return;
    }
    if (outcome.status === 'conflict') {
      setPendingConflict(outcome);
      return;
    }
    const message = t('writings.gdoc.syncGone');
    setError(message);
    toast.error(message);
  }, [finishPull, t]);

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
      handleOutcome(await syncGoogleDoc(accessToken, writing));
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
      handleOutcome(await applyGoogleDocSync(writing, preview));
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

  const keepLocalAfterConflict = () => {
    setPendingConflict(null);
    toast.info(t('writings.gdoc.conflictKeptLocal'));
  };

  const applyRemoteAfterConflict = async () => {
    const conflict = pendingConflict;
    if (!conflict) return;
    setPendingConflict(null);
    setSyncing(true);
    setError(null);
    try {
      // Rebase only on the exact row shown in the conflict dialog. If another
      // edit lands while the writer is deciding, the compare-and-swap refuses
      // again and puts the newer conflict back on screen.
      handleOutcome(await applyGoogleDocSync(
        conflict.current,
        conflict.preview,
        conflict.current.updatedAt,
      ));
    } catch (err: unknown) {
      reportFailure(err);
    } finally {
      setSyncing(false);
    }
  };

  const reviewConflict = () => {
    const snapshotId = pendingConflict?.incomingSnapshotId;
    if (!snapshotId || !onReviewConflict) return;
    setPendingConflict(null);
    onReviewConflict(snapshotId);
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

      <Modal
        open={pendingConflict !== null}
        onClose={keepLocalAfterConflict}
        title={t('writings.gdoc.conflictTitle')}
        wide
      >
        {pendingConflict && (
          <div className="space-y-5">
            <p className="text-sm leading-relaxed text-text-muted">
              {t('writings.gdoc.conflictDetail')}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <section className="min-w-0 rounded-xl border border-border bg-elevated/40 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-text-primary">
                    {t('writings.gdoc.conflictLocal')}
                  </h3>
                  <span className="shrink-0 text-xs tabular-nums text-text-muted">
                    {pendingConflict.current.wordCount.toLocaleString()} {t('writings.words')}
                  </span>
                </div>
                <p className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-text-muted">
                  {readableExcerpt(pendingConflict.current.content) || t('writings.gdoc.conflictEmpty')}
                </p>
              </section>
              <section className="min-w-0 rounded-xl border border-border bg-elevated/40 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-text-primary">
                    {t('writings.gdoc.conflictRemote')}
                  </h3>
                  <span className="shrink-0 text-xs tabular-nums text-text-muted">
                    {pendingConflict.preview.incomingWordCount.toLocaleString()} {t('writings.words')}
                  </span>
                </div>
                <p className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-text-muted">
                  {readableExcerpt(pendingConflict.preview.changes.content ?? '') || t('writings.gdoc.conflictEmpty')}
                </p>
              </section>
            </div>
            <p className="text-xs leading-relaxed text-text-muted">
              {t('writings.gdoc.conflictHistory')}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={keepLocalAfterConflict}
                className="rounded-lg border border-border px-4 py-2 text-sm text-text-primary transition hover:bg-elevated focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
              >
                {t('writings.gdoc.conflictKeepLocal')}
              </button>
              {pendingConflict.incomingSnapshotId && onReviewConflict && (
                <button
                  type="button"
                  onClick={reviewConflict}
                  className="rounded-lg border border-accent-gold/40 px-4 py-2 text-sm text-accent-gold transition hover:bg-accent-gold/10 focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
                >
                  {t('writings.gdoc.conflictReview')}
                </button>
              )}
              <button
                type="button"
                onClick={() => void applyRemoteAfterConflict()}
                className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400/60"
              >
                {t('writings.gdoc.conflictUseRemote')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
