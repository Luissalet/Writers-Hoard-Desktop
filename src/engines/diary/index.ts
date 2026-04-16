import { BookOpen } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { db } from '@/db';
import DiaryEngine from './components/DiaryEngine';

const diaryEngine: EngineDefinition = {
  id: 'diary',
  name: 'Diary',
  description: 'Quick daily entries with timestamps, moods, and tags',
  icon: BookOpen,
  category: 'creative',
  tables: {
    diaryEntries: 'id, projectId, entryDate, *tags, pinned',
  },
  component: DiaryEngine,
};

registerEngine(diaryEngine);

registerEntityResolver({
  engineId: 'diary',
  entityTypes: ['diary', 'diary-entry'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const entry = await db.diaryEntries.get(entityId);
    if (!entry) return null;
    return {
      id: entry.id,
      type: entityType,
      engineId: 'diary',
      title: entry.entryDate,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.diaryEntries.filter(d => (d.entryDate || '').toLowerCase().includes(q)).toArray();
    return rows.map(d => ({
      id: d.id,
      type: 'diary-entry',
      engineId: 'diary',
      title: d.entryDate,
    }));
  },
});

export { diaryEngine };
