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
import MapsEngine from './MapsEngine';

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
    const pin = await db.mapPins.get(entityId);
    if (!pin) return null;
    return {
      id: pin.id,
      type: entityType,
      engineId: 'maps',
      title: pin.name,
      subtitle: pin.description,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.mapPins.filter(p => p.name.toLowerCase().includes(q)).toArray();
    return rows.map(p => ({
      id: p.id,
      type: 'map-pin',
      engineId: 'maps',
      title: p.name,
      subtitle: p.description,
    }));
  },
});

registerAnchorAdapter({
  engineId: 'maps',
  supportsTextRange: false,
  async getEntityTitle(entityId: string) {
    const pin = await db.mapPins.get(entityId);
    return pin?.name ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.maps'),
  navigateToEntity(entityId: string) {
    const pid = getCurrentProjectIdFromUrl();
    if (!pid) return;
    navigateTo(`/project/${pid}/maps?pin=${encodeURIComponent(entityId)}`);
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
      if (pins?.length) await db.mapPins.bulkAdd(pins as never[]);
    }
  },
});

export { mapsEngine };
