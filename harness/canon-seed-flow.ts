// ============================================
// Banco: el ciclo entero de la persistencia del canon
// ============================================
// Recorre el protocolo REAL (workerCore + mensajes), no una simulación:
//   sesión A (persistCanon) · renderTile hondo → genera → emite canonBuilt
//   ANTES que el tile · una «Dexie» de mentira guarda los bytes ·
//   sesión B nueva · seedCanon con lo guardado · renderTile consumeOnly →
//   PÍXELES, no declined, sin generar nada — y los píxeles byte a byte
//   idénticos a los de la sesión A.
// La regla de oro del contrato: antes de esta pasada, la sesión B habría
// declinado (canon frío) o pagado ~31 s (generar).

import { createCanvas } from '@napi-rs/canvas';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { createRegionWorkerCore, type RegionWorkerHost } from '../src/engines/worldgen/region/workerCore';
import { packRegionGeography, type RegionWorkerReply } from '../src/engines/worldgen/region/workerProtocol';
import { satelliteDeepSupported, satelliteTileSpec } from '../src/engines/worldgen/region/satelliteTile';
import { canonWindowCover } from '../src/engines/worldgen/region/composeWindow';
import { canonTileKey } from '../src/engines/worldgen/region/generate';
import { canonRefinement, tileAt } from '../src/engines/worldgen/region/tiles';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${name} — ${detail}`);
  if (!ok) failures++;
};

const world = getWorld({ seed: 'canon-persist', width: 512, height: 256 });
const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS, 'full', false);

function makeHost(): { host: RegionWorkerHost; replies: RegionWorkerReply[] } {
  const replies: RegionWorkerReply[] = [];
  const host: RegionWorkerHost = {
    post: (message) => { replies.push(message); },
    renderTile: (px, draw) => {
      const canvas = createCanvas(px, px);
      const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
      draw(ctx);
      const data = (ctx as unknown as { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } })
        .getImageData(0, 0, px, px);
      const rgba = data.data.buffer.slice(0) as ArrayBuffer;
      return { rgba, width: px, height: px, transfer: [] };
    },
  };
  return { host, replies };
}

const waitFor = async (replies: RegionWorkerReply[], type: string, n = 1): Promise<void> => {
  const t0 = Date.now();
  for (;;) {
    if (replies.filter((r) => r.type === type).length >= n) return;
    if (Date.now() - t0 > 300_000) throw new Error(`esperando ${type}: ${JSON.stringify(replies.map((r) => r.type))}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

// Una tesela satélite honda: primer nivel hondo del mundo, sobre un pueblo.
const anchor = geography.settlements[0];
if (!satelliteDeepSupported(world, 9)) throw new Error('z9 no es hondo en este mundo');
const id = tileAt(world, anchor.x, anchor.y);
// La tesela de despliegue cuyo suelo contiene al ancla, situada con las
// utilidades REALES (nada de aritmética a pelo que pueda divergir).
const z = 9;
const per = satelliteTileSpec(world, { z, tx: 0, ty: 0 }).cw; // celdas canon por tesela
const refinement = canonRefinement(world);
const tx = Math.floor(((anchor.x % world.width) * refinement) / per);
const ty = Math.floor((anchor.y * refinement) / per);
console.log(`tesela z${z} (${tx},${ty}) sobre ${anchor.name} · supertesela ${canonTileKey(id)}`);

const tileMsg = (requestId: string, contextId: string, consumeOnly: boolean) => ({
  type: 'renderTile' as const,
  requestId,
  contextId,
  z, tx, ty,
  themeId: 'antique',
  layers: { rivers: true, roads: true, settlements: true },
  density: 1,
  reliefAmount: 0.6,
  ink: 'satellite' as const,
  consumeOnly,
});

const run = async () => {
  // ---- sesión A: genera y emite ------------------------------------------
  const a = makeHost();
  const coreA = createRegionWorkerCore(a.host);
  coreA({ type: 'configure', contextId: 'A', world, geography: packRegionGeography(geography), persistCanon: true });
  await waitFor(a.replies, 'configured');

  const g0 = performance.now();
  coreA(tileMsg('a1', 'A', false));
  await waitFor(a.replies, 'tile');
  const genMs = performance.now() - g0;

  const builtsA = a.replies.filter((r) => r.type === 'canonBuilt');
  const tileA = a.replies.find((r) => r.type === 'tile');
  check('la sesión A genera y emite canonBuilt', builtsA.length >= 1, `${builtsA.length} superteselas en ${(genMs / 1000).toFixed(1)} s`);
  const order = a.replies.map((r) => r.type);
  check('canonBuilt viaja ANTES que su tile', order.indexOf('canonBuilt') < order.indexOf('tile'),
    order.join(' → '));
  if (!tileA || tileA.type !== 'tile' || !tileA.rgba) throw new Error('sin píxeles de la sesión A');

  // La «Dexie» del banco.
  const stored = new Map<string, ArrayBuffer>();
  for (const b of builtsA) if (b.type === 'canonBuilt') stored.set(b.key, b.bytes);

  // ---- sesión B: fría, sembrada de lo guardado ---------------------------
  const b = makeHost();
  const coreB = createRegionWorkerCore(b.host);
  coreB({ type: 'configure', contextId: 'B', world, geography: packRegionGeography(geography), persistCanon: true });
  await waitFor(b.replies, 'configured');

  // Control: en frío, consumeOnly declina (el contrato del 3D).
  coreB(tileMsg('b0', 'B', true));
  await waitFor(b.replies, 'tile');
  const cold = b.replies.find((r) => r.type === 'tile');
  check('sesión B fría declina (control)', !!cold && cold.type === 'tile' && cold.declined === true,
    cold && cold.type === 'tile' ? `declined=${String(cold.declined)}` : 'sin respuesta');

  // La siembra: las superteselas de ESTA tesela, desde el almacén.
  const cover = canonWindowCover(world, satelliteTileSpec(world, { z, tx, ty })).map(canonTileKey);
  const tiles = cover.filter((k) => stored.has(k)).map((k) => ({ key: k, bytes: stored.get(k)! }));
  check('el almacén cubre la tesela', tiles.length === cover.length, `${tiles.length}/${cover.length} superteselas`);
  const s0 = performance.now();
  coreB({ type: 'seedCanon', contextId: 'B', tiles });
  coreB(tileMsg('b1', 'B', true));
  await waitFor(b.replies, 'tile', 2);
  const seededMs = performance.now() - s0;

  const warm = b.replies.filter((r) => r.type === 'tile')[1];
  check('sembrada, consumeOnly entrega PÍXELES', !!warm && warm.type === 'tile' && !warm.declined && !!warm.rgba,
    `${seededMs.toFixed(0)} ms de siembra+tinta (generar costó ${genMs.toFixed(0)} ms)`);
  check('la sesión B no generó nada', b.replies.every((r) => r.type !== 'canonBuilt'),
    'cero canonBuilt en B');

  if (warm && warm.type === 'tile' && warm.rgba && tileA.rgba) {
    const pa = new Uint8Array(tileA.rgba);
    const pb = new Uint8Array(warm.rgba);
    let diff = pa.byteLength === pb.byteLength ? 0 : -1;
    if (diff === 0) for (let i = 0; i < pa.byteLength; i++) if (pa[i] !== pb[i]) diff++;
    check('los píxeles sembrados igualan a los generados', diff === 0,
      diff < 0 ? 'tamaños distintos' : `${diff} bytes distintos de ${pa.byteLength}`);
  }

  console.log(failures ? `\n${failures} EN ROJO` : '\nTODO EN VERDE');
  if (failures) process.exit(1);
};

run().catch((err) => { console.error(err); process.exit(1); });
