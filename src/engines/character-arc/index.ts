import { TrendingUp } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import { db } from '@/db';
import CharacterArcEngine from './components/CharacterArcEngine';

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
      title: beat.title,
      subtitle: arc?.title,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const arcs = await db.characterArcs.filter(a => a.title.toLowerCase().includes(q)).toArray();
    const beats = await db.arcBeats.filter(b => b.title.toLowerCase().includes(q)).toArray();
    return [
      ...arcs.map(a => ({
        id: a.id,
        type: 'character-arc' as const,
        engineId: 'character-arc',
        title: a.title,
        subtitle: a.characterName,
      })),
      ...beats.map(b => ({
        id: b.id,
        type: 'arc-beat' as const,
        engineId: 'character-arc',
        title: b.title,
      })),
    ];
  },
});

registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'character-arc',
  tables: ['characterArcs', 'arcBeats'],
}));

export { characterArcEngine };
