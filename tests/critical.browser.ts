import JSZip from 'jszip';
import { db } from '@/db';
import '@/engines/timeline';
import '@/engines/gallery';
import '@/engines/brainstorm';
import '@/engines/annotations';
import '@/engines/scrapper';
import '@/engines/writings';
import '@/engines/yarn-board';
import '@/services/projectToolsBackup';
import { getAllBackupStrategies } from '@/engines/_shared/backupRegistry';
import { deleteWriting } from '@/engines/writings/operations';
import { deleteYarnNode } from '@/engines/yarn-board/operations';
import {
  clearWritingRecoveryDraft,
  readWritingRecoveryDraft,
  writeWritingRecoveryDraft,
} from '@/engines/writings/recoveryJournal';
import { toLocalDateKey } from '@/engines/writing-stats/date';
import { getCurrentProjectIdFromUrl } from '@/engines/_shared/anchoring/navigation';
import { testWorldgenSpatialEntities } from './worldgen-spatial-entities';
import { testWorldgenSemanticZoom } from './worldgen-semantic-zoom';
import { runRegionInfraTests } from './worldgen-region-infra.test';
import { testWorldgenDetailShader } from './worldgen-rendering';

declare global {
  interface Window {
    __criticalResult?: {
      ok: boolean;
      tests: string[];
      error?: string;
    };
  }
}

const passed: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function testMigration(): Promise<void> {
  await db.delete();
  await db.open();
  assert(db.verno === 23, `expected schema v23, received v${db.verno}`);
  for (const table of ['entityLinks', 'citations', 'publishingProfiles', 'conversionReceipts']) {
    assert(db.tables.some(row => row.name === table), `missing migrated table ${table}`);
  }
  passed.push('Dexie migration v23');
}

async function seedBackupFixture(projectId: string): Promise<string[]> {
  const now = Date.now();
  await db.timelines.add({ id: 'timeline-1', projectId, title: 'Main', color: '#fff', createdAt: now, updatedAt: now });
  await db.timelineEvents.add({
    id: 'event-1', projectId, timelineId: 'timeline-1', title: 'Inciting event',
    description: '', date: 'Day one', dateMode: 'text', eventType: 'point',
    order: 0, lane: 'main', color: '#fff', createdAt: now, updatedAt: now,
  });
  await db.timelineConnections.add({
    id: 'timeline-link-1', projectId, timelineId: 'timeline-1',
    sourceEventId: 'event-1', targetEventId: 'event-1', color: '#fff',
    style: 'dashed', createdAt: now,
  });
  await db.imageCollections.add({ id: 'collection-empty', projectId, title: 'Empty survives', createdAt: now });
  await db.brainstormBoards.add({ id: 'brain-1', projectId, title: 'Board', createdAt: now, updatedAt: now });
  await db.brainstormItems.bulkAdd([
    { id: 'brain-item-1', projectId, boardId: 'brain-1', type: 'text', content: 'A', position: { x: 0, y: 0 }, color: '#fff', createdAt: now, updatedAt: now },
    { id: 'brain-item-2', projectId, boardId: 'brain-1', type: 'text', content: 'B', position: { x: 1, y: 1 }, color: '#fff', createdAt: now, updatedAt: now },
  ] as never[]);
  await db.brainstormConnections.add({
    id: 'brain-link-1', boardId: 'brain-1', sourceId: 'brain-item-1',
    targetId: 'brain-item-2', style: 'solid', color: '#fff',
  } as never);
  await db.annotations.add({
    id: 'annotation-1', projectId, sourceEngineId: 'writings',
    sourceEntityId: 'writing-anchor', anchor: { type: 'entity' }, noteType: 'reference',
    isOrphaned: false, position: 0, createdAt: now, updatedAt: now,
  });
  await db.annotationReferences.add({
    id: 'annotation-ref-1', annotationId: 'annotation-1',
    targetEngineId: 'timeline', targetEntityId: 'event-1', createdAt: now,
  });
  await db.snapshots.add({
    id: 'snapshot-1', projectId, url: 'https://example.com', title: 'Source',
    source: 'url', status: 'success', notes: '', tags: [], preservedAt: now,
    createdAt: now, localMediaPath: `${projectId}/snapshot-1.mp4`,
    downloadState: 'done',
  });
  await db.citations.add({
    id: 'citation-1', projectId, title: 'Source', authors: ['Writer'],
    accessedAt: '2026-07-27', writingIds: [], tags: [], createdAt: now, updatedAt: now,
  });
  return ['timeline', 'gallery', 'brainstorm', 'annotations', 'scrapper', 'project-tools'];
}

async function testBackupRoundTrip(): Promise<void> {
  const projectId = 'critical-project';
  const projectDir = `projects/Critical__${projectId}`;
  const strategyIds = await seedBackupFixture(projectId);
  const strategies = getAllBackupStrategies().filter(strategy => strategyIds.includes(strategy.engineId));
  assert(strategies.length === strategyIds.length, 'not every critical backup strategy registered');
  const zip = new JSZip();
  for (const strategy of strategies) {
    await strategy.exportProject({ zip, projectId, projectDir });
  }
  const archive = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
  const tables = [...new Set(strategies.flatMap(strategy => strategy.tables))];
  await db.transaction('rw', tables.map(name => db.table(name)), async () => {
    for (const table of tables) await db.table(table).clear();
  });
  for (const strategy of strategies) {
    await strategy.importProject({ zip: archive, projectId, projectDir });
  }
  assert(await db.timelines.get('timeline-1'), 'timeline root did not round-trip');
  assert(await db.timelineEvents.get('event-1'), 'timeline event did not round-trip');
  assert(await db.timelineConnections.get('timeline-link-1'), 'timeline connection did not round-trip');
  assert(await db.imageCollections.get('collection-empty'), 'empty Gallery collection did not round-trip');
  assert(await db.brainstormConnections.get('brain-link-1'), 'child-only brainstorm connection did not round-trip');
  assert(await db.annotationReferences.get('annotation-ref-1'), 'child-only annotation reference did not round-trip');
  const snapshot = await db.snapshots.get('snapshot-1');
  assert(snapshot && !snapshot.localMediaPath && snapshot.downloadState !== 'done', 'Scrapper restored unavailable external media as available');
  assert(await db.citations.get('citation-1'), 'project tools did not round-trip');
  passed.push('structured backup round-trip');
}

async function testCascades(): Promise<void> {
  const now = Date.now();
  await db.writings.add({
    id: 'writing-delete', projectId: 'critical-project', title: 'Delete me',
    status: 'draft', content: '<p>x</p>', wordCount: 1, tags: [],
    createdAt: now, updatedAt: now,
  });
  await db.writingSnapshots.add({
    id: 'writing-snapshot-delete', writingId: 'writing-delete',
    projectId: 'critical-project', title: 'Delete me', content: '<p>x</p>',
    wordCount: 1, reason: 'manual', createdAt: now,
  });
  await deleteWriting('writing-delete');
  assert(!(await db.writingSnapshots.get('writing-snapshot-delete')), 'writing snapshot cascade failed');

  await db.yarnBoards.add({ id: 'yarn-delete', projectId: 'critical-project', title: 'Yarn', createdAt: now, updatedAt: now });
  await db.yarnNodes.bulkAdd([
    { id: 'node-delete', projectId: 'critical-project', boardId: 'yarn-delete', type: 'text', title: 'A', content: '', color: '#fff', position: { x: 0, y: 0 } },
    { id: 'node-keep', projectId: 'critical-project', boardId: 'yarn-delete', type: 'text', title: 'B', content: '', color: '#fff', position: { x: 1, y: 1 } },
  ]);
  await db.yarnEdges.add({
    id: 'edge-delete', boardId: 'yarn-delete', sourceId: 'node-delete',
    targetId: 'node-keep', color: '#fff', style: 'solid',
  });
  await deleteYarnNode('node-delete');
  assert(!(await db.yarnEdges.get('edge-delete')), 'Yarn incident-edge cascade failed');
  passed.push('writing and Yarn cascades');
}

function testRecoveryAndNavigation(): void {
  const persisted = {
    id: 'journal-writing',
    projectId: 'critical-project',
    title: 'Persisted',
    content: '<p>old</p>',
  };
  writeWritingRecoveryDraft(
    persisted.projectId,
    persisted.id,
    'Recovered',
    '<p>new</p>',
    persisted.title,
    persisted.content,
  );
  const recovered = readWritingRecoveryDraft(persisted);
  assert(recovered?.title === 'Recovered', 'writing recovery journal did not recover a divergent draft');
  clearWritingRecoveryDraft(persisted.projectId, persisted.id);
  assert(readWritingRecoveryDraft(persisted) === null, 'writing recovery journal did not clear');

  const lateLocal = new Date(2026, 6, 27, 23, 45);
  assert(toLocalDateKey(lateLocal) === '2026-07-27', 'writing stats date key is not local-calendar based');
  window.location.hash = '#/project/project%20with%20spaces/codex';
  assert(getCurrentProjectIdFromUrl() === 'project with spaces', 'HashRouter project navigation parsing failed');
  passed.push('recovery journal, local dates, and hash navigation');
}

async function run(): Promise<void> {
  await testMigration();
  await testBackupRoundTrip();
  await testCascades();
  testRecoveryAndNavigation();
  passed.push(testWorldgenSpatialEntities());
  passed.push(testWorldgenSemanticZoom());
  await runRegionInfraTests();
  passed.push('Worldgen regional identity, coordinates, cache, and cancellation');
  passed.push(testWorldgenDetailShader());
}

void run()
  .then(() => {
    window.__criticalResult = { ok: true, tests: passed };
  })
  .catch(error => {
    window.__criticalResult = {
      ok: false,
      tests: passed,
      error: error instanceof Error ? error.stack || error.message : String(error),
    };
  })
  .finally(() => {
    void db.close();
  });
