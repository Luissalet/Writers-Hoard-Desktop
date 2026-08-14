// Every renderer transition must preserve the same visible coastline.
import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { renderBase } from '../src/engines/worldgen/core/render';
import { makeCanonCache } from '../src/engines/worldgen/region/deepTile';
import { renderSatelliteDeepTile, renderSatelliteShallowTile } from '../src/engines/worldgen/region/satelliteTile';
import { TILE_PX, tileCountX, type TileKey } from '../src/engines/worldgen/cartography/tiles';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';

const world = getWorld({ seed: 'banco-tinta', width: 256 });
const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS, 'places');
const unshaded = renderBase(world, 'atlas', { shade: false });

function pixels(size: number, draw: (ctx: Ctx) => void): Uint8Array {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  draw(ctx);
  return new Uint8Array((ctx as unknown as CanvasRenderingContext2D)
    .getImageData(0, 0, size, size).data);
}

const looksWater = (p: Uint8Array, i: number) => {
  const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2];
  return b > g + 8 && b > r + 20;
};

function rawWaterMask(p: Uint8Array): Uint8Array {
  const out = new Uint8Array(p.length / 4);
  for (let i = 0; i < out.length; i++) if (looksWater(p, i)) out[i] = 1;
  return out;
}

/** Keep water connected to a border where the parent also says ocean.
 * Canon-only lakes are legitimate added detail; they are not a moving coast. */
function oceanComponent(p: Uint8Array, size: number, parent?: Uint8Array): Uint8Array {
  const raw = rawWaterMask(p);
  const out = new Uint8Array(raw.length);
  const queue = new Int32Array(raw.length);
  let head = 0, tail = 0;
  const parentSize = parent ? Math.round(Math.sqrt(parent.length)) : 0;
  const seed = (x: number, y: number) => {
    const i = y * size + x;
    if (!raw[i] || out[i]) return;
    if (parent) {
      const px = Math.min(parentSize - 1, Math.floor(x * parentSize / size));
      const py = Math.min(parentSize - 1, Math.floor(y * parentSize / size));
      if (!parent[py * parentSize + px]) return;
    }
    out[i] = 1; queue[tail++] = i;
  };
  for (let x = 0; x < size; x++) { seed(x, 0); seed(x, size - 1); }
  for (let y = 0; y < size; y++) { seed(0, y); seed(size - 1, y); }
  while (head < tail) {
    const i = queue[head++], x = i % size, y = (i / size) | 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      const ni = ny * size + nx;
      if (!raw[ni] || out[ni]) continue;
      out[ni] = 1; queue[tail++] = ni;
    }
  }
  return out;
}

function compare(parent: Uint8Array, children: Uint8Array, scale = 2) {
  const parentSize = Math.round(Math.sqrt(parent.length));
  const childSize = parentSize * scale;
  let intersection = 0, union = 0, mismatches = 0;
  for (let y = 0; y < parentSize; y++) for (let x = 0; x < parentSize; x++) {
    const a = parent[y * parentSize + x] !== 0;
    let votes = 0;
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
      votes += children[(y * scale + sy) * childSize + x * scale + sx];
    }
    const b = votes >= Math.ceil(scale * scale / 2);
    if (a && b) intersection++;
    if (a || b) union++;
    if (a !== b) mismatches++;
  }
  return {
    iou: intersection / Math.max(1, union),
    mismatch: mismatches / (parentSize * parentSize),
  };
}

function mixedTile(z: number): TileKey {
  const cells = world.width / tileCountX(z);
  for (let y = 1; y < world.height - 1; y++) for (let x = 0; x < world.width; x++) {
    const i = y * world.width + x;
    const right = y * world.width + ((x + 1) % world.width);
    if ((world.elevation[i] > 0) === (world.elevation[right] > 0)) continue;
    const key = { z, tx: Math.floor((x + 0.5) / cells), ty: Math.floor(y / cells) };
    const p = pixels(TILE_PX, (ctx) => renderSatelliteShallowTile(world, unshaded, ctx, key, { rivers: false }));
    const f = rawWaterMask(p).reduce((n, v) => n + v, 0) / (TILE_PX * TILE_PX);
    if (f > 0.08 && f < 0.92) return key;
  }
  throw new Error(`No mixed coastal z${z} tile found.`);
}

function shallowMosaic(parent: TileKey): Uint8Array {
  return pixels(TILE_PX * 2, (ctx) => {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const child = createCanvas(TILE_PX, TILE_PX);
      renderSatelliteShallowTile(world, unshaded, child.getContext('2d') as unknown as Ctx, {
        z: parent.z + 1, tx: parent.tx * 2 + dx, ty: parent.ty * 2 + dy,
      }, { rivers: false });
      (ctx as unknown as CanvasRenderingContext2D).drawImage(child, dx * TILE_PX, dy * TILE_PX);
    }
  });
}

const farKey = mixedTile(5);
const farPixels = pixels(TILE_PX, (ctx) => renderSatelliteShallowTile(world, unshaded, ctx, farKey, { rivers: false }));
const farMask = oceanComponent(farPixels, TILE_PX);
const shallowChildren = shallowMosaic(farKey);
const shallowMask = oceanComponent(shallowChildren, TILE_PX * 2, farMask);
const farResult = compare(farMask, shallowMask);
console.log(`atlas z5→satélite z6 · IoU ${(farResult.iou * 100).toFixed(1)} % · desacuerdo ${(farResult.mismatch * 100).toFixed(2)} %`);

const deepKey = mixedTile(8);
const handoffPixels = pixels(TILE_PX, (ctx) => renderSatelliteShallowTile(world, unshaded, ctx, deepKey, { rivers: false }));
const handoffMask = oceanComponent(handoffPixels, TILE_PX);
const cache = makeCanonCache();
const deepPixels = pixels(TILE_PX * 2, (ctx) => {
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const child = createCanvas(TILE_PX, TILE_PX);
    renderSatelliteDeepTile(world, geography, cache, child.getContext('2d') as unknown as Ctx, {
      z: 9, tx: deepKey.tx * 2 + dx, ty: deepKey.ty * 2 + dy,
    }, { layers: { roads: false, fields: false, rivers: false }, density: 0 },
    { cap: 12, bytes: 512 * 1024 * 1024 });
    (ctx as unknown as CanvasRenderingContext2D).drawImage(child, dx * TILE_PX, dy * TILE_PX);
  }
});
const deepMask = oceanComponent(deepPixels, TILE_PX * 2, handoffMask);
const deepResult = compare(handoffMask, deepMask);
console.log(`satélite z8→canon z9 · IoU ${(deepResult.iou * 100).toFixed(1)} % · desacuerdo ${(deepResult.mismatch * 100).toFixed(2)} %`);

if (farResult.iou < 0.94 || farResult.mismatch > 0.025
  || deepResult.iou < 0.94 || deepResult.mismatch > 0.025) process.exit(1);
