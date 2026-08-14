// ¿Mide el río lo mismo en el suelo, mire la cámara desde donde mire?
import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import {
  drawWorldRivers, riverBankFactor, riverCrossesWorldSeam,
} from '../src/engines/worldgen/region/satelliteTile';
import {
  worldRiverMinimumPixels, worldRiverWidthMetres,
} from '../src/engines/worldgen/region/riverScale';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';

let failed = false;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failed = true;
};

const widths = [0, 0.25, 0.5, 0.75, 1].map(worldRiverWidthMetres);
check('anchura mundial plausible', widths[0] >= 15 && widths[4] <= 700,
  `${widths.map((v) => v.toFixed(0)).join('/')} m`);
check('anchura monótona y convexa', widths.every((v, i) => i === 0 || v > widths[i - 1])
  && widths[4] - widths[3] > widths[2] - widths[1], widths.join('/'));
check('jerarquía lejana sin inflar el suelo', worldRiverMinimumPixels(1) >= 2.2
  && worldRiverMinimumPixels(0.25) <= 1, `${worldRiverMinimumPixels(0.25)}…${worldRiverMinimumPixels(1)} px`);
check('la costura se detecta en celdas fuente', riverCrossesWorldSeam(1023, 0, 1024)
  && !riverCrossesWorldSeam(511, 512, 1024), '1023→0 debe cortar; 511→512 no');
const bank = Array.from({ length: 80 }, (_, i) => riverBankFactor(i * 90, 123456, 1));
check('la ribera es determinista e irregular', Math.max(...bank) - Math.min(...bank) >= 0.12
  && bank.every((v, i) => v === riverBankFactor(i * 90, 123456, 1)),
`${Math.min(...bank).toFixed(3)}…${Math.max(...bank).toFixed(3)}`);

const world = getWorld({ seed: 'monstruo', width: 1024 });
// A point on the biggest river, so there is always a channel in frame.
const big = [...world.rivers].sort((a, b) => b.flow - a.flow)[0];
const mid = big.cells[Math.floor(big.cells.length * 0.75)];
const cx = mid % world.width, cy = (mid / world.width) | 0;
console.log(`río de flujo ${big.flow.toFixed(2)} en (${cx}, ${cy})`);

const N = 512;
const canvas = createCanvas(N, N);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#000';
ctx.fillRect(0, 0, N, N);
drawWorldRivers(world, ctx as unknown as Ctx,
  { x: 0, y: 0, w: world.width, h: world.height }, N, false);
const pixels = ctx.getImageData(0, 0, N, N).data;
let longestHorizontal = 0, ink = 0;
for (let y = 0; y < N; y++) {
  let run = 0;
  for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const blue = pixels[i + 2] > 90 && pixels[i + 2] > pixels[i] + 20;
    if (blue) { ink++; run++; longestHorizontal = Math.max(longestHorizontal, run); }
    else run = 0;
  }
}
check('el atlas contiene ríos', ink > 100, `${ink} px`);
check('ninguna costura forma una línea planetaria', longestHorizontal < N * 0.25,
  `tirada horizontal ${longestHorizontal}/${N}px`);

if (failed) process.exitCode = 1;
