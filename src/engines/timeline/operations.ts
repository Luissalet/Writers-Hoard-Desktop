// ============================================
// Timeline Engine — Database Operations
// ============================================

import { db } from '@/db';
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

/**
 * Delete a timeline, its events, and every connection that touched them.
 *
 * The plain cascade on `timelineConnections.timelineId` was not enough:
 * connections are allowed to cross timelines and are stored with the
 * **target's** timelineId, so deleting the source lane left live rows pointing
 * at a `sourceEventId` that no longer existed. The UI hides them, but they
 * survived in Dexie and were written into every backup ZIP.
 */
export async function deleteTimeline(id: string): Promise<void> {
  await db.transaction('rw', db.timelines, db.timelineEvents, db.timelineConnections, async () => {
    const eventIds = (
      await db.timelineEvents.where('timelineId').equals(id).primaryKeys()
    ) as string[];

    await db.timelineConnections.where('timelineId').equals(id).delete();
    if (eventIds.length > 0) {
      const owned = new Set(eventIds);
      const dangling = await db.timelineConnections
        .filter((c) => owned.has(c.sourceEventId) || owned.has(c.targetEventId))
        .primaryKeys();
      if (dangling.length > 0) await db.timelineConnections.bulkDelete(dangling);
    }

    await db.timelineEvents.where('timelineId').equals(id).delete();
    await db.timelines.delete(id);
  });
}

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
  // Also remove any connections referencing this event. `sourceEventId` and
  // `targetEventId` are both indexed, so this is two index lookups instead of
  // the full-table scan (across every project) this used to do — and it now
  // runs inside one transaction rather than as loose parallel deletes.
  await db.transaction('rw', db.timelineEvents, db.timelineConnections, async () => {
    await db.timelineConnections.where('sourceEventId').equals(id).delete();
    await db.timelineConnections.where('targetEventId').equals(id).delete();
    await db.timelineEvents.delete(id);
  });
}

/** How many connections would be lost if this event were deleted. */
export async function countConnectionsForEvent(id: string): Promise<number> {
  const [asSource, asTarget] = await Promise.all([
    db.timelineConnections.where('sourceEventId').equals(id).count(),
    db.timelineConnections.where('targetEventId').equals(id).count(),
  ]);
  return asSource + asTarget;
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
