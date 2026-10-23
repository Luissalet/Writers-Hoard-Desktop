// One click on a side of a selected idea: a new one like it on that side,
// joined to it. Pure, shared by the canvas and the bridge.
import type { BoardEdge, BoardNode, BoardSide } from '../types';
import { makeEdge, makeNode } from './mutations';

const OPPOSITE: Record<BoardSide, BoardSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
export const QUICK_SIDES: readonly BoardSide[] = ['top', 'right', 'bottom', 'left'];
const GAP = 96;

/** Kinds that copy themselves; a picture, a reference tile or a frame gets a card beside it. */
const COPYABLE = new Set<BoardNode['kind']>(['postit', 'card', 'shape', 'text']);

export function quickConnected(from: BoardNode, side: BoardSide, nodes: readonly BoardNode[], options: { title?: string; edgeKind?: string; layerId?: string } = {}): { node: BoardNode; edge: BoardEdge } {
  const kind = COPYABLE.has(from.kind) ? from.kind : 'card';
  const size = COPYABLE.has(from.kind) ? { ...from.size } : undefined;
  const width = size?.width ?? 220, height = size?.height ?? 120;
  const step = { top: { x: 0, y: -(height + GAP) }, bottom: { x: 0, y: from.size.height + GAP }, left: { x: -(width + GAP), y: 0 }, right: { x: from.size.width + GAP, y: 0 } }[side];
  const free = (x: number, y: number) => !nodes.some(node => node.kind !== 'frame' && x < node.position.x + node.size.width + 16 && x + width + 16 > node.position.x && y < node.position.y + node.size.height + 16 && y + height + 16 > node.position.y);
  let position = { x: from.position.x + step.x, y: from.position.y + step.y };
  // Further along the same side until the place is free.
  const advance = { top: { x: 0, y: -(height + GAP) }, bottom: { x: 0, y: height + GAP }, left: { x: -(width + GAP), y: 0 }, right: { x: width + GAP, y: 0 } }[side];
  for (let i = 0; i < 20 && !free(position.x, position.y); i++) position = { x: position.x + advance.x, y: position.y + advance.y };
  const node = makeNode({
    projectId: from.projectId, boardId: from.boardId, kind, position,
    title: options.title ?? '', color: COPYABLE.has(from.kind) ? from.color : undefined,
    shape: kind === 'shape' ? from.shape : undefined, size, role: kind === 'card' ? from.role : undefined,
    layerId: options.layerId ?? from.layerId,
  });
  const edge = makeEdge({ projectId: from.projectId, boardId: from.boardId, sources: [{ id: from.id, on: 'node', side }], targets: [{ id: node.id, on: 'node', side: OPPOSITE[side] }], kind: options.edgeKind ?? 'related', layerId: options.layerId ?? from.layerId });
  return { node, edge };
}
