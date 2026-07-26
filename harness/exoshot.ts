import { writeFileSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { generateWorld } from '/root/wg/src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '/root/wg/src/engines/worldgen/core/types';
import { DEFAULT_FILTERS } from '/root/wg/src/engines/worldgen/core/generation';
import { buildHumanGeography } from '/root/wg/src/engines/worldgen/core/settlements';
import { renderCartography } from '/root/wg/src/engines/worldgen/cartography/render';
import { themeById } from '/root/wg/src/engines/worldgen/cartography/theme';
import type { Ctx } from '/root/wg/src/engines/worldgen/cartography/symbols';
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf', 'Lora');
const w = generateWorld({ ...DEFAULT_PARAMS, seed: 'raro', width: 1024, filters: { ...DEFAULT_FILTERS, exotic: 1 } });
const geo = buildHumanGeography(w);
const c = createCanvas(1500, 750);
renderCartography(w, c.getContext('2d') as unknown as Ctx, {
  theme: themeById('wonder'), width: 1500, height: 750, geography: geo,
  view: { x: 0, y: 0, w: w.width, h: w.height },
  layers: { frame: false, compass: false, scaleBar: false }, title: 'Mundo exótico',
});
writeFileSync('/tmp/mundo-exotico.png', c.toBuffer('image/png'));
console.log('ok');
