// Kanban boards: create a board with its four columns, add cards, move them
// with the arrows and by dragging, add and rename a column, search, link a
// card to a chapter; through the bridge with undo.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import KanbanPanel from '@/engines/kanban/KanbanPanel';
import NoteCard from '@/engines/notes/components/NoteCard';
import type { Note } from '@/engines/notes/types';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, tries = 100) { for (let i = 0; i < tries; i++) { if (await check()) return; await act(async () => { await pause(50); }); } throw new Error(`Timed out: ${label}`); }
const setValue = async (element: Element | null, value: string) => { assert(element, 'control'); const control = element as HTMLInputElement | HTMLSelectElement; await act(async () => { Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(120); }); };
const click = async (element: Element | null, label: string) => { assert(element, label); await act(async () => { (element as HTMLElement).click(); await pause(200); }); };

export async function testKanban(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [], P = 'kanban-test', host = document.getElementById('root')!, root = createRoot(host);
  const column = (name: string) => host.querySelector(`[data-testid="kanban-column-${name}"]`);
  const titles = (name: string) => [...(column(name)?.querySelectorAll<HTMLElement>('[data-testid="kanban-card"]') ?? [])].map(card => card.dataset.cardTitle);
  try {
    await db.projects.put({ id: P, title: 'Saga', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['notes', 'writings'], createdAt: 1, updatedAt: 1 } as Project);
    await db.writings.put({ id: `${P}-w`, projectId: P, title: 'Capítulo 3', content: '<p>x</p>', wordCount: 1, tags: [], status: 'draft', createdAt: 1, updatedAt: 1 } as never);
    await act(async () => { root.render(<KanbanPanel projectId={P} locale="es" />); await pause(300); });
    await setValue(host.querySelector('[data-testid="kanban-name"]'), 'Revisión');
    await click(host.querySelector('[data-testid="kanban-create"]'), 'create');
    await until(() => !!column('Ideas') && !!column('Hecho'), 'four columns');
    for (const title of ['Reescribir el prólogo', 'Nombrar la taberna']) { await setValue(column('Ideas')!.querySelector('[data-testid="kanban-new-card"]'), title); await click(column('Ideas')!.querySelector('[data-testid="kanban-add-card"]'), 'add card'); }
    await until(() => titles('Ideas').length === 2, 'two cards');
    await click(column('Ideas')!.querySelector('[data-testid="kanban-card"] [data-testid="kanban-right"]'), 'move right');
    await until(() => titles('En curso').join() === 'Reescribir el prólogo', 'moved with the arrow');
    // Drag "Nombrar la taberna" to "Revisar".
    const card = column('Ideas')!.querySelector('[data-testid="kanban-card"]')!, data = new DataTransfer();
    await act(async () => { card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data })); column('Revisar')!.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })); column('Revisar')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })); await pause(200); });
    await until(() => titles('Revisar').join() === 'Nombrar la taberna' && !titles('Ideas').length, 'dragged');
    await setValue(host.querySelector('[data-testid="kanban-new-column"]'), 'Archivo');
    await click(host.querySelector('[data-testid="kanban-add-column"]'), 'add column');
    await until(() => !!column('Archivo'), 'new column');
    await setValue(column('En curso')!.querySelector('[data-testid="kanban-card"] select'), `writing:${P}-w`);
    await until(() => /@Capítulo 3/.test(column('En curso')?.textContent ?? ''), 'linked');
    await setValue(host.querySelector('[data-testid="kanban-search"]'), 'taberna');
    assert(column('En curso')!.querySelector<HTMLElement>('[data-testid="kanban-card"]')!.hidden && !column('Revisar')!.querySelector<HTMLElement>('[data-testid="kanban-card"]')!.hidden, 'Search hides the rest');
    const stored = (await db.projects.get(P))!.kanbans!.boards[0];
    assert(stored.columns.map(item => item.name).join() === 'Ideas,En curso,Revisar,Hecho,Archivo' && stored.columns[1].cards[0].link?.title === 'Capítulo 3', 'Saved');
    passed.push('Board: "Revisión" with Ideas / En curso / Revisar / Hecho; two cards added; one moved with the arrow, the other dragged to Revisar; a column "Archivo" added; a card linked to "Capítulo 3"; searching "taberna" leaves only that card; saved with the project');
    await act(async () => { root.unmount(); await pause(); });
    const boardId = stored.id;
    const added = await runBridgeTool('wh_kanban', { projectId: P, action: 'add-card', boardId, column: 'Hecho', title: 'Mapa del puerto', note: 'Con la rejilla', link: { kind: 'writing', id: `${P}-w` } });
    assert(added.ok, `add-card: ${JSON.stringify(added)}`);
    const moved = await runBridgeTool('wh_kanban', { projectId: P, action: 'move-card', cardId: (added.result as { cardId: string }).cardId, toColumn: 'Ideas', position: 0 });
    assert(moved.ok && (moved.result as { boards: { columns: { name: string; cards: { title: string }[] }[] }[] }).boards[0].columns[0].cards[0].title === 'Mapa del puerto', 'Moved by column name');
    await undoAuditEntry({ entry: { ...(moved.result as { __audit: Record<string, unknown> }).__audit, tool: 'wh_kanban', kind: 'update' } });
    assert((await db.projects.get(P))!.kanbans!.boards[0].columns[3].cards.some(item => item.title === 'Mapa del puerto'), 'Undo puts it back in Hecho');
    const refuse = await runBridgeTool('wh_kanban', { projectId: P, action: 'remove-column', column: 'Hecho' });
    assert(!refuse.ok, 'A column with cards is not removed');
    // Notes with a title and a cover.
    let note: Note = { id: 'n1', projectId: P, kind: 'idea', text: 'La taberna se llama como el barco hundido', tags: [], pinned: false, createdAt: 1, updatedAt: 1 };
    const noteRoot = createRoot(host);
    const renderNote = async () => { await act(async () => { noteRoot.render(<NoteCard note={note} onUpdate={(_id, changes) => { note = { ...note, ...changes }; }} onDelete={() => undefined} />); await pause(120); }); };
    await renderNote();
    await click(host.querySelector('button.w-full.text-left'), 'edit note');
    await setValue(host.querySelector('[data-testid="note-title"]'), 'El Ancla Rota');
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const file = new File([Uint8Array.from(atob(png), char => char.charCodeAt(0))], 'portada.png', { type: 'image/png' }), transfer = new DataTransfer(); transfer.items.add(file);
    const picker = host.querySelector<HTMLInputElement>('[data-testid="note-cover"]')!; picker.files = transfer.files;
    await act(async () => { picker.dispatchEvent(new Event('change', { bubbles: true })); await pause(250); });
    await click([...host.querySelectorAll('button')].find(button => /Guardar|Save/.test(button.textContent ?? '')) ?? null, 'save note');
    await renderNote();
    assert(note.title === 'El Ancla Rota' && note.cover?.startsWith('data:image/png') && host.querySelector('[data-testid="note-title-shown"]')?.textContent === 'El Ancla Rota' && host.querySelector('[data-testid="note-cover-image"]') && /8 palabras/.test(host.querySelector('[data-testid="note-word-count"]')?.textContent ?? ''), `Titled note: ${JSON.stringify({ title: note.title, cover: note.cover?.slice(0, 20) })}`);
    await act(async () => { noteRoot.unmount(); await pause(); });
    const titled = await runBridgeTool('wh_create_note', { projectId: P, kind: 'note', text: 'Revisar fechas', title: 'Calendario' });
    assert(titled.ok, `create titled note: ${JSON.stringify(titled)}`);
    passed.push('Notes: a note takes a title ("El Ancla Rota") and a cover picture and shows its word count; wh_create_note takes a title');
    passed.push('Bridge: wh_kanban adds a card with a note and a chapter link to "Hecho", moves it to the top of "Ideas" by name (undo moves it back) and refuses to remove a column with cards');
  } finally {
    await act(async () => { try { root.unmount(); } catch { /* unmounted */ } await pause(); });
    await db.writings.where('projectId').equals(P).delete();
    await db.notes.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
