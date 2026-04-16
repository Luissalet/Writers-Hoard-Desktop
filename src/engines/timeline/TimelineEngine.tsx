import { useState, useMemo } from 'react';
import { Clock, List, Layers } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { useAutoSelect, useEnsureDefault, EngineSpinner, CollectionDashboard } from '@/engines/_shared';
import { useTimelines, useTimelineEvents, useAllProjectEvents, useTimelineConnections } from './hooks';
import { generateId } from '@/utils/idGenerator';
import TimelineView from './components/TimelineView';
import SwimLaneView from './components/SwimLaneView';

type ViewMode = 'list' | 'swimlane';

export default function TimelineEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { timelines, loading: timelinesLoading, addTimeline, editTimeline, removeTimeline } = useTimelines(projectId);
  const [activeTimelineId, setActiveTimelineId] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('swimlane');

  // Single-timeline events (for list view)
  const { events: activeEvents, addEvent, editEvent, removeEvent, refresh: refreshActiveEvents } = useTimelineEvents(activeTimelineId);

  // All-project events + connections (for swim-lane view)
  const {
    events: allEvents,
    addEvent: addEventGlobal,
    editEvent: editEventGlobal,
    removeEvent: removeEventGlobal,
    refresh: refreshAllEvents,
  } = useAllProjectEvents(projectId);

  const {
    connections,
    addConnection,
    removeConnection,
    refresh: refreshConnections,
  } = useTimelineConnections(projectId);

  useAutoSelect(timelines, activeTimelineId, setActiveTimelineId);

  useEnsureDefault({
    items: timelines,
    loading: timelinesLoading,
    createDefault: () => ({
      id: generateId('tl'),
      projectId,
      title: t('timeline.defaultName'),
      color: '#c4973b',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    addItem: addTimeline,
    onCreated: setActiveTimelineId,
  });

  const loading = useMemo(() => timelinesLoading, [timelinesLoading]);

  if (loading && timelines.length === 0) return <EngineSpinner />;

  const handleCreateTimeline = async (name: string) => {
    // Assign a different color for each new timeline
    const palette = ['#c4973b', '#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];
    const color = palette[timelines.length % palette.length];
    const tl = {
      id: generateId('tl'),
      projectId,
      title: name,
      color,
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

  // Wrap global mutations to also refresh the active events hook
  const handleAddEventGlobal = async (event: Parameters<typeof addEventGlobal>[0]) => {
    await addEventGlobal(event);
    refreshActiveEvents();
  };

  const handleEditEventGlobal = async (id: string, changes: Parameters<typeof editEventGlobal>[1]) => {
    await editEventGlobal(id, changes);
    refreshActiveEvents();
  };

  const handleRemoveEventGlobal = async (id: string) => {
    await removeEventGlobal(id);
    refreshActiveEvents();
    refreshConnections();
  };

  // Wrap list-view mutations to also refresh all-events
  const handleAddEvent = async (event: Parameters<typeof addEvent>[0]) => {
    await addEvent(event);
    refreshAllEvents();
  };

  const handleEditEvent = async (id: string, changes: Parameters<typeof editEvent>[1]) => {
    await editEvent(id, changes);
    refreshAllEvents();
  };

  const handleRemoveEvent = async (id: string) => {
    await removeEvent(id);
    refreshAllEvents();
    refreshConnections();
  };

  return (
    <div className="space-y-4">
      {/* View Mode Toggle */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 p-0.5 bg-elevated rounded-lg border border-border">
          <button
            onClick={() => setViewMode('swimlane')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition ${
              viewMode === 'swimlane'
                ? 'bg-accent-gold/20 text-accent-gold font-semibold'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <Layers size={13} />
            {t('timeline.viewSwimLanes')}
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition ${
              viewMode === 'list'
                ? 'bg-accent-gold/20 text-accent-gold font-semibold'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <List size={13} />
            {t('timeline.viewList')}
          </button>
        </div>
        {viewMode === 'swimlane' && timelines.length > 1 && (
          <span className="text-[10px] text-text-dim">
            {t('timeline.statsTimelines').replace('{count}', String(timelines.length))} · {t('timeline.statsEvents').replace('{count}', String(allEvents.length))} · {t('timeline.statsConnections').replace('{count}', String(connections.length))}
          </span>
        )}
      </div>

      {/* Active view */}
      {viewMode === 'swimlane' ? (
        <SwimLaneView
          projectId={projectId}
          timelines={timelines}
          events={allEvents}
          connections={connections}
          onAddEvent={handleAddEventGlobal}
          onEditEvent={handleEditEventGlobal}
          onDeleteEvent={handleRemoveEventGlobal}
          onAddConnection={addConnection}
          onDeleteConnection={removeConnection}
          onEditTimeline={editTimeline}
        />
      ) : (
        activeTimelineId && (
          <TimelineView
            projectId={projectId}
            timelineId={activeTimelineId}
            events={activeEvents}
            onAddEvent={handleAddEvent}
            onEditEvent={handleEditEvent}
            onDeleteEvent={handleRemoveEvent}
          />
        )
      )}

      <CollectionDashboard
        icon={Clock}
        title={t('timeline.yourTimelines')}
        itemNoun={t('timeline.itemNoun')}
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
