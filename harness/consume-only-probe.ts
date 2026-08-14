// ============================================================================
// SONDA: el contrato «sólo consumir» del 3D, medido en el workerCore real
// ============================================================================
// Tres preguntas, en orden, sobre la MISMA tesela honda:
//   1. consumeOnly con el canon frío  → declinada, y en microsegundos.
//   2. sin consumeOnly               → se genera y llega el mapa de bits.
//   3. consumeOnly otra vez          → llega el mapa de bits (canon residente),
//                                      y mucho más rápido que la generación.
// Si (1) generase, el 3D estaría pagando superteselas desde la rueda; si (3)
// declinase, el «consume» no consumiría nada y sería un techo con otro nombre.
import { createCanvas } from '@napi-rs/canvas';
import { createRegionWorkerCore } from '../src/engines/worldgen/region/workerCore';
import type { RegionWorkerReply } from '../src/engines/worldgen/region/workerProtocol';
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '../src/engines/worldgen/core/types';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { SAT_DEEP_Z, satelliteDeepSupported } from '../src/engines/worldgen/region/satelliteTile';
import { packRegionGeography } from '../src/engines/worldgen/region/workerProtocol';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 'consume-probe', width: 256 });
const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS, 'full', false);
if (!satelliteDeepSupported(world, SAT_DEEP_Z)) {
  console.error(`el mundo de prueba no soporta z${SAT_DEEP_Z}; la sonda no mide nada`);
  process.exit(1);
}

const replies: RegionWorkerReply[] = [];
const core = createRegionWorkerCore({
  post: (r) => { replies.push(r); },
  renderTile: (px, draw) => {
    const canvas = createCanvas(px, px);
    draw(canvas.getContext('2d') as unknown as CanvasRenderingContext2D);
    const rgba = canvas.getContext('2d').getImageData(0, 0, px, px).data;
    return { rgba: rgba.buffer as ArrayBuffer, width: px, height: px };
  },
});

core({
  type: 'configure', contextId: 'probe',
  world: world as never,
  geography: packRegionGeography(geography) as never,
} as never);

const tile = { z: SAT_DEEP_Z, tx: 3, ty: 2 };
// El núcleo encadena los mensajes en una cola ASÍNCRONA (desde la pasada 9 la
// fragua pre-forja el canon con partes de `progress`): la respuesta llega por
// microtarea, así que se ESPERA — leerla en el mismo tick es leer la nada,
// que es exactamente el «¿nada? en 0 ms» que rompió esta sonda.
const ask = async (id: string, consumeOnly: boolean) => {
  const t0 = performance.now();
  core({
    type: 'renderTile', requestId: id, contextId: 'probe',
    ...tile, themeId: 'satellite', ink: 'satellite',
    layers: { rivers: true, roads: true, fields: true },
    density: 1, reliefAmount: 1, consumeOnly,
  } as never);
  const llegado = () => replies.some((x) => 'requestId' in x && x.requestId === id
    && (x.type === 'tile' || x.type === 'error'));
  while (!llegado() && performance.now() - t0 < 300_000) {
    await new Promise((r) => setTimeout(r, 1));
  }
  const ms = performance.now() - t0;
  const r = replies.filter((x) => 'requestId' in x && x.requestId === id
    && (x.type === 'tile' || x.type === 'error')).pop();
  const kind = r && r.type === 'tile' ? (r.declined ? 'DECLINADA' : 'entintada') : r?.type ?? '¿nada?';
  return { kind, ms };
};

const main = async () => {
  const fria = await ask('t1', true);
  console.log(`1 · consumeOnly, canon frío:      ${fria.kind} en ${fria.ms.toFixed(1)} ms`);
  const genera = await ask('t2', false);
  console.log(`2 · sin consumeOnly (genera):     ${genera.kind} en ${genera.ms.toFixed(0)} ms`);
  const caliente = await ask('t3', true);
  console.log(`3 · consumeOnly, canon residente: ${caliente.kind} en ${caliente.ms.toFixed(1)} ms`);

  // El plazo de la declinación sube de 50 ms a 250: la espera por sondeo
  // (setTimeout de 1 ms) mide ticks del reloj, no microsegundos del worker.
  const ok = fria.kind === 'DECLINADA' && genera.kind === 'entintada' && caliente.kind === 'entintada'
    && fria.ms < 250 && caliente.ms < genera.ms;
  console.log(ok ? '\nCONTRATO CUMPLIDO' : '\n¡CONTRATO ROTO!');
  process.exit(ok ? 0 : 1);
};

void main();
