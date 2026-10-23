// Block actions in a card or chapter: fold the block under its first words
// (and unfold it), copy it with its formatting, and extract it into a new
// Codex card leaving a live reference — in the editor and through the bridge.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { WikiMarksControls } from '@/components/editor/wiki/WikiMarks';
import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry, Project, Writing } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 3000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await act(async () => { await sleep(30); }); } throw new Error(`Timed out: ${label}`); }

export async function testBlockActions(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const P = 'block-actions';
  await db.projects.put({ id: P, title: 'Puerto Sal', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings', 'codex'], createdAt: 1, updatedAt: 1 } as Project);
  const host = document.getElementById('root'); assert(host, 'root');
  const editorHost = document.createElement('div'), controlsHost = document.createElement('div');
  host.append(editorHost, controlsHost);
  const editorRoot = createRoot(editorHost);
  let controlsRoot: Root | null = null;
  let editor: Editor | null = null;
  const captured: { type: string; text: string }[] = [];
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async (items: ClipboardItem[]) => { for (const item of items) for (const type of item.types) captured.push({ type, text: await (await item.getType(type)).text() }); }, writeText: async (text: string) => { captured.push({ type: 'text/plain', text }); } } });
  try {
    await act(async () => { editorRoot.render(createElement(TiptapEditor, { content: '<p>Primero.</p><ul><li><p>Espada de Ilse, forjada en sal.</p></li></ul><p>Tercero.</p>', onChange: () => {}, onEditorReady: (instance: Editor | null) => { editor = instance ?? editor; } })); await sleep(200); });
    await until(() => !!editor, 'editor');
    const ed = editor as unknown as Editor;
    const render = (extract?: { projectId?: string; eraId?: string }) => act(async () => { controlsRoot ??= createRoot(controlsHost); controlsRoot.render(createElement(WikiMarksControls, { editor: ed as never, locale: 'es', extract })); await sleep(60); });
    await render({ projectId: P });
    const inList = () => { let at = -1; ed.state.doc.descendants((node, pos) => { if (at < 0 && node.isText && node.text?.startsWith('Espada')) at = pos + 2; }); return at; };
    const button = (id: string) => controlsHost.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
    await act(async () => { ed.commands.focus(); ed.commands.setTextSelection(inList()); await sleep(60); });
    await until(() => button('block-fold') && !button('block-fold').disabled, 'fold enabled');
    await act(async () => { button('block-fold').click(); await sleep(60); });
    const folded = ed.getHTML();
    assert(/<details[^>]*data-wh-toggle[^>]*><summary[^>]*>Espada de Ilse, forjada en sal\.<\/summary><ul>/.test(folded), `Folded: ${folded}`);
    await act(async () => { ed.commands.setTextSelection(inList()); await sleep(60); });
    await until(() => /Desplegar/.test(button('block-fold').textContent ?? ''), 'unfold offered');
    await act(async () => { button('block-fold').click(); await sleep(60); });
    assert(ed.getHTML() === '<p>Primero.</p><ul><li><p>Espada de Ilse, forjada en sal.</p></li></ul><p>Tercero.</p>', `Unfolded: ${ed.getHTML()}`);
    passed.push('Fold: "Plegar bloque bajo un título" folds the list under "Espada de Ilse, forjada en sal." (a toggle the reader opens); "Desplegar bloque" puts it back exactly');

    await act(async () => { ed.commands.setTextSelection(inList()); await sleep(40); });
    await act(async () => { button('block-copy').click(); await sleep(120); });
    assert(captured.some(item => item.type === 'text/html' && /<ul><li><p>Espada de Ilse/.test(item.text)) && captured.some(item => item.type === 'text/plain' && item.text.includes('Espada de Ilse')) && /Bloque copiado/.test(controlsHost.textContent ?? ''), `Copied: ${JSON.stringify(captured)}`);
    passed.push('Copy: "Copiar bloque" puts the list on the clipboard as HTML (pastes with its formatting) and as plain text');

    await act(async () => { ed.commands.setTextSelection(inList()); await sleep(40); });
    await act(async () => { button('block-extract').click(); await sleep(300); });
    await until(() => /data-wh-codex-block="true"/.test(ed.getHTML()), 'reference in place');
    const card = (await db.codexEntries.where('projectId').equals(P).toArray())[0];
    assert(card && card.title === 'Espada de Ilse, forjada en sal.' && /^<ul><li><p>Espada de Ilse/.test(card.content) && ed.getHTML().includes(`data-entry-id="${card.id}"`) && !ed.getHTML().includes('<ul>') && /Movido a la ficha nueva/.test(controlsHost.textContent ?? ''), `Extracted: ${ed.getHTML()} / ${JSON.stringify(card)}`);
    passed.push('Extract: "Extraer bloque a una ficha nueva" makes the card "Espada de Ilse, forjada en sal." with the list as its body and leaves a live Codex reference where the list stood');
    await render({ projectId: P, eraId: 'era-1' });
    assert(button('block-extract').disabled && /base compartida/.test(button('block-extract').title), 'In an era extraction is off, with the reason');
  } finally {
    await act(async () => { controlsRoot?.unmount(); editorRoot.unmount(); await sleep(20); });
    editorHost.remove(); controlsHost.remove();
    if (original) Object.defineProperty(navigator, 'clipboard', original); else delete (navigator as unknown as Record<string, unknown>).clipboard;
  }

  try {
    await db.writings.put({ id: 'ba-w', projectId: P, title: 'El puerto', status: 'draft', content: '<p>Llegan al puerto.</p><p>El faro tiene tres llaves de bronce.</p><p>Se van.</p>', wordCount: 12, tags: [], createdAt: 1, updatedAt: 1 } as Writing);
    const moved = await runBridgeTool('wh_extract_block_to_card', { projectId: P, writingId: 'ba-w', blockIndex: 1, title: 'Llaves del faro', type: 'item' });
    const result = moved.result as { card: { id: string; title: string }; __audit: Record<string, unknown> };
    const after = (await db.writings.get('ba-w'))!.content;
    const card = await db.codexEntries.get(result.card.id) as CodexEntry;
    assert(moved.ok && card.title === 'Llaves del faro' && card.type === 'item' && card.content === '<p>El faro tiene tres llaves de bronce.</p>' && after === `<p>Llegan al puerto.</p><aside data-wh-codex-block="true" data-project-id="${P}" data-entry-id="${card.id}" data-label="Llaves del faro"></aside><p>Se van.</p>`, `Bridge: ${after}`);
    await undoAuditEntry({ entry: { ...result.__audit, tool: 'wh_extract_block_to_card', kind: 'update' } });
    assert((await db.writings.get('ba-w'))!.content.includes('tres llaves de bronce'), 'Undo puts the block back');
    const bad = await runBridgeTool('wh_extract_block_to_card', { projectId: P, writingId: 'ba-w', blockIndex: 9 });
    assert(!bad.ok && /There are 3 top-level blocks/.test(JSON.stringify(bad)), 'Out of range refused');
    passed.push('Bridge: wh_extract_block_to_card moves block 1 of "El puerto" into the item card "Llaves del faro" and leaves a live reference; undo puts the paragraph back; an index past the end is refused with the count');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
