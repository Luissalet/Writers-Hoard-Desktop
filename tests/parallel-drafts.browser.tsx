import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Editor } from '@tiptap/react';
import { db } from '@/db';
import type { Writing } from '@/types';
import { t } from '@/i18n/useTranslation';
import { createParallelDraft, deleteParallelDraft, listParallelDraftMeta, loadPaneDocument, PaneConflictError, promoteParallelDraft, savePaneDocument } from '@/engines/writings/parallelDrafts';
import { mergeSeparateBlocks, ParallelEditorSession, paneJournalId } from '@/engines/writings/parallelSession';
import { listSnapshots, ensureSnapshot } from '@/engines/writings/snapshots';
import { inspectWritingRecoveryDraft } from '@/engines/writings/recoveryJournal';
import ParallelDraftWorkspace from '@/engines/writings/components/ParallelDraftWorkspace';
import WritingsEngine from '@/engines/writings/WritingsEngine';
import '@/engines/writings';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.search}</output>; }
function input(element: HTMLInputElement | HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

export async function testParallelDrafts(): Promise<string[]> {
  const passed: string[] = [], now = Date.now(), pid = `parallel-${now}`;
  const writing = (id: string, title: string, chapter: number): Writing => ({ id, projectId: pid, title, chapter, status: 'finished', tags: ['preserve'], synopsis: 'Preserve synopsis', content: '<p>First paragraph.</p><p>Second paragraph.</p>', wordCount: 4, worldDate: { year: 3, month: 2, day: 7 }, createdAt: now, updatedAt: now });
  const first = writing(`${pid}-one`, 'Across the salt marsh', 1), second = writing(`${pid}-two`, 'The empty observatory', 2);
  await db.projects.add({ id: pid, title: 'Parallel manuscript fixture', mode: 'novelist', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: now, updatedAt: now });
  await db.writings.bulkAdd([first, second]);
  const host = document.getElementById('root')!; let root: Root | null = null;
  const unmount = async () => { await act(async () => { root?.unmount(); root = null; await pause(); }); };
  const render = async (element: React.ReactNode, path = `/project/${pid}/writings`) => { await unmount(); await act(async () => { root = createRoot(host); root.render(<StrictMode><MemoryRouter initialEntries={[path]}><LocationProbe />{element}</MemoryRouter></StrictMode>); await pause(80); }); };
  const wait = async (what: string, predicate: () => boolean | Promise<boolean>) => { const end = Date.now() + 10000; while (Date.now() < end) { if (await predicate()) return; await act(async () => { await pause(40); }); } throw new Error(`Timed out: ${what}`); };
  const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label);
  const click = async (label: string, scope: ParentNode = document) => { const node = button(label, scope); assert(node, `Missing button ${label}`); await act(async () => { node.click(); await pause(50); }); };
  const editor = (side: string): Editor | undefined => (byId(`parallel-editor-${side}`)?.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null)?.editor;
  const choose = async (side: string, index: number, value: string) => { await act(async () => { input(byId(`parallel-${side}`)!.querySelectorAll('select')[index]!, value); await pause(50); }); };
  try {
    let current = await loadPaneDocument(pid, { writingId: first.id });
    const alternative = await createParallelDraft(current, 'A quieter arrival');
    let draft = await loadPaneDocument(pid, { writingId: first.id, draftId: alternative.id });
    await savePaneDocument(draft, '<p>Alternative arrival.</p>');
    assert((await db.writings.get(first.id))!.content === first.content, 'Editing alternative changed current manuscript');
    assert(!(await listSnapshots(first.id)).some(row => row.id === alternative.id), 'Mutable draft leaked into immutable history');
    const snap = await ensureSnapshot({ id: first.id, projectId: pid, title: first.title, content: '<p>Alternative arrival.</p>' }, 'manual');
    assert(snap.status === 'created', 'Mutable draft incorrectly suppressed immutable safety snapshot');
    draft = await loadPaneDocument(pid, { writingId: first.id, draftId: alternative.id });
    await savePaneDocument(draft, '<p>Newer draft body.</p>');
    let conflict = false;
    try { await savePaneDocument(draft, '<p>Rejected second editor.</p>'); } catch (error) { conflict = error instanceof PaneConflictError; }
    assert(conflict && (await listSnapshots(first.id)).some(row => row.content.includes('Rejected second editor')), 'Draft CAS did not preserve rejected text');
    const staleDraft = draft; draft = await loadPaneDocument(pid, draft);
    conflict = false;
    try { await promoteParallelDraft(pid, draft.draftId!, staleDraft.version, current.version); } catch (error) { conflict = error instanceof PaneConflictError; }
    assert(conflict && (await db.writings.get(first.id))!.content === first.content, 'Stale promotion overwrote current');
    await promoteParallelDraft(pid, draft.draftId!, draft.version, current.version);
    const promoted = (await db.writings.get(first.id))!;
    assert(promoted.content === draft.content && promoted.title === first.title && JSON.stringify(promoted.worldDate) === JSON.stringify(first.worldDate) && promoted.status === first.status && promoted.synopsis === first.synopsis, 'Promotion changed chapter metadata');
    assert((await listSnapshots(first.id)).some(row => row.content === first.content), 'Promotion failed to retain previous current text');
    await db.writings.update(first.id, { content: '<p>Unique current before failed safety write.</p>', updatedAt: promoted.updatedAt + 1 });
    const rejectSnapshot = () => { throw new Error('Injected snapshot failure'); };
    db.writingSnapshots.hook('creating', rejectSnapshot);
    let rejected = false;
    try { await promoteParallelDraft(pid, draft.draftId!, draft.version, promoted.updatedAt + 1); } catch { rejected = true; }
    finally { db.writingSnapshots.hook('creating').unsubscribe(rejectSnapshot); }
    assert(rejected && (await db.writings.get(first.id))!.content.includes('Unique current'), 'Promotion proceeded after safety snapshot failed');
    passed.push('draft storage: independent named prose, immutable history exclusion, CAS rejection copy and guarded promotion preserving metadata');

    current = await loadPaneDocument(pid, { writingId: second.id });
    const a = new ParallelEditorSession(current, 'session-a'), b = new ParallelEditorSession(current, 'session-b');
    a.change('<p>First by editor A.</p><p>Second paragraph.</p>');
    b.change('<p>First paragraph.</p><p>Second by editor B.</p>');
    assert(await a.flush(), 'First concurrent pane failed');
    assert(!await b.flush() && b.state.status === 'conflict', 'Second concurrent pane silently overwrote first');
    assert(await b.keepMine(true), 'Separate paragraph merge failed');
    assert((await db.writings.get(second.id))!.content === '<p>First by editor A.</p><p>Second by editor B.</p>', 'Merge lost one pane text');
    assert(mergeSeparateBlocks('<p>A</p>', '<p>B</p>', '<p>C</p>') === null, 'Competing paragraph edits merged without consent');
    a.dispose(); b.dispose();
    passed.push('two-pane CAS: both texts retained, explicit disjoint paragraph merge and ambiguous edits remain conflicts');

    current = await loadPaneDocument(pid, { writingId: second.id });
    const fail = async () => { throw new Error('Injected disk failure'); };
    const failed = new ParallelEditorSession(current, 'recovery-test', fail);
    failed.change('<p>Unsaved during failure.</p>'); assert(!await failed.flush(), 'Injected write failure passed'); failed.dispose();
    const journalId = paneJournalId('recovery-test', current);
    assert(inspectWritingRecoveryDraft({ id: journalId, projectId: pid, title: journalId, content: current.content }).kind === 'draft', 'Failed edit absent from journal');
    await savePaneDocument(current, '<p>External new current.</p>');
    const newer = await loadPaneDocument(pid, current);
    const reopened = new ParallelEditorSession(newer, 'recovery-test', fail);
    assert(reopened.state.status === 'conflict' && reopened.state.content.includes('Unsaved'), 'Conflicted recovery discarded text or rebased automatically'); reopened.dispose();
    const reopenedAgain = new ParallelEditorSession(newer, 'recovery-test', fail);
    assert(reopenedAgain.state.status === 'conflict', 'Repeated reopen turned conflict into blind autosave');
    assert(await reopenedAgain.useSaved(), 'Explicit saved-text recovery failed'); reopenedAgain.dispose();
    passed.push('recovery: failed writes journal synchronously; repeated reopen preserves old baseline until explicit resolution');

    await render(<WritingsEngine projectId={pid} />);
    await wait('normal chapter list', () => !![...document.querySelectorAll('button')].find(node => node.textContent?.includes(first.title)));
    await act(async () => { [...document.querySelectorAll('button')].find(node => node.textContent?.includes(first.title))!.click(); await pause(80); });
    await wait('canonical editor', () => !!button(t('writings.parallel.open')));
    assert(!byId('parallel-workspace'), 'First open unexpectedly replaced canonical editor');
    const canonical = (document.querySelector('.ProseMirror') as HTMLElement & { editor?: Editor }).editor!;
    await act(async () => { canonical.commands.setContent('<p>Unsaved canonical transition.</p>', { emitUpdate: true }); });
    await click(t('writings.parallel.open'));
    await wait('parallel canonical after flush', () => !!editor('left'));
    assert((await db.writings.get(first.id))!.content.includes('Unsaved canonical transition'), 'Opening workspace lost pending canonical edit');
    await act(async () => { input(byId('parallel-left')!.querySelector('input')!, 'The storm route'); });
    await click(t('writings.parallel.new'), byId('parallel-left')!);
    await wait('created alternative selected', () => !!editor('left') && !!byId('parallel-left')?.querySelector<HTMLSelectElement>('select:nth-of-type(1)') && !!new URLSearchParams(byId('location')!.textContent!).get('draft'));
    const uiDraftId = new URLSearchParams(byId('location')!.textContent!).get('draft')!;
    await act(async () => { editor('left')!.commands.setContent('<p>The storm arrived before dawn.</p><p>Every lantern went dark.</p>', { emitUpdate: true }); });
    await click(t('writings.parallel.split'));
    await wait('second independent editor', () => !!editor('right'));
    assert(editor('left') !== editor('right'), 'Split shares one editor/undo instance');
    await choose('right', 0, first.id);
    await wait('second pane canonical', () => !!editor('right') && byId('parallel-right')!.querySelectorAll('select')[0]!.value === first.id);
    await click(t('common.save'));
    assert((await db.writings.get(first.id))!.content.includes('Unsaved canonical transition'), 'Alternative autosave changed canonical');
    await click(t('writings.parallel.promote'), byId('parallel-left')!);
    await wait('promotion confirm', () => !!document.querySelector('[role="dialog"]'));
    await click(t('writings.parallel.promote'), document.querySelector('[role="dialog"]')!);
    await wait('promotion visible in second pane', () => !!editor('right')?.getText().includes('storm arrived'));
    assert((await db.writings.get(first.id))!.title === first.title, 'UI promotion changed chapter title');
    passed.push('actual manuscript UI: canonical first open, pending edit flush, named alternative, independent split editors and confirmed promotion');

    await choose('right', 1, uiDraftId);
    await wait('same draft in both panes', () => !!editor('right') && byId('parallel-right')!.querySelectorAll('select')[1]!.value === uiDraftId);
    await act(async () => {
      editor('left')!.commands.setContent('<p>Left changed the opening.</p><p>Every lantern went dark.</p>', { emitUpdate: true });
      editor('right')!.commands.setContent('<p>The storm arrived before dawn.</p><p>Right changed the ending.</p>', { emitUpdate: true });
    });
    await click(t('common.save'));
    await wait('visible concurrent-edit conflict', () => !!button(t('writings.parallel.merge')));
    await click(t('writings.parallel.merge'));
    await wait('merged prose appears in both panes', () => !!editor('left')?.getText().includes('Right changed') && !!editor('right')?.getText().includes('Left changed'));
    passed.push('actual same-draft split: explicit conflict and paragraph merge preserve both editors');

    await act(async () => { editor('left')!.commands.setTextSelection(8); });
    await choose('left', 1, '');
    await wait('current version switched', () => !!editor('left') && byId('parallel-left')!.querySelectorAll('select')[1]!.value === '');
    await act(async () => { editor('left')!.commands.insertContent(' current-only'); });
    await choose('left', 1, uiDraftId);
    await wait('draft restored', () => !!editor('left') && byId('parallel-left')!.querySelectorAll('select')[1]!.value === uiDraftId);
    assert(!editor('left')!.getText().includes('current-only') && editor('left')!.state.selection.from === 8, 'Swap mixed prose/selection between versions');
    await act(async () => { editor('left')!.commands.undo(); });
    assert(editor('left')!.getText().includes('Left changed'), 'Undo crossed a document boundary');
    await unmount();
    await render(<WritingsEngine projectId={pid} />, `/project/${pid}/writings?workspace=drafts&writing=${first.id}&draft=${uiDraftId}&compareWriting=${second.id}`);
    await wait('deep link alternatives', () => !!editor('left') && !!editor('right') && byId('parallel-left')!.querySelectorAll('select')[1]!.value === uiDraftId);
    await click(t('writings.parallel.back'));
    await wait('canonical editor restored', () => !byId('parallel-workspace') && !!button(t('writings.parallel.open')));
    assert(!byId('location')!.textContent!.includes('workspace='), 'Back left a stale workspace deep link');
    passed.push('navigation: switches flush pending writes, restore document selection, isolate undo, and accept deep links into both panes');

    await unmount();
    await render(<ParallelDraftWorkspace projectId={pid} start={{ writingId: first.id, draftId: uiDraftId }} onClose={async () => {}} />);
    await wait('failure fixture editor', () => !!editor('left'));
    const rejectDraftUpdate = (_changes: unknown, key: unknown) => { if (key === uiDraftId) throw new Error('Injected alternative write failure'); };
    db.writingSnapshots.hook('updating', rejectDraftUpdate);
    try {
      await act(async () => { editor('left')!.commands.setContent('<p>Recovered from an actual pane failure.</p>', { emitUpdate: true }); });
      await click(t('common.save'));
      await wait('actual write failure displayed', () => !!button(t('writings.parallel.retry')));
      await choose('left', 1, '');
      assert(byId('parallel-left')!.querySelectorAll('select')[1]!.value === uiDraftId && editor('left')!.getText().includes('actual pane failure'), 'Failed write allowed a destructive document swap');
      await unmount();
      await render(<ParallelDraftWorkspace projectId={pid} start={{ writingId: first.id, draftId: uiDraftId }} onClose={async () => {}} />);
      await wait('actual pane journal recovery', () => !!editor('left')?.getText().includes('actual pane failure'));
      assert(byId('parallel-left')!.textContent!.includes(t('writings.parallel.recovered')), 'Reopen did not identify recovered text');
    } finally { db.writingSnapshots.hook('updating').unsubscribe(rejectDraftUpdate); }
    await click(t('common.save'));
    await wait('recovered actual pane saved', async () => (await db.writingSnapshots.get(uiDraftId))!.content.includes('actual pane failure'));
    await unmount();
    passed.push('actual UI failure: failed persistence blocks switching; unmount/reopen recovers pane text and a retry saves it');

    const disposable = await createParallelDraft(await loadPaneDocument(pid, { writingId: second.id }), 'Disposable branch');
    const disposableDoc = await loadPaneDocument(pid, { writingId: second.id, draftId: disposable.id });
    await savePaneDocument(disposableDoc, '<p>Last branch text remains recoverable.</p>');
    await deleteParallelDraft(await loadPaneDocument(pid, disposableDoc));
    assert(!(await listParallelDraftMeta(pid, second.id)).some(row => row.id === disposable.id) && (await listSnapshots(second.id)).some(row => row.content.includes('Last branch text')), 'Deleting alternative lost last prose');
    passed.push('deletion retains final alternative in immutable version history');
    const beforeZip = await loadPaneDocument(pid, { writingId: first.id, draftId: uiDraftId });
    const archive = await createProjectZipArchive(pid);
    await db.writingSnapshots.delete(uiDraftId);
    await importProjectZip(new File([archive.blob], 'parallel-drafts.zip'), { replaceProjectIds: [pid] });
    const afterZip = await loadPaneDocument(pid, { writingId: first.id, draftId: uiDraftId });
    assert(afterZip.content === beforeZip.content && afterZip.draftName === beforeZip.draftName && afterZip.version === beforeZip.version, 'ZIP restore lost alternative identity, name or content');
    passed.push('real project ZIP restore preserves mutable alternatives, names, versions and chapter associations');
    return passed;
  } finally { await unmount(); await db.writingSnapshots.where('projectId').equals(pid).delete(); await db.writings.where('projectId').equals(pid).delete(); await db.projects.delete(pid); }
}

export async function previewParallelDrafts() {
  const now = Date.now(), pid = 'parallel-preview';
  await db.projects.put({ id: pid, title: 'The Cartographer’s Debt', mode: 'novelist', type: 'standalone', color: '#000', description: '', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: now, updatedAt: now });
  const first: Writing = { id: 'parallel-preview-one', projectId: pid, title: 'Across the salt marsh', chapter: 1, status: 'draft', tags: [], content: '<h2>Across the salt marsh</h2><p>The tide had erased the road before Mara reached the causeway. Beyond the reeds, three lanterns moved against the wind.</p><p>She knew the signal. She had drawn it herself, in the margin of a map no one was meant to find.</p>', wordCount: 46, createdAt: now, updatedAt: now };
  await db.writings.put(first);
  const existing = await listParallelDraftMeta(pid, first.id);
  const draft = existing[0] ?? await createParallelDraft(await loadPaneDocument(pid, { writingId: first.id }), 'A quieter arrival');
  const doc = await loadPaneDocument(pid, { writingId: first.id, draftId: draft.id });
  await savePaneDocument(doc, '<h2>A quieter arrival</h2><p>Mara waited until the last lantern disappeared. The marsh settled around her, black water reflecting a sky without stars.</p><p>In her coat pocket, the map was warm. That was new.</p>');
  const host = document.getElementById('root')!;
  createRoot(host).render(<MemoryRouter><ParallelDraftWorkspace projectId={pid} start={{ writingId: first.id, draftId: draft.id, compareWritingId: first.id }} onClose={async () => {}} /></MemoryRouter>);
  await pause(600);
}

