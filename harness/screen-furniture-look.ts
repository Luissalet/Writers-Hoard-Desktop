// ==========================================================================
// Sonda VISUAL del mobiliario de pantalla — la escala, la aguja y la diana
// ==========================================================================
// Los números del banco (`screen-navigation.ts`) dicen que la barra elige 100
// km y que el norte cae hacia arriba. No dicen si la chapa tapa el mapa, si la
// aguja se entiende del revés o si la diana se confunde con una chincheta —
// que es de lo que va este dibujo. La lección del proyecto es esa: MIRAR el
// resultado, no sólo medirlo (`city-look.ts` enseñó en una imagen lo que 61
// comprobaciones verdes no decían).
//
//   npm i --no-save @napi-rs/canvas   (sólo en un contenedor nuevo)
//   npx tsx harness/screen-furniture-look.ts
//
// Dibuja las tres piezas sobre cuatro fondos que son los que de verdad hay
// debajo en la aplicación: mar, nieve, desierto y bosque. Un HUD que sólo se
// prueba sobre gris oscuro se vuelve invisible sobre la primera playa.

import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import {
  drawArrivalMark, drawScreenCompass, drawScreenScaleBar, northOnScreen,
} from '../src/engines/worldgen/cartography/screenFurniture';

const W = 1120, H = 560;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

// Los cuatro suelos, en franjas: mar, nieve, desierto, bosque.
const suelos = ['#1d3f63', '#e8eef2', '#cbb27a', '#3d5a34'];
for (let i = 0; i < 4; i++) {
  ctx.fillStyle = suelos[i];
  ctx.fillRect(0, (H / 4) * i, W, H / 4);
}
// Un poco de ruido para que no sea un plano de color: lo de debajo siempre
// tiene textura, y una chapa que se lee sobre color plano puede no leerse aquí.
for (let i = 0; i < 9000; i++) {
  const x = Math.random() * W, y = Math.random() * H;
  ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.16})`;
  ctx.fillRect(x, y, 2, 2);
}

// ---- la barra de escala, a cinco escalas del zoom --------------------------
const escalas = [0.004, 0.05, 0.4, 3.2];   // km por píxel
escalas.forEach((kmPerPx, i) => {
  drawScreenScaleBar(ctx, {
    kmPerPx,
    align: i % 2 ? 'right' : 'left',
    edge: i % 2 ? 560 : 24,
    bottom: (H / 4) * i + 52,
    format: (km) => (km >= 1
      ? `${km >= 1000 ? Math.round(km) : km} km`
      : `${Math.round(km * 1000)} m`),
  });
});

// ---- la aguja, girando, y una en cada franja --------------------------------
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  const n = northOnScreen(Math.sin(a), -Math.cos(a));
  if (!n) continue;
  drawScreenCompass(ctx, {
    x: 70 + (i % 4) * 74,
    y: (H / 4) * Math.floor(i / 4) * 2 + 110,
    r: 13,
    northX: n.x, northY: n.y, letter: 'N',
  });
}
for (let i = 0; i < 4; i++) {
  const n = northOnScreen(0.4, -0.9)!;
  drawScreenCompass(ctx, {
    x: 400, y: (H / 4) * i + 62, r: 13, northX: n.x, northY: n.y, letter: 'N',
  });
}

// ---- la diana, sobre los cuatro suelos y al lado de sus vecinas -------------
// La cuarta franja lleva la diana de la CARTA, que dibuja en píxeles de
// dispositivo y por eso pide el factor: si el factor no estuviera, en una
// pantalla HiDPI se vería a la mitad de tamaño que en las otras dos vistas.
for (let i = 0; i < 4; i++) {
  const y = (H / 4) * i + H / 8 + 60;
  drawArrivalMark(ctx, 700, y, '#ffd479', i === 3 ? 2 : 1);
  // Al lado, las dos marcas de las que TIENE que distinguirse.
  ctx.beginPath();                                   // una chincheta del lector
  ctx.moveTo(760, y); ctx.lineTo(755, y - 13); ctx.lineTo(765, y - 13);
  ctx.closePath();
  ctx.fillStyle = '#4ea3d8';
  ctx.fill();
  ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(6,8,13,0.9)'; ctx.stroke();
  ctx.beginPath();                                   // una capital
  ctx.arc(820, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd479'; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(6,8,13,0.92)'; ctx.stroke();
  ctx.beginPath();
  ctx.arc(820, y, 8, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,212,121,0.75)'; ctx.lineWidth = 1.2; ctx.stroke();
  // Y el rótulo que la diana lleva pegado, como en la vista.
  ctx.font = '600 12px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(6,8,13,0.85)';
  ctx.strokeText('Río Sombrío', 700 + 17.5, y);
  ctx.fillStyle = '#ffd479';
  ctx.fillText('Río Sombrío', 700 + 17.5, y);
}

ctx.font = '600 11px sans-serif';
ctx.fillStyle = 'rgba(255,255,255,0.75)';
ctx.fillText('escala · 4 m/px → 3,2 km/px, una por franja', 24, 22);
ctx.fillText('aguja · ocho rumbos, y una en cada suelo', 24, 96);
ctx.fillText('diana + chincheta + capital · la última, al doble (la carta)', 620, 22);

mkdirSync('harness/out', { recursive: true });
writeFileSync('harness/out/screen-furniture.png', canvas.toBuffer('image/png'));
console.log('harness/out/screen-furniture.png');
