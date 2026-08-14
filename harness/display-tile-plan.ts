import { DisplayTileStore, type TileRequest } from '../src/engines/worldgen/cartography/tileStore';
import type { TileKey } from '../src/engines/worldgen/cartography/tiles';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${name} — ${detail}`);
  if (!ok) failures++;
};

const world = { width: 256, height: 128 };
const view = { x: 80, y: 30, w: 2, h: 1 };

interface PendingProbe { key: TileKey; cancelled: boolean }
const pending: PendingProbe[] = [];
const renderer = (key: TileKey): TileRequest => {
  const probe = { key, cancelled: false };
  pending.push(probe);
  return {
    promise: new Promise(() => undefined),
    cancel: () => { probe.cancelled = true; },
  };
};

// A new camera plan replaces unfinished work across zoom levels.
const store = new DisplayTileStore(renderer, () => undefined, 32);
store.setGeneration('one');
store.want(world, 8, view);
const oldCount = pending.length;
store.want(world, 11, view);
check('el plan nuevo cancela niveles atravesados',
  pending.slice(0, oldCount).every((probe) => probe.cancelled),
  `${pending.slice(0, oldCount).filter((probe) => probe.cancelled).length}/${oldCount} canceladas`);

// A multi-level plan is atomic: the coarse floor and sharp target coexist.
pending.length = 0;
const dual = new DisplayTileStore(renderer, () => undefined, 32);
dual.setGeneration('two');
dual.wantPlan(world, [{ z: 8, view }, { z: 11, view }]);
const floor = pending.filter((probe) => probe.key.z === 8);
const sharp = pending.filter((probe) => probe.key.z === 11);
check('el plan atómico conserva suelo y nitidez',
  floor.length > 0 && sharp.length > 0 && pending.every((probe) => !probe.cancelled),
  `suelo ${floor.length} · nitidez ${sharp.length} · canceladas ${pending.filter((p) => p.cancelled).length}`);

// StrictMode's cleanup is safe only when the second setup creates a new store.
const first = new DisplayTileStore(async () => ({ close: () => undefined } as unknown as ImageBitmap), () => undefined);
first.dispose();
let arrived = 0;
const second = new DisplayTileStore(
  async () => ({ close: () => undefined } as unknown as ImageBitmap),
  () => { arrived++; },
);
second.setGeneration('strict');
second.want(world, 8, view);
await new Promise((resolve) => setTimeout(resolve, 0));
check('el segundo montaje acepta teselas', arrived > 0, `llegadas ${arrived}`);

store.dispose();
dual.dispose();
second.dispose();
console.log(failures ? `\n${failures} varas ROJAS` : '\nTODO VERDE');
process.exit(failures ? 1 : 0);
