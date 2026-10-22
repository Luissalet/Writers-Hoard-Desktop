import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { deserializeEdits, roadLook, serializeEdits, type WorldEdit } from '@/engines/worldgen/core/edits';
import { drawRoadNetwork, roadDash } from '@/engines/worldgen/cartography/roadOverlay';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Ink pixels of one straight road drawn across a small canvas. */
function inked(road: { major: boolean; width?: number; pattern?: 'solid' | 'dashed' | 'dotted' }): number {
  const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 40;
  const ctx = canvas.getContext('2d')!;
  const W = 64, cells = Array.from({ length: 40 }, (_, i) => 20 * W + 10 + i);
  drawRoadNetwork(ctx, [{ cells, ...road }], { worldWidth: W, worldHeight: 40, toScreen: (u, v) => [(u * W - 10) * 5, (v * 40 - 20) * 5 + 20], width: 240, height: 40, pxPerCell: 5 });
  const px = ctx.getImageData(0, 0, 240, 40).data;
  // The track's own ink (pale), not its dark casing.
  let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 40 && px[i] > 150) n++;
  return n;
}

/** Hand-drawn roads with their own width and pattern: storage, drawing and the bridge tool. */
export async function testWorldRoads(): Promise<string[]> {
  const P = 'synthetic-roads', Wid = 'roads-world';
  try {
    // The class's own dash unless a pattern was chosen.
    assert(roadDash({ major: true }, 4, 2).length === 0 && roadDash({ major: false }, 4, 2).join() === '6.4,4', 'Class dashes');
    assert(roadDash({ major: true, pattern: 'dashed' }, 4, 2).length === 2 && roadDash({ major: false, pattern: 'solid' }, 4, 2).length === 0 && roadDash({ major: false, pattern: 'dotted' }, 4, 2)[0] < 0.01, 'Pattern dashes');
    assert(JSON.stringify(roadLook({ roadWidth: 1 })) === '{}' && JSON.stringify(roadLook({ roadWidth: 2, roadPattern: 'dotted' })) === '{"width":2,"pattern":"dotted"}', 'Only what differs from the class is stored');
    // Storage: a road keeps its width and pattern; a bad one costs only itself, an old one (neither) stays.
    const good: WorldEdit = { kind: 'road', pts: [{ x: 1, y: 1 }, { x: 5, y: 1 }], major: false, width: 2, pattern: 'dotted' };
    const old = { kind: 'road', pts: [{ x: 1, y: 2 }, { x: 5, y: 2 }], major: true };
    const back = deserializeEdits(JSON.stringify([good, old, { ...good, width: 9 }, { ...good, pattern: 'wavy' }]));
    assert(back.length === 2 && JSON.stringify(back[0]) === JSON.stringify(good) && serializeEdits(back).includes('"pattern":"dotted"'), `Round trip ${JSON.stringify(back)}`);
    // Drawing: thicker is more ink, dotted is less than solid, dashed in between.
    const solid = inked({ major: true }), thick = inked({ major: true, width: 3 }), dotted = inked({ major: true, pattern: 'dotted' }), dashed = inked({ major: true, pattern: 'dashed' });
    assert(thick > solid * 1.5 && dotted < dashed && dashed < solid, `Ink solid ${solid}, thick ${thick}, dashed ${dashed}, dotted ${dotted}`);

    // The bridge: route a road between two towns like the Road tool.
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'roads-planet' };
    const world = generateWorld(params);
    await db.projects.put({ id: P, title: 'Roads', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Road planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), world);
    const listed = await runBridgeTool('wh_list_places', { worldId: Wid, kind: 'settlement', limit: 40 });
    const towns = (listed.result as { places: { key: string; name: string }[] }).places;
    assert(listed.ok && towns.length >= 2, `Towns ${JSON.stringify(listed).slice(0, 200)}`);
    let pair: [string, string] | null = null, dryKm = 0;
    for (let i = 0; i < towns.length && !pair; i++) for (let j = i + 1; j < towns.length && !pair; j++) {
      const dry = await runBridgeTool('wh_add_world_road', { worldId: Wid, from: { place: towns[i].key }, to: { place: towns[j].key }, dryRun: true });
      if (dry.ok) { pair = [towns[i].key, towns[j].key]; dryKm = (dry.result as { km: number }).km; }
    }
    assert(pair && dryKm > 0 && deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]').length === 0, 'A dry run between two towns, writing nothing');
    const bad = async (args: Record<string, unknown>, pattern: RegExp, label: string) => { const r = await runBridgeTool('wh_add_world_road', { worldId: Wid, from: { place: pair![0] }, to: { place: pair![1] }, ...args }); assert(!r.ok && pattern.test(r.error ?? ''), `${label}: ${JSON.stringify(r).slice(0, 200)}`); };
    await bad({ width: 5 }, /between 0.5 and 3/, 'wide');
    await bad({ pattern: 'wavy' }, /solid, dashed or dotted/, 'pattern');
    await bad({ major: 'yes' }, /royal road/, 'major');
    await bad({ from: { place: 'settlement:nowhere' } }, /no place/, 'unknown place');
    const before = await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 256 });
    const added = await runBridgeTool('wh_add_world_road', { worldId: Wid, from: { place: pair![0] }, to: { place: pair![1] }, major: true, width: 2.5, pattern: 'dotted' });
    const edits = deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]');
    const road = edits[0] as Extract<WorldEdit, { kind: 'road' }>;
    assert(added.ok && edits.length === 1 && road.kind === 'road' && road.major && road.width === 2.5 && road.pattern === 'dotted' && road.pts.length >= 2, `Added ${JSON.stringify(added).slice(0, 300)}`);
    const after = await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 256 });
    assert(after.ok && (after.result as { dataUrl: string }).dataUrl !== (before.result as { dataUrl: string }).dataUrl, 'The render shows the new road');
    const audit = (added.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_add_world_road', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'road' } });
    assert(undone.ok && deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]').length === 0, `Undo ${JSON.stringify(undone)}`);
    return [
      `Roads keep the class's dash unless a pattern is chosen; only a width other than 1 and a chosen pattern are stored; bad ones are dropped on read, old ones kept; ink: solid ${solid}, ×3 ${thick}, dashed ${dashed}, dotted ${dotted} px`,
      `Bridge: wh_add_world_road routes between two towns (${dryKm} km) with dryRun, refuses a bad width, pattern, class or place, lays a royal road ×2.5 dotted that the render shows, and undoes it`,
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
