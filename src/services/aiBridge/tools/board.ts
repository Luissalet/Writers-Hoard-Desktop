// ============================================================================
// AI bridge tools — the corkboard
// ============================================================================
//
// Nodes, edges, layers and views are all scoped by boardId, not projectId.
// An edge stores `sources`/`targets` as the truth and keeps `sourceId`/
// `targetId` denormalised for the simple two-ended case — both are written.
//
// Node images are base64 in Dexie; they never go into a text result. Use
// wh_view_board_image to look at one.

import { db } from '@/db';
import type { Board, BoardEdge, BoardNode, BoardNodeKind, BoardSurface } from '@/engines/board/types';
import {
  createBoard,
  createBoardEdge,
  createBoardNode,
  getBoard,
  getBoardEdges,
  getBoardNode,
  getBoardNodes,
  getBoards,
  updateBoardNode,
} from '@/engines/board/operations';
import { DEFAULT_NODE_COLOR, DEFAULT_SIZE, edgeKindColor } from '@/engines/board/catalog';
import { generateId } from '@/utils/idGenerator';
import {
  assertEngineEnabled,
  assertRowInScope,
  BridgeError,
  dataUrlToBlob,
  optEnum,
  optNumber,
  optString,
  optStringArray,
  requireString,
  resolveProjectForEngine,
  resolveProjectId,
  toVisionJpeg,
  withAudit,
  withMedia,
  type ToolArgs,
} from './shared';

const NODE_KINDS = [
  'card', 'postit', 'text', 'image', 'shape', 'frame', 'entity',
] as const satisfies readonly BoardNodeKind[];

const SURFACES = ['cork', 'slate', 'grid', 'blueprint'] as const satisfies readonly BoardSurface[];

export async function whCreateBoard(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'board');
  const now = Date.now();
  const board: Board = {
    id: generateId('board'),
    projectId,
    title: requireString(args, 'title'),
    surface: optEnum(args, 'surface', SURFACES) ?? 'cork',
    createdAt: now,
    updatedAt: now,
  };
  await createBoard(board);
  return withAudit(
    { id: board.id, title: board.title, surface: board.surface, created: true },
    { projectId, entityId: board.id, summary: `created board "${board.title}"` },
  );
}

export async function whListBoards(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const boards = await getBoards(projectId);
  const nodes = await db.boardNodes.where('projectId').equals(projectId).toArray();
  const edges = await db.boardEdges.where('projectId').equals(projectId).toArray();
  return {
    projectId,
    boards: boards.map((board) => ({
      id: board.id,
      title: board.title,
      surface: board.surface,
      cardCount: nodes.filter((node) => node.boardId === board.id).length,
      threadCount: edges.filter((edge) => edge.boardId === board.id).length,
      updatedAt: board.updatedAt,
    })),
  };
}

export async function whGetBoard(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const board = await getBoard(id);
  if (!board) throw new BridgeError('not-found', `No board with id "${id}".`);
  const [nodes, edges] = await Promise.all([getBoardNodes(id), getBoardEdges(id)]);
  const nameOf = (nodeId: string): string =>
    nodes.find((node) => node.id === nodeId)?.title ?? nodeId;
  return {
    id: board.id,
    projectId: board.projectId,
    title: board.title,
    surface: board.surface,
    cards: nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      role: node.role,
      title: node.title,
      content: node.content,
      tags: node.tags,
      color: node.color,
      position: node.position,
      hasImage: Boolean(node.image),
      linkedTo: node.ref
        ? { engineId: node.ref.engineId, entityId: node.ref.entityId, title: node.ref.title }
        : undefined,
    })),
    threads: edges.map((edge) => ({
      id: edge.id,
      from: { id: edge.sourceId, title: nameOf(edge.sourceId) },
      to: { id: edge.targetId, title: nameOf(edge.targetId) },
      kind: edge.kind,
      label: edge.label,
      notes: edge.notes,
      certainty: edge.certainty,
    })),
  };
}

/** Somewhere clear of what is already pinned, when the caller gives no position. */
function nextFreeSpot(existing: BoardNode[]): { x: number; y: number } {
  if (!existing.length) return { x: 0, y: 0 };
  const rightmost = Math.max(...existing.map((node) => node.position.x + node.size.width));
  const topmost = Math.min(...existing.map((node) => node.position.y));
  return { x: rightmost + 60, y: topmost };
}

export async function whAddBoardCard(args: ToolArgs): Promise<unknown> {
  const boardId = requireString(args, 'boardId');
  const board = await getBoard(boardId);
  if (!board) throw new BridgeError('not-found', `No board with id "${boardId}".`);
  await assertEngineEnabled(board.projectId, 'board');
  assertRowInScope(args, board.projectId);
  const existing = await getBoardNodes(boardId);

  const x = optNumber(args, 'x');
  const y = optNumber(args, 'y');
  // One coordinate is still a coordinate. Auto-placing the card because only
  // `x` arrived would throw away something the caller meant — and the update
  // tool already honours them one at a time, so dropping it here made the same
  // argument behave differently between two neighbouring tools.
  const fallback = x === undefined || y === undefined ? nextFreeSpot(existing) : { x: 0, y: 0 };
  const position = { x: x ?? fallback.x, y: y ?? fallback.y };
  const now = Date.now();
  // Colour and size are per node kind in the catalog, not single constants.
  const kind = optEnum(args, 'kind', NODE_KINDS) ?? 'card';
  const node: BoardNode = {
    id: generateId('node'),
    projectId: board.projectId,
    boardId,
    kind,
    role: optString(args, 'role'),
    title: requireString(args, 'title'),
    // `content` is the searchable plain-text projection and is always kept.
    content: optString(args, 'content') ?? '',
    color: optString(args, 'color') ?? DEFAULT_NODE_COLOR[kind],
    position,
    size: { ...DEFAULT_SIZE[kind] },
    zIndex: existing.length,
    tags: optStringArray(args, 'tags') ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await createBoardNode(node);
  return withAudit(
    { id: node.id, boardId, position, created: true },
    {
      projectId: board.projectId,
      entityId: node.id,
      summary: `pinned "${node.title}" on board "${board.title}"`,
    },
  );
}

export async function whUpdateBoardCard(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const node = await getBoardNode(id);
  if (!node) throw new BridgeError('not-found', `No board card with id "${id}".`);
  await assertEngineEnabled(node.projectId, 'board');
  assertRowInScope(args, node.projectId);

  const changes: Partial<BoardNode> = {};
  (['title', 'content', 'role', 'color'] as const).forEach((key) => {
    const value = optString(args, key);
    if (value !== undefined) changes[key] = value;
  });
  const tags = optStringArray(args, 'tags');
  if (tags !== undefined) changes.tags = tags;
  const x = optNumber(args, 'x');
  const y = optNumber(args, 'y');
  if (x !== undefined || y !== undefined) {
    changes.position = { x: x ?? node.position.x, y: y ?? node.position.y };
  }

  if (!Object.keys(changes).length) {
    throw new BridgeError('bad-args', 'Nothing to change: pass at least one field besides id.');
  }
  await updateBoardNode(id, changes);
  return withAudit(
    { id, updated: Object.keys(changes) },
    {
      projectId: node.projectId,
      entityId: id,
      summary: `updated card "${node.title}"`,
      before: { title: node.title, role: node.role, position: node.position },
    },
  );
}

export async function whConnectBoardCards(args: ToolArgs): Promise<unknown> {
  const sourceId = requireString(args, 'sourceId');
  const targetId = requireString(args, 'targetId');
  if (sourceId === targetId) {
    throw new BridgeError('bad-args', 'A card cannot be threaded to itself.');
  }
  const [source, target] = await Promise.all([getBoardNode(sourceId), getBoardNode(targetId)]);
  if (!source) throw new BridgeError('not-found', `No board card with id "${sourceId}".`);
  await assertEngineEnabled(source.projectId, 'board');
  assertRowInScope(args, source.projectId);
  if (!target) throw new BridgeError('not-found', `No board card with id "${targetId}".`);
  if (source.boardId !== target.boardId) {
    throw new BridgeError('bad-args', 'Both cards must be pinned on the same board.');
  }

  const kind = optString(args, 'kind') ?? 'related';
  const certainty = Math.max(0, Math.min(1, optNumber(args, 'certainty') ?? 1));
  const now = Date.now();
  const edge: BoardEdge = {
    id: generateId('edge'),
    projectId: source.projectId,
    boardId: source.boardId,
    // Denormalised first endpoints; `sources`/`targets` are the truth.
    sourceId,
    targetId,
    sources: [{ id: sourceId, on: 'node' }],
    targets: [{ id: targetId, on: 'node' }],
    kind,
    label: optString(args, 'label'),
    color: optString(args, 'color') ?? edgeKindColor(kind),
    style: 'solid',
    width: 0,
    direction: 'forward',
    curvature: 'curved',
    weight: 1,
    certainty,
    tags: [],
    notes: optString(args, 'notes'),
    createdAt: now,
    updatedAt: now,
  };
  await createBoardEdge(edge);
  return withAudit(
    { id: edge.id, created: true },
    {
      projectId: source.projectId,
      entityId: edge.id,
      summary: `threaded "${source.title}" → "${target.title}" (${kind})`,
    },
  );
}

export async function whViewBoardImage(args: ToolArgs): Promise<unknown> {
  const id = requireString(args, 'id');
  const node = await getBoardNode(id);
  if (!node) throw new BridgeError('not-found', `No board card with id "${id}".`);
  if (!node.image?.startsWith('data:')) {
    throw new BridgeError('no-image', `The card "${node.title}" has no picture pinned to it.`);
  }
  const media = await toVisionJpeg(dataUrlToBlob(node.image));
  return withMedia(
    { id: node.id, title: node.title, role: node.role, tags: node.tags },
    [{ ...media, label: node.title }],
  );
}
