import { canMoveNode, findOpenPosition, isCanvasShortcutTarget } from '@/engines/board/graph/interactions';
import { runLayout, type LayoutKind } from '@/engines/board/graph/layout';
import { makeEdge, makeNode } from '@/engines/board/graph/mutations';
import { boxOfNode, computeEdgeGeometry } from '@/engines/board/graph/geometry';
import type { BoardLayer } from '@/engines/board/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function testBoardInteractions(): string {
  const a = makeNode({ projectId: 'test', boardId: 'test', kind: 'card', title: 'A', position: { x: 0, y: 0 } });
  const b = makeNode({ projectId: 'test', boardId: 'test', kind: 'card', title: 'B', position: { x: 0, y: 0 } });
  const c = makeNode({ projectId: 'test', boardId: 'test', kind: 'card', title: 'C', position: { x: 0, y: 0 } });
  const layers = new Map<string, BoardLayer>([['locked', { id: 'locked', locked: true } as BoardLayer]]);
  assert(canMoveNode(a, layers), 'unlocked ideas must remain movable');
  assert(!canMoveNode({ ...a, locked: true }, layers), 'node lock ignored');
  assert(!canMoveNode({ ...a, layerId: 'locked' }, layers), 'layer lock ignored');

  const spot = findOpenPosition(a.position, a.size, [a]);
  assert(spot.y >= a.position.y + a.size.height, 'capturing a second idea covers the first');
  const next = findOpenPosition(a.position, a.size, [a, { ...b, position: spot }]);
  assert(next.y >= spot.y + b.size.height, 'capturing a third idea covers the second');
  const frame = makeNode({ projectId: 'test', boardId: 'test', kind: 'frame', position: { x: 0, y: 0 } });
  assert(findOpenPosition({ x: 0, y: 0 }, a.size, [frame]).y === 0, 'group regions must accept ideas inside');

  for (const kind of ['force', 'hierarchy', 'radial', 'grid', 'circle'] as LayoutKind[]) {
    const result = runLayout(kind, [{ ...a, pinned: true }, { ...b, locked: true }, c], []);
    assert(!result[b.id], `${kind} moved a locked idea`);
    assert(!result[a.id] || (result[a.id].x === a.position.x && result[a.id].y === a.position.y), `${kind} moved a pinned idea`);
    assert(Boolean(result[c.id]), `${kind} stopped arranging unlocked ideas`);
  }

  const canvas = document.createElement('div');
  const pane = document.createElement('div');
  const input = document.createElement('input');
  const button = document.createElement('button');
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const dialogContent = document.createElement('span');
  dialog.append(dialogContent);
  canvas.append(pane, input, button, dialog);
  assert(isCanvasShortcutTarget(pane, canvas), 'canvas keyboard interactions disabled');
  assert(!isCanvasShortcutTarget(input, canvas), 'canvas shortcuts steal typing');
  assert(!isCanvasShortcutTarget(button, canvas), 'canvas shortcuts steal toolbar interaction');
  assert(!isCanvasShortcutTarget(dialogContent, canvas), 'canvas shortcuts cross a dialog boundary');
  assert(!isCanvasShortcutTarget(document.body, canvas), 'canvas shortcuts intercept the rest of the app');

  const target = { ...b, position: { x: 540, y: 260 } };
  const edge = makeEdge({ projectId: 'test', boardId: 'test', sources: [{ id: a.id, on: 'node', side: 'right' }], targets: [{ id: b.id, on: 'node', side: 'left' }] });
  const parallel = { ...edge, id: 'parallel' };
  const boxes = new Map([[a.id, boxOfNode(a)], [b.id, boxOfNode(target)]]);
  const geometry = computeEdgeGeometry([edge, parallel], boxes);
  const first = geometry.get(edge.id)!;
  const second = geometry.get(parallel.id)!;
  assert(Math.hypot(first.mid.x - second.mid.x, first.mid.y - second.mid.y) > 10, 'parallel relation labels pile up at the chord midpoint');
  for (const shape of [first, second]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', shape.legs[0].d);
    let nearest = Infinity;
    const length = path.getTotalLength();
    for (let sample = 0; sample <= 1000; sample++) {
      const p = path.getPointAtLength(length * sample / 1000);
      nearest = Math.min(nearest, Math.hypot(p.x - shape.mid.x, p.y - shape.mid.y));
    }
    assert(nearest < 1, 'relation label and anchor float away from the rendered thread');
  }
  const meta = makeEdge({ projectId: 'test', boardId: 'test', sources: [{ id: a.id, on: 'node' }], targets: [{ id: edge.id, on: 'edge' }] });
  const anchored = computeEdgeGeometry([edge, parallel, meta], boxes).get(meta.id)!;
  assert(Math.hypot(anchored.legs[0].end.x - first.mid.x, anchored.legs[0].end.y - first.mid.y) < 0.001, 'edge-to-edge connection misses its visible anchor');
  return 'Board idea placement, locked/pinned layouts, keyboard scope, parallel labels and edge-to-edge anchors';
}
