import { useState, useEffect, useCallback } from 'react';
import type { Timeline, TimelineEvent } from '@/types';
import * as ops from './operations';

export function useTimelines(projectId: string) {
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const data = await ops.getTimelines(projectId);
    setTimelines(data);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const addTimeline = useCallback(async (timeline: Timeline) => {
    await ops.createTimeline(timeline);
    await refresh();
  }, [refresh]);

  const removeTimeline = useCallback(async (id: string) => {
    await ops.deleteTimeline(id);
    await refresh();
  }, [refresh]);

  return { timelines, loading, refresh, addTimeline, removeTimeline };
}

export function useTimelineEvents(timelineId: string) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!timelineId) return;
    setLoading(true);
    const data = await ops.getTimelineEvents(timelineId);
    setEvents(data);
    setLoading(false);
  }, [timelineId]);

  useEffect(() => { refresh(); }, [refresh]);

  const addEvent = useCallback(async (event: TimelineEvent) => {
    await ops.createTimelineEvent(event);
    await refresh();
  }, [refresh]);

  const editEvent = useCallback(async (id: string, changes: Partial<TimelineEvent>) => {
    await ops.updateTimelineEvent(id, changes);
    await refresh();
  }, [refresh]);

  const removeEvent = useCallback(async (id: string) => {
    await ops.deleteTimelineEvent(id);
    await refresh();
  }, [refresh]);

  return { events, loading, refresh, addEvent, editEvent, removeEvent };
}
