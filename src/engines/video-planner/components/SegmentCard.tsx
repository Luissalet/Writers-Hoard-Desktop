import { useState } from 'react';
import { GripVertical, Trash2 } from 'lucide-react';
import type { VideoSegment, VisualType } from '../types';
import SegmentEditor from './SegmentEditor';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';

interface SegmentCardProps {
  segment: VideoSegment;
  index: number;
  onUpdate: (id: string, changes: Partial<VideoSegment>) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent, id: string) => void;
}

const VISUAL_ICONS: Record<VisualType, string> = {
  camera: '📷',
  broll: '🎬',
  'screen-capture': '🖥️',
  graphic: '✨',
  'text-overlay': '📝',
  custom: '🎨',
};

export default function SegmentCard({
  segment,
  index,
  onUpdate,
  onDelete,
  isDragging,
  onDragStart,
}: SegmentCardProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);

  const formatTimecodeRange = (start?: string, end?: string): string => {
    if (!start && !end) return '';
    if (start && end) return `${start} → ${end}`;
    if (start) return t('videoPlanner.segment.fromTime').replace('{time}', start);
    return t('videoPlanner.segment.toTime').replace('{time}', end ?? '');
  };

  return (
    <>
      <div
        draggable
        onDragStart={(e) => onDragStart?.(e, segment.id)}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onClick={() => setIsEditing(true)}
        className={`bg-surface border border-border rounded-lg p-4 cursor-pointer transition-[border-color,box-shadow,transform] hover:border-accent-gold hover:shadow-md ${
          isDragging ? 'opacity-50 bg-elevated' : ''
        }`}
      >
        {/* Header with segment number and title */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-3 flex-1">
            {isHovering && (
              <GripVertical className="w-5 h-5 text-border mt-0.5 flex-shrink-0" />
            )}
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-serif text-accent-gold">#{index + 1}</span>
                <h3 className="font-serif text-lg text-neutral-50">{segment.title}</h3>
              </div>
              {segment.speakerName && (
                <p className="text-xs text-accent-gold mt-1">{t('videoPlanner.segment.speaker').replace('{name}', segment.speakerName)}</p>
              )}
            </div>
          </div>
          {isHovering && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPendingDelete(true);
              }}
              className="p-1.5 hover:bg-elevated rounded text-red-400 hover:text-red-300 transition-colors"
              title={t('common.delete')}
              aria-label={t('common.delete')}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Two-column layout: Script (left) and Visual (right) */}
        <div className="grid grid-cols-2 gap-4 mb-3">
          {/* Left: Script */}
          <div className="bg-deep rounded border border-border/50 p-3">
            <p className="text-xs text-accent-gold/70 uppercase tracking-wide mb-2">{t('videoPlanner.segment.script')}</p>
            <p className="text-sm text-neutral-100 line-clamp-3 font-serif">
              {segment.script || t('videoPlanner.segment.noScript')}
            </p>
          </div>

          {/* Right: Visual */}
          <div className="bg-deep rounded border border-border/50 p-3">
            <p className="text-xs text-accent-gold/70 uppercase tracking-wide mb-2">{t('videoPlanner.segment.visualHeading')}</p>
            <div className="flex items-start gap-2">
              <span className="text-xl">{VISUAL_ICONS[segment.visualType]}</span>
              <div className="flex-1">
                <p className="text-xs text-accent-gold">{t(`videoPlanner.segment.visual.${segment.visualType}`)}</p>
                {segment.visualImageData ? (
                  <img
                    src={segment.visualImageData}
                    alt="Visual"
                    className="w-full h-16 object-cover rounded mt-1 border border-border/50"
                  />
                ) : segment.visualDescription ? (
                  <p className="text-xs text-neutral-300 mt-1 line-clamp-2">{segment.visualDescription}</p>
                ) : (
                  <p className="text-xs text-neutral-400 italic mt-1">{t('videoPlanner.segment.noVisual')}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: Timing and audio notes */}
        <div className="border-t border-border/50 pt-3 space-y-2">
          {formatTimecodeRange(segment.startTime, segment.endTime) && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 bg-deep rounded-full overflow-hidden border border-border/50">
                <div className="h-full bg-gradient-to-r from-accent-gold/50 to-accent-gold w-1/3"></div>
              </div>
              <p className="text-xs text-neutral-400">{formatTimecodeRange(segment.startTime, segment.endTime)}</p>
            </div>
          )}
          {segment.audioNotes && (
            <p className="text-xs text-neutral-400 italic">♪ {segment.audioNotes}</p>
          )}
        </div>
      </div>

      {isEditing && (
        <SegmentEditor
          segment={segment}
          onSave={async (updated) => {
            await onUpdate(segment.id, updated);
            setIsEditing(false);
          }}
          onCancel={() => setIsEditing(false)}
        />
      )}
      <ConfirmDialog
        open={pendingDelete}
        destructive
        message={t('videoPlanner.segment.deleteConfirm')}
        onConfirm={async () => { await onDelete(segment.id); setPendingDelete(false); }}
        onCancel={() => setPendingDelete(false)}
      />
    </>
  );
}
