// La mitad de CPU de la piel de cerca del 3D: monta el bloque de teselas de
// verdad, con el pintor de verdad, y deja en disco todo lo que la otra mitad
// —la que enciende WebGL— necesita para dibujarlo sobre el relieve.
//
// Aquí no hay nada inventado para la prueba: `planZoomSkin` es el que usa la
// vista y `renderSatelliteShallowTile` es el que usa el 2D.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { renderBase, renderComposite } from '../src/engines/worldgen/core/render';
import { renderSatelliteShallowTile } from '../src/engines/worldgen/region/satelliteTile';
import { planZoomSkin } from '../src/engines/worldgen/cartography/zoomSkin';
import * as THREE from 'three';
import { focusWindow, visibleWindow, SIZE_X } from '../src/engines/worldgen/sculpt/scene3d';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
import { TILE_PX } from '../src/engines/worldgen/cartography/tiles';

const OUT = 'harness/out/zoom3d';
mkdirSync(OUT, { recursive: true });

const WIDTH = Number(process.argv[2] || 1024);
const SPAN_KM = Number(process.argv[3] || 1200);
const MAXZ = Number(process.argv[4] || 8);
const world = getWorld({ seed: 'monstruo', width: WIDTH });
const kmPerCell = 40075 / world.width;

// Un punto de tierra con río cerca: es lo que el lector dijo que se veía mal.
let best = -1, bx = 0, by = 0;
const near = new Set<number>();
for (const r of world.rivers) {
  const cells = new Uint32Array(r.cells);
  for (let i = 0; i < cells.length; i++) near.add(cells[i]);
}
for (const i of near) {
  const x = i % world.width, y = (i / world.width) | 0;
  if (y < world.height * 0.2 || y > world.height * 0.8) continue;
  const score = world.elevation[i];
  if (score > best) { best = score; bx = x; by = y; }
}

// LA CÁMARA SE DECIDE AQUÍ, no en el navegador, y viaja en el fichero.
//
// Así el bloque de teselas se planea con la MISMA `focusWindow` que usa la
// vista, sobre la MISMA pose. Duplicar la fórmula del encuadre en las dos
// mitades del banco es cómo se acaba midiendo una cosa y dibujando otra.
const VW = 900, VH = 620;
const sizeZ = SIZE_X * (world.height / world.width);
const tx = ((bx + 0.5) / world.width - 0.5) * SIZE_X;
const tz = ((by + 0.5) / world.height - 0.5) * sizeZ;
const span = (SPAN_KM / 40075) * SIZE_X;
const camera = new THREE.PerspectiveCamera(45, VW / VH, 0.05, 5000);
const target = new THREE.Vector3(tx, 0, tz);
camera.position.set(tx + span * 0.32, span * 0.62, tz + span * 0.95);
camera.lookAt(target);
camera.updateMatrixWorld(true);

const visible = visibleWindow(camera, 'plane', world.width, world.height);
const focus = focusWindow(camera, target, 'plane', world.width, world.height, visible);

const plan = planZoomSkin(world, focus, { maxZ: MAXZ });
if (!plan) throw new Error('sin plan');

const unshaded = renderBase(world, 'atlas', { shade: false });

const block = createCanvas(plan.width, plan.height);
const bctx = block.getContext('2d');
const t0 = Date.now();
plan.keys.forEach((key, i) => {
  const col = i % plan.nx, row = (i / plan.nx) | 0;
  const tile = createCanvas(TILE_PX, TILE_PX);
  renderSatelliteShallowTile(world, unshaded, tile.getContext('2d') as unknown as Ctx, key,
    { rivers: true });
  bctx.drawImage(tile, col * TILE_PX, row * TILE_PX);
});
const tileMs = Date.now() - t0;

// La piel de mundo entero, exactamente como la monta World3D.
const rgba = renderComposite(world, 'atlas', true, { shade: false });
const base = createCanvas(world.width, world.height);
const bimg = base.getContext('2d').createImageData(world.width, world.height);
bimg.data.set(rgba);
base.getContext('2d').putImageData(bimg, 0, 0);

writeFileSync(`${OUT}/block.png`, block.toBuffer('image/png'));
writeFileSync(`${OUT}/base.png`, base.toBuffer('image/png'));
writeFileSync(`${OUT}/elev.bin`, Buffer.from(world.elevation.buffer, world.elevation.byteOffset,
  world.elevation.byteLength));
writeFileSync(`${OUT}/biome.bin`, Buffer.from(world.biome.buffer, world.biome.byteOffset,
  world.biome.byteLength));
writeFileSync(`${OUT}/plan.json`, JSON.stringify({
  world: { width: world.width, height: world.height },
  kmPerCell,
  spanKm: SPAN_KM,
  camera: { position: camera.position.toArray(), target: target.toArray(), fov: 45, vw: VW, vh: VH },
  visible,
  focus,
  plan,
  metrosPorPixelBloque: Math.round((plan.view.w * kmPerCell * 1000) / plan.width),
  metrosPorPixelMundo: Math.round(kmPerCell * 1000),
}, null, 1));

console.log(`mundo ${world.width}x${world.height} · ${kmPerCell.toFixed(0)} km/celda`);
console.log(`caja visible ${visible.size.toFixed(4)} · encuadre `
  + `${focus.uSize.toFixed(4)} x ${focus.vSize.toFixed(4)}`);
console.log(`ventana pedida ${SPAN_KM} km → z${plan.z}, bloque ${plan.nx}x${plan.ny}`
  + ` = ${plan.width}x${plan.height} px, ${plan.keys.length} teselas en ${tileMs} ms`);
console.log(`resolución de la piel: ${Math.round((plan.view.w * kmPerCell * 1000) / plan.width)}`
  + ` m/px  (la de mundo entero: ${Math.round(kmPerCell * 1000)} m/px)`);
console.log(`mejora: ${((kmPerCell * 1000) / ((plan.view.w * kmPerCell * 1000) / plan.width)).toFixed(1)}x`);
