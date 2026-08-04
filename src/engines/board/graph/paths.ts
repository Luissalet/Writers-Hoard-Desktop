// ============================================
// Board Engine — Paths and neighbourhoods
// ============================================
//
// "How does this character reach that revelation?" is a question a corkboard
// full of string cannot answer by eye once it passes about thirty nodes.
// Two functions answer it: the strongest single route between two nodes, and
// everything within N hops of a focus.

import type { Adjacency } from './adjacency';

export interface PathResult {
  /** Node ids from start to end, inclusive. Empty when unreachable. */
  nodeIds: string[];
  /** Edge ids used, in order. */
  edgeIds: string[];
  /** Sum of the traversal costs — lower is a stronger chain of relations. */
  cost: number;
}

/**
 * Traversal cost of a link. Strong, certain relations are "shorter", so the
 * best path prefers a chain of solid connections over a shortcut through one
 * speculative link.
 */
function costOf(weight: number, certainty: number): number {
  const effective = Math.max(0.05, weight * Math.max(0.05, certainty));
  return 1 / effective;
}

/** Dijkstra over the undirected projection, or over `out` when directed. */
export function shortestPath(
  adjacency: Adjacency,
  startId: string,
  endId: string,
  directed = false,
): PathResult {
  const graph = directed ? adjacency.out : adjacency.neighbors;
  if (!graph.has(startId) || !graph.has(endId)) return { nodeIds: [], edgeIds: [], cost: 0 };
  if (startId === endId) return { nodeIds: [startId], edgeIds: [], cost: 0 };

  const distance = new Map<string, number>([[startId, 0]]);
  const previous = new Map<string, { node: string; edgeId: string }>();
  const visited = new Set<string>();
  const frontier = new Set<string>([startId]);

  while (frontier.size > 0) {
    let current = '';
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of frontier) {
      const value = distance.get(candidate) ?? Number.POSITIVE_INFINITY;
      if (value < best) {
        best = value;
        current = candidate;
      }
    }
    if (!current) break;
    frontier.delete(current);
    visited.add(current);
    if (current === endId) break;

    for (const [neighbor, entry] of graph.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      const next = best + costOf(entry.weight, entry.certainty);
      if (next < (distance.get(neighbor) ?? Number.POSITIVE_INFINITY)) {
        distance.set(neighbor, next);
        previous.set(neighbor, { node: current, edgeId: entry.edgeId });
        frontier.add(neighbor);
      }
    }
  }

  if (!distance.has(endId)) return { nodeIds: [], edgeIds: [], cost: 0 };

  const nodeIds: string[] = [endId];
  const edgeIds: string[] = [];
  let cursor = endId;
  while (cursor !== startId) {
    const step = previous.get(cursor);
    if (!step) return { nodeIds: [], edgeIds: [], cost: 0 };
    edgeIds.unshift(step.edgeId);
    nodeIds.unshift(step.node);
    cursor = step.node;
  }
  return { nodeIds, edgeIds, cost: distance.get(endId) ?? 0 };
}

export interface Neighborhood {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  /** Hop count per node, 0 for the focus itself. */
  depthById: Map<string, number>;
}

/** Everything within `depth` hops of a focus node. Drives `near:` queries. */
export function neighborhood(
  adjacency: Adjacency,
  focusIds: string[],
  depth: number,
  directed = false,
): Neighborhood {
  const graph = directed ? adjacency.out : adjacency.neighbors;
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const depthById = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = [];

  for (const id of focusIds) {
    if (!graph.has(id) || nodeIds.has(id)) continue;
    nodeIds.add(id);
    depthById.set(id, 0);
    queue.push({ id, depth: 0 });
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (current.depth >= depth) continue;
    for (const [neighbor, entry] of graph.get(current.id) ?? []) {
      edgeIds.add(entry.edgeId);
      if (nodeIds.has(neighbor)) continue;
      nodeIds.add(neighbor);
      depthById.set(neighbor, current.depth + 1);
      queue.push({ id: neighbor, depth: current.depth + 1 });
    }
  }

  return { nodeIds, edgeIds, depthById };
}
