import { useState, useEffect, useMemo } from 'react';
import { Clock, Plus, Trash2, X, ChevronRight } from 'lucide-react';
import type { EngineComponentProps } from '@/engines/_types';
import { useTimelines, useTimelineEvents } from './hooks';
import { generateId } from '@/utils/idGenerator';
import TimelineView from './components/TimelineView';

export default function TimelineEngine({ projectId }: EngineComponentProps) {
  const { timelines, loading: timelinesLoading, addTimeline, removeTimeline } = useTimelines(projectId);
  const [activeTimelineId, setActiveTimelineId] = useState<string>('');
  const [showNewTimeline, setShowNewTimeline] = useState(false);
  const [newTimelineName, setNewTimelineName] = useState('');

  const { events, addEvent, editEvent, removeEvent } = useTimelineEvents(activeTimelineId);

  // Auto-set first timeline as active
  useEffect(() => {
    if (timelines.length > 0 && !activeTimelineId) {
      setActiveTimelineId(timelines[0].id);
    }
  }, [timelines, activeTimelineId]);

  // Ensure at least one timeline exists
  useEffect(() => {
    const ensureTimeline = async () => {
      if (timelinesLoading) return;
      if (timelines.length === 0) {
        const tl = {
          id: generateId('tl'),
          projectId,
          title: 'Main Timeline',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await addTimeline(tl);
        setActiveTimelineId(tl.id);
      }
    };
    ensureTimeline();
  }, [projectId, timelinesLoading, timelines.length, addTimeline]);

  const loading = useMemo(() => timelinesLoading, [timelinesLoading]);

  const handleCreateTimeline = async () => {
    if (!newTimelineName.trim()) return;
    const tl = {
      id: generateId('tl'),
      projectId,
      title: newTimelineName.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await addTimeline(tl);
    setActiveTimelineId(tl.id);
    setNewTimelineName('');
    setShowNewTimeline(false);
  };

  const handleDeleteTimeline = async (timelineId: string) => {
    if (!confirm(`Delete timeline "${timelines.find(t => t.id === timelineId)?.title || 'Unnamed'}"? All its events will be lost.`)) {
      return;
    }
    await removeTimeline(timelineId);
    if (activeTimelineId === timelineId) {
      const remaining = timelines.filter(t => t.id !== timelineId);
      if (remaining.length > 0) {
        setActiveTimelineId(remaining[0].id);
      } else {
        setActiveTimelineId('');
      }
    }
  };

  if (loading && timelines.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-accent-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

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

      {/* Timelines dashboard */}
      <div className="border border-border rounded-xl bg-surface/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Clock size={14} className="text-accent-gold" />
            Your Timelines
          </h3>
          {showNewTimeline ? (
            <div className="flex items-center gap-1">
              <input
                value={newTimelineName}
                onChange={(e) => setNewTimelineName(e.target.value)}
                placeholder="Timeline name..."
                className="px-2.5 py-1 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold w-40"
                autoFocus
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    await handleCreateTimeline();
                  }
                  if (e.key === 'Escape') {
                    setShowNewTimeline(false);
                    setNewTimelineName('');
                  }
                }}
              />
              <button
                onClick={handleCreateTimeline}
                className="p-1.5 text-accent-gold hover:text-accent-amber transition"
              >
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => {
                  setShowNewTimeline(false);
                  setNewTimelineName('');
                }}
                className="p-1.5 text-text-muted hover:text-text-primary transition"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewTimeline(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
            >
              <Plus size={13} />
              New Timeline
            </button>
          )}
        </div>

        {timelines.length === 0 ? (
          <p className="text-sm text-text-dim text-center py-4">No timelines yet. Create one to get started.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {timelines.map(tl => {
              const isActive = tl.id === activeTimelineId;
              return (
                <div
                  key={tl.id}
                  className={`group relative rounded-lg border-2 transition cursor-pointer ${
                    isActive
                      ? 'border-accent-gold bg-accent-gold/10'
                      : 'border-border bg-elevated hover:border-accent-gold/40'
                  }`}
                >
                  <button
                    onClick={() => setActiveTimelineId(tl.id)}
                    className="w-full text-left p-3"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Clock size={12} className={isActive ? 'text-accent-gold' : 'text-text-dim'} />
                      <span className={`text-sm font-serif font-semibold truncate ${isActive ? 'text-accent-gold' : 'text-text-primary'}`}>
                        {tl.title}
                      </span>
                    </div>
                    <p className="text-[10px] text-text-dim">
                      {new Date(tl.createdAt).toLocaleDateString()}
                    </p>
                  </button>
                  {timelines.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTimeline(tl.id);
                      }}
                      className="absolute top-1.5 right-1.5 p-1 rounded-full opacity-0 group-hover:opacity-100 text-text-dim hover:text-danger hover:bg-danger/10 transition"
                      title="Delete timeline"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
