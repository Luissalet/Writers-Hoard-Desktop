import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { deserializeEdits } from '@/engines/worldgen/core/edits';
import { traceSpring } from '@/engines/worldgen/core/spring';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** A river from a spring: the tracer, and the bridge tool with its dry run and undo. */
export async function testSpringRiver(): Promise<string[]> {
  const P = 'synthetic-spring', Wid = 'spring-world';
  try {
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'spring-planet' };
    const world = generateWorld(params);
    const W = world.width, H = world.height, elev = world.elevation;
    // The highest land: water from there always runs somewhere, downhill all the way.
    let top = 0; for (let i = 1; i < elev.length; i++) if (elev[i] > elev[top]) top = i;
    const tx = top % W, ty = (top / W) | 0;
    const run = traceSpring(world, tx + 0.5, ty + 0.5);
    assert(run.end !== 'nowhere' && run.pts.length >= 2, `From the summit: ${JSON.stringify(run).slice(0, 200)}`);
    // Each kept point is lower than or level with the one before it (straight runs are thinned, never reversed).
    const at = (p: { x: number; y: number }) => elev[Math.min(H - 1, Math.floor(p.y)) * W + ((Math.floor(p.x) % W) + W) % W];
    for (let k = 1; k < run.pts.length; k++) assert(at(run.pts[k]) <= at(run.pts[k - 1]) + 1e-9, `Uphill at ${k}`);
    const last = run.pts[run.pts.length - 1];
    if (run.end === 'sea') assert(at(last) <= 0, 'Ends in the sea but on land');
    // Sea: nowhere to run.
    let sea = 0; while (elev[sea] > 0) sea++;
    assert(traceSpring(world, (sea % W) + 0.5, ((sea / W) | 0) + 0.5).end === 'nowhere', 'A spring in the sea ran');
    // The bridge: dry run, add, undo.
    await db.projects.put({ id: P, title: 'Spring', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Spring planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), world);
    const dry = await runBridgeTool('wh_add_spring_river', { worldId: Wid, x: tx, y: ty, dryRun: true });
    assert(dry.ok && (dry.result as { dryRun: boolean; cells: number }).cells === run.cells && deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]').length === 0, `Dry run ${JSON.stringify(dry).slice(0, 300)}`);
    const wet = await runBridgeTool('wh_add_spring_river', { worldId: Wid, x: (sea % W), y: (sea / W) | 0 });
    const wide = await runBridgeTool('wh_add_spring_river', { worldId: Wid, x: tx, y: ty, width: 40 });
    assert(!wet.ok && !wide.ok, 'Refusals');
    const added = await runBridgeTool('wh_add_spring_river', { worldId: Wid, x: tx, y: ty, width: 3 });
    const edits = deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]');
    assert(added.ok && edits.length === 1 && edits[0].kind === 'river' && edits[0].width === 3 && edits[0].pts.length === run.pts.length, `Added ${JSON.stringify(added).slice(0, 300)}`);
    const audit = (added.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_add_spring_river', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'river' } });
    assert(undone.ok && deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]').length === 0, `Undo ${JSON.stringify(undone)}`);
    return [
      `A spring on the highest ground runs downhill all the way (${run.cells} cells, to the ${run.end}); one in the sea goes nowhere`,
      'Bridge: wh_add_spring_river traces with dryRun without writing, refuses the sea and a silly width, adds an ordinary drawn river and undoes it',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
