import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { db } from '@/db';
import '@/engines/board';
import { makeFreehandNode, simplifyBoardStroke } from '@/engines/board/freehand';
import { cloneSelection } from '@/engines/board/graph/mutations';
import { useBoardGraph, type BoardGraphApi } from '@/engines/board/hooks';
import { getAllBackupStrategies, preloadArchive } from '@/engines/_shared/backupRegistry';
import { flushPendingWrites } from '@/services/pendingWrites';
import { isCanvasShortcutTarget } from '@/engines/board/graph/interactions';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
export async function testBoardFreehand(): Promise<string[]> {
  const P = `board-freehand-${Date.now()}`, B = `${P}-board`, host = document.getElementById('root'); assert(host, 'Missing root');
  const root = createRoot(host), passed: string[] = [];
  let api: BoardGraphApi | null = null;
  function Harness() { const graph = useBoardGraph(B); useEffect(() => { api = graph; }, [graph]); return <p>{graph.nodes.length}</p>; }
  const current = (): BoardGraphApi => { assert(api, 'Graph API did not mount'); return api; };
  const flush = async () => act(async () => { assert(await current().flush(), 'Board queue flush failed'); assert((await flushPendingWrites()).ok, 'Pending writes did not flush'); await pause(); });
  try {
    const shortcutHost = document.createElement('div'), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), tool = document.createElement('button');
    shortcutHost.append(svg, tool); assert(isCanvasShortcutTarget(svg, shortcutHost), 'SVG drawing surface can focus the canvas for Escape/undo'); tool.append(svg); assert(!isCanvasShortcutTarget(svg, shortcutHost), 'Toolbar SVG icons keep shortcuts out of controls');
    const dense = Array.from({ length: 10000 }, (_, i) => ({ x: i / 10, y: i / 20 }));
    assert(simplifyBoardStroke(dense, 1).length === 2, 'Dense straight strokes simplify to their endpoints');
    const source = [{ x: -120, y: 80 }, { x: -60, y: 10 }, { x: 0, y: 100 }, { x: 80, y: 20 }, { x: 150, y: 110 }];
    const stroke = makeFreehandNode({ projectId: P, boardId: B, title: 'A hand-drawn path', color: '#d5b575', width: 4, points: source, layerId: 'travel' });
    assert(stroke?.freehand && stroke.kind === 'shape' && stroke.size.width >= 60 && stroke.size.height >= 60, 'Freehand uses the existing shape node model and minimum resize bounds');
    assert(stroke.freehand.points.every(point => point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100), 'Normalized stroke points remain within their node');
    const first = stroke.freehand.points[0]; assert(Math.abs(stroke.position.x + first.x * stroke.size.width / 100 - source[0].x) < .001, 'Normalization preserves exact source geometry in flow coordinates');
    assert(!makeFreehandNode({ projectId: P, boardId: B, title: '', color: '#fff', width: 3, points: [{ x: NaN, y: Infinity }] }), 'Invalid sample data cannot persist invalid geometry');
    const dot = makeFreehandNode({ projectId: P, boardId: B, title: 'Dot', color: '#fff', width: NaN, points: [{ x: 5, y: 7 }] }); assert(dot?.freehand?.points.length === 2 && dot.freehand.width === 3, 'A click becomes a bounded dot and invalid brush width uses its default');
    passed.push('Freehand geometry: dense simplification, negative coordinates, percent bounds, resize minima and invalid-input handling pass');
    await db.boards.put({ id: B, projectId: P, title: 'Sketch board', surface: 'slate', createdAt: 1, updatedAt: 1 });
    await act(async () => { root.render(<Harness />); await pause(100); });
    for (let i = 0; i < 100 && current().loading; i++) await act(async () => { await pause(); });
    await act(async () => { current().addNodes([stroke], 'Draw'); }); await flush();
    assert((await db.boardNodes.get(stroke.id))?.freehand?.points.length === 5 && current().canUndo, 'Completed stroke enters the existing command queue and is saved');
    await act(async () => { current().undo(); }); await flush(); assert(!(await db.boardNodes.get(stroke.id)), 'Undo removes the whole stroke as one operation');
    await act(async () => { current().redo(); }); await flush(); assert((await db.boardNodes.get(stroke.id))?.freehand?.points.length === 5, 'Redo restores exact stroke geometry');
    await act(async () => { current().patchNodes([{ id: stroke.id, changes: { color: '#4a9e6d', position: { x: 200, y: 150 }, size: { width: 400, height: 200 }, freehand: { ...stroke.freehand!, width: 7 } } }], 'Edit stroke'); }); await flush();
    const edited = (await db.boardNodes.get(stroke.id))!;
    assert(edited.freehand?.width === 7 && JSON.stringify(edited.freehand.points) === JSON.stringify(stroke.freehand.points) && edited.color === '#4a9e6d', 'Move/resize/color/width edits retain normalized authored geometry');
    const copy = cloneSelection([edited], [], { x: 30, y: 40 }, B, P).nodes[0];
    await act(async () => { current().addNodes([copy], 'Duplicate stroke'); }); await flush();
    assert(copy.id !== edited.id && copy.position.x === edited.position.x + 30 && JSON.stringify(copy.freehand) === JSON.stringify(edited.freehand), 'Existing duplicate/clipboard flow preserves stroke metadata');
    passed.push('Freehand lifecycle: command persistence, whole-stroke undo/redo, move/resize/color/width and duplication preserve the drawing');
    await act(async () => { root.render(null); await pause(); });
    await act(async () => { root.render(<Harness />); await pause(100); });
    for (let i = 0; i < 100 && current().loading; i++) await act(async () => { await pause(); });
    assert(current().nodes.filter(node => node.freehand).length === 2, 'Reopening reads the same local stroke records');
    const zip = new JSZip(), strategy = getAllBackupStrategies().find(strategy => strategy.engineId === 'board')!, projectDir = `projects/${P}`;
    await strategy.exportProject({ zip, projectId: P, projectDir }); await preloadArchive(zip);
    await act(async () => { root.render(null); });
    await db.boardNodes.where('boardId').equals(B).delete(); await db.boards.delete(B);
    await strategy.importProject({ zip, projectId: P, projectDir });
    assert((await db.boardNodes.where('boardId').equals(B).toArray()).filter(node => node.freehand).length === 2 && (await db.boardNodes.get(stroke.id))?.freehand?.width === 7, 'Existing board ZIP backups preserve freehand nodes without new schema');
    passed.push('Freehand portability: reopening and existing ZIP backup/restore retain all stroke geometry and styling');
    return passed;
  } finally {
    await act(async () => { root.unmount(); }); await db.boardNodes.where('projectId').equals(P).delete(); await db.boards.where('projectId').equals(P).delete();
  }
}
