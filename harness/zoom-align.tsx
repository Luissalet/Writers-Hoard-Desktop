// ¿CAE LA PINTURA DE LA VENTANA SOBRE EL MISMO SUELO QUE LA DEL MUNDO ENTERO?
//
// Esta es la pregunta que costó cuatro intentos revertidos. La respuesta no se
// puede sacar de una captura: un río desplazado media celda a vista de planeta
// son dos píxeles, y a vista de sierra son doscientos. Hace falta un NÚMERO.
//
// El truco: las dos texturas pintan LA MISMA FUNCIÓN DEL SUELO — una rampa
// lineal en las coordenadas del mundo. Si el mapeo de las dos es correcto, los
// dos fotogramas son idénticos píxel a píxel, pase lo que pase con la malla,
// la cámara o la forma. Y si no lo es, la diferencia de color ES el desfase,
// medido en las unidades de la rampa, que se convierten a celdas de mundo.
//
// La iluminación no estorba porque es AFÍN por píxel: out = K·col + A, con K y
// A constantes por píxel para una pose dada. Dos fotogramas de calibración
// (albedo negro y albedo blanco) los despejan, y a partir de ahí el color que
// se lee es el que salió de la textura, exacto.
import * as THREE from 'three';
import {
  SculptSurface, focusWindow, visibleWindow, type UVWindow,
} from '../src/engines/worldgen/sculpt/scene3d';
import { planZoomSkin, type ZoomSkinPlan } from '../src/engines/worldgen/cartography/zoomSkin';

declare global { interface Window { zoomAlign?: string } }

const VW = 480, VH = 360;
const GW = 64, GH = 32;          // un mundo diminuto: así media celda es enorme
const FADE = 0.06;

const canvas = document.createElement('canvas');
canvas.width = VW; canvas.height = VH;
document.body.appendChild(canvas);

// ---------------------------------------------------------------------------
// El mundo de prueba: LLANO Y TODO TIERRA, a propósito.
// ---------------------------------------------------------------------------
// Llano para que la iluminación sea la misma en todo el fotograma salvo por la
// perspectiva (que la calibración absorbe igual), y todo tierra para que el mar
// suave no se coma la rama que se está midiendo.
const height = new Float32Array(GW * GH).fill(0.9);
const biome = new Uint8Array(GW * GH).fill(6);
const palette: [number, number, number][] = [];
for (let i = 0; i < 48; i++) palette.push([0.4, 0.5, 0.35]);

function flat(r: number, g: number, b: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Una rampa lineal en coordenadas de MUNDO, muestreada en los centros de los
 * téxeles de una imagen que cubre `win`.
 *
 * R sube con u y G sube con v, las dos normalizadas al mismo rango de
 * referencia `ref`. Como es lineal, la interpolación bilineal la reproduce
 * exactamente sea cual sea la resolución: las dos texturas describen la misma
 * rampa aunque una tenga cien veces más téxeles que la otra.
 */
function rampTexture(
  win: { u: number; v: number; uSize: number; vSize: number },
  px: number, py: number,
  ref: { u: number; v: number; uSize: number; vSize: number },
): THREE.DataTexture {
  const data = new Uint8Array(px * py * 4);
  for (let y = 0; y < py; y++) {
    const v = win.v + ((y + 0.5) / py) * win.vSize;
    for (let x = 0; x < px; x++) {
      const u = win.u + ((x + 0.5) / px) * win.uSize;
      const o = (y * px + x) * 4;
      data[o] = Math.round(255 * Math.min(1, Math.max(0, (u - ref.u) / ref.uSize)));
      data[o + 1] = Math.round(255 * Math.min(1, Math.max(0, (v - ref.v) / ref.vSize)));
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, px, py);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;   // sin mipmaps: un mip promedia y miente
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

interface Case {
  name: string;
  shape: 'plane' | 'globe';
  /** Dónde poner la cámara: objetivo en uv y distancia relativa. */
  aim: { u: number; v: number; dist: number };
}

const CASES: Case[] = [
  { name: 'plano · medio', shape: 'plane', aim: { u: 0.5, v: 0.5, dist: 0.030 } },
  { name: 'plano · muy cerca', shape: 'plane', aim: { u: 0.31, v: 0.62, dist: 0.008 } },
  { name: 'plano · COSTURA', shape: 'plane', aim: { u: 0.998, v: 0.44, dist: 0.014 } },
  { name: 'plano · COSTURA cerca', shape: 'plane', aim: { u: 0.003, v: 0.55, dist: 0.006 } },
  { name: 'plano · junto al polo', shape: 'plane', aim: { u: 0.6, v: 0.03, dist: 0.012 } },
  { name: 'globo · medio', shape: 'globe', aim: { u: 0.5, v: 0.5, dist: 0.10 } },
  { name: 'globo · COSTURA', shape: 'globe', aim: { u: 0.002, v: 0.5, dist: 0.030 } },
  { name: 'globo · muy cerca', shape: 'globe', aim: { u: 0.72, v: 0.38, dist: 0.012 } },
  { name: 'globo · junto al polo', shape: 'globe', aim: { u: 0.4, v: 0.04, dist: 0.02 } },
];

const out: Record<string, unknown>[] = [];
const errors: string[] = [];

try {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(VW, VH);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;  // sin gamma de por medio
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, VW / VH, 0.02, 5000);

  const surface = new SculptSurface({ worldWidth: GW, worldHeight: GH, mesh: 512, palette });
  scene.add(surface.mesh);
  surface.uploadAll(height, biome);
  surface.setExaggeration(1);
  surface.setSun(300, 42);
  surface.setSubCellRelief(0);
  surface.setDetail(0);
  surface.setContour(0);
  surface.setShading(false, 0, false, 0);
  surface.setDetailPatch(null);
  surface.setDetailAlbedo(null);

  const gl = renderer.getContext();
  const buf = new Uint8Array(VW * VH * 4);
  const shot = (): Uint8Array => {
    renderer.render(scene, camera);
    gl.readPixels(0, 0, VW, VH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf.slice();
  };

  const black = flat(0, 0, 0);
  const white = flat(255, 255, 255);

  for (const c of CASES) {
    surface.setShape(c.shape);
    // La cámara: mirando de frente al punto pedido, a la distancia pedida.
    const sizeZ = 240 * (GH / GW);
    if (c.shape === 'plane') {
      const tx = (c.aim.u - 0.5) * 240, tz = (c.aim.v - 0.5) * sizeZ;
      camera.position.set(tx + 240 * c.aim.dist * 0.35, 240 * c.aim.dist, tz + 240 * c.aim.dist);
      camera.lookAt(tx, 0, tz);
    } else {
      const R = 240 / (2 * Math.PI);
      const lon = (c.aim.u - 0.5) * Math.PI * 2, lat = (0.5 - c.aim.v) * Math.PI;
      const d = R * (1 + c.aim.dist * 6);
      camera.position.set(
        d * Math.cos(lat) * Math.cos(lon), d * Math.sin(lat), d * Math.cos(lat) * Math.sin(lon),
      );
      camera.lookAt(0, 0, 0);
    }
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    surface.setCamera(camera.position);

    // LA VENTANA QUE SE USA ES LA QUE `setWindow` DEVUELVE, no la que se pide:
    // recorta v fuera de los polos y pone suelo al tamaño, y alinear contra la
    // petición en vez de contra el retorno es un desfase silencioso.
    const asked: UVWindow = visibleWindow(camera, c.shape, GW, GH);
    const got = surface.setWindow(asked);
    // La piel de cerca se planea sobre el ENCUADRE, no sobre la caja visible:
    // es lo que hace la vista, y la ventana del plan queda DENTRO de la de la
    // malla en vez de contenerla. La medida vale igual — sólo mira los píxeles
    // del interior del plan — y así prueba la disposición que se envía.
    const target = new THREE.Vector3();
    camera.getWorldDirection(target);
    target.multiplyScalar(
      c.shape === 'plane' ? camera.position.y / Math.max(1e-6, -target.y) : 0,
    ).add(camera.position);
    const focus = focusWindow(camera, c.shape === 'plane' ? target : new THREE.Vector3(),
      c.shape, GW, GH, got);

    const plan: ZoomSkinPlan | null = planZoomSkin({ width: GW, height: GH }, focus, {
      maxZ: 8,
    });
    if (!plan) { out.push({ caso: c.name, saltado: 'sin plan (ventana demasiado ancha)' }); continue; }

    // Referencia común de la rampa: la ventana del plan. Las dos texturas
    // pintan la MISMA función del suelo; sólo cambia dónde la muestrean.
    const ref = plan.window;
    const fullTex = rampTexture({ u: 0, v: 0, uSize: 1, vSize: 1 }, 2048, 1024, ref);
    const zoomTex = rampTexture(plan.window, plan.width, plan.height, ref);

    // --- calibración: out = K·col + A ---------------------------------------
    surface.setZoomSkin(null);
    surface.setAlbedo(black, true, false);
    const A = shot();
    surface.setAlbedo(white, true, false);
    const Wt = shot();

    // --- máscara del interior: donde el fundido está al máximo ---------------
    surface.setAlbedo(black, true, false);
    surface.setZoomSkin(white, plan.window, FADE);
    const maskShot = shot();

    // --- la rampa por las dos vías ------------------------------------------
    surface.setZoomSkin(null);
    surface.setAlbedo(fullTex, true, false);
    const full = shot();

    surface.setAlbedo(black, true, false);
    surface.setZoomSkin(zoomTex, plan.window, FADE);
    const zoom = shot();

    // --- cuentas -------------------------------------------------------------
    const cellsU = ref.uSize * GW;   // celdas de mundo que abarca la rampa en u
    const cellsV = ref.vSize * GH;
    let n = 0, sumU = 0, sumV = 0, maxU = 0, maxV = 0;
    for (let i = 0; i < VW * VH; i++) {
      const o = i * 4;
      const kR = Wt[o] - A[o], kG = Wt[o + 1] - A[o + 1];
      // Píxeles sin superficie (fondo) o con muy poca ganancia: no dicen nada.
      if (kR < 40 || kG < 40) continue;
      // Interior del fundido: la máscara tiene que estar casi saturada.
      if ((maskShot[o] - A[o]) < kR * 0.995) continue;
      const cf = (full[o] - A[o]) / kR, cz = (zoom[o] - A[o]) / kR;
      const gf = (full[o + 1] - A[o + 1]) / kG, gz = (zoom[o + 1] - A[o + 1]) / kG;
      // Los extremos de la rampa están recortados: allí un desfase no se ve.
      if (cf < 0.04 || cf > 0.96 || gf < 0.04 || gf > 0.96) continue;
      const du = Math.abs(cf - cz) * cellsU;
      const dv = Math.abs(gf - gz) * cellsV;
      sumU += du; sumV += dv;
      if (du > maxU) maxU = du;
      if (dv > maxV) maxV = dv;
      n++;
    }

    out.push({
      caso: c.name,
      ventanaPedida: +asked.size.toFixed(5),
      ventanaMalla: +got.size.toFixed(5),
      ventanaEncuadre: `${focus.uSize.toFixed(4)} x ${focus.vSize.toFixed(4)}`,
      z: plan.z,
      bloque: `${plan.nx}x${plan.ny}`,
      imagen: `${plan.width}x${plan.height}`,
      ventanaPlan: `u ${plan.window.u.toFixed(4)} +${plan.window.uSize.toFixed(4)}`
        + ` · v ${plan.window.v.toFixed(4)} +${plan.window.vSize.toFixed(4)}`,
      pixelesMedidos: n,
      desfaseMedioCeldas: n ? +(sumU / n).toFixed(4) : null,
      desfaseMaxCeldasU: n ? +maxU.toFixed(4) : null,
      desfaseMaxCeldasV: n ? +maxV.toFixed(4) : null,
      kmPorCelda: Math.round(40075 / GW),
    });

    fullTex.dispose();
    zoomTex.dispose();
  }

  const err = gl.getError();
  if (err !== 0) errors.push(`glGetError ${err}`);
  window.zoomAlign = JSON.stringify({ ok: errors.length === 0, errors, casos: out }, null, 1);
} catch (e) {
  window.zoomAlign = JSON.stringify({ ok: false, errors: [String(e)], casos: out }, null, 1);
}
