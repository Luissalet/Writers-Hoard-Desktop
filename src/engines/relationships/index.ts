import { Network } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import { db } from '@/db';
import RelationshipsEngine from './components/RelationshipsEngine';
import { RELATIONSHIP_KIND_CONFIG } from './types';

const relationshipsEngine: EngineDefinition = {
  id: 'relationships',
  name: 'Relationships',
  description: 'Map who knows who — allies, rivals, loves, and betrayals',
  icon: Network,
  category: 'planning',
  tables: {
    relationships: 'id, projectId, entityAId, entityBId, kind, state',
  },
  component: RelationshipsEngine,
};

registerEngine(relationshipsEngine);

registerEntityResolver({
  engineId: 'relationships',
  entityTypes: ['relationship'],
  resolveEntity: async (entityId: string) => {
    const rel = await db.relationships.get(entityId);
    if (!rel) return null;
    const cfg = RELATIONSHIP_KIND_CONFIG[rel.kind];
    return {
      id: rel.id,
      type: 'relationship',
      engineId: 'relationships',
      title: rel.label || `${rel.entityAName} ${cfg?.emoji ?? ''} ${rel.entityBName}`,
      subtitle: cfg?.label,
      color: rel.color ?? cfg?.color,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.relationships.filter(r =>
      r.entityAName.toLowerCase().includes(q) ||
      r.entityBName.toLowerCase().includes(q) ||
      r.label.toLowerCase().includes(q)
    ).toArray();
    return rows.map(r => ({
      id: r.id,
      type: 'relationship',
      engineId: 'relationships',
      title: r.label || `${r.entityAName} ↔ ${r.entityBName}`,
    }));
  },
});

registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'relationships',
  tables: ['relationships'],
}));

export { relationshipsEngine };
