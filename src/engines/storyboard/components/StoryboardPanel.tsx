// ============================================
// Storyboard Engine — Panel Component
// ============================================

import { useState, useRef } from 'react';
import { Camera, Edit2, Trash2 } from 'lucide-react';
import type { StoryboardPanel as StoryboardPanelType } from '../types';
import { useTranslation } from '@/i18n/useTranslation';

interface StoryboardPanelProps {
  panel: StoryboardPanelType;
  aspectRatio?: 'square' | '16:9' | '4:3';
  isReordering?: boolean;
  onEdit: (panel: StoryboardPanelType) => void;
  onDelete: (id: string) => void;
  onUpdateSubtitle: (id: string, subtitle: string) => void;
}

export default function StoryboardPanel({
  panel,
  aspectRatio = '16:9',
  isReordering = false,
  onEdit,
  onDelete,
  onUpdateSubtitle,
}: StoryboardPanelProps) {
  const { t } = useTranslation();
  const [isHovering, setIsHovering] = useState(false);
  const [isEditingSubtitle, setIsEditingSubtitle] = useState(false);
  const [subtitleText, setSubtitleText] = useState(panel.subtitle);
  const inputRef = useRef<HTMLInputElement>(null);

  const getAspectRatioClass = () => {
    switch (aspectRatio) {
      case 'square':
        return 'aspect-square';
      case '4:3':
        return 'aspect-video';
      case '16:9':
      default:
        return 'aspect-video';
    }
  };

  const handleSubtitleSave = () => {
    if (subtitleText.trim() !== panel.subtitle) {
      onUpdateSubtitle(panel.id, subtitleText.trim());
    }
    setIsEditingSubtitle(false);
  };

  const handleSubtitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubtitleSave();
    } else if (e.key === 'Escape') {
      setSubtitleText(panel.subtitle);
      setIsEditingSubtitle(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-2"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Panel Box */}
      <div
        className={`relative overflow-hidden rounded-lg border-2 transition ${
          isReordering
            ? 'border-accent-gold bg-elevated/50 cursor-grab'
            : 'border-border bg-surface hover:border-accent-gold cursor-pointer'
        } ${getAspectRatioClass()}`}
        onClick={() => !isReordering && onEdit(panel)}
      >
        {panel.imageData ? (
          <img
            src={panel.imageData}
            alt={panel.subtitle}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-deep/50 text-text-dim">
            <Camera size={32} className="mb-2 opacity-50" />
            <span className="text-xs text-center px-2">Drop image here</span>
          </div>
        )}

        {/* Hover Controls */}
        {isHovering && !isReordering && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(panel);
              }}
              className="p-2 bg-accent-gold text-deep rounded-lg hover:bg-accent-amber transition"
              title={t('storyboard.editPanelTooltip')}
            >
              <Edit2 size={18} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(t('storyboard.deletePanelConfirm'))) {
                  onDelete(panel.id);
                }
              }}
              className="p-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
              title={t('storyboard.deletePanelTooltip')}
            >
              <Trash2 size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Subtitle */}
      <div className="min-h-10">
        {isEditingSubtitle ? (
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={subtitleText}
            onChange={(e) => setSubtitleText(e.target.value)}
            onBlur={handleSubtitleSave}
            onKeyDown={handleSubtitleKeyDown}
            className="w-full px-2 py-1 bg-surface border border-accent-gold rounded text-sm text-text-primary font-semibold placeholder-text-muted focus:outline-none"
            placeholder={t('storyboard.panelSubtitle')}
          />
        ) : (
          <p
            onClick={(e) => {
              e.stopPropagation();
              setIsEditingSubtitle(true);
            }}
            className="px-2 py-1 text-sm font-semibold text-text-primary cursor-text hover:text-accent-gold transition min-h-6 flex items-center"
          >
            {panel.subtitle || <span className="text-text-muted italic">Add subtitle</span>}
          </p>
        )}
      </div>
    </div>
  );
}
