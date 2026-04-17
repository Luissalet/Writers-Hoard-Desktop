import { BookUser } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import { db } from '@/db';
import BiographyEngine from './components/BiographyEngine';

const biographyEngine: EngineDefinition = {
  id: 'biography',
  name: 'Biography',
  description: 'Build biographies from facts, events, and sources',
  icon: BookUser,
  category: 'creative',
  tables: {
    biographies: 'id, projectId',
    biographyFacts: 'id, biographyId, projectId, order, category',
  },
  component: BiographyEngine,
};

registerEngine(biographyEngine);

registerEntityResolver({
  engineId: 'biography',
  entityTypes: ['biography', 'biography-fact'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const bio = await db.biographies.get(entityId);
    if (!bio) return null;
    return {
      id: bio.id,
      type: entityType,
      engineId: 'biography',
      title: bio.subjectName,
      thumbnail: bio.subjectPhoto,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.biographies.filter(b => b.subjectName.toLowerCase().includes(q)).toArray();
    return rows.map(b => ({
      id: b.id,
      type: 'biography',
      engineId: 'biography',
      title: b.subjectName,
      thumbnail: b.subjectPhoto,
    }));
  },
});

// Backup: subject photos stay inline as base64 inside biographies.json — simpler
// than per-row folders and consistent with how facts and sources are serialized.
registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'biography',
  tables: ['biographies', 'biographyFacts'],
}));

export { biographyEngine };
