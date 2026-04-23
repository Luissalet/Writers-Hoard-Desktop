import { Link2 } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, readBackupJson } from '@/engines/_shared';
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

// ============================================
// Backup strategy — custom because the legacy format used `links/links.json`
// (filename doesn't match the table name), and existing user backups in the
// wild would otherwise fail to restore. Preserves the legacy path on both
// export and import so round-trips remain stable.
// ============================================
registerBackupStrategy({
  engineId: 'links',
  tables: ['externalLinks'],
  async exportProject({ zip, projectId, projectDir }) {
    const rows = await db.externalLinks.where('projectId').equals(projectId).toArray();
    if (rows.length === 0) return;
    zip.file(`${projectDir}/links/links.json`, JSON.stringify(rows, null, 2));
  },
  async importProject({ zip, projectDir }) {
    const rows = await readBackupJson<unknown[]>(zip, `${projectDir}/links/links.json`);
    if (rows?.length) await db.externalLinks.bulkAdd(rows as never[]);
  },
});

export { linksEngine };
