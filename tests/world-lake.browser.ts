import { db } from '@/db';
import type { Project } from '@/types';
import { Biome, DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { applyEdits, deserializeEdits, type WorldEdit } from '@/engines/worldgen/core/edits';
import { fillLake, lakeAt } from '@/engines/worldgen/core/lake';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** A lake that fills its hollow: the fill, the edit on a real world, and the bridge tools. */
export async function testWorldLake(): Promise<string[]> {
  const P = 'synthetic-lake', Wid = 'lake-world';
  try {
    // A bowl on a plain: the water fills the bowl and stops at its rim, where it would spill.
    const W = 24, H = 16, elevation = new Float32Array(W * H).fill(0.5);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - 8, y - 8);
      if (d < 3.2) elevation[y * W + x] = 0.2 + d * 0.02;
      else if (d < 4.6) elevation[y * W + x] = 0.6; // the rim
    }
    for (let y = 0; y < H; y++) elevation[y * W + 20] = elevation[y * W + 21] = -0.1; // a strip of sea
    const bowl = fillLake({ width: W, height: H, elevation }, 8, 8, { maxCells: 500 });
    const inside = bowl.cells.every((i) => Math.hypot((i % W) - 8, Math.floor(i / W) - 8) < 4.6);
    assert(bowl.end === 'full' || bowl.end === 'spill', `Bowl end ${bowl.end}`);
    assert(bowl.cells.length >= 25 && inside, `The bowl fills to its rim: ${bowl.cells.length} cells, inside ${inside}`);
    // A slope with no hollow keeps a pond of a few cells; the sea and an existing lake are refused.
    const slope = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) slope[y * W + x] = 1 - x * 0.03;
    const pond = fillLake({ width: W, height: H, elevation: slope }, 5, 8);
    assert(pond.cells.length === 4 && pond.end === 'spill', `Pond ${pond.cells.length} ${pond.end}`);
    const dammed = fillLake({ width: W, height: H, elevation: slope }, 5, 8, { minCells: 12, maxCells: 40 });
    assert(dammed.cells.length >= 12 && dammed.cells.length <= 16 && dammed.cells.every((i) => (i % W) <= 5), `A least size dams a lake of 12 cells that rises up the slope, never below the dam: ${dammed.cells.length}`);
    assert(fillLake({ width: W, height: H, elevation }, 20, 3).end === 'nowhere', 'A lake in the sea');
    const wet = new Uint8Array(W * H); wet[8 * W + 8] = 1;
    assert(fillLake({ width: W, height: H, elevation, lake: wet }, 8, 8).end === 'nowhere', 'A lake on a lake');
    const capped = fillLake({ width: W, height: H, elevation }, 8, 8, { maxCells: 6 });
    assert(capped.cells.length === 6 && capped.end === 'full', 'The cap');
    // Draining finds the whole connected lake.
    const lakeMask = new Uint8Array(W * H); for (const i of bowl.cells) lakeMask[i] = 1;
    assert(lakeAt({ width: W, height: H, lake: lakeMask }, 8, 8).length === bowl.cells.length && lakeAt({ width: W, height: H, lake: lakeMask }, 0, 0).length === 0, 'lakeAt');
    // Storage: good lake edits kept, bad ones dropped.
    const kept = deserializeEdits(JSON.stringify([{ kind: 'lake', op: 'fill', x: 1, y: 1 }, { kind: 'lake', op: 'flood', x: 1, y: 1 }, { kind: 'lake', op: 'drain', x: 'a', y: 1 }, { kind: 'lake', op: 'fill', x: 1, y: 1, maxCells: 0 }]));
    assert(kept.length === 1, `Stored lakes ${JSON.stringify(kept)}`);

    // On a real world: the cells become lake and their biome follows; draining gives the land back.
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'lake-planet' };
    const world = generateWorld(params);
    const N = world.width * world.height;
    let spot = -1;
    for (let i = 0; i < N && spot < 0; i += 3) if (world.elevation[i] > 0.05 && !world.lake[i] && fillLake(world, (i % world.width) + 0.5, Math.floor(i / world.width) + 0.5).cells.length >= 4) spot = i;
    assert(spot >= 0, 'No land for a lake');
    const sx = (spot % world.width) + 0.5, sy = Math.floor(spot / world.width) + 0.5;
    const painted = generateWorld(params);
    const fill: WorldEdit = { kind: 'lake', op: 'fill', x: sx, y: sy };
    applyEdits(painted, [fill]);
    const wetCells = lakeAt(painted, sx, sy);
    assert(wetCells.length >= 4 && wetCells.every((i) => painted.biome[i] === Biome.Lake), `Lake cells ${wetCells.length}, biomes ${[...new Set(wetCells.map((i) => painted.biome[i]))]}`);
    // A recalculation later in the list does not wash it away.
    const recalc = generateWorld(params);
    applyEdits(recalc, [fill, { kind: 'recalculate', version: 1 }]);
    assert(recalc.lake[spot] === 1, 'A recalculation washed the lake away');
    const drained = generateWorld(params);
    applyEdits(drained, [fill, { kind: 'lake', op: 'drain', x: sx, y: sy }]);
    assert(wetCells.every((i) => drained.lake[i] === 0 || world.lake[i] === 1) && drained.biome[spot] !== Biome.Lake, 'Draining gives the land back');

    // The bridge.
    await db.projects.put({ id: P, title: 'Lake', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Lake planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), world);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    const cx = Math.floor(sx), cy = Math.floor(sy);
    const dry = await runBridgeTool('wh_add_lake', { worldId: Wid, x: cx, y: cy, dryRun: true });
    assert(dry.ok && (dry.result as { cells: number }).cells === wetCells.length && deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]').length === 0, `Dry run ${JSON.stringify(dry).slice(0, 300)}`);
    const sea = world.elevation.findIndex((e) => e <= 0);
    bad(await runBridgeTool('wh_add_lake', { worldId: Wid, x: sea % world.width, y: Math.floor(sea / world.width) }), /sea or already a lake/, 'lake in the sea');
    bad(await runBridgeTool('wh_add_lake', { worldId: Wid, x: cx, y: cy, maxCells: 0 }), /maxCells/, 'bad cap');
    bad(await runBridgeTool('wh_add_lake', { worldId: Wid, x: cx, y: cy, size: 1.5 }), /size/, 'bad size');
    const bigger = await runBridgeTool('wh_add_lake', { worldId: Wid, x: cx, y: cy, size: 10, dryRun: true });
    assert(!bigger.ok || (bigger.result as { cells: number }).cells >= 10, `size ${JSON.stringify(bigger).slice(0, 200)}`);
    bad(await runBridgeTool('wh_drain_lake', { worldId: Wid, x: cx, y: cy }), /no lake/, 'drain where there is none');
    const added = await runBridgeTool('wh_add_lake', { worldId: Wid, x: cx, y: cy });
    const after = (await runBridgeTool('wh_place_at', { worldId: Wid, x: cx, y: cy })).result as { lake?: boolean };
    assert(added.ok && after.lake === true, `Added ${JSON.stringify(added).slice(0, 200)} / place_at ${JSON.stringify(after).slice(0, 200)}`);
    const drain = await runBridgeTool('wh_drain_lake', { worldId: Wid, x: cx, y: cy });
    const dried = (await runBridgeTool('wh_place_at', { worldId: Wid, x: cx, y: cy })).result as { lake?: boolean };
    assert(drain.ok && dried.lake === false, `Drained ${JSON.stringify(drain).slice(0, 200)}`);
    const audit = (added.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_add_lake', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'lake' } });
    assert(undone.ok && deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]').length === 0, `Undo ${JSON.stringify(undone)}`);
    return [
      `Fill: a bowl fills to its rim (${bowl.cells.length} cells), a slope keeps a 4-cell pond (at least 12 cells, up the slope, with a least size of 12), the sea and a lake are refused, the cap holds; lakeAt finds the whole lake; bad lake edits are dropped on read`,
      `On a real world a lake of ${wetCells.length} cells turns their biome to lake, survives a later recalculation and drains back to land`,
      'Bridge: wh_add_lake measures with dryRun (size makes it at least that big), refuses the sea, a bad cap and a bad size, fills (wh_place_at says lake), wh_drain_lake drains and refuses where there is none; undo',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
