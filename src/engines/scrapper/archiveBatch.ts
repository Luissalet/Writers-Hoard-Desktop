// ============================================
// Scrapper — "Archive link-only" batch, owned by the module, not a view
// ============================================
//
// The batch runs for minutes. It used to live in the view's state, so leaving
// the Recortes tab and coming back mounted a view that knew nothing about it:
// no progress, no Stop, and the button offered to start a second batch that
// ran concurrently with the first. Here there is exactly one run at a time,
// and every mounted Scrapper view reads its progress from the same store.

import { create } from 'zustand';
import { t } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import { notifyDataChanged } from '@/engines/_shared';
import { cancelSnapshotCapture, runSnapshotCapture } from '@/services/pageCapture';
import { getSnapshot, updateSnapshot } from './operations';
import { isLinkOnly } from './preservation';
import type { Snapshot } from './types';

interface ArchiveBatchState {
  /** Pages handled so far / pages queued; null when no batch is running. */
  progress: { done: number; total: number } | null;
}

export const useArchiveBatchStore = create<ArchiveBatchState>(() => ({ progress: null }));

// The running batch. `currentId` is the clipping whose page is being rendered
// right now, so Stop can cancel it instead of waiting for it to finish.
let activeRun: { cancelled: boolean; currentId: string | null } | null = null;

// Writes go around every entity hook (the view that started the batch may be
// gone), so announce them: whichever Scrapper view is mounted refetches.
async function writeSnapshot(id: string, changes: Partial<Snapshot>): Promise<void> {
  await updateSnapshot(id, changes);
  notifyDataChanged({ source: 'other', table: 'snapshots', entityId: id });
}

/**
 * Archive every given link-only web page, one at a time (a hidden Chromium
 * window per page is heavy). Only ever ADDS a local copy — the capture
 * lifecycle never touches the link itself. Ends with ONE toast that sums up
 * the batch. Returns false, starting nothing, while another batch runs.
 */
export function startArchiveBatch(ids: readonly string[]): boolean {
  if (activeRun || ids.length === 0) return false;
  const run = { cancelled: false, currentId: null as string | null };
  activeRun = run;
  const total = ids.length;
  useArchiveBatchStore.setState({ progress: { done: 0, total } });
  void (async () => {
    let ok = 0;
    let failed = 0;
    try {
      for (const [index, id] of ids.entries()) {
        if (run.cancelled) break;
        // Re-read: the queue can wait minutes, and meanwhile the clipping may
        // have been edited, archived by hand or deleted.
        const fresh = await getSnapshot(id).catch(() => undefined);
        if (fresh && isLinkOnly(fresh) && fresh.captureState !== 'capturing') {
          run.currentId = id;
          // Never throws by contract; one surprise must not strand the rest.
          await runSnapshotCapture(fresh, writeSnapshot).catch((error: unknown) => {
            console.error('Batch archive: capture failed', fresh.url, error);
          });
          run.currentId = null;
          const after = await getSnapshot(id).catch(() => undefined);
          if (after?.captureState === 'done') ok++;
          else if (after?.captureState === 'error') failed++;
        }
        useArchiveBatchStore.setState({ progress: { done: index + 1, total } });
      }
    } finally {
      activeRun = null;
      useArchiveBatchStore.setState({ progress: null });
    }
    const skipped = total - ok - failed;
    const parts = [
      t('scrapper.archiveLinkOnly.summary').replace('{ok}', String(ok)).replace('{total}', String(total)),
    ];
    if (failed > 0) {
      parts.push(t('scrapper.archiveLinkOnly.summaryFailed').replace('{failed}', String(failed)));
    }
    if (skipped > 0) {
      parts.push(t('scrapper.archiveLinkOnly.summarySkipped').replace('{skipped}', String(skipped)));
    }
    const message = parts.join(' ');
    if (failed > 0) toast.error(message, 10000);
    else if (ok > 0) toast.success(message);
    else toast.info(message);
  })();
  return true;
}

/** Stop the running batch; the page being rendered right now is cancelled too. */
export function stopArchiveBatch(): void {
  const run = activeRun;
  if (!run) return;
  run.cancelled = true;
  if (run.currentId) void cancelSnapshotCapture(run.currentId);
}
