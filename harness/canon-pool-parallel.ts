// ============================================
// Banco: el pool en paralelo, el vigilante y el calentador
// ============================================
// Workers DE MENTIRA (responden por reloj, no generan nada): lo que se prueba
// es el POOL — que bajo multi-sesión un plan de teselas usa varias sesiones a
// la vez (la fila india de la captura de Luis, curada); que una sesión MUDA
// cae por el vigilante, se retira, y la siguiente petición abre una fresca; y
// que el calentador no repite superteselas ya calentadas.

import { RegionWorkerClient, requestDeadlines, tileStats, type RegionWorkerLike } from '../src/engines/worldgen/region/client';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import type { RegionWorkerReply, RegionWorkerRequest } from '../src/engines/worldgen/region/workerProtocol';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${name} — ${detail}`);
  if (!ok) failures++;
};

const world = getWorld({ seed: 'moved-roads', width: 512, height: 256 });
const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS, 'full', false);

/** Un worker falso: configure responde al instante; renderTile/generate según
 *  el guion. `mute` calla PARA SIEMPRE (el hijo muerto de la Forja). */
function fakeWorker(opts: { tileMs?: number; mute?: boolean; log?: string[] }): RegionWorkerLike {
  const w: RegionWorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate: () => { opts.log?.push('terminate'); },
    postMessage: (message: RegionWorkerRequest) => {
      const reply = (r: RegionWorkerReply, ms: number) =>
        setTimeout(() => w.onmessage?.({ data: r } as MessageEvent<RegionWorkerReply>), ms);
      if (message.type === 'configure') {
        reply({ type: 'configured', contextId: message.contextId }, 1);
        return;
      }
      if (message.type === 'cancel' || message.type === 'seedCanon') return;
      if (opts.mute) return; // el silencio del proceso muerto
      if (message.type === 'renderTile') {
        // Un bitmap de mentira: en node no hay ImageData/createImageBitmap,
        // y lo que se prueba es el POOL, no los píxeles.
        reply({
          type: 'tile', requestId: message.requestId,
          bitmap: { close() { /* nada */ } } as unknown as ImageBitmap,
        }, opts.tileMs ?? 120);
      } else if (message.type === 'generate') {
        const n = 4;
        const region = {
          window: message.window, params: message.params,
          width: 2, height: 2, margin: 0, metresPerCell: 150,
          originX: 0, originY: 0, worldPerCellX: 1, worldPerCellY: 1,
          elevation: new Float32Array(n), water: new Uint8Array(n),
          flow: new Float32Array(n), slope: new Float32Array(n),
          wet: new Float32Array(n), biome: new Uint8Array(n), cover: new Uint8Array(n),
          streams: [], places: [], tracks: [], fields: [], hedges: [], dykes: [],
          title: '', subtitle: '',
        };
        reply({ type: 'done', requestId: message.requestId, region }, opts.tileMs ?? 120);
      }
    },
  };
  return w;
}

const tile = (client: RegionWorkerClient, i: number, factory: () => RegionWorkerLike) =>
  client.requestTile(world, geography, { z: 9, tx: i, ty: 0 }, {
    themeId: 'satellite', layers: {}, density: 1, reliefAmount: 1,
    ink: 'satellite', workerFactory: factory,
  }).promise;

const run = async () => {
  // ---- 1. paralelismo: cuatro teselas, cuatro sesiones, un solo reloj -----
  {
    const client = new RegionWorkerClient(8, 4);
    client.parallelWorldSessions = true;
    let spawns = 0;
    const factory = () => { spawns++; return fakeWorker({ tileMs: 300 }); };
    const t0 = performance.now();
    await Promise.all([0, 1, 2, 3].map((i) => tile(client, i, factory)));
    const wall = performance.now() - t0;
    check('cuatro a la vez usan cuatro sesiones', spawns === 4, `${spawns} sesiones`);
    check('el muro es el de UNA, no la suma', wall < 700, `${wall.toFixed(0)} ms (serie sería ~1200)`);
    client.dispose();
  }

  // ---- 2. la fila india de antes, para contraste ---------------------------
  {
    const client = new RegionWorkerClient(8, 4);
    client.parallelWorldSessions = false;
    let spawns = 0;
    const factory = () => { spawns++; return fakeWorker({ tileMs: 120 }); };
    const t0 = performance.now();
    // Escalonadas: la primera ya tiene sesión ANTES de que pregunte la segunda
    // (en el mismo tick, cuatro acquire simultáneos siempre han podido abrir
    // hasta el tope — el modo serie protege el régimen, no el primer tick).
    const first = tile(client, 0, factory);
    await new Promise((r) => setTimeout(r, 15));
    await Promise.all([first, ...[1, 2, 3].map((i) => tile(client, i, factory))]);
    const wall = performance.now() - t0;
    check('en serie: una sesión, cuatro turnos', spawns === 1 && wall >= 440,
      `${spawns} sesión · ${wall.toFixed(0)} ms`);
    client.dispose();
  }

  // ---- 3. el vigilante retira a la sesión muda -----------------------------
  {
    const prior = requestDeadlines.tileMs;
    requestDeadlines.tileMs = 400;
    const before = tileStats.timeouts;
    const client = new RegionWorkerClient(8, 2);
    client.parallelWorldSessions = true;
    const log: string[] = [];
    let spawned = 0;
    // La primera sesión nace MUDA (configure sí, teselas jamás); la segunda, sana.
    const factory = () => {
      spawned++;
      return spawned === 1 ? fakeWorker({ mute: true, log }) : fakeWorker({ tileMs: 60 });
    };
    const t0 = performance.now();
    const dead = await tile(client, 0, factory);
    const waited = performance.now() - t0;
    check('la petición muda cae por plazo', dead === null && waited >= 380 && waited < 1500,
      `null en ${waited.toFixed(0)} ms`);
    check('cuenta como caducada', tileStats.timeouts === before + 1, `timeouts ${tileStats.timeouts}`);
    check('la sesión muda fue retirada', log.includes('terminate'), log.join(','));
    const alive = await tile(client, 0, factory);
    check('la siguiente abre sesión fresca y entrega', !!alive && spawned >= 2,
      `${spawned} sesiones vividas`);
    requestDeadlines.tileMs = prior;
    client.dispose();
  }

  // ---- 4. el calentador no repite ------------------------------------------
  {
    const client = new RegionWorkerClient(8, 4);
    client.parallelWorldSessions = true;
    let generates = 0;
    const factory = () => {
      const w = fakeWorker({ tileMs: 50 });
      const inner = w.postMessage.bind(w);
      w.postMessage = (m: RegionWorkerRequest) => {
        if (m.type === 'generate') generates++;
        inner(m);
      };
      return w;
    };
    // Dos gestos seguidos piden las MISMAS dos superteselas.
    client.warmCanon(world, geography, [{ tx: 3, ty: 5 }, { tx: 4, ty: 5 }], undefined, factory);
    client.warmCanon(world, geography, [{ tx: 3, ty: 5 }, { tx: 4, ty: 5 }], undefined, factory);
    await new Promise((r) => setTimeout(r, 400));
    check('el calentador deduplica por clave', generates === 2,
      `${generates} generaciones para 4 pedidas`);
    client.dispose();
  }

  // ---- 5. el calentador retira lo que el plan ya no pisa -------------------
  {
    const client = new RegionWorkerClient(8, 2);
    client.parallelWorldSessions = true;
    const factory = () => fakeWorker({ tileMs: 250 });
    client.warmCanon(world, geography, [{ tx: 10, ty: 2 }, { tx: 11, ty: 2 }], undefined, factory);
    // El plan cambia antes de que terminen: sólo B sobrevive, C entra.
    client.warmCanon(world, geography, [{ tx: 11, ty: 2 }, { tx: 12, ty: 2 }], undefined, factory);
    const inner = client as unknown as { warming: Map<string, () => void>; warmed: Set<string> };
    check('los warms obsoletos se retiran', inner.warming.size === 2 && inner.warmed.size === 2,
      `${inner.warming.size} vivos · ${inner.warmed.size} marcados (A cancelado y re-calentable)`);
    await new Promise((r) => setTimeout(r, 500));
    check('los vivos terminan y sueltan el registro', inner.warming.size === 0,
      `${inner.warming.size} vivos al final`);
    client.dispose();
  }

  console.log(failures ? `\n${failures} EN ROJO` : '\nTODO EN VERDE');
  if (failures) process.exit(1);
};

run().catch((err) => { console.error(err); process.exit(1); });
