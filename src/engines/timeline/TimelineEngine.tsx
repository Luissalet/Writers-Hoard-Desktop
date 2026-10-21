import { useWorldEraScope, useEraRows } from '@/services/worldEras/hooks';
import type { Writing } from '@/types';
import { useEraNavigate } from '@/services/worldEras/navigation';
import { useState, useMemo, useEffect } from 'react';
import { Clock, List, Layers, Globe } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { useAutoSelect, useEnsureDefault, EngineSpinner, CollectionDashboard, ConfirmDialog, useDeepLinkParam } from '@/engines/_shared';
import { useTimelines, useTimelineEvents, useAllProjectEvents, useTimelineConnections } from './hooks';
import { countConnectionsForEvent, findTimelineIdForEntity } from './operations';
import { generateId } from '@/utils/idGenerator';
import TimelineView from './components/TimelineView';
import SwimLaneView from './components/SwimLaneView';
import TimelineBatchBar from './components/TimelineBatchBar';
import WorldCalendarEditor from './components/WorldCalendarEditor';
import { useWorldCalendar } from './useWorldCalendar';
import { manuscriptTimelineItems } from '@/engines/writings/chapterWorldDate';

type ViewMode = 'list' | 'swimlane';

export default function TimelineEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const scope = useWorldEraScope(projectId);
  const { timelines, loading: timelinesLoading, addTimeline, editTimeline, removeTimeline } = useTimelines(projectId);
  const [activeTimelineId, setActiveTimelineId] = useState<string>('');
  const linkedView=useDeepLinkParam('view');
  const [viewMode, setViewMode] = useState<ViewMode>(linkedView==='list'?'list':'swimlane');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarScope, setCalendarScope] = useState<'project' | 'timeline'>('project');
  const worldCalendar = useWorldCalendar(projectId);
  const timelineCalendar = useWorldCalendar(projectId, activeTimelineId || undefined);
  const activeTimeline = timelines.find(timeline => timeline.id === activeTimelineId);
  const navigate = useEraNavigate();
  // Dated chapters ride along as a read-only lane; opening one goes to the editor.
  const writings = useEraRows<Writing>('writings', projectId);
  const manuscript = useMemo(() => {
    const items = manuscriptTimelineItems(worldCalendar?.calendar, writings ?? [], projectId, t('timeline.manuscriptLane'));
    return items && {
      ...items,
      onOpen: (writingId: string) => navigate(`/project/${encodeURIComponent(projectId)}/writings?writing=${encodeURIComponent(writingId)}`),
    };
  }, [worldCalendar, writings, projectId, t, navigate]);
  // El evento que está esperando confirmación para borrarse. Arriba con el
  // resto de hooks porque más abajo hay un `return` temprano por carga, y un
  // hook detrás de un return no se llama siempre en el mismo orden. La
  // explicación de por qué existe esta guarda está en `askRemoveEvent`.
  const [pendingDelete, setPendingDelete] = useState<
    { id: string; title: string; connections: number; run: (id: string) => Promise<void> } | null
  >(null);

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
    editConnection,
    removeConnection,
    refresh: refreshConnections,
  } = useTimelineConnections(projectId);

  useAutoSelect(timelines, activeTimelineId, setActiveTimelineId);

  // Deep link (`?entity=<id>`): global search, backlinks and the cockpit reach
  // this engine through the fallback anchor adapter, which emits `?entity=`.
  // Nothing read it, so a hit opened the tab on whatever timeline happened to be
  // selected. Keyed on the link alone, so picking another timeline afterwards is
  // not undone.
  const deepLinkedEntityId = useDeepLinkParam('entity');
  useEffect(() => {
    if (!deepLinkedEntityId) return;
    let cancelled = false;
    void findTimelineIdForEntity(projectId, deepLinkedEntityId, scope.eraId).then((id) => {
      if (!cancelled && id) setActiveTimelineId(id);
    });
    return () => { cancelled = true; };
  }, [deepLinkedEntityId, projectId, scope.eraId]);

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
    // The delete cascades to the timeline's events and connections; the
    // swim-lane view and the stats line read them from their own hooks.
    refreshAllEvents();
    refreshConnections();
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

  /**
   * La pregunta antes de borrar un evento, UNA sola vez y para las dos vistas.
   *
   * Había tres sitios que borraban un evento —el botón flotante de la vista de
   * carriles, su menú contextual y la papelera de la vista de lista— y los tres
   * llamaban al borrado a pelo: sin confirmación, sin aviso y sin deshacer,
   * arrastrando en cascada todas las conexiones del evento. En los carriles, los
   * tres botones del evento seleccionado (Editar · Conectar · Eliminar) son
   * círculos de doce píxeles con seis de separación real: un clic desviado a la
   * derecha cuando querías conectar dos eventos te borraba uno.
   *
   * La guarda va AQUÍ y no en los tres sitios a propósito: `TimelineEngine` es
   * el dueño de las dos funciones de borrado, así que puesta aquí no hay forma
   * de añadir un cuarto botón que se la salte. Las vistas siguen llamando a
   * `onDeleteEvent` sin enterarse de nada.
   *
   * Y se dice CUÁNTAS conexiones se van a perder. `countConnectionsForEvent`
   * llevaba escrita desde el principio justo para esto y no la llamaba nadie:
   * el dato que convierte «¿seguro?» en una pregunta que se puede contestar.
   */
  const askRemoveEvent = (id: string, run: (id: string) => Promise<void>) => {
    const event = allEvents.find((e) => e.id === id) ?? activeEvents.find((e) => e.id === id);
    void countConnectionsForEvent(id, scope).then((connections) => {
      setPendingDelete({ id, title: event?.title ?? '', connections, run });
    });
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
        <button
          type="button"
          onClick={() => { setCalendarScope('project'); setCalendarOpen(true); }}
          data-testid="world-calendar-open"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text-primary transition"
          title={worldCalendar ? worldCalendar.calendar.name : t('timeline.world.noCalendar')}
        >
          <Globe size={13} aria-hidden="true" />
          {t('timeline.world.openEditor')}{worldCalendar ? ` · ${worldCalendar.calendar.name}` : ''}
        </button>
        {activeTimeline && <button type="button" data-testid="timeline-settings-open" className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-accent-gold" onClick={() => { setCalendarScope('timeline'); setCalendarOpen(true); }}><Clock size={13} />{t('timeline.settings.open')} · {activeTimeline.title}</button>}
        {viewMode === 'swimlane' && timelines.length > 1 && (
          <span className="text-[10px] text-text-dim">
            {t('timeline.statsTimelines').replace('{count}', String(timelines.length))} · {t('timeline.statsEvents').replace('{count}', String(allEvents.length))} · {t('timeline.statsConnections').replace('{count}', String(connections.length))}
          </span>
        )}
      </div>

      {/* Active view */}
      <TimelineBatchBar key={`${projectId}:${scope.eraId ?? 'base'}`} projectId={projectId} events={allEvents} onChanged={() => { refreshActiveEvents(); refreshAllEvents(); refreshConnections(); }} />
      {viewMode === 'swimlane' ? (
        <SwimLaneView
          projectId={projectId}
          timelines={timelines}
          events={allEvents}
          connections={connections}
          manuscript={manuscript ?? undefined}
          onAddEvent={handleAddEventGlobal}
          onEditEvent={handleEditEventGlobal}
          onDeleteEvent={(id) => askRemoveEvent(id, handleRemoveEventGlobal)}
          onAddConnection={addConnection}
          onEditConnection={editConnection}
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
            onDeleteEvent={(id) => askRemoveEvent(id, handleRemoveEvent)}
          />
        )
      )}

      <WorldCalendarEditor key={`${calendarScope}:${calendarScope === 'timeline' ? activeTimelineId : 'project'}`} projectId={projectId} open={calendarOpen} onClose={() => setCalendarOpen(false)} resolved={calendarScope === 'timeline' ? timelineCalendar : worldCalendar} timeline={calendarScope === 'timeline' ? activeTimeline : undefined} />

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

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        message={
          `${t('timeline.deleteEvent.message').replace('{title}', pendingDelete?.title ?? '')}`
          + (pendingDelete && pendingDelete.connections > 0
            ? `\n\n${t('timeline.deleteEvent.connections').replace('{n}', String(pendingDelete.connections))}`
            : '')
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) await target.run(target.id);
        }}
      />
    </div>
  );
}
