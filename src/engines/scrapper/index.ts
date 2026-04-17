// ============================================
// Scrapper Engine — Registration
// ============================================

import { Globe } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import { db } from '@/db';
import ScrapperEngine from './components/ScrapperEngine';

const scrapperEngine: EngineDefinition = {
  id: 'scrapper',
  name: 'Scrapper',
  description: 'Capture and archive web content for research',
  icon: Globe,
  category: 'research',
  tables: {
    snapshots: 'id, projectId, source, status, createdAt',
  },
  component: ScrapperEngine,
};

registerEngine(scrapperEngine);

registerEntityResolver({
  engineId: 'scrapper',
  entityTypes: ['scrapper', 'snapshot'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const snap = await db.snapshots.get(entityId);
    if (!snap) return null;
    return {
      id: snap.id,
      type: entityType,
      engineId: 'scrapper',
      title: snap.title,
      subtitle: snap.url,
      thumbnail: snap.thumbnail,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.snapshots.filter(s => s.title.toLowerCase().includes(q)).toArray();
    return rows.map(s => ({
      id: s.id,
      type: 'snapshot',
      engineId: 'scrapper',
      title: s.title,
      subtitle: s.url,
      thumbnail: s.thumbnail,
    }));
  },
});

registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'scrapper',
  tables: ['snapshots'],
}));

export { scrapperEngine };
