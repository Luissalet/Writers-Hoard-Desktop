import Dexie from 'dexie';
import { CURRENT_DB_VERSION, db } from '@/db';
import { migrateLegacyBoards } from '@/db/legacyBoardMigration';

const DATABASE_NAME = 'WritersHoardDB';

const LEGACY_BOARD_STORES = {
  yarnBoards: 'id, projectId',
  yarnNodes: 'id, projectId, boardId',
  yarnEdges: 'id, boardId, sourceId, targetId',
  brainstormBoards: 'id, projectId',
  brainstormItems: 'id, boardId, projectId, type',
  brainstormConnections: 'id, boardId, sourceId, targetId',
};

const BOARD_STORES = {
  boards: 'id, projectId',
  boardNodes: 'id, projectId, boardId, kind, *tags',
  boardEdges: 'id, projectId, boardId, sourceId, targetId, kind',
  boardLayers: 'id, projectId, boardId, order',
  boardViews: 'id, projectId, boardId, order',
};

const REFERENCE_STORES = {
  annotations: 'id, projectId, sourceEngineId, sourceEntityId, isOrphaned, noteType, updatedAt, [sourceEngineId+sourceEntityId]',
  annotationReferences: 'id, &annotationId, targetEngineId, targetEntityId, [targetEngineId+targetEntityId]',
  entityLinks: 'id, projectId, sourceEntityId, targetEntityId, relation, createdAt',
  conversionReceipts: 'id, projectId, sourceEntityId, targetEntityId, createdAt',
};

const V23_STORES = {
  projects: 'id, mode, type, parentId, status, updatedAt',
  ...LEGACY_BOARD_STORES,
  ...REFERENCE_STORES,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function replaceWithFixture(version: number, stores: Record<string, string>): Promise<Dexie> {
  db.close();
  await Dexie.delete(DATABASE_NAME);
  const fixture = new Dexie(DATABASE_NAME);
  fixture.version(version).stores(stores);
  await fixture.open();
  assert(fixture.verno === version, `fixture opened at v${fixture.verno}, expected v${version}`);
  return fixture;
}

async function testV21ScopesScrapperToLinkOwners(): Promise<void> {
  const fixture = await replaceWithFixture(20, {
    projects: 'id, mode, type, parentId, status, updatedAt',
    snapshots: 'id, projectId, source, status, createdAt',
    externalLinks: 'id, projectId, type, *tags',
    annotations: REFERENCE_STORES.annotations,
    annotationReferences: REFERENCE_STORES.annotationReferences,
    ...LEGACY_BOARD_STORES,
  });
  const now = 1_710_000_000_000;
  await fixture.table('projects').bulkAdd([
    {
      id: 'links-project', title: 'Has links', mode: 'novelist', type: 'novel', status: 'active',
      enabledEngines: ['writings', 'links'], engineOrder: ['links', 'writings'],
      createdAt: now, updatedAt: now,
    },
    {
      id: 'plain-project', title: 'No links', mode: 'novelist', type: 'novel', status: 'active',
      enabledEngines: ['writings', 'links'], engineOrder: ['links', 'writings'],
      createdAt: now, updatedAt: now,
    },
  ]);
  await fixture.table('externalLinks').add({
    id: 'old-link', projectId: 'links-project', type: 'article',
    url: 'https://example.test/reference', title: 'Reference', notes: 'Keep this',
    tags: ['research'], createdAt: now,
  });
  fixture.close();

  await db.open();
  const linked = await db.projects.get('links-project');
  const plain = await db.projects.get('plain-project');
  assert(linked?.enabledEngines?.includes('scrapper'), 'v21 did not enable Scrapper for the project that owned a link');
  assert(linked?.engineOrder?.includes('scrapper'), 'v21 did not add Scrapper to the owning project order');
  assert(!linked?.enabledEngines?.includes('links') && !linked?.engineOrder?.includes('links'), 'v21 left the retired Links engine enabled');
  assert(linked?.enabledEngines?.includes('notes') && linked?.engineOrder?.includes('notes'), 'v21 did not enable Notes for the linked project');
  assert(!plain?.enabledEngines?.includes('scrapper'), 'v21 enabled Scrapper for a project with no legacy links');
  assert(!plain?.engineOrder?.includes('scrapper'), 'v21 added Scrapper to the order of a project with no legacy links');
  assert(!plain?.enabledEngines?.includes('links') && !plain?.engineOrder?.includes('links'), 'v21 did not retire Links in the empty project');
  assert(plain?.enabledEngines?.includes('notes') && plain?.engineOrder?.includes('notes'), 'v21 did not enable Notes for the empty project');
  assert(await db.snapshots.where('projectId').equals('links-project').count() === 1, 'v21 lost the owning project snapshot');
  assert(await db.snapshots.where('projectId').equals('plain-project').count() === 0, 'v21 assigned a snapshot to the wrong project');
  await db.delete();
}

async function seedV23Boards(fixture: Dexie): Promise<void> {
  const yarnAt = 1_720_000_000_000;
  const brainstormAt = yarnAt + 1_000;
  await fixture.table('projects').bulkAdd([
    {
      id: 'board-project', title: 'Boards', mode: 'novelist', type: 'novel', status: 'active',
      enabledEngines: ['writings', 'yarn-board', 'brainstorm'],
      engineOrder: ['writings', 'brainstorm', 'yarn-board'], createdAt: yarnAt, updatedAt: brainstormAt,
    },
    {
      id: 'empty-project', title: 'Empty', mode: 'novelist', type: 'novel', status: 'active',
      enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: yarnAt, updatedAt: yarnAt,
    },
  ]);
  await fixture.table('yarnBoards').add({
    id: 'shared-board', projectId: 'board-project', title: 'Yarn plot',
    createdAt: yarnAt, updatedAt: yarnAt + 10,
  });
  await fixture.table('brainstormBoards').add({
    id: 'shared-board', projectId: 'board-project', title: 'Brainstorm plot',
    createdAt: brainstormAt, updatedAt: brainstormAt + 10,
  });
  await fixture.table('yarnNodes').bulkAdd([
    {
      id: 'shared-node', projectId: 'board-project', boardId: 'shared-board', type: 'character',
      title: 'Ada', content: 'Detective', image: 'data:image/png;base64,YQ==',
      imageOriginal: 'data:image/png;base64,YWI=', color: '#c4973b',
      position: { x: 11, y: 22 }, width: 231, height: 141, linkedEntryId: 'codex-ada', zIndex: 7,
    },
    {
      id: 'yarn-frame', projectId: 'board-project', boardId: 'shared-board', type: 'group',
      title: 'Suspects', content: '', color: '#4a7ec4', position: { x: 300, y: 50 },
      width: 420, height: 320, childNodeIds: ['shared-node'],
    },
  ]);
  await fixture.table('brainstormItems').bulkAdd([
    {
      id: 'shared-node', boardId: 'shared-board', projectId: 'board-project', type: 'note',
      position: { x: 9, y: 8 }, content: 'Ask about the key', color: 'pink',
      createdAt: brainstormAt + 20, updatedAt: brainstormAt + 21,
    },
    {
      id: 'brain-text', boardId: 'shared-board', projectId: 'board-project', type: 'text-block',
      position: { x: 100, y: 120 }, width: 400, height: 300,
      richContent: '<p>The <strong>locked</strong> room</p>',
      createdAt: brainstormAt + 22, updatedAt: brainstormAt + 23,
    },
    {
      id: 'brain-ref', boardId: 'shared-board', projectId: 'board-project', type: 'entity-ref',
      position: { x: 200, y: 220 }, refEntityId: 'shared-node', refEntityType: 'yarn-node',
      refPreviewData: JSON.stringify({ title: 'Ada preview', subtitle: 'character', color: '#123456' }),
      createdAt: brainstormAt + 24, updatedAt: brainstormAt + 25,
    },
    {
      id: 'brain-image', boardId: 'shared-board', projectId: 'board-project', type: 'image',
      position: { x: 250, y: 260 }, imageData: 'data:image/png;base64,Yw==',
      imageDataOriginal: 'data:image/png;base64,Y2Q=', width: 300, height: 300,
      createdAt: brainstormAt + 26, updatedAt: brainstormAt + 27,
    },
    {
      id: 'brain-section', boardId: 'shared-board', projectId: 'board-project', type: 'section',
      position: { x: 20, y: 300 }, label: 'Act two', sectionColor: '#654321', width: 350, height: 210,
      createdAt: brainstormAt + 28, updatedAt: brainstormAt + 29,
    },
  ]);
  await fixture.table('yarnEdges').add({
    id: 'shared-edge', boardId: 'shared-board', sourceId: 'shared-node', targetId: 'yarn-frame',
    color: '#4a7ec4', style: 'dashed', label: 'Romance', direction: 'both', curvature: 'step',
  });
  await fixture.table('brainstormConnections').add({
    id: 'shared-edge', boardId: 'shared-board', sourceId: 'shared-node', targetId: 'brain-text',
    label: 'Question', color: '#abcdef', style: 'dotted',
  });
  await fixture.table('annotations').add({
    id: 'annotation-yarn', projectId: 'board-project', sourceEngineId: 'yarn-board',
    sourceEntityId: 'shared-node', anchor: { type: 'entity' }, noteType: 'text', noteBody: 'Keep',
    isOrphaned: false, position: 0, createdAt: yarnAt, updatedAt: yarnAt,
  });
  await fixture.table('annotationReferences').add({
    id: 'annotation-ref-brain', annotationId: 'annotation-yarn', targetEngineId: 'brainstorm',
    targetEntityId: 'shared-board', createdAt: yarnAt,
  });
  await fixture.table('entityLinks').add({
    id: 'entity-link', projectId: 'board-project',
    sourceEngineId: 'yarn-board', sourceEntityType: 'yarn-node', sourceEntityId: 'shared-node', sourceTitle: 'Ada',
    targetEngineId: 'brainstorm', targetEntityType: 'brainstorm', targetEntityId: 'shared-board', targetTitle: 'Ideas',
    relation: 'supports', provenance: 'manual', createdAt: yarnAt, updatedAt: yarnAt,
  });
  await fixture.table('conversionReceipts').add({
    id: 'receipt', projectId: 'board-project', sourceEngineId: 'brainstorm', sourceEntityId: 'shared-board',
    targetEngineId: 'yarn-board', targetEntityId: 'shared-node', targetTable: 'yarnNodes',
    preview: 'legacy', undoPayload: {}, createdAt: yarnAt,
  });
}

async function testV23MigratesBothLegacyGraphs(): Promise<void> {
  const fixture = await replaceWithFixture(23, V23_STORES);
  await seedV23Boards(fixture);
  fixture.close();

  await db.open();
  assert(db.verno === CURRENT_DB_VERSION, `v23 fixture upgraded to v${db.verno}, expected current v${CURRENT_DB_VERSION}`);
  assert(await db.boards.count() === 2, 'v24 changed the number of boards');
  assert(await db.boardNodes.count() === 7, 'v24 changed the number of cards/items');
  assert(await db.boardEdges.count() === 2, 'v24 changed the number of connections');
  assert(await db.boards.where('projectId').equals('empty-project').count() === 0, 'v24 leaked a board into another project');

  const yarnBoard = await db.boards.get('shared-board');
  const brainstormBoardId = 'legacy:brainstorm:board:shared-board';
  const brainstormBoard = await db.boards.get(brainstormBoardId);
  assert(yarnBoard?.title === 'Yarn plot' && yarnBoard.projectId === 'board-project', 'v24 did not preserve the Yarn board ID/scope');
  assert(brainstormBoard?.title === 'Brainstorm plot' && brainstormBoard.projectId === 'board-project', 'v24 did not deterministically remap the colliding Brainstorm board');
  assert(yarnBoard.createdAt === 1_720_000_000_000 && brainstormBoard.createdAt === 1_720_000_001_000, 'v24 lost board timestamps');

  const yarnNode = await db.boardNodes.get('shared-node');
  assert(yarnNode?.boardId === 'shared-board' && yarnNode.kind === 'card' && yarnNode.role === 'character', 'v24 changed Yarn node identity/type');
  assert(yarnNode.title === 'Ada' && yarnNode.content === 'Detective', 'v24 lost Yarn node text');
  assert(yarnNode.position.x === 11 && yarnNode.position.y === 22 && yarnNode.size.width === 231 && yarnNode.size.height === 141, 'v24 lost Yarn geometry');
  assert(yarnNode.imageOriginal === 'data:image/png;base64,YWI=' && yarnNode.zIndex === 7, 'v24 lost Yarn image/layering metadata');
  assert(yarnNode.ref?.engineId === 'codex' && yarnNode.ref.entityId === 'codex-ada', 'v24 lost the Yarn Codex link');
  const frame = await db.boardNodes.get('yarn-frame');
  assert(frame?.kind === 'frame' && frame.size.width === 420, 'v24 did not convert a Yarn group to a frame');
  assert(frame.props?.['legacy.yarn.childNodeIds'] === '["shared-node"]', 'v24 lost the legacy group membership metadata');

  const brainstormNodeId = 'legacy:brainstorm:node:shared-node';
  const note = await db.boardNodes.get(brainstormNodeId);
  assert(note?.boardId === brainstormBoardId && note.projectId === 'board-project', 'v24 did not remap the colliding Brainstorm item/scope');
  assert(note.kind === 'postit' && note.content === 'Ask about the key' && note.color === '#fce7f3', 'v24 lost Brainstorm note content/style');
  assert(note.position.x === 9 && note.createdAt === 1_720_000_001_020, 'v24 lost Brainstorm note coordinates/timestamp');
  const text = await db.boardNodes.get('brain-text');
  assert(text?.kind === 'text' && text.richContent === '<p>The <strong>locked</strong> room</p>', 'v24 lost rich Brainstorm text');
  assert(text.content === 'The locked room' && text.size.width === 400 && text.size.height === 300, 'v24 did not preserve/search-project Brainstorm text');
  const ref = await db.boardNodes.get('brain-ref');
  assert(ref?.ref?.engineId === 'board' && ref.ref.entityType === 'board-node' && ref.ref.entityId === 'shared-node', 'v24 did not rewrite a legacy board reference');
  assert(ref.ref.title === 'Ada preview' && ref.ref.subtitle === 'character', 'v24 lost cached reference metadata');
  const image = await db.boardNodes.get('brain-image');
  assert(image?.image === 'data:image/png;base64,Yw==' && image.imageOriginal === 'data:image/png;base64,Y2Q=', 'v24 lost Brainstorm image data');
  const section = await db.boardNodes.get('brain-section');
  assert(section?.kind === 'frame' && section.title === 'Act two' && section.color === '#654321', 'v24 lost Brainstorm section metadata');

  const yarnEdge = await db.boardEdges.get('shared-edge');
  assert(yarnEdge?.boardId === 'shared-board' && yarnEdge.sourceId === 'shared-node' && yarnEdge.targetId === 'yarn-frame', 'v24 broke the Yarn connection');
  assert(yarnEdge.sources[0]?.id === yarnEdge.sourceId && yarnEdge.targets[0]?.id === yarnEdge.targetId, 'v24 did not create canonical Yarn endpoints');
  assert(yarnEdge.kind === 'romance' && yarnEdge.label === 'Romance' && yarnEdge.style === 'dashed', 'v24 lost Yarn edge semantics/style');
  assert(yarnEdge.direction === 'both' && yarnEdge.curvature === 'step', 'v24 lost Yarn edge direction/curvature');
  const brainstormEdgeId = 'legacy:brainstorm:edge:shared-edge';
  const brainstormEdge = await db.boardEdges.get(brainstormEdgeId);
  assert(brainstormEdge?.boardId === brainstormBoardId, 'v24 did not remap the colliding Brainstorm connection');
  assert(brainstormEdge.sourceId === brainstormNodeId && brainstormEdge.targetId === 'brain-text', 'v24 broke the Brainstorm connection endpoints');
  assert(brainstormEdge.projectId === 'board-project' && brainstormEdge.color === '#abcdef' && brainstormEdge.style === 'dotted', 'v24 lost Brainstorm connection scope/style');

  const project = await db.projects.get('board-project');
  assert(project?.enabledEngines?.filter((id) => id === 'board').length === 1, 'v24 did not deduplicate enabled Board engines');
  assert(project?.engineOrder?.filter((id) => id === 'board').length === 1, 'v24 did not deduplicate the Board engine order');
  assert(!project?.enabledEngines?.includes('yarn-board') && !project?.enabledEngines?.includes('brainstorm'), 'v24 left retired engines enabled');
  const annotation = await db.annotations.get('annotation-yarn');
  assert(annotation?.sourceEngineId === 'board' && annotation.sourceEntityId === 'shared-node', 'v24 broke a Yarn annotation anchor');
  const annotationRef = await db.annotationReferences.get('annotation-ref-brain');
  assert(annotationRef?.targetEngineId === 'board' && annotationRef.targetEntityId === brainstormBoardId, 'v24 broke an annotation reference to Brainstorm');
  const entityLink = await db.entityLinks.get('entity-link');
  assert(entityLink?.sourceEngineId === 'board' && entityLink.sourceEntityType === 'board-node' && entityLink.sourceEntityId === 'shared-node', 'v24 broke an EntityLink Yarn endpoint');
  assert(entityLink.targetEngineId === 'board' && entityLink.targetEntityType === 'board' && entityLink.targetEntityId === brainstormBoardId, 'v24 broke an EntityLink Brainstorm endpoint');
  const receipt = await db.conversionReceipts.get('receipt');
  assert(receipt?.sourceEngineId === 'board' && receipt.sourceEntityId === brainstormBoardId, 'v24 broke a conversion receipt source');
  assert(receipt.targetEngineId === 'board' && receipt.targetEntityId === 'shared-node', 'v24 broke a conversion receipt target');

  for (const retired of Object.keys(LEGACY_BOARD_STORES)) {
    assert(!db.tables.some((table) => table.name === retired), `v25 did not retire ${retired} after the successful copy`);
  }

  const counts = [await db.boards.count(), await db.boardNodes.count(), await db.boardEdges.count()];
  db.close();
  await db.open();
  assert(await db.boards.count() === counts[0], 'reopening duplicated migrated boards');
  assert(await db.boardNodes.count() === counts[1], 'reopening duplicated migrated nodes');
  assert(await db.boardEdges.count() === counts[2], 'reopening duplicated migrated edges');
  await db.delete();
}

async function testMigrationBodyRollsBackAndRepeatsSafely(): Promise<void> {
  const name = `WritersHoardMigrationRepeat-${crypto.randomUUID()}`;
  const fixture = new Dexie(name);
  fixture.version(1).stores({ ...V23_STORES, ...BOARD_STORES });
  await fixture.open();
  const at = 1_730_000_000_000;
  await fixture.table('projects').add({
    id: 'repeat-project', title: 'Repeat', enabledEngines: ['yarn-board'], engineOrder: ['yarn-board'],
    createdAt: at, updatedAt: at,
  });
  await fixture.table('yarnBoards').add({ id: 'repeat-board', projectId: 'repeat-project', title: 'Repeat', createdAt: at, updatedAt: at });
  await fixture.table('yarnNodes').bulkAdd([
    { id: 'repeat-a', projectId: 'repeat-project', boardId: 'repeat-board', type: 'note', title: 'A', content: 'A', color: '#fff', position: { x: 0, y: 0 } },
    { id: 'repeat-b', projectId: 'repeat-project', boardId: 'repeat-board', type: 'note', title: 'B', content: 'B', color: '#fff', position: { x: 1, y: 1 } },
  ]);
  await fixture.table('yarnEdges').add({ id: 'repeat-edge', boardId: 'repeat-board', sourceId: 'repeat-a', targetId: 'repeat-b', color: '#fff', style: 'solid' });

  let injectedFailure = false;
  try {
    await fixture.transaction('rw', fixture.tables, async (tx) => {
      await migrateLegacyBoards(tx);
      throw new Error('injected failure after migration writes');
    });
  } catch (error) {
    injectedFailure = error instanceof Error && error.message.includes('injected failure');
  }
  assert(injectedFailure, 'the rollback fixture did not inject its failure');
  assert(await fixture.table('boards').count() === 0, 'a failed migration left a partial board');
  assert(await fixture.table('boardNodes').count() === 0, 'a failed migration left partial nodes');
  assert(await fixture.table('boardEdges').count() === 0, 'a failed migration left partial edges');
  assert(await fixture.table('yarnBoards').count() === 1 && await fixture.table('yarnNodes').count() === 2, 'a failed migration damaged legacy rows');

  await fixture.transaction('rw', fixture.tables, async (tx) => {
    await migrateLegacyBoards(tx);
    await migrateLegacyBoards(tx);
  });
  assert(await fixture.table('boards').count() === 1, 'repeating the migration duplicated boards');
  assert(await fixture.table('boardNodes').count() === 2, 'repeating the migration duplicated nodes');
  assert(await fixture.table('boardEdges').count() === 1, 'repeating the migration duplicated edges');
  await fixture.delete();
}

async function testOldV24KeepsOnlyRecoverableRows(): Promise<void> {
  const fixture = await replaceWithFixture(24, {
    projects: 'id, mode, type, parentId, status, updatedAt',
    ...BOARD_STORES,
  });
  const at = 1_740_000_000_000;
  await fixture.table('projects').add({ id: 'post-loss-project', title: 'Post loss', createdAt: at, updatedAt: at });
  await fixture.table('boards').add({
    id: 'surviving-board', projectId: 'post-loss-project', title: 'Survived', surface: 'cork', createdAt: at, updatedAt: at,
  });
  await fixture.table('boardNodes').bulkAdd([
    {
      id: 'surviving-a', projectId: 'post-loss-project', boardId: 'surviving-board', kind: 'card',
      title: 'A', content: '', color: '#fff', position: { x: 0, y: 0 }, size: { width: 220, height: 140 },
      zIndex: 0, tags: [], createdAt: at, updatedAt: at,
    },
    {
      id: 'surviving-b', projectId: 'post-loss-project', boardId: 'surviving-board', kind: 'card',
      title: 'B', content: '', color: '#fff', position: { x: 1, y: 1 }, size: { width: 220, height: 140 },
      zIndex: 0, tags: [], createdAt: at, updatedAt: at,
    },
  ]);
  await fixture.table('boardEdges').add({
    id: 'surviving-edge', projectId: 'post-loss-project', boardId: 'surviving-board',
    sourceId: 'surviving-a', targetId: 'surviving-b',
    sources: [{ id: 'surviving-a', on: 'node' }], targets: [{ id: 'surviving-b', on: 'node' }],
    kind: 'related', color: '#fff', style: 'solid', width: 0, direction: 'none', curvature: 'curved',
    weight: 1, certainty: 1, tags: [], createdAt: at, updatedAt: at,
  });
  fixture.close();

  await db.open();
  assert(db.verno === CURRENT_DB_VERSION, `old v24 fixture upgraded to v${db.verno}, expected current v${CURRENT_DB_VERSION}`);
  assert(await db.boards.count() === 1 && await db.boardNodes.count() === 2 && await db.boardEdges.count() === 1, 'v24-to-current damaged recoverable Board rows');
  assert((await db.boards.get('surviving-board'))?.title === 'Survived', 'v24-to-current lost the surviving board');
  assert(!(await db.boards.get('legacy:yarn:board:unknown')), 'v24-to-current fabricated unrecoverable legacy data');
  await db.delete();
}

/** Run the destructive-schema regressions before the rest of the shared DB suite. */
export async function runMigrationV24Tests(): Promise<string[]> {
  const passed: string[] = [];
  try {
    await testV21ScopesScrapperToLinkOwners();
    passed.push('Dexie v21: Scrapper follows legacy links per project');
    await testV23MigratesBothLegacyGraphs();
    passed.push('Dexie v23→current: Yarn and Brainstorm rows, IDs and relations survive');
    await testMigrationBodyRollsBackAndRepeatsSafely();
    passed.push('Dexie v24 migration: rollback is atomic and repetition is idempotent');
    await testOldV24KeepsOnlyRecoverableRows();
    passed.push('Dexie v24→current: existing Board rows survive and lost legacy rows are not fabricated');
    await db.open();
    assert(db.verno === CURRENT_DB_VERSION, `fresh database opened at v${db.verno}, expected current v${CURRENT_DB_VERSION}`);
    passed.push('Dexie fresh install: current schema opens after historical migrations');
    return passed;
  } finally {
    // Later critical tests share the singleton, so always hand them a clean,
    // open current database even when a regression above throws.
    db.close();
    await Dexie.delete(DATABASE_NAME);
    await db.open();
  }
}
