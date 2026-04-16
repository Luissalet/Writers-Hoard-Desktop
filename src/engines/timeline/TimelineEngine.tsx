import { useState, useMemo } from 'react';
import { Clock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { useAutoSelect, useEnsureDefault, EngineSpinner, CollectionDashboard } from '@/engines/_shared';
import { useTimelines, useTimelineEvents } from './hooks';
import { generateId } from '@/utils/idGenerator';
import TimelineView from './components/TimelineView';

export default function TimelineEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { timelines, loading: timelinesLoading, addTimeline, removeTimeline } = useTimelines(projectId);
  const [activeTimelineId, setActiveTimelineId] = useState<string>('');
  const { events, addEvent, editEvent, removeEvent } = useTimelineEvents(activeTimelineId);

  useAutoSelect(timelines, activeTimelineId, setActiveTimelineId);

  useEnsureDefault({
    items: timelines,
    loading: timelinesLoading,
    createDefault: () => ({
      id: generateId('tl'),
      projectId,
      title: t('timeline.defaultName'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    addItem: addTimeline,
    onCreated: setActiveTimelineId,
  });

  const loading = useMemo(() => timelinesLoading, [timelinesLoading]);

  if (loading && timelines.length === 0) return <EngineSpinner />;

  const handleCreateTimeline = async (name: string) => {
    const tl = {
      id: generateId('tl'),
      projectId,
      title: name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await addTimeline(tl);
    setActiveTimelineId(tl.id);
  };

  const handleDeleteTimeline = async (id: string) => {
    await removeTimeline(id);
    if (activeTimelineId === id) {
      const remaining = timelines.filter((t) => t.id !== id);
      if (remaining.length > 0) {
        setActiveTimelineId(remaining[0].id);
      } else {
        setActiveTimelineId('');
      }
    }
  };

  return (
    <div className="space-y-4">
      {activeTimelineId && (
        <TimelineView
          projectId={projectId}
          timelineId={activeTimelineId}
          events={events}
          onAddEvent={addEvent}
          onEditEvent={editEvent}
          onDeleteEvent={removeEvent}
        />
      )}

      <CollectionDashboard
        icon={Clock}
        title={t('timeline.yourTimelines')}
        itemNoun="Timeline"
        items={timelines}
        activeId={activeTimelineId}
        onSelect={setActiveTimelineId}
        onCreate={handleCreateTimeline}
        onDelete={handleDeleteTimeline}
        placeholder={t('timeline.namePlaceholder')}
      />
    </div>
  );
}
