// ============================================
// World Generator — A river from a spring
// ============================================
// Click a spot and let the water find its way: from the clicked cell it keeps
// stepping to the lowest of its eight neighbours (round the east/west seam)
// while that is lower, until it reaches the sea, meets a river already there,
// or lies in a hollow it cannot leave. The path becomes an ordinary drawn
// river edit, so it carves, redraws and undoes like one.

import type { WorldData } from './types';

export type SpringEnd = 'sea' | 'river' | 'hollow' | 'nowhere';
export interface SpringRun { pts: { x: number; y: number }[]; end: SpringEnd; cells: number }

/** The way water runs downhill from (x, y), in world cells. `nowhere` when the spring is in the sea or a hollow already. */
export function traceSpring(world: Pick<WorldData, 'width' | 'height' | 'elevation' | 'rivers'>, x: number, y: number, maxSteps = world.width * 2): SpringRun {
  const W = world.width, H = world.height, elev = world.elevation;
  let cx = ((Math.floor(x) % W) + W) % W, cy = Math.min(H - 1, Math.max(0, Math.floor(y)));
  if (elev[cy * W + cx] <= 0) return { pts: [], end: 'nowhere', cells: 0 };
  const river = new Set<number>();
  for (const path of world.rivers) for (const cell of path.cells) river.add(cell);
  // Keep x continuous across the seam so the drawn line takes the short way round.
  let ux = cx;
  const pts = [{ x: ux + 0.5, y: cy + 0.5 }];
  const seen = new Set<number>([cy * W + cx]);
  let end: SpringEnd = 'hollow';
  for (let step = 0; step < maxSteps; step++) {
    let best = -1, bestElev = elev[cy * W + cx], bdx = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const ny = cy + dy;
      if (ny < 0 || ny >= H) continue;
      const nx = (cx + dx + W) % W, i = ny * W + nx;
      // Diagonal steps are longer: compare the drop per distance, not the raw height.
      const e = elev[i] + (dx && dy ? (elev[cy * W + cx] - elev[i]) * (1 - Math.SQRT1_2) : 0);
      if (e < bestElev && !seen.has(i)) { bestElev = e; best = i; bdx = dx; }
    }
    if (best < 0) break;
    cx = best % W; cy = (best / W) | 0; ux += bdx;
    seen.add(best);
    pts.push({ x: ux + 0.5, y: cy + 0.5 });
    if (elev[best] <= 0) { end = 'sea'; break; }
    if (river.has(best)) { end = 'river'; break; }
  }
  if (pts.length < 2) return { pts: [], end: 'nowhere', cells: 0 };
  return { pts: simplify(pts), end, cells: pts.length };
}

/** Drops points on straight runs, keeping every bend: a run of hundreds of cells stays a short edit. */
function simplify(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const straight = (b.x - a.x) * (c.y - b.y) === (b.y - a.y) * (c.x - b.x) && Math.hypot(b.x - a.x, b.y - a.y) < 12;
    if (!straight) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
