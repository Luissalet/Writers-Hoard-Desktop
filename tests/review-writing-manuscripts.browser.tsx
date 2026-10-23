import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { Project, Writing } from '@/types';
import type { PublishingProfile } from '@/types/projectTools';
import { resolvePublishingWritings } from '@/services/projectTools';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ManuscriptsPanel from '@/engines/writings/components/ManuscriptsPanel';
import { useLocaleStore } from '@/stores/localeStore';

export async function reviewManuscriptCapturedHistoryAndOtherEraOwner(): Promise<string[]> {
  const { capturePublicationSnapshot, publicationReaderSource } = await import('@/services/publishedEditions/snapshot');
  const { manuscriptProject, selectManuscriptWritings } = await import('@/engines/writings/manuscripts');
  const { defaultReaderPresentation } = await import('@/engines/writings/readerPresentationTypes');
  const { buildReaderHtml } = await import('@/engines/writings/readerExport');
  const projectId = 'review-captured-history-owner', id = `${projectId}-era-only`, selection = { kind: 'manuscript' as const, id: A };
  try {
    await seedBooks(projectId); await db.writings.where('projectId').equals(projectId).delete();
    await db.projects.update(projectId, { worldEras: ['past', 'future'].map(eraId => ({ id: eraId, name: eraId, description: '', revision: 0, createdAt: 1, updatedAt: 1 })) });
    const unset = { ...piece(id, undefined, projectId), content: '<p>ERA_ONLY_A_CAPTURED_PROSE</p>' }, owned = { ...unset, manuscriptId: A };
    const doc = (row: Writing) => ({ root: row as unknown as import('@/services/worldEras/types').EraRow, children: { writingSnapshots: [] } });
    const target: import('@/services/worldEras/types').WorldEraVariant = { id: `${id}-past`, projectId, eraId: 'past', kind: 'writings', entityId: id, revision: 2, updatedAt: 2, document: doc(unset), history: [] };
    for (const origin of ['history', 'other-era']) {
      await db.worldEraVariants.where('projectId').equals(projectId).delete();
      await db.worldEraVariants.put({ ...target, history: origin === 'history' ? [{ revision: 1, updatedAt: 1, document: doc(owned) }] : [] });
      if (origin === 'other-era') await db.worldEraVariants.put({ ...target, id: `${id}-future`, eraId: 'future', document: doc(owned) });
      const before = JSON.stringify(await db.worldEraVariants.where('projectId').equals(projectId).toArray()), snapshot = await capturePublicationSnapshot({ projectId, eraId: 'past' }), source = publicationReaderSource(snapshot), rows = selectManuscriptWritings(source.writings, selection);
      assert(rows.length === 1 && rows[0].id === id && rows[0].manuscriptId === A, `Captured structural owner ignored ${origin} without Base/Archive`);
      let html = ''; db.close();
      try { html = (await buildReaderHtml(manuscriptProject(snapshot.project, selection, 'past'), rows, defaultReaderPresentation(), 'en', { projectId, eraId: 'past' }, source, selection)).html; } finally { await db.open(); }
      assert(html.includes('ERA_ONLY_A_CAPTURED_PROSE') && JSON.stringify(await db.worldEraVariants.where('projectId').equals(projectId).toArray()) === before, `Detached Reader lost ${origin} inheritance or mutated captured origin`);
    }
    const conflict = (await db.worldEraVariants.get(`${id}-future`))!; conflict.document!.root.manuscriptId = B;
    await db.worldEraVariants.put({ ...target, document: doc(owned) }); await db.worldEraVariants.put(conflict);
    let rejected = false; try { await capturePublicationSnapshot({ projectId, eraId: 'past' }); } catch { rejected = true; }
    assert(rejected, 'Captured structural resolver accepted explicit A/B conflict in different eras');
    return ['Independent detached captured Reader oracle: era-only legacy owner inherits from retained history or another era without writes; explicit cross-era A/B remains conflict'];
  } finally { if (!db.isOpen()) await db.open(); await deleteProject(projectId); }
}

export async function reviewManuscriptCapturedArchivedOwner(): Promise<string[]> {
  const { deleteWritingRestorable } = await import('@/engines/writings/operations');
  const { readWorldDocument } = await import('@/services/worldEras/store');
  const { capturePublicationSnapshot, publicationReaderSource } = await import('@/services/publishedEditions/snapshot');
  const { publishEdition } = await import('@/services/publishedEditions/store');
  const { manuscriptProject, selectManuscriptWritings } = await import('@/engines/writings/manuscripts');
  const { defaultReaderPresentation } = await import('@/engines/writings/readerPresentationTypes');
  const { buildReaderHtml } = await import('@/engines/writings/readerExport');
  const projectId = 'review-captured-archived-owner', eraId = `${projectId}-past`, selection = { kind: 'manuscript' as const, id: A };
  try {
    const { a } = await seedBooks(projectId);
    await db.projects.update(projectId, { worldEras: [{ id: eraId, name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }] });
    const legacy = { ...a, content: '<p>ARCHIVED_A_VISIBLE_ONLY_IN_PAST</p>' }; delete legacy.manuscriptId;
    await db.worldEraVariants.put({ id: `${a.id}-variant`, projectId, eraId, kind: 'writings', entityId: a.id, revision: 1, updatedAt: 1, document: { root: legacy as unknown as import('@/services/worldEras/types').EraRow, children: { writingSnapshots: [] } }, history: [] });
    await deleteWritingRestorable(a.id);
    const live = await readWorldDocument({ projectId, eraId }, 'writings', a.id);
    assert(live?.document.root.manuscriptId === A, 'Fixture is not a valid archived Base A with inherited era owner');
    const beforeArchives = JSON.stringify(await db.documentArchives.where('projectId').equals(projectId).toArray());
    let publicationError: unknown;
    try { await publishEdition({ projectId, eraId, writingScope: selection, chapterIds: [a.id], title: 'Captured structural owner', locale: 'en', expectedRevision: 0 }); } catch (error) { publicationError = error; }
    const snapshot = await capturePublicationSnapshot({ projectId, eraId }), source = publicationReaderSource(snapshot), projected = manuscriptProject(snapshot.project, selection, eraId), rows = selectManuscriptWritings(source.writings, selection);
    let detachedError: unknown, detachedHtml = '';
    db.close();
    try { detachedHtml = (await buildReaderHtml(projected, rows, defaultReaderPresentation(), 'en', { projectId, eraId }, source, selection)).html; } catch (error) { detachedError = error; } finally { await db.open(); }
    assert(!publicationError && !detachedError && rows.some(row => row.id === a.id && row.manuscriptId === A) && detachedHtml.includes('ARCHIVED_A_VISIBLE_ONLY_IN_PAST'), `Captured publication disagrees with valid live Archive owner: ${JSON.stringify({ publicationError: String(publicationError), detachedError: String(detachedError), sourceOwner: source.writings.find(row => row.id === a.id)?.manuscriptId, selected: rows.map(row => row.id), marker: detachedHtml.includes('ARCHIVED_A_VISIBLE_ONLY_IN_PAST') })}`);
    assert(JSON.stringify(await db.documentArchives.where('projectId').equals(projectId).toArray()) === beforeArchives, 'Capture/publication materialized or changed archived structural origin');
    return ['Independent native era publication + DB-closed captured Reader oracle: archived Base A supplies immutable owner to legacy ownerless era overlay, preserving prose/selection without live DB fallback or Archive mutation'];
  } finally { if (!db.isOpen()) await db.open(); await deleteProject(projectId); }
}

export async function reviewManuscriptReaderScopeRetarget(): Promise<string[]> {
  const { MemoryRouter } = await import('react-router-dom');
  const { default: ReadingView } = await import('@/engines/writings/components/ReadingView');
  const { saveReadingPosition } = await import('@/engines/writings/readingPositionPersist');
  const projectId = 'review-reader-scope-retarget', host = document.createElement('div');
  document.body.append(host); const root = createRoot(host);
  try {
    await seedBooks(projectId); useLocaleStore.setState({ locale: 'en', loaded: true });
    const aRows = [piece('A_OPENING', A, projectId), { ...piece('A_SAVED_PLACE', A, projectId), chapter: 2 }], bRows = [piece('B_OPENING', B, projectId), { ...piece('B_SAVED_PLACE', B, projectId), chapter: 2 }];
    await db.writings.bulkPut([...aRows, ...bRows]);
    await saveReadingPosition({ projectId, pieceId: aRows[1].id, fraction: .4, index: 1 }, A);
    await saveReadingPosition({ projectId, pieceId: bRows[1].id, fraction: .7, index: 1 }, B);
    const render = async (id: string, rows: Writing[]) => { await act(async () => { root.render(<MemoryRouter><ReadingView writingScope={{ kind: 'manuscript', id }} pieces={rows} onClose={() => undefined} onOpenInEditor={() => undefined} /></MemoryRouter>); await uiPause(); }); await act(async () => { await uiPause(); }); };
    await render(A, aRows);
    assert([...host.querySelectorAll('[role="status"]')].some(row => row.textContent?.includes('A_SAVED_PLACE')), 'Reader fixture did not resume Book A');
    await render(B, bRows);
    const status = [...host.querySelectorAll('[role="status"]')].map(row => row.textContent).join();
    assert(status.includes('B_SAVED_PLACE') && !status.includes('A_SAVED_PLACE'), `Mounted Reader scope retarget failed to restore B bookmark or retained A status: ${status}`);
    return ['Independent mounted Reader oracle: switching same-world manuscript context restores the destination bookmark and discards old resume status'];
  } finally { await act(async () => root.unmount()); host.remove(); await deleteProject(projectId); }
}

export async function reviewManuscriptChapterWinsLibrary(): Promise<string[]> {
  const { MemoryRouter, useNavigate } = await import('react-router-dom');
  const { default: WritingsView } = await import('@/engines/writings/components/WritingsView');
  const projectId = 'review-chapter-wins-library', host = document.createElement('div');
  document.body.append(host); const root = createRoot(host); let go: (to: string) => void = () => { throw Error('Router not mounted'); };
  function Steer() { go = useNavigate(); return null; }
  try {
    const { a, b } = await seedBooks(projectId), rows = await db.writings.where('projectId').equals(projectId).toArray();
    useLocaleStore.setState({ locale: 'en', loaded: true });
    await act(async () => { root.render(<MemoryRouter initialEntries={[`/project/${projectId}/writings?manuscript=${A}&writing=${a.id}`]}><Steer /><WritingsView projectId={projectId} writings={rows} onAdd={async () => undefined} onEdit={async () => undefined} onDelete={async () => undefined} /></MemoryRouter>); await uiPause(); });
    for (let i = 0; i < 35 && !host.querySelector('[contenteditable="true"]'); i++) await act(async () => { await uiPause(); });
    const title = [...host.querySelectorAll('input')].find(row => row.value === a.title);
    assert(title, 'Fixture did not open linked A chapter editor');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(title, 'A_DIRTY_TITLE_MUST_SURVIVE'); title.dispatchEvent(new Event('input', { bubbles: true })); await uiPause(); });
    await act(async () => { go(`/project/${projectId}/writings?manuscript=library&writing=${b.id}`); await uiPause(); });
    for (let i = 0; i < 35 && ![...host.querySelectorAll('input')].some(row => row.value === b.title); i++) await act(async () => { await uiPause(); });
    assert([...host.querySelectorAll('input')].some(row => row.value === b.title) && host.querySelector('[contenteditable="true"]'), `Valid linked B chapter lost to contradictory library route: ${host.textContent?.slice(0, 500)}`);
    assert((await db.writings.get(a.id))?.title === 'A_DIRTY_TITLE_MUST_SURVIVE', 'Cross-book route lost dirty A title instead of flushing before opening B');
    return ['Independent route oracle: valid linked chapter wins library contradiction, opens B and preserves dirty A through the normal flush'];
  } finally { await act(async () => root.unmount()); host.remove(); await deleteProject(projectId); }
}

export async function reviewManuscriptNativeDuplicateAndZip(): Promise<string[]> {
  await import('@/engines');
  const { previewProjectDuplicate, duplicateProject } = await import('@/services/projectDuplicate/service');
  const { createProjectZipArchive, importProjectZip } = await import('@/services/zipBackup');
  const { setSetting, PROJECT_SETTING_PREFIXES } = await import('@/db/operations');
  const { bookScopeId } = await import('@/services/codexReference/pins');
  const { saveReadingPosition, loadReadingPosition } = await import('@/engines/writings/readingPositionPersist');
  const { defaultReaderPresentation } = await import('@/engines/writings/readerPresentationTypes');
  const projectId = 'review-native-manuscript-portability', operationId = 'review_native_manuscript_portability';
  let copyId = '';
  try {
    const { main, a, b } = await seedBooks(projectId), eraId = `${projectId}-past`, cardId = `${projectId}-card`;
    const project = (await db.projects.get(projectId))!, cover = defaultReaderPresentation().cover;
    await db.projects.update(projectId, { worldEras: [{ id: eraId, name: 'PORTABLE_PAST', description: '', revision: 0, createdAt: 1, updatedAt: 1 }], manuscriptCatalog: { ...project.manuscriptCatalog!, entries: project.manuscriptCatalog!.entries.map(row => row.id === A ? { ...row, archivedAt: 7, eraCovers: { [eraId]: { ...cover, color: '#345678' } } } : row) } });
    await db.codexEntries.put({ id: cardId, projectId, title: 'PORTABLE_CANONICAL_CARD', type: 'location', content: '<p>One shared world card</p>', fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    await db.referencePins.put({ id: bookScopeId(projectId, A), projectId, scopeId: bookScopeId(projectId, A), entryIds: [cardId], updatedAt: 1 });
    await saveReadingPosition({ projectId, pieceId: main.id, fraction: .1, index: 0 });
    await saveReadingPosition({ projectId, pieceId: a.id, fraction: .6, index: 0 }, A);
    await saveReadingPosition({ projectId, pieceId: b.id, fraction: .8, index: 0 }, B);
    await db.publishingProfiles.put({ ...profile({ writingScope: { kind: 'manuscript', id: A }, selectedWritingIds: [a.id], writingOrder: [a.id], selectionMode: 'selected' }), id: `${projectId}-profile`, projectId });
    const source = JSON.stringify({ project: await db.projects.get(projectId), writings: await db.writings.where('projectId').equals(projectId).toArray(), pins: await db.referencePins.where('projectId').equals(projectId).toArray(), position: await db.settings.where('key').equals(PROJECT_SETTING_PREFIXES.readingPosition + projectId).first() });
    const preview = await previewProjectDuplicate({ projectId });
    const copied = await duplicateProject({ projectId, operationId, title: 'Independent native duplicate', expectedSourceVersion: preview.sourceVersion }); copyId = copied.projectId;
    assert(copied.complete, 'Native duplicate did not finish browser-owned data');
    const copy = (await db.projects.get(copyId))!, ca = copy.manuscriptCatalog!.entries.find(row => row.title === 'A')!, cb = copy.manuscriptCatalog!.entries.find(row => row.title === 'B')!, ce = copy.worldEras![0];
    const rows = await db.writings.where('projectId').equals(copyId).toArray(), ra = rows.find(row => row.title === a.title)!, rb = rows.find(row => row.title === b.title)!, rm = rows.find(row => row.title === main.title)!;
    assert(ca.id !== A && cb.id !== B && ra.manuscriptId === ca.id && rb.manuscriptId === cb.id && !rm.manuscriptId && ca.archivedAt === 7, 'Native duplicate lost catalog/owners/implicit main or archived accessibility');
    assert(ce.id !== eraId && ca.eraCovers?.[ce.id]?.color === '#345678' && !ca.eraCovers?.[eraId], 'Era cover retained old era identifier');
    const pin = await db.referencePins.get(bookScopeId(copyId, ca.id)), cards = await db.codexEntries.where('projectId').equals(copyId).toArray();
    assert(pin?.scopeId === pin?.id && pin?.entryIds.join() === cards[0]?.id && cards[0]?.id !== cardId, 'Compound book pin/card mapping disagrees');
    const positions = await Promise.all([loadReadingPosition(copyId), loadReadingPosition(copyId, ca.id), loadReadingPosition(copyId, cb.id)]);
    assert(positions.every(row => row?.projectId === copyId) && positions.map(row => row?.pieceId).join() === [rm.id, ra.id, rb.id].join() && positions.map(row => row?.fraction).join() === '0.1,0.6,0.8', 'Native duplicate lost separate real Reader positions');
    const cp = (await db.publishingProfiles.where('projectId').equals(copyId).toArray())[0];
    assert(cp.writingScope?.kind === 'manuscript' && cp.writingScope.id === ca.id && cp.selectedWritingIds.join() === ra.id && cp.writingOrder?.join() === ra.id, 'Native duplicate profile owner/order mismatch');
    assert(JSON.stringify({ project: await db.projects.get(projectId), writings: await db.writings.where('projectId').equals(projectId).toArray(), pins: await db.referencePins.where('projectId').equals(projectId).toArray(), position: await db.settings.where('key').equals(PROJECT_SETTING_PREFIXES.readingPosition + projectId).first() }) === source, 'Native duplicate mutated source');
    const archive = await createProjectZipArchive(copyId), expected = JSON.stringify({ catalog: copy.manuscriptCatalog, eras: copy.worldEras, writings: rows, pins: await db.referencePins.where('projectId').equals(copyId).toArray(), profiles: await db.publishingProfiles.where('projectId').equals(copyId).toArray() });
    await db.writings.update(ra.id, { content: '<p>Mutated after archive</p>' });
    await importProjectZip(new File([archive.blob], archive.fileName, { type: 'application/zip' }), { replaceProjectIds: [copyId] });
    const restored = (await db.projects.get(copyId))!;
    assert(JSON.stringify({ catalog: restored.manuscriptCatalog, eras: restored.worldEras, writings: await db.writings.where('projectId').equals(copyId).toArray(), pins: await db.referencePins.where('projectId').equals(copyId).toArray(), profiles: await db.publishingProfiles.where('projectId').equals(copyId).toArray() }) === expected, 'Native ZIP replacement changed catalog/era covers/owners/prose/pins/profiles');
    const afterPositions = await Promise.all([loadReadingPosition(copyId), loadReadingPosition(copyId, ca.id), loadReadingPosition(copyId, cb.id)]);
    // Project ZIP has always cleared session settings on replacement. Full ZIP,
    // unlike Project ZIP, transports settings; do not broaden this delta's format.
    assert(afterPositions.every(row => row === null), 'Project ZIP replacement retained stale Reader session positions');
    return ['Independent ordinary Duplicate + ZIP replacement: implicit main, A/B owners, archived A, era cover keys, shared-card compound pins and publishing profile order remain coherent; Duplicate remaps three native Reader positions, Project ZIP retains its existing session reset; source unchanged and copied prose restored'];
  } finally {
    if (copyId) await deleteProject(copyId); await deleteProject(projectId);
    await db.settings.delete(`projectDuplicate.operation.${operationId}`);
    await setSetting(PROJECT_SETTING_PREFIXES.readingPosition + projectId, '');
  }
}

export async function reviewManuscriptPlaybackOwnBaseline(): Promise<string[]> {
  const { saveReaderPresentation, defaultReaderPresentation } = await import('@/engines/writings/readerPresentation');
  const { manuscriptProject } = await import('@/engines/writings/manuscripts');
  const projectId = 'review-manuscript-playback-own-baseline';
  const aId = `${projectId}-a`, bId = `${projectId}-b`;
  const shared = defaultReaderPresentation(); shared.playback = { mode: 'read', wordsPerMinute: 300 };
  const ownA = defaultReaderPresentation(), ownB = defaultReaderPresentation();
  ownA.playback = { mode: 'play', wordsPerMinute: 180 }; ownB.playback = { mode: 'read', wordsPerMinute: 240 };
  const project: Project = { id: projectId, title: 'Separate playback baselines', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: 1, updatedAt: 1, readerPresentation: shared, manuscriptCatalog: { revision: 1, entries: [{ id: aId, title: 'A', reader: { cover: ownA.cover, playback: ownA.playback }, createdAt: 1, updatedAt: 1 }, { id: bId, title: 'B', reader: { cover: ownB.cover, playback: ownB.playback }, createdAt: 1, updatedAt: 1 }] } };
  try {
    await db.projects.put(project);
    await db.writings.bulkPut([piece(`${projectId}-main`, undefined, projectId), piece(`${projectId}-a-chapter`, aId, projectId), piece(`${projectId}-b-chapter`, bId, projectId)]);
    const beforeWritings = JSON.stringify(await db.writings.where('projectId').equals(projectId).toArray());
    const base = structuredClone(manuscriptProject(project, { kind: 'manuscript', id: bId }).readerPresentation!);
    const draft = structuredClone(base); draft.playback = { mode: 'read', wordsPerMinute: 360 };
    let reason: unknown;
    try { await saveReaderPresentation(projectId, draft, base, undefined, bId); } catch (error) { reason = error; }
    assert(!reason, `Uncontended Book B playback compared against main instead of its own 240 baseline: ${String(reason)}`);
    const after = (await db.projects.get(projectId))!;
    assert(after.manuscriptCatalog?.entries.find(entry => entry.id === bId)?.reader?.playback?.wordsPerMinute === 360, 'Own book playback did not persist');
    assert(JSON.stringify(after.readerPresentation?.playback) === JSON.stringify(shared.playback) && JSON.stringify(after.readerPresentation?.cover) === JSON.stringify(shared.cover), 'Editing B changed main playback/cover');
    assert(JSON.stringify(after.manuscriptCatalog?.entries.find(entry => entry.id === aId)) === JSON.stringify(project.manuscriptCatalog!.entries[0]), 'Editing B changed A metadata');
    assert(JSON.stringify(await db.writings.where('projectId').equals(projectId).toArray()) === beforeWritings, 'Playback edit changed chapters');
    return ['Independent native presentation oracle: main300/A180/B240, B changes to360 without false conflict; canonical main playback/cover, A metadata and all chapters unchanged'];
  } finally { await deleteProject(projectId); }
}

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
type Selection = { kind: 'world' } | { kind: 'manuscript'; id: string };
const P = 'review-writing-manuscripts';
const A = `${P}-book-a`, B = `${P}-book-b`;
function piece(id: string, manuscriptId?: string, projectId = P): Writing {
  return { id, projectId, ...(manuscriptId ? { manuscriptId } : {}), title: id, content: `<p>${id}</p>`, status: 'draft', chapter: 1, wordCount: 1, tags: [], createdAt: 1, updatedAt: 1 };
}
function profile(changes: Partial<PublishingProfile> & { writingScope?: Selection } = {}): PublishingProfile {
  return { id: `${P}-profile`, projectId: P, name: 'Profile before extra books', format: 'manuscript', includeTitlePage: true, includeSynopsis: false, includeBibliography: false, citationStyle: 'apa', selectionMode: 'all', selectedWritingIds: [], writingOrder: [], createdAt: 1, updatedAt: 1, ...changes };
}

export async function reviewManuscriptProfileIsolation(): Promise<string[]> {
  const main = piece('LEGACY_MAIN_OWNED'), held = { ...piece('HELD_BACK_MAIN'), heldBack: true };
  const a = piece('ONLY_BOOK_A', A), b = piece('ONLY_BOOK_B', B), foreign = piece('FOREIGN_WORLD_SAME_OWNER', A, `${P}-foreign`);
  const legacy = profile(), before = JSON.stringify(legacy), rows = [b, foreign, main, a, held];
  const resolved = resolvePublishingWritings(rows, legacy);
  assert(resolved.writings.map(row => row.id).join() === main.id && JSON.stringify(legacy) === before, 'Legacy all escaped implicit main or profile read mutated metadata');
  const attack = resolvePublishingWritings(rows, profile({ selectionMode: 'selected', selectedWritingIds: [a.id, b.id, held.id], writingOrder: [foreign.id, b.id, a.id, held.id] }));
  assert(attack.writings.map(row => row.id).join() === held.id, 'Selected/order references escaped principal or lost existing selected held-back semantics');
  assert([a.id, b.id, foreign.id].every(id => attack.missingWritingIds.includes(id)), 'Out-of-book IDs are not reported unresolved');
  const own = resolvePublishingWritings(rows, profile({ writingScope: { kind: 'manuscript', id: A }, writingOrder: [b.id, main.id, foreign.id] }));
  assert(own.writings.map(row => row.id).join() === a.id, 'Explicit book pulled a same-world or same-owner foreign-world chapter');
  const world = resolvePublishingWritings(rows, profile({ writingScope: { kind: 'world' } }));
  assert(world.writings.length === 3 && [main, a, b].every(row => world.writings.some(found => found.id === row.id)) && !world.writings.some(row => row.id === foreign.id || row.id === held.id), 'Explicit world scope lost chapters or changed held-back/project semantics');
  return ['Independent profile oracle: pre-existing all remains principal, selected/order cannot escape book, unresolved IDs declared, world scope and held-back semantics preserved without mutating input'];
}

export async function reviewManuscriptReaderIsolation(): Promise<string[]> {
  const main = piece('READER_ONLY_MAIN'), a = piece('READER_ONLY_A', A), b = piece('READER_ONLY_B', B), cardId = `${P}-shared-card`;
  const link = `<p><a href="/project/${P}/codex?entry=${cardId}">Shared harbour identity</a></p>`;
  a.content += link; b.content += link;
  const project: Project = {
    id: P, title: 'WORLD_TITLE_UNCHANGED', author: 'WORLD_BYLINE_NOT_A_BOOK_DEFAULT', blurb: 'WORLD_BLURB_NOT_A_BOOK_DEFAULT', description: '', mode: 'custom', type: 'standalone', color: '#d5b575', status: 'draft', enabledEngines: ['writings', 'codex'], engineOrder: ['writings'], createdAt: 1, updatedAt: 1,
    manuscriptCatalog: { revision: 1, main: { title: 'MAIN_BOOK_TITLE', author: null, blurb: null }, entries: [{ id: A, title: 'BOOK_A_TITLE', createdAt: 1, updatedAt: 1 }, { id: B, title: 'BOOK_B_TITLE', archivedAt: 2, createdAt: 1, updatedAt: 2 }] },
  };
  try {
    await db.projects.put(project); await db.writings.bulkPut([main, a, b]);
    await db.codexEntries.put({ id: cardId, projectId: P, title: 'SHARED_HARBOUR_CARD', content: '<p>ONE_CANONICAL_CARD</p>', fields: {}, type: 'location', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    const before = JSON.stringify({ project: await db.projects.get(P), writings: await db.writings.where('projectId').equals(P).toArray() });
    const read = async (args: Record<string, unknown>) => { const reply = await runBridgeTool('wh_reader_export', { projectId: P, locale: 'en', ...args }); assert(reply.ok, JSON.stringify(reply)); return (reply.result as { html: string }).html; };
    const mainHtml = await read({});
    assert(mainHtml.includes(main.id) && mainHtml.includes('MAIN_BOOK_TITLE') && !mainHtml.includes(a.id) && !mainHtml.includes(b.id) && !mainHtml.includes(project.author!), 'Default Reader mixed books or ignored explicit main byline clear');
    const aHtml = await read({ writingScope: { kind: 'manuscript', id: A } }), bHtml = await read({ writingScope: { kind: 'manuscript', id: B } });
    assert(aHtml.includes(a.id) && aHtml.includes('BOOK_A_TITLE') && !aHtml.includes(main.id) && !aHtml.includes(b.id) && !aHtml.includes(project.author!), 'Book A Reader leaked another book/world byline');
    assert(bHtml.includes(b.id) && bHtml.includes('BOOK_B_TITLE') && !bHtml.includes(a.id) && !bHtml.includes(main.id), 'Organizationally archived Book B became inaccessible or changed owner');
    assert(aHtml.includes('ONE_CANONICAL_CARD') && bHtml.includes('ONE_CANONICAL_CARD'), 'Book projection lost shared world card references');
    const worldHtml = await read({ writingScope: { kind: 'world' } });
    assert([main, a, b].every(row => worldHtml.includes(row.id)), 'Explicit world Reader lost intentional multi-book selection');
    const missing = await runBridgeTool('wh_reader_export', { projectId: P, writingScope: { kind: 'manuscript', id: `${P}-absent` }, locale: 'en' });
    assert(!missing.ok, 'Unknown manuscript silently became main');
    assert(JSON.stringify({ project: await db.projects.get(P), writings: await db.writings.where('projectId').equals(P).toArray() }) === before, 'Reader read materialized catalog/owner or changed authored rows');
    return ['Independent registered Reader oracle: default/main null metadata clear, isolated A/B including archived book, same canonical world card, explicit world selection, unknown owner rejection and zero catalog/prose writes'];
  } finally { await deleteProject(P); }
}

export async function reviewManuscriptCatalogUndoIsolation(): Promise<string[]> {
  const { setManuscript, undoManuscript } = await import('@/engines/writings/manuscriptStore');
  const { createWriting, deleteWritingRestorable } = await import('@/engines/writings/operations');
  const projectId = `${P}-catalog-undo`, firstId = `${A}-undo`, otherId = `${B}-undo`;
  try {
    await db.projects.put({ id: projectId, title: 'Catalog Undo world', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: 1, updatedAt: 1 });
    const first = await setManuscript(projectId, firstId, 'create', { title: 'First empty book' }, 0);
    const other = await setManuscript(projectId, otherId, 'create', { title: 'Other later book' }, first.revision);
    const graph = { positions: {}, display: { names: 'hover' as const, nodeSize: 'small' as const, linkOpacity: 0.4, pictures: false } };
    await db.projects.update(projectId, { codexGraphLayout: graph });
    const otherBefore = JSON.stringify(other.manuscript);
    await undoManuscript(projectId, first.receipt);
    const undone = (await db.projects.get(projectId))!;
    assert(!undone.manuscriptCatalog?.entries.some(entry => entry.id === firstId) && JSON.stringify(undone.manuscriptCatalog?.entries.find(entry => entry.id === otherId)) === otherBefore && JSON.stringify(undone.codexGraphLayout) === JSON.stringify(graph), 'UndoCreate empty failed or reverted later book/graph');
    const protectedBook = await setManuscript(projectId, firstId, 'create', { title: 'Protected archived work' }, undone.manuscriptCatalog!.revision);
    const chapter = piece(`${projectId}-chapter`, firstId, projectId);
    await createWriting(chapter);
    await deleteWritingRestorable(chapter.id);
    assert(!await db.writings.get(chapter.id) && (await db.documentArchives.where('projectId').equals(projectId).toArray()).some(row => row.sourceId === chapter.id), 'Fixture did not archive real chapter with normal operation');
    const before = JSON.stringify({ project: await db.projects.get(projectId), archives: await db.documentArchives.where('projectId').equals(projectId).toArray() });
    let reason: unknown;
    try { await undoManuscript(projectId, protectedBook.receipt); } catch (error) { reason = error; }
    assert(reason instanceof Error && reason.message.includes('manuscript_has_later_work'), `UndoCreate did not identify archived later work: ${String(reason)}`);
    assert(JSON.stringify({ project: await db.projects.get(projectId), archives: await db.documentArchives.where('projectId').equals(projectId).toArray() }) === before, 'Refused UndoCreate changed archived work/catalog');
    return ['Independent catalog Undo oracle: empty create can undo after another book/graph edit; normal archived chapter prevents destructive UndoCreate with all metadata/archive bytes intact'];
  } finally { await deleteProject(projectId); }
}

export async function reviewManuscriptOwnerUndefinedPatch(): Promise<string[]> {
  const { createWriting, updateWritingAtVersion } = await import('@/engines/writings/operations');
  const projectId = `${P}-owner-patch`, bookId = `${B}-owner-patch`;
  try {
    await db.projects.put({ id: projectId, title: 'Stable owner world', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: 1, updatedAt: 1, manuscriptCatalog: { revision: 1, entries: [{ id: bookId, title: 'Book B', createdAt: 1, updatedAt: 1 }] } });
    const row = piece(`${projectId}-chapter`, bookId, projectId); await createWriting(row);
    const before = (await db.writings.get(row.id))!; let rejected = false;
    try { await updateWritingAtVersion(row.id, { manuscriptId: undefined, content: '<p>Content edit with an unset optional property</p>' }, before.updatedAt); } catch { rejected = true; }
    const after = (await db.writings.get(row.id))!;
    assert(after.manuscriptId === bookId, `Undefined in a normal Partial<Writing> patch moved a chapter to implicit main: ${JSON.stringify({ before, after })}`);
    if (rejected) assert(JSON.stringify(after) === JSON.stringify(before), 'Rejected owner patch still changed authored row');
    return ['Independent owner oracle: undefined optional field in normal content patch cannot silently clear immutable manuscript owner'];
  } finally { await deleteProject(projectId); }
}

export async function reviewManuscriptMainPresentationRejects(): Promise<string[]> {
  const { setManuscript } = await import('@/engines/writings/manuscriptStore');
  const projectId = `${P}-main-reject`;
  const cover = { style: 'paper' as const, color: '#112233', texture: 'none' as const, artwork: false, showAtStart: true };
  const forbidden = [{ coverImage: 'data:image/png;base64,AA==' }, { cover }, { playback: { mode: 'play' as const, wordsPerMinute: 180 } }, { eraCovers: { past: cover } }, { reader: { cover } }];
  try {
    await db.projects.put({ id: projectId, title: 'World title stays canonical', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: 1, updatedAt: 1 });
    for (const invalid of forbidden) {
      const before = JSON.stringify(await db.projects.get(projectId)); let rejected = false;
      try { await setManuscript(projectId, 'main', 'update', { title: 'Should not change', ...invalid }, 0); } catch { rejected = true; }
      const after = JSON.stringify(await db.projects.get(projectId));
      assert(rejected && after === before, `Main accepted/dropped forbidden presentation patch instead of rejecting atomically: ${JSON.stringify({ invalid, rejected, before, after })}`);
    }
    return ['Independent main metadata oracle: coverImage/cover/playback/eraCovers/reader fields reject atomically without materializing main, incrementing revisions or accepting accompanying title'];
  } finally { await deleteProject(projectId); }
}

const uiPause = () => new Promise(resolve => setTimeout(resolve, 70));
async function uiClick(target: Element | undefined | null) {
  assert(target, 'Missing manuscript UI action');
  await act(async () => { (target as HTMLElement).click(); await uiPause(); });
}
function uiAction(parent: ParentNode, text: string) { return [...parent.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text); }
function uiForm() { const form = document.querySelector<HTMLFormElement>('[role="dialog"] form'); assert(form, 'Missing real manuscript form'); return form; }
async function uiEdit(title: string) {
  const row = [...document.querySelectorAll('li')].find(item => item.querySelector('h2')?.textContent === title);
  assert(row, `Missing manuscript row ${title}`); await uiClick(uiAction(row, 'Edit details'));
}
async function seedUi(projectId: string) {
  await db.projects.put({ id: projectId, title: 'UI world', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: 1, updatedAt: 1, manuscriptCatalog: { revision: 1, entries: [{ id: A, title: 'UI book A', createdAt: 1, updatedAt: 1 }, { id: B, title: 'UI book B', createdAt: 1, updatedAt: 1 }] } });
  useLocaleStore.setState({ locale: 'en' });
  const root = createRoot(document.getElementById('root')!);
  await act(async () => { root.render(<ManuscriptsPanel projectId={projectId} writings={[]} onOpen={() => undefined} onClose={() => undefined} />); await uiPause(); });
  for (let attempt = 0; attempt < 30 && !document.querySelector('li'); attempt++) await act(async () => { await uiPause(); });
  return root;
}

export async function reviewManuscriptFormCasBaseline(): Promise<string[]> {
  const { setManuscript } = await import('@/engines/writings/manuscriptStore');
  const projectId = `${P}-ui-cas`, root = await seedUi(projectId);
  try {
    await uiEdit('UI book A');
    const title = uiForm().querySelector<HTMLInputElement>('input:not([type="file"])')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Local draft still open'); title.dispatchEvent(new Event('input', { bubbles: true })); await uiPause(); });
    await act(async () => { await setManuscript(projectId, A, 'update', { title: 'Remote saved A' }, 1); await uiPause(); });
    for (let attempt = 0; attempt < 30 && ![...document.querySelectorAll('li h2')].some(item => item.textContent === 'Remote saved A'); attempt++) await act(async () => { await uiPause(); });
    assert([...document.querySelectorAll('li h2')].some(item => item.textContent === 'Remote saved A') && title.value === 'Local draft still open', 'Fixture did not retain dirty form while live query received remote edit');
    const before = JSON.stringify(await db.projects.get(projectId));
    await uiClick(uiAction(uiForm(), 'Save'));
    const after = await db.projects.get(projectId);
    assert(JSON.stringify(after) === before, `Open form adopted the later live revision and overwrote remote metadata: ${JSON.stringify(after?.manuscriptCatalog)}`);
    assert(document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.includes('conflict') && uiForm().querySelector<HTMLInputElement>('input')?.value === 'Local draft still open', 'Stale save did not retain draft and show native conflict');
    return ['Independent React form oracle: dirty metadata save uses opening CAS baseline despite live query refresh, preserves remote edit and retains local draft on conflict'];
  } finally { await act(async () => { root.unmount(); await uiPause(); }); await deleteProject(projectId); }
}

export async function reviewManuscriptLateCoverReader(): Promise<string[]> {
  const projectId = `${P}-ui-cover`, NativeReader = window.FileReader;
  const pendingReaders: DeferredReader[] = [];
  class DeferredReader extends NativeReader {
    private payload: string | null = null;
    private cancelled = false;
    override get result() { return this.payload; }
    override readAsDataURL(_file: Blob) { void _file; pendingReaders.push(this); }
    override abort() { this.cancelled = true; }
    finish(data: string) { if (this.cancelled) return; this.payload = data; this.onload?.call(this, new ProgressEvent('load') as ProgressEvent<FileReader>); }
  }
  window.FileReader = DeferredReader;
  const root = await seedUi(projectId);
  try {
    await uiEdit('UI book A');
    const input = uiForm().querySelector<HTMLInputElement>('input[type="file"]')!, files = new DataTransfer();
    files.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' }));
    await act(async () => { input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true })); await uiPause(); });
    assert(pendingReaders.length === 1, 'Cover input did not start its real FileReader boundary');
    await uiClick(uiAction(uiForm(), 'Cancel')); await uiEdit('UI book B');
    const before = JSON.stringify(await db.projects.get(projectId));
    await act(async () => { pendingReaders[0].finish('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4C8AAAAASUVORK5CYII='); await uiPause(); });
    await uiClick(uiAction(uiForm(), 'Save'));
    const after = (await db.projects.get(projectId))!, a = after.manuscriptCatalog!.entries.find(entry => entry.id === A)!, b = after.manuscriptCatalog!.entries.find(entry => entry.id === B)!;
    assert(a.coverImage === undefined && b.coverImage === undefined && b.title === 'UI book B', `Late cover read from cancelled A contaminated B: ${JSON.stringify({ before, after: after.manuscriptCatalog })}`);
    return ['Independent React FileReader oracle: delayed image read after Cancel A and Edit B cannot populate or save A image into B; deterministic async seam honours abort'];
  } finally { window.FileReader = NativeReader; await act(async () => { root.unmount(); await uiPause(); }); await deleteProject(projectId); }
}

async function seedBooks(projectId: string) {
  await db.projects.put({ id: projectId, title: 'One canonical world', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: 1, updatedAt: 1, manuscriptCatalog: { revision: 1, entries: [{ id: A, title: 'A', createdAt: 1, updatedAt: 1 }, { id: B, title: 'B', createdAt: 1, updatedAt: 1 }] } });
  const main = piece(`${projectId}-main` , undefined, projectId), a = piece(`${projectId}-a`, A, projectId), b = piece(`${projectId}-b`, B, projectId);
  await db.writings.bulkPut([main, a, b]); return { main, a, b };
}
function baselineEntry(row: Writing) { return { title: row.title, html: row.content, persisted: row.content, version: row.updatedAt, chapter: row.chapter ?? 0, wordCount: row.wordCount }; }

export async function reviewManuscriptBookImportBoundaries(): Promise<string[]> {
  const { saveBook } = await import('@/engines/writings/bookSave');
  const { applyChapterNumbers } = await import('@/engines/writings/chapterOrderPersist');
  const { planManuscriptImport } = await import('@/engines/writings/manuscriptReview/plan');
  const { applyManuscriptImport } = await import('@/engines/writings/manuscriptReview/persist');
  const { sha256Hex } = await import('@/services/judge/text');
  const projectId = `${P}-book-import`, scope = { projectId };
  try {
    const { main, a, b } = await seedBooks(projectId), othersBefore = JSON.stringify([main, b]);
    const grown = await saveBook({ projectId, manuscriptId: A, baseline: new Map([[a.id, baselineEntry(a)]]), sections: [{ writingId: a.id, clientId: null, title: a.title, html: a.content }, { writingId: null, clientId: 'new-own', title: 'A new heading', html: '<p>NEW_A_BODY</p>' }], confirmedDeletes: new Set(), firstChapter: 1, untitledTitle: 'Untitled' });
    const created = await db.writings.get(grown.created[0]?.writingId ?? '');
    assert(grown.created.length === 1 && !grown.conflicts.length && created?.manuscriptId === A && created.chapter === 2, 'Book heading did not persist as own A2');
    assert(JSON.stringify([await db.writings.get(main.id), await db.writings.get(b.id)]) === othersBefore, 'Growing A renumbered or rewrote main/B');
    await applyChapterNumbers(projectId, [{ id: a.id, chapter: 3 }, { id: b.id, chapter: 91 }], undefined, A);
    assert((await db.writings.get(a.id))?.chapter === 3 && JSON.stringify(await db.writings.get(b.id)) === JSON.stringify(b), 'Number plan crossed book ownership');
    const text = 'Imported heading\nA post-inspection source body';
    const source: import('@/engines/writings/manuscriptReview/types').InspectedManuscript = { name: 'review.md', stem: 'review', format: 'md', original: new Blob([text], { type: 'text/markdown' }), sha256: await sha256Hex(text), findings: [], comments: [], markerPrefix: 'REVIEW_COMMENT', blocks: [{ level: 1, text: 'Imported heading', html: '<h1>Imported heading</h1>', words: 2 }, { level: 0, text: 'A post-inspection source body', html: '<p>A post-inspection source body</p>', words: 5 }] };
    const split = { mode: 'file' as const, headingLevel: 1, separator: '***' };
    const planA = await planManuscriptImport([source], split, scope, [], A), planB = await planManuscriptImport([source], split, scope, [], B);
    assert(planA.digest !== planB.digest, 'Import digest omitted destination');
    const before = JSON.stringify({ rows: await db.writings.where('projectId').equals(projectId).toArray(), sources: await db.manuscriptSources.where('projectId').equals(projectId).toArray() });
    let rejected = false; try { await applyManuscriptImport(scope, [source], split, [], planA.digest, B); } catch { rejected = true; }
    assert(rejected && JSON.stringify({ rows: await db.writings.where('projectId').equals(projectId).toArray(), sources: await db.manuscriptSources.where('projectId').equals(projectId).toArray() }) === before, 'Digest A applied to B or wrote partial receipts');
    const imported = await applyManuscriptImport(scope, [source], split, [], planB.digest, B), importedRow = await db.writings.get(imported.writingIds[0]);
    assert(importedRow?.manuscriptId === B && importedRow.chapter === 2 && importedRow.manuscriptSource?.sourceId === imported.sourceIds[0], 'Import B did not retain owner/own numbering/provenance');
    const currentA = (await db.writings.get(a.id))!; rejected = false;
    try { await planManuscriptImport([source], split, scope, [{ key: planB.chapters[0].key, title: 'Foreign replacement', included: true, targetId: a.id, expectedUpdatedAt: currentA.updatedAt }], B); } catch { rejected = true; }
    assert(rejected && JSON.stringify(await db.writings.get(a.id)) === JSON.stringify(currentA), 'B replacement plan accepted A target');
    return ['Independent Book/import oracle: new heading and numbering stay in A, same number in B/main untouched; destination-bound digest rejects cross-apply atomically, B2 import retains source receipt and rejects A replacement'];
  } finally { await deleteProject(projectId); }
}

export async function reviewManuscriptForeignArchivedBookRestore(): Promise<string[]> {
  const { saveBook } = await import('@/engines/writings/bookSave');
  const { expectDeletedWriting, deleteWritingRestorable } = await import('@/engines/writings/operations');
  const projectId = `${P}-foreign-book-restore`;
  try {
    const { b } = await seedBooks(projectId);
    expectDeletedWriting(b.id); await deleteWritingRestorable(b.id);
    const before = JSON.stringify({ rows: await db.writings.where('projectId').equals(projectId).toArray(), archives: await db.documentArchives.where('projectId').equals(projectId).toArray() });
    let rejected = false;
    try { await saveBook({ projectId, manuscriptId: A, baseline: new Map(), sections: [{ writingId: b.id, clientId: 'foreign-undo-heading', title: 'A should not rewrite B', html: '<p>FOREIGN_RESTORE_ATTEMPT</p>' }], confirmedDeletes: new Set(), firstChapter: 1, untitledTitle: 'Untitled' }); } catch { rejected = true; }
    const after = JSON.stringify({ rows: await db.writings.where('projectId').equals(projectId).toArray(), archives: await db.documentArchives.where('projectId').equals(projectId).toArray() });
    assert(rejected && after === before, `Book A consumed global undo bundle from B or changed rows before rejecting: ${JSON.stringify({ rejected, before, after })}`);
    return ['Independent Book restore oracle: archived B heading cannot be restored/rewritten from A context; invalid owner rejects before shifting chapters or touching archive'];
  } finally { await deleteProject(projectId); }
}

export async function reviewManuscriptEraHistoryOwner(): Promise<string[]> {
  const { validateManuscriptContents } = await import('@/engines/writings/manuscripts');
  const { readWorldDocument } = await import('@/services/worldEras/store');
  const projectId = `${P}-history-owner`, id = `${projectId}-era-only`;
  try {
    await seedBooks(projectId); await db.writings.where('projectId').equals(projectId).delete();
    await db.projects.update(projectId, { worldEras: [{ id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }] });
    const owned = piece(id, A, projectId), unset = { ...owned }; delete unset.manuscriptId;
    const doc = (row: Writing) => ({ root: row as unknown as import('@/services/worldEras/types').EraRow, children: { writingSnapshots: [] } });
    for (const [current, historical] of [[owned, unset], [unset, owned]]) {
      const variant: import('@/services/worldEras/types').WorldEraVariant = { id: `${id}-variant`, projectId, eraId: 'past', kind: 'writings', entityId: id, revision: 2, updatedAt: 2, document: doc(current), history: [{ revision: 1, updatedAt: 1, document: doc(historical) }] };
      const project = (await db.projects.get(projectId))!;
      let invalid: unknown; try { validateManuscriptContents(project, [], [variant]); } catch (error) { invalid = error; }
      assert(!invalid, `Legacy missing owner must inherit the unique explicit structural owner regardless of current/history ordering: ${String(invalid)}`);
      await db.worldEraVariants.put(variant);
      const before = JSON.stringify(await db.worldEraVariants.get(variant.id));
      let read: Awaited<ReturnType<typeof readWorldDocument>>, failure: unknown;
      try { read = await readWorldDocument({ projectId, eraId: 'past' }, 'writings', id); } catch (error) { failure = error; }
      assert(!failure && read?.document.root.manuscriptId === A, `Preflight accepts unique A + legacy absent owner, but live era projection fails/differs: ${String(failure)}`);
      assert(JSON.stringify(await db.worldEraVariants.get(variant.id)) === before && read.version === 'variant:2', 'Owner projection rewrote history or changed CAS token');
    }
    const conflict = (await db.worldEraVariants.get(`${id}-variant`))!; conflict.document!.root.manuscriptId = A; conflict.history![0].document!.root.manuscriptId = B;
    let rejected = false; try { validateManuscriptContents((await db.projects.get(projectId))!, [], [conflict]); } catch { rejected = true; }
    assert(rejected, 'True explicit A/B structural conflict was silently inherited');
    return ['Independent era ownership oracle: unique explicit owner survives legacy missing fields in either current/history order, runtime/preflight agree without writes/CAS drift, explicit A/B still conflicts'];
  } finally { await deleteProject(projectId); }
}

export async function reviewManuscriptArchivedStructuralOwner(): Promise<string[]> {
  const { validateManuscriptContents } = await import('@/engines/writings/manuscripts');
  const { deleteWritingRestorable } = await import('@/engines/writings/operations');
  const { readWorldDocument } = await import('@/services/worldEras/store');
  const projectId = `${P}-archived-owner`;
  try {
    const { a } = await seedBooks(projectId);
    await db.projects.update(projectId, { worldEras: [{ id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }] });
    const legacy = { ...a }; delete legacy.manuscriptId;
    const variant: import('@/services/worldEras/types').WorldEraVariant = { id: `${a.id}-variant`, projectId, eraId: 'past', kind: 'writings', entityId: a.id, revision: 1, updatedAt: 1, document: { root: legacy as unknown as import('@/services/worldEras/types').EraRow, children: { writingSnapshots: [] } }, history: [] };
    await db.worldEraVariants.put(variant); await deleteWritingRestorable(a.id);
    const archives = await db.documentArchives.where('projectId').equals(projectId).toArray(), project = (await db.projects.get(projectId))!;
    assert(!await db.writings.get(a.id) && archives.some(row => row.sourceId === a.id), 'Fixture did not archive Base A through normal operation');
    let invalid: unknown; try { validateManuscriptContents(project, await db.writings.where('projectId').equals(projectId).toArray(), [variant], [], archives); } catch (error) { invalid = error; }
    assert(!invalid, `Archive retains structural A, but legacy overlay was prematurely assigned main during preflight: ${String(invalid)}`);
    const before = JSON.stringify({ variant: await db.worldEraVariants.get(variant.id), archives });
    const read = await readWorldDocument({ projectId, eraId: 'past' }, 'writings', a.id);
    assert(read?.document.root.manuscriptId === A, `Archiving Base A changed inherited era owner to main: ${String(read?.document.root.manuscriptId)}`);
    assert(JSON.stringify({ variant: await db.worldEraVariants.get(variant.id), archives: await db.documentArchives.where('projectId').equals(projectId).toArray() }) === before, 'Read mutated archived origin or legacy variant');
    return ['Independent archived origin oracle: normal Base archive remains structural owner source for legacy era overlay; preflight/runtime preserve A and all history/archive bytes'];
  } finally { await deleteProject(projectId); }
}

export async function reviewManuscriptEditionRestoreAndJson(): Promise<string[]> {
  const { publishEdition, restorePublishedEdition, getPublishedEdition } = await import('@/services/publishedEditions/store');
  const { setManuscript } = await import('@/engines/writings/manuscriptStore');
  const { exportProjectData, importProjectData } = await import('@/db/operations');
  const projectId = `${P}-edition-json`; let clone = '';
  try {
    const { a, b } = await seedBooks(projectId);
    const href = `/project/${projectId}/writings?manuscript=${A}&writing=${a.id}#chapter-link`;
    await db.writings.update(a.id, { content: a.content + `<p><a href="${href}">Editable historical book pointer</a></p>` });
    const result = await publishEdition({ projectId, writingScope: { kind: 'world' }, chapterIds: [a.id, b.id], title: 'WORLD_EDITION_LABEL', locale: 'en', expectedRevision: 0 });
    const edition = result.edition, frozen = JSON.stringify(edition), revision = result.revision;
    assert(edition.sourceProjectTitle === 'One canonical world' && edition.writingScope?.kind === 'world' && edition.chapters.some(chapter => chapter.writing.manuscriptId === A) && edition.chapters.some(chapter => chapter.writing.manuscriptId === B), 'World edition lost canonical origin or mixed owner capture');
    const before = JSON.stringify({ project: await db.projects.get(projectId), rows: await db.writings.where('projectId').equals(projectId).toArray() });
    let rejected = false; try { await restorePublishedEdition({ projectId, editionId: edition.id, expectedRevision: revision }); } catch { rejected = true; }
    assert(rejected && JSON.stringify({ project: await db.projects.get(projectId), rows: await db.writings.where('projectId').equals(projectId).toArray() }) === before, 'World restore guessed a destination or wrote before requiring it');
    await setManuscript(projectId, B, 'archive', {}, 1);
    const restored = await restorePublishedEdition({ projectId, editionId: edition.id, targetManuscriptId: B, expectedRevision: revision });
    assert(restored.writings.length === 2 && restored.writings.every(row => row.manuscriptId === B && row.id !== a.id && row.id !== b.id), 'Explicit archived B destination failed or restored original IDs/owners');
    assert(JSON.stringify(await getPublishedEdition(projectId, edition.id)) === frozen, 'Restore or archive rewrote captured origin/HTML/hash');
    await db.publishingProfiles.put({ ...profile({ writingScope: { kind: 'manuscript', id: A }, selectionMode: 'selected', selectedWritingIds: [a.id], writingOrder: [a.id] }), projectId, id: `${projectId}-profile` });
    const data = await exportProjectData(projectId); clone = await importProjectData(data);
    const copied = (await db.projects.get(clone))!, copiedRows = await db.writings.where('projectId').equals(clone).toArray();
    const copiedA = copied.manuscriptCatalog!.entries.find(entry => entry.title === 'A')!, copiedB = copied.manuscriptCatalog!.entries.find(entry => entry.title === 'B')!;
    assert(copiedA.id !== A && copiedB.id !== B && copiedB.archivedAt !== undefined && copiedRows.every(row => !row.manuscriptId || [copiedA.id, copiedB.id].includes(row.manuscriptId)), 'JSON catalogue/owner/archive remaps disagree');
    const copiedProfile = (await db.publishingProfiles.where('projectId').equals(clone).toArray())[0], copiedChapter = copiedRows.find(row => row.title === a.title && row.manuscriptId === copiedA.id)!;
    assert(copiedProfile?.writingScope?.kind === 'manuscript' && copiedProfile.writingScope.id === copiedA.id && copiedProfile.selectedWritingIds.join() === copiedChapter.id && copiedProfile.writingOrder?.join() === copiedChapter.id, 'Optional JSON profile scope/order did not share chapter/catalog remap');
    const copiedEdition = copied.publishedEditions![0];
    assert(copiedEdition.reader.html === edition.reader.html && copiedEdition.reader.sha256 === edition.reader.sha256 && copiedEdition.sourceProjectTitle === edition.sourceProjectTitle, 'JSON remapped or regenerated frozen historical artifact');
    const capturedA = copiedEdition.chapters.find(chapter => chapter.writing.manuscriptId === copiedA.id)!;
    const html = new DOMParser().parseFromString(capturedA.writing.content, 'text/html'), anchor = html.querySelector('a')!;
    const url = new URL(anchor.getAttribute('href')!, 'https://writer.invalid');
    assert(url.pathname === `/project/${clone}/writings` && url.searchParams.get('manuscript') === copiedA.id && url.searchParams.get('writing') === copiedChapter.id && url.hash === '#chapter-link', `Editable edition snapshot retained source world/book/chapter pointers: ${anchor.outerHTML}`);
    return ['Independent publication/JSON oracle: world restore requires explicit target before writes, archived B accepts new IDs, source edition stays frozen, optional profiles share remaps and editable historical book links remap while HTML/hash remain exact'];
  } finally { if (clone) await deleteProject(clone); await deleteProject(projectId); }
}
