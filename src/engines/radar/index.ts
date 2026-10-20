import { lazy } from 'react';
import { ChartNoAxesCombined } from 'lucide-react';
import { db } from '@/db';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerLocaleStrings } from '@/i18n/useTranslation';
import en from './locales/en';
import es from './locales/es';
registerLocaleStrings({ en, es });
const RadarEngine = lazy(() => import('./RadarEngine'));
const radarEngine: EngineDefinition = {
  id: 'radar',
  name: 'Radar charts',
  description: 'Compare custom measures and live Codex values',
  icon: ChartNoAxesCombined,
  category: 'creative',
  tables: {},
  component: RadarEngine,
  countProjectItems: async projectId => (await db.projects.get(projectId))?.radarCharts?.length ?? 0,
};
registerEngine(radarEngine);
registerEntityResolver({ engineId: 'radar', entityTypes: ['radar-chart'], async resolveEntity(id) { for (const project of await db.projects.toArray()) { const chart = project.radarCharts?.find(item => item.id === id); if (chart) return { id, projectId: project.id, engineId: 'radar', type: 'radar-chart', title: chart.title, subtitle: chart.description }; } return null; }, async searchEntities(query, projectId) { const projects = projectId ? [await db.projects.get(projectId)] : await db.projects.toArray(), term = query.toLowerCase(); return projects.flatMap(project => (project?.radarCharts ?? []).filter(chart => `${chart.title} ${chart.description}`.toLowerCase().includes(term)).map(chart => ({ id: chart.id, projectId: project!.id, engineId: 'radar', type: 'radar-chart', title: chart.title, subtitle: chart.description }))); } });
