// ============================================
// Writing history — list, preview & restore snapshots
// ============================================

import { useCallback, useEffect, useState } from 'react';
import { History, RotateCcw, Trash2, Plus, Camera } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { ConfirmDialog } from '@/engines/_shared';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import { stripHtml } from '@/utils/text';
import type { Writing } from '@/types';
import type { WritingSnapshot } from '../snapshotTypes';
import { deleteSnapshot, listSnapshots, restoreSnapshot, takeSnapshot } from '../snapshots';

interface HistoryModalProps {
  open: boolean;
  onClose: () => void;
  writing: Writing;
  /** Current (possibly unsaved) editor content — used for manual snapshots. */
  currentContent: string;
  currentTitle: string;
  /** Called after a successful restore with the restored state. */
  onRestored: (state: { title: string; content: string; wordCount: number }) => void;
}

export default function HistoryModal({
  open,
  onClose,
  writing,
  currentContent,
  currentTitle,
  onRestored,
}: HistoryModalProps) {
  const { t } = useTranslation();
  const [snapshots, setSnapshots] = useState<WritingSnapshot[]>([]);
  const [pendingRestore, setPendingRestore] = useState<WritingSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setSnapshots(await listSnapshots(writing.id));
  }, [writing.id]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const reasonLabel = (reason: WritingSnapshot['reason']) =>
    t(`writings.history.reason.${reason}`);

  const handleManualSnapshot = async () => {
    setBusy(true);
    try {
      await takeSnapshot(
        { id: writing.id, projectId: writing.projectId, title: currentTitle, content: currentContent },
        'manual',
      );
      await refresh();
      toast.success(t('writings.history.saved'));
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    const snap = pendingRestore;
    setPendingRestore(null);
    if (!snap) return;
    setBusy(true);
    try {
      const restored = await restoreSnapshot(snap.id);
      if (restored) {
        onRestored(restored);
        await refresh();
        toast.success(t('writings.history.restored'));
      }
    } catch (err) {
      console.error('Restore failed:', err);
      toast.error(t('writings.history.restoreError'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteSnapshot(id);
    await refresh();
  };

  return (
    <Modal open={open} onClose={onClose} title={t('writings.history.title')} wide>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-text-dim flex items-center gap-1.5">
            <History size={13} />
            {t('writings.history.hint')}
          </p>
          <button
            onClick={handleManualSnapshot}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-gold/15 text-accent-gold border border-accent-gold/30 rounded-lg hover:bg-accent-gold/25 transition disabled:opacity-50"
          >
            <Camera size={13} />
            {t('writings.history.saveNow')}
          </button>
        </div>

        {snapshots.length === 0 ? (
          <div className="text-center py-10 text-text-dim text-sm">
            <History size={32} className="mx-auto mb-3 opacity-30" />
            {t('writings.history.empty')}
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-1.5">
            {snapshots.map((snap) => (
              <div
                key={snap.id}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-elevated/40 hover:border-accent-gold/30 transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-primary">
                      {new Date(snap.createdAt).toLocaleString()}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-dim border border-border">
                      {reasonLabel(snap.reason)}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-dim truncate mt-0.5">
                    {snap.wordCount.toLocaleString()} {t('writings.words')} · {stripHtml(snap.content).slice(0, 90)}
                  </p>
                </div>
                <button
                  onClick={() => setPendingRestore(snap)}
                  disabled={busy}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-accent-gold border border-accent-gold/30 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-accent-gold/10 transition disabled:opacity-30"
                >
                  <RotateCcw size={12} />
                  {t('writings.history.restore')}
                </button>
                <button
                  onClick={() => handleDelete(snap.id)}
                  disabled={busy}
                  className="p-1.5 text-text-dim opacity-0 group-hover:opacity-100 hover:text-danger transition"
                  title={t('common.delete')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between items-center pt-2 border-t border-border">
          <span className="text-[11px] text-text-dim flex items-center gap-1">
            <Plus size={11} />
            {t('writings.history.autoNote')}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition"
          >
            {t('common.close')}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={pendingRestore !== null}
        destructive
        message={t('writings.history.confirmRestore').replace(
          '{date}',
          pendingRestore ? new Date(pendingRestore.createdAt).toLocaleString() : '',
        )}
        onConfirm={handleRestore}
        onCancel={() => setPendingRestore(null)}
      />
    </Modal>
  );
}
