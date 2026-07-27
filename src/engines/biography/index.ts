import { lazy } from 'react';
import { BookUser } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import { db } from '@/db';
const BiographyEngine = lazy(() => import('./components/BiographyEngine'));

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
    if (entityType === 'biography-fact') {
      const fact = await db.biographyFacts.get(entityId);
      if (!fact) return null;
      const biography = await db.biographies.get(fact.biographyId);
      return {
        id: fact.id,
        type: 'biography-fact',
        engineId: 'biography',
        projectId: fact.projectId,
        title: fact.title,
        subtitle: biography?.subjectName,
      };
    }
    const bio = await db.biographies.get(entityId);
    if (!bio) return null;
    return {
      id: bio.id,
      type: 'biography',
      engineId: 'biography',
      projectId: bio.projectId,
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
      projectId: b.projectId,
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
