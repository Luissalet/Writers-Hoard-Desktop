// ==========================================================================
// Sonda VISUAL del descenso — la ciudad, según baja la cámara
// ==========================================================================
// El banco `descent-3d.ts` dice que a 2 km de vano la piel entinta a 1,19
// m/px y que el umbral del plano de calles está en 5. Lo que no dice es si
// eso SE VE como una ciudad. Esta sonda dibuja el mismo pueblo con la MISMA
// rutina que usan las teselas (`drawTownPlans`) en los cinco peldaños de la
// escalera, incluido el que el 3D no alcanzaba.
//
//   npm i --no-save @napi-rs/canvas   (sólo en un contenedor nuevo)
//   npx tsx harness/descent-look.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '../src/engines/worldgen/core/types';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { drawTownPlans } from '../src/engines/worldgen/region/townPlan';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';

const world = generateWorld({ ...DEFAULT_PARAMS, width: 512, seed: 'descenso' });
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS, 'full', true);
const s = [...geo.settlements].sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
const metresPerWorldCell = 40075000 / world.width;

// Los cinco peldaños medidos en `descent-3d.ts`, de lo que se veía a lo que se
// ve. 9,55 es el techo VIEJO (la ventana uv clavada en 20 km).
const pasos = [
  { mpp: 9.55, nota: 'z14 · el techo VIEJO' },
  { mpp: 4.78, nota: 'z15 · vano 10 km' },
  { mpp: 2.39, nota: 'z16 · vano 4 km' },
  { mpp: 1.19, nota: 'z17 · vano 2 km — el suelo NUEVO' },
  { mpp: 0.60, nota: 'z18 · el fondo de la pirámide' },
];

const P = 400, PAD = 26;
const canvas = createCanvas(P * pasos.length + PAD * 2, P + PAD * 2);
const ctx = canvas.getContext('2d') as unknown as Ctx;
ctx.fillStyle = '#0b0e14';
ctx.fillRect(0, 0, canvas.width, canvas.height);

pasos.forEach((paso, i) => {
  const x0 = PAD + i * P;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, PAD, P - 4, P);
  ctx.clip();
  ctx.translate(x0, PAD);
  // Un suelo neutro: `drawTownPlans` dibuja SÓLO los objetos urbanos — el
  // terreno lo trae la tesela debajo, y aquí no toca.
  ctx.fillStyle = '#6b7a52';
  ctx.fillRect(0, 0, P, P);
  // El +0,5 es el CENTRO de la celda, y no es un detalle: `drawTownPlans`
  // sitúa el pueblo con `settlementCellCenter` (la misma regla que Map2D, los
  // caminos y la habitación regional). Sin él, esta sonda encuadraba media
  // celda al noroeste —a este zoom, treinta mil píxeles— y salían cinco
  // cuadros de hierba vacía. Es el mismo fallo que el motor documenta en
  // `townPlan.ts`: «a zoom de calle, un +0,5 que falta son miles de píxeles».
  const halfCells = (P / 2 * paso.mpp) / metresPerWorldCell;
  drawTownPlans(world, geo, ctx, {
    originWorldX: s.x + 0.5 - halfCells,
    originWorldY: s.y + 0.5 - halfCells,
    widthPx: P, heightPx: P,
    metresPerPx: paso.mpp,
    metresPerWorldCell,
  });
  ctx.restore();
  ctx.font = '600 12px sans-serif';
  ctx.fillStyle = '#ffd479';
  ctx.fillText(`${paso.mpp} m/px`, x0 + 4, PAD - 10);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '500 11px sans-serif';
  ctx.fillText(paso.nota, x0 + 74, PAD - 10);
  // La escala de cada panel, para poder medir con el ojo.
  const barM = paso.mpp * 100;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0 + 10, PAD + P - 14);
  ctx.lineTo(x0 + 110, PAD + P - 14);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillText(barM >= 1000 ? `${(barM / 1000).toFixed(1)} km` : `${Math.round(barM)} m`, x0 + 10, PAD + P - 20);
});
ctx.font = '600 13px sans-serif';
ctx.fillStyle = '#fff';
ctx.fillText(`${s.name} · ${s.rank} · ${s.population} hab · el mismo plano que enseña la ficha`, PAD, canvas.height - 8);

mkdirSync('harness/out', { recursive: true });
writeFileSync('harness/out/descent-look.png', canvas.toBuffer('image/png'));
console.log('harness/out/descent-look.png ·', s.name);
