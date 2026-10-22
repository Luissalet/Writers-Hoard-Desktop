import { db } from '@/db';
import type { Project } from '@/types';
import { Biome, DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { applyEdits, deserializeEdits } from '@/engines/worldgen/core/edits';
import { groundClassOf } from '@/engines/worldgen/core/travel';
import { englishRoute } from '@/engines/worldgen/core/travelText';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Painting ground through the bridge, the fantasy grounds included; what the place check and travel make of it. */
export async function testWorldPaintBiome(): Promise<string[]> {
  const P = 'synthetic-paint-biome', Wid = 'paint-biome-world';
  try {
    // Fantasy grounds travel like something: a class for the author's cost table and a name for the legs.
    assert(groundClassOf(Biome.FungalForest) === 'forest' && groundClassOf(Biome.GlowMarsh) === 'marsh' && groundClassOf(Biome.CrystalFlats) === 'dry' && groundClassOf(Biome.PetrifiedForest) === 'dry', 'Fantasy grounds have travel classes');
    const english = englishRoute({ cells: [], km: 0, hours: 0, days: 0, directKm: 0, legs: [{ terrain: 'bosque fúngico', km: 1, hours: 1, onRoad: false }, { terrain: 'marisma luminosa', km: 1, hours: 1, onRoad: false }], crossings: [], roadFraction: 0, stages: [], realms: [], highestM: 0, lowestM: 0, ascentM: 0 });
    assert(english.legs[0].terrain === 'fungal forest' && english.legs[1].terrain === 'glow marsh', `English leg names ${english.legs.map((l) => l.terrain)}`);

    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'paint-biome-planet' };
    const world = generateWorld(params);
    let spot = -1;
    for (let i = 0; i < world.elevation.length; i++) if (world.elevation[i] > 0.1 && !world.lake[i] && world.biome[i] !== Biome.FungalForest) { spot = i; break; }
    assert(spot >= 0, 'No land');
    const x = spot % world.width, y = Math.floor(spot / world.width);
    await db.projects.put({ id: P, title: 'Paint', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Fungal planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), world);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    bad(await runBridgeTool('wh_paint_biome', { worldId: Wid, biome: 'ocean', points: [{ x, y }] }), /biome must be/, 'ocean');
    bad(await runBridgeTool('wh_paint_biome', { worldId: Wid, biome: 'dragonScale', points: [{ x, y }] }), /biome must be/, 'unknown ground');
    bad(await runBridgeTool('wh_paint_biome', { worldId: Wid, biome: 'fungalForest', points: [] }), /points/, 'no points');
    bad(await runBridgeTool('wh_paint_biome', { worldId: Wid, biome: 'fungalForest', points: [{ x, y: 9999 }] }), /inside the world/, 'off the grid');
    bad(await runBridgeTool('wh_paint_biome', { worldId: Wid, biome: 'fungalForest', points: [{ x, y }], radius: 200 }), /radius/, 'radius');
    const before = (await runBridgeTool('wh_place_at', { worldId: Wid, x, y })).result as { ground: string };
    const painted = await runBridgeTool('wh_paint_biome', { worldId: Wid, biome: 'fungalForest', points: [{ x, y }, { x: x + 1, y }], radius: 2 });
    assert(painted.ok, `Paint ${JSON.stringify(painted).slice(0, 300)}`);
    const stored = deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]');
    assert(stored.length === 1 && stored[0].kind === 'biome' && stored[0].biome === Biome.FungalForest, `Stored ${JSON.stringify(stored)}`);
    let after: { ground: string } | undefined;
    for (let i = 0; i < 60; i++) { const r = await runBridgeTool('wh_place_at', { worldId: Wid, x, y }); if (r.ok && !(r.result as { pending?: boolean }).pending) { after = r.result as { ground: string }; if (after.ground === 'fungalForest') break; } await new Promise((z) => setTimeout(z, 300)); }
    assert(after?.ground === 'fungalForest' && before.ground !== 'fungalForest', `Ground ${before.ground} → ${after?.ground}`);
    // Replayed on a fresh world the cells are fungal forest; rubbing off gives the climate's ground back.
    const replay = generateWorld(params);
    applyEdits(replay, stored);
    assert(replay.biome[spot] === Biome.FungalForest, 'Replay');
    const erased = await runBridgeTool('wh_paint_biome', { worldId: Wid, erase: true, points: [{ x, y }, { x: x + 1, y }], radius: 3 });
    const back = generateWorld(params);
    applyEdits(back, deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]'));
    assert(erased.ok && back.biome[spot] === world.biome[spot], `Erase gives back ${world.biome[spot]}, got ${back.biome[spot]}`);
    const audit = (painted.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_paint_biome', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'paint' } });
    assert(undone.ok, `Undo ${JSON.stringify(undone).slice(0, 200)}`);
    return [
      'Fantasy grounds travel as forest, marsh or dry ground and have English leg names',
      `Bridge: wh_paint_biome refuses ocean, an unknown ground, no points, off-grid points and a huge radius; paints fungal forest (wh_place_at reads "${before.ground}" → "fungalForest"), the stroke replays on a fresh world, erase gives the climate's ground back; undo`,
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
