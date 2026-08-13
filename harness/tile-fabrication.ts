// ============================================
// Banco: la fabricación del mapa de bits (vía rgba de la Forja)
// ============================================
// La rama que NUNCA se ejercitaba fuera de Electron: los Web Workers entregan
// `reply.bitmap` directo, así que todos los bancos y el smoke pasaban en verde
// mientras en la máquina de Luis `createImageBitmap` rechazaba EN SILENCIO
// cada tesela de la Forja — «✓ entregada», resolve(null), plan 0/28 y el
// suelo borroso para siempre (su log del 2026-08-12: tile-821 entregada y el
// mismo suelo re-nace 100 ms después como tile-850). La fabricación es ahora
// un lienzo con putImageData — síncrona, sin rama de rechazo — y este banco
// la pisa con los ImageData/OffscreenCanvas de @napi-rs/canvas: píxeles que
// entran crudos tienen que salir clavados en el lienzo, y una respuesta
// mutilada tiene que CANTAR (fabErrors) en vez de callar.

import { createCanvas, ImageData as NapiImageData } from '@napi-rs/canvas';
import { RegionWorkerClient, tileStats, type RegionWorkerLike } from '../src/engines/worldgen/region/client';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import type { RegionWorkerReply, RegionWorkerRequest } from '../src/engines/worldgen/region/workerProtocol';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${name} — ${detail}`);
  if (!ok) failures++;
};

// ---- el navegador de mentira: lo justo para la fabricación -----------------
// El cliente pregunta por OffscreenCanvas y construye ImageData; en node no
// existen, así que se calzan los de @napi-rs/canvas — los mismos huesos que
// usa la Forja de verdad al otro lado de la frontera.
(globalThis as Record<string, unknown>).ImageData = NapiImageData;
class FakeOffscreen {
  private canvas: ReturnType<typeof createCanvas>;
  constructor(w: number, h: number) { this.canvas = createCanvas(w, h); }
  getContext(kind: string) { return this.canvas.getContext(kind as '2d'); }
}
(globalThis as Record<string, unknown>).OffscreenCanvas = FakeOffscreen;

const world = getWorld({ seed: 'moved-roads', width: 512, height: 256 });
const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS, 'full', false);

/** Un worker que contesta como la FORJA: píxeles crudos, nunca bitmap. */
function rgbaWorker(shape: (px: number) => Partial<RegionWorkerReply & { type: 'tile' }>): RegionWorkerLike {
  const w: RegionWorkerLike = {
    onmessage: null, onerror: null, onmessageerror: null,
    terminate: () => undefined,
    postMessage: (message: RegionWorkerRequest) => {
      const reply = (r: RegionWorkerReply, ms: number) =>
        setTimeout(() => w.onmessage?.({ data: r } as MessageEvent<RegionWorkerReply>), ms);
      if (message.type === 'configure') {
        reply({ type: 'configured', contextId: message.contextId }, 1);
        return;
      }
      if (message.type !== 'renderTile') return;
      reply({ type: 'tile', requestId: message.requestId, ...shape(8) } as RegionWorkerReply, 20);
    },
  };
  return w;
}

const tile = (client: RegionWorkerClient, factory: () => RegionWorkerLike, tx: number) =>
  client.requestTile(world, geography, { z: 5, tx, ty: 0 }, {
    themeId: 'satellite', layers: {}, density: 1, reliefAmount: 1,
    ink: 'satellite', workerFactory: factory,
  }).promise;

const run = async () => {
  // ---- 1. píxeles crudos entran, lienzo con esos píxeles sale --------------
  {
    const client = new RegionWorkerClient(8, 2);
    const px = 8;
    const raw = new Uint8ClampedArray(px * px * 4);
    for (let i = 0; i < px * px; i++) {
      raw[i * 4] = 200; raw[i * 4 + 1] = 30; raw[i * 4 + 2] = 90; raw[i * 4 + 3] = 255;
    }
    const factory = () => rgbaWorker(() => ({
      rgba: raw.buffer as ArrayBuffer, width: px, height: px,
    }));
    const res = await tile(client, factory, 1);
    check('la tesela rgba se entrega con lienzo', !!res && !!res.bitmap, res ? 'lienzo presente' : 'null');
    if (res) {
      const c2d = (res.bitmap as unknown as FakeOffscreen).getContext('2d');
      const back = c2d.getImageData(0, 0, px, px).data;
      const same = back[0] === 200 && back[1] === 30 && back[2] === 90 && back[3] === 255;
      check('los píxeles sobreviven byte a byte', same, `(${back[0]},${back[1]},${back[2]},${back[3]})`);
    }
    client.dispose();
  }

  // ---- 2. una respuesta mutilada canta, no calla ----------------------------
  {
    const client = new RegionWorkerClient(8, 2);
    const before = tileStats.fabErrors;
    // rgba de 16 bytes para un 8×8 declarado: ImageData tiene que tirar,
    // el catch tiene que contarlo y la promesa resolver null re-pedible.
    const factory = () => rgbaWorker(() => ({
      rgba: new ArrayBuffer(16), width: 8, height: 8,
    }));
    const res = await tile(client, factory, 2);
    check('rgba mutilado resuelve null', res === null, res ? 'entregó algo' : 'null');
    check('y queda contado en fabErrors', tileStats.fabErrors === before + 1,
      `fabErrors ${before} → ${tileStats.fabErrors}`);
    client.dispose();
  }

  // ---- 3. una respuesta sin píxeles también canta ---------------------------
  {
    const client = new RegionWorkerClient(8, 2);
    const before = tileStats.fabErrors;
    const factory = () => rgbaWorker(() => ({}));
    const res = await tile(client, factory, 3);
    check('sin bitmap ni rgba resuelve null contado', res === null && tileStats.fabErrors === before + 1,
      `fabErrors ${before} → ${tileStats.fabErrors}`);
    client.dispose();
  }

  console.log(failures ? `\n${failures} EN ROJO` : '\nTODO EN VERDE');
  if (failures) process.exit(1);
};

run().catch((err) => { console.error(err); process.exit(1); });
