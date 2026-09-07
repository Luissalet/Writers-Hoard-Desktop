import JSZip from 'jszip';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { getAllBackupStrategies } from '@/engines/_shared';
import { validateBackupScopes } from '@/engines/_shared/backupScope';
import '@/services/projectToolsBackup';
import type { Project } from '@/types';
import {
  SharedUniverseConflictError,
  bindSharedCanonEntity,
  createSharedCanonEntity,
  exportSharedUniverseArchive,
  importSharedUniverseArchive,
  linkProjectToSharedUniverse,
  previewDeleteSharedCanonEntity,
  previewSharedUniverseImport,
  resolveSharedEntity,
  updateSharedCanonEntity,
  updateSharedEntityOverride,
} from '@/services/sharedUniverse';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SERIES_ID = 'critical-shared-universe';
const BOOK_A = 'critical-shared-book-a';
const BOOK_B = 'critical-shared-book-b';

function project(id: string, type: Project['type']): Project {
  const now = Date.now();
  return {
    id,
    title: id,
    mode: 'novelist',
    type,
    color: '#c4973b',
    description: '',
    status: 'draft',
    enabledEngines: [],
    engineOrder: [],
    children: type === 'saga' ? [] : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

async function clearFixture(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await db.sharedEntityBindings.where('seriesId').equals(SERIES_ID).delete();
    await db.sharedCanonEntities.where('seriesId').equals(SERIES_ID).delete();
    await db.codexEntries.where('projectId').anyOf([BOOK_A, BOOK_B]).delete();
    await db.projects.bulkDelete([SERIES_ID, BOOK_A, BOOK_B]);
  });
}

export async function testSharedUniverse(): Promise<string> {
  if (!db.isOpen()) await db.open();
  await clearFixture();
  const now = Date.now();
  await db.projects.bulkAdd([
    project(SERIES_ID, 'saga'),
    project(BOOK_A, 'standalone'),
    project(BOOK_B, 'standalone'),
  ]);
  await db.codexEntries.bulkAdd([
    {
      id: 'shared-character-a', projectId: BOOK_A, type: 'character', title: 'Mara',
      fields: {}, content: '<p>Origin</p>', tags: ['witness'], relations: [], createdAt: now, updatedAt: now,
    },
    {
      id: 'shared-character-b', projectId: BOOK_B, type: 'character', title: 'Mara in book two',
      fields: {}, content: '<p>Local state</p>', tags: ['exile'], relations: [], createdAt: now, updatedAt: now,
    },
  ]);

  try {
    await linkProjectToSharedUniverse(BOOK_A, SERIES_ID);
    await linkProjectToSharedUniverse(BOOK_B, SERIES_ID);
    assert((await db.projects.get(BOOK_A))?.parentId === SERIES_ID, 'book membership was not written');
    assert((await db.projects.get(SERIES_ID))?.children?.length === 2, 'series inverse membership was not written');

    const { entity, binding } = await createSharedCanonEntity({
      seriesId: SERIES_ID,
      projectId: BOOK_A,
      kind: 'character',
      title: 'Mara',
      summary: 'The witness who crosses both books.',
      tags: ['witness'],
      source: {
        engineId: 'codex',
        entityType: 'character',
        entityId: 'shared-character-a',
        title: 'Mara',
      },
    });
    const bookBBinding = await bindSharedCanonEntity({
      sharedEntityId: entity.id,
      projectId: BOOK_B,
      local: {
        engineId: 'codex',
        entityType: 'character',
        entityId: 'shared-character-b',
        title: 'Mara in book two',
      },
    });
    const overridden = await updateSharedEntityOverride(bookBBinding.id, entity.version, {
      title: 'Mara, in exile',
      tags: ['exile'],
    });
    const resolved = resolveSharedEntity(entity, overridden, true);
    assert(resolved.title === 'Mara, in exile' && resolved.scope === 'override', 'local override changed no resolved state');
    assert(entity.title === 'Mara', 'local override mutated series canon');

    const changed = await updateSharedCanonEntity(entity.id, entity.version, { summary: 'Updated series truth.' });
    assert(changed.version === 2, 'shared identity version did not advance');

    const backupStrategy = getAllBackupStrategies().find((strategy) => strategy.engineId === 'project-tools');
    assert(backupStrategy, 'project-tools backup strategy is not registered');
    const backupZip = new JSZip();
    const backupProjects = [SERIES_ID, BOOK_A, BOOK_B].map((projectId) => ({
      projectId,
      projectDir: `projects/${projectId}`,
    }));
    for (const backupProject of backupProjects) {
      await backupStrategy.exportProject({ zip: backupZip, ...backupProject });
    }
    const scopeProjects = [];
    for (const backupProject of backupProjects) {
      const sections = await backupStrategy.inspectImport({ zip: backupZip, ...backupProject });
      scopeProjects.push({
        ...backupProject,
        sections: sections.map((section) => ({ ...section, engineId: backupStrategy.engineId })),
      });
    }
    const scopeIssues = await validateBackupScopes(scopeProjects, false);
    assert(scopeIssues.length === 0, `shared universe backup failed scope validation: ${scopeIssues[0]?.message}`);
    const canonFile = backupZip.file(`projects/${SERIES_ID}/project-tools/sharedCanonEntities.json`);
    assert(canonFile, 'full backup omitted shared canon identities');
    const canonRows = JSON.parse(await canonFile.async('text')) as Array<{ id?: string; seriesId?: string }>;
    assert(canonRows.length === 1 && canonRows[0]?.seriesId === SERIES_ID, 'shared canon backup escaped its saga scope');

    let conflict = false;
    try {
      await updateSharedEntityOverride(binding.id, entity.version, { title: 'Stale edit' });
    } catch (error) {
      conflict = error instanceof SharedUniverseConflictError;
    }
    assert(conflict, 'stale shared-universe edit overwrote a newer base');

    const deletionPreview = await previewDeleteSharedCanonEntity(entity.id);
    await updateSharedEntityOverride(bookBBinding.id, changed.version, { title: 'Mara after review' });
    let staleDelete = false;
    try {
      const { deleteSharedCanonEntity } = await import('@/services/sharedUniverse');
      await deleteSharedCanonEntity(deletionPreview, deletionPreview.confirmationToken);
    } catch (error) {
      staleDelete = error instanceof SharedUniverseConflictError;
    }
    assert(staleDelete, 'stale deletion preview removed shared bindings');

    const archive = await exportSharedUniverseArchive(SERIES_ID);
    assert(archive.entities.length === 1 && archive.bindings.length === 2, 'series archive lost identity or bindings');
    await deleteProject(SERIES_ID);
    assert(await db.projects.get(BOOK_B), 'deleting a saga deleted a book');
    assert(!(await db.projects.get(BOOK_B))?.parentId, 'deleting a saga did not detach its book');
    assert(await db.sharedCanonEntities.where('seriesId').equals(SERIES_ID).count() === 0, 'deleting a saga orphaned shared identities');

    const importPreview = await previewSharedUniverseImport(archive);
    await importSharedUniverseArchive(archive, importPreview, importPreview.confirmationToken);
    assert(await db.projects.get(SERIES_ID), 'series archive did not restore the saga identity');
    assert(await db.sharedEntityBindings.where('seriesId').equals(SERIES_ID).count() === 2, 'series archive did not restore bindings');
    assert((await db.projects.get(BOOK_A))?.parentId === SERIES_ID, 'series archive did not restore forward membership');
    assert((await db.projects.get(BOOK_B))?.parentId === SERIES_ID, 'series archive left inverse-only membership');

    return 'Shared universe: explicit identity, local overrides, conflicts, deletion and set backup are safe';
  } finally {
    await clearFixture();
  }
}
