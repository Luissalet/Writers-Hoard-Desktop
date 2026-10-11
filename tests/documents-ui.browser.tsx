import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import DocumentTools from '@/components/editor/documents/DocumentTools';
import { createAdvancedExtensions } from '@/components/editor/advanced/extensions';
import { BookDocument, ChapterHeadingNode } from '@/components/editor/chapterHeading/ChapterHeadingNode';
import { chapterBlocks, CHAPTER_HEADING_NAME } from '@/components/editor/chapterHeading/chapterBlocks';
import { chapterHeadingHtml, splitBookDoc } from '@/engines/writings/bookDocument';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function testDocumentTools(): Promise<string[]> {
  const results: string[] = [];
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const downloads: Array<{ blob: Blob; name?: string }> = [];
  const previous = Object.getOwnPropertyDescriptor(window, 'electronAPI');
  const previousUrl = URL.createObjectURL;
  const previousAnchorDispatch = HTMLAnchorElement.prototype.dispatchEvent;
  let nextId = 1;
  let failPreview = false;
  let deferOpen = false;
  let resolveOpen: ((response: unknown) => void) | undefined;
  const importedHtml = '<h1>España</h1><p style="text-align:center"><strong>Texto importado.</strong></p><table><tbody><tr><td><p>Celda ñ</p></td></tr></tbody></table>';
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3kAAAAASUVORK5CYII=';
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
    documents: { call: async (request: { tool: string; args: Record<string, unknown> }) => {
      calls.push(request);
      const { tool, args } = request;
      if (tool === 'wh_document_open_bytes') {
        const result = { ok: true, result: { sessionId: `opened-${nextId++}`, summary: { pages: 2 } } };
        if (deferOpen) return new Promise(resolve => { resolveOpen = resolve; });
        return result;
      }
      if (tool === 'wh_document_import') return { ok: true, result: { sessionId: `snapshot-${nextId++}`, summary: { pages: 1 } } };
      if (tool === 'wh_document_html') return { ok: true, result: { html: importedHtml } };
      if (tool === 'wh_document_render') {
        if (failPreview) return { ok: false, code: 'page-missing', error: 'La página no existe.' };
        return { ok: true, result: { mimeType: 'image/png', dataBase64: pixel, width: 1, height: 1 } };
      }
      if (tool === 'wh_document_export_bytes') return { ok: true, result: { mimeType: 'application/octet-stream', dataBase64: btoa('Documento ñ'), fileName: args.fileName } };
      if (tool === 'wh_document_pdf') return { ok: true, result: { mimeType: 'application/pdf', dataBase64: btoa('%PDF-') } };
      if (tool === 'wh_document_close') return { ok: true, result: {} };
      return { ok: false, error: `Unexpected tool ${tool}` };
    } },
  } });
  URL.createObjectURL = blob => { downloads.push({ blob: blob as Blob }); return previousUrl(blob); };
  HTMLAnchorElement.prototype.dispatchEvent = function (event) {
    if (event.type === 'click' && this.download) {
      downloads.at(-1)!.name = this.download;
      return false;
    }
    return previousAnchorDispatch.call(this, event);
  };
  const container = document.createElement('div');
  container.style.width = '390px';
  document.body.appendChild(container);
  const editorHost = document.createElement('div');
  document.body.appendChild(editorHost);
  const editor = new Editor({ element: editorHost, extensions: [StarterKit, ...createAdvancedExtensions()], content: '<p>Mi borrador actual.</p>' });
  const root = createRoot(container);
  const button = (label: string): HTMLButtonElement => {
    const found = Array.from(container.querySelectorAll('button')).find(element => element.textContent?.trim() === label || element.getAttribute('aria-label') === label);
    assert(found, `Button found: ${label}`);
    return found;
  };
  const click = async (label: string) => { await act(async () => { button(label).click(); await sleep(40); }); };
  const chooseFile = async (name: string) => {
    const input = container.querySelector<HTMLInputElement>('input[type=file]');
    assert(input, 'File picker exists');
    const data = new DataTransfer();
    data.items.add(new File(['native bytes ñ'], name));
    input.files = data.files;
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await sleep(40); });
  };
  const changeSelect = async (label: string, value: string) => {
    const element = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    assert(element, `Select found: ${label}`);
    await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
  };
  try {
    await act(async () => { root.render(createElement(DocumentTools, { editor, locale: 'es' })); });
    await click('Herramientas de documento');
    assert(container.querySelector('section[aria-label="Herramientas de documento"]'), 'Progressive panel opens');
    await click('Previsualizar página');
    assert(container.querySelector('img[alt="Página del documento 1"]'), 'Native PNG preview is visible');
    const snapshotId = calls.find(call => call.tool === 'wh_document_render')?.args.sessionId;
    assert(calls.some(call => call.tool === 'wh_document_close' && call.args.sessionId === snapshotId), 'Preview snapshot closes after use');
    assert(editor.getText() === 'Mi borrador actual.', 'Preview leaves editor intact');
    results.push('editor preview uses own temporary native session, renders PNG and preserves draft');

    await chooseFile('Informe.docx');
    const openedId = calls.find(call => call.tool === 'wh_document_html')?.args.sessionId;
    assert(typeof openedId === 'string', 'Opening returns a session');
    assert(editor.getText() === 'Mi borrador actual.', 'Opening never replaces current draft');
    assert(container.textContent?.includes('cabeceras, revisiones y objetos'), 'Native-to-editor projection limit is explained');
    assert(container.querySelector<HTMLSelectElement>('select[aria-label="Origen"]')?.value === 'imported', 'Opened file is selected for preview and export');
    const importCount = calls.filter(call => call.tool === 'wh_document_import').length;
    await click('Descargar documento');
    assert(calls.at(-1)?.tool === 'wh_document_export_bytes', 'Download uses native bytes');
    assert(calls.at(-1)?.args.sessionId === openedId, 'Download preserves full opened native structure');
    assert(calls.filter(call => call.tool === 'wh_document_import').length === importCount, 'Opened file export never rebuilds through HTML');
    assert(downloads.at(-1)?.name === 'Informe.docx', 'Download filename has a single matching extension');
    results.push('opening preserves draft and original native session; complete native download precedes text application');

    await click('Aplicar texto al editor');
    assert(editor.getText().includes('Texto importado.') && editor.getText().includes('Celda ñ'), 'Explicit apply imports text and table');
    assert(editor.getHTML().includes('<table') && editor.getHTML().includes('data-wh-align="center"'), 'Table and alignment survive native HTML projection');
    assert(container.querySelector<HTMLSelectElement>('select[aria-label="Origen"]')?.value === 'editor', 'Applying selects current editor text for following exports');
    const originalOption = container.querySelector<HTMLOptionElement>('select[aria-label="Origen"] option[value="imported"]');
    assert(originalOption && !originalOption.disabled, 'Full original remains explicitly selectable after applying');
    await click('Descargar documento');
    const currentExport = calls.findLast(call => call.tool === 'wh_document_export_bytes');
    assert(String(currentExport?.args.sessionId).startsWith('snapshot-'), 'Download after applying uses current editor snapshot');
    assert(calls.findLast(call => call.tool === 'wh_document_import')?.args.html?.toString().includes('Texto importado.'), 'Post-apply export receives applied editor contents');
    await act(async () => { assert(editor.commands.undo(), 'Application has normal undo'); });
    assert(editor.getText() === 'Mi borrador actual.', 'Undo restores current draft');
    await changeSelect('Origen', 'imported');
    await click('Descargar documento');
    assert(calls.findLast(call => call.tool === 'wh_document_export_bytes')?.args.sessionId === openedId, 'Original native structure remains selectable and exportable after apply');
    results.push('explicit text application keeps supported formatting and normal undo');

    await act(async () => { editor.setEditable(false); });
    assert(button('Aplicar texto al editor').disabled, 'Readonly editor disables only text application');
    assert(!button('Descargar documento').disabled, 'Readonly still exports documents');
    await act(async () => { editor.setEditable(true); });
    await changeSelect('Formato', 'pdf');
    await click('Descargar documento');
    assert(calls.at(-1)?.tool === 'wh_document_pdf', 'PDF uses native layout export');
    assert(downloads.at(-1)?.name === 'Informe.pdf', 'PDF filename follows chosen format');
    results.push('readonly preserves document operations; PDF uses native PDF route');

    failPreview = true;
    await click('Previsualizar página');
    assert(container.querySelector('[role=alert]')?.textContent === 'La página no existe.', 'Native error is visible');
    assert(editor.getText() === 'Mi borrador actual.', 'Failed operation preserves draft');
    failPreview = false;
    await click('Previsualizar página');
    assert(!container.querySelector('[role=alert]'), 'Retry clears error');
    results.push('native failures surface and retry without replacing or dropping current text');

    deferOpen = true;
    await chooseFile('Late.odt');
    assert(button('Cancelar'), 'Busy operation can be cancelled');
    await click('Cancelar');
    assert(resolveOpen, 'Delayed native open is pending');
    await act(async () => { resolveOpen?.({ ok: true, result: { sessionId: 'late-session', summary: { pages: 1 } } }); await sleep(40); });
    assert(calls.some(call => call.tool === 'wh_document_close' && call.args.sessionId === 'late-session'), 'Cancelled late session closes');
    assert(container.textContent?.includes('Informe.docx') && !container.textContent.includes('Late.odt'), 'Cancellation preserves previous opened file');
    assert(editor.getText() === 'Mi borrador actual.', 'Cancellation preserves editor');
    results.push('cancel ignores late import results, closes their session and preserves previous draft and file');

    await changeSelect('Origen', 'editor');
    await changeSelect('Formato', 'writer.json');
    await click('Descargar documento');
    const writerExport = calls.findLast(call => call.tool === 'wh_document_export_bytes');
    assert(writerExport?.args.format === 'writer.json' && String(writerExport.args.sessionId).startsWith('snapshot-'), 'Current editor native JSON exports a fresh snapshot');
    assert(calls.some(call => call.tool === 'wh_document_close' && call.args.sessionId === writerExport?.args.sessionId), 'Download snapshot closes');
    results.push('current editor export is distinct from opened original and closes its temporary snapshot');

    await act(async () => { root.render(createElement(DocumentTools, { editor, locale: 'en' })); });
    assert(container.textContent?.includes('Apply') === false && container.textContent?.includes('Download document'), 'English controls use localised copy');
    const panel = container.querySelector('section');
    assert(panel, 'Panel remains open across locale change');
    await act(async () => { panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    assert(!container.querySelector('section') && button('Document tools').getAttribute('aria-expanded') === 'false', 'Escape closes progressive panel');
    results.push('English labels and keyboard Escape work without resetting document state');

    const bookHost = document.createElement('div');
    document.body.appendChild(bookHost);
    const book = new Editor({
      element: bookHost,
      extensions: [StarterKit.configure({ document: false }), BookDocument, ChapterHeadingNode.configure({ nodeView: false }), ...createAdvancedExtensions()],
      content: '<p>Prólogo existente.</p>' + chapterHeadingHtml({ id: 'first', title: 'Uno', chapter: 1 }) + '<p>Primer capítulo intacto.</p>' + chapterHeadingHtml({ id: 'second', title: 'Dos', chapter: 2 }) + '<p>Segundo capítulo anterior.</p>',
    });
    try {
      deferOpen = false;
      await act(async () => { root.render(createElement(DocumentTools, { editor: book, locale: 'es', key: 'book' })); });
      await click('Herramientas de documento');
      await chooseFile('Capitulo.docx');
      const original = JSON.stringify(book.getJSON());
      const before = splitBookDoc(book.state.doc, book.schema);
      const blocks = chapterBlocks(book.state.doc, book.schema.nodes[CHAPTER_HEADING_NAME]);
      const second = blocks.find(block => block.writingId === 'second');
      assert(second?.headingPos !== null && second, 'Real book schema identifies second chapter');
      await act(async () => { book.commands.setTextSelection(second.headingPos! + book.state.doc.nodeAt(second.headingPos!)!.nodeSize + 1); });
      await click('Aplicar al capítulo actual');
      const afterBook = splitBookDoc(book.state.doc, book.schema);
      assert(afterBook.map(section => section.writingId).join() === before.map(section => section.writingId).join(), 'Import keeps every book chapter id');
      assert(afterBook.map(section => section.title).join() === before.map(section => section.title).join(), 'Import keeps chapter titles');
      assert(afterBook.find(section => section.writingId === 'first')?.html === before.find(section => section.writingId === 'first')?.html, 'Import preserves unrelated first chapter');
      assert(afterBook.find(section => section.writingId === 'second')?.html.includes('Texto importado.'), 'Import replaces only current chapter body');
      assert(afterBook[0].html === before[0].html, 'Import preserves prose before first heading');
      await act(async () => { assert(book.commands.undo(), 'Chapter application has undo'); });
      assert(JSON.stringify(book.getJSON()) === original, 'Undo restores complete book document exactly');
      results.push('real book schema applies only current chapter body and preserves every title, id, other chapter and undo');

      await changeSelect('Origen', 'imported');
      await act(async () => { book.commands.setTextSelection(1); });
      await click('Aplicar al capítulo actual');
      const preface = splitBookDoc(book.state.doc, book.schema);
      assert(preface[0].html.includes('Texto importado.'), 'Cursor before first chapter replaces only preface');
      assert(preface.find(section => section.writingId === 'first')?.html === before.find(section => section.writingId === 'first')?.html, 'Preface import keeps first chapter');
      assert(preface.find(section => section.writingId === 'second')?.html === before.find(section => section.writingId === 'second')?.html, 'Preface import keeps second chapter');
      await act(async () => { book.commands.undo(); });
      assert(JSON.stringify(book.getJSON()) === original, 'Preface undo restores book');
      results.push('import before first heading preserves all existing book chapter boundaries and contents');
    } finally {
      await act(async () => { root.render(createElement('div')); });
      book.destroy(); bookHost.remove();
    }
  } finally {
    await act(async () => { root.unmount(); });
    assert(calls.some(call => call.tool === 'wh_document_close' && String(call.args.sessionId).startsWith('opened-')), 'Unmount closes retained native session');
    editor.destroy(); editorHost.remove(); container.remove();
    URL.createObjectURL = previousUrl;
    HTMLAnchorElement.prototype.dispatchEvent = previousAnchorDispatch;
    if (previous) Object.defineProperty(window, 'electronAPI', previous);
    else Reflect.deleteProperty(window, 'electronAPI');
  }
  return results;
}
