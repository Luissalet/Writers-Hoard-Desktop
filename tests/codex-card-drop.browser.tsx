// A Codex card dragged from the library onto a chapter becomes a live Codex
// block where it is dropped; a card of another project or another kind of
// document is not taken.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { LOCAL_TOOL_DOCUMENT_MIME, encodeLocalToolDocumentDrag } from '@/engines/local/references';
import { db } from '@/db';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry, Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string, timeout = 3000) { const end = Date.now() + timeout; while (Date.now() < end) { if (check()) return; await act(async () => { await sleep(30); }); } throw new Error(`Timed out: ${label}`); }

export async function testCodexCardDrop(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  const P = 'card-drop';
  await db.projects.put({ id: P, title: 'Puerto Sal', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings', 'codex'], createdAt: 1, updatedAt: 1 } as Project);
  await db.codexEntries.put({ id: 'cd-marta', projectId: P, type: 'character', title: 'Marta Salinas', content: '<p>Farera.</p>', fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 } as CodexEntry);
  const host = document.getElementById('root'); assert(host, 'root');
  const root = createRoot(host);
  let editor: Editor | null = null;
  try {
    await act(async () => { root.render(createElement(TiptapEditor, { content: '<p>Primero.</p><p>Segundo.</p>', onChange: () => {}, referenceContext: { projectId: P, scopeId: 'chapter-1' }, onEditorReady: (instance: Editor | null) => { editor = instance ?? editor; } })); await sleep(250); });
    await until(() => !!editor, 'editor');
    const ed = editor as unknown as Editor;
    const drop = async (payload: string, mime = LOCAL_TOOL_DOCUMENT_MIME) => {
      const target = ed.view.dom.querySelectorAll('p')[1] as HTMLElement;
      const box = target.getBoundingClientRect();
      const transfer = new DataTransfer();
      transfer.setData(mime, payload);
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: box.left + 2, clientY: box.top + box.height / 2, dataTransfer: transfer });
      await act(async () => { target.dispatchEvent(event); await sleep(120); });
      return event.defaultPrevented;
    };
    const card = encodeLocalToolDocumentDrag({ format: 'writers-hoard-document/1', projectId: P, reference: { kind: 'codex', documentId: 'cd-marta' } });
    assert(await drop(card), 'Drop taken');
    await until(() => /data-wh-codex-block="true"/.test(ed.getHTML()), 'block inserted');
    const html = ed.getHTML();
    assert(/<p>Primero\.<\/p>.*data-entry-id="cd-marta".*Segundo\./s.test(html), `Placed where dropped: ${html}`);
    passed.push('Drop: dragging "Marta Salinas" from the library onto the second paragraph inserts a live Codex block there, between "Primero." and "Segundo."');
    const before = ed.getHTML();
    const other = encodeLocalToolDocumentDrag({ format: 'writers-hoard-document/1', projectId: 'another-project', reference: { kind: 'codex', documentId: 'x' } });
    const map = encodeLocalToolDocumentDrag({ format: 'writers-hoard-document/1', projectId: P, reference: { kind: 'maps', documentId: 'm1' } });
    await drop(other); await drop(map);
    assert(ed.getHTML() === before, 'Other projects and other kinds are left alone');
    passed.push('A card of another project, or a map, dropped on the text inserts nothing');
  } finally {
    await act(async () => { root.unmount(); await sleep(20); });
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
