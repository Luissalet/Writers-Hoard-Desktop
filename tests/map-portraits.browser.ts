import { db } from '@/db';
import type { Project, WorldMap, MapPin } from '@/types';
import { DEFAULT_MAP_LAYERS, exportMapSvg } from '@/components/maps/mapGeometry';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Portrait pins: the layer defaults, the SVG export, and wh_set_map_layers with its undo. */
export async function testMapPortraits(): Promise<string[]> {
  const P = 'synthetic-map-portraits', M = 'map-portraits';
  try {
    assert(DEFAULT_MAP_LAYERS.portraits === true && DEFAULT_MAP_LAYERS.names === false, `Defaults ${JSON.stringify(DEFAULT_MAP_LAYERS)}`);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#c33'; ctx.fillRect(0, 0, 8, 8);
    const picture = canvas.toDataURL('image/png');
    const pins: MapPin[] = [
      { id: 'a', projectId: P, mapId: M, name: 'Torre <Alta>', icon: 'castle', color: '#4a7ec4', position: { x: 40, y: 50 }, linkedEntryId: 'e' },
      { id: 'b', projectId: P, mapId: M, name: 'Vado', icon: 'city', position: { x: 60, y: 50 } },
    ];
    const background = picture;
    const withPortrait = exportMapSvg(background, 800, 400, [], pins, DEFAULT_MAP_LAYERS, [], undefined, { a: picture });
    const images = withPortrait.match(/<image /g)?.length ?? 0;
    assert(images === 2 && withPortrait.includes('clip-path="url(#pp0)"') && withPortrait.includes('stroke="#4a7ec4"') && withPortrait.includes('Torre &lt;Alta&gt;') && withPortrait.includes('<circle'), `Export with a portrait: ${withPortrait.slice(0, 400)}`);
    const off = exportMapSvg(background, 800, 400, [], pins, { ...DEFAULT_MAP_LAYERS, portraits: false }, [], undefined, { a: picture });
    assert((off.match(/<image /g)?.length ?? 0) === 1 && (off.match(/<circle/g)?.length ?? 0) === 2, 'Portraits off: both pins are dots');
    const remote = exportMapSvg(background, 800, 400, [], pins, DEFAULT_MAP_LAYERS, [], undefined, { a: 'https://example.invalid/x.png' });
    assert((remote.match(/<image /g)?.length ?? 0) === 1, 'A remote picture is never written into the export');

    await db.projects.put({ id: P, title: 'Portraits', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['maps'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.worldMaps.put({ id: M, projectId: P, title: 'Portrait map', createdAt: 1, updatedAt: 1 } satisfies WorldMap);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    bad(await runBridgeTool('wh_set_map_layers', { mapId: M }), /Nothing to change|portraits/, 'nothing given');
    bad(await runBridgeTool('wh_set_map_layers', { mapId: M, names: 'yes' }), /names/, 'not a boolean');
    bad(await runBridgeTool('wh_set_map_layers', { mapId: M, pins: true, portraits: true }), /Nothing to change/, 'already so');
    bad(await runBridgeTool('wh_set_map_layers', { mapId: M, names: true, colour: 'red' }), /colour/, 'unknown field');
    // The era arguments the manifest adds (projectId with eraId) are accepted.
    const set = await runBridgeTool('wh_set_map_layers', { mapId: M, projectId: P, names: true, portraits: false });
    const stored = (await db.worldMaps.get(M))!.layerVisibility;
    assert(set.ok && stored?.names === true && stored.portraits === false && stored.pins === true, `Set ${JSON.stringify(set).slice(0, 200)} / ${JSON.stringify(stored)}`);
    const audit = (set.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_set_map_layers', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'layers' } });
    assert(undone.ok && (await db.worldMaps.get(M))!.layerVisibility === undefined, `Undo ${JSON.stringify(undone).slice(0, 200)}`);
    // A later change is not undone over.
    const again = await runBridgeTool('wh_set_map_layers', { mapId: M, names: true });
    await runBridgeTool('wh_set_map_layers', { mapId: M, label: false });
    const a2 = (again.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const refused = await runBridgeTool('__undo', { entry: { tool: 'wh_set_map_layers', kind: 'update', entityId: a2.entityId, projectId: a2.projectId, before: a2.before, summary: 'layers' } });
    assert(!refused.ok && (await db.worldMaps.get(M))!.layerVisibility?.label === false, `Undo over a later change: ${JSON.stringify(refused).slice(0, 200)}`);
    return [
      'Layers: portraits on and names off by default',
      'SVG export: a pin with a portrait is the picture clipped to a frame in its colour with its name (escaped); portraits off gives dots; a picture that is not embedded data is never written in',
      'Bridge: wh_set_map_layers refuses nothing-to-change (nothing given, or the map already so), an unknown field and a non-boolean, accepts projectId, saves names on and portraits off over the defaults, undo puts the map back, and an undo after a later change is refused',
    ];
  } finally {
    await db.worldMaps.delete(M);
    await db.projects.delete(P);
  }
}
