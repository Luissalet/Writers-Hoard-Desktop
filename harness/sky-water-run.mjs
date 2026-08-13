// ¿Qué pinta tienen el cielo y el agua nuevos?
//
// Monta la superficie de verdad (SculptSurface), le pone encima sky.ts y
// water.ts, y saca un PNG por cada pose — costa de día, atardecer a contraluz,
// noche, mapa cenital y globo — para poder MIRARLOS. Un banco que sólo dice
// "compila" no habría visto ninguno de los tres fallos que hubo que corregir
// aquí (el mar terminaba en canto, la espuma se comía el planeta, el limbo
// salía negro).
//
// El código de la página va en `stdin` de esbuild a propósito: así todo el
// banco es UN archivo.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

mkdirSync('harness/out/sky-water', { recursive: true });

const SRC = String.raw`
import * as THREE from 'three';
import { SculptSurface, SIZE_X, R_GLOBE, visibleWindow } from '../src/engines/worldgen/sculpt/scene3d';
import { createSky } from '../src/engines/worldgen/sculpt/sky';
import { createWater } from '../src/engines/worldgen/sculpt/water';

declare global {
  interface Window {
    swResult?: string;
    setPose?: (i: number) => void;
    poseNames?: string[];
  }
}

const W = 1100, H = 700;
const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
document.body.appendChild(canvas);

const errors: string[] = [];

// ---- un mundo, determinista ------------------------------------------------
const gw = 512, gh = 256;
function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}
function fbm(x: number, y: number, oct: number): number {
  let s = 0, a = 0.5, f = 1;
  for (let k = 0; k < oct; k++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}
const elev = new Float32Array(gw * gh);
const biome = new Uint8Array(gw * gh);
for (let y = 0; y < gh; y++) {
  for (let x = 0; x < gw; x++) {
    const i = y * gw + x;
    const u = x / gw, v = y / gh;
    // Continentes: fbm menos un umbral, con los polos hundidos para que la
    // malla no tenga que fingir tierra donde la proyección se rompe.
    const n = fbm(u * 7, v * 7, 6);
    const poles = 1 - Math.pow(Math.abs(v - 0.5) * 2, 3);
    let e = (n - 0.47) * 7 * poles;
    if (e > 0) {
      // Cordilleras: ruido con cresta sobre la tierra, para que la luz tenga
      // algo que hacer y la costa no sea una circunferencia.
      const r = 1 - Math.abs(fbm(u * 19 + 3.1, v * 19 + 7.7, 4) * 2 - 1);
      e += r * r * 2.6 * Math.min(1, e * 1.4);
    } else {
      e *= 0.9;
    }
    elev[i] = e;
    biome[i] = e > 0 ? (e > 1.6 ? 12 : 6) : 0;
  }
}

const palette: [number, number, number][] = [];
for (let i = 0; i < 48; i++) palette.push([0.30, 0.42, 0.24]);
palette[0] = [0.10, 0.20, 0.32];
palette[6] = [0.33, 0.45, 0.26];
palette[12] = [0.52, 0.48, 0.40];

// ---- escena ---------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, W / H, 0.25, 6000);

const surface = new SculptSurface({ worldWidth: gw, worldHeight: gh, mesh: 384, palette });
surface.uploadAll(elev, biome);
surface.setExaggeration(6);
surface.setShading(false, 0.5, false, 0.55);
surface.setContour(0);
scene.add(surface.mesh);
const sizeZ = SIZE_X * (gh / gw);
const yMul = surface.yMul;

const sky = createSky({ renderer });
scene.add(sky.mesh);
const water = createWater({ seed: 'banco-cielo-agua', sizeX: SIZE_X, sizeZ, radius: R_GLOBE });
scene.add(water.plane);
scene.add(water.globe);

// La textura de alturas que el agua lee. Es la MISMA copia que el terreno usa:
// en la vista real World3D pasará surface's heightTex; aquí se reconstruye
// igual para no tocar scene3d.ts.
const heightTex = new THREE.DataTexture(elev, gw, gh, THREE.RedFormat, THREE.FloatType);
heightTex.magFilter = THREE.NearestFilter;
heightTex.minFilter = THREE.NearestFilter;
heightTex.wrapS = THREE.RepeatWrapping;
heightTex.needsUpdate = true;

// ---- una costa de verdad donde plantar la cámara --------------------------
// Se busca la celda de tierra con más mar alrededor: eso es una punta, y una
// punta es lo que hace falta para ver a la vez orilla, bajío y mar abierto.
let bestX = 0, bestY = 0, bestScore = -1;
for (let y = 40; y < gh - 40; y += 2) {
  for (let x = 0; x < gw; x += 2) {
    if (elev[y * gw + x] <= 0.05) continue;
    let sea = 0;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const sx = ((Math.round(x + Math.cos(a) * 7) % gw) + gw) % gw;
      const sy = Math.min(gh - 1, Math.max(0, Math.round(y + Math.sin(a) * 7)));
      if (elev[sy * gw + sx] < -0.2) sea++;
    }
    if (sea > bestScore) { bestScore = sea; bestX = x; bestY = y; }
  }
}
const coastPos = new THREE.Vector3(
  (bestX / gw - 0.5) * SIZE_X, 0, (bestY / gh - 0.5) * sizeZ,
);

function sunDir(azDeg: number, elDeg: number): THREE.Vector3 {
  const a = azDeg * Math.PI / 180, e = elDeg * Math.PI / 180;
  return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
}

interface Pose {
  name: string;
  shape: 'plane' | 'globe';
  cam: THREE.Vector3;
  target: THREE.Vector3;
  sun: THREE.Vector3;
  spanKm: number;
  time: number;
}

const near = coastPos.clone().add(new THREE.Vector3(9, 1.6, 9));
const POSES: Pose[] = [
  { name: 'costa-dia', shape: 'plane', cam: near.clone(), target: coastPos.clone(),
    sun: sunDir(140, 34), spanKm: 900, time: 12 },
  { name: 'atardecer', shape: 'plane',
    cam: coastPos.clone().add(new THREE.Vector3(-11, 1.4, -7)),
    target: coastPos.clone(), sun: sunDir(35, 3.5), spanKm: 900, time: 31 },
  { name: 'noche', shape: 'plane', cam: near.clone(), target: coastPos.clone(),
    sun: sunDir(140, -11), spanKm: 900, time: 50 },
  { name: 'regional', shape: 'plane',
    cam: coastPos.clone().add(new THREE.Vector3(26, 16, 30)),
    target: coastPos.clone(), sun: sunDir(215, 22), spanKm: 4200, time: 20 },
  { name: 'mapa', shape: 'plane', cam: new THREE.Vector3(0, 240, 90),
    target: new THREE.Vector3(0, 0, 0), sun: sunDir(140, 40), spanKm: 40075, time: 5 },
  { name: 'globo', shape: 'globe', cam: new THREE.Vector3(70, 34, 78),
    target: new THREE.Vector3(0, 0, 0), sun: sunDir(15, 12), spanKm: 20000, time: 8 },
];
window.poseNames = POSES.map((p) => p.name);

const fwd = new THREE.Vector3();
let current = 0;

function applyPose(i: number): void {
  const p = POSES[i];
  camera.position.copy(p.cam);
  camera.lookAt(p.target);
  const dist = camera.position.distanceTo(p.target);
  camera.near = Math.max(0.05, Math.min(dist * 0.01, 2));
  camera.far = Math.max(dist * 4 + SIZE_X * 1.5, SIZE_X * 3);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  surface.setShape(p.shape);
  surface.setSun(Math.atan2(p.sun.z, p.sun.x) * 180 / Math.PI,
    Math.asin(Math.max(-1, Math.min(1, p.sun.y))) * 180 / Math.PI);
  surface.setCamera(camera.position);
  surface.setWindow(visibleWindow(camera, p.shape, gw, gh));
  water.plane.visible = p.shape === 'plane';
  water.globe.visible = p.shape === 'globe';

  sky.update({ camera, sun: p.sun, shape: p.shape, spanKm: p.spanKm });
  camera.getWorldDirection(fwd);
  // APLANADA: el agua funde al cielo EN EL HORIZONTE, no al que hay bajo los
  // pies. Ver el comentario de water.update.
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-9) fwd.set(0, 0, 1);
  water.update({
    camera, sun: p.sun, time: p.time,
    horizon: sky.horizonColor(fwd.normalize()),
    heightTex, gridW: gw, gridH: gh, yMul, seaLevel: 0,
    sky: sky.waterSky(),
  });
}

window.setPose = (i: number) => { current = i; applyPose(i); renderer.render(scene, camera); };

// ---- medida ---------------------------------------------------------------
const gl = renderer.getContext();
const one = new Uint8Array(4);
function timeIt(label: string, frames: number): number {
  // readPixels fuerza la sincronización: sin él se cronometra el ENVÍO de
  // órdenes, no el dibujo, y salen microsegundos que no significan nada.
  applyPose(current);
  renderer.render(scene, camera);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
  const t0 = performance.now();
  for (let k = 0; k < frames; k++) {
    renderer.render(scene, camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
  }
  return (performance.now() - t0) / frames;
}

try {
  applyPose(0);
  renderer.render(scene, camera);
  const err0 = gl.getError();
  if (err0 !== 0) errors.push('glGetError ' + err0);

  // Coste de cada capa, en la pose más cara (costa baja: el mar ocupa media
  // pantalla y el oleaje está a plena resolución).
  //
  // CADA CAPA A SOLAS, y el mínimo de tres tandas. SwiftShader es un
  // rasterizador por software compartiendo hilos con el resto del proceso:
  // medido una sola vez, la varianza entre tandas llega al 5 % y llegó a dar
  // "el agua sale más barata que el cielo", que es imposible. El mínimo es el
  // fotograma sin interferencias, que es el que se quiere comparar.
  current = 0;
  const best = (fn: () => number): number => {
    let m = Infinity;
    for (let r = 0; r < 3; r++) m = Math.min(m, fn());
    return m;
  };
  surface.mesh.visible = true; water.plane.visible = false; sky.mesh.visible = false;
  const soloTerreno = best(() => timeIt('terreno', 6));
  surface.mesh.visible = false; sky.mesh.visible = true;
  const soloCielo = best(() => timeIt('cielo', 6));
  sky.mesh.visible = false; water.plane.visible = true;
  const soloAgua = best(() => timeIt('agua', 6));
  surface.mesh.visible = true; sky.mesh.visible = true;
  const todo = best(() => timeIt('todo', 6));

  // Y una comprobación numérica: ¿hay agua distinta del cielo, y hay espuma?
  applyPose(0);
  renderer.render(scene, camera);
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const tones = new Set<number>();
  let blanco = 0, oscuro = 0;
  for (let i = 0; i < px.length; i += 4) {
    tones.add((px[i] >> 3 << 10) | (px[i + 1] >> 3 << 5) | (px[i + 2] >> 3));
    if (px[i] > 215 && px[i + 1] > 220 && px[i + 2] > 220) blanco++;
    if (px[i] + px[i + 1] + px[i + 2] < 30) oscuro++;
  }
  window.swResult = JSON.stringify({
    ok: errors.length === 0,
    errors,
    costa: [bestX, bestY],
    tonos: tones.size,
    pixelesEspumaOCielo: blanco,
    pixelesCasiNegros: oscuro,
    ms: {
      soloTerreno: +soloTerreno.toFixed(1),
      soloCielo: +soloCielo.toFixed(1),
      soloAgua: +soloAgua.toFixed(1),
      todo: +todo.toFixed(1),
    },
  });
} catch (e) {
  window.swResult = JSON.stringify({ ok: false, errors: [String(e)] });
}

// El bucle mantiene la última pose presentada: sin él, la captura de Playwright
// llega después de que el compositor haya tirado el buffer y sale negra.
function loop(): void {
  applyPose(current);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
`;

await build({
  stdin: { contents: SRC, resolveDir: 'harness', loader: 'ts', sourcefile: 'sky-water.ts' },
  bundle: true,
  outfile: 'harness/out/sky-water.js',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});

const js = readFileSync('harness/out/sky-water.js');
const server = createServer((req, res) => {
  if (req.url.startsWith('/app.js')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(js);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><html><body style="margin:0;background:#000">'
    + '<script src="/app.js"></script></body></html>');
});
await new Promise((r) => server.listen(8137, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + String(e).slice(0, 500)));
page.on('console', (m) => {
  if (m.type() === 'error' || /shader|GLSL|WebGL/i.test(m.text())) logs.push(m.text().slice(0, 600));
});
// 'commit', no 'load': el guion bloquea el hilo principal varios minutos
// compilando shaders y midiendo sobre SwiftShader, y 'load' vence antes.
await page.goto('http://localhost:8137/', { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => window.swResult !== undefined, { timeout: 300000 }).catch(() => {});
console.log('resultado:', await page.evaluate(() => window.swResult ?? 'sin resultado'));

const names = await page.evaluate(() => window.poseNames ?? []);
for (let i = 0; i < names.length; i++) {
  await page.evaluate((k) => window.setPose(k), i);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `harness/out/sky-water/${i}-${names[i]}.png`, timeout: 120000 });
}
if (logs.length) console.log('mensajes:\n' + logs.join('\n'));
await browser.close();
server.close();
