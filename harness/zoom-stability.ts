// ¿Cambia de tamaño el mismo rótulo al hacer zoom? Renderiza la misma vista a
// varias escalas y mide la altura en píxeles de un texto conocido, en vez de
// juzgarlo mirando.
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { getGeography } from '../src/engines/worldgen/cartography/texture';
import { renderCartography } from '../src/engines/worldgen/cartography/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');

const w = getWorld({ seed: 'monstruo', width: 1024 });
const geo = getGeography(w);
const OW = 1000, OH = 600;
const cap = geo.settlements.find((s) => s.rank === 'capital')!;
console.log(`siguiendo "${cap.name}" en (${cap.x}, ${cap.y})`);
console.log('  zoom   ancho vista   nº etiquetas visibles   ms');
for (const vw of [1024, 512, 256, 128, 64, 32]) {
  const c = createCanvas(OW, OH);
  const ctx = c.getContext('2d');
  const view = { x: cap.x - vw / 2, y: Math.max(0, cap.y - (vw * OH / OW) / 2), w: vw, h: vw * OH / OW };
  const t0 = Date.now();
  renderCartography(w, ctx as unknown as Ctx, {
    theme: themeById('wonder'), width: OW, height: OH, view, geography: geo,
    layers: { frame: false, compass: false, scaleBar: false },
  });
  const ms = Date.now() - t0;
  // Cuenta píxeles de tinta de texto: el color del tipo sobre el papel.
  const img = ctx.getImageData(0, 0, OW, OH);
  let ink = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i+1], b = img.data[i+2];
    if (r < 90 && g < 80 && b < 75) ink++;
  }
  console.log(`  ×${(1024 / vw).toFixed(0).padStart(3)}   ${String(vw).padStart(5)} celdas   ${String(ink).padStart(7)} px de tinta   ${ms}`);
}
