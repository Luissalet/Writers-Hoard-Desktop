import { db } from '@/db';
import type { MapFeature, MapPin, Project } from '@/types';
import { groundCounts, groundFit, loadImageSize, remapMapContent, remapPoint } from '@/components/maps/mapGround';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

/** A real PNG of the given pixel size, as a data URL. */
function png(width: number, height: number, color = '#446655'): string {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, width, height);
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, Math.max(1, width / 10), Math.max(1, height / 10));
  return canvas.toDataURL('image/png');
}

/** Changing a classic map's ground image: shape comparison, remap, safety era, bridge, undo, persistence. */
export async function testMapGround(): Promise<string[]> {
  const P = 'synthetic-map-ground', Q = 'synthetic-map-ground-off', M = 'map-ground-map', E = 'map-ground-empty', G = 'map-ground-gallery', OTHER = 'map-ground-foreign';
  try {
    // --- Pure helpers
    assert(groundFit({ width: 2000, height: 1000 }, { width: 1000, height: 1000 }).sameShape === false, '2:1 → 1:1 is a different shape');
    assert(groundFit({ width: 1000, height: 500 }, { width: 1010, height: 500 }).sameShape === true, '1% apart is the same shape');
    assert(groundFit({ width: 1000, height: 500 }, { width: 1050, height: 500 }).sameShape === false, '5% apart is a different shape');
    const ratios = groundFit({ width: 1400, height: 800 }, { width: 1000, height: 1000 });
    assert(near(ratios.oldRatio, 1.75) && near(ratios.newRatio, 1), 'Ratios');
    for (const bad of [{ width: 0, height: 10 }, { width: 10, height: -1 }, { width: NaN, height: 10 }]) {
      let refused = false; try { groundFit(bad, { width: 10, height: 10 }); } catch { refused = true; }
      assert(refused, `Accepted size ${JSON.stringify(bad)}`);
    }
    const wide = { width: 2000, height: 1000 }, square = { width: 1000, height: 1000 }, tall = { width: 500, height: 1000 };
    const a = { x: 10, y: 20 }, b = { x: 70, y: 60 };
    assert(remapPoint(a, wide, square, 'stretch') === a, 'Stretch returns the point unchanged');
    const corner = remapPoint({ x: 0, y: 0 }, wide, square, 'keep'), far = remapPoint({ x: 100, y: 100 }, wide, square, 'keep'), mid = remapPoint({ x: 50, y: 50 }, wide, square, 'keep');
    assert(corner.x === 0 && corner.y === 25 && far.x === 100 && far.y === 75 && mid.x === 50 && mid.y === 50, `Keep 2:1 → 1:1: ${JSON.stringify([corner, mid, far])}`);
    const sideways = remapPoint({ x: 0, y: 0 }, square, { width: 2000, height: 1000 }, 'keep');
    assert(sideways.x === 25 && sideways.y === 0, `Keep 1:1 → 2:1: ${JSON.stringify(sideways)}`);
    // Round trip: the pixel distance between two places shrinks by the same factor on both axes (s = 0.5).
    const px = (p: { x: number; y: number }, q: { x: number; y: number }, size: { width: number; height: number }) => Math.hypot((q.x - p.x) * size.width / 100, (q.y - p.y) * size.height / 100);
    const before = px(a, b, wide), after = px(remapPoint(a, wide, square, 'keep'), remapPoint(b, wide, square, 'keep'), square);
    assert(near(after / before, 0.5, 0.001), `Distances proportional: ${after} / ${before}`);
    const dx = (remapPoint(b, wide, square, 'keep').x - remapPoint(a, wide, square, 'keep').x) * square.width / 100, dy = (remapPoint(b, wide, square, 'keep').y - remapPoint(a, wide, square, 'keep').y) * square.height / 100;
    assert(near(dx / dy, ((b.x - a.x) * wide.width / 100) / ((b.y - a.y) * wide.height / 100), 0.001), 'Direction (angle) of the segment is kept');
    // A tall image: the old picture fills the width and is centred vertically.
    const tallPoint = remapPoint({ x: 100, y: 100 }, wide, tall, 'keep');
    assert(tallPoint.x === 100 && near(tallPoint.y, 62.5), `Keep 2:1 → 1:2: ${JSON.stringify(tallPoint)}`);

    const features: MapFeature[] = [
      { id: 'r', kind: 'region', name: 'Marca', points: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 60 }], color: '#d5b575' },
      { id: 'p', kind: 'path', name: 'Camino', points: [{ x: 10, y: 20 }, { x: 70, y: 60 }], color: '#e4a853' },
      { id: 'l', kind: 'label', name: 'Mar', points: [{ x: 50, y: 50 }], color: '#ffffff', labelStyle: { size: 2, bold: true } },
      { id: 'l2', kind: 'label', name: 'Sin tamaño', points: [{ x: 5, y: 5 }], color: '#ffffff' },
    ];
    const pins = [{ id: 'a', position: { x: 10, y: 20 } }, { id: 'b', position: { x: 70, y: 60 } }];
    const snapshot = JSON.stringify([features, pins]);
    const moved = remapMapContent({ features, pins }, wide, square, 'keep');
    assert(JSON.stringify([features, pins]) === snapshot && moved.features !== features && moved.pins !== pins, 'Inputs were mutated or returned as is');
    assert(moved.pins[1].position.x === 70 && near(moved.pins[1].position.y, 55), `Pin remapped: ${JSON.stringify(moved.pins)}`);
    assert(near(moved.features[0].points[1].x, 40) && near(moved.features[0].points[1].y, 35), 'Region point remapped');
    // Lettering is in percent of the width: 2:1 → 1:1 keeps the full width (size unchanged); 1:1 → 2:1 puts the picture in half of it (size halves).
    assert(moved.features[2].labelStyle!.size === 2 && moved.features[2].labelStyle!.bold === true && moved.features[3].labelStyle === undefined, `Lettering when the width is kept: ${JSON.stringify(moved.features[2].labelStyle)}`);
    const widened = remapMapContent({ features, pins }, square, wide, 'keep').features[2].labelStyle!;
    assert(widened.size === 1 && widened.bold === true, `Lettering follows the picture: ${JSON.stringify(widened)}`);
    const same = remapMapContent({ features, pins }, wide, square, 'stretch');
    assert(JSON.stringify([same.features, same.pins]) === snapshot, 'Stretch leaves everything where it is');
    const counts = groundCounts(features, pins);
    assert(counts.places === 2 && counts.zones === 1 && counts.paths === 1 && counts.names === 2, `Counts ${JSON.stringify(counts)}`);

    // --- Image decoding
    const size = await loadImageSize(png(120, 60));
    assert(size.width === 120 && size.height === 60, `Decoded size ${JSON.stringify(size)}`);
    let undecodable = false; try { await loadImageSize('data:image/png;base64,AAAA'); } catch { undecodable = true; }
    let empty = false; try { await loadImageSize(''); } catch { empty = true; }
    assert(undecodable && empty, 'A broken or empty image must reject');

    // --- Bridge
    const oldImage = png(200, 100, '#334455'), squareImage = png(100, 100, '#665544'), nearlySame = png(202, 100, '#556677');
    await db.projects.put({ id: P, title: 'Ground', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['maps'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.projects.put({ id: Q, title: 'Off', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const mapFeatures: MapFeature[] = features.map(feature => ({ ...feature }));
    await db.worldMaps.put({ id: M, projectId: P, title: 'Costa', backgroundImage: oldImage, source: 'gallery', features: mapFeatures, createdAt: 1, updatedAt: 1 });
    const pinRows: MapPin[] = [
      { id: 'g-pin-a', projectId: P, mapId: M, name: 'Faro', icon: 'port', position: { x: 10, y: 20 } },
      { id: 'g-pin-b', projectId: P, mapId: M, name: 'Torre', icon: 'castle', position: { x: 70, y: 60 } },
    ];
    await db.mapPins.bulkPut(pinRows);
    const reset = async () => { await db.worldMaps.update(M, { backgroundImage: oldImage, source: 'gallery', features: mapFeatures.map(feature => ({ ...feature })), versions: [] }); await db.mapPins.bulkPut(pinRows.map(pin => ({ ...pin, position: { ...pin.position } }))); };

    const preview = await runBridgeTool('wh_preview_map_ground', { mapId: M, imageDataUrl: squareImage });
    const p = preview.result as { oldSize: { width: number; height: number }; newSize: { width: number; height: number }; sameShape: boolean; counts: { places: number; zones: number; paths: number; names: number }; suggestedFit: string };
    assert(preview.ok && p.oldSize.width === 200 && p.newSize.width === 100 && p.sameShape === false && p.counts.places === 2 && p.counts.zones === 1 && p.counts.paths === 1 && p.counts.names === 2 && p.suggestedFit === 'keep', `Preview ${JSON.stringify(preview)}`);
    assert((await db.worldMaps.get(M))!.backgroundImage === oldImage && (await db.worldMaps.get(M))!.versions === undefined, 'Preview changed the map');
    const previewSame = await runBridgeTool('wh_preview_map_ground', { mapId: M, imageDataUrl: nearlySame });
    assert(previewSame.ok && (previewSame.result as { sameShape: boolean }).sameShape === true, 'Preview: 1% apart is the same shape');

    // Bad calls change nothing.
    const noImage = await runBridgeTool('wh_change_map_ground', { mapId: M });
    const both = await runBridgeTool('wh_change_map_ground', { mapId: M, imageDataUrl: squareImage, galleryAssetId: 'x' });
    const notImage = await runBridgeTool('wh_change_map_ground', { mapId: M, imageDataUrl: 'data:text/plain;base64,AAAA' });
    const broken = await runBridgeTool('wh_change_map_ground', { mapId: M, imageDataUrl: 'data:image/png;base64,AAAA' });
    const badFit = await runBridgeTool('wh_change_map_ground', { mapId: M, imageDataUrl: squareImage, fit: 'zoom' });
    const noMap = await runBridgeTool('wh_change_map_ground', { mapId: 'nope', imageDataUrl: squareImage });
    assert(!noImage.ok && !both.ok && !notImage.ok && !broken.ok && !badFit.ok && !noMap.ok, `Accepted a bad call ${JSON.stringify([noImage, both, notImage, broken, badFit, noMap].map(r => r.ok))}`);
    assert((await db.worldMaps.get(M))!.backgroundImage === oldImage, 'A refused call changed the image');
    await db.worldMaps.put({ id: 'map-ground-off', projectId: Q, title: 'Off', backgroundImage: oldImage, createdAt: 1, updatedAt: 1 });
    const disabled = await runBridgeTool('wh_change_map_ground', { mapId: 'map-ground-off', imageDataUrl: squareImage });
    assert(!disabled.ok && (await db.worldMaps.get('map-ground-off'))!.backgroundImage === oldImage, 'Wrote into a project with maps switched off');

    // A comment left at the same spot as pin B moves with it, and comes back on undo.
    await db.annotations.put({ id: 'g-note', projectId: P, sourceEngineId: 'maps', sourceEntityId: M, anchor: { type: 'map_point', x: 70, y: 60 }, noteType: 'text', noteBody: 'Vado', isOrphaned: false, position: 0, createdAt: 1, updatedAt: 1 });
    // Keep (default): era saved first, then image, shapes and pins move.
    const changed = await runBridgeTool('wh_change_map_ground', { mapId: M, imageDataUrl: squareImage });
    const c = changed.result as { remapped: boolean; fit: string; versionId: string; moved: { places: number } };
    assert(changed.ok && c.remapped && c.fit === 'keep' && c.moved.places === 2, `Change ${JSON.stringify(changed)}`);
    const readBack = async () => {
      // Reopen the database so nothing is served from memory.
      db.close(); await db.open();
      return { map: (await db.worldMaps.get(M))!, pins: await db.mapPins.where('mapId').equals(M).toArray() };
    };
    let state = await readBack();
    assert(state.map.backgroundImage === squareImage && state.map.source === 'uploaded', 'Image and source after reopening');
    assert(state.map.versions?.length === 1 && state.map.versions[0].name === 'Before changing the ground image' && state.map.versions[0].backgroundImage === oldImage && state.map.versions[0].id === c.versionId, `Safety era ${JSON.stringify(state.map.versions?.map(v => v.name))}`);
    assert(state.map.versions[0].pins.find(pin => pin.id === 'g-pin-b')!.position.y === 60 && state.map.versions[0].features.find(f => f.id === 'p')!.points[1].y === 60, 'The era keeps the old coordinates');
    const pinB = state.pins.find(pin => pin.id === 'g-pin-b')!, road = state.map.features!.find(f => f.id === 'p')!;
    assert(pinB.position.x === 70 && near(pinB.position.y, 55) && near(road.points[1].y, 55) && near(road.points[0].y, 35), `Remapped after reopening: ${JSON.stringify([pinB.position, road.points])}`);
    const movedNote = (await db.annotations.get('g-note'))!.anchor;
    assert(movedNote.x === pinB.position.x && movedNote.y === pinB.position.y, `Comment moved with the picture: ${JSON.stringify(movedNote)}`);
    assert(state.map.features!.find(f => f.id === 'l')!.labelStyle!.size === 2, 'Lettering size (percent of width) is kept when the picture keeps the full width');

    // Undo restores everything and removes the era.
    const audit = (changed.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_change_map_ground', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'ground' } });
    state = await readBack();
    assert(undone.ok && state.map.backgroundImage === oldImage && !state.map.versions?.length && state.map.source === 'gallery', `Undo ${JSON.stringify(undone)}`);
    assert(JSON.stringify(state.map.features) === JSON.stringify(mapFeatures) && state.pins.find(pin => pin.id === 'g-pin-b')!.position.y === 60 && state.pins.find(pin => pin.id === 'g-pin-a')!.position.x === 10, 'Undo put shapes and pins back');
    const backNote = (await db.annotations.get('g-note'))!.anchor;
    assert(backNote.x === 70 && backNote.y === 60, `Undo put the comment back: ${JSON.stringify(backNote)}`);

    // An undo refuses once pins, shapes or the image changed since.
    const again = await runBridgeTool('wh_change_map_ground', { mapId: M, imageDataUrl: squareImage, fit: 'keep' });
    const againAudit = (again.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    await runBridgeTool('wh_update_map_pin', { id: 'g-pin-a', x: 12, y: 12 });
    const stale = await runBridgeTool('__undo', { entry: { tool: 'wh_change_map_ground', kind: 'update', entityId: againAudit.entityId, projectId: againAudit.projectId, before: againAudit.before, summary: 'ground' } });
    state = await readBack();
    assert(!stale.ok && state.map.backgroundImage === squareImage && state.pins.find(pin => pin.id === 'g-pin-a')!.position.x === 12 && state.map.versions?.length === 1, 'A stale undo overwrote later work');

    // A comment placed on the new picture after the change stops the undo; a renamed safety era survives one.
    await reset();
    const third = await runBridgeTool('wh_change_map_ground', { mapId: M, imageDataUrl: squareImage, fit: 'keep' });
    const thirdAudit = (third.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    await db.annotations.put({ id: 'g-note-late', projectId: P, sourceEngineId: 'maps', sourceEntityId: M, anchor: { type: 'map_point', x: 50, y: 50 }, noteType: 'text', noteBody: 'Nuevo', isOrphaned: false, position: 1, createdAt: Date.now() + 1, updatedAt: Date.now() + 1 });
    const blocked = await runBridgeTool('__undo', { entry: { tool: 'wh_change_map_ground', kind: 'update', entityId: thirdAudit.entityId, projectId: thirdAudit.projectId, before: thirdAudit.before, summary: 'ground' } });
    assert(!blocked.ok && (await db.worldMaps.get(M))!.backgroundImage === squareImage, 'Undo moved the picture under a comment placed after the change');
    await db.annotations.delete('g-note-late');
    const kept = (await db.worldMaps.get(M))!;
    await db.worldMaps.update(M, { versions: kept.versions!.map((version) => ({ ...version, name: 'Mi copia' })) });
    const renamedUndo = await runBridgeTool('__undo', { entry: { tool: 'wh_change_map_ground', kind: 'update', entityId: thirdAudit.entityId, projectId: thirdAudit.projectId, before: thirdAudit.before, summary: 'ground' } });
    const afterRenamed = (await db.worldMaps.get(M))!;
    assert(renamedUndo.ok && afterRenamed.backgroundImage === oldImage && afterRenamed.versions?.some((version) => version.name === 'Mi copia'), `Renamed era on undo ${JSON.stringify(renamedUndo)}`);

    // Stretch: coordinates untouched, era still saved. A nearly identical shape never moves anything.
    await reset();
    const stretched = await runBridgeTool('wh_change_map_ground', { mapId: M, imageDataUrl: squareImage, fit: 'stretch' });
    state = await readBack();
    assert(stretched.ok && (stretched.result as { remapped: boolean }).remapped === false && state.map.backgroundImage === squareImage && state.map.versions?.length === 1 && state.pins.find(pin => pin.id === 'g-pin-b')!.position.y === 60 && state.map.features!.find(f => f.id === 'p')!.points[1].y === 60, 'Stretch moved something');
    await reset();
    const same2 = await runBridgeTool('wh_change_map_ground', { mapId: M, imageDataUrl: nearlySame, fit: 'keep' });
    state = await readBack();
    assert(same2.ok && (same2.result as { remapped: boolean; sameShape: boolean }).remapped === false && (same2.result as { sameShape: boolean }).sameShape === true && state.pins.find(pin => pin.id === 'g-pin-b')!.position.y === 60 && state.map.backgroundImage === nearlySame, 'Same-shape image moved shapes');

    // Gallery image of this project, and one from another project.
    await db.inspirationImages.put({ id: G, projectId: P, imageData: squareImage, tags: [], notes: '', createdAt: 1 });
    await db.inspirationImages.put({ id: OTHER, projectId: Q, imageData: squareImage, tags: [], notes: '', createdAt: 1 });
    await reset();
    const foreign = await runBridgeTool('wh_change_map_ground', { mapId: M, galleryAssetId: OTHER });
    const fromGallery = await runBridgeTool('wh_change_map_ground', { mapId: M, galleryAssetId: G, fit: 'keep' });
    state = await readBack();
    assert(!foreign.ok && fromGallery.ok && state.map.backgroundImage === squareImage && near(state.pins.find(pin => pin.id === 'g-pin-b')!.position.y, 55), 'Gallery image');

    // A map with no image yet: set directly, no era; undo clears it again.
    await db.worldMaps.put({ id: E, projectId: P, title: 'Vacío', createdAt: 1, updatedAt: 1 });
    const first = await runBridgeTool('wh_change_map_ground', { mapId: E, imageDataUrl: oldImage });
    const firstAudit = (first.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    let empty2 = (await db.worldMaps.get(E))!;
    assert(first.ok && empty2.backgroundImage === oldImage && !empty2.versions?.length && (first.result as { versionId: unknown }).versionId === null, 'First image');
    const firstUndo = await runBridgeTool('__undo', { entry: { tool: 'wh_change_map_ground', kind: 'update', entityId: firstAudit.entityId, projectId: firstAudit.projectId, before: firstAudit.before, summary: 'ground' } });
    empty2 = (await db.worldMaps.get(E))!;
    assert(firstUndo.ok && !empty2.backgroundImage, 'Undo of a first image');

    return [
      'Shape check (2% tolerance), keep/stretch remap, centred layout, lettering size and counts are exact; inputs are never mutated; broken images reject',
      'Keep 2:1 → 1:1 maps (0,0)→(0,25) and (100,100)→(100,75); distances between places shrink by the same factor on both axes and segment angles are preserved',
      'Bridge: wh_preview_map_ground reports sizes, shape and counts without writing; wh_change_map_ground refuses missing/duplicate/undecodable images, bad fit and maps switched off',
      'wh_change_map_ground (keep) saves the era "Before changing the ground image" with the old image and coordinates, then moves shapes, pins and comments left at a spot; re-read after reopening the database',
      'Undo restores image, source, shapes and pin positions and removes the era (kept if the author renamed it); refuses when a pin changed or a comment was placed on the new picture after the edit',
      'Stretch and a nearly identical shape leave coordinates alone; gallery images work for their own project only; a map without image is set directly and undone cleanly',
    ];
  } finally {
    await db.annotations.bulkDelete(['g-note', 'g-note-late']);
    await db.mapPins.where('mapId').anyOf([M, E]).delete();
    await db.worldMaps.bulkDelete([M, E, 'map-ground-off']);
    await db.inspirationImages.bulkDelete([G, OTHER]);
    await db.projects.bulkDelete([P, Q]);
  }
}
