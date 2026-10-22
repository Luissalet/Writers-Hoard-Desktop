import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { deserializeEdits, serializeEdits } from '@/engines/worldgen/core/edits';
import { tradeSiteEdit, tradeSiteRemoveEdit, normalizeTradeSite } from '@/engines/worldgen/core/economy';
import { PaintSession } from '@/engines/worldgen/core/paintSession';
import { drawAnnotations } from '@/engines/worldgen/cartography/annotations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** The trade lens wired into worlds: its edits, the session, drawing and the bridge. */
export async function testWorldTrade(): Promise<string[]> {
  const P = 'synthetic-world-trade', Wid = 'world-trade-world';
  try {
    // Edits: round-trip, malformed ones cost only themselves, never replay the world.
    const site = normalizeTradeSite({ id: 'site-a', kind: 'mine', x: 5, y: 6, size: 'L', placeId: null });
    const edits = [tradeSiteEdit(site), tradeSiteRemoveEdit('auto:1:farm:0')];
    const back = deserializeEdits(serializeEdits(edits));
    assert(back.length === 2 && back[0].kind === 'tradeSite', 'Trade edits round trip');
    const json = JSON.stringify({ v: 2, edits: [...JSON.parse(serializeEdits(edits)).edits, { kind: 'tradeSite', id: 'x', siteKind: 'gold', x: 1, y: 1, size: 'M', placeId: null }, { kind: 'tradeSiteRemove' }] });
    assert(deserializeEdits(json).length === 2, 'Malformed trade edits were kept');
    const params = { ...DEFAULT_PARAMS, width: 256, seed: 'trade-planet' };
    const generated = generateWorld(params);
    const session = new PaintSession(generateWorld(params));
    session.push(edits[0]);
    assert(session.edits.length === 1, 'Trade edit not recorded');
    // Drawing: sites and a shipment land on the canvas, across the seam too.
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    drawAnnotations(ctx, { trade: { sites: [{ x: 63, y: 10, kind: 'mine', manual: true }], movements: [{ fromX: 60, fromY: 20, toX: 2, toY: 20, bySea: true }] } }, { width: 64, height: 32 } as never, (x) => x * 4, (y) => y * 4, 4);
    const ink = (x0: number, x1: number, y: number) => Array.from(ctx.getImageData(x0, y - 2, x1 - x0, 4).data).filter((v, i) => i % 4 === 3 && v > 0).length;
    assert(ink(250, 256, 42) > 0 && ink(0, 6, 42) > 0, 'Site at the seam not drawn on both sides');
    assert(ink(244, 256, 82) > 0 && ink(0, 12, 82) > 0 && ink(60, 200, 82) === 0, 'A shipment across the seam should take the short way');
    // The bridge.
    await db.projects.put({ id: P, title: 'Trade', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Trade planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), generated);
    const first = await runBridgeTool('wh_world_economy', { worldId: Wid, month: 6 });
    const again = await runBridgeTool('wh_world_economy', { worldId: Wid, month: 6 });
    const r = first.result as { places: number; fedPlaces: number; goods: { good: string; missing: boolean }[]; placesDetail: { name: string }[]; sites: { generated: number; yours: number } };
    assert(first.ok && r.places > 0 && r.goods.length === 8 && r.sites.generated > 0 && JSON.stringify(first.result) === JSON.stringify(again.result), `Economy ${JSON.stringify(first).slice(0, 400)}`);
    const one = await runBridgeTool('wh_world_economy', { worldId: Wid, month: 2, place: r.placesDetail[0].name });
    assert(one.ok && (one.result as { placesDetail: unknown[] }).placesDetail.length === 1, 'place filter');
    const badMonth = await runBridgeTool('wh_world_economy', { worldId: Wid, month: 0 });
    const badKind = await runBridgeTool('wh_add_trade_site', { worldId: Wid, kind: 'gold', x: 3, y: 3 });
    assert(!badMonth.ok && !badKind.ok, 'Bridge accepted bad economy input');
    const listed = await runBridgeTool('wh_list_trade_sites', { worldId: Wid });
    const autoOne = (listed.result as { sites: { id: string; auto: boolean }[] }).sites.find((s) => s.auto)!;
    const added = await runBridgeTool('wh_add_trade_site', { worldId: Wid, kind: 'mine', size: 'L', x: 40, y: 40 });
    const yours = (await runBridgeTool('wh_list_trade_sites', { worldId: Wid, onlyYours: true })).result as { sites: { id: string; kind: string; size: string; place: string | null }[] };
    assert(added.ok && yours.sites.length === 1 && yours.sites[0].kind === 'mine' && yours.sites[0].size === 'L' && yours.sites[0].place, `Add ${JSON.stringify(yours)}`);
    const off = await runBridgeTool('wh_remove_trade_site', { worldId: Wid, id: autoOne.id });
    const gone = await runBridgeTool('wh_remove_trade_site', { worldId: Wid, id: yours.sites[0].id });
    const missing = await runBridgeTool('wh_remove_trade_site', { worldId: Wid, id: 'nope' });
    const after = (await runBridgeTool('wh_list_trade_sites', { worldId: Wid })).result as { sites: { id: string }[] };
    assert(off.ok && gone.ok && !missing.ok && !after.sites.some((s) => s.id === autoOne.id || s.id === yours.sites[0].id), 'Remove');
    const reopened = await runBridgeTool('wh_restore_trade_site', { worldId: Wid, id: autoOne.id });
    const notOff = await runBridgeTool('wh_restore_trade_site', { worldId: Wid, id: autoOne.id });
    const restored = (await runBridgeTool('wh_list_trade_sites', { worldId: Wid })).result as { sites: { id: string }[] };
    assert(reopened.ok && !notOff.ok && restored.sites.some((s) => s.id === autoOne.id) && /^auto:\d+,\d+:/.test(autoOne.id), 'Restore');
    return [
      'Trade site edits round-trip, cost only themselves when malformed and are kept by the painting session',
      'Sites and shipments draw on both sides of the seam, shipments the short way round',
      'Bridge: wh_world_economy is deterministic per month with place detail; wh_add/list/remove/restore_trade_site place, list, switch off and back on sites (ids by settlement cell) with validation',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
