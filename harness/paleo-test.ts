// Does the glacial-maximum view show a world you'd recognise as the same one?
// The numbers to trust are the land fraction and the land bridges; the picture
// is what says whether it is worth having.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { paleoMap, describePaleo, nameBridges, seaLevelForIce, type PaleoState } from '../src/engines/worldgen/core/paleo';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { renderCartography } from '../src/engines/worldgen/cartography/render';
import { themeById } from '../src/engines/worldgen/cartography/theme';
import type { Ctx } from '../src/engines/worldgen/cartography/symbols';

GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');

const world = getWorld({ seed: 'monstruo', width: 1024 });
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);
mkdirSync('harness/out', { recursive: true });

const STATES: { tag: string; label: string; s: PaleoState }[] = [
  { tag: 'hoy', label: 'Hoy', s: { seaLevelM: 0, ice: 0 } },
  { tag: 'frio', label: 'Glaciación media', s: { seaLevelM: seaLevelForIce(0.5), ice: 0.5 } },
  { tag: 'maximo', label: 'Máximo glacial', s: { seaLevelM: seaLevelForIce(1), ice: 1 } },
  { tag: 'calido', label: 'Sin hielo', s: { seaLevelM: seaLevelForIce(-1), ice: 0 } },
];

const theme = themeById('wonder');
const OW = 1400, OH = 700;

for (const { tag, label, s } of STATES) {
  const t0 = Date.now();
  const p = paleoMap(world, s);
  nameBridges(world, geo.features, p);
  const ms = Date.now() - t0;
  console.log(`\n${label} (mar ${s.seaLevelM >= 0 ? '+' : ''}${Math.round(s.seaLevelM)} m, hielo ${Math.round(s.ice * 100)}%) — ${ms} ms`);
  console.log(`  tierra: ${(p.landFractionThen * 100).toFixed(1)} % (hoy ${(p.landFractionNow * 100).toFixed(1)} %)`);
  console.log(`  puentes de tierra: ${p.bridges.length}`
    + (p.bridges.length ? ` — ${p.bridges.map((b) => b.name ?? '?').slice(0, 3).join('; ')}` : ''));
  console.log(`  ${describePaleo(world, p)}`);

  const canvas = createCanvas(OW, OH);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  renderCartography(world, ctx, {
    theme, width: OW, height: OH, geography: undefined,
    layers: { labels: false, borders: false, roads: false, settlements: false },
    density: 0.8, typeScale: 1,
  });

  // Exposed shelf: a dry, pale wash with the ancient coastline round it.
  const img = ctx.getImageData(0, 0, OW, OH);
  const d = img.data;
  for (let y = 0; y < OH; y++) {
    const wy = Math.min(world.height - 1, (y * world.height / OH) | 0);
    for (let x = 0; x < OW; x++) {
      const wx = Math.min(world.width - 1, (x * world.width / OW) | 0);
      const i = wy * world.width + wx;
      const o = (y * OW + x) * 4;
      if (p.exposed[i]) {
        d[o] = d[o] * 0.35 + 214 * 0.65;
        d[o + 1] = d[o + 1] * 0.35 + 200 * 0.65;
        d[o + 2] = d[o + 2] * 0.35 + 158 * 0.65;
      } else if (p.drowned[i]) {
        d[o] = d[o] * 0.4 + 90 * 0.6;
        d[o + 1] = d[o + 1] * 0.4 + 130 * 0.6;
        d[o + 2] = d[o + 2] * 0.4 + 170 * 0.6;
      }
      if (p.ice[i] > 0.35 && p.land[i]) {
        const k = Math.min(1, (p.ice[i] - 0.35) / 0.5) * 0.72;
        d[o] = d[o] * (1 - k) + 244 * k;
        d[o + 1] = d[o + 1] * (1 - k) + 248 * k;
        d[o + 2] = d[o + 2] * (1 - k) + 252 * k;
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  for (const b of p.bridges) {
    const x = (b.x / world.width) * OW, y = (b.y / world.height) * OH;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.strokeStyle = '#8c1d1d';
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  ctx.font = '600 22px Lora';
  ctx.fillStyle = '#241a0d';
  ctx.strokeStyle = 'rgba(239,224,189,0.85)';
  ctx.lineWidth = 4;
  ctx.strokeText(label, 22, 38);
  ctx.fillText(label, 22, 38);
  ctx.font = '400 13px Lora';
  const sub = `mar ${s.seaLevelM >= 0 ? '+' : ''}${Math.round(s.seaLevelM)} m · tierra ${(p.landFractionThen * 100).toFixed(1)} % · ${p.bridges.length} puentes`;
  ctx.lineWidth = 3;
  ctx.strokeText(sub, 22, 58);
  ctx.fillText(sub, 22, 58);

  writeFileSync(`harness/out/paleo-${tag}.png`, canvas.toBuffer('image/png'));
}

// Sanity: the sea can only take land away as it rises.
const lo = paleoMap(world, { seaLevelM: -125, ice: 1 });
const mid = paleoMap(world, { seaLevelM: 0, ice: 0 });
const hi = paleoMap(world, { seaLevelM: 70, ice: 0 });
const mono = lo.landFractionThen > mid.landFractionThen && mid.landFractionThen > hi.landFractionThen;
console.log(`\n${mono ? '·' : '✗'} la tierra disminuye monótonamente al subir el mar `
  + `(${(lo.landFractionThen * 100).toFixed(1)} → ${(mid.landFractionThen * 100).toFixed(1)} → ${(hi.landFractionThen * 100).toFixed(1)} %)`);
console.log(`${mid.bridges.length === 0 ? '·' : '✗'} hoy no hay puentes de tierra (${mid.bridges.length})`);
