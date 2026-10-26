import '@/services/aiBridge/dispatch';
import { act } from 'react';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { mountTableRowOrderManual, cleanupTableRowOrderManual, nativeTableRowPointer } from './table-row-order.browser';
import { readWorldDocument, saveEraDocument, saveWorldEra } from '@/services/worldEras/store';
import { editTableRows, undoTableRows } from '@/engines/tables/rowActions';
import { getUndoJournal } from '@/services/undoJournal';
import type { WorldTable } from '@/engines/tables/types';

function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const P = 'qa-table-row-order-manual', C = `${P}-native-control`, pause = () => new Promise(resolve => setTimeout(resolve, 40));
async function until(test: () => boolean, message: string, attempts = 300) { for (let i = 0; i < attempts; i++) { if (test()) return; await act(async () => { await pause(); }); } throw Error(message); }
async function snapshot() {
  return { project: await db.projects.get(P), control: await db.projects.get(C), variants: await db.worldEraVariants.where('projectId').equals(P).sortBy('id'), history: await db.documentHistory.where('projectId').equals(P).sortBy('id'), journal: structuredClone(getUndoJournal()) };
}
async function reject(work: () => Promise<unknown>, message: string) { let failed = false; try { await work(); } catch { failed = true; } check(failed, message); }

export async function testTableRowOrderNative(): Promise<string[]> {
  check(await db.projects.count() === 0, 'Native row-order profile must begin empty');
  await mountTableRowOrderManual();
  const project = (await db.projects.get(P))!, tableId = project.dataTables![0].id;
  await db.projects.add({ ...structuredClone(project), id: C, title: 'Untouched Native control', dataTables: project.dataTables!.map((table, index) => ({ ...structuredClone(table), id: `${C}-table-${index}` })) });
  await saveWorldEra(P, { id: 'own', name: 'Own Native era', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
  const own = { projectId: P, eraId: 'own' }, inherited = (await readWorldDocument(own, 'tables', tableId))!;
  await saveEraDocument(own, 'tables', inherited.document, inherited.version);
  const read = async (args: { eraId?: string } = {}) => readWorldDocument({ projectId: P, eraId: args.eraId }, 'tables', tableId);
  let closed = false;
  const cleanup = async () => { if (!closed) { await cleanupTableRowOrderManual(); await deleteProject(C); closed = true; } return { projects: await db.projects.count(), variants: await db.worldEraVariants.where('projectId').equals(P).count() }; };
  Reflect.set(window, '__tableNativeSnapshot', snapshot);
  Reflect.set(window, '__tableNativeRead', read);
  Reflect.set(window, '__tableNativeCleanup', cleanup);
  Reflect.set(window, '__tableNativeAbortProbe', async () => {
    const scope = { projectId: P }, before = JSON.stringify(await snapshot()); let receipt = '', announced = false;
    await reject(() => db.transaction('rw', db.tables, async () => { const current = (await read())!; const result = await editTableRows(scope, tableId, { action: 'insert-row', beforeRowId: 'Bravo' }, current.version, () => { announced = true; }); receipt = result.receiptId!; throw Error('Intentional Native renderer parent abort'); }), 'Parent did not abort');
    check(!announced && JSON.stringify(await snapshot()) === before, 'Parent abort leaked own project, history or journal');
    await reject(() => undoTableRows(scope, receipt), 'Aborted receipt remained available');
    const current = (await read())!, inserted = await editTableRows(scope, tableId, { action: 'insert-row', beforeRowId: 'Bravo' }, current.version);
    await reject(() => db.transaction('rw', db.tables, async () => { await undoTableRows(scope, inserted.receiptId!); throw Error('Intentional Native renderer Undo abort'); }), 'Undo root did not abort');
    await undoTableRows(scope, inserted.receiptId!);
    check(JSON.stringify((await read())!.document) === JSON.stringify(current.document), 'Undo retry after abort lost original table');
    return { parentAbortConserved: true, newReceiptUnavailable: true, undoAbortRetry: true, transportClaim: 'renderer domain probe, not stdio/HTTP transaction' };
  });
  Reflect.set(window, '__tableNativeReady', { projectId: P, controlId: C, tableId, siblingId: project.dataTables![1].id, eraId: 'past', ownEraId: 'own', mountedTable: true });
  try {
    await until(() => Reflect.get(window, '__tableNativeComplete') !== undefined, 'Native row-order driver did not complete', 5500);
    const result = Reflect.get(window, '__tableNativeComplete') as { ok: boolean; error?: string }; check(result.ok, result.error ?? 'Native row-order driver failed');
    check(closed, 'Native driver did not clean owned fixtures');
    return ['two-key stdio/HTTP/executor/IPC table row edits and authenticated HTTP audit Undo; separate renderer root-abort probes'];
  } finally { await cleanup(); }
}

/** Separate trusted-pointer oracle: does not borrow the mounted UI test's result. */
export async function testTableRowOrderTrustedPointer(): Promise<string[]> {
  check(await db.projects.count() === 0, 'Trusted-pointer profile must begin empty');
  await mountTableRowOrderManual();
  let pointerId = -1;
  const events: { type: string; trusted: boolean }[] = [], listener = (event: Event) => { if (event.type === 'pointerdown') pointerId = (event as PointerEvent).pointerId; events.push({ type: event.type, trusted: event.isTrusted }); };
  const pointerTypes = ['pointerdown', 'pointermove', 'pointerup'];
  for (const type of pointerTypes) document.addEventListener(type, listener, true);
  const row = (id: string) => document.querySelector<HTMLElement>(`tr[data-row-id="${id}"]`)!;
  try {
    await until(() => !!row('Charlie')?.querySelector<HTMLButtonElement>('button[data-table-row-handle]') && !row('Charlie').querySelector<HTMLButtonElement>('button[data-table-row-handle]')!.disabled, 'Trusted pointer row not ready');
    const handle = row('Charlie').querySelector<HTMLButtonElement>('button[data-table-row-handle]')!, baseline = JSON.stringify(await snapshot());
    await nativeTableRowPointer(handle, row('Charlie'));
    check(JSON.stringify(await snapshot()) === baseline, 'Sub-threshold handle click wrote rows or journal');
    await nativeTableRowPointer(handle, row('Alfa'), () => { handle.releasePointerCapture(pointerId); });
    check(JSON.stringify(await snapshot()) === baseline, 'Lost capture committed the abandoned gesture');
    await nativeTableRowPointer(handle, row('Alfa'), () => { handle.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId })); });
    check(JSON.stringify(await snapshot()) === baseline, 'Pointercancel handler committed the abandoned gesture');
    const committedEvents = events.length;
    await nativeTableRowPointer(handle, row('Alfa'));
    await until(() => [...document.querySelectorAll('tbody tr[data-row-id]')].map(node => node.getAttribute('data-row-id')).join() === 'Charlie,Alfa,Bravo', `Trusted pointer did not move row; captured events ${JSON.stringify(events)}`);
    check(pointerTypes.every(type => events.slice(committedEvents).some(event => event.type === type && event.trusted)), 'Trusted pointerdown/move/up events not established');
    const table = (await readWorldDocument({ projectId: P }, 'tables', `${P}-table`))!.document.root as unknown as WorldTable;
    check(table.rows.map(item => item.id).join() === 'Charlie,Alfa,Bravo', 'Trusted pointer order not saved');
    return ['actual Electron sendInputEvent pointer produced trusted pointerdown/move/up and persisted Charlie/Alfa/Bravo; sub-threshold/lostcapture conserve state, explicit pointercancel handler conserves state'];
  } finally { for (const type of pointerTypes) document.removeEventListener(type, listener, true); await cleanupTableRowOrderManual(); }
}
