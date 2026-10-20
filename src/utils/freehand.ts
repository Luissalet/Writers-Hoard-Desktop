export interface StrokePoint { x: number; y: number }

function segmentDistance(point: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

/** Iterative Ramer–Douglas–Peucker avoids recursion over long pen strokes. */
export function simplifyStroke(source: StrokePoint[], tolerance = 1): StrokePoint[] {
  const points = source.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length <= 2) return points.map(point => ({ ...point }));
  const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1;
  const pending: Array<[number, number]> = [[0, points.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop()!; let distance = Math.max(0, tolerance), farthest = -1;
    for (let index = start + 1; index < end; index++) { const next = segmentDistance(points[index], points[start], points[end]); if (next > distance) { distance = next; farthest = index; } }
    if (farthest >= 0) { keep[farthest] = 1; pending.push([start, farthest], [farthest, end]); }
  }
  return points.filter((_point, index) => keep[index]).map(point => ({ ...point }));
}
