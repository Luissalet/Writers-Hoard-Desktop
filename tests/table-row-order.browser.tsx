import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { Project } from '@/types';
import type { WorldTable } from '@/engines/tables/types';
import TablesEngine from '@/engines/tables/TablesEngine';
import { editTableRows, undoTableRows } from '@/engines/tables/rowActions';
import { changeTable, saveCell } from '@/engines/tables/operations';
import { readWorldDocument } from '@/services/worldEras/store';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { clearUndoJournal, getUndoJournal, undoLast } from '@/services/undoJournal';
import { useLocaleStore } from '@/stores/localeStore';
import { testTableRowOrderPure } from './table-row-order.pure';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const wait = () => new Promise(resolve => setTimeout(resolve, 40));
async function until(check: () => boolean, message: string) { for (let attempt = 0; attempt < 100; attempt++) { if (check()) return; await act(async () => { await wait(); }); } throw Error(message); }
async function seed(id: string) {
  const table: WorldTable = { id: `${id}-table`, title: 'QA row order', mode: 'table', columns: [{ id: 'name', name: 'Name', kind: 'text' }, { id: 'number', name: 'Number', kind: 'number' }], rows: ['Alfa', 'Bravo', 'Charlie'].map((id, index) => ({ id, cells: { name: id, number: String(index) } })) };
  await db.projects.put({ id, title: 'QA row order', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['tables'], createdAt: 1, updatedAt: 1, worldEras: [{ id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }], dataTables: [table, { ...structuredClone(table), id: `${id}-sibling`, title: 'Sibling' }] } as Project);
  return table;
}
const read = async (projectId: string, tableId: string, eraId?: string) => { const result = await readWorldDocument({ projectId, eraId }, 'tables', tableId); assert(result, 'Table missing'); return result; };
const order = (value: WorldTable) => value.rows.map(row => row.id).join();
async function rejects(work: () => Promise<unknown>, message: string) { let rejected = false; try { await work(); } catch { rejected = true; } assert(rejected, message); }

export async function testTableRowOrderContracts(): Promise<string[]> {
  const P = 'qa-table-order-contracts', table = await seed(P), scope = { projectId: P }, passed = testTableRowOrderPure();
  try {
    const before = await read(P, table.id), sibling = JSON.stringify((await db.projects.get(P))!.dataTables![1]);
    const moved = await runBridgeTool('wh_table_edit', { projectId: P, tableId: table.id, expectedVersion: before.version, action: 'move-row', rowId: 'Charlie', beforeRowId: 'Alfa' });
    assert(moved.ok, JSON.stringify(moved));
    const result = moved.result as { receiptId: string; version: string; __audit: { before: unknown; projectId: string; entityId: string; kind: string; summary: string } };
    assert(result.receiptId && result.__audit && order((await read(P, table.id)).document.root as unknown as WorldTable) === 'Charlie,Alfa,Bravo', 'Registered move failed');
    const noOpBefore = JSON.stringify(await db.projects.get(P));
    const noOp = await editTableRows(scope, table.id, { action: 'move-row', rowId: 'Charlie', beforeRowId: 'Alfa' }, result.version);
    assert(!noOp.receiptId && JSON.stringify(await db.projects.get(P)) === noOpBefore, 'No-op changed state');
    const stale = await runBridgeTool('wh_table_edit', { projectId: P, tableId: table.id, expectedVersion: before.version, action: 'move-row', rowId: 'Bravo' });
    assert(!stale.ok && JSON.stringify(await db.projects.get(P)) === noOpBefore, 'Stale move changed state');
    const undo = await runBridgeTool('__undo', { entry: { ...result.__audit, tool: 'wh_table_edit' } });
    assert(undo.ok && order((await read(P, table.id)).document.root as unknown as WorldTable) === 'Alfa,Bravo,Charlie', 'Registered Undo failed');
    await rejects(() => undoTableRows(scope, result.receiptId), 'Receipt replay accepted');
    assert(JSON.stringify((await db.projects.get(P))!.dataTables![1]) === sibling, 'Sibling changed');
    const version = (await read(P, table.id)).version;
    await saveCell(P, table.id, 'Alfa', 'name', 'Alfa changed', 'Alfa');
    await rejects(() => editTableRows(scope, table.id, { action: 'move-row', rowId: 'Charlie' }, version), 'Cell edit did not make row CAS stale');
    passed.push('Registered row CAS/no-op/Undo/single-use, sibling conservation and cell-vs-document concurrency');

    const beforeAbort = JSON.stringify(await db.projects.get(P)); let abortedReceipt = '', published = false;
    await rejects(() => db.transaction('rw', db.tables, async () => { const fresh = await read(P, table.id); const change = await editTableRows(scope, table.id, { action: 'insert-row', beforeRowId: 'Bravo' }, fresh.version, () => { published = true; }); abortedReceipt = change.receiptId!; throw Error('Intentional parent abort'); }), 'Parent should abort');
    assert(JSON.stringify(await db.projects.get(P)) === beforeAbort && !published, 'Aborted row insertion leaked');
    await rejects(() => undoTableRows(scope, abortedReceipt), 'Aborted receipt retained');
    const fresh = await read(P, table.id), changed = await editTableRows(scope, table.id, { action: 'insert-row', beforeRowId: 'Bravo' }, fresh.version);
    await rejects(() => db.transaction('rw', db.tables, async () => { await undoTableRows(scope, changed.receiptId!); throw Error('Intentional Undo abort'); }), 'Undo parent should abort');
    await undoTableRows(scope, changed.receiptId!);
    assert(order((await read(P, table.id)).document.root as unknown as WorldTable) === 'Alfa,Bravo,Charlie', 'Undo abort failed to release reservation');
    passed.push('Real parent abort removes row receipt and callback; Undo abort allows legitimate retry');

    const era = { projectId: P, eraId: 'past' }, inherited = await read(P, table.id, 'past');
    const variant = await editTableRows(era, table.id, { action: 'move-row', rowId: 'Charlie', beforeRowId: 'Alfa' }, inherited.version);
    assert((await read(P, table.id, 'past')).provenance === 'variant', 'First era write missing');
    await changeTable(P, table.id, current => { current.title = 'Later Base'; });
    await undoTableRows(era, variant.receiptId!);
    const restored = await read(P, table.id, 'past');
    assert(restored.provenance === 'base' && restored.document.root.title === 'Later Base', 'First era Undo failed current Base inheritance');
    const own = await editTableRows(era, table.id, { action: 'insert-row', beforeRowId: 'Bravo' }, restored.version);
    const ownRead = await read(P, table.id, 'past'), ownBefore = JSON.stringify(ownRead.document.root);
    const ownMove = await editTableRows(era, table.id, { action: 'move-row', rowId: 'Charlie', beforeRowId: 'Alfa' }, ownRead.version);
    await undoTableRows(era, ownMove.receiptId!);
    assert((await read(P, table.id, 'past')).provenance === 'variant' && JSON.stringify((await read(P, table.id, 'past')).document.root) === ownBefore, 'Own-era Undo lost authored root');
    await rejects(() => undoTableRows({ projectId: P, eraId: 'wrong' }, own.receiptId!), 'Foreign scope accepted');
    passed.push('Inherited era returns to current Base; own-era root remains own and scope-bound');
    return passed;
  } finally { await deleteProject(P); }
}

export async function testTableRowOrderUi(): Promise<string[]> {
  const P = 'qa-table-order-ui', table = await seed(P), host = document.getElementById('root'); assert(host, 'Missing renderer root');
  useLocaleStore.setState({ locale: 'es' }); clearUndoJournal(); const root = createRoot(host);
  const row = (id: string) => host.querySelector<HTMLElement>(`tr[data-row-id="${id}"]`)!;
  const names = () => [...host.querySelectorAll('tbody tr[data-row-id]')].map(element => element.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '');
  const openActions = async (id: string) => {
    await act(async () => { row(id).querySelector<HTMLElement>('summary')!.click(); await wait(); });
    const menu = row(id).querySelector<HTMLElement>('details > div')!, bounds = menu.getBoundingClientRect(), boxes = [...menu.querySelectorAll('button')].map(button => button.getBoundingClientRect());
    assert(boxes.length === 3 && boxes.every((box, index) => box.left >= bounds.left && box.right <= bounds.right && box.bottom <= bounds.bottom && (index === 0 || box.top >= boxes[index - 1].bottom)), 'Row menu actions do not stack inside popup');
  };
  const click = async (id: string, text: string) => { const button = [...row(id).querySelectorAll('button')].find(item => item.textContent === text)!; assert(button && !button.disabled, `Unavailable ${text}`); await act(async () => { button.click(); await wait(); }); };
  try {
    await act(async () => { root.render(<MemoryRouter><TablesEngine projectId={P} /></MemoryRouter>); await wait(); });
    await until(() => !!row('Bravo')?.querySelector<HTMLButtonElement>('button[data-table-row-handle]') && !row('Bravo').querySelector<HTMLButtonElement>('button[data-table-row-handle]')!.disabled, 'Row version never became ready');
    await openActions('Bravo'); await click('Bravo', 'Insertar fila encima');
    await until(() => names().join('|') === 'Alfa||Bravo|Charlie', 'Insert above wrong');
    assert(getUndoJournal().length === 1, 'Insertion not journalled');
    await act(async () => { await undoLast(P); await wait(); }); await until(() => names().join() === 'Alfa,Bravo,Charlie', 'UI Undo failed');
    await until(() => !row('Charlie').querySelector<HTMLButtonElement>('button[data-table-row-handle]')!.disabled, 'Move version not ready');
    await openActions('Charlie'); await click('Charlie', 'Subir fila');
    await until(() => names().join() === 'Alfa,Charlie,Bravo', 'Keyboard action failed');
    await until(() => !row('Charlie').querySelector<HTMLButtonElement>('button[data-table-row-handle]')!.disabled, 'Drag version not ready');
    await nativeTableRowPointer(row('Charlie').querySelector<HTMLButtonElement>('button[data-table-row-handle]')!, row('Alfa'));
    await until(() => names().join() === 'Charlie,Alfa,Bravo', 'Native pointer handlers failed');
    assert(order((await read(P, table.id)).document.root as unknown as WorldTable) === 'Charlie,Alfa,Bravo', 'UI order not persisted');
    return ['Normal TablesEngine Insert above, journal Undo, keyboard action and native pointer handlers preserve row IDs'];
  } finally { await act(async () => { root.unmount(); await wait(); }); clearUndoJournal(); await deleteProject(P); }
}

let manualRoot: ReturnType<typeof createRoot> | undefined;
const MANUAL = 'qa-table-row-order-manual';
/** Deliberately persistent, owned manual fixture; a reload must not reseed it. */
export async function mountTableRowOrderManual(): Promise<string[]> {
  const host = document.getElementById('root'); assert(host, 'Missing renderer root');
  if (!await db.projects.get(MANUAL)) await seed(MANUAL);
  useLocaleStore.setState({ locale: 'es' });
  await act(async () => { manualRoot?.unmount(); manualRoot = createRoot(host); manualRoot.render(<MemoryRouter><TablesEngine projectId={MANUAL} /></MemoryRouter>); await wait(); });
  await until(() => !!host.querySelector('tbody tr[data-row-id]'), 'Manual table did not mount');
  return [`Owned manual table mounted: ${MANUAL}. Insert above / drag / keyboard / normal journal Undo; reload preserves saved rows.`];
}
export async function inspectTableRowOrderManual(): Promise<string[]> {
  const project = await db.projects.get(MANUAL); assert(project?.dataTables, 'Manual fixture absent');
  return project.dataTables.map(table => JSON.stringify({ tableId: table.id, title: table.title, rows: table.rows, journal: getUndoJournal().filter(entry => entry.projectId === MANUAL) }));
}
export async function cleanupTableRowOrderManual(): Promise<string[]> {
  await act(async () => { manualRoot?.unmount(); manualRoot = undefined; await wait(); });
  await deleteProject(MANUAL);
  return ['Only the owned manual row-order project removed'];
}

/** Real mouse input through the existing private Electron runner, never a dispatched PointerEvent. */
export async function nativeTableRowPointer(handle: HTMLButtonElement, destination: HTMLElement, afterMove?: () => void | Promise<void>): Promise<void> {
  const channel = window as unknown as { __native?: { n: number; events: unknown[] } | null; __nativeAck?: number };
  let sequence = channel.__nativeAck ?? 0;
  const input = async (events: unknown[]) => { const n = ++sequence; await act(async () => { channel.__native = { n, events }; await until(() => channel.__nativeAck === n, 'Native pointer handshake missing'); }); };
  handle.scrollIntoView({ block: 'center', behavior: 'instant' }); await act(async () => { await wait(); });
  const from = handle.getBoundingClientRect(), to = destination.getBoundingClientRect(), x = Math.round(from.x + from.width / 2), y = Math.round(from.y + from.height / 2), targetY = Math.round(to.y + to.height / 2);
  assert(document.elementFromPoint(x, y)?.closest('button') === handle, 'Native pointer source occluded');
  assert(targetY > 0 && targetY < innerHeight, 'Native pointer destination outside viewport');
  await input([{ type: 'mouseMove', x, y }, { type: 'mouseDown', x, y, button: 'left', clickCount: 1 }]);
  for (let step = 1; step <= 8; step++) await input([{ type: 'mouseMove', x, y: Math.round(y + (targetY - y) * step / 8), button: 'left', modifiers: ['leftButtonDown'] }]);
  await afterMove?.();
  await input([{ type: 'mouseUp', x, y: targetY, button: 'left', clickCount: 1 }]);
}
