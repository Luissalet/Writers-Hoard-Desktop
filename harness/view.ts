import { writeFileSync, mkdirSync } from 'node:fs';
import { getWorld } from './world-cache';
import { renderBase } from '../src/engines/worldgen/core/render';
import type { ViewMode } from '../src/engines/worldgen/core/types';
import { encodePng } from './png';
const w = getWorld({ seed: process.argv[2]||'monstruo', width: Number(process.argv[3]||1024) });
mkdirSync('harness/out', { recursive: true });
for (const m of (process.argv.slice(4).length ? process.argv.slice(4) : ['currents']) as ViewMode[]) {
  writeFileSync(`harness/out/view-${m}.png`, encodePng(w.width, w.height, renderBase(w, m)));
  console.log(`harness/out/view-${m}.png`);
}
