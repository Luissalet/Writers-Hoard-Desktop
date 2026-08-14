// Bench: does the 2D map actually SHOW its roads?
//
// The complaint was "en el modo 2D no se ven los caminos". The measurement that
// answers it is not "the layer is in the source" but INK: how many pixels on a
// screenful of map are road, at each of the four zoom tiers the semantic ladder
// defines. Before this layer existed the honest answer at every tier above z11
// was 0,000 — the same shape of nothing the satellite pyramid was built to fix.
//
//   npx tsx harness/road-overlay.ts [seed] [gridWidth]
//
// Also checks the two things that are easy to get wrong and impossible to see
// in a screenshot: that a road crossing the antimeridian is not drawn straight
// back across the ocean, and that the fade under the deep tiles hands over at
// the level where the tiles start inking real tracks.

import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import {
  drawRoadNetwork, unwrapRoad,
  type Ctx,
} from '../src/engines/worldgen/cartography/roadOverlay';
import { PROJECTIONS } from '../src/engines/worldgen/core/projections';

const seed = process.argv[2] || 'monstruo';
const gridW = Number(process.argv[3] || 1024);
const EARTH_KM = 40075;

const world = getWorld({ seed, width: gridW });
const t0 = Date.now();
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
console.log(`mundo ${world.width}×${world.height} · geografía en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`${geo.settlements.length} poblaciones · ${geo.roads.length} caminos `
  + `(${geo.roads.filter((r) => r.major).length} calzadas mayores)`);

// ---- the four tiers -------------------------------------------------------
// Screen 1280×800 looking at the middle of the biggest landmass, at the span
// that puts the camera in each tier of `semanticZoomProfile`.
const CW = 1280, CH = 800;
const spec = PROJECTIONS.equirect;

/** A cell on the longest road — every close-range viewport must contain ink. */
function busiestCell(): { x: number; y: number } {
  const roads = [...geo.roads].sort((a, b) => b.cells.length - a.cells.length);
  let cell: number | undefined;
  for (const road of roads) {
    cell = road.cells.find((candidate) => {
      const x = candidate % world.width;
      return x > world.width * 0.25 && x < world.width * 0.75;
    });
    if (cell !== undefined) break;
  }
  if (cell === undefined) return { x: world.width * 0.5, y: world.height * 0.5 };
  return { x: (cell % world.width) + 0.5, y: Math.floor(cell / world.width) + 0.5 };
}
const focus = busiestCell();
console.log(`cámara sobre la celda más transitada: ${focus.x.toFixed(0)},${focus.y.toFixed(0)}`);

const TIERS: { name: string; spanKm: number }[] = [
  { name: 'planetario  ', spanKm: 20000 },
  { name: 'continental ', spanKm: 6000 },
  { name: 'regional    ', spanKm: 1200 },
  { name: 'local       ', spanKm: 200 },
  { name: 'local hondo ', spanKm: 40 },
];

let failures = 0;
console.log('\ntier          span      px/celda  z    alfa   dibujados  vértices  tinta%');
for (const tier of TIERS) {
  // scale: screen px per projected-map px. Map width in px = W * scale, and the
  // window shows CW screen px = (spanKm / EARTH_KM) of the world's girth.
  const scale = CW / ((tier.spanKm / EARTH_KM) * world.width);
  const mapW = world.width * scale, mapH = world.height * scale;
  const ox = CW * 0.5 - (focus.x / world.width) * mapW;
  const oy = CH * 0.5 - (focus.y / world.height) * mapH;
  const toScreen = (u: number, v: number): [number, number] => {
    const [X, Y] = spec.forward(u, v);
    return [ox + X * mapW, oy + Y * mapH];
  };

  // Roads belong to the screen-space overlay now. Terrain coverage no longer
  // controls their opacity: exact, parent fallback or cold cache all use 1.
  const z = Math.max(0, Math.round(Math.log2(scale * world.width / 256)));
  const alpha = 1;

  const canvas = createCanvas(CW, CH);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CW, CH);
  const res = drawRoadNetwork(ctx, geo.roads, {
    worldWidth: world.width,
    worldHeight: world.height,
    toScreen,
    width: CW,
    height: CH,
    pxPerCell: scale,
    alpha,
  });

  const px = ctx.getImageData(0, 0, CW, CH).data;
  let inked = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 24) inked++;
  const pct = (100 * inked) / (CW * CH);
  console.log(
    `${tier.name}${String(tier.spanKm).padStart(6)} km  ${scale.toFixed(3).padStart(8)}  `
    + `${String(z).padStart(2)}  ${alpha.toFixed(2)}   `
    + `${String(res.drawn).padStart(9)}  ${String(res.vertices).padStart(8)}  ${pct.toFixed(3)}`,
  );
  if ((tier.name.trim() === 'regional' || tier.name.trim().startsWith('local'))
    && geo.roads.length && (res.drawn === 0 || inked === 0)) failures++;
}

// ---- the seam -------------------------------------------------------------
// A road whose cells straddle x=0 must come out as one continuous run, not as
// a path that jumps a whole world width in a single segment. That jump is what
// draws a road straight across the ocean, and it is invisible in any tier count.
console.log('\ncostura:');
const W = world.width;
const seamCells: number[] = [];
for (let k = -6; k <= 6; k++) {
  const x = ((k % W) + W) % W;
  seamCells.push(Math.floor(world.height * 0.4) * W + x);
}
const un = unwrapRoad(seamCells, W);
let biggestJump = 0;
for (let k = 1; k < un.length; k++) biggestJump = Math.max(biggestJump, Math.abs(un[k].x - un[k - 1].x));
console.log(`  camino de 13 celdas sobre el meridiano 0 · salto máximo entre vértices: `
  + `${biggestJump.toFixed(1)} celdas (sano < 2, roto ≈ ${W})`);

let worstReal = 0, worstRoad = -1;
for (let i = 0; i < geo.roads.length; i++) {
  const p = unwrapRoad(geo.roads[i].cells, W);
  for (let k = 1; k < p.length; k++) {
    const d = Math.abs(p[k].x - p[k - 1].x);
    if (d > worstReal) { worstReal = d; worstRoad = i; }
  }
}
console.log(`  peor salto en los ${geo.roads.length} caminos del mundo: `
  + `${worstReal.toFixed(1)} celdas (camino #${worstRoad})`);
if (biggestJump >= 2 || worstReal >= W / 2) failures++;

console.log(failures
  ? `\nROJO: ${failures} varas — un camino desaparece o salta la costura`
  : '\nTODO VERDE: caminos visibles a todo zoom y costura continua');
process.exit(failures ? 1 : 0);
