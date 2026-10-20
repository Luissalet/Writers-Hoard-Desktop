import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { insertCodexTextLink } from '@/components/editor/codexBlocks/inlineLinks';
import { OPEN_CODEX_REFERENCE, type OpenCodexReferenceDetail } from '@/services/codexReference/inlineMentions';
import { buildReaderHtml } from '@/engines/writings/readerExport';
import { defaultReaderPresentation } from '@/engines/writings/readerPresentation';
import { loadWorldWikiData, buildWorldWiki } from '@/services/worldWikiExport';
import { BookDocument, ChapterHeadingNode } from '@/components/editor/chapterHeading/ChapterHeadingNode';
import { chapterHeadingHtml } from '@/engines/writings/bookDocument';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project, Writing } from '@/types';
const pause = () => new Promise(resolve => setTimeout(resolve, 45));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function testCodexTextLinks() {
  const P = `codex-text-${Date.now()}`, E = `${P}-entry`, host = document.getElementById('root')!, root = createRoot(host); let editor: Editor | null = null, clone: string | undefined;
  const ready = (value: Editor | null) => { editor = value; }, passed: string[] = [];
  const project: Project = { id: P, title: 'Synthetic world', description: '', type: 'standalone', mode: 'custom', status: 'draft', color: '#aaa', enabledEngines: ['codex','writings'], engineOrder: ['codex','writings'], createdAt: 1, updatedAt: 1 };
  try {
    useLocaleStore.setState({ locale: 'en' }); await db.projects.put(project);
    await db.codexEntries.add({ id: E, projectId: P, title: 'Harbor of Salt', type: 'location', fields: { aliases: '["The port"]' }, content: '<p>Current local source.</p>', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    await act(async () => { root.render(<MemoryRouter><TiptapEditor content="<p>The city sleeps.</p>" onChange={() => undefined} referenceContext={{ projectId: P, scopeId: 'text-link-test' }} onEditorReady={ready} /></MemoryRouter>); await pause(); });
    for (let i = 0; i < 100 && !host.querySelector('[data-codex-block-controls]'); i++) await act(async () => { await pause(); });
    await act(async () => { host.querySelector<HTMLElement>('[data-editor-document-tools] > summary')!.click(); host.querySelector<HTMLButtonElement>('[data-codex-block-controls] button')!.click(); await pause(); });
    await act(async () => { const mode = host.querySelector<HTMLSelectElement>('[data-codex-block-controls] select')!; mode.value = 'text'; mode.dispatchEvent(new Event('change', { bubbles: true })); editor!.commands.setTextSelection({ from: 1, to: 9 }); await pause(); });
    for (let i = 0; i < 100 && !host.querySelector('[data-codex-block-controls] li button'); i++) await act(async () => { await pause(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-codex-block-controls] li button')!.click(); await pause(); });
    assert(editor!.getText() === 'The city sleeps.' && editor!.getHTML().includes(`/project/${P}/codex?entry=${E}`) && !editor!.getHTML().includes('data-wh-codex-block'), 'Text link must preserve selected custom prose and use a semantic scoped URL');
    let opened = false; const listen = (event: Event) => { const detail = (event as CustomEvent<OpenCodexReferenceDetail>).detail; opened = detail.entryId === E && detail.projectId === P && detail.scopeId === 'text-link-test'; detail.handled = true; };
    window.addEventListener(OPEN_CODEX_REFERENCE, listen); try { await act(async () => { host.querySelector<HTMLElement>('[data-wh-codex-mention]')!.click(); await pause(); }); } finally { window.removeEventListener(OPEN_CODEX_REFERENCE, listen); }
    assert(opened, 'Manual custom-text link must activate the same scoped reference panel event');
    const content = editor!.getHTML();
    await act(async () => { editor!.commands.undo(); await pause(); }); assert(!editor!.getHTML().includes('<a '), 'Text link must be undoable');
    await act(async () => { editor!.commands.redo(); await pause(); }); assert(editor!.getHTML() === content, 'Redo must retain exact text/link');
    assert(!insertCodexTextLink(editor!, P, { projectId: 'foreign', entryId: E, label: 'Foreign' }), 'Manual command must reject foreign host context');
    passed.push('Manual Codex text links: actual collapsed picker, custom selection, scoped activation, exact prose, undo/redo and foreign-context refusal');

    const writing: Writing = { id: `${P}-chapter`, projectId: P, title: 'The coast', content, wordCount: 3, status: 'draft', tags: [], createdAt: 1, updatedAt: 1 }; await db.writings.add(writing);
    const reader = await buildReaderHtml(project, [writing], defaultReaderPresentation(), 'en');
    assert(reader.html.includes('href="#codex-chapter-') && reader.html.includes('Current local source.') && !reader.html.includes(`href="/project/${P}`), 'Offline reader must resolve text links into its own bounded reference appendix');
    await db.codexEntries.add({ id: `${P}-host`, projectId: P, title: 'Host', type: 'concept', fields: {}, content, tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    const wiki = buildWorldWiki(await loadWorldWikiData(P), { locale: 'en' }); assert(wiki.html.includes('>The city</a>') && !wiki.html.includes(`href="/project/${P}`), 'Wiki must preserve custom linked prose and convert targets to local anchors');
    clone = await importProjectData(await exportProjectData(P)); const copiedWriting = (await db.writings.where('projectId').equals(clone).toArray())[0], copiedEntry = (await db.codexEntries.where('projectId').equals(clone).toArray()).find(entry => entry.title === 'Harbor of Salt')!;
    assert(copiedWriting.content.includes(`/project/${clone}/codex?entry=${copiedEntry.id}`) && !copiedWriting.content.includes(`/project/${P}/`), 'Actual clone must remap manual local URLs to new project/entry identities');
    passed.push('Manual link portability: actual project clone, wiki custom-text anchors and self-contained reader reference appendix');

    const bookHost = document.createElement('div'); document.body.append(bookHost);
    const book = new Editor({ element: bookHost, extensions: [StarterKit.configure({ document: false }), BookDocument, ChapterHeadingNode.configure({ nodeView: false })], content: chapterHeadingHtml({ id: 'first', title: 'First' }) + '<p>Prose</p>' + chapterHeadingHtml({ id: 'second', title: 'Second' }) + '<p>More</p>' });
    try { const before = book.getHTML(); book.commands.setTextSelection(2); assert(!insertCodexTextLink(book, P, { projectId: P, entryId: E, label: 'Port' }), 'Manual link must not alter a book title'); book.commands.setTextSelection({ from: 2, to: book.state.doc.content.size - 2 }); assert(!insertCodexTextLink(book, P, { projectId: P, entryId: E, label: 'Port' }) && book.getHTML() === before, 'Cross-chapter manual linking must reject without mutation'); } finally { book.destroy(); bookHost.remove(); }
    passed.push('Book safety: manual text links refuse title/boundary selections without altering chapter identities or content');
    return passed;
  } finally { await act(async () => root.unmount()); for (const id of [P, clone].filter((id): id is string => Boolean(id))) await deleteProject(id); }
}
