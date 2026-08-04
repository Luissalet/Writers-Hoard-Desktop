// ¿Mide el río lo mismo en el suelo, mire la cámara desde donde mire?
import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { drawWorldRivers } from '../src/engines/worldgen/region/satelliteTile';
import { kmPerWorldCell } from '../src/engines/worldgen/region/terrain';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';

const world = getWorld({ seed: 'monstruo', width: 1024 });
const kmCell = kmPerWorldCell(world);
// A point on the biggest river, so there is always a channel in frame.
const big = [...world.rivers].sort((a, b) => b.flow - a.flow)[0];
const mid = big.cells[Math.floor(big.cells.length * 0.75)];
const cx = mid % world.width, cy = (mid / world.width) | 0;
console.log(`río de flujo ${big.flow.toFixed(2)} en (${cx}, ${cy})`);

for (const spanCells of [1024, 128, 32, 8]) {
  const N = 512;
  const view = { x: cx - spanCells / 2, y: cy - spanCells / 2, w: spanCells, h: spanCells };
  const c = createCanvas(N, N);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, N, N);
  drawWorldRivers(world, ctx as unknown as Ctx, view, N, true);
  const px = ctx.getImageData(0, 0, N, N).data;
  // Widest run of river-blue on the row through the centre, in ground metres.
  let best = 0, run = 0;
  for (let y = N / 2 - 6; y <= N / 2 + 6; y++) {
    run = 0;
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const blue = px[i + 2] > 90 && px[i + 2] > px[i] + 20;
      if (blue) { run++; best = Math.max(best, run); } else run = 0;
    }
  }
  const kmPerPx = (spanCells * kmCell) / N;
  console.log(`ventana ${String(spanCells).padStart(4)} celdas (${(spanCells * kmCell).toFixed(0)} km) · `
    + `${kmPerPx.toFixed(2)} km/px · río dibujado ${best} px = ${(best * kmPerPx).toFixed(2)} km de ancho`);
}
