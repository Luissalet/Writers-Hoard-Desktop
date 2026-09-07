// ============================================
// Storyboard Engine — Panel Component
// ============================================

import { useState, useRef } from 'react';
import { Camera, Edit2, Trash2, Link2 } from 'lucide-react';
import type { StoryboardPanel as StoryboardPanelType } from '../types';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';

interface StoryboardPanelProps {
  panel: StoryboardPanelType;
  /** Title of the linked scene, when there is one. */
  linkedSceneTitle?: string;
  aspectRatio?: 'square' | '16:9' | '4:3';
  isReordering?: boolean;
  onEdit: (panel: StoryboardPanelType) => void;
  onDelete: (id: string) => void;
  onUpdateSubtitle: (id: string, subtitle: string) => void;
}

export default function StoryboardPanel({
  panel,
  linkedSceneTitle,
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
  const [pendingDelete, setPendingDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const getAspectRatioClass = () => {
    switch (aspectRatio) {
      case 'square':
        return 'aspect-square';
      case '4:3':
        return 'aspect-[4/3]';
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
            <span className="text-xs text-center px-2">{t('storyboard.dropImageHere')}</span>
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
                setPendingDelete(true);
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
            {panel.subtitle || <span className="text-text-muted italic">{t('storyboard.panelSubtitle')}</span>}
          </p>
        )}

        {/* Linked-scene chip — the panel↔script bridge, now that
            `linkedSceneId` finally has a way in and a way out. */}
        {linkedSceneTitle && (
          <div
            className="mx-2 mb-2 flex items-center gap-1 rounded bg-accent-gold/10 px-2 py-0.5 text-[10px] text-accent-gold/90"
            title={t('storyboard.panel.linkedTo').replace('{name}', linkedSceneTitle)}
          >
            <Link2 size={10} />
            <span className="truncate">{linkedSceneTitle}</span>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete}
        destructive
        message={t('storyboard.deletePanelConfirm')}
        onConfirm={() => {
          setPendingDelete(false);
          onDelete(panel.id);
        }}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  );
}
