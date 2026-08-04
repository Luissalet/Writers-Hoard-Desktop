// The glue, not the paint: does a satellite tile actually come back through
// the real worker core — the same message handler the Web Worker and the Forge
// process both run — with the real protocol and the real canon cache?
//
// Everything above this line has been tested by calling the renderers directly.
// This is the part that only fails in the app: a message shape, a branch, a
// context that never built its atlas.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { createRegionWorkerCore, type TileResult } from '../src/engines/worldgen/region/workerCore';
import { packRegionGeography, type RegionWorkerReply } from '../src/engines/worldgen/region/workerProtocol';
import { tileCountX } from '../src/engines/worldgen/cartography/tiles';

mkdirSync('harness/out/sat', { recursive: true });
const world = getWorld({ seed: 'monstruo', width: 1024 });
const geo = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);

const replies: RegionWorkerReply[] = [];
let lastCanvas: ReturnType<typeof createCanvas> | null = null;
const core = createRegionWorkerCore({
  post: (m) => { replies.push(m); },
  renderTile: (px, draw): TileResult => {
    const c = createCanvas(px, px);
    draw(c.getContext('2d') as never);
    lastCanvas = c;
    const rgba = c.getContext('2d').getImageData(0, 0, px, px).data;
    return { rgba: rgba.buffer as ArrayBuffer, width: px, height: px, transfer: [] };
  },
});

core({
  type: 'configure', contextId: 'ctx', world,
  geography: packRegionGeography(geo),
} as never);
console.log('configure →', replies.map((r) => r.type).join(', '));

const s = [...geo.settlements].sort((a, b) => b.population - a.population)[2];
function keyAt(z: number) {
  const cells = world.width / tileCountX(z);
  return { z, tx: Math.floor(s.x / cells), ty: Math.floor(s.y / cells) };
}

let ok = 0, fail = 0;
for (const [z, ink] of [[6, 'satellite'], [12, 'satellite'], [17, 'satellite'], [12, 'carta']] as const) {
  replies.length = 0;
  const k = keyAt(z);
  const t = Date.now();
  core({
    type: 'renderTile', requestId: `r${z}${ink}`, contextId: 'ctx',
    z: k.z, tx: k.tx, ty: k.ty, themeId: 'satellite',
    layers: { rivers: true, roads: true, fields: true }, density: 1, reliefAmount: 1,
    ink,
  } as never);
  const reply = replies[replies.length - 1];
  const ms = Date.now() - t;
  if (reply?.type === 'tile' && reply.width === 256) {
    // A tile that came back all one colour is a tile that failed quietly.
    const px = new Uint8Array(reply.rgba!);
    const seen = new Set<number>();
    for (let i = 0; i < px.length; i += 4 * 97) seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    console.log(`z${z} ${ink}: ${reply.type} ${reply.width}px · ${seen.size} tonos · ${(reply as { places?: unknown[] }).places?.length ?? 0} lugares · ${ms} ms`);
    if (seen.size > 3) ok++; else { console.log('  ¡PLANO!'); fail++; }
    if (lastCanvas) writeFileSync(`harness/out/sat/worker-z${z}-${ink}.png`, lastCanvas.toBuffer('image/png'));
  } else {
    console.log(`z${z} ${ink}: FALLO →`, JSON.stringify(reply).slice(0, 200));
    fail++;
  }
}
console.log(`\n${ok} bien · ${fail} mal`);
