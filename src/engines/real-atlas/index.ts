import { lazy } from 'react';

// ============================================
// Real atlas — engine registration
// ============================================
//
// The story's real-world setting: places with coordinates and checked facts,
// and the deliberate departures from reality. Sibling of `maps` (pins on a
// picture) and `worldgen` (an invented planet); see ./types.ts for why it is
// its own engine rather than a worldgen preset.

import { Earth } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import {
  registerAnchorAdapter,
  navigateTo,
  getCurrentProjectIdFromUrl,
} from '@/engines/_shared/anchoring';
import { registerBackupStrategy, makeSimpleBackupStrategy, readBackupJson } from '@/engines/_shared';
import { t } from '@/i18n/useTranslation';
import { db } from '@/db';
import { getSetting, PROJECT_SETTING_PREFIXES, setSetting } from '@/db/operations';
import { parseAtlasRoutes, serializeAtlasRoutes } from './routes';
import type { AtlasDivergence, AtlasPlace } from './types';
const RealAtlasEngine = lazy(() => import('./components/RealAtlasEngine'));

const realAtlasEngine: EngineDefinition = {
  id: 'real-atlas',
  name: 'Real Atlas',
  description: 'Real-world places the book uses, and where the story departs from reality',
  icon: Earth,
  category: 'core',
  tables: {
    atlasPlaces: 'id, projectId, parentId, kind, name',
    atlasDivergences: 'id, projectId, placeId, category',
  },
  component: RealAtlasEngine,
};

registerEngine(realAtlasEngine);

function placePreview(place: AtlasPlace) {
  return {
    id: place.id,
    type: 'atlas-place',
    engineId: 'real-atlas',
    projectId: place.projectId,
    title: place.name,
    subtitle: [place.kind, place.country].filter(Boolean).join(' · '),
  };
}

function divergencePreview(row: AtlasDivergence) {
  return {
    id: row.id,
    type: 'divergence',
    engineId: 'real-atlas',
    projectId: row.projectId,
    title: row.title,
    subtitle: row.category,
  };
}

registerEntityResolver({
  engineId: 'real-atlas',
  entityTypes: ['atlas-place', 'divergence'],
  resolveEntity: async (entityId: string, entityType: string) => {
    if (entityType === 'divergence') {
      const row = await db.atlasDivergences.get(entityId);
      return row ? divergencePreview(row) : null;
    }
    const place = await db.atlasPlaces.get(entityId);
    return place ? placePreview(place) : null;
  },
  searchEntities: async (query: string, projectId?: string) => {
    const q = query.toLocaleLowerCase();
    const places = projectId
      ? db.atlasPlaces.where('projectId').equals(projectId)
      : db.atlasPlaces.toCollection();
    const rows = await places
      .filter((p) => p.name.toLocaleLowerCase().includes(q) || p.aliases.some((a) => a.toLocaleLowerCase().includes(q)))
      .toArray();
    return rows.map(placePreview);
  },
});

registerAnchorAdapter({
  engineId: 'real-atlas',
  supportsTextRange: false,
  async getEntityTitle(entityId: string) {
    const place = await db.atlasPlaces.get(entityId);
    if (place) return place.name;
    const divergence = await db.atlasDivergences.get(entityId);
    return divergence?.title ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.real-atlas'),
  navigateToEntity(entityId: string, projectId?: string) {
    const pid = projectId ?? getCurrentProjectIdFromUrl();
    if (!pid) return;
    navigateTo(`/project/${pid}/real-atlas?place=${encodeURIComponent(entityId)}`);
  },
});

// Backup: plain JSON per table under {projectDir}/real-atlas/ — nothing
// binary in either row, both scoped by projectId — plus `routes.json`, the
// project's itineraries. Routes are a per-project settings blob rather than
// a table (routes.ts says why), and project settings are otherwise left out
// of a project archive, so the strategy carries the blob itself: an
// itinerary is part of the book, not of the session.
const tableStrategy = makeSimpleBackupStrategy({
  engineId: 'real-atlas',
  tables: ['atlasPlaces', 'atlasDivergences'],
});
const routesPath = (projectDir: string) => `${projectDir}/real-atlas/routes.json`;
const routesKey = (projectId: string) => `${PROJECT_SETTING_PREFIXES.atlasRoutes}${projectId}`;

registerBackupStrategy({
  ...tableStrategy,
  // Spelled out again, after the spread that already carries them: the
  // conformance check reads this registration as TEXT (it cannot follow a
  // spread), and a human reading it deserves to see which tables this engine
  // owns without opening `tableStrategy` either. Same values, no behaviour.
  engineId: 'real-atlas',
  tables: ['atlasPlaces', 'atlasDivergences'],
  async exportProject(ctx) {
    await tableStrategy.exportProject(ctx);
    const routes = parseAtlasRoutes(await getSetting(routesKey(ctx.projectId)));
    if (routes.length) ctx.zip.file(routesPath(ctx.projectDir), JSON.stringify({ routes }, null, 2));
  },
  async preflightImport(ctx) {
    await tableStrategy.preflightImport?.(ctx);
    const blob = await readBackupJson<unknown>(ctx.zip, routesPath(ctx.projectDir));
    if (blob !== null && (!blob || typeof blob !== 'object' || !Array.isArray((blob as { routes?: unknown }).routes))) {
      throw new Error(`Expected "${routesPath(ctx.projectDir)}" to hold a { routes: [] } object.`);
    }
  },
  async importProject(ctx) {
    await tableStrategy.importProject(ctx);
    const blob = await readBackupJson<unknown>(ctx.zip, routesPath(ctx.projectDir));
    if (blob === null) return;
    // Parsed the same way the app reads them, so a malformed route in an
    // archive is dropped here rather than stored and dropped on every load.
    const routes = parseAtlasRoutes(JSON.stringify(blob));
    if (routes.length) await setSetting(routesKey(ctx.projectId), serializeAtlasRoutes(routes));
  },
});

export { realAtlasEngine };
