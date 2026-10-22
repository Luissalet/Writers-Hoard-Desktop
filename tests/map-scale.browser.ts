import { db } from '@/db';
import type { MapFeature, MapPin, Project } from '@/types';
import { areaKm2, distanceKm, lineLengthKm, matchMapKey, parseMapKey, pinKey, pictureAspect, validWidthKm, widthFromKnownDistance } from '@/components/maps/mapScale';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

/** A real PNG of the given pixel size, as a data URL. */
function png(width: number, height: number): string {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!; context.fillStyle = '#446655'; context.fillRect(0, 0, width, height);
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, Math.max(1, width / 10), Math.max(1, height / 10));
  return canvas.toDataURL('image/png');
}

type Audit = { entityId: string; projectId: string; before: unknown };
const audit = (reply: BridgeReply): Audit => (reply.result as { __audit: Audit }).__audit;
const undo = (tool: string, reply: BridgeReply) => { const a = audit(reply); return runBridgeTool('__undo', { entry: { tool, kind: 'update', entityId: a.entityId, projectId: a.projectId, before: a.before, summary: 'x' } }); };
const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: expected a refusal matching ${pattern}, got ${JSON.stringify(reply).slice(0, 300)}`);

/** Classic map scale: pure measuring and key helpers, then every bridge tool with its refusals and undo. */
export async function testMapScale(): Promise<string[]> {
  const P = 'synthetic-map-scale', Q = 'synthetic-map-scale-off', M = 'map-scale-main', N = 'map-scale-noimage', U = 'map-scale-unscaled', X = 'map-scale-off';
  try {
    // --- Pure helpers, exact numbers.
    assert(pictureAspect(400, 200) === 0.5 && pictureAspect(0, 10) === 1, 'pictureAspect');
    assert(validWidthKm(0.01) && validWidthKm(40000) && validWidthKm(100) && !validWidthKm(0.009) && !validWidthKm(40001) && !validWidthKm(NaN) && !validWidthKm('5') && !validWidthKm(Infinity), 'validWidthKm range');
    assert(near(distanceKm({ x: 10, y: 50 }, { x: 60, y: 50 }, 100, 0.5), 50), 'A horizontal 50% line on a 100 km, 2:1 picture is 50 km');
    assert(near(distanceKm({ x: 50, y: 10 }, { x: 50, y: 60 }, 100, 0.5), 25), 'A vertical 50% line is 25 km');
    assert(near(lineLengthKm([{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }], 100, 0.5), 15) && near(lineLengthKm([{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }], 100, 0.5, true), 30), 'Open and closed line lengths');
    const square = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }];
    assert(near(areaKm2(square, 100, 0.5), 50) && areaKm2(square.slice(0, 2), 100, 0.5) === 0, 'A 10x10 % square is 10 km x 5 km = 50 km2');
    assert(near(widthFromKnownDistance({ x: 0, y: 50 }, { x: 50, y: 50 }, 50, 0.5), 100) && near(widthFromKnownDistance({ x: 50, y: 0 }, { x: 50, y: 50 }, 25, 0.5), 100), 'widthFromKnownDistance, horizontal and vertical');
    let same = false; try { widthFromKnownDistance({ x: 5, y: 5 }, { x: 5, y: 5 }, 10, 0.5); } catch { same = true; }
    assert(same, 'Two equal points say nothing about the scale');
    const lines = parseMapKey('A. The Old Mill\nB) Crossroads Inn / 3 - Watchtower; c: Ford');
    assert(lines.map(line => line.key).join() === 'A,B,3,C' && lines.map(line => line.name).join('|') === 'The Old Mill|Crossroads Inn|Watchtower|Ford', `parseMapKey ${JSON.stringify(lines)}`);
    assert(parseMapKey('To the sea').length === 0 && parseMapKey('Title').length === 0 && parseMapKey('To the sea\nTitle').length === 0, 'Prose lines are not key lines');
    assert(pinKey('b.') === 'B' && pinKey('(3)') === '3' && pinKey('A') === 'A' && pinKey('Faro') === null && pinKey('B. Inn') === null, 'pinKey');
    const matched = matchMapKey([{ id: 'x', name: 'A' }, { id: 'y', name: 'Faro' }], parseMapKey('A. Mill\nZ. Tower'));
    assert(matched.matches.length === 1 && matched.matches[0].pinId === 'x' && matched.matches[0].to === 'Mill' && matched.unmatched.length === 1 && matched.unmatched[0].key === 'Z', 'matchMapKey');

    // --- Bridge fixtures: a 400x200 map, one without an image, one never scaled, one in a project with maps off.
    const project = (id: string, engines: string[]): Project => ({ id, title: id, description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: engines, createdAt: 1, updatedAt: 1 });
    await db.projects.put(project(P, ['maps'])); await db.projects.put(project(Q, []));
    const image = png(400, 200);
    await db.worldMaps.put({ id: M, projectId: P, title: 'Costa', backgroundImage: image, createdAt: 1, updatedAt: 1 });
    await db.worldMaps.put({ id: U, projectId: P, title: 'Sin escala', backgroundImage: image, createdAt: 1, updatedAt: 1 });
    await db.worldMaps.put({ id: N, projectId: P, title: 'Sin imagen', createdAt: 1, updatedAt: 1 });
    await db.worldMaps.put({ id: X, projectId: Q, title: 'Apagado', backgroundImage: image, createdAt: 1, updatedAt: 1 });
    const widthOf = async (id: string) => (await db.worldMaps.get(id))!.widthKm;

    // --- wh_set_map_scale refusals change nothing.
    bad(await runBridgeTool('wh_set_map_scale', { mapId: M, widthKm: 0.001 }), /widthKm must be/, 'below the range');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: M, widthKm: 50000 }), /widthKm must be/, 'above the range');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: M, widthKm: 'wide' }), /widthKm must be/, 'not a number');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: M }), /exactly one/, 'nothing to set');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: M, widthKm: 100, knownDistance: { from: { x: 0, y: 0 }, to: { x: 50, y: 0 }, km: 50 } }), /exactly one/, 'both widthKm and knownDistance');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: M, widthKm: 100, clear: true }), /exactly one/, 'widthKm and clear');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: M, clear: false }), /clear must be true/, 'clear false');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: M, clear: true }), /no scale to clear/, 'clear on an unscaled map');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: M, knownDistance: { from: { x: 5, y: 5 }, to: { x: 5, y: 5 }, km: 3 } }), /same point/, 'equal points');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: M, knownDistance: { from: { x: 0, y: 5 }, to: { x: 5, y: 5 }, km: -3 } }), /positive/, 'negative km');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: M, knownDistance: { from: { x: 0, y: 5 }, to: { x: 150, y: 5 }, km: 3 } }), /0 to 100/, 'point outside the picture');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: M, knownDistance: { from: { x: 0, y: 50 }, to: { x: 0.01, y: 50 }, km: 40000 } }), /outside/, 'a distance that implies an absurd width');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: N, knownDistance: { from: { x: 0, y: 50 }, to: { x: 50, y: 50 }, km: 50 } }), /no image/, 'known distance with no image and no aspect');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: 'nowhere', widthKm: 5 }), /No map/, 'unknown map');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: X, widthKm: 5 }), /switched off/, 'maps switched off');
    assert((await widthOf(M)) === undefined && (await widthOf(N)) === undefined && (await widthOf(X)) === undefined, 'A refused call changed a scale');

    // --- Setting, undo, and an undo that refuses after a later change.
    const set100 = await runBridgeTool('wh_set_map_scale', { mapId: M, widthKm: 100 });
    assert(set100.ok && (set100.result as { widthKm: number }).widthKm === 100 && (await widthOf(M)) === 100, `Set ${JSON.stringify(set100)}`);
    const listed = (await runBridgeTool('wh_list_maps', { projectId: P })).result as { maps: { id: string; widthKm?: number }[] };
    assert(listed.maps.find(map => map.id === M)?.widthKm === 100 && listed.maps.find(map => map.id === U)?.widthKm === undefined, 'wh_list_maps gives widthKm only where set');
    bad(await runBridgeTool('wh_set_map_scale', { mapId: M, widthKm: 100 }), /already/, 'same scale again');
    const undone = await undo('wh_set_map_scale', set100);
    assert(undone.ok && (await widthOf(M)) === undefined, `Undo removes the scale it set ${JSON.stringify(undone)}`);
    const first = await runBridgeTool('wh_set_map_scale', { mapId: M, widthKm: 100 });
    const second = await runBridgeTool('wh_set_map_scale', { mapId: M, widthKm: 200 });
    assert(second.ok && (second.result as { previousWidthKm: number }).previousWidthKm === 100 && (await widthOf(M)) === 200, 'Second scale');
    const staleUndo = await undo('wh_set_map_scale', first);
    bad(staleUndo, /changed after this edit/, 'undo of an older scale');
    assert((await widthOf(M)) === 200, 'A stale undo overwrote the later scale');
    assert((await undo('wh_set_map_scale', second)).ok && (await widthOf(M)) === 100, 'Undo of the second restores the first');
    assert((await undo('wh_set_map_scale', first)).ok && (await widthOf(M)) === undefined, 'Then the first can be undone');

    // --- Known distance reads the picture's proportions from its image (400x200 -> 0.5).
    const horizontal = await runBridgeTool('wh_set_map_scale', { mapId: M, knownDistance: { from: { x: 0, y: 50 }, to: { x: 50, y: 50 }, km: 50 } });
    assert(horizontal.ok && (horizontal.result as { widthKm: number; aspect: number }).widthKm === 100 && (horizontal.result as { aspect: number }).aspect === 0.5 && (await widthOf(M)) === 100, `Known distance, horizontal ${JSON.stringify(horizontal)}`);
    const vertical = await runBridgeTool('wh_set_map_scale', { mapId: M, knownDistance: { from: { x: 50, y: 0 }, to: { x: 50, y: 50 }, km: 12.5 } });
    assert(vertical.ok && (await widthOf(M)) === 50, `Known distance, vertical (25 units = 12.5 km) ${JSON.stringify(vertical)}`);
    assert((await runBridgeTool('wh_set_map_scale', { mapId: M, widthKm: 100 })).ok && (await widthOf(M)) === 100, 'Back to 100 km');
    // No image: the aspect argument stands in.
    const noImage = await runBridgeTool('wh_set_map_scale', { mapId: N, knownDistance: { from: { x: 0, y: 50 }, to: { x: 50, y: 50 }, km: 50 }, aspect: 0.5 });
    assert(noImage.ok && (await widthOf(N)) === 100, 'Known distance with an explicit aspect and no image');
    // Clear, and its undo.
    const cleared = await runBridgeTool('wh_set_map_scale', { mapId: N, clear: true });
    assert(cleared.ok && (cleared.result as { widthKm: unknown }).widthKm === null && (await widthOf(N)) === undefined, 'Clear');
    assert((await undo('wh_set_map_scale', cleared)).ok && (await widthOf(N)) === 100, 'Undo of a clear restores the scale');
    assert((await runBridgeTool('wh_set_map_scale', { mapId: N, clear: true })).ok, 'Cleared again');

    // --- wh_measure_map.
    bad(await runBridgeTool('wh_measure_map', { mapId: U, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }), /wh_set_map_scale/, 'measuring an unscaled map');
    bad(await runBridgeTool('wh_measure_map', { mapId: M }), /exactly one/, 'neither points nor featureId');
    bad(await runBridgeTool('wh_measure_map', { mapId: M, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], featureId: 'x' }), /exactly one/, 'both points and featureId');
    bad(await runBridgeTool('wh_measure_map', { mapId: M, points: [{ x: 0, y: 0 }] }), /2 to 500/, 'one point');
    bad(await runBridgeTool('wh_measure_map', { mapId: M, points: [{ x: 0, y: 0 }, { x: 101, y: 1 }] }), /0 to 100/, 'point outside the picture');
    bad(await runBridgeTool('wh_measure_map', { mapId: M, featureId: 'no-such-shape' }), /No shape/, 'unknown featureId');
    bad(await runBridgeTool('wh_measure_map', { mapId: 'nowhere', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }), /No map/, 'unknown map');
    const line = await runBridgeTool('wh_measure_map', { mapId: M, points: [{ x: 10, y: 50 }, { x: 60, y: 50 }] });
    type Measure = { kind: string; km: number; widthKm: number; aspect: number; aspectSource: string; areaKm2?: number; perimeterKm?: number; travel: { mode: string; hours: number; days?: number }[] };
    const lm = line.result as Measure;
    assert(line.ok && lm.km === 50 && lm.widthKm === 100 && lm.aspect === 0.5 && lm.aspectSource === 'image' && lm.kind === 'line' && lm.areaKm2 === undefined, `Horizontal line ${JSON.stringify(line)}`);
    const walk = lm.travel.find(entry => entry.mode === 'walk')!;
    assert(near(walk.hours, 11.11, 0.005) && walk.days === 2 && lm.travel.some(entry => entry.mode === 'plane') && lm.travel.length === 6, `Travel estimates ${JSON.stringify(lm.travel)}`);
    assert((await runBridgeTool('wh_measure_map', { mapId: M, points: [{ x: 50, y: 10 }, { x: 50, y: 60 }] })).result as Measure && ((await runBridgeTool('wh_measure_map', { mapId: M, points: [{ x: 50, y: 10 }, { x: 50, y: 60 }] })).result as Measure).km === 25, 'Vertical line is 25 km');

    // Shapes: a road, a river, a region, a label.
    const road = await runBridgeTool('wh_add_map_feature', { mapId: M, kind: 'path', name: 'Camino real', points: [{ x: 10, y: 50 }, { x: 60, y: 50 }], pathStyle: 'road' });
    const river = await runBridgeTool('wh_add_map_feature', { mapId: M, kind: 'path', name: 'Rio', points: [{ x: 50, y: 10 }, { x: 50, y: 60 }], pathStyle: 'river' });
    const zone = await runBridgeTool('wh_add_map_feature', { mapId: M, kind: 'region', name: 'Bosque', points: square });
    const label = await runBridgeTool('wh_add_map_feature', { mapId: M, kind: 'label', name: 'Norte', points: [{ x: 5, y: 5 }] });
    assert(road.ok && river.ok && zone.ok && label.ok, 'Shapes added');
    const idOf = (reply: BridgeReply) => (reply.result as { id: string }).id;
    const roadM = (await runBridgeTool('wh_measure_map', { mapId: M, featureId: idOf(road) })).result as Measure & { name: string };
    assert(roadM.km === 50 && roadM.kind === 'path' && roadM.name === 'Camino real', `Measure a path ${JSON.stringify(roadM)}`);
    const zoneM = (await runBridgeTool('wh_measure_map', { mapId: M, featureId: idOf(zone) })).result as Measure;
    assert(zoneM.kind === 'region' && near(zoneM.areaKm2!, 50) && near(zoneM.perimeterKm!, 30) && near(zoneM.km, 25), `Measure a region ${JSON.stringify(zoneM)}`);
    assert(near(zoneM.travel.find(entry => entry.mode === 'walk')!.hours, 30 / 4.5, 0.005), 'A region travels its perimeter');
    bad(await runBridgeTool('wh_measure_map', { mapId: M, featureId: idOf(label) }), /label/, 'measuring a label');
    // No image: aspect is required, the argument makes it work.
    bad(await runBridgeTool('wh_set_map_scale', { mapId: N, widthKm: 100 }).then(async () => runBridgeTool('wh_measure_map', { mapId: N, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] })), /aspect/, 'no image and no aspect');
    const withAspect = await runBridgeTool('wh_measure_map', { mapId: N, points: [{ x: 0, y: 0 }, { x: 0, y: 50 }], aspect: 0.5 });
    assert(withAspect.ok && (withAspect.result as Measure).km === 25 && (withAspect.result as Measure).aspectSource === 'argument', 'Measuring with an explicit aspect');

    // --- wh_list_map_features: lengths and areas with a scale, path styles always.
    type Listed = { widthKm?: number; scaleNote?: string; features: (MapFeature & { lengthKm?: number; areaKm2?: number })[] };
    const features = (await runBridgeTool('wh_list_map_features', { mapId: M })).result as Listed;
    const byName = (name: string) => features.features.find(feature => feature.name === name)!;
    assert(features.widthKm === 100 && byName('Camino real').lengthKm === 50 && byName('Rio').lengthKm === 25 && near(byName('Bosque').areaKm2!, 50) && byName('Norte').lengthKm === undefined && byName('Norte').areaKm2 === undefined, `Listed lengths ${JSON.stringify(features.features.map(f => [f.name, f.lengthKm, f.areaKm2]))}`);
    assert(byName('Camino real').pathStyle === 'road' && byName('Rio').pathStyle === 'river' && byName('Bosque').pathStyle === undefined, 'Listed path styles');
    await runBridgeTool('wh_add_map_feature', { mapId: U, kind: 'path', name: 'Sendero', points: [{ x: 1, y: 1 }, { x: 9, y: 9 }], pathStyle: 'trail' });
    const unscaled = (await runBridgeTool('wh_list_map_features', { mapId: U })).result as Listed;
    assert(unscaled.widthKm === undefined && unscaled.features[0].pathStyle === 'trail' && unscaled.features[0].lengthKm === undefined, 'No lengths on an unscaled map');
    const noPicture = (await runBridgeTool('wh_list_map_features', { mapId: N })).result as Listed;
    assert(noPicture.widthKm === 100 && !!noPicture.scaleNote, 'A scaled map with no image says why lengths are missing');
    await db.worldMaps.update(N, { features: [{ id: 'n-road', kind: 'path', name: 'Via', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }], color: '#fff' }] });
    const noPictureAspect = (await runBridgeTool('wh_list_map_features', { mapId: N, aspect: 0.5 })).result as Listed;
    assert(noPictureAspect.features[0].lengthKm === 50, 'List with an explicit aspect');

    // --- pathStyle on add / update.
    const featuresBefore = (await db.worldMaps.get(M))!.features!.length;
    bad(await runBridgeTool('wh_add_map_feature', { mapId: M, kind: 'region', name: 'Mal', points: square, pathStyle: 'road' }), /only applies to paths/, 'pathStyle on a region');
    bad(await runBridgeTool('wh_add_map_feature', { mapId: M, kind: 'label', name: 'Mal', points: [{ x: 1, y: 1 }], pathStyle: 'river' }), /only applies to paths/, 'pathStyle on a label');
    bad(await runBridgeTool('wh_add_map_feature', { mapId: M, kind: 'path', name: 'Mal', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], pathStyle: 'highway' }), /road, trail or river/, 'unknown pathStyle');
    bad(await runBridgeTool('wh_add_map_feature', { mapId: M, kind: 'path', name: 'Mal', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], pathStyle: null }), /road, trail or river/, 'null pathStyle on add');
    bad(await runBridgeTool('wh_update_map_feature', { mapId: M, id: idOf(zone), pathStyle: 'trail' }), /only applies to paths/, 'update pathStyle on a region');
    bad(await runBridgeTool('wh_update_map_feature', { mapId: M, id: idOf(label), pathStyle: null }), /only applies to paths/, 'update pathStyle on a label');
    bad(await runBridgeTool('wh_update_map_feature', { mapId: M, id: idOf(road), pathStyle: 'highway' }), /road, trail or river/, 'update with an unknown pathStyle');
    bad(await runBridgeTool('wh_update_map_feature', { mapId: M, id: 'no-such-shape', pathStyle: 'trail' }), /No shape/, 'update of an unknown shape');
    assert((await db.worldMaps.get(M))!.features!.length === featuresBefore, 'A refused shape was drawn anyway');
    const toTrail = await runBridgeTool('wh_update_map_feature', { mapId: M, id: idOf(road), pathStyle: 'trail' });
    assert(toTrail.ok && (await db.worldMaps.get(M))!.features!.find(f => f.id === idOf(road))!.pathStyle === 'trail', 'Update pathStyle');
    assert((await undo('wh_update_map_feature', toTrail)).ok && (await db.worldMaps.get(M))!.features!.find(f => f.id === idOf(road))!.pathStyle === 'road', 'Undo restores the previous pathStyle');
    const removeStyle = await runBridgeTool('wh_update_map_feature', { mapId: M, id: idOf(road), pathStyle: null });
    assert(removeStyle.ok && (await db.worldMaps.get(M))!.features!.find(f => f.id === idOf(road))!.pathStyle === undefined, 'pathStyle null removes it');

    // --- wh_name_map_pins_from_key.
    const pin = (id: string, name: string): MapPin => ({ id, projectId: P, mapId: M, name, icon: 'city', position: { x: 10, y: 10 } });
    await db.mapPins.bulkPut([pin('k-a', 'A'), pin('k-b', 'b.'), pin('k-3', '(3)'), pin('k-faro', 'Faro')]);
    const key = 'A. The Old Mill\nB) Crossroads Inn / 3 - Watchtower; c: Ford';
    const names = async () => Object.fromEntries((await db.mapPins.where('mapId').equals(M).toArray()).map(row => [row.id, row.name]));
    const dry = await runBridgeTool('wh_name_map_pins_from_key', { mapId: M, key, dryRun: true });
    type KeyResult = { matches: { pinId: string; key: string; from: string; to: string }[]; unmatched: { key: string; name: string }[]; renamed: number; dryRun: boolean };
    const dr = dry.result as KeyResult;
    assert(dry.ok && dr.dryRun && dr.matches.length === 3 && dr.unmatched.length === 1 && dr.unmatched[0].key === 'C' && dr.unmatched[0].name === 'Ford' && dr.renamed === 0, `Dry run ${JSON.stringify(dry)}`);
    assert(dr.matches.find(match => match.pinId === 'k-b')!.from === 'b.' && dr.matches.find(match => match.pinId === 'k-3')!.to === 'Watchtower', 'Matches say from and to');
    assert((await names())['k-a'] === 'A' && (await names())['k-b'] === 'b.', 'A dry run renamed pins');
    bad(await runBridgeTool('wh_name_map_pins_from_key', { mapId: M, key: 'To the sea\nTitle' }), /No key lines/, 'a key with no lines');
    bad(await runBridgeTool('wh_name_map_pins_from_key', { mapId: M, key: '   ' }), /"key" is required/, 'empty key');
    bad(await runBridgeTool('wh_name_map_pins_from_key', { mapId: M, key, dryRun: 'yes' }), /dryRun must be/, 'dryRun not a boolean');
    bad(await runBridgeTool('wh_name_map_pins_from_key', { mapId: 'nowhere', key }), /No map/, 'unknown map');
    bad(await runBridgeTool('wh_name_map_pins_from_key', { mapId: X, key }), /switched off/, 'maps switched off');
    const applied = await runBridgeTool('wh_name_map_pins_from_key', { mapId: M, key });
    const after = await names();
    assert(applied.ok && (applied.result as KeyResult).renamed === 3 && after['k-a'] === 'The Old Mill' && after['k-b'] === 'Crossroads Inn' && after['k-3'] === 'Watchtower' && after['k-faro'] === 'Faro', `Renamed ${JSON.stringify(after)}`);
    const nothing = await runBridgeTool('wh_name_map_pins_from_key', { mapId: M, key });
    assert(nothing.ok && (nothing.result as KeyResult).matches.length === 0 && (nothing.result as KeyResult).renamed === 0 && (nothing.result as KeyResult).unmatched.length === 4 && (nothing as { result: { __audit?: unknown } }).result.__audit === undefined, 'A second run finds no letter pins and writes nothing');
    // Undo, whole.
    const keyUndo = await undo('wh_name_map_pins_from_key', applied);
    const restored = await names();
    assert(keyUndo.ok && restored['k-a'] === 'A' && restored['k-b'] === 'b.' && restored['k-3'] === '(3)' && restored['k-faro'] === 'Faro', `Undo of the key ${JSON.stringify(keyUndo)} ${JSON.stringify(restored)}`);
    // Undo, partial: a pin renamed since keeps its newer name.
    const again = await runBridgeTool('wh_name_map_pins_from_key', { mapId: M, key });
    assert(again.ok && (again.result as KeyResult).renamed === 3, 'Applied again');
    await runBridgeTool('wh_update_map_pin', { id: 'k-b', name: 'The Inn' });
    const partial = await undo('wh_name_map_pins_from_key', again);
    const mixed = await names();
    assert(partial.ok && !!(partial.result as { caveat?: string }).caveat && mixed['k-a'] === 'A' && mixed['k-3'] === '(3)' && mixed['k-b'] === 'The Inn', `Partial undo ${JSON.stringify(partial)} ${JSON.stringify(mixed)}`);
    // Undo, refused: every pin was renamed since.
    const third = await runBridgeTool('wh_name_map_pins_from_key', { mapId: M, key });
    assert(third.ok && (third.result as KeyResult).renamed === 2, 'Applied a third time (the renamed pin no longer has a letter)');
    await runBridgeTool('wh_update_map_pin', { id: 'k-a', name: 'Mill' });
    await runBridgeTool('wh_update_map_pin', { id: 'k-3', name: 'Tower' });
    bad(await undo('wh_name_map_pins_from_key', third), /renamed or removed since/, 'undo with every pin renamed since');
    const final = await names();
    assert(final['k-a'] === 'Mill' && final['k-3'] === 'Tower', 'A refused undo changed pins');

    return [
      'Scale helpers: 100 km on a 2:1 picture gives 50 km horizontally, 25 km vertically, 50 km2 for a 10x10 % square; width from a known distance; range check',
      'Map key: "A. / B) / 3 - / c:" gives A, B, 3, C; prose lines give nothing; pinKey of "b." is B and of "(3)" is 3',
      'wh_set_map_scale: widthKm, knownDistance (aspect read from a real 400x200 PNG, or given when there is no image) and clear; refuses out-of-range, both arguments, equal points, no image without aspect, maps switched off; undo restores and refuses after a later change',
      'wh_measure_map: lines, routes and regions with km, perimeter, area and travel estimates; refuses an unscaled map, an unknown featureId, a label, bad points',
      'wh_list_map_features gives lengthKm, areaKm2 and pathStyle; wh_list_maps gives widthKm; pathStyle road/trail/river on add and update (null removes), refused on regions and labels, undone with the shapes',
      'wh_name_map_pins_from_key: dry run, rename, unmatched lines, nothing to do writes nothing; undo restores each name only where it still carries the new one',
    ];
  } finally {
    for (const id of [M, N, U, X]) { await db.mapPins.where('mapId').equals(id).delete(); await db.worldMaps.delete(id); }
    await db.projects.delete(P); await db.projects.delete(Q);
  }
}
