import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS, normalizeParams, type WorldData } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { WORLD_PRESETS, applyWorldPreset, matchesWorldPreset } from '@/engines/worldgen/core/presets';
import { landmassWindow } from '@/engines/worldgen/core/landmass';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Land cells, the largest 4-connected piece of land (wrapping east-west) and its extent in km. */
function measureLand(world: WorldData) {
  const W = world.width, H = world.height, kmCell = 40075 / W;
  const seen = new Uint8Array(W * H);
  let land = 0, best: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (world.elevation[i] <= 0) continue;
    land++;
    if (seen[i]) continue;
    const piece: number[] = [], stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      piece.push(c);
      const x = c % W, y = Math.floor(c / W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        const n = ny * W + ((x + dx + W) % W);
        if (!seen[n] && world.elevation[n] > 0) { seen[n] = 1; stack.push(n); }
      }
    }
    if (piece.length > best.length) best = piece;
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, top = 0;
  for (const c of best) {
    const x = c % W, y = Math.floor(c / W);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    top = Math.max(top, world.elevation[c]);
  }
  const lat = (0.5 - ((y0 + y1) / 2 + 0.5) / H) * Math.PI;
  const spanKm = Math.max((x1 - x0 + 1) * kmCell * Math.cos(lat), (y1 - y0 + 1) * kmCell);
  return { land, main: best.length, spanKm, topKm: top, latDeg: lat * 180 / Math.PI };
}

/** One landmass of a chosen size: island, country and continent presets, the size control, the 3D window and the bridge. */
export async function testWorldLandmass(): Promise<string[]> {
  const P = 'synthetic-landmass';
  try {
    // ---- params ---------------------------------------------------------------
    const island = WORLD_PRESETS.find((p) => p.id === 'island')!, country = WORLD_PRESETS.find((p) => p.id === 'country')!;
    assert(island && country && WORLD_PRESETS.some((p) => p.id === 'continent'), 'Island, country and continent presets');
    const base = { ...DEFAULT_PARAMS, seed: 'landmass-qa', width: 512 };
    const islandParams = applyWorldPreset(base, island);
    assert(islandParams.starter === 'landmass' && islandParams.landmassKm === 900 && matchesWorldPreset(islandParams, island), `Island preset params ${JSON.stringify(islandParams)}`);
    assert(!matchesWorldPreset({ ...islandParams, landmassKm: 1300 }, island), 'A changed size is no longer the preset');
    assert(normalizeParams({ ...islandParams, landmassKm: 50 }).landmassKm === 300 && normalizeParams({ ...islandParams, landmassKm: 20000 }).landmassKm === 9000, 'Size clamped to 300-9000 km');
    assert(normalizeParams({ ...islandParams, starter: 'sea' }).landmassKm === undefined, 'No size without a landmass');
    const left = applyWorldPreset(islandParams, WORLD_PRESETS.find((p) => p.id === 'continents')!);
    assert(left.starter === undefined && left.landmassKm === undefined, 'Leaving for continents drops the landmass and its size');

    // ---- the land ---------------------------------------------------------------
    const a = generateWorld(islandParams);
    const ia = measureLand(a);
    assert(ia.main >= ia.land * 0.8, `One island: the largest piece holds ${ia.main} of ${ia.land} land cells`);
    assert(ia.spanKm > 900 * 0.6 && ia.spanKm < 900 * 2, `Island about 900 km across: ${Math.round(ia.spanKm)} km`);
    assert(ia.latDeg > 15 && ia.latDeg < 55, `Laid in the temperate band: ${ia.latDeg.toFixed(1)}°`);
    assert(ia.topKm > 0.4, `The plates give it relief: highest ${ia.topKm.toFixed(2)} km`);
    const again = generateWorld(islandParams);
    assert(a.elevation.every((e, i) => e === again.elevation[i]), 'The same seed lays the same island');
    // At another level of detail the island lies in the same place.
    for (const seed of ['landmass-qa', 'landmass-c', 'landmass-d']) {
      const coarse = landmassWindow(generateWorld({ ...islandParams, seed }))!, fine = landmassWindow(generateWorld({ ...islandParams, seed, width: 1024 }))!;
      assert(Math.abs(fine.u - coarse.u) < 0.02 && Math.abs(fine.v - coarse.v) < 0.03, `${seed}: same place at 512 and 1024 cells: ${JSON.stringify(coarse)} vs ${JSON.stringify(fine)}`);
    }
    const c = measureLand(generateWorld(applyWorldPreset(base, country)));
    assert(c.main >= c.land * 0.8 && c.main > ia.main * 3 && c.spanKm > 2200 * 0.6 && c.spanKm < 2200 * 2, `Country: ${c.main} cells, ${Math.round(c.spanKm)} km vs island ${ia.main} cells`);
    const custom = measureLand(generateWorld({ ...islandParams, landmassKm: 3000 }));
    assert(custom.spanKm > 3000 * 0.6 && custom.spanKm < 3000 * 2, `A chosen 3000 km: ${Math.round(custom.spanKm)} km`);
    // The window the 3D view frames: the land with a margin of sea, a small part of the world.
    const win = landmassWindow(a)!;
    assert(win && win.su > 0.02 && win.su < 0.25 && win.sv > 0.02 && win.sv < 0.4, `Island window ${JSON.stringify(win)}`);
    const inside = (world: WorldData, w: { u: number; v: number; su: number; sv: number }, label: string) => {
      assert(w.u - w.su / 2 >= 0 && w.u + w.su / 2 <= 1 && w.v - w.sv / 2 >= 0 && w.v + w.sv / 2 <= 1, `${label}: window outside the world ${JSON.stringify(w)}`);
      const W = world.width, H = world.height;
      for (let i = 0; i < W * H; i++) {
        if (world.elevation[i] <= 0) continue;
        const u = ((i % W) + 0.5) / W, v = (Math.floor(i / W) + 0.5) / H;
        assert(Math.abs(u - w.u) <= w.su / 2 && Math.abs(v - w.v) <= w.sv / 2, `${label}: land at ${u.toFixed(3)},${v.toFixed(3)} outside the window ${JSON.stringify(w)}`);
      }
    };
    inside(a, win, 'Island');
    // Every size, a few seeds: clear of the date line and the poles, and the window holds the land.
    const checked: string[] = [];
    for (const km of [300, 5000, 9000]) for (const seed of ['landmass-a', 'landmass-b']) {
      // A small land needs cells small enough to hold it.
      const w = generateWorld({ ...islandParams, seed, width: km < 1000 ? 1024 : 256, landmassKm: km });
      const W = w.width, H = w.height;
      for (let y = 0; y < H; y++) {
        assert(w.elevation[y * W] <= 0 && w.elevation[y * W + W - 1] <= 0, `${km} km (${seed}): land on the date line at row ${y}`);
        const lat = (0.5 - (y + 0.5) / H) * 180;
        if (Math.abs(lat) > 80) for (let x = 0; x < W; x++) assert(w.elevation[y * W + x] <= 0, `${km} km (${seed}): land at ${lat.toFixed(0)}°`);
      }
      const m = measureLand(w);
      assert(m.spanKm > km * 0.45 && m.spanKm < km * 1.6, `${km} km (${seed}): ${Math.round(m.spanKm)} km across`);
      inside(w, landmassWindow(w)!, `${km} km (${seed})`);
      checked.push(`${km}:${Math.round(m.spanKm)}`);
    }

    // ---- the bridge -----------------------------------------------------------------
    await db.projects.put({ id: P, title: 'Landmass', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    bad(await runBridgeTool('wh_create_world', { projectId: P, preset: 'continents', landmassKm: 1200 }), /landmassKm/, 'landmassKm without a landmass preset');
    bad(await runBridgeTool('wh_create_world', { projectId: P, preset: 'island', landmassKm: 100 }), /landmassKm/, 'landmassKm too small');
    const made = await runBridgeTool('wh_create_world', { projectId: P, preset: 'island', landmassKm: 1200, seed: 'bridge-island', width: 1024 });
    const id = (made.result as { worldId?: string; id?: string })?.worldId ?? (made.result as { id?: string })?.id;
    const stored = id ? await db.generatedWorlds.get(id) : undefined;
    assert(made.ok && stored?.params.starter === 'landmass' && stored.params.landmassKm === 1200, `Bridge island ${JSON.stringify(made).slice(0, 300)}`);
    return [
      'Island, country and continent presets set one landmass of 900, 2200 and 5000 km; another size breaks the match; sizes clamp to 300-9000 km and go with the landmass only',
      `Island: one piece of land holds ${Math.round(ia.main / ia.land * 100)}% of the land, ${Math.round(ia.spanKm)} km across at ${ia.latDeg.toFixed(0)}° with ground up to ${ia.topKm.toFixed(2)} km; the same seed lays the same island; a country is ${Math.round(c.spanKm)} km, a chosen 3000 km is ${Math.round(custom.spanKm)} km`,
      `The 3D window frames the island with sea round it (${(win.su * 100).toFixed(1)}% × ${(win.sv * 100).toFixed(1)}% of the world), inside the world, holding all its land; 300, 5000 and 9000 km lands on two seeds stay clear of the date line and the poles, measure about their size (${checked.join(', ')} km) and fit their windows; three seeds lay the island in the same place at 512 and 1024 cells`,
      'Bridge: wh_create_world island with landmassKm 1200 saves the landmass; landmassKm is refused with a planet preset or out of range',
    ];
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
