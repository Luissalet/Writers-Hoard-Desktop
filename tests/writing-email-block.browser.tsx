// Story emails and text messages: "/Correo" makes an email block whose from,
// to, subject and date are set in a bar over it; a message's side and sender
// likewise; every export writes them as text (DOCX, ePub, Markdown read no
// attributes).
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { composePublishingDocument } from '@/engines/writings/publishingDocument';
import { htmlToMarkdown, renderPublishingMarkdown } from '@/engines/writings/manuscriptExport';
import { buildPublishingEpub } from '@/engines/writings/publishingEpub';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string | (() => string), timeout = 3000) { const end = Date.now() + timeout; while (Date.now() < end) { if (check()) return; await act(async () => { await sleep(20); }); } throw new Error(`Timed out: ${typeof label === 'function' ? label() : label}`); }

export async function testWritingEmailBlock(): Promise<string[]> {
  const passed: string[] = [];
  useLocaleStore.setState({ locale: 'es' });
  const host = document.getElementById('root'); assert(host, 'root');
  const root = createRoot(host);
  let editor: Editor | null = null;
  try {
    await act(async () => { root.render(createElement(TiptapEditor, { content: '<p>Antes</p><p></p>', onChange: () => {}, onEditorReady: (instance: Editor | null) => { editor = instance ?? editor; } })); await sleep(200); });
    await until(() => !!editor, 'editor');
    const ed = editor as unknown as Editor;
    await act(async () => { ed.commands.focus(); ed.view.dispatch(ed.state.tr.setSelection(Selection.atEnd(ed.state.doc))); await sleep(20); });
    await act(async () => { ed.view.dispatch(ed.state.tr.insertText('/correo')); await sleep(60); });
    await until(() => !!document.querySelector('[data-testid="slash-email"]'), 'email offered');
    await act(async () => { (document.querySelector('[data-testid="slash-email"]') as HTMLButtonElement).click(); await sleep(60); });
    await until(() => /data-wh-email="true"/.test(ed.getHTML()), 'email block made');
    await act(async () => { ed.view.dispatch(ed.state.tr.insertText('Te espero en el faro.')); await sleep(60); });
    await until(() => !!document.querySelector('[data-testid="block-field-controls"]'), 'email fields bar');
    const fill = async (name: string, value: string) => { await until(() => !!document.querySelector(`[data-testid="block-field-${name}"]`), () => `field ${name} (bar: ${document.querySelector('[data-testid="block-field-controls"]')?.outerHTML.slice(0, 200) ?? 'gone'}; selection ${ed.state.selection.from} in ${ed.state.selection.$from.node(1)?.type.name}/${ed.state.selection.$from.parent.type.name}; size ${ed.state.doc.content.size}; html ${ed.getHTML().slice(-300)})`); const input = document.querySelector(`[data-testid="block-field-${name}"]`) as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(30); }); };
    await fill('from', 'Marta'); await fill('to', 'Iker'); await fill('subject', 'El faro'); await fill('date', '12 de octubre');
    const html = ed.getHTML();
    assert(/data-wh-from="Marta"/.test(html) && /data-wh-to="Iker"/.test(html) && /data-wh-subject="El faro"/.test(html) && /data-wh-date="12 de octubre"/.test(html) && /Te espero en el faro\./.test(html), `Email: ${html}`);
    passed.push('Editor: "/correo" makes an email block; the bar over it sets De "Marta", Para "Iker", Asunto "El faro" and the date, kept on the block');
    // A message: its side and sender from the same bar.
    await act(async () => { ed.commands.setTextSelection(ed.state.doc.content.size); ed.commands.insertContentAt(ed.state.doc.content.size, '<div data-wh-message="received"><p>¿Dónde estás?</p></div>'); let inside = -1; ed.state.doc.descendants((node, pos) => { if (inside < 0 && node.isText && node.text?.includes('Dónde')) inside = pos + 3; }); ed.commands.setTextSelection(inside); await sleep(60); });
    await until(() => !!document.querySelector('[data-testid="block-field-side-sent"]'), 'message bar');
    await act(async () => { (document.querySelector('[data-testid="block-field-side-sent"]') as HTMLButtonElement).click(); await sleep(30); });
    await fill('sender', 'Iker');
    assert(/data-wh-message="sent"[^>]*data-wh-sender="Iker"|data-wh-sender="Iker"[^>]*data-wh-message="sent"/.test(ed.getHTML()), `Message: ${ed.getHTML()}`);
    passed.push('Messages: the bar over a text message turns it to "Enviado" and names its sender "Iker"');
    const doc = composePublishingDocument([{ id: 'w', projectId: 'p', title: 'Cartas', status: 'draft', content: ed.getHTML(), wordCount: 6, tags: [], createdAt: 1, updatedAt: 1 }], { projectTitle: 'Libro', includeTitlePage: false, includeSynopsis: false, chapterLabel: 'Capítulo' });
    const md = renderPublishingMarkdown(doc);
    assert(/✉ Marta → Iker/.test(md) && /\*\*El faro\*\* · 12 de octubre/.test(md) && /\*\*Iker\*\*/.test(md), `Markdown: ${md}`);
    const { default: JSZip } = await import('jszip');
    const epub = await JSZip.loadAsync(await (await buildPublishingEpub(doc)).arrayBuffer());
    const section = await epub.file('EPUB/section-1.xhtml')!.async('string');
    assert(/✉ Marta → Iker/.test(section) && /<strong>El faro<\/strong> · 12 de octubre/.test(section), `ePub: ${section.slice(0, 400)}`);
    assert(/✉ Marta → Iker/.test(htmlToMarkdown(ed.getHTML())), 'Markdown of the stored writing');
    passed.push('Exports: the email header "✉ Marta → Iker / El faro · 12 de octubre" and the sender "Iker" are written as text in Markdown, ePub (and so DOCX and HTML) and in the bridge\'s Markdown');
  } finally {
    await act(async () => { root.unmount(); await sleep(20); });
  }
  return passed;
}
