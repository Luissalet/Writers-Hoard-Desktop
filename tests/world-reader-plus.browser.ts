import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { FOG_HEARD, FOG_HIDDEN, FOG_SEEN, fogMask, READER_STARTS } from '@/engines/worldgen/core/readerFog';
import { fogStateAt, fogUnnamed } from '@/engines/worldgen/cartography/readerFogLayer';
import { drawTownDots, drawTrail } from '@/engines/worldgen/cartography/readerTrail';
import { normalizePresentationPatch, resolvePresentation } from '@/engines/worldgen/presentation';
import { cellBearingDeg, mapLonLat } from '@/engines/worldgen/core/measure';
import { placeReference } from '@/engines/worldgen/core/scaleReference';
import { isViewOnlyEdit } from '@/engines/worldgen/core/storyEvents';
import { PaintSession } from '@/engines/worldgen/core/paintSession';
import { renderCartoCanvas } from '@/engines/worldgen/cartography/texture';
import { buildHumanGeography } from '@/engines/worldgen/core/settlements';
import { themeById } from '@/engines/worldgen/cartography/theme';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** The reader's view, further: land in ink, towns as dots, the trail; and the review's fixes to sheets, zones and undo. */
export async function testWorldReaderPlus(): Promise<string[]> {
  const P = 'synthetic-reader-plus', Wid = 'reader-plus-world';
  try {
    // ---- land in ink ----------------------------------------------------------------
    assert(READER_STARTS.includes('land'), 'land is a start');
    const elevation = new Float32Array([0.3, -1, 0.1, -0.2]);
    const land = fogMask([], 2, 2, 'land', null, elevation);
    assert(land[0] === FOG_SEEN && land[1] === FOG_HIDDEN && land[2] === FOG_SEEN && land[3] === FOG_HIDDEN, `Land in ink, sea blank: ${[...land]}`);
    assert(fogMask([], 2, 2, 'land').every((v) => v === FOG_HIDDEN), 'Without the ground it is blank paper');
    // ---- the look ---------------------------------------------------------------------
    const look = normalizePresentationPatch({ readerStart: 'land', readerTowns: 'dots', readerTrail: true });
    assert(look.readerStart === 'land' && look.readerTowns === 'dots' && look.readerTrail === true, `Look ${JSON.stringify(look)}`);
    for (const bad of [{ readerTowns: 'hide' }, { readerTrail: 'yes' }, { readerStart: 'sea' }]) {
      let refused = false; try { normalizePresentationPatch(bad); } catch { refused = true; }
      assert(refused, `Refused ${JSON.stringify(bad)}`);
    }
    const plain = resolvePresentation({});
    assert(plain.readerTowns === 'names' && plain.readerTrail === false, 'Names and no trail by default');
    assert(resolvePresentation({ readerTowns: 'oops' } as never).readerTowns === 'names', 'A damaged field falls back alone');
    // ---- towns as dots ------------------------------------------------------------------
    const mask = new Uint8Array([FOG_SEEN, FOG_HEARD, FOG_HIDDEN, FOG_SEEN]);
    const layer = { mask, width: 2, height: 2, mode: 'reader' as const, townDots: true };
    const unnamed = fogUnnamed(layer)!;
    assert(unnamed && !unnamed(0, 0) && unnamed(1, 0) && unnamed(0, 1), 'Seen towns keep their names; heard and hidden ones go unnamed');
    assert(fogUnnamed({ ...layer, townDots: false }) === null && fogUnnamed({ ...layer, mode: 'author' }) === null, 'Only in the reader\'s view, only when chosen');
    assert(fogStateAt(layer, 1.5, 0.5) === FOG_HEARD && fogStateAt(null, 0, 0) === FOG_SEEN, 'State under a point');
    // ---- the trail and the dots on paper --------------------------------------------------
    const canvas = new OffscreenCanvas(400, 200), ctx = canvas.getContext('2d')!;
    drawTrail(ctx, [{ x: 2, y: 5, chapter: 1 }, { x: 10, y: 5, chapter: 1 }, { x: 20, y: 12, chapter: 2 }], 0, (wy) => wy * 10, 10, 64);
    const ink = (x0: number, y0: number, w: number, h: number) => { const d = ctx.getImageData(x0, y0, w, h).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 60) n++; return n; };
    assert(ink(60, 50, 40, 12) > 10, 'The dotted line runs between the stops');
    assert(ink(20, 30, 12, 14) > 4, 'Chapter 1 is numbered over its first stop');
    const before = ink(0, 0, 400, 200);
    drawTownDots(ctx, [{ x: 30, y: 15 }], 0, (wy) => wy * 10, 10, 64);
    assert(ink(298, 148, 14, 14) > 6 && ink(0, 0, 400, 200) > before, 'A town heard of is a dot');
    // ---- the export: towns as dots leaves the unseen towns unnamed ---------------------------
    const params = { ...DEFAULT_PARAMS, width: 256, seed: 'reader-plus' };
    const world = generateWorld(params);
    const geography = buildHumanGeography(world);
    const sketch = fogMask([], world.width, world.height, 'sketch');
    const opts = { theme: themeById('antique'), width: 1024, height: 512, geography, fog: { mask: sketch, width: world.width, height: world.height, mode: 'reader' as const } };
    const named = renderCartoCanvas(world, opts).getContext('2d')!.getImageData(0, 0, 1024, 512).data;
    const dotted = renderCartoCanvas(world, { ...opts, fog: { ...opts.fog, townDots: true } }).getContext('2d')!.getImageData(0, 0, 1024, 512).data;
    let differ = 0; for (let i = 0; i < named.length; i += 4) if (Math.abs(named[i] - dotted[i]) + Math.abs(named[i + 1] - dotted[i + 1]) > 30) differ++;
    assert(differ > 200, `Heard-of towns lose their names under towns as dots (${differ} px differ)`);
    // ---- the review's fixes ----------------------------------------------------------------
    const sheet = { worldKm: 2048 };
    assert(Math.abs(cellBearingDeg({ x: 10, y: 10 }, { x: 20, y: 10 }, 1024, 512, sheet) - 90) < 1e-9 && Math.abs(cellBearingDeg({ x: 10, y: 10 }, { x: 10, y: 0 }, 1024, 512, sheet)) < 1e-9, 'Flat bearings on a sheet: east is 90°, north 0°');
    const ll = mapLonLat({ x: 512, y: 256 }, 1024, 512, sheet);
    assert(Math.abs(ll.lat - 40) < 1e-9 && Math.abs(ll.lon) < 1e-9, `A sheet's middle reads 40° N: ${JSON.stringify(ll)}`);
    const ring = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];
    const placed = placeReference(ring, 0.5, 0.5, undefined, undefined, sheet);
    const across = Math.max(...placed.rings[0].map((p) => p[0])) - Math.min(...placed.rings[0].map((p) => p[0]));
    assert(Math.abs(across * 2048 - placed.widthKm) < 1, `A real outline keeps its km on a sheet: ${(across * 2048).toFixed(1)} vs ${placed.widthKm.toFixed(1)}`);
    assert(isViewOnlyEdit({ kind: 'zone', id: 'z', name: 'Z', pts: [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }], color: '#b8432f', pattern: 'wash' }) && isViewOnlyEdit({ kind: 'zoneRemove', id: 'z' }), 'Zones change nothing in the world');
    // Undo counts what was kept: a malformed edit is not a step that takes a neighbour with it.
    const session = new PaintSession(generateWorld({ ...params, seed: 'reader-plus-undo' }));
    session.push({ kind: 'zone', id: 'a', name: 'A', pts: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }], color: '#b8432f', pattern: 'wash' });
    session.pushMany([{ kind: 'zone', id: 'b', name: 'B', pts: [{ x: 1, y: 1 }], color: '#b8432f', pattern: 'wash' } as never]);
    assert(session.edits.length === 1, `The malformed zone is dropped: ${session.edits.length}`);
    session.undo();
    assert(session.edits.length === 0, 'One undo takes back the zone that was kept');
    // ---- the bridge ----------------------------------------------------------------------------
    await db.projects.put({ id: P, title: 'Reader plus', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Reader plus', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), world);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    bad(await runBridgeTool('wh_set_world_presentation', { worldId: Wid, readerTowns: 'hide' }), /readerTowns/, 'Unknown towns setting');
    const set = await runBridgeTool('wh_set_world_presentation', { worldId: Wid, readerStart: 'land', readerTowns: 'dots', readerTrail: true });
    assert(set.ok, `Set ${JSON.stringify(set).slice(0, 200)}`);
    let view: BridgeReply | undefined;
    for (let i = 0; i < 60; i++) { view = await runBridgeTool('wh_reader_view', { worldId: Wid }); if (!(view.ok && (view.result as { pending?: boolean }).pending)) break; await new Promise((r) => setTimeout(r, 500)); }
    let landShare = 0; for (const e of world.elevation) if (e > 0) landShare++;
    landShare /= world.elevation.length;
    const seen = (view!.result as { shares: { seen: number }; readerStart: string });
    assert(view!.ok && seen.readerStart === 'land' && Math.abs(seen.shares.seen - landShare) < 0.01, `wh_reader_view: land in ink is the land share (${JSON.stringify(seen.shares)} vs ${landShare.toFixed(3)})`);
    let render: BridgeReply | undefined;
    for (let i = 0; i < 60; i++) { render = await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 600, readerView: true }); if (!(render.ok && (render.result as { pending?: boolean }).pending)) break; await new Promise((r) => setTimeout(r, 500)); }
    assert(render!.ok && (render!.result as { dataUrl?: string }).dataUrl, 'Rendered in the reader\'s view with dots and the trail');
    bad(await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 400, hour: 'toString' }), /hour must be/, 'A made-up hour named like a property');
    // Zones keep their corners as given (not snapped to cells) and measure on the sphere.
    const added = await runBridgeTool('wh_add_zone', { worldId: Wid, name: 'Polo', points: [{ x: 10.3, y: 4.2 }, { x: 40.7, y: 4.2 }, { x: 40.7, y: 12.6 }, { x: 10.3, y: 12.6 }] });
    const zone = (added.result as { zone: { pts: { x: number; y: number }[] } }).zone;
    assert(added.ok && Math.abs(zone.pts[0].x - 10.3) < 0.01 && Math.abs(zone.pts[2].y - 12.6) < 0.01, `Corners as given: ${JSON.stringify(zone.pts)}`);
    const listed = (await runBridgeTool('wh_list_zones', { worldId: Wid })).result as { zones: { areaKm2: number }[] };
    const flat = 30.4 * 8.4 * (40075 / 256) ** 2;
    assert(listed.zones[0].areaKm2 < flat * 0.6, `Near the pole a zone is smaller than its cells: ${listed.zones[0].areaKm2} against ${Math.round(flat)} flat`);
    return [
      'Land in ink: the reader\'s map can start with the land seen and the sea blank (blank without the ground); saved with the look with towns as dots and the trail, refused when wrong, damaged fields fall back alone',
      'Towns as dots: in the reader\'s view a town the story has not shown keeps no name (atlas, Carta, export, 3D) and one heard of is an ink dot; the trail joins what has happened, numbered by chapter',
      `Review fixes: flat bearings and a sheet's own latitude on sheets; real outlines keep their km on a sheet; zone edits do not rebuild the world; undo counts only what was kept`,
      `Bridge: wh_set_world_presentation takes readerStart land, readerTowns and readerTrail; wh_reader_view's seen share is the land share (${seen.shares.seen}); wh_render_world_map draws the reader's view and refuses an hour named like a property; wh_add_zone keeps corners as given and wh_list_zones measures on the sphere`,
    ];
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
