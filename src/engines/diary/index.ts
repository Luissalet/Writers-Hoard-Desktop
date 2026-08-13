import { lazy } from 'react';
import { BookOpen } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import { stripHtml } from '@/utils/text';
import { db } from '@/db';
const DiaryEngine = lazy(() => import('./components/DiaryEngine'));

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
      projectId: entry.projectId,
      title: entry.entryDate,
    };
  },
  // Matches the date, the title AND the body. Searching only `entryDate` meant
  // a diary entry could never be found by anything the author actually wrote in
  // it — neither from Cmd+K nor from the annotation reference picker.
  searchEntities: async (query: string, projectId?: string) => {
    const q = query.toLowerCase();
    const base = projectId
      ? db.diaryEntries.where('projectId').equals(projectId)
      : db.diaryEntries.toCollection();
    const rows = await base
      .filter((d) =>
        (d.entryDate || '').toLowerCase().includes(q) ||
        (d.title || '').toLowerCase().includes(q) ||
        stripHtml(d.content || '').toLowerCase().includes(q),
      )
      .toArray();
    return rows.map(d => ({
      id: d.id,
      type: 'diary-entry',
      engineId: 'diary',
      projectId: d.projectId,
      title: d.title || d.entryDate,
      subtitle: d.title ? d.entryDate : undefined,
    }));
  },
});

registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'diary',
  tables: ['diaryEntries'],
}));

export { diaryEngine };
