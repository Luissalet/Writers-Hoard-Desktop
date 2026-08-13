// ============================================
// Board Engine — Pure graph mutations
// ============================================
//
// Deletion on a graph that allows hyper-edges and edge-to-edge anchors is not
// "remove the row". Removing a node can empty one side of a hyper-edge (which
// then has to go), and removing that edge can strip the anchor out from under
// a meta-edge, and so on. This module computes the whole consequence set once,
// as a pure function, so the canvas and the database agree on exactly what
// disappears — and so undo can restore precisely that set.

import { generateId } from '@/utils/idGenerator';
import { DEFAULT_NODE_COLOR, DEFAULT_SIZE, edgeKindColor, getEdgeKind } from '../catalog';
import type {
  BoardEdge,
  BoardEndpoint,
  BoardNode,
  BoardNodeKind,
} from '../types';

export interface DeletionPlan {
  removedNodeIds: string[];
  removedEdgeIds: string[];
  /** Edges that survive but lost an endpoint of a hyper-edge. */
  rewrittenEdges: BoardEdge[];
}

export function planDeletion(
  nodes: BoardNode[],
  edges: BoardEdge[],
  nodeIds: string[],
  edgeIds: string[] = [],
): DeletionPlan {
  const doomedNodes = new Set(nodeIds);
  const doomedEdges = new Set(edgeIds);

  const survives = (endpoint: BoardEndpoint): boolean =>
    endpoint.on === 'node' ? !doomedNodes.has(endpoint.id) : !doomedEdges.has(endpoint.id);

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (doomedEdges.has(edge.id)) continue;
      const sources = edge.sources.filter(survives);
      const targets = edge.targets.filter(survives);
      if (sources.length === 0 || targets.length === 0) {
        doomedEdges.add(edge.id);
        changed = true;
      }
    }
  }

  const rewrittenEdges: BoardEdge[] = [];
  for (const edge of edges) {
    if (doomedEdges.has(edge.id)) continue;
    const sources = edge.sources.filter(survives);
    const targets = edge.targets.filter(survives);
    if (sources.length === edge.sources.length && targets.length === edge.targets.length) continue;
    rewrittenEdges.push({
      ...edge,
      sources,
      targets,
      sourceId: sources[0]?.id ?? edge.sourceId,
      targetId: targets[0]?.id ?? edge.targetId,
      updatedAt: Date.now(),
    });
  }

  // Frames take their contents with them only when the caller asked for it;
  // by default a deleted frame leaves its cards on the board, which is what
  // people expect from a region they drew around things.
  const removedNodeIds = nodes.filter((node) => doomedNodes.has(node.id)).map((node) => node.id);

  return {
    removedNodeIds,
    removedEdgeIds: Array.from(doomedEdges),
    rewrittenEdges,
  };
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export interface NewNodeOptions {
  projectId: string;
  boardId: string;
  kind: BoardNodeKind;
  position: { x: number; y: number };
  role?: string;
  title?: string;
  content?: string;
  richContent?: string;
  color?: string;
  image?: string;
  imageOriginal?: string;
  shape?: BoardNode['shape'];
  layerId?: string;
  size?: { width: number; height: number };
  ref?: BoardNode['ref'];
  zIndex?: number;
}

export function makeNode(options: NewNodeOptions): BoardNode {
  const now = Date.now();
  const size = options.size ?? DEFAULT_SIZE[options.kind];
  return {
    id: generateId('bnode'),
    projectId: options.projectId,
    boardId: options.boardId,
    kind: options.kind,
    role: options.role,
    title: options.title ?? '',
    content: options.content ?? '',
    richContent: options.richContent,
    image: options.image,
    imageOriginal: options.imageOriginal,
    color: options.color ?? DEFAULT_NODE_COLOR[options.kind],
    position: options.position,
    size: { ...size },
    shape: options.kind === 'shape' ? (options.shape ?? 'rectangle') : options.shape,
    layerId: options.layerId,
    // Frames sit behind everything so the cards they surround stay clickable.
    zIndex: options.zIndex ?? (options.kind === 'frame' ? -1 : 0),
    tags: [],
    ref: options.ref,
    createdAt: now,
    updatedAt: now,
  };
}

export interface NewEdgeOptions {
  projectId: string;
  boardId: string;
  sources: BoardEndpoint[];
  targets: BoardEndpoint[];
  kind?: string;
  label?: string;
  color?: string;
  layerId?: string;
}

export function makeEdge(options: NewEdgeOptions): BoardEdge {
  const now = Date.now();
  const kind = options.kind ?? 'related';
  const definition = getEdgeKind(kind);
  return {
    id: generateId('bedge'),
    projectId: options.projectId,
    boardId: options.boardId,
    sourceId: options.sources[0]?.id ?? '',
    targetId: options.targets[0]?.id ?? '',
    sources: options.sources,
    targets: options.targets,
    kind,
    label: options.label,
    color: options.color ?? edgeKindColor(kind),
    style: 'solid',
    width: 0,
    direction: definition?.defaultDirection ?? 'none',
    curvature: 'curved',
    weight: 1,
    certainty: 1,
    layerId: options.layerId,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Deep-copies a selection so paste produces independent rows, keeping any
 * relation whose *both* ends were part of the copied set.
 */
export function cloneSelection(
  nodes: BoardNode[],
  edges: BoardEdge[],
  offset: { x: number; y: number },
  boardId: string,
  projectId: string,
): { nodes: BoardNode[]; edges: BoardEdge[] } {
  const now = Date.now();
  const idMap = new Map<string, string>();
  const clonedNodes = nodes.map((node) => {
    const id = generateId('bnode');
    idMap.set(node.id, id);
    return {
      ...node,
      id,
      boardId,
      projectId,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      size: { ...node.size },
      tags: [...(node.tags ?? [])],
      createdAt: now,
      updatedAt: now,
    };
  });

  // Which edges survive the copy. A meta-edge (one anchored ON another edge)
  // may only be kept if its anchor is kept too — so this is a fixed point, not
  // a single pass. Validating against the *input* list instead let a meta-edge
  // whose anchor was dropped through: `edgeIdMap.get(anchor)` came back
  // undefined and `remap` fell back to the ORIGINAL id, silently wiring the
  // pasted board to the edge it was copied from.
  const keptIds = new Set(edges.map((e) => e.id));
  for (;;) {
    let changed = false;
    for (const edge of edges) {
      if (!keptIds.has(edge.id)) continue;
      const ok = [...edge.sources, ...edge.targets].every((endpoint) =>
        endpoint.on === 'node' ? idMap.has(endpoint.id) : keptIds.has(endpoint.id),
      );
      if (!ok) {
        keptIds.delete(edge.id);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const kept = edges.filter((edge) => keptIds.has(edge.id));

  const edgeIdMap = new Map<string, string>();
  for (const edge of kept) edgeIdMap.set(edge.id, generateId('bedge'));

  // `side` is part of the endpoint contract (types.ts) — dropping it re-routed
  // every pasted thread from the card face it was attached to back to centre.
  const remap = (endpoint: BoardEndpoint): BoardEndpoint => ({
    on: endpoint.on,
    id: (endpoint.on === 'node' ? idMap.get(endpoint.id) : edgeIdMap.get(endpoint.id)) ?? endpoint.id,
    side: endpoint.side,
  });

  const clonedEdges = kept.map((edge) => {
    const sources = edge.sources.map(remap);
    const targets = edge.targets.map(remap);
    return {
      ...edge,
      id: edgeIdMap.get(edge.id) ?? generateId('bedge'),
      boardId,
      projectId,
      sources,
      targets,
      sourceId: sources[0]?.id ?? '',
      targetId: targets[0]?.id ?? '',
      tags: [...(edge.tags ?? [])],
      createdAt: now,
      updatedAt: now,
    };
  });

  return { nodes: clonedNodes, edges: clonedEdges };
}

/** Nodes whose centre falls inside a frame — how frames carry their contents. */
export function nodesInsideFrame(frame: BoardNode, nodes: BoardNode[]): BoardNode[] {
  const left = frame.position.x;
  const top = frame.position.y;
  const right = left + frame.size.width;
  const bottom = top + frame.size.height;
  return nodes.filter((node) => {
    if (node.id === frame.id) return false;
    const cx = node.position.x + node.size.width / 2;
    const cy = node.position.y + node.size.height / 2;
    return cx >= left && cx <= right && cy >= top && cy <= bottom;
  });
}
