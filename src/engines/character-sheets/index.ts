import { lazy } from 'react';
import { Dice5 } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { db } from '@/db';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerLocaleStrings } from '@/i18n/useTranslation';
import en from './locales/en';
import es from './locales/es';
registerLocaleStrings({ en, es });
const CharacterSheetsEngine = lazy(() => import('./CharacterSheetsEngine'));
const characterSheetsEngine: EngineDefinition = {
  id: 'character-sheets',
  name: 'Character sheets',
  description: 'Local RPG characters, stat blocks and dice',
  icon: Dice5,
  category: 'creative',
  tables: {},
  component: CharacterSheetsEngine,
  countProjectItems: async projectId => (await db.projects.get(projectId))?.characterSheets?.length ?? 0,
};
registerEngine(characterSheetsEngine);
registerEntityResolver({ engineId: 'character-sheets', entityTypes: ['character-sheet'], async resolveEntity(id) { for (const project of await db.projects.toArray()) { const sheet = project.characterSheets?.find(item => item.id === id); if (sheet) return { id, projectId: project.id, engineId: 'character-sheets', type: 'character-sheet', title: sheet.title, subtitle: sheet.preset }; } return null; }, async searchEntities(query, projectId) { const projects = projectId ? [await db.projects.get(projectId)] : await db.projects.toArray(); const term = query.toLowerCase(); return projects.flatMap(project => (project?.characterSheets ?? []).filter(sheet => sheet.title.toLowerCase().includes(term)).map(sheet => ({ id: sheet.id, projectId: project!.id, engineId: 'character-sheets', type: 'character-sheet', title: sheet.title, subtitle: sheet.preset }))); } });
