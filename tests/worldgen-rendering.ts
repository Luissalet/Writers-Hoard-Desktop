import * as THREE from 'three';
import { SculptSurface } from '@/engines/worldgen/sculpt/scene3d';
import { BIOME_COLORS } from '@/engines/worldgen/core/render';
import { BIOME_COUNT } from '@/engines/worldgen/core/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function testWorldgenDetailShader(): string {
  const renderer = new THREE.WebGLRenderer({
    canvas: document.createElement('canvas'),
    antialias: false,
  });
  renderer.setSize(96, 64, false);
  const palette: [number, number, number][] = [];
  for (let index = 0; index < BIOME_COUNT; index += 1) {
    const color = BIOME_COLORS[index] ?? [128, 128, 128];
    palette.push([color[0] / 255, color[1] / 255, color[2] / 255]);
  }
  const surface = new SculptSurface({
    worldWidth: 16,
    worldHeight: 8,
    mesh: 16,
    palette,
  });
  surface.uploadAll(new Float32Array(16 * 8), new Uint8Array(16 * 8));
  surface.setDetailPatch({
    elevation: new Float32Array(12 * 8).map((_, index) => Math.sin(index * 0.1) * 0.02),
    width: 12,
    height: 8,
    u: 0.2,
    v: 0.25,
    uSize: 0.4,
    vSize: 0.5,
  });
  const scene = new THREE.Scene();
  scene.add(surface.mesh);
  const camera = new THREE.PerspectiveCamera(32, 1.5, 0.05, 1000);
  camera.position.set(0, 80, 90);
  camera.lookAt(0, 0, 0);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  assert(
    renderer.getContext().getError() === renderer.getContext().NO_ERROR,
    'regional detail shader produced a WebGL error',
  );
  surface.dispose();
  renderer.dispose();
  return 'Worldgen regional detail shader';
}
