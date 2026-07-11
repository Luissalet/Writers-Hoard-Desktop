import type { Timeline, TimelineEvent, TimelineConnection } from '@/types';
import { makeEntityHook } from '../_shared/makeEntityHook';
import * as ops from './operations';

/**
 * Timeline hooks. Migrated onto `makeEntityHook` (2026-07-11) to kill the
 * hand-rolled duplication and inherit the initial-load-only `loading` semantics
 * + stale-fetch guard (the swim-lane drag reorder used to fire N concurrent
 * refreshes that could resolve out of order).
 */

const useTimelinesEntity = makeEntityHook<Timeline>({
  fetchFn: ops.getTimelines,
  createFn: ops.createTimeline,
  updateFn: ops.updateTimeline,
  deleteFn: ops.deleteTimeline,
});

export function useTimelines(projectId: string) {
  const { items, loading, refetching, refresh, addItem, editItem, removeItem } =
    useTimelinesEntity(projectId);
  return {
    timelines: items,
    loading,
    refetching,
    refresh,
    addTimeline: addItem,
    editTimeline: editItem,
    removeTimeline: removeItem,
  };
}

const useTimelineEventsEntity = makeEntityHook<TimelineEvent>({
  fetchFn: ops.getTimelineEvents,
  createFn: ops.createTimelineEvent,
  updateFn: ops.updateTimelineEvent,
  deleteFn: ops.deleteTimelineEvent,
});

export function useTimelineEvents(timelineId: string) {
  const { items, loading, refetching, refresh, addItem, editItem, removeItem } =
    useTimelineEventsEntity(timelineId);
  return {
    events: items,
    loading,
    refetching,
    refresh,
    addEvent: addItem,
    editEvent: editItem,
    removeEvent: removeItem,
  };
}

/** Fetch ALL events across all timelines in a project (for swim-lane view) */
const useAllProjectEventsEntity = makeEntityHook<TimelineEvent>({
  fetchFn: ops.getAllProjectEvents,
  createFn: ops.createTimelineEvent,
  updateFn: ops.updateTimelineEvent,
  deleteFn: ops.deleteTimelineEvent,
});

export function useAllProjectEvents(projectId: string) {
  const { items, loading, refetching, refresh, addItem, editItem, removeItem } =
    useAllProjectEventsEntity(projectId);
  return {
    events: items,
    loading,
    refetching,
    refresh,
    addEvent: addItem,
    editEvent: editItem,
    removeEvent: removeItem,
  };
}

/** Fetch connections for a project (cross-timeline links) */
const useTimelineConnectionsEntity = makeEntityHook<TimelineConnection>({
  fetchFn: ops.getConnectionsForProject,
  createFn: ops.createConnection,
  updateFn: ops.updateConnection,
  deleteFn: ops.deleteConnection,
});

export function useTimelineConnections(projectId: string) {
  const { items, loading, refetching, refresh, addItem, editItem, removeItem } =
    useTimelineConnectionsEntity(projectId);
  return {
    connections: items,
    loading,
    refetching,
    refresh,
    addConnection: addItem,
    editConnection: editItem,
    removeConnection: removeItem,
  };
}
