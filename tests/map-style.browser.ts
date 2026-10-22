import { db } from '@/db';
import type { MapFeature, Project } from '@/types';
import { exportMapSvg, DEFAULT_MAP_LAYERS, mapItemVisible, withMapLayers } from '@/components/maps/mapGeometry';
import { normalizeMapFeatureStyle, patternTile, reorderFeature, resolvedLabel, resolvedStroke } from '@/components/maps/mapStyle';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Classic map shapes: outline, hatch, lettering, order, pin size, export and the bridge. */
export async function testMapStyle(): Promise<string[]> {
  const P = 'synthetic-map-style', M = 'map-style-map';
  try {
    // Validation: bad colours, ranges, patterns and lettering fields are refused.
    for (const bad of [{ strokeColor: 'red' }, { strokeWidth: 30 }, { pattern: 'zigzag' }, { patternScale: 9 }, { labelStyle: { font: 'comic' } }, { labelStyle: { size: 20 } }, { labelStyle: { spin: 1 } }, { opacity: 2 }]) {
      let refused = false; try { normalizeMapFeatureStyle(bad); } catch { refused = true; }
      assert(refused, `Accepted ${JSON.stringify(bad)}`);
    }
    const ok = normalizeMapFeatureStyle({ strokeColor: '#AA0000', strokeWidth: 4, pattern: 'crosshatch', patternScale: 2, labelStyle: { font: 'script', size: 3, bold: true, rotation: -30 } });
    assert(ok.strokeColor === '#aa0000' && ok.pattern === 'crosshatch' && ok.labelStyle?.font === 'script', `Normalized ${JSON.stringify(ok)}`);
    // Defaults keep the old look.
    const plain: MapFeature = { id: 'a', kind: 'region', name: 'Old', points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 20, y: 30 }], color: '#d5b575' };
    assert(resolvedStroke(plain).color === '#d5b575' && resolvedStroke(plain).width === 2 && resolvedLabel(plain).size === 1.8 && resolvedLabel(plain).family.startsWith('Georgia') && patternTile(plain, 1) === null, 'Defaults changed the old look');
    const oldSvg = exportMapSvg('', 800, 450, [plain], [], DEFAULT_MAP_LAYERS);
    assert(!oldSvg.includes('<defs>') && oldSvg.includes('stroke-width="2"') && oldSvg.includes('font-family="Georgia,serif"'), 'Plain export changed');
    // Styled export: pattern defs, outline, lettering.
    const styled: MapFeature = { ...plain, id: 'b', name: 'Marca', ...ok };
    const svg = exportMapSvg('', 800, 450, [plain, styled], [{ id: 'p', projectId: P, mapId: M, name: 'Faro', icon: 'port', position: { x: 50, y: 50 }, size: 'L' }], DEFAULT_MAP_LAYERS);
    assert(svg.includes('<pattern id="p1"') && svg.includes('patternTransform="rotate(45)"') && svg.includes('fill="url(#p1)"') && svg.includes('stroke="#aa0000" stroke-width="4"'), `Styled shape export: ${svg.slice(0, 600)}`);
    assert(svg.includes('font-weight="700"') && svg.includes('rotate(-30') && svg.includes('Segoe Script') && svg.includes('r="10"'), 'Lettering or pin size missing from export');
    // Order.
    const three = [plain, styled, { ...plain, id: 'c' }];
    assert(reorderFeature(three, 'a', 'front').map((f) => f.id).join() === 'b,c,a' && reorderFeature(three, 'c', 'back').map((f) => f.id).join() === 'c,a,b' && reorderFeature(three, 'b', 'forward').map((f) => f.id).join() === 'a,c,b' && reorderFeature(three, 'a', 'backward').map((f) => f.id).join() === 'a,b,c', 'Reorder');
    // Several layers: shown while any of them is visible; an old single layerId still works.
    const named = [{ id: 'l1', name: 'A', visible: false }, { id: 'l2', name: 'B', visible: true }];
    assert(mapItemVisible({ layerIds: ['l1', 'l2'] }, named) && !mapItemVisible({ layerIds: ['l1'] }, named) && !mapItemVisible({ layerId: 'l1' }, named) && mapItemVisible({ layerId: 'gone' }, named) && mapItemVisible({}, named), 'Multi-layer visibility');
    assert(JSON.stringify(withMapLayers(['l1', 'l2'])) === '{"layerId":"l1","layerIds":["l1","l2"]}' && withMapLayers([]).layerId === undefined, 'withMapLayers');
    // Bridge.
    await db.projects.put({ id: P, title: 'Maps', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['maps'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.worldMaps.put({ id: M, projectId: P, title: 'Costa', features: [plain], createdAt: 1, updatedAt: 1 });
    const bad = await runBridgeTool('wh_add_map_feature', { mapId: M, kind: 'region', name: 'x', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] });
    const badStyle = await runBridgeTool('wh_add_map_feature', { mapId: M, kind: 'path', name: 'x', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], pattern: 'zigzag' });
    assert(!bad.ok && !badStyle.ok, 'Bridge accepted a bad shape');
    const added = await runBridgeTool('wh_add_map_feature', { mapId: M, kind: 'path', name: 'Camino real', points: [{ x: 10, y: 50 }, { x: 90, y: 55 }], strokeColor: '#336699', strokeWidth: 5, labelStyle: { italic: true } });
    assert(added.ok, `Add ${JSON.stringify(added)}`);
    const id = (added.result as { id: string }).id;
    const updated = await runBridgeTool('wh_update_map_feature', { mapId: M, id, order: 'back', labelStyle: { font: 'sans', size: 2.5 } });
    const listed = (await runBridgeTool('wh_list_map_features', { mapId: M })).result as { features: (MapFeature & { order: number })[] };
    const road = listed.features.find((f) => f.id === id)!;
    assert(updated.ok && road.order === 0 && road.strokeWidth === 5 && road.labelStyle?.font === 'sans' && road.labelStyle.size === 2.5 && road.labelStyle.italic === true, `Update ${JSON.stringify(road)}`);
    const audit = (updated.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_update_map_feature', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'shape' } });
    const afterUndo = (await db.worldMaps.get(M))!.features!;
    assert(undone.ok && afterUndo[afterUndo.length - 1].id === id && afterUndo[afterUndo.length - 1].labelStyle?.font === undefined && afterUndo[afterUndo.length - 1].labelStyle?.italic === true, `Undo ${JSON.stringify(undone)}`);
    // An undo of an older change refuses when the shapes have changed since.
    const addAudit = (added.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    await runBridgeTool('wh_update_map_feature', { mapId: M, id, name: 'Camino viejo' });
    const stale = await runBridgeTool('__undo', { entry: { tool: 'wh_add_map_feature', kind: 'update', entityId: addAudit.entityId, projectId: addAudit.projectId, before: addAudit.before, summary: 'shape' } });
    assert(!stale.ok && (await db.worldMaps.get(M))!.features!.some((f) => f.name === 'Camino viejo'), 'A stale undo overwrote later work');
    await db.worldMaps.update(M, { layers: named });
    const layered = await runBridgeTool('wh_update_map_feature', { mapId: M, id, layerIds: ['l1', 'l2'] });
    const missingLayer = await runBridgeTool('wh_update_map_feature', { mapId: M, id, layerIds: ['nope'] });
    const withLayers = (await db.worldMaps.get(M))!.features!.find((f) => f.id === id)!;
    assert(layered.ok && !missingLayer.ok && withLayers.layerId === 'l1' && withLayers.layerIds?.join() === 'l1,l2', `Layers ${JSON.stringify(withLayers)}`);
    const pinAdded = await runBridgeTool('wh_add_map_pin', { mapId: M, name: 'Faro', size: 'L', hideIcon: true });
    const badPin = await runBridgeTool('wh_add_map_pin', { mapId: M, name: 'X', size: 'XL' });
    const pin = await db.mapPins.get((pinAdded.result as { id: string }).id);
    assert(pinAdded.ok && !badPin.ok && pin?.size === 'L' && pin.hideIcon === true, 'Pin size and icon');
    return [
      'Outline, hatch and lettering validate; absent fields keep the old look in the editor rules and the SVG export',
      'Styled shapes export their pattern, outline, lettering and pin size; shapes reorder front/forward/backward/back',
      'Several named layers per shape (shown while any is visible; old single layer kept)',
      'Bridge: wh_add/update/list_map_features with style, order and layers; undo restores and refuses over later changes; pins take size and hideIcon',
    ];
  } finally {
    await db.mapPins.where('mapId').equals(M).delete();
    await db.worldMaps.delete(M);
    await db.projects.delete(P);
  }
}
