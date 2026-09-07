import { db } from '@/db';
import { registerEntityResolver } from '@/engines/_shared/entityResolverRegistry';
import {
  ProjectHealthRepairError,
  executeProjectHealthRepairWithBackup,
  previewProjectHealthRepair,
  scanProjectProvenance,
  type ProjectRepairBackupReceipt,
} from '@/services/projectHealthRecovery';

registerEntityResolver({
  engineId: 'writings',
  entityTypes: ['writing', 'writings'],
  async resolveEntity(entityId, entityType) {
    const row = await db.writings.get(entityId);
    return row ? {
      id: row.id,
      type: entityType,
      engineId: 'writings',
      projectId: row.projectId,
      title: row.title,
    } : null;
  },
  async searchEntities() {
    return [];
  },
});

const PROJECT_A = 'health-recovery-project-a';
const PROJECT_B = 'health-recovery-project-b';
const WRITING_A = 'health-recovery-writing-a';
const WRITING_B = 'health-recovery-writing-b';
const BEAT_A = 'health-recovery-beat-a';
const LINK_A = 'health-recovery-link-a';
const CITATION_A = 'health-recovery-citation-a';
const RECEIPT_A = 'health-recovery-receipt-a';
const ORPHAN_CAST = 'health-recovery-orphan-cast';
const LIVING_CAST = 'health-recovery-living-cast';
const SCENE_B = 'health-recovery-scene-b';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectRepairError(
  code: ProjectHealthRepairError['code'],
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof ProjectHealthRepairError, `expected ${code}, received a generic error`);
    assert(error.code === code, `expected ${code}, received ${error.code}`);
    return;
  }
  throw new Error(`expected repair to fail with ${code}`);
}

async function cleanup(): Promise<void> {
  await db.outlineBeats.delete(BEAT_A);
  await db.outlines.delete('health-recovery-outline-a');
  await db.entityLinks.delete(LINK_A);
  await db.citations.delete(CITATION_A);
  await db.conversionReceipts.delete(RECEIPT_A);
  await db.sceneCasts.bulkDelete([ORPHAN_CAST, LIVING_CAST]);
  await db.scenes.delete(SCENE_B);
  await db.writings.bulkDelete([WRITING_A, WRITING_B]);
  await db.projects.bulkDelete([PROJECT_A, PROJECT_B]);
}

async function seed(): Promise<void> {
  const now = 1_788_768_000_000;
  await db.projects.bulkPut([
    {
      id: PROJECT_A, title: 'Health A', mode: 'novelist', type: 'standalone',
      color: '#7c3aed', description: '', status: 'in-progress', enabledEngines: [],
      engineOrder: [], createdAt: now, updatedAt: now,
    },
    {
      id: PROJECT_B, title: 'Health B', mode: 'novelist', type: 'standalone',
      color: '#2563eb', description: '', status: 'in-progress', enabledEngines: [],
      engineOrder: [], createdAt: now, updatedAt: now,
    },
  ]);
  await db.writings.bulkPut([
    {
      id: WRITING_A, projectId: PROJECT_A, title: 'A', status: 'draft',
      content: '<p>A</p>', wordCount: 1, tags: [], createdAt: now, updatedAt: now,
    },
    {
      id: WRITING_B, projectId: PROJECT_B, title: 'B must survive', status: 'draft',
      content: '<p>B</p>', wordCount: 1, tags: [], createdAt: now, updatedAt: now,
    },
  ]);
  await db.outlines.put({
    id: 'health-recovery-outline-a', projectId: PROJECT_A, title: 'Outline',
    createdAt: now, updatedAt: now,
  });
  await db.outlineBeats.put({
    id: BEAT_A, outlineId: 'health-recovery-outline-a', projectId: PROJECT_A,
    order: 0, level: 'beat', title: 'Broken link', description: '', status: 'outlined',
    linkedWritingId: WRITING_B, createdAt: now, updatedAt: now,
  });
  await db.entityLinks.put({
    id: LINK_A, projectId: PROJECT_A,
    sourceEngineId: 'writings', sourceEntityType: 'writing', sourceEntityId: WRITING_A,
    sourceTitle: 'A', targetEngineId: 'writings', targetEntityType: 'writing',
    targetEntityId: WRITING_B, targetTitle: 'B', relation: 'references',
    provenance: 'manual', createdAt: now, updatedAt: now,
  });
  await db.citations.put({
    id: CITATION_A, projectId: PROJECT_A, title: 'Citation', authors: [],
    accessedAt: '2026-09-07', writingIds: [WRITING_A, WRITING_B], tags: [],
    createdAt: now, updatedAt: now,
  });
  await db.conversionReceipts.put({
    id: RECEIPT_A, projectId: PROJECT_A, sourceEngineId: 'writings',
    sourceEntityId: WRITING_A, targetEngineId: 'writings', targetEntityId: WRITING_B,
    targetTable: 'writings', preview: 'conversion', undoPayload: {}, createdAt: now,
    undoneAt: now + 1,
  });
  await db.scenes.put({
    id: SCENE_B, projectId: PROJECT_B, title: 'B scene', setting: '', synopsis: '',
    status: 'draft', order: 0, createdAt: now, updatedAt: now,
  });
  await db.sceneCasts.bulkPut([
    { id: ORPHAN_CAST, sceneId: 'health-recovery-missing-scene', characterName: 'Orphan', color: '#000' },
    { id: LIVING_CAST, sceneId: SCENE_B, characterName: 'B cast', color: '#fff' },
  ]);
}

function backupReceipt(sequence: number): ProjectRepairBackupReceipt {
  return { kind: 'full-archive', createdAt: 1_788_768_000_000 + sequence, sizeBytes: 2048 };
}

export async function testProjectHealthRecovery(): Promise<string[]> {
  await cleanup();
  await seed();
  try {
    const aborted = new AbortController();
    aborted.abort();
    try {
      await scanProjectProvenance(PROJECT_A, { signal: aborted.signal });
      throw new Error('an aborted provenance scan completed');
    } catch (error) {
      assert(error instanceof DOMException && error.name === 'AbortError', 'scan cancellation was not explicit');
    }

    const provenance = await scanProjectProvenance(PROJECT_A);
    assert(provenance.status === 'issues', 'cross-project provenance was reported as healthy');
    assert(provenance.totals.records === 3, 'provenance inventory lost a record');
    assert(provenance.totals.broken === 3, 'provenance inventory missed a broken or cross-project record');
    assert(
      provenance.findings.some(row => row.id === 'broken-entity-links' && row.repairable),
      'broken entity links were not offered as a guided repair',
    );
    assert(
      provenance.findings.some(row => row.id === 'broken-conversion-provenance' && !row.repairable),
      'conversion history was offered for destructive automatic repair',
    );
    const serializedReport = JSON.stringify(provenance);
    assert(!serializedReport.includes('B must survive'), 'health inventory exposed entity content');
    assert(!serializedReport.includes(WRITING_B), 'health inventory exposed entity ids');

    const preview = await previewProjectHealthRepair(PROJECT_A, 'broken-spine-links');
    assert(preview.count === 1 && preview.scope === 'project', 'repair preview has the wrong scope');
    assert(
      (await db.outlineBeats.get(BEAT_A))?.linkedWritingId === WRITING_B,
      'preview mutated the broken link',
    );

    let backups = 0;
    await expectRepairError('confirmation-required', () => executeProjectHealthRepairWithBackup(
      { ...preview, confirmationToken: 'not-the-preview-token' },
      async () => {
        backups++;
        return backupReceipt(backups);
      },
    ));
    assert(backups === 0, 'invalid confirmation started a backup');
    assert((await db.outlineBeats.get(BEAT_A))?.linkedWritingId === WRITING_B, 'invalid confirmation changed data');

    await expectRepairError('backup-failed', () => executeProjectHealthRepairWithBackup(
      preview,
      async () => {
        backups++;
        throw new Error('disk full');
      },
    ));
    assert((await db.outlineBeats.get(BEAT_A))?.linkedWritingId === WRITING_B, 'backup failure changed data');

    await expectRepairError('backup-failed', () => executeProjectHealthRepairWithBackup(
      preview,
      async () => ({ ...backupReceipt(++backups), sizeBytes: 0 }),
    ));
    assert(
      (await db.outlineBeats.get(BEAT_A))?.linkedWritingId === WRITING_B,
      'an empty backup receipt authorized a repair',
    );

    await db.outlineBeats.update(BEAT_A, { linkedWritingId: 'health-recovery-another-missing-writing' });
    await expectRepairError('stale-preview', () => executeProjectHealthRepairWithBackup(
      preview,
      async () => {
        backups++;
        return backupReceipt(backups);
      },
    ));
    assert(
      (await db.outlineBeats.get(BEAT_A))?.linkedWritingId === 'health-recovery-another-missing-writing',
      'a stale preview changed data',
    );

    const preBackupRace = await previewProjectHealthRepair(PROJECT_A, 'broken-spine-links');
    await expectRepairError('stale-preview', () => executeProjectHealthRepairWithBackup(
      preBackupRace,
      async () => {
        backups++;
        await db.outlineBeats.update(BEAT_A, {
          linkedWritingId: 'health-recovery-changed-during-backup',
        });
        return backupReceipt(backups);
      },
    ));
    assert(
      (await db.outlineBeats.get(BEAT_A))?.linkedWritingId
        === 'health-recovery-changed-during-backup',
      'the post-backup stale check overwrote newer data',
    );

    const fresh = await previewProjectHealthRepair(PROJECT_A, 'broken-spine-links');
    const result = await executeProjectHealthRepairWithBackup(fresh, async () => {
      backups++;
      assert(
        (await db.outlineBeats.get(BEAT_A))?.linkedWritingId
          === 'health-recovery-changed-during-backup',
        'repair mutated data before its safety backup completed',
      );
      return backupReceipt(backups);
    });
    assert(result.repaired === 1, 'confirmed repair returned the wrong count');
    assert((await db.outlineBeats.get(BEAT_A))?.linkedWritingId === undefined, 'confirmed repair did not apply');
    assert((await db.writings.get(WRITING_B))?.projectId === PROJECT_B, 'repair crossed into project B');

    const linkPreview = await previewProjectHealthRepair(PROJECT_A, 'broken-entity-links');
    await db.entityLinks.update(LINK_A, {
      targetEntityId: 'health-recovery-another-missing-entity',
    });
    const backupsBeforeStaleDelete = backups;
    await expectRepairError('stale-preview', () => executeProjectHealthRepairWithBackup(
      linkPreview,
      async () => backupReceipt(++backups),
    ));
    assert(backups === backupsBeforeStaleDelete, 'a stale delete preview started a backup');
    assert(await db.entityLinks.get(LINK_A), 'a stale delete preview removed its row');

    const freshLinkPreview = await previewProjectHealthRepair(PROJECT_A, 'broken-entity-links');
    await executeProjectHealthRepairWithBackup(
      freshLinkPreview,
      async () => backupReceipt(++backups),
    );
    assert(!(await db.entityLinks.get(LINK_A)), 'broken entity-link repair left the invalid provenance row');

    const citationPreview = await previewProjectHealthRepair(PROJECT_A, 'broken-citations');
    await executeProjectHealthRepairWithBackup(citationPreview, async () => backupReceipt(++backups));
    assert(
      JSON.stringify((await db.citations.get(CITATION_A))?.writingIds) === JSON.stringify([WRITING_A]),
      'citation repair did not preserve the valid project-A reference',
    );

    const globalPreview = await previewProjectHealthRepair(PROJECT_A, 'orphan-scene-casts');
    assert(globalPreview.scope === 'application' && globalPreview.count === 1, 'global orphan scope was hidden');
    await executeProjectHealthRepairWithBackup(globalPreview, async () => backupReceipt(++backups));
    assert(!(await db.sceneCasts.get(ORPHAN_CAST)), 'global orphan was not repaired');
    assert(await db.sceneCasts.get(LIVING_CAST), 'global repair removed another project\'s living row');

    return [
      'Project Health & Recovery inventories provenance and gates scoped repairs behind preview, confirmation, backup, stale checks, and transactions',
    ];
  } finally {
    await cleanup();
  }
}
