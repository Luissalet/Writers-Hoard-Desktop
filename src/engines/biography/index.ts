import { lazy } from 'react';
import { BookUser } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import {
  registerAnchorAdapter,
  navigateTo,
  getCurrentProjectIdFromUrl,
} from '@/engines/_shared/anchoring';
import { t } from '@/i18n/useTranslation';
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
  searchEntities: async (query: string, projectId?: string) => {
    const q = query.toLowerCase();
    // Acotar ANTES de filtrar. El registro descarta por proyecto lo que ya se ha
    // traído, así que ignorar este parámetro no filtraba datos ajenos — hacía
    // que cada tecla del buscador global deserializara todas las biografías, con
    // sus fotos en base64, de todos los proyectos que hayas creado nunca.
    const base = projectId
      ? db.biographies.where('projectId').equals(projectId)
      : db.biographies.toCollection();
    const rows = await base.filter(b => b.subjectName.toLowerCase().includes(q)).toArray();
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

// Margin notes + references. Explicit adapter (entity-only): a `Biography` has
// no body text — just a subject and facts — so there is nothing for text-range
// anchors to bind to. Registering here replaces the generic fallback adapter,
// which showed the raw English engine name as the chip and navigated to a
// `?entity=` URL that no view reads.
registerAnchorAdapter({
  engineId: 'biography',
  supportsTextRange: false,
  async getEntityTitle(entityId: string) {
    // The adapter serves both entity types the resolver knows about.
    const bio = await db.biographies.get(entityId);
    if (bio) return bio.subjectName;
    const fact = await db.biographyFacts.get(entityId);
    return fact?.title ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.biography'),
  navigateToEntity(entityId: string, projectId?: string) {
    const pid = projectId ?? getCurrentProjectIdFromUrl();
    if (!pid) return;
    // A fact deep-links to the biography it belongs to — the view opens per
    // biography, not per fact.
    void (async () => {
      const bio = await db.biographies.get(entityId);
      const targetId = bio ? entityId : (await db.biographyFacts.get(entityId))?.biographyId;
      if (!targetId) return;
      navigateTo(`/project/${pid}/biography?bio=${encodeURIComponent(targetId)}`);
    })();
  },
});

// Backup: subject photos stay inline as base64 inside biographies.json — simpler
// than per-row folders and consistent with how facts and sources are serialized.
registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'biography',
  tables: ['biographies', 'biographyFacts'],
}));

export { biographyEngine };
