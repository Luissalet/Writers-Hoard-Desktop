// ============================================
// Scrapper Engine — Snapshot Detail Modal
// ============================================

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  X,
  ExternalLink,
  Trash2,
  Twitter,
  Instagram,
  Youtube,
  Globe,
  Loader2,
  AlertCircle,
  RefreshCw,
  FileText,
  ImageIcon,
  Code2,
} from 'lucide-react';
import type { Snapshot } from '../types';
import TagInput from '@/components/common/TagInput';
import { extractYouTubeId } from '../services/urlDetector';
import { snapshotMediaUrl, runSnapshotDownload, cancelSnapshotDownload } from '@/services/scrapperMedia';
import { runSnapshotCapture, cancelSnapshotCapture } from '@/services/pageCapture';
import MediaGallery from './MediaGallery';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog, useDebouncedField } from '@/engines/_shared';

interface SnapshotDetailProps {
  snapshot: Snapshot;
  onUpdate: (id: string, changes: Partial<Snapshot>) => void | Promise<void>;
  onDelete: (id: string) => void;
  onClose: () => void;
  tagSuggestions?: string[];
}

export default function SnapshotDetail({
  snapshot,
  onUpdate,
  onDelete,
  onClose,
  tagSuggestions,
}: SnapshotDetailProps) {
  const { t } = useTranslation();
  // Buffered fields, not a copy frozen at mount. The background download fills
  // in the reel's caption while this modal is open; a plain `useState` copy
  // kept the empty string, so merely focusing and leaving the box wrote ''
  // over the caption that had just arrived. These adopt the stored value while
  // untouched, keep the author's typing while dirty, and flush on unmount.
  const description = useDebouncedField(snapshot.description ?? '', (next) =>
    onUpdate(snapshot.id, { description: next }),
  );
  const notes = useDebouncedField(snapshot.notes, (next) => onUpdate(snapshot.id, { notes: next }));
  const [tags, setTags] = useState(snapshot.tags);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [archiveTab, setArchiveTab] = useState<'screenshot' | 'pdf' | 'html'>('screenshot');

  // Auto-grow the description box to fit its content (capped, then it scrolls).
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
  }, [description.value]);

  const handleTagsChange = useCallback((newTags: string[]) => {
    setTags(newTags);
    onUpdate(snapshot.id, { tags: newTags });
  }, [snapshot.id, onUpdate]);

  const handleRetryDownload = useCallback(() => {
    void runSnapshotDownload(snapshot, onUpdate, snapshot.mediaKind === 'audio' ? 'audio' : 'video');
  }, [snapshot, onUpdate]);

  const handleRetryCapture = useCallback(() => {
    void runSnapshotCapture(snapshot, onUpdate);
  }, [snapshot, onUpdate]);

  const handleDelete = useCallback(() => {
    setPendingDelete(true);
  }, []);

  const confirmDelete = useCallback(() => {
    setPendingDelete(false);
    onDelete(snapshot.id);
    onClose();
  }, [snapshot.id, onDelete, onClose]);

  const youtubeId = snapshot.source === 'youtube' ? extractYouTubeId(snapshot.url) : null;

  const getSourceIcon = () => {
    switch (snapshot.source) {
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
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-elevated rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getSourceIcon()}
            <span className="text-xs font-medium text-muted uppercase tracking-wide">
              {snapshot.source}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-elevated rounded-lg transition-colors"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X size={20} className="text-muted" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Title and URL */}
          <div className="space-y-2">
            <h2 className="text-2xl font-serif font-bold text-foreground">
              {snapshot.title}
            </h2>
            <a
              href={snapshot.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-accent-gold hover:underline text-sm break-all"
            >
              {snapshot.url}
              <ExternalLink size={14} />
            </a>
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            {snapshot.author && (
              <div>
                <p className="text-muted font-medium">{t('scrapper.author')}</p>
                <p className="text-foreground">{snapshot.author}</p>
              </div>
            )}
            {snapshot.publishDate && (
              <div>
                <p className="text-muted font-medium">{t('scrapper.date')}</p>
                <p className="text-foreground">
                  {new Date(snapshot.publishDate).toLocaleDateString()}
                </p>
              </div>
            )}
            <div>
              <p className="text-muted font-medium">{t('scrapper.captured')}</p>
              <p className="text-foreground">
                {new Date(snapshot.createdAt).toLocaleDateString()}
              </p>
            </div>
            {snapshot.status && (
              <div>
                <p className="text-muted font-medium">{t('scrapper.status')}</p>
                <p className="text-foreground capitalize">{snapshot.status}</p>
              </div>
            )}
          </div>

          {/* Thumbnail */}
          {snapshot.thumbnail && (
            <div className="rounded-lg overflow-hidden bg-surface">
              <img
                src={snapshot.thumbnail}
                alt={snapshot.title}
                className="w-full max-h-64 object-cover"
              />
            </div>
          )}

          {/* Local media player → download state → YouTube embed fallback */}
          {snapshot.downloadState === 'downloading' ? (
            <div className="flex flex-col items-center justify-center gap-3 aspect-video rounded-lg bg-surface text-muted">
              <div className="flex items-center gap-3">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-sm">{t('scrapper.downloadingVideo')}</span>
              </div>
              <button
                onClick={() => cancelSnapshotDownload(snapshot.id)}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs bg-elevated hover:bg-surface border border-border rounded-lg text-foreground transition-colors"
              >
                <X size={14} />
                {t('scrapper.cancelDownload')}
              </button>
            </div>
          ) : snapshot.mediaItems && snapshot.mediaItems.length > 0 ? (
            <MediaGallery items={snapshot.mediaItems} />
          ) : snapshot.localMediaPath ? (
            snapshot.mediaKind === 'audio' ? (
              <audio
                controls
                src={snapshotMediaUrl(snapshot.localMediaPath)}
                className="w-full"
              />
            ) : (
              <video
                controls
                src={snapshotMediaUrl(snapshot.localMediaPath)}
                className="w-full max-h-[60vh] rounded-lg bg-black"
              />
            )
          ) : snapshot.downloadState === 'error' ? (
            <div className="rounded-lg bg-surface border border-border p-4 space-y-3">
              <div className="flex items-start gap-2 text-sm">
                <AlertCircle size={18} className="flex-shrink-0 mt-0.5 text-red-400" />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{t('scrapper.downloadFailed')}</p>
                  {snapshot.downloadError && (
                    <p className="text-xs text-muted mt-1 break-words">{snapshot.downloadError}</p>
                  )}
                </div>
              </div>
              <button
                onClick={handleRetryDownload}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs bg-elevated hover:bg-surface border border-border rounded-lg text-foreground transition-colors"
              >
                <RefreshCw size={14} />
                {t('scrapper.retryDownload')}
              </button>
            </div>
          ) : youtubeId ? (
            <div className="aspect-video rounded-lg overflow-hidden bg-surface">
              <iframe
                width="100%"
                height="100%"
                src={`https://www.youtube.com/embed/${youtubeId}`}
                title={snapshot.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : null}

          {/* Archived page — screenshot / PDF print / rendered HTML */}
          {snapshot.captureState === 'capturing' ? (
            <div className="flex flex-col items-center justify-center gap-3 aspect-video rounded-lg bg-surface text-muted">
              <div className="flex items-center gap-3">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-sm">{t('scrapper.capturingPage')}</span>
              </div>
              <button
                onClick={() => cancelSnapshotCapture(snapshot.id)}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs bg-elevated hover:bg-surface border border-border rounded-lg text-foreground transition-colors"
              >
                <X size={14} />
                {t('scrapper.cancelDownload')}
              </button>
            </div>
          ) : snapshot.captureState === 'error' ? (
            <div className="rounded-lg bg-surface border border-border p-4 space-y-3">
              <div className="flex items-start gap-2 text-sm">
                <AlertCircle size={18} className="flex-shrink-0 mt-0.5 text-red-400" />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{t('scrapper.captureFailed')}</p>
                  {snapshot.captureError && (
                    <p className="text-xs text-muted mt-1 break-words">{snapshot.captureError}</p>
                  )}
                </div>
              </div>
              <button
                onClick={handleRetryCapture}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs bg-elevated hover:bg-surface border border-border rounded-lg text-foreground transition-colors"
              >
                <RefreshCw size={14} />
                {t('scrapper.retryCapture')}
              </button>
            </div>
          ) : snapshot.capturePdfPath || snapshot.captureImagePath ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1 bg-elevated border border-border rounded-lg p-1 w-fit">
                {([
                  ['screenshot', ImageIcon, t('scrapper.tabScreenshot'), !!snapshot.captureImagePath],
                  ['pdf', FileText, t('scrapper.tabPdf'), !!snapshot.capturePdfPath],
                  ['html', Code2, t('scrapper.tabPage'), !!snapshot.captureHtmlPath],
                ] as const).map(([id, Icon, label, available]) =>
                  available ? (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setArchiveTab(id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
                        archiveTab === id
                          ? 'bg-accent-gold text-black'
                          : 'text-muted hover:text-foreground'
                      }`}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ) : null,
                )}
                <button
                  type="button"
                  onClick={handleRetryCapture}
                  title={t('scrapper.retryCapture')}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-muted hover:text-foreground transition-colors"
                >
                  <RefreshCw size={14} />
                </button>
              </div>

              {archiveTab === 'screenshot' && snapshot.captureImagePath && (
                <div className="rounded-lg overflow-y-auto max-h-[60vh] bg-white border border-border">
                  <img
                    src={snapshotMediaUrl(snapshot.captureImagePath)}
                    alt={snapshot.title}
                    className="w-full"
                  />
                </div>
              )}
              {archiveTab === 'pdf' && snapshot.capturePdfPath && (
                <iframe
                  src={snapshotMediaUrl(snapshot.capturePdfPath)}
                  title={`${snapshot.title} (PDF)`}
                  className="w-full h-[60vh] rounded-lg border border-border bg-white"
                />
              )}
              {archiveTab === 'html' && snapshot.captureHtmlPath && (
                <iframe
                  src={snapshotMediaUrl(snapshot.captureHtmlPath)}
                  title={snapshot.title}
                  sandbox=""
                  className="w-full h-[60vh] rounded-lg border border-border bg-white"
                />
              )}
            </div>
          ) : null}

          {/* Extracted Text */}
          {snapshot.extractedText && (
            <div className="space-y-2">
              <h3 className="font-serif font-semibold text-foreground">{t('scrapper.extractedText')}</h3>
              <div className="bg-surface rounded-lg p-4 max-h-40 overflow-y-auto text-xs text-muted leading-relaxed whitespace-pre-wrap break-words">
                {snapshot.extractedText}
              </div>
            </div>
          )}

          {/* Description */}
          <div className="space-y-2">
            <label className="font-serif font-semibold text-foreground block">{t('scrapper.description')}</label>
            <textarea
              ref={descriptionRef}
              value={description.value}
              onChange={(e) => description.onChange(e.target.value)}
              onBlur={description.onBlur}
              placeholder={t('scrapper.descriptionPlaceholder')}
              className="w-full px-4 py-2 bg-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-gold resize-none overflow-y-auto min-h-[5rem] max-h-[360px] leading-relaxed"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="font-serif font-semibold text-foreground block">{t('common.notes')}</label>
            <textarea
              value={notes.value}
              onChange={(e) => notes.onChange(e.target.value)}
              onBlur={notes.onBlur}
              placeholder={t('scrapper.notesPlaceholderDetail')}
              className="w-full px-4 py-2 bg-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-gold resize-none h-32"
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label className="font-serif font-semibold text-foreground block">{t('common.tags')}</label>
            <TagInput tags={tags} onChange={handleTagsChange} suggestions={tagSuggestions} />
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-surface border-t border-border px-6 py-4 flex justify-between">
          <button
            onClick={handleDelete}
            className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-600/10 rounded-lg transition-colors font-medium"
          >
            <Trash2 size={16} />
            {t('common.delete')}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-accent-gold hover:bg-yellow-600 text-black rounded-lg transition-colors font-medium"
          >
            {t('common.done')}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete}
        destructive
        message={t('scrapper.deleteConfirm')}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  );
}
