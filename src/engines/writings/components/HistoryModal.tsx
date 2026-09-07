// ============================================
// Writing history — list, preview & restore snapshots
// ============================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RotateCcw, Trash2, Plus, Camera } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { ConfirmDialog } from '@/engines/_shared';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import { countWords, stripHtml } from '@/utils/text';
import type { Writing } from '@/types';
import type { WritingSnapshotMeta } from '../snapshotTypes';
import {
  deleteSnapshot,
  listSnapshotMeta,
  readSnapshot,
  restoreSnapshot,
  takeSnapshot,
} from '../snapshots';

interface HistoryModalProps {
  open: boolean;
  onClose: () => void;
  writing: Writing;
  /** Version to reveal immediately (for example the losing side of a sync). */
  initialSnapshotId?: string | null;
  /** Current (possibly unsaved) editor content — used for manual snapshots. */
  currentContent: string;
  currentTitle: string;
  /** Called after a successful restore with the restored state. */
  onRestored: (state: { title: string; content: string; wordCount: number }) => void;
}

type DiffKind =
  /** Present in both this version and the current text. */
  | 'same'
  /** Only in this version — restoring brings it back. */
  | 'version'
  /** Only in the current text — restoring drops it. */
  | 'current';

interface DiffLine {
  key: string;
  kind: DiffKind;
  text: string;
}

/**
 * Snapshot HTML → one entry per block, so the comparison below is a comparison
 * of PARAGRAPHS: the unit a writer actually cuts, moves and misses. `stripHtml`
 * alone collapses the whole chapter into a single line, which is why the old
 * 90-character excerpt could only ever show the opening — the part that
 * changed least.
 */
function toParagraphs(html: string): string[] {
  if (!html) return [];
  return html
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map((chunk) => stripHtml(chunk))
    .filter((line) => line.length > 0);
}

/**
 * Paragraphs the two texts share, in order, are the ones the LCS table below
 * keeps; everything else is an insertion on one side or the other. The table is
 * O(n·m), which is nothing at paragraph granularity — a 400-paragraph novella
 * chapter against another is 160 000 cells of Int32 — but a pasted 20 000-line
 * transcript is not, so past the cap the pane still shows the full text and
 * says the line-by-line comparison was skipped.
 */
const MAX_DIFF_CELLS = 250_000;

function diffParagraphs(version: string[], current: string[]): DiffLine[] | null {
  const shared = Math.min(version.length, current.length);
  let head = 0;
  while (head < shared && version[head] === current[head]) head += 1;
  let tail = 0;
  while (
    tail < shared - head &&
    version[version.length - 1 - tail] === current[current.length - 1 - tail]
  ) {
    tail += 1;
  }

  const a = version.slice(head, version.length - tail);
  const b = current.slice(head, current.length - tail);
  if (a.length * b.length > MAX_DIFF_CELLS) return null;

  const width = b.length + 1;
  const lcs = new Int32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  const push = (kind: DiffKind, text: string) => {
    lines.push({ key: `${kind}-${lines.length}`, kind, text });
  };

  for (let k = 0; k < head; k += 1) push('same', version[k]);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      push('version', a[i]);
      i += 1;
    } else {
      push('current', b[j]);
      j += 1;
    }
  }
  while (i < a.length) {
    push('version', a[i]);
    i += 1;
  }
  while (j < b.length) {
    push('current', b[j]);
    j += 1;
  }
  for (let k = version.length - tail; k < version.length; k += 1) push('same', version[k]);

  return lines;
}

const LINE_CLASS: Record<DiffKind, string> = {
  same: 'text-text-muted',
  version: 'rounded-r border-l-2 border-success/60 bg-success/10 pl-2 text-text-primary',
  current: 'rounded-r border-l-2 border-danger/50 bg-danger/10 pl-2 text-text-dim line-through',
};

export default function HistoryModal({
  open,
  onClose,
  writing,
  initialSnapshotId,
  currentContent,
  currentTitle,
  onRestored,
}: HistoryModalProps) {
  const { t } = useTranslation();
  // The LIST is metadata: a date, a reason, a word count. It used to be the
  // whole version history including every body, which on a chapter the writer
  // has opened three hundred times is tens of megabytes of HTML parsed out of
  // IndexedDB and pinned in this state array — to draw a column of dates.
  const [snapshots, setSnapshots] = useState<WritingSnapshotMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The PREVIEW is one body, fetched when the writer picks a version. Exactly
  // one chapter of prose is ever in this component, and only after a click.
  const [selectedBody, setSelectedBody] = useState<{ id: string; content: string } | null>(null);
  const [pendingRestore, setPendingRestore] = useState<WritingSnapshotMeta | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setSnapshots(await listSnapshotMeta(writing.id));
  }, [writing.id]);

  useEffect(() => {
    if (open) {
      if (initialSnapshotId) setSelectedId(initialSnapshotId);
      void refresh();
    }
  }, [initialSnapshotId, open, refresh]);

  // Closing drops the loaded body. The modal stays mounted between openings, so
  // without this a chapter the writer glanced at once stays in the heap for the
  // rest of the editing session.
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setSelectedBody(null);
    }
  }, [open]);

  // One read per selection, and the answer is dropped if the writer has already
  // clicked something else: two clicks in flight must not let the slower read
  // paint its text under the newer selection's header.
  useEffect(() => {
    if (!selectedId) {
      setSelectedBody(null);
      return;
    }
    let current = true;
    void readSnapshot(selectedId).then((snap) => {
      if (!current) return;
      setSelectedBody(snap ? { id: selectedId, content: snap.content } : null);
    });
    return () => {
      current = false;
    };
  }, [selectedId]);

  const reasonLabel = (reason: WritingSnapshotMeta['reason']) =>
    t(`writings.history.reason.${reason}`);

  // "Now" is the editor's live text, unsaved edits included — the same text the
  // manual snapshot button would capture, so the deltas never disagree with it.
  const currentWords = useMemo(() => countWords(currentContent), [currentContent]);
  const currentParagraphs = useMemo(() => toParagraphs(currentContent), [currentContent]);

  const deltaLabel = (snapshot: WritingSnapshotMeta) => {
    const delta = snapshot.wordCount - currentWords;
    if (delta === 0) return t('writings.history.deltaSame');
    const signed = `${delta > 0 ? '+' : ''}${delta.toLocaleString()}`;
    return t('writings.history.deltaWords').replace('{delta}', signed);
  };

  const selected = snapshots.find((snap) => snap.id === selectedId) ?? null;

  // Built from the one body that was fetched, and only while it is still the
  // body of the selected row — during the read the pane says it is loading
  // rather than showing the previous version's text under a new date.
  const preview = useMemo(() => {
    if (!selectedBody || selectedBody.id !== selectedId) return null;
    const paragraphs = toParagraphs(selectedBody.content);
    const diff = diffParagraphs(paragraphs, currentParagraphs);
    // Comparison or not, the pane always shows the whole text: that is the
    // requirement, and the diff only tints it.
    const lines: DiffLine[] =
      diff ?? paragraphs.map((text, index) => ({ key: `same-${index}`, kind: 'same', text }));
    return {
      lines,
      compared: diff !== null,
      changed: diff !== null && diff.some((line) => line.kind !== 'same'),
    };
  }, [selectedBody, selectedId, currentParagraphs]);

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
    if (id === selectedId) setSelectedId(null);
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
          <div className="flex flex-col md:flex-row gap-3">
            <div className="max-h-80 overflow-y-auto space-y-1.5 md:w-72 md:shrink-0">
              {snapshots.map((snap) => {
                const created = new Date(snap.createdAt);
                const isSelected = snap.id === selectedId;
                return (
                  <div
                    key={snap.id}
                    className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg border transition ${
                      isSelected
                        ? 'border-accent-gold/50 bg-accent-gold/10'
                        : 'border-border bg-elevated/40 hover:border-accent-gold/30'
                    }`}
                  >
                    <button
                      onClick={() => setSelectedId(snap.id)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-text-primary">
                          {created.toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                          {' · '}
                          {created.toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-dim border border-border">
                          {reasonLabel(snap.reason)}
                        </span>
                      </span>
                      <span className="block text-[11px] text-text-dim truncate mt-0.5">
                        {snap.wordCount.toLocaleString()} {t('writings.words')} · {deltaLabel(snap)}
                      </span>
                    </button>
                    <button
                      onClick={() => setPendingRestore(snap)}
                      disabled={busy}
                      className="flex items-center gap-1 px-2 py-1.5 text-xs text-accent-gold border border-accent-gold/30 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-accent-gold/10 transition disabled:opacity-30"
                    >
                      <RotateCcw size={12} />
                      {t('writings.history.restore')}
                    </button>
                    <button
                      onClick={() => handleDelete(snap.id)}
                      disabled={busy}
                      className="p-1.5 text-text-dim opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger transition"
                      title={t('common.delete')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Read-only: the pane exists to answer "what is in this one?"
                before the restore, not to become a second editor. */}
            <div className="flex-1 min-w-0 h-80 flex flex-col rounded-lg border border-border bg-elevated/40">
              {selected ? (
                <>
                  {/* Header first, from the row's metadata — it is already in
                      hand, so picking a version answers instantly and only the
                      prose waits on the one read it costs. */}
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
                    <span className="text-xs text-text-primary truncate">
                      {new Date(selected.createdAt).toLocaleString()}
                    </span>
                    <span className="text-[11px] text-text-dim shrink-0">
                      {deltaLabel(selected)}
                    </span>
                  </div>

                  {preview ? (
                    <>
                      {!preview.compared && (
                        <p className="px-3 py-1.5 text-[10px] text-warning border-b border-border">
                          {t('writings.history.diff.unavailable')}
                        </p>
                      )}
                      {preview.changed && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[10px] text-text-dim border-b border-border">
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-sm bg-success/60" />
                            {t('writings.history.diff.added')}
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-sm bg-danger/60" />
                            {t('writings.history.diff.removed')}
                          </span>
                        </div>
                      )}

                      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2 text-[13px] leading-relaxed">
                        {preview.lines.length === 0 ? (
                          <p className="text-xs text-text-dim">{t('writings.history.previewEmpty')}</p>
                        ) : (
                          preview.lines.map((line) => (
                            <p key={line.key} className={LINE_CLASS[line.kind]}>
                              {line.text}
                            </p>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center px-4 text-center text-xs text-text-dim">
                      {t('common.loading')}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center px-4 text-center text-xs text-text-dim">
                  {t('writings.history.selectHint')}
                </div>
              )}
            </div>
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
