import JSZip from 'jszip';
import { db } from '@/db';
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
import { deleteWriting } from '@/engines/writings/operations';
import { deleteBoardNode } from '@/engines/board/operations';
import {
  clearWritingRecoveryDraft,
  readWritingRecoveryDraft,
  writeWritingRecoveryDraft,
} from '@/engines/writings/recoveryJournal';
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
import { runRegionInfraTests } from './worldgen-region-infra.test';
import { testWorldgenDetailShader } from './worldgen-rendering';
import {
  createProjectZipArchive,
  importProjectZip,
  previewProjectZipImport,
} from '@/services/zipBackup';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import {
  calculateCoverage,
  deriveNarrativeContinuity,
  deriveProjectHealthStatus,
} from '@/services/projectIntelligence';
import { readWorldRenameEdits } from '@/engines/worldgen/core/readRenameEdits';
import {
  buildPublishingArtifacts,
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

registerFallbackAnchorAdapters();

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
  assert(db.verno === 26, `expected schema v26, received v${db.verno}`);
  for (const table of [
    'entityLinks', 'citations', 'publishingProfiles', 'conversionReceipts',
    'boards', 'boardNodes', 'boardEdges', 'boardLayers', 'boardViews',
    'canonTiles', 'renderedTiles',
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
  passed.push('Dexie migration v26');
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
  await db.publishingProfiles.add({
    id: 'publishing-profile-1', projectId, name: 'Editorial', format: 'manuscript',
    includeTitlePage: true, includeSynopsis: true, includeBibliography: true,
    citationStyle: 'apa', selectionMode: 'selected',
    selectedWritingIds: ['chapter-2', 'chapter-1'],
    writingOrder: ['chapter-2', 'missing-writing', 'chapter-1'],
    createdAt: now, updatedAt: now,
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

  const { blob, fileName } = await createProjectZipArchive(projectId);
  const archive = new File([blob], fileName, { type: 'application/zip' });
  await db.projects.update(projectId, { title: 'Current local title', updatedAt: now + 1 });

  const preview = await previewProjectZipImport(archive);
  assert(preview.collisions.length === 1, 'project ZIP collision was not detected');
  assert(
    preview.collisions[0].existingTitle === 'Current local title'
      && preview.collisions[0].incomingTitle === 'Incoming archive title',
    'project ZIP collision preview did not identify both versions',
  );

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
  assert(cockpitTabs.length === 11, 'Cockpit grouping lost a project view');
  assert(new Set(cockpitTabs).size === cockpitTabs.length, 'Cockpit grouping duplicated a project view');
  assert(resolveCockpitTab('research') === 'research', 'valid Cockpit panel did not survive URL resolution');
  assert(resolveCockpitTab('unknown') === 'overview', 'unknown Cockpit panel did not fall back to overview');
  assert(getCockpitGroup('publishing').id === 'prepare', 'publishing left the prepare workflow');

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

async function run(): Promise<void> {
  await testMigration();
  await testBackupRoundTrip();
  await testProjectImportCollisionGuard();
  await testCascades();
  await testScriptImportRoundTrip();
  await testAiTextParsing();
  testProjectIntelligenceSemantics();
  testNarrativeContinuitySemantics();
  testLightweightWorldgenRenameReader();
  await testOutlineBeatDeepLink();
  testEditorialNavigationContracts();
  testPersistedHtmlSanitizer();
  await testPublishingStudioSemantics();
  testRecoveryAndNavigation();
  testRecentEntityNavigation();
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
