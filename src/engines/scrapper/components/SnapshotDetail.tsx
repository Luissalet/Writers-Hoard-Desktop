// ============================================
// Scrapper Engine — Snapshot Detail Modal
// ============================================

import { useState, useCallback } from 'react';
import { X, ExternalLink, Trash2, Twitter, Instagram, Youtube, Globe } from 'lucide-react';
import type { Snapshot } from '../types';
import TagInput from '@/components/common/TagInput';
import { extractYouTubeId } from '../services/urlDetector';
import { useTranslation } from '@/i18n/useTranslation';

interface SnapshotDetailProps {
  snapshot: Snapshot;
  onUpdate: (id: string, changes: Partial<Snapshot>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function SnapshotDetail({
  snapshot,
  onUpdate,
  onDelete,
  onClose,
}: SnapshotDetailProps) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState(snapshot.notes);
  const [tags, setTags] = useState(snapshot.tags);

  const handleNotesBlur = useCallback(() => {
    if (notes !== snapshot.notes) {
      onUpdate(snapshot.id, { notes });
    }
  }, [notes, snapshot.id, snapshot.notes, onUpdate]);

  const handleTagsChange = useCallback((newTags: string[]) => {
    setTags(newTags);
    onUpdate(snapshot.id, { tags: newTags });
  }, [snapshot.id, onUpdate]);

  const handleDelete = useCallback(() => {
    if (confirm(t('scrapper.deleteConfirm'))) {
      onDelete(snapshot.id);
      onClose();
    }
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
          >
            <X size={20} className="text-muted" />
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

          {/* YouTube Embed */}
          {youtubeId && (
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
          )}

          {/* Extracted Text */}
          {snapshot.extractedText && (
            <div className="space-y-2">
              <h3 className="font-serif font-semibold text-foreground">{t('scrapper.extractedText')}</h3>
              <div className="bg-surface rounded-lg p-4 max-h-40 overflow-y-auto text-xs text-muted leading-relaxed whitespace-pre-wrap break-words">
                {snapshot.extractedText}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <label className="font-serif font-semibold text-foreground block">{t('common.notes')}</label>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              onBlur={handleNotesBlur}
              placeholder={t('scrapper.notesPlaceholderDetail')}
              className="w-full px-4 py-2 bg-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-gold resize-none h-32"
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label className="font-serif font-semibold text-foreground block">{t('common.tags')}</label>
            <TagInput tags={tags} onChange={handleTagsChange} />
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
    </div>
  );
}
