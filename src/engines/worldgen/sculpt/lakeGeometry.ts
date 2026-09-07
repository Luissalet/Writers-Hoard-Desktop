import * as THREE from 'three';
import type { WorldData } from '../core/types';
import { resolveLakeSurface } from '../core/lakeSurface';
import { GLOBE_RELIEF } from './scene3d';

/** One batched mesh per shape, only over lake cells. No planet-sized water
 * plane at a lake's altitude, and no draw call per individual lake. */
export function buildLakeGeometry(world: WorldData, shape: 'plane' | 'globe', o: {
  sizeX: number; sizeZ: number; radius: number;
}): THREE.BufferGeometry {
  const levels = resolveLakeSurface(world);
  const positions: number[] = [], heights: number[] = [], indices: number[] = [];
  // Even small test/preview grids need enough curvature to stay above the globe.
  const steps = shape === 'globe' ? Math.max(1, Math.ceil(256 / world.width)) : 1;
  for (let i = 0; i < world.lake.length; i++) {
    const level = levels[i];
    if (!world.lake[i] || !Number.isFinite(level) || level <= 0) continue;
    const x = i % world.width, y = Math.floor(i / world.width);
    for (let sy = 0; sy < steps; sy++) for (let sx = 0; sx < steps; sx++) {
      const first = heights.length;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const u = (x + (sx + dx) / steps) / world.width;
        const v = (y + (sy + dy) / steps) / world.height;
        if (shape === 'plane') positions.push((u - 0.5) * o.sizeX, level, (v - 0.5) * o.sizeZ);
        else {
          const lon = (u - 0.5) * Math.PI * 2, lat = (0.5 - v) * Math.PI;
          const r = o.radius + level * GLOBE_RELIEF, c = Math.cos(lat);
          positions.push(r * c * Math.cos(lon), r * Math.sin(lat), r * c * Math.sin(lon));
        }
        heights.push(level);
      }
      indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('surfaceHeight', new THREE.Float32BufferAttribute(heights, 1));
  geometry.setIndex(indices);
  return geometry;
}
