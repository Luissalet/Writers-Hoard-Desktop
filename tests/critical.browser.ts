import JSZip from 'jszip';
import { db } from '@/db';
import '@/engines/timeline';
import '@/engines/gallery';
import '@/engines/board';
import '@/engines/annotations';
import '@/engines/scrapper';
import '@/engines/writings';
import '@/services/projectToolsBackup';
import { getAllBackupStrategies } from '@/engines/_shared/backupRegistry';
import { deleteWriting } from '@/engines/writings/operations';
import { deleteBoardNode } from '@/engines/board/operations';
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
  assert(db.verno === 24, `expected schema v24, received v${db.verno}`);
  for (const table of [
    'entityLinks', 'citations', 'publishingProfiles', 'conversionReceipts',
    'boards', 'boardNodes', 'boardEdges', 'boardLayers', 'boardViews',
  ]) {
    assert(db.tables.some(row => row.name === table), `missing migrated table ${table}`);
  }
  // The two engines `board` replaced must be gone, not merely unused: a
  // leftover store is a leftover code path waiting to be revived by accident.
  for (const retired of [
    'yarnBoards', 'yarnNodes', 'yarnEdges',
    'brainstormBoards', 'brainstormItems', 'brainstormConnections',
  ]) {
    assert(!db.tables.some(row => row.name === retired), `retired table ${retired} still exists`);
  }
  passed.push('Dexie migration v24');
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
  await db.boards.add({ id: 'board-1', projectId, title: 'Board', surface: 'cork', createdAt: now, updatedAt: now });
  await db.boardNodes.bulkAdd([
    { id: 'board-node-1', projectId, boardId: 'board-1', kind: 'card', title: 'A', content: '', color: '#fff', position: { x: 0, y: 0 }, size: { width: 200, height: 120 }, zIndex: 0, tags: [], createdAt: now, updatedAt: now },
    { id: 'board-node-2', projectId, boardId: 'board-1', kind: 'card', title: 'B', content: '', color: '#fff', position: { x: 1, y: 1 }, size: { width: 200, height: 120 }, zIndex: 0, tags: [], createdAt: now, updatedAt: now },
    { id: 'board-node-3', projectId, boardId: 'board-1', kind: 'card', title: 'C', content: '', color: '#fff', position: { x: 2, y: 2 }, size: { width: 200, height: 120 }, zIndex: 0, tags: [], createdAt: now, updatedAt: now },
  ]);
  // A hyper-edge plus a relation anchored on that relation: the two shapes
  // React Flow cannot express, and the two the backup must round-trip.
  await db.boardEdges.bulkAdd([
    {
      id: 'board-edge-1', projectId, boardId: 'board-1',
      sourceId: 'board-node-1', targetId: 'board-node-3',
      sources: [{ id: 'board-node-1', on: 'node' }, { id: 'board-node-2', on: 'node' }],
      targets: [{ id: 'board-node-3', on: 'node' }],
      kind: 'causes', color: '#fff', style: 'solid', width: 0, direction: 'forward',
      curvature: 'curved', weight: 1, certainty: 1, tags: [], createdAt: now, updatedAt: now,
    },
    {
      id: 'board-edge-2', projectId, boardId: 'board-1',
      sourceId: 'board-node-3', targetId: 'board-edge-1',
      sources: [{ id: 'board-node-3', on: 'node' }],
      targets: [{ id: 'board-edge-1', on: 'edge' }],
      kind: 'mystery', color: '#fff', style: 'dashed', width: 0, direction: 'forward',
      curvature: 'curved', weight: 1, certainty: 0.5, tags: [], createdAt: now, updatedAt: now,
    },
  ]);
  await db.boardLayers.add({
    id: 'board-layer-1', projectId, boardId: 'board-1', name: 'Act I',
    color: '#fff', visible: true, locked: false, opacity: 1, order: 0,
    createdAt: now, updatedAt: now,
  });
  await db.boardViews.add({
    id: 'board-view-1', projectId, boardId: 'board-1', name: 'Suspects',
    query: 'role:character', layerIds: ['board-layer-1'], mode: 'highlight',
    order: 0, createdAt: now, updatedAt: now,
  });
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
  return ['timeline', 'gallery', 'board', 'annotations', 'scrapper', 'project-tools'];
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
  const hyperEdge = await db.boardEdges.get('board-edge-1');
  assert(hyperEdge?.sources.length === 2, 'board hyper-edge did not round-trip with both sources');
  const metaEdge = await db.boardEdges.get('board-edge-2');
  assert(metaEdge?.targets[0]?.on === 'edge', 'board edge-to-edge anchor did not round-trip');
  assert(await db.boardLayers.get('board-layer-1'), 'board layer did not round-trip');
  assert(await db.boardViews.get('board-view-1'), 'board view did not round-trip');
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

  // Deleting one node must take the relation it was part of *and* the
  // relation anchored on that relation — the transitive case neither legacy
  // engine could even represent.
  await db.boards.add({ id: 'board-delete', projectId: 'critical-project', title: 'Board', surface: 'cork', createdAt: now, updatedAt: now });
  const stub = (id: string, x: number) => ({
    id, projectId: 'critical-project', boardId: 'board-delete', kind: 'card' as const,
    title: id, content: '', color: '#fff', position: { x, y: 0 },
    size: { width: 200, height: 120 }, zIndex: 0, tags: [], createdAt: now, updatedAt: now,
  });
  await db.boardNodes.bulkAdd([stub('node-delete', 0), stub('node-keep', 1), stub('node-third', 2)]);
  await db.boardEdges.bulkAdd([
    {
      id: 'edge-delete', projectId: 'critical-project', boardId: 'board-delete',
      sourceId: 'node-delete', targetId: 'node-keep',
      sources: [{ id: 'node-delete', on: 'node' }], targets: [{ id: 'node-keep', on: 'node' }],
      kind: 'related', color: '#fff', style: 'solid', width: 0, direction: 'none',
      curvature: 'curved', weight: 1, certainty: 1, tags: [], createdAt: now, updatedAt: now,
    },
    {
      id: 'edge-meta', projectId: 'critical-project', boardId: 'board-delete',
      sourceId: 'node-third', targetId: 'edge-delete',
      sources: [{ id: 'node-third', on: 'node' }], targets: [{ id: 'edge-delete', on: 'edge' }],
      kind: 'mystery', color: '#fff', style: 'solid', width: 0, direction: 'forward',
      curvature: 'curved', weight: 1, certainty: 1, tags: [], createdAt: now, updatedAt: now,
    },
    {
      id: 'edge-hyper', projectId: 'critical-project', boardId: 'board-delete',
      sourceId: 'node-delete', targetId: 'node-third',
      sources: [{ id: 'node-delete', on: 'node' }, { id: 'node-keep', on: 'node' }],
      targets: [{ id: 'node-third', on: 'node' }],
      kind: 'causes', color: '#fff', style: 'solid', width: 0, direction: 'forward',
      curvature: 'curved', weight: 1, certainty: 1, tags: [], createdAt: now, updatedAt: now,
    },
  ]);
  await deleteBoardNode('node-delete');
  assert(!(await db.boardEdges.get('edge-delete')), 'board incident-relation cascade failed');
  assert(!(await db.boardEdges.get('edge-meta')), 'board relation-on-relation cascade failed');
  const survivor = await db.boardEdges.get('edge-hyper');
  assert(survivor?.sources.length === 1, 'board hyper-edge kept a deleted endpoint');
  assert(survivor?.sourceId === 'node-keep', 'board hyper-edge did not renormalise its index field');
  passed.push('writing and board cascades');
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
