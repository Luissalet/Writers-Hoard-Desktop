import JSZip from 'jszip';
import { db } from '@/db';
import {
  BackupOperationError,
  createProjectZipArchive,
  importFullZip,
  importProjectZip,
} from '@/services/zipBackup';
import {
  getAllBackupStrategies,
  registerBackupStrategy,
} from '@/engines/_shared/backupRegistry';

const PROJECT_A = 'zip-scope-project-a';
const PROJECT_B = 'zip-scope-project-b';
const DIARY_A = 'zip-scope-diary-a';
const DIARY_B = 'zip-scope-diary-b';
const LOCAL_ONLY_A = 'zip-scope-local-only-a';
const TIMELINE_A = 'zip-scope-timeline-a';
const TIMELINE_B = 'zip-scope-timeline-b';
const EVENT_A = 'zip-scope-event-a';
const SCENE_A = 'zip-scope-scene-a';
const SCENE_B = 'zip-scope-scene-b';
const CAST_A = 'zip-scope-cast-a';
const CAST_B = 'zip-scope-cast-b';
const WRITING_B = 'zip-scope-writing-b';
const ROLLBACK_ROW = 'zip-scope-rollback-row';
const GLOBAL_SETTING = 'zip-scope-global-setting';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function project(id: string, title: string, now: number): Record<string, unknown> {
  return {
    id,
    title,
    mode: 'novelist',
    type: 'standalone',
    color: '#7c3aed',
    description: '',
    status: 'in-progress',
    enabledEngines: [],
    engineOrder: [],
    createdAt: now,
    updatedAt: now,
  };
}

function diary(
  id: string,
  projectId: string,
  title: string,
  now: number,
): Record<string, unknown> {
  return {
    id,
    projectId,
    entryDate: '2026-09-07T10:00',
    title,
    content: `<p>${title}</p>`,
    tags: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

async function projectDirectory(zip: JSZip): Promise<string> {
  const path = Object.keys(zip.files).find((candidate) =>
    candidate.startsWith('projects/') && candidate.endsWith('/project.json'),
  );
  assert(path, 'the fixture archive contains no project.json');
  return path.slice(0, -'/project.json'.length);
}

async function archiveFile(
  source: Blob,
  mutate?: (zip: JSZip, projectDir: string) => Promise<void> | void,
): Promise<File> {
  const zip = await JSZip.loadAsync(source);
  const dir = await projectDirectory(zip);
  await mutate?.(zip, dir);
  return new File(
    [await zip.generateAsync({ type: 'blob' })],
    'zip-scope-fixture.zip',
    { type: 'application/zip' },
  );
}

async function fullArchiveFile(source: File): Promise<File> {
  const zip = await JSZip.loadAsync(source);
  const manifestFile = zip.file('manifest.json');
  assert(manifestFile, 'fixture is missing manifest.json');
  const manifest = JSON.parse(await manifestFile.async('text')) as Record<string, unknown>;
  delete manifest.singleProject;
  manifest.referenceLibrary = { included: true, originals: true };
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('reference-library.json', JSON.stringify({ documents: [], sections: [], lenses: [] }));
  zip.file('settings.json', '[]');
  zip.file('tags.json', '[]');
  zip.file('notes-inbox.json', '[]');
  return new File(
    [await zip.generateAsync({ type: 'blob' })],
    'zip-scope-full-fixture.zip',
    { type: 'application/zip' },
  );
}

async function rowsAt(zip: JSZip, path: string): Promise<Record<string, unknown>[]> {
  const file = zip.file(path);
  assert(file, `fixture is missing ${path}`);
  const rows = JSON.parse(await file.async('text')) as unknown;
  assert(Array.isArray(rows), `fixture ${path} is not an array`);
  return rows as Record<string, unknown>[];
}

async function expectPreflightRefusal(file: File, label: string): Promise<void> {
  let error: unknown;
  try {
    await importProjectZip(file, { replaceProjectIds: [PROJECT_A] });
  } catch (cause) {
    error = cause;
  }
  assert(error instanceof BackupOperationError, `${label}: import did not return a structured backup error`);
  assert(error.phase === 'preflight', `${label}: unsafe archive reached the write transaction`);
  assert(
    error.failures.some((failure) =>
      failure.projectId === PROJECT_A
      && typeof failure.engineId === 'string'
      && failure.path?.startsWith('projects/')),
    `${label}: refusal did not identify the failing archive section`,
  );
}

async function expectFullPreflightRefusal(file: File, label: string): Promise<void> {
  let error: unknown;
  try {
    await importFullZip(file);
  } catch (cause) {
    error = cause;
  }
  assert(error instanceof BackupOperationError, `${label}: full import did not return a structured backup error`);
  assert(error.phase === 'preflight', `${label}: unsafe full archive reached the clear transaction`);
  assert(
    error.failures.some((failure) => failure.projectId === PROJECT_A && failure.path?.startsWith('projects/')),
    `${label}: full-import refusal did not identify the failing project section`,
  );
}

async function assertLocalProjectsUntouched(label: string): Promise<void> {
  assert(
    (await db.projects.get(PROJECT_A))?.title === 'Local A must survive',
    `${label}: rejecting the archive partially replaced project A`,
  );
  assert(
    (await db.diaryEntries.get(DIARY_A))?.title === 'Local A diary must survive',
    `${label}: rejecting the archive rewrote project A`,
  );
  assert(
    Boolean(await db.diaryEntries.get(LOCAL_ONLY_A)),
    `${label}: rejecting the archive partially cleared project A`,
  );
  const b = await db.diaryEntries.get(DIARY_B);
  assert(
    b?.projectId === PROJECT_B && b.title === 'Project B diary must survive',
    `${label}: rejecting the archive modified project B`,
  );
  const cast = await db.sceneCasts.get(CAST_B);
  assert(
    cast?.sceneId === SCENE_B && cast.characterName === 'Project B cast',
    `${label}: rejecting the archive modified a project-B child row`,
  );
  assert(
    (await db.timelines.get(TIMELINE_B))?.title === 'Timeline B',
    `${label}: rejecting the archive modified project B's parent row`,
  );
}

async function seedFixture(): Promise<{ blob: Blob; now: number }> {
  const now = Date.now();
  await db.projects.bulkPut([
    project(PROJECT_A, 'Archived A', now),
    project(PROJECT_B, 'Project B', now),
  ] as never[]);
  await db.diaryEntries.bulkPut([
    diary(DIARY_A, PROJECT_A, 'Archived A diary', now),
    diary(DIARY_B, PROJECT_B, 'Project B diary must survive', now),
  ] as never[]);
  await db.timelines.bulkPut([
    { id: TIMELINE_A, projectId: PROJECT_A, title: 'Timeline A', color: '#fff', createdAt: now, updatedAt: now },
    { id: TIMELINE_B, projectId: PROJECT_B, title: 'Timeline B', color: '#fff', createdAt: now, updatedAt: now },
  ]);
  await db.timelineEvents.put({
    id: EVENT_A,
    projectId: PROJECT_A,
    timelineId: TIMELINE_A,
    title: 'Event A',
    description: '',
    date: 'Day one',
    dateMode: 'text',
    eventType: 'point',
    order: 0,
    lane: 'main',
    color: '#fff',
    createdAt: now,
    updatedAt: now,
  });
  await db.scenes.bulkPut([
    { id: SCENE_A, projectId: PROJECT_A, title: 'Scene A', order: 0, tags: [], createdAt: now, updatedAt: now },
    { id: SCENE_B, projectId: PROJECT_B, title: 'Scene B', order: 0, tags: [], createdAt: now, updatedAt: now },
  ]);
  await db.sceneCasts.bulkPut([
    { id: CAST_A, sceneId: SCENE_A, characterName: 'Project A cast', color: '#fff' },
    { id: CAST_B, sceneId: SCENE_B, characterName: 'Project B cast', color: '#fff' },
  ]);
  await db.writings.put({
    id: WRITING_B,
    projectId: PROJECT_B,
    title: 'Project B chapter',
    status: 'draft',
    content: '<p>Private to B</p>',
    wordCount: 3,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await db.settings.put({ id: GLOBAL_SETTING, key: GLOBAL_SETTING, value: 'must survive' });

  const archive = await createProjectZipArchive(PROJECT_A);
  await db.projects.update(PROJECT_A, { title: 'Local A must survive', updatedAt: now + 1 });
  await db.diaryEntries.update(DIARY_A, { title: 'Local A diary must survive', updatedAt: now + 1 });
  await db.diaryEntries.put(diary(LOCAL_ONLY_A, PROJECT_A, 'Local-only A row', now + 1) as never);
  return { blob: archive.blob, now };
}

async function cleanFixture(): Promise<void> {
  const projectIds = [PROJECT_A, PROJECT_B];
  for (const table of db.tables) {
    const hasProjectId = table.schema.primKey.name === 'projectId' || Boolean(table.schema.idxByName.projectId);
    if (hasProjectId) await table.where('projectId').anyOf(projectIds).delete();
  }
  await db.sceneCasts.bulkDelete([CAST_A, CAST_B]);
  await db.projects.bulkDelete(projectIds);
  await db.diaryEntries.delete(ROLLBACK_ROW);
  await db.settings.delete(GLOBAL_SETTING);
}

/**
 * Regression fixture for a project-A ZIP carrying project-B rows and links.
 * Every refusal is exercised as an approved replacement: if preflight is even
 * one write late, the assertions observe project A being cleared.
 */
export async function testZipBackupScopeGuards(): Promise<string[]> {
  await cleanFixture();
  const { blob, now } = await seedFixture();
  try {
    const foreignProjectRow = await archiveFile(blob, async (zip, dir) => {
      const path = `${dir}/diary/diaryEntries.json`;
      const rows = await rowsAt(zip, path);
      rows.push(diary(DIARY_B, PROJECT_B, 'Archive tried to own B', now));
      zip.file(path, JSON.stringify(rows));
    });
    await expectPreflightRefusal(foreignProjectRow, 'foreign projectId row');
    await assertLocalProjectsUntouched('foreign projectId row');

    const hostileFullArchive = await fullArchiveFile(foreignProjectRow);
    await expectFullPreflightRefusal(hostileFullArchive, 'foreign row in full restore');
    await assertLocalProjectsUntouched('foreign row in full restore');
    assert(
      (await db.settings.get(GLOBAL_SETTING))?.value === 'must survive',
      'rejecting a full archive partially cleared global tables',
    );

    const disguisedIdCollision = await archiveFile(blob, async (zip, dir) => {
      const path = `${dir}/diary/diaryEntries.json`;
      const rows = await rowsAt(zip, path);
      rows.push(diary(DIARY_B, PROJECT_A, 'Archive disguised B as A', now));
      zip.file(path, JSON.stringify(rows));
    });
    await expectPreflightRefusal(disguisedIdCollision, 'foreign primary-key collision');
    await assertLocalProjectsUntouched('foreign primary-key collision');

    const customStrategyLink = await archiveFile(blob, async (zip, dir) => {
      const path = `${dir}/timeline/timelineEvents.json`;
      const rows = await rowsAt(zip, path);
      rows[0] = { ...rows[0], timelineId: TIMELINE_B };
      zip.file(path, JSON.stringify(rows));
    });
    await expectPreflightRefusal(customStrategyLink, 'custom strategy parent link');
    await assertLocalProjectsUntouched('custom strategy parent link');

    const childOnlyCollision = await archiveFile(blob, async (zip, dir) => {
      const path = `${dir}/dialog-scene/sceneCasts.json`;
      const rows = await rowsAt(zip, path);
      rows.push({ id: CAST_B, sceneId: SCENE_B, characterName: 'Archive cast', color: '#000' });
      zip.file(path, JSON.stringify(rows));
    });
    await expectPreflightRefusal(childOnlyCollision, 'child-only custom strategy row');
    await assertLocalProjectsUntouched('child-only custom strategy row');

    const crossProjectEntityLink = await archiveFile(blob, (zip, dir) => {
      const path = `${dir}/project-tools/entityLinks.json`;
      zip.file(path, JSON.stringify([{
        id: 'zip-scope-cross-project-link',
        projectId: PROJECT_A,
        sourceEngineId: 'diary',
        sourceEntityType: 'diary-entry',
        sourceEntityId: DIARY_A,
        sourceTitle: 'A diary',
        targetEngineId: 'writings',
        targetEntityType: 'writing',
        targetEntityId: WRITING_B,
        targetTitle: 'B chapter',
        relation: 'references',
        provenance: 'manual',
        createdAt: now,
        updatedAt: now,
      }]));
    });
    await expectPreflightRefusal(crossProjectEntityLink, 'cross-project entity link');
    await assertLocalProjectsUntouched('cross-project entity link');

    const cleanArchive = await archiveFile(blob);
    const originalDiary = getAllBackupStrategies().find((strategy) => strategy.engineId === 'diary');
    assert(originalDiary, 'the diary backup strategy is not registered');
    registerBackupStrategy({
      ...originalDiary,
      async importProject(context) {
        await originalDiary.importProject(context);
        await db.diaryEntries.put(diary(ROLLBACK_ROW, PROJECT_A, 'Must roll back', now) as never);
        throw new Error('Injected restore failure after a strategy write');
      },
    });
    try {
      let failed = false;
      try {
        await importProjectZip(cleanArchive, { replaceProjectIds: [PROJECT_A] });
      } catch (error) {
        failed = error instanceof BackupOperationError && error.phase === 'import';
      }
      assert(failed, 'the injected strategy failure did not abort the replacement');
      await assertLocalProjectsUntouched('transaction rollback');
      assert(!(await db.diaryEntries.get(ROLLBACK_ROW)), 'the failed strategy write escaped rollback');
    } finally {
      registerBackupStrategy(originalDiary);
    }

    const legacyArchive = await archiveFile(blob, async (zip) => {
      const manifestFile = zip.file('manifest.json');
      assert(manifestFile, 'fixture is missing manifest.json');
      const manifest = JSON.parse(await manifestFile.async('text')) as Record<string, unknown>;
      manifest.version = 1;
      zip.file('manifest.json', JSON.stringify(manifest));
    });
    await importProjectZip(legacyArchive, { replaceProjectIds: [PROJECT_A] });
    assert(
      (await db.projects.get(PROJECT_A))?.title === 'Archived A'
        && (await db.diaryEntries.get(DIARY_A))?.title === 'Archived A diary',
      'a structurally valid legacy ZIP no longer restores',
    );
    const b = await db.diaryEntries.get(DIARY_B);
    assert(
      b?.projectId === PROJECT_B && b.title === 'Project B diary must survive',
      'the valid legacy restore changed project B',
    );

    return [
      'ZIP scope preflight rejects foreign rows, disguised IDs and custom-strategy links before replacement; transaction rollback and legacy restore remain intact',
    ];
  } finally {
    await cleanFixture();
  }
}
