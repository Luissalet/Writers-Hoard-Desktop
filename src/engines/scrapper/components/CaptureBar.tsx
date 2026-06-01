// ============================================
// Scrapper Engine — Capture Bar Component
// ============================================
//
// Dual-mode component:
// - `mode: 'archive'` (default) — captures URL metadata into the project's
//   snapshots table. Used inside a project (`/project/:id/scrapper`).
// - `mode: 'download'` — sends the URL to the local yt-dlp HTTP backend
//   and writes the resulting file to the user's chosen folder. Used by
//   the standalone `/media-downloader` page. `projectId` is irrelevant
//   in this mode (the snapshot we'd otherwise create is never persisted).

import { useState, useCallback, useRef, useEffect } from 'react';
import { Globe, Twitter, Instagram, Youtube, Plus, Music } from 'lucide-react';
import type { Snapshot } from '../types';
import { detectUrlSource, extractDomainFromUrl } from '../services/urlDetector';
import { useTranslation } from '@/i18n/useTranslation';
import type { MediaFormat } from '@/services/mediaDownloader';

export type CaptureBarMode = 'archive' | 'download';

interface BaseProps {
  mode?: CaptureBarMode;
}

interface ArchiveProps extends BaseProps {
  mode?: 'archive';
  projectId: string;
  onCapture: (snapshot: Snapshot) => void;
  onManualEntry: () => void;
}

interface DownloadProps extends BaseProps {
  mode: 'download';
  /** Called when the user submits a URL — page handles the actual download */
  onDownload: (url: string, format: MediaFormat) => Promise<void> | void;
  /** Disable the submit button (e.g. no folder picked, server offline) */
  disabled?: boolean;
  /** Show "Downloading…" instead of "Download" while a download is in flight */
  busy?: boolean;
}

type CaptureBarProps = ArchiveProps | DownloadProps;

function isDownloadMode(props: CaptureBarProps): props is DownloadProps {
  return props.mode === 'download';
}

export default function CaptureBar(props: CaptureBarProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [format, setFormat] = useState<MediaFormat>('video');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text');
      if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
        setUrl(text);
      }
    };

    if (inputRef.current === document.activeElement) {
      document.addEventListener('paste', handlePaste);
      return () => document.removeEventListener('paste', handlePaste);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!url.trim()) return;

    setIsLoading(true);
    try {
      if (isDownloadMode(props)) {
        await props.onDownload(url, format);
        setUrl('');
      } else {
        const source = detectUrlSource(url);
        const domain = extractDomainFromUrl(url);
        const snapshot: Snapshot = {
          id: crypto.randomUUID(),
          projectId: props.projectId,
          url,
          title: domain,
          source,
          status: 'success',
          notes: '',
          tags: [],
          preservedAt: Date.now(),
          createdAt: Date.now(),
        };
        props.onCapture(snapshot);
        setUrl('');
      }
    } finally {
      setIsLoading(false);
    }
  }, [url, format, props]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLoading) {
      handleSubmit();
    }
  };

  const downloadMode = isDownloadMode(props);
  const externalBusy = downloadMode ? !!props.busy : false;
  const externalDisabled = downloadMode ? !!props.disabled : false;
  const buttonBusy = isLoading || externalBusy;

  const source = url ? detectUrlSource(url) : null;

  const getSourceIcon = () => {
    switch (source) {
      case 'tweet':
        return <Twitter size={18} className="text-blue-400" />;
      case 'instagram':
        return <Instagram size={18} className="text-pink-500" />;
      case 'youtube':
        return <Youtube size={18} className="text-red-600" />;
      default:
        return <Globe size={18} className="text-gray-400" />;
    }
  };

  const submitLabel = downloadMode
    ? buttonBusy
      ? t('mediaDownloader.downloading')
      : t('mediaDownloader.download')
    : buttonBusy
      ? t('scrapper.capturing')
      : t('scrapper.capture');

  return (
    <div className="bg-surface border-b border-border p-4 space-y-3">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
            {getSourceIcon()}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('scrapper.urlPlaceholder')}
            className="w-full pl-10 pr-4 py-2 bg-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-gold"
          />
        </div>
        {downloadMode && (
          <div className="flex items-center gap-1 bg-elevated border border-border rounded-lg p-1">
            <button
              type="button"
              onClick={() => setFormat('video')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${
                format === 'video'
                  ? 'bg-accent-gold text-black'
                  : 'text-muted hover:text-foreground'
              }`}
              title={t('mediaDownloader.format.video')}
            >
              <Youtube size={14} />
              {t('mediaDownloader.format.video')}
            </button>
            <button
              type="button"
              onClick={() => setFormat('audio')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${
                format === 'audio'
                  ? 'bg-accent-gold text-black'
                  : 'text-muted hover:text-foreground'
              }`}
              title={t('mediaDownloader.format.audio')}
            >
              <Music size={14} />
              {t('mediaDownloader.format.audio')}
            </button>
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={!url.trim() || buttonBusy || externalDisabled}
          className="px-4 py-2 bg-accent-gold hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-medium rounded-lg transition-colors"
        >
          {submitLabel}
        </button>
      </div>

      <div className="flex justify-between items-center">
        <p className="text-xs text-muted">
          {url && source && (
            <span className="capitalize">
              {t('scrapper.detected')}: <span className="font-medium text-foreground">{source}</span>
            </span>
          )}
        </p>
        {!downloadMode && (
          <button
            onClick={props.onManualEntry}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-elevated hover:bg-surface border border-border rounded-lg text-foreground transition-colors"
          >
            <Plus size={14} />
            {t('scrapper.manualEntry')}
          </button>
        )}
      </div>
    </div>
  );
}
