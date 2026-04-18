// ============================================
// Scrapper Engine — Capture Bar Component
// ============================================

import { useState, useCallback, useRef, useEffect } from 'react';
import { Globe, Twitter, Instagram, Youtube, Plus } from 'lucide-react';
import type { Snapshot } from '../types';
import { detectUrlSource, extractDomainFromUrl } from '../services/urlDetector';
import { useTranslation } from '@/i18n/useTranslation';

interface CaptureBarProps {
  projectId: string;
  onCapture: (snapshot: Snapshot) => void;
  onManualEntry: () => void;
}

export default function CaptureBar({ projectId, onCapture, onManualEntry }: CaptureBarProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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

  const handleCapture = useCallback(async () => {
    if (!url.trim()) return;

    setIsLoading(true);
    try {
      const source = detectUrlSource(url);
      const domain = extractDomainFromUrl(url);
      const snapshot: Snapshot = {
        id: crypto.randomUUID(),
        projectId,
        url,
        title: domain,
        source,
        status: 'success',
        notes: '',
        tags: [],
        preservedAt: Date.now(),
        createdAt: Date.now(),
      };

      onCapture(snapshot);
      setUrl('');
    } finally {
      setIsLoading(false);
    }
  }, [url, projectId, onCapture]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLoading) {
      handleCapture();
    }
  };

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
        <button
          onClick={handleCapture}
          disabled={!url.trim() || isLoading}
          className="px-4 py-2 bg-accent-gold hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-medium rounded-lg transition-colors"
        >
          {isLoading ? t('scrapper.capturing') : t('scrapper.capture')}
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
        <button
          onClick={onManualEntry}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-elevated hover:bg-surface border border-border rounded-lg text-foreground transition-colors"
        >
          <Plus size={14} />
          {t('scrapper.manualEntry')}
        </button>
      </div>
    </div>
  );
}
