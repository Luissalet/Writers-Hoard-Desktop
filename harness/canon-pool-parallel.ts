// ============================================
// Banco: LA GRANJA — paralelismo, vigía y afinidad de contexto
// ============================================
// Workers DE MENTIRA (responden por reloj, no generan nada): lo que se prueba
// es la GRANJA (2026-08-14, el derribo del pool de sesiones) — que un plan
// usa varios obreros a la vez; que un obrero MUDO cae por el vigía, se retira
// y el siguiente trabajo abre uno fresco; y que dos familias de contexto
// alternando NO thrashean: los obreros no se matan jamás por hueco, solo se
// reconfiguran, y la afinidad deja las reconfiguraciones en ~una por obrero.

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

  // ---- 2. el vigía retira al obrero mudo -----------------------------------
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
    check('la petición muda cae por el vigía', dead === null && waited >= 380 && waited < 2500,
      `null en ${waited.toFixed(0)} ms`);
    check('cuenta como caducada', tileStats.timeouts === before + 1, `timeouts ${tileStats.timeouts}`);
    check('el obrero mudo fue retirado', log.includes('terminate'), log.join(','));
    const alive = await tile(client, 0, factory);
    check('el siguiente trabajo abre obrero fresco y entrega', !!alive && spawned >= 2,
      `${spawned} obreros vividos`);
    requestDeadlines.tileMs = prior;
    client.dispose();
  }

  // ---- 3. dos familias, cero thrash: reconfigurar, jamás matar -------------
  // El funeral del pool viejo: familias alternando (hondas con el mundo del
  // canon; sábanas/miniatura con el editado) mataban sesiones calientes por
  // hueco — 24-58 contextos por sesión de uso en los logs de Luis, y el
  // renderer sin memoria de tanto clon. En la granja un obrero NUNCA muere
  // por hueco: como mucho se reconfigura, y con obreros de sobra la afinidad
  // deja a cada familia con los suyos.
  {
    const client = new RegionWorkerClient(8, 4);
    client.parallelWorldSessions = true;
    let spawns = 0;
    let configures = 0;
    const terminates: string[] = [];
    const factory = () => {
      spawns++;
      const w = fakeWorker({ tileMs: 40, log: terminates });
      const post = w.postMessage.bind(w);
      w.postMessage = (m) => {
        if ((m as { type: string }).type === 'configure') configures++;
        post(m);
      };
      return w;
    };
    const mundoB = { ...world };
    const pedir = (w: typeof world, i: number, ty: number) =>
      client.requestTile(w, geography, { z: 9, tx: i, ty }, {
        themeId: 'satellite', layers: {}, density: 1, reliefAmount: 1,
        ink: 'satellite', workerFactory: factory,
      }).promise;
    // Seis rondas alternas de dos teselas por familia.
    for (let ronda = 0; ronda < 6; ronda++) {
      await Promise.all([pedir(world, ronda, 0), pedir(world, ronda + 10, 0)]);
      await Promise.all([pedir(mundoB, ronda, 1), pedir(mundoB, ronda + 10, 1)]);
    }
    check('ningún obrero muere por hueco', terminates.length === 0,
      `${terminates.length} terminates en 6 rondas alternas`);
    check('los obreros se quedan (≤ techo)', spawns <= 4, `${spawns} obreros vividos`);
    check('la afinidad frena las reconfiguraciones', configures <= spawns + 4,
      `${configures} configures para ${spawns} obreros y 24 teselas`);
    client.dispose();
  }

  console.log(failures ? `\n${failures} EN ROJO` : '\nTODO EN VERDE');
  if (failures) process.exit(1);
};

run().catch((err) => { console.error(err); process.exit(1); });
