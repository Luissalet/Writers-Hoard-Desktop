// La otra mitad: el bloque de teselas, sobre el relieve de verdad, mirado por
// una cámara de verdad. Dos fotogramas desde la misma pose — con la piel de
// mundo entero y con la de cerca encima — y la energía de detalle de cada uno.
//
// Una captura sola no demuestra nada (una imagen borrosa y otra menos borrosa
// se parecen en miniatura). La ENERGÍA DE DETALLE sí: es la media de |laplaciano|
// sobre el fotograma, o sea cuánta estructura por píxel hay realmente ahí. Es la
// misma medida que dio 0,000 cuando el 2D ampliaba el ráster del mundo.
import * as THREE from 'three';
import { SculptSurface, visibleWindow } from '../src/engines/worldgen/sculpt/scene3d';
import { BIOME_COLORS } from '../src/engines/worldgen/core/render';

declare global { interface Window { zoomSkinResult?: string } }

const VW = 900, VH = 620;

async function main() {
  const meta = await (await fetch('/plan.json')).json();
  const W = meta.world.width, H = meta.world.height;
  const elev = new Float32Array(await (await fetch('/elev.bin')).arrayBuffer());
  const biome = new Uint8Array(await (await fetch('/biome.bin')).arrayBuffer());
  const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
  const baseImg = await loadImg('/base.png');
  const blockImg = await loadImg('/block.png');

  const canvas = document.createElement('canvas');
  canvas.width = VW; canvas.height = VH;
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(VW, VH);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e14);
  const camera = new THREE.PerspectiveCamera(45, VW / VH, 0.05, 5000);

  const palette: [number, number, number][] = [];
  for (let i = 0; i < 48; i++) {
    const c = BIOME_COLORS[i] ?? [128, 128, 128];
    palette.push([c[0] / 255, c[1] / 255, c[2] / 255]);
  }
  const surface = new SculptSurface({ worldWidth: W, worldHeight: H, mesh: 1024, palette });
  scene.add(surface.mesh);
  surface.uploadAll(elev, biome);
  surface.setShape('plane');
  surface.setExaggeration(28);
  surface.setSun(300, 38);
  surface.setShading(false, 0.5, false, 0.6);
  surface.setDetail(0.6);
  surface.setSubCellRelief(0);

  const texOf = (img: HTMLImageElement, wrapX: boolean) => {
    const t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.wrapS = wrapX ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    t.needsUpdate = true;
    return t;
  };
  surface.setAlbedo(texOf(baseImg, true), true, true);

  // La cámara viene del fichero: es la misma pose con la que se planeó el
  // bloque, no una parecida.
  const cp = meta.camera.position, ct = meta.camera.target;
  camera.position.set(cp[0], cp[1], cp[2]);
  camera.lookAt(ct[0], ct[1], ct[2]);
  camera.updateMatrixWorld(true);
  surface.setCamera(camera.position);
  const got = surface.setWindow(visibleWindow(camera, 'plane', W, H));

  const gl = renderer.getContext();
  const buf = new Uint8Array(VW * VH * 4);
  const shot = () => {
    renderer.render(scene, camera);
    gl.readPixels(0, 0, VW, VH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf.slice();
  };
  const show = (px: Uint8Array, id: string) => {
    const c = document.createElement('canvas');
    c.width = VW; c.height = VH;
    const img = c.getContext('2d')!.createImageData(VW, VH);
    // readPixels da la imagen del revés respecto al lienzo 2D.
    for (let y = 0; y < VH; y++) {
      const s = (VH - 1 - y) * VW * 4;
      img.data.set(px.subarray(s, s + VW * 4), y * VW * 4);
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
    c.id = id;
    document.body.appendChild(c);
  };

  /** Media de |laplaciano| de la luminancia, sólo donde hay superficie. */
  const energy = (px: Uint8Array, mask?: Uint8Array) => {
    let sum = 0, n = 0;
    const lum = (i: number) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    for (let y = 2; y < VH - 2; y++) {
      for (let x = 2; x < VW - 2; x++) {
        const i = (y * VW + x) * 4;
        if (mask && !mask[y * VW + x]) continue;
        // El fondo de la escena no cuenta.
        if (px[i] < 18 && px[i + 1] < 20 && px[i + 2] < 26) continue;
        const l = 4 * lum(i) - lum(i - 4) - lum(i + 4) - lum(i - VW * 4) - lum(i + VW * 4);
        sum += Math.abs(l);
        n++;
      }
    }
    return { energia: n ? +(sum / n).toFixed(3) : 0, pixeles: n };
  };

  surface.setZoomSkin(null);
  const antes = shot();
  show(antes, 'antes');

  const block = texOf(blockImg, false);
  surface.setZoomSkin(block, meta.plan.window, 0.06);
  const ahora = shot();
  show(ahora, 'ahora');

  // DÓNDE se aplica la piel de cerca: un pase con la de cerca en blanco y la de
  // abajo en negro. Medir la nitidez sobre TODA la pantalla mezcla el suelo que
  // se está mirando con el horizonte, que sigue siendo el de siempre a
  // propósito, y sale un número diluido que no dice nada de ninguno de los dos.
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.colorSpace = THREE.NoColorSpace;
  white.needsUpdate = true;
  const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blackTex.colorSpace = THREE.NoColorSpace;
  blackTex.needsUpdate = true;
  surface.setAlbedo(blackTex, true, false);
  surface.setZoomSkin(white, meta.plan.window, 0.06);
  const maskShot = shot();
  const mask = new Uint8Array(VW * VH);
  let covered = 0;
  for (let i = 0; i < VW * VH; i++) {
    const on = maskShot[i * 4] > 200 && maskShot[i * 4 + 1] > 200;
    mask[i] = on ? 1 : 0;
    if (on) covered++;
  }

  let changed = 0, lit = 0;
  for (let i = 0; i < antes.length; i += 4) {
    if (!mask[i >> 2]) continue;
    if (antes[i] + antes[i + 1] + antes[i + 2] > 60) lit++;
    if (Math.abs(antes[i] - ahora[i]) > 4) changed++;
  }

  const eA = energy(antes, mask), eB = energy(ahora, mask);
  window.zoomSkinResult = JSON.stringify({
    ok: true,
    mundo: `${W}x${H}`,
    kmPorCelda: +meta.kmPerCell.toFixed(1),
    encuadreKm: meta.spanKm,
    ventanaMalla: +got.size.toFixed(5),
    ventanaEncuadre: `${meta.focus.uSize.toFixed(4)} x ${meta.focus.vSize.toFixed(4)}`,
    pantallaConPielDeCerca: +(100 * covered / (VW * VH)).toFixed(1) + ' %',
    plan: `z${meta.plan.z} · ${meta.plan.nx}x${meta.plan.ny} teselas · ${meta.plan.width}x${meta.plan.height} px`,
    metrosPorPixel: { pielDeCerca: meta.metrosPorPixelBloque, mundoEntero: meta.metrosPorPixelMundo },
    energiaAntes: eA.energia,
    energiaAhora: eB.energia,
    ganancia: eA.energia ? +(eB.energia / eA.energia).toFixed(2) : null,
    pixelesCambiados: lit ? +(100 * changed / lit).toFixed(1) : 0,
  }, null, 1);
}

main().catch((e) => {
  window.zoomSkinResult = JSON.stringify({ ok: false, error: String(e) });
});
