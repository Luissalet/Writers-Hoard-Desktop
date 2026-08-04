// ============================================
// Board Engine — Adjacency
// ============================================
//
// One place that answers "what is connected to what", shared by metrics,
// pathfinding, layout and the query language. Hyper-edges are expanded into
// the cartesian product of their sources and targets, which is the reading
// that matches how authors mean them: "A and B cause C and D" is four causal
// links that happen to share one justification.
//
// Endpoints that point at another edge are *not* node adjacency — they are
// statements about statements. They are tracked separately so metrics can
// report them without corrupting path lengths.

import type { BoardEdge, BoardNode } from '../types';

export interface AdjacencyEntry {
  edgeId: string;
  kind: string;
  weight: number;
  certainty: number;
  directed: boolean;
}

export interface Adjacency {
  /** All node ids present in the graph, in input order. */
  ids: string[];
  /** Undirected neighbours: id → (neighbourId → strongest link). */
  neighbors: Map<string, Map<string, AdjacencyEntry>>;
  /** Directed successors, respecting edge direction. */
  out: Map<string, Map<string, AdjacencyEntry>>;
  /** Directed predecessors. */
  in: Map<string, Map<string, AdjacencyEntry>>;
  /** Edges whose endpoints include the node, by node id. */
  incident: Map<string, string[]>;
  /** Edges anchored on another edge, by the edge they annotate. */
  meta: Map<string, string[]>;
}

function put(
  map: Map<string, Map<string, AdjacencyEntry>>,
  from: string,
  to: string,
  entry: AdjacencyEntry,
): void {
  let bucket = map.get(from);
  if (!bucket) {
    bucket = new Map();
    map.set(from, bucket);
  }
  const existing = bucket.get(to);
  if (!existing || entry.weight > existing.weight) bucket.set(to, entry);
}

export function buildAdjacency(nodes: BoardNode[], edges: BoardEdge[]): Adjacency {
  const ids = nodes.map((node) => node.id);
  const known = new Set(ids);
  const neighbors = new Map<string, Map<string, AdjacencyEntry>>();
  const out = new Map<string, Map<string, AdjacencyEntry>>();
  const inbound = new Map<string, Map<string, AdjacencyEntry>>();
  const incident = new Map<string, string[]>();
  const meta = new Map<string, string[]>();

  for (const id of ids) {
    neighbors.set(id, new Map());
    out.set(id, new Map());
    inbound.set(id, new Map());
    incident.set(id, []);
  }

  for (const edge of edges) {
    const entry: AdjacencyEntry = {
      edgeId: edge.id,
      kind: edge.kind,
      weight: edge.weight > 0 ? edge.weight : 1,
      certainty: edge.certainty,
      directed: edge.direction === 'forward' || edge.direction === 'backward',
    };

    for (const endpoint of [...edge.sources, ...edge.targets]) {
      if (endpoint.on === 'edge') {
        const bucket = meta.get(endpoint.id);
        if (bucket) bucket.push(edge.id);
        else meta.set(endpoint.id, [edge.id]);
      } else if (known.has(endpoint.id)) {
        incident.get(endpoint.id)?.push(edge.id);
      }
    }

    const sourceIds = edge.sources.filter((s) => s.on === 'node' && known.has(s.id)).map((s) => s.id);
    const targetIds = edge.targets.filter((t) => t.on === 'node' && known.has(t.id)).map((t) => t.id);

    for (const source of sourceIds) {
      for (const target of targetIds) {
        if (source === target) continue;
        put(neighbors, source, target, entry);
        put(neighbors, target, source, entry);

        // `backward` means the arrow points at the source, so the causal
        // reading runs target → source.
        const forward = edge.direction !== 'backward';
        const backward = edge.direction === 'backward' || edge.direction === 'both' || edge.direction === 'none';
        if (forward) {
          put(out, source, target, entry);
          put(inbound, target, source, entry);
        }
        if (backward) {
          put(out, target, source, entry);
          put(inbound, source, target, entry);
        }
      }
    }
  }

  return { ids, neighbors, out, in: inbound, incident, meta };
}
