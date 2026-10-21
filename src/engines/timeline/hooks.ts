import { useEraEntities } from '@/services/worldEras/hooks';
import type { Timeline, TimelineEvent, TimelineConnection } from '@/types';
import * as ops from './operations';

/**
 * Timeline hooks. Migrated onto `makeEntityHook` (2026-07-11) to kill the
 * hand-rolled duplication and inherit the initial-load-only `loading` semantics
 * + stale-fetch guard (the swim-lane drag reorder used to fire N concurrent
 * refreshes that could resolve out of order).
 */

const useTimelinesEntityOptions = {
  fetchFn: ops.getTimelines,
  createFn: ops.createTimeline,
  updateFn: ops.updateTimeline,
  deleteFn: ops.deleteTimeline,
};
function useTimelinesEntity(scopeId: string) { return useEraEntities<Timeline>(scopeId, 'timelines', 'projectId', useTimelinesEntityOptions); }

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

const useTimelineEventsEntityOptions = {
  fetchFn: ops.getTimelineEvents,
  createFn: ops.createTimelineEvent,
  updateFn: ops.updateTimelineEvent,
  deleteFn: ops.deleteTimelineEvent,
};
const compareEvents = (a: TimelineEvent, b: TimelineEvent) => a.order - b.order;
function useTimelineEventsEntity(scopeId: string) { return useEraEntities<TimelineEvent>(scopeId, 'timelineEvents', 'timelineId', useTimelineEventsEntityOptions, undefined, compareEvents); }

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
const useAllProjectEventsEntityOptions = {
  fetchFn: ops.getAllProjectEvents,
  createFn: ops.createTimelineEvent,
  updateFn: ops.updateTimelineEvent,
  deleteFn: ops.deleteTimelineEvent,
};
function useAllProjectEventsEntity(scopeId: string) { return useEraEntities<TimelineEvent>(scopeId, 'timelineEvents', 'projectId', useAllProjectEventsEntityOptions, undefined, compareEvents); }

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
const useTimelineConnectionsEntityOptions = {
  fetchFn: ops.getConnectionsForProject,
  createFn: ops.createConnection,
  updateFn: ops.updateConnection,
  deleteFn: ops.deleteConnection,
};
function useTimelineConnectionsEntity(scopeId: string) { return useEraEntities<TimelineConnection>(scopeId, 'timelineConnections', 'projectId', useTimelineConnectionsEntityOptions); }

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
