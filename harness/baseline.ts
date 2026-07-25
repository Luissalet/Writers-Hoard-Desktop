import { writeFileSync, mkdirSync } from 'node:fs';
import { getWorld } from './world-cache';
import { renderComposite } from '../src/engines/worldgen/core/render';
import { encodePng } from './png';
const w = getWorld({ seed: process.argv[2]||'monstruo', width: Number(process.argv[3]||1024) });
mkdirSync('harness/out', { recursive: true });
writeFileSync('harness/out/baseline-atlas.png', encodePng(w.width, w.height, renderComposite(w, 'atlas', true)));
console.log('ok');
