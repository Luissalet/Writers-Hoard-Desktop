import type { WorldData } from './types';

const legacy = new WeakMap<WorldData, { revision: number; surface: Float32Array }>();

/** Legacy masks contain no spill height. Estimate one level per connected lake,
 * bounded by its shore, without modifying the saved terrain or its recipe. */
export function resolveLakeSurface(world: WorldData): Float32Array {
  const n = world.width * world.height;
  if (world.lakeSurface?.length === n) return world.lakeSurface;
  const cached = legacy.get(world);
  if (cached?.revision === world.revision) return cached.surface;
  const surface = new Float32Array(n);
  const visited = new Uint8Array(n);
  const queue = new Uint32Array(n);
  const { width: w, height: h, lake, elevation } = world;
  for (let start = 0; start < n; start++) {
    if (!lake[start] || visited[start]) continue;
    let count = 1, floor = -Infinity, shore = Infinity;
    queue[0] = start; visited[start] = 1;
    for (let q = 0; q < count; q++) {
      const i = queue[q], x = i % w, y = Math.floor(i / w);
      floor = Math.max(floor, elevation[i]);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || y + dy < 0 || y + dy >= h) continue;
        const j = (y + dy) * w + (x + dx + w) % w;
        if (!lake[j]) shore = Math.min(shore, elevation[j]);
        else if (!visited[j]) { visited[j] = 1; queue[count++] = j; }
      }
    }
    const level = Math.max(0.001, floor + 0.001, Number.isFinite(shore) ? shore : floor);
    for (let q = 0; q < count; q++) surface[queue[q]] = level;
  }
  legacy.set(world, { revision: world.revision, surface });
  return surface;
}

/** Mask is authoritative: zero in the optional field never creates an ocean. */
export function lakeHeightAtUV(world: WorldData, u: number, v: number): number {
  if (v < 0 || v > 1) return 0;
  const x = Math.floor(((u % 1 + 1) % 1) * world.width);
  const y = Math.min(world.height - 1, Math.floor(v * world.height));
  const i = y * world.width + x;
  return world.lake[i] ? resolveLakeSurface(world)[i] : 0;
}
