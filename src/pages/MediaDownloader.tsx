// ============================================
// Media Downloader — standalone page (no project required)
// ============================================
//
// Renders the Scrapper engine in `download` mode and owns:
//   - The save-folder handle (via useDownloadFolder, persisted in IndexedDB)
//   - Health probing of the local yt-dlp HTTP backend
//   - The in-memory log of this session's downloads
//
// Routed at `/media-downloader` from App.tsx.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Folder, FolderOpen, AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import TopBar from '@/components/layout/TopBar';
import ScrapperEngine, { type SessionDownload } from '@/engines/scrapper/components/ScrapperEngine';
import { useDownloadFolder } from '@/hooks/useDownloadFolder';
import {
  checkHealth,
  downloadToDirectory,
  supportsDirectoryPicker,
  type MediaFormat,
} from '@/services/mediaDownloader';

export default function MediaDownloader() {
  const { t } = useTranslation();
  const { handle, permission, supported, pick, ensurePermission } = useDownloadFolder();
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloads, setDownloads] = useState<SessionDownload[]>([]);

  // Probe the backend on mount and whenever the user retries.
  const probe = useCallback(async () => {
    setChecking(true);
    try {
      const h = await checkHealth();
      setServerOk(!!h?.ok);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const handleDownload = useCallback(
    async (url: string, format: MediaFormat) => {
      if (!handle) return;
      const granted = await ensurePermission();
      if (!granted) {
        setDownloads((prev) => [
          {
            id: crypto.randomUUID(),
            url,
            filename: '',
            sizeBytes: 0,
            format,
            status: 'error',
            errorMessage: t('mediaDownloader.permissionDenied'),
            at: Date.now(),
          },
          ...prev,
        ]);
        return;
      }
      setBusy(true);
      try {
        const result = await downloadToDirectory(url, format, handle);
        setDownloads((prev) => [
          {
            id: crypto.randomUUID(),
            url,
            filename: result.filename,
            sizeBytes: result.sizeBytes,
            format,
            status: 'success',
            at: Date.now(),
          },
          ...prev,
        ]);
      } catch (e) {
        setDownloads((prev) => [
          {
            id: crypto.randomUUID(),
            url,
            filename: '',
            sizeBytes: 0,
            format,
            status: 'error',
            errorMessage: e instanceof Error ? e.message : String(e),
            at: Date.now(),
          },
          ...prev,
        ]);
      } finally {
        setBusy(false);
      }
    },
    [handle, ensurePermission, t],
  );

  const banner = useMemo(() => {
    // 1. Unsupported browser
    if (!supported && !supportsDirectoryPicker()) {
      return (
        <Banner
          variant="warning"
          icon={<AlertCircle size={18} className="text-amber-500" />}
          title={t('mediaDownloader.unsupportedBrowser')}
          body={t('mediaDownloader.unsupportedBrowserHint')}
        />
      );
    }
    // 2. Server offline
    if (serverOk === false) {
      return (
        <Banner
          variant="error"
          icon={<AlertCircle size={18} className="text-red-500" />}
          title={t('mediaDownloader.serverOffline')}
          body={t('mediaDownloader.serverOfflineHint')}
          action={
            <button
              onClick={probe}
              disabled={checking}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-elevated hover:bg-surface border border-border rounded-lg text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={checking ? 'animate-spin' : undefined} />
              {t('mediaDownloader.retry')}
            </button>
          }
        />
      );
    }
    return null;
  }, [supported, serverOk, checking, probe, t]);

  const folderLabel = handle?.name ?? t('mediaDownloader.noFolder');
  const downloadDisabled = !handle || serverOk === false || permission === 'denied';

  return (
    <div className="flex flex-col h-full bg-deep">
      <TopBar
        title={t('mediaDownloader.title')}
        subtitle={t('mediaDownloader.subtitle')}
      />

      {/* Folder picker bar */}
      <div className="bg-surface border-b border-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={pick}
          disabled={!supported}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-elevated hover:bg-surface border border-border rounded-lg text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={
            supported
              ? t('mediaDownloader.chooseFolder')
              : t('mediaDownloader.unsupportedBrowser')
          }
        >
          {handle ? <FolderOpen size={16} /> : <Folder size={16} />}
          {handle ? t('mediaDownloader.changeFolder') : t('mediaDownloader.chooseFolder')}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted">{t('mediaDownloader.currentFolder')}</p>
          <p className="text-sm font-medium text-foreground truncate" title={folderLabel}>
            {folderLabel}
          </p>
        </div>
        {permission === 'denied' && (
          <span className="text-xs text-red-400">
            {t('mediaDownloader.permissionDenied')}
          </span>
        )}
      </div>

      <ScrapperEngine
        mode="download"
        onDownload={handleDownload}
        downloadDisabled={downloadDisabled}
        downloadBusy={busy}
        sessionDownloads={downloads}
        banner={banner}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banner — tiny inline message used at the top of the engine view
// ---------------------------------------------------------------------------

interface BannerProps {
  variant: 'warning' | 'error' | 'info';
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}

function Banner({ variant, icon, title, body, action }: BannerProps) {
  const bg =
    variant === 'error'
      ? 'bg-red-950/30 border-red-900/50'
      : variant === 'warning'
        ? 'bg-amber-950/30 border-amber-900/50'
        : 'bg-blue-950/30 border-blue-900/50';
  return (
    <div className={`px-4 py-3 border-b ${bg} flex items-start gap-3`}>
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted mt-0.5">{body}</p>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
