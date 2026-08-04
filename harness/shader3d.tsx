// ¿Compilan los shaders?
//
// TypeScript no sabe nada de GLSL. Un error en el vertex shader del terreno no
// da un fallo de compilación en el editor: da un rectángulo negro en la
// máquina del lector. Esto monta la superficie de verdad en un navegador de
// verdad, con el mismo three.js, y pregunta al driver.
import * as THREE from 'three';
import { SculptSurface } from '../src/engines/worldgen/sculpt/scene3d';

declare global { interface Window { shaderResult?: string } }

const W = 512, H = 320;
const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
document.body.appendChild(canvas);

const errors: string[] = [];
try {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 5000);
  camera.position.set(0, 26, 44);
  camera.lookAt(0, 0, 0);

  const gw = 128, gh = 64;
  const height = new Float32Array(gw * gh);
  const biome = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      // A continent with a mountain spine, so the roughness term has something
      // to bite on and the sea/land gate is exercised on both sides.
      const d = Math.hypot(x / gw - 0.5, y / gh - 0.5);
      height[i] = 1.4 * (0.34 - d) + 0.5 * Math.exp(-((y / gh - 0.5) ** 2) * 220);
      biome[i] = height[i] > 0 ? 6 : 0;
    }
  }
  const palette: [number, number, number][] = [];
  for (let i = 0; i < 48; i++) palette.push([0.3 + (i % 5) * 0.1, 0.5, 0.35]);
  const surface = new SculptSurface({ worldWidth: gw, worldHeight: gh, mesh: 256, palette });
  scene.add(surface.mesh);
  surface.uploadAll(height, biome);
  surface.setShape('plane');
  surface.setExaggeration(1);
  surface.setSun(300, 42);
  surface.setCamera(camera.position);
  // The window the sub-cell relief actually engages in: a twelfth of the world.
  surface.setWindow({ u: 0.5, v: 0.5, size: 0.2 });
  // Two renders, one with the invented relief and one without, so the harness
  // can say whether it does anything rather than only whether it compiles.
  surface.setSubCellRelief(0);
  renderer.render(scene, camera);
  const flat = new Uint8Array(W * H * 4);
  renderer.getContext().readPixels(0, 0, W, H, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, flat);
  surface.setSubCellRelief(0.26);
  renderer.render(scene, camera);

  const gl = renderer.getContext();
  const err = gl.getError();
  if (err !== 0) errors.push(`glGetError ${err}`);
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const tones = new Set<number>();
  for (let i = 0; i < px.length; i += 4 * 37) {
    tones.add((px[i] >> 3 << 10) | (px[i + 1] >> 3 << 5) | (px[i + 2] >> 3));
  }
  let changed = 0, lit = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] + px[i + 1] + px[i + 2] > 24) lit++;
    if (Math.abs(px[i] - flat[i]) > 3) changed++;
  }
  window.shaderResult = JSON.stringify({
    ok: errors.length === 0, errors, tones: tones.size,
    pixelesConTerreno: lit,
    cambiadosPorElRelieve: changed,
    porcentaje: lit ? +(100 * changed / lit).toFixed(1) : 0,
  });
} catch (e) {
  window.shaderResult = JSON.stringify({ ok: false, errors: [String(e)], tones: 0 });
}
