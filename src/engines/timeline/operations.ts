// ============================================
// Timeline Engine — Database Operations
// ============================================

import { db } from '@/db';
import { makeCascadeDeleteOp } from '@/engines/_shared';
import type { Timeline, TimelineEvent } from '@/types';

// ===== Timelines =====

export async function getTimelines(projectId: string): Promise<Timeline[]> {
  return db.timelines.where('projectId').equals(projectId).toArray();
}

export async function createTimeline(timeline: Timeline): Promise<string> {
  return db.timelines.add(timeline);
}

export const deleteTimeline = makeCascadeDeleteOp({
  tableName: 'timelines',
  cascades: [{ table: 'timelineEvents', foreignKey: 'timelineId' }],
});

// ===== Timeline Events =====

export async function getTimelineEvents(timelineId: string): Promise<TimelineEvent[]> {
  return db.timelineEvents.where('timelineId').equals(timelineId).sortBy('order');
}

export async function createTimelineEvent(event: TimelineEvent): Promise<string> {
  return db.timelineEvents.add(event);
}

export async function updateTimelineEvent(id: string, changes: Partial<TimelineEvent>): Promise<void> {
  await db.timelineEvents.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteTimelineEvent(id: string): Promise<void> {
  await db.timelineEvents.delete(id);
}
