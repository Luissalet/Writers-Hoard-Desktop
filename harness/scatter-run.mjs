// ¿Qué pinta tiene la vegetación nueva?
//
// Monta la superficie de verdad (SculptSurface) con cielo y agua, le pone
// encima scatter.ts, y saca un PNG por cada pose — un bosque a ras de suelo, un
// valle desde una ladera, el mismo bosque a contraluz, una vista comarcal, una
// regional, el mapa cenital y el globo — para poder MIRARLOS. Un banco que sólo
// dice "compila" no habría visto ninguno de los fallos que hubo que corregir
// aquí.
//
// Y mide: instancias por pose, milisegundos de siembra, y el coste de cada capa
// a solas en la pose más cara.
//
// El código de la página va en el stdin de esbuild a propósito: así todo el
// banco es UN archivo.
//
// CUIDADO AL EDITAR SRC: vive dentro de un String.raw, así que UNA SOLA COMILLA
// INVERSA lo cierra por la mitad y Node muere quejándose de una línea de prosa
// española que no tiene nada de malo. En los comentarios de ahí dentro los
// identificadores van sin comillas. Ha pasado dos veces.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright-core';

// SE BORRA LO ANTERIOR. Los PNG llevan el índice de la pose en el nombre, así
// que en cuanto se añade una pose por el medio los ficheros viejos se quedan
// con nombres que ya no existen — y uno acaba mirando el fotograma de la
// ejecución de hace dos horas creyendo que es el de ahora.
rmSync('harness/out/scatter', { recursive: true, force: true });
mkdirSync('harness/out/scatter', { recursive: true });

const SRC = String.raw`
import * as THREE from 'three';
import { SculptSurface, SIZE_X, R_GLOBE, visibleWindow, elevKmToY } from '../src/engines/worldgen/sculpt/scene3d';
import { createSky } from '../src/engines/worldgen/sculpt/sky';
import { createWater } from '../src/engines/worldgen/sculpt/water';
import { createScatter } from '../src/engines/worldgen/sculpt/scatter';
import { BIOME_COLORS } from '../src/engines/worldgen/core/render';
import { Biome, BIOME_COUNT } from '../src/engines/worldgen/core/types';

declare global {
  interface Window {
    scResult?: string;
    setPose?: (i: number) => void;
    poseNames?: string[];
  }
}

const W = 1200, H = 760;
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
  const t = a + (b - a) * fx;
  return t + ((c + (d - c) * fx) - t) * fy;
}
function fbm(x: number, y: number, oct: number): number {
  let s = 0, a = 0.5, f = 1;
  for (let k = 0; k < oct; k++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}
const elev = new Float32Array(gw * gh);
const biome = new Uint8Array(gw * gh);
const temp = new Float32Array(gw * gh);
for (let y = 0; y < gh; y++) {
  for (let x = 0; x < gw; x++) {
    const i = y * gw + x;
    const u = x / gw, v = y / gh;
    const n = fbm(u * 7, v * 7, 6);
    const poles = 1 - Math.pow(Math.abs(v - 0.5) * 2, 3);
    let e = (n - 0.47) * 7 * poles;
    if (e > 0) {
      const r = 1 - Math.abs(fbm(u * 19 + 3.1, v * 19 + 7.7, 4) * 2 - 1);
      e += r * r * 2.6 * Math.min(1, e * 1.4);
    } else {
      e *= 0.9;
    }
    elev[i] = e;
    // Temperatura por latitud menos gradiente vertical, y humedad de ruido:
    // con eso salen bandas de bioma de verdad —taiga, templado, sabana, selva,
    // desierto, tundra— y el banco puede ver las cinco especies en un mismo
    // fotograma en vez de un bosque monoespecífico.
    const lat = Math.abs(v - 0.5) * 2;
    const t = 30 - 46 * lat * lat - Math.max(0, e) * 6.2;
    temp[i] = t;
    const wet = fbm(u * 5 + 11.3, v * 5 + 2.7, 4);
    let b = Biome.Ocean;
    if (e <= 0) b = Biome.Ocean;
    else if (e < 0.06) b = Biome.Beach;
    else if (t < -8) b = Biome.IceCap;
    else if (e > 3.3) b = Biome.Alpine;
    else if (t < 0) b = Biome.Tundra;
    else if (t < 7) b = wet > 0.46 ? Biome.BorealForest : Biome.ColdDesert;
    else if (t < 17) {
      b = wet > 0.58 ? Biome.TemperateRainforest
        : wet > 0.46 ? Biome.TemperateForest
        : wet > 0.38 ? Biome.Grassland : Biome.Steppe;
      if (e > 2.0 && wet > 0.42) b = Biome.MontaneForest;
    } else {
      b = wet > 0.60 ? Biome.TropicalRainforest
        : wet > 0.50 ? Biome.TropicalForest
        : wet > 0.42 ? Biome.Savanna
        : wet > 0.35 ? Biome.Shrubland : Biome.Desert;
    }
    biome[i] = b;
  }
}

// La paleta del terreno, la MISMA que el atlas: así se ve si el follaje pega.
const palette: [number, number, number][] = [];
for (let i = 0; i < 48; i++) {
  const c = BIOME_COLORS[i] ?? BIOME_COLORS[Biome.Grassland];
  palette.push([c[0] / 255, c[1] / 255, c[2] / 255]);
}
void BIOME_COUNT;

// ---- escena ---------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, W / H, 0.25, 6000);

const EXAG = 6;
const surface = new SculptSurface({ worldWidth: gw, worldHeight: gh, mesh: 512, palette });
surface.uploadAll(elev, biome);
surface.setExaggeration(EXAG);
surface.setShading(false, 0.5, false, 0.55);
surface.setContour(0);
scene.add(surface.mesh);
const sizeZ = SIZE_X * (gh / gw);
const yMul = elevKmToY(EXAG, gw);

const sky = createSky({ renderer });
scene.add(sky.mesh);
const water = createWater({ seed: 'banco-vegetacion', sizeX: SIZE_X, sizeZ, radius: R_GLOBE });
scene.add(water.plane);
scene.add(water.globe);

const scatter = createScatter({ seed: 'banco-vegetacion', sizeX: SIZE_X, sizeZ, radius: R_GLOBE });
scene.add(scatter.group);
scatter.setWorld({
  elevation: elev, biome, width: gw, height: gh, yMul, seaLevel: 0,
  temperature: temp,
  heightAt: (u, v) => surface.heightAtUV(u, v),
});

const heightTex = new THREE.DataTexture(elev, gw, gh, THREE.RedFormat, THREE.FloatType);
heightTex.magFilter = THREE.NearestFilter;
heightTex.minFilter = THREE.NearestFilter;
heightTex.wrapS = THREE.RepeatWrapping;
heightTex.needsUpdate = true;

// ---- un bosque de verdad donde plantar la cámara --------------------------
// Se busca la celda de bosque templado con más desnivel alrededor: eso es una
// ladera arbolada, que es a la vez el sitio donde se ve si los árboles se
// apoyan en el suelo y el sitio donde un bosque se lee como bosque.
const FOREST = new Set<number>([
  Biome.BorealForest, Biome.TemperateForest, Biome.TemperateRainforest,
  Biome.MontaneForest, Biome.TropicalForest, Biome.TropicalRainforest,
]);
let bx = 0, by = 0, best = -1;
for (let y = 30; y < gh - 30; y++) {
  for (let x = 0; x < gw; x++) {
    const i = y * gw + x;
    if (!FOREST.has(biome[i])) continue;
    if (elev[i] < 0.30 || elev[i] > 2.0) continue;
    // El vecindario TIENE QUE SER BOSQUE. Sin esta condición el banco eligió
    // una arista de cordillera a 2,56 km rodeada de mar y de roca desnuda —
    // maximizaba el desnivel, que era lo que se le pedía, y salía un fotograma
    // sin un solo árbol. Lo que hace falta es una ladera arbolada.
    let wooded = 0;
    let relief = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const rad = 3 + (k % 4) * 3;
      const sx = ((Math.round(x + Math.cos(a) * rad) % gw) + gw) % gw;
      const sy = Math.min(gh - 1, Math.max(0, Math.round(y + Math.sin(a) * rad)));
      if (FOREST.has(biome[sy * gw + sx])) wooded++;
      relief += Math.abs(elev[sy * gw + sx] - elev[i]);
    }
    if (wooded < 13) continue;
    const score = wooded * 2 + relief;
    if (score > best) { best = score; bx = x; by = y; }
  }
}
const woodU = bx / gw, woodV = by / gh;
const woodPos = new THREE.Vector3(
  (woodU - 0.5) * SIZE_X, surface.heightAtUV(woodU, woodV) * yMul, (woodV - 0.5) * sizeZ,
);

/** Un punto del suelo a d unidades del bosque en la dirección ang. */
function ground(d: number, ang: number): THREE.Vector3 {
  const x = woodPos.x + Math.cos(ang) * d;
  const z = woodPos.z + Math.sin(ang) * d;
  const u = x / SIZE_X + 0.5, v = z / sizeZ + 0.5;
  return new THREE.Vector3(x, surface.heightAtUV(u, v) * yMul, z);
}

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
  time: number;
}

// A RAS DE SUELO. Se busca la direccion en la que el terreno BAJA: mirando
// cuesta arriba, una camara a media unidad del suelo solo ve una pared de
// ladera, que fue exactamente el primer fotograma que sacó este banco. Cuesta
// abajo se ve el bosque alejandose, que es la vista que hay que juzgar.
let downAng = 0, downDrop = -1e9;
for (let k = 0; k < 24; k++) {
  const a = (k / 24) * Math.PI * 2;
  const drop = woodPos.y - ground(5, a).y;
  if (drop > downDrop) { downDrop = drop; downAng = a; }
}
const eye0 = woodPos.clone(); eye0.y += 0.50;
// El objetivo, CASI A LA ALTURA DE LOS OJOS. Apuntando al suelo de un valle a
// cinco unidades, el rayo central corta el terreno ahi mismo y el encuadre sale
// de dos unidades: arboles de sesenta metros y un fotograma de pimienta verde.
// Mirando casi horizontal, el rayo llega al otro lado del valle, que es lo que
// el lector esta mirando de verdad.
const look0 = ground(7.0, downAng);
look0.y = eye0.y - 0.34;
// Desde una ladera: se busca el punto alto a diez unidades y se mira al valle.
let hiPos = ground(9, 2.1);
for (let k = 0; k < 16; k++) {
  const p = ground(9 + k * 0.4, 2.1 + k * 0.12);
  if (p.y > hiPos.y) hiPos = p;
}
const eye1 = hiPos.clone(); eye1.y += 0.9;
const sunAz = Math.atan2(look0.z - eye0.z, look0.x - eye0.x) * 180 / Math.PI;

// El mismo bosque, pero sobre la esfera.
const glon = (woodU - 0.5) * Math.PI * 2;
const glat = (0.5 - woodV) * Math.PI;
const globeUp = new THREE.Vector3(
  Math.cos(glat) * Math.cos(glon), Math.sin(glat), Math.cos(glat) * Math.sin(glon),
);
const globeEast = new THREE.Vector3(-Math.sin(glon), 0, Math.cos(glon));
const globeSurf = globeUp.clone().multiplyScalar(
  R_GLOBE + surface.heightAtUV(woodU, woodV) * yMul * 0.55,
);
// A PLOMO, que es como mira el globo de verdad: su orbita apunta al centro del
// planeta, asi que el punto que se mira es siempre el subpunto de la camara
// (ver focusWindow en scene3d.ts). Una vista rasante del globo no existe en la
// aplicacion, y probada aqui solo dice que a ras de limbo se amontonan copas.
const globeEye = globeSurf.clone().addScaledVector(globeUp, 3.2);

const POSES: Pose[] = [
  { name: 'bosque-a-ras', shape: 'plane', cam: eye0.clone(), target: look0.clone(),
    sun: sunDir(sunAz + 118, 32), time: 4 },
  // El sol JUSTO DELANTE y rasante: es la prueba del contraluz, y la pose en la
  // que un bosque sin luz atravesando la hoja sale como una silueta negra.
  { name: 'bosque-contraluz', shape: 'plane', cam: eye0.clone(), target: look0.clone(),
    sun: sunDir(sunAz, 5), time: 9 },
  { name: 'valle-desde-ladera', shape: 'plane', cam: eye1.clone(), target: woodPos.clone(),
    sun: sunDir(210, 27), time: 14 },
  { name: 'comarcal', shape: 'plane',
    cam: woodPos.clone().add(new THREE.Vector3(-7, 5.5, -9)), target: woodPos.clone(),
    sun: sunDir(150, 34), time: 20 },
  // JUSTO EN MEDIO DEL DESVANECIDO (unos 2.600 km de encuadre, el 31 % del
  // tamaño). Es la pose que hay que mirar para saber si al alejarse el bosque se
  // convierte en GRANO —textura de dosel, que es lo que se ve de verdad desde un
  // avión— o en PIMIENTA, que son puntos oscuros sobre una ladera lisa. Sin
  // ella, entre la comarcal (al 65 %) y la regional (apagada) no hay nada que
  // juzgar, y el tramo intermedio es justo donde falla.
  { name: 'media-distancia', shape: 'plane',
    cam: woodPos.clone().add(new THREE.Vector3(-9.5, 7.5, -12)), target: woodPos.clone(),
    sun: sunDir(150, 36), time: 23 },
  { name: 'regional', shape: 'plane',
    cam: woodPos.clone().add(new THREE.Vector3(-14, 11, -18)), target: woodPos.clone(),
    sun: sunDir(150, 38), time: 26 },
  { name: 'cenital', shape: 'plane',
    cam: woodPos.clone().add(new THREE.Vector3(0, 9, 0.6)), target: woodPos.clone(),
    sun: sunDir(150, 42), time: 31 },
  { name: 'mapa', shape: 'plane', cam: new THREE.Vector3(0, 240, 90),
    target: new THREE.Vector3(0, 0, 0), sun: sunDir(150, 40), time: 36 },
  { name: 'globo', shape: 'globe', cam: new THREE.Vector3(70, 34, 78),
    target: new THREE.Vector3(0, 0, 0), sun: sunDir(15, 22), time: 41 },
  // Y EL GLOBO DE CERCA, que es la unica pose que ejecuta la rama esferica de
  // la siembra: la colocacion sobre la esfera, la convergencia de meridianos en
  // los discos y la vertical local. Sin ella ese codigo no lo prueba nadie.
  { name: 'globo-cerca', shape: 'globe', cam: globeEye.clone(), target: globeSurf.clone(),
    sun: globeUp.clone().addScaledVector(globeEast, 0.62).normalize(), time: 46 },
];
window.poseNames = POSES.map((p) => p.name);

const fwd = new THREE.Vector3();
let current = 0;
const poseInfo: Record<string, unknown>[] = [];

// El recorrido de la sonda: giro alrededor del objetivo y alejamiento. Los pone
// applyPose encima de la pose elegida para no duplicar todo el montaje.
let probeYaw = 0;
let probeDolly = 1;
/** Lo que costó el ULTIMO scatter.update, en ms. Es lo que mide la sonda. */
let lastScatterMs = 0;

const pTarget = new THREE.Vector3();
const pCam = new THREE.Vector3();

function applyPose(i: number, record = false): void {
  const p = POSES[i];
  pTarget.copy(p.target);
  pCam.copy(p.cam);
  if (probeYaw !== 0 || probeDolly !== 1) {
    // Girar y alejarse ALREDEDOR DEL OBJETIVO, que es lo que hacen los
    // OrbitControls de World3D con el botón izquierdo y la rueda.
    const d = pCam.clone().sub(pTarget).multiplyScalar(probeDolly);
    const c = Math.cos(probeYaw), s = Math.sin(probeYaw);
    pCam.set(pTarget.x + d.x * c - d.z * s, pTarget.y + d.y, pTarget.z + d.x * s + d.z * c);
  }
  camera.position.copy(pCam);
  camera.lookAt(pTarget);
  const dist = camera.position.distanceTo(pTarget);
  camera.near = Math.max(0.02, Math.min(dist * 0.01, 2));
  camera.far = Math.max(dist * 4 + SIZE_X * 1.5, SIZE_X * 3);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  surface.setShape(p.shape);
  surface.setSun(Math.atan2(p.sun.z, p.sun.x) * 180 / Math.PI,
    Math.asin(Math.max(-1, Math.min(1, p.sun.y))) * 180 / Math.PI);
  surface.setCamera(camera.position);
  const meshWindow = surface.setWindow(visibleWindow(camera, p.shape, gw, gh));
  water.plane.visible = p.shape === 'plane';
  water.globe.visible = p.shape === 'globe';

  // EXACTAMENTE lo que hace World3D: spanKm sale de la ventana de la MALLA, no
  // del encuadre. Con la cámara baja vale 40.075 — que es justo el número con
  // el que scatter.ts no puede fiarse, y por eso el banco se lo pasa tal cual.
  const spanKm = meshWindow.size * 40075;
  sky.update({ camera, sun: p.sun, shape: p.shape, spanKm });
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-9) fwd.set(0, 0, 1);
  const horizon = sky.horizonColor(fwd.normalize());
  const skyForWater = sky.waterSky();
  const light = sky.sunLight();
  surface.setSunLight(light.color, light.intensity, light.ambient);
  const camH = Math.max(0.05, Math.abs(camera.position.y));
  const fogDist = Math.min(6 * Math.max(camH, SIZE_X * 0.06), SIZE_X * 8);
  surface.setFog(horizon, skyForWater.horizonWarm, fogDist, p.shape === 'plane');

  water.update({
    camera, sun: p.sun, time: p.time, horizon,
    heightTex, gridW: gw, gridH: gh, yMul, seaLevel: 0, sky: skyForWater,
  });

  const tS = performance.now();
  scatter.update({
    camera, sun: p.sun, shape: p.shape, spanKm,
    window: meshWindow, time: p.time, horizon,
    sun3: light, horizonWarm: skyForWater.horizonWarm,
  });
  lastScatterMs = performance.now() - tS;

  if (record) {
    const s = scatter.stats();
    poseInfo.push({
      pose: p.name, spanKm: Math.round(spanKm),
      instancias: s.instances, especies: s.kinds, msSiembra: +s.ms.toFixed(2),
    });
  }
}

window.setPose = (i: number) => {
  current = i; soloOn = false; applyPose(i); renderer.render(scene, camera);
};

// SIN TERRENO. La pregunta que un fotograma normal no puede contestar es «¿esa
// zona no tiene plantas, o las tiene y el suelo las tapa?». Quitando el terreno
// y el agua, lo que queda en pantalla es exactamente lo que la siembra puso, y
// las dos cosas se distinguen de un vistazo. Fue lo que localizó el agujero de
// la vista cenital.
// EL INTERRUPTOR TIENE QUE VIVIR EN EL BUCLE, no en la llamada. La página sigue
// dibujando por requestAnimationFrame, y applyPose reenciende el terreno en
// cada vuelta: apagarlo aquí y renderizar una vez daba un fotograma correcto que
// el bucle machacaba antes de que Playwright llegara a la captura. Se pierde
// media hora buscando un fallo en la siembra que no existía.
let soloOn = false;
window.setSolo = (i: number, solo: boolean) => { current = i; soloOn = solo; };

// ---- medida ---------------------------------------------------------------
const gl = renderer.getContext();
const one = new Uint8Array(4);
function timeIt(frames: number): number {
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
  // DOS PASADAS EN VACIO ANTES DE MEDIR. La primera siembra de la sesion tarda
  // cincuenta milisegundos y las siguientes tres: lo que se estaba midiendo era
  // el compilador de V8 calentandose, no la siembra.
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < POSES.length; i++) applyPose(i);
  }
  for (let i = 0; i < POSES.length; i++) {
    // Se fuerza la re-siembra (el mundo "cambio") para medir el caso caro; en
    // uso normal la mayoria de fotogramas no siembra nada.
    scatter.setWorld({
      elevation: elev, biome, width: gw, height: gh, yMul, seaLevel: 0,
      temperature: temp, heightAt: (u, v) => surface.heightAtUV(u, v),
    });
    applyPose(i, true);
  }

  applyPose(0);
  renderer.render(scene, camera);
  const err0 = gl.getError();
  if (err0 !== 0) errors.push('glGetError ' + err0);

  // El mínimo de tres tandas: SwiftShader comparte hilos con el resto del
  // proceso y una sola medida varía un 5 %.
  current = 0;
  const bestOf = (fn: () => number): number => {
    let m = Infinity;
    for (let r = 0; r < 3; r++) m = Math.min(m, fn());
    return m;
  };
  surface.mesh.visible = true; water.plane.visible = false; sky.mesh.visible = false;
  scatter.group.visible = false;
  const soloTerreno = bestOf(() => timeIt(5));
  surface.mesh.visible = false; scatter.group.visible = true;
  const soloPlantas = bestOf(() => timeIt(5));
  surface.mesh.visible = true; sky.mesh.visible = true; water.plane.visible = true;
  const todo = bestOf(() => timeIt(5));

  // Y una comprobación de DETERMINISMO: sembrar, irse lejos, volver, y
  // comparar el fotograma píxel a píxel. Si el bosque no fuera determinista,
  // esto no puede coincidir.
  applyPose(0); renderer.render(scene, camera);
  const a = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a);
  applyPose(8); renderer.render(scene, camera);   // el mapa: cero instancias
  applyPose(4); renderer.render(scene, camera);   // media distancia
  applyPose(0); renderer.render(scene, camera);
  const b = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
  }

  // ---- LA SONDA DE RECORRIDO ----------------------------------------------
  //
  // La pregunta que decide si esto cabe en el presupuesto no es «cuánto cuesta
  // sembrar» —eso ya lo dice la tabla de poses— sino CADA CUÁNTO se siembra.
  // visibleWindow es continua: si la re-siembra se disparara con ella tal
  // cual, sembraría en todos y cada uno de los fotogramas de este recorrido, y
  // nueve milisegundos en todos los fotogramas es exactamente el motivo por el
  // que el renderer bajaría el pixelRatio.
  //
  // Se recorre lo que recorre un lector: 200 fotogramas girando un tercio de
  // vuelta alrededor del bosque mientras se aleja hasta cuatro veces la
  // distancia — o sea cruzando dos niveles enteros de rejilla.
  const paseo: number[] = [];
  for (let f = 0; f < 200; f++) {
    probeYaw = (f / 199) * (Math.PI * 2 / 3);
    probeDolly = 1 + (f / 199) * 3;
    applyPose(2);
    paseo.push(lastScatterMs);
  }
  probeYaw = 0; probeDolly = 1;
  const siembras = paseo.filter((m) => m > 1).length;
  const paseoMax = paseo.reduce((a, b) => Math.max(a, b), 0);
  const paseoMedia = paseo.reduce((a, b) => a + b, 0) / paseo.length;

  // ¿Cuánto de la pantalla ocupa la vegetación en la pose de bosque? Se compara
  // el fotograma con y sin plantas.
  applyPose(0); scatter.group.visible = false; renderer.render(scene, camera);
  const noVeg = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, noVeg);
  scatter.group.visible = true; applyPose(0); renderer.render(scene, camera);
  const veg = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, veg);
  let touched = 0;
  for (let i = 0; i < veg.length; i += 4) {
    if (Math.abs(veg[i] - noVeg[i]) + Math.abs(veg[i + 1] - noVeg[i + 1])
      + Math.abs(veg[i + 2] - noVeg[i + 2]) > 6) touched++;
  }

  window.scResult = JSON.stringify({
    ok: errors.length === 0,
    errors,
    bosque: [bx, by, +elev[by * gw + bx].toFixed(2), biome[by * gw + bx]],
    poses: poseInfo,
    ms: {
      soloTerreno: +soloTerreno.toFixed(1),
      soloPlantas: +soloPlantas.toFixed(1),
      todo: +todo.toFixed(1),
    },
    pixelesDistintosAlVolver: diff,
    porcentajePantallaConPlantas: +(100 * touched / (W * H)).toFixed(1),
    paseo: {
      fotogramas: paseo.length,
      fotogramasQueSiembran: siembras,
      msMax: +paseoMax.toFixed(1),
      msMedia: +paseoMedia.toFixed(2),
    },
  });
} catch (e) {
  window.scResult = JSON.stringify({ ok: false, errors: [String(e)] });
}

function loop(): void {
  applyPose(current);
  if (soloOn) {
    surface.mesh.visible = false;
    water.plane.visible = false;
    water.globe.visible = false;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
`;

await build({
  stdin: { contents: SRC, resolveDir: 'harness', loader: 'ts', sourcefile: 'scatter.ts' },
  bundle: true,
  outfile: 'harness/out/scatter.js',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});

const js = readFileSync('harness/out/scatter.js');
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
// PUERTO EFÍMERO. Con un puerto fijo, una ejecución anterior que siguiera viva
// —y ésta tarda varios minutos— tira la siguiente con EADDRINUSE antes de haber
// compilado nada.
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + String(e).slice(0, 500)));
page.on('console', (m) => {
  if (m.type() === 'error' || /shader|GLSL|WebGL/i.test(m.text())) logs.push(m.text().slice(0, 800));
});
// 'commit', no 'load': el guion bloquea el hilo principal varios minutos
// compilando shaders y midiendo sobre SwiftShader, y 'load' vence antes.
await page.goto(`http://localhost:${port}/`, { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => window.scResult !== undefined, { timeout: 420000 }).catch(() => {});
console.log('resultado:', await page.evaluate(() => window.scResult ?? 'sin resultado'));

const names = await page.evaluate(() => window.poseNames ?? []);
for (let i = 0; i < names.length; i++) {
  await page.evaluate((k) => window.setPose(k), i);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `harness/out/scatter/${i}-${names[i]}.png`, timeout: 120000 });
}
// Y las dos poses que costaron trabajo, también sin terreno: la cenital (6) y
// el globo de cerca (9).
for (const i of [6, 9]) {
  await page.evaluate((k) => window.setSolo(k, true), i);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `harness/out/scatter/${i}-${names[i]}-solo.png`, timeout: 120000 });
}
if (logs.length) console.log('mensajes:\n' + logs.join('\n'));
await browser.close();
server.close();
