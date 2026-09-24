// ============================================
// Scrapper Engine — Main Component (dual-mode)
// ============================================
//
// Two modes:
// - `archive` (default): used inside a project tab. Persists URL metadata
//   into the snapshots table and renders the snapshot grid/list.
// - `download`: used by the standalone `/media-downloader` page. Renders
//   only the CaptureBar plus an ephemeral "this session" list of completed
//   downloads. No DB, no archive UI.

import { useState, useMemo, useCallback, useRef } from 'react';
import {
  Grid3x3,
  List,
  CheckCircle2,
  AlertCircle,
  Instagram as InstagramIcon,
  Link2,
  Archive,
  Download,
  Loader2,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog, EngineSpinner, useDeepLinkParam } from '@/engines/_shared';
import { useSnapshots } from '../hooks';
import { getSnapshot } from '../operations';
import { isLinkOnly } from '../preservation';
import { downloadLinksCsv } from '../linkExport';
import PreservationBadge from './PreservationBadge';
import CaptureBar from './CaptureBar';
import SnapshotCard from './SnapshotCard';
import SnapshotDetail from './SnapshotDetail';
import ManualSnapshotModal from './ManualSnapshotModal';
import InstagramConnect from './InstagramConnect';
import ImportCollectionModal, { type ImportedCollectionItem } from './ImportCollectionModal';
import type { MediaFormat } from '@/services/mediaDownloader';
import {
  canDownloadMedia,
  deleteSnapshotMedia,
  runSnapshotDownload,
  isoFromYtDate,
} from '@/services/scrapperMedia';
import {
  canCapturePage,
  cancelSnapshotCapture,
  deleteSnapshotCapture,
  runSnapshotCapture,
} from '@/services/pageCapture';
import { extractDomainFromUrl } from '../services/urlDetector';
import { isDesktop } from '@/utils/platform';
import { useAiStore } from '@/stores/aiStore';
import { toast } from '@/components/common/toast';
import type { Snapshot } from '../types';

type ViewMode = 'grid' | 'list';

export interface SessionDownload {
  id: string;
  url: string;
  filename: string;
  sizeBytes: number;
  format: MediaFormat;
  status: 'success' | 'error';
  errorMessage?: string;
  at: number;
}

interface ArchiveProps {
  mode?: 'archive';
  projectId: string;
}

interface DownloadModeProps {
  mode: 'download';
  /** Async download handler — page owns the folder handle + backend call */
  onDownload: (url: string, format: MediaFormat) => Promise<void>;
  /** Disable the submit button (e.g. no folder picked, server offline) */
  downloadDisabled?: boolean;
  /** Show "Downloading…" while a download is in flight */
  downloadBusy?: boolean;
  /** In-memory log of downloads completed in this session */
  sessionDownloads?: SessionDownload[];
  /** Optional banner content above the capture bar (e.g. offline / no folder) */
  banner?: React.ReactNode;
}

type ScrapperEngineProps = ArchiveProps | DownloadModeProps;

export default function ScrapperEngine(props: ScrapperEngineProps) {
  if (props.mode === 'download') {
    return <DownloadModeView {...props} />;
  }
  return <ArchiveModeView projectId={props.projectId} />;
}

// ---------------------------------------------------------------------------
// Archive mode (existing behavior, project-scoped)
// ---------------------------------------------------------------------------

function ArchiveModeView({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { items: snapshots, loading, addItem: addSnapshot, editItem: editSnapshot, removeItem: removeSnapshot } =
    useSnapshots(projectId);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const [searchFocused, setSearchFocused] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const deepLinkedSnapshotId = useDeepLinkParam('entity');
  const [appliedDeepLink, setAppliedDeepLink] = useState<string | null>(null);
  const [linkOnlyFilter, setLinkOnlyFilter] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveProgress, setArchiveProgress] = useState<{ done: number; total: number } | null>(null);
  // The running batch archive, if any. `currentId` is the clipping whose page
  // is being rendered right now, so Stop can cancel it instead of waiting.
  const archiveRunRef = useRef<{ cancelled: boolean; currentId: string | null } | null>(null);
  const aiConfig = useAiStore((s) => s.config);

  if (
    deepLinkedSnapshotId
    && deepLinkedSnapshotId !== appliedDeepLink
    && snapshots.some((snapshot) => snapshot.id === deepLinkedSnapshotId)
  ) {
    setAppliedDeepLink(deepLinkedSnapshotId);
    setSearchQuery('');
    setLinkOnlyFilter(false);
    setSelectedSnapshotId(deepLinkedSnapshotId);
  }

  // Clippings whose only local trace is the URL, and the subset the page
  // archiver can fix (media links go through their own per-clipping download).
  const linkOnlyCount = useMemo(() => snapshots.filter((s) => isLinkOnly(s)).length, [snapshots]);
  const archivableIds = useMemo(
    () =>
      snapshots
        .filter((s) => isLinkOnly(s) && canCapturePage(s.source) && s.captureState !== 'capturing')
        .map((s) => s.id),
    [snapshots],
  );

  const filteredSnapshots = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = linkOnlyFilter ? snapshots.filter((s) => isLinkOnly(s)) : snapshots;
    if (!q) return base;
    return base.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.url.toLowerCase().includes(q) ||
      s.notes.toLowerCase().includes(q) ||
      s.tags.some(tag => tag.toLowerCase().includes(q)) ||
      (s.extractedText && s.extractedText.toLowerCase().includes(q))
    );
  }, [snapshots, searchQuery, linkOnlyFilter]);
  const hasFilters = Boolean(searchQuery) || linkOnlyFilter;

  const clearFilters = () => {
    setSearchQuery('');
    setSearchActiveIndex(-1);
    setLinkOnlyFilter(false);
  };
  const selectedSnapshot = snapshots.find((snapshot) => snapshot.id === selectedSnapshotId);

  // All distinct tags already used in this project — offered as autocomplete.
  const allTags = useMemo(
    () => Array.from(new Set(snapshots.flatMap((s) => s.tags))).sort((a, b) => a.localeCompare(b)),
    [snapshots],
  );

  // Tag suggestions for the search box (exclude the exact term so it closes on pick).
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allTags.filter((tg) => tg.toLowerCase() !== q && tg.toLowerCase().includes(q)).slice(0, 8);
  }, [allTags, searchQuery]);

  const pickSearchTag = (tag: string) => {
    setSearchQuery(tag);
    setSearchActiveIndex(-1);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (searchMatches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchActiveIndex((i) => (i + 1) % searchMatches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchActiveIndex((i) => (i <= 0 ? searchMatches.length - 1 : i - 1));
    } else if (e.key === 'Enter' && searchActiveIndex >= 0) {
      e.preventDefault();
      pickSearchTag(searchMatches[searchActiveIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSearchFocused(false);
    }
  };

  // Capture: persist the snapshot first, then kick off the background job that
  // fills in the local copy — yt-dlp for media links, a full page archive
  // (PDF + screenshot + HTML) for ordinary web pages.
  const handleCapture = useCallback(
    async (snapshot: Snapshot) => {
      // Confirm the link itself before the capture bar clears its input.
      await addSnapshot(snapshot);
      if (!isDesktop()) return;
      void (async () => {
        if (canDownloadMedia(snapshot.source)) {
          await runSnapshotDownload(snapshot, editSnapshot, 'video');
        } else if (canCapturePage(snapshot.source)) {
          await runSnapshotCapture(snapshot, editSnapshot);
        }
      })().catch(error => {
        console.error('Snapshot background capture failed', error);
        toast.error(t(canDownloadMedia(snapshot.source) ? 'scrapper.downloadFailed' : 'scrapper.captureFailed'));
      });
    },
    [addSnapshot, editSnapshot, t],
  );

  // Collection import: the modal already listed + reviewed everything; here we
  // persist every confirmed link FIRST, and only then download media one at a
  // time. Interleaving the two (save #1, download #1 for minutes, save #2, …)
  // meant a confirmed link only existed once every download before it had
  // finished: closing the app mid-import silently dropped the rest, and a
  // single failed write aborted the loop. The links are the irreplaceable part
  // (lessons #67); the media can always be fetched again from them.
  // Downloads stay sequential (not Promise.all) so they queue predictably
  // instead of firing N gallery-dl/yt-dlp processes at once.
  const handleImportCollection = useCallback(
    (items: ImportedCollectionItem[]) => {
      setIsImportModalOpen(false);
      if (items.length === 0) return;
      toast.success(
        t('scrapper.importCollection.started').replace('{count}', String(items.length)),
      );
      void (async () => {
        const saved: Snapshot[] = [];
        for (const item of items) {
          const snapshot: Snapshot = {
            id: crypto.randomUUID(),
            projectId,
            url: item.url,
            title:
              item.description?.trim().slice(0, 80) ||
              (item.author ? `@${item.author}` : extractDomainFromUrl(item.url)),
            source: 'instagram',
            status: 'success',
            notes: '',
            tags: item.tags,
            description: item.description,
            author: item.author,
            publishDate: isoFromYtDate(item.uploadDate),
            preservedAt: Date.now(),
            createdAt: Date.now(),
          };
          try {
            await addSnapshot(snapshot);
            saved.push(snapshot);
          } catch (error) {
            console.error('Collection import: could not save link', item.url, error);
          }
        }
        const failed = items.length - saved.length;
        if (failed > 0) {
          toast.error(t('scrapper.importCollection.saveFailed').replace('{count}', String(failed)));
        }
        if (!isDesktop()) return;
        for (const snapshot of saved) {
          if (!canDownloadMedia(snapshot.source)) continue;
          // Never throws by contract, but one surprise must not strand the
          // downloads queued behind it.
          await runSnapshotDownload(snapshot, editSnapshot, 'video').catch((error: unknown) => {
            console.error('Collection import: download failed', snapshot.url, error);
          });
        }
      })();
    },
    [projectId, addSnapshot, editSnapshot, t],
  );

  // Batch archive of every link-only web page, one at a time (a hidden
  // Chromium window per page is heavy). Only ever ADDS a local copy — the
  // capture lifecycle never touches the link itself. Ends with ONE toast that
  // sums up the batch instead of a failure toast per page.
  const startArchiveLinkOnly = useCallback(() => {
    setArchiveConfirmOpen(false);
    if (archiveRunRef.current || archivableIds.length === 0) return;
    const ids = archivableIds;
    const run = { cancelled: false, currentId: null as string | null };
    archiveRunRef.current = run;
    setArchiveProgress({ done: 0, total: ids.length });
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
            await runSnapshotCapture(fresh, editSnapshot).catch((error: unknown) => {
              console.error('Batch archive: capture failed', fresh.url, error);
            });
            run.currentId = null;
            const after = await getSnapshot(id).catch(() => undefined);
            if (after?.captureState === 'done') ok++;
            else if (after?.captureState === 'error') failed++;
          }
          setArchiveProgress({ done: index + 1, total: ids.length });
        }
      } finally {
        archiveRunRef.current = null;
        setArchiveProgress(null);
      }
      const skipped = ids.length - ok - failed;
      const parts = [
        t('scrapper.archiveLinkOnly.summary')
          .replace('{ok}', String(ok))
          .replace('{total}', String(ids.length)),
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
  }, [archivableIds, editSnapshot, t]);

  const stopArchiveLinkOnly = () => {
    const run = archiveRunRef.current;
    if (!run) return;
    run.cancelled = true;
    if (run.currentId) void cancelSnapshotCapture(run.currentId);
  };

  // Delete: also remove the local files so the library doesn't leak.
  const handleDelete = useCallback(
    (id: string) => {
      const target = snapshots.find((s) => s.id === id);
      if (target && (target.localMediaPath || target.mediaItems?.length)) {
        void deleteSnapshotMedia(target);
      }
      if (target && (target.capturePdfPath || target.captureImagePath || target.captureHtmlPath)) {
        void deleteSnapshotCapture(target);
      }
      void removeSnapshot(id);
    },
    [snapshots, removeSnapshot],
  );

  // Only show the full-view spinner on the initial load. A refresh after an
  // edit (e.g. saving a tag) also flips `loading`, and collapsing to the spinner
  // here would unmount the open detail modal — closing it mid-edit.
  if (loading && snapshots.length === 0)
    return <EngineSpinner className="flex items-center justify-center h-64 bg-deep" />;

  return (
    <div className="flex flex-col h-full bg-deep">
      <CaptureBar
        projectId={projectId}
        onCapture={handleCapture}
        onManualEntry={() => setIsManualModalOpen(true)}
      />

      <div className="bg-surface border-b border-border px-4 py-3 flex items-center justify-between gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchActiveIndex(-1);
            }}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={t('scrapper.searchSnapshots')}
            className="w-full px-3 py-1.5 bg-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-gold"
          />
          {searchFocused && searchMatches.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto bg-elevated border border-border rounded-lg shadow-xl py-1">
              {searchMatches.map((tg, i) => (
                <li key={tg}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickSearchTag(tg);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                      i === searchActiveIndex
                        ? 'bg-accent-gold/20 text-foreground'
                        : 'text-muted hover:bg-surface hover:text-foreground'
                    }`}
                  >
                    <span className="text-accent-plum-light">#</span>
                    {tg}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {(linkOnlyCount > 0 || linkOnlyFilter) && (
          <button
            type="button"
            aria-pressed={linkOnlyFilter}
            onClick={() => setLinkOnlyFilter((on) => !on)}
            title={t('scrapper.linkOnlyFilterHint')}
            className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors ${
              linkOnlyFilter
                ? 'border-accent-gold bg-accent-gold/20 text-foreground'
                : 'border-border bg-elevated text-muted hover:text-foreground hover:border-accent-gold'
            }`}
          >
            <Link2 size={14} aria-hidden="true" />
            {t('scrapper.linkOnlyFilter').replace('{count}', String(linkOnlyCount))}
          </button>
        )}
        {isDesktop() && archiveProgress ? (
          <button
            type="button"
            onClick={stopArchiveLinkOnly}
            className="flex flex-shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-accent-gold bg-elevated text-foreground transition-colors"
          >
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            {t('scrapper.archiveLinkOnly.stop')
              .replace('{done}', String(archiveProgress.done))
              .replace('{total}', String(archiveProgress.total))}
          </button>
        ) : isDesktop() && archivableIds.length > 0 ? (
          <button
            type="button"
            onClick={() => setArchiveConfirmOpen(true)}
            title={t('scrapper.archiveLinkOnly.buttonHint')}
            className="flex flex-shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-elevated text-foreground hover:border-accent-gold transition-colors"
          >
            <Archive size={14} aria-hidden="true" />
            {t('scrapper.archiveLinkOnly.button').replace('{count}', String(archivableIds.length))}
          </button>
        ) : null}
        {snapshots.length > 0 && (
          <button
            type="button"
            onClick={() => downloadLinksCsv(snapshots)}
            title={t('scrapper.exportLinksHint')}
            aria-label={t('scrapper.exportLinks')}
            className="flex flex-shrink-0 items-center p-2 rounded-lg border border-border bg-elevated text-foreground hover:border-accent-gold transition-colors"
          >
            <Download size={14} aria-hidden="true" />
          </button>
        )}
        <InstagramConnect />
        {isDesktop() && (
          <button
            onClick={() => setIsImportModalOpen(true)}
            title={t('scrapper.importCollection.buttonHint')}
            className="flex flex-shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-elevated text-foreground hover:border-accent-gold transition-colors"
          >
            <InstagramIcon size={14} className="text-pink-500" />
            {t('scrapper.importCollection.button')}
          </button>
        )}
        <div className="flex items-center gap-1 bg-elevated border border-border rounded-lg p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded transition-colors ${
              viewMode === 'grid'
                ? 'bg-accent-gold text-black'
                : 'text-muted hover:text-foreground'
            }`}
            title={t('scrapper.gridView')}
          >
            <Grid3x3 size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded transition-colors ${
              viewMode === 'list'
                ? 'bg-accent-gold text-black'
                : 'text-muted hover:text-foreground'
            }`}
            title={t('scrapper.listView')}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {filteredSnapshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 rounded-full bg-elevated flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-serif font-semibold text-foreground mb-2">
              {hasFilters ? t('scrapper.noResults') : t('scrapper.noSnapshots')}
            </h3>
            <p className="text-muted text-sm max-w-sm">
              {hasFilters
                ? t('scrapper.adjustSearch')
                : t('scrapper.startCapturing')}
            </p>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 px-3 py-1.5 text-xs rounded-lg border border-border bg-elevated text-foreground hover:border-accent-gold transition-colors"
              >
                {t('scrapper.clearFilters')}
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredSnapshots.map((snapshot) => (
              <SnapshotCard
                key={snapshot.id}
                snapshot={snapshot}
                onOpen={setSelectedSnapshotId}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2 max-w-4xl">
            {filteredSnapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="bg-elevated border border-border rounded-lg p-4 hover:border-accent-gold cursor-pointer transition-[border-color,box-shadow] hover:shadow-md"
                onClick={() => setSelectedSnapshotId(snapshot.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-serif font-semibold text-foreground truncate">
                      {snapshot.title}
                    </h4>
                    <a
                      href={snapshot.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-accent-gold hover:underline block truncate mt-1"
                    >
                      {snapshot.url || t('scrapper.manualEntry')}
                    </a>
                    {snapshot.notes && (
                      <p className="text-xs text-muted mt-2 line-clamp-1">{snapshot.notes}</p>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <PreservationBadge snapshot={snapshot} />
                    <span className="text-xs font-medium text-muted uppercase">
                      {snapshot.source}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isManualModalOpen && (
        <ManualSnapshotModal
          projectId={projectId}
          onSave={async (snapshot) => {
            await addSnapshot(snapshot);
            setIsManualModalOpen(false);
          }}
          onCancel={() => setIsManualModalOpen(false)}
        />
      )}

      {isImportModalOpen && (
        <ImportCollectionModal
          allTags={allTags}
          aiConfig={aiConfig}
          onImport={handleImportCollection}
          onCancel={() => setIsImportModalOpen(false)}
        />
      )}

      <ConfirmDialog
        open={archiveConfirmOpen}
        title={t('scrapper.archiveLinkOnly.title')}
        message={t('scrapper.archiveLinkOnly.message').replace('{count}', String(archivableIds.length))}
        confirmLabel={t('scrapper.archiveLinkOnly.confirm').replace('{count}', String(archivableIds.length))}
        onConfirm={startArchiveLinkOnly}
        onCancel={() => setArchiveConfirmOpen(false)}
      />

      {selectedSnapshot && (
        <SnapshotDetail
          // Remount per clipping: a deep link can swap the selection while the
          // modal is open, and the reused instance would carry the previous
          // clipping's notes and tags into this one's next save.
          key={selectedSnapshot.id}
          snapshot={selectedSnapshot}
          onUpdate={editSnapshot}
          onDelete={handleDelete}
          onClose={() => setSelectedSnapshotId(null)}
          tagSuggestions={allTags}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Download mode (standalone /media-downloader page)
// ---------------------------------------------------------------------------

function DownloadModeView({
  onDownload,
  downloadDisabled,
  downloadBusy,
  sessionDownloads = [],
  banner,
}: DownloadModeProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col h-full bg-deep">
      {banner}
      <CaptureBar
        mode="download"
        onDownload={onDownload}
        disabled={downloadDisabled}
        busy={downloadBusy}
      />
      <div className="flex-1 overflow-y-auto p-4">
        {sessionDownloads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 rounded-full bg-elevated flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"
                />
              </svg>
            </div>
            <h3 className="text-lg font-serif font-semibold text-foreground mb-2">
              {t('mediaDownloader.noDownloads')}
            </h3>
            <p className="text-muted text-sm max-w-sm">
              {t('mediaDownloader.noDownloadsHint')}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-w-4xl mx-auto">
            <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              {t('mediaDownloader.sessionDownloads')}
            </h4>
            {sessionDownloads.map((d) => (
              <div
                key={d.id}
                className="bg-elevated border border-border rounded-lg p-3 flex items-start gap-3"
              >
                {d.status === 'success' ? (
                  <CheckCircle2 size={18} className="text-green-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {d.status === 'success' ? d.filename : t('mediaDownloader.downloadFailed')}
                  </p>
                  <p className="text-xs text-muted truncate">{d.url}</p>
                  {d.status === 'error' && d.errorMessage && (
                    <p className="text-xs text-red-400 mt-1">{d.errorMessage}</p>
                  )}
                </div>
                {d.status === 'success' && (
                  <span className="text-xs text-muted whitespace-nowrap">
                    {formatBytes(d.sizeBytes)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
