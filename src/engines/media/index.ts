import { lazy } from 'react';
import { AudioLines } from 'lucide-react';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import type { EngineDefinition } from '@/engines/_types';
import { registerBackupStrategy } from '@/engines/_shared';
import { registerLocaleStrings } from '@/i18n/useTranslation';
import { db } from '@/db';
import { mediaBackup } from './backup';
import en from './locales/en';
import es from './locales/es';
registerLocaleStrings({ en, es });
const MediaEngine = lazy(() => import('./MediaEngine'));
const mediaEngine: EngineDefinition = {
  id: 'media', name: 'Sound and video', description: 'Offline audio, video and voice notes', icon: AudioLines, category: 'creative',
  tables: {
    localMediaAssets: 'id, projectId, kind, *tags, updatedAt',
  },
  component: MediaEngine,
};
registerEngine(mediaEngine);
registerBackupStrategy({ engineId: 'media', tables: ['localMediaAssets'], ...mediaBackup });
registerEntityResolver({
  engineId: 'media', entityTypes: ['local-media'],
  async resolveEntity(id) { const asset = await db.localMediaAssets.get(id); return asset ? { id: asset.id, projectId: asset.projectId, engineId: 'media', type: 'local-media', title: asset.title, subtitle: asset.notes } : null; },
  async searchEntities(query, projectId) {
    const source = projectId ? db.localMediaAssets.where('projectId').equals(projectId) : db.localMediaAssets.toCollection();
    const needle = query.toLocaleLowerCase();
    return (await source.filter(asset => [asset.title, asset.notes, ...asset.tags].some(text => text.toLocaleLowerCase().includes(needle))).toArray()).map(asset => ({ id: asset.id, projectId: asset.projectId, engineId: 'media', type: 'local-media', title: asset.title, subtitle: asset.notes }));
  },
});
