// Mirar las ciudades del mundo REAL, no un caso cómodo de laboratorio.
// Hoja de contacto + números de la decisión de emplazamiento.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { getGeography, cityParamsFor } from '../src/engines/worldgen/cartography/texture';
import { generateCity, type CityPlan, type CityParams } from '../src/engines/worldgen/city/generate';
import { renderCity } from '../src/engines/worldgen/city/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
import type { V } from '../src/engines/worldgen/city/geometry';

try {
  GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');
} catch { /* la fuente es cosmética aquí */ }

const SEED = process.env.SEMILLA ?? undefined;
const world = getWorld(SEED ? { seed: SEED } : {});
const geo = await getGeography(world, 'full');
const settlements = [...geo.settlements].sort((a, b) => b.population - a.population);

interface Row { name: string; rank: string; params: CityParams; plan: CityPlan | null; }
const rows: Row[] = [];
for (const s of settlements) {
  const params = cityParamsFor(world, s, geo);
  let plan: CityPlan | null = null;
  try { plan = generateCity(params); } catch (e) { console.error(`  !! ${s.name}: ${(e as Error).message}`); }
  rows.push({ name: s.name, rank: s.rank, params, plan });
}

const num = (n: number) => n.toFixed(1).padStart(7);
console.log('nombre           rango    R0    río(u)  río/R0  modo      |centro|  |c|/R0  radio  edif  puentes  muelles  caminos');
for (const r of rows) {
  const R0 = 10 + r.params.size * 2.5;
  const rw = r.params.riverCourse?.width ?? 0;
  const uc = r.params.urbanCenter ?? { x: 0, y: 0 };
  const off = Math.hypot(uc.x, uc.y);
  const b = r.plan ? r.plan.patches.reduce((a, q) => a + q.buildings.length, 0) : 0;
  console.log(
    `${r.name.padEnd(16)} ${r.rank.padEnd(8)}${num(R0)}${num(rw)}${num(rw / R0)}  ${(r.params.riverMode ?? '-').padEnd(9)}`
    + `${num(off)}${num(off / R0)}${num(r.plan?.radius ?? 0)}${String(b).padStart(6)}`
    + `${String(r.plan?.bridges.length ?? 0).padStart(9)}${String(r.plan?.piers.length ?? 0).padStart(9)}`
    + `${String(r.params.roadBearings?.length ?? 0).padStart(9)}`,
  );
}

// ---------------------------------------------------------------------------
// Hoja de contacto
// ---------------------------------------------------------------------------
mkdirSync('harness/out/city', { recursive: true });
const theme = themeById('wonder') ?? themeById('default')!;
const S = 460;
const pick = rows.filter((r) => r.plan).slice(0, 12);
const COLS = 4, ROWS = Math.ceil(pick.length / COLS);
const sheet = createCanvas(S * COLS, S * ROWS);
const sc = sheet.getContext('2d');
sc.fillStyle = '#14120e'; sc.fillRect(0, 0, sheet.width, sheet.height);

for (const [k, r] of pick.entries()) {
  const plan = r.plan!;
  const cell = createCanvas(S, S);
  const cx = cell.getContext('2d');
  renderCity(plan, cx as unknown as Ctx, { theme, width: S, height: S });

  // Superponer el CONTEXTO tal como se lo dimos: cauce medido y litoral.
  const margin = 0.35;
  const extent = plan.radius * (1 + margin) * 2;
  const s = Math.min(S, S) / extent;
  const ox = S / 2 - plan.center.x * s, oy = S / 2 - plan.center.y * s;
  const P = (v: V) => ({ x: ox + v.x * s, y: oy + v.y * s });
  cx.lineWidth = 2;
  if (r.params.riverCourse) {
    cx.strokeStyle = 'rgba(20,120,220,0.75)';
    cx.lineWidth = Math.max(1, r.params.riverCourse.width * s);
    cx.beginPath();
    r.params.riverCourse.line.forEach((v, i) => { const p = P(v); i ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y); });
    cx.stroke();
  }
  if (r.params.shoreLine) {
    cx.strokeStyle = 'rgba(220,40,40,0.8)'; cx.lineWidth = 2;
    cx.beginPath();
    r.params.shoreLine.forEach((v, i) => { const p = P(v); i ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y); });
    cx.stroke();
  }
  // el ancla del atlas (0,0) y el centro urbano elegido
  const a = P({ x: 0, y: 0 });
  cx.strokeStyle = '#00ff88'; cx.lineWidth = 2;
  cx.beginPath(); cx.moveTo(a.x - 8, a.y); cx.lineTo(a.x + 8, a.y); cx.moveTo(a.x, a.y - 8); cx.lineTo(a.x, a.y + 8); cx.stroke();
  const uc = r.params.urbanCenter ?? { x: 0, y: 0 };
  const u = P(uc);
  cx.strokeStyle = '#ffcc00';
  cx.beginPath(); cx.arc(u.x, u.y, 7, 0, Math.PI * 2); cx.stroke();

  cx.fillStyle = 'rgba(0,0,0,0.65)'; cx.fillRect(0, 0, S, 22);
  cx.fillStyle = '#fff'; cx.font = '13px sans-serif';
  const rw = r.params.riverCourse?.width ?? 0;
  const R0 = 10 + r.params.size * 2.5;
  cx.fillText(
    `${r.name} · ${r.rank} · ${r.params.riverMode ?? '-'} · río ${rw.toFixed(0)}u (${(rw / R0).toFixed(2)}R0) · pts ${plan.bridges.length}`,
    6, 15,
  );
  sc.drawImage(cell, (k % COLS) * S, Math.floor(k / COLS) * S);
}
const out = process.env.SALIDA ?? 'harness/out/city/look.png';
writeFileSync(out, sheet.toBuffer('image/png'));
console.log(`\n→ ${out}`);
