import { lazy } from 'react';
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
import { readWorldRenameEdits } from './core/readRenameEdits';
import { resolveWorldgenRoute } from './navigation';
const WorldgenEngine = lazy(() => import('./components/WorldgenEngine'));

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
  entityTypes: ['generated-world', 'world-waypoint', 'world-region', 'world-spatial'],
  resolveEntity: async (entityId: string, entityType: string) => {
    if (entityType === 'generated-world') {
      const world = await db.generatedWorlds.get(entityId);
      if (!world) return null;
      return {
        id: world.id,
        type: entityType,
        engineId: 'worldgen',
        projectId: world.projectId,
        title: world.title,
        subtitle: world.params.seed,
      };
    }
    if (entityType === 'world-region') {
      const worlds = await db.generatedWorlds.toArray();
      for (const world of worlds) {
        const region = world.regions?.find((candidate) => candidate.id === entityId);
        if (!region) continue;
        return {
          id: region.id,
          type: entityType,
          engineId: 'worldgen',
          projectId: world.projectId,
          title: region.title,
          subtitle: `${region.spanKm} km · ${world.title}`,
        };
      }
      return null;
    }
    if (entityType === 'world-spatial') {
      const split = entityId.indexOf('::');
      if (split < 1) return null;
      const worldId = entityId.slice(0, split);
      const key = entityId.slice(split + 2);
      const world = await db.generatedWorlds.get(worldId);
      if (!world) return null;
      const edits = readWorldRenameEdits(world.edits ?? '[]');
      const renamed = edits
        .filter((edit) => edit.kind === 'rename' && edit.key === key)
        .at(-1);
      const fallback = key.split(':')[1]?.replace(/[-_]/g, ' ') || 'Lugar';
      return {
        id: entityId,
        type: entityType,
        engineId: 'worldgen',
        projectId: world.projectId,
        title: renamed?.name ?? fallback,
        subtitle: world.title,
      };
    }
    const wp = await db.worldWaypoints.get(entityId);
    if (!wp) return null;
    return {
      id: wp.id,
      type: 'world-waypoint',
      engineId: 'worldgen',
      projectId: wp.projectId,
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
    const regions = worlds.flatMap((world) => (world.regions ?? [])
      .filter((region) => region.title.toLowerCase().includes(q))
      .map((region) => ({
        id: region.id,
        type: 'world-region',
        engineId: 'worldgen',
        projectId: world.projectId,
        title: region.title,
        subtitle: `${region.spanKm} km · ${world.title}`,
      })));
    const places = worlds.flatMap((world) => readWorldRenameEdits(world.edits ?? '[]')
      .filter((edit) => edit.name.toLowerCase().includes(q))
      .map((edit) => ({
        id: `${world.id}::${edit.key}`,
        type: 'world-spatial',
        engineId: 'worldgen',
        projectId: world.projectId,
        title: edit.name,
        subtitle: world.title,
      })));
    return [
      ...worlds.map((w) => ({
        id: w.id,
        type: 'generated-world',
        engineId: 'worldgen',
        projectId: w.projectId,
        title: w.title,
        subtitle: w.params.seed,
      })),
      ...waypoints.map((p) => ({
        id: p.id,
        type: 'world-waypoint',
        engineId: 'worldgen',
        projectId: p.projectId,
        title: p.name,
        subtitle: p.description,
        color: p.color,
      })),
      ...regions,
      ...places,
    ];
  },
});

registerAnchorAdapter({
  engineId: 'worldgen',
  supportsTextRange: false,
  async getEntityTitle(entityId: string) {
    if (entityId.includes('::')) {
      const split = entityId.indexOf('::');
      const world = await db.generatedWorlds.get(entityId.slice(0, split));
      const key = entityId.slice(split + 2);
      const renamed = readWorldRenameEdits(world?.edits ?? '[]')
        .filter((edit) => edit.key === key)
        .at(-1);
      return renamed?.name ?? key.split(':')[1] ?? 'Lugar';
    }
    const world = await db.generatedWorlds.get(entityId);
    if (world) return world.title;
    const wp = await db.worldWaypoints.get(entityId);
    if (wp) return wp.name;
    const worlds = await db.generatedWorlds.toArray();
    return worlds.flatMap((candidate) => candidate.regions ?? [])
      .find((region) => region.id === entityId)?.title ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.worldgen'),
  async navigateToEntity(entityId: string, projectId?: string) {
    const pid = projectId ?? getCurrentProjectIdFromUrl();
    if (!pid) return;
    try {
      const route = await resolveWorldgenRoute(pid, entityId);
      if (route) navigateTo(route);
    } catch (error) {
      console.warn('[worldgen] Could not resolve linked place', error);
    }
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
