import { lazy } from 'react';
import { Box } from 'lucide-react';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { metadataResolver } from '@/engines/_shared/metadataResolver';
import { registerLocaleStrings } from '@/i18n/useTranslation';
import type { EngineDefinition } from '@/engines/_types';
import es from './locales/es';
import { db } from '@/db';
import en from './locales/en';

registerLocaleStrings({ es, en });
const ModelViewerEngine = lazy(() => import('./ModelViewerEngine'));
const modelViewerEngine: EngineDefinition = {
  id: 'model-viewer',
  name: '3D models',
  description: 'Local 3D models, materials, camera navigation and animations',
  icon: Box,
  category: 'creative',
  tables: {},
  component: ModelViewerEngine,
  countProjectItems: async projectId => (await db.projects.get(projectId))?.modelAssets?.length ?? 0,
};
registerEngine(modelViewerEngine);
registerEntityResolver(metadataResolver('model-viewer', ['model-asset'], project => (project.modelAssets ?? []).map(asset => ({ id: asset.id, projectId: project.id, engineId: 'model-viewer', type: 'model-asset', title: asset.name, subtitle: asset.name.split('.').pop()?.toUpperCase() || '3D' }))));
