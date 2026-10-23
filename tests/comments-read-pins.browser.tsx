// Comments depth: read state and positional pins.
//  - unread badge, "unread first" sort, "mark all as read" (with undo), a thread marking itself read when
//    opened, threads made or answered through the bridge arriving unread, "only unread" and the
//    "only this document" filter;
//  - a comment pinned to a point of a board (right-click, "Comentar aquí"): it follows zoom and survives a
//    reload; clicking the pin opens its thread; and one pinned to a point of an image map;
//  - the bridge: unreadOnly, mark_read / mark_all_read with CAS and undo, board `at`, move.
import '@/engines';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import AnnotationsEngine from '@/engines/annotations/components/AnnotationsEngine';
import AnnotationsSidebarBadge from '@/engines/annotations/components/AnnotationsSidebarBadge';
import MarginPanel from '@/engines/annotations/components/MarginPanel';
import BoardEngine from '@/engines/board/components/BoardEngine';
import MapCommentMarks from '@/components/maps/MapCommentMarks';
import { createAnnotation } from '@/engines/annotations/operations';
import { decodeAnnotationData, cloneAnnotationData } from '@/engines/annotations/portability';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { flushPendingWrites } from '@/services/pendingWrites';
import { useLocaleStore } from '@/stores/localeStore';
import type { Annotation } from '@/engines/annotations/types';
import type { Board } from '@/engines/board/types';
import type { Project } from '@/types';

const P = 'comments-read-pins', B = 'comments-pins-board', M = 'comments-pins-map', W = 'comments-pins-chapter';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 70) => new Promise(resolve => setTimeout(resolve, ms));
const click = async (node: Element | null, label = 'control') => { assert(node, `Missing ${label}`); await act(async () => { (node as HTMLElement).click(); await pause(); }); };
// Real pointer presses can suppress the browser's following click after
// preventDefault/pointer capture. Exercise the press itself, without .click().
const pressPin = async (node: Element | null, label: string) => {
  assert(node, `Missing ${label}`);
  const pin = node as HTMLElement;
  pin.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  await act(async () => { await pause(); });
  const box = pin.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  assert(hit && pin.contains(hit), `${label} must receive real pointer input; hit ${hit?.tagName}.${hit?.getAttribute('class')}, pointer-events=${getComputedStyle(pin).pointerEvents}`);
  // Synthetic PointerEvents do not register an active native pointer.
  // Pointer capture is unrelated to whether a stationary press opens a thread.
  pin.setPointerCapture = () => undefined;
  const fire = (type: string) => pin.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true,
    pointerId: 81, pointerType: 'mouse', isPrimary: true, button: 0,
    buttons: type === 'pointerdown' ? 1 : 0, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
  await act(async () => { fire('pointerdown'); await pause(30); fire('pointerup'); await pause(); });
};
const select = async (node: Element | null, value: string, label = 'select') => { assert(node, `Missing ${label}`); await act(async () => { (node as HTMLSelectElement).value = value; node!.dispatchEvent(new Event('change', { bubbles: true })); await pause(); }); };
const typeInto = async (node: Element | null, value: string) => { assert(node, 'Missing input'); await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, value); node!.dispatchEvent(new Event('input', { bubbles: true })); await pause(); }); };
const settle = async (test: () => boolean | Promise<boolean>, message: string, tries = 100) => { for (let i = 0; i < tries; i++) { if (await test()) return; await act(async () => { await pause(50); }); } throw new Error(`Timed out: ${message}`); };
const button = (host: Element, label: string) => [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === label) ?? null;

type ListResult = { count: number; unreadCount: number; annotations: { id: string; unread: boolean; readAt?: number; at?: { x: number; y: number }; atSpace?: string; revision: number }[] };

export async function testCommentsReadPins(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es', loaded: true });
  const passed: string[] = [], host = document.getElementById('root')!, root = createRoot(host);
  const project = { id: P, title: 'Chinchetas', description: '', mode: 'custom', type: 'standalone', color: '#777777', status: 'draft', enabledEngines: ['annotations', 'writings', 'board', 'maps', 'codex'], engineOrder: [], createdAt: 1, updatedAt: 1 } as Project;
  const scope = { projectId: P };
  const row = (id: string, extra: Partial<Annotation> = {}): Annotation => ({ id, projectId: P, sourceEngineId: 'writings', sourceEntityId: W, noteType: 'text', noteBody: `Nota ${id}`, anchor: { type: 'entity' }, isOrphaned: false, position: 0, createdAt: 10, updatedAt: 10, ...extra });
  const mountDashboard = async () => {
    await act(async () => { root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: 'read-pins', projectId: P, visible: true, navigate: () => undefined }}><div className="p-5"><AnnotationsSidebarBadge projectId={P} /><AnnotationsEngine projectId={P} /></div></EnginePaneContext.Provider></MemoryRouter>); await pause(200); });
  };
  // The focused runner loads no stylesheets; the board's geometry needs the canvas layer rules the xyflow stylesheet gives it.
  const sheet = document.createElement('style');
  sheet.textContent = '.react-flow{position:relative;overflow:hidden;width:100%;height:560px!important}.react-flow__renderer,.react-flow__pane,.react-flow__viewport-portal{position:absolute;width:100%;height:100%;top:0;left:0}.react-flow__pane{z-index:1}.react-flow__viewport{position:absolute;transform-origin:0 0;top:0;left:0;width:100%;height:100%;z-index:2;pointer-events:none}.react-flow__background{pointer-events:none;z-index:-1}.react-flow__panel{position:absolute;z-index:5;margin:15px}.react-flow__panel.top{top:0}.react-flow__panel.bottom{bottom:0}.react-flow__panel.left{left:0}.react-flow__panel.right{right:0}';
  document.head.appendChild(sheet);
  const thread = (id: string) => host.querySelector<HTMLElement>(`[data-comment-thread="${id}"]`);
  const order = () => [...host.querySelectorAll<HTMLElement>('[data-comment-thread]')].map(node => node.dataset.commentThread);
  try {
    await db.projects.put(project);
    await db.writings.put({ id: W, projectId: P, title: 'El puerto', content: '<p>Texto.</p>', status: 'draft', wordCount: 1, tags: [], createdAt: 1, updatedAt: 1 } as never);
    await db.boards.put({ id: B, projectId: P, title: 'Pistas', surface: 'white', viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 } as Board);
    await db.worldMaps.put({ id: M, projectId: P, title: 'Costa', features: [], createdAt: 1, updatedAt: 1 } as never);

    // ---- Read state in the comment list ----------------------------------------------------------------------
    // A legacy thread (no readAt) and one the writer made are read; the bridge's are not.
    await createAnnotation(row('legacy', { position: 0, createdAt: 10 }));
    await createAnnotation(row('mine', { position: 1, createdAt: 20, readAt: 20 }));
    const viaBridge = await runBridgeTool('wh_annotate', { projectId: P, engineId: 'writings', entityId: W, note: '¿Seguro que el faro es rojo?' });
    assert(viaBridge.ok, `Annotate ${JSON.stringify(viaBridge)}`);
    const bridgeId = (viaBridge.result as { id: string }).id;
    const stored = (await db.annotations.get(bridgeId))!;
    assert(stored.readAt === 0, `A bridge thread starts unread: ${stored.readAt}`);
    const board0 = await runBridgeTool('wh_annotate', { projectId: P, engineId: 'board', entityId: B, note: 'Falta una pista aquí', at: { x: 300, y: 200 } });
    assert(board0.ok, `Board annotate ${JSON.stringify(board0)}`);
    const boardBridgeId = (board0.result as { id: string }).id;
    passed.push('A thread the writer made or one from before read state is read; a thread made through wh_annotate starts unread (readAt 0)');

    await mountDashboard();
    await settle(() => !!thread(bridgeId) && !!thread('legacy') && !!thread('mine'), 'threads listed');
    assert(host.querySelector('[data-comment-unread-count="2"]'), 'List counts 2 unread');
    assert(host.querySelector('[data-testid="annotations-unread-badge"]')?.textContent === '2', `Sidebar badge ${host.querySelector('[data-testid="annotations-unread-badge"]')?.textContent}`);
    assert(thread(bridgeId)!.dataset.commentUnread === 'true' && !thread('legacy')!.dataset.commentUnread && !thread('mine')!.dataset.commentUnread, 'Only bridge threads are marked unread');
    passed.push('The list shows "2 sin leer", the unread cards carry a chip and the sidebar pill reads 2');

    // Sort: by position the unread bridge threads come last (the older, read ones first); "sin leer primero" lifts them.
    const before = order();
    assert(before.indexOf('legacy') < before.indexOf(bridgeId), `Default order ${before}`);
    await select(host.querySelector('[data-comment-sort]'), 'unread', 'sort');
    const after = order();
    assert(after.slice(0, 2).every(id => id === bridgeId || id === boardBridgeId) && after.indexOf(bridgeId) < after.indexOf('legacy') && after.indexOf('legacy') < after.indexOf('mine'), `Unread first ${after}`);
    await select(host.querySelector('[data-comment-sort]'), 'order', 'sort');
    // Only unread.
    await click(host.querySelector('[data-comment-only-unread]'), 'only unread');
    assert(order().length === 2 && !thread('legacy'), `Only unread ${order()}`);
    await click(host.querySelector('[data-comment-only-unread]'), 'only unread off');
    passed.push('"Sin leer primero" lifts unread threads without disturbing the rest; "Solo sin leer" narrows the list');

    // Only this document.
    const filter = host.querySelector<HTMLSelectElement>('[data-comment-document-filter]');
    assert(filter && [...filter.options].length === 3, `Document filter options ${filter && [...filter.options].map(o => o.textContent)}`);
    await select(filter, JSON.stringify(['board', B]), 'document filter');
    assert(order().join() === boardBridgeId, `Board only ${order()}`);
    await select(host.querySelector('[data-comment-document-filter]'), JSON.stringify(['writings', W]), 'document filter');
    assert(order().length === 3 && !thread(boardBridgeId), `Chapter only ${order()}`);
    await select(host.querySelector('[data-comment-document-filter]'), '', 'document filter');
    assert(order().length === 4, `All documents ${order()}`);
    passed.push('"Solo este documento" narrows the project list to one document (board 1 thread, chapter 3) and back to all 4');

    // Opening a thread marks it read, without touching its revision or an Undo.
    const revisionBefore = (await db.annotations.get(bridgeId))!.revision ?? 0;
    await click(thread(bridgeId), 'unread thread');
    await settle(async () => ((await db.annotations.get(bridgeId))!.readAt ?? 0) > 0, 'opened thread read');
    assert((await db.annotations.get(bridgeId))!.revision === revisionBefore, 'Reading does not change the revision');
    await settle(() => host.querySelector('[data-comment-unread-count="1"]') !== null && host.querySelector('[data-testid="annotations-unread-badge"]')?.textContent === '1', 'counts drop to 1');
    assert(!thread(bridgeId)!.dataset.commentUnread, 'Card no longer unread');
    passed.push('Opening a thread (click) marks it read: stored readAt > 0, same revision, the list says 1 and the sidebar pill 1');

    // Mark as unread by hand, then mark all as read and undo it.
    await click(thread(bridgeId)!.querySelector('[data-comment-read-toggle]'), 'toggle');
    await settle(async () => (await db.annotations.get(bridgeId))!.readAt === 0, 'marked unread again');
    await settle(() => host.querySelector('[data-comment-unread-count="2"]') !== null, 'two unread again');
    await click(host.querySelector('[data-comment-mark-all-read]'), 'mark all');
    await settle(async () => (await db.annotations.get(bridgeId))!.readAt! > 0 && (await db.annotations.get(boardBridgeId))!.readAt! > 0, 'all read');
    assert(!host.querySelector('[data-comment-unread-count]') && !host.querySelector('[data-testid="annotations-unread-badge"]'), 'No counters left');
    await click(host.querySelector('[data-comment-undo]'), 'undo mark all');
    await settle(async () => (await db.annotations.get(bridgeId))!.readAt === 0 && (await db.annotations.get(boardBridgeId))!.readAt === 0, 'undo restores unread');
    assert((await db.annotations.get('legacy'))!.readAt === undefined, 'Undo leaves read threads untouched');
    passed.push('"Marcar como no leído" works per thread; "Marcar todo como leído" reads every unread thread at once and Undo puts exactly those back');

    // ---- Bridge ------------------------------------------------------------------------------------------------
    const list1 = (await runBridgeTool('wh_list_annotations', { projectId: P, unreadOnly: true })).result as ListResult;
    assert(list1.count === 2 && list1.unreadCount === 2 && list1.annotations.every(item => item.unread && item.readAt === 0), `unreadOnly ${JSON.stringify(list1)}`);
    const mine = (await db.annotations.get('mine'))!;
    const reply = await runBridgeTool('wh_annotation_reply', { projectId: P, id: 'mine', expectedRevision: mine.revision ?? 0, body: 'Revisé la fecha: es del año 3.' });
    assert(reply.ok, `Reply ${JSON.stringify(reply)}`);
    const replied = (await db.annotations.get('mine'))!;
    assert(replied.replies![0].fromBridge === true, 'Bridge reply is flagged');
    const thread1 = (await runBridgeTool('wh_annotation_thread_get', { projectId: P, id: 'mine' })).result as { unread: boolean };
    assert(thread1.unread, 'A bridge reply on a read thread makes it unread');
    const stale = await runBridgeTool('wh_annotation_mark_read', { projectId: P, id: 'mine', expectedRevision: mine.revision ?? 0 });
    assert(!stale.ok, 'mark_read refuses a stale revision');
    const read = await runBridgeTool('wh_annotation_mark_read', { projectId: P, id: 'mine', expectedRevision: replied.revision ?? 0 });
    assert(read.ok && ((await db.annotations.get('mine'))!.readAt ?? 0) > 0 && (await db.annotations.get('mine'))!.revision === replied.revision, `mark_read ${JSON.stringify(read)}`);
    const undone = await runBridgeTool('wh_annotation_undo', { projectId: P, receipt: (read.result as { undo: unknown }).undo });
    assert(undone.ok && (await db.annotations.get('mine'))!.readAt === 20, `undo mark_read ${JSON.stringify(undone)}`);
    const unreadAgain = await runBridgeTool('wh_annotation_mark_read', { projectId: P, id: 'mine', expectedRevision: replied.revision ?? 0, read: false });
    assert(unreadAgain.ok && (await db.annotations.get('mine'))!.readAt === 0, 'read:false marks unread');
    const marked = await runBridgeTool('wh_annotation_mark_all_read', { projectId: P, engineId: 'board', entityId: B });
    assert(marked.ok && (marked.result as { marked: number }).marked === 1 && (await db.annotations.get(boardBridgeId))!.readAt! > 0 && (await db.annotations.get('mine'))!.readAt === 0, `mark_all_read scoped to a document ${JSON.stringify(marked)}`);
    const back = await runBridgeTool('wh_annotation_undo', { projectId: P, receipt: (marked.result as { undo: unknown }).undo });
    assert(back.ok && (await db.annotations.get(boardBridgeId))!.readAt === 0, `batch undo ${JSON.stringify(back)}`);
    const again = await runBridgeTool('wh_annotation_undo', { projectId: P, receipt: (marked.result as { undo: unknown }).undo });
    assert(!again.ok, 'A batch receipt is single use');
    const all = await runBridgeTool('wh_annotation_mark_all_read', { projectId: P });
    assert(all.ok && (all.result as { marked: number }).marked === 3, `mark all ${JSON.stringify(all)}`);
    const none = (await runBridgeTool('wh_list_annotations', { projectId: P, unreadOnly: true })).result as ListResult;
    assert(none.count === 0, 'Nothing unread after mark_all_read');
    passed.push('Bridge: unreadOnly + unread/readAt/unreadCount; a bridge reply makes a read thread unread; mark_read (CAS, read:false, Undo) and mark_all_read (per document, one batch Undo, single use)');

    // ---- Board pins -------------------------------------------------------------------------------------------
    await runBridgeTool('wh_annotation_mark_all_read', { projectId: P });
    const board0Row = (await db.annotations.get(boardBridgeId))!;
    assert(board0Row.anchor.type === 'board_point' && board0Row.anchor.x === 300 && board0Row.anchor.y === 200, `Board anchor ${JSON.stringify(board0Row.anchor)}`);
    const listed = (await runBridgeTool('wh_list_annotations', { projectId: P, engineId: 'board', entityId: B })).result as ListResult;
    assert(listed.annotations[0].at?.x === 300 && listed.annotations[0].atSpace === 'board', `List at ${JSON.stringify(listed.annotations[0])}`);
    for (const bad of [{ at: { x: 'a', y: 3 } }, { at: { x: 1, y: 2 }, quote: 'x' }, { at: { x: Infinity, y: 2 } }]) {
      assert(!(await runBridgeTool('wh_annotate', { projectId: P, engineId: 'board', entityId: B, note: 'x', ...bad })).ok, `Accepted ${JSON.stringify(bad)}`);
    }
    assert(!(await runBridgeTool('wh_annotate', { projectId: P, engineId: 'writings', entityId: W, note: 'x', at: { x: 1, y: 2 } })).ok, '`at` accepted on a chapter');

    const mountBoard = async () => {
      await act(async () => { root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: 'board-pins', projectId: P, visible: true, navigate: () => undefined }}><div style={{ width: 1100 }}><BoardEngine projectId={P} /></div></EnginePaneContext.Provider></MemoryRouter>); await pause(500); });
      await settle(() => !!host.querySelector('.react-flow__pane') && !!host.querySelector('[data-board-comments]'), 'board mounted');
    };
    await mountBoard();
    // Right-click on the empty board → "Comentar aquí" → write → save.
    const pane = host.querySelector<HTMLElement>('.react-flow__pane')!, box = pane.getBoundingClientRect();
    const where = { x: box.left + 237, y: box.top + 163 };
    await act(async () => { pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: where.x, clientY: where.y })); await pause(100); });
    await click(host.querySelector('[data-testid="board-menu-comment-here"]'), 'Comentar aquí');
    await settle(() => !!host.querySelector('[data-board-comments] textarea'), 'composer open');
    await typeInto(host.querySelector('[data-board-comments] textarea'), 'Aquí falta el mapa del sótano.');
    await click(button(host.querySelector('[data-board-comments]')!, 'Guardar'), 'save');
    await settle(async () => (await db.annotations.where('sourceEntityId').equals(B).toArray()).length === 2, 'pin saved');
    const mineOnBoard = (await db.annotations.where('sourceEntityId').equals(B).toArray()).find(item => item.noteBody?.startsWith('Aquí falta'))!;
    const flowX = mineOnBoard.anchor.x!, flowY = mineOnBoard.anchor.y!;
    assert(mineOnBoard.anchor.type === 'board_point' && Math.abs(flowX - (where.x - box.left + 0)) < 2 && Math.abs(flowY - (where.y - box.top)) < 2 && mineOnBoard.readAt! > 0, `Pin anchor ${JSON.stringify(mineOnBoard.anchor)} readAt ${mineOnBoard.readAt}`);
    passed.push(`Board: right-click "Comentar aquí" saves a board_point (${flowX}, ${flowY}) in board coordinates, read from the start`);

    const viewport = () => { const style = host.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform; const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(style); assert(m, `viewport transform ${style}`); return { tx: +m[1], ty: +m[2], z: +m[3] }; };
    const checkPin = (id: string, x: number, y: number, label: string) => {
      const pin = host.querySelector<HTMLElement>(`[data-testid="board-comment-pin-${id}"]`);
      assert(pin, `${label}: pin missing`);
      const rect = pin.getBoundingClientRect(), paneBox = host.querySelector('.react-flow')!.getBoundingClientRect(), v = viewport();
      const ex = paneBox.left + v.tx + x * v.z, ey = paneBox.top + v.ty + y * v.z;
      assert(Math.abs(rect.left + rect.width / 2 - ex) < 2 && Math.abs(rect.bottom - ey) < 2, `${label}: pin at ${Math.round(rect.left + rect.width / 2)},${Math.round(rect.bottom)} expected ${Math.round(ex)},${Math.round(ey)} (zoom ${v.z})`);
      assert(Math.abs(rect.width - 24) < 2, `${label}: pin keeps its size (${rect.width})`);
      return v.z;
    };
    await settle(() => !!host.querySelector(`[data-testid="board-comment-pin-${mineOnBoard.id}"]`) && !!host.querySelector(`[data-testid="board-comment-pin-${boardBridgeId}"]`), 'pins drawn');
    const z0 = checkPin(mineOnBoard.id, flowX, flowY, 'zoom 1'); checkPin(boardBridgeId, 300, 200, 'zoom 1 (bridge pin)');
    // Zoom in with the canvas control: the pins stay on their points.
    for (let i = 0; i < 2; i++) await click(host.querySelector('.react-flow__controls-zoomin'), 'zoom in');
    await act(async () => { await pause(600); });
    const z1 = checkPin(mineOnBoard.id, flowX, flowY, 'zoomed in');
    assert(z1 > z0 * 1.3, `The canvas zoomed (${z0} -> ${z1})`);
    checkPin(boardBridgeId, 300, 200, 'zoomed in (bridge pin)');
    await act(async () => { await flushPendingWrites(); await pause(300); });
    passed.push(`Board pins stay on their board points through zoom (x${(z1 / z0).toFixed(2)}) and keep a 24px bubble`);

    // Reload: remount the whole engine; the viewport and the pins come back from storage.
    await act(async () => { root.render(<div />); await pause(200); });
    await mountBoard();
    await settle(() => !!host.querySelector(`[data-testid="board-comment-pin-${mineOnBoard.id}"]`), 'pins after reload');
    const z2 = checkPin(mineOnBoard.id, flowX, flowY, 'after reload');
    assert(Math.abs(z2 - z1) < 0.05, `Saved zoom restored (${z1} -> ${z2})`);
    passed.push('After a remount (reload) the saved viewport and the pins come back on the same points');

    // A bridge-made pin is unread; clicking it opens its thread and reads it.
    await runBridgeTool('wh_annotation_mark_read', { projectId: P, id: boardBridgeId, expectedRevision: (await db.annotations.get(boardBridgeId))!.revision ?? 0, read: false });
    await settle(() => host.querySelector(`[data-testid="board-comment-pin-${boardBridgeId}"]`)?.getAttribute('data-unread') === 'true', 'pin shows unread');
    const boardPressRevision = (await db.annotations.get(boardBridgeId))!.revision;
    await pressPin(host.querySelector(`[data-testid="board-comment-pin-${boardBridgeId}"]`), 'board pin');
    await settle(async () => ((await db.annotations.get(boardBridgeId))!.readAt ?? 0) > 0, 'pin click reads the thread');
    assert((await db.annotations.get(boardBridgeId))!.revision === boardPressRevision, 'A stationary board press reads without moving or editing the thread');
    assert(thread(boardBridgeId)?.textContent?.includes('En el tablero'), 'The thread names the spot on the board');
    await settle(() => host.querySelector(`[data-testid="board-comment-pin-${boardBridgeId}"]`)?.getAttribute('data-unread') === null, 'pin no longer unread');
    passed.push('An unread bridge pin shows a ring; pointerdown + pointerup without a synthetic click opens and reads the thread, drops the ring and keeps its revision');

    // Dragging a pin with the pointer moves it by the distance travelled in board units (screen / zoom) and saves it.
    const dragPin = host.querySelector<HTMLElement>(`[data-testid="board-comment-pin-${mineOnBoard.id}"]`)!;
    // The thread opened by the earlier pin click scrolls smoothly; wait until the page has stopped moving.
    let lastTop = -1; await settle(async () => { const top = dragPin.getBoundingClientRect().top; const still = top === lastTop; lastTop = top; await pause(250); return still; }, 'page scroll settled');
    const dragBox = dragPin.getBoundingClientRect();
    const fire = (type: string, dx: number, dy: number) => dragPin.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, button: 0, clientX: dragBox.left + 12 + dx, clientY: dragBox.top + 12 + dy }));
    const dragZoom = viewport().z;
        await act(async () => { fire('pointerdown', 0, 0); await pause(30); fire('pointermove', 40, 20); await pause(30); fire('pointermove', 72, 36); await pause(30); fire('pointerup', 72, 36); await pause(200); });
    await settle(async () => Math.abs((await db.annotations.get(mineOnBoard.id))!.anchor.x! - (flowX + 72 / dragZoom)) < 1.5, 'dragged pin saved');
    const draggedRow = (await db.annotations.get(mineOnBoard.id))!;
    assert(Math.abs(draggedRow.anchor.y! - (flowY + 36 / dragZoom)) < 1.5 && (draggedRow.revision ?? 0) > (mineOnBoard.revision ?? 0), `Drag y ${JSON.stringify(draggedRow.anchor)}`);
    await act(async () => { await pause(300); });
    checkPin(mineOnBoard.id, draggedRow.anchor.x!, draggedRow.anchor.y!, 'dragged pin');
    passed.push('Dragging a board pin saves its new board point (screen distance / zoom) with a revision bump, and the pin stays under it');

    // Moving a pin over the bridge (board coordinates, CAS, Undo).
    const current = (await db.annotations.get(boardBridgeId))!;
    const moved = await runBridgeTool('wh_annotation_move', { projectId: P, id: boardBridgeId, expectedRevision: current.revision ?? 0, x: -120.5, y: 640 });
    assert(moved.ok && (await db.annotations.get(boardBridgeId))!.anchor.x === -120.5, `Move ${JSON.stringify(moved)}`);
    await settle(() => true, 'tick'); await act(async () => { await pause(300); });
    checkPin(boardBridgeId, -120.5, 640, 'moved pin');
    const movedBack = await runBridgeTool('wh_annotation_undo', { projectId: P, receipt: (moved.result as { undo: unknown }).undo });
    assert(movedBack.ok && (await db.annotations.get(boardBridgeId))!.anchor.x === 300, 'Move undone');
    assert(!(await runBridgeTool('wh_annotation_move', { projectId: P, id: boardBridgeId, expectedRevision: current.revision ?? 0, x: 1, y: 1 })).ok, 'Stale move refused');
    passed.push('wh_annotation_move takes a board pin to board coordinates (negative too), refuses a stale revision and its receipt puts it back');

    // ---- Image-map point pin ----------------------------------------------------------------------------------
    const made = await runBridgeTool('wh_annotate', { projectId: P, engineId: 'maps', entityId: M, note: '¿Puente o barca?', at: { x: 42.5, y: 61 } });
    assert(made.ok, `Map annotate ${JSON.stringify(made)}`);
    const mapNote = (made.result as { id: string }).id;
    assert((await db.annotations.get(mapNote))!.readAt === 0, 'Map comment from the bridge starts unread');
    const toPicture = (x: number, y: number) => { const box = host.querySelector('[data-review-map-surface]')!.getBoundingClientRect(); return { x: (x - box.left) / box.width * 100, y: (y - box.top) / box.height * 100 }; };
    await act(async () => { root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: 'map-pins', projectId: P, visible: true, navigate: () => undefined }}><div style={{ width: 600 }}><div data-review-map-surface style={{ position: 'relative', width: 400, height: 300 }}><MapCommentMarks projectId={P} mapId={M} toPicture={toPicture} /></div><MarginPanel projectId={P} engineId="maps" entityId={M} /></div></EnginePaneContext.Provider></MemoryRouter>); await pause(300); });
    await settle(() => !!host.querySelector(`[data-testid="map-comment-${mapNote}"]`), 'map pin drawn');
    const markEl = host.querySelector<HTMLElement>(`[data-testid="map-comment-${mapNote}"]`)!;
    assert(markEl.style.left === '42.5%' && markEl.style.top === '61%' && markEl.dataset.unread === 'true', `Map pin ${markEl.style.left} ${markEl.style.top} unread=${markEl.dataset.unread}`);
    assert(thread(mapNote)?.textContent?.includes('En el mapa'), 'Map thread names the spot');
    const mapPressRevision = (await db.annotations.get(mapNote))!.revision;
    await pressPin(markEl, 'map pin');
    await settle(async () => ((await db.annotations.get(mapNote))!.readAt ?? 0) > 0, 'map pin reads the thread');
    const mapAfterPress = (await db.annotations.get(mapNote))!;
    assert(mapAfterPress.revision === mapPressRevision && mapAfterPress.anchor.x === 42.5 && mapAfterPress.anchor.y === 61, 'A stationary map press reads without moving or editing the thread');
    await settle(() => host.querySelector<HTMLElement>(`[data-testid="map-comment-${mapNote}"]`)?.dataset.unread === undefined, 'map pin no longer unread');
    passed.push('Image map: a draggable point comment opens and reads on pointerdown + pointerup without a synthetic click; it drops its unread ring and keeps position and revision');

    // ---- Archives and clones -------------------------------------------------------------------------------------
    const exported = await db.annotations.where('projectId').equals(P).toArray();
    const decoded = decodeAnnotationData({ annotations: exported, annotationReferences: [] }, P);
    assert(decoded.annotations.some(item => item.anchor.type === 'board_point' && item.anchor.x === 300), 'Board pin survives an archive');
    assert(decoded.annotations.find(item => item.id === 'mine')!.replies![0].fromBridge === true, 'Reply flag survives an archive');
    let refused = false; try { decodeAnnotationData({ annotations: [{ ...exported[0], anchor: { type: 'board_point', x: 'a', y: 1 } }], annotationReferences: [] }, P); } catch { refused = true; }
    assert(refused, 'A broken board pin is refused');
    const cloned = cloneAnnotationData(decoded, 'other', (id, prefix) => `${prefix}-${id}`);
    assert(cloned.annotations.find(item => item.id.endsWith('mine'))!.readAt === (await db.annotations.get('mine'))!.readAt, 'readAt is cloned with the thread');
    passed.push('Archives and clones keep board pins, readAt and the bridge-reply flag, and refuse a malformed board pin');
    return passed;
  } finally {
    await act(async () => { root.unmount(); });
    sheet.remove();
    await db.annotations.where('projectId').equals(P).delete();
    await db.boardNodes.where('boardId').equals(B).delete();
    await db.boards.delete(B); await db.worldMaps.delete(M); await db.writings.delete(W); await db.projects.delete(P);
  }
}
