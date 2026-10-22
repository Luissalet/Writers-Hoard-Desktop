import { Biome } from '@/engines/worldgen/core/types';
import {
  GOODS, INITIAL_COVER, SITE_CAP, SITE_KINDS, autoSites, goodsSummary, normalizeTradeSite, simulateEconomy, siteFitness,
  tradeSiteEdit, tradeSiteRemoveEdit, tradeSitesFrom,
  type EconomyInput, type EconomyPlace, type EconomyWorld, type Good, type TradeSite,
} from '@/engines/worldgen/core/economy';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

const W = 96, H = 32;

/**
 * A tiny hand-made world, no generator: grassland everywhere, a sea band in the
 * middle, a desert strip on the seam, a desert pocket, an alpine block, a forest
 * nobody lives near and a salt flat on the west shore.
 */
function makeWorld(): EconomyWorld {
  const n = W * H;
  const world: EconomyWorld = {
    width: W, height: H, elevation: new Float32Array(n).fill(0.2), temperature: new Float32Array(n).fill(15),
    biome: new Uint8Array(n).fill(Biome.Grassland), lake: new Uint8Array(n),
  };
  const fill = (x0: number, x1: number, y0: number, y1: number, biome: number, elevation: number, temperature: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      world.biome[i] = biome; world.elevation[i] = elevation; world.temperature[i] = temperature;
    }
  };
  fill(30, 65, 0, H - 1, Biome.Ocean, -1, 10);          // sea: 36 cells wide
  fill(0, 4, 5, 11, Biome.Desert, 0.2, 28);             // desert on the seam (x = 0..4)
  fill(4, 12, 17, 23, Biome.Desert, 0.2, 28);           // desert pocket, no farmland
  fill(8, 12, 2, 6, Biome.Alpine, 2.2, 2);              // high ground
  fill(14, 20, 18, 26, Biome.TemperateForest, 0.3, 12); // forest, far from every place
  fill(24, 26, 12, 13, Biome.SaltFlat, 0.1, 20);        // salt on the west shore
  return world;
}

function place(id: number, name: string, x: number, y: number, rank: EconomyPlace['rank'], population: number, port = false): EconomyPlace {
  return { id, name, x, y, rank, population, port, realm: 0 };
}

function makeInput(extra: Partial<EconomyInput> = {}): EconomyInput {
  return {
    world: makeWorld(), seed: 'economy-test', ...extra,
    places: [
      place(0, 'Wheatby', 15, 12, 'village', 400),
      place(1, 'Seamside', 0, 8, 'village', 400),
      place(2, 'Highholt', 10, 8, 'town', 2500),
      place(3, 'Portwest', 29, 16, 'city', 2000, true),
      place(4, 'Eastport', 66, 16, 'town', 3000, true),
      place(5, 'Dune', 8, 20, 'village', 400),
    ],
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The trade lens: fitness, generated sites, the monthly simulation, ports, the summary and the edit records. */
export async function testWorldEconomy(): Promise<string[]> {
  const world = makeWorld();

  // Fitness: sensible kinds, nothing at sea, nothing impossible.
  for (const kind of SITE_KINDS) assert(siteFitness(world, kind, 40, 16) === 0, `${kind} fits the open sea`);
  assert(siteFitness(world, 'fishery', 10, 16) === 0, 'Inland fishery');
  assert(siteFitness(world, 'fishery', 29, 16) > 0.9, 'No fishery on the shore');
  assert(siteFitness(world, 'fishery', 28, 16) > 0.5 && siteFitness(world, 'fishery', 28, 16) < 0.9, 'Two cells from the sea should be worse');
  assert(siteFitness(world, 'mine', 10, 14) === 0 && siteFitness(world, 'mine', 10, 4) > 0.9, 'Mines belong on high ground');
  assert(siteFitness(world, 'farm', 10, 14) === 1 && siteFitness(world, 'farm', 2, 8) === 0 && siteFitness(world, 'farm', 10, 4) === 0, 'Farms: grass yes, desert and rock no');
  assert(siteFitness(world, 'camp', 16, 20) > 0.9 && siteFitness(world, 'camp', 10, 14) === 0, 'Camps want forest');
  assert(siteFitness(world, 'saltworks', 25, 12) === 1 && siteFitness(world, 'saltworks', 10, 14) === 0, 'Salt on the flat only');
  assert(siteFitness(world, 'farm', 100 + 15, 12) === 1 && siteFitness(world, 'farm', 15, -5) === 1, 'x must wrap and y must clamp');

  // Generated sites: deterministic, capped, stable ids, removals and manual sites honoured, the seam wraps.
  const input = makeInput();
  const first = autoSites(input);
  assert(JSON.stringify(first) === JSON.stringify(autoSites(makeInput())), 'autoSites is not deterministic');
  assert(first.every((s) => s.auto && !isSea(world, s) && s.placeId !== null), 'A generated site is on the sea or unassigned');
  for (const p of input.places) {
    const own = first.filter((s) => s.placeId === p.id);
    assert(own.length <= SITE_CAP[p.rank], `${p.name} opened ${own.length} sites`);
    assert(own.every((s) => /^auto:\d+,\d+:[a-z]+:\d+$/.test(s.id) && s.id.startsWith(`auto:${Math.floor(p.x)},${Math.floor(p.y)}:`)), `Odd ids at ${p.name}`);
  }
  assert(new Set(first.map((s) => s.id)).size === first.length && new Set(first.map((s) => `${s.x},${s.y}`)).size === first.length, 'Ids or cells collide');
  assert(first.some((s) => s.placeId === 0 && s.kind === 'farm') && !first.some((s) => s.placeId === 5 && s.kind === 'farm'), 'Wheatby farms, Dune cannot');
  assert(first.some((s) => s.placeId === 2 && (s.kind === 'mine' || s.kind === 'quarry')), 'Highholt ignores the mountain');
  assert(first.some((s) => s.placeId === 3 && s.kind === 'saltworks'), 'Portwest ignores the salt flat');
  const seamFarms = first.filter((s) => s.placeId === 1 && s.kind === 'farm');
  assert(seamFarms.length > 0 && seamFarms.every((s) => s.x >= W - 4), `Seamside should farm across the seam: ${JSON.stringify(seamFarms.map((s) => s.x))}`);
  const dropped = first[0].id;
  const manual: TradeSite = { id: 'm1', kind: 'camp', x: 16, y: 18, size: 'L', placeId: null, auto: true };
  const edited = autoSites(makeInput({ removedSites: [dropped], manualSites: [manual] }));
  assert(!edited.some((s) => s.id === dropped) && first.filter((s) => s.id !== dropped).every((s) => edited.some((e) => e.id === s.id && e.x === s.x && e.y === s.y)), 'Removing a site disturbed the others');
  const m1 = edited.find((s) => s.id === 'm1');
  assert(m1 && !m1.auto && m1.placeId === 0 && edited.length === first.length, `Manual site ${JSON.stringify(m1)}`);

  // Simulation: deterministic, never negative, goods conserved month by month.
  const months = 18;
  const run = simulateEconomy(input, months);
  assert(run.length === months && JSON.stringify(run) === JSON.stringify(simulateEconomy(makeInput(), months)), 'Simulation is not deterministic');
  assert(simulateEconomy(input, 999).length === 240 && simulateEconomy(input, 0).length === 0 && simulateEconomy(input, 3, 5)[0].month === 5, 'Month bounds');
  for (const snap of run) for (const p of snap.places) for (const g of GOODS) {
    assert(p.stock[g] >= 0 && p.consumed[g] <= p.need[g] + 1e-9 && p.consumed[g] >= 0, `Bad figures at ${p.name} ${g}`);
    assert(p.price[g] >= 0.3 && p.price[g] <= 5, `Price out of range at ${p.name} ${g}`);
  }
  for (const g of GOODS) {
    // Held + at sea after month m = held + at sea before + made - eaten. Month -1 is the opening larder.
    let before = sum(run[0].places.map((p) => p.need[g] * INITIAL_COVER[g]));
    for (const snap of run) {
      const atSea = sum(snap.movements.filter((m) => m.bySea && m.good === g).map((m) => m.amount));
      const now = sum(snap.places.map((p) => p.stock[g])) + atSea;
      const expected = before + sum(snap.places.map((p) => p.production[g] - p.consumed[g] - (p.eatenInstead[g] ?? 0)));
      assert(Math.abs(now - expected) < 1e-6 * Math.max(1, expected), `${g} not conserved in month ${snap.month}: ${now} vs ${expected}`);
      before = now;
    }
  }
  const winter = run.map((s) => s.places[0].production.grain);
  assert(Math.max(...winter.slice(0, 12)) > 1.3 * Math.min(...winter.slice(0, 12)), 'Grain should follow the harvest');

  // A place with no farmland: short, dear, supplied by a farming neighbour; alone it starves.
  const dune = run[months - 1].places[5];
  assert(dune.production.grain === 0 && dune.price.grain > 1, `Dune grain ${JSON.stringify(dune.price)}`);
  assert(run.some((s) => s.movements.some((m) => m.good === 'grain' && m.to === 5 && !m.bySea && m.amount > 0)), 'Nobody fed Dune');
  assert(run.every((s) => s.onTheMove === s.movements.length) && run.some((s) => s.onTheMove > 0), 'onTheMove');
  const alone = simulateEconomy({ ...makeInput(), places: [makeInput().places[5]] }, 12);
  assert(alone[0].places[0].shortIn.grain !== undefined && alone[0].places[0].shortIn.grain <= 3, `Alone shortIn ${JSON.stringify(alone[0].places[0].shortIn)}`);
  assert(!alone[11].places[0].fed && alone[11].places[0].price.grain === 5, 'Dune alone should starve and grain should cost the maximum');
  assert(run[months - 1].places[0].fed, 'Wheatby should be fed');

  // Ports: salt crosses the 36-cell gap by sea, one month late; no road crosses the water.
  const sea = run.flatMap((s) => s.movements.filter((m) => m.bySea));
  assert(sea.some((m) => m.good === 'salt' && m.from === 3 && m.to === 4), `No salt by sea: ${JSON.stringify(sea.slice(0, 3))}`);
  assert(!run.some((s) => s.movements.some((m) => !m.bySea && ((m.from === 3 && m.to === 4) || (m.from === 4 && m.to === 3)))), 'A road crossed the sea');
  assert(run[months - 1].places[4].price.salt < 5, 'Eastport salt should have arrived');

  // The summary: nobody makes timber here, and a hand-placed camp fixes that.
  // (Without its logging camps, so the world has nobody making timber.)
  const summary = goodsSummary(run[months - 1], first.filter((site) => site.kind !== 'camp'));
  const timber = summary.find((s) => s.good === 'timber')!;
  const grain = summary.find((s) => s.good === 'grain')!;
  assert(timber.missing && timber.madeIn === 0 && timber.hint === 'camp', `Timber ${JSON.stringify(timber)}`);
  assert(!grain.missing && grain.madeIn >= 4 && grain.hint === undefined && grain.priceMin <= grain.priceMax, `Grain ${JSON.stringify(grain)}`);
  assert(!goodsSummary(run[months - 1], edited).find((s) => s.good === 'timber')!.missing, 'Manual camp not counted');

  // Hand-placed sites: bad records refused, good ones tidied.
  for (const bad of [null, 'x', { id: '', kind: 'farm', x: 1, y: 1 }, { id: 'a'.repeat(81), kind: 'farm', x: 1, y: 1 }, { id: 'auto:1:farm:0', kind: 'farm', x: 1, y: 1 },
    { id: 'a', kind: 'orchard', x: 1, y: 1 }, { id: 'a', kind: 'farm', x: NaN, y: 1 }, { id: 'a', kind: 'farm', x: 1, y: '2' }, { id: 'a', kind: 'farm', x: 1, y: 1, size: 'XL' }, { id: 'a', kind: 'farm', x: 1, y: 1, placeId: 1.5 }]) {
    let refused = false; try { normalizeTradeSite(bad); } catch (e) { refused = e instanceof Error && e.message.length > 5; }
    assert(refused, `Accepted ${JSON.stringify(bad)}`);
  }
  const tidy = normalizeTradeSite({ id: ' f1 ', kind: 'farm', x: 10.123456, y: 5, auto: true });
  assert(tidy.id === 'f1' && tidy.size === 'M' && tidy.placeId === null && !tidy.auto && tidy.x === Math.round(10.123456 * 256) / 256, `Tidy ${JSON.stringify(tidy)}`);
  const a = normalizeTradeSite({ id: 'a', kind: 'camp', x: 1, y: 1 }), b = normalizeTradeSite({ id: 'b', kind: 'mine', x: 2, y: 2, size: 'S', placeId: 3 });
  const broken = { kind: 'tradeSite', id: 'broken', siteKind: 'orchard' };
  const derived = tradeSitesFrom([
    tradeSiteEdit(a), tradeSiteEdit(b), { kind: 'story' }, tradeSiteEdit({ ...a, kind: 'quarry', size: 'L' }),
    tradeSiteRemoveEdit('b'), tradeSiteRemoveEdit('auto:1:farm:0'), broken,
  ]);
  assert(derived.manual.length === 1 && derived.manual[0].id === 'a' && derived.manual[0].kind === 'quarry' && derived.manual[0].size === 'L', `Manual ${JSON.stringify(derived.manual)}`);
  assert(derived.removed.join() === 'auto:1:farm:0', `Removed ${JSON.stringify(derived.removed)}`);

  const goods: Good[] = [...GOODS];
  assert(goods.length === 8, 'Eight goods');
  return [
    'Fitness: no site on the sea, no inland fishery, mines only on high ground, farms on grass not desert, x wraps and y clamps',
    'Generated sites are deterministic, capped by rank, stable-id, collision-free; removals and manual sites are honoured; Seamside farms across the seam',
    'The simulation is deterministic, bounded to 240 months, never goes negative, conserves every good month by month and follows the harvest',
    'A village with no farmland pays more for grain and is fed by a farming neighbour; alone it runs short and starves',
    'Ports ship salt by sea across a 36-cell gap one month late, and no road crosses the water',
    'goodsSummary flags a good nobody makes with the site kind that would; hand-placed sites are validated and edit lists upsert and remove',
  ];
}

function isSea(world: EconomyWorld, s: TradeSite): boolean {
  return world.elevation[Math.floor(s.y) * world.width + Math.floor(s.x)] <= 0;
}
