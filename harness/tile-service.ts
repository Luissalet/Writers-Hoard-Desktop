// ============================================================================
// Banco: el tileService — disco primero, cola corta, descarte, huérfanas
// ============================================================================
// Workers DE MENTIRA (canon-pool-parallel.ts los estrenó): aquí se prueba el
// EMBUDO nuevo de ARQUITECTURA-TESELAS §3.1, no los píxeles. Las varas:
//   A. disco primero — un acierto de persistencia no molesta al pool
//   B. compartir — dos vistas que quieren la misma tesela = UN render
//   C. techo de vuelo — nunca hay más renders en curso que sesiones posibles
//   D. cancelar en cola = descarte (null re-pedible, el pool ni se entera)
//   E. cancelar en vuelo = recoger y guardar — aterriza, se entrega, se
//      persiste (regla renderd: un render en curso ya está pagado)
//   F. ida y vuelta — lo aterrizado se guarda y la siguiente sesión lo lee
//      del disco sin despachar nada

import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  regionClient, setCanonPersistence, type RegionWorkerLike,
} from '../src/engines/worldgen/region/client';
import {
  resetTileServiceForBench, serveTile, setRenderedTilePersistence, tileServiceStats,
  type RenderedTilePersistence,
} from '../src/engines/worldgen/region/tileService';
import {
  hashEditsString, type RegionWorkerReply, type RegionWorkerRequest,
} from '../src/engines/worldgen/region/workerProtocol';
import type { RenderedTile } from '../src/engines/worldgen/region/client';
import { TILE_PX } from '../src/engines/worldgen/cartography/tiles';
import { getWorld } from './world-cache';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { satelliteTileSpec } from '../src/engines/worldgen/region/satelliteTile';
import { canonWindowCover } from '../src/engines/worldgen/region/composeWindow';
import { canonTileKey } from '../src/engines/worldgen/region/generate';

// El volcado del servicio pide OffscreenCanvas; en node lo suple @napi-rs.
class OffscreenShim {
  private c: ReturnType<typeof createCanvas>;
  width: number; height: number;
  constructor(w: number, h: number) { this.c = createCanvas(w, h); this.width = w; this.height = h; }
  getContext(kind: string) { return kind === '2d' ? this.c.getContext('2d') : null; }
  async convertToBlob(): Promise<Blob> {
    return new Blob([new Uint8Array(this.c.toBuffer('image/png'))]);
  }
}
(globalThis as Record<string, unknown>).OffscreenCanvas = OffscreenShim;

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${name} — ${detail}`);
  if (!ok) failures++;
};

const world = getWorld({ seed: 'banco-tinta', width: 256 });
const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS, 'full', false);

/** Cuántos renders están DENTRO de un worker ahora mismo, y el pico. */
let dentro = 0, pico = 0;

function fakeWorker(opts: { tileMs?: number } = {}): RegionWorkerLike {
  const w: RegionWorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate: () => { /* nada */ },
    postMessage: (message: RegionWorkerRequest) => {
      const reply = (r: RegionWorkerReply, ms: number) =>
        setTimeout(() => w.onmessage?.({ data: r } as MessageEvent<RegionWorkerReply>), ms);
      if (message.type === 'configure') {
        reply({ type: 'configured', contextId: message.contextId }, 1);
        return;
      }
      if (message.type === 'renderTile') {
        dentro++; pico = Math.max(pico, dentro);
        const canvas = createCanvas(TILE_PX, TILE_PX);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#3a5f3a';
        ctx.fillRect(0, 0, TILE_PX, TILE_PX);
        setTimeout(() => {
          dentro--;
          w.onmessage?.({
            data: {
              type: 'tile', requestId: message.requestId,
              bitmap: canvas as unknown as ImageBitmap,
              places: [{ worldX: 1, worldY: 2, name: 'Vado', kind: 'aldea', importance: 2 }],
            },
          } as MessageEvent<RegionWorkerReply>);
        }, opts.tileMs ?? 80);
        return;
      }
      // seedCanon, cancel, probe: nada que contestar.
    },
  };
  return w;
}

/** Persistencia falsa: un mapa clave→bytes con los MISMOS contratos que la
 *  puerta Dexie (load decodifica de bytes de verdad — la ida y vuelta E/F
 *  prueba png real, no un objeto compartido). */
const filas = new Map<string, { bytes: Uint8Array; places?: RenderedTile['places'] }>();
let cargas = 0, guardados = 0;
const clave = (editsJson: string, estilo: string, z: number, tx: number, ty: number) =>
  `${editsJson}|${estilo}|${z}/${tx}/${ty}`;
const persistencia: RenderedTilePersistence = {
  async load(_w, _g, key, editsJson, estilo) {
    cargas++;
    const fila = filas.get(clave(editsJson, estilo, key.z, key.tx, key.ty));
    if (!fila) return null;
    const img = await loadImage(Buffer.from(fila.bytes));
    const c = createCanvas(img.width, img.height);
    c.getContext('2d').drawImage(img, 0, 0);
    return { bitmap: c as unknown as OffscreenCanvas, places: fila.places };
  },
  save(_w, _g, key, editsJson, estilo, bytes, places) {
    guardados++;
    filas.set(clave(editsJson, estilo, key.z, key.tx, key.ty), { bytes, places });
  },
};

const factory = () => fakeWorker({ tileMs: 80 });
const lentaFactory = () => fakeWorker({ tileMs: 400 });

const pedir = (
  z: number, tx: number, ty: number, edits: string,
  f: () => RegionWorkerLike = factory,
) => serveTile(world, geography, { z, tx, ty }, {
  themeId: 'satellite', layers: { rivers: true, roads: true, fields: true },
  density: 1, reliefAmount: 1, ink: 'satellite', edits, workerFactory: f,
});

const drenar = () => new Promise((r) => setTimeout(r, 700));

async function main() {
  regionClient.parallelWorldSessions = true;
  setRenderedTilePersistence(persistencia);
  const cap = regionClient.sessionCapacity;
  console.log(`techo de vuelo (sesiones del pool): ${cap}`);

  // ---- A · disco primero ---------------------------------------------------
  {
    const previa = createCanvas(TILE_PX, TILE_PX);
    previa.getContext('2d').fillRect(0, 0, 8, 8);
    filas.set(clave('A', 'satellite|satellite|d1|r1|fields,rivers,roads', 12, 3, 4),
      { bytes: new Uint8Array(previa.toBuffer('image/png')) });
    const res = await pedir(12, 3, 4, 'A').promise;
    check('A · el disco responde', !!res?.bitmap, res ? 'tesela servida' : 'null');
    check('A · el pool ni se entera', tileServiceStats.dispatched === 0,
      `despachadas ${tileServiceStats.dispatched}`);
    check('A · acierto contado', tileServiceStats.diskHits === 1,
      `diskHits ${tileServiceStats.diskHits}`);
  }
  await drenar(); resetTileServiceForBench(); filas.clear();

  // ---- B · compartir -------------------------------------------------------
  {
    const r1 = pedir(12, 5, 6, 'B');
    const r2 = pedir(12, 5, 6, 'B');
    const [a, b] = await Promise.all([r1.promise, r2.promise]);
    check('B · un solo render para dos vistas', tileServiceStats.dispatched === 1,
      `despachadas ${tileServiceStats.dispatched}`);
    check('B · las dos reciben tesela', !!a?.bitmap && !!b?.bitmap,
      `a ${a ? 'sí' : 'null'} · b ${b ? 'sí' : 'null'}`);
    check('B · la segunda es COPIA', !!a && !!b && a.bitmap !== b.bitmap,
      'mismos bytes, distinto lienzo');
    check('B · compartida contada', tileServiceStats.shared === 1,
      `shared ${tileServiceStats.shared}`);
  }
  await drenar(); resetTileServiceForBench(); filas.clear();

  // ---- C · techo de vuelo --------------------------------------------------
  {
    dentro = 0; pico = 0;
    const muchas = [];
    for (let i = 0; i < cap + 6; i++) muchas.push(pedir(13, i, 1, 'C', lentaFactory));
    const res = await Promise.all(muchas.map((m) => m.promise));
    check('C · pico de renders ≤ techo', pico <= cap, `pico ${pico} · techo ${cap}`);
    check('C · todas aterrizan', res.every((r) => !!r?.bitmap),
      `${res.filter((r) => !!r).length}/${res.length}`);
  }
  await drenar(); resetTileServiceForBench(); filas.clear();

  // ---- D · cancelar en cola = descarte ------------------------------------
  {
    const vuelan = [];
    for (let i = 0; i < cap; i++) vuelan.push(pedir(14, i, 2, 'D', lentaFactory));
    // Micro-espera: que las primeras despachen antes de llenar la cola.
    await new Promise((r) => setTimeout(r, 30));
    const encoladas = [];
    for (let i = 0; i < 4; i++) encoladas.push(pedir(14, 40 + i, 2, 'D', lentaFactory));
    const antes = tileServiceStats.dispatched;
    for (const e of encoladas) e.cancel();
    const canceladas = await Promise.all(encoladas.map((e) => e.promise));
    check('D · la cancelada en cola resuelve null YA', canceladas.every((c) => c === null),
      `${canceladas.filter((c) => c === null).length}/4 null`);
    await Promise.all(vuelan.map((v) => v.promise));
    check('D · el pool nunca las vio', tileServiceStats.dispatched === antes,
      `despachadas ${tileServiceStats.dispatched} (antes ${antes})`);
  }
  await drenar(); resetTileServiceForBench(); filas.clear();

  // ---- E · cancelar en vuelo = recoger y guardar ---------------------------
  {
    guardados = 0;
    const r = pedir(15, 7, 3, 'E');
    await new Promise((res) => setTimeout(res, 30)); // ya despachada
    r.cancel();
    const tile = await r.promise;
    check('E · aterriza y SE ENTREGA pese al cancel', !!tile?.bitmap,
      tile ? 'tesela entregada al aterrizar' : 'null');
    check('E · huérfana contada', tileServiceStats.landedOrphan === 1,
      `landedOrphan ${tileServiceStats.landedOrphan}`);
    await new Promise((res) => setTimeout(res, 200)); // codificación asíncrona
    check('E · y SE GUARDA (el render estaba pagado)', guardados === 1,
      `guardados ${guardados}`);
  }
  await drenar(); resetTileServiceForBench();
  // OJO: las filas de E se conservan para F.

  // ---- F · ida y vuelta entre «sesiones» -----------------------------------
  {
    cargas = 0;
    const res = await pedir(15, 7, 3, 'E').promise;
    check('F · la revisita llega del disco', !!res?.bitmap && tileServiceStats.diskHits === 1,
      `diskHits ${tileServiceStats.diskHits}`);
    check('F · sin despachar nada', tileServiceStats.dispatched === 0,
      `despachadas ${tileServiceStats.dispatched}`);
    check('F · los lugares viajan con la tesela', (res?.places?.length ?? 0) === 1
      && res?.places?.[0].name === 'Vado', `places ${JSON.stringify(res?.places ?? null)}`);
  }
  await drenar(); resetTileServiceForBench(); filas.clear();

  // ---- G · la ola nueva va por delante -------------------------------------
  // El 0/60 de Luis (2026-08-13): los restos del nivel que dejó atrás
  // despachaban por delante del plan que MIRABA. Aquí: se llena el vuelo, se
  // encola una ola vieja, llega una ola nueva — y la nueva despacha primero.
  {
    const orden: string[] = [];
    const espia = (): RegionWorkerLike => {
      const w = fakeWorker({ tileMs: 200 });
      const post = w.postMessage.bind(w);
      w.postMessage = (m: RegionWorkerRequest) => {
        if (m.type === 'renderTile') orden.push(`${m.ty}`);
        post(m);
      };
      return w;
    };
    // Vuelo lleno (ty=0), ola vieja encolada (ty=1), pausa >8 ms, ola nueva (ty=2).
    const vuelo = []; const vieja = []; const nueva = [];
    for (let i = 0; i < cap; i++) vuelo.push(pedir(16, i, 0, 'G', espia));
    for (let i = 0; i < 4; i++) vieja.push(pedir(16, i, 1, 'G', espia));
    await new Promise((r) => setTimeout(r, 20));
    for (let i = 0; i < 4; i++) nueva.push(pedir(16, i, 2, 'G', espia));
    await Promise.all([...vuelo, ...vieja, ...nueva].map((m) => m.promise));
    const primeraVieja = orden.indexOf('1');
    const ultimaNueva = orden.lastIndexOf('2');
    check('G · la ola nueva despacha antes que la vieja',
      primeraVieja > ultimaNueva, `orden (ty por despacho): ${orden.join(',')}`);
  }
  await drenar(); resetTileServiceForBench(); filas.clear();

  // ---- H · el desborde se come la ola VIEJA, no el centro del plan ---------
  // La cola de la primera versión descartaba por la cabeza = lo más cercano
  // al centro del plan vigente (las z10 renacidas del log). Ahora: cabeza =
  // ola más vieja; el plan vigente sobrevive entero.
  {
    const rapida = () => fakeWorker({ tileMs: 30 });
    const vuelo = [];
    for (let i = 0; i < cap; i++) vuelo.push(pedir(17, i, 0, 'H', rapida));
    await new Promise((r) => setTimeout(r, 20));
    const vieja = [];
    for (let i = 0; i < 180; i++) vieja.push(pedir(17, i, 1, 'H', rapida));
    await new Promise((r) => setTimeout(r, 20));
    const nueva = [];
    for (let i = 0; i < 30; i++) nueva.push(pedir(17, i, 2, 'H', rapida));
    // El desborde (180+30 > 192 en cola) tuvo que comerse SOLO ola vieja.
    const res = await Promise.all(nueva.map((m) => m.promise));
    check('H · el plan vigente sobrevive entero al desborde',
      res.every((r) => !!r?.bitmap), `${res.filter(Boolean).length}/30 entregadas`);
    check('H · y el descarte se comió a la ola vieja',
      tileServiceStats.droppedQueued > 0, `descartadas ${tileServiceStats.droppedQueued}`);
    await Promise.all(vieja.map((m) => m.promise));
  }

  await drenar(); resetTileServiceForBench(); filas.clear();

  // ---- I · una supertesela canónica se genera una sola vez ----------------
  {
    setRenderedTilePersistence(null);
    const canonDisk = new Map<string, ArrayBuffer>();
    setCanonPersistence({
      async load(_w, _g, key) {
        await new Promise((resolve) => setTimeout(resolve, 12));
        return canonDisk.get(key)?.slice(0) ?? null;
      },
      save(_w, _g, key, _edits, bytes) { canonDisk.set(key, bytes.slice(0)); },
    });

    const builds = new Map<string, number>();
    const canonFactory = (): RegionWorkerLike => {
      const resident = new Set<string>();
      const w: RegionWorkerLike = {
        onmessage: null,
        onerror: null,
        onmessageerror: null,
        terminate: () => undefined,
        postMessage: (message: RegionWorkerRequest) => {
          const emit = (data: RegionWorkerReply, ms: number) =>
            setTimeout(() => w.onmessage?.({ data } as MessageEvent<RegionWorkerReply>), ms);
          if (message.type === 'configure') {
            emit({ type: 'configured', contextId: message.contextId }, 1);
          } else if (message.type === 'seedCanon') {
            for (const tile of message.tiles) resident.add(tile.key);
          } else if (message.type === 'renderTile') {
            const keys = canonWindowCover(world, satelliteTileSpec(world, message)).map(canonTileKey);
            let delay = 2;
            for (const key of keys) {
              if (resident.has(key)) continue;
              resident.add(key);
              builds.set(key, (builds.get(key) ?? 0) + 1);
              emit({
                type: 'canonBuilt', requestId: message.requestId, key,
                editsHash: hashEditsString(message.edits ?? ''),
                bytes: new Uint8Array([1, 2, 3, 4]).buffer,
              }, delay++);
            }
            const canvas = createCanvas(TILE_PX, TILE_PX);
            canvas.getContext('2d').fillRect(0, 0, TILE_PX, TILE_PX);
            emit({
              type: 'tile', requestId: message.requestId,
              bitmap: canvas as unknown as ImageBitmap,
            }, delay + 8);
          }
        },
      };
      return w;
    };

    const keys = [{ z: 12, tx: 5, ty: 6 }, { z: 12, tx: 6, ty: 6 }];
    const union = new Set(keys.flatMap((key) =>
      canonWindowCover(world, satelliteTileSpec(world, key)).map(canonTileKey)));
    const requests = keys.map((key) => serveTile(world, geography, key, {
      themeId: 'satellite', layers: { rivers: true, roads: false, fields: true },
      density: 1, reliefAmount: 1, ink: 'satellite', edits: 'I', workerFactory: canonFactory,
    }));
    const result = await Promise.all(requests.map((request) => request.promise));
    check('I · las teselas solapadas aterrizan', result.every((tile) => !!tile),
      `${result.filter(Boolean).length}/${result.length}`);
    check('I · cada supertesela se genera una sola vez',
      builds.size === union.size && [...builds.values()].every((count) => count === 1),
      `únicas ${builds.size}/${union.size} · máximo ${Math.max(0, ...builds.values())}`);
    setCanonPersistence(null);
  }

  setRenderedTilePersistence(null);
  regionClient.dispose();
  console.log(failures ? `\n${failures} varas ROJAS` : '\nTODO VERDE');
  process.exit(failures ? 1 : 0);
}

void main();
