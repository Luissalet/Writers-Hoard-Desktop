import { lazy } from 'react';
import { Clock } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, readBackupJson } from '@/engines/_shared';
import { db } from '@/db';
const TimelineEngine = lazy(() => import('./TimelineEngine'));

const timelineEngine: EngineDefinition = {
  id: 'timeline',
  name: 'Timeline',
  description: 'Multi-lane chronological timelines with connections and ranges',
  icon: Clock,
  category: 'core',
  tables: {
    timelines: 'id, projectId',
    timelineEvents: 'id, projectId, timelineId, order, dateMode, eventType',
    timelineConnections: 'id, projectId, timelineId, sourceEventId, targetEventId',
  },
  component: TimelineEngine,
};

registerEngine(timelineEngine);

registerEntityResolver({
  engineId: 'timeline',
  entityTypes: ['timeline', 'timeline-event'],
  resolveEntity: async (entityId: string, entityType: string) => {
    if (entityType === 'timeline') {
      const timeline = await db.timelines.get(entityId);
      if (!timeline) return null;
      return {
        id: timeline.id,
        type: entityType,
        engineId: 'timeline',
        projectId: timeline.projectId,
        title: timeline.title,
        color: timeline.color,
      };
    }
    const event = await db.timelineEvents.get(entityId);
    if (!event) return null;
    return {
      id: event.id,
      type: entityType,
      engineId: 'timeline',
      projectId: event.projectId,
      title: event.title,
      subtitle: event.date,
      color: event.color,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.timelineEvents.filter(e => e.title.toLowerCase().includes(q)).toArray();
    return rows.map(e => ({
      id: e.id,
      type: 'timeline-event',
      engineId: 'timeline',
      projectId: e.projectId,
      title: e.title,
      subtitle: e.date,
      color: e.color,
    }));
  },
});

const TIMELINE_TABLES = ['timelines', 'timelineEvents', 'timelineConnections'] as const;

async function readTimelineRows(
  zip: Parameters<typeof readBackupJson>[0],
  path: string,
): Promise<unknown[] | null> {
  const rows = await readBackupJson<unknown>(zip, path);
  if (rows !== null && !Array.isArray(rows)) {
    throw new Error(`Expected "${path}" to contain a JSON array.`);
  }
  return rows;
}

registerBackupStrategy({
  engineId: 'timeline',
  tables: [...TIMELINE_TABLES],
  async exportProject({ zip, projectId, projectDir }) {
    const [timelines, events, connections] = await Promise.all([
      db.timelines.where('projectId').equals(projectId).toArray(),
      db.timelineEvents.where('projectId').equals(projectId).toArray(),
      db.timelineConnections.where('projectId').equals(projectId).toArray(),
    ]);
    const folder = `${projectDir}/timeline`;
    zip.file(`${folder}/timelines.json`, JSON.stringify(timelines, null, 2));
    zip.file(`${folder}/timelineEvents.json`, JSON.stringify(events, null, 2));
    zip.file(`${folder}/timelineConnections.json`, JSON.stringify(connections, null, 2));
  },
  async preflightImport({ zip, projectDir }) {
    for (const table of TIMELINE_TABLES) {
      await readTimelineRows(zip, `${projectDir}/timeline/${table}.json`);
    }
    // Backups made by the previous supplemental strategy stored only
    // connections in this legacy folder.
    await readTimelineRows(
      zip,
      `${projectDir}/timeline-extras/timelineConnections.json`,
    );
  },
  async importProject({ zip, projectDir }) {
    const timelines = await readTimelineRows(
      zip,
      `${projectDir}/timeline/timelines.json`,
    );
    const events = await readTimelineRows(
      zip,
      `${projectDir}/timeline/timelineEvents.json`,
    );
    const connections =
      await readTimelineRows(zip, `${projectDir}/timeline/timelineConnections.json`) ??
      await readTimelineRows(
        zip,
        `${projectDir}/timeline-extras/timelineConnections.json`,
      );
    if (timelines?.length) await db.timelines.bulkAdd(timelines as never[]);
    if (events?.length) await db.timelineEvents.bulkAdd(events as never[]);
    if (connections?.length) {
      await db.timelineConnections.bulkAdd(connections as never[]);
    }
  },
});

export { timelineEngine };
