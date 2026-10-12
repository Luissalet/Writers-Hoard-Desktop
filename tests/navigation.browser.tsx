import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { undoDepth } from '@tiptap/pm/history';
import HeadingNavigator from '@/components/editor/navigation/HeadingNavigator';
import { deriveWritingHeadings } from '@/engines/writings/navigation';
import { BookDocument, ChapterHeadingNode } from '@/components/editor/chapterHeading/ChapterHeadingNode';
import { chapterHeadingHtml } from '@/engines/writings/bookDocument';
import { createEditorialExtensions, upsertEditorialStyle } from '@/engines/writings/editorial';
import { normalizeAdvancedFormatting } from '@/components/editor/advanced/model';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function rig(content: string, book = false) {
  const host = document.createElement('div'); host.style.width = '390px'; const surface = document.createElement('div'); document.body.append(host, surface);
  const editor = new Editor({ element: surface, extensions: [StarterKit.configure({ document: !book }), ...(book ? [BookDocument, ChapterHeadingNode.configure({ nodeView: false })] : []), ...createEditorialExtensions()], content });
  const root = createRoot(host);
  const render = async (current = editor, locale: 'es' | 'en' = 'es') => { await act(async () => { root.render(createElement(HeadingNavigator, { editor: current, locale })); }); };
  const click = async (label: string) => { const target = Array.from(host.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === label || button.textContent?.includes(label)); assert(target, `Control ${label}`); await act(async () => { target.click(); }); };
  const filter = async (query: string) => { const input = host.querySelector('input'); assert(input, 'Search input'); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query); input.dispatchEvent(new Event('input', { bubbles: true })); }); };
  const dispose = async () => { await act(async () => { root.unmount(); }); editor.destroy(); host.remove(); surface.remove(); };
  return { host, editor, render, click, filter, dispose };
}

export async function testWritingNavigation(): Promise<string[]> {
  const passed: string[] = [];
  {
    const test = rig('<h2>Biografía <strong>de María</strong></h2><p>Texto.</p><blockquote><h4>研究 🧭</h4><p>Datos.</p></blockquote><h6></h6>');
    try {
      upsertEditorialStyle(test.editor, { id: 'style-hidden', name: 'No es un encabezado', format: normalizeAdvancedFormatting({}), headingLevel: 1 });
      const before = JSON.stringify(test.editor.getJSON()); const headings = deriveWritingHeadings(test.editor.state.doc);
      assert(headings.length === 3 && headings.map(heading => heading.level).join() === '2,4,6', 'Derived hierarchy includes nested authored headings and excludes style definitions');
      assert(headings[0].text === 'Biografía de María' && headings[1].text === '研究 🧭' && headings[2].text === '', 'Inline formatting and all Unicode text are read literally');
      assert(headings.every(heading => test.editor.state.doc.nodeAt(heading.from)?.nodeSize === heading.to - heading.from), 'Ranges identify full current nodes');
      assert(JSON.stringify(test.editor.getJSON()) === before && headings.every(heading => !heading.chapterId), 'Derivation does not mutate document or invent chapter IDs');
      passed.push('pure heading hierarchy, exact positions, rich Unicode and hidden metadata exclusion');
    } finally { await test.dispose(); }
  }
  {
    const test = rig(chapterHeadingHtml({ id: 'one', title: 'Capítulo uno', chapter: 1 }) + '<h2>Antecedentes</h2><p>Uno.</p>' + chapterHeadingHtml({ id: 'two', title: 'Capítulo dos', chapter: 2 }) + '<h3>Entrevistas</h3><p>Dos.</p>' + '<h1 data-chapter-heading="true" data-chapter-client-id="draft-new">Capítulo nuevo</h1><h2>Epílogo</h2>', true);
    try {
      const headings = deriveWritingHeadings(test.editor.state.doc);
      assert(headings.map(heading => heading.text).join('|') === 'Capítulo uno|Antecedentes|Capítulo dos|Entrevistas|Capítulo nuevo|Epílogo', 'Book labels derive from current headings and body headings');
      assert(headings[0].level === 1 && headings[1].chapterId === 'one' && headings[3].chapterId === 'two', 'Body heading retains its current real chapter ID');
      assert(!headings[4].chapterId && !headings[5].chapterId, 'A new unsaved chapter does not inherit the prior chapter ID');
      await test.render(); await test.click('Navegar por encabezados'); await test.click('Entrevistas');
      assert(test.editor.state.selection.from === headings[3].from + 1 && test.editor.state.doc.nodeAt(headings[2].from)?.attrs.writingId === 'two', 'Book jump positions caret without modifying chapter metadata');
      passed.push('book chapter titles and scoped body headings use only real IDs with metadata preserved');
    } finally { await test.dispose(); }
  }
  {
    const test = rig('<h2>Biografía de María</h2><h3>研究 🧭</h3><h4>Conclusiones</h4>');
    try {
      await test.render(); await test.click('Navegar por encabezados'); await test.filter('BIOGRAFIA DE MARIA');
      assert(test.host.querySelectorAll('[data-heading-position]').length === 1 && test.host.textContent?.includes('Biografía de María'), 'Search ignores case and accent composition');
      await test.filter('研究'); assert(test.host.querySelectorAll('[data-heading-position]').length === 1, 'Search handles non-Latin Unicode');
      await test.filter('🧭'); assert(test.host.querySelectorAll('[data-heading-position]').length === 1, 'Search handles astral Unicode');
      await test.filter('No existe'); assert(test.host.textContent?.includes('No hay encabezados que coincidan.'), 'Spanish filtered empty state is clear');
      await test.render(test.editor, 'en'); assert(test.host.textContent?.includes('No headings match your search.'), 'English empty state follows current locale');
      passed.push('Unicode search, accent/case normalization and Spanish/English filtered empty states');
    } finally { await test.dispose(); }
  }
  {
    const test = rig('<h2>Inicio</h2><p>Cuerpo.</p>');
    try {
      await test.render(); await test.click('Navegar por encabezados');
      await act(async () => { test.editor.commands.insertContentAt(test.editor.state.doc.content.size, '<h3>Nuevo epílogo</h3>'); });
      assert(test.host.textContent?.includes('Nuevo epílogo'), 'Document edit updates outline');
      await act(async () => { test.editor.commands.undo(); }); assert(!test.host.textContent?.includes('Nuevo epílogo'), 'Normal undo updates outline');
      await act(async () => { test.editor.commands.setContent('<h4>Revisión remota</h4><p>Fuente actual.</p>', { emitUpdate: false }); });
      assert(test.host.textContent?.includes('Revisión remota') && !test.host.textContent?.includes('Inicio'), 'Silent remote reload still updates derived outline');
      passed.push('live document changes, normal undo and remote emitUpdate:false refresh the same editor outline');
    } finally { await test.dispose(); }
  }
  {
    const test = rig('<h2>Inicio</h2><p>Contenido.</p><h3>Final</h3>');
    try {
      await test.render(); await test.click('Navegar por encabezados');
      await act(async () => { test.editor.commands.insertContentAt(test.editor.state.doc.content.size, '<p>Edición previa.</p>'); test.editor.setEditable(false); });
      const before = JSON.stringify(test.editor.getJSON()); const history = undoDepth(test.editor.state); await test.click('Final');
      const heading = deriveWritingHeadings(test.editor.state.doc).find(item => item.text === 'Final')!;
      assert(test.editor.state.selection.from === heading.from + 1 && JSON.stringify(test.editor.getJSON()) === before && undoDepth(test.editor.state) === history, 'Readonly navigation is available and changes neither source nor undo history');
      assert(test.host.querySelector('[aria-current="location"]')?.textContent?.includes('Final'), 'Current heading is announced accessibly');
      const nav = test.host.querySelector('nav')!; await act(async () => { nav.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      assert(!test.host.querySelector('nav') && document.activeElement?.getAttribute('aria-label') === 'Navegar por encabezados', 'Escape returns keyboard focus to the toggle');
      passed.push('readonly jumps preserve source and undo history, current location and keyboard focus');
    } finally { await test.dispose(); }
  }
  {
    const test = rig('<h2>Objetivo</h2><p>Fuente anterior.</p>');
    try {
      await test.render(); await test.click('Navegar por encabezados'); const oldButton = test.host.querySelector<HTMLButtonElement>('[data-heading-position]')!;
      await act(async () => { test.editor.commands.setContent('<p>Texto remoto insertado antes.</p><h2>Objetivo</h2><p>Fuente nueva.</p>', { emitUpdate: false }); oldButton.click(); });
      const current = deriveWritingHeadings(test.editor.state.doc)[0]; assert(test.editor.state.selection.from === current.from + 1, 'Jump rederives current coordinates before React rerenders');
      const removedButton = test.host.querySelector<HTMLButtonElement>('[data-heading-position]')!;
      await act(async () => { test.editor.commands.setContent('<h2>Otro encabezado</h2><p>Sin objetivo.</p>', { emitUpdate: false }); const position = test.editor.state.selection.from; removedButton.click(); assert(test.editor.state.selection.from === position, 'A removed heading cannot jump to a different heading at its old position'); });
      assert(test.host.querySelector('[role=status]')?.textContent?.includes('El texto ha cambiado'), 'Changed source supplies a concise recovery notice');
      await act(async () => { test.editor.commands.setContent('<h2>Duplicado</h2><p>Uno.</p><h2>Duplicado</h2><p>Dos.</p>', { emitUpdate: false }); });
      const duplicateButton = test.host.querySelectorAll<HTMLButtonElement>('[data-heading-position]')[1];
      await act(async () => { test.editor.commands.setContent('<p>Nuevo comienzo.</p><h2>Duplicado</h2><p>Uno.</p><h2>Duplicado</h2><p>Dos.</p>', { emitUpdate: false }); const position = test.editor.state.selection.from; duplicateButton.click(); assert(test.editor.state.selection.from === position, 'Ambiguous duplicate headings after source replacement require choosing the updated list'); });
      await test.click('Duplicado'); assert(test.editor.state.selection.from === deriveWritingHeadings(test.editor.state.doc)[0].from + 1, 'A fresh click navigates normally despite duplicate titles');
      passed.push('same-instance remote replacement rederives jump positions and never targets unrelated replacement text');
    } finally { await test.dispose(); }
  }
  {
    const test = rig('<p>Sin encabezados.</p>'); const other = rig('<h2>Documento distinto</h2>');
    try {
      await test.render(); await test.click('Navegar por encabezados'); assert(test.host.textContent?.includes('Añade encabezados al texto'), 'Authoring empty state explains headings');
      await test.filter('Anterior'); await test.render(other.editor, 'en');
      assert(test.host.querySelector<HTMLInputElement>('input')?.value === '' && test.host.textContent?.includes('Documento distinto'), 'Editor replacement clears old search and uses its current source');
      passed.push('authoring empty state and editor replacement clear stale search without changing text');
    } finally { await test.dispose(); await other.dispose(); }
  }
  return passed;
}
