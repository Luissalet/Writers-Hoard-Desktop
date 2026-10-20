import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { BookOpen, Languages } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { db } from '@/db';
import type { EngineDefinition } from '@/engines/_types';
import WritingsEngine from '@/engines/writings/WritingsEngine';
import DictionaryEngine from '@/engines/dictionary/DictionaryEngine';
import ProjectWorkspace from '@/components/project/workspace/ProjectWorkspace';
import { dictionaryDrafts } from '@/engines/dictionary/drafts';
import { emptyWord } from '@/engines/dictionary/types';
import { useLocaleStore } from '@/stores/localeStore';
import { flushPendingWrites } from '@/services/pendingWrites';
import { writerContext } from '@/services/copilot/faustusContext';
import '@/engines/writings';
import '@/engines/dictionary';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
export async function testProjectWorkspaceEngines(): Promise<string[]> {
  const P = `pane-engines-${Date.now()}`, W1 = `${P}-first`, W2 = `${P}-second`, root = createRoot(document.getElementById('root')!), passed: string[] = [];
  let rejectWrites: (() => never) | undefined;
  useLocaleStore.setState({ locale: 'en' });
  const node = <T extends Element = HTMLElement>(id: string): T => { const found = document.querySelector<T>(`[data-testid="${id}"]`); assert(found, `Missing ${id}`); return found; };
  const main = () => node('workspace-primary');
  const active = () => { const found = document.querySelector<HTMLElement>('[data-testid^="workspace-panel-"]:not([hidden])'); assert(found, 'Missing active companion'); return found; };
  const click = async (control: HTMLElement | string) => act(async () => { (typeof control === 'string' ? node<HTMLElement>(control) : control).click(); await pause(140); });
  const waitFor = async (test: () => boolean | Promise<boolean>, message: string) => { for (let i = 0; i < 150; i++) { if (await test()) return; await act(async () => { await pause(); }); } throw new Error(message); };
  const change = async (control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) => act(async () => { const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(); });
  const editor = (container: Element) => { const dom = container.querySelector('.ProseMirror') as HTMLElement & { editor?: Editor }; assert(dom?.editor, 'Missing real chapter editor'); return dom.editor; };
  const engines: EngineDefinition[] = [
    { id: 'writings', name: 'Writings', description: '', category: 'core', icon: BookOpen, tables: {}, component: WritingsEngine },
    { id: 'dictionary', name: 'Languages', description: '', category: 'creative', icon: Languages, tables: {}, component: DictionaryEngine },
  ];
  function Harness() { const route = useLocation(); return <><output data-testid="actual-main-location">{route.pathname}{route.search}</output><ProjectWorkspace projectId={P} engines={engines}><WritingsEngine projectId={P} /></ProjectWorkspace></>; }
  const addWritingTab = async (writingId: string) => {
    await change(node<HTMLSelectElement>('workspace-engine-choice'), 'writings'); await click('workspace-add-tab');
    await waitFor(() => !![...active().querySelectorAll('button')].find(item => item.textContent?.includes(writingId === W1 ? 'Harbour chapter' : 'Forest chapter')), 'Companion manuscript list missing');
    const button = [...active().querySelectorAll<HTMLButtonElement>('button')].find(item => item.className.includes('flex-1') && item.textContent?.includes(writingId === W1 ? 'Harbour chapter' : 'Forest chapter')); assert(button, 'Chapter list button'); await click(button);
    await waitFor(() => !!active().querySelector('.ProseMirror'), 'Companion chapter did not open');
    return active().dataset.enginePaneId!;
  };
  try {
    await db.projects.put({ id: P, title: 'Pane engine integration', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['writings', 'dictionary', 'codex'], engineOrder: ['writings', 'dictionary', 'codex'], createdAt: 1, updatedAt: 1, dictionaries: [{ id: `${P}-language`, name: 'Silver Tongue', description: '', scriptMapping: '', detectInManuscript: false, words: [{ ...emptyWord(), word: 'shara', meaning: 'dawn' }] }] });
    await db.codexEntries.put({ id: `${P}-nora`, projectId: P, type: 'character', title: 'Nora', fields: {}, content: '<p>A navigator.</p>', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    await db.writings.bulkPut([{ id: W1, projectId: P, title: 'Harbour chapter', content: '<p>Nora crossed the harbour.</p>', wordCount: 5, status: 'draft', tags: [], chapter: 1, createdAt: 1, updatedAt: 1 }, { id: W2, projectId: P, title: 'Forest chapter', content: '<p>Nora entered the forest.</p>', wordCount: 5, status: 'draft', tags: [], chapter: 2, createdAt: 1, updatedAt: 1 }]);
    await act(async () => { root.render(<MemoryRouter initialEntries={[`/project/${P}/writings?writing=${W1}`]}><Harness /></MemoryRouter>); await pause(220); });
    await waitFor(() => !!main().querySelector('.ProseMirror'), 'Main chapter failed to open'); const primaryEditor = editor(main());
    await click('workspace-archive');
    await waitFor(() => !!document.querySelector('[role="dialog"] h2')?.textContent?.includes('Archive'), 'Archive is not reachable when its engine is disabled');
    const closeArchive = document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]'); assert(closeArchive, 'Archive modal close control'); await click(closeArchive);
    assert(editor(main()) === primaryEditor, 'Opening the always-available archive preserves the live primary editor');
    await click('workspace-open'); await waitFor(() => active().textContent?.includes('Silver Tongue') ?? false, 'Real dictionary did not mount beside the manuscript');
    const dictionaryPaneId = active().dataset.enginePaneId!;
    const newWord = [...active().querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === 'New word'); assert(newWord, 'Dictionary new word'); await click(newWord);
    await change(active().querySelector<HTMLInputElement>('form input')!, 'unsaved-star');
    const writingPaneId = await addWritingTab(W2);
    assert(editor(main()) === primaryEditor && primaryEditor.getText().includes('harbour') && node('actual-main-location').textContent?.includes(W1), 'Opening a different editable chapter in a companion tab preserves the live primary editor and route');
    assert(node(`workspace-tab-${writingPaneId}`).textContent?.includes('Forest chapter'), 'Companion tab identifies its actual open chapter');
    const secondEditor = editor(active()); await act(async () => { secondEditor.commands.focus('end'); secondEditor.commands.insertContent(' Local forest addition.'); await pause(100); });
    const context = await writerContext('test-space', P, 'writings', 'en');
    assert(context.active_objects[0]?.object_id === W2, `Copilot context resolves the focused companion editor rather than the primary chapter: ${JSON.stringify({ context, focused: secondEditor.isFocused, active: document.activeElement?.outerHTML.slice(0, 300), writingPaneId })}`);
    rejectWrites = () => { throw new Error('Expected companion save rejection'); }; db.writings.hook('updating', rejectWrites);
    await click('workspace-close');
    assert(document.querySelector('[data-testid="workspace-secondary"]') && secondEditor.getText().includes('Local forest addition') && document.querySelector('[role="alert"]')?.textContent?.includes('still open'), 'Rejected chapter save keeps every companion tab and the live chapter editor mounted');
    db.writings.hook('updating').unsubscribe(rejectWrites); rejectWrites = undefined;
    await act(async () => { assert((await flushPendingWrites()).ok, 'Companion chapter retry did not flush'); await pause(); });
    assert((await db.writings.get(W2))!.content.includes('Local forest addition') && (await db.writings.get(W1))!.content.includes('harbour'), 'Companion chapter saves to its own row through existing CAS persistence');
    await click(`workspace-tab-${dictionaryPaneId}`);
    assert(active().querySelector<HTMLInputElement>('form input')?.value === 'unsaved-star' && editor(main()) === primaryEditor, 'Returning to actual dictionary retains unfinished word form without rebuilding primary Tiptap');
    passed.push('Real engine panes: simultaneous manuscript/dictionary/chapter editing preserves instances, drafts, scoped rows, focused Copilot identity and failed-save retry');

    const samePaneId = await addWritingTab(W1), sameEditor = editor(active());
    const mention = active().querySelector<HTMLElement>('[data-wh-codex-mention]'); await waitFor(() => !!active().querySelector('[data-wh-codex-mention]'), 'Inline mention not decorated');
    await act(async () => { (mention ?? active().querySelector<HTMLElement>('[data-wh-codex-mention]')!).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(180); });
    assert(active().querySelector('[data-testid="reference-preview"]')?.textContent?.includes('Nora') && !main().querySelector('[data-testid="reference-preview"]'), `Same chapter inline reference opens only its originating pane consultation: ${JSON.stringify({ secondary: active().querySelector('[data-testid="reference-preview"]')?.textContent, primary: main().querySelector('[data-testid="reference-preview"]')?.textContent })}`);
    assert(node(`workspace-tab-${samePaneId}`).textContent?.includes('Harbour chapter'), 'Two document tabs retain distinct identity even when they show the same chapter');
    await act(async () => { primaryEditor.commands.insertContentAt(primaryEditor.state.doc.content.size - 1, ' Primary conflicting addition.'); sameEditor.commands.insertContentAt(sameEditor.state.doc.content.size - 1, ' Companion conflicting addition.'); await pause(100); });
    let flushed = true;
    await act(async () => { flushed = (await flushPendingWrites()).ok; await pause(150); });
    const content = (await db.writings.get(W1))!.content;
    assert(!flushed && (content.includes('Primary conflicting addition') !== content.includes('Companion conflicting addition')), 'Concurrent same-chapter edits use CAS: one commit wins and the competing draft cannot silently overwrite it');
    assert(primaryEditor.getText().includes('Primary conflicting addition') && sameEditor.getText().includes('Companion conflicting addition'), 'Both competing chapter texts remain intact in their own mounted editors');
    passed.push('Same chapter panes: unique reference scopes isolate consultations, and concurrent body edits reject stale CAS writes while keeping both drafts intact');
    return passed;
  } finally {
    if (rejectWrites) db.writings.hook('updating').unsubscribe(rejectWrites);
    await act(async () => { root.unmount(); await pause(); }); dictionaryDrafts(P).clear();
    await db.writings.where('projectId').equals(P).delete(); await db.codexEntries.where('projectId').equals(P).delete(); await db.writingSnapshots.where('projectId').equals(P).delete(); await db.projects.delete(P);
  }
}
