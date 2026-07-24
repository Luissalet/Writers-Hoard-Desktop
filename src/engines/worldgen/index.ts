import { Mountain } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import {
  registerAnchorAdapter,
  navigateTo,
  getCurrentProjectIdFromUrl,
} from '@/engines/_shared/anchoring';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import { t } from '@/i18n/useTranslation';
import { db } from '@/db';
import WorldgenEngine from './components/WorldgenEngine';

const worldgenEngine: EngineDefinition = {
  id: 'worldgen',
  name: 'World Generator',
  description: 'Generate realistic planets — terrain, climate, biomes, rivers — with a 2D atlas and a 3D view',
  icon: Mountain,
  category: 'creative',
  tables: {
    generatedWorlds: 'id, projectId, updatedAt',
    worldWaypoints: 'id, projectId, worldId',
  },
  component: WorldgenEngine,
};

registerEngine(worldgenEngine);

// Waypoints (and worlds) are findable in global search / linkable elsewhere.
registerEntityResolver({
  engineId: 'worldgen',
  entityTypes: ['generated-world', 'world-waypoint'],
  resolveEntity: async (entityId: string, entityType: string) => {
    if (entityType === 'generated-world') {
      const world = await db.generatedWorlds.get(entityId);
      if (!world) return null;
      return {
        id: world.id,
        type: entityType,
        engineId: 'worldgen',
        title: world.title,
        subtitle: world.params.seed,
      };
    }
    const wp = await db.worldWaypoints.get(entityId);
    if (!wp) return null;
    return {
      id: wp.id,
      type: 'world-waypoint',
      engineId: 'worldgen',
      title: wp.name,
      subtitle: wp.description,
      color: wp.color,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const [worlds, waypoints] = await Promise.all([
      db.generatedWorlds.filter((w) => w.title.toLowerCase().includes(q)).toArray(),
      db.worldWaypoints.filter((p) => p.name.toLowerCase().includes(q)).toArray(),
    ]);
    return [
      ...worlds.map((w) => ({
        id: w.id,
        type: 'generated-world',
        engineId: 'worldgen',
        title: w.title,
        subtitle: w.params.seed,
      })),
      ...waypoints.map((p) => ({
        id: p.id,
        type: 'world-waypoint',
        engineId: 'worldgen',
        title: p.name,
        subtitle: p.description,
        color: p.color,
      })),
    ];
  },
});

registerAnchorAdapter({
  engineId: 'worldgen',
  supportsTextRange: false,
  async getEntityTitle(entityId: string) {
    const world = await db.generatedWorlds.get(entityId);
    if (world) return world.title;
    const wp = await db.worldWaypoints.get(entityId);
    return wp?.name ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.worldgen'),
  navigateToEntity(entityId: string) {
    const pid = getCurrentProjectIdFromUrl();
    if (!pid) return;
    navigateTo(`/project/${pid}/worldgen?waypoint=${encodeURIComponent(entityId)}`);
  },
});

// Worlds are seed+params (+ tiny thumbnail) and waypoints are plain JSON —
// the simple project-scoped strategy covers both tables completely.
registerBackupStrategy(
  makeSimpleBackupStrategy({
    engineId: 'worldgen',
    tables: ['generatedWorlds', 'worldWaypoints'],
  }),
);

export { worldgenEngine };
