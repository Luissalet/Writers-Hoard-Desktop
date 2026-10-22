import { db } from '@/db';
import type { Project } from '@/types';
import { Biome, DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { applyEdits, deserializeEdits } from '@/engines/worldgen/core/edits';
import { buildHumanGeography } from '@/engines/worldgen/core/settlements';
import { isRiverCell, planRoute, riverCellNear } from '@/engines/worldgen/core/travel';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/**
 * River crossings: fords cost time and bridges do not; a diagonal step between two
 * river cells is a crossing too; the author can close a crossing (no way past it,
 * corners included) and open it again; the ends of a journey, roads being laid out,
 * frozen rivers and boats are treated as such; the bridge tool.
 */
export async function testWorldCrossings(): Promise<string[]> {
  const P = 'synthetic-crossings', Wid = 'crossings-world';
  try {
    // ---- storage --------------------------------------------------------------
    const kept = deserializeEdits(JSON.stringify([{ kind: 'crossing', x: 3, y: 4, blocked: true }, { kind: 'crossing', x: 3, y: 4 }, { kind: 'crossing', x: 'a', y: 4, blocked: false }]));
    assert(kept.length === 1, `Stored crossings ${JSON.stringify(kept)}`);

    const params = { ...DEFAULT_PARAMS, width: 256, seed: 'crossing-planet' };
    // Opening clears every closed spot within a cell, across the date line too.
    const seamWorld = generateWorld(params);
    const W = seamWorld.width, H = seamWorld.height, y0 = Math.floor(H / 2);
    applyEdits(seamWorld, [
      { kind: 'crossing', x: W - 1, y: y0, blocked: true }, { kind: 'crossing', x: 0, y: y0, blocked: false },
      { kind: 'crossing', x: 10, y: y0, blocked: true }, { kind: 'crossing', x: 12, y: y0, blocked: true }, { kind: 'crossing', x: 11, y: y0, blocked: false },
    ]);
    assert(!seamWorld.painted?.blockedCrossings, `Opening near the seam and between two marks: ${JSON.stringify(seamWorld.painted?.blockedCrossingMarks)}`);

    // ---- a river laid on the diagonal over open land ------------------------------
    const world = generateWorld(params);
    const geo = { ...buildHumanGeography(world), roads: [] };
    const dry = (i: number) => world.biome[i] !== Biome.Ocean && world.biome[i] !== Biome.Lake && world.elevation[i] > 0 && world.lake[i] !== 1;
    let centre = -1;
    for (let cy = Math.floor(H * 0.3); cy < H * 0.7 && centre < 0; cy++) {
      for (let cx = 8; cx < W - 8 && centre < 0; cx++) {
        let ok = true;
        for (let dy = -7; dy <= 7 && ok; dy++) for (let dx = -7; dx <= 7 && ok; dx++) ok = dry((cy + dy) * W + cx + dx);
        if (ok) centre = cy * W + cx;
      }
    }
    assert(centre >= 0, 'No open land 15 cells across to lay a river on');
    const cx = centre % W, cy = Math.floor(centre / W);
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) world.flow[(cy + dy) * W + cx + dx] = 0;
    for (let k = -7; k <= 7; k++) world.flow[(cy + k) * W + cx + k] = 1;
    world.revision = (world.revision ?? 0) + 1;
    const at = (x: number, y: number) => y * W + x;
    const from = { x: cx - 3, y: cy + 3 }, to = { x: cx + 3, y: cy - 3 };
    const open = planRoute(world, geo, from, to, { mode: 'foot', season: 'summer' }, 'es');
    assert(!open.impossible && open.crossings.length === 1 && open.crossings[0].kind === 'river' && !open.crossings[0].bridge, `Across the diagonal river: ${JSON.stringify(open.crossings)} ${open.impossible ?? ''}`);
    const ford = open.crossings[0], fordCell = at(ford.x, ford.y);
    assert(isRiverCell(world, fordCell) && Math.abs(ford.x - cx) === Math.abs(ford.y - cy), `The ford is on the river: ${ford.x},${ford.y}`);
    // The same walk without the river is an hour and a half shorter on foot.
    const noRiver = generateWorld(params);
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) noRiver.flow[(cy + dy) * W + cx + dx] = 0;
    noRiver.revision = (noRiver.revision ?? 0) + 1;
    const dryWalk = planRoute(noRiver, geo, from, to, { mode: 'foot', season: 'summer' }, 'es');
    assert(Math.abs(open.hours - dryWalk.hours - 1.5) < 0.05, `A ford costs an hour and a half on foot: ${open.hours} vs ${dryWalk.hours} h`);

    // Closed there: no step onto a closed river cell and no diagonal slip between two of them.
    applyEdits(world, [{ kind: 'crossing', x: ford.x, y: ford.y, blocked: true }]);
    const blocked = world.painted?.blockedCrossings;
    assert(blocked?.has(fordCell) && world.painted?.blockedCrossingMarks?.length === 1, 'The closed crossing is on the world');
    const around = planRoute(world, geo, from, to, { mode: 'foot', season: 'summer' }, 'es');
    assert(!around.impossible, `A river 15 cells long can be crossed further along: ${around.impossible}`);
    for (let k = 1; k < around.cells.length; k++) {
      const a = around.cells[k - 1], b = around.cells[k];
      assert(!(isRiverCell(world, b) && blocked.has(b)), `The detour steps onto the closed river at ${b % W},${Math.floor(b / W)}`);
      const ax = a % W, ay = Math.floor(a / W), bx = b % W, by = Math.floor(b / W);
      if (ax !== bx && ay !== by) {
        const c1 = at(bx, ay), c2 = at(ax, by);
        assert(!(isRiverCell(world, c1) && isRiverCell(world, c2) && (blocked.has(c1) || blocked.has(c2))), `The detour slips between two closed river cells at ${bx},${ay}`);
      }
    }
    assert(around.crossings.length === 1 && around.hours > open.hours, `Closed: ${around.crossings.length} crossings, ${around.hours} h vs ${open.hours} h`);
    const crossedAt = around.crossings[0];
    // A place on the closed stretch can still be reached, and left.
    const fromBank = planRoute(world, geo, { x: ford.x, y: ford.y }, to, { mode: 'foot', season: 'summer' }, 'es');
    assert(!fromBank.impossible, `Setting off from the closed stretch: ${fromBank.impossible}`);
    // Laying out a road bridges what it meets: no ford, closed or not.
    const road = planRoute(world, geo, from, to, { mode: 'cart', season: 'summer', building: true }, 'es');
    assert(!road.impossible && road.crossings.length === 0, `A road being laid out: ${road.impossible ?? `${road.crossings.length} crossings`}`);
    // A boat goes down the closed river as before.
    const boat = planRoute(world, geo, { x: cx - 5, y: cy - 5 }, { x: cx + 5, y: cy + 5 }, { mode: 'boat', season: 'summer' }, 'es');
    assert(!boat.impossible && boat.cells.includes(fordCell), `A boat down the closed river: ${boat.impossible ?? 'goes round'}`);
    // In a hard winter the river is frozen: walked over, no ford time.
    const winterWorld = generateWorld(params);
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) { const i = (cy + dy) * W + cx + dx; winterWorld.flow[i] = world.flow[i]; winterWorld.temperature[i] = -15; }
    winterWorld.revision = (winterWorld.revision ?? 0) + 1;
    const winter = planRoute(winterWorld, geo, from, to, { mode: 'foot', season: 'winter' }, 'es');
    assert(!winter.impossible && winter.crossings.length === 1 && winter.crossings[0].frozen, `Winter: ${JSON.stringify(winter.crossings)}`);
    const winterDryWorld = generateWorld(params);
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) { const i = (cy + dy) * W + cx + dx; winterDryWorld.flow[i] = 0; winterDryWorld.temperature[i] = -15; }
    winterDryWorld.revision = (winterDryWorld.revision ?? 0) + 1;
    const winterDry = planRoute(winterDryWorld, geo, from, to, { mode: 'foot', season: 'winter' }, 'es');
    assert(Math.abs(winter.hours - winterDry.hours) < 0.05, `A frozen river costs no ford time: ${winter.hours} vs ${winterDry.hours} h`);
    // Opened again: the same walk as before.
    applyEdits(world, [{ kind: 'crossing', x: ford.x, y: ford.y, blocked: true }, { kind: 'crossing', x: ford.x, y: ford.y, blocked: false }]);
    const again = planRoute(world, geo, from, to, { mode: 'foot', season: 'summer' }, 'es');
    assert(!world.painted?.blockedCrossings && Math.abs(again.hours - open.hours) < 1e-6, `Opened again: ${again.hours} vs ${open.hours}`);
    // A journey that starts right beside the river still fords it, and pays for it.
    const beside = planRoute(world, geo, { x: cx - 1, y: cy }, to, { mode: 'foot', season: 'summer' }, 'es');
    const besideDry = planRoute(noRiver, geo, { x: cx - 1, y: cy }, to, { mode: 'foot', season: 'summer' }, 'es');
    assert(beside.crossings.length === 1 && Math.abs(beside.hours - besideDry.hours - 1.5) < 0.05, `Starting beside the river: ${JSON.stringify(beside.crossings)}, ${beside.hours} vs ${besideDry.hours} h`);
    // A goal right beside the river, diagonally across a closed corner, is not reached by slipping through it.
    applyEdits(world, [{ kind: 'crossing', x: cx, y: cy, blocked: true }]);
    const corner = world.painted?.blockedCrossings;
    assert(corner?.has(at(cx, cy)) && corner.has(at(cx + 1, cy + 1)), 'Closed at the centre of the river');
    const toCorner = planRoute(world, geo, from, { x: cx + 1, y: cy }, { mode: 'foot', season: 'summer' }, 'es');
    assert(!toCorner.impossible && toCorner.crossings.length === 1, `To a goal beside the closed river: ${toCorner.impossible ?? JSON.stringify(toCorner.crossings)}`);
    for (let k = 1; k < toCorner.cells.length; k++) {
      const a = toCorner.cells[k - 1], b = toCorner.cells[k];
      const ax = a % W, ay = Math.floor(a / W), bx = b % W, by = Math.floor(b / W);
      assert(!(isRiverCell(world, b) && corner.has(b)), `Onto the closed river at ${bx},${by}`);
      if (ax !== bx && ay !== by) assert(!(isRiverCell(world, at(bx, ay)) && isRiverCell(world, at(ax, by)) && (corner.has(at(bx, ay)) || corner.has(at(ax, by)))), `Slipped through the closed corner to ${bx},${by}`);
    }

    // ---- the bridge ------------------------------------------------------------
    const pristine = generateWorld(params);
    const land = (i: number) => i >= 0 && pristine.biome[i] !== Biome.Ocean && pristine.biome[i] !== Biome.Lake && pristine.elevation[i] > 0 && !isRiverCell(pristine, i);
    let river = -1, plainCell = -1;
    for (let i = Math.floor(H * 0.3) * W; i < Math.floor(H * 0.7) * W && (river < 0 || plainCell < 0); i++) {
      const x = i % W, y = Math.floor(i / W);
      if (river < 0 && isRiverCell(pristine, i) && land(y * W + (x + W - 3) % W) && land(y * W + (x + 3) % W)) river = i;
      if (plainCell < 0 && pristine.elevation[i] > 0.3 && riverCellNear(pristine, x + 0.5, y + 0.5) < 0) plainCell = i;
    }
    assert(river >= 0 && plainCell >= 0, `The generated world has a river (${river}) and dry high ground (${plainCell})`);
    await db.projects.put({ id: P, title: 'Crossings', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'River planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), pristine);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    const settle = async (tool: string, args: Record<string, unknown>) => {
      let reply: BridgeReply | undefined;
      for (let i = 0; i < 60; i++) { reply = await runBridgeTool(tool, args); if (!(reply.ok && (reply.result as { pending?: boolean }).pending)) break; await new Promise((r) => setTimeout(r, 500)); }
      return reply!;
    };
    const rx = river % W, ry = Math.floor(river / W);
    bad(await settle('wh_set_river_crossing', { worldId: Wid, x: plainCell % W, y: Math.floor(plainCell / W), blocked: true }), /No river/, 'no river there');
    bad(await runBridgeTool('wh_set_river_crossing', { worldId: Wid, x: rx, y: ry, blocked: 'yes' }), /blocked/, 'blocked not a boolean');
    const stored = async () => deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]');
    const nothing = await settle('wh_set_river_crossing', { worldId: Wid, x: rx, y: ry, blocked: false });
    assert(nothing.ok && (nothing.result as { unchanged?: boolean }).unchanged && (await stored()).length === 0, `Opening where nothing is closed: ${JSON.stringify(nothing).slice(0, 200)}`);
    const set = await settle('wh_set_river_crossing', { worldId: Wid, x: rx, y: ry, blocked: true });
    assert(set.ok && (await stored()).some((e) => e.kind === 'crossing' && e.blocked), `Close ${JSON.stringify(set).slice(0, 200)}`);
    const stops = [{ x: (rx - 3 + W) % W, y: ry }, { x: (rx + 3) % W, y: ry }];
    const planned = await settle('wh_plan_journey', { worldId: Wid, stops, mode: 'foot', season: 'summer' });
    const plan = planned.result as { impossible?: string; fords?: number; bridges?: number; frozenRivers?: number };
    const closedCell = (await stored()).find((e) => e.kind === 'crossing')!;
    const local = generateWorld(params);
    applyEdits(local, [closedCell]);
    const expected = planRoute(local, buildHumanGeography(local), stops[0], stops[1], { mode: 'foot', season: 'summer' }, 'en');
    const expectFords = expected.crossings.filter((c) => c.kind === 'river' && !c.bridge && !c.frozen).length, expectBridges = expected.crossings.filter((c) => c.kind === 'river' && c.bridge).length;
    assert(planned.ok && !plan.impossible && !expected.impossible && plan.fords === expectFords && plan.bridges === expectBridges && plan.frozenRivers === 0,
      `Bridge plan across the closed river: ${JSON.stringify(plan).slice(0, 300)} vs ${expectFords} fords, ${expectBridges} bridges`);
    const audit = (set.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_set_river_crossing', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'crossing' } });
    assert(undone.ok && (await stored()).length === 0, 'Undo');
    return [
      'Crossings are stored as a spot and blocked true/false; malformed ones are dropped; opening clears every closed spot within a cell, across the date line too',
      `A river laid on the diagonal: the walk across it records one ford at ${ford.x},${ford.y} (a diagonal step between two river cells counts) and takes 1.5 h more than without the river`,
      `Closed there: the walk goes ${(around.hours - open.hours).toFixed(1)} h further and fords at ${crossedAt.x},${crossedAt.y}, never stepping onto a closed river cell or slipping between two of them; a party can still set off from the closed stretch; a road being laid out bridges it; a boat still goes down the river; in a hard winter it is crossed frozen; opened again, the same walk`,
      `Starting beside the river still fords it (1.5 h); a goal beside the closed river is reached without slipping through the closed corner; a frozen river costs no ford time`,
      `Bridge: wh_set_river_crossing refuses where no river runs and a non-boolean, reports unchanged when opening where nothing is closed, closes a crossing at ${rx},${ry}; wh_plan_journey across it reports ${plan.fords} fords, ${plan.bridges} bridges and no frozen rivers, as the engine does; undo`,
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
