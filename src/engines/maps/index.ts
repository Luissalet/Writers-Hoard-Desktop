import { Map } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
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

export { mapsEngine };
