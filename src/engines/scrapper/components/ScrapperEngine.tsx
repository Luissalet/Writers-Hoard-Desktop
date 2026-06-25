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

import { useState, useMemo, useCallback } from 'react';
import { Grid3x3, List, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useSnapshots } from '../hooks';
import CaptureBar from './CaptureBar';
import SnapshotCard from './SnapshotCard';
import ManualSnapshotModal from './ManualSnapshotModal';
import type { MediaFormat } from '@/services/mediaDownloader';
import { canDownloadMedia, deleteSnapshotMedia, runSnapshotDownload } from '@/services/scrapperMedia';
import { isDesktop } from '@/utils/platform';
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

  const filteredSnapshots = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return snapshots;
    return snapshots.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.url.toLowerCase().includes(q) ||
      s.notes.toLowerCase().includes(q) ||
      s.tags.some(tag => tag.toLowerCase().includes(q)) ||
      (s.extractedText && s.extractedText.toLowerCase().includes(q))
    );
  }, [snapshots, searchQuery]);

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

  // Capture: persist the snapshot first, then (desktop, downloadable source)
  // kick off the background download that fills in the local playable file.
  const handleCapture = useCallback(
    (snapshot: Snapshot) => {
      void (async () => {
        await addSnapshot(snapshot);
        if (isDesktop() && canDownloadMedia(snapshot.source)) {
          await runSnapshotDownload(snapshot, editSnapshot, 'video');
        }
      })();
    },
    [addSnapshot, editSnapshot],
  );

  // Delete: also remove the downloaded file so the library doesn't leak.
  const handleDelete = useCallback(
    (id: string) => {
      const target = snapshots.find((s) => s.id === id);
      if (target?.localMediaPath) void deleteSnapshotMedia(target.localMediaPath);
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
              {searchQuery ? t('scrapper.noResults') : t('scrapper.noSnapshots')}
            </h3>
            <p className="text-muted text-sm max-w-sm">
              {searchQuery
                ? t('scrapper.adjustSearch')
                : t('scrapper.startCapturing')}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredSnapshots.map((snapshot) => (
              <SnapshotCard
                key={snapshot.id}
                snapshot={snapshot}
                onUpdate={editSnapshot}
                onDelete={handleDelete}
                tagSuggestions={allTags}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2 max-w-4xl">
            {filteredSnapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="bg-elevated border border-border rounded-lg p-4 hover:border-accent-gold cursor-pointer transition-all hover:shadow-md"
                onClick={() => {
                  const card = document.querySelector(`[data-snapshot-id="${snapshot.id}"]`);
                  if (card) card.dispatchEvent(new Event('click', { bubbles: true }));
                }}
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
                  <span className="flex-shrink-0 text-xs font-medium text-muted uppercase">
                    {snapshot.source}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isManualModalOpen && (
        <ManualSnapshotModal
          projectId={projectId}
          onSave={(snapshot) => {
            addSnapshot(snapshot);
            setIsManualModalOpen(false);
          }}
          onCancel={() => setIsManualModalOpen(false)}
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
