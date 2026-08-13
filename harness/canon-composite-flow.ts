// ============================================
// Banco: el composite regional y el canon persistido
// ============================================
// La rama `generate` era el único productor de canon cuyo trabajo moría con
// la petición. Con `canonKey`:
//   A (persistCanon) · generate → emite canonBuilt ANTES del done, e instala
//     la supertesela en su caché de sesión → un consumeOnly INMEDIATO sobre
//     ese suelo entrega píxeles (el composite calienta las teselas y el 3D).
//   B (sembrada de lo guardado) · generate → responde de la residencia SIN
//     generar (sin canonBuilt), y los rásters igualan a los de A byte a byte.

import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { createRegionWorkerCore, type RegionWorkerHost } from '../src/engines/worldgen/region/workerCore';
import { packRegionGeography, type RegionWorkerReply } from '../src/engines/worldgen/region/workerProtocol';
import { canonParams, tileGeometry, tileWindow, tileAt, canonRefinement } from '../src/engines/worldgen/region/tiles';
import { canonTileKey } from '../src/engines/worldgen/region/generate';
import { satelliteTileSpec } from '../src/engines/worldgen/region/satelliteTile';
import type { RegionData } from '../src/engines/worldgen/region/types';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${name} — ${detail}`);
  if (!ok) failures++;
};

const world = getWorld({ seed: 'canon-persist', width: 512, height: 256 });
const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS, 'full', false);

function makeHost(): { host: RegionWorkerHost; replies: RegionWorkerReply[] } {
  const replies: RegionWorkerReply[] = [];
  return {
    replies,
    host: {
      post: (message) => { replies.push(message); },
      renderTile: (px, draw) => {
        const canvas = createCanvas(px, px);
        const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
        draw(ctx);
        return { rgba: new ArrayBuffer(4), width: px, height: px, transfer: [] };
      },
    },
  };
}
const waitFor = async (replies: RegionWorkerReply[], type: string, n = 1): Promise<void> => {
  const t0 = Date.now();
  for (;;) {
    if (replies.filter((r) => r.type === type).length >= n) return;
    if (Date.now() - t0 > 300_000) throw new Error(`esperando ${type}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

const anchor = geography.settlements[0];
const id = tileAt(world, anchor.x, anchor.y);
const key = canonTileKey(id);
const genMsg = (requestId: string, contextId: string) => ({
  type: 'generate' as const,
  requestId,
  contextId,
  window: tileWindow(world, id),
  params: canonParams(world),
  geometry: tileGeometry(world, id),
  canonKey: key,
});

const run = async () => {
  // ---- A: genera, emite, y calienta su propia sesión ----------------------
  const a = makeHost();
  const coreA = createRegionWorkerCore(a.host);
  coreA({ type: 'configure', contextId: 'A', world, geography: packRegionGeography(geography), persistCanon: true });
  await waitFor(a.replies, 'configured');
  const g0 = performance.now();
  coreA(genMsg('a1', 'A'));
  await waitFor(a.replies, 'done');
  const genMs = performance.now() - g0;
  const builtA = a.replies.find((r) => r.type === 'canonBuilt');
  const doneA = a.replies.find((r) => r.type === 'done');
  check('A emite canonBuilt', !!builtA && builtA.type === 'canonBuilt' && builtA.key === key,
    `${(genMs / 1000).toFixed(1)} s, key ${builtA && builtA.type === 'canonBuilt' ? builtA.key : '—'}`);
  const seq = a.replies.filter((r) => r.type === 'canonBuilt' || r.type === 'done').map((r) => r.type);
  check('canonBuilt antes del done', seq.join('→') === 'canonBuilt→done', seq.join('→'));

  // La supertesela quedó residente: un consumeOnly inmediato entrega píxeles.
  // La tesela CENTRAL de la supertesela — una de borde pisa a las vecinas,
  // que este banco no ha generado, y el contrato declina con razón.
  const per = satelliteTileSpec(world, { z: 9, tx: 0, ty: 0 }).cw;
  const refinement = canonRefinement(world);
  const interior = 4 * refinement; // TILE_WORLD_CELLS
  const gxMid = id.tx * interior + interior / 2;
  const gyMid = id.ty * interior + interior / 2;
  const tx = Math.floor(gxMid / per);
  const ty = Math.floor(gyMid / per);
  coreA({
    type: 'renderTile', requestId: 'a2', contextId: 'A', z: 9, tx, ty,
    themeId: 'antique', layers: {}, density: 1, reliefAmount: 0.6,
    ink: 'satellite', consumeOnly: true,
  });
  await waitFor(a.replies, 'tile');
  const tileA = a.replies.find((r) => r.type === 'tile');
  check('el composite calienta las teselas (consumeOnly)',
    !!tileA && tileA.type === 'tile' && !tileA.declined,
    tileA && tileA.type === 'tile' ? `declined=${String(tileA.declined ?? false)}` : 'sin respuesta');

  if (!builtA || builtA.type !== 'canonBuilt' || !doneA || doneA.type !== 'done') throw new Error('sin A');

  // ---- B: sembrada, responde sin generar ----------------------------------
  const b = makeHost();
  const coreB = createRegionWorkerCore(b.host);
  coreB({ type: 'configure', contextId: 'B', world, geography: packRegionGeography(geography), persistCanon: true });
  await waitFor(b.replies, 'configured');
  const s0 = performance.now();
  coreB({ type: 'seedCanon', contextId: 'B', tiles: [{ key, bytes: builtA.bytes }] });
  coreB(genMsg('b1', 'B'));
  await waitFor(b.replies, 'done');
  const seedMs = performance.now() - s0;
  const doneB = b.replies.find((r) => r.type === 'done');
  check('B responde de la residencia', !!doneB && doneB.type === 'done',
    `${seedMs.toFixed(0)} ms (generar costó ${genMs.toFixed(0)} ms)`);
  check('B no generó ni re-emitió', b.replies.every((r) => r.type !== 'canonBuilt' && r.type !== 'progress'),
    'cero canonBuilt y cero progress');
  check('siembra ≥ 10× más rápida que generar', seedMs * 10 < genMs,
    `${(genMs / Math.max(1, seedMs)).toFixed(1)}×`);

  if (doneB && doneB.type === 'done') {
    const ra = doneA.region as RegionData;
    const rb = doneB.region as RegionData;
    const eq = (name: keyof RegionData): boolean => {
      const x = ra[name] as Float32Array | Uint8Array;
      const y = rb[name] as Float32Array | Uint8Array;
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
      return true;
    };
    const all = (['elevation', 'water', 'flow', 'slope', 'wet', 'biome', 'cover'] as const).every(eq);
    check('rásters A y B byte a byte', all, `${ra.width}×${ra.height}`);
    check('vectoriales A y B idénticos',
      JSON.stringify(ra.places) === JSON.stringify(rb.places)
      && JSON.stringify(ra.tracks) === JSON.stringify(rb.tracks),
    `${ra.places.length} lugares · ${ra.tracks.length} caminos`);
  }

  console.log(failures ? `\n${failures} EN ROJO` : '\nTODO EN VERDE');
  if (failures) process.exit(1);
};

run().catch((err) => { console.error(err); process.exit(1); });
