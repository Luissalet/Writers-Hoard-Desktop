// ============================================
// Media Downloader — standalone page (no project required)
// ============================================
//
// Renders the Scrapper engine in `download` mode. Owns:
//   - Health probing of the local yt-dlp HTTP backend
//   - The in-memory log of this session's downloads (for error feedback)
//
// The actual file lands wherever the user's browser is configured to put
// downloads — Downloads folder by default, or a save-as dialog if they
// have "Ask where to save each file before downloading" enabled.
//
// Routed at `/media-downloader` from App.tsx.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import TopBar from '@/components/layout/TopBar';
import ScrapperEngine, { type SessionDownload } from '@/engines/scrapper/components/ScrapperEngine';
import {
  checkHealth,
  downloadInBrowser,
  type MediaFormat,
} from '@/services/mediaDownloader';

export default function MediaDownloader() {
  const { t } = useTranslation();
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
      setBusy(true);
      try {
        const result = await downloadInBrowser(url, format);
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
    [],
  );

  const banner = useMemo(() => {
    if (serverOk !== false) return null;
    return (
      <div className="px-4 py-3 border-b bg-red-950/30 border-red-900/50 flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <AlertCircle size={18} className="text-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            {t('mediaDownloader.serverOffline')}
          </p>
          <p className="text-xs text-muted mt-0.5">
            {t('mediaDownloader.serverOfflineHint')}
          </p>
        </div>
        <div className="flex-shrink-0">
          <button
            onClick={probe}
            disabled={checking}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-elevated hover:bg-surface border border-border rounded-lg text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={checking ? 'animate-spin' : undefined} />
            {t('mediaDownloader.retry')}
          </button>
        </div>
      </div>
    );
  }, [serverOk, checking, probe, t]);

  return (
    <div className="flex flex-col h-full bg-deep">
      <TopBar
        title={t('mediaDownloader.title')}
        subtitle={t('mediaDownloader.subtitle')}
      />
      <ScrapperEngine
        mode="download"
        onDownload={handleDownload}
        downloadDisabled={serverOk === false}
        downloadBusy={busy}
        sessionDownloads={downloads}
        banner={banner}
      />
    </div>
  );
}
