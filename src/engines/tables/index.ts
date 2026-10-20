import { lazy } from 'react';
import { Table2 } from 'lucide-react';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { metadataResolver } from '@/engines/_shared/metadataResolver';
import type { EngineDefinition } from '@/engines/_types';
import { registerLocaleStrings } from '@/i18n/useTranslation';
import en from './locales/en';
import es from './locales/es';
import { db } from '@/db';

registerLocaleStrings({ en, es });
const TablesEngine = lazy(() => import('./TablesEngine'));
const tablesEngine: EngineDefinition = {
  id: 'tables', name: 'Tables and sheets', description: 'Typed records and offline formulas', icon: Table2,
  category: 'planning', tables: {}, component: TablesEngine,
  countProjectItems: async projectId => (await db.projects.get(projectId))?.dataTables?.reduce((total, table) => total + 1 + table.rows.length, 0) ?? 0,
};
registerEngine(tablesEngine);
registerEntityResolver(metadataResolver('tables', ['world-table', 'world-sheet'], project => (project.dataTables ?? []).map(table => ({ id: table.id, projectId: project.id, engineId: 'tables', type: table.mode === 'sheet' ? 'world-sheet' : 'world-table', title: table.title, subtitle: table.mode, searchTerms: [...table.columns.map(column => column.name), ...table.rows.map(row => Object.values(row.cells).join(' '))] }))));
