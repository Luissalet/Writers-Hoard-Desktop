import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import type { CodexEntry, Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { CodexBlock } from '@/components/editor/codexBlocks/CodexBlock';
import { hydrateCodexBlocks } from '@/components/editor/codexBlocks/reading';
import { blockMatchesProject, codexBlockPreview, localAvatar } from '@/components/editor/codexBlocks/model';
import { BookDocument, ChapterHeadingNode } from '@/components/editor/chapterHeading/ChapterHeadingNode';
import { CHAPTER_HEADING_NAME, chapterBlocks } from '@/components/editor/chapterHeading/chapterBlocks';
import { chapterHeadingHtml, splitBookDoc } from '@/engines/writings/bookDocument';
import { advancedHtmlForInterchange, normalizeAdvancedHtml } from '@/components/editor/advanced/interchange';
import { clearWritingRecoveryDraft, inspectWritingRecoveryDraft, writeWritingRecoveryDraft } from '@/engines/writings/recoveryJournal';
import { OPEN_CODEX_REFERENCE, type OpenCodexReferenceDetail } from '@/services/codexReference/inlineMentions';
const P = 'test-live-codex-blocks', Q = `${P}-other`, E = `${P}-entry`, F = `${P}-foreign`;
const pause = () => new Promise(resolve => setTimeout(resolve, 45));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function setValue(input: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }
export async function testCodexLiveBlocks(): Promise<string[]> {
  const host = document.getElementById('root'); assert(host, 'Missing root'); const root = createRoot(host); const passed: string[] = [];
  const project: Project = { id: P, title: 'World', description: '', mode: 'custom', type: 'standalone', color: '#000', status: 'draft', enabledEngines: ['codex', 'writings'], engineOrder: ['codex', 'writings'], createdAt: 1, updatedAt: 1 };
  const entry: CodexEntry = { id: E, projectId: P, title: 'Salt Desert', type: 'location', fields: { aliases: '["The Expanse"]', climate: 'Dry local climate', detail: 'x'.repeat(400) }, content: '<p>Distinct source body stays local.</p>', tags: [], relations: [], avatar: 'https://example.invalid/should-not-load.png', createdAt: 1, updatedAt: 1 };
  const foreign: CodexEntry = { ...entry, id: F, projectId: Q, title: 'Private foreign title', content: '<p>ForeignSecretBody</p>' };
  useLocaleStore.setState({ locale: 'en', loaded: true });
  let editor: Editor | null = null; const emitted: string[] = [];
  const ready = (value: Editor | null) => { editor = value; };
  const render = async (key: string, content = '<p>Before prose.</p><p>After prose.</p>', projectId: string | null = P) => { await act(async () => { root.render(<StrictMode><MemoryRouter><TiptapEditor key={key} content={content} onChange={html => emitted.push(html)} onEditorReady={ready} referenceContext={projectId ? { projectId, scopeId: 'test-scope' } : undefined} /></MemoryRouter></StrictMode>); await pause(); }); await act(async () => { await pause(); }); };
  const wait = async (label: string, condition: () => boolean) => { const end = Date.now() + 5000; while (!condition() && Date.now() < end) await act(async () => { await pause(); }); assert(condition(), `Timeout: ${label}`); };
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label);
  const click = async (node: HTMLElement | null | undefined, label: string) => { assert(node, `Missing ${label}`); await act(async () => { node.click(); await pause(); }); await act(async () => { await pause(); }); };
  const view = () => host.querySelector('[data-wh-codex-live-view]');
  try {
    await db.projects.bulkPut([project, { ...project, id: Q }]); await db.codexEntries.bulkPut([entry, foreign]);
    await render('first'); await wait('editor', () => !!editor && !!button('Insert live Codex reference'));
    await click(host.querySelector('[data-editor-document-tools] > summary'), 'open document tools');
    assert(!host.querySelector('[data-codex-block-controls] input'), 'Insertion panel should start collapsed');
    await act(async () => { editor!.commands.setTextSelection(4); }); await click(button('Insert live Codex reference'), 'open collapsed insertion tools');
    const search = host.querySelector<HTMLInputElement>('[aria-label="Find entry"]')!; await act(async () => { setValue(search, 'The Expanse'); await pause(); });
    const pick = [...host.querySelectorAll<HTMLButtonElement>('[data-codex-block-controls] li button')].find(node => node.textContent?.includes(entry.title)); await click(pick, 'insert by imported alias');
    await wait('live preview', () => !!view()?.textContent?.includes('Distinct source body stays local.'));
    assert(editor!.getHTML().includes('data-wh-codex-block="true"') && editor!.getText().includes('[Codex: Salt Desert]'), 'Missing pointer or text export fallback');
    assert(!editor!.getHTML().includes('Distinct source body') && !editor!.getHTML().includes('Dry local climate') && !editor!.getHTML().includes('should-not-load'), 'Live preview leaked body/fields/avatar into saved prose'); assert(!view()?.querySelector('img'), 'Remote image source loaded in a local block');
    assert(!view()?.textContent?.includes('The Expanse') && view()?.textContent?.includes('Dry local climate'), 'Aliases should not crowd projected fields');
    const inserted = editor!.getHTML(); await act(async () => { assert(editor!.commands.undo(), 'Insertion has undo'); }); assert(!editor!.getHTML().includes('data-wh-codex-block'), 'Undo kept live node'); await act(async () => { assert(editor!.commands.redo(), 'Insertion has redo'); }); await wait('redo live preview', () => !!view()?.textContent?.includes(entry.title)); assert(editor!.getHTML() === inserted, 'Redo changed surrounding prose or pointer'); passed.push('collapsed alias picker inserts a live atomic reference, meaningful serialization, undo/redo and no duplicated source prose');
    const beforeLiveChange = emitted.length;
    await act(async () => { await db.codexEntries.update(E, { title: 'Renamed Desert', fields: { climate: 'Updated local climate' }, content: '<p>Updated source body.</p>' }); await pause(); });
    await wait('live source change', () => !!view()?.textContent?.includes('Renamed Desert') && !!view()?.textContent?.includes('Updated source body.'));
    assert(emitted.length === beforeLiveChange && editor!.getHTML() === inserted, 'Live projection rewrote host prose/history');
    let opened: OpenCodexReferenceDetail | null = null; const listener = (event: Event) => { opened = (event as CustomEvent<OpenCodexReferenceDetail>).detail; opened.handled = true; }; window.addEventListener(OPEN_CODEX_REFERENCE, listener);
    try { await click(button('Open entry'), 'open live source'); assert(opened && (opened as OpenCodexReferenceDetail).projectId === P && (opened as OpenCodexReferenceDetail).entryId === E && (opened as OpenCodexReferenceDetail).scopeId === 'test-scope', 'Reference activation lost project/scope'); } finally { window.removeEventListener(OPEN_CODEX_REFERENCE, listener); }
    passed.push('source edits refresh live without host edits, and entry activation respects the scoped ReferencePanel event');
    writeWritingRecoveryDraft(P, 'writing', 'Chapter', inserted, 'Chapter', '<p>Before prose.</p>');
    const recovery = inspectWritingRecoveryDraft({ id: 'writing', projectId: P, title: 'Chapter', content: '<p>Before prose.</p>' }); assert(recovery.kind === 'draft' && recovery.draft.content.includes('data-entry-id'), 'Crash recovery dropped live pointer');
    const portable = advancedHtmlForInterchange(inserted); assert(portable.includes('Codex: Salt Desert') && portable.includes('data-entry-id') && !portable.includes('Updated source body'), 'Document fallback did not remain portable');
    await render('recovered', normalizeAdvancedHtml(recovery.draft.content)); await wait('recovered live preview', () => !!view()?.textContent?.includes('Renamed Desert'));
    await act(async () => { await db.codexEntries.delete(E); await pause(); }); await wait('missing target', () => !!view()?.textContent?.includes('linked entry is unavailable')); assert(!button('Open entry'), 'Missing target offers a live action');
    await act(async () => { await db.codexEntries.put(entry); await pause(); }); await wait('restored target', () => !!view()?.textContent?.includes(entry.title)); passed.push('writing recovery and document interchange retain pointers; deleted/restored entries render honestly');
    assert(!editor!.commands.insertCodexLiveBlock({ projectId: Q, entryId: F, label: foreign.title }), 'Command admitted foreign project pointer');
    await render('foreign', `<p>Local prose.</p><aside data-wh-codex-block="true" data-project-id="${Q}" data-entry-id="${F}" data-label="${foreign.title}"><p>Fallback</p></aside>`);
    await wait('foreign blocked', () => !!view()?.textContent?.includes('another project')); assert(!view()?.textContent?.includes(foreign.title) && !view()?.textContent?.includes('ForeignSecretBody') && !button('Open entry'), 'Foreign source leaked through live projection');
    await render('no-context', inserted, null); await wait('context unavailable', () => !!view()?.textContent?.includes('no local context')); assert(!view()?.textContent?.includes(entry.title), 'Unscoped editor resolves project data');
    await render('changing-context', inserted); await wait('initial context', () => !!view()?.textContent?.includes(entry.title));
    await render('changing-context', inserted, Q); await wait('live context change', () => !!view()?.textContent?.includes('another project')); assert(!view()?.textContent?.includes(entry.title), 'Changing host scope kept stale source data');
    await render('wrong-record', `<aside data-wh-codex-block="true" data-project-id="${P}" data-entry-id="${F}" data-label="Forged"><p>Fallback</p></aside>`); await wait('wrong-project record missing', () => !!view()?.textContent?.includes('linked entry is unavailable')); assert(!view()?.textContent?.includes('ForeignSecretBody'), 'Forged same-project attrs leaked foreign record');
    assert(!blockMatchesProject({ projectId: Q, entryId: E }, { projectId: P }) && !localAvatar('data:image/svg+xml;base64,PHN2Zz4='), 'Scope or raster image policy weakened'); const preview = codexBlockPreview({ ...entry, fields: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`field${i}`, 'x'.repeat(1000)])), content: '<p>' + 'z'.repeat(5000) + '</p>' }); assert(preview.fields.length === 5 && preview.fields.every(([, value]) => value.length === 200) && preview.text.length === 600, 'Preview limits not applied'); passed.push('foreign/missing scope and forged target IDs cannot read other projects; previews are bounded and raster-only');
    const readHost = document.createElement('div'); readHost.innerHTML = inserted + `<aside data-wh-codex-block="true" data-project-id="${P}" data-entry-id="${F}" data-label="${foreign.title}"><p>Stale fallback</p></aside>`; document.body.append(readHost);
    const disposeReading = hydrateCodexBlocks(readHost, P, 'Unavailable local entry');
    try {
      await wait('reader current projection', () => readHost.textContent?.includes(entry.title) === true);
      assert(!readHost.textContent?.includes(foreign.title) && !readHost.textContent?.includes('ForeignSecretBody') && !readHost.querySelector('img'), 'Read-only projection leaked foreign source or remote image');
      await act(async () => { await db.codexEntries.update(E, { title: 'Current reader title' }); await pause(); });
      await wait('reader live update', () => readHost.textContent?.includes('Current reader title') === true);
      disposeReading(); const stopped = readHost.innerHTML;
      await act(async () => { await db.codexEntries.update(E, { title: 'After reader closed' }); await pause(); });
      assert(readHost.innerHTML === stopped, 'Read-only projection subscription survived close');
      passed.push('read-only Codex blocks: current scoped projection, foreign/remote exclusion, live updates and unsubscribe');
    } finally { disposeReading(); readHost.remove(); }
    const bookHost = document.createElement('div'); document.body.appendChild(bookHost);
    const book = new Editor({ element: bookHost, extensions: [StarterKit.configure({ document: false }), BookDocument, ChapterHeadingNode.configure({ nodeView: false }), CodexBlock.configure({ nodeView: false, context: () => ({ projectId: P }) })], content: chapterHeadingHtml({ id: 'one', title: 'One', chapter: 1 }) + '<p>First chapter.</p>' + chapterHeadingHtml({ id: 'two', title: 'Two', chapter: 2 }) + '<p>Second chapter.</p>' });
    try {
      const initial = book.getHTML(), before = splitBookDoc(book.state.doc, book.schema); const blocks = chapterBlocks(book.state.doc, book.schema.nodes[CHAPTER_HEADING_NAME]); const first = blocks.find(block => block.writingId === 'one')!, second = blocks.find(block => block.writingId === 'two')!;
      book.commands.setTextSelection(first.headingPos! + 1); assert(!book.commands.insertCodexLiveBlock({ projectId: P, entryId: E, label: entry.title }), 'Insertion split a chapter title'); assert(book.getHTML() === initial, 'Rejected title insertion mutated book');
      book.commands.setTextSelection({ from: first.headingPos! + book.state.doc.nodeAt(first.headingPos!)!.nodeSize + 1, to: second.headingPos! + 2 }); assert(!book.commands.insertCodexLiveBlock({ projectId: P, entryId: E, label: entry.title }), 'Insertion replaced a chapter boundary');
      book.commands.setTextSelection(first.headingPos! + book.state.doc.nodeAt(first.headingPos!)!.nodeSize + 2); assert(book.commands.insertCodexLiveBlock({ projectId: P, entryId: E, label: entry.title }), 'Book prose insertion rejected');
      const after = splitBookDoc(book.state.doc, book.schema); assert(after.map(section => section.writingId).join() === before.map(section => section.writingId).join() && after.map(section => section.title).join() === before.map(section => section.title).join(), 'Book chapter identities changed'); assert(after.find(section => section.writingId === 'one')?.html.includes('data-wh-codex-block') && after.find(section => section.writingId === 'two')?.html === before.find(section => section.writingId === 'two')?.html, 'Live block crossed chapter during split'); book.commands.undo(); assert(book.getHTML() === initial, 'Book undo did not restore exactly');
    } finally { book.destroy(); bookHost.remove(); }
    passed.push('real BookDocument rejects title/boundary insertion and preserves separate chapter identities, splitting and undo');
  } finally { await act(async () => { root.unmount(); }); clearWritingRecoveryDraft(P, 'writing'); await db.codexEntries.bulkDelete([E, F]); await db.projects.bulkDelete([P, Q]); }
  return passed;
}
