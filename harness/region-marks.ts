// ============================================
// Banco: la marca de comarca guardada (annotations.ts)
// ============================================
// Dibuja la capa de anotaciones con tres comarcas (activa, quieta, diminuta)
// sobre un lienzo llano y comprueba TINTA, no recuentos (lección #26/#31):
//   · el lavado interior existe (el centro del recuadro no es fondo puro)
//   · el marco y los soportes de esquina pintan (tinta en el borde)
//   · la cartela del título pinta encima
//   · la diminuta pinta su rombo
// Y deja el PNG en harness/out/region-marks.png para MIRARLO.

import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { drawAnnotations } from '../src/engines/worldgen/cartography/annotations';
import { getWorld } from './world-cache';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${name} — ${detail}`);
  if (!ok) failures++;
};

const world = getWorld({ seed: 'moved-roads', width: 512, height: 256 });
const CW = 900, CH = 520;
const canvas = createCanvas(CW, CH);
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
const BG = { r: 240, g: 232, b: 214 }; // papel llano
ctx.fillStyle = `rgb(${BG.r},${BG.g},${BG.b})`;
ctx.fillRect(0, 0, CW, CH);

// Proyección: el mundo entero en el lienzo (k px por celda).
const k = CW / world.width;
const sx = (wx: number) => wx * k;
const sy = (wy: number) => wy * (CH / world.height);

// Tres comarcas: activa grande, quieta mediana, y una diminuta.
const regions = [
  { x: 150, y: 90, spanKm: 8000, aspect: 1.55, title: 'Valle de Prueba', active: true },
  { x: 360, y: 160, spanKm: 5200, aspect: 1.2, title: 'La Quieta', active: false },
  { x: 460, y: 40, spanKm: 300, aspect: 1.55, title: 'Diminuta', active: false },
];
drawAnnotations(ctx, { regions }, world, sx, sy, k);

const img = (ctx as unknown as { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } })
  .getImageData(0, 0, CW, CH).data;
const inkAt = (px: number, py: number): number => {
  const i = (Math.round(py) * CW + Math.round(px)) * 4;
  return Math.abs(img[i] - BG.r) + Math.abs(img[i + 1] - BG.g) + Math.abs(img[i + 2] - BG.b);
};
const inkNear = (px: number, py: number, r = 3): number => {
  let best = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) best = Math.max(best, inkAt(px + dx, py + dy));
  return best;
};

const rg = regions[0];
const halfW = ((rg.spanKm / 40075) * world.width * k) / 2;
const halfH = (halfW / rg.aspect) * ((CH / world.height) / k);
const cx = sx(rg.x), cy = sy(rg.y);

check('lavado interior (activa)', inkAt(cx + halfW * 0.5, cy + halfH * 0.5) > 0.9,
  `tinta ${inkAt(cx + halfW * 0.5, cy + halfH * 0.5).toFixed(1)} en el interior`);
check('marco (borde este)', inkNear(cx + halfW, cy) > 20,
  `tinta ${inkNear(cx + halfW, cy).toFixed(0)} sobre el borde`);
check('soporte de esquina NO', inkNear(cx - halfW, cy - halfH, 2) > 30,
  `tinta ${inkNear(cx - halfW, cy - halfH, 2).toFixed(0)} en la esquina`);
check('cartela del título', inkNear(cx, cy - halfH - 8, 6) > 10,
  `tinta ${inkNear(cx, cy - halfH - 8, 6).toFixed(0)} sobre el marco`);
const d = regions[2];
check('rombo de la diminuta', inkNear(sx(d.x), sy(d.y), 6) > 20,
  `tinta ${inkNear(sx(d.x), sy(d.y), 6).toFixed(0)}`);
check('la quieta también pinta', inkNear(sx(regions[1].x) + ((regions[1].spanKm / 40075) * world.width * k) / 2, sy(regions[1].y)) > 12,
  'marco de la no activa');

mkdirSync('harness/out', { recursive: true });
writeFileSync('harness/out/region-marks.png', canvas.toBuffer('image/png'));
console.log('PNG: harness/out/region-marks.png');
console.log(failures ? `\n${failures} EN ROJO` : '\nTODO EN VERDE');
if (failures) process.exit(1);
