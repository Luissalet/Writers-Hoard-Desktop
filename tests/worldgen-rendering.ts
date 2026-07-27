import * as THREE from 'three';
import {
  clampCameraToSurface,
  MIN_UV_WINDOW,
  R_GLOBE,
  SculptSurface,
  visibleWindow,
} from '@/engines/worldgen/sculpt/scene3d';
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
  surface.uploadAll(new Float32Array(16 * 8).fill(1), new Uint8Array(16 * 8));
  surface.setDetailPatch({
    elevation: new Float32Array(12 * 8).fill(4),
    width: 12,
    height: 8,
    u: 0.2,
    v: 0.25,
    uSize: 0.4,
    vSize: 0.5,
  });
  assert(
    Math.abs(surface.heightAtUV(0.4, 0.5) - 4) < 1e-5,
    'CPU detail sampling does not match the regional patch rendered by the shader',
  );
  assert(
    Math.abs(surface.heightAtUV(0.75, 0.5) - 1) < 1e-5,
    'CPU detail sampling leaked beyond the regional patch',
  );

  const planeCamera = new THREE.Vector3(2, -3, 4);
  assert(
    clampCameraToSurface(planeCamera, 'plane', 4, 0.5, 0.2),
    'close plane camera was not lifted above regional terrain',
  );
  assert(
    Math.abs(planeCamera.y - 2.2) < 1e-5,
    'close plane camera did not preserve the requested terrain clearance',
  );
  const globeCamera = new THREE.Vector3(R_GLOBE - 1, 0, 0);
  assert(
    clampCameraToSurface(globeCamera, 'globe', 4, 0.5, 0.2),
    'close globe camera was not lifted above displaced relief',
  );
  assert(
    globeCamera.length() > R_GLOBE && globeCamera.x > 0,
    'globe camera clamp changed direction or remained inside the globe',
  );

  const firstGeometry = surface.mesh.geometry;
  surface.setMesh(16);
  assert(
    surface.mesh.geometry === firstGeometry,
    'reapplying the active LOD rebuilt geometry during camera interaction',
  );
  surface.setDetailPatch({
    elevation: new Float32Array(12 * 8).fill(3),
    width: 12,
    height: 8,
    u: 0.9,
    v: 0.25,
    uSize: 0.2,
    vSize: 0.5,
  });
  assert(
    Math.abs(surface.heightAtUV(0, 0.5) - 3) < 1e-5,
    'CPU detail sampling did not wrap a regional patch across the world seam',
  );

  const zoomCamera = new THREE.PerspectiveCamera(32, 1.5, 0.02, 1000);
  const zoomTarget = new THREE.Vector3();
  for (let step = 0; step < 32; step += 1) {
    const distance = 90 * 0.78 ** step;
    zoomCamera.position.set(0, Math.max(0.01, distance), Math.max(0.001, distance * 0.35));
    zoomCamera.lookAt(zoomTarget);
    zoomCamera.updateMatrixWorld(true);
    const window = visibleWindow(zoomCamera, 'plane', zoomTarget, 240, 120);
    assert(
      Number.isFinite(window.u)
      && Number.isFinite(window.v)
      && Number.isFinite(window.size)
      && window.size >= MIN_UV_WINDOW
      && window.size <= 1,
      `close zoom produced an invalid UV window at step ${step}`,
    );
    const interactiveCamera = zoomCamera.position.clone();
    clampCameraToSurface(
      interactiveCamera,
      'plane',
      surface.heightAtUV(0, 0.5),
      0.5,
      0.12,
    );
    assert(
      Number.isFinite(interactiveCamera.y) && interactiveCamera.y >= 1.62,
      `close zoom entered regional relief at step ${step}`,
    );
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1116);
  scene.add(surface.mesh);
  const camera = new THREE.PerspectiveCamera(32, 1.5, 0.05, 1000);
  camera.position.set(0, 180, 0.1);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  const context = renderer.getContext();
  assert(
    context.getError() === context.NO_ERROR,
    'regional detail shader produced a WebGL error',
  );
  const pixels = new Uint8Array(96 * 64 * 4);
  context.readPixels(0, 0, 96, 64, context.RGBA, context.UNSIGNED_BYTE, pixels);
  let visiblePixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (
      Math.abs(pixels[index] - 14)
      + Math.abs(pixels[index + 1] - 17)
      + Math.abs(pixels[index + 2] - 22) > 10
    ) {
      visiblePixels += 1;
    }
  }
  assert(visiblePixels > 0, 'regional terrain rendered only the clear color');
  surface.dispose();
  renderer.dispose();
  return 'Worldgen regional detail shader and close-camera guard';
}
