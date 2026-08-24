import { lazy } from 'react';
import { ListTree } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import {
  getCurrentProjectIdFromUrl,
  navigateTo,
  registerAnchorAdapter,
} from '@/engines/_shared/anchoring';
import { t } from '@/i18n/useTranslation';
import { db } from '@/db';
const OutlineEngine = lazy(() => import('./components/OutlineEngine'));

const outlineEngine: EngineDefinition = {
  id: 'outline',
  name: 'Outline',
  description: 'Plot structure planner with beat sheet templates',
  icon: ListTree,
  category: 'planning',
  tables: {
    outlines: 'id, projectId',
    outlineBeats: 'id, outlineId, projectId, order, level, parentId',
  },
  component: OutlineEngine,
};

registerEngine(outlineEngine);

registerEntityResolver({
  engineId: 'outline',
  entityTypes: ['outline', 'outline-beat'],
  resolveEntity: async (entityId: string, entityType: string) => {
    if (entityType === 'outline') {
      const outline = await db.outlines.get(entityId);
      if (!outline) return null;
      return {
        id: outline.id,
        type: 'outline',
        engineId: 'outline',
        projectId: outline.projectId,
        title: outline.title,
      };
    } else {
      const beat = await db.outlineBeats.get(entityId);
      if (!beat) return null;
      const outline = await db.outlines.get(beat.outlineId);
      return {
        id: beat.id,
        type: 'outline-beat',
        engineId: 'outline',
        projectId: beat.projectId,
        title: beat.title,
        subtitle: outline?.title,
      };
    }
  },
  searchEntities: async (query: string, projectId?: string) => {
    const q = query.toLowerCase();
    // Acotar antes de filtrar (contrato en `_shared/entityResolverRegistry.ts`).
    const outlinesBase = projectId
      ? db.outlines.where('projectId').equals(projectId)
      : db.outlines.toCollection();
    const outlines = await outlinesBase.filter((o) => o.title.toLowerCase().includes(q)).toArray();
    const beatsBase = projectId
      ? db.outlineBeats.where('projectId').equals(projectId)
      : db.outlineBeats.toCollection();
    const beats = await beatsBase.filter((b) => b.title.toLowerCase().includes(q)).toArray();

    const results = [
      ...outlines.map((o) => ({
        id: o.id,
        type: 'outline' as const,
        engineId: 'outline',
        projectId: o.projectId,
        title: o.title,
      })),
      ...beats.map((b) => ({
        id: b.id,
        type: 'outline-beat' as const,
        engineId: 'outline',
        projectId: b.projectId,
        title: b.title,
      })),
    ];

    return results;
  },
});

registerAnchorAdapter({
  engineId: 'outline',
  supportsTextRange: false,
  async getEntityTitle(entityId: string) {
    const outline = await db.outlines.get(entityId);
    if (outline) return outline.title;
    const beat = await db.outlineBeats.get(entityId);
    return beat?.title ?? null;
  },
  getEngineChipLabel: () => t('engines.outline.name'),
  navigateToEntity(entityId: string, projectId?: string) {
    const pid = projectId ?? getCurrentProjectIdFromUrl();
    if (!pid) return;
    void (async () => {
      const outline = await db.outlines.get(entityId);
      if (outline?.projectId === pid) {
        navigateTo(
          `/project/${encodeURIComponent(pid)}/outline?outline=${encodeURIComponent(outline.id)}`,
        );
        return;
      }
      const beat = await db.outlineBeats.get(entityId);
      if (!beat || beat.projectId !== pid) return;
      navigateTo(
        `/project/${encodeURIComponent(pid)}/outline?outline=${encodeURIComponent(beat.outlineId)}&beat=${encodeURIComponent(beat.id)}`,
      );
    })();
  },
});

registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'outline',
  tables: ['outlines', 'outlineBeats'],
}));

export { outlineEngine };
