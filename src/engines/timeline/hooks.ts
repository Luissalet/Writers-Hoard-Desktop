import { useState, useEffect, useCallback } from 'react';
import type { Timeline, TimelineEvent, TimelineConnection } from '@/types';
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

  const editTimeline = useCallback(async (id: string, changes: Partial<Timeline>) => {
    await ops.updateTimeline(id, changes);
    await refresh();
  }, [refresh]);

  const removeTimeline = useCallback(async (id: string) => {
    await ops.deleteTimeline(id);
    await refresh();
  }, [refresh]);

  return { timelines, loading, refresh, addTimeline, editTimeline, removeTimeline };
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

/** Fetch ALL events across all timelines in a project (for swim-lane view) */
export function useAllProjectEvents(projectId: string) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const data = await ops.getAllProjectEvents(projectId);
    setEvents(data);
    setLoading(false);
  }, [projectId]);

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

/** Fetch connections for a project (cross-timeline links) */
export function useTimelineConnections(projectId: string) {
  const [connections, setConnections] = useState<TimelineConnection[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const data = await ops.getConnectionsForProject(projectId);
    setConnections(data);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const addConnection = useCallback(async (conn: TimelineConnection) => {
    await ops.createConnection(conn);
    await refresh();
  }, [refresh]);

  const editConnection = useCallback(async (id: string, changes: Partial<TimelineConnection>) => {
    await ops.updateConnection(id, changes);
    await refresh();
  }, [refresh]);

  const removeConnection = useCallback(async (id: string) => {
    await ops.deleteConnection(id);
    await refresh();
  }, [refresh]);

  return { connections, loading, refresh, addConnection, editConnection, removeConnection };
}
