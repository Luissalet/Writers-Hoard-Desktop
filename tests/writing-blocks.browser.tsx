// Writing blocks in the editor: the "/" menu (filter, keys, click), callouts,
// checklists ticked with a click, toggles; kept by the sanitiser, read and
// written as Markdown alerts and task lists by the bridge.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { slashMatches } from '@/components/editor/blocks/slashCommands';
import { markdownToTiptapHtml } from '@/services/aiBridge/markdown';
import { htmlToMarkdown } from '@/engines/writings/manuscriptExport';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string, timeout = 3000) { const end = Date.now() + timeout; while (Date.now() < end) { if (check()) return; await act(async () => { await sleep(20); }); } throw new Error(`Timed out: ${label}`); }

export async function testWritingBlocks(): Promise<string[]> {
  const passed: string[] = [];
  assert(slashMatches('not', 'es').map(i => i.id).join() === 'note', `Filter "not": ${slashMatches('not', 'es').map(i => i.id)}`);
  assert(slashMatches('lista', 'es').map(i => i.id).join() === 'bullet,ordered,checklist', `Filter "lista": ${slashMatches('lista', 'es').map(i => i.id)}`);
  assert(slashMatches('', 'en').length === 31, 'All blocks with nothing typed');
  useLocaleStore.setState({ locale: 'es' });
  const host = document.getElementById('root'); assert(host, 'root');
  const root = createRoot(host);
  let editor: Editor | null = null;
  let html = '';
  try {
    await act(async () => { root.render(createElement(TiptapEditor, { content: '<p>Antes</p><p></p>', onChange: (value: string) => { html = value; }, onEditorReady: (instance: Editor | null) => { editor = instance ?? editor; } })); await sleep(200); });
    await until(() => !!editor, 'editor');
    const ed = editor as unknown as Editor;
    const type = async (text: string) => { await act(async () => { ed.view.dispatch(ed.state.tr.insertText(text)); await sleep(30); }); };
    const key = async (name: string) => { await act(async () => { ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })); await sleep(40); }); };
    await act(async () => { ed.commands.focus(); ed.view.dispatch(ed.state.tr.setSelection(Selection.atEnd(ed.state.doc))); await sleep(20); });
    // "/" opens the menu; typing narrows it; Escape closes it until retyped.
    await type('/');
    await until(() => !!document.querySelector('[data-testid="slash-menu"]'), 'menu opens');
    assert(document.querySelectorAll('[data-testid="slash-menu"] [role="option"]').length === 31, 'Every block offered');
    await type('not');
    await until(() => document.querySelectorAll('[data-testid="slash-menu"] [role="option"]').length === 1, 'filtered to Nota');
    await key('Escape');
    await until(() => !document.querySelector('[data-testid="slash-menu"]'), 'closed by Escape');
    await type('a');
    assert(!document.querySelector('[data-testid="slash-menu"]'), 'Stays closed while the same slash is typed on');
    await act(async () => { ed.commands.deleteRange({ from: ed.state.selection.from - 5, to: ed.state.selection.from }); await sleep(20); });
    await type('/not');
    await until(() => !!document.querySelector('[data-testid="slash-note"]'), 'reopened');
    await key('Enter');
    await until(() => /data-wh-callout="note"/.test(ed.getHTML()), 'callout made with Enter');
    assert(!/\/not/.test(ed.getHTML()), 'The slash and the query are gone');
    await type('Recuerda el vado');
    passed.push('"/" at the start of a line opens 23 blocks; "/not" leaves Nota; Escape closes the menu until the slash is typed again; Enter turns the line into a Note callout and the "/not" goes away');
    // A checklist from the menu with a click, ticked with a click on its box.
    await act(async () => { ed.commands.setTextSelection(ed.state.doc.content.size); ed.commands.insertContentAt(ed.state.doc.content.size, '<p></p>'); ed.commands.setTextSelection(ed.state.doc.content.size - 1); await sleep(20); });
    await type('/tareas');
    await until(() => !!document.querySelector('[data-testid="slash-checklist"]'), 'checklist offered');
    await act(async () => { (document.querySelector('[data-testid="slash-checklist"]') as HTMLButtonElement).click(); await sleep(60); });
    await type('Comprar sal');
    await key('Enter');
    await type('Avisar al barquero');
    const item = await (async () => { await until(() => document.querySelectorAll('li.wh-check-item').length === 2, 'two items'); return document.querySelector('li.wh-check-item') as HTMLElement; })();
    const box = item.getBoundingClientRect();
    await act(async () => { item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: box.left + 6, clientY: box.top + 8 })); await sleep(40); });
    const out = ed.getHTML();
    assert(/<ul[^>]*data-wh-checklist="true"[^>]*><li[^>]*data-checked="true"[^>]*><p>Comprar sal<\/p><\/li><li[^>]*data-checked="false"[^>]*><p>Avisar al barquero/.test(out), `Checklist: ${out}`);
    assert(html === out || html.includes('data-wh-checklist'), 'onChange carries it');
    await act(async () => { ed.commands.insertContentAt(ed.state.doc.content.size, '<p>Detalles</p>'); ed.commands.setTextSelection(ed.state.doc.content.size - 1); ed.commands.setToggle(); await sleep(30); });
    assert(/<details[^>]*data-wh-toggle="true"[^>]*><summary>Detalles<\/summary><p><\/p><\/details>/.test(ed.getHTML()), `Toggle: ${ed.getHTML()}`);
    await act(async () => { ed.commands.insertContentAt(ed.state.doc.content.size, '<p></p>'); ed.commands.setTextSelection(ed.state.doc.content.size - 1); await sleep(20); });
    await type('/enviado');
    await until(() => !!document.querySelector('[data-testid="slash-sent"]'), 'sent message offered');
    await key('Enter');
    await type('¿Dónde estás?');
    await until(() => /<div[^>]*data-wh-message="sent"[^>]*><p>¿Dónde estás\?<\/p><\/div>/.test(ed.getHTML()), 'sent message');
    passed.push('"/tareas" → Lista de tareas by click: Enter adds an item, a click on the box ticks it (data-checked); a toggle keeps its title as the summary; "/enviado" makes a sent text-message bubble');
    // An image: width and frame from the bar over it.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await act(async () => { ed.commands.insertContentAt(ed.state.doc.content.size, `<img src="${png}" alt="faro">`); await sleep(40); });
    let imagePos = -1; ed.state.doc.descendants((node, pos) => { if (node.type.name === 'image') imagePos = pos; });
    await act(async () => { ed.commands.setNodeSelection(imagePos); await sleep(60); });
    await until(() => !!document.querySelector('[data-testid="image-controls"]'), 'image bar');
    await act(async () => { (document.querySelector('[data-testid="image-width-50"]') as HTMLButtonElement).click(); await sleep(40); });
    await act(async () => { ed.commands.setNodeSelection(imagePos); await sleep(40); });
    await act(async () => { (document.querySelector('[data-testid="image-frame-polaroid"]') as HTMLButtonElement).click(); await sleep(40); });
    assert(/<img[^>]*data-wh-width="50"[^>]*data-wh-frame="polaroid"|<img[^>]*data-wh-frame="polaroid"[^>]*data-wh-width="50"/.test(ed.getHTML()), `Image layout: ${ed.getHTML().slice(-300)}`);
    passed.push('A selected image gets a bar over it: 50% wide and a Polaroid frame, kept as data on the image');
    // The stored HTML survives the sanitiser and reads back the same.
    const stored = sanitizeRichHtml(ed.getHTML());
    assert(/data-wh-callout="note"/.test(stored) && /data-checked="true"/.test(stored) && /data-wh-toggle/.test(stored), 'Sanitiser keeps the blocks');
    await act(async () => { ed.commands.setContent(stored); await sleep(20); });
    assert(ed.getHTML() === stored.replace(/ open=""/g, ' open="open"') || /data-wh-callout="note"/.test(ed.getHTML()) && /data-checked="true"/.test(ed.getHTML()), 'Read back');
  } finally {
    await act(async () => { root.unmount(); await sleep(20); });
  }
  // Markdown both ways.
  const md = '> [!WARNING] El puente cae\n> al tercer día\n\n- [ ] uno\n- [x] dos\n\n> una cita';
  const fromMd = markdownToTiptapHtml(md);
  assert(fromMd.includes('<aside data-wh-callout="warning"><p>El puente cae<br>al tercer día</p></aside>') && fromMd.includes('<ul data-wh-checklist="true"><li data-checked="false"><p>uno</p></li><li data-checked="true"><p>dos</p></li></ul>') && fromMd.includes('<blockquote>'), `From Markdown: ${fromMd}`);
  const back = htmlToMarkdown(fromMd);
  assert(back.includes('> [!WARNING]\n> El puente cae\n> al tercer día') && back.includes('- [ ] uno\n- [x] dos') && back.includes('> una cita'), `To Markdown: ${back}`);
  passed.push('Markdown: "> [!WARNING]" becomes a Warning callout and "- [ ] / - [x]" a checklist, and they are written back the same way');
  // The bridge.
  const P = 'synthetic-writing-blocks';
  try {
    await db.projects.put({ id: P, title: 'Bloques', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 });
    const made = await runBridgeTool('wh_create_writing', { projectId: P, title: 'Notas del viaje', content: '> [!TIP] Llevar sal\n\n- [x] mapa\n- [ ] brújula' });
    assert(made.ok, JSON.stringify(made));
    const id = (made.result as { id: string }).id;
    const stored = (await db.writings.get(id))!.content;
    assert(/data-wh-callout="tip"/.test(stored) && /data-checked="true"/.test(stored), `Stored: ${stored}`);
    const read = await runBridgeTool('wh_get_writing', { id });
    const content = (read.result as { content: string }).content;
    assert(/> \[!TIP\]\n> Llevar sal/.test(content) && /- \[x\] mapa\n- \[ \] brújula/.test(content), `Read: ${content}`);
    passed.push('Bridge: wh_create_writing turns "> [!TIP]" and "- [x]" into a Tip callout and a checklist, and wh_get_writing gives them back as Markdown');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
