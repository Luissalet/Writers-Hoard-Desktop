import { Clock } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { db } from '@/db';
import TimelineEngine from './TimelineEngine';

const timelineEngine: EngineDefinition = {
  id: 'timeline',
  name: 'Timeline',
  description: 'Chronological event sequencing with lanes and colors',
  icon: Clock,
  category: 'core',
  tables: {
    timelines: 'id, projectId',
    timelineEvents: 'id, projectId, timelineId, order',
  },
  component: TimelineEngine,
};

registerEngine(timelineEngine);

registerEntityResolver({
  engineId: 'timeline',
  entityTypes: ['timeline', 'timeline-event'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const event = await db.timelineEvents.get(entityId);
    if (!event) return null;
    return {
      id: event.id,
      type: entityType,
      engineId: 'timeline',
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
      title: e.title,
      subtitle: e.date,
      color: e.color,
    }));
  },
});

export { timelineEngine };
