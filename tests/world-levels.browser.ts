import { db } from '@/db';
import type { Project } from '@/types';
import { Biome, DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { applyEdits, deserializeEdits, worldLevels, SEA_BIOME_STATS, type WorldEdit } from '@/engines/worldgen/core/edits';
import { buildHumanGeography } from '@/engines/worldgen/core/settlements';
import { fillLake } from '@/engines/worldgen/core/lake';
import { clearRegionCache, generateRegion } from '@/engines/worldgen/region/generate';
import { atlasCellColor } from '@/engines/worldgen/core/render';
import { captureEnvironment, restoreEnvironment } from '@/engines/worldgen/core/recalculate';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** The whole world's sea level and snowline: the edits, their replay and the bridge tool. */
export async function testWorldLevels(): Promise<string[]> {
  const P = 'synthetic-levels', Wid = 'levels-world';
  try {
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'levels-planet' };
    const base = generateWorld(params);
    const N = base.width * base.height;
    const landOf = (w: { elevation: Float32Array }) => { let n = 0; for (let i = 0; i < N; i++) if (w.elevation[i] > 0) n++; return n; };
    const land0 = landOf(base);
    // A higher sea drowns the low coast and the biomes follow.
    const risen = generateWorld(params);
    applyEdits(risen, [{ kind: 'seaLevel', m: 150 }]);
    const drowned: number[] = [];
    for (let i = 0; i < N; i++) if (base.elevation[i] > 0 && risen.elevation[i] <= 0) drowned.push(i);
    assert(landOf(risen) < land0 && drowned.length > 0 && Math.abs((base.elevation[0] - risen.elevation[0]) - 0.15) < 1e-6, `Sea +150 m: land ${land0} → ${landOf(risen)}`);
    // Lake surfaces are heights too: a filled lake's surface comes down with its
    // ground, for a sea that stays below it.
    let spot = -1;
    for (let i = 0; i < N && spot < 0; i += 3) if (base.elevation[i] > 0.05 && !base.lake[i] && fillLake(base, (i % base.width) + 0.5, Math.floor(i / base.width) + 0.5).cells.length >= 4) spot = i;
    assert(spot >= 0, 'No land for a lake');
    const fill: WorldEdit = { kind: 'lake', op: 'fill', x: (spot % base.width) + 0.5, y: Math.floor(spot / base.width) + 0.5 };
    const filled = generateWorld(params);
    applyEdits(filled, [fill]);
    const underM = Math.max(1, Math.floor(filled.elevation[spot] * 500));
    const lapped = generateWorld(params);
    applyEdits(lapped, [fill, { kind: 'seaLevel', m: underM }]);
    assert(filled.lake[spot] === 1 && lapped.lake[spot] === 1 && Math.abs(filled.lakeSurface![spot] - lapped.lakeSurface![spot] - underM / 1000) < 1e-5, `A lake surface did not follow a sea of +${underM} m`);
    // A lake of the world's own (here one low cell marked lake, as hydrology does) that the sea covers comes back when it goes down again.
    let lowLake = -1; for (let i = 0; i < N; i++) if (base.elevation[i] > 0.02 && !base.lake[i] && (lowLake < 0 || base.elevation[i] < base.elevation[lowLake])) lowLake = i;
    assert(lowLake >= 0, 'No low land');
    const coverM = Math.min(1000, Math.ceil(base.elevation[lowLake] * 1000) + 20);
    const covered = generateWorld(params); covered.lake[lowLake] = 1;
    applyEdits(covered, [{ kind: 'seaLevel', m: coverM }]);
    const uncovered = generateWorld(params); uncovered.lake[lowLake] = 1;
    applyEdits(uncovered, [{ kind: 'seaLevel', m: coverM }, { kind: 'seaLevel', m: 0 }]);
    // Ground lifted back above that sea by a stroke is land, not the old lake.
    const lift: WorldEdit = { kind: 'terrain', op: 'raise', stroke: { pts: [{ x: (lowLake % base.width) + 0.5, y: Math.floor(lowLake / base.width) + 0.5 }], radius: 3, strength: 1, softness: 0.2 } };
    const lifted = generateWorld(params); lifted.lake[lowLake] = 1;
    applyEdits(lifted, [{ kind: 'seaLevel', m: coverM }, lift, lift, lift, lift, lift, lift]);
    assert(lifted.elevation[lowLake] > 0 && lifted.lake[lowLake] === 0, `A lifted cell under the risen sea: height ${lifted.elevation[lowLake]}, lake ${lifted.lake[lowLake]}`);
    assert(covered.lake[lowLake] === 0 && covered.biome[lowLake] !== Biome.Lake && uncovered.lake[lowLake] === 1 && uncovered.biome[lowLake] === Biome.Lake, `Lake at ${lowLake}: covered ${covered.lake[lowLake]}/${covered.biome[lowLake]}, back ${uncovered.lake[lowLake]}/${uncovered.biome[lowLake]}`);
    // A replay of the same list takes the whole-world biomes worked out the first time, one per sea change.
    const again = generateWorld(params);
    const pristineAgain = Float32Array.from(again.elevation), envAgain = captureEnvironment(again);
    const withStroke: WorldEdit[] = [{ kind: 'seaLevel', m: 150 }, { kind: 'marker', marker: 'settlement', x: 3, y: 3, rank: 'town' }, { kind: 'seaLevel', m: 80 }, { kind: 'marker', marker: 'settlement', x: 9, y: 9, rank: 'village' }];
    SEA_BIOME_STATS.hits = 0; SEA_BIOME_STATS.misses = 0;
    applyEdits(again, withStroke);
    const firstBiomes = again.biome.slice();
    assert(SEA_BIOME_STATS.misses === 2 && SEA_BIOME_STATS.hits === 0, `First replay ${JSON.stringify(SEA_BIOME_STATS)}`);
    again.elevation.set(pristineAgain); restoreEnvironment(again, envAgain); again.painted = undefined;
    applyEdits(again, withStroke);
    assert(SEA_BIOME_STATS.misses === 2 && SEA_BIOME_STATS.hits === 2, `Second replay should reuse both: ${JSON.stringify(SEA_BIOME_STATS)}`);
    assert(firstBiomes.every((b, i) => again.biome[i] === b), 'The cached biomes differ from the first replay');
    // A region sheet's coast follows the sea too.
    const sheetWorld = generateWorld(params);
    const geo = buildHumanGeography(sheetWorld);
    const port = geo.settlements.find((s) => s.port) ?? geo.settlements[0];
    const sheetLand = (edits: WorldEdit[]) => { clearRegionCache(sheetWorld); const r = generateRegion(sheetWorld, geo, { cx: port.x + 0.5, cy: port.y + 0.5, spanKm: 160 }, { params: { res: 192, aspect: 1 }, edits }); let n = 0; for (const e of r.elevation) if (e > 0) n++; return { n, total: r.elevation.length }; };
    const sheet0 = sheetLand([]), sheetUp = sheetLand([{ kind: 'seaLevel', m: 150 }]);
    assert(sheetUp.n < sheet0.n, `A region sheet by ${port.name}: land ${sheet0.n} → ${sheetUp.n} of ${sheet0.total}`);
    const nowSea = drowned.filter((i) => risen.biome[i] === Biome.Ocean).length;
    assert(nowSea >= drowned.length * 0.9, `The drowned coast reads as ocean (${nowSea}/${drowned.length})`);
    // Levels are absolute and in order: up then back to 0 is the generated world's heights; a checkpoint keeps it.
    const back = generateWorld(params);
    applyEdits(back, [{ kind: 'seaLevel', m: 150 }, { kind: 'seaLevel', m: 0 }]);
    let maxDiff = 0; for (let i = 0; i < N; i++) maxDiff = Math.max(maxDiff, Math.abs(back.elevation[i] - base.elevation[i]));
    assert(maxDiff < 1e-5 && landOf(back) === land0, `Up and back: max height difference ${maxDiff}`);
    const list: WorldEdit[] = [{ kind: 'seaLevel', m: -120 }, { kind: 'recalculate', version: 1 }, { kind: 'seaLevel', m: 0 }];
    // Replayed twice on one world, as a painting session does (pristine heights back, then the list): the second replay restores the recalculation checkpoint.
    const replayed = generateWorld(params);
    const pristine = Float32Array.from(replayed.elevation), env = captureEnvironment(replayed);
    applyEdits(replayed, list);
    let drift = 0; for (let i = 0; i < N; i++) drift = Math.max(drift, Math.abs(replayed.elevation[i] - base.elevation[i]));
    replayed.elevation.set(pristine); restoreEnvironment(replayed, env); replayed.painted = undefined;
    applyEdits(replayed, list);
    for (let i = 0; i < N; i++) drift = Math.max(drift, Math.abs(replayed.elevation[i] - base.elevation[i]));
    assert(drift < 1e-5, `A checkpoint after a sea level change double-counted it: ${drift}`);
    // The snowline: a reading of the ground only, the last one wins.
    const snowy = generateWorld(params);
    applyEdits(snowy, [{ kind: 'snowline', m: 500 }, { kind: 'snowline', m: -2500 }]);
    assert(Math.abs((snowy.painted?.snowShiftC ?? 0) - (-2500 * 0.0065)) < 1e-9 && worldLevels([{ kind: 'snowline', m: 500 }, { kind: 'snowline', m: -2500 }]).snowlineM === -2500, 'Snow shift');
    let high = -1; for (let i = 0; i < N; i++) if (base.elevation[i] > 2 && base.temperature[i] > 0 && base.biome[i] !== Biome.Lake) { high = i; break; }
    if (high < 0) for (let i = 0; i < N; i++) if (base.elevation[i] > 2 && base.biome[i] !== Biome.Lake) { high = i; break; }
    assert(high >= 0, 'No highland');
    const whiteness = (c: [number, number, number]) => c[0] + c[1] + c[2];
    assert(whiteness(atlasCellColor(snowy, high)) > whiteness(atlasCellColor(base, high)), 'A lower snowline whitens a highland');
    assert(Array.from(snowy.elevation).every((e, i) => e === base.elevation[i]), 'The snowline moved the ground');
    // Storage: out-of-range levels are dropped on read.
    const read = deserializeEdits(JSON.stringify([{ kind: 'seaLevel', m: 50 }, { kind: 'seaLevel', m: 5000 }, { kind: 'snowline', m: 'x' }, { kind: 'snowline', m: -3000 }]));
    assert(read.length === 2, `Stored levels ${JSON.stringify(read)}`);

    // The bridge.
    await db.projects.put({ id: P, title: 'Levels', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Level planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), base);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    bad(await runBridgeTool('wh_set_world_levels', { worldId: Wid }), /seaLevelM and\/or snowlineM/, 'nothing given');
    bad(await runBridgeTool('wh_set_world_levels', { worldId: Wid, seaLevelM: 2000 }), /between/, 'sea out of range');
    bad(await runBridgeTool('wh_set_world_levels', { worldId: Wid, snowlineM: -4000 }), /between/, 'snow out of range');
    const set = await runBridgeTool('wh_set_world_levels', { worldId: Wid, seaLevelM: 80, snowlineM: -600 });
    const got = (await runBridgeTool('wh_get_world', { worldId: Wid })).result as { seaLevelM: number; snowlineM: number };
    assert(set.ok && got.seaLevelM === 80 && got.snowlineM === -600, `Set ${JSON.stringify(set).slice(0, 200)} / get ${JSON.stringify(got).slice(0, 200)}`);
    const same = await runBridgeTool('wh_set_world_levels', { worldId: Wid, seaLevelM: 80 });
    assert(same.ok && (same.result as { unchanged?: boolean }).unchanged === true && deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]').length === 2, 'Setting the same level writes nothing');
    const audit = (set.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_set_world_levels', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'levels' } });
    const after = (await runBridgeTool('wh_get_world', { worldId: Wid })).result as { seaLevelM: number; snowlineM: number };
    assert(undone.ok && after.seaLevelM === 0 && after.snowlineM === 0, `Undo ${JSON.stringify(after).slice(0, 200)}`);
    return [
      `Sea level +150 m drowns ${drowned.length} coastal cells (land ${land0} → ${landOf(risen)}) and their biomes follow (a replay reuses the whole-world biomes of each of two sea changes), a filled lake's surface comes down with the ground (+${underM} m), a lake the sea covered at +${coverM} m is back when it goes down (ground lifted by strokes instead is land), and a region sheet by ${port.name} loses land too (${sheet0.n} → ${sheetUp.n} cells); levels are absolute and in order (up and back is the generated world, also across a recalculation checkpoint); out-of-range levels are dropped on read`,
      'Snowline: the last one wins, it only changes the snow (a lower one whitens a highland), never the ground',
      'Bridge: wh_set_world_levels sets sea level and snowline (refuses nothing given and out-of-range values; an unchanged level writes nothing), wh_get_world reports them, undo puts both back',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
