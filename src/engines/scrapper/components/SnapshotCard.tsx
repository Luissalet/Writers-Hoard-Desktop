// ============================================
// Scrapper Engine — Snapshot Card Component
// ============================================

import { useState } from 'react';
import { Globe, Twitter, Instagram, Youtube, Loader2, AlertCircle, PlayCircle, Layers } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Snapshot } from '../types';
import SnapshotDetail from './SnapshotDetail';
import { useTranslation } from '@/i18n/useTranslation';
import { snapshotMediaUrl } from '@/services/scrapperMedia';

interface SnapshotCardProps {
  snapshot: Snapshot;
  onUpdate: (id: string, changes: Partial<Snapshot>) => void;
  onDelete: (id: string) => void;
  tagSuggestions?: string[];
}

export default function SnapshotCard({ snapshot, onUpdate, onDelete, tagSuggestions }: SnapshotCardProps) {
  const { t } = useTranslation();
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const getSourceColor = () => {
    switch (snapshot.source) {
      case 'tweet':
        return '#1DA1F2';
      case 'instagram':
        return '#E1306C';
      case 'youtube':
        return '#FF0000';
      default:
        return '#6B7280';
    }
  };

  const getSourceIcon = () => {
    switch (snapshot.source) {
      case 'tweet':
        return <Twitter size={16} className="text-blue-400" />;
      case 'instagram':
        return <Instagram size={16} className="text-pink-500" />;
      case 'youtube':
        return <Youtube size={16} className="text-red-600" />;
      default:
        return <Globe size={16} className="text-gray-400" />;
    }
  };

  const truncateUrl = (url: string, maxLength: number = 50) => {
    return url.length > maxLength ? url.substring(0, maxLength) + '...' : url;
  };

  const notesPreview = snapshot.notes.substring(0, 80).trim();
  const firstItem = snapshot.mediaItems?.[0];
  const itemCount = snapshot.mediaItems?.length ?? 0;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        whileHover={{ y: -2 }}
        onClick={() => setIsDetailOpen(true)}
        className="bg-elevated border border-border rounded-lg overflow-hidden hover:border-accent-gold cursor-pointer transition-all hover:shadow-lg"
      >
        {firstItem ? (
          <div className="relative w-full h-56 overflow-hidden bg-black/60 flex items-center justify-center">
            {firstItem.kind === 'image' ? (
              <img
                src={snapshotMediaUrl(firstItem.relPath)}
                alt={snapshot.title}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <>
                <video
                  src={`${snapshotMediaUrl(firstItem.relPath)}#t=0.5`}
                  className="max-h-full max-w-full object-contain"
                  muted
                  preload="metadata"
                  playsInline
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <PlayCircle size={40} className="text-white/95 drop-shadow-lg" />
                </div>
              </>
            )}
            {itemCount > 1 && (
              <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-xs">
                <Layers size={12} />
                {itemCount}
              </div>
            )}
          </div>
        ) : snapshot.localMediaPath && snapshot.mediaKind !== 'audio' ? (
          <div className="relative w-full h-56 overflow-hidden bg-black/60 flex items-center justify-center">
            <video
              src={`${snapshotMediaUrl(snapshot.localMediaPath)}#t=0.5`}
              className="max-h-full max-w-full object-contain"
              muted
              preload="metadata"
              playsInline
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <PlayCircle size={40} className="text-white/95 drop-shadow-lg" />
            </div>
          </div>
        ) : snapshot.thumbnail ? (
          <div className="relative w-full h-56 overflow-hidden bg-black/60 flex items-center justify-center">
            <img
              src={snapshot.thumbnail}
              alt={snapshot.title}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : null}

        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div
                className="rounded-full p-1 flex-shrink-0"
                style={{ backgroundColor: getSourceColor() + '20' }}
              >
                {getSourceIcon()}
              </div>
              <h3 className="font-serif font-semibold text-foreground truncate text-sm">
                {snapshot.title}
              </h3>
            </div>
          </div>

          <a
            href={snapshot.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-accent-gold hover:underline block truncate"
          >
            {truncateUrl(snapshot.url)}
          </a>

          {snapshot.downloadState === 'downloading' && (
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" />
              {t('scrapper.downloadingVideo')}
            </div>
          )}
          {snapshot.downloadState === 'done' && snapshot.localMediaPath && (
            <div className="flex items-center gap-1.5 text-xs text-green-500">
              <PlayCircle size={12} />
              {t('scrapper.playableLocally')}
            </div>
          )}
          {snapshot.downloadState === 'error' && (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle size={12} />
              {t('scrapper.downloadFailed')}
            </div>
          )}

          {(snapshot.author || snapshot.publishDate) && (
            <div className="flex items-center gap-2 text-xs text-muted">
              {snapshot.author && <span>{snapshot.author}</span>}
              {snapshot.publishDate && <span>•</span>}
              {snapshot.publishDate && (
                <span>{new Date(snapshot.publishDate).toLocaleDateString()}</span>
              )}
            </div>
          )}

          {notesPreview && (
            <p className="text-xs text-muted line-clamp-2">{notesPreview}</p>
          )}

          {snapshot.tags.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {snapshot.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-surface border border-border text-foreground"
                >
                  #{tag}
                </span>
              ))}
              {snapshot.tags.length > 3 && (
                <span className="text-xs text-muted">
                  +{snapshot.tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </motion.div>

      {isDetailOpen && (
        <SnapshotDetail
          snapshot={snapshot}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onClose={() => setIsDetailOpen(false)}
          tagSuggestions={tagSuggestions}
        />
      )}
    </>
  );
}
