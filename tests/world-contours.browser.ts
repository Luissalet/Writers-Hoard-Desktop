import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { normalizePresentationPatch, resolvePresentation } from '@/engines/worldgen/presentation';
import { contourLevels, drawContourLines } from '@/engines/worldgen/cartography/contourLayer';
import { renderCartoCanvas } from '@/engines/worldgen/cartography/texture';
import { themeById } from '@/engines/worldgen/cartography/theme';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Contour lines at the author's interval: stored with the look, drawn on any canvas, in exports and through the bridge. */
export async function testWorldContours(): Promise<string[]> {
  const P = 'synthetic-contours', Wid = 'contours-world';
  try {
    // Storage.
    assert(normalizePresentationPatch({ contours: 200 }).contours === 200 && normalizePresentationPatch({ contours: 'off' }).contours === 'off' && normalizePresentationPatch({ contours: null }).contours === null, 'Good values');
    for (const bad of [30, 2.5, 5000, 'on', true]) {
      let refused = false; try { normalizePresentationPatch({ contours: bad }); } catch { refused = true; }
      assert(refused, `contours ${JSON.stringify(bad)} accepted`);
    }
    assert(resolvePresentation(undefined).contours === null && resolvePresentation({ contours: 'nonsense' } as never).contours === null, 'Default and damaged value are "as the look"');

    // Levels and drawing.
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'contour-planet' };
    const world = generateWorld(params);
    let max = 0; for (const e of world.elevation) max = Math.max(max, e);
    const levels500 = contourLevels(world, 500), levels200 = contourLevels(world, 200);
    assert(levels500.length >= 1 && levels500.length <= Math.ceil(max / 0.5), `Levels every 500 m up to ${max} km: ${levels500.length}`);
    assert(levels200.length > levels500.length && levels200.every((level) => Array.isArray(level)), 'A smaller interval gives more levels');
    const canvas = new OffscreenCanvas(512, 256);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    const drawn = drawContourLines(ctx, world, 500, (x) => x * 4, (y) => y * 4, 4, { color: '#000000', alpha: 1 });
    const ink = ctx.getImageData(0, 0, 512, 256).data;
    let dark = 0; for (let i = 3; i < ink.length; i += 4) if (ink[i] > 0) dark++;
    assert(drawn > 0 && dark > 200, `Lines drawn ${drawn}, inked pixels ${dark}`);

    // The export: the author's lines replace the look's own.
    const theme = themeById('relief');
    const plain = renderCartoCanvas(world, { theme, width: 512, height: 256 });
    const lined = renderCartoCanvas(world, { theme, width: 512, height: 256, contourIntervalM: 200, layers: { contours: false } });
    const none = renderCartoCanvas(world, { theme, width: 512, height: 256, layers: { contours: false } });
    const pixels = (c: { getContext(type: '2d'): unknown }) => (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, 512, 256).data;
    const differ = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++; return n; };
    const pPlain = pixels(plain), pLined = pixels(lined), pNone = pixels(none);
    assert(differ(pPlain, pNone) > 50 && differ(pLined, pNone) > differ(pPlain, pNone), `Relief look: its own lines off changes ${differ(pPlain, pNone)} pixels; lines every 200 m change ${differ(pLined, pNone)}`);

    // The bridge.
    await db.projects.put({ id: P, title: 'Contours', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Contour planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), world);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    bad(await runBridgeTool('wh_set_world_presentation', { worldId: Wid, contours: 10 }), /contours/, 'too fine');
    const set = await runBridgeTool('wh_set_world_presentation', { worldId: Wid, contours: 250 });
    const got = (await runBridgeTool('wh_get_world_presentation', { worldId: Wid })).result as { effective: { contours: unknown } };
    assert(set.ok && got.effective.contours === 250, `Set ${JSON.stringify(set).slice(0, 200)} / ${JSON.stringify(got).slice(0, 200)}`);
    let rendered: BridgeReply | undefined;
    for (let i = 0; i < 60; i++) { rendered = await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 400 }); if (rendered.ok && !(rendered.result as { pending?: boolean }).pending) break; await new Promise((r) => setTimeout(r, 500)); }
    const withLines = (rendered!.result as { dataUrl: string }).dataUrl;
    await runBridgeTool('wh_set_world_presentation', { worldId: Wid, contours: 'off' });
    const without = ((await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 400 })).result as { dataUrl: string }).dataUrl;
    await runBridgeTool('wh_set_world_presentation', { worldId: Wid, contours: 250 });
    assert(rendered!.ok && withLines && without && withLines !== without, 'wh_render_world_map draws the lines (the image differs from one without contours)');
    const audit = (set.result as { __audit?: { entityId: string; projectId: string; before: unknown } }).__audit;
    if (audit) {
      const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_set_world_presentation', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'contours' } });
      const after = (await runBridgeTool('wh_get_world_presentation', { worldId: Wid })).result as { effective: { contours: unknown } };
      assert(undone.ok && after.effective.contours === null, `Undo ${JSON.stringify(after).slice(0, 200)}`);
    }
    return [
      'Storage: contours take null (as the look), "off" or whole metres 50–2000; other values are refused, a damaged one reads as the look',
      `Levels every 500 m (${levels500.length}) and 200 m (${levels200.length}) over a ${Math.round(max * 1000)} m world; drawn on a canvas (${drawn} lines)`,
      `Export: on the relief look the author's lines every 200 m replace the look's own (${differ(pLined, pNone)} pixels against none)`,
      `Bridge: wh_set_world_presentation refuses 10 m and saves 250 m, wh_get_world_presentation reports it, wh_render_world_map draws with it${audit ? ', undo puts the look back' : ''}`,
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
