import { db } from '@/db';
import type { Project } from '@/types';
import { Biome, DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import type { HumanGeography } from '@/engines/worldgen/core/settlements';
import { effectiveHoursPerDay, normalizeTravelProfile, paceRestDays, planRoute, type TravelOptions } from '@/engines/worldgen/core/travel';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { revertWorldTravelSettings, saveWorldJourney, saveWorldTravelSettings } from '@/engines/worldgen/journeyOperations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const close = (a: number, b: number, tolerance = 1e-9) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));
function flat(width = 64): WorldData {
  const n = width * width / 2;
  const w = {
    width, height: width / 2, params: { ...DEFAULT_PARAMS, width }, revision: 0,
    elevation: new Float32Array(n).fill(0.1), biome: new Uint8Array(n).fill(Biome.Grassland),
    temperature: new Float32Array(n).fill(18), precipitation: new Float32Array(n).fill(500),
    flow: new Float32Array(n), lake: new Uint8Array(n), ice: new Float32Array(n),
    currentU: new Float32Array(n), currentV: new Float32Array(n), currentSpeed: new Float32Array(n), sst: new Float32Array(n),
    plateId: new Uint8Array(n), boundary: new Float32Array(n), rivers: [], landmarks: [], plateInfo: [],
  } as unknown as WorldData;
  // A band of marsh across the middle, with grass to either side.
  for (let y = 8; y < 24; y++) for (let x = 28; x < 36; x++) w.biome[y * width + x] = Biome.Marsh;
  return w;
}
const geo = (w: WorldData) => ({ depth: 'full', settlements: [], roads: [], realms: [], realmOf: new Int32Array(w.width * w.height).fill(-1), features: [], ruins: [], landforms: [], languages: { languages: [] }, languageOf: {} } as unknown as HumanGeography);

export async function testWorldTravelProfile(): Promise<string[]> {
  const P = 'synthetic-travel-profile';
  try {
    const w = flat(), g = geo(w), from = { x: 20, y: 16 }, to = { x: 44, y: 16 };
    const base: TravelOptions = { mode: 'foot', season: 'summer' };
    const plain = planRoute(w, g, from, to, base, 'en');
    // Defaults reproduce the built-in physics exactly.
    const same = planRoute(w, g, from, to, { ...base, pace: 'steady', profile: {} }, 'en');
    assert(JSON.stringify(same) === JSON.stringify(plain), 'Steady pace with an empty profile changed the route');
    // Pace scales the day, and only hard adds rest days.
    const easy = planRoute(w, g, from, to, { ...base, pace: 'easy' }, 'en');
    assert(close(easy.hours, plain.hours) && close(easy.days, plain.hours / (11 * 0.75)) && !easy.restDays, `Easy pace: ${easy.days} vs ${plain.hours / 8.25}`);
    assert(paceRestDays('hard', 3) === 0 && paceRestDays('hard', 3.2) === 1 && paceRestDays('hard', 7) === 2 && paceRestDays('easy', 9) === 0, 'Rest-day rule');
    const longWorld = flat(256), longGeo = geo(longWorld);
    const hard = planRoute(longWorld, longGeo, { x: 10, y: 64 }, { x: 120, y: 64 }, { ...base, pace: 'hard' }, 'en');
    const travelDays = hard.hours / (11 * 1.3);
    assert(close(hard.days, travelDays + paceRestDays('hard', travelDays)) && (hard.restDays ?? 0) > 0, `Hard pace days ${hard.days} for ${travelDays} on the move`);
    assert(close(effectiveHoursPerDay({ season: 'winter', pace: 'hard' }), 7 * 1.3) && close(effectiveHoursPerDay({ season: 'winter', hoursPerDay: 12, pace: 'easy' }), 9), 'Effective hours per day');
    // Speed factors scale the whole least-time route.
    const quick = planRoute(w, g, from, to, { ...base, profile: { speed: { foot: 2 } } }, 'en');
    assert(close(quick.hours, plain.hours / 2, 1e-6) && quick.km === plain.km, `Double foot speed: ${quick.hours} vs ${plain.hours / 2}`);
    // Ground factors: a much slower marsh pushes the route round or makes it slower, never faster.
    const bog = planRoute(w, g, from, to, { ...base, profile: { ground: { marsh: 4 } } }, 'en');
    const easyMarsh = planRoute(w, g, from, to, { ...base, profile: { ground: { marsh: 0.25 } } }, 'en');
    assert(bog.hours >= plain.hours && easyMarsh.hours <= plain.hours && easyMarsh.hours < bog.hours, `Marsh cost ignored: ${easyMarsh.hours} / ${plain.hours} / ${bog.hours}`);
    // Mixed legs: horse then foot via a stop lands between all-horse and all-foot.
    const via = { x: 32, y: 4 };
    const horse = planRoute(w, g, from, to, { ...base, mode: 'horse', via: [via] }, 'en');
    const foot = planRoute(w, g, from, to, { ...base, via: [via] }, 'en');
    const mixed = planRoute(w, g, from, to, { ...base, via: [via], legModes: ['horse', 'foot'] }, 'en');
    assert(mixed.hours > horse.hours && mixed.hours < foot.hours, `Mixed legs ${mixed.hours} not between ${horse.hours} and ${foot.hours}`);
    const nights = mixed.stages.length, expectedNights = Math.min(399, Math.floor(mixed.hours / 11 + 1e-9));
    assert(Math.abs(nights - expectedNights) <= 1, `Mixed nights ${nights} vs ${expectedNights}`);
    // Profile validation.
    for (const bad of [{ speed: { foot: 9 } }, { ground: { lava: 2 } }, { colour: 1 }, { speed: { foot: 'fast' } }]) {
      let refused = false; try { normalizeTravelProfile(bad); } catch { refused = true; }
      assert(refused, `Accepted bad profile ${JSON.stringify(bad)}`);
    }
    assert(JSON.stringify(normalizeTravelProfile({ speed: { foot: 1 } })) === '{}', 'Neutral factors should be dropped');

    // Persistence: world settings with CAS and field-wise undo; journeys keep their snapshot.
    await db.projects.put({ id: P, title: 'Travel', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'travel-profile' };
    await db.generatedWorlds.put({ id: 'travel-world', projectId: P, title: 'Travel planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    const scope = { projectId: P };
    const set = await saveWorldTravelSettings(scope, 'travel-world', { profile: { speed: { horse: 1.5 } }, pace: 'hard' });
    assert(set.revision === 1, 'First travel save revision');
    let stale = false; try { await saveWorldTravelSettings(scope, 'travel-world', { pace: 'easy' }, 0); } catch { stale = true; }
    assert(stale && (await db.generatedWorlds.get('travel-world'))?.travelPace === 'hard', 'Stale travel write accepted');
    await saveWorldTravelSettings(scope, 'travel-world', { pace: 'easy' }, 1);
    const reverted = await revertWorldTravelSettings(scope, 'travel-world', set);
    let row = (await db.generatedWorlds.get('travel-world'))!;
    assert(row.travelProfile === undefined && row.travelPace === 'easy' && reverted.kept.includes('pace'), `Travel undo wrong: ${JSON.stringify({ row: [row.travelProfile, row.travelPace], reverted })}`);
    const journey = { id: 'trip', name: 'Hard ride', stops: [{ name: 'A', u: 0.1, v: 0.5 }, { name: 'B', u: 0.2, v: 0.5 }, { name: 'C', u: 0.3, v: 0.5 }], options: { mode: 'foot' as const, season: 'summer' as const, pace: 'hard' as const, legModes: ['horse' as const, 'foot' as const], profile: { ground: { forest: 2 } } }, recipeKey: 'x', createdAt: 1, updatedAt: 1 };
    await saveWorldJourney('travel-world', P, journey);
    let badLegs = false; try { await saveWorldJourney('travel-world', P, { ...journey, id: 'bad', options: { ...journey.options, legModes: ['horse'] } }); } catch { badLegs = true; }
    assert(badLegs, 'Journey with wrong leg count saved');
    row = (await db.generatedWorlds.get('travel-world'))!;
    assert(JSON.stringify(row.journeys?.[0].options) === JSON.stringify(journey.options), 'Journey lost its pace/legs/profile snapshot');

    // MCP: settings round trip, CAS, undo, and planning with them.
    await saveSnapshot(worldRuntimeKey('travel-world'), paramsKey(params), generateWorld(params));
    const read = await runBridgeTool('wh_get_world_travel_settings', { worldId: 'travel-world' });
    assert(read.ok && (read.result as { pace: string }).pace === 'easy', JSON.stringify(read));
    const revision = (read.result as { revision: number }).revision;
    const badSet = await runBridgeTool('wh_set_world_travel_settings', { worldId: 'travel-world', profile: { speed: { foot: 10 } } });
    assert(!badSet.ok && badSet.code === 'bad-args', 'Bridge accepted an out-of-range factor');
    const conflict = await runBridgeTool('wh_set_world_travel_settings', { worldId: 'travel-world', pace: 'steady', expectedRevision: revision - 1 });
    assert(!conflict.ok && conflict.code === 'conflict', `Bridge stale write: ${JSON.stringify(conflict)}`);
    const stops = [{ x: 30, y: 30 }, { x: 60, y: 34 }];
    let planned: { ok: boolean; result?: unknown } | null = null;
    for (let i = 0; i < 40; i++) { planned = await runBridgeTool('wh_plan_journey', { worldId: 'travel-world', stops, pace: 'steady' }); if (planned.ok && !(planned.result as { pending?: boolean }).pending) break; await new Promise(r => setTimeout(r, 250)); }
    assert(planned?.ok, JSON.stringify(planned));
    const before = planned!.result as { hours: number; impossible?: string; days: number; nights: unknown[] };
    const fast = await runBridgeTool('wh_set_world_travel_settings', { worldId: 'travel-world', profile: { speed: { foot: 2 } }, expectedRevision: revision });
    assert(fast.ok, JSON.stringify(fast));
    const after = (await runBridgeTool('wh_plan_journey', { worldId: 'travel-world', stops, pace: 'steady' })).result as { hours: number; impossible?: string };
    if (!before.impossible) assert(close(after.hours, before.hours / 2, 0.02), `Plan ignored the world profile: ${after.hours} vs ${before.hours}`);
    const audit = (fast.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_set_world_travel_settings', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'travel' } });
    row = (await db.generatedWorlds.get('travel-world'))!;
    assert(undone.ok && row.travelProfile === undefined, `Bridge travel undo: ${JSON.stringify(undone)}`);
    const wrongLegs = await runBridgeTool('wh_plan_journey', { worldId: 'travel-world', stops, legModes: ['foot', 'horse'] });
    assert(!wrongLegs.ok && wrongLegs.code === 'bad-args', 'Plan accepted legModes of the wrong length');
    return [
      'Steady pace and an empty profile reproduce the built-in route exactly',
      'Easy pace uses 75% of the day; hard uses 130% and adds a rest day after every three days on the move',
      'Speed factors scale the least-time route exactly; ground factors make marsh cheaper or dearer and the route follows',
      'Mixed per-leg modes land between all-horse and all-foot, with nights consistent with the mixed hours',
      'Profiles refuse unknown classes, bad values and out-of-range factors; neutral factors are dropped',
      'World travel settings save with CAS and undo field-wise; itineraries keep their pace, legs and profile snapshot and refuse a wrong leg count',
      'MCP get/set/plan: validation, stale revision refused, planning follows the world profile, undo restores it',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey('travel-world'));
    await db.generatedWorlds.delete('travel-world'); await db.projects.delete(P);
  }
}
