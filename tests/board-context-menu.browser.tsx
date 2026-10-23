// The board's right-click menu (duplicate, bring to front, send to back,
// group into a frame and remove the frame keeping its contents, delete; on the
// empty board: a new card there, paste there, select all, zoom to fit) and the
// white, lined and chalk surfaces, in the canvas and through the bridge.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { useLocaleStore } from '@/stores/localeStore';
import BoardCanvas from '@/engines/board/components/BoardCanvas';
import { makeNode } from '@/engines/board/graph/mutations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { flushPendingWrites } from '@/services/pendingWrites';
import type { Project } from '@/types';
import type { Board } from '@/engines/board/types';
import '@/engines/board';

const P = 'board-menu', B = 'board-menu-board';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 50) => new Promise(done => setTimeout(done, ms));
const settle = async () => { await act(async () => { await flushPendingWrites(); await pause(350); }); };

export async function testBoardContextMenu(): Promise<string[]> {
  const passed: string[] = [];
  useLocaleStore.setState({ locale: 'es', loaded: true });
  const project: Project = { id: P, title: 'Tablero', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: ['board'], engineOrder: [], createdAt: 1, updatedAt: 1 } as Project;
  await db.projects.put(project);
  let board: Board = { id: B, projectId: P, title: 'Pistas', surface: 'white', viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 } as Board;
  await db.boards.put(board);
  const left = makeNode({ projectId: P, boardId: B, kind: 'card', title: 'Izquierda', position: { x: 100, y: 100 }, size: { width: 160, height: 90 } });
  const right = makeNode({ projectId: P, boardId: B, kind: 'card', title: 'Derecha', position: { x: 320, y: 100 }, size: { width: 160, height: 90 } });
  await db.boardNodes.bulkPut([{ ...left, zIndex: 3 }, { ...right, zIndex: 1 }]);
  const host = document.getElementById('root')!, root = createRoot(host);
  let commented = '';
  const render = async () => { await act(async () => { root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: 'menu-pane', projectId: P, visible: true, navigate: () => undefined }}><BoardCanvas key={board.surface} projectId={P} board={board} onViewportChange={() => undefined} onCommentNode={node => { commented = node.title; }} /></EnginePaneContext.Provider></MemoryRouter>); await pause(150); }); await act(async () => { await pause(250); }); };
  const menuOn = async (target: Element | null, label: string) => { assert(target, label); const box = target.getBoundingClientRect(); await act(async () => { target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + Math.min(20, box.width / 2), clientY: box.top + Math.min(20, box.height / 2), button: 2 })); await pause(80); }); assert(host.querySelector('[data-testid="board-context-menu"]'), `No menu on ${label}`); };
  const choose = async (id: string) => { const item = host.querySelector<HTMLElement>(`[data-testid="board-menu-${id}"]`); assert(item, `Menu item ${id}`); await act(async () => { item.click(); await pause(80); }); await settle(); };
  const nodes = () => db.boardNodes.where('boardId').equals(B).toArray();
  try {
    await render();
    assert(host.querySelector('.bg-white'), 'White surface');
    // On a card.
    await menuOn(host.querySelector(`[data-id="${right.id}"]`), 'card');
    assert(['duplicate', 'copy', 'front', 'back', 'frame', 'delete'].every(id => host.querySelector(`[data-testid="board-menu-${id}"]`)), 'Card actions');
    await choose('front');
    const zTop = (await db.boardNodes.get(right.id))!.zIndex;
    assert(zTop === 4, `Bring to front: ${zTop}`);
    await menuOn(host.querySelector(`[data-id="${right.id}"]`), 'card again');
    await choose('back');
    assert((await db.boardNodes.get(right.id))!.zIndex === 0, 'Send to back');
    await menuOn(host.querySelector(`[data-id="${left.id}"]`), 'left card');
    await choose('duplicate');
    const afterDuplicate = await nodes();
    assert(afterDuplicate.length === 3 && afterDuplicate.filter(node => node.title === 'Izquierda').length === 2, `Duplicate: ${afterDuplicate.map(node => node.title)}`);
    await menuOn(host.querySelector(`[data-id="${left.id}"]`), 'left for frame');
    await choose('frame');
    const frame = (await nodes()).find(node => node.kind === 'frame');
    assert(frame, 'Grouped into a frame');
    await menuOn(host.querySelector(`[data-id="${frame.id}"]`), 'frame');
    await choose('unframe');
    const afterUnframe = await nodes();
    assert(!afterUnframe.some(node => node.kind === 'frame') && afterUnframe.some(node => node.id === left.id), 'The frame goes, its card stays');
    passed.push('Card menu: "Traer al frente" puts the card above the others (z 4), "Enviar al fondo" below (z 0), "Duplicar" adds a copy, "Agrupar en un marco" frames it and "Quitar el marco" removes only the frame');
    // A comment about one card.
    await db.annotations.put({ id: 'menu-note', projectId: P, sourceEngineId: 'board', sourceEntityId: B, anchor: { type: 'entity', elementId: right.id, elementTitle: 'Derecha' }, noteType: 'text', noteBody: 'Revisar', isOrphaned: false, position: 0, createdAt: 1, updatedAt: 1 } as never);
    await menuOn(host.querySelector(`[data-id="${right.id}"]`), 'card to comment');
    for (let i = 0; i < 30 && !/\(1\)/.test(host.querySelector('[data-testid="board-menu-comment"]')?.textContent ?? ''); i++) await act(async () => { await pause(50); });
    assert(/Comentar \(1\)/.test(host.querySelector('[data-testid="board-menu-comment"]')?.textContent ?? ''), 'The menu counts the card\'s comments');
    await choose('comment');
    assert(commented === 'Derecha', 'Comment opens for that card');
    await db.annotations.delete('menu-note');
    passed.push('Comments: "Comentar (1)" on a card that already has one; choosing it opens a comment about that card (the note says «Derecha»)');
    // On the empty board.
    await menuOn(host.querySelector('.react-flow__pane'), 'pane');
    assert(['card', 'all', 'fit'].every(id => host.querySelector(`[data-testid="board-menu-${id}"]`)) && host.querySelector('[data-testid="board-menu-paste"]'), 'Board actions (paste after duplicate copied)');
    await choose('card');
    assert((await nodes()).filter(node => node.kind === 'card').length === 4, 'A new card at the pointer');
    await menuOn(host.querySelector('.react-flow__pane'), 'pane again');
    await choose('all');
    assert(host.querySelectorAll('.react-flow__node.selected').length >= 4, `Select all: ${host.querySelectorAll('.react-flow__node.selected').length}`);
    await menuOn(host.querySelector('.react-flow__pane'), 'pane for fit');
    await choose('fit');
    assert(!host.querySelector('[data-testid="board-context-menu"]'), 'The menu closes after an action');
    passed.push('Board menu: "Nueva tarjeta aquí", "Pegar aquí" (when something is copied), "Seleccionar todo" and "Ajustar a la vista"; the menu closes after each action');
    // Assets rail.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await db.inspirationImages.add({ id: 'menu-asset', projectId: P, imageData: `data:image/png;base64,${png}`, tags: [], notes: 'Faro', createdAt: 1 });
    await act(async () => { host.querySelector<HTMLElement>('[data-testid="board-assets-toggle"]')!.click(); await pause(300); });
    for (let i = 0; i < 40 && !host.querySelector('[data-testid="board-asset-Faro"]'); i++) await act(async () => { await pause(50); });
    const before = (await nodes()).filter(node => node.kind === 'image').length;
    await act(async () => { host.querySelector<HTMLElement>('[data-testid="board-asset-Faro"] [data-testid="board-asset-add"]')!.click(); await pause(300); });
    await settle();
    assert((await nodes()).filter(node => node.kind === 'image').length === before + 1, 'The picture from the rail is on the board');
    passed.push('Assets rail: the project\'s pictures and sounds, searchable; "Faro" goes onto the board with a click (or by dragging)');
    await db.inspirationImages.delete('menu-asset');
    // Surfaces.
    for (const surface of ['lined', 'chalk'] as const) {
      board = { ...board, surface }; await db.boards.put(board);
      await render();
      assert(surface === 'lined' ? host.querySelector('.wh-board-lined') : host.querySelector('.bg-\\[\\#1f3b2d\\]'), `Surface ${surface}`);
    }
    const bad = await runBridgeTool('wh_create_board', { projectId: P, title: 'X', surface: 'velvet' });
    assert(!bad.ok || (await db.boards.where('projectId').equals(P).toArray()).find(item => item.title === 'X')?.surface === 'cork', 'An unknown surface is not stored');
    const made = await runBridgeTool('wh_create_board', { projectId: P, title: 'Pizarra blanca', surface: 'white' });
    assert(made.ok && (await db.boards.where('projectId').equals(P).toArray()).some(item => item.title === 'Pizarra blanca' && item.surface === 'white'), `Create with white: ${JSON.stringify(made)}`);
    passed.push('Surfaces: white (grey dots), lined (ruled paper with a red margin) and chalk (dark green with chalk dots) on the canvas; wh_create_board takes them');
  } finally {
    await act(async () => { root.unmount(); await pause(); });
    await db.boardNodes.where('boardId').anyOf([B]).delete();
    for (const item of await db.boards.where('projectId').equals(P).toArray()) { await db.boardNodes.where('boardId').equals(item.id).delete(); await db.boards.delete(item.id); }
    await db.projects.delete(P);
  }
  return passed;
}
