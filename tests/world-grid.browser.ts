import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { drawMapGrid, normalizeMapGrid } from '@/engines/worldgen/cartography/mapGrid';
import { resolvePresentation, revertWorldPresentation, saveWorldPresentation } from '@/engines/worldgen/presentation';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** The square/hex play grid: validation, drawing, saved look, undo and the bridge. */
export async function testWorldGrid(): Promise<string[]> {
  const P = 'synthetic-world-grid', W = 'grid-world';
  try {
    for (const bad of [{ kind: 'tri', km: 10 }, { kind: 'hex', km: 0 }, { kind: 'square', km: 5000 }, 'hex', { kind: 'hex' }]) {
      let refused = false; try { normalizeMapGrid(bad); } catch { refused = true; }
      assert(refused, `Accepted grid ${JSON.stringify(bad)}`);
    }
    assert(normalizeMapGrid(null) === null && normalizeMapGrid({ kind: 'hex', km: 150.123 })?.km === 150.12, 'Grid normalisation');
    // Drawing: lines where squares fall, nothing when cells would be under 6 px.
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    const ink = () => { const d = ctx.getImageData(0, 0, 200, 100).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; };
    assert(drawMapGrid(ctx, { kind: 'square', km: 100 }, { width: 200, height: 100, cellPx: 1, originX: 0, originY: 0, kmPerCell: 10, alpha: 1 }) && ink() > 300, 'Square grid drew nothing');
    ctx.clearRect(0, 0, 200, 100);
    assert(drawMapGrid(ctx, { kind: 'hex', km: 100 }, { width: 200, height: 100, cellPx: 1, originX: 0, originY: 0, kmPerCell: 10, alpha: 1 }) && ink() > 300, 'Hex grid drew nothing');
    ctx.clearRect(0, 0, 200, 100);
    assert(!drawMapGrid(ctx, { kind: 'square', km: 10 }, { width: 200, height: 100, cellPx: 1, originX: 0, originY: 0, kmPerCell: 10 }) && ink() === 0, 'A grid finer than 6 px should not draw');
    // Saved with the look; undo puts back only the grid.
    await db.projects.put({ id: P, title: 'Grid', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'grid-planet' };
    await db.generatedWorlds.put({ id: W, projectId: P, title: 'Grid planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    assert(resolvePresentation(undefined).grid === null, 'Legacy worlds have no grid');
    const receipt = await saveWorldPresentation({ projectId: P }, W, { grid: { kind: 'hex', km: 300 } });
    await saveWorldPresentation({ projectId: P }, W, { theme: 'antique' });
    await revertWorldPresentation({ projectId: P }, W, receipt);
    const row = (await db.generatedWorlds.get(W))!;
    assert(!row.presentation?.grid && row.presentation?.theme === 'antique', `Grid undo: ${JSON.stringify(row.presentation)}`);
    // Bridge: set, read, render differs, remove with null.
    await saveSnapshot(worldRuntimeKey(W), paramsKey(params), generateWorld(params));
    const bad = await runBridgeTool('wh_set_world_presentation', { worldId: W, grid: { kind: 'hex', km: 0 } });
    assert(!bad.ok && bad.code === 'bad-args', 'Bridge accepted a zero-km grid');
    const plain = await runBridgeTool('wh_render_world_map', { worldId: W, width: 512 });
    const set = await runBridgeTool('wh_set_world_presentation', { worldId: W, grid: { kind: 'square', km: 1500 } });
    const read = await runBridgeTool('wh_get_world_presentation', { worldId: W });
    assert(set.ok && (read.result as { effective: { grid: { kind: string; km: number } } }).effective.grid.km === 1500, `Bridge grid: ${JSON.stringify(read)}`);
    const gridded = await runBridgeTool('wh_render_world_map', { worldId: W, width: 512 });
    assert(plain.ok && gridded.ok && (plain.result as { dataUrl: string }).dataUrl !== (gridded.result as { dataUrl: string }).dataUrl, 'Render ignored the grid');
    const off = await runBridgeTool('wh_set_world_presentation', { worldId: W, grid: null });
    assert(off.ok && resolvePresentation((await db.generatedWorlds.get(W))!.presentation).grid === null, 'grid: null did not remove it');
    return [
      'Grids validate kind and size, draw squares and hexes, and skip cells under 6 px',
      'The grid is saved with the world\'s look; undo puts back only the grid',
      'Bridge: wh_set_world_presentation sets and removes a grid, refuses bad sizes; wh_render_world_map draws it',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(W));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
