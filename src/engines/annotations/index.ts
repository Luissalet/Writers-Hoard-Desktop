import { lazy } from 'react';

// ============================================
// Annotations engine — registration
// ============================================
//
// Cross-cutting engine #22. Owns two tables (`annotations` +
// `annotationReferences`) and exposes a project-level dashboard. The actual
// authoring UI (margin panel) is mounted *inside* annotatable engines via
// the `<MarginPanel>` component, not on this engine's tab.

import { MessageSquare } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine } from '@/engines/_registry';
import { registerBackupStrategy, readBackupJson } from '@/engines/_shared';
import { db } from '@/db';
const AnnotationsEngine = lazy(() => import('./components/AnnotationsEngine'));
import AnnotationsSidebarBadge from './components/AnnotationsSidebarBadge';

const annotationsEngine: EngineDefinition = {
  id: 'annotations',
  name: 'Interconnectedness',
  description: 'Margin notes that link writing to characters, seeds, maps, and more.',
  icon: MessageSquare,
  category: 'planning',
  tables: {
    annotations:
      'id, projectId, sourceEngineId, sourceEntityId, isOrphaned, noteType, updatedAt, [sourceEngineId+sourceEntityId]',
    annotationReferences:
      'id, &annotationId, targetEngineId, targetEntityId, [targetEngineId+targetEntityId]',
  },
  component: AnnotationsEngine,
  SidebarBadge: AnnotationsSidebarBadge,
};

registerEngine(annotationsEngine);

const ANNOTATION_TABLES = ['annotations', 'annotationReferences'] as const;

async function readAnnotationRows(
  zip: Parameters<typeof readBackupJson>[0],
  path: string,
): Promise<unknown[] | null> {
  const rows = await readBackupJson<unknown>(zip, path);
  if (rows !== null && !Array.isArray(rows)) {
    throw new Error(`Expected "${path}" to contain a JSON array.`);
  }
  return rows;
}

// References are child-only rows keyed by annotationId. Resolve the owning
// annotations first so a project backup never includes another project's
// backlinks and never drops its own.
registerBackupStrategy({
  engineId: 'annotations',
  tables: [...ANNOTATION_TABLES],
  async exportProject({ zip, projectId, projectDir }) {
    const annotations = await db.annotations
      .where('projectId')
      .equals(projectId)
      .toArray();
    const annotationIds = annotations.map((annotation) => annotation.id);
    const references = annotationIds.length
      ? await db.annotationReferences
          .where('annotationId')
          .anyOf(annotationIds)
          .toArray()
      : [];
    const folder = `${projectDir}/annotations`;
    zip.file(`${folder}/annotations.json`, JSON.stringify(annotations, null, 2));
    zip.file(
      `${folder}/annotationReferences.json`,
      JSON.stringify(references, null, 2),
    );
  },
  async preflightImport({ zip, projectDir }) {
    for (const table of ANNOTATION_TABLES) {
      await readAnnotationRows(zip, `${projectDir}/annotations/${table}.json`);
    }
  },
  async inspectImport({ zip, projectDir }) {
    return Promise.all(ANNOTATION_TABLES.map(async (table) => {
      const path = `${projectDir}/annotations/${table}.json`;
      return { table, path, rows: await readAnnotationRows(zip, path) ?? [] };
    }));
  },
  async importProject({ zip, projectDir }) {
    const folder = `${projectDir}/annotations`;
    const annotations = await readAnnotationRows(
      zip,
      `${folder}/annotations.json`,
    );
    const references = await readAnnotationRows(
      zip,
      `${folder}/annotationReferences.json`,
    );
    if (annotations?.length) await db.annotations.bulkPut(annotations as never[]);
    if (references?.length) {
      await db.annotationReferences.bulkPut(references as never[]);
    }
  },
});

export { annotationsEngine };
