import { db } from '@/db';
import type { Project } from '@/types';
import { Biome, DEFAULT_PARAMS, type WorldData } from '@/engines/worldgen/core/types';
import { applyEdits, deserializeEdits, editKey, serializeEdits, type WorldEdit } from '@/engines/worldgen/core/edits';
import { drawStamp, isStampGlyph, STAMPS } from '@/engines/worldgen/cartography/stampGlyphs';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function flat(width = 64): WorldData {
  const n = width * width / 2;
  return {
    width, height: width / 2, params: { ...DEFAULT_PARAMS, width }, revision: 0,
    elevation: new Float32Array(n).fill(0.1), biome: new Uint8Array(n).fill(Biome.Grassland),
    temperature: new Float32Array(n).fill(18), precipitation: new Float32Array(n).fill(500),
    flow: new Float32Array(n), lake: new Uint8Array(n), ice: new Float32Array(n),
    currentU: new Float32Array(n), currentV: new Float32Array(n), currentSpeed: new Float32Array(n), sst: new Float32Array(n),
    plateId: new Uint8Array(n), boundary: new Float32Array(n), rivers: [], landmarks: [], plateInfo: [],
  } as unknown as WorldData;
}

/** Hand-placed map stamps: replay, drawing, and the bridge. */
export async function testWorldStamps(): Promise<string[]> {
  const P = 'synthetic-world-stamps', W = 'stamps-world';
  const passed: string[] = [];
  try {
    const key = editKey('stamp', 12, 7);
    const edits: WorldEdit[] = [
      { kind: 'stamp', x: 12, y: 7, glyph: 'wizardTower', size: 'L', name: 'Torre de Ébano' },
      { kind: 'move', target: 'stamp', key, x: 30, y: 9 },
      { kind: 'rename', target: 'stamp', key, name: 'Torre Negra' },
      { kind: 'stamp', x: 40, y: 20, glyph: 'inn' },
    ];
    let applied = applyEdits(flat(), edits);
    assert(applied.stamps.length === 2 && applied.stamps[0].key === key && applied.stamps[0].name === 'Torre Negra' && applied.stamps[0].size === 'L' && applied.moves[key]?.x === 30, `Stamp replay: ${JSON.stringify(applied.stamps)}`);
    applied = applyEdits(flat(), [...edits, { kind: 'remove', target: 'stamp', key }]);
    assert(applied.stamps.length === 1 && applied.stamps[0].glyph === 'inn', 'Remove did not hide the stamp');
    applied = applyEdits(flat(), [...edits, { kind: 'eraseMarkers', x: 40, y: 20, radius: 2 }]);
    assert(applied.stamps.every((stamp) => stamp.glyph !== 'inn'), 'The eraser left the stamp');
    assert(deserializeEdits(serializeEdits([...edits, { kind: 'stamp', x: 1 } as never])).length === edits.length, 'A stamp without a glyph must be dropped on reading');
    passed.push('Stamp edits replay with size and name, move, rename, remove and erase like other painted objects; malformed stamps are dropped');

    // Every glyph draws real ink at every size, and restores the context.
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    assert(STAMPS.length === 32 && STAMPS.every((stamp) => isStampGlyph(stamp.id)) && !isStampGlyph('dragon'), 'Stamp catalogue');
    for (const stamp of STAMPS) for (const size of ['S', 'M', 'L'] as const) {
      ctx.clearRect(0, 0, 64, 64); ctx.lineWidth = 7; ctx.globalAlpha = 1;
      drawStamp(ctx, stamp.id, 32, 32, { size, halo: size === 'M' });
      const data = ctx.getImageData(0, 0, 64, 64).data;
      let ink = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 40) ink++;
      assert(ink > 20, `${stamp.id} ${size} drew nothing`);
      assert(ctx.lineWidth === 7, `${stamp.id} leaked context state`);
    }
    passed.push('All 32 stamps draw visible ink at S, M and L, with and without halo, and leave the canvas state as they found it');

    await db.projects.put({ id: P, title: 'Stamps', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'stamps-planet' };
    await db.generatedWorlds.put({ id: W, projectId: P, title: 'Stamp planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(W), paramsKey(params), generateWorld(params));
    const added = await runBridgeTool('wh_add_stamp', { worldId: W, x: 50, y: 30, glyph: 'lighthouse', size: 'S', name: 'Faro del Cabo' });
    assert(added.ok && (added.result as { key: string }).key === 'stamp:50,30', JSON.stringify(added));
    for (const bad of [{ glyph: 'dragon' }, { glyph: 'inn', size: 'XL' }]) {
      const refused = await runBridgeTool('wh_add_stamp', { worldId: W, x: 5, y: 5, ...bad });
      assert(!refused.ok && refused.code === 'bad-args', `Accepted ${JSON.stringify(bad)}`);
    }
    let listed: { ok: boolean; result?: unknown } | null = null;
    for (let i = 0; i < 60; i++) { listed = await runBridgeTool('wh_list_stamps', { worldId: W }); if (listed.ok && !(listed.result as { pending?: boolean }).pending) break; await new Promise((r) => setTimeout(r, 250)); }
    const stamps = (listed!.result as { stamps: { key: string; glyph: string; size: string; name: string | null; x: number }[] }).stamps;
    assert(stamps.length === 1 && stamps[0].glyph === 'lighthouse' && stamps[0].size === 'S' && stamps[0].name === 'Faro del Cabo', `List: ${JSON.stringify(stamps)}`);
    const moved = await runBridgeTool('wh_move_place', { worldId: W, key: 'stamp:50,30', x: 55, y: 31 });
    const renamed = await runBridgeTool('wh_rename_place', { worldId: W, key: 'stamp:50,30', name: 'Faro Viejo' });
    const after = ((await runBridgeTool('wh_list_stamps', { worldId: W })).result as { stamps: { x: number; name: string }[] }).stamps;
    assert(moved.ok && renamed.ok && after[0].x === 55 && after[0].name === 'Faro Viejo', `Move/rename: ${JSON.stringify(after)}`);
    const audit = (added.result as { __audit: { before: unknown; entityId: string; projectId: string } }).__audit;
    const removed = await runBridgeTool('wh_remove_place', { worldId: W, key: 'stamp:50,30' });
    const gone = ((await runBridgeTool('wh_list_stamps', { worldId: W })).result as { stamps: unknown[] }).stamps;
    assert(removed.ok && !gone.length && audit.entityId === W, 'Remove');
    passed.push('Bridge: wh_add_stamp validates glyph and size; wh_list_stamps reports key, size, name and current cell; move, rename and remove work on stamp keys');
    return passed;
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(W));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
