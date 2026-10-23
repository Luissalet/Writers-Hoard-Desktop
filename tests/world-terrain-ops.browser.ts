import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { applyEdits, deserializeEdits, drawnRiverNear, type WorldEdit } from '@/engines/worldgen/core/edits';
import { commitPaintStroke, type PaintSpec } from '@/engines/worldgen/core/paintCommit';
import { DEFAULT_PAINT_TOOL } from '@/engines/worldgen/components/PaintPanel';
import { SculptGesture } from '@/engines/worldgen/sculpt/ops';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Terrain: the volcano and the height in metres; rivers point by point and turned round; the bridge. */
export async function testWorldTerrainOps(): Promise<string[]> {
  const P = 'synthetic-terrain-ops', Wid = 'terrain-ops-world';
  try {
    const params = { ...DEFAULT_PARAMS, width: 256, seed: 'terrain-ops-planet' };
    const world0 = generateWorld(params);
    const W = world0.width, H = world0.height;
    // A land cell well inside a continent, and the deepest open sea round which all is sea.
    let land = -1, sea = -1, seaDepth = 0;
    for (let y = Math.floor(H * 0.15); y < H * 0.85; y++) for (let x = 8; x < W - 8; x++) {
      const i = y * W + x;
      let allLand = true, shallowest = -Infinity;
      for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) { const e = world0.elevation[(y + dy) * W + x + dx]; if (e <= 0.05) allLand = false; shallowest = Math.max(shallowest, e); }
      if (land < 0 && allLand && world0.elevation[i] < 1) land = i;
      if (shallowest < 0 && shallowest < seaDepth) { seaDepth = shallowest; sea = i; }
    }
    assert(land >= 0 && sea >= 0, `Cells: land ${land}, sea ${sea}`);
    const at = (i: number) => ({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 });
    const stroke = (i: number, extra: Record<string, unknown> = {}) => ({ pts: [at(i)], radius: 6, strength: 1, softness: 0.5, ...extra });

    // The volcano on land: a peak ring higher than the ground was, a crater in the middle, nothing outside its foot.
    const v = generateWorld(params);
    applyEdits(v, [{ kind: 'terrain', op: 'volcano', stroke: stroke(land) }]);
    const lx = land % W, ly = Math.floor(land / W);
    const e = (w: typeof v, dx: number, dy: number) => w.elevation[(ly + dy) * W + lx + dx];
    let ring = -Infinity; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx || dy) ring = Math.max(ring, e(v, dx, dy));
    assert(ring > world0.elevation[land] + 1.8, `Volcano rim ${ring.toFixed(2)} over ground ${world0.elevation[land].toFixed(2)}`);
    assert(e(v, 0, 0) < ring - 0.1, `Crater ${e(v, 0, 0).toFixed(2)} under rim ${ring.toFixed(2)}`);
    let outside = 0; for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) if (Math.hypot(dx, dy) > 7 && Math.abs(e(v, dx, dy) - e(world0, dx, dy)) > 1e-6) outside++;
    assert(outside === 0, `${outside} cells changed outside the foot`);
    // In the deep sea a strong one raises an island.
    const s = generateWorld(params);
    applyEdits(s, [{ kind: 'terrain', op: 'volcano', stroke: stroke(sea) }]);
    const sx = sea % W, sy = Math.floor(sea / W);
    let island = -Infinity; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx || dy) island = Math.max(island, s.elevation[(sy + dy) * W + ((sx + dx + W) % W)]);
    assert(world0.elevation[sea] < -0.1 && island > 0, `Sea volcano rim ${island.toFixed(2)} from ${world0.elevation[sea].toFixed(2)}`);

    // The height in metres: the middle of the brush stands at that height.
    const h = generateWorld(params);
    applyEdits(h, [{ kind: 'terrain', op: 'height', stroke: stroke(land, { heightM: 2400 }) }]);
    assert(Math.abs(h.elevation[land] - 2.4) < 0.05, `Height op: ${h.elevation[land].toFixed(3)} km`);
    const deep = generateWorld(params);
    applyEdits(deep, [{ kind: 'terrain', op: 'height', stroke: stroke(land, { heightM: -300 }) }]);
    assert(deep.elevation[land] < -0.25, `Sunk to ${deep.elevation[land].toFixed(3)} km`);
    // The brush commits it with the height; a wrong height is dropped on reading.
    const spec: PaintSpec = { ...DEFAULT_PAINT_TOOL, mode: 'terrain', terrainOp: 'height', heightM: 1500 } as unknown as PaintSpec;
    const committed = commitPaintStroke(spec, [at(land)]);
    assert(committed?.kind === 'terrain' && committed.op === 'height' && committed.stroke.heightM === 1500, `Committed ${JSON.stringify(committed)}`);
    const kept = deserializeEdits(JSON.stringify({ edits: [{ kind: 'terrain', op: 'height', stroke: { pts: [{ x: 1, y: 1 }], radius: 2, strength: 1, heightM: 99999 } }, committed] }));
    assert(kept.length === 1, `Kept ${kept.length}`);
    // The live sculpt (3D, close 2D) makes the same ground as the replay.
    const live = generateWorld(params);
    const g = new SculptGesture(live.elevation, W, H, params.seed, { kind: 'terrain', op: 'height', radius: 6, strength: 1, softness: 0.5, heightM: 2400 });
    g.extend(at(land));
    const liveEdit = g.edits()[0];
    assert(liveEdit.stroke.heightM === 2400 && Math.abs(live.elevation[land] - h.elevation[land]) < 1e-5, `Live ${live.elevation[land]} vs replay ${h.elevation[land]}`);

    // A river point by point, turned round, and back.
    // A river's line runs through whole cells.
    const pts = [{ x: land % W, y: Math.floor(land / W) }, { x: (land % W) + 6, y: Math.floor(land / W) + 2 }, { x: (land % W) + 12, y: Math.floor(land / W) + 1 }];
    const river: WorldEdit = { kind: 'river', pts, width: 2 };
    const r1 = generateWorld(params); applyEdits(r1, [river]);
    const cells = [...r1.painted!.rivers[0].cells];
    assert(cells[0] === land && cells.length > 10, `River from the spring: ${cells[0]} vs ${land}`);
    const r2 = generateWorld(params); applyEdits(r2, [river, { kind: 'reverseRiver', x: (land % W) + 6, y: Math.floor(land / W) + 2 }]);
    const turned = [...r2.painted!.rivers[0].cells];
    assert(turned[0] === cells[cells.length - 1] && turned[turned.length - 1] === land, 'Turned round');
    const r3 = generateWorld(params); applyEdits(r3, [river, { kind: 'reverseRiver', x: (land % W) + 6, y: Math.floor(land / W) + 2 }, { kind: 'reverseRiver', x: (land % W) + 12, y: Math.floor(land / W) + 1 }]);
    assert(r3.painted!.rivers[0].cells[0] === land, 'Twice puts it back');
    const r4 = generateWorld(params); applyEdits(r4, [river, { kind: 'reverseRiver', x: (land % W) + 30, y: Math.floor(land / W) + 20 }]);
    assert(r4.painted!.rivers[0].cells[0] === land && drawnRiverNear([cells], W, (land % W) + 30, Math.floor(land / W) + 20) === -1, 'Far away does nothing');
    // The River tool point by point commits the clicks as one river.
    const pointSpec = { ...DEFAULT_PAINT_TOOL, mode: 'river', riverMode: 'points', riverWidth: 1.5 } as unknown as PaintSpec;
    const drawn = commitPaintStroke(pointSpec, pts);
    assert(drawn?.kind === 'river' && drawn.pts.length === 3 && drawn.width === 1.5, `Point river ${JSON.stringify(drawn)}`);

    // The bridge.
    await db.projects.put({ id: P, title: 'Terrain', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Terrain planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), world0);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    const cell = { x: land % W, y: Math.floor(land / W) };
    bad(await runBridgeTool('wh_shape_terrain', { worldId: Wid, op: 'melt', points: [cell] }), /op must be/, 'unknown op');
    bad(await runBridgeTool('wh_shape_terrain', { worldId: Wid, op: 'height', points: [cell] }), /heightM/, 'height without metres');
    bad(await runBridgeTool('wh_shape_terrain', { worldId: Wid, op: 'raise', points: [cell], heightM: 10 }), /only for op/, 'metres on raise');
    const shaped = await runBridgeTool('wh_shape_terrain', { worldId: Wid, op: 'volcano', points: [cell], radius: 6, strength: 1 });
    const editsNow = async () => deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]');
    assert(shaped.ok && (await editsNow()).some((x) => x.kind === 'terrain' && x.op === 'volcano'), `Volcano ${JSON.stringify(shaped).slice(0, 200)}`);
    const sh = await runBridgeTool('wh_shape_terrain', { worldId: Wid, op: 'height', points: [cell], heightM: 1200.4 });
    assert(sh.ok && (await editsNow()).some((x) => x.kind === 'terrain' && x.op === 'height' && x.stroke.heightM === 1200), 'Height stored');
    const seaCell = { x: sea % W, y: Math.floor(sea / W) };
    let dr: BridgeReply | undefined;
    for (let i = 0; i < 60; i++) { dr = await runBridgeTool('wh_draw_river', { worldId: Wid, points: [seaCell, { x: seaCell.x + 3, y: seaCell.y }] }); if (!(dr.ok && (dr.result as { pending?: boolean }).pending)) break; await new Promise((r) => setTimeout(r, 500)); }
    bad(dr!, /spring/, 'spring in the sea');
    const drew = await runBridgeTool('wh_draw_river', { worldId: Wid, points: [{ x: cell.x - 6, y: cell.y }, { x: cell.x, y: cell.y + 2 }, { x: cell.x + 6, y: cell.y + 1 }], width: 1.5 });
    assert(drew.ok && (await editsNow()).some((x) => x.kind === 'river' && x.pts.length === 3), `Draw ${JSON.stringify(drew).slice(0, 200)}`);
    let rev: BridgeReply | undefined;
    for (let i = 0; i < 60; i++) { rev = await runBridgeTool('wh_reverse_river', { worldId: Wid, x: cell.x, y: cell.y + 2 }); if (!(rev.ok && (rev.result as { pending?: boolean }).pending)) break; await new Promise((r) => setTimeout(r, 500)); }
    assert(rev!.ok && (await editsNow()).some((x) => x.kind === 'reverseRiver'), `Reverse ${JSON.stringify(rev).slice(0, 300)}`);
    const nowSpring = (rev!.result as { springNow: { x: number; y: number } }).springNow;
    assert(nowSpring.x === (cell.x + 6) % W && nowSpring.y === cell.y + 1, `Spring now ${JSON.stringify(nowSpring)}`);
    bad(await runBridgeTool('wh_reverse_river', { worldId: Wid, x: (cell.x + 120) % W, y: Math.min(H - 1, cell.y + 40) }), /No river drawn by hand/, 'no drawn river there');
    const audit = (rev!.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_reverse_river', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'reverse' } });
    assert(undone.ok && !(await editsNow()).some((x) => x.kind === 'reverseRiver'), 'Undo');
    return [
      `Volcano: on land a rim ${(ring - world0.elevation[land]).toFixed(1)} km over the ground with a crater ${(ring - e(v, 0, 0)).toFixed(2)} km deep, nothing outside its foot; in the deep sea (${world0.elevation[sea].toFixed(1)} km) it raises an island`,
      `Height: the brush sets the ground to 2,400 m (${(h.elevation[land] * 1000).toFixed(0)} m) or sinks it under the sea (-300 m); the brush stores the metres, a height off the scale is dropped on reading; the live sculpt makes the same ground`,
      `Rivers: drawn from the spring (${cells.length} cells), turned round by a reverseRiver edit two cells off, twice puts it back, far away nothing; the River tool's point mode commits the clicks as one river`,
      'Bridge: wh_shape_terrain refuses an unknown op and a height without (or with misplaced) metres, stores a volcano and a height; wh_draw_river refuses a spring in the sea and draws three points; wh_reverse_river turns it round (the spring is now the last point), refuses where no drawn river runs, undo',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
