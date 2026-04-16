import { Link2 } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { db } from '@/db';
import LinksEngine from './LinksEngine';

const linksEngine: EngineDefinition = {
  id: 'links',
  name: 'Links',
  description: 'External reference management',
  icon: Link2,
  category: 'core',
  tables: {
    externalLinks: 'id, projectId, type, *tags',
  },
  component: LinksEngine,
};

registerEngine(linksEngine);

registerEntityResolver({
  engineId: 'links',
  entityTypes: ['links', 'link'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const link = await db.externalLinks.get(entityId);
    if (!link) return null;
    return {
      id: link.id,
      type: entityType,
      engineId: 'links',
      title: link.title,
      subtitle: link.url,
      thumbnail: link.thumbnail,
    };
  },
  searchEntities: async (query: string) => {
    const q = query.toLowerCase();
    const rows = await db.externalLinks.filter(l => l.title.toLowerCase().includes(q)).toArray();
    return rows.map(l => ({
      id: l.id,
      type: 'link',
      engineId: 'links',
      title: l.title,
      subtitle: l.url,
      thumbnail: l.thumbnail,
    }));
  },
});

export { linksEngine };
