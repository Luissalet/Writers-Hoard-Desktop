import { lazy } from 'react';
import { TrendingUp } from 'lucide-react';
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
import { arcBeatPath } from './beatLinks';
const CharacterArcEngine = lazy(() => import('./components/CharacterArcEngine'));

const characterArcEngine: EngineDefinition = {
  id: 'character-arc',
  name: 'Character Arc',
  description: 'Track interior journeys: ghost, lie, truth, want, need, beats',
  icon: TrendingUp,
  category: 'planning',
  tables: {
    characterArcs: 'id, projectId, characterId, templateId, status',
    arcBeats: 'id, arcId, projectId, order, stage',
  },
  component: CharacterArcEngine,
};

registerEngine(characterArcEngine);

registerEntityResolver({
  engineId: 'character-arc',
  entityTypes: ['character-arc', 'arc-beat'],
  resolveEntity: async (entityId: string, entityType: string) => {
    if (entityType === 'character-arc') {
      const arc = await db.characterArcs.get(entityId);
      if (!arc) return null;
      return {
        id: arc.id,
        type: 'character-arc',
        engineId: 'character-arc',
        projectId: arc.projectId,
        title: arc.title,
        subtitle: arc.characterName,
        color: arc.color,
      };
    }
    const beat = await db.arcBeats.get(entityId);
    if (!beat) return null;
    const arc = await db.characterArcs.get(beat.arcId);
    return {
      id: beat.id,
      type: 'arc-beat',
      engineId: 'character-arc',
      projectId: beat.projectId,
      title: beat.title,
      subtitle: arc?.title,
    };
  },
  searchEntities: async (query: string, projectId?: string) => {
    const q = query.toLowerCase();
    // Acotar antes de filtrar (contrato en `_shared/entityResolverRegistry.ts`).
    const arcsBase = projectId
      ? db.characterArcs.where('projectId').equals(projectId)
      : db.characterArcs.toCollection();
    const arcs = await arcsBase.filter(a => a.title.toLowerCase().includes(q)).toArray();
    const beatsBase = projectId
      ? db.arcBeats.where('projectId').equals(projectId)
      : db.arcBeats.toCollection();
    const beats = await beatsBase.filter(b => b.title.toLowerCase().includes(q)).toArray();
    return [
      ...arcs.map(a => ({
        id: a.id,
        type: 'character-arc' as const,
        engineId: 'character-arc',
        projectId: a.projectId,
        title: a.title,
        subtitle: a.characterName,
      })),
      ...beats.map(b => ({
        id: b.id,
        type: 'arc-beat' as const,
        engineId: 'character-arc',
        projectId: b.projectId,
        title: b.title,
      })),
    ];
  },
});

// Margin notes + references. Explicit adapter (entity-only ON PURPOSE): the
// arc's text lives spread across six independent textareas plus per-beat
// descriptions, so a single flattened `getEntityText` would produce offsets no
// textarea selection maps back to. Registering here replaces the generic
// fallback adapter (raw English chip label, dead `?entity=` URL).
registerAnchorAdapter({
  engineId: 'character-arc',
  supportsTextRange: false,
  async getEntityTitle(entityId: string) {
    const arc = await db.characterArcs.get(entityId);
    if (arc) return arc.title;
    const beat = await db.arcBeats.get(entityId);
    return beat?.title ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.character-arc'),
  navigateToEntity(entityId: string, projectId?: string) {
    const pid = projectId ?? getCurrentProjectIdFromUrl();
    if (!pid) return;
    // The editor opens per arc; a beat opens its arc and unfolds itself there.
    void (async () => {
      const arc = await db.characterArcs.get(entityId);
      if (arc) {
        navigateTo(`/project/${pid}/character-arc?arc=${encodeURIComponent(arc.id)}`);
        return;
      }
      const beat = await db.arcBeats.get(entityId);
      if (!beat) return;
      navigateTo(arcBeatPath(pid, beat.arcId, beat.id));
    })();
  },
});

registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'character-arc',
  tables: ['characterArcs', 'arcBeats'],
}));

export { characterArcEngine };
