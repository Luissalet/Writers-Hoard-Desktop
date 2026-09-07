import { lazy } from 'react';
import { Map } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import {
  registerAnchorAdapter,
  navigateTo,
  getCurrentProjectIdFromUrl,
} from '@/engines/_shared/anchoring';
import {
  registerBackupStrategy,
  sanitizeBackupName,
  externalizeImage,
  internalizeImage,
  readBackupJson,
} from '@/engines/_shared';
import { t } from '@/i18n/useTranslation';
import { db } from '@/db';
const MapsEngine = lazy(() => import('./MapsEngine'));

const mapsEngine: EngineDefinition = {
  id: 'maps',
  name: 'Maps',
  description: 'World maps with pin placement',
  icon: Map,
  category: 'core',
  tables: {
    worldMaps: 'id, projectId',
    mapPins: 'id, projectId, mapId',
  },
  component: MapsEngine,
};

registerEngine(mapsEngine);

registerEntityResolver({
  engineId: 'maps',
  entityTypes: ['maps', 'map-pin'],
  resolveEntity: async (entityId: string, entityType: string) => {
    if (entityType === 'maps') {
      const map = await db.worldMaps.get(entityId);
      if (!map) return null;
      return {
        id: map.id,
        type: 'maps',
        engineId: 'maps',
        projectId: map.projectId,
        title: map.title,
        thumbnail: map.backgroundImage,
      };
    }
    const pin = await db.mapPins.get(entityId);
    if (!pin) return null;
    return {
      id: pin.id,
      type: entityType,
      engineId: 'maps',
      projectId: pin.projectId,
      title: pin.name,
      subtitle: pin.description,
    };
  },
  searchEntities: async (query: string, projectId?: string) => {
    const q = query.toLowerCase();
    // Maps as well as pins: a map is an annotatable entity in its own right,
    // so its title has to be reachable from global search too.
    const mapBase = projectId
      ? db.worldMaps.where('projectId').equals(projectId)
      : db.worldMaps.toCollection();
    const maps = await mapBase.filter(m => m.title.toLowerCase().includes(q)).toArray();
    const base = projectId
      ? db.mapPins.where('projectId').equals(projectId)
      : db.mapPins.toCollection();
    const rows = await base.filter(p => p.name.toLowerCase().includes(q)).toArray();
    return [
      ...maps.map(m => ({
        id: m.id,
        type: 'maps',
        engineId: 'maps',
        projectId: m.projectId,
        title: m.title,
        thumbnail: m.backgroundImage,
      })),
      ...rows.map(p => ({
        id: p.id,
        type: 'map-pin',
        engineId: 'maps',
        projectId: p.projectId,
        title: p.name,
        subtitle: p.description,
      })),
    ];
  },
});

registerAnchorAdapter({
  engineId: 'maps',
  supportsTextRange: false,
  // The entity can be a map or one of its pins — `AnnotationSurface` anchors
  // on the MAP (`worldMaps.id`), so resolving pins only left every backlink to
  // a map showing its raw id and navigating to a pin that does not exist.
  async getEntityTitle(entityId: string) {
    const map = await db.worldMaps.get(entityId);
    if (map) return map.title;
    const pin = await db.mapPins.get(entityId);
    return pin?.name ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.maps'),
  navigateToEntity(entityId: string, projectId?: string) {
    const pid = projectId ?? getCurrentProjectIdFromUrl();
    if (!pid) return;
    void db.worldMaps.get(entityId).then((map) => {
      const param = map ? 'map' : 'pin';
      navigateTo(`/project/${pid}/maps?${param}=${encodeURIComponent(entityId)}`);
    });
  },
});

// ============================================
// Backup strategy — preserves legacy on-disk format:
//   {projectDir}/maps/{sanitizedTitle}__{mapId}/map.json
//   {projectDir}/maps/{sanitizedTitle}__{mapId}/background.{ext}
//   {projectDir}/maps/{sanitizedTitle}__{mapId}/pins.json
// ============================================
registerBackupStrategy({
  engineId: 'maps',
  tables: ['worldMaps', 'mapPins'],
  async exportProject({ zip, projectId, projectDir }) {
    const maps = await db.worldMaps.where('projectId').equals(projectId).toArray();
    for (const map of maps) {
      const mDir = `${projectDir}/maps/${sanitizeBackupName(map.title)}__${map.id}`;
      const meta: Record<string, unknown> = { ...map };
      const bgPath = externalizeImage(zip, mDir, map.backgroundImage, 'background');
      if (bgPath) meta.backgroundImage = bgPath;

      const pins = await db.mapPins.where('mapId').equals(map.id).toArray();
      zip.file(`${mDir}/map.json`, JSON.stringify(meta, null, 2));
      if (pins.length > 0) zip.file(`${mDir}/pins.json`, JSON.stringify(pins, null, 2));
    }
  },
  async inspectImport({ zip, projectDir }) {
    const folder = `${projectDir}/maps/`;
    const dirs = new Set<string>();
    zip.forEach((path) => {
      if (!path.startsWith(folder)) return;
      const dir = path.slice(folder.length).split('/')[0];
      if (dir) dirs.add(`${folder}${dir}`);
    });
    const sections: Array<{ table: string; path: string; rows: readonly unknown[] }> = [];
    for (const dir of dirs) {
      const mapPath = `${dir}/map.json`;
      const map = await readBackupJson<unknown>(zip, mapPath);
      sections.push({ table: 'worldMaps', path: mapPath, rows: map === null ? [] : [map] });
      const pinsPath = `${dir}/pins.json`;
      const pins = await readBackupJson<unknown>(zip, pinsPath);
      if (pins !== null && !Array.isArray(pins)) {
        throw new Error(`Expected "${pinsPath}" to contain a JSON array.`);
      }
      sections.push({ table: 'mapPins', path: pinsPath, rows: pins ?? [] });
    }
    for (const table of ['worldMaps', 'mapPins']) {
      if (!sections.some((section) => section.table === table)) {
        sections.push({ table, path: folder, rows: [] });
      }
    }
    return sections;
  },
  async importProject({ zip, projectDir }) {
    const folder = `${projectDir}/maps/`;
    const dirs = new Set<string>();
    zip.forEach((path) => {
      if (path.startsWith(folder)) {
        const sub = path.slice(folder.length);
        const dir = sub.split('/')[0];
        if (dir) dirs.add(`${folder}${dir}`);
      }
    });
    for (const mDir of dirs) {
      const mapData = await readBackupJson<Record<string, unknown>>(zip, `${mDir}/map.json`);
      if (!mapData) continue;
      if (
        mapData.backgroundImage &&
        typeof mapData.backgroundImage === 'string' &&
        !mapData.backgroundImage.startsWith('data:')
      ) {
        mapData.backgroundImage =
          (await internalizeImage(zip, mDir, mapData.backgroundImage)) || undefined;
      }
      await db.worldMaps.add(mapData as never);

      const pins = await readBackupJson<Record<string, unknown>[]>(zip, `${mDir}/pins.json`);
      if (pins?.length) await db.mapPins.bulkPut(pins as never[]);
    }
  },
});

export { mapsEngine };
