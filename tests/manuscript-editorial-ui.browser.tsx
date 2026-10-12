import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import EditorialControls from '@/components/editor/editorial/EditorialControls';
import { createEditorialExtensions, describeEditorial, type EditorialReference } from '@/engines/writings/editorial';
import { applyAdvancedFormatting, createAdvancedExtensions } from '@/components/editor/advanced';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import { BookDocument, ChapterHeadingNode } from '@/components/editor/chapterHeading/ChapterHeadingNode';
import { chapterHeadingHtml, splitBookDoc } from '@/engines/writings/bookDocument';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 10));
const REFERENCES: EditorialReference[] = [{ id: 'research-one', title: 'Informe del puerto', authors: ['María Pérez'], publishedAt: '2024', url: 'https://source.example/report', updatedAt: 1 }];
function rig(content = '<p>Primer texto.</p><p>Segundo texto.</p>', book = false) {
  const host = document.createElement('div'); host.style.width = '390px'; const surface = document.createElement('div'); document.body.append(host, surface);
  const extensions = [StarterKit.configure({ document: !book }), ...(book ? [BookDocument, ChapterHeadingNode.configure({ nodeView: false })] : []), Image.configure({ allowBase64: true }), FootnoteNode, ...createAdvancedExtensions(), ...createEditorialExtensions()];
  const editor = new Editor({ element: surface, extensions, content }); const root = createRoot(host);
  const render = async (references: readonly EditorialReference[] | undefined = REFERENCES, current = editor, locale: 'es' | 'en' = 'es') => { await act(async () => { root.render(createElement(EditorialControls, { editor: current, locale, references })); }); };
  const click = async (label: string) => {
    const element = Array.from(host.querySelectorAll<HTMLElement>('button,summary')).find(item => [item.textContent?.trim(), item.getAttribute('aria-label')].includes(label)); assert(element, `Control ${label}`);
    await act(async () => { element.click(); await delay(); });
  };
  const input = async (label: string, value: string) => {
    const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[aria-label="${label}"]`); assert(element, `Input ${label}`);
    await act(async () => {
      if (element instanceof HTMLSelectElement) element.value = value;
      else Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const select = async (text: string, length = 0) => {
    let position = -1; editor.state.doc.descendants((node, pos) => { if (position < 0 && node.isText && node.text!.includes(text)) position = pos + node.text!.indexOf(text); });
    assert(position >= 0, `Text ${text}`); await act(async () => { editor.commands.setTextSelection({ from: position, to: position + length }); });
  };
  const button = (label: string) => Array.from(host.querySelectorAll('button')).find(item => item.textContent?.trim() === label)!;
  const dispose = async () => { await act(async () => { root.unmount(); }); editor.destroy(); host.remove(); surface.remove(); };
  return { editor, host, extensions, render, click, input, select, button, dispose };
}

export async function testEditorialUi(): Promise<string[]> {
  const passed: string[] = [];
  {
    const test = rig();
    const source = { ...REFERENCES[0], researchEvidence: [{ id: 'own-excerpt', quote: 'Texto comprobado de esta fuente.' }] };
    try {
      await test.render([source]); await test.click('Herramientas editoriales'); await test.click('Citas y bibliografía');
      await test.input('Fuente de Investigación', source.id);
      const picker = test.host.querySelector<HTMLSelectElement>('[aria-label="Extracto de la fuente (opcional)"]');
      assert(picker?.options.length === 2 && picker.options[1].value === 'own-excerpt', 'Only the selected source evidence is offered');
      await test.input('Extracto de la fuente (opcional)', 'own-excerpt');
      const before = test.editor.getHTML();
      await test.render([{ ...source, researchEvidence: [] }]); await test.click('Insertar cita');
      assert(test.editor.getHTML() === before && test.host.querySelector('[role="alert"]'), 'Removed evidence cannot become a stale source link');
      await test.render([source]); await test.click('Insertar cita');
      assert(describeEditorial(test.editor).citations[0]?.evidenceId === 'own-excerpt', 'Existing evidence remains traceable');
      await act(async () => { test.editor.commands.undo(); });
      assert(test.editor.getHTML() === before, 'Valid citation insertion retains ordinary undo');
      passed.push('real source excerpt picker revalidates removed evidence and preserves undo');
    } finally { await test.dispose(); }
  }
  {
    const test = rig();
    try {
      await test.render(); await test.click('Herramientas editoriales'); await test.select('Primer', 6);
      await act(async () => { applyAdvancedFormatting(test.editor, { fontSize: 19, color: '#225577', alignment: 'center' }); test.editor.commands.setBold(); });
      await test.input('Nombre del estilo', 'Cuerpo autor'); await test.click('Guardar formato actual');
      const style = describeEditorial(test.editor).styles[0]; assert(style?.name === 'Cuerpo autor' && style.format.fontSize === 19 && style.bold, 'Captured style contains real selected formatting');
      await test.select('Segundo'); await test.click('Aplicar estilo');
      assert(test.editor.getHTML().includes('data-wh-style-id'), 'Style applies persistently to selected paragraph');
      await test.input('Nombre del estilo', 'Reportaje'); await test.click('Renombrar estilo');
      assert(describeEditorial(test.editor).styles[0].name === 'Reportaje', 'Rename uses common style API');
      await act(async () => { applyAdvancedFormatting(test.editor, { fontSize: 23 }); }); await test.click('Actualizar con el formato actual');
      assert(describeEditorial(test.editor).styles[0].format.fontSize === 23, 'Update captures current formatting');
      const html = test.editor.getHTML(); const loaded = new Editor({ extensions: test.extensions, content: html });
      assert(describeEditorial(loaded).styles[0].name === 'Reportaje' && loaded.getHTML().includes('data-wh-size="23"'), 'HTML reopening keeps reusable style and linked formatting'); loaded.destroy();
      await test.click('Eliminar estilo'); assert(!describeEditorial(test.editor).styles.length && test.editor.getHTML().includes('data-wh-size="23"'), 'Removing style preserves concrete formatting');
      await act(async () => { test.editor.commands.undo(); }); assert(describeEditorial(test.editor).styles.length === 1, 'Normal undo restores style definition and link');
      passed.push('saved style capture, apply, rename, update, removal, HTML reopening and normal undo');
    } finally { await test.dispose(); }
  }
  {
    const test = rig();
    try {
      await test.render(); await test.click('Herramientas editoriales'); await test.click('Diseño y secciones');
      await test.input('Papel', 'letter'); await test.input('Orientación', 'landscape'); await test.input('Inicio de sección', 'oddPage');
      assert(test.host.querySelector<HTMLSelectElement>('[aria-label="Papel"]')?.value === 'letter', 'Landscape retains the selected paper preset');
      await test.input('Margen superior (pt)', '54'); await test.input('Cabecera', 'Informe con ñ & datos'); await test.input('Pie de página', 'Archivo de trabajo'); await test.click('Guardar diseño');
      const section = describeEditorial(test.editor).sections[0]; assert(section?.pageWidth === 792 && section.pageHeight === 612 && section.marginTop === 54 && section.start === 'oddPage' && section.header === 'Informe con ñ & datos', 'Page configuration persists exact geometry and literals');
      await test.select('Segundo'); await test.input('Cabecera', 'Segunda sección'); await test.click('Nueva sección desde el cursor');
      const sections = describeEditorial(test.editor).sections; assert(sections.length === 2 && sections[1].position > sections[0].position && sections[1].header === 'Segunda sección', 'New section is inserted before current top-level block');
      const before = JSON.stringify(test.editor.getJSON()); await test.input('Margen izquierdo (pt)', '900'); await test.click('Guardar diseño');
      assert(test.host.querySelector('[role=alert]')?.textContent?.includes('espacio para el texto') && JSON.stringify(test.editor.getJSON()) === before, 'Impossible page geometry is reported without partial writing');
      passed.push('custom section geometry, header/footer, mid-chapter insertion and localized geometry errors');
    } finally { await test.dispose(); }
  }
  {
    const test = rig('<p>Reportaje con fuente.</p>');
    try {
      await test.render(); await test.click('Herramientas editoriales'); await test.click('Citas y bibliografía'); await test.select('Reportaje', 9);
      await test.input('Fuente de Investigación', 'research-one'); await test.input('Texto visible de la cita', '(Pérez, 2024, p. 3)'); await test.input('Página o localizador', 'p. 3'); await test.click('Insertar cita');
      const citation = describeEditorial(test.editor).citations[0]; assert(citation?.sourceId === 'research-one' && citation.snapshotUpdatedAt === 1 && citation.locator === 'p. 3' && citation.label === '(Pérez, 2024, p. 3)', 'Citation carries real source snapshot and literal label');
      assert(test.editor.getText().includes('Reportaje') && test.editor.getText().includes('con fuente.'), 'Citation insertion never erases the selected author text');
      await test.click('Generar o actualizar bibliografía'); assert(test.editor.getHTML().includes('data-wh-bibliography') && test.editor.getText().includes('María Pérez. Informe del puerto. 2024.'), 'Bibliography uses cited source metadata');
      const changed = [{ ...REFERENCES[0], title: 'Informe revisado', updatedAt: 2 }]; await test.render(changed);
      assert(test.host.querySelector('[data-source-notice="changed"]'), 'Changed source is announced');
      assert(describeEditorial(test.editor).citations[0].title === 'Informe del puerto', 'External source changes do not silently rewrite citation snapshots');
      await test.click('Actualizar fuentes citadas'); assert(describeEditorial(test.editor).citations[0].title === 'Informe revisado' && describeEditorial(test.editor).citations[0].label === '(Pérez, 2024, p. 3)', 'Explicit refresh updates snapshot while keeping label and locator');
      await test.click('Generar o actualizar bibliografía'); assert(test.editor.getText().includes('Informe revisado'), 'Explicit bibliography update incorporates new source data');
      await test.render([{ ...changed[0], retractedAt: 3 }]); assert(test.host.querySelector('[data-source-notice="retracted"]'), 'Retraction notice is readable without blocking historical reference');
      await test.render([]); assert(test.host.querySelector('[data-source-notice="missing"]') && describeEditorial(test.editor).citations.length === 1, 'Missing source keeps original source snapshot and citation');
      await test.click('Quitar cita'); assert(!describeEditorial(test.editor).citations.length, 'Citation removal uses shared operation');
      await act(async () => { test.editor.commands.undo(); }); assert(describeEditorial(test.editor).citations.length === 1, 'Citation removal is undoable');
      passed.push('source picker preserves author text, citation snapshots, explicit refresh, bibliography and changed/retracted/missing notices');
    } finally { await test.dispose(); }
  }
  {
    const test = rig();
    try {
      await test.render(); await test.click('Herramientas editoriales'); await test.click('Listas'); await test.select('Primer');
      await test.input('Número inicial', '-2'); await test.click('Aplicar lista');
      assert(test.editor.getHTML().includes('<ol start="-2"'), 'Legal negative numbering is not capped');
      await test.input('Número inicial', '0'); await test.click('Aplicar lista'); assert(test.editor.getHTML().includes('<ol start="0"'), 'Numbering restarts at zero');
      await test.select('Segundo'); await test.input('Número inicial', '4'); await test.click('Aplicar lista');
      await test.input('Nivel', '2'); await test.click('Aplicar lista');
      assert(test.editor.getHTML().split('<ol').length > 2, 'Nesting is represented as actual list structure');
      passed.push('numbering restart supports zero/negative values and nested list structure');
    } finally { await test.dispose(); }
  }
  {
    const content = chapterHeadingHtml({ id: 'one', title: 'Uno', chapter: 1 }) + '<p>Texto uno.</p>' + chapterHeadingHtml({ id: 'two', title: 'Dos', chapter: 2 }) + '<p>Texto dos.</p>';
    const test = rig(content, true);
    try {
      await test.render(); await test.select('Texto uno'); await test.click('Herramientas editoriales');
      const before = splitBookDoc(test.editor.state.doc, test.editor.schema);
      await test.input('Nombre del estilo', 'Capítulo uno'); await test.click('Guardar formato actual'); await test.click('Aplicar estilo');
      await test.click('Diseño y secciones'); await test.input('Cabecera', 'Solo uno'); await test.click('Guardar diseño');
      await test.click('Citas y bibliografía'); await test.input('Fuente de Investigación', 'research-one'); await test.click('Insertar cita'); await test.click('Generar o actualizar bibliografía');
      const after = splitBookDoc(test.editor.state.doc, test.editor.schema);
      assert(after[1].html === before[1].html && after[0].writingId === 'one' && after[1].writingId === 'two' && after.map(section => section.title).join() === before.map(section => section.title).join(), 'Book operations preserve other body and chapter identities');
      await test.select('Texto dos'); assert(!test.host.querySelector('[data-editorial-citation-id]') && test.host.querySelector<HTMLInputElement>('[aria-label="Nombre del estilo"]')?.value === '', 'Changing chapter resets forms and scopes visible references');
      passed.push('styles, section configuration, citations and bibliography preserve unrelated book chapters and metadata');
    } finally { await test.dispose(); }
  }
  {
    const test = rig(); const other = rig('<p>Documento nuevo.</p>');
    try {
      await test.render(); await test.click('Herramientas editoriales'); await test.input('Nombre del estilo', 'Borrador anterior');
      await act(async () => { test.editor.setEditable(false); });
      assert(test.button('Guardar formato actual').disabled && !test.host.querySelector<HTMLSelectElement>('[aria-label="Estilo"]')?.disabled, 'Readonly disables changes while retaining style inspection');
      await test.render(REFERENCES, other.editor, 'en');
      assert(test.host.querySelector<HTMLInputElement>('[aria-label="Style name"]')?.value === '' && test.host.textContent?.includes('Saved styles'), 'Editor replacement clears stale forms and localizes UI');
      const panel = test.host.querySelector('section'); assert(panel, 'Progressive panel'); await act(async () => { panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      assert(!test.host.querySelector('section') && other.editor.getText() === 'Documento nuevo.', 'Escape closes panel without changing document');
      passed.push('readonly inspection, editor replacement, English controls and keyboard Escape preserve documents');
    } finally { await test.dispose(); await other.dispose(); }
  }
  return passed;
}
