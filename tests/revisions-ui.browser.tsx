import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import RevisionControls from '@/components/editor/revisions/RevisionControls';
import { createRevisionExtensions, describeRevisions, getRevisionTracking, proposeRevision } from '@/engines/writings/revisions';
import { createAdvancedExtensions } from '@/components/editor/advanced';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import { BookDocument, ChapterHeadingNode } from '@/components/editor/chapterHeading/ChapterHeadingNode';
import { chapterBlocks, CHAPTER_HEADING_NAME } from '@/components/editor/chapterHeading/chapterBlocks';
import { chapterHeadingHtml, splitBookDoc } from '@/engines/writings/bookDocument';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function mount(content = '<p>Puerto tranquilo.</p>', book = false) {
  const host = document.createElement('div'); const editorHost = document.createElement('div');
  host.style.width = '390px'; document.body.append(host, editorHost);
  const editor = new Editor({ element: editorHost, extensions: [StarterKit.configure({ document: !book }), ...(book ? [BookDocument, ChapterHeadingNode.configure({ nodeView: false })] : []), Image.configure({ allowBase64: true }), FootnoteNode, ...createAdvancedExtensions(), ...createRevisionExtensions()], content });
  const root = createRoot(host);
  const render = async (current = editor, locale: 'es' | 'en' = 'es') => { await act(async () => { root.render(createElement(RevisionControls, { editor: current, locale })); }); };
  const button = (label: string, within: ParentNode = host): HTMLButtonElement => {
    const found = Array.from(within.querySelectorAll('button')).find(item => [item.textContent?.trim(), item.getAttribute('aria-label')].includes(label));
    assert(found, `Button ${label}`); return found;
  };
  const click = async (label: string, within: ParentNode = host) => { await act(async () => { button(label, within).click(); await delay(10); }); };
  const input = async (label: string, value: string) => {
    const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);
    assert(element, `Input ${label}`);
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); });
  };
  const select = async (from: number, to = from) => { await act(async () => { editor.commands.setTextSelection({ from, to }); }); };
  const dispose = async () => { await act(async () => { root.unmount(); }); editor.destroy(); host.remove(); editorHost.remove(); };
  return { host, editor, render, button, click, input, select, dispose };
}

export async function testRevisionsUi(): Promise<string[]> {
  const passed: string[] = [];
  {
    const rig = mount();
    try {
      await rig.render(); await rig.click('Control de cambios');
      assert(rig.host.textContent?.includes('No hay propuestas pendientes'), 'Empty state teaches pending revisions');
      await rig.input('Autor', 'Ana'); await rig.input('Origen', 'Faustus');
      await rig.select(1, 7); await rig.input('Texto propuesto', 'Bosque'); await rig.click('Proponer cambio');
      const revisions = describeRevisions(rig.editor);
      assert(revisions.length === 1 && revisions[0].author === 'Ana' && revisions[0].source === 'Faustus', 'UI proposal uses common API author and source');
      assert(rig.host.querySelector('del')?.textContent === 'Puerto' && rig.host.querySelector('ins')?.textContent === 'Bosque', 'Original and proposed text are visible');
      assert(rig.editor.getHTML().includes('data-wh-revision'), 'Proposal persists in editor HTML');
      const proposed = JSON.stringify(rig.editor.getJSON());
      await rig.click('Aceptar', rig.host.querySelector('[data-revision-id]')!);
      assert(rig.editor.getText() === 'Bosque tranquilo.' && !describeRevisions(rig.editor).length, 'Accept keeps proposed text');
      await act(async () => { rig.editor.commands.undo(); });
      assert(JSON.stringify(rig.editor.getJSON()) === proposed, 'Undo restores complete pending replacement');
      await rig.click('Rechazar', rig.host.querySelector('[data-revision-id]')!);
      assert(rig.editor.getText() === 'Puerto tranquilo.', 'Reject restores original text');
      passed.push('UI proposal shows original/new text and attribution, accepts/rejects through common API with native undo');
    } finally { await rig.dispose(); }
  }
  {
    const rig = mount('<p>Uno.</p><p>Dos.</p>');
    try {
      await rig.render(); await rig.click('Control de cambios');
      await act(async () => {
        assert(proposeRevision(rig.editor, { from: 1, to: 4, text: 'Primero', author: 'Ana', source: 'manual', id: 'first' }).ok, 'First proposal');
        let position = 0; rig.editor.state.doc.descendants((node, pos) => { if (node.isText && node.text.startsWith('Dos')) position = pos; });
        assert(proposeRevision(rig.editor, { from: position, to: position + 3, text: 'Segundo', author: 'Bea', source: 'Faustus', id: 'second' }).ok, 'Second proposal');
      });
      await rig.input('Filtrar propuestas', 'Faustus');
      assert(rig.host.querySelectorAll('[data-revision-id]').length === 1, 'Filter finds attribution');
      await rig.click('Aceptar todas las visibles');
      assert(describeRevisions(rig.editor).map(item => item.id).join() === 'first', 'Filtered accept preserves hidden proposal');
      await rig.input('Filtrar propuestas', '');
      const checkbox = rig.host.querySelector<HTMLInputElement>('[data-revision-id="first"] input[type=checkbox]'); assert(checkbox, 'Proposal checkbox');
      await act(async () => { checkbox.click(); }); await rig.click('Rechazar selección');
      assert(rig.editor.getText().includes('Uno.') && rig.editor.getText().includes('Segundo.'), 'Checked selection resolves only selected proposal');
      passed.push('author/source filtering and selected/all-visible review keep unrelated proposals');
    } finally { await rig.dispose(); }
  }
  {
    const rig = mount();
    try {
      await rig.render(); await rig.click('Control de cambios');
      const toggle = rig.host.querySelector<HTMLInputElement>('[aria-label="Registrar cambios"]'); assert(toggle, 'Tracking switch');
      await act(async () => { toggle.click(); }); assert(getRevisionTracking(rig.editor).enabled, 'Tracking is enabled through shared plugin');
      await rig.select(7);
      await act(async () => { rig.editor.view.dispatch(rig.editor.state.tr.insertText(' nuevo', 7)); });
      assert(describeRevisions(rig.editor).length > 0, 'Normal typing is tracked');
      await act(async () => { rig.editor.setEditable(false); });
      assert(toggle.disabled && rig.button('Aceptar todas las visibles').disabled && rig.host.querySelector('textarea')?.disabled, 'Readonly disables mutations');
      assert(rig.host.querySelectorAll('[data-revision-id]').length > 0, 'Readonly keeps proposals readable');
      await rig.render(rig.editor, 'en');
      assert(rig.host.textContent?.includes('Proposed text') && rig.host.querySelector('[aria-label="Record changes"]'), 'English labels');
      passed.push('tracking records actual typing, readonly keeps inspection, and English controls remain usable');
    } finally { await rig.dispose(); }
  }
  {
    const rig = mount('<p>La casa.</p><p>Segunda frase.</p>');
    try {
      await rig.render(); await rig.click('Control de cambios');
      await act(async () => {
        assert(proposeRevision(rig.editor, { from: 1, to: 3, text: 'Una', author: 'Ana', source: 'manual', id: 'selected-text' }).ok, 'Text selection proposal');
        let position = 0; rig.editor.state.doc.descendants((node, pos) => { if (node.isText && node.text.startsWith('Segunda')) position = pos; });
        assert(proposeRevision(rig.editor, { from: position, to: position + 7, text: 'Otra', author: 'Bea', source: 'manual', id: 'not-selected' }).ok, 'Unselected proposal');
      });
      const first = describeRevisions(rig.editor).find(item => item.id === 'selected-text'); assert(first, 'Text revision located');
      await rig.select(first.from, first.from + 1);
      assert(!rig.button('Aceptar selección').disabled, 'Partial text selection finds proposal');
      await rig.click('Aceptar selección');
      assert(rig.editor.getText().includes('Una casa.') && describeRevisions(rig.editor).map(item => item.id).join() === 'not-selected', 'Partial selection accepts entire replacement and keeps unselected change');
      passed.push('editor text selection resolves a complete replacement while preserving unselected proposals');
    } finally { await rig.dispose(); }
  }
  {
    const content = chapterHeadingHtml({ id: 'chapter-one', title: 'Uno', chapter: 1 }) + '<p>Primera escena.</p>' + chapterHeadingHtml({ id: 'chapter-two', title: 'Dos', chapter: 2 }) + '<p>Segunda escena.</p>';
    const rig = mount(content, true);
    try {
      await rig.render(); await rig.click('Control de cambios');
      const blocks = chapterBlocks(rig.editor.state.doc, rig.editor.schema.nodes[CHAPTER_HEADING_NAME]);
      const firstFrom = blocks[0].headingPos! + rig.editor.state.doc.nodeAt(blocks[0].headingPos!)!.nodeSize + 1;
      const secondFrom = blocks[1].headingPos! + rig.editor.state.doc.nodeAt(blocks[1].headingPos!)!.nodeSize + 1;
      await act(async () => {
        assert(proposeRevision(rig.editor, { from: secondFrom, to: secondFrom + 7, text: 'Nueva dos', author: 'Bea', source: 'manual', id: 'second-book' }).ok, 'Second chapter proposal');
        assert(proposeRevision(rig.editor, { from: firstFrom, to: firstFrom + 7, text: 'Nueva uno', author: 'Ana', source: 'manual', id: 'first-book' }).ok, 'First chapter proposal');
      });
      await rig.select(firstFrom);
      assert(rig.host.querySelectorAll('[data-revision-id]').length === 1 && rig.host.querySelector('[data-revision-id="first-book"]'), 'Current chapter lists only its own proposal');
      const before = splitBookDoc(rig.editor.state.doc, rig.editor.schema);
      await rig.click('Aceptar todas las visibles');
      const after = splitBookDoc(rig.editor.state.doc, rig.editor.schema);
      assert(after.map(item => item.writingId).join() === before.map(item => item.writingId).join() && after.map(item => item.title).join() === before.map(item => item.title).join(), 'Book headings retain ids and titles');
      assert(after[1].html === before[1].html && describeRevisions(rig.editor).some(item => item.id === 'second-book'), 'Other chapter body and pending proposal stay exact');
      await act(async () => { rig.editor.commands.undo(); rig.editor.commands.setContent(rig.editor.getHTML().replaceAll('second-book', 'first-book')); });
      await rig.select(firstFrom);
      assert(rig.host.querySelectorAll('[data-revision-id]').length === 1, 'Repeated imported id is scoped before grouping');
      const duplicateBefore = splitBookDoc(rig.editor.state.doc, rig.editor.schema);
      await rig.click('Aceptar todas las visibles');
      const duplicateAfter = splitBookDoc(rig.editor.state.doc, rig.editor.schema);
      assert(duplicateAfter[1].html === duplicateBefore[1].html && describeRevisions(rig.editor).some(item => item.id === 'first-book'), 'Repeated id resolution preserves the other chapter exactly');
      await rig.select(1, rig.editor.state.doc.content.size - 1); await rig.input('Texto propuesto', 'No sustituir libro'); await rig.click('Proponer cambio');
      assert(rig.host.querySelector('[role=alert]')?.textContent?.includes('capítulo actual'), 'Cross-chapter proposal gives a useful error');
      passed.push('book review preserves headings, other chapter bodies/proposals and rejects cross-chapter replacement');
    } finally { await rig.dispose(); }
  }
  {
    const rig = mount(); const other = mount('<p>Otro capítulo intacto.</p>');
    try {
      await rig.render(); await rig.click('Control de cambios');
      await rig.select(1, 7); await rig.input('Texto propuesto', 'Pendiente del editor anterior');
      await rig.render(other.editor);
      assert(rig.host.querySelector<HTMLTextAreaElement>('textarea')?.value === '', 'New editor clears old proposal draft');
      assert(rig.host.querySelectorAll('[data-revision-id]').length === 0 && other.editor.getText() === 'Otro capítulo intacto.', 'New editor never receives stale proposal or selected ids');
      passed.push('editor replacement clears previous draft and keeps the new chapter intact');
    } finally { await rig.dispose(); await other.dispose(); }
  }
  {
    const rig = mount();
    try {
      await rig.render(); await rig.click('Control de cambios');
      await rig.select(1, 7); await rig.input('Texto propuesto', 'Bosque');
      await act(async () => { rig.editor.commands.setContent('<p>Nuevo texto remoto intacto.</p>', { emitUpdate: false }); });
      const before = JSON.stringify(rig.editor.getJSON());
      assert(rig.host.querySelector<HTMLTextAreaElement>('textarea')?.value === 'Bosque', 'Remote same-editor update keeps proposal draft');
      await rig.click('Proponer cambio');
      assert(JSON.stringify(rig.editor.getJSON()) === before && describeRevisions(rig.editor).length === 0, 'Remote update never applies old proposal to remapped selection');
      assert(rig.host.querySelector('[role=alert]')?.textContent?.includes('El texto ha cambiado'), 'Stale source has a localized recovery message');
      await rig.select(1, 6);
      await rig.click('Proponer cambio');
      const revised = describeRevisions(rig.editor);
      assert(revised.length === 1 && revised[0].deletedText === 'Nuevo' && revised[0].insertedText === 'Bosque', 'Explicit new selection anchors proposal to current source');
      passed.push('remote silent setContent preserves draft, prevents stale replacement and recovers after explicit selection');
    } finally { await rig.dispose(); }
  }
  {
    const headings = [chapterHeadingHtml({ id: 'anchor-one', title: 'Uno', chapter: 1 }), chapterHeadingHtml({ id: 'anchor-two', title: 'Dos', chapter: 2 })];
    const rig = mount(headings[0] + '<p>Puerto viejo.</p>' + headings[1] + '<p>Puerto segundo.</p>', true);
    try {
      await rig.render(); await rig.click('Control de cambios');
      const first = chapterBlocks(rig.editor.state.doc, rig.editor.schema.nodes[CHAPTER_HEADING_NAME])[0];
      const from = first.headingPos! + rig.editor.state.doc.nodeAt(first.headingPos!)!.nodeSize + 1;
      await rig.select(from, from + 6); await rig.input('Texto propuesto', 'Bosque');
      await act(async () => { rig.editor.commands.setContent(headings[0] + '<p>Nuevo uno.</p>' + headings[1] + '<p>Nuevo dos.</p>', { emitUpdate: false }); });
      const before = JSON.stringify(rig.editor.getJSON());
      assert(rig.host.querySelector<HTMLTextAreaElement>('textarea')?.value === 'Bosque', 'Book remote reload preserves anchored draft across mapped chapter selection');
      await rig.click('Proponer cambio'); assert(JSON.stringify(rig.editor.getJSON()) === before, 'Book remote reload cannot apply to a different chapter');
      const blocks = chapterBlocks(rig.editor.state.doc, rig.editor.schema.nodes[CHAPTER_HEADING_NAME]);
      const secondFrom = blocks[1].headingPos! + rig.editor.state.doc.nodeAt(blocks[1].headingPos!)!.nodeSize + 1;
      const sections = splitBookDoc(rig.editor.state.doc, rig.editor.schema);
      await rig.select(secondFrom, secondFrom + 5); await rig.click('Proponer cambio');
      const after = splitBookDoc(rig.editor.state.doc, rig.editor.schema);
      assert(after[0].html === sections[0].html && after[1].html.includes('Bosque'), 'Explicit book reselection targets only new current chapter');
      assert(after.map(section => section.writingId).join() === sections.map(section => section.writingId).join(), 'Anchored book recovery preserves chapter identities');
      passed.push('remote whole-book reload retains draft and explicit reselection preserves all other chapters');
    } finally { await rig.dispose(); }
  }
  {
    const rig = mount();
    try {
      await rig.render(); await rig.click('Control de cambios');
      const toggle = rig.host.querySelector<HTMLInputElement>('[aria-label="Registrar cambios"]'); assert(toggle, 'Warning test tracking switch');
      await act(async () => { toggle.click(); });
      await rig.select(7);
      await act(async () => { rig.editor.commands.splitBlock(); });
      assert(rig.editor.state.doc.childCount === 2 && getRevisionTracking(rig.editor).warning, 'Structural edit is preserved and reported');
      assert(rig.host.textContent?.includes('Se ha conservado la edición de estructura') && !rig.host.textContent.includes('This structural edit'), 'Structural tracking notice is localized in Spanish');
      await rig.render(rig.editor, 'en');
      assert(rig.host.textContent?.includes('The structural edit was preserved.'), 'Structural tracking notice is localized in English');
      passed.push('structural edits remain intact and automatic-tracking scope notices use ES/EN');
    } finally { await rig.dispose(); }
  }
  {
    const rig = mount('<p>Primer texto.</p><p>Segundo texto.</p>');
    try {
      await rig.render(); await rig.click('Control de cambios');
      const original = JSON.stringify(rig.editor.getJSON());
      await rig.select(1, rig.editor.state.doc.content.size - 1); await rig.input('Texto propuesto', 'Nueva\nEscena.'); await rig.click('Proponer cambio');
      assert(!rig.host.querySelector('[role=alert]') && describeRevisions(rig.editor).length === 1, 'Compatible multiple paragraphs support a proposal');
      await rig.click('Rechazar', rig.host.querySelector('[data-revision-id]')!);
      assert(JSON.stringify(rig.editor.getJSON()) === original, 'Reject restores compatible original paragraphs exactly');
      passed.push('multiline proposal across compatible paragraphs retains exact original structure on rejection');
    } finally { await rig.dispose(); }
  }
  return passed;
}
