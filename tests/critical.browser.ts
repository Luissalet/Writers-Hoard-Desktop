import JSZip from 'jszip';
import { testEditorialTools } from './editorial-tools.browser';
import { testBoardInteractions } from './board-interactions';
import { testPlanningTitleOwnership, testPlanningSaveRecovery } from './planning-lifecycle.browser';
import { testProjectUserFlows } from './project-userflows.browser';
import { testCreativeRetrieval } from './creative-retrieval.browser';
import { testOutlineCreativeFlow } from './outline-creative-flow.browser';
import { testRelationshipsMatrixBrowser } from './relationships-matrix.browser';
import { testPlanningFollowup } from './planning-followup.browser';
import { testDiaryAutosave } from './diary-autosave.browser';
import { testCodexConcurrentEditing } from './codex-concurrent-edit.browser';
import { testCreativeOrganizationBrowser } from './creative-organization.browser';
import { testCreativeCapturePersistence } from './creative-capture.browser';
import Dexie from 'dexie';
import { CURRENT_DB_VERSION, db } from '@/db';
import '@/engines/timeline';
import '@/engines/gallery';
import '@/engines/board';
import '@/engines/annotations';
import '@/engines/scrapper';
import '@/engines/writings';
import '@/engines/codex';
import '@/engines/dialog-scene';
import '@/engines/diary';
import '@/engines/notes';
import '@/engines/outline';
import '@/services/projectToolsBackup';
import { getAllBackupStrategies } from '@/engines/_shared/backupRegistry';
import {
  WritingConflictError,
  WritingGoneError,
  deleteWriting,
  deleteWritingRestorable,
  expectDeletedWriting,
  restoreDeletedWriting,
  takeLastDeletedWriting,
  updateWriting,
  updateWritingAtVersion,
  getWritingVersion,
} from '@/engines/writings/operations';
import { runCloseGuards } from '@/services/closeGuard';
import { deleteBoardNode } from '@/engines/board/operations';
import {
  clearWritingRecoveryDraft,
  inspectWritingRecoveryDraft,
  readWritingRecoveryDraft,
  writeWritingRecoveryDraft,
} from '@/engines/writings/recoveryJournal';
import {
  deleteSnapshotsForWriting,
  listSnapshotMeta,
  listSnapshots,
  readSnapshot,
  restoreSnapshot,
  takeSnapshot,
} from '@/engines/writings/snapshots';
import {
  COMMAND_CENTRE_SHORTCUT,
  DISPLAY_ONLY_KEYS,
  FOCUS_MODE_SHORTCUT,
  SHORTCUTS,
  SHORTCUTS_PANEL_SHORTCUT,
  SIDEBAR_SHORTCUT,
  SHORTCUT_SCOPES,
  chordCaps,
  getShortcut,
  isMacPlatform,
  matchesChord,
  matchesShortcut,
  shortcutChords,
} from '@/components/common/shortcuts';
import { isFindShortcut, isReplaceShortcut } from '@/components/editor/editorShortcuts';
import { toLocalDateKey } from '@/engines/writing-stats/date';
import {
  getCurrentProjectIdFromUrl,
  installNavigator,
} from '@/engines/_shared/anchoring/navigation';
import { getAnchorAdapter } from '@/engines/_shared/anchoring/registry';
import { registerFallbackAnchorAdapters } from '@/engines/_shared/anchoring/registerFallbackAdapters';
import type { Scene, DialogBlock } from '@/engines/dialog-scene/types';
import { testWorldgenSpatialEntities } from './worldgen-spatial-entities';
import { testWorldgenSemanticZoom } from './worldgen-semantic-zoom';
import { testAiBridgeContracts } from './ai-bridge';
import { testAiRuntimeContracts } from './ai-runtime';
import { testComfyBackend } from './comfy';
import { runRegionInfraTests } from './worldgen-region-infra.test';
import { testWorldgenDetailShader } from './worldgen-rendering';
import { testWorldgenBridgeAccess } from './worldgen-bridge';
import {
  createProjectZipArchive,
  importProjectZip,
  previewProjectZipImport,
} from '@/services/zipBackup';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import {
  foldSearchText,
  parseSearchQuery,
  hasExcludedText,
  findRequiredMatch,
  scoreSearchMatch,
  selectRankedMatches,
} from '@/services/searchQuery';
import {
  calculateCoverage,
  deriveNarrativeContinuity,
  deriveProjectHealthStatus,
  loadProjectCockpit,
} from '@/services/projectIntelligence';
import { readWorldRenameEdits } from '@/engines/worldgen/core/readRenameEdits';
import {
  buildPublishingArtifacts,
  citationFromSnapshot,
  formatCitation,
  normalizePublishingProfile,
  resolvePublishingWritings,
} from '@/services/projectTools';
import {
  buildCommandCenterActions,
  commandCenterSearchKey,
  filterCommandCenterActions,
  moveCommandCenterSelection,
} from '@/services/commandCenter';
import {
  COCKPIT_GROUPS,
  getCockpitGroup,
  resolveCockpitTab,
} from '@/components/project/cockpitNavigation';
import type { Writing } from '@/types';
import type { Citation, PublishingProfile } from '@/types/projectTools';
import type { ProofreaderInput, ProofreaderWritingRow } from '@/services/proofreader';
import type { AiMessage } from '@/services/copilot/types';
import { runVisualRefTests } from './visual-ref';
import { runImageStudioTests } from './image-studio';
import { runFootnoteTests } from './footnotes';
import { runFootnoteBridgeTests } from './footnotesBridge';
import {
  testWorldgenKeyboardCamera,
  testWorldgenLegend,
  testWorldgenRuler,
  testWorldgenRulerOnMap,
  testWorldgenRulerOverlayDraws,
} from './worldgen-ux';
import {
  testPageModeInEditor,
  testPageSizes,
  testPaginationPureAtomicBlockMovesWhole,
  testPaginationPureCutsBetweenLines,
  testPaginationPureFitsExactly,
  testPaginationPureForcedBreak,
  testPaginationPureMargins,
  testPaginationPureNotesPushALine,
  testPaginationPureOversizedBlockOverflows,
} from './pageMode';
import {
  testBookDiff,
  testBookEditorAutosave,
  testBookHeadingNode,
  testBookHeadingView,
  testBookFootnotesPanel,
  testBookFootnotesRestartPerChapter,
  testBookRoundTrip,
  testBookSaveAgainstDexie,
  testBookSplitEdges,
} from './bookMode';
import * as atlasMapTests from './atlasMap';
import { testBridgeLinksStayInProject } from './aiBridgeScope';
import { runMigrationV24Tests } from './migration-v24';
import { testInquiry } from './inquiry.browser';
import { testInquiryEnrichment } from './inquiry-enrichment.browser';
import { testInquiryUi } from './inquiry-ui.browser';
import { testInquiryBridge } from './inquiry-bridge.browser';
import { testBridgeSelfTest } from './ai-bridge-selftest.browser';
import { testFamilyExchange } from './family-exchange.browser';
import { testFamilyUi } from './family-ui.browser';
import { testZipBackupScopeGuards } from './zipBackupScope';
import { testConversionUndoSafety } from './project-tools-safety';
import { testGoogleDocWriteSafety } from './google-docs-safety';
import { runPendingWriteTests } from './pending-writes';
import { testAccessibleModalContract } from './modal-accessibility';
import { testProjectHealthRecovery } from './projectHealthRecovery';
import { testJudgeContracts } from './judge';
import { testCreativeBranchKernel } from './creative-branches';
import { testStoryStateKernel } from './story-state';
import { testCreativePromotion } from './creative-promotion';
import { testStoryLenses } from './story-lenses';
import { testSharedUniverse } from './shared-universe';
import { runSceneLabCoreTests } from './scene-lab';
import { runNarrativeXrayTests } from './narrative-xray';

registerFallbackAnchorAdapters();

declare global {
  interface Window {
    __criticalResult?: {
      ok: boolean;
      tests: string[];
      error?: string;
    };
    // Live view of `passed`, so a harness timeout can name the test that hung
    // instead of only reporting that the whole suite stopped answering.
    __criticalProgress?: string[];
    __criticalStage?: string;
  }
}

const passed: string[] = [];
window.__criticalProgress = passed;
const stage = (label: string): void => { window.__criticalStage = label; };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function testMigration(): Promise<void> {
  await db.delete();

  // A migration that loses a writer's rows is unforgivable, so prove it does
  // not rather than assert the version number and hope. Create the database at
  // the PREVIOUS version, put rows in it, then let the real schema upgrade it
  // and read them back. Asserting only `verno` would pass just as happily for
  // a version that dropped every store and recreated it empty.
  const previous = new Dexie('WritersHoardDB');
  previous.version(29).stores({
    projects: 'id, type, parentId, status, updatedAt',
    writings: 'id, projectId, status, *tags, updatedAt, googleDocId',
    inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
    visualRefs: 'id, projectId, codexEntryId, kind, updatedAt',
  });
  await previous.open();
  assert(previous.verno === 29, `the fixture must be created at v29, got v${previous.verno}`);
  const madeAt = Date.now();
  await previous.table('projects').add({
    id: 'legacy-project', type: 'novel', title: 'Antes de las recetas', status: 'active',
    createdAt: madeAt, updatedAt: madeAt,
  });
  await previous.table('writings').add({
    id: 'legacy-writing', projectId: 'legacy-project', title: 'Capitulo uno', status: 'draft',
    content: '<p>un faro</p>', wordCount: 2, tags: [], createdAt: madeAt, updatedAt: madeAt,
  });
  await previous.table('inspirationImages').add({
    id: 'legacy-image', projectId: 'legacy-project', title: 'El faro', dataUrl: 'data:image/png;base64,AA',
    tags: [], linkedEntryIds: [], createdAt: madeAt, source: 'generated',
    generation: { prompt: 'un faro', connectionId: 'builtin-sd', modelId: 'sd15-q8', width: 512, height: 512, createdAt: madeAt },
  });
  previous.close();

  await db.open();
  assert(db.verno === CURRENT_DB_VERSION, `expected schema v${CURRENT_DB_VERSION}, received v${db.verno}`);
  assert((await db.projects.get('legacy-project'))?.title === 'Antes de las recetas', 'the upgrade lost a project row');
  assert((await db.writings.get('legacy-writing'))?.content === '<p>un faro</p>', 'the upgrade lost a writing row');
  const carried = await db.inspirationImages.get('legacy-image');
  assert(carried?.generation?.prompt === 'un faro', 'the upgrade lost a generated image and its provenance');
  assert(carried?.generation?.recipeId === undefined, 'a row written before recipes existed must simply have no recipe, not a fabricated one');
  // The new table arrives empty and usable in the same breath.
  assert((await db.imageRecipes.count()) === 0, 'the recipes table must arrive empty');
  await db.imageRecipes.add({
    version: 1, id: 'recipe-1', projectId: 'legacy-project', createdAt: madeAt, updatedAt: madeAt,
    prompt: { positive: 'un faro', resolvedPositive: 'un faro rojo' },
    model: { id: 'sd15-q8' }, loras: [], sampling: { sampler: 'euler_a', steps: 20, cfg: 7 },
    seed: { seed: 3 }, size: { width: 512, height: 512 }, inputs: {}, passes: [{ kind: 'base' }],
    backend: { kind: 'sdcpp', connectionId: 'builtin-sd' }, hash: 'f'.repeat(64),
  });
  assert((await db.imageRecipes.where('projectId').equals('legacy-project').count()) === 1, 'the recipes table must be queryable by project');
  await db.imageRecipes.clear();
  await db.projects.delete('legacy-project');
  await db.writings.delete('legacy-writing');
  await db.inspirationImages.delete('legacy-image');

  for (const table of [
    'entityLinks', 'citations', 'publishingProfiles', 'conversionReceipts',
    'boards', 'boardNodes', 'boardEdges', 'boardLayers', 'boardViews',
    'canonTiles', 'renderedTiles',
    'aiThreads', 'aiMessages', 'aiProjectSettings',
    'atlasPlaces', 'atlasDivergences',
    'visualRefs', 'imageRecipes',
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
  passed.push('Dexie migration v30: rows written at v29 survive the upgrade');
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
    id: 'snapshot-1', projectId,
    url: 'https://www.instagram.com/p/ABC_def-12/?utm_source=ig_web_copy_link&igsh=abc%2Fdef#saved',
    title: 'Source',
    source: 'url', status: 'success', notes: '', tags: [], preservedAt: now,
    createdAt: now, localMediaPath: `${projectId}/snapshot-1.mp4`,
    downloadState: 'done',
  });
  await db.citations.add({
    id: 'citation-1', projectId, title: 'Source', authors: ['Writer'],
    accessedAt: '2026-07-27', writingIds: [], tags: [], createdAt: now, updatedAt: now,
    reliability: 'B', credibility: 2, origin: 'example.org', retractedAt: now, retractReason: 'superseded',
    researchEvidence: [{ id: 'evidence-1', statement: 's', kind: 'fact', quote: 'q', locator: '', status: 'pending', notes: '', createdAt: now, updatedAt: now }],
  });
  await db.inquiryCases.add({ id: 'inquiry-case-1', projectId, question: 'What happened?', staleDays: 90, createdAt: now, updatedAt: now });
  await db.inquiryClaims.add({
    id: 'inquiry-claim-1', projectId, statement: 'It happened.', validFrom: '2020', confidence: 0.5, notes: '', placeIds: [], tags: ['t'],
    supports: [{ citationId: 'citation-1', evidenceId: 'evidence-1' }], createdAt: now, updatedAt: now,
  });
  await db.inquiryHypotheses.add({ id: 'inquiry-hypothesis-1', projectId, statement: 'It was X.', status: 'open', order: 0, createdAt: now, updatedAt: now });
  await db.inquiryRatings.add({ id: 'inquiry-hypothesis-1|inquiry-claim-1', projectId, hypothesisId: 'inquiry-hypothesis-1', claimId: 'inquiry-claim-1', rating: 'C', note: '', updatedAt: now });
  await db.enrichmentRuns.add({ id: 'enrichment-run-1', projectId, enricher: 'wikidata', entryId: 'missing-entry', qid: 'Q1', status: 'ok', createdCitationIds: [], citationId: 'citation-1', changes: [{ field: 'wikidataQid', before: null, after: 'Q1' }], createdAt: now });
  await db.publishingProfiles.add({
    id: 'publishing-profile-1', projectId, name: 'Editorial', format: 'manuscript',
    includeTitlePage: true, includeSynopsis: true, includeBibliography: true,
    citationStyle: 'apa', selectionMode: 'selected',
    selectedWritingIds: ['chapter-2', 'chapter-1'],
    writingOrder: ['chapter-2', 'missing-writing', 'chapter-1'],
    createdAt: now, updatedAt: now,
  });
  return ['timeline', 'gallery', 'board', 'annotations', 'scrapper', 'project-tools', 'inquiry'];
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
  assert(
    snapshot?.url === 'https://www.instagram.com/p/ABC_def-12/?utm_source=ig_web_copy_link&igsh=abc%2Fdef#saved',
    'Scrapper changed or lost the exact clipping link during backup restore',
  );
  const restoredCitation = await db.citations.get('citation-1');
  assert(restoredCitation, 'project tools did not round-trip');
  assert(
    restoredCitation.reliability === 'B' && restoredCitation.credibility === 2 && restoredCitation.origin === 'example.org'
      && restoredCitation.retractedAt && restoredCitation.retractReason === 'superseded'
      && restoredCitation.researchEvidence?.[0]?.id === 'evidence-1',
    'citation grade, retraction and excerpts did not round-trip',
  );
  const restoredClaim = await db.inquiryClaims.get('inquiry-claim-1');
  assert(restoredClaim?.supports[0]?.evidenceId === 'evidence-1' && restoredClaim.validFrom === '2020', 'investigation claim did not round-trip');
  assert((await db.inquiryCases.get('inquiry-case-1'))?.staleDays === 90, 'investigation case did not round-trip');
  assert((await db.inquiryHypotheses.get('inquiry-hypothesis-1'))?.statement === 'It was X.', 'hypothesis did not round-trip');
  assert((await db.inquiryRatings.get('inquiry-hypothesis-1|inquiry-claim-1'))?.rating === 'C', 'ACH rating did not round-trip');
  assert((await db.enrichmentRuns.get('enrichment-run-1'))?.changes[0]?.after === 'Q1', 'enrichment run did not round-trip');
  const publishingProfile = await db.publishingProfiles.get('publishing-profile-1');
  assert(
    publishingProfile?.selectionMode === 'selected'
      && publishingProfile.selectedWritingIds.join(',') === 'chapter-2,chapter-1'
      && publishingProfile.writingOrder?.join(',') === 'chapter-2,missing-writing,chapter-1',
    'publishing profile selection and explicit order did not round-trip',
  );
  passed.push('structured backup round-trip');
}

async function testProjectImportCollisionGuard(): Promise<void> {
  const projectId = 'critical-import-collision';
  const now = Date.now();
  await db.projects.put({
    id: projectId,
    title: 'Incoming archive title',
    mode: 'novelist',
    type: 'standalone',
    color: '#7c3aed',
    description: '',
    status: 'in-progress',
    enabledEngines: [],
    engineOrder: [],
    createdAt: now,
    updatedAt: now,
  });
  stage('collision:createArchive');
  const { blob, fileName } = await createProjectZipArchive(projectId);
  const archive = new File([blob], fileName, { type: 'application/zip' });
  await db.projects.update(projectId, { title: 'Current local title', updatedAt: now + 1 });

  stage('collision:preview');
  const preview = await previewProjectZipImport(archive);
  assert(preview.collisions.length === 1, 'project ZIP collision was not detected');
  assert(
    preview.collisions[0].existingTitle === 'Current local title'
      && preview.collisions[0].incomingTitle === 'Incoming archive title',
    'project ZIP collision preview did not identify both versions',
  );

  stage('collision:blockedImport');
  let blocked = false;
  try {
    await importProjectZip(archive);
  } catch {
    blocked = true;
  }
  assert(blocked, 'unapproved project replacement was allowed');
  assert(
    (await db.projects.get(projectId))?.title === 'Current local title',
    'blocked project import mutated the existing project',
  );

  stage('collision:approvedImport');
  await importProjectZip(archive, { replaceProjectIds: [projectId] });
  assert(
    (await db.projects.get(projectId))?.title === 'Incoming archive title',
    'explicitly approved project replacement did not restore the archive',
  );
  await db.projects.delete(projectId);
  passed.push('project import collision guard + explicit replacement');
}

function testPersistedHtmlSanitizer(): void {
  const hostile = sanitizeRichHtml(`
    <p style="position:fixed" onclick="window.__owned=1">
      Safe <strong>formatting</strong>
      <a href="javascript:alert(1)">bad link</a>
      <img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" onerror="alert(1)">
      <img src="data:image/png;base64,iVBORw0KGgo=" alt="safe raster">
      <script>window.__owned=2</script><iframe srcdoc="evil"></iframe>
    </p>
  `);
  assert(hostile.includes('<p>') && hostile.includes('<strong>formatting</strong>'), 'safe rich text was removed');
  assert(!/script|iframe|onclick|onerror|style=|javascript:/i.test(hostile), 'active HTML survived sanitization');
  assert(!hostile.includes('image/svg+xml'), 'active SVG data URL survived sanitization');
  assert(hostile.includes('data:image/png;base64,'), 'safe raster data URL was removed');
  passed.push('persisted rich HTML allowlist');
}

async function testPublishingStudioSemantics(): Promise<void> {
  const projectId = 'publishing-project';
  const writing = (value: Partial<Writing> & Pick<Writing, 'id' | 'title'>): Writing => ({
    id: value.id,
    projectId,
    title: value.title,
    status: 'draft',
    content: '<p>Draft content</p>',
    wordCount: 2,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...value,
  });
  const writings = [
    writing({ id: 'chapter-2', title: 'Second', chapter: 2, createdAt: 20 }),
    writing({
      id: 'chapter-1',
      title: 'First',
      chapter: 1,
      createdAt: 10,
      content: '<p>Safe <strong>draft</strong><img src="x" onerror="alert(1)"></p><script>owned()</script>',
      wordCount: 3,
    }),
    writing({ id: 'google-cached', title: 'Cached Doc', chapter: 3, isGoogleDoc: true, content: '<p>Cached text</p>' }),
    writing({ id: 'google-empty', title: 'Empty Doc', chapter: 4, isGoogleDoc: true, content: '<p> </p>', wordCount: 0 }),
    writing({ id: 'foreign', projectId: 'another-project', title: 'Foreign', chapter: 0 }),
  ];
  const baseProfile: PublishingProfile = {
    id: 'profile',
    projectId,
    name: 'Editorial',
    format: 'manuscript',
    includeTitlePage: true,
    includeSynopsis: false,
    includeBibliography: true,
    citationStyle: 'mla',
    selectionMode: 'selected',
    selectedWritingIds: ['chapter-1', 'google-cached'],
    writingOrder: ['google-cached', 'missing-writing', 'chapter-1', 'chapter-2'],
    createdAt: 1,
    updatedAt: 1,
  };

  const selected = resolvePublishingWritings(writings, baseProfile);
  assert(selected.writings.map(item => item.id).join(',') === 'google-cached,chapter-1', 'publishing order or selected-only scope changed');
  assert(selected.missingWritingIds.join(',') === 'missing-writing', 'missing writing references were not reported');
  assert(selected.googleDocsWithoutContent.length === 0, 'cached Google Doc was treated as unavailable');

  const googleBlocked = resolvePublishingWritings(writings, {
    ...baseProfile,
    selectedWritingIds: ['google-empty'],
  });
  assert(googleBlocked.googleDocsWithoutContent[0]?.id === 'google-empty', 'empty Google Doc did not block publishing');

  const explicitEmpty = resolvePublishingWritings(writings, {
    ...baseProfile,
    selectedWritingIds: [],
  });
  assert(explicitEmpty.writings.length === 0, 'new selected-empty profile was interpreted as all writings');

  const legacyAll = normalizePublishingProfile({
    ...baseProfile,
    selectionMode: undefined,
    selectedWritingIds: [],
    writingOrder: undefined,
  });
  assert(legacyAll.selectionMode === 'all', 'legacy empty profile compatibility changed');
  assert(
    resolvePublishingWritings(writings, legacyAll).writings.map(item => item.id).join(',')
      === 'chapter-1,chapter-2,google-cached,google-empty',
    'legacy all-writings profile order changed',
  );

  const citation: Citation = {
    id: 'citation-hostile',
    projectId,
    title: '</p><script>owned()</script>',
    authors: [],
    accessedAt: '2026-08-24',
    writingIds: [],
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const artifactWritings = selected.writings.filter(item => item.id === 'chapter-1');
  const english = buildPublishingArtifacts(
    { id: projectId, title: 'Project' },
    baseProfile,
    artifactWritings,
    [citation],
    {
      labels: {
        locale: 'en-US', wordLabel: 'words', chapterLabel: 'Chapter', bibliographyTitle: 'Bibliography',
        unknownAuthor: 'Unknown author', noDate: 'n.d.', accessedLabel: 'Accessed',
      },
      generatedAt: Date.UTC(2026, 7, 24),
    },
  );
  const spanish = buildPublishingArtifacts(
    { id: projectId, title: 'Proyecto' },
    baseProfile,
    artifactWritings,
    [citation],
    {
      labels: {
        locale: 'es-ES', wordLabel: 'palabras', chapterLabel: 'Capítulo', bibliographyTitle: 'Bibliografía',
        unknownAuthor: 'Autor desconocido', noDate: 's. f.', accessedLabel: 'Consultado el',
      },
      generatedAt: Date.UTC(2026, 7, 24),
    },
  );
  assert(english.markdown.includes('Chapter 1') && english.markdown.includes('# Bibliography'), 'English publishing labels were not applied');
  assert(spanish.markdown.includes('Capítulo 1') && spanish.markdown.includes('# Bibliografía'), 'Spanish publishing labels were not applied');
  assert(english.markdown.includes('Unknown author') && english.markdown.includes('n.d.') && english.markdown.includes('Accessed'), 'English citation labels were not applied');
  assert(spanish.markdown.includes('Autor desconocido') && spanish.markdown.includes('s. f.') && spanish.markdown.includes('Consultado el'), 'Spanish citation labels were not applied');
  assert(english.html.includes('Bibliography') && spanish.html.includes('Bibliografía'), 'bibliography missing from printable artifact');
  assert(!/<script|onerror=/i.test(`${english.markdown}\n${english.html}`), 'active writing or citation markup survived publishing');
  assert(english.markdown.includes('&lt;/p&gt;'), 'citation markup was not escaped in Markdown');

  assert(english.document.omittedPortableImageCount === 1, 'portable image policy did not report the omitted image');
  assert(!/<img/i.test(english.document.sections[0]?.portableHtml ?? ''), 'portable publishing IR retained an image');
  assert(english.docxFilename === 'Editorial.docx' && english.epubFilename === 'Editorial.epub', 'portable filenames changed');

  const [{ buildPublishingDocx }, { buildPublishingEpub }] = await Promise.all([
    import('@/engines/writings/publishingDocx'),
    import('@/engines/writings/publishingEpub'),
  ]);
  const [docxBlob, epubBlob] = await Promise.all([
    buildPublishingDocx(english.document),
    buildPublishingEpub(english.document),
  ]);

  const docx = await JSZip.loadAsync(await docxBlob.arrayBuffer());
  const docxDocument = await docx.file('word/document.xml')?.async('string');
  assert(Boolean(docx.file('[Content_Types].xml')), 'DOCX is missing its content-types manifest');
  assert(Boolean(docxDocument?.includes('Chapter 1 — First')), 'DOCX lost the ordered section heading');
  assert(Boolean(docxDocument?.includes('Safe')) && Boolean(docxDocument?.includes('draft')), 'DOCX lost manuscript text');
  assert(!/onerror=|javascript:|<script/i.test(docxDocument ?? ''), 'DOCX retained active markup');
  assert(!Object.keys(docx.files).some(path => path.startsWith('word/media/')), 'DOCX embedded an omitted image');

  const epubBytes = new Uint8Array(await epubBlob.arrayBuffer());
  const epubHeader = new DataView(epubBytes.buffer, epubBytes.byteOffset, epubBytes.byteLength);
  const firstFilenameLength = epubHeader.getUint16(26, true);
  const firstFilename = new TextDecoder().decode(epubBytes.slice(30, 30 + firstFilenameLength));
  assert(epubHeader.getUint32(0, true) === 0x04034b50, 'ePub does not begin with a ZIP local header');
  assert(firstFilename === 'mimetype' && epubHeader.getUint16(8, true) === 0, 'ePub mimetype must be the first uncompressed member');
  const epub = await JSZip.loadAsync(epubBytes);
  assert(await epub.file('mimetype')?.async('string') === 'application/epub+zip', 'ePub mimetype is invalid');
  const opf = await epub.file('EPUB/package.opf')?.async('string');
  const chapter = await epub.file('EPUB/section-1.xhtml')?.async('string');
  assert(Boolean(epub.file('META-INF/container.xml')) && Boolean(epub.file('EPUB/nav.xhtml')), 'ePub package metadata is incomplete');
  assert(Boolean(opf?.includes('<itemref idref="section-1" />')), 'ePub spine lost the manuscript order');
  assert(Boolean(chapter?.includes('Chapter 1 — First')) && Boolean(chapter?.includes('<strong>draft</strong>')), 'ePub lost semantic manuscript content');
  assert(!/script|onerror|<img/i.test(chapter ?? ''), 'ePub retained active or image markup');

  passed.push('publishing selection, compatibility, i18n, safe IR, DOCX, and EPUB3');
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

  // Deleting a project must sweep the copilot tables too — including the one
  // keyed BY projectId, which Dexie keeps out of `idxByName`.
  const { deleteProject } = await import('@/db/operations');
  const doomed = 'critical-project-doomed';
  await db.aiThreads.add({ id: 'ai-thread-doomed', projectId: doomed, title: 'Doomed', policy: 'ask', archived: false, createdAt: now, updatedAt: now });
  await db.aiMessages.add({ id: 'ai-message-doomed', threadId: 'ai-thread-doomed', projectId: doomed, role: 'user', content: 'x', status: 'complete', createdAt: now });
  await db.aiProjectSettings.put({ projectId: doomed, defaultPolicy: 'ask', remoteConsent: false, updatedAt: now });
  await deleteProject(doomed);
  assert(!(await db.aiThreads.get('ai-thread-doomed')), 'project deletion left an AI thread behind');
  assert(!(await db.aiMessages.get('ai-message-doomed')), 'project deletion left an AI message behind');
  assert(!(await db.aiProjectSettings.get(doomed)), 'project deletion left the AI project settings behind');
  passed.push('writing and board cascades, project sweep of copilot tables');
}

// The dock refreshes its message list on every data bump — which the runner
// fires once per streamed token. settleStaleMessages runs on that refresh, so
// if it cancelled *any* streaming row it would cancel the in-flight assistant
// row out from under a live run (the answer would show "cancelled" while
// generating, then snap in at the end). It must only settle orphans — rows with
// no run in flight (a crash or reload). Also guards "one turn at a time".
async function testCopilotRunGuards(): Promise<void> {
  const { settleStaleMessages, addMessage, listMessages } = await import('@/services/copilot/threads');
  const { sendCopilotTurn } = await import('@/services/copilot/runner');
  const { useCopilotStore } = await import('@/stores/copilotStore');
  const now = Date.now();
  const projectId = 'critical-project';
  const threadId = 'copilot-thread-guards';
  await db.aiThreads.add({ id: threadId, projectId, title: 'Guards', policy: 'ask', archived: false, createdAt: now, updatedAt: now });

  const stubRun = (runId: string) => ({
    runId, threadId, projectId,
    handle: { runId, cancel: () => {}, approve: () => {} },
    assistantMessageId: null, buffer: '', reasoning: '',
    startedAt: now, pendingApprovals: [], toolNames: [], chatOnly: false,
  });

  // A live run owns its streaming row: a refresh must NOT cancel it.
  const row = await addMessage({ id: 'copilot-guard-streaming', threadId, projectId, role: 'assistant', content: '', status: 'streaming' });
  useCopilotStore.getState().startRun(stubRun('run-guard-1'));
  await settleStaleMessages(threadId);
  assert((await db.aiMessages.get(row.id))?.status === 'streaming', "settleStaleMessages cancelled a live run's streaming row");

  // One turn at a time: a send is refused while a run is in flight (no dup row).
  const before = (await listMessages(threadId)).length;
  await sendCopilotTurn({
    projectId, threadId, text: 'second turn',
    route: { connectionId: 'x', modelId: 'y' }, policy: 'ask',
    briefing: { projectTitle: 'P', enabledEngines: [], locale: 'es' },
  });
  assert((await listMessages(threadId)).length === before, 'a second turn started while one was already running');

  // Once no run is in flight, an orphaned streaming row IS settled.
  useCopilotStore.getState().endRun(threadId);
  await settleStaleMessages(threadId);
  assert((await db.aiMessages.get(row.id))?.status === 'cancelled', 'settleStaleMessages left an orphaned streaming row unsettled');

  passed.push('copilot run guards: live streaming survives refresh, one turn at a time, orphans settled');
}

// The Escritos→Studio hand-off is a single-slot store the studio drains once.
// It must be one-shot (a second drain gets nothing) and a newer request must
// replace an undrained one (rapid re-selection), or a stale prompt would
// generate unexpectedly on a later studio visit.
async function testImageHandoffStore(): Promise<void> {
  const { useImageHandoffStore } = await import('@/stores/imageHandoffStore');
  const store = () => useImageHandoffStore.getState();
  store().take(); // clear any residue from earlier tests
  assert(store().take() === null, 'hand-off store should be empty once drained');
  store().request({ prompt: 'a red door', autoGenerate: true });
  const first = store().take();
  assert(first?.prompt === 'a red door' && first.autoGenerate === true, 'take() must return the requested hand-off');
  assert(store().take() === null, 'hand-off must be one-shot: a second take() returns null');
  store().request({ prompt: 'A', autoGenerate: false });
  store().request({ prompt: 'B', autoGenerate: true });
  assert(store().take()?.prompt === 'B', 'a newer request must replace an undrained one');
  // A gallery image handed over as an img2img reference travels with no prompt.
  store().request({ prompt: '', autoGenerate: false, initImage: 'data:image/png;base64,AAAA' });
  const reference = store().take();
  assert(reference?.initImage === 'data:image/png;base64,AAAA' && reference.prompt === '', 'a reference hand-off lost its image');
  passed.push('image hand-off store: one-shot take, newer request wins, reference image rides along');
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

function testRecentEntityNavigation(): void {
  let destination: string | null = null;
  installNavigator((path) => {
    destination = path;
  });

  const projectId = 'project with spaces';
  const cases = [
    ['writings', 'writing/1', '/project/project%20with%20spaces/writings?writing=writing%2F1'],
    ['codex', 'entry/1', '/project/project%20with%20spaces/codex?entry=entry%2F1'],
    ['dialog-scene', 'scene/1', '/project/project%20with%20spaces/dialog-scene?entity=scene%2F1'],
    ['notes', 'note/1', '/project/project%20with%20spaces/notes?note=note%2F1'],
    ['scrapper', 'snapshot/1', '/project/project%20with%20spaces/scrapper?entity=snapshot%2F1'],
    ['diary', 'diary/1', '/project/project%20with%20spaces/diary?entity=diary%2F1'],
  ] as const;

  for (const [engineId, entityId, expected] of cases) {
    destination = null;
    const adapter = getAnchorAdapter(engineId);
    assert(adapter, `recent-work engine ${engineId} has no entity navigator`);
    adapter.navigateToEntity(entityId, projectId);
    assert(destination === expected, `${engineId} recent-work navigation lost its exact entity`);
  }

  passed.push('recent-work exact entity navigation');
}

async function testScriptImportRoundTrip(): Promise<void> {
  const { buildFountain } = await import('@/engines/dialog-scene/fountainExport');
  const { parseFountain } = await import('@/engines/dialog-scene/fountainImport');
  const { parseFdx } = await import('@/engines/dialog-scene/fdxImport');
  const { importScript, stripContD, castKeyOf } = await import('@/engines/dialog-scene/importPersist');

  // ── Cue helpers ──
  assert(stripContD("EMISORA (V.O.) (CONT'D)") === 'EMISORA (V.O.)', 'stripContD kept the pagination artifact');
  assert(castKeyOf('EMISORA (V.O.)') === 'EMISORA', 'castKeyOf did not strip the extension');

  // ── Fountain: export → import round trip ──
  const projectId = 'script-import-rt';
  const now = Date.now();
  const mkScene = (id: string, order: number, extra: Partial<Scene>): Scene => ({
    id, projectId, title: '', order, tags: [], createdAt: now, updatedAt: now, ...extra,
  });
  const mkBlock = (id: string, sceneId: string, order: number, extra: Partial<DialogBlock>): DialogBlock => ({
    id, sceneId, projectId, type: 'action', characterName: '', characterColor: '',
    content: '', order, createdAt: now, updatedAt: now, ...extra,
  });
  const scenes: Scene[] = [
    mkScene('s1', 0, { title: 'Bar', setting: 'INT. BAR - NIGHT', sceneNumber: 3 }),
    mkScene('s2', 1, { title: 'Callejón', isOmitted: true }),
    mkScene('s3', 2, { title: 'La azotea', description: 'Amanece.' }),
  ];
  const blocks: DialogBlock[] = [
    mkBlock('b1', 's1', 0, { content: 'La barra está vacía.' }),
    mkBlock('b2', 's1', 1, { type: 'dialog', characterName: 'Alice', characterColor: '#fff', parenthetical: 'susurra', content: 'Hola.' }),
    mkBlock('b3', 's1', 2, { type: 'dialog', characterName: 'Bob', characterColor: '#fff', content: 'Ahora.', dualGroupId: 'dual_x' }),
    mkBlock('b4', 's1', 3, { type: 'dialog', characterName: 'Carla', characterColor: '#fff', content: 'Nunca.', dualGroupId: 'dual_x' }),
    mkBlock('b5', 's1', 4, { type: 'stage-direction', content: 'Se apagan las luces' }),
    mkBlock('b6', 's1', 5, { type: 'transition', content: 'CUT TO:' }),
    mkBlock('b7', 's1', 6, { type: 'note', content: 'Nota del director' }),
    mkBlock('b8', 's1', 7, { type: 'slug', content: 'Más tarde' }),
    mkBlock('b9', 's3', 0, { type: 'dialog', characterName: 'EMISORA (V.O.)', characterColor: '#fff', content: 'Buenos días.' }),
  ];
  const fountainText = buildFountain({ projectTitle: 'RT', scenes, blocks });
  const parsed = parseFountain(fountainText, { preambleTitle: 'Apertura' });

  // The exported mid-scene slug re-imports as a scene boundary — documented loss.
  assert(parsed.scenes.length === 4, `expected 4 scenes after round trip, got ${parsed.scenes.length}`);
  const [rt1, rtSlug, rtOmitted, rt3] = parsed.scenes;
  assert(rt1.title === 'INT. BAR - NIGHT' && rt1.sceneNumber === 3, 'heading title/number did not survive');
  assert(rt1.blocks.length === 7, `expected 7 blocks in scene 1, got ${rt1.blocks.length}`);
  assert(rt1.blocks[0].type === 'action' && rt1.blocks[0].content === 'La barra está vacía.', 'action lost');
  assert(rt1.blocks[1].type === 'dialog' && rt1.blocks[1].characterName === 'ALICE'
    && rt1.blocks[1].parenthetical === 'susurra' && rt1.blocks[1].content === 'Hola.', 'dialog+parenthetical lost');
  assert(rt1.blocks[2].type === 'dialog' && rt1.blocks[3].type === 'dialog'
    && rt1.blocks[2].dualGroup !== undefined && rt1.blocks[2].dualGroup === rt1.blocks[3].dualGroup,
    'dual pairing lost');
  assert(rt1.blocks[4].type === 'stage-direction' && rt1.blocks[4].content === 'Se apagan las luces', 'stage-direction lost');
  assert(rt1.blocks[5].type === 'transition' && rt1.blocks[5].content === 'CUT TO:', 'transition lost');
  assert(rt1.blocks[6].type === 'note' && rt1.blocks[6].content === 'Nota del director', 'note lost');
  assert(rtSlug.title === 'MÁS TARDE' && rtSlug.blocks.length === 0, 'slug boundary scene wrong');
  assert(rtOmitted.title === 'CALLEJÓN' && rtOmitted.isOmitted === true, 'omitted scene lost');
  assert(rt3.blocks[0]?.type === 'action' && rt3.blocks[0]?.content === 'Amanece.', 'description-as-action lost');
  const emisora = rt3.blocks[1];
  assert(emisora?.type === 'dialog' && emisora.characterName === 'EMISORA (V.O.)' && emisora.castKey === 'EMISORA',
    'V.O. cue handling wrong');

  // ── FDX ──
  const fdx = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Type="Scene Heading" Number="7"><Text>INT. COCINA - DIA</Text></Paragraph>
    <Paragraph Type="Action"><Text>Huele a </Text><Text>café.</Text></Paragraph>
    <Paragraph Type="Character"><Text>MARTA (CONT'D)</Text></Paragraph>
    <Paragraph Type="Parenthetical"><Text>(seca)</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>No empieces.</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Otra vez no.</Text></Paragraph>
    <Paragraph Type="Transition"><Text>CORTE A:</Text></Paragraph>
    <Paragraph Type="Shot"><Text>DETALLE DEL RELOJ</Text></Paragraph>
  </Content>
</FinalDraft>`;
  const fdxParsed = parseFdx(fdx, { preambleTitle: 'Apertura' });
  assert(fdxParsed.scenes.length === 1, 'fdx scene count wrong');
  const fs1 = fdxParsed.scenes[0];
  assert(fs1.title === 'INT. COCINA - DIA' && fs1.sceneNumber === 7, 'fdx heading wrong');
  assert(fs1.blocks[0].type === 'action' && fs1.blocks[0].content === 'Huele a café.', 'fdx text runs not joined');
  assert(fs1.blocks[1].type === 'dialog' && fs1.blocks[1].characterName === 'MARTA'
    && fs1.blocks[1].parenthetical === 'seca' && fs1.blocks[1].content === 'No empieces.\nOtra vez no.',
    'fdx dialogue merge wrong');
  assert(fs1.blocks[2].type === 'transition' && fs1.blocks[3].type === 'slug', 'fdx transition/shot mapping wrong');

  // ── Persistence: append-only rows, locked numbers, codex stamping ──
  await db.codexEntries.add({
    id: 'codex-marta', projectId, type: 'character', title: 'Marta',
    fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now,
  });
  const result = await importScript(projectId, fdxParsed);
  assert(result.sceneCount === 1 && result.blockCount === 4, 'importScript counts wrong');
  const storedScenes = await db.scenes.where('projectId').equals(projectId).toArray();
  assert(storedScenes.length === 1 && storedScenes[0].sceneNumber === 7 && storedScenes[0].isLocked === true,
    'imported numbered scene must be locked');
  const storedCast = await db.sceneCasts.where('sceneId').equals(storedScenes[0].id).toArray();
  assert(storedCast.length === 1 && storedCast[0].characterName === 'MARTA'
    && storedCast[0].characterId === 'codex-marta', 'cast row / codex stamping wrong');
  const storedBlocks = await db.dialogBlocks.where('projectId').equals(projectId).toArray();
  const martaBlock = storedBlocks.find((b) => b.type === 'dialog');
  assert(martaBlock?.characterId === 'codex-marta', 'dialog block missing stamped characterId');

  // Clean up the fixture rows so later suites see an untouched project set.
  await db.transaction('rw', db.scenes, db.dialogBlocks, db.sceneCasts, db.codexEntries, async () => {
    const sceneIds = storedScenes.map((s) => s.id);
    await db.dialogBlocks.where('projectId').equals(projectId).delete();
    await db.sceneCasts.where('sceneId').anyOf(sceneIds).delete();
    await db.scenes.where('projectId').equals(projectId).delete();
    await db.codexEntries.delete('codex-marta');
  });

  passed.push('Fountain/FDX import round trip + persistence');
}

async function testAiTextParsing(): Promise<void> {
  const { sanitizeModelText, parseJsonFromModel } = await import('@/services/aiText');

  // Reasoning-block hygiene: paired, truncated-open, and orphan-close shapes.
  assert(sanitizeModelText('<think>razono un rato</think>\nHola') === 'Hola', 'paired think block not stripped');
  assert(sanitizeModelText('Antes<think>truncado sin cierre…') === 'Antes', 'unclosed think block not truncated');
  assert(sanitizeModelText('razonamiento suelto…</think>Respuesta') === 'Respuesta', 'orphan think closer not handled');
  assert(sanitizeModelText('sin nada raro') === 'sin nada raro', 'plain text mangled');

  // JSON extraction: plain, fenced-with-preamble, bracket-slice, think+fence.
  const plain = parseJsonFromModel<number[]>('[1,2]');
  assert(Array.isArray(plain) && plain.length === 2 && plain[1] === 2, 'plain JSON array failed');
  const fenced = parseJsonFromModel<Array<{ a: number }>>('Claro, aquí tienes:\n```json\n[{"a":1}]\n```');
  assert(fenced.length === 1 && fenced[0].a === 1, 'fenced JSON with preamble failed');
  const sliced = parseJsonFromModel<{ a: number[] }>('El resultado es {"a":[1]} — espero que sirva.');
  assert(sliced.a.length === 1 && sliced.a[0] === 1, 'bracket-slice extraction failed');
  const combo = parseJsonFromModel<string[]>('<think>pienso</think>\n```\n["x"]\n```\nListo.');
  assert(combo.length === 1 && combo[0] === 'x', 'think+fence combination failed');

  // The safeAiCall contract: unparseable output throws a SyntaxError.
  let threw: unknown = null;
  try {
    parseJsonFromModel('sin json aquí');
  } catch (err) {
    threw = err;
  }
  assert(threw instanceof SyntaxError, 'non-JSON output must throw SyntaxError');

  passed.push('AI model-output sanitizer and JSON extraction');
}

function testProjectIntelligenceSemantics(): void {
  assert(calculateCoverage(0, 0) === null, 'empty coverage must be not applicable');
  assert(calculateCoverage(0, 4) === 0, 'zero coverage with eligible items must remain zero');
  assert(calculateCoverage(3, 4) === 75, 'coverage percentage calculation changed');
  assert(
    deriveProjectHealthStatus(0, 0) === 'not-applicable',
    'an empty project must not be presented as clean',
  );
  assert(deriveProjectHealthStatus(0, 1) === 'clean', 'assessed content without issues must be clean');
  assert(deriveProjectHealthStatus(1, 0) === 'issues', 'detected issues must take precedence over emptiness');
  passed.push('empty-project intelligence semantics');
}

function testNarrativeContinuitySemantics(): void {
  const continuity = deriveNarrativeContinuity(
    [
      { id: 'beat-unlinked', storyPosition: 10 },
      { id: 'beat-writing', storyPosition: 20, linkedWritingId: 'writing-valid' },
      { id: 'beat-scene', storyPosition: 30, linkedSceneId: 'scene-valid' },
      { id: 'beat-stale', storyPosition: 40, linkedWritingId: 'writing-missing' },
      { id: 'beat-payoff', storyPosition: 50, linkedWritingId: 'writing-valid' },
      { id: 'beat-setup', storyPosition: 70, linkedWritingId: 'writing-valid' },
    ],
    [
      { id: 'seed-unpaid', title: 'Unpaid', status: 'planted', linkedBeatId: 'beat-unlinked' },
      { id: 'seed-cut', title: 'Cut', status: 'cut' },
      { id: 'seed-early', title: 'Early', status: 'paid', linkedBeatId: 'beat-setup' },
      { id: 'seed-equal', title: 'Equal', status: 'paid', plantedAt: 50 },
      { id: 'seed-unknown', title: 'Unknown', status: 'paid' },
    ],
    [
      { id: 'payoff-early', seedId: 'seed-early', title: 'Too soon', linkedBeatId: 'beat-payoff' },
      { id: 'payoff-equal', seedId: 'seed-equal', title: 'Same position', paidAt: 50 },
      { id: 'payoff-unknown', seedId: 'seed-unknown', title: 'Unknown position' },
    ],
    new Set(['writing-valid']),
    new Set(['scene-valid']),
  );

  assert(continuity.counts['unlinked-beat'] === 2, 'continuity must flag empty and stale beat links');
  assert(continuity.counts['unpaid-seed'] === 1, 'continuity must ignore cut seeds and count unpaid active seeds');
  assert(continuity.counts['payoff-before-setup'] === 1, 'continuity must only flag a strictly early known payoff');
  assert(
    continuity.signals.map(signal => signal.id).join(',')
      === 'unlinked-beat:beat-unlinked,unlinked-beat:beat-stale,unpaid-seed:seed-unpaid,payoff-before-setup:payoff-early',
    'continuity signal order or stable identifiers changed',
  );
  passed.push('deterministic narrative continuity signals');
}

function testLightweightWorldgenRenameReader(): void {
  const legacy = readWorldRenameEdits(JSON.stringify([
    { kind: 'rename', key: 'city:1', name: 'Aster' },
    { kind: 'paint', key: 'ignored', name: 'Ignored' },
  ]));
  const current = readWorldRenameEdits(JSON.stringify({ version: 2, edits: [
    { kind: 'rename', key: 'realm:1', name: 'Northreach' },
  ] }));
  assert(legacy.length === 1 && legacy[0].name === 'Aster', 'legacy Worldgen rename edits changed');
  assert(current.length === 1 && current[0].key === 'realm:1', 'current Worldgen rename envelope changed');
  assert(readWorldRenameEdits('{broken').length === 0, 'malformed Worldgen edits must fail closed');
  passed.push('lightweight Worldgen rename reader compatibility');
}

async function testOutlineBeatDeepLink(): Promise<void> {
  const projectId = 'outline-link-project';
  await db.outlines.add({
    id: 'outline/deep', projectId, title: 'Deep outline', createdAt: 1, updatedAt: 1,
  });
  await db.outlineBeats.add({
    id: 'beat/deep', outlineId: 'outline/deep', projectId, order: 0, level: 'beat',
    title: 'Exact beat', description: '', status: 'outlined', createdAt: 1, updatedAt: 1,
  });

  let destination: string | null = null;
  installNavigator(path => { destination = path; });
  getAnchorAdapter('outline')?.navigateToEntity('beat/deep', projectId);
  for (let attempt = 0; attempt < 20 && !destination; attempt += 1) {
    await new Promise(resolve => window.setTimeout(resolve, 5));
  }
  assert(
    destination === '/project/outline-link-project/outline?outline=outline%2Fdeep&beat=beat%2Fdeep',
    'outline beat navigation did not preserve the exact outline and beat',
  );
  await db.outlineBeats.delete('beat/deep');
  await db.outlines.delete('outline/deep');
  passed.push('outline exact beat deep-link navigation');
}

function testEditorialNavigationContracts(): void {
  const cockpitTabs = COCKPIT_GROUPS.flatMap(group => group.tabs);
  assert(cockpitTabs.length === 12, 'Cockpit grouping lost a project view');
  assert(new Set(cockpitTabs).size === cockpitTabs.length, 'Cockpit grouping duplicated a project view');
  assert(resolveCockpitTab('research') === 'research', 'valid Cockpit panel did not survive URL resolution');
  assert(resolveCockpitTab('unknown') === 'overview', 'unknown Cockpit panel did not fall back to overview');
  assert(getCockpitGroup('publishing').id === 'prepare', 'publishing left the prepare workflow');
  assert(getCockpitGroup('lab').id === 'develop', 'creative lab left the development workflow');

  const actions = buildCommandCenterActions({
    id: 'project with spaces',
    enabledEngines: ['codex', 'writings', 'codex'],
    engineOrder: ['writings', 'disabled', 'codex'],
  });
  const target = (id: string) => actions.find(action => action.id === id)?.target;
  assert(target('review') === '/project/project%20with%20spaces/overview?panel=health', 'review command lost its Cockpit panel');
  assert(target('edit') === '/project/project%20with%20spaces/overview?edit=1', 'edit command lost its modal request');
  assert(target('publishing') === '/project/project%20with%20spaces/overview?panel=publishing', 'publishing command lost its studio route');
  assert(target('manage') === '/project/project%20with%20spaces/overview?manage=1', 'manage command lost its modal request');
  assert(
    actions.filter(action => action.engineId).map(action => action.engineId).join(',') === 'writings,codex',
    'command center engine order or deduplication changed',
  );
  assert(
    filterCommandCenterActions(actions, 'publicacion', action => (
      action.id === 'publishing' ? 'Preparar publicación' : action.id
    )).some(action => action.id === 'publishing'),
    'command filtering stopped being accent-insensitive',
  );
  assert(moveCommandCenterSelection(0, 4, -1) === 3, 'command selection no longer wraps upward');
  assert(moveCommandCenterSelection(3, 4, 1) === 0, 'command selection no longer wraps downward');
  assert(
    commandCenterSearchKey({ type: 'entity', id: 'same', projectId: 'a', engineId: 'notes' })
      !== commandCenterSearchKey({ type: 'entity', id: 'same', projectId: 'b', engineId: 'notes' }),
    'command search identity no longer includes the owning project',
  );
  passed.push('Cockpit workflow and command-center navigation contracts');
}

// A reorder is a partial statement about a scope, never a complete one: the
// client sends the ids IT rendered. A row created after that render — by the
// AI bridge, by another window — is in the scope but not in the list, and it
// must keep the order it already has.
//
// Old bug: `orderedIds.indexOf(item.id)` answered -1 for exactly that row, so
// it was stamped with order -1 and jumped to the head of the list.
async function testReorderKeepsUnlistedRows(): Promise<void> {
  const { reorderItems } = await import('@/engines/_shared/reorderItems');
  const projectId = 'reorder-scope-project';
  const outlineId = 'reorder-scope-outline';
  const beat = (id: string, order: number) => ({
    id, outlineId, projectId, order, level: 'beat' as const,
    title: id, description: '', status: 'outlined' as const,
    createdAt: 1, updatedAt: 1,
  });
  await db.outlines.add({ id: outlineId, projectId, title: 'Reorder scope', createdAt: 1, updatedAt: 1 });
  await db.outlineBeats.bulkAdd([
    beat('reorder-listed-a', 0),
    beat('reorder-unlisted', 5),
    beat('reorder-listed-c', 2),
  ]);

  await reorderItems('outlineBeats', 'outlineId', outlineId, ['reorder-listed-c', 'reorder-listed-a']);

  const [first, second, unlisted] = await Promise.all([
    db.outlineBeats.get('reorder-listed-c'),
    db.outlineBeats.get('reorder-listed-a'),
    db.outlineBeats.get('reorder-unlisted'),
  ]);
  assert(first?.order === 0 && second?.order === 1, 'reorderItems did not apply the order the caller sent');
  assert(
    unlisted?.order === 5,
    `a row absent from the ordered list was restamped to order ${String(unlisted?.order)}`,
  );
  assert(unlisted?.updatedAt === 1, 'a row absent from the ordered list was rewritten at all');

  await db.outlineBeats.bulkDelete(['reorder-listed-a', 'reorder-unlisted', 'reorder-listed-c']);
  await db.outlines.delete(outlineId);
  passed.push('reorder leaves rows outside the ordered list at their existing order');
}

// A margin note anchored on an entity is pure link: when the entity goes, the
// note has nothing left to point at, so it goes too — with its reference row.
// A beat is the author's own text and survives, unlinked.
//
// Old bug: `deleteWriting` took only the snapshots, so every note anchored on
// the chapter stayed behind (unreachable, still counted, still in the backup)
// and `outlineBeats.linkedWritingId` kept pointing at a dead id. `deleteScene`
// had the same hole on the annotation side.
async function testEntityAnnotationCascades(): Promise<void> {
  const { deleteScene } = await import('@/engines/dialog-scene/operations');
  const projectId = 'annotation-cascade-project';
  const now = Date.now();
  const note = (id: string, sourceEngineId: string, sourceEntityId: string) => ({
    id, projectId, sourceEngineId, sourceEntityId,
    anchor: { type: 'entity' as const }, noteType: 'reference' as const,
    isOrphaned: false, position: 0, createdAt: now, updatedAt: now,
  });
  const reference = (id: string, annotationId: string) => ({
    id, annotationId, targetEngineId: 'codex', targetEntityId: 'codex-target', createdAt: now,
  });
  const beat = (id: string, link: { linkedWritingId?: string; linkedSceneId?: string }) => ({
    id, outlineId: 'cascade-outline', projectId, order: 0, level: 'beat' as const,
    title: id, description: '', status: 'outlined' as const,
    createdAt: now, updatedAt: now, ...link,
  });

  await db.outlines.add({ id: 'cascade-outline', projectId, title: 'Cascade', createdAt: now, updatedAt: now });
  await db.writings.bulkAdd([
    { id: 'cascade-writing', projectId, title: 'Doomed chapter', status: 'draft', content: '<p>x</p>', wordCount: 1, tags: [], createdAt: now, updatedAt: now },
    { id: 'cascade-writing-keep', projectId, title: 'Innocent chapter', status: 'draft', content: '<p>y</p>', wordCount: 1, tags: [], createdAt: now, updatedAt: now },
  ]);
  await db.scenes.bulkAdd([
    { id: 'cascade-scene', projectId, title: 'Doomed scene', order: 0, tags: [], createdAt: now, updatedAt: now },
    { id: 'cascade-scene-keep', projectId, title: 'Innocent scene', order: 1, tags: [], createdAt: now, updatedAt: now },
  ]);
  await db.annotations.bulkAdd([
    note('cascade-note-writing', 'writings', 'cascade-writing'),
    note('cascade-note-writing-keep', 'writings', 'cascade-writing-keep'),
    note('cascade-note-scene', 'dialog-scene', 'cascade-scene'),
    note('cascade-note-scene-keep', 'dialog-scene', 'cascade-scene-keep'),
  ]);
  await db.annotationReferences.bulkAdd([
    reference('cascade-ref-writing', 'cascade-note-writing'),
    reference('cascade-ref-writing-keep', 'cascade-note-writing-keep'),
    reference('cascade-ref-scene', 'cascade-note-scene'),
    reference('cascade-ref-scene-keep', 'cascade-note-scene-keep'),
  ]);
  await db.outlineBeats.bulkAdd([
    beat('cascade-beat-writing', { linkedWritingId: 'cascade-writing' }),
    beat('cascade-beat-writing-keep', { linkedWritingId: 'cascade-writing-keep' }),
    beat('cascade-beat-scene', { linkedSceneId: 'cascade-scene' }),
    beat('cascade-beat-scene-keep', { linkedSceneId: 'cascade-scene-keep' }),
  ]);

  await deleteWriting('cascade-writing');
  assert(!(await db.annotations.get('cascade-note-writing')), 'deleting a writing left its margin note behind');
  assert(!(await db.annotationReferences.get('cascade-ref-writing')), 'deleting a writing left an orphan annotation reference');
  assert(await db.annotations.get('cascade-note-writing-keep'), 'deleting a writing swept another writing’s note');
  assert(await db.annotationReferences.get('cascade-ref-writing-keep'), 'deleting a writing swept another writing’s reference');
  assert(
    (await db.outlineBeats.get('cascade-beat-writing'))?.linkedWritingId === undefined,
    'deleting a writing left an outline beat pointing at a dead id',
  );
  assert(
    (await db.outlineBeats.get('cascade-beat-writing-keep'))?.linkedWritingId === 'cascade-writing-keep',
    'deleting a writing unlinked a beat that pointed somewhere else',
  );

  await deleteScene('cascade-scene');
  assert(!(await db.annotations.get('cascade-note-scene')), 'deleting a scene left its margin note behind');
  assert(!(await db.annotationReferences.get('cascade-ref-scene')), 'deleting a scene left an orphan annotation reference');
  assert(await db.annotations.get('cascade-note-scene-keep'), 'deleting a scene swept another scene’s note');
  assert(
    (await db.outlineBeats.get('cascade-beat-scene'))?.linkedSceneId === undefined,
    'deleting a scene left an outline beat pointing at a dead id',
  );
  assert(
    (await db.outlineBeats.get('cascade-beat-scene-keep'))?.linkedSceneId === 'cascade-scene-keep',
    'deleting a scene unlinked a beat that pointed somewhere else',
  );

  await db.annotations.bulkDelete(['cascade-note-writing-keep', 'cascade-note-scene-keep']);
  await db.annotationReferences.bulkDelete(['cascade-ref-writing-keep', 'cascade-ref-scene-keep']);
  await db.outlineBeats.bulkDelete([
    'cascade-beat-writing', 'cascade-beat-writing-keep', 'cascade-beat-scene', 'cascade-beat-scene-keep',
  ]);
  await db.scenes.bulkDelete(['cascade-scene-keep']);
  await db.writings.bulkDelete(['cascade-writing-keep']);
  await db.outlines.delete('cascade-outline');
  passed.push('writing and scene deletion cascades to margin notes and unlinks outline beats');
}

// The Cockpit's "outline beats connected" gauge counted a beat as connected on
// the mere presence of `linkedWritingId`, without checking the writing still
// existed — so a beat holding a stale pointer (a row deleted by an older build,
// or restored from an archive taken by one) kept the coverage up for ever and
// the gauge could only rise. The row is deleted here WITHOUT the engine's own
// unlink precisely to reproduce that stale pointer.
async function testOutlineCoverageIgnoresDeletedWritings(): Promise<void> {
  const projectId = 'outline-coverage-project';
  const now = Date.now();
  await db.projects.put({
    id: projectId, title: 'Coverage', mode: 'novelist', type: 'standalone',
    color: '#7c3aed', description: '', status: 'in-progress',
    enabledEngines: [], engineOrder: [], createdAt: now, updatedAt: now,
  });
  await db.outlines.add({ id: 'coverage-outline', projectId, title: 'Spine', createdAt: now, updatedAt: now });
  await db.writings.bulkAdd([
    { id: 'coverage-writing-1', projectId, title: 'One', status: 'draft', content: '<p>a</p>', wordCount: 1, tags: [], createdAt: now, updatedAt: now },
    { id: 'coverage-writing-2', projectId, title: 'Two', status: 'draft', content: '<p>b</p>', wordCount: 1, tags: [], createdAt: now, updatedAt: now },
  ]);
  await db.outlineBeats.bulkAdd([
    { id: 'coverage-beat-1', outlineId: 'coverage-outline', projectId, order: 0, level: 'beat', title: 'B1', description: '', status: 'outlined', linkedWritingId: 'coverage-writing-1', createdAt: now, updatedAt: now },
    { id: 'coverage-beat-2', outlineId: 'coverage-outline', projectId, order: 1, level: 'beat', title: 'B2', description: '', status: 'outlined', linkedWritingId: 'coverage-writing-2', createdAt: now, updatedAt: now },
  ]);

  const before = await loadProjectCockpit(projectId);
  assert(before.intelligence.outlineCoverage === 100, 'two linked beats out of two must read as full coverage');

  await db.writings.delete('coverage-writing-1');

  const after = await loadProjectCockpit(projectId);
  assert(
    after.intelligence.outlineCoverage === 50,
    `outline coverage must drop when a linked chapter is gone, got ${String(after.intelligence.outlineCoverage)}`,
  );
  assert(
    after.health.find(row => row.id === 'broken-spine-links')?.count === 1,
    'the dead beat link was not reported as a broken narrative link',
  );

  await db.outlineBeats.bulkDelete(['coverage-beat-1', 'coverage-beat-2']);
  await db.writings.delete('coverage-writing-2');
  await db.outlines.delete('coverage-outline');
  await db.projects.delete(projectId);
  passed.push('outline coverage stops counting beats whose writing is gone');
}

// A citation records the day the author consulted the source, and that is a
// calendar day on their wall — not a UTC one. Old bug: the accessed date was
// derived through `toISOString()`, so a snapshot preserved late in the evening
// (or early in the morning, on the other side of UTC) was filed under the
// neighbouring day and `formatCitation` then printed a date the author never
// saw. Both edges of the local day are checked so any non-zero UTC offset in
// the harness reproduces it.
async function testCitationAccessedDayIsLocal(): Promise<void> {
  const projectId = 'citation-date-project';
  const now = Date.now();
  await db.projects.add({
    id: projectId, title: 'Citation dates', mode: 'reporter', type: 'standalone',
    color: '#7c3aed', description: '', status: 'draft', enabledEngines: [],
    engineOrder: [], createdAt: now, updatedAt: now,
  });
  const cases = [
    { id: 'citation-snapshot-early', preservedAt: new Date(2026, 6, 27, 0, 30).getTime() },
    { id: 'citation-snapshot-late', preservedAt: new Date(2026, 6, 27, 23, 30).getTime() },
  ];
  const citationIds: string[] = [];
  for (const { id, preservedAt } of cases) {
    await db.snapshots.add({
      id, projectId, url: 'https://example.com/article', title: 'Article',
      source: 'url', status: 'success', notes: '', tags: [],
      preservedAt, createdAt: preservedAt,
    });
    const citation = await citationFromSnapshot(id);
    citationIds.push(citation.id);
    assert(
      citation.accessedAt === toLocalDateKey(new Date(preservedAt)),
      `accessedAt ${String(citation.accessedAt)} is not the local calendar day of the snapshot`,
    );
    assert(citation.accessedAt === '2026-07-27', 'the local calendar day of the fixture drifted');
    const stored = await db.citations.get(citation.id);
    assert(stored?.accessedAt === citation.accessedAt, 'the citation was stored with a different accessed date');
    // The round trip that the reader actually sees: the stored key is parsed
    // back as a local date, so it must render as the day of the snapshot.
    assert(
      formatCitation(citation, 'mla').includes(new Date(preservedAt).toLocaleDateString('en-US')),
      'the formatted citation shows a different day than the snapshot was preserved on',
    );
  }
  await db.citations.bulkDelete(citationIds);
  await db.snapshots.bulkDelete(cases.map(row => row.id));
  await db.projects.delete(projectId);
  passed.push('citation accessed date is the local day of the snapshot and round-trips');
}

// One row, two owners: the Image Studio writes `imageRoute`, the copilot dock
// writes `chatRoute`, `defaultPolicy` and `remoteConsent`. Old bug: the save
// read the whole row, merged, and put it back outside a transaction, so the
// later of two saves reverted the other's field — and a partial save could
// resurrect stale values it had read before.
async function testCopilotSettingsPartialSaves(): Promise<void> {
  const { getProjectSettings, saveProjectSettings } = await import('@/services/copilot/threads');
  const projectId = 'copilot-settings-project';
  await db.aiProjectSettings.delete(projectId);

  // First save creates the row; a partial save must then leave the rest alone.
  await saveProjectSettings(projectId, { defaultPolicy: 'allow', remoteConsent: true });
  await saveProjectSettings(projectId, { chatRoute: { connectionId: 'c0', modelId: 'm0' } });
  let settings = await getProjectSettings(projectId);
  assert(settings.defaultPolicy === 'allow', 'a partial save cleared the policy it never mentioned');
  assert(settings.remoteConsent === true, 'a partial save cleared the remote consent it never mentioned');
  assert(settings.chatRoute?.modelId === 'm0', 'a partial save did not persist its own field');

  // Two saves of DIFFERENT fields, in flight at the same time: both survive.
  await Promise.all([
    saveProjectSettings(projectId, { chatRoute: { connectionId: 'chat', modelId: 'chat-model' } }),
    saveProjectSettings(projectId, { imageRoute: { connectionId: 'image', modelId: 'image-model' } }),
  ]);
  settings = await getProjectSettings(projectId);
  assert(settings.chatRoute?.modelId === 'chat-model', 'a concurrent save reverted the chat route');
  assert(settings.imageRoute?.modelId === 'image-model', 'a concurrent save reverted the image route');
  assert(
    settings.defaultPolicy === 'allow' && settings.remoteConsent === true,
    'concurrent partial saves reverted a field neither of them mentioned',
  );

  await db.aiProjectSettings.delete(projectId);
  passed.push('copilot project settings survive partial and concurrent saves');
}

// The legacy `fullExport: true` JSON only ever carried sixteen tables. Old bug:
// the restore cleared the WHOLE database first, so importing one of those files
// silently destroyed every engine added since — diary, notes, outline, seeds —
// with nothing in the payload to put back. It is a partial restore, and only
// the tables the payload actually carries may be replaced.
async function testLegacyFullImportKeepsTablesItDoesNotCarry(): Promise<void> {
  const { importFullDatabase } = await import('@/db/operations');
  const projectId = 'legacy-import-project';
  const now = Date.now();
  await db.diaryEntries.put({
    id: 'legacy-diary', projectId, entryDate: '2026-07-27T10:00', title: 'Survivor',
    content: '<p>still here</p>', tags: [], pinned: false, createdAt: now, updatedAt: now,
  });
  await db.writings.put({
    id: 'legacy-writing-old', projectId, title: 'Replaced', status: 'draft',
    content: '<p>old</p>', wordCount: 1, tags: [], createdAt: now, updatedAt: now,
  });

  await importFullDatabase({
    version: 1,
    fullExport: true,
    exportedAt: now,
    writings: [{
      id: 'legacy-writing-new', projectId, title: 'Restored', status: 'draft',
      content: '<p>new</p>', wordCount: 1, tags: [], createdAt: now, updatedAt: now,
    }],
  } as unknown as Parameters<typeof importFullDatabase>[0]);

  assert(
    (await db.diaryEntries.get('legacy-diary'))?.title === 'Survivor',
    'a legacy import cleared a table its payload cannot restore',
  );
  assert(
    !(await db.writings.get('legacy-writing-old')),
    'a legacy import did not replace the table its payload does carry',
  );
  assert(
    (await db.writings.get('legacy-writing-new'))?.title === 'Restored',
    'a legacy import did not load the rows it carried',
  );

  await db.diaryEntries.delete('legacy-diary');
  await db.writings.delete('legacy-writing-new');
  passed.push('legacy full-export import only replaces the tables it carries');
}


// A delete has to be takeable back WHOLE: the chapter, its entire version
// history, the margin notes anchored on it, and the outline beats it was
// linked to. `writingSnapshots` is never pruned, so losing that history with
// the row loses the only durable copy of everything the chapter used to say.
//
// The bundle slot is armed BY ID. Old bug: it was a single unnamed slot, so
// `takeLastDeletedWriting()` handed back whatever the LAST delete had produced
// — a delete landing between the writer's own delete and the Undo bar picking
// its bundle up (the AI bridge answering a client, another window) meant the
// Undo bar restored a chapter into a different project. Now asking for one id
// can only ever yield that id's bundle, or nothing.
async function testWritingDeleteIsRestorable(): Promise<void> {
  const projectId = 'writing-undo-project';
  const otherProjectId = 'writing-undo-other-project';
  const writingId = 'undo-writing';
  const otherWritingId = 'undo-other-writing';
  const now = Date.now();

  await db.writings.bulkAdd([
    { id: writingId, projectId, title: 'Doomed chapter', status: 'draft', content: '<p>La torre negra</p>', wordCount: 3, tags: [], createdAt: now, updatedAt: now },
    { id: otherWritingId, projectId: otherProjectId, title: 'Another project', status: 'draft', content: '<p>Otra</p>', wordCount: 1, tags: [], createdAt: now, updatedAt: now },
  ]);
  await db.writingSnapshots.bulkAdd([
    { id: 'undo-snapshot-1', writingId, projectId, title: 'Doomed chapter', content: '<p>v1</p>', wordCount: 1, reason: 'manual', createdAt: now - 2 },
    { id: 'undo-snapshot-2', writingId, projectId, title: 'Doomed chapter', content: '<p>v2</p>', wordCount: 1, reason: 'auto', createdAt: now - 1 },
  ]);
  await db.annotations.add({
    id: 'undo-note', projectId, sourceEngineId: 'writings', sourceEntityId: writingId,
    anchor: { type: 'entity' }, noteType: 'reference', isOrphaned: false,
    position: 0, createdAt: now, updatedAt: now,
  });
  await db.annotationReferences.add({
    id: 'undo-note-ref', annotationId: 'undo-note',
    targetEngineId: 'codex', targetEntityId: 'codex-target', createdAt: now,
  });
  await db.outlines.add({ id: 'undo-outline', projectId, title: 'Spine', createdAt: now, updatedAt: now });
  await db.outlineBeats.add({
    id: 'undo-beat', outlineId: 'undo-outline', projectId, order: 0, level: 'beat',
    title: 'Linked beat', description: '', status: 'outlined',
    linkedWritingId: writingId, createdAt: now, updatedAt: now,
  });

  // A delete nobody armed parks nothing — the AI bridge's deletes must not pin
  // a whole manuscript in the heap waiting for an Undo bar that does not exist.
  expectDeletedWriting(writingId);
  const unarmed = await deleteWritingRestorable(otherWritingId);
  assert(unarmed?.writing.projectId === otherProjectId, 'an unarmed delete must still report what it removed');
  assert(takeLastDeletedWriting(otherWritingId) === null, 'a delete nobody armed parked a bundle anyway');

  const returned = await deleteWritingRestorable(writingId);
  assert(returned, 'deleting an existing writing must hand back its bundle');
  assert(returned.snapshots.length === 2, `the bundle carried ${returned.snapshots.length} snapshots, not the whole history`);
  assert(returned.annotations.length === 1, 'the bundle lost the margin note anchored on the chapter');
  assert(returned.annotationReferences.length === 1, 'the bundle lost the reference row hanging off that note');
  assert(returned.unlinkedBeatIds.join(',') === 'undo-beat', 'the bundle did not record the beat it unlinked');
  assert(!(await db.writings.get(writingId)), 'the writing was not deleted');
  assert((await db.writingSnapshots.where('writingId').equals(writingId).count()) === 0, 'the version history was not deleted');
  assert(!(await db.annotations.get('undo-note')), 'the margin note was not deleted');
  assert(!(await db.annotationReferences.get('undo-note-ref')), 'the annotation reference was not deleted');
  assert((await db.outlineBeats.get('undo-beat'))?.linkedWritingId === undefined, 'the outline beat was not unlinked');

  // The armed slot answers to ONE id: this is the cross-project restore bug.
  assert(takeLastDeletedWriting(otherWritingId) === null, 'the undo slot handed one writing’s id another writing’s bundle');
  const bundle = takeLastDeletedWriting(writingId);
  assert(bundle, 'the armed id could not collect its own bundle');
  assert(takeLastDeletedWriting(writingId) === null, 'the bundle must be one-shot');

  await restoreDeletedWriting(bundle);
  assert((await db.writings.get(writingId))?.title === 'Doomed chapter', 'the writing did not come back');
  assert((await db.writingSnapshots.where('writingId').equals(writingId).count()) === 2, 'the version history did not come back');
  assert(await db.annotations.get('undo-note'), 'the margin note did not come back');
  assert(await db.annotationReferences.get('undo-note-ref'), 'the annotation reference did not come back');
  assert((await db.outlineBeats.get('undo-beat'))?.linkedWritingId === writingId, 'the outline beat was not relinked');

  // Idempotent by construction — every row goes back with put/bulkPut, so a
  // double-click on Undo (or a re-render that restores again) changes nothing.
  await restoreDeletedWriting(bundle);
  assert((await db.writingSnapshots.where('writingId').equals(writingId).count()) === 2, 'a second restore duplicated the version history');
  assert(
    (await db.annotations.where('[sourceEngineId+sourceEntityId]').equals(['writings', writingId]).count()) === 1,
    'a second restore duplicated the margin note',
  );

  await db.writings.delete(writingId);
  await db.writingSnapshots.bulkDelete(['undo-snapshot-1', 'undo-snapshot-2']);
  await db.annotations.delete('undo-note');
  await db.annotationReferences.delete('undo-note-ref');
  await db.outlineBeats.delete('undo-beat');
  await db.outlines.delete('undo-outline');
  passed.push('deleted writing restores its history, notes and beats; the undo slot is armed by id');
}

// Several settings values are JSON collections changed one member at a time —
// the dismissed proofreader findings, the saved searches, the sprint log.
//
// Old bug: that was `getSetting` → mutate → `setSetting`, two awaits apart. Two
// overlapping calls both read the same starting value and the later write
// dropped the earlier one: a dismissal that came back, a saved search that
// never arrived. The read and the write are now one transaction, which
// IndexedDB serialises against any other write to the same store.
async function testConcurrentSettingUpdatesBothSurvive(): Promise<void> {
  const { getSetting, updateSetting } = await import('@/db/operations');
  const key = 'critical.updateSetting.concurrent';
  await db.settings.where('key').equals(key).delete();

  // The update callback must stay synchronous: it runs INSIDE the transaction.
  const addMember = (member: string) => (current: string | undefined): string => {
    const members = current ? (JSON.parse(current) as string[]) : [];
    return JSON.stringify(members.includes(member) ? members : [...members, member]);
  };

  await Promise.all([
    updateSetting(key, addMember('alpha')),
    updateSetting(key, addMember('beta')),
  ]);

  const stored = JSON.parse((await getSetting(key)) ?? '[]') as string[];
  assert(stored.includes('alpha'), 'a concurrent setting update dropped the first member');
  assert(stored.includes('beta'), 'a concurrent setting update dropped the second member');
  assert(stored.length === 2, `expected exactly two members, got ${JSON.stringify(stored)}`);
  assert(
    (await db.settings.where('key').equals(key).count()) === 1,
    'a concurrent setting update wrote a second row for the same key',
  );

  await db.settings.where('key').equals(key).delete();
  passed.push('two concurrent updates of one settings key both survive');
}

// `settings` is a flat key/value store with no `projectId` index, so the
// generic per-project sweep cannot see it: the sprint log, the live sprint, the
// dismissed findings, the saved searches and the grounded-AI flags used to
// outlive their project — and be INHERITED by a re-import that reused its id.
// Both paths that wipe a project now sweep exactly `projectSettingKeys(id)`:
// `deleteProject`, and the ZIP restore's `clearProjectForRestore`.
async function testProjectSweepsItsSettingsKeys(): Promise<void> {
  const { deleteProject, getSetting, projectSettingKeys, setSetting } = await import('@/db/operations');
  const now = Date.now();
  const scratchProject = (id: string, title: string) => ({
    id, title, mode: 'novelist' as const, type: 'standalone' as const,
    color: '#7c3aed', description: '', status: 'in-progress' as const,
    enabledEngines: [], engineOrder: [], createdAt: now, updatedAt: now,
  });

  const projectId = 'settings-sweep-project';
  // Its id STARTS WITH the doomed one: the sweep matches whole keys, never a
  // prefix, so this project's rows must be untouched.
  const neighbourId = `${projectId}-2`;
  const doomedKeys = projectSettingKeys(projectId);
  assert(doomedKeys.length >= 3, 'the per-project settings declaration lost its keys');

  await db.projects.put(scratchProject(projectId, 'Doomed'));
  await db.projects.put(scratchProject(neighbourId, 'Neighbour'));
  for (const key of doomedKeys) await setSetting(key, '["seeded"]');
  for (const key of projectSettingKeys(neighbourId)) await setSetting(key, '["neighbour"]');

  await deleteProject(projectId);
  for (const key of doomedKeys) {
    assert(await getSetting(key) === undefined, `project deletion left the settings key ${key} behind`);
  }
  for (const key of projectSettingKeys(neighbourId)) {
    assert(await getSetting(key) === '["neighbour"]', `project deletion swept a neighbouring project's key ${key}`);
  }

  // Same sweep on the ZIP restore path: a project archive carries no
  // settings.json at all, so anything left here is the PREVIOUS instance's.
  const zipProjectId = 'settings-sweep-zip-project';
  await db.projects.put(scratchProject(zipProjectId, 'Archivable'));
  const { blob, fileName } = await createProjectZipArchive(zipProjectId);
  const archive = new File([blob], fileName, { type: 'application/zip' });
  // Renaming locally is how the assertion below tells a real replacement from
  // an import that quietly did nothing.
  await db.projects.update(zipProjectId, { title: 'Locally renamed' });
  for (const key of projectSettingKeys(zipProjectId)) await setSetting(key, '["stale"]');

  await importProjectZip(archive, { replaceProjectIds: [zipProjectId] });
  assert(
    (await db.projects.get(zipProjectId))?.title === 'Archivable',
    'the approved replacement did not restore the archived project',
  );
  for (const key of projectSettingKeys(zipProjectId)) {
    assert(
      await getSetting(key) === undefined,
      `a project restored over itself inherited the settings key ${key}`,
    );
  }

  await deleteProject(zipProjectId);
  await deleteProject(neighbourId);
  passed.push('project deletion and ZIP replacement both sweep the per-project settings keys');
}

// Old bug: the thirds were cut from EVERY writing row. `compareManuscriptOrder`
// parks a chapter with no number at the end, so a project mixing twelve
// numbered chapters with eight unnumbered idea stubs had a "closing third" made
// of empty stubs — nobody appears there, so every main character in the opening
// chapters was reported as disappearing and the panel was useless. The thirds
// are now cut from the rows that actually carry prose.
async function testDisappearingCharactersReadsProseOnly(): Promise<void> {
  const { findDisappearingCharacters } = await import('@/services/proofreader');

  const chapter = (index: number, appearances: string[]): ProofreaderWritingRow => ({
    id: `thirds-chapter-${index}`,
    title: `Capítulo ${index}`,
    status: 'draft',
    chapter: index,
    createdAt: index,
    updatedAt: index,
    hasProse: true,
    appearances: new Set(appearances),
  });
  const stub = (id: string, status: 'idea' | 'draft', hasProse: boolean): ProofreaderWritingRow => ({
    id, title: id, status, createdAt: 100, updatedAt: 100, hasProse, appearances: new Set<string>(),
  });

  // Aurelia is in the first three chapters and then gone; the other two run
  // through the whole book. Manuscript order, exactly as `collectProofreaderInput`
  // hands it over: numbered chapters first, unnumbered rows parked at the end.
  const writings: ProofreaderWritingRow[] = [
    ...Array.from({ length: 12 }, (_unused, index) => chapter(
      index + 1,
      index < 3
        ? ['codex-marta', 'codex-bruno', 'codex-aurelia']
        : ['codex-marta', 'codex-bruno'],
    )),
    // Both kinds of row the filter drops: ideas (even ones with some text in
    // them) and drafts that are still empty. Neither is a page of the book.
    stub('thirds-idea-1', 'idea', true),
    stub('thirds-idea-2', 'idea', true),
    stub('thirds-idea-3', 'idea', false),
    stub('thirds-idea-4', 'idea', false),
    stub('thirds-empty-1', 'draft', false),
    stub('thirds-empty-2', 'draft', false),
    stub('thirds-empty-3', 'draft', false),
    stub('thirds-empty-4', 'draft', false),
  ];

  const input: ProofreaderInput = {
    projectId: 'proofreader-thirds-project',
    mode: 'novelist',
    enabledEngines: ['writings', 'codex'],
    todayKey: '2026-08-31',
    writings,
    codexEntries: [
      { id: 'codex-marta', type: 'character', title: 'Marta Ovalle' },
      { id: 'codex-bruno', type: 'character', title: 'Bruno Salas' },
      { id: 'codex-aurelia', type: 'character', title: 'Aurelia Vega' },
    ],
    scenes: [],
    blocks: [],
    casts: [],
    outlineBeats: [],
    seeds: [],
    payoffs: [],
    relationships: [],
    timelineEventIds: new Set<string>(),
  };

  const findings = findDisappearingCharacters(input);
  assert(
    !findings.some(finding => finding.entityId === 'codex-marta' || finding.entityId === 'codex-bruno'),
    'a character present in the last chapters was reported as disappearing',
  );
  assert(findings.length === 1, `expected only the character who really vanishes, got ${findings.length}`);
  assert(findings[0].id === 'character-disappears:codex-aurelia', 'the finding identity changed');
  assert(findings[0].engineId === 'codex' && findings[0].entityId === 'codex-aurelia', 'the finding does not point at the codex entry');
  assert(findings[0].severity === 'warning', 'a character with three appearances is a recurring one, not a walk-on');

  // Below three rows of prose, "first third" and "last third" mean nothing.
  assert(
    findDisappearingCharacters({ ...input, writings: writings.slice(0, 2) }).length === 0,
    'a two-chapter manuscript cannot have thirds',
  );

  passed.push('disappearing-character check cuts its thirds from prose, not from idea stubs');
}

// Old bug: the outline checks reported one row per entity even when the reason
// was the same for every one of them. A project with nine chapters and three
// beats, none of them linked — which is every project on the day the outline is
// written — produced nine identical "no beat links to this chapter" findings
// plus three identical "this beat links to nothing", burying the two checks that
// had found something real. A check that fires for EVERY eligible row is
// describing a habit, not a list of omissions, and now says so once.
async function testOutlineChecksCollapseWhenNothingIsLinkedYet(): Promise<void> {
  const { findWritingsOutsideOutline, findBeatsWithoutScene } = await import('@/services/proofreader');

  const writing = (index: number, status: 'draft' | 'finished' | 'idea'): ProofreaderWritingRow => ({
    id: `collapse-writing-${index}`,
    title: `Capítulo ${index}`,
    status,
    chapter: index,
    createdAt: index,
    updatedAt: index,
    hasProse: true,
    appearances: new Set<string>(),
  });
  const beat = (index: number, links?: { writing?: string; scene?: string }) => ({
    id: `collapse-beat-${index}`,
    projectId: 'collapse-project',
    title: `Hito ${index}`,
    description: '',
    order: index,
    actId: 'collapse-act',
    linkedWritingId: links?.writing,
    linkedSceneId: links?.scene,
    createdAt: index,
    updatedAt: index,
  } as unknown as ProofreaderInput['outlineBeats'][number]);

  const base: ProofreaderInput = {
    projectId: 'collapse-project',
    mode: 'novelist',
    enabledEngines: ['writings', 'outline'],
    todayKey: '2026-08-31',
    writings: [writing(1, 'draft'), writing(2, 'draft'), writing(3, 'finished'), writing(4, 'idea')],
    codexEntries: [],
    scenes: [],
    blocks: [],
    casts: [],
    outlineBeats: [beat(1), beat(2), beat(3)],
    seeds: [],
    payoffs: [],
    relationships: [],
    timelineEventIds: new Set<string>(),
  };

  // Nothing linked anywhere: one finding per check, not one per row.
  const orphaned = findWritingsOutsideOutline(base);
  assert(orphaned.length === 1, `expected one collapsed finding, got ${orphaned.length}`);
  assert(orphaned[0].id === 'writing-outside-outline:none-linked', 'the collapsed finding identity changed');
  assert(orphaned[0].severity === 'info', 'an outline nobody has started linking is not a warning');
  assert(orphaned[0].route === 'outline', 'the collapsed finding must open the spine, not an entity');
  assert(orphaned[0].detail.includes('3') && orphaned[0].detail.includes('3'), 'the collapsed finding must carry the counts');

  const empty = findBeatsWithoutScene(base);
  assert(empty.length === 1, `expected one collapsed beat finding, got ${empty.length}`);
  assert(empty[0].id === 'beat-without-scene:none-linked', 'the collapsed beat finding identity changed');
  assert(empty[0].route === 'outline', 'the collapsed beat finding must open the spine');

  // One link is enough to make the rest real omissions again: the writer HAS
  // started, so the ones left behind are worth naming individually.
  const started: ProofreaderInput = {
    ...base,
    outlineBeats: [beat(1, { writing: 'collapse-writing-1' }), beat(2), beat(3)],
  };
  const named = findWritingsOutsideOutline(started);
  assert(named.length === 2, `expected the two unlinked chapters by name, got ${named.length}`);
  assert(
    named.every(finding => finding.id.startsWith('writing-outside-outline:collapse-writing-')),
    'a per-chapter finding must still name its chapter',
  );
  assert(
    !named.some(finding => finding.entityId === 'collapse-writing-4'),
    'an idea is not a chapter missing from the outline',
  );
  assert(
    named.some(finding => finding.entityId === 'collapse-writing-3' && finding.severity === 'warning'),
    'a FINISHED chapter outside the outline is still a warning',
  );

  const stillOpen = findBeatsWithoutScene(started);
  assert(stillOpen.length === 2, `expected the two empty beats by name, got ${stillOpen.length}`);

  // A pointer at a deleted chapter is dead data, never a habit: it keeps its
  // own row and its own fix even when every other beat is empty.
  const broken = findBeatsWithoutScene({
    ...base,
    outlineBeats: [beat(1, { writing: 'deleted-chapter' }), beat(2), beat(3)],
  });
  assert(
    broken.some(finding => finding.id === 'beat-without-scene:broken:collapse-beat-1' && Boolean(finding.fix)),
    'a dead pointer must keep its own repairable finding',
  );
  assert(broken.length === 3, `a dead pointer must stop the collapse, got ${broken.length} findings`);

  // Below the threshold, naming each row is still the clearest report.
  const tiny = findWritingsOutsideOutline({
    ...base,
    writings: [writing(1, 'draft'), writing(2, 'draft')],
    outlineBeats: [beat(1)],
  });
  assert(tiny.length === 2, `two chapters is a list, not a habit, got ${tiny.length}`);

  passed.push('outline checks collapse to one finding when the project links nothing yet');
}

// Old bug: reading progress was measured from the TOP of the viewport, so a
// manuscript short enough to fit on one screen could not be scrolled at all and
// sat at 0 % however long it was read — and the last screenful of any book was
// unreachable, leaving a finished manuscript short of 100 %.
async function testReadingProgressCountsWhatIsOnScreen(): Promise<void> {
  const { readOffset, manuscriptProgress, positionAt } = await import('@/engines/writings/readingWindow');

  // One piece, 400px tall, in an 800px viewport: the whole book is on screen.
  const one = () => 400;
  const fitsOnScreen = positionAt(readOffset(0, 800, 400), 1, one);
  assert(
    manuscriptProgress(fitsOnScreen, [0, 500], 500) === 1,
    'a manuscript that fits on one screen must read 100 %, not 0 %',
  );

  // Three 1 000px chapters of 100 words each, in a 500px viewport. Scrolled to
  // the very bottom, `scrollTop` is 2 500 — a viewport short of the end.
  const three = () => 1000;
  const prefixes = [0, 100, 200, 300];
  const atBottom = positionAt(readOffset(2500, 500, 3000), 3, three);
  assert(
    manuscriptProgress(atBottom, prefixes, 300) === 1,
    'the end of the manuscript must read 100 %',
  );

  // …and the reader has genuinely read more than the top of the viewport says.
  const fromTop = manuscriptProgress(positionAt(1000, 3, three), prefixes, 300);
  const fromBottom = manuscriptProgress(positionAt(readOffset(1000, 500, 3000), 3, three), prefixes, 300);
  assert(fromBottom > fromTop, 'progress must count the screenful the reader can see');
  assert(Math.abs(fromBottom - 0.5) < 1e-9, `expected half the book read, got ${fromBottom}`);

  // Degenerate inputs stay in range instead of throwing or overshooting.
  assert(readOffset(0, 800, 0) === 0, 'an empty manuscript has no read offset');
  assert(readOffset(-50, -50, 1000) === 0, 'a negative scroll must not read backwards');
  assert(readOffset(9999, 800, 1000) === 1000, 'the read offset must never pass the end');

  passed.push('reading progress is measured from the bottom of the viewport');
}

// The proofreader's `seed-without-payoff` finding exists to provoke exactly one
// action — naming the place where the seed finally lands — and the seeds card
// now performs it without opening the seed at all. `buildQuickPayoff` is that
// step: two dropdown ids in, the row that closes the orphan out.
//
// The rule worth pinning is the one about stale ids. Those two lists are the
// only statement of what the writer was offered; an id missing from one means
// the chapter or scene went away between the render and the click, and writing
// it onto the payoff anyway would mint precisely the dead reference the
// proofreader is there to catch — while the other half of the choice, still
// live, has to survive on its own.
async function testOrphanSeedClosesInOneStep(): Promise<void> {
  const { buildQuickPayoff } = await import('@/engines/seeds/quickPayoff');
  const { computeSeedStatus } = await import('@/engines/seeds/types');

  const seed = {
    id: 'seed/raven',
    projectId: 'seed-quick-payoff-project',
    title: 'The raven on the windowsill',
    description: '',
    kind: 'foreshadow' as const,
    status: 'planted' as const,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const writings = [{ id: 'w/6', label: 'Chapter 6' }, { id: 'w/7', label: 'Chapter 7' }];
  const scenes = [{ id: 'sc/3', label: '#3 The duel' }];
  const build = (writingId: string, sceneId: string, offered = { writings, scenes }) =>
    buildQuickPayoff({
      seed,
      writingId,
      sceneId,
      writings: offered.writings,
      scenes: offered.scenes,
      titleTemplate: 'Pays off in {target}',
      id: 'payoff/quick',
      now: 4242,
    });

  assert(build('', '') === null, 'a payoff was built for a target the writer never chose');
  assert(build('w/deleted', '') === null, 'a payoff was linked to a chapter that is no longer on offer');

  const both = build('w/7', 'sc/3');
  assert(both !== null, 'picking a chapter and a scene produced no payoff at all');
  assert(
    both?.seedId === 'seed/raven' && both?.projectId === 'seed-quick-payoff-project',
    'the quick payoff lost the seed it closes or the project it belongs to',
  );
  assert(
    both?.linkedWritingId === 'w/7' && both?.linkedSceneId === 'sc/3',
    'the quick payoff dropped one of the two targets the writer picked',
  );
  assert(
    both?.title === 'Pays off in Chapter 7 · #3 The duel',
    `the quick payoff titled itself "${String(both?.title)}"`,
  );
  assert(both?.locationLabel === 'Chapter 7 · #3 The duel', 'the quick payoff did not record where it lands');
  assert(
    both?.strength === 3 && both?.createdAt === 4242 && both?.updatedAt === 4242,
    'the quick payoff no longer lands as a middling, freshly stamped row',
  );

  // Half a stale choice is still a whole answer: the scene vanished, the
  // chapter the writer picked has to outlive it.
  const chapterOnly = build('w/7', 'sc/gone');
  assert(chapterOnly !== null, 'a dead scene id took the live chapter down with it');
  assert(
    chapterOnly?.linkedWritingId === 'w/7' && chapterOnly?.linkedSceneId === undefined,
    'a scene id that was no longer on offer was written onto the payoff anyway',
  );
  assert(chapterOnly?.locationLabel === 'Chapter 7', 'a dropped scene left its separator behind');

  // An untitled chapter is a real row with nothing to read: it must link
  // without padding the label with an empty half.
  const untitled = build('w/blank', 'sc/3', { writings: [{ id: 'w/blank', label: '  ' }], scenes });
  assert(untitled?.linkedWritingId === 'w/blank', 'an untitled chapter could not be pointed at');
  assert(
    untitled?.locationLabel === '#3 The duel',
    `an untitled chapter padded the label: "${String(untitled?.locationLabel)}"`,
  );

  // The point of the whole action: the card reads back as paid off with no seed
  // row touched — and a seed the author cut stays cut, payoff or no payoff.
  assert(computeSeedStatus(seed, []) === 'orphaned', 'the seed under test was not an orphan to begin with');
  assert(
    computeSeedStatus(seed, both ? [both] : []) === 'paid',
    'the payoff the card creates does not close the orphan',
  );
  assert(
    computeSeedStatus({ ...seed, status: 'cut' as const }, both ? [both] : []) === 'cut',
    'a cut seed was resurrected by a quick payoff',
  );

  passed.push('quick payoff closes an orphan seed against the targets the picker actually offered');
}

// `Writing.chapter` is the manuscript's only order, and the manuscript import
// appends after the highest number the project already used — a forty-chapter
// novel brought into six scratch drafts arrives as chapters 7..46. Both ways
// back from that are planned by pure functions in `chapterOrder.ts`, and this
// is where they are held to what the view promises about them.
//
// Three rules are load-bearing.
//
//   A move must MOVE. Two chapters both numbered 7 is the shape that makes an
//   arrow a no-op: exchanging their numbers writes 7 to both, the tie falls
//   back to `id`, and the button sits enabled forever doing nothing. The
//   timeline's lane reorder was rewritten once already for exactly this.
//
//   A move must not renumber. A writer numbering 1, 2, 5, 9 left room at 3
//   and 4 on purpose, and an arrow press is not permission to take it away.
//
//   Renumbering must be idempotent. The view disables the button on an empty
//   plan and tells the writer nothing else changes; both statements are only
//   true if a second pass over an already-numbered book plans no writes — the
//   one thing standing between a renumber and forty rows stamped with a fresh
//   `updatedAt` in the "changed recently" panel.
async function testChapterOrderPlans(): Promise<void> {
  const { moveChapter, numberedInOrder, renumberChapters } =
    await import('@/engines/writings/chapterOrder');

  interface Row { id: string; chapter?: number }
  interface Plan { id: string; chapter: number }

  const rows = (...pairs: Array<[string, number | undefined]>): Row[] =>
    pairs.map(([id, chapter]) => ({ id, chapter }));

  /** The plan applied, the way `applyChapterNumbers` writes one. */
  const apply = (base: Row[], plan: readonly Plan[]): Row[] => {
    const byId = new Map(plan.map(item => [item.id, item.chapter]));
    return base.map(row => {
      const next = byId.get(row.id);
      return next === undefined ? row : { ...row, chapter: next };
    });
  };

  /** The manuscript as the list would read it: `id:number`, in order. */
  const reads = (base: Row[]): string =>
    numberedInOrder(base).map(row => `${row.id}:${row.chapter}`).join(',');

  // ── A move is an exchange of two numbers, and keeps the gaps ──
  const spaced = rows(['a', 1], ['b', 2], ['c', 5], ['d', 9], ['idea', undefined]);
  const lifted = moveChapter(spaced, 'c', -1);
  assert(lifted.length === 2, `moving one chapter rewrote ${lifted.length} rows, not two`);
  assert(
    reads(apply(spaced, lifted)) === 'a:1,c:2,b:5,d:9',
    `a move renumbered the book: ${reads(apply(spaced, lifted))}`,
  );
  assert(
    apply(spaced, lifted).find(row => row.id === 'idea')?.chapter === undefined,
    'a move gave a number to a writing that had none',
  );

  // Down is up's inverse, so the pair of them leaves the book as it was.
  const there = apply(spaced, moveChapter(spaced, 'b', 1));
  assert(
    reads(apply(there, moveChapter(there, 'b', -1))) === reads(spaced),
    'down then up did not put the chapter back',
  );

  // ── Totality: nothing here throws, and nothing off the ends moves ──
  assert(moveChapter(spaced, 'a', -1).length === 0, 'the first chapter moved up out of the book');
  assert(moveChapter(spaced, 'd', 1).length === 0, 'the last chapter moved down out of the book');
  assert(moveChapter(spaced, 'idea', -1).length === 0, 'an unnumbered writing was given a place');
  assert(moveChapter(spaced, 'gone', 1).length === 0, 'an id the project does not hold planned a write');
  assert(moveChapter([], 'a', 1).length === 0 && renumberChapters([]).length === 0, 'an empty project planned a write');

  // ── Duplicates: the move has to take, not tie ──
  const tied = rows(['p', 7], ['q', 7]);
  const untied = apply(tied, moveChapter(tied, 'q', -1));
  assert(reads(untied) === 'q:7,p:8', `two chapters numbered 7 did not come apart: ${reads(untied)}`);

  // ── Renumbering: 1..n over what is numbered, and nothing else ──
  const imported = rows(['old', 1], ['ch1', 7], ['ch2', 8], ['ch3', 9], ['stub', undefined]);
  const numbered = apply(imported, renumberChapters(imported));
  assert(
    reads(numbered) === 'old:1,ch1:2,ch2:3,ch3:4',
    `renumbering did not produce 1..n in the order it found: ${reads(numbered)}`,
  );
  assert(
    numbered.find(row => row.id === 'stub')?.chapter === undefined,
    'renumbering turned an idea into a chapter',
  );

  // The claim the confirmation dialog makes, and the button's disabled state.
  assert(
    renumberChapters(numbered).length === 0,
    'renumbering twice rewrote rows the second time — the plan is not idempotent',
  );

  passed.push('chapter moves exchange numbers without renumbering, and renumbering is idempotent');
}

// The spine's one verb. Turning a beat into the chapter that writes it used to
// be six screens of hand-work, so the writer did it once and then stopped —
// which is why every project the proofreader looked at had an outline linked to
// nothing. Two rules are load-bearing here and neither is visible in the UI: a
// second press must not mint a second chapter, and the beat's description must
// reach the SYNOPSIS rather than the page, because a plan in the writer's
// shorthand is not prose they wrote.
async function testWritingABeatCreatesOneLinkedChapter(): Promise<void> {
  const { writeChapterForBeat, beatNeedsChapter, chapterTitleFromBeat } =
    await import('@/engines/outline/beatToChapter');
  const { db } = await import('@/db');

  const projectId = 'beat-to-chapter-project';
  const beat = {
    id: 'beat-to-chapter-1',
    projectId,
    outlineId: 'beat-to-chapter-outline',
    title: 'Aurelia quema la carta',
    description: 'Se queda sola en la cocina. No se lo cuenta a Marek.',
    order: 0,
    level: 0,
    status: 'planned',
    createdAt: 1,
    updatedAt: 1,
  } as unknown as Parameters<typeof writeChapterForBeat>[0];

  await db.outlineBeats.put(beat as never);
  // A chapter already numbered 4, so the append-only rule has something to
  // append after — a beat written out of order must not renumber written work.
  await db.writings.put({
    id: 'beat-to-chapter-existing', projectId, title: 'Capítulo cuatro', status: 'draft',
    content: '<p>ya escrito</p>', wordCount: 2, chapter: 4, tags: [], createdAt: 1, updatedAt: 1,
  } as never);

  try {
    assert(beatNeedsChapter(beat, new Set<string>()), 'an unlinked beat needs a chapter');

    const first = await writeChapterForBeat(beat);
    assert(first.chapter === 5, `the chapter must append after the highest number, got ${first.chapter}`);
    assert(first.title === 'Aurelia quema la carta', 'the chapter takes the beat title');

    const created = await db.writings.get(first.writingId);
    assert(Boolean(created), 'the chapter was not written');
    assert(created?.status === 'draft', 'a chapter minted from a beat starts as a draft');
    assert(created?.content === '', 'the beat description must NOT be written into the page as prose');
    assert(
      created?.synopsis === 'Se queda sola en la cocina. No se lo cuenta a Marek.',
      'the beat description belongs in the synopsis',
    );
    assert(created?.wordCount === 0, 'an empty page has no words');

    const linked = await db.outlineBeats.get(beat.id);
    assert(
      (linked as { linkedWritingId?: string } | undefined)?.linkedWritingId === first.writingId,
      'the beat was not linked to the chapter it just created',
    );
    assert(
      !beatNeedsChapter(linked as never, new Set([first.writingId])),
      'a beat with a live chapter must stop offering to write one',
    );

    // The double click. The second call reads committed state inside its own
    // transaction, so it hands back the same row instead of a duplicate.
    const second = await writeChapterForBeat(linked as never);
    assert(second.writingId === first.writingId, 'a second press minted a second chapter');
    const all = await db.writings.where('projectId').equals(projectId).toArray();
    assert(all.length === 2, `expected the existing chapter plus one new one, got ${all.length}`);

    // A pointer at a deleted chapter is not "written": the action comes back.
    assert(
      beatNeedsChapter(linked as never, new Set(['some-other-id'])),
      'a beat pointing at a deleted chapter must offer to write one again',
    );

    // A beat with no title of its own still mints a findable row: the first
    // LINE of the plan, not the whole plan, because a description is often a
    // paragraph and a chapter list is not the place to read one.
    assert(
      chapterTitleFromBeat(
        { ...beat, title: '   ', description: 'Quema la carta.\nMarek no lo sabe.' } as never,
        7,
      ) === 'Quema la carta.',
      'an untitled beat falls back to the first line of its description',
    );
    assert(
      chapterTitleFromBeat({ ...beat, title: '   ' } as never, 7)
        === 'Se queda sola en la cocina. No se lo cuenta a Marek.',
      'a one-line description is used whole',
    );
    assert(
      chapterTitleFromBeat({ ...beat, title: '', description: '' } as never, 7) === '7',
      'a beat with nothing to say still gets a title',
    );
  } finally {
    await db.writings.where('projectId').equals(projectId).delete();
    await db.outlineBeats.delete(beat.id);
  }

  passed.push('writing a beat creates exactly one linked chapter, with the plan in its synopsis');
}

// ===========================================================================
// The compile/publish path — the one artefact that leaves the app
// ===========================================================================
//
// A defect anywhere below is invisible from inside Writers Hoard: the list on
// screen still looks right, and the file is already in an editor's inbox. So
// these three hold the export to the three things a writer assumes about it
// without ever checking — that the chapters are in the order the list shows,
// that the file opens at all, and that the words in it are the words typed.

/**
 * ORDER. `compareManuscriptOrder` is the manuscript's only order, and the
 * export has to be in it.
 *
 * `defaultPublishingOrder` used to be a second, hand-written comparator —
 * chapter, then `createdAt`, then id — which agreed with the list on exactly
 * one shape: a book whose chapters are all numbered, all differently. The
 * manuscript import made the other two ordinary, and this fixture is built out
 * of both of them:
 *
 *   `stub-a`/`stub-b` carry NO chapter number. The list shows them last, most
 *   recently touched first; the old comparator sorted them oldest-created
 *   first, which is the opposite here on purpose.
 *
 *   `a-seven`/`z-seven` SHARE chapter 7 — legal, and what an import landing
 *   beside hand-numbered chapters produces. The list breaks that tie on the
 *   id; the old comparator broke it on `createdAt`, which is the opposite here
 *   on purpose too.
 */
async function testPublishingOrderMatchesTheList(): Promise<void> {
  const { defaultPublishingOrder } = await import('@/services/projectTools');
  const { compareManuscriptOrder } = await import('@/engines/writings/chapterOrder');

  const projectId = 'publishing-order-project';
  const writing = (value: Partial<Writing> & { id: string }): Writing => ({
    projectId,
    title: value.id,
    status: 'draft',
    content: '<p>Prose</p>',
    wordCount: 1,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...value,
  });

  const book = [
    writing({ id: 'ch-1', chapter: 1, createdAt: 300, updatedAt: 300 }),
    writing({ id: 'z-seven', chapter: 7, createdAt: 100, updatedAt: 400 }),
    writing({ id: 'a-seven', chapter: 7, createdAt: 500, updatedAt: 200 }),
    writing({ id: 'ch-9', chapter: 9, createdAt: 200, updatedAt: 250 }),
    writing({ id: 'stub-a', createdAt: 10, updatedAt: 100 }),
    writing({ id: 'stub-b', createdAt: 90, updatedAt: 900 }),
  ];
  const ids = (rows: readonly Writing[]): string => rows.map(row => row.id).join(',');

  // The order the Writings list is showing, read off the single source of
  // truth rather than restated here.
  const onScreen = ids([...book].sort(compareManuscriptOrder));
  assert(
    onScreen === 'ch-1,a-seven,z-seven,ch-9,stub-b,stub-a',
    `the fixture no longer exercises both divergences: ${onScreen}`,
  );
  assert(
    ids(defaultPublishingOrder(book)) === onScreen,
    `the export ordered chapters differently from the list: ${ids(defaultPublishingOrder(book))}`,
  );

  // End to end through the layer the exporters actually call. A profile with
  // no pinned order falls back to `defaultPublishingOrder`, and that fallback
  // is also what seeds a quick compile — the shortcut most writers use.
  const profile: PublishingProfile = {
    id: 'order-profile',
    projectId,
    name: 'Editorial',
    format: 'manuscript',
    includeTitlePage: false,
    includeSynopsis: false,
    includeBibliography: false,
    citationStyle: 'apa',
    selectionMode: 'all',
    selectedWritingIds: [],
    writingOrder: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const resolvedIds = ids(resolvePublishingWritings(book, profile).writings);
  assert(resolvedIds === onScreen, `the resolved export order left the list order: ${resolvedIds}`);

  // A pinned order still wins — that is the writer arranging the book by hand
  // — and only the rows it does not name fall back to manuscript order.
  const pinned = resolvePublishingWritings(book, { ...profile, writingOrder: ['ch-9', 'stub-a'] });
  assert(
    ids(pinned.writings) === 'ch-9,stub-a,ch-1,a-seven,z-seven,stub-b',
    `a hand-arranged order was not honoured, or its tail left manuscript order: ${ids(pinned.writings)}`,
  );

  passed.push('the exported chapter order is the order the writings list shows');
}

/**
 * MARKUP AND ENCODING. Both portable formats are XML containers — an .epub is
 * XHTML, a .docx is OOXML — so every title, synopsis and citation that reaches
 * either one has to arrive escaped, and no character XML cannot carry may
 * reach either one at all.
 *
 * The fixture is a title an editor would actually send back: `Marek & Aurelia
 * <fin>`, which is three separate ways to end a document early. Around it sit
 * the Spanish accents, guillemets and em dashes the app is written for, and
 * the characters the manuscript importer can carry in — `decodeXml` in
 * `manuscriptDocx` turns `&#12;` into a real form feed, nothing between there
 * and here removes it, and one of them anywhere in the file is the difference
 * between a manuscript and "Word cannot open this document".
 *
 * The load-bearing assertion is not a substring: it is that every XML part of
 * both files PARSES. A corrupt export is corrupt as a whole, so that is the
 * shape the test has to take.
 */
async function testPublishingMarkupAndEncoding(): Promise<void> {
  const { composePublishingDocument } = await import('@/engines/writings/publishingDocument');
  const [{ buildPublishingDocx }, { buildPublishingEpub }] = await Promise.all([
    import('@/engines/writings/publishingDocx'),
    import('@/engines/writings/publishingEpub'),
  ]);

  /** Everything XML 1.0 refuses, minus the tab, LF and CR it accepts. */
  const xmlHostile = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;

  const hostile = 'Marek & Aurelia <fin>';
  const accented = '—Corazón —dijo Aurelia—, «ven aquí».';
  const writings: Writing[] = [
    {
      id: 'hostile',
      projectId: 'p',
      // A form feed mid-title, where `trim()` cannot reach it, and a lone high
      // surrogate at the end — exactly as an imported chapter title carries
      // them out of somebody else's .docx.
      title: 'Marek\u000C & Aurelia <fin>\uD800',
      status: 'draft',
      content: `<p>${accented}</p><blockquote><p>“Ni&nbsp;así”</p></blockquote>`,
      synopsis: 'Un capítulo & su <resumen>',
      wordCount: 7,
      chapter: 5,
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ];

  const document = composePublishingDocument(writings, {
    projectTitle: hostile,
    includeTitlePage: true,
    includeSynopsis: true,
    chapterLabel: 'Capítulo',
    untitledLabel: 'Sin título',
    wordLabel: 'palabras',
    locale: 'es-ES',
    generatedAt: Date.UTC(2026, 7, 24),
    bibliographyTitle: 'Bibliografía & <fuentes>',
    bibliography: ['Ortiz, «El mar» & otros <1987>'],
  });

  // Cleaned once, on the IR, so both writers inherit it. Half a character is
  // not a character any encoder can write, so a lone surrogate becomes U+FFFD
  // rather than vanishing and closing the gap over itself.
  const composedTitle = document.sections[0]?.title ?? '';
  assert(!xmlHostile.test(composedTitle), 'a control character survived into the publishing IR');
  assert(
    composedTitle === `Capítulo 5 — ${hostile}\uFFFD`,
    `the composed heading changed shape: ${JSON.stringify(composedTitle)}`,
  );

  /** A part is only correct if the whole document it belongs to parses. */
  const wellFormed = (xml: string): boolean =>
    new DOMParser().parseFromString(xml, 'application/xml')
      .getElementsByTagName('parsererror').length === 0;

  // -- ePub --
  const epub = await JSZip.loadAsync(await (await buildPublishingEpub(document)).arrayBuffer());
  const epubParts = Object.keys(epub.files).filter(path => /\.(?:xhtml|opf|xml)$/.test(path));
  assert(epubParts.length >= 4, `ePub is missing XML parts: ${epubParts.join(',')}`);
  for (const path of epubParts) {
    const xml = await epub.file(path)?.async('string') ?? '';
    assert(wellFormed(xml), `ePub part ${path} is not well-formed XML`);
  }
  const chapter = await epub.file('EPUB/section-1.xhtml')?.async('string') ?? '';
  const nav = await epub.file('EPUB/nav.xhtml')?.async('string') ?? '';
  const opf = await epub.file('EPUB/package.opf')?.async('string') ?? '';
  assert(chapter.includes('Marek &amp; Aurelia &lt;fin&gt;'), 'ePub did not escape the chapter title');
  assert(!/<fin>/.test(`${chapter}${nav}${opf}`), 'a raw tag out of a title reached the ePub');
  assert(nav.includes('Marek &amp; Aurelia &lt;fin&gt;'), 'the ePub table of contents did not escape the title');
  assert(opf.includes('<dc:title>Marek &amp; Aurelia &lt;fin&gt;</dc:title>'), 'ePub package metadata did not escape the title');
  assert(chapter.includes('Un capítulo &amp; su &lt;resumen&gt;'), 'ePub did not escape the synopsis');
  assert(chapter.includes('«ven aquí»') && chapter.includes('—Corazón'), 'ePub lost non-ASCII prose');

  // -- DOCX --
  const docx = await JSZip.loadAsync(await (await buildPublishingDocx(document)).arrayBuffer());
  const body = await docx.file('word/document.xml')?.async('string') ?? '';
  assert(wellFormed(body), 'word/document.xml is not well-formed XML — this is the file Word calls corrupt');
  const core = await docx.file('docProps/core.xml')?.async('string');
  if (core) assert(wellFormed(core), 'docProps/core.xml is not well-formed XML');
  assert(body.includes('Marek &amp; Aurelia &lt;fin&gt;'), 'DOCX did not escape the chapter title');
  assert(!xmlHostile.test(body), 'a control character reached word/document.xml');
  assert(body.includes('«ven aquí»') && body.includes('Corazón'), 'DOCX lost non-ASCII prose');

  passed.push('titles, synopses and citations are escaped and XML-safe in both DOCX and ePub');
}

/**
 * EDGE MANUSCRIPTS, and the promise the preview makes.
 *
 * The editor's title field is an unguarded input with a placeholder, so a
 * blanked title is a real row — and it used to reach the file as an empty
 * `<h1></h1>`, an empty `<title></title>`, a table-of-contents entry with
 * nothing to click, and a heading reading "Capítulo 5 — " with the em dash
 * left hanging off the end.
 *
 * The second half is the worst bug this path can have: a preview that
 * disagrees with the file. There is one composer, and this is what says so.
 */
async function testPublishingEdgeManuscripts(): Promise<void> {
  const { composePublishingDocument } = await import('@/engines/writings/publishingDocument');
  const { buildPublishingPreview } = await import('@/services/projectTools');
  const { buildPublishingEpub } = await import('@/engines/writings/publishingEpub');

  const projectId = 'publishing-edge-project';
  const writing = (value: Partial<Writing> & { id: string }): Writing => ({
    projectId,
    title: value.id,
    status: 'draft',
    content: '<p>Prose</p>',
    wordCount: 1,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...value,
  });

  // A whitespace-only title on a numbered chapter, a blank one on a writing
  // with no number at all, and a chapter whose body is empty.
  const ragged = [
    writing({ id: 'blank-numbered', title: '   ', chapter: 5 }),
    writing({ id: 'blank-unnumbered', title: '', updatedAt: 900 }),
    writing({ id: 'hollow', title: 'Silencio', chapter: 6, content: '', wordCount: 0 }),
  ];
  const document = composePublishingDocument(ragged, {
    projectTitle: 'Proyecto',
    includeTitlePage: true,
    includeSynopsis: true,
    chapterLabel: 'Capítulo',
    untitledLabel: 'Sin título',
    wordLabel: 'palabras',
    locale: 'es-ES',
    generatedAt: Date.UTC(2026, 7, 24),
  });
  const headings = document.sections.map(section => section.title);
  assert(
    headings.join(' | ') === 'Capítulo 5 — Sin título | Sin título | Capítulo 6 — Silencio',
    `a blank title did not fall back to the placeholder: ${headings.join(' | ')}`,
  );
  assert(
    !headings.some(heading => heading.trim() === '' || /—\s*$/.test(heading)),
    'a heading came out empty, or with the em dash hanging off the end',
  );
  // An empty body is a real chapter, not a dropped one.
  assert(document.sections.length === 3, `an edge chapter was dropped from the document: ${document.sections.length}`);
  assert(document.sections[2].html === '' && document.sections[2].portableHtml === '', 'an empty chapter grew a body');

  const epub = await JSZip.loadAsync(await (await buildPublishingEpub(document)).arrayBuffer());
  const nav = await epub.file('EPUB/nav.xhtml')?.async('string') ?? '';
  const hollow = await epub.file('EPUB/section-3.xhtml')?.async('string') ?? '';
  assert(!/<a href="[^"]*">\s*<\/a>/.test(nav), 'the ePub table of contents holds an entry with nothing to click');
  assert(!/<title>\s*<\/title>|<h1>\s*<\/h1>/.test(hollow), 'an empty chapter produced an empty title or heading');

  // -- The preview against the file --
  //
  // Both sides are built WITHOUT explicit labels on purpose: that is how the
  // app calls them, and it makes this a comparison of two code paths rather
  // than of two label sets.
  const profile: PublishingProfile = {
    id: 'edge-profile',
    projectId,
    name: 'Editorial',
    format: 'manuscript',
    includeTitlePage: true,
    includeSynopsis: false,
    includeBibliography: false,
    citationStyle: 'apa',
    selectionMode: 'all',
    selectedWritingIds: [],
    writingOrder: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const project = { id: projectId, title: 'Proyecto' };
  const generatedAt = Date.UTC(2026, 7, 24);

  for (const selection of [ragged, [ragged[0]]]) {
    const resolved = resolvePublishingWritings(selection, profile);
    const file = buildPublishingArtifacts(project, profile, resolved.writings, [], { generatedAt });
    const preview = buildPublishingPreview(project, profile, selection, [], { generatedAt });
    assert(
      preview.pieces.map(piece => piece.title).join('|')
        === file.document.sections.map(section => section.title).join('|'),
      'the preview showed different headings, or a different order, from the file',
    );
    assert(
      preview.pieceCount === file.document.sections.length && preview.unlistedPieceCount === 0,
      'the preview counted a different number of writings than the file carries',
    );
    // The number under the preview is the number the file's title page prints.
    assert(
      preview.wordCount === file.document.wordCount,
      `the preview total disagreed with the exported title page: ${preview.wordCount} vs ${file.document.wordCount}`,
    );
  }

  // One chapter opens the book, so the ePub spine is the title page and that
  // single section — no empty spine, and nothing invented to pad it.
  const single = buildPublishingArtifacts(project, profile, [ragged[0]], [], { generatedAt });
  const soloEpub = await JSZip.loadAsync(await (await buildPublishingEpub(single.document)).arrayBuffer());
  const soloOpf = await soloEpub.file('EPUB/package.opf')?.async('string') ?? '';
  assert(
    (soloOpf.match(/<itemref /g) ?? []).length === 2 && soloOpf.includes('<itemref idref="section-1" />'),
    'a one-chapter manuscript did not produce a title page plus one section in the spine',
  );

  passed.push('blank titles, empty chapters and one-chapter books export intact, and the preview matches the file');
}

// `await testProjectRestoreCarriesEngineRows();` to run(), after
// testProjectImportCollisionGuard(). No new top-level imports are needed:
// `db`, `createProjectZipArchive` and `importProjectZip` are already imported,
// and the copilot strategy registers itself through `@/engines`, which
// `zipBackup` pulls in.

// The project-ZIP restore hung for ever on 2026-08-31, and the two tests that
// covered it never noticed because both of their fixtures were a bare
// `projects` row: with no engine data in the archive, every strategy read a
// file that was not there, wrote nothing, and the transaction sailed through.
//
// The hang was one strategy write away the whole time. A strategy reads its
// JSON out of JSZip, and JSZip pumps every read through its own
// `setImmediate` — one hop to the event loop. Dexie only carries a
// transaction's zone across MICROtasks, so the code resuming after that hop was
// outside the restore's transaction and its `bulkPut` opened a SECOND readwrite
// transaction over the same store. IndexedDB queued it behind the first; the
// first could not commit until the strategy returned; neither ever moved — and
// the `Dexie.waitFor` around the strategy is what made that silent rather than
// a "transaction committed too early" error, because its spin loop holds the
// first transaction alive for exactly as long as the deadlock lasts. The cure
// is to read the whole archive BEFORE the transaction opens, so nothing inside
// it ever yields.
//
// So this test seeds what a real project has and a bare fixture does not:
// a plain engine table (`diaryEntries`, restored by the shared simple
// strategy) and the copilot's `aiProjectSettings`, whose primary key IS the
// project. Both wedged the old code — diary first, because its strategy is
// registered earlier — so the archive here fails the old restore twice over.
//
// It also holds the restore to the two things that must be true once it
// returns: the trust fields never travel, and a project restored over itself
// does not inherit rows of its previous instance that the archive is silent
// about — including the row keyed BY the project, which the sweep used to skip.
async function testProjectRestoreCarriesEngineRows(): Promise<void> {
  const projectId = 'restore-hang-project';
  const now = Date.now();

  const scratchProject = (title: string) => ({
    id: projectId, title, mode: 'novelist' as const, type: 'standalone' as const,
    color: '#7c3aed', description: '', status: 'in-progress' as const,
    enabledEngines: [], engineOrder: [], createdAt: now, updatedAt: now,
  });

  const archiveOf = async (): Promise<File> => {
    const { blob, fileName } = await createProjectZipArchive(projectId);
    return new File([blob], fileName, { type: 'application/zip' });
  };

  // A deadlocked restore used to take the whole suite down with it, and the
  // harness could only report that the suite had stopped answering. Racing it
  // turns the hang into this test's own failed assertion — and a real
  // BackupOperationError still propagates untouched.
  const restore = async (archive: File, what: string): Promise<void> => {
    const outcome = await Promise.race([
      importProjectZip(archive, { replaceProjectIds: [projectId] })
        .then(() => 'returned' as const),
      new Promise<'hung'>(resolve => { setTimeout(() => resolve('hung'), 10_000); }),
    ]);
    assert(
      outcome === 'returned',
      `${what}: the project restore never returned`,
    );
  };

  stage('restore-hang:export');
  await db.projects.put(scratchProject('Archived title'));
  await db.diaryEntries.put({
    id: 'restore-hang-diary', projectId, entryDate: '2026-08-31T10:00',
    title: 'Archived page', content: '<p>archived</p>', tags: [], pinned: false,
    createdAt: now, updatedAt: now,
  });
  await db.aiProjectSettings.put({
    projectId, defaultPolicy: 'allow', remoteConsent: true,
    chatRoute: { connectionId: 'archived', modelId: 'archived-model' },
    updatedAt: now,
  });
  // A HAND-ROLLED strategy's table too, not only the shared simple one.
  //
  // This fixture used to hold a diary page and a copilot row and nothing else,
  // and it passed while the very same restore hung in the running app. Nine
  // engines write their own import instead of using `makeSimpleBackupStrategy`,
  // and every one of those eighteen writes was a `bulkAdd`: a surviving row
  // aborted the whole restore. The timeline is one of them, and it is the one
  // the live trail stopped on.
  await db.timelines.put({
    id: 'restore-hang-timeline', projectId, name: 'Archived timeline',
    description: '', createdAt: now, updatedAt: now,
  } as never);
  await db.timelineEvents.put({
    id: 'restore-hang-event', projectId, timelineId: 'restore-hang-timeline',
    title: 'Archived event', description: '', date: '1', order: 0,
    createdAt: now, updatedAt: now,
  } as never);
  const withEngineRows = await archiveOf();

  // Everything the restore is supposed to undo: a rename, a page that is not
  // in the archive, and a copilot row that trusts a remote model.
  await db.projects.update(projectId, { title: 'Locally renamed' });
  await db.diaryEntries.delete('restore-hang-diary');
  await db.diaryEntries.put({
    id: 'restore-hang-stale', projectId, entryDate: '2026-08-31T18:00',
    title: 'Written after the export', content: '<p>stale</p>', tags: [],
    pinned: false, createdAt: now + 1, updatedAt: now + 1,
  });
  await db.aiProjectSettings.put({
    projectId, defaultPolicy: 'allow', remoteConsent: true,
    chatRoute: { connectionId: 'local', modelId: 'local-model' },
    imageRoute: { connectionId: 'local', modelId: 'local-painter' },
    updatedAt: now + 1,
  });

  stage('restore-hang:restore');
  await restore(withEngineRows, 'an archive carrying engine rows');

  assert(
    (await db.projects.get(projectId))?.title === 'Archived title',
    'the approved replacement did not restore the archived project',
  );
  assert(
    (await db.diaryEntries.get('restore-hang-diary'))?.title === 'Archived page',
    'a plain engine table did not come back from the archive',
  );
  assert(
    !(await db.diaryEntries.get('restore-hang-stale')),
    'a row written after the export survived the restore',
  );
  assert(
    (await db.timelines.get('restore-hang-timeline'))?.name === 'Archived timeline',
    'a hand-rolled strategy did not restore its rows',
  );
  assert(
    Boolean(await db.timelineEvents.get('restore-hang-event')),
    'a hand-rolled strategy dropped a child row',
  );

  // Straight back over itself. Every row the archive carries is now present
  // locally, so a restore that is not idempotent — one `bulkAdd` left anywhere
  // — aborts here, and before the fix that abort presented as a hang rather
  // than an error.
  await restore(withEngineRows, 'the same archive restored twice');
  assert(
    (await db.timelines.get('restore-hang-timeline'))?.name === 'Archived timeline',
    'restoring the same archive twice did not leave the same rows',
  );
  assert(
    (await db.diaryEntries.get('restore-hang-diary'))?.title === 'Archived page',
    'the second restore lost a row the first one wrote',
  );

  const restored = await db.aiProjectSettings.get(projectId);
  assert(restored?.chatRoute?.modelId === 'archived-model', 'the copilot settings row did not round-trip');
  assert(
    restored?.defaultPolicy === 'ask' && restored.remoteConsent === false,
    'the archive raised the local trust in a remote model',
  );
  assert(
    !restored?.imageRoute,
    'the restored project inherited the image route of its previous instance',
  );

  // Second pass: an archive with NO copilot row at all — every project
  // exported before the copilot existed is one. The row is keyed BY the
  // project, so Dexie keeps it out of `idxByName` and the generic
  // "every table with a projectId" sweep used to walk straight past it.
  stage('restore-hang:silentArchive');
  await db.aiProjectSettings.delete(projectId);
  const withoutCopilot = await archiveOf();
  await db.projects.update(projectId, { title: 'Locally renamed again' });
  await db.aiProjectSettings.put({
    projectId, defaultPolicy: 'allow', remoteConsent: true,
    chatRoute: { connectionId: 'local', modelId: 'left-behind' },
    updatedAt: now + 2,
  });

  await restore(withoutCopilot, 'an archive with no copilot row');
  assert(
    (await db.projects.get(projectId))?.title === 'Archived title',
    'the second replacement did not restore the archived project',
  );
  assert(
    !(await db.aiProjectSettings.get(projectId)),
    'a project restored from an archive that carries no copilot row kept the old one',
  );

  await db.diaryEntries.delete('restore-hang-diary');
  await db.timelineEvents.delete('restore-hang-event');
  await db.timelines.delete('restore-hang-timeline');
  await db.projects.delete(projectId);
  passed.push('project ZIP restore writes engine rows inside its transaction, twice over, and sweeps what the archive is silent about');
}

// The command-palette ranking. The palette used to know about two hundred
// matches and show the writer the sixty least useful of them: titles were
// scored, bodies came back in Dexie cursor order, and an engine whose only hit
// sorted late was not drawn at all.
const RANK_DAY_MS = 86_400_000;

/**
 * The shape the index hands to the ranker: folded `title\nbody`, and where the
 * body starts in it. Built through the real folding so an accented title is
 * ranked the same way it is matched.
 */
function rankableDocument(title: string, body: string, updatedAt = 0): {
  haystack: string;
  bodyOffset: number;
  updatedAt: number;
} {
  const foldedTitle = foldSearchText(title);
  return {
    haystack: `${foldedTitle}\n${foldSearchText(body)}`,
    bodyOffset: foldedTitle.length + 1,
    updatedAt,
  };
}

async function testSearchRelevanceRanking(): Promise<void> {
  const now = Date.UTC(2026, 0, 15);
  const marta = parseSearchQuery('marta');

  // A title match beats a body match. This is the whole reason ranking exists:
  // scanning tables in order puts chapter three above the codex entry that is
  // literally named after the character.
  const titled = scoreSearchMatch(marta, rankableDocument('Marta', 'nada aqui'), now);
  const mentioned = scoreSearchMatch(
    marta,
    rankableDocument('Capítulo 3', 'marta cruzó el patio', now),
    now,
  );
  assert(titled > mentioned, 'a title match no longer outranks a body mention');

  // An exact word beats a fragment of a longer word, with neither in prefix
  // position so only the whole-word band separates them.
  const art = parseSearchQuery('art');
  const wholeWord = scoreSearchMatch(art, rankableDocument('el art de la guerra', ''), now);
  const fragment = scoreSearchMatch(art, rankableDocument('la cartografia', ''), now);
  assert(wholeWord > fragment, 'a whole word no longer outranks a substring');

  // Being exactly what the writer typed beats merely starting with it.
  const exact = scoreSearchMatch(marta, rankableDocument('Marta', ''), now);
  const prefixed = scoreSearchMatch(marta, rankableDocument('Marta Ruiz', ''), now);
  assert(exact > prefixed, 'an exact title no longer outranks a longer title');

  // Recency separates rows that are otherwise the same...
  const fresh = scoreSearchMatch(
    marta,
    rankableDocument('Capítulo 3', 'marta cruzó el patio', now - RANK_DAY_MS),
    now,
  );
  const stale = scoreSearchMatch(
    marta,
    rankableDocument('Capítulo 3', 'marta cruzó el patio', now - 400 * RANK_DAY_MS),
    now,
  );
  assert(fresh > stale, 'a recently edited row no longer outranks a stale one');

  // ...and never more than that: a chapter edited this morning must not push a
  // codex entry that carries the name in its title off the top of the palette.
  const staleTitle = scoreSearchMatch(
    marta,
    rankableDocument('Marta', 'ficha del personaje', now - 900 * RANK_DAY_MS),
    now,
  );
  assert(staleTitle > fresh, 'recency outranked a title match');

  // An accented title is ranked by the unaccented word the writer typed.
  const cancion = parseSearchQuery('cancion');
  assert(
    scoreSearchMatch(cancion, rankableDocument('La Canción', ''), now)
      > scoreSearchMatch(cancion, rankableDocument('Capítulo 9', 'la canción sonaba'), now),
    'folding stopped at matching and never reached ranking',
  );

  // A filters-only query names no word to weigh, so recency is the only order
  // it implies — and an undated row (a map pin) still scores, it just scores 0.
  const untagged = parseSearchQuery('is:untagged');
  assert(untagged.needles.length === 0, 'a filters-only query grew a needle');
  assert(
    scoreSearchMatch(untagged, rankableDocument('Pin', 'sin fecha', now), now)
      > scoreSearchMatch(untagged, rankableDocument('Pin', 'sin fecha'), now),
    'a filters-only query is not ordered by recency',
  );

  // Ranking runs on every keystroke's worth of half-typed queries, so an empty
  // document and a future timestamp both have to produce a number, not a throw.
  assert(
    typeof scoreSearchMatch(marta, rankableDocument('', ''), now) === 'number',
    'ranking an empty document did not return a score',
  );
  assert(
    scoreSearchMatch(marta, rankableDocument('Marta', '', now + 5 * RANK_DAY_MS), now)
      >= scoreSearchMatch(marta, rankableDocument('Marta', '', now), now),
    'a clock-skewed future timestamp scored below the present',
  );

  passed.push('search ranking: title over body, whole word over fragment, recency only as a tiebreaker');
}

async function testSearchResultPaging(): Promise<void> {
  const page = selectRankedMatches(
    [
      { id: 'low', engineId: 'writings', score: 10 },
      { id: 'high', engineId: 'writings', score: 90 },
      { id: 'mid', engineId: 'writings', score: 50 },
    ],
    3,
  );
  assert(
    page.map(item => item.id).join(',') === 'high,mid,low',
    'a page of matches is no longer ordered strongest first',
  );

  // The case this exists for: a protagonist's name in a long manuscript. Every
  // chapter outscores the codex entry, and without a reserved place the codex
  // section is not merely pushed down — it is not drawn at all, because the
  // palette only draws sections it has a row for.
  const flooded = selectRankedMatches(
    [
      { id: 'w1', engineId: 'writings', score: 400 },
      { id: 'w2', engineId: 'writings', score: 380 },
      { id: 'w3', engineId: 'writings', score: 360 },
      { id: 'w4', engineId: 'writings', score: 340 },
      { id: 'c1', engineId: 'codex', score: 120 },
      { id: 'n1', engineId: 'notes', score: 60 },
    ],
    3,
  );
  assert(flooded.length === 3, 'the page ignored its limit');
  assert(flooded.some(item => item.engineId === 'codex'), 'one loud engine took the whole page');
  assert(flooded.some(item => item.engineId === 'notes'), 'the last engine to match lost its place');
  assert(flooded[0].id === 'w1', 'the reserved places cost the strongest match its top spot');

  // Whatever survives is still ordered by score, so a caller that takes the
  // first hit — grounded answers, the AI bridge — takes the best one.
  const scores = flooded.map(item => item.score);
  assert(
    scores.every((score, index) => index === 0 || scores[index - 1] >= score),
    'the reserved places broke the score ordering',
  );

  // Equal scores keep the order the scan found them in: the same query on an
  // unchanged project must not shuffle its answer between keystrokes.
  const tied = selectRankedMatches(
    [
      { id: 'first', engineId: 'writings', score: 100 },
      { id: 'second', engineId: 'writings', score: 100 },
      { id: 'third', engineId: 'writings', score: 100 },
    ],
    2,
  );
  assert(tied.map(item => item.id).join(',') === 'first,second', 'tied matches are not ordered stably');

  assert(selectRankedMatches([{ id: 'a', engineId: 'notes', score: 1 }], 0).length === 0,
    'a zero-sized page returned rows');
  assert(selectRankedMatches([], 10).length === 0, 'an empty result set produced a page');
  assert(selectRankedMatches([{ id: 'a', engineId: 'notes', score: 1 }], 10).length === 1,
    'a result set smaller than the page was truncated');

  passed.push('search paging: best matches first, with a place kept for every engine that matched');
}

// Reading mode opened at the front of the book every time, which is the one
// thing every reading app gets right. It now remembers a place per project and
// goes back to it, and `resolveResumePoint` is the whole decision: what was
// saved, plus the manuscript as it stands right now, in — a real index out.
//
// The reason it is a pure function and not four lines in the view is that a
// bookmark is only ever wrong in ways that take weeks to notice, and every one
// of them has to be answered in the same place.
//
//   IT FOLLOWS THE ID, NOT THE INDEX. The manuscript is reorderable — an arrow
//   press in the chapter list exchanges two numbers — so an index resolved on
//   its own names whatever chapter has since been moved into that slot. A
//   bookmark that silently drifts to a different chapter is worse than no
//   bookmark, because the writer trusts it.
//
//   THE INDEX IS THE FALLBACK, AND ONLY FOR A DELETED PIECE. When the id is
//   gone the old place is the nearest the book still comes to where the reader
//   was, so reading picks up at whatever stands there now — clamped, because
//   the manuscript is at least one chapter shorter than it was. The fraction
//   does not come with it: two thirds of the way through a chapter that no
//   longer exists is not two thirds of the way through its neighbour.
//
//   A POSITION FROM ANOTHER PROJECT IS NOT STALE, IT IS SOMEBODY ELSE'S. The
//   settings row carries the project it was written for precisely so a value
//   that outlived its project — a ZIP restore onto a reused id, a hand-edited
//   row — cannot drop a writer into the middle of a different book. The sweep
//   in `deleteProject` is what should have removed it, so the check below that
//   the prefix is declared in `PROJECT_SETTING_PREFIXES` is half of the same
//   guarantee: an unregistered per-project key is invisible to that sweep.
//
//   `resumed` IS A SEPARATE ANSWER FROM `index`. It is what the view says out
//   loud, and a manuscript resumed at its first word was not resumed at all —
//   announcing it there would be a notice that fires every time reading mode
//   opens on a book nobody has started.
async function testReadingResumePoint(): Promise<void> {
  const { parseReadingPosition, resolveResumePoint, serializeReadingPosition } =
    await import('@/engines/writings/readingWindow');
  const { PROJECT_SETTING_PREFIXES, projectSettingKeys } = await import('@/db/operations');

  interface Saved { projectId: string; pieceId: string; fraction: number; index: number }

  const project = 'resume-project';
  const book = ['one', 'two', 'three', 'four'].map(id => ({ id }));
  const saved = (over: Partial<Saved> = {}): Saved =>
    ({ projectId: project, pieceId: 'three', fraction: 0.5, index: 2, ...over });

  // ── Nothing saved, and the very start, both open silently ──
  const fresh = resolveResumePoint(null, book, project);
  assert(fresh.index === 0 && fresh.fraction === 0, 'a project with no bookmark must open at the top');
  assert(!fresh.resumed, 'a project with no bookmark must not claim it was resumed');

  const untouched = resolveResumePoint(saved({ pieceId: 'one', fraction: 0, index: 0 }), book, project);
  assert(untouched.index === 0, 'a bookmark on the first word must resolve to the first piece');
  assert(!untouched.resumed, 'a bookmark on the first word is not a resume worth announcing');

  // A fraction into the FIRST piece is still a resume: the writer is a page in.
  const pageIn = resolveResumePoint(saved({ pieceId: 'one', fraction: 0.4, index: 0 }), book, project);
  assert(pageIn.index === 0 && pageIn.resumed, 'a bookmark part-way into chapter one is a resume');

  // ── The ordinary case: the piece is still there ──
  const middle = resolveResumePoint(saved(), book, project);
  assert(middle.index === 2, `expected the saved piece at index 2, got ${middle.index}`);
  assert(middle.fraction === 0.5, `the fraction into the piece was lost: ${middle.fraction}`);
  assert(middle.resumed, 'resuming mid-manuscript must be announced');

  // ── The manuscript was REORDERED ──
  // `three` has been moved to the front. The saved index still says 2, which
  // is now a different chapter entirely; the id is the only thing that knows.
  const reordered = ['three', 'one', 'two', 'four'].map(id => ({ id }));
  const moved = resolveResumePoint(saved(), reordered, project);
  assert(
    moved.index === 0,
    `a reorder sent the reader to index ${moved.index} instead of following the piece`,
  );
  assert(moved.fraction === 0.5, 'a reorder must not lose how far into the piece the reader was');
  assert(moved.resumed, 'a reorder must still count as a resume');

  // ── The saved piece was DELETED ──
  // Its place is the closest the book still comes to where the reader was.
  const withoutThree = ['one', 'two', 'four'].map(id => ({ id }));
  const gone = resolveResumePoint(saved(), withoutThree, project);
  assert(gone.index === 2, `a deleted chapter should resume at its old place, got ${gone.index}`);
  assert(gone.fraction === 0, 'a fraction measured inside a deleted chapter must not be reused');
  assert(gone.resumed, 'landing somewhere other than the front of the book is a resume');

  // ── The position is PAST THE END ──
  // Half the manuscript was deleted, or the reader is on a filtered tab that
  // holds fewer pieces than the one the bookmark was written from.
  const short = [{ id: 'one' }];
  const beyond = resolveResumePoint(saved({ pieceId: 'gone', index: 40 }), short, project);
  assert(beyond.index === 0, `an index past the end must clamp to the last piece, got ${beyond.index}`);
  assert(beyond.fraction === 0, 'an index past the end must not carry a fraction');

  const beyondButPresent = resolveResumePoint(saved({ index: 40 }), book, project);
  assert(
    beyondButPresent.index === 2,
    'an out-of-range index must be ignored outright while the piece itself still exists',
  );

  // A fraction out of range is clamped rather than scrolled past the chapter.
  const overshoot = resolveResumePoint(saved({ fraction: 4 }), book, project);
  assert(overshoot.fraction === 1, `a fraction over 1 must clamp, got ${overshoot.fraction}`);
  const undershoot = resolveResumePoint(saved({ fraction: -3 }), book, project);
  assert(undershoot.fraction === 0, `a negative fraction must clamp, got ${undershoot.fraction}`);

  // ── A position belonging to ANOTHER PROJECT ──
  // The piece id even matches, which is exactly how a reused id goes wrong.
  const foreign = resolveResumePoint(saved({ projectId: 'some-other-book' }), book, project);
  assert(foreign.index === 0 && foreign.fraction === 0, "another project's bookmark must not be used");
  assert(!foreign.resumed, "another project's bookmark must not be announced as a resume");

  // ── Degenerate inputs answer instead of throwing ──
  const empty = resolveResumePoint(saved(), [], project);
  assert(empty.index === 0 && !empty.resumed, 'an empty manuscript must resolve to a silent start');
  const nonsense = resolveResumePoint(saved({ pieceId: 'gone', index: Number.NaN }), book, project);
  assert(nonsense.index === 0, 'a non-numeric index must fall back to the start, not to NaN');

  // ── The stored form ──
  // The view compares serialised positions to decide whether a write is worth
  // making at all, so two positions a fraction of a line apart MUST serialise
  // identically — otherwise the throttle writes on every tick forever.
  const written = serializeReadingPosition(saved({ fraction: 0.5000001 }));
  assert(
    written === serializeReadingPosition(saved({ fraction: 0.4999999 })),
    'sub-line scroll noise must not produce a different stored value',
  );
  const round = parseReadingPosition(written);
  assert(round !== null, 'a value this module wrote must parse back');
  assert(
    round?.pieceId === 'three' && round?.projectId === project && round?.index === 2,
    `the stored position did not round-trip: ${written}`,
  );
  assert(
    resolveResumePoint(round, book, project).index === 2,
    'a round-tripped position must still resolve to the piece it named',
  );

  // Anything else in that row costs a bookmark and never the reader.
  for (const bad of [
    undefined,
    '',
    'not json at all',
    '[]',
    'null',
    '{"pieceId":"three","fraction":0.5,"index":2}',
    '{"projectId":"p","fraction":0.5,"index":2}',
    '{"projectId":"p","pieceId":"three","fraction":"half","index":2}',
    '{"projectId":"p","pieceId":"three","fraction":null,"index":2}',
  ]) {
    assert(parseReadingPosition(bad) === null, `a malformed stored position was trusted: ${String(bad)}`);
  }

  // ── The key is swept with its project ──
  // `settings` has no projectId index, so a per-project key that is not
  // declared here outlives the project and is inherited by the next one to
  // reuse its id — a writer dropped into the middle of somebody else's book.
  const key = `${PROJECT_SETTING_PREFIXES.readingPosition}${project}`;
  assert(
    projectSettingKeys(project).includes(key),
    'the reading-position key is not declared in PROJECT_SETTING_PREFIXES and will outlive its project',
  );

  passed.push('reading resumes by piece id, survives reorder, deletion, overrun and a foreign project');
}

// A chapter leaves this app to be READ BY SOMEONE ELSE — a beta reader, a
// workshop, an editor — and once it has left, everything about it is out of
// the writer's hands. That is what these two tests are about: not that the
// export works, but that the file survives the trip.
//
// Three properties, none of which the app can notice being wrong.
//
//   IT SORTS. A writer exports chapter 7 in March and chapter 12 in April
//   into the same folder, and Finder and Explorer sort byte-wise: `1, 10, 2`.
//   Nobody sees this in the app, because the app never shows the folder.
//
//   IT IS SAFE. The title is an unguarded input. A chapter called
//   `../../etc/hosts`, or `Chapter 7: "Hola"`, or nothing at all, is a name
//   the writer typed and a name the filesystem must take.
//
//   IT SAYS NOTHING FALSE. The publishing profile's three questions — title
//   page, synopses, bibliography — are answered here without asking, so each
//   answer has to be one that cannot embarrass the writer in front of a
//   reader. A title page over one chapter would print the BOOK's title above
//   the SELECTION's word count; a synopsis reading "Marta finds the body"
//   would sit in italics above the chapter that reveals it; the project's
//   whole reference list would credit this chapter with forty works it never
//   cites.
async function testChapterExportNaming(): Promise<void> {
  const {
    chapterExportNaming,
    chapterNumberWidth,
    selectChapterExport,
  } = await import('@/engines/writings/chapterExport');

  const projectId = 'chapter-export-project';
  const writing = (value: Partial<Writing> & Pick<Writing, 'id' | 'title'>): Writing => ({
    id: value.id,
    projectId,
    title: value.title,
    status: 'draft',
    content: '<p>Prosa</p>',
    wordCount: 1,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...value,
  });

  const book: Writing[] = [
    writing({ id: 'ch-1', title: 'La casa', chapter: 1 }),
    writing({ id: 'ch-2', title: 'Capítulo del corazón', chapter: 2 }),
    writing({ id: 'ch-7', title: 'The Drowned Chapel', chapter: 7 }),
    writing({ id: 'ch-10', title: 'Marek & Aurelia', chapter: 10 }),
    writing({ id: 'ch-12', title: '', chapter: 12 }),
    writing({ id: 'idea', title: 'What if the bell rings twice', updatedAt: 900 }),
    writing({ id: 'blank', title: 'Nothing written yet', chapter: 4, content: '<p>  </p>', wordCount: 0 }),
    writing({ id: 'gdoc', title: 'Never synced', chapter: 5, isGoogleDoc: true, content: '', wordCount: 0 }),
  ];
  const stems = (pieces: Writing[], numberWidth: number): string[] =>
    pieces.map(piece => chapterExportNaming([piece], {
      projectTitle: 'Wolves of Aral',
      untitledLabel: 'Untitled',
      numberWidth,
    }).filenameStem);

  // ── The selection is manuscript order, whatever order it was asked for ──
  //
  // A reader sent chapters 1, 7 and 10 reads them in that order however they
  // were ticked, and a repeated id must not put a chapter in the file twice.
  const picked = selectChapterExport(book, ['ch-10', 'ch-1', 'ch-7', 'ch-1', 'ch-404']);
  assert(
    picked.writings.map(piece => piece.id).join(',') === 'ch-1,ch-7,ch-10',
    `the selection left manuscript order, or exported a chapter twice: ${picked.writings.map(p => p.id).join(',')}`,
  );
  assert(picked.missingIds.join(',') === 'ch-404', 'a deleted chapter was not reported as missing');

  // ── An unsynced Google Doc and an unwritten chapter are different problems ──
  //
  // Both are empty; only one is recoverable. The linked doc has its text
  // somewhere else and needs a sync — exporting it would mail a blank file.
  // The unwritten chapter is a decision the writer is allowed to make, so it
  // is reported and never refused.
  const empties = selectChapterExport(book, ['blank', 'gdoc', 'ch-1']);
  assert(
    empties.googleDocsWithoutContent.map(piece => piece.id).join(',') === 'gdoc',
    'an unsynced Google Doc was not held back from the export',
  );
  assert(
    empties.emptyWritings.map(piece => piece.id).join(',') === 'blank',
    'an unwritten chapter was misfiled as a Google Doc problem, or went unreported',
  );

  // ── It sorts in a folder ──
  //
  // The padding is measured against the BOOK, not the selection, because the
  // folder fills up one chapter at a time over months.
  const width = chapterNumberWidth(book);
  assert(width === 2, `a twelve-chapter book asked for ${width}-digit numbering`);
  assert(
    chapterNumberWidth([...book, writing({ id: 'ch-112', title: 'Late', chapter: 112 })]) === 3,
    'a book past chapter 99 did not widen its numbering',
  );
  assert(
    chapterNumberWidth([writing({ id: 'lonely', title: 'Idea' })]) === 2,
    'a project with no numbered chapters dropped below two-digit numbering',
  );

  const reading = [book[0], book[2], book[3]];
  const padded = stems(reading, width);
  assert(
    padded.join('|') === '01 La casa|07 The Drowned Chapel|10 Marek _ Aurelia',
    `a single chapter is no longer named for its number and title: ${padded.join('|')}`,
  );
  assert(
    [...padded].sort().join('|') === padded.join('|'),
    `chapters exported one at a time do not sort into reading order: ${[...padded].sort().join('|')}`,
  );
  // The guard is load-bearing rather than lucky: without the padding this is
  // the `1, 10, 2` a writer actually gets back out of their own folder.
  const unpadded = stems(reading, 1);
  assert(
    [...unpadded].sort().join('|') !== unpadded.join('|'),
    'the fixture no longer reaches the byte-sort bug the padding exists for',
  );

  // ── It is safe, and it is still Spanish ──
  const hostile = chapterExportNaming(
    [writing({ id: 'evil', title: '../../etc/hosts', chapter: 3 })],
    { projectTitle: 'Wolves of Aral', untitledLabel: 'Untitled', numberWidth: width },
  );
  assert(
    !/[/\\:"*?<>|]/.test(hostile.filenameStem) && !hostile.filenameStem.includes('..'),
    `a chapter title escaped into the file path: ${hostile.filenameStem}`,
  );
  assert(
    stems([book[1]], width)[0] === '02 Capítulo del corazón',
    `the accents this app is written for were stripped out of the file name: ${stems([book[1]], width)[0]}`,
  );

  // A blank title is what the editor saves when the writer clears the field,
  // and it used to reach the file as `.docx` with nothing in front of it — and
  // the document title as a book name with an em dash hanging off the end.
  const untitled = chapterExportNaming([book[4]], {
    projectTitle: 'Wolves of Aral',
    untitledLabel: 'Sin título',
    numberWidth: width,
  });
  assert(untitled.filenameStem === '12 Sin título', `a blank chapter title produced "${untitled.filenameStem}"`);
  assert(
    !/—\s*$/.test(untitled.documentTitle) && untitled.documentTitle === 'Wolves of Aral — Sin título',
    `a blank chapter title left a hanging em dash: "${untitled.documentTitle}"`,
  );

  // An idea carries no chapter number, and `00 ` in front of it would claim it
  // was chapter zero — the same thing `chapterOrder.ts` refuses to do.
  const unnumbered = chapterExportNaming([book[5]], {
    projectTitle: 'Wolves of Aral',
    untitledLabel: 'Untitled',
    numberWidth: width,
  });
  assert(
    unnumbered.filenameStem === 'What if the bell rings twice',
    `an unnumbered writing was given a chapter number: ${unnumbered.filenameStem}`,
  );

  // ── A hand-picked selection names every chapter it holds ──
  //
  // `03-12` would be a range, and a range promises ten chapters where three
  // were sent. The document title names the book first in both cases, so two
  // chapters of one novel do not arrive on a reader's device as two entries
  // with no book between them.
  const several = chapterExportNaming(picked.writings, {
    projectTitle: 'Wolves of Aral',
    untitledLabel: 'Untitled',
    numberWidth: width,
  });
  assert(
    several.filenameStem === 'Wolves of Aral 01-07-10',
    `a hand-picked selection was named as a range or lost a chapter: ${several.filenameStem}`,
  );
  assert(
    several.documentTitle === 'Wolves of Aral — 01, 07, 10',
    `a selection stopped naming its book first: ${several.documentTitle}`,
  );

  passed.push('a single chapter exports under a name that sorts, is safe, and never claims a range it does not hold');
}

// The second door into the DOCX and ePub writers.
//
// Two doors into one file format is how one of them quietly stops matching the
// other: a heading rule changes on the studio's side, the chapter menu keeps
// the old one, and nobody notices because both files open. It is only safe
// because there is exactly ONE composer underneath — `composePublishingDocument`
// — and this test is what says so, by compiling the same chapter both ways and
// refusing any difference at all.
//
// Then the three answers the chapter export gives without asking, checked in
// the file rather than in the constant that holds them.
async function testChapterExportIsTheSameCompiler(): Promise<void> {
  const { CHAPTER_EXPORT_DEFAULTS, buildChapterExport } =
    await import('@/engines/writings/chapterExport');
  const [{ buildPublishingDocx }, { buildPublishingEpub }] = await Promise.all([
    import('@/engines/writings/publishingDocx'),
    import('@/engines/writings/publishingEpub'),
  ]);

  const projectId = 'chapter-export-compiler';
  const generatedAt = Date.UTC(2026, 7, 24);
  const chapter: Writing = {
    id: 'ch-7',
    projectId,
    title: 'The Drowned Chapel',
    status: 'draft',
    // A synopsis that gives away the chapter, an image the portable formats
    // must drop, and markup that must arrive escaped rather than as markup.
    synopsis: 'Marta finds the body',
    content: '<p>«Ven aquí» —dijo Aurelia—.</p><p>Marek &amp; the <em>fin</em>.</p><img src="x.png">',
    wordCount: 9,
    chapter: 7,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  };

  const chapterFile = buildChapterExport([chapter], {
    projectTitle: 'Wolves of Aral',
    chapterLabel: 'Chapter',
    untitledLabel: 'Untitled',
    wordLabel: 'words',
    locale: 'en-US',
    numberWidth: 2,
    generatedAt,
  });

  // ── One composer ──
  //
  // The studio, told to answer the profile's three questions the way the
  // chapter export answers them, has to produce the identical section. Labels
  // are passed on both sides so this compares two code paths, not two label
  // sets.
  const profile: PublishingProfile = {
    id: 'mirror',
    projectId,
    name: chapterFile.filenameStem,
    format: 'manuscript',
    includeTitlePage: CHAPTER_EXPORT_DEFAULTS.includeTitlePage,
    includeSynopsis: CHAPTER_EXPORT_DEFAULTS.includeSynopsis,
    includeBibliography: CHAPTER_EXPORT_DEFAULTS.includeBibliography,
    citationStyle: 'apa',
    selectionMode: 'selected',
    selectedWritingIds: [chapter.id],
    writingOrder: [chapter.id],
    createdAt: 1,
    updatedAt: 1,
  };
  const studioFile = buildPublishingArtifacts(
    { id: projectId, title: 'Wolves of Aral' },
    profile,
    [chapter],
    [],
    {
      titleOverride: chapterFile.documentTitle,
      generatedAt,
      labels: {
        locale: 'en-US', wordLabel: 'words', chapterLabel: 'Chapter', bibliographyTitle: 'Bibliography',
        untitledLabel: 'Untitled', unknownAuthor: 'Unknown author', noDate: 'n.d.', accessedLabel: 'Accessed',
      },
    },
  );
  assert(
    JSON.stringify(chapterFile.document.sections) === JSON.stringify(studioFile.document.sections),
    'the chapter menu and the publishing studio compiled the same chapter differently',
  );
  assert(
    chapterFile.document.wordCount === studioFile.document.wordCount
      && chapterFile.document.omittedPortableImageCount === 1,
    'the chapter export lost the word count or the portable image policy',
  );
  assert(
    chapterFile.docxFilename === '07 The Drowned Chapel.docx'
      && chapterFile.epubFilename === '07 The Drowned Chapel.epub'
      && chapterFile.markdownFilename === '07 The Drowned Chapel.md',
    `the chapter's files are no longer named for the chapter: ${chapterFile.docxFilename}`,
  );

  // ── The identifier follows the chapter, not its title ──
  //
  // An e-reader keys its library on `dc:identifier`. A chapter re-sent after a
  // rename has to REPLACE the copy already on the reader's device instead of
  // sitting beside it as a second book.
  const renamed = buildChapterExport(
    [{ ...chapter, title: 'The Chapel Beneath' }],
    { projectTitle: 'Wolves of Aral', chapterLabel: 'Chapter', untitledLabel: 'Untitled', wordLabel: 'words', locale: 'en-US', numberWidth: 2, generatedAt },
  );
  assert(
    renamed.document.identifier === chapterFile.document.identifier,
    'renaming a chapter changed its identifier, so a re-send would arrive as a second book',
  );
  assert(
    renamed.filenameStem !== chapterFile.filenameStem,
    'renaming a chapter did not change the name of the file it exports to',
  );

  // ── The three answers, read out of the file ──
  const epub = await JSZip.loadAsync(await (await buildPublishingEpub(chapterFile.document)).arrayBuffer());
  const opf = await epub.file('EPUB/package.opf')?.async('string') ?? '';
  const section = await epub.file('EPUB/section-1.xhtml')?.async('string') ?? '';
  const nav = await epub.file('EPUB/nav.xhtml')?.async('string') ?? '';

  // TITLE PAGE — off. One chapter with a cover sheet would print the book's
  // title over the selection's word count, which is a claim about the
  // manuscript that is not true.
  assert(
    (opf.match(/<itemref /g) ?? []).length === 1 && !epub.file('EPUB/title.xhtml'),
    'a one-chapter export grew a title page claiming the book is one chapter long',
  );
  assert(
    opf.includes('<dc:title>Wolves of Aral — The Drowned Chapel</dc:title>'),
    'the exported chapter no longer names the book an e-reader shelves it under',
  );
  assert(
    section.includes('Chapter 7 — The Drowned Chapel') && nav.includes('Chapter 7 — The Drowned Chapel'),
    'the chapter lost the heading it carries inside the compiled book',
  );

  // SYNOPSES — off. The one line the writer wrote for themselves is the one
  // line a beta reader must not be handed above the chapter it gives away.
  assert(
    !section.includes('Marta finds the body') && !nav.includes('Marta finds the body'),
    'the planning synopsis was published to the reader',
  );

  // Markup arrives as text, and the image the portable policy drops is gone
  // rather than left as a broken reference.
  assert(
    section.includes('Marek &amp; the') && !/<img/i.test(section),
    'the ePub carried raw markup or an image the portable policy omits',
  );

  const docx = await JSZip.loadAsync(await (await buildPublishingDocx(chapterFile.document)).arrayBuffer());
  const body = await docx.file('word/document.xml')?.async('string') ?? '';
  assert(Boolean(docx.file('[Content_Types].xml')), 'the chapter DOCX is missing its content-types manifest');
  assert(body.includes('Chapter 7 — The Drowned Chapel'), 'the chapter DOCX lost its heading');
  assert(!body.includes('Marta finds the body'), 'the chapter DOCX published the planning synopsis');
  assert(
    !Object.keys(docx.files).some(path => path.startsWith('word/media/')),
    'the chapter DOCX embedded an image the portable policy omits',
  );

  // BIBLIOGRAPHY — off, and off by having no citations to carry rather than by
  // a flag: `Citation.writingIds` is written empty everywhere, so there is no
  // way to tell this chapter's sources from its book's, and the whole list
  // would credit it with works it never mentions.
  assert(
    chapterFile.document.bibliography.length === 0
      && chapterFile.document.bibliographyTitle === undefined
      && !epub.file('EPUB/bibliography.xhtml'),
    'a one-chapter export attached the reference list of the whole project',
  );

  passed.push('a chapter exported from its own card runs the studio compiler, and answers the three profile questions without a title page, a synopsis or a borrowed bibliography');
}

// Deleting a project is the most destructive thing this app can do and, until
// now, the only one with no way back: no trash, no undo, no copy — one confirm
// dialog between a writer and a novel that stopped existing. The delete still
// happens (they asked for it), but a full archive is written to the backups
// folder first, in the one format the app's own restore reads.
//
// The rule this pins is the one that decides whether the feature helps or
// hurts: the writer must never be told a copy exists when it does not. A
// failed write, a refused write, a web build with no folder at all — every one
// of those has to come back `saved: false` rather than throw, so the caller
// picks the honest sentence instead of the reassuring one.
async function testProjectDeleteLeavesACopy(): Promise<void> {
  const { archiveProjectBeforeDelete, farewellFileName } = await import('@/services/deleteSafetyNet');

  const projectId = 'delete-safety-net-project';
  const now = Date.now();
  await db.projects.put({
    id: projectId, title: 'A novel about to go', mode: 'novelist', type: 'standalone',
    color: '#7c3aed', description: '', status: 'in-progress',
    enabledEngines: [], engineOrder: [], createdAt: now, updatedAt: now,
  } as never);
  await db.writings.put({
    id: 'delete-safety-net-writing', projectId, title: 'The only chapter', status: 'draft',
    content: '<p>irreplaceable</p>', wordCount: 1, chapter: 1, tags: [],
    createdAt: now, updatedAt: now,
  } as never);

  // The harness renderer runs without the preload, so `window.electronAPI` may
  // not exist at all — which is also the web build, and the case the last
  // assertion below is about. A stand-in object is installed for the duration
  // and removed again, so this test neither depends on the bridge being there
  // nor leaves one behind for the tests that follow.
  const win = window as unknown as { electronAPI?: { backup?: unknown } };
  const hadApi = 'electronAPI' in win;
  const originalApi = win.electronAPI;
  const install = (backup: unknown) => {
    if (backup === undefined) {
      win.electronAPI = { ...(win.electronAPI ?? {}), backup: undefined };
      return;
    }
    win.electronAPI = { ...(win.electronAPI ?? {}), backup };
  };
  const restoreApi = () => {
    if (hadApi) win.electronAPI = originalApi;
    else delete win.electronAPI;
  };

  try {
    // The happy path: the bytes reach the door, and they are a real archive of
    // this project — not an empty file that would pass a boolean check.
    let written: { name: string; bytes: ArrayBuffer; copies: number } | null = null;
    install({
      writeArchive: async (bytes: ArrayBuffer, name: string, copies: number) => {
        written = { bytes, name, copies };
        return { ok: true, path: `C:\\backups\\${name}` };
      },
      revealFolder: async () => ({ ok: true }),
    });

    const saved = await archiveProjectBeforeDelete(projectId);
    assert(saved.saved, 'a writable folder did not produce a copy');
    assert(Boolean(saved.path), 'the copy did not report where it landed');
    const record = written as { name: string; bytes: ArrayBuffer; copies: number } | null;
    assert(Boolean(record), 'nothing was handed to the door');
    // The name is the whole security boundary on this channel, so it is pinned
    // here against the very pattern the main process will test it with. A
    // rename on either side that stops them agreeing fails this, not the
    // writer's only copy of a deleted novel.
    const acceptedByMain =
      /^writers-hoard-deleted-(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.zip$/;
    assert(
      acceptedByMain.test(record?.name ?? ''),
      `the main process would refuse this name: ${record?.name}`,
    );
    assert(
      (record?.name ?? '').includes('a-novel-about-to-go'),
      'the copy does not name the project it holds',
    );
    // A title that reduces to nothing must still get its copy, and a title
    // trying to leave the folder must not.
    const when = new Date('2026-09-01T07:15:00Z');
    assert(acceptedByMain.test(farewellFileName('第一章', when)), 'a non-Latin title lost its copy');
    assert(acceptedByMain.test(farewellFileName('   ', when)), 'a blank title lost its copy');
    assert(
      acceptedByMain.test(farewellFileName('../../etc/hosts', when)),
      'a traversal attempt was not reduced to a name',
    );
    assert(
      !farewellFileName('../../etc/hosts', when).includes('..'),
      'a traversal attempt survived into the file name',
    );
    assert(
      acceptedByMain.test(farewellFileName('Herederos de almas: el retorno', when)),
      'an ordinary Spanish title with punctuation was not accepted',
    );
    assert((record?.copies ?? 0) > 1, 'rotation must keep more than one farewell copy');
    const archive = await JSZip.loadAsync(record?.bytes ?? new ArrayBuffer(0));
    const paths = Object.keys(archive.files);
    assert(
      paths.some(path => path.includes('The only chapter')),
      `the copy does not carry the project's chapters: ${paths.slice(0, 6).join(', ')}`,
    );

    // A refused write. The delete goes ahead regardless, so the ONLY thing that
    // must not happen here is a `saved: true` — or a throw, which would abort a
    // delete the writer already confirmed.
    install({
      writeArchive: async () => ({ ok: false, code: 'insufficient-space' as const }),
      revealFolder: async () => ({ ok: true }),
    });
    const refused = await archiveProjectBeforeDelete(projectId);
    assert(!refused.saved, 'a refused write was reported as a saved copy');
    assert(refused.error === 'insufficient-space', 'the reason for the refusal was lost');

    // A door that throws.
    install({
      writeArchive: async () => { throw new Error('disk on fire'); },
      revealFolder: async () => ({ ok: true }),
    });
    const threw = await archiveProjectBeforeDelete(projectId);
    assert(!threw.saved, 'a thrown write was reported as a saved copy');
    assert((threw.error ?? '').includes('disk on fire'), 'the thrown reason was lost');

    // No door at all — the web build. Same answer, no exception.
    install(undefined);
    const noBridge = await archiveProjectBeforeDelete(projectId);
    assert(!noBridge.saved, 'a build with no backups folder claimed to have saved a copy');
  } finally {
    restoreApi();
    await db.writings.delete('delete-safety-net-writing');
    await db.projects.delete(projectId);
  }

  passed.push('deleting a project writes its whole archive first, and never claims a copy it did not write');
}

async function testRecoveryJournalRefusesADivergedRow(): Promise<void> {
  const projectId = 'journal-conflict-project';
  const writingId = 'journal-conflict-chapter';
  const now = Date.now();
  const base = '<p>The tower was black.</p>';
  await db.writings.add({
    id: writingId, projectId, title: 'The tower', status: 'draft',
    content: base, wordCount: 4, tags: [], createdAt: now, updatedAt: now,
  });

  // A draft made against the row exactly as it stands. Ordinary recovery: the
  // writer gets their words back and nothing else has a claim on the chapter.
  writeWritingRecoveryDraft(
    projectId, writingId, 'The tower', `${base}<p>Then it fell.</p>`, 'The tower', base,
  );
  const asLeft = await db.writings.get(writingId);
  assert(asLeft, 'the fixture chapter was not written');
  const clean = inspectWritingRecoveryDraft(asLeft);
  assert(clean.kind === 'draft', `a draft made against the current row must recover, not ${clean.kind}`);
  assert(clean.draft.content.includes('Then it fell'), 'the recoverable draft came back without its text');
  assert(
    readWritingRecoveryDraft(asLeft)?.content === clean.draft.content,
    'the plain reader did not hand back a draft that is safe to reopen',
  );

  // Now something else rewrites the chapter while that draft is still waiting.
  const rewritten = '<p>The tower was white, and it was burning.</p>';
  await updateWriting(writingId, { content: rewritten, wordCount: 8 });
  const moved = await db.writings.get(writingId);
  assert(moved, 'the rewritten chapter is missing');

  const conflict = inspectWritingRecoveryDraft(moved);
  assert(conflict.kind === 'conflict', `a draft whose baseline moved must be a conflict, not ${conflict.kind}`);
  assert(conflict.draft.content.includes('Then it fell'), 'the conflicted draft was handed back empty');
  assert(conflict.draft.baseContent === base, 'the conflicted draft lost the baseline that identified it');

  // The blind reader is the one the editor used to call, and whatever it
  // returns goes straight into an editor and is autosaved 1.2 seconds later.
  // For a diverged draft the only safe answer is nothing at all.
  assert(
    readWritingRecoveryDraft(moved) === null,
    'a draft older than its chapter was handed back for an editor to autosave over the newer text',
  );
  // Reading a conflict must not spend it either: the text is the writer's and
  // only the writer can say which version of the chapter wins.
  assert(
    inspectWritingRecoveryDraft(moved).kind === 'conflict',
    'inspecting a conflict consumed the journal it was still holding',
  );

  // Residue outranks both. A journal that already matches the row is a crash
  // between the Dexie commit and the cleanup, so it is discarded on sight —
  // and it must stay discarded now that a baseline check sits behind it.
  writeWritingRecoveryDraft(projectId, writingId, moved.title, rewritten, 'The tower', base);
  assert(
    inspectWritingRecoveryDraft(moved).kind === 'none',
    'a journal identical to its own row was kept instead of discarded as residue',
  );

  clearWritingRecoveryDraft(projectId, writingId);
  await db.writings.delete(writingId);
  passed.push('recovery journal: a draft whose chapter was rewritten underneath it is a conflict, never a silent revert');
}


// A pending draft belongs to the row it was typed into. The journal is keyed by
// project AND writing for that reason, and the editor reopens whatever answers
// for the chapter it is opening — so a key that answered too widely would pour
// one chapter's crash draft into another's editor and autosave it there.
function testRecoveryJournalIsScopedToItsChapter(): void {
  const projectId = 'journal-scope-project';
  const otherProjectId = 'journal-scope-other-project';
  const chapterA = { id: 'journal-scope-a', projectId, title: 'A', content: '<p>a</p>' };
  const chapterB = { id: 'journal-scope-b', projectId, title: 'B', content: '<p>b</p>' };
  const draft = '<p>a, and a good deal more</p>';

  writeWritingRecoveryDraft(projectId, chapterA.id, 'A', draft, 'A', chapterA.content);

  assert(readWritingRecoveryDraft(chapterB) === null, "chapter A's draft was offered to chapter B");
  assert(
    readWritingRecoveryDraft({ ...chapterA, projectId: otherProjectId }) === null,
    "a draft crossed into another project's chapter of the same id",
  );
  assert(readWritingRecoveryDraft(chapterA)?.content === draft, "chapter A's own draft was not returned to it");

  // A journal whose stored ids disagree with the row it is read for is corrupt,
  // not merely irrelevant: it is dropped rather than offered anywhere.
  writeWritingRecoveryDraft(projectId, chapterB.id, 'A', draft, 'A', chapterA.content);
  window.localStorage.setItem(
    `writers-hoard:writing-recovery:${projectId}:${chapterB.id}`,
    JSON.stringify({
      version: 1, projectId, writingId: chapterA.id, title: 'A', content: draft,
      baseTitle: 'A', baseContent: chapterA.content, updatedAt: Date.now(),
    }),
  );
  assert(readWritingRecoveryDraft(chapterB) === null, 'a journal naming another chapter was read as this one');
  assert(
    window.localStorage.getItem(`writers-hoard:writing-recovery:${projectId}:${chapterB.id}`) === null,
    'a mislabelled journal entry was left in place to be read again',
  );

  clearWritingRecoveryDraft(projectId, chapterA.id);
  assert(readWritingRecoveryDraft(chapterA) === null, 'clearing the journal left it readable');
  passed.push('recovery journal is keyed by project AND chapter: a draft is never offered to the wrong row');
}


// The one failure the save path cannot afford to swallow.
//
// `db.writings.update` on an id that is no longer there RESOLVES, with 0, and
// never rejects — `chapterOrderPersist` relies on exactly that to pass over a
// chapter deleted in another window. For the autosave it is the worst outcome
// it has, because every layer above reads "the promise resolved" as "the words
// are on disk": the indicator turns to Saved, and the recovery journal — the
// only other copy of the text — is deleted as residue of a write that never
// happened. A chapter the copilot deleted while the writer had it open is
// exactly the case, and the whole evening goes with it under a green tick.
async function testWritingUpdateOnAVanishedRowIsNotASuccess(): Promise<void> {
  const projectId = 'writing-gone-project';
  const writingId = 'writing-gone-chapter';
  const now = Date.now() - 1;
  await db.writings.add({
    id: writingId, projectId, title: 'Still here', status: 'draft',
    content: '<p>one</p>', wordCount: 1, tags: [], createdAt: now, updatedAt: now,
  });

  // The Dexie behaviour the whole guarantee rests on, pinned so a version bump
  // that starts rejecting (or starts reporting 1) is caught here and not by a
  // writer.
  const missed = await db.writings.update('writing-gone-never-existed', { title: 'ghost' });
  assert(missed === 0, `Dexie reported ${missed} rows written for a key that does not exist`);
  assert(!(await db.writings.get('writing-gone-never-existed')), 'an update on a missing key created the row');

  await updateWriting(writingId, { title: 'Renamed' });
  const renamed = await db.writings.get(writingId);
  assert(renamed?.title === 'Renamed', 'updating a chapter that exists did not write');
  assert((renamed?.updatedAt ?? 0) > now, 'updateWriting did not move updatedAt');

  await db.writings.delete(writingId);
  let raised: unknown = null;
  try {
    await updateWriting(writingId, { content: '<p>an evening of work</p>', wordCount: 4 });
  } catch (err) {
    raised = err;
  }
  assert(raised instanceof WritingGoneError, 'a save into a deleted chapter resolved as if it had worked');
  assert(raised.writingId === writingId, 'the failure did not name the chapter that is gone');
  assert(!(await db.writings.get(writingId)), 'the failed save resurrected the deleted chapter');

  passed.push('a chapter save that reached no row fails instead of resolving over a chapter that was never written');
}


// `takeSnapshot` swallows its own errors, which is right — a restore point that
// cannot be written must never interrupt typing. But a caller that is about to
// drop its own last copy of the words needs to know whether the version landed,
// and "it returned" was not an answer. It reports the id it wrote, or null.
async function testSnapshotReportsWhetherItWrote(): Promise<void> {
  const projectId = 'snapshot-report-project';
  const writingId = 'snapshot-report-chapter';
  const chapter = { id: writingId, projectId, title: 'Chapter', content: '<p>the first pass</p>' };

  // Nothing to protect. This is also why a chapter written from nothing in one
  // sitting has no automatic version at all: the snapshot is taken on OPEN, of
  // the document as it was before the session, and at that point it is empty.
  assert(await takeSnapshot({ ...chapter, content: '   ' }, 'auto') === null, 'an empty document took an automatic snapshot');

  const first = await takeSnapshot(chapter, 'auto');
  assert(typeof first === 'string', 'the first automatic snapshot reported nothing');
  assert(await takeSnapshot(chapter, 'auto') === null, 'an unchanged document took a second automatic snapshot');

  // Deduplication is `auto` only. A manual version is a thing the author asked
  // for, and so is the rescue of a crash draft — which is why the caller that
  // files one has to clear the journal afterwards, or every reopen collects
  // another copy of the same text.
  const manual = await takeSnapshot(chapter, 'manual');
  assert(typeof manual === 'string' && manual !== first, 'a manual version of unchanged text was deduplicated away');
  assert((await listSnapshots(writingId)).length === 2, 'the two versions that were written are not both in the history');

  await deleteSnapshotsForWriting(writingId);
  assert((await listSnapshots(writingId)).length === 0, 'the version history did not clear');
  passed.push('takeSnapshot reports the id it wrote, or null for an empty, deduplicated or failed one');
}


// The whole answer to a conflicted draft, end to end.
//
// Neither version of the chapter may be thrown away to make the choice easy, so
// the draft is filed as a version BEFORE the writer is asked, and the journal is
// dropped only once that write is confirmed. From there the words survive both
// answers, a dialog closed without answering, and another crash — version
// history is never pruned — and the default answer, keeping what is on disk,
// costs nothing but a click through History.
async function testRescuedDraftSurvivesInVersionHistory(): Promise<void> {
  const projectId = 'rescued-draft-project';
  const writingId = 'rescued-draft-chapter';
  const now = Date.now();
  const beforeCrash = '<p>She opened the door.</p>';
  const crashed = '<p>She opened the door.</p><p>Behind it, nothing at all.</p>';
  const rewrittenElsewhere = '<p>She opened the door, and the corridor was gone.</p>';

  await db.writings.add({
    id: writingId, projectId, title: 'The door', status: 'draft',
    content: beforeCrash, wordCount: 4, tags: [], createdAt: now, updatedAt: now,
  });
  writeWritingRecoveryDraft(projectId, writingId, 'The door', crashed, 'The door', beforeCrash);
  // …and the chapter is rewritten before the writer ever reopens it.
  await updateWriting(writingId, { content: rewrittenElsewhere, wordCount: 9 });

  const row = await db.writings.get(writingId);
  assert(row, 'the fixture chapter is missing');
  const outcome = inspectWritingRecoveryDraft(row);
  assert(outcome.kind === 'conflict', `the rewritten chapter produced ${outcome.kind}, not a conflict`);

  const filed = await takeSnapshot(
    { id: writingId, projectId, title: outcome.draft.title, content: outcome.draft.content },
    'manual',
  );
  assert(typeof filed === 'string', 'the rescued draft was not filed as a version');
  clearWritingRecoveryDraft(projectId, writingId);
  assert(readWritingRecoveryDraft(row) === null, 'the journal was not released once its draft was filed');

  const history = await listSnapshots(writingId);
  assert(history.some(v => v.id === filed && v.content === crashed), 'the filed version does not hold the crashed draft');
  assert(
    (await db.writings.get(writingId))?.content === rewrittenElsewhere,
    'filing the draft as a version changed the chapter, which is the revert this is here to prevent',
  );

  // And the draft is one restore away — a restore that is itself undoable,
  // because `restoreSnapshot` keeps what it replaces first.
  const restored = await restoreSnapshot(filed);
  assert(restored?.content === crashed, 'the rescued draft could not be restored');
  assert((await db.writings.get(writingId))?.content === crashed, 'restoring the rescued draft did not reach the row');
  assert(
    (await listSnapshots(writingId)).some(v => v.reason === 'pre-restore' && v.content === rewrittenElsewhere),
    'restoring the draft did not first keep the text it replaced',
  );

  await deleteSnapshotsForWriting(writingId);
  await db.writings.delete(writingId);
  passed.push('a crash draft whose chapter moved on is kept as a version: restorable, undoable, and never applied behind the writer');
}

/**
 * A keystroke as the browser would deliver it. `Mod` becomes ⌘ on a Mac and
 * Ctrl elsewhere — the same reading `matchesChord` gives it — and letters carry
 * their physical `code` too, because that is the half of the match that
 * survives a Dvorak or a Spanish layout.
 */
function keystroke(chord: string, mac: boolean): KeyboardEvent {
  const tokens = chord.split('+');
  const key = tokens[tokens.length - 1];
  const modifiers = new Set(tokens.slice(0, -1));
  const letter = /^[A-Za-z]$/.test(key);
  const PUNCTUATION: Record<string, string | undefined> = { '/': 'Slash', '[': 'BracketLeft', ']': 'BracketRight' };
  return new KeyboardEvent('keydown', {
    key: letter ? key.toLowerCase() : key === 'Space' ? ' ' : key,
    code: letter ? `Key${key.toUpperCase()}` : PUNCTUATION[key] ?? key,
    ctrlKey: (modifiers.has('Mod') && !mac) || modifiers.has('Ctrl'),
    metaKey: modifiers.has('Mod') && mac,
    altKey: modifiers.has('Alt'),
    shiftKey: modifiers.has('Shift'),
  });
}

function testShortcutTableInvariants(): void {
  const scopeIds = SHORTCUT_SCOPES.map(scope => scope.id);
  const ids = new Set<string>();
  const descriptions = new Set<string>();

  for (const shortcut of SHORTCUTS) {
    assert(!ids.has(shortcut.id), `two shortcuts share the id ${shortcut.id}`);
    ids.add(shortcut.id);

    assert(scopeIds.includes(shortcut.scope), `${shortcut.id} is in scope ${shortcut.scope}, which the panel never prints`);
    assert(shortcut.keys.length > 0, `${shortcut.id} promises no key at all`);
    assert(shortcut.source.length > 0, `${shortcut.id} does not say which file answers it`);

    // A row with no description renders its own id at a novelist.
    assert(shortcut.descriptionKey.startsWith(`shortcuts.${shortcut.scope}.`),
      `${shortcut.id} carries ${shortcut.descriptionKey}, which is not a description key for its scope`);
    assert(!descriptions.has(shortcut.descriptionKey),
      `${shortcut.descriptionKey} describes two different shortcuts`);
    descriptions.add(shortcut.descriptionKey);

    // Only the tokens the module knows how to stand for may stand for several
    // keys; anything else has to be a key an event can actually be.
    for (const chord of [...shortcut.keys, ...(shortcut.macKeys ?? [])]) {
      const key = chord.split('+').slice(-1)[0];
      assert(key.length > 0, `${shortcut.id} has a chord ending in a modifier: ${chord}`);
      if (DISPLAY_ONLY_KEYS.has(key)) {
        assert(!matchesChord(keystroke('Escape', false), chord),
          `${chord} is a display-only token and must never claim to match a keystroke`);
      }
    }
  }

  // Every scope the panel prints a heading for has something under it, or the
  // sheet grows an empty section nobody notices is empty.
  for (const scope of SHORTCUT_SCOPES) {
    assert(SHORTCUTS.some(shortcut => shortcut.scope === scope.id), `scope ${scope.id} has no shortcuts`);
    assert(scope.titleKey.length > 0 && scope.whereKey.length > 0,
      `scope ${scope.id} does not say what it is or where it applies`);
  }

  // THE COLLISION TEST. On both platforms, because `macKeys` is a swap and a
  // clash that only exists on a Mac is exactly the kind nobody finds.
  for (const mac of [false, true]) {
    for (const scope of scopeIds) {
      const taken = new Map<string, string>();
      for (const shortcut of SHORTCUTS.filter(row => row.scope === scope)) {
        for (const chord of shortcutChords(shortcut, mac)) {
          const owner = taken.get(chord);
          assert(owner === undefined,
            `${chord} is bound to both ${owner} and ${shortcut.id} in ${scope} (mac: ${mac})`);
          taken.set(chord, shortcut.id);
        }
      }
    }
  }

  // The sheet's own key has to be free across the WHOLE app, not merely inside
  // its own group: it is bound on the window, so a second owner anywhere would
  // win or lose at random depending on which listener ran first.
  const panel = getShortcut(SHORTCUTS_PANEL_SHORTCUT);
  assert(panel !== undefined, 'the shortcuts panel is not in its own table');
  for (const mac of [false, true]) {
    const chords = shortcutChords(panel, mac);
    const others = SHORTCUTS
      .filter(row => row.id !== panel.id)
      .flatMap(row => shortcutChords(row, mac));
    for (const chord of chords) {
      assert(!others.includes(chord), `${chord} opens the shortcuts panel and something else too (mac: ${mac})`);
    }
  }

  // The ids the code names must exist, and must be the rows that read this
  // table back — those are the only ones that cannot drift.
  for (const id of [COMMAND_CENTRE_SHORTCUT, SHORTCUTS_PANEL_SHORTCUT, SIDEBAR_SHORTCUT, FOCUS_MODE_SHORTCUT]) {
    const shortcut = getShortcut(id);
    assert(shortcut !== undefined, `${id} is named in code but missing from the table`);
    assert(shortcut.readsThisTable === true, `${id} is wired to the table but not marked as such`);
  }

  // The sidebar key is bound on the window too, so like the sheet's it must
  // be free everywhere; and the editor has Mod+B for bold, which is exactly
  // why the sidebar's is the shifted one.
  const sidebar = getShortcut(SIDEBAR_SHORTCUT)!;
  for (const mac of [false, true]) {
    const others = SHORTCUTS
      .filter(row => row.id !== sidebar.id)
      .flatMap(row => shortcutChords(row, mac));
    for (const chord of shortcutChords(sidebar, mac)) {
      assert(!others.includes(chord), `${chord} hides the sidebar and something else too (mac: ${mac})`);
    }
  }
  assert(matchesShortcut(keystroke('Mod+Shift+B', false), SIDEBAR_SHORTCUT, false), 'Ctrl+Shift+B does not hide the sidebar');
  assert(!matchesShortcut(keystroke('Mod+B', false), SIDEBAR_SHORTCUT, false), 'plain Ctrl+B (bold) hides the sidebar');
  assert(matchesShortcut(keystroke('Mod+Shift+F', false), FOCUS_MODE_SHORTCUT, false), 'Ctrl+Shift+F does not enter focus mode');
  assert(!matchesShortcut(keystroke('Mod+F', false), FOCUS_MODE_SHORTCUT, false), 'plain Ctrl+F (find) enters focus mode');

  passed.push('shortcut table: unique ids, described and sourced rows, no collision within a scope');
}

function testShortcutMatching(): void {
  // PLATFORM PRINTING. One row, two keyboards. The Mac gets the glyphs printed
  // on its own keys; everywhere else gets the words, and the words that are
  // words rather than symbols carry a locale key so a Spanish keyboard can say
  // Mayús instead of Shift.
  const macMod = chordCaps('Mod+K', true);
  const pcMod = chordCaps('Mod+K', false);
  assert(macMod.map(cap => cap.text).join(' ') === '⌘ K', 'the Mac no longer prints ⌘K');
  assert(pcMod.map(cap => cap.text).join(' ') === 'Ctrl K', 'a PC no longer prints Ctrl K');
  assert(macMod.every(cap => cap.localeKey === undefined), 'a glyph was handed to the translator');

  const macShift = chordCaps('Shift+Enter', true);
  const pcShift = chordCaps('Shift+Enter', false);
  assert(macShift[0].text === '⇧' && macShift[0].localeKey === undefined, 'Shift is not ⇧ on a Mac');
  assert(pcShift[0].localeKey === 'shortcuts.key.shift', 'Shift is untranslatable off the Mac');
  assert(chordCaps('Mod+Alt+F', true)[1].text === '⌥', 'Alt is not ⌥ on a Mac');
  assert(chordCaps('Mod+Alt+F', false)[1].text === 'Alt', 'Alt grew a glyph off the Mac');

  // The one row macOS forced apart: ⌘H hides the application, so replace has a
  // different key there, and the sheet has to print the one that works.
  const replace = getShortcut('editor.replace');
  assert(replace !== undefined, 'find and replace fell out of the table');
  assert(shortcutChords(replace, true)[0] === 'Mod+Alt+F', 'the Mac is being told to press ⌘H');
  assert(shortcutChords(replace, false)[0] === 'Ctrl+H', 'the PC replace chord changed');

  // MATCHING. The palette's key and the sheet's key, on both platforms.
  for (const mac of [false, true]) {
    assert(matchesShortcut(keystroke('Mod+K', mac), COMMAND_CENTRE_SHORTCUT, mac),
      `the command centre no longer answers its own row (mac: ${mac})`);
    assert(matchesShortcut(keystroke('Mod+/', mac), SHORTCUTS_PANEL_SHORTCUT, mac),
      `the shortcuts panel no longer answers its own row (mac: ${mac})`);
    // Neither key may answer the other's: they are both bound on the window.
    assert(!matchesShortcut(keystroke('Mod+/', mac), COMMAND_CENTRE_SHORTCUT, mac),
      `the palette opens on the shortcuts key (mac: ${mac})`);
    assert(!matchesShortcut(keystroke('Mod+K', mac), SHORTCUTS_PANEL_SHORTCUT, mac),
      `the sheet opens on the palette key (mac: ${mac})`);
    // A bare K is a letter in a chapter, not a command.
    assert(!matchesShortcut(keystroke('K', mac), COMMAND_CENTRE_SHORTCUT, mac),
      `an unmodified letter opened the palette (mac: ${mac})`);
  }

  // Shift is refused on a letter and tolerated on a slash, and that asymmetry
  // is not a nicety: on a Spanish keyboard `/` IS Shift+7, so refusing Shift
  // there would make the shortcuts sheet unreachable for half of this app's
  // writers. The event below is what that layout really sends.
  assert(!matchesChord(keystroke('Mod+Shift+K', false), 'Mod+K'),
    'Ctrl+Shift+K was accepted as Ctrl+K');
  const spanishSlash = new KeyboardEvent('keydown', { key: '/', code: 'Digit7', ctrlKey: true, shiftKey: true });
  assert(matchesChord(spanishSlash, 'Mod+/'), 'Ctrl+Shift+7 on a Spanish layout no longer reads as Ctrl+/');
  // And the physical key still answers when the character does not survive.
  const codeOnlySlash = new KeyboardEvent('keydown', { key: 'Dead', code: 'Slash', ctrlKey: true });
  assert(matchesChord(codeOnlySlash, 'Mod+/'), 'the Slash key stopped being a fallback');
  assert(!matchesChord(new KeyboardEvent('keydown', { key: '/', code: 'Slash' }), 'Mod+/'),
    'a plain slash — a character in a sentence — opened the sheet');

  // A display-only token stands for four keys and can never be one event, so it
  // says so instead of quietly matching nothing.
  assert(!matchesChord(keystroke('ArrowUp', false), 'Arrows'), 'a display token claimed a keystroke');
  assert(!matchesShortcut(keystroke('Escape', false), 'no.such.shortcut'), 'an unknown id matched something');

  // THE ANTI-DRIFT PAIR. `editorShortcuts` owns find and replace and cannot be
  // made to read this table, so the table is made to answer to it: the chord
  // each row prints is handed to the real predicate, on whichever platform this
  // test is running.
  const mac = isMacPlatform();
  const find = getShortcut('editor.find');
  assert(find !== undefined, 'find fell out of the table');
  const findEvent = keystroke(shortcutChords(find, mac)[0], mac);
  const replaceEvent = keystroke(shortcutChords(replace, mac)[0], mac);
  assert(isFindShortcut(findEvent), 'the sheet promises a find key the editor does not answer');
  assert(isReplaceShortcut(replaceEvent), 'the sheet promises a replace key the editor does not answer');
  assert(!isReplaceShortcut(findEvent) && !isFindShortcut(replaceEvent),
    'find and replace have collapsed onto the same key');

  passed.push('shortcut keys: ⌘/Ctrl per platform, layout-tolerant matching, editor chords still true');
}

async function testWritingVersionNeverRepeats(): Promise<void> {
  const projectId = 'version-token-project';
  const writingId = 'version-token-chapter';
  const realNow = Date.now;
  await db.writings.add({
    id: writingId, projectId, title: 'Tokens', status: 'draft',
    content: '<p>one</p>', wordCount: 1, tags: [], createdAt: 1_000, updatedAt: 1_000,
  });

  try {
    // The clock stands still — a stopped millisecond, which is exactly what a
    // burst of writes inside one task looks like from `Date.now()`.
    Date.now = () => 5_000;

    const first = await updateWritingAtVersion(writingId, { content: '<p>two</p>' });
    const second = await updateWritingAtVersion(writingId, { content: '<p>three</p>' });
    const third = await updateWritingAtVersion(writingId, { content: '<p>four</p>' });

    assert(first === 5_000, `the first write took ${first} rather than the clock`);
    assert(second === first + 1, `two writes in one millisecond shared a token (${first}, ${second})`);
    assert(third === second + 1, `three writes in one millisecond did not keep counting (${third})`);
    assert(
      (await db.writings.get(writingId))?.updatedAt === third,
      'the row does not carry the version the write reported',
    );
    assert(
      await getWritingVersion(writingId) === third,
      'getWritingVersion disagrees with the row it read',
    );

    // A clock that steps BACKWARDS — an NTP correction, a laptop waking in
    // another timezone — must not be able to hand out a token twice either.
    Date.now = () => 1_200;
    const afterStep = await updateWritingAtVersion(writingId, { content: '<p>five</p>' });
    assert(afterStep === third + 1, `a backwards clock reissued an old token (${afterStep})`);
    assert(
      (await db.writings.get(writingId))?.updatedAt === afterStep,
      "a backwards clock moved the row's updatedAt backwards",
    );
  } finally {
    Date.now = realNow;
    await db.writings.delete(writingId);
  }

  passed.push("a chapter row's version strictly increases per write, whatever the clock does");
}


// The defect, end to end: the editor holds a chapter, the copilot rewrites the
// same row, and the editor's next autosave flush arrives 1.2 seconds later
// still carrying the pre-copilot text.
//
// Before the guard that flush resolved, the indicator turned to Saved, and the
// model's work was gone with nothing on screen to say it had ever been there.
async function testGuardedWriteRefusesAMovedRow(): Promise<void> {
  const projectId = 'two-writers-project';
  const writingId = 'two-writers-chapter';
  const now = Date.now();
  const asOpened = '<p>She opened the door.</p>';
  const byTheCopilot = '<p>She opened the door, and the corridor was gone.</p>';
  const typedInTheEditor = '<p>She opened the door.</p><p>Behind it, nothing at all.</p>';

  await db.writings.add({
    id: writingId, projectId, title: 'The door', status: 'draft',
    content: asOpened, wordCount: 4, tags: [], createdAt: now, updatedAt: now,
  });

  // What the editor read when it opened the chapter.
  const heldByTheEditor = await getWritingVersion(writingId);
  assert(typeof heldByTheEditor === 'number', 'the editor could not read a version to hold');

  // The copilot, through wh_update_writing, on the same row.
  await updateWritingAtVersion(writingId, { content: byTheCopilot, wordCount: 9 });

  // …and now the editor's flush, composed against the version it opened on.
  let raised: unknown = null;
  try {
    await updateWritingAtVersion(
      writingId,
      { content: typedInTheEditor, wordCount: 8 },
      heldByTheEditor,
    );
  } catch (err) {
    raised = err;
  }

  assert(
    raised instanceof WritingConflictError,
    "a flush composed before the copilot's write was accepted as if nothing had happened",
  );
  assert(raised.writingId === writingId, 'the refusal did not name the chapter');
  assert(raised.expectedVersion === heldByTheEditor, 'the refusal lost the version the editor held');
  assert(raised.actualVersion !== heldByTheEditor, 'the refusal reported the row as unmoved');
  assert(raised.current.content === byTheCopilot, 'the refusal did not carry the text that won');
  assert(
    (await db.writings.get(writingId))?.content === byTheCopilot,
    'the stale flush reached the row anyway, which is the whole defect',
  );

  // The same write, offered against the version that is actually there, lands.
  const rebased = await updateWritingAtVersion(
    writingId,
    { content: typedInTheEditor, wordCount: 8 },
    raised.actualVersion,
  );
  assert(
    (await db.writings.get(writingId))?.content === typedInTheEditor,
    'a write against the current version was refused, which would wedge the editor',
  );
  assert(rebased > raised.actualVersion, 'the accepted write did not move the version on');

  await db.writingSnapshots.where('writingId').equals(writingId).delete();
  await db.writings.delete(writingId);
  passed.push('a chapter write composed against an older version is refused, not applied over the newer one');
}


// The case a raw timestamp cannot see.
//
// The copilot's tool call and the editor's flush run in the same renderer, on
// the same microtask queue, against a warm object store. Both can land inside
// one millisecond, and if the token is a bare `Date.now()` they carry the SAME
// number: the editor compares its stale token against the copilot's identical
// one, finds them equal, and writes straight over the model's work under a green
// tick. Freezing the clock reproduces that window exactly.
async function testSameMillisecondInterloperIsCaught(): Promise<void> {
  const projectId = 'same-ms-project';
  const writingId = 'same-ms-chapter';
  const realNow = Date.now;
  const asOpened = '<p>The tower was black.</p>';
  const byTheCopilot = '<p>The tower was white, and it was burning.</p>';
  const stale = '<p>The tower was black.</p><p>Then it fell.</p>';

  await db.writings.add({
    id: writingId, projectId, title: 'The tower', status: 'draft',
    content: asOpened, wordCount: 4, tags: [], createdAt: 7_000, updatedAt: 7_000,
  });

  try {
    // One millisecond, and everything below happens inside it.
    Date.now = () => 7_000;

    const heldByTheEditor = await getWritingVersion(writingId);
    assert(heldByTheEditor === 7_000, 'the fixture did not start on the frozen millisecond');

    const copilotVersion = await updateWritingAtVersion(writingId, { content: byTheCopilot, wordCount: 8 });
    assert(
      copilotVersion !== heldByTheEditor,
      'a write inside the same millisecond left the version unchanged, so nothing could ever detect it',
    );

    let raised: unknown = null;
    try {
      await updateWritingAtVersion(writingId, { content: stale, wordCount: 6 }, heldByTheEditor);
    } catch (err) {
      raised = err;
    }
    assert(
      raised instanceof WritingConflictError,
      'a same-millisecond overwrite slipped past the guard, which is the exact hole a timestamp leaves',
    );
    assert(
      (await db.writings.get(writingId))?.content === byTheCopilot,
      'the same-millisecond overwrite reached the row',
    );
  } finally {
    Date.now = realNow;
    await db.writingSnapshots.where('writingId').equals(writingId).delete();
    await db.writings.delete(writingId);
  }

  passed.push('two chapter writes inside one millisecond are told apart, so neither can silently overwrite the other');
}


// A refusal must never be a loss.
//
// The text a refused write was carrying exists nowhere else — it was never on
// disk — so it is filed in the chapter's version history BEFORE the error is
// raised, under the same `manual` reason a rescued crash draft gets. From there
// the loser can read both texts and restore theirs with one click, and because
// version history is never pruned that stays true for the life of the project.
async function testRefusedWriteKeepsBothTexts(): Promise<void> {
  const projectId = 'refused-write-project';
  const writingId = 'refused-write-chapter';
  const now = Date.now();
  const asOpened = '<p>A first pass.</p>';
  const winner = '<p>The version that got there first.</p>';
  const loser = '<p>The paragraph the writer was in the middle of.</p>';

  await db.writings.add({
    id: writingId, projectId, title: 'Both texts', status: 'draft',
    content: asOpened, wordCount: 3, tags: [], createdAt: now, updatedAt: now,
  });

  const held = await getWritingVersion(writingId);
  await updateWritingAtVersion(writingId, { content: winner, wordCount: 7 });

  let raised: unknown = null;
  try {
    await updateWritingAtVersion(writingId, { content: loser, title: 'Renamed too', wordCount: 9 }, held);
  } catch (err) {
    raised = err;
  }
  assert(raised instanceof WritingConflictError, 'the losing write was not refused');
  assert(
    typeof raised.rejectedSnapshotId === 'string',
    'the refused text was dropped instead of filed, which is a silent loss with extra steps',
  );
  // Read out of the error before the closure below: narrowing on a `let` does
  // not survive into a callback, and this is the file's own house style anyway.
  const rejectedId = raised.rejectedSnapshotId;

  const history = await listSnapshots(writingId);
  const filed = history.find(v => v.id === rejectedId);
  assert(filed, 'the version the refusal named is not in the history');
  assert(filed.content === loser, 'the filed version does not hold the refused text');
  assert(filed.title === 'Renamed too', 'the filed version lost the title the refused write carried');
  assert(filed.reason === 'manual', `the refused text was filed as ${filed.reason}, which the history panel cannot label`);
  assert(
    (await db.writings.get(writingId))?.content === winner,
    'filing the refused text changed the chapter, which is the overwrite this prevents',
  );

  // And it is one click back — a restore that is itself undoable, because
  // `restoreSnapshot` keeps what it replaces first.
  const restored = await restoreSnapshot(filed.id);
  assert(restored?.content === loser, 'the refused text could not be restored from history');
  assert(
    (await listSnapshots(writingId)).some(v => v.reason === 'pre-restore' && v.content === winner),
    'restoring the refused text did not first keep the text that had won',
  );

  // A refused write that carried no BODY files nothing: a status flip loses
  // nothing the caller cannot simply send again, and a version for it would
  // read as identical to the one above it in the panel.
  const beforeMeta = (await listSnapshots(writingId)).length;
  const stale = held;
  let metaRaised: unknown = null;
  try {
    await updateWritingAtVersion(writingId, { status: 'finished' }, stale);
  } catch (err) {
    metaRaised = err;
  }
  assert(metaRaised instanceof WritingConflictError, 'a stale metadata write was not refused');
  assert(metaRaised.rejectedSnapshotId === null, 'a refused metadata write filed a version of nothing');
  assert(
    (await listSnapshots(writingId)).length === beforeMeta,
    'a refused metadata write added to the version history',
  );

  await db.writingSnapshots.where('writingId').equals(writingId).delete();
  await db.writings.delete(writingId);
  passed.push('a refused chapter write files its own text as a version first, so both versions survive the race');
}


// The guard is opt-in, and every caller that predates it must be exactly as it
// was. `projectReplace`, the Google Docs sync, the reorder, `makeEntityHook`'s
// generic `editItem` — none of them pass a version, and none of them may start
// failing because one was added.
//
// What they DO inherit, without asking for it, is everything around the
// baseline: one transaction, the monotonic stamp, and a vanished row raised as
// an error rather than resolved over.
async function testUnguardedCallersAreUntouched(): Promise<void> {
  const projectId = 'unguarded-callers-project';
  const writingId = 'unguarded-callers-chapter';
  const now = Date.now() - 1;
  await db.writings.add({
    id: writingId, projectId, title: 'Untouched', status: 'draft',
    content: '<p>one</p>', wordCount: 1, tags: [], createdAt: now, updatedAt: now,
  });

  // The two-argument shape every existing call site uses.
  await updateWriting(writingId, { title: 'Renamed' });
  const renamed = await db.writings.get(writingId);
  assert(renamed?.title === 'Renamed', 'a two-argument update no longer writes');
  assert((renamed?.updatedAt ?? 0) > now, 'a two-argument update did not move updatedAt');

  // Interleaving is the point: an unguarded write over a row somebody else has
  // just moved still lands, because a caller that never read a version has not
  // claimed anything about one.
  await updateWritingAtVersion(writingId, { content: '<p>moved by somebody else</p>', wordCount: 4 });
  await updateWriting(writingId, { synopsis: 'still writes' });
  assert(
    (await db.writings.get(writingId))?.synopsis === 'still writes',
    'an unguarded write was refused, which would break every caller that predates the guard',
  );

  // `undefined` is not a version: passing it explicitly must behave as
  // "unguarded", not as "expect undefined".
  await updateWriting(writingId, { status: 'finished' }, undefined);
  assert(
    (await db.writings.get(writingId))?.status === 'finished',
    'an explicit undefined version was read as a claim about the row',
  );

  await db.writings.delete(writingId);
  passed.push('the version guard is opt-in: every caller that passes no version writes exactly as it did before');
}


// A deleted chapter outranks a moved one. Both are refusals, but they mean
// completely different things to the autosave: a conflict is answerable (both
// texts exist, the writer picks), a vanished row is not (there is nothing to
// write to, and the journal is the only copy left). The error type has to say
// which, even when the caller supplied a version.
async function testTheGuardDoesNotOutrankAVanishedRow(): Promise<void> {
  const projectId = 'guard-vs-gone-project';
  const writingId = 'guard-vs-gone-chapter';
  const now = Date.now();
  await db.writings.add({
    id: writingId, projectId, title: 'Briefly here', status: 'draft',
    content: '<p>one</p>', wordCount: 1, tags: [], createdAt: now, updatedAt: now,
  });
  const held = await getWritingVersion(writingId);
  await db.writings.delete(writingId);

  let raised: unknown = null;
  try {
    await updateWritingAtVersion(writingId, { content: '<p>an evening of work</p>', wordCount: 4 }, held);
  } catch (err) {
    raised = err;
  }
  assert(raised instanceof WritingGoneError, 'a save into a deleted chapter was reported as a version conflict');
  assert(raised.writingId === writingId, 'the failure did not name the chapter that is gone');
  assert(!(await db.writings.get(writingId)), 'the failed save resurrected the deleted chapter');
  assert(
    await getWritingVersion(writingId) === undefined,
    'a chapter that is gone still answers with a version',
  );

  passed.push('a chapter that is gone still fails as gone, not as a conflict, even under the version guard');
}


// The model's side of the same race, through the surface it actually uses.
//
// `wh_append_writing` reads the chapter, snapshots it, converts the markdown,
// and only then concatenates the addition onto the body it read. Every one of
// those steps is an await, and the editor's flush is one microtask away — so
// the window this test has to open is INSIDE the tool call, not before it. A
// writer's save that lands before the call starts is not a race at all: the
// tool re-reads the row itself and appends to what it finds, which is correct.
//
// The interleaving happens on the snapshot write, because that is a real await
// inside the window and hooking it needs no timing luck: the writer's save runs
// exactly once, between the tool's read of the row and its write back to it.
async function testAppendToAMovedChapterIsRefusedByTheBridge(): Promise<void> {
  const projectId = 'bridge-conflict-project';
  const writingId = 'bridge-conflict-chapter';
  const now = Date.now();
  const asRead = '<p>The model read this.</p>';
  const savedByTheWriter = '<p>The model read this.</p><p>And then the writer added a line.</p>';

  await db.projects.put({
    id: projectId,
    title: 'Bridge conflict',
    mode: 'novelist',
    type: 'standalone',
    color: '#7c3aed',
    description: '',
    status: 'in-progress',
    // `assertEngineEnabled` reads this list before any write reaches a row.
    enabledEngines: ['writings'],
    engineOrder: ['writings'],
    createdAt: now,
    updatedAt: now,
  });
  await db.writings.add({
    id: writingId, projectId, title: 'Contested', status: 'draft',
    content: asRead, wordCount: 4, tags: [], createdAt: now, updatedAt: now,
  });

  const { runBridgeTool } = await import('@/services/aiBridge/dispatch');

  // The model reads the chapter first, the way a real run does.
  const read = await runBridgeTool('wh_get_writing', { id: writingId });
  assert(read.ok, 'the bridge could not read the fixture chapter');

  // The writer's save, armed to fire from inside the tool call.
  const snapshotAdd = db.writingSnapshots.add.bind(db.writingSnapshots);
  let interleaved = false;
  db.writingSnapshots.add = (async (row: unknown) => {
    const key = await snapshotAdd(row as never);
    if (!interleaved) {
      interleaved = true;
      await updateWritingAtVersion(writingId, { content: savedByTheWriter, wordCount: 12 });
    }
    return key;
  }) as typeof db.writingSnapshots.add;

  let appended: Awaited<ReturnType<typeof runBridgeTool>>;
  try {
    appended = await runBridgeTool('wh_append_writing', {
      id: writingId, content: 'A closing line from the model.',
    });
  } finally {
    db.writingSnapshots.add = snapshotAdd as typeof db.writingSnapshots.add;
  }
  assert(interleaved, 'the writer never got to save inside the tool call');
  assert(!appended.ok, 'an append built on a stale body was accepted');
  assert(appended.code === 'conflict', `the bridge answered ${appended.code} rather than conflict`);
  assert(
    (appended.error ?? '').includes('version history'),
    'the model was refused without being told where its text went',
  );
  assert(
    (await db.writings.get(writingId))?.content === savedByTheWriter,
    "the stale append reached the row and took the writer's line with it",
  );
  assert(
    (await listSnapshots(writingId)).some(v => v.content.includes('A closing line from the model')),
    "the refused append was not filed, so the model's text is gone",
  );

  await db.writingSnapshots.where('writingId').equals(writingId).delete();
  await db.writings.delete(writingId);
  await db.projects.delete(projectId);
  passed.push('the AI bridge refuses an append built on a chapter that moved, and files what it refused');
}

const HISTORY_VERSIONS = 24;
/** ~100 kB of prose per version — a chapter, not a paragraph. */
const HISTORY_BODY_REPEATS = 6_666;

/** A distinct body per version, so a leak can be identified by index. */
function longChapterBody(index: number): string {
  return `<p>v${index} ${'la torre negra '.repeat(HISTORY_BODY_REPEATS)}</p>`;
}

async function seedLongHistory(projectId: string, writingId: string, now: number): Promise<void> {
  await db.writings.add({
    id: writingId, projectId, title: 'The long chapter', status: 'draft',
    content: longChapterBody(HISTORY_VERSIONS - 1), wordCount: 1, tags: [],
    createdAt: now, updatedAt: now,
  });
  // bulkAdd rather than `takeSnapshot` in a loop: the fixture is about what is
  // ON DISK, and going through the writer would deduplicate half of it away.
  //
  // The ids run OPPOSITE to `createdAt` on purpose. Insertion order is oldest
  // first and primary-key order is newest first, so a list that quietly handed
  // back either one instead of sorting would fail the ordering assertion below
  // rather than pass it by luck.
  await db.writingSnapshots.bulkAdd(
    Array.from({ length: HISTORY_VERSIONS }, (_, index) => ({
      id: `long-history-${String(HISTORY_VERSIONS - 1 - index).padStart(3, '0')}`,
      writingId,
      projectId,
      title: 'The long chapter',
      content: longChapterBody(index),
      wordCount: index + 1,
      reason: (index === 0 ? 'manual' : 'auto') as 'manual' | 'auto',
      createdAt: now - (HISTORY_VERSIONS - index) * 1_000,
    })),
  );
}

interface SnapshotReadProbe {
  /** Whole rows pulled out by primary key — one body each. */
  rowsFetchedById: number;
  /** Whether the table was ever asked for an ARRAY of rows rather than a cursor. */
  askedForAnArray: boolean;
}

/**
 * Counts what a piece of code actually pulls out of `writingSnapshots`: how
 * many whole rows it fetches by id, and whether it ever asked the table for an
 * array of rows at all. `.each` — the cursor the metadata path uses — goes
 * through neither, which is exactly what makes the two counters meaningful.
 *
 * `toArray` lives on Dexie's shared Collection prototype, so the probe records
 * a flag rather than throwing: a stray internal call somewhere else in the
 * library must show up in an assertion message, not detonate mid-transaction.
 */
async function probeSnapshotReads<T>(
  body: () => Promise<T>,
): Promise<SnapshotReadProbe & { result: T }> {
  type AnyFn = (...args: unknown[]) => unknown;
  const table = db.writingSnapshots as unknown as Record<string, unknown>;
  const hadOwnGet = Object.prototype.hasOwnProperty.call(table, 'get');
  const ownGet = table.get;
  const realGet = (table.get as AnyFn).bind(db.writingSnapshots);
  const collectionProto = Object.getPrototypeOf(
    db.writingSnapshots.where('writingId').equals('probe'),
  ) as Record<string, unknown>;
  const realToArray = collectionProto.toArray as AnyFn;

  const probe: SnapshotReadProbe = { rowsFetchedById: 0, askedForAnArray: false };
  table.get = (...args: unknown[]) => {
    probe.rowsFetchedById += 1;
    return realGet(...args);
  };
  collectionProto.toArray = function patched(this: unknown, ...args: unknown[]) {
    probe.askedForAnArray = true;
    return realToArray.apply(this, args);
  };

  try {
    return { result: await body(), ...probe };
  } finally {
    if (hadOwnGet) table.get = ownGet;
    else delete table.get; // the real one is back on the Table prototype
    collectionProto.toArray = realToArray;
  }
}


// THE ONE THAT MATTERS. `listSnapshots` answered "what versions are there?" by
// reading every version — bodies included — with `toArray()`, and the history
// panel called it on every open. On a chapter with three hundred saved versions
// that is tens of megabytes of HTML deserialised out of IndexedDB and then
// pinned in a React state array, to draw a column of dates.
//
// So the assertion is not "the list is shorter". It is that the prose is not
// there: no `content` key on any row, a serialised result three orders of
// magnitude below the bodies it describes, and no request to the table for an
// array of rows at all — only the cursor, which lets each body go before the
// next one arrives.
async function testVersionListNeverMaterialisesBodies(): Promise<void> {
  const projectId = 'history-cost-project';
  const writingId = 'history-cost-chapter';
  const now = Date.now();
  await seedLongHistory(projectId, writingId, now);

  const bodyBytes = HISTORY_VERSIONS * longChapterBody(0).length;
  const probe = await probeSnapshotReads(() => listSnapshotMeta(writingId));
  const list = probe.result;

  assert(list.length === HISTORY_VERSIONS, `the metadata list lost versions: ${list.length}`);
  assert(
    list.every(row => !('content' in row)),
    'a version body came back on the metadata list, which is the whole defect',
  );
  assert(
    !probe.askedForAnArray,
    'the metadata list asked the table for an array of rows instead of streaming a cursor',
  );
  assert(
    probe.rowsFetchedById === 0,
    `the metadata list fetched ${probe.rowsFetchedById} whole rows by id; it needs none`,
  );

  // The size bound is what makes this a test of COST rather than of shape: any
  // body that survived the projection — one, or all twenty-four — puts the
  // serialised list past this by a factor of at least a hundred.
  const listBytes = JSON.stringify(list).length;
  assert(
    listBytes < bodyBytes / 100,
    `the version list weighs ${listBytes} chars against ${bodyBytes} of prose — a body leaked into it`,
  );

  // And the body is still one call away, for the one version the writer picks.
  const bodyProbe = await probeSnapshotReads(() => readSnapshot(list[0].id));
  assert(
    bodyProbe.result?.content === longChapterBody(HISTORY_VERSIONS - 1),
    'reading one version by id did not return its prose',
  );
  assert(
    bodyProbe.rowsFetchedById === 1,
    `reading one version fetched ${bodyProbe.rowsFetchedById} rows, not one`,
  );

  await deleteSnapshotsForWriting(writingId);
  await db.writings.delete(writingId);
  passed.push('listing a chapter’s versions carries no manuscript bodies, and one version’s prose costs one keyed read');
}


// The deduplication check compares one string on one row — the newest version's
// text — and used to reach it through `listSnapshots(id)[0]`, which loaded the
// entire history to look at the first element of it. That ran on EVERY editor
// open, because taking the per-session automatic snapshot is the first thing
// `handleOpenWriting` does.
//
// One row read is the correct cost, and it has to stay one however long the
// history gets: this is the path whose cost used to grow with the number of
// times the chapter had been opened before.
async function testDedupeReadsOneVersionNotTheWholeHistory(): Promise<void> {
  const projectId = 'dedupe-cost-project';
  const writingId = 'dedupe-cost-chapter';
  const now = Date.now();
  await seedLongHistory(projectId, writingId, now);

  // Identical to the newest version on file, so the dedupe fires and the whole
  // call is the comparison this test is measuring.
  const unchanged = {
    id: writingId, projectId, title: 'The long chapter',
    content: longChapterBody(HISTORY_VERSIONS - 1),
  };
  const probe = await probeSnapshotReads(() => takeSnapshot(unchanged, 'auto'));
  assert(probe.result === null, 'an unchanged document took a second automatic snapshot');
  assert(
    probe.rowsFetchedById === 1,
    `the dedupe check read ${probe.rowsFetchedById} whole versions to compare against one`,
  );
  assert(
    !probe.askedForAnArray,
    'the dedupe check pulled the history into an array to find the newest version',
  );
  assert(
    (await db.writingSnapshots.where('writingId').equals(writingId).count()) === HISTORY_VERSIONS,
    'the deduplicated snapshot was written anyway',
  );

  // The comparison is against the NEWEST, not against whichever row the index
  // happens to hand back first: text matching an older version is still new.
  const older = { ...unchanged, content: longChapterBody(2) };
  assert(typeof (await takeSnapshot(older, 'auto')) === 'string', 'text matching an OLD version was deduplicated away');

  await deleteSnapshotsForWriting(writingId);
  await db.writings.delete(writingId);
  passed.push('the automatic-snapshot dedupe reads one version, not the chapter’s whole past, however long that past is');
}


// A projection is only a saving if it still answers the question. Everything
// the history panel draws and everything the AI bridge reports back — when,
// why, how long, under what title — has to survive the cursor, in the order the
// panel expects: newest first, by `createdAt`, not by insertion or by id.
async function testVersionListStillDescribesEveryVersion(): Promise<void> {
  const projectId = 'history-shape-project';
  const writingId = 'history-shape-chapter';
  const now = Date.now();
  await seedLongHistory(projectId, writingId, now);

  const meta = await listSnapshotMeta(writingId);
  const full = await listSnapshots(writingId);

  assert(
    meta.map(row => row.id).join(',') === full.map(row => row.id).join(','),
    'the metadata list and the full read disagree about which versions exist, or about their order',
  );
  assert(
    meta.every((row, index) => index === 0 || meta[index - 1].createdAt >= row.createdAt),
    'the version list is not newest-first',
  );
  assert(
    meta.every((row, index) => {
      const source = full[index];
      return row.writingId === source.writingId
        && row.projectId === source.projectId
        && row.title === source.title
        && row.wordCount === source.wordCount
        && row.reason === source.reason
        && row.createdAt === source.createdAt;
    }),
    'a field the history panel renders was dropped by the projection',
  );
  // The reason labels are what the panel prints, so the projection has to carry
  // the ones the fixture actually filed rather than a default.
  assert(
    meta.some(row => row.reason === 'manual') && meta.some(row => row.reason === 'auto'),
    'the projection flattened the reason every version was taken for',
  );

  await deleteSnapshotsForWriting(writingId);
  await db.writings.delete(writingId);
  passed.push('the metadata list names the same versions in the same order as the full read, minus only the prose');
}


// `pre-restore` is a machine-taken safety copy: its only job is "the text this
// replaced is still somewhere in the history". Restoring the same version over
// and over — a writer confirming again, an agent retrying
// `wh_restore_writing_version` after a timeout — replaces text with the text it
// already holds from the second attempt onwards, and used to file one
// byte-identical copy of the whole chapter per attempt, with nothing bounding
// the attempts. A copy identical to the version above it protects nothing that
// version does not.
//
// What must NOT change: the first restore still keeps the text it replaces, and
// `manual` is still never deduplicated — `projectReplace` proves its restore
// point landed by diffing this table's primary keys before and after the call,
// and aborts the whole rewrite when no new key appeared.
async function testRepeatedRestoreDoesNotRefileTheSameChapter(): Promise<void> {
  const projectId = 'restore-dup-project';
  const writingId = 'restore-dup-chapter';
  const now = Date.now();
  const old = '<p>She opened the door.</p>';
  const rewritten = '<p>She opened the door, and the corridor was gone.</p>';

  await db.writings.add({
    id: writingId, projectId, title: 'The door', status: 'draft',
    content: rewritten, wordCount: 9, tags: [], createdAt: now, updatedAt: now,
  });
  const kept = await takeSnapshot({ id: writingId, projectId, title: 'The door', content: old }, 'manual');
  assert(typeof kept === 'string', 'the fixture version was not filed');
  // Establish chronology explicitly: rapid fixture writes can share one
  // millisecond, whose random primary-key order is not a creation order.
  // This test checks deduplication against the newest version, not tied dates.
  await db.writingSnapshots.update(kept, { createdAt: now - 2000 });

  const countVersions = () => db.writingSnapshots.where('writingId').equals(writingId).count();

  // The first restore replaces genuinely different text, so that text is kept —
  // this is the guarantee, and it is untouched.
  assert((await restoreSnapshot(kept))?.content === old, 'the version could not be restored');
  const afterFirst = await countVersions();
  assert(afterFirst === 2, `the first restore filed ${afterFirst - 1} versions, not one`);
  const preRestore = (await listSnapshotMeta(writingId)).find(row => row.reason === 'pre-restore');
  assert(preRestore, 'restoring did not first keep the text it replaced');
  assert(
    (await readSnapshot(preRestore.id))?.content === rewritten,
    'the pre-restore version does not hold the text that was replaced',
  );
  await db.writingSnapshots.update(preRestore.id, { createdAt: now - 1000 });

  // From here the chapter never changes again: every further restore of this
  // version replaces `old` with `old`. The history records that once — the next
  // restore's safety copy is the first whose text matches the version above it
  // — and then it has to stop. Unbounded before; two rows now, whatever the
  // writer or the bridge does with the button.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert((await restoreSnapshot(kept))?.content === old, `restore attempt ${attempt} did not land`);
  }
  const afterFive = await countVersions();
  assert(
    afterFive === 3,
    `five restores of a version the chapter already holds filed ${afterFive - 2} copies of it, not one`,
  );
  assert((await db.writings.get(writingId))?.content === old, 'the repeated restores did not reach the row');

  // And a MANUAL version of that same unchanged text is still written, every
  // single time it is asked for. Deduplicating this one returns null, leaves no
  // new primary key, and aborts a project-wide find and replace.
  const first = await takeSnapshot({ id: writingId, projectId, title: 'The door', content: old }, 'manual');
  const second = await takeSnapshot({ id: writingId, projectId, title: 'The door', content: old }, 'manual');
  assert(
    typeof first === 'string' && typeof second === 'string' && first !== second,
    'a manual version of unchanged text was deduplicated away, which aborts a project-wide replace',
  );

  await deleteSnapshotsForWriting(writingId);
  await db.writings.delete(writingId);
  passed.push('a repeated restore stops refiling a byte-identical chapter, and a manual version still always writes');
}

async function testCloseGuardsNeverHoldTheWindowByAccident(): Promise<void> {
  // Nothing registered is the overwhelmingly common case — the writer is on
  // the dashboard, or in an engine that owns no unsaved text. The X must be
  // instant, and "no opinion" must read as yes.
  assert(
    await runCloseGuards([]) === true,
    'a close with no guards registered was held back',
  );

  // The ordinary unsaved close: the flush landed, so the window goes and the
  // writer never learns a question was asked at all.
  assert(
    await runCloseGuards([() => true, () => true]) === true,
    'guards that all flushed cleanly still held the window',
  );

  // The failing save. One refusal is enough, because that guard has just put a
  // dialog in front of the writer and owns the question from there.
  assert(
    await runCloseGuards([() => true, () => false]) === false,
    'a guard that took the question to the writer did not hold the close',
  );

  // A guard that is still awaiting its Dexie flush must be WAITED for, not
  // read while it is a pending promise — a pending promise is truthy, and
  // "truthy" here means closing the window out from under a live write.
  assert(
    await runCloseGuards([
      () => new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5)),
    ]) === false,
    'a slow guard was treated as agreement instead of being awaited',
  );

  // The one that matters most. A refusal must not short-circuit the guards
  // behind it: their job is to FLUSH, and skipping chapter two's write because
  // chapter one raised a dialog would lose exactly the words this whole
  // protocol exists to keep.
  const ran: string[] = [];
  const verdict = await runCloseGuards([
    () => { ran.push('first'); return false; },
    () => { ran.push('second'); return true; },
    async () => { await Promise.resolve(); ran.push('third'); return true; },
  ]);
  assert(verdict === false, 'a refusal was lost among the guards that agreed');
  assert(
    ran.length === 3 && ran.includes('second') && ran.includes('third'),
    `a refusing guard skipped the flushes behind it: ran ${ran.join(', ') || 'nothing'}`,
  );

  // A guard that throws has decided nothing. Refusing on its behalf would hold
  // the window on the strength of a bug — which is the original defect walking
  // back in through a different door.
  assert(
    await runCloseGuards([() => { throw new Error('guard exploded'); }]) === true,
    'a guard that threw was allowed to hold the window shut',
  );
  assert(
    await runCloseGuards([() => { throw new Error('guard exploded'); }, () => false]) === false,
    'a thrown guard swallowed a real refusal beside it',
  );

  passed.push('close guards: a refusal never skips a flush, and a broken guard never holds the window');
}

// A sprint stores its SCHEDULED end, never a countdown, so the app being shut
// across the finish line cannot turn a 25-minute sprint into a three-day one.
//
// Old bug: `endedAt` was already clamped, but the WORDS were `now - baseline`
// with nothing bounding `now`. A sprint that ended at 10:25 unwatched and was
// reconciled at 11:00 — after the copilot added a chapter at 10:40 — was logged
// with nine hundred words nobody typed inside it, and that number went on to be
// the "best sprint". A measurement taken long after the window is now ignored:
// the sprint is filed with the last total that was SEEN while it ran.
async function testExpiredSprintIsFiledAtItsScheduledEnd(): Promise<void> {
  const { beginSprint, listSprints, readActiveSprint, reconcileSprint } =
    await import('@/engines/writing-stats/sprints');
  const { PROJECT_SETTING_PREFIXES, getSetting, setSetting } = await import('@/db/operations');

  const projectId = 'sprint-window-project';
  const activeKey = `${PROJECT_SETTING_PREFIXES.activeSprint}${projectId}`;
  const settingsBefore = new Set((await db.settings.toArray()).map(row => row.key));

  // The chapter that arrived AFTER the sprint was over.
  await db.writings.add({
    id: 'sprint-late-chapter', projectId, title: 'Late arrival', status: 'draft',
    content: '<p>x</p>', wordCount: 900, tags: [], createdAt: 1, updatedAt: 1,
  });

  // Backdating a real sprint rather than hand-writing the payload keeps the
  // stored shape whatever this module currently writes.
  const backdate = async (endsAt: number, startedAt: number, observedWords: number, observedAt: number) => {
    const raw = await getSetting(activeKey);
    assert(raw, 'beginSprint did not persist an active sprint');
    const payload = JSON.parse(raw) as { sprint: Record<string, unknown> };
    assert(payload.sprint, 'the stored active-sprint payload changed shape');
    payload.sprint.startedAt = startedAt;
    payload.sprint.endsAt = endsAt;
    payload.sprint.baselineWords = 100;
    payload.sprint.observedWords = observedWords;
    payload.sprint.observedAt = observedAt;
    await setSetting(activeKey, JSON.stringify(payload));
  };

  // ── Reconciled long after the window: the late words are not credited ──
  await beginSprint({ projectId, durationMinutes: 25, targetWords: 0, baselineWords: 100 });
  const lateNow = Date.now();
  const scheduledEnd = lateNow - 10 * 60_000;
  const scheduledStart = scheduledEnd - 25 * 60_000;
  // 140 words were on the page the last time anyone looked, inside the window.
  await backdate(scheduledEnd, scheduledStart, 140, scheduledEnd - 1_000);

  const late = await reconcileSprint(projectId);
  const lateRecord = late.finished;
  assert(late.active === null, 'an expired sprint was left running');
  assert(lateRecord, 'an expired sprint was not filed');
  assert(
    lateRecord.endedAt === scheduledEnd,
    `the sprint was filed at ${lateRecord.endedAt}, not at its scheduled end ${scheduledEnd}`,
  );
  assert(
    lateRecord.actualWords === 40,
    `a reconcile long after the window credited ${lateRecord.actualWords} words instead of the 40 that were seen inside it`,
  );
  assert(lateRecord.startedAt === scheduledStart, 'the filed sprint lost its start');
  assert(await readActiveSprint(projectId) === null, 'the filed sprint is still the active one');

  // ── Reconciled inside the grace window: the measurement IS used ──
  await beginSprint({ projectId, durationMinutes: 25, targetWords: 0, baselineWords: 100 });
  const freshNow = Date.now();
  const justEnded = freshNow - 1_000;
  await backdate(justEnded, justEnded - 60_000, 100, justEnded - 60_000);

  const fresh = await reconcileSprint(projectId, 175);
  const freshRecord = fresh.finished;
  assert(freshRecord, 'a sprint that expired a second ago was not filed');
  assert(
    freshRecord.actualWords === 75,
    `a measurement taken inside the grace window must still count, got ${freshRecord.actualWords}`,
  );
  assert(
    freshRecord.endedAt === justEnded,
    'even a promptly reconciled sprint is stamped with its scheduled end, not with the reconcile',
  );

  const log = await listSprints(projectId);
  assert(log.length === 2, `both sprints must be in the log, found ${log.length}`);
  assert(
    log.some(row => row.id === lateRecord.id) && log.some(row => row.id === freshRecord.id),
    'filing the second sprint dropped the first from the log',
  );

  await db.writings.delete('sprint-late-chapter');
  const settingsAfter = await db.settings.toArray();
  await db.settings.bulkDelete(
    settingsAfter.filter(row => !settingsBefore.has(row.key)).map(row => row.id),
  );
  passed.push('an expired sprint is filed at its scheduled end and credited only with the words seen inside it');
}

// Stored prose is HTML, and a string replace over it corrupts tags and matches
// inside attributes. The HTML is parsed and only TEXT NODES are rewritten, so
// `<strong>` boundaries and `<a href>` values are untouched by construction —
// and a match that formatting cuts in two is deliberately NOT rewritten,
// because neither half can be given the mark without moving a boundary the
// writer chose. Nothing is rewritten until a version has been saved.
async function testProjectReplaceRewritesTextNodesOnly(): Promise<void> {
  const { applyProjectReplace, forgetReplaceUndo, scanProjectReplace } =
    await import('@/services/projectReplace');

  const projectId = 'replace-html-project';
  const now = Date.now();
  const marks = '<p>Marta y <strong>Marta</strong></p>';
  const attribute = '<p><a href="/x/Marta">Marta</a></p>';
  // One plain occurrence and one the bold cuts in half, in the same field.
  const split = '<p>Marta llega. Mar<strong>ta</strong> se va.</p>';
  const ids = ['replace-marks', 'replace-attribute', 'replace-split'];
  await db.writings.bulkAdd([
    { id: ids[0], projectId, title: 'Capítulo uno', status: 'draft', content: marks, wordCount: 3, chapter: 1, tags: [], createdAt: now, updatedAt: now },
    { id: ids[1], projectId, title: 'Capítulo dos', status: 'draft', content: attribute, wordCount: 1, chapter: 2, tags: [], createdAt: now, updatedAt: now },
    { id: ids[2], projectId, title: 'Capítulo tres', status: 'draft', content: split, wordCount: 6, chapter: 3, tags: [], createdAt: now, updatedAt: now },
  ]);

  const plan = await scanProjectReplace({
    projectId,
    term: 'Marta',
    options: { caseSensitive: false, wholeWord: false, matchDiacritics: false },
    scopes: ['writings'],
  });
  assert(plan.total === 4, `expected four rewritable occurrences, got ${plan.total}`);
  assert(plan.splitTotal === 1, `expected one occurrence cut by formatting, got ${plan.splitTotal}`);
  assert(plan.documents.length === 3, `expected three chapters in the preview, got ${plan.documents.length}`);

  const attributeDocument = plan.documents.find(entry => entry.key === `writings:${ids[1]}`);
  assert(attributeDocument?.total === 1, 'the term inside the href was counted as an occurrence');
  const splitDocument = plan.documents.find(entry => entry.key === `writings:${ids[2]}`);
  assert(splitDocument?.total === 1, 'the plain occurrence beside a split one was not offered');
  assert(splitDocument.splitTotal === 1, 'a match cut by a mark was counted as rewritable');
  assert(
    splitDocument.occurrences.filter(occurrence => occurrence.split).length === 1,
    'the split occurrence was not reported to the writer as split',
  );

  const outcome = await applyProjectReplace(plan, 'Clara', {
    excludedDocuments: new Set<string>(),
    excludedOccurrences: new Set<string>(),
  });
  assert(outcome.replaced === 4, `expected four rewrites, got ${outcome.replaced}`);
  assert(outcome.rows === 3 && outcome.documents === 3, 'the rewritten row or document count changed');
  assert(outcome.snapshots === 3, 'a chapter was rewritten without a version being saved first');
  assert(outcome.skippedChanged === 0, 'a chapter nothing touched was reported as changed under the review');

  assert(
    (await db.writings.get(ids[0]))?.content === '<p>Clara y <strong>Clara</strong></p>',
    'rewriting either side of a mark boundary corrupted the markup',
  );
  const attributeAfter = (await db.writings.get(ids[1]))?.content ?? '';
  assert(attributeAfter.includes('href="/x/Marta"'), 'the replacement reached inside an attribute');
  assert(attributeAfter.includes('>Clara<'), 'the visible link text was not rewritten');
  assert(
    (await db.writings.get(ids[2]))?.content === '<p>Clara llega. Mar<strong>ta</strong> se va.</p>',
    'the occurrence a mark cuts in two was rewritten, or its neighbour was not',
  );

  const versions = await db.writingSnapshots.where('writingId').equals(ids[0]).toArray();
  assert(versions.length === 1 && versions[0].content === marks, 'the saved version does not hold the text as it was before the replace');
  assert(versions[0].reason === 'manual', 'the restore point was filed under a reason the history panel does not offer');

  forgetReplaceUndo(outcome.batchId);
  await db.writingSnapshots.where('writingId').anyOf(ids).delete();
  await db.writings.bulkDelete(ids);
  passed.push('project replace rewrites text nodes only: marks survive, attributes are untouched, split matches are left alone');
}

// Retry is decided from the STORED rows alone, so it works on a thread reopened
// days later as well as on one that failed a second ago. A turn is the last
// user row plus everything after it, and a retry replays that user row — it
// never sends the question twice — after deleting exactly the rows that turn
// left behind. A turn that produced a real answer offers no Retry at all:
// pressing it there would delete something the writer wants to keep.
async function testCopilotRetryPlan(): Promise<void> {
  const { planCopilotRetry } = await import('@/services/copilot/runner');
  const row = (
    id: string,
    role: AiMessage['role'],
    status: AiMessage['status'],
    content: string,
    toolCall?: AiMessage['toolCall'],
  ): AiMessage => ({
    id,
    threadId: 'retry-thread',
    projectId: 'retry-project',
    role,
    status,
    content,
    createdAt: 1,
    toolCall,
  });
  const card = (state: 'done' | 'failed' | 'rejected'): NonNullable<AiMessage['toolCall']> => ({
    callId: 'call-1', tool: 'writings.update', args: {}, risk: 'write', state,
  });
  const question = row('u1', 'user', 'complete', '¿Puedes revisar el capítulo?');

  // The model errored: replayable, and the failed row carries the control.
  const errored = planCopilotRetry([question, row('a1', 'assistant', 'error', '')]);
  assert(errored, 'a turn whose answer errored must be replayable');
  assert(errored.userMessageId === 'u1' && errored.text === question.content, 'the retry must replay the stored user row');
  assert(errored.dropIds.join(',') === 'a1', 'the retry must drop the failed answer and nothing else');
  assert(errored.anchorMessageId === 'a1', 'the Retry control lost the row that shows the failure');

  // Cancelled mid-turn: the whole turn goes, the question stays.
  const cancelled = planCopilotRetry([
    question,
    row('a1', 'assistant', 'complete', ''),
    row('t1', 'tool', 'complete', 'ok', card('done')),
    row('a2', 'assistant', 'cancelled', ''),
  ]);
  assert(cancelled?.dropIds.join(',') === 'a1,t1,a2', 'a cancelled turn must drop every row it left behind');
  assert(!cancelled.dropIds.includes('u1'), 'the retry must never drop the question it replays');
  assert(cancelled.anchorMessageId === 'a2', 'the Retry control lost the cancelled row');

  // Cut between a tool call and the answer: replayable, but nothing visible
  // failed, so the control hangs off no row rather than above the failure.
  const rejected = planCopilotRetry([
    question,
    row('a1', 'assistant', 'complete', 'Voy a reescribir el final.'),
    row('t1', 'tool', 'complete', 'rechazado', card('rejected')),
  ]);
  assert(rejected?.dropIds.join(',') === 'a1,t1', 'a turn ending on a rejected tool card must be replayable');
  assert(rejected.anchorMessageId === null, 'a turn with no visibly failed row must not anchor the control');

  // A real answer is never offered a Retry — it would delete the answer.
  assert(
    planCopilotRetry([question, row('a1', 'assistant', 'complete', 'Aquí tienes la revisión.')]) === null,
    'a turn that answered was offered a retry that would delete the answer',
  );
  assert(
    planCopilotRetry([
      question,
      row('a1', 'assistant', 'complete', 'Hecho.'),
      row('t1', 'tool', 'complete', 'ok', card('done')),
    ]) === null,
    'a turn that answered and then ran a tool successfully was offered a retry',
  );

  // A live run settles itself; a turn with no answer at all is replayable.
  assert(
    planCopilotRetry([question, row('a1', 'assistant', 'streaming', 'escribi')]) === null,
    'a streaming row belongs to a live run and must not be retried under it',
  );
  const unanswered = planCopilotRetry([question]);
  assert(unanswered, 'a turn stopped before the model answered must be replayable');
  assert(unanswered.dropIds.length === 0, 'a turn that never got an answer has nothing to drop');
  assert(unanswered.userMessageId === 'u1', 'the retry must replay the question that got no answer');
  assert(planCopilotRetry([]) === null, 'an empty thread cannot be retried');

  passed.push('copilot retry plan: failed turns replay the stored question and name exactly the rows to drop');
}

function testSearchQueryGrammar(): void {
  // Accent folding runs on BOTH sides: this app's writers work in Spanish, and
  // "cancion" has to find "canción" without the writer reaching for the accent.
  assert(foldSearchText('Canción') === 'cancion', 'folding did not strip the accent');
  assert(foldSearchText('ÁÉÍÓÚñ') === 'aeiouñ' || foldSearchText('ÁÉÍÓÚñ') === 'aeioun',
    'folding mangled accented capitals');

  const plain = parseSearchQuery('canción  MARTA');
  assert(plain.terms.length === 2 && plain.terms.includes('cancion') && plain.terms.includes('marta'),
    'bare words were not folded into terms');
  assert(findRequiredMatch(plain, 'la cancion de marta') !== null, 'AND over folded words failed');
  assert(findRequiredMatch(plain, 'la cancion') === null, 'a missing word still matched');

  // The longest needle is looked up first — that ordering is what makes a
  // non-matching document cheap, so it is a contract, not an accident.
  assert(plain.needles.length > 0 && plain.needles[0].length >= plain.needles[plain.needles.length - 1].length,
    'needles are no longer ordered longest-first');

  const phrase = parseSearchQuery('"la torre negra"');
  assert(phrase.phrases.length === 1 && phrase.terms.length === 0, 'a quoted phrase was split into words');
  assert(findRequiredMatch(phrase, 'subio a la torre negra al alba') !== null, 'phrase did not match');
  assert(findRequiredMatch(phrase, 'la torre era negra') === null, 'phrase matched non-contiguously');

  const excluded = parseSearchQuery('torre -negra');
  assert(excluded.exclusions.includes('negra'), 'exclusion was not parsed');
  assert(hasExcludedText(excluded, 'la torre negra'), 'exclusion did not disqualify');
  assert(!hasExcludedText(excluded, 'la torre blanca'), 'exclusion disqualified the wrong document');

  const filtered = parseSearchQuery('engine:codex tag:magia is:untagged');
  assert(filtered.hasEngineFilters && filtered.hasTagFilters, 'field filters were not recognised');
  assert(filtered.untagged === true, 'is:untagged was not parsed');

  // An unknown prefix is literal text, not a silently dropped filter: someone
  // searching for a URL or for "nota:" must still find it.
  const literal = parseSearchQuery('nota:algo');
  assert(!literal.hasFilters && literal.hasText, 'an unknown field: prefix was swallowed');
  assert(findRequiredMatch(literal, 'una nota:algo suelta') !== null, 'literal prefix did not match');

  // Malformed input must never throw — an unterminated quote just runs on.
  const unterminated = parseSearchQuery('"sin cerrar');
  assert(unterminated.phrases.length === 1, 'an unterminated quote was not treated as a phrase');
  assert(parseSearchQuery('').isEmpty, 'an empty query is not empty');

  passed.push('search grammar: folding, phrases, exclusions, filters, literal fallback');
}

async function run(): Promise<void> {
  await testMigration();
  passed.push(...await runMigrationV24Tests());
  passed.push(...await testInquiry());
  await testBackupRoundTrip();
  await testProjectImportCollisionGuard();
  passed.push(...await testZipBackupScopeGuards());
  passed.push(...await testConversionUndoSafety());
  passed.push(...await testGoogleDocWriteSafety());
  passed.push(...await runPendingWriteTests());
  passed.push(...await testProjectHealthRecovery());
  passed.push(...await testJudgeContracts());
  passed.push(await testCreativeBranchKernel());
  passed.push(await testStoryStateKernel());
  passed.push(await testCreativePromotion());
  passed.push(testStoryLenses());
  passed.push(await testSharedUniverse());
  passed.push(...runSceneLabCoreTests());
  passed.push(...runNarrativeXrayTests());
  passed.push(...await testAccessibleModalContract());
  await testCascades();
  await testCopilotRunGuards();
  await testImageHandoffStore();
  await testScriptImportRoundTrip();
  await testAiTextParsing();
  testProjectIntelligenceSemantics();
  testNarrativeContinuitySemantics();
  testLightweightWorldgenRenameReader();
  await testOutlineBeatDeepLink();
  testEditorialNavigationContracts();
  testPersistedHtmlSanitizer();
  testSearchQueryGrammar();
  await testPublishingStudioSemantics();
  testRecoveryAndNavigation();
  testRecentEntityNavigation();
  await testReorderKeepsUnlistedRows();
  await testEntityAnnotationCascades();
  await testOutlineCoverageIgnoresDeletedWritings();
  await testCitationAccessedDayIsLocal();
  await testCopilotSettingsPartialSaves();
  await testLegacyFullImportKeepsTablesItDoesNotCarry();
  await testWritingDeleteIsRestorable();
  await testConcurrentSettingUpdatesBothSurvive();
  await testProjectSweepsItsSettingsKeys();
  await testDisappearingCharactersReadsProseOnly();
  await testOutlineChecksCollapseWhenNothingIsLinkedYet();
  await testReadingProgressCountsWhatIsOnScreen();
  await testOrphanSeedClosesInOneStep();
  await testChapterOrderPlans();
  await testWritingABeatCreatesOneLinkedChapter();
  await testPublishingOrderMatchesTheList();
  await testPublishingMarkupAndEncoding();
  await testPublishingEdgeManuscripts();
  await testProjectRestoreCarriesEngineRows();
  await testSearchRelevanceRanking();
  await testSearchResultPaging();
  await testReadingResumePoint();
  await testChapterExportNaming();
  await testChapterExportIsTheSameCompiler();
  await testProjectDeleteLeavesACopy();
  await testRecoveryJournalRefusesADivergedRow();
  testRecoveryJournalIsScopedToItsChapter();
  await testWritingUpdateOnAVanishedRowIsNotASuccess();
  await testSnapshotReportsWhetherItWrote();
  await testRescuedDraftSurvivesInVersionHistory();
  testShortcutTableInvariants();
  testShortcutMatching();
  await testWritingVersionNeverRepeats();
  await testGuardedWriteRefusesAMovedRow();
  await testSameMillisecondInterloperIsCaught();
  await testRefusedWriteKeepsBothTexts();
  await testUnguardedCallersAreUntouched();
  await testTheGuardDoesNotOutrankAVanishedRow();
  await testAppendToAMovedChapterIsRefusedByTheBridge();
  await testVersionListNeverMaterialisesBodies();
  await testDedupeReadsOneVersionNotTheWholeHistory();
  await testVersionListStillDescribesEveryVersion();
  await testRepeatedRestoreDoesNotRefileTheSameChapter();
  await testCloseGuardsNeverHoldTheWindowByAccident();
  await testExpiredSprintIsFiledAtItsScheduledEnd();
  await testProjectReplaceRewritesTextNodesOnly();
  await testCopilotRetryPlan();
  // Ronda 3 (2026-09-02): footnotes, page mode, whole-book editor, atlas map.
  passed.push(...(await runFootnoteTests()));
  passed.push(...(await runFootnoteBridgeTests()));
  testPageSizes();
  testPaginationPureFitsExactly();
  testPaginationPureCutsBetweenLines();
  testPaginationPureOversizedBlockOverflows();
  testPaginationPureNotesPushALine();
  testPaginationPureAtomicBlockMovesWhole();
  testPaginationPureMargins();
  testPaginationPureForcedBreak();
  passed.push('Page mode: pure pagination');
  await testPageModeInEditor();
  passed.push('Page mode: a real editor on A4 sheets');
  testBookRoundTrip();
  passed.push('Book: compose/split round trip');
  testBookSplitEdges();
  passed.push('Book: split keeps a prelude, and a bare h1 stays inside its chapter');
  testBookDiff();
  passed.push('Book: diff names updates, creates, missing and order');
  testBookHeadingNode();
  passed.push('Book: chapter heading node guards, splits and moves');
  await testBookHeadingView();
  passed.push('Book: chapter heading React view renders and drives the host');
  await testBookSaveAgainstDexie();
  passed.push('Book: save writes what moved and never deletes unconfirmed');
  await testBookEditorAutosave();
  passed.push('Book: the editor loads, autosaves, creates and merges chapters');
  await testBookFootnotesPanel();
  await testBookFootnotesRestartPerChapter();
  passed.push('Book: the footnotes panel lists the notes of the whole book, jumps to them and restarts per chapter');
  for (const fn of Object.values(atlasMapTests)) await fn();
  passed.push('Real atlas map: geometry, view state, basemap, prefs, mount');
  passed.push(await testAiBridgeContracts());
  passed.push(await testBridgeSelfTest());
  passed.push(...await testInquiryBridge());
  passed.push(...await testFamilyExchange());
  passed.push(...await testFamilyUi());
  passed.push(await testAiRuntimeContracts());
  passed.push(await testComfyBackend());
  await testBridgeLinksStayInProject();
  passed.push('AI bridge: every linked row id stays inside the project');
  passed.push(testWorldgenSpatialEntities());
  passed.push(testWorldgenSemanticZoom());
  await runRegionInfraTests();
  passed.push('Worldgen regional identity, coordinates, cache, and cancellation');
  passed.push(testWorldgenDetailShader());
  passed.push(await testWorldgenBridgeAccess());
  testWorldgenRuler();
  testWorldgenLegend();
  testWorldgenKeyboardCamera();
  testWorldgenRulerOverlayDraws();
  passed.push('Worldgen 2D: ruler maths, legend stops, keyboard camera, ruler overlay pixels');
  passed.push(await testWorldgenRulerOnMap());
  stage('creative planning flows');
  passed.push(testBoardInteractions());
  passed.push(await testPlanningTitleOwnership());
  passed.push(...await testPlanningSaveRecovery());
  passed.push(...await testProjectUserFlows());
  passed.push(...await testCreativeRetrieval());
  passed.push(...await testOutlineCreativeFlow());
  passed.push(...await testRelationshipsMatrixBrowser());
  passed.push(...await testPlanningFollowup());
  passed.push(...await testDiaryAutosave());
  passed.push(...await testCodexConcurrentEditing());
  passed.push(...await testCreativeOrganizationBrowser());
  passed.push(...await testCreativeCapturePersistence());
  passed.push(...await testInquiryEnrichment());
  passed.push(...await testInquiryUi());
  stage('visual references');
  passed.push(...await testEditorialTools());
  passed.push(...await runVisualRefTests());
  stage('image studio');
  passed.push(...await runImageStudioTests());
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
