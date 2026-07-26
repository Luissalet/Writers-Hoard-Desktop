// Does the travel model give answers a person would recognise?
// The test is not "does it return a number" — it is whether the numbers move in
// the directions reality moves them: roads beat open country, winter costs more
// than summer except across a marsh, and a cart goes round what a walker
// crosses.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import {
  planRoute, describeDuration, travelTable, MODE_ES, SEASON_ES,
  type TravelMode, type Season,
} from '../src/engines/worldgen/core/travel';
import { renderCartography } from '../src/engines/worldgen/cartography/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';

GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');

const world = getWorld({ seed: 'monstruo', width: 1024 });
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
const byPop = [...geo.settlements].sort((a, b) => b.population - a.population);

// Two towns in the same realm, far enough apart to be a journey.
const a = byPop[0];
let b = byPop[1];
let bestGap = 0;
for (const s of byPop.slice(1, 25)) {
  let dx = Math.abs(s.x - a.x);
  if (dx > world.width / 2) dx = world.width - dx;
  const d = Math.hypot(dx, s.y - a.y);
  if (d > bestGap && d < world.width * 0.16) { bestGap = d; b = s; }
}
console.log(`de ${a.name} (${a.rank}) a ${b.name} (${b.rank})\n`);

const t0 = Date.now();
const table = travelTable(world, geo, a, b,
  ['foot', 'horse', 'cart'] as TravelMode[],
  ['summer', 'spring', 'winter'] as Season[]);
console.log(`${table.length} rutas en ${Date.now() - t0} ms\n`);

const HPD: Record<Season, number> = { spring: 10, summer: 11, autumn: 9, winter: 7 };
for (const { mode, season, route } of table) {
  if (route.impossible) {
    console.log(`${MODE_ES[mode].padEnd(10)} ${SEASON_ES[season].padEnd(10)} — ${route.impossible}`);
    continue;
  }
  console.log(
    `${MODE_ES[mode].padEnd(10)} ${SEASON_ES[season].padEnd(10)} `
    + `${route.km.toFixed(0).padStart(5)} km  ${describeDuration(route.hours, HPD[season]).padEnd(18)} `
    + `${Math.round(route.roadFraction * 100)}% calzada`,
  );
}

const ref = table.find((r) => r.mode === 'foot' && r.season === 'summer')!.route;
console.log(`\nen línea recta: ${ref.directKm.toFixed(0)} km · por el camino: ${ref.km.toFixed(0)} km `
  + `(rodeo ×${(ref.km / ref.directKm).toFixed(2)})`);
console.log(`terreno atravesado:`);
for (const l of ref.legs.slice(0, 7)) {
  console.log(`  ${l.terrain.padEnd(22)} ${l.km.toFixed(0).padStart(4)} km  ${l.hours.toFixed(1).padStart(5)} h`);
}
console.log(`${ref.crossings.length} pasos de río`);
console.log(`perfil: ${Math.round(ref.lowestM)} … ${Math.round(ref.highestM)} m · `
  + `${Math.round(ref.ascentM / 100) / 10} km de subida acumulada`);
console.log(`reinos atravesados: ${ref.realms.join(' → ') || '—'}`);
console.log(`\njornadas (${ref.stages.length}):`);
for (const st of ref.stages.slice(0, 6)) {
  console.log(`  noche ${String(st.night).padStart(2)}  ${st.km.toFixed(0).padStart(3)} km  `
    + `${st.rough ? 'al raso en' : 'en'} ${st.terrain}`
    + (st.nearest ? ` · ${st.nearest.name} a ${st.nearest.km.toFixed(0)} km` : ''));
}
if (ref.stages.length > 6) console.log(`  … y ${ref.stages.length - 6} más`);
const roughNights = ref.stages.filter((x) => x.rough).length;
console.log(`  ${roughNights}/${ref.stages.length} noches al raso`);

// Un viaje con escala intermedia.
{
  const midway = geo.settlements
    .filter((x) => x.id !== a.id && x.id !== b.id)
    .map((x) => {
      const d1 = Math.hypot(Math.min(Math.abs(x.x - a.x), world.width - Math.abs(x.x - a.x)), x.y - a.y);
      const d2 = Math.hypot(Math.min(Math.abs(x.x - b.x), world.width - Math.abs(x.x - b.x)), x.y - b.y);
      return { x, d: Math.abs(d1 - d2) + Math.max(d1, d2) * 0.25 };
    })
    .sort((p, q) => p.d - q.d)[0];
  if (midway) {
    const straight = planRoute(world, geo, a, b, { mode: 'foot', season: 'summer' });
    const viaR = planRoute(world, geo, a, b, { mode: 'foot', season: 'summer', via: [midway.x] });
    console.log(`\npasando por ${midway.x.name}: ${viaR.km.toFixed(0)} km frente a ${straight.km.toFixed(0)} km directos`
      + ` (${viaR.stages.length} jornadas frente a ${straight.stages.length})`);
    console.log(`${viaR.km >= straight.km - 1 ? '·' : '✗'} el rodeo por un punto intermedio nunca acorta`);
  }
}

// ---- the checks that would catch a wrong model ---------------------------
const get = (m: TravelMode, s: Season) => table.find((r) => r.mode === m && r.season === s)!.route;
const checks: [string, boolean][] = [
  ['a caballo es más rápido que a pie', get('horse', 'summer').hours < get('foot', 'summer').hours],
  ['el invierno cuesta más que el verano a pie', get('foot', 'winter').hours > get('foot', 'summer').hours],
  ['la primavera (barro) cuesta más que el verano', get('foot', 'spring').hours > get('foot', 'summer').hours],
  ['el carro usa más calzada que el caminante', get('cart', 'summer').roadFraction >= get('foot', 'summer').roadFraction],
  ['la ruta es más larga que la línea recta', ref.km > ref.directKm],
  // NO se comprueba un rodeo pequeño: la línea recta entre estas dos ciudades
  // cruza un golfo, así que rodearlo por tierra ES la respuesta correcta y un
  // límite de 2× solo mediría lo mucho que estorba el mar.
  ['a pie en verano da 25-50 km por jornada',
    ref.km / (ref.hours / 11) > 25 && ref.km / (ref.hours / 11) < 50],
];
console.log();
let bad = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '·' : '✗'} ${name}`);
  if (!ok) bad++;
}

// ---- draw it -------------------------------------------------------------
mkdirSync('harness/out', { recursive: true });
const OW = 1500, OH = 950;
let x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
if (x1 - x0 > world.width / 2) { const t = x0; x0 = x1; x1 = t + world.width; }
const pad = Math.max(18, (x1 - x0) * 0.22);
const view = {
  x: x0 - pad, y: Math.min(a.y, b.y) - pad,
  w: (x1 - x0) + pad * 2, h: 0,
};
view.h = view.w * (OH / OW);
view.y = (a.y + b.y) / 2 - view.h / 2;

const canvas = createCanvas(OW, OH);
const ctx = canvas.getContext('2d') as unknown as Ctx;
renderCartography(world, ctx, {
  theme: themeById('wonder'), width: OW, height: OH, view, geography: geo,
  density: 1, typeScale: 1,
});
const sx = OW / view.w, sy = OH / view.h;
const px = (i: number) => {
  let x = i % world.width;
  while (x < view.x) x += world.width;
  while (x > view.x + view.w) x -= world.width;
  return (x - view.x) * sx;
};
const py = (i: number) => (((i / world.width) | 0) - view.y) * sy;

const COL: Record<string, string> = { foot: '#b3261e', horse: '#1b5e20', cart: '#0d47a1' };
for (const mode of ['cart', 'horse', 'foot'] as TravelMode[]) {
  const r = get(mode, 'summer');
  if (!r.cells.length) continue;
  ctx.beginPath();
  ctx.moveTo(px(r.cells[0]), py(r.cells[0]));
  for (const c of r.cells) ctx.lineTo(px(c), py(c));
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.strokeStyle = COL[mode];
  ctx.lineWidth = 2.6;
  ctx.globalAlpha = 1;
  ctx.stroke();
}
ctx.font = '600 15px Lora';
let ly = 30;
for (const mode of ['foot', 'horse', 'cart'] as TravelMode[]) {
  const r = get(mode, 'summer');
  ctx.fillStyle = COL[mode];
  ctx.fillRect(18, ly - 10, 22, 4);
  ctx.fillStyle = '#241a0d';
  ctx.fillText(`${MODE_ES[mode]} · ${r.km.toFixed(0)} km · ${describeDuration(r.hours, 11)}`, 48, ly);
  ly += 24;
}
writeFileSync('harness/out/travel.png', canvas.toBuffer('image/png'));
console.log(`\nharness/out/travel.png escrito${bad ? ` · ${bad} comprobaciones fallidas` : ''}`);

// ---- a journey that has to leave the road --------------------------------
{
  const roadCells = new Set<number>();
  for (const r of geo.roads) for (const c of r.cells) roadCells.add(c);
  console.log(`\nla red de calzadas ocupa ${roadCells.size} celdas `
    + `(${((roadCells.size / (world.width * world.height)) * 100).toFixed(2)}% del mundo)`);
  const lonely = geo.settlements
    .map((s) => {
      let best = Infinity;
      for (const c of roadCells) {
        const x = c % world.width, y = (c / world.width) | 0;
        let dx = Math.abs(x - s.x); if (dx > world.width / 2) dx = world.width - dx;
        best = Math.min(best, Math.hypot(dx, y - s.y));
      }
      return { s, d: best };
    })
    .sort((x, y) => y.d - x.d)[0];
  if (lonely && lonely.d > 2) {
    const r = planRoute(world, geo, a, lonely.s, { mode: 'foot', season: 'summer' });
    console.log(`a pie hasta ${lonely.s.name} (a ${lonely.d.toFixed(0)} celdas de la calzada más próxima):`);
    console.log(`  ${r.km.toFixed(0)} km · ${describeDuration(r.hours, 11)} · `
      + `${Math.round(r.roadFraction * 100)}% calzada`);
    for (const l of r.legs.slice(0, 6)) {
      console.log(`    ${l.terrain.padEnd(22)} ${l.km.toFixed(0).padStart(4)} km`);
    }
  }
}

// A route no mode can make, to prove the failure path says something useful.
const inland = geo.settlements.find((s) => !s.port);
if (inland) {
  const r = planRoute(world, geo, a, inland, { mode: 'ship', season: 'summer' });
  console.log(`en barco hasta ${inland.name}: ${r.impossible ?? `${r.km.toFixed(0)} km`}`);
}
