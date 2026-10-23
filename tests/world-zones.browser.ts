import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { deserializeEdits } from '@/engines/worldgen/core/edits';
import { normalizeZone, zoneContains, zoneShape, zonesFrom } from '@/engines/worldgen/core/zones';
import { drawZones } from '@/engines/worldgen/cartography/zoneMarks';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Named zones: the record, the list from edits, across the date line, drawn, and the bridge. */
export async function testWorldZones(): Promise<string[]> {
  const P = 'synthetic-zones', Wid = 'zones-world';
  try {
    const square = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }];
    const z = normalizeZone({ id: 'a', name: '  La Marca  ', pts: square });
    assert(z.name === 'La Marca' && z.pattern === 'wash' && /^#[0-9a-f]{6}$/.test(z.color), `Zone ${JSON.stringify(z)}`);
    for (const bad of [{ id: 'a', name: '', pts: square }, { id: 'a', name: 'x', pts: square.slice(0, 2) }, { id: 'a', name: 'x', pts: square, color: 'red' }, { id: 'a', name: 'x', pts: square, pattern: 'dots' }]) {
      let refused = false; try { normalizeZone(bad); } catch { refused = true; }
      assert(refused, `Refused ${JSON.stringify(bad).slice(0, 60)}`);
    }
    const shape = zoneShape(z, 256);
    assert(Math.abs(shape.cells - 100) < 1e-6 && Math.abs(shape.cx - 15) < 1e-6 && Math.abs(shape.cy - 15) < 1e-6, `Shape ${JSON.stringify(shape)}`);
    // Across the date line: corners either side of x = 0.
    const seam = normalizeZone({ id: 'b', name: 'Seam', pts: [{ x: 250, y: 30 }, { x: 6, y: 30 }, { x: 6, y: 40 }, { x: 250, y: 40 }] });
    const s2 = zoneShape(seam, 256);
    assert(Math.abs(s2.cells - 120) < 1e-6 && (s2.cx > 254 || s2.cx < 2) && zoneContains(seam, 256, 1, 35) && zoneContains(seam, 256, 253, 35) && !zoneContains(seam, 256, 128, 35), `Seam ${JSON.stringify(s2)}`);
    // The list: replaced by id, removed.
    const list = zonesFrom([{ kind: 'zone', ...z }, { kind: 'zone', ...seam }, { kind: 'zone', ...z, name: 'Renamed' }, { kind: 'zoneRemove', id: 'b' }]);
    assert(list.length === 1 && list[0].name === 'Renamed', `List ${JSON.stringify(list)}`);
    const read = deserializeEdits(JSON.stringify({ edits: [{ kind: 'zone', ...z }, { kind: 'zone', id: 'c', name: 'x', pts: [{ x: 1, y: 1 }] }, { kind: 'zoneRemove', id: 'a' }] }));
    assert(read.length === 2, `Kept ${read.length}`);
    // Drawn: ink inside the outline and the name.
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    drawZones(ctx, [{ ...z, pattern: 'hatch' }], 256, (wx) => wx * 10, (wy) => wy * 10, 10);
    const px = ctx.getImageData(0, 0, 300, 300).data;
    let ink = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) ink++;
    assert(ink > 2000, `Drawn ${ink} px`);

    // The bridge.
    const params = { ...DEFAULT_PARAMS, width: 256, seed: 'zones-planet' };
    const world = generateWorld(params);
    await db.projects.put({ id: P, title: 'Zones', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Zones planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), world);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    bad(await runBridgeTool('wh_add_zone', { worldId: Wid, name: 'x', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }), /3 to 400/, 'two corners');
    bad(await runBridgeTool('wh_add_zone', { worldId: Wid, name: 'x', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] }), /enclose no ground/, 'corners in a line');
    bad(await runBridgeTool('wh_add_zone', { worldId: Wid, name: 'x', points: square, color: 'red' }), /color/, 'bad colour');
    const added = await runBridgeTool('wh_add_zone', { worldId: Wid, name: 'Bosque Maldito', points: square, color: '#3d8b5a', pattern: 'hatch' });
    assert(added.ok, `Add ${JSON.stringify(added).slice(0, 200)}`);
    const id = (added.result as { zone: { id: string } }).zone.id;
    const listed = await runBridgeTool('wh_list_zones', { worldId: Wid });
    const row = (listed.result as { zones: { id: string; name: string; areaKm2: number; pattern: string }[] }).zones[0];
    assert(listed.ok && row.id === id && row.name === 'Bosque Maldito' && row.pattern === 'hatch' && row.areaKm2 > 1000, `List ${JSON.stringify(row)}`);
    const updated = await runBridgeTool('wh_update_zone', { worldId: Wid, id, name: 'El Bosque', pattern: 'outline' });
    assert(updated.ok && zonesFrom(deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]'))[0].name === 'El Bosque', 'Update');
    bad(await runBridgeTool('wh_update_zone', { worldId: Wid, id: 'nope', name: 'x' }), /No zone/, 'unknown zone');
    let render: BridgeReply | undefined;
    for (let i = 0; i < 60; i++) { render = await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 400 }); if (!(render.ok && (render.result as { pending?: boolean }).pending)) break; await new Promise((r) => setTimeout(r, 500)); }
    assert(render!.ok && (render!.result as { dataUrl?: string }).dataUrl, 'Render with a zone');
    const removed = await runBridgeTool('wh_remove_zone', { worldId: Wid, id });
    assert(removed.ok && !zonesFrom(deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]')).length, 'Remove');
    const audit = (removed.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_remove_zone', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'zone' } });
    assert(undone.ok && zonesFrom(deserializeEdits((await db.generatedWorlds.get(Wid))!.edits ?? '[]')).length === 1, 'Undo brings it back');
    return [
      'A zone is a name, corners, a colour and a fill (wash by default); empty names, two corners, bad colours and fills are refused; its area and label centre are measured, across the date line too',
      'Zones from the edit list: a later record replaces one by id, zoneRemove takes it off, malformed ones are dropped on reading; drawn as outline, wash or hatching with the name',
      'Bridge: wh_add_zone refuses two corners, corners in a line and a bad colour, draws "Bosque Maldito"; wh_list_zones lists it with its area; wh_update_zone renames and refills it; wh_render_world_map draws it; wh_remove_zone takes it off and undo puts it back',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
