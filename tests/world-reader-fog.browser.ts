import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { deserializeEdits, serializeEdits, type WorldEdit } from '@/engines/worldgen/core/edits';
import { commitPaintStroke, type PaintSpec } from '@/engines/worldgen/core/paintCommit';
import { FOG_HEARD, FOG_HIDDEN, FOG_SEEN, fogChapters, fogMask, fogShares, routeFogEdit } from '@/engines/worldgen/core/readerFog';
import { drawReaderFog, fogHides } from '@/engines/worldgen/cartography/readerFogLayer';
import { drawAnnotations } from '@/engines/worldgen/cartography/annotations';
import { resolvePresentation, revertWorldPresentation, saveWorldPresentation } from '@/engines/worldgen/presentation';
import { DEFAULT_PAINT_TOOL } from '@/engines/worldgen/components/PaintPanel';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { PaintSession } from '@/engines/worldgen/core/paintSession';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

const disc = (x: number, y: number, radius = 4) => ({ pts: [{ x: x + 0.5, y: y + 0.5 }], radius, strength: 1, softness: 0.3 });

/** The reader's-eye map: the mask, its storage, the brush, drawing, the saved start and the bridge. */
export async function testReaderFog(): Promise<string[]> {
  const P = 'synthetic-reader-fog', Wid = 'reader-fog-world';
  try {
    // The mask: blank by default, last stroke wins, chapters filter, start states.
    const W = 64, H = 32, at = (m: Uint8Array, x: number, y: number) => m[y * W + x];
    const edits: WorldEdit[] = [
      { kind: 'fog', op: 'seen', stroke: disc(10, 10, 6) },
      { kind: 'fog', op: 'heard', stroke: disc(30, 16), chapter: 2 },
      { kind: 'fog', op: 'seen', stroke: disc(30, 16, 2), chapter: 5 },
      { kind: 'fog', op: 'hide', stroke: disc(10, 10, 1.5) },
    ];
    const all = fogMask(edits, W, H, 'blank', null);
    assert(at(all, 50, 25) === FOG_HIDDEN && at(all, 12, 10) === FOG_SEEN && at(all, 10, 10) === FOG_HIDDEN, 'Blank start, seen disc and later hide');
    assert(at(all, 30, 16) === FOG_SEEN && at(all, 33, 16) === FOG_HEARD, 'Later seen over earlier heard');
    const ch2 = fogMask(edits, W, H, 'blank', 2), ch1 = fogMask(edits, W, H, 'blank', 1);
    assert(at(ch2, 30, 16) === FOG_HEARD && at(ch1, 30, 16) === FOG_HIDDEN && at(ch1, 12, 10) === FOG_SEEN, 'Chapter filter');
    assert(at(fogMask([], W, H, 'ink'), 5, 5) === FOG_SEEN && at(fogMask([], W, H, 'sketch'), 5, 5) === FOG_HEARD, 'Start states');
    const shares = fogShares(all);
    assert(shares.seen > 0 && shares.heard > 0 && Math.abs(shares.seen + shares.heard + shares.hidden - 1) < 1e-9, `Shares ${JSON.stringify(shares)}`);
    assert(JSON.stringify(fogChapters(edits)) === '[2,5]', 'Chapters list');
    // Along a route: thinned points, seam unwrapped, the whole corridor seen.
    const route = [...Array.from({ length: 10 }, (_, k) => 20 * W + 54 + k), ...Array.from({ length: 10 }, (_, k) => 20 * W + k)];
    const along = routeFogEdit(route, W, 4, 4);
    assert(along?.kind === 'fog' && along.op === 'seen' && along.chapter === 4 && along.stroke.pts.length < route.length && along.stroke.pts.every((p, k, a) => k === 0 || Math.abs(p.x - a[k - 1].x) < W / 2), `Route stroke ${JSON.stringify(along)}`);
    const corridor = fogMask([along!], W, H, 'blank', 4);
    assert([54, 58, 63, 0, 5, 9].every((x) => at(corridor, x, 20) === FOG_SEEN) && at(corridor, 30, 20) === FOG_HIDDEN && at(fogMask([along!], W, H, 'blank', 3), 58, 20) === FOG_HIDDEN, 'Route corridor');
    // Storage: round-trips; a bad op or chapter costs only that edit.
    const back = deserializeEdits(serializeEdits(edits));
    assert(back.length === 4 && back[1].kind === 'fog' && back[1].chapter === 2, 'Round trip');
    const json = JSON.stringify({ v: 2, edits: [...JSON.parse(serializeEdits(edits)).edits, { kind: 'fog', op: 'reveal', stroke: disc(1, 1) }, { kind: 'fog', op: 'seen', stroke: disc(1, 1), chapter: -1 }] });
    assert(deserializeEdits(json).length === 4, 'Malformed fog edits were kept');
    // The brush: Ctrl hides; the chapter travels with the stroke.
    const spec = { ...DEFAULT_PAINT_TOOL, mode: 'fog', fogOp: 'heard', fogChapter: 3 } as unknown as PaintSpec;
    const stroke = commitPaintStroke(spec, [{ x: 5, y: 5 }]);
    assert(stroke?.kind === 'fog' && stroke.op === 'heard' && stroke.chapter === 3, `Brush edit ${JSON.stringify(stroke)}`);
    const neg = commitPaintStroke({ ...spec, fogChapter: null } as PaintSpec, [{ x: 5, y: 5 }], { negative: true });
    assert(neg?.kind === 'fog' && neg.op === 'hide' && neg.chapter === undefined, `Ctrl edit ${JSON.stringify(neg)}`);
    // Drawing: paper in the reader's view, a tint for the author; seen ground untouched.
    const canvas = document.createElement('canvas'); canvas.width = W * 4; canvas.height = H * 4;
    const ctx = canvas.getContext('2d')!;
    const layer = { mask: all, width: W, height: H, mode: 'reader' as const };
    assert(drawReaderFog(ctx, layer, (x) => x * 4, (y) => y * 4), 'Fog drew nothing');
    const px = (x: number, y: number) => ctx.getImageData(x * 4 + 2, y * 4 + 2, 1, 1).data;
    assert(px(50, 25)[3] === 255 && px(14, 10)[3] === 0 && px(33, 16)[3] > 60 && px(33, 16)[3] < 255, `Reader paint: ${px(50, 25)[3]} ${px(14, 10)[3]} ${px(33, 16)[3]}`);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawReaderFog(ctx, { ...layer, mask: all.slice(), mode: 'author' }, (x) => x * 4, (y) => y * 4);
    assert(px(50, 25)[3] > 60 && px(50, 25)[3] < 200, `Author tint ${px(50, 25)[3]}`);
    // Through the annotation layer with a seam-wrapping x (the Carta's): still the whole sheet.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const wrapX = (wx: number) => { let d = wx - 32; while (d > W / 2) d -= W; while (d < -W / 2) d += W; return (d + 32) * 4; };
    drawAnnotations(ctx, { fog: layer }, { width: W, height: H } as never, wrapX, (y) => y * 4, 4);
    assert(px(50, 25)[3] === 255 && px(2, 25)[3] === 255 && px(14, 10)[3] === 0, 'Annotation fog folded at the seam');
    assert(fogHides(layer, 50, 25) && !fogHides(layer, 14, 10) && !fogHides({ ...layer, mode: 'author' }, 50, 25), 'fogHides');
    // The saved start state, with undo.
    await db.projects.put({ id: P, title: 'Fog', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'fog-planet' };
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Fog planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    assert(resolvePresentation(undefined).readerStart === 'blank', 'Legacy default start');
    let refused = false; try { await saveWorldPresentation({ projectId: P }, Wid, { readerStart: 'fog' }); } catch { refused = true; }
    assert(refused, 'Accepted a bad readerStart');
    const receipt = await saveWorldPresentation({ projectId: P }, Wid, { readerStart: 'sketch' });
    assert(resolvePresentation((await db.generatedWorlds.get(Wid))!.presentation).readerStart === 'sketch', 'readerStart saved');
    await revertWorldPresentation({ projectId: P }, Wid, receipt);
    assert(resolvePresentation((await db.generatedWorlds.get(Wid))!.presentation).readerStart === 'blank', 'readerStart undo');
    // The bridge: paint, read, render.
    const generated = generateWorld(params);
    // In a painting session the fog is recorded and undone without replaying the world.
    const sessionWorld = generateWorld(params);
    const session = new PaintSession(sessionWorld);
    const before = sessionWorld.revision ?? 0;
    session.push({ kind: 'fog', op: 'seen', stroke: disc(30, 30) });
    assert((sessionWorld.revision ?? 0) === before && session.edits.length === 1, 'A fog stroke replayed the world');
    session.undo();
    assert(session.edits.length === 0 && (sessionWorld.revision ?? 0) === before && session.canRedo, 'Fog undo');
    session.redo();
    assert(session.edits.length === 1 && (sessionWorld.revision ?? 0) === before, 'Fog redo');
    session.push({ kind: 'terrain', op: 'raise', stroke: disc(40, 40) });
    assert((sessionWorld.revision ?? 0) > before, 'A terrain stroke must still replay');
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), generated);
    const bad = await runBridgeTool('wh_paint_reader_fog', { worldId: Wid, op: 'reveal', points: [{ x: 1, y: 1 }] });
    const badChapter = await runBridgeTool('wh_paint_reader_fog', { worldId: Wid, op: 'seen', points: [{ x: 1, y: 1 }], chapter: 1.5 });
    const outside = await runBridgeTool('wh_paint_reader_fog', { worldId: Wid, op: 'seen', points: [{ x: 999, y: 1 }] });
    assert(!bad.ok && !badChapter.ok && !outside.ok, 'Bridge accepted a bad fog stroke');
    const plain = await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 256 });
    const painted = await runBridgeTool('wh_paint_reader_fog', { worldId: Wid, op: 'seen', points: [{ x: 20, y: 20 }, { x: 40, y: 20 }], radiusCells: 6 });
    const later = await runBridgeTool('wh_paint_reader_fog', { worldId: Wid, op: 'heard', points: [{ x: 90, y: 40 }], radiusCells: 5, chapter: 4 });
    assert(painted.ok && later.ok, `Bridge paint ${JSON.stringify(painted)} ${JSON.stringify(later)}`);
    const view = await runBridgeTool('wh_reader_view', { worldId: Wid, cells: [{ x: 30, y: 20 }, { x: 90, y: 40 }, { x: 100, y: 10 }] });
    const early = await runBridgeTool('wh_reader_view', { worldId: Wid, chapter: 3, cells: [{ x: 90, y: 40 }] });
    const v = view.result as { chapters: number[]; strokes: number; cells: { state: string }[]; shares: { seen: number } };
    assert(view.ok && v.strokes === 2 && JSON.stringify(v.chapters) === '[4]' && v.cells.map((c) => c.state).join() === 'seen,heard,hidden' && v.shares.seen > 0, `Reader view ${JSON.stringify(view)}`);
    assert(early.ok && (early.result as { cells: { state: string }[] }).cells[0].state === 'hidden', 'Chapter 3 should not know chapter 4');
    const fogged = await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 256, readerView: true });
    const ch3 = await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 256, readerChapter: 3 });
    const url = (r: typeof plain) => (r.result as { dataUrl: string }).dataUrl;
    assert(plain.ok && fogged.ok && ch3.ok && url(plain) !== url(fogged) && url(fogged) !== url(ch3), 'Render ignored the reader view or its chapter');
    // A planned journey's path goes straight into the fog brush.
    let pair: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
    for (let y = 10; y < generated.height - 10 && !pair; y++) for (let x = 0; x + 8 < generated.width && !pair; x++) {
      const land = (cx: number) => generated.elevation[y * generated.width + cx] > 0.05;
      if (land(x) && land(x + 8) && land(x + 4)) pair = { a: { x, y }, b: { x: x + 8, y } };
    }
    assert(pair, 'No land pair for a journey');
    const plan = await runBridgeTool('wh_plan_journey', { worldId: Wid, stops: [pair.a, pair.b] });
    const path = (plan.result as { path?: { x: number; y: number }[] }).path;
    assert(plan.ok && path && path.length >= 2 && Math.abs(path[0].x - pair.a.x) <= 1 && Math.abs(path.at(-1)!.x - pair.b.x) <= 1, `Journey path ${JSON.stringify(plan).slice(0, 300)}`);
    const walked = await runBridgeTool('wh_paint_reader_fog', { worldId: Wid, op: 'seen', points: path, radiusCells: 2, chapter: 6 });
    const onWay = await runBridgeTool('wh_reader_view', { worldId: Wid, chapter: 6, cells: [path[Math.floor(path.length / 2)]] });
    assert(walked.ok && (onWay.result as { cells: { state: string }[] }).cells[0].state === 'seen', 'Journey path not seen');
    const start = await runBridgeTool('wh_set_world_presentation', { worldId: Wid, readerStart: 'ink' });
    const inked = await runBridgeTool('wh_reader_view', { worldId: Wid, cells: [{ x: 100, y: 10 }] });
    assert(start.ok && (inked.result as { cells: { state: string }[] }).cells[0].state === 'seen', 'readerStart via bridge');
    return [
      'The reader\'s mask starts blank, sketched or inked; the last stroke wins; chapters filter what is known',
      'A route marks its corridor as seen across the seam from its chapter; fog strokes round-trip; a bad op or chapter costs only that edit; the brush stores op and chapter and Ctrl hides',
      'The fog draws paper for the reader, a tint for the author, also through a seam-wrapping Carta mapping, and hides hit-testing only in the reader\'s view',
      'The starting state is saved with the look and undone alone; fog strokes in a painting session never replay or re-derive the world',
      'Bridge: wh_paint_reader_fog validates and paints; wh_reader_view reports shares, chapters and cells; wh_render_world_map renders the reader\'s map per chapter; a wh_plan_journey path paints the way as seen',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
