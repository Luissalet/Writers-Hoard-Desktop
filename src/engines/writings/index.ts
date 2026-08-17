import { lazy } from 'react';
import { PenLine } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import {
  registerAnchorAdapter,
  htmlToText,
  navigateTo,
  getCurrentProjectIdFromUrl,
} from '@/engines/_shared/anchoring';
import {
  registerBackupStrategy,
  sanitizeBackupName,
  readBackupJson,
} from '@/engines/_shared';
import { t } from '@/i18n/useTranslation';
import { db } from '@/db';
const WritingsEngine = lazy(() => import('./WritingsEngine'));

const writingsEngine: EngineDefinition = {
  id: 'writings',
  name: 'Writings',
  description: 'Write and manage drafts, chapters, and manuscripts',
  icon: PenLine,
  category: 'core',
  tables: {
    writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
    writingSnapshots: 'id, writingId, projectId, createdAt',
  },
  component: WritingsEngine,
};

registerEngine(writingsEngine);

registerEntityResolver({
  engineId: 'writings',
  entityTypes: ['writings', 'writing'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const writing = await db.writings.get(entityId);
    if (!writing) return null;
    return {
      id: writing.id,
      type: entityType,
      engineId: 'writings',
      projectId: writing.projectId,
      title: writing.title,
      subtitle: writing.status,
    };
  },
  searchEntities: async (query: string, projectId?: string) => {
    const q = query.toLowerCase();
    // Acotar antes de filtrar (contrato en `_shared/entityResolverRegistry.ts`).
    // El más caro de los once: cada fila arrastra el HTML del manuscrito.
    const base = projectId
      ? db.writings.where('projectId').equals(projectId)
      : db.writings.toCollection();
    const rows = await base.filter(w => w.title.toLowerCase().includes(q)).toArray();
    return rows.map(w => ({
      id: w.id,
      type: 'writing',
      engineId: 'writings',
      projectId: w.projectId,
      title: w.title,
      subtitle: w.status,
    }));
  },
});

registerAnchorAdapter({
  engineId: 'writings',
  supportsTextRange: true,
  async getEntityText(entityId: string) {
    const writing = await db.writings.get(entityId);
    if (!writing) return null;
    return htmlToText(writing.content);
  },
  async getEntityTitle(entityId: string) {
    const writing = await db.writings.get(entityId);
    return writing?.title ?? null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.writings'),
  navigateToEntity(entityId: string) {
    const pid = getCurrentProjectIdFromUrl();
    if (!pid) return;
    navigateTo(`/project/${pid}/writings?writing=${encodeURIComponent(entityId)}`);
  },
});

// ============================================
// Backup strategy — preserves legacy on-disk format:
//   {projectDir}/writings/{sanitizedTitle}__{id}.json
// One file per writing (no folder per writing, no binaries).
// ============================================
registerBackupStrategy({
  engineId: 'writings',
  tables: ['writings', 'writingSnapshots'],
  async exportProject({ zip, projectId, projectDir }) {
    const rows = await db.writings.where('projectId').equals(projectId).toArray();
    for (const writing of rows) {
      const filename = `${sanitizeBackupName(writing.title)}__${writing.id}.json`;
      zip.file(`${projectDir}/writings/${filename}`, JSON.stringify(writing, null, 2));
    }
    // Version history — one compact file for the whole project.
    const snapshots = await db.writingSnapshots.where('projectId').equals(projectId).toArray();
    if (snapshots.length > 0) {
      zip.file(`${projectDir}/writings/_snapshots.json`, JSON.stringify(snapshots));
    }
  },
  async importProject({ zip, projectDir }) {
    const folder = `${projectDir}/writings/`;
    const files: string[] = [];
    zip.forEach((path) => {
      if (path.startsWith(folder) && path.endsWith('.json') && !path.endsWith('/_snapshots.json')) {
        files.push(path);
      }
    });
    for (const wf of files) {
      const writing = await readBackupJson<Record<string, unknown>>(zip, wf);
      if (writing) await db.writings.add(writing as never);
    }
    const snapshots = await readBackupJson<unknown[]>(zip, `${projectDir}/writings/_snapshots.json`);
    if (snapshots?.length) await db.writingSnapshots.bulkAdd(snapshots as never[]);
  },
});

export { writingsEngine };
