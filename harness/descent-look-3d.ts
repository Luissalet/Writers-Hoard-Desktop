// ==========================================================================
// Sonda VISUAL del descenso 3D — el marco local, en Chromium de verdad
// ==========================================================================
// `descent-precision` mide la aritmética con `Math.fround`. Esto la ejecuta
// donde vive: el shader REAL de `SculptSurface`, compilado por un WebGL2 de
// verdad (swiftshader), sobre la malla real, con una piel de cerca que tiene
// detalle de un píxel — que es lo único que enseña bandas.
//
// El «ANTES» no se simula: se parchean en el material LAS DOS LÍNEAS que
// cambiaron —la posición del vértice y la resta del fragmento— por lo que
// decían antes, y se devuelve la malla al origen. Misma escena, mismo mundo,
// misma cámara, mismos téxeles: lo único distinto es la cuenta.
//
// La ejecuta `descent-look-3d-run.mjs`; aquí sólo se cuelga `window.__banco`.

import * as THREE from 'three';
import { SculptSurface, SIZE_X } from '../src/engines/worldgen/sculpt/scene3d';
import { EARTH_KM } from '../src/engines/worldgen/core/camera';

const W = 256, H = 128;
const ANCHO = 460, ALTO = 320;

/** La piel de cerca: un plano de calles de mentira, pero con la geometría que
 *  importa — manzanas, calles de un píxel y una diagonal. Una mancha de color
 *  plano no habría enseñado ninguna banda, que es como se pasa por alto esto. */
function pielDeCalles(px: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = px; c.height = px;
  const g = c.getContext('2d')!;
  g.fillStyle = '#cdbfa6'; g.fillRect(0, 0, px, px);
  const paso = px / 24;
  g.fillStyle = '#8d7f68';
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      if ((i * 7 + j * 3) % 5 === 0) continue;
      g.fillRect(i * paso + 1.5, j * paso + 1.5, paso - 3, paso - 3);
    }
  }
  g.strokeStyle = '#f2ead8'; g.lineWidth = 1;
  for (let i = 0; i <= 24; i++) {
    g.beginPath(); g.moveTo(Math.round(i * paso) + 0.5, 0);
    g.lineTo(Math.round(i * paso) + 0.5, px); g.stroke();
    g.beginPath(); g.moveTo(0, Math.round(i * paso) + 0.5);
    g.lineTo(px, Math.round(i * paso) + 0.5); g.stroke();
  }
  g.strokeStyle = '#e8dcc0'; g.lineWidth = Math.max(2, px / 90);
  g.beginPath(); g.moveTo(0, px * 0.86); g.lineTo(px, px * 0.12); g.stroke();
  g.strokeStyle = '#6f6552'; g.lineWidth = Math.max(2, px / 110);
  g.beginPath(); g.arc(px * 0.5, px * 0.5, px * 0.17, 0, Math.PI * 2); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

interface Banco {
  listo: boolean;
  cuadro(spanKm: number, legado: boolean): string;
}

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(ANCHO, ALTO);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1b1b1b');
const camera = new THREE.PerspectiveCamera(45, ANCHO / ALTO, 1e-6, 4000);

const palette: [number, number, number][] = Array.from({ length: 48 }, (_, i) => [
  0.32 + (i % 7) * 0.03, 0.42 + (i % 5) * 0.03, 0.26 + (i % 3) * 0.04,
]);
const surface = new SculptSurface({ worldWidth: W, worldHeight: H, mesh: 192, palette });
surface.setShape('plane');
// Un terreno con pendiente suave y ondulación de escala de mundo: nada de
// relieve inventado (doctrina «CERCA = LISO»), que es lo que hay al fondo del
// descenso de verdad.
const elev = new Float32Array(W * H);
const bio = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    elev[y * W + x] = 0.35 + 0.22 * Math.sin(x / 9) + 0.14 * Math.cos(y / 7);
    bio[y * W + x] = 12 + ((x + y) % 5);
  }
}
surface.uploadAll(elev, bio);
surface.setSun(38, 46);
scene.add(surface.mesh);

const piel = pielDeCalles(1024);
const U0 = 0.5, V0 = 0.5;

const mat = surface.mesh.material as THREE.ShaderMaterial;
const VERT_NUEVO = mat.vertexShader;
const FRAG_NUEVO = mat.fragmentShader;

/** Las DOS líneas de antes, textualmente. Si alguna deja de casar, el banco lo
 *  dice en vez de enseñar dos cuadros idénticos y llamarlo victoria. */
const PARCHE_VERT: [string, string] = [
  `  vec3 p = uShape < 0.5
    ? vec3(d.x * uSizeX, e * uYMul, d.y * uSizeZ)
    : placeAt(w, e);`,
  `  vec3 p = placeAt(w, e);`,
];
const PARCHE_FRAG: [string, string] = [
  `    vec2 zl = vec2((uZoomRel.x + vLocal.x) / max(1e-9, uZoomSize.x),
                   (uZoomRel.y + vLocal.y) / max(1e-9, uZoomSize.y));`,
  `    float zx = vUV.x - uZoomMin.x;
    zx -= round(zx);
    vec2 zl = vec2(zx / max(1e-7, uZoomSize.x),
                   (vUV.y - uZoomMin.y) / max(1e-7, uZoomSize.y));`,
];

function aplicar(legado: boolean): void {
  if (!legado) {
    mat.vertexShader = VERT_NUEVO;
    mat.fragmentShader = FRAG_NUEVO;
  } else {
    if (!VERT_NUEVO.includes(PARCHE_VERT[0]) || !FRAG_NUEVO.includes(PARCHE_FRAG[0])) {
      throw new Error('el parche del ANTES ya no casa con el shader — la sonda mentiría');
    }
    mat.vertexShader = VERT_NUEVO.replace(PARCHE_VERT[0], PARCHE_VERT[1]);
    mat.fragmentShader = FRAG_NUEVO.replace(PARCHE_FRAG[0], PARCHE_FRAG[1]);
  }
  mat.needsUpdate = true;
}

const banco: Banco = {
  listo: true,
  cuadro(spanKm: number, legado: boolean): string {
    const size = spanKm / EARTH_KM;
    surface.setWindow({ u: U0, v: V0, size });
    surface.setZoomSkin(piel, { u: U0 - size / 2, v: V0 - size / 2, uSize: size, vSize: size }, 0.02);
    aplicar(legado);
    if (legado) {
      // El ANTES también devuelve la malla al origen: el pivote es la otra
      // mitad del cambio, y dejarlo puesto habría enseñado un «antes» ya medio
      // curado — la trampa clásica de los antes/después.
      surface.mesh.position.set(0, 0, 0);
      (mat.uniforms.uPivot.value as THREE.Vector3).set(0, 0, 0);
    }
    const sizeZ = SIZE_X * (H / W);
    const cx = (U0 - 0.5) * SIZE_X;
    const cz = (V0 - 0.5) * sizeZ;
    const cy = surface.heightAtUV(U0, V0) * surface.yMul;
    const vano = size * SIZE_X;
    const dist = vano / (2 * Math.tan((camera.fov * Math.PI) / 360));
    // Una inclinación moderada: en picado absoluto esto no parece 3D, y a ras
    // el plano de calles no se lee. 22° de la vertical enseña las dos cosas.
    const t = (22 * Math.PI) / 180;
    camera.position.set(cx + Math.sin(t) * dist * 0.0, cy + Math.cos(t) * dist, cz + Math.sin(t) * dist);
    camera.up.set(0, 0, -1);
    camera.lookAt(cx, cy, cz);
    camera.near = Math.max(1e-7, dist / 5000);
    camera.far = dist * 40;
    camera.updateProjectionMatrix();
    surface.setCamera(camera.position);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  },
};

(window as unknown as { __banco: Banco }).__banco = banco;
