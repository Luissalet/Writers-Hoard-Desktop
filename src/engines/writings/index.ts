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
    referenceDocuments: 'id, &sha256, status, updatedAt',
    referenceSections: 'id, documentId, order, *terms',
    referenceLenses: 'id, documentId, updatedAt',
    projectReferenceLinks: 'id, projectId, documentId, lensId, status, active',
    judgeRuns: 'id, projectId, writingId, mode, status, createdAt',
    judgeFindings: 'id, projectId, writingId, runId, lensId, mode, status, createdAt',
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
  navigateToEntity(entityId: string, projectId?: string) {
    const pid = projectId ?? getCurrentProjectIdFromUrl();
    if (!pid) return;
    navigateTo(`/project/${encodeURIComponent(pid)}/writings?writing=${encodeURIComponent(entityId)}`);
  },
});

// ============================================
// Backup strategy — preserves legacy on-disk format:
//   {projectDir}/writings/{sanitizedTitle}__{id}.json
// One file per writing (no folder per writing, no binaries).
// ============================================
registerBackupStrategy({
  engineId: 'writings',
  tables: [
    'writings',
    'writingSnapshots',
    'referenceDocuments',
    'referenceSections',
    'referenceLenses',
    'projectReferenceLinks',
    'judgeRuns',
    'judgeFindings',
  ],
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
    const [links, runs, findings] = await Promise.all([
      db.projectReferenceLinks.where('projectId').equals(projectId).toArray(),
      db.judgeRuns.where('projectId').equals(projectId).toArray(),
      db.judgeFindings.where('projectId').equals(projectId).toArray(),
    ]);
    zip.file(`${projectDir}/writings/_judge_links.json`, JSON.stringify(links));
    zip.file(`${projectDir}/writings/_judge_runs.json`, JSON.stringify(runs));
    zip.file(`${projectDir}/writings/_judge_findings.json`, JSON.stringify(findings));
  },
  async inspectImport({ zip, projectDir }) {
    const folder = `${projectDir}/writings/`;
    const sections: Array<{ table: string; path: string; rows: readonly unknown[] }> = [];
    const writingPaths: string[] = [];
    zip.forEach((path) => {
      const filename = path.slice(folder.length);
      if (path.startsWith(folder) && path.endsWith('.json') && !filename.startsWith('_')) {
        writingPaths.push(path);
      }
    });
    for (const path of writingPaths) {
      const writing = await readBackupJson<unknown>(zip, path);
      sections.push({ table: 'writings', path, rows: writing === null ? [] : [writing] });
    }
    if (!writingPaths.length) sections.push({ table: 'writings', path: folder, rows: [] });
    const snapshotsPath = `${folder}_snapshots.json`;
    const snapshots = await readBackupJson<unknown>(zip, snapshotsPath);
    if (snapshots !== null && !Array.isArray(snapshots)) {
      throw new Error(`Expected "${snapshotsPath}" to contain a JSON array.`);
    }
    sections.push({ table: 'writingSnapshots', path: snapshotsPath, rows: snapshots ?? [] });
    for (const [table, filename] of [
      ['projectReferenceLinks', '_judge_links.json'],
      ['judgeRuns', '_judge_runs.json'],
      ['judgeFindings', '_judge_findings.json'],
    ] as const) {
      const path = `${folder}${filename}`;
      const rows = await readBackupJson<unknown>(zip, path);
      if (rows !== null && !Array.isArray(rows)) {
        throw new Error(`Expected "${path}" to contain a JSON array.`);
      }
      sections.push({ table, path, rows: rows ?? [] });
    }
    // Personal-library rows live once at the archive root in a full backup.
    // A project archive inventories these as empty so an attacker cannot use a
    // project folder to write global data through an engine strategy.
    for (const table of ['referenceDocuments', 'referenceSections', 'referenceLenses'] as const) {
      sections.push({ table, path: `${folder}[global:${table}]`, rows: [] });
    }
    return sections;
  },
  async importProject({ zip, projectDir }) {
    const folder = `${projectDir}/writings/`;
    const files: string[] = [];
    zip.forEach((path) => {
      const filename = path.slice(folder.length);
      if (path.startsWith(folder) && path.endsWith('.json') && !filename.startsWith('_')) {
        files.push(path);
      }
    });
    for (const wf of files) {
      const writing = await readBackupJson<Record<string, unknown>>(zip, wf);
      if (writing) await db.writings.add(writing as never);
    }
    const snapshots = await readBackupJson<unknown[]>(zip, `${projectDir}/writings/_snapshots.json`);
    if (snapshots?.length) await db.writingSnapshots.bulkPut(snapshots as never[]);
    const [rawLinks, runs, findings] = await Promise.all([
      readBackupJson<import('@/services/judge/types').ProjectReferenceLink[]>(zip, `${folder}_judge_links.json`),
      readBackupJson<import('@/services/judge/types').JudgeRun[]>(zip, `${folder}_judge_runs.json`),
      readBackupJson<import('@/services/judge/types').JudgeFinding[]>(zip, `${folder}_judge_findings.json`),
    ]);
    if (rawLinks?.length) {
      const links = [];
      for (const link of rawLinks) {
        const document = await db.referenceDocuments.get(link.documentId);
        const lens = await db.referenceLenses.get(link.lensId);
        const available = Boolean(
          document
          && document.status === 'ready'
          && lens
          && lens.documentId === document.id
          && document.sha256 === link.documentHash
          && document.version === link.documentVersion,
        );
        links.push({
          ...link,
          active: available ? link.active : false,
          status: available ? 'ready' as const : 'relink-required' as const,
          ...(available && document && lens ? {
            documentName: document.name,
            lensName: lens.name,
            sectionIds: [...lens.sectionIds],
            criteria: lens.criteria.map(criterion => ({ ...criterion })),
          } : {}),
          updatedAt: Date.now(),
        });
      }
      await db.projectReferenceLinks.bulkPut(links);
    }
    if (runs?.length) await db.judgeRuns.bulkPut(runs);
    if (findings?.length) await db.judgeFindings.bulkPut(findings);
  },
});

export { writingsEngine };
