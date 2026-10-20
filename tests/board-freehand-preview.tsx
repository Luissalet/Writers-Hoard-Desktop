import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import BoardCanvas from '@/engines/board/components/BoardCanvas';
import { makeNode, makeEdge } from '@/engines/board/graph/mutations';
import { flushPendingWrites } from '@/services/pendingWrites';
import { useLocaleStore } from '@/stores/localeStore';
import '@/index.css';

async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  const projectId = 'board-drawing-preview', board = { id: 'board-drawing-preview-board', projectId, title: 'El mapa que falta', surface: 'slate' as const, viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 };
  await db.boards.put(board);
  const clue = makeNode({ projectId, boardId: board.id, kind: 'card', position: { x: 290, y: 240 }, size: { width: 230, height: 150 }, title: 'Una carta sin remitente', content: 'El sello de la Orden de la Sal coincide con el dibujo del atlas.', role: 'clue', color: '#d5b575' });
  const note = makeNode({ projectId, boardId: board.id, kind: 'postit', position: { x: 720, y: 430 }, size: { width: 220, height: 140 }, title: '¿Quién cambió la frontera?', content: 'Comparar el atlas con la versión del año 431.', color: '#d5b575' });
  await db.boardNodes.bulkPut([clue, note]);
  await db.boardEdges.put(makeEdge({ projectId, boardId: board.id, sources: [{ id: clue.id, on: 'node' }], targets: [{ id: note.id, on: 'node' }], kind: 'mystery', label: 'Una pista incompleta' }));
  (window as unknown as { __readBoardStrokes: () => Promise<unknown> }).__readBoardStrokes = async () => { await flushPendingWrites(); return (await db.boardNodes.where('boardId').equals(board.id).toArray()).filter(node => node.freehand); };
  createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[`/project/${projectId}/board`]}><main className="min-h-screen bg-deep p-6 text-text-primary"><div className="mb-5 flex items-baseline gap-4"><h1 className="font-serif text-2xl text-accent-gold">Tablero</h1><p className="text-sm text-text-muted">El mapa que falta</p></div><BoardCanvas projectId={projectId} board={board} onViewportChange={() => {}} /></main></MemoryRouter>);
  for (let attempt = 0; attempt < 400; attempt++) {
    if (document.querySelector(`.react-flow__node[data-id="${clue.id}"]`)) { document.querySelector<HTMLButtonElement>('[data-testid="board-freehand-toggle"]')!.click(); await new Promise(resolve => setTimeout(resolve, 80)); (window as unknown as { __boardReady: boolean }).__boardReady = true; return; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Board freehand preview timeout');
}
preview().catch(error => { (window as unknown as { __boardError: string }).__boardError = String(error.stack || error); });
