import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import DocumentTools from '@/components/editor/documents/DocumentTools';
function assert(v: unknown, message: string): asserts v { if (!v) throw new Error(message); }
export async function testPrintLanguage(): Promise<string[]> {
  const previous = Object.getOwnPropertyDescriptor(window, 'electronAPI');
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { documents: { call: async (r: typeof calls[number]) => {
    calls.push(r);
    if (r.tool === 'wh_document_import') return { ok: true, result: { sessionId: 'copy' } };
    if (r.tool === 'wh_document_render') return { ok: true, result: { mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3kAAAAASUVORK5CYII=', width: 1, height: 1 } };
    if (r.tool === 'wh_document_close') return { ok: true, result: {} };
    return { ok: false, error: 'Unexpected operation' };
  } } } });
  const host = document.createElement('div'); host.style.width = '390px'; document.body.append(host);
  const editor = new Editor({ extensions: [StarterKit], content: '<p>Documentación y niñez. https://example.org/a-b</p>' });
  const before = editor.getHTML(), root = createRoot(host);
  const click = async (label: string) => { const b = [...host.querySelectorAll('button')].find(x => x.textContent?.trim() === label || x.getAttribute('aria-label') === label); assert(b, label); await act(async () => { b.click(); await new Promise(r => setTimeout(r, 10)); }); };
  const select = async (label: string, value: string) => { const s = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`); assert(s, label); await act(async () => { s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); }); };
  try {
    await act(async () => { root.render(createElement(DocumentTools, { editor, locale: 'es' })); }); await click('Herramientas de documento');
    await click('Previsualizar página');
    let render = calls.findLast(x => x.tool === 'wh_document_render')!;
    assert(!('language' in render.args) && !('hyphenation' in render.args), 'Defaults preserve imported native settings instead of imposing a language or disabling hyphens');
    assert(host.querySelector('img'), 'Initial preview');
    await select('Idioma de impresión', 'es-ES'); assert(!host.querySelector('img'), 'Changing print options clears the obsolete preview');
    await select('Guionado automático', 'on'); await click('Previsualizar página');
    render = calls.findLast(x => x.tool === 'wh_document_render')!;
    assert(render.args.language === 'es-ES' && render.args.hyphenation === true, 'Spanish automatic preview uses explicit shared request options');
    await select('Idioma de impresión', 'en-US'); await select('Guionado automático', 'off'); await click('Previsualizar página');
    render = calls.findLast(x => x.tool === 'wh_document_render')!;
    assert(render.args.language === 'en-US' && render.args.hyphenation === false, 'Explicit English and off are distinct from inheritance');
    await select('Idioma de impresión', 'document'); await select('Guionado automático', 'document'); await click('Previsualizar página');
    render = calls.findLast(x => x.tool === 'wh_document_render')!;
    assert(!('language' in render.args) && !('hyphenation' in render.args), 'User can return to document settings');
    assert(editor.getHTML() === before && calls.filter(x => x.tool === 'wh_document_close').length === 4, 'Every preview closes its copy and leaves manuscript prose and URLs unchanged');
    return ['print defaults preserve document settings; ES/EN on/off and reset use shared options; obsolete preview cleared; manuscript unchanged'];
  } finally { await act(async () => { root.unmount(); }); editor.destroy(); host.remove(); if (previous) Object.defineProperty(window, 'electronAPI', previous); else delete window.electronAPI; }
}
