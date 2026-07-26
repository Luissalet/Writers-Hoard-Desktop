// Does the regional sheet actually look like a regional sheet?
// Counts prove nothing here — the whole point is the picture, so this renders
// several windows over different country and writes them out to be looked at.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { generateRegion } from '../src/engines/worldgen/region/generate';
import { renderRegion } from '../src/engines/worldgen/region/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';
import { Cover, COVER_LABEL_ES } from '../src/engines/worldgen/region/types';

GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');

const world = getWorld({ seed: 'monstruo', width: 1024 });
console.log(`mundo ${world.width}×${world.height}`);
const t0 = Date.now();
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
console.log(`geografía humana en ${Date.now() - t0} ms · ${geo.settlements.length} asentamientos`);

mkdirSync('harness/out', { recursive: true });

// Pick windows centred on real settlements, which is where a reader would zoom.
const byRank = [...geo.settlements].sort((a, b) => b.population - a.population);
const targets = [
  { s: byRank[0], span: 120, tag: 'capital' },
  { s: byRank[3], span: 120, tag: 'ciudad' },
  { s: byRank[12], span: 60, tag: 'cerca' },
  { s: byRank[30], span: 200, tag: 'lejos' },
].filter((t) => t.s);

for (const { s, span, tag } of targets) {
  const t1 = Date.now();
  const region = generateRegion(world, geo, { cx: s.x, cy: s.y, spanKm: span });
  const genMs = Date.now() - t1;

  const counts = new Map<string, number>();
  for (const p of region.places) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
  // Stats over the VISIBLE sheet only — the margin is scaffolding.
  const coverCounts = new Map<number, number>();
  let total = 0;
  for (let y = region.margin; y < region.height - region.margin; y++) {
    for (let x = region.margin; x < region.width - region.margin; x++) {
      const c = region.cover[y * region.width + x];
      coverCounts.set(c, (coverCounts.get(c) ?? 0) + 1);
      total++;
    }
  }
  const topCover = [...coverCounts].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, v]) => `${COVER_LABEL_ES[k]} ${Math.round((v / total) * 100)}%`).join(' · ');

  console.log(`\n── ${tag}: ${region.title} (${span} km) — ${genMs} ms`);
  console.log(`   ${region.subtitle}`);
  console.log(`   suelo: ${topCover}`);
  console.log(`   lugares: ${[...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`   ${region.streams.length} cursos (${region.streams.filter((x) => x.trunk).length} troncales), `
    + `${region.tracks.length} caminos, ${region.fields.length} parcelas, ${region.hedges.length} cercas`);
  const named = region.streams.filter((x) => x.name).map((x) => x.name);
  if (named.length) console.log(`   ríos con nombre: ${[...new Set(named)].join(', ')}`);

  const OW = 1600, OH = Math.round(OW / region.params.aspect);
  const canvas = createCanvas(OW, OH);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  const t2 = Date.now();
  renderRegion(region, ctx, { theme: themeById('wonder'), width: OW, height: OH });
  console.log(`   render ${Date.now() - t2} ms`);
  writeFileSync(`harness/out/region-${tag}.png`, canvas.toBuffer('image/png'));
}

// Determinism: the same window twice must be identical, and a window shifted by
// a fraction of a cell must not move the villages.
const s = byRank[0];
const a = generateRegion(world, geo, { cx: s.x, cy: s.y, spanKm: 120 });
const b = generateRegion(world, geo, { cx: s.x, cy: s.y, spanKm: 120 });
let same = true;
for (let i = 0; i < a.elevation.length; i++) if (a.elevation[i] !== b.elevation[i]) { same = false; break; }
console.log(`\ndeterminismo exacto: ${same ? 'sí' : 'NO'}`);

// Sólo cuentan las aldeas que siguen dentro de la ventana desplazada: las que
// se salen de la página no se han perdido, es que ya no se ven.
for (const dcx of [0.06, 0.2, 0.7]) {
  const shift = generateRegion(world, geo, { cx: s.x + dcx, cy: s.y, spanKm: 120 });
  const shiftCells = dcx / a.worldPerCellX;
  const inBoth = (p: { x: number; y: number }) => {
    const x = p.x - shiftCells, y = p.y;
    return x > a.margin && x < a.width - a.margin && y > a.margin && y < a.height - a.margin;
  };
  const nameSet = (r: typeof a, filter = false) => new Set(
    r.places.filter((p) => (p.kind === 'village' || p.kind === 'hamlet') && (!filter || inBoth(p)))
      .map((p) => p.name));
  const A = nameSet(a, true), B = nameSet(shift);
  let shared = 0;
  for (const n of A) if (B.has(n)) shared++;
  const km = Math.round(dcx * (40030 / world.width));
  console.log(`desplazando ${String(km).padStart(3)} km: ${String(shared).padStart(3)}/${String(A.size).padEnd(3)} `
    + `aldeas del solape conservan nombre (${A.size ? Math.round((shared / A.size) * 100) : 0} %)`);
}
void Cover;
