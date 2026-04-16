import { BookOpen } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine } from '@/engines/_registry';
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

export { diaryEngine };
