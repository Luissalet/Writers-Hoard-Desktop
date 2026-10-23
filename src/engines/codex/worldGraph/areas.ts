import type { CodexEntryType } from '@/types';
import { WORLD_GRAPH_CARD_SIZE, type CodexGraphLayout, type WorldGraphDisplay, type WorldGraphNode } from './types';

interface Point { x: number; y: number }
export interface WorldGraphTypeArea { type: CodexEntryType; points: Point[]; label: Point }
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Convex context regions use the final visible card rectangles, including pins. */
export function worldGraphTypeAreas(nodes: readonly WorldGraphNode[], positions: CodexGraphLayout['positions'], nodeSize: WorldGraphDisplay['nodeSize'] = 'medium'): WorldGraphTypeArea[] {
  const groups = new Map<CodexEntryType, Point[]>(), size = WORLD_GRAPH_CARD_SIZE[nodeSize];
  for (const node of nodes) {
    const at = positions[node.id]; if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
    const points = groups.get(node.type) ?? [];
    const left = at.x - 20, right = at.x + size.width + 20, top = at.y - 28, bottom = at.y + size.height + 20;
    points.push({ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom });
    groups.set(node.type, points);
  }
  return [...groups].map(([type, points]) => {
    const sorted = points.sort((a, b) => a.x - b.x || a.y - b.y);
    const half = (items: Point[]) => { const chain: Point[] = []; for (const point of items) { while (chain.length > 1 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop(); chain.push(point); } return chain.slice(0, -1); };
    const hull = [...half(sorted), ...half([...sorted].reverse())];
    return { type, points: hull, label: { x: Math.min(...hull.map(point => point.x)) + 12, y: Math.min(...hull.map(point => point.y)) + 17 } };
  });
}
