import { useState, useMemo, useRef } from 'react';
import { Plus, MonitorPlay, Pencil, Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import type { VideoPlan, VideoSegment } from '../types';
import { generateId } from '@/utils/idGenerator';
import SegmentCard from './SegmentCard';
import SegmentEditor from './SegmentEditor';
import TeleprompterView from './TeleprompterView';
import PlanExportMenu from './PlanExportMenu';

interface VideoPlanViewProps {
  plan: VideoPlan;
  segments: VideoSegment[];
  onAddSegment: (segment: VideoSegment) => void | Promise<void>;
  onUpdateSegment: (id: string, changes: Partial<VideoSegment>) => void | Promise<void>;
  onDeleteSegment: (id: string) => void | Promise<void>;
  onReorderSegments: (segmentIds: string[]) => void;
  onRenamePlan?: (title: string) => void | Promise<void>;
}

export default function VideoPlanView({
  plan,
  segments,
  onAddSegment,
  onUpdateSegment,
  onDeleteSegment,
  onReorderSegments,
  onRenamePlan,
}: VideoPlanViewProps) {
  const { t } = useTranslation();
  const [isTeleprompter, setIsTeleprompter] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(plan.title);
  const [createdSegment, setCreatedSegment] = useState<VideoSegment | null>(null);
  const [addingSegment, setAddingSegment] = useState(false);
  const [addFailed, setAddFailed] = useState(false);
  const addingSegmentRef = useRef(false);

  // Render-adjust: sync the editable title when the plan (or its title)
  // changes externally.
  const [prevPlanKey, setPrevPlanKey] = useState(`${plan.id}:${plan.title}`);
  if (prevPlanKey !== `${plan.id}:${plan.title}`) {
    setPrevPlanKey(`${plan.id}:${plan.title}`);
    setTitleValue(plan.title);
    setIsEditingTitle(false);
  }

  const commitTitle = async () => {
    const next = titleValue.trim();
    setIsEditingTitle(false);
    if (next && next !== plan.title) {
      await onRenamePlan?.(next);
    } else {
      setTitleValue(plan.title);
    }
  };

  const sortedSegments = useMemo(() => {
    return [...segments].sort((a, b) => a.order - b.order);
  }, [segments]);

  const handleAddSegment = async () => {
    if (addingSegmentRef.current) return;
    addingSegmentRef.current = true;
    setAddingSegment(true);
    setAddFailed(false);
    const newSegment: VideoSegment = {
      id: generateId('vsg'),
      videoPlanId: plan.id,
      projectId: plan.projectId,
      order: sortedSegments.length,
      title: t('videoPlanner.defaultSegmentTitle').replace('{number}', String(sortedSegments.length + 1)),
      script: '',
      visualType: 'camera',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    try {
      await onAddSegment(newSegment);
      setCreatedSegment(newSegment);
    } catch {
      setAddFailed(true);
    } finally {
      addingSegmentRef.current = false;
      setAddingSegment(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (id: string) => {
    setDragOverId(id);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);

    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      return;
    }

    const draggedIndex = sortedSegments.findIndex(s => s.id === draggedId);
    const targetIndex = sortedSegments.findIndex(s => s.id === targetId);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      // Move, don't swap. Swapping meant dragging segment 1 onto segment 5
      // produced 5,2,3,4,1 instead of the 2,3,4,5,1 the gesture promises —
      // every long drag scrambled two segments at once.
      const newOrder = [...sortedSegments];
      const [moved] = newOrder.splice(draggedIndex, 1);
      newOrder.splice(targetIndex, 0, moved);
      onReorderSegments(newOrder.map(s => s.id));
    }

    setDraggedId(null);
  };

  if (isTeleprompter) {
    return (
      <TeleprompterView
        segments={sortedSegments}
        onExit={() => setIsTeleprompter(false)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {createdSegment && (
        <SegmentEditor
          key={createdSegment.id}
          segment={createdSegment}
          onSave={async changes => {
            await onUpdateSegment(createdSegment.id, changes);
            setCreatedSegment(null);
          }}
          onCancel={() => setCreatedSegment(null)}
        />
      )}
      {addFailed && <p role="alert" className="text-sm text-danger">{t('common.saveFailed')}</p>}
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTitle();
                    if (e.key === 'Escape') {
                      setTitleValue(plan.title);
                      setIsEditingTitle(false);
                    }
                  }}
                  onBlur={commitTitle}
                  autoFocus
                  placeholder={t('videoPlanner.renamePlaceholder')}
                  className="flex-1 min-w-0 font-serif text-2xl bg-deep border border-border rounded px-2 py-1 text-neutral-50 focus:border-accent-gold focus:outline-none"
                />
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={commitTitle}
                  title={t('common.save')}
                  aria-label={t('common.save')}
                  className="p-1.5 rounded text-accent-gold hover:bg-accent-gold/10 transition-colors"
                >
                  <Check className="w-5 h-5" />
                </button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setTitleValue(plan.title);
                    setIsEditingTitle(false);
                  }}
                  title={t('common.cancel')}
                  aria-label={t('common.cancel')}
                  className="p-1.5 rounded text-neutral-400 hover:bg-surface transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="group flex items-center gap-2">
                <h2 className="font-serif text-2xl text-neutral-50 truncate">{plan.title}</h2>
                {onRenamePlan && (
                  <button
                    onClick={() => {
                      setTitleValue(plan.title);
                      setIsEditingTitle(true);
                    }}
                    title={t('videoPlanner.renamePlan')}
                    aria-label={t('videoPlanner.renamePlan')}
                    className="p-1.5 rounded text-neutral-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-accent-gold hover:bg-accent-gold/10 transition-[opacity,color,background-color]"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
            {plan.totalDuration && (
              <p className="text-sm text-accent-gold mt-1">
                {t('videoPlanner.totalDurationLabel').replace('{duration}', plan.totalDuration)}
              </p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <PlanExportMenu plan={plan} segments={sortedSegments} />
            <button
              onClick={() => setIsTeleprompter(true)}
              className="flex items-center gap-2 px-4 py-2 rounded bg-accent-gold text-deep font-medium hover:bg-accent-gold/90 transition-colors text-sm"
            >
              <MonitorPlay className="w-4 h-4" />
              {t('videoPlanner.teleprompter')}
            </button>
          </div>
        </div>
        {sortedSegments.length > 0 && (
          <p className="text-xs text-neutral-400">
            {sortedSegments.length === 1
              ? t('videoPlanner.segmentCountOne')
              : t('videoPlanner.segmentCountOther').replace('{count}', String(sortedSegments.length))}
          </p>
        )}
      </div>

      {/* Segments list */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {sortedSegments.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-neutral-400 mb-4">{t('videoPlanner.noSegments')}</p>
              <button
                onClick={handleAddSegment}
                disabled={addingSegment}
                aria-busy={addingSegment}
                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-accent-gold text-deep font-medium hover:bg-accent-gold/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('videoPlanner.addSegment')}
              </button>
            </div>
          ) : (
              sortedSegments.map((segment) => (
                <motion.div
                  key={segment.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  onDragOver={handleDragOver}
                  onDragEnter={() => handleDragEnter(segment.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, segment.id)}
                  className={`transition-colors ${
                    dragOverId === segment.id ? 'bg-deep/50' : ''
                  }`}
                >
                  <SegmentCard
                    segment={segment}
                    index={sortedSegments.indexOf(segment)}
                    onUpdate={onUpdateSegment}
                    onDelete={onDeleteSegment}
                    isDragging={draggedId === segment.id}
                    onDragStart={handleDragStart}
                  />
                </motion.div>
              ))
          )}
        </AnimatePresence>

        {/* Add segment button */}
        {sortedSegments.length > 0 && (
          <button
            onClick={handleAddSegment}
            disabled={addingSegment}
            aria-busy={addingSegment}
            className="w-full py-3 rounded border border-dashed border-border hover:border-accent-gold/50 text-neutral-400 hover:text-accent-gold transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" />
            {t('videoPlanner.addSegment')}
          </button>
        )}
      </div>
    </div>
  );
}
