// ============================================
// Timeline Engine — Database Operations
// ============================================

import { db } from '@/db';
import { makeCascadeDeleteOp } from '@/engines/_shared';
import type { Timeline, TimelineEvent, TimelineConnection } from '@/types';

// ===== Timelines =====

export async function getTimelines(projectId: string): Promise<Timeline[]> {
  return db.timelines.where('projectId').equals(projectId).toArray();
}

export async function createTimeline(timeline: Timeline): Promise<string> {
  return db.timelines.add(timeline);
}

export async function updateTimeline(id: string, changes: Partial<Timeline>): Promise<void> {
  await db.timelines.update(id, { ...changes, updatedAt: Date.now() });
}

export const deleteTimeline = makeCascadeDeleteOp({
  tableName: 'timelines',
  cascades: [
    { table: 'timelineEvents', foreignKey: 'timelineId' },
    { table: 'timelineConnections', foreignKey: 'timelineId' },
  ],
});

// ===== Timeline Events =====

export async function getTimelineEvents(timelineId: string): Promise<TimelineEvent[]> {
  return db.timelineEvents.where('timelineId').equals(timelineId).sortBy('order');
}

export async function getAllProjectEvents(projectId: string): Promise<TimelineEvent[]> {
  return db.timelineEvents.where('projectId').equals(projectId).sortBy('order');
}

export async function createTimelineEvent(event: TimelineEvent): Promise<string> {
  return db.timelineEvents.add(event);
}

export async function updateTimelineEvent(id: string, changes: Partial<TimelineEvent>): Promise<void> {
  await db.timelineEvents.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteTimelineEvent(id: string): Promise<void> {
  // Also remove any connections referencing this event
  const conns = await db.timelineConnections
    .filter(c => c.sourceEventId === id || c.targetEventId === id)
    .toArray();
  await Promise.all(conns.map(c => db.timelineConnections.delete(c.id)));
  await db.timelineEvents.delete(id);
}

// ===== Timeline Connections =====

export async function getConnectionsForProject(projectId: string): Promise<TimelineConnection[]> {
  return db.timelineConnections.where('projectId').equals(projectId).toArray();
}

export async function getConnectionsForTimeline(timelineId: string): Promise<TimelineConnection[]> {
  return db.timelineConnections.where('timelineId').equals(timelineId).toArray();
}

export async function createConnection(conn: TimelineConnection): Promise<string> {
  return db.timelineConnections.add(conn);
}

export async function updateConnection(id: string, changes: Partial<TimelineConnection>): Promise<void> {
  await db.timelineConnections.update(id, changes);
}

export async function deleteConnection(id: string): Promise<void> {
  await db.timelineConnections.delete(id);
}
