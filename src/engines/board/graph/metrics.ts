// ============================================
// Board Engine — Graph metrics
// ============================================
//
// The point of these numbers is editorial, not mathematical. Betweenness on a
// story board tells you which character every subplot has to pass through —
// remove them and the story falls into unconnected pieces. Isolated nodes are
// ideas you wrote down and never tied to anything. Bridges are the single
// links holding two halves of a plot together.
//
// All of it runs on a few hundred nodes at most, so exact algorithms are used
// rather than sampled approximations.

import type { BoardEdge, BoardNode } from '../types';
import { buildAdjacency, type Adjacency } from './adjacency';

export interface NodeMetrics {
  degree: number;
  inDegree: number;
  outDegree: number;
  weightedDegree: number;
  /** Brandes betweenness, normalised to 0..1 across the graph. */
  betweenness: number;
  /** Mean inverse distance to every reachable node, 0..1. */
  closeness: number;
  /** Fraction of a node's neighbours that are connected to each other. */
  clustering: number;
  component: number;
  /** Removing this node disconnects part of its component. */
  articulation: boolean;
}

export interface GraphSummary {
  nodeCount: number;
  edgeCount: number;
  hyperEdgeCount: number;
  metaEdgeCount: number;
  componentCount: number;
  largestComponent: number;
  isolatedCount: number;
  averageDegree: number;
  /** Realised links over possible links, 0..1. */
  density: number;
  bridgeEdgeIds: string[];
  /** Every node any path routes through, sorted by betweenness, highest first. */
  keystoneIds: string[];
}

export interface MetricsResult {
  byNode: Map<string, NodeMetrics>;
  summary: GraphSummary;
  adjacency: Adjacency;
}

function emptyMetrics(): NodeMetrics {
  return {
    degree: 0,
    inDegree: 0,
    outDegree: 0,
    weightedDegree: 0,
    betweenness: 0,
    closeness: 0,
    clustering: 0,
    component: 0,
    articulation: false,
  };
}

/** Brandes' algorithm on the undirected projection, unweighted. */
function betweenness(ids: string[], adjacency: Adjacency): Map<string, number> {
  const scores = new Map<string, number>(ids.map((id) => [id, 0]));

  for (const source of ids) {
    const stack: string[] = [];
    const predecessors = new Map<string, string[]>(ids.map((id) => [id, []]));
    const sigma = new Map<string, number>(ids.map((id) => [id, 0]));
    const distance = new Map<string, number>(ids.map((id) => [id, -1]));
    sigma.set(source, 1);
    distance.set(source, 0);

    const queue: string[] = [source];
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      stack.push(current);
      const currentDistance = distance.get(current) ?? 0;
      for (const neighbor of adjacency.neighbors.get(current)?.keys() ?? []) {
        if ((distance.get(neighbor) ?? -1) < 0) {
          distance.set(neighbor, currentDistance + 1);
          queue.push(neighbor);
        }
        if (distance.get(neighbor) === currentDistance + 1) {
          sigma.set(neighbor, (sigma.get(neighbor) ?? 0) + (sigma.get(current) ?? 0));
          predecessors.get(neighbor)?.push(current);
        }
      }
    }

    const delta = new Map<string, number>(ids.map((id) => [id, 0]));
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const w = stack[index];
      for (const v of predecessors.get(w) ?? []) {
        const ratio = (sigma.get(v) ?? 0) / (sigma.get(w) || 1);
        delta.set(v, (delta.get(v) ?? 0) + ratio * (1 + (delta.get(w) ?? 0)));
      }
      if (w !== source) scores.set(w, (scores.get(w) ?? 0) + (delta.get(w) ?? 0));
    }
  }

  // Undirected graphs count every pair twice.
  let max = 0;
  for (const [id, value] of scores) {
    const halved = value / 2;
    scores.set(id, halved);
    if (halved > max) max = halved;
  }
  if (max > 0) for (const [id, value] of scores) scores.set(id, value / max);
  return scores;
}

function components(ids: string[], adjacency: Adjacency): Map<string, number> {
  const assignment = new Map<string, number>();
  let index = 0;
  for (const id of ids) {
    if (assignment.has(id)) continue;
    index += 1;
    const queue = [id];
    assignment.set(id, index);
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      for (const neighbor of adjacency.neighbors.get(current)?.keys() ?? []) {
        if (!assignment.has(neighbor)) {
          assignment.set(neighbor, index);
          queue.push(neighbor);
        }
      }
    }
  }
  return assignment;
}

function closeness(ids: string[], adjacency: Adjacency): Map<string, number> {
  const result = new Map<string, number>();
  for (const source of ids) {
    const distance = new Map<string, number>([[source, 0]]);
    const queue = [source];
    let head = 0;
    let sum = 0;
    let reached = 0;
    while (head < queue.length) {
      const current = queue[head++];
      const currentDistance = distance.get(current) ?? 0;
      for (const neighbor of adjacency.neighbors.get(current)?.keys() ?? []) {
        if (distance.has(neighbor)) continue;
        distance.set(neighbor, currentDistance + 1);
        sum += 1 / (currentDistance + 1);
        reached += 1;
        queue.push(neighbor);
      }
    }
    result.set(source, reached === 0 ? 0 : sum / Math.max(1, ids.length - 1));
  }
  return result;
}

function clustering(id: string, adjacency: Adjacency): number {
  const neighbors = Array.from(adjacency.neighbors.get(id)?.keys() ?? []);
  if (neighbors.length < 2) return 0;
  let links = 0;
  for (let i = 0; i < neighbors.length; i += 1) {
    for (let j = i + 1; j < neighbors.length; j += 1) {
      if (adjacency.neighbors.get(neighbors[i])?.has(neighbors[j])) links += 1;
    }
  }
  const possible = (neighbors.length * (neighbors.length - 1)) / 2;
  return links / possible;
}

/** Tarjan bridge + articulation point search over the undirected projection. */
function findCriticalElements(
  ids: string[],
  adjacency: Adjacency,
): { bridges: Set<string>; articulations: Set<string> } {
  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const bridges = new Set<string>();
  const articulations = new Set<string>();
  let timer = 0;

  const visit = (root: string) => {
    // Iterative DFS — story boards are shallow but a recursive version would
    // still be one more stack overflow waiting for a pathological import.
    const stack: Array<{ node: string; iterator: IterableIterator<string>; children: number }> = [];
    discovery.set(root, timer);
    low.set(root, timer);
    timer += 1;
    parent.set(root, null);
    stack.push({ node: root, iterator: (adjacency.neighbors.get(root)?.keys() ?? [][Symbol.iterator]()) as IterableIterator<string>, children: 0 });

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const next = frame.iterator.next();
      if (next.done) {
        stack.pop();
        const previous = stack[stack.length - 1];
        if (previous) {
          const child = frame.node;
          const node = previous.node;
          low.set(node, Math.min(low.get(node) ?? 0, low.get(child) ?? 0));
          if ((low.get(child) ?? 0) > (discovery.get(node) ?? 0)) {
            const entry = adjacency.neighbors.get(node)?.get(child);
            if (entry) bridges.add(entry.edgeId);
          }
          if (parent.get(node) !== null && (low.get(child) ?? 0) >= (discovery.get(node) ?? 0)) {
            articulations.add(node);
          }
          if (parent.get(node) === null && previous.children > 1) articulations.add(node);
        }
        continue;
      }

      const neighbor = next.value;
      if (neighbor === parent.get(frame.node)) continue;
      if (discovery.has(neighbor)) {
        low.set(frame.node, Math.min(low.get(frame.node) ?? 0, discovery.get(neighbor) ?? 0));
        continue;
      }
      frame.children += 1;
      parent.set(neighbor, frame.node);
      discovery.set(neighbor, timer);
      low.set(neighbor, timer);
      timer += 1;
      stack.push({
        node: neighbor,
        iterator: (adjacency.neighbors.get(neighbor)?.keys() ?? [][Symbol.iterator]()) as IterableIterator<string>,
        children: 0,
      });
    }
  };

  for (const id of ids) if (!discovery.has(id)) visit(id);
  return { bridges, articulations };
}

export function computeMetrics(nodes: BoardNode[], edges: BoardEdge[]): MetricsResult {
  const adjacency = buildAdjacency(nodes, edges);
  const ids = adjacency.ids;
  const byNode = new Map<string, NodeMetrics>();

  const betweennessScores = betweenness(ids, adjacency);
  const componentAssignment = components(ids, adjacency);
  const closenessScores = closeness(ids, adjacency);
  const { bridges, articulations } = findCriticalElements(ids, adjacency);

  const componentSizes = new Map<number, number>();
  let isolatedCount = 0;
  let degreeSum = 0;

  for (const id of ids) {
    const metrics = emptyMetrics();
    const neighborMap = adjacency.neighbors.get(id);
    metrics.degree = neighborMap?.size ?? 0;
    metrics.inDegree = adjacency.in.get(id)?.size ?? 0;
    metrics.outDegree = adjacency.out.get(id)?.size ?? 0;
    metrics.weightedDegree = 0;
    for (const entry of neighborMap?.values() ?? []) {
      metrics.weightedDegree += entry.weight * entry.certainty;
    }
    metrics.betweenness = betweennessScores.get(id) ?? 0;
    metrics.closeness = closenessScores.get(id) ?? 0;
    metrics.clustering = clustering(id, adjacency);
    metrics.component = componentAssignment.get(id) ?? 0;
    metrics.articulation = articulations.has(id);
    byNode.set(id, metrics);

    degreeSum += metrics.degree;
    if (metrics.degree === 0) isolatedCount += 1;
    componentSizes.set(metrics.component, (componentSizes.get(metrics.component) ?? 0) + 1);
  }

  const hyperEdgeCount = edges.filter((edge) => edge.sources.length > 1 || edge.targets.length > 1).length;
  const metaEdgeCount = edges.filter((edge) =>
    [...edge.sources, ...edge.targets].some((endpoint) => endpoint.on === 'edge'),
  ).length;

  const possible = ids.length > 1 ? (ids.length * (ids.length - 1)) / 2 : 0;
  const keystoneIds = Array.from(byNode.entries())
    .filter(([, metrics]) => metrics.betweenness > 0)
    .sort((a, b) => b[1].betweenness - a[1].betweenness)
    .map(([id]) => id);

  return {
    byNode,
    adjacency,
    summary: {
      nodeCount: ids.length,
      edgeCount: edges.length,
      hyperEdgeCount,
      metaEdgeCount,
      componentCount: componentSizes.size,
      largestComponent: componentSizes.size === 0 ? 0 : Math.max(...componentSizes.values()),
      isolatedCount,
      averageDegree: ids.length === 0 ? 0 : degreeSum / ids.length,
      density: possible === 0 ? 0 : degreeSum / 2 / possible,
      bridgeEdgeIds: Array.from(bridges),
      keystoneIds,
    },
  };
}
