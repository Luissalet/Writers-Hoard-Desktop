import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { Project, Writing } from '@/types';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { listManuscripts, setManuscript, undoManuscript } from '@/engines/writings/manuscriptStore';
import { manuscriptSummary } from '@/engines/writings/manuscripts';
import { defaultReaderPresentation } from '@/engines/writings/readerPresentationTypes';
import { updateWritingAtVersion, deleteWritingRestorable, restoreDeletedWriting } from '@/engines/writings/operations';
import { eraSnapshotOperations } from '@/services/worldEras/writings';
import { readWorldDocument, saveEraDocument, hideEraDocument, resetEraDocument } from '@/services/worldEras/store';
import ManuscriptsPanel from '@/engines/writings/components/ManuscriptsPanel';
import WritingsView from '@/engines/writings/components/WritingsView';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const A = 'home-review-a', B = 'home-review-b';
const FUTURE = Date.UTC(2042, 4, 6, 7, 8, 9);
interface Summary { chapterCount: number; wordCount: number; lastChapterUpdatedAt: number | null; lastChapterId: string | null }
interface Listing { projectId: string; revision: number; manuscripts: ({ id: string; title: string; summary?: Summary })[] }
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
async function settle(test: () => boolean, message: string) {
  for (let attempt = 0; attempt < 100; attempt++) { if (test()) return; await act(async () => { await pause(); }); }
  throw Error(message);
}
function writing(projectId: string, suffix: string, owner: string | undefined, updatedAt: number, wordCount = 2): Writing {
  return { id: `${projectId}-${suffix}`, projectId, ...(owner ? { manuscriptId: owner } : {}), title: suffix,
    content: `<p>${suffix} own prose</p>`, status: 'draft', chapter: 1, wordCount, tags: [], createdAt: 1, updatedAt };
}
async function seed(id: string) {
  const defaults = defaultReaderPresentation();
  const project = { id, title: `MAIN ${id}`, author: 'MAIN AUTHOR', description: '', mode: 'custom', type: 'standalone',
    status: 'draft', color: '#c4973b', enabledEngines: ['writings', 'codex'], engineOrder: ['writings'], createdAt: 1, updatedAt: FUTURE + 999999,
    worldEras: [{ id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }],
    manuscriptCatalog: { revision: 0, entries: [
      { id: A, title: `ONLY A ${id}`, author: 'A AUTHOR', blurb: 'A BLURB ONLY', createdAt: 1, updatedAt: FUTURE + 1000,
        reader: { cover: { ...defaults.cover, color: '#193b52' }, playback: defaults.playback }, eraCovers: { past: { ...defaults.cover, color: '#872f41' } } },
      { id: B, title: `ONLY B ${id}`, author: 'B AUTHOR', createdAt: 1, updatedAt: FUTURE + 2000 },
    ] } } as Project;
  const main = writing(id, 'main', undefined, 101), a1 = writing(id, 'a-one', A, 211, 3), a2 = { ...writing(id, 'a-two', A, 377, 5), status: 'finished' as const, heldBack: true }, b = writing(id, 'b', B, 997, 7);
  await db.projects.put(project); await db.writings.bulkPut([main, a1, a2, b]);
  return { project, main, a1, a2, b, rows: [main, a1, a2, b] };
}
async function wire(projectId: string, options: Record<string, unknown> = {}): Promise<Listing> {
  const result = await runBridgeTool('wh_writing_manuscripts', { projectId, ...options });
  assert(result.ok, `Registered manuscript read rejected: ${JSON.stringify(result)}`);
  return result.result as Listing;
}
async function summary(projectId: string, id: string, eraId?: string) {
  const result = await wire(projectId, { includeSummary: true, ...(eraId ? { eraId } : {}) }), value = result.manuscripts.find(row => row.id === id)?.summary;
  assert(value, `Missing summary for ${id}`); return value;
}
async function state(projectId: string) {
  const rows = async (name: string) => (await db.table(name).where('projectId').equals(projectId).toArray()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify({ project: await db.projects.get(projectId), writings: await rows('writings'), snapshots: await rows('writingSnapshots'),
    variants: await rows('worldEraVariants'), assets: await rows('worldEraAssets'), archives: await rows('documentArchives') });
}
function expectSummary(actual: Summary, count: number, words: number, time: number | null, id: string | null, message: string) {
  assert(actual.chapterCount === count && actual.wordCount === words && actual.lastChapterUpdatedAt === time && actual.lastChapterId === id,
    `${message}: ${JSON.stringify(actual)}`);
}

export async function reviewManuscriptHomePublicReadContract(): Promise<string[]> {
  const id = 'review-home-public-contract';
  try {
    const { project, main, a2, b } = await seed(id), before = await state(id), legacy = await wire(id);
    assert(Object.keys(legacy).sort().join() === 'manuscripts,projectId,revision' && legacy.manuscripts.every(row => !Object.hasOwn(row, 'summary')), 'Legacy public response gained derived fields');
    assert(JSON.stringify(await wire(id, { includeSummary: false, eraId: 'legacy-ignored-era' })) === JSON.stringify(legacy), 'Explicit false changed the legacy response or read scope');
    expectSummary(await summary(id, A), 2, 8, 377, a2.id, 'A must include finished/heldBack, excluding newer B/world/metadata');
    expectSummary(await summary(id, 'main'), 1, 2, 101, main.id, 'Implicit main uses only its own available chapter');
    assert(await state(id) === before, 'Read-only public summaries changed catalogue, row versions, snapshots or era/archive data');
    await updateWritingAtVersion(b.id, { title: 'B saved through normal operation' }, b.updatedAt);
    await db.projects.update(id, { updatedAt: FUTURE + 9999999, description: 'World activity is not a chapter edit' });
    const details = await setManuscript(id, A, 'update', { author: 'A METADATA CHANGED' }, 0);
    expectSummary(await summary(id, A), 2, 8, 377, a2.id, 'B, project touch and metadata edits must not move A');
    await undoManuscript(id, details.receipt);
    const foreign = writing(`${id}-foreign`, 'foreign-newest', A, FUTURE), shuffled = [foreign, b, a2, main];
    assert(manuscriptSummary(project, shuffled, A).lastChapterId === a2.id, 'Pure projection included a foreign project with identical owner');
    return ['Independent public summary contract: exact legacy shape, own all-status counts, B/world/metadata isolation and no read writes'];
  } finally { await deleteProject(id); }
}

export async function reviewManuscriptHomeAtomicReadAndErrors(): Promise<string[]> {
  const id = 'review-home-atomic-read';
  try {
    const { a2 } = await seed(id), before = await state(id), marker = new Error('independent outer rollback');
    let aborted = false;
    try {
      await db.transaction('rw', db.tables, async () => {
        await db.writings.update(a2.id, { updatedAt: 888, wordCount: 11 });
        const seen = (await listManuscripts(id, { includeSummary: true }) as Listing).manuscripts.find(row => row.id === A)?.summary;
        assert(seen?.lastChapterUpdatedAt === 888 && seen.wordCount === 14, 'Summary escaped the caller transaction or mixed committed rows');
        throw marker;
      });
    } catch (error) { assert(error === marker, `Unexpected composition failure: ${String(error)}`); aborted = true; }
    assert(aborted && await state(id) === before, 'Aborted outer transaction leaked derived state or chapter changes');
    await db.writings.where('projectId').equals(id).delete();
    const emptyState = await state(id), invalid = await runBridgeTool('wh_writing_manuscripts', { projectId: id, includeSummary: true, eraId: 'missing-era' });
    assert(!invalid.ok, 'Empty book converted an invalid era into successful empty output');
    const gone = await runBridgeTool('wh_writing_manuscripts', { projectId: `${id}-missing`, includeSummary: true });
    assert(!gone.ok && await state(id) === emptyState, 'Missing project was fabricated or failed reads wrote data');
    const legacyId = `${id}-legacy`, old = (await db.projects.get(id))!; delete old.manuscriptCatalog;
    await db.projects.put({ ...old, id: legacyId });
    try {
      const legacyBefore = await state(legacyId);
      expectSummary(await summary(legacyId, 'main'), 0, 0, null, null, 'Empty legacy main must not synthesize world timestamp');
      assert(await state(legacyId) === legacyBefore, 'Legacy read materialized catalogue or ownership');
    } finally { await deleteProject(legacyId); }
    return ['Independent coherent summary read inside an aborted native transaction; unknown era/project reject and empty legacy main stays implicit'];
  } finally { await deleteProject(id); }
}

export async function reviewManuscriptHomeEraAndArchivedOrigin(): Promise<string[]> {
  const id = 'review-home-era-origin', scope = { projectId: id, eraId: 'past' };
  try {
    const { a1, a2, b } = await seed(id), inherited = (await readWorldDocument(scope, 'writings', a2.id))!;
    const updated = await saveEraDocument(scope, 'writings', { ...inherited.document, root: { ...inherited.document.root, title: 'A era edit' } }, inherited.version), stamp = Number(updated.document.root.updatedAt);
    expectSummary(await summary(id, A, 'past'), 2, 8, stamp, a2.id, 'Era row timestamp must be selected');
    expectSummary(await summary(id, A), 2, 8, 377, a2.id, 'Era edit must not change Base summary');
    const other = (await readWorldDocument(scope, 'writings', b.id))!;
    await saveEraDocument(scope, 'writings', { ...other.document, root: { ...other.document.root, title: 'B much later era edit' } }, other.version);
    await eraSnapshotOperations(scope).ensureSnapshot(updated.document.root as unknown as Writing, 'manual');
    assert((await summary(id, A, 'past')).lastChapterUpdatedAt === stamp, 'B overlay or snapshot-only child moved A chapter date');
    const current = (await readWorldDocument(scope, 'writings', a2.id))!;
    await hideEraDocument(scope, 'writings', a2.id, current.version);
    expectSummary(await summary(id, A, 'past'), 1, 3, 211, a1.id, 'Hidden latest chapter must disappear from available set');
    const variant = (await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([id, 'past', 'writings', a2.id]).first())!;
    await resetEraDocument(scope, 'writings', a2.id, variant.revision);
    expectSummary(await summary(id, A, 'past'), 2, 8, 377, a2.id, 'Reinherit must expose saved Base time rather than variant container time');
    const legacy = { ...a2 }; delete legacy.manuscriptId;
    await db.worldEraVariants.put({ id: variant.id, projectId: id, eraId: 'past', kind: 'writings', entityId: a2.id, revision: 20, updatedAt: FUTURE, document: { root: legacy as unknown as import('@/services/worldEras/types').EraRow, children: { writingSnapshots: [] } }, history: [] });
    const archived = await deleteWritingRestorable(a2.id); assert(archived, 'Archive origin fixture missing');
    const before = await state(id);
    expectSummary(await summary(id, A, 'past'), 2, 8, 377, a2.id, 'Ownerless effective overlay must inherit A from archived Base');
    expectSummary(await summary(id, A), 1, 3, 211, a1.id, 'Archived Base chapter unavailable outside era');
    assert(await state(id) === before, 'Canonical origin summary normalized or materialized rows during read');
    return ['Independent era summary oracle: overlay/snapshot/hide/reinherit plus legacy owner from Archive use canonical available rows without writes'];
  } finally { await deleteProject(id); }
}

export async function reviewManuscriptHomeArchiveTieAndFuture(): Promise<string[]> {
  const id = 'review-home-archive-tie';
  try {
    const { project, a1, a2 } = await seed(id), tie = { ...a2, id: `${id}-a-0` };
    for (const order of [[a2, tie, a1], [a1, tie, a2]]) {
      const value = manuscriptSummary(project, order, A);
      expectSummary(value, 3, 13, 377, tie.id, 'Stable tie must not depend on input enumeration');
    }
    const future = { ...a1, updatedAt: FUTURE }; await db.writings.put(future);
    expectSummary(await summary(id, A), 2, 8, FUTURE, a1.id, 'Valid imported future timestamp must not be clipped to now');
    const receipt = await setManuscript(id, A, 'archive', {}, 0);
    expectSummary(await summary(id, A), 2, 8, FUTURE, a1.id, 'Organizational archive must leave chapter date available');
    await undoManuscript(id, receipt.receipt);
    const bundle = await deleteWritingRestorable(a1.id); assert(bundle, 'Native document archive fixture missing');
    expectSummary(await summary(id, A), 1, 5, 377, a2.id, 'Deleting newest available chapter may move date backwards');
    await restoreDeletedWriting(bundle);
    expectSummary(await summary(id, A), 2, 8, FUTURE, a1.id, 'Native restoration must restore saved chapter date');
    await db.writings.bulkDelete([a1.id, a2.id]);
    expectSummary(await summary(id, A), 0, 0, null, null, 'Empty book must not substitute catalogue creation/update dates');
    return ['Independent available-set date oracle: deterministic ties, literal future ISO source, organization versus document archive and empty null'];
  } finally { await deleteProject(id); }
}

export async function reviewManuscriptHomeLibraryRetargetAndIso(): Promise<string[]> {
  const id = 'review-home-library-context', otherId = `${id}-other`, host = document.createElement('div');
  document.body.append(host); const root = createRoot(host);
  try {
    const first = await seed(id), second = await seed(otherId); useLocaleStore.setState({ locale: 'en', loaded: true });
    const render = async (projectId: string, rows: Writing[], eraId?: string) => {
      await act(async () => { root.render(<ManuscriptsPanel projectId={projectId} writings={rows} eraId={eraId} onOpen={() => undefined} onClose={() => undefined} />); await pause(); });
    };
    const row = (title: string) => [...host.querySelectorAll('li')].find(node => node.querySelector('h2')?.textContent === title);
    await render(id, [{ ...first.a1, updatedAt: FUTURE }, first.a2, first.b]);
    await settle(() => !!row(first.project.manuscriptCatalog!.entries[0].title), 'First project library did not load');
    const firstRow = row(first.project.manuscriptCatalog!.entries[0].title)!;
    assert(firstRow.querySelector('time')?.dateTime === new Date(FUTURE).toISOString() && firstRow.textContent?.includes('Chapters last updated'), 'Library lacks honest ISO future chapter label');
    const baseImage = firstRow.querySelector('img')?.getAttribute('src');
    await render(id, [{ ...first.a1, updatedAt: Number.MAX_SAFE_INTEGER }, first.a2, first.main]);
    await settle(() => !!row(first.project.manuscriptCatalog!.entries[0].title)?.textContent?.includes('Date unavailable'), 'Out-of-range imported date must have controlled unavailable state');
    const unavailable = row(first.project.manuscriptCatalog!.entries[0].title)!;
    assert(!unavailable.querySelector('time') && unavailable.textContent?.includes('2 chapters'), 'Invalid calendar date crashed or discarded available chapter counts');
    assert(row(first.project.title)?.querySelector('time')?.dateTime === new Date(101).toISOString(), 'Invalid A date suppressed valid neighbouring main date');
    await render(id, [first.a1], 'past');
    await settle(() => row(first.project.manuscriptCatalog!.entries[0].title)?.querySelector('time')?.dateTime === new Date(211).toISOString(), 'Era context did not replace effective dates');
    const eraImage = row(first.project.manuscriptCatalog!.entries[0].title)?.querySelector('img')?.getAttribute('src');
    assert(baseImage && eraImage && baseImage !== eraImage && decodeURIComponent(eraImage).includes('#872f41'), 'Era thumbnail retained Base cover instead of canonical era projection');
    useLocaleStore.setState({ locale: 'es', loaded: true });
    await render(otherId, [{ ...second.b, updatedAt: 701 }, first.a1]);
    await settle(() => !!row(second.project.manuscriptCatalog!.entries[0].title), 'Project retarget did not replace catalogue');
    const empty = row(second.project.manuscriptCatalog!.entries[0].title)!;
    assert(!empty.querySelector('time') && empty.textContent?.includes('Sin capítulos disponibles') && host.textContent?.includes('Última edición de capítulos'), 'Retarget counted a foreign row or faked empty date');
    assert(![...host.querySelectorAll('h2')].some(node => node.textContent === first.project.manuscriptCatalog!.entries[0].title), 'Settled library retained old project metadata');
    return ['Independent React library oracle: future ISO, controlled out-of-range date, era cover/date retarget, project/locale retarget and foreign-row exclusion'];
  } finally { await act(async () => root.unmount()); host.remove(); await deleteProject(id); await deleteProject(otherId); }
}

export async function reviewManuscriptHomeLatestChapterUi(): Promise<string[]> {
  const id = 'review-home-latest-ui', host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    const data = await seed(id); useLocaleStore.setState({ locale: 'en', loaded: true });
    await act(async () => { root.render(<MemoryRouter initialEntries={[`/project/${id}/writings?manuscript=${A}`]}><WritingsView projectId={id} writings={data.rows} onAdd={async () => undefined} onEdit={async () => undefined} onDelete={async () => undefined} /></MemoryRouter>); await pause(); });
    await settle(() => !!host.querySelector('[aria-label="Manuscript overview"]'), 'Home summary not mounted on normal list');
    const overview = host.querySelector('[aria-label="Manuscript overview"]')!;
    assert(overview.textContent?.includes('A AUTHOR') && overview.textContent.includes('A BLURB ONLY') && overview.textContent.includes('2 chapters') && overview.textContent.includes('8 words'), 'Home lost own metadata or used only current status tab');
    assert(overview.querySelector('time')?.dateTime === new Date(377).toISOString(), 'Overview chose world/catalogue/B timestamp');
    const open = [...overview.querySelectorAll('button')].find(node => node.textContent?.trim() === 'Open last edited chapter'); assert(open, 'Latest own chapter action absent');
    await act(async () => { open.click(); await pause(); });
    await settle(() => !!host.querySelector('.ProseMirror[contenteditable="true"]'), 'Latest chapter did not use real normal editor');
    assert([...host.querySelectorAll('input')].some(node => node.value === data.a2.title), 'Latest action opened B or a Drafts-only chapter instead of available finished A2');
    assert((await db.writings.get(data.b.id))?.updatedAt === data.b.updatedAt && (await db.writings.get(data.a2.id))?.updatedAt === 377, 'Opening the normal editor edited chapter row or neighbour');
    return ['Independent React home oracle: all-status summary opens exact latest owned finished chapter through normal editor without editing rows'];
  } finally { await act(async () => root.unmount()); host.remove(); await deleteProject(id); }
}
