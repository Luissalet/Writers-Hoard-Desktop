// Antes y ahora, mismo suelo, mismo encuadre.
//
// The complaint was "I zoom in and the deepest level is this pixelated shit".
// This renders what the 2D used to show and what it shows now, at four spans
// from a province to a street, through the same camera arithmetic the app uses.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { renderBase, renderAtlasWindow } from '../src/engines/worldgen/core/render';
import { makeCanonCache, CANON_CACHE_CAP, CANON_CACHE_BYTES } from '../src/engines/worldgen/region/deepTile';
import {
  MAX_SAT_TILE_Z, SAT_DEEP_Z, renderSatelliteDeepTile, renderSatelliteShallowTile,
  satelliteDeepSupported,
} from '../src/engines/worldgen/region/satelliteTile';
import { TILE_PX, levelFor, tilesInView, tileCountX } from '../src/engines/worldgen/cartography/tiles';
import { kmPerWorldCell } from '../src/engines/worldgen/region/terrain';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';

const OUT = 'harness/out/sat';
mkdirSync(OUT, { recursive: true });
const world = getWorld({ seed: 'monstruo', width: 1024 });
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
const unshaded = renderBase(world, 'atlas', { shade: false });
const kmCell = kmPerWorldCell(world);
const cache = makeCanonCache();
const limits = { cap: CANON_CACHE_CAP, bytes: CANON_CACHE_BYTES };

const W = 880, H = 470;
const s = [...geo.settlements].sort((a, b) => b.population - a.population)[2];
const SPANS = [600, 90, 12, 1.6]; // km across the window

const sheet = createCanvas(W * 2 + 24, (H + 34) * SPANS.length + 10);
const sc = sheet.getContext('2d');
sc.fillStyle = '#0b0b10';
sc.fillRect(0, 0, sheet.width, sheet.height);

SPANS.forEach((spanKm, row) => {
  const cellsAcross = spanKm / kmCell;
  const pxPerCell = W / cellsAcross;            // exactly the app's `scale`
  const view = {
    x: s.x - cellsAcross / 2,
    y: s.y - (H / pxPerCell) / 2,
    w: cellsAcross,
    h: H / pxPerCell,
  };
  const y0 = row * (H + 34) + 28;

  // ANTES: the world raster, sampled per screen pixel. This is the best the
  // old 2D could ever do — and past its own zoom ceiling it could not even
  // get here, because `scale` was clamped at 28.
  const before = createCanvas(W, H);
  const bctx = before.getContext('2d');
  const buf = new Uint8ClampedArray(W * H * 4);
  renderAtlasWindow(world, unshaded, buf, W, H, view);
  const img = bctx.createImageData(W, H);
  img.data.set(buf);
  bctx.putImageData(img, 0, 0);

  // AHORA: the pyramid, at the level the app would pick for this camera.
  const z = levelFor(world, pxPerCell, MAX_SAT_TILE_Z);
  const after = createCanvas(W, H);
  const actx = after.getContext('2d');
  const cells = world.width / tileCountX(z);
  const t0 = Date.now();
  for (const key of tilesInView(world, z, view)) {
    const c = createCanvas(TILE_PX, TILE_PX);
    const cx = c.getContext('2d') as unknown as Ctx;
    if (z >= SAT_DEEP_Z && satelliteDeepSupported(world, z)) {
      renderSatelliteDeepTile(world, geo, cache, cx, key, { layers: {}, density: 1 }, limits);
    } else {
      renderSatelliteShallowTile(world, unshaded, cx, key);
    }
    let gx = key.tx * cells;
    while (gx - view.x > world.width / 2) gx -= world.width;
    while (gx - view.x < -world.width / 2) gx += world.width;
    const sx = (gx - view.x) * pxPerCell;
    const sy = (key.ty * cells - view.y) * pxPerCell;
    const sw = cells * pxPerCell;
    actx.drawImage(c, sx, sy, sw + 0.5, sw + 0.5);
  }
  const ms = Date.now() - t0;

  sc.drawImage(before, 0, y0);
  sc.drawImage(after, W + 24, y0);
  sc.fillStyle = '#e8e5e0';
  sc.font = '600 15px sans-serif';
  const label = spanKm >= 10 ? `${spanKm} km de ancho` : `${spanKm * 1000} m de ancho`;
  const mpp = (spanKm * 1000) / W;
  sc.fillText(`${label} · ${mpp < 1 ? (mpp * 100).toFixed(0) + ' cm/px' : mpp.toFixed(1) + ' m/px'}`, 2, y0 - 9);
  sc.fillStyle = '#9a948a';
  sc.font = '500 13px sans-serif';
  sc.fillText('ANTES · ráster del mundo ampliado', 250, y0 - 9);
  sc.fillText(`AHORA · pirámide z${z}`, W + 24 + 250, y0 - 9);
  console.log(`${label}: z${z} · ${pxPerCell.toFixed(1)} px por celda de mundo · ${ms} ms`);
});

writeFileSync(`${OUT}/antes-y-ahora.png`, sheet.toBuffer('image/png'));
console.log('escrito antes-y-ahora.png');
