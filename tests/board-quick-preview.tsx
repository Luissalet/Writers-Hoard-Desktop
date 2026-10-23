import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import BoardCanvas from '@/engines/board/components/BoardCanvas';
import { makeNode } from '@/engines/board/graph/mutations';
import { flushPendingWrites } from '@/services/pendingWrites';
import { useLocaleStore } from '@/stores/localeStore';
import '@/index.css';

type Window = typeof window & { __bqReady?: boolean; __bqError?: string; __readBoard: () => Promise<{ nodes: unknown[]; edges: unknown[] }> };
const host = window as Window;
async function preview() {
  useLocaleStore.setState({ locale: 'es' });
  const projectId = 'board-quick-preview', board = { id: 'board-quick-preview-board', projectId, title: 'La conspiración', surface: 'cork' as const, viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 1, updatedAt: 1 };
  if (!(await db.boards.get(board.id))) {
    await db.projects.put({ id: projectId, title: 'Tablero', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['board'], engineOrder: ['board'], createdAt: 1, updatedAt: 1 });
    await db.boards.put(board);
    await db.boardNodes.put({ ...makeNode({ projectId, boardId: board.id, kind: 'shape', shape: 'hexagon', position: { x: 360, y: 260 }, size: { width: 200, height: 120 }, title: 'La Orden de la Sal', color: '#3d85c6' }), id: 'bq-origin' });
  }
  host.__readBoard = async () => { await flushPendingWrites(); return { nodes: await db.boardNodes.where('boardId').equals(board.id).toArray(), edges: await db.boardEdges.where('boardId').equals(board.id).toArray() }; };
  createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[`/project/${projectId}/board`]}><main className="min-h-screen bg-deep p-6 text-text-primary"><BoardCanvas projectId={projectId} board={(await db.boards.get(board.id))!} onViewportChange={() => {}} /></main></MemoryRouter>);
  host.__bqReady = true;
}
preview().catch(error => { host.__bqError = String(error?.stack ?? error); });
