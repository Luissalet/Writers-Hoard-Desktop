// ============================================
// Board Engine — Automatic layouts
// ============================================
//
// Four ways of asking the board to arrange itself. All are pure functions
// returning `id → position`, so the caller can preview, undo, or store the
// result inside a saved view without touching the hand-placed arrangement.
//
// Every layout is deterministic: initial positions come from a hash of the
// node id, never from Math.random, so running "force" twice on an unchanged
// board gives the same picture. A layout that moved things around on every
// press would be unusable for a document you keep coming back to.
//
// Nodes flagged `pinned` are treated as fixed anchors: the rest arranges
// itself around them.

import { CPU_SCALE } from '@/utils/capacity';
import type { BoardEdge, BoardNode } from '../types';
import { buildAdjacency } from './adjacency';
import { GRID_STEP } from '../catalog';

export type LayoutKind = 'force' | 'hierarchy' | 'radial' | 'grid' | 'circle';

export interface LayoutOptions {
  /** Node the radial layout centres on. Defaults to the highest-degree node. */
  focusId?: string;
  /** Extra breathing room between elements, in flow units. */
  spacing?: number;
  /** Force layout only. More iterations means a calmer, slower result. */
  iterations?: number;
}

export type LayoutResult = Record<string, { x: number; y: number }>;

/** Deterministic 0..1 from a string — replaces Math.random for seeding. */
function hash01(value: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function sizeOf(node: BoardNode): { w: number; h: number } {
  return { w: Math.max(40, node.size?.width ?? 200), h: Math.max(40, node.size?.height ?? 120) };
}

function centroidOf(nodes: BoardNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const node of nodes) {
    const size = sizeOf(node);
    x += node.position.x + size.w / 2;
    y += node.position.y + size.h / 2;
  }
  return { x: x / nodes.length, y: y / nodes.length };
}

/** Converts centre points back into top-left positions. */
function toTopLeft(nodes: BoardNode[], centers: Map<string, { x: number; y: number }>): LayoutResult {
  const result: LayoutResult = {};
  for (const node of nodes) {
    const center = centers.get(node.id);
    if (!center) continue;
    const size = sizeOf(node);
    result[node.id] = {
      x: Math.round((center.x - size.w / 2) / GRID_STEP) * GRID_STEP,
      y: Math.round((center.y - size.h / 2) / GRID_STEP) * GRID_STEP,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Force-directed
// ---------------------------------------------------------------------------

function forceLayout(nodes: BoardNode[], edges: BoardEdge[], options: LayoutOptions): LayoutResult {
  const spacing = options.spacing ?? 90;
  // More passes settle the graph further. Scaled by cores because this is a
  // synchronous burst on the machine in front of the author, not shared time.
  const iterations = options.iterations ?? Math.round(320 * Math.min(4, Math.max(1, CPU_SCALE)));
  const adjacency = buildAdjacency(nodes, edges);
  const origin = centroidOf(nodes);

  const area = nodes.length * (260 + spacing) * (180 + spacing);
  const k = Math.sqrt(area / Math.max(1, nodes.length));

  const centers = new Map<string, { x: number; y: number }>();
  const radius = Math.sqrt(area) / 2;
  nodes.forEach((node, index) => {
    if (node.pinned) {
      const size = sizeOf(node);
      centers.set(node.id, { x: node.position.x + size.w / 2, y: node.position.y + size.h / 2 });
      return;
    }
    // Golden-angle spiral seeded per id: spread out, stable, no clumping.
    const angle = index * 2.399963 + hash01(node.id, 1) * 0.6;
    const r = radius * Math.sqrt((index + hash01(node.id, 2)) / Math.max(1, nodes.length));
    centers.set(node.id, { x: origin.x + Math.cos(angle) * r, y: origin.y + Math.sin(angle) * r });
  });

  const displacement = new Map<string, { x: number; y: number }>();
  let temperature = k;

  for (let step = 0; step < iterations; step += 1) {
    for (const node of nodes) displacement.set(node.id, { x: 0, y: 0 });

    // Repulsion — every pair pushes apart.
    for (let i = 0; i < nodes.length; i += 1) {
      const a = centers.get(nodes[i].id);
      if (!a) continue;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = centers.get(nodes[j].id);
        if (!b) continue;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          dx = (hash01(nodes[i].id, 3) - 0.5) * 2;
          dy = (hash01(nodes[j].id, 4) - 0.5) * 2;
          distance = Math.hypot(dx, dy) || 1;
        }
        const force = (k * k) / distance;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        const da = displacement.get(nodes[i].id);
        const db = displacement.get(nodes[j].id);
        if (da) {
          da.x += fx;
          da.y += fy;
        }
        if (db) {
          db.x -= fx;
          db.y -= fy;
        }
      }
    }

    // Attraction — connected nodes pull together, harder for strong relations.
    for (const [sourceId, links] of adjacency.neighbors) {
      const a = centers.get(sourceId);
      if (!a) continue;
      for (const [targetId, entry] of links) {
        if (sourceId >= targetId) continue;
        const b = centers.get(targetId);
        if (!b) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distance = Math.hypot(dx, dy) || 0.01;
        const pull = ((distance * distance) / k) * Math.min(2.5, entry.weight * entry.certainty);
        const fx = (dx / distance) * pull;
        const fy = (dy / distance) * pull;
        const da = displacement.get(sourceId);
        const db = displacement.get(targetId);
        if (da) {
          da.x -= fx;
          da.y -= fy;
        }
        if (db) {
          db.x += fx;
          db.y += fy;
        }
      }
    }

    for (const node of nodes) {
      if (node.pinned) continue;
      const center = centers.get(node.id);
      const delta = displacement.get(node.id);
      if (!center || !delta) continue;
      const magnitude = Math.hypot(delta.x, delta.y) || 1;
      const limited = Math.min(magnitude, temperature);
      center.x += (delta.x / magnitude) * limited;
      center.y += (delta.y / magnitude) * limited;
    }

    temperature = Math.max(k * 0.01, temperature * 0.975);
  }

  return toTopLeft(nodes, centers);
}

// ---------------------------------------------------------------------------
// Hierarchy — layered by causal direction
// ---------------------------------------------------------------------------

function hierarchyLayout(nodes: BoardNode[], edges: BoardEdge[], options: LayoutOptions): LayoutResult {
  const spacing = options.spacing ?? 80;
  const adjacency = buildAdjacency(nodes, edges);
  const rank = new Map<string, number>();
  const visiting = new Set<string>();

  // Longest-path ranking. Cycles are broken by refusing to re-enter a node
  // already on the stack, which keeps a circular plot from hanging the layout.
  const rankOf = (id: string): number => {
    const cached = rank.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const predecessor of adjacency.in.get(id)?.keys() ?? []) {
      best = Math.max(best, rankOf(predecessor) + 1);
    }
    visiting.delete(id);
    rank.set(id, best);
    return best;
  };

  for (const node of nodes) rankOf(node.id);

  const byRank = new Map<number, BoardNode[]>();
  for (const node of nodes) {
    const level = rank.get(node.id) ?? 0;
    const bucket = byRank.get(level);
    if (bucket) bucket.push(node);
    else byRank.set(level, [node]);
  }

  const origin = centroidOf(nodes);
  const centers = new Map<string, { x: number; y: number }>();
  const levels = Array.from(byRank.keys()).sort((a, b) => a - b);
  let y = origin.y - (levels.length * (160 + spacing)) / 2;

  for (const level of levels) {
    const row = (byRank.get(level) ?? []).slice().sort((a, b) => a.title.localeCompare(b.title));
    const rowHeight = Math.max(...row.map((node) => sizeOf(node).h), 120);
    let totalWidth = 0;
    for (const node of row) totalWidth += sizeOf(node).w + spacing;
    let x = origin.x - totalWidth / 2;
    for (const node of row) {
      const size = sizeOf(node);
      centers.set(node.id, { x: x + size.w / 2, y: y + rowHeight / 2 });
      x += size.w + spacing;
    }
    y += rowHeight + spacing + 40;
  }

  return toTopLeft(nodes, centers);
}

// ---------------------------------------------------------------------------
// Radial — rings of increasing distance from a focus
// ---------------------------------------------------------------------------

function radialLayout(nodes: BoardNode[], edges: BoardEdge[], options: LayoutOptions): LayoutResult {
  const spacing = options.spacing ?? 90;
  const adjacency = buildAdjacency(nodes, edges);

  let focusId = options.focusId;
  if (!focusId || !adjacency.neighbors.has(focusId)) {
    let best = -1;
    for (const node of nodes) {
      const degree = adjacency.neighbors.get(node.id)?.size ?? 0;
      if (degree > best) {
        best = degree;
        focusId = node.id;
      }
    }
  }
  if (!focusId) return {};

  const depth = new Map<string, number>([[focusId, 0]]);
  const queue = [focusId];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentDepth = depth.get(current) ?? 0;
    for (const neighbor of adjacency.neighbors.get(current)?.keys() ?? []) {
      if (depth.has(neighbor)) continue;
      depth.set(neighbor, currentDepth + 1);
      queue.push(neighbor);
    }
  }

  // Anything unreachable is parked on an outer ring rather than dropped.
  const maxDepth = Math.max(0, ...depth.values());
  for (const node of nodes) if (!depth.has(node.id)) depth.set(node.id, maxDepth + 1);

  const rings = new Map<number, BoardNode[]>();
  for (const node of nodes) {
    const level = depth.get(node.id) ?? 0;
    const bucket = rings.get(level);
    if (bucket) bucket.push(node);
    else rings.set(level, [node]);
  }

  const origin = centroidOf(nodes);
  const centers = new Map<string, { x: number; y: number }>();
  for (const [level, ring] of rings) {
    if (level === 0) {
      for (const node of ring) centers.set(node.id, { x: origin.x, y: origin.y });
      continue;
    }
    const circumference = ring.reduce((sum, node) => sum + sizeOf(node).w + spacing, 0);
    const radius = Math.max(level * (200 + spacing), circumference / (2 * Math.PI));
    ring.sort((a, b) => a.title.localeCompare(b.title));
    ring.forEach((node, index) => {
      const angle = (index / ring.length) * Math.PI * 2 - Math.PI / 2;
      centers.set(node.id, {
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y + Math.sin(angle) * radius,
      });
    });
  }

  return toTopLeft(nodes, centers);
}

// ---------------------------------------------------------------------------
// Grid and circle — tidy-up layouts, no graph structure involved
// ---------------------------------------------------------------------------

function gridLayout(nodes: BoardNode[], options: LayoutOptions): LayoutResult {
  const spacing = options.spacing ?? 40;
  const sorted = nodes
    .slice()
    .sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind.localeCompare(b.kind)));
  const columns = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const cellWidth = Math.max(...sorted.map((node) => sizeOf(node).w), 200) + spacing;
  const cellHeight = Math.max(...sorted.map((node) => sizeOf(node).h), 140) + spacing;
  const origin = centroidOf(nodes);
  const rows = Math.ceil(sorted.length / columns);
  const startX = origin.x - (columns * cellWidth) / 2;
  const startY = origin.y - (rows * cellHeight) / 2;

  const result: LayoutResult = {};
  sorted.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    result[node.id] = {
      x: Math.round((startX + column * cellWidth) / GRID_STEP) * GRID_STEP,
      y: Math.round((startY + row * cellHeight) / GRID_STEP) * GRID_STEP,
    };
  });
  return result;
}

function circleLayout(nodes: BoardNode[], options: LayoutOptions): LayoutResult {
  const spacing = options.spacing ?? 60;
  const origin = centroidOf(nodes);
  const circumference = nodes.reduce((sum, node) => sum + sizeOf(node).w + spacing, 0);
  const radius = Math.max(200, circumference / (2 * Math.PI));
  const centers = new Map<string, { x: number; y: number }>();
  const sorted = nodes.slice().sort((a, b) => a.title.localeCompare(b.title));
  sorted.forEach((node, index) => {
    const angle = (index / sorted.length) * Math.PI * 2 - Math.PI / 2;
    centers.set(node.id, { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius });
  });
  return toTopLeft(nodes, centers);
}

// ---------------------------------------------------------------------------

export function runLayout(
  kind: LayoutKind,
  nodes: BoardNode[],
  edges: BoardEdge[],
  options: LayoutOptions = {},
): LayoutResult {
  const movable = nodes.filter((node) => !node.locked);
  if (movable.length === 0) return {};
  switch (kind) {
    case 'hierarchy':
      return hierarchyLayout(movable, edges, options);
    case 'radial':
      return radialLayout(movable, edges, options);
    case 'grid':
      return gridLayout(movable, options);
    case 'circle':
      return circleLayout(movable, options);
    case 'force':
    default:
      return forceLayout(movable, edges, options);
  }
}
